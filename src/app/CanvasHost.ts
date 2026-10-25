// Холст сцены на весь экран (04 §10.1): CSS-размер × коэффициент холста (dpr с потолком качества и масштабом
// рендера), ресайз, смена dpr, летербокс 16:9 для режима «Играть так» в портрете (UI сообщает через window 'resize').
// Ступени ниже HIGH уменьшают число пикселей холста и на мониторе с dpr 1 (там потолок dpr ничего не даёт): холст
// меньше CSS-размера, браузер растягивает его сам; камера и спрайты считают масштаб от canvas.height.

export type QualityLevel = 'high' | 'med' | 'low';

/** Ступени качества (00 §1.14): потолок dpr. */
export const QUALITY_DPR: Record<QualityLevel, number> = { high: 2, med: 1.5, low: 1 };
/** Масштаб рендера ступени: сторона холста — не больше этой доли стороны холста HIGH (на dpr 1: 0.85 и 0.7). */
export const QUALITY_SCALE: Record<QualityLevel, number> = { high: 1, med: 0.85, low: 0.7 };

/**
 * Пикселей холста на CSS px для ступени q: min(dpr, потолок ступени, масштаб ступени × коэффициент HIGH), не меньше 0.5.
 * dpr 1: 1 / 0.85 / 0.7; dpr 2 и выше: 2 / 1.5 / 1 (как раньше); dpr 1.25: 1.25 / 1.06 / 0.875.
 */
export function backingRatio(devicePixelRatio: number, q: QualityLevel): number {
  const d = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const hi = Math.min(d, QUALITY_DPR.high);
  return Math.max(0.5, Math.min(d, QUALITY_DPR[q], hi * QUALITY_SCALE[q]));
}

export class CanvasHost {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** CSS-размер области сцены. */
  cssW = 1;
  cssH = 1;
  /** Действующий коэффициент холста (пикселей холста на CSS px: devicePixelRatio, ограниченный качеством). */
  dpr = 1;
  private q: QualityLevel = 'high';
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
    if (q === this.q) return;
    this.q = q;
    this.fit(true);
  }

  get quality(): QualityLevel {
    return this.q;
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
    const dpr = backingRatio(window.devicePixelRatio || 1, this.q);
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
