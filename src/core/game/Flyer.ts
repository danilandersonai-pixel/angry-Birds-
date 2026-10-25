// Летящая птица текущего выстрела: окно способности, первый контакт, управление дугами, уход (00 §1.4, §1.9).

import { ABILITY, BIRD_FLIGHT, RETIRE, WORLD } from '../../config/constants';
import type { DamageMults } from '../characters';
import type { BirdEnt } from '../physics/entities';
import type { BirdType } from '../types';

export interface Flyer {
  readonly ent: BirdEnt;
  readonly launchTime: number;
  /** Запущена из рогатки (у сестёр Синих — false): только у неё есть способность. */
  readonly primary: boolean;
  /** Отрицательный groupIndex выстрела: сёстры и яйцо друг с другом не сталкиваются. */
  readonly group: number;
  abilityUsed: boolean;
  /** Время первого контакта (пробития не считаются); null — ещё в свободном полёте. */
  hitTime: number | null;
  /** Управление на шаге до world.step (дуги Хэла и Сильвера, нос Чака); false — закончено. */
  control: ((dt: number) => boolean) | null;
  /** Множители, которые вернуть после шага первого контакта (усиление Чака). */
  multAfterHit: DamageMults | null;
  /** Сильвер в пике: первый контакт — «слэм». */
  diving: boolean;
  /** Автоподрыв Бомба. */
  fuseAt: number | null;
  /** Матильда после яйца улетает — уход по времени. */
  despawnAt: number | null;
  /** Птица без способности после тапа «хмурится» до этого времени (только поза). */
  frownUntil: number;
  /** Сколько секунд подряд птица почти неподвижна (после первого контакта). */
  restTime: number;
  /** След: последняя позиция и путь с последней точки. */
  trailX: number;
  trailY: number;
  trailCarry: number;
}

export function createFlyer(ent: BirdEnt, launchTime: number, primary: boolean, group: number): Flyer {
  const p = ent.body.getPosition();
  return {
    ent, launchTime, primary, group, abilityUsed: !primary, hitTime: null, control: null, multAfterHit: null,
    diving: false, fuseAt: null, despawnAt: null, frownUntil: 0, restTime: 0, trailX: p.x, trailY: p.y, trailCarry: 0,
  };
}

/** Есть ли у птицы способность: у Ред (без клича AB2) и Теренса её нет. */
export function hasAbility(type: BirdType): boolean {
  return type === 'red' ? ABILITY.RED_BATTLE_CRY : type !== 'terence';
}

/** Можно ли сейчас активировать способность: после дребезга 0.05 с и до первого контакта (у Бомба — до взрыва). */
export function canTrigger(f: Flyer, time: number): boolean {
  if (!hasAbility(f.ent.type) || f.abilityUsed) return false;
  if (time - f.launchTime < BIRD_FLIGHT.ABILITY_MIN_DELAY - 1e-9) return false;
  return f.hitTime === null || f.ent.type === 'bomb';
}

/** Шаг таймера покоя; true — птице пора «уйти». Вылет за границы проверяет вызывающий. */
export function updateRetire(f: Flyer, time: number): boolean {
  if (f.fuseAt !== null) return false; // Бомб с горящим фитилём уходит только взрывом
  if (time - f.launchTime >= RETIRE.FLIGHT_MAX - 1e-9) return true;
  if (f.despawnAt !== null && time >= f.despawnAt - 1e-9) return true;
  if (f.hitTime === null) return false;
  const sinceHit = time - f.hitTime;
  if (sinceHit >= RETIRE.MAX_AFTER_HIT - 1e-9) return true;
  const b = f.ent.body;
  const resting = b.getLinearVelocity().length() < RETIRE.REST_V && Math.abs(b.getAngularVelocity()) < RETIRE.REST_W;
  f.restTime = resting ? f.restTime + WORLD.DT : 0;
  return f.restTime >= RETIRE.REST_HOLD - 1e-9 && sinceHit >= RETIRE.MIN_AFTER_HIT - 1e-9;
}
