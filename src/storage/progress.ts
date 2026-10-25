// Сохранение прогресса (07 §17, 00-summary §1.14): рекорды и звёзды уровней, серии поражений,
// флаги «уже видел», настройки. Хранилище — localStorage (ключ STORAGE_KEY), внутри — версия схемы.
// Любые ошибки доступа/квоты/битые данные не роняют игру: работаем в памяти.
//
// API:
//   new ProgressStore(storage?: StorageLike | null)  — undefined: window.localStorage; null: только память
//   record(id) → {best, stars} | undefined            — запись уровня (копия)
//   saveResult(id, score, stars) → {newRecord, prevBest}  — победа (stars ≥ 1); худшее не снижает
//   saveLoss(id) → failStreak                          — поражение: серия поражений подряд +1
//   failStreak(id) → number
//   isUnlocked(id, order) / starsTotal(ids?)
//   settings / setSettings(partial) / reset()          — reset стирает уровни, настройки остаются
//   hasSeen(key) / markSeen(key)                        — одноразовые подсказки («ability:chuck», «aimTutorial»)
//   onChange(fn) → отписка; bindStorageEvents() → отписка (синхронизация вкладок)
//   persistent, readOnly, unlockAll                  — readOnly: запись будущей версии, прогресс не пишется (UI предупреждает тостом)

export const STORAGE_KEY = 'angrybirds.progress.v1';
/** Ключ, куда откладывается нечитаемая запись (для отладки), прежде чем начать с чистого листа. */
export const CORRUPT_KEY = `${STORAGE_KEY}.corrupt`;
export const SCHEMA_VERSION = 1;

export interface LevelRecord {
  best: number;
  stars: number;
}

export type MotionPref = 'system' | 'reduce' | 'full';
export type QualityPref = 'auto' | 'high' | 'med' | 'low';
export type AimAssistPref = 'off' | 'short';

export interface Settings {
  sfx: boolean;
  music: boolean;
  /** Музыкальный луп в уровнях (при music = true; в меню музыка играет всегда). */
  levelMusic: boolean;
  /** Анимации интерфейса: как в системе / уменьшить / полные. */
  motion: MotionPref;
  /** Тряска камеры: явно вкл/выкл или «авто» — включена, если движение не уменьшено (07 §19.3, см. shakeOn). */
  shake: boolean | 'auto';
  /** Вибрация (navigator.vibrate) на тач-устройствах. */
  haptics: boolean;
  /** Качество графики (04 §11). */
  quality: QualityPref;
  /** Подсказка траектории при прицеливании. */
  aimAssist: AimAssistPref;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Формат записи в хранилище (схема 1). */
interface SaveData {
  schema: number;
  updatedAt: number;
  levels: Record<string, LevelRecord>;
  /** Поражений подряд по уровням (совет после трёх). */
  fails: Record<string, number>;
  /** Флаги «уже показывали». */
  seen: string[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  sfx: true,
  music: true,
  levelMusic: true,
  motion: 'system',
  shake: 'auto',
  haptics: true,
  quality: 'auto',
  aimAssist: 'off',
} satisfies Settings);

/** Тряска камеры по настройке: явное вкл/выкл или «авто» — только при неуменьшенном движении (07 §19.3). */
export function shakeOn(s: Readonly<Pick<Settings, 'shake'>>, reduced: boolean): boolean {
  return s.shake === 'auto' ? !reduced : s.shake;
}

const MOTION: readonly MotionPref[] = ['system', 'reduce', 'full'];
const QUALITY: readonly QualityPref[] = ['auto', 'high', 'med', 'low'];
const AIM: readonly AimAssistPref[] = ['off', 'short'];

/** Допустимый id уровня: «1-3», «bonus_2» и т. п. Неизвестные (будущие) id сохраняем. */
const ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;
/** Ключ флага «уже видел». */
const SEEN_RE = /^[A-Za-z0-9_.:-]{1,48}$/;
export const SEEN_MAX = 256;
/** Ключи, которые ставит игра (обучение прицелу, способности, подсказки уровней): при переполнении уходят последними. */
const SEEN_KNOWN_RE = /^(aimTutorial|ability:[a-z]+|hint:[A-Za-z0-9_.-]+)$/;
/** Защита от абсурдных значений (переполнение, ручная правка). */
const MAX_SCORE = 1e9;
const MAX_FAILS = 9999;

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
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}

function sanitizeRecord(v: unknown): LevelRecord | null {
  if (!isObj(v)) return null;
  const stars = clampInt(v.stars, 0, 3);
  const best = clampInt(v.best, 0, MAX_SCORE);
  if (stars === 0 && best === 0) return null; // пустая запись — как будто её нет
  return { best, stars };
}

function sanitizeSettings(v: unknown, base: Readonly<Settings> = DEFAULT_SETTINGS): Settings {
  const s: Settings = { ...base };
  if (!isObj(v)) return s;
  if (typeof v.sfx === 'boolean') s.sfx = v.sfx;
  if (typeof v.music === 'boolean') s.music = v.music;
  if (typeof v.levelMusic === 'boolean') s.levelMusic = v.levelMusic;
  if (typeof v.shake === 'boolean' || v.shake === 'auto') s.shake = v.shake;
  if (typeof v.haptics === 'boolean') s.haptics = v.haptics;
  if (v.motion !== undefined) s.motion = oneOf(v.motion, MOTION, base.motion);
  if (v.quality !== undefined) s.quality = oneOf(v.quality, QUALITY, base.quality);
  if (v.aimAssist !== undefined) s.aimAssist = oneOf(v.aimAssist, AIM, base.aimAssist);
  return s;
}

function emptyData(): SaveData {
  return { schema: SCHEMA_VERSION, updatedAt: 0, levels: {}, fails: {}, seen: [], settings: { ...DEFAULT_SETTINGS } };
}

/**
 * Ограничить список «уже видел» SEEN_MAX ключами: сначала уходят самые старые незнакомые (мусор, ключи других версий),
 * затем — самые старые вообще. keep (только что отмеченный ключ) не вытесняется.
 */
function capSeen(keys: readonly string[], keep?: string): string[] {
  let over = keys.length - SEEN_MAX;
  if (over <= 0) return [...keys];
  const out: string[] = [];
  for (const k of keys) {
    if (over > 0 && k !== keep && !SEEN_KNOWN_RE.test(k)) {
      over--;
      continue;
    }
    out.push(k);
  }
  while (out.length > SEEN_MAX) {
    const i = out.findIndex((k) => k !== keep);
    out.splice(i < 0 ? 0 : i, 1);
  }
  return out;
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
  // версия: поля нет — ранний черновик (0); целое ≥ 0 — наша схема; иначе (1.5, −1, «1», null) — не наш формат
  const v = raw.schema;
  if (v !== undefined && !(typeof v === 'number' && Number.isInteger(v) && v >= 0)) return null;
  const rawSchema = v === undefined ? 0 : v;
  let schema = rawSchema;
  if (schema <= SCHEMA_VERSION) {
    while (schema < SCHEMA_VERSION) {
      const m = MIGRATIONS[schema];
      if (!m) return null;
      o = m(o);
      schema++;
    }
  }
  // schema > SCHEMA_VERSION — сохранение из будущей версии: читаем то, что понимаем, но не перезаписываем.
  const data = emptyData();
  if (isObj(o.levels)) {
    for (const [id, rec] of Object.entries(o.levels)) {
      if (!ID_RE.test(id)) continue;
      const r = sanitizeRecord(rec);
      if (r) data.levels[id] = r;
    }
  }
  if (isObj(o.fails)) {
    for (const [id, n] of Object.entries(o.fails)) {
      const k = clampInt(n, 0, MAX_FAILS);
      if (ID_RE.test(id) && k > 0) data.fails[id] = k;
    }
  }
  if (Array.isArray(o.seen)) {
    const set = new Set<string>();
    for (const k of o.seen) if (typeof k === 'string' && SEEN_RE.test(k)) set.add(k);
    data.seen = capSeen([...set]);
  }
  data.settings = sanitizeSettings(o.settings);
  data.updatedAt = clampInt(o.updatedAt, 0, Number.MAX_SAFE_INTEGER);
  return { data, schema: rawSchema };
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
  /** true — в хранилище запись более новой схемы (целая версия > SCHEMA_VERSION): читаем, но не перезаписываем. */
  readOnly: boolean;
  /** Отладка: открыть все уровни без записи в хранилище (?unlockAll=1). */
  unlockAll = false;

  private readonly storage: StorageLike | null;
  private data: SaveData;
  private readonly listeners = new Set<() => void>();

  /**
   * storage: undefined — взять window.localStorage (если доступен); null — работать только в памяти.
   */
  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
    this.persistent = this.storage !== null;
    this.readOnly = false;
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

  /** Поражений подряд на уровне (сбрасывается победой). */
  failStreak(levelId: string): number {
    return this.data.fails[levelId] ?? 0;
  }

  /** Показывали ли одноразовую подсказку/обучение с этим ключом. */
  hasSeen(key: string): boolean {
    return this.data.seen.includes(key);
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
   * Записать победу. stars ≤ 0 — не победа: ничего не меняется (для поражения — saveLoss).
   * Худший результат не снижает ни звёзд, ни рекорда. Серия поражений обнуляется.
   * newRecord — только если рекорд уже был (prevBest > 0) и побит (07 §12.3): первое прохождение — не «новый рекорд».
   */
  saveResult(levelId: string, score: number, stars: number): { newRecord: boolean; prevBest: number } {
    const prev = this.data.levels[levelId];
    const prevBest = prev?.best ?? 0;
    const s = clampInt(stars, 0, 3);
    const sc = clampInt(score, 0, MAX_SCORE);
    if (s <= 0 || !ID_RE.test(levelId)) return { newRecord: false, prevBest };
    this.data.levels[levelId] = { best: Math.max(prevBest, sc), stars: Math.max(prev?.stars ?? 0, s) };
    delete this.data.fails[levelId];
    this.commit();
    return { newRecord: prevBest > 0 && sc > prevBest, prevBest };
  }

  /** Записать поражение. Возвращает число поражений подряд на этом уровне. */
  saveLoss(levelId: string): number {
    if (!ID_RE.test(levelId)) return 0;
    const n = Math.min(MAX_FAILS, (this.data.fails[levelId] ?? 0) + 1);
    this.data.fails[levelId] = n;
    this.commit();
    return n;
  }

  /** Отметить одноразовую подсказку как показанную (список полон — вытесняются самые старые незнакомые ключи). */
  markSeen(key: string): void {
    if (!SEEN_RE.test(key) || this.data.seen.includes(key)) return;
    this.data.seen = capSeen([...this.data.seen, key], key);
    this.commit();
  }

  setSettings(s: Partial<Settings>): void {
    const next = sanitizeSettings(s, this.data.settings);
    const cur = this.data.settings;
    const changed = (Object.keys(next) as Array<keyof Settings>).some((k) => next[k] !== cur[k]);
    if (!changed) return;
    this.data.settings = next;
    this.commit();
  }

  /** Сбросить прогресс (звёзды, рекорды, серии, флаги подсказок). Настройки сохраняются. */
  reset(): void {
    const settings = { ...this.data.settings };
    this.data = emptyData();
    this.data.settings = settings;
    this.commit();
  }

  /** Перечитать хранилище (например, по событию `storage` из другой вкладки). */
  reload(): void {
    const { data, readOnly } = this.load();
    this.data = data;
    this.readOnly = readOnly;
    this.emit();
  }

  /** Подписка на любые изменения прогресса. Возвращает отписку. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Слушать запись другой вкладки (событие `storage`). Возвращает отписку. */
  bindStorageEvents(target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window !== 'undefined' ? window : null): () => void {
    if (!target || !this.storage) return () => undefined;
    const h = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY || e.key === null) this.reload();
    };
    target.addEventListener('storage', h);
    return () => target.removeEventListener('storage', h);
  }

  // ───────────── внутреннее ─────────────

  private commit(): void {
    this.write();
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* подписчик не должен ломать сохранение */
      }
    }
  }

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
