// Фоновая работа в простое главного потока: генератор считает по кусочку в requestIdleCallback
// (без него — setTimeout), пока не закончит. Нужна, чтобы тяжёлые массивы (шумы, отклик реверба)
// были готовы ДО первого жеста: в обработчике жеста остаются только создание контекста и resume().

type IdleDeadlineLike = { timeRemaining(): number; didTimeout?: boolean };
type IdleHost = {
  requestIdleCallback?: (cb: (d: IdleDeadlineLike) => void, o?: { timeout: number }) => number;
  cancelIdleCallback?: (h: number) => void;
};

/** Сколько миллисекунд работать за один заход, если браузер не сообщает остаток простоя. */
const SLICE_MS = 4;

export interface IdleTask<T> {
  /** Готовый результат или null, пока считается. */
  readonly value: T | null;
  /** Досчитать синхронно (жест пришёл раньше, чем закончился простой) и вернуть результат. */
  finish(): T;
  /** Вызвать fn с результатом, когда он будет готов (сразу, если уже готов). */
  then(fn: (v: T) => void): void;
  /** Остановить работу (результат больше не нужен). */
  cancel(): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Запустить генератор в простое главного потока. timeoutMs — не ждать простоя дольше (requestIdleCallback timeout). */
export function idleRun<T>(gen: Generator<void, T>, timeoutMs = 300): IdleTask<T> {
  const host = globalThis as unknown as IdleHost;
  let value: T | null = null;
  let done = false;
  let cancelled = false;
  let handle: { idle?: number; timer?: ReturnType<typeof setTimeout> } = {};
  const waiters: Array<(v: T) => void> = [];

  const complete = (v: T): void => {
    value = v;
    done = true;
    for (const fn of waiters.splice(0)) fn(v);
  };
  const stepUntil = (deadline: () => boolean): void => {
    while (!done) {
      const r = gen.next();
      if (r.done) complete(r.value);
      else if (deadline()) break;
    }
  };
  const schedule = (): void => {
    if (done || cancelled) return;
    if (typeof host.requestIdleCallback === 'function') {
      handle = {
        idle: host.requestIdleCallback((d) => {
          handle = {};
          const t0 = now();
          stepUntil(() => (d.didTimeout ? now() - t0 > SLICE_MS : d.timeRemaining() < 1));
          schedule();
        }, { timeout: timeoutMs }),
      };
    } else {
      handle = {
        timer: setTimeout(() => {
          handle = {};
          const t0 = now();
          stepUntil(() => now() - t0 > SLICE_MS);
          schedule();
        }, 0),
      };
    }
  };
  const unschedule = (): void => {
    if (handle.idle !== undefined) host.cancelIdleCallback?.(handle.idle);
    if (handle.timer !== undefined) clearTimeout(handle.timer);
    handle = {};
  };
  schedule();

  return {
    get value() {
      return value;
    },
    finish(): T {
      if (!done) {
        unschedule();
        stepUntil(() => false);
      }
      return value as T;
    },
    then(fn: (v: T) => void): void {
      if (done) fn(value as T);
      else waiters.push(fn);
    },
    cancel(): void {
      cancelled = true;
      waiters.length = 0;
      unschedule();
    },
  };
}
