// Микширование: лимит голосов, кулдауны, кража голосов, «ведро» ударов, пространственная громкость.
// Чистая логика + узлы Web Audio; тестируется с OfflineAudioContext / фейковым временем.

export type Cat = 'impact' | 'break' | 'birdVox' | 'pigVox' | 'explosion' | 'sling' | 'ability' | 'ui' | 'reward' | 'loop';

/** Лимит одновременных голосов по категориям (десктоп; мобильные — ×0.6, округлить вверх). */
export const CAT_LIMIT: Record<Cat, number> = {
  impact: 8, break: 6, birdVox: 2, pigVox: 3, explosion: 4, sling: 2, ability: 3, ui: 4, reward: 6, loop: 3,
};
/** Мобильные лимиты: ×0.6 с округлением вверх (impact 5, break 4, birdVox 2, pigVox 2, explosion 3, …). */
export const mobileLimits = (l: Record<Cat, number> = CAT_LIMIT): Record<Cat, number> =>
  Object.fromEntries(Object.entries(l).map(([k, v]) => [k, Math.ceil(v * 0.6)])) as Record<Cat, number>;
export const MAX_VOICES_DESKTOP = 32;
export const MAX_VOICES_MOBILE = 20;

export interface Voice {
  id: string;
  cat: Cat;
  /** Громкость × приоритет — по ней решаем, кого «украсть». */
  score: number;
  start: number;
  end: number;
  /** Вход голоса: рецепт подключается сюда. */
  input: GainNode;
  /** Источники рецепта (из beginCollect/endCollect) — чтобы реально остановить при краже. */
  sources: AudioScheduledSourceNode[];
  stolen: boolean;
}

export interface Spatial {
  gain: number;
  pan: number;
}

/**
 * Громкость и панорама по положению источника относительно камеры.
 * Внутри экрана — 1; за краем спадает квадратично и глохнет на расстоянии reach·viewW от края.
 */
export function spatial(x: number, camX: number, viewW: number, reach = 1): Spatial {
  const half = viewW / 2;
  const dx = x - camX;
  const over = Math.max(0, Math.abs(dx) - half) / (viewW * reach);
  const g = Math.max(0, 1 - over);
  return { gain: g * g, pan: Math.max(-1, Math.min(1, dx / half)) * 0.5 };
}

/** Интенсивность удара из нормального импульса (как в 03-physics §3.6). */
export const impactIntensity = (impulse: number): number => Math.max(0, Math.min(1, (impulse - 0.5) / 15));
/** Громкость удара (линейная амплитуда) по интенсивности. */
export const impactVolume = (i: number): number => 0.2 + 0.8 * i;

export class VoiceManager {
  private readonly ctx: BaseAudioContext;
  private readonly maxTotal: number;
  private readonly limits: Record<Cat, number>;
  private active: Voice[] = [];
  private readonly lastPlay = new Map<string, number>();

  constructor(ctx: BaseAudioContext, maxTotal: number, limits: Record<Cat, number> = CAT_LIMIT) {
    this.ctx = ctx;
    this.maxTotal = maxTotal;
    this.limits = limits;
  }

  /** Активные (ещё звучащие) голоса. */
  count(cat?: Cat): number {
    this.prune();
    return cat ? this.active.filter((v) => v.cat === cat).length : this.active.length;
  }

  /**
   * Запросить голос. null — отказ (кулдаун или нет места и новый звук тише всех).
   * dest — шина (sfx/ui); gain/pan — итог микса (громкость события × пространство).
   */
  acquire(id: string, cat: Cat, score: number, cooldownMs: number, dest: AudioNode, gain: number, pan: number): Voice | null {
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(id);
    if (last !== undefined && (now - last) * 1000 < cooldownMs) return null;
    this.prune();
    const inCat = this.active.filter((v) => v.cat === cat);
    if (inCat.length >= this.limits[cat] && !this.stealFrom(inCat, score)) return null;
    if (this.active.length >= this.maxTotal && !this.stealFrom(this.active, score)) return null;

    const input = this.ctx.createGain();
    input.gain.value = gain;
    if (pan) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      input.connect(p).connect(dest);
    } else input.connect(dest);
    const v: Voice = { id, cat, score, start: now, end: now + 5, input, sources: [], stolen: false };
    this.active.push(v);
    this.lastPlay.set(id, now);
    return v;
  }

  /** Рецепт сообщил время окончания и свои источники — освобождаем голос по времени (без onended). */
  setEnd(v: Voice, end: number, sources: AudioScheduledSourceNode[] = []): void {
    v.end = end;
    v.sources = sources;
  }

  /** Остановить голос (кража, фитиль Bomb при взрыве): фейд τ = 5 мс, через 40 мс — stop() всех источников. */
  release(v: Voice): void {
    const now = this.ctx.currentTime;
    v.input.gain.cancelScheduledValues(now);
    v.input.gain.setValueAtTime(v.input.gain.value, now);
    v.input.gain.setTargetAtTime(0, now, 0.005);
    for (const s of v.sources) {
      try {
        s.stop(now + 0.04);
      } catch {
        /* уже остановлен раньше — stop() можно звать повторно только с более ранним временем */
      }
    }
    v.end = Math.min(v.end, now + 0.05);
  }

  private stealFrom(pool: Voice[], score: number): boolean {
    let victim: Voice | null = null;
    for (const v of pool) if (!v.stolen && (!victim || v.score < victim.score)) victim = v;
    if (!victim || victim.score >= score) return false;
    victim.stolen = true;
    this.release(victim);
    this.active = this.active.filter((v) => v !== victim);
    return true;
  }

  private prune(): void {
    const now = this.ctx.currentTime;
    if (this.active.some((v) => v.end <= now)) {
      for (const v of this.active) if (v.end <= now) v.input.disconnect();
      this.active = this.active.filter((v) => v.end > now);
    }
  }
}

/** «Ведро токенов» для ударов: ёмкость 6, пополнение 40/с → в среднем ≤ 40 ударов/с, всплеск ≤ 6. */
export class TokenBucket {
  private tokens: number;
  private last = 0;
  private readonly cap: number;
  private readonly rate: number;
  constructor(cap = 6, ratePerS = 40) {
    this.cap = cap;
    this.rate = ratePerS;
    this.tokens = cap;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.cap, this.tokens + (now - this.last) * this.rate);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export interface ImpactReq {
  key: string; // материал+ярус, напр. 'wood:heavy'
  intensity: number;
  x: number;
}

/**
 * Пакетная обработка ударов за кадр: берём ≤ perGroup самых сильных в группе и ≤ perFrame всего;
 * остальная «энергия» (сумма интенсивностей) → один слой rubble, если > 1.5.
 */
export function selectImpacts(reqs: ImpactReq[], perFrame = 4, perGroup = 2): { play: ImpactReq[]; overflow: number } {
  const sorted = [...reqs].sort((a, b) => b.intensity - a.intensity);
  const perKey = new Map<string, number>();
  const play: ImpactReq[] = [];
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
