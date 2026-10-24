// Сущности физического мира: тело planck + игровые данные (HP, стадия, материал).
// Ссылка на сущность хранится в body.userData.

import type { Body } from 'planck';
import type { DamageMults, DamageTarget } from '../characters';
import type { BirdType, BlockShape, Material, PigType } from '../types';

interface EntBase {
  readonly id: number;
  readonly body: Body;
  /** Стабильное псевдослучайное 0..1 — для вариаций отрисовки. */
  readonly seed: number;
  dead: boolean;
}

export interface TerrainEnt extends EntBase {
  readonly kind: 'terrain';
}

interface DestructibleBase extends EntBase {
  /** Ключ множителя урона птицы. */
  readonly target: DamageTarget;
  hp: number;
  readonly maxHp: number;
  /** Порог урона: J0 = масса · v0. */
  readonly v0: number;
  readonly blastMult: number;
  /** Текущая стадия повреждений (блоки 0..3, свиньи 0..2). */
  stage: number;
}

export interface BlockEnt extends DestructibleBase {
  readonly kind: 'block';
  readonly material: Material;
  readonly shape: BlockShape;
  readonly w: number;
  readonly h: number;
  /** Визуальная площадь, м². */
  readonly area: number;
}

export interface TntEnt extends DestructibleBase {
  readonly kind: 'tnt';
  readonly size: number;
}

export interface PigEnt extends DestructibleBase {
  readonly kind: 'pig';
  readonly type: PigType;
  readonly radius: number;
  /** Остаток HP каски (0 — каски нет). */
  helmetHp: number;
}

export interface BirdEnt extends EntBase {
  readonly kind: 'bird';
  readonly type: BirdType;
  readonly radius: number;
  /** Текущие множители урона (меняются способностями). */
  mult: DamageMults;
  /** Демпфирование «после удара» уже включено. */
  damped: boolean;
}

export interface EggEnt extends EntBase {
  readonly kind: 'egg';
  readonly radius: number;
  /** Коснулось чего-либо — взорвётся после шага. */
  touched: boolean;
}

export type Destructible = BlockEnt | TntEnt | PigEnt;
export type Ent = TerrainEnt | Destructible | BirdEnt | EggEnt;

export function isDestructible(e: Ent): e is Destructible {
  return e.kind === 'block' || e.kind === 'tnt' || e.kind === 'pig';
}

/** Характерный размер тела для закрутки при взрыве: ширина блока или диаметр круга. */
export function entSize(e: Ent): number {
  switch (e.kind) {
    case 'block':
      return e.w;
    case 'tnt':
      return e.size;
    case 'terrain':
      return 0;
    default:
      return 2 * e.radius;
  }
}

/** Контакт двух сущностей за один шаг физики. */
export interface Hit {
  readonly a: Ent;
  readonly b: Ent;
  /** Сумма нормальных импульсов за шаг (обычный + TOI), Н·с. */
  J: number;
  /** Максимальная скорость сближения из pre-solve, м/с. */
  vn: number;
  /** Точка контакта (в момент максимального vn). */
  x: number;
  y: number;
  /** Птица прошла насквозь (контакт отключён). */
  pierced: boolean;
}
