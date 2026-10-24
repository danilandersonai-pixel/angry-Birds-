import { makeWorld, addCircle, DT, fmt } from './lib.mjs';
const g = -15, v = 24, a = 40 * Math.PI / 180;
const w = makeWorld({ g });
const b = addCircle(w, { x: 0, y: 2.5, r: 0.45, density: 2.5, bullet: true });
b.setLinearVelocity({ x: v * Math.cos(a), y: v * Math.sin(a) });
let maxErrExact = 0, maxErrAnalytic = 0;
for (let n = 1; n <= 150; n++) {
  w.step(DT);
  const p = b.getPosition();
  const xe = n * DT * v * Math.cos(a);
  const ye = 2.5 + n * DT * v * Math.sin(a) + DT * DT * g * n * (n + 1) / 2;   // semi-implicit Euler closed form
  const t = n * DT;
  const ya = 2.5 + v * Math.sin(a) * t + 0.5 * g * t * t;                      // continuous parabola
  maxErrExact = Math.max(maxErrExact, Math.hypot(p.x - xe, p.y - ye));
  maxErrAnalytic = Math.max(maxErrAnalytic, Math.abs(p.y - ya));
}
console.log(`prediction error over 2.5 s: discrete closed form = ${maxErrExact.toExponential(2)} m, continuous parabola = ${fmt(maxErrAnalytic, 3)} m`);
