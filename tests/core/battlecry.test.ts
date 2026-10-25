// Боевой клич Ред из AB2 (P2) работает только при ABILITY.RED_BATTLE_CRY = true (по умолчанию выключен).

import { describe, expect, it, vi } from 'vitest';
import { level, pigOn, rect } from '../fixtures/levels';
import { readySession, runUntil } from './helpers';

vi.mock('../../src/config/constants', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/config/constants')>();
  return { ...orig, ABILITY: { ...orig.ABILITY, RED_BATTLE_CRY: true } };
});

describe('Ред: боевой клич под флагом', () => {
  it('толкает тела в конусе по курсу без урона и слегка тормозит птицу', async () => {
    const { ABILITY } = await import('../../src/config/constants');
    // кубик на каменной тумбе — на уровне полёта птицы
    const lvl = level({ birds: ['red'], blocks: [rect('stone', 9, 0.75, 1, 1.5), rect('wood', 9, 1.75, 0.5, 0.5)], pigs: [pigOn('small', 50, 0)] });
    const s = readySession(lvl);
    s.launch(0, 0.8);
    runUntil(s, () => s.focusBird()!.x > 9 - 2, 3);
    const before = { ...s.focusBird()! };
    expect(s.activateAbility()).toBe(true);
    s.step();
    const cube = [...s.entities()].find((e) => e.kind === 'block' && e.material === 'wood')!;
    expect(Math.hypot(cube.vx, cube.vy)).toBeGreaterThan(1);
    expect(cube.vy).toBeGreaterThan(0);
    expect(cube.health).toBe(1);
    const after = s.focusBird()!;
    expect(Math.abs(after.vx)).toBeLessThan(Math.abs(before.vx) * ABILITY.RED.SELF_SLOW + 0.01);
  });
});
