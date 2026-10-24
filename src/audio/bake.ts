// «Запекание» рецептов каталога в AudioBuffer через OfflineAudioContext (жест пользователя не нужен).
// Шторм из 30 ударов/кадр при живом синтезе ≈ 29 % ядра, из готовых буферов ≈ 8 % (05-audio §12).
// Живыми остаются только звуки с непрерывным параметром и длинными хвостами (см. SoundDef.bake = 0).

import { type SoundDef, SOUND_LIST } from './catalog';
import { type NoiseBank, makeNoiseBank, makeTanhCurve, mulberry32 } from './noise';
import type { S } from './sfx';
import { setSynthRandom } from './synth';

/** Звуки для запекания, по приоритету. */
export const BAKE_LIST: readonly SoundDef[] = SOUND_LIST.filter((d) => d.bake > 0).sort((a, b) => a.prio - b.prio);

/**
 * Обрезка хвоста ниже −54 дБ от пика + фейд 5 мс и потолок пика −1 dBFS
 * (случайный отрезок шума даёт разброс пиков между вариантами до ±2 дБ).
 */
export function trimBuffer(ctx: BaseAudioContext, b: AudioBuffer, thrDb = -54, ceilDb = -1): AudioBuffer {
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
  const ceil = 10 ** (ceilDb / 20);
  if (peak > ceil) for (let i = 0; i < n; i++) o[i]! *= ceil / peak;
  return out;
}

export type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/**
 * Запекает список по приоритету в моно-буферы. 32 кГц: полосы до 16 кГц для SFX достаточно, память −33 %.
 * onReady вызывается после каждого ключа — движок может пользоваться готовыми буферами сразу.
 */
export async function bakeAll(
  Offline: OfflineCtor,
  sampleRate = 32000,
  list: readonly SoundDef[] = BAKE_LIST,
  onReady?: (key: string, buffers: AudioBuffer[], done: number, total: number) => void,
): Promise<Map<string, AudioBuffer[]>> {
  const out = new Map<string, AudioBuffer[]>();
  const total = list.length;
  let nb: NoiseBank | null = null; // AudioBuffer не привязан к контексту — шумы генерируем один раз
  const tanh = makeTanhCurve(3);
  let done = 0;
  for (const it of list) {
    const arr: AudioBuffer[] = [];
    for (let v = 0; v < it.bake; v++) {
      const oc = new Offline(1, Math.ceil(sampleRate * it.dur), sampleRate);
      const seed = 1000 + v * 7919 + hash(it.key);
      nb ??= makeNoiseBank(oc, 2, 4242);
      const rnd = mulberry32(seed);
      setSynthRandom(rnd);
      const s: S = { ctx: oc, out: oc.destination, nb, rnd, tanh };
      try {
        it.fn(s, 0.002, it.param ?? 0);
      } finally {
        setSynthRandom(Math.random);
      }
      arr.push(trimBuffer(oc, await oc.startRendering()));
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
