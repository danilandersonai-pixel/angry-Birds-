// Headless mini-engine for level validation (planck 1.5.1). Mirrors the final model of docs/research/03-physics.md §3:
// g = -15, dt = 1/60, 10/8 iterations, INSET 0.0075, damage = mult * max(0, J - m*V0) gated by vn >= 0.5,
// pre-settle 90 steps without damage, explosions with linear falloff and dv cap, settle detector, forced sleep.
// Level input = LevelDef from src/core/types.ts (+ optional fields described in 06-levels.md §6).
// Run from repo root: node docs/research/06-levels-lab/<script>.mjs
import * as planck from 'planck';
const { World, Box, Circle, Polygon, Vec2, WorldManifold } = planck;

export const PHYS = { G: -15, DT: 1 / 60, VI: 10, PI: 8, INSET: 0.0075, PRESETTLE: 90, VGATE: 0.5, VMAX: 24, RMAX: 2.0 };
export const MAT = {
  wood:  { density: 0.7, friction: 0.7,  restitution: 0.05, V0: 1.5, hpk: 14, blast: 1.0,  pts: 280 },
  ice:   { density: 0.9, friction: 0.25, restitution: 0.05, V0: 1.5, hpk: 6,  blast: 1.25, pts: 140 },
  stone: { density: 2.2, friction: 0.9,  restitution: 0.02, V0: 2.5, hpk: 27, blast: 1.4,  pts: 420 },
  tnt:   { density: 0.8, friction: 0.6,  restitution: 0.05, V0: 1.5, hpk: 4,  blast: 1.0,  pts: 0 },
};
export const GROUND = { friction: 0.9, restitution: 0 };
export const PIG = { density: 0.8, friction: 0.6, restitution: 0.15, angularDamping: 3, linearDamping: 0.1, V0: 3.0, staticMult: 0.7 };
// helmet: extra flat armor HP (02 §4.2 simplified: 8 HP at ~75% share -> +10.7 effective)
export const PIG_TYPES = {
  small:    { r: 0.405,  k: 6, density: 0.8 },
  medium:   { r: 0.6075, k: 6, density: 0.8 },
  large:    { r: 0.8325, k: 7, density: 0.8, restitution: 0.12 },
  helmet:   { r: 0.63,   k: 6, density: 0.9, armor: 10.7, restitution: 0.12 },
  mustache: { r: 0.72,   k: 7, density: 0.85, restitution: 0.12 },
  king:     { r: 1.17,   k: 9, density: 0.8, restitution: 0.10 },
};
export const PIG_DMG_PTS = { small: 50, medium: 100, large: 200, helmet: 150, mustache: 300, king: 1000 };
export const BIRDS = {
  red:     { r: 0.45,  density: 2.0,  friction: 0.55, restitution: 0.32, ls: 1.0,  mult: { wood: 1.0, ice: 1.0, stone: 0.7, pig: 1.0, tnt: 1.0 } },
  blues:   { r: 0.252, density: 3.0,  friction: 0.50, restitution: 0.30, ls: 1.0,  mult: { wood: 0.5, ice: 2.6, stone: 0.3, pig: 0.5, tnt: 0.5 } },
  // Chuck is a triangle in 02; approximated by a circle of equal mass (1.15 kg) for validation purposes
  chuck:   { r: 0.45,  density: 1.81, friction: 0.45, restitution: 0.25, ls: 1.0,  mult: { wood: 1.2, ice: 0.6, stone: 0.4, pig: 1.0, tnt: 1.0 }, boostWood: 2.2 },
  bomb:    { r: 0.585, density: 1.9,  friction: 0.60, restitution: 0.20, ls: 0.95, mult: { wood: 0.9, ice: 0.8, stone: 1.0, pig: 1.0, tnt: 1.0 } },
  matilda: { r: 0.54,  density: 1.65, friction: 0.55, restitution: 0.30, ls: 0.97, mult: { wood: 0.7, ice: 0.7, stone: 0.5, pig: 0.8, tnt: 1.0 } },
  terence: { r: 0.80,  density: 2.5,  friction: 0.70, restitution: 0.15, ls: 0.88, mult: { wood: 1.6, ice: 1.6, stone: 1.6, pig: 1.5, tnt: 1.6 } },
};
export const BLAST = {
  bomb: { R: 3.5, J0: 30, dvMax: 20, D0: 100, spin: 0.15 },
  tnt:  { R: 3.0, J0: 25, dvMax: 18, D0: 80,  spin: 0.15 },
  egg:  { R: 2.5, J0: 20, dvMax: 16, D0: 70,  spin: 0.15 },
};
export const ANCHOR_DEFAULT = { x: 0, y: 2.7 };

// ---------- geometry helpers ----------
function insetPoly(pts, d) {
  // move every edge inward by d (scale about incentre for triangles, about centroid for others)
  const n = pts.length;
  let cx = 0, cy = 0;
  if (n === 3) {
    const [A, B, C] = pts;
    const a = Math.hypot(B.x - C.x, B.y - C.y), b = Math.hypot(A.x - C.x, A.y - C.y), c = Math.hypot(A.x - B.x, A.y - B.y);
    const p = a + b + c; cx = (a * A.x + b * B.x + c * C.x) / p; cy = (a * A.y + b * B.y + c * C.y) / p;
    const area = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / 2;
    const rho = (2 * area) / p; const s = 1 - d / rho;
    return pts.map((q) => ({ x: cx + (q.x - cx) * s, y: cy + (q.y - cy) * s }));
  }
  for (const q of pts) { cx += q.x / n; cy += q.y / n; }
  let minR = Infinity;
  for (const q of pts) minR = Math.min(minR, Math.hypot(q.x - cx, q.y - cy));
  const s = 1 - d / (0.7 * minR);
  return pts.map((q) => ({ x: cx + (q.x - cx) * s, y: cy + (q.y - cy) * s }));
}
export function shapeLocalPoints(shape, w, h) {
  if (shape === 'triangle') return [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: -w / 2, y: h / 2 }];
  if (shape === 'triangleR') return [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }]; // mirrored
  if (shape === 'isoTriangle') return [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: 0, y: h / 2 }];
  return [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
}
function shapeArea(shape, w, h) {
  if (shape === 'circle') return Math.PI * (w / 2) ** 2;
  if (shape === 'triangle' || shape === 'triangleR' || shape === 'isoTriangle') return (w * h) / 2;
  return w * h;
}
function isConvex(pts) {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], c = pts[(i + 2) % pts.length];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

// ---------- game ----------
export class Game {
  constructor(level, opts = {}) {
    this.level = level;
    this.opts = opts;
    this.world = new World({ gravity: Vec2(0, PHYS.G), allowSleep: true });
    this.entities = new Set();
    this.hits = new Map();
    this.wm = new WorldManifold();
    this.damageEnabled = false;
    this.score = 0; this.pending = 0;
    this.stepNo = 0; this.time = 0;
    this.events = [];
    this.timers = [];            // {at, fn}
    this.birdsLeft = (level.birds || []).slice();
    this.activeBirds = [];
    this.anchor = level.slingshot || ANCHOR_DEFAULT;
    const b = level.bounds || { minX: -15, maxX: 80, maxY: 40 };
    this.bounds = b;
    this.world.on('pre-solve', (c) => this.preSolve(c));
    this.world.on('post-solve', (c, imp) => this.postSolve(c, imp));
    this.build();
  }
  build() {
    const L = this.level;
    for (const t of L.terrain || []) this.addTerrain(t);
    for (const bl of L.blocks || []) this.addBlock(bl);
    for (const t of L.tnt || []) this.addBlock({ material: 'tnt', shape: 'rect', x: t.x, y: t.y, w: t.size || 1, h: t.size || 1, angle: t.angle || 0 });
    for (const p of L.pigs || []) this.addPig(p);
  }
  addTerrain(t) {
    const body = this.world.createBody({ type: 'static' });
    const pts = t.points;
    if (!isConvex(pts) || pts.length > 12) throw new Error('lab engine supports convex terrain polygons (<=12 vertices) only');
    const ins = insetPoly(pts.map(([x, y]) => ({ x, y })), PHYS.INSET);
    body.createFixture({ shape: new Polygon(ins.map((q) => Vec2(q.x, q.y))), friction: GROUND.friction, restitution: GROUND.restitution });
    const e = { kind: 'static', body, hp: Infinity }; body.setUserData(e); return e;
  }
  addBlock(bl) {
    const m = MAT[bl.material];
    const body = this.world.createBody({ type: 'dynamic', position: Vec2(bl.x, bl.y), angle: bl.angle || 0 });
    let shape;
    if (bl.shape === 'circle') shape = new Circle(bl.w / 2);
    else if (bl.shape === 'rect' || !bl.shape) shape = new Box(bl.w / 2 - PHYS.INSET, bl.h / 2 - PHYS.INSET);
    else shape = new Polygon(insetPoly(shapeLocalPoints(bl.shape, bl.w, bl.h), PHYS.INSET).map((q) => Vec2(q.x, q.y)));
    body.createFixture({ shape, density: m.density, friction: m.friction, restitution: m.restitution });
    const area = shapeArea(bl.shape || 'rect', bl.w, bl.h);
    const hp = m.hpk * m.density * area;
    const e = { kind: bl.material === 'tnt' ? 'tnt' : 'block', mat: bl.material, body, hp, maxHp: hp, area, size: bl.w, def: bl, x0: bl.x, y0: bl.y, a0: bl.angle || 0 };
    body.setUserData(e); this.entities.add(e); return e;
  }
  addPig(p) {
    const T = PIG_TYPES[p.type];
    const body = this.world.createBody({ type: 'dynamic', position: Vec2(p.x, p.y), angularDamping: PIG.angularDamping, linearDamping: PIG.linearDamping });
    body.createFixture({ shape: new Circle(T.r), density: T.density, friction: PIG.friction, restitution: T.restitution ?? PIG.restitution });
    const hp = T.k * body.getMass() + (T.armor || 0);
    const e = { kind: 'pig', mat: 'pig', type: p.type, body, hp, maxHp: hp, size: 2 * T.r, def: p, x0: p.x, y0: p.y, a0: 0 };
    body.setUserData(e); this.entities.add(e); return e;
  }
  pigsAlive() { let n = 0; for (const e of this.entities) if (e.kind === 'pig' && !e.dead) n++; return n; }

  // ----- contacts -----
  preSolve(c) {
    const fa = c.getFixtureA(), fb = c.getFixtureB();
    const a = fa.getBody(), b = fb.getBody();
    const ea = a.getUserData(), eb = b.getUserData();
    if (ea && eb && ea.kind === 'bird' && eb.kind === 'bird') { c.setEnabled(false); return; }
    if (!c.getManifold().pointCount) return;
    c.getWorldManifold(this.wm);
    let vmax = 0;
    for (let i = 0; i < c.getManifold().pointCount; i++) {
      const p = this.wm.points[i];
      const va = a.getLinearVelocityFromWorldPoint(p), vb = b.getLinearVelocityFromWorldPoint(p);
      vmax = Math.max(vmax, -((vb.x - va.x) * this.wm.normal.x + (vb.y - va.y) * this.wm.normal.y));
    }
    const h = this.hits.get(c);
    if (h) h.vn = Math.max(h.vn, vmax); else this.hits.set(c, { a: ea, b: eb, J: 0, vn: vmax });
  }
  postSolve(c, imp) {
    let J = 0; const ni = imp.normalImpulses;
    for (let i = 0; i < c.getManifold().pointCount; i++) J += ni[i];
    const h = this.hits.get(c);
    if (h) h.J += J; else this.hits.set(c, { a: c.getFixtureA().getBody().getUserData(), b: c.getFixtureB().getBody().getUserData(), J, vn: 0 });
  }
  dmgTo(T, S, J) {
    if (!T || T.dead || T.kind === 'static' || T.kind === 'bird' || T.kind === 'egg') return 0;
    const V0 = T.kind === 'pig' ? PIG.V0 : MAT[T.mat].V0;
    const J0 = T.body.getMass() * V0;
    let mult = 1;
    if (S && S.kind === 'bird') {
      const B = BIRDS[S.type];
      const key = T.kind === 'pig' ? 'pig' : T.mat;
      mult = B.mult[key] ?? 1;
      if (S.type === 'chuck' && S.boosted && key === 'wood') mult = B.boostWood;
    } else if ((!S || S.kind === 'static') && T.kind === 'pig') mult = PIG.staticMult;
    return mult * Math.max(0, J - J0);
  }
  applyDamage(T, d) {
    if (d <= 0 || T.dead) return;
    const applied = Math.min(d, T.hp);
    T.hp -= d;
    if (T.kind === 'block') this.addPts(MAT[T.mat].pts * T.area * (applied / T.maxHp));
    if (T.kind === 'pig') this.addPts(PIG_DMG_PTS[T.type] * (applied / T.maxHp));
    T.maxDmgSeen = Math.max(T.maxDmgSeen || 0, d);
  }
  addPts(p) { if (this.scoringLocked) return; this.pending += p; const whole = Math.floor(this.pending); this.score += whole; this.pending -= whole; }

  // ----- stepping -----
  step() {
    this.hits.clear();
    for (const bd of this.activeBirds) this.birdPreStep(bd);
    this.world.step(PHYS.DT, PHYS.VI, PHYS.PI);
    this.stepNo++; this.time = this.stepNo * PHYS.DT;
    for (const h of this.hits.values()) {
      for (const [T, S] of [[h.a, h.b], [h.b, h.a]]) {
        if (T && T.kind === 'bird' && h.J > 0 && !T.impacted) this.birdImpact(T);
        if (T && T.kind === 'egg' && h.J > 0 && !T.exploded) { T.exploded = true; this.timers.push({ at: this.time, fn: () => this.eggBlast(T) }); }
      }
      if (!this.damageEnabled || h.vn < PHYS.VGATE) continue;
      const dA = this.dmgTo(h.a, h.b, h.J), dB = this.dmgTo(h.b, h.a, h.J);
      if (dA > 0) this.applyDamage(h.a, dA);
      if (dB > 0) this.applyDamage(h.b, dB);
    }
    // timers (fuse, tnt chain)
    const due = this.timers.filter((t) => t.at <= this.time + 1e-9);
    this.timers = this.timers.filter((t) => t.at > this.time + 1e-9);
    for (const t of due) t.fn();
    this.cull();
    this.flushDead();
  }
  cull() {
    const b = this.bounds;
    for (const e of this.entities) {
      if (e.dead) continue;
      const p = e.body.getPosition();
      if (p.y < -10 || p.x < b.minX - 15 || p.x > b.maxX + 15) { e.hp = -1; e.culled = true; }
    }
  }
  flushDead() {
    const dead = [];
    for (const e of this.entities) if (!e.dead && e.hp <= 0) dead.push(e);
    for (const e of dead) {
      e.dead = true;
      const p = e.body.getPosition(); const pos = { x: p.x, y: p.y };
      if (e.kind === 'pig') { this.addPts(5000); this.events.push({ t: this.time, type: 'pig', x: pos.x, y: pos.y, culled: !!e.culled }); }
      else if (e.kind === 'block' || e.kind === 'tnt') { this.addPts(500); this.events.push({ t: this.time, type: 'block', mat: e.mat, x: pos.x, y: pos.y }); }
      // wake touching bodies before removal (spec §5)
      for (let ce = e.body.getContactList(); ce; ce = ce.next) ce.other.setAwake(true);
      this.world.destroyBody(e.body);
      this.entities.delete(e);
      if (e.kind === 'tnt') this.timers.push({ at: this.time + 0.12, fn: () => this.explode(pos, BLAST.tnt) });
    }
  }
  explode(c, P) {
    const seen = new Set();
    this.world.queryAABB({ lowerBound: Vec2(c.x - P.R, c.y - P.R), upperBound: Vec2(c.x + P.R, c.y + P.R) }, (fx) => { const bd = fx.getBody(); if (bd.isDynamic()) seen.add(bd); return true; });
    for (const bd of seen) {
      const e = bd.getUserData(); if (!e || e.dead) continue;
      const com = bd.getWorldCenter();
      let frac = 1, hit = false;
      for (let f = bd.getFixtureList(); f; f = f.getNext()) {
        const out = {};
        if (f.rayCast(out, { p1: Vec2(c.x, c.y), p2: com, maxFraction: 1 }, 0) && out.fraction < frac) { frac = out.fraction; hit = true; }
      }
      const dx = com.x - c.x, dy = com.y - c.y, dc = Math.hypot(dx, dy) || 1e-6;
      const d = hit ? dc * frac : 0;
      if (d > P.R) continue;
      const f = 1 - d / P.R;
      const m = bd.getMass();
      const J = Math.min(P.J0 * f, m * P.dvMax);
      bd.applyLinearImpulse(Vec2((dx / dc) * J, (dy / dc) * J), com, true);
      bd.applyAngularImpulse(-Math.sign(dx || 1) * P.spin * J * Math.min(1, (e.size || 1) / 2), true);
      if (e.kind === 'block' || e.kind === 'tnt') this.applyDamage(e, P.D0 * f * MAT[e.mat].blast);
      else if (e.kind === 'pig') this.applyDamage(e, P.D0 * f);
    }
    this.events.push({ t: this.time, type: 'blast', x: c.x, y: c.y });
  }

  // ----- birds -----
  launch(angleDeg, power, opts = {}) {
    const type = this.birdsLeft.shift();
    if (!type) throw new Error('no birds');
    const B = BIRDS[type];
    const th = (angleDeg * Math.PI) / 180, dir = { x: Math.cos(th), y: Math.sin(th) };
    const t = Math.max(0, Math.min(1, power));
    const A = this.anchor;
    const pos = { x: A.x - dir.x * t * PHYS.RMAX, y: A.y - dir.y * t * PHYS.RMAX };
    const sp = PHYS.VMAX * t * B.ls;
    const body = this.world.createBody({ type: 'dynamic', position: Vec2(pos.x, pos.y), bullet: true, angularDamping: 0.3 });
    body.createFixture({ shape: new Circle(B.r), density: B.density, friction: B.friction, restitution: B.restitution });
    body.setLinearVelocity(Vec2(dir.x * sp, dir.y * sp));
    const e = { kind: 'bird', type, body, hp: Infinity, impacted: false, launchT: this.time, tapAt: opts.tapAt ?? null, used: false, quiet: 0, size: 2 * B.r };
    body.setUserData(e); this.entities.add(e); this.activeBirds.push(e);
    this.damageEnabled = true;
    return e;
  }
  birdPreStep(bd) {
    if (bd.dead || bd.used || bd.tapAt === null) return;
    if (bd.impacted && bd.type !== 'bomb') return;
    if (this.time - bd.launchT >= bd.tapAt) this.ability(bd);
  }
  ability(bd) {
    bd.used = true;
    const v = bd.body.getLinearVelocity(), p = bd.body.getPosition();
    if (bd.type === 'chuck') {
      const s = Math.hypot(v.x, v.y) || 1, ns = Math.min(38.4, Math.max(31.2, 1.5 * s));
      bd.body.setLinearVelocity(Vec2((v.x / s) * ns, (v.y / s) * ns)); bd.boosted = true;
    } else if (bd.type === 'bomb') {
      this.killBird(bd); this.explode({ x: p.x, y: p.y }, BLAST.bomb);
    } else if (bd.type === 'blues') {
      const s = Math.hypot(v.x, v.y) || 1, nx = -v.y / s, ny = v.x / s;
      for (const k of [-1, 1]) {
        const a = 0.14 * k, ca = Math.cos(a), sa = Math.sin(a);
        const body = this.world.createBody({ type: 'dynamic', position: Vec2(p.x + nx * k * 0.58, p.y + ny * k * 0.58), bullet: true, angularDamping: 0.3 });
        const B = BIRDS.blues;
        body.createFixture({ shape: new Circle(B.r), density: B.density, friction: B.friction, restitution: B.restitution });
        body.setLinearVelocity(Vec2(v.x * ca - v.y * sa, v.x * sa + v.y * ca));
        const e = { kind: 'bird', type: 'blues', body, hp: Infinity, impacted: false, launchT: bd.launchT, tapAt: null, used: true, quiet: 0, size: 0.5 };
        body.setUserData(e); this.entities.add(e); this.activeBirds.push(e);
      }
    } else if (bd.type === 'matilda') {
      const body = this.world.createBody({ type: 'dynamic', position: Vec2(p.x, p.y - 0.8), bullet: true });
      body.createFixture({ shape: new Circle(0.225), density: 8, friction: 0.5, restitution: 0 });
      body.setLinearVelocity(Vec2(0, -0.7 * PHYS.VMAX));
      const egg = { kind: 'egg', body, hp: Infinity, size: 0.45 }; body.setUserData(egg); this.entities.add(egg);
      const s = Math.max(Math.hypot(v.x, v.y), 0.62 * PHYS.VMAX), a = (60 * Math.PI) / 180;
      bd.body.setLinearVelocity(Vec2(Math.sign(v.x || 1) * s * Math.cos(a), s * Math.sin(a)));
    }
  }
  eggBlast(egg) { if (egg.dead) return; const p = egg.body.getPosition(); const c = { x: p.x, y: p.y }; egg.dead = true; this.world.destroyBody(egg.body); this.entities.delete(egg); this.explode(c, BLAST.egg); }
  birdImpact(bd) {
    bd.impacted = true; bd.impactT = this.time;
    bd.body.setLinearDamping(1.5); bd.body.setAngularDamping(4);
    if (bd.type === 'bomb' && !bd.used) this.timers.push({ at: this.time + 2.5, fn: () => { if (!bd.dead && !bd.used) { bd.used = true; const p = bd.body.getPosition(); this.killBird(bd); this.explode({ x: p.x, y: p.y }, BLAST.bomb); } } });
    if (this.firstImpactT === undefined) this.firstImpactT = this.time;
  }
  killBird(bd) { if (bd.dead) return; bd.dead = true; this.world.destroyBody(bd.body); this.entities.delete(bd); }
  birdsRetireTick() {
    for (const bd of this.activeBirds) {
      if (bd.dead) continue;
      const v = bd.body.getLinearVelocity().length(), w = Math.abs(bd.body.getAngularVelocity());
      if (bd.impacted) {
        bd.quiet = v < 0.25 && w < 0.5 ? bd.quiet + 1 : 0;
        if ((bd.quiet >= 24 && this.time - bd.impactT >= 1.0) || this.time - bd.impactT >= 6) this.killBird(bd);
      } else if (this.time - bd.launchT >= 12) this.killBird(bd);
    }
    this.activeBirds = this.activeBirds.filter((b) => !b.dead);
  }
  quietWorld() {
    for (const e of this.entities) {
      const b = e.body; if (!b.isAwake() || !b.isDynamic()) continue;
      if (b.getLinearVelocity().length() > 0.10 || Math.abs(b.getAngularVelocity()) > 0.15) return false;
    }
    return true;
  }
  sleepAll() { for (const e of this.entities) if (e.body.isDynamic()) e.body.setAwake(false); }
  presettle() { this.damageEnabled = false; for (let i = 0; i < PHYS.PRESETTLE; i++) this.step(); this.sleepAll(); this.stepNo = 0; this.time = 0; this.score = 0; this.pending = 0; this.events = []; }

  /** One full turn: launch, simulate until bird retired + world settled (or timeouts). Returns summary. */
  shoot(angleDeg, power, opts = {}) {
    const pigs0 = this.pigsAlive(), score0 = this.score, t0 = this.time;
    this.firstImpactT = undefined;
    this.launch(angleDeg, power, opts);
    let quiet = 0;
    for (;;) {
      this.step(); this.birdsRetireTick();
      const sinceLaunch = this.time - t0;
      const sinceImpact = this.firstImpactT === undefined ? null : this.time - this.firstImpactT;
      quiet = this.quietWorld() ? quiet + 1 : 0;
      const birdsDone = this.activeBirds.length === 0 && !this.entitiesHasEgg() && this.timers.length === 0;
      if (birdsDone && quiet >= 30) break;
      if (sinceImpact !== null && sinceImpact >= 8) break;
      if (sinceImpact === null && sinceLaunch >= 10) break;
      if (this.pigsAlive() === 0 && this.victoryT === undefined) this.victoryT = this.time;
      if (this.victoryT !== undefined && this.time - this.victoryT >= 3.5) break;
    }
    for (const bd of this.activeBirds) this.killBird(bd); this.activeBirds = [];
    this.sleepAll();
    return { killed: pigs0 - this.pigsAlive(), gained: this.score - score0, t: this.time - t0 };
  }
  entitiesHasEgg() { for (const e of this.entities) if (e.kind === 'egg') return true; return false; }
  finalScore() { return this.score + (this.pigsAlive() === 0 ? 10000 * this.birdsLeft.length : 0); }

  snapshotPose() {
    const m = new Map();
    for (const e of this.entities) { const p = e.body.getPosition(); m.set(e, { x: p.x, y: p.y, a: e.body.getAngle(), hp: e.hp }); }
    return m;
  }
}

/** Stability check.
 *  T0 authoring: pre-settle (90 steps, no damage); every body must stay within 0.03 m of its AUTHORED pose, vmax small.
 *  T1 awake: wake everything, damage ON, `seconds`; nothing may move/break.
 *  T2 tilt (optional): gravity rotated by tiltDeg for tiltSeconds, then normal gravity for the rest. */
export function stabilityTest(level, { seconds = 10, tiltDeg = 0, tiltSeconds = 0 } = {}) {
  const g = new Game(level);
  // T0: authored pose vs pose after pre-settle
  let preVmax = 0;
  g.damageEnabled = false;
  for (let i = 0; i < PHYS.PRESETTLE; i++) {
    g.step();
    for (const e of g.entities) preVmax = Math.max(preVmax, e.body.getLinearVelocity().length());
  }
  let preDisp = 0, preWorst = null;
  for (const e of g.entities) {
    if (e.x0 === undefined) continue;
    const p = e.body.getPosition();
    const d = Math.hypot(p.x - e.x0, p.y - e.y0);
    if (d > preDisp) { preDisp = d; preWorst = e.def; }
  }
  g.sleepAll(); g.stepNo = 0; g.time = 0; g.score = 0; g.pending = 0; g.events = [];
  const pose0 = g.snapshotPose();
  const nPig0 = g.pigsAlive(), nBlocks0 = [...g.entities].filter((e) => e.kind !== 'pig').length;
  g.damageEnabled = true;
  for (const e of g.entities) e.body.setAwake(true);
  const n = Math.round(seconds / PHYS.DT);
  const tiltN = Math.round(tiltSeconds / PHYS.DT);
  const th = (tiltDeg * Math.PI) / 180;
  let quietAt = null, q = 0;
  for (let i = 0; i < n; i++) {
    if (tiltN && i === 0) g.world.setGravity(Vec2(-PHYS.G * Math.sin(th), PHYS.G * Math.cos(th)));
    if (tiltN && i === tiltN) g.world.setGravity(Vec2(0, PHYS.G));
    g.step();
    q = g.quietWorld() ? q + 1 : 0;
    if (q >= 30 && quietAt === null && i >= tiltN) quietAt = (i + 1) * PHYS.DT;
  }
  let maxBlockDisp = 0, maxPigDisp = 0, maxRot = 0, hpLoss = 0, worst = null, pigDrop = 0;
  for (const [e, p0] of pose0) {
    if (e.dead) continue;
    const p = e.body.getPosition();
    const d = Math.hypot(p.x - p0.x, p.y - p0.y);
    const isRound = e.kind === 'pig' || (e.def && e.def.shape === 'circle');
    const rot = isRound ? 0 : Math.abs(e.body.getAngle() - p0.a) * 180 / Math.PI;
    if (e.kind === 'pig') { maxPigDisp = Math.max(maxPigDisp, d); pigDrop = Math.max(pigDrop, p0.y - p.y); }
    else if (d > maxBlockDisp) { maxBlockDisp = d; worst = e.def; }
    maxRot = Math.max(maxRot, rot);
    hpLoss = Math.max(hpLoss, (p0.hp - e.hp) / (e.maxHp || 1));
  }
  const pigsLost = nPig0 - g.pigsAlive();
  const blocksLost = nBlocks0 - [...g.entities].filter((e) => e.kind !== 'pig').length;
  return { preDisp, preVmax, preWorst, maxBlockDisp, maxPigDisp, pigDrop, maxRot, hpLoss, pigsLost, blocksLost, quietAt, worst };
}

/** Deterministic replay: build level, presettle, apply shots. */
export function replay(level, shots) {
  const g = new Game(level); g.presettle();
  const res = [];
  for (const s of shots) { if (!g.birdsLeft.length || g.pigsAlive() === 0) break; res.push(g.shoot(s.angle, s.power, { tapAt: s.tapAt ?? null })); }
  return { g, res };
}

export function defaultCandidates(type, { angles = [], powers = [], taps = null } = {}) {
  const A = angles.length ? angles : range(4, 72, 2);
  const P = powers.length ? powers : [0.7, 0.8, 0.9, 1.0];
  const T = taps || ({ red: [null], terence: [null], chuck: [0.45, 0.7, 0.95], blues: [0.5, 0.8], bomb: [null], matilda: [0.6, 0.9, 1.2] }[type] || [null]);
  const out = [];
  for (const a of A) for (const p of P) for (const t of T) out.push({ angle: a, power: p, tapAt: t });
  return out;
}
export function range(a, b, s) { const r = []; for (let x = a; x <= b + 1e-9; x += s) r.push(+x.toFixed(4)); return r; }

/** Greedy solver: for each bird pick the shot maximizing (killed pigs, score). */
export function greedySolve(level, { candidates = defaultCandidates, maxBirds = Infinity, log = false } = {}) {
  const shots = []; let sims = 0; const t0 = Date.now();
  for (;;) {
    const { g } = replay(level, shots);
    if (g.pigsAlive() === 0 || !g.birdsLeft.length || shots.length >= maxBirds) {
      return { solved: g.pigsAlive() === 0, birdsUsed: shots.length, score: g.finalScore(), shots, sims, ms: Date.now() - t0, pigsLeft: g.pigsAlive() };
    }
    const type = g.birdsLeft[0];
    let best = null;
    for (const c of candidates(type)) {
      const { g: h } = replay(level, shots);
      const r = h.shoot(c.angle, c.power, { tapAt: c.tapAt });
      sims++;
      const pigsLeft = h.pigsAlive();
      const val = -pigsLeft * 1e6 + h.score;
      if (!best || val > best.val) best = { val, c, pigsLeft, score: h.score, r };
    }
    if (log) console.log(`  bird ${shots.length + 1} (${type}): best`, best.c, 'pigsLeft', best.pigsLeft, 'score', best.score);
    shots.push(best.c);
  }
}

export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
export const coarseCandidates = (type) => defaultCandidates(type, { angles: range(4, 73, 3), powers: [0.75, 0.9, 1.0] });

/** "Human-like" adaptive player: greedy choice on a coarse grid (noise-free evaluation), executed with aim noise. */
export function noisyGreedy(level, { seed = 1, sa = 0.5, sp = 0.015, candidates = coarseCandidates } = {}) {
  const rnd = mulberry32(seed); const shots = []; let sims = 0;
  for (;;) {
    const { g } = replay(level, shots);
    if (g.pigsAlive() === 0 || !g.birdsLeft.length) return { won: g.pigsAlive() === 0, score: g.finalScore(), birdsUsed: shots.length, sims, shots };
    const type = g.birdsLeft[0];
    let best = null;
    for (const c of candidates(type)) {
      const { g: h } = replay(level, shots); h.shoot(c.angle, c.power, { tapAt: c.tapAt }); sims++;
      const val = -h.pigsAlive() * 1e6 + h.score;
      if (!best || val > best.val) best = { val, c };
    }
    const c = best.c;
    shots.push({ angle: c.angle + sa * gauss(rnd), power: Math.max(0.3, Math.min(1, c.power + sp * gauss(rnd))), tapAt: c.tapAt === null ? null : Math.max(0.05, c.tapAt + 0.03 * gauss(rnd)) });
  }
}
