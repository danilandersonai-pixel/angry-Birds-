// Масштаб интерфейса (07 §2): единица u — CSS-пиксель макета 1280×720.
// u = clamp(min(W/1280, H/720) · (coarse ? 1.15 : 1), 0.45, 1.25). Все размеры в CSS — calc(N * var(--u)).
// HUD держит потолок 1.25 (на больших мониторах сцене достаётся больше места), а меню, оверлеи и диалоги
// используют --u-menu с потолком 2.0: на 2560×1440 экран меню выглядит как 1280×720, а не «марка» в центре.

export const REF_W = 1280;
export const REF_H = 720;
export const U_MIN = 0.45;
export const U_MAX = 1.25;
export const COARSE_BOOST = 1.15;
/** Потолок масштаба для меню, оверлеев и диалогов. */
export const U_MENU_MAX = 2;

export function computeUiScale(w: number, h: number, coarse: boolean, max = U_MAX): number {
  const k = Math.min(w / REF_W, h / REF_H) * (coarse ? COARSE_BOOST : 1);
  return Math.min(max, Math.max(U_MIN, k));
}

/** Масштаб, с которым блок w×h помещается в aw×ah (не больше 1; 1 — если размеры неизвестны). */
export function fitScale(aw: number, ah: number, w: number, h: number): number {
  if (!(w > 0) || !(h > 0) || !(aw > 0) || !(ah > 0)) return 1;
  return Math.min(1, aw / w, ah / h);
}

/**
 * Доля ширины ленты под текст: тело ленты — 624 из 760 (ribbonSvg), внутри него отступ не меньше 8 % с каждой стороны.
 * Текст шире — шрифт ленты ужимается (dom.ts, fitRibbon).
 */
export const RIBBON_TEXT_FRAC = (624 * (1 - 2 * 0.08)) / 760;

/** Множитель шрифта ленты, чтобы текст естественной ширины textW поместился в ленту шириной ribbonW. */
export function ribbonTextScale(ribbonW: number, textW: number): number {
  if (!(ribbonW > 0) || !(textW > 0)) return 1;
  return Math.min(1, (ribbonW * RIBBON_TEXT_FRAC) / textW);
}

/** Размер вёрстки в режиме летербокса (16:9) — см. .abui[data-letterbox]. */
export const LETTERBOX_W = 640;
export const LETTERBOX_H = 360;

/** Масштаб полосы 16:9 под окно w×h. */
export function letterboxScale(w: number, h: number): number {
  return Math.min(w / LETTERBOX_W, h / LETTERBOX_H);
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
  /** Масштаб меню (потолок U_MENU_MAX). */
  uMenu: number;
  coarse: boolean;
  portrait: boolean;
  form: 'phone' | 'tablet' | 'desktop';
}

/** Посчитать раскладку для элемента-корня и записать CSS-переменные/атрибуты. */
export function applyLayout(root: HTMLElement): LayoutInfo {
  // clientWidth/Height — размер вёрстки без transform (в летербоксе корень масштабирован)
  const r = root.getBoundingClientRect();
  const w = Math.max(1, Math.round(root.clientWidth || r.width || window.innerWidth));
  const h = Math.max(1, Math.round(root.clientHeight || r.height || window.innerHeight));
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const u = computeUiScale(w, h, coarse);
  const uMenu = computeUiScale(w, h, coarse, U_MENU_MAX);
  const form: LayoutInfo['form'] = coarse ? (Math.min(w, h) < 500 ? 'phone' : 'tablet') : 'desktop';
  root.style.setProperty('--u', `${u.toFixed(4)}px`);
  root.style.setProperty('--u-menu', `${uMenu.toFixed(4)}px`);
  root.dataset.pointer = coarse ? 'coarse' : 'fine';
  root.dataset.form = form;
  root.dataset.orient = h > w ? 'portrait' : 'landscape';
  return { w, h, u, uMenu, coarse, portrait: h > w, form };
}
