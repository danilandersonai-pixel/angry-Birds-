// Страница предпросмотра блоков, TNT, яйца, осколков и рогатки.
// Спрайты рисуются через drawImage так же, как это будет делать рендер (с учётом ox/oy/ppu).
// Параметры URL: ?detail=1 — крупный план (рогатка и блоки на большом ppu);
//                ?outline=1 — показать точные физические контуры форм пунктиром.

import '@fontsource/lilita-one';
import '@fontsource/luckiest-guy';
import type { BlockShape, Material } from '../core/types';
import type { Sprite } from '../render/sprites/api';
import { SLINGSHOT } from '../config/constants';
import { renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';
import { renderBlock, renderDebris, renderEgg, renderTnt } from '../render/sprites/blocks';
import { drawBand, drawPouch, renderSlingshot } from '../render/sprites/slingshot';

const params = new URLSearchParams(location.search);
const detail = params.get('detail') === '1';
const showOutline = params.get('outline') === '1';

const W = Math.max(1200, window.innerWidth);
const H = Math.max(700, window.innerHeight);
const dpr = window.devicePixelRatio || 1;
const FONT = '"Lilita One", "Arial Rounded MT Bold", sans-serif';
const MATS: Material[] = ['wood', 'ice', 'stone'];
const MAT_RU: Record<Material, string> = { wood: 'дерево', ice: 'лёд', stone: 'камень' };

let spriteCount = 0;
let genMs = 0;
const clipped: string[] = [];
let probe: CanvasRenderingContext2D | null = null;

/** Проверка: не обрезан ли рисунок краем холста. */
function checkClip(name: string, s: Sprite): void {
  const src = s.canvas;
  if (!probe) probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const ctx = probe;
  if (!ctx) return;
  ctx.canvas.width = src.width;
  ctx.canvas.height = src.height;
  ctx.clearRect(0, 0, src.width, src.height);
  ctx.drawImage(src, 0, 0);
  const rows = [ctx.getImageData(0, 0, src.width, 1).data, ctx.getImageData(0, src.height - 1, src.width, 1).data];
  const cols = [ctx.getImageData(0, 0, 1, src.height).data, ctx.getImageData(src.width - 1, 0, 1, src.height).data];
  for (const d of [...rows, ...cols]) {
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] > 8) {
        clipped.push(name);
        console.warn(`[clip] спрайт обрезан краем холста: ${name}`);
        return;
      }
    }
  }
}

function timed<T>(f: () => T): T {
  const t0 = performance.now();
  const r = f();
  genMs += performance.now() - t0;
  spriteCount++;
  return r;
}

/** Нарисовать спрайт: центр в (sx, sy) CSS px, поворот мира angle (CCW), масштаб scale CSS px/м. */
function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, sx: number, sy: number, angle: number, scale: number): void {
  const k = scale / s.ppu;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-angle);
  ctx.scale(k, k);
  ctx.drawImage(s.canvas, -s.ox, -s.oy);
  ctx.restore();
}

function physOutline(ctx: CanvasRenderingContext2D, shape: BlockShape, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,0,90,0.95)';
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(x, y, w / 2, 0, Math.PI * 2);
  else if (shape === 'triangle') {
    ctx.moveTo(x - w / 2, y + h / 2);
    ctx.lineTo(x - w / 2, y - h / 2);
    ctx.lineTo(x + w / 2, y + h / 2);
    ctx.closePath();
  } else if (shape === 'isoTriangle') {
    ctx.moveTo(x - w / 2, y + h / 2);
    ctx.lineTo(x, y - h / 2);
    ctx.lineTo(x + w / 2, y + h / 2);
    ctx.closePath();
  } else ctx.rect(x - w / 2, y - h / 2, w, h);
  ctx.stroke();
  ctx.restore();
}

/** Блок по центру (cx, cy) CSS px при масштабе scale CSS px/м. */
function placeBlock(
  ctx: CanvasRenderingContext2D,
  mat: Material,
  shape: BlockShape,
  w: number,
  h: number,
  stage: number,
  seed: number,
  cx: number,
  cy: number,
  scale: number,
  angle = 0,
): void {
  const s = timed(() => renderBlock(mat, shape, w, h, stage, seed, scale * dpr));
  checkClip(`${mat}/${shape} ${w}x${h} st${stage} ppu${scale}`, s);
  drawSprite(ctx, s, cx, cy, angle, scale);
  if (showOutline) physOutline(ctx, shape, cx, cy, w * scale, (shape === 'circle' ? w : h) * scale);
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 14, align: CanvasTextAlign = 'center', color = '#ffffff'): void {
  ctx.save();
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20,50,80,0.85)';
  ctx.lineWidth = Math.max(3, size * 0.28);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function skyBackground(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, y, 0, y + h);
  sky.addColorStop(0, '#3C9BE6');
  sky.addColorStop(0.55, '#8CCFF4');
  sky.addColorStop(1, '#DDF3F7');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, w, h);
}

/** Простая земля сцены (кромка травы + грунт) от экранной высоты gy вниз. */
function ground(ctx: CanvasRenderingContext2D, x0: number, x1: number, gy: number, bottom: number, scale: number): void {
  const soil = ctx.createLinearGradient(0, gy, 0, bottom);
  soil.addColorStop(0, '#8E5C34');
  soil.addColorStop(1, '#4A2C16');
  ctx.fillStyle = soil;
  ctx.fillRect(x0, gy, x1 - x0, bottom - gy);
  // камушки
  let r = 7;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const px = x0 + rnd() * (x1 - x0);
    const py = gy + 0.45 * scale + rnd() * (bottom - gy - 0.45 * scale);
    const rx = (0.05 + rnd() * 0.08) * scale;
    ctx.fillStyle = '#5A391D';
    ctx.beginPath();
    ctx.ellipse(px, py, rx + 1.5, rx * 0.65 + 1.5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#B48A5C';
    ctx.beginPath();
    ctx.ellipse(px, py, rx, rx * 0.65, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // кромка травы
  const band = 0.34 * scale;
  ctx.fillStyle = '#3D8224';
  ctx.fillRect(x0, gy, x1 - x0, band + 0.1 * scale);
  const gg = ctx.createLinearGradient(0, gy, 0, gy + band);
  gg.addColorStop(0, '#7CC83E');
  gg.addColorStop(1, '#4F9B2B');
  ctx.fillStyle = gg;
  ctx.beginPath();
  ctx.moveTo(x0, gy);
  for (let x = x0; x <= x1 + 10; x += 0.22 * scale) {
    ctx.lineTo(x, gy + band + (Math.round((x - x0) / (0.22 * scale)) % 2 ? 0.09 * scale : 0));
  }
  ctx.lineTo(x1, gy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#B0E35E';
  ctx.lineWidth = 0.07 * scale;
  ctx.beginPath();
  ctx.moveTo(x0, gy + 0.06 * scale);
  ctx.lineTo(x1, gy + 0.06 * scale);
  ctx.stroke();
  ctx.strokeStyle = '#2D4515';
  ctx.lineWidth = Math.max(1.5, 0.06 * scale);
  ctx.beginPath();
  ctx.moveTo(x0, gy);
  ctx.lineTo(x1, gy);
  ctx.stroke();
  ctx.fillStyle = '#4F9B2B';
  for (let x = x0 + 3; x < x1; x += (0.09 + ((x * 13) % 11) / 100) * scale) {
    const hgt = (0.07 + ((x * 7) % 10) / 100) * scale;
    ctx.beginPath();
    ctx.moveTo(x - 0.035 * scale, gy + 2);
    ctx.lineTo(x + ((x % 5) - 2.5) * 0.01 * scale, gy - hgt);
    ctx.lineTo(x + 0.035 * scale, gy + 2);
    ctx.fill();
  }
}

/** Сцена с рогаткой и башенкой: мир в метрах, земля y = 0. */
function scene(ctx: CanvasRenderingContext2D, X: number, Y: number, Wpx: number, Hpx: number, S: number, worldX0: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(X, Y, Wpx, Hpx);
  ctx.clip();
  skyBackground(ctx, X, Y, Wpx, Hpx);
  const gy = Y + Hpx - 0.95 * S;
  const sx = (x: number) => X + (x - worldX0) * S;
  const sy = (y: number) => gy - y * S;
  const sling = timed(() => renderSlingshot(S * dpr));
  checkClip('sling back', sling.back);
  checkClip('sling front', sling.front);
  const A = SLINGSHOT.ANCHOR;
  const PB = SLINGSHOT.PRONG_BACK;
  const PF = SLINGSHOT.PRONG_FRONT;
  const H = SLINGSHOT.POUCH_HALF;
  const slings: Array<{ base: number; pull: [number, number] | null }> = [
    { base: 2.6, pull: null },
    { base: 8.6, pull: [-1.6, -1.2] },
  ];
  // 1) задние части рогаток — до рельефа
  for (const s of slings) drawSprite(ctx, sling.back, sx(s.base), sy(0), 0, S);
  // 2) земля
  ground(ctx, X, X + Wpx, gy, Y + Hpx, S);
  // 3) очередь птиц
  const red = timed(() => renderBird('red', 'idle', 0.45, S * dpr));
  const blues = timed(() => renderBird('blues', 'idle', 0.252, S * dpr));
  drawSprite(ctx, red, sx(0.9), sy(0.45), 0, S);
  drawSprite(ctx, blues, sx(-0.2), sy(0.252), 0, S);
  // 4) рогатки: задняя резинка → птица → кармашек → передняя резинка → front
  for (const s of slings) {
    const ax = s.base + A.x;
    const ay = A.y;
    const pocket = s.pull ? [ax + s.pull[0], ay + s.pull[1]] : [ax, ay];
    const dx = ax - pocket[0];
    const dy = ay - pocket[1];
    const d = Math.hypot(dx, dy);
    const t = Math.min(1, d / 2.4);
    const thick = (SLINGSHOT.BAND_REST + (SLINGSHOT.BAND_TENSE - SLINGSHOT.BAND_REST) * t) * S;
    // направление кармашек → ANCHOR; в покое — вверх (кармашек «сиденьем» под птицей)
    const ux = d > 1e-3 ? dx / d : 0;
    const uy = d > 1e-3 ? dy / d : 1;
    // экранный угол (Y вниз)
    const ang = Math.atan2(-uy, ux);
    // края кармашка: pocket ± perp(dir)·POUCH_HALF; левый перпендикуляр — к заднему рогу
    const backEdge = [pocket[0] - uy * H, pocket[1] + ux * H];
    const frontEdge = [pocket[0] + uy * H, pocket[1] - ux * H];
    drawBand(ctx, sx(s.base + PB.x), sy(PB.y), sx(backEdge[0]), sy(backEdge[1]), thick);
    const bird = timed(() => renderBird('red', s.pull ? 'aim' : 'idle', 0.45, S * dpr));
    drawSprite(ctx, bird, sx(pocket[0]), sy(pocket[1]), s.pull ? Math.atan2(dy, dx) : 0, S);
    drawPouch(ctx, sx(pocket[0]), sy(pocket[1]), ang, H * S, thick * 0.85);
    drawBand(ctx, sx(s.base + PF.x), sy(PF.y), sx(frontEdge[0]), sy(frontEdge[1]), thick);
    drawSprite(ctx, sling.front, sx(s.base), sy(0), 0, S);
  }
  // 5) башенка: блоки встык (центры bbox), свиньи, TNT, яйцо
  type B = [Material, BlockShape, number, number, number, number, number, number?];
  const blocks: B[] = [
    // материал, форма, x, y, w, h, стадия, угол
    ['wood', 'rect', 13.25, 1.0, 0.5, 2, 0],
    ['wood', 'rect', 16.75, 1.0, 0.5, 2, 1],
    ['wood', 'rect', 15.0, 2.25, 4, 0.5, 0],
    ['ice', 'rect', 13.5, 3.0, 1, 1, 0],
    ['ice', 'rect', 16.5, 3.0, 1, 1, 2],
    ['ice', 'rect', 15.0, 2.75, 0.5, 0.5, 0],
    ['stone', 'rect', 15.0, 3.75, 4, 0.5, 1],
    ['wood', 'isoTriangle', 15.0, 4.5, 2, 1, 0],
    ['wood', 'triangle', 13.5, 4.5, 1, 1, 0],
    ['stone', 'rect', 19.0, 0.25, 0.5, 0.5, 0],
    ['stone', 'rect', 19.5, 0.25, 0.5, 0.5, 2],
    ['stone', 'rect', 19.25, 0.75, 0.5, 0.5, 0],
    // длинная балка 6×0.5 и предметы на ней
    ['wood', 'rect', 23.6, 0.25, 6, 0.5, 0],
    ['stone', 'rect', 23.6, 0.75, 6, 0.5, 2],
    ['stone', 'circle', 21.4, 1.5, 1, 1, 0],
    ['wood', 'circle', 22.6, 1.5, 1, 1, 0],
    ['ice', 'circle', 23.8, 1.5, 1, 1, 1],
    ['ice', 'triangle', 25.0, 1.5, 1, 1, 0],
    ['stone', 'rect', 26.1, 1.5, 1, 1, 0],
    ['stone', 'isoTriangle', 26.1, 2.5, 1, 1, 0],
  ];
  blocks.forEach(([m, sh, x, y, w, h, st, a], i) => placeBlock(ctx, m, sh, w, h, st, i, sx(x), sy(y), S, a ?? 0));
  const pig = timed(() => renderPig('medium', 'idle', 0, false, 0.6075, S * dpr));
  drawSprite(ctx, pig, sx(15), sy(0.6075), 0, S);
  const pig2 = timed(() => renderPig('small', 'idle', 0, false, 0.405, S * dpr));
  drawSprite(ctx, pig2, sx(16.5), sy(4.0 + 0.405), 0, S);
  const tnt = timed(() => renderTnt(1, S * dpr));
  checkClip('tnt', tnt);
  drawSprite(ctx, tnt, sx(17.9), sy(0.5), 0, S);
  const egg = timed(() => renderEgg(0.32, S * dpr));
  checkClip('egg', egg);
  drawSprite(ctx, egg, sx(11.6), sy(0.32), 0, S);
  if (showOutline) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,0,90,0.95)';
    ctx.beginPath();
    ctx.arc(sx(11.6), sy(0.32), 0.32 * S, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // упавшая балка под углом
  placeBlock(ctx, 'wood', 'rect', 2, 0.5, 2, 9, sx(10.4), sy(0.62), S, 0.35);
  ctx.restore();
  label(ctx, 'Сцена: рогатка в покое и с натяжением 2 м, блоки встык, персонажи (ppu ' + S + ')', X + 12, Y + 16, 15, 'left', '#FFF6C8');
}

async function main(): Promise<void> {
  try {
    await Promise.all([document.fonts.load(`20px ${FONT}`), document.fonts.load('400 40px "Luckiest Guy"')]);
  } catch {
    // шрифт не критичен
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingQuality = 'high';
  skyBackground(ctx, 0, 0, W, H);

  if (params.get('bench') === '1') {
    bench(ctx);
  } else if (detail) {
    drawDetail(ctx);
  } else {
    drawOverview(ctx);
  }
  label(
    ctx,
    `${spriteCount} спрайтов, ${genMs.toFixed(0)} мс${clipped.length ? `, ОБРЕЗАНО: ${clipped.length}` : ''}`,
    W - 12,
    14,
    13,
    'right',
    clipped.length ? '#FF8080' : '#FFFFFF',
  );
  (window as unknown as { __preview: unknown }).__preview = { spriteCount, genMs, clipped };
}

function drawOverview(ctx: CanvasRenderingContext2D): void {
  label(ctx, 'Сердитые Птицы — блоки, TNT, рогатка (процедурные спрайты)', W / 2, 18, 22, 'center', '#FFF6C8');
  // ── A: материалы × формы × стадии, ppu 42, блоки стоят на общей линии
  const S = 42;
  const shapes: Array<[BlockShape, number, number]> = [
    ['rect', 1, 1],
    ['rect', 0.5, 2],
    ['rect', 4, 0.5],
    ['rect', 0.5, 0.5],
    ['circle', 1, 1],
    ['triangle', 1, 1],
    ['isoTriangle', 2, 1],
  ];
  const gap = 0.25;
  const groupW = (shapes.reduce((a, [, w]) => a + w, 0) + gap * (shapes.length - 1)) * S;
  const x0 = 64;
  const groupGap = 22;
  const rowH = 2 * S + 12;
  const top = 58;
  MATS.forEach((m, mi) => {
    label(ctx, `${MAT_RU[m]} (ppu ${S})`, x0 + mi * (groupW + groupGap) + groupW / 2, top - 12, 16, 'center', '#FFF6C8');
  });
  for (let st = 0; st < 4; st++) {
    const baseY = top + st * rowH + 2 * S;
    label(ctx, `ст. ${st}`, 30, baseY - S, 15);
    MATS.forEach((m, mi) => {
      let x = x0 + mi * (groupW + groupGap);
      shapes.forEach(([sh, w, h], si) => {
        const hh = sh === 'circle' ? w : h;
        placeBlock(ctx, m, sh, w, h, st, si + mi * 3, x + (w * S) / 2, baseY - (hh * S) / 2, S);
        x += (w + gap) * S;
      });
    });
  }
  // ── B: крупный ряд (ppu 110)
  const L = 110;
  const yL = top + 4 * rowH + 16;
  label(ctx, `Крупно (ppu ${L})`, 14, yL + 6, 15, 'left', '#FFF6C8');
  let xl = 20;
  const big: Array<[Material, BlockShape, number, number, number]> = [
    ['wood', 'rect', 1, 1, 0],
    ['wood', 'rect', 2, 0.5, 2],
    ['ice', 'rect', 1, 1, 0],
    ['ice', 'circle', 1, 1, 2],
    ['stone', 'rect', 1, 1, 3],
    ['stone', 'triangle', 1, 1, 1],
    ['wood', 'circle', 1, 1, 3],
  ];
  const baseL = yL + 20 + L;
  for (const [m, sh, w, h, st] of big) {
    const hh = sh === 'circle' ? w : h;
    placeBlock(ctx, m, sh, w, h, st, 3, xl + (w * L) / 2, baseL - (hh * L) / 2, L);
    xl += w * L + 18;
  }
  const tntL = timed(() => renderTnt(1, L * dpr));
  checkClip('tnt big', tntL);
  drawSprite(ctx, tntL, xl + L / 2, baseL - L / 2, 0, L);
  xl += L + 18;
  const eggL = timed(() => renderEgg(0.32, L * dpr));
  drawSprite(ctx, eggL, xl + 0.32 * L, baseL - 0.32 * L, 0, L);
  xl += 0.64 * L + 24;
  // осколки: 3 материала × 8 вариантов
  label(ctx, 'осколки', xl + 4, yL + 6, 14, 'left', '#FFF6C8');
  MATS.forEach((m, mi) => {
    for (let v = 0; v < 8; v++) {
      const size = m === 'wood' ? 30 : 22;
      const c = timed(() => renderDebris(m, size * dpr, v));
      const cx = xl + 18 + v * 34;
      const cy = yL + 34 + mi * 36;
      ctx.drawImage(c, cx - c.width / dpr / 2, cy - c.height / dpr / 2, c.width / dpr, c.height / dpr);
    }
  });
  // ── C: мелкие (ppu 22)
  const Sm = 22;
  const yS = baseL + 14;
  label(ctx, `Мелко (ppu ${Sm}): ст. 0 и 3`, 14, yS + 6, 15, 'left', '#FFF6C8');
  let xs = 20;
  const baseS = yS + 16 + 2 * Sm;
  for (const st of [0, 3]) {
    for (const m of MATS) {
      for (const [sh, w, h] of shapes) {
        const hh = sh === 'circle' ? w : h;
        placeBlock(ctx, m, sh, w, h, st, 1, xs + (w * Sm) / 2, baseS - (hh * Sm) / 2, Sm);
        xs += (w + 0.3) * Sm;
      }
      xs += 12;
    }
  }
  const tntS = timed(() => renderTnt(1, Sm * dpr));
  drawSprite(ctx, tntS, xs + Sm / 2, baseS - Sm / 2, 0, Sm);
  // ── D: сцена
  const yD = baseS + 12;
  scene(ctx, 0, yD, W, H - yD, 62, -0.8);
}

/** Замер времени генерации спрайтов по материалам на типичных ppu. */
function bench(ctx: CanvasRenderingContext2D): void {
  const lines: string[] = [];
  const shapes: Array<[BlockShape, number, number]> = [
    ['rect', 1, 1],
    ['rect', 0.5, 2],
    ['rect', 4, 0.5],
    ['circle', 1, 1],
    ['triangle', 1, 1],
  ];
  for (const ppu of [73, 146]) {
    for (const m of MATS) {
      const t0 = performance.now();
      let n = 0;
      for (let st = 0; st < 4; st++) for (const [sh, w, h] of shapes) for (let sd = 0; sd < 2; sd++) {
        renderBlock(m, sh, w, h, st, sd, ppu);
        n++;
      }
      lines.push(`${m} ppu ${ppu}: ${((performance.now() - t0) / n).toFixed(2)} мс/спрайт (${n})`);
    }
  }
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) renderSlingshot(146);
  lines.push(`рогатка ppu 146: ${((performance.now() - t0) / 10).toFixed(2)} мс`);
  const t1 = performance.now();
  for (let i = 0; i < 10; i++) renderTnt(1, 146);
  lines.push(`TNT ppu 146: ${((performance.now() - t1) / 10).toFixed(2)} мс`);
  lines.forEach((l, i) => label(ctx, l, 40, 60 + i * 26, 18, 'left'));
  console.log('[bench] ' + lines.join(' | '));
}

function drawDetail(ctx: CanvasRenderingContext2D): void {
  label(ctx, 'Крупный план: рогатка (ppu 200), блоки (ppu 150)', W / 2, 18, 22, 'center', '#FFF6C8');
  const S = 200;
  const gy = H - 40;
  const sling = timed(() => renderSlingshot(S * dpr));
  const bx = 260;
  drawSprite(ctx, sling.back, bx, gy, 0, S);
  ground(ctx, 0, 560, gy, H, S * 0.4);
  const A = SLINGSHOT.ANCHOR;
  const PB = SLINGSHOT.PRONG_BACK;
  const PF = SLINGSHOT.PRONG_FRONT;
  const Hh = SLINGSHOT.POUCH_HALF;
  const px = (x: number) => bx + x * S;
  const py = (y: number) => gy - y * S;
  const t = SLINGSHOT.BAND_REST * S;
  drawBand(ctx, px(PB.x), py(PB.y), px(A.x - Hh), py(A.y), t);
  const bird = timed(() => renderBird('red', 'idle', 0.45, S * dpr));
  drawSprite(ctx, bird, px(A.x), py(A.y), 0, S);
  drawPouch(ctx, px(A.x), py(A.y), -Math.PI / 2, Hh * S, t * 0.85);
  drawBand(ctx, px(PF.x), py(PF.y), px(A.x + Hh), py(A.y), t);
  drawSprite(ctx, sling.front, bx, gy, 0, S);
  // блоки
  const L = 150;
  const items: Array<[Material, BlockShape, number, number, number, number, number]> = [
    ['wood', 'rect', 1, 1, 0, 640, 140],
    ['wood', 'rect', 2.5, 0.5, 1, 1020, 100],
    ['ice', 'rect', 1, 1, 0, 640, 330],
    ['ice', 'rect', 2.5, 0.5, 3, 1020, 270],
    ['stone', 'rect', 1, 1, 0, 640, 520],
    ['stone', 'rect', 2.5, 0.5, 2, 1020, 440],
    ['wood', 'isoTriangle', 2, 1, 0, 1020, 610],
    ['ice', 'circle', 1, 1, 0, 1460, 140],
    ['stone', 'circle', 1, 1, 0, 1460, 330],
    ['wood', 'triangle', 1, 1, 2, 1460, 520],
    ['ice', 'triangle', 1, 1, 0, 1650, 520],
    ['wood', 'rect', 0.5, 2, 3, 1680, 230],
    ['ice', 'rect', 0.5, 2, 2, 1760, 230],
  ];
  for (const [m, sh, w, h, st, x, y] of items) placeBlock(ctx, m, sh, w, h, st, 2, x, y, L);
  const tnt = timed(() => renderTnt(1, L * dpr));
  drawSprite(ctx, tnt, 640, 720, 0, L);
  const egg = timed(() => renderEgg(0.32, L * dpr));
  drawSprite(ctx, egg, 820, 720, 0, L);
  const pig = timed(() => renderPig('medium', 'idle', 0, false, 0.6075, L * dpr));
  drawSprite(ctx, pig, 1460, 760, 0, L);
}

void main();
