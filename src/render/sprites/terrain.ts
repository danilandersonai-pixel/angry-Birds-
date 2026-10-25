// Рельеф уровня в мировых координатах: грунт с кромкой (трава / песок / снег), скалы, помосты.
// Геометрия (Path2D: контур, кромка, фестоны, травинки, снежные шапки) строится ОДИН раз на TerrainDef и тему;
// кромка нарезана на куски ≈ 6 м вдоль цепочки верхних рёбер — каждый кадр рисуются только видимые куски.
// Текстуры — бесшовные тайлы, привязанные к миру (createPattern + setTransform в метрах).
// При неподвижном зуме рельеф рисуется из кэша пиксельно выровненных тайлов 256×256 (blit 1:1),
// пока зум меняется — векторно. Здесь же — общие цветовые и шумовые хелперы фона (background.ts импортирует их).

import type { TerrainDef, ThemeId } from '../../core/types';
import { Rng } from '../../core/rng';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { ViewInfo } from '../view';

// ───────────────────────── общие хелперы ─────────────────────────

export const TAU = Math.PI * 2;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Детерминированный ГПСЧ (одинаковый декор при каждой генерации). */
export function rand(seed: number): () => number {
  const r = new Rng(seed);
  return () => r.next();
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** hex → rgba(...). */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}

/** Смешать два hex-цвета (t = 0 → a, 1 → b), результат — hex. */
export function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);
  let s = '#';
  for (let i = 0; i < 3; i++) s += Math.round(lerp(A[i], B[i], t)).toString(16).padStart(2, '0');
  return s;
}

/** Периодический value noise (бесшовный по периоду решётки). */
function valueNoise(seed: number, period: number): (x: number, y: number) => number {
  const r = rand(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const u = smooth(x - xi);
    const v = smooth(y - yi);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0];
    const b = g[y0 * period + x1];
    const c = g[y1 * period + x0];
    const d = g[y1 * period + x1];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

/** Бесшовный fBm-тайл size×size; fn(v) → [r, g, b, a]. */
export function noiseTile(
  size: number,
  seed: number,
  cells: number,
  octaves: number,
  fn: (v: number, x: number, y: number) => readonly [number, number, number, number],
): AnyCanvas {
  const c = createCanvas(size, size);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(size, size);
  const ns: Array<(x: number, y: number) => number> = [];
  for (let o = 0; o < octaves; o++) ns.push(valueNoise(seed + o * 101, cells << o));
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
      const p = fn(v / norm, x, y);
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

// ───────────────────────── палитры рельефа ─────────────────────────

export interface GroundPalette {
  edge: 'grass' | 'sand' | 'snow';
  top: string;
  light: string;
  dark: string;
  lip: string;
  soil: string;
  soilDark: string;
  soilDeep: string;
  pebble: string;
  pebbleDark: string;
  outline: string;
}

export interface RockPalette {
  light: string;
  fill: string;
  dark: string;
  outline: string;
  /** Шапка по верхним рёбрам: мох (трава) или снег. */
  cap: 'moss' | 'snow' | null;
}

export interface DeckPalette {
  light: string;
  base: string;
  dark: string;
  seam: string;
  outline: string;
  metal: string;
  metalLight: string;
  metalDark: string;
}

export interface TerrainPalette {
  ground: GroundPalette;
  rock: RockPalette;
  deck: DeckPalette;
  moss: { top: string; dark: string; light: string };
}

export const TERRAIN_PALETTES: Record<ThemeId, TerrainPalette> = {
  meadow: {
    ground: {
      edge: 'grass',
      top: '#7CC83E',
      light: '#B6E862',
      dark: '#4F9B2B',
      lip: '#36761F',
      soil: '#8E5C34',
      soilDark: '#6C4325',
      soilDeep: '#3E2410',
      pebble: '#B48A5C',
      pebbleDark: '#5A391D',
      outline: '#2D4515',
    },
    rock: { light: '#BDB9B0', fill: '#8E8A84', dark: '#605C57', outline: '#34312D', cap: 'moss' },
    deck: {
      light: '#C08A55',
      base: '#94603A',
      dark: '#6A4224',
      seam: '#4A2C14',
      outline: '#2E1A0B',
      metal: '#646C76',
      metalLight: '#A9B2BC',
      metalDark: '#30353C',
    },
    moss: { top: '#7CC83E', dark: '#4F9B2B', light: '#B6E862' },
  },
  beach: {
    ground: {
      edge: 'sand',
      top: '#F7D896',
      light: '#FFF0C8',
      dark: '#DDAA62',
      lip: '#C08646',
      soil: '#E2B06A',
      soilDark: '#C8904E',
      soilDeep: '#8E5A2A',
      pebble: '#FFF2DA',
      pebbleDark: '#B5835A',
      outline: '#73441C',
    },
    rock: { light: '#C99A86', fill: '#9A6E64', dark: '#6A4646', outline: '#3A2224', cap: null },
    deck: {
      light: '#C9A27A',
      base: '#9C7550',
      dark: '#6E4E34',
      seam: '#4E3420',
      outline: '#33200F',
      metal: '#6E6A66',
      metalLight: '#B4ADA4',
      metalDark: '#363230',
    },
    moss: { top: '#8DB84A', dark: '#5E8A30', light: '#C2E07A' },
  },
  snow: {
    ground: {
      edge: 'snow',
      top: '#F7FBFF',
      light: '#FFFFFF',
      dark: '#C9DAEE',
      lip: '#A9C0DC',
      soil: '#7A87A2',
      soilDark: '#5F6A85',
      soilDeep: '#353C52',
      pebble: '#AAB6CC',
      pebbleDark: '#3E465B',
      outline: '#2A3247',
    },
    rock: { light: '#B3C0D4', fill: '#7E8BA4', dark: '#566079', outline: '#262D40', cap: 'snow' },
    deck: {
      light: '#A88468',
      base: '#7E5E46',
      dark: '#563E2E',
      seam: '#3A281C',
      outline: '#24170E',
      metal: '#66707E',
      metalLight: '#B0BCCB',
      metalDark: '#2E3440',
    },
    moss: { top: '#F7FBFF', dark: '#C9DAEE', light: '#FFFFFF' },
  },
};

// ───────────────────────── текстуры ─────────────────────────

/** Тайл грунта: SOIL_PX пикселей = SOIL_M метров. */
const SOIL_PX = 512;
const SOIL_M = 4;
const ROCK_PX = 256;
const ROCK_M = 2;

const tileCache = new Map<string, AnyCanvas>();

/** Бесшовный тайл грунта темы: шум, слои, камушки / ракушки. */
function soilTile(theme: ThemeId): AnyCanvas {
  const key = `soil:${theme}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const G = TERRAIN_PALETTES[theme].ground;
  const S = SOIL_PX;
  const ppm = S / SOIL_M;
  const a = hexRgb(G.soil);
  const b = hexRgb(G.soilDark);
  const deep = hexRgb(G.soilDeep);
  const c = noiseTile(S, 17 + theme.length, 8, 3, (v, _x, y) => {
    const t = clamp((v - 0.36) * 2.3, 0, 1);
    // слой (страта) — тёмная волнистая полоса на глубине ~2.4 м тайла
    const yy = y / ppm;
    const band = Math.exp(-(((yy - 2.45) / 0.22) ** 2)) * 0.32 + Math.exp(-(((yy - 0.95) / 0.1) ** 2)) * 0.12;
    const r0 = lerp(a[0], b[0], t);
    const g0 = lerp(a[1], b[1], t);
    const b0 = lerp(a[2], b[2], t);
    return [lerp(r0, deep[0], band), lerp(g0, deep[1], band), lerp(b0, deep[2], band), 255];
  });
  const ctx = ctx2d(c);
  const r = rand(23 + theme.length * 7);
  // мелкие крапинки (фактура)
  for (let i = 0; i < 520; i++) {
    const x = r() * S;
    const y = r() * S;
    const rr = lerp(0.8, 2.2, r());
    ctx.fillStyle = r() < 0.5 ? rgba(G.soilDeep, 0.35) : rgba(G.pebble, 0.35);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.fill();
  }
  // камушки / ракушки с переносом через края тайла (бесшовно)
  const count = theme === 'beach' ? 34 : 28;
  for (let i = 0; i < count; i++) {
    const x = r() * S;
    const y = r() * S;
    const rx = lerp(0.06, 0.17, r()) * ppm;
    const ry = rx * lerp(0.55, 0.8, r());
    const ang = r() * Math.PI;
    const shell = theme === 'beach' && r() < 0.45;
    for (const dx of [0, -S, S]) {
      for (const dy of [0, -S, S]) {
        if (x + dx + rx * 1.5 < 0 || x + dx - rx * 1.5 > S || y + dy + rx * 1.5 < 0 || y + dy - rx * 1.5 > S) continue;
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(ang);
        if (shell) drawShell(ctx, rx * 0.9, G);
        else drawPebble(ctx, rx, ry, G);
        ctx.restore();
      }
    }
  }
  tileCache.set(key, c);
  return c;
}

function drawPebble(ctx: Ctx2D, rx: number, ry: number, G: GroundPalette): void {
  ctx.fillStyle = G.pebbleDark;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + 1.6, ry + 1.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = G.pebble;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(G.pebbleDark, 0.3);
  ctx.beginPath();
  ctx.ellipse(rx * 0.18, ry * 0.25, rx * 0.75, ry * 0.65, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.ellipse(-rx * 0.3, -ry * 0.35, rx * 0.4, ry * 0.3, 0, 0, TAU);
  ctx.fill();
}

/** Ракушка-веер (пляж). */
function drawShell(ctx: Ctx2D, r: number, G: GroundPalette): void {
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, r * 0.55);
  ctx.arc(0, r * 0.55, r, Math.PI * 1.12, Math.PI * 1.88);
  ctx.closePath();
  ctx.fillStyle = G.pebble;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = G.pebbleDark;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(G.pebbleDark, 0.7);
  for (let k = 1; k < 5; k++) {
    const a = Math.PI * (1.12 + (0.76 * k) / 5);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.55);
    ctx.lineTo(Math.cos(a) * r * 0.92, r * 0.55 + Math.sin(a) * r * 0.92);
    ctx.stroke();
  }
}

/** Тайл фактуры камня: светлые и тёмные пятна (накладывается поверх градиента). */
function rockTile(): AnyCanvas {
  const hit = tileCache.get('rock');
  if (hit) return hit;
  const c = noiseTile(ROCK_PX, 41, 6, 4, (v) => {
    const t = clamp((v - 0.5) * 2.6, -1, 1);
    return t > 0 ? [255, 255, 255, Math.round(t * 0.22 * 255)] : [20, 24, 30, Math.round(-t * 0.3 * 255)];
  });
  const ctx = ctx2d(c);
  const r = rand(77);
  for (let i = 0; i < 160; i++) {
    const x = r() * ROCK_PX;
    const y = r() * ROCK_PX;
    ctx.fillStyle = r() < 0.5 ? 'rgba(20,24,30,0.32)' : 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(x, y, lerp(0.8, 2.4, r()), 0, TAU);
    ctx.fill();
  }
  tileCache.set('rock', c);
  return c;
}

/** Паттерны кэшируются на контекст (паттерн привязан к создавшему его контексту). */
const patternCache = new WeakMap<Ctx2D, Map<string, CanvasPattern>>();

function worldPattern(ctx: Ctx2D, key: string, tile: AnyCanvas, metres: number): CanvasPattern | null {
  let m = patternCache.get(ctx);
  if (!m) {
    m = new Map();
    patternCache.set(ctx, m);
  }
  let p = m.get(key);
  if (!p) {
    p = ctx.createPattern(tile, 'repeat') ?? undefined;
    if (!p) return null;
    // тайл в метрах мира, ось Y мира вверх — флип; паттерн «прилипает» к миру при панораме
    p.setTransform(new DOMMatrix().scale(metres / tile.width, -metres / tile.height));
    m.set(key, p);
  }
  return p;
}

// ───────────────────────── геометрия ─────────────────────────

type P2 = [number, number];

/** Цепочка подряд идущих верхних рёбер. en[i] — внешняя нормаль ребра pts[i]→pts[i+1]. */
interface Chain {
  pts: P2[];
  en: P2[];
}

/** Кусок кромки (≈ PIECE_M м вдоль цепочки) — каждый кадр рисуются только куски, попавшие в вид. */
interface Piece {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Цепочка верхних рёбер (с нахлёстом PIECE_OV на соседей). */
  chain: Path2D;
  /** Тело кромки: от поверхности (с запасом наружу) до фестончатого нижнего края. */
  band: Path2D;
  highlight: Path2D;
  /** Травинки (два прохода) или снежная шапка. */
  bladesBack: Path2D | null;
  bladesFront: Path2D | null;
  capFill: Path2D | null;
  capLine: Path2D | null;
}

/** Объединение видимых кусков (кэшируется, пока набор кусков не меняется). */
interface Vis {
  key: string;
  chain: Path2D;
  /** Тело кромки: от поверхности (с запасом наружу) до фестончатого нижнего края. */
  band: Path2D;
  highlight: Path2D;
  bladesBack: Path2D | null;
  bladesFront: Path2D | null;
  capFill: Path2D | null;
  capLine: Path2D | null;
}

interface Geo {
  path: Path2D;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  chains: Chain[];
  /** Самая низкая верхняя поверхность — от неё считается затемнение грунта вглубь. */
  surfaceY: number;
  /** Отдельные рёбра по сторонам (для теней скал). */
  shadeEdges: Path2D;
  edgeT: number;
  pieces: Piece[];
  vis: Vis | null;
  cracks: Path2D | null;
  /** Помост: швы, стыки, скобы. */
  deck: DeckGeo | null;
}

interface DeckGeo {
  wood: boolean;
  seams: Path2D;
  seamsLight: Path2D;
  grain: Path2D;
  straps: Array<[number, number, number, number]>;
  rivets: P2[];
  bricks: Array<[number, number, number, number, number]>;
}

function polyArea(pts: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function topChains(pts: ReadonlyArray<readonly [number, number]>, minNy: number): Chain[] {
  const n = pts.length;
  if (n < 3) return [];
  const ccw = polyArea(pts) > 0;
  const nrm: P2[] = [];
  const top: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      nrm.push([0, 0]);
      top.push(false);
      continue;
    }
    let nx = dy / len;
    let ny = -dx / len;
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
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
      if (!cur) cur = { pts: [[pts[i][0], pts[i][1]]], en: [] };
      const b = pts[(i + 1) % n];
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
function vertexNormal(ch: Chain, j: number): [number, number, number] {
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
function offsetChain(ch: Chain, d: number): P2[] {
  const out: P2[] = [];
  for (let j = 0; j < ch.pts.length; j++) {
    const [nx, ny, m] = vertexNormal(ch, j);
    out.push([ch.pts[j][0] - nx * d * m, ch.pts[j][1] - ny * d * m]);
  }
  return out;
}

/** Обход цепочки по длине дуги с шагом step(): колбэк (x, y, nx, ny, tx, ty). */
function walkChain(
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
function chainCum(ch: Chain): number[] {
  const cum = [0];
  for (let i = 0; i < ch.en.length; i++) cum.push(cum[i] + Math.hypot(ch.pts[i + 1][0] - ch.pts[i][0], ch.pts[i + 1][1] - ch.pts[i][1]));
  return cum;
}

/** Часть цепочки по длине дуги [s0, s1] (концы — на рёбрах, нормали рёбер сохраняются). */
function subChain(ch: Chain, cum: number[], s0: number, s1: number): Chain {
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

/** Границы кусков по длине дуги; разрезы отодвинуты от вершин (там сдвинутые линии кусков расходились бы). */
function pieceCuts(cum: number[], total: number): number[] {
  const n = Math.max(1, Math.round(total / PIECE_M));
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

/** Внешний (бугристый) контур снежной шапки вдоль цепочки; s0 — длина дуги начала куска в исходной цепочке. */
function capOutline(ch: Chain, s0: number, bumpH: (s: number) => number): P2[] {
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
    const n = Math.max(1, Math.ceil(len / 0.04));
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
function bandLower(ch: Chain, cum: number[], s0: number, s1: number, depth: (s: number) => number): P2[] {
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

function polyPath(pts: ReadonlyArray<readonly [number, number]>, close: boolean, into?: Path2D): Path2D {
  const p = into ?? new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
  if (close) p.closePath();
  return p;
}

/** Толщина кромки по типу. */
function edgeThickness(edge: GroundPalette['edge']): number {
  return edge === 'snow' ? 0.4 : edge === 'sand' ? 0.3 : 0.34;
}

/** Длина куска кромки вдоль цепочки, м, и нахлёст линий между соседними кусками. */
const PIECE_M = 6;
const PIECE_OV = 0.05;
/** Запас габарита куска: травинки/шапка наружу, кромка и «гребешки» внутрь. */
const PIECE_PAD = 0.8;

const geoCache = new WeakMap<TerrainDef, Map<ThemeId, Geo>>();

/** Отладка: колбэк после каждой фазы отрисовки грунта (замер растеризации в предпросмотре). */
export const TERRAIN_PROBE: { phase: ((label: string) => void) | null } = { phase: null };

function getGeo(t: TerrainDef, theme: ThemeId): Geo {
  let m = geoCache.get(t);
  if (!m) {
    m = new Map();
    geoCache.set(t, m);
  }
  let g = m.get(theme);
  if (!g) {
    g = buildGeo(t, theme);
    m.set(theme, g);
  }
  return g;
}

function buildGeo(t: TerrainDef, theme: ThemeId): Geo {
  const pts = t.points;
  const P = TERRAIN_PALETTES[theme];
  const path = polyPath(pts, true);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const seed = Math.round(minX * 131 + minY * 71 + maxX * 17 + pts.length * 7) | 0;
  const r = rand(seed ^ 0x5bd1e995);
  const chains = topChains(pts, 0.45);
  let surfaceY = maxY;
  for (const ch of chains) for (const p of ch.pts) surfaceY = Math.min(surfaceY, p[1]);
  if (!chains.length) surfaceY = maxY;

  // кромка зависит от вида рельефа
  const kind = t.kind;
  const edgeKind: GroundPalette['edge'] | 'moss' | 'none' =
    kind === 'ground'
      ? P.ground.edge
      : kind === 'rock'
        ? P.rock.cap ?? 'none'
        : theme === 'snow'
          ? 'snow'
          : maxY - minY > 1.2 && P.rock.cap === 'moss'
            ? 'moss'
            : 'none';
  const T = kind === 'ground' ? edgeThickness(P.ground.edge) : edgeKind === 'snow' ? 0.26 : edgeKind === 'moss' ? 0.14 : 0;
  const blades = edgeKind === 'grass' || edgeKind === 'moss';
  const bladeSc = edgeKind === 'moss' ? 0.6 : 1;
  const capSc = kind === 'ground' ? 1 : 0.8;

  // кромка режется на куски вдоль цепочек: каждый кадр рисуются только видимые
  const pieces: Piece[] = [];
  for (const ch of chains) {
    const cum = chainCum(ch);
    const total = cum[cum.length - 1];
    if (total < 1e-6) continue;
    // бугры снежной шапки — на всю цепочку сразу (непрерывны через границы кусков)
    const bumps: Array<[number, number, number]> = [];
    if (edgeKind === 'snow') {
      for (let s = lerp(0.1, 0.3, r()); s < total - 0.05; s += lerp(0.32, 0.62, r())) {
        bumps.push([s, lerp(0.12, 0.22, r()) * capSc, lerp(0.45, 0.7, r())]);
      }
    }
    const bumpH = (s: number): number => {
      let h = 0;
      for (const [c, rad, k] of bumps) {
        const u = (s - c) / rad;
        if (u > -1 && u < 1) h = Math.max(h, rad * k * Math.sqrt(1 - u * u));
      }
      // к концам цепочки шапка сходит на нет
      return h * smooth(clamp(Math.min(s, total - s) / 0.25, 0, 1)) + 0.012;
    };
    // фестоны нижнего края кромки: круги (s, r) вдоль всей цепочки; глубина края — их огибающая
    const scal: Array<[number, number]> = [];
    if (T > 0) {
      let q = 0;
      for (let s = 0.05; s < total; s += lerp(0.17, 0.26, r())) scal.push([s, (q++ % 2 ? 0.085 : 0.115) * (T / 0.34) * lerp(0.85, 1.15, r())]);
    }
    let j0 = 0;
    const depthAt = (u: number): number => {
      // u растёт внутри куска; между кусками — сброс указателя назад
      while (j0 > 0 && scal[j0 - 1][0] > u - 0.2) j0--;
      while (j0 < scal.length && scal[j0][0] < u - 0.2) j0++;
      let d = T;
      for (let j = j0; j < scal.length && scal[j][0] < u + 0.2; j++) {
        const [c, rad] = scal[j];
        const du = u - c;
        if (du > -rad && du < rad) d = Math.max(d, T - 0.35 * rad + Math.sqrt(rad * rad - du * du));
      }
      return d;
    };
    const cuts = pieceCuts(cum, total);
    let carryB = 0.04;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const sub = subChain(ch, cum, cuts[k], cuts[k + 1]);
      const o0 = Math.max(0, cuts[k] - PIECE_OV);
      const subO = subChain(ch, cum, o0, Math.min(total, cuts[k + 1] + PIECE_OV));
      if (sub.pts.length < 2 || subO.pts.length < 2) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const [x, y] of subO.pts) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const pc: Piece = {
        minX: x0 - PIECE_PAD,
        maxX: x1 + PIECE_PAD,
        minY: y0 - PIECE_PAD,
        maxY: y1 + PIECE_PAD,
        chain: polyPath(subO.pts, false),
        band: new Path2D(),
        highlight: new Path2D(),
        bladesBack: null,
        bladesFront: null,
        capFill: null,
        capLine: null,
      };
      if (T > 0) {
        // тело кромки одним многоугольником: верх — поверхность с запасом наружу (лишнее режет клип полигона),
        // низ — фестоны (огибающая кругов вдоль цепочки)
        const lower = bandLower(ch, cum, o0, Math.min(total, cuts[k + 1] + PIECE_OV), depthAt);
        polyPath(offsetChain(subO, -0.12).concat(lower.reverse()), true, pc.band);
        polyPath(offsetChain(subO, Math.min(0.075, T * 0.3)), false, pc.highlight);
      }
      if (blades) {
        // травинки поверх обводки (два прохода: задние темнее)
        const back = new Path2D();
        const front = new Path2D();
        carryB = walkChain(sub, () => lerp(0.06, 0.16, r()) * (r() < 0.12 ? 3 : 1), carryB, (x, y, nx, ny, tx, ty) => {
          const isBack = r() < 0.5;
          const h = lerp(0.08, isBack ? 0.2 : 0.15, r()) * bladeSc;
          const lean = (r() - 0.45) * 0.09 * bladeSc;
          const bw = lerp(0.03, 0.045, r()) * bladeSc;
          const B = isBack ? back : front;
          const bx = x - nx * 0.03;
          const by = y - ny * 0.03;
          B.moveTo(bx - tx * bw, by - ty * bw);
          B.quadraticCurveTo(bx + nx * h * 0.6 - tx * bw * 0.2, by + ny * h * 0.6 - ty * bw * 0.2, bx + nx * h + tx * lean, by + ny * h + ty * lean);
          B.quadraticCurveTo(bx + nx * h * 0.5 + tx * bw * 0.6, by + ny * h * 0.5 + ty * bw * 0.6, bx + tx * bw, by + ty * bw);
          B.closePath();
        });
        pc.bladesBack = back;
        pc.bladesFront = front;
      } else if (edgeKind === 'snow') {
        // снежная «подушка»: бугристый внешний контур (обводится) + заливка до кромки
        const outer = capOutline(subO, o0, bumpH);
        pc.capLine = polyPath(outer, false);
        pc.capFill = polyPath(outer.concat(offsetChain(subO, 0.035).reverse()), true);
      }
      pieces.push(pc);
    }
  }

  // трещины скалы
  let cracks: Path2D | null = null;
  if (kind === 'rock') {
    cracks = new Path2D();
    const area = Math.abs(polyArea(pts));
    const n = Math.max(4, Math.round(area / 1.2));
    for (let i = 0; i < n; i++) {
      let x = lerp(minX + 0.2, maxX - 0.2, r());
      let y = lerp(minY + 0.2, maxY - 0.15, r());
      cracks.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        x += (r() - 0.5) * 0.6;
        y -= lerp(0.15, 0.45, r());
        cracks.lineTo(x, y);
      }
    }
  }

  // стороны, обращённые от света (низ и право) — для внутренней тени скал и помостов
  const shadeEdges = new Path2D();
  {
    const ccw = polyArea(pts) > 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      let nx = (b[1] - a[1]) / len;
      let ny = -(b[0] - a[0]) / len;
      if (!ccw) {
        nx = -nx;
        ny = -ny;
      }
      if (nx * 0.6 - ny * 0.8 > 0.35) {
        shadeEdges.moveTo(a[0], a[1]);
        shadeEdges.lineTo(b[0], b[1]);
      }
    }
  }

  // помост: доски и скобы (тонкий) или кладка (толстый)
  let deck: DeckGeo | null = null;
  if (kind === 'platform') {
    const h = maxY - minY;
    const wood = h <= 1.2;
    const seams = new Path2D();
    const seamsLight = new Path2D();
    const grain = new Path2D();
    const straps: Array<[number, number, number, number]> = [];
    const rivets: P2[] = [];
    const bricks: Array<[number, number, number, number, number]> = [];
    if (wood) {
      const rows = Math.max(1, Math.round(h / 0.26));
      const rh = h / rows;
      for (let i = 1; i < rows; i++) {
        const y = maxY - i * rh;
        seams.moveTo(minX, y);
        seams.lineTo(maxX, y);
        seamsLight.moveTo(minX, y - 0.022);
        seamsLight.lineTo(maxX, y - 0.022);
      }
      for (let i = 0; i < rows; i++) {
        const y0 = maxY - i * rh;
        const y1 = y0 - rh;
        // стыки досок, со сдвигом по рядам
        for (let x = minX + lerp(0.6, 1.6, r()); x < maxX - 0.3; x += lerp(1.5, 2.3, r())) {
          seams.moveTo(x, y0);
          seams.lineTo(x, y1);
          seamsLight.moveTo(x + 0.022, y0);
          seamsLight.lineTo(x + 0.022, y1);
        }
        // волокна
        for (let q = 0; q < 2; q++) {
          const yy = lerp(y1 + rh * 0.25, y0 - rh * 0.25, r());
          const ph = r() * TAU;
          const lam = lerp(0.8, 1.6, r());
          for (let x = minX; x <= maxX; x += 0.08) {
            const yv = yy + 0.012 * Math.sin((TAU * x) / lam + ph);
            if (x === minX) grain.moveTo(x, yv);
            else grain.lineTo(x, yv);
          }
        }
      }
      // металлические скобы
      const span = maxX - minX;
      const nStr = Math.max(2, Math.round(span / 1.9) + 1);
      for (let i = 0; i < nStr; i++) {
        const cx = lerp(minX + 0.35, maxX - 0.35, nStr === 1 ? 0.5 : i / (nStr - 1));
        straps.push([cx - 0.09, minY, 0.18, h]);
        rivets.push([cx, maxY - Math.min(0.13, h * 0.25)], [cx, minY + Math.min(0.13, h * 0.25)]);
      }
    } else {
      const rows = Math.max(1, Math.round(h / 0.5));
      const rh = h / rows;
      for (let i = 0; i < rows; i++) {
        const y1 = maxY - i * rh;
        const y0 = y1 - rh;
        const off = i % 2 ? 0.5 : 0;
        for (let x = minX - off; x < maxX; x += 1.0) {
          bricks.push([x, y0, 1.0, rh, r()]);
          seams.moveTo(x, y0);
          seams.lineTo(x, y1);
          seamsLight.moveTo(x + 0.02, y0);
          seamsLight.lineTo(x + 0.02, y1 - 0.02);
        }
        if (i > 0) {
          seams.moveTo(minX, y1);
          seams.lineTo(maxX, y1);
          seamsLight.moveTo(minX, y1 - 0.02);
          seamsLight.lineTo(maxX, y1 - 0.02);
        }
      }
    }
    deck = { wood, seams, seamsLight, grain, straps, rivets, bricks };
  }

  return {
    path,
    minX,
    maxX,
    minY,
    maxY,
    chains,
    surfaceY,
    shadeEdges,
    edgeT: T,
    pieces,
    vis: null,
    cracks,
    deck,
  };
}

// ───────────────────────── отрисовка ─────────────────────────

// ───────────────────────── кэш тайлов ─────────────────────────
//
// Рельеф статичен: при неподвижном зуме он рисуется из тайлов 256×256 px, запечённых точно под текущий
// масштаб и выровненных по пикселям (blit 1:1 — дёшево и на GPU, и на программном растре). Тайлы строятся
// лениво, с бюджетом времени на кадр; недостающие куски кадра дорисовываются векторно (клип по их прямоугольникам).
// Пока зум меняется — векторная отрисовка целиком.

/** Сторона тайла, px. */
const TT = 256;
/** Бюджет построения тайлов за кадр, мс (минимум один тайл за кадр). */
const TILE_BUDGET_MS = 2;
/** Предел памяти тайлов одного рельефа, байт (LRU). */
const TILE_MAX_BYTES = 32 * 1024 * 1024;
/** Зум считается неподвижным, если масштаб не уходил дальше TILE_EPS столько, мс. */
const TILE_STABLE_MS = 250;
/** Относительный допуск масштаба: при 1920 px расхождение тайлов с миром на краю ≤ 0.5 px. */
const TILE_EPS = 5e-4;

interface TTile {
  /** null — в тайле нет рельефа. */
  c: AnyCanvas | null;
  used: number;
}

interface TCache {
  theme: ThemeId;
  /** Масштаб, под который запечены тайлы (0 — ещё нет). */
  scale: number;
  /** Масштаб, от которого отсчитывается неподвижность зума. */
  anchor: number;
  since: number;
  tiles: Map<number, TTile>;
  bytes: number;
}

const tileCaches = new WeakMap<TerrainDef[], TCache>();
let primeCtx: Ctx2D | null = null;
let frameNo = 0;

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tileKey = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);

/** Кэш тайлов, если зум неподвижен (или вернулся к масштабу готовых тайлов), иначе null. */
function tileCacheFor(terrain: TerrainDef[], theme: ThemeId, scale: number): TCache | null {
  const now = nowMs();
  let c = tileCaches.get(terrain);
  if (!c) {
    // первый кадр уровня: тайлы начинают строиться сразу
    c = { theme, scale: 0, anchor: scale, since: now - TILE_STABLE_MS, tiles: new Map(), bytes: 0 };
    tileCaches.set(terrain, c);
  }
  if (c.theme !== theme) {
    c.theme = theme;
    c.tiles.clear();
    c.bytes = 0;
    c.scale = 0;
  }
  if (Math.abs(scale / c.anchor - 1) > TILE_EPS) {
    c.anchor = scale;
    c.since = now;
  }
  if (now - c.since < TILE_STABLE_MS) return c.scale > 0 && Math.abs(scale / c.scale - 1) <= TILE_EPS ? c : null;
  if (c.scale === 0 || Math.abs(c.anchor / c.scale - 1) > TILE_EPS) {
    c.tiles.clear();
    c.bytes = 0;
    c.scale = c.anchor;
  }
  return c;
}

/** Запечь тайл (i, j): мировые пиксели X = x·s, Y = −y·s; тайл покрывает [i·TT, (i+1)·TT) × [j·TT, (j+1)·TT). */
function buildTile(c: TCache, terrain: TerrainDef[], theme: ThemeId, i: number, j: number): TTile {
  const s = c.scale;
  const x0 = (i * TT) / s;
  const x1 = ((i + 1) * TT) / s;
  const y1 = (-j * TT) / s;
  const y0 = (-(j + 1) * TT) / s;
  let any = false;
  for (const t of terrain) {
    if (t.points.length < 3) continue;
    const g = getGeo(t, theme);
    if (g.maxX + 0.5 >= x0 && g.minX - 0.5 <= x1 && g.maxY + 0.5 >= y0 && g.minY - 0.5 <= y1) {
      any = true;
      break;
    }
  }
  let tile: TTile = { c: null, used: frameNo };
  if (any) {
    const cv = createCanvas(TT, TT);
    drawVector(ctx2d(cv), terrain, theme, s, -i * TT, -j * TT, x0 - 1, x1 + 1, y0 - 1, y1 + 1);
    // растеризовать сейчас (в бюджете построения), а не при первом показе
    if (!primeCtx) primeCtx = ctx2d(createCanvas(1, 1));
    primeCtx.drawImage(cv, 0, 0, 1, 1, 0, 0, 1, 1);
    tile = { c: cv, used: frameNo };
    c.bytes += TT * TT * 4;
  }
  c.tiles.set(tileKey(i, j), tile);
  return tile;
}

/** Освободить давно не используемые тайлы сверх предела памяти. */
function evictTiles(c: TCache): void {
  if (c.bytes <= TILE_MAX_BYTES) return;
  const list = [...c.tiles.entries()].filter(([, t]) => t.c && t.used !== frameNo).sort((a, b) => a[1].used - b[1].used);
  for (const [k] of list) {
    if (c.bytes <= TILE_MAX_BYTES * 0.8) break;
    c.tiles.delete(k);
    c.bytes -= TT * TT * 4;
  }
}

/**
 * Подготовить всё тяжёлое заранее (экран загрузки / интро уровня): текстуры темы (шумовые тайлы грунта и камня)
 * и геометрию рельефа. Без вызова это делается лениво на первом кадре. Возвращает затраченное время, мс.
 */
export function prewarmTerrain(terrain: TerrainDef[], theme: ThemeId): number {
  if (typeof document === 'undefined') return 0;
  const t0 = nowMs();
  soilTile(theme);
  rockTile();
  for (const t of terrain) if (t.points.length >= 3) getGeo(t, theme);
  return nowMs() - t0;
}

/**
 * Рельеф уровня в мировых координатах. Совпадает с полигонами TerrainDef точно (физика по ним же);
 * обводка центрирована по контуру, травинки и снежные «подушки» выступают наружу на 0.1–0.2 м.
 * Массив terrain должен быть тем же объектом от кадра к кадру (кэш геометрии и тайлов привязан к нему).
 */
export function drawTerrain(ctx: CanvasRenderingContext2D, terrain: TerrainDef[], theme: ThemeId, view: ViewInfo): void {
  if (!terrain.length || view.scale <= 0) return;
  frameNo++;
  const W = view.screenW;
  const H = view.screenH;
  // видимая область мира с запасом
  const halfW = W / 2 / view.scale + 1;
  const halfH = H / 2 / view.scale + 1;
  const vx0 = view.camX - halfW;
  const vx1 = view.camX + halfW;
  const vy0 = view.camY - halfH;
  const vy1 = view.camY + halfH;
  const cache = typeof document !== 'undefined' ? tileCacheFor(terrain, theme, view.scale) : null;
  if (!cache) {
    drawVector(ctx, terrain, theme, view.scale, W / 2 - view.camX * view.scale, H / 2 + view.camY * view.scale, vx0, vx1, vy0, vy1);
    return;
  }
  const s = cache.scale;
  // начало мировых пикселей на экране — целое: тайлы ложатся 1:1 без пересэмплирования
  const ox = Math.round(W / 2 - view.camX * s);
  const oy = Math.round(H / 2 + view.camY * s);
  const i0 = Math.floor(-ox / TT);
  const i1 = Math.floor((W - 1 - ox) / TT);
  const j0 = Math.floor(-oy / TT);
  const j1 = Math.floor((H - 1 - oy) / TT);
  const t0 = nowMs();
  let built = 0;
  const missing: number[] = [];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      let t = cache.tiles.get(tileKey(i, j));
      if (!t && (built === 0 || nowMs() - t0 < TILE_BUDGET_MS)) {
        t = buildTile(cache, terrain, theme, i, j);
        built++;
      }
      if (!t) {
        missing.push(i, j);
        continue;
      }
      t.used = frameNo;
      if (t.c) ctx.drawImage(t.c, i * TT + ox, j * TT + oy);
    }
  }
  if (missing.length) {
    // ещё не готовые тайлы — векторно, только внутри их прямоугольников
    ctx.beginPath();
    for (let k = 0; k < missing.length; k += 2) ctx.rect(missing[k] * TT + ox, missing[k + 1] * TT + oy, TT, TT);
    ctx.clip();
    drawVector(ctx, terrain, theme, s, ox, oy, vx0, vx1, vy0, vy1);
  }
  ctx.restore();
  evictTiles(cache);
}

/** Векторная отрисовка рельефа: мир → (s, ox, oy) (Y вверх), отсечение по мировому прямоугольнику. */
function drawVector(
  ctx: Ctx2D,
  terrain: TerrainDef[],
  theme: ThemeId,
  s: number,
  ox: number,
  oy: number,
  vx0: number,
  vx1: number,
  vy0: number,
  vy1: number,
): void {
  const P = TERRAIN_PALETTES[theme];
  ctx.save();
  ctx.setTransform(s, 0, 0, -s, ox, oy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const px = 1 / s;
  for (const t of terrain) {
    if (t.points.length < 3) continue;
    const g = getGeo(t, theme);
    if (g.maxX < vx0 || g.minX > vx1 || g.maxY + 0.4 < vy0 || g.minY > vy1) continue;
    const V = visOf(g, vx0, vx1, vy0, vy1);
    if (t.kind === 'ground') drawGround(ctx, g, V, P, theme, px);
    else if (t.kind === 'rock') drawRock(ctx, g, V, P, theme, px);
    else drawPlatform(ctx, g, V, P, theme, px);
  }
  ctx.restore();
}

/** Объединённые пути кусков кромки, попавших в вид [x0, x1] × [y0, y1]; кэш до смены набора кусков. */
function visOf(g: Geo, x0: number, x1: number, y0: number, y1: number): Vis {
  const idx: number[] = [];
  for (let i = 0; i < g.pieces.length; i++) {
    const p = g.pieces[i];
    if (p.maxX >= x0 && p.minX <= x1 && p.maxY >= y0 && p.minY <= y1) idx.push(i);
  }
  const key = idx.join(',');
  if (g.vis && g.vis.key === key) return g.vis;
  const v: Vis = { key, chain: new Path2D(), band: new Path2D(), highlight: new Path2D(), bladesBack: null, bladesFront: null, capFill: null, capLine: null };
  const add = (into: Path2D | null, src: Path2D | null): Path2D | null => {
    if (!src) return into;
    const d = into ?? new Path2D();
    d.addPath(src);
    return d;
  };
  for (const i of idx) {
    const p = g.pieces[i];
    v.chain.addPath(p.chain);
    v.band.addPath(p.band);
    v.highlight.addPath(p.highlight);
    v.bladesBack = add(v.bladesBack, p.bladesBack);
    v.bladesFront = add(v.bladesFront, p.bladesFront);
    v.capFill = add(v.capFill, p.capFill);
    v.capLine = add(v.capLine, p.capLine);
  }
  g.vis = v;
  return v;
}

function outlineWidth(px: number): number {
  return Math.max(0.06, 1.5 * px);
}

/** Кромка (трава / песок / снег / мох) по верхним рёбрам — внутри клипа полигона. */
function drawEdgeBand(ctx: Ctx2D, g: Geo, V: Vis, top: string, dark: string, lip: string, light: string, px: number): void {
  const T = g.edgeT;
  if (T <= 0 || !g.chains.length) return;
  // «губа» — тёмная тень под кромкой
  ctx.save();
  ctx.translate(0, -0.06);
  ctx.fillStyle = lip;
  ctx.fill(V.band);
  ctx.restore();
  // тело кромки: тёмный низ → основной цвет → светлый верх (ступенчатый «градиент» вдоль кромки)
  ctx.fillStyle = dark;
  ctx.fill(V.band);
  ctx.strokeStyle = mix(dark, top, 0.55);
  ctx.lineWidth = 2 * T * 0.74;
  ctx.stroke(V.chain);
  ctx.strokeStyle = top;
  ctx.lineWidth = 2 * T * 0.5;
  ctx.stroke(V.chain);
  // блик у самого края
  ctx.strokeStyle = rgba(light, 0.9);
  ctx.lineWidth = Math.max(0.055, 1.2 * px);
  ctx.stroke(V.highlight);
}

function drawGround(ctx: Ctx2D, g: Geo, V: Vis, P: TerrainPalette, theme: ThemeId, px: number): void {
  const G = P.ground;
  // 1. грунт: бесшовная текстура в мировых координатах
  const pat = worldPattern(ctx, `soil:${theme}`, soilTile(theme), SOIL_M);
  ctx.fillStyle = pat ?? G.soil;
  ctx.fill(g.path);
  const ph = TERRAIN_PROBE.phase;
  ph?.('soil');
  // 2. затемнение вглубь от нижней поверхности
  const dg = ctx.createLinearGradient(0, g.surfaceY - 0.25, 0, g.surfaceY - 4.5);
  dg.addColorStop(0, rgba(G.soilDeep, 0));
  dg.addColorStop(1, rgba(G.soilDeep, 0.72));
  ctx.fillStyle = dg;
  ctx.fill(g.path);
  ph?.('deep');
  ctx.save();
  ctx.clip(g.path);
  ph?.('clip');
  // 3. мягкая тень под кромкой (объём) + кромка; плоские концы — без тёмных «пятен» во внутренних углах
  ctx.strokeStyle = rgba(G.soilDeep, 0.22);
  ctx.lineWidth = 2 * (g.edgeT + 0.32);
  ctx.lineCap = 'butt';
  ctx.stroke(V.chain);
  ctx.lineCap = 'round';
  ph?.('shade');
  drawEdgeBand(ctx, g, V, G.top, G.dark, G.lip, G.light, px);
  ph?.('band');
  ctx.restore();
  // 4. обводка полигона
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = G.outline;
  ctx.stroke(g.path);
  ph?.('outline');
  // 5. поверх обводки: травинки или снежная подушка
  drawOverEdge(ctx, g, V, G.top, G.dark, G.light, G.outline, px);
  ph?.('over');
}

/** Травинки / снежная шапка поверх обводки. */
function drawOverEdge(ctx: Ctx2D, g: Geo, V: Vis, top: string, dark: string, light: string, outline: string, px: number): void {
  if (V.bladesBack && V.bladesFront) {
    ctx.fillStyle = dark;
    ctx.fill(V.bladesBack);
    ctx.fillStyle = top;
    ctx.fill(V.bladesFront);
  }
  if (V.capFill && V.capLine) {
    const grd = ctx.createLinearGradient(0, g.maxY + 0.2, 0, g.surfaceY - 0.3);
    grd.addColorStop(0, light);
    grd.addColorStop(1, top);
    ctx.fillStyle = grd;
    ctx.fill(V.capFill);
    ctx.lineWidth = outlineWidth(px);
    ctx.strokeStyle = outline;
    ctx.stroke(V.capLine);
  }
}

function drawRock(ctx: Ctx2D, g: Geo, V: Vis, P: TerrainPalette, _theme: ThemeId, px: number): void {
  const R = P.rock;
  const grd = ctx.createLinearGradient(g.minX, g.maxY, g.minX + (g.maxY - g.minY) * 0.35, g.minY);
  grd.addColorStop(0, R.light);
  grd.addColorStop(0.45, R.fill);
  grd.addColorStop(1, R.dark);
  ctx.fillStyle = grd;
  ctx.fill(g.path);
  ctx.save();
  ctx.clip(g.path);
  const pat = worldPattern(ctx, 'rock', rockTile(), ROCK_M);
  if (pat) {
    ctx.fillStyle = pat;
    ctx.fill(g.path);
  }
  // внутренняя тень по нижним/правым сторонам и блик по верхним
  ctx.strokeStyle = rgba(R.dark, 0.55);
  ctx.lineWidth = 0.36;
  ctx.stroke(g.shadeEdges);
  ctx.strokeStyle = rgba(R.light, 0.75);
  ctx.lineWidth = 0.2;
  ctx.stroke(V.chain);
  ctx.strokeStyle = rgba('#FFFFFF', 0.35);
  ctx.lineWidth = Math.max(0.05, 1.2 * px);
  ctx.stroke(V.highlight);
  // трещины: тёмная щель + светлая стенка ниже-правее
  if (g.cracks) {
    ctx.save();
    ctx.translate(0.025, -0.025);
    ctx.strokeStyle = rgba(R.light, 0.55);
    ctx.lineWidth = Math.max(0.035, px);
    ctx.stroke(g.cracks);
    ctx.restore();
    ctx.strokeStyle = rgba(R.outline, 0.6);
    ctx.lineWidth = Math.max(0.045, 1.2 * px);
    ctx.stroke(g.cracks);
  }
  if (R.cap === 'moss') drawEdgeBand(ctx, g, V, P.moss.top, P.moss.dark, mix(P.moss.dark, R.dark, 0.5), P.moss.light, px);
  ctx.restore();
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = R.outline;
  ctx.stroke(g.path);
  if (R.cap === 'moss') drawOverEdge(ctx, g, V, P.moss.top, P.moss.dark, P.moss.light, R.outline, px);
  if (R.cap === 'snow') {
    ctx.save();
    ctx.clip(g.path);
    drawEdgeBand(ctx, g, V, P.ground.top, P.ground.dark, P.ground.lip, P.ground.light, px);
    ctx.restore();
    drawOverEdge(ctx, g, V, P.ground.top, P.ground.dark, P.ground.light, R.outline, px);
  }
}

function drawPlatform(ctx: Ctx2D, g: Geo, V: Vis, P: TerrainPalette, theme: ThemeId, px: number): void {
  const d = g.deck;
  if (!d) return;
  const D = P.deck;
  const R = P.rock;
  const outline = d.wood ? D.outline : R.outline;
  const grd = ctx.createLinearGradient(0, g.maxY, 0, g.minY);
  if (d.wood) {
    grd.addColorStop(0, D.light);
    grd.addColorStop(0.3, D.base);
    grd.addColorStop(1, D.dark);
  } else {
    grd.addColorStop(0, R.light);
    grd.addColorStop(0.45, R.fill);
    grd.addColorStop(1, R.dark);
  }
  ctx.fillStyle = grd;
  ctx.fill(g.path);
  ctx.save();
  ctx.clip(g.path);
  if (!d.wood) {
    // кирпичи: лёгкая вариация тона + фактура
    for (const [x, y, w, h, v] of d.bricks) {
      ctx.fillStyle = v < 0.5 ? rgba(R.dark, (0.5 - v) * 0.35) : rgba('#FFFFFF', (v - 0.5) * 0.22);
      ctx.fillRect(x, y, w, h);
    }
    const pat = worldPattern(ctx, 'rock', rockTile(), ROCK_M);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fill(g.path);
    }
  } else {
    ctx.strokeStyle = rgba(D.seam, 0.35);
    ctx.lineWidth = Math.max(0.014, 0.8 * px);
    ctx.stroke(d.grain);
  }
  // швы: светлая стенка + тёмная щель
  ctx.strokeStyle = rgba(d.wood ? D.light : R.light, 0.6);
  ctx.lineWidth = Math.max(0.022, px);
  ctx.stroke(d.seamsLight);
  ctx.strokeStyle = d.wood ? D.seam : rgba(R.outline, 0.75);
  ctx.lineWidth = Math.max(0.03, 1.2 * px);
  ctx.stroke(d.seams);
  // металлические скобы с заклёпками
  for (const [x, y, w, h] of d.straps) {
    const mg = ctx.createLinearGradient(x, 0, x + w, 0);
    mg.addColorStop(0, D.metalLight);
    mg.addColorStop(0.45, D.metal);
    mg.addColorStop(1, D.metalDark);
    ctx.fillStyle = mg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = D.metalDark;
    ctx.lineWidth = Math.max(0.022, px);
    ctx.strokeRect(x, y - 0.1, w, h + 0.2);
  }
  for (const [x, y] of d.rivets) {
    ctx.fillStyle = D.metalDark;
    ctx.beginPath();
    ctx.arc(x + 0.008, y - 0.008, 0.042, 0, TAU);
    ctx.fill();
    ctx.fillStyle = D.metalLight;
    ctx.beginPath();
    ctx.arc(x, y, 0.032, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x - 0.01, y + 0.01, 0.012, 0, TAU);
    ctx.fill();
  }
  // объём: тень снизу-справа, блик сверху
  ctx.strokeStyle = rgba(d.wood ? D.seam : R.dark, 0.5);
  ctx.lineWidth = 0.2;
  ctx.stroke(g.shadeEdges);
  ctx.strokeStyle = rgba(d.wood ? D.light : R.light, 0.9);
  ctx.lineWidth = 0.09;
  ctx.stroke(V.chain);
  if (!d.wood && R.cap === 'moss') drawEdgeBand(ctx, g, V, P.moss.top, P.moss.dark, mix(P.moss.dark, R.dark, 0.5), P.moss.light, px);
  ctx.restore();
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = outline;
  ctx.stroke(g.path);
  if (theme === 'snow') drawOverEdge(ctx, g, V, P.ground.top, P.ground.dark, P.ground.light, outline, px);
  else if (!d.wood && R.cap === 'moss') drawOverEdge(ctx, g, V, P.moss.top, P.moss.dark, P.moss.light, R.outline, px);
}
