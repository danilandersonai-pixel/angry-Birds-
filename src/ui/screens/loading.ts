// Экран загрузки (07 §6): небо, земля, прыгающая Ред, мини-логотип, полосатый прогресс-бар и советы.

import { characterCanvas } from '../art';
import type { View } from '../ctx';
import { h } from '../dom';
import { S, TIPS, t } from '../strings';

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
    this.el = h(
      'section',
      { class: 'scr scr-loading', 'aria-label': S.appTitle },
      h('div', { class: 'ld-cloud', style: 'left:8%;top:14%' }),
      h('div', { class: 'ld-cloud', style: 'left:62%;top:8%;scale:1.25;animation-delay:-12s' }),
      h('div', { class: 'ld-cloud', style: 'left:80%;top:34%;scale:.8;animation-delay:-25s' }),
      h('div', { class: 'ld-ground' }),
      bird,
      h('div', { class: 'ld-logo ts', text: S.appTitle, style: '--stroke: 0.2em; --stroke-c: #6a1408; color: #ffd23a' }),
      this.bar,
      this.pct,
      this.tipEl,
    );
  }

  enter(): void {
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
  }
}
