// След полёта: белые «пуфы» (01-gameplay.md §3.3, 04-visual.md §8.5).
// Чётные точки r 0.11 м, нечётные 0.065 м, крупная (способность/удар) 0.22 м; заливка белая α 0.9,
// контур rgba(0,0,0,0.18) 0.015 м. Все точки — один путь: один fill + один stroke.
// Появление точки: масштаб 0 → 1 за 0.12 с (easeOutBack). Время рождения храним по позиции точки
// (а не по ссылке на объект), поэтому работает и если ядро каждый кадр отдаёт копии точек.

import type { TrailPoint } from '../../core/api';
import type { ViewInfo } from '../view';
import { easeOutBack, TAU } from './math';

const R_EVEN = 0.11;
const R_ODD = 0.065;
const R_BIG = 0.22;
const POP_TIME = 0.12;

const births = new Map<number, number>();
let lastSweep = 0;
let lastTime = -1;
let lastPoints: readonly TrailPoint[] = [];

/** Точки, переданные последнему drawTrail (след текущего выстрела): по нему Fx рисует эффекты способностей. */
export function lastTrail(): readonly TrailPoint[] {
  return lastPoints;
}

/** Ключ позиции с точностью 1 см. */
const keyOf = (x: number, y: number): number => Math.round(x * 100) * 4194304 + Math.round(y * 100);

export function drawTrail(ctx: CanvasRenderingContext2D, view: ViewInfo, points: readonly TrailPoint[]): void {
  const now = view.time;
  lastPoints = points;
  if (now < lastTime) births.clear(); // сцена перезапущена — время пошло заново
  lastTime = now;
  if (points.length === 0) {
    if (births.size) births.clear();
    return;
  }
  const s = view.scale;
  const halfW = view.screenW / 2;
  const halfH = view.screenH / 2;
  const minR = 1.4 * (view.dpr || 1); // точку меньше ~1.5 px не делаем
  const margin = R_BIG * s + 4;
  // Если почти все точки «новые» (первый кадр, перезапуск), не анимируем — показываем сразу.
  let fresh = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!births.has(keyOf(p.x, p.y))) fresh++;
  }
  const animate = fresh <= 6 || fresh < points.length * 0.25;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const k = keyOf(p.x, p.y);
    let born = births.get(k);
    if (born === undefined) {
      born = animate ? now : now - POP_TIME;
      births.set(k, born);
    }
    const sx = (p.x - view.camX) * s + halfW;
    const sy = halfH - (p.y - view.camY) * s;
    if (sx < -margin || sx > view.screenW + margin || sy < -margin || sy > view.screenH + margin) continue;
    const age = now - born;
    const pop = age >= POP_TIME ? 1 : age <= 0 ? 0.05 : Math.max(0.05, easeOutBack(age / POP_TIME));
    const rM = p.big ? R_BIG : i % 2 === 0 ? R_EVEN : R_ODD;
    const r = Math.max(rM * s, minR) * pop;
    ctx.moveTo(sx + r, sy);
    ctx.arc(sx, sy, r, 0, TAU);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
  ctx.lineWidth = Math.max(0.015 * s, 1);
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();
  ctx.restore();
  // Чистка «забытых» ключей раз в 2 с.
  if (now - lastSweep > 2 || births.size > points.length * 3 + 64) {
    lastSweep = now;
    if (births.size > points.length + 8) {
      const live = new Set<number>();
      for (const p of points) live.add(keyOf(p.x, p.y));
      for (const k of births.keys()) if (!live.has(k)) births.delete(k);
    }
  }
}
