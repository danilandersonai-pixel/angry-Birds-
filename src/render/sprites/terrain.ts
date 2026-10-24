// Рельеф уровня в мировых координатах: грунт с кромкой (трава / песок / снег), скалы, помосты.
// Геометрия (Path2D, цепочки верхних рёбер, травинки, шапки) строится ОДИН раз на TerrainDef и кэшируется;
// каждый кадр — несколько fill/stroke в мировой трансформации. Текстуры — бесшовные тайлы, привязанные к миру.
// Здесь же — общие цветовые и шумовые хелперы фона (background.ts импортирует их отсюда).

import type { TerrainDef, ThemeId } from '../../core/types';
import { Rng } from '../../core/rng';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import { applyWorldTransform, type ViewInfo } from '../view';

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

interface Geo {
  path: Path2D;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  chains: Chain[];
  /** Самая низкая верхняя поверхность — от неё считается затемнение грунта вглубь. */
  surfaceY: number;
  chainPath: Path2D;
  /** Отдельные рёбра по сторонам (для теней скал). */
  shadeEdges: Path2D;
  edgeT: number;
  scallops: Path2D;
  highlight: Path2D;
  /** Травинки (два прохода) или снежные шапки. */
  bladesBack: Path2D | null;
  bladesFront: Path2D | null;
  capFill: Path2D | null;
  capLine: Path2D | null;
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
): void {
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

const geoCache = new WeakMap<TerrainDef, Map<ThemeId, Geo>>();

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

  const chainPath = new Path2D();
  for (const ch of chains) polyPath(ch.pts, false, chainPath);

  // кромка зависит от вида рельефа
  const kind = t.kind;
  const edgeKind: GroundPalette['edge'] | 'moss' | 'none' =
    kind === 'ground'
      ? P.ground.edge
      : kind === 'rock'
        ? P.rock.cap ?? 'none'
        : theme === 'snow'
          ? 'snow'
          : 'none';
  const T = kind === 'ground' ? edgeThickness(P.ground.edge) : edgeKind === 'snow' ? 0.26 : edgeKind === 'moss' ? 0.14 : 0;

  // фестончатый нижний край кромки
  const scallops = new Path2D();
  const highlight = new Path2D();
  if (T > 0) {
    for (const ch of chains) {
      let k = 0;
      walkChain(ch, () => lerp(0.17, 0.26, r()), 0.05, (x, y, nx, ny) => {
        const rad = (k++ % 2 ? 0.085 : 0.115) * (T / 0.34) * lerp(0.85, 1.15, r());
        const d = T - rad * 0.35;
        scallops.moveTo(x - nx * d + rad, y - ny * d);
        scallops.arc(x - nx * d, y - ny * d, rad, 0, TAU);
      });
      polyPath(offsetChain(ch, Math.min(0.075, T * 0.3)), false, highlight);
    }
  }

  // травинки / шапки поверх обводки
  let bladesBack: Path2D | null = null;
  let bladesFront: Path2D | null = null;
  let capFill: Path2D | null = null;
  let capLine: Path2D | null = null;
  if (edgeKind === 'grass' || edgeKind === 'moss') {
    bladesBack = new Path2D();
    bladesFront = new Path2D();
    const sc = edgeKind === 'moss' ? 0.6 : 1;
    for (const ch of chains) {
      walkChain(ch, () => lerp(0.06, 0.16, r()) * (r() < 0.12 ? 3 : 1), 0.04, (x, y, nx, ny, tx, ty) => {
        const back = r() < 0.5;
        const h = lerp(0.08, back ? 0.2 : 0.15, r()) * sc;
        const lean = (r() - 0.45) * 0.09 * sc;
        const bw = lerp(0.03, 0.045, r()) * sc;
        const P2 = back ? bladesBack! : bladesFront!;
        const bx = x - nx * 0.03;
        const by = y - ny * 0.03;
        P2.moveTo(bx - tx * bw, by - ty * bw);
        P2.quadraticCurveTo(bx + nx * h * 0.6 - tx * bw * 0.2, by + ny * h * 0.6 - ty * bw * 0.2, bx + nx * h + tx * lean, by + ny * h + ty * lean);
        P2.quadraticCurveTo(bx + nx * h * 0.5 + tx * bw * 0.6, by + ny * h * 0.5 + ty * bw * 0.6, bx + tx * bw, by + ty * bw);
        P2.closePath();
      });
    }
  } else if (edgeKind === 'snow') {
    // снежная «подушка»: бугристый внешний контур (обводится) + заливка до кромки
    capFill = new Path2D();
    capLine = new Path2D();
    const sc = kind === 'ground' ? 1 : 0.8;
    for (const ch of chains) {
      // бугры вдоль цепочки
      let total = 0;
      for (let i = 0; i < ch.en.length; i++) total += Math.hypot(ch.pts[i + 1][0] - ch.pts[i][0], ch.pts[i + 1][1] - ch.pts[i][1]);
      const bumps: Array<[number, number, number]> = [];
      for (let s = lerp(0.1, 0.3, r()); s < total - 0.05; s += lerp(0.32, 0.62, r())) {
        bumps.push([s, lerp(0.12, 0.22, r()) * sc, lerp(0.45, 0.7, r())]);
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
      const outer: P2[] = [];
      let acc = 0;
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
      polyPath(outer, false, capLine);
      const inner = offsetChain(ch, 0.035).reverse();
      polyPath(outer.concat(inner), true, capFill);
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
    chainPath,
    shadeEdges,
    edgeT: T,
    scallops,
    highlight,
    bladesBack,
    bladesFront,
    capFill,
    capLine,
    cracks,
    deck,
  };
}

// ───────────────────────── отрисовка ─────────────────────────

/**
 * Рельеф уровня в мировых координатах. Совпадает с полигонами TerrainDef точно (физика по ним же);
 * обводка центрирована по контуру, травинки и снежные «подушки» выступают наружу на 0.1–0.2 м.
 */
export function drawTerrain(ctx: CanvasRenderingContext2D, terrain: TerrainDef[], theme: ThemeId, view: ViewInfo): void {
  if (!terrain.length || view.scale <= 0) return;
  const P = TERRAIN_PALETTES[theme];
  ctx.save();
  applyWorldTransform(ctx, view);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const px = 1 / view.scale;
  // видимая область мира с запасом
  const halfW = (view.screenW / 2) * px + 1;
  const halfH = (view.screenH / 2) * px + 1;
  const vx0 = view.camX - halfW;
  const vx1 = view.camX + halfW;
  const vy0 = view.camY - halfH;
  const vy1 = view.camY + halfH;
  for (const t of terrain) {
    if (t.points.length < 3) continue;
    const g = getGeo(t, theme);
    if (g.maxX < vx0 || g.minX > vx1 || g.maxY + 0.4 < vy0 || g.minY > vy1) continue;
    if (t.kind === 'ground') drawGround(ctx, g, P, theme, px);
    else if (t.kind === 'rock') drawRock(ctx, g, P, theme, px);
    else drawPlatform(ctx, g, P, theme, px);
  }
  ctx.restore();
}

function outlineWidth(px: number): number {
  return Math.max(0.06, 1.5 * px);
}

/** Кромка (трава / песок / снег / мох) по верхним рёбрам — внутри клипа полигона. */
function drawEdgeBand(ctx: Ctx2D, g: Geo, top: string, dark: string, lip: string, light: string, px: number): void {
  const T = g.edgeT;
  if (T <= 0 || !g.chains.length) return;
  // «губа» — тёмная тень под кромкой
  ctx.save();
  ctx.translate(0, -0.06);
  ctx.strokeStyle = lip;
  ctx.fillStyle = lip;
  ctx.lineWidth = 2 * T;
  ctx.stroke(g.chainPath);
  ctx.fill(g.scallops);
  ctx.restore();
  // тело кромки: тёмный низ → основной цвет → светлый верх (ступенчатый «градиент» вдоль кромки)
  ctx.strokeStyle = dark;
  ctx.fillStyle = dark;
  ctx.lineWidth = 2 * T;
  ctx.stroke(g.chainPath);
  ctx.fill(g.scallops);
  ctx.strokeStyle = mix(dark, top, 0.55);
  ctx.lineWidth = 2 * T * 0.74;
  ctx.stroke(g.chainPath);
  ctx.strokeStyle = top;
  ctx.lineWidth = 2 * T * 0.5;
  ctx.stroke(g.chainPath);
  // блик у самого края
  ctx.strokeStyle = rgba(light, 0.9);
  ctx.lineWidth = Math.max(0.055, 1.2 * px);
  ctx.stroke(g.highlight);
}

function drawGround(ctx: Ctx2D, g: Geo, P: TerrainPalette, theme: ThemeId, px: number): void {
  const G = P.ground;
  // 1. грунт: бесшовная текстура в мировых координатах
  const pat = worldPattern(ctx, `soil:${theme}`, soilTile(theme), SOIL_M);
  ctx.fillStyle = pat ?? G.soil;
  ctx.fill(g.path);
  // 2. затемнение вглубь от нижней поверхности
  const dg = ctx.createLinearGradient(0, g.surfaceY - 0.25, 0, g.surfaceY - 4.5);
  dg.addColorStop(0, rgba(G.soilDeep, 0));
  dg.addColorStop(1, rgba(G.soilDeep, 0.72));
  ctx.fillStyle = dg;
  ctx.fill(g.path);
  ctx.save();
  ctx.clip(g.path);
  // 3. мягкая тень под кромкой (объём) + кромка
  ctx.strokeStyle = rgba(G.soilDeep, 0.22);
  ctx.lineWidth = 2 * (g.edgeT + 0.32);
  ctx.stroke(g.chainPath);
  drawEdgeBand(ctx, g, G.top, G.dark, G.lip, G.light, px);
  ctx.restore();
  // 4. обводка полигона
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = G.outline;
  ctx.stroke(g.path);
  // 5. поверх обводки: травинки или снежная подушка
  drawOverEdge(ctx, g, G.top, G.dark, G.light, G.outline, px);
}

/** Травинки / снежная шапка поверх обводки. */
function drawOverEdge(ctx: Ctx2D, g: Geo, top: string, dark: string, light: string, outline: string, px: number): void {
  if (g.bladesBack && g.bladesFront) {
    ctx.fillStyle = dark;
    ctx.fill(g.bladesBack);
    ctx.fillStyle = top;
    ctx.fill(g.bladesFront);
  }
  if (g.capFill && g.capLine) {
    const grd = ctx.createLinearGradient(0, g.maxY + 0.2, 0, g.surfaceY - 0.3);
    grd.addColorStop(0, light);
    grd.addColorStop(1, top);
    ctx.fillStyle = grd;
    ctx.fill(g.capFill);
    ctx.lineWidth = outlineWidth(px);
    ctx.strokeStyle = outline;
    ctx.stroke(g.capLine);
  }
}

function drawRock(ctx: Ctx2D, g: Geo, P: TerrainPalette, _theme: ThemeId, px: number): void {
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
  ctx.stroke(g.chainPath);
  ctx.strokeStyle = rgba('#FFFFFF', 0.35);
  ctx.lineWidth = Math.max(0.05, 1.2 * px);
  ctx.stroke(g.highlight);
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
  if (R.cap === 'moss') drawEdgeBand(ctx, g, P.moss.top, P.moss.dark, mix(P.moss.dark, R.dark, 0.5), P.moss.light, px);
  ctx.restore();
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = R.outline;
  ctx.stroke(g.path);
  if (R.cap === 'moss') drawOverEdge(ctx, g, P.moss.top, P.moss.dark, P.moss.light, R.outline, px);
  if (R.cap === 'snow') {
    ctx.save();
    ctx.clip(g.path);
    drawEdgeBand(ctx, g, P.ground.top, P.ground.dark, P.ground.lip, P.ground.light, px);
    ctx.restore();
    drawOverEdge(ctx, g, P.ground.top, P.ground.dark, P.ground.light, R.outline, px);
  }
}

function drawPlatform(ctx: Ctx2D, g: Geo, P: TerrainPalette, theme: ThemeId, px: number): void {
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
  ctx.stroke(g.chainPath);
  if (!d.wood && R.cap === 'moss') drawEdgeBand(ctx, g, P.moss.top, P.moss.dark, mix(P.moss.dark, R.dark, 0.5), P.moss.light, px);
  ctx.restore();
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = outline;
  ctx.stroke(g.path);
  if (theme === 'snow') drawOverEdge(ctx, g, P.ground.top, P.ground.dark, P.ground.light, outline, px);
  else if (!d.wood && R.cap === 'moss') drawOverEdge(ctx, g, P.moss.top, P.moss.dark, P.moss.light, R.outline, px);
}
