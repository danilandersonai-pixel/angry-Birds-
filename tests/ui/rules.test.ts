// Причина блокировки эпизода (01 §12.2) — одна функция для карточки, тоста, подвала уровней и экрана победы.
import { describe, expect, it } from 'vitest';
import type { EpisodeDef, LevelDef } from '../../src/core/types';
import { ProgressStore } from '../../src/storage/progress';
import { episodeGate, gateText } from '../../src/ui/rules';

const lv = (id: string): LevelDef =>
  ({ id, name: id, theme: 'meadow', birds: ['red'], slingshot: { x: 0, y: 0 }, bounds: { minX: 0, maxX: 1, maxY: 1 }, terrain: [], blocks: [], pigs: [], stars: { one: 0, two: 1, three: 2 } }) as LevelDef;
const ep = (id: string, name: string): EpisodeDef => ({ id, name, theme: 'meadow', levels: Array.from({ length: 10 }, (_, i) => lv(`${id}-${i + 1}`)) });
const EPS = [ep('1', 'Зелёные холмы'), ep('2', 'Пляжный закат'), ep('3', 'Снежные вершины')];
const ORDER = EPS.flatMap((e) => e.levels.map((l) => l.id));
const store = (): ProgressStore => new ProgressStore(null);

describe('episodeGate', () => {
  it('первый эпизод открыт всегда', () => {
    const g = episodeGate(store(), EPS, ORDER, 0);
    expect(g.open).toBe(true);
    expect(g.reason).toBe('none');
    expect(gateText(g, 'card', EPS[0]!.name)).toBe('');
  });

  it('звёзд хватает (18/30), но 1-10 не пройден — причина «уровень», а не «нужно 15 звёзд»', () => {
    const p = store();
    [3, 3, 2, 3, 1, 2, 3, 1].forEach((s, i) => p.saveResult(`1-${i + 1}`, 1000, s));
    const g = episodeGate(p, EPS, ORDER, 1);
    expect(g.open).toBe(false);
    expect(g.reason).toBe('level');
    expect(g.missingLevel).toBe('1-10');
    expect(g.missingStars).toBe(0);
    expect(gateText(g, 'card', 'Пляжный закат')).toBe('Пройдите уровень 1-10');
    expect(gateText(g, 'full', 'Пляжный закат')).toBe('Пройдите уровень 1-10, чтобы открыть «Пляжный закат»');
    expect(gateText(g, 'footer', 'Пляжный закат')).toBe('Пройдите уровень 1-10, чтобы открыть следующий эпизод');
  });

  it('все уровни пройдены, но звёзд мало — причина «звёзды» с точным остатком', () => {
    const p = store();
    for (let i = 1; i <= 10; i++) p.saveResult(`1-${i}`, 1000, 1);
    const g = episodeGate(p, EPS, ORDER, 1);
    expect(g.reason).toBe('stars');
    expect(g.missingStars).toBe(5);
    expect(g.missingLevel).toBeNull();
    expect(gateText(g, 'card', 'Пляжный закат')).toBe('Ещё 5 ★ в эпизоде 1');
    expect(gateText(g, 'full', 'Пляжный закат')).toBe('Соберите ещё 5 звёзд в эпизоде «Зелёные холмы»');
    expect(gateText(g, 'win', 'Пляжный закат')).toBe('Соберите ещё 5 звёзд, чтобы открыть «Пляжный закат»');
    expect(gateText(g, 'footer', 'Пляжный закат')).toBe('До следующего эпизода: ещё 5 ★');
  });

  it('не хватает и того и другого', () => {
    const p = store();
    p.saveResult('1-1', 1000, 3);
    const g = episodeGate(p, EPS, ORDER, 1);
    expect(g.reason).toBe('both');
    expect(g.missingStars).toBe(12);
    expect(g.missingLevel).toBe('1-10');
    expect(gateText(g, 'full', 'Пляжный закат')).toBe('Пройдите уровень 1-10 и соберите ещё 12 звёзд в эпизоде «Зелёные холмы»');
    // карточка: коротко, обе причины
    expect(gateText(g, 'card', 'Пляжный закат')).toBe('Пройдите 1-10 · ещё\u00A012\u00A0★');
  });

  it('открытый эпизод: на победе сообщения нет, в подвале — «Открыт эпизод»', () => {
    const p = store();
    for (let i = 1; i <= 10; i++) p.saveResult(`1-${i}`, 1000, 2);
    const g = episodeGate(p, EPS, ORDER, 1);
    expect(g.open).toBe(true);
    expect(gateText(g, 'win', 'Пляжный закат')).toBe('');
    expect(gateText(g, 'footer', 'Пляжный закат')).toBe('Открыт эпизод «Пляжный закат»');
  });

  it('согласовано с ProgressStore.isUnlocked при любом наборе звёзд', () => {
    for (let seed = 0; seed < 50; seed++) {
      const p = store();
      let x = seed * 7919 + 1;
      for (let i = 1; i <= 10; i++) {
        x = (x * 1103515245 + 12345) % 2147483648;
        const s = x % 4;
        if (s > 0) p.saveResult(`1-${i}`, 1000, s);
      }
      const g = episodeGate(p, EPS, ORDER, 1);
      expect(g.open).toBe(p.isUnlocked('2-1', ORDER));
      if (!g.open) expect(g.reason).not.toBe('none');
    }
  });
});
