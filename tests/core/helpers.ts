// Общие помощники тестов ядра.

import type { GameSession } from '../../src/core/api';
import type { GameEvent } from '../../src/core/events';
import { createSession } from '../../src/core/game/GameSession';
import type { Destructible } from '../../src/core/physics/entities';
import { PhysicsWorld, type KillCause } from '../../src/core/physics/PhysicsWorld';
import { Rng } from '../../src/core/rng';
import type { LevelDef } from '../../src/core/types';

export const STEPS_PER_SECOND = 60;

/** Шагает, пока pred не станет истинным (не больше maxSeconds); собирает события. */
export function runUntil(s: GameSession, pred: () => boolean, maxSeconds = 30, events: GameEvent[] = []): GameEvent[] {
  for (let i = 0; i < maxSeconds * STEPS_PER_SECOND && !pred(); i++) {
    s.step();
    events.push(...s.drainEvents());
  }
  return events;
}

export function runFor(s: GameSession, seconds: number, events: GameEvent[] = []): GameEvent[] {
  for (let i = 0; i < Math.round(seconds * STEPS_PER_SECOND); i++) {
    s.step();
    events.push(...s.drainEvents());
  }
  return events;
}

/** Сессия, в которой птица уже в рогатке. */
export function readySession(level: LevelDef, seed = 1): GameSession {
  const s = createSession(level, { seed });
  runUntil(s, () => s.state === 'ready', 5);
  s.drainEvents();
  return s;
}

/** Выстрел и ожидание конца хода (следующая птица в рогатке или конец уровня). */
export function shoot(s: GameSession, angleDeg: number, power: number, events: GameEvent[] = []): GameEvent[] {
  s.launch(angleDeg, power);
  events.push(...s.drainEvents());
  return runUntil(s, () => s.state === 'ready' || s.state === 'won' || s.state === 'lost', 40, events);
}

export function ofType<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }>[] {
  return events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}

/** Физический мир уровня после усадки с журналом урона и гибелей; урон включён. */
export function physicsOf(level: LevelDef) {
  const log = { damage: 0, killed: [] as Array<{ e: Destructible; cause: KillCause }>, explosions: 0 };
  const pw = new PhysicsWorld(level, new Rng(1), {
    added() {},
    hit() {},
    damaged(_e, applied) {
      log.damage += applied;
    },
    killed(e, cause) {
      log.killed.push({ e, cause });
    },
    removed() {},
    exploded() {
      log.explosions++;
    },
  });
  pw.presettle();
  pw.damageEnabled = true;
  return { pw, log };
}

export function stepWorld(pw: PhysicsWorld, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * STEPS_PER_SECOND); i++) pw.step();
}
