// Прогрев фона кусками (ревью «старт: прогрев фона меню — одна задача 224 мс, полоса загрузки замирает»).
// Background.prewarmAsync строит то же, что prewarm, но шагами (тайл полосы / облако) с уступкой кадра.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAll, runSliced } from './slice';

/** Минимальный фейковый DOM-холст: размеры запоминаются, рисование — пустые вызовы. */
function installFakeDom(): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = g.document;
  const prevPath = g.Path2D;
  // Path2D: любые построители пути — пустые вызовы
  g.Path2D = class {
    constructor() {
      return new Proxy(this, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => undefined) });
    }
  };
  const gradient = { addColorStop() {} };
  const makeCtx = (canvas: { width: number; height: number }) =>
    new Proxy(
      {},
      {
        get(_t, k: string) {
          if (k === 'canvas') return canvas;
          if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createConicGradient') return () => gradient;
          if (k === 'createPattern') return () => ({ setTransform() {} });
          if (k === 'createImageData' || k === 'getImageData')
            return (a: number, b: number, c?: number, d?: number) => {
              const w = c ?? a;
              const h = d ?? b;
              return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) };
            };
          if (k === 'measureText') return () => ({ width: 10 });
          return () => undefined;
        },
        set: () => true,
      },
    );
  g.document = {
    createElement: () => {
      const c = { width: 1, height: 1, getContext: () => ctx };
      const ctx = makeCtx(c);
      return c;
    },
  };
  return () => {
    g.document = prev;
    g.Path2D = prevPath;
  };
}

describe('runSliced', () => {
  it('выполняет все шаги и уступает кадр между кусками ≥ sliceMs', async () => {
    function* steps(): Generator<void> {
      for (let i = 0; i < 12; i++) {
        const t = performance.now();
        while (performance.now() - t < 3);
        yield;
      }
    }
    let yields = 0;
    const n = await runSliced(steps(), { yieldFn: async () => void yields++, sliceMs: 7 });
    expect(n).toBe(12);
    // шаг ≈ 3 мс, кусок ≥ 7 мс: уступок меньше, чем шагов, но хотя бы одна (точное число зависит от нагрузки)
    expect(yields).toBeGreaterThanOrEqual(1);
    expect(yields).toBeLessThanOrEqual(12);
    let each = 0;
    await runSliced(steps(), { yieldFn: async () => void each++, sliceMs: 0 });
    expect(each).toBe(12);
    // без yieldFn — сразу, как синхронный прогрев
    expect(await runSliced(steps())).toBe(12);
    expect(runAll(steps())).toBe(12);
  });
});

describe('Background.prewarmAsync', () => {
  let restore: () => void = () => {};
  beforeAll(() => {
    restore = installFakeDom();
  });
  afterAll(() => restore());

  it('строит то же, что prewarm, но шагами по тайлу/облаку с уступкой кадра', async () => {
    const { Background } = await import('./background');
    const view = { screenW: 1600, screenH: 900, camX: 10, camY: 5, scale: 60, dpr: 1, time: 0 };
    for (const theme of ['meadow', 'beach', 'snow'] as const) {
      const a = new Background(theme);
      a.prewarm(view);
      const b = new Background(theme);
      const steps = [...b.prewarmSteps(view)].length;
      const c = new Background(theme);
      let yields = 0;
      // sliceMs 0 — уступка после каждого шага: шагов много (полосы по тайлам + облака), а не одна задача
      await c.prewarmAsync(view, { yieldFn: async () => void yields++, sliceMs: 0 });
      expect(steps).toBeGreaterThan(10);
      expect(yields).toBe(steps);
      expect(c.memoryBytes).toBe(a.memoryBytes);
      expect(b.memoryBytes).toBe(a.memoryBytes);
      // повторный прогрев того же вида ничего не строит (только облака/вытеснение)
      const again = [...c.prewarmSteps(view)].length;
      expect(again).toBeLessThan(steps);
    }
  });
});
