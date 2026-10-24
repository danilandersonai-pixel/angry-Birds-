// Рецепты всех звуковых эффектов (по docs/research/05-audio.md §8).
// Каждый рецепт: (s, t, ...params) → время окончания. s.ctx — любой BaseAudioContext, s.out — узел назначения
// (вход «голоса»: громкость/панораму задаёт микшер). Одни и те же функции звучат вживую,
// запекаются в OfflineAudioContext и рендерятся для проверки (dev/preview-audio.html).
// Внутренние уровни откалиброваны: пик рецепта при максимальных параметрах ≈ −8…−3 dBFS.

import type { ExplosionSource } from '../core/events';
import type { BirdType, PigType, ThemeId } from '../core/types';
import type { NoiseBank } from './noise';
import {
  type Ctx, type Env, type Formant, type Mode, type Pts, type VoiceOpts,
  clamp01, midiHz, panned, playModal, playNoiseBurst, playTone, playVoice,
} from './synth';

export interface S {
  ctx: Ctx;
  out: AudioNode;
  nb: NoiseBank;
  rnd: () => number;
  /** Кривая tanh для WaveShaper (сабы взрывов слышны на телефонах). */
  tanh: Float32Array<ArrayBuffer>;
}
const R = (s: S, lo: number, hi: number): number => lo + (hi - lo) * s.rnd();
const RI = (s: S, lo: number, hi: number): number => Math.floor(R(s, lo, hi + 1));
const max = (...xs: number[]): number => Math.max(...xs);

// ───────────────────────────── Рогатка ─────────────────────────────

/** Захват птицы: кожаный «кх» + щелчок. */
export function slingGrab(s: S, t: number): number {
  const { ctx, out, nb } = s;
  return max(
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.83, a: 2, tau: 15, filts: [{ type: 'bandpass', f: 900, q: 3 }] }),
    playTone(ctx, out, t, { wave: 'sine', f: 2000, gain: 0.41, a: 0.3, tau: 3 }),
    playTone(ctx, out, t, { wave: 'sawtooth', f: 120, gain: 0.58, a: 5, tau: 25, filt: { type: 'bandpass', f: 700, q: 5 } }),
  );
}

/** Скрип резины; power 0..1 — высота растёт с натяжением. */
export function slingStretch(s: S, t: number, power: number): number {
  const p = clamp01(power);
  const f = 140 + 420 * p;
  return playTone(s.ctx, s.out, t, {
    wave: 'sawtooth',
    f: [[0, f], [90, f * 1.08]],
    gain: 0.55 + 0.45 * p,
    env: { a: 8, d: 40, s: 0.6, r: 30 },
    holdMs: 70,
    filt: { type: 'bandpass', f: [[0, 3 * f], [90, 3.3 * f]], q: 5 },
    am: { rate: 47, depth: 0.35, wave: 'square' },
  });
}

/** Выстрел: «твань» резинки + шлепок кармашка + whoosh; power 0..1. */
export function slingRelease(s: S, t: number, power: number): number {
  const { ctx, out, nb } = s;
  const p = clamp01(power);
  const f0 = 95 + 70 * p;
  return max(
    playTone(ctx, out, t, { wave: 'triangle', f: [[0, f0 * 1.6], [40, f0]], gain: 0.6, a: 1, tau: 90, vib: { rate: 22, depth: 60, decayMs: 200 } }),
    playTone(ctx, out, t, { wave: 'sine', f: [[0, f0 * 3.2], [40, f0 * 2.02]], gain: 0.2, a: 1, tau: 60 }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.6, a: 0.3, tau: 4, filts: [{ type: 'bandpass', f: 1800, q: 1 }] }),
    playNoiseBurst(ctx, out, t, {
      buf: nb.pink, gain: 0.25 + 0.6 * p, env: { a: 30, d: 120, s: 0.4, r: 150 }, holdMs: 120,
      filts: [{ type: 'bandpass', f: [[0, 600], [120, 1800], [350, 500]], q: 1.5 }],
    }),
  );
}

/** Отмена выстрела: тихая «твань» и мягкий стук. */
export function slingCancel(s: S, t: number): number {
  const { ctx, out, nb } = s;
  return max(
    playTone(ctx, out, t, { wave: 'triangle', f: [[0, 130], [40, 85]], gain: 0.24, a: 1, tau: 70, vib: { rate: 20, depth: 50, decayMs: 150 } }),
    playNoiseBurst(ctx, out, t, { buf: nb.pink, gain: 0.3, a: 1, tau: 20, filts: [{ type: 'lowpass', f: 600 }] }),
  );
}

// ───────────────────────────── Птицы: голоса ─────────────────────────────

/** Форманты гласных «мультяшного» голоса (≈ ×1.25 к взрослому): [F1, F2]. */
export const VOW = {
  i: [350, 2600], e: [550, 2100], a: [900, 1450], o: [600, 1000], u: [380, 950], m: [300, 1100],
} as const;
type Vow = keyof typeof VOW;
/** Переход гласных v1 → v2 за ms: две форманты с Q 6 и 8. */
function fm(v1: Vow, v2: Vow, ms: number, g1 = 2.2, g2 = 1.6): Formant[] {
  const [a1, a2] = VOW[v1];
  const [b1, b2] = VOW[v2];
  return [
    { f: [[0, a1], [ms, b1]], q: 6, g: g1 },
    { f: [[0, a2], [ms, b2]], q: 8, g: g2 },
  ];
}
const EV: Env = { a: 12, d: 100, s: 0.8, r: 80 };
const EVS: Env = { a: 6, d: 50, s: 0.7, r: 50 };

interface Syl {
  at: number;
  v: VoiceOpts;
  /** Аспирация «х»/«к» в начале слога: уровень шума. */
  asp?: number;
}

function sayAll(s: S, t: number, syls: ReadonlyArray<Syl>, pitch: number): number {
  let end = t;
  for (const sy of syls) {
    const t0 = t + sy.at / 1000;
    end = max(end, playVoice(s.ctx, s.out, t0, { ...sy.v, breath: { buf: s.nb.white, level: 0.06 } }, pitch));
    if (sy.asp) {
      playNoiseBurst(s.ctx, s.out, t0, { buf: s.nb.white, gain: sy.asp, a: 3, tau: 12, filts: [{ type: 'bandpass', f: 1600, q: 1.5 }] });
    }
  }
  return end;
}

const LAUNCH: Record<BirdType, Syl[]> = {
  // «Йа-а-а!» 0.45 с
  red: [{ at: 0, v: { wave: 'sawtooth', f0: [[0, 500], [70, 760], [300, 720], [450, 600]], gain: 0.53, durMs: 380, env: EV, formants: [...fm('i', 'a', 70), { f: 2800, q: 10, g: 0.6 }], vib: { rate: 6, depth: 30, delayMs: 120 }, growl: { rate: 30, depth: 0.15 } } }],
  // «Уи-и!» 0.25 с
  blues: [{ at: 0, v: { wave: 'triangle', f0: [[0, 900], [120, 1300], [250, 1250]], gain: 0.47, durMs: 200, env: EVS, formants: fm('u', 'i', 100, 3, 3), body: 0.5, vib: { rate: 9, depth: 40, delayMs: 80 } } }],
  // «Йи-ха!» 0.35 с
  chuck: [
    { at: 0, v: { wave: 'sawtooth', f0: [[0, 600], [140, 900]], gain: 0.46, durMs: 120, env: EVS, formants: fm('i', 'i', 1) } },
    { at: 170, asp: 0.35, v: { wave: 'sawtooth', f0: [[0, 820], [180, 700]], gain: 0.5, durMs: 160, env: EVS, formants: fm('a', 'a', 1), vib: { rate: 7, depth: 25, delayMs: 60 } } },
  ],
  // «Хо-о!» 0.4 с
  bomb: [{ at: 0, asp: 0.3, v: { wave: 'sawtooth', f0: [[0, 160], [150, 225], [400, 200]], gain: 0.4, durMs: 360, env: EV, formants: fm('o', 'o', 1, 2.6, 2), body: 0.5, growl: { rate: 25, depth: 0.4 }, sub: 0.3 } }],
  // «Ва-а!» 0.35 с
  matilda: [{ at: 0, v: { wave: 'triangle', f0: [[0, 520], [120, 700], [350, 640]], gain: 0.27, durMs: 300, env: EV, formants: fm('u', 'a', 60, 3, 3), body: 0.5, vib: { rate: 7, depth: 35, delayMs: 100 } } }],
  // «Кра-а!» 0.35 с
  hal: [{ at: 0, asp: 0.25, v: { wave: 'square', f0: [[0, 480], [90, 560], [350, 440]], gain: 0.65, durMs: 300, env: EV, formants: [...fm('a', 'a', 1), { f: 2400, q: 8, g: 0.8 }], growl: { rate: 45, depth: 0.6, untilMs: 80 } } }],
  // «Р-р-р-ах!» 0.6 с
  terence: [{ at: 0, v: { wave: 'sawtooth', f0: [[0, 95], [350, 110], [600, 120]], gain: 0.37, durMs: 560, env: { a: 20, d: 120, s: 0.85, r: 100 }, formants: [{ f: [[0, 420], [350, 450], [420, 750]], q: 6, g: 2.4 }, { f: [[0, 800], [420, 1150]], q: 8, g: 1.8 }], body: 0.6, growl: { rate: 28, depth: 0.7, untilMs: 350 }, sub: 0.5 } }],
  // «Уи-и-и!» 0.4 с
  silver: [{ at: 0, v: { wave: 'triangle', f0: [[0, 700], [150, 1100], [400, 1000]], gain: 1.4, durMs: 350, env: EV, formants: fm('u', 'i', 120, 3, 3), body: 0.5, vib: { rate: 7, depth: 30, delayMs: 120 } } }],
};

const SELECT: Record<BirdType, Syl[]> = {
  red: [{ at: 0, v: { wave: 'sawtooth', f0: [[0, 420], [120, 380]], gain: 0.5, durMs: 100, env: EVS, formants: fm('m', 'm', 1) } }],
  blues: [0, 95].map((at) => ({ at, v: { wave: 'triangle' as const, f0: [[0, 1100], [55, 1250]] as Pts, gain: 1.26, durMs: 50, env: EVS, formants: fm('i', 'i', 1, 3, 3), body: 0.5 } })),
  chuck: [{ at: 0, v: { wave: 'sawtooth', f0: [[0, 650], [100, 750]], gain: 0.46, durMs: 90, env: EVS, formants: fm('e', 'i', 80) } }],
  bomb: [{ at: 0, v: { wave: 'sawtooth', f0: [[0, 150], [200, 140]], gain: 0.42, durMs: 190, env: EVS, formants: fm('o', 'o', 1), body: 0.5, growl: { rate: 25, depth: 0.6 } } }],
  matilda: [0, 85].map((at, i) => ({ at, v: { wave: 'triangle' as const, f0: [[0, i ? 900 : 700], [60, i ? 820 : 760]] as Pts, gain: 0.16, durMs: 55, env: EVS, formants: fm('a', 'a', 1, 3, 3), body: 0.5 } })),
  hal: [{ at: 0, asp: 0.25, v: { wave: 'square', f0: [[0, 500], [120, 470]], gain: 0.43, durMs: 110, env: EVS, formants: fm('a', 'a', 1), growl: { rate: 45, depth: 0.6, untilMs: 50 } } }],
  terence: [{ at: 0, v: { wave: 'sawtooth', f0: [[0, 90], [380, 85]], gain: 0.25, durMs: 370, env: EV, formants: fm('o', 'o', 1, 2.4, 1.8), body: 0.6, growl: { rate: 28, depth: 0.7 }, sub: 0.5 } }],
  silver: [{ at: 0, v: { wave: 'triangle', f0: [[0, 800], [100, 950]], gain: 0.66, durMs: 90, env: EVS, formants: fm('i', 'i', 1, 3, 3), body: 0.5 } }],
};

/** Базовые F0 для «ушиба» и производных реплик. */
export const BIRD_F0: Record<BirdType, number> = { red: 420, blues: 900, chuck: 600, bomb: 160, matilda: 520, hal: 480, terence: 95, silver: 700 };
/** Калибровка: пик «уф» ≈ −8 dBFS (треугольник через форманты звучит по-разному в зависимости от F0). */
const HURT_GAIN: Record<BirdType, number> = { red: 0.37, blues: 0.4, chuck: 0.36, bomb: 0.36, matilda: 0.58, hal: 0.3, terence: 0.32, silver: 0.19 };
const BIRD_WAVE: Record<BirdType, OscillatorType> = { red: 'sawtooth', blues: 'triangle', chuck: 'sawtooth', bomb: 'sawtooth', matilda: 'triangle', hal: 'square', terence: 'sawtooth', silver: 'triangle' };

export const birdLaunch = (s: S, t: number, b: BirdType, pitch = 1): number => sayAll(s, t, LAUNCH[b], pitch);
export const birdSelect = (s: S, t: number, b: BirdType, pitch = 1): number => sayAll(s, t, SELECT[b], pitch);

/** «Уф/ой» при ударе: F0 0.8→0.5 от базового, гласная «у», 110 мс. */
export function birdHurt(s: S, t: number, b: BirdType, pitch = 1): number {
  const f = BIRD_F0[b] * 0.8;
  const tri = BIRD_WAVE[b] === 'triangle';
  return sayAll(s, t, [{ at: 0, v: { wave: BIRD_WAVE[b], f0: [[0, f], [110, f * 0.62]], gain: HURT_GAIN[b], durMs: 100, env: EVS, formants: fm('o', 'u', 80, tri ? 3 : 2.2, tri ? 3 : 1.6), body: 0.5 } }], pitch);
}

/** Прыжок птицы на рогатку: «хоп» вверх + приземление в кармашек через 420 мс. */
export function birdHop(s: S, t: number): number {
  return max(
    playTone(s.ctx, s.out, t, { wave: 'sine', f: [[0, 300], [80, 620]], gain: 0.41, a: 3, tau: 30 }),
    playNoiseBurst(s.ctx, s.out, t + 0.42, { buf: s.nb.pink, gain: 0.5, a: 1, tau: 12, filts: [{ type: 'lowpass', f: 900 }] }),
  );
}

/** Перья при ударе птицы: мягкий «пох» + шорох. */
export function featherPof(s: S, t: number): number {
  return max(
    playNoiseBurst(s.ctx, s.out, t, { buf: s.nb.pink, gain: 1.2, a: 3, tau: 30, filts: [{ type: 'lowpass', f: 1200 }] }),
    playNoiseBurst(s.ctx, s.out, t, { buf: s.nb.white, gain: 0.3, a: 2, tau: 10, filts: [{ type: 'bandpass', f: 2500, q: 1 }] }),
  );
}

/** Исчезновение птицы облачком: «пуф» + маленький «поп». */
export function birdPuff(s: S, t: number): number {
  return max(
    playNoiseBurst(s.ctx, s.out, t, { buf: s.nb.pink, gain: 0.9, a: 10, tau: 60, filts: [{ type: 'lowpass', f: [[0, 1000], [250, 400]] }] }),
    playTone(s.ctx, s.out, t, { wave: 'sine', f: [[0, 500], [30, 250]], gain: 0.35, a: 0.5, tau: 12 }),
  );
}

// ───────────────────────────── Способности ─────────────────────────────

/** Chuck: рывок — полосовой шум 400→3000 Гц + «и-и» + свист скорости. */
export function abilityChuck(s: S, t: number): number {
  const { ctx, out, nb } = s;
  return max(
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 1.1, a: 25, tau: 140, filts: [{ type: 'bandpass', f: [[0, 400], [300, 3000]], q: 1.5 }] }),
    playVoice(ctx, out, t + 0.02, { wave: 'triangle', f0: [[0, 900], [220, 1400]], gain: 0.7, durMs: 200, env: EVS, formants: fm('i', 'i', 1, 3, 3), body: 0.5 }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.28, a: 5, tau: 60, filts: [{ type: 'highpass', f: 5000 }] }),
  );
}

/** Blues: разделение — «пфт» + три чирика со сдвигом 40 мс и разнесением по панораме. */
export function abilityBlues(s: S, t: number): number {
  const { ctx, out, nb } = s;
  let end = playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.5, a: 0.5, tau: 8, filts: [{ type: 'highpass', f: 2000 }] });
  [1, 1.12, 0.9].forEach((k, i) => {
    const o = panned(ctx, out, (i - 1) * 0.25);
    end = max(end, playVoice(ctx, o, t + i * 0.04, { wave: 'triangle', f0: [[0, 900 * k], [80, 1150 * k]], gain: 0.5, durMs: 75, env: EVS, formants: fm('i', 'i', 1, 3, 3), body: 0.5 }));
  });
  return max(end, playTone(ctx, out, t, { wave: 'sine', f: [[0, 2600], [30, 3400]], gain: 0.15, a: 1, tau: 20 }));
}

/** Bomb: фитиль (шипение + искры). Длительность — до взрыва; остановить: вызвать stop(t). */
export function bombFuse(s: S, t: number, durMs: number): number {
  const { ctx, out, nb } = s;
  let end = playNoiseBurst(ctx, out, t, {
    buf: nb.white, gain: 0.18, env: { a: 20, d: 50, s: 1, r: 30 }, holdMs: durMs,
    filts: [{ type: 'highpass', f: 4000 }], am: { rate: 14, depth: 0.6, wave: 'square' },
  });
  for (let k = t + R(s, 0.03, 0.08); k < t + durMs / 1000; k += R(s, 0.06, 0.14)) {
    end = max(end, playNoiseBurst(ctx, out, k, { buf: nb.white, gain: R(s, 0.2, 0.45), a: 0.2, tau: 1.5, filts: [{ type: 'highpass', f: 6000 }] }));
  }
  return end;
}

/** Bomb: «надувание» перед взрывом по тапу (маскируется взрывом, если тот в том же кадре). */
export function bombSwell(s: S, t: number): number {
  return playTone(s.ctx, s.out, t, { wave: 'triangle', f: [[0, 220], [150, 440]], gain: 0.45, env: { a: 10, d: 60, s: 0.8, r: 30 }, holdMs: 130 });
}

/** Matilda: «плоп» яйца + «кудах» + её взлёт вверх. */
export function abilityMatilda(s: S, t: number): number {
  const { ctx, out, nb } = s;
  let end = playTone(ctx, out, t, { wave: 'sine', f: [[0, 900], [50, 300]], gain: 0.64, a: 0.5, tau: 25 });
  [700, 900].forEach((f, i) => {
    end = max(end, playVoice(ctx, out, t + 0.06 + i * 0.08, { wave: 'triangle', f0: [[0, f], [55, f * 0.9]], gain: 0.2, durMs: 50, env: EVS, formants: fm('a', 'a', 1, 3, 3), body: 0.5 }));
  });
  return max(end, playNoiseBurst(ctx, out, t + 0.04, { buf: nb.pink, gain: 0.5, a: 40, tau: 120, filts: [{ type: 'bandpass', f: [[0, 600], [350, 1800]], q: 1.5 }] }));
}

/** Hal: свист крыльев на дуге (центр полосы качается 800↔1600 Гц с частотой 12 Гц) + «кра!». */
export function abilityHal(s: S, t: number, arcMs = 1000): number {
  const { ctx, out, nb } = s;
  return max(
    playNoiseBurst(ctx, out, t, {
      buf: nb.white, gain: 1.15, env: { a: 80, d: 200, s: 0.7, r: 250 }, holdMs: arcMs,
      filts: [{ type: 'bandpass', f: 1200, q: 4 }], fmod: { rate: 12, depth: 400 },
    }),
    sayAll(s, t, SELECT.hal, 1.05),
  );
}

/** Silver: петля «уи» 0.57 с, затем свист пике 2000→800 Гц. */
export function abilitySilver(s: S, t: number): number {
  const { ctx, out } = s;
  return max(
    playVoice(ctx, out, t, { wave: 'triangle', f0: [[0, 700], [570, 1200]], gain: 1.25, durMs: 540, env: EV, formants: fm('u', 'i', 400, 3, 3), body: 0.5 }),
    playTone(ctx, out, t + 0.57, { wave: 'sine', f: [[0, 2000], [500, 800]], gain: 0.45, env: { a: 30, d: 100, s: 0.8, r: 100 }, holdMs: 450, vib: { rate: 18, depth: 25 } }),
  );
}

// ───────────────────────────── Материалы ─────────────────────────────

/** Свободный брус (Эйлер–Бернулли): отношения мод 1 : 2.756 : 5.404 : 8.933. */
const BAR = [1, 2.756, 5.404, 8.933];

/** Дерево — удар. I = интенсивность 0..1, size — характерный размер, м (1 = доска 1 м). */
export function woodHit(s: S, t: number, I: number, size = 1): number {
  const { ctx, out, nb } = s;
  const i = clamp01(I);
  const f0 = R(s, 200, 260) * Math.min(1.4, Math.max(0.7, size ** -0.4));
  const k = 0.7 + 0.6 * i;
  const amps = [1, 0.55 * (0.4 + 0.6 * i), 0.3 * (0.3 + 0.7 * i), 0.15 * i];
  const taus = [70, 45, 28, 18];
  const modes: Mode[] = BAR.map((r, n) => ({ f: f0 * r * R(s, 0.98, 1.02), a: amps[n]!, tau: taus[n]! * k }));
  let end = max(
    playModal(ctx, out, t, modes, 0.27),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.25, a: 0.5, tau: 6 + 10 * i, filts: [{ type: 'bandpass', f: 1200 + 1800 * i, q: 1.2 }] }),
  );
  if (i > 0.6) end = max(end, playTone(ctx, out, t, { wave: 'sine', f: [[0, 130], [90, 70]], gain: 0.3 * i, a: 1, tau: 45 }));
  return end;
}

/** Дерево — трещина (новая стадия повреждения 1..3): ускоряющиеся микрощелчки + скрип. */
export function woodCrack(s: S, t: number, stage: number): number {
  const { ctx, out, nb } = s;
  const n = 7 + 2 * stage;
  const lvl = 0.62 + 0.19 * stage;
  let k = t;
  let end = t;
  for (let j = 0; j < n; j++) {
    end = max(end, playNoiseBurst(ctx, out, k, { buf: nb.white, gain: R(s, 0.4, 1) * lvl, a: 0.3, tau: 2.5, filts: [{ type: 'bandpass', f: R(s, 1500, 3500), q: 3 }] }));
    k += (22 * 0.8 ** j * R(s, 0.8, 1.2)) / 1000;
  }
  return max(
    end,
    playTone(ctx, out, t, { wave: 'sawtooth', f: [[0, 95], [150, 80]], gain: 0.3 * lvl, a: 10, tau: 50, filt: { type: 'bandpass', f: 650, q: 4 } }),
    playModal(ctx, out, t, BAR.slice(0, 3).map((r, j) => ({ f: 180 * r, a: [1, 0.4, 0.2][j]!, tau: [40, 25, 15][j]! })), 0.3 * lvl),
  );
}

/** Дерево — разрушение: щелчок излома + низкий удар + щепки + «рваный» скрип. */
export function woodBreak(s: S, t: number, size = 1): number {
  const { ctx, out, nb } = s;
  const f0 = 170 * Math.min(1.4, Math.max(0.7, size ** -0.4));
  let end = max(
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.5, a: 0.5, tau: 12, filts: [{ type: 'bandpass', f: 2400, q: 1.2 }] }),
    playModal(ctx, out, t, BAR.map((r, n) => ({ f: f0 * r, a: [1, 0.6, 0.35, 0.2][n]!, tau: [105, 68, 42, 27][n]! })), 0.28),
    playTone(ctx, out, t, { wave: 'sine', f: [[0, 110], [120, 60]], gain: 0.28, a: 1, tau: 50 }),
    playTone(ctx, out, t + 0.01, { wave: 'sawtooth', f: [[0, 140], [200, 90]], gain: 0.17, a: 5, tau: 70, filt: { type: 'bandpass', f: 800, q: 3 } }),
  );
  for (let j = 0; j < 10; j++) {
    const k = t + 0.26 * s.rnd() ** 1.8;
    end = max(end, playNoiseBurst(ctx, out, k, { buf: nb.white, gain: R(s, 0.11, 0.28), a: 0.3, tau: R(s, 3, 8), filts: [{ type: 'bandpass', f: R(s, 2000, 6000), q: 2.5 }] }));
  }
  return end;
}

/** Лёд/стекло: неравномерные (негармоничные) моды. */
const ICE = [1, 1.58, 2.31, 3.17, 4.12];

/** Лёд — удар: «клинк». */
export function iceHit(s: S, t: number, I: number): number {
  const { ctx, out, nb } = s;
  const i = clamp01(I);
  const f0 = R(s, 1500, 1900);
  const amps = [1, 0.6, 0.45, 0.3, 0.2];
  const taus = [220, 170, 120, 85, 60];
  const modes: Mode[] = ICE.map((r, n) => ({ f: f0 * r * R(s, 0.99, 1.01), a: amps[n]! * (n ? 0.4 + 0.6 * i : 1), tau: taus[n]! * (0.5 + 0.5 * i) }));
  return max(
    playModal(ctx, out, t, modes, 0.26),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.34, a: 0.3, tau: 3, filts: [{ type: 'highpass', f: 3000 }] }),
  );
}

/** Лёд — трещина: «дзинь-ц» (свип синуса 4200→2600 Гц) + шипящий щелчок + 2 звоночка. */
export function iceCrack(s: S, t: number, stage: number): number {
  const { ctx, out, nb } = s;
  const lvl = 0.38 + 0.083 * stage;
  let end = max(
    playTone(ctx, out, t, { wave: 'sine', f: [[0, 4200], [40, 2600]], gain: 0.35 * lvl, a: 0.5, tau: 25 }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.5 * lvl, a: 0.3, tau: 8, filts: [{ type: 'highpass', f: 5000 }] }),
  );
  for (const dt of [0.03, 0.055]) {
    end = max(end, playModal(ctx, out, t + dt, [{ f: R(s, 3000, 6000), a: 1, tau: 40 }], 0.2 * lvl));
  }
  return end;
}

/** Лёд — разрушение (звон стекла): удар-шум + «сияние» + 20 осколков-звоночков (гуще в начале). */
export function iceShatter(s: S, t: number, size = 1): number {
  const { ctx, out, nb } = s;
  const n = Math.round(14 + 6 * Math.min(2, size));
  let end = max(
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.44, a: 1, tau: 60, filts: [{ type: 'highpass', f: 2500 }] }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.17, a: 5, tau: 200, filts: [{ type: 'bandpass', f: 6000, q: 1 }] }),
    playTone(ctx, out, t, { wave: 'sine', f: [[0, 320], [60, 180]], gain: 0.22, a: 1, tau: 25 }),
  );
  for (let j = 0; j < n; j++) {
    const u = s.rnd() ** 2;
    const f = R(s, 2500, 7000);
    end = max(end, playModal(ctx, panned(ctx, out, R(s, -0.4, 0.4)), t + 0.65 * u, [{ f, a: 1, tau: R(s, 30, 90) }, { f: f * 1.47, a: 0.5, tau: R(s, 20, 50) }], R(s, 0.045, 0.14) * (1 - 0.6 * u)));
  }
  return end;
}

/** Камень — удар: глухой «ток» (тёмный шум + синус 150→90 Гц) + песок + 2 моды. */
export function stoneHit(s: S, t: number, I: number): number {
  const { ctx, out, nb } = s;
  const i = clamp01(I);
  let end = max(
    playNoiseBurst(ctx, out, t, { buf: nb.pink, gain: 0.7, a: 1, tau: 35, filts: [{ type: 'lowpass', f: 900 }] }),
    playTone(ctx, out, t, { wave: 'sine', f: [[0, 150], [80, 90]], gain: 0.35, a: 1, tau: 45 }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.15 * i, a: 0.5, tau: 6, filts: [{ type: 'bandpass', f: 2500, q: 1.5 }] }),
    playModal(ctx, out, t, [{ f: 430 * R(s, 0.95, 1.05), a: 0.4, tau: 25 }, { f: 1130 * R(s, 0.95, 1.05), a: 0.25, tau: 15 }], 0.35),
  );
  if (i > 0.6) end = max(end, playTone(ctx, out, t, { wave: 'sine', f: [[0, 70], [150, 45]], gain: 0.3 * i, a: 2, tau: 70 }));
  return end;
}

/** Камень — трещина: «кррш» (полосовой шум, рубленый квадратом 38 Гц) + 4 щелчка. */
export function stoneCrack(s: S, t: number, stage: number): number {
  const { ctx, out, nb } = s;
  const lvl = 0.6 + 0.13 * stage;
  let end = playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 3.0 * lvl, a: 10, tau: 60, filts: [{ type: 'bandpass', f: 700, q: 2 }], am: { rate: 38, depth: 0.8, wave: 'square' } });
  for (let j = 0; j < 4; j++) {
    end = max(end, playNoiseBurst(ctx, out, t + R(s, 0, 0.12), { buf: nb.white, gain: 0.9 * lvl, a: 0.2, tau: 2, filts: [{ type: 'bandpass', f: 3000, q: 2 }] }));
  }
  return end;
}

/** Камень — разрушение: тяжёлый удар + осыпь (lowpass 1600→300 Гц) + 22 камешка + рокот. */
export function stoneBreak(s: S, t: number, size = 1): number {
  const { ctx, out, nb } = s;
  let end = max(
    playTone(ctx, out, t, { wave: 'sine', f: [[0, 95 * Math.min(1.3, size ** -0.3)], [200, 45]], gain: 0.66, a: 2, tau: 90 }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.37, a: 4, tau: 180, filts: [{ type: 'lowpass', f: [[0, 1600], [500, 300]] }] }),
    playNoiseBurst(ctx, out, t, { buf: nb.brown, gain: 0.5, a: 20, tau: 300, filts: [{ type: 'lowpass', f: 160 }] }),
  );
  for (let j = 0; j < 22; j++) {
    end = max(end, playNoiseBurst(ctx, out, t + 0.75 * s.rnd() ** 1.7, { buf: nb.white, gain: R(s, 0.12, 0.37), a: 0.3, tau: R(s, 4, 12), filts: [{ type: 'bandpass', f: R(s, 900, 2600), q: 4 }] }));
  }
  return end;
}

/** Земля: глухой «бух». */
export function groundThud(s: S, t: number, I: number): number {
  const { ctx, out, nb } = s;
  return max(
    playNoiseBurst(ctx, out, t, { buf: nb.pink, gain: 1.04, a: 1, tau: 50, filts: [{ type: 'lowpass', f: 350 }] }),
    playTone(ctx, out, t, { wave: 'sine', f: [[0, 90], [100, 55]], gain: 0.52, a: 1, tau: 55 }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.15 * clamp01(I), a: 1, tau: 10, filts: [{ type: 'bandpass', f: 1200, q: 0.8 }] }),
  );
}

/** Свинья как поверхность: резиновый «бонк». */
export function pigBump(s: S, t: number): number {
  return max(
    playTone(s.ctx, s.out, t, { wave: 'sine', f: [[0, 200], [70, 130]], gain: 0.37, a: 1, tau: 35 }),
    playTone(s.ctx, s.out, t, { wave: 'triangle', f: [[0, 400], [70, 260]], gain: 0.12, a: 1, tau: 20 }),
  );
}

/** Каскад обломков при массовом обрушении: energy = сумма «лишних» интенсивностей кадра. */
export function rubble(s: S, t: number, energy: number): number {
  const { ctx, out, nb } = s;
  const n = Math.round(12 + Math.min(18, energy * 3));
  let end = playNoiseBurst(ctx, out, t, { buf: nb.brown, gain: 0.93, a: 30, tau: 200, filts: [{ type: 'lowpass', f: 400 }] });
  for (let j = 0; j < n; j++) {
    const wood = s.rnd() < 0.5;
    end = max(end, playNoiseBurst(ctx, out, t + 0.6 * s.rnd() ** 1.5, {
      buf: nb.white, gain: R(s, 0.28, 0.75), a: 0.3, tau: R(s, 4, 14),
      filts: [{ type: 'bandpass', f: wood ? R(s, 1500, 4000) : R(s, 600, 1800), q: wood ? 2.5 : 4 }],
    }));
  }
  return end;
}

// ───────────────────────────── Взрывы ─────────────────────────────

const BOOM: Record<ExplosionSource, { g: number; lp0: number; lp1: number; body: number; sub0: number; sub1: number; subTau: number; debris: number }> = {
  tnt: { g: 0.38, lp0: 3500, lp1: 180, body: 280, sub0: 70, sub1: 32, subTau: 140, debris: 18 },
  bomb: { g: 0.42, lp0: 3000, lp1: 160, body: 240, sub0: 65, sub1: 30, subTau: 130, debris: 14 },
  egg: { g: 0.34, lp0: 4500, lp1: 250, body: 180, sub0: 95, sub1: 45, subTau: 100, debris: 10 },
};

/** Взрыв: треск-транзиент + тело (lowpass-свип) + саб через tanh + рокот + обломки. */
export function explosion(s: S, t: number, src: ExplosionSource): number {
  const { ctx, out, nb } = s;
  const p = BOOM[src];
  if (src === 'egg') {
    // «крак» скорлупы: 3 щелчка за 25 мс, тело взрыва — через 30 мс
    for (const dt of [0, 0.012, 0.025]) playNoiseBurst(ctx, out, t + dt, { buf: nb.white, gain: 0.3, a: 0.2, tau: 2, filts: [{ type: 'bandpass', f: 3000, q: 2 }] });
    t += 0.03;
  }
  const bus = ctx.createGain();
  bus.gain.value = p.g;
  bus.connect(out);
  const sh = ctx.createWaveShaper();
  sh.curve = s.tanh;
  const shOut = ctx.createGain();
  shOut.gain.value = 0.8;
  sh.connect(shOut).connect(bus);
  let end = max(
    playNoiseBurst(ctx, bus, t, { buf: nb.white, gain: 0.8, a: 0.5, tau: 15, filts: [{ type: 'highpass', f: 1000 }] }),
    playNoiseBurst(ctx, bus, t, { buf: nb.white, gain: 0.9, a: 2, tau: p.body, filts: [{ type: 'lowpass', f: [[0, p.lp0], [900, p.lp1]], q: 0 }] }),
    playTone(ctx, sh, t, { wave: 'sine', f: [[0, p.sub0], [350, p.sub1]], gain: 1.0, a: 2, tau: p.subTau }),
    playNoiseBurst(ctx, bus, t, { buf: nb.brown, gain: 0.6, a: 30, tau: 500, filts: [{ type: 'lowpass', f: 120 }] }),
  );

  for (let j = 0; j < p.debris; j++) {
    end = max(end, playNoiseBurst(ctx, panned(ctx, bus, R(s, -0.3, 0.3)), t + 0.15 + 0.95 * s.rnd() ** 1.5, {
      buf: nb.white, gain: R(s, 0.1, 0.3), a: 0.5, tau: R(s, 5, 14), filts: [{ type: 'bandpass', f: R(s, 800, 3000), q: 2 }],
    }));
  }
  return end;
}

// ───────────────────────────── Свиньи ─────────────────────────────

/** F0 голоса и масштаб формант по типу свиньи. */
export const PIG: Record<PigType, { f0: number; fs: number }> = {
  small: { f0: 210, fs: 1.15 }, medium: { f0: 180, fs: 1.0 }, large: { f0: 150, fs: 0.9 },
  helmet: { f0: 165, fs: 0.95 }, mustache: { f0: 135, fs: 0.85 }, king: { f0: 105, fs: 0.8 },
};
const pf = (p: PigType, f1: number, f2: number, g1 = 2.4, g2 = 1.8): Formant[] => [
  { f: f1 * PIG[p].fs, q: 5, g: g1 },
  { f: f2 * PIG[p].fs, q: 6, g: g2 },
];

/** Хрюк: пила F0·0.78 → ×0.78, форманты 500/1000, «рык» 32 Гц + 4 шумовых «снорта» по 25 мс. */
export function pigGrunt(s: S, t: number, p: PigType): number {
  const { ctx, out, nb } = s;
  const f = PIG[p].f0 * 0.78;
  let end = playVoice(ctx, out, t, { wave: 'sawtooth', f0: [[0, f], [250, f * 0.78]], gain: 0.5, durMs: 240, env: EVS, formants: pf(p, 500, 1000), body: 0.5, growl: { rate: 32, depth: 0.6 } });
  for (let j = 0; j < 4; j++) {
    end = max(end, playNoiseBurst(ctx, out, t + j * 0.06, { buf: nb.white, gain: 0.29, a: 3, tau: 8, filts: [{ type: 'bandpass', f: 700 * PIG[p].fs, q: 2 }] }));
  }
  return end;
}

/** Ушиб свиньи «уф»: F0 ×1.2 → ×0.65 за 150 мс. */
export function pigHurt(s: S, t: number, p: PigType): number {
  const f = PIG[p].f0;
  return playVoice(s.ctx, s.out, t, { wave: 'sawtooth', f0: [[0, f * 1.2], [150, f * 0.65]], gain: 0.35, durMs: 140, env: EVS, formants: pf(p, 400, 900), body: 0.5 });
}

/** Каска: металлический «дзынь» + 3 отскока (120/210/265 мс). */
export function helmetClang(s: S, t: number): number {
  const { ctx, out, nb } = s;
  const modes: Mode[] = [{ f: 1820, a: 1, tau: 220 }, { f: 2730, a: 0.6, tau: 160 }, { f: 4150, a: 0.35, tau: 90 }, { f: 5900, a: 0.2, tau: 50 }];
  let end = max(playModal(ctx, out, t, modes, 0.27), playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.31, a: 0.2, tau: 4, filts: [{ type: 'highpass', f: 3000 }] }));
  [[0.12, 0.45], [0.21, 0.25], [0.265, 0.12]].forEach(([dt, g], i) => {
    end = max(end, playModal(ctx, out, t + dt!, modes.map((m) => ({ ...m, tau: m.tau * 0.5 })), 0.27 * g!, 1 + 0.02 * (i + 1)));
  });
  return end;
}

/** Гибель свиньи: визг (опц.) + «поп»-пузырь + «пуф». */
export function pigPop(s: S, t: number, p: PigType, squeal = true): number {
  const { ctx, out, nb } = s;
  const k = Math.sqrt(PIG[p].f0 / 180);
  let end = max(
    playTone(ctx, out, t, { wave: 'sine', f: [[0, 420], [45, 110]], gain: 0.58, a: 1, tau: 25 }),
    playNoiseBurst(ctx, out, t, { buf: nb.pink, gain: 0.75, a: 8, tau: 70, filts: [{ type: 'lowpass', f: [[0, 1400], [200, 500]] }] }),
  );
  if (squeal) {
    end = max(end, playVoice(ctx, out, t, { wave: 'sawtooth', f0: [[0, 600 * k], [90, 900 * k], [250, 400 * k]], gain: 0.33, durMs: 220, env: EVS, formants: fm('i', 'e', 150) }));
  }
  return end;
}

/** Смех «хе-хе-хе»: 3 слога по 110 мс, паузы 70 мс (король — ×1.3 медленнее и финальное «ХА!»). */
export function pigLaugh(s: S, t: number, p: PigType, pitch = 1): number {
  const { ctx, out, nb } = s;
  const f = PIG[p].f0 * pitch;
  const slow = p === 'king' ? 1.3 : 1;
  let end = t;
  for (let j = 0; j < 3; j++) {
    const t0 = t + (j * 0.18 * slow);
    const last = p === 'king' && j === 2;
    playNoiseBurst(ctx, out, t0, { buf: nb.white, gain: 0.25, a: 3, tau: 8, filts: [{ type: 'bandpass', f: 1500, q: 1 }] });
    end = max(end, playVoice(ctx, out, t0 + 0.02, {
      wave: 'sawtooth', f0: [[0, f * (last ? 1.15 : 1)], [last ? 300 : 110, f * 0.9]], gain: 0.46, durMs: last ? 280 : 100,
      env: EVS, formants: pf(p, 650, 1150), body: 0.4, vib: last ? { rate: 6, depth: 30 } : undefined,
    }));
  }
  return end;
}

// ───────────────────────────── Награды и UI ─────────────────────────────

const BELL = [1, 2.0, 3.0, 4.16, 5.43, 6.79];
const BELL_A = [1, 0.45, 0.25, 0.16, 0.1, 0.06];
const BELL_T = [700, 420, 300, 180, 110, 70];

/** Колокольчик «динь»: 6 частичных + щелчок атаки. */
export function bell(s: S, t: number, midi: number, gain = 0.5, tauScale = 1): number {
  const f = midiHz(midi);
  return max(
    playModal(s.ctx, s.out, t, BELL.map((r, i) => ({ f: f * r, a: BELL_A[i]!, tau: BELL_T[i]! * tauScale })), gain, 1, 1.5),
    playTone(s.ctx, s.out, t, { wave: 'sine', f: f * 4, gain: 0.15 * gain, a: 0.3, tau: 8 }),
  );
}

/** Звезда i = 0,1,2: C6, E6, G6 + «тук» приземления; третья — ещё октава и искры. */
export function star(s: S, t: number, i: number): number {
  const notes = [84, 88, 91];
  let end = max(
    bell(s, t, notes[i] ?? 91, 0.26 + 0.04 * i),
    playTone(s.ctx, s.out, t, { wave: 'sine', f: [[0, 170], [80, 90]], gain: 0.25, a: 1, tau: 30 }),
  );
  if (i === 2) {
    end = max(end, bell(s, t + 0.02, 96, 0.15));
    for (let j = 0; j < 6; j++) end = max(end, playModal(s.ctx, s.out, t + R(s, 0.03, 0.33), [{ f: R(s, 3000, 6000), a: 1, tau: 40 }], 0.07));
  }
  return end;
}

export const starEmpty = (s: S, t: number): number => playTone(s.ctx, s.out, t, { wave: 'triangle', f: [[0, 300], [60, 240]], gain: 0.4, a: 1, tau: 25 });
/** Бонус за птицу: колокольчик A5 + i полутонов. */
export const bonusDing = (s: S, t: number, i: number): number => bell(s, t, 81 + i, 0.33, 0.6);
/** Тик счётчика очков; progress 0..1 поднимает тон 1800→3000 Гц. */
export const scoreTick = (s: S, t: number, progress: number): number =>
  playTone(s.ctx, s.out, t, { wave: 'triangle', f: 1800 + 1200 * clamp01(progress), gain: 0.35, a: 0.5, tau: 6 });
export function scoreDone(s: S, t: number): number {
  return max(bell(s, t, 96, 0.29, 0.8), playNoiseBurst(s.ctx, s.out, t, { buf: s.nb.white, gain: 0.15, a: 2, tau: 120, filts: [{ type: 'highpass', f: 7000 }] }));
}
/** Новый рекорд: G-мажор (коротко) → C-мажор (долго). */
export function newBest(s: S, t: number): number {
  let end = t;
  for (const m of [67, 71, 74]) end = max(end, bell(s, t, m, 0.1, 0.4));
  for (const m of [72, 76, 79, 84]) end = max(end, bell(s, t + 0.14, m, 0.1, 1.2));
  return end;
}

export type UiSound = 'click' | 'back' | 'toggleOn' | 'toggleOff' | 'popIn' | 'locked' | 'whoosh' | 'hover';
export function ui(s: S, t: number, name: UiSound): number {
  const { ctx, out, nb } = s;
  switch (name) {
    case 'click':
      return max(
        playTone(ctx, out, t, { wave: 'sine', f: [[0, 620], [40, 320]], gain: 0.35, a: 0.5, tau: 18 }),
        playTone(ctx, out, t, { wave: 'triangle', f: 1300, gain: 0.13, a: 0.3, tau: 4 }),
      );
    case 'back':
      return playTone(ctx, out, t, { wave: 'sine', f: [[0, 420], [50, 240]], gain: 0.4, a: 0.5, tau: 22 });
    case 'toggleOn':
    case 'toggleOff': {
      const [a, b] = name === 'toggleOn' ? [660, 990] : [990, 660];
      return max(
        playTone(ctx, out, t, { wave: 'triangle', f: a, gain: 0.34, a: 1, tau: 40 }),
        playTone(ctx, out, t + 0.06, { wave: 'triangle', f: b, gain: 0.34, a: 1, tau: 40 }),
      );
    }
    case 'popIn':
      return max(
        playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 0.25, a: 40, tau: 50, filts: [{ type: 'bandpass', f: [[0, 800], [180, 2400]], q: 1.2 }] }),
        playTone(ctx, out, t + 0.06, { wave: 'sine', f: [[0, 220], [150, 440]], gain: 0.37, a: 5, tau: 80, vib: { rate: 9, depth: 40 } }),
      );
    case 'locked':
      return max(
        playTone(ctx, out, t, { wave: 'square', f: 140, gain: 0.38, a: 1, tau: 30, filt: { type: 'lowpass', f: 600 } }),
        playTone(ctx, out, t + 0.11, { wave: 'square', f: 130, gain: 0.38, a: 1, tau: 30, filt: { type: 'lowpass', f: 600 } }),
      );
    case 'whoosh':
      return playNoiseBurst(ctx, out, t, { buf: nb.pink, gain: 1.55, env: { a: 80, d: 100, s: 0.5, r: 120 }, holdMs: 150, filts: [{ type: 'bandpass', f: [[0, 400], [200, 1600], [350, 600]], q: 1 }] });
    case 'hover':
      return playTone(ctx, out, t, { wave: 'sine', f: 2000, gain: 0.08, a: 0.3, tau: 3 });
  }
}

// ───────────────────────────── Эмбиент уровня ─────────────────────────────

/** «Постель» фона уровня (живой голос на durS секунд; в движке durS = 3600 и стоп через release). */
export function ambienceBed(s: S, t: number, theme: ThemeId, durS: number): number {
  const { ctx, out, nb } = s;
  const hold = durS * 1000;
  const env: Env = { a: 1500, d: 10, s: 1, r: 1500 };
  if (theme === 'meadow') {
    return playNoiseBurst(ctx, out, t, { buf: nb.pink, gain: 0.58, env, holdMs: hold, filts: [{ type: 'lowpass', f: 500 }], am: { rate: 0.07, depth: 0.5 } });
  }
  if (theme === 'beach') {
    return playNoiseBurst(ctx, out, t, { buf: nb.brown, gain: 0.4, env, holdMs: hold, filts: [{ type: 'lowpass', f: 700 }], fmod: { rate: 0.14, depth: 450 }, am: { rate: 0.14, depth: 0.8 } });
  }
  return max(
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 1.5, env, holdMs: hold, filts: [{ type: 'bandpass', f: 550, q: 8 }], fmod: { rate: 0.11, depth: 250 }, am: { rate: 0.09, depth: 0.6 } }),
    playNoiseBurst(ctx, out, t, { buf: nb.white, gain: 1.0, env, holdMs: hold, filts: [{ type: 'bandpass', f: 900, q: 12 }], fmod: { rate: 0.17, depth: 300 } }),
  );
}

/** Интервал между событиями фона, с: [мин, макс]. snow — без событий. */
export const AMB_EVENT_GAP: Record<ThemeId, readonly [number, number] | null> = { meadow: [3, 8], beach: [10, 20], snow: null };

/** Одно событие фона: птичья трель (луг) или чайка (пляж). */
export function ambienceEvent(s: S, t: number, theme: ThemeId): number {
  const { ctx, out } = s;
  let end = t;
  if (theme === 'meadow') {
    const up = s.rnd() < 0.5;
    const o = panned(ctx, out, R(s, -0.6, 0.6));
    for (let j = 0, n = RI(s, 3, 5); j < n; j++) {
      end = max(end, playTone(ctx, o, t + j * 0.1, { wave: 'sine', f: up ? [[0, 3200], [60, 4200]] : [[0, 4200], [60, 3200]], gain: 0.15, a: 5, tau: 20 }));
    }
  } else if (theme === 'beach') {
    for (const dt of [0, 0.37]) {
      end = max(end, playTone(ctx, out, t + dt, { wave: 'sawtooth', f: [[0, 1400], [250, 900]], gain: 0.15, env: { a: 20, d: 80, s: 0.6, r: 80 }, holdMs: 230, filt: { type: 'bandpass', f: 1800, q: 3 } }));
    }
  }
  return end;
}

/** Офлайн-версия для теста: постель + события на durS секунд. */
export function ambience(s: S, t: number, theme: ThemeId, durS: number): number {
  ambienceBed(s, t, theme, durS);
  const gap = AMB_EVENT_GAP[theme];
  if (gap) for (let k = t + R(s, 1, 3); k < t + durS - 1; k += R(s, gap[0], gap[1])) ambienceEvent(s, k, theme);
  return t + durS + 3;
}
