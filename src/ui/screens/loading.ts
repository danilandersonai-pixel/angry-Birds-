// Экран загрузки (07 §6): тот же пейзаж, что у меню (paintScene, статично), прыгающая Ред, компактный объёмный логотип
// (как на титуле — переход загрузка → титул без скачка стиля), полосатый прогресс-бар и советы.

import { characterCanvas, paintScene } from '../art';
import type { View } from '../ctx';
import { h } from '../dom';
import { logoLines } from '../logo';
import { S, TIPS, t } from '../strings';

/** Пейзаж загрузки: как фон меню в предпросмотре (зерно 3, земля 18 %). */
const SCENE_SEED = 3;
const SCENE_GROUND = 0.18;

export class LoadingView implements View {
  readonly id = 'loading' as const;
  readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly pct: HTMLElement;
  private readonly tipEl: HTMLElement;
  private readonly bar: HTMLElement;
  private shown = 0;
  private target = 0;
  private raf = 0;
  private last = 0;
  private tipTimer = 0;
  private tipIdx = -1;
  private fixedTip: string | null = null;
  private readonly bg: HTMLCanvasElement;
  private readonly ro: ResizeObserver | null = null;
  private paintedFor = '';

  constructor() {
    this.fill = h('div', { class: 'bar-fill' });
    this.bar = h('div', {
      class: 'bar',
      role: 'progressbar',
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': 0,
      'aria-label': S.bootLoading.replace(' {p}%', ''),
    }, this.fill);
    this.pct = h('div', { class: 'ld-pct ts', text: t('bootLoading', { p: 0 }) });
    this.tipEl = h('p', { class: 'ld-tip ts', 'aria-live': 'polite' });
    const bird = h('div', { class: 'ld-bird' }, h('div', { class: 'ld-shadow' }), characterCanvas('bird', 'red', 'idle', 58));
    this.bg = h('canvas', { class: 'ld-bg', 'aria-hidden': 'true' });
    this.el = h(
      'section',
      { class: 'scr scr-loading', 'aria-label': S.appTitle },
      this.bg,
      bird,
      h('div', { class: 'logo logo--compact', 'aria-hidden': 'true' }, ...logoLines(false)),
      this.bar,
      this.pct,
      this.tipEl,
    );
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.paint());
      this.ro.observe(this.el);
    }
  }

  /** Нарисовать пейзаж под размер экрана (только при смене размера). */
  private paint(): void {
    const w = this.el.clientWidth;
    const hh = this.el.clientHeight;
    if (!w || !hh) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${w}x${hh}@${dpr}`;
    if (key === this.paintedFor) return;
    this.paintedFor = key;
    const cw = Math.round(w * dpr);
    const ch = Math.round(hh * dpr);
    this.bg.width = cw;
    this.bg.height = ch;
    const c = this.bg.getContext('2d');
    if (!c) return;
    try {
      paintScene(c, cw, ch, 'meadow', SCENE_SEED, SCENE_GROUND);
    } catch {
      /* без пейзажа остаётся CSS-небо */
    }
  }

  enter(): void {
    this.paint();
    this.tipTimer = window.setTimeout(() => this.nextTip(), 500);
  }

  focus(): void {
    /* фокусировать нечего */
  }

  set(p01: number, tip?: string): void {
    this.target = Math.max(this.target, Math.min(1, Math.max(0, p01)));
    if (tip !== undefined && tip !== this.fixedTip) {
      this.fixedTip = tip;
      this.tipEl.textContent = tip;
      window.clearTimeout(this.tipTimer);
    }
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  /** Сглаживание видимого прогресса (07 §6.1). */
  private readonly tick = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.shown += (this.target - this.shown) * (1 - Math.exp(-dt / 0.15));
    if (Math.abs(this.target - this.shown) < 0.002) this.shown = this.target;
    this.render();
    this.raf = this.shown < this.target ? requestAnimationFrame(this.tick) : 0;
  };

  private render(): void {
    const p = Math.round(this.shown * 100);
    this.fill.style.transform = `scaleX(${this.shown.toFixed(4)})`;
    this.pct.textContent = t('bootLoading', { p });
    this.bar.setAttribute('aria-valuenow', String(p));
  }

  private nextTip(): void {
    if (this.fixedTip !== null) return;
    let i = Math.floor(Math.random() * TIPS.length);
    if (i === this.tipIdx) i = (i + 1) % TIPS.length;
    this.tipIdx = i;
    const el = this.tipEl;
    el.style.opacity = '0';
    window.setTimeout(() => {
      if (this.fixedTip !== null) return;
      el.textContent = TIPS[i]!;
      el.style.opacity = '1';
    }, this.tipEl.textContent ? 250 : 0);
    this.tipTimer = window.setTimeout(() => this.nextTip(), 4000);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.tipTimer);
    this.ro?.disconnect();
  }
}
