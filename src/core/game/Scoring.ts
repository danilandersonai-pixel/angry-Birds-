// Очки (00 §1.11): урон начисляется молча пропорционально снятому запасу прочности (у свиньи в каске — HP тела
// и каски вместе). При уничтожении блока всплывает 500 плюс ещё не начисленный остаток урона, у свиньи — ровно 5000,
// а её остаток урона уходит в счёт молча. Бонус птиц не блокируется.
// Как в AB, счёт и всплывающие числа всегда кратны 10 (STEP): урон идёт в счёт десятками, дробь копится.

import { SCORE } from '../../config/constants';
import { PIG_DEFS } from '../characters';
import { MATERIAL_DEFS } from '../materials';
import type { Destructible } from '../physics/entities';
import type { StarThresholds } from '../types';

const EPS = 1e-9;
/** Шаг счёта: счёт и всплывающие числа кратны 10. */
const STEP = 10;

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

export class Scoring {
  score = 0;
  /** После победы/поражения физика очков не приносит. */
  locked = false;
  /** Ещё не начисленный остаток очков (после округления при разрушении блока может быть до −STEP/2). */
  private fraction = 0;
  /** Снятый запас прочности, за который очки уже начислены. */
  private readonly credited = new Map<number, number>();

  damage(e: Destructible, applied: number): void {
    if (this.locked || applied <= 0) return;
    this.credited.set(e.id, (this.credited.get(e.id) ?? 0) + applied);
    this.addSilently((damageValue(e) * applied) / e.scoreHp);
  }

  /**
   * Уничтожение: начисляет очки и возвращает всплывающее число (0, если счёт заблокирован), кратное 10.
   * Остаток урона не теряется: у блока входит в число (с округлением до 10), у свиньи копится молча; TNT — ровно 500.
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
    if (e.kind === 'tnt') {
      this.score += SCORE.TNT;
      return SCORE.TNT;
    }
    const exact = SCORE.BLOCK + restPoints + this.fraction;
    const points = Math.round(exact / STEP) * STEP;
    this.fraction = exact - points;
    this.score += points;
    return points;
  }

  bonus(points: number): void {
    this.score += points;
  }

  /** Молчаливое начисление: в счёт идут целые десятки, остаток копится (EPS гасит ошибку округления: 100·x/x → 99.999…). */
  private addSilently(points: number): void {
    this.fraction += points;
    const whole = Math.floor((this.fraction + EPS) / STEP) * STEP;
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
