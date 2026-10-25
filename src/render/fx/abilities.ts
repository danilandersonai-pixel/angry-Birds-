// Фирменные эффекты способностей (ревью «у всех птиц одно облачко»; AB2: у каждой способности свой визуальный удар).
// Здесь — то, что рисуется вдоль пути птицы после способности: путь берётся из следа (отметка способности — крупная
// точка в месте события, дальше точки каждые 0.45 м пути до первого контакта), кончик следа — птица (отстаёт ≤ 0.45 м).
//  • Чак — 3 жёлтых полупрозрачных «призрака» за кончиком и белые линии скорости (0.4 с);
//  • Хэл — зелёная дуга-свист по пути разворота с двумя тонкими линиями по бокам (0.7 с);
//  • Сильвер — белая лента по петле (толстый след вместо точек) и линии скорости на верхней точке петли (1.2 с);
//  • Матильда — белый шлейф падающего яйца (кинематика яйца: vy₀ = EGG_VY_K·V_MAX, g = 15).
// Всё — векторные пути сплошным цветом (без градиентов и спрайтов: атлас частиц не допекается в кадре).

import { ABILITY, LAUNCH } from '../../config/constants';
import type { TrailPoint } from '../../core/api';
import type { BirdType } from '../../core/types';
import type { ViewInfo } from '../view';
import { clamp, smoothstep, TAU } from './math';
import { BIRD_FX } from './palette';

export interface AbilFx {
  readonly bird: BirdType;
  /** Точка способности (совпадает с отметкой в следе). */
  readonly x: number;
  readonly y: number;
  t: number;
  readonly life: number;
  /** Индекс отметки способности в следе (−1 — не найдена). */
  idx: number;
  /** Последний индекс пути ленты/дуги (−1 — путь ещё растёт). */
  end: number;
  /** Сильвер: индекс верхней точки петли и момент её прохода (−1 — ещё нет). */
  peakIdx: number;
  peakT: number;
  /** Матильда: яйцо долетело (взрыв/земля) — шлейф гаснет. */
  eggDone: boolean;
  /** Чак: длина следа в прошлом кадре и когда он последний раз рос (след стоит — птица ударилась). */
  lastN: number;
  moveT: number;
  readonly seed: number;
}

/** Длительность эффекта по птице, с. */
export const ABIL_LIFE: Partial<Record<BirdType, number>> = { chuck: 0.4, hal: 0.7, silver: 1.2, matilda: 0.35 };
/** Когда путь ленты перестаёт расти: разворот Хэла ≈ 0.4 с, петля Сильвер 2π/ω ≈ 0.57 с. */
const FREEZE: Partial<Record<BirdType, number>> = { hal: 0.45, silver: (TAU / ABILITY.SILVER.OMEGA) * 1.04 };

/** Скорость яйца Матильды при сбросе, м/с (вниз). */
export const EGG_V0 = -ABILITY.MATILDA.EGG_VY_K * LAUNCH.V_MAX;
const G = 15;

export function newAbil(bird: BirdType, x: number, y: number): AbilFx | null {
  const life = ABIL_LIFE[bird];
  if (life === undefined) return null;
  return { bird, x, y, t: 0, life, idx: -1, end: -1, peakIdx: -1, peakT: -1, eggDone: false, lastN: -1, moveT: 0, seed: Math.random() * 1000 };
}

/** Найти отметку способности в следе (кэш a.idx проверяется каждый кадр: след может сдвинуться при переполнении). */
export function findMark(trail: readonly TrailPoint[], a: AbilFx): number {
  const ok = (i: number) => {
    const p = trail[i];
    return p !== undefined && p.big && Math.abs(p.x - a.x) < 1e-3 && Math.abs(p.y - a.y) < 1e-3;
  };
  if (a.idx >= 0 && ok(a.idx)) return a.idx;
  for (let i = trail.length - 1; i >= 0; i--) if (ok(i)) return (a.idx = i);
  return (a.idx = -1);
}

// ── Путь: сглаженная ломаная следа (Катмулл — Ром ×3), длины дуг ─────────────────────────────

const SUB = 3;
let px = new Float64Array(256);
let py = new Float64Array(256);
let ps = new Float64Array(256);
let pn = 0;

function ensure(n: number): void {
  if (px.length >= n) return;
  const m = Math.max(n, px.length * 2);
  px = new Float64Array(m);
  py = new Float64Array(m);
  ps = new Float64Array(m);
}

/** Построить сглаженный путь по точкам следа i0..i1 (мир, м) в px/py, длины дуг — в ps. */
function buildPath(tr: readonly TrailPoint[], i0: number, i1: number): void {
  const n = i1 - i0 + 1;
  pn = 0;
  if (n < 2) return;
  ensure((n - 1) * SUB + 1);
  for (let i = i0; i < i1; i++) {
    const p0 = tr[Math.max(i0, i - 1)];
    const p1 = tr[i];
    const p2 = tr[i + 1];
    const p3 = tr[Math.min(i1, i + 2)];
    for (let k = 0; k < SUB; k++) {
      const u = k / SUB;
      const u2 = u * u;
      const u3 = u2 * u;
      // Катмулл — Ром (равномерный)
      const b0 = -0.5 * u3 + u2 - 0.5 * u;
      const b1 = 1.5 * u3 - 2.5 * u2 + 1;
      const b2 = -1.5 * u3 + 2 * u2 + 0.5 * u;
      const b3 = 0.5 * u3 - 0.5 * u2;
      px[pn] = b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x;
      py[pn] = b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y;
      pn++;
    }
  }
  px[pn] = tr[i1].x;
  py[pn] = tr[i1].y;
  pn++;
  ps[0] = 0;
  for (let i = 1; i < pn; i++) ps[i] = ps[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]);
}

/** Точка пути на расстоянии d назад от конца (м) и касательная вперёд. false — путь короче d. */
function backAt(d: number, out: { x: number; y: number; tx: number; ty: number }): boolean {
  if (pn < 2) return false;
  const total = ps[pn - 1];
  const s = total - d;
  if (s < 0) return false;
  let i = pn - 1;
  while (i > 0 && ps[i - 1] > s) i--;
  const j = Math.max(1, i);
  const seg = ps[j] - ps[j - 1] || 1;
  const k = clamp((s - ps[j - 1]) / seg, 0, 1);
  const dx = px[j] - px[j - 1];
  const dy = py[j] - py[j - 1];
  const l = Math.hypot(dx, dy) || 1;
  out.x = px[j - 1] + dx * k;
  out.y = py[j - 1] + dy * k;
  out.tx = dx / l;
  out.ty = dy / l;
  return true;
}

// ── Лента вдоль пути (экранный многоугольник одной заливкой) ─────────────────────────────────

let lx = new Float64Array(256);
let ly = new Float64Array(256);
let rx = new Float64Array(256);
let ry = new Float64Array(256);

/**
 * Залить ленту вдоль пути: width(u) — ширина, м (u — доля длины от начала 0 до конца 1), сдвиг поперёк off, м
 * (+ — влево по ходу). trim — сколько метров срезать с конца (кончик следа может опережать нарисованную птицу).
 */
function ribbon(ctx: CanvasRenderingContext2D, v: ViewInfo, width: (u: number) => number, off: number, trim: number): void {
  if (pn < 2) return;
  const total = ps[pn - 1] - trim;
  if (total <= 0.05) return;
  if (lx.length < pn) {
    lx = new Float64Array(px.length);
    ly = new Float64Array(px.length);
    rx = new Float64Array(px.length);
    ry = new Float64Array(px.length);
  }
  const s = v.scale;
  const ox = v.screenW / 2 - v.camX * s;
  const oy = v.screenH / 2 + v.camY * s;
  let m = 0;
  for (let i = 0; i < pn; i++) {
    if (ps[i] > total) break;
    const a = Math.max(0, i - 1);
    const b = Math.min(pn - 1, i + 1);
    let tx = px[b] - px[a];
    let ty = py[b] - py[a];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    // нормаль влево по ходу (мир, Y вверх)
    const nx = -ty;
    const ny = tx;
    const w = 0.5 * width(ps[i] / total);
    const cx = px[i] + nx * off;
    const cy = py[i] + ny * off;
    lx[m] = (cx + nx * w) * s + ox;
    ly[m] = oy - (cy + ny * w) * s;
    rx[m] = (cx - nx * w) * s + ox;
    ry[m] = oy - (cy - ny * w) * s;
    m++;
  }
  if (m < 2) return;
  ctx.beginPath();
  ctx.moveTo(lx[0], ly[0]);
  for (let i = 1; i < m; i++) ctx.lineTo(lx[i], ly[i]);
  for (let i = m - 1; i >= 0; i--) ctx.lineTo(rx[i], ry[i]);
  ctx.closePath();
  ctx.fill();
}

// ── Отрисовка ────────────────────────────────────────────────────────────

const pt = { x: 0, y: 0, tx: 1, ty: 0 };
const FLY_CLAMP = (35 * Math.PI) / 180;
/** Треугольник Чака (birds.ts CHUCK_HULL, единицы радиуса, ось Y вниз, смотрит вправо). */
const CHUCK_TRI: readonly number[] = [0, -1.0, 0.909, 0.564, -0.909, 0.564];
const CHUCK_R = 0.495;

/** Детерминированный шум 0..1 по зерну (мерцание линий скорости без Math.random в кадре). */
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Нарисовать эффекты способностей, привязанные к следу (под телами, если рендер зовёт Fx.drawUnder). */
export function drawAbilities(ctx: CanvasRenderingContext2D, v: ViewInfo, list: readonly AbilFx[], trail: readonly TrailPoint[], ground: (x: number) => number): void {
  if (list.length === 0) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const a of list) {
    if (a.bird === 'matilda') {
      drawEggStreak(ctx, v, a, ground);
      continue;
    }
    const i0 = findMark(trail, a);
    if (i0 < 0) continue;
    const freeze = FREEZE[a.bird];
    if (a.end < 0 && freeze !== undefined && a.t >= freeze) a.end = trail.length - 1;
    const i1 = a.end >= 0 ? Math.min(a.end, trail.length - 1) : trail.length - 1;
    if (i1 <= i0) continue;
    buildPath(trail, i0, i1);
    if (a.bird === 'chuck') {
      if (trail.length !== a.lastN) {
        a.lastN = trail.length;
        a.moveT = a.t;
      }
      drawChuck(ctx, v, a);
    }
    else if (a.bird === 'hal') drawHal(ctx, v, a);
    else if (a.bird === 'silver') drawSilver(ctx, v, a, trail, i0, i1);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Чак: призраки за кончиком следа (0.9, 1.65, 2.4 м) и белые линии скорости. */
function drawChuck(ctx: CanvasRenderingContext2D, v: ViewInfo, a: AbilFx): void {
  // след перестал расти (удар) — призраки быстро гаснут, а не висят над точкой удара
  const fade = (1 - smoothstep(0.25, a.life, a.t)) * (1 - smoothstep(0.03, 0.12, a.t - a.moveT));
  if (fade <= 0.01) return;
  const s = v.scale;
  const ox = v.screenW / 2 - v.camX * s;
  const oy = v.screenH / 2 + v.camY * s;
  const ALPHA = [0.55, 0.38, 0.22];
  ctx.fillStyle = '#FFD62E';
  for (let k = 0; k < 3; k++) {
    if (!backAt(0.9 + 0.75 * k, pt)) break;
    const r = CHUCK_R * (0.96 - 0.07 * k) * s;
    const ang = clamp(Math.atan2(pt.ty, pt.tx), -FLY_CLAMP, FLY_CLAMP);
    const c = Math.cos(-ang);
    const sn = Math.sin(-ang);
    const cx = pt.x * s + ox;
    const cy = oy - pt.y * s;
    ctx.globalAlpha = ALPHA[k] * fade;
    ctx.beginPath();
    // скруглённый треугольник: arcTo по углам
    const T = CHUCK_TRI;
    const X = (i: number) => cx + (T[i] * c - T[i + 1] * sn) * r;
    const Y = (i: number) => cy + (T[i] * sn + T[i + 1] * c) * r;
    const rr = 0.18 * r;
    ctx.moveTo((X(0) + X(2)) / 2, (Y(0) + Y(2)) / 2);
    ctx.arcTo(X(2), Y(2), X(4), Y(4), rr);
    ctx.arcTo(X(4), Y(4), X(0), Y(0), rr);
    ctx.arcTo(X(0), Y(0), X(2), Y(2), rr);
    ctx.closePath();
    ctx.fill();
  }
  // линии скорости: 4 штриха вдоль курса, обновляются раз в 0.05 с
  if (!backAt(0.3, pt)) return;
  const nx = -pt.ty;
  const ny = pt.tx;
  const frame = Math.floor(a.t / 0.05);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.05 * s, 1.2 * (v.dpr || 1));
  ctx.globalAlpha = 0.85 * fade;
  ctx.beginPath();
  for (let j = 0; j < 4; j++) {
    const h1 = hash(a.seed + frame * 7.3 + j * 1.9);
    const h2 = hash(a.seed + frame * 3.1 + j * 5.7);
    const off = (j < 2 ? -1 : 1) * (0.32 + 0.38 * h1) * (j % 2 === 0 ? 1 : 1.35);
    const back = 0.35 + 0.6 * h2;
    const len = 1.0 + 1.1 * h1;
    const x0 = pt.x + nx * off - pt.tx * back;
    const y0 = pt.y + ny * off - pt.ty * back;
    ctx.moveTo(x0 * s + ox, oy - y0 * s);
    ctx.lineTo((x0 - pt.tx * len) * s + ox, oy - (y0 - pt.ty * len) * s);
  }
  ctx.stroke();
}

/** Хэл: зелёная дуга-свист по пути разворота — плотная середина, тонкие концы, белая сердцевина, линии по бокам. */
function drawHal(ctx: CanvasRenderingContext2D, v: ViewInfo, a: AbilFx): void {
  const fade = 1 - smoothstep(0.4, a.life, a.t);
  if (fade <= 0.01) return;
  const trim = a.end < 0 ? 0.3 : 0;
  const swoosh = (W: number) => (u: number) => W * Math.sin(Math.PI * clamp(u, 0, 1)) ** 0.6;
  ctx.globalAlpha = 0.5 * fade;
  ctx.fillStyle = '#7ED957';
  ribbon(ctx, v, swoosh(0.42), 0, trim);
  ctx.globalAlpha = 0.75 * fade;
  ctx.fillStyle = '#EFFFE0';
  ribbon(ctx, v, swoosh(0.12), 0, trim);
  ctx.globalAlpha = 0.45 * fade;
  ctx.fillStyle = '#FFFFFF';
  ribbon(ctx, v, swoosh(0.06), 0.42, trim);
  ribbon(ctx, v, swoosh(0.06), -0.42, trim);
}

/** Сильвер: белая лента по петле (сужается к началу) и линии скорости над верхней точкой петли. */
function drawSilver(ctx: CanvasRenderingContext2D, v: ViewInfo, a: AbilFx, trail: readonly TrailPoint[], i0: number, i1: number): void {
  const fade = 1 - smoothstep(0.75, a.life, a.t);
  if (fade <= 0.01) return;
  const trim = a.end < 0 ? 0.35 : 0;
  const W = 0.34 * (0.65 + 0.35 * fade);
  const tape = (k: number) => (u: number) => k * W * (0.25 + 0.75 * smoothstep(0, 0.3, u));
  ctx.globalAlpha = 0.35 * fade;
  ctx.fillStyle = '#8FA3B8';
  ribbon(ctx, v, tape(1.3), 0, trim);
  ctx.globalAlpha = 0.85 * fade;
  ctx.fillStyle = '#FFFFFF';
  ribbon(ctx, v, tape(1), 0, trim);
  // верхняя точка петли: пройдена, когда после неё следу есть ещё 2+ точки и путь пошёл вниз
  if (a.peakT < 0) {
    let best = i0;
    for (let i = i0 + 1; i <= i1; i++) if (trail[i].y > trail[best].y) best = i;
    if (best > i0 && best <= i1 - 2) {
      a.peakIdx = best;
      a.peakT = a.t;
    }
  }
  if (a.peakT < 0 || a.peakIdx >= trail.length) return;
  const k = (a.t - a.peakT) / 0.35;
  if (k >= 1) return;
  const p = trail[a.peakIdx];
  const q = trail[Math.max(i0, a.peakIdx - 1)];
  let tx = p.x - q.x;
  let ty = p.y - q.y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const s = v.scale;
  const ox = v.screenW / 2 - v.camX * s;
  const oy = v.screenH / 2 + v.camY * s;
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.05 * s, 1.2 * (v.dpr || 1));
  ctx.globalAlpha = 0.9 * (1 - k) * fade;
  ctx.beginPath();
  for (let j = 0; j < 3; j++) {
    // над петлёй (снаружи), вдоль касательной, слегка расходятся
    const up = 0.32 + 0.22 * j + 0.25 * k;
    const len = 1.1 - 0.25 * j;
    const sh = (j - 1) * 0.35;
    const cx = p.x + (-ty) * up * Math.sign(tx || 1) + tx * sh;
    const cy = p.y + tx * up * Math.sign(tx || 1) + ty * sh;
    ctx.moveTo((cx - (tx * len) / 2) * s + ox, oy - (cy - (ty * len) / 2) * s);
    ctx.lineTo((cx + (tx * len) / 2) * s + ox, oy - (cy + (ty * len) / 2) * s);
  }
  ctx.stroke();
}

/** Матильда: белый шлейф над падающим яйцом (до взрыва яйца или земли). */
function drawEggStreak(ctx: CanvasRenderingContext2D, v: ViewInfo, a: AbilFx, ground: (x: number) => number): void {
  if (a.eggDone) return;
  const t = a.t;
  const y0 = a.y - ABILITY.MATILDA.EGG_OFFSET_R * BIRD_FX.matilda.radius;
  const ye = y0 - EGG_V0 * t - 0.5 * G * t * t;
  const gy = ground(a.x);
  if (gy > -Infinity && ye - ABILITY.MATILDA.EGG_RADIUS <= gy) {
    a.eggDone = true;
    return;
  }
  const fade = 1 - smoothstep(0.2, a.life, t);
  const len = Math.min(1.8, y0 - ye);
  if (len < 0.1 || fade <= 0.01) return;
  const s = v.scale;
  const sx = (a.x - v.camX) * s + v.screenW / 2;
  // низ клина — у верха яйца (шлейф не накрывает само яйцо)
  const yb = ye + 0.9 * ABILITY.MATILDA.EGG_RADIUS;
  const top = v.screenH / 2 - (yb + len - v.camY) * s;
  const bot = v.screenH / 2 - (yb - v.camY) * s;
  const w = 0.17 * s;
  ctx.globalAlpha = 0.7 * fade;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  // клин: узкий верх, широкий низ у яйца
  ctx.moveTo(sx, top);
  ctx.lineTo(sx + w, bot);
  ctx.arc(sx, bot, w, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
}
