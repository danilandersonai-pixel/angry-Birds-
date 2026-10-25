import { makeWorld, addGround, addCircle, DT, fmt, table } from './lib.mjs';
const Y0 = 2.7, R = 0.45;
function shoot(g, v, deg) {
  const w = makeWorld({ g }); addGround(w);
  const b = addCircle(w, { x: 0, y: Y0, r: R, density: 2.5, bullet: true });
  const a = deg * Math.PI / 180; b.setLinearVelocity({ x: v * Math.cos(a), y: v * Math.sin(a) });
  let hit = false, apex = Y0; w.on('begin-contact', () => { hit = true; });
  for (let i = 1; i < 1200; i++) { w.step(DT); apex = Math.max(apex, b.getPosition().y); if (hit) return { x: b.getPosition().x, t: i * DT, apex }; }
}
const rows = [];
for (const [g, v] of [[-15, 24], [-12.5, 22], [-12.5, 29], [-16, 25], [-20, 28], [-9.8, 19.5]]) {
  let best = { x: 0 }, bd = 0; for (let d = 30; d <= 55; d++) { const r = shoot(g, v, d); if (r.x > best.x) { best = r; bd = d; } }
  const r10 = shoot(g, v, 10), r20 = shoot(g, v, 20), r30 = shoot(g, v, 30), r60 = shoot(g, v, 60);
  const pull = [0.25, 0.5, 0.75].map(k => fmt(shoot(g, v * k, 45).x, 1)).join(' / ');
  rows.push({ 'g, m/s²': -g, 'Vmax, m/s': v, 'max range m (angle)': `${fmt(best.x, 1)} (${bd}°)`, 't max, s': fmt(best.t, 2), 'apex m': fmt(best.apex, 1), '10°: m / s': `${fmt(r10.x, 1)} / ${fmt(r10.t, 2)}`, '20°: m / s': `${fmt(r20.x, 1)} / ${fmt(r20.t, 2)}`, '30°: m / s': `${fmt(r30.x, 1)} / ${fmt(r30.t, 2)}`, '60° apex m': fmt(r60.apex, 1), 'pull 25/50/75% @45° m': pull });
}
console.log('### B5: final candidates, launch from y0=2.7 m (ANCHOR from 01), landing = first ground contact');
console.log(table(rows));
