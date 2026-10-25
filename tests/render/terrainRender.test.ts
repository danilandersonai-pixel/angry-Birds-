// Рендер рельефа в Node на поддельном Canvas: совмещение с телами при повороте кадра (тряска 0.5°),
// кэш тайлов (один активный рельеф, узнавание по содержимому, 2 масштаба, освобождение).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCanvasEl, FakeMatrix, LOG, fakeDomGlobals, type FakeCtx } from './fakeCanvas';
import { TerrainRenderer, shakeFrame } from '../../src/render/sprites/terrain';
import { flatGround, hill, plateau } from '../../src/levels/prefabs';
import type { TerrainDef } from '../../src/core/types';
import type { ViewInfo } from '../../src/render/view';

const W = 1280;
const H = 720;
const view = (viewH: number, camX = 14): ViewInfo => ({ screenW: W, screenH: H, camX, camY: -1.2 + viewH / 2, scale: H / viewH, dpr: 1, time: 0 });
const terrainA = (): TerrainDef[] => [flatGround(), hill(8, 14, 19, 27, 4)];
const terrainB = (): TerrainDef[] => [flatGround(), plateau(30, 36, 3, { kind: 'ground', slope: 2 })];
/** Тело рисуется так (Renderer/04 §10.3): кадр × [s, 0, 0, −s, W/2 − camX·s, H/2 + camY·s]. */
const bodyMatrix = (v: ViewInfo, frame: FakeMatrix): FakeMatrix =>
  frame.multiply(new FakeMatrix([v.scale, 0, 0, -v.scale, v.screenW / 2 - v.camX * v.scale, v.screenH / 2 + v.camY * v.scale]));

type Internals = { items: unknown; sets: Array<{ scale: number; pinned: boolean; tiles: Map<number, unknown> }> };
const inner = (r: TerrainRenderer): Internals => r as unknown as Internals;

let now = 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  fakeDomGlobals((n, v) => vi.stubGlobal(n, v));
  now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  LOG.length = 0;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('поворот кадра от тряски', () => {
  it('векторный рельеф: мир → экран совпадает с телами при 0.5°', () => {
    const main = new FakeCanvasEl();
    const ctx = main.getContext() as FakeCtx;
    const v = view(15);
    const frame = shakeFrame(v, (0.5 * Math.PI) / 180) as unknown as FakeMatrix;
    const r = new TerrainRenderer();
    // оставленная вызывающим трансформация не влияет (как у Renderer после блита спрайта)
    ctx.setTransform(2, 0, 0, 2, 100, 50);
    r.draw(ctx as unknown as CanvasRenderingContext2D, terrainA(), 'meadow', v, frame as unknown as DOMMatrix);
    const fills = LOG.filter((d) => d.canvas === main && d.op === 'fill' && Math.abs(Math.hypot(d.m.a, d.m.b) - v.scale) < 1e-6);
    expect(fills.length).toBeGreaterThan(0);
    const B = bodyMatrix(v, frame);
    const err = (m: FakeMatrix): number => {
      let e = 0;
      for (const [x, y] of [
        [0, 0],
        [14, 4],
        [27, 0],
        [5, -3],
      ] as const) {
        const [ax, ay] = m.apply(x, y);
        const [bx, by] = B.apply(x, y);
        e = Math.max(e, Math.hypot(ax - bx, ay - by));
      }
      return e;
    };
    // первая заливка — грунт по контуру; остальные — тоже в мировой трансформации (кроме «губы» кромки: сдвиг 0.06 м вниз)
    expect(err(fills[0].m)).toBeLessThan(1e-6);
    const lip = 0.06 * v.scale;
    for (const d of fills) {
      const e = err(d.m);
      expect(e < 1e-6 || Math.abs(e - lip) < 1e-6).toBe(true);
    }
    // без поворота у края 1280 px расхождение было бы ≈ 5.6 px — проверка чувствительна
    const [ux, uy] = bodyMatrix(v, new FakeMatrix()).apply(27, 0);
    const [rx, ry] = B.apply(27, 0);
    expect(Math.hypot(ux - rx, uy - ry)).toBeGreaterThan(1);
  });

  it('тайлы: кладутся в кадре тряски с шагом 256 px от начала мира', () => {
    const main = new FakeCanvasEl();
    const ctx = main.getContext() as FakeCtx;
    const v = view(15);
    const r = new TerrainRenderer();
    r.prewarm(terrainA(), 'meadow', v);
    expect(r.memoryBytes).toBeGreaterThan(0);
    LOG.length = 0;
    const frame = shakeFrame(v, (-0.5 * Math.PI) / 180) as unknown as FakeMatrix;
    r.draw(ctx as unknown as CanvasRenderingContext2D, terrainA(), 'meadow', v, frame as unknown as DOMMatrix);
    const blits = LOG.filter((d) => d.canvas === main && d.op === 'drawImage');
    expect(blits.length).toBeGreaterThan(0);
    const ox = W / 2 - v.camX * v.scale;
    const oy = H / 2 + v.camY * v.scale;
    for (const d of blits) {
      expect([d.m.a, d.m.b, d.m.c, d.m.d, d.m.e, d.m.f].map((q) => +q.toFixed(9))).toEqual([frame.a, frame.b, frame.c, frame.d, frame.e, frame.f].map((q) => +q.toFixed(9)));
      const [, dx, dy] = d.args as [unknown, number, number];
      // тайл (i, j) запечён с началом мира в (−i·256, −j·256) — значит dx − ox и dy − oy кратны 256 ровно
      expect(Math.abs((dx - ox) / 256 - Math.round((dx - ox) / 256))).toBeLessThan(1e-9);
      expect(Math.abs((dy - oy) / 256 - Math.round((dy - oy) / 256))).toBeLessThan(1e-9);
    }
  });
});

describe('кэш рельефа', () => {
  it('тот же рельеф в новом массиве не пересобирается, другой — освобождает прежний, release() — всё', () => {
    const ctx = new FakeCanvasEl().getContext() as unknown as CanvasRenderingContext2D;
    const v = view(15);
    const r = new TerrainRenderer();
    r.prewarm(terrainA(), 'meadow', v);
    const items = inner(r).items;
    const bytes = r.memoryBytes;
    expect(bytes).toBeGreaterThan(0);
    r.draw(ctx, terrainA(), 'meadow', v);
    expect(inner(r).items).toBe(items);
    expect(r.memoryBytes).toBe(bytes);
    r.draw(ctx, terrainB(), 'meadow', v);
    expect(inner(r).items).not.toBe(items);
    expect(r.memoryBytes).toBeLessThan(bytes);
    r.release();
    expect(r.memoryBytes).toBe(0);
    expect(inner(r).sets).toHaveLength(0);
  });

  it('2 масштаба: вид рогатки (prewarm) не вытесняется; редкий масштаб не вытесняет частый', () => {
    const ctx = new FakeCanvasEl().getContext() as unknown as CanvasRenderingContext2D;
    const r = new TerrainRenderer();
    const T = terrainA();
    const A = view(15);
    const Bv = view(20);
    const Cv = view(26);
    r.prewarm(T, 'meadow', A);
    const settle = (v: ViewInfo): void => {
      r.draw(ctx, T, 'meadow', v);
      now += 300;
      r.draw(ctx, T, 'meadow', v);
      now += 16;
    };
    // ход: прицел A → пауза на B → обратно A (дважды)
    for (let k = 0; k < 3; k++) {
      settle(A);
      settle(Bv);
    }
    settle(A);
    let scales = inner(r).sets.map((s) => +s.scale.toFixed(3));
    expect(scales).toContain(+A.scale.toFixed(3));
    expect(scales).toContain(+Bv.scale.toFixed(3));
    const bTiles = inner(r).sets.find((s) => Math.abs(s.scale - Bv.scale) < 1e-6)!.tiles;
    // редкий масштаб C (1 посещение) не вытесняет B (3 посещения)
    settle(Cv);
    scales = inner(r).sets.map((s) => +s.scale.toFixed(3));
    expect(scales).toEqual(expect.arrayContaining([+A.scale.toFixed(3), +Bv.scale.toFixed(3)]));
    expect(scales).not.toContain(+Cv.scale.toFixed(3));
    // возврат к B — те же тайлы, без пересборки
    settle(Bv);
    expect(inner(r).sets.find((s) => Math.abs(s.scale - Bv.scale) < 1e-6)!.tiles).toBe(bTiles);
    expect(inner(r).sets.find((s) => Math.abs(s.scale - A.scale) < 1e-6)!.pinned).toBe(true);
  });
});
