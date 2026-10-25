// Калибровочная таблица урона 00 §1.7 на настоящем ядре: урон первичного удара ±10 % и исход.

import { describe, expect, it } from 'vitest';
import { ABILITY, BIRDS, EXPLOSION, MATERIALS, PIGS } from '../../src/config/constants';
import type { DamageMults } from '../../src/core/characters';
import type { Destructible } from '../../src/core/physics/entities';
import type { BirdType, LevelDef, Material, PigType } from '../../src/core/types';
import { level, pigOn, PIG_R, rect } from '../fixtures/levels';
import { birdInto, dealt, destructibles, lift, physicsOf, stepWorld } from './helpers';

const CHUCK_BOOST: DamageMults = { ...BIRDS.chuck.mult, wood: ABILITY.CHUCK.BOOSTED_WOOD };

/** Одиночный удар птицы по единственной цели уровня; урон берётся через 0.1 с (до вторичных ударов). */
function hit(over: Partial<LevelDef>, bird: BirdType, speed: number, opts: { fromAbove?: boolean; mult?: DamageMults } = {}) {
  const { pw } = physicsOf(level(over));
  const target = destructibles(pw)[0];
  const b = birdInto(pw, bird, target, speed, opts);
  stepWorld(pw, 0.1);
  return { target, dmg: dealt(target), hp: target.maxHp, bird: b };
}

const block = (m: Material, w = 1, h = 1) => ({ blocks: [rect(m, 5, h / 2, w, h)] });
const pig = (t: PigType) => ({ pigs: [pigOn(t, 5, 0)] });

function expectNear(actual: number, expected: number, tol = 0.1): void {
  expect(actual).toBeGreaterThan(expected * (1 - tol));
  expect(actual).toBeLessThan(expected * (1 + tol));
}

describe('калибровка урона (00 §1.7)', () => {
  it('Red 24 м/с: колонна дерева ломается и пробивается, птица сохраняет скорость', () => {
    const r = hit(block('wood', 0.5, 2), 'red', 24);
    expectNear(r.dmg, 13.2);
    expect(r.target.dead).toBe(true);
    // пробитие: keep = clamp(1 − 0.5·9.8/13.2, 0.5, 0.9) ≈ 0.63
    expectNear(r.bird.body.getLinearVelocity().x, 0.63 * 24, 0.12);
  });

  it('Red 24 м/с: лёд 1×1 ломается, камень 1×1 — 24 %', () => {
    const ice = hit(block('ice'), 'red', 24);
    expectNear(ice.dmg, 15.4);
    expect(ice.target.dead).toBe(true);
    const stone = hit(block('stone'), 'red', 24);
    expectNear(stone.dmg, 14.0);
    expect(stone.target.dead).toBe(false);
    expectNear(stone.dmg / stone.hp, 0.24, 0.12);
  });

  it('Red 24 м/с убивает small, medium, large и бригадира; король — 62 %', () => {
    const table: Array<[PigType, number]> = [['small', 8.6], ['medium', 14.2], ['large', 18.1], ['mustache', 16.9]];
    for (const [type, dmg] of table) {
      const r = hit(pig(type), 'red', 24);
      expectNear(r.dmg, dmg);
      expect(r.target.dead).toBe(true);
    }
    const king = hit(pig('king'), 'red', 24);
    expectNear(king.dmg, 19.1);
    expect(king.target.dead).toBe(false);
    expectNear(king.dmg / king.hp, 0.62);
  });

  it('каска держит прямой удар Red: сбоку каска 0.7 из 10, тело 0.5 из 6.7; сверху каска разбита, свинья жива', () => {
    const side = hit(pig('helmet'), 'red', 24);
    const p = side.target as Extract<Destructible, { kind: 'pig' }>;
    expect(p.dead).toBe(false);
    expect(p.helmetHp).toBeGreaterThan(0.4);
    expect(p.helmetHp).toBeLessThan(1.0);
    expect(p.hp).toBeGreaterThan(0.2);
    expect(p.hp).toBeLessThan(0.9);
    const top = hit(pig('helmet'), 'red', 24, { fromAbove: true });
    const q = top.target as Extract<Destructible, { kind: 'pig' }>;
    expect(q.helmetHp).toBe(0);
    expect(q.dead).toBe(false);
    expect(q.hp).toBeLessThan(q.maxHp);
  });

  it('докатившаяся Red (5 м/с) не убивает medium — 14 %; на 15 м/с убивает', () => {
    const slow = hit(pig('medium'), 'red', 5);
    expectNear(slow.dmg, 0.76, 0.15);
    expect(slow.target.dead).toBe(false);
    expect(hit(pig('medium'), 'red', 15).target.dead).toBe(true);
  });

  it('Blue 24 м/с: пробивает стекло, дерево не берёт; small гибнет, medium нет', () => {
    const ice = hit(block('ice'), 'blues', 24);
    expectNear(ice.dmg, 25.7);
    expect(ice.target.dead).toBe(true);
    const wood = hit(block('wood'), 'blues', 24);
    expectNear(wood.dmg, 4.5);
    expect(wood.target.dead).toBe(false);
    const small = hit(pig('small'), 'blues', 24);
    expectNear(small.dmg, 3.2);
    expect(small.target.dead).toBe(true);
    const medium = hit(pig('medium'), 'blues', 24);
    expectNear(medium.dmg, 4.3);
    expect(medium.target.dead).toBe(false);
  });

  it('Chuck 35 м/с после рывка пробивает три деревянные колонны подряд, камень 1×1 — 19 %', () => {
    const { pw } = physicsOf(level({ blocks: [rect('wood', 5, 1, 0.5, 2), rect('wood', 7, 1, 0.5, 2), rect('wood', 9, 1, 0.5, 2)] }));
    const cols = destructibles(pw);
    birdInto(pw, 'chuck', cols[0], 35, { mult: CHUCK_BOOST });
    stepWorld(pw, 0.5);
    expect(cols.every((c) => c.dead)).toBe(true);
    [39.6, 34.4, 29.2].forEach((dmg, i) => expectNear(dealt(cols[i]), dmg));
    const stone = hit(block('stone'), 'chuck', 35, { mult: CHUCK_BOOST });
    expectNear(stone.dmg, 11);
    expect(stone.target.dead).toBe(false);
  });

  it('Terence 21.1 м/с убивает короля и ломает камень 1×1 (×2.0)', () => {
    const king = hit(pig('king'), 'terence', 21.1);
    expectNear(king.dmg, 58.9);
    expect(king.target.dead).toBe(true);
    const stone = hit(block('stone'), 'terence', 21.1);
    expectNear(stone.dmg, 63.3);
    expect(stone.target.dead).toBe(true);
  });

  it('Silver в пике 25.2 м/с ломает камень 1×1 (×3.0), балку камня 4×0.5 — нет', () => {
    const stone = hit(block('stone'), 'silver', 25.2, { fromAbove: true, mult: ABILITY.SILVER.DIVE_MULT });
    expectNear(stone.dmg, 66.3);
    expect(stone.target.dead).toBe(true);
    const beam = hit(block('stone', 4, 0.5), 'silver', 25.2, { fromAbove: true, mult: ABILITY.SILVER.DIVE_MULT });
    expect(beam.target.dead).toBe(false);
    expect(beam.dmg / beam.hp).toBeGreaterThan(0.5);
  });

  it('падения свиней о рельеф (×0.7): с 3 м выживают все; гибель с 3.4 / 4.5 / 6.7 / 6.9 м (±10 %)', () => {
    const fall = (type: PigType, h: number) => {
      const { pw } = physicsOf(level({ pigs: [pigOn(type, 20, 0)] }));
      const p = destructibles(pw)[0];
      lift(p, PIG_R[type] + h);
      stepWorld(pw, 2);
      return p.dead;
    };
    for (const type of ['small', 'medium', 'large', 'mustache', 'king'] as const) expect(fall(type, 3)).toBe(false);
    const lethal: Array<[PigType, number]> = [['small', 3.4], ['medium', 3.4], ['large', 4.5], ['mustache', 6.7], ['king', 6.9]];
    for (const [type, h] of lethal) {
      expect(fall(type, h * 0.9)).toBe(false);
      expect(fall(type, h * 1.1)).toBe(true);
    }
  });

  it('доска дерева 2×0.5 плашмя убивает medium с 4 м и не убивает с 2 м; лёд 2×0.5 бьётся о землю с 2 м', () => {
    const plank = (h: number) => {
      const { pw } = physicsOf(level({ blocks: [rect('wood', 20, 5, 2, 0.5)], pigs: [pigOn('medium', 20, 0)] }));
      const [board, p] = destructibles(pw);
      lift(board, 2 * PIGS.medium.radius + h + 0.25);
      stepWorld(pw, 2);
      return p;
    };
    expect(plank(4).dead).toBe(true);
    const survivor = plank(2);
    expect(survivor.dead).toBe(false);
    expect(survivor.hp).toBeLessThan(survivor.maxHp);
    const { pw } = physicsOf(level({ blocks: [rect('ice', 20, 5, 2, 0.5)] }));
    const ice = destructibles(pw)[0];
    lift(ice, 2 + 0.25);
    stepWorld(pw, 2);
    expect(ice.dead).toBe(true);
  });

  it('каменная стопка на small: 10 с покоя без урона', () => {
    const { pw, log } = physicsOf(level({ blocks: [rect('stone', 20, 0.81 + 0.5, 2, 1), rect('stone', 20, 0.81 + 1.5, 2, 1)], pigs: [pigOn('small', 20, 0)] }));
    for (const e of pw.ents.values()) e.body.setAwake(true);
    stepWorld(pw, 10);
    expect(log.damage).toBe(0);
    expect(log.killed).toHaveLength(0);
  });

  it('цепочка TNT: зазор 2.0 м срабатывает, 2.5 м — нет', () => {
    const chain = (gap: number) => {
      const { pw, log } = physicsOf(level({ tnt: [{ x: 10, y: 0.5 }, { x: 11 + gap, y: 0.5 }] }));
      pw.detonate(10, 0.5, 'tnt');
      stepWorld(pw, 1);
      return log.killed.filter((k) => k.e.kind === 'tnt').length;
    };
    expect(chain(2.0)).toBe(2);
    expect(chain(2.5)).toBe(1);
  });

  it('взрыв: импульс min(J0·f, m·dvMax) по расстоянию до поверхности, урон D0·f·blastMult', () => {
    const P = EXPLOSION.bomb;
    // камень 1×1 (2.13 кг) в 2.5 м от грани: кап m·dvMax не достигается, Δv = J0·f/m; камень выживает
    const { pw } = physicsOf(level({ blocks: [rect('stone', 10, 0.5, 1, 1)] }));
    const stone = destructibles(pw)[0];
    const d = 2.5;
    pw.detonate(10 - 0.5 - d, 0.5, 'bomb');
    const k = 1 - d / P.R;
    expect(stone.dead).toBe(false);
    expectNear(stone.body.getLinearVelocity().x, (P.J0 * k) / stone.body.getMass(), 0.05);
    expectNear(dealt(stone), P.D0 * k * MATERIALS.stone.blastMult, 0.02);
    // Red (1.27 кг) вплотную к центру: J0 > m·dvMax — скорость упирается в кап
    const red = pw.addBird('red', pw.allocId(), 0, { x: 20, y: 3 }, { x: 0, y: 0 }, 0, -1);
    pw.detonate(19.4, 3, 'bomb');
    expect(red.body.getLinearVelocity().length()).toBeCloseTo(P.DV_MAX, 6);
  });
});
