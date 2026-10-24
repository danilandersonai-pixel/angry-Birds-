// Experiment 4: star calibration by bots. greedy (fine grid) = "expert"; noisyGreedy x K = "typical player".
// node docs/research/06-levels-lab/exp4_stars.mjs [levelId] [K]
import { stabilityTest, greedySolve, noisyGreedy } from './engine.mjs';
import { SAMPLE } from './levels-sample.mjs';
const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null; const K = +(process.argv[3] || 10);
const r1k = (x) => Math.round(x / 1000) * 1000;
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
console.log('| level | birds N | expert: birds / score | typical xK: win% / median birds / q40 / q80 | P (all pigs) | stars two / three | typical 2★% / 3★% | time, s |');
console.log('|---|---|---|---|---|---|---|---|');
for (const mk of SAMPLE) {
  const L = mk(); if (only && L.id !== only) continue;
  const t0 = Date.now();
  const st = stabilityTest(L);
  if (st.preDisp > 0.05 || st.maxBlockDisp > 0.05) { console.log(`| ${L.id} | unstable: preDisp ${st.preDisp.toFixed(2)} blockDisp ${st.maxBlockDisp.toFixed(2)} |`); continue; }
  const ex = greedySolve(L);
  const runs = []; for (let k = 0; k < K; k++) runs.push(noisyGreedy(L, { seed: 1000 + k }));
  const wins = runs.filter((r) => r.won).map((r) => r.score);
  const P = L.pigs.length * 5000;
  const best = Math.max(ex.solved ? ex.score : 0, ...wins);
  // 06-levels.md §8.3
  const hi = Math.floor(best / 1000) * 1000;
  let two = Math.max(r1k(q(wins, 0.40)), r1k(P + 2000));
  let three = Math.max(r1k(q(wins, 0.80)), two + 5000);
  if (three > hi) { three = hi; two = Math.min(two, three - 5000); }
  const narrow = two < r1k(P + 2000);
  const p2 = runs.filter((r) => r.won && r.score >= two).length / K, p3 = runs.filter((r) => r.won && r.score >= three).length / K;
  const medB = q(runs.filter((r) => r.won).map((r) => r.birdsUsed), 0.5);
  console.log(`| ${L.id} | ${L.birds.length} | ${ex.solved ? ex.birdsUsed : '✗'} / ${ex.score} | ${(100 * wins.length / K).toFixed(0)}% / ${medB} / ${r1k(q(wins, 0.4))} / ${r1k(q(wins, 0.8))} | ${P} | ${two} / ${three} | ${(100 * p2).toFixed(0)}% / ${(100 * p3).toFixed(0)}% | ${((Date.now() - t0) / 1000).toFixed(0)}${narrow ? ' (narrow)' : ''} |`);
}
