// Музыка: инструменты, оригинальная полька «Пернатый переполох» (меню), джинглы, lookahead-планировщик.
// Мелодия написана с нуля для проекта (D гармонический минор, 2/4) — это НЕ тема Angry Birds.

import type { NoiseBank } from './noise.ts';
import { type Ctx, midiHz, playNoiseBurst, playTone } from './synth.ts';

// ───────────────────────────── Инструменты ─────────────────────────────

export interface Inst {
  ctx: Ctx;
  nb: NoiseBank;
}

/**
 * Постоянная «канальная линейка» аккордеона: фильтры, тремоло мехов и вибрато общие для всех нот
 * (нота = 3 осциллятора + 3 VCA; без общей линейки было бы 12+ узлов на ноту).
 */
export interface AccStrip {
  input: AudioNode;
  /** Выход общего вибрато (центы) — подключается к detune каждой ноты. */
  vib: AudioNode;
  lfos: OscillatorNode[];
}
export function makeAccordionStrip(ctx: Ctx, out: AudioNode): AccStrip {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 180;
  hp.Q.value = -3;
  const nasal = ctx.createBiquadFilter();
  nasal.type = 'peaking';
  nasal.frequency.value = 1100;
  nasal.Q.value = 1;
  nasal.gain.value = 5;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  lp.Q.value = -3;
  const trem = ctx.createGain();
  trem.gain.value = 0.92;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const depth = ctx.createGain();
  depth.gain.value = 0.08;
  lfo.connect(depth).connect(trem.gain);
  hp.connect(nasal).connect(lp).connect(trem).connect(out);
  const vibLfo = ctx.createOscillator();
  vibLfo.frequency.value = 5.5;
  const vib = ctx.createGain();
  vib.gain.value = 6; // ±6 центов
  vibLfo.connect(vib);
  return { input: hp, vib, lfos: [lfo, vibLfo] };
}

/**
 * Нота аккордеона: 3 «язычка» пилы с расстройкой 0/+9/−9 центов (мюзет),
 * на акцентах — подъезд снизу (scoop) от −60 центов за 25 мс; общее вибрато 5.5 Гц ±6 центов из линейки.
 */
export function accordionNote(c: Inst, strip: AccStrip, t: number, midi: number, durS: number, vel = 1, scoop = false): number {
  let end = t;
  for (const det of [0, 9, -9]) {
    const f = midiHz(midi) * 2 ** (det / 1200);
    end = Math.max(end, playTone(c.ctx, strip.input, t, {
      wave: 'sawtooth', f: scoop ? [[0, f * 0.966], [25, f]] : f, gain: 0.14 * vel,
      env: { a: 12, d: 80, s: 0.7, r: 70 }, holdMs: durS * 1000 * 0.92, detuneMod: strip.vib,
    }));
  }
  return end;
}

/** Туба/бас: треугольник + пила (обертона, чтобы бас слышно на телефоне), lowpass 900 Гц. */
export function tubaNote(c: Inst, out: AudioNode, t: number, midi: number, durS: number, vel = 1): number {
  const f = midiHz(midi);
  return Math.max(
    playTone(c.ctx, out, t, { wave: 'triangle', f: [[0, f * 0.983], [30, f]], gain: 0.23 * vel, env: { a: 6, d: 140, s: 0.5, r: 60 }, holdMs: durS * 850 }),
    playTone(c.ctx, out, t, { wave: 'sawtooth', f: [[0, f * 0.983], [30, f]], gain: 0.065 * vel, env: { a: 6, d: 140, s: 0.5, r: 60 }, holdMs: durS * 850, filt: { type: 'lowpass', f: 900, q: 0 } }),
  );
}

/** «Па» — аккордовый стаб (левая рука аккордеона): пульс (square) ×N нот, lowpass 2 кГц, 110 мс. */
export function stab(c: Inst, out: AudioNode, t: number, notes: ReadonlyArray<number>, vel = 1): number {
  let end = t;
  for (const m of notes) {
    end = Math.max(end, playTone(c.ctx, out, t, { wave: 'square', f: midiHz(m), gain: 0.11 * vel, a: 3, tau: 45, filt: { type: 'lowpass', f: 2000 } }));
  }
  return end;
}

export function kick(c: Inst, out: AudioNode, t: number, vel = 1): number {
  return Math.max(
    playTone(c.ctx, out, t, { wave: 'sine', f: [[0, 140], [90, 48]], gain: 0.33 * vel, a: 1, tau: 70 }),
    playNoiseBurst(c.ctx, out, t, { buf: c.nb.white, gain: 0.09 * vel, a: 0.2, tau: 1.5, filts: [{ type: 'lowpass', f: 3000 }] }),
  );
}
export function snare(c: Inst, out: AudioNode, t: number, vel = 1): number {
  return Math.max(
    playNoiseBurst(c.ctx, out, t, { buf: c.nb.white, gain: 0.18 * vel, a: 0.5, tau: 45, filts: [{ type: 'bandpass', f: 2000, q: 0.9 }] }),
    playTone(c.ctx, out, t, { wave: 'triangle', f: [[0, 230], [30, 190]], gain: 0.15 * vel, a: 0.5, tau: 30 }),
  );
}
export const hat = (c: Inst, out: AudioNode, t: number, vel = 1): number =>
  playNoiseBurst(c.ctx, out, t, { buf: c.nb.white, gain: 0.07 * vel, a: 0.3, tau: 12, filts: [{ type: 'highpass', f: 7500 }] });
export function tambourine(c: Inst, out: AudioNode, t: number, vel = 1): number {
  let end = t;
  for (let j = 0; j < 3; j++) {
    end = Math.max(end, playNoiseBurst(c.ctx, out, t + j * 0.008, { buf: c.nb.white, gain: 0.045 * vel, a: 0.3, tau: 30, filts: [{ type: 'bandpass', f: 9000, q: 2 }] }));
  }
  return end;
}
export const crash = (c: Inst, out: AudioNode, t: number, vel = 1): number =>
  playNoiseBurst(c.ctx, out, t, { buf: c.nb.white, gain: 0.12 * vel, a: 1, tau: 600, filts: [{ type: 'highpass', f: 4000 }] });

// ───────────────────────────── Данные песни ─────────────────────────────

/** [midi, длительность в 16-х, вел.] ; midi = 0 — пауза. */
export type Note = readonly [number, number, number?];
export type ChordId = 'Dm' | 'Gm' | 'A7' | 'F' | 'C7' | 'D';
export type DrumPat = 'polka' | 'polkaTamb' | 'fill' | 'none';
export interface Bar {
  chord: ChordId;
  lead: ReadonlyArray<Note>;
  drums: DrumPat;
}
export interface Song {
  bpm: number;
  /** 16-х в такте (2/4 → 8). */
  barSteps: number;
  intro: ReadonlyArray<Bar>;
  loop: ReadonlyArray<Bar>;
}

/** Бас «умпа»: [доля 1, доля 2] (корень, квинта). */
export const BASS: Record<ChordId, readonly [number, number]> = {
  Dm: [50, 45], Gm: [43, 50], A7: [45, 52], F: [41, 48], C7: [48, 43], D: [50, 45],
};
/** Голоса аккорда для «па» (4-я октава). */
export const VOICING: Record<ChordId, ReadonlyArray<number>> = {
  Dm: [62, 65, 69], Gm: [62, 67, 70], A7: [61, 64, 67], F: [60, 65, 69], C7: [60, 64, 70], D: [62, 66, 69],
};

const R = 0; // пауза
// Раздел A (8 тактов) — Dm | Dm | A7 | Dm | Gm | Dm | A7 | Dm
const A: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['Dm', [[69, 2], [74, 1], [76, 1], [77, 2, 1.1], [76, 2]]],
  ['Dm', [[74, 2], [69, 2], [65, 2], [69, 2]]],
  ['A7', [[70, 1], [73, 1], [76, 2, 1.1], [79, 2], [76, 1], [73, 1]]],
  ['Dm', [[74, 4, 1.1], [R, 2], [69, 2]]],
  ['Gm', [[70, 2], [74, 1], [79, 1], [79, 2, 1.1], [77, 2]]],
  ['Dm', [[77, 1], [76, 1], [74, 1], [76, 1], [77, 2], [81, 2, 1.1]]],
  ['A7', [[79, 2], [77, 1], [76, 1], [73, 2], [76, 2]]],
  ['Dm', [[74, 2], [69, 2], [74, 4, 1.1]]],
];
// Окончание A2 (последние 2 такта)
const A2_END: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['A7', [[76, 1], [77, 1], [76, 1], [74, 1], [73, 2], [69, 2]]],
  ['Dm', [[74, 4, 1.1], [R, 4]]],
];
// Раздел B (8 тактов) — F | C7 | F | Dm | Gm | Dm | A7 | Dm
const B: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['F', [[72, 1], [72, 1], [77, 2, 1.1], [72, 1], [72, 1], [81, 2, 1.1]]],
  ['C7', [[79, 2], [76, 2], [72, 2], [70, 2]]],
  ['F', [[69, 1], [72, 1], [77, 1], [81, 1], [79, 2, 1.1], [77, 2]]],
  ['Dm', [[74, 4, 1.1], [77, 2], [74, 2]]],
  ['Gm', [[74, 1], [74, 1], [79, 2, 1.1], [74, 1], [74, 1], [82, 2, 1.1]]],
  ['Dm', [[81, 2], [77, 2], [74, 2], [77, 2]]],
  ['A7', [[76, 1], [77, 1], [79, 1], [81, 1], [79, 1], [77, 1], [76, 1], [73, 1]]],
  ['Dm', [[74, 4, 1.1], [R, 4]]],
];
// Окончание B2 — разворот на A7, ведущий обратно в A
const B2_END: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['A7', [[76, 1], [77, 1], [79, 1], [81, 1], [82, 2, 1.1], [81, 2]]],
  ['A7', [[79, 2], [76, 2], [73, 2], [69, 2]]],
];

const bars = (src: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]>, drums: DrumPat): Bar[] =>
  src.map(([chord, lead]) => ({ chord, lead, drums }));
const withFill = (b: Bar[]): Bar[] => b.map((x, i) => (i === b.length - 1 ? { ...x, drums: 'fill' as const } : x));

export const MENU_SONG: Song = {
  bpm: 144,
  barSteps: 8,
  intro: [
    { chord: 'Dm', lead: [[R, 8]], drums: 'polka' },
    { chord: 'A7', lead: [[R, 8]], drums: 'fill' },
  ],
  loop: [
    ...bars(A, 'polka'),
    ...withFill([...bars(A.slice(0, 6), 'polka'), ...bars(A2_END, 'polka')]),
    ...bars(B, 'polkaTamb'),
    ...withFill([...bars(B.slice(0, 6), 'polkaTamb'), ...bars(B2_END, 'polkaTamb')]),
  ],
};

/** Событие секвенсора, уже в шагах (16-х). */
export interface SeqEv {
  step: number;
  kind: 'lead' | 'bass' | 'stab' | 'kick' | 'snare' | 'hat' | 'tamb' | 'crash';
  midi?: number;
  notes?: ReadonlyArray<number>;
  len?: number;
  vel: number;
  scoop?: boolean;
}

/** Компиляция тактов в события по шагам. Проверка: сумма длительностей мелодии в такте = barSteps. */
export function compileBars(barsIn: ReadonlyArray<Bar>, barSteps: number): SeqEv[] {
  const ev: SeqEv[] = [];
  barsIn.forEach((bar, bi) => {
    const s0 = bi * barSteps;
    let pos = 0;
    for (const [m, len, vel] of bar.lead) {
      if (m > 0) ev.push({ step: s0 + pos, kind: 'lead', midi: m, len, vel: vel ?? 1, scoop: (vel ?? 1) > 1 && len >= 2 });
      pos += len;
    }
    if (pos !== barSteps) throw new Error(`bar ${bi}: lead length ${pos} ≠ ${barSteps}`);
    const [r, f] = BASS[bar.chord];
    ev.push({ step: s0, kind: 'bass', midi: r, len: 2, vel: 1 }, { step: s0 + 4, kind: 'bass', midi: f, len: 2, vel: 0.9 });
    ev.push({ step: s0 + 2, kind: 'stab', notes: VOICING[bar.chord], vel: 1 }, { step: s0 + 6, kind: 'stab', notes: VOICING[bar.chord], vel: 0.9 });
    if (bar.drums !== 'none') {
      ev.push({ step: s0, kind: 'kick', vel: 1 }, { step: s0 + 4, kind: 'kick', vel: 0.85 });
      for (let k = 0; k < 8; k++) ev.push({ step: s0 + k, kind: 'hat', vel: k % 4 === 2 ? 1 : 0.5 });
      if (bar.drums === 'fill') for (const k of [4, 5, 6, 7]) ev.push({ step: s0 + k, kind: 'snare', vel: 0.5 + 0.15 * (k - 4) });
      else ev.push({ step: s0 + 2, kind: 'snare', vel: 0.6 }, { step: s0 + 6, kind: 'snare', vel: 0.6 });
      if (bar.drums === 'polkaTamb') for (const k of [1, 3, 5, 7]) ev.push({ step: s0 + k, kind: 'tamb', vel: 1 });
    }
  });
  return ev.sort((a, b) => a.step - b.step);
}

/** Воспроизводит одно событие секвенсора в момент t. */
export function playEv(c: Inst, buses: { lead: AccStrip; bass: AudioNode; stab: AudioNode; drums: AudioNode }, e: SeqEv, t: number, stepS: number): number {
  switch (e.kind) {
    case 'lead': return accordionNote(c, buses.lead, t, e.midi!, e.len! * stepS, e.vel, e.scoop);
    case 'bass': return tubaNote(c, buses.bass, t, e.midi!, e.len! * stepS, e.vel);
    case 'stab': return stab(c, buses.stab, t, e.notes!, e.vel);
    case 'kick': return kick(c, buses.drums, t, e.vel);
    case 'snare': return snare(c, buses.drums, t, e.vel);
    case 'hat': return hat(c, buses.drums, t, e.vel);
    case 'tamb': return tambourine(c, buses.drums, t, e.vel);
    case 'crash': return crash(c, buses.drums, t, e.vel);
  }
}

// ───────────────────────────── Джинглы ─────────────────────────────

export interface Jingle {
  bpm: number;
  events: SeqEv[];
  lengthSteps: number;
}

/** Победа (150 BPM, 1.6 с + хвост): D5 F#5 A5 D6. B5 C#6 D6~ */
export const VICTORY: Jingle = {
  bpm: 150,
  lengthSteps: 16,
  events: [
    ...([[74, 1], [78, 1], [81, 1], [86, 3], [83, 1], [85, 1], [86, 8]] as const).reduce<{ s: number; ev: SeqEv[] }>(
      (acc, [m, len]) => ({ s: acc.s + len, ev: [...acc.ev, { step: acc.s, kind: 'lead', midi: m, len, vel: 1.1, scoop: len >= 3 }] }),
      { s: 0, ev: [] },
    ).ev,
    { step: 0, kind: 'bass', midi: 50, len: 2, vel: 1 },
    { step: 4, kind: 'bass', midi: 45, len: 2, vel: 1 },
    { step: 8, kind: 'bass', midi: 50, len: 8, vel: 1.1 },
    { step: 2, kind: 'stab', notes: [62, 66, 69], vel: 1 },
    { step: 6, kind: 'stab', notes: [62, 66, 69], vel: 1 },
    { step: 8, kind: 'stab', notes: [62, 66, 69, 74], vel: 1.3 },
    { step: 0, kind: 'kick', vel: 1 }, { step: 4, kind: 'kick', vel: 1 }, { step: 8, kind: 'kick', vel: 1.1 },
    { step: 6, kind: 'snare', vel: 0.6 }, { step: 6.5, kind: 'snare', vel: 0.7 }, { step: 7, kind: 'snare', vel: 0.8 }, { step: 7.5, kind: 'snare', vel: 0.9 },
    { step: 8, kind: 'crash', vel: 1 },
  ],
};

/** Поражение (100 BPM, 16-я = 0.15 с, 2.4 с): A4 F4 D4 C#4 D4~ с «опусканием». */
export const DEFEAT: Jingle = {
  bpm: 100,
  lengthSteps: 16,
  events: [
    { step: 0, kind: 'lead', midi: 69, len: 2, vel: 0.9 },
    { step: 2, kind: 'lead', midi: 65, len: 2, vel: 0.9 },
    { step: 4, kind: 'lead', midi: 62, len: 2, vel: 0.9 },
    { step: 6, kind: 'lead', midi: 61, len: 3, vel: 0.9 },
    { step: 9, kind: 'lead', midi: 62, len: 7, vel: 1 },
    { step: 0, kind: 'bass', midi: 50, len: 4, vel: 0.8 },
    { step: 4, kind: 'bass', midi: 45, len: 5, vel: 0.8 },
    { step: 9, kind: 'bass', midi: 38, len: 7, vel: 0.9 },
    { step: 9, kind: 'stab', notes: [62, 65, 69], vel: 0.8 },
  ],
};

// ───────────────────────────── Lookahead-планировщик ─────────────────────────────

export const LOOKAHEAD_MS = 25;
export const SCHEDULE_AHEAD_S = 0.12;

/** Секвенсор по схеме «A Tale of Two Clocks»: setTimeout каждые 25 мс планирует события на 120 мс вперёд. */
export class Sequencer {
  private readonly byStep: SeqEv[][];
  private readonly introSteps: number;
  private readonly totalSteps: number;
  private readonly stepS: number;
  private step = 0;
  private nextT = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly ctx: BaseAudioContext;
  private readonly play: (e: SeqEv, t: number, stepS: number) => void;

  constructor(ctx: BaseAudioContext, song: Song, play: (e: SeqEv, t: number, stepS: number) => void) {
    this.ctx = ctx;
    this.play = play;
    const all = compileBars([...song.intro, ...song.loop], song.barSteps);
    this.introSteps = song.intro.length * song.barSteps;
    this.totalSteps = (song.intro.length + song.loop.length) * song.barSteps;
    this.byStep = Array.from({ length: this.totalSteps }, () => []);
    for (const e of all) this.byStep[Math.floor(e.step)]!.push(e);
    this.stepS = 60 / song.bpm / 4;
  }

  start(at = this.ctx.currentTime + 0.05): void {
    this.stop();
    this.step = 0;
    this.nextT = at;
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly tick = (): void => {
    const now = this.ctx.currentTime;
    // Вкладка «спала», а контекст шёл: не догоняем пачкой, а пересинхронизируемся.
    if (this.nextT < now - 0.05) this.nextT = now + 0.02;
    while (this.nextT < now + SCHEDULE_AHEAD_S) {
      for (const e of this.byStep[this.step]!) this.play(e, this.nextT + (e.step % 1) * this.stepS, this.stepS);
      this.nextT += this.stepS;
      this.step = this.step + 1 >= this.totalSteps ? this.introSteps : this.step + 1;
    }
    this.timer = setTimeout(this.tick, LOOKAHEAD_MS);
  };
}
