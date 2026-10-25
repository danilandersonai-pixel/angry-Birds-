// Геометрия рельефа: объединение полигонов грунта (стыки без швов), цепочки верхних рёбер, нарезка, сдвиг.

import { describe, expect, it } from 'vitest';
import {
  chainCum,
  offsetChain,
  pieceCuts,
  pointInPoly,
  polyArea,
  terrainHash,
  topChains,
  touchingGroups,
  unionPolygons,
  type P2,
} from '../../src/render/sprites/terrainGeo';
import { cliff, flatGround, hill, plateau } from '../../src/levels/prefabs';
import { ALL_LEVELS } from '../../src/levels/index';

const area = (loops: P2[][]): number => loops.reduce((a, l) => a + polyArea(l), 0);
const has = (loop: P2[], x: number, y: number): boolean => loop.some((p) => Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6);

describe('unionPolygons', () => {
  it('земля + холм на ней — один контур без внутреннего ребра', () => {
    const g = flatGround();
    const h = hill(8, 14, 19, 27, 4);
    const u = unionPolygons([g.points, h.points]);
    expect(u).toHaveLength(1);
    const L = u[0];
    expect(polyArea(L)).toBeGreaterThan(0);
    // площадь = земля + трапеция
    expect(area(u)).toBeCloseTo(180 * 10 + ((19 - 14 + (27 - 8)) / 2) * 4, 6);
    // вершины подножия холма лежат на общем контуре, а под холмом (x = 15, y = 0) ребра нет
    expect(has(L, 8, 0)).toBe(true);
    expect(has(L, 27, 0)).toBe(true);
    expect(has(L, 14, 4)).toBe(true);
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      const b = L[(i + 1) % L.length];
      const onBase = Math.abs(a[1]) < 1e-9 && Math.abs(b[1]) < 1e-9 && Math.min(a[0], b[0]) < 20 && Math.max(a[0], b[0]) > 15;
      expect(onBase).toBe(false);
    }
  });

  it('утёс с отвесной стеной (Т-стык вершины на ребре земли)', () => {
    const u = unionPolygons([flatGround().points, cliff(31.5, 4, 'right', { kind: 'ground' }).points]);
    expect(u).toHaveLength(1);
    expect(has(u[0], 31.5, 0)).toBe(true);
    expect(has(u[0], 31.5, 4)).toBe(true);
    expect(has(u[0], 111.5, 4)).toBe(true);
    expect(has(u[0], 111.5, 0)).toBe(true);
    expect(area(u)).toBeCloseTo(180 * 10 + 80 * 4, 6);
  });

  it('перекрытие и несвязные части', () => {
    const a: P2[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const b: P2[] = [
      [2, 2],
      [6, 2],
      [6, 6],
      [2, 6],
    ];
    const c: P2[] = [
      [10, 0],
      [11, 0],
      [11, 1],
      [10, 1],
    ];
    const u = unionPolygons([a, b, c]);
    expect(u).toHaveLength(2);
    expect(area(u)).toBeCloseTo(16 + 16 - 4 + 1, 9);
    for (const l of u) expect(polyArea(l)).toBeGreaterThan(0);
  });

  it('касание в точке — два отдельных контура; кольцо — внешний контур и дыра по часовой', () => {
    const a: P2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const b: P2[] = [
      [1, 1],
      [2, 1],
      [2, 2],
      [1, 2],
    ];
    const u = unionPolygons([a, b]);
    expect(u).toHaveLength(2);
    // кольцо из четырёх прямоугольников (общие рёбра по углам)
    const ring = unionPolygons([
      [
        [0, 0],
        [3, 0],
        [3, 1],
        [0, 1],
      ],
      [
        [0, 2],
        [3, 2],
        [3, 3],
        [0, 3],
      ],
      [
        [0, 1],
        [1, 1],
        [1, 2],
        [0, 2],
      ],
      [
        [2, 1],
        [3, 1],
        [3, 2],
        [2, 2],
      ],
    ]);
    expect(ring).toHaveLength(2);
    const areas = ring.map(polyArea).sort((x, y) => x - y);
    expect(areas[0]).toBeCloseTo(-1, 9);
    expect(areas[1]).toBeCloseTo(9, 9);
  });

  it('объединение покрывает те же точки, что и исходные полигоны', () => {
    const polys = [flatGround().points, hill(8, 14, 19, 27, 4).points, plateau(32, 38, 3, { slope: 2, kind: 'ground' }).points];
    const u = unionPolygons(polys);
    for (let k = 0; k < 400; k++) {
      const x = -45 + ((k * 37) % 190) + 0.123;
      const y = -12 + ((k * 13) % 18) + 0.071;
      const inSrc = polys.some((p) => pointInPoly(p, x, y));
      // nonzero по контурам «внутренность слева»
      let w = 0;
      for (const l of u) if (pointInPoly(l, x, y)) w += Math.sign(polyArea(l));
      expect(w !== 0).toBe(inSrc);
    }
  });

  it('настоящие уровни: грунт каждого уровня собирается в непустые контуры', () => {
    expect(ALL_LEVELS.length).toBeGreaterThan(0);
    for (const lv of ALL_LEVELS) {
      const ground = lv.terrain.filter((t) => t.kind === 'ground').map((t) => t.points);
      if (!ground.length) continue;
      const groups = touchingGroups(ground);
      for (const g of groups) {
        const u = unionPolygons(g.map((i) => ground[i]));
        expect(u.length).toBeGreaterThan(0);
        const srcArea = g.reduce((a, i) => a + Math.abs(polyArea(ground[i])), 0);
        expect(area(u)).toBeLessThanOrEqual(srcArea + 1e-6);
      }
    }
  });
});

describe('цепочки верхних рёбер', () => {
  it('у объединения земли и холма одна непрерывная верхняя цепочка через холм', () => {
    const [L] = unionPolygons([flatGround().points, hill(8, 14, 19, 27, 4).points]);
    const chains = topChains(L, 0.45);
    expect(chains).toHaveLength(1);
    const ch = chains[0];
    // обход справа налево (внутренность слева = снизу)
    expect(ch.pts[0][0]).toBeCloseTo(140);
    expect(ch.pts[ch.pts.length - 1][0]).toBeCloseTo(-40);
    for (const n of ch.en) expect(n[1]).toBeGreaterThan(0.45);
    // проходит по вершине холма
    expect(ch.pts.some((p) => Math.abs(p[1] - 4) < 1e-9)).toBe(true);
  });

  it('отвесная стена разрывает цепочку', () => {
    const [L] = unionPolygons([flatGround().points, cliff(31.5, 4, 'right', { kind: 'ground' }).points]);
    expect(topChains(L, 0.45)).toHaveLength(3);
  });

  it('сдвиг цепочки внутрь: прямой участок — ровно на d ниже, у вогнутого угла — по митре', () => {
    const [L] = unionPolygons([flatGround().points, hill(8, 14, 19, 27, 4).points]);
    const [ch] = topChains(L, 0.45);
    const off = offsetChain(ch, 0.3);
    for (let j = 0; j < ch.pts.length; j++) {
      const p = ch.pts[j];
      const q = off[j];
      if (Math.abs(p[1]) < 1e-9 && (p[0] < 7 || p[0] > 28)) expect(q[1]).toBeCloseTo(-0.3, 9);
      expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it('разрезы кусков: от 0 до длины, по возрастанию, не ближе 0.3 м к вершинам', () => {
    const [L] = unionPolygons([flatGround().points, hill(8, 14, 19, 27, 4).points]);
    const [ch] = topChains(L, 0.45);
    const cum = chainCum(ch);
    const total = cum[cum.length - 1];
    const cuts = pieceCuts(cum, total, 6);
    expect(cuts[0]).toBe(0);
    expect(cuts[cuts.length - 1]).toBeCloseTo(total);
    for (let i = 1; i < cuts.length; i++) expect(cuts[i]).toBeGreaterThan(cuts[i - 1]);
    for (const c of cuts.slice(1, -1)) for (const v of cum.slice(1, -1)) expect(Math.abs(c - v)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    expect(cuts.length - 1).toBe(Math.round(total / 6));
  });
});

describe('хэш рельефа', () => {
  it('одинаковое содержимое — одинаковый хэш, сдвиг точки — другой', () => {
    const a = [flatGround(), hill(8, 14, 19, 27, 4)];
    const b = [flatGround(), hill(8, 14, 19, 27, 4)];
    const c = [flatGround(), hill(8, 14, 19, 27.5, 4)];
    expect(terrainHash(a)).toBe(terrainHash(b));
    expect(terrainHash(a)).not.toBe(terrainHash(c));
  });
});
