// Живая сцена под меню (07 §7.3): фон темы текущего экрана, рельеф, рогатка с птицей, очередь птиц
// (подпрыгивают и моргают — это делает Renderer), небольшое сооружение со свиньями (моргают), медленный дрейф камеры.
// Дёшево по CPU: физика стоит (сцена после усадки спит), кадр рисуется не чаще 30 раз в секунду.

import { createSession } from '../core';
import type { GameSession } from '../core/api';
import type { BirdType, LevelDef, ThemeId } from '../core/types';
import { Renderer } from '../render/Renderer';
import type { SpriteCache } from '../render/SpriteCache';
import type { ViewInfo } from '../render/view';
import type { CanvasHost } from './CanvasHost';

const GROUND: LevelDef['terrain'] = [
  {
    kind: 'ground',
    points: [
      [-40, 0],
      [90, 0],
      [90, -12],
      [-40, -12],
    ],
  },
];

function menuLevel(theme: ThemeId): LevelDef {
  const birds: Record<ThemeId, BirdType[]> = {
    meadow: ['red', 'chuck', 'blues', 'bomb'],
    beach: ['matilda', 'red', 'hal', 'blues'],
    snow: ['terence', 'silver', 'chuck', 'red'],
  };
  const base: Omit<LevelDef, 'blocks' | 'pigs' | 'decor'> = {
    id: `menu-${theme}`,
    name: 'Меню',
    theme,
    birds: birds[theme],
    slingshot: { x: 0, y: 2.7 },
    bounds: { minX: -14, maxX: 60, maxY: 30 },
    terrain: GROUND,
    stars: { one: 0, two: 1, three: 2 },
  };
  if (theme === 'beach') {
    return {
      ...base,
      blocks: [
        { material: 'stone', shape: 'rect', x: 11.5, y: 0.25, w: 3.5, h: 0.5 },
        { material: 'ice', shape: 'rect', x: 10.25, y: 1.25, w: 0.5, h: 1.5 },
        { material: 'ice', shape: 'rect', x: 12.75, y: 1.25, w: 0.5, h: 1.5 },
        { material: 'wood', shape: 'rect', x: 11.5, y: 2.25, w: 3.5, h: 0.5 },
        { material: 'wood', shape: 'isoTriangle', x: 11.5, y: 3.1, w: 2.2, h: 1.2 },
      ],
      pigs: [
        { type: 'helmet', x: 11.5, y: 0.5 + 0.63 },
        { type: 'small', x: 15.1, y: 0.405 },
      ],
      decor: [
        { kind: 'shell', x: 2.7, y: 0 },
        { kind: 'grass', x: 5.3, y: 0, scale: 1.1 },
        { kind: 'rock', x: 7.5, y: 0, scale: 0.8 },
        { kind: 'shell', x: 17.0, y: 0, flip: true },
        { kind: 'bush', x: 19.5, y: 0 },
      ],
    };
  }
  if (theme === 'snow') {
    return {
      ...base,
      blocks: [
        { material: 'stone', shape: 'rect', x: 9.75, y: 1.0, w: 0.5, h: 2.0 },
        { material: 'stone', shape: 'rect', x: 13.25, y: 1.0, w: 0.5, h: 2.0 },
        { material: 'ice', shape: 'rect', x: 11.5, y: 2.25, w: 4.5, h: 0.5 },
        { material: 'ice', shape: 'rect', x: 10.3, y: 3.0, w: 1, h: 1 },
        { material: 'wood', shape: 'circle', x: 12.8, y: 3.0, w: 1, h: 1 },
      ],
      pigs: [
        { type: 'medium', x: 11.5, y: 0.6075 },
        { type: 'mustache', x: 11.55, y: 2.5 + 0.72 },
      ],
      decor: [
        { kind: 'snowman', x: 3.7, y: 0 },
        { kind: 'pine', x: 7.1, y: 0, scale: 0.9 },
        { kind: 'rock', x: 16.0, y: 0, scale: 0.9 },
        { kind: 'pine', x: 19.0, y: 0 },
      ],
    };
  }
  return {
    ...base,
    blocks: [
      { material: 'wood', shape: 'rect', x: 9.75, y: 1.0, w: 0.5, h: 2.0 },
      { material: 'wood', shape: 'rect', x: 13.25, y: 1.0, w: 0.5, h: 2.0 },
      { material: 'wood', shape: 'rect', x: 11.5, y: 2.25, w: 4.5, h: 0.5 },
      { material: 'ice', shape: 'rect', x: 10.4, y: 3.0, w: 1, h: 1 },
      { material: 'stone', shape: 'rect', x: 15.1, y: 0.5, w: 1, h: 1 },
    ],
    pigs: [
      { type: 'small', x: 11.5, y: 0.405 },
      { type: 'medium', x: 12.2, y: 2.5 + 0.6075 },
    ],
    decor: [
      { kind: 'flower', x: 2.1, y: 0 },
      { kind: 'bush', x: 4.9, y: 0, scale: 1.1 },
      { kind: 'flower', x: 7.3, y: 0, scale: 0.9, flip: true },
      { kind: 'grass', x: 8.5, y: 0 },
      { kind: 'rock', x: 16.9, y: 0, scale: 0.9 },
      { kind: 'bush', x: 20.0, y: 0, flip: true },
    ],
  };
}

const FRAME_MIN = 1 / 30;

export class MenuScene {
  private readonly renderer: Renderer;
  private theme: ThemeId | null = null;
  private session: GameSession | null = null;
  private time = 0;
  private sinceDraw = Infinity;
  private dirty = true;

  constructor(
    private readonly host: CanvasHost,
    cache: SpriteCache,
  ) {
    this.renderer = new Renderer(host.ctx, cache);
    host.onChange(() => (this.dirty = true));
  }

  get currentTheme(): ThemeId | null {
    return this.theme;
  }

  /** Тема фона меню (onScreenChange). Сцена строится заново только при смене темы. */
  setTheme(theme: ThemeId): void {
    if (theme === this.theme && this.session) return;
    this.theme = theme;
    const level = menuLevel(theme);
    const s = createSession(level, { seed: 7 });
    // птица запрыгивает в кармашек (0.45 с), дальше физика спит и не шагает
    for (let i = 0; i < 40 && s.state !== 'ready'; i++) s.step();
    s.drainEvents();
    this.session = s;
    this.renderer.setLevel(level);
    this.dirty = true;
  }

  /** Вид камеры меню: рогатка на ~30 % ширины (очередь слева видна целиком), сооружение справа, дрейф ±1.2 м. */
  view(time = this.time): ViewInfo {
    const h = this.host;
    const aspect = h.cssW / h.cssH;
    const viewH = Math.min(18, Math.max(12.5, 23 / aspect));
    const viewW = viewH * aspect;
    const scale = h.canvas.height / viewH;
    const drift = 1.2 * Math.sin((time * Math.PI * 2) / 38);
    return {
      screenW: h.canvas.width,
      screenH: h.canvas.height,
      camX: (0.5 - 0.3) * viewW + drift,
      camY: -1.2 + viewH / 2,
      scale,
      dpr: h.dpr,
      time,
    };
  }

  /** Заранее построить спрайты, полосы фона и рельеф (экран загрузки). */
  async prewarm(yieldFn?: () => Promise<void>, onProgress?: (p: number) => void): Promise<void> {
    if (!this.session) this.setTheme('meadow');
    const v = this.view(0);
    await this.renderer.cache.prewarm(this.renderer.warmList([v.scale], this.session!.entities()), { yieldFn, onProgress, sliceMs: 14 });
    this.renderer.prewarmWorld(v);
  }

  /** Кадр меню (не чаще 30 раз в секунду). */
  frame(dt: number): void {
    if (!this.session) this.setTheme('meadow');
    this.time += dt;
    this.sinceDraw += dt;
    if (!this.dirty && this.sinceDraw < FRAME_MIN) return;
    const adt = Math.min(0.1, this.sinceDraw === Infinity ? 0 : this.sinceDraw);
    this.sinceDraw = 0;
    this.dirty = false;
    this.renderer.render(this.session!, { view: this.view(), alpha: 1, dt: adt });
  }
}
