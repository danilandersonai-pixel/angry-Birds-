// Круглые переключатели музыки/звуков/полного экрана (07 §4.5). Состояние синхронизируется по data-toggle.

import type { UiCtx } from './ctx';
import { button, type BtnSize } from './dom';
import { icon } from './icons';
import { S } from './strings';

export function toggleButtons(ctx: UiCtx, size: BtnSize): HTMLButtonElement[] {
  const music = button({ color: 'blue', size, icon: 'music', label: S.music, testid: 'toggle-music', cls: 'tgl' });
  music.dataset.toggle = 'music';
  music.addEventListener('click', () => ctx.toggleMusic());
  const sfx = button({ color: 'blue', size, icon: 'sound', label: S.sound, testid: 'toggle-sfx', cls: 'tgl' });
  sfx.dataset.toggle = 'sfx';
  sfx.addEventListener('click', () => ctx.toggleSfx());
  const out = [music, sfx];
  syncToggles(ctx, out, false);
  return out;
}

export function fullscreenButton(ctx: UiCtx, size: BtnSize): HTMLButtonElement | null {
  if (!ctx.canFullscreen()) return null;
  const b = button({ color: 'blue', size, icon: 'fullscreen', label: S.fullscreen, testid: 'toggle-fullscreen', cls: 'tgl' });
  b.dataset.toggle = 'fullscreen';
  b.addEventListener('click', () => ctx.toggleFullscreen());
  syncToggles(ctx, [b], false);
  return b;
}

/** Обновить вид переключателей под текущие настройки. animate — «мигнуть» иконкой. */
export function syncToggles(ctx: UiCtx, btns: Iterable<HTMLElement>, animate: boolean): void {
  const s = ctx.settings();
  for (const b of btns) {
    const kind = b.dataset.toggle;
    if (kind === 'fullscreen') {
      const fs = ctx.isFullscreen();
      b.setAttribute('aria-pressed', String(fs));
      b.setAttribute('aria-label', fs ? S.exitFullscreen : S.fullscreen);
      b.title = fs ? S.exitFullscreen : S.fullscreen;
      continue;
    }
    if (kind !== 'music' && kind !== 'sfx') continue;
    const on = kind === 'music' ? s.music : s.sfx;
    const was = b.getAttribute('aria-pressed');
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('is-off', !on);
    const label = kind === 'music' ? (on ? S.musicOn : S.musicOff) : on ? S.soundOn : S.soundOff;
    b.setAttribute('aria-label', label);
    b.title = label;
    const svg = b.querySelector('svg');
    if (svg) svg.outerHTML = icon(kind === 'music' ? 'music' : 'sound', { off: !on });
    if (animate && was !== null && was !== String(on)) {
      b.classList.remove('is-toggled');
      void b.offsetWidth;
      b.classList.add('is-toggled');
    }
  }
}
