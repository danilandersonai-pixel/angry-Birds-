// Сохранение прогресса: рекорды и звёзды уровней, настройки звука.
// Хранилище — localStorage (ключ STORAGE_KEY), внутри — версия схемы.
// Любые ошибки доступа/квоты/битые данные не роняют игру: работаем в памяти.

export const STORAGE_KEY = 'angrybirds.progress.v1';
/** Ключ, куда откладывается нечитаемая запись (для отладки), прежде чем начать с чистого листа. */
export const CORRUPT_KEY = `${STORAGE_KEY}.corrupt`;
export const SCHEMA_VERSION = 1;

export interface LevelRecord {
  best: number;
  stars: number;
}

export interface Settings {
  sfx: boolean;
  music: boolean;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Формат записи в хранилище (схема 1). */
interface SaveData {
  schema: number;
  updatedAt: number;
  levels: Record<string, LevelRecord>;
  settings: Settings;
}

const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({ sfx: true, music: true });
/** Допустимый id уровня: «1-3», «bonus_2» и т. п. Неизвестные (будущие) id сохраняем. */
const ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;
/** Защита от абсурдных значений (переполнение, ручная правка). */
const MAX_SCORE = 1e9;

/** Сколько звёзд нужно собрать в эпизоде, чтобы открыть следующий (01 §12.2): половина от максимума. */
export function episodeStarsNeeded(levelCount: number): number {
  return Math.ceil(0.5 * 3 * Math.max(0, levelCount));
}

/** Эпизод уровня по id вида «2-7» → «2». Для id без дефиса — null (нет «ворот» эпизода). */
export function episodeOfLevel(levelId: string): string | null {
  const i = levelId.lastIndexOf('-');
  return i > 0 ? levelId.slice(0, i) : null;
}

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sanitizeRecord(v: unknown): LevelRecord | null {
  if (!isObj(v)) return null;
  const stars = clampInt(v.stars, 0, 3);
  const best = clampInt(v.best, 0, MAX_SCORE);
  if (stars === 0 && best === 0) return null; // пустая запись — как будто её нет
  return { best, stars };
}

function sanitizeSettings(v: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  if (isObj(v)) {
    if (typeof v.sfx === 'boolean') s.sfx = v.sfx;
    if (typeof v.music === 'boolean') s.music = v.music;
  }
  return s;
}

function emptyData(): SaveData {
  return { schema: SCHEMA_VERSION, updatedAt: 0, levels: {}, settings: { ...DEFAULT_SETTINGS } };
}

/** Миграции: MIGRATIONS[n] переводит объект схемы n в схему n+1. Пока схема одна. */
const MIGRATIONS: Record<number, (o: Record<string, unknown>) => Record<string, unknown>> = {
  // 0 — «без версии»: ранние черновики хранили { version, levels, settings } (01 §12.1).
  0: (o) => ({ ...o, schema: 1 }),
};

/** Привести произвольный объект к SaveData. Возвращает null, если это вообще не наш формат. */
function sanitize(raw: unknown): { data: SaveData; schema: number } | null {
  if (!isObj(raw)) return null;
  let o = raw;
  let schema = typeof o.schema === 'number' && Number.isInteger(o.schema) ? o.schema : 0;
  if (schema > SCHEMA_VERSION) {
    // Сохранение из будущей версии: читаем то, что понимаем, но не перезаписываем.
  } else {
    while (schema < SCHEMA_VERSION) {
      const m = MIGRATIONS[schema];
      if (!m) return null;
      o = m(o);
      schema++;
    }
  }
  const data = emptyData();
  if (isObj(o.levels)) {
    for (const [id, rec] of Object.entries(o.levels)) {
      if (!ID_RE.test(id)) continue;
      const r = sanitizeRecord(rec);
      if (r) data.levels[id] = r;
    }
  }
  data.settings = sanitizeSettings(o.settings);
  data.updatedAt = clampInt(o.updatedAt, 0, Number.MAX_SAFE_INTEGER);
  return { data, schema: typeof raw.schema === 'number' ? (raw.schema as number) : 0 };
}

/** Безопасно получить window.localStorage (доступ к нему сам может бросить SecurityError). */
function defaultStorage(): StorageLike | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

export class ProgressStore {
  /** true — данные пишутся в хранилище; false — только в памяти (нет доступа, квота, ошибка). */
  persistent: boolean;
  /** true — в хранилище запись более новой схемы: читаем, но не перезаписываем. */
  readonly readOnly: boolean;
  /** Отладка: открыть все уровни без записи в хранилище (?unlockAll=1). */
  unlockAll = false;

  private readonly storage: StorageLike | null;
  private data: SaveData;

  /**
   * storage: undefined — взять window.localStorage (если доступен); null — работать только в памяти.
   */
  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.persistent = this.storage !== null;
    const { data, readOnly } = this.load();
    this.data = data;
    this.readOnly = readOnly;
  }

  // ───────────── чтение ─────────────

  /** Запись уровня (копия) или undefined, если уровень ещё не пройден. */
  record(levelId: string): LevelRecord | undefined {
    const r = this.data.levels[levelId];
    return r ? { best: r.best, stars: r.stars } : undefined;
  }

  /** Текущие настройки (снимок, только для чтения). */
  get settings(): Readonly<Settings> {
    return { ...this.data.settings };
  }

  /**
   * Открыт ли уровень. order — порядок ВСЕХ уровней кампании (эпизоды подряд).
   * Правила (07 §0 п.15, 01 §12.2): первый уровень открыт; следующий — после победы в предыдущем;
   * первый уровень нового эпизода дополнительно требует половину звёзд предыдущего эпизода (15 из 30).
   */
  isUnlocked(levelId: string, order: readonly string[]): boolean {
    const idx = order.indexOf(levelId);
    if (idx < 0) return false;
    if (idx === 0 || this.unlockAll) return true;
    const prev = order[idx - 1]!;
    const prevRec = this.data.levels[prev];
    if (!prevRec || prevRec.stars <= 0) return false;
    const ep = episodeOfLevel(levelId);
    const prevEp = episodeOfLevel(prev);
    if (ep !== null && prevEp !== null && ep !== prevEp) {
      const prevIds = order.filter((id) => episodeOfLevel(id) === prevEp);
      if (this.starsTotal(prevIds) < episodeStarsNeeded(prevIds.length)) return false;
    }
    return true;
  }

  /** Сумма звёзд по списку уровней (или по всем записям, если список не задан). */
  starsTotal(levelIds?: readonly string[]): number {
    let sum = 0;
    if (levelIds) {
      for (const id of levelIds) sum += this.data.levels[id]?.stars ?? 0;
    } else {
      for (const r of Object.values(this.data.levels)) sum += r.stars;
    }
    return sum;
  }

  // ───────────── запись ─────────────

  /**
   * Записать результат уровня. stars ≤ 0 — поражение: рекорды не меняются.
   * Худший результат не снижает ни звёзд, ни рекорда.
   * newRecord — только если рекорд уже был (prevBest > 0) и побит (07 §12.3): первое прохождение — не «новый рекорд».
   */
  saveResult(levelId: string, score: number, stars: number): { newRecord: boolean; prevBest: number } {
    const prev = this.data.levels[levelId];
    const prevBest = prev?.best ?? 0;
    const s = clampInt(stars, 0, 3);
    const sc = clampInt(score, 0, MAX_SCORE);
    if (s <= 0 || !ID_RE.test(levelId)) return { newRecord: false, prevBest };
    const next: LevelRecord = { best: Math.max(prevBest, sc), stars: Math.max(prev?.stars ?? 0, s) };
    this.data.levels[levelId] = next;
    this.write();
    return { newRecord: prevBest > 0 && sc > prevBest, prevBest };
  }

  setSettings(s: Partial<Settings>): void {
    const cur = this.data.settings;
    let changed = false;
    if (typeof s.sfx === 'boolean' && s.sfx !== cur.sfx) {
      cur.sfx = s.sfx;
      changed = true;
    }
    if (typeof s.music === 'boolean' && s.music !== cur.music) {
      cur.music = s.music;
      changed = true;
    }
    if (changed) this.write();
  }

  /** Сбросить прогресс (звёзды и рекорды). Настройки звука сохраняются. */
  reset(): void {
    const settings = { ...this.data.settings };
    this.data = emptyData();
    this.data.settings = settings;
    this.write();
  }

  /** Перечитать хранилище (например, по событию `storage` из другой вкладки). */
  reload(): void {
    this.data = this.load().data;
  }

  // ───────────── внутреннее ─────────────

  private load(): { data: SaveData; readOnly: boolean } {
    if (!this.storage) return { data: emptyData(), readOnly: false };
    let text: string | null = null;
    try {
      text = this.storage.getItem(STORAGE_KEY);
    } catch {
      this.persistent = false;
      return { data: emptyData(), readOnly: false };
    }
    if (text === null || text === '') return { data: emptyData(), readOnly: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const res = parsed === undefined ? null : sanitize(parsed);
    if (!res) {
      // Битые данные: откладываем копию и начинаем заново.
      try {
        this.storage.setItem(CORRUPT_KEY, text);
        this.storage.removeItem(STORAGE_KEY);
      } catch {
        /* хранилище недоступно для записи — не страшно */
      }
      return { data: emptyData(), readOnly: false };
    }
    return { data: res.data, readOnly: res.schema > SCHEMA_VERSION };
  }

  private write(): void {
    if (!this.storage || !this.persistent || this.readOnly) return;
    this.data.updatedAt = Date.now();
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Квота или запрет: дальше — только в памяти.
      this.persistent = false;
    }
  }
}
