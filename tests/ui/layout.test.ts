// Масштаб интерфейса (07 §2.1–2.2) и правило «поверните устройство» — чистые функции, без DOM.
import { describe, expect, it } from 'vitest';
import { U_MAX, U_MENU_MAX, U_MIN, computeUiScale, needsRotate } from '../../src/ui/layout';

describe('computeUiScale', () => {
  it('совпадает с таблицей 07 §2.2', () => {
    expect(computeUiScale(1280, 720, false)).toBeCloseTo(1, 5);
    expect(computeUiScale(1920, 1080, false)).toBe(U_MAX); // 1.5 → потолок 1.25
    expect(computeUiScale(1366, 768, false)).toBeCloseTo(1.067, 3);
    expect(computeUiScale(1180, 820, true)).toBeCloseTo(1.06, 2); // iPad, ×1.15
    expect(computeUiScale(667, 375, true)).toBeCloseTo(0.6, 2); // iPhone SE
    expect(computeUiScale(800, 360, true)).toBeCloseTo(0.575, 3); // Android
  });

  it('зажимается снизу U_MIN и сверху заданным потолком', () => {
    expect(computeUiScale(400, 200, false)).toBe(U_MIN);
    expect(computeUiScale(3840, 2160, false)).toBe(U_MAX);
    expect(computeUiScale(2560, 1440, false, U_MENU_MAX)).toBe(2);
    expect(computeUiScale(3840, 2160, false, U_MENU_MAX)).toBe(U_MENU_MAX);
    expect(computeUiScale(1600, 900, false, U_MENU_MAX)).toBeCloseTo(1.25, 5);
  });

  it('безопасный бокс 1100×620u помещается на минимальных экранах', () => {
    for (const [w, h, coarse] of [
      [640, 360, true],
      [800, 360, true],
      [844, 390, true],
      [667, 375, true],
      [1024, 768, false],
      [1280, 720, false],
    ] as const) {
      const u = computeUiScale(w, h, coarse);
      // по ширине: 1100u ≤ W (на телефонах ×1.15 даёт до ~1.15 запаса — проверяем без него)
      const uPlain = computeUiScale(w, h, false);
      expect(1100 * uPlain).toBeLessThanOrEqual(w + 0.5);
      expect(620 * uPlain).toBeLessThanOrEqual(h + 0.5);
      expect(u).toBeGreaterThanOrEqual(U_MIN);
    }
  });
});

describe('needsRotate', () => {
  it('ландшафт — никогда', () => {
    expect(needsRotate(844, 390, true)).toBe(false);
    expect(needsRotate(1600, 900, false)).toBe(false);
  });
  it('портрет на тач-устройстве — да', () => {
    expect(needsRotate(390, 844, true)).toBe(true);
    expect(needsRotate(820, 1180, true)).toBe(true);
  });
  it('портрет на десктопе — только узкое окно', () => {
    expect(needsRotate(600, 900, false)).toBe(true);
    expect(needsRotate(900, 1000, false)).toBe(false);
  });
});

describe('fitScale / ribbonTextScale', () => {
  it('fitScale: не больше 1, по худшей стороне, безопасен к нулям', async () => {
    const { fitScale } = await import('../../src/ui/layout');
    expect(fitScale(400, 300, 200, 100)).toBe(1);
    expect(fitScale(640, 344, 380, 362)).toBeCloseTo(344 / 362, 5);
    expect(fitScale(100, 1000, 200, 100)).toBe(0.5);
    expect(fitScale(0, 100, 10, 10)).toBe(1);
    expect(fitScale(100, 100, 0, 10)).toBe(1);
  });

  it('ribbonTextScale: текст остаётся в теле ленты с отступом ≥ 8 %', async () => {
    const { RIBBON_TEXT_FRAC, ribbonTextScale } = await import('../../src/ui/layout');
    const bodyFrac = 624 / 760;
    expect((bodyFrac - RIBBON_TEXT_FRAC) / 2 / bodyFrac).toBeCloseTo(0.08, 5);
    expect(ribbonTextScale(760, 400)).toBe(1);
    const k = ribbonTextScale(380, 300); // «УРОВЕНЬ НЕ ПРОЙДЕН» на узкой ленте
    expect(300 * k).toBeLessThanOrEqual(380 * RIBBON_TEXT_FRAC + 1e-9);
    expect(ribbonTextScale(0, 100)).toBe(1);
  });
});
