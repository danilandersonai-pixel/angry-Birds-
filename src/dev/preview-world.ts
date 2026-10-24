// Предпросмотр фонов и рельефа: 3 темы × {вид рогатки 15 м, общий план 35 м} на одном тестовом рельефе,
// плюс кадры 21:9 и 4:3 (проверка заполнения) и замер производительности draw() на 1920×1080.
// Параметры URL:
//   ?theme=meadow|beach|snow  — одна тема крупно (вид из ?view=aim|wide, по умолчанию aim)
//   &aspect=21:9|4:3|16:9     — соотношение сторон крупного кадра
//   &viewH=…  &camX=…  &camY=…  — ручная камера
//   ?t=секунды — фиксированное время сцены (иначе анимация в реальном времени)
//   ?perf=0 — без замера; ?anim=0 — один кадр

import '@fontsource/lilita-one';
import type { BirdType, PigType, TerrainDef, ThemeId } from '../core/types';
import type { Sprite } from '../render/sprites/api';
import { SLINGSHOT } from '../config/constants';
import { renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';
import { Background, THEME_INFO, drawForeground, drawTerrain } from '../render/sprites/background';
import { applyWorldTransform, type ViewInfo } from '../render/view';

const params = new URLSearchParams(location.search);
const THEMES: ThemeId[] = ['meadow', 'beach', 'snow'];
const dpr = window.devicePixelRatio || 1;
const FONT = '"Lilita One", "Arial Rounded MT Bold", sans-serif';
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
  m: 'wood' | 'ice' | 'stone';
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

const MAT: Record<Box['m'], { light: string; base: string; dark: string; outline: string }> = {
  wood: { light: '#F0C27A', base: '#D08F45', dark: '#9C6030', outline: '#4A2810' },
  ice: { light: '#E6FAFF', base: '#A8E2F8', dark: '#6CC0E8', outline: '#246A9E' },
  stone: { light: '#CDD1D6', base: '#A3A9B0', dark: '#767D86', outline: '#30353C' },
};

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

/** Простая рогатка-заглушка (настоящая — в slingshot.ts у другого модуля). */
function slingPart(ctx: CanvasRenderingContext2D, v: ViewInfo, part: 'back' | 'front'): void {
  ctx.save();
  applyWorldTransform(ctx, v);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const segs: Array<Array<[number, number]>> =
    part === 'back'
      ? [
          [
            [0, -SLINGSHOT.BURY],
            [0.02, 0.6],
            [0, 1.3],
          ],
          [
            [0.02, 1.2],
            [-0.2, 1.6],
            [-0.32, 2.15],
            [SLINGSHOT.PRONG_BACK.x, SLINGSHOT.PRONG_BACK.y],
          ],
        ]
      : [
          [
            [-0.02, 1.2],
            [0.2, 1.6],
            [0.31, 2.15],
            [SLINGSHOT.PRONG_FRONT.x, SLINGSHOT.PRONG_FRONT.y],
          ],
        ];
  for (const [w, col] of [
    [0.4, '#2E190A'],
    [0.31, '#9A5A2A'],
    [0.12, '#CB8645'],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    for (const s of segs) {
      ctx.beginPath();
      s.forEach((p, i) => (i ? ctx.lineTo(p[0] - (w === 0.12 ? 0.06 : 0), p[1]) : ctx.moveTo(p[0] - (w === 0.12 ? 0.06 : 0), p[1])));
      ctx.stroke();
    }
  }
  if (part === 'front') {
    ctx.strokeStyle = '#3B2414';
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    ctx.moveTo(SLINGSHOT.PRONG_FRONT.x, SLINGSHOT.PRONG_FRONT.y);
    ctx.lineTo(SLINGSHOT.ANCHOR.x - 0.3, SLINGSHOT.ANCHOR.y - 0.25);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBlocks(ctx: CanvasRenderingContext2D, v: ViewInfo): void {
  ctx.save();
  applyWorldTransform(ctx, v);
  ctx.lineJoin = 'round';
  for (const b of BLOCKS) {
    const M = MAT[b.m];
    const g = ctx.createLinearGradient(0, b.y + b.h / 2, 0, b.y - b.h / 2);
    g.addColorStop(0, M.light);
    g.addColorStop(0.35, M.base);
    g.addColorStop(1, M.dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, Math.min(b.w, b.h) * (b.m === 'stone' ? 0.14 : 0.07));
    ctx.globalAlpha = b.m === 'ice' ? 0.88 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(0.035, 1.5 / v.scale);
    ctx.strokeStyle = M.outline;
    ctx.stroke();
  }
  ctx.restore();
}

function renderScene(ctx: CanvasRenderingContext2D, v: ViewInfo, theme: ThemeId, bg: Background): void {
  bg.draw(ctx, v);
  slingPart(ctx, v, 'back');
  drawTerrain(ctx, TERRAIN, theme, v);
  drawBlocks(ctx, v);
  ctx.save();
  for (const p of PIGS) drawSprite(ctx, v, sprite(`pig:${p.t}`, v.scale, (ppu) => renderPig(p.t, 'idle', 0, true, p.r, ppu)), p.x, p.y);
  QUEUE.forEach((q, i) =>
    drawSprite(ctx, v, sprite(`bird:${q.t}`, v.scale, (ppu) => renderBird(q.t, 'idle', q.r, ppu)), -SLINGSHOT.QUEUE_X0 - i * SLINGSHOT.QUEUE_DX, q.r),
  );
  drawSprite(ctx, v, sprite('bird:red', v.scale, (ppu) => renderBird('red', 'aim', 0.45, ppu)), SLINGSHOT.ANCHOR.x, SLINGSHOT.ANCHOR.y);
  ctx.restore();
  slingPart(ctx, v, 'front');
  drawForeground(ctx, theme, v);
}

// ───────────────────────── кадры ─────────────────────────

interface Frame {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  theme: ThemeId;
  bg: Background;
  viewH: number;
  camX: number;
  camY: number | null;
  label: string;
}

const frames: Frame[] = [];
const bgPool = new Map<string, Background>();

function bgFor(theme: ThemeId, key: string): Background {
  const k = `${theme}:${key}`;
  let b = bgPool.get(k);
  if (!b) {
    b = new Background(theme);
    bgPool.set(k, b);
  }
  return b;
}

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
  frames.push({ canvas, ctx, theme, bg: bgFor(theme, `${canvas.width}x${canvas.height}`), viewH, camX, camY, label: text });
}

function viewOf(f: Frame, time: number): ViewInfo {
  const H = f.canvas.height;
  const scale = H / f.viewH;
  // прижим к земле: низ кадра на 1.2 м ниже земли (01 §6.1)
  const camY = f.camY ?? -1.2 + f.viewH / 2;
  return { screenW: f.canvas.width, screenH: H, camX: f.camX, camY, scale, dpr, time };
}

function renderAll(time: number): void {
  for (const f of frames) {
    f.ctx.setTransform(1, 0, 0, 1, 0, 0);
    renderScene(f.ctx, viewOf(f, time), f.theme, f.bg);
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

/** Замер на холсте 1920×1080: draw() фона (запись команд и с принудительной растеризацией), рельеф, передний план. */
function measure(theme: ThemeId): Record<string, Stat> {
  const out: Record<string, Stat> = {};
  for (const flush of [false, true]) {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    const ctx = c.getContext('2d', { willReadFrequently: flush });
    if (!ctx) return out;
    const bg = new Background(theme);
    for (const viewH of [15, 35]) {
      const base: ViewInfo = { screenW: 1920, screenH: 1080, camX: viewH === 15 ? 10 : 30, camY: -1.2 + viewH / 2, scale: 1080 / viewH, dpr: 1, time: 0 };
      bg.draw(ctx, base); // прогрев: построение полос
      drawTerrain(ctx, TERRAIN, theme, base);
      ctx.getImageData(0, 0, 1, 1);
      const tb: number[] = [];
      const tt: number[] = [];
      const tf: number[] = [];
      for (let i = 0; i < 40; i++) {
        const v = { ...base, camX: base.camX + i * 0.15, time: i / 60 };
        let t0 = performance.now();
        bg.draw(ctx, v);
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tb.push(performance.now() - t0);
        t0 = performance.now();
        drawTerrain(ctx, TERRAIN, theme, v);
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tt.push(performance.now() - t0);
        t0 = performance.now();
        drawForeground(ctx, theme, v);
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tf.push(performance.now() - t0);
      }
      const tag = `${flush ? 'raster' : 'record'}:${viewH}`;
      out[`bg:${tag}`] = stat(tb);
      out[`terrain:${tag}`] = stat(tt);
      out[`fg:${tag}`] = stat(tf);
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
    const viewH = Number(params.get('viewH') ?? (view === 'wide' ? 35 : 15));
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
      [35, 30, 'общий план 35 м'],
    ] as const) {
      for (const t of THEMES) addFrame(grid, fw, fh, t, viewH, camX, `${THEME_INFO[t].name} · ${name}`);
    }
    const row = document.createElement('div');
    row.className = 'row';
    root.append(row);
    const hh = 330;
    addFrame(row, Math.round((hh * 21) / 9), hh, 'meadow', 40, 28, '21:9 · общий план 40 м');
    addFrame(row, Math.round((hh * 4) / 3), hh, 'snow', 40, 28, '4:3 · общий план 40 м');
    const perf = document.createElement('pre');
    perf.id = 'perf';
    perf.textContent = 'замер…';
    row.append(perf);
  }
  const t0 = performance.now();
  const timeNow = (): number => (fixedT !== null ? fixedT : 4 + (performance.now() - t0) / 1000);
  renderAll(timeNow());
  const perfEl = document.getElementById('perf');
  if (perfEl && params.get('perf') !== '0') {
    setTimeout(() => {
      const lines: string[] = ['draw() на 1920×1080, мс (avg / p95 / max)'];
      const res: Record<string, Record<string, Stat>> = {};
      for (const t of THEMES) {
        res[t] = measure(t);
        const m = res[t];
        const f = (k: string): string => {
          const s = m[k];
          return s ? `${s.avg.toFixed(2)} / ${s.p95.toFixed(2)} / ${s.max.toFixed(2)}` : '—';
        };
        lines.push(`${THEME_INFO[t].name}:`);
        lines.push(`  фон 15 м   запись ${f('bg:record:15')} · растр ${f('bg:raster:15')}`);
        lines.push(`  фон 35 м   запись ${f('bg:record:35')} · растр ${f('bg:raster:35')}`);
        lines.push(`  рельеф 15  растр ${f('terrain:raster:15')}`);
        lines.push(`  передн. 15 растр ${f('fg:raster:15')}`);
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
