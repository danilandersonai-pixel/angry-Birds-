// Sample levels of episode 1 built from prefabs (LevelDef shape from src/core/types.ts; stars filled by exp3).
import { B, frame, tower, hut, pyramid, bunker, pigOn, flatGround, plateau, hill } from './prefabs.mjs';

const base = (id, name, birds, extra) => ({
  id, name, theme: 'meadow', birds, slingshot: { x: 0, y: 2.7 },
  bounds: { minX: -12, maxX: 48, maxY: 30 }, terrain: [flatGround()], blocks: [], pigs: [], tnt: [],
  stars: { one: 0, two: 0, three: 0 }, ...extra,
});

// 1-1 "Первый выстрел": two-storey wooden hut, small pig on each floor. Teaches: pull & release.
export function L1_1() {
  const f1 = frame({ x: 26 });
  const h2 = hut({ x: 26, y: f1.top });
  return base('1-1', 'Первый выстрел', ['red', 'red', 'red'], {
    blocks: [...f1.blocks, ...h2.blocks],
    pigs: [pigOn('small', 26, 0), pigOn('small', 26, f1.top)],
    meta: { nMin: 1, teach: 'pull-release', difficulty: 1 },
  });
}

// 1-2 "Хрупкое стекло": ice introduced. Low ice shed + 2-storey tower with ice columns and wood beams, medium on top.
export function L1_2() {
  const shed = frame({ x: 20, col: 'ice', beam: 'wood' });
  const t = tower({ x: 28, floors: 2, mats: { col: 'ice', beam: 'wood' } });
  return base('1-2', 'Хрупкое стекло', ['red', 'red', 'red'], {
    blocks: [...shed.blocks, ...t.blocks],
    pigs: [pigOn('small', 20, 0), pigOn('small', 28, 0), pigOn('medium', 28, t.top)],
    meta: { nMin: 2, teach: 'ice-is-fragile, medium pig', difficulty: 2 },
  });
}

// 1-3 "Каменная плита": stone introduced. Stone beam on wooden legs above a medium pig (crush trap),
// small pigs on a stone pyramid behind. Teaches: break wood under stone, let stone fall.
export function L1_3() {
  const trap = frame({ x: 21, col: 'wood', beam: 'stone' });
  const pyr = pyramid({ x: 29, rows: 3, mat: 'stone' });
  const top = frame({ x: 29, y: pyr.top, span: 2, h: 1, col: 'wood', beam: 'wood' });
  return base('1-3', 'Каменная плита', ['red', 'red', 'red'], {
    blocks: [...trap.blocks, ...pyr.blocks, ...top.blocks],
    pigs: [pigOn('medium', 21, 0), pigOn('small', 21, trap.top), pigOn('small', 29, top.top)],
    meta: { nMin: 2, teach: 'stone falls and crushes', difficulty: 3 },
  });
}

// 1-4 "Тройняшки": Blues introduced. Three ice sheds in a row, small pig in each.
export function L1_4() {
  const a = frame({ x: 20, col: 'ice', beam: 'ice' }), b = frame({ x: 25, col: 'ice', beam: 'ice' }), c = frame({ x: 30, col: 'ice', beam: 'ice' });
  return base('1-4', 'Тройняшки', ['blues', 'blues', 'red'], {
    blocks: [...a.blocks, ...b.blocks, ...c.blocks, B('ice', 'isoTriangle', 20, 3.25, 4, 1.5), B('ice', 'isoTriangle', 30, 3.25, 4, 1.5)],
    pigs: [pigOn('small', 20, 0), pigOn('small', 25, 0), pigOn('small', 30, 0), pigOn('small', 25, 2.5)],
    meta: { nMin: 2, teach: 'blues split vs ice', difficulty: 3 },
  });
}

// 1-5 "Холм": structure on a plateau (h = 3) — teaches lob shots / terrain; large pig introduced.
export function L1_5() {
  const t = tower({ x: 27, y: 3, floors: 2, mats: [{ col: 'wood', beam: 'wood' }, { col: 'ice', beam: 'wood' }] });
  return base('1-5', 'Холм', ['red', 'blues', 'red', 'blues'], {
    terrain: [flatGround(), hill(19, 23, 32, 35, 3)],
    blocks: [...t.blocks, B('stone', 'rect', 24, 3.5, 1, 1)],
    pigs: [pigOn('large', 27, 3), pigOn('small', 27, t.top), pigOn('small', 36.5, 0)],
    meta: { nMin: 3, teach: 'terrain, large pig', difficulty: 4 },
  });
}

// 1-8 "Бункер": Bomb introduced. Two stone bunkers with pigs inside + wood lookout.
export function L1_8() {
  const b1 = bunker({ x: 22, inner: 2, h: 1.5, mat: 'stone' });
  const b2 = bunker({ x: 29, inner: 2, h: 1.5, mat: 'stone' });
  const look = frame({ x: 29, y: b2.top, span: 3, h: 1.5, col: 'wood', beam: 'wood' });
  return base('1-8', 'Бункер', ['bomb', 'red', 'bomb'], {
    blocks: [...b1.blocks, ...b2.blocks, ...look.blocks],
    pigs: [pigOn('medium', 22, 0), pigOn('medium', 29, 0), pigOn('small', 29, look.top)],
    meta: { nMin: 2, teach: 'bomb vs stone', difficulty: 5 },
  });
}

export const SAMPLE = [L1_1, L1_2, L1_3, L1_4, L1_5, L1_8];
