// Обёртка над planck World: тела из LevelDef, урон из импульсов контактов (00 §1.7), пробитие,
// взрывы (00 §1.8), очередь удаления с пробуждением соседей, границы мира и детектор покоя.
// Внутри колбэков planck мир заблокирован — всё создание/удаление идёт после world.step().

import {
  Box,
  Circle,
  Polygon,
  Settings,
  Transform,
  Vec2,
  World,
  WorldManifold,
  testOverlap,
  type Body,
  type BodyDef,
  type Contact,
  type ContactImpulse,
  type FixtureDef,
  type RayCastOutput,
  type Shape,
} from 'planck';
import { ABILITY, BIRD_FLIGHT, COLLISION, DAMAGE, EXPLOSION, PIG_PHYS, SETTLE, TNT, WORLD } from '../../config/constants';
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
import { insetPolygon, shapeArea, shapeOutline, terrainPieces } from './geometry';

/** Причина гибели: удар, взрыв или вылет свиньи за границы мира. */
export type KillCause = 'impact' | 'blast' | 'culled';

/** Обратные вызовы мира для игрового слоя (очки, события, отрисовка). */
export interface PhysicsListener {
  added(e: Ent): void;
  /** Контакт за шаг с J > 0 или пробитием. */
  hit(h: Hit): void;
  /** Нанесён урон: applied — снятая часть HP тела и каски (не больше остатка). */
  damaged(e: Destructible, applied: number, stageChanged: boolean, helmetLost: boolean): void;
  /** Разрушаемое тело погибло; тело ещё в мире (можно читать позицию и скорость). */
  killed(e: Destructible, cause: KillCause): void;
  removed(e: Ent): void;
  exploded(x: number, y: number, radius: number, source: ExplosionSource): void;
}

const CHAIN_STEPS = Math.round(EXPLOSION.TNT_CHAIN_DELAY / WORLD.DT);
const FAST_STEPS = Math.round(WORLD.FAST_BULLET_T / WORLD.DT);
const FAST_V2 = WORLD.FAST_BULLET_V * WORLD.FAST_BULLET_V;

function blockShape(def: BlockDef): Shape {
  const { shape, w, h } = def;
  if (shape === 'circle') return new Circle(w / 2);
  if (shape === 'rect') return new Box(w / 2 - WORLD.INSET, h / 2 - WORLD.INSET);
  return new Polygon(insetPolygon(shapeOutline(shape, w, h), WORLD.INSET));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export class PhysicsWorld {
  readonly world = new World({ gravity: { x: 0, y: WORLD.GRAVITY } });
  /** Живые сущности в порядке создания — от порядка обхода зависит детерминизм. */
  readonly ents = new Map<number, Ent>();
  /** Урон включается с первым выстрелом (00 §1.1). */
  damageEnabled = false;
  /** Нижняя граница мира: ниже тела удаляются. */
  readonly killY: number;
  /**
   * Растёт, когда удалённое тело касалось динамических: они разбужены, но ещё неподвижны — их скорость
   * станет ненулевой только на следующем шаге, поэтому детектор покоя должен начать отсчёт заново.
   */
  supportLost = 0;

  private stepNo = 0;
  private nextId = 1;
  private readonly minX: number;
  private readonly maxX: number;
  /** Контакты шага: ключ Contact живёт ровно один шаг (пул planck), поэтому сами записи — в списке. */
  private readonly hitOf = new Map<Contact, Hit>();
  private readonly hitList: Hit[] = [];
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

  /** Невыпуклый контур рельефа: нормализация, INSET, разбиение на выпуклые части одного статического тела. */
  private addTerrain(def: TerrainDef): void {
    const body = this.world.createBody({ type: 'static' });
    const fd: Omit<FixtureDef, 'shape'> = {
      friction: WORLD.GROUND_FRICTION, restitution: WORLD.GROUND_RESTITUTION, filterCategoryBits: COLLISION.GROUND,
    };
    for (const piece of terrainPieces(def.points, WORLD.INSET, Settings.maxPolygonVertices)) body.createFixture({ shape: new Polygon(piece), ...fd });
    this.register({ kind: 'terrain', id: this.allocId(), body, seed: 0, dead: false });
  }

  private addBlock(def: BlockDef): BlockEnt {
    const m = MATERIAL_DEFS[def.material];
    const body = this.dynamicBody(def.x, def.y, def.angle ?? 0);
    body.createFixture({
      shape: blockShape(def), density: m.density, friction: m.friction, restitution: m.restitution, filterCategoryBits: COLLISION.BLOCK,
    });
    const area = shapeArea(def.shape, def.w, def.h);
    const hp = m.hpPerKg * m.density * area; // HP по визуальной площади (03 §3.3)
    return this.register<BlockEnt>({
      kind: 'block', id: this.allocId(), body, seed: this.rng.next(), dead: false, fastUntil: 0,
      target: def.material, hp, maxHp: hp, scoreHp: hp, v0: m.v0, blastMult: m.blastMult, stage: 0,
      material: def.material, shape: def.shape, w: def.w, h: def.h, area,
    });
  }

  private addTnt(def: TntDef): TntEnt {
    const size = def.size ?? TNT.SIZE;
    const body = this.dynamicBody(def.x, def.y, def.angle ?? 0);
    body.createFixture({
      shape: new Box(size / 2 - WORLD.INSET, size / 2 - WORLD.INSET),
      density: TNT.density, friction: TNT.friction, restitution: TNT.restitution, filterCategoryBits: COLLISION.BLOCK,
    });
    const hp = TNT.hpPerKg * TNT.density * size * size;
    return this.register<TntEnt>({
      kind: 'tnt', id: this.allocId(), body, seed: this.rng.next(), dead: false, fastUntil: 0,
      target: 'tnt', hp, maxHp: hp, scoreHp: hp, v0: TNT.v0, blastMult: TNT.blastMult, stage: 0, size,
    });
  }

  private addPig(def: PigDef): PigEnt {
    const p = PIG_DEFS[def.type];
    const body = this.dynamicBody(def.x, def.y, 0, { angularDamping: PIG_PHYS.ANGULAR_DAMPING, linearDamping: PIG_PHYS.LINEAR_DAMPING });
    body.createFixture({
      shape: new Circle(p.radius), density: p.density, friction: p.friction, restitution: p.restitution, filterCategoryBits: COLLISION.PIG,
    });
    const hp = p.hpPerKg * body.getMass();
    return this.register<PigEnt>({
      kind: 'pig', id: this.allocId(), body, seed: this.rng.next(), dead: false, fastUntil: 0,
      target: 'pig', hp, maxHp: hp, scoreHp: hp + p.helmetHp, v0: DAMAGE.PIG_V0, blastMult: DAMAGE.PIG_BLAST_MULT, stage: 0,
      type: def.type, radius: p.radius, helmetHp: p.helmetHp,
    });
  }

  /**
   * Тело птицы в момент выстрела (bullet: CCD против туннелирования). group — отрицательный groupIndex выстрела:
   * сёстры Синих и яйцо Матильды друг с другом не сталкиваются.
   */
  addBird(type: BirdType, id: number, seed: number, pos: Vec, vel: Vec, angle: number, group: number): BirdEnt {
    const d = BIRD_DEFS[type];
    const body = this.dynamicBody(pos.x, pos.y, angle, { bullet: true, angularDamping: BIRD_FLIGHT.ANGULAR_DAMPING });
    const shape = d.outline
      ? new Polygon(insetPolygon(d.outline.map(([x, y]) => ({ x, y })), WORLD.INSET))
      : new Circle(d.radius);
    body.createFixture({
      shape, density: d.density, friction: d.friction, restitution: d.restitution,
      filterCategoryBits: COLLISION.BIRD, filterGroupIndex: group,
    });
    body.setLinearVelocity(vel);
    return this.register<BirdEnt>({ kind: 'bird', id, body, seed, dead: false, type, radius: d.radius, mult: d.mult, damped: false, keep: 1 });
  }

  /** Яйцо Матильды: тяжёлый снаряд, взрывается при первом касании. */
  addEgg(pos: Vec, vel: Vec, group: number): EggEnt {
    const M = ABILITY.MATILDA;
    const body = this.dynamicBody(pos.x, pos.y, 0, { bullet: true });
    body.createFixture({
      shape: new Circle(M.EGG_RADIUS), density: M.EGG_DENSITY, friction: M.EGG_FRICTION, restitution: 0,
      filterCategoryBits: COLLISION.EGG, filterGroupIndex: group,
    });
    body.setLinearVelocity(vel);
    return this.register<EggEnt>({ kind: 'egg', id: this.allocId(), body, seed: this.rng.next(), dead: false, radius: M.EGG_RADIUS, touched: false });
  }

  // ── Цикл ─────────────────────────────────────────────────────

  step(): void {
    this.hitOf.clear();
    this.hitList.length = 0;
    this.pierces.length = 0;
    this.world.step(WORLD.DT, WORLD.VEL_ITERS, WORLD.POS_ITERS);
    this.stepNo++;
    this.resolveHits();
    this.resolvePierces();
    this.detonateEggs();
    this.runChain();
    this.cull();
    this.updateFastBodies();
    this.flush();
  }

  /** Усадка на старте без урона, затем принудительный сон (00 §1.1). */
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

  /** Тишина: все бодрые тела медленнее порогов, нет летящих яиц и отложенных взрывов (00 §1.9). */
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
    // скорость точки тела v + ω × (p − c) — без временных векторов (pre-solve вызывается на каждый контакт)
    const va = bodyA.getLinearVelocity();
    const vb = bodyB.getLinearVelocity();
    const ca = bodyA.getWorldCenter();
    const cb = bodyB.getWorldCenter();
    const wa = bodyA.getAngularVelocity();
    const wb = bodyB.getAngularVelocity();
    let vn = 0;
    let px = 0;
    let py = 0;
    for (let i = 0; i < count; i++) {
      const p = wm.points[i];
      const rx = vb.x - wb * (p.y - cb.y) - (va.x - wa * (p.y - ca.y));
      const ry = vb.y + wb * (p.x - cb.x) - (va.y + wa * (p.x - ca.x));
      vn = Math.max(vn, -(rx * wm.normal.x + ry * wm.normal.y));
      px += p.x / count;
      py += p.y / count;
    }
    let h = this.hitOf.get(c);
    if (!h || h.a !== a || h.b !== b) {
      // новый контакт шага (или объект пула достался другой паре)
      h = { a, b, J: 0, vn, x: px, y: py, pierced: false };
      this.hitOf.set(c, h);
      this.hitList.push(h);
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
    const h = this.hitOf.get(c);
    if (!h) return;
    const ni = imp.normalImpulses; // геттер перезаполняет общий массив — только читаем числа
    for (let i = 0; i < ni.length; i++) h.J += ni[i];
  };

  /** Пробитие: оценка удара в pre-solve уже смертельна — птица проходит насквозь (03 §2.8). */
  private tryPierce(c: Contact, h: Hit): void {
    const bird = h.a.kind === 'bird' ? h.a : h.b.kind === 'bird' ? h.b : null;
    if (!bird) return;
    const target = bird === h.a ? h.b : h.a;
    // свинью в каске не прошить: каска держит удар
    if (!isDestructible(target) || target.dead || (target.kind === 'pig' && target.helmetHp > 0)) return;
    const mb = bird.body.getMass();
    const mt = target.body.getMass();
    // оценка импульса — с той же компенсацией скорости, что и урон птицы (BIRD_SPEED_COMP), иначе пробитие реже таблицы 00 §1.7
    const jEst = (1 + c.getRestitution()) * ((mb * mt) / (mb + mt)) * h.vn * DAMAGE.BIRD_SPEED_COMP;
    const dmg = bird.mult[target.target] * Math.max(0, jEst - mt * target.v0);
    if (dmg < target.hp) return;
    h.pierced = true;
    c.setEnabled(false);
    this.pierces.push({ bird, target, dmg });
  }

  private resolveHits(): void {
    for (const h of this.hitList) {
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
    // удар птицы: импульс ×BIRD_SPEED_COMP до вычета порога — урон как при калибровочной V_MAX 24 (00 §1.7)
    const bird = source.kind === 'bird';
    const excess = (bird ? h.J * DAMAGE.BIRD_SPEED_COMP : h.J) - target.body.getMass() * target.v0;
    if (excess <= 0) return;
    let mult = 1;
    if (bird) mult = source.mult[target.target];
    else if (source.kind === 'terrain' && target.kind === 'pig') mult = DAMAGE.PIG_STATIC_MULT;
    let share = 0;
    if (target.kind === 'pig' && target.helmetHp > 0) {
      const local = target.body.getLocalPoint({ x: h.x, y: h.y });
      share = local.y > DAMAGE.HELMET_TOP_Y * target.radius ? DAMAGE.HELMET_SHARE_TOP : DAMAGE.HELMET_SHARE_SIDE;
    }
    this.damage(target, mult * excess, share, 'impact');
  }

  /** Урон пробитых целей и потеря скорости птицы: за шаг берётся минимальная доля (00 §1.7). */
  private resolvePierces(): void {
    for (const { bird, target, dmg } of this.pierces) {
      if (target.dead) continue;
      bird.keep = Math.min(bird.keep, clamp(1 - (DAMAGE.PIERCE_KEEP_K * target.hp) / dmg, DAMAGE.PIERCE_KEEP_MIN, DAMAGE.PIERCE_KEEP_MAX));
      this.damage(target, dmg, 0, 'impact');
    }
    for (const { bird } of this.pierces) {
      if (bird.keep >= 1) continue;
      const v = bird.body.getLinearVelocity();
      bird.body.setLinearVelocity({ x: v.x * bird.keep, y: v.y * bird.keep });
      bird.keep = 1;
    }
  }

  // ── Урон и удаление ──────────────────────────────────────────

  /** Наносит урон; helmetShare — доля, которую берёт каска свиньи (лишний урон каски в тело не переходит). */
  private damage(e: Destructible, amount: number, helmetShare: number, cause: KillCause): void {
    if (e.dead || amount <= 0) return;
    let applied = 0;
    let helmetLost = false;
    if (e.kind === 'pig' && e.helmetHp > 0 && helmetShare > 0) {
      const absorbed = amount * helmetShare;
      applied += Math.min(absorbed, e.helmetHp);
      e.helmetHp -= absorbed;
      amount -= absorbed;
      if (e.helmetHp <= 0) {
        e.helmetHp = 0;
        helmetLost = true;
      }
    }
    applied += Math.min(amount, e.hp);
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

  /** Удаляет тело, предварительно разбудив всех, кто его касается (иначе они зависнут спящими); касание — в supportLost. */
  remove(e: Ent): void {
    if (!this.ents.has(e.id)) return;
    e.dead = true;
    let touched = false;
    for (let ce = e.body.getContactList(); ce; ce = ce.next) {
      if (!ce.other?.isDynamic()) continue;
      ce.other.setAwake(true);
      touched ||= ce.contact.isTouching();
    }
    if (touched) this.supportLost++;
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
      if (e.kind !== 'tnt') continue;
      if (cause === 'blast') this.chain.push({ at: this.stepNo + CHAIN_STEPS, x, y });
      else this.explode(x, y, 'tnt');
    }
    this.kills.length = 0;
  }

  /** За границами мира: свинья считается убитой, блоки, TNT и яйца исчезают молча. Птиц убирает игровой слой. */
  private cull(): void {
    const lost: Ent[] = [];
    for (const e of this.ents.values()) {
      if (e.dead || e.kind === 'terrain' || e.kind === 'bird') continue;
      const p = e.body.getPosition();
      if (!this.outOfBounds(p.x, p.y)) continue;
      if (e.kind === 'pig') this.kill(e, 'culled');
      else lost.push(e);
    }
    for (const e of lost) this.remove(e);
  }

  /** Быстрые обломки на время получают CCD, чтобы не проходить сквозь доски (00 §1.1). */
  private updateFastBodies(): void {
    for (const e of this.ents.values()) {
      if (!isDestructible(e)) continue;
      const b = e.body;
      if (b.isAwake() && Vec2.lengthSquared(b.getLinearVelocity()) > FAST_V2) {
        if (e.fastUntil === 0) b.setBullet(true);
        e.fastUntil = this.stepNo + FAST_STEPS;
      } else if (e.fastUntil !== 0 && this.stepNo >= e.fastUntil) {
        e.fastUntil = 0;
        b.setBullet(false);
      }
    }
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

  /** Радиальный импульс с линейным спадом по расстоянию до поверхности тела и капом Δv (00 §1.8). */
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

  /** Живые динамические сущности, чьи AABB пересекают квадрат ±r вокруг точки (без дублей — запрос идёт по фикстурам). */
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

  /** Круг радиуса r в точке p пересекает рельеф, блок, TNT или свинью. */
  overlapsSolid(p: Vec, r: number): boolean {
    const probe = new Circle(r);
    const xf = new Transform(p, 0);
    let hit = false;
    this.world.queryAABB({ lowerBound: { x: p.x - r, y: p.y - r }, upperBound: { x: p.x + r, y: p.y + r } }, (f) => {
      const e = f.getBody().getUserData() as Ent;
      if (e.kind === 'bird' || e.kind === 'egg' || e.dead) return true;
      hit = testOverlap(probe, 0, f.getShape(), 0, xf, f.getBody().getTransform());
      return !hit;
    });
    return hit;
  }
}
