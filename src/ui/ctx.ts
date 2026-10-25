// Общие типы UI: зависимости, звуки и внутренний контекст экранов.

import type { EpisodeDef, LevelDef, ThemeId } from '../core/types';
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
  /** Создать/возобновить AudioContext; UI вызывает синхронно из жеста, пока ready не станет true. */
  unlock(): Promise<void>;
  /** AudioContext запущен (AudioEngine.ready). Без поля UI считает звук готовым после первого unlock(). */
  readonly ready?: boolean;
  setSfx(on: boolean): void;
  setMusic(on: boolean): void;
  /** Музыкальный луп в уровнях (настройка «Музыка в уровнях»); без метода — луп как задан движком. */
  setLevelMusic?(on: boolean): void;
}

export type ScreenId = 'loading' | 'title' | 'episodes' | 'levels' | 'game';

export interface UIDeps {
  episodes: readonly EpisodeDef[];
  progress: ProgressStore;
  audio?: UIAudio;
  /** Шторка закрыта — запустить уровень и затем вызвать ui.showHud(level). */
  onPlayLevel(levelId: string): void;
  /** Пользователь открыл паузу (кнопка, Esc/P, скрытие вкладки, поворот) — остановить step(). */
  onPause(): void;
  /** Панель паузы уехала — продолжить (аккумулятор обнулить). */
  onResume(): void;
  /** Экран под фейдом — пересоздать сессию того же уровня. */
  onRestart(): void;
  /** Шторка закрыта — выйти из уровня в меню (UI сам покажет уровни эпизода, если приложение не показало другое). */
  onQuitToMenu(): void;
  /** Шторка закрыта — запустить следующий уровень и вызвать ui.showHud(next). */
  onNextLevel(): void;
  /** Своя реализация полного экрана (иначе UI вызывает Fullscreen API сам). */
  onToggleFullscreen?(): void;
  /** Тап/Пробел по баннеру или подсказке «Коснитесь, чтобы пропустить» — ускорить интро/баннер/бонус. */
  onSkip?(): void;
  /** Кнопка «К рогатке» (видна после ui.setCameraHome(true)). */
  onCameraHome?(): void;
  /** Сменился экран (для музыки и фона меню на canvas). theme — тема эпизода/уровня. */
  onScreenChange?(screen: ScreenId, theme: ThemeId): void;
  /** Пользователь изменил настройки в диалоге (звук/музыку UI применяет сам через audio). */
  onSettingsChange?(s: Readonly<Settings>): void;
  /**
   * Перехватывать системную «Назад» через history.pushState/popstate (по умолчанию true, 07 §1.2):
   * в игре «Назад» открывает паузу, повторно — выход к уровням; в меню — предыдущее меню.
   */
  useHistory?: boolean;
}

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
  toast(text: string, ms?: number, key?: string): void;
  announce(text: string): void;
  loc(levelId: string): LevelLoc | undefined;
  settings(): Readonly<Settings>;
  toggleMusic(): void;
  toggleSfx(): void;
  /** Открыть диалог настроек. */
  openSettings(): void;
  /** Изменить настройки (сохранить, применить к звуку/анимациям, сообщить приложению). */
  setSettings(p: Partial<Settings>): void;
  canFullscreen(): boolean;
  isFullscreen(): boolean;
  toggleFullscreen(): void;
  /** Навигация из экранов. from — нажатая кнопка (центр перехода). */
  goTitle(): void;
  goEpisodes(dir?: 'fwd' | 'back'): void;
  /** from — нажатая карточка эпизода (зум карточки, 07 §5.4). */
  goLevels(epId: string, dir?: 'fwd' | 'back', from?: HTMLElement): void;
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
  /** Размер окна изменился (панель вписывается заново). */
  relayout?(): void;
  destroy?(): void;
}
