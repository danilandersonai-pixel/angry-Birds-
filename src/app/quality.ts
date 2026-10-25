// Автокачество (04 §10.1): решение «вниз / вверх» по интервалам rAF относительно частоты дисплея и по CPU-времени
// кадра игры. Без GPU-растра основная цена кадра — вне JS (растр и композитинг холста): JS-время кадра 1–3 мс, а кадры
// выпадают; поэтому главный признак — доля кадров длиннее 1.5 периода, JS-время — второй.
// Период дисплея — медиана интервалов на экранах меню (там кадр дешёвый); цель — не чаще 60 fps (на 120 Гц кадр
// 16.7 мс не «медленный»), 30/50 Гц тоже работают. Тяжёлая перегрузка (медиана интервала > 50 мс или CPU > 2·SLOW
// за 1 с) — сразу на LOW; обычная (≥ 12 % медленных кадров за 2 с) — на ступень ниже. Понижение — не чаще раза
// в 2.5 с, повышение — после 5 с быстрых кадров и не раньше 10 с после смены; после двух понижений вверх не идём.

import type { QualityLevel } from './CanvasHost';

export const AUTO_Q = {
  /** CPU-время кадра игры, мс: медленный / быстрый кадр. */
  SLOW_MS: 13,
  FAST_MS: 7,
  /** Медленный кадр: интервал длиннее стольких периодов дисплея (выпал хотя бы один кадр). */
  SLOW_K: 1.5,
  /** Быстрый кадр: интервал не длиннее стольких периодов. */
  FAST_K: 1.2,
  /** Окно доли медленных кадров, с, и порог доли. */
  WINDOW_S: 2,
  SLOW_SHARE: 0.12,
  /** Тяжёлая перегрузка за SEVERE_S: медиана интервала > SEVERE_DT_MS или медиана CPU > 2·SLOW_MS — сразу LOW. */
  SEVERE_S: 1,
  SEVERE_DT_MS: 50,
  /** Кулдаун понижения и повышения, с; сколько секунд быстрых кадров нужно для повышения. */
  DOWN_COOLDOWN_S: 2.5,
  UP_COOLDOWN_S: 10,
  UP_AFTER_S: 5,
  /** Больше стольких понижений — вверх не идём (без качелей). */
  MAX_DOWNGRADES_FOR_UP: 2,
  /** Период дисплея: не меньше 144 Гц и не больше 30 Гц; цель — не чаще 60 fps. */
  PERIOD_MIN_MS: 1000 / 144,
  PERIOD_MAX_MS: 1000 / 30,
  TARGET_MIN_MS: 1000 / 60,
} as const;

const A = AUTO_Q;

const ORDER: readonly QualityLevel[] = ['high', 'med', 'low'];

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Sample {
  t: number;
  dt: number;
  cpu: number;
}

export class AutoQuality {
  /** Период дисплея, мс (медиана интервалов меню; по умолчанию 60 Гц). */
  period = 1000 / 60;
  private readonly periodSamples: number[] = [];
  private samples: Sample[] = [];
  private fastT = 0;
  private lastChange = -Infinity;
  private lastEval = -Infinity;
  /** Сколько раз понижали. */
  downgrades = 0;

  /** Интервал кадра на экране меню (дешёвый кадр) — оценка периода дисплея. */
  observePeriod(dtMs: number): void {
    if (!(dtMs > 0) || !Number.isFinite(dtMs) || dtMs > 250) return;
    const ps = this.periodSamples;
    ps.push(dtMs);
    if (ps.length > 120) ps.shift();
    if (ps.length >= 20) this.period = Math.min(A.PERIOD_MAX_MS, Math.max(A.PERIOD_MIN_MS, median(ps)));
  }

  /** Целевой интервал кадра, мс: период дисплея, но не чаще 60 fps. */
  get target(): number {
    return Math.max(this.period, A.TARGET_MIN_MS);
  }

  /** Забыть окна (пауза, облёт ещё не начался, смена уровня). Кулдауны и счётчик понижений остаются. */
  reset(): void {
    this.samples = [];
    this.fastT = 0;
  }

  /**
   * Кадр игры: интервал rAF и CPU-время кадра, мс; now — время приложения, с; q — текущая ступень.
   * Возвращает ступень, на которую нужно перейти, или null.
   */
  frame(dtMs: number, cpuMs: number, now: number, q: QualityLevel): QualityLevel | null {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return null;
    const cpu = Number.isFinite(cpuMs) ? cpuMs : 0;
    const s = this.samples;
    s.push({ t: now, dt: dtMs, cpu });
    while (s.length > 0 && now - s[0].t > A.WINDOW_S) s.shift();
    const tgt = this.target;
    const slow = dtMs > A.SLOW_K * tgt || cpu > A.SLOW_MS;
    const fast = dtMs <= A.FAST_K * tgt && cpu < A.FAST_MS;
    this.fastT = fast ? this.fastT + dtMs / 1000 : 0;
    const span = s.length > 1 ? now - s[0].t + s[0].dt / 1000 : 0;
    const i = ORDER.indexOf(q);
    // вниз (проверка раз в 0.1 с): тяжёлая перегрузка — сразу LOW; иначе доля медленных кадров за окно — на ступень
    if (q !== 'low' && now - this.lastChange >= A.DOWN_COOLDOWN_S && now - this.lastEval >= 0.1) {
      this.lastEval = now;
      const recent = s.filter((x) => now - x.t <= A.SEVERE_S);
      const rSpan = recent.length > 1 ? now - recent[0].t + recent[0].dt / 1000 : 0;
      if (rSpan >= 0.9 * A.SEVERE_S) {
        const mDt = median(recent.map((x) => x.dt));
        const mCpu = median(recent.map((x) => x.cpu));
        if (mDt > A.SEVERE_DT_MS || mCpu > 2 * A.SLOW_MS) return this.change('low', now, true);
      }
      if (span >= 0.9 * A.WINDOW_S) {
        let n = 0;
        for (const x of s) if (x.dt > A.SLOW_K * tgt || x.cpu > A.SLOW_MS) n++;
        if (n / s.length > A.SLOW_SHARE) return this.change(ORDER[i + 1], now, true);
      }
    }
    // вверх: 5 с подряд быстрых кадров, не раньше 10 с после смены и не после двух понижений
    if (
      q !== 'high' &&
      !slow &&
      this.fastT >= A.UP_AFTER_S &&
      now - this.lastChange >= A.UP_COOLDOWN_S &&
      this.downgrades < A.MAX_DOWNGRADES_FOR_UP
    ) {
      return this.change(ORDER[i - 1], now, false);
    }
    return null;
  }

  private change(to: QualityLevel, now: number, down: boolean): QualityLevel {
    this.lastChange = now;
    if (down) this.downgrades++;
    this.reset(); // новая ступень — новые замеры
    return to;
  }
}
