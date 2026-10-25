// Фирменные эффекты способностей (ревью «у всех птиц одно облачко и 3 пера»): у каждой птицы свой набор,
// эффекты вдоль пути рисуются по следу (призраки Чака, дуга Хэла, лента Сильвер, шлейф яйца Матильды).

import { describe, expect, it } from 'vitest';
import type { TrailPoint } from '../../core/api';
import type { BirdType } from '../../core/types';
import type { ViewInfo } from '../view';
import { ABIL_LIFE, drawAbilities, findMark, newAbil } from './abilities';
import { Fx } from './Fx';

type Inner = {
  rings: Array<{ color: string; sy: number }>;
  abils: Array<{ bird: BirdType; t: number }>;
  pops: unknown[];
  clouds: unknown[];
  pool: Array<{ kind: number; spr: number; age: number }>;
};
const inner = (fx: Fx) => fx as unknown as Inner;

/** Фейковый ctx: считает вызовы рисования. */
function fakeCtx() {
  const calls: Record<string, number> = {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, k: string) => () => {
        calls[k] = (calls[k] ?? 0) + 1;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const view: ViewInfo = { screenW: 1280, screenH: 720, camX: 12, camY: 6, scale: 40, dpr: 1, time: 0 };

/** След: прямая до отметки способности в (10, 6), дальше — n точек пути по закону pos(i). */
function trailWith(n: number, pos: (i: number) => [number, number]): TrailPoint[] {
  const t: TrailPoint[] = [];
  for (let i = 0; i < 20; i++) t.push({ x: i * 0.5, y: 6, big: false });
  t.push({ x: 10, y: 6, big: true });
  for (let i = 1; i <= n; i++) {
    const [x, y] = pos(i);
    t.push({ x, y, big: false });
  }
  return t;
}

describe('способности: у каждой птицы свой «удар»', () => {
  const sig = (bird: BirdType) => {
    const fx = new Fx();
    fx.handle({ type: 'ability', id: 1, bird, x: 10, y: 6 });
    const f = inner(fx);
    const feathers = f.pool.slice(0, fx.particleCount).filter((p) => p.kind === 2).length;
    return {
      rings: f.rings.map((r) => `${r.color}/${r.sy}`).join(','),
      path: f.abils.map((a) => a.bird).join(','),
      pops: f.pops.length,
      clouds: f.clouds.length,
      feathers,
    };
  };

  it('наборы эффектов попарно различны (а не облачко + 3 пера у всех)', () => {
    const birds: BirdType[] = ['blues', 'chuck', 'bomb', 'matilda', 'hal', 'silver'];
    const keys = birds.map((b) => JSON.stringify({ ...sig(b), feathers: 0 }));
    expect(new Set(keys).size).toBe(birds.length);
  });

  it('Чак — вспышка-кольцо и эффект вдоль пути; Синие — голубое кольцо и 3 мини-облачка', () => {
    const c = sig('chuck');
    expect(c.rings).not.toBe('');
    expect(c.path).toBe('chuck');
    expect(c.clouds).toBe(0);
    const b = sig('blues');
    expect(b.rings).toContain('#5CC8FF');
    expect(b.clouds).toBe(3);
  });

  it('Матильда — сплющенный «плюх» под птицей, 8–10 белых перьев и шлейф яйца; Бомб — вздутие', () => {
    const m = sig('matilda');
    expect(m.rings).toMatch(/\/0\.42/);
    expect(m.feathers).toBeGreaterThanOrEqual(8);
    expect(m.feathers).toBeLessThanOrEqual(10);
    expect(m.path).toBe('matilda');
    expect(sig('bomb').pops).toBe(1);
    expect(sig('hal').path).toBe('hal');
    expect(sig('silver').path).toBe('silver');
  });

  it('эффекты способностей гаснут: fx.count возвращается к нулю', () => {
    const fx = new Fx();
    for (const bird of ['blues', 'chuck', 'bomb', 'matilda', 'hal', 'silver'] as BirdType[]) fx.handle({ type: 'ability', id: 1, bird, x: 10, y: 6 });
    for (let i = 0; i < 4 * 60; i++) fx.update(1 / 60);
    expect(fx.count).toBe(0);
  });
});

describe('эффекты вдоль следа', () => {
  it('findMark находит отметку способности и переживает сдвиг следа', () => {
    const a = newAbil('chuck', 10, 6)!;
    const tr = trailWith(5, (i) => [10 + i * 0.5, 6]);
    expect(findMark(tr, a)).toBe(20);
    expect(findMark(tr.slice(2), a)).toBe(18); // след переполнился — ушли две старые точки
    expect(findMark(tr.slice(0, 20), a)).toBe(-1);
  });

  it('Чак: три призрака за кончиком следа и линии скорости; призраков нет, пока путь короче 0.9 м', () => {
    const a = newAbil('chuck', 10, 6)!;
    a.t = 0.1;
    const { ctx, calls } = fakeCtx();
    drawAbilities(ctx, view, [a], trailWith(1, (i) => [10 + i * 0.5, 6]), () => 0);
    expect(calls.arcTo ?? 0).toBe(0);
    const c2 = fakeCtx();
    const a2 = newAbil('chuck', 10, 6)!;
    a2.t = 0.1;
    drawAbilities(c2.ctx, view, [a2], trailWith(8, (i) => [10 + i * 0.5, 6 + i * 0.1]), () => 0);
    expect(c2.calls.arcTo).toBe(9); // 3 скруглённых треугольника
    expect(c2.calls.stroke).toBe(1); // линии скорости — один путь
    // после жизни — ничего
    const c3 = fakeCtx();
    a2.t = ABIL_LIFE.chuck! + 0.01;
    drawAbilities(c3.ctx, view, [a2], trailWith(8, (i) => [10 + i * 0.5, 6]), () => 0);
    expect(c3.calls.fill ?? 0).toBe(0);
  });

  it('Сильвер: лента по петле (заливка), путь замирает после петли; Хэл: дуга с сердцевиной и боковыми линиями', () => {
    const R = 1.5;
    const loop = (i: number): [number, number] => {
      const a = -Math.PI / 2 + (i * 0.45) / R;
      return [10 + R * Math.cos(a), 6 + R + R * Math.sin(a)];
    };
    const s = newAbil('silver', 10, 6)!;
    s.t = 0.3;
    const c = fakeCtx();
    const tr = trailWith(21, loop);
    drawAbilities(c.ctx, view, [s], tr, () => 0);
    expect(c.calls.fill).toBe(2); // подложка + белая лента
    expect(s.peakT).toBeGreaterThanOrEqual(0); // верх петли пройден — линии скорости
    expect(c.calls.stroke).toBe(1);
    s.t = 0.7;
    drawAbilities(fakeCtx().ctx, view, [s], tr, () => 0);
    expect(s.end).toBe(tr.length - 1); // путь ленты больше не растёт
    const h = newAbil('hal', 10, 6)!;
    h.t = 0.2;
    const ch = fakeCtx();
    drawAbilities(ch.ctx, view, [h], trailWith(10, (i) => [10 + i * 0.4, 6 + Math.sin(i * 0.3)]), () => 0);
    expect(ch.calls.fill).toBe(4);
  });

  it('Матильда: шлейф яйца рисуется, пока яйцо не взорвалось', () => {
    const fx = new Fx();
    fx.handle({ type: 'ability', id: 1, bird: 'matilda', x: 10, y: 8 });
    fx.update(0.05);
    const c = fakeCtx();
    fx.drawUnder(c.ctx, view, []);
    expect(c.calls.fill).toBe(1);
    fx.handle({ type: 'explosion', x: 10, y: 3, radius: 2.5, source: 'egg' });
    const c2 = fakeCtx();
    fx.drawUnder(c2.ctx, view, []);
    expect(c2.calls.fill ?? 0).toBe(0);
  });
});
