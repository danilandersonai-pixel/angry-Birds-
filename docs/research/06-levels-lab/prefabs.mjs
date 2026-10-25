// Prefab macros for level authoring (grid U = 0.5 m). Each returns { blocks, pigs?, top, spots }.
// Coordinates: (x, y) of a block = centre of its bounding box (src/core/types.ts BlockDef). y0 = support surface.
// "Visual flush" placement: blocks touch exactly (0 gap); the engine shrinks collision by INSET = 0.0075 m.
export const U = 0.5;
export const B = (material, shape, x, y, w, h, angle = 0) => ({ material, shape, x: r4(x), y: r4(y), w, h, ...(angle ? { angle } : {}) });
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** Two columns + beam ("П"-frame). Column outer faces flush with beam ends. */
export function frame({ x, y = 0, span = 4, h = 2, colW = 0.5, col = 'wood', beam = 'wood', beamT = 0.5 }) {
  const cx = span / 2 - colW / 2;
  const blocks = [
    B(col, 'rect', x - cx, y + h / 2, colW, h),
    B(col, 'rect', x + cx, y + h / 2, colW, h),
    B(beam, 'rect', x, y + h + beamT / 2, span, beamT),
  ];
  return { blocks, top: y + h + beamT, inner: { x, y, w: span - 2 * colW, h } };
}

/** Tower of `floors` frames. mats: array per floor [{col, beam}] or single. Returns spots: inner floor y per storey, top y. */
export function tower({ x, y = 0, floors = 3, span = 4, h = 2, mats = { col: 'wood', beam: 'wood' } }) {
  const blocks = []; const spots = []; let yy = y;
  for (let i = 0; i < floors; i++) {
    const m = Array.isArray(mats) ? mats[i % mats.length] : mats;
    const f = frame({ x, y: yy, span, h, col: m.col, beam: m.beam });
    blocks.push(...f.blocks); spots.push({ x, y: yy, kind: 'inside' }); yy = f.top;
  }
  spots.push({ x, y: yy, kind: 'top' });
  return { blocks, top: yy, spots };
}

/** Isosceles roof (shape isoTriangle) sitting on surface y. */
export function roof({ x, y, w = 4, h = 1.5, mat = 'wood' }) {
  return { blocks: [B(mat, 'isoTriangle', x, y + h / 2, w, h)], top: y + h };
}

/** Hut = frame + roof. Pig spot inside. */
export function hut({ x, y = 0, span = 4, h = 2, col = 'wood', beam = 'wood', roofMat = 'wood', roofH = 1.5 }) {
  const f = frame({ x, y, span, h, col, beam });
  const r = roof({ x, y: f.top, w: span, h: roofH, mat: roofMat });
  return { blocks: [...f.blocks, ...r.blocks], top: r.top, spots: [{ x, y, kind: 'inside' }] };
}

/** Pyramid of squares, rows r..1, horizontal gap g between squares. */
export function pyramid({ x, y = 0, rows = 4, size = 1, mat = 'wood', gap = 0 }) {
  const blocks = [];
  for (let i = 0; i < rows; i++) {
    const n = rows - i; const w = n * size + (n - 1) * gap; const x0 = x - w / 2 + size / 2;
    for (let j = 0; j < n; j++) blocks.push(B(mat, 'rect', x0 + j * (size + gap), y + i * size + size / 2, size, size));
  }
  return { blocks, top: y + rows * size, spots: [{ x, y: y + rows * size, kind: 'top' }] };
}

/** Vertical stack of identical rects. */
export function stack({ x, y = 0, n = 3, w = 1, h = 1, mat = 'wood' }) {
  const blocks = [];
  for (let i = 0; i < n; i++) blocks.push(B(mat, 'rect', x, y + i * h + h / 2, w, h));
  return { blocks, top: y + n * h };
}

/** Pier / platform on piles: deck of `n` beams (len L), joints over piles (each beam end bears colW/2). */
export function pier({ x0, y = 0, n = 2, L = 4, pileH = 2, colW = 0.5, pile = 'wood', deck = 'wood' }) {
  const blocks = [];
  // piles at x0 + i*L (i = 0..n): outer piles flush with deck ends
  for (let i = 0; i <= n; i++) {
    let px = x0 + i * L;
    if (i === 0) px += colW / 2; else if (i === n) px -= colW / 2;
    blocks.push(B(pile, 'rect', px, y + pileH / 2, colW, pileH));
  }
  for (let i = 0; i < n; i++) blocks.push(B(deck, 'rect', x0 + i * L + L / 2, y + pileH + 0.25, L, 0.5));
  return { blocks, top: y + pileH + 0.5 };
}

/** Bunker: thick walls (wallW) + roof slab; pig sits inside on y. */
export function bunker({ x, y = 0, inner = 2, h = 1.5, wallW = 0.5, mat = 'stone', roofMat = mat, roofT = 0.5 }) {
  const span = inner + 2 * wallW;
  const f = frame({ x, y, span, h, colW: wallW, col: mat, beam: roofMat, beamT: roofT });
  return { blocks: f.blocks, top: f.top, spots: [{ x, y, kind: 'inside' }] };
}

/** Ball held by two stoppers (cubes 0.5) with clearance c on each side. */
export function cradledBall({ x, y, d = 1, mat = 'stone', stopMat = 'wood', c = 0.05 }) {
  const s = d / 2 + c + 0.25;
  return {
    blocks: [B(mat, 'circle', x, y + d / 2, d, d), B(stopMat, 'rect', x - s, y + 0.25, 0.5, 0.5), B(stopMat, 'rect', x + s, y + 0.25, 0.5, 0.5)],
    top: y + d,
  };
}

/** Pig centre for a support surface y (pig resting on it). */
export const PIG_R = { small: 0.405, medium: 0.6075, large: 0.8325, helmet: 0.63, mustache: 0.72, king: 1.17 };
export const pigOn = (type, x, y) => ({ type, x: r4(x), y: r4(y + PIG_R[type]) });

/** Flat ground from x0 to x1 with top at y=0 (static). */
export const flatGround = (x0 = -40, x1 = 140, depth = 10) => ({ kind: 'ground', points: [[x0, -depth], [x1, -depth], [x1, 0], [x0, 0]] });
/** Rectangular rock / plateau. */
export const plateau = (x0, x1, top, bottom = 0, kind = 'rock') => ({ kind, points: [[x0, bottom], [x1, bottom], [x1, top], [x0, top]] });
/** Trapezoid hill: flat top [x1,x2] at height h, slopes down to [x0, x3] at y=0. */
export const hill = (x0, x1, x2, x3, h, kind = 'ground') => ({ kind, points: [[x0, 0], [x3, 0], [x2, h], [x1, h]] });
