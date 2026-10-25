// Эпизод 1 «Зелёные холмы» (meadow): Red, Blues (1-4), Chuck (1-6), Bomb (1-8), TNT (1-9), босс-бригадир (1-10).
// Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Разметка (ревью «арт и ощущения»: уровни были длинными и низкими — на телефоне Ред 22–28 px, неба до 60 % кадра):
// рогатка в (0, 0) → ANCHOR (0, 2.7) или на насыпи 2–3 м (slingHill, ANCHOR (0, 4.7…5.7)); очередь птиц на
// x = −1.6 − 1.1·i; сооружения — вертикальные композиции на x ≈ 8…19.5 (правый край контента ≤ 20 м), верх 7–11 м;
// между насыпью и сооружением — ложбина: обломки и свиньи скатываются туда, а не к рогатке; bounds.maxX — край + 12.
// Огибающая Red (центр птицы) с земли над x = 10 / 14 / 18 / 20: 13.4 / 11.6 / 9.3 / 7.9 м, с насыпи 2 м — на 2 м выше.
// Звёзды, nMin и линия эксперта — src/levels/calib.ts (пишет scripts/level-calibrate.ts): решатель ранжирует
// кандидатов по прогонам с «мелким» шумом исполнения (±0.5°, ±1 %, ±1 кадр), из нескольких настроек берётся линия с
// лучшей долей побед; 2★ — медиана счёта линии под шумом, 3★ — 80-й перцентиль (src/core/sim/stars.ts); meta.plan —
// сама линия, meta.calib: expertBirds / expertScore — птиц и точный счёт, robustWin / handWin — доля побед под
// «мелким» шумом и «рукой» (±1.5°, ±3 %, ±3 кадра). Эпизод 1 и вводные уровни птиц — robustWin ≥ 0.6 (lint).
// stars ниже — черновые, до калибровки.
// Камера (вид рогатки, облёт) считает кадр сама по габариту контента — level.camera не задаём.
// Декор: y — поверхность, на которой стоит предмет (рисуется рендером без физики).

import type { DecorDef, LevelDef } from '../core/types';
import {
  blockOn,
  bunker,
  flatGround,
  frame,
  hill,
  hut,
  level,
  part,
  pier,
  pigIn,
  pigOn,
  platform,
  plateau,
  pyramid,
  roof,
  slingHill,
  slingshotOn,
  stack,
  tntOn,
  tower,
} from './prefabs';
import { calibrated } from './calib';

/** Декор без физики: kind, x, поверхность y, масштаб, зеркально. */
function dec(kind: DecorDef['kind'], x: number, y = 0, scale?: number, flip?: boolean): DecorDef {
  const d: DecorDef = { kind, x, y };
  if (scale !== undefined) d.scale = scale;
  if (flip) d.flip = true;
  return d;
}

/**
 * 1-1 «Первый выстрел» · d 1 · N 3 (nMin 1)
 * Скальный уступ 11.5…18.5 высотой 1.5 м, на нём деревянная башня в 2 этажа (рамы 4×2.5) под крышей iso 4×1.5 на
 * x = 15; small внутри 1-го и 2-го этажа. Верх 8 м, правый край 17 м. Учит: оттянуть и отпустить.
 */
export function L1_1(): LevelDef {
  const X = 15;
  const ROCK = 1.5;
  const floor1 = tower({ x: X, y: ROCK, floors: 1 });
  const floor2 = hut({ x: X, y: floor1.top });
  return level({
    id: '1-1',
    name: 'Первый выстрел',
    theme: 'meadow',
    birds: ['red', 'red', 'red'],
    bounds: { minX: -12, maxX: 30, maxY: 25 },
    terrain: [flatGround(), plateau(11.5, 18.5, ROCK, { slope: [2.2, 2.2] })],
    parts: [floor1, floor2],
    pigs: [pigIn('small', floor1.spots[0]), pigIn('small', floor2.spots[0])],
    stars: { one: 0, two: 22000, three: 33000 },
    hint: 'Оттяните птицу назад и отпустите',
    meta: { nMin: 1, difficulty: 1, teach: 'оттянуть и отпустить', starsSource: 'solver' },
    decor: [
      dec('sign', 3.2),
      dec('flower', 5.5, 0, 0.9),
      dec('bush', 8, 0, 1.1),
      dec('grass', 10),
      dec('flower', 12, ROCK, 0.8, true),
      dec('bush', 21, 0, 0.9, true),
      dec('rock', 23.5, 0, 0.8),
      dec('grass', 26),
    ],
  });
}

/**
 * 1-2 «Хрупкое стекло» · d 2 · N 3 (nMin 2)
 * Рогатка на насыпи 2 м. Ледяной сарай (ледяные колонны, деревянная балка, ледяная крыша) на x = 8.5 с small; скальная
 * ступень 13.5…19.5 высотой 2 м, на ней ледяная башня в 3 этажа span 3 (h 2, ледяные балки) на x = 16.5: small на
 * 1-м этаже, medium наверху (9 м над землёй). Любой удар Реда в башню ломает лёд, и medium падает с 7 м — насмерть
 * (medium выдерживает 4.5 м). Учит: лёд хрупкий, medium прочнее small — его берёт падение.
 */
export function L1_2(): LevelDef {
  const H = 2;
  const STEP = 2;
  const shed = hut({ x: 8.5, col: 'ice', beam: 'wood', roofMat: 'ice' });
  const tw = tower({ x: 16.5, y: STEP, floors: 3, span: 3, h: 2, mats: 'ice' });
  return level({
    id: '1-2',
    name: 'Хрупкое стекло',
    birds: ['red', 'red', 'red'],
    slingshot: slingshotOn(0, H),
    bounds: { minX: -12, maxX: 31 },
    terrain: [flatGround(), slingHill(H), plateau(13.5, 19.5, STEP, { slope: [2.9, 2.9] })],
    parts: [shed, tw],
    pigs: [pigIn('small', shed.spots[0]), pigIn('small', tw.spots[0]), pigIn('medium', tw.spots[3], 0, { fragile: true })],
    stars: { one: 0, two: 17000, three: 28000 },
    hint: 'Лёд разбивается от одного удара',
    meta: { nMin: 2, difficulty: 2, teach: 'лёд хрупкий, medium прочнее small', starsSource: 'solver' },
    decor: [
      dec('bush', -4, H, 1),
      dec('flower', -7, H),
      dec('grass', 5.6),
      dec('grass', 23.5, 0, 0.9, true),
      dec('bush', 25.5, 0, 1.2),
      dec('flower', 28),
    ],
  });
}

/**
 * 1-3 «Каменная плита» · d 3 · N 4 (nMin 2)
 * Ловушка на x = 11.5: деревянные колонны под каменной балкой 4×0.5, под ней medium, на балке small. Скальный уступ
 * 14…20 высотой 1.5 м (отвесная стенка к рогатке), на нём каменный зиккурат на x = 17 в 3 ступени (4 + 3 + 2
 * квадрата) и деревянный домик 2×2 (колонны, доска, крыша 2×1) с small прямо на верхней ступени — без пола-доски,
 * чтобы верх не заходил под HUD телефона.
 * Учит: камень Red не разбить, но падающий камень давит — сбейте деревянные ножки.
 */
export function L1_3(): LevelDef {
  const ROCK = 1.5;
  const trap = frame({ x: 11.5, col: 'wood', beam: 'stone' });
  const steps = pyramid({ x: 17, y: ROCK, rows: 4, mat: 'stone' });
  const zig = part({ blocks: steps.blocks.filter((b) => b.y < ROCK + 3) });
  const house = hut({ x: 17, y: ROCK + 3, span: 2, h: 1 });
  return level({
    id: '1-3',
    name: 'Каменная плита',
    birds: ['red', 'red', 'red', 'red'],
    bounds: { minX: -12, maxX: 30, maxY: 25 },
    terrain: [flatGround(), plateau(14, 20, ROCK, { slope: [0, 2.2] })],
    parts: [trap, zig, house],
    pigs: [pigIn('medium', trap.spots[0]), pigIn('small', trap.spots[1]), pigIn('small', house.spots[0])],
    stars: { one: 0, two: 29000, three: 39000 },
    hint: 'Камень не разбить — выбейте опоры, и плита раздавит свинью',
    meta: { nMin: 2, difficulty: 3, teach: 'камень не бьётся, но падающий камень давит', starsSource: 'solver' },
    decor: [
      dec('flower', 3.5),
      dec('bush', 6, 0, 0.9, true),
      dec('rock', 21.8, 0, 1.1, true),
      dec('bush', 24, 0, 1),
      dec('flower', 27, 0, 0.9),
    ],
  });
}

/**
 * 1-4 «Тройняшки» · d 3 · N 3 (nMin 1) · ввод Blues
 * Ледяная башня в 3 этажа (рамы 4×2.5, ледяные балки) под ледяной крышей на x = 14: small на каждом этаже — веер из
 * трёх Синих накрывает всю высоту башни, и тап на подлёте ±3 кадра попадает. Справа ледяная будка span 2 на
 * каменном постаменте (x = 18) с small. Учит: тап в полёте — Blues делятся на троих; лёд им по зубам (×2.6).
 */
export function L1_4(): LevelDef {
  const tw = tower({ x: 14, floors: 3, mats: 'ice', roof: 'ice' });
  const base = part({ blocks: [blockOn('stone', 'slab', 18.25, 0)] });
  const booth = hut({ x: 18.25, y: 1, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '1-4',
    name: 'Тройняшки',
    birds: ['blues', 'blues', 'red'],
    bounds: { minX: -12, maxX: 32, maxY: 25 },
    parts: [tw, base, booth],
    pigs: [...tw.spots.slice(0, 3).map((sp) => pigIn('small', sp)), pigIn('small', booth.spots[0])],
    stars: { one: 0, two: 32000, three: 43000 },
    hint: 'Коснитесь экрана в полёте — птица разделится на три',
    meta: { nMin: 1, difficulty: 3, teach: 'Blues: разделение в полёте, лёд', starsSource: 'solver' },
    decor: [
      dec('flower', 3.5),
      dec('grass', 6, 0, 1.1),
      dec('bush', 8.5, 0, 1, true),
      dec('flower', 10.3, 0, 0.8),
      dec('grass', 21.5, 0, 0.7, true),
      dec('bush', 23.5, 0, 1.1),
      dec('rock', 26.5, 0, 0.8),
    ],
  });
}

/**
 * 1-5 «Холм» · d 4 · N 4 (nMin 2)
 * Холм 5…15.5 высотой 3 м (левый откос 35°, справа отвесная стенка). На верху — деревянный помост 3×1.5 с large на
 * x = 10 и ледяная вышка в 3 этажа span 2 под ледяной крышей у края стенки (x = 14) с small на 2-м этаже. Под стенкой — щит из
 * двух ящиков (x = 16.25) и сарайчик 2×2.5 (ледяные стенки и балка, деревянная крыша) с small на x = 18.5 — его
 * достаёт только навес через холм. Учит: рельеф, навесной выстрел через холм, large прочнее.
 */
export function L1_5(): LevelDef {
  const H = 3;
  const stand = frame({ x: 10, y: H, span: 3, h: 1, col: 'wood', beam: 'wood' });
  const stopper = part({ blocks: [blockOn('stone', 'square', 12, H)] });
  const watch = tower({ x: 14, y: H, floors: 3, span: 2, h: 1, mats: 'ice', roof: 'ice' });
  const shield = stack({ x: 16.25, n: 2, kind: 'square', mat: 'wood' });
  const shed = hut({ x: 18.5, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'wood' });
  return level({
    id: '1-5',
    name: 'Холм',
    birds: ['red', 'blues', 'red', 'blues'],
    bounds: { minX: -12, maxX: 32, maxY: 25 },
    terrain: [flatGround(), hill(4.2, 8.5, 15.5, 15.5, H)],
    parts: [stand, stopper, watch, shield, shed],
    pigs: [pigIn('large', stand.spots[1]), pigIn('small', watch.spots[1]), pigIn('small', shed.spots[0])],
    stars: { one: 0, two: 19000, three: 30000 },
    hint: 'Свинью за холмом достанет только навесной выстрел',
    meta: { nMin: 2, difficulty: 4, teach: 'рельеф, навес через холм, large', starsSource: 'solver' },
    decor: [
      dec('bush', 2.5, 0, 0.9),
      dec('flower', 7, 1.9, 0.7),
      dec('grass', 12.6, H, 0.6),
      dec('rock', 21, 0, 0.6),
      dec('flower', 23.3, 0, 0.8),
      dec('bush', 26, 0, 1.2, true),
    ],
  });
}

/**
 * 1-6 «Жёлтая молния» · d 4 · N 3 (nMin 2) · ввод Chuck
 * Рогатка на насыпи 3 м. Галерея на высоких сваях (пирс 8…16, сваи 3 м, настил на 3.5 м): на настиле два деревянных
 * домика (рамы span 4 h 2, деревянные крыши) с small — на высоте полёта Чака (4–6 м): пологий выстрел и тап на
 * подлёте прошивают стенки обоих домиков (рывок ×2.2 по дереву). Справа на земле — деревянная башня в 2 этажа
 * (x = 18, span 3) с medium на 1-м этаже под каменной балкой: её берёт второй Чак низом. Учит: Chuck — прямой
 * выстрел и тап, рывок пробивает ряд деревянных стенок.
 */
export function L1_6(): LevelDef {
  const H = 3;
  const gallery = pier({ x0: 8, n: 2, L: 4, pileH: 3 });
  const deckY = gallery.top;
  const hutA = hut({ x: 10, y: deckY, h: 2 });
  const hutB = hut({ x: 14, y: deckY, h: 2 });
  const keep1 = frame({ x: 18, span: 3, h: 2, col: 'wood', beam: 'stone' });
  const keep2 = hut({ x: 18, y: keep1.top, span: 3, h: 2 });
  return level({
    id: '1-6',
    name: 'Жёлтая молния',
    birds: ['chuck', 'chuck', 'red'],
    slingshot: slingshotOn(0, H),
    bounds: { minX: -12, maxX: 32 },
    terrain: [flatGround(), slingHill(H)],
    parts: [gallery, hutA, hutB, keep1, keep2],
    pigs: [pigIn('small', hutA.spots[0]), pigIn('small', hutB.spots[0]), pigIn('medium', keep1.spots[0])],
    stars: { one: 0, two: 19000, three: 30000 },
    hint: 'Коснитесь экрана в полёте — Чак рванёт вперёд и прошьёт дерево',
    meta: { nMin: 2, difficulty: 4, teach: 'Chuck: рывок пробивает ряд деревянных стенок', starsSource: 'solver' },
    decor: [
      dec('grass', -4, H),
      dec('flower', -7, H, 0.9),
      dec('bush', 6.5, 0, 1.1),
      dec('flower', 22, 0, 0.8, true),
      dec('bush', 24.5, 0, 1, true),
      dec('rock', 27.5, 0, 0.9),
    ],
  });
}

/**
 * 1-7 «Каски на сваях» · d 5 · N 5 (nMin 3)
 * Два независимых пролёта на деревянных сваях 4 м (две колонны 0.5×2 стопкой) с открытыми настилами: левый на земле
 * (x = 9.5, настил на 4.5 м), правый на скальном цоколе 1 м (x = 15, настил на 5.5 м, ледяной навес span 3); на каждом
 * настиле helmet. Между пролётами каменный столб: рывок Чака по левому пролёту в нём вязнет. Каску удар Реда не берёт,
 * а падение с 4.5 м на землю — насмерть (снизу каска не защищает): сбитая свая роняет настил. Справа —
 * неразрушимый помост 18…20 (верх 3.5) с ледяной будкой 2×2.5 и small.
 * Учит: каска держит удар — бейте сваи, настил уронит свиней; неразрушимые помосты.
 */
export function L1_7(): LevelDef {
  const BASE = 1;
  const deckA = pier({ x0: 7.5, n: 1, L: 4, pileH: 4 });
  const deckB = pier({ x0: 13, y: BASE, n: 1, L: 4, pileH: 4 });
  const post = stack({ x: 12.25, n: 2, kind: 'square', mat: 'stone' });
  const canopy = frame({ x: 15, y: deckB.top, span: 3, h: 1.5, col: 'ice', beam: 'ice' });
  const P_TOP = 3.5;
  const cabin = hut({ x: 19, y: P_TOP, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '1-7',
    name: 'Каски на сваях',
    birds: ['chuck', 'red', 'blues', 'chuck', 'red'],
    bounds: { minX: -12, maxX: 32, maxY: 25 },
    terrain: [flatGround(), plateau(12.75, 17.25, BASE), platform(18, 20, P_TOP, 0.6)],
    parts: [deckA, post, deckB, canopy, cabin],
    pigs: [pigOn('helmet', 9.5, deckA.top), pigIn('helmet', canopy.spots[0]), pigIn('small', cabin.spots[0])],
    stars: { one: 0, two: 24000, three: 36000 },
    hint: 'Каску пробить трудно — сбейте сваи, и настил рухнет',
    meta: { nMin: 3, difficulty: 5, teach: 'helmet, сваи и неразрушимые помосты', starsSource: 'solver' },
    decor: [
      dec('flower', 3.5),
      dec('bush', 5.5, 0, 1),
      dec('rock', 22.5, 0, 0.8),
      dec('bush', 24.5, 0, 1.1, true),
      dec('flower', 27.5),
    ],
  });
}

/**
 * 1-8 «Бункер» · d 5 · N 4 (nMin 2) · ввод Bomb
 * Рогатка на насыпи 2 м. Деревянная вышка в 3 этажа span 3 (h 1.5) под крышей на x = 9, small на 2-м этаже.
 * Скальный уступ 11…20 высотой 2 м с отвесной стенкой к рогатке: на нём два бункера (каменные стены 0.5×1.5, ледяные
 * крыши 4×0.5) на x = 13 и 18 с medium, между ними штабель из 2 ящиков. Взрыв Бомба у штабеля берёт обоих medium за
 * камнем (радиус 3.5 м); Red — вышку. Учит: Bomb взрывается от тапа и сам через 2.5 с после удара; взрыв берёт
 * свинью и за камнем.
 */
export function L1_8(): LevelDef {
  const H = 2;
  const LEDGE = 2;
  const look = tower({ x: 9, floors: 3, span: 3, h: 1.5, mats: 'wood', roof: 'wood' });
  const b1 = bunker({ x: 13, y: LEDGE, roofMat: 'ice' });
  const crates2 = stack({ x: 15.5, y: LEDGE, n: 2, kind: 'square', mat: 'wood' });
  const b2 = bunker({ x: 18, y: LEDGE, roofMat: 'ice' });
  return level({
    id: '1-8',
    name: 'Бункер',
    birds: ['bomb', 'red', 'bomb', 'red'],
    slingshot: slingshotOn(0, H),
    bounds: { minX: -12, maxX: 32 },
    terrain: [flatGround(), slingHill(H), plateau(11, 20, LEDGE, { slope: [0, 2.9] })],
    parts: [look, b1, crates2, b2],
    pigs: [pigIn('medium', b1.spots[0]), pigIn('medium', b2.spots[0]), pigIn('small', look.spots[1])],
    stars: { one: 0, two: 30000, three: 42000 },
    hint: 'Коснитесь экрана — Бомб взорвётся. Или подождите: он взорвётся сам',
    meta: { nMin: 2, difficulty: 5, teach: 'Bomb: взрыв по тапу и сам; взрыв против камня', starsSource: 'solver' },
    decor: [
      dec('grass', -4, H),
      dec('rock', -7, H, 0.9),
      dec('flower', 6),
      dec('rock', 23.5, 0, 1.1),
      dec('bush', 26, 0, 1),
      dec('grass', 29, 0, 0.9, true),
    ],
  });
}

/**
 * 1-9 «Пороховой склад» · d 6 · N 4 (nMin 2)
 * Рогатка на насыпи 2 м. Склад впереди — две смежные П-рамы span 4 на x = 9.5 и 13.5 (верх 2.5, на первой каменная
 * плита 2×1, на второй — крыша iso): внутри 3 TNT на x = 8.5, 10.5, 12.5 (зазоры по 1 м — цепочка гарантирована) и 2
 * small на x = 9.5 и 14.25. За складом башня в 3 этажа на x = 17.75 (дерево, ледяные колонны на 2-м, дерево): на
 * 1-м этаже TNT (x = 16.75) и medium (x = 18.4), наверху small. От TNT склада до башни 3.25 м: взрыв склада (R 3)
 * башню не задевает — она для второй птицы. Учит: TNT взрывается от удара; цепочка при шаге ≤ 2 м.
 */
export function L1_9(): LevelDef {
  const H = 2;
  const s1 = frame({ x: 9.5 });
  const s2 = frame({ x: 13.5 });
  const slab = part({ blocks: [blockOn('stone', 'slab', 9.5, s1.top)] });
  const cap = roof({ x: 13.5, y: s2.top });
  const tw = tower({ x: 17.75, floors: 3, mats: ['wood', { col: 'ice', beam: 'wood' }, 'wood'] });
  return level({
    id: '1-9',
    name: 'Пороховой склад',
    birds: ['red', 'chuck', 'bomb', 'red'],
    slingshot: slingshotOn(0, H),
    bounds: { minX: -12, maxX: 32 },
    terrain: [flatGround(), slingHill(H)],
    parts: [s1, s2, slab, cap, tw],
    tnt: [tntOn(8.5, 0), tntOn(10.5, 0), tntOn(12.5, 0), tntOn(16.75, 0)],
    pigs: [pigOn('small', 9.5, 0), pigOn('small', 14.25, 0), pigOn('medium', 18.4, 0), pigIn('small', tw.spots[3])],
    stars: { one: 0, two: 35000, three: 47000 },
    hint: 'Ящики TNT взрываются от удара — и поджигают соседей',
    meta: { nMin: 2, difficulty: 6, teach: 'TNT и цепочка взрывов', starsSource: 'solver' },
    decor: [
      dec('bush', -4, H, 1),
      dec('sign', -7, H),
      dec('flower', 6.3, 0, 0.8),
      dec('rock', 22.5, 0, 0.9, true),
      dec('grass', 25),
      dec('bush', 28, 0, 1.2),
    ],
  });
}

/**
 * 1-10 «Форт бригадира» (босс) · d 7 · N 5 (nMin 4)
 * Рогатка на насыпи 2 м. Слева направо: частокол — стопка из 3 деревянных квадратов на x = 6.75 и ледяная сторожка
 * (рама span 4 + крыша) на x = 9.25 с small; скальное основание 11.5…17.5 высотой 2 м, на нём башня в 3 этажа на
 * x = 14.5 (1-й и 2-й этажи каменные, 3-й деревянный, крыша iso; верх 11 м),
 * контрфорсы из двух квадратов (камень слева, дерево справа); за скалой TNT на x = 18 и домик с small на x = 19.5.
 * Свиньи: mustache на 3-м этаже (пол на 7 м — падение с уступа его убивает), 2 helmet на 1–2-м этажах.
 * Учит: экзамен по эпизоду. Бригадира проще уронить с 7 м, чем пробить.
 */
export function L1_10(): LevelDef {
  const H = 2;
  const BASE = 2;
  const fence = stack({ x: 6.75, n: 3, kind: 'square', mat: 'wood' });
  const gate = hut({ x: 9.25, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const keep = tower({ x: 14.5, y: BASE, floors: 3, mats: ['stone', 'stone', 'wood'], roof: 'wood' });
  const merlonL = stack({ x: 12, y: BASE, n: 2, kind: 'square', mat: 'stone' });
  const merlonR = stack({ x: 17, y: BASE, n: 2, kind: 'square', mat: 'wood' });
  const shack = hut({ x: 19.5, span: 2, h: 1 });
  return level({
    id: '1-10',
    name: 'Форт бригадира',
    birds: ['red', 'blues', 'chuck', 'bomb', 'red'],
    slingshot: slingshotOn(0, H),
    bounds: { minX: -14, maxX: 33 },
    terrain: [flatGround(), slingHill(H), plateau(11.5, 17.5, BASE)],
    parts: [fence, gate, keep, merlonL, merlonR, shack],
    tnt: [tntOn(18, 0)],
    pigs: [
      pigIn('mustache', keep.spots[2]),
      pigIn('helmet', keep.spots[0]),
      pigIn('helmet', keep.spots[1]),
      pigIn('small', gate.spots[0]),
      pigIn('small', shack.spots[0]),
    ],
    stars: { one: 0, two: 32000, three: 44000 },
    hint: 'Бригадира проще уронить со скалы, чем пробить',
    meta: { nMin: 4, difficulty: 7, teach: 'босс эпизода: всё вместе', starsSource: 'solver' },
    decor: [
      dec('sign', -4.5, H),
      dec('flower', -8, H),
      dec('rock', 5.4, 0, 0.7),
      dec('bush', 23, 0, 1.1, true),
      dec('rock', 25.5, 0, 1),
      dec('flower', 28),
    ],
  });
}

export const EPISODE1_LEVELS: LevelDef[] = [L1_1(), L1_2(), L1_3(), L1_4(), L1_5(), L1_6(), L1_7(), L1_8(), L1_9(), L1_10()].map(calibrated);
