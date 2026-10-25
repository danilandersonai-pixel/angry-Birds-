// Хвостик облачка подсказки (плейтест №2, Б9): тянется к точке ниже облачка, основание — на прямом участке кромки.
import { describe, expect, it } from 'vitest';
import { tailGeometry, type TailBox } from '../../src/ui/hintTail';

// облачко 800×149 сверху по центру окна 1600×900 (u = 1.25): как в предпросмотре
const BOX: TailBox = { left: 400, top: 115, width: 800, height: 149, border: 6.25, radius: 32.5, u: 1.25 };

describe('tailGeometry', () => {
  it('рогатка слева внизу: основание у левого края прямого участка, кончик ниже кромки и левее основания', () => {
    const g = tailGeometry(BOX, 320, 538)!;
    expect(g).not.toBeNull();
    expect(g.baseX).toBeCloseTo(BOX.radius + g.half, 6);
    expect(g.tipY).toBeCloseTo(BOX.height + 26 * BOX.u, 6);
    expect(g.tipX).toBeLessThan(g.baseX);
    // наклон не больше 55°
    expect(Math.abs(Math.atan2(g.tipX - g.baseX, g.tipY - BOX.height))).toBeLessThanOrEqual((55 * Math.PI) / 180 + 1e-9);
  });

  it('точка прямо под облачком: хвост вертикальный, основание над точкой', () => {
    const g = tailGeometry(BOX, 800, 600)!;
    expect(g.baseX).toBeCloseTo(400, 6);
    expect(g.tipX).toBeCloseTo(400, 6);
  });

  it('основание не заходит на скругление углов', () => {
    for (const x of [-500, 0, 400, 1200, 1600, 3000]) {
      const g = tailGeometry(BOX, x, 700)!;
      expect(g.baseX - g.half).toBeGreaterThanOrEqual(BOX.radius - 1e-9);
      expect(g.baseX + g.half).toBeLessThanOrEqual(BOX.width - BOX.radius + 1e-9);
    }
  });

  it('точка близко к кромке — кончик не дальше точки; точка выше или вровень — хвоста нет', () => {
    const near = tailGeometry(BOX, 800, BOX.top + BOX.height + 20)!;
    expect(near.tipY).toBeLessThanOrEqual(BOX.height + 20);
    expect(tailGeometry(BOX, 800, BOX.top + BOX.height + 5)).toBeNull();
    expect(tailGeometry(BOX, 800, 100)).toBeNull();
  });

  it('мусор на входе и слишком узкое облачко — без хвоста', () => {
    expect(tailGeometry(BOX, Number.NaN, 600)).toBeNull();
    expect(tailGeometry({ ...BOX, width: 50 }, 800, 600)).toBeNull();
    expect(tailGeometry({ ...BOX, height: 0 }, 800, 600)).toBeNull();
  });
});
