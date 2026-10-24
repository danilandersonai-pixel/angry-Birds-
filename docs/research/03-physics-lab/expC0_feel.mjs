import { makeWorld, addGround, addCircle, addBox, dynBodies, displacement, DT, fmt, table } from './lib.mjs';
import { buildTower } from './expA_stability.mjs';
// pure-physics feel (no breaking): bird hits tower4 first-floor column horizontally
const rows = [];
for (const rb of [1.5, 2.5, 4]) {
  for (const [mname, rw] of [['wood0.5', 0.5], ['wood0.7', 0.7], ['wood1.0', 1.0], ['stone2.4', 2.4]]) {
    for (const v of [15, 24]) {
      const w = makeWorld({ g: -15 });
      addGround(w);
      const M = { density: rw, friction: 0.7, restitution: 0.05 };
      buildTower(w, { floors: 4, colMat: M, beamMat: M });
      for (let i = 0; i < 90; i++) w.step(DT, 10, 8);
      const blocks = dynBodies(w);
      const bird = addCircle(w, { x: 25, y: 1.2, r: 0.45, density: rb, friction: 0.8, restitution: 0.3, bullet: true, angularDamping: 0 , kind: 'bird'});
      bird.setLinearVelocity({ x: v, y: 0 });
      let vAfter = null;
      for (let i = 1; i <= 300; i++) { w.step(DT, 10, 8); if (i === 20) vAfter = bird.getLinearVelocity().x; }
      const moved = blocks.filter((b) => displacement(b) > 0.5).length;
      const birdX = bird.getPosition().x;
      rows.push({ birdDensity: rb, birdMass: fmt(bird.getMass(), 2), material: mname, colMass: fmt(blocks[0].getMass(), 2), v0: v, birdVx_0_33s: fmt(vAfter, 1), birdX_5s: fmt(birdX, 1), blocksMoved: `${moved}/12` });
    }
  }
}
console.log('### C0: bird vs tower4 (no breaking), hit 1st-floor column at y=1.2');
console.log(table(rows));
