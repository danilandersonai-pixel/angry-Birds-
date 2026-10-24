// Рогатка: оттяжка с ограничением радиуса и землёй, скорость выстрела (линейна от натяжения),
// кармашек — следует за птицей в первые кадры, затем затухающая пружина (01 §2.2–2.5).

import { LAUNCH, POUCH, SLINGSHOT } from '../../config/constants';
import type { Vec } from '../types';

type Mode = 'rest' | 'aim' | 'carry' | 'return';

export interface Shot {
  readonly pos: Vec;
  readonly vel: Vec;
  /** Натяжение 0..1. */
  readonly power: number;
}

/** Поза летящей птицы, за которой кармашек тянется после выстрела. */
export interface CarryTarget {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const u = t - 1;
  return 1 + (c1 + 1) * u * u * u + c1 * u * u;
}

export class Slingshot {
  readonly anchor: Vec;
  /** Основание рогатки (на земле под стволом). */
  readonly base: Vec;
  readonly backFork: Vec;
  readonly frontFork: Vec;
  readonly pocket: Vec;
  /** Расстояние оттяжки от anchor, м (0..R_MAX). */
  pull = 0;

  private mode: Mode = 'rest';
  private readonly vel = { x: 0, y: 0 };
  private grabOffset: Vec | null = null;
  private carryDir: Vec = { x: 1, y: 0 };
  private returnFrom: Vec = { x: 0, y: 0 };
  private returnT = 0;

  constructor(anchor: Vec) {
    this.anchor = { x: anchor.x, y: anchor.y };
    this.base = { x: anchor.x - SLINGSHOT.ANCHOR.x, y: anchor.y - SLINGSHOT.ANCHOR.y };
    this.backFork = { x: this.base.x + SLINGSHOT.PRONG_BACK.x, y: this.base.y + SLINGSHOT.PRONG_BACK.y };
    this.frontFork = { x: this.base.x + SLINGSHOT.PRONG_FRONT.x, y: this.base.y + SLINGSHOT.PRONG_FRONT.y };
    this.pocket = { x: anchor.x, y: anchor.y - SLINGSHOT.EMPTY_SAG };
  }

  /** Натяжение 0..1 (только при прицеливании). */
  get power(): number {
    return this.mode === 'aim' ? this.pull / LAUNCH.R_MAX : 0;
  }

  /** Направление выстрела при текущей оттяжке (от кармашка к anchor). */
  get direction(): Vec {
    const dx = this.anchor.x - this.pocket.x;
    const dy = this.anchor.y - this.pocket.y;
    const d = Math.hypot(dx, dy);
    return d > 1e-9 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
  }

  beginAim(): void {
    this.mode = 'aim';
    this.grabOffset = null;
    this.pull = Math.hypot(this.pocket.x - this.anchor.x, this.pocket.y - this.anchor.y);
  }

  /** Курсор p → положение кармашка: смещение захвата, круг R_MAX, птица не ниже земли (проекция по кругу — сила сохраняется). */
  aimAt(p: Vec, birdRadius: number): void {
    if (!this.grabOffset) {
      // смещение захвата фиксируем по первой точке, чтобы птица не прыгала под палец
      const ox = this.pocket.x - p.x;
      const oy = this.pocket.y - p.y;
      const k = Math.min(1, LAUNCH.GRAB_RADIUS / (Math.hypot(ox, oy) || 1));
      this.grabOffset = { x: ox * k, y: oy * k };
    }
    const rx = p.x + this.grabOffset.x - this.anchor.x;
    const ry = p.y + this.grabOffset.y - this.anchor.y;
    const len = Math.hypot(rx, ry);
    const d = Math.min(len, LAUNCH.R_MAX);
    const ux = len > 1e-9 ? rx / len : 0;
    const uy = len > 1e-9 ? ry / len : 0;
    this.setPocket(ux, uy, d, birdRadius);
  }

  /** Оттяжка по углу выстрела (градусы, 0 — вправо) и силе 0..1 — для launch(). */
  pullTo(angleDeg: number, power: number, birdRadius: number): void {
    const a = (angleDeg * Math.PI) / 180;
    const t = Math.min(1, Math.max(0, power));
    this.mode = 'aim';
    this.setPocket(-Math.cos(a), -Math.sin(a), t * LAUNCH.R_MAX, birdRadius);
  }

  private setPocket(ux: number, uy: number, d: number, birdRadius: number): void {
    let x = this.anchor.x + ux * d;
    let y = this.anchor.y + uy * d;
    const minY = this.base.y + birdRadius + LAUNCH.GROUND_CLEARANCE;
    if (y < minY) {
      const dy = minY - this.anchor.y;
      const dx = Math.sqrt(Math.max(0, d * d - dy * dy));
      x = this.anchor.x + (ux >= 0 ? dx : -dx);
      y = minY;
    }
    this.pocket.x = x;
    this.pocket.y = y;
    this.pull = d;
  }

  /** Скорость и старт птицы: v = V_MAX · launchScale · d/R_MAX к anchor (03 §3.2). */
  shot(launchScale: number): Shot {
    const t = this.pull / LAUNCH.R_MAX;
    const dir = this.direction;
    const speed = LAUNCH.V_MAX * launchScale * t;
    return { pos: { x: this.pocket.x, y: this.pocket.y }, vel: { x: dir.x * speed, y: dir.y * speed }, power: t };
  }

  /** После выпуска кармашек ведёт птицу, пока она не пересечёт anchor. */
  release(): void {
    this.carryDir = this.direction;
    this.mode = 'carry';
    this.pull = 0;
  }

  /** Отмена: кармашек с птицей возвращается в покой за CANCEL_TIME. */
  cancel(): void {
    this.mode = 'return';
    this.returnFrom = { x: this.pocket.x, y: this.pocket.y };
    this.returnT = 0;
    this.pull = 0;
  }

  /** Птица приземлилась в кармашек: он проседает и пружинит. */
  land(): void {
    this.mode = 'rest';
    this.vel.x = 0;
    this.vel.y = -POUCH.LAND_KICK;
  }

  update(dt: number, loaded: boolean, carry: CarryTarget | null): void {
    switch (this.mode) {
      case 'aim':
        return;
      case 'carry':
        if (carry && (carry.x - this.anchor.x) * this.carryDir.x + (carry.y - this.anchor.y) * this.carryDir.y < 0) {
          this.pocket.x = carry.x;
          this.pocket.y = carry.y;
          return;
        }
        this.vel.x = (carry?.vx ?? 0) * POUCH.CARRY_VEL;
        this.vel.y = (carry?.vy ?? 0) * POUCH.CARRY_VEL;
        this.mode = 'rest';
        return;
      case 'return': {
        this.returnT += dt;
        const k = easeOutBack(Math.min(1, this.returnT / POUCH.CANCEL_TIME));
        this.pocket.x = this.returnFrom.x + (this.anchor.x - this.returnFrom.x) * k;
        this.pocket.y = this.returnFrom.y + (this.anchor.y - this.returnFrom.y) * k;
        if (this.returnT >= POUCH.CANCEL_TIME) this.mode = 'rest';
        return;
      }
      case 'rest':
        this.spring(dt, loaded);
    }
  }

  /** Затухающая пружина к anchor (с птицей) или к провисшему положению (пустой). */
  private spring(dt: number, loaded: boolean): void {
    const tx = this.anchor.x;
    const ty = this.anchor.y - (loaded ? 0 : SLINGSHOT.EMPTY_SAG);
    const w = POUCH.OMEGA;
    this.vel.x += ((tx - this.pocket.x) * w * w - this.vel.x * 2 * POUCH.ZETA * w) * dt;
    this.vel.y += ((ty - this.pocket.y) * w * w - this.vel.y * 2 * POUCH.ZETA * w) * dt;
    this.pocket.x += this.vel.x * dt;
    this.pocket.y += this.vel.y * dt;
    if (Math.hypot(this.pocket.x - tx, this.pocket.y - ty) < POUCH.SNAP_DIST && Math.hypot(this.vel.x, this.vel.y) < POUCH.SNAP_VEL) {
      this.pocket.x = tx;
      this.pocket.y = ty;
      this.vel.x = 0;
      this.vel.y = 0;
    }
  }
}
