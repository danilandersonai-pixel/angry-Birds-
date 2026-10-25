// Камера: мир↔экран, якорный зум, ограничения границ и земли, перелёты, следование, виды уровня, тряска, инерция.

import { describe, expect, it } from 'vitest';
import { analyzeLevel, Camera, CAMERA_CFG, terrainGroundRef } from '../../src/render/Camera';
import { ALL_LEVELS } from '../../src/levels/index';
import { BIRDS, LAUNCH, PIGS } from '../../src/config/constants';
import { screenToWorldX, screenToWorldY, worldToScreenX, worldToScreenY } from '../../src/render/view';
import type { BlockDef, LevelDef, PigDef, TerrainDef } from '../../src/core/types';

const ground = (x0 = -40, x1 = 140): TerrainDef => ({ kind: 'ground', points: [[x0, -10], [x1, -10], [x1, 0], [x0, 0]] });
const rect = (x: number, y: number, w: number, h: number): BlockDef => ({ material: 'wood', shape: 'rect', x, y, w, h });

/** Как 1-1: деревянная башня в 2 этажа на x = 26, две свиньи. */
function hutLevel(over: Partial<LevelDef> = {}): LevelDef {
  const blocks: BlockDef[] = [];
  for (let i = 0; i < 2; i++) {
    const y = i * 2.5;
    blocks.push(rect(24.25, y + 1, 0.5, 2), rect(27.75, y + 1, 0.5, 2), rect(26, y + 2.25, 4, 0.5));
  }
  const pigs: PigDef[] = [
    { type: 'small', x: 26, y: 0.405 },
    { type: 'small', x: 26, y: 2.905 },
  ];
  return {
    id: 't',
    name: 'Тест',
    theme: 'meadow',
    birds: ['red', 'red', 'red'],
    slingshot: { x: 0, y: 2.7 },
    bounds: { minX: -12, maxX: 48, maxY: 25 },
    terrain: [ground()],
    blocks,
    pigs,
    tnt: [],
    stars: { one: 0, two: 20000, three: 30000 },
    ...over,
  };
}

function cam(level: LevelDef = hutLevel(), w = 1280, h = 720, dpr = 1): Camera {
  const c = new Camera();
  c.setViewport(w, h, dpr);
  c.setLevel(level);
  return c;
}

const bottomOf = (c: Camera): number => c.y - c.viewH / 2;

describe('Camera: мир ↔ экран', () => {
  for (const dpr of [1, 2]) {
    it(`туда-обратно при dpr ${dpr}`, () => {
      const c = cam(hutLevel(), 1280, 720, dpr);
      c.flyTo(14, 9, 17.3, 0);
      for (const [x, y] of [[0, 2.7], [26, 0.4], [-11.5, -1.1], [40, 18]]) {
        const s = c.worldToScreen(x, y);
        const w = c.screenToWorld(s.x, s.y);
        expect(w.x).toBeCloseTo(x, 9);
        expect(w.y).toBeCloseTo(y, 9);
      }
      for (const [sx, sy] of [[0, 0], [640, 360], [1279, 719], [17.5, 600.25]]) {
        const w = c.screenToWorld(sx, sy);
        const s = c.worldToScreen(w.x, w.y);
        expect(s.x).toBeCloseTo(sx, 9);
        expect(s.y).toBeCloseTo(sy, 9);
      }
    });

    it(`view() согласован с CSS-отображением (пиксели устройства = CSS × dpr), dpr ${dpr}`, () => {
      const c = cam(hutLevel(), 1280, 720, dpr);
      const v = c.view(0);
      expect(v.screenW).toBe(1280 * dpr);
      expect(v.screenH).toBe(720 * dpr);
      expect(v.dpr).toBe(dpr);
      expect(v.scale).toBeCloseTo((720 * dpr) / c.viewH, 9);
      expect(c.scale).toBeCloseTo(v.scale, 12);
      for (const [x, y] of [[0, 2.7], [26, 5]]) {
        const s = c.worldToScreen(x, y);
        expect(worldToScreenX(v, x)).toBeCloseTo(s.x * dpr, 6);
        expect(worldToScreenY(v, y)).toBeCloseTo(s.y * dpr, 6);
        expect(screenToWorldX(v, s.x * dpr)).toBeCloseTo(x, 6);
        expect(screenToWorldY(v, s.y * dpr)).toBeCloseTo(y, 6);
      }
    });
  }

  it('ось Y экрана вниз: выше в мире — меньше sy; ppm = cssH / viewH', () => {
    const c = cam();
    expect(c.worldToScreen(0, 5).y).toBeLessThan(c.worldToScreen(0, 1).y);
    expect(c.ppm).toBeCloseTo(720 / c.viewH, 12);
    const a = c.worldToScreen(10, 0);
    const b = c.worldToScreen(11, 0);
    expect(b.x - a.x).toBeCloseTo(c.ppm, 9);
  });
});

describe('Camera: зум', () => {
  it('zoomAt сохраняет точку под курсором (не упираясь в границы)', () => {
    const c = cam();
    c.flyTo(16, 11, 20, 0);
    for (const [factor, sx, sy] of [[1.3, 700, 300], [1.1, 200, 150], [0.9, 640, 200], [1.05, 1000, 500]]) {
      const before = c.screenToWorld(sx, sy);
      const h0 = c.viewH;
      c.zoomAt(factor, sx, sy);
      expect(c.viewH).toBeCloseTo(h0 / factor, 9);
      const s = c.worldToScreen(before.x, before.y);
      expect(s.x).toBeCloseTo(sx, 6);
      expect(s.y).toBeCloseTo(sy, 6);
    }
  });

  it('viewH ограничен [9, 30]', () => {
    const c = cam();
    for (let i = 0; i < 50; i++) c.zoomAt(1.5, 640, 360);
    expect(c.viewH).toBeCloseTo(CAMERA_CFG.VIEW_H_MIN, 9);
    for (let i = 0; i < 50; i++) c.zoomAt(0.5, 640, 360);
    expect(c.viewH).toBeCloseTo(CAMERA_CFG.VIEW_H_MAX, 9);
  });

  it('некорректный множитель игнорируется', () => {
    const c = cam();
    const h = c.viewH;
    c.zoomAt(0, 0, 0);
    c.zoomAt(Number.NaN, 0, 0);
    c.zoomAt(-2, 0, 0);
    expect(c.viewH).toBe(h);
  });
});

describe('Camera: ограничения', () => {
  it('пан не выводит за bounds и под землю больше чем на 1.2 м; верх ≤ низ + 30', () => {
    const c = cam();
    const L = c.level;
    for (const [dx, dy] of [[1e5, 0], [-1e5, 0], [0, -1e5], [0, 1e5], [3e4, -3e4]]) {
      c.panBy(dx, dy);
      const hw = c.viewW / 2;
      expect(c.x - hw).toBeGreaterThanOrEqual(L.minX - 1e-9);
      expect(c.x + hw).toBeLessThanOrEqual(L.maxX + 1e-9);
      expect(bottomOf(c)).toBeGreaterThanOrEqual(L.groundRef - 1.2 - 1e-9);
      expect(c.y + c.viewH / 2).toBeLessThanOrEqual(L.groundRef - 1.2 + 30 + 1e-9);
    }
    c.panBy(0, -1e5); // тянем мир вверх = камера вниз
    expect(bottomOf(c)).toBeCloseTo(-1.2, 9);
  });

  it('вид шире уровня — по центру bounds', () => {
    const c = cam(hutLevel({ bounds: { minX: -12, maxX: 30, maxY: 25 } }), 2560, 720);
    c.zoomAt(0.1, 640, 360); // viewH 30 → ширина 106 м > 42 м
    expect(c.x).toBeCloseTo(9, 9);
    c.panBy(500, 0);
    expect(c.x).toBeCloseTo(9, 9);
  });

  it('любое соотношение сторон: смена viewport пересчитывает ограничения', () => {
    const c = cam();
    for (const [w, h] of [[1280, 720], [2560, 1080], [1024, 768], [844, 390], [390, 844], [300, 3000], [3000, 200]]) {
      c.setViewport(w, h, 2);
      c.panBy(1e5, 1e5);
      const hw = c.viewW / 2;
      const L = c.level;
      if (c.viewW < L.maxX - L.minX) expect(c.x + hw).toBeLessThanOrEqual(L.maxX + 1e-9);
      else expect(c.x).toBeCloseTo((L.minX + L.maxX) / 2, 9);
      expect(bottomOf(c)).toBeGreaterThanOrEqual(-1.2 - 1e-9);
      for (const v of [c.aimView(), c.overview(), c.castleView()]) {
        expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.viewH)).toBe(true);
        expect(v.viewH).toBeGreaterThanOrEqual(9);
        expect(v.viewH).toBeLessThanOrEqual(30);
        expect(v.y - v.viewH / 2).toBeGreaterThanOrEqual(-1.2 - 1e-9);
      }
    }
  });

  it('нулевой и битый viewport не ломают камеру', () => {
    const c = cam();
    c.setViewport(0, 0, 0);
    c.setViewport(Number.NaN, 100, Number.POSITIVE_INFINITY);
    const v = c.view(1);
    expect(Number.isFinite(v.camX) && Number.isFinite(v.scale)).toBe(true);
  });
});

describe('Camera: земля уровня (groundRef)', () => {
  it('плоская земля → 0, порядок обхода не важен', () => {
    expect(terrainGroundRef([ground()], -12, 48)).toBeCloseTo(0, 9);
    const cw: TerrainDef = { kind: 'ground', points: [[-40, 0], [140, 0], [140, -10], [-40, -10]] };
    expect(terrainGroundRef([cw], -12, 48)).toBeCloseTo(0, 9);
  });

  it('плато не поднимает землю, яма опускает; стенки и потолки не считаются', () => {
    const plateau: TerrainDef = { kind: 'rock', points: [[12, 0], [20, 0], [20, 4], [12, 4]] };
    expect(terrainGroundRef([ground(), plateau], -12, 48)).toBeCloseTo(0, 9);
    const pit: TerrainDef = { kind: 'ground', points: [[-40, -10], [140, -10], [140, 0], [30, 0], [30, -3], [25, -3], [25, 0], [-40, 0]] };
    expect(terrainGroundRef([pit], -12, 48)).toBeCloseTo(-3, 9);
    // яма за пределами bounds не влияет
    expect(terrainGroundRef([pit], -12, 20)).toBeCloseTo(0, 9);
  });

  it('уровень на возвышении: низ кадра = земля − 1.2', () => {
    const high: TerrainDef = { kind: 'ground', points: [[-40, -10], [140, -10], [140, 5], [-40, 5]] };
    const c = cam(hutLevel({ terrain: [high], slingshot: { x: 0, y: 7.7 } }));
    expect(c.groundRef).toBeCloseTo(5, 9);
    expect(bottomOf(c)).toBeCloseTo(3.8, 9);
  });
});

describe('Camera: виды уровня', () => {
  const contains = (v: { x: number; y: number; viewH: number }, aspect: number, x: number, y: number, m = 0): boolean =>
    Math.abs(x - v.x) <= (v.viewH * aspect) / 2 - m && Math.abs(y - v.y) <= v.viewH / 2 - m;

  for (const [name, w, h] of [['16:9', 1280, 720], ['21:9', 2520, 1080], ['4:3', 1024, 768], ['iPad 1.44', 1180, 820], ['телефон 19.5:9', 844, 390], ['телефон 16:9', 640, 360]] as const) {
    it(`aimView (${name}) содержит рогатку, очередь и цель уровня`, () => {
      const lvl = hutLevel();
      const c = cam(lvl, w, h);
      const v = c.aimView();
      const a = w / h;
      expect(v.viewH).toBeGreaterThanOrEqual(15);
      expect(v.viewH).toBeLessThanOrEqual(a >= 16 / 9 - 1e-9 ? 24 : 30);
      expect(v.y - v.viewH / 2).toBeCloseTo(-1.2, 9); // прижат к земле
      // рогатка на 20 % ширины слева
      const left = v.x - (v.viewH * a) / 2;
      expect((lvl.slingshot.x - left) / (v.viewH * a)).toBeCloseTo(0.2, 6);
      expect(contains(v, a, lvl.slingshot.x, lvl.slingshot.y, 0.5)).toBe(true);
      expect(contains(v, a, lvl.slingshot.x, -0.2)).toBe(true); // основание рогатки
      expect(contains(v, a, -1.6, 0.45)).toBe(true); // первая птица очереди
      for (const b of lvl.blocks) {
        expect(contains(v, a, b.x + b.w / 2, b.y + b.h / 2)).toBe(true);
        expect(contains(v, a, b.x - b.w / 2, b.y - b.h / 2)).toBe(true);
      }
      for (const p of lvl.pigs) expect(contains(v, a, p.x, p.y, 0.405)).toBe(true);
      // setLevel ставит камеру в вид рогатки
      expect(c.x).toBeCloseTo(v.x, 9);
      expect(c.viewH).toBeCloseTo(v.viewH, 9);
    });
  }

  it('авто-высота: на 16:9 под 1-1 ≈ 22.5 м, на 21:9 ближе; level.camera.aimViewH переопределяет', () => {
    const c = cam(hutLevel(), 1280, 720);
    // xR = 28 + 2 = 30 → 30 / (0.8 · 16/9) = 21.1
    expect(c.autoAimViewH).toBeCloseTo(30 / (0.8 * (1280 / 720)), 6);
    const wide = cam(hutLevel(), 2520, 1080);
    expect(wide.autoAimViewH).toBeLessThan(c.autoAimViewH);
    const fixed = cam(hutLevel({ camera: { aimViewH: 17 } }));
    expect(fixed.aimView().viewH).toBeCloseTo(17, 9);
    // близкое сооружение → минимум 15 м
    const near = cam(hutLevel({ blocks: [rect(12, 0.5, 1, 1)], pigs: [] }));
    expect(near.autoAimViewH).toBe(15);
    // дальнее: на потолке 24 м рогатка уходит левее 20 % (с местом под оттяжку) и сооружение влезает
    const mid = cam(hutLevel({ blocks: [rect(36, 0.5, 1, 1)], pigs: [] }), 1920, 1080);
    expect(mid.autoAimViewH).toBe(24);
    const mv = mid.aimView();
    expect(mv.x + (mv.viewH * mid.aspect) / 2).toBeCloseTo(36.5 + 2, 6);
    expect(mv.x - (mv.viewH * mid.aspect) / 2).toBeLessThanOrEqual(-mid.aimLeftRoom(24) + 1e-9);
    // очень дальнее: сдвига мало — отдаление выше 24 м, вплоть до 30
    const far = cam(hutLevel({ blocks: [rect(45, 0.5, 1, 1)], pigs: [], bounds: { minX: -12, maxX: 60, maxY: 25 } }));
    expect(far.autoAimViewH).toBeGreaterThan(24);
    expect(far.autoAimViewH).toBeLessThan(30);
    const fv = far.aimView();
    expect(fv.x + (fv.viewH * far.aspect) / 2).toBeCloseTo(45.5 + 2, 3);
    expect(far.level.slingX - (fv.x - (fv.viewH * far.aspect) / 2)).toBeCloseTo(far.aimLeftRoom(fv.viewH), 3);
    // на 4:3 потолок с рогаткой на 20 % держит ширину кадра 16:9 при 24 м (42.7 м), но не выше 30 м
    far.setViewport(1024, 768, 1);
    expect(far.aimViewHMax).toBe(30);
    expect(far.autoAimViewH).toBe(30);
    far.setViewport(1180, 820, 1);
    expect(far.aimViewHMax * far.aspect).toBeCloseTo(24 * (16 / 9), 6);
  });

  it('зум игрока в виде рогатки запоминается и сбрасывается при setLevel', () => {
    const c = cam();
    c.zoomAt(1.4, 300, 400);
    c.rememberAimZoom();
    const h = c.viewH;
    expect(c.aimView().viewH).toBeCloseTo(h, 9);
    c.setLevel(hutLevel());
    expect(c.userAimViewH).toBeNull();
    expect(c.aimView().viewH).toBeCloseTo(c.autoAimViewH, 9);
  });

  it('общий план шире вида рогатки и показывает очередь и сооружение; castleView — над свиньями', () => {
    const lvl = hutLevel();
    const c = cam(lvl);
    const a = c.aspect;
    const ov = c.overview();
    expect(ov.viewH).toBeGreaterThan(c.aimView().viewH);
    expect(ov.viewH).toBeLessThanOrEqual(30);
    expect(contains(ov, a, c.level.queueLeft, 0.4)).toBe(true);
    expect(contains(ov, a, 28, 5)).toBe(true);
    const cv = c.castleView();
    expect(cv.x).toBeCloseTo(26, 6);
    expect(cv.viewH).toBeGreaterThanOrEqual(c.autoAimViewH);
    expect(cv.y - cv.viewH / 2).toBeCloseTo(-1.2, 9);
    const given = cam(hutLevel({ camera: { castle: { x: 30, y: 9, viewH: 18 } } }));
    expect(given.castleView()).toEqual({ x: 30, y: 9, viewH: 18 });
  });

  it('очередь птиц учитывает радиусы (Теренс, Бомб)', () => {
    const f = analyzeLevel(hutLevel({ birds: ['red', 'terence', 'bomb', 'red'] }));
    // x: −1.6, −1.6 − 1.45, −3.05 − 1.585, −4.635 − 1.235 → левый край −5.87 − 0.45
    expect(f.queueLeft).toBeCloseTo(-1.6 - 1.45 - 1.585 - 1.235 - 0.45, 6);
  });

  it('пустой уровень и повёрнутые блоки не дают NaN', () => {
    const c = cam(hutLevel({ blocks: [], pigs: [] }));
    expect(Number.isFinite(c.aimView().x)).toBe(true);
    const f = analyzeLevel(hutLevel({ blocks: [{ ...rect(20, 2, 4, 0.5), angle: Math.PI / 2 }], pigs: [] }));
    expect(f.contentTop).toBeCloseTo(4, 6);
    expect(f.contentRight).toBeCloseTo(20.25, 6);
  });
});

describe('Camera: вид рогатки на уровнях кампании', () => {
  const SIZES = [
    ['16:9', 1920, 1080],
    ['16:9 ноутбук', 1280, 720],
    ['4:3', 1024, 768],
    ['iPad', 1180, 820],
    ['21:9', 2560, 1080],
    ['телефон', 844, 390],
    ['телефон 16:9', 640, 360],
  ] as const;
  for (const [name, w, h] of SIZES) {
    it(`${name}: сооружение и свиньи в кадре, рогатка не правее 20 %, оттянутая птица и очередь видны`, () => {
      const cut: string[] = [];
      for (const lvl of ALL_LEVELS) {
        const c = cam(lvl, w, h);
        const f = c.level;
        const v = c.aimView();
        const vw = v.viewH * c.aspect;
        const left = v.x - vw / 2;
        const right = v.x + vw / 2;
        expect(v.y - v.viewH / 2).toBeCloseTo(f.groundRef - 1.2, 9);
        expect((f.slingX - left) / vw).toBeLessThanOrEqual(0.2 + 1e-9);
        // слева: птица, оттянутая на R_MAX, и первая птица очереди
        const r0 = BIRDS[lvl.birds[0]].radius;
        expect(left).toBeLessThanOrEqual(f.slingX - LAUNCH.R_MAX - r0 + 1e-9);
        if (lvl.birds.length > 1) expect(left).toBeLessThanOrEqual(f.slingX - 1.6 - BIRDS[lvl.birds[1]].radius + 1e-9);
        // сдвиг левее 20 % — только с запасом под палец, кроме максимального отдаления
        if ((f.slingX - left) / vw < 0.2 - 1e-6 && v.viewH < 30 - 1e-6) expect(f.slingX - left).toBeGreaterThanOrEqual(c.aimLeftRoom(v.viewH) - 1e-6);
        if (f.contentRight > right + 1e-6) {
          // не влезло — только если упёрлись: 30 м и жёсткий минимум слева
          expect(v.viewH).toBe(30);
          expect(f.slingX - left).toBeCloseTo(f.aimLeftKeep, 6);
          cut.push(`${lvl.id} ${(f.contentRight - right).toFixed(2)} м`);
        }
        for (const p of lvl.pigs) {
          if (p.x + PIGS[p.type].radius > right + 1e-6) cut.push(`${lvl.id} свинья ${p.type}@${p.x}`);
        }
      }
      // на 16:9 и шире всё влезает; на 4:3 / iPad допускаем обрезку блока до 0.5 м при 30 м, но не свиней
      if (w / h >= 16 / 9 - 1e-9) expect(cut).toEqual([]);
      for (const c of cut) expect(c).not.toMatch(/свинья/);
      for (const c of cut) expect(Number.parseFloat(c.split(' ')[1])).toBeLessThanOrEqual(0.5);
    });
  }

  it('Z на 4:3: «общий план» заметно отличается от вида рогатки на каждом уровне', () => {
    for (const [w, h] of [[1024, 768], [1180, 820], [1920, 1080], [844, 390]]) {
      for (const lvl of ALL_LEVELS) {
        const c = cam(lvl, w, h);
        const a = c.aimView();
        const o = c.overviewTarget();
        const differs = o.viewH >= a.viewH * 1.12 - 1e-9 || Math.abs(o.x - a.x) >= 0.1 * o.viewH * c.aspect - 1e-9;
        expect(differs, `${lvl.id} ${w}×${h}`).toBe(true);
        expect(c.toggleOverview()).toBe('overview');
        for (let i = 0; i < 40; i++) c.update(1 / 60);
        expect(c.x).toBeCloseTo(o.x, 6);
        expect(c.toggleOverview()).toBe('aim');
      }
    }
  });

  it('зум игрока: вид рогатки при смене зума тоже сдвигается ровно настолько, чтобы показать сооружение', () => {
    const lvl = ALL_LEVELS.find((l) => l.id === '2-10') ?? hutLevel({ blocks: [rect(37, 0.5, 1, 1)], pigs: [] });
    const c = cam(lvl, 1280, 720);
    c.zoomAt(1.25, 640, 360);
    c.rememberAimZoom();
    const v = c.aimView();
    const left = v.x - (v.viewH * c.aspect) / 2;
    expect(v.viewH).toBeCloseTo(c.userAimViewH ?? 0, 9);
    expect(c.level.slingX - left).toBeCloseTo(c.aimLeftRoom(v.viewH), 6);
  });
});

describe('Camera: перелёт flyTo', () => {
  it('завершается ровно за duration, по пути — easeInOutCubic', () => {
    const c = cam();
    const from = { x: c.x, y: c.y, viewH: c.viewH };
    const to = c.castleView();
    c.flyTo(to.x, to.y, to.viewH, 1.0);
    expect(c.animating).toBe(true);
    for (let i = 0; i < 30; i++) c.update(1 / 60);
    // половина времени easeInOutCubic = половина пути
    expect(c.x).toBeCloseTo((from.x + to.x) / 2, 6);
    expect(c.animating).toBe(true);
    for (let i = 0; i < 29; i++) c.update(1 / 60);
    expect(c.animating).toBe(true);
    c.update(1 / 60);
    expect(c.animating).toBe(false);
    expect(c.x).toBeCloseTo(to.x, 9);
    expect(c.y).toBeCloseTo(to.y, 9);
    expect(c.viewH).toBeCloseTo(to.viewH, 9);
  });

  it('цель вне границ ограничивается; duration 0 — мгновенно; ручной пан прерывает перелёт', () => {
    const c = cam();
    c.flyTo(500, -50, 3, 0);
    expect(c.animating).toBe(false);
    expect(c.viewH).toBe(9);
    expect(bottomOf(c)).toBeCloseTo(-1.2, 9);
    expect(c.x + c.viewW / 2).toBeCloseTo(48, 9);
    c.flyToPose(c.aimView(), 0.5);
    c.update(0.1);
    c.panBy(10, 0);
    expect(c.animating).toBe(false);
  });

  it('возврат к рогатке: T = clamp(0.5 + dist/45, 0.6, 1.4)', () => {
    const c = cam();
    expect(c.returnTime()).toBeCloseTo(0.6, 9);
    c.jumpTo({ x: 30, y: c.y, viewH: c.viewH });
    const d = Math.abs(c.x - c.aimView().x);
    expect(c.returnTime()).toBeCloseTo(Math.min(1.4, Math.max(0.6, 0.5 + d / 45)), 9);
  });

  it('toggleOverview переключает общий план ↔ рогатку', () => {
    const c = cam();
    expect(c.toggleOverview()).toBe('overview');
    for (let i = 0; i < 40; i++) c.update(1 / 60);
    expect(c.viewH).toBeCloseTo(c.overview().viewH, 6);
    expect(c.toggleOverview()).toBe('aim');
    c.update(0.1);
    expect(c.toggleOverview()).toBe('overview'); // во время перелёта — по цели перелёта
  });

  it('интро: длительность панорамы', () => {
    const c = cam();
    expect(c.introPanTime(false)).toBe(1.8);
    expect(c.introPanTime(true)).toBe(0.8);
    const long = cam(hutLevel({ bounds: { minX: -12, maxX: 70, maxY: 25 } }));
    expect(long.introPanTime(false)).toBe(2.3);
  });
});

describe('Camera: следование', () => {
  it('сходится к птице с упреждением; птица в полосе 25–65 %; зум не ближе вида рогатки', () => {
    const c = cam();
    const target = { x: 22, y: 6, vx: 10, vy: 0 };
    for (let i = 0; i < 300; i++) c.follow(target, 1 / 60);
    expect(c.x).toBeCloseTo(22 + 3.5, 3); // упреждение 0.35·vx
    expect(c.viewH).toBeCloseTo(c.aimViewH, 3);
    expect(bottomOf(c)).toBeCloseTo(-1.2, 9);
    const f = 0.5 + (target.x - c.x) / c.viewW;
    expect(f).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(f).toBeLessThanOrEqual(0.65 + 1e-9);
  });

  it('высокая птица — отъезд до y + 3 м, но не выше 30 м', () => {
    const c = cam();
    for (let i = 0; i < 400; i++) c.follow({ x: 15, y: 20, vx: 0, vy: 0 }, 1 / 60);
    expect(c.viewH).toBeCloseTo(20 + 3 + 1.2, 2);
    for (let i = 0; i < 400; i++) c.follow({ x: 15, y: 40, vx: 0, vy: 0 }, 1 / 60);
    expect(c.viewH).toBeCloseTo(30, 6);
  });

  it('не зависит от частоты кадров (экспонента по dt)', () => {
    const a = cam();
    const b = cam();
    const t = { x: 20, y: 4, vx: 15, vy: 2 };
    for (let i = 0; i < 60; i++) a.follow(t, 1 / 60);
    for (let i = 0; i < 120; i++) b.follow(t, 1 / 120);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.viewH).toBeCloseTo(b.viewH, 6);
  });

  it('быстрая птица не уходит за край кадра; у края уровня — ограничения границ', () => {
    const c = cam();
    c.follow({ x: 40, y: 3, vx: 24, vy: 0 }, 1 / 60); // один кадр, далеко от камеры
    const f = 0.5 + (40 - c.x) / c.viewW;
    expect(f).toBeLessThanOrEqual(0.95 + 1e-9);
    for (let i = 0; i < 300; i++) c.follow({ x: 47, y: 3, vx: 24, vy: 0 }, 1 / 60);
    expect(c.x + c.viewW / 2).toBeCloseTo(48, 9);
  });
});

describe('Camera: следование при выстреле', () => {
  /** Баллистика птицы от рогатки; follow + update каждый кадр. */
  function shot(c: Camera, angDeg: number, frames = 150): { xs: number[]; ys: number[]; fr: number[] } {
    const a = (angDeg * Math.PI) / 180;
    let x = -1.4;
    let y = 2.0;
    const vx = 24 * Math.cos(a);
    let vy = 24 * Math.sin(a);
    const dt = 1 / 60;
    const xs: number[] = [];
    const ys: number[] = [];
    const fr: number[] = [];
    for (let i = 0; i < frames && y > 0.5; i++) {
      vy -= 15 * dt;
      x += vx * dt;
      y += vy * dt;
      c.follow({ x, y, vx, vy }, dt);
      c.update(dt);
      xs.push(c.x);
      ys.push(c.y);
      fr.push(0.5 + (x - c.x) / c.viewW);
    }
    return { xs, ys, fr };
  }

  for (const [w, h] of [[1280, 720], [844, 390], [1024, 768]]) {
    for (const ang of [20, 45, 70]) {
      it(`${w}×${h}, ${ang}°: камера не дёргается назад к рогатке, птица в кадре`, () => {
        const c = cam(hutLevel(), w, h);
        const x0 = c.x;
        const { xs, fr } = shot(c, ang);
        expect(Math.min(...xs)).toBeGreaterThanOrEqual(x0 - 1e-9);
        for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 1e-9);
        for (const f of fr) {
          expect(f).toBeGreaterThanOrEqual(0.05 - 1e-9);
          expect(f).toBeLessThanOrEqual(0.95 + 1e-9);
        }
      });
    }
  }

  it('отскок назад: при vx < 0 камера может ехать влево', () => {
    const c = cam();
    c.jumpTo({ x: 26, y: c.y, viewH: c.viewH });
    const x0 = c.x;
    for (let i = 0; i < 60; i++) c.follow({ x: 24 - i * 0.1, y: 2, vx: -6, vy: 0 }, 1 / 60);
    expect(c.x).toBeLessThan(x0 - 1);
  });

  it('нет вертикального скачка в первом кадре, если в READY игрок зумил у верхнего края или поднял камеру', () => {
    const a = cam();
    a.zoomAt(1.5, 640, 60);
    a.rememberAimZoom();
    const b = cam();
    b.panBy(0, 200);
    for (const c of [a, b]) {
      const y0 = c.y;
      const ppm0 = c.ppm;
      c.follow({ x: -1.4, y: 2, vx: 17, vy: 17 }, 1 / 60);
      const jumpPx = Math.abs(c.y - y0) * ppm0;
      expect(jumpPx).toBeLessThan(40);
      // и за ~1.5 с низ кадра доходит до земли (τ 0.18 с)
      for (let i = 0; i < 90; i++) c.follow({ x: 5, y: 6, vx: 17, vy: 0 }, 1 / 60);
      expect(bottomOf(c)).toBeCloseTo(-1.2, 2);
    }
  });
});

describe('Camera: тряска', () => {
  it('сумма вкладов ≤ 0.35 м, затухает за duration, не сдвигает саму камеру', () => {
    const c = cam();
    c.shake(0.3, 0.35);
    c.shake(0.3, 0.3);
    expect(c.shakeAmplitude).toBeCloseTo(0.35, 9);
    const x0 = c.x;
    let maxDev = 0;
    for (let i = 0; i < 12; i++) {
      const v = c.view(i / 60);
      maxDev = Math.max(maxDev, Math.abs(v.camX - c.x), Math.abs(v.camY - c.y));
      expect(Math.abs(v.shakeAngle)).toBeLessThanOrEqual((0.5 * Math.PI) / 180 + 1e-9);
      c.update(1 / 60);
    }
    expect(maxDev).toBeGreaterThan(0.05);
    expect(maxDev).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(c.x).toBe(x0);
    for (let i = 0; i < 30; i++) c.update(1 / 60);
    expect(c.shakeAmplitude).toBe(0);
    const v = c.view(1.234);
    expect(v.camX).toBe(c.x);
    expect(v.camY).toBe(c.y);
    expect(v.shakeAngle).toBe(0);
  });

  it('затухание (1 − t/T)²', () => {
    const c = cam();
    c.shake(0.2, 1);
    for (let i = 0; i < 5; i++) c.update(0.1);
    expect(c.shakeAmplitude).toBeCloseTo(0.2 * 0.25, 9);
  });

  it('выключенная тряска и пресеты взрыва/удара', () => {
    const c = cam();
    c.shakeEnabled = false;
    c.shake(0.3, 1);
    expect(c.shakeAmplitude).toBe(0);
    c.shakeEnabled = true;
    c.shakeImpact(10); // J < 20 — без тряски
    expect(c.shakeAmplitude).toBe(0);
    c.shakeImpact(80);
    expect(c.shakeAmplitude).toBeCloseTo(0.2, 9);
    const d = cam();
    d.shakeBlast(3.5);
    expect(d.shakeAmplitude).toBeCloseTo(0.35, 9);
  });
});

describe('Camera: инерция пана и клавиши', () => {
  it('fling двигает камеру против движения пальца, гаснет и не зависит от частоты кадров', () => {
    const c = cam();
    c.flyTo(16, 11, 15, 0);
    const x0 = c.x;
    c.fling(-600, 0); // палец ушёл влево → камера едет вправо
    expect(c.coasting).toBe(true);
    for (let i = 0; i < 180; i++) c.update(1 / 60);
    expect(c.coasting).toBe(false);
    const moved = c.x - x0;
    // ∫ v·exp(−t/τ) = v·τ = (600 / ppm)·0.25
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual((600 / c.ppm) * 0.25 + 1e-6);
    expect(moved).toBeGreaterThan((600 / c.ppm) * 0.25 * 0.8);
    const b = cam();
    b.flyTo(16, 11, 15, 0);
    b.fling(-600, 0);
    for (let i = 0; i < 360; i++) b.update(1 / 120);
    expect(b.x - x0).toBeCloseTo(moved, 1);
  });

  it('медленный fling не запускает инерцию; упор в границу гасит составляющую', () => {
    const c = cam();
    c.fling(1, 1);
    expect(c.coasting).toBe(false);
    c.fling(0, -5000); // камера вниз, но низ прижат
    c.update(1 / 60);
    expect(bottomOf(c)).toBeCloseTo(-1.2, 9);
    expect(c.coasting).toBe(false);
  });

  it('setKeyPan: 15 м/с', () => {
    const c = cam();
    c.flyTo(16, 11, 15, 0);
    const x0 = c.x;
    c.setKeyPan(15, 0);
    for (let i = 0; i < 6; i++) c.update(1 / 60);
    expect(c.x - x0).toBeCloseTo(1.5, 6);
    c.setKeyPan(0, 0);
    c.update(1 / 60);
    expect(c.x - x0).toBeCloseTo(1.5, 6);
  });

  it('contains: рогатка в кадре вида рогатки, за кадром после пана', () => {
    const c = cam();
    expect(c.contains(0, 2.7)).toBe(true);
    c.panBy(-5000, 0);
    expect(c.contains(0, 2.7)).toBe(false);
  });
});
