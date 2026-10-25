// Устойчивость решения к ошибке руки (ревью «арт и ощущения»): серия выстрелов с шумом исполнения — угол, сила и
// момент тапа, — N прогонов с нуля. Птицы сверх серии добивают теми же выстрелами по кругу (как игрок, повторяющий
// удачный ход). Шум детерминирован: отклонения прогона k для выстрела i зависят только от (seed, k, i), поэтому
// итог воспроизводим и не зависит от способа оценки (в процессе или пулом), а разные кандидаты решателя
// сравниваются на одних и тех же отклонениях (общие случайные числа — меньше разброс сравнения).

import { Rng } from '../rng';
import type { LevelDef } from '../types';
import { simulateShots, type Shot, type SimResult, type WaitPolicy } from './shots';

/** Шум исполнения: σ угла, градусы; σ силы (доля полной); σ момента тапа, кадры по 1/60 с. */
export interface Noise {
  angle: number;
  power: number;
  tapFrames: number;
}

/** «Мелкий» шум — аккуратный игрок; «рука» — обычный палец на телефоне (ревью: ±0.5° / 1 % / 1 кадр и ±1.5° / 3 % / 3 кадра). */
export const NOISE = {
  fine: { angle: 0.5, power: 0.01, tapFrames: 1 },
  hand: { angle: 1.5, power: 0.03, tapFrames: 3 },
} as const satisfies Record<string, Noise>;

/** Сила выстрела с шумом не выходит из этих пределов. */
const POWER_MIN = 0.3;
/** Тап не раньше этого (дребезг пальца в ядре — 0.05 с). */
const TAP_MIN = 0.05;

/** Стандартные нормальные отклонения (угол, сила, тап) прогона k для выстрела i. */
export class NoiseTable {
  private readonly rows: Array<Array<[number, number, number]>> = [];

  constructor(private readonly seed = 1) {}

  draw(k: number, i: number): [number, number, number] {
    const row = (this.rows[k] ??= []);
    while (row.length <= i) {
      // свой поток на (k, i): отклонения выстрела не зависят от того, сколько выстрелов в серии
      const rng = new Rng((Math.imul(this.seed, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b) ^ Math.imul(row.length + 1, 0xc2b2ae35)) >>> 0);
      const g = () => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
      row.push([g(), g(), g()]);
    }
    return row[i];
  }
}

/** Серия с шумом прогона k (round — до 1e-4 по углу и силе, тап — целыми кадрами). */
export function jitterShots(shots: readonly Shot[], noise: Noise, k: number, table: NoiseTable): Shot[] {
  return shots.map((s, i) => {
    const [ga, gp, gt] = table.draw(k, i);
    const tap = s.abilityAt ?? null;
    return {
      angleDeg: Math.round((s.angleDeg + ga * noise.angle) * 1e4) / 1e4,
      power: Math.round(Math.min(1, Math.max(POWER_MIN, s.power + gp * noise.power)) * 1e4) / 1e4,
      abilityAt: tap === null ? null : Math.max(TAP_MIN, Math.round((tap + Math.round(gt * noise.tapFrames) / 60) * 1e4) / 1e4),
    };
  });
}

/** Серия на все птицы уровня: недостающие выстрелы — те же выстрелы по кругу. */
export function fillPlan(level: LevelDef, plan: readonly Shot[]): Shot[] {
  const out = plan.slice();
  if (plan.length === 0) return out;
  while (out.length < level.birds.length) out.push({ ...plan[out.length % plan.length] });
  return out;
}

export interface RobustOptions {
  /** Прогонов (по умолчанию 30). */
  runs?: number;
  /** По умолчанию NOISE.fine. */
  noise?: Noise;
  /** seed шума (по умолчанию 1); seed сессии — sessionSeed (1). */
  seed?: number;
  sessionSeed?: number;
  wait?: WaitPolicy;
}

export interface RobustReport {
  runs: number;
  wins: number;
  winRate: number;
  /** Счёт прогонов в порядке k (у поражения — счёт на момент конца, звёзд 0). */
  scores: number[];
  won: boolean[];
  stars: number[];
  /** Птиц потрачено в прогоне (у победы — до последней свиньи). */
  birdsUsed: number[];
  pigsLeft: number[];
  /** Средняя звёзд. */
  meanStars: number;
  /** Квантили счёта (поражение — 0): медиана и 80-й перцентиль. */
  median: number;
  p80: number;
}

/** Серии прогонов: шум на всю серию эксперта, затем добивка. */
export function robustBatch(level: LevelDef, plan: readonly Shot[], opts: RobustOptions = {}): Shot[][] {
  const runs = opts.runs ?? 30;
  const noise = opts.noise ?? NOISE.fine;
  const table = new NoiseTable(opts.seed ?? 1);
  const full = fillPlan(level, plan);
  return Array.from({ length: runs }, (_, k) => jitterShots(full, noise, k, table));
}

/** Квантиль q отсортированного по возрастанию массива (ближайший ранг снизу). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];
}

/** Сводка по итогам прогонов robustBatch (в том же порядке). */
export function robustReport(results: readonly SimResult[]): RobustReport {
  const runs = results.length;
  const won = results.map((r) => r.won);
  const wins = won.filter(Boolean).length;
  const scores = results.map((r) => r.score);
  const stars = results.map((r) => r.stars);
  const sorted = results.map((r) => (r.won ? r.score : 0)).sort((a, b) => a - b);
  return {
    runs,
    wins,
    winRate: runs ? wins / runs : 0,
    scores,
    won,
    stars,
    birdsUsed: results.map((r) => r.shots.length),
    pigsLeft: results.map((r) => r.pigsLeft),
    meanStars: runs ? stars.reduce((s, x) => s + x, 0) / runs : 0,
    median: quantile(sorted, 0.5),
    p80: quantile(sorted, 0.8),
  };
}

/** Устойчивость серии в текущем процессе. */
export function robustness(level: LevelDef, plan: readonly Shot[], opts: RobustOptions = {}): RobustReport {
  const seed = opts.sessionSeed ?? 1;
  const wait = opts.wait ?? 'calm';
  return robustReport(robustBatch(level, plan, opts).map((shots) => simulateShots(level, shots, seed, { wait })));
}
