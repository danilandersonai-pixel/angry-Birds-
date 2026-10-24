// Experiment 3: full validation pipeline on sample levels: T0/T1/T2 stability, greedy solvability,
// noisy replay ("precision index"), star thresholds from bot results, timing.
// node docs/research/06-levels-lab/exp3_validate.mjs [levelId]
import { stabilityTest, greedySolve, replay, defaultCandidates, range } from './engine.mjs';
import { SAMPLE } from './levels-sample.mjs';

const only = process.argv[2];
const r1k = (x) => Math.floor(x / 1000) * 1000;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

for (const mk of SAMPLE) {
  const L = mk();
  if (only && L.id !== only) continue;
  console.log(`\n## ${L.id} «${L.name}» birds=[${L.birds.join(', ')}] pigs=${L.pigs.length} blocks=${L.blocks.length}`);
  const t0 = Date.now();
  const s = stabilityTest(L, { seconds: 10 });
  const T0 = s.preDisp <= 0.05 && s.preVmax <= 1.0;
  const T1 = s.maxBlockDisp <= 0.05 && s.maxRot <= 2 && s.maxPigDisp <= 0.1 && s.pigsLost === 0 && s.blocksLost === 0 && s.hpLoss <= 0.01;
  const tilt = [2, -2].map((a) => stabilityTest(L, { seconds: 8, tiltDeg: a, tiltSeconds: 2 }));
  const T2 = tilt.every((t) => t.blocksLost === 0 && t.pigsLost === 0 && t.maxBlockDisp <= 0.25 && t.maxRot <= 10 && t.pigDrop <= 0.3);
  console.log(`T0 preDisp=${s.preDisp.toFixed(3)} preVmax=${s.preVmax.toFixed(2)} -> ${T0 ? 'OK' : 'FAIL'} | T1 blockDisp=${s.maxBlockDisp.toFixed(3)} rot=${s.maxRot.toFixed(2)} pigDisp=${s.maxPigDisp.toFixed(3)} hpLoss=${(s.hpLoss * 100).toFixed(1)}% -> ${T1 ? 'OK' : 'FAIL'} | T2(±2°) -> ${T2 ? 'OK' : 'FAIL'} (${tilt.map((t) => `${t.maxBlockDisp.toFixed(2)}/${t.pigDrop.toFixed(2)}`).join(', ')}) [${Date.now() - t0} ms]`);

  const t1 = Date.now();
  const sol = greedySolve(L, { log: true });
  const ms = Date.now() - t1;
  console.log(`solver: solved=${sol.solved} birdsUsed=${sol.birdsUsed}/${L.birds.length} score=${sol.score} sims=${sol.sims} time=${(ms / 1000).toFixed(1)} s (${(ms / sol.sims).toFixed(1)} ms/sim)`);
  if (!sol.solved) continue;

  // pig/blocks potential
  const P = L.pigs.length * 5000;
  // star thresholds (06-levels.md §8)
  const best = sol.score;
  let three = r1k(Math.min(0.9 * best, best - 3000));
  let two = r1k(0.7 * best);
  two = Math.max(two, r1k(P + 3000));
  three = Math.max(three, two + 5000);
  if (three > best) three = r1k(best);
  console.log(`stars: one=0 two=${two} three=${three} (botBest=${best}, P=${P})`);

  // noisy replay of the bot's sequence: sigma 0.5 deg, 0.015 power; 30 trials
  const rnd = mulberry32(12345);
  let win = 0, st3 = 0, st2 = 0; const scores = [];
  const N = 30;
  for (let k = 0; k < N; k++) {
    const shots = sol.shots.map((c) => ({ ...c, angle: c.angle + 0.5 * gauss(rnd), power: Math.min(1, c.power + 0.015 * gauss(rnd)) }));
    // after the bot's sequence, if pigs remain and birds remain, keep firing the last shot (naive)
    const { g } = replay(L, shots);
    while (g.pigsAlive() > 0 && g.birdsLeft.length) { const c = sol.shots[sol.shots.length - 1]; g.shoot(c.angle + 0.5 * gauss(rnd), Math.min(1, c.power + 0.015 * gauss(rnd)), { tapAt: c.tapAt }); }
    const won = g.pigsAlive() === 0; const sc = g.finalScore();
    if (won) { win++; if (sc >= three) st3++; if (sc >= two) st2++; }
    scores.push(won ? sc : 0);
  }
  scores.sort((a, b) => a - b);
  console.log(`noisy x${N}: win=${(100 * win / N).toFixed(0)}% 2★=${(100 * st2 / N).toFixed(0)}% 3★=${(100 * st3 / N).toFixed(0)}% median=${scores[N >> 1]}`);
}
