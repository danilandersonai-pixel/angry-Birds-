// pig on a slightly tilted static plank: does it ever sleep? angularDamping vs rolling resistance
import { World, Box, Circle, DT, fmt, table } from './lib.mjs';
const rows = [];
for (const slopeDeg of [0.5, 1, 2, 4, 8]) {
  for (const [mode, ad, rr] of [['angDamp 3', 3, 0], ['angDamp 3 + rr 0.03', 3, 0.03], ['angDamp 3 + rr 0.06', 3, 0.06], ['angDamp 3 + rr 0.1', 3, 0.1]]) {
    const w = new World({ gravity: { x: 0, y: -15 } });
    const th = -slopeDeg * Math.PI / 180;
    const plank = w.createBody({ type: 'static', position: { x: 0, y: 0 }, angle: th });
    plank.createFixture({ shape: new Box(10, 0.25), friction: 0.7 });
    const r = 0.45;
    const n = { x: -Math.sin(th), y: Math.cos(th) };
    const pig = w.createBody({ type: 'dynamic', position: { x: n.x * (0.25 + r + 0.005), y: n.y * (0.25 + r + 0.005) }, angularDamping: ad, linearDamping: 0.1 });
    pig.createFixture({ shape: new Circle(r), density: 0.6, friction: 0.6, restitution: 0.15 });
    let sleepT = null;
    for (let i = 1; i <= 900; i++) {
      if (rr > 0) {
        let touching = false;
        for (let ce = pig.getContactList(); ce; ce = ce.next) if (ce.contact.isTouching()) { touching = true; break; }
        if (touching) {
          const wv = pig.getAngularVelocity();
          const dw = Math.min(Math.abs(wv), (rr * 15 / r) * DT);
          pig.setAngularVelocity(wv - Math.sign(wv) * dw);
        }
      }
      w.step(DT, 10, 8);
      if (sleepT === null && !pig.isAwake()) sleepT = i * DT;
    }
    rows.push({ slopeDeg, mode, 'rolled in 15 s_m': fmt(Math.hypot(pig.getPosition().x - n.x * 0.7, pig.getPosition().y - n.y * 0.7), 2), 'v@15s': fmt(pig.getLinearVelocity().length(), 3), sleep_s: sleepT ? fmt(sleepT, 2) : 'never' });
  }
}
console.log('### F5: pig r=0.45 on tilted static plank');
console.log(table(rows));
