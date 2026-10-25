// Предпросмотр эффектов (dev/preview-fx.html).
// Режимы (?mode=):
//   demo  (по умолчанию) — небо, земля, простая постройка; по таймеру (цикл 7 с) приходят события:
//         выстрел со следом, удар, разрушение блоков всех материалов, свиньи, TNT, бонус птиц, яйцо, бомба.
//   sheet — контактный лист: строки — эффекты, столбцы — моменты времени (кадры анимации).
//   bench — ~N частиц постоянно (?n=400), в HUD — время draw (запись команд и с растеризацией).
//   raster — сравнение способов растеризации 400 мелких спрайтов (поворот/масштаб/альфа/пути).
//   blast — замер взрыва: стоимость кадра (fx.draw + растр) и длительность остаточного дыма (window.__blast).
//   sheet&atlas=1 — поверх листа показать страницы атласа спрайтов.
//   sheet&set=blast — только взрывы, до 2.4 с (остаточный дым); sheet&set=score — скопления очков (разнос надписей).
// Прочие параметры: ?dpr=2, ?viewh=16 (высота вида, м), ?t=2.7 — заморозить demo на моменте цикла.
// Для скриптов: window.__fx (demo/bench), window.__bench (bench), window.__sheetDone (sheet).

import '@fontsource/luckiest-guy';
import { drawTrail, Fx } from '../render/fx/Fx';
import { MATERIAL_FX } from '../render/fx/palette';
import { FX_SPRITES, SPR_SPLINTER } from '../render/fx/sprites';
import type { ViewInfo } from '../render/view';
import type { GameEvent } from '../core/events';
import type { TrailPoint } from '../core/api';
import type { BirdType, Material, PigType } from '../core/types';
import type { Sprite } from '../render/sprites/api';
import { renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'demo';
const dpr = Number(params.get('dpr') ?? window.devicePixelRatio ?? 1) || 1;
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const ctx = canvas.getContext('2d', mode === 'blast' ? { willReadFrequently: false } : undefined) as CanvasRenderingContext2D;

function resize(): void {
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
resize();
window.addEventListener('resize', resize);

const w = window as unknown as Record<string, unknown>;

// ── Общая отрисовка фона и простых тел ────────────────────────────────────

function drawSky(c: CanvasRenderingContext2D, x: number, y: number, wd: number, ht: number): void {
  const g = c.createLinearGradient(0, y, 0, y + ht);
  g.addColorStop(0, '#4FB3EE');
  g.addColorStop(1, '#CDEFFF');
  c.fillStyle = g;
  c.fillRect(x, y, wd, ht);
}

function drawGround(c: CanvasRenderingContext2D, v: ViewInfo, x0: number, x1: number): void {
  const gy = v.screenH / 2 + v.camY * v.scale; // экранная y для мировой y = 0
  const s = v.scale;
  c.fillStyle = '#8A5A2E';
  c.fillRect(x0, gy, x1 - x0, v.screenH - gy);
  c.fillStyle = '#6DBB3C';
  c.fillRect(x0, gy - 0.05 * s, x1 - x0, 0.32 * s);
  c.fillStyle = '#4E9A2A';
  c.fillRect(x0, gy + 0.27 * s, x1 - x0, 0.06 * s);
}

interface BlockBox {
  mat: Material;
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
}

function drawBlock(c: CanvasRenderingContext2D, v: ViewInfo, b: BlockBox): void {
  const m = MATERIAL_FX[b.mat];
  const s = v.scale;
  const sx = (b.x - b.w / 2 - v.camX) * s + v.screenW / 2;
  const sy = v.screenH / 2 - (b.y + b.h / 2 - v.camY) * s;
  c.setTransform(1, 0, 0, 1, 0, 0);
  const g = c.createLinearGradient(0, sy, 0, sy + b.h * s);
  g.addColorStop(0, m.light);
  g.addColorStop(1, m.dark);
  c.globalAlpha = b.mat === 'ice' ? 0.88 : 1;
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(sx, sy, b.w * s, b.h * s, Math.min(b.w, b.h) * s * 0.1);
  c.fill();
  c.globalAlpha = 1;
  c.strokeStyle = m.outline;
  c.lineWidth = Math.max(1.5, 0.035 * s);
  c.stroke();
}

const spriteCache = new Map<string, Sprite | null>();
function charSprite(key: string, make: () => Sprite): Sprite | null {
  if (!spriteCache.has(key)) {
    try {
      spriteCache.set(key, make());
    } catch {
      spriteCache.set(key, null); // модуль спрайтов в разработке — рисуем запасной круг
    }
  }
  return spriteCache.get(key) ?? null;
}

function drawChar(c: CanvasRenderingContext2D, v: ViewInfo, spr: Sprite | null, x: number, y: number, r: number, color: string): void {
  const sx = (x - v.camX) * v.scale + v.screenW / 2;
  const sy = v.screenH / 2 - (y - v.camY) * v.scale;
  if (spr) {
    const k = v.scale / spr.ppu;
    c.setTransform(k, 0, 0, k, sx, sy);
    c.drawImage(spr.canvas, -spr.ox, -spr.oy);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = color;
  c.beginPath();
  c.arc(sx, sy, r * v.scale, 0, Math.PI * 2);
  c.fill();
}

const birdSpr = (t: BirdType, r: number, s: number) => charSprite(`b:${t}:${s}`, () => renderBird(t, 'fly', r, s));
const pigSpr = (t: PigType, r: number, s: number) => charSprite(`p:${t}:${s}`, () => renderPig(t, 'idle', 0, t === 'helmet', r, s));

// ── Демо-сцена ───────────────────────────────────────────────────────────

function runDemo(): void {
  const fx = new Fx();
  w.__fx = fx;
  const viewH = Number(params.get('viewh') ?? 16);
  if (params.get('prewarm') !== '0') w.__prewarmMs = fx.prewarm(canvas.height / viewH);
  const freezeAt = params.has('t') ? Number(params.get('t')) : null;
  const CYCLE = 7;

  const blocks: BlockBox[] = [
    { mat: 'wood', x: 16, y: 1, w: 0.5, h: 2, alive: true },
    { mat: 'wood', x: 19, y: 1, w: 0.5, h: 2, alive: true },
    { mat: 'wood', x: 17.5, y: 2.25, w: 4, h: 0.5, alive: true },
    { mat: 'ice', x: 17.5, y: 3, w: 1, h: 1, alive: true },
    { mat: 'stone', x: 21, y: 1, w: 0.5, h: 2, alive: true },
    { mat: 'stone', x: 23, y: 1, w: 0.5, h: 2, alive: true },
    { mat: 'stone', x: 22, y: 2.25, w: 3, h: 0.5, alive: true },
    { mat: 'ice', x: 22, y: 2.75, w: 2, h: 0.5, alive: true },
  ];
  const pigs = [
    { type: 'medium' as PigType, x: 17.5, y: 0.61, r: 0.6075, alive: true },
    { type: 'helmet' as PigType, x: 22, y: 0.63, r: 0.63, alive: true },
  ];
  let tntAlive = true;

  // Полёт: старт (0, 2.7), v = (15, 8.25), g = 15 — удар о балку при t ≈ 1.1 с.
  const VX = 15;
  const VY = 8.25;
  const birdAt = (t: number) => ({ x: VX * t, y: 2.7 + VY * t - 7.5 * t * t });
  const trail: TrailPoint[] = [];
  let lastTrail = { x: 0, y: 2.7 };
  let birdVisible = false;
  let birdPos = { x: 0, y: 2.7 };

  const destroyBlock = (i: number, vx: number, vy: number): GameEvent[] => {
    const b = blocks[i];
    b.alive = false;
    return [
      { type: 'blockDestroyed', id: i, material: b.mat, shape: 'rect', x: b.x, y: b.y, w: b.w, h: b.h, angle: 0, vx, vy, points: 500 },
      { type: 'score', points: 500, x: b.x, y: b.y, kind: 'block' },
    ];
  };

  const timeline: Array<[number, () => GameEvent[]]> = [
    [0, () => [{ type: 'birdLaunched', id: 1, bird: 'red', x: 0, y: 2.7, power: 1 }]],
    [1.1, () => [
      { type: 'birdImpact', id: 1, bird: 'red', x: 16.4, y: 2.6, speed: 17 },
      { type: 'impact', x: 16.4, y: 2.6, impulse: 28, a: 'bird', b: 'wood' },
      { type: 'blockDamaged', id: 3, material: 'ice', x: 17.5, y: 3, stage: 2 },
      ...destroyBlock(2, 6, 1),
    ]],
    [1.35, () => [...destroyBlock(0, 4, 0), ...destroyBlock(3, 3, 2)]],
    [1.6, () => [
      { type: 'pigDamaged', id: 10, pig: 'medium', x: 17.5, y: 0.61, stage: 1 },
      { type: 'impact', x: 17.5, y: 1.1, impulse: 7, a: 'wood', b: 'pig' },
      { type: 'blockDamaged', id: 6, material: 'stone', x: 22, y: 2.25, stage: 1 },
    ]],
    [1.9, () => {
      pigs[0].alive = false;
      return [
        { type: 'pigDestroyed', id: 10, pig: 'medium', x: 17.5, y: 0.61, radius: 0.6075, points: 5000 },
        { type: 'score', points: 5000, x: 17.5, y: 0.61, kind: 'pig' },
        ...destroyBlock(1, 3, 0),
      ];
    }],
    [2.6, () => {
      tntAlive = false;
      return [
        { type: 'tntDestroyed', id: 20, x: 20, y: 0.5, points: 500 },
        { type: 'explosion', x: 20, y: 0.5, radius: 3, source: 'tnt' },
        { type: 'score', points: 500, x: 20, y: 0.5, kind: 'tnt' },
        { type: 'pigDamaged', id: 11, pig: 'helmet', x: 22, y: 0.63, stage: 1, helmetLost: true },
        ...destroyBlock(4, 8, 6),
        ...destroyBlock(7, 6, 8),
      ];
    }],
    [3.0, () => {
      pigs[1].alive = false;
      return [
        { type: 'pigDestroyed', id: 11, pig: 'helmet', x: 22, y: 0.63, radius: 0.63, points: 5000 },
        { type: 'score', points: 5000, x: 22, y: 0.63, kind: 'pig' },
        ...destroyBlock(6, 5, 3),
        ...destroyBlock(5, 4, 1),
      ];
    }],
    [3.6, () => {
      birdVisible = false;
      return [{ type: 'birdRemoved', id: 1, bird: 'red', x: birdPos.x, y: birdPos.y }];
    }],
    [4.2, () => [{ type: 'birdBonus', bird: 'chuck', x: -1.6, y: 1.4, points: 10000 }, { type: 'score', points: 10000, x: -1.6, y: 1.4, kind: 'bonus' }]],
    [4.65, () => [{ type: 'birdBonus', bird: 'blues', x: -2.7, y: 1.4, points: 10000 }]],
    [5.0, () => [
      { type: 'ability', id: 2, bird: 'matilda', x: 9, y: 9 },
      { type: 'explosion', x: 9, y: 5.5, radius: 2.5, source: 'egg' },
    ]],
    [5.6, () => [{ type: 'explosion', x: 13, y: 1.2, radius: 3.5, source: 'bomb' }]],
  ];

  let cycleT = 0;
  let next = 0;
  let shake = { amp: 0, t: 0, dur: 0 };
  let sceneTime = 0;

  const resetCycle = () => {
    for (const b of blocks) b.alive = true;
    for (const p of pigs) p.alive = true;
    tntAlive = true;
    trail.length = 0;
    lastTrail = { x: 0, y: 2.7 };
    birdVisible = true;
    next = 0;
    cycleT = 0;
  };
  resetCycle();

  const step = (dt: number) => {
    sceneTime += dt;
    cycleT += dt;
    if (cycleT >= CYCLE) resetCycle();
    while (next < timeline.length && timeline[next][0] <= cycleT) {
      for (const e of timeline[next][1]()) fx.handle(e);
      next++;
    }
    // птица и след
    if (birdVisible) {
      if (cycleT < 1.1) {
        birdPos = birdAt(cycleT);
        const d = Math.hypot(birdPos.x - lastTrail.x, birdPos.y - lastTrail.y);
        if (d >= 0.45) {
          trail.push({ x: birdPos.x, y: birdPos.y, big: trail.length === 9 });
          lastTrail = { ...birdPos };
        }
      } else {
        // после удара — скатывается к земле
        const k = Math.min(1, (cycleT - 1.1) / 0.8);
        birdPos = { x: 16.4 + 0.8 * k, y: 2.6 - 2.15 * k * k };
      }
    }
    fx.update(dt);
    const sh = fx.takeShake();
    if (sh) shake = { amp: Math.min(0.35, shake.amp * (1 - shake.t / Math.max(shake.dur, 1e-6)) ** 2 + sh.amount), t: 0, dur: sh.duration };
    shake.t += dt;
  };

  if (freezeAt !== null) {
    const dt = 1 / 60;
    for (let t = 0; t < freezeAt; t += dt) step(dt);
  }

  let last = performance.now();
  const times: number[] = [];
  const frame = (now: number) => {
    // первый кадр: метка rAF может быть раньше performance.now() — отрицательный dt давал NaN в тряске
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    if (freezeAt === null) step(dt);
    const W = canvas.width;
    const H = canvas.height;
    const scale = H / viewH;
    // тряска камеры (01-gameplay §6.4)
    let sx = 0;
    let sy = 0;
    if (shake.dur > 0 && shake.t < shake.dur) {
      const a = shake.amp * (1 - shake.t / shake.dur) ** 2;
      const n = (t: number, k: number) => 0.6 * Math.sin(2 * Math.PI * 7.3 * t + k) + 0.4 * Math.sin(2 * Math.PI * 13.1 * t + 1.7 * k);
      sx = a * n(sceneTime, 0);
      sy = a * n(sceneTime, 2.1);
    }
    const viewW = W / scale;
    const view: ViewInfo = { screenW: W, screenH: H, scale, dpr, camX: Math.max(-3.5 + viewW / 2, 25 - viewW / 2) + sx, camY: viewH / 2 - 1.2 + sy, time: sceneTime };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSky(ctx, 0, 0, W, H);
    drawGround(ctx, view, 0, W);
    drawTrail(ctx, view, trail);
    for (const b of blocks) if (b.alive) drawBlock(ctx, view, b);
    if (tntAlive) drawBlock(ctx, view, { mat: 'wood', x: 20, y: 0.5, w: 1, h: 1, alive: true });
    for (const p of pigs) if (p.alive) drawChar(ctx, view, pigSpr(p.type, p.r, scale), p.x, p.y, p.r, '#6EC03A');
    if (birdVisible) drawChar(ctx, view, birdSpr('red', 0.45, scale), birdPos.x, birdPos.y, 0.45, '#D7262E');
    for (let i = 0; i < 2; i++) drawChar(ctx, view, birdSpr(i ? 'blues' : 'chuck', i ? 0.252 : 0.495, scale), -1.6 - i * 1.1, i ? 0.252 : 0.5, 0.4, '#F9D23C');
    const t0 = performance.now();
    fx.draw(ctx, view);
    fx.drawFlash(ctx, view);
    times.push(performance.now() - t0);
    if (times.length > 60) times.shift();
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    hud.textContent = `demo  t=${cycleT.toFixed(2)}  fx.count=${fx.count}  particles=${fx.particleCount}  popups=${fx.popupCount}  draw=${avg.toFixed(3)} ms`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ── Контактный лист ──────────────────────────────────────────────────────

function runSheet(): void {
  const set = params.get('set') ?? 'all';
  const T =
    set === 'blast'
      ? [0.05, 0.15, 0.3, 0.5, 0.75, 1.0, 1.3, 1.6, 1.9, 2.3]
      : set === 'score'
        ? [0.05, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2]
        : [0.03, 0.08, 0.15, 0.25, 0.4, 0.6, 0.85, 1.15, 1.5, 1.9];
  interface Row {
    name: string;
    scale: number; // пикс./м при dpr 1
    oy: number; // мировая y начала эффекта (земля — y = 0)
    events: GameEvent[];
    /** События позже нуля: [момент, события]. */
    later?: Array<[number, GameEvent[]]>;
  }
  const blk = (material: Material, w: number, h: number, vx = 0, vy = 0): GameEvent[] => [
    { type: 'blockDestroyed', id: 1, material, shape: 'rect', x: 0, y: 1.2, w, h, angle: 0.2, vx, vy, points: 500 },
    { type: 'score', points: 500, x: 0, y: 1.2, kind: 'block' },
  ];
  const brk = (material: Material, x: number, y: number, points: number): GameEvent[] => [
    { type: 'blockDestroyed', id: 1, material, shape: 'rect', x, y, w: 1, h: 0.5, angle: 0, vx: 0, vy: 0, points },
    { type: 'score', points, x, y, kind: 'block' },
  ];
  const pig = (x: number, y: number, r = 0.6): GameEvent[] => [
    { type: 'pigDestroyed', id: 1, pig: 'medium', x, y, radius: r, points: 5000 },
    { type: 'score', points: 5000, x, y, kind: 'pig' },
  ];
  const allRows: Row[] = [
    { name: 'дерево 2×0.5', scale: 38, oy: 1.2, events: blk('wood', 2, 0.5, 3, 0) },
    { name: 'лёд 1×1', scale: 38, oy: 1.2, events: blk('ice', 1, 1) },
    { name: 'камень 2×0.5', scale: 38, oy: 1.2, events: blk('stone', 2, 0.5, -2, 2) },
    {
      name: 'урон блоков',
      scale: 38,
      oy: 1.2,
      events: [
        { type: 'blockDamaged', id: 1, material: 'wood', x: -1.5, y: 1.2, stage: 1 },
        { type: 'blockDamaged', id: 2, material: 'ice', x: 0, y: 1.2, stage: 2 },
        { type: 'blockDamaged', id: 3, material: 'stone', x: 1.5, y: 1.2, stage: 3 },
      ],
    },
    {
      name: 'свинья: удар, смерть',
      scale: 38,
      oy: 1.0,
      events: [
        { type: 'pigDamaged', id: 1, pig: 'helmet', x: 0, y: 1, stage: 1, helmetLost: true },
        { type: 'pigDestroyed', id: 1, pig: 'medium', x: 0, y: 1, radius: 0.6075, points: 5000 },
        { type: 'score', points: 5000, x: 0, y: 1, kind: 'pig' },
      ],
    },
    {
      name: 'перья + пуф птицы',
      scale: 38,
      oy: 1.5,
      events: [
        { type: 'birdImpact', id: 1, bird: 'red', x: -0.8, y: 1.5, speed: 20 },
        { type: 'birdRemoved', id: 2, bird: 'chuck', x: 1, y: 1.5 },
        { type: 'impact', x: 0, y: 0.1, impulse: 12, a: 'bird', b: 'ground' },
      ],
    },
    { name: 'TNT (R 3)', scale: 20, oy: 0.5, events: [{ type: 'tntDestroyed', id: 1, x: 0, y: 0.5, points: 500 }, { type: 'explosion', x: 0, y: 0.5, radius: 3, source: 'tnt' }] },
    { name: 'Bomb (R 3.5) в воздухе', scale: 18, oy: 4, events: [{ type: 'explosion', x: 0, y: 4, radius: 3.5, source: 'bomb' }] },
    {
      name: 'очки',
      scale: 38,
      oy: 1,
      events: [
        { type: 'blockDestroyed', id: 1, material: 'wood', shape: 'rect', x: -1.6, y: 1, w: 0.2, h: 0.2, angle: 0, vx: 0, vy: 0, points: 500 },
        { type: 'score', points: 500, x: -1.6, y: 1, kind: 'block' },
        { type: 'score', points: 5000, x: 0, y: 0.4, kind: 'pig' },
        { type: 'birdBonus', bird: 'red', x: 1.6, y: 1, points: 10000 },
      ],
    },
  ];
  const blastRows: Row[] = [
    { name: 'TNT (R 3) у земли', scale: 20, oy: 0.5, events: [{ type: 'tntDestroyed', id: 1, x: 0, y: 0.5, points: 500 }, { type: 'explosion', x: 0, y: 0.5, radius: 3, source: 'tnt' }] },
    { name: 'Bomb (R 3.5) в воздухе', scale: 18, oy: 4, events: [{ type: 'explosion', x: 0, y: 4, radius: 3.5, source: 'bomb' }] },
    { name: 'яйцо (R 2.5)', scale: 22, oy: 3, events: [{ type: 'explosion', x: 0, y: 3, radius: 2.5, source: 'egg' }] },
    {
      name: 'Bomb у земли + блоки',
      scale: 18,
      oy: 1.2,
      events: [
        { type: 'explosion', x: 0, y: 1.2, radius: 3.5, source: 'bomb' },
        ...brk('wood', 1, 1, 500),
        ...brk('stone', -1, 2, 500),
        ...pig(0.5, 0.6),
      ],
    },
  ];
  const scoreRows: Row[] = [
    {
      name: 'взрыв: 2 свиньи, 4 блока, TNT',
      scale: 30,
      oy: 1,
      events: [
        ...pig(0, 0.6),
        ...brk('stone', 0.4, 1.2, 1310),
        ...brk('wood', -0.5, 0.8, 556),
        ...brk('ice', 0.8, 0.4, 798),
        { type: 'tntDestroyed', id: 9, x: -0.2, y: 0.3, points: 500 },
        { type: 'score', points: 500, x: -0.2, y: 0.3, kind: 'tnt' },
      ],
      later: [[0.12, [...pig(0.3, 1.5, 0.45), ...brk('stone', -0.3, 1.9, 1151)]]],
    },
    {
      name: 'блоки в одной точке по очереди',
      scale: 30,
      oy: 1,
      events: brk('wood', 0, 1, 500),
      later: [
        [0.3, brk('wood', 0.1, 1, 520)],
        [0.55, brk('stone', -0.1, 1.1, 640)],
        [0.75, pig(0, 0.8)],
      ],
    },
    {
      name: 'свинья, затем блок рядом',
      scale: 30,
      oy: 1,
      events: pig(0, 0.6),
      later: [[0.2, brk('wood', 0.3, 1.8, 500)], [0.45, brk('ice', -0.2, 1.4, 500)]],
    },
    {
      name: 'блок, затем свинья под ним',
      scale: 30,
      oy: 1,
      events: brk('stone', 0, 2, 500),
      later: [[0.15, pig(0.2, 0.6)], [0.3, pig(-0.6, 0.7, 0.45)]],
    },
  ];
  const rows = set === 'blast' ? blastRows : set === 'score' ? scoreRows : allRows;
  const W = canvas.width;
  const H = canvas.height;
  const labelW = 150 * dpr;
  const cw = (W - labelW) / T.length;
  const ch = H / rows.length;
  ctx.fillStyle = '#20313d';
  ctx.fillRect(0, 0, W, H);
  ctx.font = `${12 * dpr}px monospace`;
  rows.forEach((row, ri) => {
    T.forEach((t, ci) => {
      const fx = new Fx();
      for (const e of row.events) fx.handle(e);
      const later = [...(row.later ?? [])];
      const dt = 1 / 60;
      let tt = 0;
      while (tt + dt <= t + 1e-9) {
        fx.update(dt);
        tt += dt;
        while (later.length && later[0][0] <= tt + 1e-9) for (const e of later.shift()![1]) fx.handle(e);
      }
      const x0 = labelW + ci * cw;
      const y0 = ri * ch;
      const scale = row.scale * dpr;
      const ccx = x0 + cw / 2;
      const ccy = y0 + ch * 0.62;
      const view: ViewInfo = {
        screenW: W,
        screenH: H,
        scale,
        dpr,
        camX: 0 - (ccx - W / 2) / scale,
        camY: row.oy + (ccy - H / 2) / scale,
        time: t,
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0 + 1, y0 + 1, cw - 2, ch - 2);
      ctx.clip();
      drawSky(ctx, x0, y0, cw, ch);
      drawGround(ctx, view, x0, x0 + cw);
      fx.draw(ctx, view);
      fx.drawFlash(ctx, view);
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(`${t.toFixed(2)} с`, x0 + 6 * dpr, y0 + 14 * dpr);
    });
    ctx.fillStyle = '#e8f4ff';
    ctx.fillText(row.name, 8 * dpr, ri * ch + ch / 2);
  });
  if (params.get('atlas') === '1') {
    // страницы атласа спрайтов поверх листа (проверка упаковки и зазоров)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    FX_SPRITES.pageCanvases.forEach((pc, i) => {
      ctx.fillStyle = '#556';
      ctx.fillRect(i * (pc.width + 10), 0, pc.width, pc.height);
      ctx.drawImage(pc, i * (pc.width + 10), 0);
    });
  }
  hud.style.display = 'none';
  w.__sheetDone = true;
}

// ── Нагрузочный тест ─────────────────────────────────────────────────────

function runBench(): void {
  const fx = new Fx();
  w.__fx = fx;
  const target = Number(params.get('n') ?? 400);
  // ?mix=debris — только обломки/перья (без больших облаков дыма): отделяет стоимость «на частицу» от заливки
  const debrisOnly = params.get('mix') === 'debris';
  const viewH = 15;
  const mats: Material[] = ['wood', 'ice', 'stone'];
  const birds: BirdType[] = ['red', 'chuck', 'blues', 'bomb'];
  const rec: number[] = [];
  const tot: number[] = [];
  const base: number[] = [];
  let k = 0;
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const W = canvas.width;
    const H = canvas.height;
    const scale = H / viewH;
    const viewW = W / scale;
    // поддерживаем ~target частиц разного вида
    let guard = 0;
    while (fx.particleCount < target && guard++ < 20) {
      const x = 2 + Math.random() * (viewW - 4);
      const y = 1 + Math.random() * 6;
      const r = debrisOnly ? k++ % 4 : k++ % 6;
      if (r < 3) fx.handle({ type: 'blockDestroyed', id: k, material: mats[r], shape: 'rect', x, y, w: 2, h: 0.5, angle: 0, vx: 0, vy: 0, points: 500 });
      else if (r === 3) fx.handle({ type: 'birdImpact', id: k, bird: birds[k % 4], x, y, speed: 20 });
      else if (r === 4) fx.handle({ type: 'pigDestroyed', id: k, pig: 'medium', x, y, radius: 0.6, points: 5000 });
      else fx.handle({ type: 'explosion', x, y, radius: 2.5, source: 'bomb' });
      if (k % 5 === 0) fx.handle({ type: 'score', points: 5000, x, y, kind: 'pig' });
    }
    fx.update(dt);
    fx.takeShake();
    const view: ViewInfo = { screenW: W, screenH: H, scale, dpr, camX: viewW / 2, camY: viewH / 2 - 1.2, time: now / 1000 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSky(ctx, 0, 0, W, H);
    drawGround(ctx, view, 0, W);
    ctx.getImageData(0, 0, 1, 1); // растеризовать фон до замера
    const tb = performance.now();
    ctx.getImageData(0, 0, 1, 1); // пустое чтение — стоимость самой синхронизации
    const t0 = performance.now();
    fx.draw(ctx, view);
    const t1 = performance.now();
    ctx.getImageData(0, 0, 1, 1); // принудительная растеризация команд Fx
    const t2 = performance.now();
    if (fx.particleCount >= target * 0.9) {
      rec.push(t1 - t0);
      tot.push(t2 - t0);
      base.push(t0 - tb);
      if (rec.length > 120) {
        rec.shift();
        tot.shift();
        base.shift();
      }
    }
    const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : 0);
    const r = { particles: fx.particleCount, popups: fx.popupCount, recordMs: med(rec), totalMs: med(tot), syncMs: med(base), samples: rec.length };
    w.__bench = r;
    hud.textContent = `bench  particles=${r.particles}  popups=${r.popups}  draw (запись)=${r.recordMs.toFixed(3)} ms  draw+растр=${r.totalMs.toFixed(3)} ms  (пустая синхр. ${r.syncMs.toFixed(3)} ms; медиана ${r.samples} кадров)`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ── Растр: что стоит дороже в этом браузере (поворот, масштаб, альфа, пути) ──

function runRaster(): void {
  const N = Number(params.get('n') ?? 400);
  const W = canvas.width;
  const H = canvas.height;
  const pts = Array.from({ length: N }, () => ({ x: 20 + Math.random() * (W - 40), y: 20 + Math.random() * (H - 40), a: Math.random() * 6.28, al: 0.4 + Math.random() * 0.6 }));
  const spr = FX_SPRITES.get(SPR_SPLINTER[0], 18);
  const k = 18 / spr.P;
  const variants: Record<string, () => void> = {
    rotScaleAlpha: () => {
      for (const p of pts) {
        const c = Math.cos(p.a) * k;
        const s = Math.sin(p.a) * k;
        ctx.globalAlpha = p.al;
        ctx.setTransform(c, -s, s, c, p.x, p.y);
        ctx.drawImage(spr.canvas, spr.sx, spr.sy, spr.sw, spr.sh, -spr.hw, -spr.hh, spr.sw, spr.sh);
      }
    },
    rotScale: () => {
      for (const p of pts) {
        const c = Math.cos(p.a) * k;
        const s = Math.sin(p.a) * k;
        ctx.setTransform(c, -s, s, c, p.x, p.y);
        ctx.drawImage(spr.canvas, spr.sx, spr.sy, spr.sw, spr.sh, -spr.hw, -spr.hh, spr.sw, spr.sh);
      }
    },
    scaleOnly: () => {
      for (const p of pts) {
        ctx.setTransform(k, 0, 0, k, p.x, p.y);
        ctx.drawImage(spr.canvas, spr.sx, spr.sy, spr.sw, spr.sh, -spr.hw, -spr.hh, spr.sw, spr.sh);
      }
    },
    exact1to1: () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const p of pts) ctx.drawImage(spr.canvas, spr.sx, spr.sy, spr.sw, spr.sh, Math.round(p.x), Math.round(p.y), spr.sw, spr.sh);
    },
    pathBatch: () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      for (const p of pts) {
        const c = Math.cos(p.a) * 9;
        const s = Math.sin(p.a) * 9;
        ctx.moveTo(p.x - c, p.y + s);
        ctx.lineTo(p.x + c - s * 0.2, p.y - s - c * 0.2);
        ctx.lineTo(p.x + c + s * 0.2, p.y - s + c * 0.2);
        ctx.closePath();
      }
      ctx.fillStyle = '#D08F45';
      ctx.fill();
      ctx.strokeStyle = '#4A2810';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    },
  };
  const res: Record<string, number> = {};
  for (const [name, fn] of Object.entries(variants)) {
    const ts: number[] = [];
    for (let i = 0; i < 25; i++) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#9fd8f5';
      ctx.fillRect(0, 0, W, H);
      ctx.getImageData(0, 0, 1, 1);
      const t0 = performance.now();
      fn();
      ctx.getImageData(0, 0, 1, 1);
      ts.push(performance.now() - t0);
    }
    ts.sort((a, b) => a - b);
    res[name] = ts[ts.length >> 1];
  }
  w.__raster = res;
  hud.textContent = JSON.stringify(res);
}

// ── Взрыв: стоимость кадра и длительность дыма ───────────────────────────
// ?mode=blast[&viewh=20][&runs=3] — сцена 1-8-подобного взрыва (Бомб у земли + TNT рядом + обломки + очки) на
// фиксированном dt; Math.random подменён сидированным генератором, чтобы версии сравнивались на одних и тех же частицах.
// Стоимость: fx.draw + drawFlash с принудительной растеризацией (getImageData), медиана по прогонам на каждом кадре.
// Дым: отдельный «чистый» взрыв TNT R 3 без обломков — доля пикселей вокруг центра (±2.2R), отличающихся от фона,
// по времени; «конец дыма» — когда доля падает ниже 15 % от пиковой. Итог — window.__blast.

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Минимум Fx, нужный замеру (чтобы сравнивать с другой версией модуля, см. ?ab=). */
interface FxLike {
  handle(e: GameEvent): void;
  update(dt: number): void;
  takeShake(): unknown;
  draw(ctx: CanvasRenderingContext2D, v: ViewInfo): void;
  drawFlash(ctx: CanvasRenderingContext2D, v: ViewInfo): void;
  setGround(fn: (x: number) => number): void;
  readonly particleCount: number;
}
type FxCtor = new () => FxLike;

interface BlastResult {
  maxMs: number;
  p95Ms: number;
  mean1sMs: number;
  sumMs: number;
  maxParticles: number;
  smokeEnd: number;
  coverPeak: number;
  cover: Record<string, number>;
  darkness: Record<string, number>;
  frames: number[];
}

function blastBench(FxC: FxCtor, runs: number): BlastResult {
  const viewH = Number(params.get('viewh') ?? 20);
  const W = canvas.width;
  const H = canvas.height;
  const scale = H / viewH;
  const dt = 1 / 60;
  const DUR = 2.6;
  const N = Math.round(DUR / dt);
  const X0 = 10;
  const mixed: Array<[number, GameEvent[]]> = [
    [0, [
      { type: 'explosion', x: X0, y: 1.2, radius: 3.5, source: 'bomb' },
      { type: 'blockDestroyed', id: 1, material: 'wood', shape: 'rect', x: X0 + 1, y: 1, w: 2, h: 0.5, angle: 0.3, vx: 6, vy: 4, points: 500 },
      { type: 'score', points: 500, x: X0 + 1, y: 1, kind: 'block' },
      { type: 'blockDestroyed', id: 2, material: 'stone', shape: 'rect', x: X0 - 1, y: 2, w: 1, h: 1, angle: 0, vx: -4, vy: 6, points: 500 },
      { type: 'score', points: 500, x: X0 - 1, y: 2, kind: 'block' },
      { type: 'pigDestroyed', id: 3, pig: 'medium', x: X0 + 0.5, y: 0.6, radius: 0.6, points: 5000 },
      { type: 'score', points: 5000, x: X0 + 0.5, y: 0.6, kind: 'pig' },
    ]],
    [8, [
      { type: 'tntDestroyed', id: 4, x: X0 + 2.5, y: 0.5, points: 0 },
      { type: 'explosion', x: X0 + 2.5, y: 0.5, radius: 3, source: 'tnt' },
      { type: 'blockDestroyed', id: 5, material: 'ice', shape: 'rect', x: X0 + 3, y: 1.5, w: 2, h: 0.5, angle: 0, vx: 8, vy: 5, points: 500 },
      { type: 'score', points: 500, x: X0 + 3, y: 1.5, kind: 'block' },
      { type: 'pigDestroyed', id: 6, pig: 'small', x: X0 + 3.4, y: 0.5, radius: 0.45, points: 5000 },
      { type: 'score', points: 5000, x: X0 + 3.4, y: 0.5, kind: 'pig' },
    ]],
  ];
  const pure: Array<[number, GameEvent[]]> = [[0, [{ type: 'explosion', x: X0, y: 0.5, radius: 3, source: 'tnt' }]]];
  const view: ViewInfo = { screenW: W, screenH: H, scale, dpr, camX: X0, camY: viewH / 2 - 1.2, time: 0 };
  const bg = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    drawSky(ctx, 0, 0, W, H);
    drawGround(ctx, view, 0, W);
  };
  const realRandom = Math.random;
  const play = (timeline: Array<[number, GameEvent[]]>, seed: number, onFrame: (fx: FxLike, i: number) => void) => {
    Math.random = seeded(seed);
    try {
      const fx = new FxC();
      fx.setGround(() => 0);
      for (let i = 0; i < N; i++) {
        for (const [f, evs] of timeline) if (f === i) for (const e of evs) fx.handle(e);
        fx.update(dt);
        fx.takeShake();
        onFrame(fx, i);
      }
    } finally {
      Math.random = realRandom;
    }
  };
  // прогрев атласа (вне замера): тот же сценарий целиком
  play(mixed, 1, (fx) => {
    bg();
    fx.draw(ctx, view);
    fx.drawFlash(ctx, view);
  });
  const per: number[][] = Array.from({ length: N }, () => []);
  const counts: number[] = new Array(N).fill(0);
  for (let r = 0; r < runs; r++) {
    play(mixed, 1, (fx, i) => {
      bg();
      ctx.getImageData(0, 0, 1, 1);
      const t0 = performance.now();
      fx.draw(ctx, view);
      fx.drawFlash(ctx, view);
      ctx.getImageData(0, 0, 1, 1);
      per[i].push(performance.now() - t0);
      counts[i] = fx.particleCount;
    });
  }
  const med = per.map((a) => [...a].sort((x, y) => x - y)[a.length >> 1]);
  // дым «чистого» взрыва: доля изменённых пикселей в окне вокруг центра
  const R = 3;
  const cx = W / 2;
  const cy = H / 2 - (0.5 + R * 0.4 - view.camY) * scale;
  const half = Math.round(2.2 * R * scale);
  const bx = Math.max(0, Math.round(cx - half));
  const by = Math.max(0, Math.round(cy - half));
  const bw = Math.min(W - bx, 2 * half);
  const bh = Math.min(H - by, 2 * half);
  bg();
  const ref = ctx.getImageData(bx, by, bw, bh).data;
  const cover: number[] = [];
  const dark: number[] = [];
  play(pure, 2, (fx) => {
    bg();
    fx.draw(ctx, view);
    fx.drawFlash(ctx, view);
    const d = ctx.getImageData(bx, by, bw, bh).data;
    let changed = 0;
    let lum = 0;
    for (let k = 0; k < d.length; k += 16) {
      const diff = Math.abs(d[k] - ref[k]) + Math.abs(d[k + 1] - ref[k + 1]) + Math.abs(d[k + 2] - ref[k + 2]);
      if (diff > 36) {
        changed++;
        lum += (ref[k] + ref[k + 1] + ref[k + 2] - d[k] - d[k + 1] - d[k + 2]) / 3;
      }
    }
    const total = d.length / 16;
    cover.push(changed / total);
    dark.push(changed ? lum / changed : 0);
  });
  // пик дыма — после вспышки и огня (t ≥ 0.3 с); конец — последний кадр с долей ≥ 15 % пика и ≥ 3 % окна
  const peak = Math.max(...cover.slice(Math.round(0.3 / dt)));
  let end = 0;
  for (let i = 0; i < N; i++) if (cover[i] >= Math.max(0.15 * peak, 0.03)) end = (i + 1) * dt;
  const at = (s: number) => +cover[Math.min(N - 1, Math.round(s / dt) - 1)].toFixed(3);
  const darkAt = (s: number) => +dark[Math.min(N - 1, Math.round(s / dt) - 1)].toFixed(1);
  const sorted = [...med].sort((x, y) => x - y);
  return {
    maxMs: +Math.max(...med).toFixed(2),
    p95Ms: +sorted[Math.floor(N * 0.95)].toFixed(2),
    mean1sMs: +(med.slice(0, 60).reduce((a, b) => a + b, 0) / 60).toFixed(2),
    sumMs: +med.reduce((a, b) => a + b, 0).toFixed(1),
    maxParticles: Math.max(...counts),
    smokeEnd: +end.toFixed(2),
    coverPeak: +peak.toFixed(3),
    cover: { '0.3': at(0.3), '0.6': at(0.6), '1.0': at(1.0), '1.4': at(1.4), '1.8': at(1.8), '2.2': at(2.2) },
    darkness: { '0.6': darkAt(0.6), '1.0': darkAt(1.0), '1.4': darkAt(1.4) },
    frames: med.map((v) => +v.toFixed(2)),
  };
}

/**
 * ?mode=blast — замер текущего Fx. ?ab=/src/…/Fx.ts — ещё и другой версии модуля, вперемежку (A, B, A, B…) в одной
 * странице: шум машины одинаково ложится на обе. Итог — window.__blast = { cur, ab? }.
 */
async function runBlast(): Promise<void> {
  const runs = Number(params.get('runs') ?? 3);
  const abUrl = params.get('ab');
  const Other: FxCtor | null = abUrl ? ((await import(/* @vite-ignore */ abUrl)) as { Fx: FxCtor }).Fx : null;
  const rounds = Other ? Number(params.get('rounds') ?? 4) : 1;
  const cur: BlastResult[] = [];
  const ab: BlastResult[] = [];
  for (let r = 0; r < rounds; r++) {
    if (Other) ab.push(blastBench(Other, runs));
    cur.push(blastBench(Fx as unknown as FxCtor, runs));
  }
  // по раундам — медиана каждой метрики
  const agg = (l: BlastResult[]): BlastResult => {
    const m = (f: (x: BlastResult) => number) => +[...l.map(f)].sort((a, b) => a - b)[l.length >> 1].toFixed(2);
    return { ...l[0], maxMs: m((x) => x.maxMs), p95Ms: m((x) => x.p95Ms), mean1sMs: m((x) => x.mean1sMs), sumMs: m((x) => x.sumMs) };
  };
  const res = { W: canvas.width, H: canvas.height, cur: agg(cur), ab: Other ? agg(ab) : undefined };
  w.__blast = res;
  const c = res.cur;
  hud.textContent = `blast  max=${c.maxMs} ms  p95=${c.p95Ms}  mean(1 с)=${c.mean1sMs}  частиц≤${c.maxParticles}  дым до ${c.smokeEnd} с` + (res.ab ? `   | ab: max=${res.ab.maxMs} p95=${res.ab.p95Ms} mean=${res.ab.mean1sMs} дым до ${res.ab.smokeEnd} с` : '');
}

document.fonts.load('400 40px "Luckiest Guy"').finally(() => {
  if (mode === 'raster') runRaster();
  else if (mode === 'blast') void runBlast();
  else if (mode === 'sheet') runSheet();
  else if (mode === 'bench') runBench();
  else runDemo();
});
