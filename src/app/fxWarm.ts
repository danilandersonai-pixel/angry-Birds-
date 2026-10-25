// Прогрев эффектов под шторкой загрузки (плейтест №1, п. 4): первое использование эффектов в игре стоило 30–90 мс —
// атлас частиц допекал ступени размеров (случайный масштаб частиц), страница атласа менялась и копировалась целиком,
// шрифт всплывающих очков растеризовался впервые. Здесь отдельный Fx (атлас общий — FX_SPRITES) проигрывает набор
// пробных событий (удары, разрушения всех материалов, взрывы, перья всех птиц, очки) на масштабах уровня и рисует
// их в крошечный холст; затем каждая страница атласа один раз рисуется в игровой холст (под шторкой — не видно),
// чтобы её загрузка в GPU тоже случилась сейчас.
// Плейтест №2, п. 6: пробные события попадают не во все ступени размеров (случайный размер частиц, рост дыма) —
// первый настоящий взрыв допекал 2–4 крупных спрайта (25–30 мс). Поэтому после проигрыша каждый уже нарисованный
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
  // пыль яйца Матильды (EGG_DUST) — через настоящий путь событий
  ev.push({ type: 'impact', x, y, impulse: 30, a: 'egg', b: 'stone' });
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
 * Допечь ступени размеров спрайтов эффектов: для каждого спрайта, уже нарисованного хоть раз, — все ступени P от
 * самой мелкой (4 px) до наибольшей встреченной + 2; для остальных — мелкие ступени (до 32 px). Любое допекание
 * в игре меняет страницу атласа и стоит её копирования (≈ 5–25 мс в кадре). Публичный API атласа (FxSprites.fillSteps).
 */
function fillSizeSteps(): void {
  FX_SPRITES.fillSteps({ above: 2, smallMax: SMALL_CI_MAX });
}

/** Мелкие ступени (P ≤ ⌈2^(10/2)⌉ = 32 px) допекаются у всех спрайтов. */
const SMALL_CI_MAX = 10;

/**
 * Прогрев по кускам (загрузка уровня уступает кадр между ними — музыка меню под шторкой не голодает): один кусок на
 * масштаб (пиксели устройства на метр), затем допекание ступеней размеров, затем — страницы атласа в игровой холст
 * gameCtx (под шторкой). Пусто, если нет DOM.
 */
export function warmFxSteps(scales: readonly number[], view: ViewInfo, gameCtx?: CanvasRenderingContext2D): Array<() => void> {
  if (typeof document === 'undefined') return [];
  const ctx = ctx2d(createCanvas(8, 8));
  const fx = new Fx();
  const seen = new Set<number>();
  const steps: Array<() => void> = [];
  for (const s of scales) {
    if (!(s > 0) || !Number.isFinite(s)) continue;
    const key = Math.round(s * 4);
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(() => {
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
    });
  }
  steps.push(() => {
    fx.clear();
    fillSizeSteps();
  });
  // те же эффекты — пару кадров в игровой холст (под шторкой; следующий кадр игры его перерисует): загрузка страниц
  // атласа в GPU и первые смешивания 'lighter' (компиляция шейдеров) случаются сейчас, а не на первом взрыве
  // (по кадру эффектов и по странице атласа на кусок: на программном растре каждый — десятки–сотни мс)
  if (gameCtx && scales.length > 0) {
    const v: ViewInfo = { ...view, scale: scales[0], camX: 0, camY: 4, time: 0 };
    for (let i = 0; i < 3; i++) {
      steps.push(() => {
        if (i === 0) for (const e of sampleEvents(0, 1)) fx.handle(e);
        fx.update(0.12);
        fx.draw(gameCtx, v);
        fx.drawFlash(gameCtx, v);
        gameCtx.setTransform(1, 0, 0, 1, 0, 0);
        gameCtx.globalAlpha = 1;
        gameCtx.globalCompositeOperation = 'source-over';
      });
    }
    const pages = FX_SPRITES.pageCanvases.length;
    for (let k = 0; k < pages; k++) {
      steps.push(() => {
        const page = FX_SPRITES.pageCanvases[k];
        if (page) gameCtx.drawImage(page, 0, 0);
      });
    }
    steps.push(() => fx.clear());
  }
  return steps;
}

/**
 * Проиграть пробные события на каждом масштабе (пикс. устройства на метр) и нарисовать в невидимый холст — разом
 * (все куски warmFxSteps подряд). gameCtx — игровой холст: в него один раз рисуются страницы атласа (под шторкой).
 * Возвращает время, мс.
 */
export function warmFx(scales: readonly number[], view: ViewInfo, gameCtx?: CanvasRenderingContext2D): number {
  const t0 = performance.now();
  for (const step of warmFxSteps(scales, view, gameCtx)) step();
  return performance.now() - t0;
}
