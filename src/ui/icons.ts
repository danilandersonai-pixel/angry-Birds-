// Иконки интерфейса — inline SVG (07 §4.2), viewBox 0 0 24 24.
// Заливка: белая с обводкой цвета кнопки (--b-edge). Линии: рисуются дважды — толстая обводка + белая линия.
// Цвета задаются классами в styles.css (.ic-f, .ic-o, .ic-l), поэтому иконка «перекрашивается» вместе с кнопкой.

export type IconName =
  | 'play'
  | 'pause'
  | 'restart'
  | 'menu'
  | 'next'
  | 'back'
  | 'sound'
  | 'music'
  | 'lock'
  | 'star'
  | 'settings'
  | 'fullscreen'
  | 'close'
  | 'phone';

/** Путь звезды в системе 24×24 (R 10.6, r 0.5R). */
export const STAR_24 =
  'M12 2.3L15.12 8.61L22.08 9.62L17.04 14.54L18.23 21.48L12 18.2L5.77 21.48L6.96 14.54L1.92 9.62L8.88 8.61Z';
/** Путь звезды в системе 100×100 (07 §4.4). */
export const STAR_100 =
  'M50 3L64.7 32.8L97.6 37.5L73.8 60.7L79.4 93.5L50 78L20.6 93.5L26.2 60.7L2.4 37.5L35.3 32.8Z';

/** Заливка с обводкой. */
const f = (d: string): string => `<path class="ic-f" d="${d}"/>`;
/** Линия в два прохода (обводка + белая). */
const l = (d: string): string => `<path class="ic-o" d="${d}"/><path class="ic-l" d="${d}"/>`;

/** Шестерёнка: 8 зубцов, отверстие по центру (evenodd). */
function gearPath(): string {
  const cx = 12;
  const cy = 12;
  const n = 8;
  const rOut = 10.2;
  const rIn = 7.6;
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const step = (Math.PI * 2) / n;
    // зубец: плечо внутреннего радиуса → вершина → плечо
    const seq: Array<[number, number]> = [
      [a0 - step * 0.5, rIn],
      [a0 - step * 0.2, rIn],
      [a0 - step * 0.14, rOut],
      [a0 + step * 0.14, rOut],
      [a0 + step * 0.2, rIn],
    ];
    for (const [a, r] of seq) pts.push(`${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`);
  }
  const hole = 3.1;
  return `M${pts.join('L')}Z M${cx + hole} ${cy}a${hole} ${hole} 0 1 0 ${-2 * hole} 0a${hole} ${hole} 0 1 0 ${2 * hole} 0Z`;
}

const BODY: Record<IconName, string> = {
  play: f('M8.6 5.2v13.6l10.4-6.8z'),
  pause: `<rect class="ic-f" x="5.8" y="4.6" width="4.6" height="14.8" rx="1.3"/><rect class="ic-f" x="13.6" y="4.6" width="4.6" height="14.8" rx="1.3"/>`,
  restart: l('M18.6 12.6a6.8 6.8 0 1 1-2-5.3') + l('M17.2 3.2v4.3h-4.3'),
  menu: [3.5, 10, 16.5]
    .flatMap((y) => [3.5, 10, 16.5].map((x) => `<rect class="ic-f" x="${x}" y="${y}" width="4" height="4" rx="1"/>`))
    .join(''),
  next: f('M5.2 5.4v13.2L14.6 12z') + `<rect class="ic-f" x="16" y="5.4" width="3" height="13.2" rx="1"/>`,
  back: l('M15 5.2l-7 6.8 7 6.8'),
  sound: f('M3.4 9.3h3.9l5.2-4.6v14.6l-5.2-4.6H3.4z') + l('M15.6 9a4 4 0 0 1 0 6') + l('M18.2 6.4a7.6 7.6 0 0 1 0 11.2'),
  music:
    l('M9.2 17.4V6.6l10-2.6v11') +
    `<circle class="ic-f" cx="6.8" cy="17.6" r="2.7"/><circle class="ic-f" cx="16.8" cy="15.1" r="2.7"/>`,
  lock:
    l('M8.2 10.6V8.2a3.8 3.8 0 0 1 7.6 0v2.4') +
    `<rect class="ic-f" x="5" y="10.4" width="14" height="10.2" rx="2.6"/><circle class="ic-k" cx="12" cy="15.4" r="1.6"/>`,
  star: f(STAR_24),
  settings: `<path class="ic-f" fill-rule="evenodd" d="${gearPath()}"/>`,
  fullscreen: l('M4.2 9.2V4.2h5M14.8 4.2h5v5M19.8 14.8v5h-5M9.2 19.8h-5v-5'),
  close: l('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  phone: `<rect class="ic-f" x="6.6" y="2.4" width="10.8" height="19.2" rx="2.4"/><path class="ic-k-l" d="M10.4 18.4h3.2"/>`,
};

/** Перечёркивание «выключено» поверх иконки звука/музыки. */
const OFF = `<g class="ic-off"><path class="ic-off-o" d="M4.4 4.4l15.2 15.2"/><path class="ic-off-l" d="M4.4 4.4l15.2 15.2"/></g>`;

/** SVG-иконка строкой. */
export function icon(name: IconName, opts?: { off?: boolean; cls?: string }): string {
  const cls = `ic ic--${name}${opts?.cls ? ` ${opts.cls}` : ''}`;
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
    BODY[name] +
    (opts?.off ? OFF : '') +
    `</svg>`
  );
}

/** Звезда 100×100 для панелей, плиток и счётчиков. Градиент и клип — в общих defs (ensureDefs). */
export function starSvg(kind: 'full' | 'empty', cls = ''): string {
  const body =
    kind === 'full'
      ? `<path class="st-full" d="${STAR_100}"/>` +
        `<ellipse class="st-gloss" cx="40" cy="30" rx="22" ry="11" transform="rotate(-23 40 30)" clip-path="url(#abui-star-clip)"/>`
      : `<path class="st-empty" d="${STAR_100}"/>`;
  return `<svg class="star star--${kind} ${cls}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Общие определения SVG (градиенты, клипы). Вставляются один раз в корень UI и не удаляются. */
export const DEFS_SVG =
  `<svg class="abui-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>` +
  `<linearGradient id="abui-star-g" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="#FFF59A"/><stop offset=".45" stop-color="#FFC21A"/><stop offset="1" stop-color="#F08A06"/>` +
  `</linearGradient>` +
  `<clipPath id="abui-star-clip"><path d="${STAR_100}"/></clipPath>` +
  `<linearGradient id="abui-rib-win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD45E"/><stop offset=".5" stop-color="#FF9E1B"/><stop offset="1" stop-color="#E8770C"/></linearGradient>` +
  `<linearGradient id="abui-rib-lose" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A7A"/><stop offset=".5" stop-color="#EE3B2E"/><stop offset="1" stop-color="#C21F16"/></linearGradient>` +
  `<linearGradient id="abui-rib-info" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DD6FF"/><stop offset=".5" stop-color="#2FA4EC"/><stop offset="1" stop-color="#1A7CC8"/></linearGradient>` +
  `</defs></svg>`;

/** Лента-заголовок (07 §4.3): SVG-подложка, текст — HTML поверх. */
export function ribbonSvg(kind: 'win' | 'lose' | 'info'): string {
  return (
    `<svg class="ribbon-bg" viewBox="0 0 760 120" preserveAspectRatio="none" aria-hidden="true" focusable="false">` +
    `<path class="rb-tail" d="M10 40H130V114H10L42 77Z"/>` +
    `<path class="rb-tail" d="M750 40H630V114H750L718 77Z"/>` +
    `<path class="rb-fold" d="M100 100L130 114V100Z M660 100L630 114V100Z"/>` +
    `<rect class="rb-body" x="68" y="8" width="624" height="96" rx="14" fill="url(#abui-rib-${kind})"/>` +
    `<rect class="rb-gloss" x="80" y="16" width="600" height="18" rx="9"/>` +
    `</svg>`
  );
}
