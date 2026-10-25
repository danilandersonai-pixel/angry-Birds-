// Музыка: инструменты, оригинальная полька «Пернатый переполох» (меню), спокойный эмбиент
// «Тихая лужайка» (уровень), джинглы победы/поражения и lookahead-планировщик.
// Обе мелодии написаны с нуля для проекта — это НЕ тема Angry Birds.
// Все функции принимают BaseAudioContext и узел назначения: живой звук и офлайн-рендер идут одним путём.

import type { ThemeId } from '../core/types';
import type { NoiseBank } from './noise';
import { type Ctx, midiHz, playNoiseBurst, playTone } from './synth';

// ───────────────────────────── Инструменты ─────────────────────────────

export interface Inst {
  ctx: Ctx;
  nb: NoiseBank;
}

/**
 * Общая «канальная линейка» аккордеона: фильтры, тремоло мехов и вибрато одни на все ноты
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

/** Нота аккордеона: 3 «язычка» пилы 0/+9/−9 центов (мюзет); на акцентах — подъезд снизу за 25 мс. */
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

/** Туба/бас: треугольник + пила (обертоны, чтобы бас был слышен в динамике телефона), lowpass 900 Гц. */
export function tubaNote(c: Inst, out: AudioNode, t: number, midi: number, durS: number, vel = 1): number {
  const f = midiHz(midi);
  return Math.max(
    playTone(c.ctx, out, t, { wave: 'triangle', f: [[0, f * 0.983], [30, f]], gain: 0.23 * vel, env: { a: 6, d: 140, s: 0.5, r: 60 }, holdMs: durS * 850 }),
    playTone(c.ctx, out, t, { wave: 'sawtooth', f: [[0, f * 0.983], [30, f]], gain: 0.065 * vel, env: { a: 6, d: 140, s: 0.5, r: 60 }, holdMs: durS * 850, filt: { type: 'lowpass', f: 900, q: 0 } }),
  );
}

/** «Па» — аккордовый стаб левой руки аккордеона: пульс ×N нот, lowpass 2 кГц, ≈110 мс. */
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

// ── инструменты эмбиента ──

/** Мягкий пэд: на ноту 2 треугольника ±7 центов, медленная атака и долгий спад. */
export function padChord(c: Inst, out: AudioNode, t: number, notes: ReadonlyArray<number>, durS: number, vel = 1): number {
  let end = t;
  for (const m of notes) {
    for (const det of [-7, 7]) {
      end = Math.max(end, playTone(c.ctx, out, t, {
        wave: 'triangle', f: midiHz(m), detune: det, gain: 0.05 * vel,
        env: { a: 900, d: 900, s: 0.75, r: 1400 }, holdMs: durS * 1000,
      }));
    }
  }
  return end;
}

/** «Калимба/маримба»: основной тон τ 380 мс + 4-я мода (×3.98) τ 60 мс + мягкий стук колотушки. */
export function pluck(c: Inst, out: AudioNode, t: number, midi: number, vel = 1): number {
  const f = midiHz(midi);
  return Math.max(
    playTone(c.ctx, out, t, { wave: 'sine', f, gain: 0.2 * vel, a: 2, tau: 380 }),
    playTone(c.ctx, out, t, { wave: 'sine', f: f * 3.98, gain: 0.05 * vel, a: 1, tau: 60 }),
    playNoiseBurst(c.ctx, out, t, { buf: c.nb.white, gain: 0.03 * vel, a: 0.5, tau: 3, filts: [{ type: 'bandpass', f: 2500, q: 1.5 }] }),
  );
}

/** Мягкий бас эмбиента: синус + немного треугольника (слышно на телефоне). */
export function softBass(c: Inst, out: AudioNode, t: number, midi: number, durS: number, vel = 1): number {
  const f = midiHz(midi);
  const env = { a: 30, d: 300, s: 0.6, r: 250 };
  return Math.max(
    playTone(c.ctx, out, t, { wave: 'sine', f, gain: 0.2 * vel, env, holdMs: durS * 1000 }),
    playTone(c.ctx, out, t, { wave: 'triangle', f: f * 2, gain: 0.035 * vel, env, holdMs: durS * 1000 }),
  );
}

/** Шейкер: короткий высокий шорох. */
export const shaker = (c: Inst, out: AudioNode, t: number, vel = 1): number =>
  playNoiseBurst(c.ctx, out, t, { buf: c.nb.white, gain: 0.035 * vel, a: 4, tau: 16, filts: [{ type: 'highpass', f: 6000 }, { type: 'lowpass', f: 11000 }] });

// ───────────────────────────── Данные песен ─────────────────────────────

/** [midi, длительность в 16-х, вел.]; midi = 0 — пауза. */
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

export type SeqKind = 'lead' | 'bass' | 'stab' | 'kick' | 'snare' | 'hat' | 'tamb' | 'crash' | 'pad' | 'pluck' | 'sub' | 'shaker';
/** Событие секвенсора, уже в шагах (16-х); дробный step — сдвиг внутри шага (дробь 32-ми). */
export interface SeqEv {
  step: number;
  kind: SeqKind;
  midi?: number;
  notes?: ReadonlyArray<number>;
  len?: number;
  vel: number;
  scoop?: boolean;
}

/** Готовая к проигрыванию песня: события по шагам, вступление звучит один раз, дальше — петля. */
export interface CompiledSong {
  name: string;
  bpm: number;
  barSteps: number;
  /** Длина шага (16-я), с. */
  stepS: number;
  introSteps: number;
  totalSteps: number;
  events: ReadonlyArray<SeqEv>;
}

/** Бас «умпа»: [доля 1, доля 2] (корень, квинта). */
export const BASS: Record<ChordId, readonly [number, number]> = {
  Dm: [50, 45], Gm: [43, 50], A7: [45, 52], F: [41, 48], C7: [48, 43], D: [50, 45],
};
/** Голоса аккорда для «па» (4-я октава). */
export const VOICING: Record<ChordId, ReadonlyArray<number>> = {
  Dm: [62, 65, 69], Gm: [62, 67, 70], A7: [61, 64, 67], F: [60, 65, 69], C7: [60, 64, 70], D: [62, 66, 69],
};

const P = 0; // пауза
// Полька «Пернатый переполох»: ре гармонический минор, 2/4, 144 BPM.
// Раздел A (8 тактов): Dm | Dm | A7 | Dm | Gm | Dm | A7 | Dm
const A: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['Dm', [[69, 2], [74, 1], [76, 1], [77, 2, 1.1], [76, 2]]],
  ['Dm', [[74, 2], [69, 2], [65, 2], [69, 2]]],
  ['A7', [[70, 1], [73, 1], [76, 2, 1.1], [79, 2], [76, 1], [73, 1]]],
  ['Dm', [[74, 4, 1.1], [P, 2], [69, 2]]],
  ['Gm', [[70, 2], [74, 1], [79, 1], [79, 2, 1.1], [77, 2]]],
  ['Dm', [[77, 1], [76, 1], [74, 1], [76, 1], [77, 2], [81, 2, 1.1]]],
  ['A7', [[79, 2], [77, 1], [76, 1], [73, 2], [76, 2]]],
  ['Dm', [[74, 2], [69, 2], [74, 4, 1.1]]],
];
// Окончание A′ (последние 2 такта) — с брейком ударных.
const A2_END: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['A7', [[76, 1], [77, 1], [76, 1], [74, 1], [73, 2], [69, 2]]],
  ['Dm', [[74, 4, 1.1], [P, 4]]],
];
// Раздел B (8 тактов, параллельный фа мажор): F | C7 | F | Dm | Gm | Dm | A7 | Dm
const B: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['F', [[72, 1], [72, 1], [77, 2, 1.1], [72, 1], [72, 1], [81, 2, 1.1]]],
  ['C7', [[79, 2], [76, 2], [72, 2], [70, 2]]],
  ['F', [[69, 1], [72, 1], [77, 1], [81, 1], [79, 2, 1.1], [77, 2]]],
  ['Dm', [[74, 4, 1.1], [77, 2], [74, 2]]],
  ['Gm', [[74, 1], [74, 1], [79, 2, 1.1], [74, 1], [74, 1], [82, 2, 1.1]]],
  ['Dm', [[81, 2], [77, 2], [74, 2], [77, 2]]],
  ['A7', [[76, 1], [77, 1], [79, 1], [81, 1], [79, 1], [77, 1], [76, 1], [73, 1]]],
  ['Dm', [[74, 4, 1.1], [P, 4]]],
];
// Окончание B′ — разворот на A7, ведущий обратно в A.
const B2_END: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]> = [
  ['A7', [[76, 1], [77, 1], [79, 1], [81, 1], [82, 2, 1.1], [81, 2]]],
  ['A7', [[79, 2], [76, 2], [73, 2], [69, 2]]],
];

const bars = (src: ReadonlyArray<readonly [ChordId, ReadonlyArray<Note>]>, drums: DrumPat): Bar[] =>
  src.map(([chord, lead]) => ({ chord, lead, drums }));
const withFill = (b: Bar[]): Bar[] => b.map((x, i) => (i === b.length - 1 ? { ...x, drums: 'fill' as const } : x));

/** Полька меню: 2 такта вступления + петля 32 такта (A A′ B B′), 26.7 с. */
export const MENU_SONG: Song = {
  bpm: 144,
  barSteps: 8,
  intro: [
    { chord: 'Dm', lead: [[P, 8]], drums: 'polka' },
    { chord: 'A7', lead: [[P, 8]], drums: 'fill' },
  ],
  loop: [
    ...bars(A, 'polka'),
    ...withFill([...bars(A.slice(0, 6), 'polka'), ...bars(A2_END, 'polka')]),
    ...bars(B, 'polkaTamb'),
    ...withFill([...bars(B.slice(0, 6), 'polkaTamb'), ...bars(B2_END, 'polkaTamb')]),
  ],
};

/** Компиляция тактов польки в события. Бросает исключение, если сумма длительностей мелодии в такте ≠ barSteps. */
export function compileBars(barsIn: ReadonlyArray<Bar>, barSteps: number): SeqEv[] {
  const ev: SeqEv[] = [];
  barsIn.forEach((bar, bi) => {
    const s0 = bi * barSteps;
    let pos = 0;
    for (const [m, len, vel] of bar.lead) {
      if (m > 0) ev.push({ step: s0 + pos, kind: 'lead', midi: m, len, vel: vel ?? 1, scoop: (vel ?? 1) > 1 && len >= 2 });
      pos += len;
    }
    if (pos !== barSteps) throw new Error(`такт ${bi}: длина мелодии ${pos} ≠ ${barSteps}`);
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

export function compileSong(name: string, song: Song): CompiledSong {
  return {
    name,
    bpm: song.bpm,
    barSteps: song.barSteps,
    stepS: 60 / song.bpm / 4,
    introSteps: song.intro.length * song.barSteps,
    totalSteps: (song.intro.length + song.loop.length) * song.barSteps,
    events: compileBars([...song.intro, ...song.loop], song.barSteps),
  };
}

// ── эмбиент уровня «Тихая лужайка»: фа мажор, 4/4, 80 BPM, петля 16 тактов (48 с) ──

export type AmbChordId = 'Fmaj7' | 'Dm7' | 'Bbmaj7' | 'C' | 'Am7' | 'Gm7' | 'C7sus';
/** Бас (корень) и голоса пэда (без корня, около до 4-й октавы — плавное голосоведение). */
export const AMB_CHORDS: Record<AmbChordId, { bass: number; pad: ReadonlyArray<number> }> = {
  Fmaj7: { bass: 41, pad: [57, 60, 64] },
  Dm7: { bass: 50, pad: [57, 60, 65] },
  Bbmaj7: { bass: 46, pad: [57, 62, 65] },
  C: { bass: 48, pad: [55, 60, 64] },
  Am7: { bass: 45, pad: [55, 60, 64] },
  Gm7: { bass: 43, pad: [58, 62, 65] },
  C7sus: { bass: 48, pad: [58, 60, 65] },
};
export interface AmbBar {
  chord: AmbChordId;
  /** Мелодия калимбы (фа-мажорная пентатоника), сумма длительностей = 16. */
  lead: ReadonlyArray<Note>;
  shaker: boolean;
}
export interface AmbSong {
  bpm: number;
  barSteps: number;
  bars: ReadonlyArray<AmbBar>;
}

const amb = (chord: AmbChordId, shakerOn: boolean, lead: ReadonlyArray<Note>): AmbBar => ({ chord, lead, shaker: shakerOn });
export const LEVEL_SONG: AmbSong = {
  bpm: 80,
  barSteps: 16,
  bars: [
    amb('Fmaj7', false, [[P, 4], [81, 2], [84, 2], [P, 2], [79, 2], [77, 4]]),
    amb('Fmaj7', false, [[72, 4], [P, 4], [74, 2], [77, 2], [P, 4]]),
    amb('Dm7', false, [[P, 2], [81, 2], [P, 2], [77, 4], [74, 2], [P, 4]]),
    amb('Dm7', false, [[72, 6], [P, 2], [69, 4], [P, 4]]),
    amb('Bbmaj7', true, [[P, 4], [77, 2], [81, 2], [86, 4], [84, 4]]),
    amb('Bbmaj7', true, [[81, 4], [P, 4], [79, 2], [77, 2], [P, 4]]),
    amb('C', true, [[P, 2], [79, 2], [84, 4], [P, 2], [79, 2], [76, 4]]),
    amb('C', true, [[79, 8], [P, 8]]),
    amb('Am7', true, [[P, 4], [76, 2], [79, 2], [84, 4], [81, 4]]),
    amb('Am7', true, [[79, 4], [P, 4], [76, 4], [P, 4]]),
    amb('Dm7', true, [[P, 2], [74, 2], [77, 2], [81, 2], [P, 2], [84, 2], [81, 4]]),
    amb('Dm7', true, [[77, 6], [P, 2], [74, 4], [P, 4]]),
    amb('Gm7', true, [[P, 4], [79, 2], [77, 2], [74, 4], [72, 4]]),
    amb('Gm7', true, [[74, 4], [P, 4], [70, 4], [P, 4]]),
    amb('C7sus', false, [[P, 2], [72, 2], [77, 2], [79, 2], [84, 4], [82, 4]]),
    amb('C7sus', false, [[79, 8], [P, 8]]),
  ],
};

/** Компиляция эмбиента: калимба, пэд на смену аккорда (на всю его длину), мягкий бас на 1-ю и 3-ю доли, шейкер. tr — транспозиция, полутоны. */
export function compileAmbient(song: AmbSong, tr = 0): SeqEv[] {
  const ev: SeqEv[] = [];
  const n = song.bars.length;
  const S = song.barSteps;
  song.bars.forEach((bar, bi) => {
    const s0 = bi * S;
    let pos = 0;
    for (const [m, len, vel] of bar.lead) {
      if (m > 0) ev.push({ step: s0 + pos, kind: 'pluck', midi: m + tr, len, vel: vel ?? (pos % 4 === 0 ? 0.9 : 0.75) });
      pos += len;
    }
    if (pos !== S) throw new Error(`такт ${bi}: длина мелодии ${pos} ≠ ${S}`);
    const ch = AMB_CHORDS[bar.chord];
    if (bi === 0 || song.bars[bi - 1]!.chord !== bar.chord) {
      let span = 1;
      while (bi + span < n && song.bars[bi + span]!.chord === bar.chord) span++;
      ev.push({ step: s0, kind: 'pad', notes: tr ? ch.pad.map((m) => m + tr) : ch.pad, len: span * S, vel: 1 });
    }
    ev.push({ step: s0, kind: 'sub', midi: ch.bass + tr, len: 7, vel: 1 }, { step: s0 + 8, kind: 'sub', midi: ch.bass + tr, len: 6, vel: 0.7 });
    if (bar.shaker) {
      for (const k of [2, 6, 10, 14]) ev.push({ step: s0 + k, kind: 'shaker', vel: 1 });
      for (const k of [7, 15]) ev.push({ step: s0 + k, kind: 'shaker', vel: 0.45 });
    }
  });
  return ev.sort((a, b) => a.step - b.step);
}

export function compileAmbientSong(name: string, song: AmbSong, tr = 0): CompiledSong {
  return {
    name,
    bpm: song.bpm,
    barSteps: song.barSteps,
    stepS: 60 / song.bpm / 4,
    introSteps: 0,
    totalSteps: song.bars.length * song.barSteps,
    events: compileAmbient(song, tr),
  };
}

/**
 * Луп уровня по теме (ревью «в уровнях нет музыки»; AB2: у уровней своя спокойная музыка): та же «Тихая лужайка»,
 * но в своей тональности, темпе и с своим шейкером — луг: фа мажор, 80 BPM, шейкер со второй половины; пляж: соль
 * мажор, 88 BPM, шейкер всё время («ракушки»); снег: ре мажор, 70 BPM, без шейкера («музыкальная шкатулка»).
 */
export const LEVEL_THEME: Readonly<Record<ThemeId, { transpose: number; bpm: number; shaker: 'song' | 'all' | 'none' }>> = {
  meadow: { transpose: 0, bpm: 80, shaker: 'song' },
  beach: { transpose: 2, bpm: 88, shaker: 'all' },
  snow: { transpose: -3, bpm: 70, shaker: 'none' },
};

/** Песня лупа уровня для темы. */
export function levelSong(theme: ThemeId): CompiledSong {
  const v = LEVEL_THEME[theme];
  const bars = LEVEL_SONG.bars.map((b) => ({ ...b, shaker: v.shaker === 'song' ? b.shaker : v.shaker === 'all' }));
  return compileAmbientSong(`level:${theme}`, { ...LEVEL_SONG, bpm: v.bpm, bars }, v.transpose);
}

/** Лупы уровней по темам. */
export const LEVEL_SONGS: Readonly<Record<ThemeId, CompiledSong>> = {
  meadow: levelSong('meadow'),
  beach: levelSong('beach'),
  snow: levelSong('snow'),
};

/** Готовые песни треков движка. */
export const SONGS = {
  menu: compileSong('menu', MENU_SONG),
  level: compileAmbientSong('level', LEVEL_SONG),
} as const;
export type SongId = keyof typeof SONGS;

// ───────────────────────────── «Оркестр» ─────────────────────────────

/** Набор шин и общих узлов для одной песни/джингла. dispose() глушит LFO и эхо. */
export interface Band {
  inst: Inst;
  lead: AccStrip;
  bass: AudioNode;
  stab: AudioNode;
  drums: AudioNode;
  pad: AudioNode;
  pluck: AudioNode;
  dispose(at: number): void;
}

/** Создать «оркестр» в узел out. stepS — для эха калимбы (пунктирная восьмая). */
export function createBand(ctx: Ctx, nb: NoiseBank, out: AudioNode, stepS = 0.1875, start = ctx.currentTime): Band {
  const gain = (v: number, dest: AudioNode): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  };
  const lead = makeAccordionStrip(ctx, out);
  const bass = gain(1, out);
  const stabPan = ctx.createStereoPanner();
  stabPan.pan.value = 0.25;
  stabPan.connect(out);
  const drums = gain(1, out);
  // Пэд: общий мягкий lowpass.
  const padLp = ctx.createBiquadFilter();
  padLp.type = 'lowpass';
  padLp.frequency.value = 1500;
  padLp.Q.value = -3;
  padLp.connect(out);
  // Калимба: сухой сигнал + эхо (пунктирная восьмая, обратная связь 0.35 через lowpass 2.5 кГц).
  const pluckIn = gain(1, out);
  const delay = ctx.createDelay(2);
  delay.delayTime.value = Math.min(1.9, stepS * 3);
  const fbLp = ctx.createBiquadFilter();
  fbLp.type = 'lowpass';
  fbLp.frequency.value = 2500;
  fbLp.Q.value = -3;
  const fb = ctx.createGain();
  fb.gain.value = 0.35;
  const wet = gain(0.3, out);
  pluckIn.connect(delay);
  delay.connect(fbLp).connect(fb).connect(delay);
  fbLp.connect(wet);
  const pluckPan = ctx.createStereoPanner();
  pluckPan.pan.value = -0.15;
  pluckPan.connect(pluckIn);
  for (const l of lead.lfos) l.start(start);
  return {
    inst: { ctx, nb },
    lead,
    bass,
    stab: stabPan,
    drums,
    pad: padLp,
    pluck: pluckPan,
    dispose(at: number): void {
      for (const l of lead.lfos) {
        try {
          l.stop(at);
        } catch {
          /* уже остановлен */
        }
      }
      fb.gain.setValueAtTime(0, at); // разорвать петлю эха
    },
  };
}

/** Проиграть одно событие секвенсора в момент t. Возвращает время конца звука. */
export function playEv(b: Band, e: SeqEv, t: number, stepS: number): number {
  const c = b.inst;
  switch (e.kind) {
    case 'lead': return accordionNote(c, b.lead, t, e.midi!, e.len! * stepS, e.vel, e.scoop);
    case 'bass': return tubaNote(c, b.bass, t, e.midi!, e.len! * stepS, e.vel);
    case 'stab': return stab(c, b.stab, t, e.notes!, e.vel);
    case 'kick': return kick(c, b.drums, t, e.vel);
    case 'snare': return snare(c, b.drums, t, e.vel);
    case 'hat': return hat(c, b.drums, t, e.vel);
    case 'tamb': return tambourine(c, b.drums, t, e.vel);
    case 'crash': return crash(c, b.drums, t, e.vel);
    case 'pad': return padChord(c, b.pad, t, e.notes!, e.len! * stepS, e.vel);
    case 'pluck': return pluck(c, b.pluck, t, e.midi!, e.vel);
    case 'sub': return softBass(c, b.bass, t, e.midi!, e.len! * stepS, e.vel);
    case 'shaker': return shaker(c, b.drums, t, e.vel);
  }
}

// ───────────────────────────── Джинглы ─────────────────────────────

export interface Jingle {
  bpm: number;
  events: ReadonlyArray<SeqEv>;
  lengthSteps: number;
}

/** Победа (150 BPM, 1.6 с + хвост): D5 F#5 A5 D6. B5 C#6 D6~ — ре мажор. */
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

/** Поражение (100 BPM, 2.4 с): A4 F4 D4 C#4 D4~ — нисходящая «грустная» фраза. */
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

/** Проиграть джингл в out начиная с t (свой «оркестр», gain — общий уровень). Возвращает время конца. */
export function playJingle(ctx: Ctx, nb: NoiseBank, out: AudioNode, j: Jingle, t: number, gain = 1): number {
  const g = ctx.createGain();
  g.gain.value = gain;
  g.connect(out);
  const stepS = 60 / j.bpm / 4;
  const band = createBand(ctx, nb, g, stepS, t);
  let end = t;
  for (const e of j.events) end = Math.max(end, playEv(band, e, t + e.step * stepS, stepS));
  band.dispose(end);
  const last = band.lead.lfos[0];
  if (last) last.onended = () => g.disconnect();
  return end;
}

// ───────────────────────────── Lookahead-планировщик ─────────────────────────────

export const LOOKAHEAD_MS = 25;
export const SCHEDULE_AHEAD_S = 0.12;

export interface Clock {
  readonly currentTime: number;
}
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/**
 * Секвенсор по схеме «A Tale of Two Clocks»: setTimeout каждые 25 мс планирует события
 * на 120 мс вперёд по часам аудио. Вступление звучит один раз, потом петля.
 * Если таймеры «проспали» — пропущенное не догоняем пачкой, а пересинхронизируемся.
 */
export class Sequencer {
  private readonly byStep: SeqEv[][];
  private readonly song: CompiledSong;
  private readonly clock: Clock;
  private readonly timers: Timers;
  private readonly play: (e: SeqEv, t: number, stepS: number) => void;
  private stepIdx = 0;
  private nextT = 0;
  private timer: unknown = null;
  private live = false;

  constructor(clock: Clock, song: CompiledSong, play: (e: SeqEv, t: number, stepS: number) => void, timers: Timers = realTimers) {
    this.clock = clock;
    this.song = song;
    this.play = play;
    this.timers = timers;
    this.byStep = Array.from({ length: song.totalSteps }, () => []);
    for (const e of song.events) this.byStep[Math.floor(e.step)]!.push(e);
  }

  get running(): boolean {
    return this.live;
  }
  /** Текущий шаг (следующий к планированию). */
  get position(): number {
    return this.stepIdx;
  }

  /** Живой запуск: с таймером. */
  start(at = this.clock.currentTime + 0.05): void {
    this.stop();
    this.reset(at);
    this.live = true;
    this.tick();
  }

  /** Подготовка без таймера (офлайн-рендер, тесты) — затем scheduleUntil(). */
  reset(at: number): void {
    this.stepIdx = 0;
    this.nextT = at;
  }

  stop(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.live = false;
  }

  /** Запланировать все шаги, начинающиеся раньше tEnd. */
  scheduleUntil(tEnd: number): void {
    const s = this.song;
    while (this.nextT < tEnd) {
      for (const e of this.byStep[this.stepIdx]!) this.play(e, this.nextT + (e.step % 1) * s.stepS, s.stepS);
      this.nextT += s.stepS;
      this.stepIdx = this.stepIdx + 1 >= s.totalSteps ? s.introSteps : this.stepIdx + 1;
    }
  }

  private readonly tick = (): void => {
    if (!this.live) return;
    const now = this.clock.currentTime;
    if (this.nextT < now - 0.05) this.nextT = now + 0.02;
    this.scheduleUntil(now + SCHEDULE_AHEAD_S);
    this.timer = this.timers.set(this.tick, LOOKAHEAD_MS);
  };
}
