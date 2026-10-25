// Тестовые хуки window.__game (есть всегда: они крошечные и ничего не стоят без вызова).
// Используются e2e-смоуком (scripts/e2e.mjs) и для отладки из консоли.

import { BIRDS, LAUNCH, WORLD } from '../config/constants';
import type { App } from './App';
import { hudLevel } from './GameScreen';

export interface GameHooks {
  /** Экран UI: loading | title | episodes | levels | game. */
  screen(): string;
  /** Состояние сессии ядра (loading | ready | aiming | flying | settling | bonus | won | lost) или 'none'. */
  state(): string;
  /** Презентационная фаза экрана игры: none | loading | intro | play | ended. */
  phase(): string;
  level(): string | null;
  score(): number;
  /** Время сессии ядра, с. */
  time(): number;
  stars(): number;
  birdsLeft(): number;
  pigsLeft(): number;
  /** Сразу в уровень (без шторки). Промис — когда уровень загружен. */
  startLevel(id: string): Promise<boolean>;
  skipIntro(): void;
  /** Выстрел в состоянии ready: угол в градусах (0 — вправо, 90 — вверх), сила 0..1. true — птица полетела. */
  launch(angleDeg: number, power: number): boolean;
  ability(): boolean;
  pause(): void;
  resume(): void;
  restart(): void;
  paused(): boolean;
  fps(): number;
  /** Состояние AudioContext: none | suspended | running | closed. */
  audio(): string;
  /** Ждёт состояния ready / won / lost (не дольше maxSec), возвращает его. */
  settle(maxSec?: number): Promise<string>;
  /** Прокрутить симуляцию на sec секунд сразу. */
  fastForward(sec: number): void;
  /** Ускорить шаги (1…16 шагов за кадр вместо 1…4). */
  setSpeed(k: number): void;
  camera(): { x: number; y: number; viewH: number };
  /** Живые свиньи (мир, м). */
  pigs(): Array<{ x: number; y: number; r: number }>;
  /** ANCHOR рогатки (мир). */
  anchor(): { x: number; y: number } | null;
  /** Птица в кармашке (или null). */
  loaded(): string | null;
  /** Числа выстрела для подбора угла в e2e (чтобы скрипт не хранил свою копию V_MAX): скорость, оттяжка, g, множители птиц. */
  launchSpec(): { vMax: number; rMax: number; g: number; scale: Record<string, number> };
  /** За кем следит камера в полёте (птица, центроид Синих, яйцо Матильды) — мир, м; null вне полёта. */
  focus(): { x: number; y: number; vx: number; vy: number } | null;
  /** Кармашек рогатки в CSS-пикселях окна (для жестов в e2e). */
  pocketScreen(): { x: number; y: number } | null;
  /** Мировая точка → CSS-пиксели окна. */
  toScreen(x: number, y: number): { x: number; y: number };
  stats(): Record<string, unknown>;
  /**
   * Кадр вида рогатки против контента уровня (плейтест №2): насколько правый край контента + 1 м и верх + 0.8 м
   * не влезли (м, ≤ 0 — влезли), упёрся ли вид в жёсткий потолок, сколько тел заходят под HUD справа сверху
   * (по настоящему прямоугольнику .hud-right), размер Реда в CSS px. Считает по aimView(), а не по текущей камере.
   */
  framing(): {
    cutRight: number;
    cutTop: number;
    atCap: boolean;
    viewH: number;
    hudHits: number;
    redPx: number;
    slingFrac: number;
    /** Плотность кадра: доля высоты под землёй (низ кадра → groundRef), доля неба над верхом контента, доля ширины от рогатки до правого края контента. */
    groundFrac: number;
    skyFrac: number;
    spanFrac: number;
    /** Габарит контента (мир, м). */
    content: { left: number; right: number; top: number; ground: number };
  };
  /** Видна ли кнопка «К рогатке». */
  homeVisible(): boolean;
}

export function installHooks(app: App): void {
  const g = app.game;
  const settled = (st: string): boolean => st === 'ready' || st === 'won' || st === 'lost';
  const hooks: GameHooks = {
    screen: () => app.ui.screen,
    state: () => g.session?.state ?? 'none',
    phase: () => g.phase,
    level: () => (g.session ? (g.level?.id ?? null) : null),
    score: () => g.session?.score ?? 0,
    time: () => g.session?.time ?? 0,
    stars: () => g.session?.stars() ?? 0,
    birdsLeft: () => g.session?.birdsLeft ?? 0,
    pigsLeft: () => g.session?.pigsLeft ?? 0,
    startLevel: (id) => app.playLevel(id),
    skipIntro: () => g.skipIntro(true),
    launch: (angleDeg, power) => {
      const s = g.session;
      if (!s || g.phase !== 'play' || g.paused || s.state !== 'ready') return false;
      s.launch(angleDeg, power);
      return (s.state as string) === 'flying';
    },
    ability: () => (g.session && !g.paused ? g.session.activateAbility() : false),
    pause: () => {
      app.ui.showPause();
      g.pause();
    },
    resume: () => {
      app.ui.hidePause();
      g.resume();
    },
    restart: () => {
      if (!g.level) return;
      g.restart();
      app.ui.showHud(hudLevel(g.level));
    },
    paused: () => g.paused,
    fps: () => Math.round(app.fpsValue * 10) / 10,
    audio: () => app.audio.context?.state ?? 'none',
    settle: (maxSec = 20) =>
      new Promise<string>((resolve) => {
        const t0 = performance.now();
        const check = (): void => {
          const st = g.session?.state ?? 'none';
          if (settled(st) || st === 'none' || performance.now() - t0 > maxSec * 1000) resolve(st);
          else setTimeout(check, 50);
        };
        check();
      }),
    fastForward: (sec) => g.fastForward(sec),
    setSpeed: (k) => g.setSpeed(k),
    camera: () => ({ x: g.camera.x, y: g.camera.y, viewH: g.camera.viewH }),
    pigs: () => {
      const out: Array<{ x: number; y: number; r: number }> = [];
      for (const e of g.session?.entities() ?? []) if (e.kind === 'pig') out.push({ x: e.x, y: e.y, r: e.radius });
      return out;
    },
    anchor: () => (g.level ? { ...g.level.slingshot } : null),
    loaded: () => g.session?.slingshot().loaded ?? null,
    launchSpec: () => ({
      vMax: LAUNCH.V_MAX,
      rMax: LAUNCH.R_MAX,
      g: Math.abs(WORLD.GRAVITY),
      scale: Object.fromEntries(Object.entries(BIRDS).map(([k, v]) => [k, v.launchScale])),
    }),
    focus: () => {
      const f = g.session?.state === 'flying' ? g.session.focusBird() : null;
      return f ? { x: f.x, y: f.y, vx: f.vx, vy: f.vy } : null;
    },
    pocketScreen: () => {
      const s = g.session;
      if (!s) return null;
      const p = s.slingshot().pocket;
      return hooks.toScreen(p.x, p.y);
    },
    toScreen: (x, y) => {
      const r = app.host.canvas.getBoundingClientRect();
      const p = g.camera.worldToScreen(x, y);
      return { x: r.left + p.x, y: r.top + p.y };
    },
    framing: () => {
      const cam = g.camera;
      const a = cam.aimView();
      const f = cam.level;
      const w = a.viewH * cam.aspect;
      const left = a.x - w / 2;
      const right = a.x + w / 2;
      const top = a.y + a.viewH / 2;
      const ppm = cam.cssH / a.viewH;
      // HUD справа сверху: настоящий прямоугольник в координатах холста
      let hudHits = 0;
      const hud = document.querySelector('.hud-right');
      const cr = app.host.canvas.getBoundingClientRect();
      if (hud && g.session) {
        const r = hud.getBoundingClientRect();
        const hl = r.left - cr.left;
        const hb = r.bottom - cr.top;
        for (const e of g.session.entities()) {
          if (e.kind !== 'block' && e.kind !== 'pig' && e.kind !== 'tnt') continue;
          // габарит повёрнутого тела (у длинной балки max(w, h)/2 по вертикали завышал верх на полдлины)
          const c = Math.abs(Math.cos(e.angle));
          const s = Math.abs(Math.sin(e.angle));
          const ex = e.shape === 'circle' ? e.radius : (e.w * c + e.h * s) / 2;
          const ey = e.shape === 'circle' ? e.radius : (e.w * s + e.h * c) / 2;
          const sx = (e.x + ex - left) * ppm;
          const sy = (top - (e.y + ey)) * ppm;
          if (sx > hl && sy < hb) hudHits++;
        }
      }
      return {
        cutRight: f.contentRight + 1 - right,
        cutTop: f.contentTop + 0.8 - top,
        atCap: a.viewH >= g.camera.aimHardCap - 1e-6,
        viewH: a.viewH,
        hudHits,
        redPx: 0.9 * ppm,
        slingFrac: (f.slingX - left) / w,
        groundFrac: (f.groundRef - (a.y - a.viewH / 2)) / a.viewH,
        skyFrac: (top - f.contentTop) / a.viewH,
        spanFrac: (f.contentRight - f.slingX) / w,
        content: { left: f.contentLeft, right: f.contentRight, top: f.contentTop, ground: f.groundRef },
      };
    },
    homeVisible: () => !!document.querySelector('.hud-home:not(.is-hidden)'),
    stats: () => ({
      quality: app.host.quality,
      dpr: app.host.dpr,
      canvas: [app.host.canvas.width, app.host.canvas.height],
      renderMs: Math.round(g.lastRenderMs * 100) / 100,
      fxWarmMs: Math.round(g.fxWarmMs),
      physWarmMs: Math.round(g.physWarmMs),
      aimViewH: Math.round(g.camera.aimView().viewH * 100) / 100,
      frameMs: Math.round(g.frameMs * 100) / 100,
      frameMsMax: Math.round(g.frameMsMax * 100) / 100,
      drawn: g.renderer.drawn,
      phases: Object.fromEntries(Object.entries(g.renderer.profile).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      fx: g.fx.count,
      sprites: app.cache.size,
      spriteMB: Math.round(app.cache.usedBytes / 2 ** 20),
      generated: app.cache.stats.generated,
      substituted: app.cache.stats.substituted,
    }),
  };
  (window as unknown as { __game: GameHooks }).__game = hooks;
}
