// Чистая логика жестов и клавиш (без DOM): что делать по нажатию, пороги пана и тапа, двойной тап,
// скорость для инерции, шаг щипка, усиление оттяжки на телефоне, колесо, клавиши.
// Числа — 00-summary §1.2, §1.10, §1.13; 01-gameplay §2.2, §4.2, §6.5; 07-ui-ux §16.

import { CAMERA, LAUNCH } from '../config/constants';
import type { SessionState } from '../core/events';
import type { Vec } from '../core/types';

export const GESTURE = {
  /** Сдвиг указателя, после которого нажатие становится паном, CSS px. */
  PAN_THRESHOLD_PX: CAMERA.PAN_THRESHOLD_PX,
  /** Тап: короче и ближе этого. */
  TAP_MAX_MS: 300,
  /** Двойной тап: второй тап не позже и не дальше этого от первого. */
  DOUBLE_TAP_MS: 300,
  DOUBLE_TAP_PX: 24,
  /** Окно усреднения скорости пана для инерции, мс. */
  VEL_WINDOW_MS: CAMERA.PAN_VEL_WINDOW * 1000,
  /** Захват птицы: не меньше этого радиуса в CSS px (кроме радиуса ядра в метрах). */
  GRAB_MIN_PX: LAUNCH.GRAB_MIN_PX,
  /** Ниже — ход пальца усиливается: полная оттяжка R_MAX на R_MAX·45 = 90 CSS px. */
  AIM_MIN_PX_PER_M: LAUNCH.AIM_MIN_PX_PER_M,
  WHEEL_K: CAMERA.WHEEL_K,
  WHEEL_K_CTRL: CAMERA.WHEEL_K_CTRL,
  /** deltaMode = 1 (строки) → столько px на строку. */
  WHEEL_LINE_PX: 16,
  /** Ограничение зума за одно событие колеса (против рывков). */
  WHEEL_MAX_FACTOR: 2,
  KEY_PAN_V: CAMERA.KEY_PAN_V,
  KEY_PAN_SHIFT_K: 2,
  KEY_ZOOM: CAMERA.KEY_ZOOM,
} as const;

/** Текущий жест контроллера. */
export type GestureKind = 'none' | 'aim' | 'pending' | 'pan' | 'pinch';

/** Решение по pointerdown. */
export type DownAction =
  | 'ignore' // ничего (лишний палец, «назад/вперёд» мыши, нет сессии)
  | 'skip' // ввод заблокирован (интро, баннер, бонус) — пропустить
  | 'aim' // взять птицу
  | 'ability' // способность летящей птицы, затем можно панорамировать тем же пальцем
  | 'pan' // кандидат в пан (после порога) или тап
  | 'pinch'; // второй палец — щипок

export interface DownContext {
  hasSession: boolean;
  blocked: boolean;
  state: SessionState | null;
  /** Жест до этого нажатия. */
  gesture: GestureKind;
  /** Сколько указателей уже нажато (без этого). */
  activePointers: number;
  pointerType: string;
  /** PointerEvent.button: 0 — основная кнопка или палец/перо, 1 — средняя, 2 — правая. */
  button: number;
  /** Указатель в зоне захвата птицы. */
  canGrab: boolean;
}

/** Что делать по нажатию (01 §4.2, 07 §16.1). */
export function classifyDown(c: DownContext): DownAction {
  if (!c.hasSession) return 'ignore';
  if (c.blocked) return 'skip';
  if (c.button < 0 || c.button > 2) return 'ignore';
  if (c.gesture === 'aim') return 'ignore'; // второй палец при прицеле не мешает и не стреляет
  if (c.gesture === 'pinch' || c.activePointers >= 2) return 'ignore';
  if (c.activePointers === 1) return 'pinch';
  const primary = c.button === 0;
  if (primary && c.state === 'ready' && c.canGrab) return 'aim';
  if (primary && c.state === 'flying') return 'ability';
  return 'pan'; // правая/средняя кнопки и всё прочее — только пан
}

/** Указатель ушёл от точки нажатия дальше порога (≥ threshold). */
export function passedThreshold(x0: number, y0: number, x: number, y: number, threshold: number = GESTURE.PAN_THRESHOLD_PX): boolean {
  return Math.hypot(x - x0, y - y0) >= threshold;
}

export interface TapSample {
  t: number;
  x: number;
  y: number;
}

/** Нажатие и отпускание образуют тап: коротко и почти на месте. */
export function isTap(down: TapSample, up: TapSample): boolean {
  return up.t - down.t < GESTURE.TAP_MAX_MS && !passedThreshold(down.x, down.y, up.x, up.y);
}

/** Второй тап в пределах 300 мс и 24 px от первого (время — по моментам отпускания). */
export function isDoubleTap(prev: TapSample | null, cur: TapSample): boolean {
  if (!prev) return false;
  const dt = cur.t - prev.t;
  return dt >= 0 && dt <= GESTURE.DOUBLE_TAP_MS && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= GESTURE.DOUBLE_TAP_PX;
}

/** Скорость указателя — среднее за последние 80 мс движения (01 §6.5). */
export class VelocityTracker {
  private readonly samples: TapSample[] = [];

  constructor(private readonly windowMs: number = GESTURE.VEL_WINDOW_MS) {}

  clear(): void {
    this.samples.length = 0;
  }

  add(t: number, x: number, y: number): void {
    this.samples.push({ t, x, y });
    // держим чуть больше окна
    const cut = t - this.windowMs * 2;
    let i = 0;
    while (i < this.samples.length - 2 && this.samples[i].t < cut) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  /** px/с на момент now: по образцам из окна [now − window, now]. Палец стоял дольше окна — 0. */
  velocity(now: number): { vx: number; vy: number } {
    const from = now - this.windowMs;
    let first: TapSample | null = null;
    let last: TapSample | null = null;
    for (const s of this.samples) {
      if (s.t < from || s.t > now + 1) continue;
      if (!first) first = s;
      last = s;
    }
    if (!first || !last || last === first) return { vx: 0, vy: 0 };
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.004) return { vx: 0, vy: 0 };
    return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
  }
}

export interface PinchStep {
  /** Множитель зума (> 1 — пальцы разошлись, приблизить). */
  factor: number;
  /** Прежняя середина — якорь зума. */
  anchorX: number;
  anchorY: number;
  /** Сдвиг середины — пан после зума. */
  dx: number;
  dy: number;
}

/** Инкрементальный шаг щипка: зум к прежней середине, затем пан на сдвиг середины. */
export function pinchStep(a0: Vec, b0: Vec, a1: Vec, b1: Vec): PinchStep {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const factor = d0 > 1 && d1 > 1 ? d1 / d0 : 1;
  const mx0 = (a0.x + b0.x) / 2;
  const my0 = (a0.y + b0.y) / 2;
  const mx1 = (a1.x + b1.x) / 2;
  const my1 = (a1.y + b1.y) / 2;
  return { factor, anchorX: mx0, anchorY: my0, dx: mx1 - mx0, dy: my1 - my0 };
}

/**
 * Точка прицела в мире (00 §1.2): кармашек в момент захвата + ход указателя / max(ppm, minPpm).
 * При ppm ≥ 45 птица идёт за пальцем 1:1, на телефоне полная сила набирается на 90 CSS px. Y экрана вниз.
 * Мышь (minPpm = 0) всегда 1:1: курсор не упирается в край экрана, а отставание птицы на ноутбуке заметно.
 */
export function aimPoint(
  pocket0: Vec,
  grabX: number,
  grabY: number,
  curX: number,
  curY: number,
  ppmCss: number,
  minPpm: number = GESTURE.AIM_MIN_PX_PER_M,
): Vec {
  const k = 1 / Math.max(ppmCss, minPpm, 1e-6);
  return { x: pocket0.x + (curX - grabX) * k, y: pocket0.y - (curY - grabY) * k };
}

/** Указатель в зоне захвата: в радиусе ядра (canGrab по мировой точке) или ближе 44 CSS px к центру птицы. */
export function withinGrabPx(px: number, py: number, birdX: number, birdY: number, minPx: number = GESTURE.GRAB_MIN_PX): boolean {
  return Math.hypot(px - birdX, py - birdY) <= minPx;
}

export interface WheelResult {
  /** Множитель зума (> 1 — приблизить). */
  zoom: number;
  /** Пан от горизонтальной прокрутки, CSS px (знак — как у panBy). */
  panX: number;
}

/**
 * Колесо (07 §16.1): вниз (deltaY > 0) — отдалить, viewH *= exp(deltaY·k); Ctrl (щипок тачпада) — k 0.01.
 * deltaMode 1 — строки (×16 px), 2 — страницы (×высота). deltaX — горизонтальный пан.
 */
export function wheelToCamera(deltaX: number, deltaY: number, deltaMode: number, ctrlKey: boolean, pageH: number): WheelResult {
  const unit = deltaMode === 1 ? GESTURE.WHEEL_LINE_PX : deltaMode === 2 ? Math.max(1, pageH) : 1;
  const dy = (Number.isFinite(deltaY) ? deltaY : 0) * unit;
  const dx = (Number.isFinite(deltaX) ? deltaX : 0) * unit;
  const k = ctrlKey ? GESTURE.WHEEL_K_CTRL : GESTURE.WHEEL_K;
  const m = GESTURE.WHEEL_MAX_FACTOR;
  const zoom = Math.min(m, Math.max(1 / m, Math.exp(-dy * k)));
  return { zoom, panX: ctrlKey ? 0 : -dx };
}

/** Команда клавиатуры в игре. */
export type KeyCommand =
  | { kind: 'escape' } // в прицеле — отмена прицела, иначе пауза
  | { kind: 'pause' }
  | { kind: 'restart' }
  | { kind: 'ability' }
  | { kind: 'overview' }
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; key: ArrowKey };

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

const ARROWS: readonly string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/** Клавиша → команда (по e.code, чтобы работало в русской раскладке; e.key — запасной путь). */
export function keyCommand(code: string, key: string): KeyCommand | null {
  if (code === 'Escape' || key === 'Escape') return { kind: 'escape' };
  if (code === 'KeyP') return { kind: 'pause' };
  if (code === 'KeyR') return { kind: 'restart' };
  if (code === 'Space' || key === ' ' || code === 'Enter' || code === 'NumpadEnter') return { kind: 'ability' };
  if (code === 'KeyZ') return { kind: 'overview' };
  if (code === 'Equal' || code === 'NumpadAdd' || key === '+' || key === '=') return { kind: 'zoom', factor: GESTURE.KEY_ZOOM };
  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '_') return { kind: 'zoom', factor: 1 / GESTURE.KEY_ZOOM };
  const a = ARROWS.includes(code) ? code : ARROWS.includes(key) ? key : null;
  if (a) return { kind: 'pan', key: a as ArrowKey };
  return null;
}

/** Скорость пана камеры (м/с) по зажатым стрелкам: 15 м/с, Shift ×2. Вверх — +y. */
export function keyPanVelocity(held: ReadonlySet<string>, shift: boolean): { vx: number; vy: number } {
  const v = GESTURE.KEY_PAN_V * (shift ? GESTURE.KEY_PAN_SHIFT_K : 1);
  const sx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
  const sy = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
  return { vx: sx * v, vy: sy * v };
}

/** Элемент, в котором печатают: клавиши игры там не работают. */
export function isEditableTarget(t: unknown): boolean {
  const el = t as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

/** Элемент, который сам реагирует на Пробел/Enter (кнопка в фокусе и т. п.). */
export function isInteractiveTarget(t: unknown): boolean {
  const el = t as { tagName?: unknown; getAttribute?: (n: string) => string | null } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (/^(BUTTON|A|INPUT|TEXTAREA|SELECT|SUMMARY|OPTION)$/.test(el.tagName)) return true;
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  return role === 'button' || role === 'link' || role === 'checkbox' || role === 'switch' || role === 'tab' || role === 'menuitem';
}
