// Выражения свиней (00 §1.5, 02 §4.3): пугаются приближающейся птицы, смеются после промаха и при поражении.
// Моргание и дразнилки добавляет рендер.

import { PIG_MOOD } from '../../config/constants';
import type { PigPose } from '../api';
import type { Rng } from '../rng';
import type { Vec } from '../types';

interface Mood {
  laughFrom: number;
  laughUntil: number;
  scaredUntil: number;
}

/** Летящее тело, которого свинья может испугаться. */
export interface Threat {
  readonly p: Vec;
  readonly v: Vec;
}

export class PigMoods {
  private readonly moods = new Map<number, Mood>();

  add(id: number): void {
    this.moods.set(id, { laughFrom: 0, laughUntil: 0, scaredUntil: 0 });
  }

  remove(id: number): void {
    this.moods.delete(id);
  }

  /** Смех после промаха: у каждой свиньи свой небольшой сдвиг начала. */
  laugh(now: number, rng: Rng): void {
    for (const m of this.moods.values()) {
      m.laughFrom = now + rng.range(0, PIG_MOOD.LAUGH_JITTER);
      m.laughUntil = m.laughFrom + PIG_MOOD.LAUGH_TIME;
    }
  }

  /** Поза свиньи id в точке p. */
  pose(id: number, p: Vec, now: number, threats: readonly Threat[], lost: boolean): PigPose {
    const m = this.moods.get(id);
    if (!m) return 'idle';
    const r2 = PIG_MOOD.SCARED_DIST * PIG_MOOD.SCARED_DIST;
    for (const t of threats) {
      const dx = p.x - t.p.x;
      const dy = p.y - t.p.y;
      if (dx * dx + dy * dy < r2 && dx * t.v.x + dy * t.v.y > 0) m.scaredUntil = now + PIG_MOOD.SCARED_HOLD;
    }
    if (lost) return 'laugh';
    if (now < m.scaredUntil) return 'scared';
    return now >= m.laughFrom && now < m.laughUntil ? 'laugh' : 'idle';
  }
}
