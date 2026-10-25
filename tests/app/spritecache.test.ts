// Кэш спрайтов: ступени ppu √2, LRU по байтам, бюджет генерации за кадр, прогрев, каталог ключей уровня.

import { describe, expect, it } from 'vitest';
import { SpriteCache, blockVariant, levelWarmList, ppuBucket } from '../../src/render/SpriteCache';
import type { Sprite } from '../../src/render/sprites/api';
import { EPISODES } from '../../src/levels';

/** Поддельный спрайт: холст w×h (без DOM). */
function fake(w: number, h = w, ppu = 1): Sprite {
  return { canvas: { width: w, height: h } as unknown as HTMLCanvasElement, ox: w / 2, oy: h / 2, ppu };
}

/** Генератор, который «работает» ms миллисекунд. */
function slowMake(ms: number, size = 10): (ppu: number) => Sprite {
  return (ppu) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      /* занят */
    }
    return fake(size, size, ppu);
  };
}

describe('ppuBucket', () => {
  it('округляет вверх до ступени √2', () => {
    expect(ppuBucket(64)).toBeCloseTo(64);
    expect(ppuBucket(65)).toBeCloseTo(64 * Math.SQRT2);
    expect(ppuBucket(90)).toBeCloseTo(64 * Math.SQRT2);
    expect(ppuBucket(91)).toBeCloseTo(128);
    for (const p of [7, 13.3, 50, 99.9, 120, 333]) {
      const b = ppuBucket(p);
      expect(b).toBeGreaterThanOrEqual(p - 1e-9);
      expect(b / p).toBeLessThanOrEqual(Math.SQRT2 + 1e-9);
    }
  });
  it('мусор на входе — 1', () => {
    expect(ppuBucket(0)).toBe(1);
    expect(ppuBucket(NaN)).toBe(1);
    expect(ppuBucket(-5)).toBe(1);
  });
});

describe('SpriteCache', () => {
  it('один спрайт на ключ и ступень; соседний ppu той же ступени — попадание', () => {
    const c = new SpriteCache();
    let made = 0;
    const make = (ppu: number): Sprite => (made++, fake(8, 8, ppu));
    const a = c.get('k', 100, make);
    const b = c.get('k', 110, make);
    expect(a).toBe(b);
    expect(made).toBe(1);
    expect(a!.ppu).toBeCloseTo(128);
    c.get('k', 150, make);
    expect(made).toBe(2);
  });

  it('LRU по байтам: старые вытесняются, недавно использованные остаются', () => {
    const c = new SpriteCache({ budgetBytes: 3 * 100 * 100 * 4 });
    const mk = (ppu: number): Sprite => fake(100, 100, ppu);
    c.get('a', 64, mk);
    c.get('b', 64, mk);
    c.get('c', 64, mk);
    c.get('a', 64, mk); // a — свежий
    c.get('d', 64, mk); // вытеснит самый старый — b
    expect(c.has('a', 64)).toBe(true);
    expect(c.has('b', 64)).toBe(false);
    expect(c.has('c', 64)).toBe(true);
    expect(c.has('d', 64)).toBe(true);
    expect(c.usedBytes).toBeLessThanOrEqual(c.budgetBytes);
  });

  it('бюджет кадра исчерпан — отдаёт готовую соседнюю ступень, а нужную строит в следующем кадре', () => {
    const c = new SpriteCache({ frameBudgetMs: 2 });
    c.beginFrame();
    const small = c.get('k', 64, slowMake(0))!;
    c.get('x', 64, slowMake(3)); // съели бюджет
    const sub = c.get('k', 128, slowMake(0))!;
    expect(sub).toBe(small);
    expect(c.stats.substituted).toBe(1);
    c.beginFrame();
    const exact = c.get('k', 128, slowMake(0))!;
    expect(exact.ppu).toBeCloseTo(128);
  });

  it("режим 'try' без готовых ступеней при исчерпанном бюджете — null; 'must' — строит", () => {
    const c = new SpriteCache({ frameBudgetMs: 1 });
    c.beginFrame();
    c.get('x', 64, slowMake(2));
    expect(c.get('y', 64, slowMake(0), 'try')).toBeNull();
    expect(c.get('y', 64, slowMake(0), 'must')).not.toBeNull();
  });

  it('прогрев строит всё и не учитывается в бюджете кадра', async () => {
    const c = new SpriteCache({ frameBudgetMs: 1 });
    c.beginFrame();
    let yields = 0;
    const items = Array.from({ length: 6 }, (_, i) => ({ base: `w${i}`, ppu: 80, make: slowMake(1) }));
    await c.prewarm(items, { sliceMs: 2, yieldFn: async () => void yields++ });
    expect(c.size).toBe(6);
    expect(yields).toBeGreaterThan(0);
    expect(c.frameBudgetLeft).toBeGreaterThan(0);
  });
});

describe('levelWarmList', () => {
  it('для каждого уровня кампании: персонажи во всех позах, блоки, рогатка; ключи уникальны', () => {
    for (const ep of EPISODES) {
      for (const level of ep.levels) {
        const list = levelWarmList(level, [60, 61]); // одна ступень
        const keys = list.map((i) => `${i.base}@${ppuBucket(i.ppu)}`);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.some((k) => k.startsWith('sling:back'))).toBe(true);
        for (const b of new Set(level.birds)) expect(keys.some((k) => k.startsWith(`bird:${b}:idle`))).toBe(true);
        for (const p of new Set(level.pigs.map((q) => q.type))) expect(keys.some((k) => k.startsWith(`pig:${p}:blink`))).toBe(true);
        if (level.blocks.length) expect(keys.some((k) => k.startsWith('blk:'))).toBe(true);
      }
    }
  });
  it('вариант узора блока — 0..3', () => {
    for (const s of [0, 0.24, 0.25, 0.5, 0.99, 1]) expect(blockVariant(s)).toBeGreaterThanOrEqual(0);
    expect(blockVariant(0.99)).toBe(3);
    expect(blockVariant(NaN)).toBe(0);
  });
});
