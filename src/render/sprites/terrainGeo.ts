// Чистая геометрия рельефа (без Canvas — проверяется в Node):
//  • объединение соприкасающихся / перекрывающихся полигонов одного вида (кромка и обводка — по общему контуру);
//  • цепочки верхних рёбер, сдвиг цепочки, обход по длине дуги, нарезка на куски.
// Соглашение: все контуры здесь — «внутренность слева» (внешние против часовой, дыры — по часовой).

export type P2 = [number, number];
type RP = ReadonlyArray<readonly [number, number]>;

/** Цепочка подряд идущих верхних рёбер. en[i] — внешняя нормаль ребра pts[i]→pts[i+1]. */
export interface Chain {
  pts: P2[];
  en: P2[];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Ориентированная площадь (> 0 — против часовой при оси Y вверх). */
export function polyArea(pts: RP): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Копия контура без повторных соседних точек, против часовой стрелки. */
export function normalizeCCW(pts: RP): P2[] {
  const out: P2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) <= 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
  if (polyArea(out) < 0) out.reverse();
  return out;
}

/** Точка внутри многоугольника (чёт-нечет). */
export function pointInPoly(pts: RP, x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Допуск совпадения точек, м (координаты уровней округлены до 1e-4). */
const TOL = 1e-6;

/** Пул вершин: близкие (≤ TOL) точки получают один индекс — стыки контуров совпадают точно. */
class VertexPool {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  private readonly grid = new Map<string, number[]>();
  private static readonly CELL = 1e-4;

  id(x: number, y: number): number {
    const cx = Math.floor(x / VertexPool.CELL);
    const cy = Math.floor(y / VertexPool.CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.grid.get(`${cx + dx},${cy + dy}`);
        if (!list) continue;
        for (const k of list) if (Math.abs(this.xs[k] - x) <= TOL && Math.abs(this.ys[k] - y) <= TOL) return k;
      }
    }
    const k = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    const key = `${cx},${cy}`;
    const list = this.grid.get(key);
    if (list) list.push(k);
    else this.grid.set(key, [k]);
    return k;
  }
}

interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Параметры разрезов вдоль ребра (0 и 1 включительно). */
  ts: number[];
}

const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Разрезы рёбер e и f в точках пересечения / касания / наложения. */
function splitPair(e: Edge, f: Edge): void {
  const rx = e.bx - e.ax;
  const ry = e.by - e.ay;
  const sx = f.bx - f.ax;
  const sy = f.by - f.ay;
  const lr = Math.hypot(rx, ry);
  const ls = Math.hypot(sx, sy);
  if (lr < TOL || ls < TOL) return;
  // быстрый отказ по габаритам
  if (
    Math.max(e.ax, e.bx) + TOL < Math.min(f.ax, f.bx) ||
    Math.max(f.ax, f.bx) + TOL < Math.min(e.ax, e.bx) ||
    Math.max(e.ay, e.by) + TOL < Math.min(f.ay, f.by) ||
    Math.max(f.ay, f.by) + TOL < Math.min(e.ay, e.by)
  )
    return;
  const qx = f.ax - e.ax;
  const qy = f.ay - e.ay;
  const den = cross(rx, ry, sx, sy);
  const et = TOL / lr;
  const eu = TOL / ls;
  if (Math.abs(den) > 1e-12 * lr * ls) {
    const t = cross(qx, qy, sx, sy) / den;
    const u = cross(qx, qy, rx, ry) / den;
    if (t >= -et && t <= 1 + et && u >= -eu && u <= 1 + eu) {
      e.ts.push(Math.min(1, Math.max(0, t)));
      f.ts.push(Math.min(1, Math.max(0, u)));
    }
    return;
  }
  // параллельны: общий отрезок только у коллинеарных
  if (Math.abs(cross(qx, qy, rx, ry)) / lr > TOL) return;
  const rr = lr * lr;
  const ss = ls * ls;
  for (const [px, py] of [
    [f.ax, f.ay],
    [f.bx, f.by],
  ]) {
    const t = ((px - e.ax) * rx + (py - e.ay) * ry) / rr;
    if (t > et && t < 1 - et) e.ts.push(t);
  }
  for (const [px, py] of [
    [e.ax, e.ay],
    [e.bx, e.by],
  ]) {
    const u = ((px - f.ax) * sx + (py - f.ay) * sy) / ss;
    if (u > eu && u < 1 - eu) f.ts.push(u);
  }
}

/** Убрать коллинеарные промежуточные вершины (остаются после разрезов рёбер). */
function simplifyLoop(loop: P2[]): P2[] {
  let pts = loop;
  for (let pass = 0; pass < 3; pass++) {
    const out: P2[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const bcx = c[0] - b[0];
      const bcy = c[1] - b[1];
      const lab = Math.hypot(abx, aby);
      const lbc = Math.hypot(bcx, bcy);
      if (lab < TOL) continue;
      if (lbc > TOL && Math.abs(cross(abx, aby, bcx, bcy)) <= 1e-9 * lab * lbc && abx * bcx + aby * bcy > 0) continue;
      out.push(b);
    }
    if (out.length === pts.length) break;
    pts = out;
  }
  return pts;
}

/**
 * Объединение многоугольников (произвольные: касание по рёбрам, Т-стыки, перекрытие, общие вершины).
 * Результат — замкнутые контуры «внутренность слева»: внешние против часовой, дыры — по часовой.
 * Алгоритм: все рёбра режутся во взаимных пересечениях; кусок ребра — граница объединения, если по одну его
 * сторону точка внутри хотя бы одного многоугольника, а по другую — ни в одном; куски сшиваются в контуры
 * с выбором самого левого поворота в вершинах (касающиеся в точке области остаются отдельными контурами).
 */
export function unionPolygons(polys: ReadonlyArray<RP>): P2[][] {
  const src = polys.map(normalizeCCW).filter((p) => p.length >= 3 && Math.abs(polyArea(p)) > 1e-9);
  if (src.length <= 1) return src;
  const edges: Edge[] = [];
  for (const p of src) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      edges.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], ts: [0, 1] });
    }
  }
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) splitPair(edges[i], edges[j]);
  const pool = new VertexPool();
  const segs: Array<[number, number]> = [];
  for (const e of edges) {
    e.ts.sort((a, b) => a - b);
    let prev = -1;
    for (const t of e.ts) {
      const v = pool.id(lerp(e.ax, e.bx, t), lerp(e.ay, e.by, t));
      if (prev >= 0 && v !== prev) segs.push([prev, v]);
      prev = v;
    }
  }
  const inUnion = (x: number, y: number): boolean => src.some((p) => pointInPoly(p, x, y));
  const OFF = 1e-5;
  const out = new Map<number, number[]>();
  const seen = new Set<string>();
  const from: number[] = [];
  const to: number[] = [];
  for (const [i, j] of segs) {
    const ax = pool.xs[i];
    const ay = pool.ys[i];
    const bx = pool.xs[j];
    const by = pool.ys[j];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < TOL) continue;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const nx = (-(by - ay) / len) * OFF;
    const ny = ((bx - ax) / len) * OFF;
    const L = inUnion(mx + nx, my + ny);
    const R = inUnion(mx - nx, my - ny);
    if (L === R) continue;
    const [s, d] = L ? [i, j] : [j, i];
    const key = `${s}>${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = from.length;
    from.push(s);
    to.push(d);
    const list = out.get(s);
    if (list) list.push(id);
    else out.set(s, [id]);
  }
  // сшивка в контуры
  const used = new Uint8Array(from.length);
  const loops: P2[][] = [];
  for (let e0 = 0; e0 < from.length; e0++) {
    if (used[e0]) continue;
    const loop: P2[] = [];
    let e = e0;
    for (let guard = 0; guard <= from.length; guard++) {
      used[e] = 1;
      loop.push([pool.xs[from[e]], pool.ys[from[e]]]);
      const v = to[e];
      const dx = pool.xs[v] - pool.xs[from[e]];
      const dy = pool.ys[v] - pool.ys[from[e]];
      let best = -1;
      let bestA = -Infinity;
      for (const c of out.get(v) ?? []) {
        if (used[c] && c !== e0) continue;
        const cx = pool.xs[to[c]] - pool.xs[v];
        const cy = pool.ys[to[c]] - pool.ys[v];
        // угол поворота (+ — влево); самый левый поворот держит контур вокруг одной области
        const a = Math.atan2(cross(dx, dy, cx, cy), dx * cx + dy * cy);
        if (a > bestA) {
          bestA = a;
          best = c;
        }
      }
      if (best < 0 || best === e0) break;
      e = best;
    }
    const s = simplifyLoop(loop);
    if (s.length >= 3 && Math.abs(polyArea(s)) > 1e-9) loops.push(s);
  }
  return loops;
}

/** Габарит контура. */
export function bboxOf(pts: RP): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/**
 * Группы индексов многоугольников, чьи габариты соприкасаются или пересекаются (транзитивно).
 * Внутри группы контуры объединяются; порядок групп — по первому участнику.
 */
export function touchingGroups(polys: ReadonlyArray<RP>, pad = 1e-4): number[][] {
  const n = polys.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const bb = polys.map(bboxOf);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = bb[i];
      const b = bb[j];
      if (a[2] + pad >= b[0] && b[2] + pad >= a[0] && a[3] + pad >= b[1] && b[3] + pad >= a[1]) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }
  const map = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = map.get(r);
    if (g) g.push(i);
    else map.set(r, [i]);
  }
  return [...map.values()].sort((a, b) => a[0] - b[0]);
}

// ───────────────────────── цепочки верхних рёбер ─────────────────────────

/** Верхние цепочки контура «внутренность слева»: рёбра с внешней нормалью ny > minNy, подряд. */
export function topChains(loop: RP, minNy: number): Chain[] {
  const n = loop.length;
  if (n < 3) return [];
  const nrm: P2[] = [];
  const top: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      nrm.push([0, 0]);
      top.push(false);
      continue;
    }
    // внутренность слева → внешняя нормаль справа от направления обхода
    const nx = dy / len;
    const ny = -dx / len;
    nrm.push([nx, ny]);
    top.push(ny > minNy);
  }
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (top[i] && !top[(i - 1 + n) % n]) {
      start = i;
      break;
    }
  }
  if (start < 0) return [];
  const chains: Chain[] = [];
  let cur: Chain | null = null;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (top[i]) {
      if (!cur) cur = { pts: [[loop[i][0], loop[i][1]]], en: [] };
      const b = loop[(i + 1) % n];
      cur.pts.push([b[0], b[1]]);
      cur.en.push(nrm[i]);
    } else if (cur) {
      chains.push(cur);
      cur = null;
    }
  }
  if (cur) chains.push(cur);
  return chains;
}

/** Нормаль в вершине j цепочки (средняя у внутренних вершин) и множитель «митры». */
export function vertexNormal(ch: Chain, j: number): [number, number, number] {
  const last = ch.en.length;
  if (j <= 0) return [ch.en[0][0], ch.en[0][1], 1];
  if (j >= last) return [ch.en[last - 1][0], ch.en[last - 1][1], 1];
  const a = ch.en[j - 1];
  const b = ch.en[j];
  let nx = a[0] + b[0];
  let ny = a[1] + b[1];
  const l = Math.hypot(nx, ny) || 1;
  nx /= l;
  ny /= l;
  const miter = 1 / Math.max(0.5, nx * b[0] + ny * b[1]);
  return [nx, ny, miter];
}

/** Цепочка, сдвинутая внутрь (d > 0) или наружу (d < 0). */
export function offsetChain(ch: Chain, d: number): P2[] {
  const out: P2[] = [];
  for (let j = 0; j < ch.pts.length; j++) {
    const [nx, ny, m] = vertexNormal(ch, j);
    out.push([ch.pts[j][0] - nx * d * m, ch.pts[j][1] - ny * d * m]);
  }
  return out;
}

/** Обход цепочки по длине дуги с шагом step(): колбэк (x, y, nx, ny, tx, ty). Возвращает перенос на следующую цепочку. */
export function walkChain(
  ch: Chain,
  step: () => number,
  start: number,
  cb: (x: number, y: number, nx: number, ny: number, tx: number, ty: number) => void,
): number {
  let carry = start;
  for (let i = 0; i < ch.en.length; i++) {
    const a = ch.pts[i];
    const b = ch.pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const tx = (b[0] - a[0]) / len;
    const ty = (b[1] - a[1]) / len;
    let s = carry;
    while (s < len) {
      cb(a[0] + tx * s, a[1] + ty * s, ch.en[i][0], ch.en[i][1], tx, ty);
      s += step();
    }
    carry = s - len;
  }
  return carry;
}

/** Длина дуги цепочки до каждой вершины. */
export function chainCum(ch: Chain): number[] {
  const cum = [0];
  for (let i = 0; i < ch.en.length; i++) cum.push(cum[i] + Math.hypot(ch.pts[i + 1][0] - ch.pts[i][0], ch.pts[i + 1][1] - ch.pts[i][1]));
  return cum;
}

/** Часть цепочки по длине дуги [s0, s1] (концы — на рёбрах, нормали рёбер сохраняются). */
export function subChain(ch: Chain, cum: number[], s0: number, s1: number): Chain {
  const pts: P2[] = [];
  const en: P2[] = [];
  for (let i = 0; i < ch.en.length; i++) {
    const a = cum[i];
    const b = cum[i + 1];
    if (b <= s0 || a >= s1 || b - a < 1e-9) continue;
    const t0 = Math.max(0, (s0 - a) / (b - a));
    const t1 = Math.min(1, (s1 - a) / (b - a));
    const p = ch.pts[i];
    const q = ch.pts[i + 1];
    if (!pts.length) pts.push([lerp(p[0], q[0], t0), lerp(p[1], q[1], t0)]);
    pts.push([lerp(p[0], q[0], t1), lerp(p[1], q[1], t1)]);
    en.push(ch.en[i]);
  }
  return { pts, en };
}

/** Границы кусков длиной ≈ pieceM по длине дуги; разрезы отодвинуты от вершин (там сдвинутые линии кусков расходились бы). */
export function pieceCuts(cum: number[], total: number, pieceM: number): number[] {
  const n = Math.max(1, Math.round(total / pieceM));
  const cuts = [0];
  for (let k = 1; k < n; k++) {
    let c = (k / n) * total;
    for (let i = 1; i < cum.length - 1; i++) {
      const v = cum[i];
      if (Math.abs(c - v) < 0.3) {
        const lo = Math.min(cum[i + 1], v + 0.3);
        const hi = Math.max(cum[i - 1], v - 0.3);
        c = c >= v && lo - v >= 0.3 ? lo : v - hi >= 0.3 ? hi : c;
      }
    }
    if (c > cuts[cuts.length - 1] + 0.5 && c < total - 0.5) cuts.push(c);
  }
  cuts.push(total);
  return cuts;
}

/** Внешний (бугристый) контур шапки вдоль цепочки; s0 — длина дуги начала куска в исходной цепочке. */
export function capOutline(ch: Chain, s0: number, bumpH: (s: number) => number): P2[] {
  const outer: P2[] = [];
  let acc = s0;
  for (let i = 0; i < ch.en.length; i++) {
    const a = ch.pts[i];
    const b = ch.pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const tx = (b[0] - a[0]) / len;
    const ty = (b[1] - a[1]) / len;
    const [vnx, vny] = vertexNormal(ch, i);
    const h0 = bumpH(acc);
    outer.push([a[0] + vnx * h0, a[1] + vny * h0]);
    const n = Math.max(1, Math.ceil(len / 0.05));
    for (let k = 1; k < n; k++) {
      const s = (k / n) * len;
      const h = bumpH(acc + s);
      outer.push([a[0] + tx * s + ch.en[i][0] * h, a[1] + ty * s + ch.en[i][1] * h]);
    }
    acc += len;
  }
  const [enx, eny] = vertexNormal(ch, ch.pts.length - 1);
  const he = bumpH(acc);
  const pe = ch.pts[ch.pts.length - 1];
  outer.push([pe[0] + enx * he, pe[1] + eny * he]);
  return outer;
}

/** Нижний (фестончатый) край кромки на участке [s0, s1] цепочки: точка поверхности − нормаль · depth(s). */
export function bandLower(ch: Chain, cum: number[], s0: number, s1: number, depth: (s: number) => number): P2[] {
  const out: P2[] = [];
  const STEP = 0.03;
  for (let i = 0; i < ch.en.length; i++) {
    const a = cum[i];
    const b = cum[i + 1];
    if (b <= s0 || a >= s1 || b - a < 1e-9) continue;
    const p = ch.pts[i];
    const q = ch.pts[i + 1];
    const [nx, ny] = ch.en[i];
    const u0 = Math.max(a, s0);
    const u1 = Math.min(b, s1);
    // внутренняя вершина: точка по средней нормали с «митрой»
    if (u0 === a && i > 0) {
      const [vx, vy, m] = vertexNormal(ch, i);
      const d = depth(a) * m;
      out.push([p[0] - vx * d, p[1] - vy * d]);
    }
    const n = Math.max(1, Math.ceil((u1 - u0) / STEP));
    for (let k = u0 === a && i > 0 ? 1 : 0; k <= n; k++) {
      const u = u0 + ((u1 - u0) * k) / n;
      if (u === b && i < ch.en.length - 1) break; // вершину добавит следующее ребро
      const t = (u - a) / (b - a);
      const d = depth(u);
      out.push([lerp(p[0], q[0], t) - nx * d, lerp(p[1], q[1], t) - ny * d]);
    }
  }
  return out;
}

/** Хэш содержимого рельефа (вид + точки): одинаковый рельеф в новом массиве не пересобирается. */
export function terrainHash(terrain: ReadonlyArray<{ kind: string; points: RP }>): string {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x01000193 | 0;
  const mixIn = (v: number): void => {
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ v, 0x5bd1e995) ^ (h2 >>> 13);
  };
  for (const t of terrain) {
    for (let i = 0; i < t.kind.length; i++) mixIn(t.kind.charCodeAt(i));
    mixIn(t.points.length);
    for (const [x, y] of t.points) {
      mixIn(Math.round(x * 1e4) | 0);
      mixIn(Math.round(y * 1e4) | 0);
    }
  }
  return `${terrain.length}:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}`;
}
