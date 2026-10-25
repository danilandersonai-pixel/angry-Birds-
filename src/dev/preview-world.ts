// Предпросмотр фонов и рельефа: 3 темы × {вид рогатки 15 м, общий план 30 м} на одном тестовом рельефе,
// плюс кадры 21:9 и 4:3 (проверка заполнения) и замер производительности draw() на 1920×1080.
// Параметры URL:
//   ?theme=meadow|beach|snow  — одна тема крупно (вид из ?view=aim|wide, по умолчанию aim)
//   &aspect=21:9|4:3|16:9     — соотношение сторон крупного кадра
//   &viewH=…  &camX=…  &camY=…  — ручная камера
//   ?t=секунды — фиксированное время сцены (иначе анимация в реальном времени)
//   ?scene=stress — сложный рельеф (долина, стена, нависание, парящий уступ, помосты)
//   ?warm=N — сразу N кадров (достроить кэши); ?perf=0 — без замера; ?phases=1 — разбивка растра по фазам; ?anim=0 — один кадр; ?bench=1 — микробенчмарк холста

import '@fontsource/rubik/700.css';
import type { BirdType, Material, PigType, TerrainDef, ThemeId } from '../core/types';
import type { Sprite } from '../render/sprites/api';
import { CAMERA, SLINGSHOT } from '../config/constants';
import { renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';
import { renderBlock } from '../render/sprites/blocks';
import { drawBand, drawPouch, renderSlingshot } from '../render/sprites/slingshot';
import { Background, THEME_INFO, drawForeground, drawTerrain } from '../render/sprites/background';
import { TERRAIN_PROBE } from '../render/sprites/terrain';
import type { ViewInfo } from '../render/view';

const params = new URLSearchParams(location.search);
const THEMES: ThemeId[] = ['meadow', 'beach', 'snow'];
const dpr = window.devicePixelRatio || 1;
const FONT = 'Rubik, "Arial Rounded MT Bold", sans-serif';
const fixedT = params.has('t') ? Number(params.get('t')) : null;
const animate = params.get('anim') !== '0' && fixedT === null;

// ───────────────────────── тестовый уровень ─────────────────────────

const TERRAIN: TerrainDef[] = [
  {
    kind: 'ground',
    points: [
      [-20, 0],
      [21, 0],
      [25, 3],
      [40, 3],
      [43.5, 0],
      [80, 0],
      [80, -12],
      [-20, -12],
    ],
  },
  {
    kind: 'rock',
    points: [
      [45.6, 0],
      [45.9, 1.5],
      [46.6, 2.1],
      [50.8, 2.1],
      [51.5, 1.4],
      [51.9, 0],
    ],
  },
  {
    kind: 'platform',
    points: [
      [53, 5],
      [58.5, 5],
      [58.5, 5.5],
      [53, 5.5],
    ],
  },
];

interface Box {
  m: Material;
  x: number;
  y: number;
  w: number;
  h: number;
}

// заглушки блоков (центр + размер): колонны 0.5×2, балка 4×0.5, квадраты 1×1
const BLOCKS: Box[] = [
  { m: 'wood', x: 28.25, y: 4, w: 0.5, h: 2 },
  { m: 'wood', x: 31.75, y: 4, w: 0.5, h: 2 },
  { m: 'wood', x: 30, y: 5.25, w: 4, h: 0.5 },
  { m: 'ice', x: 28.5, y: 6, w: 1, h: 1 },
  { m: 'stone', x: 31.5, y: 6, w: 1, h: 1 },
  { m: 'stone', x: 35.5, y: 4, w: 0.5, h: 2 },
  { m: 'stone', x: 38.5, y: 4, w: 0.5, h: 2 },
  { m: 'ice', x: 37, y: 5.25, w: 4, h: 0.5 },
  { m: 'wood', x: 48.2, y: 2.6, w: 1, h: 1 },
  { m: 'ice', x: 54.2, y: 6.5, w: 0.5, h: 2 },
  { m: 'ice', x: 57.3, y: 6.5, w: 0.5, h: 2 },
  { m: 'wood', x: 55.75, y: 7.75, w: 4, h: 0.5 },
  { m: 'wood', x: 63, y: 0.5, w: 1, h: 1 },
  { m: 'wood', x: 64, y: 0.5, w: 1, h: 1 },
  { m: 'stone', x: 63.5, y: 1.5, w: 1, h: 1 },
];

const PIGS: Array<{ t: PigType; x: number; y: number; r: number }> = [
  { t: 'medium', x: 30, y: 3 + 0.6075, r: 0.6075 },
  { t: 'small', x: 37, y: 3 + 0.405, r: 0.405 },
  { t: 'helmet', x: 49.7, y: 2.1 + 0.63, r: 0.63 },
  { t: 'large', x: 55.75, y: 5.5 + 0.8325, r: 0.8325 },
  { t: 'king', x: 30, y: 5.5 + 1.17, r: 1.17 },
];

const QUEUE: Array<{ t: BirdType; r: number }> = [
  { t: 'blues', r: 0.252 },
  { t: 'chuck', r: 0.495 },
  { t: 'bomb', r: 0.585 },
];

// ───────────────────────── спрайты ─────────────────────────

const spriteCache = new Map<string, Sprite>();
const bucket = (ppu: number): number => Math.pow(2, Math.ceil(4 * Math.log2(ppu)) / 4);

function sprite(key: string, ppu: number, make: (ppu: number) => Sprite): Sprite {
  const b = bucket(ppu);
  const k = `${key}:${b}`;
  let s = spriteCache.get(k);
  if (!s) {
    s = make(b);
    spriteCache.set(k, s);
  }
  return s;
}

function drawSprite(ctx: CanvasRenderingContext2D, v: ViewInfo, s: Sprite, x: number, y: number): void {
  const k = v.scale / s.ppu;
  const sx = (x - v.camX) * v.scale + v.screenW / 2;
  const sy = v.screenH / 2 - (y - v.camY) * v.scale;
  ctx.setTransform(k, 0, 0, k, sx, sy);
  ctx.drawImage(s.canvas, -s.ox, -s.oy);
}

/** Рогатка из slingshot.ts: back — до рельефа, резинки и кармашек вокруг птицы, front — после. */
function drawSling(ctx: CanvasRenderingContext2D, v: ViewInfo, part: 'back' | 'front'): void {
  const sl = sprite('sling', v.scale, (ppu) => {
    const r = renderSlingshot(ppu);
    slingFront.set(ppu, r.front);
    return r.back;
  });
  if (part === 'back') {
    drawSprite(ctx, v, sl, 0, 0);
    return;
  }
  const front = slingFront.get(sl.ppu);
  const sx = (x: number): number => (x - v.camX) * v.scale + v.screenW / 2;
  const sy = (y: number): number => v.screenH / 2 - (y - v.camY) * v.scale;
  const A = SLINGSHOT.ANCHOR;
  const Hh = SLINGSHOT.POUCH_HALF;
  const t = SLINGSHOT.BAND_REST * v.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawPouch(ctx, sx(A.x), sy(A.y), -Math.PI / 2, Hh * v.scale, t * 0.85);
  drawBand(ctx, sx(SLINGSHOT.PRONG_FRONT.x), sy(SLINGSHOT.PRONG_FRONT.y), sx(A.x + Hh), sy(A.y), t);
  if (front) drawSprite(ctx, v, front, 0, 0);
}

const slingFront = new Map<number, Sprite>();

function drawBackBand(ctx: CanvasRenderingContext2D, v: ViewInfo): void {
  const sx = (x: number): number => (x - v.camX) * v.scale + v.screenW / 2;
  const sy = (y: number): number => v.screenH / 2 - (y - v.camY) * v.scale;
  const A = SLINGSHOT.ANCHOR;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawBand(ctx, sx(SLINGSHOT.PRONG_BACK.x), sy(SLINGSHOT.PRONG_BACK.y), sx(A.x - SLINGSHOT.POUCH_HALF), sy(A.y), SLINGSHOT.BAND_REST * v.scale);
}

function drawBlocks(ctx: CanvasRenderingContext2D, v: ViewInfo): void {
  BLOCKS.forEach((b, i) => drawSprite(ctx, v, sprite(`block:${b.m}:${b.w}x${b.h}:${i % 3}`, v.scale, (ppu) => renderBlock(b.m, 'rect', b.w, b.h, 0, i % 3, ppu)), b.x, b.y));
}

/**
 * Стресс-рельеф (?scene=stress): V-образная долина, отвесная стена, нависание, тонкий парящий уступ,
 * узкий пик, скала и помосты разной толщины — проверка кромки, фестонов и шапок на сложных формах.
 */
const STRESS: TerrainDef[] = [
  {
    kind: 'ground',
    points: [
      [-20, 0],
      [6, 0],
      [9, -1.5],
      [12, 0],
      [14, 0],
      [14, 4],
      [17, 4],
      [18.5, 5.6],
      [20, 4],
      [24, 4],
      [24.6, 2.5],
      [23.4, 1.2],
      [26, 0],
      [60, 0],
      [60, -12],
      [-20, -12],
    ],
  },
  {
    kind: 'ground',
    points: [
      [28, 3],
      [33, 3],
      [33, 2.6],
      [28, 2.6],
    ],
  },
  {
    kind: 'rock',
    points: [
      [35, 0],
      [35.4, 2.6],
      [36.6, 3.6],
      [37.4, 2.2],
      [38.6, 2.8],
      [39.2, 0],
    ],
  },
  {
    kind: 'platform',
    points: [
      [41, 2],
      [45, 2],
      [45, 2.4],
      [41, 2.4],
    ],
  },
  {
    kind: 'platform',
    points: [
      [47, 0],
      [51, 0],
      [51, 2.5],
      [47, 2.5],
    ],
  },
];
const SCENE = params.get('scene') === 'stress' ? STRESS : TERRAIN;

/** Копия рельефа: у каждого кадра свой кэш тайлов (он привязан к массиву, как уровень в игре). */
const terrainCopy = (): TerrainDef[] => SCENE.map((t) => ({ kind: t.kind, points: t.points.map((p) => [p[0], p[1]] as [number, number]) }));

function renderScene(ctx: CanvasRenderingContext2D, v: ViewInfo, theme: ThemeId, bg: Background, terrain: TerrainDef[], times?: number[]): void {
  const t0 = performance.now();
  bg.draw(ctx, v);
  const t1 = performance.now();
  drawSling(ctx, v, 'back');
  const t2 = performance.now();
  drawTerrain(ctx, terrain, theme, v);
  const t3 = performance.now();
  drawBackBand(ctx, v);
  if (SCENE === TERRAIN) drawBlocks(ctx, v);
  if (SCENE === TERRAIN)
    for (const p of PIGS) drawSprite(ctx, v, sprite(`pig:${p.t}`, v.scale, (ppu) => renderPig(p.t, 'idle', 0, true, p.r, ppu)), p.x, p.y);
  QUEUE.forEach((q, i) =>
    drawSprite(ctx, v, sprite(`bird:${q.t}`, v.scale, (ppu) => renderBird(q.t, 'idle', q.r, ppu)), -SLINGSHOT.QUEUE_X0 - i * SLINGSHOT.QUEUE_DX, q.r),
  );
  drawSprite(ctx, v, sprite('bird:red', v.scale, (ppu) => renderBird('red', 'idle', 0.45, ppu)), SLINGSHOT.ANCHOR.x, SLINGSHOT.ANCHOR.y);
  drawSling(ctx, v, 'front');
  const t4 = performance.now();
  drawForeground(ctx, theme, v);
  const t5 = performance.now();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (times) times.push(t1 - t0, t3 - t2, t5 - t4);
}

// ───────────────────────── кадры ─────────────────────────

interface Frame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cap: HTMLElement;
  theme: ThemeId;
  bg: Background;
  viewH: number;
  camX: number;
  camY: number | null;
  label: string;
  terrain: TerrainDef[];
  /** Время draw() последних кадров (запись команд), мс: фон / рельеф / передний план. */
  times: number[][];
}

const frames: Frame[] = [];

function addFrame(parent: HTMLElement, wCss: number, hCss: number, theme: ThemeId, viewH: number, camX: number, text: string, camY: number | null = null): void {
  const box = document.createElement('div');
  box.className = 'frame';
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(wCss * dpr);
  canvas.height = Math.round(hCss * dpr);
  canvas.style.width = `${wCss}px`;
  canvas.style.height = `${hCss}px`;
  const cap = document.createElement('div');
  cap.className = 'cap';
  cap.textContent = text;
  box.append(canvas, cap);
  parent.append(box);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // у каждого кадра свой фон — как в игре (один холст — один Background)
  frames.push({ canvas, ctx, cap, theme, bg: new Background(theme), viewH, camX, camY, label: text, terrain: terrainCopy(), times: [] });
}

function viewOf(f: Frame, time: number): ViewInfo {
  const H = f.canvas.height;
  const scale = H / f.viewH;
  // прижим к земле: низ кадра на GROUND_MARGIN ниже земли (00 §1.10)
  const camY = f.camY ?? -CAMERA.GROUND_MARGIN + f.viewH / 2;
  return { screenW: f.canvas.width, screenH: H, camX: f.camX, camY, scale, dpr, time };
}

let lastCap = 0;

function renderAll(time: number, forceCaps = false): void {
  for (const f of frames) {
    f.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const t: number[] = [];
    renderScene(f.ctx, viewOf(f, time), f.theme, f.bg, f.terrain, t);
    f.times.push(t);
    if (f.times.length > 30) f.times.shift();
  }
  // подписи: среднее время draw() (запись команд) за последние кадры, обновление раз в 0.5 с
  const now = performance.now();
  if (!forceCaps && now - lastCap < 500) return;
  lastCap = now;
  for (const f of frames) {
    // первый (холодный) кадр строит кэши — в среднее не входит
    const list = f.times.length > 1 ? f.times.slice(1) : f.times;
    const n = list.length;
    if (!n) continue;
    const avg = (i: number): string => (list.reduce((a, t) => a + t[i], 0) / n).toFixed(2);
    const cold = f.times.length === 1 ? ' (холодный кадр)' : '';
    f.cap.textContent = `${f.label} · ${f.canvas.width}×${f.canvas.height} · фон ${avg(0)} · рельеф ${avg(1)} · передн. ${avg(2)} мс${cold}`;
  }
}

// ───────────────────────── замер ─────────────────────────

interface Stat {
  avg: number;
  p95: number;
  max: number;
}

function stat(a: number[]): Stat {
  const s = [...a].sort((x, y) => x - y);
  return {
    avg: a.reduce((p, c) => p + c, 0) / a.length,
    p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))],
    max: s[s.length - 1],
  };
}

/** Сценарии замера: панорама при неподвижном зуме (15 и 30 м) и непрерывный зум 15 → 19 м (полосы масштабируются). */
const SCENARIOS: Array<{ id: string; viewH: (i: number) => number; camX: number; fast?: boolean }> = [
  { id: '15', viewH: () => 15, camX: 10 },
  { id: '30', viewH: () => 30, camX: 30 },
  { id: 'zoom', viewH: (i) => 15 + i * 0.1, camX: 12 },
  { id: 'zoomFast', viewH: (i) => 15 + i * 0.1, camX: 12, fast: true },
];

/**
 * Замер на холсте 1920×1080: draw() фона, рельефа и переднего плана.
 * «запись» — время вызова на обычном холсте (растеризация уходит в GPU/композитор);
 * «растр» — с принудительной растеризацией на CPU (willReadFrequently + getImageData): худший случай без GPU.
 */
function measure(theme: ThemeId): Record<string, Stat> {
  const out: Record<string, Stat> = {};
  for (const flush of [false, true]) {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const ctx = c.getContext('2d', { willReadFrequently: flush });
    if (!ctx) return out;
    const bg = new Background(theme);
    for (const sc of SCENARIOS) {
      const mk = (i: number): ViewInfo => {
        const viewH = sc.viewH(i);
        return { screenW: 1920, screenH: 1080, camX: sc.camX + i * 0.15, camY: -CAMERA.GROUND_MARGIN + viewH / 2, scale: 1080 / viewH, dpr: 1, time: i / 60 };
      };
      const base = mk(0);
      const terrain = terrainCopy();
      const tp0 = performance.now();
      bg.prewarm(base); // прогрев: построение полос и облаков под этот вид
      if (!flush) out[`build:${sc.id}`] = stat([performance.now() - tp0]);
      bg.fastScaling = !!sc.fast;
      // прогрев: первые кадры достраивают тайлы рельефа видимой области (в игре — интро уровня)
      for (let i = 0; i < 12; i++) {
        bg.draw(ctx, base);
        drawTerrain(ctx, terrain, theme, base);
      }
      ctx.getImageData(0, 0, 1, 1);
      const tb: number[] = [];
      const tt: number[] = [];
      const tf: number[] = [];
      const phases: Record<string, number[]> = {};
      for (let i = 0; i < 40; i++) {
        const v = mk(i);
        let t0 = performance.now();
        if (flush) {
          let tp = performance.now();
          bg._phase = (label) => {
            ctx.getImageData(0, 0, 1, 1);
            const now = performance.now();
            (phases[label] ??= []).push(now - tp);
            tp = performance.now();
          };
        }
        bg.draw(ctx, v);
        bg._phase = null;
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tb.push(performance.now() - t0);
        t0 = performance.now();
        if (flush) {
          let tp = performance.now();
          TERRAIN_PROBE.phase = (label) => {
            ctx.getImageData(0, 0, 1, 1);
            const now = performance.now();
            (phases[`t-${label}`] ??= []).push(now - tp);
            tp = performance.now();
          };
        }
        drawTerrain(ctx, terrain, theme, v);
        TERRAIN_PROBE.phase = null;
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tt.push(performance.now() - t0);
        t0 = performance.now();
        drawForeground(ctx, theme, v);
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tf.push(performance.now() - t0);
      }
      bg.fastScaling = false;
      const tag = `${flush ? 'raster' : 'record'}:${sc.id}`;
      out[`bg:${tag}`] = stat(tb);
      out[`terrain:${tag}`] = stat(tt);
      out[`fg:${tag}`] = stat(tf);
      for (const [k, a] of Object.entries(phases)) out[`phase:${k}:${sc.id}`] = stat(a);
    }
  }
  return out;
}

/** Разбор стоимости элементарных операций на CPU-холсте 1920×1080 (?bench=1). */
function microBench(): string {
  const c = document.createElement('canvas');
  c.width = 1920;
  c.height = 1080;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const opaque = document.createElement('canvas');
  opaque.width = 1920;
  opaque.height = 600;
  const oc = opaque.getContext('2d')!;
  oc.fillStyle = '#4a8';
  oc.fillRect(0, 0, 1920, 600);
  const transp = document.createElement('canvas');
  transp.width = 1920;
  transp.height = 600;
  const tc = transp.getContext('2d')!;
  tc.fillStyle = '#4a8';
  tc.fillRect(0, 400, 1920, 200);
  const time = (fn: () => void): string => {
    fn();
    ctx.getImageData(0, 0, 1, 1);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      fn();
      ctx.getImageData(0, 0, 1, 1);
    }
    return ((performance.now() - t0) / 20).toFixed(2);
  };
  const g = ctx.createLinearGradient(0, 0, 0, 1080);
  g.addColorStop(0, '#2F8FE0');
  g.addColorStop(1, '#E4F6F6');
  const lines = [
    `getImageData 1px: ${time(() => {})}`,
    `fillRect solid full: ${time(() => {
      ctx.fillStyle = '#336699';
      ctx.fillRect(0, 0, 1920, 1080);
    })}`,
    `fillRect gradient full: ${time(() => {
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1920, 1080);
    })}`,
    `drawImage opaque 1920x600 1:1: ${time(() => ctx.drawImage(opaque, 0, 100))}`,
    `drawImage opaque 1920x600 scaled 1.1: ${time(() => ctx.drawImage(opaque, 0, 100, 2112, 660))}`,
    `drawImage transp 1920x600 1:1: ${time(() => ctx.drawImage(transp, 0, 100))}`,
    `drawImage transp 1920x600 scaled 1.1: ${time(() => ctx.drawImage(transp, 0, 100, 2112, 660))}`,
  ];
  ctx.imageSmoothingQuality = 'low';
  lines.push(`drawImage opaque 9-arg full src 1:1: ${time(() => ctx.drawImage(opaque, 0, 0, 1920, 600, 0, 100, 1920, 600))}`);
  lines.push(`drawImage opaque 9-arg part src 1:1: ${time(() => ctx.drawImage(opaque, 0, 50, 1920, 550, 0, 150, 1920, 550))}`);
  lines.push(`drawImage opaque 9-arg 20 pieces 1:1: ${time(() => {
    for (let i = 0; i < 20; i++) ctx.drawImage(opaque, i * 96, 50, 96, 550, i * 96, 150, 96, 550);
  })}`);
  const grad = document.createElement('canvas');
  grad.width = 1920;
  grad.height = 600;
  const gc = grad.getContext('2d')!;
  const gg = gc.createLinearGradient(0, 0, 0, 600);
  gg.addColorStop(0, '#2F8FE0');
  gg.addColorStop(1, '#E4F6F6');
  gc.fillStyle = gg;
  gc.fillRect(0, 0, 1920, 600);
  lines.push(`drawImage gradient-filled canvas 1:1: ${time(() => ctx.drawImage(grad, 0, 100))}`);
  lines.push(`clip rect + drawImage 3-arg 1:1: ${time(() => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 1920, 500);
    ctx.clip();
    ctx.drawImage(opaque, 0, 100);
    ctx.restore();
  })}`);
  const smalls: HTMLCanvasElement[] = [];
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('canvas');
    s.width = 256;
    s.height = 550;
    const sc = s.getContext('2d')!;
    sc.fillStyle = '#4a8';
    sc.fillRect(0, 100, 256, 450);
    smalls.push(s);
  }
  lines.push(`8 canvases 256x550 3-arg 1:1: ${time(() => {
    for (let i = 0; i < 8; i++) ctx.drawImage(smalls[i], i * 256, 150);
  })}`);
  lines.push(`8 canvases 256x550 5-arg ×1.1: ${time(() => {
    for (let i = 0; i < 8; i++) ctx.drawImage(smalls[i], i * 281.6, 150, 281.6, 605);
  })}`);
  const col = document.createElement('canvas');
  col.width = 1;
  col.height = 1080;
  const cc = col.getContext('2d')!;
  const cg = cc.createLinearGradient(0, 0, 0, 1080);
  cg.addColorStop(0, '#2F8FE0');
  cg.addColorStop(1, '#E4F6F6');
  cc.fillStyle = cg;
  cc.fillRect(0, 0, 1, 1080);
  lines.push(`drawImage 1px column → full: ${time(() => ctx.drawImage(col, 0, 0, 1920, 1080))}`);
  ctx.imageSmoothingEnabled = false;
  lines.push(`drawImage 1px column → full (nosmooth): ${time(() => ctx.drawImage(col, 0, 0, 1920, 1080))}`);
  ctx.imageSmoothingEnabled = true;
  lines.push(`fillRect 300 rows solid ×4: ${time(() => {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = ['#123', '#234', '#345', '#456'][i];
      ctx.fillRect(0, 300 + i * 75, 1920, 75);
    }
  })}`);
  lines.push(`drawImage opaque scaled 1.1 (low): ${time(() => ctx.drawImage(opaque, 0, 100, 2112, 660))}`);
  ctx.imageSmoothingEnabled = false;
  lines.push(`drawImage opaque scaled 1.1 (nosmooth): ${time(() => ctx.drawImage(opaque, 0, 100, 2112, 660))}`);
  return lines.join('\n');
}

// ───────────────────────── страница ─────────────────────────

function build(): void {
  if (params.get('bench') === '1') {
    const pre = document.createElement('pre');
    pre.id = 'perf';
    pre.textContent = microBench();
    document.getElementById('root')!.append(pre);
    return;
  }
  const root = document.getElementById('root')!;
  const single = params.get('theme') as ThemeId | null;
  if (single && THEMES.includes(single)) {
    const asp = (params.get('aspect') ?? '').split(':').map(Number);
    const W = window.innerWidth;
    let Hh = window.innerHeight;
    let Ww = W;
    if (asp.length === 2 && asp[0] > 0 && asp[1] > 0) {
      const a = asp[0] / asp[1];
      if (W / Hh > a) Ww = Math.round(Hh * a);
      else Hh = Math.round(W / a);
    }
    const view = params.get('view') ?? 'aim';
    const viewH = Number(params.get('viewH') ?? (view === 'wide' ? 30 : 15));
    const camX = Number(params.get('camX') ?? (view === 'wide' ? 30 : 10));
    const camY = params.has('camY') ? Number(params.get('camY')) : null;
    root.className = 'single';
    addFrame(root, Ww, Hh, single, viewH, camX, `${THEME_INFO[single].name} · вид ${viewH} м`, camY);
  } else {
    const grid = document.createElement('div');
    grid.className = 'grid';
    root.append(grid);
    const fw = 590;
    const fh = Math.round((fw * 9) / 16);
    for (const [viewH, camX, name] of [
      [15, 10, 'вид рогатки 15 м'],
      [30, 30, 'общий план 30 м'],
    ] as const) {
      for (const t of THEMES) addFrame(grid, fw, fh, t, viewH, camX, `${THEME_INFO[t].name} · ${name}`);
    }
    // соотношения сторон 21:9 и 4:3 — заполнение экрана при обоих видах
    const row = document.createElement('div');
    row.className = 'row';
    root.append(row);
    const hh = 240;
    const w21 = Math.round((hh * 21) / 9);
    const w43 = Math.round((hh * 4) / 3);
    addFrame(row, w21, hh, 'beach', 15, 12, '21:9 · 15 м');
    addFrame(row, w21, hh, 'meadow', 30, 34, '21:9 · 30 м');
    addFrame(row, w43, hh, 'snow', 15, 6, '4:3 · 15 м');
    addFrame(row, w43, hh, 'beach', 30, 26, '4:3 · 30 м');
    const perf = document.createElement('pre');
    perf.id = 'perf';
    perf.textContent = 'замер…';
    root.append(perf);
  }
  const t0 = performance.now();
  const timeNow = (): number => (fixedT !== null ? fixedT : 4 + (performance.now() - t0) / 1000);
  // ?warm=N — N кадров сразу (достроить тайлы рельефа и полосы до снимка)
  const warm = Math.max(1, Number(params.get('warm') ?? 1));
  for (let i = 0; i < warm; i++) renderAll(timeNow(), i === warm - 1);
  const perfEl = document.getElementById('perf');
  if (perfEl && params.get('perf') === '0') perfEl.textContent = 'замер отключён (?perf=0)';
  if (perfEl && params.get('perf') !== '0') {
    setTimeout(() => {
      const lines: string[] = [
        'draw() на 1920×1080, dpr 1, мс (avg / p95 / max по 40 кадрам после прогрева; панорама 0.15 м/кадр — новые тайлы рельефа строятся по ходу).',
        '«запись» — время вызова (обычный холст: растеризация в GPU/композиторе); «растр» — с растеризацией на CPU (худший случай без GPU).',
        '«зум» — масштаб меняется каждый кадр (полосы масштабируются); «зум, быстро» — то же с fastScaling (без сглаживания).',
      ];
      const res: Record<string, Record<string, Stat>> = {};
      for (const t of THEMES) {
        res[t] = measure(t);
        const m = res[t];
        const f = (k: string): string => {
          const s = m[k];
          return s ? `${s.avg.toFixed(2)} / ${s.p95.toFixed(2)} / ${s.max.toFixed(2)}` : '—';
        };
        const row = (name: string, key: string, id: string): string => `  ${name.padEnd(16)} запись ${f(`${key}:record:${id}`)} · растр ${f(`${key}:raster:${id}`)}`;
        lines.push(`${THEME_INFO[t].name}: построение полос и облаков (холодный старт) ${m['build:15']?.avg.toFixed(1)} мс`);
        lines.push(row('фон 15 м', 'bg', '15'));
        lines.push(row('фон 30 м', 'bg', '30'));
        lines.push(row('фон, зум', 'bg', 'zoom'));
        lines.push(row('фон, зум быстро', 'bg', 'zoomFast'));
        lines.push(row('рельеф 15 м', 'terrain', '15'));
        lines.push(row('рельеф 30 м', 'terrain', '30'));
        lines.push(row('передний план', 'fg', '15'));
        if (params.get('phases') === '1')
          for (const id of ['15', '30'])
            lines.push(
              `  фазы ${id}: ` +
                Object.keys(m)
                  .filter((k) => k.startsWith('phase:') && k.endsWith(`:${id}`))
                  .map((k) => `${k.split(':')[1]} ${m[k].avg.toFixed(2)}`)
                  .join(', '),
            );
      }
      perfEl.textContent = lines.join('\n');
      (window as unknown as { __perf: unknown }).__perf = res;
    }, 50);
  }
  if (animate) {
    let last = 0;
    const loop = (now: number): void => {
      if (now - last > 33) {
        last = now;
        renderAll(timeNow());
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  (window as unknown as { __done: boolean }).__done = true;
}

document.fonts.load(`20px ${FONT}`).finally(build);
