// Фиксированный шаг физики с накопителем (спецификация §4, 00 §1.1): шаг ровно dt, не больше maxSteps за кадр,
// лишний остаток выбрасывается (защита от «спирали смерти» после долгого кадра или скрытой вкладки).

export interface StepResult {
  /** Новый остаток накопителя, с (0 ≤ acc < dt). */
  acc: number;
  /** Сколько шагов сделано. */
  steps: number;
}

export function advance(acc: number, frameDt: number, dt: number, maxSteps: number, step: () => void): StepResult {
  let a = acc + Math.max(0, Number.isFinite(frameDt) ? frameDt : 0);
  let n = 0;
  while (a >= dt - 1e-9 && n < maxSteps) {
    step();
    a -= dt;
    n++;
  }
  if (a >= dt) a %= dt; // долгий кадр: остаток выбрасываем
  return { acc: Math.max(0, a), steps: n };
}
