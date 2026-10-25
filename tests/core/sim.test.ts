// Headless-проверка уровней: устойчивость, прогон выстрелов, бот-эксперт, пороги звёзд (06 §7–§8).

import { describe, expect, it } from 'vitest';
import { checkStability, levelPoints, simulateShots, solveLevel, solveLevelAsync, suggestStars } from '../../src/core/sim';
import type { LevelDef } from '../../src/core/types';
import { flatGround, frame, hutLevel, level, pigOn, rect } from '../fixtures/levels';

/** Простой уровень: одна деревянная рама, свинья внутри, две птицы. */
const simpleLevel = (): LevelDef => level({ id: 'simple', birds: ['red', 'red'], blocks: frame(22), pigs: [pigOn('small', 22, 0)] });

describe('checkStability', () => {
  it('устойчивая башня проходит: никто не погиб, смещения миллиметровые, всё уснуло', () => {
    const r = checkStability(hutLevel());
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.pigsKilled).toEqual([]);
    expect(r.destroyed).toEqual([]);
    expect(r.maxBlockShift!.shift).toBeLessThan(0.02);
    expect(r.maxBlockRotation!.rotateDeg).toBeLessThan(1);
    expect(r.maxPigShift!.shift).toBeLessThan(0.02);
    expect(r.settleTime).not.toBeNull();
    expect(r.sleepTime).not.toBeNull();
  });

  it('висящий блок не проходит: в отчёте его id, индекс и смещение', () => {
    const L = hutLevel();
    L.blocks.push({ ...rect('wood', 32, 1.5, 1, 1), id: 'висит' }); // низ на 1 м над землёй
    const r = checkStability(L);
    expect(r.pass).toBe(false);
    expect(r.maxBlockShift).toMatchObject({ kind: 'block', index: L.blocks.length - 1, name: 'висит' });
    expect(r.maxBlockShift!.shift).toBeGreaterThan(0.9);
    expect(r.offenders.map((o) => o.name)).toEqual(['висит']);
    expect(r.failures.join('\n')).toContain('висит');
    expect(r.presettleShift!.name).toBe('висит'); // упал ещё при усадке (T0)
  });

  it('падающая колонна ловится по повороту', () => {
    const L = hutLevel();
    L.blocks.push({ ...rect('wood', 34, 1.2, 0.5, 2), angle: 0.4 }); // наклон 23° больше критического 14° (w/h = 0.25)
    const r = checkStability(L);
    expect(r.pass).toBe(false);
    expect(r.maxBlockRotation).toMatchObject({ index: L.blocks.length - 1 });
    expect(r.maxBlockRotation!.rotateDeg).toBeGreaterThan(45);
  });

  it('гибель свиньи после усадки (урон включён): каменный шар скатывается со склона', () => {
    // склон 25°: шар ⌀2 за 1.5 с усадки проходит треть пути, после пробуждения разгоняется и сбивает свинью
    const L = level({
      terrain: [flatGround(), { kind: 'rock', points: [[10, 0], [30, 0], [10, 9.3]] }],
      blocks: [{ material: 'stone', shape: 'circle', x: 11.329, y: 9.785, w: 2, h: 2 }],
      pigs: [pigOn('small', 34, 0)],
    });
    const r = checkStability(L);
    expect(r.pass).toBe(false);
    expect(r.pigsKilled).toHaveLength(1);
    expect(r.pigsKilled[0]).toMatchObject({ kind: 'pig', index: 0, cause: 'impact' });
    expect(r.pigsKilled[0].t).toBeGreaterThan(0);
  });
});

describe('simulateShots', () => {
  const shots = [{ angleDeg: 30, power: 1 }, { angleDeg: 20, power: 1 }, { angleDeg: 40, power: 0.9 }];

  it('детерминирован: тот же seed — тот же итог и журнал', () => {
    const a = simulateShots(hutLevel(), shots, 7);
    const b = simulateShots(hutLevel(), shots, 7);
    expect(b).toEqual(a);
  });

  it('журнал по выстрелам сходится с итогом; при победе лишние выстрелы пропускаются, бонус птиц в счёте', () => {
    const r = simulateShots(hutLevel(), shots);
    expect(r.won).toBe(true);
    expect(r.state).toBe('won');
    expect(r.pigsLeft).toBe(0);
    expect(r.shots.length + r.skipped).toBe(shots.length);
    expect(r.shots.reduce((s, x) => s + x.points, 0)).toBe(r.score);
    expect(r.shots.reduce((s, x) => s + x.pigsKilled, 0)).toBe(2);
    expect(r.score).toBeGreaterThanOrEqual(10_000 * r.birdsLeft + 2 * 5000);
    expect(r.stars).toBeGreaterThan(0);
    for (const x of r.shots) expect(x.impactAt).toBeGreaterThan(0);
  });

  it('тап способности по времени от запуска; без выстрелов уровень остаётся в ready', () => {
    const r = simulateShots(hutLevel(['blues', 'red']), [{ angleDeg: 30, power: 1, abilityAt: 0.5 }]);
    expect(r.shots[0]).toMatchObject({ bird: 'blues', abilityUsed: true });
    const idle = simulateShots(hutLevel(), []);
    expect(idle).toMatchObject({ state: 'ready', score: 0, pigsLeft: 2, birdsLeft: 3, won: false, stars: 0 });
  });

  it('ход по wait: ready стреляет не позже calm', () => {
    const calm = simulateShots(hutLevel(), [shots[0]], 1, { wait: 'calm' });
    const ready = simulateShots(hutLevel(), [shots[0]], 1, { wait: 'ready' });
    expect(ready.shots[0].duration).toBeLessThanOrEqual(calm.shots[0].duration);
  });

  it('последняя птица без победы — lost', () => {
    const r = simulateShots(level({ birds: ['red'], pigs: [pigOn('small', 30, 0)] }), [{ angleDeg: 80, power: 0.3 }]);
    expect(r).toMatchObject({ state: 'lost', won: false, stars: 0, birdsLeft: 0, pigsLeft: 1 });
  });
});

describe('solveLevel', () => {
  it('простой уровень решается быстро, найденная серия повторяется через simulateShots', () => {
    const L = simpleLevel();
    const r = solveLevel(L, { grid: 'fast', maxMs: 60_000 });
    expect(r.solved).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(r.birdsUsed).toBe(1);
    expect(r.shots).toHaveLength(1);
    expect(r.pigsLeft).toBe(0);
    expect(r.score).toBeGreaterThanOrEqual(5000 + 10_000);
    expect(r.ms).toBeLessThan(30_000);
    const replay = simulateShots(L, r.shots, r.seed, { wait: r.wait });
    expect(replay).toMatchObject({ won: true, score: r.score, stars: r.stars });
  }, 60_000);

  it('внешний оценщик пакетов даёт тот же итог, что расчёт в процессе (луч 2, две птицы)', async () => {
    const L = level({ birds: ['red', 'red'], blocks: [...frame(20), ...frame(30)], pigs: [pigOn('small', 20, 0), pigOn('small', 30, 0)] });
    const opts = { grid: 'fast', angles: [12, 20, 28, 36], refine: 1, adaptive: false } as const;
    const sync = solveLevel(L, opts);
    let batches = 0;
    const async = await solveLevelAsync(L, opts, async (batch, ctx) => {
      batches++;
      return batch.map((shots) => simulateShots(ctx.level, shots, ctx.seed, { wait: ctx.wait }));
    });
    expect(batches).toBeGreaterThan(2);
    const { ms: _a, ...a } = sync;
    const { ms: _b, ...b } = async;
    expect(b).toEqual(a);
    expect(sync.reduced).toBe(false);
  }, 60_000);

  it('лимит времени: возвращает лучшее найденное и флаг timedOut', () => {
    const r = solveLevel(simpleLevel(), { maxMs: 1 });
    expect(r.timedOut).toBe(true);
    expect(r.ms).toBeLessThan(5_000);
  });

  it('недосягаемая свинья — не решён, птицы потрачены', () => {
    const L = level({ birds: ['red'], bounds: { minX: -12, maxX: 120, maxY: 30 }, pigs: [pigOn('small', 100, 0)] });
    const r = solveLevel(L, { grid: 'fast', angles: [20, 45], refine: 0 });
    expect(r).toMatchObject({ solved: false, pigsLeft: 1, birdsUsed: 1, evaluations: 2 * 3 });
  });
});

describe('suggestStars', () => {
  // hutLevel: 2 small (по 5000 + 50) и башня из двух рам: 4 колонны 0.5×2 (по 700) и 2 балки 4×0.5 (по 900)
  it('очки уровня по каталогу 00 §1.6', () => {
    expect(levelPoints(hutLevel())).toEqual({ pigs: 10_100, blocks: 4600 });
  });

  it('формула 06 §8.2 с округлением до 1000 и ограничением счётом эксперта', () => {
    const L = hutLevel();
    const free = suggestStars(L, { solved: true, score: 60_000, birdsUsed: 1 });
    // three = r1k(10100 + 0.45·4600 + 20000) = 32000; two = max(min(r1k(10100 + 0.3·4600 + 10000), 27000), r1k(12100)) = 21000
    expect(free).toMatchObject({ stars: { one: 0, two: 21_000, three: 32_000 }, nMin: 1, capped: false });

    const capped = suggestStars(L, { solved: true, score: 30_500, birdsUsed: 1 });
    expect(capped).toMatchObject({ stars: { one: 0, two: 21_000, three: 30_000 }, capped: true });
    expect(capped.stars.three).toBeLessThanOrEqual(30_500);
  });

  it('без решения — только формула и предупреждение; пороги не меняются местами', () => {
    const r = suggestStars(hutLevel(), null);
    expect(r.nMin).toBe(3);
    expect(r.warnings.join('\n')).toContain('эксперт не прошёл');
    expect(r.stars.two).toBeLessThanOrEqual(r.stars.three);
    expect(r.warnings.join('\n')).toContain('узкий диапазон');
  });

  it('meta.nMin главнее числа птиц эксперта; перерасход птиц — предупреждение', () => {
    const L = { ...hutLevel(), meta: { nMin: 1 } };
    const r = suggestStars(L, { solved: true, score: 40_000, birdsUsed: 2 });
    expect(r.nMin).toBe(1);
    expect(r.warnings.join('\n')).toContain('замысел не сходится');
  });
});
