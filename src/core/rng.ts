// Детерминированный генератор псевдослучайных чисел (mulberry32).
// В ядре нельзя использовать Math.random — иначе симуляция не воспроизводима (тесты, решатель уровней).

export class Rng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Число в [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Число в [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Целое в [a, b]. */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
}
