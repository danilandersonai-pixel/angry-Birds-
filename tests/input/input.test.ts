// InputController в Node: поддельные canvas/window/document и сессия; проверяем маршрутизацию событий.

import { beforeEach, describe, expect, it } from 'vitest';
import { InputController, type InputHandlers, type InputOptions } from '../../src/input/Input';
import { Camera } from '../../src/render/Camera';
import { LAUNCH } from '../../src/config/constants';
import type { EntityView, GameSession } from '../../src/core/api';
import type { SessionState } from '../../src/core/events';
import type { LevelDef, Vec } from '../../src/core/types';

const LEVEL: LevelDef = {
  id: 't',
  name: 'Тест',
  theme: 'meadow',
  birds: ['red', 'red', 'red'],
  slingshot: { x: 0, y: 2.7 },
  bounds: { minX: -12, maxX: 48, maxY: 25 },
  terrain: [{ kind: 'ground', points: [[-40, -10], [140, -10], [140, 0], [-40, 0]] }],
  blocks: [{ material: 'wood', shape: 'rect', x: 26, y: 1, w: 4, h: 2 }],
  pigs: [{ type: 'small', x: 26, y: 2.4 }],
  stars: { one: 0, two: 1, three: 2 },
};

/** Минимальная сессия: рогатка с кругом R_MAX, журнал вызовов. */
class FakeSession {
  state: SessionState = 'ready';
  readonly anchor = { x: 0, y: 2.7 };
  pocket = { x: 0, y: 2.7 };
  log: string[] = [];
  aims: Vec[] = [];
  abilities = 0;
  /** Что вернёт focusBird() (null — птицы нет). */
  focus: Partial<EntityView> | null = null;
  canGrab(p: Vec): boolean {
    return this.state === 'ready' && Math.hypot(p.x - this.pocket.x, p.y - this.pocket.y) <= 1.0;
  }
  beginAim(): void {
    if (this.state !== 'ready') return;
    this.state = 'aiming';
    this.log.push('beginAim');
  }
  updateAim(p: Vec): void {
    if (this.state !== 'aiming') return;
    this.aims.push({ ...p });
    const dx = p.x - this.anchor.x;
    const dy = p.y - this.anchor.y;
    const d = Math.hypot(dx, dy);
    const k = d > LAUNCH.R_MAX ? LAUNCH.R_MAX / d : 1;
    this.pocket = { x: this.anchor.x + dx * k, y: this.anchor.y + dy * k };
  }
  get pull(): number {
    return Math.hypot(this.pocket.x - this.anchor.x, this.pocket.y - this.anchor.y);
  }
  release(): void {
    if (this.state !== 'aiming') return;
    this.log.push(`release:${this.pull.toFixed(3)}`);
    this.state = this.pull < LAUNCH.R_CANCEL ? 'ready' : 'flying';
    this.pocket = { ...this.anchor };
  }
  cancelAim(): void {
    if (this.state !== 'aiming') return;
    this.log.push('cancelAim');
    this.state = 'ready';
    this.pocket = { ...this.anchor };
  }
  activateAbility(): boolean {
    this.abilities++;
    this.log.push('ability');
    return this.state === 'flying';
  }
  slingshot(): { pocket: Vec } {
    return { pocket: this.pocket };
  }
  focusBird(): Partial<EntityView> | null {
    return this.focus;
  }
}

class FakeCanvas extends EventTarget {
  style: Record<string, string> = {};
  rect = { left: 0, top: 0, width: 1280, height: 720 };
  captured = new Set<number>();
  rectCalls = 0;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    this.rectCalls++;
    return this.rect;
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }
}

class FakeDoc extends EventTarget {
  visibilityState = 'visible';
}

function ev(type: string, props: Record<string, unknown>): Event {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v, configurable: true });
  return e;
}

let t = 1000;
interface Rig {
  canvas: FakeCanvas;
  win: EventTarget;
  doc: FakeDoc;
  cam: Camera;
  s: FakeSession;
  input: InputController;
  calls: string[];
  blocked: { v: boolean };
  down(id: number, x: number, y: number, o?: Record<string, unknown>): Event;
  move(id: number, x: number, y: number, o?: Record<string, unknown>): Event;
  up(id: number, x: number, y: number, o?: Record<string, unknown>): Event;
  cancel(id: number): Event;
  key(type: 'keydown' | 'keyup', code: string, o?: Record<string, unknown>): Event;
  wheel(x: number, y: number, deltaY: number, o?: Record<string, unknown>): Event;
  lost(id: number): Event;
  bird(): { x: number; y: number };
  setSession(v: FakeSession | null): void;
}

interface RigOpts {
  input?: InputOptions;
  handlers?: Partial<InputHandlers>;
}

function rig(w = 1280, h = 720, dpr = 1, o: RigOpts = {}): Rig {
  const canvas = new FakeCanvas();
  canvas.rect = { left: 0, top: 0, width: w, height: h };
  const win = new EventTarget();
  const doc = new FakeDoc();
  const cam = new Camera();
  cam.setViewport(w, h, dpr);
  cam.setLevel(LEVEL);
  const s = new FakeSession();
  const calls: string[] = [];
  const blocked = { v: false };
  let session: FakeSession | null = s;
  const handlers: InputHandlers = {
    session: () => session as unknown as GameSession | null,
    blocked: () => blocked.v,
    onPause: () => calls.push('pause'),
    onRestart: () => calls.push('restart'),
    onUserCamera: () => calls.push('userCamera'),
    onSkipIntro: () => calls.push('skip'),
    onToggleOverview: () => calls.push('overview'),
    ...o.handlers,
  };
  const input = new InputController(canvas as unknown as HTMLCanvasElement, cam, handlers, { keyTarget: win, doc, ...o.input });
  const p = (o: Record<string, unknown>, id: number, x: number, y: number): Record<string, unknown> => ({
    pointerId: id,
    pointerType: 'touch',
    button: 0,
    clientX: x + canvas.rect.left,
    clientY: y + canvas.rect.top,
    timeStamp: (t += 16),
    ...o,
  });
  const r: Rig = {
    canvas,
    win,
    doc,
    cam,
    s,
    input,
    calls,
    blocked,
    down: (id, x, y, o = {}) => {
      const e = ev('pointerdown', p(o, id, x, y));
      canvas.dispatchEvent(e);
      return e;
    },
    move: (id, x, y, o = {}) => {
      const e = ev('pointermove', p(o, id, x, y));
      canvas.dispatchEvent(e);
      return e;
    },
    up: (id, x, y, o = {}) => {
      const e = ev('pointerup', p(o, id, x, y));
      canvas.dispatchEvent(e);
      return e;
    },
    cancel: (id) => {
      const e = ev('pointercancel', p({}, id, 0, 0));
      canvas.dispatchEvent(e);
      return e;
    },
    key: (type, code, o = {}) => {
      const key = code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
      const e = ev(type, { code, key, repeat: false, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...o });
      win.dispatchEvent(e);
      return e;
    },
    wheel: (x, y, deltaY, o = {}) => {
      const e = ev('wheel', { clientX: x + canvas.rect.left, clientY: y + canvas.rect.top, deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, ...o });
      canvas.dispatchEvent(e);
      return e;
    },
    lost: (id) => {
      const e = ev('lostpointercapture', { pointerId: id, timeStamp: (t += 16) });
      canvas.dispatchEvent(e);
      return e;
    },
    bird: () => cam.worldToScreen(s.pocket.x, s.pocket.y),
    setSession: (v) => {
      session = v;
    },
  };
  return r;
}

describe('InputController: прицел', () => {
  let r: Rig;
  beforeEach(() => {
    r = rig();
  });

  it('нажатие на птицу → beginAim + захват указателя; птица не прыгает под палец; отпускание → release', () => {
    r = rig(1920, 1080); // вид рогатки ≈ 21 м → ppm ≈ 51 ≥ 45: птица идёт за пальцем 1:1
    const b = r.bird();
    r.down(1, b.x + 10, b.y - 5); // чуть в стороне от центра птицы
    expect(r.s.log).toEqual(['beginAim']);
    expect(r.input.gesture).toBe('aim');
    expect(r.canvas.captured.has(1)).toBe(true);
    // первая точка — сам кармашек: смещение захвата нулевое
    expect(r.s.aims[0]).toEqual({ x: 0, y: 2.7 });
    const ppm = r.cam.ppm;
    expect(ppm).toBeGreaterThanOrEqual(45);
    r.move(1, b.x + 10 - 1.5 * ppm, b.y - 5); // на 1.5 м влево
    expect(r.s.pocket.x).toBeCloseTo(-1.5, 6);
    expect(r.s.pocket.y).toBeCloseTo(2.7, 6);
    r.up(1, b.x + 10 - 1.5 * ppm, b.y - 5);
    expect(r.s.log[1]).toBe('release:1.500');
    expect(r.s.state).toBe('flying');
    expect(r.input.gesture).toBe('none');
    expect(r.canvas.captured.size).toBe(0);
  });

  it('в зоне 44 px, но дальше 1 м — тоже захват (телефон); мимо — пан', () => {
    const p = rig(640, 360);
    const b = p.bird();
    const ppm = p.cam.ppm; // ~16 px/м: 1 м < 44 px
    expect(ppm).toBeLessThan(44);
    p.down(1, b.x + 40, b.y);
    expect(p.s.log).toEqual(['beginAim']);
    p.cancel(1);
    p.down(2, b.x + 60, b.y);
    expect(p.input.gesture).toBe('pending');
  });

  it('телефон: полная оттяжка за 90 CSS px хода', () => {
    const p = rig(640, 360);
    const b = p.bird();
    p.down(1, b.x, b.y);
    p.move(1, b.x - 45, b.y);
    expect(p.s.pull).toBeCloseTo(1.0, 6);
    p.move(1, b.x - 90, b.y);
    expect(p.s.pull).toBeCloseTo(2.0, 6);
    p.up(1, b.x - 90, b.y);
    expect(p.s.log).toEqual(['beginAim', 'release:2.000']);
  });

  it('отпускание не там, где был последний move: выстрел по точке отпускания', () => {
    const p = rig(640, 360);
    const b = p.bird();
    p.down(1, b.x, b.y);
    p.move(1, b.x - 30, b.y);
    p.up(1, b.x - 90, b.y);
    expect(p.s.log).toEqual(['beginAim', 'release:2.000']);
  });

  it('учёт getBoundingClientRect: смещение и CSS-масштаб холста', () => {
    const p = rig();
    p.canvas.rect = { left: 100, top: 50, width: 640, height: 360 }; // холст ужат CSS вдвое
    const b = p.bird(); // в CSS-пикселях камеры (1280×720)
    p.down(1, b.x / 2, b.y / 2); // хелпер прибавит left/top
    expect(p.s.log).toEqual(['beginAim']);
  });

  it('второй палец при прицеле игнорируется, его отпускание не стреляет', () => {
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.move(1, b.x - 100, b.y);
    r.down(2, 900, 300);
    r.move(2, 950, 320);
    r.up(2, 950, 320);
    expect(r.s.log).toEqual(['beginAim']);
    expect(r.input.gesture).toBe('aim');
    r.up(1, b.x - 100, b.y);
    expect(r.s.log[1]).toMatch(/^release/);
  });

  it('pointercancel, blur и скрытие вкладки отменяют прицел', () => {
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.move(1, b.x - 80, b.y);
    r.cancel(1);
    expect(r.s.log).toEqual(['beginAim', 'cancelAim']);

    r.down(2, b.x, b.y);
    r.move(2, b.x - 80, b.y);
    r.win.dispatchEvent(new Event('blur'));
    expect(r.s.log.at(-1)).toBe('cancelAim');
    r.up(2, b.x - 80, b.y); // после отмены отпускание ничего не делает
    expect(r.s.log.at(-1)).toBe('cancelAim');

    r.down(3, b.x, b.y);
    r.doc.visibilityState = 'hidden';
    r.doc.dispatchEvent(new Event('visibilitychange'));
    expect(r.s.log.at(-1)).toBe('cancelAim');
    expect(r.s.state).toBe('ready');
  });

  it('Esc в прицеле — отмена прицела (без паузы), иначе — пауза (pauseRestartKeys: true)', () => {
    r = rig(1280, 720, 1, { input: { pauseRestartKeys: true } });
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.move(1, b.x - 100, b.y);
    const e = r.key('keydown', 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(r.s.log.at(-1)).toBe('cancelAim');
    expect(r.calls).not.toContain('pause');
    r.up(1, b.x - 100, b.y);
    expect(r.s.log.at(-1)).toBe('cancelAim');
    r.key('keydown', 'Escape');
    expect(r.calls).toContain('pause');
  });

  it('блокировка во время прицела (пауза) обрывает жест и отменяет прицел', () => {
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.blocked.v = true;
    r.move(1, b.x - 50, b.y);
    expect(r.s.log.at(-1)).toBe('cancelAim');
    expect(r.input.gesture).toBe('none');
  });

  it('зум колесом во время прицела не дёргает птицу', () => {
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.move(1, b.x - 60, b.y);
    const before = { ...r.s.pocket };
    r.wheel(b.x - 60, b.y, -200);
    expect(r.s.state).toBe('aiming');
    r.move(1, b.x - 60, b.y); // тот же палец на том же месте
    expect(r.s.pocket.x).toBeCloseTo(before.x, 9);
    expect(r.s.pocket.y).toBeCloseTo(before.y, 9);
    expect(r.cam.userAimViewH).toBeCloseTo(r.cam.viewH, 9); // зум в прицеле запомнен
  });
});

describe('InputController: полёт, пан, щипок, тапы', () => {
  it('в полёте нажатие → способность; тот же палец потом панорамирует', () => {
    const r = rig();
    r.s.state = 'flying';
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    const x0 = r.cam.x;
    r.down(1, 600, 300);
    expect(r.s.abilities).toBe(1);
    r.move(1, 590, 300);
    expect(r.calls).toEqual(['userCamera']);
    r.move(1, 500, 300);
    expect(r.cam.x).toBeCloseTo(x0 + 100 / r.cam.ppm, 6); // палец влево на 100 px → мир за ним
    r.up(1, 500, 300);
    expect(r.s.abilities).toBe(1);
  });

  it('правая кнопка мыши в полёте — только пан; средняя гасит автопрокрутку', () => {
    const r = rig();
    r.s.state = 'flying';
    r.down(1, 600, 300, { pointerType: 'mouse', button: 2 });
    expect(r.s.abilities).toBe(0);
    const m = rig();
    const e2 = m.down(1, 600, 300, { pointerType: 'mouse', button: 1 });
    expect(e2.defaultPrevented).toBe(true);
  });

  it('пан с порогом 8 px и инерцией', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    const x0 = r.cam.x;
    r.down(1, 600, 300);
    r.move(1, 595, 300);
    expect(r.cam.x).toBe(x0);
    expect(r.input.gesture).toBe('pending');
    for (let i = 1; i <= 6; i++) r.move(1, 600 - 20 * i, 300);
    expect(r.input.gesture).toBe('pan');
    expect(r.cam.x).toBeCloseTo(x0 + 120 / r.cam.ppm, 6);
    r.up(1, 480, 300);
    expect(r.cam.coasting).toBe(true);
    const x1 = r.cam.x;
    r.cam.update(1 / 60);
    expect(r.cam.x).toBeGreaterThan(x1);
    // новое нажатие ловит камеру
    r.down(2, 100, 100);
    expect(r.cam.coasting).toBe(false);
  });

  it('щипок: пальцы разошлись — приблизили к середине; не во время прицела', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 20 });
    const h0 = r.cam.viewH;
    r.down(1, 500, 300);
    r.down(2, 700, 300);
    expect(r.input.gesture).toBe('pinch');
    expect(r.calls).toEqual([]); // камера ещё не сдвинулась — автоследование не трогаем
    const mid = r.cam.screenToWorld(600, 300);
    r.move(2, 800, 300); // 200 → 300 px: ×1.5
    expect(r.calls).toEqual(['userCamera']);
    // зум к прежней середине, затем пан на сдвиг середины (600 → 650)
    expect(r.cam.viewH).toBeCloseTo(h0 / 1.5, 6);
    const s = r.cam.worldToScreen(mid.x, mid.y);
    expect(s.x).toBeCloseTo(650, 6);
    expect(s.y).toBeCloseTo(300, 6);
    // палец поднят — второй продолжает пан
    r.up(1, 500, 300);
    expect(r.input.gesture).toBe('pan');
    const x0 = r.cam.x;
    r.move(2, 750, 300);
    expect(r.cam.x).toBeCloseTo(x0 + 50 / r.cam.ppm, 6);
  });

  it('двойной тап по пустому месту → общий план; тапы в полёте не считаются', () => {
    const r = rig();
    r.down(1, 900, 200);
    r.up(1, 901, 200);
    r.down(2, 905, 205);
    r.up(2, 905, 205);
    expect(r.calls).toEqual(['overview']);
    r.s.state = 'flying';
    r.down(3, 900, 200);
    r.up(3, 900, 200);
    r.down(4, 900, 200);
    r.up(4, 900, 200);
    expect(r.calls).toEqual(['overview']);
  });

  it('блокировка: любое нажатие и колесо → пропуск интро, камера не двигается', () => {
    const r = rig();
    r.blocked.v = true;
    const b = r.bird();
    const x0 = r.cam.x;
    const h0 = r.cam.viewH;
    r.down(1, b.x, b.y);
    r.move(1, b.x - 200, b.y);
    r.up(1, b.x - 200, b.y);
    r.wheel(600, 300, 300);
    expect(r.calls).toEqual(['skip', 'skip']);
    expect(r.s.log).toEqual([]);
    expect(r.cam.x).toBe(x0);
    expect(r.cam.viewH).toBe(h0);
  });

  it('колесо: вниз — отдалить с якорем под курсором, Ctrl+колесо не листает страницу', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    const w = r.cam.screenToWorld(900, 250);
    const e = r.wheel(900, 250, 100);
    expect(e.defaultPrevented).toBe(true);
    expect(r.cam.viewH).toBeCloseTo(15 / Math.exp(-0.15), 6);
    const s = r.cam.worldToScreen(w.x, w.y);
    expect(s.x).toBeCloseTo(900, 6);
    expect(s.y).toBeCloseTo(250, 6);
    expect(r.calls).toEqual(['userCamera']);
    expect(r.cam.userAimViewH).toBeCloseTo(r.cam.viewH, 9); // READY — зум запомнен
  });

  it('без сессии ввод игнорируется', () => {
    const r = rig();
    r.setSession(null);
    r.down(1, 600, 300);
    r.wheel(600, 300, 100);
    r.key('keydown', 'KeyR');
    expect(r.calls).toEqual([]);
  });

  it('рестарт сессии посреди прицела: старую сессию не трогаем', () => {
    const r = rig();
    const b = r.bird();
    r.down(1, b.x, b.y);
    const fresh = new FakeSession();
    r.setSession(fresh);
    r.move(1, b.x - 100, b.y);
    r.up(1, b.x - 100, b.y);
    expect(r.s.log).toEqual(['beginAim']);
    expect(fresh.log).toEqual([]);
  });
});

describe('InputController: клавиатура', () => {
  it('R, P, Z, Пробел в полёте; повтор и модификаторы игнорируются (pauseRestartKeys: true)', () => {
    const r = rig(1280, 720, 1, { input: { pauseRestartKeys: true } });
    r.key('keydown', 'KeyR');
    r.key('keydown', 'KeyR', { repeat: true });
    r.key('keydown', 'KeyP');
    r.key('keydown', 'KeyZ');
    r.key('keydown', 'KeyR', { ctrlKey: true });
    expect(r.calls).toEqual(['restart', 'pause', 'overview']);
    const sp = r.key('keydown', 'Space');
    expect(sp.defaultPrevented).toBe(true); // страница не прокручивается
    expect(r.s.abilities).toBe(0); // не в полёте
    r.s.state = 'flying';
    r.key('keydown', 'Space');
    expect(r.s.abilities).toBe(1);
  });

  it('уже обработанное UI событие (defaultPrevented) не трогаем; Пробел на кнопке — кнопке', () => {
    const r = rig();
    const e = ev('keydown', { code: 'KeyR', key: 'r', repeat: false });
    e.preventDefault();
    r.win.dispatchEvent(e);
    expect(r.calls).toEqual([]);
    r.s.state = 'flying';
    const btn = new EventTarget();
    Object.defineProperty(btn, 'tagName', { value: 'BUTTON' });
    const sp = ev('keydown', { code: 'Space', key: ' ', repeat: false });
    btn.dispatchEvent(sp); // target — кнопка (в браузере событие всплывёт до window)
    Object.defineProperty(sp, 'target', { value: btn });
    r.win.dispatchEvent(sp);
    expect(r.s.abilities).toBe(0);
  });

  it('стрелки двигают камеру, пока зажаты; Shift ×2', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    const x0 = r.cam.x;
    r.key('keydown', 'ArrowRight');
    expect(r.calls).toEqual(['userCamera']);
    for (let i = 0; i < 6; i++) r.cam.update(1 / 60);
    expect(r.cam.x - x0).toBeCloseTo(1.5, 6);
    r.key('keydown', 'ShiftLeft', { key: 'Shift', shiftKey: true });
    for (let i = 0; i < 6; i++) r.cam.update(1 / 60);
    expect(r.cam.x - x0).toBeCloseTo(4.5, 6);
    r.key('keyup', 'ArrowRight');
    const x1 = r.cam.x;
    r.cam.update(1 / 60);
    expect(r.cam.x).toBe(x1);
  });

  it('+/− — зум к центру экрана', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    r.key('keydown', 'Equal', { key: '=' });
    expect(r.cam.viewH).toBeCloseTo(15 / 1.15, 6);
    r.key('keydown', 'Minus', { key: '-' });
    expect(r.cam.viewH).toBeCloseTo(15, 6);
  });

  it('при блокировке: Пробел/Enter → пропуск, но событие не поглощается (его видит UI); R и Esc — UI', () => {
    const r = rig();
    r.blocked.v = true;
    const sp = r.key('keydown', 'Space');
    expect(sp.defaultPrevented).toBe(false);
    r.key('keydown', 'Enter', { key: 'Enter' });
    r.key('keydown', 'Space', { repeat: true });
    const re = r.key('keydown', 'KeyR');
    const es = r.key('keydown', 'Escape');
    expect(re.defaultPrevented).toBe(false);
    expect(es.defaultPrevented).toBe(false);
    expect(r.calls).toEqual(['skip', 'skip']);
  });

  it('по умолчанию (pauseRestartKeys: false) Esc/P/R остаются UI, Esc в прицеле всё равно отменяет прицел', () => {
    const r = rig();
    const s = r.s;
    for (const c of ['Escape', 'KeyP', 'KeyR']) expect(r.key('keydown', c).defaultPrevented).toBe(false);
    expect(r.calls).toEqual([]);
    const b = r.bird();
    r.down(1, b.x, b.y);
    expect(s.state).toBe('aiming');
    expect(r.key('keydown', 'Escape').defaultPrevented).toBe(true);
    expect(s.log.at(-1)).toBe('cancelAim');
    expect(r.calls).toEqual([]);
  });
});

describe('InputController: исправления ревью', () => {
  it('после удара пан не убирает птицу (быстрый пропуск только тапом); abilityReady от GameScreen', () => {
    let ready = true;
    const r = rig(1280, 720, 1, { handlers: { abilityReady: () => ready } });
    r.s.state = 'flying';
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    // до контакта — способность на pointerdown
    r.down(1, 600, 300);
    expect(r.s.abilities).toBe(1);
    r.up(1, 600, 300);
    // после контакта — нажатие ядро не трогает, пан двигает камеру
    ready = false;
    const x0 = r.cam.x;
    r.down(2, 900, 300);
    expect(r.s.abilities).toBe(1);
    r.move(2, 850, 300);
    r.move(2, 800, 300);
    r.up(2, 800, 300);
    expect(r.s.abilities).toBe(1);
    expect(r.cam.x).toBeGreaterThan(x0);
    // тап — быстрый пропуск (activateAbility на отпускании)
    r.down(3, 700, 300);
    r.up(3, 702, 300);
    expect(r.s.abilities).toBe(2);
    // на паузе отпускание тапа ничего не делает
    r.down(4, 700, 300);
    r.blocked.v = true;
    r.up(4, 700, 300);
    expect(r.s.abilities).toBe(2);
  });

  it('без abilityReady — по focusBird(): израсходована или был удар (поза hurt/idle) → пан не пропускает', () => {
    const r = rig();
    r.s.state = 'flying';
    for (const [focus, immediate] of [
      [{ birdType: 'chuck', birdPose: 'fly', abilityUsed: false }, true],
      [{ birdType: 'chuck', birdPose: 'fly', abilityUsed: true }, false],
      [{ birdType: 'red', birdPose: 'hurt', abilityUsed: false }, false],
      [{ birdType: 'red', birdPose: 'idle', abilityUsed: false }, false],
      [{ birdType: 'bomb', birdPose: 'idle', abilityUsed: false }, true], // Бомб взрывается и после удара
      [{ birdType: 'terence', birdPose: 'aim', abilityUsed: false }, true], // хмурится — безвредно
    ] as const) {
      r.s.focus = focus;
      const n = r.s.abilities;
      r.down(1, 600, 300);
      expect(r.s.abilities - n).toBe(immediate ? 1 : 0);
      r.move(1, 650, 300); // пан
      r.up(1, 650, 300);
      expect(r.s.abilities - n).toBe(immediate ? 1 : 0);
    }
  });

  for (const prk of [false, true]) {
    it(`P в прицеле отменяет прицел, отпускание на паузе не стреляет (pauseRestartKeys: ${prk})`, () => {
      const r = rig(1280, 720, 1, { input: { pauseRestartKeys: prk } });
      const b = r.bird();
      r.down(1, b.x, b.y, { pointerType: 'mouse' });
      r.move(1, b.x - 120, b.y + 40, { pointerType: 'mouse' });
      const e = r.key('keydown', 'KeyP');
      expect(e.defaultPrevented).toBe(prk); // false — событие уходит в UI, он ставит паузу
      expect(r.calls).toEqual(prk ? ['pause'] : []);
      r.blocked.v = true;
      r.up(1, b.x - 120, b.y + 40, { pointerType: 'mouse' });
      expect(r.s.log).toEqual(['beginAim', 'cancelAim']);
      expect(r.s.state).toBe('ready');
    });
  }

  it('пауза кнопкой HUD вторым пальцем без движения первого: отпускание — отмена, а не выстрел', () => {
    const r = rig();
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.move(1, b.x - 100, b.y);
    r.blocked.v = true; // GameScreen открыл паузу; pointermove не было
    r.up(1, b.x - 100, b.y);
    expect(r.s.log).toEqual(['beginAim', 'cancelAim']);
  });

  it('R в прицеле (рестарт делает UI) отменяет прицел: если UI отказал — птицу можно взять снова', () => {
    const r = rig();
    const b = r.bird();
    r.down(1, b.x, b.y, { pointerType: 'mouse' });
    r.move(1, b.x - 100, b.y + 30, { pointerType: 'mouse' });
    expect(r.key('keydown', 'KeyR').defaultPrevented).toBe(false);
    expect(r.s.state).toBe('ready');
    r.move(1, b.x - 120, b.y + 30, { pointerType: 'mouse' });
    r.up(1, b.x - 120, b.y + 30, { pointerType: 'mouse' });
    expect(r.s.log).toEqual(['beginAim', 'cancelAim']);
    r.down(1, b.x, b.y, { pointerType: 'mouse' });
    expect(r.input.gesture).toBe('aim');
    expect(r.s.state).toBe('aiming');
  });

  it('R вне прицела (UI) не обрывает пан', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    r.down(1, 600, 300);
    r.move(1, 560, 300);
    r.key('keydown', 'KeyR');
    expect(r.input.gesture).toBe('pan');
  });

  it('lostpointercapture вне прицела: указатель не залипает, птицу можно взять, касание не зумит', () => {
    const r = rig();
    r.down(5, 900, 300);
    r.move(5, 950, 300);
    r.lost(5);
    expect(r.input.gesture).toBe('none');
    const vh = r.cam.viewH;
    r.down(7, 600, 300);
    r.move(7, 700, 300);
    r.move(7, 800, 300);
    r.up(7, 800, 300);
    expect(r.cam.viewH).toBe(vh); // один палец — пан, не щипок
    const b = r.bird();
    r.down(10, b.x, b.y);
    expect(r.input.gesture).toBe('aim');
    r.move(10, b.x - 80, b.y + 20);
    r.up(10, b.x - 80, b.y + 20);
    expect(r.s.state).toBe('flying');
    // щипок: один палец потерян — второй продолжает пан
    const q = rig();
    q.down(1, 500, 300);
    q.down(2, 700, 300);
    expect(q.input.gesture).toBe('pinch');
    q.lost(1);
    expect(q.input.gesture).toBe('pan');
    q.lost(2);
    expect(q.input.gesture).toBe('none');
  });

  it('новое основное нажатие (isPrimary) убирает потерянные указатели того же типа', () => {
    const r = rig();
    r.down(5, 900, 300, { isPrimary: true });
    r.move(5, 950, 300); // pointerup потерялся, lostpointercapture не пришёл
    const b = r.bird();
    r.down(9, b.x, b.y, { isPrimary: true });
    expect(r.input.gesture).toBe('aim');
    // мышь: тот же pointerId без pointerup
    const m = rig();
    m.down(1, 900, 300, { pointerType: 'mouse', isPrimary: true });
    m.move(1, 950, 300, { pointerType: 'mouse' });
    const mb = m.bird();
    m.down(1, mb.x, mb.y, { pointerType: 'mouse', isPrimary: true });
    expect(m.input.gesture).toBe('aim');
    m.move(1, mb.x - 100, mb.y, { pointerType: 'mouse' });
    m.up(1, mb.x - 100, mb.y, { pointerType: 'mouse' });
    expect(m.s.log[1]).toMatch(/^release/);
    // второй палец (isPrimary: false) при живом первом — по-прежнему щипок
    const p = rig();
    p.down(1, 500, 300, { isPrimary: true });
    p.down(2, 700, 300, { isPrimary: false });
    expect(p.input.gesture).toBe('pinch');
  });

  it('клавиши игры не трогают события на кнопке в фокусе (навигация меню/HUD)', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    const btn = new EventTarget();
    Object.defineProperty(btn, 'tagName', { value: 'BUTTON' });
    for (const [code, key] of [['ArrowRight', 'ArrowRight'], ['ArrowDown', 'ArrowDown'], ['KeyZ', 'z'], ['Equal', '='], ['Minus', '-']]) {
      const e = ev('keydown', { code, key, repeat: false });
      Object.defineProperty(e, 'target', { value: btn });
      r.win.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(false);
    }
    expect(r.cam.keyPan).toEqual({ vx: 0, vy: 0 });
    expect(r.cam.viewH).toBe(15);
    expect(r.calls).toEqual([]);
  });

  it('зажатая стрелка: блокировка останавливает пан; после setLevel повтор клавиши возобновляет', () => {
    const r = rig();
    r.s.state = 'flying';
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    r.key('keydown', 'ArrowRight');
    expect(r.cam.keyPan.vx).toBe(15);
    r.cam.setLevel(LEVEL); // рестарт: камера сбросила пан
    expect(r.cam.keyPan.vx).toBe(0);
    r.key('keydown', 'ArrowRight', { repeat: true });
    expect(r.cam.keyPan.vx).toBe(15);
    r.blocked.v = true; // интро / бонус
    r.key('keydown', 'ArrowRight', { repeat: true });
    expect(r.cam.keyPan).toEqual({ vx: 0, vy: 0 });
    const x0 = r.cam.x;
    r.cam.update(0.1);
    expect(r.cam.x).toBe(x0);
    // повторы не сбивают перелёт камеры: setKeyPan только при смене скорости
    r.blocked.v = false;
    r.key('keyup', 'ArrowRight');
    r.key('keydown', 'ArrowUp');
    r.cam.flyToPose(r.cam.aimView(), 1);
    r.key('keydown', 'ArrowUp', { repeat: true });
    expect(r.cam.animating).toBe(true);
  });

  it('update(): вход в blocked() без событий отпускает стрелки и отменяет прицел', () => {
    const r = rig();
    r.s.state = 'flying';
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    r.key('keydown', 'ArrowRight');
    r.input.update();
    expect(r.cam.keyPan.vx).toBe(15);
    r.blocked.v = true; // бонус / баннер — клавиш и движений нет
    r.input.update();
    expect(r.cam.keyPan).toEqual({ vx: 0, vy: 0 });
    const x0 = r.cam.x;
    r.cam.update(0.2);
    expect(r.cam.x).toBe(x0);
    // прицел, пауза без движения пальца
    const q = rig();
    const b = q.bird();
    q.down(1, b.x, b.y);
    q.input.update();
    q.blocked.v = true;
    q.input.update();
    expect(q.s.log).toEqual(['beginAim', 'cancelAim']);
    q.blocked.v = false;
    q.input.update();
    q.up(1, b.x, b.y);
    expect(q.s.log).toEqual(['beginAim', 'cancelAim']);
  });

  it('reset(): отменяет прицел, отпускает стрелки', () => {
    const r = rig();
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.key('keydown', 'ArrowLeft'); // в прицеле стрелки не двигают камеру
    r.input.reset();
    expect(r.s.log).toEqual(['beginAim', 'cancelAim']);
    expect(r.input.gesture).toBe('none');
    r.up(1, b.x, b.y);
    expect(r.s.log).toEqual(['beginAim', 'cancelAim']);
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    r.key('keydown', 'ArrowRight');
    expect(r.cam.keyPan.vx).toBe(15);
    r.input.reset();
    expect(r.cam.keyPan.vx).toBe(0);
  });

  it('onUserCamera — только при реальном сдвиге камеры', () => {
    const r = rig();
    r.s.state = 'flying';
    r.cam.jumpTo({ x: r.cam.x, y: r.cam.y, viewH: 30 });
    r.wheel(600, 300, 100); // отдалить дальше некуда
    r.key('keydown', 'Minus', { key: '-' });
    expect(r.calls).toEqual([]);
    // тап двумя пальцами без движения
    r.down(1, 500, 300);
    r.down(2, 700, 300);
    r.up(2, 700, 300);
    r.up(1, 500, 300);
    expect(r.calls).toEqual([]);
    // стрелка в упор к границе
    r.cam.jumpTo({ x: -1e3, y: r.cam.y, viewH: 15 });
    r.key('keydown', 'ArrowLeft');
    expect(r.calls).toEqual([]);
    r.key('keyup', 'ArrowLeft');
    r.key('keydown', 'ArrowRight');
    expect(r.calls).toEqual(['userCamera']);
    r.key('keyup', 'ArrowRight');
    r.wheel(600, 300, -100);
    expect(r.calls).toEqual(['userCamera', 'userCamera']);
    // пан сообщает один раз за жест
    r.down(3, 600, 300);
    for (let i = 1; i <= 5; i++) r.move(3, 600 - 20 * i, 300);
    r.up(3, 500, 300);
    expect(r.calls).toEqual(['userCamera', 'userCamera', 'userCamera']);
  });

  it('мышь: птица идёт за курсором 1:1 и при малом ppm; палец — с усилением', () => {
    const r = rig(1280, 720); // вид рогатки ≈ 21 м → ppm ≈ 34 < 45
    expect(r.cam.ppm).toBeLessThan(45);
    const b = r.bird();
    r.down(1, b.x, b.y, { pointerType: 'mouse' });
    r.move(1, b.x - r.cam.ppm, b.y, { pointerType: 'mouse' });
    expect(r.s.pull).toBeCloseTo(1, 6);
    r.up(1, b.x - r.cam.ppm, b.y, { pointerType: 'mouse' });
    const t = rig(1280, 720);
    const tb = t.bird();
    t.down(1, tb.x, tb.y);
    t.move(1, tb.x - t.cam.ppm, tb.y);
    expect(t.s.pull).toBeCloseTo(t.cam.ppm / 45, 6);
  });

  it('getBoundingClientRect — на нажатии, не на каждом pointermove', () => {
    const r = rig();
    r.cam.jumpTo({ x: 16, y: 11, viewH: 15 });
    r.down(1, 600, 300);
    const n = r.canvas.rectCalls;
    for (let i = 1; i <= 20; i++) r.move(1, 600 - 10 * i, 300);
    r.up(1, 400, 300);
    expect(r.canvas.rectCalls).toBe(n);
    // холст сменил размер (resize → setViewport) — прямоугольник перечитывается
    r.cam.setViewport(1000, 600, 1);
    r.canvas.rect = { left: 0, top: 0, width: 1000, height: 600 };
    r.wheel(500, 300, 10);
    expect(r.canvas.rectCalls).toBe(n + 1);
  });
});

describe('InputController: dispose', () => {
  it('снимает обработчики и восстанавливает стили', () => {
    const r = rig();
    expect(r.canvas.style.touchAction).toBe('none');
    r.input.dispose();
    expect(r.canvas.style.touchAction).toBe('');
    const b = r.bird();
    r.down(1, b.x, b.y);
    r.key('keydown', 'KeyR');
    r.wheel(10, 10, 100);
    expect(r.s.log).toEqual([]);
    expect(r.calls).toEqual([]);
    r.input.dispose(); // повторно — без ошибок
  });
});
