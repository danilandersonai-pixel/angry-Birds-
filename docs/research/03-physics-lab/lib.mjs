// Shared helpers for physics experiments (planck 1.5.1)
import * as planck from 'planck';
export const { World, Vec2, Box, Circle, Edge, Polygon } = planck;
export { planck };

export const DT = 1 / 60;

export function makeWorld({ g = -15, allowSleep = true } = {}) {
  const world = new World({ gravity: { x: 0, y: g }, allowSleep });
  return world;
}

// Ground: thick static box, top surface at y=0
export function addGround(world, { friction = 0.8, restitution = 0, x0 = -100, x1 = 300 } = {}) {
  const ground = world.createBody({ type: 'static', position: { x: (x0 + x1) / 2, y: -1 } });
  ground.createFixture({ shape: new Box((x1 - x0) / 2, 1), friction, restitution, density: 0 });
  ground.setUserData({ kind: 'ground' });
  return ground;
}

export function addBox(world, { x, y, w, h, angle = 0, density = 1, friction = 0.6, restitution = 0, kind = 'block', bullet = false, linearDamping = 0, angularDamping = 0 }) {
  const b = world.createBody({ type: 'dynamic', position: { x, y }, angle, bullet, linearDamping, angularDamping });
  b.createFixture({ shape: new Box(w / 2, h / 2), density, friction, restitution });
  b.setUserData({ kind, w, h, x0: x, y0: y, a0: angle });
  return b;
}

export function addCircle(world, { x, y, r, density = 1, friction = 0.6, restitution = 0, kind = 'ball', bullet = false, linearDamping = 0, angularDamping = 0 }) {
  const b = world.createBody({ type: 'dynamic', position: { x, y }, bullet, linearDamping, angularDamping });
  b.createFixture({ shape: new Circle(r), density, friction, restitution });
  b.setUserData({ kind, r, x0: x, y0: y, a0: 0 });
  return b;
}

export function dynBodies(world) {
  const out = [];
  for (let b = world.getBodyList(); b; b = b.getNext()) if (b.isDynamic()) out.push(b);
  return out;
}

export function displacement(b) {
  const u = b.getUserData();
  const p = b.getPosition();
  return Math.hypot(p.x - u.x0, p.y - u.y0);
}

export function step(world, n = 1, vi = 8, pi = 3) {
  for (let i = 0; i < n; i++) world.step(DT, vi, pi);
}

export function fmt(n, d = 3) {
  if (n === undefined || n === null || Number.isNaN(n)) return '-';
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(d);
}

export function table(rows, cols) {
  cols = cols || Object.keys(rows[0]);
  const lines = [];
  lines.push('| ' + cols.join(' | ') + ' |');
  lines.push('|' + cols.map(() => '---').join('|') + '|');
  for (const r of rows) lines.push('| ' + cols.map((c) => r[c]).join(' | ') + ' |');
  return lines.join('\n');
}
