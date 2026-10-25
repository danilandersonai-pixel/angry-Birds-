// Таймлайн окна победы (07 §12.3, ревью «арт и ощущения»): счёт крутится от нуля, а каждая заработанная звезда
// прилетает в тот момент, когда бегущее число пересекает её порог (как в Angry Birds) — звёзды не выдают итог заранее.
// Пустые слоты видны сразу; незаработанные «вздрагивают», когда счёт остановился. Чистые функции — без DOM.

import type { StarThresholds } from '../core/types';

/** Тайминги, с (t = 0 — начало выезда панели). */
export interface WinTiming {
  /** Начало подсчёта: панель уже выехала (0.42 с). */
  rollAt: number;
  /** Длительность подсчёта 0 → итог. */
  roll: number;
  /** Полёт звезды начинается раньше касания слота. */
  starLead: number;
  /** Не чаще: «бумы» соседних звёзд не сливаются. */
  starMinGap: number;
  /** Первая звезда — не раньше, чем число побежало. */
  firstStarAfter: number;
  /** Кнопки pop-in (неактивны). */
  buttonsAt: number;
  /** Кнопки активны через столько после последней заработанной звезды. */
  enableAfterStar: number;
  /** Шаг «вздрагивания» незаработанных звёзд после остановки счёта. */
  emptyGap: number;
}

export const WIN_T: Readonly<{ full: WinTiming; reduced: WinTiming }> = {
  full: { rollAt: 0.5, roll: 1.2, starLead: 0.19, starMinGap: 0.35, firstStarAfter: 0.12, buttonsAt: 0.3, enableAfterStar: 0.3, emptyGap: 0.12 },
  reduced: { rollAt: 0.2, roll: 0.6, starLead: 0, starMinGap: 0.2, firstStarAfter: 0.05, buttonsAt: 0.15, enableAfterStar: 0.15, emptyGap: 0.08 },
};

/** Доля подсчёта для звезды без порога (порог неизвестен или выше счёта — данные разошлись). */
const FALLBACK_K = [0.1, 0.5, 0.9] as const;

/** Бегущее число при доле k: easeOutQuad — почти ровный бег с мягким концом. */
export function rollValue(score: number, k: number): number {
  const q = Math.min(1, Math.max(0, k));
  return Math.round(score * (1 - (1 - q) ** 2));
}

/** Доля подсчёта, при которой бегущее число впервые достигает th (обратная к rollValue). */
export function rollCross(score: number, th: number): number {
  if (!(score > 0) || !(th > 0)) return 0;
  const f = th / score;
  return f >= 1 ? 1 : 1 - Math.sqrt(1 - f);
}

export interface WinPlan {
  rollStart: number;
  rollEnd: number;
  /** Касание слота заработанной звездой i (длина = числу звёзд). */
  land: number[];
  /** «Вздрагивание» незаработанной звезды: empty[j] — для слота stars + j. */
  empty: number[];
  /** Кнопки активны. */
  enableAt: number;
  /** Подсчёт закончен и последняя звезда села: бейдж «Новый рекорд!». */
  end: number;
}

/** Расписание окна победы: score — итог, stars — заработано (истина), th — пороги уровня (только для моментов). */
export function planWin(score: number, stars: number, th: StarThresholds | undefined, T: WinTiming): WinPlan {
  const n = Math.max(0, Math.min(3, Math.round(stars)));
  const s = Math.max(0, score);
  const thr = th ? [th.one, th.two, th.three] : [];
  const rollStart = T.rollAt;
  const rollEnd = T.rollAt + T.roll;
  const land: number[] = [];
  let prev = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = thr[i];
    const k = typeof t === 'number' && Number.isFinite(t) && t <= s ? rollCross(s, t) : FALLBACK_K[i]!;
    const at = Math.max(rollStart + T.firstStarAfter, rollStart + k * T.roll, prev + T.starMinGap);
    land.push(at);
    prev = at;
  }
  const empty = Array.from({ length: 3 - n }, (_, j) => rollEnd + j * T.emptyGap);
  const last = n > 0 ? prev : rollEnd;
  return { rollStart, rollEnd, land, empty, enableAt: last + T.enableAfterStar, end: Math.max(rollEnd, last) };
}
