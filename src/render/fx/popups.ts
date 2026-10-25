// Всплывающие очки (01-gameplay.md §9.2–9.3, 04-visual.md §8.6).
// Рисуются в экранном пространстве с якорем в мире, шрифт 'Luckiest Guy' с обводкой и градиентом.
// Анимация: pop-in 0.4 → 1.15 (0.10 с) → 1.0 (0.08 с), подъём 1.4 м за 0.9 с (easeOutQuad),
// затухание с 0.65 с до конца жизни (~1 с). Очки никогда не вытесняются лимитом частиц.
//
// Событие score{kind:'block'} не несёт материал — берём его из blockDestroyed в той же точке
// (порядок событий любой). Бонус птицы: birdBonus даёт цвет птицы; дубль score{kind:'bonus'} гасится.
// Разрушения блоков в радиусе 1.2 м за 0.25 с складываются в одно число (против «каши»).
//
// Разнос надписей (плейтест №2, Б5): все числа всплывают по одному закону riseAt(t), поэтому младшее число,
// рождённое под старшим, догоняет его (подъём замедляется к концу) — проверка перекрытия только в момент рождения
// пропускала наложения в полёте. Теперь новое число (свиньи, блока, TNT) ставится со сдвигом (вверх, в стороны,
// немного вниз — по возрастанию «цены»), при котором его прямоугольник не пересекает ни одно видимое число на всей
// общей оставшейся жизни. Разность высот двух чисел во времени монотонна (riseAt вогнута), поэтому достаточно
// проверить её на концах общего интервала. Размер надписи в метрах берётся с учётом мин./макс. кегля последнего вида.
// Бонусы птиц разносит GameScreen (ярусы над очередью) — для них прежнее правило: подъём при наложении в момент рождения.

import type { BirdType, Material } from '../../core/types';
import type { ViewInfo } from '../view';
import { clamp, easeOutQuad, lerp, mixHex } from './math';
import {
  BIRD_FX,
  SCORE_BLOCK_PLAIN,
  SCORE_BONUS_PLAIN,
  SCORE_MATERIAL,
  SCORE_PIG,
  SCORE_TNT,
  type ScoreStyle,
} from './palette';

export type ScoreKind = 'block' | 'pig' | 'bonus' | 'tnt';

export interface Popup {
  x: number;
  y: number;
  /** Сдвиг по высоте, чтобы не налезать на соседние числа, м (обычно вверх; вниз — не больше половины надписи). */
  yOff: number;
  /** Сдвиг вбок, чтобы не налезать на соседние числа, м. */
  xOff: number;
  points: number;
  text: string;
  style: ScoreStyle;
  kind: ScoreKind;
  /** Время анимации, с. */
  t: number;
  life: number;
  /** Момент рождения по часам Fx. */
  born: number;
  /** Ждёт уточнения цвета (материал блока / птица бонуса) или подъёма над свиньёй. */
  pending: boolean;
}

interface Recent {
  x: number;
  y: number;
  time: number;
  material?: Material;
  bird?: BirdType;
  points?: number;
  radius?: number;
}

const MATCH_TIME = 0.15; // окно сопоставления событий одного удара, с
const MATCH_DIST = 0.6; // м
const MERGE_TIME = 0.25;
const MERGE_DIST = 1.2;
const FADE_START = 0.65;
const RISE = 1.4;
const RISE_TIME = 0.9;
/** Жёсткий предохранитель (лимитом частиц очки не вытесняются, но память не бесконечна). */
const HARD_CAP = 160;

/** Видимая часть жизни: до α ≈ 0.35 (дальше наложение почти не читается). */
const visibleLife = (p: Popup): number => FADE_START + 0.65 * (p.life - FADE_START);
/** Высота цифр с обводкой в долях кегля, пополам (Luckiest Guy: заглавные 0.72–0.75 em, обводка 0.18 em). */
const HALF_H_EM = 0.45;
/** Зазор между надписями в долях кегля. */
const PAD_EM = 0.08;

/**
 * Сдвиги-кандидаты (dx, dy) в долях ширины / высоты надписи, по возрастанию цены: вверх до 4 высот — 1 за высоту,
 * вниз до половины высоты — вдвое дороже, вбок до 1.5 ширины — 2 за ширину (ряд «лесенкой» дешевле высокой башни).
 */
const CANDIDATES: ReadonlyArray<readonly [number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let iy = -2; iy <= 16; iy++) {
    for (let ix = -6; ix <= 6; ix++) {
      const dy = iy * 0.25;
      const dx = ix * 0.25;
      out.push([dx, dy, (dy >= 0 ? dy : -2 * dy) + 2 * Math.abs(dx) + (ix < 0 ? 0.01 : 0)]);
    }
  }
  out.sort((a, b) => a[2] - b[2]);
  return out.map(([dx, dy]) => [dx, dy] as const);
})();

const FONT_PX = 100; // шрифт рисуем в 100-px пространстве и масштабируем — градиенты кэшируются
const FONT = `400 ${FONT_PX}px "Luckiest Guy", "Rubik", sans-serif`;

/** Масштаб «pop-in с перелётом». */
export function popScale(t: number): number {
  if (t < 0.1) return lerp(0.4, 1.15, easeOutQuad(t / 0.1));
  if (t < 0.18) return lerp(1.15, 1.0, (t - 0.1) / 0.08);
  return 1;
}

const riseAt = (t: number): number => RISE * easeOutQuad(Math.min(1, t / RISE_TIME));

export class Popups {
  readonly list: Popup[] = [];
  private readonly recentBlocks: Recent[] = [];
  private readonly recentBonus: Recent[] = [];
  private readonly recentPigs: Recent[] = [];
  private readonly gradCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();
  /** Масштаб и пределы кегля последнего вида (пикс. устройства): размер надписи в метрах зависит от них. */
  private pxPerM = 45;
  private minPx = 14;
  private maxPx = 99;

  /** Событие score. */
  addScore(points: number, x: number, y: number, kind: ScoreKind, now: number): void {
    if (points <= 0) return;
    if (kind === 'block') {
      if (this.tryMerge(points, x, y, now)) return;
      const r = this.findRecent(this.recentBlocks, x, y, now);
      const style = r?.material ? SCORE_MATERIAL[r.material] : SCORE_BLOCK_PLAIN;
      this.push(points, x, y, kind, style, now, !r);
      return;
    }
    if (kind === 'bonus') {
      // birdBonus уже показал это число цветом птицы?
      const r = this.findRecent(this.recentBonus, x, y, now, 1.2);
      if (r && r.points === points) return;
      this.push(points, x, y, kind, SCORE_BONUS_PLAIN, now, true);
      return;
    }
    if (kind === 'pig') {
      // число над свиньёй: y + r + 0.3 (04-visual.md §8.4); радиус — из pigDestroyed в той же точке
      const r = this.findRecent(this.recentPigs, x, y, now);
      this.push(points, x, r ? y + (r.radius ?? 0) + 0.3 : y, kind, SCORE_PIG, now, !r);
      return;
    }
    this.push(points, x, y, kind, SCORE_TNT, now, false);
  }

  /** Свинья погибла: запомнить радиус (и поднять уже созданное число, если score пришёл раньше). */
  notePigDestroyed(x: number, y: number, radius: number, now: number): void {
    remember(this.recentPigs, { x, y, time: now, radius });
    for (const p of this.list) {
      if (p.kind === 'pig' && p.pending && now - p.born <= MATCH_TIME && Math.hypot(p.x - x, p.y - y) <= MATCH_DIST) {
        p.y += radius + 0.3;
        p.pending = false;
        p.xOff = 0;
        p.yOff = 0;
        this.place(p);
        return;
      }
    }
  }

  /** Разрушен блок: запомнить материал (и докрасить уже созданное число, если score пришёл раньше). */
  noteBlockDestroyed(x: number, y: number, material: Material, now: number): void {
    remember(this.recentBlocks, { x, y, time: now, material });
    for (const p of this.list) {
      if (p.kind === 'block' && p.pending && now - p.born <= MATCH_TIME && Math.hypot(p.x - x, p.y - y) <= MATCH_DIST) {
        p.style = SCORE_MATERIAL[material];
        p.pending = false;
        return;
      }
    }
  }

  /** Бонус за неиспользованную птицу: число цветом птицы. */
  addBirdBonus(bird: BirdType, points: number, x: number, y: number, now: number): void {
    const f = BIRD_FX[bird];
    const style: ScoreStyle = { fill: f.score, stroke: f.scoreStroke, sizeM: SCORE_BONUS_PLAIN.sizeM };
    remember(this.recentBonus, { x, y, time: now, bird, points });
    for (const p of this.list) {
      if (p.kind === 'bonus' && p.pending && p.points === points && now - p.born <= MATCH_TIME && Math.hypot(p.x - x, p.y - y) <= 1.2) {
        p.style = style;
        p.pending = false;
        return;
      }
    }
    this.push(points, x, y, 'bonus', style, now, false);
  }

  update(dt: number): void {
    const l = this.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const p = l[i];
      p.t += dt;
      if (p.t >= p.life) l.splice(i, 1);
    }
  }

  clear(): void {
    this.list.length = 0;
    this.recentBlocks.length = 0;
    this.recentBonus.length = 0;
    this.recentPigs.length = 0;
  }

  draw(ctx: CanvasRenderingContext2D, view: ViewInfo): void {
    if (this.list.length === 0) return;
    const s = view.scale;
    const dpr = view.dpr || 1;
    const minPx = 14 * dpr;
    const maxPx = view.screenH * 0.11;
    if (s > 0) {
      this.pxPerM = s;
      this.minPx = minPx;
      this.maxPx = maxPx;
    }
    let grads = this.gradCache.get(ctx);
    if (!grads) {
      grads = new Map();
      this.gradCache.set(ctx, grads);
    }
    ctx.save();
    ctx.font = FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = FONT_PX * 0.18;
    for (const p of this.list) {
      const t = p.t;
      const alpha = t < FADE_START ? 1 : clamp(1 - (t - FADE_START) / (p.life - FADE_START), 0, 1);
      if (alpha <= 0.003) continue;
      const sx = (p.x + p.xOff - view.camX) * s + view.screenW / 2;
      const sy = view.screenH / 2 - (p.y + p.yOff + riseAt(t) - view.camY) * s;
      const px = clamp(p.style.sizeM * s, minPx, Math.max(minPx, maxPx)) * popScale(t);
      const halfW = px * 0.36 * p.text.length + px;
      if (sx < -halfW || sx > view.screenW + halfW || sy < -px * 2 || sy > view.screenH + px * 2) continue;
      const k = px / FONT_PX;
      ctx.setTransform(k, 0, 0, k, sx, sy);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillText(p.text, 0, FONT_PX * 0.07);
      ctx.strokeStyle = p.style.stroke;
      ctx.strokeText(p.text, 0, 0);
      let g = grads.get(p.style.fill);
      if (!g) {
        g = ctx.createLinearGradient(0, -FONT_PX * 0.45, 0, FONT_PX * 0.45);
        g.addColorStop(0, mixHex(p.style.fill, '#FFFFFF', 0.45));
        g.addColorStop(0.5, p.style.fill);
        g.addColorStop(1, mixHex(p.style.fill, '#000000', 0.12));
        grads.set(p.style.fill, g);
      }
      ctx.fillStyle = g;
      ctx.fillText(p.text, 0, 0);
    }
    ctx.restore();
  }

  // ── внутреннее ──────────────────────────────────────────────

  private push(points: number, x: number, y: number, kind: ScoreKind, style: ScoreStyle, now: number, pending: boolean): void {
    const text = String(Math.round(points));
    const p: Popup = {
      x,
      y,
      yOff: 0,
      xOff: 0,
      points,
      text,
      style,
      kind,
      t: 0,
      life: kind === 'bonus' ? 1.2 : kind === 'pig' ? 1.1 : 1.0,
      born: now,
      pending,
    };
    if (kind === 'bonus') this.unstack(p);
    else this.place(p);
    if (this.list.length >= HARD_CAP) this.list.shift();
    this.list.push(p);
  }

  /** Кегль надписи в метрах при последнем виде (с учётом мин./макс. размера в пикселях). */
  private sizeM(p: Popup): number {
    const s = this.pxPerM;
    return clamp(p.style.sizeM * s, this.minPx, Math.max(this.minPx, this.maxPx)) / s;
  }

  /**
   * Поставить число p (сдвиги xOff/yOff) так, чтобы оно не пересекало видимые числа (кроме бонусов) на всей общей
   * оставшейся жизни. Берётся самый «дешёвый» сдвиг без пересечений, иначе — с наименьшим пересечением.
   */
  private place(p: Popup): void {
    const S = this.sizeM(p);
    const hw = 0.5 * S * (textEm(p.text) + PAD_EM);
    const hh = S * HALF_H_EM;
    const life = visibleLife(p);
    // препятствия: размеры и начальная/конечная разность высот на общем отрезке жизни
    const obs: Array<{ x: number; hw: number; H: number; lo: number; hi: number }> = [];
    for (const q of this.list) {
      if (q === p || q.kind === 'bonus') continue;
      const T = Math.min(life - p.t, visibleLife(q) - q.t);
      if (T <= 0) continue;
      const Sq = this.sizeM(q);
      // y(p) − y(q) без сдвига-кандидата: в начале и в конце общего отрезка (монотонна по времени)
      const base = p.y + p.yOff - (q.y + q.yOff);
      const d0 = base + riseAt(p.t) - riseAt(q.t);
      const d1 = base + riseAt(p.t + T) - riseAt(q.t + T);
      obs.push({
        x: q.x + q.xOff,
        hw: 0.5 * Sq * (textEm(q.text) + PAD_EM),
        H: hh + Sq * HALF_H_EM + 0.5 * PAD_EM * (S + Sq),
        lo: Math.min(d0, d1),
        hi: Math.max(d0, d1),
      });
    }
    if (obs.length === 0) return;
    const px = p.x + p.xOff;
    let best = 0;
    let bestBad = Infinity;
    for (let c = 0; c < CANDIDATES.length; c++) {
      const dx = CANDIDATES[c][0] * 2 * hw;
      const dy = CANDIDATES[c][1] * 2 * hh;
      let bad = 0;
      for (const o of obs) {
        const ox = hw + o.hw - Math.abs(px + dx - o.x);
        if (ox <= 0) continue;
        const lo = o.lo + dy;
        const hi = o.hi + dy;
        if (hi <= -o.H || lo >= o.H) continue;
        // величина пересечения: перекрытие отрезка высот с (−H, H) плюс глубина по ширине
        bad += Math.min(hi, o.H) - Math.max(lo, -o.H) + Math.min(ox, 2 * hw) * 0.1;
      }
      if (bad === 0) {
        best = c;
        bestBad = 0;
        break;
      }
      if (bad < bestBad - 1e-9) {
        bestBad = bad;
        best = c;
      }
    }
    p.xOff += CANDIDATES[best][0] * 2 * hw;
    p.yOff += CANDIDATES[best][1] * 2 * hh;
  }

  /** Поднять новое число, пока оно перекрывает живые (бонусы птиц: прежнее правило). */
  private unstack(p: Popup): void {
    const w = boxW(p);
    const h = p.style.sizeM;
    for (let iter = 0; iter < 6; iter++) {
      let hit = false;
      const ny = p.y + p.yOff;
      for (const q of this.list) {
        const qy = q.y + q.yOff + riseAt(q.t);
        if (Math.abs(p.x - q.x) < (w + boxW(q)) * 0.42 && Math.abs(ny - qy) < (h + q.style.sizeM) * 0.45) {
          hit = true;
          break;
        }
      }
      if (!hit) return;
      p.yOff += Math.max(0.45, 0.6 * h);
    }
  }

  private tryMerge(points: number, x: number, y: number, now: number): boolean {
    for (const p of this.list) {
      if (p.kind !== 'block' || now - p.born > MERGE_TIME) continue;
      if (Math.hypot(p.x - x, p.y - y) > MERGE_DIST) continue;
      const total = p.points + points;
      p.x = (p.x * p.points + x * points) / total;
      p.y = (p.y * p.points + y * points) / total;
      p.points = total;
      p.text = String(Math.round(total));
      if (p.t > 0.1) p.t = 0.1; // короткий «толчок» масштаба при добавлении
      this.place(p); // число стало шире и сместилось — проверить соседей (сдвиг только при пересечении)
      // материал второго блока: если первый ещё не окрашен — возьмём этот
      if (p.pending) {
        const r = this.findRecent(this.recentBlocks, x, y, now);
        if (r?.material) {
          p.style = SCORE_MATERIAL[r.material];
          p.pending = false;
        }
      }
      return true;
    }
    return false;
  }

  private findRecent(list: Recent[], x: number, y: number, now: number, dist = MATCH_DIST): Recent | undefined {
    let best: Recent | undefined;
    let bd = dist;
    for (const r of list) {
      if (now - r.time > MATCH_TIME) continue;
      const d = Math.hypot(r.x - x, r.y - y);
      if (d <= bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }
}

/** Оценка ширины надписи, м (цифры Luckiest Guy ≈ 0.62 em). */
const boxW = (p: Popup): number => 0.62 * p.style.sizeM * p.text.length;

/** Ширина текста в долях кегля с обводкой (Luckiest Guy: цифры ≈ 0.61 em, «1» ≈ 0.39 em, обводка 0.18 em). */
function textEm(text: string): number {
  let w = 0.18;
  for (let i = 0; i < text.length; i++) w += text.charCodeAt(i) === 49 ? 0.4 : 0.61;
  return w;
}

function remember(list: Recent[], r: Recent): void {
  list.push(r);
  if (list.length > 32) list.shift();
}
