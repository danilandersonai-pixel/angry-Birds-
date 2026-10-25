// Микширование — чистая логика без Web Audio (тестируется в Node):
// категории и таблицы громкости/приоритетов/кулдаунов, пул голосов (лимит, кулдаун, кража),
// «ведро токенов» для ударов, отбор ударов кадра, громкость/панорама по положению относительно камеры.

/**
 * Категория голоса: свой лимит, громкость, приоритет кражи, кулдаун по умолчанию.
 * 'jingle' — расширение таблицы 05-audio §6.1: джинглы победы/поражения (шина музыки) в отдельной категории
 * на 1 голос, чтобы колокольчики наград не отнимали у них место.
 */
export type Cat = 'impact' | 'break' | 'birdVox' | 'pigVox' | 'explosion' | 'sling' | 'ability' | 'ui' | 'reward' | 'loop' | 'jingle';

/** Общий лимит одновременных голосов (десктоп / мобильные), 05-audio §6.1, 00-summary §1.14. */
export const MAX_VOICES = 32;
export const MAX_VOICES_MOBILE = 20;

/** Лимит голосов по категориям (десктоп), 05-audio §6.1. Сумма > MAX_VOICES: в шторме решает общий лимит и кража. */
export const CAT_LIMIT: Readonly<Record<Cat, number>> = {
  impact: 8,
  break: 6,
  birdVox: 2,
  pigVox: 3,
  explosion: 4,
  sling: 2,
  ability: 3,
  ui: 4,
  reward: 6,
  loop: 3,
  jingle: 1,
};

/** Мобильные лимиты: ×0.6 с округлением вверх — ровно колонка «моб.» таблицы 05-audio §6.1. */
export function mobileLimits(l: Readonly<Record<Cat, number>> = CAT_LIMIT): Record<Cat, number> {
  const out = {} as Record<Cat, number>;
  for (const k of Object.keys(l) as Cat[]) out[k] = Math.ceil(l[k] * 0.6);
  return out;
}

export interface CatMix {
  /** Множитель громкости голоса (до шины). */
  gain: number;
  /** Приоритет при краже: score = громкость × prio. */
  prio: number;
  /** Кулдаун одного ключа по умолчанию, мс. */
  cooldown: number;
}

export const CAT_MIX: Readonly<Record<Cat, CatMix>> = {
  impact: { gain: 0.9, prio: 1, cooldown: 30 },
  break: { gain: 1.0, prio: 1.5, cooldown: 40 },
  birdVox: { gain: 1.0, prio: 3, cooldown: 150 },
  pigVox: { gain: 0.9, prio: 2, cooldown: 150 },
  explosion: { gain: 1.0, prio: 5, cooldown: 0 },
  sling: { gain: 0.9, prio: 4, cooldown: 50 },
  ability: { gain: 1.0, prio: 4, cooldown: 100 },
  ui: { gain: 1.0, prio: 10, cooldown: 40 },
  reward: { gain: 1.0, prio: 10, cooldown: 0 },
  loop: { gain: 1.0, prio: 100, cooldown: 0 },
  jingle: { gain: 1.0, prio: 10, cooldown: 0 },
};

/**
 * Категории, где при равной важности новый голос вытесняет самый старый той же категории:
 * отклик кнопок и тики счёта важнее хвоста предыдущего такого же звука.
 */
export const STEAL_OLDEST_ON_TIE: ReadonlySet<Cat> = new Set<Cat>(['ui', 'reward', 'jingle']);

/** Кулдаун по префиксу ключа (до «:»), мс (05-audio §6.1, 00-summary §1.14). Нет в таблице — берётся из CAT_MIX. */
export const KEY_COOLDOWN_MS: Readonly<Record<string, number>> = {
  slingStretch: 60, slingGrab: 60, slingRelease: 60, slingCancel: 60, hop: 60,
  launch: 150, select: 150, hurt: 250, feather: 60, puff: 80,
  woodHit: 30, iceHit: 30, stoneHit: 30, ground: 50, pigBump: 60,
  woodCrack: 50, iceCrack: 50, stoneCrack: 50, woodBreak: 35, iceShatter: 35, stoneBreak: 35,
  rubble: 250, boom: 0, helmet: 100, pigHurt: 150, pigPop: 40, pigPopQuiet: 40, pigLaugh: 1500, pigGrunt: 2000,
  tick: 45, ui: 40, star: 60, bonus: 60, jingle: 4000, ab: 100, fuse: 0,
};

/** Кулдаун для ключа звука, мс. */
export function cooldownFor(key: string, cat: Cat): number {
  const k = key.split(':')[0]!;
  return KEY_COOLDOWN_MS[k] ?? CAT_MIX[cat].cooldown;
}

/** Голос в пуле. Узлы Web Audio к нему привязывает движок через колбэки. */
export interface VoiceSlot {
  readonly key: string;
  readonly cat: Cat;
  readonly score: number;
  readonly start: number;
  /** Время окончания звука (секунды того же времени, что и now). */
  end: number;
  /** Принудительная остановка (кража, фитиль при взрыве) — движок делает фейд и stop(). */
  onStop?: (now: number) => void;
  /** Естественное окончание — движок отключает узлы. */
  onEnd?: () => void;
}

export interface PoolStats {
  played: number;
  cooldown: number;
  limited: number;
  stolen: number;
}

/**
 * Пул голосов: кулдаун одного ключа, лимит категории и общий лимит.
 * Если места нет — «крадём» самый неважный голос (минимальный score), но только если новый важнее
 * (в ui/reward/jingle при равной важности — самый старый голос той же категории).
 * Время передаётся снаружи (now, секунды) — логика детерминирована и тестируется без Web Audio.
 */
export class VoicePool {
  readonly maxTotal: number;
  readonly limits: Readonly<Record<Cat, number>>;
  private active: VoiceSlot[] = [];
  private readonly lastPlay = new Map<string, number>();
  readonly stats: PoolStats = { played: 0, cooldown: 0, limited: 0, stolen: 0 };

  constructor(maxTotal = MAX_VOICES, limits: Readonly<Record<Cat, number>> = CAT_LIMIT) {
    this.maxTotal = maxTotal;
    this.limits = limits;
  }

  /** Сколько голосов звучит сейчас (всего или в категории). */
  count(now: number, cat?: Cat): number {
    this.prune(now);
    return cat ? this.active.reduce((n, v) => n + (v.cat === cat ? 1 : 0), 0) : this.active.length;
  }

  /** Активные голоса (копия списка). */
  voices(now: number): VoiceSlot[] {
    this.prune(now);
    return [...this.active];
  }

  /** Запросить голос. null — отказ (кулдаун или нет места, а новый звук не важнее звучащих). */
  acquire(key: string, cat: Cat, score: number, cooldownMs: number, now: number, end = now + 5): VoiceSlot | null {
    const last = this.lastPlay.get(key);
    if (last !== undefined && (now - last) * 1000 < cooldownMs - 1e-6) {
      this.stats.cooldown++;
      return null;
    }
    this.prune(now);
    const inCat = this.active.filter((v) => v.cat === cat);
    if (inCat.length >= this.limits[cat] && !this.stealFrom(inCat, cat, score, now)) {
      this.stats.limited++;
      return null;
    }
    if (this.active.length >= this.maxTotal && !this.stealFrom(this.active, cat, score, now)) {
      this.stats.limited++;
      return null;
    }
    const v: VoiceSlot = { key, cat, score, start: now, end };
    this.active.push(v);
    this.lastPlay.set(key, now);
    this.stats.played++;
    return v;
  }

  /** Принудительно остановить голос (освобождает место сразу). */
  release(v: VoiceSlot, now: number): void {
    const i = this.active.indexOf(v);
    if (i < 0) return;
    this.active.splice(i, 1);
    v.end = Math.min(v.end, now + 0.05);
    v.onStop?.(now);
  }

  /** Остановить всё (смена экрана, выключение звуков). */
  releaseAll(now: number): void {
    for (const v of [...this.active]) this.release(v, now);
  }

  /**
   * Вытеснить самый неважный голос (минимальный score; при равенстве — самый старый).
   * Новый голос должен быть важнее; при равной важности — только внутри своей категории из STEAL_OLDEST_ON_TIE.
   */
  private stealFrom(pool: VoiceSlot[], cat: Cat, score: number, now: number): boolean {
    let victim: VoiceSlot | null = null;
    for (const v of pool) if (!victim || v.score < victim.score || (v.score === victim.score && v.start < victim.start)) victim = v;
    if (!victim) return false;
    const tie = victim.score === score && victim.cat === cat && STEAL_OLDEST_ON_TIE.has(cat);
    if (victim.score >= score && !tie) return false;
    this.release(victim, now);
    this.stats.stolen++;
    return true;
  }

  /** Убрать закончившиеся голоса (по времени end — onended в офлайн-контексте приходит слишком поздно). */
  prune(now: number): void {
    if (!this.active.some((v) => v.end <= now)) return;
    const keep: VoiceSlot[] = [];
    for (const v of this.active) {
      if (v.end <= now) v.onEnd?.();
      else keep.push(v);
    }
    this.active = keep;
  }
}

/** «Ведро токенов» для ударов: ёмкость 6, пополнение 40/с → в среднем ≤ 40 ударов/с, всплеск ≤ 6. */
export class TokenBucket {
  private tokens: number;
  private last: number | null = null;
  private readonly cap: number;
  private readonly rate: number;
  constructor(cap = 6, ratePerS = 40) {
    this.cap = cap;
    this.rate = ratePerS;
    this.tokens = cap;
  }
  take(now: number): boolean {
    if (this.last !== null) this.tokens = Math.min(this.cap, this.tokens + Math.max(0, now - this.last) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface Spatial {
  gain: number;
  pan: number;
}

/**
 * Громкость и панорама источника по положению относительно камеры.
 * Внутри экрана громкость 1; за краем спадает квадратично и глохнет на расстоянии reach·viewW от края.
 * Панорама ±0.5 на краю экрана.
 */
export function spatial(x: number, camX: number, viewW: number, reach = 1): Spatial {
  if (!Number.isFinite(x) || !Number.isFinite(camX) || !(viewW > 0)) return { gain: 1, pan: 0 };
  const half = viewW / 2;
  const dx = x - camX;
  const over = Math.max(0, Math.abs(dx) - half) / (viewW * reach);
  const g = Math.max(0, 1 - over);
  return { gain: g * g, pan: Math.max(-1, Math.min(1, dx / half)) * 0.5 };
}

/** Интенсивность удара 0..1 из нормального импульса, Н·с (03-physics §3.6). */
export const impactIntensity = (impulse: number): number =>
  Number.isFinite(impulse) ? Math.max(0, Math.min(1, (impulse - 0.5) / 15)) : 0;
/** Громкость удара (линейная амплитуда) по интенсивности. */
export const impactVolume = (i: number): number => 0.2 + 0.8 * i;
/** Ярус тембра по интенсивности: 0 — лёгкий, 1 — средний, 2 — сильный. */
export const tierOf = (i: number): 0 | 1 | 2 => (i < 0.3 ? 0 : i < 0.7 ? 1 : 2);

export interface ImpactReq {
  key: string;
  intensity: number;
  x: number;
}

/**
 * Отбор ударов за кадр: ≤ perGroup на ключ и ≤ perFrame всего, самые сильные первыми;
 * «энергия» остальных (сумма интенсивностей) возвращается как overflow → слой обломков.
 */
export function selectImpacts<T extends ImpactReq>(reqs: ReadonlyArray<T>, perFrame = 4, perGroup = 2): { play: T[]; overflow: number } {
  const sorted = [...reqs].sort((a, b) => b.intensity - a.intensity);
  const perKey = new Map<string, number>();
  const play: T[] = [];
  let overflow = 0;
  for (const r of sorted) {
    const n = perKey.get(r.key) ?? 0;
    if (play.length < perFrame && n < perGroup) {
      play.push(r);
      perKey.set(r.key, n + 1);
    } else overflow += r.intensity;
  }
  return { play, overflow };
}
