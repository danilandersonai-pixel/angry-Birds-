// Анимации UI (07 §3.4, §4.8): easing, pop-in/out, тряска, таймлайн на rAF.
// Анимируем только transform и opacity. При reduced motion всё укорачивается и без перелётов.

export const motion = { reduced: false };

export const CSS_EASE = {
  out: 'cubic-bezier(0.33, 1, 0.68, 1)',
  in: 'cubic-bezier(0.32, 0, 0.67, 0)',
  inout: 'cubic-bezier(0.65, 0, 0.35, 1)',
  back: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  inBack: 'cubic-bezier(0.36, 0, 0.66, -0.56)',
} as const;

export const ease = {
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
} as const;

/** Безопасный вызов Element.animate (в старых движках его может не быть). */
export function anim(el: Element, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (typeof (el as HTMLElement).animate !== 'function') return null;
  return el.animate(frames, opts);
}

/** Pop-in с перелётом: scale 0.3 → 1.08 → 0.97 → 1 за 0.36 с. */
export function popIn(el: Element, delayMs = 0, dur = 360): Animation | null {
  if (motion.reduced)
    return anim(el, [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], {
      duration: 150,
      delay: delayMs,
      easing: CSS_EASE.out,
      fill: 'backwards',
    });
  return anim(
    el,
    [
      { opacity: 0, transform: 'scale(0.3)', easing: CSS_EASE.out },
      { opacity: 1, transform: 'scale(1.08)', offset: 0.6, easing: 'ease-in-out' },
      { transform: 'scale(0.97)', offset: 0.8, easing: 'ease-in-out' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: dur, delay: delayMs, fill: 'backwards' },
  );
}

export function popOut(el: Element, dur = 160): Animation | null {
  return anim(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.9)' }], {
    duration: motion.reduced ? 120 : dur,
    easing: CSS_EASE.in,
    fill: 'forwards',
  });
}

/** «Закрыто»: дрожь по X. */
export function shake(el: Element): Animation | null {
  if (motion.reduced) return null;
  return anim(
    el,
    [0, -10, 9, -6, 4, 0].map((x) => ({ transform: `translateX(calc(${x} * var(--u)))` })),
    { duration: 360, easing: 'ease-out' },
  );
}

export function fadeIn(el: Element, dur = 250, delay = 0): Animation | null {
  return anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: dur, delay, easing: 'linear', fill: 'backwards' });
}

/** Дождаться окончания анимации (или сразу, если её нет). */
export function done(a: Animation | null | undefined): Promise<void> {
  if (!a) return Promise.resolve();
  return a.finished.then(
    () => undefined,
    () => undefined,
  );
}

export function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type AtFn = (skipped: boolean) => void;
type TweenFn = (k: number) => void;

/**
 * Таймлайн на rAF: события at(sec) и твины tween(t0, dur).
 * skip() немедленно выполняет оставшиеся события (skipped = true) и доводит твины до k = 1.
 * dt ограничен 0.1 с — после сворачивания вкладки таймлайн не перепрыгивает.
 */
export class Timeline {
  private events: Array<{ t: number; fn: AtFn; fired: boolean }> = [];
  private tweens: Array<{ t0: number; dur: number; fn: TweenFn; done: boolean }> = [];
  private time = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  finished = false;
  onFinish: (() => void) | null = null;

  at(sec: number, fn: AtFn): this {
    this.events.push({ t: sec, fn, fired: false });
    return this;
  }

  tween(t0: number, dur: number, fn: TweenFn): this {
    this.tweens.push({ t0, dur: Math.max(0.0001, dur), fn, done: false });
    return this;
  }

  play(): this {
    if (this.running) return this;
    this.running = true;
    this.last = performance.now();
    const step = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      this.time += dt;
      this.advance(false);
      if (!this.finished) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    return this;
  }

  skip(): void {
    if (this.finished) return;
    this.time = Infinity;
    this.advance(true);
  }

  stop(): void {
    this.running = false;
    this.cancel();
  }

  private cancel(): void {
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private advance(skipped: boolean): void {
    for (const tw of this.tweens) {
      if (tw.done || this.time < tw.t0) continue;
      const k = Math.min(1, (this.time - tw.t0) / tw.dur);
      tw.fn(k);
      if (k >= 1) tw.done = true;
    }
    // события — по времени
    const due = this.events.filter((e) => !e.fired && e.t <= this.time).sort((a, b) => a.t - b.t);
    for (const e of due) {
      e.fired = true;
      e.fn(skipped);
    }
    if (this.events.every((e) => e.fired) && this.tweens.every((tw) => tw.done)) {
      this.finished = true;
      this.running = false;
      this.cancel();
      const cb = this.onFinish;
      this.onFinish = null;
      cb?.();
    }
  }
}
