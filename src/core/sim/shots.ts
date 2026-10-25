// Прогон серии выстрелов через публичный API сессии (06 §7): каждый выстрел — когда рогатка готова
// (по умолчанию ещё и после покоя сцены, как у бота-эксперта 06 §7.2), тап способности — по session.time.
// Один и тот же (level, shots, seed, wait) всегда даёт один и тот же результат.

import { SETTLE, WORLD } from '../../config/constants';
import { createSession, type BirdType, type GameSession, type LevelDef, type SessionState } from '../index';

/** Выстрел: угол в градусах (0 — вправо, 90 — вверх), сила 0..1, тап способности через abilityAt с после запуска. */
export interface Shot {
  angleDeg: number;
  power: number;
  abilityAt?: number | null;
}

/**
 * Когда стрелять следующей птицей.
 * 'calm' — рогатка готова и сцена тиха SETTLE.SLEEP_HOLD (или прошло BOT_AFTER_IMPACT с после удара / BOT_AFTER_LAUNCH
 * после запуска) — консервативный ход бота 06 §7.2; 'ready' — сразу, как только птица в рогатке.
 */
export type WaitPolicy = 'calm' | 'ready';

export interface SimOptions {
  /** По умолчанию 'calm'. */
  wait?: WaitPolicy;
}

export interface ShotLog {
  bird: BirdType;
  shot: Shot;
  /** session.time в момент запуска, с. */
  launchedAt: number;
  /** Первый контакт птицы, с после запуска; null — его не было. */
  impactAt: number | null;
  /** activateAbility() сработала (способность применена). */
  abilityUsed: boolean;
  pigsKilled: number;
  /** Разрушенные блоки и TNT. */
  blocksDestroyed: number;
  /** Очки за ход (с бонусом птиц, если ход закончил уровень). */
  points: number;
  pigsLeft: number;
  /** От запуска до готовности к следующему выстрелу или до конца уровня, с. */
  duration: number;
}

export interface SimResult {
  score: number;
  /** Звёзды при победе, иначе 0. */
  stars: number;
  pigsLeft: number;
  birdsLeft: number;
  /** won / lost — уровень окончен; ready — птицы остались, выстрелы кончились. */
  state: SessionState;
  won: boolean;
  /** Выстрелы из списка, которые не понадобились: свиньи кончились раньше. */
  skipped: number;
  shots: ShotLog[];
  /** session.time в конце прогона, с. */
  time: number;
}

const DT = WORLD.DT;
const EPS = 1e-9;
const CALM_STEPS = Math.round(SETTLE.SLEEP_HOLD / DT);
/** Страховка от зависания: ни одно ожидание не длится дольше (все таймауты сессии короче). */
const MAX_WAIT_STEPS = Math.round(60 / DT);

function ended(s: GameSession): boolean {
  return s.state === 'won' || s.state === 'lost';
}

/** Тихий шаг по снимкам (00 §1.9): все тела медленнее порогов покоя; спящие тела стоят. */
function quiet(s: GameSession): boolean {
  for (const e of s.entities()) {
    if (Math.hypot(e.vx, e.vy) > SETTLE.V_LIN || Math.abs(e.angle - e.pangle) > SETTLE.V_ANG * DT) return false;
  }
  return true;
}

function stepUntil(s: GameSession, done: () => boolean): void {
  for (let i = 0; i < MAX_WAIT_STEPS && !done(); i++) {
    s.step();
    s.drainEvents();
  }
}

/** Выстрел из состояния ready и ожидание конца хода: следующий выстрел по правилу wait либо конец уровня. */
function playShot(s: GameSession, shot: Shot, wait: WaitPolicy): ShotLog {
  const bird = s.slingshot().loaded!;
  const t0 = s.time;
  const score0 = s.score;
  const pigs0 = s.pigsLeft;
  let impactAt: number | null = null;
  let abilityUsed = false;
  let tapPending = shot.abilityAt != null;
  let blocksDestroyed = 0;
  let calm = 0;
  const collect = () => {
    for (const e of s.drainEvents()) {
      if (e.type === 'birdImpact') impactAt ??= s.time - t0;
      else if (e.type === 'blockDestroyed' || e.type === 'tntDestroyed') blocksDestroyed++;
    }
  };

  const birds0 = s.birdsLeft;
  s.launch(shot.angleDeg, shot.power);
  if (s.birdsLeft === birds0) throw new Error(`выстрел не состоялся: состояние ${s.state}`);
  collect();
  for (let i = 0; i < MAX_WAIT_STEPS; i++) {
    s.step();
    collect();
    const since = s.time - t0;
    if (tapPending && since >= shot.abilityAt! - EPS) {
      tapPending = false;
      if (s.state === 'flying') abilityUsed = s.activateAbility();
      collect();
    }
    calm = quiet(s) ? calm + 1 : 0;
    if (ended(s)) break;
    // победа: доигрываем до won (бонус птиц); иначе ход кончается, когда в рогатке следующая птица
    if (s.state !== 'ready' || s.pigsLeft === 0) continue;
    if (
      wait === 'ready' ||
      calm >= CALM_STEPS ||
      since >= SETTLE.BOT_AFTER_LAUNCH - EPS ||
      (impactAt !== null && since - impactAt >= SETTLE.BOT_AFTER_IMPACT - EPS)
    ) {
      break;
    }
  }
  return {
    bird,
    shot,
    launchedAt: t0,
    impactAt,
    abilityUsed,
    pigsKilled: pigs0 - s.pigsLeft,
    blocksDestroyed,
    points: s.score - score0,
    pigsLeft: s.pigsLeft,
    duration: s.time - t0,
  };
}

/** Выстрелы по очереди с нуля; затем — до готовности следующего выстрела или конца уровня (при победе — до won с бонусом птиц). */
export function simulateShots(level: LevelDef, shots: readonly Shot[], seed = 1, opts: SimOptions = {}): SimResult {
  const wait = opts.wait ?? 'calm';
  const s = createSession(level, { seed });
  const log: ShotLog[] = [];
  let skipped = 0;
  for (const shot of shots) {
    stepUntil(s, () => s.state === 'ready' || ended(s));
    if (s.state !== 'ready' || s.pigsLeft === 0) {
      skipped++;
      continue;
    }
    log.push(playShot(s, shot, wait));
  }
  stepUntil(s, () => (s.pigsLeft > 0 && s.state === 'ready') || ended(s));
  const won = s.state === 'won';
  return {
    score: s.score,
    stars: won ? s.stars() : 0,
    pigsLeft: s.pigsLeft,
    birdsLeft: s.birdsLeft,
    state: s.state,
    won,
    skipped,
    shots: log,
    time: s.time,
  };
}
