// H: "piercing" — disable contact in pre-solve when predicted damage would destroy the block
import { makeWorld, addGround, addBox, addCircle, DT, fmt, table } from './lib.mjs';
import { MAT, BIRD } from './expC_impulses.mjs';
const rows = [];
for (const mode of ['plain', 'pierce']) {
  for (const v of [15, 24, 35]) {
    const w = makeWorld({ g: -15 });
    addGround(w, { friction: 0.9 });
    const cols = [];
    for (let k = 0; k < 3; k++) { const c = addBox(w, { x: 4 + k * 1.5, y: 1.0, w: 0.5, h: 2, ...MAT.wood }); c.getUserData().hp = 10; c.getUserData().name = 'col' + k; cols.push(c); }
    for (let i = 0; i < 30; i++) w.step(DT, 10, 8);
    const bird = addCircle(w, { x: 0, y: 1.0, r: 0.45, ...BIRD, bullet: true });
    bird.getUserData().name = 'bird';
    bird.setLinearVelocity({ x: v, y: 0 });
    const kill = new Set(); const pierced = [];
    if (mode === 'pierce') {
      w.on('pre-solve', (c) => {
        const A = c.getFixtureA().getBody(), B = c.getFixtureB().getBody();
        const blk = A === bird ? B : B === bird ? A : null;
        if (!blk || !blk.getUserData().hp) return;
        if (kill.has(blk)) { c.setEnabled(false); return; }
        const wm = c.getWorldManifold(null); if (!wm || !wm.pointCount) return;
        const va = A.getLinearVelocityFromWorldPoint(wm.points[0]), vb = B.getLinearVelocityFromWorldPoint(wm.points[0]);
        const vn = -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y);
        if (vn < 0.5) return;
        const mA = bird.getMass(), mB = blk.getMass();
        const Jest = (1 + 0.3) * (mA * mB / (mA + mB)) * vn;
        const dmg = Math.max(0, Jest - 1.0);
        if (dmg >= blk.getUserData().hp) {
          c.setEnabled(false);
          kill.add(blk);
          pierced.push({ blk, keep: Math.min(0.9, Math.max(0.5, 1 - 0.5 * blk.getUserData().hp / dmg)) });
        }
      });
    }
    let destroyed = 0;
    const speeds = [];
    for (let i = 1; i <= 90; i++) {
      const vPre = bird.getLinearVelocity().clone();
      w.step(DT, 10, 8);
      for (const p of pierced.splice(0)) {
        bird.setLinearVelocity({ x: vPre.x * p.keep, y: vPre.y * p.keep });
        w.destroyBody(p.blk); destroyed++;
      }
      if (i % 15 === 0) speeds.push(fmt(bird.getLinearVelocity().x, 1));
    }
    rows.push({ mode, v0: v, destroyedByPierce: destroyed, 'bird vx every 0.25 s': speeds.join(' '), birdX_1_5s: fmt(bird.getPosition().x, 1) });
  }
}
console.log('### H1: bird vs 3 wood columns (hp=10 each), pierce via contact.setEnabled(false) in pre-solve');
console.log(table(rows));
