// Строки интерфейса (07 §18): подстановки, числа ru-RU, множественное число, «ё», без латиницы в русских строках.
import { describe, expect, it } from 'vitest';
import { BIRDS, LOSE_TIPS, S, STARS, STARS_ACC, TAUNTS, TAUNTS_CLOSE, TAUNTS_FAR, TAUNTS_ZERO, TIPS, fmt, pickTaunt, plural, t } from '../../src/ui/strings';

describe('strings', () => {
  it('t() подставляет {name} и не трогает неизвестные ключи', () => {
    expect(t('bootLoading', { p: 42 })).toBe('Загрузка… 42%');
    expect(t('levelsLocked', { prev: '1-2' })).toBe('Сначала пройдите уровень 1-2');
    expect(t('winBest', {})).toBe('Рекорд: {score}');
  });

  it('fmt() — разряды неразрывным пробелом, без дробей', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(999)).toBe('999');
    expect(fmt(12340)).toMatch(/^12[   ]340$/);
    expect(fmt(1234567.9)).toMatch(/^1[   ]234[   ]567$/);
  });

  it('plural() — категории one/few/many', () => {
    const cases: Array<[number, string]> = [
      [0, 'звёзд'],
      [1, 'звезда'],
      [2, 'звезды'],
      [4, 'звезды'],
      [5, 'звёзд'],
      [11, 'звёзд'],
      [15, 'звёзд'],
      [21, 'звезда'],
      [22, 'звезды'],
      [25, 'звёзд'],
    ];
    for (const [n, w] of cases) expect(plural(n, STARS)).toBe(w);
    expect(plural(1, STARS_ACC)).toBe('звезду');
    expect(plural(3, BIRDS)).toBe('птицы');
  });

  it('карточка закрытого эпизода не рвёт «эпизоде N» и «N ★» по строкам', () => {
    expect(t('gateCardStars', { n: 6, prev: 1 })).toBe('Ещё 6\u00A0★ в\u00A0эпизоде\u00A01');
    expect(t('gateCardLevel', { id: '1-10' })).toBe('Пройдите уровень\u00A01-10');
  });

  it('все строки непустые, с «ё» где нужно и с многоточием одним символом', () => {
    for (const [k, v] of Object.entries(S)) {
      expect(v.length, k).toBeGreaterThan(0);
      expect(v.includes('...'), k).toBe(false);
    }
    expect(S.hudScore).toBe('Счёт');
    expect(S.loseRetry).toBe('Ещё раз');
    for (const list of [TIPS, LOSE_TIPS, TAUNTS, TAUNTS_CLOSE, TAUNTS_FAR, TAUNTS_ZERO]) {
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) expect(s.includes('...')).toBe(false);
    }
  });

  it('pickTaunt: «Почти получилось!» — только когда осталась одна свинья и счёт не 0 (плейтест №2, Б7)', () => {
    const ALMOST = 'Почти получилось!';
    const rnds = [0, 0.2, 0.34, 0.5, 0.67, 0.99, 1];
    const all = (r: { pigsLeft?: number; score?: number }): string[] => rnds.map((x) => pickTaunt(r, () => x));
    // счёт 0 и три свиньи (скриншот плейтеста) — никогда не «почти»
    for (const s of all({ pigsLeft: 3, score: 0 })) expect(TAUNTS_ZERO).toContain(s);
    for (const s of all({ pigsLeft: 1, score: 0 })) expect(s).not.toBe(ALMOST);
    for (const s of all({ pigsLeft: 2, score: 15000 })) {
      expect(s).not.toBe(ALMOST);
      expect(TAUNTS_FAR).toContain(s);
    }
    for (const s of all({ pigsLeft: 1, score: 23450 })) expect(TAUNTS_CLOSE).toContain(s);
    expect(pickTaunt({ pigsLeft: 1, score: 1 }, () => 0)).toBe(ALMOST);
    // без данных о свиньях — без «почти»; без всего — тоже
    for (const s of [...all({ score: 5000 }), ...all({})]) expect(s).not.toBe(ALMOST);
    // мусорные значения не ломают выбор
    expect(TAUNTS_FAR).toContain(pickTaunt({ pigsLeft: Number.NaN, score: Number.NaN }, () => 0.5));
    expect(TAUNTS_FAR).toContain(pickTaunt({}, () => Number.NaN));
  });
});
