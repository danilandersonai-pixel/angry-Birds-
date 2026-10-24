// Фикстуры уровней для тестов ядра (формат LevelDef, геометрия — по макросам 06-levels §3).

import type { BlockDef, LevelDef, Material, PigDef, PigType, TerrainDef } from '../../src/core/types';

export const PIG_R: Record<PigType, number> = { small: 0.405, medium: 0.6075, large: 0.8325, helmet: 0.63, mustache: 0.72, king: 1.17 };

export const flatGround = (x0 = -40, x1 = 140, depth = 10): TerrainDef => ({
  kind: 'ground',
  points: [[x0, -depth], [x1, -depth], [x1, 0], [x0, 0]],
});

export const rect = (material: Material, x: number, y: number, w: number, h: number): BlockDef => ({ material, shape: 'rect', x, y, w, h });

export const pigOn = (type: PigType, x: number, surfaceY: number): PigDef => ({ type, x, y: surfaceY + PIG_R[type] });

/** П-рама: две колонны 0.5×2 и балка 4×0.5 сверху (верх — y + 2.5). */
export function frame(x: number, y = 0, col: Material = 'wood', beam: Material = 'wood'): BlockDef[] {
  return [rect(col, x - 1.75, y + 1, 0.5, 2), rect(col, x + 1.75, y + 1, 0.5, 2), rect(beam, x, y + 2.25, 4, 0.5)];
}

/** Башня из нескольких рам. */
export function tower(x: number, floors: number, col: Material = 'wood', beam: Material = 'wood'): BlockDef[] {
  const out: BlockDef[] = [];
  for (let i = 0; i < floors; i++) out.push(...frame(x, i * 2.5, col, beam));
  return out;
}

export function level(over: Partial<LevelDef>): LevelDef {
  return {
    id: 'test',
    name: 'Тест',
    theme: 'meadow',
    birds: ['red', 'red', 'red'],
    slingshot: { x: 0, y: 2.7 },
    bounds: { minX: -12, maxX: 60, maxY: 30 },
    terrain: [flatGround()],
    blocks: [],
    pigs: [],
    tnt: [],
    stars: { one: 0, two: 20000, three: 30000 },
    ...over,
  };
}

/** Деревянная башня в 2 этажа со свиньями внутри и наверху (как 1-1). */
export const hutLevel = (birds: LevelDef['birds'] = ['red', 'red', 'red']): LevelDef =>
  level({ birds, blocks: tower(26, 2), pigs: [pigOn('small', 26, 0), pigOn('small', 26, 2.5)] });

/** Одна свинья далеко за пределами досягаемости — уровень заведомо не проходится. */
export const unreachableLevel = (): LevelDef =>
  level({ birds: ['red'], bounds: { minX: -12, maxX: 120, maxY: 30 }, pigs: [pigOn('small', 100, 0)] });

/** Пустое поле (одна свинья далеко) — для траекторий и способностей в свободном полёте. */
export const openField = (birds: LevelDef['birds']): LevelDef =>
  level({ birds, bounds: { minX: -12, maxX: 140, maxY: 40 }, pigs: [pigOn('small', 120, 0)] });

/** Крупный уровень: ~150 тел (6 башен по 6 этажей + свиньи) — для замера производительности. */
export function bigLevel(): LevelDef {
  const blocks: BlockDef[] = [];
  const pigs: PigDef[] = [];
  for (let i = 0; i < 8; i++) {
    const x = 16 + i * 5;
    blocks.push(...tower(x, 6, i % 3 === 0 ? 'stone' : 'wood', i % 2 === 0 ? 'wood' : 'ice'));
    pigs.push(pigOn('small', x, 0));
  }
  return level({ birds: ['bomb', 'bomb', 'bomb'], bounds: { minX: -12, maxX: 70, maxY: 30 }, blocks, pigs });
}
