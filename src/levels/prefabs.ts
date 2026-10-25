// Библиотека конструкций для авторинга уровней (перенос и развитие docs/research/06-levels-lab/prefabs.mjs, 06-levels.md §3).
//
// Соглашения (контракт src/core/types.ts):
// - метры, ось Y вверх, земля обычно на y = 0, рогатка слева (ANCHOR = основание + (0, 2.7));
// - BlockDef.(x, y) — центр ОГРАНИЧИВАЮЩЕГО прямоугольника формы; у 'triangle' прямой угол внизу слева (◣),
//   зеркальный ◢ — тот же 'triangle' с angle = π/2 и переставленными w/h (центр габарита не меняется);
// - блоки ставятся визуально ВСТЫК: верх опоры = низ перекрытия. Ядро само сжимает коллизии на INSET (0.0075 м);
// - все готовые конструкции собираются ТОЛЬКО из блоков каталога 00-summary §1.6 (сетка U = 0.5 м). Если размер
//   пролёта не совпадает с длиной балки каталога, берётся ближайшая более длинная балка (свес поровну с двух сторон)
//   или колонна набирается из нескольких деталей. Для точных некаталожных размеров есть опция exact (lint предупредит);
// - у всех макросов y — ОПОРНАЯ поверхность (низ конструкции), а не центр;
// - координаты округляются до 1e-4 (06 §6.3), порядок массивов = порядок создания тел (детерминизм) — не сортировать.
//
// Пример (episodeN.ts):
//   const t = tower({ x: 26, floors: 2, mats: [{ col: 'ice', beam: 'wood' }, 'wood'], roof: 'wood' });
//   const b = bunker({ x: 31 });
//   export const L1_9 = (): LevelDef => level({
//     id: '1-9', name: 'Пороховой склад', birds: ['red', 'chuck', 'bomb', 'red'],
//     terrain: [flatGround(), plateau(22, 29, 1.5)],
//     parts: [t, b], tnt: [tntOn(20.25, 0)],
//     pigs: [pigIn('medium', t.spots[0]), pigIn('small', t.spots[1], 1), pigIn('medium', b.spots[0])],
//     meta: { nMin: 2, difficulty: 6, teach: 'TNT и цепочка' },   // stars не заданы → черновая формула 06 §8.2
//   });
// Проверка: npx tsx scripts/level-lint.ts 1-9 и dev/preview-level.html?id=1-9.

import type {
  BirdType,
  BlockDef,
  BlockShape,
  DecorDef,
  LevelDef,
  LevelMeta,
  Material,
  PigDef,
  PigType,
  StarThresholds,
  TerrainDef,
  ThemeId,
  TntDef,
  Vec,
} from '../core/types';
import { BIRDS, MATERIALS, PIGS, SCORE, SLINGSHOT, TNT } from '../config/constants';

// ─────────────────────────────────────────────────────────────────────────────
// Числа и каталог
// ─────────────────────────────────────────────────────────────────────────────

/** Шаг сетки уровня, м (06 §1.2). */
export const U = 0.5;

/** Радиусы свиней, м (00 §1.5). */
export const PIG_R: Readonly<Record<PigType, number>> = {
  small: PIGS.small.radius,
  medium: PIGS.medium.radius,
  large: PIGS.large.radius,
  helmet: PIGS.helmet.radius,
  mustache: PIGS.mustache.radius,
  king: PIGS.king.radius,
};

/** Радиусы птиц, м (00 §1.3; у Чака — описанный радиус треугольника). */
export const BIRD_R: Readonly<Record<BirdType, number>> = {
  red: BIRDS.red.radius,
  blues: BIRDS.blues.radius,
  chuck: BIRDS.chuck.radius,
  bomb: BIRDS.bomb.radius,
  matilda: BIRDS.matilda.radius,
  hal: BIRDS.hal.radius,
  terence: BIRDS.terence.radius,
  silver: BIRDS.silver.radius,
};

/**
 * Каталог блоков (00-summary §1.6). Прямоугольники записаны «лёжа» (w ≥ h, кроме column);
 * в уровне допустима любая ориентация (w и h можно переставить — vertical: true).
 */
export const CATALOG = {
  cube: { shape: 'rect', w: 0.5, h: 0.5 },
  brick: { shape: 'rect', w: 1, h: 0.5 },
  square: { shape: 'rect', w: 1, h: 1 },
  column: { shape: 'rect', w: 0.5, h: 2 },
  plank: { shape: 'rect', w: 2, h: 0.5 },
  slab: { shape: 'rect', w: 2, h: 1 },
  beam: { shape: 'rect', w: 4, h: 0.5 },
  longBeam: { shape: 'rect', w: 5, h: 0.5 },
  big: { shape: 'rect', w: 2, h: 2 },
  roof: { shape: 'isoTriangle', w: 4, h: 1.5 },
  roofS: { shape: 'isoTriangle', w: 2, h: 1 },
  tri1: { shape: 'triangle', w: 1, h: 1 },
  tri2: { shape: 'triangle', w: 2, h: 2 },
  ball1: { shape: 'circle', w: 1, h: 1 },
  ball2: { shape: 'circle', w: 2, h: 2 },
} as const satisfies Record<string, { shape: BlockShape; w: number; h: number }>;

export type BlockKind = keyof typeof CATALOG;

const EPS = 1e-6;
const near = (a: number, b: number, e = 1e-4): boolean => Math.abs(a - b) <= e;

/** Округление координат до 1e-4 (06 §6.3). */
export const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0; // +0 убирает −0

/** Какому элементу каталога соответствует блок (с учётом поворота на 90°); null — некаталожный размер. */
export function catalogKind(b: Pick<BlockDef, 'shape' | 'w' | 'h'>): BlockKind | null {
  for (const [k, c] of Object.entries(CATALOG) as Array<[BlockKind, (typeof CATALOG)[BlockKind]]>) {
    if (c.shape !== b.shape) continue;
    if ((near(c.w, b.w) && near(c.h, b.h)) || (near(c.w, b.h) && near(c.h, b.w))) return k;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Геометрия блоков (общая для lint и предпросмотра)
// ─────────────────────────────────────────────────────────────────────────────

/** Контур формы (кроме круга) в локальных координатах центра габарита, против часовой (как ядро). */
export function shapeLocal(shape: Exclude<BlockShape, 'circle'>, w: number, h: number): Vec[] {
  const x = w / 2;
  const y = h / 2;
  switch (shape) {
    case 'rect':
      return [{ x: -x, y: -y }, { x, y: -y }, { x, y }, { x: -x, y }];
    case 'triangle':
      return [{ x: -x, y: -y }, { x, y: -y }, { x: -x, y }];
    case 'isoTriangle':
      return [{ x: -x, y: -y }, { x, y: -y }, { x: 0, y }];
  }
}

/** Мировой контур блока (против часовой). Для круга — null. */
export function blockPolygon(b: Pick<BlockDef, 'shape' | 'x' | 'y' | 'w' | 'h' | 'angle'>): Vec[] | null {
  if (b.shape === 'circle') return null;
  const a = b.angle ?? 0;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return shapeLocal(b.shape, b.w, b.h).map((p) => ({ x: b.x + p.x * c - p.y * s, y: b.y + p.x * s + p.y * c }));
}

/** TNT как блок-квадрат (для геометрии). */
export function tntAsBlock(t: TntDef): BlockDef {
  const s = t.size ?? TNT.SIZE;
  return { material: 'wood', shape: 'rect', x: t.x, y: t.y, w: s, h: s, ...(t.angle ? { angle: t.angle } : {}) };
}

/** Габарит блока в мире. */
export function blockAabb(b: BlockDef): { minX: number; minY: number; maxX: number; maxY: number } {
  if (b.shape === 'circle') {
    const r = b.w / 2;
    return { minX: b.x - r, minY: b.y - r, maxX: b.x + r, maxY: b.y + r };
  }
  const pts = blockPolygon(b) as Vec[];
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/** Верх блока (максимальная y). */
export function topOf(b: BlockDef | TntDef): number {
  const bd = 'material' in b ? b : tntAsBlock(b);
  return blockAabb(bd).maxY;
}

/** Визуальная площадь формы, м². */
export function blockArea(b: Pick<BlockDef, 'shape' | 'w' | 'h'>): number {
  if (b.shape === 'circle') return Math.PI * (b.w / 2) ** 2;
  return b.shape === 'rect' ? b.w * b.h : (b.w * b.h) / 2;
}

/** Масса блока, кг (ρ·S, 03 §3.3). */
export function blockMass(b: BlockDef): number {
  return MATERIALS[b.material].density * blockArea(b);
}

// ─────────────────────────────────────────────────────────────────────────────
// Элементарные детали
// ─────────────────────────────────────────────────────────────────────────────

/** Сырой блок по центру габарита (как B() в лаборатории). angle — радианы. */
export function B(material: Material, shape: BlockShape, x: number, y: number, w: number, h: number, angle = 0, id?: string): BlockDef {
  const b: BlockDef = { material, shape, x: r4(x), y: r4(y), w, h };
  if (angle) b.angle = angle;
  if (id) b.id = id;
  return b;
}

export interface PutOpts {
  /** Повернуть прямоугольник на 90° (w ↔ h): «колонна» из балки, вертикальная плита и т.п. */
  vertical?: boolean;
  /** Зеркальный треугольник ◢ (прямой угол внизу справа). Для остальных форм не влияет. */
  mirror?: boolean;
  id?: string;
}

/** Деталь каталога, поставленная НА поверхность y (низ детали = y), центр по x. */
export function blockOn(material: Material, kind: BlockKind, x: number, y: number, opts: PutOpts = {}): BlockDef {
  const c = CATALOG[kind];
  let w: number = c.w;
  let h: number = c.h;
  if (opts.vertical && c.shape === 'rect') [w, h] = [h, w];
  if (c.shape === 'triangle' && opts.mirror) {
    // ◢: w и h переставлены, angle = π/2; габарит визуально тот же (ширина c.w, высота c.h)
    return B(material, 'triangle', x, y + c.h / 2, c.h, c.w, Math.PI / 2, opts.id);
  }
  return B(material, c.shape, x, y + h / 2, w, h, 0, opts.id);
}

/** Прямоугольный треугольник: dir 'right' — ◣ (скат смотрит вправо), 'left' — ◢ (скат смотрит влево). */
export function tri(material: Material, size: 1 | 2, x: number, y: number, dir: 'left' | 'right' = 'right'): BlockDef {
  return blockOn(material, size === 1 ? 'tri1' : 'tri2', x, y, { mirror: dir === 'left' });
}

/** Ящик TNT, стоящий на поверхности y. */
export function tntOn(x: number, y: number, size: number = TNT.SIZE): TntDef {
  const t: TntDef = { x: r4(x), y: r4(y + size / 2) };
  if (size !== TNT.SIZE) t.size = size;
  return t;
}

export interface PigOpts {
  /** Намеренно неустойчивое место (на колонне, на краю): снимает требование ≥ 0.7 м свободы (06 S7). */
  fragile?: boolean;
  id?: string;
}

/** Свинья, стоящая на поверхности y: центр = y + радиус (06 §2.1). */
export function pigOn(type: PigType, x: number, y: number, opts: PigOpts = {}): PigDef {
  const p: PigDef = { type, x: r4(x), y: r4(y + PIG_R[type]) };
  if (opts.fragile) p.fragile = true;
  if (opts.id) p.id = opts.id;
  return p;
}

/** Свинья в «месте» конструкции (spot), со смещением dx от центра места. */
export function pigIn(type: PigType, spot: Spot, dx = 0, opts: PigOpts = {}): PigDef {
  return pigOn(type, spot.x + dx, spot.y, opts);
}

/** Свинья на верхней грани блока (горизонтального прямоугольника). */
export function pigOnBlock(type: PigType, b: BlockDef, dx = 0, opts: PigOpts = {}): PigDef {
  return pigOn(type, b.x + dx, topOf(b), opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// Часть уровня (результат макроса)
// ─────────────────────────────────────────────────────────────────────────────

/** Место для свиньи: x центра, y опорной поверхности, свободная ширина и высота проёма (Infinity — открыто сверху). */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'inside' | 'top' | 'deck' | 'under' | 'niche';
}

/** Набор тел, который возвращает любой макрос конструкции. */
export interface Part {
  blocks: BlockDef[];
  pigs: PigDef[];
  tnt: TntDef[];
  /** Верх конструкции (y самой высокой грани). */
  top: number;
  /** Места для свиней (внутри этажей, на крыше, на настиле…). */
  spots: Spot[];
}

export function part(p: Partial<Part> & { blocks?: BlockDef[] }): Part {
  const blocks = p.blocks ?? [];
  const tnt = p.tnt ?? [];
  let top = p.top ?? -Infinity;
  if (p.top === undefined) {
    for (const b of blocks) top = Math.max(top, topOf(b));
    for (const t of tnt) top = Math.max(top, topOf(t));
  }
  return { blocks, pigs: p.pigs ?? [], tnt, top, spots: p.spots ?? [] };
}

/** Объединить части (порядок сохраняется). */
export function merge(...parts: Part[]): Part {
  return {
    blocks: parts.flatMap((p) => p.blocks),
    pigs: parts.flatMap((p) => p.pigs),
    tnt: parts.flatMap((p) => p.tnt),
    top: Math.max(-Infinity, ...parts.map((p) => p.top)),
    spots: parts.flatMap((p) => p.spots),
  };
}

/** Сдвинуть часть на (dx, dy). */
export function shift(p: Part, dx: number, dy = 0): Part {
  return {
    blocks: p.blocks.map((b) => ({ ...b, x: r4(b.x + dx), y: r4(b.y + dy) })),
    pigs: p.pigs.map((q) => ({ ...q, x: r4(q.x + dx), y: r4(q.y + dy) })),
    tnt: p.tnt.map((t) => ({ ...t, x: r4(t.x + dx), y: r4(t.y + dy) })),
    top: p.top + dy,
    spots: p.spots.map((s) => ({ ...s, x: r4(s.x + dx), y: r4(s.y + dy) })),
  };
}

/** Зеркально отразить часть относительно вертикали x = axis (треугольники ◣ ↔ ◢). */
export function mirrorX(p: Part, axis: number): Part {
  const mx = (x: number): number => r4(2 * axis - x);
  const blocks = p.blocks.map((b): BlockDef => {
    const out: BlockDef = { ...b, x: mx(b.x) };
    if (b.shape === 'triangle') {
      const a = b.angle ?? 0;
      if (near(a, 0)) Object.assign(out, { w: b.h, h: b.w, angle: Math.PI / 2 });
      else if (near(a, Math.PI / 2)) {
        Object.assign(out, { w: b.h, h: b.w });
        delete out.angle;
      } else throw new Error('mirrorX: треугольник с произвольным углом не поддерживается');
    } else if (b.angle) out.angle = -b.angle;
    return out;
  });
  return {
    blocks,
    pigs: p.pigs.map((q) => ({ ...q, x: mx(q.x) })),
    tnt: p.tnt.map((t) => ({ ...t, x: mx(t.x), ...(t.angle ? { angle: -t.angle } : {}) })),
    top: p.top,
    spots: p.spots.map((s) => ({ ...s, x: mx(s.x) })),
  };
}

/** Добавить к части свиней / TNT. */
export function withPigs(p: Part, ...pigs: PigDef[]): Part {
  return { ...p, pigs: [...p.pigs, ...pigs] };
}
export function withTnt(p: Part, ...tnt: TntDef[]): Part {
  return { ...p, tnt: [...p.tnt, ...tnt] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Подбор деталей каталога
// ─────────────────────────────────────────────────────────────────────────────

/** Детали каталога для вертикального столба ширины w: [высота, вид, vertical] сверху вниз по убыванию. */
const PILLAR_PIECES: Record<string, Array<[number, BlockKind, boolean]>> = {
  '0.5': [[5, 'longBeam', true], [4, 'beam', true], [2, 'column', false], [1, 'brick', true], [0.5, 'cube', false]],
  '1': [[2, 'slab', true], [1, 'square', false], [0.5, 'brick', false]],
  '2': [[2, 'big', false], [1, 'slab', false], [0.5, 'plank', false]],
  '4': [[0.5, 'beam', false]],
  '5': [[0.5, 'longBeam', false]],
};

/** Длины горизонтальных деталей каталога по толщине t. */
const LINTELS: Record<string, Array<[number, BlockKind]>> = {
  '0.5': [[0.5, 'cube'], [1, 'brick'], [2, 'plank'], [4, 'beam'], [5, 'longBeam']],
  '1': [[1, 'square'], [2, 'slab']],
  '2': [[2, 'big']],
};

const key = (v: number): string => String(r4(v));

/**
 * Столб ширины w и высоты h на поверхности y, набранный из деталей каталога (крупные — внизу).
 * Если высоту не набрать каталогом — один некаталожный блок (lint предупредит).
 */
export function pillar(x: number, y: number, h: number, material: Material, w = 0.5, exact = false): BlockDef[] {
  const pieces = PILLAR_PIECES[key(w)];
  if (!exact && pieces) {
    const out: BlockDef[] = [];
    let rest = h;
    let yy = y;
    for (const [ph, kind, vertical] of pieces) {
      while (rest >= ph - EPS) {
        out.push(blockOn(material, kind, x, yy, { vertical }));
        yy += ph;
        rest -= ph;
      }
    }
    if (Math.abs(rest) < EPS) return out;
  }
  return [B(material, 'rect', x, y + h / 2, w, h)];
}

/**
 * Горизонтальная перекладина над пролётом span (центр xc, низ на y, толщина t).
 * Берёт деталь каталога точной длины, иначе ближайшую более длинную (свес поровну); exact — ровно span.
 */
export function lintel(xc: number, y: number, span: number, material: Material, t = 0.5, exact = false): BlockDef {
  const opts = LINTELS[key(t)];
  if (!exact && opts) {
    const pick = opts.find(([len]) => len >= span - EPS);
    if (pick) return B(material, 'rect', xc, y + t / 2, pick[0], t);
  }
  return B(material, 'rect', xc, y + t / 2, span, t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Простые элементы
// ─────────────────────────────────────────────────────────────────────────────

/** Колонна (столб) ширины w и высоты h на поверхности yBase. По умолчанию — колонна каталога 0.5×2. */
export function column(x: number, yBase: number, material: Material = 'wood', h = 2, w = 0.5): Part {
  const blocks = pillar(x, yBase, h, material, w);
  return part({ blocks, top: yBase + h, spots: [{ x, y: yBase + h, w, h: Infinity, kind: 'top' }] });
}

/** Балка длиной len и толщиной t, лежащая на поверхности y (центр xc). Длина — как задана (lint проверит каталог). */
export function beam(xc: number, y: number, len = 4, material: Material = 'wood', t = 0.5): Part {
  const b = B(material, 'rect', xc, y + t / 2, len, t);
  return part({ blocks: [b], top: y + t, spots: [{ x: xc, y: y + t, w: len, h: Infinity, kind: 'top' }] });
}

/** Вертикальная стопка одинаковых деталей каталога. */
export function stack({ x, y = 0, n = 3, kind = 'square', mat = 'wood', vertical = false }: {
  x: number;
  y?: number;
  n?: number;
  kind?: BlockKind;
  mat?: Material;
  vertical?: boolean;
}): Part {
  const blocks: BlockDef[] = [];
  let yy = y;
  for (let i = 0; i < n; i++) {
    const b = blockOn(mat, kind, x, yy, { vertical });
    blocks.push(b);
    yy = topOf(b);
  }
  const w = blocks.length ? blocks[0].w : 0;
  return part({ blocks, top: yy, spots: [{ x, y: yy, w, h: Infinity, kind: 'top' }] });
}

/** Стена из квадратов 1×1 (или других деталей) — заслон линии выстрела. Алиас stack. */
export const wall = stack;

/** Частокол: n деталей вплотную бок о бок, центр ряда x (по умолчанию колонны 0.5×2). */
export function palisade({ x, y = 0, n = 3, kind = 'column', mat = 'wood', vertical = false }: {
  x: number;
  y?: number;
  n?: number;
  kind?: BlockKind;
  mat?: Material;
  vertical?: boolean;
}): Part {
  const probe = blockOn(mat, kind, 0, 0, { vertical });
  const x0 = x - (n * probe.w) / 2 + probe.w / 2;
  const blocks = Array.from({ length: n }, (_, i) => blockOn(mat, kind, x0 + i * probe.w, y, { vertical }));
  return part({ blocks });
}

// ─────────────────────────────────────────────────────────────────────────────
// Конструкции (06 §3)
// ─────────────────────────────────────────────────────────────────────────────

export interface FrameOpts {
  /** Центр рамы. */
  x: number;
  /** Опорная поверхность. */
  y?: number;
  /** Пролёт по внешним граням колонн (= длина балки, если такая есть в каталоге). */
  span?: number;
  /** Высота колонн. */
  h?: number;
  colW?: number;
  col?: Material;
  beam?: Material;
  beamT?: number;
  /** Принудительная длина балки (по умолчанию — span или ближайшая длиннее из каталога). */
  beamLen?: number;
  /** Ровно span и h, даже если таких деталей нет в каталоге (lint предупредит). */
  exact?: boolean;
}

/**
 * П-рама: две колонны + балка сверху (06 §3). Наружные грани колонн заподлицо с торцами балки.
 * spots: [0] — внутри (проём span − 2·colW × h), [1] — на балке.
 */
export function frame({ x, y = 0, span = 4, h = 2, colW = 0.5, col = 'wood', beam: beamMat = 'wood', beamT = 0.5, beamLen, exact = false }: FrameOpts): Part {
  const cx = span / 2 - colW / 2;
  const top = lintel(x, y + h, beamLen ?? span, beamMat, beamT, exact || beamLen !== undefined);
  const blocks = [...pillar(x - cx, y, h, col, colW, exact), ...pillar(x + cx, y, h, col, colW, exact), top];
  const yTop = y + h + beamT;
  return part({
    blocks,
    top: yTop,
    spots: [
      { x, y, w: span - 2 * colW, h, kind: 'inside' },
      { x, y: yTop, w: top.w, h: Infinity, kind: 'top' },
    ],
  });
}

export type FloorMats = Material | { col: Material; beam: Material };
const floorMats = (m: FloorMats): { col: Material; beam: Material } => (typeof m === 'string' ? { col: m, beam: m } : m);

export interface RoofOpts {
  x: number;
  /** Поверхность, на которой лежит крыша. */
  y: number;
  w?: number;
  h?: number;
  mat?: Material;
  /** 'iso' — равнобедренный треугольник; 'tris' — два прямоугольных ◢◣ (конёк по центру). */
  kind?: 'iso' | 'tris';
}

/** Крыша: iso 4×1.5 / 2×1 или пара прямоугольных треугольников (tri2 ×2 → 4×2, tri1 ×2 → 2×1). */
export function roof({ x, y, w = 4, h, mat = 'wood', kind = 'iso' }: RoofOpts): Part {
  if (kind === 'iso') {
    const hh = h ?? (near(w, 2) ? 1 : 1.5);
    const b = B(mat, 'isoTriangle', x, y + hh / 2, w, hh);
    return part({ blocks: [b], top: y + hh });
  }
  const hw = w / 2;
  const hh = h ?? hw;
  const left = B(mat, 'triangle', x - hw / 2, y + hh / 2, hh, hw, Math.PI / 2); // ◢
  const right = B(mat, 'triangle', x + hw / 2, y + hh / 2, hw, hh); // ◣
  return part({ blocks: [left, right], top: y + hh });
}

export interface TowerOpts {
  x: number;
  y?: number;
  floors?: number;
  span?: number;
  h?: number;
  colW?: number;
  /** Материалы этажей: один на всё или массив по этажам (снизу вверх, по кругу). */
  mats?: FloorMats | FloorMats[];
  /** Крыша наверху (материал или параметры). */
  roof?: Material | Omit<RoofOpts, 'x' | 'y'>;
  exact?: boolean;
}

/**
 * Башня из floors П-рам (06 §3; 7 этажей = 17.5 м — предел). spots: внутри каждого этажа снизу вверх, затем верх
 * (верх последней балки; если есть крыша — над крышей места нет, последний spot — балка под крышей не доступна).
 */
export function tower({ x, y = 0, floors = 3, span = 4, h = 2, colW = 0.5, mats = 'wood', roof: roofOpt, exact }: TowerOpts): Part {
  const parts: Part[] = [];
  let yy = y;
  for (let i = 0; i < floors; i++) {
    const m = floorMats(Array.isArray(mats) ? mats[i % mats.length] : mats);
    const f = frame({ x, y: yy, span, h, colW, col: m.col, beam: m.beam, exact });
    parts.push({ ...f, spots: [f.spots[0]] });
    yy = f.top;
  }
  const spots = parts.map((p) => p.spots[0]);
  const lastBlocks = parts.length ? parts[parts.length - 1].blocks : [];
  const beamW = lastBlocks.length ? lastBlocks[lastBlocks.length - 1].w : span;
  if (roofOpt !== undefined) {
    const ro = typeof roofOpt === 'string' ? { mat: roofOpt } : roofOpt;
    const r = roof({ x, y: yy, w: beamW, ...ro });
    parts.push(r);
    return { ...merge(...parts), spots, top: r.top };
  }
  spots.push({ x, y: yy, w: beamW, h: Infinity, kind: 'top' });
  return { ...merge(...parts), spots, top: yy };
}

export interface HutOpts extends Omit<FrameOpts, 'beam'> {
  beam?: Material;
  roofMat?: Material;
  roofH?: number;
  roofKind?: 'iso' | 'tris';
}

/** Домик: П-рама + крыша (iso 4×1.5 на всю ширину балки). spots: [0] — внутри. */
export function hut(o: HutOpts): Part {
  const f = frame(o);
  const beamW = f.blocks[f.blocks.length - 1].w;
  const r = roof({ x: o.x, y: f.top, w: beamW, h: o.roofH, mat: o.roofMat ?? o.beam ?? 'wood', kind: o.roofKind });
  return { ...merge(f, r), spots: [f.spots[0]], top: r.top };
}

export interface PyramidOpts {
  x: number;
  y?: number;
  rows?: number;
  /** Сторона квадрата: 1 (square) или 0.5 (cube) или 2 (big). */
  size?: 0.5 | 1 | 2;
  mat?: Material;
  /** Материал по рядам снизу вверх (перекрывает mat). */
  rowMats?: Material[];
  gap?: number;
  /**
   * Ниши: [ряд снизу 0.., номер слева 0..] — квадрат убирается, остаётся место для свиньи.
   * Если ниша не на краю ряда и над ней есть ряд, два квадрата над нишей заменяются перемычкой 2·size × size
   * (slab 2×1 при size 1): иначе они висят половиной на пустоте и падают (lint: com-outside).
   */
  niches?: Array<[number, number]>;
}

/** Пирамида из квадратов: ряды n…1 (06 §3), gap = 0. spots: [0] — верх, далее ниши. */
export function pyramid({ x, y = 0, rows = 4, size = 1, mat = 'wood', rowMats, gap = 0, niches = [] }: PyramidOpts): Part {
  const kind: BlockKind = size === 0.5 ? 'cube' : size === 2 ? 'big' : 'square';
  const blocks: BlockDef[] = [];
  const spots: Spot[] = [];
  const isNiche = (i: number, j: number): boolean => niches.some(([r, c]) => r === i && c === j);
  // квадраты, замещённые перемычкой: ряд i + 1, номера j − 1 и j над нишей (i, j)
  const bridged = new Set<string>();
  const lintels = new Map<number, number[]>();
  for (const [i, j] of niches) {
    const n = rows - i;
    if (gap === 0 && i + 1 < rows && j >= 1 && j <= n - 2) {
      bridged.add(`${i + 1}:${j - 1}`);
      bridged.add(`${i + 1}:${j}`);
      lintels.set(i + 1, [...(lintels.get(i + 1) ?? []), j]);
    }
  }
  for (let i = 0; i < rows; i++) {
    const n = rows - i;
    const w = n * size + (n - 1) * gap;
    const x0 = x - w / 2 + size / 2;
    const m = rowMats?.[i] ?? mat;
    for (let j = 0; j < n; j++) {
      const cx = x0 + j * (size + gap);
      if (isNiche(i, j)) {
        spots.push({ x: r4(cx), y: r4(y + i * size), w: size, h: size, kind: 'niche' });
        continue;
      }
      if (bridged.has(`${i}:${j}`)) continue;
      blocks.push(blockOn(m, kind, cx, y + i * size));
    }
    // перемычки над нишами ряда i − 1: центр — над убранным квадратом
    for (const jn of lintels.get(i) ?? []) {
      const nb = rows - (i - 1);
      const cx = x - (nb * size) / 2 + size / 2 + jn * size;
      blocks.push(B(m, 'rect', cx, y + i * size + size / 2, 2 * size, size));
    }
  }
  const top = y + rows * size;
  spots.unshift({ x, y: top, w: size, h: Infinity, kind: 'top' });
  return part({ blocks, top, spots });
}

export interface PierOpts {
  /** Левый край настила. */
  x0: number;
  y?: number;
  /** Число пролётов (свай n + 1). */
  n?: number;
  /** Длина пролёта = длина балки настила. */
  L?: number;
  /** Высота сваи (набирается деталями каталога: 2 — колонна, 4 — две колонны…). */
  pileH?: number;
  colW?: number;
  pile?: Material;
  deck?: Material;
  deckT?: number;
}

/**
 * Пирс / помост на сваях (06 §3): n балок встык, стыки над сваями (каждый торец опирается на colW/2 = 0.25 м),
 * крайние сваи заподлицо с торцами настила. spots: на настиле над каждым пролётом, под настилом между сваями.
 */
export function pier({ x0, y = 0, n = 2, L = 4, pileH = 2, colW = 0.5, pile = 'wood', deck = 'wood', deckT = 0.5 }: PierOpts): Part {
  const blocks: BlockDef[] = [];
  const spots: Spot[] = [];
  const piles: number[] = [];
  for (let i = 0; i <= n; i++) {
    let px = x0 + i * L;
    if (i === 0) px += colW / 2;
    else if (i === n) px -= colW / 2;
    piles.push(px);
    blocks.push(...pillar(px, y, pileH, pile, colW));
  }
  const yDeck = y + pileH;
  for (let i = 0; i < n; i++) {
    blocks.push(B(deck, 'rect', x0 + i * L + L / 2, yDeck + deckT / 2, L, deckT));
    spots.push({ x: r4(x0 + i * L + L / 2), y: yDeck + deckT, w: L, h: Infinity, kind: 'deck' });
    spots.push({ x: r4((piles[i] + piles[i + 1]) / 2), y, w: r4(piles[i + 1] - piles[i] - colW), h: pileH, kind: 'under' });
  }
  return part({ blocks, top: yDeck + deckT, spots });
}

export interface BunkerOpts {
  x: number;
  y?: number;
  /** Ширина проёма (между стенами). */
  inner?: number;
  /** Высота стен. */
  h?: number;
  wallW?: number;
  mat?: Material;
  roofMat?: Material;
  roofT?: number;
  exact?: boolean;
}

/** Бункер: толстые стены + плита-крыша (06 §3); свинья внутри. spots: [0] — внутри, [1] — на крыше. */
export function bunker({ x, y = 0, inner = 2, h = 1.5, wallW = 0.5, mat = 'stone', roofMat, roofT = 0.5, exact }: BunkerOpts): Part {
  return frame({ x, y, span: inner + 2 * wallW, h, colW: wallW, col: mat, beam: roofMat ?? mat, beamT: roofT, exact });
}

export interface CradleOpts {
  x: number;
  y: number;
  /** Диаметр шара: 1 или 2. */
  d?: 1 | 2;
  mat?: Material;
  stopMat?: Material;
  /** Зазор между шаром и стопором, м (06 S8: 0.05). */
  c?: number;
}

/** Шар в «колыбели» из двух стопоров-кубиков 0.5 (06 S8): единственный разрешённый способ поставить шар. */
export function cradle({ x, y, d = 1, mat = 'stone', stopMat = 'wood', c = 0.05 }: CradleOpts): Part {
  const s = d / 2 + c + 0.25;
  return part({
    blocks: [
      blockOn(mat, d === 2 ? 'ball2' : 'ball1', x, y),
      blockOn(stopMat, 'cube', x - s, y),
      blockOn(stopMat, 'cube', x + s, y),
    ],
    top: y + d,
  });
}
/** Алиас из лаборатории. */
export const cradledBall = cradle;

/** Клетка 2×2 из 4 деталей (frameBox v1, 06 §1.2): доски 2×0.5 снизу и сверху, стенки 0.5×1. Внутри 1×1 — для small. */
export function cage({ x, y = 0, mat = 'wood' }: { x: number; y?: number; mat?: Material }): Part {
  const bottom = blockOn(mat, 'plank', x, y);
  const l = blockOn(mat, 'brick', x - 0.75, y + 0.5, { vertical: true });
  const r = blockOn(mat, 'brick', x + 0.75, y + 0.5, { vertical: true });
  const top = blockOn(mat, 'plank', x, y + 1.5);
  return part({
    blocks: [bottom, l, r, top],
    top: y + 2,
    spots: [
      { x, y: y + 0.5, w: 1, h: 1, kind: 'inside' },
      { x, y: y + 2, w: 2, h: Infinity, kind: 'top' },
    ],
  });
}

export interface HallOpts {
  x: number;
  y?: number;
  /** Ширина проёма (3 м — под короля ⌀2.34, 06 §2.1). */
  inner?: number;
  /** Нижняя часть опор (квадраты 1×1). */
  baseMat?: Material;
  /** Верхняя часть опор (колонны 0.5×2). */
  colMat?: Material;
  roofMat?: Material;
}

/**
 * Зала короля (06 §10, 2-10 / 3-10): опоры по 3 м — квадрат 1×1 + колонна 0.5×2 (внутренние грани заподлицо),
 * проём inner × 3, перекрытие — балка каталога над пролётом inner + 1. spots: [0] — внутри, [1] — на перекрытии.
 */
export function hall({ x, y = 0, inner = 3, baseMat = 'stone', colMat = 'wood', roofMat = 'stone' }: HallOpts): Part {
  const half = inner / 2;
  const blocks = [
    blockOn(baseMat, 'square', x - half - 0.5, y),
    blockOn(baseMat, 'square', x + half + 0.5, y),
    blockOn(colMat, 'column', x - half - 0.25, y + 1),
    blockOn(colMat, 'column', x + half + 0.25, y + 1),
  ];
  const top = lintel(x, y + 3, inner + 1, roofMat);
  blocks.push(top);
  return part({
    blocks,
    top: y + 3.5,
    spots: [
      { x, y, w: inner, h: 3, kind: 'inside' },
      { x, y: y + 3.5, w: top.w, h: Infinity, kind: 'top' },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Рельеф (статические полигоны)
// ─────────────────────────────────────────────────────────────────────────────

type TerrainKind = TerrainDef['kind'];
const pt = (x: number, y: number): [number, number] => [r4(x), r4(y)];

/** Ровная земля от minX до maxX, верх на y (по умолчанию 0). */
export function flatGround(minX = -40, maxX = 140, depth = 10, y = 0): TerrainDef {
  return { kind: 'ground', points: [pt(minX, y - depth), pt(maxX, y - depth), pt(maxX, y), pt(minX, y)] };
}

/**
 * Плато / утёс: ровный верх [x0, x1] на высоте top. slope — горизонтальная длина откосов (число или [слева, справа]),
 * 0 — отвесные стены. bottom — низ (по умолчанию 0: стоит на земле).
 */
export function plateau(x0: number, x1: number, top: number, opts: { slope?: number | [number, number]; bottom?: number; kind?: TerrainKind } = {}): TerrainDef {
  const [sl, sr] = Array.isArray(opts.slope) ? opts.slope : [opts.slope ?? 0, opts.slope ?? 0];
  const bottom = opts.bottom ?? 0;
  const points: Array<[number, number]> = [pt(x0 - sl, bottom), pt(x1 + sr, bottom), pt(x1, top), pt(x0, top)];
  return { kind: opts.kind ?? 'rock', points };
}

/** Холм-трапеция (как в лаборатории): ровный верх [x1, x2] на высоте h, откосы к [x0, x3] на y = 0. */
export function hill(x0: number, x1: number, x2: number, x3: number, h: number, kind: TerrainKind = 'ground'): TerrainDef {
  return { kind, points: [pt(x0, 0), pt(x3, 0), pt(x2, h), pt(x1, h)] };
}

/**
 * Утёс до края уровня: кромка в xEdge, верх top, масса уходит в сторону side ('left' — влево до xEdge − far).
 * slope — горизонтальная длина откоса от кромки вниз (0 — отвесно).
 */
export function cliff(xEdge: number, top: number, side: 'left' | 'right', opts: { far?: number; slope?: number; bottom?: number; kind?: TerrainKind } = {}): TerrainDef {
  const far = opts.far ?? 80;
  const slope = opts.slope ?? 0;
  const bottom = opts.bottom ?? 0;
  const kind = opts.kind ?? 'rock';
  if (side === 'left') {
    return { kind, points: [pt(xEdge - far, bottom), pt(xEdge + slope, bottom), pt(xEdge, top), pt(xEdge - far, top)] };
  }
  return { kind, points: [pt(xEdge - slope, bottom), pt(xEdge + far, bottom), pt(xEdge + far, top), pt(xEdge, top)] };
}

/**
 * Холм под рогаткой (06 §2.3, 3-7): площадка от x0 до x1 на высоте h, откос длиной slope вниз до земли.
 * Не забудьте slingshot = slingshotOn(0, h).
 */
export function slingHill(h: number, opts: { x0?: number; x1?: number; slope?: number; kind?: TerrainKind } = {}): TerrainDef {
  const x0 = opts.x0 ?? -40;
  const x1 = opts.x1 ?? 1.5;
  const slope = opts.slope ?? h / Math.tan((30 * Math.PI) / 180);
  return { kind: opts.kind ?? 'ground', points: [pt(x0, 0), pt(x1 + slope, 0), pt(x1, h), pt(x0, h)] };
}

/** Неразрушимый помост (kind 'platform'): прямоугольник [x0, x1] × [yTop − t, yTop]. Опора ему не нужна. */
export function platform(x0: number, x1: number, yTop: number, t = 0.5): TerrainDef {
  return { kind: 'platform', points: [pt(x0, yTop - t), pt(x1, yTop - t), pt(x1, yTop), pt(x0, yTop)] };
}

/**
 * Рельеф по профилю верхней кромки (точки слева направо), замкнутый снизу на y = bottom.
 * Может быть невыпуклым — ядро разбивает сам. Ровные площадки делайте строго горизонтальными.
 */
export function profile(points: Array<[number, number]>, opts: { bottom?: number; kind?: TerrainKind } = {}): TerrainDef {
  if (points.length < 2) throw new Error('profile: нужно ≥ 2 точек');
  const bottom = opts.bottom ?? -10;
  const first = points[0];
  const last = points[points.length - 1];
  return { kind: opts.kind ?? 'ground', points: [pt(first[0], bottom), pt(last[0], bottom), ...[...points].reverse().map(([x, y]) => pt(x, y))] };
}

/** Земля с ямой [x0, x1] глубиной depth (верх земли — y = 0, дно ямы — y = −depth). Невыпуклый полигон. */
export function pit(x0: number, x1: number, depth: number, opts: { minX?: number; maxX?: number; bottom?: number } = {}): TerrainDef {
  const minX = opts.minX ?? -40;
  const maxX = opts.maxX ?? 140;
  const bottom = Math.min(opts.bottom ?? -10, -depth - 2);
  return profile([[minX, 0], [x0, 0], [x0, -depth], [x1, -depth], [x1, 0], [maxX, 0]], { bottom });
}

/** ANCHOR рогатки для основания (baseX, baseY): основание + SLINGSHOT.ANCHOR. */
export function slingshotOn(baseX = 0, baseY = 0): Vec {
  return { x: r4(baseX + SLINGSHOT.ANCHOR.x), y: r4(baseY + SLINGSHOT.ANCHOR.y) };
}

/** Основание рогатки по LevelDef.slingshot. */
export function slingBase(slingshot: Vec): Vec {
  return { x: slingshot.x - SLINGSHOT.ANCHOR.x, y: slingshot.y - SLINGSHOT.ANCHOR.y };
}

// ─────────────────────────────────────────────────────────────────────────────
// Очки и черновые звёзды (06 §8.2 с очками урона 00 §1.6)
// ─────────────────────────────────────────────────────────────────────────────

/** «Очки max» блока: 500 за разрушение + полный урон (100/200/300 за м²). */
export function blockMaxPoints(b: BlockDef): number {
  return SCORE.BLOCK + MATERIALS[b.material].damagePointsPerM2 * blockArea(b);
}

/** Очки всех свиней с полным уроном: 5000 + damagePoints. */
export function pigsMaxPoints(pigs: readonly PigDef[]): number {
  return pigs.reduce((s, p) => s + SCORE.PIG + PIGS[p.type].damagePoints, 0);
}

const r1k = (x: number): number => Math.round(x / 1000) * 1000;

/** Черновые пороги звёзд до калибровки ботом (06 §8.2, 00 §1.11). */
export function draftStars(lv: Pick<LevelDef, 'birds' | 'pigs' | 'blocks' | 'tnt' | 'meta'>): StarThresholds {
  const N = lv.birds.length;
  const nMin = lv.meta?.nMin ?? Math.max(1, N - 1);
  const P = pigsMaxPoints(lv.pigs);
  const Bp = lv.blocks.reduce((s, b) => s + blockMaxPoints(b), 0) + (lv.tnt?.length ?? 0) * SCORE.TNT;
  const three = r1k(P + 0.45 * Bp + SCORE.UNUSED_BIRD * (N - nMin));
  const two = Math.max(Math.min(r1k(P + 0.3 * Bp + SCORE.UNUSED_BIRD * Math.max(0, N - nMin - 1)), three - 5000), r1k(P + 2000));
  // как в калибровке 00 §1.11: 3★ не ниже 2★ + 5000 (иначе у маленьких уровней two > three)
  return { one: 0, two, three: Math.max(three, two + 5000) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Построитель уровня
// ─────────────────────────────────────────────────────────────────────────────

/** Идентификатор «эпизод-номер». */
export type LevelId = `${number}-${number}`;

const THEME_BY_EPISODE: Record<string, ThemeId> = { '1': 'meadow', '2': 'beach', '3': 'snow' };

export interface LevelInput {
  id: LevelId;
  name: string;
  /** По умолчанию — по номеру эпизода: 1 meadow, 2 beach, 3 snow. */
  theme?: ThemeId;
  /** Птицы в порядке запуска (хотя бы одна). */
  birds: [BirdType, ...BirdType[]];
  /** ANCHOR рогатки; по умолчанию slingshotOn(0, 0) = (0, 2.7). */
  slingshot?: Vec;
  /** Границы: по умолчанию minX = основание − 12, maxX = max(46, правый край контента + 12), maxY = 25 + высота основания. */
  bounds?: Partial<LevelDef['bounds']>;
  /** По умолчанию [flatGround()]. */
  terrain?: TerrainDef[];
  /** Конструкции (результаты макросов) — их блоки/свиньи/TNT добавляются по порядку. */
  parts?: Part[];
  blocks?: BlockDef[];
  pigs?: PigDef[];
  tnt?: TntDef[];
  /** Пороги звёзд; по умолчанию — черновая формула draftStars (06 §8.2). */
  stars?: StarThresholds;
  hint?: string;
  camera?: LevelDef['camera'];
  meta?: LevelMeta;
  decor?: DecorDef[];
}

/** Собрать LevelDef из частей с умолчаниями (06 §2.3, §6). Порядок тел: parts по порядку, затем blocks/pigs/tnt. */
export function level(input: LevelInput): LevelDef {
  if (!/^\d+-\d+$/.test(input.id)) throw new Error(`level: id «${input.id}» — нужен вид «эпизод-номер»`);
  if (!input.birds.length) throw new Error(`level ${input.id}: нужна хотя бы одна птица`);
  const parts = input.parts ?? [];
  const blocks = [...parts.flatMap((p) => p.blocks), ...(input.blocks ?? [])];
  const pigs = [...parts.flatMap((p) => p.pigs), ...(input.pigs ?? [])];
  const tnt = [...parts.flatMap((p) => p.tnt), ...(input.tnt ?? [])];
  for (const v of [...blocks.flatMap((b) => [b.x, b.y, b.w, b.h]), ...pigs.flatMap((p) => [p.x, p.y]), ...tnt.flatMap((t) => [t.x, t.y])]) {
    if (!Number.isFinite(v)) throw new Error(`level ${input.id}: нечисловая координата`);
  }
  const slingshot = input.slingshot ?? slingshotOn(0, 0);
  const base = slingBase(slingshot);
  let right = base.x + 34;
  for (const b of blocks) right = Math.max(right, blockAabb(b).maxX);
  for (const p of pigs) right = Math.max(right, p.x + PIG_R[p.type]);
  for (const t of tnt) right = Math.max(right, t.x + (t.size ?? TNT.SIZE) / 2);
  const bounds = {
    minX: input.bounds?.minX ?? base.x - 12,
    maxX: input.bounds?.maxX ?? Math.max(46, Math.ceil(right + 12)),
    maxY: input.bounds?.maxY ?? 25 + Math.max(0, base.y),
  };
  const episode = input.id.split('-')[0];
  const lv: LevelDef = {
    id: input.id,
    name: input.name,
    theme: input.theme ?? THEME_BY_EPISODE[episode] ?? 'meadow',
    birds: [...input.birds],
    slingshot: { x: slingshot.x, y: slingshot.y },
    bounds,
    terrain: input.terrain ?? [flatGround()],
    blocks,
    pigs,
    tnt,
    stars: { one: 0, two: 0, three: 0 },
    version: 1,
  };
  lv.stars = input.stars ? { ...input.stars } : draftStars({ ...lv, meta: input.meta });
  if (input.hint !== undefined) lv.hint = input.hint;
  if (input.camera !== undefined) lv.camera = input.camera;
  if (input.meta !== undefined) lv.meta = input.meta;
  else if (!input.stars) lv.meta = { starsSource: 'manual' };
  if (input.decor !== undefined) lv.decor = input.decor;
  return lv;
}
