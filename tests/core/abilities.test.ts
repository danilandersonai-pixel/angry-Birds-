import { describe, expect, it } from 'vitest';
import { ABILITY, LAUNCH } from '../../src/config/constants';
import type { EntityView, GameSession } from '../../src/core/api';
import type { BirdType } from '../../src/core/types';
import { hutLevel, level, openField, rect } from '../fixtures/levels';
import { ofType, readySession, runFor, runUntil } from './helpers';

const V = LAUNCH.V_MAX;
const birds = (s: GameSession): EntityView[] => [...s.entities()].filter((e) => e.kind === 'bird');
const speed = (e: EntityView) => Math.hypot(e.vx, e.vy);
const heading = (e: EntityView) => Math.atan2(e.vy, e.vx);
const deg = (r: number) => (r * 180) / Math.PI;

/** Выстрел и тап через t секунд полёта; возвращает вид птицы непосредственно перед тапом. */
function tapAfter(bird: BirdType, angle: number, power: number, t: number, lvl = openField([bird])) {
  const s = readySession(lvl);
  s.launch(angle, power);
  runFor(s, t);
  const before = { ...s.focusBird()! };
  s.drainEvents();
  const ok = s.activateAbility();
  return { s, before, ok, events: s.drainEvents() };
}

describe('способности', () => {
  it('окно: не раньше 0.05 с, один раз, до первого контакта', () => {
    const s = readySession(openField(['red', 'red']));
    s.launch(40, 1);
    expect(s.activateAbility()).toBe(false); // сразу после выстрела
    runFor(s, 0.2);
    expect(s.activateAbility()).toBe(true);
    expect(s.activateAbility()).toBe(false);
    expect(s.focusBird()!.abilityUsed).toBe(false); // вид обновится на шаге
    s.step();
    expect(s.focusBird()!.abilityUsed).toBe(true);

    const t = readySession(openField(['red']));
    t.launch(10, 0.5);
    runUntil(t, () => t.focusBird()?.birdPose !== 'fly', 5);
    expect(t.activateAbility()).toBe(false); // после удара о землю
  });

  it('Ред: боевой клич толкает тела в конусе по курсу и слегка тормозит птицу', () => {
    const lvl = level({ birds: ['red'], blocks: [rect('wood', 9, 0.25, 0.5, 0.5)], pigs: [{ type: 'small', x: 50, y: 0.405 }] });
    const s = readySession(lvl);
    s.launch(8, 0.6);
    runUntil(s, () => s.focusBird()!.x > 9 - 3, 3);
    const before = { ...s.focusBird()! };
    expect(s.activateAbility()).toBe(true);
    s.step();
    const cube = [...s.entities()].find((e) => e.kind === 'block')!;
    expect(cube.vx).toBeGreaterThan(1);
    expect(cube.vy).toBeGreaterThan(0);
    expect(speed(s.focusBird()!)).toBeLessThan(speed(before) * ABILITY.RED.SELF_SLOW + 0.3);
  });

  it('Синие: трое с веером ±8°, одинаковой скоростью, друг с другом не сталкиваются', () => {
    const { s, before, ok, events } = tapAfter('blues', 30, 1, 0.3);
    expect(ok).toBe(true);
    expect(ofType(events, 'ability')).toHaveLength(1);
    const trio = birds(s);
    expect(trio).toHaveLength(3);
    const h0 = heading(before);
    const angles = trio.map((b) => heading(b) - h0).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-ABILITY.BLUES.SPREAD_RAD, 3);
    expect(angles[1]).toBeCloseTo(0, 3);
    expect(angles[2]).toBeCloseTo(ABILITY.BLUES.SPREAD_RAD, 3);
    for (const b of trio) expect(speed(b)).toBeCloseTo(speed(before), 3);
    runFor(s, 0.4);
    const ys = birds(s).map((b) => b.y).sort((a, b) => a - b);
    expect(ys[2] - ys[0]).toBeGreaterThan(2); // разлетаются
    expect(birds(s).every((b) => b.birdPose === 'fly')).toBe(true); // не задели друг друга
  });

  it('Чак: рывок по курсу до clamp(1.5·|v|, 1.3·V, 1.6·V)', () => {
    const { s, before } = tapAfter('chuck', 30, 1, 0.3);
    s.step();
    const after = s.focusBird()!;
    const expected = Math.min(1.6 * V, Math.max(1.3 * V, 1.5 * speed(before)));
    expect(speed(after)).toBeCloseTo(expected, 0);
    expect(Math.cos(heading(after) - heading(before))).toBeGreaterThan(0.999);
    expect(after.angle).toBeCloseTo(heading(after), 1); // нос по скорости
  });

  it('Бомб: взрыв по тапу рушит башню, тело птицы исчезает без «пуфа»', () => {
    const s = readySession(hutLevel(['bomb', 'red']));
    s.launch(17, 1);
    const events = runUntil(s, () => s.focusBird()!.x > 24.5, 3);
    expect(s.activateAbility()).toBe(true);
    runFor(s, 2, events);
    expect(ofType(events, 'explosion').filter((e) => e.source === 'bomb')).toHaveLength(1);
    expect(ofType(events, 'blockDestroyed').length).toBeGreaterThanOrEqual(3);
    expect(ofType(events, 'birdRemoved')).toHaveLength(0);
    expect(birds(s)).toHaveLength(0);
  });

  it('Бомб: без тапа взрывается через 2.5 с после первого удара', () => {
    const s = readySession(openField(['bomb']));
    s.launch(10, 0.5);
    const events = runUntil(s, () => s.focusBird()?.birdPose !== 'fly', 5);
    const hitTime = s.time;
    runUntil(s, () => ofType(events, 'explosion').length > 0, 5, events);
    expect(s.time - hitTime).toBeCloseTo(ABILITY.BOMB.FUSE, 1);
    expect(ofType(events, 'explosion')[0].source).toBe('bomb');
  });

  it('Матильда: яйцо строго вниз, сама — вверх под 60°; яйцо взрывается при касании', () => {
    const { s, ok } = tapAfter('matilda', 45, 1, 0.5);
    expect(ok).toBe(true);
    const egg = [...s.entities()].find((e) => e.kind === 'egg')!;
    expect(egg.vx).toBeCloseTo(0, 9);
    expect(egg.vy).toBeCloseTo(ABILITY.MATILDA.EGG_VY_K * V, 9);
    expect(s.focusBird()!.id).toBe(egg.id); // камера следит за яйцом
    s.step();
    const m = birds(s)[0];
    expect(deg(heading(m))).toBeCloseTo(ABILITY.MATILDA.UP_DEG, -0.5);
    expect(speed(m)).toBeGreaterThan(ABILITY.MATILDA.UP_MIN_K * V - 0.5);
    const events = runUntil(s, () => ![...s.entities()].some((e) => e.kind === 'egg'), 3);
    expect(ofType(events, 'explosion').map((e) => e.source)).toEqual(['egg']);
  });

  it('Хэл: бумеранг — разворот курса на зеркальный с подъёмом 10°, без гравитации на дуге', () => {
    const { s, before } = tapAfter('hal', 20, 1, 0.6); // к 0.6 с курс уже вниз
    const a0 = heading(before);
    expect(a0).toBeLessThan(0);
    const turn = Math.PI - a0 - (ABILITY.HAL.LIFT_DEG * Math.PI) / 180 - a0; // против часовой
    const steps = Math.ceil(turn / ABILITY.HAL.OMEGA / LAUNCH.R_MAX ** 0 / (1 / 60));
    s.step();
    const s1 = speed(s.focusBird()!);
    runFor(s, (steps - 2) / 60);
    expect(speed(s.focusBird()!)).toBeCloseTo(s1, 6); // на дуге модуль скорости постоянен
    runFor(s, 2 / 60);
    const end = heading(s.focusBird()!);
    const expected = Math.PI - a0 - (ABILITY.HAL.LIFT_DEG * Math.PI) / 180;
    expect(Math.cos(end - expected)).toBeGreaterThan(Math.cos((3 * Math.PI) / 180));
    expect(s.focusBird()!.vx).toBeLessThan(0); // летит назад
  });

  it('Теренс: способности нет — только событие (рык), траектория не меняется', () => {
    const { s, before, ok, events } = tapAfter('terence', 40, 1, 0.3);
    expect(ok).toBe(true);
    expect(ofType(events, 'ability')).toHaveLength(1);
    s.step();
    const after = s.focusBird()!;
    expect(after.vx).toBeCloseTo(before.vx, 9);
    expect(after.vy).toBeCloseTo(before.vy - 15 / 60, 9);
  });

  it('Сильвер: петля 2π за ~0.57 с, затем пике вниз', () => {
    const { s, before } = tapAfter('silver', 45, 1, 0.3);
    const loopSteps = Math.ceil((2 * Math.PI) / ABILITY.SILVER.OMEGA * 60);
    runFor(s, loopSteps / 60);
    const atLoopEnd = s.focusBird()!;
    expect(Math.hypot(atLoopEnd.x - before.x, atLoopEnd.y - before.y)).toBeLessThan(0.6); // петля замкнулась
    s.step();
    const dive = s.focusBird()!;
    expect(dive.vy).toBeLessThan(-ABILITY.SILVER.DIVE_K * V + 0.3);
    expect(Math.abs(dive.vx)).toBeLessThan(0.15 * speed(before) + 0.5);
    expect(dive.angle).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('Сильвер в пике бьёт по камню сильнее (×2.6)', () => {
    const lvl = level({ birds: ['silver'], blocks: [rect('stone', 0, 0.5, 1, 1)], pigs: [{ type: 'small', x: 50, y: 0.405 }] });
    lvl.slingshot = { x: -8, y: 2.7 };
    const s = readySession(lvl);
    s.launch(55, 0.62);
    runUntil(s, () => s.focusBird()!.vy < 0 && s.focusBird()!.x > -2.2, 3);
    s.activateAbility();
    const events = runFor(s, 2);
    const stone = [...s.entities()].find((e) => e.kind === 'block');
    const destroyed = ofType(events, 'blockDestroyed').length > 0;
    expect(destroyed || stone!.health < 0.5).toBe(true);
  });
});
