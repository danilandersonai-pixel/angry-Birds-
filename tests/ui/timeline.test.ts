// Таймлайн экрана победы (anim.ts): пропуск выполняет события по порядку и доводит твины до конца.
import { describe, expect, it } from 'vitest';
import { Timeline, ease } from '../../src/ui/anim';

describe('Timeline.skip', () => {
  it('события — по времени, с флагом skipped; твины — до k = 1; onFinish один раз', () => {
    const log: string[] = [];
    let k = 0;
    let finished = 0;
    const tl = new Timeline()
      .at(1.4, (s) => log.push(`c:${s}`))
      .at(0.5, (s) => log.push(`a:${s}`))
      .at(0.95, (s) => log.push(`b:${s}`))
      .tween(1.65, 1.2, (v) => (k = v));
    tl.onFinish = () => finished++;
    tl.skip();
    expect(log).toEqual(['a:true', 'b:true', 'c:true']);
    expect(k).toBe(1);
    expect(tl.finished).toBe(true);
    expect(finished).toBe(1);
    tl.skip();
    expect(log.length).toBe(3);
    expect(finished).toBe(1);
  });
});

describe('ease', () => {
  it('концы в 0 и 1, outBack перелетает', () => {
    for (const f of [ease.outQuad, ease.outCubic, ease.inCubic, ease.inOutCubic]) {
      expect(f(0)).toBeCloseTo(0, 6);
      expect(f(1)).toBeCloseTo(1, 6);
    }
    expect(ease.outBack(0)).toBeCloseTo(0, 6);
    expect(ease.outBack(1)).toBeCloseTo(1, 6);
    expect(Math.max(...Array.from({ length: 50 }, (_, i) => ease.outBack(i / 49)))).toBeGreaterThan(1.05);
  });
});
