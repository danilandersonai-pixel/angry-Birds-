// Параллакс-фон трёх тем: небо, солнце, облака (дрейф), горы/острова, море, холмы, деревья — плюс (реэкспорт)
// рельеф и передний план. Слои — бесшовные горизонтальные полосы, запечённые в offscreen-холсты (построители —
// bgLayers.ts, палитры — themes.ts); каждый кадр — только drawImage и пара заливок (04 §2–§5).
//
// API (контракт спецификации §3, обратно совместим):
//   new Background(theme).draw(ctx, view)          — небо и все слои фона на весь экран (экранные координаты);
//   drawTerrain(ctx, terrain, theme, view, frame?) — рельеф в мире (terrain.ts);
//   drawForeground(ctx, theme, view, groundRef?, frame?) — передний план (foreground.ts);
//   THEME_INFO                                     — название и цвета темы для UI.
// Дополнительно: Background.prewarm(view), prewarmTerrain(terrain, theme, view?) — построить кэши заранее;
// Background.setQuality('high' | 'med' | 'low') — LOW: масштабирование без сглаживания на время зума, меньше памяти;
// Background.memoryBytes / terrainMemoryBytes() — учёт памяти; Background.dispose() / releaseTerrain() — освободить;
// shakeFrame(view, angle) — трансформация кадра для поворота от тряски (рельеф, передний план и тела — в одной).
//
// Математика слоя (04 §3.1): sL = sRef·(s/sRef)^f, sRef = H/15;
//   X = W/2 + (xL − camX·f)·sL;  Y = H/2 − (yL + baseY − camY·f)·sL.
// Ниже полосы непрозрачный слой заливается своим нижним цветом — щелей нет при любом зуме и соотношении сторон.
//
// Производительность:
//  • отсечение перерисовки: у каждого слоя известна «линия непрозрачности»; всё, что ниже линии следующих
//    слоёв, не рисуется (прямоугольный клип), — каждый пиксель закрашивается ≈ 1 раз + прозрачные края силуэтов;
//  • полоса = тайлы шириной ≤ 512 px без прозрачного верха; тайл рисуется целиком, небо — столбец 1×h;
//  • кэш по масштабу: при неподвижном зуме (250 мс) полосы строятся ровно под текущий масштаб и рисуются 1:1
//    (ближние слои — 1:1 и при dpr 2; res < 1 только у гор, моря и островов); пока зум меняется — ближайшая готовая
//    полоса с масштабированием. Полоса достраивается по тайлам: ≤ 0.5 мс в кадре, остальное — в простое (requestIdleCallback);
//    2 масштаба на ближний слой (вид рогатки + последний другой); дальние слои (f ≤ 0.25) и облака — одна полоса /
//    спрайт под вид рогатки (на других видах — с масштабированием ×0.84…1.14); облака — 0.6–0.75 разрешения,
//    ореол — спрайт 256 px;
//  • общий бюджет памяти фона (≈ 6 экранов, 24–96 МБ): сверх него вытесняются полосы и облака не текущего масштаба.

import type { ThemeId } from '../../core/types';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { ViewInfo } from '../view';
import { TAU, clamp, lerp, mix, rand, rgba } from './paint';
import { THEME_PALETTES, type ThemePalette } from './themes';
import { BIN_M, GLOW_PX, Tops, renderCloud, renderGlow, themeLayers, type CloudItem, type CloudLayer, type CloudSprite, type StripLayer } from './bgLayers';

export { drawTerrain, prewarmTerrain, releaseTerrain, shakeFrame, terrainMemoryBytes, TerrainRenderer } from './terrain';
export { drawForeground } from './foreground';
export { setReducedMotion } from './paint';
export type { ThemePalette } from './themes';

/** Ступень качества (как QualityLevel приложения). */
export type BgQuality = 'high' | 'med' | 'low';

/** Сведения о темах для UI (карточки эпизодов). */
export const THEME_INFO: Record<ThemeId, { name: string; skyTop: string; skyBottom: string; accent: string }> = {
  meadow: info('meadow'),
  beach: info('beach'),
  snow: info('snow'),
};

function info(t: ThemeId): { name: string; skyTop: string; skyBottom: string; accent: string } {
  const P = THEME_PALETTES[t];
  return { name: P.name, skyTop: P.sky[0][1], skyBottom: P.sky[P.sky.length - 1][1], accent: P.accent };
}

// ───────────────────────── параметры кэша ─────────────────────────

/** Высота вида рогатки, м — масштаб, при котором слои рисуются «как задуманы». */
const AIM_VIEW_H = 15;
/** Ширина тайла полосы, px: тайл рисуется целиком (drawImage без под-прямоугольника — быстрый путь растра). */
const TILE_PX = 512;
/** Предел ширины полосы на период, px (память). */
const STRIP_MAX_PX = 8192;
/** Сколько полос держать на ближний слой (LRU: вид рогатки + последний другой масштаб). */
const STRIPS_PER_LAYER = 2;
/**
 * Дальние слои (f ≤ FIXED_F: горы, море, острова, дальние холмы / гряда) и облака: одна полоса / спрайт под масштаб
 * вида рогатки, на других видах — с масштабированием (весь диапазон зума меняет их масштаб лишь в 0.84…1.14 раза,
 * 04 §3.3): вдвое меньше памяти и никаких перестроек при зуме.
 */
const FIXED_F = 0.25;
/** Сколько спрайтов держать на облако (масштаб облаков фиксирован — меняется только при смене высоты экрана). */
const CLOUDS_PER_ITEM = 1;
/** Разрешение спрайтов облаков (доля масштаба слоя) по ступеням качества: мягкие формы, память ×0.4–0.6. */
const CLOUD_RES: Record<BgQuality, number> = { high: 0.75, med: 0.7, low: 0.6 };
/** Бюджет памяти фона: столько полноэкранных буферов (W·H·4), в пределах [MIN, MAX]; LOW — ×0.6. */
const BUDGET_SCREENS = 6;
const BUDGET_MIN = 24 * 1024 * 1024;
const BUDGET_MAX = 96 * 1024 * 1024;
/** Высота «шва» внизу полосы, м слоя: плавный переход к сплошной заливке под слоем. */
const SEAL_M = 0.4;
/** Бюджет достройки полос внутри кадра, мс (остальное — в простое, requestIdleCallback). */
const JOB_BUDGET_MS = 0.5;
/** Если простоя нет и задание не продвигалось столько кадров — один тайл строится в кадре сверх бюджета. */
const JOB_FORCE_FRAMES = 20;
/** Новую полосу / облака строим, когда масштаб не менялся столько, мс (кроме самой первой). */
const STABLE_MS = 250;
/** Относительное расхождение масштаба, при котором полоса/облако рисуются 1:1 (сдвиг ≤ 1.5 px на 1000 px). */
const EXACT_EPS = 1.5e-3;
/** Отражение солнца (beach): спрайт фиксированного размера, рисуется масштабированным. */
const REFLECT_W = 256;
const REFLECT_H = 72;

// ───────────────────────── типы движка ─────────────────────────

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
  bytes: number;
  used: number;
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

interface CloudEntry {
  s: CloudSprite;
  used: number;
}

const layerScale = (v: ViewInfo, sRef: number, f: number): number => sRef * Math.pow(v.scale / sRef, f);
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const canvasBytes = (c: AnyCanvas): number => c.width * c.height * 4;

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

// ───────────────────────── Background ─────────────────────────

/**
 * Параллакс-фон темы. draw() рисует небо и все фоновые слои на весь экран (в экранных координатах).
 * prewarm() — построить всё заранее (экран загрузки).
 */
export class Background {
  readonly theme: ThemeId;
  private readonly P: ThemePalette;
  private readonly cloudsFar: CloudLayer;
  private readonly cloudsNear: CloudLayer;
  /** Полосы в порядке отрисовки; ближние облака — перед индексом nearAt. */
  private readonly strips: StripLayer[];
  private readonly nearAt: number;
  private readonly glitterAfter: number;
  private readonly states = new Map<string, LayerState>();
  private readonly clouds = new Map<number, CloudEntry[]>();
  private glow: AnyCanvas | null = null;
  /** Отражение солнца в море (beach) — маленький спрайт, рисуется масштабированным. */
  private reflect: AnyCanvas | null = null;
  /** Градиент неба — столбец 1×h, растягиваемый по ширине (дешевле полосы во весь экран, не зависит от W). */
  private skyCol: AnyCanvas | null = null;
  /** Слои с незавершённой достройкой полосы. */
  private readonly active = new Set<LayerState>();
  /** Средняя стоимость тайла полосы, мс (для бюджета кадра и простоя). */
  private avgTileMs = 3;
  private stall = 0;
  private idleId: number | null = null;
  /** В этом кадре уже начато новое задание (сухой прогон — не больше одного за кадр). */
  private jobStarted = false;
  private cloudBuildsLeft = 1;
  /** Масштаб, от которого отсчитывается «неподвижность» зума (дрожание < EXACT_EPS не сбрасывает таймер). */
  private anchorScale = -1;
  private lastH = -1;
  private scaleSince = 0;
  private frame = 0;
  private quality: BgQuality = 'high';
  private fastOverride: boolean | null = null;
  private budget = BUDGET_MIN;

  constructor(theme: ThemeId, opts: { quality?: BgQuality } = {}) {
    this.theme = theme;
    this.P = THEME_PALETTES[theme];
    const T = themeLayers(theme);
    this.strips = T.strips;
    this.nearAt = T.nearAt;
    this.glitterAfter = T.glitterAfter;
    this.cloudsFar = T.cloudsFar;
    this.cloudsNear = T.cloudsNear;
    if (opts.quality) this.quality = opts.quality;
  }

  /**
   * Ступень качества приложения. LOW — полосы и облака масштабируются без сглаживания, пока зум меняется
   * (на программном растре масштабированный drawImage со сглаживанием в ~4 раза дороже), облака — 0.6 разрешения,
   * бюджет памяти ×0.6. При неподвижном зуме полосы рисуются 1:1 на любой ступени.
   */
  setQuality(q: BgQuality): void {
    this.quality = q;
  }

  /** Масштабирование без сглаживания на время зума: по ступени качества (LOW); присваивание задаёт явно, null — по ступени. */
  get fastScaling(): boolean {
    return this.fastOverride ?? this.quality === 'low';
  }

  set fastScaling(v: boolean | null) {
    this.fastOverride = v;
  }

  /** Память кэшей фона, байт (полосы, облака, ореол, небо). */
  get memoryBytes(): number {
    let b = 0;
    for (const st of this.states.values()) {
      for (const s of st.strips) b += s.bytes;
      if (st.job) for (const t of st.job.tiles) b += canvasBytes(t.c);
    }
    for (const list of this.clouds.values()) for (const e of list) b += canvasBytes(e.s.canvas);
    if (this.glow) b += canvasBytes(this.glow);
    if (this.reflect) b += canvasBytes(this.reflect);
    if (this.skyCol) b += canvasBytes(this.skyCol);
    return b;
  }

  /** Освободить все кэши (фон не нужен — например, вытеснен из пула тем). Следующий draw() построит заново. */
  dispose(): void {
    this.states.clear();
    this.clouds.clear();
    this.glow = null;
    this.reflect = null;
    this.skyCol = null;
    this.active.clear();
    this.cancelIdle();
    this.anchorScale = -1;
  }

  /** Построить все полосы и облака для данного вида заранее (экран загрузки). */
  prewarm(view: ViewInfo): void {
    const sRef = view.screenH / AIM_VIEW_H;
    this.anchorScale = view.scale;
    this.lastH = view.screenH;
    this.scaleSince = nowMs() - STABLE_MS;
    this.budget = this.budgetFor(view);
    for (const L of this.strips) this.stripFor(L, view, sRef, true);
    for (const C of [this.cloudsFar, this.cloudsNear]) for (const c of C.items) this.cloudFor(c, sRef, true);
    this.evict();
  }

  private budgetFor(v: ViewInfo): number {
    const b = clamp(BUDGET_SCREENS * v.screenW * v.screenH * 4, BUDGET_MIN, BUDGET_MAX);
    return this.quality === 'low' ? b * 0.6 : b;
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    const W = view.screenW;
    const H = view.screenH;
    if (W <= 0 || H <= 0 || view.scale <= 0) return;
    this.frame++;
    this.budget = this.budgetFor(view);
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
    this.drawSky(ctx, view, horizonY, skyLimit);
    this.drawSun(ctx, view, sRef, horizonY, skyLimit);
    this.drawClouds(ctx, view, sRef, this.cloudsFar, skyLimit);
    // 3. слои
    for (let i = 0; i < n; i++) {
      if (i === this.nearAt) this.drawClouds(ctx, view, sRef, this.cloudsNear, Math.min(limit[i - 1] ?? H, geo[i].cover + 2));
      const s = strips[i];
      if (s) this.blitStrip(ctx, view, this.strips[i], s, geo[i].sL, geo[i].yTop, limit[i]);
      if (i === this.glitterAfter) this.drawSeaGlitter(ctx, view, sRef, horizonY, limit[i]);
    }
    if (this.P.snowfall) this.drawSnowfall(ctx, view, sRef);
    ctx.restore();
    if (this.active.size) this.runJobs();
    this.evict();
  }

  // ── память ──

  /** Вытеснить сверх бюджета: полосы и облака не текущего масштаба, самые давние первыми. */
  private evict(): void {
    let bytes = this.memoryBytes;
    if (bytes <= this.budget) return;
    const cand: Array<{ used: number; drop: () => number }> = [];
    for (const st of this.states.values()) {
      for (const s of st.strips) {
        if (s.used === this.frame || st.strips.length < 2) continue;
        cand.push({
          used: s.used,
          drop: () => {
            st.strips = st.strips.filter((x) => x !== s);
            return s.bytes;
          },
        });
      }
    }
    for (const list of this.clouds.values()) {
      for (const e of list) {
        if (e.used === this.frame || list.length < 2) continue;
        cand.push({
          used: e.used,
          drop: () => {
            const i = list.indexOf(e);
            if (i >= 0) list.splice(i, 1);
            return canvasBytes(e.s.canvas);
          },
        });
      }
    }
    cand.sort((a, b) => a.used - b.used);
    for (const c of cand) {
      if (bytes <= this.budget * 0.85) break;
      bytes -= c.drop();
    }
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
    const gr = R * 4.8;
    if (!this.glow) this.glow = renderGlow(S.glow, S.glowA);
    const y0 = sy - gr;
    if (y0 < limit && y0 + gr * 2 > 0) {
      const clip = y0 + gr * 2 > limit;
      if (clip) clipAbove(ctx, v.screenW, limit);
      // спрайт 256 px, масштабированный до 9.6R (04 §5.1)
      ctx.drawImage(this.glow, sx - gr, y0, gr * 2, gr * 2);
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
      // отражённое свечение: нижняя половина ореола, сплющенная по высоте (маленький спрайт, масштабируется)
      if (!this.reflect) {
        const c = createCanvas(REFLECT_W, REFLECT_H);
        const cx = ctx2d(c);
        cx.globalAlpha = 0.7;
        cx.drawImage(this.glow, 0, GLOW_PX / 2, GLOW_PX, GLOW_PX / 2, 0, 0, REFLECT_W, REFLECT_H);
        this.reflect = c;
      }
      const gw = R * 5;
      const gh = Math.max(2, R * 2.8);
      const y0 = horizonY - R * 0.1;
      const clip = y0 + gh > bottom;
      if (clip) clipAbove(ctx, v.screenW, bottom);
      ctx.drawImage(this.reflect, sx - gw, y0, gw * 2, gh);
      if (clip) ctx.restore();
    }
    const r = rand(5);
    const t = v.time;
    ctx.fillStyle = S.sparkle;
    const n = 30;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const y = horizonY + 3 * v.dpr + u * u * (v.screenH * 0.32);
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

  /** Спрайт облака: строится под масштаб вида рогатки sRef (с разрешением CLOUD_RES), на других видах — масштабируется. */
  private cloudFor(c: CloudItem, sRef: number, force: boolean): CloudSprite {
    let list = this.clouds.get(c.seed);
    if (!list) {
      list = [];
      this.clouds.set(c.seed, list);
    }
    const want = sRef * CLOUD_RES[this.quality];
    let best: CloudEntry | null = null;
    let err = Infinity;
    for (const e of list) {
      const d = Math.abs(Math.log(want / e.s.ppm));
      if (d < err) {
        err = d;
        best = e;
      }
    }
    if (best && err < EXACT_EPS) {
      best.used = this.frame;
      return touch(list, best).s;
    }
    const stable = nowMs() - this.scaleSince >= STABLE_MS;
    if (!best || force || (stable && this.cloudBuildsLeft > 0)) {
      if (best) this.cloudBuildsLeft--;
      const s = renderCloud(c.seed, c.w, want, this.P.cloud);
      prime(s.canvas);
      list.push({ s, used: this.frame });
      if (list.length > CLOUDS_PER_ITEM) list.shift();
      return s;
    }
    best.used = this.frame;
    return touch(list, best).s;
  }

  private drawClouds(ctx: Ctx2D, v: ViewInfo, sRef: number, L: CloudLayer, limit: number): void {
    const sL = layerScale(v, sRef, L.f);
    const periodPx = L.period * sL;
    const drift = L.drift * v.time;
    ctx.globalAlpha = this.P.cloud.alpha;
    if (this.fastScaling && nowMs() - this.scaleSince < STABLE_MS) ctx.imageSmoothingEnabled = false;
    for (const c of L.items) {
      const yb = v.screenH / 2 - (L.baseY + c.y - v.camY * L.f) * sL;
      const hPx = c.w * 0.6 * sL;
      if (yb < 0 || yb - hPx > limit) continue;
      const wPx = (c.w + 0.6) * sL;
      let x = v.screenW / 2 + (c.x + drift - v.camX * L.f) * sL;
      x = ((x % periodPx) + periodPx) % periodPx;
      for (let X = x - periodPx; X < v.screenW; X += periodPx) {
        if (X + wPx < 0) continue;
        const s = this.cloudFor(c, sRef, false);
        const k = sL / s.ppm;
        ctx.drawImage(s.canvas, X - s.ox * k, yb - s.oy * k, s.canvas.width * k, s.canvas.height * k);
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
    // дальний слой — всегда под вид рогатки (sL = sRef), ближний — под текущий масштаб
    const fixed = L.f <= FIXED_F;
    const want = Math.min((fixed ? sRef : layerScale(v, sRef, L.f)) * res, STRIP_MAX_PX / L.period);
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
      best.used = this.frame;
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
    if (st.job) this.active.add(st);
    best.used = this.frame;
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
    const tb = nowMs();
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
    this.avgTileMs = this.avgTileMs * 0.8 + (nowMs() - tb) * 0.2;
  }

  private finishJob(st: LayerState, job: StripJob): Strip {
    let bytes = 0;
    for (const t of job.tiles) bytes += canvasBytes(t.c);
    const s: Strip = { tiles: job.tiles, totalPx: job.totalPx, ppm: job.ppm, hPx: job.hPx, fill: job.fill, opaqueTop: job.opaqueTop, bytes, used: this.frame };
    st.strips.push(s);
    while (st.strips.length > (job.L.f <= FIXED_F ? 1 : STRIPS_PER_LAYER)) st.strips.shift();
    return s;
  }

  /**
   * Достройка полос: в кадре — пока укладывается в JOB_BUDGET_MS (по средней стоимости тайла), остальное — в простое;
   * без простоя (кадр занят целиком) — не больше одного тайла за кадр после JOB_FORCE_FRAMES кадров ожидания.
   * Готовая полоса используется со следующего кадра.
   */
  private runJobs(): void {
    const t0 = nowMs();
    const force = this.stall >= JOB_FORCE_FRAMES;
    let built = 0;
    for (const st of this.active) {
      const job = st.job;
      if (!job) {
        this.active.delete(st);
        continue;
      }
      while (job.tiles.length < job.n && ((force && built === 0) || nowMs() - t0 + this.avgTileMs <= JOB_BUDGET_MS)) {
        this.buildTile(job);
        built++;
      }
      if (job.tiles.length === job.n) this.finishActive(st);
    }
    this.stall = built || !this.active.size ? 0 : this.stall + 1;
    if (this.active.size) this.scheduleIdle();
  }

  private finishActive(st: LayerState): void {
    if (st.job) this.finishJob(st, st.job);
    st.job = null;
    this.active.delete(st);
  }

  private cancelIdle(): void {
    if (this.idleId === null) return;
    const g = globalThis as unknown as { cancelIdleCallback?: (id: number) => void };
    if (typeof g.cancelIdleCallback === 'function') g.cancelIdleCallback(this.idleId);
    else clearTimeout(this.idleId);
    this.idleId = null;
  }

  private scheduleIdle(): void {
    if (this.idleId !== null) return;
    const g = globalThis as unknown as {
      requestIdleCallback?: (cb: (d: { timeRemaining(): number; didTimeout: boolean }) => void, o?: { timeout: number }) => number;
    };
    if (typeof g.requestIdleCallback === 'function') this.idleId = g.requestIdleCallback((d) => this.idle(d), { timeout: 500 });
    else this.idleId = setTimeout(() => this.idle(null), 24) as unknown as number;
  }

  /** Простой: тайлы активных заданий, пока остаётся время (по средней стоимости тайла). */
  private idle(d: { timeRemaining(): number; didTimeout: boolean } | null): void {
    this.idleId = null;
    if (typeof document === 'undefined') return;
    const t0 = nowMs();
    const left = (): number => (d ? d.timeRemaining() : 4 - (nowMs() - t0));
    let built = 0;
    for (const st of this.active) {
      const job = st.job;
      if (!job) {
        this.active.delete(st);
        continue;
      }
      while (job.tiles.length < job.n && left() > Math.min(this.avgTileMs * 1.2, 12)) {
        this.buildTile(job);
        built++;
      }
      if (job.tiles.length === job.n) this.finishActive(st);
      else break;
    }
    if (built) this.stall = 0;
    if (this.active.size) this.scheduleIdle();
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
      if (!exact && this.fastScaling && nowMs() - this.scaleSince < STABLE_MS) ctx.imageSmoothingEnabled = false;
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
