// Рельеф уровня в мировых координатах: грунт с кромкой (трава / песок / снег), скалы, помосты.
//
// • Соприкасающиеся полигоны грунта (земля + холм, земля + плато/утёс из грунта) рисуются как одна масса:
//   контур объединяется (terrainGeo.unionPolygons), кромка, обводка и фестоны идут по общему контуру —
//   без шва и травяной полосы через основание холма. Физика по-прежнему по исходным полигонам.
// • Геометрия (Path2D: контур, кромка, фестоны, травинки, снежные шапки) строится один раз на рельеф и тему;
//   кромка нарезана на куски ≈ 6 м — каждый кадр рисуются только видимые.
// • Текстуры — бесшовные тайлы, привязанные к миру (createPattern + setTransform в метрах).
// • Кэш тайлов 256×256 px: при неподвижном зуме — блит 1:1 (пиксельно выровнен, при дробном сдвиге > 0.25 px —
//   с дробным смещением); пока зум меняется — векторно (масштабированный блит тайлов Chrome растеризует синхронно).
//   Держится 2 масштаба (самый посещаемый — обычно вид рогатки — не вытесняется), тайлы достраиваются в простое
//   (requestIdleCallback) и не больше 0.5 мс за кадр. Один активный рельеф: новый массив с другим содержимым
//   освобождает прежний кэш (releaseTerrain() — явно), тот же рельеф в новом массиве узнаётся по хэшу.
// • Трансформация кадра (поворот от тряски вокруг центра экрана) передаётся явно — параметром frame (см. shakeFrame);
//   без него рельеф рисуется в абсолютной трансформации, как раньше (оставленная вызывающим трансформация не влияет).

import type { TerrainDef, ThemeId } from '../../core/types';
import { createCanvas, ctx2d, type AnyCanvas, type Ctx2D } from '../canvas';
import type { ViewInfo } from '../view';
import { TAU, clamp, hexRgb, lerp, mix, noiseTile, rand, rgba, smooth } from './paint';
import { THEME_PALETTES, type DeckPalette, type GroundPalette, type RockPalette } from './themes';
import {
  bandLower,
  bboxOf,
  capOutline,
  chainCum,
  normalizeCCW,
  offsetChain,
  pieceCuts,
  pointInPoly,
  polyArea,
  subChain,
  terrainHash,
  topChains,
  touchingGroups,
  unionPolygons,
  walkChain,
  type Chain,
  type P2,
} from './terrainGeo';

export type { DeckPalette, GroundPalette, RockPalette } from './themes';

// ───────────────────────── палитры рельефа ─────────────────────────

export interface TerrainPalette {
  ground: GroundPalette;
  rock: RockPalette;
  deck: DeckPalette;
  moss: { top: string; dark: string; light: string };
}

/** Палитры рельефа (срез THEME_PALETTES). */
export const TERRAIN_PALETTES: Record<ThemeId, TerrainPalette> = {
  meadow: pick('meadow'),
  beach: pick('beach'),
  snow: pick('snow'),
};

function pick(t: ThemeId): TerrainPalette {
  const P = THEME_PALETTES[t];
  return { ground: P.ground, rock: P.rock, deck: P.deck, moss: P.moss };
}

// ───────────────────────── текстуры ─────────────────────────

/** Тайл грунта: SOIL_PX пикселей = SOIL_M метров. */
const SOIL_PX = 512;
const SOIL_M = 4;
/** Камень: крупные пятна на 5.3 м и мелкая крапина на 1.7 м — периоды несоизмеримы, сетка повторов не читается. */
const ROCK_BIG_PX = 384;
const ROCK_BIG_M = 5.3;
const ROCK_FINE_PX = 256;
const ROCK_FINE_M = 1.7;

const tileCache = new Map<string, AnyCanvas>();

/** Бесшовный тайл грунта темы: шум, слои, камушки / ракушки. */
function soilTile(theme: ThemeId): AnyCanvas {
  const key = `soil:${theme}`;
  const hit = tileCache.get(key);
  if (hit) return hit;
  const G = THEME_PALETTES[theme].ground;
  const S = SOIL_PX;
  const ppm = S / SOIL_M;
  const a = hexRgb(G.soil);
  const b = hexRgb(G.soilDark);
  const deep = hexRgb(G.soilDeep);
  const c = noiseTile(S, 17 + theme.length, 8, 3, (v, _x, y) => {
    const t = clamp((v - 0.36) * 2.3, 0, 1);
    // слой (страта) — тёмная волнистая полоса на глубине ~2.4 м тайла
    const yy = y / ppm;
    const band = Math.exp(-(((yy - 2.45) / 0.22) ** 2)) * 0.32 + Math.exp(-(((yy - 0.95) / 0.1) ** 2)) * 0.12;
    const r0 = lerp(a[0], b[0], t);
    const g0 = lerp(a[1], b[1], t);
    const b0 = lerp(a[2], b[2], t);
    return [lerp(r0, deep[0], band), lerp(g0, deep[1], band), lerp(b0, deep[2], band), 255];
  });
  const ctx = ctx2d(c);
  const r = rand(23 + theme.length * 7);
  // мелкие крапинки (фактура)
  for (let i = 0; i < 520; i++) {
    const x = r() * S;
    const y = r() * S;
    const rr = lerp(0.8, 2.2, r());
    ctx.fillStyle = r() < 0.5 ? rgba(G.soilDeep, 0.35) : rgba(G.pebble, 0.3);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, TAU);
    ctx.fill();
  }
  // камушки / ракушки с переносом через края тайла (бесшовно)
  const count = theme === 'beach' ? 34 : 28;
  for (let i = 0; i < count; i++) {
    const x = r() * S;
    const y = r() * S;
    const rx = lerp(0.06, 0.17, r()) * ppm;
    const ry = rx * lerp(0.55, 0.8, r());
    const ang = r() * Math.PI;
    const shell = theme === 'beach' && r() < 0.45;
    for (const dx of [0, -S, S]) {
      for (const dy of [0, -S, S]) {
        if (x + dx + rx * 1.5 < 0 || x + dx - rx * 1.5 > S || y + dy + rx * 1.5 < 0 || y + dy - rx * 1.5 > S) continue;
        ctx.save();
        ctx.translate(x + dx, y + dy);
        ctx.rotate(ang);
        if (shell) drawShell(ctx, rx * 0.9, G);
        else drawPebble(ctx, rx, ry, G);
        ctx.restore();
      }
    }
  }
  tileCache.set(key, c);
  return c;
}

function drawPebble(ctx: Ctx2D, rx: number, ry: number, G: GroundPalette): void {
  ctx.fillStyle = G.pebbleDark;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx + 1.6, ry + 1.6, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = G.pebble;
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(G.pebbleDark, 0.3);
  ctx.beginPath();
  ctx.ellipse(rx * 0.18, ry * 0.25, rx * 0.75, ry * 0.65, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.ellipse(-rx * 0.3, -ry * 0.35, rx * 0.4, ry * 0.3, 0, 0, TAU);
  ctx.fill();
}

/** Ракушка-веер (пляж). */
function drawShell(ctx: Ctx2D, r: number, G: GroundPalette): void {
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, r * 0.55);
  ctx.arc(0, r * 0.55, r, Math.PI * 1.12, Math.PI * 1.88);
  ctx.closePath();
  ctx.fillStyle = G.pebble;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = G.pebbleDark;
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(G.pebbleDark, 0.7);
  for (let k = 1; k < 5; k++) {
    const a = Math.PI * (1.12 + (0.76 * k) / 5);
    ctx.beginPath();
    ctx.moveTo(0, r * 0.55);
    ctx.lineTo(Math.cos(a) * r * 0.92, r * 0.55 + Math.sin(a) * r * 0.92);
    ctx.stroke();
  }
}

/** Крупные мягкие пятна камня (светлые / тёмные, без крапин). */
function rockTileBig(): AnyCanvas {
  const hit = tileCache.get('rockBig');
  if (hit) return hit;
  const c = noiseTile(ROCK_BIG_PX, 41, 3, 3, (v) => {
    const t = clamp((v - 0.5) * 2.4, -1, 1);
    return t > 0 ? [255, 255, 255, Math.round(t * 0.16 * 255)] : [20, 24, 30, Math.round(-t * 0.2 * 255)];
  });
  tileCache.set('rockBig', c);
  return c;
}

/** Мелкая фактура камня: зерно и редкие крапины. */
function rockTileFine(): AnyCanvas {
  const hit = tileCache.get('rockFine');
  if (hit) return hit;
  const c = noiseTile(ROCK_FINE_PX, 59, 8, 2, (v) => {
    const t = clamp((v - 0.5) * 2.2, -1, 1);
    return t > 0 ? [255, 255, 255, Math.round(t * 0.07 * 255)] : [20, 24, 30, Math.round(-t * 0.09 * 255)];
  });
  const ctx = ctx2d(c);
  const r = rand(77);
  for (let i = 0; i < 28; i++) {
    const x = r() * ROCK_FINE_PX;
    const y = r() * ROCK_FINE_PX;
    const rr = lerp(0.8, 2, r());
    ctx.fillStyle = r() < 0.55 ? 'rgba(20,24,30,0.2)' : 'rgba(255,255,255,0.22)';
    for (const dx of [0, -ROCK_FINE_PX, ROCK_FINE_PX]) {
      for (const dy of [0, -ROCK_FINE_PX, ROCK_FINE_PX]) {
        if (x + dx < -3 || x + dx > ROCK_FINE_PX + 3 || y + dy < -3 || y + dy > ROCK_FINE_PX + 3) continue;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, rr, 0, TAU);
        ctx.fill();
      }
    }
  }
  tileCache.set('rockFine', c);
  return c;
}

/** Паттерны кэшируются на контекст (паттерн привязан к создавшему его контексту). */
const patternCache = new WeakMap<Ctx2D, Map<string, CanvasPattern>>();

function worldPattern(ctx: Ctx2D, key: string, tile: AnyCanvas, metres: number): CanvasPattern | null {
  let m = patternCache.get(ctx);
  if (!m) {
    m = new Map();
    patternCache.set(ctx, m);
  }
  let p = m.get(key);
  if (!p) {
    p = ctx.createPattern(tile, 'repeat') ?? undefined;
    if (!p) return null;
    // тайл в метрах мира, ось Y мира вверх — флип; паттерн «прилипает» к миру при панораме
    p.setTransform(new DOMMatrix().scale(metres / tile.width, -metres / tile.height));
    m.set(key, p);
  }
  return p;
}

// ───────────────────────── геометрия ─────────────────────────

/** Кусок кромки (≈ PIECE_M м вдоль цепочки) — каждый кадр рисуются только куски, попавшие в вид. */
interface Piece {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Цепочка верхних рёбер (с нахлёстом PIECE_OV на соседей). */
  chain: Path2D;
  /** Тело кромки: от поверхности (с запасом наружу) до фестончатого нижнего края. */
  band: Path2D;
  highlight: Path2D;
  /** Травинки (два прохода) или снежная шапка. */
  bladesBack: Path2D | null;
  bladesFront: Path2D | null;
  capFill: Path2D | null;
  capLine: Path2D | null;
}

/** Объединение видимых кусков (кэш по набору кусков). */
interface Vis {
  chain: Path2D;
  band: Path2D;
  highlight: Path2D;
  bladesBack: Path2D | null;
  bladesFront: Path2D | null;
  capFill: Path2D | null;
  capLine: Path2D | null;
}

/** Единица отрисовки: группа слитых полигонов грунта или отдельный полигон скалы / помоста. */
interface Item {
  kind: TerrainDef['kind'];
  loops: P2[][];
}

interface Stone {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  tone: number;
}

interface DeckGeo {
  wood: boolean;
  seams: Path2D;
  seamsLight: Path2D;
  grain: Path2D;
  straps: Array<[number, number, number, number]>;
  rivets: P2[];
  /** Кладка толстого помоста: камни разного размера. */
  stones: Stone[];
}

interface Geo {
  kind: TerrainDef['kind'];
  path: Path2D;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  chains: Chain[];
  /** Самая низкая верхняя поверхность — от неё считается затемнение грунта вглубь. */
  surfaceY: number;
  /** Отдельные рёбра по сторонам (для теней скал). */
  shadeEdges: Path2D;
  edgeT: number;
  pieces: Piece[];
  vis: Map<string, Vis>;
  cracks: Path2D | null;
  /** Скала: плоскости-грани (каждая следующая правее — темнее), светлая левая плоскость и рёбра граней. */
  facets: Path2D[] | null;
  facetLight: Path2D | null;
  facetEdges: Path2D | null;
  deck: DeckGeo | null;
}

/** Длина куска кромки вдоль цепочки, м, и нахлёст линий между соседними кусками. */
const PIECE_M = 6;
const PIECE_OV = 0.05;
/** Запас габарита куска: травинки/шапка наружу, кромка и «гребешки» внутрь. */
const PIECE_PAD = 0.8;

function polyPath(pts: ReadonlyArray<readonly [number, number]>, close: boolean, into?: Path2D): Path2D {
  const p = into ?? new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
  if (close) p.closePath();
  return p;
}

/** Толщина кромки по типу. */
function edgeThickness(edge: GroundPalette['edge']): number {
  return edge === 'snow' ? 0.4 : edge === 'sand' ? 0.3 : 0.34;
}

/** Единицы отрисовки рельефа: соприкасающиеся полигоны грунта сливаются, порядок — по первому участнику. */
function buildItems(terrain: readonly TerrainDef[]): Item[] {
  const out: Array<{ order: number; item: Item }> = [];
  const groundIdx: number[] = [];
  terrain.forEach((t, i) => {
    if (t.points.length < 3) return;
    if (t.kind === 'ground') groundIdx.push(i);
    else out.push({ order: i, item: { kind: t.kind, loops: [normalizeCCW(t.points)] } });
  });
  for (const g of touchingGroups(groundIdx.map((i) => terrain[i].points))) {
    const idx = g.map((k) => groundIdx[k]);
    const loops = idx.length > 1 ? unionPolygons(idx.map((i) => terrain[i].points)) : [normalizeCCW(terrain[idx[0]].points)];
    out.push({ order: idx[0], item: { kind: 'ground', loops } });
  }
  return out.sort((a, b) => a.order - b.order).map((o) => o.item);
}

function buildGeo(item: Item, theme: ThemeId): Geo {
  const loops = item.loops.filter((l) => l.length >= 3);
  const P = THEME_PALETTES[theme];
  const path = new Path2D();
  for (const l of loops) polyPath(l, true, path);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let npts = 0;
  for (const l of loops) {
    const [x0, y0, x1, y1] = bboxOf(l);
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
    minY = Math.min(minY, y0);
    maxY = Math.max(maxY, y1);
    npts += l.length;
  }
  const seed = Math.round(minX * 131 + minY * 71 + maxX * 17 + npts * 7) | 0;
  const r = rand(seed ^ 0x5bd1e995);
  const chains = loops.flatMap((l) => topChains(l, 0.45));
  let surfaceY = maxY;
  for (const ch of chains) for (const p of ch.pts) surfaceY = Math.min(surfaceY, p[1]);
  const area = loops.reduce((a, l) => a + polyArea(l), 0);

  // кромка зависит от вида рельефа
  const kind = item.kind;
  const edgeKind: GroundPalette['edge'] | 'moss' | 'none' =
    kind === 'ground'
      ? P.ground.edge
      : kind === 'rock'
        ? P.rock.cap ?? 'none'
        : theme === 'snow'
          ? 'snow'
          : maxY - minY > 1.2 && P.rock.cap === 'moss'
            ? 'moss'
            : 'none';
  const T = kind === 'ground' ? edgeThickness(P.ground.edge) : edgeKind === 'snow' ? 0.26 : edgeKind === 'moss' ? 0.14 : 0;
  const blades = edgeKind === 'grass' || edgeKind === 'moss';
  const bladeSc = edgeKind === 'moss' ? 0.6 : 1;
  const capSc = kind === 'ground' ? 1 : 0.75;

  // кромка режется на куски вдоль цепочек: каждый кадр рисуются только видимые
  const pieces: Piece[] = [];
  for (const ch of chains) {
    const cum = chainCum(ch);
    const total = cum[cum.length - 1];
    if (total < 1e-6) continue;
    // снежные «подушки» — крупные и редкие (период 0.8–1.5 м), непрерывны через границы кусков
    const bumps: Array<[number, number, number]> = [];
    if (edgeKind === 'snow') {
      for (let s = lerp(0.2, 0.6, r()); s < total - 0.1; ) {
        const step = lerp(0.8, 1.5, r());
        bumps.push([s, step * lerp(0.55, 0.7, r()), lerp(0.08, 0.15, r()) * capSc]);
        s += step;
      }
    }
    const bumpH = (s: number): number => {
      let h = 0;
      for (const [c, half, hh] of bumps) {
        const u = (s - c) / half;
        if (u > -1 && u < 1) h = Math.max(h, hh * Math.pow(1 - u * u, 0.6));
      }
      // к концам цепочки шапка сходит на нет
      return h * smooth(clamp(Math.min(s, total - s) / 0.35, 0, 1)) + 0.03 * capSc;
    };
    // фестоны нижнего края кромки: круги (s, r) вдоль всей цепочки; глубина края — их огибающая
    const scal: Array<[number, number]> = [];
    if (T > 0) {
      let q = 0;
      for (let s = 0.05; s < total; s += lerp(0.17, 0.26, r())) scal.push([s, (q++ % 2 ? 0.085 : 0.115) * (T / 0.34) * lerp(0.85, 1.15, r())]);
    }
    let j0 = 0;
    const depthAt = (u: number): number => {
      // u растёт внутри куска; между кусками — сброс указателя назад
      while (j0 > 0 && scal[j0 - 1][0] > u - 0.2) j0--;
      while (j0 < scal.length && scal[j0][0] < u - 0.2) j0++;
      let d = T;
      for (let j = j0; j < scal.length && scal[j][0] < u + 0.2; j++) {
        const [c, rad] = scal[j];
        const du = u - c;
        if (du > -rad && du < rad) d = Math.max(d, T - 0.35 * rad + Math.sqrt(rad * rad - du * du));
      }
      return d;
    };
    const cuts = pieceCuts(cum, total, PIECE_M);
    let carryB = 0.04;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const sub = subChain(ch, cum, cuts[k], cuts[k + 1]);
      const o0 = Math.max(0, cuts[k] - PIECE_OV);
      const o1 = Math.min(total, cuts[k + 1] + PIECE_OV);
      const subO = subChain(ch, cum, o0, o1);
      if (sub.pts.length < 2 || subO.pts.length < 2) continue;
      const [x0, y0, x1, y1] = bboxOf(subO.pts);
      const pc: Piece = {
        minX: x0 - PIECE_PAD,
        maxX: x1 + PIECE_PAD,
        minY: y0 - PIECE_PAD,
        maxY: y1 + PIECE_PAD,
        chain: polyPath(subO.pts, false),
        band: new Path2D(),
        highlight: new Path2D(),
        bladesBack: null,
        bladesFront: null,
        capFill: null,
        capLine: null,
      };
      if (T > 0) {
        // тело кромки одним многоугольником: верх — поверхность с запасом наружу (лишнее режет клип полигона),
        // низ — фестоны (огибающая кругов вдоль цепочки)
        const lower = bandLower(ch, cum, o0, o1, depthAt);
        polyPath(offsetChain(subO, -0.12).concat(lower.reverse()), true, pc.band);
        polyPath(offsetChain(subO, Math.min(0.075, T * 0.3)), false, pc.highlight);
      }
      if (blades) {
        // травинки поверх обводки (два прохода: задние темнее)
        const back = new Path2D();
        const front = new Path2D();
        carryB = walkChain(sub, () => lerp(0.06, 0.16, r()) * (r() < 0.12 ? 3 : 1), carryB, (x, y, nx, ny, tx, ty) => {
          const isBack = r() < 0.5;
          const h = lerp(0.08, isBack ? 0.2 : 0.15, r()) * bladeSc;
          const lean = (r() - 0.45) * 0.09 * bladeSc;
          const bw = lerp(0.03, 0.045, r()) * bladeSc;
          const B = isBack ? back : front;
          const bx = x - nx * 0.03;
          const by = y - ny * 0.03;
          B.moveTo(bx - tx * bw, by - ty * bw);
          B.quadraticCurveTo(bx + nx * h * 0.6 - tx * bw * 0.2, by + ny * h * 0.6 - ty * bw * 0.2, bx + nx * h + tx * lean, by + ny * h + ty * lean);
          B.quadraticCurveTo(bx + nx * h * 0.5 + tx * bw * 0.6, by + ny * h * 0.5 + ty * bw * 0.6, bx + tx * bw, by + ty * bw);
          B.closePath();
        });
        pc.bladesBack = back;
        pc.bladesFront = front;
      } else if (edgeKind === 'snow') {
        // снежная «подушка»: бугристый внешний контур (тонкая линия по силуэту) + заливка до кромки
        const outer = capOutline(subO, o0, bumpH);
        pc.capLine = polyPath(outer, false);
        pc.capFill = polyPath(outer.concat(offsetChain(subO, 0.035).reverse()), true);
      }
      pieces.push(pc);
    }
  }

  // скала: крупные грани (плоскости, темнеющие вправо — свет слева) и группы трещин разной длины (≈ 1 на 4.5 м²)
  let cracks: Path2D | null = null;
  let facets: Path2D[] | null = null;
  let facetLight: Path2D | null = null;
  let facetEdges: Path2D | null = null;
  if (kind === 'rock') {
    const w = maxX - minX;
    const h = maxY - minY;
    const far = w + h + 2;
    facets = [];
    facetEdges = new Path2D();
    facetLight = new Path2D();
    const nF = clamp(Math.round(w / 2.2), 2, 5);
    for (let f = 0; f < nF; f++) {
      // ребро грани: наклонная линия сверху вниз-вправо; правее неё — плоскость в тени (тени копятся к правому краю)
      const slant = lerp(0.35, 0.7, r()) * (h + 1);
      const xt = minX + w * (0.18 + (0.72 * (f + lerp(0.2, 0.8, r()))) / nF) - slant * 0.5;
      const top: P2 = [xt, maxY + 0.5];
      const bot: P2 = [xt + slant, minY - 0.5];
      const q = new Path2D();
      polyPath([top, bot, [maxX + far, minY - 0.5], [maxX + far, maxY + 0.5]], true, q);
      facets.push(q);
      facetEdges.moveTo(top[0] - 0.03, top[1]);
      facetEdges.lineTo(bot[0] - 0.03, bot[1]);
      if (f === 0) polyPath([[minX - far, maxY + 0.5], top, bot, [minX - far, minY - 0.5]], true, facetLight);
    }
    // трещины: главная вниз от точки у верха, 1–2 ответвления отходят от неё ниже (не «стрелки» из одной точки)
    cracks = new Path2D();
    const inside = (x: number, y: number): boolean => loops.some((l) => pointInPoly(l, x, y));
    const groups = Math.max(1, Math.round(Math.abs(area) / 4.5));
    for (let gI = 0; gI < groups; gI++) {
      let ox = 0;
      let oy = 0;
      let ok = false;
      for (let tries = 0; tries < 12 && !ok; tries++) {
        ox = lerp(minX + 0.3, maxX - 0.3, r());
        oy = lerp(minY + h * 0.35, maxY - 0.3, r());
        ok = inside(ox, oy) && inside(ox, oy - 0.4);
      }
      if (!ok) continue;
      const crack = (x0: number, y0: number, a0: number, len: number): P2[] => {
        const pts: P2[] = [[x0, y0]];
        let a = a0;
        let x = x0;
        let y = y0;
        const segs = 3 + Math.floor(r() * 3);
        for (let k = 0; k < segs; k++) {
          a += (r() - 0.5) * 0.8;
          const l = (len / segs) * lerp(0.6, 1.4, r());
          x += Math.cos(a) * l;
          y += Math.sin(a) * l;
          pts.push([x, y]);
        }
        polyPath(pts, false, cracks!);
        return pts;
      };
      const main = crack(ox, oy, -Math.PI / 2 + (r() - 0.5) * 0.8, lerp(0.45, 1.3, r()));
      const u = r();
      const nb = u < 0.4 ? 0 : u < 0.85 ? 1 : 2;
      for (let k = 0; k < nb; k++) {
        const p = main[1 + Math.floor(r() * (main.length - 2))];
        crack(p[0], p[1], -Math.PI / 2 + (r() < 0.5 ? -1 : 1) * lerp(0.6, 1.0, r()), lerp(0.2, 0.5, r()));
      }
    }
  }

  // стороны, обращённые от света (низ и право) — для внутренней тени скал и помостов
  const shadeEdges = new Path2D();
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const a = l[i];
      const b = l[(i + 1) % l.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-6) continue;
      // внутренность слева → внешняя нормаль справа
      const nx = (b[1] - a[1]) / len;
      const ny = -(b[0] - a[0]) / len;
      if (nx * 0.6 - ny * 0.8 > 0.35) {
        shadeEdges.moveTo(a[0], a[1]);
        shadeEdges.lineTo(b[0], b[1]);
      }
    }
  }

  // помост: доски и скобы (тонкий) или неровная кладка (толстый)
  let deck: DeckGeo | null = null;
  if (kind === 'platform') {
    const h = maxY - minY;
    const wood = h <= 1.2;
    const seams = new Path2D();
    const seamsLight = new Path2D();
    const grain = new Path2D();
    const straps: Array<[number, number, number, number]> = [];
    const rivets: P2[] = [];
    const stones: Stone[] = [];
    if (wood) {
      const rows = Math.max(1, Math.round(h / 0.26));
      const rh = h / rows;
      for (let i = 1; i < rows; i++) {
        const y = maxY - i * rh;
        seams.moveTo(minX, y);
        seams.lineTo(maxX, y);
        seamsLight.moveTo(minX, y - 0.022);
        seamsLight.lineTo(maxX, y - 0.022);
      }
      for (let i = 0; i < rows; i++) {
        const y0 = maxY - i * rh;
        const y1 = y0 - rh;
        // стыки досок, со сдвигом по рядам
        for (let x = minX + lerp(0.6, 1.6, r()); x < maxX - 0.3; x += lerp(1.5, 2.3, r())) {
          seams.moveTo(x, y0);
          seams.lineTo(x, y1);
          seamsLight.moveTo(x + 0.022, y0);
          seamsLight.lineTo(x + 0.022, y1);
        }
        // волокна
        for (let q = 0; q < 2; q++) {
          const yy = lerp(y1 + rh * 0.25, y0 - rh * 0.25, r());
          const ph = r() * TAU;
          const lam = lerp(0.8, 1.6, r());
          for (let x = minX; x <= maxX; x += 0.08) {
            const yv = yy + 0.012 * Math.sin((TAU * x) / lam + ph);
            if (x === minX) grain.moveTo(x, yv);
            else grain.lineTo(x, yv);
          }
        }
      }
      // металлические скобы
      const span = maxX - minX;
      const nStr = Math.max(2, Math.round(span / 1.9) + 1);
      for (let i = 0; i < nStr; i++) {
        const cx = lerp(minX + 0.35, maxX - 0.35, nStr === 1 ? 0.5 : i / (nStr - 1));
        straps.push([cx - 0.09, minY, 0.18, h]);
        rivets.push([cx, maxY - Math.min(0.13, h * 0.25)], [cx, minY + Math.min(0.13, h * 0.25)]);
      }
    } else {
      // кладка: ряды разной высоты, камни разной длины, без сквозных вертикальных швов
      const hs: number[] = [];
      let acc = 0;
      while (acc < h - 0.01) {
        const rh = lerp(0.38, 0.62, r());
        hs.push(rh);
        acc += rh;
      }
      const k = h / acc;
      let y1 = maxY;
      for (const rh0 of hs) {
        const rh = rh0 * k;
        const y0 = y1 - rh;
        let x = minX - lerp(0, 0.6, r());
        while (x < maxX) {
          const w = lerp(0.55, 1.35, r()) * (rh / 0.5);
          stones.push({ x0: x, y0, x1: Math.min(maxX + 0.2, x + w), y1, tone: r() });
          x += w;
        }
        y1 = y0;
      }
    }
    deck = { wood, seams, seamsLight, grain, straps, rivets, stones };
  }

  return {
    kind,
    path,
    minX,
    maxX,
    minY,
    maxY,
    chains,
    surfaceY,
    shadeEdges,
    edgeT: T,
    pieces,
    vis: new Map(),
    cracks,
    facets,
    facetLight,
    facetEdges,
    deck,
  };
}

/** Объединённые пути кусков кромки, попавших в вид [x0, x1] × [y0, y1]; кэш по набору кусков (до 8 наборов). */
function visOf(g: Geo, x0: number, x1: number, y0: number, y1: number): Vis {
  const idx: number[] = [];
  for (let i = 0; i < g.pieces.length; i++) {
    const p = g.pieces[i];
    if (p.maxX >= x0 && p.minX <= x1 && p.maxY >= y0 && p.minY <= y1) idx.push(i);
  }
  const key = idx.join(',');
  const hit = g.vis.get(key);
  if (hit) {
    // LRU: в конец
    g.vis.delete(key);
    g.vis.set(key, hit);
    return hit;
  }
  const v: Vis = { chain: new Path2D(), band: new Path2D(), highlight: new Path2D(), bladesBack: null, bladesFront: null, capFill: null, capLine: null };
  const add = (into: Path2D | null, src: Path2D | null): Path2D | null => {
    if (!src) return into;
    const d = into ?? new Path2D();
    d.addPath(src);
    return d;
  };
  for (const i of idx) {
    const p = g.pieces[i];
    v.chain.addPath(p.chain);
    v.band.addPath(p.band);
    v.highlight.addPath(p.highlight);
    v.bladesBack = add(v.bladesBack, p.bladesBack);
    v.bladesFront = add(v.bladesFront, p.bladesFront);
    v.capFill = add(v.capFill, p.capFill);
    v.capLine = add(v.capLine, p.capLine);
  }
  g.vis.set(key, v);
  if (g.vis.size > 8) g.vis.delete(g.vis.keys().next().value as string);
  return v;
}

// ───────────────────────── векторная отрисовка ─────────────────────────

/** Матрица контекста как 6 чисел (a, b, c, d, e, f). */
type Mat = [number, number, number, number, number, number];
const IDENT: Mat = [1, 0, 0, 1, 0, 0];

function toMat(m: DOMMatrixReadOnly | null | undefined): Mat {
  return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : IDENT;
}

/**
 * Трансформация кадра для поворота от тряски: поворот на angle (рад, против часовой на экране — как CameraView.shakeAngle)
 * вокруг центра экрана. Рендер передаёт одну и ту же матрицу рельефу, переднему плану и телам — они остаются совмещены.
 */
export function shakeFrame(view: ViewInfo, angle: number): DOMMatrix {
  const cx = view.screenW / 2;
  const cy = view.screenH / 2;
  return new DOMMatrix().translate(cx, cy).rotate((-angle * 180) / Math.PI).translate(-cx, -cy);
}

/** Мировой прямоугольник отсечения. */
interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * Векторная отрисовка рельефа в трансформации base · [s, 0, 0, −s, ox, oy] (мир → пиксели вида, Y вверх),
 * только единицы, пересекающие мировой прямоугольник R.
 */
function drawVector(ctx: Ctx2D, geos: Geo[], theme: ThemeId, base: Mat, s: number, ox: number, oy: number, R: Rect): void {
  const P = TERRAIN_PALETTES[theme];
  const [a, b, c, d, e, f] = base;
  ctx.save();
  ctx.setTransform(a * s, b * s, -c * s, -d * s, a * ox + c * oy + e, b * ox + d * oy + f);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  const px = 1 / s;
  for (const g of geos) {
    if (g.maxX + 0.5 < R.x0 || g.minX - 0.5 > R.x1 || g.maxY + 0.5 < R.y0 || g.minY - 0.5 > R.y1) continue;
    const V = visOf(g, R.x0, R.x1, R.y0, R.y1);
    if (g.kind === 'ground') drawGround(ctx, g, V, P, theme, px);
    else if (g.kind === 'rock') drawRock(ctx, g, V, P, px);
    else drawPlatform(ctx, g, V, P, theme, px);
  }
  ctx.restore();
}

function outlineWidth(px: number): number {
  return Math.max(0.06, 1.5 * px);
}

/** Кромка (трава / песок / снег / мох) по верхним рёбрам — внутри клипа полигона. Плоские концы штрихов (без «шаров»). */
function drawEdgeBand(ctx: Ctx2D, g: Geo, V: Vis, top: string, dark: string, lip: string, light: string, px: number): void {
  const T = g.edgeT;
  if (T <= 0 || !g.chains.length) return;
  ctx.lineCap = 'butt';
  // «губа» — тёмная тень под кромкой
  ctx.save();
  ctx.translate(0, -0.06);
  ctx.fillStyle = lip;
  ctx.fill(V.band);
  ctx.restore();
  // тело кромки: тёмный низ → основной цвет → светлый верх (ступенчатый «градиент» вдоль кромки)
  ctx.fillStyle = dark;
  ctx.fill(V.band);
  ctx.strokeStyle = mix(dark, top, 0.55);
  ctx.lineWidth = 2 * T * 0.74;
  ctx.stroke(V.chain);
  ctx.strokeStyle = top;
  ctx.lineWidth = 2 * T * 0.5;
  ctx.stroke(V.chain);
  // блик у самого края
  ctx.strokeStyle = rgba(light, 0.9);
  ctx.lineWidth = Math.max(0.055, 1.2 * px);
  ctx.stroke(V.highlight);
}

function drawGround(ctx: Ctx2D, g: Geo, V: Vis, P: TerrainPalette, theme: ThemeId, px: number): void {
  const G = P.ground;
  // 1. грунт: бесшовная текстура в мировых координатах
  const pat = worldPattern(ctx, `soil:${theme}`, soilTile(theme), SOIL_M);
  ctx.fillStyle = pat ?? G.soil;
  ctx.fill(g.path);
  // 2. затемнение вглубь от нижней поверхности
  const dg = ctx.createLinearGradient(0, g.surfaceY - 0.25, 0, g.surfaceY - 4.5);
  dg.addColorStop(0, rgba(G.soilDeep, 0));
  dg.addColorStop(1, rgba(G.soilDeep, 0.72));
  ctx.fillStyle = dg;
  ctx.fill(g.path);
  ctx.save();
  ctx.clip(g.path);
  // 3. мягкая тень под кромкой (объём) + кромка; плоские концы — без тёмных «пятен» во внутренних углах
  ctx.strokeStyle = rgba(G.soilDeep, 0.22);
  ctx.lineWidth = 2 * (g.edgeT + 0.32);
  ctx.lineCap = 'butt';
  ctx.stroke(V.chain);
  drawEdgeBand(ctx, g, V, G.top, G.dark, G.lip, G.light, px);
  ctx.restore();
  // 4. обводка полигона
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = G.outline;
  ctx.stroke(g.path);
  // 5. поверх обводки: травинки или снежная подушка
  drawOverEdge(ctx, g, V, G.top, G.dark, G.light, mix(G.outline, G.lip, 0.5), px);
}

/** Травинки / снежная шапка поверх обводки; у шапки — только тонкая линия по силуэту. */
function drawOverEdge(ctx: Ctx2D, g: Geo, V: Vis, top: string, dark: string, light: string, capLine: string, px: number): void {
  if (V.bladesBack && V.bladesFront) {
    ctx.fillStyle = dark;
    ctx.fill(V.bladesBack);
    ctx.fillStyle = top;
    ctx.fill(V.bladesFront);
  }
  if (V.capFill && V.capLine) {
    const grd = ctx.createLinearGradient(0, g.maxY + 0.2, 0, g.surfaceY - 0.3);
    grd.addColorStop(0, light);
    grd.addColorStop(1, top);
    ctx.fillStyle = grd;
    ctx.fill(V.capFill);
    ctx.lineWidth = Math.max(0.035, px);
    ctx.strokeStyle = capLine;
    ctx.lineCap = 'round';
    ctx.stroke(V.capLine);
    ctx.lineCap = 'butt';
  }
}

function drawRock(ctx: Ctx2D, g: Geo, V: Vis, P: TerrainPalette, px: number): void {
  const R = P.rock;
  const grd = ctx.createLinearGradient(g.minX, g.maxY, g.minX + (g.maxY - g.minY) * 0.35, g.minY);
  grd.addColorStop(0, R.light);
  grd.addColorStop(0.45, R.fill);
  grd.addColorStop(1, R.dark);
  ctx.fillStyle = grd;
  ctx.fill(g.path);
  ctx.save();
  ctx.clip(g.path);
  // крупные грани: плоскости правее рёбер темнеют (свет слева), левая — светлее; рёбра — тонкая светлая линия
  if (g.facets) {
    ctx.fillStyle = rgba(R.dark, 0.17);
    for (const f of g.facets) ctx.fill(f);
  }
  if (g.facetLight) {
    ctx.fillStyle = rgba(R.light, 0.2);
    ctx.fill(g.facetLight);
  }
  // фактура: два несоизмеримых слоя
  const big = worldPattern(ctx, 'rockBig', rockTileBig(), ROCK_BIG_M);
  if (big) {
    ctx.fillStyle = big;
    ctx.fill(g.path);
  }
  const fine = worldPattern(ctx, 'rockFine', rockTileFine(), ROCK_FINE_M);
  if (fine) {
    ctx.fillStyle = fine;
    ctx.fill(g.path);
  }
  if (g.facetEdges) {
    ctx.lineCap = 'butt';
    ctx.strokeStyle = rgba(R.light, 0.4);
    ctx.lineWidth = Math.max(0.03, px);
    ctx.stroke(g.facetEdges);
  }
  // фаска: внутренняя тень по нижним/правым сторонам и светлая верхняя кромка
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgba(R.dark, 0.6);
  ctx.lineWidth = 0.36;
  ctx.stroke(g.shadeEdges);
  ctx.strokeStyle = rgba(R.light, 0.85);
  ctx.lineWidth = 0.24;
  ctx.stroke(V.chain);
  ctx.strokeStyle = rgba('#FFFFFF', 0.4);
  ctx.lineWidth = Math.max(0.05, 1.2 * px);
  ctx.stroke(V.highlight);
  // трещины группами: тёмная щель + светлая стенка ниже-правее
  if (g.cracks) {
    ctx.lineCap = 'round';
    ctx.save();
    ctx.translate(0.025, -0.025);
    ctx.strokeStyle = rgba(R.light, 0.5);
    ctx.lineWidth = Math.max(0.035, px);
    ctx.stroke(g.cracks);
    ctx.restore();
    ctx.strokeStyle = rgba(R.outline, 0.65);
    ctx.lineWidth = Math.max(0.045, 1.2 * px);
    ctx.stroke(g.cracks);
    ctx.lineCap = 'butt';
  }
  if (R.cap === 'moss') drawEdgeBand(ctx, g, V, P.moss.top, P.moss.dark, mix(P.moss.dark, R.dark, 0.5), P.moss.light, px);
  ctx.restore();
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = R.outline;
  ctx.stroke(g.path);
  if (R.cap === 'moss') drawOverEdge(ctx, g, V, P.moss.top, P.moss.dark, P.moss.light, R.outline, px);
  if (R.cap === 'snow') {
    ctx.save();
    ctx.clip(g.path);
    drawEdgeBand(ctx, g, V, P.ground.top, P.ground.dark, P.ground.lip, P.ground.light, px);
    ctx.restore();
    drawOverEdge(ctx, g, V, P.ground.top, P.ground.dark, P.ground.light, mix(R.outline, P.ground.lip, 0.5), px);
  }
}

function drawPlatform(ctx: Ctx2D, g: Geo, V: Vis, P: TerrainPalette, theme: ThemeId, px: number): void {
  const d = g.deck;
  if (!d) return;
  const D = P.deck;
  const R = P.rock;
  const outline = d.wood ? D.outline : R.outline;
  if (d.wood) {
    const grd = ctx.createLinearGradient(0, g.maxY, 0, g.minY);
    grd.addColorStop(0, D.light);
    grd.addColorStop(0.3, D.base);
    grd.addColorStop(1, D.dark);
    ctx.fillStyle = grd;
  } else {
    // раствор между камнями
    ctx.fillStyle = mix(R.dark, R.outline, 0.35);
  }
  ctx.fill(g.path);
  ctx.save();
  ctx.clip(g.path);
  if (!d.wood) {
    // неровная кладка: камни со скруглёнными углами, тон каждого свой, фаска сверху-слева / тень снизу-справа
    const lit = new Path2D();
    const shade = new Path2D();
    const gap = 0.035;
    for (const st of d.stones) {
      const x0 = st.x0 + gap;
      const x1 = st.x1 - gap;
      const y0 = st.y0 + gap;
      const y1 = st.y1 - gap;
      if (x1 - x0 < 0.05 || y1 - y0 < 0.05) continue;
      const rr = Math.min(0.09, (y1 - y0) * 0.3);
      const p = new Path2D();
      p.roundRect(x0, y0, x1 - x0, y1 - y0, rr);
      const t = st.tone;
      ctx.fillStyle = t < 0.5 ? mix(R.fill, R.dark, (0.5 - t) * 0.7) : mix(R.fill, R.light, (t - 0.5) * 0.8);
      ctx.fill(p);
      lit.moveTo(x0 + rr, y1 - 0.03);
      lit.lineTo(x1 - rr, y1 - 0.03);
      lit.moveTo(x0 + 0.03, y1 - rr);
      lit.lineTo(x0 + 0.03, y0 + rr);
      shade.moveTo(x0 + rr, y0 + 0.03);
      shade.lineTo(x1 - rr, y0 + 0.03);
      shade.moveTo(x1 - 0.03, y0 + rr);
      shade.lineTo(x1 - 0.03, y1 - rr);
    }
    const fine = worldPattern(ctx, 'rockFine', rockTileFine(), ROCK_FINE_M);
    if (fine) {
      ctx.fillStyle = fine;
      ctx.fill(g.path);
    }
    ctx.lineWidth = Math.max(0.04, 1.2 * px);
    ctx.strokeStyle = rgba(R.light, 0.6);
    ctx.stroke(lit);
    ctx.strokeStyle = rgba(R.outline, 0.35);
    ctx.stroke(shade);
  } else {
    ctx.strokeStyle = rgba(D.seam, 0.35);
    ctx.lineWidth = Math.max(0.014, 0.8 * px);
    ctx.stroke(d.grain);
    // швы: светлая стенка + тёмная щель
    ctx.strokeStyle = rgba(D.light, 0.6);
    ctx.lineWidth = Math.max(0.022, px);
    ctx.stroke(d.seamsLight);
    ctx.strokeStyle = D.seam;
    ctx.lineWidth = Math.max(0.03, 1.2 * px);
    ctx.stroke(d.seams);
    // металлические скобы с заклёпками
    for (const [x, y, w, h] of d.straps) {
      const mg = ctx.createLinearGradient(x, 0, x + w, 0);
      mg.addColorStop(0, D.metalLight);
      mg.addColorStop(0.45, D.metal);
      mg.addColorStop(1, D.metalDark);
      ctx.fillStyle = mg;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = D.metalDark;
      ctx.lineWidth = Math.max(0.022, px);
      ctx.strokeRect(x, y - 0.1, w, h + 0.2);
    }
    for (const [x, y] of d.rivets) {
      ctx.fillStyle = D.metalDark;
      ctx.beginPath();
      ctx.arc(x + 0.008, y - 0.008, 0.042, 0, TAU);
      ctx.fill();
      ctx.fillStyle = D.metalLight;
      ctx.beginPath();
      ctx.arc(x, y, 0.032, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(x - 0.01, y + 0.01, 0.012, 0, TAU);
      ctx.fill();
    }
  }
  // объём: тень снизу-справа, блик сверху
  ctx.lineCap = 'butt';
  ctx.strokeStyle = rgba(d.wood ? D.seam : R.dark, 0.5);
  ctx.lineWidth = 0.2;
  ctx.stroke(g.shadeEdges);
  ctx.strokeStyle = rgba(d.wood ? D.light : R.light, 0.9);
  ctx.lineWidth = 0.09;
  ctx.stroke(V.chain);
  if (!d.wood && R.cap === 'moss') drawEdgeBand(ctx, g, V, P.moss.top, P.moss.dark, mix(P.moss.dark, R.dark, 0.5), P.moss.light, px);
  ctx.restore();
  ctx.lineWidth = outlineWidth(px);
  ctx.strokeStyle = outline;
  ctx.stroke(g.path);
  if (theme === 'snow') drawOverEdge(ctx, g, V, P.ground.top, P.ground.dark, P.ground.light, mix(outline, P.ground.lip, 0.5), px);
  else if (!d.wood && R.cap === 'moss') drawOverEdge(ctx, g, V, P.moss.top, P.moss.dark, P.moss.light, R.outline, px);
}

// ───────────────────────── кэш тайлов ─────────────────────────

/** Сторона тайла, px; холст тайла на 1 px больше (нахлёст — без щелей при дробном смещении и масштабе). */
const TT = 256;
const TC = TT + 1;
const TILE_BYTES = TC * TC * 4;
/** Бюджет построения тайлов внутри кадра, мс (остальное — в простое). */
const TILE_BUDGET_MS = 0.5;
/** Если видимый тайл не готов столько кадров подряд (простоя нет), один тайл строится в кадре сверх бюджета. */
const TILE_FORCE_FRAMES = 20;
/** Предел памяти тайлов рельефа (все масштабы), байт; LRU. */
const TILE_MAX_BYTES = 28 * 1024 * 1024;
/** Зум считается неподвижным, если масштаб не уходил дальше TILE_EPS столько, мс. */
const TILE_STABLE_MS = 250;
/** Относительный допуск масштаба: при 1920 px расхождение тайлов с миром на краю ≤ 0.25 px. */
const TILE_EPS = 2.5e-4;
/** Сколько масштабов держать (самый посещаемый не вытесняется редким). */
const MAX_SETS = 2;

interface TTile {
  /** null — в тайле нет рельефа. */
  c: AnyCanvas | null;
  used: number;
}

interface TileSet {
  scale: number;
  tiles: Map<number, TTile>;
  pinned: boolean;
  used: number;
}

interface IdleJob {
  set: TileSet;
  i: number;
  j: number;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const tileKey = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
const hasDom = (): boolean => typeof document !== 'undefined';

let primeCtx: Ctx2D | null = null;

/**
 * Рисовальщик рельефа с собственным кэшем (один активный рельеф). drawTerrain() пользуется общим экземпляром;
 * отдельные экземпляры нужны, только если рельеф рисуется на нескольких холстах одновременно (предпросмотр).
 */
export class TerrainRenderer {
  private ref: readonly TerrainDef[] | null = null;
  private key = '';
  private items: Item[] = [];
  private geos = new Map<ThemeId, Geo[]>();
  private theme: ThemeId | null = null;
  private sets: TileSet[] = [];
  /** Сколько раз зум «вставал» на масштаб (ключ — округлённый масштаб): самый посещаемый не вытесняется. */
  private visits = new Map<number, number>();
  private anchor = 0;
  private since = 0;
  private lastStable: TileSet | null = null;
  private frame = 0;
  private missFrames = 0;
  private queue: IdleJob[] = [];
  private idleId: number | null = null;
  private avgTileMs = 2;
  private bytes = 0;

  /** Память тайлов, байт. */
  get memoryBytes(): number {
    return this.bytes;
  }

  /** Освободить кэш (тайлы, геометрию). Следующий draw() построит всё заново. */
  release(): void {
    this.ref = null;
    this.key = '';
    this.items = [];
    this.geos.clear();
    this.dropTiles();
    this.visits.clear();
    this.theme = null;
  }

  private dropTiles(): void {
    this.cancelIdle();
    this.sets = [];
    this.queue = [];
    this.bytes = 0;
    this.lastStable = null;
    this.missFrames = 0;
  }

  /** Привязать рельеф: тот же массив — без работы; новый массив — по хэшу содержимого (смена — сброс кэша). */
  private bind(terrain: readonly TerrainDef[], theme: ThemeId): Geo[] {
    if (terrain !== this.ref) {
      const key = terrainHash(terrain);
      if (key !== this.key) {
        this.release();
        this.key = key;
        this.items = buildItems(terrain);
        // первый кадр уровня: тайлы начинают строиться сразу
        this.anchor = 0;
      }
      this.ref = terrain;
    }
    if (theme !== this.theme) {
      this.theme = theme;
      this.dropTiles();
    }
    let g = this.geos.get(theme);
    if (!g) {
      g = this.items.map((it) => buildGeo(it, theme));
      this.geos.set(theme, g);
    }
    return g;
  }

  /** Набор тайлов точно под масштаб или null — рисовать векторно. */
  private pickSet(scale: number): TileSet | null {
    const now = nowMs();
    if (this.anchor === 0) {
      this.anchor = scale;
      this.since = now - TILE_STABLE_MS;
    } else if (Math.abs(scale / this.anchor - 1) > TILE_EPS) {
      this.anchor = scale;
      this.since = now;
    }
    const stable = now - this.since >= TILE_STABLE_MS;
    const vkey = Math.round(Math.log(scale) * 2000);
    let exact: TileSet | null = null;
    for (const s of this.sets) if (Math.abs(scale / s.scale - 1) <= TILE_EPS) exact = s;
    if (stable && exact !== this.lastStable) {
      this.visits.set(vkey, (this.visits.get(vkey) ?? 0) + 1);
      this.lastStable = exact;
    }
    if (exact) {
      exact.used = this.frame;
      return exact;
    }
    if (stable) {
      const v = this.visits.get(vkey) ?? 1;
      let victim: TileSet | null = null;
      if (this.sets.length >= MAX_SETS) {
        let vv = Infinity;
        for (const s of this.sets) {
          if (s.pinned) continue;
          const sv = this.visits.get(Math.round(Math.log(s.scale) * 2000)) ?? 0;
          if (sv < vv || (sv === vv && victim && s.used < victim.used)) {
            vv = sv;
            victim = s;
          }
        }
        // редкий масштаб не вытесняет часто посещаемый — он рисуется векторно
        if (victim && v < vv) victim = null;
      }
      if (this.sets.length < MAX_SETS || victim) {
        if (victim) this.dropSet(victim);
        const set: TileSet = { scale, tiles: new Map(), pinned: false, used: this.frame };
        this.sets.push(set);
        this.lastStable = set;
        return set;
      }
    }
    // пока зум меняется (и для редкого масштаба) — векторно: масштабированный блит тайлов в Chrome растеризуется
    // синхронно (замер 2560×1440: ~29 мс вызова против ~0.1 мс у векторной записи), выигрыша на CPU-растре нет
    return null;
  }

  private dropSet(set: TileSet): void {
    for (const t of set.tiles.values()) if (t.c) this.bytes -= TILE_BYTES;
    this.sets = this.sets.filter((s) => s !== set);
    this.queue = this.queue.filter((q) => q.set !== set);
    if (this.lastStable === set) this.lastStable = null;
  }

  /** Запечь тайл (i, j) набора: пиксели мира X = x·s, Y = −y·s; тайл покрывает [i·TT, i·TT + TC) × [j·TT, j·TT + TC). */
  private buildTile(set: TileSet, geos: Geo[], theme: ThemeId, i: number, j: number): TTile {
    const t0 = nowMs();
    const s = set.scale;
    const R: Rect = { x0: (i * TT) / s, x1: (i * TT + TC) / s, y1: (-j * TT) / s, y0: (-(j * TT + TC)) / s };
    let any = false;
    for (const g of geos) {
      if (g.maxX + 0.5 >= R.x0 && g.minX - 0.5 <= R.x1 && g.maxY + 0.5 >= R.y0 && g.minY - 0.5 <= R.y1) {
        any = true;
        break;
      }
    }
    let tile: TTile = { c: null, used: this.frame };
    if (any) {
      const cv = createCanvas(TC, TC);
      drawVector(ctx2d(cv), geos, theme, IDENT, s, -i * TT, -j * TT, { x0: R.x0 - 1, x1: R.x1 + 1, y0: R.y0 - 1, y1: R.y1 + 1 });
      // растеризовать сейчас (в бюджете построения), а не при первом показе
      if (!primeCtx) primeCtx = ctx2d(createCanvas(1, 1));
      primeCtx.drawImage(cv, 0, 0, 1, 1, 0, 0, 1, 1);
      tile = { c: cv, used: this.frame };
      this.bytes += TILE_BYTES;
      this.avgTileMs = this.avgTileMs * 0.8 + (nowMs() - t0) * 0.2;
    }
    set.tiles.set(tileKey(i, j), tile);
    return tile;
  }

  /** Освободить давно не используемые тайлы сверх предела памяти. */
  private evict(): void {
    if (this.bytes <= TILE_MAX_BYTES) return;
    const list: Array<[TileSet, number, TTile]> = [];
    for (const s of this.sets) for (const [k, t] of s.tiles) if (t.c && t.used !== this.frame) list.push([s, k, t]);
    list.sort((a, b) => a[2].used - b[2].used);
    for (const [s, k] of list) {
      if (this.bytes <= TILE_MAX_BYTES * 0.8) break;
      s.tiles.delete(k);
      this.bytes -= TILE_BYTES;
    }
  }

  private cancelIdle(): void {
    if (this.idleId === null) return;
    const g = globalThis as unknown as { cancelIdleCallback?: (id: number) => void };
    if (typeof g.cancelIdleCallback === 'function') g.cancelIdleCallback(this.idleId);
    else clearTimeout(this.idleId);
    this.idleId = null;
  }

  private scheduleIdle(): void {
    if (this.idleId !== null || !this.queue.length) return;
    const g = globalThis as unknown as {
      requestIdleCallback?: (cb: (d: { timeRemaining(): number; didTimeout: boolean }) => void, o?: { timeout: number }) => number;
    };
    if (typeof g.requestIdleCallback === 'function') this.idleId = g.requestIdleCallback((d) => this.idle(d), { timeout: 400 });
    else this.idleId = setTimeout(() => this.idle(null), 24) as unknown as number;
  }

  /** Достройка тайлов в простое: видимые недостающие, затем кольцо вокруг вида (панорама без векторных кадров). */
  private idle(d: { timeRemaining(): number; didTimeout: boolean } | null): void {
    this.idleId = null;
    const theme = this.theme;
    const geos = theme ? this.geos.get(theme) : undefined;
    if (!theme || !geos || !hasDom()) {
      this.queue = [];
      return;
    }
    const t0 = nowMs();
    const left = (): number => (d ? d.timeRemaining() : 3 - (nowMs() - t0));
    let built = 0;
    while (this.queue.length) {
      if (left() < Math.min(this.avgTileMs * 1.2, 10) && !(d?.didTimeout && built === 0)) break;
      const q = this.queue.shift()!;
      if (!this.sets.includes(q.set) || q.set.tiles.has(tileKey(q.i, q.j))) continue;
      this.buildTile(q.set, geos, theme, q.i, q.j);
      built++;
    }
    this.evict();
    if (this.queue.length) this.scheduleIdle();
  }

  /**
   * Подготовить всё тяжёлое заранее (экран загрузки / интро): текстуры темы, геометрию рельефа и — если передан
   * вид — тайлы этого вида (обычно вид рогатки; его масштаб закрепляется в кэше). Возвращает затраченное время, мс.
   */
  prewarm(terrain: readonly TerrainDef[], theme: ThemeId, view?: ViewInfo): number {
    if (!hasDom()) return 0;
    const t0 = nowMs();
    soilTile(theme);
    rockTileBig();
    rockTileFine();
    const geos = this.bind(terrain, theme);
    if (view && view.scale > 0) {
      let set = this.sets.find((s) => Math.abs(view.scale / s.scale - 1) <= TILE_EPS);
      if (!set) {
        if (this.sets.length >= MAX_SETS) {
          const victim = this.sets.find((s) => !s.pinned);
          if (victim) this.dropSet(victim);
        }
        set = { scale: view.scale, tiles: new Map(), pinned: true, used: this.frame };
        this.sets.push(set);
      }
      set.pinned = true;
      this.visits.set(Math.round(Math.log(view.scale) * 2000), 1e6);
      const { i0, i1, j0, j1 } = this.tileRange(view, false);
      for (let j = j0 - 1; j <= j1 + 1; j++) for (let i = i0 - 1; i <= i1 + 1; i++) if (!set.tiles.has(tileKey(i, j))) this.buildTile(set, geos, theme, i, j);
      this.evict();
    }
    return nowMs() - t0;
  }

  /** Начало мировых пикселей на экране и диапазон видимых тайлов. */
  private tileRange(v: ViewInfo, snap: boolean): { ox: number; oy: number; i0: number; i1: number; j0: number; j1: number } {
    let ox = v.screenW / 2 - v.camX * v.scale;
    let oy = v.screenH / 2 + v.camY * v.scale;
    if (snap) {
      // дробный сдвиг ≤ 0.25 px — к целому пикселю (блит 1:1 без пересэмплирования), иначе — точно
      if (Math.abs(ox - Math.round(ox)) <= 0.25) ox = Math.round(ox);
      if (Math.abs(oy - Math.round(oy)) <= 0.25) oy = Math.round(oy);
    }
    return {
      ox,
      oy,
      i0: Math.floor(-ox / TT),
      i1: Math.floor((v.screenW - 1 - ox) / TT),
      j0: Math.floor(-oy / TT),
      j1: Math.floor((v.screenH - 1 - oy) / TT),
    };
  }

  /** Рельеф уровня в мировых координатах (см. drawTerrain). */
  draw(ctx: CanvasRenderingContext2D, terrain: readonly TerrainDef[], theme: ThemeId, view: ViewInfo, frame?: DOMMatrixReadOnly | null): void {
    if (!terrain.length || view.scale <= 0) return;
    const geos = this.bind(terrain, theme);
    this.frame++;
    const base = toMat(frame);
    // видимая область мира с запасом (и на поворот кадра от тряски)
    const halfW = view.screenW / 2 / view.scale + 1;
    const halfH = view.screenH / 2 / view.scale + 1;
    const VR: Rect = { x0: view.camX - halfW, x1: view.camX + halfW, y0: view.camY - halfH, y1: view.camY + halfH };
    const set = hasDom() ? this.pickSet(view.scale) : null;
    if (!set) {
      drawVector(ctx, geos, theme, base, view.scale, view.screenW / 2 - view.camX * view.scale, view.screenH / 2 + view.camY * view.scale, VR);
      return;
    }
    const plain = base[0] === 1 && base[1] === 0 && base[2] === 0 && base[3] === 1;
    const { ox, oy, i0, i1, j0, j1 } = this.tileRange(view, plain);
    const t0 = nowMs();
    let force = this.missFrames >= TILE_FORCE_FRAMES;
    const missing: number[] = [];
    ctx.save();
    ctx.setTransform(base[0], base[1], base[2], base[3], base[4], base[5]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let t = set.tiles.get(tileKey(i, j));
        if (!t && (force || nowMs() - t0 + this.avgTileMs <= TILE_BUDGET_MS)) {
          t = this.buildTile(set, geos, theme, i, j);
          force = false;
          this.missFrames = 0;
        }
        if (!t) {
          missing.push(i, j);
          continue;
        }
        t.used = this.frame;
        if (!t.c) continue;
        ctx.drawImage(t.c, ox + i * TT, oy + j * TT);
      }
    }
    if (missing.length) {
      // ещё не готовые тайлы — векторно, только внутри их прямоугольников
      ctx.beginPath();
      for (let q = 0; q < missing.length; q += 2) ctx.rect(ox + missing[q] * TT, oy + missing[q + 1] * TT, TT, TT);
      ctx.clip();
      drawVector(ctx, geos, theme, base, view.scale, ox, oy, VR);
    }
    ctx.restore();
    // очередь простоя: недостающие видимые, затем кольцо вокруг вида (панорама без векторных кадров)
    this.missFrames = missing.length ? this.missFrames + 1 : 0;
    const q: IdleJob[] = [];
    for (let m = 0; m < missing.length; m += 2) q.push({ set, i: missing[m], j: missing[m + 1] });
    for (let j = j0 - 1; j <= j1 + 1; j++) {
      for (let i = i0 - 1; i <= i1 + 1; i++) {
        if (i >= i0 && i <= i1 && j >= j0 && j <= j1) continue;
        if (!set.tiles.has(tileKey(i, j))) q.push({ set, i, j });
      }
    }
    this.queue = q;
    this.scheduleIdle();
    this.evict();
  }
}

const shared = new TerrainRenderer();

/**
 * Подготовить всё тяжёлое заранее (экран загрузки / интро уровня): текстуры темы, геометрию рельефа и (с view)
 * тайлы вида рогатки. Без вызова это делается лениво. Возвращает затраченное время, мс.
 */
export function prewarmTerrain(terrain: TerrainDef[], theme: ThemeId, view?: ViewInfo): number {
  return shared.prewarm(terrain, theme, view);
}

/**
 * Рельеф уровня в мировых координатах. Совпадает с полигонами TerrainDef точно (физика по ним же);
 * обводка центрирована по контуру, травинки и снежные «подушки» выступают наружу на 0.1–0.2 м.
 * frame — необязательная трансформация кадра (поворот от тряски, shakeFrame), та же, что у тел; без неё — экранные пиксели.
 * Кэш привязан к содержимому рельефа: новый массив с тем же рельефом не пересобирается, другой рельеф освобождает прежний.
 */
export function drawTerrain(ctx: CanvasRenderingContext2D, terrain: TerrainDef[], theme: ThemeId, view: ViewInfo, frame?: DOMMatrixReadOnly | null): void {
  shared.draw(ctx, terrain, theme, view, frame);
}

/** Освободить кэш рельефа (смена уровня / выход в меню). */
export function releaseTerrain(): void {
  shared.release();
}

/** Память кэша тайлов рельефа, байт (для общего учёта памяти спрайтов). */
export function terrainMemoryBytes(): number {
  return shared.memoryBytes;
}
