// Палитры тем (04 §4, структура — 04 §4.4): одна запись ThemePalette на тему — небо, фон, рельеф, передний план, UI.
// Отклонения от таблиц 04 §4 — по ревью читаемости (контраст свиней и эффектов с фоном на высоте сооружений):
//  • meadow: листва деревьев, вал и холмы сдвинуты в сине-зелёный (ΔE76 с телом свиньи #84C13A ≥ 30 на высоте
//    сооружений; деревья — дымка 0.36), желто-зелёный остаётся игровому плану (кромка травы, свиньи);
//  • snow: ближние планы L* 76–88 с голубизной, чистый белый — только шапки и блики;
//  • beach: грунт под кромкой темнее, дюны светлее и розовее (контраст заливок ≥ 2:1);
//  • передний план темнее кромки земли (04 §1.3: «средняя, темнее земли»).

import type { ThemeId } from '../../core/types';

export interface RangePal {
  light: string;
  fill: string;
  shade: string;
  snow?: string;
  snowShade?: string;
}

export interface HillPal {
  top: string;
  bottom: string;
  rim: string;
  shade: string;
  deco: string;
  decoLight: string;
}

export interface TreePal {
  kind: 'round' | 'palm' | 'pine';
  trunk: string;
  trunkDark: string;
  leaf: string;
  leafLight: string;
  leafDark: string;
  rim?: string;
  snow?: string;
  snowShade?: string;
  berm: string;
  bermLight: string;
  bermDark: string;
  flowers?: string[];
  /** Дымка слоя деревьев (доля цвета fog). */
  haze: number;
}

export interface GroundPalette {
  edge: 'grass' | 'sand' | 'snow';
  top: string;
  light: string;
  dark: string;
  lip: string;
  soil: string;
  soilDark: string;
  soilDeep: string;
  pebble: string;
  pebbleDark: string;
  outline: string;
}

export interface RockPalette {
  light: string;
  fill: string;
  dark: string;
  outline: string;
  /** Шапка по верхним рёбрам: мох (трава) или снег. */
  cap: 'moss' | 'snow' | null;
}

export interface DeckPalette {
  light: string;
  base: string;
  dark: string;
  seam: string;
  outline: string;
  metal: string;
  metalLight: string;
  metalDark: string;
}

export interface ThemePalette {
  /** Для UI (карточки эпизодов). */
  name: string;
  accent: string;
  sky: Array<[number, string]>;
  sun: { x: number; y: number; r: number; core: string; glow: string; glowA: number; onHorizon?: boolean };
  cloud: { top: string; bottom: string; shade: string; alpha: number };
  fog: string;
  mountains: RangePal;
  mountainsBack?: RangePal;
  sea?: { top: string; mid: string; bottom: string; sparkle: string; line: string };
  islands?: { light: string; fill: string; shade: string; palm: string };
  hillsFar?: HillPal;
  rangeFar?: RangePal;
  hillsNear: HillPal;
  /** Дымка у подножия ближних холмов (доля fog). */
  hillsNearFog: number;
  trees: TreePal;
  /** Передний план: a — тёмные травинки, b — средние, c — освещённые кончики; accent — цветы; shadow — тень у основания. */
  fg: { a: string; b: string; c: string; accent: string[]; shadow: string; bush: [string, string, string] };
  snowfall?: boolean;
  ground: GroundPalette;
  rock: RockPalette;
  deck: DeckPalette;
  moss: { top: string; dark: string; light: string };
}

export const THEME_PALETTES: Record<ThemeId, ThemePalette> = {
  meadow: {
    name: 'Зелёные холмы',
    accent: '#66BF4B',
    sky: [
      [0, '#3C9BE6'],
      [0.55, '#8CCFF4'],
      [1, '#DDF3F7'],
    ],
    sun: { x: 0.8, y: 0.15, r: 0.055, core: '#FFFBE6', glow: '#FFF1B0', glowA: 0.55 },
    cloud: { top: '#FFFFFF', bottom: '#D2E8F5', shade: '#A9C9E4', alpha: 0.95 },
    fog: '#DDF3F7',
    mountains: { light: '#C2E0EC', fill: '#A3CDE0', shade: '#86B5CD' },
    mountainsBack: { light: '#D5EBF3', fill: '#C0DFEB', shade: '#AAD0E1' },
    hillsFar: { top: '#92D0A0', bottom: '#70B88E', rim: '#BFE6BE', shade: '#68AE88', deco: '#5FA77E', decoLight: '#A6DDB4' },
    hillsNear: { top: '#56B878', bottom: '#3A9A5E', rim: '#A2DDA8', shade: '#36905A', deco: '#2F8250', decoLight: '#86CF98' },
    hillsNearFog: 0.14,
    trees: {
      kind: 'round',
      trunk: '#7A5230',
      trunkDark: '#553820',
      leaf: '#409A66',
      leafLight: '#74C288',
      leafDark: '#2B7154',
      berm: '#2F7A50',
      bermLight: '#5CAE70',
      bermDark: '#22603F',
      flowers: ['#FFE04A', '#FF8FB4'],
      haze: 0.36,
    },
    fg: {
      a: '#2B6419',
      b: '#3D8526',
      c: '#56A332',
      accent: ['#FFE04A', '#FF7FA8'],
      shadow: 'rgba(20,40,10,0.22)',
      bush: ['#24561A', '#35792A', '#58A03C'],
    },
    ground: {
      edge: 'grass',
      top: '#7CC83E',
      light: '#B0E35E',
      dark: '#4F9B2B',
      lip: '#3D8224',
      soil: '#8E5C34',
      soilDark: '#6C4325',
      soilDeep: '#4A2C16',
      pebble: '#B48A5C',
      pebbleDark: '#5A391D',
      outline: '#2D4515',
    },
    rock: { light: '#B4B0A8', fill: '#8E8A84', dark: '#66625D', outline: '#34312D', cap: 'moss' },
    deck: {
      light: '#C08A55',
      base: '#94603A',
      dark: '#6A4224',
      seam: '#4A2C14',
      outline: '#2E1A0B',
      metal: '#646C76',
      metalLight: '#A9B2BC',
      metalDark: '#30353C',
    },
    moss: { top: '#7CC83E', dark: '#4F9B2B', light: '#B0E35E' },
  },
  beach: {
    name: 'Пляжный закат',
    accent: '#FF9F58',
    sky: [
      [0, '#2D2A6C'],
      [0.33, '#7B3F8E'],
      [0.6, '#E2687A'],
      [0.8, '#FF9F58'],
      [1, '#FFD47E'],
    ],
    sun: { x: 0.62, y: 0.5, r: 0.09, core: '#FFF2BE', glow: '#FFB25A', glowA: 0.6, onHorizon: true },
    cloud: { top: '#FFD0A8', bottom: '#C7678A', shade: '#A44E80', alpha: 0.92 },
    fog: '#FFB98A',
    mountains: { light: '#8C568F', fill: '#6C3F7C', shade: '#55306A' },
    sea: { top: '#F6A766', mid: '#D27479', bottom: '#8C4A86', sparkle: '#FFE6A8', line: '#FFD7A0' },
    islands: { light: '#9A5A8E', fill: '#6E3F7A', shade: '#57306A', palm: '#5E3770' },
    hillsNear: { top: '#F2BC92', bottom: '#E7A585', rim: '#FFDDB4', shade: '#D9917A', deco: '#8A8040', decoLight: '#C2AE5A' },
    hillsNearFog: 0.25,
    trees: {
      kind: 'palm',
      trunk: '#6E412A',
      trunkDark: '#4E2C1C',
      leaf: '#2F6040',
      leafLight: '#5C8E46',
      leafDark: '#1F4430',
      rim: '#FFB070',
      berm: '#D69466',
      bermLight: '#F0B67C',
      bermDark: '#1F4430',
      flowers: ['#FF6F61', '#FFD27A'],
      haze: 0.22,
    },
    fg: {
      a: '#465724',
      b: '#647634',
      c: '#86963E',
      accent: ['#FF8A5C', '#FFD27A'],
      shadow: 'rgba(70,30,10,0.22)',
      bush: ['#2E4A22', '#45652E', '#6C8A3E'],
    },
    ground: {
      edge: 'sand',
      top: '#F4CF8A',
      light: '#FFEABC',
      dark: '#D7A35C',
      lip: '#B07A3E',
      soil: '#A86E3C',
      soilDark: '#8E5A30',
      soilDeep: '#5E3618',
      pebble: '#FFF2DA',
      pebbleDark: '#7A4E2C',
      outline: '#5A3414',
    },
    rock: { light: '#C2907E', fill: '#9A6E64', dark: '#6E4A48', outline: '#3A2224', cap: null },
    deck: {
      light: '#C9A27A',
      base: '#9C7550',
      dark: '#6E4E34',
      seam: '#4E3420',
      outline: '#33200F',
      metal: '#6E6A66',
      metalLight: '#B4ADA4',
      metalDark: '#363230',
    },
    moss: { top: '#8DB84A', dark: '#5E8A30', light: '#C2E07A' },
  },
  snow: {
    name: 'Снежные вершины',
    accent: '#9FC8F0',
    sky: [
      [0, '#2C6CC2'],
      [0.5, '#7BB4EA'],
      [1, '#E4F2FB'],
    ],
    sun: { x: 0.18, y: 0.13, r: 0.045, core: '#FFFFFF', glow: '#FFFFFF', glowA: 0.5 },
    cloud: { top: '#FFFFFF', bottom: '#C8D9EC', shade: '#A6BDDB', alpha: 0.9 },
    fog: '#E4F2FB',
    mountains: { light: '#C6D5EE', fill: '#9BB2D7', shade: '#7A92C0', snow: '#F6FAFF', snowShade: '#CFDDF0' },
    mountainsBack: { light: '#DCE6F5', fill: '#C2D2EA', shade: '#AABCDC', snow: '#FAFCFF', snowShade: '#E0E9F6' },
    rangeFar: { light: '#AFC2E2', fill: '#7F96C4', shade: '#5E739F', snow: '#EEF4FC', snowShade: '#C3D3EA' },
    hillsNear: { top: '#CBD9EC', bottom: '#B4C6DF', rim: '#E6EEF8', shade: '#A2B7D4', deco: '#2F5E5B', decoLight: '#46806F' },
    hillsNearFog: 0.14,
    trees: {
      kind: 'pine',
      trunk: '#5A3E2B',
      trunkDark: '#3E2A1C',
      leaf: '#2F5E5B',
      leafLight: '#46806F',
      leafDark: '#1E403F',
      snow: '#E9F0F9',
      snowShade: '#BFD0E6',
      berm: '#C3D2E7',
      bermLight: '#DCE6F3',
      bermDark: '#A5B9D6',
      haze: 0.28,
    },
    fg: {
      a: '#9FB4D2',
      b: '#B7C8E0',
      c: '#D6E1F0',
      accent: [],
      shadow: 'rgba(70,90,130,0.3)',
      bush: ['#8FA7CA', '#B3C6DF', '#DCE6F3'],
    },
    snowfall: true,
    ground: {
      edge: 'snow',
      top: '#F7FBFF',
      light: '#FFFFFF',
      dark: '#CCDCEE',
      lip: '#AFC5DF',
      soil: '#7A87A2',
      soilDark: '#5F6A85',
      soilDeep: '#434B62',
      pebble: '#AAB6CC',
      pebbleDark: '#3E465B',
      outline: '#2A3247',
    },
    rock: { light: '#A9B6CC', fill: '#7E8BA4', dark: '#5B6680', outline: '#262D40', cap: 'snow' },
    deck: {
      light: '#A88468',
      base: '#7E5E46',
      dark: '#563E2E',
      seam: '#3A281C',
      outline: '#24170E',
      metal: '#66707E',
      metalLight: '#B0BCCB',
      metalDark: '#2E3440',
    },
    moss: { top: '#F7FBFF', dark: '#CCDCEE', light: '#FFFFFF' },
  },
};
