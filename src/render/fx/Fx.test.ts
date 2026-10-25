// Юнит-тесты эффектов (Node, без холста): лимиты пула, очки, тряска, сопоставление событий.

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../core/events';
import { FIRE_HOT, fireHeat, Fx, RUNTIME_DUSTS } from './Fx';
import { drawTrail } from './trail';
import { buildGround } from './ground';
import { FX_SPRITES, puffSprite, softPuffSprite, SPR_SMOKE_DARK, SPR_SMOKE_LIGHT, SPR_SMOKE_WHITE } from './sprites';
import { GROUND_DUST, SMOKE, SMOKE_ALPHA_MAX } from './palette';
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

  type SmokePt = { kind: number; spr: number; age: number; life: number; x: number; y: number; alpha: number; size: number };
  const live = (fx: Fx, kind = 6) =>
    ((fx as unknown as { pool: SmokePt[] }).pool.slice(0, fx.particleCount) as SmokePt[]).filter((p) => p.kind === kind && p.age >= 0);

  it('дым взрыва: светлые клубы α ≤ 0.55, живут 0.7–0.9 с, основание ниже верха; огненное ядро ≈ 0.22 с', () => {
    const fx = new Fx();
    fx.handle({ type: 'explosion', x: 0, y: 3, radius: 3, source: 'tnt' });
    run(fx, 0.25);
    expect(live(fx).length).toBe(9); // все клубы родились, когда ядро погасло
    for (const p of live(fx)) {
      expect(p.alpha).toBeLessThanOrEqual(SMOKE_ALPHA_MAX + 1e-9);
      expect(p.life).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(p.life).toBeLessThanOrEqual(0.9 + 1e-9);
    }
    run(fx, 0.35); // t = 0.6
    const s1 = live(fx);
    const meanY = (spr: number) => {
      const l = s1.filter((p) => p.spr === spr);
      return l.reduce((a, p) => a + p.y, 0) / l.length;
    };
    expect(meanY(SPR_SMOKE_DARK)).toBeLessThan(meanY(SPR_SMOKE_LIGHT) - 1);
    run(fx, 0.55); // t ≈ 1.15 — дыма уже нет, разрушение под ним видно
    expect(live(fx).length).toBe(0);
    // ядро: горит в начале, к 0.25 с погасло
    expect(fireHeat(0.05)).toBe(1);
    expect(fireHeat(0.2)).toBeGreaterThan(0);
    expect(fireHeat(0.25)).toBe(0);
    expect(FIRE_HOT).toBeGreaterThanOrEqual(0.2);
    expect(FIRE_HOT).toBeLessThanOrEqual(0.25);
  });

  it('дым светлый: середина клубов #CFCFCF…#E8E8E8 (не тёмно-серый)', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return Math.min((n >> 16) & 255, (n >> 8) & 255, n & 255);
    };
    for (const tone of [SMOKE.base, SMOKE.warm, SMOKE.light]) {
      expect(lum(tone.mid)).toBeGreaterThanOrEqual(0xcf);
      expect(lum(tone.mid)).toBeLessThanOrEqual(0xe8);
      expect(lum(tone.bottom)).toBeGreaterThanOrEqual(0xa0); // тень снизу — тоже светлая
    }
    expect(lum(SMOKE.white.mid)).toBeGreaterThan(0xe8);
  });

  it('яйцо Матильды: белые клубы ≈ 0.6 с', () => {
    const fx = new Fx();
    fx.handle({ type: 'explosion', x: 0, y: 3, radius: 2.5, source: 'egg' });
    run(fx, 0.25);
    const s = live(fx);
    expect(s.length).toBeGreaterThanOrEqual(4);
    for (const p of s) {
      expect(p.spr).toBe(SPR_SMOKE_WHITE);
      expect(p.life).toBeLessThanOrEqual(0.6 + 1e-9);
    }
    run(fx, 0.6);
    expect(live(fx).length).toBe(0);
  });

  it('цепочка взрывов (2-9): клубы рядом с живыми не рождаются — площадь дыма не растёт', () => {
    const fx = new Fx();
    // четыре TNT через 0.117 с в пределах 1.2 м (как цепочка на 2-9)
    for (let i = 0; i < 4; i++) {
      fx.handle({ type: 'explosion', x: i * 0.4, y: 1, radius: 3, source: 'tnt' });
      run(fx, 0.117);
    }
    run(fx, 0.2);
    const n = live(fx).length;
    expect(n).toBeLessThanOrEqual(15); // было 36
    // подновлённый дым всё равно уходит: ≤ 1.3 с после последнего взрыва
    run(fx, 1.1);
    expect(live(fx).length).toBe(0);
  });

  it('дым взрыва на низком качестве — вдвое меньше клубов, но не пропадает', () => {
    const fx = new Fx();
    fx.setQuality('low');
    fx.handle({ type: 'explosion', x: 0, y: 3, radius: 3, source: 'bomb' });
    run(fx, 0.4);
    const n = ((fx as unknown as { pool: Array<{ kind: number }> }).pool.slice(0, fx.particleCount)).filter((p) => p.kind === 6).length;
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThan(9);
  });

  it('экранная вспышка: цепочка TNT сливается, не больше 3 вспышек за секунду и не чаще раза в 1/3 с (07 §19.3)', () => {
    // фейковый ctx: считаем начала вспышек по fillRect (как qa/cb/s11-flash.ts)
    const play = (times: number[], seconds = 5) => {
      const fx = new Fx();
      let alpha = 0;
      let drawn = false;
      const ctx = new Proxy({}, {
        get: (_t, k) => (k === 'fillRect' ? () => { drawn = alpha > 0.004; } : () => undefined),
        set: (_t, k, v) => { if (k === 'globalAlpha') alpha = v; return true; },
      }) as unknown as CanvasRenderingContext2D;
      const view: ViewInfo = { screenW: 100, screenH: 100, camX: 0, camY: 0, scale: 10, dpr: 1, time: 0 };
      const starts: number[] = [];
      let prev = 0;
      let on = false;
      const later = [...times];
      for (let f = 0; f < seconds * 60; f++) {
        const now = f / 60;
        while (later.length && later[0] <= now + 1e-9) {
          later.shift();
          fx.handle({ type: 'explosion', x: 0, y: 0, radius: 3, source: 'tnt' });
        }
        fx.update(1 / 60);
        alpha = 0;
        drawn = false;
        fx.drawFlash(ctx, view);
        const a = drawn ? alpha : 0;
        // начало вспышки — включение или рост яркости (второй перепад — уже новая вспышка)
        if (a > 0 && (!on || a > prev + 1e-6)) starts.push(now);
        on = a > 0;
        prev = a;
      }
      return starts;
    };
    // 2-9: четыре TNT через 0.117 с (было 4 вспышки за 0.35 с) — первые три сливаются, четвёртая — через 1/3 с
    const chain = play([3.167, 3.283, 3.4, 3.517]);
    expect(chain.length).toBeLessThanOrEqual(2);
    if (chain.length === 2) expect(chain[1] - chain[0]).toBeGreaterThanOrEqual(1 / 3 - 0.02);
    // 1-9: три TNT за 0.25 с — одна вспышка
    expect(play([1.483, 1.6, 1.717])).toHaveLength(1);
    // взрывы раз в 0.2 с полторы секунды — вспышки не чаще раза в 1/3 с и не больше 3 за любую секунду
    const st = play(Array.from({ length: 8 }, (_, i) => 0.5 + i * 0.2));
    for (let i = 1; i < st.length; i++) expect(st[i] - st[i - 1]).toBeGreaterThanOrEqual(1 / 3 - 0.02);
    for (const t of st) expect(st.filter((u) => u >= t && u < t + 1).length).toBeLessThanOrEqual(3);
    expect(st.length).toBeGreaterThanOrEqual(2);
    // далёкие взрывы — отдельные вспышки
    expect(play([0.2, 1.0, 2.0])).toHaveLength(3);
    // «меньше вспышек» — ни одной
    const fx = new Fx();
    fx.reduceFlashes = true;
    fx.handle({ type: 'explosion', x: 0, y: 0, radius: 3, source: 'tnt' });
    fx.update(1 / 60);
    expect(fx.flashAlpha).toBeGreaterThan(0.2);
    // «Уменьшить движение»: вспышка есть, но не ярче flashMax (07 §19.3: α до 0.12)
    const alphas: number[] = [];
    const ctx = { save() {}, restore() {}, setTransform() {}, fillRect() { alphas.push(this.globalAlpha); }, globalAlpha: 1, fillStyle: '' };
    const view = { screenW: 100, screenH: 50 } as never;
    fx.flashMax = 0.12;
    expect(fx.reduceFlashes).toBe(false);
    fx.drawFlash(ctx as never, view);
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeCloseTo(0.12, 5);
    fx.reduceFlashes = true;
    fx.drawFlash(ctx as never, view);
    expect(alphas).toHaveLength(1);
  });

  it('все цвета пыли, которые эмиттеры выбирают в игре, есть в RUNTIME_DUSTS (prewarm) — новых спрайтов в кадре нет', () => {
    for (const c of RUNTIME_DUSTS) puffSprite(c);
    softPuffSprite(GROUND_DUST);
    const n0 = FX_SPRITES.defCount;
    const fx = new Fx();
    const surf = ['wood', 'ice', 'stone', 'bird', 'pig', 'ground', 'tnt', 'egg'] as const;
    for (const a of surf) for (const b of surf) {
      fx.handle({ type: 'impact', x: 0, y: 0, impulse: 30, a, b });
      fx.update(1 / 60);
    }
    for (const m of ['wood', 'ice', 'stone'] as const) {
      fx.handle(destroyed(m));
      fx.handle({ type: 'blockDamaged', id: 2, material: m, x: 1, y: 1, stage: 3 });
      fx.update(1 / 60);
    }
    for (const bird of ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'] as const) {
      fx.handle({ type: 'birdLaunched', id: 1, bird, x: 0, y: 2, power: 1 });
      fx.handle({ type: 'ability', id: 1, bird, x: 1, y: 3 });
      fx.handle({ type: 'birdImpact', id: 1, bird, x: 2, y: 1, speed: 15 });
      fx.handle({ type: 'birdRemoved', id: 1, bird, x: 2, y: 1 });
      fx.update(1 / 60);
    }
    fx.handle({ type: 'pigDestroyed', id: 3, pig: 'medium', x: 3, y: 1, radius: 0.6, points: 5000 });
    for (const source of ['tnt', 'bomb', 'egg'] as const) fx.handle({ type: 'explosion', x: 4, y: 0.5, radius: 3, source });
    run(fx, 1);
    expect(FX_SPRITES.defCount).toBe(n0);
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

  it('числа свиней, блоков и TNT не перекрываются на всей видимой жизни (младшее не догоняет старшее)', () => {
    type P = { x: number; y: number; xOff: number; yOff: number; t: number; life: number; text: string; kind: string; style: { sizeM: number } };
    const rise = (t: number) => 1.4 * (1 - (1 - Math.min(1, t / 0.9)) ** 2);
    const visible = (p: P) => p.t < 0.65 + 0.65 * (p.life - 0.65);
    const halfW = (p: P) => 0.5 * p.style.sizeM * ([...p.text].reduce((w, c) => w + (c === '1' ? 0.4 : 0.61), 0) + 0.26);
    const halfH = (p: P) => 0.45 * p.style.sizeM;
    const brk = (x: number, y: number, points: number, material: 'wood' | 'ice' | 'stone' = 'stone'): GameEvent[] => [
      { type: 'blockDestroyed', id: 1, material, shape: 'rect', x, y, w: 1, h: 0.5, angle: 0, vx: 0, vy: 0, points },
      { type: 'score', points, x, y, kind: 'block' },
    ];
    const pig = (x: number, y: number, r = 0.6): GameEvent[] => [
      { type: 'pigDestroyed', id: 1, pig: 'medium', x, y, radius: r, points: 5000 },
      { type: 'score', points: 5000, x, y, kind: 'pig' },
    ];
    // сценарии листа dev/preview-fx.html?mode=sheet&set=score (скопления, как на 3-10 у плейтеста)
    const scenarios: Array<Array<[number, GameEvent[]]>> = [
      [
        [0, [...pig(0, 0.6), ...brk(0.4, 1.2, 1310), ...brk(-0.5, 0.8, 556, 'wood'), ...brk(0.8, 0.4, 798, 'ice'), { type: 'score', points: 500, x: -0.2, y: 0.3, kind: 'tnt' }]],
        [0.12, [...pig(0.3, 1.5, 0.45), ...brk(-0.3, 1.9, 1151)]],
      ],
      [[0, brk(0, 1, 500, 'wood')], [0.3, brk(0.1, 1, 520, 'wood')], [0.55, brk(-0.1, 1.1, 640)], [0.75, pig(0, 0.8)]],
      [[0, pig(0, 0.6)], [0.2, brk(0.3, 1.8, 500, 'wood')], [0.45, brk(-0.2, 1.4, 500, 'ice')]],
      [[0, brk(0, 2, 500)], [0.15, pig(0.2, 0.6)], [0.3, pig(-0.6, 0.7, 0.45)]],
      // score раньше pigDestroyed (подъём над свиньёй после постановки)
      [[0, [{ type: 'score', points: 5000, x: 0, y: 1, kind: 'pig' }, ...brk(0, 2.2, 500)]], [0.05, [{ type: 'pigDestroyed', id: 2, pig: 'large', x: 0, y: 1, radius: 0.8, points: 5000 }]]],
    ];
    for (const [si, sc] of scenarios.entries()) {
      const fx = new Fx();
      const later = [...sc];
      let worst = 0;
      for (let t = 0; t < 1.4; t += 1 / 60) {
        while (later.length && later[0][0] <= t + 1e-9) for (const e of later.shift()![1]) fx.handle(e);
        const l = (peek(fx) as unknown as P[]).filter((p) => p.kind !== 'bonus' && visible(p));
        for (let i = 0; i < l.length; i++) {
          for (let j = i + 1; j < l.length; j++) {
            const a = l[i];
            const b = l[j];
            const ox = halfW(a) + halfW(b) - Math.abs(a.x + a.xOff - b.x - b.xOff);
            const oy = halfH(a) + halfH(b) - Math.abs(a.y + a.yOff + rise(a.t) - b.y - b.yOff - rise(b.t));
            if (ox > 0 && oy > 0) worst = Math.max(worst, Math.min(ox, oy));
          }
        }
        fx.update(1 / 60);
      }
      expect(worst, `сценарий ${si}`).toBeLessThan(0.02);
    }
  });

  it('число не уезжает далеко от своего места: сдвиг не больше 1.5 ширины вбок и 4 высот вверх', () => {
    const fx = new Fx();
    for (let i = 0; i < 6; i++) fx.handle({ type: 'score', points: 500 + i, x: 0.1 * i, y: 1, kind: 'block' });
    for (let i = 0; i < 3; i++) fx.handle({ type: 'score', points: 5000, x: 0.2 * i, y: 1, kind: 'pig' });
    for (const p of peek(fx) as unknown as Array<{ xOff: number; yOff: number; text: string; style: { sizeM: number } }>) {
      const S = p.style.sizeM;
      expect(Math.abs(p.xOff)).toBeLessThanOrEqual(1.5 * S * (0.61 * p.text.length + 0.26) + 1e-6);
      expect(p.yOff).toBeLessThanOrEqual(4 * 0.9 * S + 1e-6);
      expect(p.yOff).toBeGreaterThanOrEqual(-0.5 * 0.9 * S - 1e-6);
    }
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
