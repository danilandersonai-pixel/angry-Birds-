// Игровая сессия: конечный автомат уровня (01 §13), рогатка, птицы и способности, очки, события
// и снимки для отрисовки. Время идёт только в step() — ровно 1/60 с; случайность — только Rng(seed).

import { ABILITY, BIRD_FLIGHT, IMPACT_FX, LAUNCH, PIG_MOOD, SCORE, SETTLE, SLINGSHOT, TIMING, WORLD } from '../../config/constants';
import type { CreateSession, EntityView, GameSession, QueuedBirdView, SlingshotView, TrailPoint } from '../api';
import { BIRD_DEFS } from '../characters';
import type { GameEvent, ImpactSurface, SessionState } from '../events';
import { isDestructible, type BirdEnt, type Destructible, type Ent, type Hit } from '../physics/entities';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Rng } from '../rng';
import type { BirdType, LevelDef, Vec } from '../types';
import { silverSlam, useAbility, type AbilityHost } from './abilities';
import { createFlyer, updateRetire, type Flyer } from './Flyer';
import { Scoring, starsFor } from './Scoring';
import { Slingshot } from './Slingshot';
import { Trail } from './Trail';
import { birdView, entityView, View } from './views';

const DT = WORLD.DT;
const SLEEP_STEPS = Math.round(SETTLE.SLEEP_HOLD / DT);

interface PigMood {
  laughFrom: number;
  laughUntil: number;
  scaredUntil: number;
}

function surfaceOf(e: Ent): ImpactSurface {
  switch (e.kind) {
    case 'block':
      return e.material;
    case 'terrain':
      return 'ground';
    default:
      return e.kind;
  }
}

function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

/** Кратчайшая разность углов в (−π, π]. */
function angleDelta(from: number, to: number): number {
  const d = (to - from) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d;
}

class Session implements GameSession {
  readonly level: LevelDef;

  private st: SessionState = 'loading';
  private stepCount = 0;
  private now = 0;
  private stateTime = 0;
  private readonly rng: Rng;
  private readonly physics: PhysicsWorld;
  private readonly host: AbilityHost;
  private readonly sling: Slingshot;
  private readonly scoring = new Scoring();
  private readonly path = new Trail();
  private readonly views = new Map<number, View>();
  private viewList: View[] = [];
  private viewsDirty = true;
  private events: GameEvent[] = [];
  /** Ещё не запущенные птицы; первая — в кармашке (loaded) или летит туда (loading). */
  private readonly birds: BirdType[];
  /** Птица в кармашке: вид без тела, тело создаётся при выстреле с тем же id. */
  private loaded: View | null = null;
  private flyers: Flyer[] = [];
  private eggId: number | null = null;
  private pigs = 0;
  private pigsAtLaunch = 0;
  private victoryTime = 0;
  private quietSteps = 0;
  private bonusAwarded = 0;
  private aimAngle = 0;
  private stretchBucket = -1;
  private readonly moods = new Map<number, PigMood>();
  private readonly impacts: Hit[] = [];
  private readonly pairTime = new Map<string, number>();
  /** Высота земли под местами очереди. */
  private readonly spotGround: number[];
  /** События и очки идут только после усадки уровня. */
  private live = false;

  constructor(level: LevelDef, seed: number) {
    this.level = level;
    this.rng = new Rng(seed);
    this.birds = level.birds.slice();
    this.sling = new Slingshot(level.slingshot);
    this.physics = new PhysicsWorld(level, this.rng, {
      added: (e) => this.onAdded(e),
      hit: (h) => this.onHit(h),
      damaged: (e, applied, stageChanged, helmetLost) => this.onDamaged(e, applied, stageChanged, helmetLost),
      killed: (e) => this.onKilled(e),
      removed: (e) => this.onRemoved(e),
      exploded: (x, y, radius, source) => {
        if (this.live) this.emit({ type: 'explosion', x, y, radius, source });
      },
    });
    this.host = {
      physics: this.physics,
      now: () => this.now,
      spawnBird: (parent, type, pos, vel, angle, spin) => {
        const ent = this.physics.addBird(type, this.physics.allocId(), this.rng.next(), pos, vel, angle);
        ent.body.setAngularVelocity(spin);
        this.flyers.push(createFlyer(ent, parent.launchTime, false));
      },
      spawnEgg: (pos, vel) => {
        this.eggId = this.physics.addEgg(pos, vel).id;
      },
      explodeBomb: (f) => {
        const { x, y } = f.ent.body.getPosition();
        this.flyers = this.flyers.filter((g) => g !== f);
        this.physics.remove(f.ent);
        this.physics.detonate(x, y, 'bomb');
      },
    };
    this.physics.presettle();
    for (const v of this.views.values()) {
      if (v.ent) v.readBody(v.ent.body);
      v.savePrev();
    }
    this.spotGround = this.birds.map((_, i) => {
      const y = this.physics.groundBelow(this.spotX(i), level.bounds.maxY);
      return Number.isNaN(y) ? this.sling.base.y : y;
    });
    this.live = true;
    if (this.birds.length === 0) this.st = 'settling';
  }

  // ── Состояние ────────────────────────────────────────────────

  get state(): SessionState {
    return this.st;
  }
  get score(): number {
    return this.scoring.score;
  }
  get time(): number {
    return this.now;
  }
  get pigsLeft(): number {
    return this.pigs;
  }
  get birdsLeft(): number {
    return this.birds.length;
  }

  stars(): number {
    return this.st === 'lost' ? 0 : starsFor(this.scoring.score, this.level.stars);
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ── Шаг ──────────────────────────────────────────────────────

  step(): void {
    for (const v of this.views.values()) v.savePrev();
    for (const f of this.flyers) if (f.control && !f.control(DT)) f.control = null;
    this.stepCount++;
    this.now = this.stepCount * DT;
    this.physics.step();
    this.flushImpacts();
    this.updateFlyers();
    this.sling.update(DT, this.loaded !== null, this.carryTarget());
    this.updateLoaded();
    this.updateCalm();
    this.updateState();
    this.syncViews();
  }

  private updateFlyers(): void {
    for (const f of this.flyers.slice()) {
      if (f.fuseAt !== null && this.now >= f.fuseAt) {
        this.triggerAbility(f); // автоподрыв Бомба
        continue;
      }
      if (f.hitTime === null) this.path.follow(f);
      const p = f.ent.body.getPosition();
      if (this.physics.outOfBounds(p.x, p.y) || updateRetire(f, this.now)) this.retire(f);
    }
  }

  private retire(f: Flyer): void {
    const { x, y } = f.ent.body.getPosition();
    this.emit({ type: 'birdRemoved', id: f.ent.id, bird: f.ent.type, x, y });
    this.flyers = this.flyers.filter((g) => g !== f);
    this.physics.remove(f.ent);
  }

  private carryTarget() {
    const f = this.flyers.find((g) => g.primary);
    if (!f) return null;
    const p = f.ent.body.getPosition();
    const v = f.ent.body.getLinearVelocity();
    return { x: p.x, y: p.y, vx: v.x, vy: v.y };
  }

  /** Птица в кармашке: следует за ним, при прицеливании разворачивается по направлению выстрела. */
  private updateLoaded(): void {
    if (!this.loaded) return;
    const p = this.sling.pocket;
    const target = this.st === 'aiming' && this.sling.pull > 0.05 ? Math.atan2(this.sling.anchor.y - p.y, this.sling.anchor.x - p.x) : 0;
    this.aimAngle += angleDelta(this.aimAngle, target) * (1 - Math.exp(-DT / LAUNCH.AIM_ANGLE_TAU));
    this.loaded.place(p.x, p.y, this.aimAngle);
    this.loaded.birdPose = this.st === 'aiming' ? 'aim' : 'idle';
  }

  /** Детектор покоя; после SLEEP_HOLD тишины — принудительный сон (иначе ползущие тела не засыпают, 03 §2.7). */
  private updateCalm(): void {
    const busy = this.flyers.some((f) => f.control !== null || f.fuseAt !== null);
    this.quietSteps = !busy && this.physics.isQuiet() ? this.quietSteps + 1 : 0;
    if (this.quietSteps >= SLEEP_STEPS && this.physics.anyAwake()) this.physics.sleepAll();
  }

  private calm(seconds: number): boolean {
    return this.quietSteps * DT >= seconds - 1e-9;
  }

  private updateState(): void {
    const t = this.now - this.stateTime;
    switch (this.st) {
      case 'loading':
        if (t >= TIMING.BIRD_HOP_TIME - 1e-9) {
          this.landBird();
          this.go(this.pigs > 0 ? 'ready' : 'settling');
        }
        break;
      case 'ready':
        if (this.pigs === 0) this.go('settling'); // новый захват после победы запрещён (01 §8)
        break;
      case 'flying':
        if (this.flyers.length === 0 && this.eggId === null) this.endShot();
        break;
      case 'settling':
        this.updateSettling(t);
        break;
      case 'bonus':
        this.updateBonus(t);
        break;
    }
  }

  private updateSettling(t: number): void {
    if (this.pigs === 0) {
      const since = this.now - this.victoryTime;
      if (since >= TIMING.VICTORY_MIN && (this.calm(TIMING.VICTORY_HOLD) || since >= TIMING.VICTORY_MAX)) this.go('bonus');
    } else if (this.birds.length > 0) {
      if (t >= TIMING.TURN_MAX || (t >= TIMING.TURN_MIN && this.calm(TIMING.CALM_HOLD))) this.go('loading');
    } else if (t >= TIMING.LOSE_TIMEOUT || this.calm(TIMING.LOSE_HOLD)) {
      this.finish(false);
    }
  }

  /** Подсчёт оставшихся птиц: сначала из кармашка, затем очередь справа налево (01 §10). */
  private updateBonus(t: number): void {
    const start = TIMING.CLEARED_BANNER + TIMING.BONUS_PRE;
    const n = this.birds.length;
    while (this.bonusAwarded < n && t >= start + this.bonusAwarded * TIMING.BONUS_PER_BIRD - 1e-9) {
      this.awardBird(this.bonusAwarded++);
    }
    if (t >= start + n * TIMING.BONUS_PER_BIRD - 1e-9) this.finish(true);
  }

  private awardBird(i: number): void {
    const type = this.birds[i];
    const pos = this.loaded && i === 0 ? this.sling.pocket : this.spot(this.loaded ? i - 1 : i, type);
    const points = SCORE.UNUSED_BIRD;
    this.scoring.bonus(points);
    this.emit({ type: 'birdBonus', bird: type, x: pos.x, y: pos.y, points });
    this.emit({ type: 'score', points, x: pos.x, y: pos.y, kind: 'bonus' });
  }

  private finish(won: boolean): void {
    this.scoring.locked = true;
    this.go(won ? 'won' : 'lost');
    this.emit({ type: 'levelEnd', won, score: this.scoring.score, stars: this.stars() });
  }

  private go(to: SessionState): void {
    const from = this.st;
    if (from === to) return;
    this.st = to;
    this.stateTime = this.now;
    if (to === 'bonus') this.scoring.locked = true; // очки физики замораживаются (01 §10)
    this.emit({ type: 'stateChanged', from, to });
  }

  private landBird(): void {
    const type = this.birds[0];
    const v = birdView(this.physics.allocId(), type, this.rng.next());
    this.sling.land();
    v.place(this.sling.pocket.x, this.sling.pocket.y, 0);
    v.savePrev();
    this.loaded = v;
    this.aimAngle = 0;
    this.views.set(v.id, v);
    this.viewsDirty = true;
    this.emit({ type: 'birdLoaded', bird: type });
  }

  private endShot(): void {
    if (this.pigs > 0 && this.pigs === this.pigsAtLaunch) {
      this.emit({ type: 'pigsLaugh' });
      for (const m of this.moods.values()) {
        m.laughFrom = this.now + this.rng.range(0, PIG_MOOD.LAUGH_JITTER);
        m.laughUntil = m.laughFrom + PIG_MOOD.LAUGH_TIME;
      }
    }
    this.go('settling');
  }

  /** Самые сильные удары шага, не чаще PAIR_COOLDOWN для одной пары тел. */
  private flushImpacts(): void {
    if (this.impacts.length > 0) {
      this.impacts.sort((p, q) => q.J - p.J);
      let sent = 0;
      for (const h of this.impacts) {
        if (sent >= IMPACT_FX.MAX_PER_STEP) break;
        const key = h.a.id < h.b.id ? `${h.a.id}:${h.b.id}` : `${h.b.id}:${h.a.id}`;
        const last = this.pairTime.get(key);
        if (last !== undefined && this.now - last < IMPACT_FX.PAIR_COOLDOWN) continue;
        this.pairTime.set(key, this.now);
        this.emit({ type: 'impact', x: h.x, y: h.y, impulse: h.J, a: surfaceOf(h.a), b: surfaceOf(h.b) });
        sent++;
      }
      this.impacts.length = 0;
    }
    if (this.stepCount % 60 === 0) {
      for (const [key, t] of this.pairTime) if (this.now - t >= IMPACT_FX.PAIR_COOLDOWN) this.pairTime.delete(key);
    }
  }

  private syncViews(): void {
    for (const v of this.views.values()) {
      const e = v.ent;
      if (!e) continue;
      v.readBody(e.body);
      if (isDestructible(e)) {
        v.health = Math.max(0, e.hp) / e.maxHp;
        v.damageStage = e.stage;
        if (e.kind === 'pig') v.hasHelmet = e.helmetHp > 0;
      }
    }
    for (const f of this.flyers) {
      const v = this.views.get(f.ent.id);
      if (!v) continue;
      v.birdPose = f.hitTime === null ? 'fly' : this.now - f.hitTime < BIRD_FLIGHT.HURT_TIME ? 'hurt' : 'idle';
      v.abilityUsed = f.abilityUsed;
    }
    this.updatePigMoods();
  }

  /** Свиньи пугаются приближающейся птицы и смеются после промаха (02 §4.3). */
  private updatePigMoods(): void {
    const r2 = PIG_MOOD.SCARED_DIST * PIG_MOOD.SCARED_DIST;
    for (const [id, m] of this.moods) {
      const v = this.views.get(id);
      if (!v) continue;
      for (const f of this.flyers) {
        const p = f.ent.body.getPosition();
        const vel = f.ent.body.getLinearVelocity();
        const dx = v.x - p.x;
        const dy = v.y - p.y;
        if (dx * dx + dy * dy < r2 && dx * vel.x + dy * vel.y > 0) m.scaredUntil = this.now + PIG_MOOD.SCARED_HOLD;
      }
      v.pigPose =
        this.st === 'lost' ? 'laugh'
        : this.now < m.scaredUntil ? 'scared'
        : this.now >= m.laughFrom && this.now < m.laughUntil ? 'laugh'
        : 'idle';
    }
  }

  // ── Обратные вызовы физики ───────────────────────────────────

  private onAdded(e: Ent): void {
    if (e.kind === 'terrain') return;
    const existing = this.views.get(e.id);
    if (existing) {
      existing.ent = e; // птица из кармашка получила тело
      return;
    }
    this.views.set(e.id, entityView(e));
    this.viewsDirty = true;
    if (e.kind === 'pig') {
      this.pigs++;
      this.moods.set(e.id, { laughFrom: 0, laughUntil: 0, scaredUntil: 0 });
    }
  }

  private onRemoved(e: Ent): void {
    this.views.delete(e.id);
    this.moods.delete(e.id);
    this.viewsDirty = true;
    if (e.id === this.eggId) this.eggId = null;
  }

  private onHit(h: Hit): void {
    if (!this.live) return;
    if (h.J >= IMPACT_FX.MIN_J && h.vn >= IMPACT_FX.MIN_VN) this.impacts.push(h);
    if (h.a.kind === 'bird') this.birdContact(h.a, h);
    if (h.b.kind === 'bird') this.birdContact(h.b, h);
  }

  /** Контакт птицы: первый закрывает окно способности, обрывает след и запускает фитиль Бомба. */
  private birdContact(bird: BirdEnt, h: Hit): void {
    const f = this.flyers.find((g) => g.ent === bird);
    if (!f) return;
    if (f.hitTime === null) {
      f.hitTime = this.now;
      f.control = null;
      bird.body.setGravityScale(1);
      const p = bird.body.getPosition();
      this.path.mark(p.x, p.y);
      if (f.diving) silverSlam(this.host, p.x, p.y);
      if (bird.type === 'bomb' && !f.abilityUsed) f.fuseAt = this.now + ABILITY.BOMB.FUSE;
    }
    if (!h.pierced && !f.solidHit) {
      f.solidHit = true;
      if (f.multAfterHit) bird.mult = f.multAfterHit;
      f.multAfterHit = null;
    }
    if (!f.strongHit && (h.pierced || h.J >= IMPACT_FX.BIRD_IMPACT_J)) {
      f.strongHit = true;
      this.emit({ type: 'birdImpact', id: bird.id, bird: bird.type, x: h.x, y: h.y, speed: h.vn });
    }
  }

  private onDamaged(e: Destructible, applied: number, stageChanged: boolean, helmetLost: boolean): void {
    if (!this.live || e.hp <= 0) return; // смертельный удар уходит в очки уничтожения
    this.scoring.damage(e, applied);
    const { x, y } = e.body.getPosition();
    if (e.kind === 'block' && stageChanged && e.stage > 0) {
      this.emit({ type: 'blockDamaged', id: e.id, material: e.material, x, y, stage: e.stage });
    } else if (e.kind === 'pig' && (stageChanged || helmetLost)) {
      this.emit({ type: 'pigDamaged', id: e.id, pig: e.type, x, y, stage: e.stage, helmetLost });
    }
  }

  private onKilled(e: Destructible): void {
    if (e.kind === 'pig' && --this.pigs === 0) this.victoryTime = this.now;
    if (!this.live) return;
    const points = this.scoring.destroy(e);
    const { x, y } = e.body.getPosition();
    switch (e.kind) {
      case 'block': {
        const v = e.body.getLinearVelocity();
        this.emit({
          type: 'blockDestroyed', id: e.id, material: e.material, shape: e.shape, x, y, w: e.w, h: e.h,
          angle: e.body.getAngle(), vx: v.x, vy: v.y, points,
        });
        break;
      }
      case 'tnt':
        this.emit({ type: 'tntDestroyed', id: e.id, x, y, points });
        break;
      case 'pig':
        this.emit({ type: 'pigDestroyed', id: e.id, pig: e.type, x, y, radius: e.radius, points });
        break;
    }
    if (points > 0) this.emit({ type: 'score', points, x, y, kind: e.kind === 'tnt' ? 'tnt' : e.kind });
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
  }

  // ── Управление ───────────────────────────────────────────────

  canGrab(p: Vec): boolean {
    if (this.st !== 'ready' || !this.loaded || this.pigs === 0) return false;
    const r = Math.max(LAUNCH.GRAB_RADIUS, BIRD_DEFS[this.birds[0]].radius + LAUNCH.GRAB_MARGIN);
    return Math.hypot(p.x - this.sling.pocket.x, p.y - this.sling.pocket.y) <= r;
  }

  beginAim(): void {
    if (this.st !== 'ready' || !this.loaded || this.pigs === 0) return;
    this.sling.beginAim();
    this.stretchBucket = -1;
    this.go('aiming');
    this.emit({ type: 'aimStart', bird: this.birds[0] });
  }

  updateAim(p: Vec): void {
    if (this.st !== 'aiming' || !this.loaded) return;
    this.sling.aimAt(p, BIRD_DEFS[this.birds[0]].radius);
    this.loaded.place(this.sling.pocket.x, this.sling.pocket.y, this.aimAngle);
    if (this.sling.pull < LAUNCH.R_CANCEL) {
      this.stretchBucket = -1; // ниже порога отмены резина «не натянута»
      return;
    }
    const power = this.sling.power;
    const bucket = Math.floor(power / LAUNCH.STRETCH_STEP + 1e-9);
    if (bucket !== this.stretchBucket) {
      this.stretchBucket = bucket;
      this.emit({ type: 'aimStretch', power });
    }
  }

  release(): void {
    if (this.st !== 'aiming') return;
    if (this.sling.pull < LAUNCH.R_CANCEL) this.cancelAim();
    else this.fire();
  }

  cancelAim(): void {
    if (this.st !== 'aiming') return;
    this.sling.cancel();
    this.go('ready');
    this.emit({ type: 'aimCancel' });
  }

  launch(angleDeg: number, power: number): void {
    if (this.st !== 'ready' || !this.loaded) return;
    this.sling.pullTo(angleDeg, power, BIRD_DEFS[this.birds[0]].radius);
    const dir = this.sling.direction;
    this.aimAngle = power > 0 ? Math.atan2(dir.y, dir.x) : 0;
    this.fire();
  }

  private fire(): void {
    const view = this.loaded;
    if (!view) return;
    const type = this.birds.shift()!;
    const shot = this.sling.shot(BIRD_DEFS[type].launchScale);
    this.loaded = null;
    view.place(shot.pos.x, shot.pos.y, this.aimAngle);
    this.physics.damageEnabled = true;
    const ent = this.physics.addBird(type, view.id, view.seed, shot.pos, shot.vel, this.aimAngle);
    this.flyers = [createFlyer(ent, this.now, true)];
    this.path.clear();
    this.pigsAtLaunch = this.pigs;
    this.sling.release();
    this.go('flying');
    this.emit({ type: 'birdLaunched', id: view.id, bird: type, x: shot.pos.x, y: shot.pos.y, power: shot.power });
  }

  activateAbility(): boolean {
    if (this.st !== 'flying') return false;
    const f = this.flyers.find((g) => g.primary);
    if (!f || f.abilityUsed || this.now - f.launchTime < BIRD_FLIGHT.ABILITY_MIN_DELAY - 1e-9) return false;
    if (f.hitTime !== null && f.ent.type !== 'bomb') return false; // окно — до первого контакта (у Бомба — до взрыва)
    this.triggerAbility(f);
    return true;
  }

  private triggerAbility(f: Flyer): void {
    f.abilityUsed = true;
    f.fuseAt = null;
    const { x, y } = f.ent.body.getPosition();
    this.emit({ type: 'ability', id: f.ent.id, bird: f.ent.type, x, y });
    this.path.mark(x, y);
    useAbility(f, this.host);
  }

  // ── Данные для отрисовки ─────────────────────────────────────

  entities(): Iterable<EntityView> {
    if (this.viewsDirty) {
      this.viewList = [...this.views.values()];
      this.viewsDirty = false;
    }
    return this.viewList;
  }

  private spotX(i: number): number {
    return this.sling.base.x - SLINGSHOT.QUEUE_X0 - i * SLINGSHOT.QUEUE_DX;
  }

  private spot(i: number, type: BirdType): Vec {
    return { x: this.spotX(i), y: this.spotGround[i] + BIRD_DEFS[type].radius };
  }

  /** Очередь у рогатки; в состоянии loading первая птица прыгает в кармашек, остальные сдвигаются (01 §5.3). */
  queue(): readonly QueuedBirdView[] {
    const waiting = this.loaded ? this.birds.slice(1) : this.birds;
    const t = this.now - this.stateTime;
    const hopping = this.st === 'loading';
    return waiting.map((type, i) => {
      const radius = BIRD_DEFS[type].radius;
      if (!hopping) return { type, radius, ...this.spot(i, type) };
      if (i === 0) {
        const u = Math.min(1, t / TIMING.BIRD_HOP_TIME);
        const from = this.spot(0, type);
        const to = this.sling.anchor;
        return {
          type, radius,
          x: from.x + (to.x - from.x) * u,
          y: from.y + (to.y - from.y) * u + 4 * TIMING.BIRD_HOP_HEIGHT * u * (1 - u),
        };
      }
      const k = easeInOutSine(Math.min(1, t / TIMING.QUEUE_SHIFT_TIME));
      const from = this.spot(i, type);
      const to = this.spot(i - 1, type);
      return { type, radius, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    });
  }

  slingshot(): SlingshotView {
    return {
      anchor: this.sling.anchor,
      backFork: this.sling.backFork,
      frontFork: this.sling.frontFork,
      pocket: { x: this.sling.pocket.x, y: this.sling.pocket.y },
      power: this.sling.power,
      loaded: this.loaded ? this.birds[0] : null,
    };
  }

  trail(): readonly TrailPoint[] {
    return this.path.points;
  }

  /** Камера следит за яйцом Матильды, пока оно летит, иначе — за птицей из рогатки (или её сестрой). */
  focusBird(): EntityView | null {
    if (this.eggId !== null) return this.views.get(this.eggId) ?? null;
    const f = this.flyers.find((g) => g.primary) ?? this.flyers[0];
    return f ? (this.views.get(f.ent.id) ?? null) : null;
  }

  /** Тем же интегратором, что planck (полунеявный Эйлер, шаг 1/60): точка каждые PREDICT_STRIDE шагов. */
  predictTrajectory(n: number): Vec[] {
    if (this.st !== 'aiming' || !this.loaded || this.sling.pull < LAUNCH.R_CANCEL) return [];
    const shot = this.sling.shot(BIRD_DEFS[this.birds[0]].launchScale);
    let { x, y } = shot.pos;
    const vx = shot.vel.x;
    let vy = shot.vel.y;
    const out: Vec[] = [];
    for (let k = 1; out.length < n; k++) {
      vy += WORLD.GRAVITY * DT;
      x += vx * DT;
      y += vy * DT;
      if (k % LAUNCH.PREDICT_STRIDE === 0) out.push({ x, y });
    }
    return out;
  }
}

export const createSession: CreateSession = (level, opts) => new Session(level, opts?.seed ?? 1);
