// Контракт событий (events.ts): каждый тип GameEvent порождается ядром, все числовые поля конечны.

import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventType } from '../../src/core/events';
import { hutLevel, level, pigOn } from '../fixtures/levels';
import { ofType, readySession, runFor, runUntil, shoot } from './helpers';

const ALL: GameEventType[] = [
  'stateChanged', 'birdLoaded', 'aimStart', 'aimStretch', 'aimCancel', 'birdLaunched', 'ability', 'impact', 'birdImpact',
  'birdRemoved', 'blockDamaged', 'blockDestroyed', 'pigDamaged', 'pigDestroyed', 'tntDestroyed', 'explosion', 'score',
  'birdBonus', 'pigsLaugh', 'levelEnd',
];

/** Прицел с отменой, промах (смех), Синие в деревянную башню. */
function hutScenario(): GameEvent[] {
  const s = readySession(hutLevel(['red', 'blues', 'red']));
  const events: GameEvent[] = [];
  const sl = s.slingshot();
  s.beginAim();
  s.updateAim(sl.pocket);
  for (let d = 0.1; d <= 1.5; d += 0.1) s.updateAim({ x: sl.anchor.x - d, y: sl.anchor.y });
  s.updateAim({ x: sl.anchor.x - 0.2, y: sl.anchor.y });
  s.release(); // слабое натяжение — отмена
  events.push(...s.drainEvents());
  shoot(s, 150, 1, events); // назад — промах
  s.launch(18, 1);
  runFor(s, 0.4, events);
  s.activateAbility();
  runUntil(s, () => s.state === 'ready' || s.state === 'won' || s.state === 'lost', 20, events);
  return events;
}

/** Bomb в склад TNT со свиньями (в том числе в каске) — победа с бонусом. */
function tntScenario(): GameEvent[] {
  const s = readySession(level({
    birds: ['bomb', 'red'],
    tnt: [{ x: 24, y: 0.5 }, { x: 26, y: 0.5 }],
    pigs: [pigOn('small', 25, 0), pigOn('helmet', 27.2, 0)],
  }));
  return shoot(s, 17, 1, []).concat(runUntil(s, () => s.state === 'won' || s.state === 'lost', 20));
}

function finiteFields(e: GameEvent): boolean {
  return Object.values(e).every((v) => typeof v !== 'number' || Number.isFinite(v));
}

describe('события', () => {
  it('ядро порождает все типы GameEvent с конечными числовыми полями', () => {
    const events = [...hutScenario(), ...tntScenario()];
    const types = new Set(events.map((e) => e.type));
    expect(ALL.filter((t) => !types.has(t))).toEqual([]);
    expect(events.every(finiteFields)).toBe(true);
  });

  it('помощь звуку и эффектам: каска слетает событием pigDamaged.helmetLost, взрыв TNT — радиус 3 м', () => {
    const events = tntScenario();
    expect(ofType(events, 'pigDamaged').some((e) => e.pig === 'helmet' && e.helmetLost)).toBe(true);
    expect(ofType(events, 'explosion').filter((e) => e.source === 'tnt').map((e) => e.radius)).toEqual([3, 3]);
    expect(ofType(events, 'levelEnd')[0].won).toBe(true);
    expect(ofType(events, 'birdBonus')).toHaveLength(1);
  });
});
