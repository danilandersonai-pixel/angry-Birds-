// Автокачество по интервалам rAF и CPU-времени: тяжёлая перегрузка — сразу LOW за ~1 с, выпадающие кадры при
// дешёвом JS тоже видны, 120/30 Гц не путают, повышение — медленно и без качелей.

import { describe, expect, it } from 'vitest';
import type { QualityLevel } from '../../src/app/CanvasHost';
import { AUTO_Q, AutoQuality } from '../../src/app/quality';

/** Прогнать кадры: интервал dt(i) мс, CPU cpu(i) мс, пока не пройдёт sec; вернуть смены ступени [время, ступень]. */
function run(
  a: AutoQuality,
  sec: number,
  dt: (i: number) => number,
  cpu: (i: number) => number,
  q0: QualityLevel = 'high',
  t0 = 0,
): { q: QualityLevel; changes: Array<[number, QualityLevel]>; t: number } {
  let q = q0;
  let t = t0;
  const changes: Array<[number, QualityLevel]> = [];
  for (let i = 0; t < t0 + sec; i++) {
    const d = dt(i);
    t += d / 1000;
    const r = a.frame(d, cpu(i), t, q);
    if (r) {
      q = r;
      changes.push([t - t0, r]);
    }
  }
  return { q, changes, t };
}

describe('AutoQuality', () => {
  it('тяжёлая перегрузка (10 fps): сразу LOW чуть больше чем за 1 с, а не за 15 с', () => {
    const a = new AutoQuality();
    const r = run(a, 3, () => 100, () => 4);
    expect(r.changes.length).toBe(1);
    expect(r.changes[0][1]).toBe('low');
    expect(r.changes[0][0]).toBeLessThan(1.3);
    // и по CPU (JS-кадр 30 мс при 33 мс интервале)
    const b = run(new AutoQuality(), 3, () => 33.3, () => 30);
    expect(b.changes[0]?.[1]).toBe('low');
  });

  it('53 fps с выпадающими кадрами (каждый 6-й — 33 мс) при JS 2 мс — ступень вниз; ровные 60 fps — нет', () => {
    const r = run(new AutoQuality(), 4, (i) => (i % 6 === 5 ? 33.4 : 16.7), () => 2);
    expect(r.changes[0]?.[1]).toBe('med');
    expect(r.changes[0][0]).toBeLessThan(2.5);
    const ok = run(new AutoQuality(), 30, (i) => 16.7 + (i % 3) * 0.3, () => 3);
    expect(ok.changes).toEqual([]);
  });

  it('понижение не чаще раза в 2.5 с: med → low через ≥ 2.5 с', () => {
    const r = run(new AutoQuality(), 8, (i) => (i % 4 === 3 ? 40 : 16.7), () => 3);
    expect(r.changes.map((c) => c[1])).toEqual(['med', 'low']);
    expect(r.changes[1][0] - r.changes[0][0]).toBeGreaterThanOrEqual(AUTO_Q.DOWN_COOLDOWN_S - 1e-9);
  });

  it('120 Гц: 60 fps — не медленно; 30 Гц (экономия батареи): 33 мс — норма, 50 мс — медленно', () => {
    const hz120 = new AutoQuality();
    for (let i = 0; i < 60; i++) hz120.observePeriod(8.33);
    expect(hz120.period).toBeCloseTo(8.33, 2);
    expect(hz120.target).toBeCloseTo(1000 / 60, 6);
    expect(run(hz120, 10, () => 16.7, () => 4).changes).toEqual([]);
    const hz30 = new AutoQuality();
    for (let i = 0; i < 60; i++) hz30.observePeriod(33.3 + (i % 2) * 0.4);
    expect(run(hz30, 10, () => 33.4, () => 4).changes).toEqual([]);
    expect(run(new AutoQuality(), 3, () => 33.4, () => 4).changes[0]?.[1]).toBe('med'); // на 60 Гц 30 fps — медленно
  });

  it('вверх: 5 с быстрых кадров и не раньше 10 с после смены; после двух понижений — не идём', () => {
    const a = new AutoQuality();
    const down = run(a, 2, () => 33.4, () => 4);
    expect(down.q).toBe('med');
    const up = run(a, 20, () => 16.7, () => 2, down.q, down.t);
    expect(up.changes.length).toBe(1);
    expect(up.changes[0][1]).toBe('high');
    expect(down.t + up.changes[0][0] - down.changes[0][0]).toBeGreaterThanOrEqual(AUTO_Q.UP_COOLDOWN_S - 1e-9); // ≥ 10 с от понижения
    const again = run(a, 4, () => 100, () => 4, 'high', up.t);
    expect(again.q).toBe('low');
    expect(a.downgrades).toBe(2);
    expect(run(a, 30, () => 16.7, () => 2, 'low', again.t).changes).toEqual([]);
  });

  it('мусор в интервалах и периоде не ломает оценку; reset забывает окно', () => {
    const a = new AutoQuality();
    a.observePeriod(Number.NaN);
    a.observePeriod(-5);
    a.observePeriod(5000);
    expect(a.period).toBeCloseTo(1000 / 60, 6);
    expect(a.frame(Number.NaN, 3, 1, 'high')).toBeNull();
    run(a, 0.8, () => 100, () => 4);
    a.reset();
    // после reset окно пустое: следующей 0.5 с перегрузки мало для решения
    expect(run(a, 0.5, () => 100, () => 4, 'high', 10).changes).toEqual([]);
  });
});
