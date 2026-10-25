// Передний план (слой 20, 04 §5.7): пучки травы с цветами (meadow), пляжная трава (beach), сугробы с сухими
// травинками (snow) и редкие низкие кусты. Рисуется после тел и эффектов — перекрывает низ обломков ради глубины.
//
// • По Y — мировой: основание на groundRef − 0.55 м, высота пучков 0.35–0.75 м мира (×1.08), верхушки выше кромки
//   земли. При подъёме камеры передний план уходит под экран вместе с миром.
// • По X — параллакс 1.2 от масштаба мира: X = W/2 + (u − camX·1.2)·scale (едет быстрее земли при любом зуме).
// • Тон темнее кромки земли; цветы — только на верхушках пучков, без белых.
// • Покачивание от ветра гасится при prefers-reduced-motion.

import type { ThemeId } from '../../core/types';
import type { ViewInfo } from '../view';
import { TAU, lerp, prefersReducedMotion, rand } from './paint';
import { THEME_PALETTES } from './themes';

/** Период слоя, м (в координатах слоя), и параллакс по X. */
const FG_PERIOD = 18;
const FG_F = 1.2;
/** Масштаб элементов относительно мира. */
const FG_SCALE = 1.08;
/** Основание — на столько ниже опорной земли, м. */
const FG_BASE = 0.55;
/** Самый высокий элемент над основанием, м слоя (куст), — для отсечения. */
const FG_TOP = 0.95;

/**
 * Передний план. groundRef — опорная высота земли уровня (Camera.groundRef), по умолчанию 0.
 * frame — необязательная трансформация кадра (поворот от тряски, см. shakeFrame) — та же, что у рельефа и тел.
 */
export function drawForeground(ctx: CanvasRenderingContext2D, theme: ThemeId, view: ViewInfo, groundRef = 0, frame?: DOMMatrixReadOnly | null): void {
  const s = view.scale;
  if (s <= 0) return;
  const P = THEME_PALETTES[theme];
  const F = P.fg;
  const k = s * FG_SCALE;
  // экранная Y основания (мир → экран)
  const yb = view.screenH / 2 - (groundRef - FG_BASE - view.camY) * s;
  if (yb - FG_TOP * k > view.screenH || yb < -k) return;
  const periodPx = FG_PERIOD * s;
  let x0 = view.screenW / 2 - view.camX * FG_F * s;
  x0 = (((x0 % periodPx) + periodPx) % periodPx) - periodPx;
  const t = view.time;
  const still = prefersReducedMotion();
  ctx.save();
  if (frame) ctx.setTransform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f);
  else ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const pathA = new Path2D();
  const pathB = new Path2D();
  const pathC = new Path2D();
  const shadow = new Path2D();
  const bushDark = new Path2D();
  const bushBase = new Path2D();
  const bushLit = new Path2D();
  const twigs = new Path2D();
  const flowers: Array<[number, number, string]> = [];
  for (let px = x0; px < view.screenW + periodPx; px += periodPx) {
    const r = rand(8 + theme.length);
    // редкий низкий куст: один на период
    {
      const cx = px + r() * periodPx;
      const w = k * lerp(0.75, 1.05, r());
      const h = k * lerp(0.62, 0.8, r());
      const seed = r();
      if (cx > -w * 1.6 && cx < view.screenW + w * 1.6) {
        const sway = still ? 0 : Math.sin(0.9 * t + cx * 0.007) * 0.012 * k;
        const blobs: Array<[number, number, number]> = [];
        const n = 5;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1) - 0.5;
          const rr = w * lerp(0.32, 0.42, (seed * 7.3 + i * 0.37) % 1) * (1 - Math.abs(u) * 0.55);
          blobs.push([cx + u * w * 1.6 + sway * (1 + u), yb + 0.05 * k - (h - rr) * (1 - Math.abs(u) * 0.9) * 0.75, rr]);
        }
        for (const [bx, by, br] of blobs) {
          bushDark.moveTo(bx + br, by);
          bushDark.arc(bx, by, br, 0, TAU);
          bushBase.moveTo(bx - 0.06 * k + br * 0.92, by - 0.05 * k);
          bushBase.arc(bx - 0.06 * k, by - 0.05 * k, br * 0.92, 0, TAU);
          bushLit.moveTo(bx - br * 0.32 + br * 0.38, by - br * 0.36);
          bushLit.ellipse(bx - br * 0.32, by - br * 0.36, br * 0.38, br * 0.24, -0.4, 0, TAU);
        }
      }
    }
    const count = theme === 'snow' ? 6 : 9;
    for (let i = 0; i < count; i++) {
      const cx = px + ((i + r() * 0.7) / count) * periodPx;
      const kind = r();
      const flower = r();
      const fcol = F.accent.length ? F.accent[Math.floor(r() * F.accent.length)] : '';
      const nb = 6 + Math.floor(r() * 4);
      const hs: number[] = [];
      for (let j = 0; j < nb + 3; j++) hs.push(r());
      if (cx < -k * 2 || cx > view.screenW + k * 2) continue;
      const sway = still ? 0 : Math.sin(1.3 * t + cx * 0.013) * 0.05;
      if (theme === 'snow') {
        // сугроб (04 §5.7) — 2–3 неровных комка разной величины: тело в тени (a), освещённая часть левее-выше (b),
        // блик (c); низ скруглён (без плоского среза на грунте)
        const w = k * lerp(0.5, 0.85, kind);
        const by = yb + 0.06 * k;
        let h = 0;
        const nl = 2 + (hs[0] < 0.5 ? 1 : 0);
        shadow.moveTo(cx + w * 1.15 + 0.04 * k, by);
        shadow.ellipse(cx + 0.04 * k, by, w * 1.15, 0.06 * k, 0, 0, TAU);
        for (let j = 0; j < nl; j++) {
          const lx = cx + (j / Math.max(1, nl - 1) - 0.5) * w * lerp(0.9, 1.3, hs[j + 1]);
          const lw = k * lerp(0.3, 0.5, hs[j + 2]) * (j === 1 ? 1.2 : 1);
          const lh = k * lerp(0.38, 0.6, hs[j + 3]) * (j === 1 ? 1.15 : 0.85);
          h = Math.max(h, lh);
          pathA.moveTo(lx + lw, by);
          pathA.ellipse(lx, by, lw, lh, 0, Math.PI, TAU);
          pathA.ellipse(lx, by, lw, lh * 0.25, 0, 0, Math.PI);
          pathB.moveTo(lx + lw * 0.84 - 0.05 * k, by - 0.02 * k);
          pathB.ellipse(lx - 0.05 * k, by - 0.02 * k, lw * 0.84, lh * 0.9, 0, Math.PI, TAU);
          pathB.ellipse(lx - 0.05 * k, by - 0.02 * k, lw * 0.84, lh * 0.15, 0, 0, Math.PI);
          pathC.moveTo(lx - lw * 0.32 + lw * 0.26, by - lh * 0.72);
          pathC.ellipse(lx - lw * 0.32, by - lh * 0.72, lw * 0.26, lh * 0.08, -0.2, 0, TAU);
        }
        if (hs[0] < 0.6) {
          // сухие травинки из сугроба
          for (let j = 0; j < 3; j++) {
            const bx = cx + (hs[j + 1] - 0.5) * w;
            const hh = k * lerp(0.25, 0.45, hs[j + 2]);
            const lean = (hs[j + 3] - 0.5) * 0.3 * k + sway * hh * 2;
            twigs.moveTo(bx, by - h * 0.6);
            twigs.quadraticCurveTo(bx + lean * 0.3, by - h * 0.6 - hh * 0.6, bx + lean, by - h * 0.6 - hh);
          }
        }
        continue;
      }
      // мягкая тень у основания
      shadow.moveTo(cx + 0.36 * k, yb + 0.02 * k);
      shadow.ellipse(cx, yb + 0.02 * k, 0.36 * k, 0.06 * k, 0, 0, TAU);
      for (let j = 0; j < nb; j++) {
        const u = j / (nb - 1) - 0.5;
        const h = k * lerp(0.35, 0.75, hs[j]) * (1 - Math.abs(u) * 0.6);
        const lean = (u * 0.9 + (hs[j + 1] - 0.5) * 0.15) * k * 0.5 + sway * h * 1.5;
        const bx = cx + u * 0.3 * k;
        const bw = (theme === 'beach' ? 0.045 : 0.07) * k;
        const p = j % 3 === 0 ? pathA : j % 3 === 1 ? pathB : pathC;
        p.moveTo(bx - bw, yb + 0.03 * k);
        p.quadraticCurveTo(bx - bw * 0.2 + lean * 0.3, yb - h * 0.6, bx + lean, yb - h);
        p.quadraticCurveTo(bx + bw * 0.6 + lean * 0.3, yb - h * 0.5, bx + bw, yb + 0.03 * k);
        p.closePath();
      }
      if (fcol && flower < 0.3) flowers.push([cx + sway * k * 0.4, yb - 0.6 * k, fcol]);
    }
  }
  ctx.fillStyle = F.shadow;
  ctx.fill(shadow);
  // кусты (позади пучков)
  ctx.fillStyle = F.bush[0];
  ctx.fill(bushDark);
  ctx.fillStyle = F.bush[1];
  ctx.fill(bushBase);
  ctx.fillStyle = F.bush[2];
  ctx.globalAlpha = 0.55;
  ctx.fill(bushLit);
  ctx.globalAlpha = 1;
  if (theme === 'snow') {
    ctx.fillStyle = F.a;
    ctx.fill(pathA);
    ctx.fillStyle = F.b;
    ctx.fill(pathB);
    ctx.fillStyle = F.c;
    ctx.fill(pathC);
    ctx.strokeStyle = '#6E5E50';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, 0.025 * k);
    ctx.stroke(twigs);
  } else {
    ctx.fillStyle = F.a;
    ctx.fill(pathA);
    ctx.fillStyle = F.b;
    ctx.fill(pathB);
    ctx.fillStyle = F.c;
    ctx.fill(pathC);
    // цветы на верхушках: 5 лепестков r 0.045 м на расстоянии 0.07 м, светлая середина
    for (const [fx, fy, col] of flowers) {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let q = 0; q < 5; q++) {
        const a = (q / 5) * TAU;
        const x = fx + Math.cos(a) * 0.07 * k;
        const y = fy + Math.sin(a) * 0.07 * k;
        ctx.moveTo(x + 0.045 * k, y);
        ctx.arc(x, y, 0.045 * k, 0, TAU);
      }
      ctx.fill();
      ctx.fillStyle = '#FFF4C2';
      ctx.beginPath();
      ctx.arc(fx, fy, 0.035 * k, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}
