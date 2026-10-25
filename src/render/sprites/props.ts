// Общие хелперы процедурной графики «реквизита»: палитры материалов, ГПСЧ, геометрия форм,
// фаски с освещением, мягкие внутренние тени, шумовые тайлы. Используются blocks.ts и slingshot.ts.
// Пространство рисования — метры, ось Y ВНИЗ (спрайт-пространство), начало — центр bbox.

import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { BlockShape, Material } from '../../core/types';

export const TAU = Math.PI * 2;
export type Pt = [number, number];

/** Обводка блоков, м (04 §1.3). */
export const OUT_BLOCK = 0.035;
/** Направление НА источник света в спрайт-пространстве (Y вниз): сверху-слева. */
export const LIGHT: Pt = [-0.6, -0.8];

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const smooth = (t: number): number => t * t * (3 - 2 * t);

// ───────────────────────── ГПСЧ ─────────────────────────

/** mulberry32: детерминированный генератор [0, 1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Любое число (целое или дробь 0..1 из EntityView.seed) → uint32. */
export function seedInt(seed: number): number {
  if (!Number.isFinite(seed)) return 0;
  if (Number.isInteger(seed)) return seed >>> 0;
  return Math.floor(Math.abs(seed) * 4294967296) >>> 0;
}

/** Смешать несколько чисел в одно зерно (FNV-подобный хеш). */
export function hashSeed(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h ^= x >>> 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

// ───────────────────────── цвета ─────────────────────────

const rgbCache = new Map<string, [number, number, number]>();

export function hexRgb(hex: string): [number, number, number] {
  let v = rgbCache.get(hex);
  if (!v) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h, 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, v);
  }
  return v;
}

/** hex → rgba(...) с прозрачностью. */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1).toFixed(3)})`;
}

/** Смешать два hex-цвета (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const ch = (i: number) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

// ───────────────────────── палитры материалов (04 §7.2) ─────────────────────────

export interface MatPalette {
  readonly light: string;
  readonly base: string;
  readonly dark: string;
  readonly deep: string;
  readonly outline: string;
  /** Тёмная щель трещины и её освещённая стенка. */
  readonly crack: string;
  readonly crackLight: string;
  /** Цвет «свежего» излома на сколах. */
  readonly fresh: string;
  /** Пыль/дымка разрушения (для эффектов). */
  readonly dust: string;
}

export const WOOD = {
  light: '#F6C77E',
  base: '#D88F40',
  dark: '#A4602B',
  deep: '#7A4620',
  outline: '#4A2810',
  grain: '#9E5B26',
  knot: '#6E3E19',
  crack: '#3A1E0A',
  crackLight: '#FFE2A8',
  fresh: '#F8DCA4',
  dust: '#E2C595',
  nail: '#70737C',
  nailLight: '#C9CDD6',
} as const;

// Лёд (Б12): тело насыщенно-голубое, обводка тёмно-синяя — силуэт читается на снегу, облаках и светлом небе;
// прозрачность «стекла» сохранена (альфа тела 0.74–0.86), белые блики — поверх.
export const ICE = {
  light: '#C9F1FF',
  base: '#7CCDF4',
  dark: '#3E9FDD',
  deep: '#1E74B8',
  outline: '#0E3A6A',
  crack: '#FFFFFF',
  crackLight: '#FFFFFF',
  crackDark: '#1C64A3',
  fresh: '#F4FDFF',
  dust: '#EAF8FF',
  /** Мягкая внутренняя тень вдоль всей кромки — второй, «размытый» контур изнутри. */
  edge: '#15528C',
  /** Плотная «толща» стекла у кромки (полоса фаски). */
  rim: '#57B4EA',
} as const;

export const STONE = {
  light: '#D3D7DD',
  base: '#A3A9B1',
  dark: '#757C86',
  deep: '#59606A',
  outline: '#30353C',
  crack: '#2A2F35',
  crackLight: '#E6E9EC',
  fresh: '#C9CED4',
  dust: '#C9C5BE',
} as const;

export const MATERIALS: Record<Material, MatPalette> = { wood: WOOD, ice: ICE, stone: STONE };

// ───────────────────────── геометрия форм ─────────────────────────

/**
 * Опорный многоугольник формы в спрайт-пространстве (Y вниз, центр bbox в 0).
 * triangle — прямой угол внизу-слева; isoTriangle — основание внизу; circle — 48-угольник.
 * Обход — по часовой на экране (положительная площадь в координатах с Y вниз).
 */
export function shapePoly(shape: BlockShape, w: number, h: number): Pt[] {
  const a = w / 2;
  const b = h / 2;
  switch (shape) {
    case 'triangle':
      return [[-a, -b], [a, b], [-a, b]];
    case 'isoTriangle':
      return [[0, -b], [a, b], [-a, b]];
    case 'circle': {
      const pts: Pt[] = [];
      const n = 48;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU;
        pts.push([Math.cos(t) * a, Math.sin(t) * a]);
      }
      return pts;
    }
    default:
      return [[-a, -b], [a, -b], [a, b], [-a, b]];
  }
}

/** Скруглённый многоугольник (радиус на угол, обрезается по длине рёбер). */
export function roundPoly(pts: readonly Pt[], r: number): Path2D {
  const p = new Path2D();
  const n = pts.length;
  const m0: Pt = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
  p.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const prev = pts[(i + n - 1) % n];
    const l1 = Math.hypot(a[0] - prev[0], a[1] - prev[1]);
    const l2 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const lim = 0.45 * Math.min(l1, l2);
    // острые углы скругляем меньше, чтобы вершина не «съедалась» (силуэт ближе к физике)
    const cosA = ((prev[0] - a[0]) * (b[0] - a[0]) + (prev[1] - a[1]) * (b[1] - a[1])) / (l1 * l2 || 1);
    const half = Math.acos(clamp(cosA, -1, 1)) / 2;
    const k = clamp(Math.sin(half) / Math.SQRT1_2, 0.3, 1);
    p.arcTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.min(r * k, lim));
  }
  p.closePath();
  return p;
}

/** Силуэт формы. r — скругление углов (rect/треугольники). */
export function shapePath(shape: BlockShape, w: number, h: number, r: number): Path2D {
  if (shape === 'circle') {
    const p = new Path2D();
    p.arc(0, 0, w / 2, 0, TAU);
    return p;
  }
  if (shape === 'rect') {
    const p = new Path2D();
    p.roundRect(-w / 2, -h / 2, w, h, Math.min(r, w / 2, h / 2));
    return p;
  }
  return roundPoly(shapePoly(shape, w, h), r);
}

export function polyPath(pts: readonly Pt[]): Path2D {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

/** Внешние нормали рёбер (ребро i: pts[i] → pts[i+1]) для обхода с положительной площадью. */
export function edgeNormals(pts: readonly Pt[]): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    out.push([dy / L, -dx / L]);
  }
  return out;
}

/** Сдвинуть выпуклый многоугольник внутрь на d (пересечение смещённых рёбер). */
export function insetPoly(pts: readonly Pt[], d: number): Pt[] {
  const n = pts.length;
  const N = edgeNormals(pts);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const n1 = N[(i + n - 1) % n];
    const n2 = N[i];
    const k = d / Math.max(0.15, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
    out.push([pts[i][0] - (n1[0] + n2[0]) * k, pts[i][1] - (n1[1] + n2[1]) * k]);
  }
  return out;
}

export function centroid(pts: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

export function pointInPoly(pts: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Освещённость грани с внешней нормалью n: +1 — к свету, −1 — от света. */
export function lit(n: Pt): number {
  return n[0] * LIGHT[0] + n[1] * LIGHT[1];
}

// ───────────────────────── объём: фаски, кромки, внутренние тени ─────────────────────────

/**
 * Фаска по рёбрам многоугольника: каждая грань-трапеция освещается по своей нормали
 * (свет сверху-слева). Градиент от внешнего ребра к внутреннему — мягкий переход.
 */
export function bevelPoly(
  ctx: Ctx2D,
  pts: readonly Pt[],
  b: number,
  light: string,
  dark: string,
  aL: number,
  aD: number,
): void {
  const n = pts.length;
  const inner = insetPoly(pts, b);
  const N = edgeNormals(pts);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const s = lit(N[i]);
    const strength = s >= 0 ? aL * Math.pow(Math.min(1, s / 0.8), 0.7) : aD * Math.pow(Math.min(1, -s / 0.8), 0.7);
    if (strength < 0.02) continue;
    const col = s >= 0 ? light : dark;
    const mx = (pts[i][0] + pts[j][0]) / 2;
    const my = (pts[i][1] + pts[j][1]) / 2;
    const g = ctx.createLinearGradient(mx, my, mx - N[i][0] * b, my - N[i][1] * b);
    g.addColorStop(0, rgba(col, strength));
    g.addColorStop(0.55, rgba(col, strength * 0.8));
    g.addColorStop(1, rgba(col, strength * 0.35));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[j][0], pts[j][1]);
    ctx.lineTo(inner[j][0], inner[j][1]);
    ctx.lineTo(inner[i][0], inner[i][1]);
    ctx.closePath();
    ctx.fill();
  }
}

/** Фаска круга: кольцо шириной b, свет сверху-слева, тень снизу-справа. */
export function bevelCircle(ctx: Ctx2D, R: number, b: number, light: string, dark: string, aL: number, aD: number): void {
  ctx.save();
  const ring = new Path2D();
  ring.arc(0, 0, R + 1, 0, TAU);
  ring.arc(0, 0, R - b, 0, TAU, true);
  ctx.clip(ring);
  const g = ctx.createLinearGradient(R * LIGHT[0], R * LIGHT[1], -R * LIGHT[0], -R * LIGHT[1]);
  g.addColorStop(0, rgba(light, aL));
  g.addColorStop(0.42, rgba(light, 0));
  g.addColorStop(0.58, rgba(dark, 0));
  g.addColorStop(1, rgba(dark, aD));
  ctx.fillStyle = g;
  ctx.fillRect(-R - 1, -R - 1, 2 * R + 2, 2 * R + 2);
  ctx.restore();
}

/**
 * Светлая кромка (рим-лайт) вдоль освещённых рёбер, сразу под обводкой.
 * d — отступ центра линии от края, wd — толщина линии.
 */
export function rimPoly(ctx: Ctx2D, pts: readonly Pt[], d: number, wd: number, color: string, alpha: number, minLit = 0.25): void {
  const n = pts.length;
  const q = insetPoly(pts, d);
  const N = edgeNormals(pts);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = wd;
  for (let i = 0; i < n; i++) {
    const s = lit(N[i]);
    if (s < minLit) continue;
    const j = (i + 1) % n;
    // концы укорачиваем, чтобы кромка не заходила в скругление угла
    const ax = q[i][0];
    const ay = q[i][1];
    const bx = q[j][0];
    const by = q[j][1];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < wd * 2) continue;
    const cut = Math.min(L * 0.18, d * 1.6);
    const ux = (bx - ax) / L;
    const uy = (by - ay) / L;
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    const a = alpha * Math.min(1, s / 0.8);
    g.addColorStop(0, rgba(color, a * 0.55));
    g.addColorStop(0.2, rgba(color, a));
    g.addColorStop(0.8, rgba(color, a));
    g.addColorStop(1, rgba(color, a * 0.55));
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(ax + ux * cut, ay + uy * cut);
    ctx.lineTo(bx - ux * cut, by - uy * cut);
    ctx.stroke();
  }
  ctx.restore();
}

/** Светлая дуга-кромка круга со стороны света. */
export function rimCircle(ctx: Ctx2D, R: number, d: number, wd: number, color: string, alpha: number, span = 1.1): void {
  const a0 = Math.atan2(LIGHT[1], LIGHT[0]);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = wd;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.arc(0, 0, R - d, a0 - span / 2, a0 + span / 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(color, alpha * 0.5);
  ctx.beginPath();
  ctx.arc(0, 0, R - d, a0 - span * 0.85, a0 + span * 0.85);
  ctx.stroke();
  ctx.restore();
}

/**
 * Мягкая внутренняя тень/свет вдоль края пути (через shadowBlur — только при генерации спрайта).
 * (dx, dy) — сдвиг «рамки»: (0.05, 0.05) затемняет края, обращённые вверх-влево… и т.д.
 * blur, dx, dy — в метрах; ppu — пикселей на метр (shadowBlur/offset задаются в пикселях устройства).
 */
export function innerShadow(ctx: Ctx2D, path: Path2D, color: string, blurM: number, dxM: number, dyM: number, ppu: number, ext: number): void {
  const SHIFT = ext * 4 + 10;
  ctx.save();
  ctx.clip(path);
  const frame = new Path2D();
  frame.rect(-ext * 2 - SHIFT, -ext * 2, ext * 4, ext * 4);
  const m = new DOMMatrix().translate(-SHIFT, 0);
  frame.addPath(path, m);
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(0.5, blurM * ppu);
  // смещение тени не масштабируется трансформацией — задаём в пикселях устройства
  const tr = ctx.getTransform();
  const sx = Math.hypot(tr.a, tr.b);
  ctx.shadowOffsetX = (dxM + SHIFT) * sx;
  ctx.shadowOffsetY = dyM * sx;
  ctx.fillStyle = '#000';
  ctx.fill(frame, 'evenodd');
  ctx.restore();
}

// ───────────────────────── трещины и сколы ─────────────────────────

export interface Crack {
  pts: Pt[];
  /** Порядковый номер «главной» трещины (ветки наследуют номер родителя). */
  main: number;
  /** Множитель толщины (ветки тоньше). */
  wk: number;
}

/**
 * Генератор трещин (04 §7.6): старт на случайной кромке, блуждание внутрь, ветвление 1 уровня.
 * grainAngle — направление волокон (для дерева трещина тянется вдоль волокон), null — без притяжения.
 */
export function genCracks(
  rng: () => number,
  poly: readonly Pt[],
  mn: number,
  mx: number,
  count: number,
  segLen: number,
  jitter: number,
  branchP: number,
  grainAngle: number | null,
  grainPull = 0.3,
): Crack[] {
  const cracks: Crack[] = [];
  const n = poly.length;
  const lens: number[] = [];
  let per = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    lens.push(L);
    per += L;
  }
  const [cx, cy] = centroid(poly);
  const walk = (x: number, y: number, a: number, len: number, depth: number, main: number): Pt[] => {
    const pts: Pt[] = [[x, y]];
    let L = 0;
    let steps = 0;
    while (L < len) {
      a += (rng() - 0.5) * 2 * jitter;
      if (grainAngle !== null) {
        // притяжение к ближайшему направлению волокон (вдоль/против)
        let d = a - grainAngle;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        if (d > Math.PI / 2) d -= Math.PI;
        else if (d < -Math.PI / 2) d += Math.PI;
        a -= d * grainPull;
      }
      const s = segLen * lerp(0.6, 1.4, rng());
      x += Math.cos(a) * s;
      y += Math.sin(a) * s;
      L += s;
      steps++;
      pts.push([x, y]);
      if (steps > 2 && !pointInPoly(poly, x, y)) break;
      if (depth < 1 && rng() < branchP) {
        const ba = a + (rng() < 0.5 ? -1 : 1) * lerp(0.5, 1.0, rng());
        cracks.push({ pts: walk(x, y, ba, len * 0.4, depth + 1, main), main, wk: 0.6 });
      }
    }
    return pts;
  };
  for (let i = 0; i < count; i++) {
    // точка на периметре (с весом по длине рёбер), не у самых углов
    let t = rng() * per;
    let e = 0;
    while (e < n - 1 && t > lens[e]) {
      t -= lens[e];
      e++;
    }
    const u = clamp(t / (lens[e] || 1), 0.12, 0.88);
    const a = poly[e];
    const b = poly[(e + 1) % n];
    const x = lerp(a[0], b[0], u);
    const y = lerp(a[1], b[1], u);
    const ang = Math.atan2(cy - y, cx - x) + (rng() - 0.5) * 1.2;
    const len = mn * lerp(0.5, 1.1, rng()) + mx * 0.15 * rng();
    cracks.push({ pts: walk(x, y, ang, len, 0, i), main: i, wk: 1 });
  }
  return cracks;
}

/** Гравированная трещина: освещённая стенка щели (сдвиг вниз-вправо) + тёмная сужающаяся щель. */
export function strokeCrack(ctx: Ctx2D, pts: readonly Pt[], wd: number, dark: string, light: string, off: number): void {
  if (pts.length < 2) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = light;
  ctx.lineWidth = wd * 0.6;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + off, y + off) : ctx.moveTo(x + off, y + off)));
  ctx.stroke();
  ctx.strokeStyle = dark;
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = wd * lerp(1, 0.3, i / (pts.length - 1));
    ctx.beginPath();
    ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
    ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
}

/**
 * Вырезать скол: полигон chip обводится (в клипе формы) «свежим» изломом и обводкой, затем
 * вырезается destination-out. Новая кромка получает обводку толщиной lw, контур не рвётся.
 */
export function cutChip(ctx: Ctx2D, chip: Path2D, shape: Path2D, outline: string, fresh: string, lw: number): void {
  ctx.save();
  ctx.clip(shape);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = fresh;
  ctx.lineWidth = lw * 4.2;
  ctx.stroke(chip);
  ctx.strokeStyle = outline;
  ctx.lineWidth = lw * 2;
  ctx.stroke(chip);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.fill(chip);
  ctx.restore();
}

/** Полигон скола угла corner многоугольника poly (размер size, зазубренная кромка). */
export function cornerChipPath(rng: () => number, poly: readonly Pt[], corner: number, size: number, lw: number): Path2D {
  const n = poly.length;
  const p = poly[corner];
  const prev = poly[(corner + n - 1) % n];
  const next = poly[(corner + 1) % n];
  const u1x = prev[0] - p[0];
  const u1y = prev[1] - p[1];
  const u2x = next[0] - p[0];
  const u2y = next[1] - p[1];
  const L1 = Math.hypot(u1x, u1y);
  const L2 = Math.hypot(u2x, u2y);
  const a = Math.min(size * lerp(0.75, 1.25, rng()), L1 * 0.4);
  const b = Math.min(size * lerp(0.75, 1.25, rng()), L2 * 0.4);
  const e1: Pt = [u1x / L1, u1y / L1];
  const e2: Pt = [u2x / L2, u2y / L2];
  // внешние нормали рёбер угла (наружу от многоугольника)
  const N = edgeNormals(poly);
  const nIn = N[(corner + n - 1) % n];
  const nOut = N[corner];
  const at = (s1: number, s2: number): Pt => [p[0] + e1[0] * s1 + e2[0] * s2, p[1] + e1[1] * s1 + e2[1] * s2];
  const pts: Pt[] = [];
  const A = at(a, 0);
  pts.push([A[0] + nIn[0] * lw * 1.5, A[1] + nIn[1] * lw * 1.5]);
  const k = 3 + Math.floor(rng() * 2);
  for (let i = 1; i < k; i++) {
    const t = i / k;
    // ломаная от точки на ребре 1 к точке на ребре 2, выгнутая внутрь
    const bulge = lerp(0.2, 0.45, rng());
    pts.push(at(a * (1 - t) + a * bulge * Math.sin(Math.PI * t) * 0.6, b * t + b * bulge * Math.sin(Math.PI * t) * 0.6));
  }
  const B = at(0, b);
  pts.push([B[0] + nOut[0] * lw * 1.5, B[1] + nOut[1] * lw * 1.5]);
  // точка за углом снаружи
  const bx = -(e1[0] + e2[0]);
  const by = -(e1[1] + e2[1]);
  const bl = Math.hypot(bx, by) || 1;
  pts.push([p[0] + (bx / bl) * lw * 3, p[1] + (by / bl) * lw * 3]);
  return polyPath(pts);
}

/** Полигон «выкуса» на кромке (для кругов и длинных рёбер). */
export function edgeBitePath(rng: () => number, x: number, y: number, nx: number, ny: number, size: number, lw: number): Path2D {
  // (x, y) — точка на кромке, (nx, ny) — внешняя нормаль
  const tx = -ny;
  const ty = nx;
  const pts: Pt[] = [];
  const k = 6;
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const ang = Math.PI * t;
    const r = size * (i === 0 || i === k ? 1 : lerp(0.65, 1.05, rng()));
    const along = -Math.cos(ang) * r;
    const depth = Math.sin(ang) * r * 0.75;
    pts.push([x + tx * along - nx * depth, y + ty * along - ny * depth]);
  }
  pts.push([x + tx * size + nx * lw * 3, y + ty * size + ny * lw * 3]);
  pts.push([x - tx * size + nx * lw * 3, y - ty * size + ny * lw * 3]);
  return polyPath(pts);
}

// ───────────────────────── шум ─────────────────────────

function valueNoise2D(seed: number, period: number): (x: number, y: number) => number {
  const r = makeRng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0];
    const b = g[y0 * period + x1];
    const c = g[y1 * period + x0];
    const d = g[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Бесшовный fBm-тайл size×size; color(v) → [r, g, b, a]. */
export function noiseTile(
  size: number,
  seed: number,
  cells: number,
  octaves: number,
  color: (v: number) => readonly [number, number, number, number],
): AnyCanvas {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(size, size);
  const ns: Array<(x: number, y: number) => number> = [];
  for (let o = 0; o < octaves; o++) ns.push(valueNoise2D(seed + o * 101, cells << o));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.5;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        const f = (cells << o) / size;
        v += amp * ns[o](x * f, y * f);
        norm += amp;
        amp *= 0.5;
      }
      const p = color(v / norm);
      const i = (y * size + x) * 4;
      img.data[i] = p[0];
      img.data[i + 1] = p[1];
      img.data[i + 2] = p[2];
      img.data[i + 3] = p[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let stoneTileC: AnyCanvas | null = null;
/** Фактура камня (04 §7.5): светлые и тёмные пятна, тайл 128 px = 1 м. */
export function stoneTile(): AnyCanvas {
  if (!stoneTileC) {
    stoneTileC = noiseTile(128, 51, 6, 4, (v) => {
      const t = clamp((v - 0.5) * 2.6, -1, 1);
      return t > 0 ? [255, 255, 255, Math.round(t * 78)] : [24, 28, 36, Math.round(-t * 96)];
    });
  }
  return stoneTileC;
}

let frostTileC: AnyCanvas | null = null;
/** Пятнистое «помутнение» льда: белый с переменной альфой, тайл 128 px = 1 м. */
export function frostTile(): AnyCanvas {
  if (!frostTileC) {
    frostTileC = noiseTile(128, 77, 5, 4, (v) => {
      const t = clamp((v - 0.35) * 1.8, 0, 1);
      return [255, 255, 255, Math.round(70 + t * 185)];
    });
  }
  return frostTileC;
}

/** Залить текущий клип паттерном тайла (tilePx пикселей = metersPerTile метров), со сдвигом. */
export function fillTile(ctx: Ctx2D, tile: AnyCanvas, metersPerTile: number, offX: number, offY: number, x: number, y: number, w: number, h: number): void {
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  const k = metersPerTile / tile.width;
  pat.setTransform(new DOMMatrix().translate(offX, offY).scale(k));
  ctx.fillStyle = pat;
  ctx.fillRect(x, y, w, h);
}

/** Холст под спрайт с центром в середине; контекст переведён в метры (Y вниз). */
export function beginCentered(wM: number, hM: number, padM: number, ppu: number): { c: AnyCanvas; ctx: Ctx2D; ox: number; oy: number } {
  const c = createCanvas((wM + 2 * padM) * ppu, (hM + 2 * padM) * ppu);
  const ctx = ctx2d(c);
  const ox = c.width / 2;
  const oy = c.height / 2;
  ctx.setTransform(ppu, 0, 0, ppu, ox, oy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { c, ctx, ox, oy };
}
