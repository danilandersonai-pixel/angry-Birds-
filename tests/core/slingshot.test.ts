import { describe, expect, it } from 'vitest';
import { BIRDS, LAUNCH, SLINGSHOT, TIMING } from '../../src/config/constants';
import { createSession } from '../../src/core';
import { hutLevel, openField } from '../fixtures/levels';
import { ofType, readySession, runFor, runUntil } from './helpers';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('рогатка', () => {
  it('захват только рядом с птицей в состоянии ready', () => {
    const s = readySession(hutLevel());
    const { pocket } = s.slingshot();
    expect(s.canGrab(pocket)).toBe(true);
    expect(s.canGrab({ x: pocket.x + 0.9, y: pocket.y })).toBe(true);
    expect(s.canGrab({ x: pocket.x + LAUNCH.GRAB_RADIUS + 0.05, y: pocket.y })).toBe(false);
    s.launch(30, 1);
    expect(s.canGrab(pocket)).toBe(false);
  });

  it('натяжение ограничено R_MAX, сила 0..1', () => {
    const s = readySession(hutLevel());
    const sl = s.slingshot();
    s.beginAim();
    expect(s.state).toBe('aiming');
    s.updateAim(sl.pocket); // смещение захвата фиксируется по первой точке
    s.updateAim({ x: sl.anchor.x - 10, y: sl.anchor.y + 3 });
    const v = s.slingshot();
    expect(dist(v.pocket, v.anchor)).toBeCloseTo(LAUNCH.R_MAX, 6);
    expect(v.power).toBeCloseTo(1, 6);
    s.updateAim({ x: sl.anchor.x - 1, y: sl.anchor.y });
    expect(dist(s.slingshot().pocket, sl.anchor)).toBeCloseTo(1, 6);
    expect(s.slingshot().power).toBeCloseTo(0.5, 6);
  });

  it('птица не уходит под землю: точка проецируется на окружность, сила сохраняется', () => {
    const s = readySession(openField(['terence']));
    const sl = s.slingshot();
    s.beginAim();
    s.updateAim(sl.pocket);
    s.updateAim({ x: sl.anchor.x - 0.01, y: sl.anchor.y - 10 });
    const v = s.slingshot();
    const baseY = sl.anchor.y - SLINGSHOT.ANCHOR.y;
    expect(v.pocket.y).toBeCloseTo(baseY + 0.8 + LAUNCH.GROUND_CLEARANCE, 6);
    expect(dist(v.pocket, v.anchor)).toBeCloseTo(LAUNCH.R_MAX, 6);
    expect(v.pocket.x).toBeLessThan(sl.anchor.x);
  });

  it('слабое натяжение — отмена: птица не тратится и возвращается в покой', () => {
    const s = readySession(hutLevel());
    const sl = s.slingshot();
    s.beginAim();
    s.updateAim(sl.pocket);
    s.updateAim({ x: sl.anchor.x - LAUNCH.R_CANCEL * 0.8, y: sl.anchor.y });
    s.release();
    const events = s.drainEvents();
    expect(s.state).toBe('ready');
    expect(ofType(events, 'aimCancel')).toHaveLength(1);
    expect(ofType(events, 'birdLaunched')).toHaveLength(0);
    expect(s.birdsLeft).toBe(3);
    runFor(s, 1);
    expect(dist(s.slingshot().pocket, sl.anchor)).toBeLessThan(0.01);
    expect(s.canGrab(sl.anchor)).toBe(true);
  });

  it('скорость выстрела линейна от натяжения и не зависит от угла', () => {
    const speeds: number[] = [];
    for (const d of [0.6, 1.2, 1.8]) {
      const s = readySession(openField(['red']));
      const sl = s.slingshot();
      s.beginAim();
      s.updateAim(sl.pocket);
      s.updateAim({ x: sl.anchor.x - d, y: sl.anchor.y });
      s.release();
      expect(ofType(s.drainEvents(), 'birdLaunched')[0].power).toBeCloseTo(d / LAUNCH.R_MAX, 6);
      s.step();
      speeds.push(s.focusBird()!.vx); // горизонтальный выстрел: vx гравитация не меняет
    }
    for (const [i, d] of [0.6, 1.2, 1.8].entries()) expect(speeds[i]).toBeCloseTo((LAUNCH.V_MAX * d) / LAUNCH.R_MAX, 6);
    // под углом модуль скорости тот же
    const s = readySession(openField(['red']));
    s.launch(60, 0.5);
    const b = s.focusBird()!;
    s.step();
    const f = s.focusBird()!;
    expect(Math.hypot(f.vx, f.vy + 15 / 60)).toBeCloseTo(LAUNCH.V_MAX * 0.5, 6);
    expect(b.id).toBe(f.id);
  });

  it('события натяжения шагами по 0.1 и выстрел из кармашка', () => {
    const s = readySession(hutLevel());
    const sl = s.slingshot();
    s.beginAim();
    expect(ofType(s.drainEvents(), 'aimStart')).toHaveLength(1);
    s.updateAim(sl.pocket);
    for (let d = 0.1; d <= 2.0001; d += 0.05) s.updateAim({ x: sl.anchor.x - d, y: sl.anchor.y });
    const stretch = ofType(s.drainEvents(), 'aimStretch');
    expect(stretch.length).toBeGreaterThanOrEqual(7);
    expect(stretch.length).toBeLessThanOrEqual(9);
    expect(stretch.every((e) => e.power >= LAUNCH.R_CANCEL / LAUNCH.R_MAX - 1e-9)).toBe(true);
    expect(s.predictTrajectory(12)).toHaveLength(12);
    const pocket = s.slingshot().pocket;
    s.release();
    const launched = ofType(s.drainEvents(), 'birdLaunched')[0];
    expect(launched.x).toBeCloseTo(pocket.x, 9);
    expect(launched.y).toBeCloseTo(pocket.y, 9);
    expect(s.state).toBe('flying');
    expect(s.birdsLeft).toBe(2);
    expect(s.predictTrajectory(12)).toHaveLength(0);
  });

  it('после выстрела кармашек отцепляется и успокаивается с провисом', () => {
    const s = readySession(openField(['red', 'red']));
    s.launch(40, 1);
    runFor(s, 1);
    const v = s.slingshot();
    expect(v.loaded).toBeNull();
    expect(v.pocket.y).toBeCloseTo(v.anchor.y - SLINGSHOT.EMPTY_SAG, 2);
    expect(Math.abs(v.pocket.x - v.anchor.x)).toBeLessThan(0.01);
  });

  it('очередь стоит на земле слева от рогатки с шагом max(1.1, r_i + r_{i+1} + 0.2)', () => {
    const s = readySession(hutLevel(['red', 'blues', 'terence', 'bomb', 'blues']));
    const q = s.queue();
    const sl = s.slingshot();
    const baseX = sl.anchor.x - SLINGSHOT.ANCHOR.x;
    expect(q.map((b) => b.type)).toEqual(['blues', 'terence', 'bomb', 'blues']);
    expect(q[0].x).toBeCloseTo(baseX - SLINGSHOT.QUEUE_X0, 9);
    const r = (t: keyof typeof BIRDS) => BIRDS[t].radius;
    const gaps = [
      Math.max(SLINGSHOT.QUEUE_DX, r('blues') + r('terence') + LAUNCH.QUEUE_GAP), // 1.252
      Math.max(SLINGSHOT.QUEUE_DX, r('terence') + r('bomb') + LAUNCH.QUEUE_GAP), // 1.585
      SLINGSHOT.QUEUE_DX, // bomb + blues = 1.037 < 1.1
    ];
    gaps.forEach((g, i) => expect(q[i].x - q[i + 1].x).toBeCloseTo(g, 9));
    for (const b of q) expect(b.y).toBeCloseTo(b.radius, 6);
    expect(s.slingshot().loaded).toBe('red');
  });

  it('загрузка: птица прыгает в кармашек за 0.45 с с пиком над прямой, очередь сдвигается за 0.3 с', () => {
    const s = createSession(hutLevel(['red', 'blues', 'red']), { seed: 1 });
    expect(s.state).toBe('loading');
    const start = s.queue();
    expect(start).toHaveLength(3);
    runFor(s, 0.2);
    const mid = s.queue();
    const u = 0.5 - 0.5 * Math.cos(Math.PI * (0.2 / TIMING.BIRD_HOP_TIME));
    const anchor = s.slingshot().anchor;
    expect(mid[0].y).toBeGreaterThan(start[0].y + (anchor.y - start[0].y) * u); // выше хорды
    runFor(s, 0.1);
    expect(s.queue()[1].x).toBeCloseTo(start[0].x, 6); // вторая птица встала на первое место
    const events = runUntil(s, () => s.state === 'ready', 1);
    expect(s.time).toBeCloseTo(TIMING.BIRD_HOP_TIME, 6);
    expect(ofType(events, 'birdLoaded').map((e) => e.bird)).toEqual(['red']);
    expect(s.queue()).toHaveLength(2);
    expect(s.slingshot().loaded).toBe('red');
  });

  it('прицел строится от точки захвата: птица не прыгает под палец', () => {
    const s = readySession(hutLevel());
    const sl = s.slingshot();
    s.beginAim();
    const grab = { x: sl.pocket.x + 0.4, y: sl.pocket.y - 0.3 }; // захват не по центру птицы
    s.updateAim(grab);
    expect(dist(s.slingshot().pocket, sl.pocket)).toBeLessThan(1e-9);
    s.updateAim({ x: grab.x - 1, y: grab.y });
    expect(s.slingshot().pocket.x).toBeCloseTo(sl.pocket.x - 1, 9);
  });
});
