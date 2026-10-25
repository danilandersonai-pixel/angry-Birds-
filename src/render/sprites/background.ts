// Параллакс-фон трёх тем: небо, солнце, облака (дрейф), горы/острова, море, холмы, деревья — плюс
// передний план и (реэкспорт) рельеф. Слои — бесшовные горизонтальные полосы, запечённые в offscreen-холсты;
// каждый кадр — только drawImage и пара заливок (см. docs/research/04-visual.md §2–§5).
//
// API (контракт спецификации §3):
//   new Background(theme).draw(ctx, view)  — небо и все слои фона на весь экран (экранные координаты);
//   drawTerrain(ctx, terrain, theme, view) — рельеф в мире (реэкспорт из terrain.ts);
//   drawForeground(ctx, theme, view)       — передний план (≤ 3 % высоты экрана);
//   THEME_INFO                              — название и цвета темы для UI.
// Дополнительно: Background.prewarm(view) и prewarmTerrain(terrain, theme) — построить кэши заранее
// (экран загрузки / интро); Background.fastScaling — масштабирование без сглаживания для LOW-качества.
//
// Математика слоя (04 §3.1): sL = sRef·(s/sRef)^f, sRef = H/15;
//   X = W/2 + (xL − camX·f)·sL;  Y = H/2 − (yL + baseY − camY·f)·sL.
// Ниже полосы непрозрачный слой заливается своим нижним цветом — щелей нет при любом зуме и соотношении сторон.
//
// Производительность:
//  • отсечение перерисовки: у каждого слоя известна «линия непрозрачности»; всё, что ниже линии следующих
//    слоёв, не рисуется (прямоугольный клип), — каждый пиксель закрашивается ≈ 1 раз + прозрачные края силуэтов;
//  • полоса = тайлы шириной ≤ 512 px без прозрачного верха; тайл рисуется целиком (drawImage без
//    под-прямоугольника источника — на программном растре это вдвое быстрее), небо — столбец 1×h;
//  • кэш по масштабу: при неподвижном зуме (250 мс) полосы и облака строятся ровно под текущий масштаб и
//    рисуются 1:1; пока зум меняется или новая полоса не готова — ближайшая готовая с масштабированием.
//    Полоса достраивается в фоне по тайлам (бюджет 2 мс за кадр + не больше одного тайла 0.3–3.5 мс сверх него),
//    облака — по одному за кадр; без рывков после остановки зума;
//    LRU на 2 масштаба (вид рогатки + последний другой); ≈ 20 МБ полос на масштаб при 1080p.

import type { ThemeId } from '../../core/types';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { ViewInfo } from '../view';
import { CAMERA } from '../../config/constants';
import { TAU, clamp, lerp, mix, rand, rgba } from './terrain';

export { drawTerrain, prewarmTerrain } from './terrain';

// ───────────────────────── палитры ─────────────────────────

interface RangePal {
  light: string;
  fill: string;
  shade: string;
  snow?: string;
  snowShade?: string;
}

interface HillPal {
  top: string;
  bottom: string;
  rim: string;
  shade: string;
  deco: string;
  decoLight: string;
}

interface TreePal {
  kind: 'round' | 'palm' | 'pine';
  trunk: string;
  trunkDark: string;
  leaf: string;
  leafLight: string;
  leafDark: string;
  rim?: string;
  snow?: string;
  snowShade?: string;
  berm: string;
  bermLight: string;
  bermDark: string;
  flowers?: string[];
}

interface Palette {
  sky: Array<[number, string]>;
  sun: { x: number; y: number; r: number; core: string; glow: string; glowA: number; onHorizon?: boolean };
  cloud: { top: string; bottom: string; shade: string; alpha: number };
  fog: string;
  mountains: RangePal;
  mountainsBack?: RangePal;
  sea?: { top: string; mid: string; bottom: string; sparkle: string; line: string };
  islands?: { light: string; fill: string; shade: string; palm: string };
  hillsFar?: HillPal;
  rangeFar?: RangePal;
  hillsNear: HillPal;
  trees: TreePal;
  fg: { a: string; b: string; c: string; accent: string[] };
  snowfall?: boolean;
}

const PAL: Record<ThemeId, Palette> = {
  meadow: {
    sky: [
      [0, '#2F8FE0'],
      [0.5, '#7CC6F2'],
      [0.85, '#C4EAF8'],
      [1, '#E4F6F6'],
    ],
    sun: { x: 0.8, y: 0.15, r: 0.055, core: '#FFF8D8', glow: '#FFF1B0', glowA: 0.6 },
    cloud: { top: '#FFFFFF', bottom: '#D6E9F6', shade: '#A9C9E4', alpha: 0.97 },
    fog: '#DDF3F7',
    mountains: { light: '#BFE0EE', fill: '#9DCBE0', shade: '#7FB0CB' },
    mountainsBack: { light: '#D3EBF4', fill: '#BCDDEB', shade: '#A8CFE2' },
    hillsFar: {
      top: '#9AD686',
      bottom: '#74BA6C',
      rim: '#C4EBA6',
      shade: '#6AAE66',
      deco: '#62A85C',
      decoLight: '#A9DC90',
    },
    hillsNear: {
      top: '#6CC44D',
      bottom: '#43A03C',
      rim: '#A0E066',
      shade: '#3E9238',
      deco: '#3A8E33',
      decoLight: '#86CF58',
    },
    trees: {
      kind: 'round',
      trunk: '#8A5C34',
      trunkDark: '#5A3A20',
      leaf: '#4AA33A',
      leafLight: '#8AD455',
      leafDark: '#2B7428',
      berm: '#2F7D2B',
      bermLight: '#62B444',
      bermDark: '#215F20',
      flowers: ['#FFE04A', '#FFFFFF', '#FF8FB4'],
    },
    fg: { a: '#2F7A1E', b: '#4E9C2C', c: '#6DBB38', accent: ['#FFE04A', '#FFFFFF', '#FF7FA8'] },
  },
  beach: {
    sky: [
      [0, '#2B2868'],
      [0.3, '#6E3C8C'],
      [0.58, '#D9617C'],
      [0.8, '#FF9A56'],
      [1, '#FFD27C'],
    ],
    sun: { x: 0.64, y: 0.5, r: 0.085, core: '#FFF0B4', glow: '#FFB25A', glowA: 0.7, onHorizon: true },
    cloud: { top: '#FFD9B4', bottom: '#D9779A', shade: '#A44E80', alpha: 0.95 },
    fog: '#FFB98A',
    mountains: { light: '#8C568F', fill: '#6C3F7C', shade: '#55306A' },
    sea: { top: '#F7B06C', mid: '#D9787A', bottom: '#7E4482', sparkle: '#FFE8B0', line: '#FFD7A0' },
    islands: { light: '#9A5A8E', fill: '#6E3F7A', shade: '#57306A', palm: '#4C2A5E' },
    hillsNear: {
      top: '#E8AE70',
      bottom: '#C47E5A',
      rim: '#FFD898',
      shade: '#B06A58',
      deco: '#7C7A34',
      decoLight: '#B4A24E',
    },
    trees: {
      kind: 'palm',
      trunk: '#7A4A2E',
      trunkDark: '#4E2C1C',
      leaf: '#2F6040',
      leafLight: '#5C8E46',
      leafDark: '#1F4430',
      rim: '#FFB070',
      berm: '#D08E5E',
      bermLight: '#EDB070',
      bermDark: '#1F4430',
      flowers: ['#FF6F61', '#FFD27A'],
    },
    fg: { a: '#4D5F28', b: '#6F8034', c: '#8E9A40', accent: ['#FF8A5C', '#FFD27A'] },
  },
  snow: {
    sky: [
      [0, '#2766BE'],
      [0.5, '#76B0E8'],
      [0.88, '#D3E8F8'],
      [1, '#EAF4FB'],
    ],
    sun: { x: 0.18, y: 0.13, r: 0.045, core: '#FFFFFF', glow: '#FFFFFF', glowA: 0.55 },
    cloud: { top: '#FFFFFF', bottom: '#D2E1F2', shade: '#A6BDDB', alpha: 0.95 },
    fog: '#E4F2FB',
    mountains: { light: '#C6D5EE', fill: '#9BB2D7', shade: '#7A92C0', snow: '#F6FAFF', snowShade: '#CFDDF0' },
    mountainsBack: { light: '#DCE6F5', fill: '#C2D2EA', shade: '#AABCDC', snow: '#FAFCFF', snowShade: '#E0E9F6' },
    rangeFar: { light: '#A9BEE0', fill: '#7E96C4', shade: '#5E739F', snow: '#EEF4FC', snowShade: '#C3D3EA' },
    hillsNear: {
      top: '#F2F7FD',
      bottom: '#C5D6EB',
      rim: '#FFFFFF',
      shade: '#B1C5E0',
      deco: '#2F5E5B',
      decoLight: '#46806F',
    },
    trees: {
      kind: 'pine',
      trunk: '#5A3E2B',
      trunkDark: '#3E2A1C',
      leaf: '#2F5E5B',
      leafLight: '#4A8672',
      leafDark: '#1E403F',
      snow: '#F6FAFF',
      snowShade: '#C9D9EE',
      berm: '#E2ECF7',
      bermLight: '#FFFFFF',
      bermDark: '#B9CBE3',
    },
    fg: { a: '#F4F8FD', b: '#BCCDE4', c: '#FFFFFF', accent: [] },
    snowfall: true,
  },
};

/** Сведения о темах для UI (карточки эпизодов). */
export const THEME_INFO: Record<ThemeId, { name: string; skyTop: string; skyBottom: string; accent: string }> = {
  meadow: { name: 'Зелёные холмы', skyTop: '#2F8FE0', skyBottom: '#C4EAF8', accent: '#6CC44D' },
  beach: { name: 'Пляжный закат', skyTop: '#2B2868', skyBottom: '#FFD27C', accent: '#FF9A56' },
  snow: { name: 'Снежные вершины', skyTop: '#2766BE', skyBottom: '#EAF4FB', accent: '#9FC8F0' },
};

// ───────────────────────── параметры кэша ─────────────────────────

/** Высота вида рогатки, м — масштаб, при котором слои рисуются «как задуманы». */
const AIM_VIEW_H = 15;
/** Ширина тайла полосы, px: тайл рисуется целиком (drawImage без под-прямоугольника — быстрый путь растра). */
const TILE_PX = 512;
/** Предел ширины полосы на период, px (память). */
const STRIP_MAX_PX = 7168;
/** Сколько полос держать на слой (LRU: вид рогатки остаётся, пока к нему возвращаются, + последний другой масштаб). */
const STRIPS_PER_LAYER = 2;
/** Сколько спрайтов держать на облако (LRU). */
const CLOUDS_PER_ITEM = 3;
/** Высота «шва» внизу полосы, м слоя: плавный переход к сплошной заливке под слоем. */
const SEAL_M = 0.4;
/** Бюджет фоновой достройки полос за кадр, мс (минимум один тайл за кадр, пока есть работа). */
const JOB_BUDGET_MS = 2;
/** Новую полосу / облака строим, когда масштаб не менялся столько, мс (кроме самой первой). */
const STABLE_MS = 250;
/** Относительное расхождение масштаба, при котором полоса/облако рисуются 1:1 (сдвиг ≤ 1.5 px на 1000 px). */
const EXACT_EPS = 1.5e-3;
/** Ширина столбца для обрезки прозрачного верха полосы, м слоя. */
const BIN_M = 1;

// ───────────────────────── типы слоёв ─────────────────────────

/** Максимальная высота содержимого по столбцам периода (для обрезки прозрачного верха). */
class Tops {
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

interface BuildOut {
  /** Цвет нижнего края (заливка до низа экрана) или null — слой не непрозрачен снизу. */
  fill: string | null;
  /** Высота над базой (м слоя), ниже которой полоса непрозрачна по всей ширине. */
  opaqueTop: number;
}

interface StripLayer {
  id: string;
  f: number;
  period: number;
  baseY: number;
  height: number;
  depth: number;
  /** Доля разрешения при dpr > 1.25 (экономия памяти; при dpr ≈ 1 — всегда 1:1). */
  res: number;
  seed: number;
  /** Нарисовать один период в «метрах слоя» (Y вверх, 0 — база) и отметить высоты содержимого. */
  build: (c: Ctx2D, L: StripLayer, P: Palette, tops: Tops) => BuildOut;
  /** Дымка после построения (атмосферная перспектива). */
  haze?: number;
}

/** Тайл полосы: столбец шириной ≤ TILE_PX без прозрачного верха; (x, y) — его левый верх в px полосы. */
interface Tile {
  c: AnyCanvas;
  x: number;
  y: number;
}

interface Strip {
  tiles: Tile[];
  totalPx: number;
  ppm: number;
  hPx: number;
  fill: string | null;
  opaqueTop: number;
}

/**
 * Построение полосы по тайлам: сухой прогон построителя (холст 1×1) даёт высоты содержимого и цвет заливки,
 * затем каждый тайл рисуется сразу обрезанным сверху. Тайлы строятся по нескольку за кадр в пределах бюджета.
 */
interface StripJob {
  L: StripLayer;
  totalPx: number;
  ppm: number;
  hPx: number;
  tops: Tops;
  fill: string | null;
  opaqueTop: number;
  n: number;
  tiles: Tile[];
}

interface LayerState {
  strips: Strip[];
  /** Достраиваемая полоса под новый масштаб (до готовности рисуется ближайшая старая). */
  job: StripJob | null;
}

interface CloudItem {
  x: number;
  y: number;
  w: number;
  seed: number;
}

interface CloudLayer {
  f: number;
  period: number;
  baseY: number;
  drift: number;
  items: CloudItem[];
}

const layerScale = (v: ViewInfo, sRef: number, f: number): number => sRef * Math.pow(v.scale / sRef, f);
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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

// ───────────────────────── построители полос ─────────────────────────

/** Вертикальный градиент [y0 → y1] (м слоя) из N+1 стопов col(y) — для «запечённой» дымки без отдельного прохода. */
function vGrad(c: Ctx2D, y0: number, y1: number, col: (y: number) => string, N = 12): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i <= N; i++) g.addColorStop(i / N, col(lerp(y0, y1, i / N)));
  return g;
}

/**
 * Горный хребет: градиент, теневые склоны, снег, светлый гребень. Дымка у подножия сразу входит в цвета
 * всех заливок (α(y) растёт книзу) — отдельный проход по всей полосе не нужен. Возвращает нижний цвет и минимум профиля.
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
    for (const p of pts) maxH = Math.max(maxH, p[1]);
    const snowY = maxH * opt.snowFrac;
    const snow = new Path2D();
    snow.moveTo(0, L.height + 1);
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0];
      // рваный нижний край снега; периодичен по P (целые частоты)
      const w = 0.4 * Math.sin((TAU * 23 * x) / P) + 0.25 * Math.sin((TAU * 51 * x) / P + 1) + 0.12 * Math.sin((TAU * 97 * x) / P);
      snow.lineTo(x, snowY + w - Math.max(0, pts[i][1] - snowY) * 0.08);
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

function buildMountains(c: Ctx2D, L: StripLayer, P: Palette, tops: Tops): BuildOut {
  const k = 0.9;
  if (P.mountainsBack) {
    const back = ridgedProfile(L.seed + 5, L.period, [
      [3, 2.6],
      [5, 1.6],
      [8, 0.8],
      [13, 0.35],
    ]);
    drawRange(c, L, P.mountainsBack, P.fog, (x) => 1.6 + back(x) * k, tops, { fogA: 0.6, fogTop: 3.5, snowFrac: 0.66 });
  }
  const main = ridgedProfile(L.seed, L.period, [
    [2, 3.2],
    [3, 2.0],
    [5, 1.1],
    [9, 0.45],
  ]);
  const [fill, minH] = drawRange(c, L, P.mountains, P.fog, (x) => 0.4 + main(x) * k, tops, { fogA: 0.55, fogTop: 1.4, snowFrac: 0.6 });
  return { fill, opaqueTop: minH - 0.05 };
}

/** Вторая (ближняя) гряда снежных гор (snow) с ёлочками-силуэтами у подножия. */
function buildRangeFar(c: Ctx2D, L: StripLayer, P: Palette, tops: Tops): BuildOut {
  const M = P.rangeFar!;
  const prof = ridgedProfile(L.seed, L.period, [
    [2, 1.6],
    [3, 1.2],
    [5, 0.7],
    [11, 0.25],
  ]);
  const H = (x: number): number => 0.5 + prof(x);
  const [fill, minH] = drawRange(c, L, M, P.fog, H, tops, { fogA: 0.35, fogTop: 0.9, snowFrac: 0.55 });
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

/** Холмы: градиент, мягкая тень склонов, светлый «рим», полосы-поля, декор, дымка. */
function buildHills(
  c: Ctx2D,
  L: StripLayer,
  P: Palette,
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
 * (по краю снизу-справа остаётся тень) → дуги-блики на верхне-левых краях «клубов».
 */
function foliage(c: Ctx2D, list: Blob[], dark: string, base: string, light: string, shift: number, specks = 0, r?: () => number): void {
  const body = blobPath(list);
  c.fillStyle = dark;
  c.fill(body);
  c.save();
  c.clip(body);
  c.fillStyle = base;
  c.fill(blobPath(list, -shift, shift * 1.2, 0.97));
  c.restore();
  c.lineCap = 'round';
  c.strokeStyle = rgba(light, 0.9);
  for (const [x, y, rr] of list) {
    c.lineWidth = rr * 0.2;
    c.beginPath();
    c.arc(x - shift * 0.6, y + shift * 0.6, rr * 0.72, Math.PI * 0.58, Math.PI * 0.92);
    c.stroke();
  }
  if (specks && r) {
    c.fillStyle = rgba(light, 0.85);
    c.beginPath();
    for (let i = 0; i < specks; i++) {
      const q = list[Math.floor(r() * list.length)];
      const a = lerp(Math.PI * 0.4, Math.PI * 1.0, r());
      const d = q[2] * lerp(0.35, 0.7, r());
      const px = q[0] + Math.cos(a) * d;
      const py = q[1] + Math.sin(a) * d;
      const rr = q[2] * lerp(0.07, 0.11, r());
      c.moveTo(px + rr, py);
      c.arc(px, py, rr, 0, TAU);
    }
    c.fill();
  }
}

/** Куст из 3–4 клубов (+ цветы). */
function bush(c: Ctx2D, x: number, y: number, s: number, C: { dark: string; base: string; light: string }, r: () => number, flowers?: string[]): void {
  const parts: Blob[] = [
    [x - 0.6 * s, y + 0.25 * s, 0.55 * s],
    [x, y + 0.45 * s, 0.72 * s],
    [x + 0.62 * s, y + 0.22 * s, 0.5 * s],
  ];
  if (r() < 0.5) parts.push([x + 0.2 * s, y + 0.75 * s, 0.45 * s]);
  foliage(c, parts, C.dark, C.base, C.light, 0.09 * s);
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

/** Лиственное дерево: 3 вида кроны (круглая, тополь, раскидистая). Возвращает высоту верха. */
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
  foliage(c, list, T.leafDark, T.leaf, T.leafLight, h * 0.03, 10, r);
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
    c.fillStyle = rgba(T.leafLight, 0.8);
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
function buildBerm(c: Ctx2D, L: StripLayer, P: Palette, r: () => number, tops: Tops): number {
  const T = P.trees;
  const Pm = L.period;
  const kind = T.kind;
  const wave =
    kind === 'palm'
      ? (x: number): number => 0.45 + 0.22 * Math.sin((TAU * 3 * x) / Pm) + 0.1 * Math.sin((TAU * 7 * x) / Pm + 2) + 0.04 * Math.sin((TAU * 13 * x) / Pm)
      : (x: number): number =>
          0.38 + 0.2 * Math.sin((TAU * 7 * x) / Pm) + 0.12 * Math.sin((TAU * 17 * x) / Pm + 2) + 0.06 * Math.sin((TAU * 41 * x) / Pm);
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
        bush(c, x + dx, wave(x) - 0.25, s, { dark: T.bermDark, base: T.berm, light: T.bermLight }, rand(seed), T.flowers);
      }
    }
  } else if (kind === 'palm') {
    // тропические кусты на песчаном валу
    for (let i = 0; i < Math.round(n * 0.5); i++) {
      const x = r() * Pm;
      const s = lerp(0.3, 0.55, r());
      const seed = Math.floor(r() * 1e6);
      tops.mark(x - s * 1.3, x + s * 1.3, wave(x) + s * 1.3);
      for (const dx of [0, Pm, -Pm]) {
        if (x + dx < -2 || x + dx > Pm + 2) continue;
        bush(c, x + dx, wave(x) - 0.3, s, { dark: T.bermDark, base: T.leafDark, light: T.leaf }, rand(seed), T.flowers);
      }
    }
    c.save();
    silhouette(c, pts, -L.depth);
    c.clip();
    c.lineWidth = 0.1;
    c.strokeStyle = rgba(T.bermLight, 0.8);
    strokeLine(c, pts, -0.05);
    c.restore();
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

function buildTrees(c: Ctx2D, L: StripLayer, P: Palette, tops: Tops): BuildOut {
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

/** Море (beach): градиент от горизонта, полосы волн. База слоя = линия горизонта. */
function buildSea(c: Ctx2D, L: StripLayer, P: Palette, tops: Tops): BuildOut {
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

/** Острова на горизонте (beach) — силуэты с пальмами, отражение в воде. */
function buildIslands(c: Ctx2D, L: StripLayer, P: Palette, tops: Tops): BuildOut {
  const I = P.islands!;
  const Pm = L.period;
  const r = rand(L.seed);
  const list: Array<[number, number, number]> = [
    [Pm * 0.12, 9, 2.4],
    [Pm * 0.3, 4, 1.1],
    [Pm * 0.58, 13, 3.0],
    [Pm * 0.86, 6, 1.5],
  ];
  for (const [cx, w, hh] of list) {
    const seed = Math.floor(r() * 1e6);
    tops.mark(cx - w / 2 - 1, cx + w / 2 + 1, hh * 1.8);
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
      // пальмы-силуэты
      c.strokeStyle = I.palm;
      c.lineCap = 'round';
      const np = Math.max(1, Math.round(w / 3));
      for (let k = 0; k < np; k++) {
        const u = lerp(0.3, 0.7, rr());
        const [bx, by] = pts[Math.round(u * 60)];
        const ph2 = hh * lerp(0.3, 0.45, rr());
        const lx = (rr() - 0.5) * ph2 * 0.6;
        c.lineWidth = 0.07;
        c.beginPath();
        c.moveTo(bx, by - 0.1);
        c.quadraticCurveTo(bx + lx * 0.2, by + ph2 * 0.6, bx + lx, by + ph2);
        c.stroke();
        c.lineWidth = 0.055;
        for (let f = 0; f < 6; f++) {
          const a = Math.PI * (0.05 + (f / 5) * 0.9);
          const fl = ph2 * 0.38;
          c.beginPath();
          c.moveTo(bx + lx, by + ph2);
          c.quadraticCurveTo(
            bx + lx + Math.cos(a) * fl * 0.6,
            by + ph2 + Math.sin(a) * fl * 0.4 + fl * 0.15,
            bx + lx + Math.cos(a) * fl,
            by + ph2 + Math.sin(a) * fl * 0.3 - fl * 0.3,
          );
          c.stroke();
        }
      }
    }
  }
  return { fill: null, opaqueTop: -1e9 };
}

// ───────────────────────── спрайты облаков и солнца ─────────────────────────

interface CloudSprite {
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
function renderCloud(seed: number, widthM: number, ppm: number, C: Palette['cloud']): CloudSprite {
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
  // 4) светлая кайма сверху-слева: силуэт минус силуэт со сдвигом вниз-вправо
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

function renderGlow(color: string, a: number, size: number): AnyCanvas {
  const S = Math.max(8, Math.ceil(size));
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

// ───────────────────────── Background ─────────────────────────

/** Холст 1×1 для сухих прогонов построителей полос и «прогрева» готовых холстов. */
let dryCtx: Ctx2D | null = null;

/**
 * Растеризовать отложенные команды холста сейчас (снимок через drawImage в холст 1×1): иначе браузер
 * растеризует их при первом показе, и стоимость построения всплывёт рывком в кадре отрисовки, а не в бюджете.
 */
function prime(c: AnyCanvas): void {
  if (!dryCtx) dryCtx = ctx2d(createCanvas(1, 1));
  dryCtx.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
}

/** LRU: отметить элемент списка как недавно использованный (в конец). */
function touch<T>(list: T[], item: T): T {
  const i = list.indexOf(item);
  if (i >= 0 && i !== list.length - 1) {
    list.splice(i, 1);
    list.push(item);
  }
  return item;
}

/** Максимальная высота содержимого (м слоя) на отрезке [x0, x1] м. */
function topIn(t: Tops, x0: number, x1: number): number {
  let hi = -1e9;
  const i0 = Math.max(0, Math.floor(x0 / BIN_M) - 1);
  const i1 = Math.min(t.n - 1, Math.floor(x1 / BIN_M) + 1);
  for (let i = i0; i <= i1; i++) hi = Math.max(hi, t.v[i]);
  return hi;
}

/** Применить прямоугольный клип [0, W] × [0, y) — дёшево и для GPU, и для программного растра. */
function clipAbove(ctx: Ctx2D, W: number, y: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, y);
  ctx.clip();
}

/**
 * Параллакс-фон темы. draw() рисует небо и все фоновые слои на весь экран (в экранных координатах).
 * prewarm() — построить всё заранее (экран загрузки).
 */
export class Background {
  readonly theme: ThemeId;
  private readonly P: Palette;
  private readonly cloudsFar: CloudLayer;
  private readonly cloudsNear: CloudLayer;
  /** Полосы в порядке отрисовки; облака вставляются перед индексами nearAt / после неба. */
  private readonly strips: StripLayer[] = [];
  private readonly nearAt: number;
  private readonly glitterAfter: number;
  private readonly states = new Map<string, LayerState>();
  private readonly clouds = new Map<number, CloudSprite[]>();
  private glow: AnyCanvas | null = null;
  /** Отражение солнца в море (beach) — запечённое под размер экрана. */
  private reflect: AnyCanvas | null = null;
  /** Градиент неба — столбец 1×h, растягиваемый по ширине (дешевле полосы во весь экран, не зависит от W). */
  private skyCol: AnyCanvas | null = null;
  /** Слои с незавершённой достройкой полосы в этом кадре. */
  private pending: LayerState[] = [];
  /** В этом кадре уже начато новое задание (сухой прогон — не больше одного за кадр). */
  private jobStarted = false;
  private cloudBuildsLeft = 1;
  /** Масштаб, от которого отсчитывается «неподвижность» зума (дрожание < EXACT_EPS не сбрасывает таймер). */
  private anchorScale = -1;
  private lastH = -1;
  private scaleSince = 0;
  /**
   * Быстрое масштабирование полос и облаков без сглаживания, пока зум меняется (для LOW-качества на программном
   * растре: масштабированный drawImage со сглаживанием там в ~4 раза дороже). При неподвижном зуме всё рисуется 1:1.
   */
  fastScaling = false;
  /** Отладка: вызывается после каждой фазы draw() (замер растеризации по фазам в предпросмотре). */
  _phase: ((label: string) => void) | null = null;

  constructor(theme: ThemeId) {
    this.theme = theme;
    const P = PAL[theme];
    this.P = P;
    this.cloudsFar = { f: 0.05, period: 70, baseY: 1.0, drift: 0.25, items: makeClouds(3, 7, 70, 3, 6, 1.6, 4.6) };
    this.cloudsNear = { f: 0.18, period: 90, baseY: 3.0, drift: 0.5, items: makeClouds(5, 4, 90, 4.5, 7.5, 0.6, 2.6) };
    let glitter = -1;
    if (theme === 'beach') {
      this.strips.push({ id: 'sea', f: 0.1, period: 40, baseY: -0.6, height: 0, depth: 9, res: 0.5, seed: 7, build: buildSea });
      glitter = 0;
      this.strips.push({ id: 'islands', f: 0.1, period: 70, baseY: -0.6, height: 4.4, depth: 0.4, res: 0.6, seed: 13, build: buildIslands });
    } else {
      this.strips.push({ id: 'mountains', f: 0.12, period: 64, baseY: -1.0, height: 8.5, depth: 1.5, res: 0.5, seed: 11, build: buildMountains });
    }
    this.glitterAfter = glitter;
    this.nearAt = this.strips.length;
    if (theme === 'meadow') {
      const H = P.hillsFar!;
      this.strips.push({
        id: 'hillsFar',
        f: 0.25,
        period: 44,
        baseY: -1.5,
        height: 4.6,
        depth: 1.5,
        res: 0.6,
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
      this.strips.push({ id: 'rangeFar', f: 0.25, period: 48, baseY: -1.5, height: 5.0, depth: 1.5, res: 0.6, seed: 21, build: buildRangeFar });
    }
    const N = P.hillsNear;
    const nearDeco =
      theme === 'meadow'
        ? (cc: Ctx2D, x: number, y: number, r: () => number): void => {
            if (r() < 0.22) lollipop(cc, x, y, lerp(0.35, 0.5, r()), N.deco, mix(N.deco, N.top, 0.3), N.decoLight, '#7A5A3A');
            else bush(cc, x, y, lerp(0.25, 0.5, r()), { dark: N.deco, base: mix(N.deco, N.top, 0.35), light: N.decoLight }, r, ['#FFE04A', '#FFFFFF']);
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
              if (r() < 0.75) smallPine(cc, x, y - 0.1, lerp(0.7, 1.3, r()), N.deco, mix(N.deco, '#102A28', 0.35), '#F4F9FF');
              else {
                // камень, торчащий из снега
                const s = lerp(0.2, 0.38, r());
                cc.fillStyle = '#7E8BA4';
                cc.beginPath();
                cc.moveTo(x - s, y - 0.1);
                cc.lineTo(x - s * 0.6, y + s * 0.7);
                cc.lineTo(x + s * 0.2, y + s * 0.9);
                cc.lineTo(x + s, y - 0.1);
                cc.closePath();
                cc.fill();
                cc.fillStyle = '#F4F9FF';
                cc.beginPath();
                cc.moveTo(x - s * 0.7, y + s * 0.5);
                cc.lineTo(x - s * 0.55, y + s * 0.72);
                cc.lineTo(x + s * 0.2, y + s * 0.92);
                cc.lineTo(x + s * 0.5, y + s * 0.5);
                cc.quadraticCurveTo(x, y + s * 0.62, x - s * 0.7, y + s * 0.5);
                cc.fill();
              }
            };
    this.strips.push({
      id: 'hillsNear',
      f: 0.4,
      period: 36,
      baseY: -2.0,
      height: 4.2,
      depth: 1.5,
      res: 0.75,
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
          0.14,
        ),
    });
    this.strips.push({ id: 'trees', f: 0.62, period: 30, baseY: -1.6, height: 7.8, depth: 1.5, res: 0.85, seed: 41, build: buildTrees, haze: 0.2 });
  }

  /** Построить все полосы и облака для данного вида заранее (экран загрузки). */
  prewarm(view: ViewInfo): void {
    const sRef = view.screenH / AIM_VIEW_H;
    this.anchorScale = view.scale;
    this.lastH = view.screenH;
    this.scaleSince = nowMs() - STABLE_MS;
    for (const L of this.strips) this.stripFor(L, view, sRef, true);
    for (const C of [this.cloudsFar, this.cloudsNear]) {
      const sL = layerScale(view, sRef, C.f);
      for (const c of C.items) this.cloudFor(c, sL, true);
    }
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    const W = view.screenW;
    const H = view.screenH;
    if (W <= 0 || H <= 0 || view.scale <= 0) return;
    const sRef = H / AIM_VIEW_H;
    const now = nowMs();
    if (this.anchorScale < 0 || H !== this.lastH || Math.abs(view.scale / this.anchorScale - 1) > EXACT_EPS) {
      // первый кадр строит всё сразу; дальше — только после STABLE_MS неподвижного зума
      this.scaleSince = this.anchorScale < 0 ? now - STABLE_MS : now;
      this.anchorScale = view.scale;
      this.lastH = H;
    }
    this.cloudBuildsLeft = 1;
    this.jobStarted = false;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    // 1. полосы и линии непрозрачности
    const n = this.strips.length;
    const strips: Array<Strip | null> = [];
    const geo: Array<{ sL: number; yTop: number; cover: number }> = [];
    for (const L of this.strips) {
      const sL = layerScale(view, sRef, L.f);
      const yBase = H / 2 - (L.baseY - view.camY * L.f) * sL;
      const yTop = yBase - L.height * sL;
      const s = yTop < H ? this.stripFor(L, view, sRef, false) : null;
      strips.push(s);
      const cover = s && s.fill ? yBase - s.opaqueTop * sL : yTop >= H && L.depth > 0 ? H : Infinity;
      geo.push({ sL, yTop, cover });
    }
    // limit[i] — ниже этой линии слой i закрыт следующими слоями
    const limit = new Array<number>(n + 1).fill(H);
    let run = H;
    for (let i = n - 1; i >= 0; i--) {
      limit[i] = run;
      run = Math.min(run, Math.ceil(geo[i].cover) + 2);
    }
    const skyLimit = Math.min(H, run);

    // 2. небо, солнце, дальние облака
    const hz = this.strips[0];
    const horizonY = H / 2 - (hz.baseY - view.camY * hz.f) * geo[0].sL;
    const ph = this._phase;
    ph?.('prep');
    this.drawSky(ctx, view, horizonY, skyLimit);
    ph?.('sky');
    this.drawSun(ctx, view, sRef, horizonY, skyLimit);
    ph?.('sun');
    this.drawClouds(ctx, view, sRef, this.cloudsFar, skyLimit);
    ph?.('cloudsFar');
    // 3. слои
    for (let i = 0; i < n; i++) {
      if (i === this.nearAt) {
        this.drawClouds(ctx, view, sRef, this.cloudsNear, Math.min(limit[i - 1] ?? H, geo[i].cover + 2));
        ph?.('cloudsNear');
      }
      const s = strips[i];
      if (s) this.blitStrip(ctx, view, this.strips[i], s, geo[i].sL, geo[i].yTop, limit[i]);
      ph?.(this.strips[i].id);
      if (i === this.glitterAfter) {
        this.drawSeaGlitter(ctx, view, sRef, horizonY, limit[i]);
        ph?.('glitter');
      }
    }
    if (this.P.snowfall) this.drawSnowfall(ctx, view, sRef);
    ph?.('snowfall');
    ctx.restore();
    if (this.pending.length) this.runJobs();
  }

  // ── небо и солнце ──

  private drawSky(ctx: Ctx2D, v: ViewInfo, horizonY: number, limit: number): void {
    const W = v.screenW;
    const H = v.screenH;
    const sky = this.P.sky;
    // градиент высотой 0.62·H, «привязанный» к горизонту; выше — сплошной верхний цвет, ниже — нижний
    const gH = Math.max(2, Math.round(H * 0.62));
    if (!this.skyCol || this.skyCol.height !== gH) {
      const c = createCanvas(1, gH);
      const cx = ctx2d(c);
      const g = cx.createLinearGradient(0, 0, 0, gH);
      for (const [o, col] of sky) g.addColorStop(o, col);
      cx.fillStyle = g;
      cx.fillRect(0, 0, 1, gH);
      this.skyCol = c;
    }
    const top = Math.round(horizonY) - gH;
    const bot = top + gH;
    if (top > 0) {
      ctx.fillStyle = sky[0][1];
      ctx.fillRect(0, 0, W, Math.min(top, limit));
    }
    if (top < limit && bot > 0) {
      // столбец целиком (без под-прямоугольника источника), низ режет прямоугольный клип
      const clip = bot > limit;
      if (clip) clipAbove(ctx, W, limit);
      ctx.drawImage(this.skyCol, 0, top, W, gH);
      if (clip) ctx.restore();
    }
    if (bot < limit) {
      ctx.fillStyle = sky[sky.length - 1][1];
      ctx.fillRect(0, Math.max(0, bot), W, limit - Math.max(0, bot));
    }
  }

  private drawSun(ctx: Ctx2D, v: ViewInfo, sRef: number, horizonY: number, limit: number): void {
    const S = this.P.sun;
    const R = S.r * v.screenH;
    const sx = S.x * v.screenW - v.camX * 0.02 * sRef;
    const sy = S.onHorizon ? horizonY - R * 0.35 : S.y * v.screenH + v.camY * 0.02 * sRef;
    const gr = Math.round(R * 4.8);
    if (!this.glow || this.glow.width !== gr * 2) {
      this.glow = renderGlow(S.glow, S.glowA, gr * 2);
      this.reflect = null;
    }
    const y0 = Math.round(sy) - gr;
    if (y0 < limit && y0 + gr * 2 > 0) {
      const clip = y0 + gr * 2 > limit;
      if (clip) clipAbove(ctx, v.screenW, limit);
      ctx.drawImage(this.glow, Math.round(sx) - gr, y0);
      if (clip) ctx.restore();
    }
    if (sy + R < 0 || sy - R > limit) return;
    const core = ctx.createRadialGradient(sx - R * 0.3, sy - R * 0.3, R * 0.1, sx, sy, R);
    core.addColorStop(0, '#FFFFFF');
    core.addColorStop(1, S.core);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, TAU);
    ctx.fill();
  }

  /** Солнечная дорожка на воде (beach): отражённое свечение и мерцающие штрихи под солнцем. */
  private drawSeaGlitter(ctx: Ctx2D, v: ViewInfo, sRef: number, horizonY: number, limit: number): void {
    const S = this.P.sea!;
    const sx = this.P.sun.x * v.screenW - v.camX * 0.02 * sRef;
    const R = this.P.sun.r * v.screenH;
    const bottom = Math.min(limit, horizonY + v.screenH * 0.32);
    if (bottom <= horizonY) return;
    if (this.glow) {
      // отражённое свечение: нижняя половина ореола, сплющенная по высоте (запекается один раз на размер)
      const gw = Math.round(R * 5);
      const gh = Math.max(2, Math.round(R * 2.8));
      if (!this.reflect || this.reflect.width !== gw * 2 || this.reflect.height !== gh) {
        const c = createCanvas(gw * 2, gh);
        const cx = ctx2d(c);
        cx.globalAlpha = 0.7;
        cx.drawImage(this.glow, 0, this.glow.height / 2, this.glow.width, this.glow.height / 2, 0, 0, gw * 2, gh);
        this.reflect = c;
      }
      const y0 = Math.round(horizonY - R * 0.1);
      const clip = y0 + gh > bottom;
      if (clip) clipAbove(ctx, v.screenW, bottom);
      ctx.drawImage(this.reflect, Math.round(sx) - gw, y0);
      if (clip) ctx.restore();
    }
    const r = rand(5);
    const t = v.time;
    ctx.fillStyle = S.sparkle;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const y = horizonY + 3 * v.dpr + u * u * (horizonY + v.screenH * 0.32 - horizonY);
      const w = R * (0.5 + 2.4 * u) * lerp(0.4, 1, r());
      const jx = (r() - 0.5) * R * 0.8 * u;
      const a = (0.9 - 0.55 * u) * (0.65 + 0.35 * Math.sin(2.6 * t + i * 1.9 + r() * 3));
      if (y > bottom) continue;
      ctx.globalAlpha = clamp(a, 0, 1);
      const hh = (1.2 + 2.6 * u) * v.dpr;
      ctx.fillRect(sx - w / 2 + jx + Math.sin(t * 0.8 + i) * u * 3 * v.dpr, y, w, hh);
    }
    ctx.globalAlpha = 1;
  }

  // ── облака ──

  /** Спрайт облака под масштаб sL: точный при неподвижном зуме, иначе ближайший готовый. */
  private cloudFor(c: CloudItem, sL: number, force: boolean): CloudSprite {
    let list = this.clouds.get(c.seed);
    if (!list) {
      list = [];
      this.clouds.set(c.seed, list);
    }
    let best: CloudSprite | null = null;
    let err = Infinity;
    for (const s of list) {
      const e = Math.abs(Math.log(sL / s.ppm));
      if (e < err) {
        err = e;
        best = s;
      }
    }
    if (best && err < EXACT_EPS) return touch(list, best);
    const stable = nowMs() - this.scaleSince >= STABLE_MS;
    if (!best || force || (stable && this.cloudBuildsLeft > 0)) {
      if (best) this.cloudBuildsLeft--;
      const s = renderCloud(c.seed, c.w, sL, this.P.cloud);
      prime(s.canvas);
      list.push(s);
      if (list.length > CLOUDS_PER_ITEM) list.shift();
      return s;
    }
    return touch(list, best);
  }

  private drawClouds(ctx: Ctx2D, v: ViewInfo, sRef: number, L: CloudLayer, limit: number): void {
    const sL = layerScale(v, sRef, L.f);
    const periodPx = L.period * sL;
    const drift = L.drift * v.time;
    ctx.globalAlpha = this.P.cloud.alpha;
    if (this.fastScaling) ctx.imageSmoothingEnabled = false;
    for (const c of L.items) {
      const yb = v.screenH / 2 - (L.baseY + c.y - v.camY * L.f) * sL;
      const hPx = c.w * 0.6 * sL;
      if (yb < 0 || yb - hPx > limit) continue;
      const wPx = (c.w + 0.6) * sL;
      let x = v.screenW / 2 + (c.x + drift - v.camX * L.f) * sL;
      x = ((x % periodPx) + periodPx) % periodPx;
      for (let X = x - periodPx; X < v.screenW; X += periodPx) {
        if (X + wPx < 0) continue;
        const s = this.cloudFor(c, sL, false);
        const k = sL / s.ppm;
        if (Math.abs(k - 1) < EXACT_EPS) ctx.drawImage(s.canvas, Math.round(X - s.ox), Math.round(yb - s.oy));
        else ctx.drawImage(s.canvas, X - s.ox * k, yb - s.oy * k, s.canvas.width * k, s.canvas.height * k);
      }
    }
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
  }

  // ── снегопад (snow): дальние хлопья за миром ──

  private drawSnowfall(ctx: Ctx2D, v: ViewInfo, sRef: number): void {
    const r = rand(91);
    const t = v.time;
    const W = v.screenW;
    const H = v.screenH;
    const par = 0.3 * sRef;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    for (let i = 0; i < 70; i++) {
      const sz = lerp(1.2, 2.8, r()) * v.dpr;
      const vy = lerp(18, 45, r()) * v.dpr;
      const ph = r() * TAU;
      const fx = r();
      const fy = r();
      const sw = lerp(0.5, 1, r());
      const xx = fx * (W + 40) - v.camX * par + Math.sin(t * sw + ph) * 10 * v.dpr + t * 8 * v.dpr;
      const yy = fy * (H + 40) + t * vy + v.camY * par;
      const X = (((xx % (W + 40)) + (W + 40)) % (W + 40)) - 20;
      const Y = (((yy % (H + 40)) + (H + 40)) % (H + 40)) - 20;
      ctx.moveTo(X + sz, Y);
      ctx.arc(X, Y, sz, 0, TAU);
    }
    ctx.fill();
  }

  // ── полосы ──

  /**
   * Полоса под текущий масштаб: точная (1:1), если готова; иначе ближайшая готовая (масштабируется), а точная
   * достраивается в фоне по тайлам, когда зум неподвижен STABLE_MS. Без готовых полос (первый кадр) или с force —
   * строится сразу целиком.
   */
  private stripFor(L: StripLayer, v: ViewInfo, sRef: number, force: boolean): Strip {
    let st = this.states.get(L.id);
    if (!st) {
      st = { strips: [], job: null };
      this.states.set(L.id, st);
    }
    const res = v.dpr > 1.25 ? L.res : 1;
    const want = Math.min(layerScale(v, sRef, L.f) * res, STRIP_MAX_PX / L.period);
    const totalWant = Math.max(8, Math.round(L.period * want));
    let best: Strip | null = null;
    let err = Infinity;
    for (const s of st.strips) {
      const e = Math.abs(Math.log(totalWant / s.totalPx));
      if (e < err) {
        err = e;
        best = s;
      }
    }
    if (best && err < EXACT_EPS) {
      st.job = null;
      return touch(st.strips, best);
    }
    if (!best || force) {
      const job = this.startJob(L, totalWant);
      while (job.tiles.length < job.n) this.buildTile(job);
      st.job = null;
      return this.finishJob(st, job);
    }
    // задание под устаревший масштаб — отменить; новое — только при неподвижном зуме
    if (st.job && Math.abs(Math.log(totalWant / st.job.totalPx)) > EXACT_EPS) st.job = null;
    if (!st.job && !this.jobStarted && nowMs() - this.scaleSince >= STABLE_MS) {
      st.job = this.startJob(L, totalWant);
      this.jobStarted = true;
    }
    if (st.job) this.pending.push(st);
    return touch(st.strips, best);
  }

  /** Сухой прогон построителя: высоты содержимого (для обрезки тайлов) и цвет заливки под слоем. */
  private startJob(L: StripLayer, totalPx: number): StripJob {
    const ppm = totalPx / L.period;
    const hPx = Math.max(2, Math.ceil((L.height + L.depth) * ppm));
    if (!dryCtx) dryCtx = ctx2d(createCanvas(1, 1));
    const tops = new Tops(L.period);
    dryCtx.save();
    dryCtx.setTransform(ppm, 0, 0, -ppm, 0, L.height * ppm);
    const out = L.build(dryCtx, L, this.P, tops);
    dryCtx.restore();
    const fill = out.fill && L.haze ? mix(out.fill, this.P.fog, L.haze) : out.fill;
    return { L, totalPx, ppm, hPx, tops, fill, opaqueTop: out.opaqueTop, n: Math.ceil(totalPx / TILE_PX), tiles: [] };
  }

  /** Следующий тайл задания: столбец ≤ TILE_PX без прозрачного верха, с дымкой и «швом» внизу. */
  private buildTile(job: StripJob): void {
    const { L, ppm, hPx, totalPx, n } = job;
    const i = job.tiles.length;
    const x0 = Math.round((i * totalPx) / n);
    const x1 = Math.round(((i + 1) * totalPx) / n);
    const y = clamp(Math.floor((L.height - topIn(job.tops, x0 / ppm, x1 / ppm) - 0.15) * ppm), 0, hPx - 1);
    const w = x1 - x0;
    const h = hPx - y;
    const c = createCanvas(w, h);
    const cx = ctx2d(c);
    cx.setTransform(ppm, 0, 0, -ppm, -x0, L.height * ppm - y);
    cx.lineJoin = 'round';
    L.build(cx, L, this.P, new Tops(L.period));
    cx.setTransform(1, 0, 0, 1, 0, 0);
    if (L.haze) {
      cx.globalCompositeOperation = 'source-atop';
      cx.fillStyle = rgba(this.P.fog, L.haze);
      cx.fillRect(0, 0, w, h);
      cx.globalCompositeOperation = 'source-over';
    }
    if (job.fill) {
      // «шов»: низ полосы плавно переходит ровно в цвет заливки под слоем (без чтения пикселей)
      const sh = Math.min(h, Math.max(2, Math.round(SEAL_M * ppm)));
      const g = cx.createLinearGradient(0, h - sh, 0, h - 1);
      g.addColorStop(0, rgba(job.fill, 0));
      g.addColorStop(1, job.fill);
      cx.fillStyle = g;
      cx.fillRect(0, h - sh, w, sh);
    }
    prime(c);
    job.tiles.push({ c, x: x0, y });
  }

  private finishJob(st: LayerState, job: StripJob): Strip {
    const s: Strip = { tiles: job.tiles, totalPx: job.totalPx, ppm: job.ppm, hPx: job.hPx, fill: job.fill, opaqueTop: job.opaqueTop };
    st.strips.push(s);
    while (st.strips.length > STRIPS_PER_LAYER) st.strips.shift();
    return s;
  }

  /** Достроить отложенные полосы в пределах бюджета кадра; готовая полоса используется со следующего кадра. */
  private runJobs(): void {
    const t0 = nowMs();
    let first = true;
    for (const st of this.pending) {
      const job = st.job;
      if (!job) continue;
      while (job.tiles.length < job.n && (first || nowMs() - t0 < JOB_BUDGET_MS)) {
        this.buildTile(job);
        first = false;
      }
      if (job.tiles.length === job.n) {
        this.finishJob(st, job);
        st.job = null;
      }
      if (nowMs() - t0 >= JOB_BUDGET_MS) break;
    }
    this.pending.length = 0;
  }

  /** Блит полосы: периодические копии тайлов целиком, низ — прямоугольный клип по limit, ниже полосы — заливка. */
  private blitStrip(ctx: Ctx2D, v: ViewInfo, L: StripLayer, s: Strip, sL: number, yTopF: number, limit: number): void {
    const W = v.screenW;
    let k = sL / s.ppm;
    const exact = Math.abs(k - 1) < EXACT_EPS;
    if (exact) k = 1;
    const yTop = exact ? Math.round(yTopF) : yTopF;
    const yBot = yTop + s.hPx * k;
    const y1 = Math.min(yBot, limit);
    if (y1 > yTop && yTop < v.screenH) {
      const clip = yBot > limit + 0.5;
      if (clip) clipAbove(ctx, W, limit);
      if (!exact && this.fastScaling) ctx.imageSmoothingEnabled = false;
      const periodPx = s.totalPx * k;
      let x0 = W / 2 - v.camX * L.f * sL;
      x0 = (((x0 % periodPx) + periodPx) % periodPx) - periodPx;
      if (exact) x0 = Math.round(x0);
      for (let px = x0; px < W; px += periodPx) {
        for (const t of s.tiles) {
          // края тайлов округлены: соседние копии стыкуются без щелей и при масштабировании
          const xl = Math.round(px + t.x * k);
          const xr = Math.round(px + (t.x + t.c.width) * k);
          if (xr <= 0 || xl >= W || xr <= xl) continue;
          const dy = yTop + t.y * k;
          if (dy >= y1) continue;
          if (exact) ctx.drawImage(t.c, xl, dy);
          else ctx.drawImage(t.c, xl, dy, xr - xl, t.c.height * k);
        }
      }
      ctx.imageSmoothingEnabled = true;
      if (clip) ctx.restore();
    }
    if (s.fill && limit > yBot - 1) {
      const yb = Math.max(0, Math.floor(yBot - 1));
      ctx.fillStyle = s.fill;
      ctx.fillRect(0, yb, W, limit - yb);
    }
  }
}

// ───────────────────────── передний план ─────────────────────────

/** Доля высоты экрана, которую передний план может занять снизу в покое камеры. */
const FG_MAX_FRAC = 0.03;

/**
 * Передний план: пучки травы, широколистные кустики и цветы (meadow / beach), сугробы с сухими травинками (snow),
 * поднимающиеся из-за нижнего края кадра. Основания — чуть ниже нижнего края кадра камеры в покое
 * (мировая Y = −GROUND_MARGIN, 00 §1.10), по Y — вместе с миром: при подъёме камеры передний план уходит вниз.
 * Высота — не больше FG_MAX_FRAC высоты экрана (масштаб ×1.1 мира, ограниченный сверху). X — параллакс 1.2,
 * лёгкое покачивание от ветра.
 */
export function drawForeground(ctx: CanvasRenderingContext2D, theme: ThemeId, view: ViewInfo): void {
  const P = PAL[theme];
  // самые высокие элементы ≈ 0.76·s0 от основания, основание на 0.1·s0 ниже края → видно ≤ 0.66·s0
  const s0 = Math.min(view.scale * 1.1, (FG_MAX_FRAC * view.screenH) / 0.66);
  if (s0 <= 0) return;
  const f = 1.2;
  const yb = view.screenH / 2 + (CAMERA.GROUND_MARGIN + view.camY) * view.scale + 0.1 * s0;
  if (yb - s0 > view.screenH) return;
  const Pm = 18;
  const periodPx = Pm * s0;
  let x0 = view.screenW / 2 - view.camX * f * s0;
  x0 = (((x0 % periodPx) + periodPx) % periodPx) - periodPx;
  const t = view.time;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const pathA = new Path2D();
  const pathB = new Path2D();
  const pathC = new Path2D();
  const leaves = new Path2D();
  const leavesLit = new Path2D();
  const twigs = new Path2D();
  const shadow = new Path2D();
  const flowers: Array<[number, number, number, string]> = [];
  for (let px = x0; px < view.screenW + periodPx; px += periodPx) {
    const r = rand(8 + theme.length);
    const count = theme === 'snow' ? 6 : 9;
    for (let i = 0; i < count; i++) {
      const cx = px + ((i + r() * 0.7) / count) * periodPx;
      const s = s0 * lerp(0.75, 1.05, r());
      const kind = r();
      const flower = r();
      const fcol = P.fg.accent.length ? P.fg.accent[Math.floor(r() * P.fg.accent.length)] : '';
      const nb = 6 + Math.floor(r() * 4);
      const hs: number[] = [];
      for (let j = 0; j < nb; j++) hs.push(r());
      if (cx < -s * 2 || cx > view.screenW + s * 2) continue;
      const sway = Math.sin(1.3 * t + cx * 0.013) * 0.06;
      if (theme === 'snow') {
        // невысокий сугроб с плоским дном: тень, затенённое тело, освещённая шапка, блик
        const w = s * lerp(0.6, 0.95, kind);
        const h = s * lerp(0.26, 0.4, flower);
        const by = yb + 0.12 * s;
        shadow.moveTo(cx + w * 1.05 + 0.05 * s, by + 0.03 * s);
        shadow.ellipse(cx + 0.05 * s, by + 0.03 * s, w * 1.05, 0.07 * s, 0, 0, TAU);
        pathB.moveTo(cx + w, by);
        pathB.ellipse(cx, by, w, h, 0, Math.PI, TAU);
        pathA.moveTo(cx + w * 0.8, by - h * 0.12);
        pathA.ellipse(cx - w * 0.12, by - h * 0.12, w * 0.92, h * 0.86, 0, Math.PI, TAU);
        pathC.moveTo(cx - w * 0.3 + w * 0.26, by - h * 0.72);
        pathC.ellipse(cx - w * 0.3, by - h * 0.72, w * 0.26, h * 0.1, -0.15, 0, TAU);
        if (hs[0] < 0.6) {
          // сухие травинки из снега
          for (let j = 0; j < 3; j++) {
            const bx = cx + (hs[j + 1] - 0.5) * w;
            const hh = s * lerp(0.25, 0.45, hs[j + 2]);
            const lean = (hs[j + 3] - 0.5) * 0.3 * s + sway * hh * 2;
            twigs.moveTo(bx, by - h * 0.5);
            twigs.quadraticCurveTo(bx + lean * 0.3, by - h * 0.5 - hh * 0.6, bx + lean, by - h * 0.5 - hh);
          }
        }
        continue;
      }
      // мягкая тень у основания
      shadow.moveTo(cx + 0.42 * s, yb + 0.1 * s);
      shadow.ellipse(cx, yb + 0.1 * s, 0.42 * s, 0.08 * s, 0, 0, TAU);
      if (kind < 0.22) {
        // широколистный кустик: 4–5 листьев веером
        const nl = 4 + Math.floor(hs[0] * 2);
        for (let j = 0; j < nl; j++) {
          const a = -Math.PI / 2 + (j / (nl - 1) - 0.5) * 2.2 + sway;
          const L = s * lerp(0.32, 0.46, hs[j]);
          const lx = cx + Math.cos(a) * L * 0.55;
          const ly = yb + 0.06 * s + Math.sin(a) * L * 0.55;
          leaves.moveTo(lx + L * 0.5 * Math.cos(a), ly + L * 0.5 * Math.sin(a));
          leaves.ellipse(lx, ly, L * 0.52, L * 0.2, a, 0, TAU);
          leavesLit.moveTo(lx - 0.02 * s, ly - 0.02 * s);
          leavesLit.ellipse(lx - 0.02 * s, ly - 0.02 * s, L * 0.38, L * 0.08, a, 0, TAU);
        }
        continue;
      }
      for (let j = 0; j < nb; j++) {
        const u = j / (nb - 1) - 0.5;
        const h = s * lerp(0.35, theme === 'beach' ? 0.74 : 0.72, hs[j]) * (1 - Math.abs(u) * 0.6);
        const lean = u * 0.9 * s * 0.5 + (hs[j] - 0.5) * 0.12 * s + sway * h * 1.5;
        const bx = cx + u * 0.35 * s;
        const bw = (theme === 'beach' ? 0.045 : 0.07) * s;
        const p = j % 3 === 0 ? pathA : j % 3 === 1 ? pathB : pathC;
        p.moveTo(bx - bw, yb + 0.1 * s);
        p.quadraticCurveTo(bx - bw * 0.2 + lean * 0.3, yb - h * 0.6, bx + lean, yb - h);
        p.quadraticCurveTo(bx + bw * 0.6 + lean * 0.3, yb - h * 0.5, bx + bw, yb + 0.1 * s);
        p.closePath();
      }
      if (fcol && flower < 0.35) flowers.push([cx + sway * s * 0.4, yb - 0.5 * s, s, fcol]);
    }
  }
  if (theme === 'snow') {
    ctx.fillStyle = 'rgba(120,145,190,0.35)';
    ctx.fill(shadow);
    ctx.fillStyle = P.fg.b;
    ctx.fill(pathB);
    ctx.fillStyle = P.fg.a;
    ctx.fill(pathA);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill(pathC);
    ctx.strokeStyle = '#7A6A5A';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 0.025 * s0);
    ctx.stroke(twigs);
  } else {
    ctx.fillStyle = 'rgba(20,40,10,0.22)';
    ctx.fill(shadow);
    ctx.fillStyle = P.fg.a;
    ctx.fill(leaves);
    ctx.fillStyle = rgba(P.fg.c, 0.85);
    ctx.fill(leavesLit);
    ctx.fillStyle = P.fg.a;
    ctx.fill(pathA);
    ctx.fillStyle = P.fg.b;
    ctx.fill(pathB);
    ctx.fillStyle = P.fg.c;
    ctx.fill(pathC);
    for (const [fx, fy, s, col] of flowers) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * TAU;
        const x = fx + Math.cos(a) * 0.07 * s;
        const y = fy + Math.sin(a) * 0.07 * s;
        ctx.moveTo(x + 0.048 * s, y);
        ctx.arc(x, y, 0.048 * s, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = col === '#FFFFFF' ? '#FFD23A' : '#FFFFFF';
      ctx.beginPath();
      ctx.arc(fx, fy, 0.036 * s, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}
