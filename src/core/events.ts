// События игровой сессии. Ядро складывает их в очередь каждый шаг физики,
// а рендер/эффекты/звук/UI забирают их раз в кадр через GameSession.drainEvents().
// Это КОНТРАКТ: эффекты и звук реагируют только на эти события.

import type { BirdType, BlockShape, Material, PigType } from './types';

/** Состояние уровня (конечный автомат сессии). */
export type SessionState =
  | 'loading' // следующая птица запрыгивает на рогатку
  | 'ready' // птица в рогатке, можно целиться
  | 'aiming' // игрок тянет резинку
  | 'flying' // птица в полёте / катится; можно активировать способность (если не использована)
  | 'settling' // ждём, пока сцена успокоится перед следующей птицей / концом уровня
  | 'bonus' // все свиньи уничтожены: подсчёт неиспользованных птиц
  | 'won'
  | 'lost';

/** Что участвует в ударе — для выбора звука и частиц. */
export type ImpactSurface = Material | 'bird' | 'pig' | 'ground' | 'tnt' | 'egg';

/** Источник взрыва. */
export type ExplosionSource = 'bomb' | 'tnt' | 'egg';

export type GameEvent =
  | { type: 'stateChanged'; from: SessionState; to: SessionState }
  | { type: 'birdLoaded'; bird: BirdType }
  | { type: 'aimStart'; bird: BirdType }
  /** Натяжение изменилось заметно (шаг ~0.1); power 0..1. Для скрипа резины. */
  | { type: 'aimStretch'; power: number }
  | { type: 'aimCancel' }
  | { type: 'birdLaunched'; id: number; bird: BirdType; x: number; y: number; power: number }
  | { type: 'ability'; id: number; bird: BirdType; x: number; y: number }
  /**
   * Значимый удар двух тел (уже отфильтрован по силе и частоте). impulse — нормальный импульс, Н·с.
   * size — √(w·h) блока-участника (для высоты звука), если в ударе есть блок.
   */
  | { type: 'impact'; x: number; y: number; impulse: number; a: ImpactSurface; b: ImpactSurface; size?: number }
  /** Первый сильный удар птицы — разлёт перьев. */
  | { type: 'birdImpact'; id: number; bird: BirdType; x: number; y: number; speed: number }
  /** Птица исчезла (успокоилась или вылетела) — облачко «пуф». */
  | { type: 'birdRemoved'; id: number; bird: BirdType; x: number; y: number }
  /** Блок получил урон и перешёл на новую стадию повреждений (1..3). */
  | { type: 'blockDamaged'; id: number; material: Material; x: number; y: number; stage: number }
  | {
      type: 'blockDestroyed';
      id: number;
      material: Material;
      shape: BlockShape;
      x: number;
      y: number;
      w: number;
      h: number;
      angle: number;
      vx: number;
      vy: number;
      points: number;
    }
  | { type: 'pigDamaged'; id: number; pig: PigType; x: number; y: number; stage: number; helmetLost?: boolean }
  | { type: 'pigDestroyed'; id: number; pig: PigType; x: number; y: number; radius: number; points: number }
  | { type: 'tntDestroyed'; id: number; x: number; y: number; points: number }
  | { type: 'explosion'; x: number; y: number; radius: number; source: ExplosionSource }
  /** Всплывающее число: блок — 500 + несписанный остаток урона, свинья — ровно 5000 (урон идёт в счёт молча). kind — цвет/размер. */
  | { type: 'score'; points: number; x: number; y: number; kind: 'block' | 'pig' | 'bonus' | 'tnt' }
  /** Подсчёт оставшейся птицы на экране «бонус» (по одной, с паузой). */
  | { type: 'birdBonus'; bird: BirdType; x: number; y: number; points: number }
  /** Свиньи смеются над промахом (после выстрела, не убившего ни одной свиньи). pigs — типы живых свиней. */
  | { type: 'pigsLaugh'; pigs?: PigType[] }
  | { type: 'levelEnd'; won: boolean; score: number; stars: number };

export type GameEventType = GameEvent['type'];
