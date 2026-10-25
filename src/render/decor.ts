// Декор уровня без физики (LevelDef.decor): кусты, камни, цветы, таблички, пучки травы, ракушки, снеговик, ели.
// В общем стиле игры (04 §1): толстая тёмная обводка, мягкий объём градиентом, блик сверху-слева.
// Рисуется кодом в offscreen-холст; спрайт-пространство — метры, ось Y вниз, (ox, oy) — точка опоры (середина низа).

import { createCanvas, ctx2d, type Ctx2D } from './canvas';
import type { DecorDef, ThemeId } from '../core/types';
import type { Sprite } from './sprites/api';

export type DecorKind = DecorDef['kind'];

/** Габарит декора при scale = 1: ширина и высота, м (для отсечения и холста). */
export const DECOR_SIZE: Record<DecorKind, { w: number; h: number }> = {
  bush: { w: 2.0, h: 1.25 },
  rock: { w: 1.35, h: 0.85 },
  flower: { w: 0.55, h: 0.75 },
  sign: { w: 1.1, h: 1.55 },
  grass: { w: 0.8, h: 0.6 },
  shell: { w: 0.55, h: 0.4 },
  snowman: { w: 1.3, h: 2.0 },
  pine: { w: 2.0, h: 3.6 },
};

const TAU = Math.PI * 2;

/** Детерминированный ГПСЧ (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pal {
  light: string;
  base: string;
  dark: string;
  line: string;
}

const LEAF: Record<ThemeId, Pal> = {
  meadow: { light: '#9BE05A', base: '#5CB536', dark: '#2F7D1F', line: '#173F0C' },
  beach: { light: '#B8D865', base: '#7DAE3A', dark: '#4B7A22', line: '#22400E' },
  snow: { light: '#6FA86A', base: '#3E7C47', dark: '#24552F', line: '#102A17' },
};
const ROCK: Record<ThemeId, Pal> = {
  meadow: { light: '#CDD3D8', base: '#9AA2AA', dark: '#666E77', line: '#2E3338' },
  beach: { light: '#F0D6A2', base: '#CDA66A', dark: '#93703F', line: '#4A3418' },
  snow: { light: '#C6D2DE', base: '#8E9DAD', dark: '#5D6B7A', line: '#26303A' },
};
const WOOD: Pal = { light: '#E3A963', base: '#B9783A', dark: '#7A4A1F', line: '#3A210B' };
const SNOW = { light: '#FFFFFF', base: '#EAF4FC', dark: '#B9D3EA', line: '#4E6B86' };

/** Видимая толщина обводки, м (не тоньше 1.5 px). */
const outW = (ppu: number, m = 0.045): number => Math.max(m, 1.5 / ppu);

/** Обводка «под» заливкой: сначала толстый тёмный контур, затем заливка поверх — видна половина. */
function outlined(c: Ctx2D, p: Path2D, fill: string | CanvasGradient, line: string, ow: number): void {
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = ow * 2;
  c.strokeStyle = line;
  c.stroke(p);
  c.fillStyle = fill;
  c.fill(p);
}

function vgrad(c: Ctx2D, y0: number, y1: number, top: string, mid: string, bot: string): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(0.45, mid);
  g.addColorStop(1, bot);
  return g;
}

function rgrad(c: Ctx2D, x: number, y: number, r: number, light: string, base: string, dark: string): CanvasGradient {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.1);
  g.addColorStop(0, light);
  g.addColorStop(0.5, base);
  g.addColorStop(1, dark);
  return g;
}

/** Блик-капля. */
function gloss(c: Ctx2D, x: number, y: number, rx: number, ry: number, a = 0.45): void {
  c.save();
  c.globalAlpha = a;
  c.fillStyle = '#FFFFFF';
  c.beginPath();
  c.ellipse(x, y, rx, ry, -0.5, 0, TAU);
  c.fill();
  c.restore();
}

// ───────────────────────── предметы ─────────────────────────

function bush(c: Ctx2D, theme: ThemeId, v: number, ow: number): void {
  const P = LEAF[theme];
  const r = rng(101 + v * 17);
  const n = 4 + (v % 2);
  const bumps: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const x = -0.75 + 1.5 * t + (r() - 0.5) * 0.12;
    const rr = 0.32 + 0.22 * Math.sin(Math.PI * t) + r() * 0.08;
    bumps.push([x, -rr * 0.95 - 0.05, rr]);
  }
  bumps.push([0, -0.62 - r() * 0.08, 0.42]);
  const p = new Path2D();
  for (const [x, y, rr] of bumps) {
    p.moveTo(x + rr, y);
    p.arc(x, y, rr, 0, TAU);
  }
  p.rect(-0.82, -0.3, 1.64, 0.3);
  outlined(c, p, vgrad(c, -1.15, 0, P.light, P.base, P.dark), P.line, ow);
  // объём каждой «шапки»
  c.save();
  c.clip(p);
  for (const [x, y, rr] of bumps) {
    c.fillStyle = rgrad(c, x, y, rr, P.light, P.base, P.dark);
    c.globalAlpha = 0.55;
    c.beginPath();
    c.arc(x, y, rr * 0.92, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
  // ягоды / цветочки
  const dot = theme === 'snow' ? '#D8263A' : theme === 'beach' ? '#FF8A3D' : v === 1 ? '#FFFFFF' : '#E8344A';
  for (let i = 0; i < 5; i++) {
    const [x, y, rr] = bumps[Math.floor(r() * bumps.length)];
    const a = r() * TAU;
    c.fillStyle = dot;
    c.beginPath();
    c.arc(x + Math.cos(a) * rr * 0.5, y + Math.sin(a) * rr * 0.45, 0.045, 0, TAU);
    c.fill();
  }
  // тень у основания
  c.fillStyle = 'rgba(10,40,5,0.25)';
  c.fillRect(-0.9, -0.12, 1.8, 0.12);
  c.restore();
  if (theme === 'snow') {
    const s = new Path2D();
    for (const [x, y, rr] of bumps) {
      s.moveTo(x - rr * 0.85, y - rr * 0.25);
      s.ellipse(x, y - rr * 0.55, rr * 0.88, rr * 0.42, 0, Math.PI * 1.02, Math.PI * 1.98);
    }
    outlined(c, s, SNOW.base, SNOW.line, ow * 0.6);
  }
  const [gx, gy, gr] = bumps[bumps.length - 1];
  gloss(c, gx - gr * 0.35, gy - gr * 0.45, gr * 0.28, gr * 0.14, 0.35);
}

function rock(c: Ctx2D, theme: ThemeId, v: number, ow: number): void {
  const P = ROCK[theme];
  const r = rng(303 + v * 29);
  const w = 1.15 + v * 0.08;
  const h = 0.62 + r() * 0.12;
  const pts: Array<[number, number]> = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (Math.PI * i) / n;
    const k = 0.86 + r() * 0.18;
    pts.push([Math.cos(a) * (w / 2) * k, Math.sin(a) * h * k]);
  }
  const p = new Path2D();
  p.moveTo(-w / 2, 0);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [nx, ny] = pts[Math.min(pts.length - 1, i + 1)];
    p.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  p.lineTo(w / 2, 0);
  p.closePath();
  const g = c.createLinearGradient(-w * 0.4, -h, w * 0.3, 0);
  g.addColorStop(0, P.light);
  g.addColorStop(0.5, P.base);
  g.addColorStop(1, P.dark);
  outlined(c, p, g, P.line, ow);
  c.save();
  c.clip(p);
  // грани
  c.strokeStyle = P.dark;
  c.globalAlpha = 0.55;
  c.lineWidth = ow * 0.7;
  c.beginPath();
  c.moveTo(-w * 0.1, -h * 0.85);
  c.quadraticCurveTo(w * 0.02, -h * 0.4, w * 0.18, -h * 0.05);
  c.moveTo(w * 0.22, -h * 0.7);
  c.lineTo(w * 0.32, -h * 0.35);
  c.stroke();
  c.globalAlpha = 1;
  if (theme === 'meadow') {
    // мох сверху
    c.fillStyle = '#6DBA3C';
    c.beginPath();
    c.ellipse(-w * 0.12, -h * 0.98, w * 0.3, h * 0.2, -0.1, 0, TAU);
    c.fill();
    c.fillStyle = '#9BDD62';
    c.beginPath();
    c.ellipse(-w * 0.18, -h * 1.02, w * 0.16, h * 0.08, -0.1, 0, TAU);
    c.fill();
  }
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(-w, -0.1, 2 * w, 0.1);
  c.restore();
  if (theme === 'snow') {
    const s = new Path2D();
    s.ellipse(-w * 0.05, -h * 0.9, w * 0.4, h * 0.22, 0.05, Math.PI, TAU);
    s.closePath();
    outlined(c, s, SNOW.base, SNOW.line, ow * 0.6);
  }
  gloss(c, -w * 0.22, -h * 0.66, w * 0.12, h * 0.07, 0.4);
}

const PETALS = ['#F23C4E', '#FFD23C', '#FF8FC8', '#FFFFFF', '#B07CFF'];

function flower(c: Ctx2D, theme: ThemeId, v: number, ow: number): void {
  const r = rng(505 + v * 13);
  const stemH = 0.5 + r() * 0.1;
  // стебель и листья
  c.lineCap = 'round';
  c.strokeStyle = '#1F4A10';
  c.lineWidth = 0.07 + ow;
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(0.06, -stemH * 0.5, 0, -stemH);
  c.stroke();
  c.strokeStyle = '#4FA42E';
  c.lineWidth = 0.05;
  c.stroke();
  for (const side of [-1, 1]) {
    const leaf = new Path2D();
    const ly = -stemH * (side < 0 ? 0.3 : 0.45);
    leaf.moveTo(0.02, ly);
    leaf.quadraticCurveTo(side * 0.16, ly - 0.14, side * 0.24, ly - 0.04);
    leaf.quadraticCurveTo(side * 0.12, ly + 0.03, 0.02, ly);
    outlined(c, leaf, '#5DBB36', '#1F4A10', ow * 0.6);
  }
  // лепестки
  const col = theme === 'snow' ? (v % 2 ? '#BFE6FF' : '#FFFFFF') : PETALS[v % PETALS.length];
  const cx = 0;
  const cy = -stemH;
  const n = 5;
  const pp = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI / 2;
    pp.moveTo(cx + Math.cos(a) * 0.2, cy + Math.sin(a) * 0.2);
    pp.ellipse(cx + Math.cos(a) * 0.1, cy + Math.sin(a) * 0.1, 0.1, 0.07, a, 0, TAU);
  }
  outlined(c, pp, col, '#5A1620', ow * 0.6);
  c.fillStyle = 'rgba(255,255,255,0.4)';
  c.beginPath();
  c.ellipse(cx - 0.07, cy - 0.09, 0.05, 0.03, -0.6, 0, TAU);
  c.fill();
  const core = new Path2D();
  core.arc(cx, cy, 0.065, 0, TAU);
  outlined(c, core, '#FFB21C', '#6B3A00', ow * 0.5);
}

function sign(c: Ctx2D, _theme: ThemeId, v: number, ow: number): void {
  const postW = 0.13;
  const post = new Path2D();
  post.roundRect(-postW / 2, -1.25, postW, 1.25, 0.03);
  outlined(c, post, vgrad(c, -1.25, 0, WOOD.light, WOOD.base, WOOD.dark), WOOD.line, ow);
  // доска со стрелкой
  const bw = 0.95;
  const bh = 0.48;
  const by = -1.45;
  const board = new Path2D();
  board.moveTo(-bw / 2, by);
  board.lineTo(bw / 2 - 0.12, by);
  board.lineTo(bw / 2 + 0.06, by + bh / 2);
  board.lineTo(bw / 2 - 0.12, by + bh);
  board.lineTo(-bw / 2, by + bh);
  board.closePath();
  const g = c.createLinearGradient(0, by, 0, by + bh);
  g.addColorStop(0, WOOD.light);
  g.addColorStop(1, WOOD.base);
  outlined(c, board, g, WOOD.line, ow);
  c.save();
  c.clip(board);
  c.strokeStyle = WOOD.dark;
  c.globalAlpha = 0.45;
  c.lineWidth = Math.max(0.015, ow * 0.5);
  c.beginPath();
  c.moveTo(-bw / 2, by + bh / 2);
  c.lineTo(bw / 2 + 0.1, by + bh / 2);
  c.stroke();
  c.restore();
  // гвозди
  c.fillStyle = '#3A2A1A';
  for (const x of [-bw / 2 + 0.09, bw / 2 - 0.2]) {
    c.beginPath();
    c.arc(x, by + bh / 2, 0.028, 0, TAU);
    c.fill();
  }
  // рисунок: свиной пятачок на табличке (вариант 1) или стрелка
  if (v % 2 === 1) {
    c.fillStyle = '#7CC23A';
    c.strokeStyle = '#21400E';
    c.lineWidth = ow * 0.7;
    c.beginPath();
    c.ellipse(-0.05, by + bh / 2, 0.13, 0.1, 0, 0, TAU);
    c.fill();
    c.stroke();
    c.fillStyle = '#21400E';
    for (const x of [-0.09, -0.01]) {
      c.beginPath();
      c.ellipse(x, by + bh / 2, 0.022, 0.035, 0, 0, TAU);
      c.fill();
    }
  } else {
    c.strokeStyle = '#6A1F12';
    c.lineWidth = 0.06;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(-0.28, by + bh / 2);
    c.lineTo(0.14, by + bh / 2);
    c.moveTo(0.02, by + bh / 2 - 0.1);
    c.lineTo(0.14, by + bh / 2);
    c.lineTo(0.02, by + bh / 2 + 0.1);
    c.stroke();
  }
}

function grass(c: Ctx2D, theme: ThemeId, v: number, ow: number): void {
  const r = rng(707 + v * 31);
  const pal =
    theme === 'beach'
      ? { a: '#C9C35A', b: '#8FA23A', line: '#3E4A12' }
      : theme === 'snow'
        ? { a: '#C9B07A', b: '#8E7444', line: '#3E2E12' }
        : { a: '#8EDB4E', b: '#45A02A', line: '#1B4A0C' };
  const n = 6 + v;
  const p = new Path2D();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const x0 = -0.3 + 0.6 * t;
    const lean = (t - 0.5) * 0.5 + (r() - 0.5) * 0.15;
    const hh = 0.35 + Math.sin(Math.PI * t) * 0.2 + r() * 0.08;
    const bw = 0.055;
    p.moveTo(x0 - bw, 0);
    p.quadraticCurveTo(x0 + lean * 0.3, -hh * 0.6, x0 + lean, -hh);
    p.quadraticCurveTo(x0 + lean * 0.2, -hh * 0.55, x0 + bw, 0);
    p.closePath();
  }
  outlined(c, p, vgrad(c, -0.6, 0, pal.a, pal.a, pal.b), pal.line, ow * 0.7);
  if (theme === 'snow') {
    const s = new Path2D();
    s.ellipse(0, -0.02, 0.36, 0.09, 0, Math.PI, TAU);
    s.closePath();
    outlined(c, s, SNOW.base, SNOW.line, ow * 0.5);
  }
}

function shell(c: Ctx2D, _theme: ThemeId, v: number, ow: number): void {
  const cols = [
    ['#FFD1C2', '#F59A86', '#B4513F'],
    ['#FFE7B0', '#F2B65A', '#A8661C'],
    ['#F4D9FF', '#CFA0E8', '#7D4E9A'],
  ][v % 3];
  const w = 0.5;
  const h = 0.36;
  const p = new Path2D();
  p.moveTo(-0.07, 0);
  p.lineTo(-w / 2, -h * 0.55);
  p.quadraticCurveTo(-w * 0.32, -h * 1.05, 0, -h);
  p.quadraticCurveTo(w * 0.32, -h * 1.05, w / 2, -h * 0.55);
  p.lineTo(0.07, 0);
  p.closePath();
  outlined(c, p, vgrad(c, -h, 0, cols[0], cols[1], cols[2]), '#5A2A1A', ow * 0.7);
  c.save();
  c.clip(p);
  c.strokeStyle = cols[2];
  c.globalAlpha = 0.6;
  c.lineWidth = Math.max(0.012, ow * 0.45);
  for (let i = -3; i <= 3; i++) {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(i * 0.075, -h);
    c.stroke();
  }
  c.restore();
  const base = new Path2D();
  base.roundRect(-0.1, -0.06, 0.2, 0.07, 0.02);
  outlined(c, base, cols[1], '#5A2A1A', ow * 0.5);
  gloss(c, -w * 0.15, -h * 0.75, 0.06, 0.03, 0.5);
}

function snowman(c: Ctx2D, _theme: ThemeId, v: number, ow: number): void {
  const balls: Array<[number, number]> = [
    [-0.42, 0.42],
    [-1.07, 0.32],
    [-1.55, 0.23],
  ];
  // руки-палки
  c.strokeStyle = '#3A210B';
  c.lineCap = 'round';
  c.lineWidth = 0.05 + ow;
  c.beginPath();
  c.moveTo(-0.25, -1.1);
  c.lineTo(-0.62, -1.42);
  c.moveTo(-0.5, -1.33);
  c.lineTo(-0.62, -1.3);
  c.moveTo(0.25, -1.1);
  c.lineTo(0.6, -1.36);
  c.stroke();
  c.strokeStyle = '#7A4A1F';
  c.lineWidth = 0.045;
  c.stroke();
  for (const [y, rr] of balls) {
    const p = new Path2D();
    p.arc(0, y, rr, 0, TAU);
    outlined(c, p, rgrad(c, 0, y, rr, SNOW.light, SNOW.base, SNOW.dark), SNOW.line, ow);
  }
  // шарф
  const scarf = new Path2D();
  scarf.roundRect(-0.27, -1.36, 0.54, 0.11, 0.05);
  scarf.roundRect(0.08, -1.32, 0.12, 0.3, 0.04);
  outlined(c, scarf, v % 2 ? '#2E7BD6' : '#E0302A', '#4A0E0B', ow * 0.6);
  // лицо
  c.fillStyle = '#1A1A1A';
  for (const x of [-0.08, 0.08]) {
    c.beginPath();
    c.arc(x, -1.62, 0.03, 0, TAU);
    c.fill();
  }
  for (const y of [-0.98, -0.82, -0.6]) {
    c.beginPath();
    c.arc(0, y, 0.035, 0, TAU);
    c.fill();
  }
  const nose = new Path2D();
  nose.moveTo(0, -1.58);
  nose.lineTo(0.24, -1.54);
  nose.lineTo(0, -1.51);
  nose.closePath();
  outlined(c, nose, '#FF8A1E', '#7A3A00', ow * 0.4);
  // ведро
  const hat = new Path2D();
  hat.moveTo(-0.17, -1.74);
  hat.lineTo(-0.13, -1.95);
  hat.lineTo(0.13, -1.95);
  hat.lineTo(0.17, -1.74);
  hat.closePath();
  outlined(c, hat, vgrad(c, -1.95, -1.74, '#8E99A6', '#6B7684', '#4A5360'), '#20262E', ow * 0.6);
}

function pine(c: Ctx2D, theme: ThemeId, v: number, ow: number): void {
  const P = LEAF[theme === 'meadow' ? 'snow' : theme];
  const trunk = new Path2D();
  trunk.rect(-0.12, -0.55, 0.24, 0.55);
  outlined(c, trunk, vgrad(c, -0.55, 0, WOOD.base, WOOD.dark, WOOD.dark), WOOD.line, ow);
  const tiers = 4;
  const H = 3.2 + v * 0.15;
  const tierPaths: Path2D[] = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y0 = -0.45 - t * (H - 0.7);
    const w = (0.95 - t * 0.6) * (1 + v * 0.04);
    const hh = 1.05 - t * 0.12;
    const p = new Path2D();
    p.moveTo(-w, y0);
    p.quadraticCurveTo(-w * 0.45, y0 - hh * 0.4, 0, y0 - hh);
    p.quadraticCurveTo(w * 0.45, y0 - hh * 0.4, w, y0);
    p.quadraticCurveTo(0, y0 + 0.12, -w, y0);
    p.closePath();
    tierPaths.push(p);
  }
  for (let i = 0; i < tiers; i++) {
    const p = tierPaths[i];
    const t = i / tiers;
    const y0 = -0.45 - t * (H - 0.7);
    outlined(c, p, vgrad(c, y0 - 1.05, y0, P.light, P.base, P.dark), P.line, ow);
    if (theme === 'snow') {
      const w = (0.95 - t * 0.6) * 0.9;
      const s = new Path2D();
      s.moveTo(-w * 0.7, y0 - 0.25);
      s.quadraticCurveTo(-w * 0.3, y0 - 0.75, 0, y0 - 1.0);
      s.quadraticCurveTo(w * 0.3, y0 - 0.75, w * 0.7, y0 - 0.25);
      s.quadraticCurveTo(0, y0 - 0.45, -w * 0.7, y0 - 0.25);
      s.closePath();
      c.fillStyle = SNOW.base;
      c.fill(s);
    }
  }
}

const DRAW: Record<DecorKind, (c: Ctx2D, theme: ThemeId, v: number, ow: number) => void> = {
  bush,
  rock,
  flower,
  sign,
  grass,
  shell,
  snowman,
  pine,
};

/** Спрайт декора (масштаб 1); (ox, oy) — середина низа (точка опоры на поверхности). */
export function renderDecor(kind: DecorKind, theme: ThemeId, variant: number, ppu: number): Sprite {
  const sz = DECOR_SIZE[kind] ?? DECOR_SIZE.bush;
  const pad = 0.08 + 3 / ppu;
  const W = (sz.w + 2 * pad) * ppu;
  const H = (sz.h + 2 * pad) * ppu;
  const canvas = createCanvas(W, H);
  const c = ctx2d(canvas);
  const ox = canvas.width / 2;
  const oy = canvas.height - pad * ppu;
  c.translate(ox, oy);
  c.scale(ppu, ppu);
  (DRAW[kind] ?? bush)(c, theme, variant, outW(ppu));
  return { canvas, ox, oy, ppu };
}
