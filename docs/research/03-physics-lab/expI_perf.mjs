import { makeWorld, addGround, addBox, addCircle, dynBodies, DT, fmt, table } from './lib.mjs';
import { buildTower } from './expA_stability.mjs';
import { MAT } from './expC_impulses.mjs';
const rows = [];
for (const towers of [2, 5, 10, 17]) {
  for (const [vi, pi] of [[8, 3], [10, 8], [20, 10]]) {
    const w = makeWorld({ g: -15 });
    addGround(w);
    for (let t = 0; t < towers; t++) buildTower(w, { floors: 4, cx: 20 + t * 6, colMat: MAT.wood, beamMat: MAT.wood });
    const n = dynBodies(w).length;
    // knock them all: give every body a random velocity so islands are awake and colliding
    let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const b of dynBodies(w)) b.setLinearVelocity({ x: (rnd() - 0.5) * 10, y: rnd() * 5 });
    for (let i = 0; i < 10; i++) w.step(DT, vi, pi); // warm-up JIT
    const t0 = process.hrtime.bigint();
    const N = 120;
    for (let i = 0; i < N; i++) w.step(DT, vi, pi);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
    rows.push({ bodies: n, iters: `${vi}/${pi}`, 'ms/step (awake, colliding)': fmt(ms, 3), contacts: w.getContactCount() });
  }
}
console.log('### I1: planck step cost, Node ' + process.version);
console.log(table(rows));
