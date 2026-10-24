import { makeWorld, addGround, addCircle, DT, fmt, table } from './lib.mjs';
const rows = [];
for (const [ld, ad] of [[0, 0], [0.5, 3], [1, 4], [1.5, 4], [2, 6], [3, 6]]) {
  for (const [v, deg] of [[20, -34], [24, -20], [12, -45]]) {
    const w = makeWorld({ g: -15 });
    addGround(w, { friction: 0.9 });
    const b = addCircle(w, { x: 0, y: 3, r: 0.45, density: 2.5, friction: 0.6, restitution: 0.3, bullet: true });
    const a = deg * Math.PI / 180;
    b.setLinearVelocity({ x: v * Math.cos(a), y: v * Math.sin(a) });
    let hitX = null, hitT = null, stopT = null;
    w.on('begin-contact', () => { if (hitX === null) { hitX = 'pending'; } });
    for (let i = 1; i <= 1200; i++) {
      w.step(DT, 10, 8);
      if (hitX === 'pending') { hitX = b.getPosition().x; hitT = i * DT; b.setLinearDamping(ld); b.setAngularDamping(ad); }
      if (hitT !== null && stopT === null && b.getLinearVelocity().length() < 0.15) stopT = i * DT;
    }
    rows.push({ 'post-impact linDamp': ld, angDamp: ad, impact: `${v} m/s @${deg}deg`, 'slide after impact_m': fmt(b.getPosition().x - hitX, 1), 'stop after impact_s': stopT ? fmt(stopT - hitT, 2) : '>20' });
  }
}
console.log('### F3: bird damping switched on at first contact');
console.log(table(rows));
const rows2 = [];
for (const ad of [0, 1, 2, 3, 5]) {
  for (const v of [3, 6]) {
    const w = makeWorld({ g: -15 });
    addGround(w, { friction: 0.9 });
    const b = addCircle(w, { x: 0, y: 0.45, r: 0.45, density: 0.6, friction: 0.6, restitution: 0.15, angularDamping: ad, linearDamping: 0.1 });
    b.setLinearVelocity({ x: v, y: 0 }); b.setAngularVelocity(-v / 0.45);
    let stopT = null;
    for (let i = 1; i <= 1200; i++) { w.step(DT, 10, 8); if (stopT === null && b.getLinearVelocity().length() < 0.1) stopT = i * DT; }
    rows2.push({ pigAngularDamping: ad, linDamp: 0.1, v0: v, rollDist_m: fmt(b.getPosition().x, 1), tStop_s: stopT ? fmt(stopT, 2) : '>20' });
  }
}
console.log('\n### F4: pig r=0.45 (density 0.6) rolling');
console.log(table(rows2));
