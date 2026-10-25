// Experiment 1: construction rules. For each micro-structure: pre-settle, wake all, damage ON, 10 s; plus gravity-tilt robustness.
// node docs/research/06-levels-lab/exp1_rules.mjs
import { stabilityTest } from './engine.mjs';
import { B, frame, tower, hut, pyramid, stack, pier, cradledBall, pigOn, flatGround, plateau } from './prefabs.mjs';

const L = (blocks, pigs = [], terrain = [flatGround()]) => ({ id: 'test', birds: [], slingshot: { x: 0, y: 2.7 }, bounds: { minX: -20, maxX: 80, maxY: 40 }, terrain, blocks, pigs });
const f3 = (v) => (v === null || v === undefined ? '-' : (+v).toFixed(3));
function row(name, lvl, extra = {}) {
  const s = stabilityTest(lvl, extra);
  const t0 = s.preDisp < 0.03 && s.preVmax < 0.5;
  const ok = t0 && s.maxBlockDisp < 0.05 && s.maxRot < 2 && s.pigsLost === 0 && s.blocksLost === 0 && s.maxPigDisp < 0.1;
  console.log(`| ${name} | ${f3(s.preDisp)} / ${s.preVmax.toFixed(2)} | ${f3(s.maxBlockDisp)} | ${s.maxRot.toFixed(2)} | ${f3(s.maxPigDisp)} | ${(s.hpLoss * 100).toFixed(1)}% | ${s.pigsLost}/${s.blocksLost} | ${ok ? 'OK' : (t0 ? 'FAIL T1' : 'FAIL T0')} |`);
  return { ...s, ok };
}
const head = (t) => { console.log(`\n### ${t}\n| case | T0: pre-settle disp, m / vmax, m/s | T1: max block disp, m | max rot, deg | max pig disp, m | max HP loss | pigs/blocks lost | verdict |\n|---|---|---|---|---|---|---|---|`); };

// R1 cantilever: beam 4x0.5 on ONE column, beam centre offset o from column axis
head('R1 cantilever: beam 4x0.5 (wood) on single column 0.5x2, beam centre offset o');
for (const o of [0, 0.1, 0.15, 0.2, 0.23, 0.26, 0.3]) row(`o=${o}`, L([B('wood', 'rect', 20, 1, 0.5, 2), B('wood', 'rect', 20 + o, 2.25, 4, 0.5)]));

// R2 overhang with a load: frame with right column moved inward; large pig at right beam end
head('R2 overhang: beam 4x0.5 on 2 columns, right column inset by ov; large pig at beam right end');
for (const ov of [0, 0.5, 1.0, 1.25, 1.5]) {
  const bl = [B('wood', 'rect', 18.25, 1, 0.5, 2), B('wood', 'rect', 21.75 - ov, 1, 0.5, 2), B('wood', 'rect', 20, 2.25, 4, 0.5)];
  row(`ov=${ov}`, L(bl, [pigOn('large', 21.0, 2.5)]));
}
head('R2b overhang with stone beam 4x0.5 and medium pig at the very end (x = end - 0.6)');
for (const ov of [0.5, 1.0, 1.5, 2.0]) {
  const bl = [B('wood', 'rect', 18.25, 1, 0.5, 2), B('wood', 'rect', 21.75 - ov, 1, 0.5, 2), B('stone', 'rect', 20, 2.25, 4, 0.5)];
  row(`ov=${ov}`, L(bl, [pigOn('medium', 21.4, 2.5)]));
}

// R3 pig on narrow top / near edges
head('R3 pig on top of a single column 0.5x2 (offset dx from axis)');
for (const [t, dx] of [['small', 0], ['small', 0.02], ['small', 0.1], ['medium', 0], ['medium', 0.02], ['medium', 0.1], ['large', 0]]) row(`${t} dx=${dx}`, L([B('wood', 'rect', 20, 1, 0.5, 2)], [pigOn(t, 20 + dx, 2)]));
head('R3b pig on frame top (beam 4x0.5) at different x');
for (const dx of [0, 1.0, 1.5]) { const f = frame({ x: 20 }); row(`medium dx=${dx}`, L(f.blocks, [pigOn('medium', 20 + dx, f.top)])); }
{ // asymmetric support: left column stone, right column ice, beam wood
  const f = frame({ x: 20 }); f.blocks[0].material = 'stone'; f.blocks[1].material = 'ice';
  row('medium on beam, stone|ice columns', L(f.blocks, [pigOn('medium', 20, f.top)]));
  const g = frame({ x: 20, h: 2 }); const bl = [...g.blocks, B('wood', 'rect', 26, 0.5, 1, 1)];
  row('medium on top of 3-floor tower', L(tower({ x: 20, floors: 3 }).blocks, [pigOn('medium', 20, 7.5)]));
}

// R4 circles
head('R4 ball (stone d=1) placement');
{ const f = frame({ x: 20 }); row('ball on beam centre', L([...f.blocks, B('stone', 'circle', 20, f.top + 0.5, 1, 1)])); }
{ const f = frame({ x: 20 }); row('ball on beam, dx=1.0', L([...f.blocks, B('stone', 'circle', 21, f.top + 0.5, 1, 1)])); }
row('ball on ground', L([B('stone', 'circle', 20, 0.5, 1, 1)]));
{ const f = frame({ x: 20 }); const c = cradledBall({ x: 20, y: f.top }); row('ball on beam + 2 stoppers (clearance 0.05)', L([...f.blocks, ...c.blocks])); }
{ const f = frame({ x: 20 }); f.blocks[0].material = 'stone'; f.blocks[1].material = 'ice'; row('ball on beam, stone|ice columns', L([...f.blocks, B('stone', 'circle', 20, f.top + 0.5, 1, 1)])); }

// R5 slopes: static wedge with angle a; objects placed on the slope surface
function wedge(a, x0 = 15, len = 12) { const t = Math.tan((a * Math.PI) / 180); return { kind: 'rock', points: [[x0, 0], [x0 + len, 0], [x0 + len, len * t]] }; }
function onSlope(a, x, w, h, mat, shape = 'rect') {
  const t = (a * Math.PI) / 180, x0 = 15; const sx = x, sy = (x - x0) * Math.tan(t);
  const nx = -Math.sin(t), ny = Math.cos(t);
  return B(mat, shape, sx + nx * h / 2, sy + ny * h / 2, w, h, t);
}
head('R5 objects on a static slope (rock, mu 0.9): slide / tip / roll');
for (const a of [10, 20, 25, 30, 35]) {
  row(`a=${a} wood 1x1`, L([onSlope(a, 20, 1, 1, 'wood')], [], [flatGround(), wedge(a)]));
  row(`a=${a} ice 1x1`, L([onSlope(a, 20, 1, 1, 'ice')], [], [flatGround(), wedge(a)]));
}
for (const a of [8, 12, 13, 15, 16]) row(`a=${a} column 0.5x2 standing`, L([onSlope(a, 20, 0.5, 2, 'wood')], [], [flatGround(), wedge(a)]));
for (const a of [1, 3, 5]) { const t = (a * Math.PI) / 180; const r = 0.6075; row(`a=${a} medium pig on slope`, L([], [{ type: 'medium', x: 20 - Math.sin(t) * r, y: 5 * Math.tan(t) + Math.cos(t) * r }], [flatGround(), wedge(a)])); }

// R6 placement errors
head('R6 placement errors (visual sizes; collision INSET 0.0075 applied by engine)');
row('2 cubes 1x1 side by side, gap 0', L([B('wood', 'rect', 20, 0.5, 1, 1), B('wood', 'rect', 21, 0.5, 1, 1)]));
row('2 cubes 1x1, overlap 0.05', L([B('wood', 'rect', 20, 0.5, 1, 1), B('wood', 'rect', 20.95, 0.5, 1, 1)]));
row('2 cubes 1x1, overlap 0.15', L([B('wood', 'rect', 20, 0.5, 1, 1), B('wood', 'rect', 20.85, 0.5, 1, 1)]));
row('beam sunk 0.03 into columns', L([B('wood', 'rect', 18.25, 1, 0.5, 2), B('wood', 'rect', 21.75, 1, 0.5, 2), B('wood', 'rect', 20, 2.22, 4, 0.5)]));
row('beam floating 0.05 above columns', L([B('wood', 'rect', 18.25, 1, 0.5, 2), B('wood', 'rect', 21.75, 1, 0.5, 2), B('wood', 'rect', 20, 2.30, 4, 0.5)]));
row('beam floating 0.20 above columns', L([B('wood', 'rect', 18.25, 1, 0.5, 2), B('wood', 'rect', 21.75, 1, 0.5, 2), B('wood', 'rect', 20, 2.45, 4, 0.5)]));
row('pig sunk 0.05 into beam', L(frame({ x: 20 }).blocks, [{ type: 'medium', x: 20, y: 2.5 + 0.6075 - 0.05 }]));
row('pig 0.1 above beam', L(frame({ x: 20 }).blocks, [{ type: 'medium', x: 20, y: 2.5 + 0.6075 + 0.1 }]));

// R7 slenderness
head('R7 slenderness (awake 10 s)');
for (const n of [2, 3, 4, 5]) row(`stack of ${n} columns 0.5x2 (h=${2 * n} m)`, L(stack({ x: 20, n, w: 0.5, h: 2 }).blocks));
for (const n of [6, 10, 14]) row(`stack of ${n} squares 1x1`, L(stack({ x: 20, n }).blocks));
for (const n of [3, 5, 7]) row(`tower ${n} floors (frames 4x2.5)`, L(tower({ x: 20, floors: n }).blocks));
for (const n of [4, 6]) row(`tower ${n} floors, stone beams on wood cols`, L(tower({ x: 20, floors: n, mats: { col: 'wood', beam: 'stone' } }).blocks));

// R8 roofs
head('R8 roofs and triangles');
row('hut wood + iso roof 4x1.5', L(hut({ x: 20 }).blocks, [pigOn('small', 20, 0)]));
row('hut stone roof 4x1.5 on wood', L(hut({ x: 20, roofMat: 'stone' }).blocks, [pigOn('small', 20, 0)]));
{ const f = frame({ x: 20 }); row('2 right triangles 2x2 as roof', L([...f.blocks, B('wood', 'triangleR', 19, f.top + 1, 2, 2), B('wood', 'triangle', 21, f.top + 1, 2, 2)])); }
{ const f = frame({ x: 20 }); row('iso 2x1 on each beam end + pig between', L([...f.blocks, B('ice', 'isoTriangle', 18.75, f.top + 0.5, 1.5, 1), B('ice', 'isoTriangle', 21.25, f.top + 0.5, 1.5, 1)], [pigOn('small', 20, f.top)])); }
row('iso 4x1.5 on single column (balanced)', L([B('wood', 'rect', 20, 1, 0.5, 2), B('wood', 'isoTriangle', 20, 2.75, 4, 1.5)]));

// R9 bridges
head('R9 bridge plank 5x0.5 across a gap between two static plateaus (top y=3), large pig at mid-span');
for (const bear of [0.25, 0.5, 1.0]) {
  const gap = 5 - 2 * bear; const xl = 20 - gap / 2, xr = 20 + gap / 2;
  row(`bearing ${bear} m each side (gap ${gap})`, L([B('wood', 'rect', 20, 3.25, 5, 0.5)], [pigOn('large', 20, 3.5)], [flatGround(), plateau(xl - 6, xl, 3), plateau(xr, xr + 6, 3)]));
}
for (const mat of ['ice', 'stone']) row(`${mat} plank, bearing 0.5`, L([B(mat, 'rect', 20, 3.25, 5, 0.5)], [pigOn('large', 20, 3.5)], [flatGround(), plateau(12, 18, 3), plateau(22, 28, 3)]));
row('pier: 3 beams 4x0.5 on 4 piles (joint bearing 0.25)', L(pier({ x0: 16, n: 3 }).blocks, [pigOn('medium', 18, 2.5), pigOn('medium', 22, 2.5), pigOn('medium', 26, 2.5)]));

// R10 mass ratio
head('R10 heavy on light');
row('stone slab 4x1 (8.8 kg) on 2 ice cubes 0.5 (0.225 kg) ratio 39', L([B('ice', 'rect', 18.5, 0.25, 0.5, 0.5), B('ice', 'rect', 21.5, 0.25, 0.5, 0.5), B('stone', 'rect', 20, 1, 4, 1)]));
row('stone beam 4x0.5 on ice columns 0.5x2 (ratio 4.9)', L([B('ice', 'rect', 18.25, 1, 0.5, 2), B('ice', 'rect', 21.75, 1, 0.5, 2), B('stone', 'rect', 20, 2.25, 4, 0.5)]));
row('stone 2x2 (8.8 kg) on wood plank 2x0.5 on ice cube', L([B('ice', 'rect', 20, 0.25, 0.5, 0.5), B('wood', 'rect', 20, 0.75, 2, 0.5), B('stone', 'rect', 20, 2, 2, 2)]));
row('pyramid 5 rows of 1x1 wood', L(pyramid({ x: 20, rows: 5 }).blocks));

// R11 robustness: gravity tilt for 2 s, then 6 s normal gravity
console.log('\n### R11 robustness: gravity tilted by +/-a for 2 s (toward/away from slingshot), then 6 s normal');
console.log('| structure | a=1 | a=2 | a=4 | a=6 | a=8 |\n|---|---|---|---|---|---|');
const structs = {
  'frame 4x2.5 wood': () => L(frame({ x: 20 }).blocks),
  'tower 3 floors': () => L(tower({ x: 20, floors: 3 }).blocks),
  'tower 5 floors': () => L(tower({ x: 20, floors: 5 }).blocks),
  'stack 4 columns (8 m)': () => L(stack({ x: 20, n: 4, w: 0.5, h: 2 }).blocks),
  'stack 10 squares 1x1': () => L(stack({ x: 20, n: 10 }).blocks),
  'pyramid 5': () => L(pyramid({ x: 20, rows: 5 }).blocks),
  'hut + small pig inside': () => L(hut({ x: 20 }).blocks, [pigOn('small', 20, 0)]),
  'frame + medium pig on top': () => L(frame({ x: 20 }).blocks, [pigOn('medium', 20, 2.5)]),
  'column + small pig on top': () => L([B('wood', 'rect', 20, 1, 0.5, 2)], [pigOn('small', 20, 2)]),
  'frame + ball on top': () => L([...frame({ x: 20 }).blocks, B('stone', 'circle', 20, 3, 1, 1)]),
  'frame + cradled ball': () => L([...frame({ x: 20 }).blocks, ...cradledBall({ x: 20, y: 2.5 }).blocks]),
  'cantilever o=0.15': () => L([B('wood', 'rect', 20, 1, 0.5, 2), B('wood', 'rect', 20.15, 2.25, 4, 0.5)]),
};
for (const [name, mk] of Object.entries(structs)) {
  const cells = [];
  for (const a of [1, 2, 4, 6, 8]) {
    const s1 = stabilityTest(mk(), { seconds: 8, tiltDeg: a, tiltSeconds: 2 });
    const s2 = stabilityTest(mk(), { seconds: 8, tiltDeg: -a, tiltSeconds: 2 });
    const bad = (s) => s.blocksLost > 0 || s.pigsLost > 0 || s.maxBlockDisp > 0.25 || s.maxRot > 10 || s.pigDrop > 0.3;
    const b1 = bad(s1), b2 = bad(s2);
    cells.push(b1 || b2 ? `FAIL (${Math.max(s1.maxBlockDisp, s2.maxBlockDisp).toFixed(2)}/${Math.max(s1.maxPigDisp, s2.maxPigDisp).toFixed(2)})` : `ok (${Math.max(s1.maxBlockDisp, s2.maxBlockDisp).toFixed(2)}/${Math.max(s1.maxPigDisp, s2.maxPigDisp).toFixed(2)})`);
  }
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}
