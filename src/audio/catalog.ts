// Каталог звуков: ключ → рецепт, категория микса, запекание, ожидаемая длина.
// Один источник правды для движка (handle/ui), запекания (bake.ts) и страницы предпросмотра/рендера.

import type { BirdType, PigType } from '../core/types';
import type { MixGraph } from './graph';
import type { Cat } from './mix';
import { DEFEAT, playJingle, VICTORY } from './music';
import * as F from './sfx';

export type SoundGroup = 'sling' | 'birds' | 'ability' | 'material' | 'explosion' | 'pig' | 'reward' | 'ui';

export interface SoundDef {
  key: string;
  group: SoundGroup;
  /** Подпись для страницы предпросмотра (рус.). */
  label: string;
  cat: Cat;
  /** Длина буфера запекания/рендера, с. */
  dur: number;
  /** Сколько вариантов запекать; 0 — только живой синтез (непрерывный параметр или длинный хвост). */
  bake: number;
  /** Приоритет запекания: 0 — нужен в первом уровне, 1 — позже, 2 — экраны/UI. */
  prio: 0 | 1 | 2;
  /** Уровень посыла в реверб. */
  send?: number;
  /** Шина: 'music' — джинглы (звучат только при включённой музыке); иначе — по категории (sfx/ui). */
  bus?: 'music';
  /** Параметр рецепта по умолчанию (натяжение, длительность, номер…). */
  param?: number;
  /** Ожидаемая длина выше −50 дБ, мс — только там, где она указана в docs/research/05-audio.md §8, §13. */
  expectMs?: number;
  /** Подстройка громкости, дБ (калибровка по громкости, см. LOUDNESS_TRIM_DB). */
  trimDb: number;
  /**
   * Доля длины звука, которую голос держит место в пуле (по умолчанию 1). Для колокольчиков 2/3:
   * у экспоненциального хвоста −40 дБ наступает на 2/3 пути до −60 дБ; тише хвост доигрывает вне лимита.
   */
  holdFrac?: number;
  /**
   * Вес при краже голоса (score × weight, по умолчанию 1): тик счёта уступает звёздам, рекорд важнее звёзд,
   * трещина уступает разрушению (иначе на обрушении трещины занимали все голоса break, и разрушения терялись).
   */
  weight?: number;
  fn: (s: F.S, t: number, param: number) => number;
}

export const BIRDS: readonly BirdType[] = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];
export const PIGS: readonly PigType[] = ['small', 'medium', 'large', 'helmet', 'mustache', 'king'];

const BIRD_RU: Record<BirdType, string> = {
  red: 'Ред', blues: 'Синие', chuck: 'Чак', bomb: 'Бомб', matilda: 'Матильда', hal: 'Хэл', terence: 'Теренс', silver: 'Сильвер',
};
const PIG_RU: Record<PigType, string> = {
  small: 'малый', medium: 'средний', large: 'большой', helmet: 'в каске', mustache: 'усач', king: 'король',
};
const LAUNCH_MS: Record<BirdType, number> = { red: 485, blues: 252, chuck: 403, bomb: 470, matilda: 392, hal: 409, terence: 687, silver: 467 };
const TIER_I = [0.15, 0.5, 0.9] as const;
/** Колокольчики держат голос до −40 дБ (2/3 длины до −60 дБ). */
const BELL_HOLD = 2 / 3;
/** Вес трещины при краже: 1.5 × 0.6 = 0.9 < разрушения доски 0.88 × 1.5 = 1.3 (mapping.ts, blockDestroyed). */
export const CRACK_WEIGHT = 0.6;
const TIER_RU = ['лёгкий', 'средний', 'сильный'] as const;

/**
 * Калибровка «весомости»: рецепты из 05-audio выровнены по ПИКУ, а слышим мы громкость.
 * Поправки, дБ, посчитаны по максимальной моментальной громкости (BS.1770, окно 400 мс) офлайн-рендера
 * через игровой граф (scripts/render-audio.mjs) ТЕМ ЖЕ путём, что в игре: запекаемые звуки — буфером 32 кГц
 * с игровым сидом (среднее по вариантам), живые — рецептом. Цели класса, LUFS:
 *   взрывы −13 · крик при запуске −13 (Синие −14.5, Теренс −14) · способности −15 · разрушения −16 · смех/гибель свиней −17
 *   реплика выбора −19 · «уф» −20 · трещины, удары (сильные) −20…−21 · лёд −17 · земля −21 · захват рогатки −27
 *   звёзды −13/−12/−11 · «уровень зачищен» −13 · бонус −14 · джинглы −14/−16 · UI −21…−22.
 * Кнопки меню (RMS в окне 100 мс) на 5–7 дБ громче медианы польки (−25 dBFS), hover — около неё.
 * Переход на замер запечённого пути (32 против 48 кГц, свои сиды): Синие −1, лёд-звон +1, обломки +1.3,
 * трещины льда +0.6…0.8, земля сильная +0.8, «пуф» +0.9, Теренс +0.5…0.7, отмена +0.5; трещины камня
 * в запечённом виде уже совпадают с трещинами дерева и льда (±0.5 дБ по стадиям) — поправка не нужна.
 */
export const LOUDNESS_TRIM_DB: Readonly<Record<string, number>> = {
  'slingGrab': 1, 'slingCancel': 0.5, 'hop': -1, 'launch:red': -2.5, 'hurt:red': 1, 'launch:blues': -4.5, 'select:blues': -3.5,
  'hurt:blues': -4, 'select:chuck': 3, 'launch:bomb': 2, 'select:bomb': 2, 'hurt:bomb': 3, 'launch:matilda': 1.5,
  'select:matilda': -1.5, 'hurt:matilda': -5.5, 'launch:hal': -1.5, 'hurt:hal': -1, 'launch:terence': 3.2, 'select:terence': 2.5,
  'hurt:terence': 5.5, 'launch:silver': -5.5, 'select:silver': -2.5, 'hurt:silver': -6, 'feather': 2, 'puff': 0.9, 'ab:silver': -8.5, 'ab:blues': -1.9,
  'ab:bombSwell': -2, 'fuse': -4, 'iceHit:0': -3.5, 'iceHit:1': -3.5, 'iceHit:2': -3.5, 'ground:0': -2,
  'ground:1': -0.7, 'iceCrack:1': 0.8, 'iceCrack:2': 0.7, 'iceCrack:3': 0.6, 'woodBreak': 2, 'iceShatter': 0, 'rubble': 1.3,
  'boom:tnt': 1.5, 'boom:bomb': 1.5, 'boom:egg': 2,
  'helmet': -4.5, 'star:0': -1, 'star:1': -1.5, 'star:2': -2.5, 'bonus': -2.5, 'scoreDone': -3, 'cleared': 1.5,
  'jingle:win': 2, 'jingle:lose': 2,
  // UI: +2 дБ к первой калибровке (сцена mix_menu_ui); полька при этом стала на 5 дБ тише (TRACK_GAIN.menu)
  'ui:click': 3.5, 'ui:back': 2, 'ui:toggleOn': 0, 'ui:toggleOff': 0, 'ui:popIn': 0, 'ui:locked': -2, 'ui:whoosh': 1, 'ui:hover': 16.5,
};

type DefIn = Omit<SoundDef, 'trimDb'>;
const defs0: DefIn[] = [
  // ── рогатка ──
  { key: 'slingGrab', group: 'sling', label: 'Захват', cat: 'sling', dur: 0.25, bake: 1, prio: 0, expectMs: 140, fn: (s, t) => F.slingGrab(s, t) },
  { key: 'slingStretch', group: 'sling', label: 'Скрип натяжения', cat: 'sling', dur: 0.3, bake: 0, prio: 0, param: 0.6, expectMs: 120, fn: (s, t, p) => F.slingStretch(s, t, p) },
  { key: 'slingRelease:lo', group: 'sling', label: 'Выстрел слабый', cat: 'sling', dur: 0.7, bake: 1, prio: 0, expectMs: 505, fn: (s, t) => F.slingRelease(s, t, 0.3) },
  { key: 'slingRelease:hi', group: 'sling', label: 'Выстрел сильный', cat: 'sling', dur: 0.7, bake: 1, prio: 0, expectMs: 515, fn: (s, t) => F.slingRelease(s, t, 1) },
  { key: 'slingCancel', group: 'sling', label: 'Отмена', cat: 'sling', dur: 0.55, bake: 1, prio: 0, expectMs: 400, fn: (s, t) => F.slingCancel(s, t) },
  { key: 'hop', group: 'sling', label: 'Прыжок на рогатку', cat: 'sling', dur: 0.6, bake: 1, prio: 0, expectMs: 480, fn: (s, t) => F.birdHop(s, t) },

  // ── птицы ──
  ...BIRDS.flatMap((b): DefIn[] => [
    { key: `launch:${b}`, group: 'birds', label: `${BIRD_RU[b]}: крик`, cat: 'birdVox', dur: 0.85, bake: 1, prio: b === 'red' ? 0 : 1, expectMs: LAUNCH_MS[b], fn: (s, t) => F.birdLaunch(s, t, b) },
    { key: `select:${b}`, group: 'birds', label: `${BIRD_RU[b]}: выбор`, cat: 'birdVox', dur: 0.6, bake: 1, prio: b === 'red' ? 0 : 1, fn: (s, t) => F.birdSelect(s, t, b) },
    { key: `hurt:${b}`, group: 'birds', label: `${BIRD_RU[b]}: «уф»`, cat: 'birdVox', dur: 0.35, bake: 1, prio: b === 'red' ? 0 : 1, fn: (s, t) => F.birdHurt(s, t, b) },
  ]),
  { key: 'feather', group: 'birds', label: 'Перья', cat: 'impact', dur: 0.3, bake: 2, prio: 0, expectMs: 185, fn: (s, t) => F.featherPof(s, t) },
  { key: 'puff', group: 'birds', label: 'Исчезновение «пуф»', cat: 'impact', dur: 0.5, bake: 1, prio: 0, expectMs: 330, fn: (s, t) => F.birdPuff(s, t) },

  // ── способности ──
  { key: 'ab:chuck', group: 'ability', label: 'Чак: рывок', cat: 'ability', dur: 1.0, bake: 1, prio: 1, expectMs: 840, fn: (s, t) => F.abilityChuck(s, t) },
  { key: 'ab:blues', group: 'ability', label: 'Синие: разделение', cat: 'ability', dur: 0.35, bake: 1, prio: 1, expectMs: 215, fn: (s, t) => F.abilityBlues(s, t) },
  { key: 'ab:matilda', group: 'ability', label: 'Матильда: яйцо', cat: 'ability', dur: 0.95, bake: 1, prio: 1, expectMs: 525, fn: (s, t) => F.abilityMatilda(s, t) },
  { key: 'ab:silver', group: 'ability', label: 'Сильвер: петля', cat: 'ability', dur: 1.3, bake: 1, prio: 1, expectMs: 1160, fn: (s, t) => F.abilitySilver(s, t) },
  { key: 'ab:bombSwell', group: 'ability', label: 'Бомб: надувание', cat: 'ability', dur: 0.25, bake: 1, prio: 1, expectMs: 180, fn: (s, t) => F.bombSwell(s, t) },
  { key: 'ab:hal', group: 'ability', label: 'Хэл: бумеранг', cat: 'ability', dur: 1.8, bake: 0, prio: 1, param: 1000, expectMs: 1400, fn: (s, t, p) => F.abilityHal(s, t, p) },
  { key: 'fuse', group: 'ability', label: 'Бомб: фитиль', cat: 'loop', dur: 1.3, bake: 0, prio: 1, param: 1000, fn: (s, t, p) => F.bombFuse(s, t, p) },

  // ── материалы ──
  ...(['wood', 'ice', 'stone'] as const).flatMap((m) =>
    TIER_I.map((I, ti): DefIn => ({
      key: `${m}Hit:${ti}`, group: 'material', label: `${m === 'wood' ? 'Дерево' : m === 'ice' ? 'Лёд' : 'Камень'}: удар ${TIER_RU[ti]}`,
      cat: 'impact', dur: m === 'ice' ? 1.6 : 0.7, bake: 3, prio: 0,
      expectMs: m === 'wood' ? [306, 380, 448][ti]! : m === 'ice' ? [653, 900, 1117][ti]! : [250, 300, 355][ti]!,
      fn: (s, t) => (m === 'wood' ? F.woodHit(s, t, I) : m === 'ice' ? F.iceHit(s, t, I) : F.stoneHit(s, t, I)),
    })),
  ),
  ...[0.3, 0.9].map((I, ti): DefIn => ({
    key: `ground:${ti}`, group: 'material', label: `Земля: удар ${ti ? 'сильный' : 'лёгкий'}`, cat: 'impact', dur: 0.5, bake: 2, prio: 0, expectMs: 331,
    fn: (s, t) => F.groundThud(s, t, I),
  })),
  { key: 'pigBump', group: 'material', label: 'Свинья: «бонк»', cat: 'impact', dur: 0.3, bake: 2, prio: 0, expectMs: 206, fn: (s, t) => F.pigBump(s, t) },
  ...(['wood', 'ice', 'stone'] as const).flatMap((m) =>
    [1, 2, 3].map((st): DefIn => ({
      key: `${m}Crack:${st}`, group: 'material', label: `${m === 'wood' ? 'Дерево' : m === 'ice' ? 'Лёд' : 'Камень'}: трещина ${st}`,
      cat: 'break', dur: 0.5, bake: 2, prio: 0, expectMs: m === 'wood' ? 253 : m === 'ice' ? 266 : 380, weight: CRACK_WEIGHT,
      fn: (s, t) => (m === 'wood' ? F.woodCrack(s, t, st) : m === 'ice' ? F.iceCrack(s, t, st) : F.stoneCrack(s, t, st)),
    })),
  ),
  { key: 'woodBreak', group: 'material', label: 'Дерево: разрушение', cat: 'break', dur: 0.8, bake: 3, prio: 0, send: 0.12, expectMs: 509, fn: (s, t) => F.woodBreak(s, t, 1) },
  { key: 'iceShatter', group: 'material', label: 'Лёд: звон стекла', cat: 'break', dur: 1.4, bake: 3, prio: 0, send: 0.12, expectMs: 902, fn: (s, t) => F.iceShatter(s, t, 1) },
  { key: 'stoneBreak', group: 'material', label: 'Камень: разрушение', cat: 'break', dur: 2.1, bake: 3, prio: 0, send: 0.12, expectMs: 1302, fn: (s, t) => F.stoneBreak(s, t, 1) },
  { key: 'rubble', group: 'material', label: 'Обрушение (обломки)', cat: 'break', dur: 1.4, bake: 2, prio: 1, expectMs: 1175, fn: (s, t) => F.rubble(s, t, 6) },

  // ── взрывы ──
  ...(['tnt', 'bomb', 'egg'] as const).map((src): DefIn => ({
    key: `boom:${src}`, group: 'explosion', label: `Взрыв: ${src === 'tnt' ? 'TNT' : src === 'bomb' ? 'Бомб' : 'яйцо'}`,
    cat: 'explosion', dur: 3.2, bake: 2, prio: src === 'tnt' ? 0 : 1, send: 0.25, expectMs: src === 'tnt' ? 1959 : src === 'bomb' ? 1757 : 1768,
    fn: (s, t) => F.explosion(s, t, src),
  })),

  // ── свиньи ──
  ...PIGS.flatMap((p): DefIn[] => [
    { key: `pigGrunt:${p}`, group: 'pig', label: `Хрюк: ${PIG_RU[p]}`, cat: 'pigVox', dur: 0.45, bake: 1, prio: 1, expectMs: 305, fn: (s, t) => F.pigGrunt(s, t, p) },
    { key: `pigHurt:${p}`, group: 'pig', label: `Ушиб: ${PIG_RU[p]}`, cat: 'pigVox', dur: 0.3, bake: 1, prio: 0, expectMs: 214, fn: (s, t) => F.pigHurt(s, t, p) },
    { key: `pigLaugh:${p}`, group: 'pig', label: `Смех: ${PIG_RU[p]}`, cat: 'pigVox', dur: 1.0, bake: 1, prio: 1, expectMs: p === 'king' ? 845 : 560, fn: (s, t) => F.pigLaugh(s, t, p) },
    { key: `pigPop:${p}`, group: 'pig', label: `Гибель: ${PIG_RU[p]}`, cat: 'pigVox', dur: 0.5, bake: 1, prio: 0, expectMs: 350, fn: (s, t) => F.pigPop(s, t, p, true) },
  ]),
  { key: 'pigPopQuiet', group: 'pig', label: 'Гибель (без визга)', cat: 'impact', dur: 0.45, bake: 2, prio: 0, fn: (s, t) => F.pigPop(s, t, 'medium', false) },
  { key: 'helmet', group: 'pig', label: 'Каска слетела', cat: 'impact', dur: 1.5, bake: 1, prio: 1, expectMs: 1114, fn: (s, t) => F.helmetClang(s, t) },

  // ── награды (живой синтез: длинные колокольные хвосты; место в пуле — до −40 дБ) ──
  ...[0, 1, 2].map((i): DefIn => ({
    key: `star:${i}`, group: 'reward', label: `Звезда ${i + 1}`, cat: 'reward', dur: 4.5, bake: 0, prio: 2, expectMs: i === 2 ? 3758 : 3531,
    holdFrac: BELL_HOLD, fn: (s, t) => F.star(s, t, i),
  })),
  { key: 'starEmpty', group: 'reward', label: 'Пустая звезда', cat: 'reward', dur: 0.3, bake: 0, prio: 2, fn: (s, t) => F.starEmpty(s, t) },
  { key: 'bonus', group: 'reward', label: 'Бонус за птицу', cat: 'reward', dur: 2.8, bake: 0, prio: 2, param: 0, holdFrac: BELL_HOLD, weight: 0.8, fn: (s, t, i) => F.bonusDing(s, t, i) },
  { key: 'tick', group: 'reward', label: 'Тик счётчика', cat: 'reward', dur: 0.12, bake: 0, prio: 2, param: 0.5, weight: 0.5, fn: (s, t, p) => F.scoreTick(s, t, p) },
  { key: 'scoreDone', group: 'reward', label: 'Счёт закончен', cat: 'reward', dur: 3.5, bake: 0, prio: 2, holdFrac: BELL_HOLD, fn: (s, t) => F.scoreDone(s, t) },
  { key: 'newBest', group: 'reward', label: 'Новый рекорд', cat: 'reward', dur: 5.5, bake: 0, prio: 2, holdFrac: BELL_HOLD, weight: 1.2, fn: (s, t) => F.newBest(s, t) },
  // баннер победы сразу после последней свиньи (джингл — позже, на levelEnd у окна итогов)
  { key: 'cleared', group: 'reward', label: 'Уровень зачищен', cat: 'reward', dur: 1.6, bake: 0, prio: 2, expectMs: 850, weight: 1.2, fn: (s, t) => F.cleared(s, t) },
  { key: 'jingle:win', group: 'reward', label: 'Джингл победы', cat: 'jingle', bus: 'music', dur: 3.2, bake: 0, prio: 2, expectMs: 2932, fn: (s, t) => playJingle(s.ctx, s.nb, s.out, VICTORY, t, 0.6) },
  { key: 'jingle:lose', group: 'reward', label: 'Джингл поражения', cat: 'jingle', bus: 'music', dur: 2.8, bake: 0, prio: 2, expectMs: 2396, fn: (s, t) => playJingle(s.ctx, s.nb, s.out, DEFEAT, t, 0.8) },

  // ── интерфейс ──
  ...(['click', 'back', 'toggleOn', 'toggleOff', 'popIn', 'locked', 'whoosh', 'hover'] as const).map((u): DefIn => ({
    key: `ui:${u}`, group: 'ui', label: `UI: ${u}`, cat: 'ui', dur: 0.65, bake: 1, prio: 2,
    fn: (s, t) => F.ui(s, t, u),
  })),
];

const defs: SoundDef[] = defs0.map((d) => ({ ...d, trimDb: LOUDNESS_TRIM_DB[d.key] ?? 0 }));

/** Все звуки по ключу. */
export const SOUNDS: ReadonlyMap<string, SoundDef> = new Map(defs.map((d) => [d.key, d]));
export const SOUND_LIST: readonly SoundDef[] = defs;

export function soundDef(key: string): SoundDef | undefined {
  return SOUNDS.get(key);
}

/** Шина назначения звука в графе микшера (одна функция для движка и офлайн-рендера). */
export function busOf(g: MixGraph, d: SoundDef): AudioNode {
  return d.bus === 'music' ? g.music : g.busFor(d.cat);
}

/** Звучит ли звук на шине музыки (джинглы): тогда его включает/выключает setMusic, а не setSfx. */
export function onMusicBus(key: string): boolean {
  return SOUNDS.get(key)?.bus === 'music';
}

/** Линейный множитель громкости звука (подстройка калибровки). */
export function trimGain(d: SoundDef): number {
  return 10 ** (d.trimDb / 20);
}
