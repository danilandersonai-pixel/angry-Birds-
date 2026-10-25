// Таблицы птиц и свиней (числа — config/constants.ts, 02-characters.md, 03 §3.4–3.5).

import { BIRDS, DAMAGE, PIGS } from '../config/constants';
import type { BirdType, Material, PigType } from './types';

/** По чему бьёт птица: материал блока, свинья или ящик TNT. */
export type DamageTarget = Material | 'pig' | 'tnt';
export type DamageMults = Readonly<Record<DamageTarget, number>>;

export interface BirdDef {
  /** Радиус круга (у Чака — описанный, для отрисовки). */
  readonly radius: number;
  readonly density: number;
  readonly friction: number;
  readonly restitution: number;
  /** Множитель скорости запуска (01 §2.3). */
  readonly launchScale: number;
  /** Множители урона по целям (02 §1.1). */
  readonly mult: DamageMults;
  /** Выпуклый контур тела в локальных координатах; нет — круг radius. */
  readonly outline?: ReadonlyArray<readonly [number, number]>;
}

export interface PigDef {
  readonly radius: number;
  readonly density: number;
  readonly friction: number;
  readonly restitution: number;
  /** HP тела = hpPerKg · масса. */
  readonly hpPerKg: number;
  /** HP каски (0 — без каски). */
  readonly helmetHp: number;
  /** Очки за полный урон (помимо 5000 за уничтожение). */
  readonly damagePoints: number;
}

export const BIRD_DEFS: Readonly<Record<BirdType, BirdDef>> = BIRDS;
export const PIG_DEFS: Readonly<Record<PigType, PigDef>> = PIGS;

/** Стадия синяков свиньи 0..2 по доле оставшегося здоровья. */
export function pigStage(healthFrac: number): number {
  let stage = 0;
  for (const t of DAMAGE.PIG_STAGES) if (healthFrac < t) stage++;
  return stage;
}
