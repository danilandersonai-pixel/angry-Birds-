// Очки (01 §9): урон начисляется молча пропорционально снятому HP; при уничтожении — базовые очки
// плюс ещё не начисленный остаток урона (одно всплывающее число). Бонус птиц не блокируется.

import { SCORE } from '../../config/constants';
import { PIG_DEFS } from '../characters';
import { MATERIAL_DEFS } from '../materials';
import type { Destructible } from '../physics/entities';
import type { StarThresholds } from '../types';

/** Очки за полный урон тела. */
function damageValue(e: Destructible): number {
  switch (e.kind) {
    case 'block':
      return MATERIAL_DEFS[e.material].damagePointsPerM2 * e.area;
    case 'pig':
      return PIG_DEFS[e.type].damagePoints;
    case 'tnt':
      return 0;
  }
}

function destroyValue(e: Destructible): number {
  return e.kind === 'pig' ? SCORE.PIG : e.kind === 'tnt' ? SCORE.TNT : SCORE.BLOCK;
}

export class Scoring {
  score = 0;
  /** После победы/поражения физика очков не приносит. */
  locked = false;
  private fraction = 0;
  /** Снятое HP, за которое очки уже начислены. */
  private readonly credited = new Map<number, number>();

  damage(e: Destructible, applied: number): void {
    if (this.locked || applied <= 0) return;
    this.credited.set(e.id, (this.credited.get(e.id) ?? 0) + applied);
    this.fraction += (damageValue(e) * applied) / e.maxHp;
    const whole = Math.floor(this.fraction);
    this.score += whole;
    this.fraction -= whole;
  }

  /** Очки за уничтожение (0, если счёт заблокирован). */
  destroy(e: Destructible): number {
    const rest = Math.max(0, e.maxHp - (this.credited.get(e.id) ?? 0));
    this.credited.delete(e.id);
    if (this.locked) return 0;
    const points = Math.round(destroyValue(e) + (damageValue(e) * rest) / e.maxHp);
    this.score += points;
    return points;
  }

  bonus(points: number): void {
    this.score += points;
  }
}

/** Звёзды за счёт при победе: 1 + (≥ two) + (≥ three); счёт ниже one — 0. */
export function starsFor(score: number, t: StarThresholds): number {
  if (score < t.one) return 0;
  return 1 + (score >= t.two ? 1 : 0) + (score >= t.three ? 1 : 0);
}
