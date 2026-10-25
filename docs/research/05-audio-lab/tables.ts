// Таблицы микса: громкость/приоритет/кулдаун по категориям и кулдауны по ключам звуков.

import type { Cat } from './mix.ts';

export interface CatGain {
  /** Множитель громкости голоса (до шины). */
  gain: number;
  /** Приоритет при краже голосов: score = громкость × prio. */
  prio: number;
  /** Кулдаун по умолчанию для одного id, мс. */
  cooldown: number;
}

export const CAT_GAIN: Record<Cat, CatGain> = {
  impact: { gain: 0.9, prio: 1, cooldown: 30 },
  break: { gain: 1.0, prio: 1.5, cooldown: 40 },
  birdVox: { gain: 1.0, prio: 3, cooldown: 150 },
  pigVox: { gain: 0.9, prio: 2, cooldown: 150 },
  explosion: { gain: 1.0, prio: 5, cooldown: 0 },
  sling: { gain: 0.9, prio: 4, cooldown: 50 },
  ability: { gain: 1.0, prio: 4, cooldown: 100 },
  ui: { gain: 1.0, prio: 10, cooldown: 40 },
  reward: { gain: 1.0, prio: 10, cooldown: 0 },
  loop: { gain: 1.0, prio: 100, cooldown: 0 },
};

/** Кулдаун по префиксу ключа (до «:»), мс. Отсутствующие — из CAT_GAIN. */
export const COOLDOWN_MS: Record<string, number> = {
  slingStretch: 60, launch: 150, select: 150, hurt: 250, feather: 60, puff: 80,
  woodHit: 30, iceHit: 30, stoneHit: 30, ground: 50, pigBump: 60,
  woodCrack: 50, iceCrack: 50, stoneCrack: 50, woodBreak: 35, iceShatter: 35, stoneBreak: 35,
  rubble: 250, boom: 0, helmet: 100, pigHurt: 150, pigPop: 40, pigPopQuiet: 40, pigLaugh: 1500, pigGrunt: 2000,
  scoreTick: 45, ui: 40, bonus: 0,
};
