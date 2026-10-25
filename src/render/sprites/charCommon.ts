// Общие хелперы рисования персонажей (птицы и свиньи).
// Всё рисуется в «единицах дизайна»: радиус тела = 1, +x вперёд (вправо), +y вниз.
// Масштаб подобран так, что ВНЕШНИЙ край обводки тела совпадает с физическим кругом.

import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { Sprite } from './api';

export type C = Ctx2D;
export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

/** Параметры масштаба при рисовании. */
export interface Units {
  /** Пикселей холста на единицу дизайна. */
  readonly k: number;
  /** Видимая толщина внешней обводки, ед. */
  readonly out: number;
  /** Один пиксель в единицах дизайна. */
  readonly px: number;
  /** Детализация: 0 — мелко (< 22 px радиуса), 1 — средне, 2 — полно. */
  readonly lod: 0 | 1 | 2;
}

export interface SpriteDraft {
  readonly canvas: AnyCanvas;
  readonly c: C;
  readonly u: Units;
}

/** Видимая обводка ≈ 0.07 r (02 §0, 04 §1), но не тоньше 1.3 px. */
const OUT_MIN_PX = 1.3;

/**
 * Создать квадратный холст со стороной 2·extent·rPx (+ запас) и перевести контекст в единицы дизайна.
 * extent — полуразмер холста в радиусах тела.
 */
export function beginSprite(rPx: number, extent: number, outBase = 0.078): SpriteDraft {
  const r = Math.max(rPx, 2);
  const out = Math.max(outBase, OUT_MIN_PX / r);
  const k = r / (1 + out);
  const pad = 2;
  const size = Math.ceil(2 * extent * r) + 2 * pad;
  const canvas = createCanvas(size, size);
  const c = ctx2d(canvas);
  c.translate(size / 2, size / 2);
  c.scale(k, k);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const lod: 0 | 1 | 2 = r < 22 ? 0 : r < 46 ? 1 : 2;
  return { canvas, c, u: { k, out, px: 1 / k, lod } };
}

export function finishSprite(d: SpriteDraft, ppu: number): Sprite {
  return { canvas: d.canvas, ox: d.canvas.width / 2, oy: d.canvas.height / 2, ppu };
}

/** Толщина линии с нижней границей в пикселях. */
export function lw(u: Units, w: number, minPx = 1): number {
  return Math.max(w, minPx * u.px);
}

// ───────────────────────── цвета ─────────────────────────

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** hex → rgba(...) с прозрачностью. */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

/** Смешать два hex-цвета (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  const ch = (i: number) => Math.round(A[i] + (B[i] - A[i]) * t).toString(16).padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

// ───────────────────────── пути ─────────────────────────

export function ellipsePath(c: C, x: number, y: number, rx: number, ry: number, rot = 0): void {
  c.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
}

export function circlePath(c: C, x: number, y: number, r: number): void {
  c.moveTo(x + r, y);
  c.arc(x, y, r, 0, TAU);
}

/** Многоугольник со скруглёнными углами (радиус на каждую вершину). */
export function roundPolyPath(c: C, pts: ReadonlyArray<readonly [number, number]>, radii: readonly number[]): void {
  const n = pts.length;
  const last = pts[n - 1];
  const first = pts[0];
  c.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    c.arcTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, radii[i]);
  }
  c.closePath();
}

/** Замкнутый контур по точкам, сглаженный квадратичными кривыми через середины отрезков. */
export function smoothClosedPath(c: C, pts: ReadonlyArray<readonly [number, number]>): void {
  const n = pts.length;
  const mid = (i: number): [number, number] => {
    const a = pts[i % n];
    const b = pts[(i + 1) % n];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };
  const m0 = mid(0);
  c.moveTo(m0[0], m0[1]);
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n];
    const m = mid(i);
    c.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  c.closePath();
}

// ───────────────────────── перья ─────────────────────────

/** Перо: основание (x, y), направление a (градусы canvas: 0 — вправо, 90 — вниз), длина, макс. полуширина, изгиб (доля длины, + — по часовой). */
export interface Feather {
  x: number;
  y: number;
  a: number;
  len: number;
  w: number;
  bend?: number;
}

function featherFrame(f: Feather) {
  const ang = f.a * DEG;
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const bend = f.bend ?? 0;
  const at = (t: number, side: number, wScale = 1) => {
    // ось — парабола: u вдоль, v поперёк
    const uu = f.len * t;
    const vv = bend * f.len * 4 * t * (1 - t);
    // касательная
    const du = f.len;
    const dv = bend * f.len * 4 * (1 - 2 * t);
    const dl = Math.hypot(du, dv) || 1;
    const nu = -dv / dl;
    const nv = du / dl;
    const prof = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.85);
    const w = f.w * prof * side * wScale;
    const lu = uu + nu * w;
    const lv = vv + nv * w;
    return [f.x + lu * cs - lv * sn, f.y + lu * sn + lv * cs] as const;
  };
  return at;
}

/** Контур пера (капля с изогнутой осью). */
export function featherPath(c: C, f: Feather, wScale = 1): void {
  const at = featherFrame(f);
  const N = 22;
  c.moveTo(f.x, f.y);
  for (let i = 1; i <= N; i++) {
    const p = at(i / N, 1, wScale);
    c.lineTo(p[0], p[1]);
  }
  for (let i = N - 1; i >= 0; i--) {
    const p = at(i / N, -1, wScale);
    c.lineTo(p[0], p[1]);
  }
  c.closePath();
}

/** Осевая линия пера от t0 до t1. */
export function featherAxis(c: C, f: Feather, t0: number, t1: number, side = 0): void {
  const at = featherFrame(f);
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const p = at(t, side === 0 ? 0 : side, 0.45);
    if (i === 0) c.moveTo(p[0], p[1]);
    else c.lineTo(p[0], p[1]);
  }
}

/** Кончик пера. */
export function featherTip(f: Feather): [number, number] {
  const p = featherFrame(f)(1, 0);
  return [p[0], p[1]];
}

/** Заливка пера с объёмом: градиент основание → кончик, блик-стержень. */
export function fillFeather(c: C, u: Units, f: Feather, root: string, tip: string, vein: string | null): void {
  const [tx, ty] = featherTip(f);
  const g = c.createLinearGradient(f.x, f.y, tx, ty);
  g.addColorStop(0, root);
  g.addColorStop(0.55, mix(root, tip, 0.45));
  g.addColorStop(1, tip);
  c.beginPath();
  featherPath(c, f);
  c.fillStyle = g;
  c.fill();
  if (vein && u.lod > 0) {
    c.beginPath();
    featherAxis(c, f, 0.12, 0.8, -1);
    c.strokeStyle = vein;
    c.lineWidth = lw(u, f.w * 0.22, 0.8);
    c.stroke();
  }
}

// ───────────────────────── объём ─────────────────────────

/** Радиальный градиент тела со светом сверху-слева. */
export function bodyGradient(
  c: C,
  cx: number,
  cy: number,
  R: number,
  light: string,
  base: string,
  dark: string,
): CanvasGradient {
  const g = c.createRadialGradient(cx - 0.36 * R, cy - 0.46 * R, 0.04 * R, cx - 0.1 * R, cy - 0.12 * R, 1.28 * R);
  g.addColorStop(0, light);
  g.addColorStop(0.5, base);
  g.addColorStop(1, dark);
  return g;
}

/**
 * Внутренняя тень/свет вдоль края фигуры (мягкая, через shadowBlur «рамки» вокруг фигуры).
 * (dx, dy) — куда сдвинуть рамку: (0, −0.1) даёт полосу по НИЖНЕМУ краю.
 */
export function innerShadow(
  c: C,
  u: Units,
  path: (c: C) => void,
  color: string,
  blur: number,
  dx: number,
  dy: number,
): void {
  const SHIFT = 30;
  c.save();
  c.beginPath();
  path(c);
  c.clip();
  // рамку уводим далеко за холст, а тень возвращаем смещением — сама рамка не оставит кромки
  c.translate(-SHIFT, 0);
  c.beginPath();
  c.rect(-6, -6, 12, 12);
  path(c);
  c.shadowColor = color;
  c.shadowBlur = Math.max(0.5, blur * u.k);
  c.shadowOffsetX = (dx + SHIFT) * u.k;
  c.shadowOffsetY = dy * u.k;
  c.fillStyle = '#000';
  c.fill('evenodd');
  c.restore();
}

/** Мягкое пятно (румянец, синяк, блик) — эллипс с радиальным градиентом. */
export function softBlob(
  c: C,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  alpha: number,
  rot = 0,
  hard = 0.35,
): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(hard, rgba(color, alpha * 0.85));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, rx, 0, TAU);
  c.fill();
  c.restore();
}

/** Глянцевый блик: мягкое пятно + маленькая резкая точка. */
export function gloss(c: C, u: Units, x: number, y: number, rx: number, ry: number, rot: number, alpha: number, dot = true): void {
  softBlob(c, x, y, rx, ry, '#ffffff', alpha, rot, 0.45);
  if (dot && u.lod > 0) {
    const dx = x + rx * 0.75 * Math.cos(rot - 0.9);
    const dy = y - ry * 1.4;
    c.beginPath();
    ellipsePath(c, dx, dy, Math.max(rx * 0.2, 1.1 * u.px), Math.max(ry * 0.32, 1.1 * u.px), rot);
    c.fillStyle = `rgba(255,255,255,${Math.min(1, alpha + 0.3).toFixed(3)})`;
    c.fill();
  }
}

/** Набор параметров объёмной заливки тела. */
export interface BodyShade {
  light: string;
  base: string;
  dark: string;
  /** Цвет собственной тени (обычно затемнённый base). */
  shadow: string;
  /** Отражённый свет снизу. */
  bounce: string;
  /** Сила рим-лайта сверху-слева (0..1). */
  rim: number;
  /** Центр и радиус для градиента. */
  cx: number;
  cy: number;
  R: number;
}

/**
 * Залить тело с объёмом: градиент, затем внутри клипа — under() (брюшко и т.п.),
 * собственная тень снизу-справа, внутренняя тень по нижнему краю, отражённый свет и рим-лайт.
 */
export function shadeBody(c: C, u: Units, path: (c: C) => void, s: BodyShade, under?: (c: C) => void): void {
  c.beginPath();
  path(c);
  c.fillStyle = bodyGradient(c, s.cx, s.cy, s.R, s.light, s.base, s.dark);
  c.fill();
  c.save();
  c.beginPath();
  path(c);
  c.clip();
  if (under) under(c);
  // собственная тень: затемнение к низу-справа
  const g = c.createRadialGradient(s.cx - 0.3 * s.R, s.cy - 0.42 * s.R, 0.55 * s.R, s.cx - 0.3 * s.R, s.cy - 0.42 * s.R, 1.6 * s.R);
  g.addColorStop(0, rgba(s.shadow, 0));
  g.addColorStop(1, rgba(s.shadow, 0.34));
  c.fillStyle = g;
  c.fillRect(s.cx - 2 * s.R, s.cy - 2 * s.R, 4 * s.R, 4 * s.R);
  c.restore();
  // внутренняя тень по нижнему краю
  innerShadow(c, u, path, rgba(s.shadow, 0.4), 0.2 * s.R, -0.04 * s.R, -0.12 * s.R);
  // отражённый свет — тонкая светлая кромка снизу
  if (u.lod > 0) innerShadow(c, u, path, rgba(s.bounce, 0.4), 0.05 * s.R, 0.01 * s.R, -0.035 * s.R);
  // рим-лайт сверху-слева
  if (s.rim > 0) innerShadow(c, u, path, `rgba(255,255,255,${s.rim.toFixed(3)})`, 0.07 * s.R, 0.035 * s.R, 0.05 * s.R);
}

/** Обвести набор путей единой толстой обводкой (проход 1 «двухпроходной» техники). */
export function outlinePass(c: C, u: Units, color: string, paths: Array<(c: C) => void>): void {
  c.strokeStyle = color;
  c.lineWidth = 2 * u.out;
  for (const p of paths) {
    c.beginPath();
    p(c);
    c.stroke();
  }
}

// ───────────────────────── глаза ─────────────────────────

export type EyeMode = 'open' | 'closed' | 'spiral' | 'cross' | 'squeeze';

export interface EyeDraw {
  x: number;
  y: number;
  rx: number;
  ry: number;
  rot?: number;
  /** Направление к переносице по X: +1 — вправо, −1 — влево. */
  inner: number;
  mode: EyeMode;
  /** Доля закрытия верхним веком 0..1 (по центру глаза). */
  lid?: number;
  /** Наклон линии века, рад; > 0 — внутренний угол ниже (злость), < 0 — выше (грусть). */
  lidTilt?: number;
  /** Нижнее веко (прищур) 0..1. */
  lowerLid?: number;
  pupilR: number;
  /** Смещение зрачка в долях свободного хода (−1..1). */
  lookX?: number;
  lookY?: number;
  iris?: string;
  irisR?: number;
  pupil?: string;
  /** Цвет кожи века: светлый и основной. */
  lidLight: string;
  lidBase: string;
  /** Цвет кромки века и обводки глаза. */
  line: string;
  lineW: number;
  /** Тень на белке по краю. */
  shade?: string;
  /** Ресницы: число и цвет. */
  lashes?: number;
  lashColor?: string;
}

function eyePath(e: EyeDraw) {
  return (c: C) => ellipsePath(c, e.x, e.y, e.rx, e.ry, e.rot ?? 0);
}

/** Детализированный глаз: белок с градиентом, зрачок с бликами, веко, обводка. */
export function drawEye(c: C, u: Units, e: EyeDraw): void {
  const path = eyePath(e);
  const lineW = lw(u, e.lineW, 1);
  const { x, y, rx, ry } = e;

  if (e.mode === 'squeeze') {
    // зажмуренный глаз «> <»: галочка остриём к переносице, светлый ореол — чтобы читалась на тёмном теле
    const xi = x + e.inner * rx * 0.62;
    const xo = x - e.inner * rx * 0.62;
    const h = ry * 0.5;
    const chevron = (cc: C) => {
      cc.moveTo(xo, y - h);
      cc.quadraticCurveTo(x, y - h * 0.3, xi, y + ry * 0.04);
      cc.quadraticCurveTo(x, y + h * 0.4, xo, y + h);
    };
    const m = Math.min(rx, ry);
    c.beginPath();
    chevron(c);
    c.strokeStyle = e.lidLight;
    c.lineWidth = lw(u, m * 0.52, 2.2);
    c.stroke();
    c.beginPath();
    chevron(c);
    c.strokeStyle = e.line;
    c.lineWidth = lw(u, m * 0.27, 1.2);
    c.stroke();
    return;
  }

  if (e.mode === 'closed') {
    // закрытый глаз: веко целиком + линия смыкания
    const g = c.createLinearGradient(0, y - ry, 0, y + ry);
    g.addColorStop(0, e.lidLight);
    g.addColorStop(1, e.lidBase);
    c.beginPath();
    path(c);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = e.line;
    c.lineWidth = lineW;
    c.stroke();
    const tilt = Math.tan(e.lidTilt ?? 0) * e.inner;
    c.beginPath();
    c.moveTo(x - rx * 0.92, y + ry * 0.05 - tilt * rx * 0.9);
    c.quadraticCurveTo(x, y + ry * 0.62, x + rx * 0.92, y + ry * 0.05 + tilt * rx * 0.9);
    c.lineWidth = lw(u, e.lineW * 1.5, 1.1);
    c.stroke();
    drawLashes(c, u, e, 0.35);
    return;
  }

  // белок
  const wg = c.createRadialGradient(x - rx * 0.25, y - ry * 0.05, 0, x, y, Math.max(rx, ry) * 1.08);
  wg.addColorStop(0, '#ffffff');
  wg.addColorStop(0.62, '#f7f9fb');
  wg.addColorStop(1, e.shade ?? '#c9d3de');
  c.beginPath();
  path(c);
  c.fillStyle = wg;
  c.fill();

  c.save();
  c.beginPath();
  path(c);
  c.clip();
  if (u.lod > 0) {
    // тень сверху (глаз «утоплен» под бровью)
    const tg = c.createLinearGradient(0, y - ry, 0, y - ry * 0.15);
    tg.addColorStop(0, 'rgba(50,40,70,0.32)');
    tg.addColorStop(1, 'rgba(50,40,70,0)');
    c.fillStyle = tg;
    c.fillRect(x - rx - 0.1, y - ry - 0.1, 2 * rx + 0.2, ry * 0.95 + 0.1);
  }

  if (e.mode === 'open') {
    const pr = e.pupilR;
    const ir = e.iris ? (e.irisR ?? pr * 1.7) : pr;
    const px = x + (e.lookX ?? 0) * Math.max(0, rx - ir * 0.85);
    const py = y + (e.lookY ?? 0) * Math.max(0, ry - ir * 0.85);
    if (e.iris) {
      const ig = c.createRadialGradient(px - ir * 0.3, py - ir * 0.35, ir * 0.1, px, py, ir);
      ig.addColorStop(0, mix(e.iris, '#ffffff', 0.35));
      ig.addColorStop(0.7, e.iris);
      ig.addColorStop(1, mix(e.iris, '#000000', 0.45));
      c.beginPath();
      circlePath(c, px, py, ir);
      c.fillStyle = ig;
      c.fill();
    }
    const pg = c.createRadialGradient(px - pr * 0.35, py - pr * 0.4, pr * 0.05, px, py, pr);
    pg.addColorStop(0, '#4a4650');
    pg.addColorStop(0.55, e.pupil ?? '#151417');
    pg.addColorStop(1, '#050506');
    c.beginPath();
    circlePath(c, px, py, pr);
    c.fillStyle = pg;
    c.fill();
    // блики в зрачке: крупный сверху-слева и маленький снизу-справа
    const hr = Math.max(Math.max(pr, ir) * 0.36, 0.9 * u.px);
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath();
    circlePath(c, px - Math.max(pr, ir) * 0.38, py - Math.max(pr, ir) * 0.4, hr);
    c.fill();
    if (u.lod > 0) {
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.beginPath();
      circlePath(c, px + Math.max(pr, ir) * 0.42, py + Math.max(pr, ir) * 0.38, hr * 0.45);
      c.fill();
    }
  } else if (e.mode === 'spiral') {
    const R = Math.min(rx, ry) * 0.86;
    const turns = 2.3;
    c.beginPath();
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const ang = t * turns * TAU - Math.PI / 2;
      const rr = R * t;
      const qx = x + Math.cos(ang) * rr * (rx / Math.min(rx, ry));
      const qy = y + Math.sin(ang) * rr * (ry / Math.min(rx, ry));
      if (i === 0) c.moveTo(qx, qy);
      else c.lineTo(qx, qy);
    }
    c.strokeStyle = '#1b1416';
    c.lineWidth = lw(u, Math.min(rx, ry) * 0.17, 1);
    c.stroke();
  }

  // верхнее веко
  const lid = e.lid ?? 0;
  if (lid > 0.001 && e.mode === 'open') {
    const tilt = Math.tan(e.lidTilt ?? 0) * e.inner;
    const yl = y - ry + 2 * ry * lid;
    const x0 = x - rx - 0.05;
    const x1 = x + rx + 0.05;
    const lidShape = (cc: C) => {
      cc.moveTo(x0, y - ry - 0.3);
      cc.lineTo(x1, y - ry - 0.3);
      cc.lineTo(x1, yl + tilt * (x1 - x));
      cc.quadraticCurveTo(x, yl + ry * 0.12, x0, yl + tilt * (x0 - x));
      cc.closePath();
    };
    const lg = c.createLinearGradient(0, y - ry, 0, yl + ry * 0.1);
    lg.addColorStop(0, e.lidLight);
    lg.addColorStop(1, e.lidBase);
    c.save();
    if (u.lod > 0) {
      c.shadowColor = 'rgba(30,10,20,0.35)';
      c.shadowBlur = Math.max(0.5, ry * 0.25 * u.k);
      c.shadowOffsetY = ry * 0.08 * u.k;
    }
    c.beginPath();
    lidShape(c);
    c.fillStyle = lg;
    c.fill();
    c.restore();
    c.beginPath();
    c.moveTo(x0, yl + tilt * (x0 - x));
    c.quadraticCurveTo(x, yl + ry * 0.12, x1, yl + tilt * (x1 - x));
    c.strokeStyle = e.line;
    c.lineWidth = lw(u, e.lineW * 1.25, 1);
    c.stroke();
  }
  // нижнее веко (прищур)
  const lo = e.lowerLid ?? 0;
  if (lo > 0.001 && e.mode === 'open') {
    const yl = y + ry - 2 * ry * lo;
    const x0 = x - rx - 0.05;
    const x1 = x + rx + 0.05;
    c.beginPath();
    c.moveTo(x0, y + ry + 0.3);
    c.lineTo(x1, y + ry + 0.3);
    c.lineTo(x1, yl);
    c.quadraticCurveTo(x, yl - ry * 0.15, x0, yl);
    c.closePath();
    c.fillStyle = e.lidBase;
    c.fill();
    c.beginPath();
    c.moveTo(x0, yl);
    c.quadraticCurveTo(x, yl - ry * 0.15, x1, yl);
    c.strokeStyle = e.line;
    c.lineWidth = lw(u, e.lineW, 0.9);
    c.stroke();
  }
  c.restore();

  // обводка глаза
  c.beginPath();
  path(c);
  c.strokeStyle = e.line;
  c.lineWidth = lineW;
  c.stroke();

  if (e.mode === 'cross') {
    const s = Math.min(rx, ry) * 0.62;
    c.beginPath();
    c.moveTo(x - s, y - s);
    c.lineTo(x + s, y + s);
    c.moveTo(x + s, y - s);
    c.lineTo(x - s, y + s);
    c.strokeStyle = '#1b1416';
    c.lineWidth = lw(u, Math.min(rx, ry) * 0.24, 1.1);
    c.stroke();
  }
  drawLashes(c, u, e, lid);
}

/** Ресницы у наружного края глаза. */
function drawLashes(c: C, u: Units, e: EyeDraw, lid: number): void {
  const n = e.lashes ?? 0;
  if (n <= 0 || u.lod === 0) return;
  const outer = -e.inner;
  c.strokeStyle = e.lashColor ?? e.line;
  c.lineWidth = lw(u, e.lineW * 0.95, 0.9);
  for (let i = 0; i < n; i++) {
    // точка на верхне-наружной дуге глаза
    const t = (-90 + outer * (35 + i * 22)) * DEG;
    const yShift = 2 * e.ry * Math.min(lid, 0.4) * 0.5;
    const bx = e.x + Math.cos(t) * e.rx;
    const by = e.y + Math.sin(t) * e.ry + yShift;
    const len = e.ry * (0.42 - i * 0.06);
    const dir = t - outer * 0.25;
    c.beginPath();
    c.moveTo(bx, by);
    c.quadraticCurveTo(
      bx + Math.cos(dir) * len * 0.6,
      by + Math.sin(dir) * len * 0.6 - len * 0.1,
      bx + Math.cos(dir + outer * 0.35) * len,
      by + Math.sin(dir + outer * 0.35) * len,
    );
    c.stroke();
  }
}

// ───────────────────────── брови ─────────────────────────

/**
 * Бровь-мазок от A к B: толщина wA → wB, выгиб arch (+ — вверх), заливка с мягким бликом по верхней кромке.
 */
export function browStroke(
  c: C,
  u: Units,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  wA: number,
  wB: number,
  arch: number,
  color: string,
  hi: string | null,
): void {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const L = Math.hypot(dx, dy) || 1;
  // нормаль «вверх» (для A слева от B)
  let nx = dy / L;
  let ny = -dx / L;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = mx + nx * arch * 2;
  const cy = my + ny * arch * 2;
  const N = 14;
  const top: Array<[number, number]> = [];
  const bot: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px = (1 - t) * (1 - t) * ax + 2 * t * (1 - t) * cx + t * t * bx;
    const py = (1 - t) * (1 - t) * ay + 2 * t * (1 - t) * cy + t * t * by;
    const tx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx);
    const ty = 2 * (1 - t) * (cy - ay) + 2 * t * (by - cy);
    const tl = Math.hypot(tx, ty) || 1;
    let qx = -ty / tl;
    let qy = tx / tl;
    if (qy > 0) {
      qx = -qx;
      qy = -qy;
    }
    // скругление концов: ширина чуть сужается к краям
    const taper = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, Math.max(0, t * 0.92 + 0.04)));
    const w = (wA + (wB - wA) * t) * taper * 0.5;
    top.push([px + qx * w, py + qy * w]);
    bot.push([px - qx * w, py - qy * w]);
  }
  c.beginPath();
  c.moveTo(top[0][0], top[0][1]);
  for (const p of top) c.lineTo(p[0], p[1]);
  for (let i = bot.length - 1; i >= 0; i--) c.lineTo(bot[i][0], bot[i][1]);
  c.closePath();
  const g = c.createLinearGradient(mx + nx * 0.1, my + ny * 0.1, mx - nx * 0.1, my - ny * 0.1);
  g.addColorStop(0, mix(color, '#ffffff', 0.12));
  g.addColorStop(1, color);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = color;
  c.lineWidth = lw(u, Math.min(wA, wB) * 0.25, 0.6);
  c.stroke();
  if (hi && u.lod > 0) {
    c.beginPath();
    for (let i = 2; i <= N - 2; i++) {
      const p = top[i];
      const q = bot[i];
      const hx = p[0] * 0.78 + q[0] * 0.22;
      const hy = p[1] * 0.78 + q[1] * 0.22;
      if (i === 2) c.moveTo(hx, hy);
      else c.lineTo(hx, hy);
    }
    c.strokeStyle = hi;
    c.lineWidth = lw(u, Math.min(wA, wB) * 0.18, 0.7);
    c.stroke();
  }
}

/** Параметры моноброви. */
export interface VBrowOpts {
  /** Блик по верхней кромке (α не больше 0.08). */
  hi?: string | null;
  /** Светлая кайма снаружи — для тёмных тел. */
  rim?: string | null;
  /** Толщина линии каймы. */
  rimW?: number;
  /** Число «зубцов» шерсти по верхней кромке. */
  teeth?: number;
  /** Высота зубцов. */
  teethH?: number;
  /** Прогиб нижней кромки вниз в середине каждого пролёта (бровь «вгрызается» в глаз). */
  bow?: number;
}

/**
 * Сплошная «V»-бровь (монобровь): верхняя кромка L→M→R.
 * Толщина thEnd на концах → thMid в центре, концы скруглены, нижняя кромка прогнута к глазам.
 */
export function vBrow(
  c: C,
  u: Units,
  L: readonly [number, number],
  M: readonly [number, number],
  R: readonly [number, number],
  thEnd: number,
  thMid: number,
  color: string,
  o: VBrowOpts = {},
): void {
  const N = 16;
  const bow = o.bow ?? 0.03;
  const teeth = o.teeth ?? 0;
  const teethH = o.teethH ?? 0.05;
  const top: Array<[number, number]> = [];
  const bot: Array<[number, number]> = [];
  const widths: number[] = [];
  // пролёт A→B: верх — квадратичная кривая с лёгким выгибом вверх; s — доля пути к центру M
  const span = (A: readonly [number, number], B: readonly [number, number], toMid: boolean, g0: number) => {
    const cx = (A[0] + B[0]) / 2;
    const cy = (A[1] + B[1]) / 2 - 0.02;
    for (let i = 0; i <= N; i++) {
      if (!toMid && i === 0) continue; // точка M уже добавлена
      const t = i / N;
      const px = (1 - t) * (1 - t) * A[0] + 2 * t * (1 - t) * cx + t * t * B[0];
      let py = (1 - t) * (1 - t) * A[1] + 2 * t * (1 - t) * cy + t * t * B[1];
      const s = toMid ? t : 1 - t;
      const w = thEnd + (thMid - thEnd) * s * (2 - s);
      const lower = py + w + bow * 4 * t * (1 - t);
      if (teeth > 0) {
        // зубцы шерсти: острие смещено к внешнему концу брови
        const g = g0 + t * 0.5;
        if (g > 0.05 && g < 0.95) {
          const f = ((g - 0.05) / 0.9) * teeth;
          const ph = f - Math.floor(f);
          const peak = g < 0.5 ? 0.32 : 0.68;
          const tri = ph < peak ? ph / peak : (1 - ph) / (1 - peak);
          py -= teethH * Math.pow(tri, 1.6) * Math.min(1, (thEnd + (thMid - thEnd) * s) / thMid + 0.2);
        }
      }
      top.push([px, py]);
      bot.push([px, lower]);
      widths.push(w);
    }
  };
  span(L, M, true, 0);
  span(M, R, false, 0.5);
  const n = top.length;
  const cap = (a: [number, number], b: [number, number], nb: [number, number], w: number) => {
    // скругление конца: контрольная точка вынесена наружу по касательной
    const dx = a[0] - nb[0];
    const dy = a[1] - nb[1];
    const dl = Math.hypot(dx, dy) || 1;
    return [(a[0] + b[0]) / 2 + (dx / dl) * w * 0.95, (a[1] + b[1]) / 2 + (dy / dl) * w * 0.95] as const;
  };
  const path = (cc: C) => {
    cc.moveTo(top[0][0], top[0][1]);
    for (let i = 1; i < n; i++) cc.lineTo(top[i][0], top[i][1]);
    const cr = cap(top[n - 1], bot[n - 1], top[n - 2], widths[n - 1]);
    cc.quadraticCurveTo(cr[0], cr[1], bot[n - 1][0], bot[n - 1][1]);
    for (let i = n - 2; i >= 0; i--) cc.lineTo(bot[i][0], bot[i][1]);
    const cl = cap(top[0], bot[0], top[1], widths[0]);
    cc.quadraticCurveTo(cl[0], cl[1], top[0][0], top[0][1]);
    cc.closePath();
  };
  if (o.rim) {
    // светлая кайма — чтобы бровь читалась на тёмном теле
    c.beginPath();
    path(c);
    c.strokeStyle = o.rim;
    c.lineWidth = lw(u, o.rimW ?? 0.035, 1);
    c.stroke();
  }
  const yTop = Math.min(L[1], M[1], R[1]) - teethH;
  const yBot = Math.max(L[1], M[1], R[1]) + thMid + bow;
  const g = c.createLinearGradient(0, yTop, 0, yBot);
  g.addColorStop(0, mix(color, '#ffffff', 0.1));
  g.addColorStop(0.45, color);
  g.addColorStop(1, mix(color, '#000000', 0.3));
  c.beginPath();
  path(c);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = color;
  c.lineWidth = lw(u, 0.03, 0.8);
  c.stroke();
  if (o.hi && u.lod > 0) {
    // тонкий блик вдоль верхней кромки (не «полоса пластика»)
    c.beginPath();
    for (let i = 2; i < n - 2; i++) {
      const hx = top[i][0];
      const hy = top[i][1] + widths[i] * 0.22;
      if (i === 2) c.moveTo(hx, hy);
      else c.lineTo(hx, hy);
    }
    c.strokeStyle = o.hi;
    c.lineWidth = lw(u, thEnd * 0.22, 0.7);
    c.stroke();
  }
}
