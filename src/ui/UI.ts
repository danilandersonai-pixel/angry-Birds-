// Фасад интерфейса (07 §1): слои DOM поверх canvas, автомат экранов, переходы, оверлеи, клавиатура.
// Меню прозрачные (под ними — живая сцена на canvas); при желании — запасной CSS-фон (setMenuBackground).

import './styles.css';
import type { LevelDef, ThemeId } from '../core/types';
import type { Settings } from '../storage/progress';
import { CSS_EASE, anim, done, motion, popIn } from './anim';
import { characterCanvas } from './art';
import type { LevelLoc, OverlayView, ScreenId, UIDeps, UISound, UiCtx, View } from './ctx';
import { button, centerOf, focusEl, focusables, h } from './dom';
import { loadFonts } from './fonts';
import { DEFS_SVG, icon } from './icons';
import { Iris } from './iris';
import { applyLayout, needsRotate } from './layout';
import { EpisodesView } from './screens/episodes';
import { HudView } from './screens/hud';
import { LevelsView } from './screens/levels';
import { LoadingView } from './screens/loading';
import { PauseView } from './screens/pause';
import { LoseView, WinView, type WinResult } from './screens/results';
import { TitleView } from './screens/title';
import { S } from './strings';
import { syncToggles } from './toggles';

export type { ScreenId, UIAudio, UIDeps, UISound } from './ctx';
export type { WinResult } from './screens/results';

type Dir = 'fwd' | 'back' | 'fade' | 'none';

/** Если приложение не вызвало showHud/showLevels после закрытия шторки — открыть её сами через это время. */
const IRIS_SAFETY_MS = 5000;

export class UI {
  private readonly root: HTMLElement;
  private readonly L: Record<'bg' | 'hud' | 'screens' | 'overlays' | 'toasts' | 'rotate', HTMLElement>;
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
  private level: LevelDef | null = null;
  private birdsLeft = 0;
  private busy = false;
  private irisMode: 'iris' | 'fade' = 'iris';
  private safetyTimer = 0;
  private hintEl: HTMLElement | null = null;
  private hintTimer = 0;
  private toastEl: HTMLElement | null = null;
  private toastTimer = 0;
  private readonly toastQueue: Array<{ text: string; ms: number }> = [];
  private audioUnlocked = false;
  private playAnyway = false;
  private rotateOn = false;
  private storageWarned = false;
  private menuBg: 'transparent' | 'css' = 'transparent';
  private resumeToken = 0;
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
      toasts: layer('toasts'),
      rotate: layer('rotate'),
    };
    this.L.bg.append(this.buildFallbackBg());
    this.live = h('div', { class: 'abui-sr', 'aria-live': 'polite', role: 'status' });
    this.root.append(this.L.bg, this.L.hud, this.L.screens, this.L.overlays, this.L.toasts, this.L.rotate, this.live);
    this.L.rotate.append(this.buildRotate());
    host.append(this.root);
    this.iris = new Iris(this.root);

    this.ctx = this.makeCtx();

    // движение: системная настройка
    if (typeof matchMedia === 'function') {
      this.mql = matchMedia('(prefers-reduced-motion: reduce)');
      this.applyMotion();
      this.mql.addEventListener?.('change', this.applyMotion);
    }
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
    this.root.addEventListener('pointerdown', this.unlockAudio, { capture: true });

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
      this.swap(new LoadingView(), 'none');
    }
    (this.view as LoadingView).set(progress01, tip);
  }

  showTitle(): void {
    if (this.view?.id === 'title' && this._screen === 'title') return;
    const from = this._screen;
    this.clearGame();
    this.swap(new TitleView(this.ctx), from === 'loading' ? 'fade' : 'back');
    this.setBgTheme('meadow');
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
    this.hideHint();
    const same = this.hud && this.hud.key === level.id;
    this.level = level;
    this.birdsLeft = level.birds.length;
    if (this.view) {
      const v = this.view;
      this.view = null;
      this.removeView(v, this.iris.active ? 'none' : 'fade');
    }
    this._screen = 'game';
    this.root.dataset.screen = 'game';
    this.L.bg.classList.remove('is-on');
    if (same && this.hud) {
      this.hud.update({ score: 0, best: this.deps.progress.record(level.id)?.best ?? 0, birdsLeft: level.birds.length, pigsLeft: level.pigs.length });
      this.hud.showLevelLabel();
    } else {
      this.destroyHud();
      this.hud = new HudView(this.ctx, level, () => this.pauseByUser(), () => this.ctx.restart());
      this.L.hud.append(this.hud.el);
      this.hud.enter();
    }
    this.hud.focus();
    void this.revealGame().then(() => {
      if (level.hint && this.level === level && !this.overlay) this.showHint(level.hint);
    });
  }

  updateHud(s: { score: number; best: number; birdsLeft: number; pigsLeft: number }): void {
    this.birdsLeft = s.birdsLeft;
    this.hud?.update(s);
  }

  showHint(text: string, durationMs = 4000): void {
    this.hideHint(true);
    const box = h('div', { class: 'hint-box' }, characterCanvas('bird', 'red', 'idle', 24), h('span', { text }));
    const el = h('div', { class: 'hint', role: 'note', 'data-testid': 'hint' }, box);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', () => this.hideHint());
    this.L.toasts.append(el);
    this.hintEl = el;
    popIn(box);
    this.announce(text);
    this.hintTimer = window.setTimeout(() => this.hideHint(), Math.max(800, durationMs));
  }

  showPause(): void {
    if (this._screen !== 'game' || this.overlay) return;
    this.hideHint();
    this.hud?.hideLevelLabel();
    const v = new PauseView(this.ctx, this.level, this.birdsLeft);
    this.openOverlay(v);
    this.announce(S.a11yPaused);
  }

  hidePause(): void {
    if (this.overlay?.kind !== 'pause') return;
    this.closeOverlay(false);
    // фокус не возвращаем на «‖»: иначе Пробел (способность) нажмёт паузу
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  showWin(r: WinResult): void {
    if (this._screen !== 'game') return;
    this.closeOverlay(true);
    this.hideHint();
    this.hud?.setDim(true);
    this.openOverlay(new WinView(this.ctx, r));
  }

  showLose(r: { levelId: string }): void {
    if (this._screen !== 'game') return;
    this.closeOverlay(true);
    this.hideHint();
    this.hud?.setDim(true);
    this.openOverlay(new LoseView(this.ctx, r.levelId));
  }

  hideOverlays(): void {
    this.closeOverlay(false);
    this.hideHint();
  }

  // ───────────────────────── дополнительно (не из контракта) ─────────────────────────

  /** Фон меню: 'transparent' — под меню живая сцена canvas (по умолчанию); 'css' — запасной CSS-пейзаж. */
  setMenuBackground(mode: 'transparent' | 'css'): void {
    this.menuBg = mode;
    this.root.dataset.fallbackBg = mode === 'css' ? '1' : '0';
    this.L.bg.classList.toggle('is-on', mode === 'css' && this._screen !== 'game');
  }

  /** Короткое сообщение внизу экрана. */
  toast(text: string, ms = 2500): void {
    this.toastQueue.push({ text, ms });
    if (!this.toastEl) this.nextToast();
  }

  /** Довести текущие анимации оверлея до конца (для предпросмотра и тестов). */
  finishAnimations(): void {
    this.overlay?.finish?.();
  }

  /** Окно «Играть так» нажато (летербокс 16:9). Приложению — чтобы ужать canvas так же. */
  get letterbox(): boolean {
    return this.playAnyway && this.rotateOn;
  }

  destroy(): void {
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.hintTimer);
    window.clearTimeout(this.safetyTimer);
    this.ro?.disconnect();
    window.removeEventListener('resize', this.relayout);
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    this.mql?.removeEventListener?.('change', this.applyMotion);
    this.view?.destroy?.();
    this.destroyHud();
    this.overlay?.destroy?.();
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
      toast: (t, ms) => self.toast(t, ms),
      announce: (t) => self.announce(t),
      loc: (id) => self.locs.get(id),
      settings: (): Readonly<Settings> => self.deps.progress.settings,
      toggleMusic: () => self.toggleMusic(false),
      toggleSfx: () => self.toggleSfx(false),
      canFullscreen: () => self.canFullscreen(),
      isFullscreen: () => self.isFullscreen(),
      toggleFullscreen: () => self.toggleFullscreen(),
      goTitle: () => self.showTitle(),
      goEpisodes: (dir) => self.goEpisodes(dir ?? 'fwd'),
      goLevels: (id, dir) => self.goLevels(id, dir ?? 'fwd'),
      playLevel: (id, from) => void self.playLevel(id, from),
      restart: () => void self.restart(),
      next: (from) => void self.next(from),
      quit: (from) => void self.quit(from),
      resume: () => self.resumeByUser(),
    };
  }

  // ───────────────────────── навигация ─────────────────────────

  private goEpisodes(dir: 'fwd' | 'back'): void {
    const focusEp = this.level ? this.locs.get(this.level.id)?.episode.id : undefined;
    if (this.view?.id === 'episodes' && this._screen === 'episodes') return;
    this.clearGame();
    this.swap(new EpisodesView(this.ctx, focusEp), this.iris.active ? 'none' : dir);
    this.setBgTheme('meadow');
    void this.revealMenu();
  }

  private goLevels(epId: string, dir: 'fwd' | 'back'): void {
    const ep = this.deps.episodes.find((e) => e.id === epId) ?? this.deps.episodes[0];
    if (!ep) return;
    if (this.view?.id === 'levels' && this.view.key === ep.id && this._screen === 'levels') {
      void this.revealMenu();
      return;
    }
    const lastLevel = this.level?.id;
    this.clearGame();
    const v = new LevelsView(this.ctx, ep, lastLevel);
    this.swap(v, this.iris.active ? 'none' : dir);
    this.setBgTheme(ep.theme);
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

  private async restart(): Promise<void> {
    if (this.busy || this._screen !== 'game') return;
    this.busy = true;
    this.hideHint();
    this.irisMode = 'fade';
    await this.iris.fadeClose(150);
    this.closeOverlay(true);
    this.busy = false;
    this.deps.onRestart();
    if (this.level && this.hud) {
      this.hud.update({ score: 0, best: this.deps.progress.record(this.level.id)?.best ?? 0, birdsLeft: this.level.birds.length, pigsLeft: this.level.pigs.length });
      this.birdsLeft = this.level.birds.length;
    }
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

  private async quit(from?: HTMLElement): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.sfx('swoosh');
    this.irisMode = 'iris';
    const c = centerOf(from);
    await this.iris.close(c.x, c.y);
    this.closeOverlay(true);
    this.hideHint();
    this.busy = false;
    const ep = (this.level && this.locs.get(this.level.id)?.episode.id) ?? this.deps.episodes[0]?.id;
    this.deps.onQuitToMenu();
    // приложение могло само показать меню; если нет — открываем уровни текущего эпизода
    if (this._screen === 'game' && ep) this.goLevels(ep, 'back');
    else void this.revealMenu();
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
    const r = this.root.getBoundingClientRect();
    if (this.irisMode === 'fade') await this.iris.fadeOpen(200);
    else await this.iris.open(r.left + r.width * 0.2, r.top + r.height * 0.62);
  }

  private async revealMenu(at?: HTMLElement): Promise<void> {
    window.clearTimeout(this.safetyTimer);
    if (!this.iris.active) return;
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

  private swap(next: View, dir: Dir): void {
    const prev = this.view;
    this.view = next;
    this._screen = next.id;
    this.root.dataset.screen = next.id;
    this.L.screens.append(next.el);
    if (this.menuBg === 'css' && next.id !== 'loading') this.L.bg.classList.add('is-on');
    next.enter();
    const reduced = motion.reduced;
    if (dir !== 'none') {
      const from = dir === 'fwd' ? 'scale(1.07)' : dir === 'back' ? 'scale(0.94)' : 'none';
      anim(next.el, [{ opacity: 0, transform: reduced ? 'none' : from }, { opacity: 1, transform: 'none' }], {
        duration: reduced ? 150 : dir === 'fade' ? 400 : 340,
        easing: CSS_EASE.out,
        fill: 'backwards',
      });
      if (dir !== 'fade') this.sfx(dir === 'back' ? 'back' : 'swoosh');
    }
    if (prev) this.removeView(prev, dir);
    next.focus();
  }

  private removeView(v: View, dir: Dir): void {
    v.el.setAttribute('inert', '');
    v.el.setAttribute('aria-hidden', 'true');
    if (dir === 'none') {
      v.destroy?.();
      v.el.remove();
      return;
    }
    const to = dir === 'fwd' ? 'scale(0.94)' : dir === 'back' ? 'scale(1.07)' : 'none';
    const a = anim(v.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: motion.reduced ? 'none' : to }], {
      duration: motion.reduced ? 150 : dir === 'fade' ? 400 : 240,
      easing: CSS_EASE.in,
      fill: 'forwards',
    });
    void done(a).then(() => {
      v.destroy?.();
      v.el.remove();
    });
  }

  /** Уходим из игры в меню: убрать оверлеи, подсказки, HUD. */
  private clearGame(): void {
    window.clearTimeout(this.safetyTimer);
    this.closeOverlay(true);
    this.hideHint(true);
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
    this.L.overlays.append(v.el);
    v.enter();
    v.focus();
  }

  private closeOverlay(immediate: boolean): void {
    const v = this.overlay;
    if (!v) return;
    this.overlay = null;
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

  // ───────────────────────── подсказки, тосты, озвучка ─────────────────────────

  private hideHint(immediate = false): void {
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

  private nextToast(): void {
    const item = this.toastQueue.shift();
    if (!item) {
      this.toastEl = null;
      return;
    }
    const el = h('div', { class: 'toast', role: 'status', text: item.text });
    this.L.toasts.append(el);
    this.toastEl = el;
    this.announce(item.text);
    anim(el, [{ opacity: 0, transform: 'translate(-50%, calc(24 * var(--u)))' }, { opacity: 1, transform: 'translateX(-50%)' }], {
      duration: 250,
      easing: CSS_EASE.back,
    });
    this.toastTimer = window.setTimeout(() => {
      void done(anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })).then(() => {
        el.remove();
        this.nextToast();
      });
    }, item.ms);
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

  // ───────────────────────── настройки ─────────────────────────

  private toggleMusic(withToast: boolean): void {
    const on = !this.deps.progress.settings.music;
    this.deps.progress.setSettings({ music: on });
    this.deps.audio?.setMusic(on);
    this.sfx('click');
    this.syncAllToggles();
    if (withToast) this.toast(on ? S.toastMusicOn : S.toastMusicOff, 1500);
  }

  private toggleSfx(withToast: boolean): void {
    const on = !this.deps.progress.settings.sfx;
    this.deps.progress.setSettings({ sfx: on });
    this.deps.audio?.setSfx(on);
    if (on) this.sfx('click');
    this.syncAllToggles();
    if (withToast) this.toast(on ? S.toastSfxOn : S.toastSfxOff, 1500);
  }

  private syncAllToggles(): void {
    syncToggles(this.ctx, this.root.querySelectorAll<HTMLElement>('[data-toggle]'), true);
  }

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
    motion.reduced = !!this.mql?.matches;
    this.root.dataset.motion = motion.reduced ? 'reduced' : 'full';
  };

  private readonly relayout = (): void => {
    const L = applyLayout(this.root);
    const rot = needsRotate(window.innerWidth, window.innerHeight, L.coarse);
    if (rot !== this.rotateOn) {
      this.rotateOn = rot;
      this.updateRotate();
    }
  };

  private updateRotate(): void {
    const show = this.rotateOn && !this.playAnyway;
    this.root.dataset.rotate = show ? '1' : '0';
    if (this.playAnyway && this.rotateOn) this.root.setAttribute('data-letterbox', '');
    else this.root.removeAttribute('data-letterbox');
    if (show && this._screen === 'game' && !this.overlay) {
      this.showPause();
      this.deps.onPause();
    }
    if (show) focusEl(this.L.rotate.querySelector<HTMLElement>('button'));
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden' && this._screen === 'game' && !this.overlay && !this.busy) {
      this.showPause();
      this.deps.onPause();
    }
  };

  private readonly onFullscreen = (): void => {
    syncToggles(this.ctx, this.root.querySelectorAll<HTMLElement>('[data-toggle="fullscreen"]'), false);
  };

  /** Первый жест разблокирует звук (синхронно в обработчике — требование браузеров). */
  private readonly unlockAudio = (): void => {
    if (this.audioUnlocked) return;
    this.audioUnlocked = true;
    try {
      void this.deps.audio?.unlock().catch(() => undefined);
    } catch {
      /* без звука игра идёт */
    }
  };

  // ───────────────────────── клавиатура ─────────────────────────

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
    this.unlockAudio();
    if (this.root.dataset.rotate === '1') return;
    if (this.busy || this.iris.active) {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && this.overlay) {
      this.trapTab(e, this.overlay.el);
      return;
    }
    let handled = false;
    if (this.overlay) handled = this.overlay.onKey?.(e) ?? false;
    else if (this._screen === 'game') handled = this.gameKey(e);
    else handled = this.view?.onKey?.(e) ?? false;
    if (!handled && !e.repeat) handled = this.globalKey(e);
    if (handled) e.preventDefault();
  };

  private gameKey(e: KeyboardEvent): boolean {
    if (e.repeat) return false;
    if (e.key === 'Escape' || e.code === 'KeyP') {
      this.pauseByUser();
      return true;
    }
    if (e.code === 'KeyR') {
      this.sfx('click');
      void this.restart();
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
