// F: rolling of circles (bird/pig) — angularDamping vs custom rolling resistance
import { makeWorld, addGround, addCircle, DT, fmt, table } from './lib.mjs';
const rows = [];
function rollTest({ v0, angDamp = 0, linDamp = 0, rr = 0, friction = 0.6, density = 2.5, r = 0.45, landing = false }) {
  const w = makeWorld({ g: -15 });
  addGround(w, { friction: 0.9 });
  const b = addCircle(w, { x: 0, y: landing ? 3 : r, r, density, friction, restitution: 0.3, angularDamping: angDamp, linearDamping: linDamp, bullet: true });
  if (landing) b.setLinearVelocity({ x: v0 * Math.cos(-0.6), y: v0 * Math.sin(-0.6) });
  else { b.setLinearVelocity({ x: v0, y: 0 }); b.setAngularVelocity(-v0 / r); }
  let tStop = null, x0 = 0, touching = false;
  for (let i = 1; i <= 1200; i++) {
    // custom rolling resistance: torque opposing spin while touching ground
    if (rr > 0) {
      let onGround = false;
      for (let ce = b.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) onGround = true;
      if (onGround) {
        const wv = b.getAngularVelocity();
        const m = b.getMass();
        // rolling resistance: decelerate linear speed by rr*g, by braking spin
        const dw = Math.min(Math.abs(wv), rr * 15 / r * DT);
        b.setAngularVelocity(wv - Math.sign(wv) * dw);
      }
    }
    w.step(DT, 10, 8);
    if (tStop === null && i > 10 && b.getLinearVelocity().length() < 0.1) tStop = i * DT;
  }
  return { dist: b.getPosition().x, tStop, asleep: !b.isAwake() };
}
for (const v0 of [5, 12]) {
  for (const angDamp of [0, 0.5, 1, 2, 4, 8]) {
    const r = rollTest({ v0, angDamp });
    rows.push({ mode: 'angularDamping', value: angDamp, v0, rollDist_m: fmt(r.dist, 1), tStop_s: r.tStop ? fmt(r.tStop, 2) : '>20', asleep20s: r.asleep });
  }
  for (const rr of [0.1, 0.2, 0.3, 0.5]) {
    const r = rollTest({ v0, rr });
    rows.push({ mode: 'rollingResistance mu_r', value: rr, v0, rollDist_m: fmt(r.dist, 1), tStop_s: r.tStop ? fmt(r.tStop, 2) : '>20', asleep20s: r.asleep });
  }
}
console.log('### F1: circle r=0.45 rolling on ground (pure rolling start)');
console.log(table(rows));
const rows2 = [];
for (const [mode, o] of [['none', {}], ['angDamp 1', { angDamp: 1 }], ['angDamp 2', { angDamp: 2 }], ['angDamp 3', { angDamp: 3 }], ['rr 0.2', { rr: 0.2 }], ['rr 0.3', { rr: 0.3 }], ['angDamp 1 + rr 0.2', { angDamp: 1, rr: 0.2 }]]) {
  const r = rollTest({ v0: 20, landing: true, ...o });
  rows2.push({ mode, 'landing @20 m/s, -34deg: x_stop_m': fmt(r.dist, 1), tStop_s: r.tStop ? fmt(r.tStop, 2) : '>20' });
}
console.log('\n### F2: bird lands from flight (x=0,y=3, v=20 m/s at -34 deg)');
console.log(table(rows2));
