// «Запекание» рецептов в AudioBuffer через OfflineAudioContext (жест пользователя не нужен).
// Зачем: шторм из 30 ударов/кадр при живом синтезе ≈ 29 % ядра, из готовых буферов ≈ 8 % (замер render/live).
// Живыми остаются только звуки с непрерывным параметром: скрип рогатки (power), фитиль (длительность),
// свист Hal (длина дуги), эмбиент и музыка.

import { type NoiseBank, makeNoiseBank, makeTanhCurve, mulberry32 } from './noise.ts';
import * as F from './sfx.ts';

export type BakeFn = (s: F.S, t: number) => number;
export interface BakeItem {
  key: string;
  variants: number;
  /** Длина буфера рендера, с (потом хвост обрезается по −60 дБ). */
  dur: number;
  fn: BakeFn;
  /** Приоритет: 0 — нужен в первом уровне, 1 — позже, 2 — экраны наград/UI. */
  prio: 0 | 1 | 2;
}

const BIRDS: F.BirdType[] = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];
const PIGS: F.PigType[] = ['small', 'medium', 'large', 'helmet', 'mustache', 'king'];
/** Ярусы интенсивности удара и их «представитель». */
export const TIERS = [0.15, 0.5, 0.9] as const;
export const tierOf = (i: number): 0 | 1 | 2 => (i < 0.3 ? 0 : i < 0.7 ? 1 : 2);

export const BAKE_LIST: BakeItem[] = [
  ...(['wood', 'ice', 'stone'] as const).flatMap((m) =>
    TIERS.map((I, ti): BakeItem => ({
      key: `${m}Hit:${ti}`, variants: 3, dur: m === 'ice' ? 1.6 : 0.7, prio: 0,
      fn: (s, t) => (m === 'wood' ? F.woodHit(s, t, I) : m === 'ice' ? F.iceHit(s, t, I) : F.stoneHit(s, t, I)),
    })),
  ),
  ...[0.3, 0.9].map((I, ti): BakeItem => ({ key: `ground:${ti}`, variants: 2, dur: 0.5, prio: 0, fn: (s, t) => F.groundThud(s, t, I) })),
  { key: 'pigBump', variants: 2, dur: 0.3, prio: 0, fn: (s, t) => F.pigBump(s, t) },
  ...(['wood', 'ice', 'stone'] as const).flatMap((m) =>
    [1, 2, 3].map((st): BakeItem => ({
      key: `${m}Crack:${st}`, variants: 2, dur: 0.5, prio: 0,
      fn: (s, t) => (m === 'wood' ? F.woodCrack(s, t, st) : m === 'ice' ? F.iceCrack(s, t, st) : F.stoneCrack(s, t, st)),
    })),
  ),
  { key: 'woodBreak', variants: 3, dur: 0.8, prio: 0, fn: (s, t) => F.woodBreak(s, t, 1) },
  { key: 'iceShatter', variants: 3, dur: 1.4, prio: 0, fn: (s, t) => F.iceShatter(s, t, 1) },
  { key: 'stoneBreak', variants: 3, dur: 2.1, prio: 0, fn: (s, t) => F.stoneBreak(s, t, 1) },
  { key: 'rubble', variants: 2, dur: 1.4, prio: 1, fn: (s, t) => F.rubble(s, t, 6) },
  ...(['tnt', 'bomb', 'egg'] as const).map((src): BakeItem => ({ key: `boom:${src}`, variants: 2, dur: 3.5, prio: src === 'tnt' ? 0 : 1, fn: (s, t) => F.explosion(s, t, src) })),
  ...BIRDS.flatMap((b): BakeItem[] => [
    { key: `launch:${b}`, variants: 1, dur: 0.8, prio: b === 'red' ? 0 : 1, fn: (s, t) => F.birdLaunch(s, t, b) },
    { key: `select:${b}`, variants: 1, dur: 0.6, prio: b === 'red' ? 0 : 1, fn: (s, t) => F.birdSelect(s, t, b) },
    { key: `hurt:${b}`, variants: 1, dur: 0.3, prio: b === 'red' ? 0 : 1, fn: (s, t) => F.birdHurt(s, t, b) },
  ]),
  ...PIGS.flatMap((p): BakeItem[] => [
    { key: `pigGrunt:${p}`, variants: 1, dur: 0.4, prio: 1, fn: (s, t) => F.pigGrunt(s, t, p) },
    { key: `pigHurt:${p}`, variants: 1, dur: 0.3, prio: 0, fn: (s, t) => F.pigHurt(s, t, p) },
    { key: `pigLaugh:${p}`, variants: 1, dur: 0.9, prio: 1, fn: (s, t) => F.pigLaugh(s, t, p) },
    { key: `pigPop:${p}`, variants: 1, dur: 0.5, prio: 0, fn: (s, t) => F.pigPop(s, t, p, true) },
  ]),
  { key: 'pigPopQuiet', variants: 2, dur: 0.5, prio: 0, fn: (s, t) => F.pigPop(s, t, 'medium', false) },
  { key: 'helmet', variants: 1, dur: 1.6, prio: 1, fn: (s, t) => F.helmetClang(s, t) },
  { key: 'slingGrab', variants: 1, dur: 0.2, prio: 0, fn: (s, t) => F.slingGrab(s, t) },
  { key: 'slingRelease:lo', variants: 1, dur: 0.65, prio: 0, fn: (s, t) => F.slingRelease(s, t, 0.3) },
  { key: 'slingRelease:hi', variants: 1, dur: 0.65, prio: 0, fn: (s, t) => F.slingRelease(s, t, 1) },
  { key: 'slingCancel', variants: 1, dur: 0.5, prio: 0, fn: (s, t) => F.slingCancel(s, t) },
  { key: 'hop', variants: 1, dur: 0.55, prio: 0, fn: (s, t) => F.birdHop(s, t) },
  { key: 'feather', variants: 2, dur: 0.25, prio: 0, fn: (s, t) => F.featherPof(s, t) },
  { key: 'puff', variants: 1, dur: 0.45, prio: 0, fn: (s, t) => F.birdPuff(s, t) },
  { key: 'ab:chuck', variants: 1, dur: 1.0, prio: 1, fn: (s, t) => F.abilityChuck(s, t) },
  { key: 'ab:blues', variants: 1, dur: 0.3, prio: 1, fn: (s, t) => F.abilityBlues(s, t) },
  { key: 'ab:matilda', variants: 1, dur: 0.95, prio: 1, fn: (s, t) => F.abilityMatilda(s, t) },
  { key: 'ab:silver', variants: 1, dur: 1.25, prio: 1, fn: (s, t) => F.abilitySilver(s, t) },
  { key: 'ab:bombSwell', variants: 1, dur: 0.2, prio: 1, fn: (s, t) => F.bombSwell(s, t) },
  // Звёзды, бонус-динь, счётчик, рекорд — НЕ запекаем: длинные колокольные хвосты (3–6 с) дорого держать
  // в памяти, а на экране победы шторма нет — синтезируем вживую.
  ...(['click', 'back', 'toggleOn', 'toggleOff', 'popIn', 'locked', 'whoosh', 'hover'] as F.UiSound[]).map((u): BakeItem => ({ key: `ui:${u}`, variants: 1, dur: 0.65, prio: 2, fn: (s, t) => F.ui(s, t, u) })),
];

/**
 * Обрезка хвоста ниже −54 дБ от пика + фейд 5 мс (под музыкой/эмбиентом хвост ниже −54 дБ не слышен)
 * и потолок пика −1 dBFS (случайный отрезок шума даёт разброс пиков ±2 дБ между вариантами).
 */
export function trim(ctx: BaseAudioContext, b: AudioBuffer, thrDb = -54, ceilDb = -1): AudioBuffer {
  const d = b.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]!));
  const thr = peak * 10 ** (thrDb / 20);
  let last = d.length - 1;
  while (last > 0 && Math.abs(d[last]!) < thr) last--;
  const n = Math.min(d.length, last + Math.floor(b.sampleRate * 0.005));
  const out = ctx.createBuffer(1, n, b.sampleRate);
  const o = out.getChannelData(0);
  o.set(d.subarray(0, n));
  const fade = Math.floor(b.sampleRate * 0.005);
  for (let i = 0; i < fade && i < n; i++) o[n - 1 - i]! *= i / fade;
  const ceil = 10 ** (ceilDb / 20);
  if (peak > ceil) for (let i = 0; i < n; i++) o[i]! *= ceil / peak;
  return out;
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

/**
 * Запекает список по приоритету. sampleRate 32000: полоса до 16 кГц достаточна для SFX, память −33 %.
 * onProgress — для «ленивой» загрузки: начинать уровень можно после prio 0.
 */
export async function bakeAll(
  Offline: OfflineCtor,
  sampleRate = 32000,
  list: BakeItem[] = BAKE_LIST,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, AudioBuffer[]>> {
  const out = new Map<string, AudioBuffer[]>();
  const sorted = [...list].sort((a, b) => a.prio - b.prio);
  const total = sorted.reduce((n, it) => n + it.variants, 0);
  let done = 0;
  let nb: NoiseBank | null = null; // AudioBuffer не привязан к контексту — шумы генерируем один раз
  const tanh = makeTanhCurve(3);
  for (const it of sorted) {
    const arr: AudioBuffer[] = [];
    for (let v = 0; v < it.variants; v++) {
      const oc = new Offline(1, Math.ceil(sampleRate * it.dur), sampleRate);
      const seed = 1000 + v * 7919 + it.key.length * 31;
      nb ??= makeNoiseBank(oc, 2, 4242);
      const s: F.S = { ctx: oc, out: oc.destination, nb, rnd: mulberry32(seed), tanh };
      it.fn(s, 0.002);
      arr.push(trim(oc, await oc.startRendering()));
      onProgress?.(++done, total);
    }
    out.set(it.key, arr);
  }
  return out;
}
