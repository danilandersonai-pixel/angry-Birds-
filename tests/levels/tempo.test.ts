// Темп между выстрелами на уровнях кампании (ревью «арт и ощущения»): от первого удара птицы до готовности следующей.
// Ядро без экрана: задержка камеры по своим часам (LINGER_MIN, пока идут разрушения), прыжок птицы — во время возврата.
// Выстрелы — фиксированный набор (прямой, средний, навесной, слабый), тап способности — через заданное время.

import { describe, expect, it } from 'vitest';
import { RETIRE, TIMING, CAMERA } from '../../src/config/constants';
import { createSession } from '../../src/core';
import { ALL_LEVELS } from '../../src/levels';

const SHOTS: Array<[angle: number, power: number, tap: number]> = [[12, 1, 0.6], [25, 0.95, 0.8], [40, 0.9, 1.0], [8, 0.85, 0.5]];

/** Удар → ready по ходам всех уровней (ходы, после которых уровень кончился, не считаются). */
function measure(): number[] {
  const out: number[] = [];
  for (const lv of ALL_LEVELS) {
    const s = createSession(lv, { seed: 1 });
    for (const [angle, power, tap] of SHOTS) {
      for (let i = 0; i < 600 && s.state !== 'ready'; i++) {
        s.step();
        s.drainEvents();
      }
      if (s.state !== 'ready' || s.birdsLeft < 2 || s.pigsLeft === 0) break;
      s.launch(angle, power);
      const t0 = s.time;
      let hit = -1;
      let tapped = false;
      for (let i = 0; i < 60 * 20 && s.state !== 'ready' && s.state !== 'bonus' && s.state !== 'won' && s.state !== 'lost'; i++) {
        if (!tapped && s.state === 'flying' && s.time - t0 >= tap) {
          tapped = true;
          s.activateAbility();
        }
        s.step();
        for (const e of s.drainEvents()) if (e.type === 'birdImpact' && hit < 0) hit = s.time;
      }
      if (s.state === 'ready' && hit >= 0) out.push(s.time - hit);
    }
  }
  return out.sort((a, b) => a - b);
}

describe('темп между выстрелами', () => {
  it('удар → следующая птица в рогатке: медиана ≤ 3 с, 80 % ≤ 4 с, не дольше предела ухода + задержки + возврата', () => {
    const t = measure();
    expect(t.length).toBeGreaterThan(40);
    const q = (k: number) => t[Math.min(t.length - 1, Math.floor(k * t.length))];
    expect(q(0.5)).toBeLessThanOrEqual(3.0);
    expect(q(0.8)).toBeLessThanOrEqual(4.0);
    expect(t[t.length - 1]).toBeLessThanOrEqual(RETIRE.MAX_AFTER_HIT + TIMING.LINGER_MAX + CAMERA.RETURN_MAX + 1e-6);
  });
});
