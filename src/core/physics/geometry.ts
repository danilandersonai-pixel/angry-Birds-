// Геометрия многоугольников: контуры блоков, очистка, сжатие на INSET и разбиение
// невыпуклого рельефа на выпуклые части (planck принимает только выпуклые полигоны ≤ 12 вершин).

import type { BlockShape, Vec } from '../types';

const EPS = 1e-9;
/**
 * Минимальное расстояние между вершинами выпуклой части. planck сваривает вершины ближе 0.5·linearSlop (2.5 мм)
 * и молча заменяет вырожденный полигон квадратом 2×2 — такие части отбрасываем сами.
 */
const MIN_VERTEX_GAP = 0.003;
/** Части меньшей площади (иглы от почти коллинеарных вершин) не создаём. */
const MIN_PIECE_AREA = 1e-6;

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function signedArea(pts: readonly Vec[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Контур формы блока (кроме круга) относительно центра габарита, против часовой стрелки. */
export function shapeOutline(shape: Exclude<BlockShape, 'circle'>, w: number, h: number): Vec[] {
  const x = w / 2;
  const y = h / 2;
  switch (shape) {
    case 'rect':
      return [{ x: -x, y: -y }, { x, y: -y }, { x, y }, { x: -x, y }];
    case 'triangle': // прямой угол внизу слева
      return [{ x: -x, y: -y }, { x, y: -y }, { x: -x, y }];
    case 'isoTriangle':
      return [{ x: -x, y: -y }, { x, y: -y }, { x: 0, y }];
  }
}

/** Визуальная площадь формы, м². */
export function shapeArea(shape: BlockShape, w: number, h: number): number {
  if (shape === 'circle') return Math.PI * (w / 2) ** 2;
  return shape === 'rect' ? w * h : (w * h) / 2;
}

/** Убирает соседние вершины ближе gap и коллинеарные вершины; может вернуть меньше трёх точек. */
function cleanRing(input: readonly Vec[], gap: number): Vec[] {
  let pts = input.filter((p, i) => {
    const q = input[(i + 1) % input.length];
    return Math.hypot(p.x - q.x, p.y - q.y) >= gap;
  });
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.abs(cross(a, b, c)) <= 1e-6 * Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y)) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

/** Контур против часовой, без почти совпадающих соседей (ближе 3 мм) и коллинеарных вершин. */
export function normalizePolygon(input: readonly Vec[]): Vec[] {
  const pts = cleanRing(input, MIN_VERTEX_GAP);
  if (pts.length < 3 || Math.abs(signedArea(pts)) < MIN_PIECE_AREA) throw new Error('Вырожденный многоугольник');
  return signedArea(pts) < 0 ? pts.reverse() : pts;
}

/** Сдвигает каждое ребро CCW-многоугольника внутрь на d (вершина — пересечение сдвинутых рёбер). */
export function insetPolygon(pts: readonly Vec[], d: number): Vec[] {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const l1 = Math.hypot(p.x - a.x, p.y - a.y);
    const l2 = Math.hypot(b.x - p.x, b.y - p.y);
    // внутренние нормали рёбер (слева от направления обхода)
    const n1x = -(p.y - a.y) / l1;
    const n1y = (p.x - a.x) / l1;
    const n2x = -(b.y - p.y) / l2;
    const n2y = (b.x - p.x) / l2;
    // (v − p)·n1 = (v − p)·n2 = d при v − p = k(n1 + n2); знаменатель ограничен у очень острых углов
    const k = d / Math.max(1 + n1x * n2x + n1y * n2y, 0.05);
    return { x: p.x + (n1x + n2x) * k, y: p.y + (n1y + n2y) * k };
  });
}

/** Точка p лежит на отрезке ab (с допуском 1 нм). */
function onSegment(p: Vec, a: Vec, b: Vec): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (Math.abs(cross(a, b, p)) > 1e-9 * len) return false;
  return (p.x - a.x) * (p.x - b.x) + (p.y - a.y) * (p.y - b.y) <= 0;
}

/** Отрезки ab и cd пересекаются или касаются (в том числе накладываются на одной прямой). */
function segmentsTouch(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

/** Простой контур: несмежные рёбра не пересекаются и не касаются. */
function isSimple(pts: readonly Vec[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // смежные через замыкание
      if (segmentsTouch(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function isConvex(pts: readonly Vec[]): boolean {
  for (let i = 0, n = pts.length; i < n; i++) {
    if (cross(pts[i], pts[(i + 1) % n], pts[(i + 2) % n]) < -EPS) return false;
  }
  return true;
}

function inTriangle(p: Vec, a: Vec, b: Vec, c: Vec): boolean {
  return cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS;
}

/** Триангуляция простого CCW-многоугольника отсечением «ушей». Вершины треугольников — те же объекты. */
function triangulate(pts: readonly Vec[]): Vec[][] {
  const ring = pts.slice();
  const tris: Vec[][] = [];
  while (ring.length > 3) {
    const n = ring.length;
    let ear = -1;
    for (let i = 0; i < n && ear < 0; i++) {
      const a = ring[(i + n - 1) % n];
      const b = ring[i];
      const c = ring[(i + 1) % n];
      if (cross(a, b, c) <= EPS) continue;
      if (!ring.some((q) => q !== a && q !== b && q !== c && inTriangle(q, a, b, c))) ear = i;
    }
    if (ear < 0) throw new Error('Многоугольник рельефа самопересекается');
    tris.push([ring[(ear + n - 1) % n], ring[ear], ring[(ear + 1) % n]]);
    ring.splice(ear, 1);
  }
  tris.push(ring);
  return tris;
}

/** Склейка двух CCW-многоугольников по общему ребру (A: p→q, B: q→p); null — общего ребра нет. */
function mergeAlongEdge(a: readonly Vec[], b: readonly Vec[]): Vec[] | null {
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    const j = b.indexOf(q);
    if (j < 0 || b[(j + 1) % b.length] !== p) continue;
    const out: Vec[] = [];
    for (let k = 0; k < a.length; k++) out.push(a[(i + 1 + k) % a.length]); // q … p
    for (let k = 2; k < b.length; k++) out.push(b[(j + k) % b.length]); // после p … до q
    return out;
  }
  return null;
}

/** Часть годится для planck: вершины не сварятся, площадь не нулевая. */
function isSolidPiece(pts: readonly Vec[]): boolean {
  if (pts.length < 3 || signedArea(pts) < MIN_PIECE_AREA) return false;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < MIN_VERTEX_GAP) return false;
    }
  }
  return true;
}

/** Разбиение простого CCW-многоугольника на выпуклые части (≤ maxVerts вершин): уши + жадная склейка. */
function convexPieces(pts: readonly Vec[], maxVerts: number): Vec[][] {
  if (isConvex(pts) && pts.length <= maxVerts && isSolidPiece(pts)) return [pts.slice()];
  const pieces = triangulate(pts).filter((t) => signedArea(t) > 1e-9);
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < pieces.length && !merged; i++) {
      for (let j = i + 1; j < pieces.length && !merged; j++) {
        const m = mergeAlongEdge(pieces[i], pieces[j]);
        if (m && m.length <= maxVerts && isConvex(m)) {
          pieces[i] = m;
          pieces.splice(j, 1);
          merged = true;
        }
      }
    }
  }
  return pieces.map((p) => cleanRing(p, MIN_VERTEX_GAP)).filter(isSolidPiece);
}

/** Сжатие не вывернуло ни одного ребра (вывернутое ребро — деталь тоньше 2·inset) и не дало самопересечений. */
function insetHolds(outline: readonly Vec[], inner: readonly Vec[]): boolean {
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dot = (outline[j].x - outline[i].x) * (inner[j].x - inner[i].x) + (outline[j].y - outline[i].y) * (inner[j].y - inner[i].y);
    if (dot <= 0) return false;
  }
  return isSimple(inner);
}

/**
 * Рельеф: контур в любом обходе → нормализация → сжатие на inset → выпуклые части для planck.
 * Если деталь тоньше 2·inset (сжатие выворачивает рёбра) — части строятся по исходному контуру.
 */
export function terrainPieces(points: ReadonlyArray<readonly [number, number]>, inset: number, maxVerts: number): Vec[][] {
  const outline = normalizePolygon(points.map(([x, y]) => ({ x, y })));
  if (!isSimple(outline)) throw new Error('Многоугольник рельефа самопересекается');
  const inner = insetPolygon(outline, inset);
  return convexPieces(insetHolds(outline, inner) ? normalizePolygon(inner) : outline, maxVerts);
}
