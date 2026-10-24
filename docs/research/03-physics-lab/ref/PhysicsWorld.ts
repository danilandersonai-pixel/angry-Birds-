// src/physics/PhysicsWorld.ts
import { World, Box, Circle, Vec2, WorldManifold, type Body, type Contact, type ContactImpulse, type RayCastOutput } from 'planck';
import { PHYS, MATERIALS, PIG_PHYS, BIRD_AFTER_IMPACT, SETTLE, GROUND, type MaterialId } from './constants';

export type EntityKind = 'block' | 'pig' | 'bird' | 'static';
export interface Entity {
  kind: EntityKind; body: Body; hp: number; maxHp: number; v0: number;
  size: number;                                   // w блока или 2r круга — для закрутки при взрыве
  material?: MaterialId | 'pig'; birdKind?: string; impacted?: boolean; dead?: boolean;
}
interface Hit { a: Entity; b: Entity; J: number; vn: number }
type BirdMult = (birdKind: string, target: MaterialId | 'pig') => number;   // таблица 02 §1.1

export class PhysicsWorld {
  readonly world = new World({ gravity: { x: 0, y: PHYS.GRAVITY } });
  damageEnabled = false;
  readonly entities = new Set<Entity>();
  private acc = 0;
  private hits = new Map<Contact, Hit>();         // живёт ровно один шаг: Contact из пула
  private readonly wm = new WorldManifold();      // переиспользуем, чтобы не мусорить в pre-solve
  private killQueue: Entity[] = [];
  onDestroyed?: (e: Entity) => void;              // очки, FX, звук, TNT → explode (после шага!)
  onImpact?: (a: Entity, b: Entity, J: number, vn: number) => void;

  constructor(private birdMult: BirdMult) {
    this.world.on('pre-solve', this.preSolve);
    this.world.on('post-solve', this.postSolve);
  }

  // ---------- создание ----------
  addStaticBox(x: number, y: number, w: number, h: number, angle = 0) {
    const body = this.world.createBody({ type: 'static', position: { x, y }, angle });
    body.createFixture({ shape: new Box(w / 2 - PHYS.INSET, h / 2 - PHYS.INSET), ...GROUND });
    return this.register({ kind: 'static', body, hp: Infinity, maxHp: Infinity, v0: 0, size: w });
  }
  addBlock(mat: MaterialId, x: number, y: number, w: number, h: number, angle = 0) {
    const m = MATERIALS[mat];
    const body = this.world.createBody({ type: 'dynamic', position: { x, y }, angle });
    body.createFixture({ shape: new Box(w / 2 - PHYS.INSET, h / 2 - PHYS.INSET), density: m.density, friction: m.friction, restitution: m.restitution });
    const hp = m.hpPerKg * m.density * w * h;     // HP по визуальной площади
    return this.register({ kind: 'block', body, hp, maxHp: hp, v0: m.v0, size: w, material: mat });
  }
  addPig(x: number, y: number, r: number, density: number, hpPerKg: number, friction = 0.6, restitution = 0.15) {
    const body = this.world.createBody({ type: 'dynamic', position: { x, y }, angularDamping: PIG_PHYS.angularDamping, linearDamping: PIG_PHYS.linearDamping });
    body.createFixture({ shape: new Circle(r), density, friction, restitution });
    const hp = hpPerKg * body.getMass();
    return this.register({ kind: 'pig', body, hp, maxHp: hp, v0: PIG_PHYS.v0, size: 2 * r, material: 'pig' });
  }
  launchBird(kind: string, x: number, y: number, r: number, density: number, friction: number, restitution: number, vx: number, vy: number) {
    const body = this.world.createBody({ type: 'dynamic', position: { x, y }, bullet: true, angularDamping: 0.3 });
    body.createFixture({ shape: new Circle(r), density, friction, restitution });
    body.setLinearVelocity({ x: vx, y: vy });
    this.damageEnabled = true;
    return this.register({ kind: 'bird', body, hp: Infinity, maxHp: Infinity, v0: 0, size: 2 * r, birdKind: kind, impacted: false });
  }
  private register(e: Entity) { e.body.setUserData(e); this.entities.add(e); return e; }

  presettle() {                                   // при загрузке уровня
    this.damageEnabled = false;
    for (let i = 0; i < PHYS.PRESETTLE_STEPS; i++) this.fixedStep();
    this.sleepAll();
  }
  sleepAll() { for (const e of this.entities) if (e.body.isDynamic()) e.body.setAwake(false); }

  // ---------- цикл ----------
  /** @returns alpha для интерполяции рендера между prev и текущей позой */
  update(frameDt: number): number {
    this.acc = Math.min(this.acc + frameDt, PHYS.DT * PHYS.MAX_STEPS_PER_FRAME);
    while (this.acc >= PHYS.DT) { this.fixedStep(); this.acc -= PHYS.DT; }
    return this.acc / PHYS.DT;
  }
  fixedStep() {
    this.hits.clear();                            // 'pre-step' не типизирован — чистим сами
    // перед шагом сохраните prevPos/prevAngle каждого тела для интерполяции (не показано)
    this.world.step(PHYS.DT, PHYS.VEL_ITERS, PHYS.POS_ITERS);
    this.resolveHits();
    this.cullOutOfBounds();
    this.flushKills();
  }

  // ---------- колбэки (НИЧЕГО не создаём и не удаляем) ----------
  private preSolve = (c: Contact) => {
    if (c.getManifold().pointCount === 0) return;          // иначе wm вернётся со старыми точками
    const wm = c.getWorldManifold(this.wm)!;
    const A = c.getFixtureA().getBody(), B = c.getFixtureB().getBody();
    let vn = 0;
    for (let i = 0; i < wm.pointCount; i++) {
      const p = wm.points[i];
      const va = A.getLinearVelocityFromWorldPoint(p), vb = B.getLinearVelocityFromWorldPoint(p);
      vn = Math.max(vn, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y));
    }
    const h = this.hits.get(c);
    if (h) h.vn = Math.max(h.vn, vn);
    else this.hits.set(c, { a: A.getUserData() as Entity, b: B.getUserData() as Entity, J: 0, vn });
    // здесь же — пробитие по контракту 02 §2.3 (contact.setEnabled(false) + очередь), если нужно
  };
  private postSolve = (c: Contact, imp: ContactImpulse) => {
    const ni = imp.normalImpulses;                          // переиспользуемый массив — только читаем
    let J = 0; for (let i = 0; i < ni.length; i++) J += ni[i];
    const h = this.hits.get(c);
    if (h) h.J += J;                                        // обычный + TOI вызовы суммируются
  };

  // ---------- урон ----------
  private resolveHits() {
    for (const h of this.hits.values()) {
      if (h.J <= 0) continue;
      for (const T of [h.a, h.b]) {
        if (T.kind === 'bird' && !T.impacted) {             // первый контакт птицы
          T.impacted = true;
          T.body.setLinearDamping(BIRD_AFTER_IMPACT.linearDamping);
          T.body.setAngularDamping(BIRD_AFTER_IMPACT.angularDamping);
        }
      }
      this.onImpact?.(h.a, h.b, h.J, h.vn);
      if (!this.damageEnabled || h.vn < PHYS.V_GATE) continue;
      this.damage(h.a, h.b, h.J);
      this.damage(h.b, h.a, h.J);
    }
  }
  private damage(T: Entity, S: Entity, J: number) {
    if (T.dead || T.kind === 'bird' || T.kind === 'static' || !T.material) return;
    const J0 = T.body.getMass() * T.v0;
    let mult = 1;
    if (S.kind === 'bird') mult = this.birdMult(S.birdKind!, T.material);
    else if (S.kind === 'static' && T.kind === 'pig') mult = PIG_PHYS.staticMult;
    this.applyDamage(T, mult * Math.max(0, J - J0));
  }
  applyDamage(T: Entity, dmg: number) {
    if (dmg <= 0 || T.dead) return;
    T.hp -= dmg;
    if (T.hp <= 0) { T.dead = true; this.killQueue.push(T); }
  }
  private flushKills() {
    // onDestroyed может взорвать TNT → новые смерти; обрабатываем до опустошения очереди
    while (this.killQueue.length) {
      const e = this.killQueue.shift()!;
      this.onDestroyed?.(e);                                // читает позицию ДО удаления
      this.world.destroyBody(e.body);                       // безопасно: мы вне step()
      this.entities.delete(e);
    }
  }
  private cullOutOfBounds() { /* y < KILL_Y или x вне bounds ± BOUNDS_MARGIN → dead + killQueue */ }

  // ---------- взрыв ----------
  explode(c: { x: number; y: number }, p: { R: number; J0: number; dvMax: number; D0: number; spin: number }, exclude?: Body) {
    const bodies = new Set<Body>();
    this.world.queryAABB({ lowerBound: { x: c.x - p.R, y: c.y - p.R }, upperBound: { x: c.x + p.R, y: c.y + p.R } },
      (fx) => { const b = fx.getBody(); if (b.isDynamic() && b !== exclude) bodies.add(b); return true; });
    for (const b of bodies) {
      const e = b.getUserData() as Entity;
      const com = b.getWorldCenter();
      const dx = com.x - c.x, dy = com.y - c.y, dCom = Math.hypot(dx, dy) || 1e-6;
      let frac = 1, hit = false;
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        const out: RayCastOutput = { fraction: 1, normal: Vec2.zero() };
        if (f.rayCast(out, { p1: c, p2: com, maxFraction: 1 }, 0) && out.fraction < frac) { frac = out.fraction; hit = true; }
      }
      const d = hit ? frac * dCom : 0;
      if (d > p.R) continue;
      const k = 1 - d / p.R;
      const J = Math.min(p.J0 * k, b.getMass() * p.dvMax);
      b.applyLinearImpulse({ x: (dx / dCom) * J, y: (dy / dCom) * J }, com, true);
      b.applyAngularImpulse(-Math.sign(dx || 1) * p.spin * J * Math.min(1, e.size / 2), true);
      if (e.material && e.kind !== 'bird') {
        const bm = e.material === 'pig' ? PIG_PHYS.blastMult : MATERIALS[e.material].blastMult;
        this.applyDamage(e, p.D0 * k * bm);
      }
    }
  }

  // ---------- покой ----------
  private quietSteps = 0;
  /** вызывать раз в шаг после первого удара; true — settle */
  settleTick(): boolean {
    let moving = false;
    for (const e of this.entities) {
      const b = e.body;
      if (!b.isDynamic() || !b.isAwake()) continue;
      if (b.getLinearVelocity().length() > SETTLE.V_LIN || Math.abs(b.getAngularVelocity()) > SETTLE.V_ANG) { moving = true; break; }
    }
    this.quietSteps = moving ? 0 : this.quietSteps + 1;
    return this.quietSteps >= SETTLE.HOLD_STEPS;
  }
}

// Прицел: точные позиции planck через k шагов (без контактов и демпфинга)
export function predictPath(x0: number, y0: number, vx: number, vy: number, steps: number, g = PHYS.GRAVITY, h = PHYS.DT) {
  const pts: { x: number; y: number }[] = [];
  for (let k = 1; k <= steps; k++) pts.push({ x: x0 + k * h * vx, y: y0 + k * h * vy + (h * h * g * k * (k + 1)) / 2 });
  return pts;
}
