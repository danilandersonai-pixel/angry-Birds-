// Вспомогательные функции для offscreen-холстов.

export type AnyCanvas = HTMLCanvasElement;
export type Ctx2D = CanvasRenderingContext2D;

/** Создать холст заданного размера (в пикселях устройства). */
export function createCanvas(w: number, h: number): AnyCanvas {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Получить 2D-контекст с включённым качественным сглаживанием. */
export function ctx2d(c: AnyCanvas): Ctx2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D не поддерживается');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}
