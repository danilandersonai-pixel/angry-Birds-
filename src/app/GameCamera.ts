// Камера игрового экрана — адаптер над render/Camera (плейтесты №1 и №2; патч для Camera.ts — в отчёте сборки).
// Вид рогатки (как в AB2) показывает сооружение целиком: правый край контента + 1 м и верх контента обязательны,
// и верх сооружения под HUD (счёт, свиньи — справа сверху) не заходит. Ближе AIM_H_MIN кадр не подходит, дальше
// жёсткого потолка (28 м на 16:9; на узких экранах — та же ширина кадра, до 30 м) не отходит; если и там не
// влезает — кадр сдвигается вправо (слева остаётся место под полную оттяжку пальцем, очередь сжимается Renderer).
// Слева в кадре — вся очередь птиц в сжатой раскладке Renderer (рогатка — до 30 % ширины).
// Облёт начинается с вида сооружения (высота сооружения + 6 м, вся его ширина), затем отъезд к рогатке.
// Следование за птицей: кадр заранее отдаляется под прогноз апогея (y + vy²/2g), отдаление быстрее приближения.
// Общий план (Z, двойной тап) всегда охватывает от очереди до дальнего края сооружения.
// Зум колесом и щипком держит низ кадра на земле, пока игрок сам не поднял камеру панорамой.

import { CAMERA, PIGS, SLINGSHOT, TNT, WORLD } from '../config/constants';
import type { BirdType, LevelDef } from '../core/types';
import { Camera, type CameraPose } from '../render/Camera';
import { QUEUE_K_PLAN, queueSpan } from '../render/Renderer';
import { computeUiScale } from '../ui/layout';

export const GAME_CAM = {
  /** Пол авто-вида рогатки, м: ближе не подходим, даже если сооружение маленькое и близко. */
  AIM_H_MIN: 12,
  /** Жёсткий потолок авто-вида на 16:9 и шире, м (на узких экранах — та же ширина кадра, не выше VIEW_H_MAX). */
  AIM_H_HARD: 28,
  /** Запас справа от контента и над ним, м. */
  RIGHT_PAD: 1,
  TOP_PAD: 0.8,
  /** Запас между низом HUD и верхом сооружения под ним, CSS px; ради этого кадр отдаляется не больше чем в K раз. */
  HUD_PAD_PX: 8,
  HUD_OVER_K: 1.35,
  /** Рогатка на экране: обычно 20 % ширины, ради очереди без сжатия — до 25 %, со сжатием — до 30 %. */
  SLING_X: 0.2,
  SLING_X_NATURAL: 0.25,
  SLING_X_MAX: 0.3,
  /** Запас слева от последней птицы очереди, м. */
  QUEUE_PAD: 0.4,
  /** Облёт: высота кадра = высота сооружения + это; по бокам сооружения — столько, м. */
  CASTLE_EXTRA_H: 6,
  CASTLE_SIDE_PAD: 2,
  /** Общий план: запас слева от очереди и справа от контента, м; не ближе вида рогатки × это. */
  OVERVIEW_PAD: 1,
  OVERVIEW_MIN_K: 1.15,
  /** Низ кадра ближе этого к земле (м) — зум держит его на земле. */
  GROUND_PIN: 0.35,
  /** Следование: запас над прогнозом апогея, м; τ отдаления, с (приближение — базовое FOLLOW_TAU_ZOOM). */
  APEX_HEADROOM: 3,
  FOLLOW_TAU_OUT: 0.15,
} as const;

const G = GAME_CAM;
const GRAV = Math.abs(WORLD.GRAVITY);
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Габарит одного тела уровня для проверки «под HUD»: правый край и верх, м. */
interface Item {
  r: number;
  t: number;
}

/**
 * Прямоугольник HUD справа сверху (счёт, рекорд, свиньи), CSS px от правого и верхнего края окна —
 * по формулам styles.css (.hud-right) при пятизначном счёте. Замер: 1600×900 → ≈250×209, 844×390 тач → ≈125×109.
 */
export function hudBox(cssW: number, cssH: number, coarse: boolean): { w: number; h: number } {
  const u = computeUiScale(cssW, cssH, coarse);
  const score = Math.max(30, 58 * u);
  const w = 20 * u + 3.1 * score;
  const h = 16 * u + 1.26 * Math.max(14, 21 * u) + 1.15 * score + Math.max(34, 48 * u) + 10 * u;
  return { w, h };
}

export class GameCamera extends Camera {
  // поля инициализируются после конструктора базы (а он уже зовёт aimView) — поэтому везде ?? / проверки
  private birds: readonly BirdType[] = [];
  private items: Item[] = [];
  /** Касание — крупнее HUD (UI: coarse ×1.15). Ставит GameScreen. */
  pointerCoarse = false;
  private memo: { key: object; w: number; h: number; c: boolean; pose: CameraPose } | null = null;

  override setLevel(level: LevelDef): void {
    this.birds = level.birds;
    const items: Item[] = [];
    for (const b of level.blocks) {
      if (b.shape === 'circle') {
        items.push({ r: b.x + b.w / 2, t: b.y + b.w / 2 });
        continue;
      }
      const a = b.angle ?? 0;
      const c = Math.abs(Math.cos(a));
      const s = Math.abs(Math.sin(a));
      items.push({ r: b.x + (b.w * c + b.h * s) / 2, t: b.y + (b.w * s + b.h * c) / 2 });
    }
    for (const p of level.pigs) {
      const r = PIGS[p.type].radius;
      items.push({ r: p.x + r, t: p.y + r });
    }
    for (const t of level.tnt ?? []) {
      const a = t.angle ?? 0;
      const e = ((t.size ?? TNT.SIZE) * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)))) / 2;
      items.push({ r: t.x + e, t: t.y + e });
    }
    this.items = items;
    this.memo = null;
    super.setLevel(level);
  }

  /** Жёсткий потолок авто-вида рогатки, м. */
  get aimHardCap(): number {
    return clamp(G.AIM_H_HARD * Math.max(1, 16 / 9 / this.aspect), CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
  }

  /** HUD справа сверху для текущего окна, CSS px. */
  get hud(): { w: number; h: number } {
    return hudBox(this.cssW, this.cssH, this.pointerCoarse === true);
  }

  override get autoAimViewH(): number {
    return this.autoPose().viewH;
  }

  override aimView(): CameraPose {
    if (this.userAimViewH === null) return this.autoPose();
    const h = clamp(this.userAimViewH, CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
    return this.poseFor(h, false);
  }

  /** Вид сооружения для облёта: level.camera.castle или вся ширина сооружения при высоте сооружения + 6 м. */
  override castleView(): CameraPose {
    const f = this.level;
    if (f.castle) return this.clampPose({ ...f.castle });
    const structH = f.contentTop - f.groundRef;
    const wNeed = f.contentRight - f.contentLeft + 2 * G.CASTLE_SIDE_PAD;
    const h = clamp(Math.max(structH + G.CASTLE_EXTRA_H, wNeed / this.aspect), CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
    return this.clampPose({ x: (f.contentLeft + f.contentRight) / 2, y: this.bottomY + h / 2, viewH: h });
  }

  /**
   * Общий план (Z, двойной тап): от очереди до дальнего края контента и верх сооружения, низ на земле;
   * не ближе вида рогатки × 1.15 (иначе переключение ничего не даёт). Рогатка в кадре всегда.
   */
  override overviewTarget(): CameraPose {
    const f = this.level;
    const aim = this.autoPose();
    const xL = Math.max(f.minX, Math.min(f.queueLeft, f.contentLeft) - G.OVERVIEW_PAD);
    const xR = Math.min(f.maxX, f.contentRight + G.OVERVIEW_PAD);
    const hFit = Math.max((xR - xL) / this.aspect, f.contentTop + G.TOP_PAD + 1 - this.bottomY);
    const h = clamp(Math.max(hFit, aim.viewH * G.OVERVIEW_MIN_K), CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
    const w = h * this.aspect;
    // по центру, но рогатка с местом под оттяжку — в кадре
    const x = Math.min((xL + xR) / 2, f.slingX - this.aimLeftRoom(h) + w / 2);
    return this.clampPose({ x, y: this.bottomY + h / 2, viewH: h });
  }

  /** Z / двойной тап. Если игрок сам отдалил вид рогатки до общего плана — «назад» ведёт в авто-вид рогатки. */
  override toggleOverview(duration?: number): 'overview' | 'aim' {
    if (this.userAimViewH !== null) {
      const ov = this.overviewTarget();
      const aim = this.aimView();
      if (Math.abs(ov.viewH - aim.viewH) < 0.12 * ov.viewH && Math.abs(ov.x - aim.x) < 0.1 * ov.viewH * this.aspect) this.userAimViewH = null;
    }
    return super.toggleOverview(duration);
  }

  /** Левая граница рисования очереди (мир, м) для Renderer: по авто-виду рогатки, от зума игрока не зависит. */
  queueMinX(): number {
    const p = this.autoPose();
    return p.x - (p.viewH * this.aspect) / 2 + 0.25;
  }

  /** Зум с якорем по X; низ кадра, стоявший на земле, остаётся на земле. */
  override zoomAt(factor: number, cssX: number, cssY: number): void {
    const pinned = Math.abs(this.y - this.viewH / 2 - this.bottomY) < G.GROUND_PIN;
    super.zoomAt(factor, cssX, cssY);
    if (pinned) this.y = this.bottomY + this.viewH / 2;
  }

  /**
   * Следование (плейтест №2, п. 5): пока птица летит вверх, высота кадра — под прогноз апогея y + vy²/2g плюс 3 м,
   * и отдаление быстрее (τ 0.15 с) — навесной выстрел не уходит за верх кадра. Остальное — базовая камера.
   */
  override follow(target: { x: number; y: number; vx: number; vy: number }, dt: number): void {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    const vy = Number.isFinite(target.vy) ? target.vy : 0;
    const apex = vy > 0 ? target.y + (vy * vy) / (2 * GRAV) : target.y;
    const yLook = Math.max(target.y, apex + G.APEX_HEADROOM - CAMERA.HEADROOM);
    const h0 = this.viewH;
    super.follow({ x: target.x, y: yLook, vx: target.vx, vy }, dt);
    const need = clamp(Math.max(this.aimViewH, yLook + CAMERA.HEADROOM - this.bottomY), CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
    if (need <= this.viewH + 1e-6) return;
    const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const fast = h0 + (need - h0) * (1 - Math.exp(-d / G.FOLLOW_TAU_OUT));
    if (fast <= this.viewH) return;
    const bottom = this.y - this.viewH / 2;
    const c = this.clampPose({ x: this.x, y: bottom + fast / 2, viewH: fast });
    // птица не уходит за край кадра по горизонтали (как в базовой камере)
    const w = c.viewH * this.aspect;
    this.viewH = c.viewH;
    this.x = clamp(c.x, target.x - 0.45 * w, target.x + 0.45 * w);
    this.y = c.y;
  }

  // ── внутреннее ──

  /** От рогатки до левого края сжатой очереди (с запасом), м; k — доля раскладки ядра. */
  private queueNeed(k: number): number {
    const birds = this.birds ?? [];
    if (birds.length === 0) return 0;
    const f = this.level;
    const x0 = f.slingX - SLINGSHOT.ANCHOR.x - SLINGSHOT.QUEUE_X0;
    const { span, rLast } = queueSpan(birds);
    return f.slingX - (x0 - k * span - rLast - G.QUEUE_PAD);
  }

  /** Сколько метров кадра слева от рогатки в виде рогатки высоты h. */
  private leftRoom(h: number): number {
    const w = h * this.aspect;
    const natural = this.queueNeed(1);
    let room: number;
    if (natural <= G.SLING_X * w) room = G.SLING_X * w;
    else if (natural <= G.SLING_X_NATURAL * w) room = natural;
    else room = clamp(this.queueNeed(QUEUE_K_PLAN), G.SLING_X * w, G.SLING_X_MAX * w);
    // место под полную оттяжку пальцем (базовая камера)
    return Math.max(room, this.aimLeftRoom(h));
  }

  /** Вид рогатки высоты h, низ на земле; shift — разрешить сдвиг вправо до места под оттяжку (очередь сожмётся). */
  private poseFor(h: number, shift: boolean): CameraPose {
    const f = this.level;
    const w = h * this.aspect;
    let room = this.leftRoom(h);
    if (shift) {
      const need = f.contentRight + G.RIGHT_PAD - f.slingX;
      if (w - room < need) room = Math.max(this.aimLeftRoom(h), w - need);
    }
    return this.clampPose({ x: f.slingX - room + w / 2, y: this.bottomY + h / 2, viewH: h });
  }

  /** Контент (правый край + 1 м, верх + 0.8 м) в кадре позы p. */
  private fitsContent(p: CameraPose): boolean {
    const f = this.level;
    const w = p.viewH * this.aspect;
    return p.x + w / 2 >= f.contentRight + G.RIGHT_PAD - 1e-6 && p.y + p.viewH / 2 >= f.contentTop + G.TOP_PAD - 1e-6;
  }

  /** Ни одно тело не заходит под HUD справа сверху (с запасом HUD_PAD_PX). */
  private clearOfHud(p: CameraPose): boolean {
    const ppm = this.cssH / p.viewH;
    const hud = this.hud;
    const xR = p.x + (p.viewH * this.aspect) / 2;
    const hudL = xR - hud.w / ppm;
    const hudB = p.y + p.viewH / 2 - (hud.h + G.HUD_PAD_PX) / ppm;
    for (const it of this.items ?? []) if (it.r > hudL && it.t > hudB) return false;
    return true;
  }

  /** Наименьшая высота в [lo, hi], для которой ok (ok монотонно по высоте); null — не выполняется и на hi. */
  private search(lo: number, hi: number, ok: (h: number) => boolean): number | null {
    if (ok(lo)) return lo;
    if (!ok(hi)) return null;
    for (let i = 0; i < 40 && hi - lo > 1e-3; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /** Авто-вид рогатки (кэш до смены уровня, размера окна или типа указателя). */
  private autoPose(): CameraPose {
    const f = this.level;
    const coarse = this.pointerCoarse === true;
    const m = this.memo;
    if (m && m.key === f && m.w === this.cssW && m.h === this.cssH && m.c === coarse) return m.pose;
    let pose: CameraPose;
    if (f.aimViewH !== null) pose = this.poseFor(clamp(f.aimViewH, CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX), false);
    else {
      const cap = this.aimHardCap;
      const lo = Math.min(G.AIM_H_MIN, cap);
      // 1) обязательно: контент целиком (до жёсткого потолка); 2) по возможности — верх сооружения не под HUD
      const h1 = this.search(lo, cap, (h) => this.fitsContent(this.poseFor(h, false)));
      if (h1 === null) pose = this.poseFor(cap, true);
      else {
        const h2 = this.search(h1, Math.min(cap, h1 * G.HUD_OVER_K), (h) => this.clearOfHud(this.poseFor(h, false)));
        pose = this.poseFor(h2 ?? h1, false);
      }
    }
    this.memo = { key: f, w: this.cssW, h: this.cssH, c: coarse, pose };
    return pose;
  }
}
