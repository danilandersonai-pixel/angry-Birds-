// Музыкальные треки движка: 'menu' — полька, 'level' — тихий эмбиент + «постель» фона темы
// (ветер и птички луга, прибой и чайки пляжа, вьюга снега). Плавный вход/выход для кроссфейда.
// Живой режим — lookahead-секвенсор с таймерами; офлайн-режим (untilS) — всё планируется сразу.

import type { ThemeId } from '../core/types';
import * as M from './music';
import { type NoiseBank, makeTanhCurve } from './noise';
import * as F from './sfx';
import { beginCollect, endCollect } from './synth';

export type TrackId = 'menu' | 'level';

/** Уровень трека на шине music: эмбиент уровня тише польки (не маскирует разрушения). */
export const TRACK_GAIN: Readonly<Record<TrackId, number>> = { menu: 1, level: 0.6 };

export interface TrackHandle {
  readonly id: TrackId;
  readonly theme: ThemeId;
  /** Плавно погасить за fadeS и освободить узлы. */
  stop(fadeS: number): void;
}

export interface TrackOpts {
  /** Время старта (ctx.currentTime). */
  at: number;
  /** Длительность плавного входа, с. */
  fadeIn: number;
  /** Офлайн: сколько секунд запланировать сразу (без таймеров). */
  untilS?: number;
  timers?: M.Timers;
  rnd?: () => number;
}

const realTimers: M.Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Запустить трек: музыка → musicDest, фон темы (только 'level') → ambDest. */
export function startTrack(
  ctx: BaseAudioContext,
  nb: NoiseBank,
  musicDest: AudioNode,
  ambDest: AudioNode,
  id: TrackId,
  theme: ThemeId,
  opts: TrackOpts,
): TrackHandle {
  const timers = opts.timers ?? realTimers;
  const rnd = opts.rnd ?? Math.random;
  const at = opts.at;
  const fadeGain = (dest: AudioNode, level: number): GainNode => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + Math.max(0.01, opts.fadeIn));
    g.connect(dest);
    return g;
  };

  const song = M.SONGS[id];
  const mg = fadeGain(musicDest, TRACK_GAIN[id]);
  const band = M.createBand(ctx, nb, mg, song.stepS, at);
  const seq = new M.Sequencer(ctx, song, (e, t, st) => {
    M.playEv(band, e, t, st);
  }, timers);
  if (opts.untilS !== undefined) {
    seq.reset(at);
    seq.scheduleUntil(at + opts.untilS);
  } else seq.start(at);

  // Фон темы уровня: одна длинная «постель» + редкие события (трели, чайки).
  let ag: GainNode | null = null;
  let bed: AudioScheduledSourceNode[] = [];
  let ambTimer: unknown = null;
  if (id === 'level') {
    const agg = fadeGain(ambDest, 1);
    ag = agg;
    const s: F.S = { ctx, out: agg, nb, rnd, tanh: makeTanhCurve(3) };
    beginCollect();
    try {
      F.ambienceBed(s, at, theme, opts.untilS ?? 3600);
    } finally {
      bed = endCollect();
    }
    const gap = F.AMB_EVENT_GAP[theme];
    if (gap) {
      if (opts.untilS !== undefined) {
        for (let k = at + 1 + rnd() * 2; k < at + opts.untilS - 1; k += gap[0] + rnd() * (gap[1] - gap[0])) F.ambienceEvent(s, k, theme);
      } else {
        let next = at + 1.5 + rnd() * gap[0];
        const poll = (): void => {
          const now = ctx.currentTime;
          if (now >= next) {
            next = now + gap[0] + rnd() * (gap[1] - gap[0]);
            F.ambienceEvent(s, now + 0.05, theme);
          }
          ambTimer = timers.set(poll, 500);
        };
        ambTimer = timers.set(poll, 500);
      }
    }
  }

  let stopped = false;
  return {
    id,
    theme,
    stop(fadeS: number): void {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      const f = Math.max(0.02, fadeS);
      for (const g of [mg, ag]) {
        if (!g) continue;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + f);
      }
      if (ambTimer !== null) timers.clear(ambTimer);
      for (const s of bed) {
        try {
          s.stop(now + f + 0.05);
        } catch {
          /* уже остановлен */
        }
      }
      // Секвенсор играет до конца фейда (иначе кроссфейд оборвётся), потом всё освобождаем.
      timers.set(() => {
        seq.stop();
        band.dispose(ctx.currentTime + 0.05);
        timers.set(() => {
          mg.disconnect();
          ag?.disconnect();
        }, 300);
      }, f * 1000 + 50);
    },
  };
}
