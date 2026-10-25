// Конечный автомат сессии и тайминги 00 §1.12: загрузка, ход, победа с бонусом, поражение, смех свиней,
// доигрыш прицела после победы, устойчивость API к вызовам в неправильном состоянии, детерминизм, скорость шага.

import { describe, expect, it } from 'vitest';
import { CAMERA, SCORE, TIMING } from '../../src/config/constants';
import { createSession } from '../../src/core';
import type { GameSession } from '../../src/core/api';
import type { GameEvent, SessionState } from '../../src/core/events';
import type { PhysicsWorld } from '../../src/core/physics/PhysicsWorld';
import type { LevelDef } from '../../src/core/types';
import { bigLevel, hutLevel, level, pigOn, rect, unreachableLevel } from '../fixtures/levels';
import { destructibles, ofType, physicsOf, readySession, runFor, runUntil, stepWorld } from './helpers';

/** Одна medium в 10 м: горизонтальный выстрел на полной силе пробивает её. */
const oneShotLevel = (birds: LevelDef['birds'] = ['red', 'red', 'red']) => level({ birds, pigs: [pigOn('medium', 10, 0)] });

/** Свинья на склоне над обрывом: слабый толчок — она скатывается и падает за границу мира через несколько секунд. */
function rollingPigLevel(): LevelDef {
  const drop = 12 * Math.tan((10 * Math.PI) / 180);
  return level({
    bounds: { minX: -12, maxX: 60, maxY: 30 },
    terrain: [{ kind: 'ground', points: [[-40, -10], [24, -10], [24, -drop], [12, 0], [-40, 0]] }],
    pigs: [{ type: 'small', x: 12.5, y: 0.405 }],
  });
}

const changes = (events: GameEvent[]) => ofType(events, 'stateChanged').map((e) => `${e.from}>${e.to}`);
const timeOf = (log: Array<{ t: number; e: GameEvent }>, pred: (e: GameEvent) => boolean) => log.find((x) => pred(x.e))!.t;

/** Прогон с журналом событий и временем каждого. */
function record(s: GameSession, until: () => boolean, maxSeconds: number) {
  const log: Array<{ t: number; e: GameEvent }> = [];
  for (let i = 0; i < maxSeconds * 60 && !until(); i++) {
    s.step();
    for (const e of s.drainEvents()) log.push({ t: s.time, e });
  }
  return log;
}

describe('автомат сессии', () => {
  it('старт: pre-settle без урона (свинья, упавшая с 5 м при загрузке, жива); loading → ready за 0.45 с', () => {
    const s = createSession(level({ pigs: [{ type: 'small', x: 20, y: 5.4 }] }), { seed: 1 });
    expect(s.state).toBe('loading');
    expect(s.pigsLeft).toBe(1);
    expect(s.score).toBe(0);
    const pig = [...s.entities()].find((e) => e.kind === 'pig')!;
    expect(pig.y).toBeLessThan(0.5); // свинья уже на земле — усадка прошла
    expect(pig.health).toBe(1);
    const events = runUntil(s, () => s.state === 'ready', 2);
    expect(s.time).toBeCloseTo(TIMING.BIRD_HOP_TIME, 9);
    expect(changes(events)).toEqual(['loading>ready']);
    expect(ofType(events, 'birdLoaded')).toHaveLength(1);
  });

  it('покой 10 с без выстрела: ни урона, ни разрушений, ни очков', () => {
    const s = readySession(hutLevel());
    const events = runFor(s, 10);
    expect(events.filter((e) => e.type !== 'impact')).toEqual([]);
    expect(s.score).toBe(0);
    expect([...s.entities()].every((e) => e.health === 1)).toBe(true);
  });

  it('птица ушла из-под балки — балка падает, а не засыпает в воздухе принудительным сном', () => {
    const s = readySession(level({ birds: ['red', 'red'], blocks: [rect('wood', 32.6, 0.25, 4, 0.5)], pigs: [pigOn('small', 50, 0)] }));
    const pw = (s as unknown as { physics: PhysicsWorld }).physics; // только постановка сцены
    s.launch(0, 0.6);
    const events: GameEvent[] = [];
    runUntil(s, () => ofType(events, 'birdImpact').length > 0, 3, events);
    // птица неподвижна на земле, балка левым концом на земле, правым — на птице
    const bird = [...pw.ents.values()].find((e) => e.kind === 'bird')!;
    bird.body.setTransform({ x: 34.2, y: 0.45 }, 0);
    bird.body.setLinearVelocity({ x: 0, y: 0 });
    bird.body.setAngularVelocity(0);
    const beam = destructibles(pw)[0].body;
    beam.setTransform({ x: 32.4, y: 0.75 }, Math.asin(0.6 / 4));
    beam.setAwake(true);
    runUntil(s, () => ofType(events, 'birdRemoved').length > 0, 3, events);
    expect(beam.getAngle()).toBeGreaterThan(0.15); // до ухода птица держала балку
    runFor(s, 1.5);
    expect(Math.abs(beam.getAngle())).toBeLessThan(0.02);
    expect(beam.getPosition().y).toBeLessThan(0.3);
  });

  it('ход: уход птицы → settling (задержка ≤ 0.6 с + возврат камеры) → loading → ready; смех после промаха', () => {
    const s = readySession(hutLevel());
    s.launch(60, 0.4); // недолёт
    const log = record(s, () => s.state === 'ready', 15);
    const events = log.map((x) => x.e);
    expect(changes(events)).toEqual(['ready>flying', 'flying>settling', 'settling>loading', 'loading>ready']);
    const removed = ofType(events, 'birdRemoved')[0];
    const tRemoved = timeOf(log, (e) => e.type === 'birdRemoved');
    const tLoading = timeOf(log, (e) => e.type === 'stateChanged' && e.to === 'loading');
    const ret = Math.min(CAMERA.RETURN_MAX, Math.max(CAMERA.RETURN_MIN, CAMERA.RETURN_BASE + Math.abs(removed.x - s.slingshot().anchor.x) * CAMERA.RETURN_PER_M));
    expect(tLoading - tRemoved).toBeGreaterThanOrEqual(ret - 1e-6);
    expect(tLoading - tRemoved).toBeLessThanOrEqual(ret + TIMING.LINGER_MAX + 1e-6);
    const laugh = ofType(events, 'pigsLaugh');
    expect(laugh).toHaveLength(1);
    expect(laugh[0].pigs).toEqual(['small', 'small']);
    expect(timeOf(log, (e) => e.type === 'pigsLaugh')).toBe(tRemoved);
    expect(s.birdsLeft).toBe(2);
  });

  it('смех после промаха: позы laugh на 1.2 с (со сдвигом до 0.4 с); после выстрела с убийством — без смеха', () => {
    const s = readySession(hutLevel());
    s.launch(60, 0.4);
    const events: GameEvent[] = [];
    runUntil(s, () => ofType(events, 'pigsLaugh').length > 0, 15, events);
    runFor(s, 0.45);
    const pigs = [...s.entities()].filter((e) => e.kind === 'pig');
    expect(pigs.every((p) => p.pigPose === 'laugh')).toBe(true);
    runFor(s, 1.2);
    expect(pigs.every((p) => p.pigPose === 'idle')).toBe(true);
    const k = readySession(oneShotLevel(['red', 'red']));
    k.launch(0, 1);
    expect(ofType(runUntil(k, () => k.state === 'won', 20), 'pigsLaugh')).toHaveLength(0);
  });

  it('победа: гибель последней свиньи → ≥ 1.2 с и покой → bonus; +10 000 за птицу в 1.5 + 0.45·i с; won в 2.0 + 0.45·n с', () => {
    const s = readySession(oneShotLevel());
    s.launch(0, 1);
    const log = record(s, () => s.state === 'won', 20);
    const events = log.map((x) => x.e);
    expect(changes(events)).toEqual(['ready>flying', 'flying>settling', 'settling>bonus', 'bonus>won']);
    const tKill = timeOf(log, (e) => e.type === 'pigDestroyed');
    const tBonus = timeOf(log, (e) => e.type === 'stateChanged' && e.to === 'bonus');
    expect(tBonus - tKill).toBeGreaterThanOrEqual(TIMING.VICTORY_MIN - 1e-9);
    expect(tBonus).toBeGreaterThan(timeOf(log, (e) => e.type === 'birdRemoved')); // летящая птица доиграна
    const bonuses = log.filter((x) => x.e.type === 'birdBonus');
    expect(bonuses).toHaveLength(2);
    bonuses.forEach((b, i) => expect(b.t - tBonus).toBeCloseTo(TIMING.CLEARED_BANNER + TIMING.BONUS_PRE + i * TIMING.BONUS_PER_BIRD, 6));
    const tWon = timeOf(log, (e) => e.type === 'levelEnd');
    expect(tWon - tBonus).toBeCloseTo(TIMING.CLEARED_BANNER + TIMING.BONUS_PRE + 2 * TIMING.BONUS_PER_BIRD + TIMING.BONUS_POST, 6);
    const end = ofType(events, 'levelEnd')[0];
    // всплывает ровно 5000 (событие и score), полный урон medium (100) начисляется молча
    expect(ofType(events, 'pigDestroyed')[0].points).toBe(SCORE.PIG);
    expect(ofType(events, 'score').filter((e) => e.kind === 'pig').map((e) => e.points)).toEqual([SCORE.PIG]);
    expect(end).toEqual({ type: 'levelEnd', won: true, score: SCORE.PIG + 100 + 2 * SCORE.UNUSED_BIRD, stars: s.stars() });
    expect(s.score).toBe(end.score);
    expect(s.stars()).toBe(2); // пороги фикстуры 20 000 / 30 000
    // после победы физика идёт, состояние не меняется, очки не начисляются
    runFor(s, 2);
    expect(s.state).toBe('won');
    expect(s.score).toBe(end.score);
  });

  it('победа без оставшихся птиц: бонус-фаза короче (баннер + 0.6 с)', () => {
    const s = readySession(oneShotLevel(['red']));
    s.launch(0, 1);
    const log = record(s, () => s.state === 'won', 20);
    const tBonus = timeOf(log, (e) => e.type === 'stateChanged' && e.to === 'bonus');
    expect(timeOf(log, (e) => e.type === 'levelEnd') - tBonus).toBeCloseTo(TIMING.CLEARED_BANNER + TIMING.BONUS_NONE, 6);
    expect(ofType(log.map((x) => x.e), 'birdBonus')).toHaveLength(0);
  });

  it('поражение: птиц нет, свиньи живы → settling → lost (покой 0.6 с или 7 с), 0 звёзд, свиньи смеются', () => {
    const s = readySession(unreachableLevel());
    s.launch(45, 1);
    const log = record(s, () => s.state === 'lost', 20);
    const events = log.map((x) => x.e);
    expect(changes(events)).toEqual(['ready>flying', 'flying>settling', 'settling>lost']);
    const tSettling = timeOf(log, (e) => e.type === 'stateChanged' && e.to === 'settling');
    const tLost = timeOf(log, (e) => e.type === 'levelEnd');
    expect(tLost).toBeGreaterThan(tSettling);
    expect(tLost - tSettling).toBeLessThanOrEqual(TIMING.LOSE_TIMEOUT + 1e-9);
    expect(ofType(events, 'levelEnd')[0]).toMatchObject({ won: false, stars: 0 });
    expect(s.stars()).toBe(0);
    s.step();
    expect([...s.entities()].find((e) => e.kind === 'pig')!.pigPose).toBe('laugh');
  });

  it('гибель последней свиньи во время прицела: выстрел доигрывается, бонус за эту птицу теряется', () => {
    const s = readySession(rollingPigLevel());
    s.launch(-3, 0.7); // толчок: свинья цела, скатывается к обрыву
    runUntil(s, () => s.state === 'ready', 15);
    expect(s.pigsLeft).toBe(1);
    const sl = s.slingshot();
    s.beginAim();
    s.updateAim(sl.pocket);
    s.updateAim({ x: sl.anchor.x - 1.5, y: sl.anchor.y + 0.5 });
    runUntil(s, () => s.pigsLeft === 0, 10);
    expect(s.pigsLeft).toBe(0);
    runFor(s, TIMING.VICTORY_MAX + 1);
    expect(s.state).toBe('aiming'); // бонус ждёт доигрыша
    s.release();
    expect(s.state).toBe('flying');
    expect(s.canGrab(sl.anchor)).toBe(false);
    const events = runUntil(s, () => s.state === 'won', 20);
    expect(ofType(events, 'birdBonus')).toHaveLength(1); // осталась только третья птица
  });

  it('после гибели последней свиньи захват запрещён, отменённый прицел отдаёт птицу в бонус', () => {
    const s = readySession(rollingPigLevel());
    s.launch(-3, 0.7);
    runUntil(s, () => s.state === 'ready', 15);
    s.beginAim();
    runUntil(s, () => s.pigsLeft === 0, 10);
    s.cancelAim();
    expect(s.state).toBe('ready');
    const sl = s.slingshot();
    expect(s.canGrab(sl.pocket)).toBe(false);
    s.beginAim();
    s.launch(30, 1);
    expect(s.state).toBe('ready');
    const events = runUntil(s, () => s.state === 'won', 20);
    expect(ofType(events, 'birdBonus').map((e) => e.bird)).toEqual(['red', 'red']); // из кармашка и из очереди
    expect(ofType(events, 'birdBonus')[0].x).toBeCloseTo(sl.anchor.x, 1);
  });

  it('вызовы API в неправильном состоянии ничего не ломают', () => {
    const s = createSession(hutLevel(), { seed: 3 });
    const poke = () => {
      s.updateAim({ x: -5, y: 0 });
      s.release();
      s.cancelAim();
      s.activateAbility();
      s.drainEvents();
    };
    const seen = new Set<SessionState>();
    poke(); // loading
    s.launch(30, 1);
    s.beginAim();
    expect(s.state).toBe('loading');
    expect(s.birdsLeft).toBe(3);
    runUntil(s, () => s.state === 'ready', 2);
    poke();
    expect(s.state).toBe('ready');
    s.beginAim();
    s.launch(30, 1); // в прицеле launch не работает
    expect(s.state).toBe('aiming');
    s.beginAim();
    s.cancelAim();
    s.cancelAim();
    s.release();
    expect(s.state).toBe('ready');
    for (let shot = 0; shot < 10 && s.state !== 'won' && s.state !== 'lost'; shot++) {
      if (s.state === 'ready') s.launch(15 + 7 * shot, 1);
      const turnOver = () => s.state === 'won' || s.state === 'lost' || (s.state === 'ready' && s.canGrab(s.slingshot().pocket));
      for (let i = 0; i < 900 && !turnOver(); i++) {
        seen.add(s.state);
        if (i % 7 === 0) {
          s.beginAim();
          s.launch(10, 1);
          s.updateAim({ x: 0, y: 0 });
          s.release();
          s.activateAbility();
        }
        s.step();
        s.drainEvents();
      }
    }
    expect(['won', 'lost']).toContain(s.state);
    const final = s.state;
    const score = s.score;
    poke();
    s.launch(30, 1);
    runFor(s, 1);
    expect(s.state).toBe(final);
    expect(s.score).toBe(score);
    expect(seen.has('flying')).toBe(true);
  });

  it('детерминизм: одинаковый seed — те же события и позиции бит-в-бит', () => {
    const play = (seed: number) => {
      const s = createSession(hutLevel(['blues', 'bomb', 'chuck']), { seed });
      const log: GameEvent[] = [];
      const script: Array<[number, number, number]> = [[18, 1, 0.5], [20, 1, 0.9], [25, 0.9, 0.4]];
      for (const [angle, power, tap] of script) {
        runUntil(s, () => s.state === 'ready' || s.state === 'won' || s.state === 'lost', 20, log);
        if (s.state !== 'ready') break;
        s.launch(angle, power);
        const t0 = s.time;
        runUntil(s, () => s.time - t0 >= tap, 5, log);
        s.activateAbility();
      }
      runUntil(s, () => s.state === 'won' || s.state === 'lost', 30, log);
      const ents = [...s.entities()].map((e) => [e.id, e.x, e.y, e.angle, e.health, e.seed]);
      return JSON.stringify({ log, ents, score: s.score, state: s.state, time: s.time });
    };
    const a = play(7);
    expect(play(7)).toBe(a);
    const seeds = (seed: number) => [...createSession(hutLevel(), { seed }).entities()].map((e) => e.seed);
    expect(seeds(7)).not.toEqual(seeds(8));
  });

  it('пробитие не закрывает окно способности: Синяя прошивает лёд и ещё может разделиться', () => {
    const s = readySession(level({ birds: ['blues'], blocks: [{ material: 'ice', shape: 'rect', x: 6, y: 1, w: 0.5, h: 2 }], pigs: [pigOn('small', 50, 0)] }));
    s.launch(0, 1);
    const events: GameEvent[] = [];
    runUntil(s, () => ofType(events, 'blockDestroyed').length > 0, 2, events);
    expect(ofType(events, 'blockDestroyed')).toHaveLength(1);
    expect(ofType(events, 'birdImpact')).toHaveLength(0);
    expect(s.focusBird()!.birdPose).toBe('fly');
    expect(s.activateAbility()).toBe(true);
  });

  it('события impact отфильтрованы: vn ≥ 1.5, J ≥ 0.5, ≤ 6 за шаг, у блока — size', () => {
    const s = readySession(hutLevel());
    s.launch(18, 1);
    const events = runFor(s, 3);
    const impacts = ofType(events, 'impact');
    expect(impacts.length).toBeGreaterThan(3);
    for (const e of impacts) expect(e.impulse).toBeGreaterThanOrEqual(0.5);
    const withBlock = impacts.filter((e) => e.a === 'wood' || e.b === 'wood');
    expect(withBlock.length).toBeGreaterThan(0);
    for (const e of withBlock) expect(e.size).toBeGreaterThan(0);
    expect(ofType(events, 'blockDamaged').every((e) => e.stage >= 1 && e.stage <= 3)).toBe(true);
  });
});

describe('скорость шага (процессорное время потока: параллельные тесты и чужие процессы на него не влияют)', () => {
  /** Процессорное время потока, мс. ОС учитывает его квантами до 4 мс, поэтому меряем сумму за много шагов. */
  const cpuMs = () => {
    const u = process.threadCpuUsage();
    return (u.user + u.system) / 1000;
  };
  /** Среднее время шага, мс: сценарий прогоняется дважды, первый прогон — прогрев JIT. */
  const meanStep = (setup: () => () => void, steps = 240) => {
    let mean = 0;
    for (let rep = 0; rep < 2; rep++) {
      const step = setup();
      const t = cpuMs();
      for (let i = 0; i < steps; i++) step();
      mean = (cpuMs() - t) / steps;
    }
    return mean;
  };

  it('уровень со 150 телами: шаг сессии < 2 мс (в среднем за 4 с хода со взрывом Bomb в первой башне)', () => {
    const L = bigLevel();
    expect(L.blocks.length + L.pigs.length).toBeGreaterThanOrEqual(150);
    const t = meanStep(() => {
      const s = readySession(L);
      s.launch(20, 1);
      runUntil(s, () => s.focusBird()?.birdPose !== 'fly', 5); // удар о первую башню
      expect(s.activateAbility()).toBe(true);
      return () => s.step();
    });
    expect(t).toBeLessThan(2);
  });

  it('150 бодрых тел в стопках: шаг физики < 2 мс (в среднем за 240 шагов)', () => {
    const t = meanStep(() => {
      const { pw } = physicsOf(bigLevel());
      stepWorld(pw, 0.1);
      return () => {
        for (const e of destructibles(pw)) e.body.setAwake(true);
        pw.step();
      };
    });
    expect(t).toBeLessThan(2);
  });
});
