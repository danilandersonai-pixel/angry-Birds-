// Experiment A: stability of typical structures without external action
import { makeWorld, addGround, addBox, dynBodies, displacement, DT, fmt, table } from './lib.mjs';

// gap: vertical gap inserted between stacked pieces at build time
export function buildTower(world, { floors = 4, cx = 30, gap = 0.015, colMat, beamMat }) {
  let y = 0;
  for (let i = 0; i < floors; i++) {
    y += gap;
    addBox(world, { x: cx - 1.75, y: y + 1, w: 0.5, h: 2, ...colMat });
    addBox(world, { x: cx + 1.75, y: y + 1, w: 0.5, h: 2, ...colMat });
    y += 2 + gap;
    addBox(world, { x: cx, y: y + 0.25, w: 4, h: 0.5, ...beamMat });
    y += 0.5;
  }
}

export function buildPyramid(world, { base = 5, cx = 30, gap = 0.015, mat }) {
  let y = 0;
  for (let row = 0; row < base; row++) {
    const n = base - row;
    y += gap;
    for (let k = 0; k < n; k++) {
      // horizontal gap of 0.02 between neighbours (they should not be pressed together)
      const x = cx - (n - 1) * 0.51 + k * 1.02;
      addBox(world, { x, y: y + 0.5, w: 1, h: 1, ...mat });
    }
    y += 1;
  }
}

export function buildStack(world, { n = 10, cx = 30, gap = 0.015, mat }) {
  let y = 0;
  for (let i = 0; i < n; i++) {
    y += gap;
    addBox(world, { x: cx, y: y + 0.5, w: 1, h: 1, ...mat });
    y += 1;
  }
}

export function runStability({ build, g = -15, vi = 8, pi = 3, T = 10, allowSleep = true, groundFriction = 0.8, groundRest = 0 }) {
  const world = makeWorld({ g, allowSleep });
  addGround(world, { friction: groundFriction, restitution: groundRest });
  build(world);
  const bodies = dynBodies(world);
  const n = Math.round(T / DT);
  let allAsleepAt = null;
  const awakeAt = {};
  let maxSpeedAfter1s = 0;
  for (let i = 1; i <= n; i++) {
    world.step(DT, vi, pi);
    const t = i * DT;
    const awake = bodies.filter((b) => b.isAwake()).length;
    if (allAsleepAt === null && awake === 0) allAsleepAt = t;
    if (i === 60 || i === 180 || i === 600) awakeAt[i / 60] = awake;
    if (t > 1) for (const b of bodies) maxSpeedAfter1s = Math.max(maxSpeedAfter1s, b.getLinearVelocity().length());
  }
  let maxDisp = 0, sumDisp = 0, maxRot = 0, fallen = 0;
  for (const b of bodies) {
    const d = displacement(b);
    maxDisp = Math.max(maxDisp, d);
    sumDisp += d;
    const rot = Math.abs(b.getAngle() - b.getUserData().a0) * 180 / Math.PI;
    maxRot = Math.max(maxRot, rot);
    if (d > 0.25 || rot > 10) fallen++;
  }
  return { maxDisp, meanDisp: sumDisp / bodies.length, maxRot, fallen, n: bodies.length, allAsleepAt, awakeAt, maxSpeedAfter1s };
}

const WOOD = { density: 0.6, friction: 0.7, restitution: 0.05 };

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = [];
  const structs = {
    tower4: (m) => (w) => buildTower(w, { floors: 4, colMat: m, beamMat: m }),
    tower3: (m) => (w) => buildTower(w, { floors: 3, colMat: m, beamMat: m }),
    pyramid5: (m) => (w) => buildPyramid(w, { base: 5, mat: m }),
    stack10: (m) => (w) => buildStack(w, { n: 10, mat: m }),
  };
  // 1) iterations sweep (wood, f=0.7, e=0.05)
  for (const [name, mk] of Object.entries(structs)) {
    for (const [vi, pi] of [[8, 3], [10, 8], [20, 10], [30, 20]]) {
      const r = runStability({ build: mk(WOOD), vi, pi });
      rows.push({ struct: name, iters: `${vi}/${pi}`, maxDisp_mm: fmt(r.maxDisp * 1000, 1), meanDisp_mm: fmt(r.meanDisp * 1000, 1), maxRot_deg: fmt(r.maxRot, 2), fallen: `${r.fallen}/${r.n}`, awake_1s: r.awakeAt[1], awake_3s: r.awakeAt[3], allAsleep_s: r.allAsleepAt ? fmt(r.allAsleepAt, 2) : 'never' });
    }
  }
  console.log('### A1: iterations sweep (g=-15, wood d=0.6 f=0.7 e=0.05, gap=0.015)');
  console.log(table(rows));

  // 2) friction / restitution sweep with 10/8 iterations
  const rows2 = [];
  for (const [name, mk] of Object.entries(structs)) {
    for (const friction of [0.2, 0.5, 0.8, 1.0]) {
      for (const restitution of [0, 0.1, 0.3]) {
        const r = runStability({ build: mk({ density: 0.6, friction, restitution }), vi: 10, pi: 8 });
        rows2.push({ struct: name, friction, restitution, maxDisp_mm: fmt(r.maxDisp * 1000, 1), maxRot_deg: fmt(r.maxRot, 2), fallen: `${r.fallen}/${r.n}`, allAsleep_s: r.allAsleepAt ? fmt(r.allAsleepAt, 2) : 'never' });
      }
    }
  }
  console.log('\n### A2: friction/restitution sweep (g=-15, iters 10/8)');
  console.log(table(rows2));

  // 3) build gap sweep
  const rows3 = [];
  for (const gap of [-0.01, 0, 0.015, 0.05, 0.2]) {
    for (const [name, mk] of [['tower4', (m) => (w) => buildTower(w, { floors: 4, gap, colMat: m, beamMat: m })], ['stack10', (m) => (w) => buildStack(w, { n: 10, gap, mat: m })]]) {
      const r = runStability({ build: mk(WOOD), vi: 10, pi: 8 });
      rows3.push({ struct: name, gap_m: gap, maxDisp_mm: fmt(r.maxDisp * 1000, 1), maxRot_deg: fmt(r.maxRot, 2), maxSpeed_after1s: fmt(r.maxSpeedAfter1s, 3), allAsleep_s: r.allAsleepAt ? fmt(r.allAsleepAt, 2) : 'never' });
    }
  }
  console.log('\n### A3: build gap sweep (wood, iters 10/8)');
  console.log(table(rows3));

  // 4) mixed density (mass ratio) and gravity
  const rows4 = [];
  const STONE = { density: 2.4, friction: 0.9, restitution: 0.02 };
  const ICE = { density: 0.9, friction: 0.15, restitution: 0.05 };
  const combos = {
    'wood cols + wood beams': [WOOD, WOOD],
    'wood cols + STONE beams': [WOOD, STONE],
    'ICE cols + stone beams': [ICE, STONE],
    'stone cols + ice beams': [STONE, ICE],
    'ice everywhere': [ICE, ICE],
  };
  for (const g of [-9.8, -15, -20]) {
    for (const [name, [c, bm]] of Object.entries(combos)) {
      for (const [vi, pi] of [[8, 3], [10, 8]]) {
        const r = runStability({ build: (w) => buildTower(w, { floors: 4, colMat: c, beamMat: bm }), g, vi, pi });
        rows4.push({ g, combo: name, iters: `${vi}/${pi}`, maxDisp_mm: fmt(r.maxDisp * 1000, 1), maxRot_deg: fmt(r.maxRot, 2), fallen: `${r.fallen}/${r.n}`, allAsleep_s: r.allAsleepAt ? fmt(r.allAsleepAt, 2) : 'never' });
      }
    }
  }
  console.log('\n### A4: mixed materials (tower4), gravity sweep');
  console.log(table(rows4));

  // 5) No sleeping: drift over 10s
  const rows5 = [];
  for (const [name, mk] of Object.entries(structs)) {
    for (const [vi, pi] of [[8, 3], [10, 8], [20, 10]]) {
      const r = runStability({ build: mk(WOOD), vi, pi, allowSleep: false });
      rows5.push({ struct: name, iters: `${vi}/${pi}`, maxDisp_mm: fmt(r.maxDisp * 1000, 1), maxRot_deg: fmt(r.maxRot, 2), maxSpeed_after1s: fmt(r.maxSpeedAfter1s, 4) });
    }
  }
  console.log('\n### A5: allowSleep=false drift over 10 s');
  console.log(table(rows5));
}
