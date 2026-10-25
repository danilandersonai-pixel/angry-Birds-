import { makeWorld, addGround, addBox, DT } from './lib.mjs';
const w = makeWorld({ g: -15 }); addGround(w);
const b = addBox(w, { x: 0, y: 3, w: 1, h: 1 });
let res = 'n/a', locked = null, queued = false;
w.on('begin-contact', (c) => {
  locked = w.isLocked();
  res = w.destroyBody(b);           // silently ignored while locked
  w.queueUpdate(() => { w.destroyBody(b); queued = true; });  // runs right after step
});
let n = 0; while (res === 'n/a' && n < 200) { w.step(DT); n++; }
console.log(`inside callback: isLocked=${locked}, destroyBody returned ${res}; after step: queued ran=${queued}, bodyCount=${w.getBodyCount()} (ground only = 1)`);
// createBody inside callback
const w2 = makeWorld({ g: -15 }); addGround(w2); addBox(w2, { x: 0, y: 3, w: 1, h: 1 });
let created = 'n/a';
w2.on('begin-contact', () => { if (created === 'n/a') created = w2.createBody({ type: 'dynamic' }); });
for (let i = 0; i < 200 && created === 'n/a'; i++) w2.step(DT);
console.log('createBody inside callback returned:', created);
