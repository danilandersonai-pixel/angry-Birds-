// Схематичный предпросмотр уровней для дизайнеров (без ядра и спрайтов игры).
//   dev/preview-level.html?id=1-3 — один уровень: небо, рельеф, блоки по материалам, свиньи с типом, TNT, рогатка
//     (основание и ANCHOR), очередь птиц, огибающие досягаемости (Red — пунктир), сетка 1 м с подписями каждые 5 м,
//     результаты lint справа (клик — подсветка на схеме). Колесо — зум, перетаскивание — сдвиг, двойной клик / F — вписать.
//   dev/preview-level.html — сетка мини-превью всех уровней со статусом lint.
//   &env=all — огибающие всех птиц уровня (по умолчанию: Red + остальные птицы уровня тонко); &env=red — только Red.
//   &marks=0 — без маркеров проблем lint.

import type { BirdType, LevelDef, PigType, TerrainDef, ThemeId, Vec } from '../core/types';
import { SLINGSHOT } from '../config/constants';
import { EPISODES, findLevel } from '../levels';
import { lintLevel, queuePositions, reachCurve, type LintIssue, type LintResult } from '../levels/lint';
import { PIG_R, blockPolygon, slingBase, tntAsBlock } from '../levels/prefabs';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app') as HTMLDivElement;
const DPR = window.devicePixelRatio || 1;

// ───────────────────────── палитра ─────────────────────────

const SKY: Record<ThemeId, [string, string]> = {
  meadow: ['#2F8FE0', '#C4EAF8'],
  beach: ['#2B2868', '#FFD27C'],
  snow: ['#2766BE', '#EAF4FB'],
};
const GROUND: Record<ThemeId, { fill: string; top: string }> = {
  meadow: { fill: '#8A6A43', top: '#5FB53A' },
  beach: { fill: '#D9B26F', top: '#F0D48F' },
  snow: { fill: '#9AA9B8', top: '#F4F8FC' },
};
const TERRAIN_FILL: Record<TerrainDef['kind'], string | null> = { ground: null, rock: '#7E848C', platform: '#8E5F35' };
const MAT_STYLE: Record<string, { fill: string; stroke: string }> = {
  wood: { fill: '#D99A4E', stroke: '#5A2E0C' },
  ice: { fill: 'rgba(159,227,255,0.82)', stroke: '#1D4E6B' },
  stone: { fill: '#B9BBBE', stroke: '#3A3A3A' },
};
const BIRD_COLOR: Record<BirdType, string> = {
  red: '#D62B1E',
  blues: '#4AA8E8',
  chuck: '#F5D130',
  bomb: '#2B2B2B',
  matilda: '#F4F4F4',
  hal: '#3DAA4B',
  terence: '#8E1B1B',
  silver: '#C8CCD4',
};
const BIRD_RU: Record<BirdType, string> = {
  red: 'Ред', blues: 'Синие', chuck: 'Чак', bomb: 'Бомб', matilda: 'Матильда', hal: 'Хэл', terence: 'Теренс', silver: 'Сильвер',
};
const PIG_LABEL: Record<PigType, string> = { small: 'мал', medium: 'сред', large: 'бол', helmet: 'каска', mustache: 'усы', king: 'король' };
const BIRD_RADIUS: Record<BirdType, number> = { red: 0.45, blues: 0.252, chuck: 0.495, bomb: 0.585, matilda: 0.54, hal: 0.4725, terence: 0.8, silver: 0.45 };

// ───────────────────────── вид ─────────────────────────

interface View {
  /** Мировая точка в левом нижнем углу и масштаб (css px на метр). */
  x0: number;
  y0: number;
  k: number;
  w: number;
  h: number;
}
const sx = (v: View, x: number): number => (x - v.x0) * v.k;
const sy = (v: View, y: number): number => v.h - (y - v.y0) * v.k;
const wx = (v: View, px: number): number => v.x0 + px / v.k;
const wy = (v: View, py: number): number => v.y0 + (v.h - py) / v.k;

function contentBox(lv: LevelDef): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = lv.slingshot.x - 6;
  let maxX = lv.slingshot.x + 20;
  let minY = -1;
  let maxY = lv.slingshot.y + 1;
  const grow = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const b of lv.blocks) {
    const r = b.shape === 'circle' ? b.w / 2 : Math.hypot(b.w, b.h) / 2;
    grow(b.x - r, b.y - r);
    grow(b.x + r, b.y + r);
  }
  for (const p of lv.pigs) {
    grow(p.x - PIG_R[p.type], p.y - PIG_R[p.type]);
    grow(p.x + PIG_R[p.type], p.y + PIG_R[p.type]);
  }
  for (const t of lv.tnt ?? []) grow(t.x, t.y + 1);
  return { minX, maxX, minY, maxY };
}

function fitView(lv: LevelDef, w: number, h: number, mode: 'bounds' | 'content'): View {
  let x0: number;
  let x1: number;
  let y0: number;
  let y1: number;
  if (mode === 'bounds') {
    x0 = lv.bounds.minX;
    x1 = lv.bounds.maxX;
    y0 = Math.min(-2, ...(lv.terrain.flatMap((t) => t.points.map((p) => p[1])).filter((y) => y > -8)));
    y1 = Math.max(lv.bounds.maxY, contentBox(lv).maxY + 2);
  } else {
    const c = contentBox(lv);
    x0 = c.minX - 2;
    x1 = c.maxX + 2;
    y0 = c.minY - 1.5;
    y1 = c.maxY + 3;
  }
  const k = Math.min(w / (x1 - x0), h / (y1 - y0));
  // лишнее место: по горизонтали — поровну, по вертикали — сверху (земля у нижнего края)
  return { x0: (x0 + x1) / 2 - w / k / 2, y0, k, w, h };
}

// ───────────────────────── отрисовка ─────────────────────────

interface DrawOpts {
  grid: boolean;
  labels: boolean;
  envelopes: 'none' | 'red' | 'level' | 'all';
  issues: LintIssue[];
  highlight?: LintIssue | null;
}

function pathPoly(ctx: CanvasRenderingContext2D, v: View, pts: readonly Vec[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(sx(v, p.x), sy(v, p.y)) : ctx.moveTo(sx(v, p.x), sy(v, p.y))));
  ctx.closePath();
}

function drawLevel(ctx: CanvasRenderingContext2D, lv: LevelDef, v: View, o: DrawOpts): void {
  const { w, h } = v;
  // небо
  const sky = SKY[lv.theme] ?? SKY.meadow;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, sky[0]);
  g.addColorStop(1, sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // зона вне bounds — затемнение
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  const bx0 = sx(v, lv.bounds.minX);
  const bx1 = sx(v, lv.bounds.maxX);
  const byTop = sy(v, lv.bounds.maxY);
  if (bx0 > 0) ctx.fillRect(0, 0, bx0, h);
  if (bx1 < w) ctx.fillRect(bx1, 0, w - bx1, h);
  if (byTop > 0) ctx.fillRect(Math.max(0, bx0), 0, Math.min(w, bx1) - Math.max(0, bx0), byTop);

  // сетка 1 м, подписи каждые 5 м
  if (o.grid) {
    const gx0 = Math.floor(wx(v, 0));
    const gx1 = Math.ceil(wx(v, w));
    const gy0 = Math.floor(wy(v, h));
    const gy1 = Math.ceil(wy(v, 0));
    const fine = v.k >= 6;
    ctx.lineWidth = 1;
    for (let x = gx0; x <= gx1; x++) {
      if (!fine && x % 5) continue;
      ctx.strokeStyle = x % 5 ? 'rgba(255,255,255,0.13)' : x === 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.32)';
      ctx.beginPath();
      ctx.moveTo(Math.round(sx(v, x)) + 0.5, 0);
      ctx.lineTo(Math.round(sx(v, x)) + 0.5, h);
      ctx.stroke();
    }
    for (let y = gy0; y <= gy1; y++) {
      if (!fine && y % 5) continue;
      ctx.strokeStyle = y % 5 ? 'rgba(255,255,255,0.13)' : y === 0 ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.32)';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(sy(v, y)) + 0.5);
      ctx.lineTo(w, Math.round(sy(v, y)) + 0.5);
      ctx.stroke();
    }
  }

  // рельеф
  const gr = GROUND[lv.theme] ?? GROUND.meadow;
  for (const t of lv.terrain) {
    const pts = t.points.map(([x, y]) => ({ x, y }));
    pathPoly(ctx, v, pts);
    ctx.fillStyle = TERRAIN_FILL[t.kind] ?? gr.fill;
    ctx.fill();
    ctx.lineWidth = Math.max(1, 0.06 * v.k);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
    // верхние (обращённые вверх) рёбра земли — травой/песком/снегом
    if (t.kind === 'ground') {
      const ccw = signedArea(pts) > 0;
      ctx.lineWidth = Math.max(2, 0.18 * v.k);
      ctx.strokeStyle = gr.top;
      ctx.lineCap = 'round';
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const nx = ccw ? b.y - a.y : a.y - b.y;
        const ny = ccw ? a.x - b.x : b.x - a.x;
        const l = Math.hypot(nx, ny) || 1;
        if (ny / l < 0.35) continue; // внешняя нормаль должна смотреть вверх
        ctx.beginPath();
        ctx.moveTo(sx(v, a.x), sy(v, a.y));
        ctx.lineTo(sx(v, b.x), sy(v, b.y));
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  }

  // огибающие досягаемости
  if (o.envelopes !== 'none') {
    const birds: BirdType[] =
      o.envelopes === 'red' ? ['red'] : o.envelopes === 'all' ? (Object.keys(BIRD_COLOR) as BirdType[]) : ['red', ...new Set(lv.birds.filter((b) => b !== 'red'))];
    for (const b of birds) {
      const pts = reachCurve(b, lv.slingshot, lv.slingshot.x, lv.bounds.maxX, 0.25);
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(sx(v, p.x), sy(v, p.y)) : ctx.moveTo(sx(v, p.x), sy(v, p.y))));
      ctx.setLineDash(b === 'red' ? [8, 6] : [3, 5]);
      ctx.lineWidth = b === 'red' ? 2 : 1.5;
      ctx.strokeStyle = b === 'matilda' || b === 'silver' ? '#7a7f88' : BIRD_COLOR[b];
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // зона целей 16…34 м — полоска у земли
  const base = slingBase(lv.slingshot);
  if (o.labels) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(sx(v, base.x + 16), sy(v, 0) + 2, (34 - 16) * v.k, 4);
  }

  const hiTarget = o.highlight?.target;
  const isHi = (kind: string, i: number): boolean => !!hiTarget && hiTarget.kind === kind && hiTarget.index === i;

  // блоки
  lv.blocks.forEach((b, i) => {
    const st = MAT_STYLE[b.material] ?? MAT_STYLE.wood;
    ctx.fillStyle = st.fill;
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = Math.max(1, 0.05 * v.k);
    if (b.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(sx(v, b.x), sy(v, b.y), (b.w / 2) * v.k, 0, Math.PI * 2);
    } else pathPoly(ctx, v, blockPolygon(b) as Vec[]);
    ctx.fill();
    ctx.stroke();
    if (b.material === 'stone' && v.k > 12) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fill();
    }
    if (isHi('block', i)) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ff2d55';
      ctx.stroke();
    }
  });

  // TNT
  (lv.tnt ?? []).forEach((t, i) => {
    const b = tntAsBlock(t);
    pathPoly(ctx, v, blockPolygon(b) as Vec[]);
    ctx.fillStyle = '#D8342C';
    ctx.fill();
    ctx.lineWidth = isHi('tnt', i) ? 3 : Math.max(1, 0.05 * v.k);
    ctx.strokeStyle = isHi('tnt', i) ? '#ff2d55' : '#5A0E0A';
    ctx.stroke();
    if (v.k > 9) {
      ctx.fillStyle = '#FFE7A8';
      ctx.font = `700 ${Math.max(8, 0.34 * v.k)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('TNT', sx(v, t.x), sy(v, t.y));
    }
  });

  // свиньи
  lv.pigs.forEach((p, i) => {
    const r = PIG_R[p.type];
    ctx.beginPath();
    ctx.arc(sx(v, p.x), sy(v, p.y), r * v.k, 0, Math.PI * 2);
    ctx.fillStyle = '#8BD62E';
    ctx.fill();
    ctx.lineWidth = isHi('pig', i) ? 3 : Math.max(1, 0.06 * v.k);
    ctx.strokeStyle = isHi('pig', i) ? '#ff2d55' : '#1E4A0B';
    if (p.fragile) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (p.type === 'helmet' || p.type === 'king') {
      ctx.beginPath();
      ctx.arc(sx(v, p.x), sy(v, p.y), r * v.k, Math.PI * 1.12, Math.PI * 1.88);
      ctx.lineWidth = Math.max(2, 0.16 * v.k);
      ctx.strokeStyle = p.type === 'king' ? '#F2C230' : '#9A9FA6';
      ctx.stroke();
    }
    if (v.k > 9) {
      ctx.fillStyle = '#123008';
      ctx.font = `700 ${Math.max(8, Math.min(14, 0.36 * v.k))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PIG_LABEL[p.type] + (p.fragile ? '!' : ''), sx(v, p.x), sy(v, p.y));
    }
  });

  // рогатка: основание, ствол, рога, ANCHOR
  const A = lv.slingshot;
  ctx.strokeStyle = '#4A2A12';
  ctx.lineWidth = Math.max(2, 0.22 * v.k);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx(v, base.x), sy(v, base.y));
  ctx.lineTo(sx(v, base.x), sy(v, base.y + 1.9));
  ctx.lineTo(sx(v, base.x + SLINGSHOT.PRONG_BACK.x), sy(v, base.y + SLINGSHOT.PRONG_BACK.y));
  ctx.moveTo(sx(v, base.x), sy(v, base.y + 1.9));
  ctx.lineTo(sx(v, base.x + SLINGSHOT.PRONG_FRONT.x), sy(v, base.y + SLINGSHOT.PRONG_FRONT.y));
  ctx.stroke();
  ctx.lineCap = 'butt';
  // основание — треугольник
  ctx.fillStyle = '#FFE14D';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sx(v, base.x), sy(v, base.y));
  ctx.lineTo(sx(v, base.x) - 6, sy(v, base.y) + 9);
  ctx.lineTo(sx(v, base.x) + 6, sy(v, base.y) + 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // птицы: первая — в кармашке (ANCHOR), остальные — в очереди
  const drawBird = (b: BirdType, x: number, y: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(sx(v, x), sy(v, y), Math.max(2.5, r * v.k), 0, Math.PI * 2);
    ctx.fillStyle = BIRD_COLOR[b];
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#111';
    ctx.stroke();
  };
  if (lv.birds.length) drawBird(lv.birds[0], A.x, A.y, BIRD_RADIUS[lv.birds[0]]);
  for (const q of queuePositions({ ...lv, birds: lv.birds.slice(1) })) drawBird(q.bird, q.x, q.y, q.r);
  // ANCHOR — крестик
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  const ax = sx(v, A.x);
  const ay = sy(v, A.y);
  ctx.beginPath();
  ctx.moveTo(ax - 7, ay);
  ctx.lineTo(ax + 7, ay);
  ctx.moveTo(ax, ay - 7);
  ctx.lineTo(ax, ay + 7);
  ctx.stroke();

  // маркеры lint
  o.issues.forEach((is, n) => {
    if (!is.at) return;
    const x = sx(v, is.at.x);
    const y = sy(v, is.at.y);
    const hi = o.highlight === is;
    ctx.beginPath();
    ctx.arc(x, y, hi ? 13 : 9, 0, Math.PI * 2);
    ctx.lineWidth = hi ? 3 : 2;
    ctx.strokeStyle = is.severity === 'error' ? '#ff3b30' : '#ffb020';
    ctx.stroke();
    if (o.labels) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(n + 1), x + 9, y - 6);
    }
  });

  // подписи осей каждые 5 м
  if (o.labels) {
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let x = Math.ceil(wx(v, 0) / 5) * 5; x <= wx(v, w); x += 5) {
      ctx.strokeText(String(x), sx(v, x), h - 3);
      ctx.fillText(String(x), sx(v, x), h - 3);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(wy(v, h) / 5) * 5; y <= wy(v, 0); y += 5) {
      ctx.strokeText(String(y), 4, sy(v, y));
      ctx.fillText(String(y), 4, sy(v, y));
    }
  }
}

function signedArea(pts: readonly Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

// ───────────────────────── HTML ─────────────────────────

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function badge(r: LintResult): string {
  if (r.errors.length) return `<span class="badge err">✖ ${r.errors.length}</span>${r.warnings.length ? ` <span class="badge warn">⚠ ${r.warnings.length}</span>` : ''}`;
  if (r.warnings.length) return `<span class="badge warn">⚠ ${r.warnings.length}</span>`;
  return '<span class="badge ok">✔ lint</span>';
}

function birdsHtml(birds: readonly BirdType[]): string {
  return birds
    .map((b) => `<span title="${BIRD_RU[b]}" style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${BIRD_COLOR[b]};border:1px solid #000;margin-right:2px;vertical-align:-1px"></span>`)
    .join('');
}

function sizeCanvas(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const r = c.getBoundingClientRect();
  const w = Math.max(50, Math.floor(r.width));
  const h = Math.max(50, Math.floor(r.height));
  c.width = Math.round(w * DPR);
  c.height = Math.round(h * DPR);
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  return { ctx, w, h };
}

function showAll(): void {
  document.title = 'Уровни — все';
  const parts: string[] = ['<div class="all"><h1>Уровни кампании</h1>'];
  const pending: Array<{ id: string; lv: LevelDef; r: LintResult }> = [];
  for (const ep of EPISODES) {
    parts.push(`<h2>Эпизод ${ep.id} «${esc(ep.name)}» <span class="k" style="color:#9aa8b8">(${ep.theme}, уровней: ${ep.levels.length})</span></h2>`);
    if (!ep.levels.length) {
      parts.push('<div class="empty">уровней пока нет</div>');
      continue;
    }
    parts.push('<div class="cards">');
    for (const lv of ep.levels) {
      const r = lintLevel(lv);
      pending.push({ id: lv.id, lv, r });
      parts.push(
        `<a class="card" href="?id=${encodeURIComponent(lv.id)}"><canvas data-id="${esc(lv.id)}"></canvas>` +
          `<div class="cap"><span><b>${esc(lv.id)}</b> ${esc(lv.name)} ${birdsHtml(lv.birds)}</span><span>${badge(r)}</span></div></a>`,
      );
    }
    parts.push('</div>');
  }
  parts.push('</div>');
  app.innerHTML = parts.join('');
  for (const { id, lv, r } of pending) {
    const c = app.querySelector(`canvas[data-id="${CSS.escape(id)}"]`) as HTMLCanvasElement;
    const { ctx, w, h } = sizeCanvas(c);
    drawLevel(ctx, lv, fitView(lv, w, h, 'content'), { grid: false, labels: false, envelopes: 'red', issues: r.issues.filter((i) => i.severity === 'error') });
  }
}

function showOne(lv: LevelDef): void {
  document.body.classList.add('single');
  document.title = `${lv.id} «${lv.name}» — предпросмотр`;
  const r = lintLevel(lv);
  const envParam = params.get('env');
  const envelopes: DrawOpts['envelopes'] = envParam === 'all' ? 'all' : envParam === 'red' ? 'red' : envParam === 'none' ? 'none' : 'level';
  const marks = params.get('marks') !== '0';
  const meta = lv.meta ?? {};
  const pigCount = new Map<string, number>();
  for (const p of lv.pigs) pigCount.set(p.type, (pigCount.get(p.type) ?? 0) + 1);
  const birdsLevel = ['red', ...new Set(lv.birds.filter((b) => b !== 'red'))] as BirdType[];
  app.innerHTML = `
    <div class="single-wrap">
      <header>
        <h1>${esc(lv.id)} «${esc(lv.name)}»</h1>
        <span><span class="k">тема</span> ${lv.theme}</span>
        <span><span class="k">птицы</span> ${birdsHtml(lv.birds)} ${lv.birds.map((b) => BIRD_RU[b]).join(', ')}</span>
        <span><span class="k">свиньи</span> ${[...pigCount].map(([t, n]) => `${t}×${n}`).join(', ')}</span>
        <span><span class="k">блоков</span> ${lv.blocks.length}${lv.tnt?.length ? ` + TNT ${lv.tnt.length}` : ''} · <span class="k">тел</span> ${r.stats.dynamicBodies}</span>
        <span><span class="k">★</span> ${lv.stars.two.toLocaleString('ru-RU')} / ${lv.stars.three.toLocaleString('ru-RU')}</span>
        ${meta.difficulty !== undefined ? `<span><span class="k">d</span> ${meta.difficulty}</span>` : ''}
        ${meta.nMin !== undefined ? `<span><span class="k">nMin</span> ${meta.nMin}</span>` : ''}
        ${badge(r)}
        <a href="?">← все уровни</a>
      </header>
      <div class="stage"><canvas id="cv"></canvas></div>
      <aside>
        ${lv.hint ? `<div style="margin:4px 0 8px"><span class="k" style="color:#9aa8b8">подсказка:</span> ${esc(lv.hint)}</div>` : ''}
        ${meta.teach ? `<div style="margin:4px 0 8px"><span class="k" style="color:#9aa8b8">учит:</span> ${esc(meta.teach)}</div>` : ''}
        <h2>Lint: ошибок ${r.errors.length}, предупреждений ${r.warnings.length}</h2>
        <div id="issues">${
          r.issues.length
            ? r.issues
                .map((is, n) => `<div class="issue ${is.severity}" data-n="${n}"><b>${n + 1}.</b> ${esc(is.message)}<div class="code">${is.severity === 'error' ? 'ошибка' : 'предупреждение'} · ${is.code}</div></div>`)
                .join('')
            : '<div class="issue" style="border-left:3px solid #6fdc6a">замечаний нет</div>'
        }</div>
        <h2>Досягаемость свиней</h2>
        <div>${r.stats.reach
          .map((q) => {
            const p = lv.pigs[q.index];
            return `<div>#${q.index} ${p.type} (${p.x}; ${p.y}): центр — ${q.center.length ? q.center.map((b) => BIRD_RU[b]).join(', ') : '<span style="color:#ffb84d">никто</span>'}${q.touch.length > q.center.length ? `; задеть — ${q.touch.filter((b) => !q.center.includes(b)).map((b) => BIRD_RU[b]).join(', ')}` : ''}</div>`;
          })
          .join('')}</div>
        <h2>Легенда</h2>
        <div class="legend">
          <div><span class="sw" style="background:${MAT_STYLE.wood.fill}"></span> дерево <span class="sw" style="background:${MAT_STYLE.ice.fill}"></span> лёд <span class="sw" style="background:${MAT_STYLE.stone.fill}"></span> камень <span class="sw" style="background:#D8342C"></span> TNT</div>
          <div><span class="sw" style="background:#8BD62E;border-radius:50%"></span> свинья (пунктир и «!» — fragile)</div>
          ${birdsLevel.map((b) => `<div><span class="line" style="border-color:${b === 'matilda' || b === 'silver' ? '#7a7f88' : BIRD_COLOR[b]}"></span> огибающая: ${BIRD_RU[b]}</div>`).join('')}
          <div>▲ основание рогатки, ✚ ANCHOR (slingshot); светлая полоса у земли — зона целей 16…34 м</div>
          <div>колесо — зум, перетаскивание — сдвиг, двойной клик / F — вписать, C — к сооружению</div>
        </div>
      </aside>
      <div class="status" id="status">—</div>
    </div>`;

  const cv = document.getElementById('cv') as HTMLCanvasElement;
  const status = document.getElementById('status') as HTMLDivElement;
  let view: View | null = null;
  let highlight: LintIssue | null = null;
  let mode: 'bounds' | 'content' = params.get('fit') === 'content' ? 'content' : 'bounds';

  const redraw = (): void => {
    const { ctx, w, h } = sizeCanvas(cv);
    if (!view || view.w !== w || view.h !== h) view = view ? { ...view, w, h } : fitView(lv, w, h, mode);
    drawLevel(ctx, lv, view, { grid: true, labels: true, envelopes, issues: marks ? r.issues : [], highlight });
  };
  const refit = (m: 'bounds' | 'content'): void => {
    mode = m;
    const rc = cv.getBoundingClientRect();
    view = fitView(lv, Math.floor(rc.width), Math.floor(rc.height), mode);
    redraw();
  };
  window.addEventListener('resize', () => {
    view = null;
    redraw();
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!view) return;
    const rc = cv.getBoundingClientRect();
    const px = e.clientX - rc.left;
    const py = e.clientY - rc.top;
    const mx = wx(view, px);
    const my = wy(view, py);
    const k = Math.max(2, Math.min(400, view.k * Math.exp(-e.deltaY * 0.0015)));
    view = { ...view, k, x0: mx - px / k, y0: my - (view.h - py) / k };
    redraw();
  }, { passive: false });
  let drag: { x: number; y: number; x0: number; y0: number } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    if (!view) return;
    drag = { x: e.clientX, y: e.clientY, x0: view.x0, y0: view.y0 };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointerup', () => (drag = null));
  cv.addEventListener('pointermove', (e) => {
    if (!view) return;
    const rc = cv.getBoundingClientRect();
    if (drag) {
      view = { ...view, x0: drag.x0 - (e.clientX - drag.x) / view.k, y0: drag.y0 + (e.clientY - drag.y) / view.k };
      redraw();
    }
    const x = wx(view, e.clientX - rc.left);
    const y = wy(view, e.clientY - rc.top);
    status.textContent = `x = ${x.toFixed(2)}  y = ${y.toFixed(2)}  ·  ${describeAt(lv, x, y)}`;
  });
  cv.addEventListener('dblclick', () => refit(mode));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') refit('bounds');
    if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') refit('content');
  });
  (document.getElementById('issues') as HTMLDivElement).addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('.issue') as HTMLElement | null;
    if (!el || el.dataset.n === undefined) return;
    const is = r.issues[Number(el.dataset.n)];
    highlight = highlight === is ? null : is;
    redraw();
  });
  redraw();
}

/** Что под курсором: блок / свинья / TNT. */
function describeAt(lv: LevelDef, x: number, y: number): string {
  for (let i = lv.pigs.length - 1; i >= 0; i--) {
    const p = lv.pigs[i];
    if (Math.hypot(p.x - x, p.y - y) <= PIG_R[p.type]) return `свинья #${i} ${JSON.stringify(p)}`;
  }
  const tnt = lv.tnt ?? [];
  for (let i = tnt.length - 1; i >= 0; i--) {
    const pts = blockPolygon(tntAsBlock(tnt[i])) as Vec[];
    if (inside(pts, x, y)) return `TNT #${i} ${JSON.stringify(tnt[i])}`;
  }
  for (let i = lv.blocks.length - 1; i >= 0; i--) {
    const b = lv.blocks[i];
    const hit = b.shape === 'circle' ? Math.hypot(b.x - x, b.y - y) <= b.w / 2 : inside(blockPolygon(b) as Vec[], x, y);
    if (hit) return `блок #${i} ${JSON.stringify(b)}`;
  }
  return '';
}

function inside(pts: readonly Vec[], x: number, y: number): boolean {
  let r = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) r = !r;
  }
  return r;
}

// ───────────────────────── вход ─────────────────────────

const id = params.get('id');
if (id) {
  const lv = findLevel(id);
  if (lv) showOne(lv);
  else app.innerHTML = `<div class="all"><h1>Уровень «${esc(id)}» не найден</h1><a href="?">← все уровни</a></div>`;
} else showAll();
