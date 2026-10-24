import { makeWorld, addGround, addCircle, DT, fmt, table } from './lib.mjs';
const Y0 = 2.5, R = 0.45;
// simulate one shot, return range (x where bird first touches ground), time, apex
function shoot(g, v, deg, damping = 0) {
  const w = makeWorld({ g });
  addGround(w, { friction: 0.8 });
  const b = addCircle(w, { x: 0, y: Y0, r: R, density: 4, friction: 0.8, restitution: 0.3, bullet: true, linearDamping: damping });
  const a = deg * Math.PI / 180;
  b.setLinearVelocity({ x: v * Math.cos(a), y: v * Math.sin(a) });
  let apex = Y0, hit = false;
  w.on('begin-contact', () => { hit = true; });
  for (let i = 1; i < 60 * 20; i++) {
    w.step(DT);
    const p = b.getPosition();
    apex = Math.max(apex, p.y);
    if (hit) return { range: p.x, t: i * DT, apex };
  }
  return { range: NaN, t: NaN, apex };
}
const rows = [];
for (const g of [-9.8, -15, -20]) {
  for (const v of [15, 18, 20, 22, 24, 26, 28, 30, 35]) {
    let best = { range: -1 };
    let bestDeg = 0;
    for (let deg = 20; deg <= 60; deg += 1) { const r = shoot(g, v, deg); if (r.range > best.range) { best = r; bestDeg = deg; } }
    const r45 = shoot(g, v, 45), r30 = shoot(g, v, 30), r15 = shoot(g, v, 15), r60 = shoot(g, v, 60);
    rows.push({ g, v0: v, bestDeg, bestRange_m: fmt(best.range, 1), tBest_s: fmt(best.t, 2), apexBest_m: fmt(best.apex, 1), range30: fmt(r30.range, 1), t30: fmt(r30.t, 2), range15: fmt(r15.range, 1), t15: fmt(r15.t, 2), apex60_m: fmt(r60.apex, 1), t60: fmt(r60.t, 2) });
  }
}
console.log('### B1: flight from y0=2.5 m, r=0.45, ground y=0 (planck sim, bullet)');
console.log(table(rows));
// analytical check: R = v cos a (v sin a + sqrt(v^2 sin^2 a + 2 g h))/g
const rows2 = [];
for (const [g, v] of [[-15, 22], [-15, 23], [-15, 24], [-15, 25], [-16, 24], [-16, 25], [-18, 26], [-20, 27], [-20, 28], [-9.8, 19], [-9.8, 20]]) {
  let best = { range: -1 }, bd = 0;
  for (let deg = 25; deg <= 55; deg += 1) { const r = shoot(g, v, deg); if (r.range > best.range) { best = r; bd = deg; } }
  const r20 = shoot(g, v, 20);
  rows2.push({ g, v0: v, bestDeg: bd, maxRange_m: fmt(best.range, 1), t_s: fmt(best.t, 2), apex_m: fmt(best.apex, 1), 'flat20deg_range': fmt(r20.range, 1), 'flat20deg_t': fmt(r20.t, 2), 'v^2/|g|': fmt(v * v / -g, 1) });
}
console.log('\n### B2: candidate pairs');
console.log(table(rows2));
// damping influence
const rows3 = [];
for (const d of [0, 0.02, 0.05, 0.1]) {
  const r = shoot(-15, 24, 42, d);
  rows3.push({ linearDamping: d, range_m: fmt(r.range, 1), t_s: fmt(r.t, 2), apex: fmt(r.apex, 1) });
}
console.log('\n### B3: linearDamping effect (g=-15, v=24, 42deg)');
console.log(table(rows3));
