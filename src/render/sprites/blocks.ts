// Блоки конструкций (дерево / лёд / камень × формы × 4 стадии повреждений), TNT, яйцо Матильды
// и спрайты осколков для частиц. Всё рисуется кодом в offscreen-холсты (контракт Sprite, 04 §7).
// Спрайт-пространство: метры, Y вниз, (0, 0) — центр ограничивающего прямоугольника формы.

import type { BlockShape, Material } from '../../core/types';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { Sprite } from './api';
import {
  ICE,
  MATERIALS,
  OUT_BLOCK,
  STONE,
  TAU,
  WOOD,
  beginCentered,
  bevelCircle,
  bevelPoly,
  centroid,
  clamp,
  cornerChipPath,
  cutChip,
  edgeBitePath,
  edgeNormals,
  fillTile,
  frostTile,
  genCracks,
  hashSeed,
  innerShadow,
  insetPoly,
  lerp,
  lit,
  makeRng,
  mix,
  polyPath,
  rgba,
  rimCircle,
  rimPoly,
  seedInt,
  shapePath,
  shapePoly,
  stoneTile,
  strokeCrack,
  type Crack,
  type Pt,
} from './props';

/** Геометрия блока для всех рецептов. */
interface Geo {
  readonly shape: BlockShape;
  readonly w: number;
  readonly h: number;
  readonly mn: number;
  readonly mx: number;
  /** Опорный многоугольник (для круга — 48-угольник). */
  readonly poly: Pt[];
  /** Силуэт со скруглёнными углами. */
  readonly path: Path2D;
  /** Толщина обводки, м. */
  readonly lw: number;
  readonly ppu: number;
  /** 1 пиксель в метрах. */
  readonly px: number;
}

function makeGeo(material: Material, shape: BlockShape, w: number, h: number, ppu: number, lw: number): Geo {
  const mn = Math.min(w, h);
  const mx = Math.max(w, h);
  const r = material === 'stone' ? clamp(0.14 * mn, 0.02, 0.09) : clamp(0.07 * mn, 0.012, 0.05);
  return { shape, w, h, mn, mx, poly: shapePoly(shape, w, h), path: shapePath(shape, w, h, r), lw, ppu, px: 1 / ppu };
}

/** Толщина детали с нижней границей в пикселях. */
const det = (g: Geo, m: number, minPx = 1): number => Math.max(m, minPx * g.px);

/** Сколько главных трещин видно на стадии (дерево — меньше, но крупнее; камень — по 04 §7.6, чуть реже). */
const CRACKS_WOOD = [0, 1, 2, 4] as const;
const CRACKS_STONE = [0, 1, 3, 5] as const;

/**
 * Обводка льда толще, чем у дерева и камня (Б12): полупрозрачное тело само по себе не отделяется от снега и
 * облаков, силуэт держит тёмная кромка. Множитель к OUT_BLOCK и нижняя граница, px.
 */
const ICE_OUT_K = 1.3;
const ICE_OUT_MIN_PX = 2;

/** Толщина обводки блока, м (центр линии — на физической кромке). */
function outlineWidth(material: Material, ppu: number): number {
  return material === 'ice' ? Math.max(OUT_BLOCK * ICE_OUT_K, ICE_OUT_MIN_PX / ppu) : Math.max(OUT_BLOCK, 1.5 / ppu);
}

/**
 * Спрайт блока.
 * (ox, oy) — центр ограничивающего прямоугольника формы. Форма точно w×h (rect), круг диаметром w,
 * прямоугольный треугольник с прямым углом внизу-слева, равнобедренный с основанием внизу.
 * damageStage 0..3 (0 — целый). seed — вариант узора (целое или дробь 0..1), детерминированно.
 */
export function renderBlock(material: Material, shape: BlockShape, wM: number, hM: number, damageStage: number, seed: number, ppu: number): Sprite {
  const w = Math.max(0.04, wM);
  const h = shape === 'circle' ? w : Math.max(0.04, hM);
  const stage = clamp(Math.round(damageStage), 0, 3);
  const s = seedInt(seed);
  const lw = outlineWidth(material, ppu);
  const { c, ctx, ox, oy } = beginCentered(w, h, lw / 2 + 3 / ppu, ppu);
  const g = makeGeo(material, shape, w, h, ppu, lw);
  if (material === 'wood') paintWood(ctx, g, s);
  else if (material === 'ice') paintIce(ctx, g, s);
  else paintStone(ctx, g, s);
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = MATERIALS[material].outline;
  ctx.stroke(g.path);
  if (stage > 0) paintDamage(ctx, material, g, stage, s);
  return { canvas: c, ox, oy, ppu };
}

// ═════════════════════════════ ДЕРЕВО ═════════════════════════════

function paintWood(ctx: Ctx2D, g: Geo, seed: number): void {
  const rng = makeRng(hashSeed(seed, 0x57));
  ctx.save();
  ctx.clip(g.path);
  if (g.shape === 'circle') {
    woodLog(ctx, g, rng);
    ctx.restore();
    return;
  }
  const crate = g.shape === 'rect' && g.mx / g.mn < 1.6 && g.mn > 0.35 && g.mn * g.ppu >= 26;
  if (crate) woodCrate(ctx, g, rng);
  else woodPlanks(ctx, g, rng);
  // объём: мягкая тень по нижне-правому краю, фаска, светлая кромка
  innerShadow(ctx, g.path, rgba(WOOD.deep, 0.55), g.mn * 0.14, -0.02 * g.mn, -0.05 * g.mn, g.ppu, g.mx);
  const b = clamp(0.16 * g.mn, 0.025, 0.07) + g.lw * 0.35;
  bevelPoly(ctx, g.poly, b, WOOD.light, WOOD.deep, 0.85, 0.6);
  ctx.restore();
  rimPoly(ctx, g.poly, g.lw * 0.5 + det(g, 0.014, 0.8) * 0.6, det(g, 0.018, 1), '#FFF1D2', 0.8);
}

/** Волокно: синусоида вдоль X с обтеканием сучков. */
function grainLine(
  ctx: Ctx2D,
  x0: number,
  x1: number,
  y0: number,
  amp: number,
  lam: number,
  ph: number,
  knots: ReadonlyArray<readonly [number, number, number]>,
): void {
  const step = 0.03;
  ctx.beginPath();
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    let y = y0 + amp * Math.sin((TAU * x) / lam + ph) + amp * 0.4 * Math.sin((TAU * x) / (lam * 0.37) + ph * 1.7);
    for (const [kx, ky, kr] of knots) {
      const d = x - kx;
      const near = Math.exp((-d * d) / (kr * kr * 4));
      y += (y0 > ky ? 1 : -1) * kr * 0.9 * near * Math.exp(-Math.abs(y0 - ky) / (kr * 2.2));
    }
    if (x === x0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/** Волокна, «соборные» дуги и сучки в прямоугольнике доски [x0..x1]×[y0..y1] (X — вдоль волокон). */
function woodGrain(ctx: Ctx2D, g: Geo, rng: () => number, x0: number, x1: number, y0: number, y1: number, allowKnots: boolean): void {
  const len = x1 - x0;
  const th = y1 - y0;
  // сучки: [x, y, радиус]
  const knots: Array<[number, number, number]> = [];
  if (allowKnots && th > 0.14 && th * g.ppu > 12) {
    const kn = Math.floor((len / 1.3) * rng() + rng() * 0.75);
    for (let i = 0; i < kn; i++) {
      const kr = clamp(th * lerp(0.13, 0.2, rng()), 0.025, 0.06);
      knots.push([lerp(x0 + 0.2, x1 - 0.2, rng()), lerp(y0 + th * 0.3, y1 - th * 0.3, rng()), kr]);
    }
  }
  // широкие мягкие полосы цвета — «живое» дерево
  const bands = Math.max(1, Math.round(th / 0.12));
  for (let i = 0; i < bands; i++) {
    const yy = lerp(y0, y1, (i + rng()) / bands);
    ctx.strokeStyle = rgba(rng() < 0.5 ? WOOD.light : WOOD.dark, lerp(0.1, 0.2, rng()));
    ctx.lineWidth = th * lerp(0.12, 0.25, rng());
    grainLine(ctx, x0 - 0.1, x1 + 0.1, yy, 0.02, lerp(1, 2.2, rng()), rng() * TAU, knots);
  }
  // тонкие волокна (не плотнее ~3.5 px)
  const n = Math.max(1, Math.min(Math.round(th / 0.055), Math.floor((th * g.ppu) / 3.5)));
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const yy = y0 + ((i + 0.5) * th) / n + (rng() - 0.5) * (th / n) * 0.5;
    ctx.strokeStyle = rgba(WOOD.grain, lerp(0.35, 0.7, rng()));
    ctx.lineWidth = det(g, lerp(0.007, 0.015, rng()), 0.75);
    // часть волокон — неполные штрихи
    const full = rng() < 0.6;
    const a = full ? x0 - 0.05 : lerp(x0, x1 - len * 0.3, rng());
    const b = full ? x1 + 0.05 : Math.min(x1, a + len * lerp(0.25, 0.7, rng()));
    grainLine(ctx, a, b, yy, lerp(0.006, 0.014, rng()), lerp(0.5, 1.4, rng()), rng() * TAU, knots);
  }
  // «соборный» рисунок: вложенные параболы (на широких досках)
  if (th >= 0.2 && len >= 0.9 && th * g.ppu > 16) {
    const cnt = Math.max(rng() < 0.6 ? 1 : 0, Math.floor(len / 2.2));
    for (let k = 0; k < cnt; k++) {
      const cx = lerp(x0 + len * 0.2, x1 - len * 0.2, (k + rng()) / Math.max(1, cnt));
      const cy = lerp(y0 + th * 0.35, y1 - th * 0.35, rng());
      const dir = rng() < 0.5 ? -1 : 1;
      const rings = clamp(Math.floor((th * g.ppu) / 7), 2, 4);
      ctx.strokeStyle = rgba(WOOD.grain, 0.55);
      ctx.lineWidth = det(g, 0.01, 0.75);
      for (let j = 0; j < rings; j++) {
        const hw = th * (0.12 + j * 0.11);
        const reach = 0.12 + j * 0.13;
        ctx.beginPath();
        for (let t = -1; t <= 1.001; t += 0.1) {
          const y = cy + t * hw;
          const x = cx + dir * (reach * (1 - t * t) - 0.05 * j);
          if (t === -1) ctx.moveTo(x - dir * 0.35, y);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(cx - dir * 0.35, cy + hw);
        ctx.stroke();
      }
    }
  }
  // сучки поверх волокон
  for (const [kx, ky, kr] of knots) {
    const kg = ctx.createRadialGradient(kx - kr * 0.2, ky - kr * 0.15, kr * 0.1, kx, ky, kr);
    kg.addColorStop(0, mix(WOOD.knot, '#3A1E0A', 0.4));
    kg.addColorStop(0.6, WOOD.knot);
    kg.addColorStop(1, rgba(WOOD.knot, 0.0));
    ctx.fillStyle = kg;
    ctx.beginPath();
    ctx.ellipse(kx, ky, kr * 1.25, kr * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(WOOD.grain, 0.75);
    ctx.lineWidth = det(g, 0.009, 0.75);
    ctx.beginPath();
    ctx.ellipse(kx, ky, kr * 1.7, kr * 0.95, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = rgba(WOOD.light, 0.5);
    ctx.beginPath();
    ctx.ellipse(kx - kr * 0.25, ky + kr * 0.42, kr * 0.7, kr * 0.16, 0, 0, TAU);
    ctx.fill();
  }
}

/** Гвоздь: тень, шляпка с объёмом, блик. */
function nail(ctx: Ctx2D, g: Geo, x: number, y: number, r: number): void {
  if (r * g.ppu < 1.3) return;
  ctx.fillStyle = rgba(WOOD.deep, 0.75);
  ctx.beginPath();
  ctx.arc(x + r * 0.3, y + r * 0.35, r * 1.15, 0, TAU);
  ctx.fill();
  const ng = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  ng.addColorStop(0, WOOD.nailLight);
  ng.addColorStop(0.55, WOOD.nail);
  ng.addColorStop(1, mix(WOOD.nail, '#20232A', 0.5));
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  if (r * g.ppu > 2.5) {
    ctx.strokeStyle = rgba('#2A2C33', 0.8);
    ctx.lineWidth = det(g, r * 0.18, 0.6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.28, 0, TAU);
    ctx.fill();
  }
}

/** Доски: волокна вдоль длинной стороны, швы между досками, тёмные торцы, гвозди. */
function woodPlanks(ctx: Ctx2D, g: Geo, rng: () => number): void {
  const horiz = g.shape !== 'rect' || g.w >= g.h;
  const len = horiz ? g.w : g.h;
  const th = horiz ? g.h : g.w;
  const L2 = len / 2;
  const T2 = th / 2;
  ctx.save();
  // в системе доски X — вдоль волокон, −Y — освещённая сторона (у колонны — левая)
  if (!horiz) ctx.rotate(-Math.PI / 2);
  const base = ctx.createLinearGradient(0, -T2, 0, T2);
  base.addColorStop(0, WOOD.light);
  base.addColorStop(0.28, WOOD.base);
  base.addColorStop(0.72, mix(WOOD.base, WOOD.dark, 0.45));
  base.addColorStop(1, WOOD.dark);
  ctx.fillStyle = base;
  ctx.fillRect(-L2 - 0.1, -T2 - 0.1, len + 0.2, th + 0.2);
  // доски
  let k = th > 0.3 ? Math.max(2, Math.round(th / 0.25)) : 1;
  k = Math.max(1, Math.min(k, Math.floor((th * g.ppu) / 9)));
  const bh = th / k;
  for (let j = 0; j < k; j++) {
    const y0 = -T2 + j * bh;
    const y1 = y0 + bh;
    if (k > 1) {
      // каждая доска чуть выпуклая и своего оттенка
      const bg = ctx.createLinearGradient(0, y0, 0, y1);
      bg.addColorStop(0, rgba('#FFFFFF', 0.16));
      bg.addColorStop(0.35, rgba('#FFFFFF', 0));
      bg.addColorStop(0.7, rgba(WOOD.deep, 0));
      bg.addColorStop(1, rgba(WOOD.deep, 0.22));
      ctx.fillStyle = bg;
      ctx.fillRect(-L2 - 0.1, y0, len + 0.2, bh);
      ctx.fillStyle = rgba(rng() < 0.5 ? WOOD.light : WOOD.dark, lerp(0.04, 0.12, rng()));
      ctx.fillRect(-L2 - 0.1, y0, len + 0.2, bh);
    }
    woodGrain(ctx, g, rng, -L2, L2, y0, y1, true);
  }
  // швы между досками: тёмная щель + светлая кромка нижней доски
  for (let j = 1; j < k; j++) {
    const y = -T2 + j * bh;
    ctx.strokeStyle = rgba(WOOD.outline, 0.75);
    ctx.lineWidth = det(g, 0.018, 1);
    ctx.beginPath();
    ctx.moveTo(-L2 - 0.1, y);
    ctx.lineTo(L2 + 0.1, y);
    ctx.stroke();
    ctx.strokeStyle = rgba('#FFE9C0', 0.55);
    ctx.lineWidth = det(g, 0.009, 0.7);
    ctx.beginPath();
    ctx.moveTo(-L2 - 0.1, y + det(g, 0.016, 1));
    ctx.lineTo(L2 + 0.1, y + det(g, 0.016, 1));
    ctx.stroke();
  }
  // торцы длинных досок: затемнение и гвозди
  if (g.shape === 'rect' && len / th > 2.2) {
    const ew = Math.min(0.16, len * 0.08);
    for (const s of [-1, 1]) {
      const eg = ctx.createLinearGradient(s * L2, 0, s * (L2 - ew), 0);
      eg.addColorStop(0, rgba(WOOD.deep, 0.5));
      eg.addColorStop(1, rgba(WOOD.deep, 0));
      ctx.fillStyle = eg;
      ctx.fillRect(s > 0 ? L2 - ew : -L2, -T2, ew, th);
      const nr = clamp(th * 0.075, 0.016, 0.03);
      for (let j = 0; j < k; j++) {
        const ys = k > 1 ? [-T2 + (j + 0.5) * bh] : th > 0.3 ? [-th * 0.25, th * 0.25] : [0];
        for (const y of ys) nail(ctx, g, s * (L2 - Math.max(0.09, nr * 4)), y, nr);
      }
    }
  }
  ctx.restore();
  // треугольники: гвозди у основания
  if (g.shape !== 'rect' && g.h * g.ppu > 30) {
    const nr = clamp(g.mn * 0.035, 0.016, 0.03);
    const m = Math.max(0.09, bh * 0.5);
    const y = g.h / 2 - m;
    const a = g.w / 2;
    const b = g.h / 2;
    // правая наклонная сторона на высоте гвоздя и отступ от неё по нормали
    const slope = g.shape === 'triangle' ? a / b : a / (2 * b);
    const xHyp = g.shape === 'triangle' ? a * (1 - m / b) : a * (1 - m / (2 * b));
    const xr = xHyp - 0.11 * Math.hypot(1, slope);
    const xl = g.shape === 'triangle' ? -a + 0.11 : -xr;
    if (xr - xl > 0.15) {
      nail(ctx, g, xl, y, nr);
      nail(ctx, g, xr, y, nr);
    }
  }
}

/** Ящик (квадраты): рама из четырёх досок, утопленная панель и диагональная распорка. */
function woodCrate(ctx: Ctx2D, g: Geo, rng: () => number): void {
  const w = g.w;
  const h = g.h;
  const f = clamp(0.2 * g.mn, 0.08, 0.32);
  const px0 = -w / 2 + f;
  const py0 = -h / 2 + f;
  const pw = w - 2 * f;
  const ph = h - 2 * f;
  // панель: утоплена, темнее
  const pg = ctx.createLinearGradient(0, py0, 0, py0 + ph);
  pg.addColorStop(0, mix(WOOD.base, WOOD.dark, 0.55));
  pg.addColorStop(1, mix(WOOD.dark, WOOD.deep, 0.5));
  ctx.fillStyle = pg;
  ctx.fillRect(px0, py0, pw, ph);
  // вертикальные доски панели
  ctx.save();
  ctx.beginPath();
  ctx.rect(px0, py0, pw, ph);
  ctx.clip();
  const pk = clamp(Math.round(pw / 0.22), 2, 4);
  ctx.save();
  ctx.rotate(-Math.PI / 2);
  for (let j = 0; j < pk; j++) {
    const y0 = px0 + (j * pw) / pk;
    ctx.globalAlpha = 0.55;
    woodGrain(ctx, g, rng, -h / 2, h / 2, y0, y0 + pw / pk, false);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  ctx.strokeStyle = rgba(WOOD.outline, 0.45);
  ctx.lineWidth = det(g, 0.014, 0.8);
  for (let j = 1; j < pk; j++) {
    const x = px0 + (j * pw) / pk;
    ctx.beginPath();
    ctx.moveTo(x, py0);
    ctx.lineTo(x, py0 + ph);
    ctx.stroke();
  }
  // распорка: от левого нижнего угла панели к правому верхнему
  const ang = Math.atan2(-ph, pw);
  const diag = Math.hypot(pw, ph);
  const bw = f * 1.05;
  ctx.save();
  ctx.rotate(ang);
  // тень распорки на панели
  ctx.fillStyle = rgba('#2A1406', 0.4);
  ctx.save();
  ctx.translate(0.02, 0.035);
  ctx.fillRect(-diag, -bw / 2, diag * 2, bw);
  ctx.restore();
  const bgd = ctx.createLinearGradient(0, -bw / 2, 0, bw / 2);
  bgd.addColorStop(0, WOOD.light);
  bgd.addColorStop(0.4, WOOD.base);
  bgd.addColorStop(1, mix(WOOD.base, WOOD.dark, 0.6));
  ctx.fillStyle = bgd;
  ctx.fillRect(-diag, -bw / 2, diag * 2, bw);
  woodGrain(ctx, g, rng, -diag / 2, diag / 2, -bw / 2, bw / 2, false);
  ctx.strokeStyle = rgba(WOOD.outline, 0.9);
  ctx.lineWidth = det(g, 0.018, 1);
  ctx.beginPath();
  ctx.moveTo(-diag, -bw / 2);
  ctx.lineTo(diag, -bw / 2);
  ctx.moveTo(-diag, bw / 2);
  ctx.lineTo(diag, bw / 2);
  ctx.stroke();
  ctx.strokeStyle = rgba('#FFF1D2', 0.55);
  ctx.lineWidth = det(g, 0.01, 0.7);
  ctx.beginPath();
  ctx.moveTo(-diag, -bw / 2 + det(g, 0.018, 1));
  ctx.lineTo(diag, -bw / 2 + det(g, 0.018, 1));
  ctx.stroke();
  ctx.restore();
  // тень от рамки на панели (сверху и слева) и светлые внутренние стенки снизу/справа
  const sh = Math.min(0.07, f * 0.45);
  const sg1 = ctx.createLinearGradient(0, py0, 0, py0 + sh);
  sg1.addColorStop(0, rgba('#2A1406', 0.55));
  sg1.addColorStop(1, rgba('#2A1406', 0));
  ctx.fillStyle = sg1;
  ctx.fillRect(px0, py0, pw, sh);
  const sg2 = ctx.createLinearGradient(px0, 0, px0 + sh, 0);
  sg2.addColorStop(0, rgba('#2A1406', 0.45));
  sg2.addColorStop(1, rgba('#2A1406', 0));
  ctx.fillStyle = sg2;
  ctx.fillRect(px0, py0, sh, ph);
  ctx.restore();
  // рама: верх/низ на всю ширину, бока между ними
  const boards: Array<[number, number, number, number, boolean]> = [
    [-w / 2, -h / 2, w, f, true],
    [-w / 2, h / 2 - f, w, f, true],
    [-w / 2, py0, f, ph, false],
    [w / 2 - f, py0, f, ph, false],
  ];
  for (const [x, y, bwid, bht, hor] of boards) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, bwid, bht);
    ctx.clip();
    ctx.translate(x + bwid / 2, y + bht / 2);
    if (!hor) ctx.rotate(-Math.PI / 2);
    const L = hor ? bwid : bht;
    const T = hor ? bht : bwid;
    const fg = ctx.createLinearGradient(0, -T / 2, 0, T / 2);
    fg.addColorStop(0, WOOD.light);
    fg.addColorStop(0.45, WOOD.base);
    fg.addColorStop(1, mix(WOOD.base, WOOD.dark, 0.7));
    ctx.fillStyle = fg;
    ctx.fillRect(-L / 2, -T / 2, L, T);
    ctx.fillStyle = rgba(rng() < 0.5 ? WOOD.light : WOOD.dark, lerp(0.04, 0.12, rng()));
    ctx.fillRect(-L / 2, -T / 2, L, T);
    woodGrain(ctx, g, rng, -L / 2, L / 2, -T / 2, T / 2, L > 0.6);
    ctx.restore();
  }
  // стыки досок рамы и контур панели
  ctx.strokeStyle = rgba(WOOD.outline, 0.85);
  ctx.lineWidth = det(g, 0.016, 1);
  ctx.beginPath();
  ctx.moveTo(-w / 2, py0);
  ctx.lineTo(px0, py0);
  ctx.moveTo(w / 2 - f, py0);
  ctx.lineTo(w / 2, py0);
  ctx.moveTo(-w / 2, py0 + ph);
  ctx.lineTo(px0, py0 + ph);
  ctx.moveTo(w / 2 - f, py0 + ph);
  ctx.lineTo(w / 2, py0 + ph);
  ctx.stroke();
  ctx.lineWidth = det(g, 0.022, 1.1);
  ctx.strokeRect(px0, py0, pw, ph);
  // светлые внутренние кромки рамы снизу/справа (обращены к свету)
  ctx.strokeStyle = rgba('#FFE9C0', 0.5);
  ctx.lineWidth = det(g, 0.01, 0.7);
  ctx.beginPath();
  ctx.moveTo(px0 + 0.02, py0 + ph - det(g, 0.018, 1));
  ctx.lineTo(px0 + pw - det(g, 0.018, 1), py0 + ph - det(g, 0.018, 1));
  ctx.lineTo(px0 + pw - det(g, 0.018, 1), py0 + 0.02);
  ctx.stroke();
  // гвозди по углам рамы и на концах распорки
  const nr = clamp(f * 0.12, 0.016, 0.032);
  const ins = f * 0.5;
  for (const [x, y] of [
    [-w / 2 + ins, -h / 2 + ins],
    [w / 2 - ins, -h / 2 + ins],
    [-w / 2 + ins, h / 2 - ins],
    [w / 2 - ins, h / 2 - ins],
  ] as const) {
    nail(ctx, g, x, y, nr);
  }
}

/** Торец бревна (круг): кора, годичные кольца, сердцевина, радиальные трещинки. */
function woodLog(ctx: Ctx2D, g: Geo, rng: () => number): void {
  const R = g.w / 2;
  const bark = R * 0.13 + g.lw * 0.3;
  // кора
  const bg = ctx.createLinearGradient(-R, -R, R, R);
  bg.addColorStop(0, '#8E5426');
  bg.addColorStop(1, '#4E2A10');
  ctx.fillStyle = bg;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  if (R * g.ppu > 14) {
    ctx.strokeStyle = rgba('#2E1608', 0.6);
    ctx.lineWidth = det(g, 0.012, 0.8);
    const nt = Math.round((TAU * R) / 0.09);
    for (let i = 0; i < nt; i++) {
      const a = (i / nt) * TAU + rng() * 0.1;
      const r0 = R - bark * lerp(0.2, 0.7, rng());
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * (R + 0.01), Math.sin(a) * (R + 0.01));
      ctx.stroke();
    }
  }
  // светлая древесина торца
  const Ri = R - bark;
  const cx = -R * 0.03;
  const cy = -R * 0.03;
  const dg = ctx.createRadialGradient(cx - Ri * 0.3, cy - Ri * 0.35, Ri * 0.05, cx, cy, Ri);
  dg.addColorStop(0, '#FCE2AE');
  dg.addColorStop(0.55, WOOD.light);
  dg.addColorStop(0.9, mix(WOOD.light, WOOD.base, 0.6));
  dg.addColorStop(1, WOOD.base);
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.arc(0, 0, Ri, 0, TAU);
  ctx.fill();
  // заболонь — тёмное кольцо у коры
  ctx.strokeStyle = rgba(WOOD.dark, 0.55);
  ctx.lineWidth = Ri * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, Ri - Ri * 0.04, 0, TAU);
  ctx.stroke();
  // годичные кольца (волнистые, сгущаются к краю)
  const rings = clamp(Math.floor((Ri * g.ppu) / 5), 2, 7);
  const ph = rng() * TAU;
  for (let k = 1; k <= rings; k++) {
    const t = Math.pow(k / (rings + 0.6), 0.85);
    const rr = Ri * t;
    ctx.strokeStyle = rgba(WOOD.grain, lerp(0.85, 0.55, t));
    ctx.lineWidth = det(g, lerp(0.009, 0.016, rng()), 0.75);
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU;
      const r = rr * (1 + 0.045 * Math.sin(a * 3 + k + ph) + 0.025 * Math.sin(a * 5 + ph * 2));
      const x = cx * (1 - t) + Math.cos(a) * r;
      const y = cy * (1 - t) + Math.sin(a) * r;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  // сердцевина
  ctx.fillStyle = WOOD.knot;
  ctx.beginPath();
  ctx.arc(cx, cy, det(g, Ri * 0.06, 1), 0, TAU);
  ctx.fill();
  // радиальные трещинки усушки
  if (Ri * g.ppu > 18) {
    const nc = 1 + Math.floor(rng() * 2);
    ctx.strokeStyle = rgba(WOOD.crack, 0.7);
    for (let i = 0; i < nc; i++) {
      const a = rng() * TAU;
      const r0 = Ri * lerp(0.15, 0.35, rng());
      ctx.lineWidth = det(g, 0.014, 1);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a + 0.05) * Ri * 0.95, cy + Math.sin(a + 0.05) * Ri * 0.95);
      ctx.stroke();
    }
  }
  // объём бревна
  const sg = ctx.createLinearGradient(-R * 0.7, -R * 0.7, R * 0.8, R * 0.8);
  sg.addColorStop(0, 'rgba(255,255,255,0.18)');
  sg.addColorStop(0.5, 'rgba(255,255,255,0)');
  sg.addColorStop(1, rgba(WOOD.deep, 0.35));
  ctx.fillStyle = sg;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  rimCircle(ctx, R, g.lw * 0.5 + det(g, 0.012, 0.8), det(g, 0.02, 1), '#E8B070', 0.7);
}

// ═════════════════════════════ ЛЁД ═════════════════════════════

// Читаемость на любом фоне (Б12): насыщенно-голубое полупрозрачное тело, кромка-«толща» плотнее середины,
// мягкая тёмно-синяя внутренняя тень вдоль всей кромки, толстая тёмная обводка (outlineWidth) и яркие белые блики
// поверх. Полоса-«толща» у края тонирована голубым, а не белым: белёсая кромка сливалась со снегом и облаками.

function paintIce(ctx: Ctx2D, g: Geo, seed: number): void {
  const rng = makeRng(hashSeed(seed, 0x1ce));
  const { w, h, mn } = g;
  const R = w / 2;
  const circle = g.shape === 'circle';
  ctx.save();
  ctx.clip(g.path);
  // 1) прозрачная середина: диагональный градиент, сквозь него виден фон
  const body = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  body.addColorStop(0, rgba(ICE.light, 0.82));
  body.addColorStop(0.42, rgba(ICE.base, 0.74));
  body.addColorStop(1, rgba(ICE.dark, 0.86));
  ctx.fillStyle = body;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  // 2) толстая кромка стекла: плотнее и насыщеннее середины (стекло у края «толще»)
  const e = clamp(0.17 * mn, 0.05, 0.15) + g.lw * 0.4;
  const inner: Pt[] = circle ? [] : insetPoly(g.poly, e);
  const innerPath = circle ? null : polyPath(inner);
  ctx.save();
  const ring = new Path2D();
  ring.addPath(g.path);
  if (circle) {
    ring.moveTo(R - e, 0);
    ring.arc(0, 0, R - e, 0, TAU, true);
  }
  else if (innerPath) ring.addPath(innerPath);
  ctx.clip(ring, 'evenodd');
  ctx.fillStyle = rgba(ICE.rim, 0.34);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  if (circle) bevelCircle(ctx, R, e, '#FFFFFF', ICE.deep, 0.75, 0.62);
  else bevelPoly(ctx, g.poly, e, '#FFFFFF', ICE.deep, 0.72, 0.58);
  // 3) внутренняя грань кромки: светлая по тёмным сторонам, тёмная по светлым (стекло «наоборот»)
  if (circle) {
    ctx.lineWidth = det(g, 0.012, 0.8);
    ctx.strokeStyle = rgba(ICE.deep, 0.45);
    ctx.beginPath();
    ctx.arc(0, 0, R - e, Math.PI * 1.0, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(0, 0, R - e, 0, Math.PI * 0.5);
    ctx.stroke();
  } else {
    const N = edgeNormals(g.poly);
    ctx.lineWidth = det(g, 0.012, 0.8);
    for (let i = 0; i < inner.length; i++) {
      const j = (i + 1) % inner.length;
      const s = lit(N[i]);
      ctx.strokeStyle = s > 0 ? rgba(ICE.deep, 0.45 * s) : `rgba(255,255,255,${(0.85 * -s).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(inner[i][0], inner[i][1]);
      ctx.lineTo(inner[j][0], inner[j][1]);
      ctx.stroke();
    }
  }
  // 4) середина: грани-фасетки и блики, только внутри кромки
  ctx.save();
  if (circle) {
    const ip = new Path2D();
    ip.arc(0, 0, R - e, 0, TAU);
    ctx.clip(ip);
  } else if (innerPath) ctx.clip(innerPath);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w * 0.15, -h / 2);
  ctx.lineTo(-w / 2, h * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = rgba(ICE.deep, 0.22);
  ctx.beginPath();
  ctx.moveTo(w / 2, h / 2);
  ctx.lineTo(-w * 0.1, h / 2);
  ctx.lineTo(w / 2, -h * 0.15);
  ctx.closePath();
  ctx.fill();
  // диагональные полосы-блики (−45°): широкая и узкая
  const d = Math.hypot(w, h);
  const off = lerp(-0.12, 0.05, rng()) * d;
  ctx.save();
  ctx.rotate(Math.PI / 4);
  // блики яркие: на насыщенном теле они и дают «стекло», а не белёсую заливку
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(off - mn * 0.09, -d, mn * 0.18, 2 * d);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(off + mn * 0.16, -d, mn * 0.06, 2 * d);
  if (g.mx / mn > 2.5) {
    // на длинных — повтор бликов
    const step = mn * 1.6;
    for (let k = 1; k * step < g.mx / 2 + mn; k++) {
      for (const sgn of [-1, 1]) {
        const o = off + (sgn * k * step) / Math.SQRT2;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(o - mn * 0.07, -d, mn * 0.14, 2 * d);
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(o + mn * 0.13, -d, mn * 0.05, 2 * d);
      }
    }
  }
  ctx.restore();
  ctx.restore();
  // 5) мягкое свечение-рефлекс снизу-справа и общий объём
  innerShadow(ctx, g.path, rgba(ICE.deep, 0.5), mn * 0.12, -0.03 * mn, -0.05 * mn, g.ppu, g.mx);
  // лёгкая внутренняя тень по всей кромке: тёмно-синий ореол изнутри обводки отделяет лёд от светлого фона
  const eb = Math.max(clamp(0.07 * mn, 0.025, 0.06), 2.5 * g.px);
  innerShadow(ctx, g.path, rgba(ICE.edge, 0.78), eb, 0, 0, g.ppu, g.mx);
  if (circle) {
    const sg = ctx.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.05, -R * 0.35, -R * 0.4, R * 0.55);
    sg.addColorStop(0, 'rgba(255,255,255,0.9)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.ellipse(-R * 0.33, -R * 0.38, R * 0.42, R * 0.28, -0.6, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // 6) белая кромка-блик у обводки (поверх внутренней тени — контраст «тёмное–белое» на освещённых гранях) и искорка
  if (circle) rimCircle(ctx, R, g.lw * 0.5 + det(g, 0.016, 1) * 0.6, det(g, 0.026, 1.3), '#FFFFFF', 1, 1.4);
  else rimPoly(ctx, g.poly, g.lw * 0.5 + det(g, 0.016, 1) * 0.6, det(g, 0.026, 1.3), '#FFFFFF', 1, 0.15);
  const sp = clamp(mn * 0.13, 0.03, 0.09);
  if (sp * g.ppu >= 3) {
    let sx = -w / 2 + e + sp * 0.6;
    let sy = -h / 2 + e + sp * 0.6;
    if (g.shape === 'isoTriangle') {
      sx = -w * 0.12;
      sy = h * 0.05;
    } else if (g.shape === 'triangle') {
      sx = -w / 2 + e + sp * 0.8;
      sy = 0;
    } else if (circle) {
      sx = -R * 0.45;
      sy = -R * 0.45;
    }
    sparkle(ctx, sx, sy, sp);
  }
}

/** Четырёхлучевая искорка. */
function sparkle(ctx: Ctx2D, x: number, y: number, s: number): void {
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x, y, x + s * 0.7, y);
  ctx.quadraticCurveTo(x, y, x, y + s * 0.7);
  ctx.quadraticCurveTo(x, y, x - s * 0.7, y);
  ctx.quadraticCurveTo(x, y, x, y - s);
  ctx.fill();
  const gl = ctx.createRadialGradient(x, y, 0, x, y, s * 0.9);
  gl.addColorStop(0, 'rgba(255,255,255,0.7)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(x, y, s * 0.9, 0, TAU);
  ctx.fill();
}

// ═════════════════════════════ КАМЕНЬ ═════════════════════════════

function paintStone(ctx: Ctx2D, g: Geo, seed: number): void {
  const rng = makeRng(hashSeed(seed, 0x570e));
  const { w, h, mn, mx } = g;
  const circle = g.shape === 'circle';
  ctx.save();
  ctx.clip(g.path);
  const base = ctx.createLinearGradient(-w * 0.2, -h / 2, w * 0.2, h / 2);
  base.addColorStop(0, STONE.light);
  base.addColorStop(0.4, STONE.base);
  base.addColorStop(1, STONE.dark);
  ctx.fillStyle = base;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  // крупные пятна-«грани» и шумовая фактура
  const blobs = Math.max(2, Math.round(w * h * 3));
  for (let i = 0; i < blobs; i++) {
    const bx = lerp(-w / 2, w / 2, rng());
    const by = lerp(-h / 2, h / 2, rng());
    const br = mn * lerp(0.25, 0.55, rng());
    const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const col = rng() < 0.5 ? '#FFFFFF' : STONE.deep;
    bg.addColorStop(0, rgba(col, col === '#FFFFFF' ? 0.14 : 0.16));
    bg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = bg;
    ctx.fillRect(bx - br, by - br, 2 * br, 2 * br);
  }
  fillTile(ctx, stoneTile(), 1, rng() * 1, rng() * 1, -w / 2, -h / 2, w, h);
  // крапины
  const n = Math.min(400, Math.round(w * h * 45));
  const minR = 0.6 / g.ppu;
  for (let i = 0; i < n; i++) {
    const r = Math.max(minR, lerp(0.005, 0.015, rng()));
    ctx.fillStyle = rng() < 0.6 ? rgba(STONE.deep, 0.5) : rgba('#F2F4F6', 0.45);
    ctx.beginPath();
    ctx.arc(lerp(-w / 2, w / 2, rng()), lerp(-h / 2, h / 2, rng()), r, 0, TAU);
    ctx.fill();
  }
  // выбоинки: тёмная лунка + освещённый нижне-правый край
  const pits = mn * g.ppu > 20 ? Math.round(w * h * 4 + rng() * 2) : 0;
  for (let i = 0; i < pits; i++) {
    const x = lerp(-w / 2 + 0.08, w / 2 - 0.08, rng());
    const y = lerp(-h / 2 + 0.08, h / 2 - 0.08, rng());
    const r = Math.max(1.2 / g.ppu, lerp(0.018, 0.04, rng()));
    pit(ctx, x, y, r, rng() * TAU);
  }
  // длинные блоки — плиты со швами
  if (!circle && g.shape === 'rect' && mx / mn > 2.2) {
    const horiz = w > h;
    const k = Math.max(1, Math.round(mx / (mn * 2)) - 1);
    for (let i = 1; i <= k; i++) {
      const t = -mx / 2 + (i * mx) / (k + 1) + (rng() - 0.5) * mn * 0.3;
      const pts: Pt[] = [];
      for (let j = 0; j <= 3; j++) {
        const u = -mn / 2 - 0.02 + (j * (mn + 0.04)) / 3;
        pts.push([t + (rng() - 0.5) * mn * 0.05, u]);
      }
      const P: Pt[] = horiz ? pts : pts.map(([a, b]) => [b, a] as Pt);
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgba('#FFFFFF', 0.55);
      ctx.lineWidth = det(g, 0.012, 0.8);
      ctx.beginPath();
      P.forEach(([x, y], q) => (q ? ctx.lineTo(x + 0.012, y + 0.012) : ctx.moveTo(x + 0.012, y + 0.012)));
      ctx.stroke();
      ctx.strokeStyle = rgba(STONE.deep, 0.95);
      ctx.lineWidth = det(g, 0.022, 1);
      ctx.beginPath();
      P.forEach(([x, y], q) => (q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }
  if (circle) {
    // валун: мягкая сфера
    const R = w / 2;
    const rg = ctx.createRadialGradient(-R * 0.36, -R * 0.4, R * 0.08, -R * 0.1, -R * 0.1, R * 1.15);
    rg.addColorStop(0, 'rgba(255,255,255,0.38)');
    rg.addColorStop(0.45, 'rgba(255,255,255,0)');
    rg.addColorStop(0.8, rgba(STONE.deep, 0.25));
    rg.addColorStop(1, rgba('#1C2026', 0.45));
    ctx.fillStyle = rg;
    ctx.fillRect(-R, -R, 2 * R, 2 * R);
    bevelCircle(ctx, R, clamp(0.12 * mn, 0.03, 0.08), '#FFFFFF', STONE.deep, 0.35, 0.3);
  } else {
    innerShadow(ctx, g.path, rgba('#1C2026', 0.5), mn * 0.12, -0.02 * mn, -0.05 * mn, g.ppu, g.mx);
    bevelPoly(ctx, g.poly, clamp(0.18 * mn, 0.03, 0.09) + g.lw * 0.35, STONE.light, STONE.deep, 0.85, 0.7);
  }
  ctx.restore();
  if (circle) rimCircle(ctx, w / 2, g.lw * 0.5 + det(g, 0.012, 0.8), det(g, 0.018, 1), '#FFFFFF', 0.6, 1.2);
  else rimPoly(ctx, g.poly, g.lw * 0.5 + det(g, 0.012, 0.8) * 0.6, det(g, 0.018, 1), '#FFFFFF', 0.7);
}

/** Выбоинка в камне. */
function pit(ctx: Ctx2D, x: number, y: number, r: number, rot: number): void {
  ctx.fillStyle = rgba(STONE.deep, 0.7);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.75, rot, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = r * 0.4;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.9, r * 0.7, rot, -0.2, Math.PI * 0.7);
  ctx.stroke();
}

// ═════════════════════════════ ПОВРЕЖДЕНИЯ ═════════════════════════════

function paintDamage(ctx: Ctx2D, material: Material, g: Geo, stage: number, seed: number): void {
  const M = MATERIALS[material];
  const crng = makeRng(hashSeed(seed, 0xc4ac));
  ctx.save();
  ctx.clip(g.path);
  if (material === 'ice') iceDamage(ctx, g, stage, crng);
  else {
    const wood = material === 'wood';
    // длинным блокам — больше трещин (те же правила накопления)
    const fac = clamp(Math.round(Math.sqrt(g.mx / (1.5 * g.mn))), 1, 2);
    const grain = g.shape === 'circle' ? null : g.shape === 'rect' && g.h > g.w ? Math.PI / 2 : 0;
    const table = wood ? CRACKS_WOOD : CRACKS_STONE;
    const cracks = genCracks(
      crng,
      g.poly,
      g.mn,
      g.mx,
      table[3] * fac,
      wood ? 0.075 : 0.06,
      wood ? 0.28 : 0.62,
      wood ? 0.14 : 0.24,
      wood ? grain : null,
      0.12,
    );
    const reveal = table[stage] * fac;
    const wMain = wood ? clamp(0.06 * g.mn + 0.014, 0.022, 0.045) : clamp(0.045 * g.mn + 0.016, 0.022, 0.04);
    const wd = Math.max(wMain, 1.7 / g.ppu);
    const shown: Crack[] = cracks.filter((cr) => cr.main < reveal);
    for (const cr of shown) {
      // у кромки трещина раскрывается клином
      if (cr.wk >= 1 && cr.pts.length > 3) crackWedge(ctx, cr.pts, wd * (wood ? 1 : 0.8), wood ? M.crack : rgba(M.crack, 0.85));
      strokeCrack(ctx, cr.pts, wd * cr.wk, M.crack, rgba(M.crackLight, wood ? 0.6 : 0.5), wd * (wood ? 0.45 : 0.38));
    }
    if (!wood && stage >= 3) {
      // крошка у трещин: выбоинки
      const prng = makeRng(hashSeed(seed, 0x9e7));
      for (const cr of shown) {
        if (cr.wk < 1) continue;
        const p = cr.pts[Math.floor(prng() * cr.pts.length)];
        const r = Math.max(1.2 / g.ppu, lerp(0.022, 0.04, prng()));
        pit(ctx, p[0] + (prng() - 0.5) * 0.06, p[1] + (prng() - 0.5) * 0.06, r, prng() * TAU);
      }
    }
  }
  ctx.restore();
  // сколы углов (у круга — выкусы кромки)
  if (stage >= 2) {
    const rng = makeRng(hashSeed(seed, 0xc41));
    const size = clamp(0.22 * g.mn, 0.04, 0.16) * (stage === 3 ? 1.3 : 0.8);
    const count = stage === 3 ? 2 : 1;
    if (g.shape === 'circle') {
      const R = g.w / 2;
      for (let i = 0; i < count; i++) {
        const a = rng() * TAU;
        const bite = edgeBitePath(rng, Math.cos(a) * R, Math.sin(a) * R, Math.cos(a), Math.sin(a), size * 0.75, g.lw);
        cutChip(ctx, bite, g.path, M.outline, M.fresh, g.lw);
      }
    } else {
      const nC = g.poly.length;
      const first = Math.floor(rng() * nC);
      for (let i = 0; i < count; i++) {
        const corner = (first + i * (nC === 4 ? 2 : 1) + (i > 0 && rng() < 0.5 ? 1 : 0)) % nC;
        const chip = cornerChipPath(rng, g.poly, corner, size, g.lw);
        cutChip(ctx, chip, g.path, M.outline, M.fresh, g.lw);
      }
      // длинные блоки на последней стадии — выкус на длинной кромке
      if (stage === 3 && g.mx / g.mn > 2.5 && g.shape === 'rect') {
        const horiz = g.w >= g.h;
        const t = lerp(-0.3, 0.3, rng()) * g.mx;
        const side = rng() < 0.5 ? -1 : 1;
        const x = horiz ? t : (side * g.w) / 2;
        const y = horiz ? (side * g.h) / 2 : t;
        const bite = edgeBitePath(rng, x, y, horiz ? 0 : side, horiz ? side : 0, size * 0.7, g.lw);
        cutChip(ctx, bite, g.path, M.outline, M.fresh, g.lw);
      }
    }
  }
}

/** Тёмный клин раскрытия трещины у кромки (первые сегменты), со светлой стенкой снизу-справа. */
function crackWedge(ctx: Ctx2D, pts: readonly Pt[], wd: number, dark: string): void {
  const m = Math.min(pts.length - 1, 3);
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[m];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const half = wd * 1.5;
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x0 + nx * half - (dx / L) * wd, y0 + ny * half - (dy / L) * wd);
  for (let i = 1; i <= m; i++) {
    const k = 1 - i / (m + 0.3);
    ctx.lineTo(pts[i][0] + nx * half * k, pts[i][1] + ny * half * k);
  }
  for (let i = m; i >= 1; i--) {
    const k = 1 - i / (m + 0.3);
    ctx.lineTo(pts[i][0] - nx * half * k, pts[i][1] - ny * half * k);
  }
  ctx.lineTo(x0 - nx * half - (dx / L) * wd, y0 - ny * half - (dy / L) * wd);
  ctx.closePath();
  ctx.fill();
}

/** Лёд: помутнение + «паутина» трещин от точки удара, на стадии 3 — выпавший осколок. */
function iceDamage(ctx: Ctx2D, g: Geo, stage: number, rng: () => number): void {
  const { w, h, mn } = g;
  // помутнение: пятнистая белая дымка, нарастает со стадией
  const frost = [0, 0.14, 0.26, 0.38][stage];
  ctx.save();
  ctx.globalAlpha = frost;
  fillTile(ctx, frostTile(), 1.2, rng(), rng(), -w / 2, -h / 2, w, h);
  ctx.restore();
  const webs = g.mx / mn > 3 ? 2 : 1;
  const lw = Math.max(clamp(0.035 * mn + 0.008, 0.012, 0.026), 1.1 / g.ppu);
  const [cx0, cy0] = centroid(g.poly);
  for (let k = 0; k < webs; k++) {
    const st = k === 0 ? stage : stage - 1;
    // точки удара берём всегда (детерминизм не зависит от стадии)
    const horiz = w >= h;
    const along = webs === 2 ? (k === 0 ? -0.22 : 0.25) * g.mx : 0;
    const px = cx0 + (horiz ? along : 0) + lerp(-0.25, 0.25, rng()) * (webs === 2 && horiz ? mn : w) * 0.6;
    const py = cy0 + (horiz ? 0 : along) + lerp(-0.25, 0.25, rng()) * (webs === 2 && !horiz ? mn : h) * 0.6;
    const spokes = 7;
    const ang: number[] = [];
    for (let i = 0; i < spokes; i++) ang.push(((i + rng() * 0.6) / spokes) * TAU);
    const lens: number[] = [];
    for (let i = 0; i < spokes; i++) lens.push(lerp(0.6, 1, rng()));
    if (st <= 0) continue;
    const R = webs === 2 ? Math.hypot(g.mx * 0.5, mn) : Math.hypot(w, h);
    const lenK = [0, 0.35, 0.75, 1.2][st];
    const nSp = [0, 3, 5, 7][st];
    const webSeed = hashSeed(Math.floor(px * 1000) + 5000, Math.floor(py * 1000) + 5000, k);
    const crng = makeRng(hashSeed(webSeed, 99));
    // помутнение вокруг удара
    const fg = ctx.createRadialGradient(px, py, 0, px, py, mn * (0.35 + 0.15 * st));
    fg.addColorStop(0, `rgba(255,255,255,${(0.22 + 0.12 * st).toFixed(3)})`);
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    const spokePts: Pt[][] = [];
    for (let i = 0; i < nSp; i++) {
      // у каждой спицы свой ГПСЧ: на следующей стадии спица только удлиняется
      const srng = makeRng(hashSeed(webSeed, i));
      const pts: Pt[] = [[px, py]];
      let x = px;
      let y = py;
      let a = ang[i];
      const L = R * lenK * lens[i];
      for (let s = 0; s < L; s += 0.06) {
        a += (srng() - 0.5) * 0.3;
        x += Math.cos(a) * 0.06;
        y += Math.sin(a) * 0.06;
        pts.push([x, y]);
      }
      spokePts.push(pts);
    }
    const line = (pts: readonly Pt[]) => {
      if (pts.length < 2) return;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = rgba(ICE.crackDark, 0.7);
      ctx.lineWidth = lw * 1.9;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = lw * 0.8;
      ctx.stroke();
    };
    // на стадии 3 — выпавший осколок между спицами 1 и 2
    if (st === 3 && spokePts[1] && spokePts[2]) {
      const a = spokePts[1][Math.floor(spokePts[1].length * 0.6)];
      const b = spokePts[2][Math.floor(spokePts[2].length * 0.6)];
      const hole = new Path2D();
      hole.moveTo(px, py);
      hole.lineTo(a[0], a[1]);
      hole.lineTo((a[0] + b[0]) / 2 + (crng() - 0.5) * 0.05, (a[1] + b[1]) / 2 + (crng() - 0.5) * 0.05);
      hole.lineTo(b[0], b[1]);
      hole.closePath();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill(hole);
      ctx.restore();
      ctx.fillStyle = rgba(ICE.deep, 0.35);
      ctx.fill(hole);
      ctx.strokeStyle = rgba(ICE.outline, 0.8);
      ctx.lineWidth = lw * 1.4;
      ctx.stroke(hole);
    }
    for (const s of spokePts) line(s);
    const rings = st >= 2 ? (st === 3 ? [0.3, 0.6] : [0.35]) : [];
    for (const rk of rings) {
      for (let i = 0; i < spokePts.length - 1; i++) {
        const a = spokePts[i];
        const b = spokePts[i + 1];
        const ia = Math.min(a.length - 1, Math.floor(a.length * rk));
        const ib = Math.min(b.length - 1, Math.floor(b.length * rk * lerp(0.8, 1.2, crng())));
        line([a[ia], [(a[ia][0] + b[ib][0]) / 2 + (crng() - 0.5) * 0.04, (a[ia][1] + b[ib][1]) / 2 + (crng() - 0.5) * 0.04], b[ib]]);
      }
    }
    // точка удара — звёздочка помутнения
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(px, py, lw * 2.4, 0, TAU);
    ctx.fill();
  }
}

// ═════════════════════════════ TNT ═════════════════════════════

const TNT_FONT = '"Luckiest Guy", "Rubik", "Arial Black", sans-serif';

/** Ящик TNT size×size; (ox, oy) — центр. Шрифт Luckiest Guy должен быть загружен до вызова. */
export function renderTnt(sizeM: number, ppu: number): Sprite {
  const s = Math.max(0.2, sizeM);
  const lw = Math.max(OUT_BLOCK, 1.5 / ppu);
  const { c, ctx, ox, oy } = beginCentered(s, s, lw / 2 + 3 / ppu, ppu);
  const g = makeGeo('wood', 'rect', s, s, ppu, lw);
  const rng = makeRng(77);
  ctx.save();
  ctx.clip(g.path);
  if (s * ppu >= 26) woodCrate(ctx, g, rng);
  else woodPlanks(ctx, g, rng);
  innerShadow(ctx, g.path, rgba(WOOD.deep, 0.55), s * 0.14, -0.02 * s, -0.05 * s, ppu, s);
  bevelPoly(ctx, g.poly, clamp(0.16 * s, 0.025, 0.07) + lw * 0.35, WOOD.light, WOOD.deep, 0.85, 0.6);
  ctx.restore();
  rimPoly(ctx, g.poly, lw * 0.5 + det(g, 0.014, 0.8) * 0.6, det(g, 0.018, 1), '#FFF1D2', 0.8);
  ctx.lineWidth = lw;
  ctx.strokeStyle = WOOD.outline;
  ctx.stroke(g.path);
  // красная табличка
  const pw = s * 0.82;
  const ph = s * 0.4;
  const pr = s * 0.07;
  ctx.fillStyle = 'rgba(42,20,6,0.45)';
  ctx.beginPath();
  ctx.roundRect(-pw / 2 + s * 0.025, -ph / 2 + s * 0.04, pw, ph, pr);
  ctx.fill();
  const plate = new Path2D();
  plate.roundRect(-pw / 2, -ph / 2, pw, ph, pr);
  const pg = ctx.createLinearGradient(0, -ph / 2, 0, ph / 2);
  pg.addColorStop(0, '#F25A44');
  pg.addColorStop(0.45, '#D9342B');
  pg.addColorStop(1, '#A51F18');
  ctx.fillStyle = pg;
  ctx.fill(plate);
  ctx.save();
  ctx.clip(plate);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.roundRect(-pw / 2 + s * 0.04, -ph / 2 + s * 0.03, pw - s * 0.08, ph * 0.26, ph * 0.12);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = Math.max(lw * 0.85, 1.3 / ppu);
  ctx.strokeStyle = '#4A0E08';
  ctx.stroke(plate);
  // заклёпки
  const rr = s * 0.028;
  if (rr * ppu >= 1.4) {
    for (const [x, y] of [
      [-pw / 2 + s * 0.06, -ph / 2 + s * 0.06],
      [pw / 2 - s * 0.06, -ph / 2 + s * 0.06],
      [-pw / 2 + s * 0.06, ph / 2 - s * 0.06],
      [pw / 2 - s * 0.06, ph / 2 - s * 0.06],
    ] as const) {
      const rg = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, rr * 0.1, x, y, rr);
      rg.addColorStop(0, '#FFE6C2');
      rg.addColorStop(1, '#8A2A1C');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, TAU);
      ctx.fill();
    }
  }
  // надпись: рисуем в пикселях (мелкие кегли в метрах браузер округляет)
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, ox, oy);
  let fs = ph * 0.86 * ppu;
  ctx.font = `400 ${fs.toFixed(2)}px ${TNT_FONT}`;
  const mw = ctx.measureText('TNT').width;
  const maxW = pw * 0.8 * ppu;
  if (mw > maxW) {
    fs *= maxW / mw;
    ctx.font = `400 ${fs.toFixed(2)}px ${TNT_FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('TNT');
  const asc = m.actualBoundingBoxAscent || fs * 0.7;
  const desc = m.actualBoundingBoxDescent || 0;
  const ty = (asc - desc) / 2;
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(60,8,4,0.45)';
  ctx.fillText('TNT', fs * 0.03, ty + fs * 0.06);
  ctx.lineWidth = Math.max(1.5, fs * 0.16);
  ctx.strokeStyle = '#4A0E08';
  ctx.strokeText('TNT', 0, ty);
  const tg = ctx.createLinearGradient(0, ty - asc, 0, ty + desc);
  tg.addColorStop(0, '#FFFDF2');
  tg.addColorStop(0.55, '#FFF1CC');
  tg.addColorStop(1, '#FFCB6B');
  ctx.fillStyle = tg;
  ctx.fillText('TNT', 0, ty);
  ctx.restore();
  return { canvas: c, ox, oy, ppu };
}

// ═════════════════════════════ ЯЙЦО ═════════════════════════════

/** Яйцо Матильды; (ox, oy) — центр круга коллизии радиуса radiusM (низ яйца — на его нижней точке). */
export function renderEgg(radiusM: number, ppu: number): Sprite {
  const r = Math.max(0.05, radiusM);
  const top = -1.22 * r;
  const bottom = r;
  const halfW = 0.9 * r;
  const lw = Math.max(0.07 * r, 1.5 / ppu);
  const pad = lw / 2 + 3 / ppu;
  const c = createCanvas((2 * halfW + 2 * pad) * ppu, (bottom - top + 2 * pad) * ppu);
  const ctx = ctx2d(c);
  const ox = c.width / 2;
  const oy = (pad - top) * ppu;
  ctx.setTransform(ppu, 0, 0, ppu, ox, oy);
  // контур: эллипс, расширенный книзу
  const yc = (top + bottom) / 2;
  const ry = (bottom - top) / 2;
  const k = 0.13;
  const a = halfW / 1.008;
  const egg = new Path2D();
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * TAU;
    const x = a * Math.cos(t) * (1 + k * Math.sin(t));
    const y = yc + ry * Math.sin(t);
    if (i) egg.lineTo(x, y);
    else egg.moveTo(x, y);
  }
  egg.closePath();
  const bg = ctx.createRadialGradient(-0.32 * r, -0.62 * r, 0.05 * r, -0.12 * r, -0.2 * r, 1.35 * r);
  bg.addColorStop(0, '#FFFFFF');
  bg.addColorStop(0.42, '#F6F1E7');
  bg.addColorStop(0.8, '#D8CFBF');
  bg.addColorStop(1, '#B3A794');
  ctx.fillStyle = bg;
  ctx.fill(egg);
  ctx.save();
  ctx.clip(egg);
  // собственная тень снизу-справа и отражённый свет снизу
  const sg = ctx.createRadialGradient(-0.3 * r, -0.55 * r, 0.6 * r, -0.3 * r, -0.55 * r, 1.9 * r);
  sg.addColorStop(0, 'rgba(112,96,78,0)');
  sg.addColorStop(0.7, 'rgba(112,96,78,0.22)');
  sg.addColorStop(1, 'rgba(112,96,78,0.5)');
  ctx.fillStyle = sg;
  ctx.fillRect(-r * 1.2, top - r * 0.1, r * 2.4, bottom - top + r * 0.2);
  ctx.restore();
  innerShadow(ctx, egg, 'rgba(255,248,230,0.65)', 0.06 * r, 0.01 * r, -0.05 * r, ppu, r * 1.3);
  innerShadow(ctx, egg, 'rgba(255,255,255,0.9)', 0.08 * r, 0.05 * r, 0.07 * r, ppu, r * 1.3);
  // глянцевый блик
  ctx.save();
  ctx.translate(-0.36 * r, -0.62 * r);
  ctx.rotate(-0.5);
  const gl = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.3 * r);
  gl.addColorStop(0, 'rgba(255,255,255,0.95)');
  gl.addColorStop(0.6, 'rgba(255,255,255,0.6)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.scale(1, 0.55);
  ctx.fillStyle = gl;
  ctx.beginPath();
  ctx.arc(0, 0, 0.3 * r, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.ellipse(-0.12 * r, -0.95 * r, Math.max(0.06 * r, 0.8 / ppu), Math.max(0.035 * r, 0.6 / ppu), -0.4, 0, TAU);
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw;
  ctx.strokeStyle = '#4A4136';
  ctx.stroke(egg);
  return { canvas: c, ox, oy, ppu };
}

// ═════════════════════════════ ОСКОЛКИ ═════════════════════════════

/**
 * Спрайт осколка для частиц: щепка (wood), осколок стекла (ice), камушек (stone).
 * sizePx — наибольший размер в пикселях; 8 вариантов по seed & 7. Центр фигуры — в центре холста.
 */
export function renderDebris(material: Material, sizePx: number, seed: number): AnyCanvas {
  const S = Math.max(4, sizePx);
  const v = seedInt(seed) & 7;
  const rng = makeRng(hashSeed(v, material === 'wood' ? 1 : material === 'ice' ? 2 : 3, 0xdeb));
  const pad = 3;
  const size = Math.ceil(S * 1.08 + 2 * pad);
  const c = createCanvas(size, size);
  const ctx = ctx2d(c);
  ctx.translate(size / 2, size / 2);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const olw = clamp(S * 0.09, 1.1, 2.4);
  const L = S / 2 - olw / 2;
  if (material === 'wood') {
    // щепка: вытянутый многоугольник с рваными концами
    ctx.rotate(lerp(-0.25, 0.25, rng()));
    const t = L * lerp(0.2, 0.34, rng());
    const pts: Pt[] = [
      [-L, lerp(-0.2, 0.3, rng()) * t],
      [-L * lerp(0.78, 0.9, rng()), -t * lerp(0.3, 0.6, rng())],
      [-L * lerp(0.6, 0.72, rng()), -t],
      [L * lerp(0.3, 0.6, rng()), -t * lerp(0.75, 1, rng())],
      [L * lerp(0.75, 0.85, rng()), -t * lerp(0.1, 0.5, rng())],
      [L, lerp(-0.5, 0.1, rng()) * t],
      [L * lerp(0.82, 0.92, rng()), t * lerp(0.1, 0.4, rng())],
      [L * lerp(0.65, 0.75, rng()), t * lerp(0.4, 0.8, rng())],
      [L * lerp(0.2, 0.5, rng()), t],
      [-L * lerp(0.55, 0.75, rng()), t * lerp(0.7, 1, rng())],
      [-L * lerp(0.82, 0.92, rng()), t * lerp(0.2, 0.5, rng())],
    ];
    const p = polyPath(pts);
    const g = ctx.createLinearGradient(0, -t, 0, t);
    g.addColorStop(0, WOOD.light);
    g.addColorStop(0.5, rng() < 0.5 ? WOOD.base : mix(WOOD.base, WOOD.light, 0.4));
    g.addColorStop(1, WOOD.dark);
    ctx.fillStyle = g;
    ctx.fill(p);
    if (S >= 9) {
      ctx.save();
      ctx.clip(p);
      ctx.strokeStyle = rgba(WOOD.grain, 0.7);
      ctx.lineWidth = Math.max(0.8, S * 0.04);
      ctx.beginPath();
      ctx.moveTo(-L, t * 0.15);
      ctx.quadraticCurveTo(0, -t * 0.25, L, t * 0.05);
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = olw;
    ctx.strokeStyle = WOOD.outline;
    ctx.stroke(p);
  } else if (material === 'ice') {
    // осколок стекла: неровный треугольник/четырёхугольник
    ctx.rotate(rng() * TAU);
    const n = rng() < 0.5 ? 3 : 4;
    const pts: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (rng() - 0.5) * 0.7;
      const rr = L * lerp(0.65, 1, rng());
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * lerp(0.7, 1, rng())]);
    }
    const p = polyPath(pts);
    const g = ctx.createLinearGradient(-L, -L, L, L);
    g.addColorStop(0, 'rgba(214,245,255,0.97)');
    g.addColorStop(0.5, 'rgba(124,205,244,0.93)');
    g.addColorStop(1, 'rgba(62,159,221,0.95)');
    ctx.fillStyle = g;
    ctx.fill(p);
    ctx.lineWidth = olw;
    ctx.strokeStyle = ICE.outline;
    ctx.stroke(p);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(0.9, olw * 0.6);
    ctx.beginPath();
    ctx.moveTo(lerp(pts[0][0], pts[1][0], 0.2) * 0.7, lerp(pts[0][1], pts[1][1], 0.2) * 0.7);
    ctx.lineTo(lerp(pts[0][0], pts[1][0], 0.8) * 0.7, lerp(pts[0][1], pts[1][1], 0.8) * 0.7);
    ctx.stroke();
  } else {
    // камушек: неправильный многоугольник со скруглением
    const n = 6 + Math.floor(rng() * 3);
    const pts: Pt[] = [];
    const sy = lerp(0.65, 0.95, rng());
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (rng() - 0.5) * 0.4;
      const rr = L * lerp(0.72, 1, rng());
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr * sy]);
    }
    const p = polyPath(pts);
    const g = ctx.createRadialGradient(-L * 0.35, -L * 0.4, L * 0.1, 0, 0, L * 1.1);
    g.addColorStop(0, STONE.light);
    g.addColorStop(0.55, rng() < 0.5 ? STONE.base : mix(STONE.base, STONE.dark, 0.4));
    g.addColorStop(1, STONE.deep);
    ctx.fillStyle = g;
    ctx.fill(p);
    if (S >= 8) {
      ctx.fillStyle = rgba(STONE.deep, 0.6);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(lerp(-L, L, rng()) * 0.5, lerp(-L, L, rng()) * 0.4, Math.max(0.6, S * 0.035), 0, TAU);
        ctx.fill();
      }
    }
    ctx.lineWidth = olw;
    ctx.strokeStyle = STONE.outline;
    ctx.stroke(p);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = Math.max(0.8, olw * 0.55);
    ctx.beginPath();
    ctx.arc(0, 0, L * 0.62, Math.PI * 1.05, Math.PI * 1.45);
    ctx.stroke();
  }
  return c;
}
