// Фасад интерфейса (07 §1): слои DOM поверх canvas, автомат экранов, переходы, оверлеи, диалоги, клавиатура.
// Меню прозрачные (под ними — живая сцена на canvas); есть запасной CSS-фон (setMenuBackground('css')).
//
// ─────────────────────────────── ПУБЛИЧНЫЙ API ───────────────────────────────
// type UISound = 'click'|'back'|'pop'|'swoosh'|'star1'|'star2'|'star3'|'tick'|'win'|'lose'|'newRecord'
// interface UIAudio { ui(name: UISound): void; unlock(): Promise<void>; readonly ready?: boolean; setSfx(on: boolean): void; setMusic(on: boolean): void }
//   (unlock вызывается на pointerdown/pointerup/touchend/click/keydown, пока ready !== true)
// type ScreenId = 'loading'|'title'|'episodes'|'levels'|'game'
// interface UIDeps {
//   episodes: readonly EpisodeDef[]; progress: ProgressStore; audio?: UIAudio;
//   onPlayLevel(levelId: string): void;   // шторка закрыта → загрузить уровень → ui.showHud(level)
//   onPause(): void;                       // пауза открыта пользователем/вкладкой/поворотом → не вызывать step()
//   onResume(): void;                      // панель паузы уехала → продолжить (аккумулятор = 0)
//   onRestart(): void;                     // экран под фейдом → createSession заново (UI сам обнулит HUD и откроет фейд)
//   onQuitToMenu(): void;                  // шторка закрыта → выйти из уровня; UI покажет уровни эпизода, если приложение не показало иное
//   onNextLevel(): void;                   // шторка закрыта → следующий уровень → ui.showHud(next)
//   onToggleFullscreen?(): void;           // своя реализация полного экрана (иначе Fullscreen API)
//   onSkip?(): void;                       // тап по баннеру — ускорить баннер/бонус
//   onCameraHome?(): void;                 // кнопка «К рогатке» (видна после setCameraHome(true))
//   onScreenChange?(screen: ScreenId, theme: ThemeId): void;   // музыка меню/уровня, тема фона меню на canvas
//   onSettingsChange?(s: Readonly<Settings>): void;            // качество, тряска, прицел и т. п.; звук UI применяет сам
//   useHistory?: boolean;                  // системная «Назад» (popstate): игра → пауза → уровни → эпизоды → титул; по умолчанию true
// }
// class UI {
//   constructor(root: HTMLElement, deps: UIDeps)
//   readonly screen: ScreenId
//   showLoading(progress01: number, tip?: string): void
//   showTitle(): void; showEpisodes(): void; showLevels(episodeId: string): void
//   showHud(level: LevelDef): void                               // экран игры; раскрывает шторку от рогатки
//   updateHud(s: { score: number; best: number; birdsLeft: number; pigsLeft: number }): void  // можно каждый кадр
//   showHint(text: string, ms = 4000, opts?: { bird?: BirdType; at?: { x: number; y: number } }): void
//                                       // облачко под плашкой уровня; говорит opts.bird (по умолчанию первая птица уровня);
//                                       // хвостик — только с opts.at (точка в CSS px окна, например рогатка): тянется к ней
//   hideHint(): void                                             // касания не ловит — прятать по aimStart
//   showBanner(text: string, ms = 1500, opts?: { kind?: 'win'|'lose'|'info'; badge?: string }): void  // ms ≤ 0 — до hideBanner()
//   hideBanner(): void
//   showPause(): void; hidePause(): void                         // программно, без onPause/onResume
//   showWin(r: { levelId; score; best; stars; newRecord; hasNext }): void   // прогресс уже записан приложением;
//                                       // best — рекорд ДО этой победы (prevBest): строка «Рекорд» видна, только если он есть и не побит
//   showLose(r: { levelId: string; failStreak?: number; tip?: string; score?: number; pigsLeft?: number }): void
//                                       // failStreak по умолчанию — progress.failStreak; score — «Счёт: 23 450»;
//                                       // pigsLeft и score выбирают дразнилку («Почти получилось!» — только при одной свинье)
//   (showWin/showLose: если висит баннер, его лента перелетает в заголовок панели — FLIP 0.35 с)
//   hideOverlays(): void                                         // пауза, результаты, баннер, подсказка
//   setMotion(reduced: boolean | null): void                     // null — по настройке «Анимации» / системе
//   // расширения:
//   setSkipHint(on: boolean): void; setCameraHome(on: boolean): void
//   hudRect(): DOMRect | null           // правый блок HUD (рекорд, счёт, свиньи) в CSS px окна, без transform-анимаций;
//                                       // место под пятизначный счёт зарезервировано; null — HUD нет (камера держит сооружение под ним)
//   abilityHint(bird: BirdType): boolean; hideAbilityHint(): void  // подсказка способности (не показывается, если progress.hasSeen('ability:<bird>'))
//   toast(text: string, ms = 2500, key = text): void   // тот же key заменяет показанный/ожидающий; ждут ≤ 2
//   openSettings(): void
//   setMenuBackground(mode: 'transparent'|'css'): void; finishAnimations(): void
//   readonly letterbox: boolean  (при смене UI шлёт window 'resize'); hideAll(): void; destroy(): void
// }
// Порядок победы в приложении: const { newRecord, prevBest } = progress.saveResult(id, score, stars);
//   ui.showWin({ levelId: id, score, best: prevBest, stars, newRecord, hasNext: progress.isUnlocked(nextId, order) }).
// Поражение: progress.saveLoss(id); ui.showLose({ levelId: id, score, pigsLeft }) — после 3 поражений подряд показывается совет.
// ──────────────────────────────────────────────────────────────────────────────

import './styles.css';
import type { BirdType, LevelDef, ThemeId } from '../core/types';
import type { Settings } from '../storage/progress';
import { CSS_EASE, anim, done, motion, popIn } from './anim';
import { artScale, characterCanvas } from './art';
import type { LevelLoc, OverlayView, ScreenId, UIDeps, UISound, UiCtx, View } from './ctx';
import { button, centerOf, focusEl, focusables, h, ribbon } from './dom';
import { loadFonts } from './fonts';
import { hintTail } from './hintTail';
import { DEFS_SVG, icon } from './icons';
import { Iris } from './iris';
import { LETTERBOX_H, LETTERBOX_W, U_MENU_MAX, applyLayout, computeUiScale, letterboxScale, needsRotate } from './layout';
import { EpisodesView } from './screens/episodes';
import { HudView } from './screens/hud';
import { LevelsView } from './screens/levels';
import { LoadingView } from './screens/loading';
import { PauseView } from './screens/pause';
import { LoseView, WinView, type WinResult } from './screens/results';
import { ConfirmDialog, SettingsDialog, type DialogView } from './screens/settings';
import { TitleView } from './screens/title';
import { ABILITY_HINTS, ABILITY_KEY, LOSE_TIPS, S } from './strings';
import { queueToast, type ToastItem } from './toastQueue';
import { AudioUnlocker, UNLOCK_EVENTS } from './unlock';
import { syncToggles } from './toggles';

export type { ScreenId, UIAudio, UIDeps, UISound } from './ctx';
export type { WinResult } from './screens/results';

type Dir = 'fwd' | 'back' | 'fade' | 'none';

/** Зум карточки эпизода (07 §5.4): 'in' — карточка раскрывается в экран уровней, 'out' — экран сжимается обратно в карточку. */
interface Zoom {
  card: HTMLElement;
  mode: 'in' | 'out';
}

/** Тайминги переходов меню (07 §5.2). */
const SLIDE_IN_MS = 360;
const SLIDE_OUT_MS = 240;
/** Новый экран начинает въезжать, когда старый почти ушёл: без «двойной экспозиции». */
const SLIDE_IN_DELAY_MS = 130;
/** Старый экран гаснет быстрее, чем уезжает (прозрачность линейно), чтобы не накладываться на новый. */
const FADE_OUT_MS = 170;
const ZOOM_MS = 620;

export interface BannerOpts {
  kind?: 'win' | 'lose' | 'info';
  /** Пилюля под лентой («Одним выстрелом!»). */
  badge?: string;
}

/** Если приложение не вызвало showHud/showLevels после закрытия шторки — открыть её сами через это время. */
const IRIS_SAFETY_MS = 5000;
/** Высота окна (CSS px), с которой включается компактная вёрстка панелей (data-low). */
const LOW_H = 430;
/** Сколько поражений подряд до совета на экране поражения (07 §13.2). */
const TIP_AFTER_FAILS = 3;

export class UI {
  private readonly root: HTMLElement;
  private readonly L: Record<'bg' | 'hud' | 'screens' | 'overlays' | 'dialogs' | 'toasts' | 'rotate', HTMLElement>;
  /**
   * Полоса 16:9 для меню, оверлеев и диалогов. В обычном режиме — весь экран; в «Играть так» (портрет)
   * верстается как 640×360 и масштабируется в полосу, а HUD, подсказки и тосты остаются в полный размер
   * в тонированных полосах сверху и снизу (07 §15.1); пауза, результаты и диалоги тогда — во всё окно (placeModalLayers).
   */
  private readonly band: HTMLElement;
  private readonly live: HTMLElement;
  private readonly iris: Iris;
  private readonly ctx: UiCtx;
  private readonly locs = new Map<string, LevelLoc>();
  private readonly order: string[] = [];
  private readonly seenLocked = new Set<string>();
  private _screen: ScreenId = 'loading';
  private view: View | null = null;
  private hud: HudView | null = null;
  private overlay: OverlayView | null = null;
  private readonly dialogs: DialogView[] = [];
  private level: LevelDef | null = null;
  private birdsLeft = 0;
  private busy = false;
  private irisMode: 'iris' | 'fade' = 'iris';
  private safetyTimer = 0;
  private hintEl: HTMLElement | null = null;
  /** Размер окна, для которого нарисован хвостик подсказки (после resize он указывал бы мимо). */
  private hintTailAt = '';
  /** Размер окна последнего relayout (hudRect досчитывает раскладку, если resize до UI ещё не дошёл). */
  private layoutAt = '';
  private hintTimer = 0;
  private abilityEl: HTMLElement | null = null;
  private abilityTimer = 0;
  private bannerEl: HTMLElement | null = null;
  private bannerTimer = 0;
  private toastEl: HTMLElement | null = null;
  /** Показанный тост (null, пока он гаснет или его нет). */
  private toastCur: ToastItem | null = null;
  private toastTimer = 0;
  private readonly toastQueue: ToastItem[] = [];
  private readonly unlocker: AudioUnlocker;
  private playAnyway = false;
  private rotateOn = false;
  /** Пауза открыта оверлеем «Поверните устройство», а не игроком: снимается сама, когда оверлей уходит (Б8). */
  private autoPaused = false;
  private storageWarned = false;
  private menuBg: 'transparent' | 'css' = 'transparent';
  private resumeToken = 0;
  private motionOverride: boolean | null = null;
  private applied: Settings;
  private progressSig = '';
  private readonly unsub: Array<() => void> = [];
  /** В истории браузера лежит наша запись-«страж» (системная «Назад» сначала идёт по игре). */
  private histGuard = false;
  private readonly useHistory: boolean;
  private readonly ro: ResizeObserver | null = null;
  private readonly mql: MediaQueryList | null = null;

  constructor(
    host: HTMLElement,
    private readonly deps: UIDeps,
  ) {
    void loadFonts();
    for (const [ei, ep] of deps.episodes.entries())
      ep.levels.forEach((level, index) => {
        this.locs.set(level.id, { level, episode: ep, epIndex: ei, index, globalIndex: this.order.length });
        this.order.push(level.id);
      });

    this.root = h('div', { class: 'abui', 'data-fallback-bg': '0' });
    this.root.insertAdjacentHTML('beforeend', DEFS_SVG);
    const layer = (name: string, extra: Record<string, string> = {}): HTMLElement => h('div', { class: `abui-layer abui-${name}`, ...extra });
    this.L = {
      bg: layer('bg', { 'aria-hidden': 'true' }),
      hud: layer('hud'),
      screens: layer('screens'),
      overlays: layer('overlays'),
      dialogs: layer('dialogs'),
      toasts: layer('toasts'),
      rotate: layer('rotate'),
    };
    this.L.bg.append(this.buildFallbackBg());
    this.live = h('div', { class: 'abui-sr', 'aria-live': 'polite', role: 'status' });
    this.band = h('div', { class: 'abui-band' }, this.L.bg, this.L.screens, this.L.overlays, this.L.dialogs);
    this.root.append(this.band, this.L.hud, this.L.toasts, this.L.rotate, this.live);
    this.L.rotate.append(this.buildRotate());
    host.append(this.root);
    this.iris = new Iris(this.root);

    this.ctx = this.makeCtx();
    this.applied = { ...deps.progress.settings };
    this.progressSig = this.levelsSig();

    // движение: системная настройка + настройка «Анимации»
    if (typeof matchMedia === 'function') {
      this.mql = matchMedia('(prefers-reduced-motion: reduce)');
      this.mql.addEventListener?.('change', this.applyMotion);
    }
    this.applyMotion();
    // масштаб и ориентация
    this.relayout();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.relayout());
      this.ro.observe(this.root);
    }
    window.addEventListener('resize', this.relayout);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('fullscreenchange', this.onFullscreen);
    // системная «Назад» и жест Android (07 §1.2)
    this.useHistory = deps.useHistory !== false && typeof history !== 'undefined' && typeof history.pushState === 'function';
    if (this.useHistory) window.addEventListener('popstate', this.onPopState);
    // звук: пробуем на каждом жесте-активации, пока контекст не запущен
    this.unlocker = new AudioUnlocker(deps.audio);
    this.unlocker.onDone = () => this.unbindUnlock();
    if (!this.unlocker.done) for (const ev of UNLOCK_EVENTS) window.addEventListener(ev, this.unlockAudio, { capture: true, passive: true });

    // прогресс: запись другой вкладки и любые изменения настроек
    this.unsub.push(deps.progress.bindStorageEvents(), deps.progress.onChange(this.onProgressChange));

    // применить сохранённые настройки звука
    const s = deps.progress.settings;
    deps.audio?.setSfx(s.sfx);
    deps.audio?.setMusic(s.music);
  }

  // ───────────────────────── публичный API ─────────────────────────

  get screen(): ScreenId {
    return this._screen;
  }

  showLoading(progress01: number, tip?: string): void {
    if (!(this.view instanceof LoadingView)) {
      this.clearGame();
      this.swap(new LoadingView(), 'none', 'meadow');
    }
    (this.view as LoadingView).set(progress01, tip);
  }

  showTitle(): void {
    if (this.view?.id === 'title' && this._screen === 'title') {
      void this.revealMenu();
      return;
    }
    const from = this._screen;
    this.clearGame();
    this.swap(new TitleView(this.ctx), this.iris.active ? 'none' : from === 'loading' ? 'fade' : 'back', 'meadow');
    void this.revealMenu();
    if (!this.deps.progress.persistent && !this.storageWarned) {
      this.storageWarned = true;
      window.setTimeout(() => this.toast(S.toastStorageOff, 3500), 900);
    }
  }

  showEpisodes(): void {
    this.goEpisodes(this._screen === 'title' ? 'fwd' : 'back');
  }

  showLevels(episodeId: string): void {
    this.goLevels(episodeId, this._screen === 'episodes' || this._screen === 'title' ? 'fwd' : 'back');
  }

  showHud(level: LevelDef): void {
    window.clearTimeout(this.safetyTimer);
    this.closeOverlay(true);
    this.closeDialogs(true);
    this.hideHint(true);
    this.hideBanner(true);
    const same = this.hud && this.hud.key === level.id;
    this.level = level;
    this.birdsLeft = level.birds.length;
    if (this.view) {
      const v = this.view;
      this.view = null;
      this.removeView(v, this.iris.active ? 'none' : 'fade');
    }
    const changed = this._screen !== 'game' || !same;
    this._screen = 'game';
    this.root.dataset.screen = 'game';
    this.L.bg.classList.remove('is-on');
    this.root.dataset.theme = level.theme;
    const fresh = { score: 0, best: this.deps.progress.record(level.id)?.best ?? 0, birdsLeft: level.birds.length, pigsLeft: level.pigs.length };
    if (same && this.hud) {
      this.hud.update(fresh);
      this.hud.setHome(false);
      this.hud.setSkip(false);
      this.hud.showLevelLabel();
    } else {
      this.destroyHud();
      const onHome = this.deps.onCameraHome
        ? (): void => {
            this.sfx('click');
            this.deps.onCameraHome?.();
          }
        : undefined;
      this.hud = new HudView(this.ctx, level, () => this.pauseByUser(), () => this.restartByUser(), onHome);
      this.L.hud.append(this.hud.el);
      this.hud.enter();
      this.hud.update(fresh);
    }
    this.hud.focus();
    if (changed) this.notifyScreen(level.theme);
    this.guardHistory();
    // уровень начался под оверлеем «Поверните устройство» (повернули телефон во время ириса) — сразу пауза
    this.pauseIfRotated();
    void this.revealGame().then(() => {
      if (level.hint && this.level === level && !this.overlay) this.showHint(level.hint);
    });
  }

  updateHud(s: { score: number; best: number; birdsLeft: number; pigsLeft: number }): void {
    this.birdsLeft = s.birdsLeft;
    this.hud?.update(s);
  }

  /**
   * Облачко-подсказка под плашкой уровня (07 §10.3). Говорит opts.bird (по умолчанию — первая птица уровня): она
   * нарисована в облачке. Хвостик — только если задана opts.at (точка в CSS px окна, например рогатка с птицей):
   * он тянется к ней; без точки хвостика нет — он указывал бы в пустое небо (плейтест №2, Б9).
   * Касания не перехватывает: приложение прячет её по захвату птицы (aimStart → hideHint()).
   */
  showHint(text: string, durationMs = 4000, opts: { bird?: BirdType; at?: { x: number; y: number } } = {}): void {
    this.hideHint(true);
    // под паузой/результатами подсказка не нужна (и слой подсказок выше оверлеев — она легла бы поверх панели)
    if (this.overlay) return;
    const bird = opts.bird ?? this.level?.birds[0] ?? 'red';
    const box = h('div', { class: 'hint-box' }, characterCanvas('bird', bird, 'idle', 24), h('span', { text }));
    const el = h('div', { class: 'hint', role: 'note', 'data-testid': 'hint', 'data-bird': bird }, box);
    this.L.toasts.append(el);
    this.hintEl = el;
    // хвостик считается по раскладке до pop-in (масштаб анимации не мешает замеру)
    if (opts.at && hintTail(box, opts.at)) this.hintTailAt = `${window.innerWidth}x${window.innerHeight}`;
    popIn(box);
    this.announce(text);
    this.hintTimer = window.setTimeout(() => this.hideHint(), Math.max(800, durationMs));
  }

  /** Убрать облачко-подсказку (например, при первом захвате птицы). */
  hideHint(immediate = false): void {
    window.clearTimeout(this.hintTimer);
    const el = this.hintEl;
    if (!el) return;
    this.hintEl = null;
    if (immediate) {
      el.remove();
      return;
    }
    void done(anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })).then(() => el.remove());
  }

  /**
   * Лента-баннер по центру сверху (07 §12.1): «Уровень пройден!», «Уровень не пройден», «Одним выстрелом!».
   * Тап по ленте — deps.onSkip(). ms ≤ 0 — баннер висит до hideBanner()/showWin()/showLose().
   */
  showBanner(text: string, ms = 1500, opts: BannerOpts = {}): void {
    if (this._screen !== 'game') return;
    this.hideBanner(true);
    const kind = opts.kind ?? 'info';
    const rib = ribbon(kind, text);
    const el = h('div', { class: `banner banner--${kind}`, role: 'status', 'data-testid': 'banner' }, rib);
    let badge: HTMLElement | null = null;
    if (opts.badge) {
      badge = h('div', { class: 'banner-badge ts', text: opts.badge });
      el.append(badge);
    }
    const skip = (e: Event): void => {
      e.stopPropagation();
      this.deps.onSkip?.();
    };
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', skip);
    this.L.hud.append(el);
    this.bannerEl = el;
    this.hud?.hideLevelLabel();
    this.hideHint();
    if (motion.reduced) anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'backwards' });
    else {
      anim(rib, [{ transform: 'translateY(-140%) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], {
        duration: 350,
        easing: CSS_EASE.back,
        fill: 'backwards',
      });
      if (badge) popIn(badge, 300);
    }
    this.announce(opts.badge ? `${text} ${opts.badge}` : text);
    if (ms > 0) this.bannerTimer = window.setTimeout(() => this.hideBanner(), ms);
  }

  hideBanner(immediate = false): void {
    window.clearTimeout(this.bannerTimer);
    const el = this.bannerEl;
    if (!el) return;
    this.bannerEl = null;
    if (immediate) {
      el.remove();
      return;
    }
    void done(anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })).then(() => el.remove());
  }

  showPause(): void {
    if (this._screen !== 'game' || this.overlay) return;
    this.hideHint();
    this.hideAbilityHint(true);
    this.hud?.hideLevelLabel();
    const v = new PauseView(this.ctx, this.level, this.birdsLeft);
    this.openOverlay(v);
    this.announce(S.a11yPaused);
  }

  hidePause(): void {
    if (this.overlay?.kind !== 'pause') return;
    this.closeDialogs(true);
    this.closeOverlay(false);
    // фокус не возвращаем на «‖»: иначе Пробел (способность) нажмёт паузу
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /** Победа (07 §12): если висит баннер — его лента перелетает в заголовок панели. */
  showWin(r: WinResult): void {
    if (this._screen !== 'game') return;
    const ribbonFrom = this.takeBanner();
    this.closeOverlay(true);
    this.closeDialogs(true);
    this.hideHint();
    this.hideAbilityHint(true);
    this.hud?.setDim(true);
    this.openOverlay(new WinView(this.ctx, r, { ribbonFrom }));
  }

  /**
   * Поражение (07 §13): score — «Счёт: 23 450»; совет — после трёх поражений подряд (или r.tip).
   * pigsLeft и score выбирают дразнилку: «Почти получилось!» — только при одной оставшейся свинье и счёте больше 0.
   */
  showLose(r: { levelId: string; failStreak?: number; tip?: string; score?: number; pigsLeft?: number }): void {
    if (this._screen !== 'game') return;
    const ribbonFrom = this.takeBanner();
    this.closeOverlay(true);
    this.closeDialogs(true);
    this.hideHint();
    this.hideAbilityHint(true);
    this.hud?.setDim(true);
    const streak = r.failStreak ?? this.deps.progress.failStreak(r.levelId);
    const tip = r.tip ?? (streak >= TIP_AFTER_FAILS ? LOSE_TIPS[(streak - TIP_AFTER_FAILS) % LOSE_TIPS.length] : undefined);
    this.openOverlay(new LoseView(this.ctx, { levelId: r.levelId, tip, score: r.score, pigsLeft: r.pigsLeft }, { ribbonFrom }));
  }

  /** Забрать ленту баннера для перелёта в панель: вернуть её место на экране; лента исчезает сразу, пилюля — фейдом. */
  private takeBanner(): DOMRect | undefined {
    const el = this.bannerEl;
    if (!el) return undefined;
    window.clearTimeout(this.bannerTimer);
    this.bannerEl = null;
    const rib = el.querySelector<HTMLElement>('.ribbon');
    const rect = rib?.getBoundingClientRect();
    rib?.remove();
    if (el.querySelector('.banner-badge') && !motion.reduced)
      void done(anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, fill: 'forwards' })).then(() => el.remove());
    else el.remove();
    return rect;
  }

  hideOverlays(): void {
    this.closeDialogs(true);
    this.closeOverlay(false);
    this.hideHint();
    this.hideAbilityHint();
    this.hideBanner();
  }

  /** true/false — принудительно уменьшить/не уменьшать движение; null — по настройке «Анимации» и системе. */
  setMotion(reduced: boolean | null): void {
    this.motionOverride = reduced;
    this.applyMotion();
  }

  // ───────────────────────── расширения ─────────────────────────

  /** Подпись «Коснитесь, чтобы пропустить» внизу (интро уровня). */
  setSkipHint(on: boolean): void {
    this.hud?.setSkip(on);
  }

  /** Кнопка «К рогатке» слева (рогатка вне кадра дольше 0.5 с). Нужен deps.onCameraHome. */
  setCameraHome(on: boolean): void {
    this.hud?.setHome(on);
  }

  /**
   * Прямоугольник правого блока HUD (рекорд, счёт, свиньи) в CSS px окна — чтобы камера держала верх сооружения
   * под ним, не повторяя формулы styles.css. Считается по раскладке: въезд HUD и «пульс» счёта не сдвигают его,
   * а ширина с первого кадра зарезервирована под пятизначный счёт (3.1 кегля счёта). Готов сразу после showHud(level);
   * если окно уже сменило размер, а relayout ещё не прошёл (порядок обработчиков resize), масштаб HUD (--u)
   * пересчитывается здесь же — без остальных побочных действий relayout (поворот, пауза).
   * В «Играть так» (летербокс) HUD лежит в полосе над игрой — пересечение с холстом пустое.
   * null — не экран игры или HUD ещё не разложен.
   */
  hudRect(): DOMRect | null {
    if (this._screen !== 'game' || !this.hud) return null;
    if (this.layoutAt !== `${window.innerWidth}x${window.innerHeight}`) applyLayout(this.root);
    return this.hud.rightRect();
  }

  /**
   * Подсказка способности сверху по центру (07 §10.4; не закрывает землю со свиньями): «Коснитесь — и Чак рванёт вперёд!»
   * (+ «или нажмите Пробел» с мышью).
   * Показывается, пока тип не отмечен progress.markSeen(`ability:${bird}`) — это делает приложение, когда способность
   * реально использовали. Скрывается через ms или hideAbilityHint(). Возвращает true, если показана.
   */
  abilityHint(bird: BirdType, ms = 3000): boolean {
    const text = ABILITY_HINTS[bird];
    if (!text || this._screen !== 'game' || this.overlay || this.deps.progress.hasSeen(`ability:${bird}`)) return false;
    this.hideAbilityHint(true);
    this.hideHint(true); // то же место сверху по центру
    const fine = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
    const el = h(
      'div',
      { class: 'ability-hint', role: 'status', 'data-testid': 'ability-hint' },
      h('span', { class: 'ability-finger', 'aria-hidden': 'true', html: icon('hand') }),
      characterCanvas('bird', bird, 'fly', 16),
      h('span', { class: 'ability-text' }, text, fine ? h('small', { text: ABILITY_KEY }) : null),
    );
    this.L.toasts.append(el);
    this.abilityEl = el;
    popIn(el);
    this.announce(text);
    this.abilityTimer = window.setTimeout(() => this.hideAbilityHint(), Math.max(800, ms));
    return true;
  }

  hideAbilityHint(immediate = false): void {
    window.clearTimeout(this.abilityTimer);
    const el = this.abilityEl;
    if (!el) return;
    this.abilityEl = null;
    if (immediate) {
      el.remove();
      return;
    }
    void done(anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })).then(() => el.remove());
  }

  /** Фон меню: 'transparent' — под меню живая сцена canvas (по умолчанию); 'css' — запасной CSS-пейзаж. */
  setMenuBackground(mode: 'transparent' | 'css'): void {
    this.menuBg = mode;
    this.root.dataset.fallbackBg = mode === 'css' ? '1' : '0';
    this.L.bg.classList.toggle('is-on', mode === 'css' && this._screen !== 'game');
  }

  /**
   * Короткое сообщение внизу экрана. key — тип: тост того же типа заменяет показанный или ожидающий
   * (по умолчанию тип — сам текст); ждать могут не больше двух.
   */
  toast(text: string, ms = 2500, key: string = text): void {
    const item: ToastItem = { text, ms, key };
    if (queueToast(this.toastQueue, this.toastCur, item) === 'current' && this.toastEl) {
      this.toastCur = item;
      this.toastEl.textContent = text;
      this.announce(text);
      anim(this.toastEl, [{ scale: '1' }, { scale: '1.06' }, { scale: '1' }], { duration: 160, easing: 'ease-out' });
      this.armToastTimer(this.toastEl, ms);
      return;
    }
    if (!this.toastEl) this.nextToast();
  }

  /** Диалог «Настройки» (титул, пауза). */
  openSettings(): void {
    if (this.dialogs.length > 0 || this.busy) return;
    const dlg = new SettingsDialog(this.ctx, () => this.closeDialog(dlg), () => this.confirmReset());
    this.openDialog(dlg);
  }

  /** Довести текущие анимации оверлея до конца (для предпросмотра и тестов). */
  finishAnimations(): void {
    this.overlay?.finish?.();
  }

  /**
   * Окно «Играть так» нажато (летербокс 16:9 по ширине). Приложению — чтобы ужать canvas так же:
   * при смене режима UI шлёт window 'resize'.
   */
  get letterbox(): boolean {
    return this.playAnyway && this.rotateOn;
  }

  /** Спрятать всё поверх игры: оверлеи, диалоги, баннер, подсказку, тосты. */
  hideAll(): void {
    this.hideOverlays();
    this.toastQueue.length = 0;
  }

  destroy(): void {
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.hintTimer);
    window.clearTimeout(this.abilityTimer);
    window.clearTimeout(this.bannerTimer);
    window.clearTimeout(this.safetyTimer);
    this.unsub.forEach((f) => f());
    this.ro?.disconnect();
    window.removeEventListener('resize', this.relayout);
    window.removeEventListener('keydown', this.onKeyDown);
    this.unbindUnlock();
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    window.removeEventListener('popstate', this.onPopState);
    this.mql?.removeEventListener?.('change', this.applyMotion);
    this.view?.destroy?.();
    this.destroyHud();
    this.overlay?.destroy?.();
    this.dialogs.forEach((d) => d.destroy?.());
    this.root.remove();
  }

  // ───────────────────────── контекст для экранов ─────────────────────────

  private makeCtx(): UiCtx {
    const self = this;
    return {
      deps: this.deps,
      order: this.order,
      seenLocked: this.seenLocked,
      sfx: (n) => self.sfx(n),
      toast: (t, ms, key) => self.toast(t, ms, key),
      announce: (t) => self.announce(t),
      loc: (id) => self.locs.get(id),
      settings: (): Readonly<Settings> => self.deps.progress.settings,
      toggleMusic: () => self.toggleMusic(false),
      toggleSfx: () => self.toggleSfx(false),
      openSettings: () => self.openSettings(),
      setSettings: (p) => self.deps.progress.setSettings(p),
      canFullscreen: () => self.canFullscreen(),
      isFullscreen: () => self.isFullscreen(),
      toggleFullscreen: () => self.toggleFullscreen(),
      goTitle: () => self.showTitle(),
      goEpisodes: (dir) => self.goEpisodes(dir ?? 'fwd'),
      goLevels: (id, dir, from) => self.goLevels(id, dir ?? 'fwd', from),
      playLevel: (id, from) => void self.playLevel(id, from),
      restart: () => void self.restart(),
      next: (from) => void self.next(from),
      quit: (from) => void self.quit(from),
      resume: () => self.resumeByUser(),
    };
  }

  // ───────────────────────── навигация ─────────────────────────

  private goEpisodes(dir: 'fwd' | 'back'): void {
    const fromLevels = this.view?.id === 'levels' && this._screen === 'levels' ? this.view.key : undefined;
    const focusEp = fromLevels ?? (this.level ? this.locs.get(this.level.id)?.episode.id : undefined);
    if (this.view?.id === 'episodes' && this._screen === 'episodes') {
      void this.revealMenu();
      return;
    }
    this.clearGame();
    const v = new EpisodesView(this.ctx, focusEp);
    // уровни → эпизоды: экран сжимается обратно в карточку своего эпизода
    const card = fromLevels && dir === 'back' && !this.iris.active ? v.cardOf(fromLevels) : undefined;
    this.swap(v, this.iris.active ? 'none' : dir, 'meadow', card ? { card, mode: 'out' } : undefined);
    void this.revealMenu();
  }

  /** from — нажатая карточка эпизода: экран уровней «вырастает» из неё (07 §5.4). */
  private goLevels(epId: string, dir: 'fwd' | 'back', from?: HTMLElement): void {
    const ep = this.deps.episodes.find((e) => e.id === epId) ?? this.deps.episodes[0];
    if (!ep) return;
    if (this.view?.id === 'levels' && this.view.key === ep.id && this._screen === 'levels') {
      void this.revealMenu();
      return;
    }
    const lastLevel = this.level?.id;
    this.clearGame();
    const v = new LevelsView(this.ctx, ep, lastLevel);
    const zoom = from && dir === 'fwd' && this.view?.id === 'episodes' && !this.iris.active ? { card: from, mode: 'in' as const } : undefined;
    this.swap(v, this.iris.active ? 'none' : dir, ep.theme, zoom);
    void this.revealMenu(lastLevel ? v.tileOf(lastLevel) : undefined);
  }

  private async playLevel(id: string, from: HTMLElement): Promise<void> {
    if (this.busy || this.iris.active) return;
    this.busy = true;
    this.sfx('swoosh');
    this.irisMode = 'iris';
    const c = centerOf(from);
    await this.iris.close(c.x, c.y);
    this.armSafety();
    this.busy = false;
    this.deps.onPlayLevel(id);
  }

  private restartByUser(): void {
    if (this.busy || this.overlay) return;
    this.sfx('click');
    void this.restart();
  }

  private async restart(): Promise<void> {
    if (this.busy || this._screen !== 'game') return;
    this.busy = true;
    this.hideHint();
    this.hideAbilityHint(true);
    this.hideBanner(true);
    this.closeDialogs(true);
    this.irisMode = 'fade';
    await this.iris.fadeClose(150);
    this.closeOverlay(true);
    this.busy = false;
    this.deps.onRestart();
    if (this.level && this.hud) {
      this.hud.update({ score: 0, best: this.deps.progress.record(this.level.id)?.best ?? 0, birdsLeft: this.level.birds.length, pigsLeft: this.level.pigs.length });
      this.hud.setHome(false);
      this.hud.setSkip(false);
      this.birdsLeft = this.level.birds.length;
    }
    this.pauseIfRotated();
    await this.revealGame();
  }

  private async next(from?: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.sfx('swoosh');
    this.irisMode = 'iris';
    const c = centerOf(from);
    await this.iris.close(c.x, c.y);
    this.closeOverlay(true);
    this.hideHint();
    this.armSafety();
    this.busy = false;
    this.deps.onNextLevel();
  }

  /** Выход из уровня в меню (target: уровни эпизода или титул после сброса прогресса). */
  private async quit(from?: HTMLElement, target: 'levels' | 'title' = 'levels'): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.sfx('swoosh');
    this.irisMode = 'iris';
    const c = centerOf(from);
    await this.iris.close(c.x, c.y);
    this.closeOverlay(true);
    this.closeDialogs(true);
    this.hideHint();
    this.busy = false;
    const ep = (this.level && this.locs.get(this.level.id)?.episode.id) ?? this.deps.episodes[0]?.id;
    this.deps.onQuitToMenu();
    // приложение могло само показать меню; если нет — открываем уровни текущего эпизода (или титул)
    if (this._screen === 'game') {
      if (target === 'title' || !ep) this.showTitle();
      else this.goLevels(ep, 'back');
    } else void this.revealMenu();
  }

  private pauseByUser(): void {
    if (this._screen !== 'game' || this.overlay || this.busy) return;
    this.sfx('click');
    this.showPause();
    this.deps.onPause();
  }

  private resumeByUser(): void {
    if (this.overlay?.kind !== 'pause') return;
    const tok = ++this.resumeToken;
    this.hidePause();
    // игра продолжается по окончании анимации панели (07 §11.2)
    window.setTimeout(() => {
      if (tok === this.resumeToken && !this.overlay && this._screen === 'game') this.deps.onResume();
    }, motion.reduced ? 120 : 220);
  }

  /** Раскрыть шторку на игровой сцене (от рогатки, ≈ 20 % ширины слева). */
  private async revealGame(): Promise<void> {
    window.clearTimeout(this.safetyTimer);
    if (!this.iris.active) return;
    const r = this.band.getBoundingClientRect();
    if (this.irisMode === 'fade') await this.iris.fadeOpen(200);
    else await this.iris.open(r.left + r.width * 0.2, r.top + r.height * 0.62);
  }

  private async revealMenu(at?: HTMLElement): Promise<void> {
    window.clearTimeout(this.safetyTimer);
    if (!this.iris.active) return;
    if (this.irisMode === 'fade') {
      await this.iris.fadeOpen(200);
      return;
    }
    const c = centerOf(at);
    await this.iris.open(c.x, c.y);
  }

  /** Страховка: шторка не должна остаться закрытой навсегда. */
  private armSafety(): void {
    window.clearTimeout(this.safetyTimer);
    this.safetyTimer = window.setTimeout(() => {
      if (this.iris.active) void (this.irisMode === 'fade' ? this.iris.fadeOpen() : this.iris.open(innerWidth / 2, innerHeight / 2));
    }, IRIS_SAFETY_MS);
  }

  // ───────────────────────── экраны ─────────────────────────

  /**
   * Сменить экран меню (07 §5.2): вперёд/назад — встречный слайд (новый ±24 % → 0, старый 0 → ∓12 %; новый стартует,
   * когда старый почти ушёл), эпизод ↔ уровни — зум карточки, загрузка → титул — кроссфейд; reduced motion — фейд 0.15 с.
   */
  private swap(next: View, dir: Dir, theme: ThemeId, zoom?: Zoom): void {
    const prev = this.view;
    this.view = next;
    this._screen = next.id;
    this.root.dataset.screen = next.id;
    this.L.screens.append(next.el);
    if (this.menuBg === 'css' && next.id !== 'loading') this.L.bg.classList.add('is-on');
    this.setBgTheme(theme);
    next.enter();
    const reduced = motion.reduced;
    const zoomed = !!zoom && !reduced && dir !== 'none' && this.zoomCard(zoom, next.el);
    if (dir !== 'none') {
      if (zoomed) {
        /* анимации — в zoomCard */
      } else if (reduced || dir === 'fade') {
        anim(next.el, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 150 : 400, easing: CSS_EASE.out, fill: 'backwards' });
      } else {
        const x = dir === 'fwd' ? 24 : -24;
        anim(next.el, [{ opacity: 0, transform: `translateX(${x}%)` }, { opacity: 1, transform: 'none' }], {
          duration: SLIDE_IN_MS,
          delay: prev ? SLIDE_IN_DELAY_MS : 0,
          easing: CSS_EASE.out,
          fill: 'backwards',
        });
      }
      if (dir !== 'fade') this.sfx(dir === 'back' ? 'back' : 'swoosh');
    }
    if (prev) this.removeView(prev, zoomed ? 'zoom' : dir);
    next.focus();
    this.notifyScreen(theme);
    this.guardHistory();
  }

  /**
   * Зум карточки эпизода (07 §5.4). 'in': клон нажатой карточки растёт до размеров экрана и гаснет, под ним
   * появляется экран уровней. 'out': клон карточки нового экрана эпизодов сжимается из «полного экрана» в своё место.
   * Масштаб равномерный (без растяжения арта). Возвращает false, если замерить не удалось — тогда обычный слайд.
   */
  private zoomCard(z: Zoom, nextEl: HTMLElement): boolean {
    const layer = this.L.screens;
    const W = layer.offsetWidth;
    const H = layer.offsetHeight;
    const lr = layer.getBoundingClientRect();
    if (!W || !H || !lr.width) return false;
    const k = lr.width / W; // летербокс: слой масштабирован
    if (z.mode === 'out') for (const a of z.card.parentElement?.getAnimations() ?? []) a.cancel(); // pop-in карточки мешает замеру
    const r = z.card.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const x0 = (r.left - lr.left) / k;
    const y0 = (r.top - lr.top) / k;
    const w0 = r.width / k;
    const h0 = r.height / k;
    const clone = z.card.cloneNode(true) as HTMLElement;
    const src = z.card.querySelectorAll('canvas');
    clone.querySelectorAll('canvas').forEach((c, i) => {
      const o = src[i];
      if (!o) return;
      c.width = o.width;
      c.height = o.height;
      c.getContext('2d')?.drawImage(o, 0, 0);
    });
    clone.removeAttribute('data-testid');
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    clone.classList.add('zoom-clone');
    Object.assign(clone.style, { left: `${x0}px`, top: `${y0}px`, width: `${w0}px`, height: `${h0}px` });
    layer.append(clone);
    const s = Math.max(W / w0, H / h0) * 1.08; // равномерно: карточка накрывает весь экран
    const at = (sc: number): string =>
      `translate(${(W / 2 - (x0 + w0 / 2)).toFixed(1)}px, ${(H / 2 - (y0 + h0 / 2)).toFixed(1)}px) scale(${sc.toFixed(3)})`;
    const big = at(s);
    const bigger = at(s * 1.1);
    const card = z.card;
    // прячем прозрачностью, а не visibility: карточка остаётся фокусируемой (Esc с уровней → фокус на её эпизоде)
    card.style.opacity = '0';
    const frames: Keyframe[] =
      z.mode === 'in'
        ? [
            { transform: 'none', opacity: 1 },
            { transform: big, opacity: 1, offset: 0.66 },
            { transform: bigger, opacity: 0 },
          ]
        : [
            { transform: bigger, opacity: 0 },
            { transform: big, opacity: 1, offset: 0.32 },
            { transform: 'none', opacity: 1 },
          ];
    const a = anim(clone, frames, { duration: ZOOM_MS, easing: CSS_EASE.inout, fill: 'both' });
    // новый экран проявляется под клоном: 'in' — пока клон гаснет, 'out' — пока клон летит на место
    anim(nextEl, [{ opacity: 0 }, { opacity: 1 }], {
      duration: z.mode === 'in' ? 230 : 300,
      delay: z.mode === 'in' ? ZOOM_MS * 0.62 : 120,
      fill: 'backwards',
    });
    void done(a).then(() => {
      clone.remove();
      card.style.opacity = '';
    });
    return true;
  }

  private notifyScreen(theme: ThemeId): void {
    try {
      this.deps.onScreenChange?.(this._screen, theme);
    } catch (e) {
      console.error('[ui] onScreenChange', e);
    }
  }

  private removeView(v: View, dir: Dir | 'zoom'): void {
    v.el.setAttribute('inert', '');
    v.el.setAttribute('aria-hidden', 'true');
    if (dir === 'none') {
      v.destroy?.();
      v.el.remove();
      return;
    }
    // старый экран уходит раньше, чем въезжает новый: слайд −12 % / +12 % (--e-in), прозрачность — линейно и быстрее;
    // при зуме — просто гаснет за 0.2 с
    const slide = !motion.reduced && (dir === 'fwd' || dir === 'back');
    if (slide)
      anim(v.el, [{ transform: 'none' }, { transform: dir === 'fwd' ? 'translateX(-12%)' : 'translateX(12%)' }], {
        duration: SLIDE_OUT_MS,
        easing: CSS_EASE.in,
        fill: 'forwards',
      });
    const a = anim(v.el, [{ opacity: 1 }, { opacity: 0 }], {
      duration: motion.reduced ? 150 : dir === 'fade' ? 400 : dir === 'zoom' ? 200 : FADE_OUT_MS,
      easing: slide ? 'linear' : CSS_EASE.in,
      fill: 'forwards',
    });
    void done(a).then(() => {
      v.destroy?.();
      v.el.remove();
    });
  }

  /** Перерисовать текущий экран меню на месте (прогресс изменился в другой вкладке). */
  private refreshMenu(): void {
    const v = this.view;
    if (!v || this.busy || this.iris.active) return;
    if (v.id === 'episodes') {
      this.swap(new EpisodesView(this.ctx), 'none', 'meadow');
    } else if (v.id === 'levels' && v.key) {
      const ep = this.deps.episodes.find((e) => e.id === v.key);
      if (ep) this.swap(new LevelsView(this.ctx, ep), 'none', ep.theme);
    }
  }

  /** Уходим из игры в меню: убрать оверлеи, подсказки, HUD. */
  private clearGame(): void {
    window.clearTimeout(this.safetyTimer);
    this.closeOverlay(true);
    this.closeDialogs(true);
    this.hideHint(true);
    this.hideAbilityHint(true);
    this.hideBanner(true);
    this.destroyHud();
  }

  private destroyHud(): void {
    if (!this.hud) return;
    const hud = this.hud;
    this.hud = null;
    hud.destroy();
    if (this.iris.active || motion.reduced) hud.el.remove();
    else void done(anim(hud.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })).then(() => hud.el.remove());
  }

  private openOverlay(v: OverlayView): void {
    this.overlay = v;
    this.root.dataset.overlay = v.kind;
    this.L.overlays.append(v.el);
    v.enter();
    v.focus();
  }

  private closeOverlay(immediate: boolean): void {
    const v = this.overlay;
    if (!v) return;
    this.overlay = null;
    this.autoPaused = false;
    delete this.root.dataset.overlay;
    this.hud?.setDim(false);
    v.el.setAttribute('inert', '');
    if (immediate) {
      v.destroy?.();
      v.el.remove();
      return;
    }
    void v.leave().then(() => {
      v.destroy?.();
      v.el.remove();
    });
  }

  // ───────────────────────── диалоги ─────────────────────────

  private openDialog(d: DialogView): void {
    const under = this.dialogs[this.dialogs.length - 1] ?? this.overlay ?? this.view;
    under?.el.setAttribute('inert', '');
    this.dialogs.push(d);
    this.L.dialogs.append(d.el);
    d.enter();
    d.focus();
  }

  private closeDialog(d: DialogView, immediate = false): void {
    const i = this.dialogs.indexOf(d);
    if (i < 0) return;
    this.dialogs.splice(i, 1);
    d.el.setAttribute('inert', '');
    const top = this.dialogs[this.dialogs.length - 1];
    const under = top ?? this.overlay ?? this.view;
    under?.el.removeAttribute('inert');
    if (top) top.focus();
    else if (this.overlay) this.overlay.focus();
    else this.view?.focus();
    if (immediate) {
      d.destroy?.();
      d.el.remove();
      return;
    }
    void d.leave().then(() => {
      d.destroy?.();
      d.el.remove();
    });
  }

  private closeDialogs(immediate: boolean): void {
    while (this.dialogs.length) this.closeDialog(this.dialogs[this.dialogs.length - 1]!, immediate);
  }

  private confirmReset(): void {
    const dlg = new ConfirmDialog(
      this.ctx,
      S.confirmResetTitle,
      S.confirmResetBody,
      S.confirmResetOk,
      () => this.closeDialog(dlg),
      () => {
        this.deps.progress.reset();
        this.seenLocked.clear();
        this.closeDialogs(true);
        this.toast(S.toastResetDone);
        if (this._screen === 'game') void this.quit(undefined, 'title');
        else this.showTitle();
      },
    );
    this.openDialog(dlg);
  }

  // ───────────────────────── тосты, озвучка ─────────────────────────

  private nextToast(): void {
    const item = this.toastQueue.shift();
    if (!item) {
      this.toastEl = null;
      this.toastCur = null;
      return;
    }
    const el = h('div', { class: 'toast', role: 'status', text: item.text });
    this.L.toasts.append(el);
    this.toastEl = el;
    this.toastCur = item;
    this.announce(item.text);
    anim(el, [{ opacity: 0, transform: 'translate(-50%, calc(24 * var(--u)))' }, { opacity: 1, transform: 'translateX(-50%)' }], {
      duration: 250,
      easing: CSS_EASE.back,
    });
    this.armToastTimer(el, item.ms);
  }

  private armToastTimer(el: HTMLElement, ms: number): void {
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastCur = null; // гаснущий тост уже не обновляем — новый встанет в очередь
      void done(anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })).then(() => {
        el.remove();
        this.nextToast();
      });
    }, ms);
  }

  private announce(text: string): void {
    this.live.textContent = '';
    window.setTimeout(() => (this.live.textContent = text), 30);
  }

  private sfx(name: UISound): void {
    try {
      this.deps.audio?.ui(name);
    } catch {
      /* звук не обязателен */
    }
  }

  // ───────────────────────── настройки и прогресс ─────────────────────────

  private toggleMusic(withToast: boolean): void {
    const on = !this.deps.progress.settings.music;
    this.deps.progress.setSettings({ music: on });
    this.sfx('click');
    if (withToast) this.toast(on ? S.toastMusicOn : S.toastMusicOff, 1500, 'music');
  }

  private toggleSfx(withToast: boolean): void {
    const on = !this.deps.progress.settings.sfx;
    this.deps.progress.setSettings({ sfx: on });
    if (on) this.sfx('click');
    if (withToast) this.toast(on ? S.toastSfxOn : S.toastSfxOff, 1500, 'sfx');
  }

  /** Подпись прогресса уровней: меняется — перерисовываем меню. */
  private levelsSig(): string {
    const p = this.deps.progress;
    return this.order.map((id) => {
      const r = p.record(id);
      return r ? `${r.stars}:${r.best}` : '';
    }).join(',');
  }

  /** Любое изменение прогресса: применить настройки; если поменялись уровни (другая вкладка, сброс) — обновить меню. */
  private readonly onProgressChange = (): void => {
    const s = this.deps.progress.settings;
    const prev = this.applied;
    this.applied = { ...s };
    let settingsChanged = false;
    for (const k of Object.keys(s) as Array<keyof Settings>) if (s[k] !== prev[k]) settingsChanged = true;
    if (settingsChanged) {
      if (s.music !== prev.music) this.deps.audio?.setMusic(s.music);
      if (s.sfx !== prev.sfx) this.deps.audio?.setSfx(s.sfx);
      if (s.motion !== prev.motion) this.applyMotion();
      syncToggles(this.ctx, this.root.querySelectorAll<HTMLElement>('[data-toggle]'), true);
      for (const d of this.dialogs) if (d instanceof SettingsDialog) d.sync();
      try {
        this.deps.onSettingsChange?.(s);
      } catch (e) {
        console.error('[ui] onSettingsChange', e);
      }
    }
    const sig = this.levelsSig();
    if (sig !== this.progressSig) {
      this.progressSig = sig;
      if (this._screen === 'episodes' || this._screen === 'levels') this.refreshMenu();
    }
  };

  private canFullscreen(): boolean {
    const d = document as Document & { webkitFullscreenEnabled?: boolean };
    return !!(document.fullscreenEnabled || d.webkitFullscreenEnabled);
  }

  private isFullscreen(): boolean {
    const d = document as Document & { webkitFullscreenElement?: Element | null };
    return !!(document.fullscreenElement || d.webkitFullscreenElement);
  }

  private toggleFullscreen(): void {
    this.sfx('click');
    if (this.deps.onToggleFullscreen) {
      this.deps.onToggleFullscreen();
      return;
    }
    const d = document as Document & { webkitExitFullscreen?: () => void };
    try {
      if (this.isFullscreen()) {
        void (document.exitFullscreen ? document.exitFullscreen() : d.webkitExitFullscreen?.());
        return;
      }
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen?.(), undefined);
      void p
        ?.then(() => (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape'))
        .catch(() => undefined);
    } catch {
      /* полноэкранный режим недоступен */
    }
  }

  // ───────────────────────── окружение ─────────────────────────

  private readonly applyMotion = (): void => {
    const pref = this.deps.progress.settings.motion;
    motion.reduced =
      this.motionOverride !== null ? this.motionOverride : pref === 'reduce' ? true : pref === 'full' ? false : !!this.mql?.matches;
    this.root.dataset.motion = motion.reduced ? 'reduced' : 'full';
  };

  private readonly relayout = (): void => {
    this.layoutAt = `${window.innerWidth}x${window.innerHeight}`;
    const lb = this.root.hasAttribute('data-letterbox');
    if (lb) this.root.style.setProperty('--lb-k', letterboxScale(window.innerWidth, window.innerHeight).toFixed(4));
    const L = applyLayout(this.root);
    if (lb) {
      // полоса верстается как экран 640×360: свой масштаб u; HUD и тосты — по настоящему окну
      const bu = computeUiScale(LETTERBOX_W, LETTERBOX_H, L.coarse);
      const bm = computeUiScale(LETTERBOX_W, LETTERBOX_H, L.coarse, U_MENU_MAX);
      this.band.style.setProperty('--u', `${bu.toFixed(4)}px`);
      this.band.style.setProperty('--u-menu', `${bm.toFixed(4)}px`);
      artScale.u = bm;
    } else {
      this.band.style.removeProperty('--u');
      this.band.style.removeProperty('--u-menu');
      artScale.u = L.uMenu;
    }
    // низкий экран (телефон в ландшафте): компактные панели результатов (styles.css). В летербоксе оверлеи —
    // во всё окно (placeModalLayers), поэтому тоже по высоте окна
    this.root.dataset.low = L.h <= LOW_H ? '1' : '0';
    this.overlay?.relayout?.();
    // хвостик подсказки указывал на точку старой раскладки — после смены размера окна убираем
    if (this.hintEl && this.hintTailAt !== `${window.innerWidth}x${window.innerHeight}`) this.hintEl.querySelector('.hint-tail')?.remove();
    const rot = needsRotate(window.innerWidth, window.innerHeight, L.coarse);
    if (rot !== this.rotateOn) {
      this.rotateOn = rot;
      this.updateRotate();
    }
  };

  private updateRotate(): void {
    const show = this.rotateOn && !this.playAnyway;
    this.root.dataset.rotate = show ? '1' : '0';
    const lb = this.playAnyway && this.rotateOn;
    if (lb !== this.root.hasAttribute('data-letterbox')) {
      if (lb) this.root.setAttribute('data-letterbox', '');
      else this.root.removeAttribute('data-letterbox');
      this.placeModalLayers(lb);
      this.relayout();
      // приложению: перечитать ui.letterbox и ужать canvas так же (обработчик resize)
      window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    }
    if (!this.busy) this.pauseIfRotated();
    if (show) focusEl(this.L.rotate.querySelector<HTMLElement>('button'));
    else this.resumeIfAutoPaused();
  }

  /**
   * Оверлей «Поверните устройство» ушёл («Играть так» или поворот в ландшафт): пауза, которую открыл он сам, снимается —
   * игрок не остаётся в паузе (плейтест №2, Б8). Паузу игрока, вкладки и окна с диалогом не трогаем.
   */
  private resumeIfAutoPaused(): void {
    if (!this.autoPaused) return;
    this.autoPaused = false;
    if (this.overlay?.kind !== 'pause' || this.dialogs.length > 0 || this.busy || this._screen !== 'game') return;
    this.resumeByUser();
  }

  /**
   * «Играть так» (летербокс): пауза, результаты и диалоги — во всё окно в полный размер. В полосе 16:9 шириной
   * с телефон они уменьшены до ≈ 0.6: подписи мельче 9 px, кнопки меньше 44 px. Игра под ними стоит, так что
   * закрыть тёмные полосы не страшно. Без летербокса слои возвращаются в полосу.
   */
  private placeModalLayers(lb: boolean): void {
    const host = lb ? this.root : this.band;
    const layers = [this.L.overlays, this.L.dialogs];
    if (layers.every((l) => l.parentElement === host)) return;
    const active = document.activeElement as HTMLElement | null;
    const hadFocus = !!active && layers.some((l) => l.contains(active));
    // в корне — перед тостами (порядок для читалок; наложение задают z-index слоёв), в полосе — в конец
    for (const l of layers) host.insertBefore(l, lb ? this.L.toasts : null);
    if (hadFocus) focusEl(active);
  }

  /** Игра под оверлеем «Поверните устройство» не идёт: открыть паузу (если ещё не открыт оверлей). */
  private pauseIfRotated(): void {
    if (this.root.dataset.rotate !== '1' || this._screen !== 'game' || this.overlay) return;
    this.showPause();
    this.deps.onPause();
    this.autoPaused = this.overlay !== null;
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden' && this._screen === 'game' && !this.overlay && !this.busy) {
      this.showPause();
      this.deps.onPause();
    }
  };

  /**
   * Системная «Назад» (07 §1.2): на эпизодах, уровнях и в игре в истории лежит запись-«страж».
   * popstate её съедает — делаем шаг назад по игре и, если всё ещё не на титуле, ставим стража снова.
   */
  private guardHistory(): void {
    if (!this.useHistory || this.histGuard) return;
    if (this._screen !== 'episodes' && this._screen !== 'levels' && this._screen !== 'game') return;
    try {
      history.pushState({ abui: 1 }, '');
      this.histGuard = true;
    } catch {
      /* история недоступна (sandbox) — живём без неё */
    }
  }

  private readonly onPopState = (): void => {
    this.histGuard = false;
    this.systemBack();
    this.guardHistory();
  };

  /** Шаг назад по системной кнопке: диалог → закрыть; игра → пауза, из паузы/результатов → уровни; меню → предыдущее меню. */
  private systemBack(): void {
    if (this.root.dataset.rotate === '1' || this.busy || this.iris.active) return;
    const dlg = this.dialogs[this.dialogs.length - 1];
    if (dlg) {
      this.sfx('back');
      this.closeDialog(dlg);
      return;
    }
    if (this._screen === 'game') {
      if (!this.overlay) this.pauseByUser();
      else {
        this.sfx('back');
        void this.quit();
      }
      return;
    }
    if (this._screen === 'levels') {
      this.sfx('back');
      this.goEpisodes('back');
    } else if (this._screen === 'episodes') {
      this.sfx('back');
      this.showTitle();
    }
  }

  private readonly onFullscreen = (): void => {
    syncToggles(this.ctx, this.root.querySelectorAll<HTMLElement>('[data-toggle="fullscreen"]'), false);
  };

  /** Жест разблокирует звук (синхронно в обработчике — требование браузеров); повторяем, пока не запустится. */
  private readonly unlockAudio = (): void => {
    this.unlocker.gesture();
  };

  private unbindUnlock(): void {
    for (const ev of UNLOCK_EVENTS) window.removeEventListener(ev, this.unlockAudio, { capture: true });
  }

  // ───────────────────────── клавиатура ─────────────────────────

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
    if (this.root.dataset.rotate === '1') return;
    if (this.busy || this.iris.active) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') e.preventDefault();
      return;
    }
    const dlg = this.dialogs[this.dialogs.length - 1];
    const modal = dlg?.el ?? this.overlay?.el;
    if (e.key === 'Tab' && modal) {
      this.trapTab(e, modal);
      return;
    }
    let handled = false;
    if (dlg) handled = dlg.onKey?.(e) ?? false;
    else if (this.overlay) handled = this.overlay.onKey?.(e) ?? false;
    else if (this._screen === 'game') handled = this.gameKey(e);
    else handled = this.view?.onKey?.(e) ?? false;
    if (!handled && !e.repeat && !dlg) handled = this.globalKey(e);
    if (handled) e.preventDefault();
  };

  private gameKey(e: KeyboardEvent): boolean {
    if (e.repeat) return false;
    if (e.key === 'Escape' || e.code === 'KeyP') {
      this.pauseByUser();
      return true;
    }
    if (e.code === 'KeyR') {
      this.restartByUser();
      return true;
    }
    return false;
  }

  private globalKey(e: KeyboardEvent): boolean {
    if (e.code === 'KeyM') {
      if (e.shiftKey) this.toggleSfx(true);
      else this.toggleMusic(true);
      return true;
    }
    if (e.code === 'KeyF' && this.canFullscreen()) {
      this.toggleFullscreen();
      return true;
    }
    return false;
  }

  private trapTab(e: KeyboardEvent, box: HTMLElement): void {
    const f = focusables(box);
    if (f.length === 0) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    e.preventDefault();
    const j = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i >= f.length - 1 ? 0 : i + 1;
    focusEl(f[j]);
  }

  // ───────────────────────── постройка слоёв ─────────────────────────

  private setBgTheme(theme: ThemeId): void {
    const f = this.L.bg.firstElementChild as HTMLElement | null;
    if (f) f.dataset.theme = theme;
    this.root.dataset.theme = theme;
  }

  private buildFallbackBg(): HTMLElement {
    const f = h('div', { class: 'fbg', 'data-theme': 'meadow' });
    const clouds: Array<[number, number, number]> = [
      [8, 12, 1],
      [42, 6, 0.8],
      [66, 20, 1.15],
    ];
    for (const [x, y, s] of clouds) f.append(h('div', { class: 'fbg-cloud', style: `left:${x}%;top:${y}%;scale:${s}` }));
    f.append(h('div', { class: 'fbg-ground' }));
    return f;
  }

  private buildRotate(): HTMLElement {
    const anyway = button({
      color: 'blue',
      size: 'pill',
      text: S.rotateAnyway,
      label: S.rotateAnyway,
      testid: 'rotate-anyway',
      onClick: () => {
        this.sfx('click');
        this.playAnyway = true;
        this.updateRotate();
      },
    });
    const birds = h(
      'div',
      { class: 'rotate-birds', 'aria-hidden': 'true' },
      characterCanvas('bird', 'red', 'idle', 26),
      characterCanvas('bird', 'chuck', 'idle', 22),
      characterCanvas('bird', 'blues', 'idle', 16),
    );
    return h(
      'div',
      { class: 'rotate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'abui-rot-title', 'data-testid': 'rotate-overlay' },
      h('div', {
        class: 'rotate-phone',
        html:
          icon('phone') +
          '<svg class="rotate-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 6.5A9.5 9.5 0 0 0 7 3.6"/><path d="M8.6 1.6 6.6 3.7l2.6 1.2"/></svg>',
      }),
      h('h2', { class: 'ts', id: 'abui-rot-title', text: S.rotateTitle }),
      h('p', { text: S.rotateBody }),
      anyway,
      birds,
    );
  }
}
