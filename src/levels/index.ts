// Кампания: 3 эпизода × 10 уровней (00-summary §4, 06-levels.md §10).
// Названия эпизодов — по 00-summary §2 п. 34 (строки UI 07 §18 и палитры 04): в 06 они назывались
// «Зелёная долина / Свинский пляж / Ледяной перевал», сводка заменила их на имена ниже.

import type { EpisodeDef, LevelDef } from '../core/types';
import { EPISODE1_LEVELS } from './episode1';
import { EPISODE2_LEVELS } from './episode2';
import { EPISODE3_LEVELS } from './episode3';

export const EPISODES: EpisodeDef[] = [
  { id: '1', name: 'Зелёные холмы', theme: 'meadow', levels: EPISODE1_LEVELS },
  { id: '2', name: 'Пляжный закат', theme: 'beach', levels: EPISODE2_LEVELS },
  { id: '3', name: 'Снежные вершины', theme: 'snow', levels: EPISODE3_LEVELS },
];

/** Все уровни в порядке кампании. */
export const ALL_LEVELS: LevelDef[] = EPISODES.flatMap((e) => e.levels);

/** Уровень по id («1-3»). */
export function findLevel(id: string): LevelDef | undefined {
  return ALL_LEVELS.find((l) => l.id === id);
}

/** Эпизод, которому принадлежит уровень. */
export function findEpisode(levelId: string): EpisodeDef | undefined {
  return EPISODES.find((e) => e.levels.some((l) => l.id === levelId));
}

/** Следующий уровень кампании (после последнего в эпизоде — первый следующего эпизода); null — дальше нет. */
export function nextLevelId(id: string): string | null {
  const i = ALL_LEVELS.findIndex((l) => l.id === id);
  if (i < 0 || i + 1 >= ALL_LEVELS.length) return null;
  return ALL_LEVELS[i + 1].id;
}

export { EPISODE1_LEVELS, EPISODE2_LEVELS, EPISODE3_LEVELS };
