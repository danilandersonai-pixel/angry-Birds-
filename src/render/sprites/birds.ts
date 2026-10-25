// Процедурная отрисовка птиц. Оригинальное прочтение стиля AB2: мягкий объём, толстая цветная обводка, глянец.
// Единицы дизайна: радиус тела = 1, +x — вперёд (клюв), +y — вниз. См. charCommon.ts.

import type { BirdType } from '../../core/types';
import type { BirdPose } from '../../core/api';
import type { Sprite } from './api';
import {
  type BodyShade,
  type C,
  type EyeMode,
  type Feather,
  type Units,
  type VBrowOpts,
  DEG,
  TAU,
  beginSprite,
  browStroke,
  circlePath,
  drawEye,
  ellipsePath,
  featherPath,
  fillFeather,
  finishSprite,
  gloss,
  lw,
  mix,
  outlinePass,
  rgba,
  roundPolyPath,
  shadeBody,
  softBlob,
  vBrow,
} from './charCommon';

/** Во сколько раз сторона холста больше диаметра тела (запас под хохолок, хвост, клюв). */
export const BIRD_SPRITE_EXTENT: Record<BirdType, number> = {
  red: 1.62,
  blues: 1.62,
  chuck: 1.5,
  bomb: 1.7,
  matilda: 1.72,
  hal: 2.0,
  terence: 1.5,
  silver: 1.7,
};

/** Толщина обводки птиц по умолчанию (видимая ≈ 0.07 r). */
const OUT_BIRD = 0.078;

/** Нарисовать птицу в новый холст. Центр тела — (ox, oy), смотрит вправо. */
export function renderBird(type: BirdType, pose: BirdPose, radiusM: number, ppu: number): Sprite {
  const spec = SPECS[type];
  const d = beginSprite(radiusM * ppu, BIRD_SPRITE_EXTENT[type], spec.outBase ?? OUT_BIRD);
  drawBird(d.c, d.u, spec, pose);
  return finishSprite(d, ppu);
}

// ───────────────────────── состояние лица по позе ─────────────────────────

interface FaceState {
  eye: EyeMode;
  lid: number;
  tilt: number;
  lower: number;
  pupilK: number;
  lookX: number;
  lookY: number;
  /** Опускание бровей к переносице (+ — злее). */
  browDy: number;
  /** Брови «домиком» (оглушение). */
  worried: boolean;
  /** Раскрытие клюва, рад. */
  open: number;
}

function faceState(pose: BirdPose): FaceState {
  switch (pose) {
    case 'blink':
      return { eye: 'closed', lid: 1, tilt: 0.3, lower: 0, pupilK: 1, lookX: 0, lookY: 0, browDy: 0.01, worried: false, open: 0 };
    case 'aim':
      // прицел: злой прищур — веко ниже наклонено к переносице, нижнее веко поджато
      return { eye: 'open', lid: 0.3, tilt: 0.6, lower: 0.22, pupilK: 0.8, lookX: 0.8, lookY: 0.05, browDy: 0.1, worried: false, open: 0 };
    case 'fly':
      return { eye: 'open', lid: 0, tilt: 0, lower: 0, pupilK: 0.7, lookX: 0.35, lookY: -0.05, browDy: 0.02, worried: false, open: 0.62 };
    case 'hurt':
      // ушиб: зажмуренные глаза «> <», брови домиком, клюв приоткрыт
      return { eye: 'squeeze', lid: 0, tilt: 0, lower: 0, pupilK: 1, lookX: 0, lookY: 0, browDy: -0.08, worried: true, open: 0.24 };
    default:
      return { eye: 'open', lid: 0.14, tilt: 0.34, lower: 0, pupilK: 1, lookX: 0.45, lookY: 0.12, browDy: 0, worried: false, open: 0 };
  }
}

// ───────────────────────── описание птицы ─────────────────────────

interface Beak {
  upper: (c: C) => void;
  lower: (c: C) => void;
  hinge: readonly [number, number];
  /** Нижняя точка кончика верхнего клюва (край рта). */
  tipU: readonly [number, number];
  /** Кончик нижнего клюва. */
  tipL: readonly [number, number];
  /** Множитель раскрытия. */
  openMul?: number;
  top: string;
  topLight: string;
  bot: string;
  botDark: string;
  line: string;
  /** Блик на верхнем клюве: центр, полуоси, поворот. */
  shine: readonly [number, number, number, number, number];
}

interface Part {
  /** Контур для общей толстой обводки (проход 1). */
  outline?: (c: C, u: Units, fs: FaceState) => void;
  draw: (c: C, u: Units, fs: FaceState) => void;
}

interface EyeGeom {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

interface BirdSpec {
  shade: BodyShade;
  outline: string;
  body: (c: C) => void;
  tail: Feather[];
  tailColors: readonly [string, string, string | null];
  tuft: Feather[];
  tuftColors: readonly [string, string, string | null];
  /** Брюшко и прочее внутри клипа тела. */
  under?: (c: C, u: Units, fs: FaceState) => void;
  /** Цвет «чешуек»-перьев на спине (null — без них). */
  chevron: string | null;
  /** Углы (град.) чешуек вдоль спины. */
  scaleAngles?: readonly number[];
  eyes: readonly [EyeGeom, EyeGeom];
  pupilR: number;
  eyeLine: string;
  eyeLineW: number;
  lidLight: string;
  lidBase: string;
  /** Мягкая тень глазницы (для светлых тел) — цвет. */
  socket?: string;
  /** Постоянное «тяжёлое» веко (Теренс). */
  lidAdd?: number;
  tiltMul?: number;
  iris?: string;
  irisR?: number;
  lashes?: number;
  lashColor?: string;
  brow: (c: C, u: Units, fs: FaceState) => void;
  beak: Beak;
  mouth: string;
  tongue: string;
  back?: Part[];
  over?: Part[];
  face?: Part[];
  top?: Part[];
  /** Углы (град.) взъерошенных перьев при оглушении (4 шт.). */
  ruffle: number[];
  /** Точка края тела по направлению deg (для взъерошенных перьев); по умолчанию — круг. */
  edge?: (deg: number) => readonly [number, number];
  gloss: readonly [number, number, number, number, number, number];
  outBase?: number;
}

// ───────────────────────── общий конвейер ─────────────────────────

/** Перья хохолка с учётом позы: в полёте — назад по ветру, при оглушении — растопырены. */
function poseTuft(f: Feather, i: number, pose: BirdPose): Feather {
  if (pose === 'fly') return { ...f, a: f.a - 14, bend: (f.bend ?? 0) + 0.08 };
  if (pose === 'hurt') return { ...f, a: f.a + (i % 2 === 0 ? 16 : -18), bend: -(f.bend ?? 0) * 1.5 + 0.1 };
  return f;
}

function poseTail(f: Feather, pose: BirdPose): Feather {
  if (pose === 'fly') return { ...f, a: 180 + (f.a - 180) * 0.55, len: f.len * 1.06 };
  if (pose === 'hurt') return { ...f, a: 180 + (f.a - 180) * 1.5 };
  return f;
}

/** Взъерошенное перо на краю тела под углом deg: цвета тела, тёмный кончик — заметно меняет силуэт. */
function ruffleFeather(deg: number, i: number, edge?: (deg: number) => readonly [number, number]): Feather {
  const a = deg * DEG;
  const len = 0.26 + (i % 3) * 0.03;
  const [ex, ey] = edge ? edge(deg) : [Math.cos(a), Math.sin(a)];
  return { x: ex * 0.86, y: ey * 0.86, a: deg + (i % 2 === 0 ? 14 : -12), len, w: 0.1, bend: i % 2 === 0 ? 0.12 : -0.12 };
}

/** Пересечение луча из центра с краем многоугольника. */
function polyEdge(poly: ReadonlyArray<readonly [number, number]>) {
  return (deg: number): readonly [number, number] => {
    const dx = Math.cos(deg * DEG);
    const dy = Math.sin(deg * DEG);
    let best = 1;
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const ex = bx - ax;
      const ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ey - ay * ex) / den;
      const s = (ax * dy - ay * dx) / den;
      if (t > 0 && s >= 0 && s <= 1) best = t;
    }
    return [dx * best * 0.92, dy * best * 0.92];
  };
}

function rotPt(p: readonly [number, number], o: readonly [number, number], ang: number): [number, number] {
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const dx = p[0] - o[0];
  const dy = p[1] - o[1];
  return [o[0] + dx * cs - dy * sn, o[1] + dx * sn + dy * cs];
}

/** Обводка/заливка с поворотом нижнего клюва вокруг шарнира (поворот — вокруг законченного пути). */
function withLower(c: C, b: Beak, open: number, fn: () => void): void {
  c.save();
  c.translate(b.hinge[0], b.hinge[1]);
  c.rotate(open);
  c.translate(-b.hinge[0], -b.hinge[1]);
  fn();
  c.restore();
}

function mouthPath(c: C, b: Beak, open: number): void {
  const L = rotPt(b.tipL, b.hinge, open);
  const mid = rotPt([(b.hinge[0] + b.tipL[0]) / 2, (b.hinge[1] + b.tipL[1]) / 2 + 0.06], b.hinge, open);
  c.moveTo(b.hinge[0] - 0.02, b.hinge[1] - 0.04);
  c.lineTo(b.tipU[0], b.tipU[1]);
  c.lineTo(L[0], L[1]);
  c.quadraticCurveTo(mid[0], mid[1], b.hinge[0], b.hinge[1] + 0.02);
  c.closePath();
}

function beakOutline(c: C, u: Units, s: BirdSpec, open: number): void {
  const b = s.beak;
  c.strokeStyle = s.outline;
  c.lineWidth = 2 * u.out;
  if (open > 0.001) {
    c.beginPath();
    mouthPath(c, b, open);
    c.stroke();
  }
  withLower(c, b, open, () => {
    c.beginPath();
    b.lower(c);
    c.stroke();
  });
  c.beginPath();
  b.upper(c);
  c.stroke();
}

function beakFill(c: C, u: Units, s: BirdSpec, open: number): void {
  const b = s.beak;
  const thin = lw(u, 0.04, 0.9);
  if (open > 0.001) {
    // полость рта и язык
    c.beginPath();
    mouthPath(c, b, open);
    c.fillStyle = s.mouth;
    c.fill();
    c.save();
    c.beginPath();
    mouthPath(c, b, open);
    c.clip();
    const L = rotPt(b.tipL, b.hinge, open);
    const tx = b.hinge[0] * 0.45 + L[0] * 0.55;
    const ty = b.hinge[1] * 0.45 + L[1] * 0.55;
    c.beginPath();
    ellipsePath(c, tx, ty + 0.02, 0.2, 0.09, open * 0.8);
    c.fillStyle = s.tongue;
    c.fill();
    softBlob(c, tx - 0.04, ty - 0.01, 0.08, 0.035, '#ffffff', 0.35, open * 0.8);
    c.restore();
  }
  // нижний клюв
  withLower(c, b, open, () => {
    const g = c.createLinearGradient(0, b.hinge[1] - 0.02, 0, b.hinge[1] + 0.2);
    g.addColorStop(0, b.bot);
    g.addColorStop(1, b.botDark);
    c.beginPath();
    b.lower(c);
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = b.line;
    c.lineWidth = thin;
    c.stroke();
  });
  // верхний клюв
  const yTop = Math.min(b.tipU[1], b.hinge[1]) - 0.3;
  const g = c.createLinearGradient(0, yTop, 0, b.hinge[1] + 0.02);
  g.addColorStop(0, b.topLight);
  g.addColorStop(0.5, b.top);
  g.addColorStop(1, mix(b.top, b.botDark, 0.5));
  c.beginPath();
  b.upper(c);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = b.line;
  c.lineWidth = thin;
  c.stroke();
  if (u.lod > 0) {
    const [x, y, rx, ry, rot] = b.shine;
    c.save();
    c.beginPath();
    b.upper(c);
    c.clip();
    // тень под горбинкой у линии рта — клюв читается объёмным, а не плоским клином
    const sg = c.createLinearGradient(0, b.hinge[1] - 0.1, 0, b.hinge[1] + 0.01);
    sg.addColorStop(0, rgba(b.botDark, 0));
    sg.addColorStop(1, rgba(b.botDark, 0.45));
    c.fillStyle = sg;
    c.fillRect(b.hinge[0] - 0.3, b.hinge[1] - 0.1, 2.4, 0.12);
    softBlob(c, x, y, rx, ry, '#ffffff', 0.7, rot, 0.5);
    c.restore();
  }
}

/** «Чешуйки» перьев на спине: дуги, выпуклые к хвосту и касательные к контуру. */
function drawScales(c: C, u: Units, s: BirdSpec): void {
  if (!s.chevron || u.lod < 2) return;
  c.strokeStyle = s.chevron;
  c.lineWidth = lw(u, 0.022, 0.7);
  for (const deg of s.scaleAngles ?? [158, 180, 202]) {
    const a = deg * DEG;
    const px = Math.cos(a) * 0.6;
    const py = Math.sin(a) * 0.6 + s.shade.cy;
    c.beginPath();
    c.arc(px, py, 0.15, a - 0.9, a + 0.9);
    c.stroke();
  }
}

function drawBird(c: C, u: Units, s: BirdSpec, pose: BirdPose): void {
  const fs = faceState(pose);
  const open = fs.open * (s.beak.openMul ?? 1);
  const tail = s.tail.map((f) => poseTail(f, pose));
  const tuft = s.tuft.map((f, i) => poseTuft(f, i, pose));
  const ruffles = pose === 'hurt' ? s.ruffle.map((a, i) => ruffleFeather(a, i, s.edge)) : [];

  // ── проход 1: единая толстая обводка силуэта
  const sil: Array<(c: C) => void> = [];
  for (const f of tail) sil.push((cc) => featherPath(cc, f));
  for (const f of tuft) sil.push((cc) => featherPath(cc, f));
  for (const f of ruffles) sil.push((cc) => featherPath(cc, f));
  sil.push(s.body);
  outlinePass(c, u, s.outline, sil);
  for (const p of s.back ?? []) p.outline?.(c, u, fs);
  beakOutline(c, u, s, open);

  // ── проход 2: заливки сзади вперёд
  for (const p of s.back ?? []) p.draw(c, u, fs);
  const [tr, tt, tv] = s.tailColors;
  for (const f of tail) fillFeather(c, u, f, tr, tt, tv);
  const [ur, ut, uv] = s.tuftColors;
  for (const f of tuft) fillFeather(c, u, f, ur, ut, uv);
  for (const f of ruffles) fillFeather(c, u, f, s.shade.base, s.shade.dark, null);

  shadeBody(c, u, s.body, s.shade, (cc) => {
    s.under?.(cc, u, fs);
    drawScales(cc, u, s);
  });
  const [gx, gy, grx, gry, grot, ga] = s.gloss;
  gloss(c, u, gx, gy, grx, gry, grot, ga);
  for (const p of s.over ?? []) p.draw(c, u, fs);

  // ── глаза
  const lidAdd = s.lidAdd ?? 0;
  // в прицеле наклон века не ослабляем — взгляд злой, а не сонный
  const tiltMul = pose === 'aim' ? Math.max(s.tiltMul ?? 1, 1) : (s.tiltMul ?? 1);
  s.eyes.forEach((e) => {
    if (s.socket && u.lod > 0) softBlob(c, e.x, e.y + 0.01, e.rx + 0.04, e.ry + 0.04, s.socket, 0.08, 0, 0.72);
  });
  s.eyes.forEach((e, i) => {
    const inner = i === 0 ? 1 : -1;
    drawEye(c, u, {
      x: e.x,
      y: e.y,
      rx: e.rx,
      ry: e.ry,
      inner,
      mode: fs.eye,
      lid: fs.eye === 'open' ? Math.min(0.85, fs.lid + lidAdd * (pose === 'fly' ? 0.4 : 1)) : 0,
      lidTilt: fs.tilt * tiltMul,
      lowerLid: fs.lower,
      pupilR: s.pupilR * fs.pupilK * (i === 0 ? 0.96 : 1),
      lookX: fs.lookX,
      lookY: fs.lookY,
      iris: s.iris,
      irisR: s.irisR ? s.irisR * (pose === 'fly' ? 0.85 : 1) : undefined,
      lidLight: s.lidLight,
      lidBase: s.lidBase,
      line: s.eyeLine,
      lineW: s.eyeLineW,
      lashes: s.lashes,
      lashColor: s.lashColor,
    });
  });
  for (const p of s.face ?? []) p.draw(c, u, fs);
  s.brow(c, u, fs);
  beakFill(c, u, s, open);
  for (const p of s.top ?? []) p.draw(c, u, fs);
}

// ───────────────────────── хелперы для описаний ─────────────────────────

function ellipseBody(cx: number, cy: number, rx: number, ry: number) {
  return (c: C) => ellipsePath(c, cx, cy, rx, ry);
}

/** Брюшко: эллипс с вертикальным градиентом и мягкой кромкой сверху. */
function belly(x: number, y: number, rx: number, ry: number, rot: number, top: string, bottom: string) {
  return (c: C, u: Units) => {
    const g = c.createLinearGradient(0, y - ry, 0, y + ry);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    c.beginPath();
    ellipsePath(c, x, y, rx, ry, rot);
    c.fillStyle = g;
    c.fill();
    if (u.lod > 0) {
      // светлая кромка и лёгкая тень по верхнему краю брюшка
      c.save();
      c.beginPath();
      ellipsePath(c, x, y, rx, ry, rot);
      c.clip();
      softBlob(c, x - rx * 0.25, y - ry * 0.35, rx * 0.6, ry * 0.45, '#ffffff', 0.35, rot);
      c.restore();
    }
  };
}

/** Пара отдельных бровей: для каждого глаза — наружный и внутренний конец. */
function pairBrows(
  geo: ReadonlyArray<readonly [number, number, number, number]>,
  th: number,
  arch: number,
  color: string,
  hi: string | null,
  angerGain = 1,
) {
  return (c: C, u: Units, fs: FaceState) => {
    geo.forEach(([ox, oy, ix, iy], i) => {
      let dyIn = fs.browDy * angerGain;
      let dyOut = -fs.browDy * 0.3;
      if (fs.worried) {
        dyIn = -0.12;
        dyOut = 0.06;
      }
      const ax = i === 0 ? ox : ix;
      const ay = i === 0 ? oy + dyOut : iy + dyIn;
      const bx = i === 0 ? ix : ox;
      const by = i === 0 ? iy + dyIn : oy + dyOut;
      browStroke(c, u, ax, ay, bx, by, th * (i === 0 ? 0.95 : 1.05), th * (i === 0 ? 1.05 : 0.95), fs.worried ? arch + 0.03 : arch, color, hi);
    });
  };
}

/** Монобровь «V»: L, M, R — точки верхней кромки, th — номинальная толщина (концы 0.55·th, центр 1.1·th). */
function uniBrow(L: readonly [number, number], M: readonly [number, number], R: readonly [number, number], th: number, color: string, o: VBrowOpts = {}) {
  return (c: C, u: Units, fs: FaceState) => {
    if (fs.worried) {
      // «домиком»: центр вверх, концы вниз
      vBrow(c, u, [L[0], L[1] + 0.12], [M[0], L[1] - 0.1], [R[0], R[1] + 0.14], th * 0.5, th * 0.85, color, { ...o, teeth: 0 });
      return;
    }
    const dm = fs.browDy;
    vBrow(c, u, [L[0], L[1] - dm * 0.4], [M[0], M[1] + dm], [R[0], R[1] - dm * 0.4], th * 0.55, th * 1.1, color, o);
  };
}

function shade(light: string, base: string, dark: string, shadow: string, bounce: string, rim: number, cy = 0): BodyShade {
  return { light, base, dark, shadow, bounce, rim, cx: 0, cy, R: 1 };
}

interface BeakColors {
  top: string;
  topLight: string;
  bot: string;
  botDark: string;
  line: string;
}

/**
 * Типовой клюв (шаблон Реда): горбинка сверху, видимый нижний клюв.
 * (ox, oy) — корень верхней кромки, sx/sy — масштаб, hump — высота горбинки, lowK — глубина нижнего клюва.
 */
function stdBeak(ox: number, oy: number, sx: number, sy: number, col: BeakColors, o: { hump?: number; lowK?: number; openMul?: number } = {}): Beak {
  const hk = o.hump ?? 1;
  const lk = o.lowK ?? 1;
  const X = (x: number) => ox + sx * x;
  const Y = (y: number) => oy + sy * y;
  return {
    upper: (c) => {
      c.moveTo(X(0), Y(0));
      c.bezierCurveTo(X(0.26), Y(-0.16 * hk), X(0.68), Y(-0.08 * hk), X(0.9), Y(0.14));
      c.quadraticCurveTo(X(0.5), Y(0.26), X(0.02), Y(0.26));
      c.closePath();
    },
    lower: (c) => {
      c.moveTo(X(0.04), Y(0.26));
      c.quadraticCurveTo(X(0.42), Y(0.28), X(0.72), Y(0.24));
      c.quadraticCurveTo(X(0.42), Y(0.26 + 0.24 * lk), X(0.06), Y(0.26 + 0.16 * lk));
      c.closePath();
    },
    hinge: [X(0.06), Y(0.26)],
    tipU: [X(0.82), Y(0.18)],
    tipL: [X(0.72), Y(0.24)],
    openMul: o.openMul,
    ...col,
    shine: [X(0.34), Y(-0.01 * hk), 0.24 * sx, 0.06 * sy, -0.1],
  };
}

// ───────────────────────── RED ─────────────────────────

const RED: BirdSpec = {
  shade: shade('#FF6B57', '#D9262E', '#9A111B', '#5E0610', '#FF9A7A', 0.34, 0.02),
  outline: '#3A0A0E',
  body: ellipseBody(0, 0.02, 1, 0.98),
  tail: [
    { x: -0.74, y: 0.06, a: 196, len: 0.62, w: 0.13, bend: -0.04 },
    { x: -0.76, y: 0.14, a: 180, len: 0.72, w: 0.14 },
    { x: -0.74, y: 0.22, a: 164, len: 0.58, w: 0.12, bend: 0.04 },
  ],
  tailColors: ['#3B3335', '#191415', 'rgba(255,255,255,0.16)'],
  tuft: [
    { x: -0.16, y: -0.8, a: -122, len: 0.5, w: 0.14, bend: 0.12 },
    { x: 0.0, y: -0.82, a: -70, len: 0.64, w: 0.16, bend: -0.1 },
  ],
  tuftColors: ['#D92630', '#A3121C', 'rgba(255,170,150,0.35)'],
  under: belly(0.26, 0.56, 0.68, 0.46, -0.18, '#FBEBD0', '#DDB688'),
  chevron: 'rgba(110,8,18,0.15)',
  eyes: [
    { x: 0.12, y: -0.22, rx: 0.215, ry: 0.255 },
    { x: 0.54, y: -0.2, rx: 0.225, ry: 0.265 },
  ],
  pupilR: 0.09,
  eyeLine: '#2A0A0A',
  eyeLineW: 0.035,
  lidLight: '#F0544A',
  lidBase: '#C81F28',
  brow: uniBrow([-0.22, -0.54], [0.32, -0.38], [0.86, -0.54], 0.165, '#22100F', { hi: 'rgba(255,255,255,0.08)' }),
  beak: stdBeak(0.16, 0.03, 1, 1, { top: '#F9B428', topLight: '#FFE27C', bot: '#EC9420', botDark: '#C2620C', line: '#7A3807' }),
  mouth: '#5A0C12',
  tongue: '#E5606C',
  ruffle: [-150, -35, 50, 140],
  gloss: [-0.44, -0.5, 0.26, 0.14, -0.62, 0.55],
};

// ───────────────────────── BLUES ─────────────────────────

const BLUES: BirdSpec = {
  shade: shade('#8FD6F8', '#4FB2E6', '#2478B4', '#14507F', '#B8F0FF', 0.28),
  outline: '#103A5A',
  body: ellipseBody(0, 0, 1, 1),
  tail: [
    { x: -0.84, y: 0.06, a: 190, len: 0.48, w: 0.11, bend: -0.06 },
    { x: -0.84, y: 0.16, a: 170, len: 0.44, w: 0.1, bend: 0.06 },
  ],
  tailColors: ['#2A3A48', '#121B23', 'rgba(255,255,255,0.18)'],
  tuft: [
    { x: -0.12, y: -0.86, a: -122, len: 0.4, w: 0.1, bend: 0.16 },
    { x: 0.02, y: -0.88, a: -88, len: 0.52, w: 0.12, bend: -0.18 },
  ],
  tuftColors: ['#2A3A48', '#10171E', 'rgba(255,255,255,0.18)'],
  under: (c, u) => {
    // «шапочка» — лёгкая, на затылке (не спорит со светом сверху-слева)
    softBlob(c, -0.2, -0.85, 0.7, 0.32, '#2373AE', 0.18, -0.15, 0.55);
    belly(0.22, 0.6, 0.62, 0.4, -0.15, '#EAF8FE', '#BFE3F4')(c, u);
  },
  chevron: 'rgba(20,70,120,0.15)',
  eyes: [
    { x: 0.06, y: -0.14, rx: 0.25, ry: 0.29 },
    { x: 0.53, y: -0.12, rx: 0.26, ry: 0.3 },
  ],
  pupilR: 0.1,
  eyeLine: '#0E2A40',
  eyeLineW: 0.035,
  lidLight: '#8FD6F8',
  lidBase: '#3FA2DA',
  tiltMul: 0.75,
  brow: pairBrows(
    [
      [-0.2, -0.5, 0.22, -0.45],
      [0.86, -0.5, 0.4, -0.45],
    ],
    0.1,
    0.03,
    '#14222E',
    'rgba(255,255,255,0.2)',
    0.8,
  ),
  beak: stdBeak(0.36, 0.17, 0.6, 0.72, { top: '#F9BC34', topLight: '#FFE68A', bot: '#EB8F1F', botDark: '#C2650E', line: '#7A3D07' }, { lowK: 1.3, openMul: 1.1 }),
  mouth: '#5A1A1E',
  tongue: '#E5606C',
  ruffle: [-150, -35, 45, 140],
  gloss: [-0.42, -0.48, 0.27, 0.15, -0.62, 0.6],
};

// ───────────────────────── CHUCK ─────────────────────────

/**
 * Физический треугольник Чака (02 §3.3) в единицах его радиуса r = 1.10·R_RED, ось Y вниз.
 * Если физика возьмёт другую форму — менять только эти вершины, спрайт подстроится.
 */
export const CHUCK_HULL: ReadonlyArray<readonly [number, number]> = [
  [0, -1.0],
  [1.0 / 1.1, 0.62 / 1.1],
  [-1.0 / 1.1, 0.62 / 1.1],
];

/** Треугольник заливки: физический в единицах дизайна, сжатый внутрь на толщину обводки (внешний край обводки = физика). */
function insetTri(tri: ReadonlyArray<readonly [number, number]>, scale: number, d: number): Array<[number, number]> {
  const P = tri.map(([x, y]) => [x * scale, y * scale] as const);
  const len = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const a = len(P[1], P[2]);
  const b = len(P[2], P[0]);
  const cc = len(P[0], P[1]);
  const per = a + b + cc;
  const ix = (a * P[0][0] + b * P[1][0] + cc * P[2][0]) / per;
  const iy = (a * P[0][1] + b * P[1][1] + cc * P[2][1]) / per;
  const area = Math.abs((P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1])) / 2;
  const rho = (2 * area) / per;
  const k = (rho - d) / rho;
  return P.map(([x, y]) => [ix + (x - ix) * k, iy + (y - iy) * k]);
}

const CHUCK_TRI = insetTri(CHUCK_HULL, 1 + OUT_BIRD, OUT_BIRD);
const chuckBody = (c: C) => roundPolyPath(c, CHUCK_TRI, [0.12, 0.16, 0.16]);

const CHUCK: BirdSpec = {
  shade: { light: '#FFF4A0', base: '#F9CE2E', dark: '#D29A0C', shadow: '#9A6A00', bounce: '#FFF2A8', rim: 0.38, cx: 0, cy: -0.04, R: 0.9 },
  outline: '#5E3C02',
  body: chuckBody,
  tail: [
    { x: -0.58, y: 0.26, a: 200, len: 0.4, w: 0.095, bend: -0.06 },
    { x: -0.62, y: 0.34, a: 184, len: 0.46, w: 0.105 },
    { x: -0.62, y: 0.42, a: 168, len: 0.38, w: 0.095, bend: 0.06 },
  ],
  tailColors: ['#34302A', '#141210', 'rgba(255,255,255,0.15)'],
  tuft: [
    { x: -0.1, y: -0.72, a: -160, len: 0.32, w: 0.075, bend: 0.1 },
    { x: -0.07, y: -0.76, a: -138, len: 0.4, w: 0.085, bend: 0.08 },
    { x: -0.03, y: -0.8, a: -116, len: 0.46, w: 0.095, bend: 0.04 },
    { x: 0.02, y: -0.8, a: -94, len: 0.38, w: 0.085, bend: -0.06 },
  ],
  tuftColors: ['#34302A', '#121110', 'rgba(255,255,255,0.16)'],
  under: (c, u) => {
    belly(0.08, 0.44, 0.74, 0.22, -0.04, '#FFF8D8', '#F2D58A')(c, u);
  },
  chevron: null,
  eyes: [
    { x: -0.07, y: -0.2, rx: 0.19, ry: 0.23 },
    { x: 0.29, y: -0.18, rx: 0.195, ry: 0.235 },
  ],
  pupilR: 0.08,
  eyeLine: '#3A2604',
  eyeLineW: 0.032,
  lidLight: '#FFE680',
  lidBase: '#F2C226',
  tiltMul: 1.15,
  brow: pairBrows(
    [
      [-0.34, -0.52, 0.08, -0.38],
      [0.56, -0.54, 0.15, -0.38],
    ],
    0.17,
    0.0,
    '#24180C',
    'rgba(255,255,255,0.16)',
    1,
  ),
  beak: stdBeak(0.16, 0.0, 1.0, 0.95, { top: '#F79A1F', topLight: '#FFC766', bot: '#E07A14', botDark: '#B0520A', line: '#6E3305' }, { hump: 0.9, lowK: 0.95, openMul: 0.85 }),
  mouth: '#5A1A0E',
  tongue: '#E5606C',
  ruffle: [-50, 30, 150, -140],
  edge: polyEdge(CHUCK_TRI),
  gloss: [-0.17, -0.42, 0.12, 0.07, -1.05, 0.6],
};

// ───────────────────────── BOMB ─────────────────────────

const FUSE = { x0: 0.02, y0: -0.86, c1x: 0.22, c1y: -1.22, c2x: -0.16, c2y: -1.36, x1: 0.1, y1: -1.48 };
function fusePath(c: C): void {
  c.moveTo(FUSE.x0, FUSE.y0);
  c.bezierCurveTo(FUSE.c1x, FUSE.c1y, FUSE.c2x, FUSE.c2y, FUSE.x1, FUSE.y1);
}

/** Колпачок-гнездо фитиля: короткий цилиндр на макушке (верх чуть выше контура тела). */
const CAP = { x: 0.02, yt: -0.955, yb: -0.885, rx: 0.1, ry: 0.04 };
function capPath(c: C): void {
  const { x, yt, yb, rx, ry } = CAP;
  c.moveTo(x - rx, yt);
  c.lineTo(x - rx, yb);
  c.ellipse(x, yb, rx, ry, 0, Math.PI, 0, true); // низ: π → 0 через π/2
  c.lineTo(x + rx, yt);
  c.ellipse(x, yt, rx, ry, 0, 0, Math.PI, true); // верх: 0 → π через −π/2
  c.closePath();
}

function drawCap(c: C, u: Units): void {
  const { x, yt, rx, ry } = CAP;
  const g = c.createLinearGradient(x - rx, 0, x + rx, 0);
  g.addColorStop(0, '#3A3C43');
  g.addColorStop(0.45, '#1A1B1F');
  g.addColorStop(1, '#0B0B0D');
  c.beginPath();
  capPath(c);
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = '#060607';
  c.lineWidth = lw(u, 0.025, 0.8);
  c.stroke();
  // торец — чуть светлее
  c.beginPath();
  ellipsePath(c, x, yt, rx, ry);
  c.fillStyle = '#2A2C32';
  c.fill();
  c.stroke();
  if (u.lod > 0) {
    // блик металла на боку
    c.beginPath();
    c.moveTo(x - rx * 0.55, yt + 0.02);
    c.lineTo(x - rx * 0.55, CAP.yb + 0.01);
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.lineWidth = lw(u, 0.022, 0.7);
    c.stroke();
  }
}

const BOMB: BirdSpec = {
  shade: shade('#6C7380', '#30333A', '#111215', '#000000', '#7E8696', 0.46, 0.03),
  outline: '#060607',
  body: ellipseBody(0, 0.03, 1, 0.97),
  tail: [
    { x: -0.82, y: 0.04, a: 194, len: 0.5, w: 0.12, bend: -0.05 },
    { x: -0.84, y: 0.14, a: 180, len: 0.56, w: 0.12 },
    { x: -0.82, y: 0.24, a: 166, len: 0.46, w: 0.11, bend: 0.05 },
  ],
  tailColors: ['#2A2C31', '#0B0B0D', 'rgba(255,255,255,0.22)'],
  tuft: [],
  tuftColors: ['#000', '#000', null],
  under: (c, u) => {
    belly(0.2, 0.6, 0.6, 0.38, -0.15, '#B4AFA8', '#77716B')(c, u);
  },
  chevron: 'rgba(150,160,180,0.12)',
  eyes: [
    { x: 0.15, y: -0.18, rx: 0.19, ry: 0.22 },
    { x: 0.55, y: -0.16, rx: 0.2, ry: 0.23 },
  ],
  pupilR: 0.08,
  eyeLine: '#050506',
  eyeLineW: 0.035,
  lidLight: '#5A606C',
  lidBase: '#2C2F36',
  lidAdd: 0.06,
  brow: uniBrow([-0.16, -0.5], [0.35, -0.33], [0.92, -0.5], 0.19, '#0B0B0D', { hi: 'rgba(170,180,200,0.08)', rim: 'rgba(120,128,145,0.35)', rimW: 0.035 }),
  beak: stdBeak(0.18, 0.05, 0.95, 1.05, { top: '#F5A623', topLight: '#FFD877', bot: '#E08516', botDark: '#B05C0A', line: '#5C2D04' }),
  mouth: '#4A0E10',
  tongue: '#E5606C',
  back: [
    {
      // фитиль-перо
      outline: (c, u) => {
        c.beginPath();
        fusePath(c);
        c.strokeStyle = '#060607';
        c.lineWidth = 0.11 + 2 * u.out;
        c.stroke();
        c.beginPath();
        capPath(c);
        c.lineWidth = 2 * u.out;
        c.stroke();
      },
      draw: (c, u) => {
        c.beginPath();
        fusePath(c);
        const g = c.createLinearGradient(FUSE.x0, FUSE.y0, FUSE.x1, FUSE.y1);
        g.addColorStop(0, '#34373E');
        g.addColorStop(1, '#5B5248');
        c.strokeStyle = g;
        c.lineWidth = 0.11;
        c.stroke();
        if (u.lod > 0) {
          c.beginPath();
          c.moveTo(FUSE.x0 - 0.02, FUSE.y0 - 0.06);
          c.bezierCurveTo(FUSE.c1x - 0.03, FUSE.c1y, FUSE.c2x - 0.02, FUSE.c2y + 0.01, FUSE.x1 - 0.02, FUSE.y1 + 0.01);
          c.strokeStyle = 'rgba(200,210,230,0.35)';
          c.lineWidth = lw(u, 0.025, 0.7);
          c.stroke();
        }
      },
    },
  ],
  // колпачок поверх тела: фитиль растёт из него, а не прямо из макушки
  over: [{ draw: (c, u) => drawCap(c, u) }],
  top: [
    {
      draw: (c, u, fs) => {
        if (fs.worried) {
          // искра погасла — струйка дыма
          for (const [x, y, r, a] of [
            [0.14, -1.56, 0.07, 0.6],
            [0.22, -1.64, 0.08, 0.45],
            [0.14, -1.72, 0.07, 0.3],
          ] as const) {
            softBlob(c, x, y, r, r, '#B9B4AE', a, 0, 0.6);
          }
          return;
        }
        // искра на кончике фитиля
        const x = FUSE.x1;
        const y = FUSE.y1;
        softBlob(c, x, y, 0.3, 0.3, '#FF8A1F', 0.55, 0, 0.2);
        softBlob(c, x, y, 0.16, 0.16, '#FFD25A', 0.9, 0, 0.4);
        c.strokeStyle = '#FFF6C8';
        c.lineWidth = lw(u, 0.03, 0.8);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 0.3;
          const r0 = 0.07;
          const r1 = i % 2 === 0 ? 0.24 : 0.17;
          c.beginPath();
          c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
          c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
          c.stroke();
        }
        c.beginPath();
        circlePath(c, x, y, 0.06);
        c.fillStyle = '#FFFBEA';
        c.fill();
      },
    },
  ],
  ruffle: [-150, -35, 45, 140],
  gloss: [-0.42, -0.5, 0.28, 0.15, -0.62, 0.62],
};

// ───────────────────────── MATILDA ─────────────────────────

/** Яйцевидный контур: уже сверху, шире снизу (в пределах круга по ширине). */
function eggPath(c: C): void {
  const N = 96;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * TAU;
    const s = Math.sin(t);
    const x = 0.95 * (1 + 0.055 * s) * Math.cos(t);
    const y = -0.035 + 1.035 * s;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.closePath();
}

/**
 * Локон Матильды: сужающийся стебель встаёт от затылочной стороны макушки и загибается
 * назад открытым крючком «?» (0.6 витка) с каплевидным утолщением на конце — без замкнутого «кольца».
 */
const CURL_R = 0.17;
const CURL_PTS: Array<[number, number, number]> = (() => {
  // строим в локальной системе (основание в нуле, стебель вверх), затем наклоняем назад и ставим на затылок
  const pts: Array<[number, number, number]> = [];
  const stemH = 0.3;
  pts.push([0, 0.04, 0.05], [0, -0.08, 0.054], [0, -stemH, 0.058]);
  const N = 30;
  const turns = 0.6;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const a = -t * turns * TAU; // против часовой: вверх → назад → вниз
    const r = CURL_R * (1 - 0.4 * t);
    // сужение к концу и капля на кончике (полуширина 0.035)
    const drop = Math.max(0, (t - 0.6) / 0.4);
    const hw = 0.058 * (1 - t) + 0.024 * t + 0.013 * drop * drop * (3 - 2 * drop);
    pts.push([-CURL_R + Math.cos(a) * r, -stemH + Math.sin(a) * r, hw]);
  }
  const [bx, by] = [-0.16, -0.92];
  const cs = Math.cos(-0.15);
  const sn = Math.sin(-0.15);
  return pts.map(([x, y, hw]) => [bx + x * cs - y * sn, by + x * sn + y * cs, hw] as [number, number, number]);
})();

/** Контур локона как заливаемая фигура переменной ширины. */
function curlPath(c: C): void {
  const n = CURL_PTS.length;
  const L: Array<[number, number]> = [];
  const R: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const p = CURL_PTS[Math.max(0, i - 1)];
    const q = CURL_PTS[Math.min(n - 1, i + 1)];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const dl = Math.hypot(dx, dy) || 1;
    const [x, y, hw] = CURL_PTS[i];
    L.push([x - (dy / dl) * hw, y + (dx / dl) * hw]);
    R.push([x + (dy / dl) * hw, y - (dx / dl) * hw]);
  }
  c.moveTo(L[0][0], L[0][1]);
  for (const p of L) c.lineTo(p[0], p[1]);
  // скруглённый кончик капли: контрольная точка вынесена вперёд на 1.9 полуширины
  const tip = CURL_PTS[n - 1];
  const prev = CURL_PTS[n - 2];
  const tl = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
  const k = (tip[2] * 1.9) / tl;
  c.quadraticCurveTo(tip[0] + (tip[0] - prev[0]) * k, tip[1] + (tip[1] - prev[1]) * k, R[n - 1][0], R[n - 1][1]);
  for (let i = n - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]);
  c.closePath();
}

const MATILDA: BirdSpec = {
  shade: { light: '#FFFFFF', base: '#EDE5D3', dark: '#BBAE94', shadow: '#8F8470', bounce: '#FFFFFF', rim: 0.25, cx: 0, cy: -0.03, R: 1.03 },
  outline: '#4A4136',
  body: eggPath,
  tail: [
    { x: -0.82, y: 0.16, a: 196, len: 0.46, w: 0.11, bend: -0.05 },
    { x: -0.84, y: 0.24, a: 182, len: 0.52, w: 0.11 },
    { x: -0.82, y: 0.32, a: 168, len: 0.42, w: 0.1, bend: 0.05 },
  ],
  tailColors: ['#5E544B', '#26201C', 'rgba(255,255,255,0.25)'],
  tuft: [
    { x: -0.06, y: -0.97, a: -104, len: 0.25, w: 0.062, bend: 0.1 },
    { x: 0.08, y: -0.96, a: -72, len: 0.23, w: 0.058, bend: -0.1 },
  ],
  tuftColors: ['#4A413A', '#211C19', null],
  under: (c, u) => {
    // брюшко светлее тёплого тела + светлая кромка сверху — иначе белое на белом теряется
    belly(0.2, 0.62, 0.62, 0.38, -0.15, '#FFFFFF', '#F6F0E4')(c, u);
    if (u.lod > 0) {
      softBlob(c, 0.14, 0.2, 0.5, 0.07, '#8F8470', 0.16, -0.15, 0.5);
      c.beginPath();
      c.ellipse(0.2, 0.62, 0.62, 0.38, -0.15, 200 * DEG, 330 * DEG);
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = lw(u, 0.035, 0.9);
      c.stroke();
    }
  },
  chevron: null,
  eyes: [
    { x: 0.14, y: -0.25, rx: 0.19, ry: 0.23 },
    { x: 0.5, y: -0.23, rx: 0.2, ry: 0.24 },
  ],
  pupilR: 0.08,
  eyeLine: '#4A4136',
  eyeLineW: 0.03,
  lidLight: '#FFFFFF',
  lidBase: '#E2D9C4',
  socket: '#8F8470',
  tiltMul: 0.55,
  lashes: 3,
  lashColor: '#2E2622',
  brow: pairBrows(
    [
      [-0.1, -0.58, 0.26, -0.52],
      [0.76, -0.58, 0.4, -0.52],
    ],
    0.06,
    0.04,
    '#3A302A',
    null,
    0.7,
  ),
  beak: stdBeak(0.22, 0.01, 0.8, 0.85, { top: '#F9B233', topLight: '#FFDE84', bot: '#EC8E1E', botDark: '#C2650E', line: '#7A4207' }, { lowK: 1.05 }),
  mouth: '#5A1A1E',
  tongue: '#E5606C',
  back: [
    {
      outline: (c, u) => {
        c.beginPath();
        curlPath(c);
        c.strokeStyle = '#4A4136';
        c.lineWidth = u.out;
        c.stroke();
      },
      draw: (c, u) => {
        const g = c.createLinearGradient(-0.4, -1.45, -0.05, -0.95);
        g.addColorStop(0, '#5A5048');
        g.addColorStop(1, '#2A2420');
        c.beginPath();
        curlPath(c);
        c.fillStyle = g;
        c.fill();
        if (u.lod > 0) {
          // блик вдоль локона
          c.beginPath();
          CURL_PTS.slice(3, -6).forEach(([x, y, hw], i) => (i === 0 ? c.moveTo(x - hw * 0.3, y - hw * 0.3) : c.lineTo(x - hw * 0.3, y - hw * 0.3)));
          c.strokeStyle = 'rgba(255,255,255,0.2)';
          c.lineWidth = lw(u, 0.018, 0.6);
          c.stroke();
        }
      },
    },
  ],
  face: [
    {
      draw: (c, _u, fs) => {
        // румяная щека (одна, под задним глазом)
        softBlob(c, -0.02, 0.1, 0.2, 0.12, '#F27E92', fs.worried ? 0.35 : 0.55, 0, 0.3);
      },
    },
  ],
  ruffle: [-150, -35, 45, 140],
  gloss: [-0.42, -0.52, 0.26, 0.15, -0.62, 0.7],
};

// ───────────────────────── HAL ─────────────────────────

const HAL: BirdSpec = {
  // изумрудный, а не «свиной» салатовый: тон ~135° против ~87° у свиней
  shade: shade('#93E69A', '#3FB45A', '#1F7F3A', '#0E4F22', '#BDF5C2', 0.34),
  outline: '#0E3A1C',
  body: ellipseBody(0, 0, 1, 1),
  tail: [
    { x: -0.84, y: 0.1, a: 192, len: 0.48, w: 0.11, bend: -0.05 },
    { x: -0.84, y: 0.2, a: 172, len: 0.44, w: 0.1, bend: 0.05 },
  ],
  tailColors: ['#1F3026', '#0B140E', 'rgba(255,255,255,0.15)'],
  tuft: [
    { x: -0.42, y: -0.8, a: -150, len: 0.38, w: 0.09, bend: 0.1 },
    { x: -0.3, y: -0.88, a: -126, len: 0.46, w: 0.1, bend: 0.08 },
    { x: -0.18, y: -0.92, a: -102, len: 0.44, w: 0.1, bend: 0.0 },
    // шипы на спине
    { x: -0.82, y: -0.42, a: -168, len: 0.26, w: 0.08, bend: 0.06 },
    { x: -0.9, y: -0.2, a: -182, len: 0.24, w: 0.08, bend: 0.06 },
  ],
  tuftColors: ['#1F3026', '#0A120C', 'rgba(255,255,255,0.15)'],
  under: (c, u) => {
    belly(0.02, 0.62, 0.66, 0.4, -0.08, '#EEF9E6', '#BFE6C4')(c, u);
  },
  chevron: 'rgba(8,70,30,0.14)',
  scaleAngles: [150, 172, 194],
  eyes: [
    { x: -0.18, y: -0.42, rx: 0.16, ry: 0.2 },
    { x: 0.16, y: -0.46, rx: 0.17, ry: 0.21 },
  ],
  pupilR: 0.07,
  eyeLine: '#0C2A14',
  eyeLineW: 0.032,
  lidLight: '#8FE09A',
  lidBase: '#3AA556',
  brow: pairBrows(
    [
      [-0.42, -0.74, -0.04, -0.6],
      [0.42, -0.8, 0.06, -0.62],
    ],
    0.135,
    0.0,
    '#12241A',
    'rgba(255,255,255,0.16)',
  ),
  beak: {
    // огромный клюв-бумеранг; корень скруглён и уходит назад под глаз — клюв растёт из лица
    upper: (c) => {
      c.moveTo(0.16, -0.24);
      c.bezierCurveTo(0.7, -0.5, 1.5, -0.42, 1.86, 0.3);
      c.bezierCurveTo(1.6, 0.18, 1.2, 0.08, 0.8, 0.12);
      c.bezierCurveTo(0.6, 0.14, 0.4, 0.2, 0.22, 0.24);
      c.quadraticCurveTo(-0.02, 0.0, 0.16, -0.24);
      c.closePath();
    },
    // нижний клюв короткий и в закрытом виде прячется под верхний
    lower: (c) => {
      c.moveTo(0.22, 0.2);
      c.quadraticCurveTo(0.48, 0.13, 0.72, 0.12);
      c.quadraticCurveTo(0.75, 0.17, 0.7, 0.2);
      c.quadraticCurveTo(0.5, 0.36, 0.28, 0.35);
      c.quadraticCurveTo(0.2, 0.3, 0.22, 0.2);
      c.closePath();
    },
    hinge: [0.25, 0.23],
    tipU: [0.8, 0.12],
    tipL: [0.7, 0.2],
    openMul: 0.8,
    top: '#F68B2C',
    topLight: '#FFC170',
    bot: '#E2741C',
    botDark: '#B4500C',
    line: '#6A2E05',
    shine: [0.9, -0.24, 0.42, 0.06, 0.12],
  },
  mouth: '#4A120C',
  tongue: '#E5606C',
  ruffle: [-50, 35, 110, 160],
  gloss: [-0.48, -0.42, 0.24, 0.13, -0.7, 0.55],
};

// ───────────────────────── TERENCE ─────────────────────────

const TERENCE: BirdSpec = {
  shade: shade('#CE3833', '#9A141C', '#5E0A10', '#360206', '#D9604F', 0.28, 0.03),
  outline: '#2B0406',
  body: ellipseBody(0, 0.03, 1, 0.97),
  tail: [
    { x: -0.82, y: 0.06, a: 194, len: 0.46, w: 0.12, bend: -0.05 },
    { x: -0.84, y: 0.16, a: 180, len: 0.52, w: 0.12 },
    { x: -0.82, y: 0.26, a: 166, len: 0.42, w: 0.11, bend: 0.05 },
  ],
  tailColors: ['#2E2526', '#120D0E', 'rgba(255,255,255,0.15)'],
  // короткий хохолок из трёх перьев — отличает от Реда в мелком размере
  tuft: [
    { x: -0.16, y: -0.82, a: -126, len: 0.3, w: 0.13, bend: 0.1 },
    { x: -0.04, y: -0.86, a: -94, len: 0.36, w: 0.13, bend: -0.04 },
    { x: 0.08, y: -0.84, a: -64, len: 0.32, w: 0.13, bend: -0.1 },
  ],
  tuftColors: ['#7E0E15', '#52070C', 'rgba(255,160,150,0.25)'],
  under: (c, u) => {
    belly(0.22, 0.6, 0.74, 0.44, -0.16, '#D9B98A', '#B08A5A')(c, u);
  },
  chevron: 'rgba(60,0,6,0.15)',
  eyes: [
    { x: 0.14, y: -0.1, rx: 0.17, ry: 0.17 },
    { x: 0.52, y: -0.08, rx: 0.18, ry: 0.18 },
  ],
  pupilR: 0.07,
  eyeLine: '#1E0405',
  eyeLineW: 0.03,
  lidLight: '#C2302F',
  lidBase: '#8E1219',
  lidAdd: 0.08,
  // широкая бровь-«полка» — главный признак Теренса в мелком размере
  brow: uniBrow([-0.36, -0.54], [0.32, -0.38], [0.98, -0.5], 0.24, '#150606', { hi: null, teeth: 4, teethH: 0.05 }),
  beak: stdBeak(0.12, 0.12, 1.0, 1.2, { top: '#E9A63A', topLight: '#FFD27E', bot: '#D08A24', botDark: '#9C5A0E', line: '#5A3005' }, { lowK: 1.1, openMul: 0.9 }),
  mouth: '#3A0608',
  tongue: '#D9505E',
  ruffle: [-150, -35, 45, 140],
  gloss: [-0.44, -0.5, 0.26, 0.14, -0.62, 0.45],
  outBase: 0.07,
};

// ───────────────────────── SILVER ─────────────────────────

const PONY = { x: -0.7, y: -0.7 };
// хвостик: три разнесённые пряди, собраны резинкой у корня
const SILVER_TAIL: Feather[] = [
  { x: PONY.x, y: PONY.y, a: 192, len: 0.66, w: 0.1, bend: 0.18 },
  { x: PONY.x, y: PONY.y, a: 170, len: 0.86, w: 0.14, bend: 0.3 },
  { x: PONY.x, y: PONY.y, a: 150, len: 0.62, w: 0.1, bend: 0.42 },
];

function silverStrand(f: Feather, fs: FaceState): Feather {
  if (fs.worried) return { ...f, bend: -(f.bend ?? 0) * 0.6 };
  if (fs.open > 0.3) return { ...f, a: f.a - 8 };
  return f;
}

/** «Усы сокола»: чёткая сужающаяся полоса от заднего глаза вниз-назад. */
function silverMask(c: C): void {
  const p0 = [-0.05, -0.05];
  const p1 = [-0.12, 0.17];
  const p2 = [-0.3, 0.38];
  const N = 14;
  const L: Array<[number, number]> = [];
  const R: Array<[number, number]> = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * p0[0] + 2 * t * (1 - t) * p1[0] + t * t * p2[0];
    const y = (1 - t) * (1 - t) * p0[1] + 2 * t * (1 - t) * p1[1] + t * t * p2[1];
    const tx = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const ty = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const tl = Math.hypot(tx, ty) || 1;
    const w = (0.18 * (1 - t) + 0.03 * t) / 2;
    L.push([x - (ty / tl) * w, y + (tx / tl) * w]);
    R.push([x + (ty / tl) * w, y - (tx / tl) * w]);
  }
  c.beginPath();
  c.moveTo(L[0][0], L[0][1]);
  for (const p of L) c.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) c.lineTo(R[i][0], R[i][1]);
  c.closePath();
  c.fillStyle = rgba('#4E5A66', 0.95);
  c.fill();
}

const SILVER: BirdSpec = {
  shade: shade('#F4F7FA', '#B9C3CD', '#7A8794', '#4A5562', '#FFFFFF', 0.3),
  outline: '#323B46',
  body: ellipseBody(0, 0, 1, 1),
  tail: [
    { x: -0.84, y: 0.14, a: 190, len: 0.46, w: 0.11, bend: -0.05 },
    { x: -0.84, y: 0.24, a: 172, len: 0.42, w: 0.1, bend: 0.05 },
  ],
  tailColors: ['#8E99A5', '#56616E', 'rgba(255,255,255,0.3)'],
  // одно короткое перо на макушке — силуэт сверху не спорит с хвостиком
  tuft: [{ x: 0.14, y: -0.92, a: -150, len: 0.3, w: 0.075, bend: 0.1 }],
  tuftColors: ['#8E99A5', '#5E6B78', 'rgba(255,255,255,0.3)'],
  under: (c, u) => {
    belly(0.2, 0.58, 0.64, 0.44, -0.15, '#FFFFFF', '#D9E0E7')(c, u);
    silverMask(c);
  },
  chevron: null,
  eyes: [
    { x: 0.1, y: -0.2, rx: 0.22, ry: 0.26 },
    { x: 0.52, y: -0.18, rx: 0.23, ry: 0.27 },
  ],
  pupilR: 0.06,
  iris: '#4D9BE0',
  irisR: 0.12,
  eyeLine: '#323B46',
  eyeLineW: 0.03,
  lidLight: '#E8EDF2',
  lidBase: '#AEB8C3',
  socket: '#4A5562',
  tiltMul: 0.6,
  lashes: 2,
  lashColor: '#252C35',
  brow: (c, u, fs) => {
    // одна бровь выше другой — озорство
    const w = fs.worried;
    const dy = fs.browDy;
    browStroke(c, u, -0.12, -0.58 + (w ? 0.06 : -0.02), 0.24, -0.54 + (w ? -0.08 : dy), 0.06, 0.07, 0.05, '#2E3742', null);
    browStroke(c, u, 0.4, -0.52 + (w ? -0.08 : dy * 1.2), 0.82, -0.56 + (w ? 0.06 : 0.02), 0.07, 0.06, 0.03, '#2E3742', null);
  },
  beak: {
    // крючковатый клюв
    upper: (c) => {
      c.moveTo(0.24, 0.02);
      c.bezierCurveTo(0.6, -0.1, 0.94, -0.02, 0.92, 0.3);
      c.quadraticCurveTo(0.82, 0.2, 0.62, 0.21);
      c.quadraticCurveTo(0.42, 0.22, 0.26, 0.22);
      c.closePath();
    },
    lower: (c) => {
      c.moveTo(0.28, 0.22);
      c.quadraticCurveTo(0.52, 0.23, 0.74, 0.22);
      c.quadraticCurveTo(0.52, 0.38, 0.3, 0.35);
      c.closePath();
    },
    hinge: [0.3, 0.22],
    tipU: [0.8, 0.2],
    tipL: [0.74, 0.22],
    top: '#F3B640',
    topLight: '#FFE08E',
    bot: '#E08F24',
    botDark: '#B0640E',
    line: '#6A3A06',
    shine: [0.52, 0.03, 0.18, 0.045, -0.15],
  },
  mouth: '#4A1A1E',
  tongue: '#E5606C',
  back: [
    {
      // «хвостик» на затылке
      outline: (c, u, fs) => {
        outlinePass(
          c,
          u,
          '#323B46',
          SILVER_TAIL.map((f) => (cc: C) => featherPath(cc, silverStrand(f, fs))),
        );
      },
      draw: (c, u, fs) => {
        SILVER_TAIL.forEach((f0, i) => {
          const f = silverStrand(f0, fs);
          fillFeather(c, u, f, '#8E99A5', '#56616E', 'rgba(255,255,255,0.32)');
          if (i > 0 && u.lod > 0) {
            // тонкий шов между прядями — они читаются раздельно
            c.beginPath();
            featherPath(c, f);
            c.strokeStyle = 'rgba(50,59,70,0.7)';
            c.lineWidth = lw(u, 0.025, 0.7);
            c.stroke();
          }
        });
      },
    },
  ],
  over: [
    {
      draw: (c, u) => {
        // резинка хвостика
        c.beginPath();
        ellipsePath(c, PONY.x - 0.03, PONY.y + 0.01, 0.09, 0.16, 0.6);
        const g = c.createLinearGradient(PONY.x - 0.1, PONY.y - 0.12, PONY.x + 0.06, PONY.y + 0.12);
        g.addColorStop(0, '#8CC8FF');
        g.addColorStop(1, '#2F7FD0');
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = '#1D3F66';
        c.lineWidth = lw(u, 0.035, 0.8);
        c.stroke();
      },
    },
  ],
  ruffle: [-35, 45, 120, 160],
  gloss: [-0.4, -0.52, 0.26, 0.14, -0.62, 0.7],
};

const SPECS: Record<BirdType, BirdSpec> = {
  red: RED,
  blues: BLUES,
  chuck: CHUCK,
  bomb: BOMB,
  matilda: MATILDA,
  hal: HAL,
  terence: TERENCE,
  silver: SILVER,
};
