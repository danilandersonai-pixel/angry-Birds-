// Высота поверхности рельефа под точкой — для отскока обломков и пыли взрыва у земли.
// Сэмплируем верхние рёбра многоугольников рельефа через STEP метров один раз при загрузке уровня.

import type { TerrainDef } from '../../core/types';

export type GroundFn = (x: number) => number;

const STEP = 0.25;

/** Плоская земля y = 0 (по умолчанию, пока не задан рельеф уровня). */
export const FLAT_GROUND: GroundFn = () => 0;

/** Построить функцию высоты по рельефу уровня. Вне рельефа — −∞ (частицы падают дальше). */
export function buildGround(terrain: readonly TerrainDef[]): GroundFn {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const t of terrain) {
    for (const [x] of t.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  if (!(maxX > minX)) return () => -Infinity;
  const n = Math.ceil((maxX - minX) / STEP) + 1;
  const h = new Float64Array(n).fill(-Infinity);
  for (let i = 0; i < n; i++) {
    const x = Math.min(maxX, minX + i * STEP);
    let top = -Infinity;
    for (const t of terrain) {
      const p = t.points;
      for (let j = 0; j < p.length; j++) {
        const [x1, y1] = p[j];
        const [x2, y2] = p[(j + 1) % p.length];
        const lo = Math.min(x1, x2);
        const hi = Math.max(x1, x2);
        if (x < lo || x > hi || hi - lo < 1e-9) continue;
        const y = y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
        if (y > top) top = y;
      }
    }
    h[i] = top;
  }
  return (x: number) => {
    if (x < minX || x > maxX) return -Infinity;
    const f = (x - minX) / STEP;
    const i = Math.floor(f);
    if (i >= n - 1) return h[n - 1];
    const a = h[i];
    const b = h[i + 1];
    if (a === -Infinity || b === -Infinity) return a > b ? a : b;
    return a + (b - a) * (f - i);
  };
}
