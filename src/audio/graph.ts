// Граф шин микшера (05-audio §2.1). Один и тот же граф строится в живом AudioContext (движок)
// и в OfflineAudioContext (рендер для проверки) — уровни на выходе совпадают.
//
//  голоса ─► sfx (0.8) ─┐            ┌──────────────────────────────┐
//  голоса ─► ui  (0.7) ─┤            │ send ─► Convolver(IR 1.1 с) ─► 0.5 ─┤
//  музыка ─► music (0.64) ─┬─► duck ─┤                                     ▼
//  эмбиент ─► amb  (0.35) ─┘         └────────────► master (0.9) ─► Compressor ─► ×0.5 ─► мягкий клиппер ─► выход
//
// Компрессор (ratio 4) «склеивает» микс, но не ограничивает: цепь из трёх TNT + обрушение давала −1.0 dBFS.
// Пики держит мягкий клиппер (WaveShaper): до −6 dBFS сигнал проходит без изменений, выше плавно (tanh)
// подходит к потолку −1.9 dBFS. В отличие от второго DynamicsCompressor (лимитера) он не добавляет задержки:
// у компрессора Chromium упреждение 6 мс, с лимитером было 12 мс на весь звук, теперь 6 мс.
// Импульсный отклик реверба можно передать позже (setReverbIR) — его расчёт не должен попадать в обработчик жеста.

import type { Cat } from './mix';
import { makeReverbIR } from './noise';

export const BUS_LEVEL = {
  master: 0.9,
  sfx: 0.8,
  ui: 0.7,
  music: 0.64,
  amb: 0.35,
  reverbReturn: 0.5,
} as const;

/** Параметры компрессора на master. */
export interface CompParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}
export const COMP_DEFAULT: Readonly<CompParams> = { threshold: -16, knee: 12, ratio: 4, attack: 0.004, release: 0.18 };
/** Мягкий клиппер: линейно до knee, выше — tanh к потолку ceil; range — запас входа (±2 = +6 dBFS). */
export const CLIP = { knee: 0.5, ceil: 0.8, range: 2 } as const;

/** Передаточная функция мягкого клиппера (непрерывна вместе с производной в точке knee). */
export function softClip(x: number, knee: number = CLIP.knee, ceil: number = CLIP.ceil): number {
  const a = Math.abs(x);
  if (a <= knee) return x;
  const room = ceil - knee;
  return Math.sign(x) * (knee + room * Math.tanh((a - knee) / room));
}

/** Кривая WaveShaper для входа, заранее ослабленного в range раз (нечётный размер — точный ноль в центре). */
export function makeSoftClipCurve(size = 4097, range: number = CLIP.range): Float32Array<ArrayBuffer> {
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) c[i] = softClip(range * ((2 * i) / (size - 1) - 1));
  return c;
}

export interface MixGraph {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly comp: DynamicsCompressorNode;
  /** Мягкий клиппер на выходе (вход ослаблен в CLIP.range раз узлом перед ним). */
  readonly clip: WaveShaperNode;
  readonly reverb: ConvolverNode;
  readonly sfx: GainNode;
  readonly ui: GainNode;
  readonly music: GainNode;
  readonly amb: GainNode;
  /** Дакинг музыки и эмбиента (взрывы). */
  readonly duck: GainNode;
  /** Посыл в реверб. */
  readonly send: GainNode;
  /** Шина для категории голоса. */
  busFor(cat: Cat): GainNode;
  /** Поставить импульсный отклик реверба (если граф создан без него). Повторный вызов игнорируется. */
  setReverbIR(ir: AudioBuffer): void;
}

export interface MixGraphOpts {
  /** IR реверба; null — без IR (реверб молчит до setReverbIR); не задан — рассчитать сразу. */
  reverbIR?: AudioBuffer | null;
}

export function createMixGraph(
  ctx: BaseAudioContext,
  out: AudioNode = ctx.destination,
  compOpts: Partial<CompParams> = {},
  opts: MixGraphOpts = {},
): MixGraph {
  const cp = { ...COMP_DEFAULT, ...compOpts };
  const gain = (v: number, dest: AudioNode): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  };
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = cp.threshold;
  comp.knee.value = cp.knee;
  comp.ratio.value = cp.ratio;
  comp.attack.value = cp.attack;
  comp.release.value = cp.release;
  // Компрессор склеивает микс; мягкий клиппер без задержки не даёт пикам цепочки взрывов подняться выше −1.9 dBFS.
  const clip = ctx.createWaveShaper();
  clip.curve = makeSoftClipCurve();
  clip.oversample = 'none';
  clip.connect(out);
  comp.connect(gain(1 / CLIP.range, clip));
  const master = gain(BUS_LEVEL.master, comp);
  const sfx = gain(BUS_LEVEL.sfx, master);
  const ui = gain(BUS_LEVEL.ui, master);
  const duck = gain(1, master);
  const music = gain(BUS_LEVEL.music, duck);
  const amb = gain(BUS_LEVEL.amb, duck);
  const reverb = ctx.createConvolver();
  let irSet = false;
  const setReverbIR = (ir: AudioBuffer): void => {
    if (irSet) return;
    irSet = true;
    reverb.buffer = ir;
  };
  if (opts.reverbIR !== null) setReverbIR(opts.reverbIR ?? makeReverbIR(ctx));
  const send = ctx.createGain();
  send.connect(reverb).connect(gain(BUS_LEVEL.reverbReturn, master));
  return {
    ctx, master, comp, clip, reverb, sfx, ui, music, amb, duck, send, setReverbIR,
    busFor: (cat: Cat) => (cat === 'ui' || cat === 'reward' ? ui : cat === 'jingle' ? music : sfx),
  };
}
