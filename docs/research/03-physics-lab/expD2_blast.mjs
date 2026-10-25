// D2: full blast = impulse (capped dv) + spin + damage with falloff; TNT chain
import { createGame, addBlock, addPig, stepGame, DT } from './game.mjs';
import { explode } from './expD_explosion.mjs';
import { fmt, table } from './lib.mjs';
function blast(g, c, { R, J0, dvMax, D0, spin = 0.15 }) {
  const res = explode(g.world, c, { R, J0, dvMax });
  for (const r of res) {
    const e = r.b.getUserData();
    const f = 1 - r.d / R;
    // spin: angular impulse proportional to linear impulse, deterministic sign by side
    const side = Math.sign((r.b.getWorldCenter().x - c.x) || 1);
    r.b.applyAngularImpulse(-side * r.J * spin * Math.min(1, (e.w || e.r * 2 || 1) / 2), true);
    if (e && e.hp !== undefined && e.type !== 'bird') {
      const matMult = e.mat === 'ice' ? 1.5 : 1.0;
      e.hp -= D0 * f * matMult;
    }
  }
  return res.length;
}
function level(g) {
  let y = 0;
  for (let i = 0; i < 3; i++) { addBlock(g, 'wood', 26.25, y + 1, 0.5, 2); addBlock(g, 'wood', 29.75, y + 1, 0.5, 2); addBlock(g, 'wood', 28, y + 2.25, 4, 0.5); y += 2.5; }
  addPig(g, 28, 0.45); addPig(g, 28, 2.5 + 0.45); addPig(g, 28, 5.0 + 0.45);
  y = 0;
  for (let i = 0; i < 2; i++) { addBlock(g, 'stone', 35.25, y + 1, 0.5, 2); addBlock(g, 'stone', 38.75, y + 1, 0.5, 2); addBlock(g, 'stone', 37, y + 2.25, 4, 0.5); y += 2.5; }
  addPig(g, 37, 0.45, 0.45, 5);
}
const rows = [];
const cfgs = [
  { name: 'R3.5 J0=30 dv20 D0=100', R: 3.5, J0: 30, dvMax: 20, D0: 100 },
  { name: 'R3.0 J0=25 dv18 D0=80 (TNT)', R: 3.0, J0: 25, dvMax: 18, D0: 80 },
  { name: 'R4.5 J0=40 dv22 D0=120', R: 4.5, J0: 40, dvMax: 22, D0: 120 },
];
for (const cfg of cfgs) {
  for (const [where, c] of [['wood tower, ground floor centre', { x: 28, y: 1.0 }], ['wood tower, left side', { x: 25.3, y: 1.5 }], ['stone tower centre', { x: 37, y: 1.0 }], ['between towers', { x: 32.5, y: 1.0 }]]) {
    const g = createGame(); level(g);
    for (let i = 0; i < 90; i++) stepGame(g);
    g.damageEnabled = true;
    const blocks0 = [...g.entities].filter(e => e.type === 'block').length;
    const n = blast(g, c, cfg);
    let maxV = 0, maxW = 0;
    for (const e of g.entities) { maxV = Math.max(maxV, e.body.getLinearVelocity().length()); maxW = Math.max(maxW, Math.abs(e.body.getAngularVelocity())); }
    for (let i = 0; i < 300; i++) stepGame(g);
    const ev = g.events;
    const blocks = ev.filter(e => e.type === 'blockDestroyed');
    const byMat = {}; for (const b of blocks) byMat[b.mat] = (byMat[b.mat] || 0) + 1;
    let maxX = 0; for (const e of g.entities) maxX = Math.max(maxX, Math.abs(e.body.getPosition().x - c.x));
    rows.push({ cfg: cfg.name, at: where, affected: n, maxV0: fmt(maxV, 1), maxOmega0: fmt(maxW, 1), destroyed: `${blocks.length}/${blocks0} ${JSON.stringify(byMat).replace(/"/g, '')}`, pigsKilled: `${ev.filter(e => e.type === 'pigKilled').length}/4`, 'farthest debris dx_m @5s': fmt(maxX, 1) });
  }
}
console.log('### D2: blast with damage, mini-level (3-floor wood tower + 2-floor stone tower, 4 pigs)');
console.log(table(rows));
// TNT chain: row of TNT boxes spaced d apart, detonate first
const rows2 = [];
for (const gap of [1.0, 2.0, 2.8, 3.5]) {
  const g = createGame();
  const tnts = [];
  for (let k = 0; k < 4; k++) tnts.push(addBlock(g, 'tnt', 20 + k * (1 + gap), 0.5, 1, 1));
  for (let i = 0; i < 60; i++) stepGame(g);
  g.damageEnabled = true;
  tnts[0].hp = 0; // trigger
  let chainT = [];
  for (let i = 0; i < 180; i++) { const before = g.events.length; stepGame(g); for (const e of g.events.slice(before)) chainT.push(fmt(i * DT, 2)); }
  rows2.push({ 'gap between 1x1 TNT_m': gap, exploded: `${g.events.length}/4`, 'times_s': chainT.join(' ') });
}
console.log('\n### D3: TNT chain reaction (TNT: R=3.0, J0=25, dvMax=18, hp=3, jMin=1.5; damage only via impulses here)');
console.log(table(rows2));
