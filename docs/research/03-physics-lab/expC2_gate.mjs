// C2: velocity-gated impulse; resting contacts vs impacts; toppling cases
import { makeWorld, addGround, addBox, addCircle, dynBodies, DT, fmt, table } from './lib.mjs';
import { MAT, PIG, BIRD } from './expC_impulses.mjs';
import { buildTower } from './expA_stability.mjs';
const G = -15, VI = 10, PI = 8;
const r2 = (x) => fmt(x, 2);
function named(b, name) { b.getUserData().name = name; return b; }
function world0() { const w = makeWorld({ g: G }); named(addGround(w, { friction: 0.9 }), 'ground'); return w; }

// Gated tracker: per contact per step -> J (reg+toi), vn (max approach speed seen in pre-solve this step)
function gated(world) {
  const S = { step: 0, rows: [] };
  const vnByContact = new Map();
  world.on('pre-step', () => { S.step++; vnByContact.clear(); });
  world.on('pre-solve', (c) => {
    const wm = c.getWorldManifold(null); if (!wm || !wm.pointCount) return;
    const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
    let vmax = 0;
    for (let i = 0; i < wm.pointCount; i++) {
      const p = wm.points[i];
      const va = a.getLinearVelocityFromWorldPoint(p), vb = b.getLinearVelocityFromWorldPoint(p);
      vmax = Math.max(vmax, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y));
    }
    vnByContact.set(c, Math.max(vnByContact.get(c) || 0, vmax));
  });
  world.on('post-solve', (c, imp) => {
    let J = 0; for (const v of imp.normalImpulses) J += v;
    const a = c.getFixtureA().getBody().getUserData()?.name || '?', b = c.getFixtureB().getBody().getUserData()?.name || '?';
    S.rows.push({ step: S.step, key: a < b ? `${a}|${b}` : `${b}|${a}`, J, vn: vnByContact.get(c) || 0 });
  });
  return S;
}
function stats(S, filter) {
  let maxJ = 0, maxJgated = 0, maxVn = 0;
  for (const r of S.rows) { if (!filter(r)) continue; maxJ = Math.max(maxJ, r.J); maxVn = Math.max(maxVn, r.vn); if (r.vn > 0.5) maxJgated = Math.max(maxJgated, r.J); }
  return { maxJ, maxJgated, maxVn };
}

const rows = [];
// resting structures 2..6 s
const structs = {
  'tower4 wood': [MAT.wood, MAT.wood],
  'tower4 wood cols+stone beams': [MAT.wood, MAT.stone],
  'tower4 stone': [MAT.stone, MAT.stone],
};
for (const [name, [c, b]] of Object.entries(structs)) {
  for (const floors of [4, 6]) {
    const w = world0();
    const S = gated(w);
    buildTower(w, { floors, colMat: c, beamMat: b });
    for (let i = 0; i < 360; i++) w.step(DT, VI, PI);
    const s = stats(S, (r) => r.step >= 120);
    const s0 = stats(S, (r) => r.step <= 60);
    rows.push({ case: `${name.replace('tower4', 'tower' + floors)} resting 2-6 s`, maxJ: r2(s.maxJ), maxVn: r2(s.maxVn), 'maxJ if vn>0.5': r2(s.maxJgated), spawn_maxJ: r2(s0.maxJ), spawn_maxVn: r2(s0.maxVn), 'spawn maxJ if vn>0.5': r2(s0.maxJgated) });
  }
}
// toppling columns (tilt 20 deg > tipping angle 14 deg)
for (const mat of ['wood', 'stone']) {
  const w = world0();
  const S = gated(w);
  named(addBox(w, { x: 0, y: 0.94, w: 0.5, h: 2, angle: -20 * Math.PI / 180, ...MAT[mat] }), 'col');
  for (let i = 0; i < 240; i++) w.step(DT, VI, PI);
  const s = stats(S, (r) => r.key === 'col|ground' && r.step > 5);
  rows.push({ case: `${mat} col 0.5x2 topples (20deg) onto ground`, maxJ: r2(s.maxJ), maxVn: r2(s.maxVn), 'maxJ if vn>0.5': r2(s.maxJgated) });
}
for (const mat of ['wood', 'stone']) {
  const w = world0();
  named(addCircle(w, { x: 1.6, y: 0.45, r: 0.45, ...PIG }), 'pig');
  for (let i = 0; i < 30; i++) w.step(DT, VI, PI);
  const S = gated(w);
  named(addBox(w, { x: 0, y: 0.94, w: 0.5, h: 2, angle: -20 * Math.PI / 180, ...MAT[mat] }), 'col');
  for (let i = 0; i < 240; i++) w.step(DT, VI, PI);
  const s = stats(S, (r) => r.key === 'col|pig');
  rows.push({ case: `${mat} col topples onto pig 1.6 m away`, maxJ: r2(s.maxJ), maxVn: r2(s.maxVn), 'maxJ if vn>0.5': r2(s.maxJgated) });
}
// pig pressed under a resting stone beam (pig supports beam on two pigs)
{
  const w = world0();
  const S = gated(w);
  named(addCircle(w, { x: -1.2, y: 0.45, r: 0.45, ...PIG }), 'pigA');
  named(addCircle(w, { x: 1.2, y: 0.45, r: 0.45, ...PIG }), 'pigB');
  named(addBox(w, { x: 0, y: 0.9 + 0.25 + 0.01, w: 4, h: 0.5, ...MAT.stone }), 'beam');
  for (let i = 0; i < 360; i++) w.step(DT, VI, PI);
  const s = stats(S, (r) => r.key === 'beam|pigA' && r.step > 20);
  rows.push({ case: 'stone beam 4.4 kg resting on 2 pigs', maxJ: r2(s.maxJ), maxVn: r2(s.maxVn), 'maxJ if vn>0.5': r2(s.maxJgated) });
}
// pig rolling on ground and block sliding
{
  const w = world0();
  const S = gated(w);
  const p = named(addCircle(w, { x: 0, y: 0.45, r: 0.45, ...PIG }), 'pig');
  for (let i = 0; i < 30; i++) w.step(DT, VI, PI);
  p.setLinearVelocity({ x: 5, y: 0 }); p.setAngularVelocity(-5 / 0.45);
  for (let i = 0; i < 240; i++) w.step(DT, VI, PI);
  const s = stats(S, (r) => r.key === 'ground|pig' && r.step > 30);
  rows.push({ case: 'pig rolls on ground @5 m/s', maxJ: r2(s.maxJ), maxVn: r2(s.maxVn), 'maxJ if vn>0.5': r2(s.maxJgated) });
}
// impacts for reference: bird 10 m/s into wood col, pig falls 3 m
{
  const w = world0();
  named(addBox(w, { x: 3, y: 1.0, w: 0.5, h: 2, ...MAT.wood }), 'col');
  for (let i = 0; i < 60; i++) w.step(DT, VI, PI);
  const S = gated(w);
  const bird = named(addCircle(w, { x: 0, y: 1.0, r: 0.45, ...BIRD, bullet: true }), 'bird');
  bird.setLinearVelocity({ x: 10, y: 0 });
  for (let i = 0; i < 60; i++) w.step(DT, VI, PI);
  const s = stats(S, (r) => r.key === 'bird|col');
  rows.push({ case: 'REF bird 10 m/s -> wood col', maxJ: r2(s.maxJ), maxVn: r2(s.maxVn), 'maxJ if vn>0.5': r2(s.maxJgated) });
}
{
  const w = world0();
  const S = gated(w);
  named(addCircle(w, { x: 0, y: 3.45, r: 0.45, ...PIG }), 'pig');
  for (let i = 0; i < 120; i++) w.step(DT, VI, PI);
  const s = stats(S, (r) => r.key === 'ground|pig');
  rows.push({ case: 'REF pig falls 3 m onto ground', maxJ: r2(s.maxJ), maxVn: r2(s.maxVn), 'maxJ if vn>0.5': r2(s.maxJgated) });
}
console.log('### C6: velocity gate (count impulse only if pre-solve approach speed vn > 0.5 m/s)');
console.log(table(rows));
