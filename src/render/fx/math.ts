// Мелкие математические помощники эффектов (косметика, Math.random допустим — ядро не затрагивается).

export const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Равномерное случайное в [a, b). */
export const rand = (a: number, b: number): number => a + (b - a) * Math.random();
/** Случайное целое в [a, b]. */
export const randInt = (a: number, b: number): number => a + Math.floor(Math.random() * (b - a + 1));
/** Случайный знак ±1. */
export const randSign = (): number => (Math.random() < 0.5 ? -1 : 1);

/** Плавная ступень 0 → 1 на [e0, e1] (3u² − 2u³). */
export const smoothstep = (e0: number, e1: number, v: number): number => {
  const u = clamp((v - e0) / (e1 - e0), 0, 1);
  return u * u * (3 - 2 * u);
};

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};

/** '#RRGGBB' → [r, g, b]. */
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Смешать два '#RRGGBB' в долю t (0 — a, 1 — b). */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexRgb(a);
  const [r2, g2, b2] = hexRgb(b);
  const r = Math.round(lerp(r1, r2, t));
  const g = Math.round(lerp(g1, g2, t));
  const bl = Math.round(lerp(b1, b2, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** '#RRGGBB' + альфа → 'rgba(...)'. */
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
