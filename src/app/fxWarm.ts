// Прогрев эффектов под шторкой загрузки (плейтест №1, п. 4): первое использование эффектов в игре стоило 30–90 мс —
// атлас частиц допекал ступени размеров (случайный масштаб частиц), страница атласа менялась и копировалась целиком,
// шрифт всплывающих очков растеризовался впервые. Здесь отдельный Fx (атлас общий — FX_SPRITES) проигрывает набор
// пробных событий (удары, разрушения всех материалов, взрывы, перья всех птиц, очки) на масштабах уровня и рисует
// их в крошечный холст; затем каждая страница атласа один раз рисуется в игровой холст (под шторкой — не видно),
// чтобы её загрузка в GPU тоже случилась сейчас.
// Плейтест №2, п. 6: пробные события попадают не во все ступени размеров (случайный размер частиц, рост дыма) —
// первый настоящий взрыв допекал 2–4 крупных спрайта (25–30 мс). Поэтому после проигрыша каждый уже запечённый
// спрайт допекается на всех ступенях от самой мелкой до наибольшей встреченной + 2, остальные — на мелких ступенях
// (любое допекание в игре меняет страницу атласа и стоит её копирования).

import { EXPLOSION } from '../config/constants';
import type { GameEvent } from '../core/events';
import type { BirdType, Material, PigType } from '../core/types';
import { createCanvas, ctx2d } from '../render/canvas';
import { Fx } from '../render/fx/Fx';
import { FX_SPRITES } from '../render/fx/sprites';
import type { ViewInfo } from '../render/view';

const BIRD_TYPES: readonly BirdType[] = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];
const MATERIALS: readonly Material[] = ['wood', 'ice', 'stone'];
const PIG_TYPES: readonly PigType[] = ['small', 'medium', 'helmet', 'large'];

/** Пробные события вокруг точки (x, y). */
function sampleEvents(x: number, y: number): GameEvent[] {
  const ev: GameEvent[] = [];
  let id = 1_000_000;
  for (const m of MATERIALS) {
    ev.push({ type: 'impact', x, y, impulse: 40, a: m, b: 'bird', size: 1 });
    ev.push({ type: 'blockDamaged', id: id++, material: m, x: x + 1, y, stage: 2 });
    for (const [w, h] of [
      [2, 0.5],
      [1, 1],
      [4, 0.5],
    ]) {
      ev.push({ type: 'blockDestroyed', id: id++, material: m, shape: 'rect', x, y: y + h, w, h, angle: 0.3, vx: 2, vy: 1, points: 500 });
      ev.push({ type: 'score', points: 500 + w * 100, x, y: y + h, kind: 'block' });
    }
  }
  ev.push({ type: 'impact', x, y, impulse: 30, a: 'pig', b: 'ground' });
  ev.push({ type: 'impact', x, y, impulse: 30, a: 'tnt', b: 'stone' });
  for (const b of BIRD_TYPES) {
    ev.push({ type: 'birdLaunched', id: id, bird: b, x: x - 3, y: y + 2, power: 1 });
    ev.push({ type: 'ability', id: id, bird: b, x: x - 1, y: y + 2 });
    ev.push({ type: 'birdImpact', id: id, bird: b, x, y: y + 1, speed: 14 });
    ev.push({ type: 'birdRemoved', id: id++, bird: b, x, y: y + 0.5 });
    ev.push({ type: 'birdBonus', bird: b, x: x - 2, y, points: 10000 });
    ev.push({ type: 'score', points: 10000, x: x - 2, y, kind: 'bonus' });
  }
  for (const p of PIG_TYPES) {
    ev.push({ type: 'pigDamaged', id: id, pig: p, x: x + 2, y: y + 1, stage: 1, helmetLost: p === 'helmet' });
    ev.push({ type: 'pigDestroyed', id: id++, pig: p, x: x + 2, y: y + 1, radius: 0.6, points: 5000 });
    ev.push({ type: 'score', points: 5000, x: x + 2, y: y + 1, kind: 'pig' });
  }
  ev.push({ type: 'tntDestroyed', id: id++, x: x + 3, y: y + 0.5, points: 0 });
  ev.push({ type: 'score', points: 2000, x: x + 3, y: y + 0.5, kind: 'tnt' });
  ev.push({ type: 'explosion', x: x + 3, y: y + 0.5, radius: EXPLOSION.tnt.R, source: 'tnt' });
  ev.push({ type: 'explosion', x: x - 2, y: y + 1, radius: EXPLOSION.bomb.R, source: 'bomb' });
  ev.push({ type: 'explosion', x, y: y + 2, radius: EXPLOSION.egg.R, source: 'egg' });
  return ev;
}

/**
 * Допечь ступени размеров спрайтов эффектов: для каждого спрайта, уже запечённого хоть раз, — все ступени P от
 * самой мелкой (4 px) до наибольшей встреченной + 2; для остальных — мелкие ступени (до 32 px). Ключ кэша атласа — id · 32 + ci, P = ⌈2^(ci/2)⌉
 * (src/render/fx/sprites.ts); список ключей кэш наружу не отдаёт — читаем приватное поле (патч Fx — в отчёте сборки).
 */
function fillSizeSteps(): void {
  const cache = (FX_SPRITES as unknown as { cache?: unknown }).cache;
  if (!(cache instanceof Map)) return;
  const span = new Map<number, [number, number]>();
  for (const key of cache.keys()) {
    if (typeof key !== 'number') continue;
    const id = Math.floor(key / 32);
    const ci = key % 32;
    const r = span.get(id);
    if (!r) span.set(id, [ci, ci]);
    else {
      r[0] = Math.min(r[0], ci);
      r[1] = Math.max(r[1], ci);
    }
  }
  const bake = (id: number, ci: number): void => {
    FX_SPRITES.get(id, 2 ** ((ci - 0.5) / 2)); // get() сама ограничит ступень снизу (P ≥ 4) и сверху (maxP спрайта)
  };
  for (const [id, [, hi]] of span) for (let ci = 4; ci <= Math.max(hi + 2, SMALL_CI_MAX); ci++) bake(id, ci);
  // все остальные спрайты (их id идут подряд с 0) — мелкие ступени: дёшево, а любое допекание в игре меняет страницу
  // атласа и стоит её копирования (≈ 5–25 мс в кадре)
  for (let id = 0; id < 4096; id++) {
    if (span.has(id)) continue;
    try {
      for (let ci = 4; ci <= SMALL_CI_MAX; ci++) bake(id, ci);
    } catch {
      break; // спрайта с таким id нет — дальше тоже
    }
  }
}

/** Мелкие ступени (P ≤ ⌈2^(10/2)⌉ = 32 px) допекаются у всех спрайтов. */
const SMALL_CI_MAX = 10;

/**
 * Проиграть пробные события на каждом масштабе (пикс. устройства на метр) и нарисовать в невидимый холст.
 * gameCtx — игровой холст: в него один раз рисуются страницы атласа (под шторкой). Возвращает время, мс.
 */
export function warmFx(scales: readonly number[], view: ViewInfo, gameCtx?: CanvasRenderingContext2D): number {
  if (typeof document === 'undefined') return 0;
  const t0 = performance.now();
  const ctx = ctx2d(createCanvas(8, 8));
  const fx = new Fx();
  const seen = new Set<number>();
  for (const s of scales) {
    if (!(s > 0) || !Number.isFinite(s)) continue;
    const key = Math.round(s * 4);
    if (seen.has(key)) continue;
    seen.add(key);
    const v: ViewInfo = { ...view, scale: s, camX: 0, camY: 4, time: 0 };
    fx.clear();
    for (const e of sampleEvents(0, 1)) fx.handle(e);
    // жизнь частиц ~0.3–2 с: размеры дыма и огня растут со временем — несколько моментов
    for (let i = 0; i < 14; i++) {
      fx.update(0.1);
      fx.draw(ctx, v);
      fx.drawFlash(ctx, v);
    }
    fx.takeShake();
  }
  fx.clear();
  fillSizeSteps();
  // те же эффекты — пару кадров в игровой холст (под шторкой; следующий кадр игры его перерисует): загрузка страниц
  // атласа в GPU и первые смешивания 'lighter' (компиляция шейдеров) случаются сейчас, а не на первом взрыве
  if (gameCtx && scales.length > 0) {
    const v: ViewInfo = { ...view, scale: scales[0], camX: 0, camY: 4, time: 0 };
    for (const e of sampleEvents(0, 1)) fx.handle(e);
    for (let i = 0; i < 3; i++) {
      fx.update(0.12);
      fx.draw(gameCtx, v);
      fx.drawFlash(gameCtx, v);
    }
    gameCtx.setTransform(1, 0, 0, 1, 0, 0);
    gameCtx.globalAlpha = 1;
    gameCtx.globalCompositeOperation = 'source-over';
    for (const page of FX_SPRITES.pageCanvases) gameCtx.drawImage(page, 0, 0);
    fx.clear();
  }
  return performance.now() - t0;
}
