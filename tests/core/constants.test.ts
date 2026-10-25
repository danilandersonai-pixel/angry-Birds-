// Регрессия по таблице расхождений 00 §1.15 и общим правилам ядра (SLINGSHOT не меняется, в core нет Math.random).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as C from '../../src/config/constants';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('константы (00 §1.15)', () => {
  it('исправленные значения', () => {
    expect(C.ABILITY.RED_BATTLE_CRY).toBe(false);
    expect(C.PIGS.helmet.helmetHp).toBe(10);
    expect(C.PIGS.mustache.hpPerKg).toBe(9);
    expect(C.BIRDS.terence.mult.stone).toBe(2.0);
    expect(C.ABILITY.SILVER.DIVE_MULT.stone).toBe(3.0);
    expect(C.RETIRE.FLIGHT_MAX).toBe(10);
    expect(C.TIMING.LINGER_MAX).toBe(0.6);
    expect(C.TIMING.CALM_HOLD).toBe(0.5);
    expect('TURN_MIN' in C.TIMING || 'TURN_MAX' in C.TIMING).toBe(false);
  });

  it('добавленные поля и разделы', () => {
    expect(C.RETIRE).toMatchObject({ QUICK_SKIP_AFTER_HIT: 1.0, OUT_MARGIN: 8 });
    expect(C.SETTLE).toMatchObject({ BOT_AFTER_IMPACT: 8, BOT_AFTER_LAUNCH: 10 });
    expect(C.WORLD).toMatchObject({ MAX_STEPS_PER_FRAME: 4, MAX_DYNAMIC_BODIES: 120, FAST_BULLET_V: 25, FAST_BULLET_T: 1.0 });
    expect(C.LAUNCH).toMatchObject({ GRAB_RADIUS: 1.0, GRAB_MIN_PX: 44, AIM_MIN_PX_PER_M: 45 });
    expect(C.CAMERA).toMatchObject({ VIEW_H_MIN: 9, VIEW_H_MAX: 30, RETURN_BASE: 0.5, RETURN_MIN: 0.6, RETURN_MAX: 1.4 });
    expect(C.TRAIL).toMatchObject({ STEP: 0.45, MAX_POINTS: 400 });
    expect(C.AIM_ASSIST.SHORT_STEPS).toBe(30);
    expect(C.IMPACT_EVENT).toMatchObject({ VN_MIN: 1.5, J_MIN: 0.5, PAIR_COOLDOWN: 0.08, SHAKE_J_MIN: 20 });
    expect(C.POPUP.MERGE_R).toBe(1.2);
    expect(C.UI_TIMING).toMatchObject({ BONUS_POST: 0.5, BONUS_NONE: 0.6, BONUS_SKIP_SPEED: 4 });
  });

  it('SLINGSHOT — общий контракт с графикой — не изменён', () => {
    expect(C.SLINGSHOT).toEqual({
      ANCHOR: { x: 0.0, y: 2.7 }, PRONG_BACK: { x: -0.3, y: 2.95 }, PRONG_FRONT: { x: 0.28, y: 2.9 }, EMPTY_SAG: 0.1,
      POUCH_HALF: 0.38, BAND_REST: 0.17, BAND_TENSE: 0.08, BURY: 0.4, QUEUE_X0: 1.6, QUEUE_DX: 1.1,
    });
  });

  it('ядро детерминировано: в src/core нет Math.random, Date и импорта Math из planck', () => {
    // настенные часы — только у инструментов проверки уровней (бюджет решателя), в одном модуле
    const clock = join(__dirname, '../../src/core/sim/clock.ts');
    for (const f of files(join(__dirname, '../../src/core'))) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // без комментариев
      expect(src, f).not.toMatch(f === clock ? /Math\.random|Date\.now|new Date/ : /Math\.random|Date\.now|new Date|performance\.now/);
      expect(src, f).not.toMatch(/import\s*{[^}]*\bMath\b[^}]*}\s*from\s*'planck'/);
    }
  });
});
