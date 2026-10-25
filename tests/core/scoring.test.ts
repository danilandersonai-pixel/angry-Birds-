// Очки и звёзды (00 §1.11): блоки — 500 + урон по площади и материалу, свиньи — 5000 (всплывает) + урон молча, TNT — 500.
// Счёт и всплывающие числа всегда кратны 10, как в AB.

import { describe, expect, it } from 'vitest';
import { MATERIALS, SCORE } from '../../src/config/constants';
import { Scoring, starsFor } from '../../src/core/game/Scoring';
import type { Destructible } from '../../src/core/physics/entities';
import type { BlockDef, BlockShape, Material, PigType } from '../../src/core/types';
import { level, pigOn } from '../fixtures/levels';
import { destructibles, physicsOf } from './helpers';

function blockOf(material: Material, shape: BlockShape, w: number, h: number): Destructible {
  const def: BlockDef = { material, shape, x: 10, y: h / 2, w, h };
  return destructibles(physicsOf(level({ blocks: [def] })).pw)[0];
}
const pigOf = (type: PigType) => destructibles(physicsOf(level({ pigs: [pigOn(type, 10, 0)] })).pw)[0];
const tnt = () => destructibles(physicsOf(level({ tnt: [{ x: 10, y: 0.5 }] })).pw)[0];

describe('очки', () => {
  it('блок, разрушенный с полным HP: 500 + 100/200/300 за м² (лёд/дерево/камень)', () => {
    const table: Array<[Material, BlockShape, number, number, number]> = [
      ['wood', 'rect', 1, 1, 700],
      ['ice', 'rect', 1, 1, 600],
      ['stone', 'rect', 1, 1, 800],
      ['wood', 'rect', 0.5, 0.5, 550],
      ['stone', 'rect', 4, 0.5, 1100],
      ['wood', 'rect', 2, 2, 1300],
      ['ice', 'isoTriangle', 4, 1.5, 800],
      ['wood', 'triangle', 1, 1, 600],
      ['wood', 'circle', 1, 1, 660], // 657.1 → до 10
      ['stone', 'circle', 2, 2, 1440], // 1442.5 → до 10
    ];
    for (const [m, shape, w, h, points] of table) expect(new Scoring().destroy(blockOf(m, shape, w, h))).toBe(points);
  });

  it('урон начисляется молча пропорционально снятому HP, при разрушении — остаток', () => {
    const sc = new Scoring();
    const b = blockOf('wood', 'rect', 1, 1);
    sc.damage(b, b.maxHp / 2);
    expect(sc.score).toBe(100);
    expect(sc.destroy(b)).toBe(600);
    expect(sc.score).toBe(700);
  });

  it('дробные очки копятся десятками: тысяча мелких ударов дают тот же итог, счёт всё время кратен 10', () => {
    const sc = new Scoring();
    const b = blockOf('ice', 'rect', 1, 1);
    for (let i = 0; i < 1000; i++) {
      sc.damage(b, b.maxHp / 1000);
      expect(sc.score % 10).toBe(0);
    }
    expect([90, 100]).toContain(sc.score);
    const popup = sc.destroy(b);
    expect(popup % 10).toBe(0);
    expect(sc.score).toBe(600);
  });

  it('счёт и всплывающие числа кратны 10 при любых долях урона; остаток не теряется', () => {
    const sc = new Scoring();
    let popups = 0;
    const shapes: Array<[Material, BlockShape, number, number]> = [['wood', 'circle', 1, 1], ['stone', 'circle', 2, 2], ['ice', 'isoTriangle', 4, 1.5], ['wood', 'rect', 0.5, 0.5]];
    let exact = 0;
    for (let k = 0; k < 40; k++) {
      const [m, shape, w, h] = shapes[k % shapes.length];
      const b = blockOf(m, shape, w, h);
      sc.damage(b, b.maxHp * (0.137 + 0.01 * k));
      expect(sc.score % 10).toBe(0);
      const p = sc.destroy(b);
      expect(p % 10).toBe(0);
      expect(p).toBeGreaterThanOrEqual(SCORE.BLOCK);
      popups += p;
      exact += SCORE.BLOCK + MATERIALS[m].damagePointsPerM2 * (shape === 'circle' ? Math.PI * (w / 2) ** 2 : shape === 'rect' ? w * h : (w * h) / 2);
    }
    expect(sc.score % 10).toBe(0);
    expect(Math.abs(sc.score - exact)).toBeLessThanOrEqual(10); // округления не копят ошибку
    expect(popups).toBeLessThanOrEqual(sc.score);
  });

  it('свинья: в счёт 5000 + урон до 50…1000, всплывает ровно 5000; каска входит в запас прочности (helmet — 5150)', () => {
    const table: Array<[PigType, number]> = [['small', 50], ['medium', 100], ['large', 200], ['helmet', 150], ['mustache', 300], ['king', 1000]];
    for (const [type, dmg] of table) {
      const sc = new Scoring();
      expect(sc.destroy(pigOf(type))).toBe(SCORE.PIG);
      expect(sc.score).toBe(SCORE.PIG + dmg); // остаток урона — молча
    }
    const sc = new Scoring();
    const helmet = pigOf('helmet');
    sc.damage(helmet, 10); // каска снята целиком
    expect(sc.score).toBe(Math.floor((150 * 10) / helmet.scoreHp / 10) * 10);
    expect(sc.destroy(helmet)).toBe(SCORE.PIG);
    expect(sc.score).toBe(5150);
  });

  it('TNT — 500 за подрыв; после блокировки физика очков не даёт, бонус птиц — даёт', () => {
    expect(new Scoring().destroy(tnt())).toBe(SCORE.TNT);
    const sc = new Scoring();
    sc.locked = true;
    const b = blockOf('wood', 'rect', 1, 1);
    sc.damage(b, b.maxHp / 2);
    expect(sc.destroy(b)).toBe(0);
    sc.bonus(SCORE.UNUSED_BIRD);
    expect(sc.score).toBe(10000);
  });
});

describe('звёзды', () => {
  it('stars = 1 + (≥ two) + (≥ three) при one = 0', () => {
    const t = { one: 0, two: 25000, three: 35000 };
    expect(starsFor(0, t)).toBe(1);
    expect(starsFor(24999, t)).toBe(1);
    expect(starsFor(25000, t)).toBe(2);
    expect(starsFor(35000, t)).toBe(3);
    expect(starsFor(999, { one: 1000, two: 2000, three: 3000 })).toBe(0);
  });
});
