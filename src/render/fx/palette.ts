// Цвета и размеры для эффектов. Источники: 04-visual.md §7.2 (материалы), 02-characters.md §6 (птицы),
// 01-gameplay.md §9.3 (всплывающие очки).

import type { BirdType, Material } from '../../core/types';

export interface MaterialFx {
  light: string;
  base: string;
  dark: string;
  outline: string;
  /** Цвет пыли при разрушении. */
  dust: string;
  /** Цвет волокон (дерево) / крапин (камень). */
  detail: string;
}

export const MATERIAL_FX: Record<Material, MaterialFx> = {
  wood: { light: '#F0C27A', base: '#D08F45', dark: '#9C6030', outline: '#4A2810', dust: '#E2C595', detail: '#A9672E' },
  ice: { light: '#E6FAFF', base: '#A8E2F8', dark: '#6CC0E8', outline: '#246A9E', dust: '#EAF8FF', detail: '#3F9BD0' },
  stone: { light: '#CDD1D6', base: '#A3A9B0', dark: '#767D86', outline: '#30353C', dust: '#C9C5BE', detail: '#5B626B' },
};

export interface BirdFx {
  base: string;
  light: string;
  dark: string;
  outline: string;
  /** Второй цвет перьев (хвост/хохолок) — четверть перьев. */
  accent: string;
  /** Физический радиус, м (02-characters.md §1). */
  radius: number;
  /** Цвет всплывающих очков бонуса и их обводка. */
  score: string;
  scoreStroke: string;
}

export const BIRD_FX: Record<BirdType, BirdFx> = {
  red: { base: '#D7262E', light: '#F35B4F', dark: '#9C121C', outline: '#3A0B0E', accent: '#2A2324', radius: 0.45, score: '#E0302A', scoreStroke: '#2A0608' },
  blues: { base: '#5DB9EA', light: '#A3E0FB', dark: '#2C82BE', outline: '#123A57', accent: '#1F2A33', radius: 0.252, score: '#4BA7E8', scoreStroke: '#0E2E47' },
  chuck: { base: '#F9D23C', light: '#FFF08A', dark: '#D9A514', outline: '#6B4A05', accent: '#252525', radius: 0.495, score: '#FFD21F', scoreStroke: '#4A3304' },
  bomb: { base: '#303136', light: '#62666F', dark: '#131315', outline: '#050506', accent: '#3B3B3E', radius: 0.585, score: '#3A3A3A', scoreStroke: '#FFFFFF' },
  matilda: { base: '#F7F4EC', light: '#FFFFFF', dark: '#CFC8B8', outline: '#6E665A', accent: '#E9E3D6', radius: 0.54, score: '#F4F4F4', scoreStroke: '#4A443A' },
  hal: { base: '#6CBF3D', light: '#A7E06F', dark: '#3F8C22', outline: '#1D4410', accent: '#1E2A14', radius: 0.4725, score: '#46A83A', scoreStroke: '#13300B' },
  terence: { base: '#A5181F', light: '#CF3B39', dark: '#6A0A10', outline: '#2E0507', accent: '#231C1C', radius: 0.8, score: '#B81E22', scoreStroke: '#2A0507' },
  silver: { base: '#BCC5CE', light: '#EEF2F6', dark: '#7C8894', outline: '#39424C', accent: '#8E99A5', radius: 0.45, score: '#C9D2DB', scoreStroke: '#2B3239' },
};

export const BIRD_TYPES: readonly BirdType[] = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];

/** Всплывающие очки: заливка и обводка. */
export interface ScoreStyle {
  fill: string;
  stroke: string;
  /** Высота шрифта в мире, м. */
  sizeM: number;
}

export const SCORE_PIG: ScoreStyle = { fill: '#8BD62E', stroke: '#1E4A0B', sizeM: 0.9 };
export const SCORE_BLOCK_PLAIN: ScoreStyle = { fill: '#FFFFFF', stroke: '#3A3A3A', sizeM: 0.6 };
export const SCORE_TNT: ScoreStyle = { fill: '#FF9A3C', stroke: '#5A1A08', sizeM: 0.7 };
export const SCORE_BONUS_PLAIN: ScoreStyle = { fill: '#FFE04A', stroke: '#5A3A00', sizeM: 1.0 };
export const SCORE_MATERIAL: Record<Material, ScoreStyle> = {
  wood: { fill: '#F2A541', stroke: '#5A2E0C', sizeM: 0.6 },
  ice: { fill: '#9FE3FF', stroke: '#1D4E6B', sizeM: 0.6 },
  stone: { fill: '#D7D7D7', stroke: '#3A3A3A', sizeM: 0.6 },
};

/** Пыль от удара о землю (нейтральный тёплый грунт; тема рельефа Fx не известна). */
export const GROUND_DUST = '#CDB78F';
/** Пыль удара яйца Матильды (цвет скорлупы). */
export const EGG_DUST = '#FFFDF5';

/** Клуб дыма: верх, середина, низ вертикального градиента и блик. */
export interface SmokeTone {
  readonly top: string;
  readonly mid: string;
  readonly bottom: string;
  readonly hi: string;
}

/**
 * Дым взрывов (ревью «дым тёмный и плотный»): светлые клубы AB2, середина #CFCFCF…#E8E8E8 — разрушение под дымом
 * остаётся видно. base — основание облака, warm — переход огненного шара в дым, light — верх, white — яйцо Матильды.
 */
export const SMOKE: Readonly<Record<'base' | 'warm' | 'light' | 'white', SmokeTone>> = {
  base: { top: '#E5E3E2', mid: '#D1CFCF', bottom: '#AAA7A7', hi: '#FFFFFF' },
  warm: { top: '#F1EDE9', mid: '#DAD4CF', bottom: '#B4ADA8', hi: '#FFFFFF' },
  light: { top: '#FFFFFF', mid: '#E8E8E8', bottom: '#C6C6CA', hi: '#FFFFFF' },
  white: { top: '#FFFFFF', mid: '#F8F6F0', bottom: '#DAD5CA', hi: '#FFFFFF' },
};
/** Наибольшая непрозрачность клуба дыма. */
export const SMOKE_ALPHA_MAX = 0.55;
/** Зелёный «пуф» свиньи (04-visual.md §8.4). */
export const PIG_PUFF = { outline: '#2F6A1A', body: '#6EC03A', hi: '#A6E46A', white: '#F3FFE9' } as const;
/** Белый «пуф» птицы. */
export const BIRD_PUFF = { outline: '#BCCBD9', body: '#F4F8FB', hi: '#FFFFFF', white: '#FFFFFF' } as const;
/** Металл каски свиньи. */
export const HELMET_FX = { light: '#D5DCE3', base: '#9AA4AE', dark: '#6B7580', outline: '#2F363D' } as const;
/** Скорлупа яйца Матильды. */
export const EGG_FX = { light: '#FFFFFF', base: '#FFFDF5', dark: '#E6DCC6', outline: '#8C8170' } as const;
/** Табличка TNT. */
export const TNT_FX = { light: '#F0584E', base: '#D9342B', dark: '#A8231C', outline: '#4A0E08' } as const;
