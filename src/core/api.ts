// Публичный интерфейс игровой сессии — КОНТРАКТ между ядром (core) и всем остальным
// (рендер, ввод, камера, UI, тесты, решатель уровней). Ядро не знает о DOM/Canvas
// и целиком работает в Node (тесты, headless-проверка уровней).

import type { GameEvent, SessionState } from './events';
import type { BirdType, BlockShape, LevelDef, Material, PigType, Vec } from './types';

export type EntityKind = 'bird' | 'pig' | 'block' | 'tnt' | 'egg';

/** Поза птицы для выбора спрайта. */
export type BirdPose = 'idle' | 'blink' | 'aim' | 'fly' | 'hurt';
/** Поза свиньи для выбора спрайта. */
export type PigPose = 'idle' | 'blink' | 'laugh' | 'scared';

/** Снимок сущности для отрисовки (только чтение; объект может переиспользоваться между кадрами). */
export interface EntityView {
  readonly id: number;
  readonly kind: EntityKind;
  /** Текущее положение центра и угол (после последнего шага физики). */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  /** Положение на предыдущем шаге — для интерполяции между шагами физики. */
  readonly px: number;
  readonly py: number;
  readonly pangle: number;
  readonly vx: number;
  readonly vy: number;
  /** Геометрия: для круглых тел shape='circle', w=h=2*radius. */
  readonly shape: BlockShape;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly material?: Material;
  readonly birdType?: BirdType;
  readonly pigType?: PigType;
  /** Доля оставшегося здоровья 0..1. */
  readonly health: number;
  /** Стадия повреждений: блоки 0..3 (0 — целый), свиньи 0..2. */
  readonly damageStage: number;
  /** Свинья в каске ещё носит её. */
  readonly hasHelmet?: boolean;
  /** Поза (для птиц и свиней). Ядро выставляет aim/fly/hurt и laugh/scared; моргание добавляет рендер. */
  readonly birdPose?: BirdPose;
  readonly pigPose?: PigPose;
  /** Способность уже использована (для птицы в полёте). */
  readonly abilityUsed?: boolean;
  /** Стабильное псевдослучайное число 0..1 на сущность — для вариаций отрисовки. */
  readonly seed: number;
}

/** Птица в очереди у рогатки (ещё не заряжена). */
export interface QueuedBirdView {
  readonly type: BirdType;
  /** Точка «стоянки» на земле (центр птицы). Рендер добавляет подпрыгивания. */
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Состояние рогатки для отрисовки резинок. */
export interface SlingshotView {
  /** Точка покоя кармашка (= LevelDef.slingshot). */
  readonly anchor: Vec;
  /** Точки крепления резинок на левом (заднем) и правом (переднем) рогах. */
  readonly backFork: Vec;
  readonly frontFork: Vec;
  /** Текущее положение кармашка (с птицей при прицеливании; при отдаче — анимация к anchor). */
  readonly pocket: Vec;
  /** Натяжение 0..1. */
  readonly power: number;
  /** Птица в кармашке (null, если пусто). */
  readonly loaded: BirdType | null;
}

/** Точка следа полёта («пуфы» за птицей). big — крупная точка (момент активации способности/удара). */
export interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly big: boolean;
}

export interface GameSession {
  readonly level: LevelDef;
  readonly state: SessionState;
  /** Текущий счёт. */
  readonly score: number;
  /** Время сессии, с (кратно шагу физики). */
  readonly time: number;
  /** Осталось свиней. */
  readonly pigsLeft: number;
  /** Сколько птиц ещё не запущено (включая заряженную). */
  readonly birdsLeft: number;

  /** Продвинуть симуляцию ровно на один фиксированный шаг (1/60 с). */
  step(): void;

  // ── Управление ──────────────────────────────────────────────
  /** Можно ли начать прицеливание, нажав в точке мира p (птица в рогатке и p рядом с ней). */
  canGrab(p: Vec): boolean;
  /** Начать прицеливание (state ready → aiming). */
  beginAim(): void;
  /** Курсор игрока в мировых координатах; ядро ограничивает радиусом натяжения. */
  updateAim(p: Vec): void;
  /** Отпустить: выстрел, либо отмена при слишком слабом натяжении. */
  release(): void;
  /** Отменить прицеливание без выстрела. */
  cancelAim(): void;
  /** Активировать способность летящей птицы. true — если сработало. */
  activateAbility(): boolean;
  /** Отладочный/тестовый выстрел: угол в градусах (0 — вправо, 90 — вверх), сила 0..1. Работает в состоянии ready. */
  launch(angleDeg: number, power: number): void;

  // ── Данные для отрисовки ───────────────────────────────────
  entities(): Iterable<EntityView>;
  queue(): readonly QueuedBirdView[];
  slingshot(): SlingshotView;
  /** След текущего/последнего полёта. */
  trail(): readonly TrailPoint[];
  /** Птица, за которой должна следить камера (летящая/последняя запущенная), или null. */
  focusBird(): EntityView | null;
  /** Предсказание траектории при текущем натяжении (для подсказки прицеливания), n точек. */
  predictTrajectory(n: number): Vec[];

  /** Забрать накопленные события (очередь очищается). */
  drainEvents(): GameEvent[];

  /** Звёзды за текущий счёт (0..3) по порогам уровня. */
  stars(): number;
}

/** Фабрика сессии — реализуется ядром в src/core/game/GameSession.ts. */
export type CreateSession = (level: LevelDef, opts?: { seed?: number }) => GameSession;
