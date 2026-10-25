// Юнит-тесты кэша спрайтов эффектов (Node): публичный API прогрева (bakedSteps, defCount, bakeStep, fillSteps)
// на поддельном холсте — рисование не проверяется, только учёт ступеней размера.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FxSprites, MIN_SIZE_STEP, puffSprite, sizeStep, SPR_FIRE, SPR_SMOKE, SPR_SMOKE_DARK, SPR_SMOKE_LIGHT, SPR_STAR, stepPx } from './sprites';

/** Холст-заглушка: любой метод контекста — пустая функция, градиенты принимают стопы. */
function fakeCanvas(): unknown {
  const grad = { addColorStop() {} };
  const ctx = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
        return () => undefined;
      },
      set() {
        return true;
      },
    },
  );
  return { width: 300, height: 150, getContext: () => ctx };
}

beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => fakeCanvas() });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ступени размера', () => {
  it('sizeStep/stepPx: P ступени не меньше нужного размера и не больше √2 раза', () => {
    for (const px of [4.5, 7, 13, 31.9, 64, 100, 250]) {
      const P = stepPx(sizeStep(px));
      expect(P).toBeGreaterThanOrEqual(px);
      expect(P / px).toBeLessThanOrEqual(Math.SQRT2 + 0.05);
    }
    expect(sizeStep(1)).toBe(MIN_SIZE_STEP);
    expect(stepPx(MIN_SIZE_STEP)).toBe(4);
  });
});

describe('FxSprites: API прогрева', () => {
  it('defCount — число описанных спрайтов, растёт с новым цветом облачка', () => {
    const s = new FxSprites();
    const n0 = s.defCount;
    expect(n0).toBeGreaterThan(SPR_SMOKE_LIGHT);
    puffSprite('#123456');
    expect(s.defCount).toBe(n0 + 1);
    puffSprite('#123456'); // тот же цвет — тот же спрайт
    expect(s.defCount).toBe(n0 + 1);
  });

  it('bakedSteps: id → запечённые ступени по возрастанию; get и bakeStep попадают в одну ступень', () => {
    const s = new FxSprites();
    expect(s.bakedSteps().size).toBe(0);
    s.get(SPR_STAR, 30);
    s.get(SPR_STAR, 10);
    s.get(SPR_STAR, 11); // та же ступень, что у 10 px (P = 12)
    s.bakeStep(SPR_FIRE, 9);
    const m = s.bakedSteps();
    expect(m.get(SPR_STAR)).toEqual([...new Set([sizeStep(10), sizeStep(11), sizeStep(30)])].sort((a, b) => a - b));
    expect(m.get(SPR_FIRE)).toEqual([9]);
    expect(s.size).toBe(m.get(SPR_STAR)!.length + 1);
    // размер чуть меньше P ступени попадает в неё же (P округлён вверх: stepPx(9) = 23 → уже ступень 10)
    expect(s.get(SPR_FIRE, 2 ** ((9 - 0.5) / 2))).toBe(s.bakeStep(SPR_FIRE, 9));
    expect(s.hasStep(SPR_FIRE, 9)).toBe(true);
    expect(s.hasStep(SPR_FIRE, 10)).toBe(false);
    // карта — копия: правка не трогает кэш
    m.get(SPR_FIRE)!.push(99);
    expect(s.bakedSteps().get(SPR_FIRE)).toEqual([9]);
  });

  it('bakeStep ограничивает ступень снизу (4 px) и сверху (maxP спрайта)', () => {
    const s = new FxSprites();
    expect(s.bakeStep(SPR_STAR, 0).P).toBe(4);
    const top = s.maxStep(SPR_STAR);
    expect(top).toBe(14); // maxP 128 → 2·log2(128)
    expect(s.bakeStep(SPR_STAR, 40).P).toBe(128);
    expect(s.bakedSteps().get(SPR_STAR)).toEqual([MIN_SIZE_STEP, top]);
    expect(s.maxStep(1e6)).toBe(-1);
  });

  it('несуществующий id — исключение (на нём останавливался перебор в fxWarm)', () => {
    const s = new FxSprites();
    expect(() => s.get(s.defCount + 5, 10)).toThrow();
    expect(() => s.bakeStep(-1, 8)).toThrow();
  });

  it('прежний формат приватного кэша сохранён: ключ id · 32 + ci (fxWarm читает его до перехода на bakedSteps)', () => {
    const s = new FxSprites();
    s.bakeStep(SPR_SMOKE, 12);
    const cache = (s as unknown as { cache: Map<number, unknown> }).cache;
    expect(cache).toBeInstanceOf(Map);
    expect([...cache.keys()]).toEqual([SPR_SMOKE * 32 + 12]);
  });

  it('fillSteps: встреченным — все ступени до наибольшей + above, остальным — до smallMax; повтор ничего не печёт', () => {
    const s = new FxSprites();
    s.bakeStep(SPR_SMOKE_DARK, 13);
    s.bakeStep(SPR_STAR, 14); // уже верхняя ступень спрайта (maxP 128)
    const baked = s.fillSteps({ above: 2, smallMax: 8 });
    const m = s.bakedSteps();
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    expect(m.get(SPR_SMOKE_DARK)).toEqual(range(MIN_SIZE_STEP, 15));
    expect(m.get(SPR_STAR)).toEqual(range(MIN_SIZE_STEP, 14)); // не выше maxP
    expect(m.get(SPR_FIRE)).toEqual(range(MIN_SIZE_STEP, 8));
    // все описанные спрайты покрыты мелкими ступенями
    for (let id = 0; id < s.defCount; id++) expect(m.get(id)?.[0]).toBe(MIN_SIZE_STEP);
    expect(baked).toBe(s.size - 2);
    expect(s.fillSteps({ above: 2, smallMax: 8 })).toBe(0);
    // новая отрисовка крупнее — следующий прогрев дотягивает только её
    s.get(SPR_FIRE, 2 ** ((10 - 0.5) / 2));
    expect(s.fillSteps({ above: 2, smallMax: 8 })).toBe(3); // ступени 9, 11, 12 (10 запекла сама отрисовка)
  });

  it('clear() сбрасывает кэш и страницы', () => {
    const s = new FxSprites();
    s.get(SPR_STAR, 20);
    expect(s.pageCount).toBe(1);
    s.clear();
    expect(s.size).toBe(0);
    expect(s.pageCount).toBe(0);
    expect(s.bakedSteps().size).toBe(0);
  });
});
