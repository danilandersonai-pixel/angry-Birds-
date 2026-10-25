// Сцена меню при «Уменьшить движение» (07 §19.3): камера не дрейфует, время фона стоит.

import { describe, expect, it } from 'vitest';
import type { CanvasHost } from '../../src/app/CanvasHost';
import { MenuScene } from '../../src/app/MenuScene';
import type { SpriteCache } from '../../src/render/SpriteCache';

function scene(): MenuScene {
  const host = { ctx: {}, cssW: 1600, cssH: 900, dpr: 1, canvas: { width: 1600, height: 900 }, onChange: () => () => undefined };
  return new MenuScene(host as unknown as CanvasHost, {} as SpriteCache);
}

describe('MenuScene: уменьшенное движение', () => {
  it('обычно камера дрейфует ±1.2 м и время фона идёт; reduced — кадр неподвижен', () => {
    const m = scene();
    const a = m.view(0);
    const b = m.view(9.5); // четверть периода 38 с — дрейф на максимуме
    expect(Math.abs(b.camX - a.camX)).toBeGreaterThan(1);
    expect(b.time).toBe(9.5);
    m.reducedMotion = true;
    const c = m.view(0);
    const d = m.view(9.5);
    expect(d.camX).toBe(c.camX);
    expect(d.time).toBe(0);
    expect(c.camX).toBeCloseTo(a.camX, 9);
  });
});
