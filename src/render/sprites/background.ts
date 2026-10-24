// Параллакс-фон трёх тем: небо, солнце, облака (дрейф), горы/острова, море, холмы, деревья — плюс
// передний план и (реэкспорт) рельеф. Слои — бесшовные горизонтальные полосы, запечённые в offscreen-холсты
// по ступеням масштаба; каждый кадр — только drawImage и пара заливок (см. docs/research/04-visual.md §2–§5).
//
// Математика слоя (04 §3.1): sL = sRef·(s/sRef)^f, sRef = H/15;
//   X = W/2 + (xL − camX·f)·sL;  Y = H/2 − (yL + baseY − camY·f)·sL.
// Ниже полосы каждый непрозрачный слой заливается своим нижним цветом до низа экрана — щелей нет при любом зуме.

import type { ThemeId } from '../../core/types';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { ViewInfo } from '../view';
import { TAU, clamp, lerp, mix, rand, rgba } from './terrain';

export { drawTerrain } from './terrain';

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
    cloud: { top: '#FFFFFF', bottom: '#CFE5F4', shade: '#B3D1E9', alpha: 0.96 },
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
      leafLight: '#86D152',
      leafDark: '#2B7428',
      berm: '#2F7D2B',
      bermLight: '#58AD3E',
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
    cloud: { top: '#FFD6AE', bottom: '#C9668A', shade: '#A9507E', alpha: 0.93 },
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
      berm: '#C9875C',
      bermLight: '#E7A86C',
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
    cloud: { top: '#FFFFFF', bottom: '#C8D9EC', shade: '#AFC4DE', alpha: 0.92 },
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
    fg: { a: '#EAF2FB', b: '#BACDE5', c: '#FFFFFF', accent: [] },
    snowfall: true,
  },
};

/** Сведения о темах для UI (карточки эпизодов). */
export const THEME_INFO: Record<ThemeId, { name: string; skyTop: string; skyBottom: string; accent: string }> = {
  meadow: { name: 'Зелёные холмы', skyTop: '#2F8FE0', skyBottom: '#C4EAF8', accent: '#6CC44D' },
  beach: { name: 'Пляжный закат', skyTop: '#2B2868', skyBottom: '#FFD27C', accent: '#FF9A56' },
  snow: { name: 'Снежные вершины', skyTop: '#2766BE', skyBottom: '#EAF4FB', accent: '#9FC8F0' },
};

// ───────────────────────── слои ─────────────────────────

/** Высота вида рогатки, м — масштаб, при котором слои рисуются «как задуманы». */
const AIM_VIEW_H = 15;
/** Максимальная ширина одного тайла полосы, px. */
const TILE_MAX_PX = 2048;
/** Предел ширины полосы на период, px (память). */
const STRIP_MAX_PX = 7168;
/** Сколько полос (ступеней масштаба) держать на слой. */
const STRIPS_PER_LAYER = 2;
/** Перестраивать полосу, если её масштаб отличается от нужного сильнее этого (гистерезис). */
const REBUILD_LO = 0.8;
const REBUILD_HI = 1.25;
/** Новую полосу строим, когда зум не менялся столько, мс (кроме самой первой). */
const STABLE_MS = 250;

interface StripLayer {
  id: string;
  f: number;
  period: number;
  baseY: number;
  height: number;
  depth: number;
  res: number;
  seed: number;
  /** Нарисовать один период в «метрах слоя» (Y вверх, 0 — база). Вернуть цвет нижнего края (для заливки). */
  build: (c: Ctx2D, L: StripLayer, P: Palette) => string | null;
  /** Дымка после построения (атмосферная перспектива). */
  haze?: number;
}

interface Strip {
  tiles: AnyCanvas[];
  /** Начало каждого тайла по X, м слоя. */
  tileX: number[];
  tileW: number[];
  ppm: number;
  hPx: number;
  fill: string | null;
  bucket: number;
}

interface LayerState {
  strips: Strip[];
  wantBucket: number;
  wantSince: number;
}

interface CloudItem {
  x: number;
  y: number;
  w: number;
  seed: number;
}

interface CloudLayer {
  id: string;
  f: number;
  period: number;
  baseY: number;
  drift: number;
  res: number;
  items: CloudItem[];
}

const layerScale = (v: ViewInfo, sRef: number, f: number): number => sRef * Math.pow(v.scale / sRef, f);
const bucketOf = (ppm: number): number => Math.pow(2, Math.round(4 * Math.log2(Math.max(1e-3, ppm))) / 4);

function makeClouds(seed: number, count: number, P: number, wMin: number, wMax: number, yMin: number, yMax: number): CloudItem[] {
  const r = rand(seed);
  const out: CloudItem[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: ((i + r() * 0.6) * P) / count,
      y: lerp(yMin, yMax, r()),
      w: lerp(wMin, wMax, r()),
      seed: Math.floor(r() * 1e6),
    });
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

// ───────────────────────── построители полос ─────────────────────────

/** Горный хребет: градиент, теневые склоны, снег, светлый гребень, дымка у подножия. */
function drawRange(
  c: Ctx2D,
  L: StripLayer,
  M: RangePal,
  fog: string,
  H: (x: number) => number,
  opt: { fogA: number; fogTop: number; snowFrac: number; topY: number; haze?: number },
): string {
  const P = L.period;
  const pts = sample(P, 6, H);
  const bottomCol = mix(M.fill, fog, 0.5);
  const g = c.createLinearGradient(0, opt.topY, 0, -L.depth);
  g.addColorStop(0, M.light);
  g.addColorStop(0.5, M.fill);
  g.addColorStop(1, bottomCol);
  silhouette(c, pts, -L.depth);
  c.fillStyle = g;
  c.fill();
  c.save();
  c.clip();
  c.fillStyle = rgba(M.shade, 0.55);
  slopeShade(c, pts, 0.55, 0.9);
  c.fill();
  if (M.snow) {
    let maxH = 0;
    for (const p of pts) maxH = Math.max(maxH, p[1]);
    const snowY = maxH * opt.snowFrac;
    const snow = new Path2D();
    snow.moveTo(0, opt.topY + 1);
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0];
      // рваный нижний край снега; периодичен по P (целые частоты)
      const w = 0.4 * Math.sin((TAU * 23 * x) / P) + 0.25 * Math.sin((TAU * 51 * x) / P + 1) + 0.12 * Math.sin((TAU * 97 * x) / P);
      snow.lineTo(x, snowY + w - Math.max(0, pts[i][1] - snowY) * 0.08);
    }
    snow.lineTo(P, opt.topY + 1);
    snow.closePath();
    c.fillStyle = M.snow;
    c.fill(snow);
    c.save();
    c.clip(snow);
    c.fillStyle = M.snowShade ?? M.shade;
    slopeShade(c, pts, 0.55, 0.9);
    c.fill();
    c.restore();
  }
  // светлый гребень (контровой свет)
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.lineWidth = 0.14;
  c.strokeStyle = rgba(M.snow ?? M.light, 0.7);
  c.stroke();
  const fg = c.createLinearGradient(0, opt.fogTop, 0, -L.depth * 0.3);
  fg.addColorStop(0, rgba(fog, 0));
  fg.addColorStop(1, rgba(fog, opt.fogA));
  c.fillStyle = fg;
  c.fillRect(0, -L.depth, P, opt.fogTop + L.depth);
  c.restore();
  return mix(bottomCol, fog, opt.fogA);
}

function buildMountains(c: Ctx2D, L: StripLayer, P: Palette): string {
  const k = 0.9;
  if (P.mountainsBack) {
    const back = ridgedProfile(L.seed + 5, L.period, [
      [3, 2.6],
      [5, 1.6],
      [8, 0.8],
      [13, 0.35],
    ]);
    drawRange(c, L, P.mountainsBack, P.fog, (x) => 1.6 + back(x) * k, {
      fogA: 0.6,
      fogTop: 3.5,
      snowFrac: 0.66,
      topY: L.height,
    });
  }
  const main = ridgedProfile(L.seed, L.period, [
    [2, 3.2],
    [3, 2.0],
    [5, 1.1],
    [9, 0.45],
  ]);
  return drawRange(c, L, P.mountains, P.fog, (x) => 0.4 + main(x) * k, {
    fogA: 0.55,
    fogTop: 1.4,
    snowFrac: 0.6,
    topY: L.height,
  });
}

/** Вторая (ближняя) гряда снежных гор (snow). */
function buildRangeFar(c: Ctx2D, L: StripLayer, P: Palette): string {
  const M = P.rangeFar!;
  const prof = ridgedProfile(L.seed, L.period, [
    [2, 1.6],
    [3, 1.2],
    [5, 0.7],
    [11, 0.25],
  ]);
  const col = drawRange(c, L, M, P.fog, (x) => 0.5 + prof(x), {
    fogA: 0.35,
    fogTop: 0.9,
    snowFrac: 0.55,
    topY: L.height,
  });
  // ёлочки-силуэты у подножия
  const r = rand(L.seed + 3);
  const pts = sample(L.period, 4, (x) => 0.5 + prof(x));
  const minAt = (x: number): number => {
    const i = clamp(Math.round((x / L.period) * (pts.length - 1)), 0, pts.length - 1);
    return pts[i][1];
  };
  c.fillStyle = mix(M.shade, P.fog, 0.25);
  c.beginPath();
  for (let i = 0; i < 60; i++) {
    const x = r() * L.period;
    const top = Math.min(minAt(x) - 0.1, lerp(0.2, 0.9, r()));
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
  return col;
}

/** Холмы: градиент, мягкая тень склонов, светлый «рим», полосы-поля, декор, дымка. */
function buildHills(
  c: Ctx2D,
  L: StripLayer,
  P: Palette,
  C: HillPal,
  terms: Array<[number, number]>,
  amp0: number,
  deco: (c: Ctx2D, x: number, y: number, r: () => number) => void,
  decoDensity: number,
  fogA: number,
): string {
  const Pm = L.period;
  const prof = sineProfile(L.seed, Pm, terms);
  const H = (x: number): number => amp0 + prof(x);
  const pts = sample(Pm, 5, H);
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
  for (const [off, a] of [
    [0.55, 0.16],
    [1.25, 0.12],
  ] as const) {
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1] - off) : c.moveTo(p[0], p[1] - off)));
    c.lineWidth = 0.22;
    c.strokeStyle = rgba(C.rim, a);
    c.stroke();
  }
  // светлый «рим» по гребню
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1] - 0.06) : c.moveTo(p[0], p[1] - 0.06)));
  c.lineWidth = 0.15;
  c.strokeStyle = rgba(C.rim, 0.9);
  c.stroke();
  c.restore();
  // декор по гребню (с переносом через край периода)
  const r = rand(L.seed + 101);
  const count = Math.round(Pm * decoDensity);
  for (let i = 0; i < count; i++) {
    const x = r() * Pm;
    const sub = r();
    const seed = Math.floor(r() * 1e6);
    for (const dx of [0, Pm, -Pm]) {
      const X = x + dx;
      if (X < -2 || X > Pm + 2) continue;
      deco(c, X, H(x) - 0.04 - sub * 0.12, rand(seed));
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
  return mix(C.bottom, P.fog, fogA);
}

// ───────────────────────── декор холмов ─────────────────────────

function blobs(c: Ctx2D, list: Array<[number, number, number]>, color: string): void {
  c.fillStyle = color;
  c.beginPath();
  for (const [x, y, r] of list) {
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, TAU);
  }
  c.fill();
}

/** Куст из трёх-четырёх кругов с тенью и бликом. */
function bush(c: Ctx2D, x: number, y: number, s: number, C: { dark: string; base: string; light: string }, r: () => number, flowers?: string[]): void {
  const parts: Array<[number, number, number]> = [
    [x - 0.6 * s, y + 0.25 * s, 0.55 * s],
    [x, y + 0.45 * s, 0.72 * s],
    [x + 0.62 * s, y + 0.22 * s, 0.5 * s],
  ];
  if (r() < 0.5) parts.push([x + 0.2 * s, y + 0.75 * s, 0.45 * s]);
  blobs(
    c,
    parts.map(([a, b, q]) => [a + 0.06 * s, b - 0.06 * s, q * 1.04]),
    C.dark,
  );
  blobs(c, parts, C.base);
  blobs(
    c,
    parts.map(([a, b, q]) => [a - q * 0.25, b + q * 0.3, q * 0.45]),
    rgba(C.light, 0.85),
  );
  if (flowers && flowers.length && r() < 0.55) {
    for (let i = 0; i < 4; i++) {
      const p = parts[Math.floor(r() * parts.length)];
      const a = r() * TAU;
      const d = p[2] * lerp(0.2, 0.75, r());
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
  blobs(c, [[x + 0.05 * s, y + 1.55 * s, 0.68 * s]], dark);
  blobs(c, [[x, y + 1.6 * s, 0.64 * s]], base);
  blobs(c, [[x - 0.2 * s, y + 1.8 * s, 0.3 * s]], rgba(light, 0.85));
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
  let parts: Array<[number, number, number]>;
  if (variant < 0.55) {
    parts = [
      [0, 0.7, 0.27],
      [-0.2, 0.6, 0.2],
      [0.21, 0.6, 0.2],
      [-0.1, 0.86, 0.19],
      [0.12, 0.84, 0.18],
      [0.0, 0.52, 0.17],
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
  const sc = (q: [number, number, number], dx: number, dy: number, k: number): [number, number, number] => [
    x + lean + (q[0] + dx) * h,
    (q[1] + dy) * h,
    q[2] * h * k,
  ];
  blobs(c, parts.map((q) => sc(q, 0.025, -0.035, 1.04)), T.leafDark);
  blobs(c, parts.map((q) => sc(q, -0.005, 0.005, 0.94)), T.leaf);
  blobs(c, parts.map((q) => sc(q, -q[2] * 0.3, q[2] * 0.32, 0.5)), rgba(T.leafLight, 0.92));
  // мелкие «листочки» на освещённой стороне
  c.fillStyle = rgba(T.leafLight, 0.9);
  c.beginPath();
  for (let i = 0; i < 9; i++) {
    const q = parts[Math.floor(r() * parts.length)];
    const a = lerp(Math.PI * 0.45, Math.PI * 1.05, r());
    const d = q[2] * lerp(0.55, 0.85, r());
    const px = x + lean + q[0] * h + Math.cos(a) * d * h;
    const py = q[1] * h + Math.sin(a) * d * h;
    const rr = h * lerp(0.018, 0.03, r());
    c.moveTo(px + rr, py);
    c.arc(px, py, rr, 0, TAU);
  }
  c.fill();
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
  c.strokeStyle = T.trunkDark;
  c.lineWidth = h * 0.012;
  c.beginPath();
  for (let i = 1; i < N; i++) {
    c.moveTo(left[i][0], left[i][1]);
    c.lineTo(right[i][0], right[i][1] - h * 0.012);
  }
  c.stroke();
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

/** Вал под деревьями: кусты / дюны / сугробы. */
function buildBerm(c: Ctx2D, L: StripLayer, P: Palette, r: () => number): void {
  const T = P.trees;
  const Pm = L.period;
  const kind = T.kind;
  // основа вала — периодическая волна
  const wave = (x: number): number =>
    0.38 + 0.2 * Math.sin((TAU * 7 * x) / Pm) + 0.12 * Math.sin((TAU * 17 * x) / Pm + 2) + 0.06 * Math.sin((TAU * 41 * x) / Pm);
  const pts = sample(Pm, 6, wave);
  const g = c.createLinearGradient(0, 1.0, 0, -L.depth);
  g.addColorStop(0, kind === 'round' ? T.bermLight : T.berm);
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
      for (const dx of [0, Pm, -Pm]) {
        if (x + dx < -2 || x + dx > Pm + 2) continue;
        bush(c, x + dx, wave(x) - 0.25, s, { dark: T.bermDark, base: T.berm, light: T.bermLight }, rand(seed), T.flowers);
      }
    }
  } else if (kind === 'palm') {
    // тропические кусты на песчаном валу
    for (let i = 0; i < Math.round(n * 0.6); i++) {
      const x = r() * Pm;
      const s = lerp(0.3, 0.55, r());
      const seed = Math.floor(r() * 1e6);
      for (const dx of [0, Pm, -Pm]) {
        if (x + dx < -2 || x + dx > Pm + 2) continue;
        bush(c, x + dx, wave(x) - 0.3, s, { dark: T.bermDark, base: T.leafDark, light: T.leaf }, rand(seed), T.flowers);
      }
    }
    c.save();
    silhouette(c, pts, -L.depth);
    c.clip();
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1] - 0.05) : c.moveTo(p[0], p[1] - 0.05)));
    c.lineWidth = 0.12;
    c.strokeStyle = rgba(T.bermLight, 0.9);
    c.stroke();
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
}

function buildTrees(c: Ctx2D, L: StripLayer, P: Palette): string {
  const T = P.trees;
  const Pm = L.period;
  const r = rand(L.seed);
  const n = Math.round(Pm / (T.kind === 'palm' ? 4.2 : 3.0));
  const items: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) items.push([((i + r() * 0.75) * Pm) / n, lerp(2.5, 4.6, r()), Math.floor(r() * 1e6)]);
  // дальний ряд (меньше и светлее) — для глубины
  const back: Array<[number, number, number]> = [];
  if (T.kind !== 'palm') for (let i = 0; i < n; i++) back.push([((i + 0.5 + r() * 0.5) * Pm) / n, lerp(1.6, 2.6, r()), Math.floor(r() * 1e6)]);
  const draw = (x: number, h: number, seed: number): void => {
    const rr = rand(seed);
    for (const dx of [0, -Pm, Pm]) {
      if (x + dx < -3 || x + dx > Pm + 3) continue;
      if (T.kind === 'round') roundTree(c, x + dx, h, T, rr);
      else if (T.kind === 'pine') pineTree(c, x + dx, h * 1.2, T, rr);
      else palmTree(c, x + dx, h * 1.3, T, rr);
    }
  };
  if (back.length) {
    const fogT: TreePal = {
      ...T,
      leaf: mix(T.leaf, P.fog, 0.3),
      leafDark: mix(T.leafDark, P.fog, 0.3),
      leafLight: mix(T.leafLight, P.fog, 0.3),
      trunk: mix(T.trunk, P.fog, 0.3),
      trunkDark: mix(T.trunkDark, P.fog, 0.3),
      snowShade: T.snowShade ? mix(T.snowShade, P.fog, 0.3) : undefined,
    };
    for (const [x, h, seed] of back) {
      const rr = rand(seed);
      for (const dx of [0, -Pm, Pm]) {
        if (x + dx < -3 || x + dx > Pm + 3) continue;
        if (T.kind === 'round') roundTree(c, x + dx, h, fogT, rr);
        else pineTree(c, x + dx, h * 1.2, fogT, rr);
      }
    }
  }
  for (const [x, h, seed] of items) draw(x, h, seed);
  buildBerm(c, L, P, r);
  const bottom = P.trees.kind === 'round' ? P.trees.bermDark : mix(T.berm, T.bermDark, T.kind === 'pine' ? 0.6 : 0.15);
  return bottom;
}

/** Море (beach): градиент от горизонта, полосы волн. База слоя = линия горизонта. */
function buildSea(c: Ctx2D, L: StripLayer, P: Palette): string {
  const S = P.sea!;
  const Pm = L.period;
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
  return S.bottom;
}

/** Острова на горизонте (beach) — силуэты с пальмами, отражение в воде. */
function buildIslands(c: Ctx2D, L: StripLayer, P: Palette): null {
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
      c.fillStyle = I.palm;
      c.lineCap = 'round';
      const np = Math.max(1, Math.round(w / 3));
      for (let k = 0; k < np; k++) {
        const u = lerp(0.3, 0.7, rr());
        const i0 = Math.round(u * 60);
        const [bx, by] = pts[i0];
        const ph2 = hh * lerp(0.45, 0.7, rr());
        const lx = (rr() - 0.5) * ph2 * 0.6;
        c.lineWidth = 0.09;
        c.beginPath();
        c.moveTo(bx, by - 0.1);
        c.quadraticCurveTo(bx + lx * 0.2, by + ph2 * 0.6, bx + lx, by + ph2);
        c.stroke();
        c.lineWidth = 0.07;
        for (let f = 0; f < 6; f++) {
          const a = Math.PI * (0.05 + f / 5 * 0.9);
          const fl = ph2 * 0.38;
          c.beginPath();
          c.moveTo(bx + lx, by + ph2);
          c.quadraticCurveTo(bx + lx + Math.cos(a) * fl * 0.6, by + ph2 + Math.sin(a) * fl * 0.4 + fl * 0.15, bx + lx + Math.cos(a) * fl, by + ph2 + Math.sin(a) * fl * 0.3 - fl * 0.3);
          c.stroke();
        }
      }
    }
  }
  return null;
}

// ───────────────────────── спрайты облаков и солнца ─────────────────────────

interface CloudSprite {
  canvas: AnyCanvas;
  /** Пиксель холста = левый край плоского дна облака. */
  ox: number;
  oy: number;
  ppm: number;
}

function renderCloud(seed: number, widthM: number, ppm: number, C: Palette['cloud']): CloudSprite {
  const r = rand(seed);
  const w = widthM;
  const h = w * 0.44;
  const base = h * 0.8;
  const padX = 0.3;
  const padTop = 0.5;
  const c = createCanvas((w + padX * 2) * ppm, (h + padTop + 0.1) * ppm);
  const ctx = ctx2d(c);
  ctx.setTransform(ppm, 0, 0, ppm, padX * ppm, padTop * ppm); // метры, Y вниз, (0,0) — левый верх облака
  const parts: Array<[number, number, number]> = [];
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
    const t = lerp(0.3, 0.7, (i + r() * 0.6) / top);
    const rr = h * lerp(0.26, 0.36, r());
    parts.push([w * t, base - h * 0.55 - rr * 0.15, rr]);
  }
  const body = new Path2D();
  for (const [x, y, rr] of parts) {
    body.moveTo(x + rr, y);
    body.arc(x, y, rr, 0, TAU);
  }
  body.rect(w * 0.1, base - h * 0.25, w * 0.8, h * 0.25);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-padX, -padTop, w + padX * 2, base + padTop); // плоское дно
  ctx.clip();
  const g = ctx.createLinearGradient(0, base - h, 0, base);
  g.addColorStop(0, C.top);
  g.addColorStop(0.5, C.top);
  g.addColorStop(1, C.bottom);
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.clip(body);
  // подбрюшье: тени снизу-справа от каждого «клуба»
  ctx.fillStyle = rgba(C.shade, 0.42);
  for (const [x, y, rr] of parts) {
    ctx.beginPath();
    ctx.arc(x + rr * 0.22, y + rr * 0.5, rr * 0.82, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = rgba(C.bottom, 0.5);
  ctx.fillRect(-padX, base - h * 0.12, w + padX * 2, h * 0.12);
  // блики сверху-слева
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  for (const [x, y, rr] of parts) {
    ctx.beginPath();
    ctx.arc(x - rr * 0.28, y - rr * 0.34, rr * 0.48, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  return { canvas: c, ox: padX * ppm, oy: (padTop + base) * ppm, ppm };
}

function renderGlow(color: string, a: number): AnyCanvas {
  const S = 256;
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

let probe: CanvasRenderingContext2D | null = null;

/** Средний цвет пикселя полосы (низ) — точная заливка «под слоем». */
function sampleColor(src: AnyCanvas, x: number, y: number): string | null {
  if (!probe) {
    const pc = createCanvas(1, 1);
    probe = pc.getContext('2d', { willReadFrequently: true });
  }
  if (!probe) return null;
  probe.clearRect(0, 0, 1, 1);
  probe.drawImage(src, x, y, 1, 1, 0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  if (d[3] < 250) return null;
  return `rgb(${d[0]},${d[1]},${d[2]})`;
}

/**
 * Параллакс-фон темы. draw() рисует небо и все фоновые слои на весь экран (в экранных координатах);
 * полосы строятся лениво и кэшируются по ступеням масштаба, не чаще одной перестройки за кадр.
 */
export class Background {
  readonly theme: ThemeId;
  private readonly P: Palette;
  private readonly cloudsFar: CloudLayer;
  private readonly cloudsNear: CloudLayer;
  private readonly back: StripLayer[] = [];
  private readonly sea: StripLayer | null = null;
  private readonly islands: StripLayer | null = null;
  private readonly mid: StripLayer[] = [];
  private readonly states = new Map<string, LayerState>();
  private readonly cloudCache = new Map<string, CloudSprite>();
  private readonly glow: AnyCanvas;
  private buildsLeft = 1;
  private skyGrad: { g: CanvasGradient; key: string } | null = null;

  constructor(theme: ThemeId) {
    this.theme = theme;
    const P = PAL[theme];
    this.P = P;
    this.glow = renderGlow(P.sun.glow, P.sun.glowA);
    this.cloudsFar = { id: 'cloudsFar', f: 0.05, period: 70, baseY: 1.0, drift: 0.25, res: 0.75, items: makeClouds(3, 7, 70, 3, 6, 1.6, 4.6) };
    this.cloudsNear = { id: 'cloudsNear', f: 0.18, period: 90, baseY: 3.0, drift: 0.5, res: 0.75, items: makeClouds(5, 4, 90, 4.5, 7.5, 0.6, 2.6) };
    if (theme === 'beach') {
      this.sea = { id: 'sea', f: 0.1, period: 40, baseY: -0.6, height: 0, depth: 9, res: 0.5, seed: 7, build: buildSea };
      this.islands = { id: 'islands', f: 0.1, period: 70, baseY: -0.6, height: 3.6, depth: 0.4, res: 0.6, seed: 13, build: buildIslands };
    } else {
      this.back.push({ id: 'mountains', f: 0.12, period: 64, baseY: -1.0, height: 8.5, depth: 1.5, res: 0.5, seed: 11, build: buildMountains });
    }
    if (theme === 'meadow') {
      const H = P.hillsFar!;
      this.mid.push({
        id: 'hillsFar',
        f: 0.25,
        period: 44,
        baseY: -1.5,
        height: 4.6,
        depth: 1.5,
        res: 0.6,
        seed: 21,
        build: (c, L, Pp) =>
          buildHills(
            c,
            L,
            Pp,
            H,
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
            0.3,
          ),
      });
    } else if (theme === 'snow') {
      this.mid.push({ id: 'rangeFar', f: 0.25, period: 48, baseY: -1.5, height: 5.0, depth: 1.5, res: 0.6, seed: 21, build: buildRangeFar });
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
    this.mid.push({
      id: 'hillsNear',
      f: 0.4,
      period: 36,
      baseY: -2.0,
      height: 4.0,
      depth: 1.5,
      res: 0.75,
      seed: theme === 'beach' ? 33 : 31,
      build: (c, L, Pp) =>
        buildHills(
          c,
          L,
          Pp,
          N,
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
          0.12,
        ),
    });
    this.mid.push({ id: 'trees', f: 0.62, period: 30, baseY: -1.6, height: 8.5, depth: 1.5, res: 0.85, seed: 41, build: buildTrees, haze: 0.16 });
  }

  /** Построить все полосы для данного вида заранее (экран загрузки). */
  prewarm(view: ViewInfo): void {
    const sRef = view.screenH / AIM_VIEW_H;
    for (const L of this.allStrips()) this.ensureStrip(L, layerScale(view, sRef, L.f) * L.res, view, true);
  }

  private allStrips(): StripLayer[] {
    const out = [...this.back];
    if (this.sea) out.push(this.sea);
    if (this.islands) out.push(this.islands);
    return out.concat(this.mid);
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    const W = view.screenW;
    const H = view.screenH;
    if (W <= 0 || H <= 0 || view.scale <= 0) return;
    this.buildsLeft = 1;
    const sRef = H / AIM_VIEW_H;
    const P = this.P;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    // линия горизонта: база гор (или горизонт моря)
    const hz = this.sea ?? this.back[0];
    const sH = layerScale(view, sRef, hz.f);
    const horizonY = H / 2 - (hz.baseY - view.camY * hz.f) * sH;

    this.drawSky(ctx, view, horizonY);
    this.drawSun(ctx, view, sRef, horizonY);
    this.drawClouds(ctx, view, sRef, this.cloudsFar);
    for (const L of this.back) this.drawStrip(ctx, view, sRef, L);
    if (this.sea) {
      this.drawStrip(ctx, view, sRef, this.sea);
      this.drawSeaGlitter(ctx, view, sRef, horizonY);
    }
    if (this.islands) this.drawStrip(ctx, view, sRef, this.islands);
    this.drawClouds(ctx, view, sRef, this.cloudsNear);
    for (const L of this.mid) this.drawStrip(ctx, view, sRef, L);
    if (P.snowfall) this.drawSnowfall(ctx, view, sRef);
    ctx.restore();
  }

  // ── небо и солнце ──

  private drawSky(ctx: Ctx2D, v: ViewInfo, horizonY: number): void {
    // градиент «привязан» к горизонту: при подъёме камеры сверху открывается более густая синева
    const top = horizonY - v.screenH * 0.62;
    const key = `${Math.round(top)}:${Math.round(horizonY)}`;
    if (!this.skyGrad || this.skyGrad.key !== key) {
      const g = ctx.createLinearGradient(0, top, 0, horizonY);
      for (const [o, col] of this.P.sky) g.addColorStop(o, col);
      this.skyGrad = { g, key };
    }
    ctx.fillStyle = this.skyGrad.g;
    ctx.fillRect(0, 0, v.screenW, v.screenH);
  }

  private drawSun(ctx: Ctx2D, v: ViewInfo, sRef: number, horizonY: number): void {
    const S = this.P.sun;
    const R = S.r * v.screenH;
    const sx = S.x * v.screenW - v.camX * 0.02 * sRef;
    const sy = S.onHorizon ? horizonY - R * 0.35 : S.y * v.screenH + v.camY * 0.02 * sRef;
    const gr = R * 4.8;
    if (sy + gr > 0 && sy - gr < v.screenH) ctx.drawImage(this.glow, sx - gr, sy - gr, gr * 2, gr * 2);
    if (sy + R < 0) return;
    const core = ctx.createRadialGradient(sx - R * 0.3, sy - R * 0.3, R * 0.1, sx, sy, R);
    core.addColorStop(0, '#FFFFFF');
    core.addColorStop(1, S.core);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, TAU);
    ctx.fill();
  }

  /** Солнечная дорожка на воде (beach): мерцающие штрихи под солнцем. */
  private drawSeaGlitter(ctx: Ctx2D, v: ViewInfo, sRef: number, horizonY: number): void {
    const S = this.P.sea!;
    const sx = this.P.sun.x * v.screenW - v.camX * 0.02 * sRef;
    const R = this.P.sun.r * v.screenH;
    const bottom = Math.min(v.screenH, horizonY + v.screenH * 0.32);
    if (bottom <= horizonY) return;
    // отражённое свечение
    const gw = R * 5;
    const gh = R * 1.4;
    ctx.globalAlpha = 0.75;
    ctx.drawImage(this.glow, sx - gw, horizonY - gh * 0.3, gw * 2, gh * 2);
    ctx.globalAlpha = 1;
    const r = rand(5);
    const t = v.time;
    ctx.fillStyle = S.sparkle;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const y = horizonY + 3 * v.dpr + u * u * (bottom - horizonY);
      const w = R * (0.5 + 2.4 * u) * lerp(0.4, 1, r());
      const jx = (r() - 0.5) * R * 0.8 * u;
      const a = (0.9 - 0.55 * u) * (0.65 + 0.35 * Math.sin(2.6 * t + i * 1.9 + r() * 3));
      ctx.globalAlpha = clamp(a, 0, 1);
      const hh = (1.2 + 2.6 * u) * v.dpr;
      ctx.fillRect(sx - w / 2 + jx + Math.sin(t * 0.8 + i) * u * 3 * v.dpr, y, w, hh);
    }
    ctx.globalAlpha = 1;
  }

  // ── облака ──

  private cloudSprite(c: CloudItem, ppmWant: number): CloudSprite {
    const b = bucketOf(ppmWant);
    const key = `${c.seed}:${b}`;
    let s = this.cloudCache.get(key);
    if (!s) {
      s = renderCloud(c.seed, c.w, b, this.P.cloud);
      this.cloudCache.set(key, s);
      if (this.cloudCache.size > 48) {
        const first = this.cloudCache.keys().next().value;
        if (first !== undefined && first !== key) this.cloudCache.delete(first);
      }
    }
    return s;
  }

  private drawClouds(ctx: Ctx2D, v: ViewInfo, sRef: number, L: CloudLayer): void {
    const sL = layerScale(v, sRef, L.f);
    const periodPx = L.period * sL;
    const drift = L.drift * v.time;
    ctx.globalAlpha = this.P.cloud.alpha;
    for (const c of L.items) {
      const yb = v.screenH / 2 - (L.baseY + c.y - v.camY * L.f) * sL;
      const hPx = c.w * 0.6 * sL;
      if (yb < 0 || yb - hPx > v.screenH) continue;
      const wPx = (c.w + 0.6) * sL;
      let x = v.screenW / 2 + (c.x + drift - v.camX * L.f) * sL;
      x = ((x % periodPx) + periodPx) % periodPx;
      for (let X = x - periodPx; X < v.screenW; X += periodPx) {
        if (X + wPx < 0) continue;
        const s = this.cloudSprite(c, sL * L.res);
        const k = sL / s.ppm;
        ctx.drawImage(s.canvas, X - s.ox * k, yb - s.oy * k, s.canvas.width * k, s.canvas.height * k);
      }
    }
    ctx.globalAlpha = 1;
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
      const xx = fx * (W + 40) - v.camX * par + Math.sin(t * lerp(0.5, 1, r()) + ph) * 10 * v.dpr + t * 8 * v.dpr;
      const yy = fy * (H + 40) + t * vy + v.camY * par;
      const X = ((xx % (W + 40)) + (W + 40)) % (W + 40) - 20;
      const Y = ((yy % (H + 40)) + (H + 40)) % (H + 40) - 20;
      ctx.moveTo(X + sz, Y);
      ctx.arc(X, Y, sz, 0, TAU);
    }
    ctx.fill();
  }

  // ── полосы ──

  private stateOf(L: StripLayer): LayerState {
    let st = this.states.get(L.id);
    if (!st) {
      st = { strips: [], wantBucket: 0, wantSince: 0 };
      this.states.set(L.id, st);
    }
    return st;
  }

  /** Выбрать (или построить) полосу под нужную плотность пикселей. */
  private ensureStrip(L: StripLayer, ppmWant: number, v: ViewInfo, force = false): Strip | null {
    const st = this.stateOf(L);
    const ppmCap = STRIP_MAX_PX / L.period;
    const want = Math.min(ppmWant, ppmCap);
    let best: Strip | null = null;
    let bestErr = Infinity;
    for (const s of st.strips) {
      const q = want / s.ppm;
      const err = Math.abs(Math.log(q));
      if (err < bestErr) {
        bestErr = err;
        best = s;
      }
    }
    const q = best ? want / best.ppm : 0;
    if (best && q >= REBUILD_LO && q <= REBUILD_HI) return best;
    const b = Math.min(bucketOf(want), ppmCap);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (st.wantBucket !== b) {
      st.wantBucket = b;
      st.wantSince = now;
    }
    const stable = now - st.wantSince >= STABLE_MS;
    if (!best || force || (stable && this.buildsLeft > 0)) {
      if (best) this.buildsLeft--;
      const s = this.buildStrip(L, b);
      st.strips.push(s);
      while (st.strips.length > STRIPS_PER_LAYER) st.strips.shift();
      void v;
      return s;
    }
    return best;
  }

  private buildStrip(L: StripLayer, bucket: number): Strip {
    const totalPx = Math.max(8, Math.round(L.period * bucket));
    const ppm = totalPx / L.period;
    const hPx = Math.max(2, Math.ceil((L.height + L.depth) * ppm));
    const nTiles = Math.ceil(totalPx / TILE_MAX_PX);
    const tilePx = Math.ceil(totalPx / nTiles);
    const tiles: AnyCanvas[] = [];
    const tileX: number[] = [];
    const tileW: number[] = [];
    let fill: string | null = null;
    for (let i = 0; i < nTiles; i++) {
      const x0 = i * tilePx;
      const w = Math.min(tilePx, totalPx - x0);
      const c = createCanvas(w, hPx);
      const cx = ctx2d(c);
      cx.setTransform(ppm, 0, 0, -ppm, -x0, L.height * ppm);
      cx.lineJoin = 'round';
      const f = L.build(cx, L, this.P);
      if (L.haze) {
        cx.setTransform(1, 0, 0, 1, 0, 0);
        cx.globalCompositeOperation = 'source-atop';
        cx.fillStyle = rgba(this.P.fog, L.haze);
        cx.fillRect(0, 0, w, hPx);
        cx.globalCompositeOperation = 'source-over';
      }
      if (i === 0 && f !== null) fill = sampleColor(c, Math.floor(w / 2), hPx - 1) ?? f;
      tiles.push(c);
      tileX.push(x0 / ppm);
      tileW.push(w / ppm);
    }
    return { tiles, tileX, tileW, ppm, hPx, fill, bucket };
  }

  private drawStrip(ctx: Ctx2D, v: ViewInfo, sRef: number, L: StripLayer): void {
    const W = v.screenW;
    const H = v.screenH;
    const sL = layerScale(v, sRef, L.f);
    const yBase = H / 2 - (L.baseY - v.camY * L.f) * sL;
    const yTop = yBase - L.height * sL;
    const hDraw = (L.height + L.depth) * sL;
    if (yTop >= H) return; // слой целиком ниже экрана
    const s = this.ensureStrip(L, sL * L.res, v);
    if (!s) return;
    const periodPx = L.period * sL;
    if (yTop + hDraw > 0) {
      let x0 = W / 2 - v.camX * L.f * sL;
      x0 = ((x0 % periodPx) + periodPx) % periodPx - periodPx;
      for (let px = x0; px < W; px += periodPx) {
        for (let i = 0; i < s.tiles.length; i++) {
          const tx = px + s.tileX[i] * sL;
          const tw = s.tileW[i] * sL;
          if (tx > W || tx + tw < 0) continue;
          // целые границы тайлов — без щелей и наложений между копиями
          const xl = Math.round(tx);
          const xr = Math.round(tx + tw);
          ctx.drawImage(s.tiles[i], xl, yTop, xr - xl, hDraw);
        }
      }
    }
    if (s.fill) {
      const yb = Math.max(0, Math.floor(yTop + hDraw - 1));
      if (yb < H) {
        ctx.fillStyle = s.fill;
        ctx.fillRect(0, yb, W, H - yb);
      }
    }
  }
}

// ───────────────────────── передний план ─────────────────────────

/**
 * Передний план: пучки травы с цветами (meadow), пляжная трава (beach), сугробы (snow) у нижнего края.
 * Y — мировая (база на 0.55 м ниже земли), X — параллакс 1.2, лёгкое покачивание от ветра.
 * Над уровнем земли выступает не больше ~0.3 м (≈2–3 % высоты кадра в виде рогатки).
 */
export function drawForeground(ctx: CanvasRenderingContext2D, theme: ThemeId, view: ViewInfo): void {
  const P = PAL[theme];
  const s0 = view.scale * 1.08;
  if (s0 <= 0) return;
  const f = 1.2;
  const yb = view.screenH / 2 - (-0.55 - view.camY) * view.scale;
  if (yb - 0.9 * s0 > view.screenH) return;
  const Pm = 18;
  const periodPx = Pm * s0;
  let x0 = view.screenW / 2 - view.camX * f * s0;
  x0 = ((x0 % periodPx) + periodPx) % periodPx - periodPx;
  const t = view.time;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const pathA = new Path2D();
  const pathB = new Path2D();
  const pathC = new Path2D();
  const mound = new Path2D();
  const flowers: Array<[number, number, number, string]> = [];
  for (let px = x0; px < view.screenW + periodPx; px += periodPx) {
    const r = rand(8 + theme.length);
    for (let i = 0; i < 9; i++) {
      const cx = px + ((i + r() * 0.7) / 9) * periodPx;
      const s = s0 * lerp(0.75, 1.05, r());
      const kind = r();
      const flower = r();
      const fcol = P.fg.accent.length ? P.fg.accent[Math.floor(r() * P.fg.accent.length)] : '';
      const nb = 6 + Math.floor(r() * 4);
      const hs: number[] = [];
      for (let j = 0; j < nb; j++) hs.push(r());
      if (cx < -s * 1.5 || cx > view.screenW + s * 1.5) continue;
      if (theme === 'snow') {
        // сугроб: тень + тело + блик
        const w = s * lerp(0.8, 1.15, kind);
        mound.moveTo(cx + w + 0.06 * s, yb + 0.12 * s);
        mound.ellipse(cx + 0.06 * s, yb + 0.12 * s, w, 0.46 * s, 0, 0, TAU);
        pathA.moveTo(cx + w * 0.95, yb + 0.14 * s);
        pathA.ellipse(cx, yb + 0.14 * s, w * 0.95, 0.42 * s, 0, 0, TAU);
        pathC.moveTo(cx - w * 0.2 + w * 0.45, yb - 0.12 * s);
        pathC.ellipse(cx - w * 0.2, yb - 0.12 * s, w * 0.45, 0.12 * s, 0, 0, TAU);
        continue;
      }
      // кочка под пучком — пучок «растёт» из неё
      mound.moveTo(cx + 0.42 * s, yb + 0.12 * s);
      mound.ellipse(cx, yb + 0.12 * s, 0.42 * s, 0.2 * s, 0, 0, TAU);
      const sway = Math.sin(1.3 * t + cx * 0.013) * 0.06;
      for (let j = 0; j < nb; j++) {
        const u = j / (nb - 1) - 0.5;
        const h = s * lerp(0.35, theme === 'beach' ? 0.85 : 0.72, hs[j]) * (1 - Math.abs(u) * 0.6);
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
    ctx.fillStyle = P.fg.b;
    ctx.fill(mound);
    ctx.fillStyle = P.fg.a;
    ctx.fill(pathA);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill(pathC);
  } else {
    ctx.fillStyle = P.fg.a;
    ctx.fill(mound);
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
