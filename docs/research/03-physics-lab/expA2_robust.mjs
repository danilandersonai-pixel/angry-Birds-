import { addCircle } from "./lib.mjs";
import { makeWorld, addGround, addBox, dynBodies, displacement, DT, fmt, table, World, Box } from './lib.mjs';
import { buildTower, buildStack, buildPyramid } from './expA_stability.mjs';

// (1) authored exactly-touching geometry, with collision inset per side
function addBoxInset(world, o, inset) {
  const b = world.createBody({ type: 'dynamic', position: { x: o.x, y: o.y } });
  b.createFixture({ shape: new Box(o.w / 2 - inset, o.h / 2 - inset), density: o.density, friction: o.friction, restitution: o.restitution });
  b.setUserData({ x0: o.x, y0: o.y, a0: 0 });
  return b;
}
const rows = [];
for (const inset of [0, 0.005, 0.0075, 0.01]) {
  for (const [vi, pi] of [[8,3],[10,8]]) {
    const w = new World({ gravity: { x: 0, y: -15 } });
    const gb = w.createBody({ type: 'static', position: { x: 0, y: -1 } });
    gb.createFixture({ shape: new Box(100 - inset, 1 - inset), friction: 0.8 });
    // tower4 authored with zero gaps
    let y = 0;
    const M = { density: 0.6, friction: 0.7, restitution: 0.05 };
    for (let i = 0; i < 4; i++) {
      addBoxInset(w, { x: 28.25, y: y + 1, w: 0.5, h: 2, ...M }, inset);
      addBoxInset(w, { x: 31.75, y: y + 1, w: 0.5, h: 2, ...M }, inset);
      addBoxInset(w, { x: 30, y: y + 2.25, w: 4, h: 0.5, ...M }, inset);
      y += 2.5;
    }
    let asleep = null;
    const bodies = dynBodies(w);
    for (let i = 1; i <= 600; i++) { w.step(DT, vi, pi); if (asleep === null && bodies.every(b => !b.isAwake())) asleep = i * DT; }
    let md = 0; for (const b of bodies) md = Math.max(md, displacement(b));
    rows.push({ inset_m: inset, iters: `${vi}/${pi}`, maxDisp_mm: fmt(md * 1000, 2), allAsleep_s: asleep ? fmt(asleep, 2) : 'never' });
  }
}
console.log('### A6: authored touching (gap 0) + collision inset per side, tower4');
console.log(table(rows));

// (2) lateral kick of the whole top floor: give top beam a horizontal velocity
const rows2 = [];
const WOODf = (f) => ({ density: 0.6, friction: f, restitution: 0.05 });
for (const f of [0.3, 0.6, 0.9]) {
  for (const v of [0.5, 1, 2, 3, 5]) {
    for (const [vi, pi] of [[8,3],[10,8]]) {
      const w = makeWorld({ g: -15 });
      addGround(w, { friction: 0.8 });
      buildTower(w, { floors: 4, colMat: WOODf(f), beamMat: WOODf(f) });
      const bodies = dynBodies(w);
      for (let i = 0; i < 120; i++) w.step(DT, vi, pi); // settle 2 s
      const top = bodies[bodies.length - 1];
      top.setAwake(true);
      top.setLinearVelocity({ x: v, y: 0 });
      let asleep = null;
      for (let i = 1; i <= 600; i++) { w.step(DT, vi, pi); if (asleep === null && bodies.every(b => !b.isAwake())) asleep = i * DT; }
      let fallen = 0; for (const b of bodies) { const rot = Math.abs(b.getAngle()) * 180 / Math.PI; if (displacement(b) > 0.25 || rot > 10) fallen++; }
      rows2.push({ friction: f, kick_mps: v, iters: `${vi}/${pi}`, topBeamMoved_m: fmt(displacement(top), 2), fallen: `${fallen}/${bodies.length}`, settle_s: asleep ? fmt(asleep, 2) : '>10' });
    }
  }
}
console.log('\n### A7: lateral kick of top beam (tower4, g=-15)');
console.log(table(rows2));

// (3) drop tests: bounce height
const rows3 = [];
for (const e of [0, 0.05, 0.1, 0.2, 0.3, 0.5]) {
  for (const shape of ['box1x1', 'plank2x0.5', 'circle r0.45']) {
    const w = makeWorld({ g: -15 });
    addGround(w, { friction: 0.8, restitution: 0 });
    let b;
    if (shape === 'box1x1') b = addBox(w, { x: 0, y: 2.5, w: 1, h: 1, density: 0.6, friction: 0.7, restitution: e });
    else if (shape === 'plank2x0.5') b = addBox(w, { x: 0, y: 2.25, w: 2, h: 0.5, density: 0.6, friction: 0.7, restitution: e });
    else b = addCircle(w, { x: 0, y: 2.45, r: 0.45, density: 0.8, friction: 0.7, restitution: e });
    let phase = 0, maxBounce = 0, ymin = 1e9, impactV = 0, asleep = null, prevVy = 0;
    const base = shape === 'plank2x0.5' ? 0.25 : (shape === 'box1x1' ? 0.5 : 0.45);
    for (let i = 1; i <= 600; i++) {
      w.step(DT);
      const vy = b.getLinearVelocity().y, y = b.getPosition().y;
      if (phase === 0 && vy > 0 && prevVy < 0) { phase = 1; impactV = prevVy; }
      if (phase === 1) maxBounce = Math.max(maxBounce, y - base);
      prevVy = vy;
      if (asleep === null && !b.isAwake()) asleep = i * DT;
    }
    rows3.push({ restitution: e, shape, impactV: fmt(impactV, 2), bounce_m: fmt(maxBounce, 3), sleep_s: asleep ? fmt(asleep, 2) : '>10' });
  }
}
console.log('\n### A8: drop from 2 m onto ground (ground e=0, mix=max)');
console.log(table(rows3));
