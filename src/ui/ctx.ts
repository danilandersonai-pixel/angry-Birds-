// Общие типы UI: зависимости, звуки и внутренний контекст экранов.

import type { EpisodeDef, LevelDef } from '../core/types';
import type { ProgressStore, Settings } from '../storage/progress';

export type UISound =
  | 'click'
  | 'back'
  | 'pop'
  | 'swoosh'
  | 'star1'
  | 'star2'
  | 'star3'
  | 'tick'
  | 'win'
  | 'lose'
  | 'newRecord';

export interface UIAudio {
  ui(name: UISound): void;
  unlock(): Promise<void>;
  setSfx(on: boolean): void;
  setMusic(on: boolean): void;
}

export interface UIDeps {
  episodes: readonly EpisodeDef[];
  progress: ProgressStore;
  audio?: UIAudio;
  onPlayLevel(levelId: string): void;
  onPause(): void;
  onResume(): void;
  onRestart(): void;
  onQuitToMenu(): void;
  onNextLevel(): void;
  onToggleFullscreen?(): void;
}

export type ScreenId = 'loading' | 'title' | 'episodes' | 'levels' | 'game';

/** Где уровень лежит в кампании. */
export interface LevelLoc {
  level: LevelDef;
  episode: EpisodeDef;
  epIndex: number;
  index: number; // номер в эпизоде, с 0
  globalIndex: number;
}

/** Внутренний контекст, который UI даёт экранам. */
export interface UiCtx {
  readonly deps: UIDeps;
  readonly order: readonly string[];
  sfx(name: UISound): void;
  toast(text: string, ms?: number): void;
  announce(text: string): void;
  loc(levelId: string): LevelLoc | undefined;
  settings(): Readonly<Settings>;
  toggleMusic(): void;
  toggleSfx(): void;
  canFullscreen(): boolean;
  isFullscreen(): boolean;
  toggleFullscreen(): void;
  /** Навигация из экранов. from — нажатая кнопка (центр перехода). */
  goTitle(): void;
  goEpisodes(dir?: 'fwd' | 'back'): void;
  goLevels(epId: string, dir?: 'fwd' | 'back'): void;
  playLevel(levelId: string, from: HTMLElement): void;
  restart(): void;
  next(from?: HTMLElement): void;
  quit(from?: HTMLElement): void;
  resume(): void;
  /** Что в этой сессии показывалось закрытым («ep:1», «lv:1-3») — для анимации «замок слетает». */
  readonly seenLocked: Set<string>;
}

/** Экран меню/игры, которым управляет UI. */
export interface View {
  readonly id: ScreenId;
  readonly el: HTMLElement;
  /** Ключ для идемпотентности (например, id эпизода у экрана уровней). */
  readonly key?: string;
  /** Вызывается после вставки в DOM. */
  enter(): void;
  /** Фокус на главный элемент. */
  focus(): void;
  /** Клавиша; true — обработана. */
  onKey?(e: KeyboardEvent): boolean;
  destroy?(): void;
}

/** Оверлей поверх игры (пауза, победа, поражение). */
export interface OverlayView {
  readonly kind: 'pause' | 'win' | 'lose';
  readonly el: HTMLElement;
  enter(): void;
  /** Анимация закрытия; промис — когда можно удалять. */
  leave(): Promise<void>;
  focus(): void;
  onKey?(e: KeyboardEvent): boolean;
  /** Довести все анимации до конца (предпросмотр ?static=1). */
  finish?(): void;
  destroy?(): void;
}
