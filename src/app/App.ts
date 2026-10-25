// Приложение: холст на весь экран + слой интерфейса, загрузка (шрифты → прогрев спрайтов → фон меню),
// звук (разблокировка по первому жесту, настройки из ProgressStore), маршрутизация экранов UI ↔ MenuScene/GameScreen,
// музыка меню/уровня, пауза при потере фокуса, адаптивное качество, тестовые хуки window.__game.
// URL-параметры (для разработки): ?level=1-1 — сразу в уровень (&intro=0 — без облёта), ?mute=1, ?seed=N,
// ?unlockAll=1 — открыть все уровни (без записи), ?quality=high|med|low, ?fresh=1 — прогресс в памяти (без сохранения).

import { AudioEngine } from '../audio/AudioEngine';
import { EPISODES, ALL_LEVELS, findLevel, nextLevelId } from '../levels';
import { SpriteCache, levelWarmList } from '../render/SpriteCache';
import { ProgressStore, type Settings } from '../storage/progress';
import { UI } from '../ui/UI';
import { loadFonts } from '../ui/fonts';
import type { ScreenId } from '../ui/ctx';
import type { ThemeId } from '../core/types';
import { CanvasHost, type QualityLevel } from './CanvasHost';
import { GameScreen, hudLevel } from './GameScreen';
import { MenuScene } from './MenuScene';
import { installHooks } from './hooks';

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Минимальное время показа экрана загрузки (07 §6.1). */
const BOOT_MIN_MS = 700;
/** Автокачество: CPU-время кадра игры, мс — медленный / быстрый кадр. */
const SLOW_MS = 13;
const FAST_MS = 7;

export class App {
  readonly params = new URLSearchParams(location.search);
  readonly stage: HTMLElement;
  readonly host: CanvasHost;
  readonly cache: SpriteCache;
  readonly progress: ProgressStore;
  readonly audio: AudioEngine;
  readonly ui: UI;
  readonly menu: MenuScene;
  readonly game: GameScreen;
  readonly order: readonly string[] = ALL_LEVELS.map((l) => l.id);
  private screen: ScreenId = 'loading';
  private last = 0;
  private time = 0;
  private running = false;
  private booted = false;
  // fps и адаптивное качество
  private fpsFrames = 0;
  private fpsT = 0;
  fpsValue = 0;
  private slowT = 0;
  private fastT = 0;
  private lastQualityChange = -Infinity;
  private autoQuality = true;
  /** Сколько раз автокачество понижало уровень: после второго понижения вверх больше не идём (без качелей). */
  private downgrades = 0;
  /** Кадр после возврата вкладки / долгой паузы — не мерить. */
  private skipMeasure = 0;

  constructor(root: HTMLElement) {
    this.stage = document.createElement('div');
    this.stage.id = 'stage';
    root.append(this.stage);
    this.host = new CanvasHost(this.stage);
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.cache = new SpriteCache({ budgetBytes: (coarse ? 48 : 64) * 2 ** 20 });
    const fresh = this.params.get('fresh') === '1';
    this.progress = new ProgressStore(fresh ? null : undefined);
    if (this.params.get('unlockAll') === '1') this.progress.unlockAll = true;
    const s = this.progress.settings;
    this.audio = new AudioEngine({ sfx: s.sfx, music: s.music });
    if (this.params.get('mute') === '1') this.audio.setMasterVolume(0);
    this.ui = new UI(this.stage, {
      episodes: EPISODES,
      progress: this.progress,
      audio: this.audio,
      onPlayLevel: (id) => void this.playLevel(id),
      onPause: () => this.game.pause(),
      onResume: () => this.game.resume(),
      onRestart: () => this.game.restart(),
      onQuitToMenu: () => this.game.exit(),
      onNextLevel: () => {
        const cur = this.game.level?.id;
        const next = cur ? nextLevelId(cur) : null;
        if (next) void this.playLevel(next);
        else {
          this.game.exit();
          this.ui.showTitle();
        }
      },
      onSkip: () => this.game.onSkip(),
      onCameraHome: () => this.game.cameraHome(),
      onScreenChange: (screen, theme) => this.onScreen(screen, theme),
      onSettingsChange: (st) => this.applySettings(st),
    });
    this.menu = new MenuScene(this.host, this.cache);
    this.game = new GameScreen({
      host: this.host,
      cache: this.cache,
      ui: this.ui,
      audio: this.audio,
      progress: this.progress,
      order: this.order,
      seed: () => {
        const p = this.params.get('seed');
        return p !== null && Number.isFinite(Number(p)) ? Number(p) : 1 + Math.floor(Math.random() * 0x7fffffff);
      },
      nextFrame,
    });
    // «Играть так» в портрете: canvas ужимается в полосу 16:9 вместе с интерфейсом
    window.addEventListener('resize', () => this.host.setLetterbox(this.ui.letterbox));
    // потеря фокуса окна — пауза (вкладку скрыли — пауза ставит UI сам)
    window.addEventListener('blur', () => this.pauseFromSystem());
    window.addEventListener('pagehide', () => this.pauseFromSystem());
    this.applySettings(s);
    const q = this.params.get('quality');
    if (q === 'high' || q === 'med' || q === 'low') {
      this.autoQuality = false;
      this.setQuality(q);
    }
    installHooks(this);
  }

  // ───────────────────────── загрузка ─────────────────────────

  async start(): Promise<void> {
    const t0 = performance.now();
    this.ui.showLoading(0.03);
    this.loop();
    try {
      // 1. шрифты — до любых текстовых спрайтов (TNT, всплывающие очки)
      await loadFonts();
      await Promise.all(
        ['900 32px Rubik', '700 32px Rubik', '400 32px "Luckiest Guy"'].map((f) => document.fonts.load(f, 'АаЁё Aa 0123').catch(() => [])),
      );
      this.ui.showLoading(0.22);
      // 2. спрайты: персонажи, рогатка, блоки первого уровня (типовой масштаб вида рогатки)
      const first = this.firstLevelToPlay();
      const scale = this.host.canvas.height / 18;
      const items = levelWarmList(
        { ...first, birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'], pigs: allPigs() },
        [scale],
      );
      await this.cache.prewarm(items, { yieldFn: nextFrame, sliceMs: 12, onProgress: (p) => this.ui.showLoading(0.22 + 0.55 * p) });
      // 3. живая сцена меню: фон, рельеф, её персонажи
      await this.menu.prewarm(nextFrame, (p) => this.ui.showLoading(0.77 + 0.2 * p));
      this.ui.showLoading(1);
    } catch (e) {
      console.error('[boot]', e);
    }
    const wait = BOOT_MIN_MS - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    this.booted = true;
    const lv = this.params.get('level');
    const level = lv ? findLevel(lv) : undefined;
    if (level) await this.playLevel(level.id, { intro: this.params.get('intro') !== '0' });
    else this.ui.showTitle();
  }

  /** Уровень, который игрок скорее всего откроет первым: первый открытый без звёзд. */
  private firstLevelToPlay() {
    for (const l of ALL_LEVELS) if (this.progress.isUnlocked(l.id, this.order) && !this.progress.record(l.id)) return l;
    return ALL_LEVELS[0];
  }

  /** Запуск уровня (шторка уже закрыта): загрузка + прогрев, затем HUD (шторка открывается от рогатки). */
  async playLevel(id: string, opts: { intro?: boolean } = {}): Promise<boolean> {
    const level = findLevel(id);
    if (!level) return false;
    if (!(await this.game.load(level))) return false;
    this.ui.showHud(hudLevel(level));
    this.game.start({ intro: opts.intro !== false });
    return true;
  }

  // ───────────────────────── экраны, звук, настройки ─────────────────────────

  private onScreen(screen: ScreenId, theme: ThemeId): void {
    this.screen = screen;
    if (screen === 'game') {
      this.audio.playMusic('level', theme);
      return;
    }
    if (screen !== 'loading') {
      if (this.game.session) this.game.exit();
      this.menu.setTheme(theme);
      this.audio.playMusic('menu');
    }
  }

  get currentScreen(): ScreenId {
    return this.screen;
  }

  private applySettings(s: Readonly<Settings>): void {
    this.game.camera.shakeEnabled = s.shake;
    this.game.aimAssistSetting = s.aimAssist === 'short';
    if (s.quality === 'auto') this.autoQuality = !this.params.has('quality');
    else {
      this.autoQuality = false;
      this.setQuality(s.quality);
    }
    this.game.invalidate();
  }

  setQuality(q: QualityLevel): void {
    this.host.setQuality(q);
    this.game.setFxQuality(q === 'high' ? 'high' : q === 'med' ? 'medium' : 'low');
  }

  /** Пауза по системной причине (окно потеряло фокус). */
  private pauseFromSystem(): void {
    if (this.ui.screen !== 'game' || this.game.paused) return;
    const ph = this.game.phase;
    if (ph !== 'play' && ph !== 'intro') return;
    const st = this.game.session?.state;
    if (st === 'won' || st === 'lost') return;
    this.ui.showPause();
    // UI открывает паузу, только если нет другого оверлея
    if (document.querySelector('.abui')?.getAttribute('data-overlay') === 'pause') this.game.pause();
  }

  // ───────────────────────── цикл ─────────────────────────

  private loop(): void {
    if (this.running) return;
    this.running = true;
    const tick = (now: number): void => {
      requestAnimationFrame(tick);
      const raw = this.last ? Math.max(0, (now - this.last) / 1000) : 1 / 60;
      const dt = Math.min(0.25, raw);
      this.last = now;
      this.time += dt;
      if (raw > 0.25) this.skipMeasure = 2; // вкладка вернулась / долгая пауза
      try {
        this.frame(dt);
      } catch (e) {
        console.error('[frame]', e);
      }
      this.measure(dt);
    };
    requestAnimationFrame(tick);
  }

  private frame(dt: number): void {
    if (!this.booted) return;
    if (this.ui.screen === 'game' || this.game.phase === 'loading') {
      if (this.game.session) this.game.frame(dt, this.time);
      return;
    }
    if (this.ui.screen !== 'loading') this.menu.frame(dt);
  }

  /**
   * FPS за последнюю секунду; адаптация качества (04 §10.1, плейтест №1 п. 5) — по CPU-времени кадра игры (шаги +
   * события + рендер), а не по интервалу между кадрами: на дисплеях 30/50 Гц и в экономии батареи интервал всегда
   * > 20 мс. Медленный кадр: CPU > SLOW_MS или интервал > 45 мс (явно < 22 fps); быстрый: CPU < FAST_MS.
   * Медленно 2 с подряд — вниз, быстро 5 с — вверх (не чаще раза в 10 с; после двух понижений вверх не идём).
   * Не мерим: облёт, первые 3 с уровня, паузу, кадры после возврата вкладки.
   */
  private measure(dt: number): void {
    this.fpsFrames++;
    this.fpsT += dt;
    if (this.fpsT >= 1) {
      this.fpsValue = this.fpsFrames / this.fpsT;
      this.fpsFrames = 0;
      this.fpsT = 0;
    }
    const g = this.game;
    if (this.skipMeasure > 0) {
      this.skipMeasure--;
      return;
    }
    if (!this.autoQuality || !this.booted || this.ui.screen !== 'game' || g.paused || g.phase !== 'play' || g.playTime < 3) {
      this.slowT = this.fastT = 0;
      return;
    }
    const cpu = g.lastFrameMs;
    if (cpu > SLOW_MS || dt > 0.045) {
      this.slowT += dt;
      this.fastT = 0;
    } else if (cpu < FAST_MS) {
      this.fastT += dt;
      this.slowT = Math.max(0, this.slowT - dt);
    } else {
      this.slowT = Math.max(0, this.slowT - dt);
      this.fastT = Math.max(0, this.fastT - dt);
    }
    const q = this.host.quality;
    if (this.time - this.lastQualityChange < 10) return;
    if (this.slowT >= 2 && q !== 'low') {
      this.setQuality(q === 'high' ? 'med' : 'low');
      this.lastQualityChange = this.time;
      this.slowT = 0;
      this.downgrades++;
    } else if (this.fastT >= 5 && q !== 'high' && this.downgrades < 2) {
      this.setQuality(q === 'low' ? 'med' : 'high');
      this.lastQualityChange = this.time;
      this.fastT = 0;
    }
  }

  get appTime(): number {
    return this.time;
  }
}

function allPigs() {
  return (['small', 'medium', 'large', 'helmet', 'mustache', 'king'] as const).map((type) => ({ type, x: 0, y: 0 }));
}
