// Обёртка над planck World: тела из LevelDef, урон из импульсов контактов (03 §3.6), пробитие (03 §2.8),
// взрывы (03 §3.7), очередь удаления с пробуждением соседей, границы мира и детектор покоя.
// Внутри колбэков planck мир заблокирован — всё создание/удаление идёт после world.step().

import {
  Box,
  Circle,
  Polygon,
  Settings,
  Vec2,
  World,
  WorldManifold,
  type Body,
  type BodyDef,
  type Contact,
  type ContactImpulse,
  type RayCastOutput,
  type Shape,
} from 'planck';
import { ABILITY, BIRD_FLIGHT, DAMAGE, EXPLOSION, PIG_PHYS, SETTLE, TNT, WORLD } from '../../config/constants';
import { BIRD_DEFS, PIG_DEFS, pigStage } from '../characters';
import type { ExplosionSource } from '../events';
import { blockStage, MATERIAL_DEFS } from '../materials';
import type { Rng } from '../rng';
import type { BirdType, BlockDef, LevelDef, PigDef, TerrainDef, TntDef, Vec } from '../types';
import {
  entSize,
  isDestructible,
  type BirdEnt,
  type BlockEnt,
  type Destructible,
  type EggEnt,
  type Ent,
  type Hit,
  type PigEnt,
  type TntEnt,
} from './entities';
import { convexPieces, insetPolygon, normalizePolygon, shapeArea, shapeOutline } from './geometry';

export type KillCause = 'impact' | 'blast' | 'culled';

/** Обратные вызовы мира для игрового слоя (очки, события, отрисовка). */
export interface PhysicsListener {
  added(e: Ent): void;
  /** Контакт за шаг с J > 0 или пробитием. */
  hit(h: Hit): void;
  /** Нанесён урон: applied — снятая часть HP (не больше остатка). */
  damaged(e: Destructible, applied: number, stageChanged: boolean, helmetLost: boolean): void;
  /** Разрушаемое тело погибло; тело ещё в мире (можно читать позицию и скорость). */
  killed(e: Destructible, cause: KillCause): void;
  removed(e: Ent): void;
  exploded(x: number, y: number, radius: number, source: ExplosionSource): void;
}

/** Птицы и яйцо в одной отрицательной группе — друг с другом не сталкиваются. */
const BIRD_GROUP = -1;
const CHAIN_STEPS = Math.round(EXPLOSION.TNT_CHAIN_DELAY / WORLD.DT);

function blockShape(def: BlockDef): Shape {
  const { shape, w, h } = def;
  if (shape === 'circle') return new Circle(w / 2);
  if (shape === 'rect') return new Box(w / 2 - WORLD.INSET, h / 2 - WORLD.INSET);
  return new Polygon(insetPolygon(shapeOutline(shape, w, h), WORLD.INSET));
}

export class PhysicsWorld {
  readonly world = new World({ gravity: { x: 0, y: WORLD.GRAVITY } });
  /** Живые сущности в порядке создания — от порядка обхода зависит детерминизм. */
  readonly ents = new Map<number, Ent>();
  /** Урон включается с первым выстрелом (03 §3.1). */
  damageEnabled = false;

  private stepNo = 0;
  private nextId = 1;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly killY: number;
  private readonly hits = new Map<Contact, Hit>();
  private readonly pierces: Array<{ bird: BirdEnt; target: Destructible; dmg: number }> = [];
  private readonly kills: Array<{ e: Destructible; cause: KillCause }> = [];
  private chain: Array<{ at: number; x: number; y: number }> = [];
  private readonly wm = new WorldManifold();
  private readonly rayOut: RayCastOutput = { normal: Vec2.zero(), fraction: 1 };

  constructor(
    level: LevelDef,
    private readonly rng: Rng,
    private readonly listener: PhysicsListener,
  ) {
    const lowest = Math.min(...level.terrain.flatMap((t) => t.points.map((p) => p[1])));
    this.killY = Math.min(WORLD.KILL_Y, lowest - 1);
    this.minX = level.bounds.minX - WORLD.BOUNDS_MARGIN;
    this.maxX = level.bounds.maxX + WORLD.BOUNDS_MARGIN;
    this.world.on('pre-solve', this.preSolve);
    this.world.on('post-solve', this.postSolve);
    // порядок как в данных уровня: рельеф, блоки, TNT, свиньи
    for (const t of level.terrain) this.addTerrain(t);
    for (const b of level.blocks) this.addBlock(b);
    for (const t of level.tnt ?? []) this.addTnt(t);
    for (const p of level.pigs) this.addPig(p);
  }

  allocId(): number {
    return this.nextId++;
  }

  // ── Создание тел ─────────────────────────────────────────────

  private register<T extends Ent>(e: T): T {
    e.body.setUserData(e);
    this.ents.set(e.id, e);
    this.listener.added(e);
    return e;
  }

  private dynamicBody(x: number, y: number, angle: number, extra?: BodyDef): Body {
    return this.world.createBody({ type: 'dynamic', position: { x, y }, angle, ...extra });
  }

  private addTerrain(def: TerrainDef): void {
    const body = this.world.createBody({ type: 'static' });
    const outline = normalizePolygon(def.points.map(([x, y]) => ({ x, y })));
    const inner = normalizePolygon(insetPolygon(outline, WORLD.INSET));
    for (const piece of convexPieces(inner, Settings.maxPolygonVertices)) {
      body.createFixture({ shape: new Polygon(piece), friction: WORLD.GROUND_FRICTION, restitution: WORLD.GROUND_RESTITUTION });
    }
    this.register({ kind: 'terrain', id: this.allocId(), body, seed: 0, dead: false });
  }

  private addBlock(def: BlockDef): BlockEnt {
    const m = MATERIAL_DEFS[def.material];
    const body = this.dynamicBody(def.x, def.y, def.angle ?? 0);
    body.createFixture({ shape: blockShape(def), density: m.density, friction: m.friction, restitution: m.restitution });
    const area = shapeArea(def.shape, def.w, def.h);
    const hp = m.hpPerKg * m.density * area; // HP по визуальной площади (03 §3.3)
    return this.register<BlockEnt>({
      kind: 'block', id: this.allocId(), body, seed: this.rng.next(), dead: false,
      target: def.material, hp, maxHp: hp, v0: m.v0, blastMult: m.blastMult, stage: 0,
      material: def.material, shape: def.shape, w: def.w, h: def.h, area,
    });
  }

  private addTnt(def: TntDef): TntEnt {
    const size = def.size ?? TNT.SIZE;
    const body = this.dynamicBody(def.x, def.y, def.angle ?? 0);
    body.createFixture({ shape: new Box(size / 2 - WORLD.INSET, size / 2 - WORLD.INSET), density: TNT.density, friction: TNT.friction, restitution: TNT.restitution });
    const hp = TNT.hpPerKg * TNT.density * size * size;
    return this.register<TntEnt>({
      kind: 'tnt', id: this.allocId(), body, seed: this.rng.next(), dead: false,
      target: 'tnt', hp, maxHp: hp, v0: TNT.v0, blastMult: TNT.blastMult, stage: 0, size,
    });
  }

  private addPig(def: PigDef): PigEnt {
    const p = PIG_DEFS[def.type];
    const body = this.dynamicBody(def.x, def.y, 0, { angularDamping: PIG_PHYS.ANGULAR_DAMPING, linearDamping: PIG_PHYS.LINEAR_DAMPING });
    body.createFixture({ shape: new Circle(p.radius), density: p.density, friction: p.friction, restitution: p.restitution });
    const hp = p.hpPerKg * body.getMass();
    return this.register<PigEnt>({
      kind: 'pig', id: this.allocId(), body, seed: this.rng.next(), dead: false,
      target: 'pig', hp, maxHp: hp, v0: DAMAGE.PIG_V0, blastMult: DAMAGE.PIG_BLAST_MULT, stage: 0,
      type: def.type, radius: p.radius, helmetHp: p.helmetHp,
    });
  }

  /** Тело птицы в момент выстрела (bullet: CCD против туннелирования, 03 §2.5). */
  addBird(type: BirdType, id: number, seed: number, pos: Vec, vel: Vec, angle: number): BirdEnt {
    const d = BIRD_DEFS[type];
    const body = this.dynamicBody(pos.x, pos.y, angle, { bullet: true, angularDamping: BIRD_FLIGHT.ANGULAR_DAMPING });
    const shape = d.outline
      ? new Polygon(insetPolygon(d.outline.map(([x, y]) => ({ x, y })), WORLD.INSET))
      : new Circle(d.radius);
    body.createFixture({ shape, density: d.density, friction: d.friction, restitution: d.restitution, filterGroupIndex: BIRD_GROUP });
    body.setLinearVelocity(vel);
    return this.register<BirdEnt>({ kind: 'bird', id, body, seed, dead: false, type, radius: d.radius, mult: d.mult, damped: false });
  }

  /** Яйцо Матильды: тяжёлый снаряд, взрывается при первом касании. */
  addEgg(pos: Vec, vel: Vec): EggEnt {
    const M = ABILITY.MATILDA;
    const body = this.dynamicBody(pos.x, pos.y, 0, { bullet: true });
    body.createFixture({ shape: new Circle(M.EGG_RADIUS), density: M.EGG_DENSITY, friction: M.EGG_FRICTION, restitution: 0, filterGroupIndex: BIRD_GROUP });
    body.setLinearVelocity(vel);
    return this.register<EggEnt>({ kind: 'egg', id: this.allocId(), body, seed: this.rng.next(), dead: false, radius: M.EGG_RADIUS, touched: false });
  }

  // ── Цикл ─────────────────────────────────────────────────────

  step(): void {
    this.hits.clear();
    this.pierces.length = 0;
    this.world.step(WORLD.DT, WORLD.VEL_ITERS, WORLD.POS_ITERS);
    this.stepNo++;
    this.resolveHits();
    this.resolvePierces();
    this.detonateEggs();
    this.runChain();
    this.cull();
    this.flush();
  }

  /** Усадка на старте без урона, затем принудительный сон (03 §2.3). */
  presettle(): void {
    this.damageEnabled = false;
    for (let i = 0; i < WORLD.PRESETTLE_STEPS; i++) this.step();
    this.sleepAll();
  }

  sleepAll(): void {
    for (const e of this.ents.values()) if (e.kind !== 'terrain') e.body.setAwake(false);
  }

  anyAwake(): boolean {
    for (const e of this.ents.values()) if (e.kind !== 'terrain' && e.body.isAwake()) return true;
    return false;
  }

  /** Тишина: все бодрые тела медленнее порогов, нет летящих яиц и отложенных взрывов (03 §3.8). */
  isQuiet(): boolean {
    if (this.chain.length > 0) return false;
    for (const e of this.ents.values()) {
      if (e.kind === 'terrain') continue;
      if (e.kind === 'egg') return false;
      const b = e.body;
      if (!b.isAwake()) continue;
      if (b.getLinearVelocity().length() > SETTLE.V_LIN || Math.abs(b.getAngularVelocity()) > SETTLE.V_ANG) return false;
    }
    return true;
  }

  outOfBounds(x: number, y: number): boolean {
    return y < this.killY || x < this.minX || x > this.maxX;
  }

  // ── Контакты (внутри колбэков ничего не создаём и не удаляем) ──

  private readonly preSolve = (c: Contact): void => {
    const count = c.getManifold().pointCount;
    if (count === 0) return; // иначе getWorldManifold вернёт устаревшие точки
    const bodyA = c.getFixtureA().getBody();
    const bodyB = c.getFixtureB().getBody();
    const a = bodyA.getUserData() as Ent;
    const b = bodyB.getUserData() as Ent;
    const wm = c.getWorldManifold(this.wm)!;
    let vn = 0;
    let px = 0;
    let py = 0;
    for (let i = 0; i < count; i++) {
      const p = wm.points[i];
      const va = bodyA.getLinearVelocityFromWorldPoint(p);
      const vb = bodyB.getLinearVelocityFromWorldPoint(p);
      vn = Math.max(vn, -((vb.x - va.x) * wm.normal.x + (vb.y - va.y) * wm.normal.y));
      px += p.x / count;
      py += p.y / count;
    }
    let h = this.hits.get(c);
    if (!h || h.a !== a || h.b !== b) {
      h = { a, b, J: 0, vn, x: px, y: py, pierced: false };
      this.hits.set(c, h);
    } else if (vn > h.vn) {
      h.vn = vn;
      h.x = px;
      h.y = py;
    }
    if (a.kind === 'egg') a.touched = true;
    if (b.kind === 'egg') b.touched = true;
    if (h.pierced) c.setEnabled(false); // pre-solve приходит и из TOI — держим контакт выключенным весь шаг
    else if (this.damageEnabled && vn >= DAMAGE.V_GATE) this.tryPierce(c, h);
  };

  private readonly postSolve = (c: Contact, imp: ContactImpulse): void => {
    const h = this.hits.get(c);
    if (!h) return;
    const ni = imp.normalImpulses; // геттер перезаполняет общий массив — только читаем числа
    for (let i = 0; i < ni.length; i++) h.J += ni[i];
  };

  /** Пробитие: оценка удара в pre-solve уже смертельна — птица проходит насквозь (03 §2.8). */
  private tryPierce(c: Contact, h: Hit): void {
    const bird = h.a.kind === 'bird' ? h.a : h.b.kind === 'bird' ? h.b : null;
    if (!bird) return;
    const target = bird === h.a ? h.b : h.a;
    if (!isDestructible(target) || target.dead || (target.kind === 'pig' && target.helmetHp > 0)) return;
    const mb = bird.body.getMass();
    const mt = target.body.getMass();
    const jEst = (1 + c.getRestitution()) * ((mb * mt) / (mb + mt)) * h.vn;
    const dmg = bird.mult[target.target] * Math.max(0, jEst - mt * target.v0);
    if (dmg < target.hp) return;
    h.pierced = true;
    c.setEnabled(false);
    this.pierces.push({ bird, target, dmg });
  }

  private resolveHits(): void {
    for (const h of this.hits.values()) {
      if (h.J <= 0 && !h.pierced) continue;
      if (!h.pierced) {
        this.dampBird(h.a);
        this.dampBird(h.b);
      }
      this.listener.hit(h);
      if (!this.damageEnabled || h.pierced || h.vn < DAMAGE.V_GATE) continue;
      this.impactDamage(h.a, h.b, h);
      this.impactDamage(h.b, h.a, h);
    }
  }

  /** Первый настоящий контакт птицы: включаем демпфирование, иначе она катится десятки метров. */
  private dampBird(e: Ent): void {
    if (e.kind !== 'bird' || e.damped) return;
    e.damped = true;
    e.body.setLinearDamping(BIRD_FLIGHT.HIT_LINEAR_DAMPING);
    e.body.setAngularDamping(BIRD_FLIGHT.HIT_ANGULAR_DAMPING);
  }

  private impactDamage(target: Ent, source: Ent, h: Hit): void {
    if (!isDestructible(target) || target.dead) return;
    const excess = h.J - target.body.getMass() * target.v0;
    if (excess <= 0) return;
    let mult = 1;
    if (source.kind === 'bird') mult = source.mult[target.target];
    else if (source.kind === 'terrain' && target.kind === 'pig') mult = DAMAGE.PIG_STATIC_MULT;
    let share = 0;
    if (target.kind === 'pig' && target.helmetHp > 0) {
      const local = target.body.getLocalPoint({ x: h.x, y: h.y });
      share = local.y > DAMAGE.HELMET_TOP_Y * target.radius ? DAMAGE.HELMET_SHARE_TOP : DAMAGE.HELMET_SHARE_SIDE;
    }
    this.damage(target, mult * excess, share, 'impact');
  }

  private resolvePierces(): void {
    for (const { bird, target, dmg } of this.pierces) {
      if (target.dead) continue;
      const keep = Math.min(DAMAGE.PIERCE_KEEP_MAX, Math.max(DAMAGE.PIERCE_KEEP_MIN, 1 - (DAMAGE.PIERCE_KEEP_K * target.hp) / dmg));
      this.damage(target, dmg, 0, 'impact');
      const v = bird.body.getLinearVelocity();
      bird.body.setLinearVelocity({ x: v.x * keep, y: v.y * keep });
    }
  }

  // ── Урон и удаление ──────────────────────────────────────────

  /** Наносит урон; helmetShare — доля, которую берёт каска свиньи. */
  private damage(e: Destructible, amount: number, helmetShare: number, cause: KillCause): void {
    if (e.dead || amount <= 0) return;
    let helmetLost = false;
    if (e.kind === 'pig' && e.helmetHp > 0 && helmetShare > 0) {
      const absorbed = amount * helmetShare;
      e.helmetHp -= absorbed;
      amount -= absorbed;
      if (e.helmetHp <= 0) {
        e.helmetHp = 0;
        helmetLost = true;
      }
    }
    const applied = Math.min(amount, e.hp);
    e.hp -= amount;
    const frac = Math.max(0, e.hp / e.maxHp);
    const stage = e.kind === 'pig' ? pigStage(frac) : blockStage(frac);
    const stageChanged = stage !== e.stage;
    e.stage = stage;
    this.listener.damaged(e, applied, stageChanged, helmetLost);
    if (e.hp <= 0) this.kill(e, cause);
  }

  private kill(e: Destructible, cause: KillCause): void {
    if (e.dead) return;
    e.dead = true;
    this.kills.push({ e, cause });
  }

  /** Удаляет тело, предварительно разбудив всех, кто его касается (иначе они зависнут спящими). */
  remove(e: Ent): void {
    if (!this.ents.has(e.id)) return;
    e.dead = true;
    for (let ce = e.body.getContactList(); ce; ce = ce.next) {
      if (ce.other?.isDynamic()) ce.other.setAwake(true);
    }
    this.world.destroyBody(e.body);
    this.ents.delete(e.id);
    this.listener.removed(e);
  }

  /** Обработка очереди погибших; взрывы TNT могут добавлять новые — крутим до опустошения. */
  private flush(): void {
    for (let i = 0; i < this.kills.length; i++) {
      const { e, cause } = this.kills[i];
      this.listener.killed(e, cause);
      const { x, y } = e.body.getPosition();
      this.remove(e);
      if (e.kind !== 'tnt' || cause === 'culled') continue;
      if (cause === 'blast') this.chain.push({ at: this.stepNo + CHAIN_STEPS, x, y });
      else this.explode(x, y, 'tnt');
    }
    this.kills.length = 0;
  }

  private cull(): void {
    const lost: EggEnt[] = [];
    for (const e of this.ents.values()) {
      if (e.dead || e.kind === 'terrain' || e.kind === 'bird') continue; // птиц убирает игровой слой
      const p = e.body.getPosition();
      if (!this.outOfBounds(p.x, p.y)) continue;
      if (e.kind === 'egg') lost.push(e);
      else this.kill(e, 'culled');
    }
    for (const egg of lost) this.remove(egg);
  }

  private detonateEggs(): void {
    const touched: EggEnt[] = [];
    for (const e of this.ents.values()) if (e.kind === 'egg' && e.touched) touched.push(e);
    for (const egg of touched) {
      const { x, y } = egg.body.getPosition();
      this.remove(egg);
      this.explode(x, y, 'egg');
    }
  }

  private runChain(): void {
    if (this.chain.length === 0) return;
    const due = this.chain.filter((c) => c.at <= this.stepNo);
    this.chain = this.chain.filter((c) => c.at > this.stepNo);
    for (const c of due) this.explode(c.x, c.y, 'tnt');
  }

  // ── Взрывы и запросы ─────────────────────────────────────────

  /** Взрыв вне шага (тап Bomb): импульсы, урон и обработка погибших сразу. */
  detonate(x: number, y: number, source: ExplosionSource): void {
    this.explode(x, y, source);
    this.flush();
  }

  /** Радиальный импульс с линейным спадом по расстоянию до поверхности тела и капом Δv (03 §3.7). */
  private explode(x: number, y: number, source: ExplosionSource): void {
    const P = EXPLOSION[source];
    this.listener.exploded(x, y, P.R, source);
    const c = { x, y };
    for (const e of this.bodiesNear(x, y, P.R)) {
      const b = e.body;
      const com = b.getWorldCenter();
      const dx = com.x - x;
      const dy = com.y - y;
      const dc = Math.hypot(dx, dy) || 1e-6;
      let frac = 1;
      for (let f = b.getFixtureList(); f; f = f.getNext()) {
        if (f.rayCast(this.rayOut, { p1: c, p2: com, maxFraction: 1 }, 0)) frac = Math.min(frac, this.rayOut.fraction);
      }
      // луч не пересёк фикстуру — центр взрыва внутри тела
      const d = frac < 1 ? frac * dc : 0;
      if (d > P.R) continue;
      const k = 1 - d / P.R;
      const J = Math.min(P.J0 * k, b.getMass() * P.DV_MAX);
      b.applyLinearImpulse({ x: (dx / dc) * J, y: (dy / dc) * J }, com, true);
      b.applyAngularImpulse(-Math.sign(dx || 1) * P.SPIN * J * Math.min(1, entSize(e) / 2), true);
      if (isDestructible(e)) {
        const share = e.kind === 'pig' && e.helmetHp > 0 ? DAMAGE.HELMET_SHARE_SIDE : 0;
        this.damage(e, P.D0 * k * e.blastMult, share, 'blast');
      }
    }
  }

  /** Живые динамические сущности, чьи AABB пересекают квадрат ±r вокруг точки. */
  bodiesNear(x: number, y: number, r: number): Ent[] {
    const found = new Set<Ent>();
    this.world.queryAABB({ lowerBound: { x: x - r, y: y - r }, upperBound: { x: x + r, y: y + r } }, (f) => {
      const e = f.getBody().getUserData() as Ent;
      if (e.kind !== 'terrain' && !e.dead) found.add(e);
      return true;
    });
    return [...found];
  }

  /** Высота поверхности рельефа под точкой x (визуальная, с учётом INSET) или NaN. */
  groundBelow(x: number, fromY: number): number {
    let y = NaN;
    this.world.rayCast({ x, y: fromY }, { x, y: this.killY }, (f, point, _normal, fraction) => {
      if ((f.getBody().getUserData() as Ent).kind !== 'terrain') return -1;
      y = point.y + WORLD.INSET;
      return fraction;
    });
    return y;
  }

  /** Точка внутри твёрдого тела (не птицы и не яйца). */
  isSolidAt(x: number, y: number): boolean {
    let solid = false;
    const p = { x, y };
    this.world.queryAABB({ lowerBound: { x: x - 1e-3, y: y - 1e-3 }, upperBound: { x: x + 1e-3, y: y + 1e-3 } }, (f) => {
      const kind = (f.getBody().getUserData() as Ent).kind;
      if (kind !== 'bird' && kind !== 'egg' && f.testPoint(p)) solid = true;
      return !solid;
    });
    return solid;
  }
}
