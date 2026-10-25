// Бот-эксперт (06 §7.2): жадно по птицам перебирает сетку «угол × сила × момент способности» и оценивает
// каждого кандидата повтором с нуля — createSession и все предыдущие выстрелы (снимки planck теряют warm-start
// контактов и не совпали бы бит-в-бит). Критерий — сначала число живых свиней, затем очки. Лучевой поиск:
// после каждой птицы остаются `beam` лучших различных продолжений; лучшие кандидаты уточняются соседями по сетке.
// Перебор выдаёт кандидатов пакетами независимых серий: solveLevel считает их в своём процессе,
// solveLevelAsync — любым оценщиком (например, пулом процессов). Итог от способа оценки не зависит.
// Найденные выстрелы точно повторяются: simulateShots(level, r.shots, r.seed, { wait: r.wait }).

import type { BirdType, LevelDef } from '../index';
import { wallMs } from './clock';
import { simulateShots, type Shot, type ShotLog, type SimResult, type WaitPolicy } from './shots';

export type GridPreset = 'full' | 'fast';

const range = (from: number, to: number, step: number) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

/** Сетки 06 §7.2: полная — 35 углов × 4 силы; быстрая (CI) — шаг угла 4° и 3 силы, ≈ ×0.4 по времени. */
export const GRIDS: Readonly<Record<GridPreset, { angles: readonly number[]; powers: readonly number[] }>> = {
  full: { angles: range(4, 72, 2), powers: [0.7, 0.8, 0.9, 1.0] },
  fast: { angles: range(4, 72, 4), powers: [0.8, 0.9, 1.0] },
};

/** Момент тапа: с после запуска; null — без тапа; afterImpact — через столько секунд после первого удара. */
export type TapSpec = number | null | { afterImpact: number };

/** Моменты тапа по птицам (06 §7.2). У Бомба null — автоподрыв фитилём через 2.5 с после удара. */
export const TAPS: Readonly<Record<BirdType, readonly TapSpec[]>> = {
  red: [null],
  terence: [null],
  blues: [0.5, 0.8],
  chuck: [0.45, 0.7, 0.95],
  bomb: [null, { afterImpact: 0.2 }],
  matilda: [0.6, 0.9, 1.2],
  hal: [0.5, 0.8, 1.1],
  silver: [0.4, 0.6, 0.8],
};

export interface SolveOptions {
  /** seed сессии (по умолчанию 1). */
  seed?: number;
  /** Сетка по умолчанию 'full'; angles / powers / taps переопределяют её части. */
  grid?: GridPreset;
  angles?: readonly number[];
  powers?: readonly number[];
  taps?: Partial<Record<BirdType, readonly TapSpec[]>>;
  /** Ширина луча (по умолчанию 2). */
  beam?: number;
  /** Сколько лучших кандидатов каждого продолжения уточнять соседями (полшага сетки); 0 — без уточнения. По умолчанию 3. */
  refine?: number;
  /** Лимит времени, мс (по умолчанию 60 000): по истечении возвращается лучшее найденное. */
  maxMs?: number;
  /**
   * Урезать перебор, если следующая птица не помещается в остаток maxMs (по умолчанию true): сначала быстрая сетка,
   * затем луч 1. Оценка — по времени прогона на прошлой птице (оно растёт с длиной повторяемой серии).
   */
  adaptive?: boolean;
  /** Правило очереди выстрелов (по умолчанию 'calm', как у бота 06 §7.2). */
  wait?: WaitPolicy;
  /** Вызывается после каждой птицы. */
  onProgress?: (p: SolveProgress) => void;
}

export interface SolveProgress {
  /** Сколько птиц уже перебрано. */
  bird: number;
  evaluations: number;
  ms: number;
  pigsLeft: number;
  score: number;
  /** Эта птица перебиралась урезанно (adaptive). */
  reduced: boolean;
}

export interface SolveResult {
  levelId: string;
  /** Все свиньи убиты. */
  solved: boolean;
  /** Лучшая найденная серия (при solved — до последней свиньи). */
  shots: Shot[];
  /** Итоговый счёт серии (при победе — с бонусом за оставшихся птиц). */
  score: number;
  stars: number;
  birdsUsed: number;
  pigsLeft: number;
  /** Журнал серии по выстрелам. */
  log: ShotLog[];
  ms: number;
  /** Сколько раз симулировался уровень. */
  evaluations: number;
  /** Перебор остановлен по maxMs. */
  timedOut: boolean;
  /** Хотя бы одна птица перебиралась урезанно, чтобы уложиться в maxMs. */
  reduced: boolean;
  seed: number;
  wait: WaitPolicy;
}

/** Пакет серий выстрелов на оценку — каждая с нуля, независимо от других. */
export type Batch = ReadonlyArray<readonly Shot[]>;
/** Итоги пакета по порядку; undefined — серия не оценена (кончилось время). */
export type BatchResults = ReadonlyArray<SimResult | undefined>;
/** Внешний оценщик пакета: обязан давать те же итоги, что simulateShots(level, shots, seed, { wait }). */
export type BatchEvaluator = (
  batch: Batch,
  ctx: { level: LevelDef; seed: number; wait: WaitPolicy; outOfTime: () => boolean },
) => Promise<BatchResults>;

interface Node {
  shots: Shot[];
  /** Момент тапа, из которого получен последний выстрел (для уточнения соседями). */
  tap: TapSpec;
  result: SimResult;
  value: number;
}

/** Кандидат: продолжение узла луча from выстрелом под углом и силой с тапом tap. */
interface Cand {
  from: number;
  angleDeg: number;
  power: number;
  tap: TapSpec;
}

/** Запрос на оценку: серия узла from плюс shot; tap — спецификация, из которой получен shot. */
interface Req {
  from: number;
  shot: Shot;
  tap: TapSpec;
}

interface Grid {
  angles: readonly number[];
  powers: readonly number[];
}

/** Как перебирать птицу: сетка и сколько узлов луча раскрывать. */
interface Step {
  grid: Grid;
  nodes: number;
}

interface Plan {
  taps: (bird: BirdType) => readonly TapSpec[];
  beam: number;
  refine: number;
  /** План для птицы с индексом bird при текущем луче. */
  choose: (bird: number, beam: readonly Node[]) => Step;
  /** После каждой птицы: true — остановить перебор. */
  stopAfter: (bird: number, best: Node) => boolean;
}

/** Сначала свиньи, затем очки. */
const valueOf = (r: SimResult) => -r.pigsLeft * 1e6 + r.score;
const outcomeKey = (n: Node) => `${n.result.pigsLeft}|${Math.round(n.result.score)}`;
const shotKey = (s: Shot) => `${s.angleDeg}|${s.power}|${s.abilityAt ?? '-'}`;
const round = (v: number, k = 1e4) => Math.round(v * k) / k;
const stepOf = (xs: readonly number[]) => (xs.length > 1 ? Math.min(...xs.slice(1).map((x, i) => x - xs[i])) : 0);
const afterImpact = (t: TapSpec): t is { afterImpact: number } => typeof t === 'object' && t !== null;

/** Первые n узлов с различным исходом (одинаковые «свиньи + очки» — почти наверняка один и тот же разлёт). */
function distinct(nodes: readonly Node[], n: number): Node[] {
  const seen = new Set<string>();
  const out: Node[] = [];
  for (const node of nodes) {
    if (out.length >= n) break;
    const k = outcomeKey(node);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(node);
  }
  return out;
}

/** Порядок кандидатов: выше ценность; при равенстве — раньше найден (сортировка устойчива). */
const better = (a: Node, b: Node) => b.value - a.value;

/** Оценка числа серий на узел: сетка × тапы и по 8 соседей у refine лучших. */
const expandCost = (grid: Grid, taps: number, refine: number) => grid.angles.length * grid.powers.length * taps + refine * 8;

/** Продолжения всех узлов луча выстрелом птицы bird: сетка, затем уточнение лучших соседями на полшага. */
function* expand(beam: readonly Node[], bird: BirdType, grid: Grid, plan: Plan): Generator<Batch, Node[], BatchResults> {
  const found = beam.map(() => new Map<string, Node>());

  /** Оценивает ещё не известные серии и раскладывает итоги по узлам. */
  function* run(reqs: readonly Req[]): Generator<Batch, void, BatchResults> {
    const fresh: Req[] = [];
    const queued = beam.map(() => new Set<string>());
    for (const r of reqs) {
      const k = shotKey(r.shot);
      if (found[r.from].has(k) || queued[r.from].has(k)) continue;
      queued[r.from].add(k);
      fresh.push(r);
    }
    if (fresh.length === 0) return;
    const results = yield fresh.map((r) => [...beam[r.from].shots, r.shot]);
    fresh.forEach((r, i) => {
      const result = results[i];
      if (result) found[r.from].set(shotKey(r.shot), { shots: [...beam[r.from].shots, r.shot], tap: r.tap, result, value: valueOf(result) });
    });
  }

  /** Тап afterImpact: сначала тот же выстрел без тапа — так узнаём момент удара, затем тап через заданное время. */
  function* tryCands(cands: readonly Cand[]): Generator<Batch, void, BatchResults> {
    const shot = (c: Cand, abilityAt: number | null): Shot => ({ angleDeg: c.angleDeg, power: c.power, abilityAt });
    yield* run(cands.map((c) => (afterImpact(c.tap) ? { from: c.from, shot: shot(c, null), tap: null } : { from: c.from, shot: shot(c, c.tap), tap: c.tap })));
    const late: Req[] = [];
    for (const c of cands) {
      if (!afterImpact(c.tap)) continue;
      const impactAt = found[c.from].get(shotKey(shot(c, null)))?.result.shots.at(-1)?.impactAt;
      if (impactAt != null) late.push({ from: c.from, shot: shot(c, round(impactAt + c.tap.afterImpact, 1e3)), tap: c.tap });
    }
    yield* run(late);
  }

  const cells: Cand[] = [];
  beam.forEach((_, from) => {
    for (const angleDeg of grid.angles) for (const power of grid.powers) for (const tap of plan.taps(bird)) cells.push({ from, angleDeg, power, tap });
  });
  yield* tryCands(cells);

  const dAngle = stepOf(grid.angles) / 2;
  const dPower = stepOf(grid.powers) / 2;
  const near: Cand[] = [];
  found.forEach((nodes, from) => {
    for (const c of distinct([...nodes.values()].sort(better), plan.refine)) {
      const last = c.shots[c.shots.length - 1];
      for (const da of [-dAngle, 0, dAngle]) {
        for (const dp of [-dPower, 0, dPower]) {
          const power = round(last.power + dp);
          if ((da !== 0 || dp !== 0) && power > 0 && power <= 1) near.push({ from, angleDeg: round(last.angleDeg + da), power, tap: c.tap });
        }
      }
    }
  });
  yield* tryCands(near);
  return found.flatMap((nodes) => [...nodes.values()]);
}

/** Жадный лучевой перебор по птицам; возвращает лучший узел (не хуже родителя: очки не убывают, свиньи не воскресают). */
function* search(level: LevelDef, plan: Plan, start: SimResult): Generator<Batch, Node, BatchResults> {
  const root: Node = { shots: [], tap: null, result: start, value: valueOf(start) };
  let best = root;
  let beam = [root];
  for (let i = 0; i < level.birds.length && root.result.pigsLeft > 0; i++) {
    const step = plan.choose(i, beam);
    const children = (yield* expand(beam.slice(0, step.nodes), level.birds[i], step.grid, plan)).sort(better);
    if (children.length === 0) break;
    best = children[0];
    if (plan.stopAfter(i + 1, best) || best.result.pigsLeft === 0) break;
    beam = distinct(children, plan.beam);
  }
  return best;
}

/** Общая часть обоих способов оценки: план перебора, бюджет времени, счётчик прогонов и итог. */
function prepare(level: LevelDef, opts: SolveOptions) {
  const started = wallMs();
  const seed = opts.seed ?? 1;
  const wait = opts.wait ?? 'calm';
  const preset = GRIDS[opts.grid ?? 'full'];
  const main: Grid = { angles: opts.angles ?? preset.angles, powers: opts.powers ?? preset.powers };
  const maxMs = opts.maxMs ?? 60_000;
  const beamWidth = Math.max(1, opts.beam ?? 2);
  const refine = Math.max(0, opts.refine ?? 3);
  const taps = (bird: BirdType) => opts.taps?.[bird] ?? TAPS[bird];
  let evaluations = 0;
  let timedOut = false;
  let reduced = false;
  let stepReduced = false;
  const elapsed = () => wallMs() - started;
  const outOfTime = () => (timedOut ||= elapsed() > maxMs);

  // урезание по времени: от полного плана к быстрой сетке и к лучу 1 — только если становится дешевле
  const steps: Step[] = [{ grid: main, nodes: beamWidth }];
  for (const s of [{ grid: GRIDS.fast, nodes: beamWidth }, { grid: GRIDS.fast, nodes: 1 }]) {
    const prev = steps[steps.length - 1];
    if (expandCost(s.grid, 1, refine) * s.nodes < expandCost(prev.grid, 1, refine) * prev.nodes) steps.push(s);
  }
  /** Время одной серии на один ход по замеру прошлой птицы (мс); 0 — замера ещё нет. */
  let msPerTurn = 0;
  let mark = { ms: 0, evaluations: 0 };

  const plan: Plan = {
    taps,
    beam: beamWidth,
    refine,
    choose: (bird, beam) => {
      const cost = (s: Step) => Math.min(s.nodes, beam.length) * expandCost(s.grid, taps(level.birds[bird]).length, refine) * msPerTurn * (bird + 1);
      const left = maxMs - elapsed();
      const step = opts.adaptive === false || msPerTurn === 0 ? steps[0] : (steps.find((s) => cost(s) <= left) ?? steps[steps.length - 1]);
      stepReduced = step !== steps[0];
      reduced ||= stepReduced;
      return step;
    },
    stopAfter: (bird, best) => {
      const ms = elapsed();
      if (evaluations > mark.evaluations) msPerTurn = (ms - mark.ms) / (evaluations - mark.evaluations) / bird; // на этой птице серии длиной bird ходов
      mark = { ms, evaluations };
      opts.onProgress?.({ bird, evaluations, ms, pigsLeft: best.result.pigsLeft, score: best.result.score, reduced: stepReduced });
      return outOfTime();
    },
  };
  return {
    seed,
    wait,
    outOfTime,
    search: search(level, plan, simulateShots(level, [], seed, { wait })),
    count(results: BatchResults): BatchResults {
      for (const r of results) if (r) evaluations++;
      return results;
    },
    finish(best: Node): SolveResult {
      const r = best.result;
      return {
        levelId: level.id,
        solved: r.pigsLeft === 0,
        shots: best.shots,
        score: r.score,
        stars: r.stars,
        birdsUsed: r.shots.length,
        pigsLeft: r.pigsLeft,
        log: r.shots,
        ms: elapsed(),
        evaluations,
        timedOut,
        reduced,
        seed,
        wait,
      };
    },
  };
}

/** Бот-эксперт в текущем процессе: лучшая найденная серия выстрелов и её итог. */
export function solveLevel(level: LevelDef, opts: SolveOptions = {}): SolveResult {
  const p = prepare(level, opts);
  const evaluate = (shots: readonly Shot[]) => (p.outOfTime() ? undefined : simulateShots(level, shots, p.seed, { wait: p.wait }));
  let step = p.search.next();
  while (!step.done) step = p.search.next(p.count(step.value.map(evaluate)));
  return p.finish(step.value);
}

/** Тот же перебор, но пакеты считает внешний оценщик (пул процессов и т. п.). */
export async function solveLevelAsync(level: LevelDef, opts: SolveOptions, evaluate: BatchEvaluator): Promise<SolveResult> {
  const p = prepare(level, opts);
  const ctx = { level, seed: p.seed, wait: p.wait, outOfTime: p.outOfTime };
  let step = p.search.next();
  while (!step.done) step = p.search.next(p.count(await evaluate(step.value, ctx)));
  return p.finish(step.value);
}
