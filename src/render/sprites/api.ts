// Контракт спрайтов: все «художественные» модули рисуют в offscreen-холсты и возвращают Sprite.
// Рендер кэширует спрайты (SpriteCache) и рисует их drawImage с масштабом и поворотом.

import type { AnyCanvas } from '../canvas';

/**
 * Готовый спрайт.
 * canvas — изображение; ppu — пикселей холста на 1 метр мира;
 * (ox, oy) — пиксель холста, совпадающий с центром сущности (центр физического тела).
 * Изображение ориентировано «как на экране»: ось Y холста вниз, персонажи смотрят вправо (+X).
 */
export interface Sprite {
  readonly canvas: AnyCanvas;
  readonly ox: number;
  readonly oy: number;
  readonly ppu: number;
}
