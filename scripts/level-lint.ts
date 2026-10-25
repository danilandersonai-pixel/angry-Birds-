// Статическая проверка уровней кампании (стадия L, 06 §7.1) из командной строки.
//
// Запуск из корня репозитория:
//   npx tsx scripts/level-lint.ts                 — все уровни
//   npx tsx scripts/level-lint.ts 1-1 1-3         — выбранные
//   npx tsx scripts/level-lint.ts 1-              — все уровни эпизода 1 (префикс id)
// Ключи:
//   --errors   только ошибки (без предупреждений)
//   --strict   код возврата 1 и при предупреждениях
//   --json     результаты в JSON (для инструментов)
//   --dump     вывести LevelDef выбранных уровней в JSON (вход для чернового прогона физики через node)
// Код возврата: 0 — ошибок нет, 1 — есть ошибки (или предупреждения при --strict), 2 — уровень не найден.

import { ALL_LEVELS } from '../src/levels';
import { formatLint, lintLevels } from '../src/levels/lint';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const ids = args.filter((a) => !a.startsWith('--'));

const levels = ids.length ? ALL_LEVELS.filter((l) => ids.some((id) => l.id === id || (id.endsWith('-') && l.id.startsWith(id)))) : ALL_LEVELS;
if (ids.length && !levels.length) {
  console.error(`уровни не найдены: ${ids.join(', ')} (есть: ${ALL_LEVELS.map((l) => l.id).join(', ') || 'нет ни одного'})`);
  process.exit(2);
}

if (flags.has('--dump')) {
  console.log(JSON.stringify(levels, null, 2));
  process.exit(0);
}

const t0 = performance.now();
const results = lintLevels(levels);
const ms = performance.now() - t0;

if (flags.has('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) console.log(formatLint(r, { warnings: !flags.has('--errors') }));
  const errs = results.reduce((s, r) => s + r.errors.length, 0);
  const warns = results.reduce((s, r) => s + r.warnings.length, 0);
  console.log(`\nуровней: ${results.length}, ошибок: ${errs}, предупреждений: ${warns} (${ms.toFixed(0)} мс)`);
}

const failed = results.some((r) => r.errors.length > 0 || (flags.has('--strict') && r.warnings.length > 0));
process.exit(failed ? 1 : 0);
