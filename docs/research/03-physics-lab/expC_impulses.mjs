// Experiment C: typical normal impulses in post-solve
import { makeWorld, addGround, addBox, addCircle, dynBodies, DT, fmt, table } from './lib.mjs';
import { attachTracker, summarize } from './impulse.mjs';
import { buildTower, buildPyramid } from './expA_stability.mjs';

export const MAT = {
  wood: { density: 0.7, friction: 0.7, restitution: 0.05 },
  ice: { density: 0.9, friction: 0.25, restitution: 0.05 },
  stone: { density: 2.2, friction: 0.9, restitution: 0.02 },
};
export const PIG = { density: 0.6, friction: 0.6, restitution: 0.15, angularDamping: 1.0 };
export const BIRD = { density: 2.5, friction: 0.6, restitution: 0.3, angularDamping: 0.6 };
const G = -15, VI = 10, PI = 8;

function named(b, name) { b.getUserData().name = name; return b; }
function world0() { const w = makeWorld({ g: G }); named(addGround(w, { friction: 0.9, restitution: 0 }), 'ground'); return w; }
function run(w, n) { for (let i = 0; i < n; i++) w.step(DT, VI, PI); }
const r2 = (x) => fmt(x, 2);

if (import.meta.url === `file://${process.argv[1]}`) {
// C1: bird hits standing column
const rows1 = [];
for (const mat of ['wood', 'ice', 'stone']) {
  for (const v of [5, 10, 20, 30]) {
    for (const bullet of [true, false]) {
      const w = world0();
      const col = named(addBox(w, { x: 3, y: 1.0, w: 0.5, h: 2, ...MAT[mat] }), 'col');
      run(w, 60);
      const T = attachTracker(w);
      const bird = named(addCircle(w, { x: 0, y: 1.0, r: 0.45, ...BIRD, bullet }), 'bird');
      bird.setLinearVelocity({ x: v, y: 0 });
      run(w, 60);
      const s = summarize(T, 'bird|col');
      rows1.push({ target: `${mat} col ${r2(col.getMass())}kg`, v, bullet, maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), toiJ: r2(s.maxToiJ), steps: s.stepsWithJ, vApproach: r2(s.vApproachMax), 'm_eff*v': r2(bird.getMass() * col.getMass() / (bird.getMass() + col.getMass()) * v), birdVxAfter: r2(bird.getLinearVelocity().x) });
    }
  }
}
// bird vs pig
for (const v of [5, 10, 20, 30]) {
  const w = world0();
  const pig = named(addCircle(w, { x: 3, y: 0.45, r: 0.45, ...PIG }), 'pig');
  run(w, 60);
  const T = attachTracker(w);
  const bird = named(addCircle(w, { x: 0, y: 0.6, r: 0.45, ...BIRD, bullet: true }), 'bird');
  bird.setLinearVelocity({ x: v, y: 0 });
  run(w, 60);
  const s = summarize(T, 'bird|pig');
  rows1.push({ target: `pig r0.45 ${r2(pig.getMass())}kg`, v, bullet: true, maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), toiJ: r2(s.maxToiJ), steps: s.stepsWithJ, vApproach: r2(s.vApproachMax), 'm_eff*v': r2(bird.getMass() * pig.getMass() / (bird.getMass() + pig.getMass()) * v), birdVxAfter: r2(bird.getLinearVelocity().x) });
}
console.log(`### C1: bird (r=0.45, m=${r2(Math.PI * 0.45 * 0.45 * BIRD.density)} kg) horizontal hit`);
console.log(table(rows1));

// C2: plank 2x0.5 falls flat on pig resting on ground
const rows2 = [];
for (const mat of ['wood', 'stone', 'ice']) {
  for (const h of [0.5, 1, 2, 4]) {
    const w = world0();
    const pig = named(addCircle(w, { x: 0, y: 0.45, r: 0.45, ...PIG }), 'pig');
    run(w, 60);
    const T = attachTracker(w);
    const plank = named(addBox(w, { x: 0, y: 0.9 + h + 0.25, w: 2, h: 0.5, ...MAT[mat] }), 'plank');
    const t0 = T.stepIndex;
    run(w, 120);
    const s = summarize(T, 'pig|plank');
    const sg = summarize(T, 'ground|pig');
    rows2.push({ plank: `${mat} ${r2(plank.getMass())}kg`, h_m: h, vImpact: r2(Math.sqrt(2 * -G * h)), 'plank|pig maxStepJ': r2(s.maxStepJ), totalJ: r2(s.totalJ), vApproach: r2(s.vApproachMax), 'pig|ground maxStepJ': r2(sg.maxStepJ) });
  }
}
console.log('\n### C2: plank 2x0.5 dropped flat onto pig (gap h between plank bottom and pig top)');
console.log(table(rows2));

// C3: pig falls onto ground / onto wood beam
const rows3 = [];
for (const h of [0.5, 1, 2, 3, 5]) {
  for (const onto of ['ground', 'woodBeam']) {
    const w = world0();
    let base = 0;
    if (onto === 'woodBeam') { named(addBox(w, { x: 0, y: 0.25, w: 4, h: 0.5, ...MAT.wood }), 'beam'); base = 0.5; run(w, 60); }
    const T = attachTracker(w);
    const pig = named(addCircle(w, { x: 0, y: base + h + 0.45, r: 0.45, ...PIG }), 'pig');
    run(w, 120);
    const key = onto === 'ground' ? 'ground|pig' : 'beam|pig';
    const s = summarize(T, key);
    rows3.push({ onto, h_m: h, vImpact: r2(Math.sqrt(2 * -G * h)), maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), steps: s.stepsWithJ, vApproach: r2(s.vApproachMax), 'm*v': r2(pig.getMass() * Math.sqrt(2 * -G * h)) });
  }
}
console.log(`\n### C3: pig (r=0.45, m=${r2(Math.PI * 0.45 * 0.45 * PIG.density)} kg) falls from h`);
console.log(table(rows3));

// C4: resting structures: max per-step J over all contacts during spawn (0-1 s) and rest (2-6 s)
const rows4 = [];
const structs = {
  'tower4 wood': (w) => buildTower(w, { floors: 4, colMat: MAT.wood, beamMat: MAT.wood }),
  'tower4 wood cols + stone beams': (w) => buildTower(w, { floors: 4, colMat: MAT.wood, beamMat: MAT.stone }),
  'tower4 stone': (w) => buildTower(w, { floors: 4, colMat: MAT.stone, beamMat: MAT.stone }),
  'pyramid5 stone': (w) => buildPyramid(w, { base: 5, mat: MAT.stone }),
  'tower4 wood + pig per floor': (w) => {
    buildTower(w, { floors: 4, colMat: MAT.wood, beamMat: MAT.wood });
    for (let i = 0; i < 4; i++) addCircle(w, { x: 30, y: (i + 1) * 2.53 + 0.46, r: 0.45, ...PIG, kind: 'pig' });
  },
};
for (const [name, build] of Object.entries(structs)) {
  for (const gap of [0.015, 0]) {
    const w = world0();
    const T = attachTracker(w);
    if (gap === 0) {
      // spawn with zero gap (overlapping skins) to see the spawn spike
      const orig = buildTower;
    }
    build(w);
    let k = 0; for (const b of dynBodies(w)) { if (!b.getUserData().name) b.getUserData().name = `b${k++}`; }
    run(w, 360);
    let spawnMax = 0, restMax = 0, restMaxPerPoint = 0;
    for (const e of T.events) {
      if (e.key.includes('ground') && e.key.includes('?')) continue;
      if (e.step <= 60) spawnMax = Math.max(spawnMax, e.J);
      else if (e.step >= 120) restMax = Math.max(restMax, e.J);
    }
    let totalMass = 0; for (const b of dynBodies(w)) totalMass += b.getMass();
    rows4.push({ struct: name, buildGap: gap, totalMass_kg: r2(totalMass), 'weight*dt (total)': r2(totalMass * -G * DT), spawnMaxJ_0to1s: r2(spawnMax), restMaxJ_2to6s: r2(restMax) });
    if (gap === 0) rows4.pop();
  }
}
console.log('\n### C4: resting structures (per post-solve call, sum of points)');
console.log(table(rows4));

// C5: light touches
const rows5 = [];
{
  // pig rolls into wood column
  for (const v of [1, 2, 4]) {
    const w = world0();
    const col = named(addBox(w, { x: 3, y: 1.0, w: 0.5, h: 2, ...MAT.wood }), 'col');
    const pig = named(addCircle(w, { x: 0, y: 0.45, r: 0.45, ...PIG }), 'pig');
    run(w, 30);
    const T = attachTracker(w);
    pig.setLinearVelocity({ x: v, y: 0 }); pig.setAngularVelocity(-v / 0.45);
    run(w, 180);
    const s = summarize(T, 'col|pig');
    rows5.push({ case: `pig rolls into wood col @${v} m/s`, maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), vApproach: r2(s.vApproachMax) });
  }
  // column topples from upright (tilt 4 deg) onto ground
  for (const mat of ['wood', 'stone']) {
    const w = world0();
    const T = attachTracker(w);
    const col = named(addBox(w, { x: 0, y: 1.0, w: 0.5, h: 2, angle: -4 * Math.PI / 180, ...MAT[mat] }), 'col');
    run(w, 240);
    const s = summarize(T, 'col|ground', 30);
    rows5.push({ case: `${mat} col 0.5x2 topples onto ground`, maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), vApproach: r2(s.vApproachMax) });
  }
  // column topples onto pig
  for (const mat of ['wood', 'stone']) {
    const w = world0();
    const pig = named(addCircle(w, { x: 1.4, y: 0.45, r: 0.45, ...PIG }), 'pig');
    run(w, 30);
    const T = attachTracker(w);
    const col = named(addBox(w, { x: 0, y: 1.0, w: 0.5, h: 2, angle: -4 * Math.PI / 180, ...MAT[mat] }), 'col');
    run(w, 240);
    const s = summarize(T, 'col|pig');
    rows5.push({ case: `${mat} col topples onto pig (1.4 m away)`, maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), vApproach: r2(s.vApproachMax) });
  }
  // block sliding on ground
  {
    const w = world0();
    const b = named(addBox(w, { x: 0, y: 0.5, w: 1, h: 1, ...MAT.wood }), 'blk');
    run(w, 30);
    const T = attachTracker(w);
    b.setLinearVelocity({ x: 4, y: 0 });
    run(w, 120);
    const s = summarize(T, 'blk|ground');
    rows5.push({ case: `wood 1x1 slides on ground @4 m/s (weight*dt=${r2(b.getMass() * -G * DT)})`, maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), vApproach: r2(s.vApproachMax) });
  }
  // bird lands and rolls on ground (shallow landing)
  {
    const w = world0();
    const T = attachTracker(w);
    const bird = named(addCircle(w, { x: 0, y: 1.0, r: 0.45, ...BIRD, bullet: true }), 'bird');
    bird.setLinearVelocity({ x: 15, y: -5 });
    run(w, 240);
    const s = summarize(T, 'bird|ground');
    rows5.push({ case: 'bird lands at (15,-5) m/s and rolls', maxStepJ: r2(s.maxStepJ), totalJ: r2(s.totalJ), vApproach: r2(s.vApproachMax) });
  }
}
console.log('\n### C5: light touches / secondary impacts');
console.log(table(rows5));
}
