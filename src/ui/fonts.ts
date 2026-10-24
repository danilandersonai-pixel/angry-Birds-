// Шрифты интерфейса (04 §9). Luckiest Guy и Lilita One НЕ содержат кириллицы (в пакетах только latin/latin-ext),
// поэтому текст — Rubik 900/700 (кириллица + латиница), а Luckiest Guy — только для цифр (счёт, номера уровней).
// Грузим явно нужные подмножества через FontFace: в сборке в один файл не тянем лишние алфавиты.

import rubik900Lat from '@fontsource/rubik/files/rubik-latin-900-normal.woff2?url';
import rubik900Cyr from '@fontsource/rubik/files/rubik-cyrillic-900-normal.woff2?url';
import rubik700Lat from '@fontsource/rubik/files/rubik-latin-700-normal.woff2?url';
import rubik700Cyr from '@fontsource/rubik/files/rubik-cyrillic-700-normal.woff2?url';
import luckyLat from '@fontsource/luckiest-guy/files/luckiest-guy-latin-400-normal.woff2?url';

const LAT =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const CYR = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

export const FONT_UI = '"Rubik", system-ui, sans-serif';
export const FONT_NUM = '"Luckiest Guy", "Rubik", sans-serif';

let loading: Promise<void> | null = null;

/** Загрузить шрифты один раз (повторные вызовы возвращают тот же промис). Ошибки не пробрасываются. */
export function loadFonts(): Promise<void> {
  if (loading) return loading;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return (loading = Promise.resolve());
  const faces = [
    new FontFace('Rubik', `url(${rubik900Lat}) format("woff2")`, { weight: '900', unicodeRange: LAT, display: 'block' }),
    new FontFace('Rubik', `url(${rubik900Cyr}) format("woff2")`, { weight: '900', unicodeRange: CYR, display: 'block' }),
    new FontFace('Rubik', `url(${rubik700Lat}) format("woff2")`, { weight: '700', unicodeRange: LAT, display: 'block' }),
    new FontFace('Rubik', `url(${rubik700Cyr}) format("woff2")`, { weight: '700', unicodeRange: CYR, display: 'block' }),
    new FontFace('Luckiest Guy', `url(${luckyLat}) format("woff2")`, { weight: '400', unicodeRange: LAT, display: 'block' }),
  ];
  loading = Promise.all(
    faces.map((ff) => {
      document.fonts.add(ff);
      return ff.load().catch(() => undefined);
    }),
  ).then(() => undefined);
  return loading;
}
