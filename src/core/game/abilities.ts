// Способности птиц (00 §1.4, скорости — в долях V_MAX). Вызываются вне шага физики: мир не заблокирован.

import { ABILITY, LAUNCH } from '../../config/constants';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { BirdType, Vec } from '../types';
import type { Flyer } from './Flyer';

/** Что способности нужно от сессии. */
export interface AbilityHost {
  readonly physics: PhysicsWorld;
  /** Время сессии, с. */
  now(): number;
  /** Новая птица того же выстрела (сёстры Синих). */
  spawnBird(parent: Flyer, type: BirdType, pos: Vec, vel: Vec, angle: number, spin: number): void;
  /** Яйцо Матильды — в группе выстрела, с самой Матильдой не сталкивается. */
  spawnEgg(parent: Flyer, pos: Vec, vel: Vec): void;
  /** Удалить Бомба и взорвать на его месте. */
  explodeBomb(f: Flyer): void;
}

type Ability = (f: Flyer, host: AbilityHost) => void;

const V = LAUNCH.V_MAX;
const DEG = Math.PI / 180;
const TAU = 2 * Math.PI;

function speedOf(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

/** Ред (только при ABILITY.RED_BATTLE_CRY, P2): боевой клич AB2 — толчок тел в конусе по курсу, без урона. */
function battleCry(f: Flyer, host: AbilityHost): void {
  const R = ABILITY.RED;
  const b = f.ent.body;
  const { x, y } = b.getPosition();
  const { x: vx, y: vy } = b.getLinearVelocity();
  const s = speedOf({ x: vx, y: vy }) || 1;
  const cosHalf = Math.cos(R.HALF_ANGLE_DEG * DEG);
  for (const e of host.physics.bodiesNear(x, y, R.RANGE)) {
    if (e.kind === 'bird' || e.kind === 'egg') continue;
    const c = e.body.getWorldCenter();
    const tx = c.x - x;
    const ty = c.y - y;
    const d = Math.hypot(tx, ty);
    if (d > R.RANGE || d < 1e-6 || (tx * vx + ty * vy) / (d * s) < cosHalf) continue;
    const J = Math.min(e.body.getMass() * R.DV_MAX * (1 - d / R.RANGE), R.IMPULSE_CAP);
    const ux = tx / d;
    const uy = ty / d + R.LIFT;
    const ul = Math.hypot(ux, uy);
    e.body.applyLinearImpulse({ x: (ux / ul) * J, y: (uy / ul) * J }, c, true);
  }
  b.setLinearVelocity({ x: vx * R.SELF_SLOW, y: vy * R.SELF_SLOW });
}

/** Синие: средняя продолжает полёт, две сестры — с поворотом скорости ±SPREAD и сдвигом поперёк курса. */
function split(f: Flyer, host: AbilityHost): void {
  const B = ABILITY.BLUES;
  const b = f.ent.body;
  const p = b.getPosition();
  const v = b.getLinearVelocity();
  const s = speedOf(v);
  if (s < 1e-6) return;
  const nx = -v.y / s;
  const ny = v.x / s;
  const r = f.ent.radius;
  const off = B.OFFSET_R * r;
  for (const side of [1, -1]) {
    const ca = Math.cos(side * B.SPREAD_RAD);
    const sa = Math.sin(side * B.SPREAD_RAD);
    let pos = { x: p.x + nx * side * off, y: p.y + ny * side * off };
    if (host.physics.overlapsSolid(pos, r)) pos = { x: p.x, y: p.y }; // сестра не рождается внутри рельефа или блока
    host.spawnBird(f, 'blues', pos, { x: v.x * ca - v.y * sa, y: v.x * sa + v.y * ca }, b.getAngle(), side * B.SPIN);
  }
}

/** Чак: рывок по текущему курсу, усиление по дереву до первого контакта, нос по скорости. */
function boost(f: Flyer): void {
  const C = ABILITY.CHUCK;
  const b = f.ent.body;
  const v = b.getLinearVelocity();
  const s = speedOf(v) || 1;
  const s2 = Math.min(C.MAX_K * V, Math.max(C.MIN_K * V, C.SPEED_MUL * s));
  b.setLinearVelocity({ x: (v.x / s) * s2, y: (v.y / s) * s2 });
  f.multAfterHit = f.ent.mult;
  f.ent.mult = { ...f.ent.mult, wood: C.BOOSTED_WOOD };
  const align = () => {
    const u = b.getLinearVelocity();
    b.setAngle(Math.atan2(u.y, u.x));
    b.setAngularVelocity(0);
    return true;
  };
  align();
  f.control = align;
}

/** Матильда: яйцо строго вниз, сама — вверх-вперёд под UP_DEG, легче и слабее, улетает. */
function dropEgg(f: Flyer, host: AbilityHost): void {
  const M = ABILITY.MATILDA;
  const b = f.ent.body;
  const p = b.getPosition();
  const v = b.getLinearVelocity();
  host.spawnEgg(f, { x: p.x, y: p.y - M.EGG_OFFSET_R * f.ent.radius }, { x: 0, y: M.EGG_VY_K * V });
  const facing = Math.sign(v.x) || 1;
  const s = Math.max(speedOf(v), M.UP_MIN_K * V);
  b.setLinearVelocity({ x: facing * s * Math.cos(M.UP_DEG * DEG), y: s * Math.sin(M.UP_DEG * DEG) });
  b.setAngularVelocity(-M.SPIN * facing);
  b.getFixtureList()?.setDensity(M.AFTER_DENSITY);
  b.resetMassData();
  b.setGravityScale(M.GRAVITY_AFTER);
  const k = M.AFTER_MULT;
  f.ent.mult = { wood: k, ice: k, stone: k, pig: k, tnt: k };
  f.despawnAt = host.now() + M.DESPAWN;
}

/** Хэл: без гравитации поворачивает курс с угловой скоростью OMEGA до зеркального, поднятого на LIFT_DEG. */
function boomerang(f: Flyer): void {
  const H = ABILITY.HAL;
  const b = f.ent.body;
  const v = b.getLinearVelocity();
  const s = Math.max(speedOf(v), H.MIN_K * V) * H.SPEED_MUL;
  let a = Math.atan2(v.y, v.x);
  const side = Math.cos(a) >= 0 ? 1 : -1; // вправо — разворот против часовой (через верх)
  const aEnd = Math.PI - a - side * H.LIFT_DEG * DEG;
  let left = (((side * (aEnd - a)) % TAU) + TAU) % TAU;
  let spinLeft = H.SPIN_DECAY;
  b.setGravityScale(0);
  b.setLinearVelocity({ x: s * Math.cos(a), y: s * Math.sin(a) });
  b.setAngularVelocity(side * H.SPIN);
  f.control = (dt) => {
    if (left > 0) {
      const da = Math.min(H.OMEGA * dt, left);
      left -= da;
      a += side * da;
      b.setLinearVelocity({ x: s * Math.cos(a), y: s * Math.sin(a) });
      b.setAngularVelocity(side * H.SPIN);
      if (left <= 0) b.setGravityScale(1);
      return true;
    }
    // после дуги вращение «бумеранга» затухает за SPIN_DECAY
    spinLeft -= dt;
    b.setAngularVelocity(b.getAngularVelocity() * Math.exp((-3 * dt) / H.SPIN_DECAY));
    return spinLeft > 0;
  };
}

/** Сильвер: петля 2π без гравитации (спрайт по касательной), затем пике почти вертикально вниз с усилением по камню. */
function loopDive(f: Flyer): void {
  const S = ABILITY.SILVER;
  const b = f.ent.body;
  const v = b.getLinearVelocity();
  const s = Math.max(speedOf(v), S.MIN_K * V);
  let a = Math.atan2(v.y, v.x);
  const side = Math.cos(a) >= 0 ? 1 : -1; // вправо — петля против часовой: вперёд, вверх, назад, вниз
  let left = TAU;
  b.setGravityScale(0);
  f.control = (dt) => {
    if (left > 0) {
      const da = Math.min(S.OMEGA * dt, left);
      left -= da;
      a += side * da;
      b.setLinearVelocity({ x: s * Math.cos(a), y: s * Math.sin(a) });
      b.setAngle(a);
      b.setAngularVelocity(0);
      return true;
    }
    b.setGravityScale(1);
    b.setLinearVelocity({ x: S.DIVE_SIDE * side * s, y: -S.DIVE_K * V });
    b.setAngle(-Math.PI / 2);
    f.ent.mult = S.DIVE_MULT;
    f.diving = true;
    return false;
  };
}

/** «Слэм» Сильвера: первый удар в пике подбрасывает лёгкие тела вокруг. */
export function silverSlam(host: AbilityHost, x: number, y: number): void {
  const S = ABILITY.SILVER;
  for (const e of host.physics.bodiesNear(x, y, S.SLAM_R)) {
    if (e.kind === 'bird' || e.kind === 'egg') continue;
    const m = e.body.getMass();
    const c = e.body.getWorldCenter();
    const d = Math.hypot(c.x - x, c.y - y);
    if (m >= S.SLAM_MAX_MASS || d > S.SLAM_R) continue;
    e.body.applyLinearImpulse({ x: 0, y: m * S.SLAM_DV * (1 - d / S.SLAM_R) }, c, true);
  }
}

/** Способности по птицам; у Теренса способности нет, клич Ред включается флагом (Flyer.hasAbility). */
const ABILITIES: Partial<Record<BirdType, Ability>> = {
  red: battleCry,
  blues: split,
  chuck: boost,
  bomb: (f, host) => host.explodeBomb(f),
  matilda: dropEgg,
  hal: boomerang,
  silver: loopDive,
};

export function useAbility(f: Flyer, host: AbilityHost): void {
  ABILITIES[f.ent.type]?.(f, host);
}
