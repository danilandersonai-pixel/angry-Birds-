// Пороги звёзд (06 §8, 00 §1.11): черновая формула 06 §8.2 по очкам уровня, ограниченная результатом
// эксперта (06 §8.3: эксперт всегда может взять 3★); 2★ не ниже «все свиньи + 2000».
// С отчётом устойчивости (sim/robust.ts: линия эксперта с «мелким» шумом исполнения) пороги берутся по ней:
// 2★ — медиана счёта, 3★ — 80-й перцентиль (поражение — 0), а не один точный прогон: точная линия бывала
// хрупкой (3–37 % побед), и 3★ на 10 000 за птицу требовала победы, которая выходит у эксперта раз из трёх.

import { MATERIALS, PIGS, SCORE } from '../../config/constants';
import { shapeArea } from '../physics/geometry';
import type { LevelDef, StarThresholds } from '../index';
import type { RobustReport } from './robust';
import type { SolveResult } from './solver';

/** Максимум очков уровня без бонуса птиц: P — свиньи (5000 + полный урон), B — блоки (500 + полный урон) и TNT. */
export interface LevelPoints {
  pigs: number;
  blocks: number;
}

export interface StarSuggestion {
  stars: StarThresholds;
  /** Сколько птиц заложено в формулу: meta.nMin, иначе птиц эксперта, иначе все. */
  nMin: number;
  points: LevelPoints;
  /** 3★ срезана до счёта эксперта. */
  capped: boolean;
  /** Пороги взяты по устойчивой линии (медиана / 80-й перцентиль под шумом). */
  robust: boolean;
  /** Замечания калибровки (06 §8.3) по-русски. */
  warnings: string[];
}

/** Диапазон порога 3★ по эпизодам (06 §8.3). */
const THREE_RANGE: Record<string, [number, number]> = { '1': [25_000, 60_000], '2': [35_000, 80_000], '3': [45_000, 110_000] };
/** На сколько пороги могут отличаться от заданных без объяснения (06 §8.3: регрессия при правке уровня). */
const DRIFT = 0.15;

const r1k = (x: number) => Math.round(x / 1000) * 1000;
const f1k = (x: number) => Math.floor(x / 1000) * 1000;

export function levelPoints(level: LevelDef): LevelPoints {
  const pigs = level.pigs.reduce((s, p) => s + SCORE.PIG + PIGS[p.type].damagePoints, 0);
  const blocks =
    level.blocks.reduce((s, b) => s + SCORE.BLOCK + MATERIALS[b.material].damagePointsPerM2 * shapeArea(b.shape, b.w, b.h), 0) +
    (level.tnt?.length ?? 0) * SCORE.TNT;
  return { pigs, blocks };
}

/**
 * Предложенные пороги: формула 06 §8.2, затем 3★ ≤ floor1k(счёт эксперта) и 2★ ≤ 3★ − 5000. С robust — по устойчивой
 * линии: 3★ = floor1k(80-й перцентиль), 2★ = floor1k(медианы), но не ближе 5000 к 3★ и не ниже «все свиньи + 2000».
 * Если побед под шумом меньше половины — квантили по победным прогонам (и предупреждение).
 */
export function suggestStars(
  level: LevelDef,
  solve?: Pick<SolveResult, 'solved' | 'score' | 'birdsUsed'> | null,
  robust?: Pick<RobustReport, 'winRate' | 'scores' | 'won' | 'median' | 'p80' | 'birdsUsed'> | null,
): StarSuggestion {
  const points = levelPoints(level);
  const P = points.pigs;
  const B = points.blocks;
  const N = level.birds.length;
  const expert = solve?.solved ? solve : null;
  const nMin = Math.min(N, level.meta?.nMin ?? expert?.birdsUsed ?? N);
  const floorTwo = r1k(P + 2000);
  let three = r1k(P + 0.45 * B + 10_000 * (N - nMin));
  let two = Math.max(Math.min(r1k(P + 0.3 * B + 10_000 * Math.max(0, N - nMin - 1)), three - 5000), floorTwo);
  let capped = false;
  const warnings: string[] = [];

  if (robust && robust.scores.length > 0 && robust.won.some(Boolean)) {
    let med = robust.median;
    let hi80 = robust.p80;
    if (robust.winRate < 0.5) {
      const wins = robust.scores.filter((_, i) => robust.won[i]).sort((a, b) => a - b);
      med = wins[Math.floor(0.5 * wins.length)];
      hi80 = wins[Math.min(wins.length - 1, Math.floor(0.8 * wins.length))];
      warnings.push(`под шумом побед ${Math.round(robust.winRate * 100)} % (< 50 %): пороги по победным прогонам`);
    }
    three = f1k(hi80);
    two = Math.max(Math.min(f1k(med), three - 5000), floorTwo);
    two = Math.min(two, three);
    if (two < floorTwo || three - two < 5000) warnings.push('узкий диапазон очков: добавьте разрушаемых блоков или птицу');
    const range = THREE_RANGE[level.id.split('-')[0]];
    if (range && (three < range[0] || three > range[1])) warnings.push(`3★ = ${three} вне ориентира эпизода ${range[0]}–${range[1]}`);
    if (expert && level.meta?.nMin !== undefined && expert.birdsUsed !== level.meta.nMin) {
      warnings.push(`устойчивой линии нужно ${expert.birdsUsed} птиц при nMin ${level.meta.nMin}`);
    }
    return { stars: { one: 0, two, three }, nMin: expert?.birdsUsed ?? nMin, points, capped: false, robust: true, warnings };
  }

  if (expert) {
    const hi = f1k(expert.score);
    if (three > hi) {
      three = hi;
      two = Math.min(two, three - 5000);
      capped = true;
    }
    if (level.meta?.nMin !== undefined && expert.birdsUsed > level.meta.nMin) {
      warnings.push(`замысел не сходится: эксперту нужно ${expert.birdsUsed} птиц при nMin ${level.meta.nMin}`);
    } else if (level.meta?.nMin !== undefined && expert.birdsUsed < level.meta.nMin) {
      warnings.push(`эксперту хватило ${expert.birdsUsed} птиц при nMin ${level.meta.nMin}: уровень проще замысла или nMin завышен`);
    }
  } else {
    warnings.push('эксперт не прошёл уровень — пороги только по формуле');
  }
  // пол 2★ (P + 2000) может поднять её выше 3★ − 5000 и даже выше 3★ — пороги не должны меняться местами
  two = Math.min(two, three);
  if (two < floorTwo || three - two < 5000) warnings.push('узкий диапазон очков: добавьте разрушаемых блоков или птицу');
  const range = THREE_RANGE[level.id.split('-')[0]];
  if (range && (three < range[0] || three > range[1])) {
    warnings.push(`3★ = ${three} вне ориентира эпизода ${range[0]}–${range[1]}`);
  }
  const cur = level.stars;
  if (cur.three > 0 && Math.abs(three - cur.three) > DRIFT * cur.three) {
    warnings.push(`3★ отличается от заданной (${cur.three}) больше чем на ${DRIFT * 100} %`);
  }
  if (cur.two > 0 && Math.abs(two - cur.two) > DRIFT * cur.two) {
    warnings.push(`2★ отличается от заданной (${cur.two}) больше чем на ${DRIFT * 100} %`);
  }
  return { stars: { one: 0, two, three }, nMin, points, capped, robust: false, warnings };
}
