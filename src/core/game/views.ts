// Снимки сущностей для отрисовки: один изменяемый объект на сущность, обновляется после шага физики.

import type { Body } from 'planck';
import type { BirdPose, EntityKind, EntityView, PigPose } from '../api';
import { BIRD_DEFS } from '../characters';
import type { Ent } from '../physics/entities';
import type { BirdType, BlockShape, Material, PigType } from '../types';

export class View implements EntityView {
  x = 0;
  y = 0;
  angle = 0;
  px = 0;
  py = 0;
  pangle = 0;
  vx = 0;
  vy = 0;
  health = 1;
  damageStage = 0;
  material?: Material;
  birdType?: BirdType;
  pigType?: PigType;
  hasHelmet?: boolean;
  birdPose?: BirdPose;
  pigPose?: PigPose;
  abilityUsed?: boolean;
  /** Сущность физики; null — птица в кармашке (тела ещё нет). */
  ent: Ent | null = null;

  constructor(
    readonly id: number,
    readonly kind: EntityKind,
    readonly shape: BlockShape,
    readonly w: number,
    readonly h: number,
    readonly radius: number,
    readonly seed: number,
  ) {}

  /** Начало шага: текущая поза становится предыдущей (интерполяция рендера). */
  savePrev(): void {
    this.px = this.x;
    this.py = this.y;
    this.pangle = this.angle;
  }

  place(x: number, y: number, angle: number): void {
    this.x = x;
    this.y = y;
    this.angle = angle;
  }

  readBody(b: Body): void {
    const p = b.getPosition();
    const v = b.getLinearVelocity();
    this.place(p.x, p.y, b.getAngle());
    this.vx = v.x;
    this.vy = v.y;
  }
}

/** Неподвижная копия вида в его текущей точке (камера держит точку взрыва яйца). */
export function frozenCopy(src: View, x: number, y: number): View {
  const v = new View(src.id, src.kind, src.shape, src.w, src.h, src.radius, src.seed);
  v.place(x, y, src.angle);
  v.savePrev();
  return v;
}

/** Центроид группы видов (сёстры Синих): позиция, предыдущая позиция и скорость — средние; поза — первой. */
export function centroidInto(target: View, members: readonly View[]): void {
  let x = 0, y = 0, px = 0, py = 0, vx = 0, vy = 0;
  for (const m of members) {
    x += m.x;
    y += m.y;
    px += m.px;
    py += m.py;
    vx += m.vx;
    vy += m.vy;
  }
  const n = members.length;
  target.place(x / n, y / n, members[0].angle);
  target.px = px / n;
  target.py = py / n;
  target.pangle = members[0].pangle;
  target.vx = vx / n;
  target.vy = vy / n;
  target.birdPose = members[0].birdPose;
  target.abilityUsed = members[0].abilityUsed;
}

/** Вид птицы (до выстрела живёт без тела в кармашке, затем привязывается к телу с тем же id). */
export function birdView(id: number, type: BirdType, seed: number): View {
  const d = BIRD_DEFS[type];
  let v: View;
  if (d.outline) {
    const xs = d.outline.map((p) => p[0]);
    const ys = d.outline.map((p) => p[1]);
    v = new View(id, 'bird', 'isoTriangle', Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), d.radius, seed);
  } else {
    v = new View(id, 'bird', 'circle', 2 * d.radius, 2 * d.radius, d.radius, seed);
  }
  v.birdType = type;
  v.birdPose = 'idle';
  v.abilityUsed = false;
  return v;
}

/** Вид для сущности, созданной физикой (кроме рельефа). */
export function entityView(e: Exclude<Ent, { kind: 'terrain' }>): View {
  let v: View;
  switch (e.kind) {
    case 'block':
      v = new View(e.id, 'block', e.shape, e.w, e.h, e.shape === 'circle' ? e.w / 2 : Math.hypot(e.w, e.h) / 2, e.seed);
      v.material = e.material;
      break;
    case 'tnt':
      v = new View(e.id, 'tnt', 'rect', e.size, e.size, (e.size * Math.SQRT2) / 2, e.seed);
      break;
    case 'pig':
      v = new View(e.id, 'pig', 'circle', 2 * e.radius, 2 * e.radius, e.radius, e.seed);
      v.pigType = e.type;
      v.pigPose = 'idle';
      v.hasHelmet = e.helmetHp > 0;
      break;
    case 'egg':
      v = new View(e.id, 'egg', 'circle', 2 * e.radius, 2 * e.radius, e.radius, e.seed);
      break;
    case 'bird':
      v = birdView(e.id, e.type, e.seed);
      break;
  }
  v.ent = e;
  v.readBody(e.body);
  v.savePrev();
  return v;
}
