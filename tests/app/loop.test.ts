// Накопитель фиксированного шага: ровно 1/60, не больше 4 шагов за кадр, остаток долгого кадра выбрасывается.

import { describe, expect, it } from 'vitest';
import { advance } from '../../src/app/loop';

const DT = 1 / 60;

describe('advance', () => {
  it('кадр 1/60 — один шаг', () => {
    let n = 0;
    const r = advance(0, DT, DT, 4, () => n++);
    expect(n).toBe(1);
    expect(r.acc).toBeLessThan(1e-6);
  });

  it('120 Гц — шаг через кадр, время сходится', () => {
    let n = 0;
    let acc = 0;
    for (let i = 0; i < 240; i++) acc = advance(acc, 1 / 120, DT, 4, () => n++).acc;
    expect(n).toBeGreaterThanOrEqual(119);
    expect(n).toBeLessThanOrEqual(120);
  });

  it('долгий кадр (вкладка вернулась) — не больше 4 шагов, остаток меньше шага', () => {
    let n = 0;
    const r = advance(0, 5, DT, 4, () => n++);
    expect(n).toBe(4);
    expect(r.acc).toBeLessThan(DT);
  });

  it('мусорный dt не ломает накопитель', () => {
    let n = 0;
    expect(advance(0, NaN, DT, 4, () => n++).acc).toBe(0);
    expect(advance(0, -1, DT, 4, () => n++).acc).toBe(0);
    expect(n).toBe(0);
  });
});
