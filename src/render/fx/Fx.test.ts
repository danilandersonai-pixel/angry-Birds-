// Юнит-тесты эффектов (Node, без холста): лимиты пула, очки, тряска, сопоставление событий.

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../core/events';
import { Fx } from './Fx';
import { drawTrail } from './trail';
import { buildGround } from './ground';
import type { ViewInfo } from '../view';

const destroyed = (material: 'wood' | 'ice' | 'stone', x = 0, y = 1, w = 2, h = 0.5): GameEvent => ({
  type: 'blockDestroyed',
  id: 1,
  material,
  shape: 'rect',
  x,
  y,
  w,
  h,
  angle: 0.3,
  vx: 2,
  vy: 1,
  points: 500,
});

function run(fx: Fx, seconds: number, dt = 1 / 60): void {
  for (let t = 0; t < seconds; t += dt) fx.update(dt);
}

describe('Fx', () => {
  it('порождает частицы на каждое значимое событие и всё гаснет', () => {
    const fx = new Fx();
    const events: GameEvent[] = [
      destroyed('wood'),
      destroyed('ice'),
      destroyed('stone'),
      { type: 'blockDamaged', id: 2, material: 'stone', x: 1, y: 1, stage: 2 },
      { type: 'impact', x: 0, y: 0, impulse: 8, a: 'bird', b: 'wood' },
      { type: 'impact', x: 0, y: 0, impulse: 8, a: 'pig', b: 'ground' },
      { type: 'birdImpact', id: 3, bird: 'red', x: 0, y: 1, speed: 20 },
      { type: 'birdLaunched', id: 3, bird: 'chuck', x: 0, y: 2.7, power: 1 },
      { type: 'birdRemoved', id: 3, bird: 'terence', x: 5, y: 1 },
      { type: 'ability', id: 3, bird: 'blues', x: 5, y: 5 },
      { type: 'pigDamaged', id: 4, pig: 'helmet', x: 8, y: 1, stage: 1, helmetLost: true },
      { type: 'pigDestroyed', id: 4, pig: 'large', x: 8, y: 1, radius: 0.83, points: 5000 },
      { type: 'tntDestroyed', id: 5, x: 10, y: 0.5, points: 500 },
      { type: 'explosion', x: 10, y: 0.5, radius: 3, source: 'tnt' },
      { type: 'explosion', x: 12, y: 3, radius: 2.5, source: 'egg' },
      { type: 'score', points: 5000, x: 8, y: 1, kind: 'pig' },
      { type: 'birdBonus', bird: 'red', x: -2, y: 0.5, points: 10000 },
    ];
    let before = fx.count;
    for (const e of events) {
      fx.handle(e);
      expect(fx.count, e.type).toBeGreaterThan(before);
      before = fx.count;
      fx.update(1 / 60); // сбросить покадровый лимит рождения
    }
    run(fx, 4);
    expect(fx.count).toBe(0);
  });

  it('игнорирует события без визуальной реакции', () => {
    const fx = new Fx();
    fx.handle({ type: 'stateChanged', from: 'ready', to: 'aiming' });
    fx.handle({ type: 'aimStretch', power: 0.5 });
    fx.handle({ type: 'pigsLaugh' });
    fx.handle({ type: 'levelEnd', won: true, score: 1, stars: 3 });
    fx.handle({ type: 'impact', x: 0, y: 0, impulse: 1, a: 'wood', b: 'wood' });
    expect(fx.count).toBe(0);
  });

  it('не превышает лимит частиц, очки не вытесняются', () => {
    const fx = new Fx();
    for (let i = 0; i < 40; i++) fx.handle({ type: 'score', points: 5000, x: i * 3, y: 1, kind: 'pig' });
    for (let k = 0; k < 30; k++) {
      for (let i = 0; i < 10; i++) {
        fx.handle(destroyed('ice', i, 1, 4, 1));
        fx.handle({ type: 'explosion', x: i, y: 1, radius: 3.5, source: 'bomb' });
      }
      expect(fx.particleCount).toBeLessThanOrEqual(fx.particleLimit);
      fx.update(1 / 60);
    }
    expect(fx.particleCount).toBeLessThanOrEqual(600);
    expect(fx.particleCount).toBeGreaterThan(300);
    expect(fx.popupCount).toBe(40);
  });

  it('уменьшение качества режет лимит', () => {
    const fx = new Fx();
    for (let i = 0; i < 20; i++) {
      fx.handle(destroyed('ice', i, 1, 4, 1));
      fx.update(1 / 60);
    }
    fx.setQuality('low');
    expect(fx.particleCount).toBeLessThanOrEqual(250);
  });

  it('тряска: взрыв и сильный удар, слабый — нет; запрос забирается один раз', () => {
    const fx = new Fx();
    expect(fx.takeShake()).toBeNull();
    fx.handle({ type: 'impact', x: 0, y: 0, impulse: 5, a: 'bird', b: 'wood' });
    expect(fx.takeShake()).toBeNull();
    fx.handle({ type: 'impact', x: 0, y: 0, impulse: 40, a: 'bird', b: 'stone' });
    const s1 = fx.takeShake();
    expect(s1?.amount).toBeCloseTo(0.1, 5);
    fx.handle({ type: 'explosion', x: 0, y: 0, radius: 2, source: 'bomb' });
    const s2 = fx.takeShake();
    expect(s2?.amount).toBeCloseTo(0.24, 5);
    expect(s2?.duration).toBeCloseTo(0.35, 5);
    expect(fx.takeShake()).toBeNull();
    // несколько взрывов за кадр складываются, но не больше 0.35 м
    fx.handle({ type: 'explosion', x: 0, y: 0, radius: 3.5, source: 'bomb' });
    fx.handle({ type: 'explosion', x: 1, y: 0, radius: 3, source: 'tnt' });
    expect(fx.takeShake()?.amount).toBe(0.35);
  });

  it('prewarm без DOM — no-op', () => {
    expect(new Fx().prewarm(60)).toBe(0);
  });

  it('clear() убирает всё', () => {
    const fx = new Fx();
    fx.handle(destroyed('wood'));
    fx.handle({ type: 'explosion', x: 0, y: 0, radius: 3, source: 'tnt' });
    fx.handle({ type: 'score', points: 500, x: 0, y: 1, kind: 'block' });
    fx.clear();
    expect(fx.count).toBe(0);
    expect(fx.takeShake()).toBeNull();
  });
});

describe('всплывающие очки', () => {
  const peek = (fx: Fx) => (fx as unknown as { popups: { list: Array<{ text: string; style: { fill: string }; yOff: number }> } }).popups.list;

  it('цвет блока берётся из blockDestroyed в той же точке (в любом порядке)', () => {
    const fx = new Fx();
    fx.handle(destroyed('ice', 0, 1));
    fx.handle({ type: 'score', points: 500, x: 0, y: 1, kind: 'block' });
    fx.handle({ type: 'score', points: 500, x: 10, y: 1, kind: 'block' });
    fx.handle(destroyed('wood', 10, 1));
    const l = peek(fx);
    expect(l).toHaveLength(2);
    expect(l[0].style.fill).toBe('#9FE3FF');
    expect(l[1].style.fill).toBe('#F2A541');
  });

  it('блок без материала — белый; свинья — зелёная', () => {
    const fx = new Fx();
    fx.handle({ type: 'score', points: 500, x: 0, y: 1, kind: 'block' });
    fx.handle({ type: 'score', points: 5000, x: 5, y: 1, kind: 'pig' });
    const l = peek(fx);
    expect(l[0].style.fill).toBe('#FFFFFF');
    expect(l[1].style.fill).toBe('#8BD62E');
  });

  it('разрушения блоков рядом за 0.25 с складываются, свиньи — нет', () => {
    const fx = new Fx();
    fx.handle({ type: 'score', points: 500, x: 0, y: 1, kind: 'block' });
    run(fx, 0.1);
    fx.handle({ type: 'score', points: 520, x: 0.8, y: 1.2, kind: 'block' });
    fx.handle({ type: 'score', points: 500, x: 5, y: 1, kind: 'block' }); // далеко — отдельно
    fx.handle({ type: 'score', points: 5000, x: 0, y: 1, kind: 'pig' });
    fx.handle({ type: 'score', points: 5000, x: 0.2, y: 1, kind: 'pig' });
    const l = peek(fx);
    expect(l.map((p) => p.text)).toEqual(['1020', '500', '5000', '5000']);
    run(fx, 0.3); // update ограничивает dt 0.1 с — идём мелкими шагами
    fx.handle({ type: 'score', points: 500, x: 0, y: 1, kind: 'block' }); // окно прошло
    expect(peek(fx)).toHaveLength(5);
  });

  it('перекрывающиеся числа разводятся по высоте', () => {
    const fx = new Fx();
    fx.handle({ type: 'score', points: 5000, x: 0, y: 1, kind: 'pig' });
    fx.handle({ type: 'score', points: 5000, x: 0.3, y: 1, kind: 'pig' });
    const l = peek(fx);
    expect(l[1].yOff).toBeGreaterThan(0.4);
  });

  it('бонус птицы: цвет птицы, дубль score{bonus} не плодит второе число', () => {
    const fx = new Fx();
    fx.handle({ type: 'birdBonus', bird: 'chuck', x: -3, y: 0.5, points: 10000 });
    fx.handle({ type: 'score', points: 10000, x: -3, y: 0.5, kind: 'bonus' });
    fx.handle({ type: 'score', points: 10000, x: -5, y: 0.5, kind: 'bonus' });
    fx.handle({ type: 'birdBonus', bird: 'blues', x: -5, y: 0.5, points: 10000 });
    const l = peek(fx);
    expect(l).toHaveLength(2);
    expect(l[0].style.fill).toBe('#FFD21F');
    expect(l[1].style.fill).toBe('#4BA7E8');
  });

  it('число свиньи поднимается над ней на r + 0.3 (в любом порядке событий)', () => {
    const fx = new Fx();
    fx.handle({ type: 'pigDestroyed', id: 1, pig: 'medium', x: 0, y: 1, radius: 0.6, points: 5000 });
    fx.handle({ type: 'score', points: 5000, x: 0, y: 1, kind: 'pig' });
    fx.handle({ type: 'score', points: 5000, x: 10, y: 1, kind: 'pig' });
    fx.handle({ type: 'pigDestroyed', id: 2, pig: 'large', x: 10, y: 1, radius: 0.8, points: 5000 });
    const l = peek(fx) as unknown as Array<{ y: number }>;
    expect(l[0].y).toBeCloseTo(1.9, 5);
    expect(l[1].y).toBeCloseTo(2.1, 5);
  });

  it('живёт около секунды', () => {
    const fx = new Fx();
    fx.handle({ type: 'score', points: 500, x: 0, y: 1, kind: 'block' });
    run(fx, 0.9);
    expect(fx.popupCount).toBe(1);
    run(fx, 0.2);
    expect(fx.popupCount).toBe(0);
  });
});

describe('drawTrail', () => {
  it('рисует все точки одним fill и одним stroke', () => {
    const calls: string[] = [];
    let arcs = 0;
    const ctx = new Proxy(
      {},
      {
        get(_t, k: string) {
          if (k === 'arc') return () => arcs++;
          if (k === 'fill' || k === 'stroke') return () => calls.push(k);
          return () => undefined;
        },
        set() {
          return true;
        },
      },
    ) as unknown as CanvasRenderingContext2D;
    const view: ViewInfo = { screenW: 1600, screenH: 900, camX: 10, camY: 6, scale: 60, dpr: 1, time: 1 };
    const pts = Array.from({ length: 30 }, (_, i) => ({ x: i * 0.45, y: 3 + i * 0.1, big: i === 10 }));
    drawTrail(ctx, view, pts);
    expect(arcs).toBe(30);
    expect(calls).toEqual(['fill', 'stroke']);
  });
});

describe('ground', () => {
  it('высота по верхним рёбрам рельефа', () => {
    const g = buildGround([
      { kind: 'ground', points: [[-50, -5], [50, -5], [50, 0], [-50, 0]] },
      { kind: 'rock', points: [[10, 0], [14, 0], [14, 3], [10, 3]] },
    ]);
    expect(g(0)).toBeCloseTo(0, 5);
    expect(g(12)).toBeCloseTo(3, 5);
    expect(g(100)).toBe(-Infinity);
  });
});
