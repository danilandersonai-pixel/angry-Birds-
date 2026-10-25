// Ступени качества холста: на мониторе с dpr 1 MED и LOW тоже уменьшают число пикселей (масштаб рендера < 1).

import { describe, expect, it } from 'vitest';
import { backingRatio } from '../../src/app/CanvasHost';

describe('backingRatio: пикселей холста на CSS px по ступеням качества', () => {
  it('dpr 1: HIGH 1, MED 0.85, LOW 0.7 — рычаг числа пикселей есть и без retina', () => {
    expect(backingRatio(1, 'high')).toBe(1);
    expect(backingRatio(1, 'med')).toBeCloseTo(0.85, 9);
    expect(backingRatio(1, 'low')).toBeCloseTo(0.7, 9);
    // 1600×900: LOW — около половины пикселей HIGH
    const px = (q: 'high' | 'med' | 'low') => Math.round(1600 * backingRatio(1, q)) * Math.round(900 * backingRatio(1, q));
    expect(px('low') / px('high')).toBeLessThan(0.5);
    expect(px('med') / px('high')).toBeLessThan(0.75);
  });

  it('dpr 2 и 3: как раньше — потолок dpr 2 / 1.5 / 1', () => {
    for (const d of [2, 3]) {
      expect(backingRatio(d, 'high')).toBe(2);
      expect(backingRatio(d, 'med')).toBe(1.5);
      expect(backingRatio(d, 'low')).toBe(1);
    }
  });

  it('промежуточный dpr 1.25 и мусор: ступени строго убывают, не меньше 0.5', () => {
    const h = backingRatio(1.25, 'high');
    const m = backingRatio(1.25, 'med');
    const l = backingRatio(1.25, 'low');
    expect(h).toBe(1.25);
    expect(m).toBeLessThan(h);
    expect(l).toBeLessThan(m);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = backingRatio(bad, 'low');
      expect(Number.isFinite(r) && r >= 0.5).toBe(true);
    }
    expect(backingRatio(0.25, 'low')).toBe(0.5);
  });
});
