// Рогатка (Y-образная деревянная, с объёмом, корой и кожаными обмотками), резинки и кармашек.
// Спрайты рогатки рисуются в мировых метрах относительно ОСНОВАНИЯ (точка на уровне земли), ось Y вверх;
// (ox, oy) обоих спрайтов = основание. Рога заканчиваются точно в SLINGSHOT.PRONG_BACK / PRONG_FRONT.
// Порядок кадра (04 §2): back → рельеф → задняя резинка → птица → кармашек → передняя резинка → front.

import { SLINGSHOT } from '../../config/constants';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { Sprite } from './api';
import { LIGHT, TAU, clamp, lerp, makeRng, rgba, type Pt } from './props';

const SL = {
  light: '#DA9852',
  base: '#A8662F',
  dark: '#6A3715',
  outline: '#2E190A',
  spec: '#F6C98F',
  bark: '#4E2A10',
  cut: '#F2C98C',
  cutRing: '#B07038',
  wrap: '#6A4428',
  wrapDark: '#3F2614',
  wrapLight: '#A67748',
  band: '#3B2414',
  bandDark: '#1A0E06',
  bandLight: '#7C5532',
  pouch: '#7A5232',
  pouchDark: '#46301B',
  pouchLight: '#B08454',
  stitch: '#EBD2A4',
} as const;

/** Видимая обводка рогатки, м (04 §1.3: stroke 0.09, видимая половина 0.045). */
const OUT_SLING = 0.045;

// ───────────────────────── геометрия ветвей ─────────────────────────

interface Limb {
  /** Точки осевой линии (мир, Y вверх). */
  c: Pt[];
  /** Единичные касательные. */
  t: Pt[];
  /** Полуширина в каждой точке. */
  hw: number[];
}

/** Сплайн Катмулла — Рома через опорные точки, ширина линейно по длине. */
function makeLimb(ctrl: readonly Pt[], w0: number, w1: number, n = 30): Limb {
  const P: Pt[] = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const segs = ctrl.length - 1;
  const c: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const u = (i / n) * segs;
    const k = Math.min(segs - 1, Math.floor(u));
    const t = u - k;
    const [p0, p1, p2, p3] = [P[k], P[k + 1], P[k + 2], P[k + 3]];
    const f = (j: 0 | 1) =>
      0.5 *
      (2 * p1[j] +
        (-p0[j] + p2[j]) * t +
        (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t +
        (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t * t * t);
    c.push([f(0), f(1)]);
  }
  const tg: Pt[] = [];
  const acc: number[] = [0];
  for (let i = 0; i < c.length; i++) {
    const a = c[Math.max(0, i - 1)];
    const b = c[Math.min(c.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    tg.push([(b[0] - a[0]) / L, (b[1] - a[1]) / L]);
    if (i > 0) acc.push(acc[i - 1] + Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]));
  }
  const total = acc[acc.length - 1] || 1;
  return { c, t: tg, hw: acc.map((s) => lerp(w0, w1, s / total) / 2) };
}

/** Точка ветви: индекс i, поперечная координата s ∈ [−1, 1] (−1 — левая, освещённая кромка). */
function at(L: Limb, i: number, s: number): Pt {
  const [cx, cy] = L.c[i];
  const [tx, ty] = L.t[i];
  const k = -s * L.hw[i];
  return [cx - ty * k, cy + tx * k];
}

/**
 * Полоса ветви между поперечными координатами s0 < s1 (вместе со скруглённым концом).
 * При s0 = −1, s1 = 1 — весь силуэт ветви.
 */
function limbBand(L: Limb, s0: number, s1: number, cap = true): Path2D {
  const p = new Path2D();
  const n = L.c.length;
  for (let i = 0; i < n; i++) {
    const q = at(L, i, s0);
    if (i) p.lineTo(q[0], q[1]);
    else p.moveTo(q[0], q[1]);
  }
  if (cap) {
    const [cx, cy] = L.c[n - 1];
    const [tx, ty] = L.t[n - 1];
    const nx = -ty;
    const ny = tx;
    const hw = L.hw[n - 1];
    const a0 = Math.acos(clamp(-s0, -1, 1));
    const a1 = Math.acos(clamp(-s1, -1, 1));
    const K = 14;
    for (let k = 0; k <= K; k++) {
      const a = lerp(a0, a1, k / K);
      p.lineTo(cx + nx * Math.cos(a) * hw + tx * Math.sin(a) * hw, cy + ny * Math.cos(a) * hw + ty * Math.sin(a) * hw);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const q = at(L, i, s1);
    p.lineTo(q[0], q[1]);
  }
  p.closePath();
  return p;
}

const PB = SLINGSHOT.PRONG_BACK;
const PF = SLINGSHOT.PRONG_FRONT;
const BURY = SLINGSHOT.BURY;

// Опорные точки (м, от основания): ствол, задний и передний рог, сучок-обрубок.
const TRUNK = makeLimb(
  [
    [0.0, -BURY - 0.06],
    [0.012, 0.42],
    [0.0, 0.95],
    [0.0, 1.3],
  ],
  0.46,
  0.38,
);
// Рога начинаются внутри ствола (их основание растворяется в стволе) и чуть выгнуты наружу.
const BACK = makeLimb(
  [
    [0.0, 0.98],
    [-0.13, 1.42],
    [-0.3, 1.95],
    [-0.345, 2.5],
    [PB.x - 0.01, PB.y + 0.14],
  ],
  0.3,
  0.23,
);
const FRONT = makeLimb(
  [
    [0.0, 0.98],
    [0.15, 1.42],
    [0.3, 1.95],
    [0.33, 2.48],
    [PF.x + 0.01, PF.y + 0.14],
  ],
  0.3,
  0.23,
);
const STUB = makeLimb(
  [
    [-0.1, 0.62],
    [-0.24, 0.73],
    [-0.33, 0.8],
  ],
  0.16,
  0.12,
  12,
);

// Габарит холста (м, от основания)
const X0 = -0.62;
const X1 = 0.62;
const Y0 = -BURY - 0.12;
const Y1 = Math.max(PB.y, PF.y) + 0.36;

interface SlingDraft {
  c: AnyCanvas;
  ctx: Ctx2D;
  ox: number;
  oy: number;
}

function beginSling(ppu: number): SlingDraft {
  const pad = 3 / ppu;
  const c = createCanvas((X1 - X0 + 2 * pad) * ppu, (Y1 - Y0 + 2 * pad) * ppu);
  const ctx = ctx2d(c);
  const ox = (pad - X0) * ppu;
  const oy = (pad + Y1) * ppu;
  ctx.setTransform(ppu, 0, 0, -ppu, ox, oy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { c, ctx, ox, oy };
}

/** Объёмная заливка ветви: база, вложенные полосы света и тени, блик, кора. */
function paintLimb(ctx: Ctx2D, L: Limb, seed: number, ppu: number, knot: boolean): void {
  const full = limbBand(L, -1, 1);
  const g = ctx.createLinearGradient(0, -0.5, 0, 3.2);
  g.addColorStop(0, '#8E5226');
  g.addColorStop(0.35, SL.base);
  g.addColorStop(1, SL.base);
  ctx.fillStyle = g;
  ctx.fill(full);
  ctx.save();
  ctx.clip(full);
  // свет слева — вложенные полосы дают мягкий переход без швов
  for (const [s1, a] of [
    [0.05, 0.1],
    [-0.2, 0.14],
    [-0.42, 0.16],
    [-0.62, 0.18],
  ] as const) {
    ctx.fillStyle = rgba(SL.light, a);
    ctx.fill(limbBand(L, -1, s1));
  }
  ctx.fillStyle = rgba(SL.spec, 0.32);
  ctx.fill(limbBand(L, -0.74, -0.5));
  // тень справа
  for (const [s0, a] of [
    [0.12, 0.14],
    [0.34, 0.16],
    [0.55, 0.2],
    [0.74, 0.22],
  ] as const) {
    ctx.fillStyle = rgba(SL.dark, a);
    ctx.fill(limbBand(L, s0, 1));
  }
  // отражённый свет у правой кромки
  ctx.fillStyle = rgba(SL.light, 0.16);
  ctx.fill(limbBand(L, 0.84, 0.93));
  // кора: штрихи вдоль ветви
  const rng = makeRng(seed);
  const n = L.c.length;
  if (ppu >= 18) {
    const strokes = Math.round(n * 0.75);
    for (let k = 0; k < strokes; k++) {
      const i0 = 1 + Math.floor(rng() * (n - 4));
      const m = 2 + Math.floor(rng() * 3);
      const s = lerp(-0.75, 0.75, rng());
      const ds = (rng() - 0.5) * 0.25;
      const pts: Pt[] = [];
      for (let j = 0; j <= m && i0 + j < n; j++) pts.push(at(L, i0 + j, s + (ds * j) / m));
      if (pts.length < 2) continue;
      ctx.strokeStyle = rgba(SL.bark, lerp(0.35, 0.6, rng()) * (s > 0 ? 1 : 0.8));
      ctx.lineWidth = Math.max(lerp(0.016, 0.028, rng()), 1 / ppu);
      ctx.beginPath();
      pts.forEach(([x, y], q) => (q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      if (s < 0.3 && ppu >= 30) {
        // светлый гребень коры рядом со штрихом
        ctx.strokeStyle = rgba(SL.spec, 0.28);
        ctx.lineWidth = Math.max(0.012, 0.8 / ppu);
        ctx.beginPath();
        pts.forEach((_, q) => {
          const p2 = at(L, Math.min(n - 1, i0 + q), s - 0.13 + (ds * q) / m);
          if (q) ctx.lineTo(p2[0], p2[1]);
          else ctx.moveTo(p2[0], p2[1]);
        });
        ctx.stroke();
      }
    }
  }
  if (knot && ppu >= 24) {
    // сучок
    const i = Math.round(n * 0.55);
    const [kx, ky] = at(L, i, 0.25);
    const ang = Math.atan2(L.t[i][1], L.t[i][0]);
    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate(ang);
    ctx.fillStyle = rgba(SL.bark, 0.8);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.075, 0.045, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(SL.spec, 0.45);
    ctx.lineWidth = Math.max(0.012, 0.8 / ppu);
    ctx.beginPath();
    ctx.ellipse(0.005, 0.008, 0.1, 0.065, 0, Math.PI * 0.15, Math.PI * 0.95);
    ctx.stroke();
    ctx.fillStyle = rgba('#1E0E04', 0.8);
    ctx.beginPath();
    ctx.ellipse(0, 0, 0.03, 0.018, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Нарисовать ветвь в отдельный слой и растворить её основание (плавное срастание со стволом). */
function paintLimbFaded(d: SlingDraft, L: Limb, seed: number, ppu: number, fade: number): void {
  const layer = createCanvas(d.c.width, d.c.height);
  const lc = ctx2d(layer);
  lc.setTransform(ppu, 0, 0, -ppu, d.ox, d.oy);
  lc.lineJoin = 'round';
  lc.lineCap = 'round';
  paintLimb(lc, L, seed, ppu, false);
  const [bx, by] = L.c[0];
  const [tx, ty] = L.t[0];
  lc.globalCompositeOperation = 'destination-in';
  const g = lc.createLinearGradient(bx, by, bx + tx * fade, by + ty * fade);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  lc.fillStyle = g;
  lc.fillRect(X0 - 1, Y0 - 1, X1 - X0 + 2, Y1 - Y0 + 2);
  d.ctx.save();
  d.ctx.setTransform(1, 0, 0, 1, 0, 0);
  d.ctx.drawImage(layer, 0, 0);
  d.ctx.restore();
}

/** Кожаная обмотка вокруг рога в точке крепления резинки. */
function paintWrap(ctx: Ctx2D, L: Limb, p: { x: number; y: number }, ppu: number): void {
  // ближайшая точка оси
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < L.c.length; i++) {
    const d = Math.hypot(L.c[i][0] - p.x, L.c[i][1] - p.y);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  const [tx, ty] = L.t[bi];
  const ang = Math.atan2(ty, tx) - Math.PI / 2;
  const hw = L.hw[bi] + 0.035;
  const hh = 0.11;
  const olw = Math.max(0.028, 1.2 / ppu);
  ctx.save();
  // обмотка чуть выше точки крепления: резинка привязана у нижнего края, птицу закрывает меньше
  ctx.translate(p.x + tx * 0.035, p.y + ty * 0.035);
  ctx.rotate(ang);
  // локально: X поперёк рога (−X — освещённая сторона), Y вдоль рога (вверх)
  const body = new Path2D();
  body.roundRect(-hw, -hh, 2 * hw, 2 * hh, 0.05);
  ctx.fillStyle = rgba('#1E0E04', 0.35);
  ctx.beginPath();
  ctx.roundRect(-hw + 0.01, -hh - 0.035, 2 * hw, 2 * hh, 0.05);
  ctx.fill();
  const g = ctx.createLinearGradient(-hw, 0, hw, 0);
  g.addColorStop(0, SL.wrapLight);
  g.addColorStop(0.4, SL.wrap);
  g.addColorStop(1, SL.wrapDark);
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // витки ремня: косые полосы
  const turns = 4;
  for (let k = 0; k < turns; k++) {
    const y = -hh + ((k + 0.5) * 2 * hh) / turns;
    ctx.strokeStyle = rgba('#1E0E04', 0.55);
    ctx.lineWidth = Math.max(0.014, 0.9 / ppu);
    ctx.beginPath();
    ctx.moveTo(-hw - 0.02, y - 0.045);
    ctx.lineTo(hw + 0.02, y + 0.045);
    ctx.stroke();
    ctx.strokeStyle = rgba('#E9BE86', 0.45);
    ctx.lineWidth = Math.max(0.01, 0.8 / ppu);
    ctx.beginPath();
    ctx.moveTo(-hw - 0.02, y - 0.045 + 0.022);
    ctx.lineTo(hw * 0.4, y + 0.02 + 0.016);
    ctx.stroke();
  }
  // блик по верхней кромке обмотки
  ctx.fillStyle = 'rgba(255,230,190,0.25)';
  ctx.fillRect(-hw, hh - 0.04, 2 * hw, 0.04);
  ctx.restore();
  ctx.lineWidth = olw;
  ctx.strokeStyle = SL.outline;
  ctx.stroke(body);
  ctx.restore();
}

/** Срез обрубленного сучка. */
function paintStubCut(ctx: Ctx2D, ppu: number): void {
  const n = STUB.c.length;
  const [cx, cy] = STUB.c[n - 1];
  const [tx, ty] = STUB.t[n - 1];
  const hw = STUB.hw[n - 1];
  ctx.save();
  ctx.translate(cx + tx * hw * 0.35, cy + ty * hw * 0.35);
  ctx.rotate(Math.atan2(ty, tx));
  ctx.fillStyle = SL.cut;
  ctx.beginPath();
  ctx.ellipse(0, 0, hw * 0.45, hw * 0.95, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = rgba(SL.cutRing, 0.8);
  ctx.lineWidth = Math.max(0.01, 0.8 / ppu);
  ctx.beginPath();
  ctx.ellipse(0, 0, hw * 0.22, hw * 0.48, 0, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.03, 1.4 / ppu);
  ctx.strokeStyle = SL.outline;
  ctx.beginPath();
  ctx.ellipse(0, 0, hw * 0.45, hw * 0.95, 0, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

/**
 * Спрайты рогатки: back — ствол, сучок и задний рог с обмоткой (рисуется ДО птицы и до рельефа);
 * front — передний рог с обмоткой (рисуется ПОСЛЕ птицы и резинок).
 * (ox, oy) обоих = основание рогатки; ствол уходит под землю на SLINGSHOT.BURY.
 */
export function renderSlingshot(ppu: number): { back: Sprite; front: Sprite } {
  const olw = 2 * Math.max(OUT_SLING, 1.5 / ppu);
  // ── back ──
  const b = beginSling(ppu);
  {
    const ctx = b.ctx;
    const trunk = limbBand(TRUNK, -1, 1);
    const back = limbBand(BACK, -1, 1);
    const stub = limbBand(STUB, -1, 1);
    // обводка всех частей первой — заливки поверх оставляют единый внешний контур
    ctx.lineWidth = olw;
    ctx.strokeStyle = SL.outline;
    ctx.stroke(back);
    ctx.stroke(stub);
    ctx.stroke(trunk);
    paintLimb(ctx, STUB, 0x51, ppu, false);
    paintStubCut(ctx, ppu);
    paintLimb(ctx, TRUNK, 0x7a, ppu, true);
    paintLimbFaded(b, BACK, 0xb4, ppu, 0.34);
    paintWrap(ctx, BACK, PB, ppu);
  }
  // ── front ──
  const f = beginSling(ppu);
  {
    const ctx = f.ctx;
    const front = limbBand(FRONT, -1, 1);
    // контур переднего рога — только вне ствола (внутри ствола рог срастается со стволом)
    ctx.save();
    const outside = new Path2D();
    outside.rect(X0 - 1, Y0 - 1, X1 - X0 + 2, Y1 - Y0 + 2);
    outside.addPath(limbBand(TRUNK, -1, 1));
    ctx.clip(outside, 'evenodd');
    ctx.lineWidth = olw;
    ctx.strokeStyle = SL.outline;
    ctx.stroke(front);
    ctx.restore();
    paintLimbFaded(f, FRONT, 0xf2, ppu, 0.34);
    paintWrap(ctx, FRONT, PF, ppu);
  }
  return {
    back: { canvas: b.c, ox: b.ox, oy: b.oy, ppu },
    front: { canvas: f.c, ox: f.ox, oy: f.oy, ppu },
  };
}

// ───────────────────────── резинки и кармашек (экранные координаты) ─────────────────────────

/**
 * Резинка от (x1, y1) до (x2, y2) в текущих координатах контекста (обычно — пиксели экрана, Y вниз).
 * Тёмно-коричневая, с тёмной кромкой, бликом сверху и скруглёнными концами.
 */
export function drawBand(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, thicknessPx: number): void {
  const t = Math.max(1, thicknessPx);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy);
  // нормаль, смотрящая вверх по экрану
  let nx = 0;
  let ny = -1;
  if (L > 1e-6) {
    nx = -dy / L;
    ny = dx / L;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
  }
  const line = (o: number, w: number, style: string) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1 + nx * o, y1 + ny * o);
    ctx.lineTo(x2 + nx * o, y2 + ny * o);
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  line(0, t + 2 * Math.max(1, t * 0.13), SL.bandDark);
  line(0, t, SL.band);
  if (t >= 3) {
    line(-t * 0.22, t * 0.3, rgba('#120904', 0.45));
    line(t * 0.2, Math.max(1, t * 0.26), rgba(SL.bandLight, 0.95));
  }
  ctx.restore();
}

/**
 * Кожаный кармашек: полумесяц, охватывающий птицу сзади.
 * (x, y) — центр кармашка (центр птицы) в пикселях экрана; angle — экранный угол (рад, Y вниз)
 * направления от кармашка к ANCHOR, т.е. atan2(ay − y, ax − x) в пикселях.
 * В покое (кармашек в ANCHOR) рекомендуется angle = −π/2: кармашек «сиденьем» под птицей,
 * края — слева/справа, резинки короткие. При оттяжке удобно брать направление на ANCHOR + (0, 0.5 м),
 * тогда угол плавно переходит от покоя к натяжению.
 * Концы полумесяца — в (x, y) ± perp(angle)·halfWidthPx (туда крепятся резинки).
 * thicknessPx — толщина кожи в самой широкой (задней) части.
 */
export function drawPouch(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, halfWidthPx: number, thicknessPx: number): void {
  const H = Math.max(3, halfWidthPx);
  const T = clamp(thicknessPx, H * 0.22, H * 0.5);
  const Xb = H * 1.3;
  const tip = T * 0.32;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const p = new Path2D();
  p.ellipse(0, 0, Xb, H, 0, -Math.PI / 2, Math.PI / 2, true);
  p.ellipse(0, 0, Xb - T, H - tip, 0, Math.PI / 2, -Math.PI / 2, false);
  p.closePath();
  // свет сверху-слева экрана в локальной системе кармашка
  const ca = Math.cos(-angle);
  const sa = Math.sin(-angle);
  const lx = LIGHT[0] * ca - LIGHT[1] * sa;
  const ly = LIGHT[0] * sa + LIGHT[1] * ca;
  const g = ctx.createLinearGradient(lx * Xb, ly * Xb, -lx * Xb, -ly * Xb);
  g.addColorStop(0, SL.pouchLight);
  g.addColorStop(0.45, SL.pouch);
  g.addColorStop(1, SL.pouchDark);
  // тень кармашка на птице
  ctx.fillStyle = 'rgba(20,10,4,0.25)';
  ctx.save();
  ctx.translate(T * 0.25, 0);
  ctx.fill(p);
  ctx.restore();
  ctx.fillStyle = g;
  ctx.fill(p);
  ctx.save();
  ctx.clip(p);
  // тёмная внутренняя кромка (сторона птицы)
  ctx.strokeStyle = rgba(SL.pouchDark, 0.7);
  ctx.lineWidth = T * 0.35;
  ctx.beginPath();
  ctx.ellipse(0, 0, Xb - T, H - tip, 0, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.stroke();
  // блик по внешней кромке
  ctx.strokeStyle = 'rgba(255,225,180,0.35)';
  ctx.lineWidth = T * 0.22;
  ctx.beginPath();
  ctx.ellipse(0, 0, Xb - T * 0.18, H - T * 0.1, 0, Math.PI * 0.6, Math.PI * 1.4);
  ctx.stroke();
  ctx.restore();
  // строчка
  if (H >= 8) {
    ctx.setLineDash([Math.max(2, H * 0.13), Math.max(1.5, H * 0.1)]);
    ctx.strokeStyle = rgba(SL.stitch, 0.9);
    ctx.lineWidth = Math.max(1, H * 0.045);
    ctx.beginPath();
    ctx.ellipse(0, 0, Xb - T * 0.5, H - T * 0.5 * 0.5 - tip * 0.5, 0, Math.PI * 0.62, Math.PI * 1.38);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.2, H * 0.075);
  ctx.strokeStyle = SL.outline;
  ctx.stroke(p);
  ctx.restore();
}
