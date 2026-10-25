// Калибровка уровней по устойчивой линии эксперта (ревью «арт и ощущения»): несколько настроек решателя
// (с переоценкой кандидатов под шумом исполнения и без), у каждой линии — 30 прогонов с «мелким» шумом и «рукой»
// (src/core/sim/robust.ts); берётся линия с лучшей долей побед (с шагом 10 %), затем с меньшим числом птиц, затем
// с лучшей «рукой». Звёзды — suggestStars по этой линии (2★ — медиана, 3★ — 80-й перцентиль), nMin — её птицы.
// Результат записывается в src/levels/calib.ts (блок между // <calib> и // </calib>), эпизоды применяют его сами.
//
// Запуск из корня репозитория:
//   npx tsx scripts/level-calibrate.ts 1-7 2-     — уровни 1-7 и весь эпизод 2
// Ключи:
//   --variants=r12,r16,q25,hand,exact   настройки решателя (по умолчанию все)
//   --runs=N       прогонов проверки устойчивости (30)
//   --max-ms=N     лимит решателя на настройку, мс (180000)
//   --jobs=N       процессов-оценщиков (по умолчанию — число ядер)
//   --dry          не записывать calib.ts, только отчёт

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { LevelDef } from '../src/core/index';
import {
  NOISE,
  robustBatch,
  robustReport,
  simulateShots,
  solveLevelAsync,
  suggestStars,
  type BatchEvaluator,
  type RobustReport,
  type Shot,
  type SimResult,
  type SolveOptions,
  type SolveResult,
  type WaitPolicy,
} from '../src/core/sim/index';

const SCRIPT = fileURLToPath(import.meta.url);
const CALIB_FILE = fileURLToPath(new URL('../src/levels/calib.ts', import.meta.url));
const args = process.argv.slice(2);
const flags = new Map(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? ''] as const;
  }),
);
const ids = args.filter((a) => !a.startsWith('--'));
const num = (key: string, fallback: number) => {
  const v = Number(flags.get(key));
  return flags.has(key) && Number.isFinite(v) ? v : fallback;
};

/** Настройки решателя: устойчивый перебор с «мелким» шумом (среднее, шире, 25-й перцентиль), с «рукой» и точный. */
const VARIANTS: Record<string, SolveOptions> = {
  r12: { robust: { runs: 12, top: 8 } },
  r16: { robust: { runs: 16, top: 12 } },
  q25: { robust: { runs: 12, top: 10, stat: 0.25 } },
  hand: { robust: { runs: 12, top: 8, noise: NOISE.hand } },
  exact: {},
};
const variants = (flags.get('variants') || Object.keys(VARIANTS).join(',')).split(',').filter((v) => v in VARIANTS);
const RUNS = Math.max(1, Math.round(num('runs', 30)));
const MAX_MS = num('max-ms', 180_000);
const JOBS = Math.max(1, Math.round(num('jobs', availableParallelism())));
/** Свинья ближе этого к рогатке по x в конце хода — изъян уровня. */
const PIG_NEAR_SLING = 5;

// ── Пул процессов-оценщиков (как в level-report.ts) ─────────────

type EvalRequest = { level: LevelDef } | { shots: Shot[]; seed: number; wait: WaitPolicy };

async function serve(): Promise<void> {
  let level: LevelDef | null = null;
  for await (const line of createInterface({ input: process.stdin })) {
    const msg = JSON.parse(line) as EvalRequest;
    if ('level' in msg) level = msg.level;
    else if (level) process.stdout.write(JSON.stringify(simulateShots(level, msg.shots, msg.seed, { wait: msg.wait })) + '\n');
  }
}

class Evaluator {
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private readonly pending: Array<(r: SimResult) => void> = [];
  private levelId: string | null = null;

  constructor() {
    this.child = spawn(process.execPath, [...process.execArgv, SCRIPT, '--serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.pending.shift()?.(JSON.parse(line) as SimResult));
  }

  run(level: LevelDef, shots: readonly Shot[], seed: number, wait: WaitPolicy): Promise<SimResult> {
    if (this.levelId !== level.id) {
      this.child.stdin.write(JSON.stringify({ level }) + '\n');
      this.levelId = level.id;
    }
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.child.stdin.write(JSON.stringify({ shots: [...shots], seed, wait }) + '\n');
    });
  }

  close(): void {
    this.child.stdin.end();
  }
}

function poolEvaluator(pool: readonly Evaluator[]): BatchEvaluator {
  return async (batch, { level, seed, wait, outOfTime }) => {
    const results: Array<SimResult | undefined> = new Array(batch.length).fill(undefined);
    let next = 0;
    await Promise.all(
      pool.map(async (ev) => {
        while (next < batch.length && !outOfTime()) {
          const i = next++;
          results[i] = await ev.run(level, batch[i], seed, wait);
        }
      }),
    );
    return results;
  };
}

// ── Калибровка ──────────────────────────────────────────────────

interface Candidate {
  variant: string;
  solve: SolveResult;
  fine: RobustReport;
  hand: RobustReport;
  near: number;
}

/** Ключ выбора: доля побед с шагом 10 %, меньше птиц, «рука», медиана. */
function key(c: Candidate): number[] {
  return [c.solve.solved ? 1 : 0, Math.floor(c.fine.winRate * 10 + 1e-9), -c.solve.birdsUsed, c.hand.winRate, c.fine.median];
}

function better(a: Candidate, b: Candidate): boolean {
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i];
  return false;
}

async function calibrate(level: LevelDef, evaluate: BatchEvaluator): Promise<Candidate | null> {
  let best: Candidate | null = null;
  for (const v of variants) {
    const solve = await solveLevelAsync(level, { ...VARIANTS[v], maxMs: MAX_MS }, evaluate);
    if (!solve.shots.length) continue;
    const ctx = { level, seed: solve.seed, wait: solve.wait, outOfTime: () => false };
    const fineRes = (await evaluate(robustBatch(level, solve.shots, { runs: RUNS, noise: NOISE.fine }), ctx)) as SimResult[];
    const handRes = (await evaluate(robustBatch(level, solve.shots, { runs: RUNS, noise: NOISE.hand }), ctx)) as SimResult[];
    const nearX = level.slingshot.x + PIG_NEAR_SLING;
    const near = [solve.log, ...fineRes.map((r) => r.shots)].flat().filter((l) => l.pigMinX !== null && l.pigMinX < nearX).length;
    const c: Candidate = { variant: v, solve, fine: robustReport(fineRes), hand: robustReport(handRes), near };
    const pct = (x: number) => `${Math.round(x * 100)} %`;
    console.error(
      `  ${level.id} [${v}]: ${solve.solved ? 'решён' : 'НЕ решён'} ${solve.birdsUsed} птиц, счёт ${solve.score}; ` +
        `побед ${pct(c.fine.winRate)} / рука ${pct(c.hand.winRate)}; ${(solve.ms / 1000).toFixed(1)} с` +
        (near ? `; свинья у рогатки ×${near}` : '') +
        `; ${JSON.stringify(solve.shots.map((x) => [x.angleDeg, x.power, ...(x.abilityAt != null ? [x.abilityAt] : [])]))}`,
    );
    if (!best || better(c, best)) best = c;
  }
  return best;
}

const k1000 = (x: number) => (x >= 1000 ? `${Math.floor(x / 1000)}_${String(x % 1000).padStart(3, '0')}` : String(x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function entry(level: LevelDef, c: Candidate): string {
  const st = suggestStars(level, c.solve, c.fine).stars;
  const plan = c.solve.shots
    .map((s) => `{ angleDeg: ${s.angleDeg}, power: ${s.power}${s.abilityAt != null ? `, abilityAt: ${s.abilityAt}` : ''} }`)
    .join(', ');
  const calib = [
    `expertBirds: ${c.solve.birdsUsed}`,
    `expertScore: ${c.solve.score}`,
    `robustWin: ${r3(c.fine.winRate)}`,
    `handWin: ${r3(c.hand.winRate)}`,
    `runs: ${RUNS}`,
  ].join(', ');
  return (
    `  '${level.id}': {\n` +
    `    stars: { one: 0, two: ${k1000(st.two)}, three: ${k1000(st.three)} },\n` +
    `    nMin: ${c.solve.birdsUsed},\n` +
    `    calib: { ${calib} },\n` +
    `    plan: [${plan}],\n` +
    `  },`
  );
}

/** Записи блока <calib> из файла: id → текст записи. */
function readEntries(src: string): Map<string, string> {
  const block = /\/\/ <calib>[^\n]*\n([\s\S]*?)\/\/ <\/calib>/.exec(src)?.[1] ?? '';
  const out = new Map<string, string>();
  const re = /^ {2}'(\d+-\d+)': \{\n[\s\S]*?^ {2}\},$/gm;
  for (let m = re.exec(block); m; m = re.exec(block)) out.set(m[1], m[0]);
  return out;
}

function writeEntries(src: string, entries: Map<string, string>, order: readonly string[]): string {
  const ids = [...entries.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const body = ids.length ? `{\n${ids.map((id) => entries.get(id)).join('\n')}\n}` : '{}';
  return src.replace(
    /(\/\/ <calib>[^\n]*\n)[\s\S]*?(\/\/ <\/calib>)/,
    (_m, head: string, tail: string) => `${head}export const CALIB: Readonly<Record<string, LevelCalib>> = ${body};\n${tail}`,
  );
}

async function main(): Promise<void> {
  const { ALL_LEVELS } = (await import('../src/levels/index')) as { ALL_LEVELS: LevelDef[] };
  const levels = ids.length ? ALL_LEVELS.filter((l) => ids.some((id) => l.id === id || (id.endsWith('-') && l.id.startsWith(id)))) : ALL_LEVELS;
  if (!levels.length) {
    console.error(`уровни не найдены: ${ids.join(', ')}`);
    process.exit(2);
  }
  const pool = Array.from({ length: JOBS }, () => new Evaluator());
  const evaluate = poolEvaluator(pool);
  let src = readFileSync(CALIB_FILE, 'utf8');
  const entries = readEntries(src);
  const order = ALL_LEVELS.map((l) => l.id);
  for (const level of levels) {
    const best = await calibrate(level, evaluate);
    if (!best) {
      console.log(`${level.id}: решатель не нашёл линии — калибровка не изменена`);
      continue;
    }
    const st = suggestStars(level, best.solve, best.fine);
    console.log(
      `${level.id}: [${best.variant}] птиц ${best.solve.birdsUsed}${best.solve.solved ? '' : ' (НЕ решён)'}, побед ${Math.round(best.fine.winRate * 100)} % / ` +
        `рука ${Math.round(best.hand.winRate * 100)} %, звёзды ${st.stars.two} / ${st.stars.three}` +
        (best.near ? `, свинья у рогатки ×${best.near}` : '') +
        (st.warnings.length ? `\n    ! ${st.warnings.join('\n    ! ')}` : ''),
    );
    if (best.solve.solved) entries.set(level.id, entry(level, best));
    if (!flags.has('dry')) {
      src = writeEntries(src, entries, order);
      writeFileSync(CALIB_FILE, src);
    }
  }
  for (const ev of pool) ev.close();
}

if (flags.has('serve')) await serve();
else await main();
