// E: tunnelling tests — dynamic vs dynamic, bullet flag
import { makeWorld, addGround, addBox, addCircle, DT, fmt, table } from './lib.mjs';
import { MAT, BIRD, PIG } from './expC_impulses.mjs';
const rows = [];
for (const thick of [0.1, 0.25, 0.5]) {
  for (const v of [20, 30, 45, 60]) {
    for (const bullet of [false, true]) {
      // bird vs a vertical plank (dynamic) — gravity off to isolate
      const w = makeWorld({ g: 0 });
      const plank = addBox(w, { x: 5, y: 0, w: thick, h: 2, ...MAT.wood });
      const bird = addCircle(w, { x: 0, y: 0, r: 0.45, ...BIRD, bullet });
      bird.setLinearVelocity({ x: v, y: 0 });
      for (let i = 0; i < 30; i++) w.step(DT, 10, 8);
      const passed = bird.getPosition().x > plank.getPosition().x + thick / 2 + 0.45 && plank.getLinearVelocity().x < 0.5;
      // small fast debris (0.5x0.25 shard) vs plank
      const w2 = makeWorld({ g: 0 });
      const plank2 = addBox(w2, { x: 5, y: 0, w: thick, h: 2, ...MAT.wood });
      const shard = addBox(w2, { x: 0, y: 0, w: 0.5, h: 0.25, ...MAT.wood, bullet });
      shard.setLinearVelocity({ x: v, y: 0 });
      for (let i = 0; i < 30; i++) w2.step(DT, 10, 8);
      const passed2 = shard.getPosition().x > plank2.getPosition().x && plank2.getLinearVelocity().x < 0.5;
      rows.push({ plankThickness: thick, v, 'step dx': fmt(v * DT, 2), bullet, 'bird r0.45 tunnels': passed ? 'YES' : 'no', 'shard 0.5x0.25 tunnels': passed2 ? 'YES' : 'no' });
    }
  }
}
console.log('### E1: tunnelling through a dynamic plank (gravity 0, 60 Hz)');
console.log(table(rows));
