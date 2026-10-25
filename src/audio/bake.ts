// «Запекание» рецептов каталога в AudioBuffer через OfflineAudioContext (жест пользователя не нужен).
// Шторм из 30 ударов/кадр при живом синтезе ≈ 29 % ядра, из готовых буферов ≈ 8 % (05-audio §12).
// Живыми остаются только звуки с непрерывным параметром и длинными хвостами (см. SoundDef.bake = 0).

import { type SoundDef, SOUND_LIST } from './catalog';
import { type NoiseBank, type NoiseData, makeNoiseBank, makeTanhCurve, mulberry32, noiseBankFrom } from './noise';
import type { S } from './sfx';
import { setSynthRandom } from './synth';

/** Звуки для запекания, по приоритету. */
export const BAKE_LIST: readonly SoundDef[] = SOUND_LIST.filter((d) => d.bake > 0).sort((a, b) => a.prio - b.prio);

/**
 * Обрезка хвоста ниже −54 дБ от пика + фейд 5 мс. Пики не нормируются: буфер звучит так же,
 * как живой рецепт (иначе калибровка громкости по рецепту не совпадает с тем, что слышит игрок).
 */
export function trimBuffer(ctx: BaseAudioContext, b: AudioBuffer, thrDb = -54): AudioBuffer {
  const d = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  const thr = peak * 10 ** (thrDb / 20);
  let last = d.length - 1;
  while (last > 0 && Math.abs(d[last]!) < thr) last--;
  const fade = Math.floor(b.sampleRate * 0.005);
  const n = Math.max(1, Math.min(d.length, last + fade));
  const out = ctx.createBuffer(1, n, b.sampleRate);
  const o = out.getChannelData(0);
  o.set(d.subarray(0, n));
  for (let i = 0; i < fade && i < n; i++) o[n - 1 - i]! *= i / fade;
  return out;
}

export type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/** Частота запекания: полосы до 16 кГц для SFX достаточно, память −33 %. */
export const BAKE_RATE = 32000;
/** Сид шумов запекания (одинаковый в игре и в калибровочном рендере). */
export const BAKE_NOISE_SEED = 4242;

/** Сид варианта v звука key — один и тот же в игре и в рендере. */
export function bakeSeed(key: string, v: number): number {
  return 1000 + v * 7919 + hash(key);
}

/** Запечь один вариант звука: рецепт в OfflineAudioContext → буфер с обрезанным хвостом. */
export async function bakeOne(Offline: OfflineCtor, it: SoundDef, v: number, nb: NoiseBank, sampleRate = BAKE_RATE): Promise<AudioBuffer> {
  const oc = new Offline(1, Math.ceil(sampleRate * it.dur), sampleRate);
  const rnd = mulberry32(bakeSeed(it.key, v));
  setSynthRandom(rnd);
  const s: S = { ctx: oc, out: oc.destination, nb, rnd, tanh: TANH };
  try {
    it.fn(s, 0.002, it.param ?? 0);
  } finally {
    setSynthRandom(Math.random);
  }
  return trimBuffer(oc, await oc.startRendering());
}

const TANH = makeTanhCurve(3);

export interface BakeOpts {
  /** Готовые массивы шумов той же частоты (посчитаны заранее в простое) — иначе генерируются здесь. */
  noise?: NoiseData | null;
  /** Прервать запекание (движок закрыт). */
  cancelled?: () => boolean;
}

/**
 * Запекает список по приоритету в моно-буферы (BAKE_RATE).
 * onReady вызывается после каждого ключа — движок может пользоваться готовыми буферами сразу.
 */
export async function bakeAll(
  Offline: OfflineCtor,
  sampleRate = BAKE_RATE,
  list: readonly SoundDef[] = BAKE_LIST,
  onReady?: (key: string, buffers: AudioBuffer[], done: number, total: number) => void,
  opts: BakeOpts = {},
): Promise<Map<string, AudioBuffer[]>> {
  const out = new Map<string, AudioBuffer[]>();
  const total = list.length;
  let nb: NoiseBank | null = null; // AudioBuffer не привязан к контексту — шумы создаём один раз
  let done = 0;
  for (const it of list) {
    if (opts.cancelled?.()) break;
    const arr: AudioBuffer[] = [];
    for (let v = 0; v < it.bake; v++) {
      if (!nb) {
        const probe = new Offline(1, 1, sampleRate);
        nb = opts.noise && opts.noise.sampleRate === sampleRate ? noiseBankFrom(probe, opts.noise) : makeNoiseBank(probe, 2, BAKE_NOISE_SEED);
      }
      arr.push(await bakeOne(Offline, it, v, nb, sampleRate));
    }
    out.set(it.key, arr);
    onReady?.(it.key, arr, ++done, total);
  }
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
