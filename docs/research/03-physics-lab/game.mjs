// Mini game-physics core used by experiment G: materials, damage (velocity-gated post-solve impulse),
// deferred destruction, explosion, settle detector. Mirrors what the real game should implement.
import { World, Box, Circle } from './lib.mjs';
import { explode } from './expD_explosion.mjs';

export const DT = 1 / 60;
export const PHYS = { gravity: -15, velIters: 10, posIters: 8, inset: 0.0075 };

export const MATERIALS = {
  //        density friction restitution hpPerM2  jMin
  wood:  { density: 0.7, friction: 0.7, restitution: 0.05, hpPerM2: 10, jMin: 1.0 },
  ice:   { density: 0.9, friction: 0.25, restitution: 0.05, hpPerM2: 4, jMin: 0.6 },
  stone: { density: 2.2, friction: 0.9, restitution: 0.02, hpPerM2: 80, jMin: 2.0 },
  tnt:   { density: 0.8, friction: 0.6, restitution: 0.05, hpPerM2: 3, jMin: 1.5 },
};
export const PIG = { density: 0.6, friction: 0.6, restitution: 0.15, angularDamping: 3, linearDamping: 0.1, jMin: 0.6 };
export const BIRD = { density: 2.5, friction: 0.6, restitution: 0.3 };
export const BIRD_MULT = { red: { wood: 1, ice: 1, stone: 1, tnt: 1, pig: 2 } };
export const STATIC_TO_PIG_MULT = { value: 1.0 };
export const V_GATE = 0.5;
// mass-proportional threshold mode: J0 = m * V0 (set MODE.massThreshold = true)
export const MODE = { massThreshold: false, V0: { wood: 1.5, ice: 1.0, stone: 2.5, tnt: 1.5, pig: 3.0 } }; // m/s approach speed below which contacts never deal damage

export function createGame() {
  const world = new World({ gravity: { x: 0, y: PHYS.gravity } });
  const g = { world, entities: new Set(), stepNo: 0, damageEnabled: false, events: [], vn: new Map(), jAcc: new Map(), firstImpactStep: null };
  const ground = world.createBody({ type: 'static', position: { x: 50, y: -1 } });
  ground.createFixture({ shape: new Box(150, 1), friction: 0.9, restitution: 0 });
  ground.setUserData({ type: 'ground' });

  world.on('pre-step', () => { g.vn.clear(); g.jAcc.clear(); });
  world.on('pre-solve', (c) => {
    const wm = c.getWorldManifold(null);
    if (!wm || !wm.pointCount) return;
    const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
    let vmax = 0;
    for (let i = 0; i < wm.pointCount; i++) {
      const p = wm.points[i];
      const va = a.getLinearVelocityFromWorldPoint(p), vb = b.getLinearVelocityFromWorldPoint(p);
      vmax = Math.max(vmax, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y));
    }
    g.vn.set(c, Math.max(g.vn.get(c) || 0, vmax));
  });
  world.on('post-solve', (c, imp) => {
    let J = 0;
    const ni = imp.normalImpulses;
    for (let i = 0; i < ni.length; i++) J += ni[i];
    const a = c.getFixtureA().getBody(), b = c.getFixtureB().getBody();
    // key by body pair (Contact objects are pooled -> never keep them past this step)
    const ea = a.getUserData(), eb = b.getUserData();
    const prev = g.jAcc.get(c);
    if (prev) prev.J += J; else g.jAcc.set(c, { J, ea, eb });
  });
  g.ground = ground;
  return g;
}

function add(g, ent, body, shape, mat) {
  body.createFixture({ shape, density: mat.density, friction: mat.friction, restitution: mat.restitution });
  ent.body = body;
  body.setUserData(ent);
  g.entities.add(ent);
  return ent;
}
export function addBlock(g, matName, x, y, w, h, angle = 0) {
  const m = MATERIALS[matName];
  const body = g.world.createBody({ type: 'dynamic', position: { x, y }, angle });
  const area = w * h;
  const hp = m.hpPerM2 * Math.max(area, 0.25);
  return add(g, { type: 'block', mat: matName, hp, maxHp: hp, w, h }, body, new Box(w / 2 - PHYS.inset, h / 2 - PHYS.inset), m);
}
export function addPig(g, x, y, r = 0.45, hp = 5) {
  const body = g.world.createBody({ type: 'dynamic', position: { x, y }, angularDamping: PIG.angularDamping, linearDamping: PIG.linearDamping });
  return add(g, { type: 'pig', mat: 'pig', hp, maxHp: hp, r }, body, new Circle(r), PIG);
}
export function addBird(g, x, y, r = 0.45, kind = 'red') {
  const body = g.world.createBody({ type: 'dynamic', position: { x, y }, bullet: true });
  return add(g, { type: 'bird', kind, r, hp: Infinity, impacted: false }, body, new Circle(r), BIRD);
}

function jMinOf(ent) {
  if (MODE.massThreshold) return ent.body.getMass() * (MODE.V0[ent.mat] ?? 2);
  return ent.type === 'pig' ? PIG.jMin : (MATERIALS[ent.mat] ? MATERIALS[ent.mat].jMin : Infinity);
}
function damageTo(target, other, J) {
  if (!target || target.type === 'ground' || target.type === 'bird') return 0;
  let mult = 1;
  if (other && other.type === 'bird') mult = BIRD_MULT[other.kind][target.mat] ?? 1;
  if ((!other || other.type === 'ground') && target.type === 'pig') mult = STATIC_TO_PIG_MULT.value;
  return Math.max(0, J - jMinOf(target)) * mult;
}

// one fixed step + damage resolution + deferred destruction
export function stepGame(g) {
  const { world } = g;
  world.step(DT, PHYS.velIters, PHYS.posIters);
  g.stepNo++;
  // bird post-impact damping (stop endless rolling)
  for (const [c, rec] of g.jAcc) {
    const vn = g.vn.get(c) || 0;
    for (const e of [rec.ea, rec.eb]) if (e && e.type === 'bird' && !e.impacted && rec.J > 0) {
      e.impacted = true; e.body.setLinearDamping(1.5); e.body.setAngularDamping(4);
      if (g.firstImpactStep === null) g.firstImpactStep = g.stepNo;
    }
    if (!g.damageEnabled || vn < V_GATE) continue;
    const dA = damageTo(rec.ea, rec.eb, rec.J), dB = damageTo(rec.eb, rec.ea, rec.J);
    if (dA > 0) rec.ea.hp -= dA;
    if (dB > 0) rec.eb.hp -= dB;
  }
  // deferred destruction (never inside callbacks)
  const dead = [];
  for (const e of g.entities) if (e.hp <= 0 && !e.dead) dead.push(e);
  for (const e of dead) {
    e.dead = true;
    const p = e.body.getPosition();
    g.events.push({ step: g.stepNo, type: e.type === 'pig' ? 'pigKilled' : 'blockDestroyed', mat: e.mat, x: p.x, y: p.y });
    if (e.mat === 'tnt') blast(g, { x: p.x, y: p.y }, { R: 3.0, J0: 25, dvMax: 18, D0: 80 });
    world.destroyBody(e.body);
    g.entities.delete(e);
  }
}

// settle detector
export function makeSettle({ vLin = 0.1, vAng = 0.15, hold = 0.5, maxWait = 10 } = {}) {
  return { vLin, vAng, holdSteps: Math.round(hold / DT), maxSteps: Math.round(maxWait / DT), quiet: 0, n: 0 };
}
export function settleTick(s, g) {
  s.n++;
  let moving = false;
  for (const e of g.entities) {
    const b = e.body;
    if (!b.isAwake()) continue;
    const p = b.getPosition();
    if (p.y < -5 || p.x < -20 || p.x > 200) continue; // out of world: will be culled
    if (b.getLinearVelocity().length() > s.vLin || Math.abs(b.getAngularVelocity()) > s.vAng) { moving = true; break; }
  }
  s.quiet = moving ? 0 : s.quiet + 1;
  return s.quiet >= s.holdSteps || s.n >= s.maxSteps;
}

export function blast(g, c, { R, J0, dvMax, D0, spin = 0.15 }) {
  const res = explode(g.world, c, { R, J0, dvMax });
  for (const r of res) {
    const e = r.b.getUserData();
    if (!e || e.dead) continue;
    const f = 1 - r.d / R;
    const side = Math.sign((r.b.getWorldCenter().x - c.x) || 1);
    r.b.applyAngularImpulse(-side * r.J * spin * Math.min(1, (e.w || (e.r || 0.5) * 2) / 2), true);
    if (e.hp !== undefined && e.type !== 'bird') {
      const matMult = e.mat === 'ice' ? 1.5 : 1.0;
      e.hp -= D0 * f * matMult;
    }
  }
  return res.length;
}
