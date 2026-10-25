// GameScreen без DOM: досчёт решённой победы при рестарте/выходе (finishWin) и габарит живых свиней.

import { describe, expect, it } from 'vitest';
import { finishWin, hintAbility } from '../../src/app/GameScreen';
import { createSession } from '../../src/core';
import type { GameSession } from '../../src/core/api';
import type { BirdType } from '../../src/core/types';
import { level, pigOn } from '../fixtures/levels';

/** Одна medium в 10 м: горизонтальный выстрел на полной силе пробивает её (как в тестах ядра). */
const oneShot = () => level({ birds: ['red', 'red', 'red'], pigs: [pigOn('medium', 10, 0)] });

function ready(seed = 3): GameSession {
  const s = createSession(oneShot(), { seed });
  for (let i = 0; i < 300 && s.state !== 'ready'; i++) s.step();
  s.drainEvents();
  return s;
}

describe('finishWin: R / выход до окна итогов не отбирает решённую победу', () => {
  it('свиней нет, идёт полёт/покой: сессия досчитывается до levelEnd — тот же итог, что и без вмешательства', () => {
    const a = ready();
    const b = ready();
    a.launch(0, 1);
    b.launch(0, 1);
    let n = 0;
    while (a.pigsLeft > 0 && n++ < 600) {
      a.step();
      b.step();
    }
    expect(a.pigsLeft).toBe(0);
    expect(['flying', 'settling']).toContain(a.state);
    a.drainEvents();
    const r = finishWin(a);
    // без вмешательства: шагаем до levelEnd
    let end: { score: number; stars: number } | null = null;
    for (let i = 0; i < 3600 && !end; i++) {
      b.step();
      for (const e of b.drainEvents()) if (e.type === 'levelEnd' && e.won) end = { score: e.score, stars: e.stars };
    }
    expect(end).not.toBeNull();
    expect(r).toEqual(end);
    expect(a.state).toBe('won');
    // бонус за две неиспользованные птицы входит в итог
    expect(r!.score).toBeGreaterThanOrEqual(2 * 10000);
  });

  it('исход не решён (свиньи живы) или уровень уже закончен — null, сессия не шагает', () => {
    const s = ready();
    const t = s.time;
    expect(finishWin(s)).toBeNull();
    expect(s.time).toBe(t);
    const fake = { pigsLeft: 0, state: 'won' as const, step: () => undefined, drainEvents: () => [] };
    expect(finishWin(fake)).toBeNull();
  });

  it('levelEnd уже в очереди событий — берётся из неё; не пришёл за maxSteps — null', () => {
    let steps = 0;
    const queued = {
      pigsLeft: 0,
      state: 'bonus' as const,
      step: () => void steps++,
      drainEvents: () => [{ type: 'levelEnd' as const, won: true, score: 31000, stars: 3 }],
    };
    expect(finishWin(queued)).toEqual({ score: 31000, stars: 3 });
    expect(steps).toBe(0);
    const never = { pigsLeft: 0, state: 'settling' as const, step: () => void steps++, drainEvents: () => [] };
    expect(finishWin(never, 50)).toBeNull();
    expect(steps).toBe(50);
  });
});

describe('hintAbility: подсказка уровня объясняет способность — тост в первом полёте не нужен', () => {
  it('подсказки вводных уровней способностей узнаются (Синие, Чак, Бомб, Матильда, Хэл, Сильвер)', () => {
    const cases: Array<[string, BirdType[], BirdType]> = [
      ['Коснитесь экрана в полёте — птица разделится на три', ['blues', 'red'], 'blues'],
      ['Коснитесь экрана в полёте — Чак рванёт вперёд и прошьёт дерево', ['chuck', 'red'], 'chuck'],
      ['Коснитесь экрана — Бомб взорвётся. Или подождите: он взорвётся сам', ['bomb'], 'bomb'],
      ['Коснитесь экрана над целью — Матильда сбросит яйцо', ['red', 'matilda'], 'matilda'],
      ['Перелетите постройки и коснитесь экрана у самой земли — Хэл развернётся и ударит сзади', ['hal'], 'hal'],
      ['Коснитесь экрана над целью — Сильвер сделает петлю и ударит сверху', ['silver', 'red'], 'silver'],
    ];
    for (const [hint, birds, want] of cases) expect(hintAbility({ hint, birds }), hint).toBe(want);
  });

  it('кампания: узнанная способность — у птицы этого уровня, а подсказка — про касание', async () => {
    const { ALL_LEVELS } = await import('../../src/levels');
    for (const l of ALL_LEVELS) {
      const b = hintAbility(l);
      if (b === null) continue;
      expect(l.birds, l.id).toContain(b);
      expect(l.hint ?? '', l.id).toMatch(/Коснитесь/i);
    }
  });

  it('подсказка не про касание или птицы такой нет — null', () => {
    expect(hintAbility({ hint: 'Лёд разбивается от одного удара', birds: ['blues'] })).toBeNull();
    expect(hintAbility({ hint: 'Коснитесь экрана — Бомб взорвётся', birds: ['red'] })).toBeNull();
    expect(hintAbility({ birds: ['bomb'] })).toBeNull();
  });
});
