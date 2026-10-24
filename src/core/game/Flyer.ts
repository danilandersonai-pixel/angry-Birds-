// Летящая птица текущего выстрела: окно способности, первый контакт, управление дугами, уход.

import { RETIRE, WORLD } from '../../config/constants';
import type { DamageMults } from '../characters';
import type { BirdEnt } from '../physics/entities';

export interface Flyer {
  readonly ent: BirdEnt;
  readonly launchTime: number;
  /** Запущена из рогатки (у сестёр Синих — false): только у неё есть способность. */
  readonly primary: boolean;
  abilityUsed: boolean;
  /** Время первого контакта (в т.ч. пробития); null — ещё в свободном полёте. */
  hitTime: number | null;
  /** Был контакт без пробития. */
  solidHit: boolean;
  /** Событие birdImpact уже отправлено. */
  strongHit: boolean;
  /** Управление на шаге до world.step (дуги Хэла и Сильвера, нос Чака); false — закончено. */
  control: ((dt: number) => boolean) | null;
  /** Множители, которые вернуть после первого твёрдого контакта (усиление Чака). */
  multAfterHit: DamageMults | null;
  /** Сильвер в пике: первый контакт — «слэм». */
  diving: boolean;
  /** Автоподрыв Бомба. */
  fuseAt: number | null;
  /** Матильда после яйца улетает — уход по времени. */
  despawnAt: number | null;
  /** Сколько секунд подряд птица почти неподвижна. */
  restTime: number;
  /** След: последняя позиция и путь с последней точки. */
  trailX: number;
  trailY: number;
  trailCarry: number;
}

export function createFlyer(ent: BirdEnt, launchTime: number, primary: boolean): Flyer {
  const p = ent.body.getPosition();
  return {
    ent, launchTime, primary, abilityUsed: !primary, hitTime: null, solidHit: false, strongHit: false,
    control: null, multAfterHit: null, diving: false, fuseAt: null, despawnAt: null, restTime: 0,
    trailX: p.x, trailY: p.y, trailCarry: 0,
  };
}

/** Шаг таймера покоя; true — птице пора «уйти» (01 §5.1). Вылет за границы проверяет вызывающий. */
export function updateRetire(f: Flyer, time: number): boolean {
  if (f.hitTime === null) {
    return time - f.launchTime >= RETIRE.FLIGHT_MAX || (f.despawnAt !== null && time >= f.despawnAt);
  }
  if (f.fuseAt !== null) return false; // Бомб уходит взрывом
  const sinceHit = time - f.hitTime;
  if (sinceHit >= RETIRE.MAX_AFTER_HIT) return true;
  const b = f.ent.body;
  const resting = b.getLinearVelocity().length() < RETIRE.REST_V && Math.abs(b.getAngularVelocity()) < RETIRE.REST_W;
  f.restTime = resting ? f.restTime + WORLD.DT : 0;
  return f.restTime >= RETIRE.REST_HOLD && sinceHit >= RETIRE.MIN_AFTER_HIT;
}
