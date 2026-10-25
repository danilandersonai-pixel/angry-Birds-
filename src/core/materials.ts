// Таблица материалов блоков и ящика TNT (числа — config/constants.ts, 03 §3.3).

import { DAMAGE, MATERIALS, TNT } from '../config/constants';
import type { Material } from './types';

export interface MaterialDef {
  /** Плотность, кг/м² (2D). */
  readonly density: number;
  readonly friction: number;
  readonly restitution: number;
  /** Порог урона: J0 = масса · v0 (03 §3.6). */
  readonly v0: number;
  /** HP = hpPerKg · масса. */
  readonly hpPerKg: number;
  /** Множитель урона от взрыва. */
  readonly blastMult: number;
  /** Очки за полный урон на м² визуальной площади. */
  readonly damagePointsPerM2: number;
}

export const MATERIAL_DEFS: Readonly<Record<Material, MaterialDef>> = MATERIALS;
export const TNT_DEF: MaterialDef = TNT;

/** Стадия трещин блока 0..3 по доле оставшегося здоровья. */
export function blockStage(healthFrac: number): number {
  let stage = 0;
  for (const t of DAMAGE.BLOCK_STAGES) if (healthFrac < t) stage++;
  return stage;
}
