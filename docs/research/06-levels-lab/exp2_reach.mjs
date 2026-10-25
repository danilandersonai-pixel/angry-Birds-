// Experiment 2: reach envelope of the slingshot (bird starts from the pulled pouch, as in 01 §2.3), planck-style
// semi-implicit Euler, g = -15, VMAX = 24, RMAX = 2, ANCHOR = (0, 2.7). For each bird: max height reachable at x,
// low/high angles that hit a target at (x, y), flight time.
// node docs/research/06-levels-lab/exp2_reach.mjs
const G = -15, DT = 1 / 60, VMAX = 24, RMAX = 2.0, A = { x: 0, y: 2.7 };
const LS = { red: 1.0, bomb: 0.95, matilda: 0.97, terence: 0.88 };
function traj(angleDeg, power, ls) {
  const th = (angleDeg * Math.PI) / 180, dx = Math.cos(th), dy = Math.sin(th);
  let x = A.x - dx * power * RMAX, y = A.y - dy * power * RMAX;
  let vx = dx * VMAX * power * ls, vy = dy * VMAX * power * ls;
  const pts = [[0, x, y]];
  for (let k = 1; k < 600 && y > -2; k++) { vy += G * DT; x += vx * DT; y += vy * DT; pts.push([k * DT, x, y]); }
  return pts;
}
function yAt(pts, X) { for (let i = 1; i < pts.length; i++) if (pts[i][1] >= X) { const [t0, x0, y0] = pts[i - 1], [t1, x1, y1] = pts[i]; const u = (X - x0) / (x1 - x0); return { y: y0 + u * (y1 - y0), t: t0 + u * (t1 - t0) }; } return null; }

const xs = [10, 15, 20, 25, 30, 35, 38, 40, 42, 45];
console.log('### Envelope: max height of bird centre reachable at x (power 1.0), m\n| bird (launchScale) | ' + xs.map((x) => `x=${x}`).join(' | ') + ' |\n|---|' + xs.map(() => '---').join('|') + '|');
for (const [b, ls] of Object.entries(LS)) {
  const cells = xs.map((X) => { let best = -Infinity; for (let a = 0; a <= 85; a += 0.25) { const r = yAt(traj(a, 1, ls), X); if (r && r.y > best) best = r.y; } return best > -2 ? best.toFixed(1) : '—'; });
  console.log(`| ${b} (${ls}) | ${cells.join(' | ')} |`);
}

// max ground range (centre at y = r_bird ≈ 0.45 for red)
console.log('\n### Max range to ground target (bird centre at y = 0.5), power 1.0');
for (const [b, ls] of Object.entries(LS)) {
  let best = { x: 0, a: 0, t: 0 };
  for (let a = 5; a <= 70; a += 0.25) { const p = traj(a, 1, ls); for (let i = 1; i < p.length; i++) if (p[i][2] <= 0.5 && p[i][0] > 0.2) { if (p[i][1] > best.x) best = { x: p[i][1], a, t: p[i][0] }; break; } }
  console.log(`- ${b}: ${best.x.toFixed(1)} m at ${best.a}°, ${best.t.toFixed(2)} s`);
}

// low/high solutions to hit (x, y) for red at power 1.0 and 0.85
console.log('\n### Red: angles that put the bird centre at target (x, y) — low / high solution, flight time (power 1.0 | 0.85)');
console.log('| target | p=1.0 low | p=1.0 high | p=0.85 low | p=0.85 high |\n|---|---|---|---|---|');
for (const [X, Y] of [[15, 1], [20, 1], [20, 5], [25, 1], [25, 5], [25, 9], [30, 1], [30, 5], [30, 8], [35, 1], [35, 4], [38, 1]]) {
  const cells = [];
  for (const p of [1.0, 0.85]) {
    const sols = [];
    let prev = null;
    for (let a = -10; a <= 85; a += 0.05) { const r = yAt(traj(a, p, 1), X); const d = r ? r.y - Y : null; if (prev !== null && d !== null && Math.sign(d) !== Math.sign(prev.d)) sols.push({ a: a.toFixed(1), t: r.t.toFixed(2) }); prev = d === null ? null : { d }; }
    cells.push(sols[0] ? `${sols[0].a}° / ${sols[0].t} s` : '—', sols[1] ? `${sols[1].a}° / ${sols[1].t} s` : '—');
  }
  console.log(`| (${X}, ${Y}) | ${cells.join(' | ')} |`);
}

// sensitivity: how many metres does the impact point move per 1 degree / per 0.01 power (red, target ~ (30,1))
{
  const base = traj(30, 1, 1), b2 = traj(31, 1, 1), b3 = traj(30, 0.99, 1);
  const landX = (p) => { for (let i = 1; i < p.length; i++) if (p[i][2] <= 1 && p[i][0] > 0.2) return p[i][1]; return NaN; };
  console.log(`\n### Sensitivity at 30°/full power (landing at y=1): dx/d(angle) = ${(landX(b2) - landX(base)).toFixed(2)} m per 1°, dx/d(power) = ${((landX(base) - landX(b3))).toFixed(2)} m per 0.01`);
  const h0 = traj(60, 1, 1), h1 = traj(61, 1, 1);
  console.log(`  at 60°: dx/d(angle) = ${(landX(h1) - landX(h0)).toFixed(2)} m per 1°`);
}
