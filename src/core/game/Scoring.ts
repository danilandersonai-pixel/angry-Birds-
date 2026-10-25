// Очки (00 §1.11): урон начисляется молча пропорционально снятому запасу прочности (у свиньи в каске — HP тела
// и каски вместе). При уничтожении блока всплывает 500 плюс ещё не начисленный остаток урона, у свиньи — ровно 5000,
// а её остаток урона уходит в счёт молча. Бонус птиц не блокируется.

import { SCORE } from '../../config/constants';
import { PIG_DEFS } from '../characters';
import { MATERIAL_DEFS } from '../materials';
import type { BlockEnt, Destructible, TntEnt } from '../physics/entities';
import type { StarThresholds } from '../types';

const EPS = 1e-9;

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

function destroyValue(e: BlockEnt | TntEnt): number {
  return e.kind === 'tnt' ? SCORE.TNT : SCORE.BLOCK;
}

export class Scoring {
  score = 0;
  /** После победы/поражения физика очков не приносит. */
  locked = false;
  /** Ещё не начисленная дробь очков (после округления при разрушении блока может быть до −0.5). */
  private fraction = 0;
  /** Снятый запас прочности, за который очки уже начислены. */
  private readonly credited = new Map<number, number>();

  damage(e: Destructible, applied: number): void {
    if (this.locked || applied <= 0) return;
    this.credited.set(e.id, (this.credited.get(e.id) ?? 0) + applied);
    this.addSilently((damageValue(e) * applied) / e.scoreHp);
  }

  /**
   * Уничтожение: начисляет очки и возвращает всплывающее число (0, если счёт заблокирован).
   * Дробный остаток урона не теряется: у блока входит в число, у свиньи копится молча.
   */
  destroy(e: Destructible): number {
    const rest = Math.max(0, e.scoreHp - (this.credited.get(e.id) ?? 0));
    this.credited.delete(e.id);
    if (this.locked) return 0;
    const restPoints = (damageValue(e) * rest) / e.scoreHp;
    if (e.kind === 'pig') {
      this.score += SCORE.PIG;
      this.addSilently(restPoints);
      return SCORE.PIG;
    }
    const exact = destroyValue(e) + restPoints + this.fraction;
    const points = Math.round(exact);
    this.fraction = exact - points;
    this.score += points;
    return points;
  }

  bonus(points: number): void {
    this.score += points;
  }

  /** Молчаливое начисление: в счёт идут целые очки, дробь копится (EPS гасит ошибку округления: 100·x/x → 99.999…). */
  private addSilently(points: number): void {
    this.fraction += points;
    const whole = Math.floor(this.fraction + EPS);
    if (whole <= 0) return;
    this.score += whole;
    this.fraction -= whole;
  }
}

/** Звёзды за счёт: 1 + (≥ two) + (≥ three); счёт ниже one — 0. */
export function starsFor(score: number, t: StarThresholds): number {
  if (score < t.one) return 0;
  return 1 + (score >= t.two ? 1 : 0) + (score >= t.three ? 1 : 0);
}
