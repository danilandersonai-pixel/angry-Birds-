// Холст сцены на весь экран (04 §10.1): CSS-размер × dpr (с потолком качества), ресайз, смена dpr,
// летербокс 16:9 для режима «Играть так» в портрете (UI сообщает через window 'resize').

export type QualityLevel = 'high' | 'med' | 'low';

/** Ступени качества (00 §1.14): потолок dpr. */
export const QUALITY_DPR: Record<QualityLevel, number> = { high: 2, med: 1.5, low: 1 };

export class CanvasHost {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** CSS-размер области сцены. */
  cssW = 1;
  cssH = 1;
  /** Действующий dpr (devicePixelRatio, ограниченный качеством). */
  dpr = 1;
  private maxDpr = 2;
  private letterbox = false;
  private readonly listeners = new Set<() => void>();
  private mql: MediaQueryList | null = null;

  constructor(parent: HTMLElement) {
    const c = document.createElement('canvas');
    c.id = 'game';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', 'Игровое поле');
    parent.prepend(c);
    this.canvas = c;
    const ctx = c.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D не поддерживается');
    this.ctx = ctx;
    window.addEventListener('resize', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(this.onResize).observe(parent);
    this.watchDpr();
    this.fit(true);
  }

  /** Подписка на смену размера холста. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setQuality(q: QualityLevel): void {
    const m = QUALITY_DPR[q];
    if (m === this.maxDpr) return;
    this.maxDpr = m;
    this.fit(true);
  }

  get quality(): QualityLevel {
    return this.maxDpr >= 2 ? 'high' : this.maxDpr >= 1.5 ? 'med' : 'low';
  }

  /** Летербокс 16:9 по ширине (портрет, «Играть так»). */
  setLetterbox(on: boolean): void {
    if (on === this.letterbox) return;
    this.letterbox = on;
    this.fit(true);
  }

  /** Подогнать размер холста; true — размер изменился. */
  fit(force = false): boolean {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const w = vw;
    const h = this.letterbox ? Math.min(vh, Math.round((vw * 9) / 16)) : vh;
    const dpr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.maxDpr));
    const st = this.canvas.style;
    st.width = `${w}px`;
    st.height = `${h}px`;
    st.top = this.letterbox ? `${Math.round((vh - h) / 2)}px` : '0px';
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    const changed = force || bw !== this.canvas.width || bh !== this.canvas.height || w !== this.cssW || h !== this.cssH;
    this.cssW = w;
    this.cssH = h;
    this.dpr = bw / w;
    if (bw !== this.canvas.width || bh !== this.canvas.height) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    if (changed) for (const fn of this.listeners) fn();
    return changed;
  }

  private readonly onResize = (): void => {
    this.fit();
  };

  /** dpr меняется при переносе окна на другой монитор и при зуме страницы. */
  private watchDpr(): void {
    if (typeof matchMedia !== 'function') return;
    this.mql?.removeEventListener?.('change', this.onDpr);
    this.mql = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.mql.addEventListener?.('change', this.onDpr);
  }

  private readonly onDpr = (): void => {
    this.watchDpr();
    this.fit();
  };
}
