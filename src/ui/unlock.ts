// Разблокировка звука жестом (07 §15.3). Сенсорный pointerdown по HTML не считается активацией пользователя —
// ею считаются pointerup/touchend/click/keydown, поэтому пробуем на каждом из этих жестов, пока контекст
// не перейдёт в running (audio.ready). Флаг «готово» ставится только по факту, а не после первой попытки.

export interface Unlockable {
  unlock(): Promise<void>;
  /** true — AudioContext запущен. Нет поля — считаем готовым после первого успешного unlock(). */
  readonly ready?: boolean;
}

/** Жесты, на которых браузеры разрешают запуск звука. */
export const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

export class AudioUnlocker {
  /** Звук разблокирован — слушатели можно снять. */
  done = false;
  /** Вызывается один раз, когда done стал true. */
  onDone: (() => void) | null = null;

  constructor(private readonly audio: Unlockable | undefined) {
    if (!audio) this.done = true;
  }

  /** Вызывать синхронно из обработчика жеста (требование браузеров). */
  gesture(): void {
    const a = this.audio;
    if (this.done || !a) return;
    if (a.ready === true) {
      this.finish();
      return;
    }
    let p: Promise<void>;
    try {
      p = a.unlock();
    } catch {
      return; // без звука игра идёт; попробуем на следующем жесте
    }
    void Promise.resolve(p).then(
      () => {
        if (a.ready !== false) this.finish();
      },
      () => undefined,
    );
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }
}
