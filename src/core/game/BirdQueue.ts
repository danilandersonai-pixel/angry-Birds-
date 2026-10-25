// Очередь птиц у рогатки (00 §1.2): x₀ = основание − 1.6, x_{i+1} = x_i − max(1.1, r_i + r_{i+1} + 0.2),
// птицы стоят на земле. При загрузке первая прыгает в кармашек, остальные сдвигаются (00 §1.12).

import { LAUNCH, SLINGSHOT, TIMING } from '../../config/constants';
import type { QueuedBirdView } from '../api';
import { BIRD_DEFS } from '../characters';
import type { BirdType, Vec } from '../types';

function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

export class BirdQueue {
  /** Высота земли по x мест очереди (места повторяются — считаем один раз). */
  private readonly ground = new Map<number, number>();

  constructor(
    private readonly base: Vec,
    private readonly groundAt: (x: number) => number,
  ) {}

  /** Места стоянки птиц (центры) для списка ожидающих. */
  layout(types: readonly BirdType[]): Vec[] {
    const out: Vec[] = [];
    let x = this.base.x - SLINGSHOT.QUEUE_X0;
    for (let i = 0; i < types.length; i++) {
      const r = BIRD_DEFS[types[i]].radius;
      if (i > 0) x -= Math.max(SLINGSHOT.QUEUE_DX, BIRD_DEFS[types[i - 1]].radius + r + LAUNCH.QUEUE_GAP);
      out.push({ x, y: this.groundY(x) + r });
    }
    return out;
  }

  /**
   * Вид очереди. hopT — время с начала загрузки (null — птицы стоят): первая летит по параболе к anchor
   * с пиком +BIRD_HOP_HEIGHT, остальные за QUEUE_SHIFT_TIME переходят на места без неё.
   */
  view(waiting: readonly BirdType[], hopT: number | null, anchor: Vec): QueuedBirdView[] {
    const from = this.layout(waiting);
    if (hopT === null) return waiting.map((type, i) => ({ type, radius: BIRD_DEFS[type].radius, ...from[i] }));
    const to = this.layout(waiting.slice(1));
    const hop = easeInOutSine(Math.min(1, hopT / TIMING.BIRD_HOP_TIME));
    const shift = easeInOutSine(Math.min(1, hopT / TIMING.QUEUE_SHIFT_TIME));
    return waiting.map((type, i) => {
      const radius = BIRD_DEFS[type].radius;
      const a = from[i];
      if (i === 0) {
        return {
          type, radius,
          x: a.x + (anchor.x - a.x) * hop,
          y: a.y + (anchor.y - a.y) * hop + 4 * TIMING.BIRD_HOP_HEIGHT * hop * (1 - hop),
        };
      }
      const b = to[i - 1];
      return { type, radius, x: a.x + (b.x - a.x) * shift, y: a.y + (b.y - a.y) * shift };
    });
  }

  private groundY(x: number): number {
    let y = this.ground.get(x);
    if (y === undefined) {
      y = this.groundAt(x);
      if (Number.isNaN(y)) y = this.base.y;
      this.ground.set(x, y);
    }
    return y;
  }
}
