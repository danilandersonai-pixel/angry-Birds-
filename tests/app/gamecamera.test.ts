// Камера игрового экрана (адаптер GameCamera, плейтесты №1–2): весь контент в кадре вида рогатки, HUD не на
// сооружении, очередь в кадре, облёт от сооружения, прогноз апогея, общий план с рогаткой, зум у земли;
// помощники Renderer для очереди и кармашка; уровень для HUD без подсказки.

import { describe, expect, it } from 'vitest';
import { GAME_CAM, GameCamera, hudBox } from '../../src/app/GameCamera';
import { hudLevel } from '../../src/app/GameScreen';
import { BIRDS, CAMERA, LAUNCH, PIGS, SLINGSHOT, WORLD } from '../../src/config/constants';
import { ALL_LEVELS } from '../../src/levels';
import { QUEUE_K_MIN, pocketLift, queueSpan } from '../../src/render/Renderer';

const SCREENS: Array<[number, number]> = [
  [1600, 900],
  [844, 390],
  [1280, 960],
  [2340, 1080],
];

function cam(w: number, h: number, id: string): GameCamera {
  const level = ALL_LEVELS.find((l) => l.id === id)!;
  const c = new GameCamera();
  c.setViewport(w, h, 1);
  c.setLevel(level);
  return c;
}

describe('GameCamera: вид рогатки на уровнях кампании', () => {
  for (const [w, h] of SCREENS) {
    it(`${w}×${h}: весь контент в кадре (до жёсткого потолка), низ на земле, рогатка и очередь слева`, () => {
      for (const level of ALL_LEVELS) {
        const c = new GameCamera();
        c.setViewport(w, h, 1);
        c.setLevel(level);
        const a = c.aimView();
        const f = c.level;
        const vw = a.viewH * (w / h);
        const left = a.x - vw / 2;
        const right = a.x + vw / 2;
        const top = a.y + a.viewH / 2;
        const tag = `${level.id} ${w}×${h}`;
        expect(a.viewH, tag).toBeLessThanOrEqual(c.aimHardCap + 1e-6);
        expect(a.viewH, tag).toBeGreaterThanOrEqual(Math.min(GAME_CAM.AIM_H_MIN, c.aimHardCap) - 1e-6);
        // низ кадра — на земле: полоса земли groundK·h (≤ 12 %), не меньше 1.2 м
        expect(a.y - a.viewH / 2, tag).toBeCloseTo(c.bottomFor(a.viewH), 6);
        expect(c.groundRef - (a.y - a.viewH / 2), tag).toBeGreaterThanOrEqual(CAMERA.GROUND_MARGIN - 1e-9);
        expect(c.groundK, tag).toBeLessThanOrEqual(GAME_CAM.GROUND_FRAC + 1e-9);
        // контент: правый край + 1 м и верх + 0.8 м — в кадре, если на это хватает жёсткого потолка
        const atCap = a.viewH >= c.aimHardCap - 1e-6;
        if (!atCap) {
          expect(right, tag).toBeGreaterThanOrEqual(f.contentRight + GAME_CAM.RIGHT_PAD - 1e-3);
          expect(top, tag).toBeGreaterThanOrEqual(f.contentTop + GAME_CAM.TOP_PAD - 1e-3);
          for (const p of level.pigs) expect(p.x + PIGS[p.type].radius, `${tag} свинья x=${p.x}`).toBeLessThanOrEqual(right);
        }
        // рогатка: место под полную оттяжку пальцем всегда; без сдвига — 15…30 % ширины
        const room = level.slingshot.x - left;
        expect(room, tag).toBeGreaterThanOrEqual(c.aimLeftRoom(a.viewH) - 1e-6);
        if (!atCap) {
          expect(room / vw, tag).toBeGreaterThanOrEqual(GAME_CAM.SLING_X - 1e-6);
          expect(room, tag).toBeLessThanOrEqual(Math.max(GAME_CAM.SLING_X_MAX * vw, c.aimLeftRoom(a.viewH)) + 1e-6);
          // очередь в сжатой раскладке Renderer — целиком в кадре
          const x0 = level.slingshot.x - SLINGSHOT.ANCHOR.x - SLINGSHOT.QUEUE_X0;
          const { span, rLast } = queueSpan(level.birds);
          const k = span < 1e-6 ? 1 : Math.min(1, Math.max(QUEUE_K_MIN, (x0 - c.queueMinX() - rLast) / span));
          expect(x0 - k * span - rLast, tag).toBeGreaterThanOrEqual(left - 1e-6);
        }
      }
    });
  }

  it('16:9, телефон, 21:9: контент кампании в кадре на всех 30 уровнях; 4:3 — до VIEW_H_MAX (дальние уровни Б1)', () => {
    for (const [w, h] of SCREENS) {
      let cut = 0;
      for (const level of ALL_LEVELS) {
        const c = cam(w, h, level.id);
        const a = c.aimView();
        if (a.x + (a.viewH * (w / h)) / 2 < c.level.contentRight + GAME_CAM.RIGHT_PAD - 0.05) cut++;
      }
      if (w / h >= 16 / 9 - 1e-6) expect(cut, `${w}×${h}`).toBe(0);
    }
  });

  it('верх сооружения не заходит под HUD справа сверху (пока хватает запаса отдаления)', () => {
    const lv = ALL_LEVELS.find((l) => l.id === '1-1')!;
    // искусственная башня у правого края: верх 9 м
    const tower = { ...lv, blocks: [...lv.blocks, { material: 'stone' as const, shape: 'rect' as const, x: 27.5, y: 4.5, w: 1, h: 9 }] };
    for (const coarse of [false, true]) {
      const c = new GameCamera();
      c.pointerCoarse = coarse;
      c.setViewport(844, 390, 2);
      c.setLevel(tower);
      const a = c.aimView();
      const ppm = 390 / a.viewH;
      const hud = c.hud;
      const right = a.x + (a.viewH * (844 / 390)) / 2;
      const hudBottom = a.y + a.viewH / 2 - hud.h / ppm;
      // башня либо левее HUD, либо ниже его
      expect(27.5 + 0.5 <= right - hud.w / ppm || 9 <= hudBottom + 1e-6, `coarse=${coarse}`).toBe(true);
    }
    // HUD по формулам styles.css: замеры 1600×900 ≈ 209 px высоты, 844×390 (тач) ≈ 109 px
    expect(hudBox(1600, 900, false).h).toBeCloseTo(209, -1);
    expect(hudBox(844, 390, true).h).toBeCloseTo(109, -1);
  });

  it('жёсткий потолок: 28 м на 16:9 и шире, на 4:3 — та же ширина кадра (не выше VIEW_H_MAX)', () => {
    const c = new GameCamera();
    c.setViewport(1600, 900, 1);
    expect(c.aimHardCap).toBeCloseTo(GAME_CAM.AIM_H_HARD, 6);
    c.setViewport(2340, 1080, 3);
    expect(c.aimHardCap).toBeCloseTo(GAME_CAM.AIM_H_HARD, 6);
    c.setViewport(1280, 960, 1);
    expect(c.aimHardCap).toBeCloseTo(Math.min(CAMERA.VIEW_H_MAX, GAME_CAM.AIM_H_HARD * (16 / 9) / (4 / 3)), 6);
  });

  it('следование: навесной выстрел (68°, полная сила) не подходит к верху кадра ближе 2.5 м', () => {
    for (const [w, h] of [
      [1600, 900],
      [844, 390],
    ] as const) {
      const c = cam(w, h, '1-1');
      c.jumpTo(c.aimView());
      const a0 = c.level;
      const ang = (68 * Math.PI) / 180;
      let x = a0.slingX;
      let y = a0.slingY;
      let vx = LAUNCH.V_MAX * Math.cos(ang);
      let vy = LAUNCH.V_MAX * Math.sin(ang);
      let minGap = Infinity;
      for (let t = 0; t < 3 && y > 0; t += 1 / 60) {
        c.follow({ x, y, vx, vy }, 1 / 60);
        c.update(1 / 60);
        minGap = Math.min(minGap, c.y + c.viewH / 2 - y);
        x += vx / 60;
        vy -= Math.abs(WORLD.GRAVITY) / 60;
        y += vy / 60;
      }
      expect(minGap, `${w}×${h}`).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('общий план (Z) охватывает рогатку и дальний край контента — и после отдаления колесом до упора', () => {
    for (const [w, h] of SCREENS) {
      for (const id of ['1-1', '2-10', '3-10']) {
        const c = cam(w, h, id);
        const f = c.level;
        c.jumpTo(c.aimView());
        c.zoomAt(0.1, w / 2, h / 2); // колесом до упора
        c.rememberAimZoom();
        for (const p of [c.overviewTarget()]) {
          const vw = p.viewH * (w / h);
          expect(p.x - vw / 2, `${id} ${w}×${h}`).toBeLessThanOrEqual(f.slingX - c.aimLeftRoom(p.viewH) + 1e-6);
        }
        // Z из отдалённого до упора вида: куда бы ни поехали — рогатка в кадре
        c.toggleOverview(0);
        expect(c.contains(f.slingX, f.slingY), `${id} ${w}×${h} после Z`).toBe(true);
        c.toggleOverview(0);
        expect(c.contains(f.slingX, f.slingY), `${id} ${w}×${h} после Z×2`).toBe(true);
        // обычный вид рогатки → общий план → назад
        const c2 = cam(w, h, id);
        c2.jumpTo(c2.aimView());
        expect(c2.toggleOverview(0)).toBe('overview');
        expect(c2.contains(f.slingX, f.slingY)).toBe(true);
        if (c2.viewH < CAMERA.VIEW_H_MAX - 1e-6) expect(c2.x + c2.viewW / 2).toBeGreaterThanOrEqual(f.contentRight - 1e-6);
        expect(c2.toggleOverview(0)).toBe('aim');
      }
    }
  });

  it('облёт: вид сооружения охватывает его по ширине, высота — сооружение + 6 м (если не задан уровнем)', () => {
    for (const level of ALL_LEVELS) {
      if (level.camera?.castle) continue;
      const c = cam(1600, 900, level.id);
      const f = c.level;
      const v = c.castleView();
      const vw = v.viewH * (16 / 9);
      expect(v.viewH, level.id).toBeGreaterThanOrEqual(Math.min(CAMERA.VIEW_H_MAX, f.contentTop - f.groundRef + GAME_CAM.CASTLE_EXTRA_H) - 1e-6);
      if (f.contentRight - f.contentLeft + 4 <= vw) {
        expect(v.x - vw / 2, level.id).toBeLessThanOrEqual(f.contentLeft + 1e-6);
        expect(v.x + vw / 2, level.id).toBeGreaterThanOrEqual(f.contentRight - 1e-6);
      }
    }
  });

  it('зум колесом/щипком: низ кадра на земле остаётся на земле; поднятый игроком — якорь как раньше', () => {
    const c = cam(1600, 900, '1-3');
    c.jumpTo(c.aimView());
    c.zoomAt(1.5, 1200, 200);
    expect(c.y - c.viewH / 2).toBeCloseTo(c.bottomY, 6);
    c.zoomAt(0.6, 300, 800);
    expect(c.y - c.viewH / 2).toBeCloseTo(c.bottomY, 6);
    // игрок поднял камеру панорамой — зум держит точку под курсором (и по Y)
    c.panBy(0, 200);
    const b0 = c.y - c.viewH / 2;
    expect(b0).toBeGreaterThan(c.bottomY + GAME_CAM.GROUND_PIN);
    const before = c.screenToWorld(800, 300);
    c.zoomAt(1.2, 800, 300);
    const after = c.screenToWorld(800, 300);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('компактные уровни: кадр плотный — земля 12 % высоты, рогатка ровно с местом под очередь (не левее 15 %)', () => {
    for (const [w, h] of SCREENS) {
      let dense = 0;
      for (const level of ALL_LEVELS) {
        const c = cam(w, h, level.id);
        const a = c.aimView();
        const vw = a.viewH * (w / h);
        const left = a.x - vw / 2;
        const tag = `${level.id} ${w}×${h}`;
        if (Math.abs(c.groundK - GAME_CAM.GROUND_FRAC) < 1e-9) dense++;
        // очередь без сжатия влезает в 25 % — рогатка ровно на её ширине (+ запас), но не левее 15 %
        const x0 = level.slingshot.x - SLINGSHOT.ANCHOR.x - SLINGSHOT.QUEUE_X0;
        const { span, rLast } = queueSpan(level.birds);
        const natural = level.slingshot.x - (x0 - span - rLast - GAME_CAM.QUEUE_PAD);
        const room = level.slingshot.x - left;
        if (natural <= GAME_CAM.SLING_X_NATURAL * vw && room > c.aimLeftRoom(a.viewH) + 1e-6) {
          expect(room, tag).toBeCloseTo(Math.max(natural, GAME_CAM.SLING_X * vw), 4);
        }
      }
      // полоса земли сужается только ради HUD — на единичных уровнях
      expect(dense, `${w}×${h}`).toBeGreaterThanOrEqual(ALL_LEVELS.length - 3);
    }
  });

  it('16:9 и телефон: Ред не мельче 40 / 22 CSS px на всех уровнях (цели компактизации)', () => {
    for (const [w, h, min] of [
      [1600, 900, 40],
      [844, 390, 22],
      [1280, 960, 32],
    ] as const) {
      for (const level of ALL_LEVELS) {
        const c = cam(w, h, level.id);
        c.pointerCoarse = w < 1000;
        const red = (2 * BIRDS.red.radius * h) / c.aimView().viewH;
        expect(red, `${level.id} ${w}×${h}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('верх сооружения у HUD: сначала уже полоса земли (масштаб тот же), отдаление — только если этого мало', () => {
    const lv = ALL_LEVELS.find((l) => l.id === '1-1')!;
    const base = cam(1600, 900, '1-1');
    const h0 = base.aimView().viewH;
    // столбик у правого края контента, верх которого задевает HUD только при полосе земли 12 %
    const probe = (top: number): GameCamera => {
      const xr = base.level.contentRight;
      const block = { material: 'stone' as const, shape: 'rect' as const, x: xr - 0.5, y: top / 2, w: 1, h: top };
      const c = new GameCamera();
      c.setViewport(1600, 900, 1);
      c.setLevel({ ...lv, blocks: [...lv.blocks, block] });
      return c;
    };
    let found = false;
    for (let top = 6; top <= 13 && !found; top += 0.25) {
      const c = probe(top);
      const a = c.aimView();
      if (c.groundK < GAME_CAM.GROUND_FRAC - 1e-6 && c.groundK > 0) {
        found = true;
        expect(a.viewH, `top ${top}`).toBeCloseTo(h0, 3); // масштаб не изменился
        // и теперь верх столбика не под HUD
        const ppm = 900 / a.viewH;
        const hudBottom = a.y + a.viewH / 2 - (c.hud.h + GAME_CAM.HUD_PAD_PX) / ppm;
        expect(top, `top ${top}`).toBeLessThanOrEqual(hudBottom + 1e-3);
      }
    }
    expect(found).toBe(true);
  });

  it('полоса земли: viewHForTop — наименьшая высота, верх которой не ниже заданного; следование не сдвигает низ на старте', () => {
    const c = cam(1600, 900, '2-5');
    for (const top of [5, 10, 15, 20, 25]) {
      const h = c.viewHForTop(top);
      expect(c.bottomFor(h) + h).toBeGreaterThanOrEqual(top - 1e-9);
      expect(c.bottomFor(h - 0.01) + h - 0.01).toBeLessThan(top);
    }
    // выпуск: первый кадр следования — низ кадра там же, где в виде рогатки (без вертикального рывка)
    c.jumpTo(c.aimView());
    const b0 = c.y - c.viewH / 2;
    const f = c.level;
    c.follow({ x: f.slingX + 0.5, y: f.slingY + 0.3, vx: 15, vy: 4 }, 1 / 60);
    expect(Math.abs(c.y - c.viewH / 2 - b0)).toBeLessThan(0.05);
    // при отдалении в полёте полоса земли — та же доля высоты кадра
    for (let i = 0; i < 120; i++) c.follow({ x: f.slingX + 8, y: 14, vx: 10, vy: 6 }, 1 / 60);
    expect(c.viewH).toBeGreaterThan(c.aimView().viewH + 1);
    expect(c.groundRef - (c.y - c.viewH / 2)).toBeCloseTo(c.groundMarginFor(c.viewH), 2);
  });

  it('смена размера окна пересчитывает авто-вид (кэш по размеру)', () => {
    const c = cam(1600, 900, '2-10');
    const a = c.aimView().viewH;
    c.setViewport(844, 390, 2);
    expect(c.aimView().viewH).not.toBeCloseTo(a, 3);
  });
});

describe('Renderer: очередь и кармашек', () => {
  it('queueSpan повторяет раскладку ядра: max(QUEUE_DX, r_i + r_{i+1} + 0.2)', () => {
    expect(queueSpan(['red', 'red', 'red']).span).toBeCloseTo(2 * SLINGSHOT.QUEUE_DX, 9);
    const t = queueSpan(['hal', 'terence']);
    expect(t.span).toBeCloseTo(Math.max(SLINGSHOT.QUEUE_DX, BIRDS.hal.radius + BIRDS.terence.radius + 0.2), 9);
    expect(t.rLast).toBe(BIRDS.terence.radius);
    expect(queueSpan([]).span).toBe(0);
  });

  it('подъём птицы в кармашке: мелкие выше, центр не ниже верха переднего рога − 0.3 r', () => {
    expect(pocketLift(null)).toBe(0);
    expect(pocketLift('blues')).toBeGreaterThan(pocketLift('red'));
    expect(pocketLift('red')).toBeGreaterThan(pocketLift('terence'));
    for (const b of ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'] as const) {
      const centre = SLINGSHOT.ANCHOR.y + pocketLift(b);
      expect(centre, b).toBeGreaterThanOrEqual(SLINGSHOT.PRONG_FRONT.y + 0.14 - 0.3 * BIRDS[b].radius - 1e-9);
      expect(pocketLift(b), b).toBeLessThan(0.4);
    }
  });
});

describe('hudLevel', () => {
  it('убирает подсказку, не меняя исходный уровень', () => {
    const lv = ALL_LEVELS.find((l) => l.hint)!;
    const h = hudLevel(lv);
    expect(h.hint).toBeUndefined();
    expect(lv.hint).toBeTruthy();
    expect(h.id).toBe(lv.id);
    const plain = { ...lv, hint: undefined };
    expect(hudLevel(plain)).toBe(plain);
  });
});
