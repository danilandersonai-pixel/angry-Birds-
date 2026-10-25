import { describe, expect, it } from 'vitest';
import { BIRD_FLIGHT, EXPLOSION, PIGS, WORLD } from '../../src/config/constants';
import type { Ent, PigEnt } from '../../src/core/physics/entities';
import type { PhysicsWorld } from '../../src/core/physics/PhysicsWorld';
import type { LevelDef } from '../../src/core/types';
import { level, pigOn, rect, tower } from '../fixtures/levels';
import { lift, physicsOf, stepWorld } from './helpers';

const blocks = (pw: PhysicsWorld) => [...pw.ents.values()].filter((e) => e.kind === 'block');
const pigs = (pw: PhysicsWorld) => [...pw.ents.values()].filter((e): e is PigEnt => e.kind === 'pig');
const pos = (e: Ent) => ({ x: e.body.getPosition().x, y: e.body.getPosition().y });

/** Red летит горизонтально в тело слева (стартует вплотную, чтобы не успеть упасть). */
function redInto(pw: PhysicsWorld, target: Ent, halfW: number, speed: number): void {
  const p = pos(target);
  pw.addBird('red', pw.allocId(), 0, { x: p.x - halfW - 0.5, y: Math.max(0.47, p.y) }, { x: speed, y: 0 }, 0, -1);
}

describe('урон и разрушение', () => {
  it('покой: конструкции 10 с с включённым уроном — ни урона, ни разрушений, смещения малы', () => {
    const L = level({
      blocks: [...tower(20, 4), ...tower(30, 3, 'ice', 'stone'), rect('stone', 40, 0.5, 2, 1), rect('stone', 40, 1.5, 2, 1)],
      pigs: [pigOn('small', 20, 0), pigOn('medium', 20, 10), pigOn('small', 30, 0), pigOn('small', 44, 0)],
      tnt: [{ x: 36, y: 0.5 }],
    });
    const { pw, log } = physicsOf(L);
    const start = new Map([...pw.ents.values()].map((e) => [e.id, pos(e)]));
    for (const e of pw.ents.values()) e.body.setAwake(true);
    stepWorld(pw, 10);
    expect(log.damage).toBe(0);
    expect(log.killed).toHaveLength(0);
    for (const e of pw.ents.values()) {
      if (e.kind === 'terrain') continue;
      const p0 = start.get(e.id)!;
      expect(Math.hypot(pos(e).x - p0.x, pos(e).y - p0.y)).toBeLessThan(e.kind === 'pig' ? 0.1 : 0.05);
    }
  });

  it('усадка: блоки, поставленные встык, почти не сдвигаются (INSET)', () => {
    const L = level({ blocks: tower(20, 4) });
    const { pw } = physicsOf(L);
    for (const [i, b] of blocks(pw).entries()) {
      const d = L.blocks[i];
      expect(Math.hypot(pos(b).x - d.x, pos(b).y - d.y)).toBeLessThan(0.02);
    }
  });

  it('быстрая птица разрушает ледяной блок, слабый удар — нет', () => {
    const fast = physicsOf(level({ blocks: [rect('ice', 5, 0.5, 1, 1)] }));
    redInto(fast.pw, blocks(fast.pw)[0], 0.5, 20);
    stepWorld(fast.pw, 1);
    expect(fast.log.killed.map((k) => k.e.kind)).toEqual(['block']);

    const slow = physicsOf(level({ blocks: [rect('ice', 5, 0.5, 1, 1)] }));
    const target = blocks(slow.pw)[0];
    redInto(slow.pw, target, 0.5, 3);
    stepWorld(slow.pw, 1.5);
    expect(slow.log.killed).toHaveLength(0);
    expect(target.kind === 'block' && target.hp / target.maxHp).toBeGreaterThan(0.5);
  });

  it('камень держит удар Red, лёд — нет (множители и пороги материалов)', () => {
    const stone = physicsOf(level({ blocks: [rect('stone', 5, 0.5, 1, 1)] }));
    const target = blocks(stone.pw)[0];
    redInto(stone.pw, target, 0.5, 24);
    stepWorld(stone.pw, 1.5);
    expect(stone.log.killed).toHaveLength(0);
    expect(target.kind === 'block' && target.hp / target.maxHp).toBeGreaterThan(0.5);
  });

  it('падающий каменный блок убивает свинью; лёгкая доска с 1 м среднюю — нет', () => {
    const crush = physicsOf(level({ blocks: [rect('stone', 20, 3, 2, 0.5)], pigs: [pigOn('small', 20, 0)] }));
    lift(blocks(crush.pw)[0], 0.81 + 1 + 0.25);
    stepWorld(crush.pw, 2);
    expect(crush.log.killed.map((k) => k.e.kind)).toContain('pig');

    const soft = physicsOf(level({ blocks: [rect('wood', 20, 3, 2, 0.5)], pigs: [pigOn('medium', 20, 0)] }));
    lift(blocks(soft.pw)[0], 1.215 + 1 + 0.25);
    stepWorld(soft.pw, 2);
    expect(soft.log.killed).toHaveLength(0);
    expect(pigs(soft.pw)[0].hp).toBeLessThan(pigs(soft.pw)[0].maxHp);
  });

  it('свинья переживает падение с 2 м и гибнет с 6 м (удар о рельеф ×0.7)', () => {
    const fall = (h: number) => {
      const w = physicsOf(level({ pigs: [pigOn('small', 20, 0)] }));
      lift(pigs(w.pw)[0], PIGS.small.radius + h);
      stepWorld(w.pw, 2);
      return w.log.killed.length;
    };
    expect(fall(2)).toBe(0);
    expect(fall(6)).toBe(1);
  });

  it('каска берёт на себя удар сверху и слетает', () => {
    const { pw } = physicsOf(level({ blocks: [rect('stone', 20, 3, 2, 0.5)], pigs: [pigOn('helmet', 20, 0)] }));
    const pig = pigs(pw)[0];
    lift(blocks(pw)[0], 1.26 + 0.6 + 0.25);
    stepWorld(pw, 1);
    expect(pig.helmetHp).toBeLessThan(PIGS.helmet.helmetHp);
    expect(pig.hp / pig.maxHp).toBeGreaterThan(0.8);
  });

  it('удар по TNT: взрыв разрушает соседей, цепочка срабатывает с задержкой', () => {
    const L: LevelDef = level({
      blocks: [rect('wood', 8.5, 0.5, 1, 1), rect('wood', 11.5, 0.5, 1, 1)],
      tnt: [{ x: 10, y: 0.5 }, { x: 12.5 + 0.5, y: 0.5 }],
      pigs: [pigOn('small', 14.6, 0)],
    });
    const { pw, log } = physicsOf(L);
    const tnt = [...pw.ents.values()].find((e) => e.kind === 'tnt')!;
    pw.addBird('red', pw.allocId(), 0, { x: 10, y: 3 }, { x: 0, y: -20 }, 0, -1); // сверху в первый ящик
    stepWorld(pw, 1.5);
    const kinds = log.killed.map((k) => k.e.kind);
    expect(kinds.filter((k) => k === 'tnt')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'block').length).toBeGreaterThanOrEqual(2);
    expect(kinds).toContain('pig');
    expect(log.explosions).toBe(2);
    expect(log.killed.find((k) => k.e === tnt)!.cause).toBe('impact');
    expect(log.killed.filter((k) => k.e.kind === 'tnt')[1].cause).toBe('blast');
  });

  it('взрыв: импульс ограничен m·DV_MAX — обломки не «телепортируются»', () => {
    const { pw } = physicsOf(level({ blocks: [rect('wood', 10, 0.25, 0.5, 0.5), rect('wood', 12, 0.25, 0.5, 0.5)] }));
    pw.detonate(10.5, 0.4, 'bomb');
    const alive = blocks(pw);
    for (const b of alive) expect(b.body.getLinearVelocity().length()).toBeLessThanOrEqual(EXPLOSION.bomb.DV_MAX + 1e-6);
  });

  it('удаление опоры будит тела на ней: блок сверху падает', () => {
    const { pw } = physicsOf(level({ blocks: [rect('wood', 20, 1, 0.5, 2), rect('wood', 20, 2.25, 2, 0.5)] }));
    const [column, beam] = blocks(pw);
    expect(beam.body.isAwake()).toBe(false); // после усадки все спят
    pw.remove(column);
    expect(beam.body.isAwake()).toBe(true);
    const y0 = pos(beam).y;
    stepWorld(pw, 1.5);
    expect(pos(beam).y).toBeLessThan(y0 - 1.5);
    expect(pos(beam).y).toBeGreaterThan(0);
  });

  it('тело за границей мира удаляется, свинья засчитывается погибшей', () => {
    const { pw, log } = physicsOf(level({ pigs: [pigOn('small', 20, 0)] }));
    const pig = pigs(pw)[0];
    pig.body.setTransform({ x: 200, y: 5 }, 0);
    pw.step();
    expect(log.killed).toEqual([{ e: pig, cause: 'culled' }]);
    expect(pw.ents.has(pig.id)).toBe(false);
  });
  it('блоки всех форм (rect, circle, triangle, isoTriangle, зеркальный triangle) стоят встык без сдвига', () => {
    const L = level({
      blocks: [
        rect('wood', 20, 0.5, 4, 1),
        { material: 'stone', shape: 'triangle', x: 18.5, y: 1.5, w: 1, h: 1 },
        { material: 'stone', shape: 'triangle', x: 21.5, y: 1.5, w: 1, h: 1, angle: Math.PI / 2 }, // зеркальный: w и h переставлены
        { material: 'ice', shape: 'isoTriangle', x: 20, y: 1.75, w: 2, h: 1.5 },
        { material: 'stone', shape: 'circle', x: 26, y: 0.5, w: 1, h: 1 },
      ],
    });
    const { pw, log } = physicsOf(L);
    for (const [i, b] of blocks(pw).entries()) {
      const d = L.blocks[i];
      expect(Math.hypot(pos(b).x - d.x, pos(b).y - d.y)).toBeLessThan(0.02);
    }
    for (const e of pw.ents.values()) e.body.setAwake(true);
    stepWorld(pw, 5);
    expect(log.damage).toBe(0);
    // масса — по сжатому на INSET контуру, HP — по визуальной площади
    const tri = blocks(pw)[1];
    expect(tri.kind === 'block' && tri.maxHp).toBeCloseTo(27 * 2.2 * 0.5, 6);
    expect(tri.body.getMass()).toBeLessThan(2.2 * 0.5);
    expect(tri.body.getMass()).toBeGreaterThan(2.2 * 0.5 * 0.93);
  });

  it('качение свиней: крупные гасят качение сильнее (король после толчка 9 м/с — ≤ 4.5 м, small — ≈ 8.6 м)', () => {
    const roll = (type: 'small' | 'large' | 'king') => {
      const { pw } = physicsOf(level({ pigs: [pigOn(type, 20, 0)] }));
      const pig = pigs(pw)[0];
      pig.body.setAwake(true);
      pig.body.setLinearVelocity({ x: -9, y: 0 });
      pig.body.setAngularVelocity(9 / pig.radius);
      const x0 = pos(pig).x;
      for (let i = 0; i < 600 && pig.body.getLinearVelocity().length() > 0.05; i++) pw.step();
      return x0 - pos(pig).x;
    };
    const small = roll('small');
    const large = roll('large');
    const king = roll('king');
    expect(small).toBeGreaterThan(7.5);
    expect(large).toBeLessThan(0.75 * small);
    expect(king).toBeLessThan(4.5);
    expect(king).toBeLessThan(large);
  });

  it('после первого контакта птица демпфируется (lin 1.5 / ang 4), в полёте — нет', () => {
    const { pw } = physicsOf(level({}));
    const bird = pw.addBird('red', pw.allocId(), 0, { x: 0, y: 3 }, { x: 10, y: 0 }, 0, -1);
    expect(bird.body.isBullet()).toBe(true);
    expect(bird.body.getLinearDamping()).toBe(0);
    expect(bird.body.getAngularDamping()).toBe(BIRD_FLIGHT.ANGULAR_DAMPING);
    stepWorld(pw, 1);
    expect(bird.body.getLinearDamping()).toBe(BIRD_FLIGHT.HIT_LINEAR_DAMPING);
    expect(bird.body.getAngularDamping()).toBe(BIRD_FLIGHT.HIT_ANGULAR_DAMPING);
  });

  it('быстрый обломок (> 25 м/с) получает bullet на 1 с', () => {
    const { pw } = physicsOf(level({ blocks: [rect('wood', 20, 5, 0.5, 0.5)] }));
    const cube = blocks(pw)[0];
    cube.body.setLinearVelocity({ x: 30, y: 10 });
    pw.step();
    expect(cube.body.isBullet()).toBe(true);
    cube.body.setLinearVelocity({ x: 1, y: 0 });
    stepWorld(pw, WORLD.FAST_BULLET_T - 0.1);
    expect(cube.body.isBullet()).toBe(true);
    stepWorld(pw, 0.2);
    expect(cube.body.isBullet()).toBe(false);
  });

  it('блок за границей мира исчезает молча (без гибели и очков)', () => {
    const { pw, log } = physicsOf(level({ blocks: [rect('wood', 20, 0.5, 1, 1)] }));
    const b = blocks(pw)[0];
    b.body.setTransform({ x: 20, y: -30 }, 0);
    pw.step();
    expect(pw.ents.has(b.id)).toBe(false);
    expect(log.killed).toHaveLength(0);
  });
});
