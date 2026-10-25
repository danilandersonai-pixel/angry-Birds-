// Кэш процедурных спрайтов (04 §10.2, спецификация §8): ключ = «тип:параметры:стадия:вариант» + ступень ppu.
// ppu округляется ВВЕРХ до ступени √2 (2 ступени на октаву): спрайт всегда не мельче нужного, при отрисовке
// масштаб 0.71…1. LRU по байтам пикселей (≈ 64 МБ). Генерация в кадре ограничена бюджетом (≈ 4 мс): если он
// исчерпан, рисуется ближайшая готовая ступень того же спрайта, а нужная достраивается в следующих кадрах.
// Здесь же — каталог ключей персонажей, блоков и реквизита (общий для рендера и прогрева на экране загрузки).

import { BIRDS, PIGS } from '../config/constants';
import type { BirdPose, EntityView, PigPose } from '../core/api';
import type { BirdType, BlockShape, LevelDef, Material, PigType, ThemeId } from '../core/types';
import { renderDecor, type DecorKind } from './decor';
import type { Sprite } from './sprites/api';
import { renderBird } from './sprites/birds';
import { renderBlock, renderEgg, renderTnt } from './sprites/blocks';
import { renderPig } from './sprites/pigs';
import { renderSlingshot } from './sprites/slingshot';

/** Ступеней ppu на октаву: 2 → шаг √2. */
export const PPU_STEPS = 2;

/** ppu, округлённый вверх до ступени 2^(1/steps). */
export function ppuBucket(ppu: number, steps = PPU_STEPS): number {
  if (!(ppu > 0) || !Number.isFinite(ppu)) return 1;
  return 2 ** (Math.ceil(steps * Math.log2(ppu) - 1e-9) / steps);
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Entry {
  readonly base: string;
  readonly bucket: number;
  readonly sprite: Sprite;
  readonly bytes: number;
}

export interface SpriteCacheOptions {
  /** Лимит памяти пикселей, байт (по умолчанию 64 МБ). */
  budgetBytes?: number;
  /** Бюджет генерации за кадр, мс (по умолчанию 4). */
  frameBudgetMs?: number;
}

export interface SpriteCacheStats {
  hits: number;
  generated: number;
  /** Сколько раз вместо нужной ступени отдана соседняя (бюджет кадра исчерпан). */
  substituted: number;
  evicted: number;
  bytes: number;
  entries: number;
  genMs: number;
}

/** Задание прогрева: ключ, требуемый ppu и генератор (получает ppu ступени). */
export interface WarmItem {
  readonly base: string;
  readonly ppu: number;
  readonly make: (ppu: number) => Sprite;
}

export class SpriteCache {
  private readonly map = new Map<string, Entry>(); // порядок Map = LRU (старые — первыми)
  private readonly byBase = new Map<string, Set<number>>();
  private bytes = 0;
  private frameSpent = 0;
  budgetBytes: number;
  frameBudgetMs: number;
  readonly stats: SpriteCacheStats = { hits: 0, generated: 0, substituted: 0, evicted: 0, bytes: 0, entries: 0, genMs: 0 };

  constructor(opts: SpriteCacheOptions = {}) {
    this.budgetBytes = opts.budgetBytes ?? 64 * 2 ** 20;
    this.frameBudgetMs = opts.frameBudgetMs ?? 4;
  }

  /** Начало кадра: бюджет генерации заново. */
  beginFrame(): void {
    this.frameSpent = 0;
  }

  /** Остаток бюджета генерации в этом кадре, мс. */
  get frameBudgetLeft(): number {
    return Math.max(0, this.frameBudgetMs - this.frameSpent);
  }

  get size(): number {
    return this.map.size;
  }

  get usedBytes(): number {
    return this.bytes;
  }

  /**
   * Спрайт для ключа base при требуемом ppu.
   * mode 'must' — если готовых ступеней нет вовсе, сгенерировать даже сверх бюджета кадра;
   * 'try' — вернуть null, если нужной ступени нет и бюджет исчерпан (и других ступеней нет).
   */
  get(base: string, ppu: number, make: (ppu: number) => Sprite, mode: 'must' | 'try' = 'must'): Sprite | null {
    const bucket = ppuBucket(ppu);
    const key = `${base}@${bucket}`;
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
      this.stats.hits++;
      return hit.sprite;
    }
    if (this.frameSpent < this.frameBudgetMs) return this.generate(base, bucket, make);
    const alt = this.nearest(base, bucket);
    if (alt) {
      this.stats.substituted++;
      return alt;
    }
    return mode === 'must' ? this.generate(base, bucket, make) : null;
  }

  /** Готовый спрайт (нужная ступень или ближайшая), без генерации. */
  peek(base: string, ppu: number): Sprite | null {
    const bucket = ppuBucket(ppu);
    const hit = this.map.get(`${base}@${bucket}`);
    return hit ? hit.sprite : this.nearest(base, bucket);
  }

  /** Есть ли ровно нужная ступень. */
  has(base: string, ppu: number): boolean {
    return this.map.has(`${base}@${ppuBucket(ppu)}`);
  }

  clear(): void {
    this.map.clear();
    this.byBase.clear();
    this.bytes = 0;
    this.syncStats();
  }

  /**
   * Прогреть набор спрайтов кусками по sliceMs; между кусками — await yieldFn() (кадр анимации загрузки).
   * onProgress(0..1). Возвращает время работы, мс.
   */
  async prewarm(items: readonly WarmItem[], opts: { sliceMs?: number; yieldFn?: () => Promise<void>; onProgress?: (p: number) => void } = {}): Promise<number> {
    const t0 = now();
    const slice = opts.sliceMs ?? 12;
    let ts = now();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const bucket = ppuBucket(it.ppu);
      if (!this.map.has(`${it.base}@${bucket}`)) this.generate(it.base, bucket, it.make, false);
      if (opts.yieldFn && now() - ts > slice) {
        opts.onProgress?.((i + 1) / items.length);
        await opts.yieldFn();
        ts = now();
      }
    }
    opts.onProgress?.(1);
    return now() - t0;
  }

  /** Прогреть синхронно (под закрытой шторкой). */
  prewarmSync(items: readonly WarmItem[]): number {
    const t0 = now();
    for (const it of items) {
      const bucket = ppuBucket(it.ppu);
      if (!this.map.has(`${it.base}@${bucket}`)) this.generate(it.base, bucket, it.make, false);
    }
    return now() - t0;
  }

  private generate(base: string, bucket: number, make: (ppu: number) => Sprite, countFrame = true): Sprite {
    const t0 = now();
    const sprite = make(bucket);
    const dt = now() - t0;
    if (countFrame) this.frameSpent += dt;
    this.stats.genMs += dt;
    this.stats.generated++;
    const bytes = Math.max(1, sprite.canvas.width * sprite.canvas.height * 4);
    const key = `${base}@${bucket}`;
    const old = this.map.get(key);
    if (old) this.drop(key, old);
    this.map.set(key, { base, bucket, sprite, bytes });
    let set = this.byBase.get(base);
    if (!set) this.byBase.set(base, (set = new Set()));
    set.add(bucket);
    this.bytes += bytes;
    this.evict(key);
    this.syncStats();
    return sprite;
  }

  /** Ближайшая готовая ступень: сначала крупнее нужной (чётче), затем мельче. */
  private nearest(base: string, bucket: number): Sprite | null {
    const set = this.byBase.get(base);
    if (!set || set.size === 0) return null;
    let best = -1;
    let bestD = Infinity;
    for (const b of set) {
      const d = b >= bucket ? b / bucket : (bucket / b) * 1.5; // мельче — штраф (мыло)
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    const key = `${base}@${best}`;
    const e = this.map.get(key);
    if (!e) return null;
    this.map.delete(key);
    this.map.set(key, e);
    return e.sprite;
  }

  private evict(keep: string): void {
    if (this.bytes <= this.budgetBytes) return;
    for (const [k, e] of this.map) {
      if (this.bytes <= this.budgetBytes) break;
      if (k === keep) continue;
      this.drop(k, e);
      this.stats.evicted++;
    }
  }

  private drop(key: string, e: Entry): void {
    this.map.delete(key);
    this.bytes -= e.bytes;
    const set = this.byBase.get(e.base);
    if (set) {
      set.delete(e.bucket);
      if (set.size === 0) this.byBase.delete(e.base);
    }
  }

  private syncStats(): void {
    this.stats.bytes = this.bytes;
    this.stats.entries = this.map.size;
  }
}

// ───────────────────────── каталог спрайтов ─────────────────────────
// Ключи и генераторы — одни и те же для кадра (Renderer) и прогрева (экран загрузки уровня).

export const birdRadius = (t: BirdType): number => BIRDS[t].radius;
export const pigRadius = (t: PigType): number => PIGS[t].radius;

/** Вариант узора блока по seed сущности (4 варианта — меньше уникальных спрайтов). */
export const blockVariant = (seed: number): number => Math.floor((Number.isFinite(seed) ? seed : 0) * 4) & 3;

export function birdKey(t: BirdType, pose: BirdPose): string {
  return `bird:${t}:${pose}`;
}
export function birdMake(t: BirdType, pose: BirdPose): (ppu: number) => Sprite {
  return (ppu) => renderBird(t, pose, birdRadius(t), ppu);
}

export function pigKey(t: PigType, pose: PigPose, stage: number, helmet: boolean): string {
  return `pig:${t}:${pose}:${stage}:${helmet && t === 'helmet' ? 1 : 0}`;
}
export function pigMake(t: PigType, pose: PigPose, stage: number, helmet: boolean, radius = pigRadius(t)): (ppu: number) => Sprite {
  return (ppu) => renderPig(t, pose, stage, helmet, radius, ppu);
}

export function blockKey(m: Material, s: BlockShape, w: number, h: number, stage: number, variant: number): string {
  return `blk:${m}:${s}:${w.toFixed(3)}x${h.toFixed(3)}:${stage}:${variant}`;
}
export function blockMake(m: Material, s: BlockShape, w: number, h: number, stage: number, variant: number): (ppu: number) => Sprite {
  return (ppu) => renderBlock(m, s, w, h, stage, variant, ppu);
}

export function tntKey(size: number): string {
  return `tnt:${size.toFixed(3)}`;
}
export function tntMake(size: number): (ppu: number) => Sprite {
  return (ppu) => renderTnt(size, ppu);
}

export function eggKey(r: number): string {
  return `egg:${r.toFixed(3)}`;
}
export function eggMake(r: number): (ppu: number) => Sprite {
  return (ppu) => renderEgg(r, ppu);
}

/** Рогатка: back и front генерируются вместе — второй кэшируется попутно. */
const slingPending = new Map<number, Sprite>();
export const SLING_BACK = 'sling:back';
export const SLING_FRONT = 'sling:front';
export function slingMake(part: 'back' | 'front'): (ppu: number) => Sprite {
  return (ppu) => {
    const key = part === 'back' ? -ppu : ppu;
    const ready = slingPending.get(key);
    if (ready) {
      slingPending.delete(key);
      return ready;
    }
    const r = renderSlingshot(ppu);
    slingPending.set(part === 'back' ? ppu : -ppu, part === 'back' ? r.front : r.back);
    return part === 'back' ? r.back : r.front;
  };
}

export function decorKey(kind: DecorKind, theme: ThemeId, variant: number): string {
  return `dec:${kind}:${theme}:${variant}`;
}
export function decorMake(kind: DecorKind, theme: ThemeId, variant: number): (ppu: number) => Sprite {
  return (ppu) => renderDecor(kind, theme, variant, ppu);
}

const BIRD_POSES: readonly BirdPose[] = ['idle', 'blink', 'aim', 'fly', 'hurt'];
const PIG_POSES: readonly PigPose[] = ['idle', 'blink', 'laugh', 'scared'];

/**
 * Набор спрайтов уровня для прогрева при масштабах scales (пикс. устройства на метр): персонажи во всех позах
 * (стадия 0), блоки стадии 0 с вариантами узора сущностей (если есть entities), TNT, яйцо, рогатка, декор.
 */
export function levelWarmList(level: LevelDef, scales: readonly number[], entities?: Iterable<EntityView>): WarmItem[] {
  const out: WarmItem[] = [];
  const seen = new Set<string>();
  const buckets = [...new Set(scales.filter((s) => s > 0).map((s) => ppuBucket(s)))];
  const add = (base: string, make: (ppu: number) => Sprite): void => {
    for (const b of buckets) {
      const k = `${base}@${b}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ base, ppu: b, make });
    }
  };
  add(SLING_BACK, slingMake('back'));
  add(SLING_FRONT, slingMake('front'));
  for (const t of new Set(level.birds)) for (const p of BIRD_POSES) add(birdKey(t, p), birdMake(t, p));
  if (level.birds.includes('matilda')) add(eggKey(0.225), eggMake(0.225));
  for (const t of new Set(level.pigs.map((p) => p.type))) for (const p of PIG_POSES) add(pigKey(t, p, 0, true), pigMake(t, p, 0, true));
  const list = entities ? [...entities] : null;
  if (list) {
    for (const e of list) {
      if (e.kind === 'block' && e.material) {
        const v = blockVariant(e.seed);
        add(blockKey(e.material, e.shape, e.w, e.h, 0, v), blockMake(e.material, e.shape, e.w, e.h, 0, v));
      } else if (e.kind === 'tnt') add(tntKey(e.w), tntMake(e.w));
    }
  } else {
    for (const b of level.blocks) {
      const h = b.shape === 'circle' ? b.w : b.h;
      add(blockKey(b.material, b.shape, b.w, h, 0, 0), blockMake(b.material, b.shape, b.w, h, 0, 0));
    }
    for (const t of level.tnt ?? []) add(tntKey(t.size ?? 1), tntMake(t.size ?? 1));
  }
  for (const d of level.decor ?? []) {
    const v = decorVariant(d.x);
    add(decorKey(d.kind, level.theme, v), decorMake(d.kind, level.theme, v));
  }
  return out;
}

/** Вариант декора по координате (детерминированно, 3 варианта). */
export function decorVariant(x: number): number {
  return Math.abs(Math.round(x * 7.31)) % 3;
}
