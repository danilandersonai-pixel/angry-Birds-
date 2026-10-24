// Все настраиваемые числа игры. Мир — метры, секунды, ось Y вверх.
// Источник значений — docs/research/00-summary.md и 01…07 (физика — 03-physics.md имеет приоритет).
// Ядро (core) дополняет этот файл своими разделами; блок SLINGSHOT — общий контракт ядра и графики.

/**
 * Геометрия рогатки относительно её ОСНОВАНИЯ (точка на земле под стволом).
 * LevelDef.slingshot задаёт ANCHOR в мире, значит основание = slingshot − ANCHOR.
 * Рогатка — декорация без физических фикстур.
 */
export const SLINGSHOT = {
  /** Точка покоя кармашка (центр заряженной птицы) — центр окружности оттяжки. */
  ANCHOR: { x: 0.0, y: 2.7 },
  /** Крепление задней резинки (задний рог, рисуется за птицей). */
  PRONG_BACK: { x: -0.3, y: 2.95 },
  /** Крепление передней резинки (передний рог, рисуется перед птицей). */
  PRONG_FRONT: { x: 0.28, y: 2.9 },
  /** Провис пустого кармашка относительно ANCHOR. */
  EMPTY_SAG: 0.1,
  /** Полуширина кармашка: края — pocket ± perp(dir)·POUCH_HALF. */
  POUCH_HALF: 0.38,
  /** Толщина резинки: от REST (без натяжения) до TENSE (полное натяжение), м. */
  BAND_REST: 0.17,
  BAND_TENSE: 0.08,
  /** Насколько ствол уходит под землю (рисуется до рельефа). */
  BURY: 0.4,
  /** Очередь птиц: x = основание − QUEUE_X0 − i·QUEUE_DX, стоят на земле. */
  QUEUE_X0: 1.6,
  QUEUE_DX: 1.1,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Ядро: физика и игровая логика. Числа — из 03-physics.md (приоритет), 01-gameplay.md, 02-characters.md.
// ─────────────────────────────────────────────────────────────────────────────

/** Мир и шаг симуляции (03 §3.1). */
export const WORLD = {
  GRAVITY: -15,
  DT: 1 / 60,
  VEL_ITERS: 10,
  POS_ITERS: 8,
  /** Сжатие полигонов коллизии с каждой стороны: уровень рисуется встык (03 §2.1 A6). */
  INSET: 0.0075,
  /** Шагов «усадки» без урона на старте, затем принудительный сон (03 §2.3). */
  PRESETTLE_STEPS: 90,
  /** Тело удаляется ниже этой высоты (или ниже самого низкого рельефа − 1 м). */
  KILL_Y: -10,
  /** Тело удаляется за bounds.minX/maxX ± этот запас. */
  BOUNDS_MARGIN: 15,
  /** Рельеф: трение и упругость (03 §3.3). */
  GROUND_FRICTION: 0.9,
  GROUND_RESTITUTION: 0,
} as const;

/** Рогатка и запуск (03 §3.2, 01 §2). */
export const LAUNCH = {
  /** Скорость при полном натяжении, м/с: v = V_MAX · launchScale · d/R_MAX. */
  V_MAX: 24,
  R_MAX: 2.0,
  /** Отпускание ближе — отмена выстрела. */
  R_CANCEL: 0.5,
  /** Радиус захвата птицы, м: max(GRAB_RADIUS, радиус птицы + GRAB_MARGIN). */
  GRAB_RADIUS: 1.0,
  GRAB_MARGIN: 0.35,
  /** Зазор птицы над землёй при оттяжке. */
  GROUND_CLEARANCE: 0.02,
  /** Сглаживание поворота птицы при прицеливании, с. */
  AIM_ANGLE_TAU: 0.05,
  /** Шаг квантования натяжения для события aimStretch. */
  STRETCH_STEP: 0.1,
  /** Точка предсказанной траектории — раз в столько шагов физики. */
  PREDICT_STRIDE: 3,
} as const;

/** Кармашек после выстрела: затухающая пружина (01 §2.5). */
export const POUCH = {
  OMEGA: 30,
  ZETA: 0.18,
  /** Доля скорости птицы, с которой кармашек отцепляется. */
  CARRY_VEL: 0.55,
  SNAP_DIST: 0.01,
  SNAP_VEL: 0.05,
  /** Толчок вниз при приземлении птицы в кармашек (проседание ≈ 0.12 м). */
  LAND_KICK: 3.6,
  /** Возврат кармашка с птицей при отмене, с (easeOutBack). */
  CANCEL_TIME: 0.25,
} as const;

/** Материалы блоков (03 §3.3). HP = hpPerKg · масса; очки за урон — на м² визуальной площади (01 §9, 1×1 = 100/200/300). */
export const MATERIALS = {
  wood: { density: 0.7, friction: 0.7, restitution: 0.05, v0: 1.5, hpPerKg: 14, blastMult: 1.0, damagePointsPerM2: 200 },
  ice: { density: 0.9, friction: 0.25, restitution: 0.05, v0: 1.5, hpPerKg: 6, blastMult: 1.25, damagePointsPerM2: 100 },
  stone: { density: 2.2, friction: 0.9, restitution: 0.02, v0: 2.5, hpPerKg: 27, blastMult: 1.4, damagePointsPerM2: 300 },
} as const;

/** Ящик TNT (03 §3.3): хрупкий, взрывается при hp ≤ 0. */
export const TNT = {
  SIZE: 1.0,
  density: 0.8,
  friction: 0.6,
  restitution: 0.05,
  v0: 1.5,
  hpPerKg: 4,
  blastMult: 1.0,
  damagePointsPerM2: 0,
} as const;

/**
 * Птицы (02 §1, §11; масштаб скоростей — V_MAX из 03). mult — множители урона птицы по целям (02 §1.1).
 * Чак — треугольник: outline — вершины в локальных координатах тела (02 §3.3), radius — описанный радиус для отрисовки.
 */
export const BIRDS = {
  red: { radius: 0.45, density: 2.0, friction: 0.55, restitution: 0.32, launchScale: 1.0, mult: { wood: 1.0, ice: 1.0, stone: 0.7, pig: 1.0, tnt: 1.0 } },
  blues: { radius: 0.252, density: 3.0, friction: 0.5, restitution: 0.3, launchScale: 1.0, mult: { wood: 0.5, ice: 2.6, stone: 0.3, pig: 0.5, tnt: 0.5 } },
  chuck: {
    radius: 0.495, density: 3.3, friction: 0.45, restitution: 0.25, launchScale: 1.0, mult: { wood: 1.2, ice: 0.6, stone: 0.4, pig: 1.0, tnt: 1.0 },
    outline: [[0, 0.495], [-0.45, -0.279], [0.45, -0.279]],
  },
  bomb: { radius: 0.585, density: 1.9, friction: 0.6, restitution: 0.2, launchScale: 0.95, mult: { wood: 0.9, ice: 0.8, stone: 1.0, pig: 1.0, tnt: 1.0 } },
  matilda: { radius: 0.54, density: 1.65, friction: 0.55, restitution: 0.3, launchScale: 0.97, mult: { wood: 0.7, ice: 0.7, stone: 0.5, pig: 0.8, tnt: 1.0 } },
  hal: { radius: 0.4725, density: 1.8, friction: 0.5, restitution: 0.3, launchScale: 1.0, mult: { wood: 1.6, ice: 0.8, stone: 0.5, pig: 1.0, tnt: 1.0 } },
  terence: { radius: 0.8, density: 2.5, friction: 0.7, restitution: 0.15, launchScale: 0.88, mult: { wood: 1.6, ice: 1.6, stone: 1.6, pig: 1.5, tnt: 1.6 } },
  silver: { radius: 0.45, density: 2.2, friction: 0.5, restitution: 0.28, launchScale: 1.0, mult: { wood: 1.0, ice: 1.0, stone: 0.7, pig: 1.0, tnt: 1.0 } },
} as const;

/** Птица в полёте и после удара (03 §3.4). */
export const BIRD_FLIGHT = {
  ANGULAR_DAMPING: 0.3,
  /** Включается на первом контакте: без этого птица катится 220 м (03 §2.6). */
  HIT_LINEAR_DAMPING: 1.5,
  HIT_ANGULAR_DAMPING: 4,
  /** Способность доступна не раньше, чем через столько секунд после запуска (01 §4.1). */
  ABILITY_MIN_DELAY: 0.05,
  /** Лицо «ушиб» после удара, с. */
  HURT_TIME: 0.6,
} as const;

/** Способности (02 §3; скорости — в долях V_MAX). */
export const ABILITY = {
  /** Ред — боевой клич AB2: конус-толчок без урона. */
  RED: { RANGE: 3.5, HALF_ANGLE_DEG: 55, DV_MAX: 5, IMPULSE_CAP: 6, LIFT: 0.25, SELF_SLOW: 0.85 },
  /** Синие — веер из трёх. */
  BLUES: { SPREAD_RAD: 0.14, OFFSET_R: 2.3, SPIN: 2 },
  /** Чак — рывок: |v'| = clamp(SPEED_MUL·|v|, MIN_K·V_MAX, MAX_K·V_MAX). */
  CHUCK: { SPEED_MUL: 1.5, MIN_K: 1.3, MAX_K: 1.6, BOOSTED_WOOD: 2.2 },
  /** Бомб — автоподрыв через FUSE с после первого удара. */
  BOMB: { FUSE: 2.5 },
  /** Матильда — яйцо вниз, сама вверх под UP_DEG. */
  MATILDA: {
    EGG_RADIUS: 0.225, EGG_DENSITY: 8, EGG_FRICTION: 0.5, EGG_OFFSET_R: 0.7, EGG_VY_K: -0.7,
    UP_DEG: 60, UP_MIN_K: 0.62, SPIN: 6, AFTER_DENSITY: 0.5, AFTER_MULT: 0.3, GRAVITY_AFTER: 0.6, DESPAWN: 3,
  },
  /** Хэл — бумеранг: дуга с угловой скоростью OMEGA до зеркального курса, поднятого на LIFT_DEG. */
  HAL: { OMEGA: 8, SPEED_MUL: 1.15, MIN_K: 0.9, LIFT_DEG: 10, SPIN: 22, SPIN_DECAY: 0.4 },
  /** Сильвер — петля 2π, затем пике. */
  SILVER: {
    OMEGA: 11, MIN_K: 0.55, DIVE_K: 1.05, DIVE_SIDE: 0.1,
    DIVE_MULT: { wood: 1.3, ice: 1.3, stone: 2.6, pig: 1.0, tnt: 1.3 },
    SLAM_R: 1.2, SLAM_DV: 4, SLAM_MAX_MASS: 3,
  },
} as const;

/** Свиньи (02 §4, HP = hpPerKg · масса по 03 §3.5). Каска — отдельный слой HP (02 §4.2). damagePoints — очки за полный урон (01 §9). */
export const PIGS = {
  small: { radius: 0.405, density: 0.8, friction: 0.6, restitution: 0.15, hpPerKg: 6, helmetHp: 0, damagePoints: 50 },
  medium: { radius: 0.6075, density: 0.8, friction: 0.6, restitution: 0.15, hpPerKg: 6, helmetHp: 0, damagePoints: 100 },
  large: { radius: 0.8325, density: 0.8, friction: 0.6, restitution: 0.12, hpPerKg: 7, helmetHp: 0, damagePoints: 200 },
  helmet: { radius: 0.63, density: 0.9, friction: 0.6, restitution: 0.12, hpPerKg: 6, helmetHp: 8, damagePoints: 150 },
  mustache: { radius: 0.72, density: 0.85, friction: 0.6, restitution: 0.12, hpPerKg: 7, helmetHp: 0, damagePoints: 300 },
  king: { radius: 1.17, density: 0.8, friction: 0.65, restitution: 0.1, hpPerKg: 9, helmetHp: 0, damagePoints: 1000 },
} as const;

/** Демпфирование свиней — против вечного качения (03 §3.5). */
export const PIG_PHYS = { ANGULAR_DAMPING: 3, LINEAR_DAMPING: 0.1 } as const;

/** Модель урона (03 §3.6): dmg = mult · max(0, J − m·V0) при скорости сближения vn ≥ V_GATE. */
export const DAMAGE = {
  V_GATE: 0.5,
  PIG_V0: 3.0,
  /** Удар свиньи о рельеф. */
  PIG_STATIC_MULT: 0.7,
  PIG_BLAST_MULT: 1.0,
  /** Стадии трещин блоков: hp/maxHp ниже порога → стадия 1, 2, 3. */
  BLOCK_STAGES: [0.75, 0.5, 0.25],
  /** Стадии синяков свиней: ниже порога → стадия 1, 2. */
  PIG_STAGES: [0.66, 0.33],
  /** Доля урона, которую берёт каска: удар сверху / сбоку и взрыв. Верх — локальная y точки удара > TOP_Y·r. */
  HELMET_SHARE_TOP: 0.9,
  HELMET_SHARE_SIDE: 0.6,
  HELMET_TOP_Y: 0.1,
  /** Пробитие (03 §2.8): птица сохраняет долю скорости clamp(1 − K·HP/dmg, MIN, MAX). */
  PIERCE_KEEP_K: 0.5,
  PIERCE_KEEP_MIN: 0.5,
  PIERCE_KEEP_MAX: 0.9,
} as const;

/** Взрывы (03 §3.7): J = min(J0·f, m·DV_MAX), f = 1 − d/R, урон D0·f·blastMult. */
export const EXPLOSION = {
  bomb: { R: 3.5, J0: 30, DV_MAX: 20, D0: 100, SPIN: 0.15 },
  tnt: { R: 3.0, J0: 25, DV_MAX: 18, D0: 80, SPIN: 0.15 },
  egg: { R: 2.5, J0: 20, DV_MAX: 16, D0: 70, SPIN: 0.15 },
  /** Задержка звена цепочки TNT, взорванного другим взрывом, с. */
  TNT_CHAIN_DELAY: 0.12,
} as const;

/** Покой сцены (03 §3.8). */
export const SETTLE = {
  V_LIN: 0.1,
  V_ANG: 0.15,
  /** Столько секунд тишины → принудительный сон всем телам. */
  SLEEP_HOLD: 0.5,
} as const;

/** «Уход» птицы (01 §5.1, 03 §3.8). */
export const RETIRE = {
  REST_V: 0.25,
  REST_W: 0.5,
  REST_HOLD: 0.4,
  MIN_AFTER_HIT: 1.0,
  MAX_AFTER_HIT: 6.0,
  FLIGHT_MAX: 12.0,
} as const;

/** Тайминги конечного автомата сессии (01 §5, §8, §10, §13). */
export const TIMING = {
  /** Прыжок птицы в кармашек и сдвиг очереди. */
  BIRD_HOP_TIME: 0.45,
  BIRD_HOP_HEIGHT: 1.2,
  QUEUE_SHIFT_TIME: 0.3,
  /** Между птицами: не меньше TURN_MIN, затем до покоя (CALM_HOLD) или TURN_MAX. */
  TURN_MIN: 0.5,
  TURN_MAX: 1.0,
  CALM_HOLD: 0.5,
  /** Поражение: покой LOSE_HOLD или таймаут LOSE_TIMEOUT после входа в settling. */
  LOSE_HOLD: 0.6,
  LOSE_TIMEOUT: 7.0,
  /** Победа: от гибели последней свиньи не меньше VICTORY_MIN, затем покой VICTORY_HOLD или VICTORY_MAX. */
  VICTORY_MIN: 1.2,
  VICTORY_HOLD: 0.4,
  VICTORY_MAX: 3.5,
  /** Бонус: баннер, пауза, затем по птице раз в BONUS_PER_BIRD. */
  CLEARED_BANNER: 1.2,
  BONUS_PRE: 0.3,
  BONUS_PER_BIRD: 0.45,
} as const;

/** Выражения свиней (02 §4.3). */
export const PIG_MOOD = {
  LAUGH_TIME: 1.2,
  LAUGH_JITTER: 0.4,
  SCARED_DIST: 4,
  SCARED_HOLD: 0.3,
} as const;

/** Очки (01 §9). */
export const SCORE = {
  PIG: 5000,
  BLOCK: 500,
  TNT: 500,
  UNUSED_BIRD: 10000,
} as const;

/** След полёта (01 §3.3). */
export const TRAIL = {
  STEP: 0.45,
  MAX_POINTS: 600,
} as const;

/** Фильтр событий impact (03 §3.6) и первого удара птицы. */
export const IMPACT_FX = {
  MIN_VN: 1.5,
  MIN_J: 0.5,
  PAIR_COOLDOWN: 0.08,
  MAX_PER_STEP: 6,
  /** Удар птицы сильнее этого — событие birdImpact. */
  BIRD_IMPACT_J: 1.0,
} as const;
