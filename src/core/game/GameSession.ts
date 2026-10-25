// Игровая сессия: конечный автомат уровня с таймингами 00 §1.12, рогатка, птицы и способности, очки, события
// и снимки для отрисовки. Время идёт только в step() — ровно 1/60 с; случайность — только Rng(seed).

import { ABILITY, BIRD_FLIGHT, CAMERA, LAUNCH, PIG_MOOD, RETIRE, SCORE, SETTLE, TIMING, WORLD } from '../../config/constants';
import type { BirdPose, CreateSession, EntityView, GameSession, QueuedBirdView, SlingshotView, TrailPoint } from '../api';
import { BIRD_DEFS } from '../characters';
import type { GameEvent, SessionState } from '../events';
import { isDestructible, type BirdEnt, type Destructible, type Ent, type Hit } from '../physics/entities';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Rng } from '../rng';
import type { BirdType, LevelDef, PigType, Vec } from '../types';
import { silverSlam, useAbility, type AbilityHost } from './abilities';
import { BirdQueue } from './BirdQueue';
import { canTrigger, createFlyer, hasAbility, updateRetire, type Flyer } from './Flyer';
import { ImpactFilter } from './impacts';
import { PigMoods, type Threat } from './moods';
import { Scoring, starsFor } from './Scoring';
import { Slingshot } from './Slingshot';
import { Trail } from './Trail';
import { birdView, centroidInto, entityView, frozenCopy, View } from './views';

const DT = WORLD.DT;
const EPS = 1e-9;
const SLEEP_STEPS = Math.round(SETTLE.SLEEP_HOLD / DT);

/** Кратчайшая разность углов в (−π, π]. */
function angleDelta(from: number, to: number): number {
  const d = (to - from) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d <= -Math.PI ? d + 2 * Math.PI : d;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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
  private readonly birdQueue: BirdQueue;
  private readonly scoring = new Scoring();
  private readonly path = new Trail();
  private readonly impacts = new ImpactFilter();
  private readonly moods = new PigMoods();
  private readonly views = new Map<number, View>();
  private viewList: View[] = [];
  private viewsDirty = true;
  private events: GameEvent[] = [];
  /** Ещё не запущенные птицы; первая — в кармашке (loaded) или летит туда (loading). */
  private readonly birds: BirdType[];
  /** Птица в кармашке: вид без тела, тело создаётся при выстреле с тем же id. */
  private loaded: View | null = null;
  /** Птицы текущего выстрела (у Синих после разделения — три). */
  private flyers: Flyer[] = [];
  private eggId: number | null = null;
  /** Цель камеры: птица, центроид Синих, яйцо или точка его взрыва. */
  private focus: View | null = null;
  private groupView: View | null = null;
  private eggHold: View | null = null;
  private lastFocusX = 0;
  private shots = 0;
  private pigs = 0;
  private pigsAtLaunch = 0;
  /** Все свиньи погибли: новый захват запрещён, ждём доигрыша и покоя (VICTORY_DELAY). */
  private victoryPending = false;
  private victoryTime = 0;
  private quietSteps = 0;
  /** Последнее учтённое значение PhysicsWorld.supportLost. */
  private seenSupportLost = 0;
  /** Время (от входа в settling) конца задержки камеры на месте событий; null — ещё задерживается. */
  private lingerEnd: number | null = null;
  /** Время возврата камеры к рогатке перед следующей птицей. */
  private returnTime = 0;
  /** Камера держится на месте событий до этого времени: последнее разрушение + BREAK_QUIET (взрыв — BLAST_QUIET). */
  private quietAt = -Infinity;
  private bonusAwarded = 0;
  private aimAngle = 0;
  private lastStretch = 0;
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
        if (!this.live) return;
        this.noteBreak(TIMING.BLAST_QUIET);
        this.emit({ type: 'explosion', x, y, radius, source });
      },
    });
    this.host = {
      physics: this.physics,
      now: () => this.now,
      spawnBird: (parent, type, pos, vel, angle, spin) => {
        const ent = this.physics.addBird(type, this.physics.allocId(), this.rng.next(), pos, vel, angle, parent.group);
        ent.body.setAngularVelocity(spin);
        this.flyers.push(createFlyer(ent, parent.launchTime, false, parent.group));
      },
      spawnEgg: (parent, pos, vel) => {
        this.eggId = this.physics.addEgg(pos, vel, parent.group).id;
      },
      explodeBomb: (f) => {
        const { x, y } = f.ent.body.getPosition();
        this.flyers = this.flyers.filter((g) => g !== f);
        this.physics.remove(f.ent);
        this.physics.detonate(x, y, 'bomb');
      },
    };
    this.birdQueue = new BirdQueue(this.sling.base, (x) => this.physics.groundBelow(x, level.bounds.maxY));
    this.physics.presettle();
    for (const v of this.views.values()) {
      if (v.ent) v.readBody(v.ent.body);
      v.savePrev();
    }
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
    this.impacts.flush(this.now, (e) => this.emit(e));
    this.updateFlyers();
    this.sling.update(DT, this.loaded !== null, this.carryTarget());
    this.updateLoaded();
    this.updateCalm();
    this.updateState();
    this.syncViews();
  }

  private updateFlyers(): void {
    for (const f of this.flyers.slice()) {
      // усиление Чака действует весь шаг первого контакта (урон считается после колбэка hit) и снимается после него
      if (f.multAfterHit && f.hitTime !== null) {
        f.ent.mult = f.multAfterHit;
        f.multAfterHit = null;
      }
      if (f.fuseAt !== null && this.now >= f.fuseAt - EPS) {
        this.triggerAbility(f); // автоподрыв Бомба
        continue;
      }
      if (f.hitTime === null) this.path.follow(f);
      if (this.birdOut(f.ent.body.getPosition()) || updateRetire(f, this.now)) this.retire(f);
    }
  }

  /** Птица «уходит» раньше, чем тело удалила бы физика: за bounds ± OUT_MARGIN или ниже границы мира. */
  private birdOut(p: Vec): boolean {
    const b = this.level.bounds;
    return p.y < this.physics.killY || p.x < b.minX - RETIRE.OUT_MARGIN || p.x > b.maxX + RETIRE.OUT_MARGIN;
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

  /**
   * Детектор покоя (00 §1.9): тихий шаг — все тела медленные, нет фитилей, дуг, отложенных взрывов и яйца.
   * После SLEEP_HOLD тишины без птиц и снарядов — принудительный сон (иначе ползущие тела не засыпают).
   */
  private updateCalm(): void {
    const busy = this.flyers.some((f) => f.control !== null || f.fuseAt !== null);
    // удаление (уход птицы, взрыв Бомба, гибель тела) лишило кого-то опоры: покоя ещё нет
    const shaken = this.physics.supportLost !== this.seenSupportLost;
    this.seenSupportLost = this.physics.supportLost;
    this.quietSteps = !busy && !shaken && this.physics.isQuiet() ? this.quietSteps + 1 : 0;
    if (this.quietSteps >= SLEEP_STEPS && this.flyers.length === 0 && this.eggId === null && this.physics.anyAwake()) {
      this.physics.sleepAll();
    }
  }

  private calm(seconds: number): boolean {
    return this.quietSteps * DT >= seconds - EPS;
  }

  private updateState(): void {
    if (this.pigs === 0 && !this.victoryPending && !this.ended()) {
      this.victoryPending = true;
      this.victoryTime = this.now;
    }
    const t = this.now - this.stateTime;
    switch (this.st) {
      case 'loading':
        if (t >= TIMING.BIRD_HOP_TIME - EPS) {
          this.landBird();
          this.go('ready');
        }
        break;
      case 'flying':
        if (this.flyers.length === 0 && this.eggId === null) this.endShot();
        break;
      case 'settling':
        if (!this.victoryPending) this.updateSettling(t);
        break;
      case 'bonus':
        this.updateBonus(t);
        return;
    }
    if (this.victoryPending && this.victoryReady()) {
      this.victoryPending = false;
      this.go('bonus');
    }
  }

  private ended(): boolean {
    return this.st === 'bonus' || this.st === 'won' || this.st === 'lost';
  }

  /** VICTORY_DELAY: начатый прицел и полёт доигрываются, затем не меньше 1.2 с и покой 0.4 с (или 3.5 с). */
  private victoryReady(): boolean {
    if (this.st === 'loading' || this.st === 'aiming' || this.flyers.length > 0 || this.eggId !== null) return false;
    const since = this.now - this.victoryTime;
    return since >= TIMING.VICTORY_MIN - EPS && (this.calm(TIMING.VICTORY_HOLD) || since >= TIMING.VICTORY_MAX - EPS);
  }

  /**
   * После ухода птицы: задержка камеры (LINGER_MIN, пока идут разрушения, ≤ LINGER_MAX) и её возврат; следующая птица
   * прыгает в кармашек за BIRD_HOP_TIME до приезда камеры. Без птиц — ждём итог.
   */
  private updateSettling(t: number): void {
    if (this.birds.length > 0) {
      if (this.lingerEnd === null && t >= TIMING.LINGER_MIN - EPS && (this.now >= this.quietAt - EPS || t >= TIMING.LINGER_MAX - EPS)) {
        this.lingerEnd = t;
      }
      if (this.lingerEnd !== null && t >= this.lingerEnd + Math.max(0, this.returnTime - TIMING.BIRD_HOP_TIME) - EPS) this.go('loading');
    } else if (t >= TIMING.LOSE_TIMEOUT - EPS || this.calm(TIMING.LOSE_HOLD)) {
      this.finish(false);
    }
  }

  /** Баннер, затем по птице: сначала из кармашка, потом очередь справа налево (00 §1.12). */
  private updateBonus(t: number): void {
    const start = TIMING.CLEARED_BANNER + TIMING.BONUS_PRE;
    const n = this.birds.length;
    while (this.bonusAwarded < n && t >= start + this.bonusAwarded * TIMING.BONUS_PER_BIRD - EPS) {
      this.awardBird(this.bonusAwarded++);
    }
    const end = n > 0 ? start + n * TIMING.BONUS_PER_BIRD + TIMING.BONUS_POST : TIMING.CLEARED_BANNER + TIMING.BONUS_NONE;
    if (t >= end - EPS) this.finish(true);
  }

  private awardBird(i: number): void {
    const type = this.birds[i];
    let pos: Vec;
    if (this.loaded && i === 0) pos = this.sling.pocket;
    else {
      const waiting = this.loaded ? this.birds.slice(1) : this.birds;
      pos = this.birdQueue.layout(waiting)[this.loaded ? i - 1 : i];
    }
    const points = SCORE.UNUSED_BIRD;
    this.scoring.bonus(points);
    this.emit({ type: 'birdBonus', bird: type, x: pos.x, y: pos.y, points });
    this.emit({ type: 'score', points, x: pos.x, y: pos.y, kind: 'bonus' });
  }

  private finish(won: boolean): void {
    this.scoring.locked = true;
    // после поражения сцена доигрывается только визуально: без урона (и от взрывов) свиньи не гибнут под окном итога
    if (!won) this.physics.damageEnabled = false;
    this.go(won ? 'won' : 'lost');
    this.emit({ type: 'levelEnd', won, score: this.scoring.score, stars: this.stars() });
  }

  private go(to: SessionState): void {
    const from = this.st;
    if (from === to) return;
    this.st = to;
    this.stateTime = this.now;
    if (to === 'bonus') this.scoring.locked = true; // очки физики замораживаются, сцена идёт визуально
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

  /** Все птицы выстрела ушли: смех после промаха, время возврата камеры от места ухода к рогатке. */
  private endShot(): void {
    if (this.pigs > 0 && this.pigs === this.pigsAtLaunch) {
      this.emit({ type: 'pigsLaugh', pigs: this.livePigs() });
      this.moods.laugh(this.now, this.rng);
    }
    const C = CAMERA;
    this.returnTime = clamp(C.RETURN_BASE + Math.abs(this.lastFocusX - this.sling.anchor.x) * C.RETURN_PER_M, C.RETURN_MIN, C.RETURN_MAX);
    this.lingerEnd = null;
    this.eggHold = null;
    this.go('settling');
  }

  private livePigs(): PigType[] {
    const out: PigType[] = [];
    for (const e of this.physics.ents.values()) if (e.kind === 'pig' && !e.dead) out.push(e.type);
    return out;
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
    const threats: Threat[] = [];
    for (const f of this.flyers) {
      const v = this.views.get(f.ent.id);
      if (!v) continue;
      v.birdPose = this.birdPose(f);
      v.abilityUsed = f.abilityUsed;
      threats.push({ p: { x: v.x, y: v.y }, v: { x: v.vx, y: v.vy } });
    }
    for (const v of this.views.values()) {
      if (v.kind === 'pig') v.pigPose = this.moods.pose(v.id, v, this.now, threats, this.st === 'lost');
    }
    this.updateFocus();
  }

  private birdPose(f: Flyer): BirdPose {
    if (this.now < f.frownUntil) return 'aim';
    if (f.hitTime === null) return 'fly';
    return this.now - f.hitTime < BIRD_FLIGHT.HURT_TIME ? 'hurt' : 'idle';
  }

  /** Камера: яйцо Матильды до взрыва, затем точка взрыва; Синие — центроид живых сестёр; иначе птица. */
  private updateFocus(): void {
    let f: View | null = null;
    if (this.eggId !== null) f = this.views.get(this.eggId) ?? null;
    else if (this.eggHold) f = this.eggHold;
    else {
      const members: View[] = [];
      for (const g of this.flyers) {
        const v = this.views.get(g.ent.id);
        if (v) members.push(v);
      }
      if (members.length === 1) f = members[0];
      else if (members.length > 1) {
        this.groupView ??= birdView(members[0].id, members[0].birdType!, members[0].seed);
        centroidInto(this.groupView, members);
        f = this.groupView;
      }
    }
    this.focus = f;
    if (f) this.lastFocusX = f.x;
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
      this.moods.add(e.id);
    }
  }

  private onRemoved(e: Ent): void {
    const v = this.views.get(e.id);
    this.views.delete(e.id);
    this.moods.remove(e.id);
    this.viewsDirty = true;
    if (e.id !== this.eggId) return;
    this.eggId = null;
    if (v && this.flyers.length > 0) {
      const p = e.body.getPosition();
      this.eggHold = frozenCopy(v, p.x, p.y); // камера держит точку взрыва, пока Матильда улетает
    }
  }

  private onHit(h: Hit): void {
    if (!this.live) return;
    this.impacts.add(h);
    if (h.pierced) return; // пробитие — не первый контакт: окно способности и след не закрываются
    if (h.a.kind === 'bird') this.birdContact(h.a, h);
    if (h.b.kind === 'bird') this.birdContact(h.b, h);
  }

  /** Первый контакт птицы: закрывает окно способности, обрывает след и дуги, запускает фитиль Бомба (00 §1.3). */
  private birdContact(bird: BirdEnt, h: Hit): void {
    const f = this.flyers.find((g) => g.ent === bird);
    if (!f || f.hitTime !== null) return;
    f.hitTime = this.now;
    if (f.control) {
      f.control = null;
      bird.body.setGravityScale(1);
    }
    const p = bird.body.getPosition();
    this.path.mark(p.x, p.y);
    if (f.diving) silverSlam(this.host, p.x, p.y);
    if (bird.type === 'bomb' && !f.abilityUsed) f.fuseAt = this.now + ABILITY.BOMB.FUSE;
    this.emit({ type: 'birdImpact', id: bird.id, bird: bird.type, x: h.x, y: h.y, speed: h.vn });
  }

  /** Урон: очки начисляются молча; смертельный удар уходит в очки уничтожения, но слетевшая каска видна всегда. */
  private onDamaged(e: Destructible, applied: number, stageChanged: boolean, helmetLost: boolean): void {
    if (!this.live) return;
    const lethal = e.hp <= 0;
    if (!lethal) this.scoring.damage(e, applied);
    const { x, y } = e.body.getPosition();
    if (e.kind === 'block') {
      if (!lethal && stageChanged && e.stage > 0) this.emit({ type: 'blockDamaged', id: e.id, material: e.material, x, y, stage: e.stage });
    } else if (e.kind === 'pig' && (helmetLost || (!lethal && (stageChanged || applied >= PIG_MOOD.FLINCH_DMG)))) {
      this.emit({ type: 'pigDamaged', id: e.id, pig: e.type, x, y, stage: e.stage, helmetLost });
    }
  }

  private onKilled(e: Destructible): void {
    // исход записан в levelEnd: свинья, упавшая за край мира после поражения, не меняет счётчик и не даёт событий
    if (this.st === 'lost') return;
    if (e.kind === 'pig') this.pigs--;
    if (!this.live) return;
    this.noteBreak(TIMING.BREAK_QUIET);
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
    if (points > 0) this.emit({ type: 'score', points, x, y, kind: e.kind });
  }

  private emit(e: GameEvent): void {
    this.events.push(e);
  }

  /** Разрушение или взрыв: камера не уедет с места событий раньше чем через quiet секунд. */
  private noteBreak(quiet: number): void {
    this.quietAt = Math.max(this.quietAt, this.now + quiet);
  }

  // ── Управление ───────────────────────────────────────────────

  private canAim(): boolean {
    return this.st === 'ready' && this.loaded !== null && !this.victoryPending;
  }

  canGrab(p: Vec): boolean {
    return this.canAim() && Math.hypot(p.x - this.sling.pocket.x, p.y - this.sling.pocket.y) <= LAUNCH.GRAB_RADIUS;
  }

  beginAim(): void {
    if (!this.canAim()) return;
    this.sling.beginAim();
    this.lastStretch = 0;
    this.go('aiming');
    this.emit({ type: 'aimStart', bird: this.birds[0] });
  }

  updateAim(p: Vec): void {
    if (this.st !== 'aiming' || !this.loaded) return;
    this.sling.aimAt(p, BIRD_DEFS[this.birds[0]].radius);
    this.loaded.place(this.sling.pocket.x, this.sling.pocket.y, this.aimAngle);
    if (this.sling.pull < LAUNCH.R_CANCEL) return; // ниже порога отмены резина «не скрипит»
    const power = this.sling.power;
    if (Math.abs(power - this.lastStretch) >= LAUNCH.STRETCH_STEP - EPS) {
      this.lastStretch = power;
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
    if (!this.canAim()) return;
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
    view.birdPose = 'fly';
    this.physics.damageEnabled = true;
    this.shots++;
    const group = -this.shots; // свой groupIndex на выстрел
    const ent = this.physics.addBird(type, view.id, view.seed, shot.pos, shot.vel, this.aimAngle, group);
    this.flyers = [createFlyer(ent, this.now, true, group)];
    this.path.clear();
    this.groupView = null;
    this.eggHold = null;
    this.pigsAtLaunch = this.pigs;
    this.quietAt = -Infinity;
    this.sling.release();
    this.go('flying');
    this.emit({ type: 'birdLaunched', id: view.id, bird: type, x: shot.pos.x, y: shot.pos.y, power: shot.power });
    this.updateFocus();
  }

  /**
   * Тап в полёте: способность (окно 00 §1.4); у птицы без способности — только сведённые брови;
   * если способности нет или она израсходована и с первого контакта прошло ≥ 1 с — быстрый пропуск (00 §1.9).
   */
  activateAbility(): boolean {
    if (this.st !== 'flying' || this.flyers.length === 0) return false;
    if (this.now - this.flyers[0].launchTime < BIRD_FLIGHT.ABILITY_MIN_DELAY - EPS) return false; // дребезг пальца
    const f = this.flyers.find((g) => g.primary);
    let used = false;
    if (f && canTrigger(f, this.now)) {
      this.triggerAbility(f);
      used = true;
    } else if (f && !hasAbility(f.ent.type) && f.hitTime === null) {
      f.frownUntil = this.now + BIRD_FLIGHT.FROWN_TIME;
    } else if (this.canQuickSkip()) {
      for (const g of this.flyers.slice()) this.retire(g);
    }
    this.updateFocus();
    return used;
  }

  private canQuickSkip(): boolean {
    return this.eggId === null && this.flyers.every(
      (g) => g.hitTime !== null && this.now - g.hitTime >= RETIRE.QUICK_SKIP_AFTER_HIT - EPS && !canTrigger(g, this.now),
    );
  }

  private triggerAbility(f: Flyer): void {
    f.abilityUsed = true;
    f.fuseAt = null;
    const { x, y } = f.ent.body.getPosition();
    this.emit({ type: 'ability', id: f.ent.id, bird: f.ent.type, x, y });
    if (f.hitTime === null) this.path.mark(x, y); // след идёт только до первого контакта (Бомб после удара — без отметки)
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

  /** Очередь у рогатки; в состоянии loading первая птица прыгает в кармашек, остальные сдвигаются. */
  queue(): readonly QueuedBirdView[] {
    const waiting = this.loaded ? this.birds.slice(1) : this.birds;
    return this.birdQueue.view(waiting, this.st === 'loading' ? this.now - this.stateTime : null, this.sling.anchor);
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

  focusBird(): EntityView | null {
    return this.focus;
  }

  releaseLinger(returnTime?: number): void {
    if (this.st !== 'settling' || this.birds.length === 0 || this.victoryPending) return;
    // отъезд камеры — сейчас, но не позже LINGER_MAX: ядро не ждёт экран дольше своего предела
    this.lingerEnd = Math.min(this.now - this.stateTime, TIMING.LINGER_MAX);
    if (returnTime !== undefined && Number.isFinite(returnTime)) this.returnTime = clamp(returnTime, 0, CAMERA.RETURN_MAX);
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
