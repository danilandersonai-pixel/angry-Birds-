import { describe, expect, it } from 'vitest';
import { LAUNCH, RETIRE, TRAIL } from '../../src/config/constants';
import type { BirdType, TerrainDef } from '../../src/core/types';
import { hutLevel, level, openField, pigOn } from '../fixtures/levels';
import { ofType, readySession, runUntil, shoot } from './helpers';

/** Точка первого контакта птицы с землёй после выстрела. */
function landing(bird: BirdType, angle: number): { x: number; t: number } {
  const s = readySession(openField([bird]));
  s.launch(angle, 1);
  const t0 = s.time;
  runUntil(s, () => s.focusBird()?.birdPose !== 'fly', 10);
  return { x: s.focusBird()!.x, t: s.time - t0 };
}

describe('полёт', () => {
  it('максимальная дальность Red из оттянутого кармашка ≈ 37.7 м (±10 %), полёт ≈ 2.3 с', () => {
    let best = { x: 0, t: 0 };
    for (let a = 38; a <= 50; a += 1) {
      const r = landing('red', a);
      if (r.x > best.x) best = r;
    }
    expect(best.x).toBeGreaterThan(37.7 * 0.9);
    expect(best.x).toBeLessThan(37.7 * 1.1);
    expect(best.t).toBeGreaterThan(2.0);
    expect(best.t).toBeLessThan(2.6);
  });

  it('тяжёлые птицы летят ближе (launchScale): Matilda 35.5, Bomb 34.0, Terence 29.1 м (±5 %)', () => {
    const far = (bird: BirdType) => Math.max(...[42, 44, 46].map((a) => landing(bird, a).x));
    for (const [bird, x] of [['matilda', 35.5], ['bomb', 34.0], ['terence', 29.1]] as const) {
      expect(Math.abs(far(bird) / x - 1)).toBeLessThan(0.05);
    }
  });

  it('предсказание траектории совпадает с полётом тела planck', () => {
    const s = readySession(openField(['red']));
    const sl = s.slingshot();
    s.beginAim();
    s.updateAim(sl.pocket);
    s.updateAim({ x: sl.anchor.x - 1.5, y: sl.anchor.y - 1.2 });
    const predicted = s.predictTrajectory(30);
    s.release();
    for (let k = 1; k <= 30 * LAUNCH.PREDICT_STRIDE; k++) {
      s.step();
      if (k % LAUNCH.PREDICT_STRIDE === 0) {
        const b = s.focusBird()!;
        const p = predicted[k / LAUNCH.PREDICT_STRIDE - 1];
        expect(Math.abs(b.x - p.x)).toBeLessThan(1e-9);
        expect(Math.abs(b.y - p.y)).toBeLessThan(1e-9);
      }
    }
  });

  it('интерполяция: px/py — позиция на предыдущем шаге', () => {
    const s = readySession(openField(['red']));
    s.launch(45, 1);
    s.step();
    const before = { x: s.focusBird()!.x, y: s.focusBird()!.y };
    s.step();
    const b = s.focusBird()!;
    expect(b.px).toBe(before.x);
    expect(b.py).toBe(before.y);
    expect(b.x).toBeGreaterThan(b.px);
  });

  it('след: точки через фиксированный путь, крупная — в месте удара; новый выстрел очищает старый', () => {
    const s = readySession(hutLevel(['red', 'red']));
    shoot(s, 18, 1);
    const pts = s.trail();
    expect(pts.length).toBeGreaterThan(20);
    const small = pts.filter((p) => !p.big);
    for (let i = 1; i < small.length; i++) {
      expect(Math.hypot(small[i].x - small[i - 1].x, small[i].y - small[i - 1].y)).toBeLessThanOrEqual(TRAIL.STEP + 1e-6);
    }
    expect(pts.at(-1)!.big).toBe(true);
    const firstX = pts[0].x;
    s.launch(60, 0.4);
    expect(s.trail()).toHaveLength(0);
    runUntil(s, () => s.trail().length > 0, 2);
    expect(s.trail()[0].x).not.toBeCloseTo(firstX, 3);
  });

  it('камера: focusBird — летящая птица, после ухода — null', () => {
    const s = readySession(hutLevel(['red', 'red']));
    expect(s.focusBird()).toBeNull();
    s.launch(18, 1);
    const id = ofType(s.drainEvents(), 'birdLaunched')[0].id;
    expect(s.focusBird()?.id).toBe(id);
    expect(s.focusBird()?.kind).toBe('bird');
    const events = runUntil(s, () => s.focusBird() === null, 15);
    expect(ofType(events, 'birdRemoved').map((e) => e.id)).toEqual([id]);
  });

  it('птица, улетевшая за границы мира (bounds ± 8 м), уходит', () => {
    const s = readySession(hutLevel(['red', 'red']));
    s.launch(150, 1); // назад-вверх, влево за minX
    const events = runUntil(s, () => s.state !== 'flying', 15);
    const removed = ofType(events, 'birdRemoved');
    expect(removed).toHaveLength(1);
    expect(removed[0].x).toBeLessThan(s.level.bounds.minX - RETIRE.OUT_MARGIN);
    expect(removed[0].x).toBeGreaterThan(s.level.bounds.minX - RETIRE.OUT_MARGIN - 1);
    expect(s.state).toBe('settling');
  });

  it('над бездонной пропастью птица уходит через 10 с после запуска; след — кольцевой буфер', () => {
    const pit: TerrainDef[] = [
      { kind: 'ground', points: [[-40, -10], [10, -10], [10, 0], [-40, 0]] },
      { kind: 'rock', points: [[-40, -1010], [400, -1010], [400, -1000], [-40, -1000]] },
    ];
    const s = readySession(level({ birds: ['red'], bounds: { minX: -12, maxX: 400, maxY: 40 }, terrain: pit, pigs: [pigOn('small', 0, 0)] }));
    s.launch(45, 1);
    const t0 = s.time;
    const events = runUntil(s, () => s.state !== 'flying', 15);
    expect(ofType(events, 'birdRemoved')).toHaveLength(1);
    expect(s.time - t0).toBeCloseTo(RETIRE.FLIGHT_MAX, 6);
    const pts = s.trail();
    expect(pts.length).toBeLessThanOrEqual(TRAIL.MAX_POINTS);
    expect(pts.length).toBeGreaterThanOrEqual(TRAIL.MAX_POINTS - 2);
    expect(pts[0].x).toBeGreaterThan(30); // старые точки вытеснены
  });
});
