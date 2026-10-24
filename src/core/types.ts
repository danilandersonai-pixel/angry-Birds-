// Общие типы игры. Этот файл — КОНТРАКТ между модулями (ядро, рендер, звук, UI, уровни).
// Меняй его только осознанно: от него зависят все остальные части.
//
// Система координат мира: метры, ось X вправо, ось Y ВВЕРХ (как в Box2D), углы — радианы против часовой.
// Земля (верх базового рельефа) обычно на y = 0. Рогатка — слева, конструкции — справа.

export type Vec = { x: number; y: number };

/** Типы птиц. */
export type BirdType =
  | 'red' // Ред — базовая птица без способности
  | 'blues' // Синие — делятся на троих
  | 'chuck' // Чак — ускорение по направлению полёта
  | 'bomb' // Бомб — взрыв по тапу или через время после удара
  | 'matilda' // Матильда — сбрасывает яйцо-бомбу и улетает вверх
  | 'hal' // Хэл — бумеранг, разворачивается назад
  | 'terence' // Теренс — большой и тяжёлый, без способности
  | 'silver'; // Сильвер — петля и удар вниз

/** Типы свиней. */
export type PigType =
  | 'small' // маленький миньон
  | 'medium' // средний миньон
  | 'large' // большой миньон
  | 'helmet' // свин в каске (броня)
  | 'mustache' // усатый бригадир
  | 'king'; // король

/** Материалы блоков. */
export type Material = 'wood' | 'ice' | 'stone';

/** Форма блока. */
export type BlockShape =
  | 'rect' // прямоугольник w×h (балки, колонны, квадраты)
  | 'circle' // круг диаметром w (колёса, валуны)
  | 'triangle' // прямоугольный треугольник: катеты w (по X) и h (по Y), прямой угол внизу слева
  | 'isoTriangle'; // равнобедренный треугольник: основание w, высота h (крыши)

/** Темы оформления (по эпизодам). */
export type ThemeId = 'meadow' | 'beach' | 'snow';

/** Блок конструкции. (x, y) — центр ограничивающего прямоугольника формы в мире, angle — поворот вокруг центра. */
export interface BlockDef {
  material: Material;
  shape: BlockShape;
  x: number;
  y: number;
  w: number;
  h: number;
  angle?: number;
}

/** Свинья. (x, y) — центр. */
export interface PigDef {
  type: PigType;
  x: number;
  y: number;
}

/** Ящик TNT (квадрат size×size). Взрывается от сильного удара. */
export interface TntDef {
  x: number;
  y: number;
  size?: number; // по умолчанию 1.0 м
  angle?: number;
}

/**
 * Статический рельеф: замкнутый многоугольник (точки по часовой или против — неважно, ядро нормализует).
 * Может быть невыпуклым — ядро само разобьёт его на выпуклые части / цепочку рёбер.
 * kind: 'ground' — земля с травой сверху; 'rock' — скала/каменный уступ; 'platform' — деревянный/каменный неразрушимый помост.
 */
export interface TerrainDef {
  kind: 'ground' | 'rock' | 'platform';
  points: Array<[number, number]>;
}

/** Пороги очков для звёзд. */
export interface StarThresholds {
  one: number;
  two: number;
  three: number;
}

/** Описание уровня. */
export interface LevelDef {
  /** Идентификатор вида "1-3" (эпизод-номер). */
  id: string;
  /** Название уровня (рус.). */
  name: string;
  theme: ThemeId;
  /** Птицы в порядке запуска. */
  birds: BirdType[];
  /** ANCHOR рогатки в мире — центр «кармашка» в покое = основание рогатки + SLINGSHOT.ANCHOR (0, 2.7). Обычно (0, 2.7) при земле y=0. */
  slingshot: Vec;
  /** Границы мира: за пределами птица/обломки удаляются. Камера ограничена ими. */
  bounds: { minX: number; maxX: number; maxY: number };
  /** Рельеф. Обычно первый элемент — широкая земля под всем уровнем. */
  terrain: TerrainDef[];
  blocks: BlockDef[];
  pigs: PigDef[];
  tnt?: TntDef[];
  stars: StarThresholds;
  /** Необязательная подсказка/обучение на старте уровня (рус.). */
  hint?: string;
}

/** Эпизод кампании. */
export interface EpisodeDef {
  id: string; // '1', '2', '3'
  name: string; // рус.
  theme: ThemeId;
  levels: LevelDef[];
}
