// Игровой экран: сессия ядра + камера + ввод + рендер + эффекты + звук + HUD (спецификация §4, 00 §1.12).
// Цикл: накопитель времени, session.step() строго по 1/60 с, не больше 4 шагов за кадр (лишний остаток
// выбрасывается), рендер интерполирует тела по alpha = acc / dt. Каждый кадр: события ядра → Fx, звук, рендер,
// камера (тряска), HUD, подсказки. Презентационные фазы — здесь: облёт в начале уровня (step() не вызывается,
// ввод рогатки заблокирован, любой ввод пропускает), пауза, баннеры, результаты.
// Плейтест №1: камера — GameCamera (вид рогатки ближе, облёт от сооружения); подсказка уровня — после облёта
// (первая попытка или 2 поражения подряд); баннер победы — через 1 с после последней свиньи (ядро ещё ждёт покоя);
// при поражении камера показывает свиней; камера задерживается на разрушении, пока оно идёт (≤ LINGER_MAX).

import { AIM_ASSIST, CAMERA, UI_TIMING, WORLD } from '../config/constants';
import { createSession } from '../core';
import type { GameSession } from '../core/api';
import type { GameEvent } from '../core/events';
import type { BirdType, LevelDef } from '../core/types';
import type { AudioEngine } from '../audio/AudioEngine';
import { InputController } from '../input/Input';
import { nextLevelId } from '../levels';
import { easeInOutSine, easeOutCubic } from '../render/Camera';
import { Fx, type FxQuality } from '../render/fx/Fx';
import { Renderer } from '../render/Renderer';
import type { SpriteCache } from '../render/SpriteCache';
import type { ProgressStore } from '../storage/progress';
import type { UI } from '../ui/UI';
import { S } from '../ui/strings';
import type { CanvasHost } from './CanvasHost';
import { GameCamera } from './GameCamera';
import { warmFx } from './fxWarm';
import { advance } from './loop';

const DT = WORLD.DT;
const MAX_STEPS = WORLD.MAX_STEPS_PER_FRAME;
/** Задержка камеры на месте событий после ухода птицы, затем возврат к рогатке (00 §1.12). */
const LINGER = 0.45;
/** Каждое разрушение во время задержки продлевает её на столько, но не дольше LINGER_MAX от начала (ядро всё равно
 *  зарядит следующую птицу по своим часам — тогда камера возвращается сразу). */
const LINGER_EXTEND = 0.6;
const LINGER_MAX = 2.5;
/** Баннер победы — через столько после гибели последней свиньи (ядро ждёт покоя до 3.5 с, исход уже не изменится). */
const WIN_BANNER_DELAY = 1.0;
/** Подсказка уровня, мс. */
const HINT_MS = 5000;
/** Подсказка способности — через столько после выстрела (07 §10.4). */
const ABILITY_HINT_DELAY = 0.25;

/** Уровень для ui.showHud: без текстовой подсказки — её показывает GameScreen после облёта (плейтест №1, п. 6). */
export function hudLevel(level: LevelDef): LevelDef {
  return level.hint === undefined ? level : { ...level, hint: undefined };
}

/**
 * Прогрев физики под шторкой: пробный настильный выстрел в отдельной сессии того же уровня (2 с симуляции), чтобы
 * JIT решателя контактов planck случился сейчас, а не на первом ударе (плейтест №1, п. 4). Возвращает время, мс.
 */
export function warmPhysics(level: LevelDef): number {
  const t0 = performance.now();
  try {
    const s = createSession(level, { seed: 1 });
    for (let i = 0; i < 60 && s.state !== 'ready'; i++) s.step();
    s.launch(20, 1);
    for (let i = 0; i < 120; i++) s.step();
    s.drainEvents();
  } catch (e) {
    console.warn('[warm]', e);
  }
  return performance.now() - t0;
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
  private settleT = 0;
  private lingerFor = LINGER;
  private returned = false;
  private winBannerIn = -1;
  private winBannerShown = false;
  private bonusT = -1;
  private bonusCam = false;
  private loseIn = -1;
  private homeT = 0;
  private homeOn = false;
  private dirty = true;
  /** Время кадра рендера (для fps-зависимых замеров). */
  lastRenderMs = 0;
  /** Сколько занял прогрев эффектов и физики при последней загрузке, мс. */
  fxWarmMs = 0;
  physWarmMs = 0;
  /** CPU-время последнего кадра (шаги + события + рендер), мс — для автокачества. */
  lastFrameMs = 0;
  /** Сколько секунд идёт фаза play (0 — облёт/загрузка), для автокачества. */
  playTime = 0;
  /** LOW-качество: фон масштабируется без сглаживания. */
  private fastScaling = false;
  /** Обучение прицелу на 1-1 (07 §10.5): сколько секунд птица ждёт в READY без захвата. */
  private tutorT = -1;

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
    });
    const sync = (): void => {
      this.camera.setViewport(d.host.cssW, d.host.cssH, d.host.dpr);
      // новый размер окна: в ожидании выстрела камера встаёт в новый вид рогатки (если игрок её не двигал)
      const st = this.session?.state;
      if (this.phase === 'play' && (st === 'ready' || st === 'loading') && !this.userCam && !this.camera.animating) this.camera.jumpTo(this.camera.aimView());
      this.dirty = true;
    };
    d.host.onChange(sync);
    sync();
  }

  // ───────────────────────── жизненный цикл уровня ─────────────────────────

  /**
   * Загрузить уровень: сессия, камера, прогрев спрайтов/фона/рельефа под шторкой. Облёт начинается вызовом start()
   * (после ui.showHud — шторка раскрывается вместе с облётом). false — загрузку перебили (другой уровень).
   */
  async load(level: LevelDef): Promise<boolean> {
    const token = ++this.loadToken;
    this.phase = 'loading';
    this.paused = false;
    this.input.reset();
    this.begin(level);
    // прогрев: вид рогатки и вид сооружения (интро)
    const aim = this.camera.aimView();
    const castle = this.camera.castleView();
    const scales = [this.d.host.canvas.height / aim.viewH, this.d.host.canvas.height / castle.viewH];
    const items = this.renderer.warmList(scales, this.session!.entities());
    await this.d.cache.prewarm(items, { yieldFn: () => this.d.nextFrame(), sliceMs: 40 });
    if (token !== this.loadToken) return false;
    this.camera.jumpTo(aim);
    this.renderer.prewarmWorld(this.camera.view(this.time));
    this.camera.jumpTo(castle);
    this.renderer.prewarmWorld(this.camera.view(this.time));
    this.fx.prewarm(scales[0]);
    // первый удар птицы в игре стоил ~100 мс шага физики (JIT решателя контактов) — пробный выстрел в копии уровня
    this.physWarmMs = warmPhysics(level);
    // первое использование эффектов (атлас частиц, шрифт очков) — под шторкой, а не на первом ударе
    // масштабы: вид рогатки, облёт, затем весь диапазон зума камеры ступенями √2 (полёт отдаляет, щипок приближает)
    const fxScales = [scales[0], scales[1]];
    for (let h = CAMERA.VIEW_H_MIN; h <= CAMERA.VIEW_H_MAX * 1.01; h *= Math.SQRT2) fxScales.push(this.d.host.canvas.height / h);
    this.fxWarmMs = warmFx(fxScales, this.camera.view(0), this.d.host.ctx);
    await this.d.nextFrame();
    if (token !== this.loadToken) return false;
    this.camera.jumpTo(this.camera.castleView());
    // холст после прогрева эффектов — сразу настоящим кадром (стоп-кадр облёта)
    this.renderer.render(this.session!, { view: this.camera.view(this.time), alpha: 1, dt: 0, fx: this.fx, queueMinX: this.camera.queueMinX() });
    this.phase = 'intro';
    this.introPanning = false;
    this.introT = 0;
    this.introHold = Infinity; // стоп-кадр до start()
    return true;
  }

  /** Начать уровень после загрузки: облёт (или сразу вид рогатки). */
  start(opts: LoadOptions = {}): void {
    if (!this.session || this.phase === 'loading' || this.phase === 'none') return;
    this.startIntro(opts.intro !== false, opts.repeat === true);
  }

  /** Рестарт без подтверждения (01 §12.3): новая сессия того же уровня, короткий облёт. */
  restart(): void {
    if (!this.level) return;
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
    this.loadToken++;
    this.input.reset();
    this.session = null;
    this.phase = 'none';
    this.paused = false;
    this.fx.clear();
    this.d.audio.resetSession();
    this.d.audio.setPaused(false);
  }

  private begin(level: LevelDef): void {
    this.level = level;
    this.session = createSession(level, { seed: this.d.seed() });
    this.session.drainEvents();
    this.camera.setLevel(level);
    this.camera.shakeEnabled = this.d.progress.settings.shake;
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
    this.settleT = 0;
    this.lingerFor = LINGER;
    this.returned = true;
    this.winBannerIn = -1;
    this.winBannerShown = false;
    this.playTime = 0;
    this.bonusT = -1;
    this.bonusCam = false;
    this.loseIn = -1;
    this.homeT = 0;
    this.tutorT = -1;
    this.setHome(false);
    this.dirty = true;
  }

  // ───────────────────────── облёт ─────────────────────────

  private startIntro(intro: boolean, repeat: boolean): void {
    const reduced = this.d.progress.settings.motion === 'reduce' || (typeof matchMedia === 'function' && this.d.progress.settings.motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!intro || reduced) {
      this.camera.jumpTo(this.camera.aimView());
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
      this.camera.flyToPose(this.camera.aimView(), this.introPan, easeInOutSine);
    }
    if (this.introPanning && !this.camera.animating) this.endIntro();
  }

  /** Пропуск облёта: быстрый доезд за 0.3 с (immediate — сразу). */
  skipIntro(immediate = false): void {
    if (this.phase !== 'intro') return;
    if (immediate) {
      this.camera.jumpTo(this.camera.aimView());
      this.endIntro();
      return;
    }
    this.introPanning = true;
    this.introT = Math.max(this.introT, this.introHold);
    this.camera.flyToPose(this.camera.aimView(), CAMERA.INTRO_SKIP, easeOutCubic);
    this.d.ui.setSkipHint(false);
  }

  private endIntro(): void {
    this.phase = 'play';
    this.acc = 0;
    this.playTime = 0;
    this.d.ui.setSkipHint(false);
    this.levelHint();
  }

  /** Подсказка уровня после облёта: при первой попытке или после 2 поражений подряд (плейтест №1, п. 6). */
  private levelHint(): void {
    const lv = this.level;
    if (!lv?.hint) return;
    const p = this.d.progress;
    const key = `hint:${lv.id}`;
    if (p.hasSeen(key) && p.failStreak(lv.id) < 2) return;
    p.markSeen(key);
    this.d.ui.showHint(lv.hint, HINT_MS);
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
    const st = this.session?.state;
    if (st === 'bonus') this.speed = UI_TIMING.BONUS_SKIP_SPEED;
  }

  /** «К рогатке». */
  cameraHome(): void {
    if (!this.session) return;
    this.userCam = false;
    this.camera.flyToPose(this.camera.aimView(), this.camera.returnTime());
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
    if (this.phase === 'play' && !this.paused) this.playTime += dt;
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
    if (!this.paused) {
      if (this.phase === 'intro') this.updateIntro(dt);
      else {
        this.acc = advance(this.acc, dt * this.speed, DT, MAX_STEPS * this.speed, () => s.step()).acc;
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
    if (this.paused && !this.dirty) {
      this.hud();
      return;
    }
    this.dirty = false;
    const bg = this.renderer.background;
    if (bg) bg.fastScaling = this.fastScaling;
    const t0 = performance.now();
    this.renderer.render(s, {
      view: this.camera.view(time),
      alpha: this.phase === 'intro' ? 1 : this.alpha,
      dt: this.paused ? 0 : dt,
      aimAssist: this.aimAssist(),
      fx: this.fx,
      tutorial: this.tutorial(),
      queueMinX: this.camera.queueMinX(),
    });
    this.lastRenderMs = performance.now() - t0;
    this.hud();
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
    this.fastScaling = q === 'low';
  }

  // ───────────────────────── события ─────────────────────────

  private dispatch(events: GameEvent[], _dt: number): void {
    if (events.length === 0) return;
    const s = this.session!;
    const listener = { camX: this.camera.x, viewW: this.camera.viewW };
    for (const e of events) {
      // бонус птиц — там, где птица нарисована (очередь сжата, кармашек приподнят)
      const fe = e.type === 'birdBonus' || (e.type === 'score' && e.kind === 'bonus') ? { ...e, ...this.renderer.mapQueuePoint(e.x, e.y) } : e;
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

  private onEvent(e: GameEvent): void {
    const ui = this.d.ui;
    switch (e.type) {
      case 'aimStart':
        ui.hideHint();
        this.tutorT = -1;
        break;
      case 'birdLaunched':
        this.userCam = false;
        this.impacted = false;
        this.abilityUsed = false;
        this.returned = false;
        this.shotBird = e.bird;
        this.abilityHintIn = ABILITY_HINT_DELAY;
        this.setHome(false);
        if (!this.d.progress.hasSeen('aimTutorial')) this.d.progress.markSeen('aimTutorial');
        this.tutorT = -1;
        break;
      case 'ability':
        this.abilityUsed = true;
        this.abilityHintIn = -1;
        ui.hideAbilityHint();
        this.d.progress.markSeen(`ability:${e.bird}`);
        break;
      case 'birdImpact':
        this.impacted = true;
        this.abilityHintIn = -1;
        ui.hideAbilityHint();
        break;
      case 'explosion':
        this.vibrate(e.source === 'egg' ? 25 : 45);
        this.extendLinger();
        break;
      case 'birdBonus': {
        // бонусная птица исчезает «пуфом» (02 §8.1): у Fx на birdBonus только искры и перья — даём облачко ухода
        const m = this.renderer.mapQueuePoint(e.x, e.y);
        this.fx.handle({ type: 'birdRemoved', id: -1, bird: e.bird, x: m.x, y: m.y });
        break;
      }
      case 'pigDestroyed':
        if (this.session && this.session.pigsLeft === 0 && this.winBannerIn < 0 && !this.winBannerShown) this.winBannerIn = WIN_BANNER_DELAY;
        this.extendLinger();
        break;
      case 'blockDestroyed':
      case 'tntDestroyed':
        this.extendLinger();
        break;
      case 'stateChanged':
        if (e.to === 'settling') {
          this.settleT = 0;
          this.lingerFor = LINGER;
          this.returned = false;
        } else if (e.to === 'bonus') {
          this.bonusT = 0;
          this.bonusCam = false;
          this.winBannerIn = -1;
          if (!this.winBannerShown) this.showWinBanner();
        } else if (e.to === 'lost') {
          ui.showBanner(S.loseBanner, 0, { kind: 'lose' });
          this.loseIn = UI_TIMING.LOST_BANNER;
          // свиньи смеются — камера на них (плейтест №1, п. 9)
          this.camera.flyToPose(this.camera.castleView(), 0.6);
          this.setHome(false);
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

  /** Разрушение во время задержки камеры — задержаться ещё (плейтест №1, п. 15). */
  private extendLinger(): void {
    if (this.session?.state !== 'settling' || this.returned) return;
    this.lingerFor = Math.min(LINGER_MAX, Math.max(this.lingerFor, this.settleT + LINGER_EXTEND));
  }

  private showWinBanner(): void {
    this.winBannerShown = true;
    const s = this.session!;
    const n = this.level!.birds.length;
    const shots = n - s.birdsLeft;
    const badge = shots === 1 && n >= 2 ? S.winOneShot : shots === 2 && n >= 4 ? S.winClean : undefined;
    this.d.ui.showBanner(S.winBanner, 0, { kind: 'win', badge });
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
    if (this.loseIn > 0) {
      this.loseIn -= dt;
      if (this.loseIn <= 0) {
        this.loseIn = -1;
        this.d.ui.showLose({ levelId: this.level!.id, score: s.score });
      }
    }
    // обучение прицелу: 1-1, пока игрок ни разу не стрелял; через 1.5 с ожидания в READY
    if (this.tutorT >= 0 || (this.level!.id === '1-1' && !this.d.progress.hasSeen('aimTutorial'))) {
      this.tutorT = s.state === 'ready' && this.phase === 'play' ? Math.max(0, this.tutorT) + dt : this.tutorT >= 0 ? 0 : -1;
    }
    // «К рогатке»: рогатка вне кадра дольше 0.5 с в READY / SETTLING
    const st = s.state;
    const sl = this.level!.slingshot;
    const away = (st === 'ready' || st === 'settling') && this.phase === 'play' && !this.camera.contains(sl.x, sl.y - 1.2, -0.5) && !this.camera.animating;
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
      case 'settling':
        this.settleT += dt;
        if (!this.returned && s.birdsLeft > 0 && s.pigsLeft > 0 && this.settleT >= this.lingerFor) {
          this.returned = true;
          cam.flyToPose(cam.aimView(), cam.returnTime());
        }
        break;
      case 'loading':
        if (!this.returned) {
          this.returned = true;
          if (!cam.animating) cam.flyToPose(cam.aimView(), cam.returnTime());
        }
        break;
      case 'bonus':
        if (this.bonusT >= 0) this.bonusT += dt;
        if (!this.bonusCam && this.bonusT >= 0.4) {
          this.bonusCam = true;
          cam.flyToPose(cam.aimView(), 0.8);
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

  /** Сколько шагов назначено на кадр сверх нормы (тесты). */
  setSpeed(k: number): void {
    this.speed = Math.max(1, Math.min(16, Math.round(k)));
  }

  get stepSpeed(): number {
    return this.speed;
  }
}

