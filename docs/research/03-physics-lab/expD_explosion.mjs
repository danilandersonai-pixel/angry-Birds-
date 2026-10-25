// Experiment D: Bomb explosion — radial impulse with falloff
import { makeWorld, addGround, addBox, addCircle, dynBodies, displacement, DT, fmt, table, Vec2 } from './lib.mjs';
import { MAT, PIG } from './expC_impulses.mjs';
import { buildTower } from './expA_stability.mjs';
const G = -15, VI = 10, PI = 8;

// Gather bodies whose fixtures overlap the blast circle; compute distance to the closest point via raycast.
export function explode(world, c, { R, J0, dvMax, falloff = 'linear', occlusion = false, applyAtSurface = true }) {
  const seen = new Set();
  world.queryAABB({ lowerBound: { x: c.x - R, y: c.y - R }, upperBound: { x: c.x + R, y: c.y + R } }, (fx) => {
    const b = fx.getBody();
    if (b.isDynamic()) seen.add(b);
    return true; // continue query
  });
  const results = [];
  for (const b of seen) {
    const com = b.getWorldCenter();
    // closest point: raycast from blast centre to COM against this body's fixtures
    let hitPoint = null, hitFrac = 1;
    for (let f = b.getFixtureList(); f; f = f.getNext()) {
      const out = {};
      if (f.rayCast(out, { p1: c, p2: com, maxFraction: 1 }, 0) && out.fraction < hitFrac) {
        hitFrac = out.fraction;
        hitPoint = { x: c.x + (com.x - c.x) * out.fraction, y: c.y + (com.y - c.y) * out.fraction };
      }
    }
    const p = hitPoint || com; // centre inside body -> use COM
    const dx = com.x - c.x, dy = com.y - c.y;
    const dCom = Math.hypot(dx, dy) || 1e-6;
    const d = hitPoint ? Math.hypot(p.x - c.x, p.y - c.y) : 0;
    if (d > R) continue;
    let occl = 1;
    if (occlusion) {
      // other bodies between blast and this body reduce the impulse (stone shields)
      world.rayCast(c, p, (fx, pt, n, frac) => {
        const ob = fx.getBody();
        if (ob !== b && ob.isDynamic()) occl *= 0.5;
        return -1;
      });
    }
    const t = 1 - d / R;
    const f = falloff === 'linear' ? t : falloff === 'quad' ? t * t : 1 / (1 + (d * d) / 1.0);
    let J = J0 * f * occl;
    const m = b.getMass();
    if (dvMax) J = Math.min(J, m * dvMax);
    const dir = { x: dx / dCom, y: dy / dCom };
    b.applyLinearImpulse({ x: dir.x * J, y: dir.y * J }, applyAtSurface ? p : com, true);
    results.push({ b, d, J, dv: J / m });
  }
  return results;
}

function scene(kind) {
  const w = makeWorld({ g: G });
  addGround(w, { friction: 0.9 });
  if (kind === 'wood') buildTower(w, { floors: 4, colMat: MAT.wood, beamMat: MAT.wood });
  else buildTower(w, { floors: 4, colMat: MAT.wood, beamMat: MAT.stone });
  // pigs on floors 1 and 2
  const pigs = [addCircle(w, { x: 30, y: 2.53 + 0.46, r: 0.45, ...PIG, kind: 'pig' }), addCircle(w, { x: 30, y: 5.06 + 0.46, r: 0.45, ...PIG, kind: 'pig' })];
  for (let i = 0; i < 120; i++) w.step(DT, VI, PI);
  for (const b of dynBodies(w)) { const u = b.getUserData(); const p = b.getPosition(); u.x0 = p.x; u.y0 = p.y; }
  return { w, pigs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
const rows = [];
const configs = [
  { name: 'J0=10 R=4 lin', R: 4, J0: 10 },
  { name: 'J0=20 R=4 lin', R: 4, J0: 20 },
  { name: 'J0=40 R=4 lin', R: 4, J0: 40 },
  { name: 'J0=20 R=4 lin dvMax=20', R: 4, J0: 20, dvMax: 20 },
  { name: 'J0=30 R=4 lin dvMax=20', R: 4, J0: 30, dvMax: 20 },
  { name: 'J0=30 R=4 quad dvMax=20', R: 4, J0: 30, dvMax: 20, falloff: 'quad' },
  { name: 'J0=30 R=5 lin dvMax=22', R: 5, J0: 30, dvMax: 22 },
  { name: 'J0=30 R=3 lin dvMax=20', R: 3, J0: 30, dvMax: 20 },
  { name: 'J0=30 R=4 lin dvMax=20 occl', R: 4, J0: 30, dvMax: 20, occlusion: true },
];
for (const kind of ['wood', 'woodcols+stonebeams']) {
  for (const cfg of configs) {
    for (const where of ['side', 'inside']) {
      const { w, pigs } = scene(kind);
      const c = where === 'side' ? { x: 30 - 2.0 - 0.55, y: 1.0 } : { x: 30, y: 1.0 };
      const res = explode(w, c, cfg);
      let maxV = 0, maxW = 0;
      for (const b of dynBodies(w)) { maxV = Math.max(maxV, b.getLinearVelocity().length()); maxW = Math.max(maxW, Math.abs(b.getAngularVelocity())); }
      const pigV = pigs.map((p) => p.getLinearVelocity().length());
      // speed after one step (solver may clip by contacts)
      w.step(DT, VI, PI);
      let maxStepMove = 0;
      for (let i = 0; i < 180; i++) w.step(DT, VI, PI);
      const bodies = dynBodies(w);
      const moved1 = bodies.filter((b) => displacement(b) > 1).length;
      let maxDisp = 0; for (const b of bodies) maxDisp = Math.max(maxDisp, displacement(b));
      rows.push({ struct: kind, cfg: cfg.name, at: where, affected: res.length, maxV0: fmt(maxV, 1), maxOmega: fmt(maxW, 1), pigV: pigV.map((v) => fmt(v, 1)).join('/'), 'moved>1m @3s': `${moved1}/${bodies.length}`, maxDisp3s_m: fmt(maxDisp, 1) });
    }
  }
}
console.log('### D1: radial impulse explosion on tower4 (+2 pigs), applied at closest surface point');
console.log(table(rows));
}
