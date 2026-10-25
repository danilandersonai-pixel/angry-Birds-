// Правила открытия эпизодов в одном месте (01 §12.2): почему эпизод закрыт и что сказать игроку.
// Одна функция причины — для карточки эпизода, тоста, подвала экрана уровней и сообщения на экране победы.
// Чистые функции без DOM (проверяются в Node).

import type { EpisodeDef } from '../core/types';
import { episodeStarsNeeded, type ProgressStore } from '../storage/progress';
import { STARS_ACC, plural, t } from './strings';

export type GateReason = 'none' | 'stars' | 'level' | 'both';

export interface EpisodeGate {
  /** Эпизод открыт (первый открыт всегда). */
  open: boolean;
  /** Почему закрыт: не хватает звёзд в предыдущем эпизоде, не пройден его последний уровень или и то и другое. */
  reason: GateReason;
  /** Предыдущий эпизод (null у первого). */
  prev: EpisodeDef | null;
  /** Номер предыдущего эпизода с 1 (0 у первого). */
  prevNum: number;
  /** Сколько звёзд ещё собрать в предыдущем эпизоде (0 — хватает). */
  missingStars: number;
  /** Последний уровень предыдущего эпизода, если он ещё не пройден. */
  missingLevel: string | null;
}

type ProgressView = Pick<ProgressStore, 'isUnlocked' | 'starsTotal' | 'record'>;

/** Причина блокировки эпизода epIndex (с 0). order — порядок всех уровней кампании. */
export function episodeGate(progress: ProgressView, episodes: readonly EpisodeDef[], order: readonly string[], epIndex: number): EpisodeGate {
  const ep = episodes[epIndex];
  const prev = epIndex > 0 ? (episodes[epIndex - 1] ?? null) : null;
  const first = ep?.levels[0]?.id;
  const open = !!first && progress.isUnlocked(first, order);
  const base: EpisodeGate = { open, reason: 'none', prev, prevNum: prev ? epIndex : 0, missingStars: 0, missingLevel: null };
  if (open || !prev) return base;
  const ids = prev.levels.map((l) => l.id);
  const missingStars = Math.max(0, episodeStarsNeeded(ids.length) - progress.starsTotal(ids));
  const last = ids[ids.length - 1] ?? null;
  const lastCleared = last !== null && (progress.record(last)?.stars ?? 0) > 0;
  // закрыт, но звёзд хватает и последний уровень пройден — значит, не хватает уровня (несогласованный id) — честно просим пройти его
  const missingLevel = !lastCleared || missingStars === 0 ? last : null;
  const reason: GateReason = missingStars > 0 && missingLevel ? 'both' : missingStars > 0 ? 'stars' : 'level';
  return { ...base, reason, missingStars, missingLevel };
}

/** Где показывается текст: карточка эпизода (коротко, ★ — значок), тост и озвучка, подвал уровней, экран победы. */
export type GateForm = 'card' | 'full' | 'footer' | 'win';

/**
 * Текст причины блокировки. В формах 'card' и 'footer' символ ★ — место для значка звезды (см. withStarIcons),
 * в 'full' и 'win' звёзды — словами. name — название закрытого эпизода. Для открытого эпизода — ''
 * (кроме подвала: «Открыт эпизод …»).
 */
export function gateText(g: EpisodeGate, form: GateForm, name: string): string {
  const n = g.missingStars;
  const id = g.missingLevel ?? '';
  const prev = g.prev?.name ?? '';
  if (g.open || g.reason === 'none') return form === 'footer' && g.prev ? t('levelsNextOpen', { name }) : '';
  const stars = plural(n, STARS_ACC);
  switch (form) {
    case 'card':
      return g.reason === 'stars'
        ? t('gateCardStars', { n, prev: g.prevNum })
        : g.reason === 'level'
          ? t('gateCardLevel', { id })
          : t('gateCardBoth', { id, n });
    case 'footer':
      return g.reason === 'stars' ? t('levelsToNextEp', { n }) : g.reason === 'level' ? t('levelsFinishLast', { id }) : t('gateFootBoth', { id, n });
    case 'win':
      return g.reason === 'stars'
        ? t('winLockedNext', { n, stars, name })
        : g.reason === 'level'
          ? t('gateFullLevel', { id, name })
          : t('gateFullBoth', { id, n, stars, prev });
    default:
      return g.reason === 'stars'
        ? t('gateFullStars', { n, stars, prev })
        : g.reason === 'level'
          ? t('gateFullLevel', { id, name })
          : t('gateFullBoth', { id, n, stars, prev });
  }
}
