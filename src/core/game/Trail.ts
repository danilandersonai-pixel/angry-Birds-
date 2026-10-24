// След полёта: точки по пройденному пути до первого контакта; крупные — в месте способности и удара (01 §3.3).

import { TRAIL } from '../../config/constants';
import type { TrailPoint } from '../api';
import type { Flyer } from './Flyer';

export class Trail {
  readonly points: TrailPoint[] = [];

  clear(): void {
    this.points.length = 0;
  }

  mark(x: number, y: number): void {
    this.push(x, y, true);
  }

  /** Добавляет точки через каждые TRAIL.STEP метров пути птицы за последний шаг. */
  follow(f: Flyer): void {
    const p = f.ent.body.getPosition();
    const dx = p.x - f.trailX;
    const dy = p.y - f.trailY;
    const len = Math.hypot(dx, dy);
    let at = TRAIL.STEP - f.trailCarry; // путь вдоль отрезка до следующей точки
    while (at <= len) {
      const k = at / len;
      this.push(f.trailX + dx * k, f.trailY + dy * k, false);
      at += TRAIL.STEP;
    }
    f.trailCarry = TRAIL.STEP - (at - len);
    f.trailX = p.x;
    f.trailY = p.y;
  }

  private push(x: number, y: number, big: boolean): void {
    if (this.points.length < TRAIL.MAX_POINTS) this.points.push({ x, y, big });
  }
}
