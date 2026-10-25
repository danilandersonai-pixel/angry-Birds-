// Тесты статической проверки уровней (06 §4.2, §4.5, 00 §4) на синтетических примерах, макросов prefabs
// и всех уровней кампании (пустые эпизоды пропускаются).

import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../../src/core/types';
import { ALL_LEVELS, EPISODES, findLevel, nextLevelId } from '../../src/levels';
import { formatLint, lintLevel, lintLevels, reachHeight } from '../../src/levels/lint';
import {
  B,
  type LevelInput,
  blockOn,
  blockPolygon,
  bunker,
  cage,
  catalogKind,
  column,
  cradle,
  flatGround,
  frame,
  hall,
  hill,
  hut,
  level,
  pier,
  pigIn,
  pigOn,
  pit,
  profile,
  pyramid,
  roof,
  slingHill,
  slingshotOn,
  stack,
  tntOn,
  tower,
  tri,
} from '../../src/levels/prefabs';

/** Синтетический уровень: 3 Red, ровная земля, звёзды заданы. */
const mk = (o: Partial<LevelInput>): LevelDef =>
  level({ id: '9-1', name: 'Тест', theme: 'meadow', birds: ['red', 'red', 'red'], stars: { one: 0, two: 20000, three: 30000 }, ...o });

const codes = (lv: LevelDef, sev: 'error' | 'warning' = 'error'): string[] =>
  lintLevel(lv)[sev === 'error' ? 'errors' : 'warnings'].map((i) => i.code);

describe('prefabs', () => {
  it('1-1 собирается как в 06 §6.2 (сдвиг x 26 → 19 под V_MAX 21)', () => {
    const lv = findLevel('1-1') as LevelDef;
    expect(lv.blocks).toEqual([
      { material: 'wood', shape: 'rect', x: 17.25, y: 1, w: 0.5, h: 2 },
      { material: 'wood', shape: 'rect', x: 20.75, y: 1, w: 0.5, h: 2 },
      { material: 'wood', shape: 'rect', x: 19, y: 2.25, w: 4, h: 0.5 },
      { material: 'wood', shape: 'rect', x: 17.25, y: 3.5, w: 0.5, h: 2 },
      { material: 'wood', shape: 'rect', x: 20.75, y: 3.5, w: 0.5, h: 2 },
      { material: 'wood', shape: 'rect', x: 19, y: 4.75, w: 4, h: 0.5 },
      { material: 'wood', shape: 'isoTriangle', x: 19, y: 5.75, w: 4, h: 1.5 },
    ]);
    expect(lv.pigs).toEqual([
      { type: 'small', x: 19, y: 0.405 },
      { type: 'small', x: 19, y: 2.905 },
    ]);
    expect(lv.slingshot).toEqual({ x: 0, y: 2.7 });
    expect(lv.bounds).toEqual({ minX: -12, maxX: 34, maxY: 25 });
    expect(lv.stars).toEqual({ one: 0, two: 22000, three: 33000 });
  });

  it('макросы дают только детали каталога 00 §1.6', () => {
    const parts = [
      frame({ x: 20, span: 3 }),
      tower({ x: 20, floors: 3, roof: 'wood' }),
      hut({ x: 20, span: 3 }),
      bunker({ x: 20 }),
      bunker({ x: 20, inner: 2, wallW: 1, h: 2 }),
      pier({ x0: 20, n: 2, pileH: 4 }),
      pyramid({ x: 20, rows: 5, niches: [[1, 2]] }),
      cradle({ x: 20, y: 0, d: 2 }),
      cage({ x: 20 }),
      hall({ x: 20 }),
      roof({ x: 20, y: 0, kind: 'tris' }),
      stack({ x: 20, n: 3, kind: 'column' }),
      column(20, 0, 'stone', 3),
    ];
    for (const p of parts) for (const b of p.blocks) expect(catalogKind(b), JSON.stringify(b)).not.toBeNull();
  });

  it('пролёт 3 м перекрывается балкой 4 м со свесом, колонны — по краям пролёта', () => {
    const f = frame({ x: 10, span: 3 });
    expect(f.blocks.map((b) => [b.x, b.w])).toEqual([[8.75, 0.5], [11.25, 0.5], [10, 4]]);
    expect(f.spots[0]).toMatchObject({ x: 10, y: 0, w: 2, h: 2, kind: 'inside' });
  });

  it('зеркальный треугольник ◢: angle = π/2, w/h переставлены, габарит прежний', () => {
    const t = tri('wood', 2, 5, 0, 'left');
    expect(t).toMatchObject({ shape: 'triangle', x: 5, y: 1, w: 2, h: 2, angle: Math.PI / 2 });
    const pts = (blockPolygon(t) ?? []).map((p) => [Math.round(p.x * 1e6) / 1e6 + 0, Math.round(p.y * 1e6) / 1e6 + 0]);
    expect(pts).toEqual(expect.arrayContaining([[6, 0], [6, 2], [4, 0]]));
    const t1 = blockOn('ice', 'tri1', 0, 0, { mirror: true });
    expect(t1).toMatchObject({ w: 1, h: 1, angle: Math.PI / 2 });
  });

  it('свинья «стоит на»: y = опора + радиус (00 §1.5)', () => {
    expect(pigOn('medium', 3, 2.5)).toEqual({ type: 'medium', x: 3, y: 3.1075 });
    expect(pigOn('king', 0, 0, { fragile: true })).toEqual({ type: 'king', x: 0, y: 1.17, fragile: true });
    expect(tntOn(5, 1)).toEqual({ x: 5, y: 1.5 });
  });

  it('level(): умолчания и черновые звёзды', () => {
    const lv = level({ id: '2-4', name: 'Т', birds: ['red'], parts: [frame({ x: 25 })], pigs: [pigOn('small', 25, 0)] });
    expect(lv.theme).toBe('beach');
    expect(lv.slingshot).toEqual({ x: 0, y: 2.7 });
    expect(lv.terrain).toEqual([flatGround()]);
    expect(lv.bounds).toEqual({ minX: -12, maxX: 46, maxY: 25 });
    expect(lv.stars.one).toBe(0);
    expect(lv.stars.three).toBeGreaterThan(lv.stars.two);
    expect(lv.meta?.starsSource).toBe('manual');
  });
});

describe('огибающая досягаемости (06 §2.2)', () => {
  const A = { x: 0, y: 2.7 };
  // V_MAX 21 (было 24: red 18.3 / 14.2 / 11.1 / 7.4 / 2.9 на x 10 / 20 / 25 / 30 / 35) — таблица ядра envelope-v21
  it.each([
    ['red', 10, 13.4], ['red', 15, 11.1], ['red', 20, 7.9], ['red', 25, 3.9], ['red', 28, 1.0],
    ['bomb', 20, 5.7], ['matilda', 22, 5.0], ['terence', 15, 6.5], ['terence', 20, 2.4],
  ] as const)('%s на x = %d → %d м', (bird, x, h) => {
    expect(reachHeight(bird, A, x)).toBeCloseTo(h, 0);
    expect(Math.abs(reachHeight(bird, A, x) - h)).toBeLessThan(0.1);
  });
  it('рогатка на холме поднимает огибающую', () => {
    expect(reachHeight('red', { x: 0, y: 5.7 }, 30)).toBeCloseTo(reachHeight('red', A, 30) + 3, 6);
  });
});

describe('lint: синтетические примеры', () => {
  it('правильная рама со свиньёй — без ошибок и предупреждений', () => {
    const f = frame({ x: 25 });
    const r = lintLevel(mk({ parts: [f], pigs: [pigIn('small', f.spots[0]), pigIn('medium', f.spots[1])] }));
    expect(formatLint(r)).toContain('ошибок 0, предупреждений 0');
  });

  it('перекрытие > 0.02 — ошибка; встык и ±0.02 — нет', () => {
    const pig = [pigOn('small', 22, 0)]; // в досягаемости при V_MAX 21 (до V 24 стояла на 30)
    expect(codes(mk({ blocks: [B('wood', 'rect', 25, 1, 1, 2), B('wood', 'rect', 25.9, 1, 1, 2)], pigs: pig }))).toContain('overlap');
    expect(codes(mk({ blocks: [B('wood', 'rect', 25, 1, 1, 2), B('wood', 'rect', 26, 1, 1, 2)], pigs: pig }))).toEqual([]);
    expect(codes(mk({ blocks: [B('wood', 'rect', 25, 1, 1, 2), B('wood', 'rect', 25.99, 1, 1, 2)], pigs: pig }))).toEqual([]);
    expect(codes(mk({ blocks: [B('wood', 'rect', 25, 0.99, 1, 2)], pigs: pig }))).toEqual([]); // утоплен на 0.01
  });

  it('блок внутри рельефа и свинья внутри холма — перекрытие', () => {
    const terrain = [flatGround(), hill(20, 24, 30, 34, 3)];
    expect(codes(mk({ terrain, blocks: [B('wood', 'rect', 27, 2.75, 1, 1)], pigs: [pigOn('small', 27, 3)] }))).toContain('overlap');
  });

  it('висящий блок (зазор 0.05) и висящая свинья — ошибки опоры', () => {
    expect(codes(mk({ blocks: [B('wood', 'rect', 25, 1.05, 0.5, 2)], pigs: [pigOn('small', 22, 0)] }))).toEqual(['no-support']);
    expect(codes(mk({ pigs: [pigOn('small', 25, 0.1)] }))).toEqual(['pig-floating']);
  });

  it('консоль: центр масс вне опоры — ошибка, запас < 0.10 — предупреждение', () => {
    const col = B('wood', 'rect', 25, 1, 0.5, 2);
    const pig = [pigOn('small', 22, 0)];
    expect(codes(mk({ blocks: [col, B('wood', 'rect', 26.6, 2.25, 4, 0.5)], pigs: pig }))).toContain('com-outside');
    const warn = mk({ blocks: [col, B('wood', 'rect', 25.2, 2.25, 4, 0.5)], pigs: pig });
    expect(codes(warn)).toEqual([]);
    expect(codes(warn, 'warning')).toContain('com-margin');
  });

  it('консоль с грузом считается по ЦМ подсистемы (06 S4)', () => {
    // балка 4×0.5 на колонне [24.75; 25.25], вылет вправо; без груза ЦМ 25.2 стоит, с large на торце — падает
    const col = B('wood', 'rect', 25, 1, 0.5, 2);
    const beamB = B('wood', 'rect', 25.2, 2.25, 4, 0.5);
    expect(codes(mk({ blocks: [col, beamB], pigs: [pigOn('large', 26.5, 2.5, { fragile: true })] }))).toContain('com-outside');
  });

  it('опирание < 0.25 м — ошибка (06 S5)', () => {
    const r = mk({
      blocks: [B('wood', 'rect', 24, 1, 0.5, 2), B('wood', 'rect', 28, 1, 0.5, 2), B('wood', 'rect', 26.15, 2.25, 4, 0.5)],
      pigs: [pigOn('small', 31, 0)],
    });
    // балка [24.15; 28.15]: на левой колонне [23.75; 24.25] — 0.1 м
    expect(codes(r)).toContain('bearing');
  });

  it('блок на ребре (повёрнут на 45°) — точечная опора', () => {
    const s = Math.SQRT1_2;
    expect(codes(mk({ blocks: [B('wood', 'rect', 25, s, 1, 1, Math.PI / 4)], pigs: [pigOn('small', 30, 0)] }))).toContain('point-support');
  });

  it('свинья на колонне — нужен fragile; с fragile — чисто', () => {
    expect(codes(mk({ parts: [column(25, 0)], pigs: [pigOn('small', 25, 2)] }))).toEqual(['pig-free-space']);
    expect(codes(mk({ parts: [column(25, 0)], pigs: [pigOn('small', 25, 2, { fragile: true })] }))).toEqual([]);
  });

  it('свинья в узкой нише со стенками ≤ 0.3 м — можно без fragile', () => {
    const c = cage({ x: 25 });
    expect(codes(mk({ parts: [c], pigs: [pigIn('small', c.spots[0])] }))).toEqual([]);
  });

  it('свинья на коньке крыши — запрещено (06 S13)', () => {
    const h = hut({ x: 25 });
    expect(codes(mk({ parts: [h], pigs: [pigOn('small', 25, h.top)] }))).toContain('pig-apex');
  });

  it('свинья на уклоне 5° — ошибка (06 S6)', () => {
    const a = (5 * Math.PI) / 180;
    const terrain = [profile([[-40, 0], [20, 0], [30, 10 * Math.tan(a)], [140, 10 * Math.tan(a)]])];
    const pig = { type: 'small' as const, x: 25 - Math.sin(a) * 0.405, y: 5 * Math.tan(a) + Math.cos(a) * 0.405 };
    expect(codes(mk({ terrain, pigs: [pig] }))).toEqual(['pig-slope']);
  });

  it('свинья на стыке двух балок настила — ровная опора', () => {
    expect(codes(mk({ parts: [pier({ x0: 20, n: 2 })], pigs: [pigOn('small', 24, 2.5)] }))).toEqual([]);
  });

  it('шар без стопоров — ошибка, в колыбели — чисто', () => {
    expect(codes(mk({ blocks: [blockOn('stone', 'ball1', 25, 0)], pigs: [pigOn('small', 22, 0)] }))).toEqual(['ball-no-stoppers']);
    expect(codes(mk({ parts: [cradle({ x: 25, y: 0 })], pigs: [pigOn('small', 22, 0)] }))).toEqual([]);
    expect(codes(mk({ parts: [cradle({ x: 25, y: 0, d: 2 })], pigs: [pigOn('small', 22, 0)] }))).toEqual([]);
  });

  it('лёд на склоне 30° соскальзывает', () => {
    const a = Math.PI / 6;
    const terrain = [flatGround(), { kind: 'rock' as const, points: [[20, 0], [30, 0], [30, 10 * Math.tan(a)]] as Array<[number, number]> }];
    const yS = 5 * Math.tan(a);
    const blk = B('ice', 'rect', 25 - Math.sin(a) * 0.25, yS + Math.cos(a) * 0.25, 1, 0.5, a);
    expect(codes(mk({ terrain, blocks: [blk], pigs: [pigOn('small', 33, 0)] }))).toContain('slide');
  });

  it('пирамида с нишей получает перемычку и стоит', () => {
    const p = pyramid({ x: 25, rows: 4, niches: [[1, 1]] });
    expect(codes(mk({ parts: [p], pigs: [pigIn('small', p.spots[1])] }))).toEqual([]);
  });

  it('ниша без перемычки: блоки держатся только упором друг в друга — предупреждение com-leaning, не ошибка', () => {
    const blocks = pyramid({ x: 25, rows: 4 }).blocks.filter((b) => !(b.x === 25 && b.y === 1.5));
    const lv = mk({ blocks, pigs: [pigOn('small', 25, 1)] });
    expect(codes(lv)).toEqual([]);
    expect(codes(lv, 'warning')).toEqual(['com-leaning', 'com-leaning']);
  });

  it('нет свиней, свинья вне досягаемости, рогатка в воздухе', () => {
    expect(codes(mk({ parts: [frame({ x: 25 })] }))).toEqual(['no-pigs']);
    expect(codes(mk({ bounds: { maxX: 80 }, pigs: [pigOn('small', 60, 0)] }))).toEqual(['unreachable']);
    expect(codes(mk({ slingshot: { x: 0, y: 3.5 }, pigs: [pigOn('small', 25, 0)] }))).toEqual(['slingshot-terrain']);
  });

  it('досягаемость по птицам уровня: Terence не достаёт до x = 25, Red — достаёт (V_MAX 21)', () => {
    const pigs = [pigOn('small', 25, 0)];
    expect(codes(mk({ birds: ['terence'], pigs }))).toEqual(['unreachable']);
    expect(codes(mk({ birds: ['terence', 'red'], pigs }))).toEqual([]);
  });

  it('рогатка на холме: основание на площадке — чисто', () => {
    const lv = mk({ terrain: [flatGround(), slingHill(3)], slingshot: slingshotOn(0, 3), pigs: [pigOn('small', 22, 0)] });
    expect(codes(lv)).toEqual([]);
    expect(codes(lv, 'warning')).toEqual([]);
  });

  it('яма — невыпуклый рельеф: свинья на дне стоит', () => {
    expect(codes(mk({ terrain: [pit(20, 25, 4)], pigs: [pigOn('small', 22.5, -4)] }))).toEqual([]);
  });

  it('лимит динамических тел ≤ 120', () => {
    const blocks = Array.from({ length: 130 }, (_, i) => blockOn('wood', 'cube', -5 + i * 0.5, 0));
    expect(codes(mk({ blocks, bounds: { minX: -12, maxX: 80 }, pigs: [pigOn('small', 25, 0.5)] }))).toContain('body-limit');
  });

  it('тело за границами уровня', () => {
    expect(codes(mk({ bounds: { minX: -12, maxX: 40, maxY: 25 }, blocks: [blockOn('wood', 'square', 40, 0)], pigs: [pigOn('small', 25, 0)] }))).toContain('out-of-bounds');
  });

  it('звёзды: two ≥ three — ошибка', () => {
    expect(codes(mk({ stars: { one: 0, two: 40000, three: 30000 }, pigs: [pigOn('small', 25, 0)] }))).toEqual(['stars']);
  });

  it('предупреждения: стройный столб, отношение масс, серая зона TNT, свиньи вплотную, некаталожный размер', () => {
    const w = (o: Partial<LevelInput>): string[] => codes(mk({ pigs: [pigOn('small', 34, 0)], ...o }), 'warning');
    expect(w({ parts: [stack({ x: 25, n: 5, kind: 'column' })] })).toContain('slender');
    expect(w({ blocks: [blockOn('ice', 'cube', 24.25, 0), blockOn('ice', 'cube', 25.75, 0), B('stone', 'rect', 25, 1, 2, 1)] })).toContain('mass-ratio');
    expect(w({ tnt: [tntOn(22, 0), tntOn(25.2, 0)] })).toContain('tnt-gap');
    expect(w({ pigs: [pigOn('small', 25, 0), pigOn('small', 25.9, 0)] })).toContain('pig-close');
    expect(w({ blocks: [B('wood', 'rect', 25, 0.25, 3, 0.5)] })).toContain('catalog');
    expect(w({ blocks: [B('wood', 'rect', 25, 0.25, 0.7, 0.5)] })).toContain('grid');
  });

  it('повтор id ловится lintLevels', () => {
    const a = mk({ pigs: [pigOn('small', 25, 0)] });
    const res = lintLevels([a, a]);
    expect(res[1].errors.map((i) => i.code)).toContain('id');
  });

  it('проблема указывает на элемент уровня', () => {
    const r = lintLevel(mk({ blocks: [B('wood', 'rect', 25, 1.05, 0.5, 2, 0, 'висячая')], pigs: [pigOn('small', 30, 0)] }));
    expect(r.errors[0].target).toEqual({ kind: 'block', index: 0, id: 'висячая' });
    expect(r.errors[0].message).toContain('«висячая»');
    expect(r.errors[0].at).toBeDefined();
  });
});

describe('кампания', () => {
  it('3 эпизода с темами meadow / beach / snow', () => {
    expect(EPISODES.map((e) => [e.id, e.theme])).toEqual([['1', 'meadow'], ['2', 'beach'], ['3', 'snow']]);
  });

  it('findLevel / nextLevelId', () => {
    expect(findLevel('1-1')?.name).toBe('Первый выстрел');
    expect(findLevel('0-0')).toBeUndefined();
    const ids = ALL_LEVELS.map((l) => l.id);
    for (let i = 0; i + 1 < ids.length; i++) expect(nextLevelId(ids[i])).toBe(ids[i + 1]);
    expect(nextLevelId(ids[ids.length - 1])).toBeNull();
    expect(nextLevelId('нет такого')).toBeNull();
  });

  it('id уникальны, уровни эпизода — с префиксом эпизода и в своей теме', () => {
    expect(new Set(ALL_LEVELS.map((l) => l.id)).size).toBe(ALL_LEVELS.length);
    for (const ep of EPISODES) for (const l of ep.levels) {
      expect(l.id.startsWith(`${ep.id}-`)).toBe(true);
      expect(l.theme).toBe(ep.theme);
    }
  });

  for (const ep of EPISODES) {
    describe.skipIf(ep.levels.length === 0)(`эпизод ${ep.id} «${ep.name}»`, () => {
      for (const lv of ep.levels) {
        it(`${lv.id} «${lv.name}»: lint без ошибок`, () => {
          const r = lintLevel(lv);
          expect(r.errors, formatLint(r)).toEqual([]);
        });
      }
    });
  }
});
