// Страница предпросмотра персонажей: все птицы × позы, свиньи × позы × повреждения,
// мелкие размеры, повороты и «линейка» в реальных пропорциях. Спрайты рисуются через drawImage
// так же, как это будет делать рендер (с учётом ox/oy/ppu).
// Параметры URL: ?circles=1 — показать физические круги на всех спрайтах;
//                ?detail=1 — крупный план (r = 120 px) для разбора деталей.

import '@fontsource/lilita-one';
import type { BirdType, PigType } from '../core/types';
import type { BirdPose, PigPose } from '../core/api';
import type { Sprite } from '../render/sprites/api';
import { CHUCK_HULL, renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';

const BIRDS: BirdType[] = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];
const BIRD_POSES: BirdPose[] = ['idle', 'blink', 'aim', 'fly', 'hurt'];
const PIGS: PigType[] = ['small', 'medium', 'large', 'helmet', 'mustache', 'king'];
const PIG_POSES: PigPose[] = ['idle', 'blink', 'laugh', 'scared'];

// Физические радиусы, м (02-characters.md §11) — только для «линейки» в реальных пропорциях.
const BIRD_R: Record<BirdType, number> = {
  red: 0.45,
  blues: 0.252,
  chuck: 0.495,
  bomb: 0.585,
  matilda: 0.54,
  hal: 0.4725,
  terence: 0.8,
  silver: 0.45,
};
const PIG_R: Record<PigType, number> = {
  small: 0.405,
  medium: 0.6075,
  large: 0.8325,
  helmet: 0.63,
  mustache: 0.72,
  king: 1.17,
};

const NAMES: Record<string, string> = {
  red: 'Red',
  blues: 'Blues',
  chuck: 'Chuck',
  bomb: 'Bomb',
  matilda: 'Matilda',
  hal: 'Hal',
  terence: 'Terence',
  silver: 'Silver',
  small: 'small',
  medium: 'medium',
  large: 'large',
  helmet: 'helmet',
  mustache: 'mustache',
  king: 'king',
};

const params = new URLSearchParams(location.search);
const showCircles = params.get('circles') === '1';
const detail = params.get('detail') === '1';

const W = Math.max(1200, window.innerWidth);
const dpr = window.devicePixelRatio || 1;
const FONT = '"Lilita One", "Arial Rounded MT Bold", sans-serif';

const clipped: string[] = [];

let probe: CanvasRenderingContext2D | null = null;

/** Проверка: не обрезан ли рисунок краем холста (непрозрачные пиксели на границе). */
function checkClip(name: string, s: Sprite): void {
  const src = s.canvas;
  const w = src.width;
  const h = src.height;
  if (!probe) {
    const pc = document.createElement('canvas');
    probe = pc.getContext('2d', { willReadFrequently: true });
  }
  const ctx = probe;
  if (!ctx) return;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0);
  const rows = [ctx.getImageData(0, 0, w, 1).data, ctx.getImageData(0, h - 1, w, 1).data];
  const cols = [ctx.getImageData(0, 0, 1, h).data, ctx.getImageData(w - 1, 0, 1, h).data];
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

/** Нарисовать спрайт так, как это делает рендер: центр в (sx, sy), поворот мира angle (CCW), масштаб scale px/м. */
function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, sx: number, sy: number, angle: number, scale: number): void {
  const k = scale / s.ppu;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-angle);
  ctx.scale(k, k);
  ctx.drawImage(s.canvas, -s.ox, -s.oy);
  ctx.restore();
}

function physCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,0,60,0.9)';
  ctx.lineDashOffset = 3.5;
  ctx.stroke();
  ctx.restore();
}

/** Физическая форма птицы: круг, у Чака — треугольник (02 §3.3). angle — поворот мира (CCW). */
function physShape(ctx: CanvasRenderingContext2D, type: BirdType, x: number, y: number, r: number, angle = 0): void {
  if (type !== 'chuck') {
    physCircle(ctx, x, y, r);
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-angle);
  ctx.setLineDash([4, 3]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  CHUCK_HULL.forEach(([hx, hy], i) => (i === 0 ? ctx.moveTo(hx * r, hy * r) : ctx.lineTo(hx * r, hy * r)));
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.stroke();
  ctx.strokeStyle = 'rgba(200,0,60,0.9)';
  ctx.lineDashOffset = 3.5;
  ctx.stroke();
  ctx.restore();
}

/** Нижняя точка физической формы в радиусах (для постановки на землю). */
function physBottom(type: BirdType): number {
  return type === 'chuck' ? Math.max(...CHUCK_HULL.map((p) => p[1])) : 1;
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

function header(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  label(ctx, text, 24, y, 24, 'left', '#FFF6C8');
}

/** Отрисовать спрайт в экранной точке (CSS px) с радиусом rCss: рендерим при ppu с учётом dpr. */
function placeBird(ctx: CanvasRenderingContext2D, type: BirdType, pose: BirdPose, x: number, y: number, rCss: number, angle = 0): Sprite {
  const radiusM = BIRD_R[type];
  const scale = rCss / radiusM; // CSS px на метр
  const s = renderBird(type, pose, radiusM, scale * dpr);
  checkClip(`bird ${type}/${pose} r=${rCss}`, s);
  drawSprite(ctx, s, x, y, angle, scale);
  if (showCircles) physShape(ctx, type, x, y, rCss, angle);
  return s;
}

function placePig(
  ctx: CanvasRenderingContext2D,
  type: PigType,
  pose: PigPose,
  stage: number,
  helmet: boolean,
  x: number,
  y: number,
  rCss: number,
): Sprite {
  const radiusM = PIG_R[type];
  const scale = rCss / radiusM;
  const s = renderPig(type, pose, stage, helmet, radiusM, scale * dpr);
  checkClip(`pig ${type}/${pose}/${stage}${helmet ? '' : '/no-helmet'} r=${rCss}`, s);
  drawSprite(ctx, s, x, y, 0, scale);
  if (showCircles) physCircle(ctx, x, y, rCss);
  return s;
}

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, grassTop: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, grassTop);
  sky.addColorStop(0, '#3FA6E6');
  sky.addColorStop(0.55, '#7CCBF2');
  sky.addColorStop(1, '#CFEFFC');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // мягкие облака
  const clouds: Array<[number, number, number]> = [
    [120, 20, 40],
    [1380, 26, 42],
  ];
  for (const [cx, cy, r] of clouds) {
    if (cy > grassTop - 40) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const [dx, dy, k] of [
      [0, 0, 1],
      [r * 0.9, r * 0.15, 0.75],
      [-r * 0.9, r * 0.2, 0.7],
      [r * 0.3, -r * 0.4, 0.7],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx, cy + dy, r * k, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // трава
  const g = ctx.createLinearGradient(0, grassTop, 0, h);
  g.addColorStop(0, '#8DD13E');
  g.addColorStop(0.12, '#6DB52C');
  g.addColorStop(1, '#3F7A16');
  ctx.fillStyle = g;
  ctx.fillRect(0, grassTop, w, h - grassTop);
  ctx.fillStyle = '#A6E05A';
  ctx.beginPath();
  ctx.moveTo(0, grassTop + 4);
  for (let x = 0; x <= w; x += 14) {
    ctx.lineTo(x + 7, grassTop - 8 - ((x * 7) % 6));
    ctx.lineTo(x + 14, grassTop + 4);
  }
  ctx.lineTo(w, grassTop + 10);
  ctx.lineTo(0, grassTop + 10);
  ctx.closePath();
  ctx.fill();
}

function cellFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.roundRect(x + 3, y + 3, w - 6, h - 6, 10);
  ctx.fill();
}

async function main(): Promise<void> {
  try {
    await document.fonts.load(`20px ${FONT}`);
  } catch {
    // шрифт не критичен
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;

  // ── раскладка
  const top = 70;
  const birdLabelW = 90;
  const birdColW = (W - birdLabelW - 20) / BIRDS.length;
  const birdRowH = 168;
  const birdR = 55;
  const birdsY = top + 40;
  const pigsHeaderY = birdsY + BIRD_POSES.length * birdRowH + 30;
  const pigLabelW = 120;
  const pigCols = PIG_POSES.length * 3;
  const pigColW = (W - pigLabelW - 20) / pigCols;
  const pigR = 40;
  const pigRows: Array<{ type: PigType; helmet: boolean; title: string; h: number }> = [
    { type: 'small', helmet: false, title: 'small', h: 124 },
    { type: 'medium', helmet: false, title: 'medium', h: 124 },
    { type: 'large', helmet: false, title: 'large', h: 124 },
    { type: 'helmet', helmet: true, title: 'helmet', h: 136 },
    { type: 'helmet', helmet: false, title: 'helmet (без каски)', h: 124 },
    { type: 'mustache', helmet: false, title: 'mustache', h: 124 },
    { type: 'king', helmet: false, title: 'king', h: 156 },
  ];
  const pigsY = pigsHeaderY + 64;
  const pigsH = pigRows.reduce((a, r) => a + r.h, 0);
  const smallY = pigsY + pigsH + 40;
  const smallH = 220;
  const rotY = smallY + smallH + 10;
  const rotH = 190;
  const lineupY = rotY + rotH + 30;
  const lineupScale = 80; // CSS px на метр
  const grassTop = lineupY + 230;
  const H = grassTop + 70;

  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  drawBackground(ctx, W, H, grassTop);
  label(ctx, 'Сердитые Птицы — персонажи (процедурные спрайты)', W / 2, 32, 30, 'center', '#FFE15A');

  const t0 = performance.now();
  let count = 0;

  // ── 1. птицы × позы
  header(ctx, `Птицы × позы  (r = ${birdR} px)`, top + 12);
  BIRDS.forEach((b, i) => label(ctx, NAMES[b], birdLabelW + birdColW * (i + 0.5), birdsY + 6, 18));
  BIRD_POSES.forEach((pose, j) => {
    const y0 = birdsY + 16 + j * birdRowH;
    label(ctx, pose, 16, y0 + birdRowH * 0.55, 18, 'left', '#FFF6C8');
    BIRDS.forEach((b, i) => {
      const x0 = birdLabelW + birdColW * i;
      cellFrame(ctx, x0, y0, birdColW, birdRowH);
      const cx = x0 + birdColW * 0.5 - (b === 'hal' ? 14 : 0);
      placeBird(ctx, b, pose, cx, y0 + 98, birdR);
      count++;
    });
  });

  // ── 2. свиньи × позы × повреждения
  header(ctx, `Свиньи × позы × стадии повреждений 0/1/2  (r = ${pigR} px)`, pigsHeaderY);
  PIG_POSES.forEach((pose, j) => {
    const gx = pigLabelW + pigColW * 3 * j;
    label(ctx, pose, gx + pigColW * 1.5, pigsHeaderY + 32, 18);
    for (let st = 0; st < 3; st++) label(ctx, `dmg ${st}`, gx + pigColW * (st + 0.5), pigsHeaderY + 52, 12, 'center', '#E8F6FF');
  });
  let ry = pigsY;
  for (const row of pigRows) {
    label(ctx, row.title, 14, ry + row.h * 0.55, row.title.length > 10 ? 13 : 17, 'left', '#FFF6C8');
    PIG_POSES.forEach((pose, j) => {
      for (let st = 0; st < 3; st++) {
        const x0 = pigLabelW + pigColW * (j * 3 + st);
        cellFrame(ctx, x0, ry, pigColW, row.h);
        placePig(ctx, row.type, pose, st, row.helmet, x0 + pigColW / 2, ry + row.h - pigR - 18, pigR);
        count++;
      }
    });
    ry += row.h;
  }

  // ── 3. мелкие размеры
  header(ctx, 'Мелкие размеры: r = 16 и 28 px', smallY);
  const sizes = [16, 28];
  sizes.forEach((r, k) => {
    const y = smallY + 60 + k * 90 + (k === 1 ? 10 : 0);
    let x = 40;
    label(ctx, `${r}px`, x - 20, y, 13, 'left', '#FFF6C8');
    x += 40;
    for (const b of BIRDS) {
      placeBird(ctx, b, k === 0 ? 'idle' : 'fly', x, y, r);
      count++;
      x += r * 3.4 + 6;
    }
    x += 10;
    for (const p of PIGS) {
      placePig(ctx, p, k === 0 ? 'idle' : 'scared', k === 0 ? 0 : 2, true, x, y, r);
      count++;
      x += r * 3.0 + 6;
    }
  });

  // ── 4. поворот (через мировую трансформацию)
  header(ctx, 'Поворот (мир, CCW): 0° / 45° / 90° / 180°, спрайт с ppu ×√2 от экранного', rotY);
  const rotTypes: BirdType[] = ['red', 'chuck', 'hal'];
  rotTypes.forEach((b, k) => {
    [0, 45, 90, 180].forEach((deg, i) => {
      const x = 90 + k * 600 + i * 135;
      const y = rotY + 100;
      const radiusM = BIRD_R[b];
      const scale = 36 / radiusM; // экранный масштаб, px/м
      // спрайт рендерим при ppu на ступень выше экранного (как кэш рендера): ×√2
      const s = renderBird(b, 'idle', radiusM, scale * Math.SQRT2 * dpr);
      drawSprite(ctx, s, x, y, (deg * Math.PI) / 180, scale);
      physShape(ctx, b, x, y, 36, (deg * Math.PI) / 180);
      label(ctx, `${deg}°`, x, y + 66, 13);
      count++;
    });
  });

  // ── 5. линейка в реальных пропорциях на траве
  header(ctx, `Реальные пропорции (${lineupScale} px/м), пунктир — физический круг`, lineupY);
  const groundY = grassTop + 2;
  let lx = 30;
  for (const b of BIRDS) {
    const r = BIRD_R[b] * lineupScale;
    lx += r;
    const s = renderBird(b, 'idle', BIRD_R[b], lineupScale * dpr);
    const by = groundY - r * physBottom(b);
    drawSprite(ctx, s, lx, by, 0, lineupScale);
    physShape(ctx, b, lx, by, r);
    label(ctx, NAMES[b], lx, groundY + 22, 13);
    lx += r + 22;
    count++;
  }
  lx += 20;
  for (const p of PIGS) {
    const r = PIG_R[p] * lineupScale;
    lx += r;
    const s = renderPig(p, 'idle', 0, true, PIG_R[p], lineupScale * dpr);
    drawSprite(ctx, s, lx, groundY - r, 0, lineupScale);
    physCircle(ctx, lx, groundY - r, r);
    label(ctx, NAMES[p], lx, groundY + 22, 13);
    lx += r + 22;
    count++;
  }

  const ms = performance.now() - t0;
  label(
    ctx,
    `${count} спрайтов, ${ms.toFixed(0)} мс${clipped.length ? ` — ОБРЕЗАНО: ${clipped.length}` : ''}`,
    W - 20,
    32,
    14,
    'right',
    clipped.length ? '#FF8080' : '#E8F6FF',
  );
  console.log(`[preview] sprites=${count} time=${ms.toFixed(0)}ms clipped=${clipped.length}`);
}

/** Крупный план: все птицы (idle/fly/hurt) и свиньи (idle, laugh dmg 2) при r = 120 px. */
async function mainDetail(): Promise<void> {
  try {
    await document.fonts.load(`20px ${FONT}`);
  } catch {
    // шрифт не критичен
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const R = 110;
  const cellW = 330;
  const cellH = 330;
  const cols = 5;
  const H = 40 + Math.ceil((BIRDS.length + 8) / cols) * cellH;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  drawBackground(ctx, W, H, H - 10);
  const pose = (params.get('pose') ?? 'idle') as BirdPose;
  const pigPose = (params.get('pigpose') ?? 'idle') as PigPose;
  const pigStage = Number(params.get('stage') ?? '0');
  let n = 0;
  const at = (i: number): [number, number] => [40 + (i % cols) * cellW + cellW / 2, 40 + Math.floor(i / cols) * cellH + cellH * 0.56];
  for (const b of BIRDS) {
    const [x, y] = at(n++);
    placeBird(ctx, b, pose, x - (b === 'hal' ? 30 : 0), y, R);
    label(ctx, `${NAMES[b]} / ${pose}`, x, y + R + 30, 16);
  }
  for (const p of PIGS) {
    const [x, y] = at(n++);
    placePig(ctx, p, pigPose, pigStage, true, x, y + 10, R);
    label(ctx, `${NAMES[p]} / ${pigPose} / dmg ${pigStage}`, x, y + R + 36, 16);
  }
  {
    const [x, y] = at(n++);
    placePig(ctx, 'helmet', pigPose, pigStage, false, x, y + 10, R);
    label(ctx, `helmet без каски / ${pigPose}`, x, y + R + 36, 16);
  }
}

void (detail ? mainDetail() : main());
