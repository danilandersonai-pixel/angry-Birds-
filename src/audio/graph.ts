// Граф шин микшера (05-audio §2.1). Один и тот же граф строится в живом AudioContext (движок)
// и в OfflineAudioContext (рендер для проверки) — уровни на выходе совпадают.
//
//  голоса ─► sfx (0.8) ─┐            ┌──────────────────────────────┐
//  голоса ─► ui  (0.7) ─┤            │ send ─► Convolver(IR 1.1 с) ─► 0.5 ─┤
//  музыка ─► music (0.64) ─┬─► duck ─┤                                     ▼
//  эмбиент ─► amb  (0.35) ─┘         └────────────► master (0.9) ─► Compressor ─► выход

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

export interface MixGraph {
  readonly ctx: BaseAudioContext;
  readonly master: GainNode;
  readonly comp: DynamicsCompressorNode;
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
}

export function createMixGraph(ctx: BaseAudioContext, out: AudioNode = ctx.destination, compOpts: Partial<CompParams> = {}): MixGraph {
  const cp = { ...COMP_DEFAULT, ...compOpts };
  const gain = (v: number, dest: AudioNode): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  };
  // Компрессор склеивает микс и не даёт клиппинга при цепочке взрывов.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = cp.threshold;
  comp.knee.value = cp.knee;
  comp.ratio.value = cp.ratio;
  comp.attack.value = cp.attack;
  comp.release.value = cp.release;
  comp.connect(out);
  const master = gain(BUS_LEVEL.master, comp);
  const sfx = gain(BUS_LEVEL.sfx, master);
  const ui = gain(BUS_LEVEL.ui, master);
  const duck = gain(1, master);
  const music = gain(BUS_LEVEL.music, duck);
  const amb = gain(BUS_LEVEL.amb, duck);
  const rev = ctx.createConvolver();
  rev.buffer = makeReverbIR(ctx);
  const send = ctx.createGain();
  send.connect(rev).connect(gain(BUS_LEVEL.reverbReturn, master));
  return {
    ctx, master, comp, sfx, ui, music, amb, duck, send,
    busFor: (cat: Cat) => (cat === 'ui' || cat === 'reward' ? ui : sfx),
  };
}
