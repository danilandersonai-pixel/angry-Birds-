// Нарезка долгой работы на куски с уступкой кадра (старт приложения, загрузка уровня): шаги — итератор, каждый шаг
// ≈ одна полоса/тайл/облако; между кусками ≥ sliceMs — await yieldFn() (полоса загрузки и музыка не замирают).

/** Параметры нарезки: yieldFn — уступить кадр (без неё всё выполняется сразу), sliceMs — длина куска, мс. */
export interface SliceOpts {
  readonly yieldFn?: () => Promise<void>;
  readonly sliceMs?: number;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Выполнить шаги итератора кусками ≤ sliceMs (по умолчанию 12 мс) с await yieldFn() между ними. Возвращает число шагов. */
export async function runSliced(steps: Iterator<unknown>, opts: SliceOpts = {}): Promise<number> {
  const { yieldFn, sliceMs = 12 } = opts;
  let n = 0;
  let t0 = nowMs();
  for (;;) {
    if (steps.next().done) return n;
    n++;
    if (yieldFn && nowMs() - t0 >= sliceMs) {
      await yieldFn();
      t0 = nowMs();
    }
  }
}

/** Выполнить все шаги сразу (синхронный прогрев). */
export function runAll(steps: Iterator<unknown>): number {
  let n = 0;
  while (!steps.next().done) n++;
  return n;
}
