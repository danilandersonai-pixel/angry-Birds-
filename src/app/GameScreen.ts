// Игровой экран: сессия ядра + камера + ввод + рендер + эффекты + звук + HUD (спецификация §4, 00 §1.12).
// Цикл: накопитель времени, session.step() строго по 1/60 с, не больше 4 шагов за кадр (лишний остаток
// выбрасывается), рендер интерполирует тела по alpha = acc / dt. Каждый кадр: события ядра → Fx, звук, рендер,
// камера (тряска), HUD, подсказки. Презентационные фазы — здесь: облёт в начале уровня (step() не вызывается,
// ввод рогатки заблокирован, любой ввод пропускает), пауза, баннеры, результаты.
// Плейтест №1: камера — GameCamera (вид рогатки ближе, облёт от сооружения); подсказка уровня — после облёта
// (первая попытка или 2 поражения подряд); баннер победы — через 1 с после последней свиньи (ядро ещё ждёт покоя);
// при поражении камера показывает свиней; камера задерживается на разрушении, пока оно идёт (≤ LINGER_MAX).
// Плейтест №2: «К рогатке» не показывается после победы; тап ускоряет весь финал (settling и бонус); баннер победы
// раньше и со звуком; задержка камеры считает разрушения и в полёте; бонусные «10000» разнесены по высоте;
// текстовая подсказка 1-1 не спорит с рукой обучения.

import { ABILITY, AIM_ASSIST, CAMERA, TIMING, UI_TIMING, WORLD } from '../config/constants';
import { createSession } from '../core';
import type { GameSession } from '../core/api';
import type { GameEvent } from '../core/events';
import type { BirdType, LevelDef, PigType } from '../core/types';
import type { AudioEngine } from '../audio/AudioEngine';
import { InputController } from '../input/Input';
import { nextLevelId } from '../levels';
import { easeInOutSine, easeOutCubic, type CameraPose } from '../render/Camera';
import { Fx, type FxQuality } from '../render/fx/Fx';
import { Renderer } from '../render/Renderer';
import { levelDamageWarmList, type SpriteCache, type WarmItem } from '../render/SpriteCache';
import { frostTile, stoneTile } from '../render/sprites/props';
import { shakeOn, type ProgressStore } from '../storage/progress';
import type { UI } from '../ui/UI';
import { S } from '../ui/strings';
import type { CanvasHost } from './CanvasHost';
import { GameCamera, type LiveBox } from './GameCamera';
import { warmFxSteps } from './fxWarm';
import { advance } from './loop';

const DT = WORLD.DT;
/** Предел альфы экранной вспышки при «Уменьшить движение» (07 §19.3: α до 0.12 вместо 0.35). */
const REDUCED_FLASH_MAX = 0.12;
const MAX_STEPS = WORLD.MAX_STEPS_PER_FRAME;
/**
 * Задержка камеры на месте событий после ухода птицы и возврат к рогатке — общие с ядром числа (TIMING): не раньше
 * LINGER_MIN, не раньше BREAK_QUIET после последнего разрушения (BLAST_QUIET после взрыва), не позже LINGER_MAX.
 * Отъезд камеры сообщается ядру (session.releaseLinger): следующая птица прыгает в кармашек во время возврата и
 * готова к приезду камеры.
 */
const LINGER = TIMING.LINGER_MIN;
const BREAK_QUIET = TIMING.BREAK_QUIET;
const BLAST_QUIET = TIMING.BLAST_QUIET;
const LINGER_MAX = TIMING.LINGER_MAX;
/** Баннер победы — через столько после гибели последней свиньи (ядро ждёт покоя до 3.5 с, исход уже не изменится). */
const WIN_BANNER_DELAY = 0.6;
/** Бонусные числа соседних птиц — на разной высоте (м): очередь сжата, числа шире промежутка между птицами. */
const BONUS_TIER_DY = 1.5;
/** Начало бонуса: пауза ядра под баннер (CLEARED_BANNER — баннер уже показан) идёт ×3, кроме последних 0.35 с;
 *  камера в это время уже летит к рогатке за BONUS_CAM_T. */
const BONUS_INTRO_SPEED = 3;
const BONUS_INTRO_KEEP = 0.35;
const BONUS_CAM_T = 0.7;
/** Подсказка уровня, мс. */
const HINT_MS = 5000;
/**
 * Поражение (как в AB2 — отдельная пауза со смеющимися свиньями): камера летит к сооружению LOSE_CAM_T, свиньи
 * смеются (и звук смеха), баннер «Уровень не пройден» — через LOSE_BANNER_AT, окно итогов — через LOSE_RESULTS_AT
 * Тап ускоряет: баннер сразу, окно через 0.3 с.
 */
const LOSE_CAM_T = 0.7;
const LOSE_BANNER_AT = 1.5;
const LOSE_RESULTS_AT = 2.4;
const LOSE_SKIP_RESULTS = 0.3;
/** Смех при поражении не повторяем, если свиньи уже смеялись после промаха за столько секунд до этого. */
const LAUGH_RECENT_S = 1.5;
/** Через сколько секунд после открытия окна итогов сцена под ним замирает (панель въезжает 0.42 с, затемнение 0.25 с). */
const RESULTS_FREEZE_S = 0.6;
/** Подсказка способности — через столько после выстрела (07 §10.4). */
const ABILITY_HINT_DELAY = 0.25;
/**
 * Манёвр способности для камеры, с: петля Сильвер (2π / OMEGA) с запасом на вход в пике — камера стоит, пока птица
 * в полосе [0.15, 0.85]. Хэлу манёвр не нужен: после дуги он действительно летит назад, и камера едет за ним —
 * плавно за счёт сглаженного упреждения (Camera.FOLLOW_TAU_LOOK); удержание полосы давало рывок на выходе из неё.
 */
const MANEUVER_S: Partial<Record<BirdType, number>> = {
  silver: (2 * Math.PI) / ABILITY.SILVER.OMEGA + 0.12,
};
/**
 * Покой в виде рогатки (READY, без ввода, частиц, перелёта, тряски, руки обучения): кадр рисуется не чаще IDLE_FPS,
 * после IDLE_LONG_S без ввода — не чаще IDLE_LONG_FPS (без GPU-растра вид рогатки в покое занимал 89 % главного
 * потока). Любое нажатие, клавиша или колесо сразу возвращают полную частоту; ввод «свежий» IDLE_INPUT_S.
 */
const IDLE_FPS = 30;
const IDLE_LONG_FPS = 15;
const IDLE_LONG_S = 12;
const IDLE_INPUT_S = 1;
/** Допекание в простое: следующий спрайт — только если в простое осталось столько мс; не больше стольких за раз. */
const IDLE_WARM_MIN_MS = 6;
const IDLE_WARM_MAX = 3;
/** Допекание в простое останавливается, когда кэш спрайтов занят больше чем на эту долю бюджета. */
const IDLE_WARM_BUDGET_K = 0.85;
/** Проверка «свинья укатилась из вида рогатки» в READY — раз в столько секунд; перелёт, если камера уже едет, с. */
const REFIT_EVERY = 0.25;
const REFIT_FLY_T = 0.5;

/** Признаки способности птицы в тексте подсказки уровня (имя или действие). */
const ABILITY_WORDS: Partial<Record<BirdType, RegExp>> = {
  blues: /раздел|на три/i,
  chuck: /Чак/,
  bomb: /Бомб/,
  matilda: /Матильд|яйц/i,
  hal: /Хэл/,
  silver: /Сильвер/,
};

/**
 * Способность какой птицы уровня объясняет его подсказка («Коснитесь экрана в полёте…»): тип птицы или null. Тогда
 * тост способности в первом полёте этой птицы не нужен — подсказка только что сказала то же самое.
 */
export function hintAbility(level: Pick<LevelDef, 'hint' | 'birds'>): BirdType | null {
  const h = level.hint ?? '';
  if (!/Коснитесь/i.test(h)) return null;
  for (const b of level.birds) {
    const re = ABILITY_WORDS[b];
    if (re && re.test(h)) return b;
  }
  return null;
}

/** Позы совпадают (с точностью до 5 см). */
function samePose(a: CameraPose, b: CameraPose): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.viewH - b.viewH) < 0.05;
}

/**
 * Прогрев физики под шторкой: пробный настильный выстрел в отдельной сессии того же уровня (2 с симуляции), чтобы
 * JIT решателя контактов planck случился сейчас, а не на первом ударе (плейтест №1, п. 4). По кускам: усадка,
 * выстрел и полёт — по 40 шагов (загрузка уступает кадр между кусками). Ошибка — предупреждение, дальше куски пусты.
 */
export function warmPhysicsSteps(level: LevelDef): Array<() => void> {
  let s: GameSession | null = null;
  const guard = (fn: () => void) => (): void => {
    try {
      fn();
    } catch (e) {
      console.warn('[warm]', e);
      s = null;
    }
  };
  const steps: Array<() => void> = [
    guard(() => {
      s = createSession(level, { seed: 1 });
      for (let i = 0; i < 60 && s.state !== 'ready'; i++) s.step();
      s.launch(20, 1);
    }),
  ];
  for (let k = 0; k < 3; k++) {
    steps.push(
      guard(() => {
        if (!s) return;
        for (let i = 0; i < 40; i++) s.step();
        s.drainEvents();
      }),
    );
  }
  return steps;
}

/** Прогрев физики разом (все куски warmPhysicsSteps). Возвращает время, мс. */
export function warmPhysics(level: LevelDef): number {
  const t0 = performance.now();
  for (const step of warmPhysicsSteps(level)) step();
  return performance.now() - t0;
}

/** Габарит живых свиней сессии (x ± r, y + r), null — свиней нет. */
export function pigBox(s: Pick<GameSession, 'entities'> | null): LiveBox | null {
  if (!s) return null;
  let left = Infinity;
  let right = -Infinity;
  let top = -Infinity;
  for (const e of s.entities()) {
    if (e.kind !== 'pig') continue;
    left = Math.min(left, e.x - e.radius);
    right = Math.max(right, e.x + e.radius);
    top = Math.max(top, e.y + e.radius);
  }
  return Number.isFinite(right) ? { left, right, top } : null;
}

/** Досчёт финала победы при рестарте/выходе — не больше стольких шагов (60 с симуляции). */
const FINISH_MAX_STEPS = 3600;

/**
 * Исход решён (свиней нет), а итогов ещё нет: прокрутить сессию до levelEnd (покой, бонус за птиц) без эффектов
 * и звука. Итог победы или null — исход не решён, уровень уже закончен или levelEnd не пришёл за maxSteps.
 */
export function finishWin(
  s: Pick<GameSession, 'pigsLeft' | 'state' | 'step' | 'drainEvents'>,
  maxSteps = FINISH_MAX_STEPS,
): { score: number; stars: number } | null {
  if (s.pigsLeft > 0 || s.state === 'won' || s.state === 'lost') return null;
  for (let i = 0; i <= maxSteps; i++) {
    for (const e of s.drainEvents()) if (e.type === 'levelEnd') return e.won ? { score: e.score, stars: e.stars } : null;
    if (i < maxSteps) s.step();
  }
  return null;
}

export type GamePhase = 'none' | 'loading' | 'intro' | 'play' | 'ended';

export interface GameScreenDeps {
  host: CanvasHost;
  cache: SpriteCache;
  ui: UI;
  audio: AudioEngine;
  progress: ProgressStore;
  /** Порядок всех уровней кампании (для «Дальше»). */
  order: readonly string[];
  /** Сид новой сессии. */
  seed(): number;
  /** Кадр ожидания (для прогрева под шторкой). */
  nextFrame(): Promise<void>;
}

export interface LoadOptions {
  /** Облёт уровня в начале (false — сразу вид рогатки). */
  intro?: boolean;
  /** Повтор/рестарт: короткий облёт. */
  repeat?: boolean;
}

export class GameScreen {
  readonly camera = new GameCamera();
  readonly fx = new Fx();
  readonly renderer: Renderer;
  readonly input: InputController;
  session: GameSession | null = null;
  level: LevelDef | null = null;
  phase: GamePhase = 'none';
  paused = false;
  /** Включена подсказка траектории (настройка или обучающие уровни). */
  aimAssistSetting = false;
  /** Шагов за кадр сверх нормы — для тестов (fastForward) и ускорения бонуса. */
  private speed = 1;
  private acc = 0;
  private alpha = 1;
  private time = 0;
  private best = 0;
  private loadToken = 0;
  // облёт
  private introT = 0;
  private introHold = 0;
  private introPan = 0;
  private introPanning = false;
  // ход
  private userCam = false;
  private impacted = false;
  private abilityUsed = false;
  private shotBird: BirdType | null = null;
  private abilityHintIn = -1;
  /** Способность, которую объяснила подсказка уровня (тоста в первом полёте этой птицы не будет). */
  private hintedAbility: BirdType | null = null;
  /** Типы птиц, уже летавших в этой попытке. */
  private flown = new Set<BirdType>();
  private settleT = 0;
  /** Время сессии, когда стихнет последнее разрушение (блок, свинья, TNT — +0.4 с, взрыв — +0.8 с), с. */
  private quietAt = -Infinity;
  private returned = false;
  /** x птиц, за которых уже пришёл бонус (порядок — ярус надписи). */
  private bonusXs: number[] = [];
  private winBannerIn = -1;
  private winBannerShown = false;
  private bonusT = -1;
  private bonusCam = false;
  /** Время сессии входа в бонус, с. */
  private bonusSimT0 = -1;
  private loseIn = -1;
  private loseBannerIn = -1;
  /** Время сессии последнего смеха свиней (pigsLaugh), с. */
  private laughAt = -Infinity;
  private homeT = 0;
  private homeOn = false;
  private dirty = true;
  /** Время (time кадра), когда открыто окно итогов; −1 — не открыто. */
  private resultsAt = -1;
  /** Сколько кадров отрисовано (тесты: заморозка под итогами). */
  renders = 0;
  /** Время сессии последнего взрыва, с; −1 — не было (тесты: цена кадра взрыва). */
  lastBlastT = -1;
  /** Время кадра рендера (для fps-зависимых замеров). */
  lastRenderMs = 0;
  /** Сколько занял прогрев эффектов и физики при последней загрузке, мс. */
  fxWarmMs = 0;
  physWarmMs = 0;
  /** CPU-время последнего кадра (шаги + события + рендер), мс — для автокачества. */
  lastFrameMs = 0;
  /** Сколько секунд показана сцена уровня (облёт и игра, без пауз), для автокачества. */
  sceneTime = 0;
  /** Обучение прицелу на 1-1 (07 §10.5): сколько секунд птица ждёт в READY без захвата. */
  private tutorT = -1;
  /** «Уменьшить движение» (настройка или система) — ставит App (applyMotion). */
  private reduced = false;
  /** Покой: время (time кадра) последнего ввода, сколько прошло с последней отрисовки и накопленный dt рендер-анимаций. */
  private inputAt = 0;
  private sinceRender = 0;
  private renderDt = 0;
  /** Кадр в режиме покоя (реже рисуем) — автокачество его не мерит: ни пропуски, ни дешёвые кадры не про нагрузку. */
  idleThrottled = false;
  /** Вид рогатки, в который камеру отправили последним (aimPose); refit сверяет с ним камеру. */
  private aimAt: CameraPose | null = null;
  private refitT = 0;

  constructor(private readonly d: GameScreenDeps) {
    this.renderer = new Renderer(d.host.ctx, d.cache);
    this.input = new InputController(d.host.canvas, this.camera, {
      session: () => (this.phase === 'intro' || this.phase === 'play' || this.phase === 'ended' ? this.session : null),
      blocked: () => this.blocked(),
      onPause: () => undefined, // Esc/P обрабатывает UI (pauseRestartKeys: false)
      onRestart: () => undefined,
      onUserCamera: () => this.onUserCamera(),
      onSkipIntro: () => this.onSkip(),
      onToggleOverview: () => {
        this.camera.toggleOverview();
        this.userCam = true;
      },
      abilityReady: () => this.abilityReady(),
      // рука обучения оттягивает нарисованную птицу от кармашка — нажатие на неё тоже берёт птицу
      grabPoint: () => (this.tutorial() >= 0 ? this.renderer.tutorialPocket : null),
    });
    const sync = (): void => {
      // HUD на касании крупнее (UI: coarse ×1.15) — камера держит верх сооружения под ним
      this.camera.pointerCoarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
      this.camera.setViewport(d.host.cssW, d.host.cssH, d.host.dpr);
      // новый размер окна: в ожидании выстрела камера встаёт в новый вид рогатки (если игрок её не двигал)
      const st = this.session?.state;
      if (this.phase === 'play' && (st === 'ready' || st === 'loading') && !this.userCam && !this.camera.animating) this.camera.jumpTo(this.aimPose());
      this.dirty = true;
    };
    d.host.onChange(sync);
    sync();
    // любой ввод возвращает полную частоту кадров в покое
    if (typeof window !== 'undefined') {
      const poke = (): void => {
        this.inputAt = this.time;
      };
      for (const t of ['pointerdown', 'pointermove', 'keydown', 'wheel']) window.addEventListener(t, poke, { capture: true, passive: true });
    }
    // живые свиньи: укатившаяся за габарит уровня свинья остаётся в виде рогатки, облёте поражения и общем плане
    this.camera.liveProbe = () => pigBox(this.session);
    // HUD справа сверху — замер UI (ui.hudRect, CSS px окна) в координатах холста; до showHud — формула камеры
    this.camera.hudProbe = () => {
      const r = d.ui.hudRect();
      if (!r) return null;
      const c = d.host.canvas.getBoundingClientRect();
      return { w: c.right - r.left, h: r.bottom - c.top };
    };
  }

  // ───────────────────────── жизненный цикл уровня ─────────────────────────

  /**
   * Загрузить уровень: сессия, камера, прогрев спрайтов/фона/рельефа под шторкой. Облёт начинается вызовом start()
   * (после ui.showHud — шторка раскрывается вместе с облётом). false — загрузку перебили (другой уровень).
   */
  async load(level: LevelDef): Promise<boolean> {
    this.keepWin();
    const token = ++this.loadToken;
    this.phase = 'loading';
    this.paused = false;
    this.input.reset();
    this.begin(level);
    // прогрев: вид рогатки, вид сооружения (интро) и отдаление следования за навесным выстрелом (ступень √2)
    const aim = this.aimPose();
    const castle = this.camera.castleView();
    // ступени: вид рогатки, облёт, отдаление следования (√2) и предельное отдаление камеры (VIEW_H_MAX: навес, Z)
    const H = this.d.host.canvas.height;
    const scales = [H / aim.viewH, H / castle.viewH, H / Math.min(CAMERA.VIEW_H_MAX, aim.viewH * Math.SQRT2), H / CAMERA.VIEW_H_MAX];
    const items = this.renderer.warmList(scales, this.session!.entities());
    await this.d.cache.prewarm(items, { yieldFn: () => this.d.nextFrame(), sliceMs: 40 });
    if (token !== this.loadToken) return false;
    // дальше — кусками с уступкой кадра между ними (≤ 30–50 мс каждый): одна задача на 0.3–1.6 с морила голодом
    // секвенсор музыки меню под шторкой (обрыв мелодии на входе в уровень)
    const next = async (): Promise<boolean> => {
      await this.d.nextFrame();
      return token === this.loadToken;
    };
    // фон и рельеф — кусками ≤ 30 мс (полоса/облако/тайл за шаг): синхронный Background.prewarm на CPU×4 — 0.3–0.46 с
    const slice = { yieldFn: () => this.d.nextFrame(), sliceMs: 30 };
    this.camera.jumpTo(aim);
    await this.renderer.prewarmWorldAsync(this.camera.view(this.time), slice);
    if (!(await next())) return false;
    this.camera.jumpTo(castle);
    await this.renderer.prewarmBackgroundAsync(this.camera.view(this.time), slice);
    if (!(await next())) return false;
    this.fx.prewarm(scales[0]);
    // текстуры трещин камня и инея (noiseTile 128², ≈ 3–6 мс) — строились лениво на первом повреждении
    if (level.blocks.some((b) => b.material === 'stone')) stoneTile();
    if (level.blocks.some((b) => b.material === 'ice')) frostTile();
    if (!(await next())) return false;
    // первый удар птицы в игре стоил ~100 мс шага физики (JIT решателя контактов) — пробный выстрел в копии уровня
    this.physWarmMs = 0;
    for (const step of warmPhysicsSteps(level)) {
      const t0 = performance.now();
      step();
      this.physWarmMs += performance.now() - t0;
      if (!(await next())) return false;
    }
    // первое использование эффектов (атлас частиц, шрифт очков) — под шторкой, а не на первом ударе
    // масштабы: вид рогатки, облёт, затем весь диапазон зума камеры ступенями √2 (полёт отдаляет, щипок приближает)
    const fxScales = [scales[0], scales[1]];
    for (let h = CAMERA.VIEW_H_MIN; h <= CAMERA.VIEW_H_MAX * 1.01; h *= Math.SQRT2) fxScales.push(this.d.host.canvas.height / h);
    this.fxWarmMs = 0;
    for (const step of warmFxSteps(fxScales, this.camera.view(0), this.d.host.ctx)) {
      const t0 = performance.now();
      step();
      this.fxWarmMs += performance.now() - t0;
      if (!(await next())) return false;
    }
    // стадии повреждения блоков и свиней — допекаются после старта в простое (вид рогатки)
    this.idleWarm(token, levelDamageWarmList(level, [scales[0]], this.session!.entities()));
    this.camera.jumpTo(this.camera.castleView());
    // холст после прогрева эффектов — сразу настоящим кадром (стоп-кадр облёта)
    this.renderer.render(this.session!, { view: this.camera.view(this.time), alpha: 1, dt: 0, fx: this.fx, queueMinX: this.camera.queueMinX() });
    this.phase = 'intro';
    this.introPanning = false;
    this.introT = 0;
    this.introHold = Infinity; // стоп-кадр до start()
    return true;
  }

  /**
   * Допечь спрайты в простое главного потока (requestIdleCallback, иначе раз в 100 мс): по одному, пока в простое
   * остаётся ≥ 6 мс; бросает, как только загрузка сменилась (другой уровень, выход).
   */
  private idleWarm(token: number, items: WarmItem[]): void {
    if (items.length === 0) return;
    let i = 0;
    const ric = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    const cache = this.d.cache;
    const run = (d: { timeRemaining(): number }): void => {
      // уровень сменился — бросаем; кэш почти полон — не вытесняем ради стадий повреждения нужное сейчас
      if (token !== this.loadToken || cache.usedBytes > IDLE_WARM_BUDGET_K * cache.budgetBytes) return;
      let n = 0;
      while (i < items.length && (n === 0 || d.timeRemaining() > IDLE_WARM_MIN_MS) && n < IDLE_WARM_MAX) {
        cache.prewarmSync([items[i++]]);
        n++;
      }
      if (i < items.length) schedule();
    };
    const schedule = (): void => {
      if (ric) ric(run, { timeout: 1000 });
      else setTimeout(() => run({ timeRemaining: () => 8 }), 100);
    };
    schedule();
  }

  /** Начать уровень после загрузки: облёт (или сразу вид рогатки). */
  start(opts: LoadOptions = {}): void {
    if (!this.session || this.phase === 'loading' || this.phase === 'none') return;
    // пауза без панели паузы не должна заморозить облёт
    if (this.paused && !this.d.ui.pauseOpen) this.resume();
    this.startIntro(opts.intro !== false, opts.repeat === true);
  }

  /** Рестарт без подтверждения (01 §12.3): новая сессия того же уровня, короткий облёт. */
  restart(): void {
    if (!this.level) return;
    this.keepWin();
    this.loadToken++;
    this.paused = false;
    this.input.reset();
    this.d.audio.resetSession();
    this.d.audio.setPaused(false);
    this.begin(this.level);
    this.startIntro(true, true);
  }

  /** Выход в меню. */
  exit(): void {
    this.keepWin();
    this.loadToken++;
    this.input.reset();
    this.session = null;
    this.phase = 'none';
    this.paused = false;
    this.fx.clear();
    this.d.audio.resetSession();
    this.d.audio.setPaused(false);
  }

  /**
   * Рестарт, выход или другой уровень, пока победа решена (свиней нет), а окна итогов ещё нет (баннер, покой, бонус):
   * досчитать финал и записать победу — иначе R «сразу переиграть на 3 звезды» отбирал её и открытие следующего уровня.
   */
  private keepWin(): void {
    const s = this.session;
    const lv = this.level;
    if (!s || !lv || this.phase === 'ended' || this.phase === 'none') return;
    const r = finishWin(s);
    if (!r) return;
    this.phase = 'ended';
    this.d.progress.saveResult(lv.id, r.score, r.stars);
  }

  private begin(level: LevelDef): void {
    this.level = level;
    this.session = createSession(level, { seed: this.d.seed() });
    this.session.drainEvents();
    this.camera.setLevel(level);
    this.applyMotion(shakeOn(this.d.progress.settings, this.reduced), this.reduced);
    this.renderer.setLevel(level);
    this.fx.clear();
    this.fx.setTerrain(level.terrain);
    this.best = this.d.progress.record(level.id)?.best ?? 0;
    this.acc = 0;
    this.speed = 1;
    this.userCam = false;
    this.impacted = false;
    this.abilityUsed = false;
    this.shotBird = null;
    this.abilityHintIn = -1;
    this.hintedAbility = null;
    this.flown.clear();
    this.settleT = 0;
    this.quietAt = -Infinity;
    this.bonusXs = [];
    this.returned = true;
    this.winBannerIn = -1;
    this.winBannerShown = false;
    this.sceneTime = 0;
    this.bonusT = -1;
    this.bonusCam = false;
    this.bonusSimT0 = -1;
    this.loseIn = -1;
    this.loseBannerIn = -1;
    this.laughAt = -Infinity;
    this.resultsAt = -1;
    this.lastBlastT = -1;
    this.homeT = 0;
    this.tutorT = -1;
    this.aimAt = null;
    this.refitT = 0;
    this.setHome(false);
    this.dirty = true;
  }

  /** Вид рогатки (с живыми свиньями) — запоминается как цель камеры для refit. */
  private aimPose(): CameraPose {
    const a = this.camera.aimView();
    this.aimAt = a;
    return a;
  }

  /**
   * В ожидании выстрела свинья могла докатиться за край кадра: если камера стоит (или едет) в прежнем виде рогатки,
   * а вид с живыми свиньями другой — плавно доехать в новый. Камеру, которую игрок увёл паном или зумом, не трогаем.
   */
  private refit(): void {
    const prev = this.aimAt;
    const cam = this.camera;
    if (!prev || this.userCam) return;
    const next = cam.aimView();
    if (samePose(next, prev)) return;
    const cur = cam.flyTarget ?? { x: cam.x, y: cam.y, viewH: cam.viewH };
    if (!samePose(cur, prev)) return;
    this.aimAt = next;
    cam.flyToPose(next, cam.animating ? REFIT_FLY_T : cam.returnTime(next));
  }

  // ───────────────────────── облёт ─────────────────────────

  /**
   * «Тряска экрана» и «Уменьшить движение» (07 §19.3): shake — итог настройки (App: явное «вкл/выкл» или «авто» = не
   * reduced); при уменьшенном движении экранная вспышка взрыва не ярче α 0.12, очередь не подпрыгивает, облёта нет.
   */
  applyMotion(shake: boolean, reduced: boolean): void {
    this.reduced = reduced;
    this.camera.shakeEnabled = shake;
    this.fx.flashMax = reduced ? REDUCED_FLASH_MAX : 1;
    this.renderer.reducedMotion = reduced;
  }

  private startIntro(intro: boolean, repeat: boolean): void {
    if (!intro || this.reduced) {
      this.camera.jumpTo(this.aimPose());
      this.endIntro();
      return;
    }
    this.phase = 'intro';
    this.introT = 0;
    this.introHold = repeat ? CAMERA.INTRO_HOLD_REPEAT : CAMERA.INTRO_HOLD;
    this.introPan = this.camera.introPanTime(repeat);
    this.introPanning = false;
    this.camera.jumpTo(this.camera.castleView());
    this.d.ui.setSkipHint(!repeat);
  }

  private updateIntro(dt: number): void {
    this.introT += dt;
    if (!this.introPanning && this.introT >= this.introHold) {
      this.introPanning = true;
      this.camera.flyToPose(this.aimPose(), this.introPan, easeInOutSine);
    }
    if (this.introPanning && !this.camera.animating) this.endIntro();
  }

  /** Пропуск облёта: быстрый доезд за 0.3 с (immediate — сразу). */
  skipIntro(immediate = false): void {
    if (this.phase !== 'intro') return;
    if (immediate) {
      this.camera.jumpTo(this.aimPose());
      this.endIntro();
      return;
    }
    this.introPanning = true;
    this.introT = Math.max(this.introT, this.introHold);
    this.camera.flyToPose(this.aimPose(), CAMERA.INTRO_SKIP, easeOutCubic);
    this.d.ui.setSkipHint(false);
  }

  private endIntro(): void {
    this.phase = 'play';
    this.acc = 0;
    this.d.ui.setSkipHint(false);
    this.levelHint();
  }

  /**
   * Подсказка уровня после облёта: при первой попытке или после 2 поражений подряд (плейтест №1, п. 6). Пока на 1-1
   * идёт обучение прицелу (рука), текст не показывается — рука и есть подсказка (плейтест №2, п. 9).
   */
  private levelHint(): void {
    const lv = this.level;
    if (!lv?.hint) return;
    const p = this.d.progress;
    const key = `hint:${lv.id}`;
    if (this.aimTutorialActive()) {
      p.markSeen(key);
      return;
    }
    if (p.hasSeen(key) && p.failStreak(lv.id) < 2) return;
    p.markSeen(key);
    this.hintedAbility = hintAbility(lv);
    // хвостик облачка — к птице на рогатке (облёт закончен: камера в виде рогатки)
    const sl = lv.slingshot;
    const c = this.d.host.canvas.getBoundingClientRect();
    const at = this.camera.worldToScreen(sl.x, sl.y);
    this.d.ui.showHint(lv.hint, HINT_MS, { at: { x: c.left + at.x, y: c.top + at.y } });
  }

  // ───────────────────────── пауза ─────────────────────────

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.input.reset();
    this.d.audio.setPaused(true);
  }

  resume(): void {
    this.paused = false;
    this.acc = 0; // без «взрыва» физики после паузы
    this.d.audio.setPaused(false);
  }

  /** Тап по баннеру / «Коснитесь, чтобы пропустить» / ввод при blocked(). */
  onSkip(): void {
    if (this.phase === 'intro') {
      this.skipIntro();
      return;
    }
    const s = this.session;
    if (!s) return;
    // исход решён (свиней нет): тап ускоряет и остаток полёта, и ожидание покоя, и бонус (плейтест №2, п. 3)
    const st = s.state;
    if (st === 'bonus' || (s.pigsLeft === 0 && (st === 'flying' || st === 'settling'))) this.speed = UI_TIMING.BONUS_SKIP_SPEED;
    // поражение: тап — баннер сразу, окно итогов вскоре
    if (st === 'lost' && this.loseIn > 0) {
      if (this.loseBannerIn > 0) this.loseBannerIn = 1e-6;
      this.loseIn = Math.min(this.loseIn, LOSE_SKIP_RESULTS);
    }
  }

  /** Смех свиней при поражении (позы смеха ядро ставит само): звук, если после промаха они только что не смеялись. */
  private laughNow(): void {
    const s = this.session;
    if (!s || s.time - this.laughAt < LAUGH_RECENT_S) return;
    const pigs: PigType[] = [];
    for (const e of s.entities()) if (e.kind === 'pig' && e.pigType) pigs.push(e.pigType);
    if (pigs.length === 0) return;
    this.laughAt = s.time;
    try {
      this.d.audio.handle({ type: 'pigsLaugh', pigs }, { camX: this.camera.x, viewW: this.camera.viewW });
    } catch (err) {
      console.error('[audio]', err);
    }
  }

  /** «К рогатке». */
  cameraHome(): void {
    if (!this.session) return;
    this.userCam = false;
    this.camera.flyToPose(this.aimPose(), this.camera.returnTime());
    this.setHome(false);
  }

  /** Прокрутить симуляцию на sec секунд сразу (тестовый хук). */
  fastForward(sec: number): void {
    if (!this.session || this.phase === 'intro') return;
    const n = Math.max(0, Math.round(sec / DT));
    for (let i = 0; i < n; i++) {
      this.session.step();
      if (i % 30 === 29) this.dispatch(this.session.drainEvents(), 0.5);
    }
    this.dispatch(this.session.drainEvents(), 0);
  }

  // ───────────────────────── кадр ─────────────────────────

  /** Кадр игрового экрана: dt — реальное время кадра, с; time — монотонное время приложения, с. */
  frame(dt: number, time: number): void {
    const f0 = performance.now();
    this.frameBody(dt, time);
    const ms = performance.now() - f0;
    this.lastFrameMs = ms;
    if ((this.phase === 'play' || this.phase === 'intro') && !this.paused) this.sceneTime += dt;
    this.frameMs = this.frameMs * 0.9 + ms * 0.1;
    this.frameMsMax = Math.max(this.frameMsMax * 0.995, ms);
  }

  /** Среднее (EMA) и затухающий максимум времени кадра на CPU, мс: шаги физики + события + рендер. */
  frameMs = 0;
  frameMsMax = 0;

  private frameBody(dt: number, time: number): void {
    this.time = time;
    const s = this.session;
    if (!s || this.phase === 'loading' || this.phase === 'none') return;
    this.input.update();
    // под окном итогов (после его въезда, Б10) сцена замирает: исход записан (levelEnd), под затемнением ничего не
    // видно — ни шагов физики и эффектов, ни перерисовки; холст не меняется, и композитору не нужно каждый кадр заново
    // принимать полноэкранную текстуру. Смена размера окна перерисует стоп-кадр один раз (dirty)
    const still = this.paused || this.frozen;
    if (!still) {
      if (this.phase === 'intro') this.updateIntro(dt);
      else {
        const k = this.stepK();
        this.acc = advance(this.acc, dt * k, DT, MAX_STEPS * k, () => s.step()).acc;
      }
      this.alpha = Math.min(1, this.acc / DT);
      this.dispatch(s.drainEvents(), dt);
      this.timers(dt);
      this.updateCamera(dt);
      this.fx.update(dt);
      const shake = this.fx.takeShake();
      if (shake) this.camera.shake(shake.amount, shake.duration);
      this.camera.update(dt);
    }
    this.idleThrottled = false;
    if (still && !this.dirty) {
      this.hud();
      return;
    }
    // покой в виде рогатки — реже (рендер-анимации получают накопленный dt)
    this.sinceRender += dt;
    this.renderDt += still ? 0 : dt;
    const minGap = this.dirty ? 0 : this.idleFrameGap(time);
    this.idleThrottled = minGap > 0;
    if (minGap > 0 && this.sinceRender < minGap - 1e-4) {
      this.hud();
      return;
    }
    const rdt = Math.min(0.25, this.renderDt);
    this.sinceRender = 0;
    this.renderDt = 0;
    this.dirty = false;
    const t0 = performance.now();
    this.renderer.render(s, {
      view: this.camera.view(time),
      alpha: this.phase === 'intro' ? 1 : this.alpha,
      dt: still ? 0 : rdt,
      aimAssist: this.aimAssist(),
      fx: this.fx,
      tutorial: this.tutorial(),
      queueMinX: this.camera.queueMinX(),
    });
    this.lastRenderMs = performance.now() - t0;
    this.renders++;
    this.hud();
  }

  /**
   * Наименьший промежуток между кадрами в покое, с (0 — рисовать каждый кадр): READY в игре без ввода за IDLE_INPUT_S,
   * без жеста, перелёта и инерции камеры, тряски, частиц и руки обучения.
   */
  private idleFrameGap(time: number): number {
    const s = this.session;
    const cam = this.camera;
    if (!s || this.phase !== 'play' || this.paused || s.state !== 'ready') return 0;
    if (time - this.inputAt < IDLE_INPUT_S || this.input.gesture !== 'none' || this.tutorial() >= 0) return 0;
    if (cam.animating || cam.coasting || cam.shakeAmplitude > 0 || cam.keyPan.vx !== 0 || cam.keyPan.vy !== 0) return 0;
    if (this.fx.count > 0) return 0;
    return 1 / (time - this.inputAt >= IDLE_LONG_S ? IDLE_LONG_FPS : IDLE_FPS);
  }

  /** Сцена под окном итогов замерла (прошло RESULTS_FREEZE_S после его открытия). */
  get frozen(): boolean {
    return this.resultsAt >= 0 && this.time - this.resultsAt > RESULTS_FREEZE_S;
  }

  /** Перерисовать кадр (смена размера на паузе). */
  invalidate(): void {
    this.dirty = true;
  }

  private hud(): void {
    const s = this.session;
    if (!s) return;
    this.d.ui.updateHud({ score: s.score, best: Math.max(this.best, 0), birdsLeft: s.birdsLeft, pigsLeft: s.pigsLeft });
  }

  /** Призрачный палец обучения: время цикла (с) или −1. */
  private tutorial(): number {
    if (this.tutorT < 1.5 || this.session?.state !== 'ready' || this.paused) return -1;
    return (this.tutorT - 1.5) % 2.0;
  }

  private aimAssist(): boolean {
    const id = this.level?.id ?? '';
    return this.aimAssistSetting || (AIM_ASSIST.FORCED_LEVELS as readonly string[]).includes(id);
  }

  setFxQuality(q: FxQuality): void {
    this.fx.setQuality(q);
  }

  // ───────────────────────── события ─────────────────────────

  private dispatch(events: GameEvent[], _dt: number): void {
    if (events.length === 0) return;
    const s = this.session!;
    const listener = { camX: this.camera.x, viewW: this.camera.viewW };
    for (const e of events) {
      // бонус птиц — там, где птица нарисована (очередь сжата, кармашек приподнят)
      const fe = e.type === 'birdBonus' || (e.type === 'score' && e.kind === 'bonus') ? { ...e, ...this.bonusPoint(e.x, e.y) } : e;
      this.fx.handle(fe);
      try {
        this.d.audio.handle(fe, listener);
      } catch (err) {
        console.error('[audio]', err);
      }
      this.renderer.handle(e, s.time);
      this.onEvent(e);
    }
  }

  /**
   * Где показать бонус птицы (плейтест №2, п. 8): там, где птица нарисована (очередь сжата, кармашек приподнят),
   * и через одну — выше на BONUS_TIER_DY: соседние «10000» шире промежутка между птицами. birdBonus и score{bonus}
   * одной птицы получают одну точку (Fx склеивает их по близости).
   */
  private bonusPoint(x: number, y: number): { x: number; y: number } {
    let i = this.bonusXs.findIndex((bx) => Math.abs(bx - x) < 0.05);
    if (i < 0) {
      this.bonusXs.push(x);
      i = this.bonusXs.length - 1;
    }
    const m = this.renderer.mapQueuePoint(x, y);
    return { x: m.x, y: m.y + (i % 2) * BONUS_TIER_DY };
  }

  /** Сейчас идёт обучение прицелу (1-1, игрок ещё ни разу не стрелял). */
  private aimTutorialActive(): boolean {
    return this.level?.id === '1-1' && !this.d.progress.hasSeen('aimTutorial');
  }

  private onEvent(e: GameEvent): void {
    const ui = this.d.ui;
    switch (e.type) {
      case 'aimStart':
        ui.hideHint();
        this.tutorT = -1;
        break;
      case 'birdLaunched':
        this.quietAt = -Infinity;
        this.userCam = false;
        this.impacted = false;
        this.abilityUsed = false;
        this.returned = false;
        this.shotBird = e.bird;
        // тост способности: не в первом полёте птицы, чью способность только что объяснила подсказка уровня
        // (со второго полёта — если игрок так и не коснулся экрана: способность не отмечена использованной)
        this.abilityHintIn = e.bird === this.hintedAbility && !this.flown.has(e.bird) ? -1 : ABILITY_HINT_DELAY;
        this.flown.add(e.bird);
        this.setHome(false);
        if (!this.d.progress.hasSeen('aimTutorial')) this.d.progress.markSeen('aimTutorial');
        this.tutorT = -1;
        break;
      case 'ability': {
        this.abilityUsed = true;
        this.abilityHintIn = -1;
        ui.hideAbilityHint();
        this.d.progress.markSeen(`ability:${e.bird}`);
        // петля Сильвер: камера не мечется за перевёрнутой скоростью
        const man = MANEUVER_S[e.bird];
        if (man) this.camera.maneuver(man);
        break;
      }
      case 'birdImpact':
        this.impacted = true;
        this.abilityHintIn = -1;
        ui.hideAbilityHint();
        break;
      case 'explosion':
        this.lastBlastT = this.session?.time ?? -1;
        this.vibrate(e.source === 'egg' ? 25 : 45);
        this.noteBreak(BLAST_QUIET);
        break;
      case 'pigsLaugh':
        this.laughAt = this.session?.time ?? 0;
        break;
      case 'birdBonus': {
        // бонусная птица исчезает «пуфом» (02 §8.1): у Fx на birdBonus только искры и перья — даём облачко ухода
        const m = this.renderer.mapQueuePoint(e.x, e.y);
        this.fx.handle({ type: 'birdRemoved', id: -1, bird: e.bird, x: m.x, y: m.y });
        break;
      }
      case 'pigDestroyed':
        if (this.session && this.session.pigsLeft === 0 && this.winBannerIn < 0 && !this.winBannerShown) {
          this.winBannerIn = WIN_BANNER_DELAY;
          this.setHome(false);
        }
        this.noteBreak();
        break;
      case 'blockDestroyed':
      case 'tntDestroyed':
        this.noteBreak();
        break;
      case 'stateChanged':
        if (e.to === 'settling') {
          this.settleT = 0;
          this.returned = false;
        } else if (e.to === 'bonus') {
          this.bonusT = 0;
          this.bonusCam = false;
          this.bonusSimT0 = this.session?.time ?? -1;
          this.winBannerIn = -1;
          if (!this.winBannerShown) this.showWinBanner();
        } else if (e.to === 'lost') {
          // свиньи смеются — камера на них (и на укатившихся за габарит), баннер и окно итогов — после паузы
          this.camera.flyToPose(this.camera.castleView(), LOSE_CAM_T);
          this.loseBannerIn = LOSE_BANNER_AT;
          this.loseIn = LOSE_RESULTS_AT;
          this.setHome(false);
          ui.hideHint();
          ui.hideAbilityHint();
          this.laughNow();
        }
        break;
      case 'levelEnd':
        this.phase = 'ended';
        this.speed = 1;
        this.setHome(false);
        ui.hideAbilityHint();
        if (e.won) this.showWin(e.score, e.stars);
        else this.d.progress.saveLoss(this.level!.id);
        break;
      default:
        break;
    }
  }

  /** Разрушение (в любом состоянии, и в полёте): камера уедет с места событий не раньше чем через quiet после него. */
  private noteBreak(quiet: number = BREAK_QUIET): void {
    if (this.session) this.quietAt = Math.max(this.quietAt, this.session.time + quiet);
  }

  private showWinBanner(): void {
    this.winBannerShown = true;
    this.setHome(false);
    const s = this.session!;
    const n = this.level!.birds.length;
    const shots = n - s.birdsLeft;
    const badge = shots === 1 && n >= 2 ? S.winOneShot : shots === 2 && n >= 4 ? S.winClean : undefined;
    this.d.ui.showBanner(S.winBanner, 0, { kind: 'win', badge });
    // «уровень зачищен» сразу (джингл победы — по levelEnd, у окна итогов): взмах ленты и аккорд металлофона, ≈ 0.85 с
    try {
      this.d.audio.play('cleared');
    } catch (err) {
      console.error('[audio]', err);
    }
  }

  private showWin(score: number, stars: number): void {
    const id = this.level!.id;
    const p = this.d.progress;
    const { newRecord, prevBest } = p.saveResult(id, score, stars);
    this.best = Math.max(prevBest, score);
    const next = nextLevelId(id);
    const hasNext = next !== null && p.isUnlocked(next, this.d.order);
    // рекорд до этой победы (0 — первой победы; строку «Рекорд» тогда прячет UI — см. отчёт сборки)
    this.d.ui.showWin({ levelId: id, score, best: prevBest, stars, newRecord, hasNext });
    this.resultsAt = this.time;
  }

  private timers(dt: number): void {
    const s = this.session!;
    if (this.abilityHintIn > 0) {
      this.abilityHintIn -= dt;
      if (this.abilityHintIn <= 0) {
        this.abilityHintIn = -1;
        if (s.state === 'flying' && !this.impacted && !this.abilityUsed && this.shotBird) this.d.ui.abilityHint(this.shotBird);
      }
    }
    if (this.winBannerIn > 0) {
      this.winBannerIn -= dt;
      if (this.winBannerIn <= 0) {
        this.winBannerIn = -1;
        if (!this.winBannerShown && s.state !== 'lost' && s.state !== 'won') this.showWinBanner();
      }
    }
    if (this.loseBannerIn > 0) {
      this.loseBannerIn -= dt;
      if (this.loseBannerIn <= 0) {
        this.loseBannerIn = -1;
        this.d.ui.showBanner(S.loseBanner, 0, { kind: 'lose' });
      }
    }
    if (this.loseIn > 0) {
      this.loseIn -= dt;
      if (this.loseIn <= 0) {
        this.loseIn = -1;
        this.d.ui.showLose({ levelId: this.level!.id, score: s.score, pigsLeft: s.pigsLeft });
        this.resultsAt = this.time;
      }
    }
    // обучение прицелу: 1-1, пока игрок ни разу не стрелял; через 1.5 с ожидания в READY
    if (this.tutorT >= 0 || (this.level!.id === '1-1' && !this.d.progress.hasSeen('aimTutorial'))) {
      this.tutorT = s.state === 'ready' && this.phase === 'play' ? Math.max(0, this.tutorT) + dt : this.tutorT >= 0 ? 0 : -1;
    }
    const st = s.state;
    // свинья докатилась за край вида рогатки — камера доезжает (только из авто-вида, не во время жеста)
    if ((st === 'ready' || st === 'loading') && this.phase === 'play' && this.input.gesture === 'none') {
      this.refitT += dt;
      if (this.refitT >= REFIT_EVERY) {
        this.refitT = 0;
        this.refit();
      }
    } else this.refitT = 0;
    // «К рогатке»: рогатка вне кадра дольше 0.5 с в READY / SETTLING — пока исход не решён (после победы не нужна)
    const sl = this.level!.slingshot;
    const away =
      (st === 'ready' || st === 'settling') &&
      this.phase === 'play' &&
      s.pigsLeft > 0 &&
      !this.winBannerShown &&
      !this.camera.contains(sl.x, sl.y - 1.2, -0.5) &&
      !this.camera.animating;
    this.homeT = away ? this.homeT + dt : 0;
    this.setHome(this.homeT >= CAMERA.TO_SLING_BTN_DELAY);
  }

  private setHome(on: boolean): void {
    if (on === this.homeOn) return;
    this.homeOn = on;
    this.d.ui.setCameraHome(on);
  }

  // ───────────────────────── камера ─────────────────────────

  private updateCamera(dt: number): void {
    if (this.phase === 'intro') return;
    const s = this.session!;
    const cam = this.camera;
    switch (s.state) {
      case 'flying': {
        const f = s.focusBird();
        if (f && !this.userCam) cam.follow(f, dt);
        break;
      }
      case 'settling': {
        this.settleT += dt;
        const quiet = s.time >= this.quietAt;
        if (!this.returned && s.birdsLeft > 0 && s.pigsLeft > 0 && this.settleT >= LINGER && (quiet || this.settleT >= LINGER_MAX)) {
          this.returned = true;
          const pose = this.aimPose();
          const t = cam.returnTime(pose);
          cam.flyToPose(pose, t);
          // ядро зарядит птицу так, чтобы она легла в кармашек к приезду камеры
          s.releaseLinger(t);
        }
        break;
      }
      case 'loading':
        if (!this.returned) {
          this.returned = true;
          if (!cam.animating) cam.flyToPose(this.aimPose(), cam.returnTime());
        }
        break;
      case 'bonus':
        if (this.bonusT >= 0) this.bonusT += dt;
        if (!this.bonusCam && this.bonusT >= 0) {
          this.bonusCam = true;
          cam.flyToPose(this.aimPose(), BONUS_CAM_T);
        }
        break;
      default:
        break;
    }
  }

  private onUserCamera(): void {
    const st = this.session?.state;
    if (st === 'flying' || st === 'settling' || st === 'loading') this.userCam = true;
  }

  // ───────────────────────── ввод ─────────────────────────

  private blocked(): boolean {
    if (this.paused || this.phase !== 'play') return true;
    const st = this.session?.state;
    // все свиньи повержены — исход решён: новых выстрелов и способностей нет, тап ускоряет бонус
    if (this.session && this.session.pigsLeft === 0) return true;
    return st === 'bonus' || st === 'won' || st === 'lost';
  }

  /** Способность ещё может сработать: не использована и не было первого удара (у Бомба — до взрыва). */
  private abilityReady(): boolean {
    if (this.abilityUsed) return false;
    return !this.impacted || this.shotBird === 'bomb';
  }

  private vibrate(ms: number): void {
    if (!this.d.progress.settings.haptics) return;
    try {
      if (typeof navigator !== 'undefined' && matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(ms);
    } catch {
      /* нет вибрации */
    }
  }

  /** Сколько времени до конца облёта (для хуков). */
  get introLeft(): number {
    return this.phase === 'intro' ? Math.max(0, this.introHold + this.introPan - this.introT) : 0;
  }

  /** Множитель шагов на этот кадр: скорость (тап, тесты) или ×3 в начале бонуса (плейтест №2, п. 3). */
  private stepK(): number {
    const s = this.session;
    if (s && s.state === 'bonus' && this.bonusSimT0 >= 0 && s.time - this.bonusSimT0 < TIMING.CLEARED_BANNER - BONUS_INTRO_KEEP) {
      return Math.max(this.speed, BONUS_INTRO_SPEED);
    }
    return this.speed;
  }

  /** Сколько шагов назначено на кадр сверх нормы (тесты). */
  setSpeed(k: number): void {
    this.speed = Math.max(1, Math.min(16, Math.round(k)));
  }

  get stepSpeed(): number {
    return this.speed;
  }
}

