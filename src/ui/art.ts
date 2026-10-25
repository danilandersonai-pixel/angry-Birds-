// Иллюстрации меню: персонажи (готовые спрайты renderBird/renderPig) и мини-пейзажи тем для карточек эпизодов.
// Всё рисуется кодом в <canvas>. Палитры — из 04-visual.md §4.

import type { BirdType, EpisodeDef, PigType, ThemeId } from '../core/types';
import type { BirdPose, PigPose } from '../core/api';
import { renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';

/** Цвета карточек/плашек тем (07 §3.1) и подписи. */
export const THEME_UI: Record<ThemeId, { card: string; cardHi: string; cardEdge: string; sky: string }> = {
  meadow: { card: '#3E8E2E', cardHi: '#5DB043', cardEdge: '#1F4F14', sky: '#5BC0F5' },
  beach: { card: '#E58A2B', cardHi: '#F7AE4F', cardEdge: '#7A3E08', sky: '#E2687A' },
  snow: { card: '#3A7FC4', cardHi: '#5FA2E0', cardEdge: '#173E66', sky: '#7BB4EA' },
};

const dpr = (): number => Math.min(2, Math.max(1, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));

/** Текущий масштаб меню (u-menu), под который растеризуются иллюстрации. Обновляет UI при раскладке. */
export const artScale = { u: 1.25 };
/** Множитель разрешения холстов: не меньше 1.25 (HUD), не больше 2 (потолок меню). */
const resK = (): number => Math.min(2, Math.max(1.25, artScale.u)) * dpr();

/**
 * Спрайт персонажа как DOM-холст. rU — радиус тела в единицах u; CSS-размер задаётся в u,
 * поэтому персонаж масштабируется вместе с интерфейсом. Разрешение — с запасом под u ≤ 1.25 и DPR.
 */
export function characterCanvas(
  kind: 'bird' | 'pig',
  type: BirdType | PigType,
  pose: BirdPose | PigPose,
  rU: number,
  cls = '',
): HTMLCanvasElement {
  const ppu = Math.ceil(rU * resK());
  let canvas: HTMLCanvasElement;
  try {
    canvas =
      kind === 'bird'
        ? (renderBird(type as BirdType, pose as BirdPose, 1, ppu).canvas as HTMLCanvasElement)
        : (renderPig(type as PigType, pose as PigPose, 0, true, 1, ppu).canvas as HTMLCanvasElement);
  } catch {
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
  }
  const sizeU = (canvas.width / ppu) * rU;
  canvas.className = `char ${cls}`;
  canvas.style.setProperty('--sz', String(sizeU.toFixed(2)));
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}

// ───────────────────────── мини-пейзажи тем ─────────────────────────

interface ScenePal {
  sky: Array<[number, string]>;
  sun: { x: number; y: number; r: number; glow: string };
  cloud: [string, string];
  far: { fill: string; light: string; snow?: string };
  hills: { top: string; bottom: string; rim: string };
  near: { top: string; bottom: string; rim: string };
  ground: { top: string; lip: string; soil: string; soilDark: string; outline: string };
  sea?: [string, string];
  tree: 'round' | 'palm' | 'pine';
  leaf: [string, string];
  trunk: string;
}

const PAL: Record<ThemeId, ScenePal> = {
  meadow: {
    sky: [
      [0, '#3C9BE6'],
      [0.55, '#8CCFF4'],
      [1, '#DDF3F7'],
    ],
    sun: { x: 0.8, y: 0.17, r: 0.07, glow: '#FFF1B0' },
    cloud: ['#FFFFFF', '#D2E8F5'],
    far: { fill: '#A3CDE0', light: '#C2E0EC' },
    hills: { top: '#94D283', bottom: '#74BA6C', rim: '#B9E59F' },
    near: { top: '#66BF4B', bottom: '#45A03C', rim: '#93D85F' },
    ground: { top: '#7CC83E', lip: '#3D8224', soil: '#8E5C34', soilDark: '#6C4325', outline: '#2D4515' },
    tree: 'round',
    leaf: ['#4AA33A', '#2E7A2A'],
    trunk: '#7A5230',
  },
  beach: {
    sky: [
      [0, '#2D2A6C'],
      [0.33, '#7B3F8E'],
      [0.6, '#E2687A'],
      [0.8, '#FF9F58'],
      [1, '#FFD47E'],
    ],
    sun: { x: 0.62, y: 0.5, r: 0.11, glow: '#FFB25A' },
    cloud: ['#FFD0A8', '#C7678A'],
    far: { fill: '#6C3F7C', light: '#8C568F' },
    hills: { top: '#E0A56C', bottom: '#BF7A58', rim: '#FFD08E' },
    near: { top: '#E0A56C', bottom: '#BF7A58', rim: '#FFD08E' },
    ground: { top: '#F4CF8A', lip: '#C08646', soil: '#E2B06A', soilDark: '#C8904E', outline: '#73441C' },
    sea: ['#F6A766', '#8C4A86'],
    tree: 'palm',
    leaf: ['#2F6040', '#1F4430'],
    trunk: '#6E412A',
  },
  snow: {
    sky: [
      [0, '#2C6CC2'],
      [0.5, '#7BB4EA'],
      [1, '#E4F2FB'],
    ],
    sun: { x: 0.2, y: 0.15, r: 0.06, glow: '#FFFFFF' },
    cloud: ['#FFFFFF', '#C8D9EC'],
    far: { fill: '#9BB2D7', light: '#C6D5EE', snow: '#F6FAFF' },
    hills: { top: '#AFC2E2', bottom: '#7F96C4', rim: '#EEF4FC' },
    near: { top: '#EDF4FC', bottom: '#C5D6EB', rim: '#FFFFFF' },
    ground: { top: '#F7FBFF', lip: '#AFC5DF', soil: '#7A87A2', soilDark: '#5F6A85', outline: '#2A3247' },
    tree: 'pine',
    leaf: ['#2F5E5B', '#1E403F'],
    trunk: '#5A3E2B',
  },
};

/** Детерминированный ГПСЧ для «случайных» деталей пейзажа. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function cloud(c: CanvasRenderingContext2D, x: number, y: number, s: number, col: [string, string]): void {
  const g = c.createLinearGradient(0, y - s, 0, y + s * 0.6);
  g.addColorStop(0, col[0]);
  g.addColorStop(1, col[1]);
  c.fillStyle = g;
  c.beginPath();
  const puffs: Array<[number, number, number]> = [
    [-0.9, 0.15, 0.5],
    [-0.35, -0.2, 0.7],
    [0.35, -0.3, 0.8],
    [0.95, 0.1, 0.55],
    [0, 0.25, 0.6],
  ];
  for (const [dx, dy, r] of puffs) {
    c.moveTo(x + dx * s + r * s, y + dy * s);
    c.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
  }
  c.fill();
}

/** Волнистый силуэт от y-уровня до низа. */
function ridge(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  base: number,
  amp: number,
  freq: number,
  phase: number,
  fill: string | CanvasGradient,
  rim?: string,
  rimW = 0,
): void {
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) {
    const y = base - amp * (0.6 * Math.sin((x / w) * freq * Math.PI * 2 + phase) + 0.4 * Math.sin((x / w) * freq * 2.3 * Math.PI * 2 + phase * 1.7));
    c.lineTo(x, y);
  }
  c.lineTo(w, h);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (rim && rimW > 0) {
    c.save();
    c.clip();
    c.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const y = base - amp * (0.6 * Math.sin((x / w) * freq * Math.PI * 2 + phase) + 0.4 * Math.sin((x / w) * freq * 2.3 * Math.PI * 2 + phase * 1.7));
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.strokeStyle = rim;
    c.lineWidth = rimW;
    c.stroke();
    c.restore();
  }
}

function mountains(c: CanvasRenderingContext2D, w: number, base: number, hgt: number, p: ScenePal['far'], r: () => number): void {
  const peaks = 4;
  for (let i = 0; i < peaks; i++) {
    const cx = (i + 0.2 + r() * 0.6) * (w / (peaks - 0.6)) - w * 0.1;
    const hw = w * (0.18 + r() * 0.1);
    const ph = hgt * (0.6 + r() * 0.4);
    c.beginPath();
    c.moveTo(cx - hw, base);
    c.quadraticCurveTo(cx - hw * 0.25, base - ph * 0.9, cx, base - ph);
    c.quadraticCurveTo(cx + hw * 0.25, base - ph * 0.9, cx + hw, base);
    c.closePath();
    c.fillStyle = p.fill;
    c.fill();
    // светлая сторона
    c.beginPath();
    c.moveTo(cx, base - ph);
    c.quadraticCurveTo(cx - hw * 0.25, base - ph * 0.9, cx - hw, base);
    c.lineTo(cx - hw * 0.2, base);
    c.closePath();
    c.fillStyle = p.light;
    c.fill();
    if (p.snow) {
      c.beginPath();
      c.moveTo(cx, base - ph);
      c.quadraticCurveTo(cx - hw * 0.12, base - ph * 0.85, cx - hw * 0.28, base - ph * 0.62);
      c.lineTo(cx - hw * 0.1, base - ph * 0.7);
      c.lineTo(cx + hw * 0.05, base - ph * 0.6);
      c.lineTo(cx + hw * 0.28, base - ph * 0.64);
      c.quadraticCurveTo(cx + hw * 0.12, base - ph * 0.85, cx, base - ph);
      c.fillStyle = p.snow;
      c.fill();
    }
  }
}

function tree(c: CanvasRenderingContext2D, kind: ScenePal['tree'], x: number, y: number, s: number, p: ScenePal): void {
  const ol = 'rgba(0,0,0,0.25)';
  c.lineJoin = 'round';
  if (kind === 'round') {
    c.fillStyle = p.trunk;
    c.fillRect(x - s * 0.08, y - s * 0.7, s * 0.16, s * 0.7);
    for (const [dx, dy, r, col] of [
      [-0.25, -0.85, 0.32, p.leaf[1]],
      [0.25, -0.85, 0.32, p.leaf[1]],
      [0, -1.1, 0.4, p.leaf[0]],
      [-0.18, -0.8, 0.3, p.leaf[0]],
      [0.2, -0.78, 0.28, p.leaf[0]],
    ] as Array<[number, number, number, string]>) {
      c.beginPath();
      c.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      c.fillStyle = col;
      c.fill();
    }
  } else if (kind === 'pine') {
    c.fillStyle = p.trunk;
    c.fillRect(x - s * 0.06, y - s * 0.3, s * 0.12, s * 0.3);
    for (let i = 0; i < 3; i++) {
      const ty = y - s * (0.25 + i * 0.32);
      const hw = s * (0.42 - i * 0.1);
      c.beginPath();
      c.moveTo(x - hw, ty);
      c.lineTo(x, ty - s * 0.5);
      c.lineTo(x + hw, ty);
      c.closePath();
      c.fillStyle = i % 2 ? p.leaf[0] : p.leaf[1];
      c.fill();
      c.beginPath();
      c.moveTo(x - hw * 0.55, ty - s * 0.2);
      c.lineTo(x, ty - s * 0.5);
      c.lineTo(x + hw * 0.55, ty - s * 0.2);
      c.quadraticCurveTo(x, ty - s * 0.12, x - hw * 0.55, ty - s * 0.2);
      c.fillStyle = '#F4F9FF';
      c.fill();
    }
  } else {
    // пальма
    c.strokeStyle = p.trunk;
    c.lineWidth = s * 0.1;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + s * 0.25, y - s * 0.6, x + s * 0.1, y - s * 1.2);
    c.stroke();
    const tx = x + s * 0.1;
    const ty = y - s * 1.2;
    c.fillStyle = p.leaf[0];
    c.strokeStyle = ol;
    c.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i - 2.5) * 0.55;
      c.beginPath();
      c.moveTo(tx, ty);
      c.quadraticCurveTo(tx + Math.cos(a - 0.4) * s * 0.5, ty + Math.sin(a - 0.4) * s * 0.5 - s * 0.1, tx + Math.cos(a) * s * 0.75, ty + Math.sin(a) * s * 0.75 + s * 0.2);
      c.quadraticCurveTo(tx + Math.cos(a + 0.3) * s * 0.4, ty + Math.sin(a + 0.3) * s * 0.4, tx, ty);
      c.fill();
    }
  }
}

/**
 * Нарисовать мини-пейзаж темы на весь холст (w×h в пикселях холста).
 * groundFrac — доля высоты, занятая землёй снизу.
 */
export function paintScene(c: CanvasRenderingContext2D, w: number, h: number, theme: ThemeId, seed = 7, groundFrac = 0.17): void {
  const p = PAL[theme];
  const r = rng(seed * 7919 + w);
  // небо
  const g = c.createLinearGradient(0, 0, 0, h);
  for (const [o, col] of p.sky) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  // солнце
  const sx = p.sun.x * w;
  const sy = p.sun.y * h;
  const sr = p.sun.r * h;
  const glow = c.createRadialGradient(sx, sy, sr * 0.5, sx, sy, sr * 4.5);
  glow.addColorStop(0, p.sun.glow + 'AA');
  glow.addColorStop(1, p.sun.glow + '00');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, h);
  c.beginPath();
  c.arc(sx, sy, sr, 0, Math.PI * 2);
  c.fillStyle = '#FFFDF0';
  c.fill();
  // облака
  for (let i = 0; i < 3; i++) cloud(c, (0.12 + i * 0.36 + r() * 0.1) * w, (0.1 + r() * 0.16) * h, h * (0.05 + r() * 0.03), p.cloud);

  const groundY = h * (1 - groundFrac);
  if (p.sea) {
    // море на закате
    const seaTop = h * 0.56;
    const sg = c.createLinearGradient(0, seaTop, 0, groundY);
    sg.addColorStop(0, p.sea[0]);
    sg.addColorStop(1, p.sea[1]);
    mountains(c, w, seaTop, h * 0.12, p.far, r);
    c.fillStyle = sg;
    c.fillRect(0, seaTop, w, h - seaTop);
    // дорожка солнца
    c.fillStyle = 'rgba(255,230,168,0.55)';
    for (let i = 0; i < 6; i++) {
      const yy = seaTop + (i + 0.5) * h * 0.035;
      const ww = sr * (1.6 - i * 0.18);
      c.fillRect(sx - ww, yy, ww * 2, h * 0.008);
    }
    ridge(c, w, h, groundY - h * 0.02, h * 0.03, 1.3, 1.1, p.near.bottom, p.near.rim, h * 0.012);
  } else {
    mountains(c, w, h * 0.6, h * 0.3, p.far, r);
    const hg = c.createLinearGradient(0, h * 0.5, 0, groundY);
    hg.addColorStop(0, p.hills.top);
    hg.addColorStop(1, p.hills.bottom);
    ridge(c, w, h, h * 0.62, h * 0.05, 1.1, 0.6, hg, p.hills.rim, h * 0.012);
    const ng = c.createLinearGradient(0, h * 0.62, 0, groundY);
    ng.addColorStop(0, p.near.top);
    ng.addColorStop(1, p.near.bottom);
    ridge(c, w, h, groundY - h * 0.06, h * 0.035, 1.6, 2.2, ng, p.near.rim, h * 0.012);
  }
  // деревья среднего плана
  const nTrees = 5;
  for (let i = 0; i < nTrees; i++) {
    const tx = ((i + 0.3 + r() * 0.4) / nTrees) * w;
    tree(c, p.tree, tx, groundY + h * 0.01, h * (0.15 + r() * 0.06), p);
  }
  // земля
  const gg = c.createLinearGradient(0, groundY, 0, h);
  gg.addColorStop(0, p.ground.soil);
  gg.addColorStop(1, p.ground.soilDark);
  c.fillStyle = gg;
  c.fillRect(0, groundY, w, h - groundY);
  // камушки
  c.fillStyle = p.ground.soilDark;
  for (let i = 0; i < 14; i++) {
    c.beginPath();
    c.ellipse(r() * w, groundY + h * 0.05 + r() * (h - groundY - h * 0.06), h * 0.01, h * 0.007, 0, 0, Math.PI * 2);
    c.fill();
  }
  // кромка (трава/песок/снег)
  const lipH = h * 0.035;
  c.beginPath();
  c.moveTo(0, groundY + lipH);
  for (let x = 0; x <= w; x += 6) c.lineTo(x, groundY - Math.sin(x * 0.11) * h * 0.004);
  c.lineTo(w, groundY + lipH);
  for (let x = w; x >= 0; x -= 10) c.lineTo(x, groundY + lipH + (Math.sin(x * 0.3) > 0 ? h * 0.008 : 0));
  c.closePath();
  c.fillStyle = p.ground.top;
  c.fill();
  c.strokeStyle = p.ground.lip;
  c.lineWidth = Math.max(1, h * 0.006);
  c.stroke();
}

/** Типовые «герои» эпизода: новая птица эпизода и самая крупная свинья. */
export function episodeHeroes(ep: EpisodeDef, prevEpisodes: readonly EpisodeDef[]): { bird: BirdType; pig: PigType } {
  const seen = new Set<BirdType>();
  for (const e of prevEpisodes) for (const l of e.levels) for (const b of l.birds) seen.add(b);
  let bird: BirdType = 'red';
  outer: for (const l of ep.levels)
    for (const b of l.birds)
      if (!seen.has(b)) {
        bird = b;
        break outer;
      }
  const rank: PigType[] = ['small', 'medium', 'large', 'helmet', 'mustache', 'king'];
  let pig: PigType = 'medium';
  let best = -1;
  for (const l of ep.levels)
    for (const pd of l.pigs) {
      const k = rank.indexOf(pd.type);
      if (k > best) {
        best = k;
        pig = pd.type;
      }
    }
  return { bird, pig };
}

/** Холст-арт карточки эпизода: пейзаж темы + герой-птица в полёте + свинья на земле. wU×hU — размер в u. */
export function episodeArt(ep: EpisodeDef, prev: readonly EpisodeDef[], wU: number, hU: number, seed: number): HTMLCanvasElement {
  const k = resK();
  const W = Math.round(wU * k);
  const H = Math.round(hU * k);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  cv.className = 'ep-art-cv';
  cv.setAttribute('aria-hidden', 'true');
  const c = cv.getContext('2d');
  if (!c) return cv;
  paintScene(c, W, H, ep.theme, seed, 0.2);
  const { bird, pig } = episodeHeroes(ep, prev);
  const groundY = H * 0.8;
  try {
    // свинья на маленьком помосте справа
    const pr = H * 0.15;
    const ps = renderPig(pig, 'idle', 0, true, 1, pr);
    const px = W * 0.73;
    const plankH = H * 0.06;
    c.fillStyle = '#C98A4B';
    c.strokeStyle = '#5A3412';
    c.lineWidth = Math.max(1.5, H * 0.012);
    const plankW = pr * 3;
    c.beginPath();
    c.roundRect(px - plankW / 2, groundY - plankH * 2.4, plankW, plankH, plankH * 0.3);
    c.fill();
    c.stroke();
    for (const dx of [-0.36, 0.36]) {
      c.beginPath();
      c.roundRect(px + dx * plankW - plankH * 0.45, groundY - plankH * 1.4, plankH * 0.9, plankH * 1.4, plankH * 0.2);
      c.fill();
      c.stroke();
    }
    const py = groundY - plankH * 2.4 - pr * 0.97;
    c.drawImage(ps.canvas, px - ps.ox, py - ps.oy);
    // птица летит слева, со следом
    const br = H * 0.135;
    const bs = renderBird(bird, 'fly', 1, br);
    const bx = W * 0.3;
    const by = H * 0.4;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      c.beginPath();
      c.arc(bx - t * W * 0.3, by + t * t * H * 0.36 + t * H * 0.04, Math.max(1.5, H * (0.014 - t * 0.006)), 0, Math.PI * 2);
      c.fill();
    }
    c.save();
    c.translate(bx, by);
    c.rotate(-0.18);
    c.drawImage(bs.canvas, -bs.ox, -bs.oy);
    c.restore();
  } catch {
    /* без персонажей — только пейзаж */
  }
  return cv;
}
