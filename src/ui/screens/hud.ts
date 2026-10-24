// HUD уровня (07 §10): пауза и рестарт слева сверху, рекорд и счёт справа, счётчик свиней, плашка уровня.

import type { LevelDef } from '../../core/types';
import { characterCanvas } from '../art';
import { anim, motion } from '../anim';
import type { UiCtx, View } from '../ctx';
import { button, focusEl, h } from '../dom';
import { S, fmt, t } from '../strings';

export interface HudState {
  score: number;
  best: number;
  birdsLeft: number;
  pigsLeft: number;
}

export class HudView implements View {
  readonly id = 'game' as const;
  readonly el: HTMLElement;
  readonly key: string;
  readonly pauseBtn: HTMLButtonElement;
  readonly restartBtn: HTMLButtonElement;
  private readonly scoreEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly bestNum: HTMLElement;
  private readonly pigsEl: HTMLElement;
  private readonly pigsNum: HTMLElement;
  private readonly levelEl: HTMLElement;
  private target = 0;
  private shown = 0;
  private lastTxt = '';
  private raf = 0;
  private last = 0;
  private levelTimer = 0;
  state: HudState = { score: 0, best: 0, birdsLeft: 0, pigsLeft: 0 };

  constructor(
    ctx: UiCtx,
    readonly level: LevelDef,
    onPause: () => void,
    onRestart: () => void,
  ) {
    this.key = level.id;
    this.pauseBtn = button({ color: 'blue', size: 's', icon: 'pause', label: S.hudPause, testid: 'hud-pause', onClick: onPause });
    this.restartBtn = button({ color: 'orange', size: 's', icon: 'restart', label: S.hudRestart, testid: 'hud-restart', onClick: onRestart });
    // тап по кнопкам HUD не должен запускать способность птицы (07 §4.1)
    for (const b of [this.pauseBtn, this.restartBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.bestNum = h('span', { class: 'num' });
    this.bestEl = h('div', { class: 'hud-best ts' }, h('span', { class: 'lbl', text: `${S.hudBest} ` }), this.bestNum);
    this.scoreEl = h('div', { class: 'hud-score num ts', 'data-testid': 'hud-score', 'aria-hidden': 'true', text: '0' });
    this.pigsNum = h('span', { class: 'num ts', text: '0' });
    this.pigsEl = h('div', { class: 'pill hud-pigs', role: 'img' }, characterCanvas('pig', 'small', 'idle', 17), this.pigsNum);
    this.levelEl = h(
      'div',
      { class: 'pill hud-level', 'aria-hidden': 'true' },
      h('span', { class: 'num ts', text: level.id }),
      h('span', { class: 'nm ts', text: level.name }),
    );
    this.el = h(
      'div',
      { class: 'hud', role: 'region', 'aria-label': `${level.id} ${level.name}` },
      h('div', { class: 'hud-left' }, this.pauseBtn, this.restartBtn),
      this.levelEl,
      h('div', { class: 'hud-right' }, this.bestEl, this.scoreEl, this.pigsEl),
    );
    const rec = ctx.deps.progress.record(level.id);
    this.state.best = rec?.best ?? 0;
    this.state.pigsLeft = level.pigs.length;
    this.state.birdsLeft = level.birds.length;
    this.renderStatic();
  }

  enter(): void {
    const items = [this.pauseBtn, this.restartBtn, this.el.querySelector('.hud-right')!];
    items.forEach((e, i) =>
      anim(e, [{ opacity: 0, transform: 'translateY(calc(-30 * var(--u)))' }, { opacity: 1, transform: 'none' }], {
        duration: motion.reduced ? 150 : 380,
        delay: 120 + i * 60,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        fill: 'backwards',
      }),
    );
    this.showLevelLabel();
  }

  /** Плашка «1-3 · Название» на 2.5 с. */
  showLevelLabel(): void {
    window.clearTimeout(this.levelTimer);
    this.levelEl.classList.remove('is-hidden');
    anim(this.levelEl, [{ opacity: 0, transform: 'translate(-50%, calc(-20 * var(--u))) scale(.8)' }, { opacity: 1, transform: 'translateX(-50%)' }], {
      duration: motion.reduced ? 150 : 350,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    });
    this.levelTimer = window.setTimeout(() => this.levelEl.classList.add('is-hidden'), 2500);
  }

  focus(): void {
    // в игре фокус не трогаем (ввод — на canvas); убираем его с кнопок меню
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && !this.el.contains(a)) a.blur();
  }

  focusPause(): void {
    focusEl(this.pauseBtn);
  }

  update(s: HudState): void {
    const prevTarget = this.target;
    this.state = { ...s };
    this.target = Math.max(0, Math.floor(s.score));
    if (this.target < this.shown) {
      // счёт обнулили (рестарт) — без анимации
      this.shown = this.target;
      this.renderScore();
    } else if (this.target !== this.shown && !this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
    if (this.target - prevTarget >= 5000 && !motion.reduced) {
      anim(this.scoreEl, [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 200, easing: 'ease-out' });
    }
    this.renderStatic();
  }

  /** Плавный счёт (07 §10.2): shown += (target − shown)·(1 − e^(−dt/0.12)). */
  private readonly tick = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.shown += (this.target - this.shown) * (1 - Math.exp(-dt / 0.12));
    if (this.target - this.shown < 1) this.shown = this.target;
    this.renderScore();
    this.raf = this.shown !== this.target ? requestAnimationFrame(this.tick) : 0;
  };

  private renderScore(): void {
    const txt = fmt(this.shown);
    if (txt !== this.lastTxt) {
      this.scoreEl.textContent = txt;
      this.lastTxt = txt;
    }
  }

  private renderStatic(): void {
    const best = this.state.best;
    this.bestEl.style.visibility = best > 0 ? 'visible' : 'hidden';
    const bt = fmt(best);
    if (this.bestNum.textContent !== bt) this.bestNum.textContent = bt;
    const pigs = String(Math.max(0, this.state.pigsLeft));
    if (this.pigsNum.textContent !== pigs) {
      this.pigsNum.textContent = pigs;
      this.pigsEl.setAttribute('aria-label', t('hudPigs', { n: pigs }));
      if (!motion.reduced && this.lastTxt !== '')
        anim(this.pigsEl, [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 220 });
    }
    this.pigsEl.classList.toggle('is-zero', this.state.pigsLeft <= 0);
    if (this.lastTxt === '') this.renderScore();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.levelTimer);
  }
}
