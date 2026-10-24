// Масштаб интерфейса (07 §2): единица u — CSS-пиксель макета 1280×720.
// u = clamp(min(W/1280, H/720) · (coarse ? 1.15 : 1), 0.45, 1.25). Все размеры в CSS — calc(N * var(--u)).

export const REF_W = 1280;
export const REF_H = 720;
export const U_MIN = 0.45;
export const U_MAX = 1.25;
export const COARSE_BOOST = 1.15;

export function computeUiScale(w: number, h: number, coarse: boolean): number {
  const k = Math.min(w / REF_W, h / REF_H) * (coarse ? COARSE_BOOST : 1);
  return Math.min(U_MAX, Math.max(U_MIN, k));
}

/** Нужно ли просить повернуть устройство: портрет на телефоне/планшете или очень узкое окно. */
export function needsRotate(w: number, h: number, coarse: boolean): boolean {
  if (h <= w) return false;
  return coarse || w < 700;
}

export interface LayoutInfo {
  w: number;
  h: number;
  u: number;
  coarse: boolean;
  portrait: boolean;
  form: 'phone' | 'tablet' | 'desktop';
}

/** Посчитать раскладку для элемента-корня и записать CSS-переменные/атрибуты. */
export function applyLayout(root: HTMLElement): LayoutInfo {
  const r = root.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width || window.innerWidth));
  const h = Math.max(1, Math.round(r.height || window.innerHeight));
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const u = computeUiScale(w, h, coarse);
  const form: LayoutInfo['form'] = coarse ? (Math.min(w, h) < 500 ? 'phone' : 'tablet') : 'desktop';
  root.style.setProperty('--u', `${u.toFixed(4)}px`);
  root.dataset.pointer = coarse ? 'coarse' : 'fine';
  root.dataset.form = form;
  root.dataset.orient = h > w ? 'portrait' : 'landscape';
  return { w, h, u, coarse, portrait: h > w, form };
}
