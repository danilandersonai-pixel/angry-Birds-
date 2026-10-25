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
// Ядро: физика и игровая логика. Числа — 00-summary.md §1 (единый источник), детали — 01…03.
// ─────────────────────────────────────────────────────────────────────────────

/** Мир и шаг симуляции (00 §1.1). */
export const WORLD = {
  GRAVITY: -15,
  DT: 1 / 60,
  VEL_ITERS: 10,
  POS_ITERS: 8,
  /** Не больше стольких шагов физики за кадр; лишний остаток аккумулятора выбрасывается (GameScreen). */
  MAX_STEPS_PER_FRAME: 4,
  /** Лимит динамических тел уровня, включая птиц (проверка уровней). */
  MAX_DYNAMIC_BODIES: 120,
  /** Сжатие полигонов коллизии с каждой стороны: уровень рисуется встык (03 §2.1 A6). */
  INSET: 0.0075,
  /** Шагов «усадки» без урона на старте, затем принудительный сон (03 §2.3). */
  PRESETTLE_STEPS: 90,
  /** Тело удаляется ниже этой высоты (или ниже самого низкого рельефа − 1 м). */
  KILL_Y: -10,
  /** Тело удаляется за bounds.minX/maxX ± этот запас. */
  BOUNDS_MARGIN: 15,
  /** Тело быстрее FAST_BULLET_V получает CCD (bullet) на FAST_BULLET_T секунд — против туннелирования обломков. */
  FAST_BULLET_V: 25,
  FAST_BULLET_T: 1.0,
  /** Рельеф: трение и упругость (03 §3.3). */
  GROUND_FRICTION: 0.9,
  GROUND_RESTITUTION: 0,
} as const;

/** Коллизионные категории (00 §1.1, 02 §11). */
export const COLLISION = {
  GROUND: 0x0001,
  BIRD: 0x0002,
  PIG: 0x0004,
  BLOCK: 0x0008,
  EGG: 0x0020,
} as const;

/** Рогатка и запуск (00 §1.2). */
export const LAUNCH = {
  /**
   * Скорость при полном натяжении, м/с: v = V_MAX · launchScale · d/R_MAX.
   * Было 24 (00 §1.2): дальность Red 37.7 м — сооружения стояли на 16…34 м, камера отдалялась, персонажи мелкие.
   * 21 — дальность Red на полной силе ≈ 29 м (масштаб (21/24)² ≈ 0.77), сооружения 11…25 м. Урон птиц
   * компенсирует DAMAGE.BIRD_SPEED_COMP, скорости способностей заданы в долях V_MAX и пересчитываются сами.
   */
  V_MAX: 21,
  R_MAX: 2.0,
  /** Отпускание ближе — отмена выстрела. */
  R_CANCEL: 0.5,
  /** Радиус захвата птицы, м (ввод берёт max(GRAB_RADIUS, GRAB_MIN_PX css px)). */
  GRAB_RADIUS: 1.0,
  GRAB_MIN_PX: 44,
  /** Ниже такого масштаба (css px на метр) ввод усиливает ход пальца: полная сила на 90 css px. */
  AIM_MIN_PX_PER_M: 45,
  /** Зазор птицы над землёй при оттяжке. */
  GROUND_CLEARANCE: 0.02,
  /** Сглаживание поворота птицы при прицеливании, с. */
  AIM_ANGLE_TAU: 0.05,
  /** Событие aimStretch — когда натяжение сдвинулось хотя бы на столько от прошлого события. */
  STRETCH_STEP: 0.1,
  /** Точка предсказанной траектории — раз в столько шагов физики. */
  PREDICT_STRIDE: 3,
  /** Очередь: шаг между соседями max(SLINGSHOT.QUEUE_DX, r_i + r_{i+1} + QUEUE_GAP). */
  QUEUE_GAP: 0.2,
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

/** Материалы блоков (00 §1.6). HP = hpPerKg · масса; очки за урон — на м² визуальной площади (1×1 = 100/200/300). */
export const MATERIALS = {
  wood: { density: 0.7, friction: 0.7, restitution: 0.05, v0: 1.5, hpPerKg: 14, blastMult: 1.0, damagePointsPerM2: 200 },
  ice: { density: 0.9, friction: 0.25, restitution: 0.05, v0: 1.5, hpPerKg: 6, blastMult: 1.25, damagePointsPerM2: 100 },
  stone: { density: 2.2, friction: 0.9, restitution: 0.02, v0: 2.5, hpPerKg: 27, blastMult: 1.4, damagePointsPerM2: 300 },
} as const;

/** Ящик TNT (00 §1.6): хрупкий, взрывается при hp ≤ 0. */
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
 * Птицы (00 §1.3). mult — множители урона птицы по целям.
 * Чак — треугольник: outline — вершины в локальных координатах тела, radius — описанный радиус для отрисовки.
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
  terence: { radius: 0.8, density: 2.5, friction: 0.7, restitution: 0.15, launchScale: 0.88, mult: { wood: 1.6, ice: 1.6, stone: 2.0, pig: 1.5, tnt: 1.6 } },
  silver: { radius: 0.45, density: 2.2, friction: 0.5, restitution: 0.28, launchScale: 1.0, mult: { wood: 1.0, ice: 1.0, stone: 0.7, pig: 1.0, tnt: 1.0 } },
} as const;

/** Птица в полёте и после удара (00 §1.3). */
export const BIRD_FLIGHT = {
  ANGULAR_DAMPING: 0.3,
  /** Включается на первом контакте: без этого птица катится 220 м (03 §2.6). */
  HIT_LINEAR_DAMPING: 1.5,
  HIT_ANGULAR_DAMPING: 4,
  /** Способность доступна не раньше, чем через столько секунд после запуска (дребезг пальца). */
  ABILITY_MIN_DELAY: 0.05,
  /** Лицо «ушиб» после удара, с. */
  HURT_TIME: 0.6,
  /** Тап по птице без способности: сведённые брови (поза aim), с. */
  FROWN_TIME: 0.6,
} as const;

/** Способности (00 §1.4; скорости — в долях V_MAX). У Ред и Теренса способности нет. */
export const ABILITY = {
  /** Боевой клич Ред из AB2 — P2, по умолчанию выключен (Classic). Параметры — 02 §3.1. */
  RED_BATTLE_CRY: false,
  RED: { RANGE: 3.5, HALF_ANGLE_DEG: 55, DV_MAX: 5, IMPULSE_CAP: 6, LIFT: 0.25, SELF_SLOW: 0.85 },
  /** Синие — веер из трёх. */
  BLUES: { SPREAD_RAD: 0.14, OFFSET_R: 2.3, SPIN: 2 },
  /** Чак — рывок: |v'| = clamp(SPEED_MUL·|v|, MIN_K·V_MAX, MAX_K·V_MAX). */
  CHUCK: { SPEED_MUL: 1.5, MIN_K: 1.3, MAX_K: 1.6, BOOSTED_WOOD: 2.2 },
  /** Бомб — автоподрыв через FUSE с после первого контакта; последние WARN с — мигание (рендер). */
  BOMB: { FUSE: 2.5, WARN: 1.5 },
  /** Матильда — яйцо вниз, сама вверх под UP_DEG; уходит через DESPAWN с (1.0, было 3 — камера не ждёт улетающую, integ-final Б4). */
  MATILDA: {
    EGG_RADIUS: 0.225, EGG_DENSITY: 8, EGG_FRICTION: 0.5, EGG_OFFSET_R: 0.7, EGG_VY_K: -0.7,
    UP_DEG: 60, UP_MIN_K: 0.62, SPIN: 6, AFTER_DENSITY: 0.5, AFTER_MULT: 0.3, GRAVITY_AFTER: 0.6, DESPAWN: 1.0,
  },
  /** Хэл — бумеранг: дуга с угловой скоростью OMEGA до зеркального курса, поднятого на LIFT_DEG. */
  HAL: { OMEGA: 8, SPEED_MUL: 1.15, MIN_K: 0.9, LIFT_DEG: 10, SPIN: 22, SPIN_DECAY: 0.4 },
  /** Сильвер — петля 2π, затем пике. */
  SILVER: {
    OMEGA: 11, MIN_K: 0.55, DIVE_K: 1.05, DIVE_SIDE: 0.1,
    DIVE_MULT: { wood: 1.3, ice: 1.3, stone: 3.0, pig: 1.0, tnt: 1.3 },
    SLAM_R: 1.2, SLAM_DV: 4, SLAM_MAX_MASS: 3,
  },
} as const;

/** Свиньи (00 §1.5): HP = hpPerKg · масса, каска — отдельный слой HP. damagePoints — очки за полный урон. */
export const PIGS = {
  small: { radius: 0.405, density: 0.8, friction: 0.6, restitution: 0.15, hpPerKg: 6, helmetHp: 0, damagePoints: 50 },
  medium: { radius: 0.6075, density: 0.8, friction: 0.6, restitution: 0.15, hpPerKg: 6, helmetHp: 0, damagePoints: 100 },
  large: { radius: 0.8325, density: 0.8, friction: 0.6, restitution: 0.12, hpPerKg: 7, helmetHp: 0, damagePoints: 200 },
  helmet: { radius: 0.63, density: 0.9, friction: 0.6, restitution: 0.12, hpPerKg: 6, helmetHp: 10, damagePoints: 150 },
  mustache: { radius: 0.72, density: 0.85, friction: 0.6, restitution: 0.12, hpPerKg: 9, helmetHp: 0, damagePoints: 300 },
  king: { radius: 1.17, density: 0.8, friction: 0.65, restitution: 0.1, hpPerKg: 9, helmetHp: 0, damagePoints: 1000 },
} as const;

/** Демпфирование свиней — против вечного качения (03 §3.5). */
export const PIG_PHYS = { ANGULAR_DAMPING: 3, LINEAR_DAMPING: 0.1 } as const;

/** Скорость запуска, при которой откалибрована таблица урона птиц 00 §1.7 (там V_MAX = 24). */
const DAMAGE_CALIB_V = 24;

/** Модель урона (00 §1.7): dmg = mult · max(0, J − m·V0) при скорости сближения vn ≥ V_GATE. */
export const DAMAGE = {
  V_GATE: 0.5,
  BIRD_CALIB_V: DAMAGE_CALIB_V,
  /**
   * Компенсация урона ПТИЦ после снижения V_MAX 24 → 21: импульс удара птицы (и оценка пробития) ×k до вычета порога
   * m·V0 — птица на скорости v бьёт, как на v·k при старой V_MAX, и таблица 00 §1.7 на полной силе сохраняется.
   * k = BIRD_CALIB_V / V_MAX = 24/21 ≈ 1.143. Подобрано прогоном таблицы 00 §1.7 (скорости ×21/24) при k = 1.00…1.25:
   * минимум отклонений на 1.14–1.15 (rms 3.3 %, max 9.2 % — как у ядра при V_MAX 24), за ±10 % ни одной строки;
   * без компенсации урон прямых ударов −14…−24 %. Множитель по энергии (k² к итоговому урону) хуже: +10 % на прямых ударах,
   * −39 % на слабых (порог m·V0) и до +100 % на пробитиях. Урон от падений блоков, о рельеф и от взрывов не меняется.
   */
  BIRD_SPEED_COMP: DAMAGE_CALIB_V / LAUNCH.V_MAX,
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

/** Взрывы (00 §1.8): J = min(J0·f, m·DV_MAX), f = 1 − d/R, урон D0·f·blastMult. */
export const EXPLOSION = {
  bomb: { R: 3.5, J0: 30, DV_MAX: 20, D0: 100, SPIN: 0.15 },
  tnt: { R: 3.0, J0: 25, DV_MAX: 18, D0: 80, SPIN: 0.15 },
  egg: { R: 2.5, J0: 20, DV_MAX: 16, D0: 70, SPIN: 0.15 },
  /** Задержка звена цепочки TNT, взорванного другим взрывом, с. */
  TNT_CHAIN_DELAY: 0.12,
} as const;

/** Покой сцены (00 §1.9). */
export const SETTLE = {
  V_LIN: 0.1,
  V_ANG: 0.15,
  /** Столько секунд тишины без птиц и снарядов → принудительный сон всем телам. */
  SLEEP_HOLD: 0.5,
  /** Бот: ход кончается не позже стольких секунд после удара / после запуска. */
  BOT_AFTER_IMPACT: 8,
  BOT_AFTER_LAUNCH: 10,
} as const;

/** «Уход» птицы (00 §1.9). */
export const RETIRE = {
  REST_V: 0.25,
  REST_W: 0.5,
  REST_HOLD: 0.4,
  MIN_AFTER_HIT: 1.0,
  MAX_AFTER_HIT: 6.0,
  FLIGHT_MAX: 10.0,
  /** Быстрый пропуск тапом — не раньше, чем через столько секунд после первого контакта. */
  QUICK_SKIP_AFTER_HIT: 1.0,
  /** Птица уходит за bounds.minX/maxX ± OUT_MARGIN (тела удаляются дальше — WORLD.BOUNDS_MARGIN). */
  OUT_MARGIN: 8,
} as const;

/** Тайминги конечного автомата сессии (00 §1.12). */
export const TIMING = {
  /** Прыжок птицы в кармашек и сдвиг очереди. */
  BIRD_HOP_TIME: 0.45,
  BIRD_HOP_HEIGHT: 1.2,
  QUEUE_SHIFT_TIME: 0.3,
  /**
   * После ухода птицы: камера задерживается до LINGER_MAX (раньше — при покое CALM_HOLD), затем возвращается к рогатке.
   * 1.6 (было 0.6): разрушение досматривается — GameScreen держит камеру, пока оно идёт (integ-final Б3).
   */
  LINGER_MAX: 1.6,
  CALM_HOLD: 0.5,
  /** Поражение: покой LOSE_HOLD или таймаут LOSE_TIMEOUT после входа в settling. */
  LOSE_HOLD: 0.6,
  LOSE_TIMEOUT: 7.0,
  /** Победа: от гибели последней свиньи не меньше VICTORY_MIN, затем покой VICTORY_HOLD или VICTORY_MAX. */
  VICTORY_MIN: 1.2,
  VICTORY_HOLD: 0.4,
  /** 2.0 (было 3.5): финал победы без тапа ≈ 3.4 с вместо 5.4 с (integ-final Б3). */
  VICTORY_MAX: 2.0,
  /**
   * Бонус: баннер, пауза, по птице раз в BONUS_PER_BIRD, хвост BONUS_POST (без птиц — BONUS_NONE после баннера).
   * CLEARED_BANNER 0.4 (было 1.2): баннер GameScreen показывает раньше, ещё в VICTORY_DELAY (integ-final Б3).
   */
  CLEARED_BANNER: 0.4,
  BONUS_PRE: 0.3,
  BONUS_PER_BIRD: 0.45,
  BONUS_POST: 0.5,
  BONUS_NONE: 0.6,
} as const;

/** Выражения свиней (00 §1.5, 02 §4.3). */
export const PIG_MOOD = {
  LAUGH_TIME: 1.2,
  LAUGH_JITTER: 0.4,
  SCARED_DIST: 4,
  SCARED_HOLD: 0.3,
  /** Урон не меньше этого — событие pigDamaged (вздрагивание) даже без смены стадии. */
  FLINCH_DMG: 0.5,
} as const;

/** Очки (00 §1.11). */
export const SCORE = {
  PIG: 5000,
  BLOCK: 500,
  TNT: 500,
  UNUSED_BIRD: 10000,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Камера, след, подсказка, события, всплывающие очки, тайминги UI (00 §1.15).
// ─────────────────────────────────────────────────────────────────────────────

export const CAMERA = {
  VIEW_H_MIN: 9, VIEW_H_MAX: 30, AIM_VIEW_H_MIN: 15, AIM_VIEW_H_MAX: 24, AIM_RIGHT_PAD: 2, PARALLAX_REF_VIEW_H: 15,
  GROUND_MARGIN: 1.2, SLING_SCREEN_X: 0.20, FOLLOW_BAND: [0.25, 0.65],
  FOLLOW_TAU_POS: 0.18, FOLLOW_TAU_ZOOM: 0.35, LOOKAHEAD_K: 0.35, LOOKAHEAD_MIN: -4, LOOKAHEAD_MAX: 6, HEADROOM: 3.0,
  PAN_INERTIA_TAU: 0.25, PAN_STOP_V: 0.2, PAN_VEL_WINDOW: 0.08, PAN_THRESHOLD_PX: 8,
  WHEEL_K: 0.0015, WHEEL_K_CTRL: 0.01, KEY_PAN_V: 15, KEY_ZOOM: 1.15, TOGGLE_FIT_T: 0.5,
  INTRO_HOLD: 1.0, INTRO_PAN: 1.8, INTRO_PAN_LONG: 2.3, INTRO_HOLD_REPEAT: 0.3, INTRO_PAN_REPEAT: 0.8, INTRO_SKIP: 0.3,
  /** Возврат к рогатке: T = clamp(RETURN_BASE + dist·RETURN_PER_M, RETURN_MIN, RETURN_MAX) — его ждёт и ядро между птицами. */
  RETURN_BASE: 0.5, RETURN_PER_M: 1 / 45, RETURN_MIN: 0.6, RETURN_MAX: 1.4,
  SHAKE_MAX: 0.35, SHAKE_IMPACT_DIV: 400, SHAKE_IMPACT_T: 0.3, SHAKE_BLAST_K: 0.1, SHAKE_BLAST_T: 0.35,
  SHAKE_ABILITY: 0.08, SHAKE_ABILITY_T: 0.12, TO_SLING_BTN_DELAY: 0.5,
} as const;

/** След полёта (00 §1.2): точка каждые STEP м пути до первого контакта; кольцевой буфер MAX_POINTS. */
export const TRAIL = { STEP: 0.45, R_BIG: 0.11, R_SMALL: 0.065, R_ABILITY: 0.22, BLUES_K: 0.7, MAX_POINTS: 400, FADE: 0.2, APPEAR: 0.12 } as const;

export const AIM_ASSIST = { SHORT_STEPS: 30, ALPHA_FROM: 0.7, ALPHA_TO: 0.1, FORCED_LEVELS: ['1-1', '1-2', '1-3'] } as const;

/** Фильтр событий impact: скорость сближения и импульс, не чаще раза в PAIR_COOLDOWN на пару, не больше MAX_PER_STEP за шаг. */
export const IMPACT_EVENT = { VN_MIN: 1.5, J_MIN: 0.5, PAIR_COOLDOWN: 0.08, SHAKE_J_MIN: 20, MAX_PER_STEP: 6 } as const;

export const POPUP = {
  MERGE_R: 1.2, MERGE_T: 0.25, STACK_R: 0.5, STACK_DY: 0.45, RISE: 1.4, LIFE: 0.9, FADE_FROM: 0.6,
  SIZE_BIG: 0.9, SIZE_BLOCK: 0.6, MIN_PX: 14, HUD_COUNT_TAU: 0.12, HUD_PULSE_FROM: 5000,
} as const;

export const UI_TIMING = {
  BANNER_SKIP: 0.3, BONUS_POST: TIMING.BONUS_POST, BONUS_NONE: TIMING.BONUS_NONE, BONUS_SKIP_SPEED: 4, LOST_BANNER: 1.0,
  RESTART_FADE_OUT: 0.15, RESTART_FADE_IN: 0.2, IRIS_CLOSE: 0.45, IRIS_OPEN: 0.5, IRIS_MIN_HOLD: 0.12,
  RESULTS_SLIDE: 0.4, STAR_LAND: [0.5, 0.95, 1.4], STAR_LEAD: 0.19, BUTTONS_ACTIVE: 1.7, SCORE_ROLL_FROM: 1.65, SCORE_ROLL: 1.2,
  NEXT_PULSE: 3.15, STAR_LAND_REDUCED: [0.3, 0.55, 0.8], SCORE_ROLL_REDUCED: 0.5,
} as const;
