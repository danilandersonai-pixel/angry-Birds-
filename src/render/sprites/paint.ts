// Общие хелперы процедурной графики фона и рельефа: числа, цвета, детерминированный шум.

import { Rng } from '../../core/rng';
import { createCanvas, ctx2d, type AnyCanvas } from '../canvas';

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

/** Относительная яркость (WCAG) hex-цвета. */
export function luminance(hex: string): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Контраст яркостей двух цветов (WCAG, 1…21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
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
  return finish(noiseTileSteps(size, seed, cells, octaves, fn));
}

/**
 * То же по шагам (прогрев кусками): уступка после каждых rows строк; результат — значение генератора.
 * Тайл грунта 512² — ≈ 40 мс (×4 CPU — 200 мс) одной задачей.
 */
export function* noiseTileSteps(
  size: number,
  seed: number,
  cells: number,
  octaves: number,
  fn: (v: number, x: number, y: number) => readonly [number, number, number, number],
  rows = 64,
): Generator<void, AnyCanvas> {
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
    if ((y + 1) % rows === 0 && y + 1 < size) yield;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Довести генератор шагов до конца и вернуть его результат. */
export function finish<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** Уменьшение движения (prefers-reduced-motion): покачивание и прочая декоративная анимация гасятся. */
let reducedMotion: boolean | null = null;
let reducedOverride: boolean | null = null;

export function prefersReducedMotion(): boolean {
  if (reducedOverride !== null) return reducedOverride;
  if (reducedMotion === null) {
    reducedMotion = false;
    if (typeof matchMedia === 'function') {
      const mq = matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = mq.matches;
      mq.addEventListener?.('change', (e) => (reducedMotion = e.matches));
    }
  }
  return reducedMotion;
}

/** Явно задать режим уменьшенного движения (настройки игры); null — следовать системной настройке. */
export function setReducedMotion(on: boolean | null): void {
  reducedOverride = on;
}
