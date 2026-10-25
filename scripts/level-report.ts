// Headless-отчёт по уровням (06 §7–§8): устойчивость без выстрелов и, с --solve, бот-эксперт и пороги звёзд.
//
// Запуск из корня репозитория:
//   npx tsx scripts/level-report.ts                — устойчивость всех уровней
//   npx tsx scripts/level-report.ts 1-1 2-         — выбранные уровни (id или префикс эпизода «2-»)
//   npx tsx scripts/level-report.ts 1-3 --solve    — плюс решатель, счёт и предложенные звёзды
//   npm run levels:report -- 1- --solve --json   — то же через npm, машинный вывод
// Ключи:
//   --solve        бот-эксперт (06 §7.2) и пороги звёзд (06 §8)
//   --json         результаты в JSON (stdout; прогресс решателя не печатается)
//   --awake        устойчивость без сна planck все --seconds секунд (строже игры: видно медленное сползание)
//   --full         полная сетка решателя 06 §7.2: шаг угла 2°, 4 силы (≈ ×2 по времени; по умолчанию — быстрая:
//                  шаг 4°, 3 силы, остальное добирают круги уточнения)
//   --beam=N       ширина луча решателя (2)
//   --refine=N     сколько лучших кандидатов уточнять соседями (3)
//   --refine-levels=N  кругов уточнения: шаг сетки / 2, / 4, … (2)
//   --max-ms=N     лимит решателя на уровень, мс (60000)
//   --seed=N       seed сессии (1)
//   --seconds=N    длительность проверки устойчивости, с (10)
//   --jobs=N       процессов-оценщиков решателя (по умолчанию — число ядер; 1 — в этом процессе)
// В конце текстового отчёта — сводная таблица (Markdown) и, при --solve, предложенные пороги звёзд
// готовым фрагментом для вставки в файлы уровней (src/levels/episodeN.ts, поле stars).
// Код возврата: 0 — все уровни устойчивы (и решены при --solve); 1 — есть проблемы; 2 — уровни не найдены.
// Итог решателя не зависит от --jobs: кандидаты считаются независимо и сравниваются в одном порядке
// (кроме остановки по --max-ms — сколько успеет, зависит от скорости машины).

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { LevelDef } from '../src/core/index';
import {
  checkStability,
  simulateShots,
  solveLevel,
  solveLevelAsync,
  suggestStars,
  type BatchEvaluator,
  type BodyMotion,
  type Shot,
  type SimResult,
  type SolveOptions,
  type SolveResult,
  type StabilityReport,
  type StarSuggestion,
  type WaitPolicy,
} from '../src/core/sim/index';

interface LevelReport {
  id: string;
  name: string;
  /** Пороги, заданные в файле уровня. */
  stars0: LevelDef['stars'];
  stability: StabilityReport;
  solve?: SolveResult;
  stars?: StarSuggestion;
}

const SCRIPT = fileURLToPath(import.meta.url);
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

const opts = {
  solve: flags.has('solve'),
  json: flags.has('json'),
  seconds: num('seconds', 10),
  awake: flags.has('awake'),
  jobs: Math.max(1, Math.round(num('jobs', availableParallelism()))),
  solver: {
    seed: num('seed', 1),
    grid: flags.has('full') ? 'full' : 'fast',
    beam: num('beam', 2),
    refine: num('refine', 3),
    refineLevels: num('refine-levels', 2),
    maxMs: num('max-ms', 60_000),
  } satisfies SolveOptions,
};

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function loadLevels(): Promise<LevelDef[]> {
  const url = new URL('../src/levels/index.ts', import.meta.url);
  if (!existsSync(url)) fail(`нет файла уровней ${fileURLToPath(url)}: уровни ещё не созданы (src/levels/index.ts должен экспортировать ALL_LEVELS)`);
  let mod: { ALL_LEVELS?: unknown };
  try {
    mod = await import(url.href);
  } catch (e) {
    fail(`не удалось загрузить src/levels/index.ts: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(mod.ALL_LEVELS)) fail('src/levels/index.ts не экспортирует массив ALL_LEVELS');
  return mod.ALL_LEVELS as LevelDef[];
}

// ── Пул процессов-оценщиков ─────────────────────────────────────

type EvalRequest = { level: LevelDef } | { shots: Shot[]; seed: number; wait: WaitPolicy };

/** Режим оценщика (--serve): строки JSON на stdin — уровень или серия выстрелов; ответ — SimResult строкой. */
async function serve(): Promise<void> {
  let level: LevelDef | null = null;
  for await (const line of createInterface({ input: process.stdin })) {
    const msg = JSON.parse(line) as EvalRequest;
    if ('level' in msg) level = msg.level;
    else if (!level) throw new Error('оценщик: серия выстрелов пришла раньше уровня');
    else process.stdout.write(JSON.stringify(simulateShots(level, msg.shots, msg.seed, { wait: msg.wait })) + '\n');
  }
}

/** Оценщик в дочернем процессе — этот же скрипт с --serve (загрузчик tsx передаётся через execArgv). */
class Evaluator {
  private readonly child: ChildProcessByStdio<Writable, Readable, null>;
  private readonly pending: Array<(r: SimResult) => void> = [];
  private levelId: string | null = null;

  constructor() {
    this.child = spawn(process.execPath, [...process.execArgv, SCRIPT, '--serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.pending.shift()?.(JSON.parse(line) as SimResult));
    this.child.on('exit', (code) => {
      if (this.pending.length) fail(`оценщик решателя завершился с кодом ${code}`);
    });
  }

  run(level: LevelDef, shots: readonly Shot[], seed: number, wait: WaitPolicy): Promise<SimResult> {
    if (this.levelId !== level.id) {
      this.send({ level });
      this.levelId = level.id;
    }
    return new Promise((resolve) => {
      this.pending.push(resolve);
      this.send({ shots: [...shots], seed, wait });
    });
  }

  close(): void {
    this.child.stdin.end();
  }

  private send(msg: EvalRequest): void {
    this.child.stdin.write(JSON.stringify(msg) + '\n');
  }
}

/** Пакет кандидатов раздаётся свободным оценщикам; по истечении времени новые не выдаются. */
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

// ── Отчёт ───────────────────────────────────────────────────────

async function reportLevel(level: LevelDef, evaluate: BatchEvaluator | null): Promise<LevelReport> {
  const stability = checkStability(level, opts.seconds, { seed: opts.solver.seed, keepAwake: opts.awake });
  const head = { id: level.id, name: level.name, stars0: level.stars, stability };
  if (!opts.solve) return head;
  const solverOpts: SolveOptions = {
    ...opts.solver,
    onProgress: opts.json
      ? undefined
      : (p) =>
          console.error(
            `  … ${level.id}: птица ${p.bird}${p.reduced ? ' (урезанно)' : ''}, прогонов ${p.evaluations}, свиней осталось ${p.pigsLeft}, ${sec(p.ms)}`,
          ),
  };
  const solve = evaluate ? await solveLevelAsync(level, solverOpts, evaluate) : solveLevel(level, solverOpts);
  return { ...head, solve, stars: suggestStars(level, solve) };
}

/** Норма смещения после усадки (06 §7.1, T0) — справочно, в критерий устойчивости не входит. */
const T0_SHIFT = 0.05;
const pts = (x: number) => Math.round(x).toLocaleString('ru-RU');
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} с`;
const shift = (m: BodyMotion | null) => (m ? `${m.shift.toFixed(3)} м (${m.name})` : '—');
const turn = (m: BodyMotion | null) => (m ? `${m.rotateDeg.toFixed(1)}° (${m.name})` : '—');
const time = (t: number | null) => (t === null ? 'нет' : `${t.toFixed(2)} с`);

function formatStability(r: StabilityReport): string[] {
  const lines = [
    `  устойчивость: ${r.pass ? 'OK' : 'ПРОВАЛ'} (${r.seconds} с симуляции${r.keepAwake ? ' без сна' : ''} за ${Math.round(r.ms)} мс)`,
    `    блоки: смещение ${shift(r.maxBlockShift)}, поворот ${turn(r.maxBlockRotation)}; свиньи: смещение ${shift(r.maxPigShift)}`,
    `    после усадки ${shift(r.presettleShift)}${(r.presettleShift?.shift ?? 0) > T0_SHIFT ? ` — больше нормы T0 ${T0_SHIFT} м` : ''}; ` +
      `покой ${time(r.settleTime)}, сон ${time(r.sleepTime)}`,
  ];
  for (const f of r.failures.slice(0, 10)) lines.push(`    ✗ ${f}`);
  if (r.failures.length > 10) lines.push(`    … ещё ${r.failures.length - 10}`);
  return lines;
}

function formatSolve(level: LevelDef, s: SolveResult, stars: StarSuggestion): string[] {
  const nMin = level.meta?.nMin;
  const shots = s.shots.map((x) => `${x.angleDeg}° × ${x.power}${x.abilityAt != null ? ` тап ${x.abilityAt} с` : ''}`).join('; '); // без округления: строка повторяема
  const lines = [
    `  решатель: ${s.solved ? 'решён' : 'НЕ решён'} — птиц ${s.birdsUsed} из ${level.birds.length}${nMin !== undefined ? ` (nMin ${nMin})` : ''}, ` +
      `свиней осталось ${s.pigsLeft}, счёт ${pts(s.score)}, звёзд ${s.stars}; ${sec(s.ms)}, прогонов ${s.evaluations}` +
      (s.reduced ? ', перебор урезан ради лимита времени' : '') +
      (s.timedOut ? ', остановлен по лимиту времени' : ''),
    `    выстрелы: ${shots || '—'}`,
    `  звёзды 2★/3★: заданы ${pts(level.stars.two)} / ${pts(level.stars.three)}, предложено ${pts(stars.stars.two)} / ${pts(stars.stars.three)}` +
      (stars.capped ? ' (3★ ограничена счётом эксперта)' : ''),
  ];
  for (const w of stars.warnings) lines.push(`    ! ${w}`);
  return lines;
}

function formatLevel(level: LevelDef, r: LevelReport): string {
  const bodies = level.blocks.length + (level.tnt?.length ?? 0);
  const lines = [`${r.id} «${r.name}»: птиц ${level.birds.length}, свиней ${level.pigs.length}, блоков и TNT ${bodies}`, ...formatStability(r.stability)];
  if (r.solve && r.stars) lines.push(...formatSolve(level, r.solve, r.stars));
  return lines.join('\n');
}

/** Сводная таблица в Markdown: по строке на уровень. */
function summaryTable(levels: readonly LevelDef[], results: readonly LevelReport[]): string[] {
  const head = ['уровень', 'птиц', 'свиней', 'тел', 'устойчив', 'сдвиг блоков, м', 'поворот, °', 'сдвиг свиней, м', 'сон, с'];
  if (opts.solve) head.push('решён', 'птиц / nMin', 'счёт', '2★/3★ заданы', '2★/3★ предложено', 'решатель, с');
  const rows = results.map((r, i) => {
    const level = levels[i];
    const st = r.stability;
    const row = [
      r.id,
      String(level.birds.length),
      String(level.pigs.length),
      String(level.blocks.length + (level.tnt?.length ?? 0)),
      st.pass ? 'да' : `**нет** (${st.failures.length})`,
      (st.maxBlockShift?.shift ?? 0).toFixed(3),
      (st.maxBlockRotation?.rotateDeg ?? 0).toFixed(1),
      (st.maxPigShift?.shift ?? 0).toFixed(3),
      st.sleepTime === null ? '—' : st.sleepTime.toFixed(2),
    ];
    if (opts.solve && r.solve && r.stars) {
      const s = r.solve;
      row.push(
        s.solved ? 'да' : `**нет** (свиней ${s.pigsLeft})`,
        `${s.birdsUsed} / ${level.meta?.nMin ?? '—'}`,
        pts(s.score),
        `${pts(level.stars.two)} / ${pts(level.stars.three)}`,
        `${pts(r.stars.stars.two)} / ${pts(r.stars.stars.three)}`,
        (s.ms / 1000).toFixed(1) + (s.timedOut ? ' (лимит)' : s.reduced ? ' (урезан)' : ''),
      );
    }
    return row;
  });
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)];
}

const k = (x: number) => (x >= 1000 ? `${Math.floor(x / 1000)}_${String(x % 1000).padStart(3, '0')}` : String(x));

/** Предложенные пороги звёзд решённых уровней — готовые строки для поля stars в src/levels/episodeN.ts. */
function starsFragment(results: readonly LevelReport[]): string[] {
  const solved = results.filter((r) => r.solve?.solved && r.stars);
  if (!solved.length) return [];
  return [
    '// предложенные пороги звёзд (06 §8; эксперт — scripts/level-report.ts --solve):',
    ...solved.map((r) => {
      const { two, three } = r.stars!.stars;
      const same = two === r.stars0.two && three === r.stars0.three;
      return `'${r.id}': { stars: { one: 0, two: ${k(two)}, three: ${k(three)} } },${same ? ' // как задано' : ''}`;
    }),
  ];
}

async function main(): Promise<void> {
  const all = await loadLevels();
  const levels = ids.length ? all.filter((l) => ids.some((id) => l.id === id || (id.endsWith('-') && l.id.startsWith(id)))) : all;
  if (!levels.length) fail(`уровни не найдены: ${ids.join(', ')} (есть: ${all.map((l) => l.id).join(', ') || 'нет ни одного'})`);

  const started = performance.now();
  const pool = opts.solve && opts.jobs > 1 ? Array.from({ length: opts.jobs }, () => new Evaluator()) : [];
  const evaluate = pool.length ? poolEvaluator(pool) : null;
  const results: LevelReport[] = [];
  for (const level of levels) {
    const r = await reportLevel(level, evaluate);
    results.push(r);
    if (!opts.json) console.log(formatLevel(level, r) + '\n');
  }
  for (const ev of pool) ev.close();

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(summaryTable(levels, results).join('\n') + '\n');
    const fragment = starsFragment(results);
    if (fragment.length) console.log(fragment.join('\n') + '\n');
    const stable = results.filter((r) => r.stability.pass).length;
    const solved = results.filter((r) => r.solve?.solved).length;
    console.log(
      `уровней: ${results.length}; устойчивы: ${stable}` + (opts.solve ? `; решены: ${solved}` : '') + `; время ${sec(performance.now() - started)}`,
    );
  }
  const failed = results.some((r) => !r.stability.pass || (opts.solve && !r.solve?.solved));
  process.exitCode = failed ? 1 : 0;
}

if (flags.has('serve')) await serve();
else await main();
