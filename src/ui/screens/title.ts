// Титульный экран (07 §7): объёмный логотип из DOM-букв, талисманы, пульсирующая «Играть», звук/музыка/полный экран.

import { characterCanvas } from '../art';
import type { UiCtx, View } from '../ctx';
import { button, focusEl, h } from '../dom';
import { S } from '../strings';
import { fullscreenButton, toggleButtons } from '../toggles';

declare const __APP_VERSION__: string | undefined;

function logoLine(text: string, cls: string, startIdx: number): HTMLElement {
  const line = h('span', { class: `logo-line ${cls}`, 'aria-hidden': 'true' });
  [...text.toUpperCase()].forEach((ch, i) => {
    const sign = (startIdx + i) % 2 === 0 ? -1 : 1;
    const span = h('span', { class: 'logo-ch is-drop', 'data-ch': ch, text: ch });
    span.style.setProperty('--i', String(startIdx + i));
    span.style.setProperty('--r', `${sign * 3}deg`);
    span.style.setProperty('--dy', `${sign * 0.03}em`);
    span.addEventListener('animationend', (e) => {
      if (e.animationName === 'logo-drop') {
        span.classList.remove('is-drop');
        span.classList.add('is-wave');
      }
    });
    line.append(span);
  });
  return line;
}

export class TitleView implements View {
  readonly id = 'title' as const;
  readonly el: HTMLElement;
  private readonly play: HTMLButtonElement;

  constructor(ctx: UiCtx) {
    const l1 = S.appTitle1;
    const logo = h(
      'h1',
      { class: 'logo', 'aria-label': S.appTitle },
      logoLine(l1, 'logo-line--1', 0),
      logoLine(S.appTitle2, 'logo-line--2', l1.length),
      h('span', { class: 'logo-badge ts', text: S.appBadge }),
    );
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
    const right = h('div', { class: 'tt-corner tt-corner--r' }, fs);
    const ver = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.1.0';
    this.el = h(
      'section',
      { class: 'scr scr-title-screen', 'aria-label': S.appTitle },
      h('div', { class: 'tt-glow' }),
      logo,
      playWrap,
      left,
      right,
      h('div', { class: 'tt-version ts', text: S.appVersion.replace('{v}', ver) }),
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
