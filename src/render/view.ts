// Параметры вида, которые рендер передаёт всем, кто рисует в мире (фон, рельеф, эффекты).

export interface ViewInfo {
  /** Размер холста в пикселях устройства. */
  readonly screenW: number;
  readonly screenH: number;
  /** Центр камеры в мире, м. */
  readonly camX: number;
  readonly camY: number;
  /** Пикселей устройства на 1 метр (с учётом зума и devicePixelRatio). */
  readonly scale: number;
  /** devicePixelRatio, использованный при расчёте scale. */
  readonly dpr: number;
  /** Время с начала сцены, с (для анимаций фона). */
  readonly time: number;
}

/** Мир (м, Y вверх) → экран (пиксели устройства, Y вниз). */
export function worldToScreenX(v: ViewInfo, x: number): number {
  return (x - v.camX) * v.scale + v.screenW / 2;
}

export function worldToScreenY(v: ViewInfo, y: number): number {
  return v.screenH / 2 - (y - v.camY) * v.scale;
}

/** Экран → мир. */
export function screenToWorldX(v: ViewInfo, sx: number): number {
  return (sx - v.screenW / 2) / v.scale + v.camX;
}

export function screenToWorldY(v: ViewInfo, sy: number): number {
  return (v.screenH / 2 - sy) / v.scale + v.camY;
}

/**
 * Установить на контексте трансформацию «мир → экран»: после вызова можно рисовать в метрах
 * с осью Y вверх. Для спрайтов и текста внутри этой трансформации нужен обратный флип по Y.
 */
export function applyWorldTransform(ctx: CanvasRenderingContext2D, v: ViewInfo): void {
  ctx.setTransform(v.scale, 0, 0, -v.scale, v.screenW / 2 - v.camX * v.scale, v.screenH / 2 + v.camY * v.scale);
}
