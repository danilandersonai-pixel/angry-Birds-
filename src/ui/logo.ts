// Логотип «Сердитые Птицы» из DOM-букв (07 §7.2): объёмный градиент, обводка, лёгкий наклон букв.
// Общий для титула (с интро) и экрана загрузки (компактный, без интро) — чтобы переход загрузка → титул был без скачка стиля.

import { h } from './dom';
import { S } from './strings';

/** Интро (07 §7.2): буквы первой строки падают по очереди, вторая строка «выпрыгивает» после приземления первой. */
const DROP_START_MS = 80;
const DROP_STEP_MS = 40;
const DROP_MS = 550;
const POP_STEP_MS = 45;

/** Задержка появления буквы: line 1 — падение, line 2 — после того как первая строка почти приземлилась. */
export function logoLetterDelay(line: 1 | 2, index: number, line1Len: number): number {
  if (line === 1) return DROP_START_MS + index * DROP_STEP_MS;
  const line1Landed = DROP_START_MS + (line1Len - 1) * DROP_STEP_MS + DROP_MS * 0.7;
  return Math.round(line1Landed + index * POP_STEP_MS);
}

function logoLine(text: string, line: 1 | 2, startIdx: number, line1Len: number, intro: boolean): HTMLElement {
  const el = h('span', { class: `logo-line logo-line--${line}`, 'aria-hidden': 'true' });
  [...text.toUpperCase()].forEach((ch, i) => {
    const sign = (startIdx + i) % 2 === 0 ? -1 : 1;
    const anim = line === 1 ? 'is-drop' : 'is-pop';
    const span = h('span', { class: `logo-ch${intro ? ` ${anim}` : ''}`, 'data-ch': ch, text: ch });
    span.style.setProperty('--i', String(startIdx + i));
    span.style.setProperty('--d', `${logoLetterDelay(line, i, line1Len)}ms`);
    span.style.setProperty('--r', `${sign * 3}deg`);
    span.style.setProperty('--dy', `${sign * 0.03}em`);
    if (intro)
      span.addEventListener('animationend', (e) => {
        if (e.animationName === 'logo-drop' || e.animationName === 'logo-pop') {
          span.classList.remove('is-drop', 'is-pop');
          span.classList.add('is-wave');
        }
      });
    el.append(span);
  });
  return el;
}

/** Две строки логотипа. intro — с анимацией появления; иначе буквы сразу на месте (и мягко «волнуются»). */
export function logoLines(intro: boolean): [HTMLElement, HTMLElement] {
  const l1 = S.appTitle1;
  const l2 = S.appTitle2;
  const a = logoLine(l1, 1, 0, l1.length, intro);
  const b = logoLine(l2, 2, l1.length, l1.length, intro);
  if (!intro) for (const ch of [...a.children, ...b.children]) ch.classList.add('is-wave');
  return [a, b];
}
