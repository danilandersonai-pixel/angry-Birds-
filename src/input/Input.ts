// Ввод игры: указатель/тач/колесо на canvas и клавиатура → команды сессии и камеры.
// Прицел (захват птицы, оттяжка с усилением на тач-экране, выстрел/отмена), способность по pointerdown,
// пан с инерцией, щипок, колесо, двойной тап, клавиши. Решения жестов — в ./gestures (чистые функции).
// Указатель слушаем только на canvas: HUD и экраны DOM лежат поверх и событий сюда не пропускают.
// Контракт с GameScreen: вне экрана игры session() = null или blocked() = true — иначе стрелки, Z, ± и Пробел
// уходят игре (кроме событий на кнопке/ссылке в фокусе). На смене уровня и рестарте — reset(); каждый кадр — update().

import type { GameSession } from '../core/api';
import type { SessionState } from '../core/events';
import type { Vec } from '../core/types';
import type { Camera } from '../render/Camera';
import {
  aimPoint,
  classifyDown,
  GESTURE,
  isDoubleTap,
  isEditableTarget,
  isInteractiveTarget,
  isTap,
  keyCommand,
  keyPanVelocity,
  passedThreshold,
  pinchStep,
  VelocityTracker,
  wheelToCamera,
  withinGrabPx,
  type ArrowKey,
  type GestureKind,
  type TapSample,
} from './gestures';

export interface InputHandlers {
  /** Текущая сессия (null — уровня нет, ввод игнорируется). */
  session(): GameSession | null;
  /** Ввод в игру заблокирован (интро, баннер, бонус, пауза, результаты): нажатия идут в onSkipIntro. */
  blocked(): boolean;
  /** Esc (не в прицеле) / P — только при pauseRestartKeys: true. */
  onPause(): void;
  /** R — только при pauseRestartKeys: true. */
  onRestart(): void;
  /**
   * Игрок сам двинул камеру (пан, щипок, колесо, стрелки, +/−) — автоследование до конца хода выключить.
   * Вызывается только если поза камеры действительно изменилась (зум на пределе, тап двумя пальцами — нет).
   */
  onUserCamera(): void;
  /** Любое нажатие / Пробел / Enter при blocked() — пропустить интро, баннер, бонус. */
  onSkipIntro(): void;
  /** Z / двойной тап — общий план ↔ рогатка. */
  onToggleOverview(): void;
  /**
   * Способность летящей птицы ещё может сработать (до первого контакта; у Бомба — до взрыва).
   * true — нажатие в полёте сразу вызывает activateAbility(). false — нажатие ядро не трогает: тап (без пана)
   * на отпускании вызывает activateAbility() — это «быстрый пропуск»; пан — просто пан, птица остаётся.
   * Нет обработчика — по focusBird(): способность не израсходована и птица ещё не касалась (поза fly/aim) либо это Бомб.
   */
  abilityReady?(): boolean;
}

export interface InputOptions {
  /** Цель для keydown/keyup/blur (по умолчанию window). */
  keyTarget?: EventTarget | null;
  /** Документ для visibilitychange (по умолчанию document). */
  doc?: (EventTarget & { readonly visibilityState?: string }) | null;
  /** Слушать клавиатуру (по умолчанию да). */
  keyboard?: boolean;
  /**
   * Esc (вне прицела), P и R обрабатывает контроллер → onPause/onRestart (по умолчанию нет).
   * false — эти клавиши остаются UI (у него свой обработчик на window, с проверками переходов и диалогов);
   * контроллер лишь отменяет прицел: Esc в прицеле поглощается (без паузы), P и R отменяют прицел и уходят в UI.
   */
  pauseRestartKeys?: boolean;
}

interface Ptr {
  id: number;
  type: string;
  x: number;
  y: number;
  x0: number;
  y0: number;
  t0: number;
  /** Нажатие сработало как способность — в двойной тап не считается. */
  ability: boolean;
  /** Нажатие в полёте, когда способность уже не сработает: тап на отпускании → activateAbility() (быстрый пропуск). */
  skipOnTap: boolean;
  downState: SessionState | null;
}

interface AimGesture {
  session: GameSession;
  id: number;
  /** Опорная точка: кармашек в момент захвата (или виртуальная точка после смены зума). */
  pocket0: Vec;
  grabX: number;
  grabY: number;
  /** Масштаб, при котором взята опора (смена зума — переопора без рывка). */
  ppm: number;
  /** Последняя точка, отданная в updateAim (без ограничений ядра). */
  last: Vec;
  /** Минимальный масштаб хода (px/м): у мыши 0 — птица идёт за курсором 1:1; у пальца и пера — AIM_MIN_PX_PER_M. */
  minPpm: number;
}

/** Поза камеры для сравнения «сдвинулась ли». */
interface PoseSnap {
  x: number;
  y: number;
  h: number;
}

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

type PointerLike = { pointerId: number; clientX: number; clientY: number; timeStamp: number; pointerType: string; button: number };

/** Кэш getBoundingClientRect для колеса: столько мс (указатель обновляет его на каждом pointerdown). */
const RECT_TTL_MS = 250;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class InputController {
  private readonly pts = new Map<number, Ptr>();
  private g: GestureKind = 'none';
  private aim: AimGesture | null = null;
  private panId = -1;
  private pinchIds: [number, number] | null = null;
  private readonly vel = new VelocityTracker();
  private lastTap: TapSample | null = null;
  private readonly held = new Set<ArrowKey>();
  private shift = false;
  private readonly keyTarget: EventTarget | null;
  private readonly doc: (EventTarget & { readonly visibilityState?: string }) | null;
  private readonly savedStyle: Record<string, string> = {};
  private readonly pauseRestartKeys: boolean;
  private disposed = false;
  /** В текущем жесте уже сообщили onUserCamera. */
  private camReported = false;
  private wasBlocked = false;
  private rect: RectLike | null = null;
  private rectT = -Infinity;
  private rectW = 0;
  private rectH = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: Camera,
    private readonly h: InputHandlers,
    opts: InputOptions = {},
  ) {
    const g = globalThis as { window?: EventTarget; document?: EventTarget & { visibilityState?: string } };
    this.keyTarget = opts.keyboard === false ? null : opts.keyTarget !== undefined ? opts.keyTarget : (g.window ?? null);
    this.doc = opts.doc !== undefined ? opts.doc : (g.document ?? null);
    this.pauseRestartKeys = opts.pauseRestartKeys === true;

    const c = canvas;
    c.addEventListener('pointerdown', this.onDown as EventListener);
    c.addEventListener('pointermove', this.onMove as EventListener);
    c.addEventListener('pointerup', this.onUp as EventListener);
    c.addEventListener('pointercancel', this.onCancel as EventListener);
    c.addEventListener('lostpointercapture', this.onLostCapture as EventListener);
    c.addEventListener('wheel', this.onWheel as EventListener, { passive: false });
    for (const type of ['contextmenu', 'selectstart', 'dragstart', 'gesturestart', 'gesturechange', 'gestureend']) {
      c.addEventListener(type, this.prevent);
    }
    if (this.keyTarget) {
      // capture: раньше обработчика UI на window — Esc в прицеле должен отменять прицел, а не ставить паузу
      this.keyTarget.addEventListener('keydown', this.onKeyDown as EventListener, { capture: true });
      this.keyTarget.addEventListener('keyup', this.onKeyUp as EventListener, { capture: true });
      this.keyTarget.addEventListener('blur', this.onBlur);
    }
    this.doc?.addEventListener('visibilitychange', this.onVisibility);

    // canvas: без жестов браузера, выделения и выноски iOS
    const st = (c as unknown as { style?: Record<string, string> }).style;
    if (st) {
      for (const [k, v] of Object.entries({
        touchAction: 'none',
        userSelect: 'none',
        webkitUserSelect: 'none',
        webkitTouchCallout: 'none',
        webkitTapHighlightColor: 'transparent',
      })) {
        this.savedStyle[k] = st[k] ?? '';
        st[k] = v;
      }
    }
  }

  /** Текущий жест (для отладки и тестов). */
  get gesture(): GestureKind {
    return this.g;
  }

  /**
   * Сбросить ввод: оборвать жесты (прицел текущей сессии — отменить), отпустить стрелки, забыть тап.
   * GameScreen зовёт на смене уровня и рестарте, при входе в интро, паузу, баннер и результаты.
   */
  reset(): void {
    this.abortGestures(true);
    this.stopKeys();
    this.lastTap = null;
  }

  /**
   * Раз в кадр (по желанию GameScreen): при входе в blocked() — интро, пауза, баннер, бонус — отпускает зажатые
   * стрелки и обрывает жесты (прицел отменяется), даже если игрок не шевелит пальцем и не жмёт клавиш.
   */
  update(): void {
    const b = this.h.session() !== null && this.h.blocked();
    if (b && !this.wasBlocked) {
      this.abortGestures(true);
      this.stopKeys();
    }
    this.wasBlocked = b;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortGestures(false);
    this.stopKeys();
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown as EventListener);
    c.removeEventListener('pointermove', this.onMove as EventListener);
    c.removeEventListener('pointerup', this.onUp as EventListener);
    c.removeEventListener('pointercancel', this.onCancel as EventListener);
    c.removeEventListener('lostpointercapture', this.onLostCapture as EventListener);
    c.removeEventListener('wheel', this.onWheel as EventListener);
    for (const type of ['contextmenu', 'selectstart', 'dragstart', 'gesturestart', 'gesturechange', 'gestureend']) {
      c.removeEventListener(type, this.prevent);
    }
    if (this.keyTarget) {
      this.keyTarget.removeEventListener('keydown', this.onKeyDown as EventListener, { capture: true });
      this.keyTarget.removeEventListener('keyup', this.onKeyUp as EventListener, { capture: true });
      this.keyTarget.removeEventListener('blur', this.onBlur);
    }
    this.doc?.removeEventListener('visibilitychange', this.onVisibility);
    const st = (c as unknown as { style?: Record<string, string> }).style;
    if (st) for (const [k, v] of Object.entries(this.savedStyle)) st[k] = v;
  }

  // ── Указатель ─────────────────────────────────────────────────

  private readonly onDown = (e: PointerEvent): void => {
    const s = this.h.session();
    this.dropStale(e);
    const p = this.local(e, true);
    const blocked = s !== null && this.h.blocked();
    const state = s ? s.state : null;
    if (blocked) this.stopKeys();
    let canGrab = false;
    if (s && !blocked && state === 'ready' && e.button === 0 && this.g === 'none') canGrab = this.grabbable(s, p);
    const action = classifyDown({
      hasSession: s !== null,
      blocked,
      state,
      gesture: this.g,
      activePointers: this.pts.size,
      pointerType: e.pointerType,
      button: e.button,
      canGrab,
    });
    if (action === 'ignore') return;
    if (action === 'skip') {
      this.h.onSkipIntro();
      return;
    }
    if (e.button === 1) e.preventDefault(); // без автопрокрутки средней кнопкой
    this.camera.stopInertia(); // палец «ловит» камеру
    const t = this.stamp(e);
    const ptr: Ptr = {
      id: e.pointerId,
      type: e.pointerType,
      x: p.x,
      y: p.y,
      x0: p.x,
      y0: p.y,
      t0: t,
      ability: false,
      skipOnTap: false,
      downState: state,
    };

    if (action === 'pinch') {
      const other = this.pts.values().next().value as Ptr | undefined;
      this.pts.set(ptr.id, ptr);
      this.capture(ptr.id);
      if (!other) return;
      this.g = 'pinch';
      this.pinchIds = [other.id, ptr.id];
      // onUserCamera — с первым реальным сдвигом камеры (тап двумя пальцами автоследование не выключает)
      this.camReported = false;
      return;
    }

    if (action === 'aim' && s && this.startAim(s, ptr, p)) {
      this.pts.set(ptr.id, ptr);
      this.capture(ptr.id);
      return;
    }

    if (action === 'ability' && s) {
      if (this.abilityReady(s)) {
        s.activateAbility(); // окно 0.05 с после выпуска — забота ядра
        ptr.ability = true;
      } else ptr.skipOnTap = true; // после удара: пан не должен убирать птицу (01 §5.2) — пропуск только тапом
    }
    this.pts.set(ptr.id, ptr);
    this.capture(ptr.id);
    this.g = 'pending';
    this.panId = ptr.id;
    this.camReported = false;
    this.vel.clear();
    this.vel.add(t, p.x, p.y);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const ptr = this.pts.get(e.pointerId);
    if (!ptr) return;
    if (this.h.blocked() || this.h.session() === null) {
      // во время жеста открылась пауза / баннер / уровень закрыт — жест обрывается
      this.abortGestures(true);
      this.stopKeys();
      return;
    }
    const p = this.local(e);
    const px = ptr.x;
    const py = ptr.y;
    ptr.x = p.x;
    ptr.y = p.y;
    const t = this.stamp(e);
    switch (this.g) {
      case 'aim':
        if (this.aim && this.aim.id === ptr.id) this.moveAim(px, py, p);
        return;
      case 'pending':
        if (ptr.id !== this.panId) return;
        if (passedThreshold(ptr.x0, ptr.y0, p.x, p.y)) {
          this.g = 'pan';
          // мир сдвигается на весь ход от точки нажатия: точка под пальцем остаётся под пальцем
          const before = this.snap();
          this.camera.panBy(p.x - ptr.x0, p.y - ptr.y0);
          this.reportCamera(before);
          this.vel.add(t, p.x, p.y);
        }
        return;
      case 'pan': {
        if (ptr.id !== this.panId) return;
        const before = this.snap();
        this.camera.panBy(p.x - px, p.y - py);
        this.reportCamera(before);
        this.vel.add(t, p.x, p.y);
        return;
      }
      case 'pinch': {
        const ids = this.pinchIds;
        if (!ids || (ids[0] !== ptr.id && ids[1] !== ptr.id)) return;
        const other = this.pts.get(ids[0] === ptr.id ? ids[1] : ids[0]);
        if (!other) return;
        const st = pinchStep({ x: px, y: py }, other, p, other);
        const before = this.snap();
        if (st.factor !== 1) {
          this.camera.zoomAt(st.factor, st.anchorX, st.anchorY);
          this.rememberZoomIfAiming();
        }
        if (st.dx !== 0 || st.dy !== 0) this.camera.panBy(st.dx, st.dy);
        this.reportCamera(before);
        return;
      }
      default:
        return;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const ptr = this.pts.get(e.pointerId);
    if (!ptr) return;
    const p = this.local(e);
    const t = this.stamp(e);
    this.pts.delete(ptr.id);
    this.releaseCapture(ptr.id);
    switch (this.g) {
      case 'aim': {
        const a = this.aim;
        if (!a || a.id !== ptr.id) return;
        this.g = 'none';
        this.aim = null;
        const s = this.h.session();
        if (s !== a.session || s.state !== 'aiming') return;
        if (this.h.blocked()) {
          // пауза (P, кнопка HUD вторым пальцем) или баннер открылись посреди прицела — выстрела нет
          s.cancelAim();
          return;
        }
        // последняя точка (если отпустили не там, где был последний move) — через ту же переопору по зуму
        if (p.x !== ptr.x || p.y !== ptr.y) {
          this.reanchor(a, ptr.x, ptr.y);
          this.moveAimWith(a, p);
        }
        s.release();
        return;
      }
      case 'pending': {
        if (ptr.id !== this.panId) return;
        this.g = 'none';
        this.panId = -1;
        const up = { t, x: p.x, y: p.y };
        const tap = isTap({ t: ptr.t0, x: ptr.x0, y: ptr.y0 }, up);
        if (tap && ptr.skipOnTap) {
          const s = this.h.session();
          if (s && s.state === 'flying' && !this.h.blocked()) s.activateAbility(); // быстрый пропуск — решает ядро
        }
        if (!tap || ptr.ability || ptr.downState === 'flying') {
          this.lastTap = null;
          return;
        }
        if (isDoubleTap(this.lastTap, up)) {
          this.lastTap = null;
          this.h.onToggleOverview();
        } else this.lastTap = up;
        return;
      }
      case 'pan': {
        if (ptr.id !== this.panId) return;
        this.g = 'none';
        this.panId = -1;
        const v = this.vel.velocity(t);
        this.camera.fling(v.vx, v.vy);
        this.lastTap = null;
        return;
      }
      case 'pinch':
        this.endPinch(ptr.id, t);
        return;
      default:
        return;
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    const ptr = this.pts.get(e.pointerId);
    if (!ptr) return;
    this.pts.delete(ptr.id);
    this.releaseCapture(ptr.id);
    this.cancelPointer(ptr.id, this.stamp(e));
  };

  /**
   * Захват потерян без pointerup (элемент убрали, система забрала палец) — как отмена, для любого жеста:
   * иначе «мёртвый» указатель остаётся в pts, и каждое новое касание считается вторым пальцем щипка.
   * После обычного pointerup указатель уже удалён — событие игнорируется.
   */
  private readonly onLostCapture = (e: PointerEvent): void => {
    if (!this.pts.has(e.pointerId)) return;
    this.pts.delete(e.pointerId);
    this.cancelPointer(e.pointerId, this.stamp(e));
  };

  /**
   * Новое основное нажатие (isPrimary) значит, что прежние указатели того же типа уже не нажаты: их pointerup
   * потерялся. Убираем такие записи (и запись с тем же pointerId), чтобы нажатие не стало «вторым пальцем».
   */
  private dropStale(e: PointerEvent): void {
    if (this.pts.size === 0) return;
    const primary = (e as { isPrimary?: boolean }).isPrimary === true;
    for (const ptr of [...this.pts.values()]) {
      if (ptr.id !== e.pointerId && !(primary && ptr.type === e.pointerType)) continue;
      this.pts.delete(ptr.id);
      this.releaseCapture(ptr.id);
      this.cancelPointer(ptr.id, this.stamp(e));
    }
  }

  private cancelPointer(id: number, t: number): void {
    switch (this.g) {
      case 'aim':
        if (this.aim && this.aim.id === id) {
          const a = this.aim;
          this.g = 'none';
          this.aim = null;
          if (this.h.session() === a.session) a.session.cancelAim();
        }
        return;
      case 'pending':
      case 'pan':
        if (id === this.panId) {
          this.g = 'none';
          this.panId = -1;
        }
        return;
      case 'pinch':
        this.endPinch(id, t);
        return;
      default:
        return;
    }
  }

  /** Один палец щипка поднят: оставшийся продолжает пан без порога. */
  private endPinch(id: number, t: number): void {
    const ids = this.pinchIds;
    this.pinchIds = null;
    const restId = ids ? (ids[0] === id ? ids[1] : ids[0]) : -1;
    const rest = this.pts.get(restId);
    if (rest) {
      this.g = 'pan';
      this.panId = rest.id;
      this.vel.clear();
      this.vel.add(t, rest.x, rest.y);
    } else {
      this.g = 'none';
      this.panId = -1;
    }
    this.lastTap = null;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // иначе Ctrl+колесо масштабирует страницу
    const s = this.h.session();
    if (!s) return;
    if (this.h.blocked()) {
      this.stopKeys();
      this.h.onSkipIntro();
      return;
    }
    const p = this.local(e);
    const r = wheelToCamera(e.deltaX, e.deltaY, e.deltaMode, e.ctrlKey, this.camera.cssH);
    const before = this.snap();
    if (r.zoom !== 1) {
      this.camera.zoomAt(r.zoom, p.x, p.y);
      this.rememberZoomIfAiming();
    }
    if (r.panX !== 0 && this.g !== 'aim') this.camera.panBy(r.panX, 0);
    if (this.moved(before)) this.h.onUserCamera();
  };

  // ── Прицел ───────────────────────────────────────────────────

  /** Нажатие в зоне захвата: радиус ядра в метрах или 44 CSS px от центра птицы. */
  private grabbable(s: GameSession, p: { x: number; y: number }): boolean {
    const w = this.camera.screenToWorld(p.x, p.y);
    if (s.canGrab(w)) return true;
    const pocket = s.slingshot().pocket;
    const bp = this.camera.worldToScreen(pocket.x, pocket.y);
    return withinGrabPx(p.x, p.y, bp.x, bp.y) && s.canGrab(pocket);
  }

  /** Сработает ли способность по нажатию сейчас (см. InputHandlers.abilityReady). */
  private abilityReady(s: GameSession): boolean {
    if (this.h.abilityReady) return this.h.abilityReady();
    const f = typeof s.focusBird === 'function' ? s.focusBird() : null;
    if (!f) return true; // нечего проверять — пусть решает ядро
    if (f.abilityUsed === true) return false;
    if (f.birdType === 'bomb') return true; // Бомб взрывается и после удара
    // fly — ещё не касалась; aim — хмурится (у Теренса нет способности, нажатие безвредно); hurt/idle — уже был удар
    return f.birdPose === undefined || f.birdPose === 'fly' || f.birdPose === 'aim';
  }

  private startAim(s: GameSession, ptr: Ptr, p: { x: number; y: number }): boolean {
    s.beginAim();
    if (s.state !== 'aiming') return false;
    const pk = s.slingshot().pocket;
    const pocket0 = { x: pk.x, y: pk.y };
    // первая точка = кармашек: смещение захвата нулевое, птица не прыгает под палец
    s.updateAim(pocket0);
    const minPpm = ptr.type === 'mouse' ? 0 : GESTURE.AIM_MIN_PX_PER_M;
    this.aim = { session: s, id: ptr.id, pocket0, grabX: p.x, grabY: p.y, ppm: this.camera.ppm, last: pocket0, minPpm };
    this.g = 'aim';
    this.stopKeys();
    this.camera.stopInertia();
    return true;
  }

  /** Конец прицела без выстрела (Esc, P, R): жест закончен — отпускание пальца уже ничего не делает. */
  private endAim(s: GameSession): void {
    if (this.g === 'aim') {
      this.g = 'none';
      this.aim = null;
    }
    if (s.state === 'aiming') s.cancelAim();
  }

  private moveAim(prevX: number, prevY: number, p: { x: number; y: number }): void {
    const a = this.aim;
    if (!a) return;
    const s = this.h.session();
    if (s !== a.session || s.state !== 'aiming') {
      // сессию сменили (рестарт) или ядро вышло из прицела (победа, пауза) — жест закончен
      this.g = 'none';
      this.aim = null;
      return;
    }
    this.reanchor(a, prevX, prevY);
    this.moveAimWith(a, p);
  }

  /** Зум во время прицела: переопора от последней точки, чтобы птица не дёрнулась. */
  private reanchor(a: AimGesture, prevX: number, prevY: number): void {
    const ppm = this.camera.ppm;
    if (Math.abs(ppm - a.ppm) > 1e-9) {
      a.pocket0 = a.last;
      a.grabX = prevX;
      a.grabY = prevY;
      a.ppm = ppm;
    }
  }

  private moveAimWith(a: AimGesture, p: { x: number; y: number }): void {
    const w = aimPoint(a.pocket0, a.grabX, a.grabY, p.x, p.y, a.ppm, a.minPpm);
    a.last = w;
    a.session.updateAim(w);
  }

  private rememberZoomIfAiming(): void {
    const st = this.h.session()?.state;
    if (st === 'ready' || st === 'aiming') this.camera.rememberAimZoom();
  }

  // ── Клавиатура ───────────────────────────────────────────────

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') {
      this.shift = true;
      this.applyKeyPan();
      return;
    }
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target)) return;
    const s = this.h.session();
    if (!s) return;
    const cmd = keyCommand(e.code, e.key);
    if (!cmd) return;
    const interactive = isInteractiveTarget(e.target);
    if (this.h.blocked()) {
      // интро / баннер / бонус: Пробел и Enter пропускают. Событие не поглощаем — дальше его видит UI
      // (экран результатов, пауза и диалоги сами обрабатывают Пробел/Enter/Esc/R). Зажатые стрелки отпускаем.
      this.stopKeys();
      if (cmd.kind === 'ability' && !interactive && !e.repeat) this.h.onSkipIntro();
      return;
    }
    switch (cmd.kind) {
      case 'escape':
        if (s.state === 'aiming') {
          // Esc в прицеле — только отмена (07 §16.2), пауза — следующим нажатием
          e.preventDefault();
          if (!e.repeat) this.endAim(s);
          return;
        }
        if (!this.pauseRestartKeys) return;
        e.preventDefault();
        if (!e.repeat) this.h.onPause();
        return;
      case 'pause':
        // пауза из прицела отменяет прицел (00 §1.13): иначе отпускание пальца на паузе стреляет
        if (s.state === 'aiming' && !e.repeat) this.endAim(s);
        if (!this.pauseRestartKeys) return;
        e.preventDefault();
        if (!e.repeat) this.h.onPause();
        return;
      case 'restart':
        if (s.state === 'aiming' && !e.repeat) this.endAim(s);
        if (!this.pauseRestartKeys) return; // рестарт сделает UI; жесты новой сессии не касаются старой (проверка session)
        e.preventDefault();
        if (e.repeat) return;
        this.abortGestures(false);
        this.h.onRestart();
        return;
      case 'ability':
        if (interactive) return; // кнопка в фокусе сама обработает Пробел/Enter
        e.preventDefault();
        if (!e.repeat && s.state === 'flying') s.activateAbility();
        return;
      case 'overview':
        if (interactive) return;
        e.preventDefault();
        if (!e.repeat) this.h.onToggleOverview();
        return;
      case 'zoom': {
        if (interactive) return;
        e.preventDefault();
        const before = this.snap();
        this.camera.zoomAt(cmd.factor, this.camera.cssW / 2, this.camera.cssH / 2);
        this.rememberZoomIfAiming();
        if (this.moved(before)) this.h.onUserCamera();
        return;
      }
      case 'pan':
        if (interactive) return; // стрелки по кнопкам/спискам — навигация UI
        e.preventDefault();
        if (this.g === 'aim' || s.state === 'aiming') return; // в прицеле стрелки не двигают камеру
        this.shift = e.shiftKey;
        if (!this.held.has(cmd.key)) {
          this.held.add(cmd.key);
          if (this.canPan(cmd.key)) this.h.onUserCamera();
        }
        // и на повторах: камера могла сбросить пан (setLevel) при зажатой клавише
        this.applyKeyPan();
        return;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') {
      this.shift = false;
      this.applyKeyPan();
      return;
    }
    const cmd = keyCommand(e.code, e.key);
    if (cmd?.kind === 'pan' && this.held.delete(cmd.key)) this.applyKeyPan();
  };

  /** Пан стрелками; setKeyPan — только при изменении скорости (иначе повторы клавиши сбивали бы перелёты камеры). */
  private applyKeyPan(): void {
    const v = keyPanVelocity(this.held, this.shift);
    const cur = this.camera.keyPan;
    if (cur.vx !== v.vx || cur.vy !== v.vy) this.camera.setKeyPan(v.vx, v.vy);
  }

  /** Камера может сдвинуться по стрелке (не упёрлась в границу). */
  private canPan(key: ArrowKey): boolean {
    const c = this.camera;
    const d = 1e-3;
    const dx = key === 'ArrowRight' ? d : key === 'ArrowLeft' ? -d : 0;
    const dy = key === 'ArrowUp' ? d : key === 'ArrowDown' ? -d : 0;
    const q = c.clampPose({ x: c.x + dx, y: c.y + dy, viewH: c.viewH });
    return Math.abs(q.x - c.x) > 1e-9 || Math.abs(q.y - c.y) > 1e-9;
  }

  /** Отпустить все стрелки и остановить пан с клавиатуры. */
  private stopKeys(): void {
    if (this.held.size > 0) this.held.clear();
    const cur = this.camera.keyPan;
    if (cur.vx !== 0 || cur.vy !== 0) this.camera.setKeyPan(0, 0);
  }

  // ── Потеря фокуса ────────────────────────────────────────────

  private readonly onBlur = (): void => {
    this.abortGestures(true);
    this.stopKeys();
    this.shift = false;
  };

  private readonly onVisibility = (): void => {
    if (this.doc?.visibilityState === 'hidden') this.onBlur();
  };

  /** Оборвать все жесты; cancelAim — отменить и прицел в ядре. */
  private abortGestures(cancelAim: boolean): void {
    const a = this.aim;
    if (cancelAim && this.g === 'aim' && a && this.h.session() === a.session && a.session.state === 'aiming') a.session.cancelAim();
    for (const id of this.pts.keys()) this.releaseCapture(id);
    this.pts.clear();
    this.g = 'none';
    this.aim = null;
    this.panId = -1;
    this.pinchIds = null;
    this.vel.clear();
  }

  // ── Камера: «игрок сам двинул» ───────────────────────────────

  private snap(): PoseSnap {
    const c = this.camera;
    return { x: c.x, y: c.y, h: c.viewH };
  }

  private moved(b: PoseSnap): boolean {
    const c = this.camera;
    return Math.abs(c.x - b.x) > 1e-9 || Math.abs(c.y - b.y) > 1e-9 || Math.abs(c.viewH - b.h) > 1e-9;
  }

  /** Жест пана/щипка: onUserCamera один раз за жест — с первым реальным сдвигом камеры. */
  private reportCamera(b: PoseSnap): void {
    if (this.camReported || !this.moved(b)) return;
    this.camReported = true;
    this.h.onUserCamera();
  }

  // ── Вспомогательное ──────────────────────────────────────────

  private readonly prevent = (e: Event): void => {
    e.preventDefault();
  };

  /**
   * clientX/Y → CSS-пиксели холста в системе камеры (с учётом положения и CSS-масштаба холста).
   * getBoundingClientRect — на нажатии (fresh), при смене размера камеры и для колеса раз в RECT_TTL_MS:
   * на каждом pointermove он заставлял бы браузер пересчитывать раскладку после обновлений HUD.
   */
  private local(e: { clientX: number; clientY: number; timeStamp?: number }, fresh = false): { x: number; y: number } {
    const c = this.camera;
    const t = e.timeStamp !== undefined && e.timeStamp > 0 ? e.timeStamp : now();
    const stale = !this.rect || this.rectW !== c.cssW || this.rectH !== c.cssH || (this.g === 'none' && t - this.rectT > RECT_TTL_MS);
    if (fresh || stale) {
      const b = this.canvas.getBoundingClientRect();
      this.rect = { left: b.left, top: b.top, width: b.width, height: b.height };
      this.rectT = t;
      this.rectW = c.cssW;
      this.rectH = c.cssH;
    }
    const r = this.rect as RectLike;
    const kx = r.width > 0 ? c.cssW / r.width : 1;
    const ky = r.height > 0 ? c.cssH / r.height : 1;
    return { x: (e.clientX - r.left) * kx, y: (e.clientY - r.top) * ky };
  }

  private stamp(e: Pick<PointerLike, 'timeStamp'>): number {
    return e.timeStamp > 0 ? e.timeStamp : now();
  }

  private capture(id: number): void {
    try {
      this.canvas.setPointerCapture(id);
    } catch {
      /* указатель уже не активен */
    }
  }

  private releaseCapture(id: number): void {
    try {
      if (this.canvas.hasPointerCapture?.(id)) this.canvas.releasePointerCapture(id);
    } catch {
      /* ничего */
    }
  }
}
