// Строки интерфейса (07 §18): подстановки, числа ru-RU, множественное число, «ё», без латиницы в русских строках.
import { describe, expect, it } from 'vitest';
import { BIRDS, LOSE_TIPS, S, STARS, STARS_ACC, TAUNTS, TIPS, fmt, plural, t } from '../../src/ui/strings';

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
    for (const list of [TIPS, LOSE_TIPS, TAUNTS]) {
      expect(list.length).toBeGreaterThan(0);
      for (const s of list) expect(s.includes('...')).toBe(false);
    }
  });
});
