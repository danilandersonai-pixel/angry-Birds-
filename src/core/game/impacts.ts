// Фильтр событий impact (00 §1.7): только заметные удары (vn ≥ 1.5 м/с, J ≥ 0.5 Н·с), самые сильные за шаг,
// не чаще раза в 80 мс для одной пары тел.

import { IMPACT_EVENT } from '../../config/constants';
import type { GameEvent, ImpactSurface } from '../events';
import type { Ent, Hit } from '../physics/entities';

function surfaceOf(e: Ent): ImpactSurface {
  switch (e.kind) {
    case 'block':
      return e.material;
    case 'terrain':
      return 'ground';
    default:
      return e.kind;
  }
}

/** √(w·h) блока-участника удара (для высоты звука). */
function blockSize(h: Hit): number | undefined {
  const blk = h.a.kind === 'block' ? h.a : h.b.kind === 'block' ? h.b : null;
  return blk ? Math.sqrt(blk.w * blk.h) : undefined;
}

export class ImpactFilter {
  private readonly pending: Hit[] = [];
  private readonly pairTime = new Map<string, number>();
  private lastPrune = 0;

  add(h: Hit): void {
    if (h.J >= IMPACT_EVENT.J_MIN && h.vn >= IMPACT_EVENT.VN_MIN) this.pending.push(h);
  }

  /** События impact накопленных за шаг ударов. */
  flush(now: number, emit: (e: GameEvent) => void): void {
    if (this.pending.length > 0) {
      this.pending.sort((p, q) => q.J - p.J);
      let sent = 0;
      for (const h of this.pending) {
        if (sent >= IMPACT_EVENT.MAX_PER_STEP) break;
        const key = h.a.id < h.b.id ? `${h.a.id}:${h.b.id}` : `${h.b.id}:${h.a.id}`;
        const last = this.pairTime.get(key);
        if (last !== undefined && now - last < IMPACT_EVENT.PAIR_COOLDOWN - 1e-9) continue;
        this.pairTime.set(key, now);
        const size = blockSize(h);
        emit({ type: 'impact', x: h.x, y: h.y, impulse: h.J, a: surfaceOf(h.a), b: surfaceOf(h.b), ...(size !== undefined && { size }) });
        sent++;
      }
      this.pending.length = 0;
    }
    if (now - this.lastPrune >= 1) {
      this.lastPrune = now;
      for (const [key, t] of this.pairTime) if (now - t >= IMPACT_EVENT.PAIR_COOLDOWN) this.pairTime.delete(key);
    }
  }
}
