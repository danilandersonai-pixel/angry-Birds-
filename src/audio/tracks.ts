// Музыкальные треки движка: 'menu' — полька; 'level' — «постель» фона темы (ветер и птички луга, прибой и чайки
// пляжа, вьюга снега) и поверх неё тихий луп «Тихая лужайка» в варианте темы (music.ts LEVEL_SONGS): AB2 — у уровня
// своя спокойная музыка, без неё паузы между выстрелами пусты (ревью). Луп на ≈ 7 дБ тише ударов (TRACK_GAIN.level),
// на взрывах приглушается (duck); выключается отдельно — настройка «Музыка в уровнях» (AudioEngine.setLevelMusic).
// Плавный вход/выход для кроссфейда. Живой режим — lookahead-секвенсор с таймерами;
// офлайн-режим (untilS) — всё планируется сразу.

import type { ThemeId } from '../core/types';
import * as M from './music';
import { type NoiseBank, makeTanhCurve } from './noise';
import * as F from './sfx';
import { beginCollect, endCollect } from './synth';

export type TrackId = 'menu' | 'level';

/**
 * Уровень трека на шине music. Полька 0.45 (−5 дБ к прежним 0.8): медиана RMS 100 мс ≈ −25 dBFS на выходе,
 * кнопки меню (≈ −20 dBFS) звучат над ней на ~5 дБ. Луп уровня — на 6–8 дБ под ударами материалов
 * (M max ≈ −28 LUFS против медианы ударов ≈ −21 LUFS, замер scripts/render-audio.mjs) — не маскирует разрушения.
 */
export const TRACK_GAIN: Readonly<Record<TrackId, number>> = { menu: 0.45, level: 0.22 };

/** Тихий музыкальный луп в уровне поверх фона темы (по умолчанию включён; настройка — AudioEngine.setLevelMusic). */
export const LEVEL_MUSIC = true;

export interface TrackHandle {
  readonly id: TrackId;
  readonly theme: ThemeId;
  /** Звучит ли музыка (оркестр и секвенсор); false — только фон темы. */
  readonly music: boolean;
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
  /** Для 'level': играть ли музыкальный луп поверх фона (по умолчанию LEVEL_MUSIC). */
  levelMusic?: boolean;
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

  // Оркестр и секвенсор создаются только там, где музыка звучит: в уровне (без P2-лупа) — ни узлов, ни таймеров.
  const withMusic = id === 'menu' || (opts.levelMusic ?? LEVEL_MUSIC);
  let mg: GainNode | null = null;
  let band: M.Band | null = null;
  let seq: M.Sequencer | null = null;
  if (withMusic) {
    const song = id === 'menu' ? M.SONGS.menu : M.LEVEL_SONGS[theme];
    mg = fadeGain(musicDest, TRACK_GAIN[id]);
    const b = M.createBand(ctx, nb, mg, song.stepS, at);
    band = b;
    const sq = new M.Sequencer(ctx, song, (e, t, st) => {
      M.playEv(b, e, t, st);
    }, timers);
    seq = sq;
    if (opts.untilS !== undefined) {
      sq.reset(at);
      sq.scheduleUntil(at + opts.untilS);
    } else sq.start(at);
  }

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
    music: withMusic,
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
        seq?.stop();
        band?.dispose(ctx.currentTime + 0.05);
        timers.set(() => {
          mg?.disconnect();
          ag?.disconnect();
        }, 300);
      }, f * 1000 + 50);
    },
  };
}
