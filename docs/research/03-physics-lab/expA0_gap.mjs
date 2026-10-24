import { makeWorld, addGround, addBox, addCircle, step, fmt } from './lib.mjs';
for (const g of [-9.8, -15, -20]) {
  for (const [vi, pi] of [[8,3],[10,8]]) {
    const w = makeWorld({ g });
    addGround(w);
    const a = addBox(w, { x: 0, y: 0.5 + 0.02, w: 1, h: 1, density: 0.6 });
    const b = addBox(w, { x: 0, y: 1.5 + 0.06, w: 1, h: 1, density: 0.6 });
    const c = addCircle(w, { x: 5, y: 0.45 + 0.05, r: 0.45, density: 0.8 });
    step(w, 300, vi, pi);
    const ya = a.getPosition().y, yb = b.getPosition().y, yc = c.getPosition().y;
    console.log(`g=${g} it=${vi}/${pi}: box-ground gap=${fmt((ya-0.5)*1000,2)}mm  box-box gap=${fmt((yb-ya-1)*1000,2)}mm  circle-ground gap=${fmt((yc-0.45)*1000,2)}mm  awake=${a.isAwake()},${b.isAwake()},${c.isAwake()}`);
  }
}
