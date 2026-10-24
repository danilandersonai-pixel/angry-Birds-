// Система эффектов в мировых координатах (04-visual.md §8, 01-gameplay.md §3.3, §6.4, §9.3).
// Источник всех реакций — события GameEvent (контракт ядра). Fx не влияет на симуляцию,
// поэтому использует Math.random и интегрирует частицы на кадровом dt.
//
// Состав:
//  • частицы — пул объектов (лимит 600 / 400 / 250 по качеству), без аллокаций в кадре; при переполнении
//    вытесняются самые старые с наименьшим приоритетом (пыль < обломки < перья < элементы взрыва);
//  • облака-«пуфы» (свинья, птица) — 9 кругов в три прохода;
//  • взрывы: вспышка ('lighter'), ударная волна-кольцо, огненные шары → дым (частицы), искры, угольки;
//  • всплывающие очки — отдельный список (popups.ts), лимит частиц на них не действует;
//  • запросы тряски камеры (takeShake) и экранная вспышка (drawFlash).
// Частицы рисуются кэшированными спрайтами (sprites.ts) — градиенты не создаются в кадре.

import type { ExplosionSource, GameEvent, ImpactSurface } from '../../core/events';
import type { BirdType, BlockShape, Material, TerrainDef } from '../../core/types';
import type { ViewInfo } from '../view';
import { buildGround, FLAT_GROUND, type GroundFn } from './ground';
import { clamp, easeOutBack, easeOutCubic, lerp, rand, randInt, randSign, TAU } from './math';
import { BIRD_FX, BIRD_PUFF, GROUND_DUST, MATERIAL_FX, PIG_PUFF } from './palette';
import { Popups } from './popups';
import {
  FX_SPRITES,
  puffSprite,
  SPR_CHUNK,
  SPR_EMBER,
  SPR_FEATHER,
  SPR_FIRE,
  SPR_GLOW_WARM,
  SPR_HELMET,
  SPR_SHARD,
  SPR_SHELL,
  SPR_SMOKE,
  SPR_SMOKE_DARK,
  SPR_SPLINTER,
  SPR_STAR,
  SPR_STREAK,
  SPR_TNT_CHIP,
  SPR_TWINKLE,
} from './sprites';

export { drawTrail } from './trail';

/** Гравитация мира для обломков, м/с² (03-physics.md: g = 15). */
const G = 15;
/** Сколько частиц с приоритетом ниже взрыва может родиться за кадр. */
const FRAME_SPAWN_CAP = 220;

export type FxQuality = 'high' | 'medium' | 'low';
const QUALITY: Record<FxQuality, { limit: number; density: number }> = {
  high: { limit: 600, density: 1 },
  medium: { limit: 400, density: 0.75 },
  low: { limit: 250, density: 0.5 },
};

// Законы анимации частиц.
const K_DEBRIS = 0; // обломок: гравитация, вращение, отскок, затухание в конце
const K_DUST = 1; // облачко пыли: рост ×1.8 за 0.6 с, α линейно → 0
const K_FEATHER = 2; // перо: парит, покачивается
const K_TWINKLE = 3; // искорка: масштаб 0 → 1 → 0, 'lighter'
const K_STREAK = 4; // искра-штрих вдоль скорости, 'lighter'
const K_FIRE = 5; // огненный шар взрыва → дым
const K_SMOKE = 6; // дым: плавное появление, рост, всплытие
const K_STAR = 7; // мультяшная звёздочка: pop-in, вращение
const K_EMBER = 8; // уголёк: светящаяся точка, 'lighter'

// Слои отрисовки (внутри draw): пыль/дым → обломки → перья → огонь → облака-пуфы → клубы поверх облаков → свечения.
const L_BACK = 0;
const L_DEBRIS = 1;
const L_FEATHER = 2;
const L_FIRE = 3;
const L_TOP = 4;
const L_GLOW = 5;
/** Слой по умолчанию для закона анимации (индекс — K_*). */
const LAYER_OF = [L_DEBRIS, L_BACK, L_FEATHER, L_GLOW, L_GLOW, L_FIRE, L_BACK, L_DEBRIS, L_GLOW];

// Приоритет вытеснения.
const P_DUST = 0;
const P_DEBRIS = 1;
const P_FEATHER = 2;
const P_BLAST = 3;

class Particle {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** Угол в мире, рад (против часовой). */
  ang = 0;
  /** Угловая скорость, рад/с. */
  w = 0;
  /** Характерный размер (длина/диаметр спрайта), м. */
  size = 0;
  /** Возраст, с; отрицательный — задержка рождения. */
  age = 0;
  life = 1;
  /** Сопротивление, 1/с: v *= exp(−drag·dt). */
  drag = 0;
  /** Ускорение вниз, м/с² (отрицательное — всплытие). */
  g = 0;
  spr = 0;
  kind = 0;
  layer = 0;
  prio = 0;
  /** Коэффициент отскока от земли; < 0 — без столкновений. */
  bounce = -1;
  hits = 0;
  rest = false;
  /** Фаза качания/мерцания. */
  phase = 0;
  /** Зеркало спрайта по локальной оси Y (±1). */
  flip = 1;
  /** Рост к концу жизни (обломки «летят в камеру»). */
  grow = 0;
  /** Базовая непрозрачность. */
  alpha = 1;
}

interface Cloud {
  x: number;
  y: number;
  r: number;
  t: number;
  life: number;
  pal: { readonly outline: string; readonly body: string; readonly hi: string };
  /** dx, dy, r — в долях радиуса облака, 9 кругов. */
  blobs: Float32Array;
}

interface Blast {
  x: number;
  y: number;
  R: number;
  t: number;
  /** Альфа экранной вспышки (0 — нет). */
  flash: number;
}

export class Fx {
  /** «Меньше вспышек» (доступность): отключает экранную вспышку. */
  reduceFlashes = false;

  private readonly pool: Particle[] = [];
  private n = 0;
  private limit = QUALITY.high.limit;
  private density = 1;
  private frameSpawned = 0;
  private time = 0;
  private readonly clouds: Cloud[] = [];
  private readonly blasts: Blast[] = [];
  private readonly popups = new Popups();
  private ground: GroundFn = FLAT_GROUND;
  private shakeAmt = 0;
  private shakeDur = 0;
  private scratch = new Float64Array(0);

  constructor() {
    for (let i = 0; i < QUALITY.high.limit; i++) this.pool.push(new Particle());
  }

  /** Живых элементов всего: частицы + облака + взрывы + всплывающие очки. */
  get count(): number {
    return this.n + this.clouds.length + this.blasts.length + this.popups.list.length;
  }

  get particleCount(): number {
    return this.n;
  }

  get popupCount(): number {
    return this.popups.list.length;
  }

  get particleLimit(): number {
    return this.limit;
  }

  /** Ступень качества: лимит частиц и плотность эмиттеров. */
  setQuality(q: FxQuality): void {
    this.limit = QUALITY[q].limit;
    this.density = QUALITY[q].density;
    while (this.n > this.limit) this.kill(this.n - 1);
  }

  /** Рельеф уровня — для отскока обломков и пыли взрыва у земли. По умолчанию земля y = 0. */
  setTerrain(terrain: readonly TerrainDef[] | null): void {
    this.ground = terrain && terrain.length ? buildGround(terrain) : FLAT_GROUND;
  }

  /** Задать функцию высоты поверхности напрямую (−∞ — нет земли). */
  setGround(fn: GroundFn): void {
    this.ground = fn;
  }

  /**
   * Заранее запечь основные спрайты под масштаб вида (пикс. устройства на метр) — вызывать при загрузке
   * уровня/смене зума, чтобы первый взрыв не тратил кадр на генерацию. Без DOM (Node) ничего не делает.
   * Возвращает время работы, мс.
   */
  prewarm(scale: number): number {
    if (typeof document === 'undefined' || !(scale > 0)) return 0;
    const t0 = performance.now();
    const S = FX_SPRITES;
    const at = (ids: readonly number[], sizes: readonly number[]) => {
      for (const id of ids) for (const m of sizes) S.get(id, m * scale);
    };
    at([...SPR_SPLINTER, ...SPR_SHARD, ...SPR_CHUNK], [0.18, 0.36]);
    at([...SPR_HELMET, ...SPR_SHELL, ...SPR_TNT_CHIP, SPR_STAR, SPR_EMBER], [0.22]);
    at(Object.values(SPR_FEATHER).flat(), [0.3]);
    at([SPR_TWINKLE], [0.3, 0.6]);
    const dusts = [MATERIAL_FX.wood.dust, MATERIAL_FX.ice.dust, MATERIAL_FX.stone.dust, GROUND_DUST, '#FFFFFF', PIG_PUFF.white, PIG_PUFF.body];
    at(dusts.map(puffSprite), [0.5, 1.0]);
    at([SPR_FIRE, SPR_SMOKE, SPR_SMOKE_DARK], [1.2, 2.4]);
    at([SPR_GLOW_WARM], [5]);
    at([SPR_STREAK], [0.6, 1.2]);
    return performance.now() - t0;
  }

  clear(): void {
    this.n = 0;
    this.clouds.length = 0;
    this.blasts.length = 0;
    this.popups.clear();
    this.shakeAmt = 0;
    this.shakeDur = 0;
  }

  /** Забрать накопленный запрос тряски (суммируется за кадр, ограничен 0.35 м). */
  takeShake(): { amount: number; duration: number } | null {
    if (this.shakeAmt <= 0) return null;
    const r = { amount: Math.min(0.35, this.shakeAmt), duration: this.shakeDur };
    this.shakeAmt = 0;
    this.shakeDur = 0;
    return r;
  }

  // ── События ─────────────────────────────────────────────────

  handle(e: GameEvent): void {
    switch (e.type) {
      case 'blockDestroyed':
        this.popups.noteBlockDestroyed(e.x, e.y, e.material, this.time);
        this.emitBlockDestroyed(e.material, e.shape, e.x, e.y, e.w, e.h, e.angle, e.vx, e.vy);
        break;
      case 'blockDamaged':
        this.emitBlockDamaged(e.material, e.x, e.y, e.stage);
        break;
      case 'impact':
        this.emitImpact(e.x, e.y, e.impulse, e.a, e.b);
        break;
      case 'birdImpact':
        this.emitFeathers(e.bird, e.x, e.y, 5 + Math.min(7, Math.floor(e.speed / 3)), 2, 5, 1);
        this.emitDust('#FFFFFF', e.x, e.y, 1, 0.5, 0, 0, 0.45); // белый «пуф» удара; пыль материала даёт impact
        break;
      case 'birdLaunched':
        this.emitFeathers(e.bird, e.x, e.y, randInt(3, 4), 1.5, 3.5, 0.85);
        break;
      case 'birdRemoved': {
        const r = BIRD_FX[e.bird].radius;
        this.addCloud(e.x, e.y, r * 1.3, 0.55, BIRD_PUFF);
        this.emitFeathers(e.bird, e.x, e.y, 4, 1.5, 3.5, 0.9);
        break;
      }
      case 'ability':
        if (e.bird !== 'bomb') {
          const r = BIRD_FX[e.bird].radius;
          this.addCloud(e.x, e.y, r * 0.9, 0.4, BIRD_PUFF);
          this.emitFeathers(e.bird, e.x, e.y, 3, 1.5, 4, e.bird === 'blues' ? 0.7 : 0.9);
        }
        break;
      case 'pigDamaged':
        this.emitPigHit(e.x, e.y, 0.5, 3 + Math.min(2, e.stage));
        if (e.helmetLost) this.emitHelmet(e.x, e.y);
        break;
      case 'pigDestroyed':
        this.popups.notePigDestroyed(e.x, e.y, e.radius, this.time);
        this.emitPigPoof(e.x, e.y, e.radius);
        break;
      case 'tntDestroyed':
        this.emitTnt(e.x, e.y);
        break;
      case 'explosion':
        this.emitExplosion(e.x, e.y, e.radius, e.source);
        break;
      case 'score':
        this.popups.addScore(e.points, e.x, e.y, e.kind, this.time);
        break;
      case 'birdBonus':
        this.popups.addBirdBonus(e.bird, e.points, e.x, e.y, this.time);
        this.emitTwinkles(e.x, e.y, 6, 0.5, 2, 4, 0.3, 0.5);
        this.emitFeathers(e.bird, e.x, e.y, 3, 1.5, 3.5, 0.9);
        break;
      default:
        break;
    }
  }

  // ── Симуляция ───────────────────────────────────────────────

  update(dt: number): void {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.frameSpawned = 0;
    const ground = this.ground;
    const pool = this.pool;
    for (let i = 0; i < this.n; ) {
      const p = pool[i];
      p.age += dt;
      if (p.age < 0) {
        i++;
        continue;
      }
      if (p.age >= p.life) {
        this.kill(i);
        continue;
      }
      if (!p.rest) {
        if (p.drag > 0) {
          const f = Math.exp(-p.drag * dt);
          p.vx *= f;
          p.vy *= f;
        }
        p.vy -= p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.ang += p.w * dt;
        if (p.kind === K_FEATHER) p.x += 2.1 * Math.sin(6 * p.age + p.phase) * dt; // качание ±0.35 м
        if (p.bounce >= 0 && p.vy < 0) {
          const rad = p.size * 0.22;
          const h = ground(p.x);
          const bottom = p.y - rad;
          if (bottom < h) {
            if (h - bottom > 0.8) {
              // влетела в склон сбоку — гасим быстро
              p.life = Math.min(p.life, p.age + 0.12);
            } else {
              p.y = h + rad;
              if (p.hits >= 1 || p.vy > -1.2 || p.kind === K_FEATHER) {
                p.rest = true;
                p.vx = p.vy = p.w = 0;
              } else {
                p.vy = -p.vy * p.bounce;
                p.vx *= 0.6;
                p.w *= 0.5;
                p.hits++;
              }
            }
          }
        }
      }
      i++;
    }
    const cl = this.clouds;
    for (let i = cl.length - 1; i >= 0; i--) {
      cl[i].t += dt;
      if (cl[i].t >= cl[i].life) cl.splice(i, 1);
    }
    const bl = this.blasts;
    for (let i = bl.length - 1; i >= 0; i--) {
      bl[i].t += dt;
      if (bl[i].t >= 0.4) bl.splice(i, 1);
    }
    this.popups.update(dt);
  }

  // ── Отрисовка ───────────────────────────────────────────────

  /** Частицы, облака, взрывы и очки — поверх тел (слой 18–19 из 04-visual.md §2). */
  draw(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    ctx.save();
    this.drawLayer(ctx, view, L_BACK);
    this.drawLayer(ctx, view, L_DEBRIS);
    this.drawLayer(ctx, view, L_FEATHER);
    if (this.blasts.length) this.drawBlasts(ctx, view);
    this.drawLayer(ctx, view, L_FIRE);
    if (this.clouds.length) this.drawClouds(ctx, view);
    this.drawLayer(ctx, view, L_TOP);
    ctx.globalCompositeOperation = 'lighter';
    this.drawLayer(ctx, view, L_GLOW);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.popups.draw(ctx, view);
    ctx.restore();
  }

  /** Экранная вспышка взрывов TNT/Bomb — поверх всего (слой 21). */
  drawFlash(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    if (this.reduceFlashes || this.blasts.length === 0) return;
    let a = 0;
    for (const b of this.blasts) {
      if (b.flash > 0 && b.t < 0.1) a = Math.max(a, b.flash * (1 - b.t / 0.1));
    }
    if (a <= 0.004) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = a;
    ctx.fillStyle = '#FFF6D8';
    ctx.fillRect(0, 0, view.screenW, view.screenH);
    ctx.restore();
  }

  private drawLayer(ctx: CanvasRenderingContext2D, view: ViewInfo, layer: number): void {
    const s = view.scale;
    const W = view.screenW;
    const H = view.screenH;
    const ox = W / 2 - view.camX * s;
    const oy = H / 2 + view.camY * s;
    const pool = this.pool;
    const sprites = FX_SPRITES;
    for (let i = 0; i < this.n; i++) {
      const p = pool[i];
      if (p.layer !== layer || p.age < 0) continue;
      const sx = p.x * s + ox;
      const sy = oy - p.y * s;
      const t = p.age;
      let sizeMul = 1;
      let alpha = p.alpha;
      let ang = p.ang;
      switch (p.kind) {
        case K_DEBRIS: {
          const left = p.life - t;
          if (left < 0.3) alpha *= left / 0.3;
          if (p.grow) sizeMul = 1 + (p.grow * t) / p.life;
          break;
        }
        case K_DUST: {
          // рост ×1.8 за 0.6 с; плотная первая треть жизни, затем линейно гаснет
          sizeMul = 0.6 + 0.48 * easeOutCubic(t < 0.6 ? t / 0.6 : 1);
          const k = t / p.life;
          alpha *= k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
          break;
        }
        case K_FEATHER: {
          const left = p.life - t;
          if (left < 0.4) alpha *= left / 0.4;
          if (!p.rest) ang += 0.6 * Math.sin(7 * t + p.phase);
          break;
        }
        case K_TWINKLE:
          sizeMul = Math.sin((Math.PI * t) / p.life);
          break;
        case K_STAR: {
          sizeMul = t < 0.14 ? Math.max(0.05, easeOutBack(t / 0.14)) : 1;
          const left = p.life - t;
          if (left < 0.25) alpha *= left / 0.25;
          break;
        }
        case K_EMBER: {
          const k = t / p.life;
          sizeMul = 1 - 0.5 * k;
          alpha *= 1 - k * k;
          break;
        }
        case K_SMOKE: {
          const k = t / p.life;
          sizeMul = 1 + 0.7 * k;
          alpha *= Math.min(1, t / 0.15) * (1 - k);
          break;
        }
        case K_STREAK: {
          alpha *= 1 - t / p.life;
          const sp = Math.hypot(p.vx, p.vy);
          const lenPx = Math.max(p.size * 2.5, sp * 0.045) * s;
          const widPx = p.size * s;
          if (lenPx < 1 || alpha <= 0.01) continue;
          const a = Math.atan2(p.vy, p.vx);
          const c = Math.cos(a);
          const sn = Math.sin(a);
          if (sx < -lenPx || sx > W + lenPx || sy < -lenPx || sy > H + lenPx) continue;
          const spr = sprites.get(p.spr, lenPx);
          const kx = lenPx / spr.P;
          const ky = widPx / (0.25 * spr.P);
          ctx.globalAlpha = alpha;
          // голова штриха — в позиции частицы, центр спрайта отстаёт на половину длины
          ctx.setTransform(c * kx, -sn * kx, sn * ky, c * ky, sx - (c * lenPx) / 2, sy + (sn * lenPx) / 2);
          ctx.drawImage(spr.canvas, spr.sx, spr.sy, spr.sw, spr.sh, -spr.hw, -spr.hh, spr.sw, spr.sh);
          continue;
        }
        case K_FIRE: {
          const grow = easeOutCubic(t < 0.2 ? t / 0.2 : 1);
          sizeMul = (0.4 + 0.8 * grow) * (1 + 0.5 * t);
          const heat = clamp(1 - (t - 0.06) / 0.25, 0, 1);
          alpha = clamp(1 - (t - 0.35) / 0.4, 0, 1);
          const px = p.size * sizeMul * s;
          if (alpha <= 0.01 || px < 1) continue;
          if (sx < -px || sx > W + px || sy < -px || sy > H + px) continue;
          // дым снизу, огонь сверху с альфой «жара»: плавный переход без градиентов в кадре
          if (heat < 0.97) this.blit(ctx, SPR_SMOKE, px, alpha, 0, 1, sx, sy);
          if (heat > 0.01) this.blit(ctx, SPR_FIRE, px, alpha * heat, 0, 1, sx, sy);
          continue;
        }
        default:
          break;
      }
      const px = p.size * sizeMul * s;
      if (px < 0.6 || alpha <= 0.01) continue;
      if (sx < -px || sx > W + px || sy < -px || sy > H + px) continue;
      this.blit(ctx, p.spr, px, alpha, ang, p.flip, sx, sy);
    }
  }

  /** Нарисовать спрайт id размером px (на единицу спрайта) с поворотом (мировой угол) в точке экрана. */
  private blit(ctx: CanvasRenderingContext2D, id: number, px: number, alpha: number, ang: number, flip: number, sx: number, sy: number): void {
    const spr = FX_SPRITES.get(id, px);
    const k = px / spr.P;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    if (ang === 0 || px < 5) {
      // без поворота: у точки в 4 px его не видно, а растр без поворота заметно дешевле
      ctx.setTransform(k, 0, 0, k * flip, sx, sy);
    } else {
      const c = Math.cos(ang) * k;
      const sn = Math.sin(ang) * k;
      ctx.setTransform(c, -sn, sn * flip, c * flip, sx, sy);
    }
    ctx.drawImage(spr.canvas, spr.sx, spr.sy, spr.sw, spr.sh, -spr.hw, -spr.hh, spr.sw, spr.sh);
  }

  private drawBlasts(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    const s = view.scale;
    for (const b of this.blasts) {
      const sx = (b.x - view.camX) * s + view.screenW / 2;
      const sy = view.screenH / 2 - (b.y - view.camY) * s;
      const Rpx = b.R * s;
      if (b.t < 0.12) {
        // вспышка: r 0.6R → 1.3R, α 1 → 0
        const k = b.t / 0.12;
        const r = Rpx * lerp(0.6, 1.3, k);
        ctx.globalCompositeOperation = 'lighter';
        this.blit(ctx, SPR_GLOW_WARM, r * 2, 1 - k, 0, 1, sx, sy);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (b.t < 0.3) {
        // ударная волна
        const k = easeOutCubic(b.t / 0.3);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.85 * (1 - k);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = Math.max(1, lerp(0.28, 0.04, k) * Rpx);
        ctx.beginPath();
        ctx.arc(sx, sy, lerp(0.2, 1.6, k) * Rpx, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawClouds(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    const s = view.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const c of this.clouds) {
      const T1 = 0.15;
      const t = c.t;
      const sc = t < T1 ? Math.max(0.01, easeOutBack(t / T1)) : 1 + (0.15 * (t - T1)) / (c.life - T1);
      const fadeAt = c.life * 0.55;
      const alpha = t < fadeAt ? 1 : clamp(1 - (t - fadeAt) / (c.life - fadeAt), 0, 1);
      if (alpha <= 0.01) continue;
      const sx = (c.x - view.camX) * s + view.screenW / 2;
      const sy = view.screenH / 2 - (c.y - view.camY) * s;
      const R = c.r * s * sc;
      if (sx < -R * 2 || sx > view.screenW + R * 2 || sy < -R * 2 || sy > view.screenH + R * 2) continue;
      const out = Math.max(0.04 * s, 1.5 * (view.dpr || 1));
      const b = c.blobs;
      ctx.globalAlpha = alpha;
      // 1) контур-подложка
      ctx.fillStyle = c.pal.outline;
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 3) {
        const bx = sx + b[i] * R;
        const by = sy - b[i + 1] * R;
        const br = b[i + 2] * R + out;
        ctx.moveTo(bx + br, by);
        ctx.arc(bx, by, br, 0, TAU);
      }
      ctx.fill();
      // 2) тело
      ctx.fillStyle = c.pal.body;
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 3) {
        const bx = sx + b[i] * R;
        const by = sy - b[i + 1] * R;
        const br = b[i + 2] * R;
        ctx.moveTo(bx + br, by);
        ctx.arc(bx, by, br, 0, TAU);
      }
      ctx.fill();
      // 3) блики сверху-слева
      ctx.fillStyle = c.pal.hi;
      ctx.beginPath();
      for (let i = 0; i < b.length; i += 3) {
        const br = b[i + 2] * R;
        const bx = sx + b[i] * R - 0.25 * br;
        const by = sy - b[i + 1] * R - 0.3 * br;
        const hr = 0.5 * br;
        ctx.moveTo(bx + hr, by);
        ctx.arc(bx, by, hr, 0, TAU);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Пул ─────────────────────────────────────────────────────

  private kill(i: number): void {
    const last = this.n - 1;
    if (i !== last) {
      const tmp = this.pool[i];
      this.pool[i] = this.pool[last];
      this.pool[last] = tmp;
    }
    this.n = last;
  }

  /** Освободить ~10% пула: самые старые частицы с приоритетом ≤ prio. false — освобождать некого. */
  private evict(prio: number): boolean {
    const n = this.n;
    if (this.scratch.length < n) this.scratch = new Float64Array(this.pool.length);
    const sc = this.scratch.subarray(0, n);
    for (let i = 0; i < n; i++) {
      const p = this.pool[i];
      // меньше — раньше вытесняем: приоритет, затем доля прожитой жизни
      sc[i] = p.prio > prio ? Infinity : p.prio * 2 + 1 - Math.max(0, p.age) / p.life;
    }
    const sorted = Float64Array.from(sc).sort();
    const want = Math.max(1, Math.floor(this.limit / 10));
    const thr = sorted[Math.min(want, n) - 1];
    if (!(thr < Infinity)) return false;
    let removed = 0;
    for (let i = n - 1; i >= 0 && removed < want; i--) {
      if (sc[i] <= thr) {
        this.kill(i);
        removed++;
      }
    }
    return removed > 0;
  }

  private spawn(kind: number, spr: number, prio: number, x: number, y: number, vx: number, vy: number, size: number, life: number): Particle | null {
    if (prio < P_BLAST && this.frameSpawned >= FRAME_SPAWN_CAP) return null;
    if (this.n >= this.limit && !this.evict(prio)) return null;
    this.frameSpawned++;
    const p = this.pool[this.n++];
    p.kind = kind;
    p.layer = LAYER_OF[kind];
    p.spr = spr;
    p.prio = prio;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.size = size;
    p.life = life;
    p.age = 0;
    p.ang = 0;
    p.w = 0;
    p.drag = 0;
    p.g = 0;
    p.bounce = -1;
    p.hits = 0;
    p.rest = false;
    p.phase = 0;
    p.flip = 1;
    p.grow = 0;
    p.alpha = 1;
    return p;
  }

  /** Количество с учётом плотности качества. */
  private cnt(n: number): number {
    return Math.max(1, Math.round(n * this.density));
  }

  // ── Эмиттеры ────────────────────────────────────────────────

  private emitBlockDestroyed(mat: Material, shape: BlockShape, x: number, y: number, w: number, h: number, angle: number, vx: number, vy: number): void {
    const area = shape === 'rect' ? w * h : shape === 'circle' ? Math.PI * (w / 2) ** 2 : (w * h) / 2;
    const thick = Math.min(w, h);
    const k = clamp(0.6 + (0.6 * thick) / 0.85, 0.65, 1.2); // мельче обломки у тонких балок
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const pt = { x: 0, y: 0, dx: 0, dy: 0 };
    const pick = () => {
      // случайная точка внутри формы (в локальных u, v ∈ [−1, 1])
      let u = 0;
      let v = 0;
      for (let tries = 0; tries < 8; tries++) {
        u = rand(-1, 1);
        v = rand(-1, 1);
        if (shape === 'circle' && u * u + v * v > 1) continue;
        if (shape === 'triangle' && u + v > 0) continue;
        if (shape === 'isoTriangle' && Math.abs(u) > (1 - v) / 2) continue;
        break;
      }
      const lx = (u * w) / 2;
      const ly = (v * h) / 2;
      pt.dx = lx * ca - ly * sa;
      pt.dy = lx * sa + ly * ca;
      pt.x = x + pt.dx;
      pt.y = y + pt.dy;
    };
    const m = MATERIAL_FX[mat];
    const inh = 0.5; // доля наследуемой скорости блока
    let count: number;
    if (mat === 'wood') count = clamp(Math.round(6 + 10 * area), 6, 16);
    else if (mat === 'ice') count = clamp(Math.round(8 + 12 * area), 8, 20);
    else count = clamp(Math.round(5 + 8 * area), 5, 12);
    count = this.cnt(count);
    for (let i = 0; i < count; i++) {
      pick();
      const dir = Math.PI / 2 + rand(-1.4, 1.4); // вверх ±80°
      let sp: number;
      let size: number;
      let life: number;
      let spin: number;
      let spr: number;
      let bounce: number;
      if (mat === 'wood') {
        sp = rand(3, 8);
        size = rand(0.24, 0.5) * k;
        life = rand(0.8, 1.3);
        spin = 12;
        spr = SPR_SPLINTER[randInt(0, SPR_SPLINTER.length - 1)];
        bounce = 0.3;
      } else if (mat === 'ice') {
        sp = rand(4, 10);
        size = rand(0.16, 0.34) * k;
        life = rand(0.6, 1.0);
        spin = 15;
        spr = SPR_SHARD[randInt(0, SPR_SHARD.length - 1)];
        bounce = 0.25;
      } else {
        sp = rand(2, 6);
        size = rand(0.16, 0.34) * k;
        life = rand(1.0, 1.6);
        spin = 8;
        spr = SPR_CHUNK[randInt(0, SPR_CHUNK.length - 1)];
        bounce = 0.2;
      }
      // разлёт от центра блока + общий выброс вверх + наследование скорости блока
      const out = rand(1, 3);
      const dl = Math.hypot(pt.dx, pt.dy) || 1;
      const p = this.spawn(
        K_DEBRIS,
        spr,
        P_DEBRIS,
        pt.x,
        pt.y,
        vx * inh + Math.cos(dir) * sp + (pt.dx / dl) * out,
        vy * inh + Math.sin(dir) * sp + (pt.dy / dl) * out,
        size,
        life,
      );
      if (!p) break;
      p.ang = rand(0, TAU);
      p.w = rand(-spin, spin);
      p.g = G;
      p.drag = 0.3;
      p.bounce = bounce;
      p.flip = randSign();
      if (Math.random() < 0.15) p.grow = 0.6; // 2.5D-штрих: летит «в камеру»
    }
    if (mat === 'ice') this.emitTwinkles(x, y, this.cnt(3), Math.max(w, h) * 0.4, 1, 3, 0.25, 0.4);
    // пыль вдоль блока
    const dustN = this.cnt(clamp(Math.round(3 + 3 * area), 3, 6));
    const dr = 0.4 * Math.max(0.5, Math.sqrt(area));
    for (let i = 0; i < dustN; i++) {
      pick();
      this.emitDust(m.dust, pt.x, pt.y, 1, dr * rand(0.75, 1.25) * 2, vx * 0.15, vy * 0.15, 0.85);
    }
  }

  private emitBlockDamaged(mat: Material, x: number, y: number, stage: number): void {
    const m = MATERIAL_FX[mat];
    for (let i = 0; i < 2; i++) this.emitDust(m.dust, x + rand(-0.25, 0.25), y + rand(-0.2, 0.2), 1, rand(0.3, 0.5), 0, 0, 0.6);
    const n = this.cnt(randInt(2, 3) + (stage >= 3 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const dir = Math.PI / 2 + rand(-1.4, 1.4);
      const sp = rand(2, 5);
      const spr =
        mat === 'wood'
          ? SPR_SPLINTER[randInt(0, SPR_SPLINTER.length - 1)]
          : mat === 'ice'
            ? SPR_SHARD[randInt(0, SPR_SHARD.length - 1)]
            : SPR_CHUNK[randInt(0, SPR_CHUNK.length - 1)];
      const size = mat === 'wood' ? rand(0.1, 0.22) : rand(0.08, 0.16);
      const p = this.spawn(K_DEBRIS, spr, P_DEBRIS, x + rand(-0.2, 0.2), y + rand(-0.15, 0.15), Math.cos(dir) * sp, Math.sin(dir) * sp, size, rand(0.55, 0.9));
      if (!p) break;
      p.ang = rand(0, TAU);
      p.w = rand(-12, 12);
      p.g = G;
      p.drag = 0.3;
      p.bounce = 0.25;
      p.flip = randSign();
    }
    if (mat === 'ice') this.emitTwinkles(x, y, 1, 0.2, 0.5, 1.5, 0.22, 0.32);
  }

  private emitImpact(x: number, y: number, J: number, a: ImpactSurface, b: ImpactSurface): void {
    if (J >= 15) this.requestShake(Math.min(0.35, J / 400), 0.3);
    if (J < 2) return;
    const surf = pickSurface(a, b);
    const r = 0.2 * Math.min(1, J / 10) + 0.15;
    const color =
      surf === 'wood' || surf === 'ice' || surf === 'stone'
        ? MATERIAL_FX[surf].dust
        : surf === 'tnt'
          ? MATERIAL_FX.wood.dust
          : surf === 'ground'
            ? GROUND_DUST
            : surf === 'egg'
              ? '#FFFDF5'
              : null;
    if (color) this.emitDust(color, x, y, 1, r * 2, 0, 0, 0.45);
    if (surf === 'stone') this.emitTwinkles(x, y, 1, 0.05, 1, 3, 0.18, 0.3);
    if (a === 'pig' || b === 'pig') this.emitPigHit(x, y, 0.15, J >= 6 ? 2 : 0, 1 + Math.floor(Math.min(3, J / 5)));
  }

  /** Перья птицы. sizeK — масштаб размера пера. */
  private emitFeathers(bird: BirdType, x: number, y: number, n: number, v0: number, v1: number, sizeK: number): void {
    const f = BIRD_FX[bird];
    const sk = sizeK * Math.sqrt(f.radius / 0.45);
    const ids = SPR_FEATHER[bird];
    n = this.cnt(n);
    for (let i = 0; i < n; i++) {
      const dir = rand(0, TAU);
      const sp = rand(v0, v1);
      const up = 1.2; // перья чуть подбрасывает
      const p = this.spawn(
        K_FEATHER,
        Math.random() < 0.75 ? ids[0] : ids[1],
        P_FEATHER,
        x + rand(-0.15, 0.15),
        y + rand(-0.15, 0.15),
        Math.cos(dir) * sp,
        Math.sin(dir) * sp + up,
        rand(0.28, 0.4) * sk,
        rand(1.4, 2.2),
      );
      if (!p) break;
      p.ang = rand(0, TAU);
      p.g = 1.2;
      p.drag = 2.5;
      p.phase = rand(0, TAU);
      p.flip = randSign();
      p.bounce = 0;
    }
  }

  /** Облачка пыли: size — диаметр, м. */
  private emitDust(color: string, x: number, y: number, n: number, size: number, vx: number, vy: number, life: number): void {
    const spr = puffSprite(color);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const out = size * 0.4 * 4; // разлёт ≈ 0.4·d за жизнь (drag 4)
      const p = this.spawn(K_DUST, spr, P_DUST, x, y, vx + Math.cos(a) * out * rand(0.3, 1), vy + Math.sin(a) * out * rand(0.3, 1), size, life * rand(0.85, 1.15));
      if (!p) return;
      p.drag = 4;
      p.g = -2.4; // всплытие ≈ 0.6 м/с
      p.alpha = 0.72;
      // облачка не вращаем: блик остаётся сверху-слева, а отрисовка без поворота в 2+ раза дешевле
    }
  }

  /** Искорки (4-лучевые, 'lighter'). size — диаметр спрайта, м. */
  private emitTwinkles(x: number, y: number, n: number, spread: number, v0: number, v1: number, s0: number, s1: number): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(v0, v1);
      const p = this.spawn(K_TWINKLE, SPR_TWINKLE, P_DEBRIS, x + rand(-spread, spread), y + rand(-spread, spread), Math.cos(a) * sp, Math.sin(a) * sp, rand(s0, s1) * 2, rand(0.3, 0.45));
      if (!p) return;
      p.g = 2;
      p.drag = 1;
      p.ang = rand(-0.3, 0.3);
      p.w = rand(-2, 2);
    }
  }

  /** Удар по свинье: мультяшные звёздочки + искорки. */
  private emitPigHit(x: number, y: number, spread: number, stars: number, twinkles = 2): void {
    stars = stars > 0 ? this.cnt(stars) : 0;
    for (let i = 0; i < stars; i++) {
      const a = Math.PI / 2 + rand(-1.2, 1.2);
      const sp = rand(2.5, 4.5);
      const p = this.spawn(K_STAR, SPR_STAR, P_FEATHER, x + rand(-spread, spread), y + rand(0, spread), Math.cos(a) * sp, Math.sin(a) * sp, rand(0.22, 0.34), rand(0.55, 0.8));
      if (!p) break;
      p.g = 7;
      p.drag = 1.5;
      p.ang = rand(-0.5, 0.5);
      p.w = rand(-6, 6);
    }
    this.emitTwinkles(x, y, twinkles, spread * 0.6, 1.5, 3.5, 0.2, 0.32);
  }

  private emitHelmet(x: number, y: number): void {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + rand(-1.3, 1.3);
      const sp = rand(3, 6);
      const p = this.spawn(K_DEBRIS, SPR_HELMET[i % SPR_HELMET.length], P_DEBRIS, x + rand(-0.2, 0.2), y + rand(0.1, 0.4), Math.cos(a) * sp, Math.sin(a) * sp, rand(0.14, 0.26), rand(0.9, 1.3));
      if (!p) break;
      p.g = G;
      p.drag = 0.3;
      p.ang = rand(0, TAU);
      p.w = rand(-12, 12);
      p.bounce = 0.35;
    }
    this.emitTwinkles(x, y + 0.3, 3, 0.2, 2, 4, 0.25, 0.4);
  }

  /** Смерть свиньи: зелёное облако с бликами + белые клубы + зелёные брызги. */
  private emitPigPoof(x: number, y: number, r: number): void {
    this.addCloud(x, y, r, 0.6, PIG_PUFF);
    const whites = this.cnt(5);
    const wspr = puffSprite(PIG_PUFF.white);
    for (let i = 0; i < whites; i++) {
      const a = (i / whites) * TAU + rand(-0.4, 0.4);
      const d = r * rand(0.55, 0.9);
      const p = this.spawn(K_DUST, wspr, P_FEATHER, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * r * 4, Math.sin(a) * r * 4 + 0.6, r * rand(0.6, 0.9), rand(0.5, 0.7));
      if (!p) break;
      p.layer = L_TOP;
      p.age = -rand(0.04, 0.1); // клубы выходят из облака чуть позже
      p.drag = 5;
      p.g = -2;
      p.alpha = 0.95;
    }
    const greens = this.cnt(6);
    const gspr = puffSprite(PIG_PUFF.body);
    for (let i = 0; i < greens; i++) {
      const a = rand(0, TAU);
      const sp = rand(3, 6) * Math.sqrt(r / 0.6);
      const p = this.spawn(K_DUST, gspr, P_DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp + 1, r * rand(0.3, 0.45), rand(0.45, 0.65));
      if (!p) break;
      p.layer = L_TOP;
      p.drag = 3.5;
      p.g = 3;
      p.alpha = 1;
    }
  }

  private emitTnt(x: number, y: number): void {
    const n = this.cnt(10);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(5, 11);
      const chip = i < 3;
      const p = this.spawn(
        K_DEBRIS,
        chip ? SPR_TNT_CHIP[i % SPR_TNT_CHIP.length] : SPR_SPLINTER[randInt(0, SPR_SPLINTER.length - 1)],
        P_DEBRIS,
        x + rand(-0.4, 0.4),
        y + rand(-0.4, 0.4),
        Math.cos(a) * sp,
        Math.sin(a) * sp + 2,
        chip ? rand(0.18, 0.28) : rand(0.25, 0.45),
        rand(0.9, 1.4),
      );
      if (!p) break;
      p.ang = rand(0, TAU);
      p.w = rand(-14, 14);
      p.g = G;
      p.drag = 0.4;
      p.bounce = 0.3;
      p.flip = randSign();
      if (Math.random() < 0.2) p.grow = 0.7;
    }
  }

  private emitExplosion(x: number, y: number, R: number, source: ExplosionSource): void {
    R = Math.max(0.5, R);
    this.blasts.push({ x, y, R, t: 0, flash: source === 'tnt' ? 0.35 : source === 'bomb' ? 0.25 : 0 });
    if (this.blasts.length > 8) this.blasts.shift();
    this.requestShake(Math.min(0.35, 0.12 * R), 0.35);
    // огненные шары → дым (9 штук, 04-visual.md §8.3)
    const k = 10; // drag: основное движение за ~0.2 с
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rand(0, 0.5);
      const d = R * rand(0.15, 0.55);
      const p = this.spawn(K_FIRE, SPR_FIRE, P_BLAST, x + Math.cos(a) * d * 0.4, y + Math.sin(a) * d * 0.4, Math.cos(a) * d * 0.8 * k, Math.sin(a) * d * 0.8 * k, 2 * R * rand(0.28, 0.45), 0.75);
      if (!p) break;
      p.drag = k;
      p.g = -0.9 * k; // всплытие 0.9 м/с
      p.age = -rand(0, 0.05);
    }
    // искры-штрихи
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const sp = R * rand(4, 7);
      const p = this.spawn(K_STREAK, SPR_STREAK, P_BLAST, x + Math.cos(a) * R * 0.15, y + Math.sin(a) * R * 0.15, Math.cos(a) * sp, Math.sin(a) * sp, 0.06 * R, rand(0.28, 0.45));
      if (!p) break;
      p.drag = 2.5;
      p.g = 6;
    }
    // угольки
    const em = this.cnt(8);
    for (let i = 0; i < em; i++) {
      const a = Math.PI / 2 + rand(-1.5, 1.5);
      const sp = rand(3, 8) * Math.sqrt(R / 3);
      const p = this.spawn(K_EMBER, SPR_EMBER, P_BLAST, x + rand(-0.3, 0.3) * R, y + rand(-0.2, 0.3) * R, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.2, 0.36), rand(0.5, 0.9));
      if (!p) break;
      p.drag = 1.2;
      p.g = 9;
    }
    // остаточный дым
    const sm = this.cnt(5);
    for (let i = 0; i < sm; i++) {
      const a = rand(0, TAU);
      const d = R * rand(0, 0.4);
      const p = this.spawn(K_SMOKE, SPR_SMOKE_DARK, P_DUST, x + Math.cos(a) * d, y + Math.sin(a) * d + 0.2 * R, Math.cos(a) * 0.5, 0.4, R * rand(0.5, 0.8), rand(0.9, 1.4));
      if (!p) break;
      p.drag = 1.5;
      p.g = -1.8; // всплытие ≈ 1.2 м/с
      p.alpha = 0.55;
      p.age = -rand(0.15, 0.28);
    }
    // скорлупа яйца Матильды
    if (source === 'egg') {
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + rand(-1.4, 1.4);
        const sp = rand(4, 8);
        const p = this.spawn(K_DEBRIS, SPR_SHELL[i % SPR_SHELL.length], P_DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.12, 0.22), rand(0.8, 1.2));
        if (!p) break;
        p.g = G;
        p.drag = 0.3;
        p.ang = rand(0, TAU);
        p.w = rand(-14, 14);
        p.bounce = 0.25;
      }
    }
    // пыль по земле, если взрыв у поверхности
    const h = this.ground(x);
    if (h > -Infinity && Math.abs(y - h) < R) {
      const n = this.cnt(6);
      const spr = puffSprite(GROUND_DUST);
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const px = x + side * R * rand(0.1, 0.8);
        const gh = this.ground(px);
        const p = this.spawn(K_DUST, spr, P_DUST, px, (gh > -Infinity ? gh : h) + 0.25, side * rand(6, 14), rand(0.5, 2), R * rand(0.35, 0.55), rand(0.8, 1.1));
        if (!p) break;
        p.drag = 3.5;
        p.g = -1.5;
        p.alpha = 0.6;
      }
    }
  }

  private addCloud(x: number, y: number, r: number, life: number, pal: Cloud['pal']): void {
    const blobs = new Float32Array(27);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + rand(0, 0.4);
      const d = rand(0.45, 0.75);
      blobs[i * 3] = Math.cos(a) * d;
      blobs[i * 3 + 1] = Math.sin(a) * d;
      blobs[i * 3 + 2] = rand(0.42, 0.62);
    }
    blobs[24] = 0;
    blobs[25] = 0;
    blobs[26] = 0.75;
    this.clouds.push({ x, y, r, t: 0, life, pal, blobs });
    if (this.clouds.length > 32) this.clouds.shift();
  }

  private requestShake(amount: number, duration: number): void {
    this.shakeAmt += amount;
    if (duration > this.shakeDur) this.shakeDur = duration;
  }
}

/** Какую поверхность показывать пылью: материал важнее птицы/свиньи. */
function pickSurface(a: ImpactSurface, b: ImpactSurface): ImpactSurface {
  const rank = (s: ImpactSurface) => (s === 'wood' || s === 'ice' || s === 'stone' ? 5 : s === 'tnt' ? 4 : s === 'egg' ? 3 : s === 'ground' ? 2 : s === 'pig' ? 1 : 0);
  return rank(a) >= rank(b) ? a : b;
}
