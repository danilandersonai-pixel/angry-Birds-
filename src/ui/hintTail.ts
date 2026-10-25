// Хвостик облачка подсказки (07 §10.3; плейтест №2, Б9): тянется к точке на экране (например, к рогатке с птицей).
// Без точки хвостика нет: облачко висит сверху по центру, и хвост «под говорящей птицей» указывал в пустое небо.
// Геометрия — чистая функция (проверяется в Node), рисование — inline SVG поверх нижней кромки облачка.

export interface TailBox {
  /** Облачко (border-box) в CSS px окна. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Толщина рамки и радиус скругления, px. */
  border: number;
  radius: number;
  /** Единица вёрстки u, px. */
  u: number;
}

export interface TailGeom {
  /** Основание хвоста на нижней кромке, x в координатах облачка (от левого края border-box). */
  baseX: number;
  /** Полуширина основания, px. */
  half: number;
  /** Кончик в координатах облачка. */
  tipX: number;
  tipY: number;
}

/** Наклон хвоста от вертикали не больше этого, рад (иначе он ложится вдоль кромки). */
const MAX_TILT = (55 * Math.PI) / 180;

/**
 * Хвост к точке (tx, ty) в CSS px окна. null — точка не ниже облачка (вверх и вбок хвост не рисуем) или
 * облачко слишком узкое. Основание — на прямом участке нижней кромки, как можно ближе к точке по X;
 * кончик — на 26u ниже кромки (не дальше самой точки), наклон к точке — не больше 55°.
 */
export function tailGeometry(b: TailBox, tx: number, ty: number): TailGeom | null {
  if (![b.left, b.top, b.width, b.height, b.u, tx, ty].every(Number.isFinite) || b.width <= 0 || b.height <= 0) return null;
  const u = Math.max(0.3, b.u);
  const half = Math.max(7, 13 * u);
  const lo = Math.max(0, b.radius) + half;
  const hi = b.width - Math.max(0, b.radius) - half;
  if (hi < lo) return null;
  const lx = tx - b.left;
  const dy = ty - (b.top + b.height);
  if (dy < 12 * u) return null;
  const baseX = Math.min(hi, Math.max(lo, lx));
  const len = Math.min(26 * u, dy - 4 * u);
  const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, Math.atan2(lx - baseX, dy)));
  return { baseX, half, tipX: baseX + len * Math.tan(tilt), tipY: b.height + len };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Нарисовать хвост в облачке box (position: relative) к точке at (CSS px окна). false — хвост не нужен. */
export function hintTail(box: HTMLElement, at: { x: number; y: number }): boolean {
  box.querySelector(':scope > .hint-tail')?.remove();
  const cs = getComputedStyle(box);
  const r = box.getBoundingClientRect();
  const u = parseFloat(cs.getPropertyValue('--u')) || 1;
  const bw = parseFloat(cs.borderBottomWidth) || 0;
  const g = tailGeometry({ left: r.left, top: r.top, width: r.width, height: r.height, border: bw, radius: parseFloat(cs.borderBottomLeftRadius) || 0, u }, at.x, at.y);
  if (!g) return false;
  // стороны хвоста — прямые от кончика через точки основания на внешней кромке рамки (y = height); обводка начинается
  // на внутренней кромке рамки (сливается с ней), заливка — чуть выше, по тем же прямым (закрывает рамку и светлую
  // внутреннюю линию между сторонами, не вылезая за обводку)
  const xAt = (px: number, y: number): number => g.tipX + ((px - g.tipX) * (y - g.tipY)) / (r.height - g.tipY);
  const yEdge = r.height - bw;
  const yFill = r.height - bw - Math.max(2, 3 * u);
  const L = g.baseX - g.half;
  const R = g.baseX + g.half;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'hint-tail');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(Math.ceil(r.width)));
  svg.setAttribute('height', String(Math.ceil(g.tipY + bw)));
  const f = (x: number, y: number): string => `${x.toFixed(1)},${y.toFixed(1)}`;
  const fill = document.createElementNS(SVG_NS, 'polygon');
  fill.setAttribute('class', 'hint-tail-fill');
  fill.setAttribute('points', [f(xAt(L, yFill), yFill), f(g.tipX, g.tipY), f(xAt(R, yFill), yFill)].join(' '));
  const edge = document.createElementNS(SVG_NS, 'polyline');
  edge.setAttribute('class', 'hint-tail-edge');
  edge.setAttribute('points', [f(xAt(L, yEdge), yEdge), f(g.tipX, g.tipY), f(xAt(R, yEdge), yEdge)].join(' '));
  edge.setAttribute('stroke-width', bw.toFixed(1));
  svg.append(fill, edge);
  box.append(svg);
  return true;
}
