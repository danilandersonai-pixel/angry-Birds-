// Проверка устойчивости уровня без выстрелов (06 §7.1, стадии T0 + T1): усадка, как в createSession,
// затем все тела будятся, урон включён, `seconds` секунд симуляции без принудительного сна игры (SETTLE.SLEEP_HOLD),
// так что тела засыпают только сном planck; с keepAwake не засыпают вовсе — медленное сползание копится весь прогон.
// Публичный API сессии не умеет будить тела, поэтому проверка работает напрямую с PhysicsWorld — тем же миром,
// который строит сессия. «Прошёл»: 0 погибших свиней, 0 разрушенных блоков, смещения < 0.15 м, повороты < 10°
// (у кругов поворот не считается); пороги меняются через limits. Строгие нормы 06 §7.1 (T0 ≤ 0.05 м, T1 ≤ 0.05 м
// и 2°) в критерий не входят — смещения и повороты есть в отчёте, сравнить можно по ним.

import type { Body } from 'planck';
import { SETTLE, WORLD } from '../../config/constants';
import type { Ent } from '../physics/entities';
import { PhysicsWorld, type KillCause } from '../physics/PhysicsWorld';
import { Rng } from '../rng';
import type { LevelDef } from '../types';
import { wallMs } from './clock';

/** Пороги «прошёл» (смещения и повороты — от авторской позы). */
export const STABILITY_LIMITS = { SHIFT: 0.15, ROTATE_DEG: 10 } as const;

export interface StabilityOptions {
  seed?: number;
  limits?: { shift?: number; rotateDeg?: number };
  /**
   * Запретить сон planck на всё время прогона (по умолчанию false). Строже игры: без сна медленное сползание
   * (< 0.01 м/с, порог сна planck) не останавливается и копится все `seconds` секунд — так видны «ползущие» опоры.
   */
  keepAwake?: boolean;
}

/** Тело уровня: вид, индекс в массиве LevelDef (blocks / tnt / pigs), id из данных и краткое описание. */
export interface BodyRef {
  kind: 'block' | 'tnt' | 'pig';
  index: number;
  id?: string;
  /** id из данных или «block#3». */
  name: string;
  /** Материал/тип, форма, размер и авторская точка — для поиска в файле уровня. */
  what: string;
}

export interface BodyMotion extends BodyRef {
  /** Максимальное за прогон смещение центра, м. */
  shift: number;
  /** Максимальный за прогон поворот, градусы. */
  rotateDeg: number;
}

export interface BodyLoss extends BodyRef {
  /** Время от пробуждения, с (отрицательное — ещё во время усадки). */
  t: number;
  /** impact / blast / culled — гибель; lost — блок или TNT вылетел за границы мира. */
  cause: KillCause | 'lost';
}

export interface StabilityReport {
  levelId: string;
  pass: boolean;
  seconds: number;
  pigsKilled: BodyLoss[];
  /** Разрушенные или потерянные блоки и TNT. */
  destroyed: BodyLoss[];
  maxBlockShift: BodyMotion | null;
  /** Без кругов: шар может крутиться на месте. */
  maxBlockRotation: BodyMotion | null;
  maxPigShift: BodyMotion | null;
  /** Справочно (в критерий не входит — свинья круглая). */
  maxPigRotation: BodyMotion | null;
  /** Смещение после усадки (T0, 06: норма ≤ 0.05 м). */
  presettleShift: BodyMotion | null;
  /** Когда сцена впервые стала тихой на SETTLE.SLEEP_HOLD (в игре здесь был бы принудительный сон); null — не успокоилась. */
  settleTime: number | null;
  /** Когда все тела уснули сами (сон planck); null — кто-то не спал до конца прогона (или keepAwake). */
  sleepTime: number | null;
  /** Прогон шёл без сна planck (StabilityOptions.keepAwake). */
  keepAwake: boolean;
  /** Тела за порогами смещения или поворота, по убыванию смещения. */
  offenders: BodyMotion[];
  /** Причины провала по-русски. */
  failures: string[];
  ms: number;
}

interface Tracked extends BodyMotion {
  body: Body;
  x0: number;
  y0: number;
  a0: number;
  circle: boolean;
  alive: boolean;
}

const RAD = 180 / Math.PI;
const SETTLE_STEPS = Math.round(SETTLE.SLEEP_HOLD / WORLD.DT);

const fmt = (v: number) => String(Math.round(v * 100) / 100);

function describe(level: LevelDef, kind: BodyRef['kind'], index: number): Omit<BodyRef, 'kind' | 'index'> & { x: number; y: number; angle: number } {
  if (kind === 'block') {
    const b = level.blocks[index];
    const size = b.shape === 'circle' ? `⌀${fmt(b.w)}` : `${fmt(b.w)}×${fmt(b.h)}`;
    return { id: b.id, name: b.id ?? `block#${index}`, what: `${b.material} ${b.shape} ${size} @${fmt(b.x)},${fmt(b.y)}`, x: b.x, y: b.y, angle: b.angle ?? 0 };
  }
  if (kind === 'tnt') {
    const t = level.tnt![index];
    return { name: `tnt#${index}`, what: `tnt @${fmt(t.x)},${fmt(t.y)}`, x: t.x, y: t.y, angle: t.angle ?? 0 };
  }
  const p = level.pigs[index];
  return { id: p.id, name: p.id ?? `pig#${index}`, what: `${p.type} @${fmt(p.x)},${fmt(p.y)}`, x: p.x, y: p.y, angle: 0 };
}

function motionOf(t: Tracked): BodyMotion {
  const { kind, index, id, name, what, shift, rotateDeg } = t;
  return { kind, index, id, name, what, shift, rotateDeg };
}

function maxBy(list: readonly Tracked[], key: 'shift' | 'rotateDeg'): BodyMotion | null {
  let best: Tracked | null = null;
  for (const t of list) if (!best || t[key] > best[key]) best = t;
  return best && motionOf(best);
}

/** Устойчивость уровня без выстрелов: pass — никто не погиб и не разрушен, смещения и повороты в пределах порогов. */
export function checkStability(level: LevelDef, seconds = 10, opts: StabilityOptions = {}): StabilityReport {
  const started = wallMs();
  const shiftLimit = opts.limits?.shift ?? STABILITY_LIMITS.SHIFT;
  const rotLimit = opts.limits?.rotateDeg ?? STABILITY_LIMITS.ROTATE_DEG;
  const tracked = new Map<number, Tracked>();
  const counters = { block: 0, tnt: 0, pig: 0 };
  const killed = new Set<number>();
  const pigsKilled: BodyLoss[] = [];
  const destroyed: BodyLoss[] = [];
  let step = -WORLD.PRESETTLE_STEPS;

  const lose = (e: Ent, cause: BodyLoss['cause']) => {
    const t = tracked.get(e.id);
    if (!t) return;
    const { kind, index, id, name, what } = t;
    (kind === 'pig' ? pigsKilled : destroyed).push({ kind, index, id, name, what, t: step * WORLD.DT, cause });
  };

  const pw = new PhysicsWorld(level, new Rng(opts.seed ?? 1), {
    added(e) {
      if (e.kind !== 'block' && e.kind !== 'tnt' && e.kind !== 'pig') return;
      const index = counters[e.kind]++;
      const d = describe(level, e.kind, index);
      const circle = e.kind === 'pig' || (e.kind === 'block' && e.shape === 'circle');
      tracked.set(e.id, {
        kind: e.kind, index, id: d.id, name: d.name, what: d.what, shift: 0, rotateDeg: 0,
        body: e.body, x0: d.x, y0: d.y, a0: d.angle, circle, alive: true,
      });
    },
    hit() {},
    damaged() {},
    killed(e, cause) {
      killed.add(e.id);
      lose(e, cause);
    },
    removed(e) {
      if (!killed.has(e.id)) lose(e, 'lost');
      const t = tracked.get(e.id);
      if (t) t.alive = false;
    },
    exploded() {},
  });

  const measure = () => {
    for (const t of tracked.values()) {
      if (!t.alive) continue;
      const p = t.body.getPosition();
      t.shift = Math.max(t.shift, Math.hypot(p.x - t.x0, p.y - t.y0));
      t.rotateDeg = Math.max(t.rotateDeg, Math.abs(t.body.getAngle() - t.a0) * RAD);
    }
  };

  // T0: усадка, как в createSession (step — номер идущего шага: события внутри pw.step() датируются его концом)
  while (step < 0) {
    step++;
    pw.step();
  }
  pw.sleepAll();
  measure();
  const presettleShift = maxBy([...tracked.values()], 'shift');

  // T1: разбудить всё, урон включён
  pw.damageEnabled = true;
  const keepAwake = opts.keepAwake ?? false;
  if (keepAwake) pw.world.setAllowSleeping(false);
  for (const e of pw.ents.values()) if (e.kind !== 'terrain') e.body.setAwake(true);
  const total = Math.round(seconds / WORLD.DT);
  let quiet = 0;
  let settleTime: number | null = null;
  let sleepTime: number | null = null;
  while (step < total) {
    step++;
    pw.step();
    measure();
    quiet = pw.isQuiet() ? quiet + 1 : 0;
    if (settleTime === null && quiet >= SETTLE_STEPS) settleTime = step * WORLD.DT;
    if (!keepAwake && !pw.anyAwake()) {
      sleepTime = step * WORLD.DT; // спящий мир без внешних сил дальше не меняется
      break;
    }
  }

  const all = [...tracked.values()];
  const blocks = all.filter((t) => t.kind !== 'pig');
  const pigs = all.filter((t) => t.kind === 'pig');
  const rotated = (t: Tracked) => !t.circle && t.rotateDeg >= rotLimit;
  const over = all.filter((t) => t.shift >= shiftLimit || rotated(t)).sort((a, b) => b.shift - a.shift);

  const failures: string[] = [];
  for (const p of pigsKilled) failures.push(`свинья ${p.name} [${p.what}] погибла на ${fmt(p.t)} с (${p.cause})`);
  for (const b of destroyed) failures.push(`${b.name} [${b.what}] ${b.cause === 'lost' ? 'вылетел за границы' : 'разрушен'} на ${fmt(b.t)} с`);
  for (const o of over) {
    const parts: string[] = [];
    if (o.shift >= shiftLimit) parts.push(`смещение ${o.shift.toFixed(3)} м ≥ ${shiftLimit}`);
    if (rotated(o)) parts.push(`поворот ${o.rotateDeg.toFixed(1)}° ≥ ${rotLimit}°`);
    failures.push(`${o.name} [${o.what}]: ${parts.join(', ')}`);
  }

  return {
    levelId: level.id,
    pass: failures.length === 0,
    seconds,
    pigsKilled,
    destroyed,
    maxBlockShift: maxBy(blocks, 'shift'),
    maxBlockRotation: maxBy(blocks.filter((t) => !t.circle), 'rotateDeg'),
    maxPigShift: maxBy(pigs, 'shift'),
    maxPigRotation: maxBy(pigs, 'rotateDeg'),
    presettleShift,
    settleTime,
    sleepTime,
    keepAwake,
    offenders: over.map(motionOf),
    failures,
    ms: wallMs() - started,
  };
}
