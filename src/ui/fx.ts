// Частицы UI (07 §12.4): вспышка, ударная волна, искры, конфетти. DOM-узлы удаляются по окончании анимации.
// Движение — отдельными свойствами translate / rotate / scale (частицы — HTML-элементы; SVG внутри искры не анимируется).

import { CSS_EASE, anim, motion } from './anim';
import { h } from './dom';

const SPARK = '<svg viewBox="-10 -10 20 20" width="100%" height="100%"><path d="M0-10L2.6-2.6L10 0L2.6 2.6L0 10L-2.6 2.6L-10 0L-2.6-2.6Z"/></svg>';
const CONFETTI = ['#E0302A', '#4BA7E8', '#FFD21F', '#46A83A', '#FF8A3D', '#B65AE0'];

function spawn(parent: HTMLElement, el: HTMLElement, a: Animation | null): void {
  parent.append(el);
  if (!a) {
    el.remove();
    return;
  }
  a.finished.then(
    () => el.remove(),
    () => el.remove(),
  );
}

/** «Бум» звезды: вспышка + кольцо + 10 искр. parent — слот звезды (position: relative). */
export function starBoom(parent: HTMLElement, sparks = 10): void {
  if (motion.reduced) return;
  const flash = h('div', { class: 'fx fx-flash' });
  spawn(parent, flash, anim(flash, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'linear', fill: 'forwards' }));
  const ring = h('div', { class: 'fx fx-ring' });
  spawn(
    parent,
    ring,
    anim(ring, [{ scale: '1', opacity: 0.9 }, { scale: '2.6', opacity: 0 }], {
      duration: 380,
      easing: CSS_EASE.out,
      fill: 'forwards',
    }),
  );
  for (let i = 0; i < sparks; i++) {
    const ang = ((36 * i + (Math.random() * 24 - 12)) * Math.PI) / 180;
    const dist = 90 + Math.random() * 60;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    const s = h('div', { class: 'fx fx-spark', html: SPARK });
    const size = 0.7 + Math.random() * 0.4;
    s.style.setProperty('--c', Math.random() < 0.5 ? '#FFF7C0' : '#FFD84A');
    const dur = 500 + Math.random() * 200;
    spawn(
      parent,
      s,
      anim(
        s,
        [
          { translate: '0 0', rotate: '0deg', scale: `${size}`, opacity: 1 },
          { translate: `calc(${dx * 0.75} * var(--u)) calc(${dy * 0.75} * var(--u))`, rotate: '110deg', scale: `${size * 0.7}`, opacity: 1, offset: 0.6 },
          { translate: `calc(${dx} * var(--u)) calc(${dy} * var(--u))`, rotate: '180deg', scale: `${size * 0.2}`, opacity: 0 },
        ],
        { duration: dur, easing: CSS_EASE.out, fill: 'forwards' },
      ),
    );
  }
}

/** Конфетти: n прямоугольников разлетаются вверх-вбок и падают. */
export function confetti(parent: HTMLElement, n: number, spread = 1): void {
  if (motion.reduced) return;
  for (let i = 0; i < n; i++) {
    const c = h('div', { class: 'fx fx-confetti' });
    c.style.setProperty('--c', CONFETTI[i % CONFETTI.length]!);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const x1 = dir * (40 + Math.random() * 140) * spread;
    const y1 = -(60 + Math.random() * 120) * spread;
    const x2 = x1 * 1.5;
    const y2 = (120 + Math.random() * 160) * spread;
    const r = (Math.random() * 2 - 1) * 540;
    spawn(
      parent,
      c,
      anim(
        c,
        [
          { translate: '0 0', rotate: '0deg', opacity: 1 },
          { translate: `calc(${x1} * var(--u)) calc(${y1} * var(--u))`, rotate: `${r * 0.4}deg`, opacity: 1, offset: 0.35, easing: 'ease-in' },
          { translate: `calc(${x2} * var(--u)) calc(${y2} * var(--u))`, rotate: `${r}deg`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 400, easing: CSS_EASE.out, fill: 'forwards' },
      ),
    );
  }
}
