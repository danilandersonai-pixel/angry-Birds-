// Предпросмотр фонов и рельефа.
//   (без параметров) — 3 темы × {вид рогатки 15 м, общий план 30 м} на тестовом рельефе, кадры 21:9 и 4:3,
//                      замер draw() и памяти (1920×1080 и 2560×1440 ≈ «dpr 2») против бюджетов 04 §10.6.
//   ?theme=meadow|beach|snow — одна тема крупно; &view=aim|wide; &aspect=21:9|4:3|16:9; &viewH= &camX= &camY=
//   ?level=2-1 — настоящий уровень: его рельеф (соседние полигоны грунта слиты), блоки, TNT, свиньи, рогатка, очередь;
//                камера — как в игре (Camera): &view=aim (по умолчанию) | wide (общий план) | castle
//   ?levels=all|1|2|3 — сетка уровней (эпизод) на общем плане (&view=aim — вид рогатки)
//   ?scene=test|stress|levels — синтетический рельеф: тестовый / сложный (долина, стена, нависание) / из префабов уровней
//   ?shake=0.5 — поворот кадра от тряски, градусы (рельеф, тела и передний план — в одной трансформации, shakeFrame)
//   ?t=секунды — фиксированное время сцены; ?anim=0 — один кадр; ?warm=N — N кадров сразу; ?perf=0 — без замера;
//   ?perf=only — только замер (без кадров: их кэши не давят на память во время замера);
//   ?quality=high|med|low — ступень качества фона

import '@fontsource/rubik/700.css';
import type { BirdType, LevelDef, Material, PigType, TerrainDef, ThemeId } from '../core/types';
import type { Sprite } from '../render/sprites/api';
import { BIRDS, CAMERA, PIGS, SLINGSHOT, TNT } from '../config/constants';
import { renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';
import { renderBlock, renderTnt } from '../render/sprites/blocks';
import { drawBand, drawPouch, renderSlingshot } from '../render/sprites/slingshot';
import { Background, THEME_INFO, drawForeground, shakeFrame, type BgQuality } from '../render/sprites/background';
import { TerrainRenderer } from '../render/sprites/terrain';
import type { ViewInfo } from '../render/view';
import { Camera } from '../render/Camera';
import { ALL_LEVELS, EPISODES, findLevel } from '../levels/index';
import { cliff, flatGround, hill, plateau, platform } from '../levels/prefabs';

const params = new URLSearchParams(location.search);
const THEMES: ThemeId[] = ['meadow', 'beach', 'snow'];
const dpr = window.devicePixelRatio || 1;
const FONT = 'Rubik, "Arial Rounded MT Bold", sans-serif';
const fixedT = params.has('t') ? Number(params.get('t')) : null;
const animate = params.get('anim') !== '0' && fixedT === null;
const shakeDeg = Number(params.get('shake') ?? 0);
const quality = (params.get('quality') as BgQuality | null) ?? 'high';

// ───────────────────────── сцены ─────────────────────────

interface Body {
  kind: 'block' | 'tnt' | 'pig';
  m?: Material;
  shape?: 'rect' | 'circle' | 'triangle' | 'isoTriangle';
  pig?: PigType;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
}

interface Scene {
  terrain: TerrainDef[];
  bodies: Body[];
  sling: { x: number; y: number };
  birds: BirdType[];
  groundRef: number;
}

const rect = (m: Material, x: number, y: number, w: number, h: number): Body => ({ kind: 'block', m, shape: 'rect', x, y, w, h, angle: 0 });
const pigAt = (t: PigType, x: number, yBase: number): Body => ({ kind: 'pig', pig: t, x, y: yBase + PIGS[t].radius, w: 0, h: 0, angle: 0 });

const TEST: Scene = {
  terrain: [
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
  ],
  bodies: [
    rect('wood', 28.25, 4, 0.5, 2),
    rect('wood', 31.75, 4, 0.5, 2),
    rect('wood', 30, 5.25, 4, 0.5),
    rect('ice', 28.5, 6, 1, 1),
    rect('stone', 31.5, 6, 1, 1),
    rect('stone', 35.5, 4, 0.5, 2),
    rect('stone', 38.5, 4, 0.5, 2),
    rect('ice', 37, 5.25, 4, 0.5),
    rect('wood', 48.2, 2.6, 1, 1),
    rect('ice', 54.2, 6.5, 0.5, 2),
    rect('ice', 57.3, 6.5, 0.5, 2),
    rect('wood', 55.75, 7.75, 4, 0.5),
    rect('wood', 63, 0.5, 1, 1),
    rect('wood', 64, 0.5, 1, 1),
    rect('stone', 63.5, 1.5, 1, 1),
    pigAt('medium', 30, 3),
    pigAt('small', 37, 3),
    pigAt('helmet', 49.7, 2.1),
    pigAt('large', 55.75, 5.5),
    pigAt('king', 30, 5.5),
  ],
  sling: { x: SLINGSHOT.ANCHOR.x, y: SLINGSHOT.ANCHOR.y },
  birds: ['red', 'blues', 'chuck', 'bomb'],
  groundRef: 0,
};

/** Сложный рельеф: V-образная долина, отвесная стена, нависание, парящий уступ, узкий пик, скала и помосты. */
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

/**
 * Рельеф из настоящих префабов уровней: земля + холм, плато из грунта с откосом и с отвесными стенами, утёс из грунта,
 * скальные плато, помосты — соседние полигоны грунта должны сливаться без швов.
 */
const PREFABS: TerrainDef[] = [
  flatGround(),
  hill(8, 14, 19, 27, 4),
  plateau(31, 37, 3, { slope: 2, kind: 'ground' }),
  plateau(41, 46, 2.5, { kind: 'ground' }),
  plateau(50, 54, 2, { slope: 1 }),
  plateau(57, 60, 4),
  platform(62, 66, 3.5, 0.6),
  cliff(70, 5, 'right', { kind: 'ground' }),
];

function levelScene(lv: LevelDef): Scene {
  const bodies: Body[] = [];
  for (const b of lv.blocks) bodies.push({ kind: 'block', m: b.material, shape: b.shape, x: b.x, y: b.y, w: b.w, h: b.h, angle: b.angle ?? 0 });
  for (const t of lv.tnt ?? []) bodies.push({ kind: 'tnt', x: t.x, y: t.y, w: t.size ?? TNT.SIZE, h: t.size ?? TNT.SIZE, angle: t.angle ?? 0 });
  for (const p of lv.pigs) bodies.push({ kind: 'pig', pig: p.type, x: p.x, y: p.y, w: 0, h: 0, angle: 0 });
  return { terrain: lv.terrain, bodies, sling: lv.slingshot, birds: lv.birds, groundRef: 0 };
}

const sceneName = params.get('scene') ?? 'test';
const synthetic: Scene =
  sceneName === 'stress'
    ? { ...TEST, terrain: STRESS, bodies: [] }
    : sceneName === 'levels'
      ? { ...TEST, terrain: PREFABS, bodies: [] }
      : TEST;

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

/** Спрайт в мире: кадр (тряска) × перенос в экранную точку × масштаб × поворот. */
function drawSprite(ctx: CanvasRenderingContext2D, v: ViewInfo, frame: DOMMatrix, s: Sprite, x: number, y: number, angle = 0): void {
  const k = v.scale / s.ppu;
  const sx = (x - v.camX) * v.scale + v.screenW / 2;
  const sy = v.screenH / 2 - (y - v.camY) * v.scale;
  ctx.setTransform(frame);
  ctx.transform(k, 0, 0, k, sx, sy);
  if (angle) ctx.rotate(-angle);
  ctx.drawImage(s.canvas, -s.ox, -s.oy);
}

const slingFront = new Map<number, Sprite>();

function drawSling(ctx: CanvasRenderingContext2D, v: ViewInfo, frame: DOMMatrix, sc: Scene, part: 'back' | 'front'): void {
  const A = SLINGSHOT.ANCHOR;
  const bx = sc.sling.x - A.x;
  const by = sc.sling.y - A.y;
  const sx = (x: number): number => (x - v.camX) * v.scale + v.screenW / 2;
  const sy = (y: number): number => v.screenH / 2 - (y - v.camY) * v.scale;
  const sl = sprite('sling', v.scale, (ppu) => {
    const r = renderSlingshot(ppu);
    slingFront.set(ppu, r.front);
    return r.back;
  });
  if (part === 'back') {
    drawSprite(ctx, v, frame, sl, bx, by);
    ctx.setTransform(frame);
    drawBand(ctx, sx(bx + SLINGSHOT.PRONG_BACK.x), sy(by + SLINGSHOT.PRONG_BACK.y), sx(sc.sling.x - SLINGSHOT.POUCH_HALF), sy(sc.sling.y), SLINGSHOT.BAND_REST * v.scale);
    return;
  }
  const front = slingFront.get(sl.ppu);
  const Hh = SLINGSHOT.POUCH_HALF;
  const t = SLINGSHOT.BAND_REST * v.scale;
  ctx.setTransform(frame);
  drawPouch(ctx, sx(sc.sling.x), sy(sc.sling.y), -Math.PI / 2, Hh * v.scale, t * 0.85);
  drawBand(ctx, sx(bx + SLINGSHOT.PRONG_FRONT.x), sy(by + SLINGSHOT.PRONG_FRONT.y), sx(sc.sling.x + Hh), sy(sc.sling.y), t);
  if (front) drawSprite(ctx, v, frame, front, bx, by);
}

function drawBodies(ctx: CanvasRenderingContext2D, v: ViewInfo, frame: DOMMatrix, sc: Scene): void {
  sc.bodies.forEach((b, i) => {
    if (b.kind === 'block') {
      const s = sprite(`block:${b.m}:${b.shape}:${b.w}x${b.h}:${i % 3}`, v.scale, (ppu) => renderBlock(b.m!, b.shape!, b.w, b.h, 0, i % 3, ppu));
      drawSprite(ctx, v, frame, s, b.x, b.y, b.angle);
    } else if (b.kind === 'tnt') {
      drawSprite(ctx, v, frame, sprite(`tnt:${b.w}`, v.scale, (ppu) => renderTnt(b.w, ppu)), b.x, b.y, b.angle);
    }
  });
  for (const b of sc.bodies) {
    if (b.kind !== 'pig') continue;
    const t = b.pig!;
    drawSprite(ctx, v, frame, sprite(`pig:${t}`, v.scale, (ppu) => renderPig(t, 'idle', 0, true, PIGS[t].radius, ppu)), b.x, b.y);
  }
  // очередь птиц и птица в кармашке
  const bx = sc.sling.x - SLINGSHOT.ANCHOR.x;
  const by = sc.sling.y - SLINGSHOT.ANCHOR.y;
  let qx = bx - SLINGSHOT.QUEUE_X0;
  for (let i = 1; i < sc.birds.length; i++) {
    const t = sc.birds[i];
    const r = BIRDS[t].radius;
    drawSprite(ctx, v, frame, sprite(`bird:${t}`, v.scale, (ppu) => renderBird(t, 'idle', r, ppu)), qx, by + r);
    if (i + 1 < sc.birds.length) qx -= Math.max(SLINGSHOT.QUEUE_DX, r + BIRDS[sc.birds[i + 1]].radius + 0.2);
  }
  const t0 = sc.birds[0] ?? 'red';
  drawSprite(ctx, v, frame, sprite(`bird:${t0}`, v.scale, (ppu) => renderBird(t0, 'idle', BIRDS[t0].radius, ppu)), sc.sling.x, sc.sling.y);
}

const IDENT = new DOMMatrix();

function renderScene(ctx: CanvasRenderingContext2D, v: ViewInfo, theme: ThemeId, bg: Background, tr: TerrainRenderer, sc: Scene, times?: number[]): void {
  const frame = shakeDeg ? shakeFrame(v, (shakeDeg * Math.PI) / 180) : IDENT;
  const t0 = performance.now();
  bg.draw(ctx, v);
  const t1 = performance.now();
  drawSling(ctx, v, frame, sc, 'back');
  const t2 = performance.now();
  tr.draw(ctx, sc.terrain, theme, v, shakeDeg ? frame : null);
  const t3 = performance.now();
  drawBodies(ctx, v, frame, sc);
  drawSling(ctx, v, frame, sc, 'front');
  const t4 = performance.now();
  drawForeground(ctx, theme, v, sc.groundRef, shakeDeg ? frame : null);
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
  tr: TerrainRenderer;
  scene: Scene;
  pose: { x: number; y: number; viewH: number };
  label: string;
  times: number[][];
}

const frames: Frame[] = [];

function addFrame(parent: HTMLElement, wCss: number, hCss: number, theme: ThemeId, scene: Scene, pose: { x: number; y: number | null; viewH: number }, text: string): void {
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
  // прижим к земле: низ кадра на GROUND_MARGIN ниже опорной земли (00 §1.10)
  const y = pose.y ?? scene.groundRef - CAMERA.GROUND_MARGIN + pose.viewH / 2;
  // у каждого кадра свой фон и свой кэш рельефа — как в игре (один холст — один Background)
  frames.push({ canvas, ctx, cap, theme, bg: new Background(theme, { quality }), tr: new TerrainRenderer(), scene, pose: { x: pose.x, y, viewH: pose.viewH }, label: text, times: [] });
}

function viewOf(f: Frame, time: number): ViewInfo {
  const H = f.canvas.height;
  return { screenW: f.canvas.width, screenH: H, camX: f.pose.x, camY: f.pose.y, scale: H / f.pose.viewH, dpr, time };
}

let lastCap = 0;

function renderAll(time: number, forceCaps = false): void {
  for (const f of frames) {
    f.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const t: number[] = [];
    renderScene(f.ctx, viewOf(f, time), f.theme, f.bg, f.tr, f.scene, t);
    f.times.push(t);
    if (f.times.length > 30) f.times.shift();
  }
  // подписи: среднее время draw() (запись команд) за последние кадры, обновление раз в 0.5 с
  const now = performance.now();
  if (!forceCaps && now - lastCap < 500) return;
  lastCap = now;
  for (const f of frames) {
    const list = f.times.length > 1 ? f.times.slice(1) : f.times;
    const n = list.length;
    if (!n) continue;
    const avg = (i: number): string => (list.reduce((a, t) => a + t[i], 0) / n).toFixed(2);
    f.cap.textContent = `${f.label} · ${f.canvas.width}×${f.canvas.height} · фон ${avg(0)} · рельеф ${avg(1)} · передн. ${avg(2)} мс`;
  }
}

/** Поза камеры уровня как в игре. */
function levelPose(lv: LevelDef, wCss: number, hCss: number, which: string): { x: number; y: number; viewH: number } {
  const cam = new Camera(lv);
  cam.setViewport(wCss, hCss, dpr);
  const p = which === 'wide' ? cam.overview() : which === 'castle' ? cam.castleView() : cam.aimView();
  return { x: p.x, y: p.y, viewH: p.viewH };
}

// ───────────────────────── замер ─────────────────────────

interface Stat {
  avg: number;
  p95: number;
}

function stat(a: number[]): Stat {
  const s = [...a].sort((x, y) => x - y);
  return { avg: a.reduce((p, c) => p + c, 0) / a.length, p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] };
}

/**
 * Замер на холсте W×H: draw() фона, рельефа и переднего плана при панораме (15 и 30 м) и непрерывном зуме.
 * «запись» — время вызова (обычный холст: растеризация в GPU/композиторе); «растр» — с растеризацией на CPU
 * (willReadFrequently + getImageData) — худший случай без GPU. Плюс память кэшей фона и рельефа.
 */
function measure(theme: ThemeId, W: number, H: number, pd: number): Record<string, Stat | number> {
  const out: Record<string, Stat | number> = {};
  for (const flush of [false, true]) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: flush });
    if (!ctx) return out;
    const bg = new Background(theme, { quality });
    const tr = new TerrainRenderer();
    for (const [id, vh, camX, dvh] of [
      ['15', 15, 10, 0],
      ['30', 30, 30, 0],
      ['zoom', 15, 12, 0.1],
    ] as const) {
      const mk = (i: number): ViewInfo => {
        const viewH = vh + i * dvh;
        return { screenW: W, screenH: H, camX: camX + i * 0.12, camY: -CAMERA.GROUND_MARGIN + viewH / 2, scale: H / viewH, dpr: pd, time: i / 60 };
      };
      const base = mk(0);
      bg.prewarm(base);
      tr.prewarm(TEST.terrain, theme, base);
      for (let i = 0; i < 4; i++) {
        bg.draw(ctx, base);
        tr.draw(ctx, TEST.terrain, theme, base);
      }
      ctx.getImageData(0, 0, 1, 1);
      const tb: number[] = [];
      const tt: number[] = [];
      const tf: number[] = [];
      for (let i = 0; i < 40; i++) {
        const v = mk(i);
        let t0 = performance.now();
        bg.draw(ctx, v);
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tb.push(performance.now() - t0);
        t0 = performance.now();
        tr.draw(ctx, TEST.terrain, theme, v);
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tt.push(performance.now() - t0);
        t0 = performance.now();
        drawForeground(ctx, theme, v);
        if (flush) ctx.getImageData(0, 0, 1, 1);
        tf.push(performance.now() - t0);
      }
      const tag = `${flush ? 'raster' : 'record'}:${id}`;
      out[`bg:${tag}`] = stat(tb);
      out[`terrain:${tag}`] = stat(tt);
      out[`fg:${tag}`] = stat(tf);
    }
    if (!flush) {
      out.bgMB = bg.memoryBytes / 1048576;
      out.terrainMB = tr.memoryBytes / 1048576;
    }
    tr.release();
    bg.dispose();
  }
  return out;
}

// ───────────────────────── страница ─────────────────────────

function build(): void {
  const root = document.getElementById('root')!;
  const levelId = params.get('level');
  const levelsGrid = params.get('levels');
  const single = params.get('theme') as ThemeId | null;
  const which = params.get('view') ?? (levelsGrid ? 'wide' : 'aim');
  let perfOn = params.get('perf') !== '0';
  if (levelId || (single && THEMES.includes(single))) {
    const asp = (params.get('aspect') ?? '').split(':').map(Number);
    const W = window.innerWidth;
    let Hh = window.innerHeight;
    let Ww = W;
    if (asp.length === 2 && asp[0] > 0 && asp[1] > 0) {
      const a = asp[0] / asp[1];
      if (W / Hh > a) Ww = Math.round(Hh * a);
      else Hh = Math.round(W / a);
    }
    root.className = 'single';
    if (levelId) {
      const lv = findLevel(levelId);
      if (!lv) {
        root.textContent = `нет уровня ${levelId}`;
        return;
      }
      const pose = levelPose(lv, Ww, Hh, which);
      if (params.has('viewH')) pose.viewH = Number(params.get('viewH'));
      if (params.has('camX')) pose.x = Number(params.get('camX'));
      if (params.has('camY')) pose.y = Number(params.get('camY'));
      addFrame(root, Ww, Hh, lv.theme, levelScene(lv), pose, `${lv.id} «${lv.name}» · ${THEME_INFO[lv.theme].name} · вид ${pose.viewH.toFixed(1)} м`);
    } else {
      const viewH = Number(params.get('viewH') ?? (which === 'wide' ? 30 : 15));
      const camX = Number(params.get('camX') ?? (which === 'wide' ? 30 : 10));
      const camY = params.has('camY') ? Number(params.get('camY')) : null;
      addFrame(root, Ww, Hh, single!, synthetic, { x: camX, y: camY, viewH }, `${THEME_INFO[single!].name} · вид ${viewH} м`);
    }
    perfOn = false;
  } else if (levelsGrid) {
    const grid = document.createElement('div');
    grid.className = 'grid';
    root.append(grid);
    const list = levelsGrid === 'all' ? ALL_LEVELS : (EPISODES[Number(levelsGrid) - 1]?.levels ?? []);
    for (const lv of list) addFrame(grid, 590, 332, lv.theme, levelScene(lv), levelPose(lv, 590, 332, which), `${lv.id} «${lv.name}»`);
    perfOn = false;
  } else if (params.get('perf') === 'only') {
    // только замер: без кадров предпросмотра (их кэши не создают давления памяти на замер)
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
      for (const t of THEMES) addFrame(grid, fw, fh, t, synthetic, { x: camX, y: null, viewH }, `${THEME_INFO[t].name} · ${name}`);
    }
    // соотношения сторон 21:9 и 4:3 — заполнение экрана при обоих видах
    const row = document.createElement('div');
    row.className = 'row';
    root.append(row);
    const hh = 240;
    const w21 = Math.round((hh * 21) / 9);
    const w43 = Math.round((hh * 4) / 3);
    addFrame(row, w21, hh, 'beach', synthetic, { x: 12, y: null, viewH: 15 }, '21:9 · 15 м');
    addFrame(row, w21, hh, 'meadow', synthetic, { x: 34, y: null, viewH: 30 }, '21:9 · 30 м');
    addFrame(row, w43, hh, 'snow', synthetic, { x: 6, y: null, viewH: 15 }, '4:3 · 15 м');
    addFrame(row, w43, hh, 'beach', synthetic, { x: 26, y: null, viewH: 30 }, '4:3 · 30 м');
  }
  const perf = document.createElement('pre');
  perf.id = 'perf';
  root.append(perf);
  if (!perfOn) perf.style.display = 'none';
  const t0 = performance.now();
  const timeNow = (): number => (fixedT !== null ? fixedT : 4 + (performance.now() - t0) / 1000);
  // экран загрузки: фон и тайлы рельефа вида кадра (как Renderer.prewarmWorld)
  for (const f of frames) {
    const v = viewOf(f, timeNow());
    f.bg.prewarm(v);
    f.tr.prewarm(f.scene.terrain, f.theme, v);
  }
  const warm = Math.max(1, Number(params.get('warm') ?? 1));
  for (let i = 0; i < warm; i++) renderAll(timeNow(), i === warm - 1);
  if (perfOn) {
    perf.textContent = 'замер…';
    setTimeout(() => {
      const lines: string[] = [
        `draw(), мс: средн./p95 по 40 кадрам; панорама 0.12 м/кадр; «зум» — масштаб меняется каждый кадр. Качество фона: ${quality}.`,
        '«запись» — время вызова (растр в GPU/композиторе); «растр» — с растеризацией на CPU (без GPU, худший случай).',
        'Бюджет 04 §10.6 (HIGH / LOW): фон ≤ 1.2 / 0.8, рельеф ≤ 0.5 / 0.4, передний план (вместе с очками и следом) ≤ 0.5 / 0.3.',
      ];
      const res: Record<string, Record<string, Stat | number>> = {};
      for (const [W, H, pd, name] of [
        [1920, 1080, 1, '1920×1080 dpr 1'],
        [2560, 1440, 2, '2560×1440 dpr 2'],
      ] as const) {
        lines.push(`── ${name}`);
        for (const t of THEMES) {
          const m = measure(t, W, H, pd);
          res[`${t}:${name}`] = m;
          const f = (k: string): string => {
            const s = m[k] as Stat | undefined;
            return s ? `${s.avg.toFixed(2)}/${s.p95.toFixed(2)}` : '—';
          };
          const row = (key: string, id: string): string => `запись ${f(`${key}:record:${id}`)} растр ${f(`${key}:raster:${id}`)}`;
          lines.push(
            `${THEME_INFO[t].name.padEnd(16)} фон 15 м: ${row('bg', '15')} · 30 м: ${row('bg', '30')} · зум: ${row('bg', 'zoom')}`,
            `${''.padEnd(16)} рельеф 15 м: ${row('terrain', '15')} · 30 м: ${row('terrain', '30')} · зум: ${row('terrain', 'zoom')}`,
            `${''.padEnd(16)} передн.: ${row('fg', '15')} · память: фон ${(m.bgMB as number).toFixed(1)} МБ, рельеф ${(m.terrainMB as number).toFixed(1)} МБ`,
          );
        }
      }
      perf.textContent = lines.join('\n');
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
