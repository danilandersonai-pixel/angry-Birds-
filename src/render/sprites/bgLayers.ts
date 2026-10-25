// Построители слоёв параллакс-фона (04 §5): горы, гряда, холмы, деревья с валом, море, острова, облака, ореол.
// Каждый построитель рисует ОДИН период слоя в «метрах слоя» (ось Y вверх, 0 — база слоя) и отмечает высоты
// содержимого по столбцам (Tops) — движок полос (background.ts) режет по ним прозрачный верх тайлов.

import type { ThemeId } from '../../core/types';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import { TAU, clamp, lerp, mix, rand, rgba } from './paint';
import { THEME_PALETTES, type HillPal, type RangePal, type ThemePalette, type TreePal } from './themes';

/** Ширина столбца для обрезки прозрачного верха полосы, м слоя. */
export const BIN_M = 1;

/** Максимальная высота содержимого по столбцам периода (для обрезки прозрачного верха). */
export class Tops {
  readonly n: number;
  readonly v: Float32Array;
  constructor(period: number) {
    this.n = Math.ceil(period / BIN_M);
    this.v = new Float32Array(this.n).fill(-1e9);
  }
  /** Содержимое в [x0, x1] (м слоя, с переносом через период) поднимается до top. */
  mark(x0: number, x1: number, top: number): void {
    const i0 = Math.floor(x0 / BIN_M);
    const i1 = Math.floor(x1 / BIN_M);
    for (let i = i0; i <= i1; i++) {
      const k = ((i % this.n) + this.n) % this.n;
      if (top > this.v[k]) this.v[k] = top;
    }
  }
}

export interface BuildOut {
  /** Цвет нижнего края (заливка до низа экрана) или null — слой не непрозрачен снизу. */
  fill: string | null;
  /** Высота над базой (м слоя), ниже которой полоса непрозрачна по всей ширине. */
  opaqueTop: number;
}

export interface StripLayer {
  id: string;
  f: number;
  period: number;
  baseY: number;
  height: number;
  depth: number;
  /** Доля разрешения при dpr > 1.25 (только дальние слои: горы, море, острова; ближние — 1:1). */
  res: number;
  seed: number;
  /** Нарисовать один период в «метрах слоя» (Y вверх, 0 — база) и отметить высоты содержимого. */
  build: (c: Ctx2D, L: StripLayer, P: ThemePalette, tops: Tops) => BuildOut;
  /** Дымка после построения (атмосферная перспектива). */
  haze?: number;
}

export interface CloudItem {
  x: number;
  y: number;
  w: number;
  seed: number;
}

export interface CloudLayer {
  f: number;
  period: number;
  baseY: number;
  drift: number;
  items: CloudItem[];
}

function makeClouds(seed: number, count: number, P: number, wMin: number, wMax: number, yMin: number, yMax: number): CloudItem[] {
  const r = rand(seed);
  const out: CloudItem[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: ((i + r() * 0.6) * P) / count, y: lerp(yMin, yMax, r()), w: lerp(wMin, wMax, r()), seed: Math.floor(r() * 1e6) });
  }
  return out;
}

// ───────────────────────── профили силуэтов ─────────────────────────

/** Гладкий периодический профиль: Σ a·sin(2πk·x/P + φ). */
function sineProfile(seed: number, P: number, terms: Array<[number, number]>): (x: number) => number {
  const r = rand(seed);
  const t = terms.map(([k, a]) => ({ k, a, ph: r() * TAU }));
  return (x) => {
    let h = 0;
    for (const q of t) h += q.a * Math.sin((TAU * q.k * x) / P + q.ph);
    return h;
  };
}

/** Гребенчатый периодический профиль (острые вершины): Σ a·(1 − |sin(πk·x/P + φ)|). */
function ridgedProfile(seed: number, P: number, terms: Array<[number, number]>): (x: number) => number {
  const r = rand(seed);
  const t = terms.map(([k, a]) => ({ k, a, ph: r() * Math.PI }));
  return (x) => {
    let h = 0;
    for (const q of t) h += q.a * (1 - Math.abs(Math.sin((Math.PI * q.k * x) / P + q.ph)));
    return h;
  };
}

function sample(P: number, perM: number, H: (x: number) => number): Array<[number, number]> {
  const N = Math.ceil(P * perM);
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * P;
    pts.push([x, H(x)]);
  }
  return pts;
}

function markProfile(tops: Tops, pts: Array<[number, number]>, extra: number): number {
  let min = Infinity;
  for (const [x, y] of pts) {
    tops.mark(x, x, y + extra);
    min = Math.min(min, y);
  }
  return min;
}

function silhouette(c: Ctx2D, pts: Array<[number, number]>, bottom: number): void {
  c.beginPath();
  c.moveTo(pts[0][0], bottom);
  for (const p of pts) c.lineTo(p[0], p[1]);
  c.lineTo(pts[pts.length - 1][0], bottom);
  c.closePath();
}

/** Тень на склонах, обращённых от света (H убывает вправо): клин между гребнем и его смещённой копией. */
function slopeShade(c: Ctx2D, pts: Array<[number, number]>, kx: number, ky: number): void {
  const N = pts.length - 1;
  c.beginPath();
  for (let i = 0; i < N; ) {
    if (pts[i + 1][1] < pts[i][1]) {
      const s = i;
      while (i < N && pts[i + 1][1] < pts[i][1]) i++;
      c.moveTo(pts[s][0], pts[s][1]);
      for (let j = s; j <= i; j++) c.lineTo(pts[j][0], pts[j][1]);
      for (let j = i; j >= s; j--) {
        const dh = pts[s][1] - pts[j][1];
        c.lineTo(pts[j][0] - dh * kx, pts[j][1] - dh * ky - 0.01);
      }
      c.closePath();
    } else i++;
  }
}

function strokeLine(c: Ctx2D, pts: Array<[number, number]>, dy: number): void {
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1] + dy) : c.moveTo(p[0], p[1] + dy)));
  c.stroke();
}

/** Вертикальный градиент [y0 → y1] (м слоя) из N+1 стопов col(y) — для «запечённой» дымки без отдельного прохода. */
function vGrad(c: Ctx2D, y0: number, y1: number, col: (y: number) => string, N = 12): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i <= N; i++) g.addColorStop(i / N, col(lerp(y0, y1, i / N)));
  return g;
}

// ───────────────────────── горы ─────────────────────────

/**
 * Горный хребет: градиент, теневые склоны, снег, светлый гребень. Дымка у подножия сразу входит в цвета
 * всех заливок (α(y) растёт книзу). Снег — шапки от гребня: толщина растёт с высотой пика над волнистой
 * снеговой линией (в сёдлах снега нет), нижний край — редкие крупные «языки». Возвращает нижний цвет и минимум профиля.
 */
function drawRange(
  c: Ctx2D,
  L: StripLayer,
  M: RangePal,
  fog: string,
  H: (x: number) => number,
  tops: Tops,
  opt: { fogA: number; fogTop: number; snowFrac: number },
): [string, number] {
  const P = L.period;
  const pts = sample(P, 6, H);
  const minH = markProfile(tops, pts, 0.15);
  const bottomCol = mix(M.fill, fog, 0.5);
  const y0 = L.height;
  const y1 = -L.depth;
  const fogAt = (y: number): number => opt.fogA * clamp((opt.fogTop - y) / (opt.fogTop + 0.3 * L.depth), 0, 1);
  const fogged = (col: string, a = 1) => (y: number): string => rgba(mix(col, fog, fogAt(y)), a);
  const t = (y: number): number => (y0 - y) / (y0 - y1);
  silhouette(c, pts, -L.depth);
  c.fillStyle = vGrad(c, y0, y1, (y) => {
    const u = t(y);
    const base = u < 0.5 ? mix(M.light, M.fill, u / 0.5) : mix(M.fill, bottomCol, (u - 0.5) / 0.5);
    return mix(base, fog, fogAt(y));
  });
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = vGrad(c, y0, y1, fogged(M.shade, 0.55));
  slopeShade(c, pts, 0.55, 0.9);
  c.fill();
  if (M.snow) {
    let maxH = 0;
    let minP = Infinity;
    for (const p of pts) {
      maxH = Math.max(maxH, p[1]);
      minP = Math.min(minP, p[1]);
    }
    const r = rand(L.seed + 71);
    const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
    const span = maxH - minP;
    // снеговая линия плавно гуляет (целые частоты — периодично по P)
    const line = (x: number): number =>
      minP + span * opt.snowFrac + span * (0.1 * Math.sin((TAU * 2 * x) / P + ph[0]) + 0.06 * Math.sin((TAU * 5 * x) / P + ph[1]));
    // редкие крупные «языки» вниз по склону
    const tongue = (x: number): number =>
      Math.pow(Math.max(0, Math.sin((TAU * 9 * x) / P + ph[2])), 6) + 0.6 * Math.pow(Math.max(0, Math.sin((TAU * 17 * x) / P + ph[3])), 8);
    const snow = new Path2D();
    snow.moveTo(0, L.height + 1);
    for (let i = 0; i < pts.length; i++) {
      const [x, h] = pts[i];
      const above = h - line(x);
      const thick = above > 0 ? above * 0.8 + Math.min(above, 0.35) * 0.5 : 0;
      snow.lineTo(x, thick > 0.02 ? h - thick - thick * 0.55 * tongue(x) : h + 0.05);
    }
    snow.lineTo(P, L.height + 1);
    snow.closePath();
    c.fillStyle = vGrad(c, y0, y1, fogged(M.snow), 6);
    c.fill(snow);
    c.save();
    c.clip(snow);
    c.fillStyle = vGrad(c, y0, y1, fogged(M.snowShade ?? M.shade), 6);
    slopeShade(c, pts, 0.55, 0.9);
    c.fill();
    c.restore();
  }
  c.restore();
  // светлый гребень (контровой свет) — вне клипа: половина линии над силуэтом и есть «кайма»
  c.lineWidth = 0.07;
  c.strokeStyle = rgba(M.snow ?? M.light, 0.7);
  strokeLine(c, pts, -0.035);
  return [mix(bottomCol, fog, opt.fogA), minH];
}

function buildMountains(c: Ctx2D, L: StripLayer, P: ThemePalette, tops: Tops): BuildOut {
  const k = 0.9;
  if (P.mountainsBack) {
    const back = ridgedProfile(L.seed + 5, L.period, [
      [3, 2.6],
      [5, 1.6],
      [8, 0.8],
      [13, 0.35],
    ]);
    drawRange(c, L, P.mountainsBack, P.fog, (x) => 1.6 + back(x) * k, tops, { fogA: 0.6, fogTop: 3.5, snowFrac: 0.55 });
  }
  const main = ridgedProfile(L.seed, L.period, [
    [2, 3.2],
    [3, 2.0],
    [5, 1.1],
    [9, 0.45],
  ]);
  const [fill, minH] = drawRange(c, L, P.mountains, P.fog, (x) => 0.4 + main(x) * k, tops, { fogA: 0.55, fogTop: 1.4, snowFrac: 0.52 });
  return { fill, opaqueTop: minH - 0.05 };
}

/** Вторая (ближняя) гряда снежных гор (snow) с ёлочками-силуэтами у подножия. */
function buildRangeFar(c: Ctx2D, L: StripLayer, P: ThemePalette, tops: Tops): BuildOut {
  const M = P.rangeFar!;
  const prof = ridgedProfile(L.seed, L.period, [
    [2, 1.6],
    [3, 1.2],
    [5, 0.7],
    [11, 0.25],
  ]);
  const H = (x: number): number => 0.5 + prof(x);
  const [fill, minH] = drawRange(c, L, M, P.fog, H, tops, { fogA: 0.35, fogTop: 0.9, snowFrac: 0.6 });
  const r = rand(L.seed + 3);
  c.fillStyle = mix(M.shade, P.fog, 0.25);
  c.beginPath();
  for (let i = 0; i < 60; i++) {
    const x = r() * L.period;
    const top = Math.min(H(x) - 0.1, lerp(0.2, 0.9, r()));
    const h = lerp(0.35, 0.7, r());
    for (const dx of [0, L.period, -L.period]) {
      const X = x + dx;
      if (X < -1 || X > L.period + 1) continue;
      c.moveTo(X - h * 0.22, top - h * 0.5);
      c.lineTo(X, top + h * 0.5);
      c.lineTo(X + h * 0.22, top - h * 0.5);
    }
  }
  c.fill();
  return { fill, opaqueTop: minH - 0.05 };
}

// ───────────────────────── холмы ─────────────────────────

/** Холмы: градиент, мягкая тень склонов, светлый «рим», полосы-поля, декор, дымка. */
function buildHills(
  c: Ctx2D,
  L: StripLayer,
  P: ThemePalette,
  C: HillPal,
  tops: Tops,
  terms: Array<[number, number]>,
  amp0: number,
  deco: (c: Ctx2D, x: number, y: number, r: () => number) => void,
  decoDensity: number,
  decoTop: number,
  fogA: number,
): BuildOut {
  const Pm = L.period;
  const prof = sineProfile(L.seed, Pm, terms);
  const H = (x: number): number => amp0 + prof(x);
  const pts = sample(Pm, 5, H);
  const minH = markProfile(tops, pts, 0.12);
  const g = c.createLinearGradient(0, L.height, 0, -L.depth);
  g.addColorStop(0, C.top);
  g.addColorStop(1, C.bottom);
  silhouette(c, pts, -L.depth);
  c.fillStyle = g;
  c.fill();
  c.save();
  c.clip();
  // мягкий объём: склоны «от света» темнее
  c.fillStyle = rgba(C.shade, 0.32);
  slopeShade(c, pts, 1.6, 0.55);
  c.fill();
  // полосы-поля вдоль рельефа
  c.lineWidth = 0.22;
  c.strokeStyle = rgba(C.rim, 0.16);
  strokeLine(c, pts, -0.55);
  c.strokeStyle = rgba(C.rim, 0.11);
  strokeLine(c, pts, -1.25);
  // светлый «рим» по гребню
  c.lineWidth = 0.15;
  c.strokeStyle = rgba(C.rim, 0.9);
  strokeLine(c, pts, -0.06);
  c.restore();
  // декор по гребню (с переносом через край периода)
  const r = rand(L.seed + 101);
  const count = Math.round(Pm * decoDensity);
  for (let i = 0; i < count; i++) {
    const x = r() * Pm;
    const sub = r();
    const seed = Math.floor(r() * 1e6);
    const y = H(x) - 0.04 - sub * 0.12;
    tops.mark(x - 1.2, x + 1.2, y + decoTop);
    for (const dx of [0, Pm, -Pm]) {
      const X = x + dx;
      if (X < -2 || X > Pm + 2) continue;
      deco(c, X, y, rand(seed));
    }
  }
  // дымка книзу
  c.save();
  silhouette(c, pts, -L.depth);
  c.clip();
  const fg = c.createLinearGradient(0, amp0, 0, -L.depth * 0.4);
  fg.addColorStop(0, rgba(P.fog, 0));
  fg.addColorStop(1, rgba(P.fog, fogA));
  c.fillStyle = fg;
  c.fillRect(0, -L.depth, Pm, amp0 + L.depth);
  c.restore();
  return { fill: mix(C.bottom, P.fog, fogA), opaqueTop: minH - 0.05 };
}

// ───────────────────────── декор: кусты, деревца ─────────────────────────

type Blob = [number, number, number];

function blobPath(list: Blob[], dx = 0, dy = 0, k = 1): Path2D {
  const p = new Path2D();
  for (const [x, y, r] of list) {
    p.moveTo(x + dx + r * k, y + dy);
    p.arc(x + dx, y + dy, r * k, 0, TAU);
  }
  return p;
}

/**
 * Пышная масса листвы/куста (свет сверху-слева, ось Y вверх): тёмный силуэт → освещённое тело со сдвигом
 * (по краю снизу-справа остаётся тень) → дуги-блики на верхне-левых краях «клубов» (hl — их непрозрачность).
 */
export function foliage(c: Ctx2D, list: Blob[], dark: string, base: string, light: string, shift: number, hl = 0.9): void {
  const body = blobPath(list);
  c.fillStyle = dark;
  c.fill(body);
  c.save();
  c.clip(body);
  c.fillStyle = base;
  c.fill(blobPath(list, -shift, shift * 1.2, 0.97));
  c.restore();
  if (hl <= 0) return;
  c.lineCap = 'round';
  c.strokeStyle = rgba(light, hl);
  for (const [x, y, rr] of list) {
    c.lineWidth = rr * 0.2;
    c.beginPath();
    c.arc(x - shift * 0.6, y + shift * 0.6, rr * 0.72, Math.PI * 0.58, Math.PI * 0.92);
    c.stroke();
  }
}

/** Куст из 3–4 клубов (+ цветы). */
function bush(c: Ctx2D, x: number, y: number, s: number, C: { dark: string; base: string; light: string }, r: () => number, flowers?: string[], hl = 0.9): void {
  const parts: Blob[] = [
    [x - 0.6 * s, y + 0.25 * s, 0.55 * s],
    [x, y + 0.45 * s, 0.72 * s],
    [x + 0.62 * s, y + 0.22 * s, 0.5 * s],
  ];
  if (r() < 0.5) parts.push([x + 0.2 * s, y + 0.75 * s, 0.45 * s]);
  foliage(c, parts, C.dark, C.base, C.light, 0.09 * s, hl);
  if (flowers && flowers.length && r() < 0.55) {
    for (let i = 0; i < 4; i++) {
      const p = parts[Math.floor(r() * parts.length)];
      const a = r() * TAU;
      const d = p[2] * lerp(0.2, 0.7, r());
      c.fillStyle = flowers[Math.floor(r() * flowers.length)];
      c.beginPath();
      c.arc(p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d, 0.07 * s, 0, TAU);
      c.fill();
    }
  }
}

/** Деревце-«леденец» для дальних холмов. */
function lollipop(c: Ctx2D, x: number, y: number, s: number, dark: string, base: string, light: string, trunk: string): void {
  c.fillStyle = trunk;
  c.fillRect(x - 0.07 * s, y - 0.1, 0.14 * s, 1.2 * s + 0.1);
  foliage(c, [[x, y + 1.6 * s, 0.64 * s]], dark, base, light, 0.07 * s);
}

/** Маленькая ель (силуэт, опционально со снегом). */
function smallPine(c: Ctx2D, x: number, y: number, h: number, base: string, dark: string, snow?: string): void {
  const w = h * 0.3;
  for (let i = 0; i < 3; i++) {
    const y0 = y + h * (0.12 + i * 0.25);
    const ww = w * (1 - i * 0.22);
    const top = y0 + h * 0.42;
    c.fillStyle = base;
    c.beginPath();
    c.moveTo(x - ww, y0);
    c.lineTo(x, top);
    c.lineTo(x + ww, y0);
    c.closePath();
    c.fill();
    c.fillStyle = dark;
    c.beginPath();
    c.moveTo(x, y0);
    c.lineTo(x, top);
    c.lineTo(x + ww, y0);
    c.closePath();
    c.fill();
    if (snow) {
      c.fillStyle = snow;
      c.beginPath();
      c.moveTo(x - ww * 0.55, y0 + h * 0.18);
      c.lineTo(x, top);
      c.lineTo(x + ww * 0.5, y0 + h * 0.2);
      c.quadraticCurveTo(x, y0 + h * 0.12, x - ww * 0.55, y0 + h * 0.18);
      c.fill();
    }
  }
}

// ───────────────────────── деревья (средний план) ─────────────────────────

/** Лиственное дерево: 3 вида кроны (круглая, тополь, раскидистая); без крапин, блики вполсилы. */
function roundTree(c: Ctx2D, x: number, h: number, T: TreePal, r: () => number): void {
  const variant = r();
  const tw = h * 0.07;
  const lean = (r() - 0.5) * 0.06 * h;
  // ствол с корнями и ветками
  c.fillStyle = T.trunk;
  c.beginPath();
  c.moveTo(x - tw * 1.5, -0.25);
  c.quadraticCurveTo(x - tw * 0.8, h * 0.08, x - tw * 0.75 + lean * 0.5, h * 0.3);
  c.lineTo(x - tw * 0.55 + lean, h * 0.62);
  c.lineTo(x + tw * 0.55 + lean, h * 0.62);
  c.lineTo(x + tw * 0.75 + lean * 0.5, h * 0.3);
  c.quadraticCurveTo(x + tw * 0.8, h * 0.08, x + tw * 1.5, -0.25);
  c.closePath();
  c.fill();
  c.fillStyle = T.trunkDark;
  c.beginPath();
  c.moveTo(x + tw * 0.15, -0.25);
  c.lineTo(x + tw * 0.15 + lean, h * 0.6);
  c.lineTo(x + tw * 0.55 + lean, h * 0.6);
  c.lineTo(x + tw * 0.75 + lean * 0.5, h * 0.3);
  c.quadraticCurveTo(x + tw * 0.8, h * 0.08, x + tw * 1.5, -0.25);
  c.closePath();
  c.fill();
  c.strokeStyle = T.trunk;
  c.lineCap = 'round';
  c.lineWidth = tw * 0.6;
  c.beginPath();
  c.moveTo(x + lean * 0.6, h * 0.42);
  c.lineTo(x - h * 0.12 + lean, h * 0.6);
  c.moveTo(x + lean * 0.7, h * 0.48);
  c.lineTo(x + h * 0.13 + lean, h * 0.64);
  c.stroke();
  // крона
  let parts: Blob[];
  if (variant < 0.55) {
    parts = [
      [0, 0.52, 0.17],
      [-0.2, 0.6, 0.2],
      [0.21, 0.6, 0.2],
      [0, 0.7, 0.27],
      [-0.1, 0.86, 0.19],
      [0.12, 0.84, 0.18],
    ];
  } else if (variant < 0.8) {
    // высокий тополь
    parts = [
      [0, 0.5, 0.15],
      [0.02, 0.64, 0.17],
      [-0.03, 0.78, 0.16],
      [0.01, 0.9, 0.13],
      [0, 1.0, 0.09],
    ];
  } else {
    // раскидистый
    parts = [
      [-0.26, 0.58, 0.19],
      [0.26, 0.57, 0.19],
      [0, 0.66, 0.24],
      [-0.12, 0.78, 0.18],
      [0.14, 0.77, 0.17],
    ];
  }
  const list: Blob[] = parts.map(([bx, by, br]) => [x + lean + bx * h, by * h, br * h]);
  // тень кроны на стволе
  c.fillStyle = rgba(T.trunkDark, 0.7);
  c.beginPath();
  c.ellipse(x + lean, h * 0.5, tw * 1.1, h * 0.06, 0, 0, TAU);
  c.fill();
  foliage(c, list, T.leafDark, T.leaf, T.leafLight, h * 0.03, 0.45);
}

function pineTree(c: Ctx2D, x: number, h: number, T: TreePal, r: () => number): void {
  c.fillStyle = T.trunkDark;
  c.fillRect(x - h * 0.035, -0.25, h * 0.07, h * 0.22 + 0.25);
  const tiers = 4 + (r() < 0.4 ? 1 : 0);
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y0 = h * (0.12 + t * 0.7);
    const w = h * (0.33 - t * 0.24);
    const top = y0 + h * (0.3 - t * 0.04);
    const droop = h * 0.04;
    const tier = new Path2D();
    tier.moveTo(x - w, y0 - droop);
    tier.quadraticCurveTo(x - w * 0.45, y0 + h * 0.02, x - w * 0.3, y0 + h * 0.05);
    tier.lineTo(x, top);
    tier.lineTo(x + w * 0.3, y0 + h * 0.05);
    tier.quadraticCurveTo(x + w * 0.45, y0 + h * 0.02, x + w, y0 - droop);
    tier.quadraticCurveTo(x, y0 + h * 0.015, x - w, y0 - droop);
    c.fillStyle = T.leaf;
    c.fill(tier);
    c.save();
    c.clip(tier);
    c.fillStyle = T.leafDark;
    c.fillRect(x, y0 - droop - 0.1, w + 0.1, top - y0 + droop + 0.2);
    c.fillStyle = rgba(T.leafLight, 0.55);
    c.beginPath();
    c.moveTo(x - w * 0.9, y0 - droop * 0.8);
    c.lineTo(x - w * 0.05, top - h * 0.03);
    c.lineTo(x - w * 0.3, y0 + h * 0.02);
    c.closePath();
    c.fill();
    if (T.snow) {
      // снежная шапка яруса с волнистым нижним краем
      c.fillStyle = T.snow;
      c.beginPath();
      c.moveTo(x - w * 0.8, y0 + h * 0.035);
      c.lineTo(x, top + 0.2);
      c.lineTo(x + w * 0.75, y0 + h * 0.045);
      c.quadraticCurveTo(x + w * 0.45, y0 + h * 0.09, x + w * 0.2, y0 + h * 0.07);
      c.quadraticCurveTo(x - w * 0.1, y0 + h * 0.12, x - w * 0.35, y0 + h * 0.08);
      c.quadraticCurveTo(x - w * 0.6, y0 + h * 0.1, x - w * 0.8, y0 + h * 0.035);
      c.fill();
      c.fillStyle = T.snowShade ?? T.snow;
      c.beginPath();
      c.moveTo(x + w * 0.05, top - h * 0.02);
      c.lineTo(x + w * 0.75, y0 + h * 0.045);
      c.quadraticCurveTo(x + w * 0.45, y0 + h * 0.09, x + w * 0.2, y0 + h * 0.07);
      c.closePath();
      c.fill();
    }
    c.restore();
  }
}

function palmTree(c: Ctx2D, x: number, h: number, T: TreePal, r: () => number): void {
  const lean = (r() - 0.35) * 0.55 * h;
  const tx = x + lean;
  const ty = h;
  const cx = x + lean * 0.15;
  const cy = h * 0.55;
  const bez = (t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * x + 2 * u * t * cx + t * t * tx, u * u * -0.2 + 2 * u * t * cy + t * t * ty];
  };
  // ствол: сужающаяся полоса вдоль кривой + кольца
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [px, py] = bez(t);
    const [qx, qy] = bez(Math.min(1, t + 0.01));
    const [ox, oy] = bez(Math.max(0, t - 0.01));
    let dx = qx - ox;
    let dy = qy - oy;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    const w = h * lerp(0.05, 0.028, t);
    left.push([px - dy * w, py + dx * w]);
    right.push([px + dy * w, py - dx * w]);
  }
  c.fillStyle = T.trunk;
  c.beginPath();
  left.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  for (let i = right.length - 1; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
  c.fill();
  // тёмная сторона ствола
  c.fillStyle = rgba(T.trunkDark, 0.55);
  c.beginPath();
  for (let i = 0; i <= N; i++) {
    const m: [number, number] = [(left[i][0] + right[i][0] * 2) / 3, (left[i][1] + right[i][1] * 2) / 3];
    if (i) c.lineTo(m[0], m[1]);
    else c.moveTo(m[0], m[1]);
  }
  for (let i = N; i >= 0; i--) c.lineTo(right[i][0], right[i][1]);
  c.closePath();
  c.fill();
  c.strokeStyle = T.trunkDark;
  c.lineWidth = h * 0.012;
  c.beginPath();
  for (let i = 1; i < N; i++) {
    c.moveTo(left[i][0], left[i][1]);
    c.lineTo(right[i][0], right[i][1] - h * 0.012);
  }
  c.stroke();
  // листья-перья: сначала задние (тёмные), потом передние
  const fronds = 8;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < fronds; i++) {
      if (i % 2 !== pass) continue;
      const a = Math.PI * (0.02 + (i / (fronds - 1)) * 0.96) + (r() - 0.5) * 0.18;
      const L = h * lerp(0.4, 0.52, r());
      frond(c, tx, ty, a, L, h, pass ? T.leaf : T.leafDark, T.rim);
    }
  }
  // кокосы
  c.fillStyle = '#5A3A22';
  c.beginPath();
  c.arc(tx + h * 0.03, ty - h * 0.035, h * 0.032, 0, TAU);
  c.arc(tx - h * 0.035, ty - h * 0.04, h * 0.03, 0, TAU);
  c.arc(tx + h * 0.0, ty - h * 0.065, h * 0.028, 0, TAU);
  c.fill();
}

/** Лист пальмы: дуга с пилообразным нижним краем, контровой свет по верхнему. */
function frond(c: Ctx2D, x0: number, y0: number, a: number, L: number, h: number, color: string, rim?: string): void {
  const ex = x0 + Math.cos(a) * L;
  const ey = y0 + Math.sin(a) * L * 0.5 - L * 0.42;
  const mx = x0 + Math.cos(a) * L * 0.55;
  const my = y0 + Math.sin(a) * L * 0.55 + L * 0.18;
  const pt = (t: number): [number, number] => {
    const u = 1 - t;
    return [u * u * x0 + 2 * u * t * mx + t * t * ex, u * u * y0 + 2 * u * t * my + t * t * ey];
  };
  const N = 14;
  const up: Array<[number, number]> = [];
  const lo: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [px, py] = pt(t);
    const [qx, qy] = pt(Math.min(1, t + 0.02));
    const [ox, oy] = pt(Math.max(0, t - 0.02));
    let nx = -(qy - oy);
    let ny = qx - ox;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const w = h * 0.075 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.7);
    up.push([px + nx * w * 0.35, py + ny * w * 0.35]);
    const k = i % 2 ? 1 : 0.45;
    lo.push([px - nx * w * k + (qx - ox) * 3 * w, py - ny * w * k + (qy - oy) * 3 * w]);
  }
  c.fillStyle = color;
  c.beginPath();
  up.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  for (let i = lo.length - 1; i >= 0; i--) c.lineTo(lo[i][0], lo[i][1]);
  c.closePath();
  c.fill();
  if (rim) {
    c.strokeStyle = rgba(rim, 0.6);
    c.lineWidth = h * 0.012;
    c.lineCap = 'round';
    c.beginPath();
    up.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.stroke();
  }
}

/** Вал под деревьями: живая изгородь (meadow), песчаный вал с кустами (beach), сугробы (snow). Возвращает минимум высоты. */
function buildBerm(c: Ctx2D, L: StripLayer, P: ThemePalette, r: () => number, tops: Tops): number {
  const T = P.trees;
  const Pm = L.period;
  const kind = T.kind;
  // частоты кратны периоду: при периоде 60 м волна та же, что и при 30 м
  const q = Pm / 30;
  const wave =
    kind === 'palm'
      ? (x: number): number =>
          0.45 + 0.22 * Math.sin((TAU * 3 * q * x) / Pm) + 0.1 * Math.sin((TAU * 7 * q * x) / Pm + 2) + 0.04 * Math.sin((TAU * 13 * q * x) / Pm)
      : (x: number): number =>
          0.38 + 0.2 * Math.sin((TAU * 7 * q * x) / Pm) + 0.12 * Math.sin((TAU * 17 * q * x) / Pm + 2) + 0.06 * Math.sin((TAU * 41 * q * x) / Pm);
  const pts = sample(Pm, 6, wave);
  const minH = markProfile(tops, pts, 0.1);
  const g = c.createLinearGradient(0, 1.0, 0, -L.depth);
  g.addColorStop(0, T.bermLight);
  g.addColorStop(0.4, T.berm);
  g.addColorStop(1, kind === 'round' ? T.bermDark : mix(T.berm, T.bermDark, kind === 'pine' ? 0.6 : 0.15));
  silhouette(c, pts, -L.depth);
  c.fillStyle = g;
  c.fill();
  const n = Math.round(Pm * 0.9);
  if (kind === 'round') {
    for (let i = 0; i < n; i++) {
      const x = r() * Pm;
      const s = lerp(0.35, 0.7, r());
      const seed = Math.floor(r() * 1e6);
      tops.mark(x - s * 1.3, x + s * 1.3, wave(x) + s * 1.3);
      for (const dx of [0, Pm, -Pm]) {
        if (x + dx < -2 || x + dx > Pm + 2) continue;
        bush(c, x + dx, wave(x) - 0.25, s, { dark: T.bermDark, base: T.berm, light: T.bermLight }, rand(seed), T.flowers, 0.45);
      }
    }
  } else if (kind === 'palm') {
    // светлая кромка вала — до кустов (кусты её перекрывают)
    c.save();
    silhouette(c, pts, -L.depth);
    c.clip();
    c.lineWidth = 0.1;
    c.strokeStyle = rgba(T.bermLight, 0.8);
    strokeLine(c, pts, -0.05);
    c.restore();
    // тропические кусты на песчаном валу
    for (let i = 0; i < Math.round(n * 0.5); i++) {
      const x = r() * Pm;
      const s = lerp(0.3, 0.55, r());
      const seed = Math.floor(r() * 1e6);
      tops.mark(x - s * 1.3, x + s * 1.3, wave(x) + s * 1.3);
      for (const dx of [0, Pm, -Pm]) {
        if (x + dx < -2 || x + dx > Pm + 2) continue;
        bush(c, x + dx, wave(x) - 0.3, s, { dark: T.bermDark, base: T.leafDark, light: T.leaf }, rand(seed), T.flowers, 0.6);
      }
    }
  } else {
    // сугробы с тенью
    c.save();
    silhouette(c, pts, -L.depth);
    c.clip();
    c.fillStyle = rgba(T.bermDark, 0.6);
    slopeShade(c, pts, 1.2, 0.6);
    c.fill();
    c.restore();
  }
  return minH;
}

/** Деревья среднего плана (период 60 м — без повтора в кадре даже на общем плане 21:9) и вал перед ними. */
function buildTrees(c: Ctx2D, L: StripLayer, P: ThemePalette, tops: Tops): BuildOut {
  const T = P.trees;
  const Pm = L.period;
  const r = rand(L.seed);
  const n = Math.round(Pm / (T.kind === 'palm' ? 4.2 : 3.0));
  const items: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) items.push([((i + r() * 0.75) * Pm) / n, lerp(2.3, 4.1, r()), Math.floor(r() * 1e6)]);
  // дальний ряд (меньше и светлее) — для глубины
  const back: Array<[number, number, number]> = [];
  if (T.kind !== 'palm') for (let i = 0; i < n; i++) back.push([((i + 0.5 + r() * 0.5) * Pm) / n, lerp(1.5, 2.4, r()), Math.floor(r() * 1e6)]);
  const kH = T.kind === 'pine' ? 1.2 : T.kind === 'palm' ? 1.3 : 1;
  const draw = (x: number, h: number, seed: number, pal: TreePal): void => {
    const hh = h * kH;
    // ширина кроны с запасом: у пальмы — наклон и длинные листья
    const half = T.kind === 'palm' ? hh * 1.05 : hh * 0.5;
    tops.mark(x - half, x + half, hh * (T.kind === 'palm' ? 1.32 : 1.12) + 0.15);
    for (const dx of [0, -Pm, Pm]) {
      if (x + dx < -half - 0.5 || x + dx > Pm + half + 0.5) continue;
      const rr = rand(seed);
      if (T.kind === 'round') roundTree(c, x + dx, hh, pal, rr);
      else if (T.kind === 'pine') pineTree(c, x + dx, hh, pal, rr);
      else palmTree(c, x + dx, hh, pal, rr);
    }
  };
  if (back.length) {
    const k = 0.3;
    const fogT: TreePal = {
      ...T,
      leaf: mix(T.leaf, P.fog, k),
      leafDark: mix(T.leafDark, P.fog, k),
      leafLight: mix(T.leafLight, P.fog, k),
      trunk: mix(T.trunk, P.fog, k),
      trunkDark: mix(T.trunkDark, P.fog, k),
      snowShade: T.snowShade ? mix(T.snowShade, P.fog, k) : undefined,
    };
    for (const [x, h, seed] of back) draw(x, h, seed, fogT);
  }
  for (const [x, h, seed] of items) draw(x, h, seed, T);
  const minH = buildBerm(c, L, P, r, tops);
  const fill = T.kind === 'round' ? T.bermDark : mix(T.berm, T.bermDark, T.kind === 'pine' ? 0.6 : 0.15);
  return { fill, opaqueTop: minH - 0.05 };
}

// ───────────────────────── море и острова ─────────────────────────

/** Море (beach): градиент от горизонта, полосы волн. База слоя = линия горизонта. */
function buildSea(c: Ctx2D, L: StripLayer, P: ThemePalette, tops: Tops): BuildOut {
  const S = P.sea!;
  const Pm = L.period;
  tops.mark(0, Pm, 0.05);
  const g = c.createLinearGradient(0, 0, 0, -L.depth);
  g.addColorStop(0, S.top);
  g.addColorStop(0.28, S.mid);
  g.addColorStop(1, S.bottom);
  c.fillStyle = g;
  c.fillRect(0, -L.depth, Pm, L.depth);
  // светлая кромка горизонта
  c.fillStyle = rgba(S.sparkle, 0.55);
  c.fillRect(0, -0.06, Pm, 0.06);
  // волны: короткие светлые штрихи, к низу реже и крупнее
  const r = rand(L.seed);
  c.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const t = Math.pow(r(), 1.6);
    const y = -0.15 - t * (L.depth - 0.5);
    const x = r() * Pm;
    const w = lerp(0.25, 1.6, t) * lerp(0.5, 1, r());
    c.strokeStyle = rgba(S.line, lerp(0.35, 0.12, t));
    c.lineWidth = lerp(0.03, 0.08, t);
    for (const dx of [0, Pm, -Pm]) {
      const X = x + dx;
      if (X + w < 0 || X - w > Pm) continue;
      c.beginPath();
      c.moveTo(X - w / 2, y);
      c.quadraticCurveTo(X, y + 0.05 + t * 0.04, X + w / 2, y);
      c.stroke();
    }
  }
  return { fill: S.bottom, opaqueTop: 0 };
}

/** Острова на горизонте (beach) — силуэты с невысокими пальмами (залитые листья цвета тени острова), отражение. */
function buildIslands(c: Ctx2D, L: StripLayer, P: ThemePalette, tops: Tops): BuildOut {
  const I = P.islands!;
  const Pm = L.period;
  const r = rand(L.seed);
  const palmCol = mix(I.shade, P.fog, 0.18);
  const list: Array<[number, number, number]> = [
    [Pm * 0.12, 9, 2.4],
    [Pm * 0.3, 4, 1.1],
    [Pm * 0.58, 13, 3.0],
    [Pm * 0.86, 6, 1.5],
  ];
  for (const [cx, w, hh] of list) {
    const seed = Math.floor(r() * 1e6);
    tops.mark(cx - w / 2 - 1, cx + w / 2 + 1, hh * 1.35);
    for (const dx of [0, Pm, -Pm]) {
      const X = cx + dx;
      if (X + w < 0 || X - w > Pm) continue;
      const rr = rand(seed);
      const ph = rr() * TAU;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        const xx = X - w / 2 + u * w;
        const env = Math.pow(Math.sin(Math.PI * u), 0.8);
        const hy = hh * env * (0.75 + 0.25 * Math.sin(u * 7 + ph)) * (1 - 0.35 * Math.abs(Math.sin(u * 13 + ph)));
        pts.push([xx, hy]);
      }
      const g = c.createLinearGradient(0, hh, 0, 0);
      g.addColorStop(0, I.light);
      g.addColorStop(1, I.fill);
      c.fillStyle = g;
      silhouette(c, pts, 0);
      c.fill();
      c.save();
      c.clip();
      c.fillStyle = rgba(I.shade, 0.6);
      slopeShade(c, pts, 0.6, 0.9);
      c.fill();
      c.restore();
      // отражение
      c.fillStyle = rgba(I.shade, 0.35);
      c.beginPath();
      c.moveTo(pts[0][0], 0);
      for (const p of pts) c.lineTo(p[0], -p[1] * 0.25);
      c.closePath();
      c.fill();
      // невысокие пальмы-силуэты: ствол-штрих и 5 залитых листьев
      c.fillStyle = palmCol;
      c.strokeStyle = palmCol;
      c.lineCap = 'round';
      const np = Math.max(1, Math.round(w / 3.5));
      for (let k = 0; k < np; k++) {
        const u = lerp(0.3, 0.7, rr());
        const [bx, by] = pts[Math.round(u * 60)];
        const ph2 = hh * lerp(0.14, 0.2, rr());
        const lx = (rr() - 0.5) * ph2 * 0.5;
        c.lineWidth = Math.max(0.045, ph2 * 0.09);
        c.beginPath();
        c.moveTo(bx, by - 0.05);
        c.quadraticCurveTo(bx + lx * 0.2, by + ph2 * 0.6, bx + lx, by + ph2);
        c.stroke();
        const fl = ph2 * 0.7;
        c.beginPath();
        for (let f = 0; f < 5; f++) {
          const a = Math.PI * (0.08 + (f / 4) * 0.84);
          const ex = bx + lx + Math.cos(a) * fl;
          const ey = by + ph2 + Math.sin(a) * fl * 0.35 - fl * 0.25;
          const mx = bx + lx + Math.cos(a) * fl * 0.5;
          const my = by + ph2 + Math.sin(a) * fl * 0.35 + fl * 0.12;
          // лист — серп: верхняя дуга и нижняя, сходящиеся к кончику
          c.moveTo(bx + lx, by + ph2);
          c.quadraticCurveTo(mx, my + fl * 0.08, ex, ey);
          c.quadraticCurveTo(mx, my - fl * 0.08, bx + lx, by + ph2);
        }
        c.fill();
      }
    }
  }
  return { fill: null, opaqueTop: -1e9 };
}

// ───────────────────────── облака и ореол (спрайты) ─────────────────────────

export interface CloudSprite {
  canvas: AnyCanvas;
  /** Пиксель холста = левый край плоского дна облака. */
  ox: number;
  oy: number;
  ppm: number;
}

/**
 * Кучевое облако: тело-объединение кругов с плоским дном; тень по нижне-правому краю (тело со сдвигом),
 * светлая кайма по верхне-левому краю (через временный холст) — без «пузырей» внутри.
 */
export function renderCloud(seed: number, widthM: number, ppm: number, C: ThemePalette['cloud']): CloudSprite {
  const r = rand(seed);
  const w = widthM;
  const h = w * 0.44;
  const base = h * 0.8;
  const padX = 0.12 * widthM + 0.25;
  const padTop = 0.5;
  const W = Math.ceil((w + padX * 2) * ppm);
  const Hh = Math.ceil((h + padTop + 0.1) * ppm);
  const c = createCanvas(W, Hh);
  const ctx = ctx2d(c);
  const toM = (cx: Ctx2D): void => cx.setTransform(ppm, 0, 0, ppm, padX * ppm, padTop * ppm); // метры, Y вниз
  toM(ctx);
  const parts: Blob[] = [];
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = w * (0.1 + 0.8 * t);
    const rr = h * (0.26 + 0.32 * Math.sin(Math.PI * t)) * lerp(0.85, 1.15, r());
    parts.push([x, base - rr * 0.5, rr]);
  }
  // верхние «шапки» кучевого облака
  const top = 2 + Math.floor(r() * 2);
  for (let i = 0; i < top; i++) {
    const t = lerp(0.28, 0.72, (i + r() * 0.6) / top);
    const rr = h * lerp(0.26, 0.36, r());
    parts.push([w * t, base - h * 0.55 - rr * 0.15, rr]);
  }
  const body = blobPath(parts);
  body.rect(w * 0.1, base - h * 0.25, w * 0.8, h * 0.25);
  const lit = blobPath(parts, -0.035 * w, -0.09 * h, 1);
  lit.rect(w * 0.1 - 0.035 * w, base - h * 0.25 - 0.09 * h, w * 0.8, h * 0.25);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-padX, -padTop, w + padX * 2, base + padTop); // плоское дно
  ctx.clip();
  // 1) тень (весь силуэт)
  const gs = ctx.createLinearGradient(0, base - h, 0, base);
  gs.addColorStop(0, mix(C.top, C.shade, 0.45));
  gs.addColorStop(1, C.shade);
  ctx.fillStyle = gs;
  ctx.fill(body);
  // 2) освещённое тело со сдвигом вверх-влево
  ctx.clip(body);
  const g = ctx.createLinearGradient(0, base - h, 0, base);
  g.addColorStop(0, C.top);
  g.addColorStop(0.55, C.top);
  g.addColorStop(1, C.bottom);
  ctx.fillStyle = g;
  ctx.fill(lit);
  ctx.restore();
  // 3) светлая кайма сверху-слева: силуэт минус силуэт со сдвигом вниз-вправо
  const tmp = createCanvas(W, Hh);
  const tc = ctx2d(tmp);
  toM(tc);
  tc.fillStyle = '#FFFFFF';
  tc.fill(body);
  tc.globalCompositeOperation = 'destination-out';
  tc.fill(blobPath(parts, 0.022 * w, 0.06 * h, 1));
  tc.setTransform(1, 0, 0, 1, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.rect(0, 0, W, (padTop + base) * ppm);
  ctx.clip();
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
  return { canvas: c, ox: padX * ppm, oy: (padTop + base) * ppm, ppm };
}

/** Сторона спрайта ореола, px (04 §5.1: рисуется масштабированным до 9.6R). */
export const GLOW_PX = 256;

/** Радиальный ореол GLOW_PX × GLOW_PX: цвет с α в центре → 0 на краю. */
export function renderGlow(color: string, a: number): AnyCanvas {
  const S = GLOW_PX;
  const c = createCanvas(S, S);
  const ctx = ctx2d(c);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.18, rgba(color, a * 0.75));
  g.addColorStop(0.45, rgba(color, a * 0.28));
  g.addColorStop(0.75, rgba(color, a * 0.07));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return c;
}

// ───────────────────────── таблица слоёв темы ─────────────────────────

export interface ThemeLayers {
  strips: StripLayer[];
  /** Индекс полосы, перед которой рисуются ближние облака. */
  nearAt: number;
  /** Индекс полосы, после которой рисуется солнечная дорожка (−1 — нет). */
  glitterAfter: number;
  cloudsFar: CloudLayer;
  cloudsNear: CloudLayer;
}

/** Слои темы (04 §3.2). res < 1 — только у дальних слоёв (горы, море, острова): ближние строятся 1:1. */
export function themeLayers(theme: ThemeId): ThemeLayers {
  const P = THEME_PALETTES[theme];
  const strips: StripLayer[] = [];
  let glitter = -1;
  if (theme === 'beach') {
    strips.push({ id: 'sea', f: 0.1, period: 40, baseY: -0.6, height: 0, depth: 9, res: 0.5, seed: 7, build: buildSea });
    glitter = 0;
    strips.push({ id: 'islands', f: 0.1, period: 70, baseY: -0.6, height: 4.2, depth: 0.4, res: 0.6, seed: 13, build: buildIslands });
  } else {
    strips.push({ id: 'mountains', f: 0.12, period: 64, baseY: -1.0, height: 8.5, depth: 1.5, res: 0.5, seed: 11, build: buildMountains });
  }
  const nearAt = strips.length;
  if (theme === 'meadow') {
    const H = P.hillsFar!;
    strips.push({
      id: 'hillsFar',
      f: 0.25,
      period: 44,
      baseY: -1.5,
      height: 4.6,
      depth: 1.5,
      res: 1,
      seed: 21,
      build: (c, L, Pp, tops) =>
        buildHills(
          c,
          L,
          Pp,
          H,
          tops,
          [
            [1, 0.6],
            [2, 0.5],
            [3, 0.35],
            [5, 0.15],
          ],
          2.1,
          (cc, x, y, r) => {
            if (r() < 0.5) lollipop(cc, x, y, lerp(0.22, 0.38, r()), H.deco, mix(H.deco, H.top, 0.25), H.decoLight, '#8C7A5A');
            else bush(cc, x, y, lerp(0.18, 0.34, r()), { dark: H.deco, base: mix(H.deco, H.top, 0.3), light: H.decoLight }, r);
          },
          0.75,
          0.95,
          0.3,
        ),
    });
  } else if (theme === 'snow') {
    strips.push({ id: 'rangeFar', f: 0.25, period: 48, baseY: -1.5, height: 5.0, depth: 1.5, res: 1, seed: 21, build: buildRangeFar });
  }
  const N = P.hillsNear;
  const nearDeco =
    theme === 'meadow'
      ? (cc: Ctx2D, x: number, y: number, r: () => number): void => {
          if (r() < 0.22) lollipop(cc, x, y, lerp(0.35, 0.5, r()), N.deco, mix(N.deco, N.top, 0.3), N.decoLight, '#7A5A3A');
          else bush(cc, x, y, lerp(0.25, 0.5, r()), { dark: N.deco, base: mix(N.deco, N.top, 0.35), light: N.decoLight }, r, ['#FFE04A', '#FF8FB4'], 0.6);
        }
      : theme === 'beach'
        ? (cc: Ctx2D, x: number, y: number, r: () => number): void => {
            // пучки пляжной травы
            const n = 5 + Math.floor(r() * 4);
            const s = lerp(0.25, 0.45, r());
            cc.lineCap = 'round';
            for (let i = 0; i < n; i++) {
              const u = i / (n - 1) - 0.5;
              cc.strokeStyle = i % 2 ? N.deco : N.decoLight;
              cc.lineWidth = 0.035;
              cc.beginPath();
              cc.moveTo(x + u * 0.12, y - 0.05);
              cc.quadraticCurveTo(x + u * 0.3, y + s * 0.6, x + u * s * 1.1, y + s * (1 - Math.abs(u)));
              cc.stroke();
            }
          }
        : (cc: Ctx2D, x: number, y: number, r: () => number): void => {
            if (r() < 0.75) smallPine(cc, x, y - 0.1, lerp(0.7, 1.3, r()), N.deco, mix(N.deco, '#102A28', 0.35), P.trees.snow);
            else {
              // камень, торчащий из снега
              const s = lerp(0.2, 0.38, r());
              cc.fillStyle = P.rock.fill;
              cc.beginPath();
              cc.moveTo(x - s, y - 0.1);
              cc.lineTo(x - s * 0.6, y + s * 0.7);
              cc.lineTo(x + s * 0.2, y + s * 0.9);
              cc.lineTo(x + s, y - 0.1);
              cc.closePath();
              cc.fill();
              cc.fillStyle = N.rim;
              cc.beginPath();
              cc.moveTo(x - s * 0.7, y + s * 0.5);
              cc.lineTo(x - s * 0.55, y + s * 0.72);
              cc.lineTo(x + s * 0.2, y + s * 0.92);
              cc.lineTo(x + s * 0.5, y + s * 0.5);
              cc.quadraticCurveTo(x, y + s * 0.62, x - s * 0.7, y + s * 0.5);
              cc.fill();
            }
          };
  strips.push({
    id: 'hillsNear',
    f: 0.4,
    period: 36,
    baseY: -2.0,
    height: 4.2,
    depth: 1.5,
    res: 1,
    seed: theme === 'beach' ? 33 : 31,
    build: (c, L, Pp, tops) =>
      buildHills(
        c,
        L,
        Pp,
        N,
        tops,
        theme === 'beach'
          ? [
              [1, 0.4],
              [2, 0.3],
              [3, 0.18],
              [5, 0.05],
            ]
          : [
              [1, 0.45],
              [2, 0.35],
              [4, 0.2],
              [6, 0.08],
            ],
        1.5,
        nearDeco,
        theme === 'beach' ? 0.35 : theme === 'snow' ? 0.4 : 0.45,
        1.4,
        P.hillsNearFog,
      ),
  });
  strips.push({ id: 'trees', f: 0.62, period: 60, baseY: -1.6, height: 7.8, depth: 1.5, res: 1, seed: 41, build: buildTrees, haze: P.trees.haze });
  return {
    strips,
    nearAt,
    glitterAfter: glitter,
    cloudsFar: { f: 0.05, period: 70, baseY: 1.0, drift: 0.25, items: makeClouds(3, 7, 70, 3, 6, 1.6, 4.6) },
    cloudsNear: { f: 0.18, period: 90, baseY: 3.0, drift: 0.5, items: makeClouds(5, 4, 90, 4.5, 7.5, 0.6, 2.6) },
  };
}
