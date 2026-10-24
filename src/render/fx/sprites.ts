// Кэш маленьких спрайтов частиц. Каждый спрайт описан функцией рисования в единичных координатах
// (1 единица = P пикселей, ось Y вниз, свет сверху-слева) и запекается лениво под «ступень» размера:
// P = ⌈2^(ci/2)⌉ ≥ нужного размера в пикселях, т.е. при отрисовке масштаб всегда в (0.71, 1].
// Модуль не трогает DOM при импорте — холсты создаются только при первом draw (тесты Fx идут в Node).

import { createCanvas, ctx2d } from '../canvas';
import { BIRD_FX, BIRD_TYPES, EGG_FX, HELMET_FX, MATERIAL_FX, TNT_FX } from './palette';
import { mixHex, rgba, TAU } from './math';
import type { BirdType } from '../../core/types';

type Ctx = CanvasRenderingContext2D;

interface SpriteDef {
  /** Размер холста в долях P. */
  readonly wf: number;
  readonly hf: number;
  /** Максимальный P (больше — растягиваем готовый). */
  readonly maxP: number;
  readonly paint: (ctx: Ctx, P: number) => void;
}

export interface BakedSprite {
  /** Страница атласа, где лежит спрайт. */
  readonly canvas: HTMLCanvasElement;
  /** Прямоугольник спрайта на странице, px. */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
  /** Половина размера спрайта, px (центр спрайта). */
  readonly hw: number;
  readonly hh: number;
  /** Сколько пикселей в единице спрайта. */
  readonly P: number;
}

const defs: SpriteDef[] = [];

function def(wf: number, hf: number, maxP: number, paint: (ctx: Ctx, P: number) => void): number {
  defs.push({ wf, hf, maxP, paint });
  return defs.length - 1;
}

/** Толщина линии в единицах спрайта: не тоньше minPx пикселей. */
const lw = (units: number, P: number, minPx = 1.1): number => Math.max(units, minPx / P);

function poly(ctx: Ctx, pts: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
}

// ── Щепки дерева: длина 1 по X, толщина ≈ 0.22 ─────────────────────────────
const SPLINTER_SHAPES: readonly (readonly number[])[] = [
  [-0.5, -0.08, 0.42, -0.11, 0.5, -0.02, 0.38, 0.1, -0.46, 0.08],
  [-0.5, -0.05, 0.08, -0.1, 0.5, 0.0, 0.04, 0.1, -0.48, 0.07],
  [-0.5, -0.1, -0.18, -0.12, 0.3, -0.09, 0.5, -0.04, 0.36, 0.02, 0.46, 0.1, -0.1, 0.11, -0.5, 0.06, -0.42, 0.0],
  [-0.38, -0.15, 0.3, -0.18, 0.42, 0.04, 0.12, 0.17, -0.4, 0.12],
];

function paintSplinter(shape: readonly number[], dark: boolean) {
  const m = MATERIAL_FX.wood;
  return (ctx: Ctx, P: number) => {
    const g = ctx.createLinearGradient(0, -0.14, 0, 0.14);
    g.addColorStop(0, dark ? m.base : m.light);
    g.addColorStop(1, dark ? m.dark : m.base);
    poly(ctx, shape);
    ctx.fillStyle = g;
    ctx.fill();
    if (P >= 12) {
      // волокно вдоль щепки
      ctx.strokeStyle = rgba(m.detail, 0.7);
      ctx.lineWidth = lw(0.03, P, 0.8);
      ctx.beginPath();
      ctx.moveTo(-0.38, -0.015);
      ctx.quadraticCurveTo(0, 0.03, 0.34, -0.01);
      ctx.stroke();
    }
    poly(ctx, shape);
    ctx.strokeStyle = m.outline;
    ctx.lineWidth = lw(0.06, P);
    ctx.stroke();
  };
}

export const SPR_SPLINTER: readonly number[] = SPLINTER_SHAPES.flatMap((s) => [
  def(1.08, 0.46, 128, paintSplinter(s, false)),
  def(1.08, 0.46, 128, paintSplinter(s, true)),
]);

// ── Осколки льда: треугольники в круге диаметра 1 ───────────────────────────
const SHARD_SHAPES: readonly (readonly number[])[] = [
  [0.0, -0.5, 0.4, 0.34, -0.34, 0.42],
  [-0.1, -0.5, 0.46, -0.06, 0.18, 0.46, -0.44, 0.2],
  [-0.46, -0.3, 0.5, -0.4, 0.04, 0.48],
];

function paintShard(shape: readonly number[]) {
  const m = MATERIAL_FX.ice;
  return (ctx: Ctx, P: number) => {
    // насыщеннее блока: мелкий осколок на фоне неба иначе читается «пустым»
    const g = ctx.createLinearGradient(-0.4, -0.4, 0.4, 0.4);
    g.addColorStop(0, '#E2F8FF');
    g.addColorStop(0.45, '#93D8F6');
    g.addColorStop(1, '#4FA6D8');
    poly(ctx, shape);
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = 1;
    // светлая грань вдоль первого ребра (блеск)
    const [x0, y0, x1, y1] = shape;
    const cx = shape.reduce((s, v, i) => (i % 2 === 0 ? s + v : s), 0) / (shape.length / 2);
    const cy = shape.reduce((s, v, i) => (i % 2 === 1 ? s + v : s), 0) / (shape.length / 2);
    const k = 0.22;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = lw(0.07, P, 0.9);
    ctx.beginPath();
    ctx.moveTo(x0 + (cx - x0) * k, y0 + (cy - y0) * k);
    ctx.lineTo(x1 + (cx - x1) * k, y1 + (cy - y1) * k);
    ctx.stroke();
    poly(ctx, shape);
    ctx.strokeStyle = m.outline;
    ctx.lineWidth = lw(0.075, P);
    ctx.stroke();
  };
}

export const SPR_SHARD: readonly number[] = SHARD_SHAPES.map((s) => def(1.1, 1.1, 128, paintShard(s)));

// ── Каменная крошка, металл каски, скорлупа, щепа таблички TNT: неровные многоугольники ─────
function chunkShape(seed: number, n: number): number[] {
  // детерминированный «случайный» многоугольник
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pts: number[] = [];
  const off = r() * TAU;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * TAU + (r() - 0.5) * 0.5;
    const rr = 0.5 * (0.66 + 0.34 * r());
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return pts;
}

const CHUNK_SHAPES = [chunkShape(11, 6), chunkShape(29, 6), chunkShape(47, 5), chunkShape(83, 7)];

interface ChunkColors {
  light: string;
  base: string;
  dark: string;
  outline: string;
}

function paintChunk(shape: readonly number[], c: ChunkColors, darker: boolean, speckles: boolean) {
  return (ctx: Ctx, P: number) => {
    const g = ctx.createLinearGradient(-0.3, -0.4, 0.3, 0.4);
    g.addColorStop(0, darker ? c.base : c.light);
    g.addColorStop(1, darker ? c.dark : c.base);
    poly(ctx, shape);
    ctx.fillStyle = g;
    ctx.fill();
    if (speckles && P >= 14) {
      ctx.fillStyle = rgba(c.dark, 0.7);
      ctx.beginPath();
      ctx.arc(0.1, 0.08, 0.05, 0, TAU);
      ctx.arc(-0.14, -0.06, 0.035, 0, TAU);
      ctx.fill();
    }
    // светлая кромка сверху-слева
    ctx.save();
    poly(ctx, shape);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = lw(0.1, P, 1);
    ctx.translate(0.05, 0.05);
    poly(ctx, shape);
    ctx.stroke();
    ctx.restore();
    poly(ctx, shape);
    ctx.strokeStyle = c.outline;
    ctx.lineWidth = lw(0.07, P);
    ctx.stroke();
  };
}

const STONE = MATERIAL_FX.stone;
export const SPR_CHUNK: readonly number[] = CHUNK_SHAPES.flatMap((s) => [
  def(1.08, 1.08, 128, paintChunk(s, STONE, false, true)),
  def(1.08, 1.08, 128, paintChunk(s, STONE, true, true)),
]);
export const SPR_HELMET: readonly number[] = CHUNK_SHAPES.slice(0, 2).map((s) => def(1.08, 1.08, 128, paintChunk(s, HELMET_FX, false, false)));
export const SPR_SHELL: readonly number[] = CHUNK_SHAPES.slice(2, 4).map((s) => def(1.08, 1.08, 128, paintChunk(s, EGG_FX, false, false)));
export const SPR_TNT_CHIP: readonly number[] = CHUNK_SHAPES.slice(1, 3).map((s) => def(1.08, 1.08, 128, paintChunk(s, TNT_FX, false, false)));

// ── Перья: длина 1 по X (04-visual.md §8.2) ─────────────────────────────────
function featherPath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(-0.5, 0);
  ctx.quadraticCurveTo(-0.1, -0.28, 0.5, -0.042);
  ctx.quadraticCurveTo(0.1, 0.25, -0.5, 0);
  ctx.closePath();
}

function paintFeather(fill: string, edge: string) {
  return (ctx: Ctx, P: number) => {
    const g = ctx.createLinearGradient(0, -0.16, 0, 0.14);
    g.addColorStop(0, mixHex(fill, '#FFFFFF', 0.25));
    g.addColorStop(1, fill);
    featherPath(ctx);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = edge;
    ctx.lineWidth = lw(0.045, P);
    ctx.stroke();
    ctx.lineWidth = lw(0.028, P, 0.8);
    ctx.beginPath();
    ctx.moveTo(-0.5, 0);
    ctx.quadraticCurveTo(0, -0.03, 0.42, -0.04);
    ctx.stroke();
  };
}

/** Перья по птице: [0] — цвет тела, [1] — акцент (хвост/хохолок). */
export const SPR_FEATHER = {} as Record<BirdType, readonly [number, number]>;
for (const b of BIRD_TYPES) {
  const f = BIRD_FX[b];
  SPR_FEATHER[b] = [def(1.08, 0.42, 128, paintFeather(f.base, f.outline)), def(1.08, 0.42, 128, paintFeather(f.accent, f.outline))];
}

// ── Мультяшная звёздочка (удар по свинье) ──────────────────────────────────
export const SPR_STAR = def(1.12, 1.12, 128, (ctx, P) => {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.24 : 0.5;
    if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -0.5, 0, 0.5);
  g.addColorStop(0, '#FFF59A');
  g.addColorStop(0.45, '#FFC21A');
  g.addColorStop(1, '#F08A06');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#8A4A00';
  ctx.lineWidth = lw(0.08, P);
  ctx.stroke();
});

// ── Свечения (рисуются в режиме 'lighter') ─────────────────────────────────
function paintGlow(stops: ReadonlyArray<readonly [number, string]>) {
  return (ctx: Ctx) => {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.5);
    for (const [o, c] of stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 0.5, 0, TAU);
    ctx.fill();
  };
}

/** Вспышка взрыва (04-visual.md §8.3). */
export const SPR_GLOW_WARM = def(1, 1, 256, paintGlow([
  [0, 'rgba(255,255,240,1)'],
  [0.4, 'rgba(255,230,140,0.8)'],
  [1, 'rgba(255,160,40,0)'],
]));
/** Раскалённая точка (угольки). */
export const SPR_EMBER = def(1, 1, 64, paintGlow([
  [0, 'rgba(255,250,220,1)'],
  [0.25, 'rgba(255,214,90,0.95)'],
  [0.6, 'rgba(255,140,30,0.35)'],
  [1, 'rgba(255,110,20,0)'],
]));

/** Четырёхлучевая искорка с ореолом. */
export const SPR_TWINKLE = def(1, 1, 128, (ctx) => {
  paintGlow([
    [0, 'rgba(255,255,240,0.75)'],
    [0.35, 'rgba(255,245,200,0.25)'],
    [1, 'rgba(255,240,180,0)'],
  ])(ctx);
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  const r = 0.5;
  const q = 0.07;
  ctx.moveTo(0, -r);
  ctx.quadraticCurveTo(q, -q, r, 0);
  ctx.quadraticCurveTo(q, q, 0, r);
  ctx.quadraticCurveTo(-q, q, -r, 0);
  ctx.quadraticCurveTo(-q, -q, 0, -r);
  ctx.fill();
});

/** Штрих искры: длина 1 по X (голова справа), толщина 0.25. Тянется неравномерно по длине/ширине. */
export const SPR_STREAK = def(1, 0.25, 128, (ctx) => {
  const g = ctx.createLinearGradient(-0.5, 0, 0.5, 0);
  g.addColorStop(0, 'rgba(255,200,80,0)');
  g.addColorStop(0.6, 'rgba(255,226,122,0.85)');
  g.addColorStop(1, 'rgba(255,250,225,1)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(-0.5, -0.1, 1, 0.2, 0.1);
  ctx.fill();
});

// ── Мягкие облачка (пыль, дым, огонь) ─────────────────────────────────────
function paintPuff(center: string, mid: string, edge: string, edgeAlpha: number, soft: number) {
  return (ctx: Ctx) => {
    const g = ctx.createRadialGradient(-0.14, -0.14, 0.02, 0, 0, 0.5);
    g.addColorStop(0, center);
    g.addColorStop(0.55, mid);
    g.addColorStop(1 - soft, rgba(edge, edgeAlpha));
    g.addColorStop(1, rgba(edge, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 0.5, 0, TAU);
    ctx.fill();
  };
}

const puffIds = new Map<string, number>();
/** Мягкое облачко заданного цвета (пыль): светлее в центре, мягкий край. */
export function puffSprite(color: string): number {
  let id = puffIds.get(color);
  if (id === undefined) {
    id = def(1, 1, 256, paintPuff(mixHex(color, '#FFFFFF', 0.45), color, mixHex(color, '#000000', 0.08), 0.95, 0.07));
    puffIds.set(color, id);
  }
  return id;
}

/** Огненный шар взрыва (ядро светлое, край оранжевый). */
export const SPR_FIRE = def(1, 1, 256, (ctx) => {
  const g = ctx.createRadialGradient(-0.15, -0.15, 0.02, 0, 0, 0.5);
  g.addColorStop(0, '#FFF6C0');
  g.addColorStop(0.38, '#FFD04A');
  g.addColorStop(0.78, '#FF9124');
  g.addColorStop(0.92, 'rgba(255,110,26,0.9)');
  g.addColorStop(1, 'rgba(255,110,26,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 0.5, 0, TAU);
  ctx.fill();
});

/** Дым взрыва (серо-сиреневый, объём светом сверху-слева). */
export const SPR_SMOKE = def(1, 1, 256, paintPuff('#C4BEC6', '#9C96A2', '#78727E', 0.95, 0.1));
/** Тёмный дым (остаётся после взрыва). */
export const SPR_SMOKE_DARK = def(1, 1, 256, paintPuff('#9A949C', '#76707A', '#5E5862', 0.9, 0.16));

// ── Кэш: спрайты упакованы в страницы-атласы ─────────────────────────────
// Все частицы берутся из 1–2 общих текстур: подряд идущие drawImage не меняют источник,
// и GPU-растеризатор склеивает их в один пакет (отдельный холст на спрайт пакеты рвёт).

const MIN_CI = 4; // P ≥ 4 px
const PAGE = 1024;
const GUTTER = 2; // прозрачный зазор между спрайтами (от «протекания» при билинейной выборке)

class AtlasPage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Полки: y, высота, занятая ширина. */
  private readonly shelves: Array<{ y: number; h: number; x: number }> = [];
  private nextY = 0;

  constructor() {
    this.canvas = createCanvas(PAGE, PAGE);
    this.ctx = ctx2d(this.canvas);
  }

  alloc(w: number, h: number): { x: number; y: number } | null {
    const W = w + GUTTER;
    const H = h + GUTTER;
    let best: { y: number; h: number; x: number } | null = null;
    for (const sh of this.shelves) {
      if (sh.h >= H && sh.h <= H * 1.4 + 4 && PAGE - sh.x >= W && (!best || sh.h < best.h)) best = sh;
    }
    if (!best) {
      if (this.nextY + H > PAGE || W > PAGE) return null;
      best = { y: this.nextY, h: H, x: 0 };
      this.shelves.push(best);
      this.nextY += H;
    }
    const r = { x: best.x, y: best.y };
    best.x += W;
    return r;
  }
}

export class FxSprites {
  private readonly cache = new Map<number, BakedSprite>();
  private readonly pages: AtlasPage[] = [];

  /** Спрайт id, запечённый под отрисовку размером px пикселей (на единицу спрайта). */
  get(id: number, px: number): BakedSprite {
    const d = defs[id];
    let ci = Math.ceil(2 * Math.log2(px > 4 ? px : 4));
    if (ci < MIN_CI) ci = MIN_CI;
    const maxCi = Math.floor(2 * Math.log2(d.maxP));
    if (ci > maxCi) ci = maxCi;
    const key = id * 32 + ci;
    let s = this.cache.get(key);
    if (!s) {
      s = this.bake(d, Math.ceil(2 ** (ci / 2)));
      this.cache.set(key, s);
    }
    return s;
  }

  /** Число запечённых спрайтов. */
  get size(): number {
    return this.cache.size;
  }

  /** Число страниц атласа. */
  get pageCount(): number {
    return this.pages.length;
  }

  /** Страницы атласа (для отладки/предпросмотра). */
  get pageCanvases(): readonly HTMLCanvasElement[] {
    return this.pages.map((p) => p.canvas);
  }

  clear(): void {
    this.cache.clear();
    this.pages.length = 0;
  }

  private bake(d: SpriteDef, P: number): BakedSprite {
    const pad = 2;
    const w = Math.ceil(P * d.wf) + pad * 2;
    const h = Math.ceil(P * d.hf) + pad * 2;
    let page = this.pages[this.pages.length - 1];
    let at = page?.alloc(w, h) ?? null;
    if (!at) {
      // ищем место на прежних страницах, иначе — новая страница
      for (const pg of this.pages) {
        at = pg.alloc(w, h);
        if (at) {
          page = pg;
          break;
        }
      }
      if (!at) {
        page = new AtlasPage();
        this.pages.push(page);
        at = page.alloc(w, h);
        if (!at) throw new Error(`спрайт эффекта ${w}×${h} не помещается в атлас`);
      }
    }
    const ctx = page.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(at.x, at.y, w, h);
    ctx.clip();
    ctx.translate(at.x + w / 2, at.y + h / 2);
    ctx.scale(P, P);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    d.paint(ctx, P);
    ctx.restore();
    return { canvas: page.canvas, sx: at.x, sy: at.y, sw: w, sh: h, hw: w / 2, hh: h / 2, P };
  }
}

/** Общий кэш спрайтов эффектов (спрайты — чистые функции, делить между экземплярами Fx безопасно). */
export const FX_SPRITES = new FxSprites();
