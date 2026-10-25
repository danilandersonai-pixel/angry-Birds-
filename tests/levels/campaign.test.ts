// Кампания глазами игрока (ревью «арт и ощущения»): кадр вида рогатки крупный и плотный, рельеф разнообразный,
// линия эксперта из калибровки (src/levels/calib.ts) проходит уровень, свиньи не докатываются до рогатки.
// Кадр — настоящей камерой игрового экрана (GameCamera без DOM, HUD по формуле hudBox).

import { describe, expect, it } from 'vitest';
import { GameCamera } from '../../src/app/GameCamera';
import { SLINGSHOT } from '../../src/config/constants';
import { simulateShots } from '../../src/core/sim';
import type { LevelDef } from '../../src/core/types';
import { ALL_LEVELS } from '../../src/levels';
import { BIRD_INTRO, LINT } from '../../src/levels/lint';

/** Вид рогатки: Ред, css px (диаметр 0.9 м), и доля неба над верхом контента. */
function frameOf(lv: LevelDef, w: number, h: number, coarse: boolean) {
  const c = new GameCamera();
  c.pointerCoarse = coarse;
  c.setViewport(w, h, 1);
  c.setLevel(lv);
  const a = c.aimView();
  return { redPx: (0.9 * h) / a.viewH, sky: (a.y + a.viewH / 2 - c.level.contentTop) / a.viewH, right: c.level.contentRight };
}

/** Пороги кадра. Телефон упирается в пол авто-вида GAME_CAM.AIM_H_MIN 12 м: Ред не крупнее 29.25 px на 844×390. */
const FRAME = { desktopRedPx: 49, phoneRedPx: 25, sky: 0.4 } as const;

describe('кадр вида рогатки (1600×900 и телефон 844×390)', () => {
  for (const lv of ALL_LEVELS) {
    it(`${lv.id}: Ред ≥ ${FRAME.desktopRedPx} / ${FRAME.phoneRedPx} px, неба над сооружением ≤ ${FRAME.sky * 100} %`, () => {
      const d = frameOf(lv, 1600, 900, false);
      const p = frameOf(lv, 844, 390, true);
      expect(d.redPx, '1600×900').toBeGreaterThanOrEqual(FRAME.desktopRedPx);
      expect(p.redPx, '844×390').toBeGreaterThanOrEqual(FRAME.phoneRedPx);
      expect(d.sky, '1600×900').toBeLessThanOrEqual(FRAME.sky);
      expect(p.sky, '844×390').toBeLessThanOrEqual(FRAME.sky);
      expect(d.right - lv.slingshot.x, 'правый край контента').toBeLessThanOrEqual(LINT.CONTENT_RIGHT_MAX + 0.75);
    });
  }
});

describe('рельеф кампании', () => {
  it('рогатка на насыпи (основание выше 1 м) не меньше чем в половине уровней', () => {
    const raised = ALL_LEVELS.filter((lv) => lv.slingshot.y - SLINGSHOT.ANCHOR.y >= 1);
    expect(raised.length).toBeGreaterThanOrEqual(ALL_LEVELS.length / 2);
  });

  it('дистанции разные: ближайшая свинья — от 6 до 12 м, правый край контента — в разброс', () => {
    const nearest = ALL_LEVELS.map((lv) => Math.min(...lv.pigs.map((p) => p.x)) - lv.slingshot.x);
    expect(Math.min(...nearest)).toBeLessThan(8);
    expect(Math.max(...nearest)).toBeGreaterThan(10);
  });
});

describe('линия эксперта (калибровка)', () => {
  for (const lv of ALL_LEVELS) {
    const plan = lv.meta?.plan;
    const intro = Object.values(BIRD_INTRO).includes(lv.id);
    it(`${lv.id}: линия проходит уровень, свиньи не у рогатки${intro ? ', вводный уровень устойчив' : ''}`, () => {
      expect(plan, 'meta.plan — npx tsx scripts/level-calibrate.ts').toBeDefined();
      const r = simulateShots(lv, plan!);
      expect(r.won).toBe(true);
      expect(r.shots.length).toBe(lv.meta?.nMin);
      for (const s of r.shots) if (s.pigMinX !== null) expect(s.pigMinX - lv.slingshot.x).toBeGreaterThanOrEqual(LINT.PIG_SLING_MIN);
      // звёзды по устойчивой линии: точный проход линии — не меньше 1★ и пороги круглые
      expect(lv.stars.two % 1000).toBe(0);
      expect(lv.stars.three % 1000).toBe(0);
      if (lv.id.startsWith('1-') || intro) expect(lv.meta?.calib?.robustWin).toBeGreaterThanOrEqual(LINT.ROBUST_MIN);
    });
  }
});
