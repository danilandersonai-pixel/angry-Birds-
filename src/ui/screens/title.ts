// Титульный экран (07 §7): объёмный логотип из DOM-букв, талисманы, пульсирующая «Играть», звук/музыка/полный экран.

import { characterCanvas } from '../art';
import type { UiCtx, View } from '../ctx';
import { button, focusEl, h } from '../dom';
import { logoLines } from '../logo';
import { S } from '../strings';
import { APP_VERSION } from '../version';
import { fullscreenButton, toggleButtons } from '../toggles';

export class TitleView implements View {
  readonly id = 'title' as const;
  readonly el: HTMLElement;
  private readonly play: HTMLButtonElement;

  constructor(ctx: UiCtx) {
    const logo = h('h1', { class: 'logo', 'aria-label': S.appTitle }, ...logoLines(true), h('span', { class: 'logo-badge ts', text: S.appBadge }));
    // талисманы вокруг логотипа (готовые спрайты персонажей)
    const red = h('div', { class: 'logo-mascot tt-red' }, characterCanvas('bird', 'red', 'aim', 66));
    const pig = h('div', { class: 'logo-mascot tt-pig' }, characterCanvas('pig', 'medium', 'laugh', 50));
    logo.prepend(red);
    logo.append(pig);

    this.play = button({
      color: 'green',
      size: 'xl',
      icon: 'play',
      label: S.titlePlay,
      testid: 'btn-play',
      cls: 'tt-play',
      onClick: () => {
        ctx.sfx('click');
        ctx.goEpisodes('fwd');
      },
    });
    const playWrap = h('div', { class: 'tt-play-wrap' }, h('div', { class: 'tt-play-pulse' }, this.play));

    const left = h('div', { class: 'tt-corner tt-corner--l' }, ...toggleButtons(ctx, 's'));
    const fs = fullscreenButton(ctx, 's');
    const gear = button({
      color: 'blue',
      size: 's',
      icon: 'settings',
      label: S.settings,
      testid: 'btn-settings',
      onClick: () => {
        ctx.sfx('click');
        ctx.openSettings();
      },
    });
    const right = h('div', { class: 'tt-corner tt-corner--r' }, fs, gear);
    this.el = h(
      'section',
      { class: 'scr scr-title-screen', 'aria-label': S.appTitle },
      h('div', { class: 'tt-glow' }),
      logo,
      playWrap,
      left,
      right,
      h('div', { class: 'tt-version ts', text: S.appVersion.replace('{v}', APP_VERSION) }),
    );
  }

  enter(): void {
    /* буквы падают сами (CSS), кнопка — pop-in делает UI */
  }

  focus(): void {
    focusEl(this.play);
  }

  onKey(e: KeyboardEvent): boolean {
    if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === document.body) {
      this.play.click();
      return true;
    }
    return false;
  }

  get playButton(): HTMLButtonElement {
    return this.play;
  }
}
