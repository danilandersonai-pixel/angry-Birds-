// Ирис-шторка (07 §5.3): тёмный экран с круглой «дыркой», которая сжимается к точке нажатия
// и раскрывается от рогатки. При reduced motion — простой фейд. Пока шторка видна, ввод блокирован.

import { ease, motion } from './anim';

const NS = 'http://www.w3.org/2000/svg';

export class Iris {
  private readonly svg: SVGSVGElement;
  private readonly hole: SVGCircleElement;
  private readonly ring: SVGCircleElement;
  private raf = 0;
  private token = 0;
  /** true — экран полностью закрыт шторкой. */
  closed = false;
  /** true — идёт анимация или шторка закрыта (ввод заблокирован). */
  active = false;

  constructor(parent: HTMLElement, color = '#0B1A2B') {
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'abui-iris');
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('data-testid', 'iris');
    this.svg.innerHTML =
      `<defs><mask id="abui-iris-m" maskUnits="userSpaceOnUse"><rect x="-10" y="-10" width="200%" height="200%" fill="#fff"/></mask></defs>` +
      `<rect x="-10" y="-10" width="200%" height="200%" fill="${color}" mask="url(#abui-iris-m)"/>`;
    this.hole = document.createElementNS(NS, 'circle');
    this.hole.setAttribute('fill', '#000');
    this.svg.querySelector('mask')!.appendChild(this.hole);
    this.ring = document.createElementNS(NS, 'circle');
    this.ring.setAttribute('fill', 'none');
    this.ring.setAttribute('stroke', '#000');
    this.ring.setAttribute('stroke-opacity', '0.35');
    this.svg.appendChild(this.ring);
    Object.assign(this.svg.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '60',
      display: 'none',
      pointerEvents: 'auto',
      overflow: 'visible',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.svg);
  }

  /** Закрыть к точке (координаты окна). */
  close(x: number, y: number, durMs = 450): Promise<void> {
    return this.run('close', x, y, durMs);
  }

  /** Раскрыть от точки. */
  open(x: number, y: number, durMs = 500): Promise<void> {
    if (!this.closed && !this.active) return Promise.resolve();
    return this.run('open', x, y, durMs);
  }

  /** Быстрый фейд (рестарт): закрыть. */
  fadeClose(durMs = 150): Promise<void> {
    return this.fade('close', durMs);
  }

  fadeOpen(durMs = 200): Promise<void> {
    if (!this.closed && !this.active) return Promise.resolve();
    return this.fade('open', durMs);
  }

  /** Координаты окна → координаты корня UI (учитывает масштаб корня в летербоксе). */
  private local(x: number, y: number): { x: number; y: number; w: number; h: number } {
    const p = this.svg.parentElement!;
    const r = p.getBoundingClientRect();
    const w = p.clientWidth || r.width;
    const h = p.clientHeight || r.height;
    const k = r.width > 0 && w > 0 ? r.width / w : 1;
    return { x: (x - r.left) / k, y: (y - r.top) / k, w, h };
  }

  private run(kind: 'close' | 'open', gx: number, gy: number, durMs: number): Promise<void> {
    if (motion.reduced) return this.fade(kind, 150);
    const tok = ++this.token;
    cancelAnimationFrame(this.raf);
    this.svg.getAnimations().forEach((a) => a.cancel());
    this.svg.style.opacity = '1';
    const { x, y, w, h } = this.local(gx, gy);
    const rMax = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 12;
    const u = parseFloat(getComputedStyle(this.svg).getPropertyValue('--u')) || 1;
    this.svg.style.display = 'block';
    this.active = true;
    for (const c of [this.hole, this.ring]) {
      c.setAttribute('cx', String(x));
      c.setAttribute('cy', String(y));
    }
    this.ring.setAttribute('stroke-width', String(10 * u));
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number): void => {
        if (tok !== this.token) return resolve();
        const k = Math.min(1, (now - t0) / durMs);
        const r = kind === 'close' ? rMax * (1 - ease.inCubic(k)) : rMax * ease.outCubic(k);
        this.hole.setAttribute('r', String(Math.max(0, r)));
        this.ring.setAttribute('r', String(Math.max(0, r - 5 * u)));
        if (k < 1) {
          this.raf = requestAnimationFrame(step);
          return;
        }
        if (kind === 'open') {
          this.svg.style.display = 'none';
          this.active = false;
          this.closed = false;
        } else {
          this.closed = true;
        }
        resolve();
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  private fade(kind: 'close' | 'open', durMs: number): Promise<void> {
    const tok = ++this.token;
    cancelAnimationFrame(this.raf);
    this.hole.setAttribute('r', '0');
    this.ring.setAttribute('r', '0');
    this.svg.style.display = 'block';
    this.active = true;
    const from = kind === 'close' ? (this.closed ? 1 : 0) : 1;
    const to = kind === 'close' ? 1 : 0;
    this.svg.getAnimations().forEach((a) => a.cancel());
    this.svg.style.opacity = String(to);
    const a = this.svg.animate?.([{ opacity: from }, { opacity: to }], { duration: durMs, easing: 'linear' });
    const finish = (): void => {
      if (tok !== this.token) return;
      if (kind === 'open') {
        this.svg.style.display = 'none';
        this.svg.style.opacity = '1';
        this.active = false;
        this.closed = false;
      } else {
        this.closed = true;
      }
    };
    if (!a) {
      finish();
      return Promise.resolve();
    }
    return a.finished.then(finish, finish);
  }

  /** Мгновенно убрать шторку. */
  reset(): void {
    ++this.token;
    cancelAnimationFrame(this.raf);
    this.svg.style.display = 'none';
    this.svg.style.opacity = '1';
    this.active = false;
    this.closed = false;
  }
}
