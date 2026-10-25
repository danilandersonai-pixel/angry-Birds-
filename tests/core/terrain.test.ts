// Рельеф из TerrainDef: невыпуклые контуры, любой обход, мусорные вершины — разбиение на годные для planck части.

import { describe, expect, it } from 'vitest';
import { Settings } from 'planck';
import { WORLD } from '../../src/config/constants';
import { insetPolygon, isConvex, normalizePolygon, signedArea, terrainPieces } from '../../src/core/physics/geometry';
import type { TerrainDef, Vec } from '../../src/core/types';
import { level, pigOn, rect } from '../fixtures/levels';
import { destructibles, physicsOf, stepWorld } from './helpers';

const toVec = (pts: Array<[number, number]>): Vec[] => pts.map(([x, y]) => ({ x, y }));

/** Холм с плоской вершиной, пропасть глубиной 4 м и пещера под нависающим потолком — типичный рельеф кампании. */
const CAVE: Array<[number, number]> = [
  [-30, -10], [60, -10], [60, 0], [36, 0], [36, 3], [44, 3], [44, 7], [26, 7], [26, 0],
  [24, 0], [24, -4], [20, -4], [20, 0], [12, 0], [9, 3], [4, 3], [1, 0], [-30, 0],
];

function piecesOf(pts: Array<[number, number]>) {
  const inner = normalizePolygon(insetPolygon(normalizePolygon(toVec(pts)), WORLD.INSET));
  return { inner, pieces: terrainPieces(pts, WORLD.INSET, Settings.maxPolygonVertices) };
}

describe('рельеф', () => {
  it('невыпуклый контур разбивается на выпуклые части ≤ 12 вершин, площадь сохраняется', () => {
    const { inner, pieces } = piecesOf(CAVE);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeGreaterThanOrEqual(3);
      expect(p.length).toBeLessThanOrEqual(Settings.maxPolygonVertices);
      expect(isConvex(p)).toBe(true);
      expect(signedArea(p)).toBeGreaterThan(0);
    }
    const sum = pieces.reduce((a, p) => a + signedArea(p), 0);
    expect(sum).toBeCloseTo(signedArea(inner), 6);
  });

  it('самопересекающийся контур — понятная ошибка', () => {
    expect(() => terrainPieces([[0, 0], [10, 0], [10, 10], [6, -3]], WORLD.INSET, 8)).toThrow(/самопересекается/);
  });

  it('обход по часовой, повторы и коллинеарные точки — то же самое', () => {
    const messy: Array<[number, number]> = [...CAVE].reverse();
    messy.splice(3, 0, messy[3], [messy[3][0] + 0.0005, messy[3][1]]); // дубль и почти дубль
    messy.push([-30 + 1e-4, -5]); // точка на ребре (коллинеарная)
    const a = piecesOf(CAVE);
    const b = piecesOf(messy);
    expect(b.pieces.reduce((s, p) => s + signedArea(p), 0)).toBeCloseTo(a.pieces.reduce((s, p) => s + signedArea(p), 0), 3);
  });

  it('игла тоньше 2·INSET: без самопересечений, вершины частей не ближе 3 мм — planck не подменит полигон квадратом 2×2', () => {
    const spiky: Array<[number, number]> = [[-10, -5], [10, -5], [10, 0], [2, 0], [1.999, 3], [1.998, 0], [-10, 0]];
    const { pieces } = piecesOf(spiky);
    for (const p of pieces) {
      for (let i = 0; i < p.length; i++) {
        for (let j = i + 1; j < p.length; j++) expect(Math.hypot(p[i].x - p[j].x, p[i].y - p[j].y)).toBeGreaterThanOrEqual(0.003);
      }
    }
    // в мире нет фикстур, выходящих за габарит контура (признак квадрата 2×2 у начала координат)
    const { pw } = physicsOf(level({ terrain: [{ kind: 'rock', points: spiky }] }));
    const terrain = [...pw.ents.values()].find((e) => e.kind === 'terrain')!;
    for (let f = terrain.body.getFixtureList(); f; f = f.getNext()) {
      const aabb = f.getAABB(0);
      expect(aabb.lowerBound.y).toBeGreaterThan(-5.1);
      expect(aabb.upperBound.y).toBeLessThan(3.1);
    }
  });

  it('тела стоят на холме, на дне пропасти и в пещере под потолком', () => {
    const terrain: TerrainDef[] = [{ kind: 'ground', points: CAVE }];
    const L = level({
      terrain,
      bounds: { minX: -12, maxX: 60, maxY: 30 },
      blocks: [rect('wood', 6.5, 3.25, 2, 0.5), rect('stone', 40, 0.5, 1, 1)],
      pigs: [pigOn('small', 22, -4), pigOn('medium', 50, 0)],
    });
    const { pw, log } = physicsOf(L);
    const start = destructibles(pw).map((e) => ({ x: e.body.getPosition().x, y: e.body.getPosition().y }));
    for (const e of pw.ents.values()) e.body.setAwake(true);
    stepWorld(pw, 5);
    expect(log.killed).toHaveLength(0);
    destructibles(pw).forEach((e, i) => {
      const p = e.body.getPosition();
      expect(Math.hypot(p.x - start[i].x, p.y - start[i].y)).toBeLessThan(0.1);
    });
  });

  it('статический помост (platform) и скала (rock) — такие же твёрдые, как земля', () => {
    const L = level({
      terrain: [{ kind: 'ground', points: [[-40, -10], [140, -10], [140, 0], [-40, 0]] }, { kind: 'platform', points: [[18, 3], [22, 3], [22, 3.5], [18, 3.5]] }],
      pigs: [pigOn('small', 20, 3.5)],
    });
    const { pw } = physicsOf(L);
    const pig = destructibles(pw)[0];
    pig.body.setAwake(true);
    stepWorld(pw, 3);
    expect(pig.body.getPosition().y).toBeCloseTo(3.5 + 0.405, 1);
  });
});
