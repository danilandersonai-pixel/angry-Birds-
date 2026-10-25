// Камера игрового экрана — адаптер над render/Camera (плейтесты №1 и №2; патч для Camera.ts — в отчёте сборки).
// Вид рогатки (как в AB2) показывает сооружение целиком: правый край контента + 1 м и верх контента обязательны,
// и верх сооружения под HUD (счёт, свиньи — справа сверху) не заходит. Ближе AIM_H_MIN кадр не подходит, дальше
// жёсткого потолка (28 м на 16:9; на узких экранах — та же ширина кадра, до 30 м) не отходит; если и там не
// влезает — кадр сдвигается вправо (слева остаётся место под полную оттяжку пальцем, очередь сжимается Renderer).
// Слева в кадре — вся очередь птиц: без сжатия, если она умещается в 25 % ширины (рогатка не левее 15 %), иначе
// в сжатой раскладке Renderer (рогатка — до 30 % ширины).
// Компактные уровни (V_MAX 21, контент ≤ 25 м): кадр плотный, как в AB2 — полоса земли внизу 12 % высоты кадра
// (не меньше 1.2 м), рогатка у левого края ровно с местом под очередь. Если верх сооружения заходит под HUD,
// сначала сужается полоса земли (кадр выше, масштаб тот же), и лишь потом кадр отдаляется.
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
  /**
   * Рогатка на экране (компактные уровни, V_MAX 21): слева от неё — ровно очередь без сжатия (+ QUEUE_PAD), но не
   * меньше 15 % ширины; ради очереди без сжатия — до 25 %, дальше очередь сжимается, рогатка — до 30 %.
   * Было «всегда 20 %»: кадр шире на 5 % без пользы, персонажи мельче.
   */
  SLING_X: 0.15,
  SLING_X_NATURAL: 0.25,
  SLING_X_MAX: 0.3,
  /** Запас слева от последней птицы очереди, м. */
  QUEUE_PAD: 0.4,
  /**
   * Полоса земли внизу кадра — доля высоты кадра (как в AB2: земля ~12 %, а не 1.2 м при любом зуме), но не меньше
   * CAMERA.GROUND_MARGIN. Действует во всех автоматических видах, в следовании и как нижний предел пана.
   */
  GROUND_FRAC: 0.12,
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
  private memo: { key: object; w: number; h: number; c: boolean; pose: CameraPose; k: number } | null = null;
  /** Доля полосы земли, которую пробует подбор авто-вида (null — вне подбора: берётся из кэша авто-вида). */
  private trialK: number | null = null;

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

  /**
   * Доля полосы земли для уровня и окна: GROUND_FRAC, а если иначе верх сооружения заходит под HUD — меньше
   * (сначала поднимаем кадр, и лишь потом отдаляем). Подбирает autoPose.
   */
  get groundK(): number {
    return this.trialK ?? this.autoState().k;
  }

  /** Полоса земли внизу кадра высоты h: groundK · h, не меньше CAMERA.GROUND_MARGIN (растёт медленнее h). */
  override groundMarginFor(h: number): number {
    return Math.max(CAMERA.GROUND_MARGIN, this.groundK * h);
  }

  /** Наименьшая высота кадра с низом на bottomFor(h) и верхом не ниже top: h − max(1.2, k·h) ≥ top − земля. */
  override viewHForTop(top: number): number {
    const d = top - this.level.groundRef;
    return Math.max(d + CAMERA.GROUND_MARGIN, d / (1 - this.groundK));
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
    // над сооружением — столько же неба, сколько при низе кадра на земле − 1.2 м и высоте «сооружение + 6 м»
    const hTop = this.viewHForTop(f.contentTop + G.CASTLE_EXTRA_H - CAMERA.GROUND_MARGIN);
    const h = clamp(Math.max(structH + G.CASTLE_EXTRA_H, hTop, wNeed / this.aspect), CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
    return this.clampPose({ x: (f.contentLeft + f.contentRight) / 2, y: this.bottomFor(h) + h / 2, viewH: h });
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
    const hFit = Math.max((xR - xL) / this.aspect, this.viewHForTop(f.contentTop + G.TOP_PAD + 1));
    const h = clamp(Math.max(hFit, aim.viewH * G.OVERVIEW_MIN_K), CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
    const w = h * this.aspect;
    // по центру, но рогатка с местом под оттяжку — в кадре
    const x = Math.min((xL + xR) / 2, f.slingX - this.aimLeftRoom(h) + w / 2);
    return this.clampPose({ x, y: this.bottomFor(h) + h / 2, viewH: h });
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
    const pinned = Math.abs(this.y - this.viewH / 2 - this.bottomFor(this.viewH)) < G.GROUND_PIN;
    super.zoomAt(factor, cssX, cssY);
    if (pinned) this.y = this.bottomFor(this.viewH) + this.viewH / 2;
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
    const need = clamp(Math.max(this.aimViewH, this.viewHForTop(yLook + CAMERA.HEADROOM)), CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
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
    // очередь без сжатия (не меньше 15 % ширины), а если она длиннее 25 % — сжатая раскладка, рогатка до 30 %
    if (natural <= G.SLING_X_NATURAL * w) room = Math.max(natural, G.SLING_X * w);
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
    return this.clampPose({ x: f.slingX - room + w / 2, y: this.bottomFor(h) + h / 2, viewH: h });
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

  /** Наибольшая доля земли в [0, hi], для которой ok (ok выполняется при меньших долях); null — не выполняется и при 0. */
  private searchK(hi: number, ok: (k: number) => boolean): number | null {
    if (ok(hi)) return hi;
    if (!ok(0)) return null;
    let lo = 0;
    for (let i = 0; i < 30 && hi - lo > 1e-4; i++) {
      const mid = (lo + hi) / 2;
      if (ok(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Авто-вид рогатки. */
  private autoPose(): CameraPose {
    return this.autoState().pose;
  }

  /** Авто-вид рогатки и доля полосы земли (кэш до смены уровня, размера окна или типа указателя). */
  private autoState(): { pose: CameraPose; k: number } {
    const f = this.level;
    const coarse = this.pointerCoarse === true;
    const m = this.memo;
    if (m && m.key === f && m.w === this.cssW && m.h === this.cssH && m.c === coarse) return m;
    let r: { pose: CameraPose; k: number };
    try {
      r = this.pickAuto();
    } finally {
      this.trialK = null;
    }
    this.memo = { key: f, w: this.cssW, h: this.cssH, c: coarse, ...r };
    return r;
  }

  /**
   * Подбор авто-вида: 1) обязательно — контент целиком (до жёсткого потолка), полоса земли GROUND_FRAC (если с ней
   * верх не влезает — 1.2 м); 2) по возможности — верх сооружения не под HUD: сначала уже полоса земли (кадр выше,
   * масштаб тот же), затем отдаление не больше HUD_OVER_K и снова столько земли, сколько позволяет HUD.
   */
  private pickAuto(): { pose: CameraPose; k: number } {
    const f = this.level;
    const at = (h: number, k: number, shift = false): CameraPose => {
      this.trialK = k;
      return this.poseFor(h, shift);
    };
    if (f.aimViewH !== null) {
      const h = clamp(f.aimViewH, CAMERA.VIEW_H_MIN, CAMERA.VIEW_H_MAX);
      return { pose: at(h, G.GROUND_FRAC), k: G.GROUND_FRAC };
    }
    const cap = this.aimHardCap;
    const lo = Math.min(G.AIM_H_MIN, cap);
    let k0: number = G.GROUND_FRAC;
    let h1 = this.search(lo, cap, (h) => this.fitsContent(at(h, k0)));
    if (h1 === null) {
      k0 = 0;
      h1 = this.search(lo, cap, (h) => this.fitsContent(at(h, k0)));
    }
    if (h1 === null) return { pose: at(cap, 0, true), k: 0 };
    const hA = h1;
    if (this.clearOfHud(at(hA, k0))) return { pose: at(hA, k0), k: k0 };
    const k1 = this.searchK(k0, (k) => this.clearOfHud(at(hA, k)));
    if (k1 !== null) return { pose: at(hA, k1), k: k1 };
    const h2 = this.search(hA, Math.min(cap, hA * G.HUD_OVER_K), (h) => this.clearOfHud(at(h, 0)));
    if (h2 === null) return { pose: at(hA, k0), k: k0 }; // HUD не обойти: оставляем кадр с землёй
    const k2 = this.searchK(k0, (k) => this.clearOfHud(at(h2, k))) ?? 0;
    return { pose: at(h2, k2), k: k2 };
  }
}
