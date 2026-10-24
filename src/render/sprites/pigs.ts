// Процедурная отрисовка свиней (анфас). Единицы дизайна: радиус тела = 1, +y — вниз. См. charCommon.ts.

import type { PigType } from '../../core/types';
import type { PigPose } from '../../core/api';
import type { Sprite } from './api';
import {
  type BodyShade,
  type C,
  type Units,
  DEG,
  TAU,
  beginSprite,
  browStroke,
  circlePath,
  drawEye,
  ellipsePath,
  finishSprite,
  gloss,
  lw,
  mix,
  outlinePass,
  rgba,
  shadeBody,
  softBlob,
} from './charCommon';

/**
 * Нарисовать свинью в новый холст. damageStage 0..2; hasHelmet учитывается только для type = 'helmet'.
 * Центр тела — (ox, oy).
 */
export function renderPig(
  type: PigType,
  pose: PigPose,
  damageStage: number,
  hasHelmet: boolean,
  radiusM: number,
  ppu: number,
): Sprite {
  const s = PIG_SPECS[type];
  const helmet = type === 'helmet' && hasHelmet;
  const stage = Math.max(0, Math.min(2, Math.round(damageStage)));
  const d = beginSprite(radiusM * ppu, s.extent, s.outBase);
  drawPig(d.c, d.u, s, pose, stage, helmet);
  return finishSprite(d, ppu);
}

// ───────────────────────── палитра ─────────────────────────

const P = {
  base: '#84C13A',
  light: '#C8EE88',
  dark: '#4C881C',
  shadow: '#2A5A08',
  bounce: '#DDF7A6',
  outline: '#21400E',
  ear: '#7DBB35',
  earIn: '#4A8618',
  snout: '#A6D968',
  snoutHi: '#D6F2A2',
  snoutLo: '#67A22F',
  snoutLine: '#34621A',
  nostril: '#1E3A0A',
  eyeLine: '#21400E',
  lidLight: '#B4E07A',
  lidBase: '#80BE38',
  mouth: '#2C1608',
  tongue: '#E5606C',
  tooth: '#FFFBEA',
  bruise: '#6A4C9C',
  bruiseCore: '#7440AA',
  blackEye: '#3B2A4D',
  blackEyeSoft: '#4B2F78',
  bump: '#9DD058',
  freckle: '#4E8A1F',
  scratch: '#2F5A12',
};

/** Кожа свиньи (у Короля своя — светлее). */
interface Skin {
  base: string;
  light: string;
  dark: string;
  shadow: string;
  ear: string;
}

const SKIN: Skin = { base: P.base, light: P.light, dark: P.dark, shadow: P.shadow, ear: P.ear };
const KING_SKIN: Skin = { base: '#9CCB45', light: '#D9F29C', dark: '#5E9A24', shadow: '#33640C', ear: '#94C640' };

type BrowKind = 'none' | 'short' | 'heavy' | 'stern' | 'bushy' | 'royal';
type MouthKind = 'smile' | 'smirk' | 'grin' | 'hidden';

interface PigSpec {
  rx: number;
  ry: number;
  cy: number;
  ear: { x: number; y: number; r: number };
  /** Правый глаз (левый — зеркально). */
  eye: { x: number; y: number; rx: number; ry: number };
  pupilR: number;
  /** Постоянно опущенные веки (самодовольство). */
  smug: number;
  /** Наклон век, рад (по умолчанию — от типа бровей). */
  lidTilt?: number;
  brow: BrowKind;
  snout: { y: number; rx: number; ry: number };
  mouthY: number;
  mouthW: number;
  mouth: MouthKind;
  chin?: boolean;
  fang?: boolean;
  mustache?: boolean;
  crown?: boolean;
  /** Брыли — тяжёлые щёки по бокам (большой). */
  jowls?: boolean;
  /** Расширение тела книзу (0 — эллипс). */
  pear?: number;
  skin?: Skin;
  extent: number;
  outBase: number;
  freckles: ReadonlyArray<readonly [number, number, number, number]>;
}

/** Веснушки (02 §7): три штуки, еле заметные. */
const FRECKLES: ReadonlyArray<readonly [number, number, number, number]> = [
  [-0.3, -0.55, 0.07, 0.05],
  [0.25, -0.62, 0.06, 0.04],
  [0.62, 0.2, 0.05, 0.04],
];

const PIG_SPECS: Record<PigType, PigSpec> = {
  small: {
    rx: 1,
    ry: 0.94,
    cy: 0.06,
    ear: { x: 0.5, y: -0.74, r: 0.27 },
    eye: { x: 0.36, y: -0.24, rx: 0.26, ry: 0.29 },
    pupilR: 0.105,
    smug: 0,
    brow: 'none',
    snout: { y: 0.19, rx: 0.34, ry: 0.25 },
    mouthY: 0.56,
    mouthW: 0.36,
    mouth: 'smile',
    extent: 1.24,
    outBase: 0.075,
    freckles: FRECKLES,
  },
  medium: {
    rx: 1,
    ry: 0.96,
    cy: 0.04,
    ear: { x: 0.54, y: -0.78, r: 0.22 },
    eye: { x: 0.37, y: -0.24, rx: 0.2, ry: 0.22 },
    pupilR: 0.085,
    smug: 0.08,
    brow: 'short',
    snout: { y: 0.13, rx: 0.38, ry: 0.28 },
    mouthY: 0.54,
    mouthW: 0.42,
    mouth: 'smirk',
    extent: 1.24,
    outBase: 0.075,
    freckles: FRECKLES,
  },
  large: {
    rx: 0.97,
    ry: 0.94,
    cy: 0.06,
    ear: { x: 0.6, y: -0.74, r: 0.2 },
    eye: { x: 0.38, y: -0.26, rx: 0.16, ry: 0.18 },
    pupilR: 0.07,
    smug: 0.12,
    brow: 'heavy',
    snout: { y: 0.1, rx: 0.42, ry: 0.31 },
    mouthY: 0.52,
    mouthW: 0.5,
    mouth: 'grin',
    chin: true,
    fang: true,
    jowls: true,
    pear: 0.05,
    extent: 1.26,
    outBase: 0.075,
    freckles: FRECKLES,
  },
  helmet: {
    rx: 1,
    ry: 0.96,
    cy: 0.04,
    ear: { x: 0.55, y: -0.78, r: 0.21 },
    eye: { x: 0.36, y: -0.03, rx: 0.19, ry: 0.21 },
    pupilR: 0.08,
    // злость под каской передаётся веками: брови спрятаны под полями
    smug: 0.22,
    lidTilt: 0.45,
    brow: 'stern',
    snout: { y: 0.22, rx: 0.37, ry: 0.27 },
    mouthY: 0.6,
    mouthW: 0.36,
    mouth: 'smile',
    extent: 1.34,
    outBase: 0.075,
    freckles: FRECKLES,
  },
  mustache: {
    rx: 1,
    ry: 0.96,
    cy: 0.04,
    ear: { x: 0.56, y: -0.77, r: 0.21 },
    eye: { x: 0.35, y: -0.28, rx: 0.18, ry: 0.2 },
    pupilR: 0.078,
    smug: 0.1,
    brow: 'bushy',
    snout: { y: 0.08, rx: 0.37, ry: 0.27 },
    mouthY: 0.6,
    mouthW: 0.34,
    mouth: 'hidden',
    mustache: true,
    extent: 1.26,
    outBase: 0.075,
    freckles: FRECKLES,
  },
  king: {
    rx: 1,
    ry: 0.96,
    cy: 0.04,
    ear: { x: 0.6, y: -0.72, r: 0.19 },
    eye: { x: 0.34, y: -0.26, rx: 0.19, ry: 0.21 },
    pupilR: 0.078,
    smug: 0.4,
    brow: 'royal',
    snout: { y: 0.11, rx: 0.46, ry: 0.31 },
    mouthY: 0.54,
    mouthW: 0.44,
    mouth: 'smirk',
    crown: true,
    chin: true,
    skin: KING_SKIN,
    extent: 1.66,
    outBase: 0.068,
    freckles: FRECKLES,
  },
};

// ───────────────────────── тело ─────────────────────────

/** Контур тела (= физический круг; повреждения рисуются только внутри). pear > 0 — тело шире книзу. */
function bodyPathFn(s: PigSpec) {
  const pear = s.pear ?? 0;
  if (pear <= 0) return (c: C) => ellipsePath(c, 0, s.cy, s.rx, s.ry);
  return (c: C) => {
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * TAU;
      const sn = Math.sin(t);
      const x = s.rx * (1 + pear * sn) * Math.cos(t);
      const y = s.cy + s.ry * sn;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  };
}

/** Шишка на макушке между ушами (стадия 2). */
const BUMP = { x: -0.26, y: -0.9, r: 0.16 };

/**
 * Ухо-капля: круглое основание радиуса r, скруглённый кончик на высоте h·r.
 * rot > 0 — кончик наклонён вправо (наружу у правого уха).
 */
function dropPath(c: C, x: number, y: number, r: number, rot: number, h = 1.15): void {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const T = (px: number, py: number): [number, number] => [x + px * cs - py * sn, y + px * sn + py * cs];
  const a = T(-r, 0);
  const b = T(r, 0);
  const tip = T(0, -h * r);
  // кончик мягкий: касательные почти горизонтальны (угол ~150°) — не кошачье ухо
  const r1 = T(r, -0.52 * r);
  const r2 = T(0.34 * r, -0.94 * h * r);
  const l2 = T(-0.34 * r, -0.94 * h * r);
  const l1 = T(-r, -0.52 * r);
  c.moveTo(a[0], a[1]);
  // нижняя половина: π → 0 через низ
  c.ellipse(x, y, r, r * 0.96, rot, Math.PI, 0, true);
  c.lineTo(b[0], b[1]);
  c.bezierCurveTo(r1[0], r1[1], r2[0], r2[1], tip[0], tip[1]);
  c.bezierCurveTo(l2[0], l2[1], l1[0], l1[1], a[0], a[1]);
  c.closePath();
}

function earPath(s: PigSpec, side: number) {
  return (c: C) => dropPath(c, side * s.ear.x, s.ear.y, s.ear.r, side * 0.5);
}

function drawEar(c: C, u: Units, s: PigSpec, side: number): void {
  const { x, y, r } = s.ear;
  const sk = s.skin ?? SKIN;
  const ex = side * x;
  const g = c.createRadialGradient(ex - r * 0.4, y - r * 0.5, r * 0.1, ex, y, r * 1.1);
  g.addColorStop(0, sk.light);
  g.addColorStop(0.6, sk.ear);
  g.addColorStop(1, sk.dark);
  c.beginPath();
  earPath(s, side)(c);
  c.fillStyle = g;
  c.fill();
  // внутренняя часть уха
  const ig = c.createRadialGradient(ex, y + r * 0.1, 0, ex, y + r * 0.1, r * 0.6);
  ig.addColorStop(0, mix(P.earIn, '#000000', 0.15));
  ig.addColorStop(1, P.earIn);
  c.beginPath();
  dropPath(c, ex + side * 0.01, y + r * 0.08, r * 0.52, side * 0.5, 1.2);
  c.fillStyle = ig;
  c.fill();
  if (u.lod > 0) softBlob(c, ex - r * 0.35, y - r * 0.45, r * 0.3, r * 0.18, '#ffffff', 0.45, -0.5);
}

// ───────────────────────── лицо ─────────────────────────

/** Геометрия глаза i (0 — левый). На lod 0 глаза крупнее — иначе свинья «слепнет». */
function eyePos(s: PigSpec, i: number, scared: boolean, u: Units) {
  const side = i === 0 ? -1 : 1;
  const k = (scared ? 1.2 : 1) * (u.lod === 0 ? 1.18 : 1);
  return { x: side * s.eye.x, y: s.eye.y - (scared ? 0.02 : 0), rx: s.eye.rx * k, ry: s.eye.ry * k, side };
}

function drawBrows(c: C, u: Units, s: PigSpec, pose: PigPose): void {
  if (s.brow === 'none') {
    if (pose === 'scared') {
      // маленькие испуганные бровки
      for (const i of [0, 1]) {
        const e = eyePos(s, i, true, u);
        const side = e.side;
        browStroke(c, u, e.x - side * 0.14, e.y - e.ry - 0.08, e.x + side * 0.12, e.y - e.ry - 0.14, 0.05, 0.05, 0.02, P.outline, null);
      }
    }
    return;
  }
  const scared = pose === 'scared';
  const laugh = pose === 'laugh';
  for (const i of [0, 1]) {
    const e = eyePos(s, i, scared, u);
    const side = e.side; // −1 левый, +1 правый
    const top = e.y - e.ry;
    // внутренний конец (к центру лица) и наружный
    let ix = e.x - side * e.rx * 0.95;
    let ox = e.x + side * e.rx * 1.15;
    let iy = top - 0.04;
    let oy = top - 0.1;
    let th = 0.07;
    let color = '#2C4F14';
    switch (s.brow) {
      case 'short':
        iy = top - 0.02;
        oy = top - 0.1;
        th = 0.075;
        break;
      case 'heavy':
        iy = top + 0.03;
        oy = top - 0.1;
        th = 0.1;
        ix = e.x - side * e.rx * 1.05;
        ox = e.x + side * e.rx * 1.4;
        break;
      case 'stern':
        iy = top + 0.04;
        oy = top - 0.1;
        th = 0.1;
        break;
      case 'royal':
        // надменно: внутренние концы к переносице, левая бровь приподнята
        iy = top - 0.01 - (i === 0 ? 0.05 : 0);
        oy = top - 0.12 - (i === 0 ? 0.07 : 0);
        th = 0.075;
        color = '#25440F';
        break;
      case 'bushy':
        break;
    }
    if (scared) {
      iy = top - 0.18;
      oy = top - 0.1;
    } else if (laugh) {
      iy -= 0.06;
      oy -= 0.04;
    }
    if (s.brow === 'bushy') {
      bushyBrow(c, u, ox + side * 0.04, oy + 0.02, ix, iy + 0.02);
      continue;
    }
    browStroke(c, u, ox, oy, ix, iy, th * 0.9, th * 1.1, s.brow === 'royal' ? 0.02 : 0.01, color, 'rgba(255,255,255,0.2)');
  }
}

/** Кустистая бровь: ровный низ, «зубчатый» верх из трёх завитков, кончик торчит наружу. */
function bushyBrow(c: C, u: Units, ox: number, oy: number, ix: number, iy: number): void {
  const dx = ix - ox;
  const dy = iy - oy;
  const L = Math.hypot(dx, dy) || 1;
  const tx = dx / L;
  const ty = dy / L;
  let nx = ty;
  let ny = -tx;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const th = 0.15;
  const P2 = (t: number, h: number): [number, number] => [ox + dx * t + nx * h, oy + dy * t + ny * h];
  const path = (cc: C) => {
    const a = P2(-0.08, th * 0.75);
    cc.moveTo(a[0], a[1]);
    const b = P2(0.02, -0.01);
    cc.quadraticCurveTo(P2(0.0, th * 0.2)[0], P2(0.0, th * 0.2)[1], b[0], b[1]);
    const d = P2(1.0, 0.0);
    const m = P2(0.5, -0.05);
    cc.quadraticCurveTo(m[0], m[1], d[0], d[1]);
    const e = P2(1.02, th * 0.75);
    cc.quadraticCurveTo(P2(1.08, th * 0.35)[0], P2(1.08, th * 0.35)[1], e[0], e[1]);
    // три завитка по верху (от внутреннего конца к наружному)
    const bumps = [
      [0.78, th * 1.25, 0.66, th * 0.95],
      [0.46, th * 1.35, 0.34, th * 1.0],
      [0.16, th * 1.3, -0.08, th * 0.75],
    ];
    for (const [ct, ch, et, eh] of bumps) {
      const q = P2(ct, ch);
      const r = P2(et, eh);
      cc.quadraticCurveTo(q[0], q[1], r[0], r[1]);
    }
    cc.closePath();
  };
  const g = c.createLinearGradient(ox + nx * th, oy + ny * th, ox, oy);
  g.addColorStop(0, '#E09A50');
  g.addColorStop(0.5, '#B0601E');
  g.addColorStop(1, '#7A3C0C');
  c.beginPath();
  path(c);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = '#4A2306';
  c.lineWidth = lw(u, 0.035, 0.9);
  c.stroke();
  if (u.lod > 0) {
    c.strokeStyle = 'rgba(255,220,160,0.55)';
    c.lineWidth = lw(u, 0.016, 0.6);
    for (const t of [0.3, 0.6]) {
      const a = P2(t - 0.12, th * 0.25);
      const b = P2(t + 0.05, th * 0.8);
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(b[0], b[1]);
      c.stroke();
    }
  }
}

function drawSnout(c: C, u: Units, s: PigSpec): void {
  const { y, rx, ry } = s.snout;
  const sg = c.createRadialGradient(-rx * 0.3, y - ry * 0.45, ry * 0.05, 0, y, rx * 1.05);
  sg.addColorStop(0, P.snoutHi);
  sg.addColorStop(0.55, P.snout);
  sg.addColorStop(1, P.snoutLo);
  c.save();
  if (u.lod > 0) {
    c.shadowColor = 'rgba(20,60,0,0.35)';
    c.shadowBlur = Math.max(0.5, 0.08 * u.k);
    c.shadowOffsetY = 0.04 * u.k;
  }
  c.beginPath();
  ellipsePath(c, 0, y, rx, ry);
  c.fillStyle = sg;
  c.fill();
  c.restore();
  c.beginPath();
  ellipsePath(c, 0, y, rx, ry);
  c.strokeStyle = P.snoutLine;
  c.lineWidth = lw(u, 0.045, 1);
  c.stroke();
  // ноздри
  for (const side of [-1, 1]) {
    const nx = side * rx * 0.38;
    const ng = c.createLinearGradient(0, y - ry * 0.4, 0, y + ry * 0.4);
    ng.addColorStop(0, '#0F2205');
    ng.addColorStop(1, P.nostril);
    c.beginPath();
    ellipsePath(c, nx, y + 0.01, rx * 0.19, ry * 0.4, side * 0.08);
    c.fillStyle = ng;
    c.fill();
    if (u.lod > 0) {
      // светлая кромка снизу ноздри
      c.beginPath();
      c.ellipse(nx, y + 0.01, rx * 0.19, ry * 0.4, side * 0.08, 0.15 * Math.PI, 0.85 * Math.PI);
      c.strokeStyle = 'rgba(214,242,162,0.7)';
      c.lineWidth = lw(u, 0.02, 0.7);
      c.stroke();
    }
  }
  // блик на пятачке
  if (u.lod > 0) softBlob(c, -rx * 0.35, y - ry * 0.55, rx * 0.32, ry * 0.18, '#ffffff', 0.6, -0.15, 0.5);
}

/** Ряд верхних зубов: два передних, при stage 2 — левый выбит. */
function drawTeeth(c: C, u: Units, x0: number, y0: number, w: number, h: number, missing: boolean): void {
  const tw = w * 0.5;
  for (const k of [0, 1]) {
    if (missing && k === 0) continue;
    const tx = x0 + (k - 1) * tw + tw * 0.06;
    c.beginPath();
    c.moveTo(tx, y0 - 0.01);
    c.lineTo(tx + tw * 0.88, y0 - 0.01);
    c.lineTo(tx + tw * 0.88, y0 + h * 0.75);
    c.quadraticCurveTo(tx + tw * 0.88, y0 + h, tx + tw * 0.6, y0 + h);
    c.lineTo(tx + tw * 0.28, y0 + h);
    c.quadraticCurveTo(tx, y0 + h, tx, y0 + h * 0.75);
    c.closePath();
    c.fillStyle = P.tooth;
    c.fill();
    c.strokeStyle = 'rgba(80,60,30,0.6)';
    c.lineWidth = lw(u, 0.015, 0.6);
    c.stroke();
  }
}

function drawMouth(c: C, u: Units, s: PigSpec, pose: PigPose, stage: number): void {
  const y = s.mouthY;
  // на lod 0 рот шире и толще — иначе линия в 1 px теряется
  const w = (s.mouthW / 2) * (u.lod === 0 ? 1.2 : 1);
  const lineW = lw(u, 0.045, u.lod === 0 ? 1.5 : 1.1);
  // кривой рот и выбитый зуб — только на крупном плане (на мелких размерах это каша)
  const broken = stage >= 2 && u.lod === 2;
  c.strokeStyle = P.mouth;
  c.lineWidth = lineW;
  if (pose === 'laugh') {
    // открытый D-рот: зубы сверху, язык снизу
    const top = y - 0.08;
    const mw = Math.max(w * 1.3, 0.28);
    const depth = 0.44;
    const path = (cc: C) => {
      cc.moveTo(-mw, top);
      cc.quadraticCurveTo(0, top + 0.07, mw, top);
      cc.quadraticCurveTo(mw * 0.95, top + depth * 0.95, 0, top + depth);
      cc.quadraticCurveTo(-mw * 0.95, top + depth * 0.95, -mw, top);
      cc.closePath();
    };
    c.beginPath();
    path(c);
    c.fillStyle = P.mouth;
    c.fill();
    c.save();
    c.beginPath();
    path(c);
    c.clip();
    const tg = c.createRadialGradient(0, top + depth, 0, 0, top + depth, mw * 0.8);
    tg.addColorStop(0, '#F07C88');
    tg.addColorStop(1, '#C2414F');
    c.beginPath();
    ellipsePath(c, 0.03, top + depth * 0.98, mw * 0.62, 0.17);
    c.fillStyle = tg;
    c.fill();
    drawTeeth(c, u, 0, top + 0.025, mw * 0.6, 0.11, broken);
    c.restore();
    c.beginPath();
    path(c);
    c.strokeStyle = P.mouth;
    c.lineWidth = lineW;
    c.stroke();
    return;
  }
  if (pose === 'scared') {
    // рот «о»
    const oy = s.mouth === 'hidden' ? y + 0.06 : y + 0.02;
    c.beginPath();
    ellipsePath(c, 0, oy, 0.1, 0.13);
    c.fillStyle = P.mouth;
    c.fill();
    c.save();
    c.beginPath();
    ellipsePath(c, 0, oy, 0.1, 0.13);
    c.clip();
    c.beginPath();
    ellipsePath(c, 0.01, oy + 0.11, 0.08, 0.06);
    c.fillStyle = '#D25463';
    c.fill();
    c.restore();
    c.beginPath();
    ellipsePath(c, 0, oy, 0.1, 0.13);
    c.stroke();
    return;
  }
  if (s.mouth === 'hidden') return;
  if (broken) {
    // кривой рот с выбитым зубом
    const path = (cc: C) => {
      cc.moveTo(-w, y - 0.02);
      cc.quadraticCurveTo(-w * 0.3, y + 0.04, 0.0, y + 0.0);
      cc.quadraticCurveTo(w * 0.5, y - 0.04, w, y + 0.02);
      cc.quadraticCurveTo(w * 0.4, y + 0.16, -w * 0.1, y + 0.13);
      cc.quadraticCurveTo(-w * 0.7, y + 0.12, -w, y - 0.02);
      cc.closePath();
    };
    c.beginPath();
    path(c);
    c.fillStyle = P.mouth;
    c.fill();
    c.save();
    c.beginPath();
    path(c);
    c.clip();
    drawTeeth(c, u, w * 0.15, y - 0.04, w * 0.7, 0.1, true);
    c.restore();
    c.beginPath();
    path(c);
    c.stroke();
    return;
  }
  // улыбка/ухмылка
  c.beginPath();
  if (s.mouth === 'smirk') {
    c.moveTo(-w, y - 0.01);
    c.quadraticCurveTo(-w * 0.1, y + 0.1, w, y - 0.08);
  } else if (s.mouth === 'grin') {
    c.moveTo(-w, y - 0.04);
    c.quadraticCurveTo(0, y + 0.12, w, y - 0.04);
  } else {
    c.moveTo(-w, y - 0.02);
    c.quadraticCurveTo(0, y + 0.08, w, y - 0.02);
  }
  c.stroke();
  // уголки рта
  if (u.lod > 0) {
    c.lineWidth = lw(u, 0.03, 0.8);
    c.beginPath();
    const ry = s.mouth === 'smirk' ? -0.08 : s.mouth === 'grin' ? -0.04 : -0.02;
    const ly = s.mouth === 'smirk' ? -0.01 : ry;
    c.moveTo(-w - 0.03, y + ly - 0.04);
    c.quadraticCurveTo(-w - 0.01, y + ly + 0.01, -w + 0.03, y + ly + 0.01);
    c.moveTo(w + 0.03, y + ry - 0.04);
    c.quadraticCurveTo(w + 0.01, y + ry + 0.01, w - 0.03, y + ry + 0.01);
    c.stroke();
  }
}

function drawMustache(c: C, u: Units, s: PigSpec): void {
  const y = s.snout.y + s.snout.ry + 0.02;
  const half = (cc: C, side: number) => {
    const X = (x: number) => side * x;
    cc.moveTo(X(0), y - 0.04);
    cc.bezierCurveTo(X(0.2), y - 0.1, X(0.5), y - 0.06, X(0.66), y - 0.02);
    // закрученный кончик
    cc.bezierCurveTo(X(0.8), y + 0.0, X(0.86), y - 0.14, X(0.76), y - 0.2);
    cc.bezierCurveTo(X(0.92), y - 0.16, X(0.94), y + 0.08, X(0.76), y + 0.12);
    // нижняя кромка — «лепестки»
    cc.quadraticCurveTo(X(0.62), y + 0.2, X(0.48), y + 0.13);
    cc.quadraticCurveTo(X(0.36), y + 0.24, X(0.22), y + 0.15);
    cc.quadraticCurveTo(X(0.1), y + 0.22, X(0), y + 0.12);
    cc.closePath();
  };
  outlinePass(c, { ...u, out: lw(u, 0.045, 1) / 2 + 0.005 }, '#4A2306', [(cc) => half(cc, -1), (cc) => half(cc, 1)]);
  for (const side of [-1, 1]) {
    const g = c.createLinearGradient(0, y - 0.15, 0, y + 0.22);
    g.addColorStop(0, '#E39A4C');
    g.addColorStop(0.5, '#B8661F');
    g.addColorStop(1, '#7E3F0C');
    c.beginPath();
    half(c, side);
    c.fillStyle = g;
    c.fill();
    if (u.lod > 0) {
      c.strokeStyle = 'rgba(255,214,150,0.55)';
      c.lineWidth = lw(u, 0.018, 0.6);
      for (const k of [0.25, 0.42, 0.58]) {
        c.beginPath();
        c.moveTo(side * k * 0.4, y - 0.02);
        c.quadraticCurveTo(side * k, y - 0.04, side * (k + 0.16), y + 0.04);
        c.stroke();
      }
    }
  }
}

function drawCrown(c: C, u: Units): void {
  // корона чуть набекрень
  c.save();
  c.translate(0.04, -0.9);
  c.rotate(-0.08);
  const crownPath = (cc: C) => {
    cc.moveTo(-0.5, 0.1);
    cc.lineTo(-0.56, -0.36);
    cc.lineTo(-0.32, -0.16);
    cc.lineTo(-0.2, -0.5);
    cc.lineTo(0, -0.24);
    cc.lineTo(0.0, -0.24);
    cc.lineTo(0.2, -0.5);
    cc.lineTo(0.32, -0.16);
    cc.lineTo(0.56, -0.36);
    cc.lineTo(0.5, 0.1);
    cc.quadraticCurveTo(0, 0.2, -0.5, 0.1);
    cc.closePath();
  };
  const centerSpike = (cc: C) => {
    cc.moveTo(-0.13, -0.2);
    cc.lineTo(0, -0.66);
    cc.lineTo(0.13, -0.2);
    cc.closePath();
  };
  const balls: Array<[number, number, number]> = [
    [-0.56, -0.38, 0.055],
    [-0.2, -0.52, 0.06],
    [0, -0.69, 0.07],
    [0.2, -0.52, 0.06],
    [0.56, -0.38, 0.055],
  ];
  c.strokeStyle = '#5E3F02';
  c.lineWidth = lw(u, 0.12, 2);
  c.beginPath();
  crownPath(c);
  centerSpike(c);
  c.stroke();
  for (const [x, y, r] of balls) {
    c.beginPath();
    circlePath(c, x, y, r);
    c.stroke();
  }
  const g = c.createLinearGradient(-0.5, -0.6, 0.4, 0.2);
  g.addColorStop(0, '#FFF3A8');
  g.addColorStop(0.45, '#F6C619');
  g.addColorStop(1, '#B07A06');
  c.fillStyle = g;
  c.beginPath();
  centerSpike(c);
  c.fill();
  c.beginPath();
  crownPath(c);
  c.fill();
  // обруч
  c.save();
  c.beginPath();
  crownPath(c);
  c.clip();
  c.beginPath();
  c.moveTo(-0.6, -0.08);
  c.quadraticCurveTo(0, 0.02, 0.6, -0.08);
  c.lineTo(0.6, 0.3);
  c.lineTo(-0.6, 0.3);
  c.closePath();
  const bg = c.createLinearGradient(0, -0.08, 0, 0.18);
  bg.addColorStop(0, '#E8B010');
  bg.addColorStop(1, '#A06C04');
  c.fillStyle = bg;
  c.fill();
  c.beginPath();
  c.moveTo(-0.6, -0.08);
  c.quadraticCurveTo(0, 0.02, 0.6, -0.08);
  c.strokeStyle = 'rgba(255,240,160,0.8)';
  c.lineWidth = lw(u, 0.025, 0.7);
  c.stroke();
  c.restore();
  for (const [x, y, r] of balls) {
    const bgr = c.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r);
    bgr.addColorStop(0, '#FFFBE0');
    bgr.addColorStop(1, '#E0A810');
    c.beginPath();
    circlePath(c, x, y, r);
    c.fillStyle = bgr;
    c.fill();
  }
  // камни
  const gems: Array<[number, number, number, string]> = [
    [0, 0.05, 0.075, '#E1264B'],
    [-0.32, 0.03, 0.055, '#2B7BE4'],
    [0.32, 0.03, 0.055, '#2CBF62'],
  ];
  for (const [x, y, r, col] of gems) {
    const gg = c.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r);
    gg.addColorStop(0, mix(col, '#ffffff', 0.55));
    gg.addColorStop(0.6, col);
    gg.addColorStop(1, mix(col, '#000000', 0.4));
    c.beginPath();
    circlePath(c, x, y, r);
    c.fillStyle = gg;
    c.fill();
    c.strokeStyle = '#5E3F02';
    c.lineWidth = lw(u, 0.022, 0.7);
    c.stroke();
  }
  if (u.lod > 0) {
    // блик на зубцах
    c.beginPath();
    c.moveTo(-0.44, -0.12);
    c.lineTo(-0.5, -0.3);
    c.strokeStyle = 'rgba(255,255,230,0.75)';
    c.lineWidth = lw(u, 0.035, 0.8);
    c.stroke();
    c.beginPath();
    c.moveTo(-0.17, -0.22);
    c.lineTo(-0.2, -0.4);
    c.stroke();
  }
  c.restore();
}

/** Стальная армейская каска (02 §7). stage 1 — вмятина, 2 — вмятина и трещина. */
function drawHelmet(c: C, u: Units, stage: number): void {
  const CY = -0.2;
  const RX = 1.02;
  const RY = 0.95;
  const CUT = -0.3;
  const da = Math.asin((CY - CUT) / RY);
  // лёгкий ракурс сверху: передний край полей и низ купола прогнуты вниз — каска сидит на голове, а не лежит крышкой
  const DIP = 0.045;
  const dome = (cc: C) => {
    cc.moveTo(-RX * Math.cos(da), CUT);
    cc.ellipse(0, CY, RX, RY, 0, Math.PI + da, TAU - da);
    cc.quadraticCurveTo(0, CUT + 2 * DIP, -RX * Math.cos(da), CUT);
    cc.closePath();
  };
  const BT = -0.36;
  const BB = -0.24;
  const BX = 1.1;
  const brim = (cc: C) => {
    cc.moveTo(-BX + 0.03, BT);
    cc.quadraticCurveTo(0, BT + 2 * DIP, BX - 0.03, BT);
    cc.quadraticCurveTo(BX + 0.07, (BT + BB) / 2, BX - 0.03, BB);
    cc.quadraticCurveTo(0, BB + 2 * (DIP + 0.012), -BX + 0.03, BB);
    cc.quadraticCurveTo(-BX - 0.07, (BT + BB) / 2, -BX + 0.03, BT);
    cc.closePath();
  };
  /** Середина полей по высоте в точке x (с учётом прогиба). */
  const brimMid = (x: number) => (BT + BB) / 2 + (DIP + 0.006) * (1 - (x / BX) ** 2);
  const LINE = '#2F363D';
  outlinePass(c, u, LINE, [dome, brim]);

  // купол: холодный металл, свет сверху-слева
  const dg = c.createRadialGradient(-0.4, -0.84, 0.03, -0.12, -0.5, 1.2);
  dg.addColorStop(0, '#F6F9FB');
  dg.addColorStop(0.2, '#E2E8EE');
  dg.addColorStop(0.58, '#A7B1BB');
  dg.addColorStop(1, '#6C7782');
  c.beginPath();
  dome(c);
  c.fillStyle = dg;
  c.fill();
  c.save();
  c.beginPath();
  dome(c);
  c.clip();
  // тень у основания купола и отражённый свет справа
  const sg = c.createLinearGradient(0, -0.62, 0, -0.28);
  sg.addColorStop(0, 'rgba(62,70,78,0)');
  sg.addColorStop(1, 'rgba(62,70,78,0.42)');
  c.fillStyle = sg;
  c.fillRect(-1.2, -0.62, 2.4, 0.4);
  if (u.lod > 0) softBlob(c, 0.66, -0.52, 0.2, 0.09, '#E2E8EE', 0.35, 1.0);
  if (stage >= 1) {
    // вмятина: тёмная чаша, свет ловит её нижне-правая стенка
    c.beginPath();
    ellipsePath(c, 0.35, -0.75, 0.16, 0.1, -0.25);
    c.fillStyle = rgba('#6C7782', 0.6);
    c.fill();
    if (u.lod > 0) {
      softBlob(c, 0.31, -0.78, 0.1, 0.05, '#3E464E', 0.35, -0.25);
      c.beginPath();
      c.ellipse(0.35, -0.75, 0.16, 0.1, -0.25, 0.1 * Math.PI, 0.85 * Math.PI);
      c.strokeStyle = 'rgba(255,255,255,0.6)';
      c.lineWidth = lw(u, 0.022, 0.7);
      c.stroke();
      // царапины
      c.beginPath();
      c.moveTo(-0.56, -0.6);
      c.lineTo(-0.36, -0.68);
      c.moveTo(-0.52, -0.54);
      c.lineTo(-0.4, -0.59);
      c.strokeStyle = 'rgba(80,90,100,0.55)';
      c.lineWidth = lw(u, 0.016, 0.6);
      c.stroke();
    }
  }
  if (stage >= 2) {
    // трещина-зигзаг из 5 сегментов со светлой кромкой
    const crack: Array<[number, number]> = [
      [-0.2, -1.2],
      [-0.08, -1.0],
      [-0.2, -0.86],
      [-0.06, -0.74],
      [-0.17, -0.6],
      [-0.07, -0.46],
    ];
    if (u.lod > 0) {
      c.beginPath();
      crack.forEach(([x, y], i) => (i === 0 ? c.moveTo(x + 0.025, y) : c.lineTo(x + 0.025, y)));
      c.strokeStyle = 'rgba(255,255,255,0.45)';
      c.lineWidth = lw(u, 0.02, 0.6);
      c.stroke();
    }
    c.beginPath();
    crack.forEach(([x, y], i) => (i === 0 ? c.moveTo(x, y) : c.lineTo(x, y)));
    c.strokeStyle = '#3E464E';
    c.lineWidth = lw(u, 0.04, 1);
    c.lineJoin = 'miter';
    c.stroke();
    c.lineJoin = 'round';
  }
  c.restore();
  // блик металла: резкий, вытянутый по куполу
  gloss(c, u, -0.44, -0.8, 0.28, 0.1, -0.72, 0.55);
  c.beginPath();
  dome(c);
  c.strokeStyle = LINE;
  c.lineWidth = lw(u, 0.03, 0.8);
  c.stroke();

  // поля (обод)
  const bg = c.createLinearGradient(0, BT, 0, BB + DIP);
  bg.addColorStop(0, '#C3CBD3');
  bg.addColorStop(0.45, '#8B96A1');
  bg.addColorStop(1, '#636E79');
  c.beginPath();
  brim(c);
  c.fillStyle = bg;
  c.fill();
  c.strokeStyle = LINE;
  c.lineWidth = lw(u, 0.03, 0.8);
  c.stroke();
  if (u.lod > 0) {
    c.beginPath();
    c.moveTo(-1.02, BT + 0.017);
    c.quadraticCurveTo(0, BT + 0.017 + 2 * DIP, 1.02, BT + 0.017);
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = lw(u, 0.016, 0.6);
    c.stroke();
  }
  // заклёпки
  for (const x of [-0.7, 0, 0.7]) {
    const y = brimMid(x);
    const rg = c.createRadialGradient(x - 0.014, y - 0.016, 0, x, y, 0.04);
    rg.addColorStop(0, '#FFFFFF');
    rg.addColorStop(0.5, '#D5DCE3');
    rg.addColorStop(1, '#8B96A1');
    c.beginPath();
    circlePath(c, x, y, 0.04);
    c.fillStyle = rg;
    c.fill();
    if (u.lod > 0) {
      c.strokeStyle = '#4A535C';
      c.lineWidth = lw(u, 0.012, 0.5);
      c.stroke();
    }
  }
}

/** Шишка на макушке: светлая, с бликом. */
function drawBump(c: C, u: Units): void {
  const { x, y, r } = BUMP;
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
  g.addColorStop(0, '#E2F7B8');
  g.addColorStop(0.55, P.bump);
  g.addColorStop(1, '#78B23A');
  c.beginPath();
  circlePath(c, x, y, r);
  c.fillStyle = g;
  c.fill();
  // тонкий контур отделяет шишку от соседнего уха (низ шишки закроет тело)
  c.strokeStyle = P.outline;
  c.lineWidth = lw(u, 0.035, 0.8);
  c.stroke();
  if (u.lod > 0) softBlob(c, x - r * 0.35, y - r * 0.42, r * 0.42, r * 0.26, '#ffffff', 0.9, -0.5, 0.5);
}

/** «Ой» над шишкой: две белые звёздочки с тёмной кромкой (только крупный план). */
function drawOuch(c: C, u: Units): void {
  const { x, y, r } = BUMP;
  const stars: Array<[number, number, number]> = [
    [x - 0.05, y - r - 0.13, 0.075],
    [x + r + 0.12, y - r * 0.55, 0.058],
  ];
  for (const [sx, sy, sz] of stars) {
    // четырёхлучевая искра с вогнутыми сторонами
    const k = sz * 0.16;
    c.beginPath();
    c.moveTo(sx, sy - sz);
    c.quadraticCurveTo(sx + k, sy - k, sx + sz, sy);
    c.quadraticCurveTo(sx + k, sy + k, sx, sy + sz);
    c.quadraticCurveTo(sx - k, sy + k, sx - sz, sy);
    c.quadraticCurveTo(sx - k, sy - k, sx, sy - sz);
    c.closePath();
    c.strokeStyle = P.outline;
    c.lineWidth = lw(u, 0.04, 1.4);
    c.stroke();
    c.fillStyle = '#FFFFFF';
    c.fill();
  }
}

/** Брыли большого: складки от пятачка вниз, объём щёк, тень под ними. */
function drawJowls(c: C, u: Units, sk: Skin): void {
  for (const side of [-1, 1]) {
    softBlob(c, side * 0.7, 0.34, 0.22, 0.15, '#ffffff', 0.14, 0, 0.5);
    softBlob(c, side * 0.62, 0.66, 0.26, 0.1, sk.shadow, 0.2, side * -0.3, 0.5);
    c.beginPath();
    c.moveTo(side * 0.46, 0.06);
    c.quadraticCurveTo(side * 0.48, 0.42, side * 0.82, 0.56);
    c.strokeStyle = 'rgba(40,86,10,0.45)';
    c.lineWidth = lw(u, 0.035, 0.8);
    c.stroke();
  }
}

function drawSweat(c: C, u: Units, x: number, y: number, size: number): void {
  const path = (cc: C) => {
    cc.moveTo(x, y - size);
    cc.bezierCurveTo(x + size * 0.25, y - size * 0.4, x + size * 0.62, y + size * 0.05, x + size * 0.5, y + size * 0.42);
    cc.bezierCurveTo(x + size * 0.35, y + size * 0.82, x - size * 0.35, y + size * 0.82, x - size * 0.5, y + size * 0.42);
    cc.bezierCurveTo(x - size * 0.62, y + size * 0.05, x - size * 0.25, y - size * 0.4, x, y - size);
    cc.closePath();
  };
  const g = c.createLinearGradient(x, y - size, x, y + size);
  g.addColorStop(0, '#E4F8FF');
  g.addColorStop(1, '#6FC6F2');
  c.beginPath();
  path(c);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = '#2B78A8';
  c.lineWidth = lw(u, 0.03, 0.8);
  c.stroke();
  c.beginPath();
  ellipsePath(c, x - size * 0.18, y + size * 0.25, size * 0.12, size * 0.22, 0.3);
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fill();
}

function drawBandAid(c: C, u: Units, x: number, y: number, rot: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  const strip = (cc: C) => {
    cc.moveTo(-0.24, -0.075);
    cc.lineTo(0.24, -0.075);
    cc.quadraticCurveTo(0.3, 0, 0.24, 0.075);
    cc.lineTo(-0.24, 0.075);
    cc.quadraticCurveTo(-0.3, 0, -0.24, -0.075);
    cc.closePath();
  };
  for (const a of [0.6, -0.6]) {
    c.save();
    c.rotate(a);
    c.beginPath();
    strip(c);
    c.fillStyle = '#F2D2A8';
    c.fill();
    c.strokeStyle = '#9C7448';
    c.lineWidth = lw(u, 0.022, 0.7);
    c.stroke();
    c.beginPath();
    c.rect(-0.07, -0.06, 0.14, 0.12);
    c.fillStyle = '#E2B888';
    c.fill();
    if (u.lod > 1) {
      c.fillStyle = 'rgba(156,116,72,0.6)';
      for (const dx of [-0.17, 0.13]) {
        c.beginPath();
        circlePath(c, dx, -0.02, 0.012);
        circlePath(c, dx + 0.04, 0.025, 0.012);
        c.fill();
      }
    }
    c.restore();
  }
  c.restore();
}

// ───────────────────────── сборка ─────────────────────────

/** Фингал: мягкая фиолетовая тень за глазом + сужающийся полумесяц только снизу (не кольцо — иначе «монокль»). */
function drawBlackEye(c: C, e: { x: number; y: number; rx: number; ry: number }): void {
  // плотная зона (hard 0.8) приходится на кольцо вокруг белка — иначе видна лишь полупрозрачная серая кромка
  softBlob(c, e.x, e.y + 0.04, e.rx + 0.12, e.ry + 0.1, P.blackEyeSoft, 0.8, 0, 0.8);
  const N = 18;
  const a0 = 20 * DEG;
  const a1 = 160 * DEG;
  const irx = e.rx + 0.015;
  const iry = e.ry + 0.015;
  const at = (t: number, d: number): [number, number] => {
    const a = a0 + (a1 - a0) * t;
    return [e.x + Math.cos(a) * (irx + d), e.y + 0.01 + Math.sin(a) * (iry + d)];
  };
  c.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // ширина 0 на концах, 0.06 внизу
    const p = at(t, 0.06 * Math.sin(Math.PI * t));
    if (i === 0) c.moveTo(p[0], p[1]);
    else c.lineTo(p[0], p[1]);
  }
  for (let i = N; i >= 0; i--) {
    const p = at(i / N, 0);
    c.lineTo(p[0], p[1]);
  }
  c.closePath();
  c.fillStyle = rgba(P.blackEye, 0.85);
  c.fill();
}

function drawPig(c: C, u: Units, s: PigSpec, pose: PigPose, stage: number, helmet: boolean): void {
  const sk = s.skin ?? SKIN;
  const body = bodyPathFn(s);
  const showEars = !helmet;
  // каска забирает урон на себя: пока она надета, лицу — не больше стадии 1
  const face = helmet ? Math.min(stage, 1) : stage;
  const bump = face >= 2 && !helmet && !s.crown;
  // на мелких размерах (lod ≤ 1) стадия 2 — только фингал, пластырь и шишка; мелочь — на крупном плане
  const full = u.lod === 2;
  const shadeP: BodyShade = { light: sk.light, base: sk.base, dark: sk.dark, shadow: sk.shadow, bounce: P.bounce, rim: 0.3, cx: 0, cy: s.cy, R: 1 };

  // ── проход 1: обводка силуэта
  const sil: Array<(c: C) => void> = [];
  if (showEars) sil.push(earPath(s, -1), earPath(s, 1));
  if (bump) sil.push((cc) => circlePath(cc, BUMP.x, BUMP.y, BUMP.r));
  sil.push(body);
  outlinePass(c, u, P.outline, sil);

  // ── уши и шишка (позади тела)
  if (showEars) {
    drawEar(c, u, s, -1);
    drawEar(c, u, s, 1);
  }
  if (bump) drawBump(c, u);

  // ── тело
  shadeBody(c, u, body, shadeP, (cc) => {
    if (u.lod === 2) {
      for (const [x, y, rx, ry] of s.freckles) softBlob(cc, x, y, rx, ry, P.freckle, 0.16, 0, 0.6);
    }
    if (s.jowls) drawJowls(cc, u, sk);
    if (s.chin) {
      // второй подбородок: мягкая складка-тень и подсвеченный валик под ней (без линии — иначе «второй рот»)
      softBlob(cc, 0, 0.8, 0.38, 0.06, sk.shadow, 0.25);
      softBlob(cc, 0, 0.88, 0.42, 0.09, '#ffffff', 0.2);
    }
    // падающие тени от короны и полей каски — иначе убор «наклеен»
    if (s.crown) softBlob(cc, 0.04, -0.8, 0.5, 0.09, sk.shadow, 0.35);
    if (helmet) softBlob(cc, 0, -0.17, 0.95, 0.12, '#1E3A0A', 0.35);
  });
  // урон — поверх собственной тени тела, иначе синяк в затенённой щеке уходит в серую грязь
  const bruise = face === 1 || (face >= 2 && full);
  const scratches = (face === 1 && u.lod > 0) || (face >= 2 && full);
  if (bruise || scratches) {
    c.save();
    c.beginPath();
    body(c);
    c.clip();
    if (bruise) {
      // стадия 1: синяк на щеке (на стадии 2 его закрывает пластырь; на мелких размерах не рисуем)
      // фиолетовый на зелёном при α < 0.8 смешивается в серый — поэтому ореол + плотное насыщенное ядро
      softBlob(c, 0.58, 0.28, 0.24, 0.17, P.bruise, 0.5, 0.2, 0.55);
      softBlob(c, 0.58, 0.29, 0.16, 0.11, P.bruiseCore, 0.88, 0.2, 0.5);
      // припухлость
      softBlob(c, 0.52, 0.22, 0.1, 0.06, '#ffffff', 0.18, 0.2, 0.5);
    }
    if (scratches) {
      // две царапины на лбу: крутые, «следы когтей» — не путаются с бровями
      c.strokeStyle = P.scratch;
      c.lineWidth = lw(u, 0.035, 1);
      c.beginPath();
      c.moveTo(0.04, -0.8);
      c.lineTo(0.13, -0.62);
      c.moveTo(0.14, -0.82);
      c.lineTo(0.23, -0.64);
      c.stroke();
    }
    c.restore();
  }
  if (helmet) gloss(c, u, -0.62, -0.06, 0.16, 0.09, -0.9, 0.45);
  else gloss(c, u, -0.46, -0.5, 0.24, 0.13, -0.62, 0.5);

  // ── глаза
  const scared = pose === 'scared';
  for (const i of [0, 1]) {
    const e = eyePos(s, i, scared, u);
    // стадия 2 — фингал только у левого глаза
    const blackEye = face >= 2 && i === 0;
    if (blackEye) drawBlackEye(c, e);
    if (pose === 'laugh') {
      // глаза «^ ^» и слёзы смеха
      c.beginPath();
      c.moveTo(e.x - e.rx * 0.95, e.y + 0.06);
      c.quadraticCurveTo(e.x, e.y - e.ry * 1.05, e.x + e.rx * 0.95, e.y + 0.06);
      c.strokeStyle = '#14280A';
      c.lineWidth = lw(u, 0.075, 1.3);
      c.stroke();
      if (u.lod > 1) {
        const tx = e.x + e.side * e.rx * 1.05;
        softBlob(c, tx, e.y + 0.14, 0.05, 0.07, '#BFEFFF', 0.95, 0, 0.7);
      }
      continue;
    }
    const smug = scared ? 0 : s.smug;
    // стадия 1 — правый глаз прищурен, стадия 2 — левое (подбитое) веко 0.45
    let lid = smug;
    if (blackEye) lid = Math.max(lid, 0.45);
    else if (i === 1 && (face === 1 || (face >= 2 && full))) lid = smug + 0.2;
    const stern = s.brow === 'stern' || s.brow === 'heavy' ? 0.28 : s.brow === 'short' ? 0.16 : 0.06;
    drawEye(c, u, {
      x: e.x,
      y: e.y,
      rx: e.rx,
      ry: e.ry,
      inner: -e.side,
      mode: pose === 'blink' ? 'closed' : 'open',
      lid: Math.min(0.8, lid),
      lidTilt: scared ? -0.15 : (s.lidTilt ?? (s.smug > 0.3 ? 0.0 : stern)),
      pupilR: s.pupilR * (scared ? 0.62 : 1) * (u.lod === 0 ? 1.3 : 1),
      lookX: scared ? -0.1 : -0.35,
      lookY: scared ? 0 : 0.12,
      lidLight: blackEye ? mix(P.lidLight, '#9C88BC', 0.45) : P.lidLight,
      lidBase: blackEye ? mix(P.lidBase, '#6F5C92', 0.45) : P.lidBase,
      line: P.eyeLine,
      lineW: 0.038,
      shade: '#C3D6C0',
    });
  }

  // под каской брови спрятаны полями — злость передают веки
  if (!helmet) drawBrows(c, u, s, pose);
  drawSnout(c, u, s);
  drawMouth(c, u, s, pose, face);
  if (s.fang && pose !== 'laugh' && pose !== 'scared') {
    // клык из-под губы
    const fx = 0.16;
    const fy = s.mouthY + 0.03;
    c.beginPath();
    c.moveTo(fx - 0.05, fy - 0.01);
    c.lineTo(fx + 0.05, fy - 0.02);
    c.quadraticCurveTo(fx + 0.03, fy + 0.1, fx - 0.0, fy + 0.12);
    c.quadraticCurveTo(fx - 0.04, fy + 0.08, fx - 0.05, fy - 0.01);
    c.closePath();
    c.fillStyle = P.tooth;
    c.fill();
    c.strokeStyle = P.mouth;
    c.lineWidth = lw(u, 0.022, 0.7);
    c.stroke();
  }
  // пластырь — на правой щеке, поверх места синяка стадии 1 (фингал слева, признаки не сливаются)
  if (face >= 2) drawBandAid(c, u, 0.63, 0.32, 0.3);
  if (s.mustache) drawMustache(c, u, s);
  if (bump && full) drawOuch(c, u);
  if (scared) {
    drawSweat(c, u, 0.74, -0.62, 0.13);
    if (u.lod > 1) drawSweat(c, u, -0.82, -0.3, 0.08);
  }
  if (s.crown) drawCrown(c, u);
  if (helmet) drawHelmet(c, u, stage);
}
