// Окно победы (ревью): звёзды садятся по ходу подсчёта — когда бегущее число пересекает порог, не раньше подсчёта.
import { describe, expect, it } from 'vitest';
import { WIN_T, planWin, rollCross, rollValue } from '../../src/ui/winTiming';

const T = WIN_T.full;
/** Число на экране в момент t (с). */
const shown = (score: number, t: number): number => rollValue(score, (t - T.rollAt) / T.roll);

describe('rollValue / rollCross', () => {
  it('от 0 до итога; обратная функция находит момент пересечения', () => {
    expect(rollValue(35285, 0)).toBe(0);
    expect(rollValue(35285, 1)).toBe(35285);
    for (const th of [1, 22000, 33000, 35285]) {
      const k = rollCross(35285, th);
      expect(rollValue(35285, k)).toBeGreaterThanOrEqual(th);
      if (k > 0.01) expect(rollValue(35285, k - 0.01)).toBeLessThan(th);
    }
    expect(rollCross(35285, 0)).toBe(0);
    expect(rollCross(35285, 99999)).toBe(1);
    expect(rollCross(0, 100)).toBe(0);
  });
});

describe('planWin', () => {
  it('1-1, 3 звезды (35 285 при порогах 0 / 22 000 / 33 000): каждая звезда — когда число уже за порогом', () => {
    const th = { one: 0, two: 22000, three: 33000 };
    const p = planWin(35285, 3, th, T);
    expect(p.land.length).toBe(3);
    expect(p.empty).toEqual([]);
    // ни одна звезда не садится до начала подсчёта, и число в момент касания не меньше порога
    expect(p.land[0]!).toBeGreaterThan(p.rollStart);
    expect(shown(35285, p.land[1]!)).toBeGreaterThanOrEqual(th.two);
    expect(shown(35285, p.land[2]!)).toBeGreaterThanOrEqual(th.three);
    // но и не намного позже: звезда «выскакивает» на пересечении (≤ 0.05 с после него)
    expect(shown(35285, p.land[1]! - 0.05)).toBeLessThan(th.two);
    expect(shown(35285, p.land[2]! - 0.05)).toBeLessThan(th.three);
    // по порядку, с промежутком; кнопки — после последней звезды; бейдж — когда всё досчитано
    for (let i = 1; i < 3; i++) expect(p.land[i]! - p.land[i - 1]!).toBeGreaterThanOrEqual(T.starMinGap - 1e-9);
    expect(p.enableAt).toBeCloseTo(p.land[2]! + T.enableAfterStar, 9);
    expect(p.end).toBeGreaterThanOrEqual(p.rollEnd);
    expect(p.end).toBeLessThan(2.5);
  });

  it('близкие пороги не сливают «бумы»: звезда ждёт, но число к её касанию всё равно за порогом', () => {
    const th = { one: 0, two: 30000, three: 45000 };
    const p = planWin(61230, 3, th, T);
    for (let i = 1; i < 3; i++) expect(p.land[i]! - p.land[i - 1]!).toBeGreaterThanOrEqual(T.starMinGap - 1e-9);
    expect(shown(61230, p.land[1]!)).toBeGreaterThanOrEqual(th.two);
    expect(shown(61230, p.land[2]!)).toBeGreaterThanOrEqual(th.three);
  });

  it('2 звезды: третий слот «вздрагивает» после остановки счёта; кнопки — после второй звезды', () => {
    const p = planWin(30000, 2, { one: 0, two: 22000, three: 33000 }, T);
    expect(p.land.length).toBe(2);
    expect(p.empty.length).toBe(1);
    expect(p.empty[0]!).toBeGreaterThanOrEqual(p.rollEnd);
    expect(p.enableAt).toBeCloseTo(p.land[1]! + T.enableAfterStar, 9);
  });

  it('счёт ровно на пороге — звезда в конце подсчёта; порогов нет или данные разошлись — ровный шаг', () => {
    const exact = planWin(33000, 3, { one: 0, two: 22000, three: 33000 }, T);
    expect(exact.land[2]!).toBeCloseTo(exact.rollEnd, 6);
    const none = planWin(40000, 3, undefined, T);
    expect(none.land.length).toBe(3);
    expect(none.land.every((t, i) => i === 0 || t > none.land[i - 1]!)).toBe(true);
    expect(none.land[2]!).toBeLessThanOrEqual(none.rollEnd + 2 * T.starMinGap);
    const odd = planWin(1000, 3, { one: 0, two: 22000, three: 33000 }, T); // звёзд больше, чем по порогам
    expect(odd.land.length).toBe(3);
    const reduced = planWin(35285, 3, { one: 0, two: 22000, three: 33000 }, WIN_T.reduced);
    expect(reduced.end).toBeLessThan(1.5);
  });
});
