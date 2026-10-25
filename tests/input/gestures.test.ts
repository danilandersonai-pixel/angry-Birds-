// Чистая логика жестов: решение по нажатию, пороги, тапы, скорость, щипок, усиление прицела, колесо, клавиши.

import { describe, expect, it } from 'vitest';
import {
  aimPoint,
  classifyDown,
  GESTURE,
  isDoubleTap,
  isEditableTarget,
  isInteractiveTarget,
  isTap,
  keyCommand,
  keyPanVelocity,
  passedThreshold,
  pinchStep,
  VelocityTracker,
  wheelToCamera,
  withinGrabPx,
  type DownContext,
} from '../../src/input/gestures';
import { LAUNCH } from '../../src/config/constants';

const ctx = (over: Partial<DownContext> = {}): DownContext => ({
  hasSession: true,
  blocked: false,
  state: 'ready',
  gesture: 'none',
  activePointers: 0,
  pointerType: 'touch',
  button: 0,
  canGrab: false,
  ...over,
});

describe('classifyDown', () => {
  it('прицел — только основной кнопкой в READY в зоне захвата', () => {
    expect(classifyDown(ctx({ canGrab: true }))).toBe('aim');
    expect(classifyDown(ctx({ canGrab: true, button: 2, pointerType: 'mouse' }))).toBe('pan');
    expect(classifyDown(ctx({ canGrab: true, button: 1, pointerType: 'mouse' }))).toBe('pan');
    expect(classifyDown(ctx({ canGrab: false }))).toBe('pan');
    expect(classifyDown(ctx({ canGrab: true, state: 'settling' }))).toBe('pan');
  });

  it('в полёте — способность (левая кнопка, палец, перо), правая — только пан', () => {
    expect(classifyDown(ctx({ state: 'flying' }))).toBe('ability');
    expect(classifyDown(ctx({ state: 'flying', pointerType: 'pen' }))).toBe('ability');
    expect(classifyDown(ctx({ state: 'flying', pointerType: 'mouse', button: 2 }))).toBe('pan');
  });

  it('блокировка → пропуск; без сессии и лишние кнопки → игнор', () => {
    expect(classifyDown(ctx({ blocked: true, canGrab: true }))).toBe('skip');
    expect(classifyDown(ctx({ blocked: true, button: 2 }))).toBe('skip');
    expect(classifyDown(ctx({ hasSession: false }))).toBe('ignore');
    expect(classifyDown(ctx({ pointerType: 'mouse', button: 3 }))).toBe('ignore');
  });

  it('второй палец: при прицеле игнор, иначе щипок; третий — игнор', () => {
    expect(classifyDown(ctx({ gesture: 'aim', activePointers: 1, state: 'aiming' }))).toBe('ignore');
    expect(classifyDown(ctx({ gesture: 'pending', activePointers: 1 }))).toBe('pinch');
    expect(classifyDown(ctx({ gesture: 'pan', activePointers: 1, state: 'flying' }))).toBe('pinch');
    expect(classifyDown(ctx({ gesture: 'pinch', activePointers: 2 }))).toBe('ignore');
  });
});

describe('пороги и тапы', () => {
  it('пан начинается с 8 CSS px', () => {
    expect(passedThreshold(100, 100, 107, 100)).toBe(false);
    expect(passedThreshold(100, 100, 105.6, 105.6)).toBe(false); // 7.92 px
    expect(passedThreshold(100, 100, 108, 100)).toBe(true);
    expect(passedThreshold(0, 0, 6, 6)).toBe(true); // 8.49 px
  });

  it('тап: короче 300 мс и ближе 8 px', () => {
    expect(isTap({ t: 0, x: 0, y: 0 }, { t: 299, x: 5, y: 0 })).toBe(true);
    expect(isTap({ t: 0, x: 0, y: 0 }, { t: 300, x: 0, y: 0 })).toBe(false);
    expect(isTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 9, y: 0 })).toBe(false);
  });

  it('двойной тап: ≤ 300 мс и ≤ 24 px', () => {
    expect(isDoubleTap(null, { t: 100, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 300, x: 20, y: 10 })).toBe(true);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 301, x: 0, y: 0 })).toBe(false);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 200, x: 25, y: 0 })).toBe(false);
  });

  it('зона захвата 44 px', () => {
    expect(withinGrabPx(144, 100, 100, 100)).toBe(true);
    expect(withinGrabPx(145, 100, 100, 100)).toBe(false);
    expect(GESTURE.GRAB_MIN_PX).toBe(44);
  });
});

describe('VelocityTracker', () => {
  it('среднее за последние 80 мс', () => {
    const v = new VelocityTracker();
    // медленно, потом быстро: скорость — по последним 80 мс
    v.add(0, 0, 0);
    v.add(100, 10, 0);
    for (let t = 116, x = 20; t <= 200; t += 16, x += 16) v.add(t, x, 0);
    const r = v.velocity(200);
    expect(r.vx).toBeCloseTo(1000, 0);
    expect(r.vy).toBe(0);
  });

  it('палец стоял дольше окна — скорость 0; одна точка — 0', () => {
    const v = new VelocityTracker();
    v.add(0, 0, 0);
    v.add(16, 30, 0);
    expect(v.velocity(200).vx).toBe(0);
    const w = new VelocityTracker();
    w.add(10, 5, 5);
    expect(w.velocity(10)).toEqual({ vx: 0, vy: 0 });
  });

  it('не копит бесконечно', () => {
    const v = new VelocityTracker();
    for (let i = 0; i < 10000; i++) v.add(i * 16, i, i);
    expect((v as unknown as { samples: unknown[] }).samples.length).toBeLessThan(20);
  });
});

describe('pinchStep', () => {
  it('пальцы разошлись вдвое — зум ×2 к прежней середине; сдвиг середины — пан', () => {
    const s = pinchStep({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 60, y: 110 }, { x: 260, y: 110 });
    expect(s.factor).toBeCloseTo(2, 9);
    expect(s.anchorX).toBe(150);
    expect(s.anchorY).toBe(100);
    expect(s.dx).toBe(10);
    expect(s.dy).toBe(10);
  });

  it('слипшиеся пальцы не дают деления на ноль', () => {
    const s = pinchStep({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 });
    expect(s.factor).toBe(1);
  });
});

describe('aimPoint: усиление оттяжки на телефоне', () => {
  const pocket = { x: 0, y: 2.7 };

  it('при ppm ≥ 45 птица идёт за пальцем 1:1', () => {
    const ppm = 60;
    const p = aimPoint(pocket, 500, 300, 500 - 60, 300 + 30, ppm);
    expect(p.x).toBeCloseTo(-1, 9);
    expect(p.y).toBeCloseTo(2.7 - 0.5, 9);
  });

  it('мышь (minPpm = 0) — 1:1 при любом ppm', () => {
    for (const ppm of [16, 30, 60]) {
      const p = aimPoint(pocket, 200, 200, 200 - ppm, 200 + ppm / 2, ppm, 0);
      expect(p.x).toBeCloseTo(-1, 9);
      expect(p.y).toBeCloseTo(2.2, 9);
    }
  });

  it('на телефоне (ppm < 45) полная сила R_MAX — ровно на 90 CSS px хода', () => {
    for (const ppm of [16, 20, 30, 44.9]) {
      const p = aimPoint(pocket, 200, 200, 200 - 90, 200, ppm);
      expect(Math.hypot(p.x - pocket.x, p.y - pocket.y)).toBeCloseTo(LAUNCH.R_MAX, 6);
    }
  });

  it('полное натяжение никогда не требует меньше 90 px', () => {
    for (const ppm of [10, 30, 45, 60, 120]) {
      const pxForFull = LAUNCH.R_MAX * Math.max(ppm, 45);
      expect(pxForFull).toBeGreaterThanOrEqual(90);
      const p = aimPoint(pocket, 0, 0, -pxForFull, 0, ppm);
      expect(Math.hypot(p.x - pocket.x, p.y - pocket.y)).toBeCloseTo(LAUNCH.R_MAX, 9);
    }
  });
});

describe('wheelToCamera', () => {
  it('вниз — отдалить, вверх — приблизить; щелчок 100 px ≈ ×1.16', () => {
    const down = wheelToCamera(0, 100, 0, false, 720);
    expect(down.zoom).toBeCloseTo(Math.exp(-0.15), 9);
    expect(1 / down.zoom).toBeCloseTo(1.16, 2);
    expect(wheelToCamera(0, -100, 0, false, 720).zoom).toBeGreaterThan(1);
  });

  it('Ctrl (щипок тачпада) — коэффициент 0.01; строки ×16; страницы ×высота; кламп ×2', () => {
    expect(wheelToCamera(0, 10, 0, true, 720).zoom).toBeCloseTo(Math.exp(-0.1), 9);
    expect(wheelToCamera(0, 3, 1, false, 720).zoom).toBeCloseTo(Math.exp(-48 * 0.0015), 9);
    expect(wheelToCamera(0, 1, 2, false, 720).zoom).toBeCloseTo(0.5, 9);
    expect(wheelToCamera(0, -1e6, 0, false, 720).zoom).toBe(2);
  });

  it('deltaX — горизонтальный пан (кроме Ctrl)', () => {
    expect(wheelToCamera(40, 0, 0, false, 720)).toEqual({ zoom: 1, panX: -40 });
    expect(wheelToCamera(40, 0, 0, true, 720).panX).toBe(0);
    expect(wheelToCamera(Number.NaN, Number.NaN, 0, false, 720).zoom).toBe(1);
  });
});

describe('клавиши', () => {
  it('команды по e.code (русская раскладка) и запасной e.key', () => {
    expect(keyCommand('KeyR', 'к')).toEqual({ kind: 'restart' });
    expect(keyCommand('KeyP', 'з')).toEqual({ kind: 'pause' });
    expect(keyCommand('Escape', 'Escape')).toEqual({ kind: 'escape' });
    expect(keyCommand('Space', ' ')).toEqual({ kind: 'ability' });
    expect(keyCommand('Enter', 'Enter')).toEqual({ kind: 'ability' });
    expect(keyCommand('KeyZ', 'я')).toEqual({ kind: 'overview' });
    expect(keyCommand('Equal', '=')).toEqual({ kind: 'zoom', factor: 1.15 });
    expect(keyCommand('NumpadAdd', '+')).toEqual({ kind: 'zoom', factor: 1.15 });
    expect(keyCommand('Minus', '-')).toEqual({ kind: 'zoom', factor: 1 / 1.15 });
    expect(keyCommand('ArrowLeft', 'ArrowLeft')).toEqual({ kind: 'pan', key: 'ArrowLeft' });
    expect(keyCommand('', '+')).toEqual({ kind: 'zoom', factor: 1.15 });
    expect(keyCommand('KeyM', 'm')).toBeNull();
    expect(keyCommand('KeyF', 'f')).toBeNull();
  });

  it('пан стрелками 15 м/с, Shift ×2, противоположные гасят друг друга', () => {
    expect(keyPanVelocity(new Set(['ArrowRight']), false)).toEqual({ vx: 15, vy: 0 });
    expect(keyPanVelocity(new Set(['ArrowLeft', 'ArrowUp']), true)).toEqual({ vx: -30, vy: 30 });
    const both = keyPanVelocity(new Set(['ArrowLeft', 'ArrowRight']), false);
    expect(both.vx === 0 && both.vy === 0).toBe(true);
  });

  it('цели ввода: поля и кнопки', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'CANVAS' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isInteractiveTarget({ tagName: 'BUTTON' })).toBe(true);
    expect(isInteractiveTarget({ tagName: 'DIV', getAttribute: (n: string) => (n === 'role' ? 'button' : null) })).toBe(true);
    expect(isInteractiveTarget({ tagName: 'BODY', getAttribute: () => null })).toBe(false);
    expect(isInteractiveTarget({})).toBe(false);
  });
});
