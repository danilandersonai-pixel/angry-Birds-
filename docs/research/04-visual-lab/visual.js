'use strict';
// Прототип визуальных рецептов для 04-visual.md (классический скрипт, глобальные функции).

// ───────────────────────── утилиты ─────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(h, a) { const c = hexRgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
function mixHex(h1, h2, t) {
  const a = hexRgb(h1), b = hexRgb(h2);
  return '#' + a.map((v, i) => Math.round(lerp(v, b[i], t)).toString(16).padStart(2, '0')).join('');
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

function valueNoise2D(seed, period) {
  const r = mulberry32(seed), g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    return lerp(lerp(g[y0 * period + x0], g[y0 * period + x1], u), lerp(g[y1 * period + x0], g[y1 * period + x1], u), v);
  };
}
// бесшовный тайл fBm: fn(v, x, y) -> [r,g,b,a]
function noiseTile(size, seed, cells, octaves, fn) {
  const c = makeCanvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const ns = []; for (let o = 0; o < octaves; o++) ns.push(valueNoise2D(seed + o * 101, cells << o));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) { const f = (cells << o) / size; v += amp * ns[o](x * f, y * f); norm += amp; amp *= 0.5; }
    const p = fn(v / norm, x, y), i = (y * size + x) * 4;
    img.data[i] = p[0]; img.data[i + 1] = p[1]; img.data[i + 2] = p[2]; img.data[i + 3] = p[3];
  }
  ctx.putImageData(img, 0, 0); return c;
}

// ───────────────────────── палитры тем ─────────────────────────
const THEMES = {
  meadow: {
    sky: [[0, '#3C9BE6'], [0.55, '#8CCFF4'], [1, '#DDF3F7']],
    sun: { x: 0.80, y: 0.15, r: 0.055, core: '#FFFBE6', glow: '#FFF1B0', glowA: 0.55 },
    cloud: { top: '#FFFFFF', bottom: '#D2E8F5', alpha: 0.95 },
    mountains: { fill: '#A3CDE0', light: '#C2E0EC', shade: '#86B5CD', snow: null },
    hillsFar: { top: '#94D283', bottom: '#74BA6C', rim: '#B9E59F', deco: '#69AF5F', decoLight: '#A6DB8E' },
    hillsNear: { top: '#66BF4B', bottom: '#45A03C', rim: '#93D85F', deco: '#3E9136', decoLight: '#7FCB55' },
    trees: { kind: 'round', trunk: '#7A5230', trunkDark: '#553820', leaf: '#4AA33A', leafLight: '#79C94C', leafDark: '#2E7A2A' },
    ground: { blades: 'grass', top: '#7CC83E', light: '#B0E35E', dark: '#4F9B2B', lip: '#3D8224', soil: '#8E5C34', soilDark: '#6C4325', soilDeep: '#4A2C16', pebble: '#B48A5C', pebbleDark: '#5A391D', outline: '#2D4515' },
    rock: { fill: '#8E8A84', light: '#B4B0A8', dark: '#66625D', outline: '#34312D' },
    fg: { a: '#3A8424', b: '#58A633', accent: '#FFE04A' },
    fog: '#DDF3F7',
  },
  beach: {
    sky: [[0, '#2D2A6C'], [0.33, '#7B3F8E'], [0.6, '#E2687A'], [0.8, '#FF9F58'], [1, '#FFD47E']],
    sun: { x: 0.62, y: 0.50, r: 0.09, core: '#FFF2BE', glow: '#FFB25A', glowA: 0.6 },
    cloud: { top: '#FFD0A8', bottom: '#C7678A', alpha: 0.92 },
    sea: { top: '#F6A766', bottom: '#8C4A86', sparkle: '#FFE6A8' },
    mountains: { fill: '#6C3F7C', light: '#8C568F', shade: '#55306A', snow: null },
    hillsFar: { top: '#C47E68', bottom: '#9E5A62', rim: '#F2AE7C', deco: '#8E4E5A', decoLight: '#D99073' },
    hillsNear: { top: '#E0A56C', bottom: '#BF7A58', rim: '#FFD08E', deco: '#B06E4C', decoLight: '#F0BC80' },
    trees: { kind: 'palm', trunk: '#6E412A', trunkDark: '#4E2C1C', leaf: '#2F6040', leafLight: '#5C8E46', leafDark: '#1F4430', rim: '#FFB070' },
    ground: { blades: 'none', top: '#F4CF8A', light: '#FFEABC', dark: '#D7A35C', lip: '#C08646', soil: '#E2B06A', soilDark: '#C8904E', soilDeep: '#A06A34', pebble: '#FFF2DA', pebbleDark: '#B5835A', outline: '#73441C' },
    rock: { fill: '#9A6E64', light: '#C2907E', dark: '#6E4A48', outline: '#3A2224' },
    fg: { a: '#556A2C', b: '#7C8C3A', accent: '#FF8A5C' },
    fog: '#FFB98A',
  },
  snow: {
    sky: [[0, '#2C6CC2'], [0.5, '#7BB4EA'], [1, '#E4F2FB']],
    sun: { x: 0.18, y: 0.13, r: 0.045, core: '#FFFFFF', glow: '#FFFFFF', glowA: 0.5 },
    cloud: { top: '#FFFFFF', bottom: '#C8D9EC', alpha: 0.9 },
    mountains: { fill: '#9BB2D7', light: '#C6D5EE', shade: '#7A92C0', snow: '#F6FAFF', snowShade: '#D2E0F2' },
    hillsFar: { top: '#7F96C4', bottom: '#6A80AE', rim: '#AFC2E2', deco: '#5E739F', decoLight: '#A3B6D8', snow: '#EEF4FC' },
    hillsNear: { top: '#EDF4FC', bottom: '#C5D6EB', rim: '#FFFFFF', deco: '#B2C6E0', decoLight: '#FFFFFF' },
    trees: { kind: 'pine', trunk: '#5A3E2B', trunkDark: '#3E2A1C', leaf: '#2F5E5B', leafLight: '#46806F', leafDark: '#1E403F', snow: '#F4F9FF', berm: '#DCE7F4' },
    ground: { blades: 'lumps', top: '#F7FBFF', light: '#FFFFFF', dark: '#CCDCEE', lip: '#AFC5DF', soil: '#7A87A2', soilDark: '#5F6A85', soilDeep: '#434B62', pebble: '#AAB6CC', pebbleDark: '#3E465B', outline: '#2A3247' },
    rock: { fill: '#7E8BA4', light: '#A9B6CC', dark: '#5B6680', outline: '#262D40' },
    fg: { a: '#DDE8F5', b: '#B6C9E2', accent: '#FFFFFF' },
    fog: '#E4F2FB',
  },
};
// ночной вариант = meadow + переопределения
THEMES.night = Object.assign({}, THEMES.meadow, {
  sky: [[0, '#0A1230'], [0.6, '#1D3162'], [1, '#3D5A8A']],
  sun: { x: 0.78, y: 0.16, r: 0.045, core: '#F4F0D6', glow: '#B8C8F0', glowA: 0.35, moon: true },
  cloud: { top: '#5C6F9C', bottom: '#2E3C66', alpha: 0.8 },
  mountains: { fill: '#2C3D68', light: '#3D5282', shade: '#22305A', snow: null },
  hillsFar: { top: '#2E5A55', bottom: '#22443F', rim: '#4C7F72', deco: '#204038', decoLight: '#3E6E62' },
  hillsNear: { top: '#2F6B3A', bottom: '#214D2A', rim: '#4E8F4A', deco: '#1C4424', decoLight: '#3F7E40' },
  trees: { kind: 'round', trunk: '#3E2C22', trunkDark: '#2A1D16', leaf: '#245A2E', leafLight: '#3C7E3E', leafDark: '#163C1E' },
  ground: { blades: 'grass', top: '#4E9A34', light: '#79BF4C', dark: '#336E22', lip: '#285A1A', soil: '#5A3A24', soilDark: '#43291A', soilDeep: '#2C1A10', pebble: '#7A5C40', pebbleDark: '#2E1C10', outline: '#14240C' },
  fg: { a: '#1A3A14', b: '#285222', accent: '#E8F07A' },
  fog: '#3D5A8A', stars: true,
});

// ───────────────────────── вид / камера ─────────────────────────
function makeView(W, H, viewH, camX, camY, time) {
  const scale = H / viewH;
  return { screenW: W, screenH: H, camX, camY, scale, dpr: 1, time, sRef: H / 15 };
}
function applyWorld(ctx, v) { ctx.setTransform(v.scale, 0, 0, -v.scale, v.screenW / 2 - v.camX * v.scale, v.screenH / 2 + v.camY * v.scale); }
function wsx(v, x) { return (x - v.camX) * v.scale + v.screenW / 2; }
function wsy(v, y) { return v.screenH / 2 - (y - v.camY) * v.scale; }

// ───────────────────────── параллакс ─────────────────────────
// layer: { f, fy, period(м), baseY(м), height(м над базой), depth(м под базой в тайле), build(ctx, P, sL, rng, pal) }
function layerScale(v, f) { return v.sRef * Math.pow(v.scale / v.sRef, f); }
const stripCache = new Map();
function getStrip(themeId, layer, sL, pal) {
  const bucket = Math.pow(2, Math.round(Math.log2(sL) * 4) / 4);
  const res = layer.res || 1; // доля разрешения (дальние слои — 0.5–0.75)
  const key = themeId + ':' + layer.id + ':' + bucket.toFixed(3);
  let s = stripCache.get(key);
  if (!s) {
    const ppm = bucket * res;
    const wPx = Math.round(layer.period * ppm), hPx = Math.ceil((layer.height + layer.depth) * ppm);
    const c = makeCanvas(wPx, hPx), ctx = c.getContext('2d');
    // система координат тайла: метры, X вправо, Y вверх, y=0 — база слоя
    ctx.setTransform(ppm, 0, 0, -ppm, 0, layer.height * ppm);
    layer.build(ctx, layer, pal, mulberry32(layer.seed || 7), ppm);
    if (layer.haze) { // атмосферная перспектива: подмешать цвет дымки
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = rgba(pal.fog, layer.haze); ctx.fillRect(0, 0, wPx, hPx); ctx.globalCompositeOperation = 'source-over';
    }
    s = { c, ppm, bucket };
    stripCache.set(key, s);
  }
  return s;
}
function drawLayer(ctx, v, themeId, layer, pal) {
  const sL = layerScale(v, layer.f), fy = layer.fy ?? layer.f;
  const s = getStrip(themeId, layer, sL, pal);
  const k = sL / s.ppm; // доп. масштаб при отрисовке
  const wPx = s.c.width * k, hPx = s.c.height * k;
  const drift = (layer.drift || 0) * v.time;
  // экранная X точки слоя xL: W/2 + (xL - camX*f)*sL ; экранная Y базы: H/2 + camY*fy*sL - baseY*sL
  let x0 = v.screenW / 2 + (drift - v.camX * layer.f) * sL;
  x0 = ((x0 % wPx) + wPx) % wPx - wPx;
  const yBase = v.screenH / 2 - (layer.baseY - v.camY * fy) * sL;
  const yTop = yBase - layer.height * sL;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let x = x0; x < v.screenW; x += wPx) ctx.drawImage(s.c, x, yTop, wPx + 0.5, hPx);
  if (layer.fillBelow) { // сплошная заливка до низа экрана
    const yB = yTop + hPx - 1;
    if (yB < v.screenH) { ctx.fillStyle = layer.fillBelow(pal); ctx.fillRect(0, yB, v.screenW, v.screenH - yB); }
  }
}

// периодический силуэт: sum a_k sin(2πk x/P + φ)
function periodicProfile(rng, P, terms) {
  const t = terms.map(([k, a]) => ({ k, a, ph: rng() * TAU }));
  return (x) => { let h = 0; for (const q of t) h += q.a * Math.sin(TAU * q.k * x / P + q.ph); return h; };
}
function ridgedProfile(rng, P, terms) {
  const t = terms.map(([k, a]) => ({ k, a, ph: rng() * Math.PI }));
  return (x) => { let h = 0; for (const q of t) h += q.a * (1 - Math.abs(Math.sin(Math.PI * q.k * x / P + q.ph))); return h; };
}

function buildMountains(ctx, L, pal, rng, ppm) {
  const C = pal.mountains, P = L.period;
  const prof = ridgedProfile(rng, P, [[2, 3.2], [3, 2.0], [5, 1.1], [9, 0.45]]);
  const N = Math.ceil(P * 6), H = (x) => 0.6 + prof(x) * 0.9 * (L.hScale || 1);
  const pts = []; for (let i = 0; i <= N; i++) { const x = (i / N) * P; pts.push([x, H(x)]); }
  const g = ctx.createLinearGradient(0, L.height, 0, -L.depth);
  g.addColorStop(0, C.light); g.addColorStop(0.55, C.fill); g.addColorStop(1, mixHex(C.fill, pal.fog, 0.45));
  ctx.beginPath(); ctx.moveTo(0, -L.depth); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.lineTo(P, -L.depth); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  // теневые склоны (dh/dx < 0 — смотрят вправо, свет слева-сверху)
  ctx.fillStyle = rgba(C.shade, 0.5);
  for (let i = 0; i < N;) {
    if (pts[i + 1][1] < pts[i][1]) {
      const s = i; while (i < N && pts[i + 1][1] < pts[i][1]) i++;
      ctx.beginPath(); ctx.moveTo(pts[s][0], pts[s][1]);
      for (let j = s; j <= i; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      // нижняя граница тени — смещённая влево копия гребня (мягкий клин)
      for (let j = i; j >= s; j--) ctx.lineTo(pts[j][0] - (pts[s][1] - pts[j][1]) * 0.55, pts[j][1] - (pts[s][1] - pts[j][1]) * 0.9 - 0.01);
      ctx.closePath(); ctx.fill();
    } else i++;
  }
  if (C.snow) { // снежные шапки: выше линии snowY с рваным краем
    const maxH = Math.max(...pts.map((p) => p[1])), snowY = L.snowY ?? maxH * 0.62;
    ctx.beginPath(); ctx.moveTo(0, L.height);
    for (let i = 0; i <= N; i++) { const x = (i / N) * P; ctx.lineTo(x, snowY + 0.35 * Math.sin(x * 2.3) + 0.25 * Math.sin(x * 5.1 + 1)); }
    ctx.lineTo(P, L.height); ctx.closePath();
    ctx.fillStyle = C.snow; ctx.fill();
  }
  // туман у подножия
  const fog = ctx.createLinearGradient(0, 1.2, 0, -L.depth);
  fog.addColorStop(0, rgba(pal.fog, 0)); fog.addColorStop(1, rgba(pal.fog, 0.55));
  ctx.fillStyle = fog; ctx.fillRect(0, -L.depth, P, 1.2 + L.depth);
  ctx.restore();
}

function buildHills(ctx, L, pal, rng, ppm) {
  const C = L.near ? pal.hillsNear : pal.hillsFar, P = L.period;
  const prof = periodicProfile(rng, P, L.terms);
  const N = Math.ceil(P * 5), H = (x) => L.amp0 + prof(x);
  ctx.beginPath(); ctx.moveTo(0, -L.depth);
  for (let i = 0; i <= N; i++) { const x = (i / N) * P; ctx.lineTo(x, H(x)); }
  ctx.lineTo(P, -L.depth); ctx.closePath();
  const g = ctx.createLinearGradient(0, L.height, 0, -L.depth);
  g.addColorStop(0, C.top); g.addColorStop(1, C.bottom);
  ctx.fillStyle = g; ctx.fill();
  ctx.save(); ctx.clip();
  // кромка-рим: светлая полоса вдоль гребня
  ctx.beginPath();
  for (let i = 0; i <= N; i++) { const x = (i / N) * P; i ? ctx.lineTo(x, H(x) - 0.07) : ctx.moveTo(x, H(x) - 0.07); }
  ctx.lineWidth = 0.16; ctx.strokeStyle = rgba(C.rim, 0.85); ctx.stroke();
  // декор: кусты/деревца-«леденцы» по гребню
  const count = Math.round(P * (L.decoDensity || 0.5));
  for (let i = 0; i < count; i++) {
    const x = rng() * P, y = H(x) - 0.05, r = lerp(0.25, 0.55, rng()) * (L.decoScale || 1);
    for (const dx of [0, P, -P]) {
      if (x + dx < -1 || x + dx > P + 1) continue;
      if (L.trees && rng() < 0.45) { // деревце
        ctx.fillStyle = C.deco; ctx.fillRect(x + dx - r * 0.12, y, r * 0.24, r * 1.2);
        ctx.beginPath(); ctx.arc(x + dx, y + r * 1.6, r * 0.75, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(C.decoLight, 0.8); ctx.beginPath(); ctx.arc(x + dx - r * 0.2, y + r * 1.8, r * 0.38, 0, TAU); ctx.fill();
      } else { // куст: 3 круга
        ctx.fillStyle = C.deco; ctx.beginPath();
        ctx.arc(x + dx - r * 0.6, y + r * 0.25, r * 0.55, 0, TAU); ctx.arc(x + dx, y + r * 0.45, r * 0.7, 0, TAU); ctx.arc(x + dx + r * 0.6, y + r * 0.2, r * 0.5, 0, TAU); ctx.fill();
        ctx.fillStyle = rgba(C.decoLight, 0.75); ctx.beginPath(); ctx.arc(x + dx - r * 0.15, y + r * 0.7, r * 0.32, 0, TAU); ctx.fill();
      }
    }
  }
  if (C.snow) { ctx.fillStyle = C.snow; ctx.beginPath(); for (let i = 0; i <= N; i++) { const x = (i / N) * P; i ? ctx.lineTo(x, H(x) - 0.12) : ctx.moveTo(x, H(x) - 0.12); } for (let i = N; i >= 0; i--) { const x = (i / N) * P; ctx.lineTo(x, H(x) + 0.2); } ctx.fill(); }
  // атмосферная дымка книзу
  const fog = ctx.createLinearGradient(0, L.amp0, 0, -L.depth);
  fog.addColorStop(0, rgba(pal.fog, 0)); fog.addColorStop(1, rgba(pal.fog, L.near ? 0.12 : 0.3));
  ctx.fillStyle = fog; ctx.fillRect(0, -L.depth, P, L.amp0 + L.depth);
  ctx.restore();
}

function drawRoundTree(ctx, x, h, C, rng) {
  const tw = h * 0.09;
  ctx.fillStyle = C.trunk; ctx.beginPath(); ctx.moveTo(x - tw, -0.2); ctx.lineTo(x - tw * 0.6, h * 0.55); ctx.lineTo(x + tw * 0.6, h * 0.55); ctx.lineTo(x + tw, -0.2); ctx.fill();
  ctx.fillStyle = C.trunkDark; ctx.fillRect(x + tw * 0.15, -0.2, tw * 0.6, h * 0.5);
  const blobs = [[0, 0.72, 0.30], [-0.2, 0.6, 0.22], [0.22, 0.62, 0.22], [-0.08, 0.86, 0.2], [0.12, 0.84, 0.18]];
  ctx.fillStyle = C.leafDark; ctx.beginPath();
  for (const b of blobs) { ctx.moveTo(x + b[0] * h + b[2] * h * 1.08, b[1] * h); ctx.arc(x + b[0] * h, b[1] * h - 0.03 * h, b[2] * h * 1.08, 0, TAU); } ctx.fill();
  ctx.fillStyle = C.leaf; ctx.beginPath();
  for (const b of blobs) { ctx.moveTo(x + b[0] * h + b[2] * h, b[1] * h); ctx.arc(x + b[0] * h, b[1] * h, b[2] * h, 0, TAU); } ctx.fill();
  ctx.fillStyle = rgba(C.leafLight, 0.9); ctx.beginPath();
  for (const b of blobs) { ctx.moveTo(x + (b[0] - 0.06) * h + b[2] * h * 0.5, (b[1] + 0.07) * h); ctx.arc(x + (b[0] - 0.06) * h, (b[1] + 0.07) * h, b[2] * h * 0.5, 0, TAU); } ctx.fill();
}
function drawPine(ctx, x, h, C) {
  ctx.fillStyle = C.trunk; ctx.fillRect(x - h * 0.04, -0.2, h * 0.08, h * 0.25);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const y0 = h * (0.15 + i * 0.2), w = h * (0.34 - i * 0.065), top = y0 + h * 0.34;
    ctx.fillStyle = C.leaf; ctx.beginPath(); ctx.moveTo(x - w, y0); ctx.lineTo(x, top); ctx.lineTo(x + w, y0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.leafDark; ctx.beginPath(); ctx.moveTo(x, y0 - 0.02); ctx.lineTo(x, top); ctx.lineTo(x + w, y0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.snow; ctx.beginPath(); ctx.moveTo(x - w * 0.55, y0 + h * 0.15); ctx.lineTo(x, top); ctx.lineTo(x + w * 0.45, y0 + h * 0.17);
    ctx.quadraticCurveTo(x + w * 0.1, y0 + h * 0.1, x - w * 0.55, y0 + h * 0.15); ctx.fill();
  }
}
function drawPalm(ctx, x, h, C, rng) {
  const lean = (rng() - 0.3) * 0.5 * h;
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.trunk; ctx.lineWidth = h * 0.07;
  ctx.beginPath(); ctx.moveTo(x, -0.2); ctx.quadraticCurveTo(x + lean * 0.2, h * 0.5, x + lean, h); ctx.stroke();
  ctx.strokeStyle = C.trunkDark; ctx.lineWidth = h * 0.012;
  for (let i = 1; i < 10; i++) { const t = i / 10; const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * (x + lean * 0.2) + t * t * (x + lean), py = 2 * (1 - t) * t * h * 0.5 + t * t * h; ctx.beginPath(); ctx.moveTo(px - h * 0.035, py - 0.01); ctx.lineTo(px + h * 0.035, py + 0.02); ctx.stroke(); }
  const tx = x + lean, ty = h;
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.05 + i / 6 * 0.9) + (rng() - 0.5) * 0.2, L = h * lerp(0.42, 0.55, rng());
    const ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.45 - L * 0.35;
    const mx = tx + Math.cos(a) * L * 0.5, my = ty + Math.sin(a) * L * 0.5 + L * 0.12;
    ctx.fillStyle = i % 2 ? C.leaf : C.leafDark;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(mx, my + h * 0.07, ex, ey); ctx.quadraticCurveTo(mx, my - h * 0.03, tx, ty); ctx.fill();
    if (C.rim) { ctx.strokeStyle = rgba(C.rim, 0.6); ctx.lineWidth = h * 0.01; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(mx, my + h * 0.07, ex, ey); ctx.stroke(); }
  }
  ctx.fillStyle = '#5A3A22'; ctx.beginPath(); ctx.arc(tx + h * 0.03, ty - h * 0.03, h * 0.035, 0, TAU); ctx.arc(tx - h * 0.04, ty - h * 0.04, h * 0.03, 0, TAU); ctx.fill();
}
function buildTrees(ctx, L, pal, rng, ppm) {
  const C = pal.trees, P = L.period;
  // подложка: пологий вал кустов, чтобы деревья не «висели»
  ctx.fillStyle = C.berm || C.leafDark;
  ctx.beginPath(); ctx.moveTo(0, -L.depth);
  for (let i = 0; i <= 200; i++) { const x = i / 200 * P; ctx.lineTo(x, 0.35 + 0.25 * Math.sin(x * 1.7) + 0.15 * Math.sin(x * 4.3 + 2)); }
  ctx.lineTo(P, -L.depth); ctx.closePath(); ctx.fill();
  const n = Math.round(P / 3.2);
  const items = [];
  for (let i = 0; i < n; i++) items.push([(i + rng() * 0.8) * P / n, lerp(2.4, 4.6, rng())]);
  for (const [x, h] of items) for (const dx of [0, -P, P]) {
    if (x + dx < -3 || x + dx > P + 3) continue;
    if (C.kind === 'round') drawRoundTree(ctx, x + dx, h, C, rng);
    else if (C.kind === 'pine') drawPine(ctx, x + dx, h * 1.15, C);
    else drawPalm(ctx, x + dx, h * 1.25, C, mulberry32(Math.floor(x * 1000)));
  }
}

// облако: объединение кругов + градиент + подбрюшье
function cloudSprite(seed, widthM, ppm, C) {
  const rng = mulberry32(seed), w = widthM, h = w * 0.42;
  const c = makeCanvas((w + 0.4) * ppm, (h + 0.7) * ppm), ctx = c.getContext('2d');
  ctx.setTransform(ppm, 0, 0, ppm, 0.2 * ppm, 0.5 * ppm); // метры, Y вниз, (0,0) — левый верх
  const base = h * 0.78; // плоское дно
  const blobs = [];
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = w * (0.12 + 0.76 * t);
    const r = h * (0.28 + 0.34 * Math.sin(Math.PI * t)) * lerp(0.85, 1.15, rng());
    blobs.push([x, base - r * 0.55, r]);
  }
  const path = new Path2D();
  for (const [x, y, r] of blobs) { path.moveTo(x + r, y); path.arc(x, y, r, 0, TAU); }
  path.rect(w * 0.1, base - h * 0.25, w * 0.8, h * 0.25);
  ctx.save(); ctx.beginPath(); ctx.rect(-1, -1, w + 2, base + 1); ctx.clip(); // срез дна
  const g = ctx.createLinearGradient(0, 0, 0, base);
  g.addColorStop(0, C.top); g.addColorStop(0.55, C.top); g.addColorStop(1, C.bottom);
  ctx.fillStyle = g; ctx.fill(path);
  ctx.clip(path);
  // подбрюшье: тень снизу-справа
  ctx.fillStyle = rgba(C.bottom, 0.55);
  for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x + r * 0.25, y + r * 0.45, r * 0.8, 0, TAU); ctx.fill(); }
  // блики сверху-слева
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (const [x, y, r] of blobs) { ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.45, 0, TAU); ctx.fill(); }
  ctx.restore();
  return c;
}
function buildClouds(ctx, L, pal, rng, ppm) {
  const P = L.period;
  ctx.save(); ctx.globalAlpha = pal.cloud.alpha;
  for (let i = 0; i < L.count; i++) {
    const w = lerp(L.wMin, L.wMax, rng()), x = (i + rng() * 0.6) * P / L.count, y = lerp(L.yMin, L.yMax, rng());
    const spr = cloudSprite(Math.floor(rng() * 1e6), w, ppm, pal.cloud);
    for (const dx of [0, -P]) {
      ctx.save(); ctx.translate(x + dx, y); ctx.scale(1 / ppm, -1 / ppm); ctx.drawImage(spr, 0, -spr.height); ctx.restore();
    }
  }
  ctx.restore();
}

function themeLayers(themeId) {
  const T = THEMES[themeId];
  const L = [];
  L.push({ id: 'cloudsFar', f: 0.05, period: 70, baseY: 1.0, height: 7.5, depth: 0, res: 0.75, build: buildClouds, count: 7, wMin: 3, wMax: 6, yMin: 1.6, yMax: 4.6, drift: 0.25, seed: 3 });
  L.push({ id: 'mountains', f: 0.12, period: 64, baseY: -1.0, height: 7.5, hScale: themeId === 'beach' ? 0.4 : 1, depth: 1.5, res: 0.75, build: buildMountains, seed: 11, fillBelow: (p) => mixHex(p.mountains.fill, p.fog, 0.45) });
  if (themeId === 'snow') L.push({ id: 'hillsFar', f: 0.25, period: 48, baseY: -1.5, height: 4.2, depth: 1.5, res: 0.75, build: (ctx, l, pal, rng, ppm) => buildMountains(ctx, Object.assign({}, l, { height: 4.2 }), Object.assign({}, pal, { mountains: { fill: pal.hillsFar.top, light: pal.hillsFar.rim, shade: pal.hillsFar.deco, snow: pal.hillsFar.snow } }), rng, ppm), seed: 21, fillBelow: (p) => mixHex(p.hillsFar.top, p.fog, 0.45) });
  else L.push({ id: 'hillsFar', f: 0.25, period: 44, baseY: -1.5, height: 4.0, depth: 1.5, res: 0.75, build: buildHills, terms: [[1, 0.6], [2, 0.5], [3, 0.35], [5, 0.15]], amp0: 2.1, decoDensity: 0.7, decoScale: 0.7, trees: true, seed: 21, fillBelow: (p) => p.hillsFar.bottom });
  L.push({ id: 'cloudsNear', f: 0.18, period: 90, baseY: 3.0, height: 6, depth: 0, res: 0.75, build: buildClouds, count: 4, wMin: 4, wMax: 7, yMin: 0.4, yMax: 2.6, drift: 0.5, seed: 5 });
  L.push({ id: 'hillsNear', f: 0.4, period: 36, baseY: -2.0, height: 3.4, depth: 1.5, build: buildHills, terms: [[1, 0.45], [2, 0.35], [4, 0.2], [6, 0.08]], amp0: 1.5, near: true, decoDensity: 0.45, seed: 31, fillBelow: (p) => p.hillsNear.bottom });
  L.push({ id: 'trees', f: 0.62, period: 30, baseY: -1.6, height: 8.5, depth: 1.5, build: buildTrees, seed: 41, haze: 0.18, fillBelow: (p) => mixHex(p.trees.berm || p.trees.leafDark, p.fog, 0.18) });
  return L;
}

function drawSky(ctx, v, T) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 0, v.screenH);
  for (const [o, c] of T.sky) g.addColorStop(o, c);
  ctx.fillStyle = g; ctx.fillRect(0, 0, v.screenW, v.screenH);
  if (T.stars) { const r = mulberry32(99); ctx.fillStyle = '#FFFFFF'; for (let i = 0; i < 90; i++) { ctx.globalAlpha = lerp(0.3, 1, r()); ctx.beginPath(); ctx.arc(r() * v.screenW, r() * v.screenH * 0.6, lerp(0.6, 1.8, r()), 0, TAU); ctx.fill(); } ctx.globalAlpha = 1; }
  // солнце/луна: f = 0.02
  const S = T.sun, R = S.r * v.screenH;
  const sx = S.x * v.screenW - v.camX * 0.02 * v.sRef, sy = S.y * v.screenH + v.camY * 0.02 * v.sRef;
  const glow = ctx.createRadialGradient(sx, sy, R * 0.6, sx, sy, R * 4.5);
  glow.addColorStop(0, rgba(S.glow, S.glowA)); glow.addColorStop(1, rgba(S.glow, 0));
  ctx.fillStyle = glow; ctx.fillRect(sx - R * 4.5, sy - R * 4.5, R * 9, R * 9);
  const core = ctx.createRadialGradient(sx - R * 0.3, sy - R * 0.3, R * 0.1, sx, sy, R);
  core.addColorStop(0, '#FFFFFF'); core.addColorStop(1, S.core);
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(sx, sy, R, 0, TAU); ctx.fill();
  if (S.moon) { ctx.fillStyle = 'rgba(160,170,200,0.35)'; for (const [dx, dy, rr] of [[-0.3, -0.2, 0.2], [0.25, 0.1, 0.14], [-0.05, 0.35, 0.1]]) { ctx.beginPath(); ctx.arc(sx + dx * R, sy + dy * R, rr * R, 0, TAU); ctx.fill(); } }
}
function drawSea(ctx, v, T) { // для пляжа: полоса моря между дальними и ближними слоями
  if (!T.sea) return;
  const sL = layerScale(v, 0.1);
  const yH = v.screenH / 2 - (-0.6 - v.camY * 0.1) * sL;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, yH, 0, v.screenH);
  g.addColorStop(0, T.sea.top); g.addColorStop(0.5, T.sea.bottom); g.addColorStop(1, T.sea.bottom);
  ctx.fillStyle = g; ctx.fillRect(0, yH, v.screenW, v.screenH - yH);
  // дорожка от солнца
  const sx = T.sun.x * v.screenW - v.camX * 0.02 * v.sRef, r = mulberry32(5);
  ctx.fillStyle = rgba(T.sea.sparkle, 0.8);
  for (let i = 0; i < 26; i++) { const t = i / 26, yy = yH + 4 + t * t * (v.screenH * 0.25), ww = (20 + t * 140) * lerp(0.4, 1, r()); ctx.globalAlpha = 0.85 - t * 0.6; ctx.fillRect(sx - ww / 2 + (r() - 0.5) * 40 * t, yy, ww, 2 + t * 3); }
  ctx.globalAlpha = 1;
}
function drawBackground(ctx, v, themeId) {
  const T = THEMES[themeId];
  drawSky(ctx, v, T);
  const layers = themeLayers(themeId);
  for (const L of layers) {
    if (L.id === 'hillsFar') drawSea(ctx, v, T);
    if (themeId === 'beach' && L.id === 'hillsFar') continue; // на пляже вместо дальних холмов — море
    drawLayer(ctx, v, themeId, L, T);
  }
}

// ───────────────────────── рельеф ─────────────────────────
const tileCache = new Map();
function soilTile(themeId) {
  if (tileCache.has(themeId)) return tileCache.get(themeId);
  const G = THEMES[themeId].ground, S = 256;
  const a = hexRgb(G.soil), b = hexRgb(G.soilDark);
  const c = noiseTile(S, 17, 8, 3, (v) => { const t = clamp((v - 0.35) * 2.2, 0, 1); return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), 255]; });
  const ctx = c.getContext('2d'), r = mulberry32(23);
  // камушки: 28 шт на тайл 4×4 м (тайл 256 px = 4 м)
  for (let i = 0; i < 28; i++) {
    const x = r() * S, y = r() * S, rx = lerp(4, 11, r()), ry = rx * lerp(0.55, 0.8, r()), ang = r() * Math.PI;
    for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) {
      ctx.save(); ctx.translate(x + dx, y + dy); ctx.rotate(ang);
      ctx.fillStyle = G.pebbleDark; ctx.beginPath(); ctx.ellipse(0, 0, rx + 1.5, ry + 1.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = G.pebble; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.ellipse(-rx * 0.3, -ry * 0.35, rx * 0.4, ry * 0.3, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }
  tileCache.set(themeId, c); return c;
}
function polyNormalsTop(pts) { // индексы рёбер, смотрящих вверх (для полигона против часовой)
  let area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const ccw = area > 0, res = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    let nx = dy / len, ny = -dx / len; if (!ccw) { nx = -nx; ny = -ny; }
    res.push({ a, b, nx, ny, top: ny > 0.45 });
  }
  return res;
}
function drawTerrain(ctx, v, terrain, themeId) {
  const T = THEMES[themeId], G = T.ground;
  applyWorld(ctx, v);
  const px = 1 / v.scale; // 1 экранный пиксель в метрах
  for (const t of terrain) {
    const C = t.kind === 'rock' ? T.rock : null;
    const path = new Path2D(); t.points.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1]))); path.closePath();
    if (C) {
      const g = ctx.createLinearGradient(0, 3, 0, -2); g.addColorStop(0, C.light); g.addColorStop(1, C.dark);
      ctx.fillStyle = g; ctx.fill(path);
    } else {
      const pat = ctx.createPattern(soilTile(themeId), 'repeat');
      pat.setTransform(new DOMMatrix().scale(4 / 256, -4 / 256)); // тайл 256 px = 4 м, флип Y
      ctx.fillStyle = pat; ctx.fill(path);
      // затемнение с глубиной
      const g = ctx.createLinearGradient(0, 0, 0, -5); g.addColorStop(0, rgba(G.soilDeep, 0)); g.addColorStop(1, rgba(G.soilDeep, 0.75));
      ctx.fillStyle = g; ctx.fill(path);
    }
    ctx.save(); ctx.clip(path);
    if (!C) {
      // травяная/песчаная/снежная кромка вдоль верхних рёбер
      const edges = polyNormalsTop(t.points);
      for (const e of edges) {
        if (!e.top) continue;
        const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), n = Math.max(1, Math.round(len / 0.22));
        const thick = 0.34, tx = (e.b[0] - e.a[0]) / len, ty = (e.b[1] - e.a[1]) / len;
        const band = new Path2D();
        band.moveTo(e.a[0] + e.nx * 0.05, e.a[1] + e.ny * 0.05); band.lineTo(e.b[0] + e.nx * 0.05, e.b[1] + e.ny * 0.05);
        for (let i = n; i >= 0; i--) { // фестончатый нижний край
          const s = (i / n) * len, d = thick + (i % 2 ? 0.0 : 0.09);
          const x = e.a[0] + tx * s - e.nx * d, y = e.a[1] + ty * s - e.ny * d;
          band.lineTo(x, y);
        }
        band.closePath();
        ctx.fillStyle = G.lip; ctx.save(); ctx.translate(0, -0.06); ctx.fill(band); ctx.restore(); // тень под кромкой
        const g = ctx.createLinearGradient(0, e.a[1], 0, e.a[1] - thick - 0.1);
        g.addColorStop(0, G.top); g.addColorStop(1, G.dark);
        ctx.fillStyle = g; ctx.fill(band);
        ctx.strokeStyle = G.light; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(e.a[0] - e.nx * 0.06, e.a[1] - e.ny * 0.06); ctx.lineTo(e.b[0] - e.nx * 0.06, e.b[1] - e.ny * 0.06); ctx.stroke();
      }
    } else {
      // скала: трещины-штрихи
      const r = mulberry32(5); ctx.strokeStyle = rgba(C.outline, 0.45); ctx.lineWidth = 0.05; ctx.lineCap = 'round';
      const xs = t.points.map((p) => p[0]), ys = t.points.map((p) => p[1]);
      for (let i = 0; i < 9; i++) { let x = lerp(Math.min(...xs), Math.max(...xs), r()), y = lerp(Math.min(...ys), Math.max(...ys), r()); ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 3; k++) { x += (r() - 0.5) * 0.7; y -= r() * 0.5; ctx.lineTo(x, y); } ctx.stroke(); }
    }
    ctx.restore();
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(0.06, 1.5 * px); ctx.strokeStyle = C ? C.outline : G.outline; ctx.stroke(path);
    if (!C && G.blades === 'lumps') { // снег: бугорки поверх контура
      const edges = polyNormalsTop(t.points); const r = mulberry32(77); ctx.fillStyle = G.top;
      for (const e of edges) { if (!e.top) continue; const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]), tx = (e.b[0] - e.a[0]) / len, ty = (e.b[1] - e.a[1]) / len;
        ctx.beginPath(); for (let s = 0.1; s < len; s += lerp(0.3, 0.6, r())) { const x = e.a[0] + tx * s, y = e.a[1] + ty * s, rr = lerp(0.06, 0.12, r()); ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, Math.PI); } ctx.fill();
        ctx.strokeStyle = G.outline; ctx.lineWidth = Math.max(0.03, 1.2 * px); }
    }
    if (!C && G.blades === 'grass') { // травинки поверх контура
      const edges = polyNormalsTop(t.points); const r = mulberry32(77);
      ctx.fillStyle = G.dark;
      for (const e of edges) {
        if (!e.top) continue;
        const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]); const tx = (e.b[0] - e.a[0]) / len, ty = (e.b[1] - e.a[1]) / len;
        ctx.beginPath();
        for (let s = 0.05; s < len; s += lerp(0.09, 0.2, r())) {
          const x = e.a[0] + tx * s, y = e.a[1] + ty * s, h = lerp(0.07, 0.17, r()), lean = (r() - 0.5) * 0.08;
          ctx.moveTo(x - 0.035, y - 0.02); ctx.lineTo(x + lean, y + h); ctx.lineTo(x + 0.035, y - 0.02);
        }
        ctx.fill();
      }
    }
  }
}

function drawForeground(ctx, v, themeId) {
  // Передний план: пучки травы/осоки/сугробы у нижней кромки. X-параллакс f = 1.2, Y — как мир.
  const T = THEMES[themeId], f = 1.2, k = 1.08; // k — пучки «ближе» камеры, чуть крупнее
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const yb = wsy(v, -0.55);
  if (yb - 0.8 * v.scale * k > v.screenH) return;
  const P = 18 * v.scale * k, x0 = ((-(v.camX * f) * v.scale * k) % P + P) % P - P;
  for (let x = x0; x < v.screenW + P; x += P) {
    const rr = mulberry32(8);
    for (let i = 0; i < 9; i++) {
      const cx = x + rr() * P, s = v.scale * k * lerp(0.7, 1.1, rr());
      if (themeId === 'snow') { // сугроб-бугор
        ctx.fillStyle = T.fg.b; ctx.beginPath(); ctx.ellipse(cx + 0.06 * s, yb + 0.1 * s, 1.0 * s, 0.5 * s, 0, Math.PI, TAU); ctx.fill();
        ctx.fillStyle = T.fg.a; ctx.beginPath(); ctx.ellipse(cx, yb + 0.12 * s, 0.95 * s, 0.45 * s, 0, Math.PI, TAU); ctx.fill();
        continue;
      }
      const blades = 6 + Math.floor(rr() * 4);
      for (let j = 0; j < blades; j++) {
        const u = j / (blades - 1) - 0.5, h = s * lerp(0.35, 0.75, rr()) * (1 - Math.abs(u) * 0.6), lean = u * 0.9 * s + (rr() - 0.5) * 0.15 * s;
        const bx = cx + u * 0.35 * s, bw = 0.07 * s;
        ctx.fillStyle = j % 2 ? T.fg.a : T.fg.b;
        ctx.beginPath(); ctx.moveTo(bx - bw, yb + 0.1 * s);
        ctx.quadraticCurveTo(bx - bw * 0.2 + lean * 0.3, yb - h * 0.6, bx + lean, yb - h);
        ctx.quadraticCurveTo(bx + bw * 0.6 + lean * 0.3, yb - h * 0.5, bx + bw, yb + 0.1 * s); ctx.fill();
      }
      if (T.fg.accent && rr() < 0.3) { // цветок/ягода
        const fx = cx + (rr() - 0.5) * 0.2 * s, fy = yb - 0.55 * s;
        ctx.fillStyle = T.fg.accent; ctx.beginPath(); for (let q = 0; q < 5; q++) { const a = q / 5 * TAU; ctx.moveTo(fx + Math.cos(a) * 0.07 * s + 0.045 * s, fy + Math.sin(a) * 0.07 * s); ctx.arc(fx + Math.cos(a) * 0.07 * s, fy + Math.sin(a) * 0.07 * s, 0.045 * s, 0, TAU); } ctx.fill();
        ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(fx, fy, 0.035 * s, 0, TAU); ctx.fill();
      }
    }
  }
}

// ───────────────────────── блоки ─────────────────────────
const MAT = {
  wood: { light: '#F0C27A', base: '#D08F45', dark: '#9C6030', deep: '#7A4620', outline: '#4A2810', grain: '#A9672E', knot: '#7E4A20', crack: '#3A1E0A', crackLight: '#FFE2A8', nail: '#6A6A70' },
  ice: { light: '#E6FAFF', base: '#A8E2F8', dark: '#6CC0E8', deep: '#3F9BD0', outline: '#246A9E', crack: '#FFFFFF', crackDark: '#2F7FB8', alpha: 0.86 },
  stone: { light: '#CDD1D6', base: '#A3A9B0', dark: '#767D86', deep: '#5B626B', outline: '#30353C', crack: '#2A2F35', crackLight: '#E3E6E9', chip: '#BCC1C7' },
};
const OUT_BLOCK = 0.035; // м — обводка блоков

function rectPath(w, h, r) { const p = new Path2D(); p.roundRect(-w / 2, -h / 2, w, h, r); return p; }
function blockPath(shape, w, h, r) {
  if (shape === 'circle') { const p = new Path2D(); p.arc(0, 0, w / 2, 0, TAU); return p; }
  if (shape === 'triangle') { const p = new Path2D(); p.moveTo(-w / 2, h / 2); p.lineTo(-w / 2, -h / 2); p.lineTo(w / 2, h / 2); p.closePath(); return p; } // прямой угол внизу слева (Y вниз!)
  if (shape === 'isoTriangle') { const p = new Path2D(); p.moveTo(-w / 2, h / 2); p.lineTo(0, -h / 2); p.lineTo(w / 2, h / 2); p.closePath(); return p; }
  return rectPath(w, h, r);
}

// трещины: детерминированный список ломаных, раскрываемых по стадиям
function genCracks(rng, w, h, n, segLen, jitter, branchP) {
  const cracks = [];
  for (let i = 0; i < n; i++) {
    // старт — на случайной кромке, направление внутрь
    const side = Math.floor(rng() * 4); let x, y, a;
    if (side === 0) { x = lerp(-w / 2, w / 2, rng()); y = -h / 2; a = Math.PI / 2; }
    else if (side === 1) { x = w / 2; y = lerp(-h / 2, h / 2, rng()); a = Math.PI; }
    else if (side === 2) { x = lerp(-w / 2, w / 2, rng()); y = h / 2; a = -Math.PI / 2; }
    else { x = -w / 2; y = lerp(-h / 2, h / 2, rng()); a = 0; }
    const maxLen = Math.min(w, h) * lerp(0.5, 1.1, rng()) + Math.max(w, h) * 0.15 * rng();
    const walk = (x, y, a, len, depth) => {
      const pts = [[x, y]]; let L = 0;
      while (L < len) {
        a += (rng() - 0.5) * 2 * jitter; const s = segLen * lerp(0.6, 1.4, rng());
        x += Math.cos(a) * s; y += Math.sin(a) * s; L += s; pts.push([x, y]);
        if (depth < 1 && rng() < branchP) cracks.push({ pts: walk(x, y, a + (rng() < 0.5 ? -1 : 1) * lerp(0.5, 1.0, rng()), len * 0.4, depth + 1), w: 0.6, stage: cracks.length });
      }
      return pts;
    };
    cracks.push({ pts: walk(x, y, a, maxLen, 0), w: 1, stage: i });
  }
  return cracks;
}
function strokeCrack(ctx, pts, wMain, cDark, cLight, offs) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // светлая грань (свет сверху-слева → освещена нижне-правая стенка)
  ctx.strokeStyle = cLight; ctx.lineWidth = wMain * 0.55;
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + offs, p[1] + offs) : ctx.moveTo(p[0] + offs, p[1] + offs))); ctx.stroke();
  // тёмная щель, сужающаяся к концу
  ctx.strokeStyle = cDark;
  for (let i = 1; i < pts.length; i++) {
    ctx.lineWidth = wMain * lerp(1, 0.35, i / pts.length);
    ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
  }
}
function chipCorner(ctx, w, h, rng, corner, size, outline, lw, clipPath) {
  const sx = corner & 1 ? 1 : -1, sy = corner & 2 ? 1 : -1, cx = sx * w / 2, cy = sy * h / 2;
  const a = size * lerp(0.7, 1.2, rng()), b = size * lerp(0.7, 1.2, rng());
  const p = new Path2D();
  p.moveTo(cx - sx * a, cy + sy * 0.02); p.lineTo(cx - sx * a * 0.55, cy - sy * b * 0.35); p.lineTo(cx - sx * a * 0.2, cy - sy * b * 0.55); p.lineTo(cx + sx * 0.02, cy - sy * b); p.lineTo(cx + sx * 0.05, cy + sy * 0.05); p.closePath();
  ctx.save(); ctx.clip(clipPath); ctx.strokeStyle = outline; ctx.lineWidth = lw * 2; ctx.lineJoin = 'round'; ctx.stroke(p); ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fill(p); ctx.restore();
}

function renderBlock(material, shape, w, h, stage, seed, ppu) {
  const pad = OUT_BLOCK + 2 / ppu;
  const bw = shape === 'circle' ? w : w, bh = shape === 'circle' ? w : h;
  const c = makeCanvas((bw + pad * 2) * ppu, (bh + pad * 2) * ppu), ctx = c.getContext('2d');
  ctx.setTransform(ppu, 0, 0, ppu, c.width / 2, c.height / 2);
  const M = MAT[material], rng = mulberry32(seed * 7919 + 13), mn = Math.min(bw, bh), mx = Math.max(bw, bh);
  const lw = Math.max(OUT_BLOCK, 1.5 / ppu);
  const rr = material === 'stone' ? clamp(0.14 * mn, 0.02, 0.09) : clamp(0.07 * mn, 0.012, 0.05);
  const path = blockPath(shape, bw, bh, rr);
  const horiz = bw >= bh;
  if (material === 'wood') drawWood(ctx, M, shape, bw, bh, path, rng, horiz, mn, mx);
  else if (material === 'ice') drawIce(ctx, M, shape, bw, bh, path, rng, mn, mx);
  else drawStone(ctx, M, shape, bw, bh, path, rng, mn, mx, ppu);
  ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = M.outline; ctx.stroke(path);
  // повреждения
  if (stage > 0) {
    const crng = mulberry32(seed * 31 + 7);
    ctx.save(); ctx.clip(path);
    if (material === 'ice') drawIceCracks(ctx, M, bw, bh, stage, crng, mn);
    else {
      const all = genCracks(crng, bw, bh, 6, material === 'wood' ? 0.07 : 0.055, material === 'wood' ? 0.35 : 0.75, material === 'wood' ? 0.25 : 0.35);
      const reveal = [0, 1, 3, 6][stage];
      const wMain = material === 'wood' ? clamp(0.045 * mn + 0.012, 0.016, 0.034) : clamp(0.05 * mn + 0.014, 0.018, 0.04);
      for (const cr of all) if (cr.stage < reveal) strokeCrack(ctx, cr.pts, wMain * cr.w, M.crack, rgba(M.crackLight, 0.7), wMain * 0.45);
    }
    ctx.restore();
    if (stage >= 2 && shape !== 'circle') {
      const corners = stage === 2 ? 1 : 2;
      const csz = clamp(0.22 * mn, 0.04, 0.16) * (stage === 3 ? 1.3 : 0.8);
      for (let i = 0; i < corners; i++) chipCorner(ctx, bw, bh, crngSafe(seed, i), Math.floor(crngSafe(seed, 9 + i)() * 4), csz, M.outline, lw, path);
    }
  }
  return c;
}
function crngSafe(seed, i) { return mulberry32(seed * 101 + i * 977); }

function bevel(ctx, w, h, b, light, dark, aL, aD) {
  ctx.fillStyle = rgba(light, aL);
  ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2); ctx.lineTo(w / 2 - b, -h / 2 + b); ctx.lineTo(-w / 2 + b, -h / 2 + b); ctx.lineTo(-w / 2 + b, h / 2 - b); ctx.lineTo(-w / 2, h / 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba(dark, aD);
  ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.lineTo(-w / 2 + b, h / 2 - b); ctx.lineTo(w / 2 - b, h / 2 - b); ctx.lineTo(w / 2 - b, -h / 2 + b); ctx.lineTo(w / 2, -h / 2); ctx.closePath(); ctx.fill();
}

function drawWood(ctx, M, shape, w, h, path, rng, horiz, mn, mx) {
  ctx.save(); ctx.clip(path);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, M.light); g.addColorStop(0.35, M.base); g.addColorStop(1, M.dark);
  ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
  if (shape === 'circle') { // торец бревна: годичные кольца
    const R = w / 2;
    ctx.fillStyle = M.light; ctx.beginPath(); ctx.arc(-R * 0.05, -R * 0.05, R * 0.82, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(M.grain, 0.8); ctx.lineWidth = Math.max(0.012, R * 0.04);
    for (let k = 1; k <= 5; k++) { ctx.beginPath(); for (let i = 0; i <= 40; i++) { const a = i / 40 * TAU, r = R * 0.15 * k * (1 + 0.04 * Math.sin(a * 3 + k)); i ? ctx.lineTo(r * Math.cos(a) - R * 0.05, r * Math.sin(a) - R * 0.05) : ctx.moveTo(r * Math.cos(a) - R * 0.05, r * Math.sin(a) - R * 0.05); } ctx.stroke(); }
    ctx.strokeStyle = M.deep; ctx.lineWidth = R * 0.16; ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, TAU); ctx.stroke(); // кора
    ctx.restore(); return;
  }
  // волокна вдоль длинной оси
  const len = horiz ? w : h, thick = horiz ? h : w;
  const n = Math.max(2, Math.round(thick / 0.075));
  ctx.save(); if (!horiz) ctx.rotate(Math.PI / 2);
  ctx.strokeStyle = rgba(M.grain, 0.55); ctx.lineCap = 'round';
  const knots = []; const kn = Math.floor(len / 0.9 * rng() + rng() * 0.8);
  for (let i = 0; i < kn; i++) knots.push([lerp(-len / 2 + 0.15, len / 2 - 0.15, rng()), lerp(-thick / 2 + 0.06, thick / 2 - 0.06, rng())]);
  for (let i = 0; i < n; i++) {
    const y0 = -thick / 2 + (i + 0.5) * thick / n + (rng() - 0.5) * thick / n * 0.4;
    const lam = lerp(0.6, 1.3, rng()), ph = rng() * TAU, A = 0.012;
    ctx.lineWidth = lerp(0.008, 0.016, rng());
    ctx.beginPath();
    for (let x = -len / 2; x <= len / 2 + 0.001; x += 0.04) {
      let y = y0 + A * Math.sin(TAU * x / lam + ph);
      for (const [kx, ky] of knots) { const d = x - kx, near = Math.exp(-d * d / 0.01); y += (y0 > ky ? 1 : -1) * 0.035 * near * Math.exp(-Math.abs(y0 - ky) / 0.08); }
      x === -len / 2 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (const [kx, ky] of knots) {
    ctx.fillStyle = M.knot; ctx.beginPath(); ctx.ellipse(kx, ky, 0.05, 0.025, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(M.grain, 0.7); ctx.lineWidth = 0.008; ctx.beginPath(); ctx.ellipse(kx, ky, 0.075, 0.04, 0, 0, TAU); ctx.stroke();
  }
  // торцы: затемнение 0.08 м и гвозди
  if (len / thick > 2.2) {
    for (const s of [-1, 1]) {
      const eg = ctx.createLinearGradient(s * len / 2, 0, s * (len / 2 - 0.12), 0);
      eg.addColorStop(0, rgba(M.deep, 0.45)); eg.addColorStop(1, rgba(M.deep, 0));
      ctx.fillStyle = eg; ctx.fillRect(s > 0 ? len / 2 - 0.12 : -len / 2, -thick / 2, 0.12, thick);
      const nr = clamp(thick * 0.07, 0.012, 0.022);
      for (const ny of thick > 0.3 ? [-0.25, 0.25] : [0]) {
        const nx = s * (len / 2 - 0.09), yy = ny * thick;
        ctx.fillStyle = M.deep; ctx.beginPath(); ctx.arc(nx + nr * 0.25, yy + nr * 0.25, nr * 1.1, 0, TAU); ctx.fill();
        ctx.fillStyle = M.nail; ctx.beginPath(); ctx.arc(nx, yy, nr, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(nx - nr * 0.3, yy - nr * 0.3, nr * 0.35, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.restore();
  // квадратный/крупный блок: рамка-«ящик» с диагональной доской
  if (mx / mn < 1.6 && mn > 0.35) {
    const f = mn * 0.2;
    ctx.fillStyle = rgba(M.deep, 0.5); ctx.fillRect(-w / 2 + f, -h / 2 + f, w - 2 * f, h - 2 * f);
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2 + f, -h / 2 + f, w - 2 * f, h - 2 * f); ctx.clip();
    ctx.translate(0, 0); ctx.rotate(-Math.atan2(h, w));
    const d = Math.hypot(w, h), bw = f * 1.05;
    const gg = ctx.createLinearGradient(0, -bw / 2, 0, bw / 2); gg.addColorStop(0, M.light); gg.addColorStop(1, M.base);
    ctx.fillStyle = gg; ctx.fillRect(-d / 2, -bw / 2, d, bw);
    ctx.strokeStyle = M.outline; ctx.lineWidth = 0.018; ctx.strokeRect(-d / 2, -bw / 2, d, bw);
    ctx.restore();
    ctx.strokeStyle = M.outline; ctx.lineWidth = 0.02; ctx.strokeRect(-w / 2 + f, -h / 2 + f, w - 2 * f, h - 2 * f);
  } else if (mn > 0.3) { // широкие доски: швы
    ctx.strokeStyle = rgba(M.deep, 0.8); ctx.lineWidth = 0.016;
    const k = Math.round(mn / 0.2);
    for (let i = 1; i < k; i++) { const t = -mn / 2 + i * mn / k; ctx.beginPath(); horiz ? (ctx.moveTo(-w / 2, t), ctx.lineTo(w / 2, t)) : (ctx.moveTo(t, -h / 2), ctx.lineTo(t, h / 2)); ctx.stroke(); }
  }
  const b = clamp(0.16 * mn, 0.025, 0.07);
  if (shape === 'rect') bevel(ctx, w, h, b, M.light, M.deep, 0.75, 0.55);
  ctx.restore();
}

function drawIce(ctx, M, shape, w, h, path, rng, mn, mx) {
  ctx.save(); ctx.globalAlpha = M.alpha; ctx.clip(path);
  const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  g.addColorStop(0, M.light); g.addColorStop(0.45, M.base); g.addColorStop(1, M.dark);
  ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.globalAlpha = 1;
  // грани: светлые/тёмные треугольные фасетки
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w * 0.1, -h / 2); ctx.lineTo(-w / 2, h * 0.25); ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba(M.deep, 0.22);
  ctx.beginPath(); ctx.moveTo(w / 2, h / 2); ctx.lineTo(-w * 0.15, h / 2); ctx.lineTo(w / 2, -h * 0.2); ctx.closePath(); ctx.fill();
  // внутренняя рамка (стекло в раме) для крупных
  if (mn > 0.3) { const f = mn * 0.16; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 0.03; ctx.strokeRect(-w / 2 + f, -h / 2 + f, w - 2 * f, h - 2 * f); }
  // блики-полосы под 45°
  ctx.save(); ctx.rotate(-Math.PI / 4);
  const d = Math.hypot(w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(-d * 0.18, -d, mn * 0.16, 2 * d);
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(-d * 0.18 + mn * 0.26, -d, mn * 0.07, 2 * d);
  ctx.restore();
  // внутренний контур-блик сверху-слева
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = clamp(0.06 * mn, 0.012, 0.03); ctx.lineCap = 'round';
  const i = clamp(0.06 * mn, 0.015, 0.035);
  if (shape === 'circle') { ctx.beginPath(); ctx.arc(0, 0, w / 2 - i * 1.5, Math.PI * 1.05, Math.PI * 1.55); ctx.stroke(); }
  else { ctx.beginPath(); ctx.moveTo(-w / 2 + i, h / 2 - i * 3); ctx.lineTo(-w / 2 + i, -h / 2 + i); ctx.lineTo(w / 2 - i * 3, -h / 2 + i); ctx.stroke(); }
  // искорка
  const sx = -w / 2 + mn * 0.22, sy = -h / 2 + mn * 0.22, s = clamp(mn * 0.12, 0.03, 0.08);
  ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.moveTo(sx, sy - s); ctx.quadraticCurveTo(sx, sy, sx + s, sy); ctx.quadraticCurveTo(sx, sy, sx, sy + s); ctx.quadraticCurveTo(sx, sy, sx - s, sy); ctx.quadraticCurveTo(sx, sy, sx, sy - s); ctx.fill();
  ctx.restore();
}
function drawIceCracks(ctx, M, w, h, stage, rng, mn) {
  // «паутина» от точки удара
  const px = lerp(-w * 0.3, w * 0.3, rng()), py = lerp(-h * 0.3, h * 0.3, rng());
  const spokes = 7, R = Math.hypot(w, h);
  const ang = []; for (let i = 0; i < spokes; i++) ang.push((i + rng() * 0.6) / spokes * TAU);
  const lenK = [0, 0.35, 0.75, 1.2][stage], nSp = [0, 3, 5, 7][stage];
  const lw = clamp(0.035 * mn + 0.008, 0.012, 0.026);
  const spokePts = [];
  for (let i = 0; i < nSp; i++) {
    const pts = [[px, py]]; let x = px, y = py, a = ang[i];
    const L = R * lenK * lerp(0.6, 1, rng());
    for (let s = 0; s < L; s += 0.06) { a += (rng() - 0.5) * 0.3; x += Math.cos(a) * 0.06; y += Math.sin(a) * 0.06; pts.push([x, y]); }
    spokePts.push(pts);
  }
  const rings = stage >= 2 ? (stage === 3 ? [0.3, 0.6] : [0.35]) : [];
  const drawLine = (pts) => {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(M.crackDark, 0.75); ctx.lineWidth = lw * 1.8; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    ctx.strokeStyle = M.crack; ctx.lineWidth = lw * 0.8; ctx.stroke();
  };
  for (const s of spokePts) drawLine(s);
  for (const rk of rings) for (let i = 0; i < spokePts.length - 1; i++) {
    const a = spokePts[i], b = spokePts[i + 1];
    const ia = Math.min(a.length - 1, Math.floor(a.length * rk)), ib = Math.min(b.length - 1, Math.floor(b.length * rk * lerp(0.8, 1.2, rng())));
    drawLine([a[ia], [(a[ia][0] + b[ib][0]) / 2 + (rng() - 0.5) * 0.04, (a[ia][1] + b[ib][1]) / 2 + (rng() - 0.5) * 0.04], b[ib]]);
  }
  // точка удара — «звёздочка» помутнения
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(px, py, lw * 2.2, 0, TAU); ctx.fill();
  if (stage === 3) { // выпавший осколок между спицами — тёмное «окно»
    const a = spokePts[1], b = spokePts[2]; if (a && b) {
      ctx.fillStyle = rgba(M.deep, 0.45); ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(a[Math.floor(a.length * 0.6)][0], a[Math.floor(a.length * 0.6)][1]); ctx.lineTo(b[Math.floor(b.length * 0.6)][0], b[Math.floor(b.length * 0.6)][1]); ctx.closePath(); ctx.fill();
    }
  }
}

let stoneTileC = null;
function stoneTile() {
  if (stoneTileC) return stoneTileC;
  stoneTileC = noiseTile(128, 51, 6, 4, (v) => { const t = clamp((v - 0.5) * 2.5, -1, 1); return t > 0 ? [255, 255, 255, Math.round(t * 70)] : [20, 24, 30, Math.round(-t * 90)]; });
  return stoneTileC;
}
function drawStone(ctx, M, shape, w, h, path, rng, mn, mx, ppu) {
  ctx.save(); ctx.clip(path);
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, M.light); g.addColorStop(0.4, M.base); g.addColorStop(1, M.dark);
  ctx.fillStyle = g; ctx.fillRect(-w / 2, -h / 2, w, h);
  // шумовая фактура: тайл 128 px = 1.0 м
  const pat = ctx.createPattern(stoneTile(), 'repeat');
  pat.setTransform(new DOMMatrix().translate(rng() * 128, rng() * 128).scale(1 / 128));
  ctx.fillStyle = pat; ctx.fillRect(-w / 2, -h / 2, w, h);
  // крапины
  const n = Math.round(w * h * 60);
  for (let i = 0; i < n; i++) { ctx.fillStyle = rng() < 0.5 ? rgba(M.deep, 0.6) : rgba(M.light, 0.8); ctx.beginPath(); ctx.arc(lerp(-w / 2, w / 2, rng()), lerp(-h / 2, h / 2, rng()), lerp(0.006, 0.016, rng()), 0, TAU); ctx.fill(); }
  // швы-«плиты» на длинных блоках
  if (mx / mn > 2.2 && shape === 'rect') {
    const horiz = w > h, k = Math.max(1, Math.round(mx / (mn * 1.6)) - 1);
    for (let i = 1; i <= k; i++) {
      const t = -mx / 2 + i * mx / (k + 1) + (rng() - 0.5) * mn * 0.4;
      const pts = []; for (let j = 0; j <= 4; j++) { const u = -mn / 2 + j * mn / 4; pts.push([t + (rng() - 0.5) * mn * 0.12, u]); }
      const P = horiz ? pts : pts.map(([a, b]) => [b, a]);
      strokeCrack(ctx, P, 0.018, rgba(M.deep, 0.9), rgba(M.light, 0.9), 0.008);
    }
  }
  if (shape === 'circle') { // валун: мягкая сфера
    const rg = ctx.createRadialGradient(-w * 0.18, -w * 0.2, w * 0.05, 0, 0, w * 0.55);
    rg.addColorStop(0, 'rgba(255,255,255,0.35)'); rg.addColorStop(0.6, 'rgba(255,255,255,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = rg; ctx.fillRect(-w / 2, -w / 2, w, w);
  } else if (shape === 'rect') bevel(ctx, w, h, clamp(0.18 * mn, 0.03, 0.09), M.light, M.deep, 0.7, 0.6);
  ctx.restore();
}

// ───────────────────────── рогатка ─────────────────────────
const SLING = { base: '#9A5A2A', light: '#CB8645', dark: '#6A3816', outline: '#2E190A', wrap: '#5C3A22', wrapLight: '#8A5E3A', band: '#3B2414', bandLight: '#6A4528', pouch: '#6B4A2E', pouchDark: '#4A311C', stitch: '#D8B88A' };
function slingLimb(ctx, pts, w0, w1) { // толстая ветка: полоса по ломаной с сужением
  const left = [], right = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L, ww = lerp(w0, w1, i / (pts.length - 1)) / 2;
    left.push([p[0] + nx * ww, p[1] + ny * ww]); right.push([p[0] - nx * ww, p[1] - ny * ww]);
  }
  const path = new Path2D(); left.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
  const e = pts[pts.length - 1]; path.arc(e[0], e[1], w1 / 2, Math.atan2(left[left.length - 1][1] - e[1], left[left.length - 1][0] - e[0]), Math.atan2(right[right.length - 1][1] - e[1], right[right.length - 1][0] - e[0]), true);
  for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i][0], right[i][1]);
  path.closePath(); return path;
}
function drawSlingPart(ctx, v, sx, gy, part) {
  // мировые координаты, Y вверх. Основание S=(sx, gy); рога: зад (-0.30, 2.95), перед (+0.28, 2.90)
  applyWorld(ctx, v); ctx.translate(sx, gy);
  const C = SLING;
  const trunk = slingLimb(ctx, [[0.0, -0.4], [0.02, 0.5], [0.0, 1.05], [0.0, 1.35]], 0.44, 0.36);
  const back = slingLimb(ctx, [[0.02, 1.2], [-0.2, 1.6], [-0.32, 2.15], [-0.30, 2.98]], 0.32, 0.22);
  const front = slingLimb(ctx, [[-0.02, 1.2], [0.2, 1.6], [0.31, 2.15], [0.28, 2.93]], 0.32, 0.22);
  const paint = (p, flip) => {
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.09; ctx.strokeStyle = C.outline; ctx.stroke(p);
    const g = ctx.createLinearGradient(-0.3, 0, 0.3, 0); g.addColorStop(0, C.light); g.addColorStop(0.45, C.base); g.addColorStop(1, C.dark);
    ctx.fillStyle = g; ctx.fill(p);
    ctx.save(); ctx.clip(p); ctx.strokeStyle = rgba(C.dark, 0.6); ctx.lineWidth = 0.025; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) { const y = 0.1 + i * 0.32, x = (i % 3 - 1) * 0.08 * (flip || 1); ctx.beginPath(); ctx.moveTo(x - 0.04, y); ctx.quadraticCurveTo(x, y + 0.08, x + 0.03, y + 0.18); ctx.stroke(); }
    ctx.restore();
  };
  const wrap = (x, y, ang) => { // кожаная обмотка у кончика рога
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = C.wrap; ctx.strokeStyle = C.outline; ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.roundRect(-0.15, -0.13, 0.30, 0.22, 0.05); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = C.wrapLight; ctx.lineWidth = 0.025; for (const yy of [-0.06, 0.0, 0.06]) { ctx.beginPath(); ctx.moveTo(-0.12, yy - 0.02); ctx.lineTo(0.12, yy + 0.02); ctx.stroke(); }
    ctx.restore();
  };
  if (part === 'back') { paint(back, -1); wrap(-0.29, 2.8, -0.08); paint(trunk, 1); }
  else { paint(front, 1); wrap(0.27, 2.75, 0.1); }
}
function drawBand(ctx, v, from, to, wM) {
  applyWorld(ctx, v); ctx.lineCap = 'round';
  ctx.strokeStyle = SLING.band; ctx.lineWidth = wM; ctx.beginPath(); ctx.moveTo(from[0], from[1]); ctx.lineTo(to[0], to[1]); ctx.stroke();
  ctx.strokeStyle = SLING.bandLight; ctx.lineWidth = wM * 0.3; ctx.beginPath(); ctx.moveTo(from[0], from[1] + wM * 0.18); ctx.lineTo(to[0], to[1] + wM * 0.18); ctx.stroke();
}
function drawPouch(ctx, v, c, dir, r) { // dir — единичный вектор от ложа к якорю (направление выстрела)
  applyWorld(ctx, v); ctx.translate(c[0], c[1]); ctx.rotate(Math.atan2(dir[1], dir[0]));
  // полумесяц, охватывающий птицу сзади (сторона -dir)
  const p = new Path2D();
  p.arc(0, 0, r * 1.12, Math.PI - 1.05, Math.PI + 1.05);
  p.arc(r * 0.18, 0, r * 0.86, Math.PI + 0.95, Math.PI - 0.95, true);
  p.closePath();
  const g = ctx.createLinearGradient(-r * 1.1, 0, -r * 0.6, 0); g.addColorStop(0, SLING.pouchDark); g.addColorStop(1, SLING.pouch);
  ctx.fillStyle = g; ctx.fill(p); ctx.lineJoin = 'round'; ctx.lineWidth = 0.05; ctx.strokeStyle = SLING.outline; ctx.stroke(p);
  ctx.setLineDash([0.06, 0.05]); ctx.strokeStyle = SLING.stitch; ctx.lineWidth = 0.02;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.0, Math.PI - 0.85, Math.PI + 0.85); ctx.stroke(); ctx.setLineDash([]);
}
// ───────────────────────── плейсхолдеры персонажей ─────────────────────────
function drawBall(ctx, v, x, y, r, fill, outline, light) {
  applyWorld(ctx, v); ctx.translate(x, y); ctx.scale(1, -1);
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.45, r * 0.05, -r * 0.1, -r * 0.1, r * 1.25); g.addColorStop(0, light); g.addColorStop(0.55, fill); g.addColorStop(1, outline);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.lineWidth = r * 0.14; ctx.strokeStyle = outline; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.52, r * 0.22, r * 0.12, -0.5, 0, TAU); ctx.fill();
}
function drawShadow(ctx, v, x, gy, r) {
  applyWorld(ctx, v); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(x, gy + 0.02, r * 0.95, r * 0.22, 0, 0, TAU); ctx.fill();
}

// ───────────────────────── эффекты ─────────────────────────
function glowSprite(color, size) { // радиальное свечение — вместо shadowBlur
  const c = makeCanvas(size, size), x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, rgba(color, 1)); g.addColorStop(0.35, rgba(color, 0.55)); g.addColorStop(1, rgba(color, 0));
  x.fillStyle = g; x.fillRect(0, 0, size, size); return c;
}
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

// Взрыв: x,y — центр (м), R — радиус взрыва (м), t — время с начала (с)
function drawExplosion(ctx, v, x, y, R, t, seed) {
  const rng = mulberry32(seed);
  applyWorld(ctx, v); ctx.translate(x, y);
  // 1) вспышка 0–0.12 с
  if (t < 0.12) {
    const a = 1 - t / 0.12, r = R * lerp(0.6, 1.3, t / 0.12);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, `rgba(255,255,240,${a})`); g.addColorStop(0.4, `rgba(255,230,140,${a * 0.8})`); g.addColorStop(1, 'rgba(255,160,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // 2) ударная волна 0–0.3 с
  if (t < 0.3) {
    const k = easeOutCubic(t / 0.3), r = lerp(0.2 * R, 1.6 * R, k);
    ctx.strokeStyle = `rgba(255,255,255,${0.85 * (1 - k)})`; ctx.lineWidth = lerp(0.28, 0.04, k) * R;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
  }
  // 3) огненный шар → дым: 9 «пуфов»
  const puffs = 9;
  for (let i = 0; i < puffs; i++) {
    const a = (i / puffs) * TAU + rng() * 0.5, d = R * lerp(0.15, 0.55, rng()), r0 = R * lerp(0.28, 0.45, rng());
    const delay = rng() * 0.05, tt = Math.max(0, t - delay);
    if (tt <= 0) continue;
    const grow = easeOutCubic(Math.min(1, tt / 0.2));
    const px = Math.cos(a) * d * (0.4 + 0.8 * grow), py = Math.sin(a) * d * (0.4 + 0.8 * grow) + tt * 0.9; // дым всплывает 0.9 м/с
    const r = r0 * (0.4 + 0.8 * grow) * (1 + tt * 0.5);
    const heat = clamp(1 - (tt - 0.06) / 0.25, 0, 1); // 1 — огонь, 0 — дым
    const alpha = clamp(1 - (tt - 0.35) / 0.4, 0, 1);
    if (alpha <= 0) continue;
    const core = heat > 0 ? mixHex('#A8A2AA', '#FFD04A', heat) : '#A8A2AA';
    const edge = heat > 0 ? mixHex('#77707C', '#FF7A1A', heat) : '#77707C';
    const g = ctx.createRadialGradient(px - r * 0.3, py + r * 0.3, r * 0.1, px, py, r);
    g.addColorStop(0, rgba(heat > 0.5 ? '#FFF6C0' : core, alpha)); g.addColorStop(0.5, rgba(core, alpha)); g.addColorStop(1, rgba(edge, alpha * 0.9));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
  }
  // 4) искры 0–0.4 с
  if (t < 0.4) {
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a = rng() * TAU, sp = R * lerp(5, 9, rng()), tt = t;
      const d0 = sp * tt, d1 = sp * Math.max(0, tt - 0.04);
      ctx.strokeStyle = `rgba(255,226,122,${1 - tt / 0.4})`; ctx.lineWidth = 0.06 * R;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * d1, Math.sin(a) * d1 - 3 * tt * tt); ctx.lineTo(Math.cos(a) * d0, Math.sin(a) * d0 - 3 * tt * tt); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// Зелёный «пуф» свиньи
function drawPigPoof(ctx, v, x, y, r, t, seed) {
  const rng = mulberry32(seed);
  applyWorld(ctx, v); ctx.translate(x, y);
  const T1 = 0.15, T2 = 0.55;
  const s = t < T1 ? easeOutBack(t / T1) : 1 + 0.15 * (t - T1) / (T2 - T1);
  const alpha = t < 0.3 ? 1 : clamp(1 - (t - 0.3) / (T2 - 0.3), 0, 1);
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  const n = 8, blobs = [];
  for (let i = 0; i < n; i++) { const a = i / n * TAU + rng() * 0.4, d = r * lerp(0.45, 0.75, rng()); blobs.push([Math.cos(a) * d, Math.sin(a) * d, r * lerp(0.42, 0.62, rng())]); }
  blobs.push([0, 0, r * 0.75]);
  // контур-подложка
  ctx.fillStyle = '#2F6A1A'; ctx.beginPath(); for (const [bx, by, br] of blobs) { ctx.moveTo(bx * s + br * s + 0.04, by * s); ctx.arc(bx * s, by * s, br * s + 0.04, 0, TAU); } ctx.fill();
  ctx.fillStyle = '#6EC03A'; ctx.beginPath(); for (const [bx, by, br] of blobs) { ctx.moveTo(bx * s + br * s, by * s); ctx.arc(bx * s, by * s, br * s, 0, TAU); } ctx.fill();
  ctx.fillStyle = '#A6E46A'; ctx.beginPath(); for (const [bx, by, br] of blobs) { ctx.moveTo((bx - br * 0.25) * s + br * 0.5 * s, (by + br * 0.3) * s); ctx.arc((bx - br * 0.25) * s, (by + br * 0.3) * s, br * 0.5 * s, 0, TAU); } ctx.fill();
  ctx.globalAlpha = 1;
}

// облачко пыли/дыма (материал)
const DUST = { wood: '#E2C595', ice: '#EAF8FF', stone: '#C9C5BE', feather: '#FFFFFF' };
function drawDust(ctx, v, x, y, r, t, mat, seed) {
  const rng = mulberry32(seed); applyWorld(ctx, v);
  for (let i = 0; i < 5; i++) {
    const a = rng() * TAU, d = r * rng() * 0.8, k = easeOutCubic(Math.min(1, t / 0.6));
    const px = x + Math.cos(a) * d * (1 + k), py = y + Math.sin(a) * d * (1 + k) + t * 0.6, rr = r * lerp(0.35, 0.6, rng()) * (1 + 0.8 * k);
    const al = 0.7 * (1 - clamp(t / 0.7, 0, 1));
    ctx.fillStyle = rgba(DUST[mat], al); ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.fill();
  }
}

// частицы-обломки (статичный кадр для превью)
function drawDebris(ctx, v, x, y, mat, t, seed, count) {
  const rng = mulberry32(seed), M = MAT[mat]; applyWorld(ctx, v);
  for (let i = 0; i < count; i++) {
    const a = lerp(0.15, Math.PI - 0.15, rng()), sp = lerp(3, 8, rng());
    const px = x + Math.cos(a) * sp * t, py = y + Math.sin(a) * sp * t - 0.5 * 12.5 * t * t;
    const rot = (rng() - 0.5) * 24 * t, s = mat === 'wood' ? lerp(0.1, 0.22, rng()) : lerp(0.07, 0.17, rng());
    ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
    ctx.lineWidth = 0.02; ctx.strokeStyle = M.outline; ctx.lineJoin = 'round';
    if (mat === 'wood') { ctx.fillStyle = rng() < 0.5 ? M.base : M.light; ctx.beginPath(); ctx.moveTo(-s, -s * 0.22); ctx.lineTo(s, -s * 0.08); ctx.lineTo(s * 0.75, s * 0.24); ctx.lineTo(-s * 0.9, s * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    else if (mat === 'ice') { ctx.fillStyle = 'rgba(190,235,255,0.95)'; ctx.strokeStyle = M.outline; ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.5); ctx.lineTo(-s * 0.5, s * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 0.012; ctx.beginPath(); ctx.moveTo(0, -s * 0.7); ctx.lineTo(-s * 0.3, s * 0.4); ctx.stroke(); }
    else { ctx.fillStyle = rng() < 0.5 ? M.base : M.dark; ctx.beginPath(); for (let k = 0; k < 6; k++) { const aa = k / 6 * TAU, rr = s * lerp(0.6, 1, rng()); k ? ctx.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr) : ctx.moveTo(Math.cos(aa) * rr, Math.sin(aa) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
}
function featherPath(ctx, len) {
  const w = len * 0.28;
  ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.quadraticCurveTo(-len * 0.1, -w, len / 2, -w * 0.15); ctx.quadraticCurveTo(len * 0.1, w * 0.9, -len / 2, 0); ctx.closePath();
}
function drawFeathers(ctx, v, x, y, color, dark, t, seed, n) {
  const rng = mulberry32(seed); applyWorld(ctx, v);
  for (let i = 0; i < n; i++) {
    const a = lerp(0.2, Math.PI - 0.2, rng()), sp = lerp(2, 5, rng()), drag = Math.exp(-2.5 * t);
    const px = x + Math.cos(a) * sp * (1 - drag) / 2.5 + 0.35 * Math.sin(6 * t + i), py = y + Math.sin(a) * sp * (1 - drag) / 2.5 - 0.6 * t * t;
    const ang = 0.6 * Math.sin(7 * t + i * 1.7) + rng() * TAU, len = lerp(0.28, 0.4, rng());
    ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
    featherPath(ctx, len); ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 0.018; ctx.strokeStyle = dark; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-len / 2, 0); ctx.lineTo(len * 0.4, -len * 0.04); ctx.lineWidth = 0.012; ctx.stroke();
    ctx.restore();
  }
}

// всплывающие очки
function drawScore(ctx, v, x, y, text, fill, stroke, sizeM, t, font) {
  const sc = t < 0.18 ? (t < 0.1 ? lerp(0.4, 1.15, t / 0.1) : lerp(1.15, 1.0, (t - 0.1) / 0.08)) : 1;
  const rise = 1.4 * (1 - Math.pow(1 - Math.min(1, t / 0.9), 2));
  const alpha = t < 0.6 ? 1 : clamp(1 - (t - 0.6) / 0.3, 0, 1);
  const sx = wsx(v, x), sy = wsy(v, y + rise);
  const px = Math.max(14, sizeM * v.scale) * sc;
  ctx.setTransform(1, 0, 0, 1, sx, sy); ctx.globalAlpha = alpha;
  ctx.font = `${font.weight} ${px}px ${font.family}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillText(text, 0, px * 0.07);
  ctx.lineWidth = px * 0.18; ctx.strokeStyle = stroke; ctx.strokeText(text, 0, 0);
  const g = ctx.createLinearGradient(0, -px * 0.45, 0, px * 0.45); g.addColorStop(0, mixHex(fill, '#FFFFFF', 0.45)); g.addColorStop(0.5, fill); g.addColorStop(1, mixHex(fill, '#000000', 0.12));
  ctx.fillStyle = g; ctx.fillText(text, 0, 0);
  ctx.globalAlpha = 1;
}

function drawStar(ctx, cx, cy, R, filled) {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? R * 0.5 : R; i ? p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  p.closePath();
  ctx.lineJoin = 'round'; ctx.lineWidth = R * 0.22;
  if (!filled) { ctx.strokeStyle = 'rgba(40,40,40,0.5)'; ctx.stroke(p); ctx.fillStyle = 'rgba(107,107,107,0.5)'; ctx.fill(p); return; }
  ctx.strokeStyle = '#8A4A00'; ctx.stroke(p);
  const g = ctx.createLinearGradient(cx, cy - R, cx, cy + R); g.addColorStop(0, '#FFF59A'); g.addColorStop(0.45, '#FFC21A'); g.addColorStop(1, '#F08A06');
  ctx.fillStyle = g; ctx.fill(p);
  ctx.save(); ctx.clip(p); ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.ellipse(cx - R * 0.2, cy - R * 0.45, R * 0.45, R * 0.22, -0.4, 0, TAU); ctx.fill(); ctx.restore();
}

function drawTrail(ctx, v, pts) {
  applyWorld(ctx, v);
  pts.forEach(([x, y], i) => { const r = i % 2 ? 0.065 : 0.11; ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.lineWidth = 0.015; ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.stroke(); });
}

// Вывод спрайта блока в мир
function drawBlockSprite(ctx, v, spr, ppu, x, y, angle) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sx = wsx(v, x), sy = wsy(v, y), k = v.scale / ppu;
  ctx.translate(sx, sy); ctx.rotate(-angle); ctx.scale(k, k);
  ctx.drawImage(spr, -spr.width / 2, -spr.height / 2);
}

// TNT: деревянный ящик (рецепт wood/crate) + красная табличка с надписью
function renderTnt(size, ppu, font) {
  const c = renderBlock('wood', 'rect', size, size, 0, 77, ppu), ctx = c.getContext('2d');
  ctx.setTransform(ppu, 0, 0, ppu, c.width / 2, c.height / 2);
  const pw = size * 0.78, ph = size * 0.36;
  ctx.fillStyle = '#D9342B'; ctx.strokeStyle = '#4A0E08'; ctx.lineWidth = 0.035; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.roundRect(-pw / 2, -ph / 2, pw, ph, 0.05); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-pw / 2 + 0.04, -ph / 2 + 0.04, pw - 0.08, ph * 0.22);
  ctx.font = `900 ${ph * 0.78}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = ph * 0.14; ctx.strokeStyle = '#4A0E08'; ctx.strokeText('TNT', 0, ph * 0.04);
  ctx.fillStyle = '#FFF4D6'; ctx.fillText('TNT', 0, ph * 0.04);
  return c;
}
