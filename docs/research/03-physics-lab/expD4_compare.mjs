// D4: compare blast formulas under FINAL config
import { createGame, addBlock, addPig, stepGame, DT } from './game.mjs';
import { fmt, table } from './lib.mjs';
import { pigHp } from './final_cfg.mjs';
function gather(g, c, R) {
  const set = new Set();
  g.world.queryAABB({ lowerBound: { x: c.x - R, y: c.y - R }, upperBound: { x: c.x + R, y: c.y + R } }, (fx) => { if (fx.getBody().isDynamic()) set.add(fx.getBody()); return true; });
  return set;
}
function surfDist(b, c) {
  const com = b.getWorldCenter(); let best = 1;
  let hit = false;
  for (let f = b.getFixtureList(); f; f = f.getNext()) { const out = {}; if (f.rayCast(out, { p1: c, p2: com, maxFraction: 1 }, 0) && out.fraction < best) { best = out.fraction; hit = true; } }
  return hit ? best * Math.hypot(com.x - c.x, com.y - c.y) : 0;
}
const MM = { wood: 1.0, ice: 1.25, stone: 1.4, pig: 1.0, tnt: 1.0 };
// ours: linear falloff, J = min(J0 f, m dvMax), surface distance, spin
function blastOurs(g, c, { R, J0, dvMax, D0, lift = 0 }) {
  for (const b of gather(g, c, R)) {
    const e = b.getUserData(); const d = surfDist(b, c); if (d > R) continue;
    const f = 1 - d / R; const com = b.getWorldCenter();
    let dx = com.x - c.x, dy = com.y - c.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; dy += lift; const L2 = Math.hypot(dx, dy); dx /= L2; dy /= L2;
    const J = Math.min(J0 * f, b.getMass() * dvMax);
    b.applyLinearImpulse({ x: dx * J, y: dy * J }, com, true);
    b.applyAngularImpulse(-Math.sign(dx || 1) * J * 0.15 * Math.min(1, (e.w || e.r * 2) / 2), true);
    if (e.type !== 'bird') e.hp -= D0 * f * (MM[e.mat] ?? 1);
  }
}
// 02: quadratic falloff, J = J0 f clamp(sqrt m, .5, 2), centre-distance minus half bound radius, +0.25 lift
function blast02(g, c, { R, J0, D0 }) {
  for (const b of gather(g, c, R)) {
    const e = b.getUserData(); const com = b.getWorldCenter();
    const boundR = e.r || Math.hypot(e.w, e.h) / 2;
    const d = Math.max(0, Math.hypot(com.x - c.x, com.y - c.y) - 0.5 * boundR); if (d > R) continue;
    const f = (1 - d / R) ** 2;
    let dx = com.x - c.x, dy = com.y - c.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy = dy / L + 0.25; const L2 = Math.hypot(dx, dy); dx /= L2; dy /= L2;
    const J = J0 * f * Math.min(2, Math.max(0.5, Math.sqrt(b.getMass())));
    const off = (Math.random() - 0.5) * boundR * 0.6;
    b.applyLinearImpulse({ x: dx * J, y: dy * J }, { x: com.x - dy * off, y: com.y + dx * off }, true);
    if (e.type !== 'bird') e.hp -= D0 * f * (MM[e.mat] ?? 1);
  }
}
function level(g) {
  let y = 0;
  for (let i = 0; i < 3; i++) { addBlock(g, 'wood', 26.25, y + 1, 0.5, 2); addBlock(g, 'wood', 29.75, y + 1, 0.5, 2); addBlock(g, 'wood', 28, y + 2.25, 4, 0.5); y += 2.515; }
  addPig(g, 28, 0.6075, 0.6075, pigHp(0.6075, 6)); addPig(g, 28, 2.515 + 0.405, 0.405, pigHp(0.405, 6)); addPig(g, 28, 5.03 + 0.405, 0.405, pigHp(0.405, 6));
  y = 0;
  for (let i = 0; i < 2; i++) { addBlock(g, 'stone', 35.25, y + 1, 0.5, 2); addBlock(g, 'stone', 38.75, y + 1, 0.5, 2); addBlock(g, 'stone', 37, y + 2.25, 4, 0.5); y += 2.515; }
  addPig(g, 37, 0.8325, 0.8325, pigHp(0.8325, 7));
}
const variants = [
  ['ours R3.5 J0=30 dv20 D0=100 lin', (g, c) => blastOurs(g, c, { R: 3.5, J0: 30, dvMax: 20, D0: 100 })],
  ['ours R3.0 J0=25 dv18 D0=80 lin (TNT)', (g, c) => blastOurs(g, c, { R: 3.0, J0: 25, dvMax: 18, D0: 80 })],
  ['02: R2.6 J0=10*clamp(sqrt m) D0=60 quad', (g, c) => blast02(g, c, { R: 2.6, J0: 10, D0: 60 })],
  ['02 scaled: R3.5 J0=16*clamp(sqrt m) D0=100 quad', (g, c) => blast02(g, c, { R: 3.5, J0: 16, D0: 100 })],
];
const rows = [];
for (const [name, fn] of variants) {
  for (const [where, c] of [['wood tower centre (y=1)', { x: 28, y: 1.0 }], ['wood tower left face', { x: 25.4, y: 1.5 }], ['stone tower centre', { x: 37, y: 1.0 }], ['on top of wood tower', { x: 28, y: 8.2 }]]) {
    const g = createGame(); level(g);
    for (let i = 0; i < 90; i++) stepGame(g);
    g.damageEnabled = true;
    const n0 = [...g.entities].filter(e => e.type === 'block').length;
    fn(g, c);
    let maxV = 0; for (const e of g.entities) maxV = Math.max(maxV, e.body.getLinearVelocity().length());
    for (let i = 0; i < 300; i++) stepGame(g);
    const ev = g.events; const bl = ev.filter(e => e.type === 'blockDestroyed'); const by = {}; for (const b of bl) by[b.mat] = (by[b.mat] || 0) + 1;
    let far = 0; for (const e of g.entities) far = Math.max(far, Math.abs(e.body.getPosition().x - c.x));
    rows.push({ formula: name, at: where, maxV0: fmt(maxV, 1), destroyed: `${bl.length}/${n0} ${JSON.stringify(by).replace(/"/g, '')}`, pigs: `${ev.filter(e => e.type === 'pigKilled').length}/4`, 'far debris m': fmt(far, 1) });
  }
}
console.log('### D4: blast formulas under final config (wood tower 3 floors + stone tower 2 floors, 4 pigs from 02)');
console.log(table(rows));
