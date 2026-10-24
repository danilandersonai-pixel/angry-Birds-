// Мелкие DOM-хелперы и компоненты: элемент, кнопка, звёзды, лента.

import { icon, ribbonSvg, starSvg, type IconName } from './icons';

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Создать элемент. Спец-ключи: class, text, html; boolean true → пустой атрибут, false/null → нет атрибута. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

export type BtnColor = 'green' | 'blue' | 'orange' | 'red' | 'gray';
export type BtnSize = 'xs' | 's' | 'm' | 'l' | 'xl' | 'pill';

export interface BtnOpts {
  color: BtnColor;
  size: BtnSize;
  label: string; // aria-label (и title для мыши)
  icon?: IconName;
  text?: string; // видимый текст (для pill)
  testid?: string;
  cls?: string;
  off?: boolean; // перечёркнутая иконка (выключено)
  onClick?: (e: MouseEvent) => void;
}

/** Кнопка в стиле серии (07 §4.1): объёмный градиент, обводка, цоколь, блик. */
export function button(o: BtnOpts): HTMLButtonElement {
  const b = h('button', {
    type: 'button',
    class: `btn btn--${o.color} btn--${o.size}${o.cls ? ` ${o.cls}` : ''}`,
    'aria-label': o.label,
    title: o.text ? null : o.label,
    'data-testid': o.testid,
  });
  if (o.icon) b.insertAdjacentHTML('beforeend', icon(o.icon, { off: o.off }));
  if (o.text) b.append(h('span', { class: 'btn-text ts', text: o.text }));
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

/** Кнопка с подписью снизу (пауза). Возвращает обёртку; кнопка — в .btn. */
export function captioned(btn: HTMLButtonElement, caption: string): HTMLElement {
  return h('div', { class: 'btn-cap-wrap' }, btn, h('span', { class: 'btn-cap ts', text: caption, 'aria-hidden': 'true' }));
}

/** Ряд из трёх звёзд (для плиток, карточек паузы). */
export function starsRow(n: number, cls = ''): HTMLElement {
  const row = h('span', { class: `stars-row ${cls}`, 'aria-hidden': 'true' });
  for (let i = 0; i < 3; i++) row.insertAdjacentHTML('beforeend', starSvg(i < n ? 'full' : 'empty', `s${i}`));
  return row;
}

/** Лента-заголовок с текстом. */
export function ribbon(kind: 'win' | 'lose' | 'info', text: string, id?: string): HTMLElement {
  const r = h('div', { class: `ribbon ribbon--${kind}` });
  r.insertAdjacentHTML('beforeend', ribbonSvg(kind));
  r.append(h('h2', { class: 'ribbon-text ts', text, id }));
  return r;
}

/** Пилюля со звездой и счётчиком «47/90». */
export function starsPill(got: number, total: number, label: string): HTMLElement {
  const p = h('div', { class: 'pill stars-pill', role: 'img', 'aria-label': label });
  p.insertAdjacentHTML('beforeend', starSvg('full', 'pill-star'));
  p.append(h('span', { class: 'num ts', text: `${got}/${total}` }));
  return p;
}

/** Центр элемента в координатах окна. */
export function centerOf(el: Element | null | undefined): { x: number; y: number } {
  if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Фокус без прокрутки страницы. */
export function focusEl(el: HTMLElement | null | undefined): void {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

/** Все фокусируемые элементы внутри контейнера (для ловушки Tab). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
  ].filter((e) => !e.hasAttribute('inert') && e.offsetParent !== null && e.getAttribute('aria-hidden') !== 'true');
}
