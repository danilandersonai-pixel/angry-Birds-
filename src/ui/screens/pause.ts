// Пауза (07 §11): затемнение, тёмная панель выезжает слева (Продолжить / Заново / Меню + звук и музыка),
// справа — карточка уровня (номер, название, лучшие звёзды, рекорд, птицы).

import type { LevelDef } from '../../core/types';
import { CSS_EASE, anim, done, motion, popIn } from '../anim';
import type { OverlayView, UiCtx } from '../ctx';
import { button, captioned, focusEl, h, starsRow } from '../dom';
import { S, fmt, t } from '../strings';
import { toggleButtons } from '../toggles';

export class PauseView implements OverlayView {
  readonly kind = 'pause' as const;
  readonly el: HTMLElement;
  private readonly side: HTMLElement;
  private readonly card: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly resumeBtn: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly menuBtn: HTMLButtonElement;

  constructor(
    private readonly ctx: UiCtx,
    level: LevelDef | null,
    birdsLeft: number,
  ) {
    this.resumeBtn = button({
      color: 'green',
      size: 'l',
      icon: 'play',
      label: S.pauseResume,
      testid: 'pause-resume',
      onClick: () => {
        ctx.sfx('click');
        ctx.resume();
      },
    });
    this.restartBtn = button({
      color: 'orange',
      size: 'm',
      icon: 'restart',
      label: S.pauseRestart,
      testid: 'pause-restart',
      onClick: () => {
        ctx.sfx('click');
        ctx.restart();
      },
    });
    this.menuBtn = button({
      color: 'blue',
      size: 'm',
      icon: 'menu',
      label: S.pauseMenu,
      testid: 'pause-levels',
      onClick: () => {
        ctx.sfx('back');
        ctx.quit(this.menuBtn);
      },
    });
    this.backdrop = h('div', { class: 'ov-backdrop' });
    this.backdrop.addEventListener('click', () => {
      ctx.sfx('click');
      ctx.resume();
    });
    this.side = h(
      'div',
      { class: 'pause-side' },
      h('h2', { class: 'pause-title ts', id: 'abui-pause-title', text: S.pauseTitle }),
      captioned(this.resumeBtn, S.pauseResume),
      h('div', { class: 'pause-pair' }, captioned(this.restartBtn, S.pauseRestart), captioned(this.menuBtn, S.pauseMenu)),
      h(
        'div',
        { class: 'pause-toggles' },
        ...toggleButtons(ctx, 'xs'),
        button({
          color: 'blue',
          size: 'xs',
          icon: 'settings',
          label: S.settings,
          testid: 'pause-settings',
          onClick: () => {
            ctx.sfx('click');
            ctx.openSettings();
          },
        }),
      ),
    );
    this.card = h('div', { class: 'panel pause-card' });
    if (level) {
      const rec = ctx.deps.progress.record(level.id);
      this.card.append(
        h('div', { class: 'lvl-id num ts', text: level.id }),
        h('div', { class: 'lvl-name ts', text: level.name }),
        starsRow(rec?.stars ?? 0),
        h('div', { class: 'best', text: rec ? t('pauseBest', { score: fmt(rec.best) }) : S.pauseNoBest }),
        h('div', { class: 'meta', text: t('pauseBirds', { n: Math.max(0, birdsLeft) }) }),
      );
    }
    const cardArea = h('div', { class: 'pause-card-area' }, level ? this.card : null);
    this.el = h(
      'div',
      { class: 'ov ov-pause', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'abui-pause-title', 'data-testid': 'pause' },
      this.backdrop,
      cardArea,
      this.side,
    );
  }

  enter(): void {
    anim(this.backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'backwards' });
    anim(this.side, [{ transform: 'translateX(-100%)' }, { transform: 'none' }], {
      duration: motion.reduced ? 150 : 300,
      easing: CSS_EASE.out,
      fill: 'backwards',
    });
    popIn(this.card, 80);
    this.ctx.sfx('pop');
  }

  async leave(): Promise<void> {
    const a = anim(this.side, [{ transform: 'none' }, { transform: 'translateX(-100%)' }], {
      duration: motion.reduced ? 120 : 220,
      easing: CSS_EASE.in,
      fill: 'forwards',
    });
    anim(this.card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 160, fill: 'forwards' });
    anim(this.backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' });
    await done(a);
  }

  focus(): void {
    focusEl(this.resumeBtn);
  }

  onKey(e: KeyboardEvent): boolean {
    // e.code — физическая клавиша: работает и в русской раскладке
    if (e.key === 'Escape' || e.code === 'KeyP') {
      this.resumeBtn.click();
      return true;
    }
    if (e.code === 'KeyR') {
      this.restartBtn.click();
      return true;
    }
    if (e.code === 'KeyL') {
      this.menuBtn.click();
      return true;
    }
    return false;
  }
}
