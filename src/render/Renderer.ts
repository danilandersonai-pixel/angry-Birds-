// Кадр игры строго по слоям (спецификация §8, 04 §2, 00 §1.14):
//   фон (небо + параллакс) → ствол и задний рог рогатки (до рельефа: основание «вкопано») → рельеф → декор уровня →
//   след полёта → задняя резинка → тела: блоки → TNT → свиньи → яйца → птицы → очередь птиц → подсказка прицела →
//   птица в кармашке → кармашек → передняя резинка → передний рог → эффекты → передний план → вспышка экрана.
// Всё — в пикселях устройства (ViewInfo.scale уже содержит dpr). Положения тел интерполируются между шагами
// физики по alpha (px/py/pangle → x/y/angle). Рендер-сторона анимаций (не влияют на симуляцию, Math.random можно):
// моргание птиц и свиней, подпрыгивания очереди, сальто прыжка в кармашек, мигание и пульс Бомба перед
// автоподрывом (отсчёт от birdImpact), поворот спрайта летящей птицы по скорости, лёгкий squash при ударе.
// Только визуальные поправки к позициям ядра (плейтест №1): очередь сжимается к рогатке, если не влезает в кадр
// (FrameParams.queueMinX); птица в кармашке в покое приподнята, чтобы передний рог не закрывал мелких птиц
// (кармашек и резинки — вместе с ней); на обучении кармашек тянется вслед за призрачной рукой.

import { ABILITY, AIM_ASSIST, BIRDS, LAUNCH, SLINGSHOT, TIMING } from '../config/constants';
import type { BirdPose, EntityView, PigPose, QueuedBirdView, SlingshotView, TrailPoint } from '../core/api';
import type { GameEvent, SessionState } from '../core/events';
import type { BirdType, LevelDef, ThemeId, Vec } from '../core/types';
import { createCanvas, ctx2d } from './canvas';
import { DECOR_SIZE } from './decor';
import { drawTrail, type Fx } from './fx/Fx';
import { buildGround, type GroundFn } from './fx/ground';
import type { Sprite } from './sprites/api';
import { Background, drawForeground, drawTerrain, prewarmTerrain } from './sprites/background';
import { drawBand, drawPouch } from './sprites/slingshot';
import {
  SLING_BACK,
  SLING_FRONT,
  SpriteCache,
  birdKey,
  birdMake,
  blockKey,
  blockMake,
  blockVariant,
  decorKey,
  decorMake,
  decorVariant,
  eggKey,
  eggMake,
  levelWarmList,
  pigKey,
  pigMake,
  slingMake,
  tntKey,
  tntMake,
} from './SpriteCache';
import type { ViewInfo } from './view';

/** То, что рендер читает у сцены (GameSession подходит как есть; MenuScene — тоже сессия). */
export interface SceneSource {
  readonly level: LevelDef;
  readonly state: SessionState;
  /** Время сессии, с. */
  readonly time: number;
  /** Сколько птиц ещё не запущено (включая заряженную). */
  readonly birdsLeft: number;
  entities(): Iterable<EntityView>;
  queue(): readonly QueuedBirdView[];
  slingshot(): SlingshotView;
  trail(): readonly TrailPoint[];
  predictTrajectory(n: number): Vec[];
}

export interface FrameParams {
  readonly view: ViewInfo;
  /** Доля шага физики для интерполяции, 0..1. */
  readonly alpha: number;
  /** Реальный dt кадра для рендер-анимаций, с (0 — пауза). */
  readonly dt: number;
  /** Пунктир траектории при прицеливании. */
  readonly aimAssist?: boolean;
  readonly fx?: Fx | null;
  /** Обучение прицелу (07 §10.5): время в цикле 2.0 с, −1 — нет. */
  readonly tutorial?: number;
  /** Левее этой точки (мир, м) очередь птиц не рисуется: раскладка сжимается к рогатке (не сильнее QUEUE_K_MIN). */
  readonly queueMinX?: number;
}

/** Сжатие очереди при отрисовке: расстояния от первого места — не меньше этой доли раскладки ядра. */
export const QUEUE_K_MIN = 0.5;
/** Под такое сжатие камера оставляет место слева от рогатки. */
export const QUEUE_K_PLAN = 0.62;

/**
 * Раскладка очереди ядра (BirdQueue.layout) для всех птиц уровня: span — от первого места (основание − QUEUE_X0)
 * до последнего, м; rLast — радиус последней птицы.
 */
export function queueSpan(birds: readonly BirdType[]): { span: number; rLast: number } {
  let span = 0;
  for (let i = 1; i < birds.length; i++) {
    span += Math.max(SLINGSHOT.QUEUE_DX, BIRDS[birds[i - 1]].radius + BIRDS[birds[i]].radius + LAUNCH.QUEUE_GAP);
  }
  return { span, rLast: birds.length > 0 ? BIRDS[birds[birds.length - 1]].radius : 0 };
}

/** Визуальный верх переднего рога (обмотка выше крепления резинки), от основания рогатки, м. */
const FRONT_PRONG_TOP = SLINGSHOT.PRONG_FRONT.y + 0.14;

/** Насколько приподнять птицу в кармашке в покое: центр не ниже верха переднего рога − 0.3 r. */
export function pocketLift(type: BirdType | null): number {
  if (!type) return 0;
  return Math.max(0, FRONT_PRONG_TOP - 0.3 * BIRDS[type].radius - SLINGSHOT.ANCHOR.y);
}

/** Толщина резинки, м: в покое → при полном натяжении; не тоньше BAND_MIN_CSS CSS-пикселей. */
const BAND_REST_M = 0.17;
const BAND_FULL_M = 0.12;
const BAND_MIN_CSS = 4;

/** Визуальное состояние кармашка в кадре (позиция ядра + подъём покоя + тяга руки обучения). */
interface VisSling {
  pocket: Vec;
  power: number;
  /** Текущий подъём покоя, м (для бонусной птицы в кармашке). */
  lift: number;
}

const TAU = Math.PI * 2;
const QUARTER = Math.PI / 2;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeInOutCubic = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
/** Гладкая ступенька 0..1 (smoothstep) по аргументу, обрезанному в [0, 1]. */
const smooth01 = (t: number): number => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/** Тяга кармашка на обучении (07 §10.5, цикл 2.0 с): 0.9 с к цели (inOutCubic), держит до 1.2 с, отпускание за 0.1 с. */
function tutorPull(t: number): number {
  if (t < 1.2) return easeInOutCubic(clamp(t / 0.9, 0, 1));
  return Math.max(0, 1 - (t - 1.2) / 0.1);
}

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return a + d * t;
}

function wrapPi(a: number): number {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

// ───────────────────────── пул фонов (тяжёлые кэши полос — не больше двух тем) ─────────────────────────

const bgPool = new Map<ThemeId, Background>();
const BG_POOL_MAX = 2;

/** Фон темы из общего пула (меню и игра делят кэши полос). */
export function backgroundFor(theme: ThemeId): Background {
  let bg = bgPool.get(theme);
  if (bg) {
    bgPool.delete(theme);
    bgPool.set(theme, bg);
    return bg;
  }
  bg = new Background(theme);
  bgPool.set(theme, bg);
  while (bgPool.size > BG_POOL_MAX) {
    const first = bgPool.keys().next().value as ThemeId;
    bgPool.delete(first);
  }
  return bg;
}

// ───────────────────────── состояние рендер-анимаций ─────────────────────────

interface Blink {
  next: number;
  until: number;
}

interface Squash {
  x: number;
  v: number;
  /** Ось сжатия на экране, рад. */
  axis: number;
  k: number;
  c: number;
}

interface FlightAngle {
  vis: number;
  mode: 'vel' | 'phys';
  offset: number;
}

interface Hop {
  wait: number;
  t: number;
  /** Пружина приземления: 1 — без сжатия. */
  sq: number;
  sqv: number;
}

/** Подпрыгивания в очереди (02 §8.1): высота в радиусах, сжатие при приземлении, множитель интервала. */
const HOP_STYLE: Record<BirdType, { h: number; squash: number; every: number }> = {
  red: { h: 0.35, squash: 0.85, every: 1 },
  blues: { h: 0.35, squash: 0.85, every: 0.9 },
  chuck: { h: 0.35, squash: 0.85, every: 0.6 },
  bomb: { h: 0.2, squash: 0.78, every: 1.1 },
  matilda: { h: 0.3, squash: 0.85, every: 1 },
  hal: { h: 0.35, squash: 0.85, every: 0.9 },
  terence: { h: 0, squash: 1, every: 1 },
  silver: { h: 0.35, squash: 0.85, every: 0.8 },
};

const HOP_TIME = 0.35;
const FLY_CLAMP = (35 * Math.PI) / 180;
const FLY_TAU = 0.08;
const FUSE = ABILITY.BOMB.FUSE;
const FUSE_WARN = ABILITY.BOMB.WARN;
const BOMB_TINT = '#FF4A1C';

export class Renderer {
  readonly cache: SpriteCache;
  private level: LevelDef | null = null;
  private bg: Background | null = null;
  private readonly blinks = new Map<number, Blink>();
  private readonly squash = new Map<number, Squash>();
  private readonly flight = new Map<number, FlightAngle>();
  private readonly fuse = new Map<number, number>();
  private readonly lastPos = new Map<number, { x: number; y: number; vx: number; vy: number }>();
  private readonly hops = new Map<number, Hop>();
  private readonly bonusAt: Vec[] = [];
  private readonly tinted = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  private loadingSince = 0;
  /** Высота поверхности рельефа под x — для контактных теней. */
  private ground: GroundFn = () => 0;
  private animT = 0;
  // сжатие очереди: x' = x0 − k·(x0 − x) для мест левее первого (x0 — первое место очереди)
  private queueK = 1;
  private queueX0 = 0;
  private queueFor: { level: LevelDef | null; minX: number | undefined } = { level: null, minX: undefined };
  private vis: VisSling = { pocket: { x: 0, y: 0 }, power: 0, lift: 0 };
  // переиспользуемые списки тел по слоям
  private readonly lBlocks: EntityView[] = [];
  private readonly lTnt: EntityView[] = [];
  private readonly lPigs: EntityView[] = [];
  private readonly lEggs: EntityView[] = [];
  private readonly lBirds: EntityView[] = [];
  private loadedEnt: EntityView | null = null;
  /** Отрисовано тел в последнем кадре (для отладки). */
  drawn = 0;
  /** Время фаз кадра, мс (EMA): фон, рельеф, тела, эффекты, передний план. */
  readonly profile = { bg: 0, terrain: 0, bodies: 0, fx: 0, fg: 0 };
  private pt = 0;
  private mark(k: keyof Renderer['profile']): void {
    const t = performance.now();
    this.profile[k] = this.profile[k] * 0.9 + (t - this.pt) * 0.1;
    this.pt = t;
  }

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    cache?: SpriteCache,
  ) {
    this.cache = cache ?? new SpriteCache();
  }

  /** Новый уровень (или сцена меню): фон темы, рельеф, декор; рендер-анимации с нуля. */
  setLevel(level: LevelDef): void {
    this.level = level;
    this.bg = backgroundFor(level.theme);
    this.ground = buildGround(level.terrain);
    this.resetAnim();
  }

  /** Рестарт уровня: забыть моргания, фитили, прыжки, бонусы. */
  resetAnim(): void {
    this.blinks.clear();
    this.squash.clear();
    this.flight.clear();
    this.fuse.clear();
    this.lastPos.clear();
    this.hops.clear();
    this.bonusAt.length = 0;
    this.loadingSince = 0;
    this.queueFor = { level: null, minX: undefined };
  }

  /**
   * Точка ядра (место очереди или кармашек в покое) → где она нарисована: для эффектов бонуса птиц,
   * чтобы искры и число появлялись на нарисованной птице.
   */
  mapQueuePoint(x: number, y: number): Vec {
    const a = this.level?.slingshot;
    if (a && Math.abs(x - a.x) < 0.05 && Math.abs(y - a.y) < 0.05) return { x, y: y + this.vis.lift };
    return this.queuePos(x, y);
  }

  /** Место очереди ядра → место отрисовки (сжатие к рогатке, высота — от рельефа под новым x). */
  private queuePos(x: number, y: number): Vec {
    if (this.queueK >= 1 || x >= this.queueX0) return { x, y };
    const nx = this.queueX0 - (this.queueX0 - x) * this.queueK;
    const g0 = this.ground(x);
    const g1 = this.ground(nx);
    return { x: nx, y: Number.isFinite(g0) && Number.isFinite(g1) ? y - g0 + g1 : y };
  }

  /** Пересчитать сжатие очереди (смена уровня или границы кадра). */
  private updateQueueK(level: LevelDef, minX: number | undefined, baseX: number): void {
    if (this.queueFor.level === level && this.queueFor.minX === minX) return;
    this.queueFor = { level, minX };
    this.queueX0 = baseX - SLINGSHOT.QUEUE_X0;
    const { span, rLast } = queueSpan(level.birds);
    this.queueK = minX === undefined || span < 1e-6 ? 1 : clamp((this.queueX0 - minX - rLast) / span, QUEUE_K_MIN, 1);
  }

  get background(): Background | null {
    return this.bg;
  }

  /** Список прогрева спрайтов уровня при масштабах (пикс. устройства на метр). */
  warmList(scales: readonly number[], entities?: Iterable<EntityView>) {
    return this.level ? levelWarmList(this.level, scales, entities) : [];
  }

  /** Прогреть фон и рельеф под вид (экран загрузки уровня). */
  prewarmWorld(view: ViewInfo): void {
    if (!this.level || !this.bg) return;
    this.bg.prewarm(view);
    prewarmTerrain(this.level.terrain, this.level.theme);
  }

  /** События кадра: фитиль Бомба, сжатие при ударе, прыжок в кармашек, бонусные птицы. */
  handle(e: GameEvent, time: number): void {
    switch (e.type) {
      case 'birdImpact': {
        if (e.bird === 'bomb' && !this.fuse.has(e.id)) this.fuse.set(e.id, time);
        const p = this.lastPos.get(e.id);
        // ось сжатия — от центра птицы к точке удара (экранный угол)
        const axis = p ? Math.atan2(-(e.y - p.y), e.x - p.x) : QUARTER;
        const s = clamp(e.speed / 12, 0, 1);
        this.squash.set(e.id, { x: 1 - 0.28 * s, v: 0, axis, k: 420, c: 22 });
        break;
      }
      case 'birdLaunched':
        // выстрел: 0.1 с растяжение по скорости ×1.2 → пружина (02 §8.2); ось — по скорости при первой отрисовке
        this.squash.set(e.id, { x: 1.2, v: 0, axis: NaN, k: 420, c: 22 });
        break;
      case 'ability':
        this.fuse.delete(e.id);
        break;
      case 'pigDamaged':
        this.squash.set(e.id, { x: 1 - 0.22 * 0.7, v: 0, axis: QUARTER, k: 380, c: 20 });
        break;
      case 'stateChanged':
        if (e.to === 'loading') this.loadingSince = time;
        break;
      case 'birdBonus':
        this.bonusAt.push({ x: e.x, y: e.y });
        break;
      case 'birdRemoved':
        this.flight.delete(e.id);
        this.fuse.delete(e.id);
        break;
      default:
        break;
    }
  }

  // ───────────────────────── кадр ─────────────────────────

  render(src: SceneSource, p: FrameParams): void {
    const ctx = this.ctx;
    const v = p.view;
    const level = this.level ?? src.level;
    if (!this.bg) this.setLevel(level);
    const dt = Math.max(0, Math.min(0.1, p.dt));
    this.animT += dt;
    this.cache.beginFrame();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;

    // 1. небо и параллакс
    this.pt = performance.now();
    this.bg!.draw(ctx, v);
    this.resetCtx();
    this.mark('bg');
    // 2. ствол и задний рог — до рельефа
    const sl = src.slingshot();
    const baseX = sl.anchor.x - SLINGSHOT.ANCHOR.x;
    const baseY = sl.anchor.y - SLINGSHOT.ANCHOR.y;
    this.updateQueueK(level, p.queueMinX, baseX);
    const vis = this.visualSling(src, sl, p.tutorial ?? -1);
    const back = this.cache.get(SLING_BACK, v.scale, slingMake('back'));
    if (back) this.blit(back, baseX, baseY, 0, v);
    // 3. рельеф
    drawTerrain(ctx, level.terrain, level.theme, v);
    this.resetCtx();
    this.mark('terrain');
    // 4. декор
    this.drawDecor(level, v);
    // 5. след
    drawTrail(ctx, v, src.trail());
    this.resetCtx();

    // разложить тела по слоям
    const loadedId = this.sortEntities(src, sl);
    // 6. задняя резинка (до тел — она за птицей)
    const pouch = this.pouchGeometry(sl.anchor, vis.pocket, loadedId !== null ? this.loadedRadius(sl) : SLINGSHOT.POUCH_HALF);
    const thick = Math.max(BAND_MIN_CSS * v.dpr, (BAND_REST_M + (BAND_FULL_M - BAND_REST_M) * clamp(vis.power, 0, 1)) * v.scale);
    this.band(v, baseX + SLINGSHOT.PRONG_BACK.x, baseY + SLINGSHOT.PRONG_BACK.y, pouch.back, thick);
    // 7. тела
    ctx.imageSmoothingQuality = 'low';
    this.drawn = 0;
    for (const e of this.lBlocks) this.drawBlock(e, v, p.alpha);
    for (const e of this.lTnt) this.drawTnt(e, v, p.alpha);
    this.contactShadows(v, p.alpha);
    for (const e of this.lPigs) this.drawPig(e, v, p.alpha, dt);
    for (const e of this.lEggs) this.drawEgg(e, v, p.alpha);
    for (const e of this.lBirds) this.drawFlyingBird(e, v, p.alpha, dt, src.time);
    // 8. очередь
    this.drawQueue(src, v, dt);
    // 9. подсказка прицела
    if (p.aimAssist && src.state === 'aiming') this.drawAimDots(src, v);
    // 10. птица в кармашке, кармашек, передняя резинка, передний рог
    if (loadedId !== null && sl.loaded && !this.bonusHidden(sl.pocket.x, sl.pocket.y)) this.drawLoadedBird(src, sl, vis, loadedId, v, dt);
    this.drawPouchAt(v, vis.pocket, pouch, thick);
    this.band(v, baseX + SLINGSHOT.PRONG_FRONT.x, baseY + SLINGSHOT.PRONG_FRONT.y, pouch.front, thick);
    const front = this.cache.get(SLING_FRONT, v.scale, slingMake('front'));
    if (front) this.blit(front, baseX, baseY, 0, v);
    // маркер птицы выше кадра
    this.drawOffscreenMarkers(v);
    ctx.imageSmoothingQuality = 'high';
    this.resetCtx();
    this.mark('bodies');
    // 11. эффекты
    p.fx?.draw(ctx, v);
    this.resetCtx();
    this.mark('fx');
    // 12. передний план
    drawForeground(ctx, level.theme, v);
    this.resetCtx();
    if (p.tutorial !== undefined && p.tutorial >= 0 && sl.loaded) this.drawGhostHand(v, vis.pocket, p.tutorial);
    // 13. вспышка экрана
    p.fx?.drawFlash(ctx, v);
    this.resetCtx();
    this.mark('fg');
    this.updateAnims(dt);
  }

  private resetCtx(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
  }

  /** Тела по слоям; возвращает id птицы в кармашке (или null) — она рисуется вместе с рогаткой. */
  private sortEntities(src: SceneSource, sl: SlingshotView): number | null {
    this.lBlocks.length = this.lTnt.length = this.lPigs.length = this.lEggs.length = this.lBirds.length = 0;
    this.loadedEnt = null;
    for (const e of src.entities()) {
      if (e.kind === 'block') this.lBlocks.push(e);
      else if (e.kind === 'tnt') this.lTnt.push(e);
      else if (e.kind === 'pig') this.lPigs.push(e);
      else if (e.kind === 'egg') this.lEggs.push(e);
      else if (e.kind === 'bird') this.lBirds.push(e);
    }
    if (!sl.loaded) return null;
    let bi = -1;
    let best = 0.06;
    for (let i = 0; i < this.lBirds.length; i++) {
      const e = this.lBirds[i];
      const d = Math.hypot(e.x - sl.pocket.x, e.y - sl.pocket.y);
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (bi < 0) return null;
    this.loadedEnt = this.lBirds[bi];
    this.lBirds.splice(bi, 1);
    return this.loadedEnt.id;
  }

  private loadedRadius(sl: SlingshotView): number {
    const r = sl.loaded ? BIRDS[sl.loaded].radius : 0.45;
    return Math.max(SLINGSHOT.POUCH_HALF, r * 0.84);
  }

  /**
   * Где рисовать кармашек: позиция ядра плюс подъём покоя (вес гаснет с оттяжкой, в прыжке растёт с ним) и, на
   * обучении, тяга вслед за призрачной рукой. Резинки, кармашек и птица в нём рисуются от этой точки.
   */
  private visualSling(src: SceneSource, sl: SlingshotView, tutorial: number): VisSling {
    const st = src.state;
    let type: BirdType | null = sl.loaded;
    let w = 0;
    let power = clamp(sl.power, 0, 1);
    let px = sl.pocket.x;
    let py = sl.pocket.y;
    if (st === 'loading') {
      type = src.queue()[0]?.type ?? null;
      w = easeInOutSine(clamp((src.time - this.loadingSince) / TIMING.BIRD_HOP_TIME, 0, 1));
    } else if (type) {
      const d = Math.hypot(px - sl.anchor.x, py - sl.anchor.y);
      w = 1 - smooth01((d - 0.05) / 0.55);
    }
    if (tutorial >= 0 && type && st === 'ready') {
      const k = tutorPull(tutorial);
      px += -1.6 * k;
      py += -0.5 * k;
      power = (Math.hypot(1.6, 0.5) * k) / LAUNCH.R_MAX;
      w *= 1 - smooth01(k * 1.2);
    }
    const lift = pocketLift(type) * w;
    const vis = this.vis;
    vis.pocket = { x: px, y: py + lift };
    vis.power = power;
    vis.lift = lift;
    return vis;
  }

  /** Края кармашка (мир): задний край — слева от направления на ANCHOR + (0, 0.5), передний — справа (blocks-report). */
  private pouchGeometry(anchor: Vec, pocket: Vec, half: number): { back: Vec; front: Vec; ux: number; uy: number; half: number } {
    const px = pocket.x;
    const py = pocket.y;
    const dx = anchor.x - px;
    const dy = anchor.y + 0.5 - py;
    const d = Math.hypot(dx, dy);
    const ux = d > 1e-6 ? dx / d : 0;
    const uy = d > 1e-6 ? dy / d : 1;
    return { back: { x: px - uy * half, y: py + ux * half }, front: { x: px + uy * half, y: py - ux * half }, ux, uy, half };
  }

  private band(v: ViewInfo, x1: number, y1: number, to: Vec, thick: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBand(ctx, this.sx(v, x1), this.sy(v, y1), this.sx(v, to.x), this.sy(v, to.y), thick);
  }

  private drawPouchAt(v: ViewInfo, pocket: Vec, g: { ux: number; uy: number; half: number }, thick: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // экранный угол направления на ANCHOR (Y вниз)
    const ang = Math.atan2(-g.uy, g.ux);
    drawPouch(ctx, this.sx(v, pocket.x), this.sy(v, pocket.y), ang, g.half * v.scale, thick * 0.85);
  }

  // ───────────────────────── тела ─────────────────────────

  private interp(e: EntityView, a: number): { x: number; y: number; ang: number } {
    return { x: e.px + (e.x - e.px) * a, y: e.py + (e.y - e.py) * a, ang: angleLerp(e.pangle, e.angle, a) };
  }

  private drawBlock(e: EntityView, v: ViewInfo, a: number): void {
    if (!e.material) return;
    const p = this.interp(e, a);
    if (this.culled(v, p.x, p.y, e.radius + 0.15)) return;
    const variant = blockVariant(e.seed);
    let spr: Sprite | null = null;
    // стадия повреждений: если новую ещё не успели сгенерировать (бюджет кадра) — рисуем предыдущую
    for (let st = e.damageStage; st >= 0 && !spr; st--) {
      spr = this.cache.get(blockKey(e.material, e.shape, e.w, e.h, st, variant), v.scale, blockMake(e.material, e.shape, e.w, e.h, st, variant), st === 0 ? 'must' : 'try');
    }
    if (!spr) return;
    let ang = p.ang;
    const snap = Math.round(ang / QUARTER) * QUARTER;
    if (Math.abs(ang - snap) < 0.003) ang = snap;
    this.blit(spr, p.x, p.y, ang, v);
  }

  private drawTnt(e: EntityView, v: ViewInfo, a: number): void {
    const p = this.interp(e, a);
    if (this.culled(v, p.x, p.y, e.radius + 0.15)) return;
    const spr = this.cache.get(tntKey(e.w), v.scale, tntMake(e.w));
    if (!spr) return;
    let ang = p.ang;
    const snap = Math.round(ang / QUARTER) * QUARTER;
    if (Math.abs(ang - snap) < 0.003) ang = snap;
    this.blit(spr, p.x, p.y, ang, v);
  }

  private drawEgg(e: EntityView, v: ViewInfo, a: number): void {
    const p = this.interp(e, a);
    if (this.culled(v, p.x, p.y, e.radius * 1.5)) return;
    const spr = this.cache.get(eggKey(e.radius), v.scale, eggMake(e.radius));
    if (spr) this.blit(spr, p.x, p.y, p.ang, v);
  }

  private drawPig(e: EntityView, v: ViewInfo, a: number, dt: number): void {
    if (!e.pigType) return;
    const p = this.interp(e, a);
    this.lastPos.set(e.id, { x: p.x, y: p.y, vx: e.vx, vy: e.vy });
    if (this.culled(v, p.x, p.y, e.radius * 1.6)) return;
    let pose: PigPose = e.pigPose ?? 'idle';
    if (pose === 'idle' && this.blinking(e.id, 2, 6, 0.15)) pose = 'blink';
    const stage = clamp(Math.round(e.damageStage), 0, 2);
    const helmet = e.hasHelmet === true;
    let spr = this.cache.get(pigKey(e.pigType, pose, stage, helmet), v.scale, pigMake(e.pigType, pose, stage, helmet, e.radius), 'try');
    if (!spr) spr = this.cache.get(pigKey(e.pigType, 'idle', stage, helmet), v.scale, pigMake(e.pigType, 'idle', stage, helmet, e.radius));
    if (!spr) return;
    let sy = 1;
    let sx = 1;
    if (pose === 'laugh') {
      const k = Math.sin(this.animT * TAU * 6);
      sy = 1 + 0.06 * k;
      sx = 1 - 0.03 * k;
    }
    const sq = this.squash.get(e.id);
    this.updateSquash(e.id, sq, dt);
    this.drawWithSquash(spr, p.x, p.y, p.ang, v, sq, sx, sy);
  }

  /** Летящая (или лежащая после удара) птица: поза ядра + моргание, угол по скорости в свободном полёте, фитиль Бомба. */
  private drawFlyingBird(e: EntityView, v: ViewInfo, a: number, dt: number, time: number): void {
    if (!e.birdType) return;
    const p = this.interp(e, a);
    this.lastPos.set(e.id, { x: p.x, y: p.y, vx: e.vx, vy: e.vy });
    let pose: BirdPose = e.birdPose ?? 'fly';
    if (pose === 'idle' && this.blinking(e.id, 2, 5, e.birdType === 'terence' ? 0.25 : 0.12)) pose = 'blink';
    const ang = this.flightAngle(e, p.ang, pose, dt);
    if (this.culled(v, p.x, p.y, e.radius * 2)) return;
    const spr = this.cache.get(birdKey(e.birdType, pose), v.scale, birdMake(e.birdType, pose));
    if (!spr) return;
    const sq = this.squash.get(e.id);
    if (sq && Number.isNaN(sq.axis)) sq.axis = Math.atan2(-e.vy, e.vx);
    this.updateSquash(e.id, sq, dt);
    // фитиль Бомба: последние 1.5 с — тинт #FF4A1C α 0 ↔ 0.7 с частотой 2 → 10 Гц и пульс масштаба 1 ↔ 1.10
    let tint = 0;
    let pulse = 1;
    const f0 = this.fuse.get(e.id);
    if (e.birdType === 'bomb' && f0 !== undefined && !e.abilityUsed) {
      const t = time - f0;
      const tau = t - (FUSE - FUSE_WARN);
      if (tau > 0 && t < FUSE + 0.2) {
        const phase = 2 * tau + (4 / FUSE_WARN) * tau * tau; // ∫(2 + 8·τ/1.5)dτ
        const s = 0.5 - 0.5 * Math.cos(TAU * phase);
        tint = 0.7 * s;
        pulse = 1 + 0.1 * s;
      }
    }
    this.drawWithSquash(spr, p.x, p.y, ang, v, sq, pulse, pulse);
    if (tint > 0.01) {
      const t = this.tintOf(spr.canvas);
      this.ctx.globalAlpha = tint;
      this.ctx.drawImage(t, -spr.ox, -spr.oy);
      this.ctx.globalAlpha = 1;
    }
  }

  /** Угол спрайта: в свободном полёте — по скорости (±35°, τ 0.08 с), иначе — из физики (с плавной стыковкой). */
  private flightAngle(e: EntityView, phys: number, pose: BirdPose, dt: number): number {
    let st = this.flight.get(e.id);
    const spinning = Math.abs(wrapPi(e.angle - e.pangle)) > 1e-4;
    const velMode = pose === 'fly' && !spinning;
    if (!st) {
      st = { vis: velMode ? clamp(Math.atan2(e.vy, e.vx), -FLY_CLAMP, FLY_CLAMP) : phys, mode: velMode ? 'vel' : 'phys', offset: 0 };
      this.flight.set(e.id, st);
    }
    if (velMode) {
      const target = Math.hypot(e.vx, e.vy) > 0.5 ? clamp(Math.atan2(e.vy, e.vx), -FLY_CLAMP, FLY_CLAMP) : st.vis;
      if (st.mode !== 'vel') st.mode = 'vel';
      st.vis = angleLerp(st.vis, target, 1 - Math.exp(-dt / FLY_TAU));
      return st.vis;
    }
    if (st.mode === 'vel') {
      // переход на физику: запомнить разницу и погасить её за ~0.1 с
      st.mode = 'phys';
      st.offset = wrapPi(st.vis - phys);
    }
    st.offset *= Math.exp(-dt / FLY_TAU);
    st.vis = phys + st.offset;
    return st.vis;
  }

  private drawLoadedBird(src: SceneSource, sl: SlingshotView, vis: VisSling, id: number, v: ViewInfo, dt: number): void {
    const type = sl.loaded!;
    const ent = this.loadedEnt;
    const aiming = src.state === 'aiming';
    let pose: BirdPose = aiming ? 'aim' : (ent?.birdPose ?? 'idle');
    if (pose === 'idle' && this.blinking(id, 2, 5, type === 'terence' ? 0.25 : 0.12)) pose = 'blink';
    const spr = this.cache.get(birdKey(type, pose), v.scale, birdMake(type, pose));
    if (!spr) return;
    const t = clamp(vis.power, 0, 1);
    let x = vis.pocket.x;
    let y = vis.pocket.y;
    if (aiming && t > 0.9) {
      const r = BIRDS[type].radius;
      x += Math.sin(this.animT * TAU * 30) * 0.02 * r;
      y += Math.cos(this.animT * TAU * 30 + 1.3) * 0.02 * r;
    }
    const ang = ent ? ent.angle : 0;
    const sq = this.squash.get(id);
    this.updateSquash(id, sq, dt);
    this.drawWithSquash(spr, x, y, ang, v, sq, 1 + 0.15 * t, 1 - 0.08 * t);
  }

  /**
   * Очередь у рогатки: подпрыгивания, моргание; в loading первая птица прыгает в кармашек с сальто.
   * Места ядра сжимаются к рогатке (queueK), рисуем с хвоста: ближняя к рогатке птица — поверх соседки.
   */
  private drawQueue(src: SceneSource, v: ViewInfo, dt: number): void {
    const q = src.queue();
    if (q.length === 0) return;
    const sl = src.slingshot();
    const total = this.level?.birds.length ?? q.length;
    const first = total - src.birdsLeft + (sl.loaded ? 1 : 0);
    const loading = src.state === 'loading';
    const bonus = src.state === 'bonus' || src.state === 'won';
    for (let i = q.length - 1; i >= 0; i--) {
      const qb = q[i];
      if (this.bonusHidden(qb.x, qb.y)) continue;
      const m = this.queuePos(qb.x, qb.y);
      const b = { type: qb.type, radius: qb.radius, x: m.x, y: m.y };
      const gi = first + i;
      const style = HOP_STYLE[b.type];
      let y = b.y;
      let ang = 0;
      let sx = 1;
      let sy = 1;
      const hopping = loading && i === 0;
      if (hopping) {
        const k = clamp((src.time - this.loadingSince) / TIMING.BIRD_HOP_TIME, 0, 1);
        ang = -TAU * easeInOutSine(k);
        // приземление — в приподнятый кармашек
        y += pocketLift(b.type) * easeInOutSine(k);
      } else {
        const h = this.hopState(gi, b.type, bonus);
        if (h.t > 0) {
          const u = h.t / HOP_TIME;
          const hh = (bonus ? 0.6 : style.h) * b.radius;
          y += 4 * hh * u * (1 - u);
        }
        if (h.sq !== 1) {
          sy = h.sq;
          sx = 1 / Math.sqrt(h.sq);
        }
        this.stepHop(h, b.type, dt, bonus);
        // тень на земле
        this.shadow(v, b.x, b.y - b.radius, b.radius * 0.8 * (1 - 0.3 * (y - b.y) / Math.max(0.1, b.radius)));
      }
      if (this.culled(v, b.x, y, b.radius * 2)) continue;
      let pose: BirdPose = 'idle';
      if (this.blinking(-1000 - gi, 2, 5, b.type === 'terence' ? 0.25 : 0.12)) pose = 'blink';
      const spr = this.cache.get(birdKey(b.type, pose), v.scale, birdMake(b.type, pose));
      if (!spr) continue;
      // сжатие от земли: опора — низ птицы
      const yy = y - b.radius * (1 - sy);
      this.blitScaled(spr, b.x, yy, ang, v, sx, sy);
    }
  }

  private hopState(gi: number, type: BirdType, bonus: boolean): Hop {
    let h = this.hops.get(gi);
    if (!h) {
      h = { wait: rand(0.3, 2.5) * HOP_STYLE[type].every, t: 0, sq: 1, sqv: 0 };
      this.hops.set(gi, h);
    }
    if (bonus && h.t === 0 && h.wait > 0.5) h.wait = 0.5 * Math.random();
    return h;
  }

  private stepHop(h: Hop, type: BirdType, dt: number, bonus: boolean): void {
    const style = HOP_STYLE[type];
    if (h.t > 0) {
      h.t += dt;
      if (h.t >= HOP_TIME) {
        h.t = 0;
        h.sq = style.squash;
        h.sqv = 0;
        h.wait = bonus ? 0.5 : rand(1.5, 3.5) * style.every;
      }
    } else if (style.h > 0 || bonus) {
      h.wait -= dt;
      if (h.wait <= 0 && h.sq === 1) h.t = 1e-4;
    }
    if (h.sq !== 1 || h.sqv !== 0) {
      const n = Math.min(60, Math.ceil(dt * 240));
      const st = dt / n;
      for (let i = 0; i < n; i++) {
        h.sqv += (-420 * (h.sq - 1) - 22 * h.sqv) * st;
        h.sq += h.sqv * st;
      }
      h.sq = clamp(h.sq, 0.6, 1.4);
      if (Math.abs(h.sq - 1) < 0.003 && Math.abs(h.sqv) < 0.05) {
        h.sq = 1;
        h.sqv = 0;
      }
    }
  }

  private bonusHidden(x: number, y: number): boolean {
    for (const b of this.bonusAt) if (Math.abs(b.x - x) < 0.3 && Math.abs(b.y - y) < 0.6) return true;
    return false;
  }

  /** Пунктир траектории (00 §1.2, aimAssist 'short'): 10 точек, α 0.7 → 0.1 (у нас чуть плотнее — видно на траве). */
  private drawAimDots(src: SceneSource, v: ViewInfo): void {
    const pts = src.predictTrajectory(AIM_ASSIST.SHORT_STEPS / LAUNCH.PREDICT_STRIDE);
    if (pts.length === 0) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const r0 = Math.max(0.13 * v.scale, 3.5 * v.dpr);
    const a0 = Math.min(1, AIM_ASSIST.ALPHA_FROM + 0.25);
    const a1 = AIM_ASSIST.ALPHA_TO + 0.3;
    ctx.lineWidth = Math.max(1.5 * v.dpr, 0.025 * v.scale);
    ctx.strokeStyle = 'rgba(20,30,40,0.55)';
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < pts.length; i++) {
      const k = pts.length > 1 ? i / (pts.length - 1) : 0;
      ctx.globalAlpha = a0 + (a1 - a0) * k;
      ctx.beginPath();
      ctx.arc(this.sx(v, pts[i].x), this.sy(v, pts[i].y), r0 * (1 - 0.4 * k), 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Призрачная рука обучения (07 §10.5): палец прижимает птицу, за 0.9 с (inOutCubic) тянет к pocket − (1.6, 0.5) м
   * (кармашек, резинки и птица едут следом — см. visualSling), за ним пунктир; держит 0.3 с, «отпускает»
   * (птица щёлкает назад, рука тает 0.2 с), пауза. Цикл 2.0 с. pocket — уже сдвинутый кармашек.
   */
  private drawGhostHand(v: ViewInfo, pocket: Vec, t: number): void {
    const ctx = this.ctx;
    const u = v.dpr * Math.max(0.7, Math.min(1.3, Math.min(v.screenW / v.dpr / 1280, v.screenH / v.dpr / 720)));
    const k = tutorPull(t);
    let alpha = t < 0.15 ? t / 0.15 : 1;
    let scale = t < 0.15 ? 1.15 - t : 1;
    if (t > 1.2) {
      const r = clamp((t - 1.2) / 0.2, 0, 1);
      alpha = 1 - r;
      scale = 1 - 0.15 * r;
    }
    if (alpha <= 0) return;
    // палец там, где птица; при отпускании рука остаётся в конце хода, птица уезжает назад
    const drag = t > 1.2 ? 1 : k;
    const rx = pocket.x + 1.6 * k;
    const ry = pocket.y + 0.5 * k;
    // кончик пальца — у нижнего правого края птицы: рука не закрывает её целиком
    const fx = this.sx(v, rx - 1.6 * drag + 0.22);
    const fy = this.sy(v, ry - 0.5 * drag - 0.2);
    const x0 = this.sx(v, rx);
    const y0 = this.sy(v, ry);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // пунктир хода
    ctx.globalAlpha = 0.75 * alpha;
    for (let i = 1; i <= 6; i++) {
      const q = (i / 7) * drag;
      const px = x0 + (fx - x0) * q;
      const py = y0 + (fy - y0) * q;
      ctx.beginPath();
      ctx.arc(px, py, 4.5 * u, 0, TAU);
      ctx.fillStyle = 'rgba(11,26,43,0.55)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 3 * u, 0, TAU);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
    // круг нажатия
    if (t < 0.35) {
      const r = t / 0.35;
      ctx.globalAlpha = 0.7 * (1 - r) * alpha;
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(fx, fy, (10 + 18 * r) * u, 0, TAU);
      ctx.stroke();
    }
    // рука: кончик пальца в (0, 0), палец вверх; наклон влево, ладонь снизу справа
    const s = u * scale;
    const a = -0.38;
    ctx.setTransform(s * Math.cos(a), s * Math.sin(a), -s * Math.sin(a), s * Math.cos(a), fx, fy);
    const shape = (): void => {
      ctx.beginPath();
      ctx.roundRect(-7, 0, 14, 42, 7);
      ctx.roundRect(-9, 28, 40, 38, 12);
      ctx.moveTo(22, 32);
      ctx.arc(14, 32, 8, 0, TAU);
      ctx.moveTo(29.5, 36);
      ctx.arc(22, 36, 7.5, 0, TAU);
      ctx.moveTo(36, 42);
      ctx.arc(29, 42, 7, 0, TAU);
      ctx.ellipse(-11, 47, 7, 13, 0.45, 0, TAU);
    };
    ctx.globalAlpha = 0.92 * alpha;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#0B1A2B';
    shape();
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    shape();
    ctx.fill();
    // манжета
    ctx.beginPath();
    ctx.roundRect(-5, 62, 36, 14, 5);
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#3FA9E8';
    ctx.fill();
    // ноготь и складка
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(11,26,43,0.45)';
    ctx.beginPath();
    ctx.moveTo(-3.5, 9);
    ctx.quadraticCurveTo(0, 12, 3.5, 9);
    ctx.moveTo(-4, 24);
    ctx.lineTo(4, 24);
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /** Птица выше кадра — маркер у верхней кромки: кружок с птицей и высотой (00 §1.10). */
  private drawOffscreenMarkers(v: ViewInfo): void {
    const top = v.camY + v.screenH / 2 / v.scale;
    for (const e of this.lBirds) {
      if (!e.birdType || e.y - e.radius <= top) continue;
      const ctx = this.ctx;
      const x = clamp(this.sx(v, e.x), 30 * v.dpr, v.screenW - 30 * v.dpr);
      const R = 17 * v.dpr;
      const y = R + 8 * v.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.strokeStyle = 'rgba(11,26,43,0.8)';
      ctx.lineWidth = 2.5 * v.dpr;
      ctx.beginPath();
      ctx.arc(x, y, R, 0, TAU);
      ctx.fill();
      ctx.stroke();
      const spr = this.cache.peek(birdKey(e.birdType, 'fly'), v.scale);
      if (spr) {
        const k = (R * 1.25) / (BIRDS[e.birdType].radius * 2 * spr.ppu);
        ctx.setTransform(k, 0, 0, k, x, y);
        ctx.drawImage(spr.canvas, -spr.ox, -spr.oy);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.font = `900 ${Math.round(12 * v.dpr)}px Rubik, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3 * v.dpr;
      ctx.strokeStyle = '#0B1A2B';
      const txt = `${Math.round(e.y)} м`;
      ctx.strokeText(txt, x, y + R + 3 * v.dpr);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(txt, x, y + R + 3 * v.dpr);
    }
  }

  private drawDecor(level: LevelDef, v: ViewInfo): void {
    const list = level.decor;
    if (!list || list.length === 0) return;
    for (const d of list) {
      const s = d.scale ?? 1;
      const sz = DECOR_SIZE[d.kind];
      if (!sz) continue;
      const cx = d.x;
      const cy = d.y + (sz.h * s) / 2;
      if (this.culled(v, cx, cy, Math.max(sz.w, sz.h) * s * 0.75)) continue;
      const variant = decorVariant(d.x);
      const spr = this.cache.get(decorKey(d.kind, level.theme, variant), v.scale * s, decorMake(d.kind, level.theme, variant));
      if (!spr) continue;
      const k = (v.scale * s) / spr.ppu;
      this.ctx.setTransform(d.flip ? -k : k, 0, 0, k, this.sx(v, d.x), this.sy(v, d.y));
      this.ctx.drawImage(spr.canvas, -spr.ox, -spr.oy);
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Контактные тени (04 §8.9): эллипс под свиньёй или птицей, стоящей (почти) на рельефе. */
  private contactShadows(v: ViewInfo, a: number): void {
    for (const list of [this.lPigs, this.lBirds]) {
      for (const e of list) {
        const x = e.px + (e.x - e.px) * a;
        const y = e.py + (e.y - e.py) * a;
        const gy = this.ground(x);
        if (!Number.isFinite(gy)) continue;
        const gap = y - e.radius - gy;
        if (gap > 0.6 || gap < -0.2) continue;
        this.shadow(v, x, gy, e.radius * 0.85 * (1 - Math.max(0, gap) / 1.2));
      }
    }
  }

  private shadow(v: ViewInfo, x: number, y: number, rx: number): void {
    if (rx <= 0) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(this.sx(v, x), this.sy(v, y) - 0.02 * v.scale, rx * v.scale, rx * 0.22 * v.scale, 0, 0, TAU);
    ctx.fill();
  }

  // ───────────────────────── рисование спрайта ─────────────────────────

  private sx(v: ViewInfo, x: number): number {
    return (x - v.camX) * v.scale + v.screenW / 2;
  }

  private sy(v: ViewInfo, y: number): number {
    return v.screenH / 2 - (y - v.camY) * v.scale;
  }

  private culled(v: ViewInfo, x: number, y: number, r: number): boolean {
    const X = this.sx(v, x);
    const Y = this.sy(v, y);
    const R = r * v.scale;
    return X + R < 0 || X - R > v.screenW || Y + R < 0 || Y - R > v.screenH;
  }

  /** Спрайт в точке мира с поворотом (мир: против часовой). */
  private blit(spr: Sprite, x: number, y: number, ang: number, v: ViewInfo): void {
    const k = v.scale / spr.ppu;
    const X = this.sx(v, x);
    const Y = this.sy(v, y);
    const ctx = this.ctx;
    if (ang === 0) ctx.setTransform(k, 0, 0, k, X, Y);
    else {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      ctx.setTransform(k * c, -k * s, k * s, k * c, X, Y);
    }
    ctx.drawImage(spr.canvas, -spr.ox, -spr.oy);
    this.drawn++;
  }

  /** То же с масштабом в осях спрайта (растяжение птицы на рогатке, сжатие в очереди). */
  private blitScaled(spr: Sprite, x: number, y: number, ang: number, v: ViewInfo, sx: number, sy: number): void {
    const k = v.scale / spr.ppu;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    this.ctx.setTransform(k * sx * c, -k * sx * s, k * sy * s, k * sy * c, this.sx(v, x), this.sy(v, y));
    this.ctx.drawImage(spr.canvas, -spr.ox, -spr.oy);
    this.drawn++;
  }

  /** Спрайт со сжатием вдоль экранной оси (squash & stretch, 02 §8.3) поверх масштаба в осях спрайта. */
  private drawWithSquash(spr: Sprite, x: number, y: number, ang: number, v: ViewInfo, sq: Squash | undefined, sx: number, sy: number): void {
    if (!sq || Math.abs(sq.x - 1) < 0.004) {
      if (sx === 1 && sy === 1) this.blit(spr, x, y, ang, v);
      else this.blitScaled(spr, x, y, ang, v, sx, sy);
      return;
    }
    const k = v.scale / spr.ppu;
    // B = R(−ang)·S(k·sx, k·sy) — спрайт → экран; Q = R(β)·S(along, across)·R(−β) — сжатие по экранной оси β
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const b11 = k * sx * c;
    const b21 = -k * sx * s;
    const b12 = k * sy * s;
    const b22 = k * sy * c;
    const along = sq.x;
    const across = 1 / Math.sqrt(Math.max(0.3, sq.x));
    const cb = Math.cos(-sq.axis);
    const sb = Math.sin(-sq.axis);
    // Q = [cb −sb; sb cb]·diag(al, ac)·[cb sb; −sb cb]
    const q11 = along * cb * cb + across * sb * sb;
    const q12 = (along - across) * cb * sb;
    const q22 = along * sb * sb + across * cb * cb;
    const m11 = q11 * b11 + q12 * b21;
    const m12 = q11 * b12 + q12 * b22;
    const m21 = q12 * b11 + q22 * b21;
    const m22 = q12 * b12 + q22 * b22;
    this.ctx.setTransform(m11, m21, m12, m22, this.sx(v, x), this.sy(v, y));
    this.ctx.drawImage(spr.canvas, -spr.ox, -spr.oy);
    this.drawn++;
  }

  /** Красная копия спрайта (фитиль Бомба), по холсту. */
  private tintOf(src: HTMLCanvasElement): HTMLCanvasElement {
    let t = this.tinted.get(src);
    if (t) return t;
    t = createCanvas(src.width, src.height);
    const c = ctx2d(t);
    c.drawImage(src, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    c.fillStyle = BOMB_TINT;
    c.fillRect(0, 0, t.width, t.height);
    this.tinted.set(src, t);
    return t;
  }

  // ───────────────────────── рендер-анимации ─────────────────────────

  /** Моргание: интервал U(a, b) с, длительность dur с. Ключ — id сущности. */
  private blinking(id: number, a: number, b: number, dur: number): boolean {
    let bl = this.blinks.get(id);
    if (!bl) {
      bl = { next: this.animT + rand(0.5, b), until: 0 };
      this.blinks.set(id, bl);
    }
    if (this.animT >= bl.next) {
      bl.until = this.animT + dur;
      bl.next = this.animT + rand(a, b);
    }
    return this.animT < bl.until;
  }

  /** Пружина сжатия (02 §8.3): подшаги ≤ 1/240 с — явный Эйлер устойчив и на медленных кадрах. */
  private updateSquash(id: number, sq: Squash | undefined, dt: number): void {
    if (!sq || dt <= 0) return;
    const n = Math.min(60, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      sq.v += (-sq.k * (sq.x - 1) - sq.c * sq.v) * h;
      sq.x += sq.v * h;
    }
    sq.x = clamp(sq.x, 0.6, 1.4);
    if (Math.abs(sq.x - 1) < 0.003 && Math.abs(sq.v) < 0.05) this.squash.delete(id);
  }

  private updateAnims(_dt: number): void {
    // чистка состояний исчезнувших тел — раз в ~2 с
    if (this.blinks.size > 400) this.blinks.clear();
  }
}
