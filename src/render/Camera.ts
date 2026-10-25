// Камера уровня: центр (м) + видимая высота viewH (м), ppm = cssH / viewH.
// Прижим к земле, границы уровня, виды «рогатка / общий план / сооружение», следование за птицей,
// перелёты (flyTo), пан с инерцией, якорный зум, тряска. Числа — 00-summary §1.10, 01-gameplay §6, 04-visual §8.8.
// Камера не знает про DOM и состояние сессии: ей управляют GameScreen (автоматика) и InputController (руки игрока).

import { BIRDS, CAMERA, IMPACT_EVENT, LAUNCH, PIGS, SLINGSHOT, TNT } from '../config/constants';
import type { LevelDef, TerrainDef } from '../core/types';
import type { ViewInfo } from './view';

/** Числа камеры: раздел CAMERA из constants.ts (00-summary §1.10, §1.15) плюс несколько уточнений этого модуля. */
export const CAMERA_CFG = {
  ...CAMERA,
  /** Запас над верхом сооружения в виде рогатки, м. */
  AIM_TOP_PAD: 1,
  /** Общий план не ближе, чем вид рогатки × это число. */
  OVERVIEW_MIN_K: 1.2,
  /** Интро: высота вида сооружения = высота сооружения + это, м. */
  CASTLE_EXTRA_H: 6,
  /** Уровень длиннее (по bounds) — интро-панорама INTRO_PAN_LONG. */
  INTRO_LONG_LEVEL: 60,
  /** Поворот кадра при максимальной тряске, градусы. */
  SHAKE_ROT_DEG: 0.5,
  SHAKE_MAX_SOURCES: 16,
  /** Удары слабее не трясут камеру. */
  SHAKE_IMPACT_J_MIN: IMPACT_EVENT.SHAKE_J_MIN,
  /**
   * Опорное соотношение сторон потолка вида рогатки: на экранах уже 16:9 (4:3, iPad) потолок AIM_VIEW_H_MAX растёт
   * так, чтобы ширина кадра оставалась как у 16:9 при 24 м (но не выше VIEW_H_MAX) — иначе сооружение не влезает.
   */
  AIM_REF_ASPECT: 16 / 9,
  /**
   * Сдвиг вида рогатки, когда сооружение не влезает: слева от рогатки остаётся место под полную оттяжку пальцем
   * (R_MAX · max(ppm, AIM_MIN_PX_PER_M)) плюс столько CSS px.
   */
  AIM_EDGE_PAD_PX: 24,
  /** Жёсткий минимум слева (только при viewH = VIEW_H_MAX): оттянутая птица и первая птица очереди + этот запас, м. */
  AIM_KEEP_PAD: 0.3,
  /** При viewH = VIEW_H_MAX сооружение показывается хотя бы с таким запасом справа, м (вместо AIM_RIGHT_PAD). */
  AIM_RIGHT_PAD_MIN: 0.5,
  /** Следование: при |vx| больше этого камера не едет навстречу движению птицы, м/с. */
  FOLLOW_DEAD_V: 0.5,
  /** Упреждение по vx сглаживается с этим τ, с: разворот птицы (удар, Хэл) не перебрасывает цель кадра скачком. */
  FOLLOW_TAU_LOOK: 0.45,
  /**
   * Манёвр способности (петля Сильвер, разворот Хэла): упреждение заморожено, τ позиции 0.55 с, назад камера едет,
   * только если птица уходит левее этой доли ширины кадра (вперёд — правее 1 − доля).
   */
  FOLLOW_TAU_MANEUVER: 0.55,
  MANEUVER_BAND: 0.15,
  /** Общий план «почти равен» виду рогатки: выше него меньше чем в столько раз, а центры ближе этой доли ширины. */
  OVERVIEW_SAME_K: 1.12,
  OVERVIEW_SAME_X_K: 0.1,
} as const;

const C = CAMERA_CFG;

/** Положение камеры: центр и видимая высота, м. */
export interface CameraPose {
  x: number;
  y: number;
  viewH: number;
}

/** То, что отдаёт view(): ViewInfo плюс высота вида и поворот от тряски (рендер может применить его вокруг центра). */
export interface CameraView extends ViewInfo {
  readonly viewH: number;
  /** Поворот кадра от тряски, рад (обычно 0). */
  readonly shakeAngle: number;
}

export type Ease = (t: number) => number;

export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeInOutSine: Ease = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Шум тряски (04 §8.8): две синусоиды, k разводит оси. */
export function shakeNoise(t: number, k: number): number {
  return 0.6 * Math.sin(2 * Math.PI * 7.3 * t + k) + 0.4 * Math.sin(2 * Math.PI * 13.1 * t + 1.7 * k);
}

/** Сводка уровня для камеры (считается один раз в setLevel). */
export interface LevelFrame {
  readonly minX: number;
  readonly maxX: number;
  /** Опорная высота земли: минимум верхних рёбер рельефа в bounds (обычно 0). */
  readonly groundRef: number;
  /** ANCHOR рогатки. */
  readonly slingX: number;
  readonly slingY: number;
  /** Левый край очереди птиц, м. */
  readonly queueLeft: number;
  /** Сколько метров от рогатки до левого края кадра нужно минимум: оттянутая на R_MAX птица и первая птица очереди. */
  readonly aimLeftKeep: number;
  /** Габарит блоков, свиней и TNT (без запасов); при пустом уровне — разумные значения около рогатки. */
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly contentTop: number;
  /** Центроид свиней (null, если их нет). */
  readonly pigCentroid: { x: number; y: number } | null;
  readonly castle: CameraPose | null;
  readonly aimViewH: number | null;
}

/** Верхние (смотрящие вверх) рёбра рельефа в полосе [minX, maxX] → минимальная высота. null — таких нет. */
export function terrainGroundRef(terrain: readonly TerrainDef[], minX: number, maxX: number): number | null {
  let best: number | null = null;
  for (const t of terrain) {
    const pts = t.points;
    const n = pts.length;
    if (n < 3) continue;
    let area2 = 0;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      area2 += x1 * y2 - x2 * y1;
    }
    const ccw = area2 > 0;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      // внешняя нормаль: справа от ребра у CCW-многоугольника, слева — у CW
      const ny = (ccw ? -dx : dx) / len;
      if (ny < 0.3) continue; // не «верх» (стенка, потолок, дно)
      const lo = Math.max(Math.min(x1, x2), minX);
      const hi = Math.min(Math.max(x1, x2), maxX);
      if (hi < lo) continue;
      const yAt = (x: number): number => (Math.abs(dx) < 1e-9 ? Math.min(y1, y2) : y1 + ((x - x1) / dx) * dy);
      const y = Math.min(yAt(lo), yAt(hi));
      if (y < -10) continue; // «ямы» ниже зоны удаления тел камера не показывает
      if (best === null || y < best) best = y;
    }
  }
  return best;
}

/** Сводка уровня: границы, земля, рогатка, габарит сооружений. */
export function analyzeLevel(level: LevelDef): LevelFrame {
  const minX = level.bounds.minX;
  const maxX = Math.max(level.bounds.maxX, minX + 1);
  const slingX = level.slingshot.x;
  const slingY = level.slingshot.y;
  const baseX = slingX - SLINGSHOT.ANCHOR.x;
  const baseY = slingY - SLINGSHOT.ANCHOR.y;
  const groundRef = terrainGroundRef(level.terrain, minX, maxX) ?? Math.min(0, baseY);

  // очередь птиц: x0 = основание − 1.6, x_{i+1} = x_i − max(1.1, r_i + r_{i+1} + 0.2) (00 §1.2)
  let qx = baseX - SLINGSHOT.QUEUE_X0;
  let queueLeft = qx - 0.5;
  const birds = level.birds;
  let maxR = 0.45;
  for (let i = 0; i < birds.length; i++) {
    const r = BIRDS[birds[i]].radius;
    maxR = Math.max(maxR, r);
    queueLeft = qx - r;
    if (i + 1 < birds.length) qx -= Math.max(SLINGSHOT.QUEUE_DX, r + BIRDS[birds[i + 1]].radius + LAUNCH.QUEUE_GAP);
  }
  // после загрузки первая птица очереди (birds[1]) стоит на основание − QUEUE_X0
  const q1Left = birds.length > 1 ? baseX - SLINGSHOT.QUEUE_X0 - BIRDS[birds[1]].radius : slingX;
  const aimLeftKeep = Math.max(LAUNCH.R_MAX + maxR, slingX - q1Left) + CAMERA_CFG.AIM_KEEP_PAD;

  let left = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  const add = (x: number, y: number, hx: number, hy: number): void => {
    left = Math.min(left, x - hx);
    right = Math.max(right, x + hx);
    top = Math.max(top, y + hy);
  };
  for (const b of level.blocks) {
    if (b.shape === 'circle') {
      add(b.x, b.y, b.w / 2, b.w / 2);
      continue;
    }
    const a = b.angle ?? 0;
    const c = Math.abs(Math.cos(a));
    const s = Math.abs(Math.sin(a));
    add(b.x, b.y, (b.w * c + b.h * s) / 2, (b.w * s + b.h * c) / 2);
  }
  let pcx = 0;
  let pcy = 0;
  for (const p of level.pigs) {
    const r = PIGS[p.type].radius;
    add(p.x, p.y, r, r);
    pcx += p.x;
    pcy += p.y;
  }
  for (const t of level.tnt ?? []) {
    const size = t.size ?? TNT.SIZE;
    const a = t.angle ?? 0;
    const e = (size * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)))) / 2;
    add(t.x, t.y, e, e);
  }
  if (!Number.isFinite(left)) {
    left = slingX + 15;
    right = slingX + 25;
    top = groundRef + 4;
  }
  const np = level.pigs.length;
  const cam = level.camera;
  return {
    minX,
    maxX,
    groundRef,
    slingX,
    slingY,
    queueLeft,
    aimLeftKeep,
    contentLeft: left,
    contentRight: right,
    contentTop: top,
    pigCentroid: np > 0 ? { x: pcx / np, y: pcy / np } : null,
    castle: cam?.castle ? { x: cam.castle.x, y: cam.castle.y, viewH: cam.castle.viewH } : null,
    aimViewH: cam?.aimViewH !== undefined && Number.isFinite(cam.aimViewH) ? cam.aimViewH : null,
  };
}

interface Tween {
  from: CameraPose;
  to: CameraPose;
  t: number;
  dur: number;
  ease: Ease;
}

interface ShakeSrc {
  a: number;
  dur: number;
  t: number;
}

/** Уровень по умолчанию (пока setLevel не вызван): ровная земля, рогатка в 0. */
const DEFAULT_FRAME: LevelFrame = {
  minX: -12,
  maxX: 48,
  groundRef: 0,
  slingX: 0,
  slingY: SLINGSHOT.ANCHOR.y,
  queueLeft: -6,
  aimLeftKeep: 2.75,
  contentLeft: 16,
  contentRight: 30,
  contentTop: 5,
  pigCentroid: null,
  castle: null,
  aimViewH: null,
};

export class Camera {
  /** Центр видимой области, м. */
  x = 0;
  y = 0;
  /** Видимая высота, м. */
  viewH = 15;

  /** Зум, выбранный игроком в READY/AIMING: возвращается на каждом ходу; сбрасывается в setLevel. */
  userAimViewH: number | null = null;
  /** Настройка «Тряска экрана». */
  shakeEnabled = true;

  private cw = 1280;
  private ch = 720;
  private pr = 1;
  private sw = 1280;
  private sh = 720;
  private frame: LevelFrame = DEFAULT_FRAME;
  private tween: Tween | null = null;
  private vx = 0; // инерция пана, м/с
  private vy = 0;
  private kvx = 0; // пан с клавиатуры, м/с
  private kvy = 0;
  private shakes: ShakeSrc[] = [];
  private autoCache: CameraPose | null = null; // авто-вид рогатки до смены уровня/viewport
  /** Сглаженное упреждение следования, м (null — следование не идёт: первый кадр берёт мгновенное). */
  private look: number | null = null;
  /** Сколько ещё секунд длится манёвр способности (спокойное следование); manEnded — он кончился на прошлом кадре. */
  private manT = 0;
  private manEnded = false;

  constructor(level?: LevelDef) {
    if (level) this.setLevel(level);
    else this.jumpTo(this.aimView());
  }

  // ── Размеры и масштаб ─────────────────────────────────────────

  /** Размер холста в CSS-пикселях и devicePixelRatio (уже с учётом ограничения качества). */
  setViewport(cssW: number, cssH: number, dpr: number): void {
    const cw = cssW > 0 && Number.isFinite(cssW) ? cssW : 1;
    const ch = cssH > 0 && Number.isFinite(cssH) ? cssH : 1;
    if (cw !== this.cw || ch !== this.ch) this.autoCache = null; // авто-вид рогатки зависит от размеров
    this.cw = cw;
    this.ch = ch;
    this.pr = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
    this.sw = Math.max(1, Math.round(this.cw * this.pr));
    this.sh = Math.max(1, Math.round(this.ch * this.pr));
    this.clampInPlace();
  }

  get cssW(): number {
    return this.cw;
  }
  get cssH(): number {
    return this.ch;
  }
  get dpr(): number {
    return this.pr;
  }
  /** Размер холста в пикселях устройства (= ViewInfo.screenW/H). */
  get screenW(): number {
    return this.sw;
  }
  get screenH(): number {
    return this.sh;
  }
  get aspect(): number {
    return this.cw / this.ch;
  }
  /** Видимая ширина, м. */
  get viewW(): number {
    return this.viewH * this.aspect;
  }
  /** CSS-пикселей на метр. */
  get ppm(): number {
    return this.ch / this.viewH;
  }
  /** Пикселей устройства на метр (без тряски). */
  get scale(): number {
    return this.sh / this.viewH;
  }

  // ── Уровень и опорные виды ───────────────────────────────────

  /** Новый уровень (или рестарт): границы, земля, авто-вид рогатки; камера встаёт в вид рогатки, зум игрока сброшен. */
  setLevel(level: LevelDef): void {
    this.frame = analyzeLevel(level);
    this.autoCache = null;
    this.userAimViewH = null;
    this.tween = null;
    this.vx = this.vy = 0;
    this.kvx = this.kvy = 0;
    this.shakes.length = 0;
    this.jumpTo(this.aimView());
  }

  /** Сводка текущего уровня. */
  get level(): LevelFrame {
    return this.frame;
  }
  /** Опорная высота земли, м. */
  get groundRef(): number {
    return this.frame.groundRef;
  }
  /**
   * Сколько метров под опорной землёй видно в кадре высоты h (полоса земли внизу). Базовая камера — всегда
   * GROUND_MARGIN (00 §1.10); GameCamera переопределяет долей высоты кадра (земля как в AB2). Правило должно
   * расти не быстрее h (верх кадра bottomFor(h) + h не убывает с ростом h).
   */
  groundMarginFor(_h: number): number {
    return C.GROUND_MARGIN;
  }

  /** Низ кадра высоты h в автоматических видах (прижим к земле) и нижний предел пана/зума. */
  bottomFor(h: number): number {
    return this.frame.groundRef - this.groundMarginFor(h);
  }

  /** Наименьшая высота кадра, низ которого прижат к земле, а верх не ниже top, м. */
  viewHForTop(top: number): number {
    return top - this.frame.groundRef + C.GROUND_MARGIN;
  }

  /** Нижняя граница кадра при текущей высоте вида. */
  get bottomY(): number {
    return this.bottomFor(this.viewH);
  }

  /**
   * Авто-высота вида рогатки (00 §1.10): сооружение (+2 м) в 80 % ширины справа от рогатки, 15…24 м (на экранах
   * уже 16:9 — до 30 м); или level.camera.aimViewH. Если и на потолке не влезает — кадр сдвигается вправо (рогатка
   * левее 20 %, но с местом под оттяжку) и лишь затем растёт до VIEW_H_MAX.
   */
  get autoAimViewH(): number {
    return this.autoAim().viewH;
  }

  /** Потолок авто-вида рогатки с рогаткой на 20 %: 24 м на 16:9 и шире; на узких экранах — та же ширина кадра, но не выше 30 м. */
  get aimViewHMax(): number {
    const k = Math.max(1, C.AIM_REF_ASPECT / this.aspect);
    return Math.min(C.VIEW_H_MAX, C.AIM_VIEW_H_MAX * k);
  }

  /** Высота вида рогатки с учётом выбора игрока. */
  get aimViewH(): number {
    return this.userAimViewH ?? this.autoAimViewH;
  }

  /**
   * Вид рогатки: рогатка на 20 % ширины, низ кадра прижат к земле. Если сооружение (+2 м) не влезает,
   * кадр сдвигается вправо, пока слева от рогатки есть место под полную оттяжку (см. aimLeftRoom).
   */
  aimView(): CameraPose {
    const h = clamp(this.aimViewH, C.VIEW_H_MIN, C.VIEW_H_MAX);
    const x = this.userAimViewH === null ? this.autoAim().x : this.aimXFor(h);
    return this.clampPose({ x, y: this.bottomFor(h) + h / 2, viewH: h });
  }

  /**
   * Сколько метров оставить слева от рогатки до края кадра при высоте h, если кадр приходится сдвигать:
   * ход пальца на полную оттяжку R_MAX·max(ppm, 45) + 24 px, но не меньше жёсткого минимума уровня (aimLeftKeep).
   */
  aimLeftRoom(h: number): number {
    const ppm = this.ch / clamp(h, C.VIEW_H_MIN, C.VIEW_H_MAX);
    const px = LAUNCH.R_MAX * Math.max(ppm, LAUNCH.AIM_MIN_PX_PER_M) + C.AIM_EDGE_PAD_PX;
    return Math.max(this.frame.aimLeftKeep, px / ppm);
  }

  /**
   * Центр вида рогатки при высоте h: рогатка на 20 %, либо сдвиг вправо до сооружения (+2 м), но не дальше aimLeftRoom.
   * На VIEW_H_MAX отдалять дальше некуда: сдвиг до жёсткого минимума слева, но лишь до самого сооружения (+0.5 м).
   */
  private aimXFor(h: number): number {
    const f = this.frame;
    const w = h * this.aspect;
    const x20 = f.slingX + (0.5 - C.SLING_SCREEN_X) * w;
    const xs = Math.max(x20, Math.min(f.contentRight + C.AIM_RIGHT_PAD - w / 2, f.slingX - this.aimLeftRoom(h) + w / 2));
    if (h < C.VIEW_H_MAX - 1e-9) return xs;
    return Math.max(xs, Math.min(f.contentRight + C.AIM_RIGHT_PAD_MIN - w / 2, f.slingX - f.aimLeftKeep + w / 2));
  }

  /** Правый край вида рогатки высоты h. */
  private aimRightFor(h: number): number {
    return this.aimXFor(h) + (h * this.aspect) / 2;
  }

  /** Авто-вид рогатки (кэш до смены уровня или viewport). */
  private autoAim(): CameraPose {
    if (this.autoCache) return this.autoCache;
    const f = this.frame;
    let h: number;
    if (f.aimViewH !== null) h = clamp(f.aimViewH, C.VIEW_H_MIN, C.VIEW_H_MAX);
    else {
      const xR = f.contentRight + C.AIM_RIGHT_PAD;
      const wNeed = (xR - f.slingX) / ((1 - C.SLING_SCREEN_X) * this.aspect);
      const hNeed = this.viewHForTop(f.contentTop + C.AIM_TOP_PAD);
      h = clamp(Math.max(wNeed, hNeed), C.AIM_VIEW_H_MIN, this.aimViewHMax);
      const fits = (hh: number): boolean => this.aimRightFor(hh) >= xR - 1e-6;
      if (!fits(h)) {
        // сдвиг вправо не помог — отдаляем: минимальная высота, при которой сооружение влезает с местом под оттяжку
        const top = C.VIEW_H_MAX - 1e-6; // ниже VIEW_H_MAX — ещё «мягкий» запас слева
        if (h < top && fits(top)) {
          let lo = h;
          let hi = top;
          for (let i = 0; i < 40 && hi - lo > 1e-4; i++) {
            const mid = (lo + hi) / 2;
            if (fits(mid)) hi = mid;
            else lo = mid;
          }
          h = hi;
        } else h = C.VIEW_H_MAX; // и так не влезает: максимум отдаления и жёсткий минимум слева
      }
    }
    this.autoCache = { x: this.aimXFor(h), y: this.bottomFor(h) + h / 2, viewH: h };
    return this.autoCache;
  }

  /** Общий план: от очереди птиц до дальнего блока и верх сооружения; не ближе вида рогатки × 1.2, не выше 30 м. */
  overview(): CameraPose {
    const f = this.frame;
    const xL = Math.max(f.minX, Math.min(f.queueLeft, f.contentLeft) - 1);
    const xR = Math.min(f.maxX, f.contentRight + C.AIM_RIGHT_PAD);
    const hFit = Math.max((xR - xL) / this.aspect, this.viewHForTop(f.contentTop + C.AIM_TOP_PAD + 1));
    const h = clamp(Math.max(hFit, this.autoAimViewH * C.OVERVIEW_MIN_K), C.VIEW_H_MIN, C.VIEW_H_MAX);
    return this.clampPose({ x: (xL + xR) / 2, y: this.bottomFor(h) + h / 2, viewH: h });
  }

  /** Вид сооружения для интро: level.camera.castle или центроид свиней при viewH = max(aimViewH, высота + 6). */
  castleView(): CameraPose {
    const f = this.frame;
    if (f.castle) return this.clampPose({ ...f.castle });
    const structH = f.contentTop - f.groundRef;
    const h = clamp(Math.max(this.autoAimViewH, structH + C.CASTLE_EXTRA_H), C.VIEW_H_MIN, C.VIEW_H_MAX);
    const x = f.pigCentroid ? f.pigCentroid.x : (f.contentLeft + f.contentRight) / 2;
    return this.clampPose({ x, y: this.bottomFor(h) + h / 2, viewH: h });
  }

  /** Длительность панорамы интро (01 §6.3): повтор короче, длинный уровень — дольше. */
  introPanTime(repeat: boolean): number {
    if (repeat) return C.INTRO_PAN_REPEAT;
    return this.frame.maxX - this.frame.minX > C.INTRO_LONG_LEVEL ? C.INTRO_PAN_LONG : C.INTRO_PAN;
  }

  /** Время возврата к цели (по умолчанию к рогатке): clamp(0.5 + dist/45, 0.6, 1.4) с. */
  returnTime(to: CameraPose = this.aimView()): number {
    const dist = Math.hypot(to.x - this.x, to.y - this.y);
    return clamp(C.RETURN_BASE + dist * C.RETURN_PER_M, C.RETURN_MIN, C.RETURN_MAX);
  }

  /** Ограничить позу: viewH ∈ [9, 30], x в bounds (если вид шире уровня — по центру), низ ≥ bottomFor(h), верх ≤ groundRef − 1.2 + 30. */
  clampPose(p: CameraPose): CameraPose {
    const h = clamp(Number.isFinite(p.viewH) ? p.viewH : C.AIM_VIEW_H_MIN, C.VIEW_H_MIN, C.VIEW_H_MAX);
    const f = this.frame;
    const halfW = (h * this.aspect) / 2;
    let x = Number.isFinite(p.x) ? p.x : f.slingX;
    if (2 * halfW >= f.maxX - f.minX) x = (f.minX + f.maxX) / 2;
    else x = clamp(x, f.minX + halfW, f.maxX - halfW);
    const yMin = this.bottomFor(h) + h / 2;
    // верх кадра — не выше groundRef − GROUND_MARGIN + VIEW_H_MAX (00 §1.10), при любом правиле полосы земли
    const yMax = Math.max(yMin, f.groundRef - C.GROUND_MARGIN + C.VIEW_H_MAX - h / 2);
    const y = clamp(Number.isFinite(p.y) ? p.y : yMin, yMin, yMax);
    return { x, y, viewH: h };
  }

  /** Точка в кадре (с запасом margin м внутрь; отрицательный — наружу). */
  contains(x: number, y: number, margin = 0): boolean {
    const hw = this.viewW / 2 - margin;
    const hh = this.viewH / 2 - margin;
    return Math.abs(x - this.x) <= hw && Math.abs(y - this.y) <= hh;
  }

  // ── Мир ↔ экран (CSS-пиксели, без тряски) ───────────────────

  worldToScreen(x: number, y: number): { x: number; y: number } {
    const k = this.ppm;
    return { x: (x - this.x) * k + this.cw / 2, y: this.ch / 2 - (y - this.y) * k };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const k = this.ppm;
    return { x: (sx - this.cw / 2) / k + this.x, y: (this.ch / 2 - sy) / k + this.y };
  }

  /** Параметры кадра для рендера (пиксели устройства), с тряской. */
  view(time: number): CameraView {
    const amp = this.shakeAmplitude;
    let cx = this.x;
    let cy = this.y;
    let ang = 0;
    if (amp > 0) {
      cx += amp * shakeNoise(time, 0);
      cy += amp * shakeNoise(time, 2.1);
      ang = ((C.SHAKE_ROT_DEG * Math.PI) / 180) * (amp / C.SHAKE_MAX) * shakeNoise(time, 4.2);
    }
    return {
      screenW: this.sw,
      screenH: this.sh,
      camX: cx,
      camY: cy,
      scale: this.scale,
      dpr: this.pr,
      time,
      viewH: this.viewH,
      shakeAngle: ang,
    };
  }

  // ── Ручное управление ─────────────────────────────────────────

  /** Сдвиг «за пальцем» на (dx, dy) CSS-пикселей: мир едет вместе с указателем 1:1. */
  panBy(dxCss: number, dyCss: number): void {
    this.tween = null;
    this.vx = this.vy = 0;
    this.look = null;
    const k = this.ppm;
    this.x -= dxCss / k;
    this.y += dyCss / k;
    this.clampInPlace();
  }

  /** Зум с якорем: factor > 1 — приблизить (viewH / factor). Точка под (cssX, cssY) остаётся под курсором, пока не упёрлись в границы. */
  zoomAt(factor: number, cssX: number, cssY: number): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    this.tween = null;
    const before = this.screenToWorld(cssX, cssY);
    this.viewH = clamp(this.viewH / factor, C.VIEW_H_MIN, C.VIEW_H_MAX);
    const k = this.ppm;
    // центр так, чтобы before снова оказалась под (cssX, cssY)
    this.x = before.x - (cssX - this.cw / 2) / k;
    this.y = before.y - (this.ch / 2 - cssY) / k;
    this.clampInPlace();
  }

  /** Инерция после отпускания пана: скорость указателя в CSS-пикселях в секунду. */
  fling(vxCss: number, vyCss: number): void {
    const k = this.ppm;
    this.vx = Number.isFinite(vxCss) ? -vxCss / k : 0;
    this.vy = Number.isFinite(vyCss) ? vyCss / k : 0;
    if (Math.hypot(this.vx, this.vy) < C.PAN_STOP_V) this.vx = this.vy = 0;
  }

  stopInertia(): void {
    this.vx = this.vy = 0;
  }

  /** Пан с клавиатуры, м/с (пока клавиша зажата); 0, 0 — стоп. */
  setKeyPan(vx: number, vy: number): void {
    this.kvx = Number.isFinite(vx) ? vx : 0;
    this.kvy = Number.isFinite(vy) ? vy : 0;
    if (this.kvx !== 0 || this.kvy !== 0) this.tween = null;
  }

  /** Текущий пан с клавиатуры, м/с. */
  get keyPan(): { vx: number; vy: number } {
    return { vx: this.kvx, vy: this.kvy };
  }

  /** Запомнить текущий зум как зум вида рогатки (игрок сменил зум в READY/AIMING). */
  rememberAimZoom(): void {
    this.userAimViewH = this.viewH;
  }

  // ── Автоматика ───────────────────────────────────────────────

  /** Мгновенно встать в позу (с ограничениями). Сбрасывает перелёт и инерцию. */
  jumpTo(p: CameraPose): void {
    this.tween = null;
    this.vx = this.vy = 0;
    this.look = null;
    this.manT = 0;
    this.manEnded = false;
    const c = this.clampPose(p);
    this.x = c.x;
    this.y = c.y;
    this.viewH = c.viewH;
  }

  /** Перелёт в позу за duration секунд (по умолчанию easeInOutCubic). duration ≤ 0 — мгновенно. */
  flyTo(x: number, y: number, viewH: number, duration: number, ease: Ease = easeInOutCubic): void {
    this.vx = this.vy = 0;
    this.look = null;
    this.manT = 0;
    this.manEnded = false;
    const to = this.clampPose({ x, y, viewH });
    if (!(duration > 0)) {
      this.jumpTo(to);
      return;
    }
    this.tween = { from: { x: this.x, y: this.y, viewH: this.viewH }, to, t: 0, dur: duration, ease };
  }

  /** То же для готовой позы. */
  flyToPose(p: CameraPose, duration: number, ease: Ease = easeInOutCubic): void {
    this.flyTo(p.x, p.y, p.viewH, duration, ease);
  }

  /** Прервать перелёт на месте. */
  cancelFly(): void {
    this.tween = null;
  }

  /** Идёт перелёт flyTo. */
  get animating(): boolean {
    return this.tween !== null;
  }

  /** Куда летит камера (или null). */
  get flyTarget(): CameraPose | null {
    return this.tween ? { ...this.tween.to } : null;
  }

  /**
   * Куда едет «общий план» по Z / двойному тапу: overview(), а если он почти совпадает с видом рогатки
   * (узкий экран, где оба упираются в 30 м) — вид на сооружение той же высоты, чтобы переключение что-то давало.
   */
  overviewTarget(): CameraPose {
    const ov = this.overview();
    const aim = this.aimView();
    const same = ov.viewH < aim.viewH * C.OVERVIEW_SAME_K && Math.abs(ov.x - aim.x) < C.OVERVIEW_SAME_X_K * ov.viewH * this.aspect;
    if (!same) return ov;
    const f = this.frame;
    const x = Math.max(ov.x, (f.contentLeft + f.contentRight) / 2);
    return this.clampPose({ x, y: ov.y, viewH: ov.viewH });
  }

  /** Z / двойной тап: общий план (overviewTarget) ↔ вид рогатки. Возвращает, куда поехали. */
  toggleOverview(duration: number = C.TOGGLE_FIT_T): 'overview' | 'aim' {
    const ov = this.overviewTarget();
    const aim = this.aimView();
    const cur = this.tween ? this.tween.to : { x: this.x, y: this.y, viewH: this.viewH };
    const dOv = Math.abs(cur.viewH - ov.viewH) + Math.abs(cur.x - ov.x) * 0.25;
    const dAim = Math.abs(cur.viewH - aim.viewH) + Math.abs(cur.x - aim.x) * 0.25;
    const goAim = dOv <= dAim;
    this.flyToPose(goAim ? aim : ov, duration);
    return goAim ? 'aim' : 'overview';
  }

  /**
   * Манёвр способности на sec секунд (петля Сильвер, разворот Хэла): следование спокойнее — упреждение заморожено,
   * τ позиции FOLLOW_TAU_MANEUVER, назад — только когда птица уходит из полосы [0.15, 0.85] ширины кадра.
   */
  maneuver(sec: number): void {
    if (Number.isFinite(sec) && sec > 0) this.manT = Math.max(this.manT, sec);
  }

  /** Идёт манёвр способности. */
  get maneuvering(): boolean {
    return this.manT > 0;
  }

  /**
   * Следование за птицей (01 §6.4): упреждение по vx (сглаженное, τ 0.45 с), птица в полосе 25–65 % ширины, зум —
   * птица и земля в кадре плюс 3 м над птицей, но не ближе вида рогатки. Экспоненты τ 0.18 / 0.35 с; низ кадра —
   * к земле той же τ 0.18. Мёртвая зона: камера не едет навстречу движению птицы (при выпуске птица на 20 % — левее
   * полосы — и камера ждёт, пока та сама войдёт в полосу, а не дёргается назад к рогатке). Манёвр способности —
   * см. maneuver().
   */
  follow(target: { x: number; y: number; vx: number; vy: number }, dt: number): void {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    this.tween = null;
    this.vx = this.vy = 0;
    const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const man = this.manT > 0;
    this.manT = Math.max(0, this.manT - d);
    // манёвр кончился: упреждение — то, при котором камера уже стоит (без рывка вдогонку замороженной цели)
    if (!man && this.manEnded) this.look = clamp(this.x - target.x, C.LOOKAHEAD_MIN, C.LOOKAHEAD_MAX);
    this.manEnded = man && this.manT <= 0;
    const kPos = 1 - Math.exp(-d / (man ? C.FOLLOW_TAU_MANEUVER : C.FOLLOW_TAU_POS));
    const bottom0 = this.y - this.viewH / 2;
    const needH = this.viewHForTop(target.y + C.HEADROOM);
    const th = clamp(Math.max(this.aimViewH, needH), C.VIEW_H_MIN, C.VIEW_H_MAX);
    this.viewH += (th - this.viewH) * (1 - Math.exp(-d / C.FOLLOW_TAU_ZOOM));
    const w = this.viewW;
    const bvx = Number.isFinite(target.vx) ? target.vx : 0;
    const lookT = clamp(bvx * C.LOOKAHEAD_K, C.LOOKAHEAD_MIN, C.LOOKAHEAD_MAX);
    // упреждение: в манёвре заморожено (петля переворачивает vx), иначе догоняет мгновенное с τ FOLLOW_TAU_LOOK
    if (this.look === null) this.look = lookT;
    else if (!man) this.look += (lookT - this.look) * (1 - Math.exp(-d / C.FOLLOW_TAU_LOOK));
    const look = this.look;
    const [bandL, bandR] = C.FOLLOW_BAND;
    // цель центра — птица + упреждение, но так, чтобы птица была в полосе [bandL, bandR] ширины кадра
    let tx = clamp(target.x + look, target.x - (bandR - 0.5) * w, target.x + (0.5 - bandL) * w);
    if (man) {
      // манёвр: камера стоит, пока птица в полосе [0.15, 0.85]; выходит — ровно столько, чтобы вернуть её в полосу
      const lo = target.x - (0.5 - C.MANEUVER_BAND) * w;
      const hi = target.x + (0.5 - C.MANEUVER_BAND) * w;
      tx = clamp(this.x, lo, hi);
    } else if (!man && ((bvx > C.FOLLOW_DEAD_V && tx < this.x) || (bvx < -C.FOLLOW_DEAD_V && tx > this.x))) tx = this.x;
    this.x += (tx - this.x) * kPos;
    // жёсткая страховка: птица не уходит за край кадра по горизонтали (5 % запаса)
    this.x = clamp(this.x, target.x - 0.45 * w, target.x + 0.45 * w);
    // низ кадра плавно к земле: без скачка, если в READY игрок зумил или панорамировал вверх
    const bottom = bottom0 + (this.bottomFor(this.viewH) - bottom0) * kPos;
    this.y = bottom + this.viewH / 2;
    this.clampInPlace();
  }

  // ── Тряска ───────────────────────────────────────────────────

  /** Добавить вклад тряски: амплитуда amount м, затухание (1 − t/T)² за duration с. */
  shake(amount: number, duration: number): void {
    if (!this.shakeEnabled || !(amount > 0) || !(duration > 0)) return;
    if (this.shakes.length >= C.SHAKE_MAX_SOURCES) {
      // вытесняем самый слабый вклад
      let wi = 0;
      for (let i = 1; i < this.shakes.length; i++) if (this.contrib(this.shakes[i]) < this.contrib(this.shakes[wi])) wi = i;
      this.shakes.splice(wi, 1);
    }
    this.shakes.push({ a: Math.min(amount, C.SHAKE_MAX), dur: duration, t: 0 });
  }

  /** Тряска от взрыва радиуса R (00 §1.10): min(0.35, 0.1·R) на 0.35 с. */
  shakeBlast(radius: number): void {
    this.shake(Math.min(C.SHAKE_MAX, C.SHAKE_BLAST_K * radius), C.SHAKE_BLAST_T);
  }

  /** Тряска от удара с импульсом J (только J ≥ 20): min(0.35, J/400) на 0.3 с. */
  shakeImpact(impulse: number): void {
    if (impulse < C.SHAKE_IMPACT_J_MIN) return;
    this.shake(Math.min(C.SHAKE_MAX, impulse / C.SHAKE_IMPACT_DIV), C.SHAKE_IMPACT_T);
  }

  /** Текущая амплитуда тряски, м (0…0.35). */
  get shakeAmplitude(): number {
    if (!this.shakeEnabled) return 0;
    let a = 0;
    for (const s of this.shakes) a += this.contrib(s);
    return Math.min(a, C.SHAKE_MAX);
  }

  private contrib(s: ShakeSrc): number {
    const u = 1 - s.t / s.dur;
    return u > 0 ? s.a * u * u : 0;
  }

  // ── Кадр ─────────────────────────────────────────────────────

  /** Продвинуть перелёт, инерцию пана, пан с клавиатуры и тряску. */
  update(dt: number): void {
    const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const tw = this.tween;
    if (tw) {
      tw.t += d;
      const u = Math.min(1, tw.t / tw.dur);
      const k = tw.ease(u);
      this.x = lerp(tw.from.x, tw.to.x, k);
      this.y = lerp(tw.from.y, tw.to.y, k);
      this.viewH = lerp(tw.from.viewH, tw.to.viewH, k);
      if (u >= 1) {
        this.x = tw.to.x;
        this.y = tw.to.y;
        this.viewH = tw.to.viewH;
        this.tween = null;
      }
    } else if (this.vx !== 0 || this.vy !== 0) {
      // точный интеграл v·exp(−t/τ) за шаг: путь не зависит от частоты кадров
      const decay = Math.exp(-d / C.PAN_INERTIA_TAU);
      const k = C.PAN_INERTIA_TAU * (1 - decay);
      const wx = this.x + this.vx * k;
      const wy = this.y + this.vy * k;
      this.x = wx;
      this.y = wy;
      this.clampInPlace();
      // упёрлись в границу — эта составляющая гаснет
      if (Math.abs(this.x - wx) > 1e-9) this.vx = 0;
      if (Math.abs(this.y - wy) > 1e-9) this.vy = 0;
      this.vx *= decay;
      this.vy *= decay;
      if (Math.hypot(this.vx, this.vy) < C.PAN_STOP_V) this.vx = this.vy = 0;
    }
    if (this.kvx !== 0 || this.kvy !== 0) {
      this.x += this.kvx * d;
      this.y += this.kvy * d;
    }
    if (this.shakes.length > 0) {
      // на месте, без нового массива каждый кадр
      let n = 0;
      for (const s of this.shakes) {
        s.t += d;
        if (s.t < s.dur) this.shakes[n++] = s;
      }
      this.shakes.length = n;
    }
    this.clampInPlace();
  }

  /** Есть инерция пана. */
  get coasting(): boolean {
    return this.vx !== 0 || this.vy !== 0;
  }

  private clampInPlace(): void {
    const c = this.clampPose({ x: this.x, y: this.y, viewH: this.viewH });
    this.x = c.x;
    this.y = c.y;
    this.viewH = c.viewH;
  }
}
