// Статическая проверка уровней без физики (стадия L конвейера 06 §7.1; правила 06 §4.2, §4.5, 00-summary §4).
//
// Что проверяется (коды проблем — в поле code):
// - данные: id, название, тема, птицы, звёзды, meta (id, name, theme, birds, stars, meta);
// - геометрия блоков: размеры, толщина ≥ 0.25 (≥ 0.5 по каталогу), сетка U, каталог 00 §1.6 (bad-geom, thin, grid, catalog, angle);
// - перекрытия тел и тел с рельефом > 0.02 м — касание встык допускается (overlap);
// - опора: каждое динамическое тело опирается на рельеф или тело под ним (no-support, pig-floating), опирание ≥ 0.25 м
//   (bearing), центр масс подсистемы «тело + всё, что на нём» над опорой с запасом ≥ 0.10 м (com-outside, com-margin,
//   point-support; com-leaning — предупреждение, если тело держится упором в соседа; support-cycle), скольжение (slide, ice-slope);
// - свиньи: на горизонтали (pig-slope, pig-apex, pig-on-round), свободно ≥ 0.7 м с каждой стороны или стенка ≤ 0.3 м,
//   иначе нужен fragile (pig-free-space), расстояние между свиньями (pig-close);
// - шары: только со стопорами ≤ 0.1 м или в «лунке» (ball-no-stoppers, ball-slope);
// - стройность столбов ≤ 8, высота ≤ 17.5 м, отношение масс ≤ 10 (slender, too-tall, mass-ratio);
// - досягаемость: каждая свинья внутри огибающей хотя бы одной птицы уровня (g, V_MAX, R_MAX — из constants, старт из
//   оттянутого кармашка), зона целей 16…34 м при V 24 / g 15, масштаб (V/24)² — при V 21 это 12.25…26.0 м
//   (unreachable, reach-graze, zone);
// - рогатка: основание = slingshot − (0, 2.7) лежит на поверхности рельефа ±0.05 м, ровная площадка очереди птиц
//   (slingshot-terrain, queue-not-flat, queue-bounds);
// - границы и рельеф (out-of-bounds, bounds-right, bounds-top, terrain-invalid, terrain-gap, terrain-slope, terrain-almost-flat);
// - лимит динамических тел ≤ 120, ориентиры числа блоков по эпизодам, хотя бы одна свинья (body-limit, blocks-count, no-pigs);
// - TNT: зазор между ящиками 2.0–2.5 м — «неопределённая» цепочка (tnt-gap).
//
// Модель опоры упрощённая (как 06 §4.2): учитываются только контакты с нормалью «снизу вверх» (до 60° от вертикали),
// вес передаётся опорам по правилу рычага в центрах пятен контакта, боковые контакты и трение не держат вес.
// Окончательный ответ даёт физика (T0–T2), lint ловит ошибки авторинга за миллисекунды.

import type { BirdType, BlockDef, LevelDef, PigDef, PigType, TerrainDef, ThemeId, TntDef, Vec } from '../core/types';
import { BIRDS, LAUNCH, MATERIALS, PIGS, SLINGSHOT, TNT, WORLD } from '../config/constants';
import { BIRD_R, PIG_R, U, blockArea, blockMaxPoints, blockPolygon, catalogKind, pigsMaxPoints, slingBase, tntAsBlock } from './prefabs';

// ─────────────────────────────────────────────────────────────────────────────
// Пороги (06 §4, 00 §1, §4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Масштаб дальности V_MAX²/|g| относительно V 24 / g 15, под который 06 §2.3 разметил зону целей 16…34 м:
 * при другой V_MAX все x масштабируются на (V/24)² (06 §2, «Если поднимут V_MAX»). При V 21 — 0.766.
 */
export const RANGE_K = (LAUNCH.V_MAX * LAUNCH.V_MAX) / Math.abs(WORLD.GRAVITY) / ((24 * 24) / 15);

export const LINT = {
  /** Допуск касания встык: зазор/перекрытие ≤ 0.02 м (06 S1–S2). */
  TOL: 0.02,
  /** Минимальное перекрытие граней, чтобы считать их контактом (06 §4.2). */
  MIN_PATCH: 0.05,
  /** Минимальное опирание (06 S5). */
  MIN_BEARING: 0.25,
  /** Запас центра масс над опорой (06 S3). */
  COM_MARGIN: 0.1,
  /** Горизонталь для свиней и шаров, градусы (06 §4.2). */
  HORIZ_DEG: 0.2,
  /** Свободно с каждой стороны свиньи / или стенка ближе (06 S7). */
  PIG_FREE: 0.7,
  PIG_WALL: 0.3,
  /** Стопоры шара (06 S8). */
  BALL_STOP: 0.1,
  /** Рогатка на рельефе ±. */
  SLING_TOL: 0.05,
  /** Лимит динамических тел, включая птиц (00 §1.1). */
  MAX_BODIES: 120,
  /** Стройность h_цм / (b/2) (06 S9), высота (06 S10), отношение масс (06 S11). */
  MAX_SLENDER: 8,
  MAX_HEIGHT: 17.5,
  MAX_MASS_RATIO: 10,
  /** Зона целей по x от основания рогатки (00 §4: 16…34 при V 24, ×RANGE_K) и прибавка с холма на 1 м высоты (00 §1.2). */
  ZONE_MIN: 16 * RANGE_K,
  ZONE_MAX: 34 * RANGE_K,
  ZONE_HILL_K: 0.9,
  /** Ориентиры числа блоков (верхняя граница) по эпизодам и для боссов (00 §4). */
  BLOCKS_MAX: { '1': 30, '2': 45, '3': 60, boss: 80 } as Record<string, number>,
  /** Диапазоны порога 3★ по эпизодам (00 §1.11). */
  THREE_RANGE: { '1': [25_000, 60_000], '2': [35_000, 80_000], '3': [45_000, 110_000] } as Record<string, [number, number]>,
} as const;

const THEMES: readonly ThemeId[] = ['meadow', 'beach', 'snow'];
const EP_THEME: Record<string, ThemeId> = { '1': 'meadow', '2': 'beach', '3': 'snow' };
const BIRD_TYPES = Object.keys(BIRDS) as BirdType[];
const PIG_TYPES = Object.keys(PIGS) as PigType[];
const MAT_RU: Record<string, string> = { wood: 'дерево', ice: 'лёд', stone: 'камень' };
const SHAPE_RU: Record<string, string> = { rect: 'прям.', circle: 'круг', triangle: 'треуг.', isoTriangle: 'крыша' };

// ─────────────────────────────────────────────────────────────────────────────
// Результат
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = 'error' | 'warning';
export type TargetKind = 'level' | 'block' | 'pig' | 'tnt' | 'terrain' | 'slingshot';

export interface LintTarget {
  kind: TargetKind;
  /** Индекс в массиве уровня (blocks / pigs / tnt / terrain). */
  index?: number;
  id?: string;
}

export interface LintIssue {
  severity: Severity;
  code: string;
  /** Текст по-русски, с указанием элемента. */
  message: string;
  target?: LintTarget;
  /** Точка на уровне, к которой относится проблема (для предпросмотра). */
  at?: Vec;
}

export interface PigReach {
  /** Индекс свиньи. */
  index: number;
  /** Птицы, чья огибающая проходит через центр свиньи. */
  center: BirdType[];
  /** Птицы, которые могут хотя бы задеть свинью. */
  touch: BirdType[];
}

export interface LintStats {
  blocks: number;
  pigs: number;
  tnt: number;
  /** Динамических тел с учётом птиц в полёте (Blues — 3, Matilda — 2 с яйцом). */
  dynamicBodies: number;
  /** Σ «очков max» блоков и TNT (06 §8.2, 00 §1.6). */
  blockPoints: number;
  /** Очки всех свиней с полным уроном. */
  pigPoints: number;
  reach: PigReach[];
}

export interface LintResult {
  levelId: string;
  ok: boolean;
  errors: LintIssue[];
  warnings: LintIssue[];
  /** Все проблемы в порядке обнаружения. */
  issues: LintIssue[];
  stats: LintStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Векторная геометрия
// ─────────────────────────────────────────────────────────────────────────────

const v = (x: number, y: number): Vec => ({ x, y });
const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y);
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
const crs = (o: Vec, a: Vec, b: Vec): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const len = (a: Vec): number => Math.hypot(a.x, a.y);
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const DEG = 180 / Math.PI;
const f2 = (x: number): string => String(Math.round(x * 100) / 100);

export function polygonArea(pts: readonly Vec[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function polygonCentroid(pts: readonly Vec[]): Vec {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-12) return v(pts.reduce((s, p) => s + p.x, 0) / pts.length, pts.reduce((s, p) => s + p.y, 0) / pts.length);
  return v(cx / (3 * a), cy / (3 * a));
}

/** Убрать совпадающие и коллинеарные вершины, привести к обходу против часовой. */
export function normalizePolygon(input: readonly Vec[]): Vec[] {
  let pts = input.filter((p, i) => len(sub(p, input[(i + 1) % input.length])) > 1e-6);
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.abs(crs(a, b, c)) <= 1e-7 * Math.max(1, len(sub(b, a)) * len(sub(c, b)))) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return polygonArea(pts) < 0 ? pts.reverse() : pts;
}

function segmentsCross(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = crs(c, d, a);
  const d2 = crs(c, d, b);
  const d3 = crs(a, b, c);
  const d4 = crs(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

/** Простой многоугольник (без самопересечений). */
export function isSimplePolygon(pts: readonly Vec[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Точка внутри многоугольника (любого, чётность пересечений). */
export function pointInPolygon(p: Vec, pts: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function closestOnSegment(p: Vec, a: Vec, b: Vec): { q: Vec; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-18 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
  return { q: v(a.x + ab.x * t, a.y + ab.y * t), t };
}

/** Внешняя нормаль ребра a→b многоугольника против часовой. */
function outward(a: Vec, b: Vec): Vec {
  const d = sub(b, a);
  const l = len(d) || 1;
  return v(d.y / l, -d.x / l);
}

function convex(pts: readonly Vec[]): boolean {
  for (let i = 0, n = pts.length; i < n; i++) if (crs(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]) < -1e-9) return false;
  return true;
}

/** Разбиение простого CCW-многоугольника на выпуклые части ≤ maxVerts (уши + жадная склейка, как ядро). */
export function convexPieces(pts: readonly Vec[], maxVerts = 12): Vec[][] {
  if (convex(pts) && pts.length <= maxVerts) return [pts.slice()];
  const ring = pts.slice();
  const tris: Vec[][] = [];
  const inTri = (q: Vec, a: Vec, b: Vec, c: Vec): boolean => crs(a, b, q) >= -1e-9 && crs(b, c, q) >= -1e-9 && crs(c, a, q) >= -1e-9;
  while (ring.length > 3) {
    const n = ring.length;
    let ear = -1;
    for (let i = 0; i < n && ear < 0; i++) {
      const a = ring[(i + n - 1) % n];
      const b = ring[i];
      const c = ring[(i + 1) % n];
      if (crs(a, b, c) <= 1e-9) continue;
      if (!ring.some((q) => q !== a && q !== b && q !== c && inTri(q, a, b, c))) ear = i;
    }
    if (ear < 0) throw new Error('многоугольник самопересекается');
    tris.push([ring[(ear + n - 1) % n], ring[ear], ring[(ear + 1) % n]]);
    ring.splice(ear, 1);
  }
  tris.push(ring);
  const pieces = tris.filter((t) => polygonArea(t) > 1e-7);
  const mergeEdge = (a: Vec[], b: Vec[]): Vec[] | null => {
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      const q = a[(i + 1) % a.length];
      const j = b.indexOf(q);
      if (j < 0 || b[(j + 1) % b.length] !== p) continue;
      const out: Vec[] = [];
      for (let k = 0; k < a.length; k++) out.push(a[(i + 1 + k) % a.length]);
      for (let k = 2; k < b.length; k++) out.push(b[(j + k) % b.length]);
      return out;
    }
    return null;
  };
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < pieces.length && !merged; i++) {
      for (let j = i + 1; j < pieces.length && !merged; j++) {
        const m = mergeEdge(pieces[i], pieces[j]);
        if (m && m.length <= maxVerts && convex(m)) {
          pieces[i] = m;
          pieces.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return pieces;
}

/** Глубина взаимного проникновения выпуклых многоугольников (SAT): > 0 — перекрытие, < 0 — зазор. */
export function satDepth(A: readonly Vec[], B: readonly Vec[]): number {
  let depth = Infinity;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const n = outward(P[i], P[(i + 1) % P.length]);
      let a0 = Infinity;
      let a1 = -Infinity;
      let b0 = Infinity;
      let b1 = -Infinity;
      for (const p of A) {
        const d = dot(p, n);
        a0 = Math.min(a0, d);
        a1 = Math.max(a1, d);
      }
      for (const p of B) {
        const d = dot(p, n);
        b0 = Math.min(b0, d);
        b1 = Math.max(b1, d);
      }
      depth = Math.min(depth, Math.min(a1, b1) - Math.max(a0, b0));
    }
  }
  return depth;
}

/** Расстояние от точки до границы многоугольника. */
function distToBoundary(p: Vec, pts: readonly Vec[]): { d: number; q: Vec; edge: number; t: number } {
  let best = { d: Infinity, q: p, edge: -1, t: 0 };
  for (let i = 0; i < pts.length; i++) {
    const { q, t } = closestOnSegment(p, pts[i], pts[(i + 1) % pts.length]);
    const d = len(sub(p, q));
    if (d < best.d) best = { d, q, edge: i, t };
  }
  return best;
}

/** Глубина проникновения круга в выпуклый многоугольник (> 0 — перекрытие). */
function circlePolyDepth(c: Vec, r: number, pts: readonly Vec[]): number {
  const { d } = distToBoundary(c, pts);
  return pointInPolygon(c, pts) ? r + d : r - d;
}

/** x-диапазон многоугольника внутри горизонтальной полосы [y0, y1] (null — не пересекает). */
function xRangeInBand(pts: readonly Vec[], y0: number, y1: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (a.y >= y0 && a.y <= y1) {
      lo = Math.min(lo, a.x);
      hi = Math.max(hi, a.x);
    }
    for (const yy of [y0, y1]) {
      if ((a.y - yy) * (b.y - yy) < 0) {
        const x = a.x + ((b.x - a.x) * (yy - a.y)) / (b.y - a.y);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Огибающая досягаемости (00 §1.2, 06 §2.2): старт из оттянутого кармашка, дискретный интегратор planck
// ─────────────────────────────────────────────────────────────────────────────

const ENV_STEP = 0.1;
const ENV_MAX_X = 90;
const envCache = new Map<number, Float64Array>();

/** Таблица огибающей: индекс i — x = i·0.1 м правее ANCHOR, значение — максимальная высота центра птицы над ANCHOR. */
export function envelopeTable(launchScale: number): Float64Array {
  const hit = envCache.get(launchScale);
  if (hit) return hit;
  const n = Math.round(ENV_MAX_X / ENV_STEP) + 1;
  const tab = new Float64Array(n).fill(-Infinity);
  const g = WORLD.GRAVITY;
  const dt = WORLD.DT;
  for (let a = 0; a <= 85 + 1e-9; a += 0.25) {
    const th = (a * Math.PI) / 180;
    const dx = Math.cos(th);
    const dy = Math.sin(th);
    let x = -dx * LAUNCH.R_MAX;
    let y = -dy * LAUNCH.R_MAX;
    const vx = dx * LAUNCH.V_MAX * launchScale;
    let vy = dy * LAUNCH.V_MAX * launchScale;
    for (let k = 0; k < 2000 && y > -40 && x < ENV_MAX_X; k++) {
      vy += g * dt;
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      const i0 = Math.max(0, Math.ceil(x / ENV_STEP));
      const i1 = Math.min(n - 1, Math.floor(nx / ENV_STEP));
      for (let i = i0; i <= i1; i++) {
        const X = i * ENV_STEP;
        const yy = y + ((ny - y) * (X - x)) / (nx - x);
        if (yy > tab[i]) tab[i] = yy;
      }
      x = nx;
      y = ny;
    }
  }
  envCache.set(launchScale, tab);
  return tab;
}

/** Максимальная высота центра птицы над точкой x мира (−Infinity — недосягаемо). */
export function reachHeight(bird: BirdType, anchor: Vec, x: number): number {
  const tab = envelopeTable(BIRDS[bird].launchScale);
  const fx = (x - anchor.x) / ENV_STEP;
  if (fx < 0 || fx > tab.length - 1) return -Infinity;
  const i = Math.floor(fx);
  const u = fx - i;
  const a = tab[i];
  const b = tab[Math.min(i + 1, tab.length - 1)];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return anchor.y + (u < 0.5 ? a : b);
  return anchor.y + a + (b - a) * u;
}

/** Высшая точка огибающей птицы над миром (апекс навесного выстрела на полной силе): 19.6 м при V 24, 15.1 м при V 21. */
export function envelopeApex(bird: BirdType, anchor: Vec): number {
  let top = -Infinity;
  for (const h of envelopeTable(BIRDS[bird].launchScale)) top = Math.max(top, h);
  return anchor.y + top;
}

/** Ломаная огибающей для отрисовки. */
export function reachCurve(bird: BirdType, anchor: Vec, x0: number, x1: number, step = 0.25): Vec[] {
  const out: Vec[] = [];
  for (let x = Math.max(x0, anchor.x); x <= x1 + 1e-9; x += step) {
    const h = reachHeight(bird, anchor, x);
    if (Number.isFinite(h)) out.push(v(x, h));
  }
  return out;
}

/** Может ли птица хотя бы задеть круг (cx, cy) радиуса R (область под огибающей пересекает круг). */
export function reachTouches(bird: BirdType, anchor: Vec, cx: number, cy: number, R: number): boolean {
  for (let k = -10; k <= 10; k++) {
    const dx = (k / 10) * R;
    const h = reachHeight(bird, anchor, cx + dx);
    if (h >= cy - Math.sqrt(Math.max(0, R * R - dx * dx))) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Рельеф: поверхность и очередь птиц
// ─────────────────────────────────────────────────────────────────────────────

function terrainOutlines(terrain: readonly TerrainDef[]): Vec[][] {
  const out: Vec[][] = [];
  for (const t of terrain) {
    try {
      const pts = normalizePolygon(t.points.map(([x, y]) => v(x, y)));
      if (pts.length >= 3 && Math.abs(polygonArea(pts)) > 1e-9) out.push(pts);
    } catch {
      /* битые полигоны ловит lint */
    }
  }
  return out;
}

/**
 * Поверхности рельефа на вертикали x: высоты, где снизу рельеф, а сверху воздух (снизу вверх).
 * Учитывает перекрывающиеся полигоны (поверхность, закрытая другим рельефом, не считается).
 */
export function terrainSurfacesAt(terrain: readonly TerrainDef[], x: number): number[] {
  const polys = terrainOutlines(terrain);
  const ys: number[] = [];
  for (const P of polys) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const b = P[(i + 1) % P.length];
      if (a.x === b.x) {
        if (Math.abs(a.x - x) < 1e-9) ys.push(a.y, b.y);
        continue;
      }
      if ((a.x - x) * (b.x - x) <= 0) ys.push(a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
    }
  }
  const inside = (y: number): boolean => polys.some((P) => pointInPolygon(v(x, y), P));
  const out = [...new Set(ys.map((y) => Math.round(y * 1e6) / 1e6))]
    .sort((a, b) => a - b)
    .filter((y) => inside(y - 1e-3) && !inside(y + 1e-3));
  return out;
}

/** Поверхность рельефа на вертикали x, ближайшая к nearY (по умолчанию — самая верхняя). null — рельефа нет. */
export function terrainSurfaceY(terrain: readonly TerrainDef[], x: number, nearY?: number): number | null {
  const ys = terrainSurfacesAt(terrain, x);
  if (!ys.length) return null;
  if (nearY === undefined) return ys[ys.length - 1];
  return ys.reduce((best, y) => (Math.abs(y - nearY) < Math.abs(best - nearY) ? y : best), ys[0]);
}

/** Позиции птиц очереди (00 §1.2): x₀ = основание − 1.6, шаг max(1.1, r_i + r_{i+1} + 0.2), стоят на рельефе. */
export function queuePositions(lv: Pick<LevelDef, 'birds' | 'slingshot' | 'terrain'>): Array<{ bird: BirdType; x: number; y: number; r: number }> {
  const base = slingBase(lv.slingshot);
  const out: Array<{ bird: BirdType; x: number; y: number; r: number }> = [];
  let x = base.x - SLINGSHOT.QUEUE_X0;
  lv.birds.forEach((bird, i) => {
    const r = BIRD_R[bird] ?? 0.45;
    if (i > 0) x -= Math.max(SLINGSHOT.QUEUE_DX, (BIRD_R[lv.birds[i - 1]] ?? 0.45) + r + 0.2);
    const ground = terrainSurfaceY(lv.terrain, x, base.y) ?? base.y;
    out.push({ bird, x, y: ground + r, r });
  });
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Тела для анализа
// ─────────────────────────────────────────────────────────────────────────────

type BodyCls = 'block' | 'tnt' | 'pig' | 'terrain';

interface Contact {
  lower: LBody;
  upper: LBody;
  /** Пятно контакта (a = b для точечного). */
  a: Vec;
  b: Vec;
  /** Нормаль от нижнего тела к верхнему. */
  n: Vec;
  /** Точечный контакт (вершина на грани, круг). */
  point: boolean;
  /** Поверхность под кругом горизонтальна (грань, а не вершина/конёк). */
  flat: boolean;
  tiltDeg: number;
}

interface LBody {
  cls: BodyCls;
  index: number;
  ref: string;
  target: LintTarget;
  /** Контур (CCW) — у рельефа исходный, без внутренних диагоналей. */
  poly: Vec[] | null;
  /** Выпуклые части (для перекрытий). */
  pieces: Vec[][];
  circle: { c: Vec; r: number } | null;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  mass: number;
  com: Vec;
  mu: number;
  mat: string;
  dynamic: boolean;
  fragile: boolean;
  /** Контакты, где это тело — верхнее. */
  supports: Contact[];
  /** Контакты, где это тело — нижнее. */
  carries: Contact[];
  /** Боковые контакты: сосед и нормаль от соседа к этому телу. */
  sides: Array<{ other: LBody; n: Vec }>;
  /** Входящие силы от тел сверху: величина (кг) и x приложения. */
  loads: Array<{ F: number; x: number }>;
  loadX: number;
  loadW: number;
  /** Высота основания (рельеф под стопкой). */
  baseY: number;
}

function blockRef(b: BlockDef, i: number): string {
  if (b.id) return `блок #${i} «${b.id}»`;
  return `блок #${i} (${MAT_RU[b.material] ?? b.material} ${SHAPE_RU[b.shape] ?? b.shape} ${f2(b.w)}×${f2(b.h)} в ${f2(b.x)}; ${f2(b.y)})`;
}
function pigRef(p: PigDef, i: number): string {
  return `свинья #${i} ${p.type}${p.id ? ` «${p.id}»` : ''} в (${f2(p.x)}; ${f2(p.y)})`;
}
function tntRef(t: TntDef, i: number): string {
  return `TNT #${i} в (${f2(t.x)}; ${f2(t.y)})`;
}

function makeBody(cls: BodyCls, index: number, ref: string, target: LintTarget, shape: { poly?: Vec[]; circle?: { c: Vec; r: number } }, mass: number, mu: number, mat: string): LBody {
  const poly = shape.poly ?? null;
  const circle = shape.circle ?? null;
  let minX: number;
  let minY: number;
  let maxX: number;
  let maxY: number;
  let com: Vec;
  if (circle) {
    minX = circle.c.x - circle.r;
    maxX = circle.c.x + circle.r;
    minY = circle.c.y - circle.r;
    maxY = circle.c.y + circle.r;
    com = circle.c;
  } else {
    const P = poly as Vec[];
    minX = Math.min(...P.map((p) => p.x));
    maxX = Math.max(...P.map((p) => p.x));
    minY = Math.min(...P.map((p) => p.y));
    maxY = Math.max(...P.map((p) => p.y));
    com = polygonCentroid(P);
  }
  return {
    cls, index, ref, target, poly, pieces: poly ? [poly] : [], circle, minX, minY, maxX, maxY, mass, com, mu, mat,
    dynamic: cls !== 'terrain', fragile: false, supports: [], carries: [], sides: [], loads: [], loadX: com.x, loadW: mass, baseY: minY,
  };
}

const aabbNear = (A: LBody, B: LBody, m: number): boolean => A.minX <= B.maxX + m && B.minX <= A.maxX + m && A.minY <= B.maxY + m && B.minY <= A.maxY + m;

// ─────────────────────────────────────────────────────────────────────────────
// Контакты
// ─────────────────────────────────────────────────────────────────────────────

interface RawContact {
  a: Vec;
  b: Vec;
  /** Нормаль от B к A. */
  n: Vec;
  point: boolean;
  flat: boolean;
}

const COS_ANTI = Math.cos((3 * Math.PI) / 180);

/** Контакты двух многоугольников: пятна по антипараллельным граням и вершины на гранях. Нормаль — от B к A. */
function polyPolyContacts(PA: readonly Vec[], PB: readonly Vec[], tol: number): RawContact[] {
  const out: RawContact[] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  for (let i = 0; i < PA.length; i++) {
    const a0 = PA[i];
    const a1 = PA[(i + 1) % PA.length];
    const nA = outward(a0, a1);
    for (let j = 0; j < PB.length; j++) {
      const b0 = PB[j];
      const b1 = PB[(j + 1) % PB.length];
      const nB = outward(b0, b1);
      if (dot(nA, nB) > -COS_ANTI) continue;
      const LB = len(sub(b1, b0));
      if (LB < 1e-9) continue;
      const tB = v((b1.x - b0.x) / LB, (b1.y - b0.y) / LB);
      const s0 = dot(sub(a0, b0), tB);
      const s1 = dot(sub(a1, b0), tB);
      const lo = Math.max(0, Math.min(s0, s1));
      const hi = Math.min(LB, Math.max(s0, s1));
      if (hi - lo < LINT.MIN_PATCH) continue;
      const onA = (s: number): Vec => {
        const u = Math.abs(s1 - s0) < 1e-12 ? 0 : (s - s0) / (s1 - s0);
        return v(a0.x + (a1.x - a0.x) * u, a0.y + (a1.y - a0.y) * u);
      };
      const dl = dot(sub(onA(lo), b0), nB);
      const dh = dot(sub(onA(hi), b0), nB);
      if (Math.max(Math.abs(dl), Math.abs(dh)) > tol) continue;
      out.push({ a: v(b0.x + tB.x * lo, b0.y + tB.y * lo), b: v(b0.x + tB.x * hi, b0.y + tB.y * hi), n: nB, point: false, flat: true });
      if (s0 >= lo - 1e-6 && s0 <= hi + 1e-6) usedA.add(i);
      if (s1 >= lo - 1e-6 && s1 <= hi + 1e-6) usedA.add((i + 1) % PA.length);
      if (lo <= 1e-6) usedB.add(j);
      if (hi >= LB - 1e-6) usedB.add((j + 1) % PB.length);
    }
  }
  // вершина одного многоугольника на грани другого
  const vertexOn = (P: readonly Vec[], Q: readonly Vec[], used: Set<number>, flip: boolean): void => {
    for (let k = 0; k < P.length; k++) {
      if (used.has(k)) continue;
      const p = P[k];
      for (let j = 0; j < Q.length; j++) {
        const q0 = Q[j];
        const q1 = Q[(j + 1) % Q.length];
        const { q, t } = closestOnSegment(p, q0, q1);
        if (t <= 1e-3 || t >= 1 - 1e-3) continue;
        const nQ = outward(q0, q1);
        const d = dot(sub(p, q0), nQ);
        if (Math.abs(d) > tol) continue;
        // соседние вершины P — по свою сторону грани (вершина «смотрит» в Q)
        const prev = P[(k + P.length - 1) % P.length];
        const next = P[(k + 1) % P.length];
        if (dot(sub(prev, q0), nQ) < -tol || dot(sub(next, q0), nQ) < -tol) continue;
        const n = flip ? nQ : v(-nQ.x, -nQ.y);
        out.push({ a: q, b: q, n, point: true, flat: false });
      }
    }
  };
  vertexOn(PA, PB, usedA, true); // вершина A на грани B: нормаль B наружу = от B к A
  vertexOn(PB, PA, usedB, false); // вершина B на грани A: нормаль от B к A = −n_A
  return out;
}

/** Контакт круга с многоугольником. Нормаль — от многоугольника к кругу. */
function circlePolyContact(c: Vec, r: number, P: readonly Vec[], tol: number): RawContact | null {
  if (pointInPolygon(c, P)) return null;
  const { d, q, edge, t } = distToBoundary(c, P);
  if (Math.abs(d - r) > tol || d < 1e-9) return null;
  const n = v((c.x - q.x) / d, (c.y - q.y) / d);
  const cosH = Math.cos((LINT.HORIZ_DEG * Math.PI) / 180);
  const horizUp = (i: number): boolean => {
    const a = P[(i + P.length) % P.length];
    const b = P[(i + 1 + P.length) % P.length];
    return outward(a, b).y >= cosH;
  };
  let flat: boolean;
  if (t > 1e-4 && t < 1 - 1e-4) flat = horizUp(edge);
  else {
    // ближайшая — вершина: «ровно», если к ней примыкает горизонтальная грань (стык двух балок), а не конёк
    const vi = t <= 1e-4 ? edge : (edge + 1) % P.length;
    flat = n.y >= cosH && (horizUp(vi) || horizUp(vi - 1));
  }
  return { a: q, b: q, n, point: true, flat };
}

// ─────────────────────────────────────────────────────────────────────────────
// Основная проверка
// ─────────────────────────────────────────────────────────────────────────────

export interface LintOptions {
  /** Допуск касания, м (по умолчанию 0.02). */
  tol?: number;
}

/** Проверить уровень. Ошибки — то, что точно сломается или нарушает закон кампании; предупреждения — на усмотрение дизайнера. */
export function lintLevel(lv: LevelDef, opts: LintOptions = {}): LintResult {
  const tol = opts.tol ?? LINT.TOL;
  const issues: LintIssue[] = [];
  const add = (severity: Severity, code: string, message: string, target?: LintTarget, at?: Vec): void => {
    issues.push({ severity, code, message, ...(target ? { target } : {}), ...(at ? { at: v(at.x, at.y) } : {}) });
  };
  const L: LintTarget = { kind: 'level' };
  const episode = /^(\d+)-(\d+)$/.exec(lv.id ?? '');
  const ep = episode?.[1] ?? '';
  const num = Number(episode?.[2] ?? 0);

  // ── 1. Данные уровня ──
  if (!episode) add('error', 'id', `id «${lv.id}» — нужен вид «эпизод-номер», например «1-3»`, L);
  if (!lv.name || !lv.name.trim()) add('error', 'name', 'пустое название уровня', L);
  if (!THEMES.includes(lv.theme)) add('error', 'theme', `неизвестная тема «${lv.theme}»`, L);
  else if (EP_THEME[ep] && EP_THEME[ep] !== lv.theme) add('warning', 'theme', `тема «${lv.theme}» не совпадает с темой эпизода ${ep} («${EP_THEME[ep]}»)`, L);
  if (!Array.isArray(lv.birds) || lv.birds.length === 0) add('error', 'birds', 'нет птиц', L);
  else {
    lv.birds.forEach((b, i) => {
      if (!BIRD_TYPES.includes(b)) add('error', 'birds', `птица #${i}: неизвестный тип «${b}»`, L);
    });
    if (lv.birds.length > 8) add('warning', 'birds', `${lv.birds.length} птиц — в очереди больше 8 (00 §4: N ≤ 8)`, L);
  }
  const st = lv.stars;
  if (!st || !Number.isFinite(st.two) || !Number.isFinite(st.three)) add('error', 'stars', 'пороги звёзд не заданы', L);
  else {
    if (st.one !== 0) add('warning', 'stars', `stars.one = ${st.one}: первая звезда — за прохождение, должно быть 0 (06 §8.1)`, L);
    if (!(st.three > 0)) add('error', 'stars', 'stars.three ≤ 0', L);
    if (st.two >= st.three) add('error', 'stars', `stars.two (${st.two}) ≥ stars.three (${st.three})`, L);
    const rng = LINT.THREE_RANGE[ep];
    if (rng && st.three > 0 && (st.three < rng[0] || st.three > rng[1])) {
      add('warning', 'stars', `3★ = ${st.three} вне ориентира эпизода ${ep}: ${rng[0]}–${rng[1]} (00 §1.11)`, L);
    }
  }
  const meta = lv.meta;
  if (meta?.nMin !== undefined && (meta.nMin < 1 || meta.nMin > (lv.birds?.length ?? 0))) {
    add('error', 'meta', `meta.nMin = ${meta.nMin} вне 1…${lv.birds?.length ?? 0} (число птиц)`, L);
  }
  if (meta?.difficulty !== undefined && (meta.difficulty < 1 || meta.difficulty > 10)) add('warning', 'meta', `meta.difficulty = ${meta.difficulty} вне 1…10`, L);

  // ── 2. Тела ──
  const bodies: LBody[] = [];
  const blocks = lv.blocks ?? [];
  const pigs = lv.pigs ?? [];
  const tnts = lv.tnt ?? [];
  const fin = (...xs: number[]): boolean => xs.every((x) => typeof x === 'number' && Number.isFinite(x));

  blocks.forEach((b, i) => {
    const ref = blockRef(b, i);
    const target: LintTarget = { kind: 'block', index: i, ...(b.id ? { id: b.id } : {}) };
    if (!fin(b.x, b.y, b.w, b.h, b.angle ?? 0) || !(b.w > 0) || !(b.h > 0)) {
      add('error', 'bad-geom', `${ref}: нечисловые или неположительные размеры/координаты`, target);
      return;
    }
    if (!MATERIALS[b.material]) {
      add('error', 'bad-geom', `${ref}: неизвестный материал «${b.material}»`, target);
      return;
    }
    if (!['rect', 'circle', 'triangle', 'isoTriangle'].includes(b.shape)) {
      add('error', 'bad-geom', `${ref}: неизвестная форма «${b.shape}»`, target);
      return;
    }
    const at = v(b.x, b.y);
    if (b.shape === 'circle' && Math.abs(b.w - b.h) > 1e-6) add('error', 'bad-geom', `${ref}: у круга w ≠ h (w = h = диаметр)`, target, at);
    const thin = b.shape === 'circle' ? b.w : Math.min(b.w, b.h);
    if (b.shape === 'rect' && thin < 0.25 - 1e-6) add('error', 'thin', `${ref}: толщина ${f2(thin)} < 0.25 м — туннелирование (00 §1.1)`, target, at);
    else if (b.shape === 'rect' && thin < 0.5 - 1e-6) add('warning', 'thin', `${ref}: толщина ${f2(thin)} < 0.5 м (минимум каталога)`, target, at);
    const onGrid = (x: number): boolean => Math.abs(x / U - Math.round(x / U)) < 1e-4;
    if (!onGrid(b.w) || !onGrid(b.h)) add('warning', 'grid', `${ref}: размер ${f2(b.w)}×${f2(b.h)} не кратен сетке U = 0.5 м`, target, at);
    else if (!catalogKind(b)) add('warning', 'catalog', `${ref}: размера ${f2(b.w)}×${f2(b.h)} нет в каталоге 00 §1.6`, target, at);
    const ang = b.angle ?? 0;
    const quarter = Math.abs(ang / (Math.PI / 2) - Math.round(ang / (Math.PI / 2))) < 1e-4;
    if (b.shape !== 'circle' && !quarter) add('warning', 'angle', `${ref}: наклон ${f2(ang * DEG)}° — проверка опоры приблизительная`, target, at);
    if (b.shape === 'isoTriangle' && quarter && Math.abs(ang) > 1e-6) add('warning', 'angle', `${ref}: повёрнутая крыша (angle = ${f2(ang * DEG)}°)`, target, at);
    const mass = MATERIALS[b.material].density * blockArea(b);
    if (b.shape === 'circle') {
      bodies.push(makeBody('block', i, ref, target, { circle: { c: v(b.x, b.y), r: b.w / 2 } }, mass, MATERIALS[b.material].friction, b.material));
    } else {
      bodies.push(makeBody('block', i, ref, target, { poly: blockPolygon(b) as Vec[] }, mass, MATERIALS[b.material].friction, b.material));
    }
  });

  tnts.forEach((t, i) => {
    const ref = tntRef(t, i);
    const target: LintTarget = { kind: 'tnt', index: i };
    const s = t.size ?? TNT.SIZE;
    if (!fin(t.x, t.y, s, t.angle ?? 0) || !(s > 0)) {
      add('error', 'bad-geom', `${ref}: нечисловые координаты или размер`, target);
      return;
    }
    if (Math.abs(s - TNT.SIZE) > 1e-6) add('warning', 'catalog', `${ref}: размер ${f2(s)} — в каталоге TNT 1×1`, target, v(t.x, t.y));
    bodies.push(makeBody('tnt', i, ref, target, { poly: blockPolygon(tntAsBlock(t)) as Vec[] }, TNT.density * s * s, TNT.friction, 'tnt'));
  });

  pigs.forEach((p, i) => {
    const ref = pigRef(p, i);
    const target: LintTarget = { kind: 'pig', index: i, ...(p.id ? { id: p.id } : {}) };
    if (!PIG_TYPES.includes(p.type)) {
      add('error', 'bad-geom', `${ref}: неизвестный тип свиньи`, target);
      return;
    }
    if (!fin(p.x, p.y)) {
      add('error', 'bad-geom', `${ref}: нечисловые координаты`, target);
      return;
    }
    const r = PIG_R[p.type];
    const body = makeBody('pig', i, ref, target, { circle: { c: v(p.x, p.y), r } }, PIGS[p.type].density * Math.PI * r * r, PIGS[p.type].friction, 'pig');
    body.fragile = p.fragile === true;
    bodies.push(body);
  });

  const statics: LBody[] = [];
  (lv.terrain ?? []).forEach((t, i) => {
    const ref = `рельеф #${i} (${t.kind})`;
    const target: LintTarget = { kind: 'terrain', index: i };
    if (!Array.isArray(t.points) || t.points.length < 3 || !t.points.every((q) => Array.isArray(q) && fin(q[0], q[1]))) {
      add('error', 'terrain-invalid', `${ref}: нужно ≥ 3 числовых точек`, target);
      return;
    }
    let pts: Vec[];
    try {
      pts = normalizePolygon(t.points.map(([x, y]) => v(x, y)));
    } catch {
      add('error', 'terrain-invalid', `${ref}: вырожденный многоугольник`, target);
      return;
    }
    if (pts.length < 3 || Math.abs(polygonArea(pts)) < 1e-6) {
      add('error', 'terrain-invalid', `${ref}: вырожденный многоугольник (нулевая площадь)`, target);
      return;
    }
    if (!isSimplePolygon(pts)) {
      add('error', 'terrain-invalid', `${ref}: многоугольник самопересекается`, target);
      return;
    }
    if (!['ground', 'rock', 'platform'].includes(t.kind)) add('error', 'terrain-invalid', `${ref}: неизвестный kind`, target);
    let pieces: Vec[][];
    try {
      pieces = convexPieces(pts);
    } catch {
      add('error', 'terrain-invalid', `${ref}: не удалось разбить на выпуклые части`, target);
      return;
    }
    const body = makeBody('terrain', i, ref, target, { poly: pts }, 0, WORLD.GROUND_FRICTION, 'terrain');
    body.pieces = pieces;
    statics.push(body);
    // уклоны поверхностей (06 §3: площадки строго горизонтальны, откосы ≤ 35°)
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % pts.length];
      const n = outward(a, b);
      if (n.y <= 0 || len(sub(b, a)) < 0.3) continue;
      const tilt = Math.acos(clamp(n.y, -1, 1)) * DEG;
      const mid = v((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (tilt > 0.01 && tilt < 2) add('warning', 'terrain-almost-flat', `${ref}: ребро (${f2(a.x)}; ${f2(a.y)})–(${f2(b.x)}; ${f2(b.y)}) наклонено на ${f2(tilt)}° — свиньи и шары покатятся; сделайте строго горизонтальным`, target, mid);
      else if (tilt > 35.5 && tilt < 85) add('warning', 'terrain-slope', `${ref}: откос (${f2(a.x)}; ${f2(a.y)})–(${f2(b.x)}; ${f2(b.y)}) ${f2(tilt)}° круче 35° (06 §3)`, target, mid);
    }
  });

  const dyn = bodies;
  const all = [...dyn, ...statics];

  if (pigs.length === 0) add('error', 'no-pigs', 'на уровне нет ни одной свиньи', L);

  // ── 3. Перекрытия ──
  const overlapDepth = (A: LBody, B: LBody): number => {
    let depth = -Infinity;
    if (A.circle && B.circle) return A.circle.r + B.circle.r - len(sub(A.circle.c, B.circle.c));
    if (A.circle || B.circle) {
      const C = (A.circle ?? B.circle) as { c: Vec; r: number };
      const P = A.circle ? B : A;
      for (const piece of P.pieces) depth = Math.max(depth, circlePolyDepth(C.c, C.r, piece));
      return depth;
    }
    for (const pa of A.pieces) for (const pb of B.pieces) depth = Math.max(depth, satDepth(pa, pb));
    return depth;
  };
  for (let i = 0; i < dyn.length; i++) {
    const A = dyn[i];
    const others = [...dyn.slice(i + 1), ...statics];
    for (const B of others) {
      if (!aabbNear(A, B, 0)) continue;
      const d = overlapDepth(A, B);
      if (d > tol) {
        const at = v((Math.max(A.minX, B.minX) + Math.min(A.maxX, B.maxX)) / 2, (Math.max(A.minY, B.minY) + Math.min(A.maxY, B.maxY)) / 2);
        add('error', 'overlap', `${A.ref} и ${B.ref} перекрываются на ${f2(d)} м (допуск ${tol}; ставьте встык)`, A.target, at);
      }
    }
  }

  // ── 4. Контакты и граф опор ──
  const addContact = (A: LBody, B: LBody, c: RawContact): void => {
    // c.n — от B к A
    let upper = A;
    let lower = B;
    let n = c.n;
    if (n.y < -0.5) {
      upper = B;
      lower = A;
      n = v(-n.x, -n.y);
    } else if (n.y <= 0.5) {
      // боковой контакт — вес не держит, но может подпереть наклоняющееся тело
      if (!c.point) {
        A.sides.push({ other: B, n });
        B.sides.push({ other: A, n: v(-n.x, -n.y) });
      }
      return;
    }
    if (!upper.dynamic) return;
    const tiltDeg = Math.acos(clamp(n.y, -1, 1)) * DEG;
    const ct: Contact = { lower, upper, a: c.a, b: c.b, n, point: c.point, flat: c.flat, tiltDeg };
    upper.supports.push(ct);
    lower.carries.push(ct);
  };
  for (let i = 0; i < dyn.length; i++) {
    const A = dyn[i];
    for (const B of [...dyn.slice(i + 1), ...statics]) {
      if (!aabbNear(A, B, tol + 1e-6)) continue;
      if (A.circle && B.circle) {
        const d = len(sub(A.circle.c, B.circle.c));
        if (Math.abs(d - A.circle.r - B.circle.r) > tol || d < 1e-9) continue;
        const n = v((A.circle.c.x - B.circle.c.x) / d, (A.circle.c.y - B.circle.c.y) / d);
        const p = v(B.circle.c.x + n.x * B.circle.r, B.circle.c.y + n.y * B.circle.r);
        addContact(A, B, { a: p, b: p, n, point: true, flat: false });
      } else if (A.circle || B.circle) {
        const C = (A.circle ?? B.circle) as { c: Vec; r: number };
        const P = (A.circle ? B.poly : A.poly) as Vec[];
        const c = circlePolyContact(C.c, C.r, P, tol);
        if (!c) continue;
        // c.n — от многоугольника к кругу
        if (A.circle) addContact(A, B, c);
        else addContact(A, B, { ...c, n: v(-c.n.x, -c.n.y) });
      } else {
        for (const c of polyPolyContacts(A.poly as Vec[], B.poly as Vec[], tol)) addContact(A, B, c);
      }
    }
  }

  // ── 5. Нагрузки и центр масс над опорой ──
  // порядок: сверху вниз (тело обрабатывается, когда обработаны все тела, лежащие на нём)
  const pending = new Map<LBody, number>();
  for (const b of dyn) pending.set(b, new Set(b.carries.map((c) => c.upper)).size);
  const order: LBody[] = [];
  const queue = dyn.filter((b) => pending.get(b) === 0);
  const done = new Set<LBody>();
  while (order.length < dyn.length) {
    if (!queue.length) {
      const rest = dyn.filter((b) => !done.has(b));
      add('warning', 'support-cycle', `цикл в графе опор (${rest.slice(0, 3).map((b) => b.ref).join(', ')}…) — проверка ЦМ приблизительная`, rest[0].target);
      queue.push(rest[0]);
    }
    const b = queue.shift() as LBody;
    if (done.has(b)) continue;
    done.add(b);
    order.push(b);
    const lowers = new Set(b.supports.map((c) => c.lower));
    for (const lo of lowers) {
      if (!lo.dynamic) continue;
      const k = (pending.get(lo) ?? 1) - 1;
      pending.set(lo, k);
      if (k === 0 && !done.has(lo)) queue.push(lo);
    }
  }

  const nearestBelow = (A: LBody): { gap: number; ref: string } | null => {
    let best: { gap: number; ref: string } | null = null;
    for (const B of all) {
      if (B === A || B.maxY > A.minY + tol || B.maxX < A.minX + 0.01 || B.minX > A.maxX - 0.01) continue;
      const gap = A.minY - B.maxY;
      if (!best || gap < best.gap) best = { gap, ref: B.ref };
    }
    return best;
  };

  for (const b of order) {
    let W = b.mass;
    let M = b.mass * b.com.x;
    for (const l of b.loads) {
      W += l.F;
      M += l.F * l.x;
    }
    const X = W > 0 ? M / W : b.com.x;
    b.loadW = W;
    b.loadX = X;
    if (!b.supports.length) {
      const nb = nearestBelow(b);
      const where = nb ? `ближайшее тело снизу — ${nb.ref}, зазор ${f2(nb.gap)} м` : 'под ним ничего нет';
      if (b.cls === 'pig') add('error', 'pig-floating', `${b.ref} висит в воздухе: ${where} (центр = опора + радиус, pigOn())`, b.target, b.com);
      else add('error', 'no-support', `${b.ref} без опоры: ${where} (верх опоры = низ блока, допуск ±${tol})`, b.target, b.com);
      continue;
    }
    // группировка по опорам: пятно = объединение контактов с одним телом
    const groups = new Map<LBody, { l: number; r: number; point: boolean }>();
    for (const c of b.supports) {
      const l = Math.min(c.a.x, c.b.x);
      const r = Math.max(c.a.x, c.b.x);
      const g = groups.get(c.lower);
      if (g) {
        g.l = Math.min(g.l, l);
        g.r = Math.max(g.r, r);
        g.point = g.point && c.point;
      } else groups.set(c.lower, { l, r, point: c.point });
    }
    const spanL = Math.min(...[...groups.values()].map((g) => g.l));
    const spanR = Math.max(...[...groups.values()].map((g) => g.r));
    if (!b.circle) {
      if (spanR - spanL < LINT.MIN_PATCH) {
        add('error', 'point-support', `${b.ref} стоит на ребре или вершине (опора ${f2(spanR - spanL)} м) — упадёт`, b.target, v(spanL, b.minY));
      } else {
        const margin = Math.min(X - spanL, spanR - X);
        // наклон в сторону соседа, о которого тело опирается боком (арка, «домик» из двух блоков) — решает физика
        const tipRight = X > spanR;
        const propped = b.sides.some((sd) => (tipRight ? sd.n.x < -0.5 : sd.n.x > 0.5));
        if (margin < -0.005 && propped) {
          add('warning', 'com-leaning', `${b.ref}: центр масс (x = ${f2(X)}) вне опоры [${f2(spanL)}; ${f2(spanR)}] на ${f2(-margin)} м, держится только упором в соседа — проверьте физикой (T0–T2)`, b.target, v(X, b.minY));
        } else if (margin < -0.005) {
          add('error', 'com-outside', `${b.ref}: центр масс с грузом (x = ${f2(X)}) вне опоры [${f2(spanL)}; ${f2(spanR)}] на ${f2(-margin)} м — упадёт`, b.target, v(X, b.minY));
        } else if (margin < LINT.COM_MARGIN - 1e-6) {
          add('warning', 'com-margin', `${b.ref}: запас центра масс над опорой ${f2(Math.max(0, margin))} м < ${LINT.COM_MARGIN} (опора [${f2(spanL)}; ${f2(spanR)}], ЦМ ${f2(X)}) — хрупко`, b.target, v(X, b.minY));
        }
      }
      for (const c of b.supports) {
        if (c.point) continue;
        const pl = len(sub(c.b, c.a));
        if (pl < LINT.MIN_BEARING - 0.005) {
          add('error', 'bearing', `${b.ref} опирается на ${c.lower.ref} всего на ${f2(pl)} м (нужно ≥ ${LINT.MIN_BEARING}, 06 S5)`, b.target, v((c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2));
        }
        if (c.tiltDeg > LINT.HORIZ_DEG) {
          const mu = Math.sqrt(b.mu * c.lower.mu);
          const crit = Math.atan(mu) * DEG;
          if (c.tiltDeg > crit - 0.5) add('error', 'slide', `${b.ref} на уклоне ${f2(c.tiltDeg)}° соскользнёт: предел трения ${f2(crit)}° (μ = ${f2(mu)})`, b.target, b.com);
          else if (b.mat === 'ice' && c.tiltDeg > 20) add('warning', 'ice-slope', `${b.ref}: лёд на уклоне ${f2(c.tiltDeg)}° > 20° (06 §4.4)`, b.target, b.com);
        }
      }
    }
    // распределение веса по опорам (рычаг в центрах пятен; одна опора — в точке ЦМ, прижатой к пятну)
    const gs = [...groups.entries()];
    if (gs.length === 1) {
      const [lo, g] = gs[0];
      if (lo.dynamic) lo.loads.push({ F: W, x: clamp(X, g.l, g.r) });
    } else {
      const p = gs.map(([, g]) => (g.l + g.r) / 2);
      const pm = p.reduce((s, x) => s + x, 0) / p.length;
      const S = p.reduce((s, x) => s + (x - pm) ** 2, 0);
      let F = p.map((x) => W / p.length + (S > 1e-9 ? (W * (X - pm) * (x - pm)) / S : 0)).map((f) => Math.max(0, f));
      const sum = F.reduce((s, f) => s + f, 0) || 1;
      F = F.map((f) => (f * W) / sum);
      gs.forEach(([lo], k) => {
        if (lo.dynamic && F[k] > 0) lo.loads.push({ F: F[k], x: p[k] });
      });
    }
  }

  // высота основания (рельеф под стопкой), снизу вверх
  for (const b of [...order].reverse()) {
    const ys = b.supports.map((c) => (c.lower.dynamic ? c.lower.baseY : Math.min(c.a.y, c.b.y)));
    b.baseY = ys.length ? Math.min(...ys) : b.minY;
  }

  // ── 6. Свиньи ──
  const pigBodies = dyn.filter((b) => b.cls === 'pig');
  for (const b of pigBodies) {
    if (!b.supports.length) continue; // уже pig-floating
    const C = b.circle as { c: Vec; r: number };
    let bad = false;
    for (const c of b.supports) {
      if (c.lower.circle) {
        add('error', 'pig-on-round', `${b.ref} стоит на круглом теле (${c.lower.ref}) — скатится`, b.target, b.com);
        bad = true;
      } else if (c.tiltDeg > LINT.HORIZ_DEG) {
        add('error', 'pig-slope', `${b.ref}: опора наклонена на ${f2(c.tiltDeg)}° — свинья покатится (только горизонталь, 06 S6)`, b.target, b.com);
        bad = true;
      } else if (!c.flat) {
        add('error', 'pig-apex', `${b.ref} стоит на вершине/коньке ${c.lower.ref} — запрещено (06 S13)`, b.target, b.com);
        bad = true;
      }
    }
    if (bad || b.fragile) continue;
    const ys = b.com.y - C.r;
    const free = sideFreedom(b, ys, all, tol);
    const sides: string[] = [];
    for (const [name, s] of [['слева', free.left], ['справа', free.right]] as const) {
      const ok = s.surface >= LINT.PIG_FREE - tol || s.wall <= LINT.PIG_WALL + tol || s.wall < s.surface;
      if (!ok) sides.push(`${name} до края опоры ${f2(Math.max(0, s.surface))} м`);
    }
    if (sides.length) {
      add('error', 'pig-free-space', `${b.ref}: ${sides.join(', ')} — нужно ≥ ${LINT.PIG_FREE} м или стенка ≤ ${LINT.PIG_WALL} м; если так задумано — fragile: true (06 S7)`, b.target, b.com);
    }
  }
  for (let i = 0; i < pigBodies.length; i++) {
    for (let j = i + 1; j < pigBodies.length; j++) {
      const A = pigBodies[i].circle as { c: Vec; r: number };
      const B = pigBodies[j].circle as { c: Vec; r: number };
      const d = len(sub(A.c, B.c));
      if (d >= A.r + B.r - tol && d < A.r + B.r + 0.3) {
        add('warning', 'pig-close', `${pigBodies[i].ref} и ${pigBodies[j].ref} ближе r₁ + r₂ + 0.3 м (06 §5.1)`, pigBodies[i].target, A.c);
      }
    }
  }

  // ── 7. Шары ──
  for (const b of dyn) {
    if (b.cls !== 'block' || !b.circle || !b.supports.length) continue;
    const C = b.circle;
    const xs = b.supports.map((c) => c.a.x);
    const cradled = xs.some((x) => x < C.c.x - 0.05) && xs.some((x) => x > C.c.x + 0.05);
    if (cradled) continue;
    const tilt = Math.max(...b.supports.map((c) => c.tiltDeg));
    if (tilt > LINT.HORIZ_DEG) {
      add('error', 'ball-slope', `${b.ref}: шар на уклоне ${f2(tilt)}° — укатится (06 S8)`, b.target, C.c);
      continue;
    }
    const free = sideFreedom(b, C.c.y - C.r, all, tol, C.r);
    if (!(free.left.wall <= LINT.BALL_STOP + tol && free.right.wall <= LINT.BALL_STOP + tol)) {
      const show = (x: number): string => (Number.isFinite(x) ? `${f2(x)} м` : 'нет');
      add('error', 'ball-no-stoppers', `${b.ref}: шар без стопоров (слева ${show(free.left.wall)}, справа ${show(free.right.wall)}; нужно ≤ ${LINT.BALL_STOP} м — cradle())`, b.target, C.c);
    }
  }

  // ── 8. Отношение масс, высота, стройность ──
  const seenPairs = new Set<string>();
  for (const b of dyn) {
    for (const c of b.supports) {
      if (!c.lower.dynamic) continue;
      const k = `${b.ref}|${c.lower.ref}`;
      if (seenPairs.has(k)) continue;
      seenPairs.add(k);
      const ratio = b.mass / c.lower.mass;
      if (ratio > LINT.MAX_MASS_RATIO) {
        add('warning', 'mass-ratio', `${b.ref} (${f2(b.mass)} кг) на ${c.lower.ref} (${f2(c.lower.mass)} кг): отношение масс ${f2(ratio)} > ${LINT.MAX_MASS_RATIO} (06 S11)`, b.target, b.com);
      }
    }
  }
  let tallest: LBody | null = null;
  for (const b of dyn) if (b.cls !== 'pig' && (!tallest || b.maxY - b.baseY > tallest.maxY - tallest.baseY)) tallest = b;
  if (tallest && tallest.maxY - tallest.baseY > LINT.MAX_HEIGHT + 1e-6) {
    add('warning', 'too-tall', `${tallest.ref}: верх на ${f2(tallest.maxY - tallest.baseY)} м над основанием > ${LINT.MAX_HEIGHT} (7 этажей, 06 S10)`, tallest.target, v(tallest.com.x, tallest.maxY));
  }
  const bottomUp = [...order].reverse();
  for (const root of dyn) {
    if (root.circle || !root.supports.length || root.supports.some((c) => c.lower.dynamic)) continue;
    const E = new Set<LBody>([root]);
    for (const b of bottomUp) {
      if (b === root || !b.supports.length) continue;
      if (b.supports.every((c) => E.has(c.lower))) E.add(b);
    }
    if (E.size < 2) continue;
    let m = 0;
    let my = 0;
    for (const b of E) {
      m += b.mass;
      my += b.mass * (b.com.y - root.baseY);
    }
    const xsL = Math.min(...root.supports.map((c) => Math.min(c.a.x, c.b.x)));
    const xsR = Math.max(...root.supports.map((c) => Math.max(c.a.x, c.b.x)));
    const half = (xsR - xsL) / 2;
    const ratio = half > 1e-6 ? my / m / half : Infinity;
    if (ratio > LINT.MAX_SLENDER + 1e-6) {
      add('warning', 'slender', `столб на ${root.ref}: стройность h_цм/(b/2) = ${f2(ratio)} > ${LINT.MAX_SLENDER} без боковых связей (06 S9)`, root.target, root.com);
    }
  }

  // ── 9. Рогатка и очередь птиц ──
  const sling = lv.slingshot;
  const base = sling && fin(sling.x, sling.y) ? slingBase(sling) : null;
  const S: LintTarget = { kind: 'slingshot' };
  if (!base) add('error', 'slingshot-terrain', 'slingshot не задан', S);
  else {
    const ys = terrainSurfacesAt(lv.terrain ?? [], base.x);
    const near = ys.length ? ys.reduce((a, y) => (Math.abs(y - base.y) < Math.abs(a - base.y) ? y : a), ys[0]) : null;
    if (near === null) add('error', 'slingshot-terrain', `основание рогатки (${f2(base.x)}; ${f2(base.y)}) = slingshot − (0, ${SLINGSHOT.ANCHOR.y}): под ним нет рельефа`, S, base);
    else if (Math.abs(near - base.y) > LINT.SLING_TOL) {
      add('error', 'slingshot-terrain', `основание рогатки (${f2(base.x)}; ${f2(base.y)}) не на рельефе: поверхность на y = ${f2(near)} (Δ ${f2(base.y - near)} м); slingshot = slingshotOn(x, ${f2(near)})`, S, base);
    }
    if (lv.birds?.length) {
      const q = queuePositions({ ...lv, terrain: lv.terrain ?? [] });
      const crooked = q.filter((p) => Math.abs(p.y - p.r - base.y) > LINT.SLING_TOL);
      if (crooked.length) add('warning', 'queue-not-flat', `очередь птиц стоит не на ровной площадке рогатки (x = ${crooked.map((p) => f2(p.x)).join(', ')})`, S, v(crooked[0].x, crooked[0].y));
      const last = q[q.length - 1];
      if (lv.bounds && last.x - last.r < lv.bounds.minX) add('warning', 'queue-bounds', `последняя птица очереди (x = ${f2(last.x)}) левее bounds.minX = ${lv.bounds.minX}`, S, v(last.x, last.y));
    }
  }

  // ── 10. Досягаемость и зона целей ──
  const reach: PigReach[] = [];
  const birdSet = [...new Set((lv.birds ?? []).filter((b) => BIRD_TYPES.includes(b)))];
  if (sling && base) {
    const hs = Math.max(0, base.y);
    for (const b of pigBodies) {
      const C = b.circle as { c: Vec; r: number };
      const center = birdSet.filter((bt) => reachHeight(bt, sling, C.c.x) >= C.c.y);
      const touch = birdSet.filter((bt) => reachTouches(bt, sling, C.c.x, C.c.y, C.r + BIRD_R[bt]));
      reach.push({ index: b.index, center, touch });
      if (birdSet.length && !touch.length) {
        add('error', 'unreachable', `${b.ref} вне досягаемости всех птиц уровня (огибающая Red на x = ${f2(C.c.x)}: ${f2(reachHeight('red', sling, C.c.x))} м)`, b.target, C.c);
      } else if (birdSet.length && !center.length) {
        add('warning', 'reach-graze', `${b.ref}: птицы (${touch.join(', ')}) могут лишь задеть свинью краем — центр выше огибающей`, b.target, C.c);
      }
      const dx = C.c.x - base.x;
      const zmax = LINT.ZONE_MAX + LINT.ZONE_HILL_K * hs;
      if (dx < LINT.ZONE_MIN - 1e-6 || dx > zmax + 1e-6) {
        add('warning', 'zone', `${b.ref}: x − основание = ${f2(dx)} м вне зоны целей ${f2(LINT.ZONE_MIN)}…${f2(zmax)} (00 §4)`, b.target, C.c);
      }
    }
  }

  // ── 11. Границы и рельеф ──
  const bounds = lv.bounds;
  if (!bounds || !fin(bounds.minX, bounds.maxX, bounds.maxY) || bounds.minX >= bounds.maxX) add('error', 'out-of-bounds', 'bounds не заданы или minX ≥ maxX', L);
  else {
    for (const b of dyn) {
      if (b.minX < bounds.minX - 1e-6 || b.maxX > bounds.maxX + 1e-6 || b.maxY > bounds.maxY + 1e-6) {
        add('error', 'out-of-bounds', `${b.ref} за границами уровня [${bounds.minX}; ${bounds.maxX}] × (…; ${bounds.maxY}]`, b.target, b.com);
      }
    }
    if (base && (base.x - 1 < bounds.minX || base.x > bounds.maxX)) add('error', 'out-of-bounds', `рогатка (x = ${f2(base.x)}) за границами уровня`, S, base);
    const right = Math.max(-Infinity, ...dyn.map((b) => b.maxX));
    if (Number.isFinite(right) && bounds.maxX - right < 8) add('warning', 'bounds-right', `bounds.maxX = ${bounds.maxX} ближе 8 м к правому краю контента (${f2(right)}); обычно край + 12 (06 §2.3)`, L, v(bounds.maxX, 0));
    const apex = sling ? envelopeApex('red', sling) : -Infinity;
    if (bounds.maxY < apex) add('warning', 'bounds-top', `bounds.maxY = ${bounds.maxY} ниже апекса огибающей Red (≈ ${f2(apex)})`, L);
    // дыры в рельефе в пределах bounds
    const gaps: Array<[number, number]> = [];
    for (let x = bounds.minX; x <= bounds.maxX + 1e-9; x += 0.5) {
      if (terrainSurfacesAt(lv.terrain ?? [], x).length) continue;
      const g = gaps[gaps.length - 1];
      if (g && Math.abs(g[1] - (x - 0.5)) < 1e-6) g[1] = x;
      else gaps.push([x, x]);
    }
    for (const [a, b] of gaps) add('warning', 'terrain-gap', `нет рельефа на x ∈ [${f2(a)}; ${f2(b)}] — тела провалятся за KILL_Y`, L, v((a + b) / 2, 0));
  }

  // ── 12. TNT: неопределённая цепочка ──
  for (let i = 0; i < tnts.length; i++) {
    for (let j = i + 1; j < tnts.length; j++) {
      const a = tnts[i];
      const b = tnts[j];
      const h = ((a.size ?? TNT.SIZE) + (b.size ?? TNT.SIZE)) / 2;
      const gap = Math.max(Math.abs(a.x - b.x) - h, Math.abs(a.y - b.y) - h);
      if (gap > 2.0 + 1e-6 && gap < 2.5 - 1e-6) {
        add('warning', 'tnt-gap', `${tntRef(a, i)} и ${tntRef(b, j)}: зазор ${f2(gap)} м в «серой зоне» 2.0–2.5 — цепочка то будет, то нет (00 §1.8)`, { kind: 'tnt', index: i }, v((a.x + b.x) / 2, (a.y + b.y) / 2));
      }
    }
  }

  // ── 13. Лимиты ──
  const inFlight = Math.max(1, ...(lv.birds ?? []).map((b) => (b === 'blues' ? 3 : b === 'matilda' ? 2 : 1)));
  const dynamicBodies = blocks.length + tnts.length + pigs.length + inFlight;
  if (dynamicBodies > LINT.MAX_BODIES) add('error', 'body-limit', `динамических тел ${dynamicBodies} (блоки ${blocks.length} + TNT ${tnts.length} + свиньи ${pigs.length} + птицы ${inFlight}) > ${LINT.MAX_BODIES} (00 §1.1)`, L);
  const cap = num === 10 ? LINT.BLOCKS_MAX.boss : LINT.BLOCKS_MAX[ep];
  if (cap !== undefined && blocks.length + tnts.length > cap) add('warning', 'blocks-count', `блоков и TNT ${blocks.length + tnts.length} > ориентира ${cap} для ${num === 10 ? 'босса' : `эпизода ${ep}`} (00 §4)`, L);

  const errors = issues.filter((x) => x.severity === 'error');
  const warnings = issues.filter((x) => x.severity === 'warning');
  return {
    levelId: lv.id,
    ok: errors.length === 0,
    errors,
    warnings,
    issues,
    stats: {
      blocks: blocks.length,
      pigs: pigs.length,
      tnt: tnts.length,
      dynamicBodies,
      blockPoints: Math.round(blocks.reduce((s, b) => s + (MATERIALS[b.material] ? blockMaxPoints(b) : 0), 0) + tnts.length * 500),
      pigPoints: pigsMaxPoints(pigs.filter((p) => PIG_TYPES.includes(p.type))),
      reach,
    },
  };
}

/** Короткий алиас (06 §7.4: lint(L).errors). */
export const lint = lintLevel;

/**
 * Свобода круга вбок на опорной высоте ys: surface — сколько ровной опоры до края с каждой стороны (от края круга),
 * wall — зазор до ближайшего препятствия в полосе [ys + 0.03, ys + min(r, bandH)].
 */
function sideFreedom(b: LBody, ys: number, all: readonly LBody[], tol: number, bandH = 0.5): { left: { surface: number; wall: number }; right: { surface: number; wall: number } } {
  const C = b.circle as { c: Vec; r: number };
  // горизонтальные верхние грани на высоте ys
  const iv: Array<[number, number]> = [];
  for (const o of all) {
    if (o === b || !o.poly || o.maxY < ys - tol || o.minY > ys + tol) continue;
    const P = o.poly;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const q = P[(i + 1) % P.length];
      if (outward(a, q).y < 0.9999 || Math.abs(a.y - ys) > tol || Math.abs(q.y - ys) > tol) continue;
      iv.push([Math.min(a.x, q.x), Math.max(a.x, q.x)]);
    }
  }
  iv.sort((p, q) => p[0] - q[0]);
  let lo = C.c.x;
  let hi = C.c.x;
  let grown = true;
  while (grown) {
    grown = false;
    for (const [a, z] of iv) {
      if (a <= hi + tol && z > hi) {
        hi = z;
        grown = true;
      }
      if (z >= lo - tol && a < lo) {
        lo = a;
        grown = true;
      }
    }
  }
  const y0 = ys + 0.03;
  const y1 = ys + Math.min(C.r, bandH);
  let wl = Infinity;
  let wr = Infinity;
  for (const o of all) {
    if (o === b || o.maxY < y0 || o.minY > y1) continue;
    let rng: [number, number] | null = null;
    if (o.circle) {
      const dy = Math.max(0, Math.max(y0 - o.circle.c.y, o.circle.c.y - y1));
      if (dy < o.circle.r) {
        const hw = Math.sqrt(o.circle.r ** 2 - dy ** 2);
        rng = [o.circle.c.x - hw, o.circle.c.x + hw];
      }
    } else {
      for (const piece of o.pieces) {
        const r = xRangeInBand(piece, y0, y1);
        if (!r) continue;
        if (r[1] <= C.c.x) wl = Math.min(wl, C.c.x - C.r - r[1]);
        else if (r[0] >= C.c.x) wr = Math.min(wr, r[0] - (C.c.x + C.r));
      }
    }
    if (rng) {
      if (rng[1] <= C.c.x) wl = Math.min(wl, C.c.x - C.r - rng[1]);
      else if (rng[0] >= C.c.x) wr = Math.min(wr, rng[0] - (C.c.x + C.r));
    }
  }
  return {
    left: { surface: C.c.x - C.r - lo, wall: Math.max(0, wl) },
    right: { surface: hi - (C.c.x + C.r), wall: Math.max(0, wr) },
  };
}

/** Проверить несколько уровней (плюс уникальность id). */
export function lintLevels(levels: readonly LevelDef[], opts: LintOptions = {}): LintResult[] {
  const res = levels.map((l) => lintLevel(l, opts));
  const seen = new Map<string, number>();
  levels.forEach((l, i) => {
    const prev = seen.get(l.id);
    if (prev !== undefined) {
      const issue: LintIssue = { severity: 'error', code: 'id', message: `id «${l.id}» повторяется (уровни #${prev} и #${i})`, target: { kind: 'level' } };
      res[i].issues.push(issue);
      res[i].errors.push(issue);
      res[i].ok = false;
    } else seen.set(l.id, i);
  });
  return res;
}

/** Текстовый отчёт по результату (для CLI и тестов). */
export function formatLint(r: LintResult, { warnings = true }: { warnings?: boolean } = {}): string {
  const lines = [`${r.ok ? 'OK ' : 'ERR'} ${r.levelId}: ошибок ${r.errors.length}, предупреждений ${r.warnings.length} (тел ${r.stats.dynamicBodies})`];
  for (const i of r.issues) {
    if (i.severity === 'warning' && !warnings) continue;
    lines.push(`  ${i.severity === 'error' ? '✖' : '⚠'} [${i.code}] ${i.message}`);
  }
  return lines.join('\n');
}
