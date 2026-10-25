// Калибровка уровней кампании по устойчивой линии эксперта (ревью «арт и ощущения»: звёзды и nMin стояли на
// хрупких точных решениях — 3–37 % побед при ошибке руки ±0.5°). Данные пишет scripts/level-calibrate.ts:
// решатель с переоценкой кандидатов под шумом (src/core/sim/solver.ts, robust), из нескольких настроек — линия
// с лучшей долей побед под «мелким» шумом; звёзды — по ней (src/core/sim/stars.ts: 2★ — медиана, 3★ — 80-й
// перцентиль), nMin — её птицы. Эпизоды применяют калибровку к своим уровням (calibrated) — геометрия уровня
// и его калибровка живут отдельно: после правки уровня перезапустите калибровку этого уровня.

import type { LevelDef, LevelMeta, StarThresholds } from '../core/types';

export interface LevelCalib {
  stars: StarThresholds;
  /** Птиц в линии эксперта (ход, на котором погибла последняя свинья). */
  nMin: number;
  /** expertBirds / expertScore — птиц и точный счёт линии; robustWin / handWin — доля побед под шумом (30 прогонов). */
  calib: Record<string, number>;
  plan: NonNullable<LevelMeta['plan']>;
}

// <calib> — блок ниже переписывает scripts/level-calibrate.ts
export const CALIB: Readonly<Record<string, LevelCalib>> = {
  '1-1': {
    stars: { one: 0, two: 29_000, three: 34_000 },
    nMin: 1,
    calib: { expertBirds: 1, expertScore: 34430, robustWin: 1, handWin: 0.933, runs: 30 },
    plan: [{ angleDeg: 28, power: 0.9 }],
  },
  '1-2': {
    stars: { one: 0, two: 28_000, three: 33_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 32740, robustWin: 0.9, handWin: 0.633, runs: 30 },
    plan: [{ angleDeg: 16, power: 1 }, { angleDeg: 5, power: 0.775 }],
  },
  '1-3': {
    stars: { one: 0, two: 19_000, three: 38_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 38160, robustWin: 1, handWin: 0.533, runs: 30 },
    plan: [{ angleDeg: 34, power: 1 }, { angleDeg: 75, power: 0.95 }],
  },
  '1-4': {
    stars: { one: 0, two: 39_000, three: 49_000 },
    nMin: 1,
    calib: { expertBirds: 1, expertScore: 49000, robustWin: 0.967, handWin: 0.767, runs: 30 },
    plan: [{ angleDeg: 24, power: 0.85, abilityAt: 0.5 }],
  },
  '1-5': {
    stars: { one: 0, two: 38_000, three: 43_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 43730, robustWin: 0.8, handWin: 0.533, runs: 30 },
    plan: [{ angleDeg: 31, power: 1 }, { angleDeg: 64, power: 0.9, abilityAt: 0.65 }],
  },
  '1-6': {
    stars: { one: 0, two: 35_000, three: 40_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 40060, robustWin: 0.9, handWin: 0.7, runs: 30 },
    plan: [{ angleDeg: 6, power: 0.9, abilityAt: 0.513 }, { angleDeg: 20, power: 0.8, abilityAt: 0.95 }],
  },
  '1-7': {
    stars: { one: 0, two: 39_000, three: 44_000 },
    nMin: 3,
    calib: { expertBirds: 3, expertScore: 44000, robustWin: 0.933, handWin: 0.167, runs: 30 },
    plan: [{ angleDeg: 25, power: 0.825, abilityAt: 0.45 }, { angleDeg: 28, power: 0.8 }, { angleDeg: 66, power: 1, abilityAt: 0.8 }],
  },
  '1-8': {
    stars: { one: 0, two: 45_000, three: 50_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 50220, robustWin: 0.933, handWin: 0.8, runs: 30 },
    plan: [{ angleDeg: 66, power: 0.85 }, { angleDeg: 64, power: 0.9 }],
  },
  '1-9': {
    stars: { one: 0, two: 45_000, three: 55_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 55170, robustWin: 1, handWin: 0.8, runs: 30 },
    plan: [{ angleDeg: 35, power: 0.85 }, { angleDeg: 4, power: 0.8, abilityAt: 0.45 }],
  },
  '1-10': {
    stars: { one: 0, two: 40_000, three: 50_000 },
    nMin: 4,
    calib: { expertBirds: 4, expertScore: 50920, robustWin: 0.733, handWin: 0.333, runs: 30 },
    plan: [{ angleDeg: 32, power: 0.9 }, { angleDeg: 69, power: 0.725, abilityAt: 0.5 }, { angleDeg: 11, power: 0.95, abilityAt: 0.45 }, { angleDeg: 57, power: 0.8, abilityAt: 1.95 }],
  },
  '2-1': {
    stars: { one: 0, two: 38_000, three: 49_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 49950, robustWin: 0.8, handWin: 0.8, runs: 30 },
    plan: [{ angleDeg: 62, power: 0.85 }, { angleDeg: 20, power: 1, abilityAt: 0.325 }],
  },
  '2-2': {
    stars: { one: 0, two: 31_000, three: 36_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 37490, robustWin: 1, handWin: 0.567, runs: 30 },
    plan: [{ angleDeg: 56, power: 0.85, abilityAt: 1.2 }, { angleDeg: 44, power: 0.9, abilityAt: 1.2 }],
  },
  '2-3': {
    stars: { one: 0, two: 36_000, three: 41_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 41680, robustWin: 0.867, handWin: 0.567, runs: 30 },
    plan: [{ angleDeg: 60, power: 0.75 }, { angleDeg: 37, power: 0.975, abilityAt: 0.575 }],
  },
  '2-4': {
    stars: { one: 0, two: 48_000, three: 53_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 53730, robustWin: 0.9, handWin: 0.533, runs: 30 },
    plan: [{ angleDeg: 24, power: 1 }, { angleDeg: 8, power: 0.8, abilityAt: 0.6 }],
  },
  '2-5': {
    stars: { one: 0, two: 44_000, three: 49_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 49010, robustWin: 0.933, handWin: 0.933, runs: 30 },
    plan: [{ angleDeg: 49, power: 0.8, abilityAt: 1.1 }, { angleDeg: 54, power: 0.85, abilityAt: 1.7 }],
  },
  '2-6': {
    stars: { one: 0, two: 38_000, three: 43_000 },
    nMin: 3,
    calib: { expertBirds: 3, expertScore: 43270, robustWin: 0.6, handWin: 0.133, runs: 30 },
    plan: [{ angleDeg: 41, power: 0.925, abilityAt: 0.45 }, { angleDeg: 28, power: 0.975, abilityAt: 0.8 }, { angleDeg: 38, power: 1, abilityAt: 0.9 }],
  },
  '2-7': {
    stars: { one: 0, two: 49_000, three: 54_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 54190, robustWin: 0.733, handWin: 0.467, runs: 30 },
    plan: [{ angleDeg: 29, power: 1 }, { angleDeg: 1, power: 0.725, abilityAt: 0.75 }],
  },
  '2-8': {
    stars: { one: 0, two: 50_000, three: 55_000 },
    nMin: 4,
    calib: { expertBirds: 4, expertScore: 55120, robustWin: 1, handWin: 0.9, runs: 30 },
    plan: [{ angleDeg: 12, power: 1, abilityAt: 0.5 }, { angleDeg: 9, power: 1, abilityAt: 0.575 }, { angleDeg: 1, power: 0.85, abilityAt: 0.8 }, { angleDeg: 4, power: 0.9, abilityAt: 0.933 }],
  },
  '2-9': {
    stars: { one: 0, two: 57_000, three: 62_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 62850, robustWin: 0.967, handWin: 0.6, runs: 30 },
    plan: [{ angleDeg: 43, power: 0.825 }, { angleDeg: 70, power: 0.975, abilityAt: 1.2 }],
  },
  '2-10': {
    stars: { one: 0, two: 53_000, three: 58_000 },
    nMin: 5,
    calib: { expertBirds: 5, expertScore: 58570, robustWin: 0.667, handWin: 0.4, runs: 30 },
    plan: [{ angleDeg: 24, power: 0.775 }, { angleDeg: 30, power: 0.85, abilityAt: 0.8 }, { angleDeg: 15, power: 0.975, abilityAt: 0.325 }, { angleDeg: 67, power: 0.925 }, { angleDeg: 60, power: 1, abilityAt: 1.2 }],
  },
  '3-1': {
    stars: { one: 0, two: 34_000, three: 39_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 39270, robustWin: 0.7, handWin: 0.467, runs: 30 },
    plan: [{ angleDeg: 38, power: 0.95 }, { angleDeg: 36, power: 0.85 }],
  },
  '3-2': {
    stars: { one: 0, two: 56_000, three: 61_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 61610, robustWin: 0.867, handWin: 0.733, runs: 30 },
    plan: [{ angleDeg: 8, power: 0.9, abilityAt: 0.5 }, { angleDeg: 8, power: 1, abilityAt: 0.5 }],
  },
  '3-3': {
    stars: { one: 0, two: 34_000, three: 53_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 53300, robustWin: 0.533, handWin: 0.4, runs: 30 },
    plan: [{ angleDeg: 28, power: 1, abilityAt: 0.325 }, { angleDeg: 45, power: 0.825 }],
  },
  '3-4': {
    stars: { one: 0, two: 40_000, three: 45_000 },
    nMin: 3,
    calib: { expertBirds: 3, expertScore: 45220, robustWin: 1, handWin: 0.9, runs: 30 },
    plan: [{ angleDeg: 38, power: 0.95, abilityAt: 0.7 }, { angleDeg: 20, power: 1 }, { angleDeg: 12, power: 1 }],
  },
  '3-5': {
    stars: { one: 0, two: 48_000, three: 53_000 },
    nMin: 4,
    calib: { expertBirds: 4, expertScore: 53790, robustWin: 0.833, handWin: 0.667, runs: 30 },
    plan: [{ angleDeg: 27, power: 0.975 }, { angleDeg: 35, power: 1, abilityAt: 1.4 }, { angleDeg: 36, power: 1, abilityAt: 1.2 }, { angleDeg: 7, power: 1 }],
  },
  '3-6': {
    stars: { one: 0, two: 30_000, three: 35_000 },
    nMin: 2,
    calib: { expertBirds: 2, expertScore: 36480, robustWin: 0.633, handWin: 0.333, runs: 30 },
    plan: [{ angleDeg: 24, power: 0.9, abilityAt: 1.1 }, { angleDeg: 12, power: 0.9, abilityAt: 0.5 }],
  },
  '3-7': {
    stars: { one: 0, two: 44_000, three: 49_000 },
    nMin: 5,
    calib: { expertBirds: 5, expertScore: 48600, robustWin: 0.867, handWin: 0.433, runs: 30 },
    plan: [{ angleDeg: 26, power: 1 }, { angleDeg: 32, power: 0.8, abilityAt: 0.95 }, { angleDeg: 60, power: 1, abilityAt: 1.2 }, { angleDeg: 57, power: 0.925, abilityAt: 0.5 }, { angleDeg: 64, power: 0.9, abilityAt: 2.25 }],
  },
  '3-8': {
    stars: { one: 0, two: 41_000, three: 46_000 },
    nMin: 4,
    calib: { expertBirds: 4, expertScore: 45300, robustWin: 0.767, handWin: 0.233, runs: 30 },
    plan: [{ angleDeg: 72, power: 0.95, abilityAt: 0.5 }, { angleDeg: 42, power: 1, abilityAt: 1.7 }, { angleDeg: 37, power: 0.975, abilityAt: 0.45 }, { angleDeg: 22, power: 1 }],
  },
  '3-9': {
    stars: { one: 0, two: 57_000, three: 62_000 },
    nMin: 4,
    calib: { expertBirds: 4, expertScore: 62200, robustWin: 0.933, handWin: 0.533, runs: 30 },
    plan: [{ angleDeg: 60, power: 0.9 }, { angleDeg: 3, power: 0.925, abilityAt: 0.5 }, { angleDeg: 16, power: 0.775, abilityAt: 0.6 }, { angleDeg: 24, power: 0.9, abilityAt: 0.45 }],
  },
  '3-10': {
    stars: { one: 0, two: 92_000, three: 97_000 },
    nMin: 5,
    calib: { expertBirds: 5, expertScore: 96570, robustWin: 0.3, handWin: 0.133, runs: 30 },
    plan: [{ angleDeg: 45, power: 0.875 }, { angleDeg: 3, power: 0.775, abilityAt: 0.35 }, { angleDeg: 23, power: 0.825, abilityAt: 0.45 }, { angleDeg: 12, power: 1, abilityAt: 0.8 }, { angleDeg: 34.5, power: 1, abilityAt: 1.2 }],
  },
};
// </calib>

/** Уровень с калибровкой (звёзды, nMin, calib, plan); нет записи — как есть. */
export function calibrated(lv: LevelDef): LevelDef {
  const c = CALIB[lv.id];
  if (!c) return lv;
  return {
    ...lv,
    stars: { ...c.stars },
    meta: { ...lv.meta, nMin: c.nMin, starsSource: 'solver', calib: { ...c.calib }, plan: c.plan.map((s) => ({ ...s })) },
  };
}
