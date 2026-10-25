// Эпизод 1 «Зелёные холмы» (meadow): Red, Blues (1-4), Chuck (1-6), Bomb (1-8), TNT (1-9), босс-бригадир (1-10).
// Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Разметка (06 §2.3): рогатка в (0, 0) → ANCHOR (0, 2.7); очередь птиц на x = −1.6 − 1.1·i; предполье 1.5…15 — только декор;
// цели на x = 16…34 (с Bomb — до 32). Огибающая Red над x = 20 / 25 / 30: 14.2 / 11.1 / 7.4 м, Bomb — 11.7 / 8.3 / 4.1 м.
// Звёзды: 1-1 и 1-4 — калибровка лаборатории 06 (§7.5), остальные — черновая формула 06 §8.2 (draftStars),
// starsSource 'manual': пороги пересчитает калибратор на настоящем ядре.
// Декор: y — поверхность, на которой стоит предмет (рисуется рендером без физики).

import type { DecorDef, LevelDef } from '../core/types';
import {
  blockOn,
  bunker,
  cliff,
  flatGround,
  frame,
  hut,
  hill,
  level,
  merge,
  palisade,
  part,
  pier,
  pigIn,
  pigOn,
  platform,
  plateau,
  pyramid,
  roof,
  stack,
  tntOn,
  tower,
} from './prefabs';

/** Декор без физики: kind, x, поверхность y, масштаб, зеркально. */
function dec(kind: DecorDef['kind'], x: number, y = 0, scale?: number, flip?: boolean): DecorDef {
  const d: DecorDef = { kind, x, y };
  if (scale !== undefined) d.scale = scale;
  if (flip) d.flip = true;
  return d;
}

/**
 * 1-1 «Первый выстрел» · d 1 · N 3 (nMin 1) · [проверен в лаборатории 06]
 * Деревянная башня в 2 этажа (рамы 4×2.5) на x = 26 + крыша iso 4×1.5; small внутри 1-го и 2-го этажа.
 * Учит: оттянуть и отпустить; навес 68° обрушивает домик. Точная копия 06 §6.2 (+ декор).
 */
export function L1_1(): LevelDef {
  const floor1 = tower({ x: 26, floors: 1 });
  const floor2 = hut({ x: 26, y: floor1.top });
  return level({
    id: '1-1',
    name: 'Первый выстрел',
    theme: 'meadow',
    birds: ['red', 'red', 'red'],
    bounds: { minX: -12, maxX: 48, maxY: 25 },
    terrain: [flatGround()],
    parts: [floor1, floor2],
    pigs: [pigIn('small', floor1.spots[0]), pigIn('small', floor2.spots[0])],
    stars: { one: 0, two: 25000, three: 35000 },
    hint: 'Оттяните птицу назад и отпустите',
    meta: {
      nMin: 1,
      difficulty: 1,
      teach: 'оттянуть и отпустить',
      starsSource: 'solver',
      calib: { expertBirds: 1, expertScore: 36040, typicalWin: 1, q40: 25000, q80: 35000, k: 10 },
    },
    decor: [
      dec('sign', 3.2),
      dec('flower', 6.5, 0, 0.9),
      dec('bush', 9, 0, 1.1),
      dec('grass', 12.5),
      dec('flower', 15, 0, 0.8, true),
      dec('grass', 21.5, 0, 0.9),
      dec('bush', 31.5, 0, 0.9, true),
      dec('rock', 35, 0, 0.8),
      dec('grass', 39),
    ],
  });
}

/**
 * 1-2 «Хрупкое стекло» · d 2 · N 3 (nMin 2) · правка 06: башня в 1 этаж (в 2 этажа типичный игрок побеждал в 60 %).
 * Сарай на x = 20: ледяные колонны, деревянная балка, ледяная крыша iso 4×1.5 — small внутри.
 * Башня на x = 28: ледяные колонны, деревянная балка с ледяными зубцами-кубиками по краям — small внутри, medium наверху.
 * За башней — травяной откос-стенка высотой 4 м (x ≥ 31.5): сбитый medium не укатывается за 34 м, а остаётся под
 * обломками (без стенки «типичный игрок» на настоящем ядре побеждал в 60 %, со стенкой — 10 из 10).
 * Слабое место — ледяные колонны (лёд бьётся от одного касания). Учит: лёд хрупкий, medium прочнее small.
 */
export function L1_2(): LevelDef {
  const shed = hut({ x: 20, col: 'ice', beam: 'wood', roofMat: 'ice' });
  const tw = tower({ x: 28, floors: 1, mats: { col: 'ice', beam: 'wood' } });
  const teeth = part({ blocks: [blockOn('ice', 'cube', 26.25, tw.top), blockOn('ice', 'cube', 29.75, tw.top)] });
  return level({
    id: '1-2',
    name: 'Хрупкое стекло',
    birds: ['red', 'red', 'red'],
    terrain: [flatGround(), cliff(31.5, 4, 'right', { kind: 'ground' })],
    parts: [shed, tw, teeth],
    pigs: [pigIn('small', shed.spots[0]), pigIn('small', tw.spots[0]), pigIn('medium', tw.spots[1])],
    hint: 'Лёд разбивается от одного удара',
    meta: { nMin: 2, difficulty: 2, teach: 'лёд хрупкий, medium прочнее small', starsSource: 'manual' },
    decor: [
      dec('bush', 5, 0, 1),
      dec('flower', 8.5),
      dec('grass', 11),
      dec('flower', 13.5, 0, 0.8, true),
      dec('rock', 24, 0, 0.7),
      dec('grass', 33, 4, 0.9, true),
      dec('bush', 36, 4, 1.2),
      dec('flower', 39.5, 4),
      dec('bush', 43, 4, 1),
    ],
  });
}

/**
 * 1-3 «Каменная плита» · d 3 · N 4 (nMin 2) · [лаборатория: с 4 птицами побед 90 %]
 * Ловушка на x = 21: деревянные колонны под каменной балкой 4×0.5, под ней medium, на балке small.
 * Каменный зиккурат на x = 29 в 3 ступени (4 + 3 + 2 квадрата 1×1), на верхней ступени — деревянный домик 2×3
 * (пол-доска, кирпичи 0.5×1, доска, крыша 2×1) с small внутри. Правка лабораторного образца: мини-рама стояла колоннами на углу
 * верхнего квадрата 1×1 без перекрытия граней — теперь домик стоит обеими стенками на ступени шириной 2 м.
 * Учит: камень Red не разбить, но падающий камень давит — сбейте деревянные ножки.
 */
export function L1_3(): LevelDef {
  const trap = frame({ x: 21, col: 'wood', beam: 'stone' });
  const steps = pyramid({ x: 29, rows: 4, mat: 'stone' });
  // зиккурат: пирамида 4-3-2-1 без верхнего квадрата — ступени 4, 3 и 2 квадрата
  const zig = part({ blocks: steps.blocks.filter((b) => b.y < 3) });
  // пол домика — доска 2×0.5: свинья не должна стоять на шве двух квадратов (скатывается с ребра, T0 0.06 м)
  const floor = part({ blocks: [blockOn('wood', 'plank', 29, 3)] });
  const house = hut({ x: 29, y: 3.5, span: 2, h: 1 });
  return level({
    id: '1-3',
    name: 'Каменная плита',
    birds: ['red', 'red', 'red', 'red'],
    parts: [trap, zig, floor, house],
    pigs: [pigIn('medium', trap.spots[0]), pigIn('small', trap.spots[1]), pigIn('small', house.spots[0])],
    hint: 'Камень не разбить — выбейте опоры, и плита раздавит свинью',
    meta: { nMin: 2, difficulty: 3, teach: 'камень не бьётся, но падающий камень давит', starsSource: 'manual' },
    decor: [
      dec('flower', 4.5),
      dec('bush', 7.5, 0, 0.9, true),
      dec('grass', 10.5),
      dec('rock', 13.5, 0, 0.9),
      dec('grass', 17, 0, 0.8),
      dec('rock', 33, 0, 1.1, true),
      dec('bush', 35.5, 0, 1),
      dec('flower', 38.5, 0, 0.9),
    ],
  });
}

/**
 * 1-4 «Тройняшки» · d 3 · N 3 (nMin 1) · [проверен в лаборатории 06, звёзды 27 000 / 36 000]
 * Три ледяные П-рамы на x = 20 / 25 / 30, ледяные крыши iso 4×1.5 на крайних; 4 small — 3 внутри, 1 на средней балке.
 * Учит: тап в полёте — Blues делятся на троих; лёд им по зубам (×2.6). Один сплит на 18° с тапом 0.5 с сносит всё.
 * Геометрия — точная копия лабораторного образца (звёзды откалиброваны на нём).
 */
export function L1_4(): LevelDef {
  const huts = [20, 25, 30].map((x) => frame({ x, col: 'ice', beam: 'ice' }));
  const roofs = [roof({ x: 20, y: huts[0].top, mat: 'ice' }), roof({ x: 30, y: huts[2].top, mat: 'ice' })];
  return level({
    id: '1-4',
    name: 'Тройняшки',
    birds: ['blues', 'blues', 'red'],
    parts: [...huts, ...roofs],
    pigs: [...huts.map((f) => pigIn('small', f.spots[0])), pigIn('small', huts[1].spots[1])],
    stars: { one: 0, two: 27000, three: 36000 },
    hint: 'Коснитесь экрана в полёте — птица разделится на три',
    meta: {
      nMin: 1,
      difficulty: 3,
      teach: 'Blues: разделение в полёте, лёд',
      starsSource: 'solver',
      calib: { expertBirds: 1, expertScore: 46323, typicalWin: 0.6, k: 10 },
    },
    decor: [
      dec('flower', 4),
      dec('grass', 7, 0, 1.1),
      dec('bush', 10.5, 0, 1, true),
      dec('flower', 14),
      dec('grass', 22.5, 0, 0.7),
      dec('grass', 27.5, 0, 0.7, true),
      dec('bush', 35, 0, 1.1),
      dec('rock', 38, 0, 0.8),
    ],
  });
}

/**
 * 1-5 «Холм» · d 4 · N 4 (nMin 3) · [лаборатория: побед 100 %, 3★ щедрая → добавлены 5 блоков в тыл]
 * Холм-трапеция 18.5 / 23…30.5 / 35 высотой 3 м (откосы 33.7°, не круче 35°). На холме башня в 2 этажа на x = 27:
 * 1-й этаж деревянный (large внутри), 2-й — ледяные колонны под КАМЕННОЙ балкой (small наверху); перед башней камень 1×1.
 * Каменная балка — «крышка»: сбитые ледяные колонны роняют её на 1-й этаж. С деревянной балкой large почти не умирал
 * («типичный игрок» на настоящем ядре — 60 %, с каменной — 9 из 10).
 * Тыл (06 §2.3, 34…40 м — «свиньи только для навеса Red/Blues»): small на земле за холмом (x = 36.2) и поленница
 * 2×2.5 из 4 квадратов и доски. Lint предупреждает zone (36.2 > 34) — так задумано: навес на ~45° почти не чувствителен
 * к углу, это обучающий бросок на дальность.
 * Учит: рельеф, навесной выстрел через холм, large прочнее (внутри 1-го этажа).
 */
export function L1_5(): LevelDef {
  const H = 3;
  // холм: левый откос 16…20.5, ровный верх 20.5…28, правый откос 28…32.5 (оба 33.7°)
  // A — ледяная вышка в 2 этажа на левом краю верха: small наверху (хрупкое место — цель для Blues)
  const watch = tower({ x: 21.5, y: H, floors: 2, span: 2, h: 1, mats: 'ice' });
  // B — амбар на правом краю верха: деревянные колонны, каменная балка-«крышка», деревянная крыша; large внутри
  const barn = frame({ x: 25.5, y: H, span: 3, h: 2, col: 'wood', beam: 'stone' });
  const barnRoof = roof({ x: 25.5, y: barn.top, mat: 'wood' });
  // камень-упор встык к правой колонне: large не скатывается с холма в тыл
  const stopper = part({ blocks: [blockOn('stone', 'square', 27.5, H)] });
  // C — тыл за холмом: деревянная сторожка 2×2 с крышей, small внутри; рядом поленница
  const shed = hut({ x: 34, span: 2, h: 1, col: 'stone', beam: 'wood', roofMat: 'wood' });
  const woodpile = merge(
    stack({ x: 36, n: 2, kind: 'square', mat: 'wood' }),
    stack({ x: 37, n: 1, kind: 'square', mat: 'wood' }),
  );
  return level({
    id: '1-5',
    name: 'Холм',
    birds: ['red', 'blues', 'red', 'blues'],
    terrain: [flatGround(), hill(16, 20.5, 28, 32.5, H)],
    parts: [watch, barn, barnRoof, stopper, shed, woodpile],
    pigs: [pigIn('small', watch.spots[2], 0, { fragile: true }), pigIn('large', barn.spots[0]), pigIn('small', shed.spots[0])],
    hint: 'Свинью за холмом достанет только навесной выстрел',
    meta: { nMin: 3, difficulty: 4, teach: 'рельеф, навес через холм, large', starsSource: 'manual' },
    decor: [
      dec('bush', 4.5, 0, 0.9),
      dec('flower', 8),
      dec('grass', 11.5),
      dec('flower', 15, 0, 0.8),
      dec('bush', 20, 1, 0.8),
      dec('flower', 23.4, H, 0.6),
      dec('grass', 29.8, H, 0.7),
      dec('flower', 33, 1.33, 0.7, true),
      dec('bush', 41, 0, 1.2, true),
      dec('flower', 43.5),
    ],
  });
}

/**
 * 1-6 «Жёлтая молния» · d 4 · N 3 (nMin 2)
 * Частокол из 3 деревянных колонн (x = 15.0 / 15.5 / 16.0, стена 1.5×2, зазор до галереи 0.75 м), за ним длинная
 * галерея 17…29: настил из 3 балок 4×0.5 (средняя ледяная) на 4 общих стойках 0.5×2 (x = 17.25 / 21 / 25 / 28.75) —
 * 3 small внутри, крыши iso по краям и ◢◣ в центре. За галереей деревянная вышка: longBeam 5×0.5 на стойках 3 м,
 * medium наверху на x = 32 (падение с 3.5 м для medium смертельно), за вышкой — скальная стена 5 м (x ≥ 35.5).
 * Правка 06 §10 по замерам на настоящем ядре: со сдвоенными стойками (9 колонн на пути) рывок Chuck гаснет во 2-й раме,
 * эксперт тратил все 3 птицы, «типичный игрок» побеждал в 0–10 %; общие стойки (7 колонн) и стена, не дающая medium
 * укатиться, — эксперт 2 птицы, типичный 8 из 10.
 * Слабое место — ряд деревянных стоек на высоте 1 м: рывок Chuck (×2.2 по дереву) прошивает его насквозь.
 * Учит: Chuck — прямой выстрел 12–18°, тап на подлёте.
 */
export function L1_6(): LevelDef {
  const fence = palisade({ x: 15.5, n: 3, kind: 'column', mat: 'wood' });
  const gallery = pier({ x0: 17, n: 3, L: 4, pileH: 2 });
  // средняя балка настила — ледяная
  const blocks = gallery.blocks.map((b) => (b.w === 4 && b.x === 23 ? { ...b, material: 'ice' as const } : b));
  const gal = { ...gallery, blocks };
  const rooms = gal.spots.filter((sp) => sp.kind === 'under');
  const roofs = [roof({ x: 19, y: gal.top }), roof({ x: 23, y: gal.top, kind: 'tris' }), roof({ x: 27, y: gal.top })];
  const look = frame({ x: 32, span: 5, h: 3 });
  return level({
    id: '1-6',
    name: 'Жёлтая молния',
    birds: ['chuck', 'chuck', 'red'],
    terrain: [flatGround(), cliff(35.5, 5, 'right')],
    parts: [fence, gal, ...roofs, look],
    pigs: [...rooms.map((sp) => pigIn('small', sp)), pigIn('medium', look.spots[1])],
    hint: 'Коснитесь экрана в полёте — Чак рванёт вперёд и прошьёт дерево',
    meta: { nMin: 2, difficulty: 4, teach: 'Chuck: рывок пробивает ряд деревянных стоек', starsSource: 'manual' },
    decor: [
      dec('grass', 4),
      dec('flower', 7, 0, 0.9),
      dec('bush', 10, 0, 1.1),
      dec('flower', 12.5, 0, 0.8, true),
      dec('grass', 14),
      dec('rock', 30.2, 0, 0.6),
      dec('bush', 37.5, 5, 1, true),
      dec('grass', 40, 5),
      dec('rock', 42.5, 5, 0.9),
    ],
  });
}

/**
 * 1-7 «Каски на сваях» · d 5 · N 4 (nMin 3)
 * Пирс x0 = 18, 3 пролёта по 4 м (настил 18…30 на 4 сваях 0.5×2, верх 2.5). На настиле: будка-рама span 4 с крышей
 * над первым пролётом (helmet внутри), ящик 1×1, helmet на открытом настиле (x = 25), два ящика стопкой у края.
 * Под настилом small (x = 24). Справа — неразрушимый «подвешенный» помост 3×0.6 (x 30.5…33.5, верх 3.8) с ледяной
 * будкой 2×2.5 (кирпичи, доска, крыша 2×1) и small внутри (огибающая Red на x = 32 — 5.6 м).
 * Учит: каска держит удар — бейте сваи, настил уронит свиней; неразрушимые помосты.
 */
export function L1_7(): LevelDef {
  const deck = pier({ x0: 18, n: 3, L: 4, pileH: 2 });
  const yDeck = deck.top;
  const booth = hut({ x: 20, y: yDeck });
  const crate = part({ blocks: [blockOn('wood', 'square', 23, yDeck)] });
  const crates = stack({ x: 28.5, y: yDeck, n: 2, kind: 'square', mat: 'wood' });
  const P_TOP = 3.8;
  const cabin = hut({ x: 32, y: P_TOP, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '1-7',
    name: 'Каски на сваях',
    birds: ['chuck', 'red', 'blues', 'chuck'],
    terrain: [flatGround(), platform(30.5, 33.5, P_TOP, 0.6)],
    parts: [deck, booth, crate, crates, cabin],
    pigs: [
      pigIn('helmet', booth.spots[0]),
      pigOn('helmet', 25, yDeck),
      pigIn('small', deck.spots[3]),
      pigIn('small', cabin.spots[0]),
    ],
    hint: 'Каску пробить трудно — сбейте сваи, и настил рухнет',
    meta: { nMin: 3, difficulty: 5, teach: 'helmet, сваи и неразрушимые помосты', starsSource: 'manual' },
    decor: [
      dec('flower', 4),
      dec('bush', 7.5, 0, 1),
      dec('grass', 11),
      dec('sign', 14.5, 0, 0.9),
      dec('grass', 24, 0, 0.7),
      dec('rock', 35.5, 0, 0.8),
      dec('bush', 38, 0, 1.1, true),
      dec('flower', 41),
    ],
  });
}

/**
 * 1-8 «Бункер» · d 5 · N 4 (nMin 2) · правка 06: крыши бункеров деревянные (с каменными побед было 10 %).
 * Бункер 1 на x = 22 на земле; бункер 2 на x = 29 на скальном уступе высотой 1 м (откосы 34°). Стены каменные
 * 0.5×1.5 (кирпич + кубик), проём 2×1.5 — medium внутри, крыши — деревянные балки 4×0.5.
 * На бункере 2 деревянная вышка span 3, h 1.5, на ней small (открытое место, верх 5 м — цель для Red).
 * Учит: Bomb взрывается от тапа и сам через 2.5 с после удара; взрыв берёт свинью и за камнем (радиус medium 3.3 м).
 */
export function L1_8(): LevelDef {
  const X1 = 19;
  const X2 = 25.5;
  const b1 = bunker({ x: X1, roofMat: 'ice' });
  // баррикада из ящиков перед бункером 1 (прикрывает его от прямых выстрелов)
  const crates1 = merge(stack({ x: X1 - 3, n: 2, kind: 'square', mat: 'wood' }), part({ blocks: [blockOn('wood', 'square', X1 - 4, 0)] }));
  // штабель ящиков между бункерами: точный взрыв Бомба между ними берёт обоих medium и ящики
  const crates2 = merge(stack({ x: X1 + 2.75, n: 2, kind: 'square', mat: 'wood' }));
  const LEDGE = 1;
  const b2 = bunker({ x: X2, y: LEDGE, roofMat: 'stone' });
  // вышка в 2 этажа (1-й деревянный, 2-й на ледяных колоннах) в 1 м справа от свеса крыши бункера 2; small наверху
  const look = tower({ x: X2 + 5.5, y: LEDGE, floors: 2, span: 3, h: 1.5, mats: ['wood', { col: 'ice', beam: 'wood' }] });
  return level({
    id: '1-8',
    name: 'Бункер',
    birds: ['bomb', 'red', 'bomb', 'red'],
    terrain: [flatGround(), plateau(X2 - 1.5, X2 + 8, LEDGE, { slope: 1.5 })],
    parts: [crates1, b1, crates2, b2, look],
    pigs: [pigIn('medium', b1.spots[0]), pigIn('medium', b2.spots[0]), pigIn('small', look.spots[2])],
    hint: 'Коснитесь экрана — Бомб взорвётся. Или подождите: он взорвётся сам',
    meta: { nMin: 2, difficulty: 5, teach: 'Bomb: взрыв по тапу и сам; взрыв против камня', starsSource: 'manual' },
    decor: [
      dec('grass', 4.5),
      dec('rock', 8, 0, 0.9),
      dec('flower', 11),
      dec('bush', 14.5, 0, 1, true),
      dec('grass', 18),
      dec('flower', 24.6, 0, 0.7),
      dec('rock', 34, 0, 1.2),
      dec('bush', 37, 0, 1),
      dec('grass', 40.5, 0, 0.9, true),
    ],
  });
}

/**
 * 1-9 «Пороховой склад» · d 6 · N 4 (nMin 2)
 * Башня в 3 этажа на x = 21 (дерево, ледяные колонны на 2-м, дерево): на 1-м этаже TNT (x = 20.25) и medium (x = 21.6),
 * наверху small. Склад — две смежные П-рамы span 4 на x = 27 и 31: внутри 3 TNT на x = 26, 28, 31 (зазоры 1.0 и 2.0 м —
 * цепочка гарантирована, ≤ 2.0) и 2 small на x = 27 и 30. На первой раме каменная плита 2×1, на второй — крыша iso.
 * От TNT башни до склада 4.75 м — случайной цепочки нет (≥ 3.5).
 * Учит: TNT взрывается от удара; цепочка при шаге ≤ 2 м; попадание в TNT издалека.
 */
export function L1_9(): LevelDef {
  const tw = tower({ x: 21, floors: 3, mats: ['wood', { col: 'ice', beam: 'wood' }, 'wood'] });
  const s1 = frame({ x: 27 });
  const s2 = frame({ x: 31 });
  const slab = part({ blocks: [blockOn('stone', 'slab', 27, s1.top)] });
  const cap = roof({ x: 31, y: s2.top });
  return level({
    id: '1-9',
    name: 'Пороховой склад',
    birds: ['red', 'chuck', 'bomb', 'red'],
    parts: [tw, s1, s2, slab, cap],
    tnt: [tntOn(20.25, 0), tntOn(26, 0), tntOn(28, 0), tntOn(31, 0)],
    pigs: [pigOn('medium', 21.6, 0), pigIn('small', tw.spots[3]), pigOn('small', 27, 0), pigOn('small', 30, 0)],
    hint: 'Ящики TNT взрываются от удара — и поджигают соседей',
    meta: { nMin: 2, difficulty: 6, teach: 'TNT и цепочка взрывов', starsSource: 'manual' },
    decor: [
      dec('bush', 4, 0, 1),
      dec('flower', 7.5),
      dec('grass', 10.5, 0, 1.1),
      dec('sign', 13.5),
      dec('flower', 16.5, 0, 0.8),
      dec('rock', 35.5, 0, 0.9, true),
      dec('grass', 38),
      dec('bush', 41, 0, 1.2),
    ],
  });
}

/**
 * 1-10 «Форт бригадира» (босс) · d 7 · N 5 (nMin 4)
 * Слева направо: частокол — стопка из 3 деревянных квадратов на x = 17 и ледяная сторожка (рама span 4 + крыша) на
 * x = 19.5 с small; скальное основание 22…29 высотой 2 м, на нём башня в 3 этажа на x = 25.5 (1-й этаж — каменные колонны,
 * 2–3-й — деревянные, балки каменные, крыша iso каменная; верх 11 м при огибающей 10.8), у основания башни контрфорсы
 * из двух квадратов (камень слева, дерево справа) вплотную к колоннам; за скалой TNT на x = 30 и домик с small на x = 32.
 * Свиньи: mustache на 3-м этаже под каменной крышей (пол на 7 м — падение с уступа его убивает), 2 helmet на 1–2-м этажах.
 * Слабые места: деревянные колонны 2-го этажа (обрушение верха) и TNT за скалой (домик с small).
 * Учит: экзамен по эпизоду. Бригадира проще уронить с 7 м, чем пробить.
 */
export function L1_10(): LevelDef {
  const BASE = 2;
  const fence = stack({ x: 17, n: 3, kind: 'square', mat: 'wood' });
  const gate = hut({ x: 19.5, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const keep = tower({
    x: 25.5,
    y: BASE,
    floors: 3,
    mats: ['stone', { col: 'wood', beam: 'stone' }, { col: 'wood', beam: 'stone' }],
    roof: 'stone',
  });
  // контрфорсы вплотную к колоннам 1-го этажа: без них один Red на 28° опрокидывал всю башню с уступа
  // («типичный игрок» побеждал в 9 из 10, один раз — одной птицей); с ними эксперт тратит 4 птицы, типичный — 4–5
  const merlonL = stack({ x: 23, y: BASE, n: 2, kind: 'square', mat: 'stone' });
  const merlonR = stack({ x: 28, y: BASE, n: 2, kind: 'square', mat: 'wood' });
  const shack = hut({ x: 32, span: 2, h: 1 });
  return level({
    id: '1-10',
    name: 'Форт бригадира',
    birds: ['red', 'blues', 'chuck', 'bomb', 'red'],
    terrain: [flatGround(), plateau(22, 29, BASE)],
    parts: [fence, gate, keep, merlonL, merlonR, shack],
    tnt: [tntOn(30, 0)],
    pigs: [
      pigIn('mustache', keep.spots[2]),
      pigIn('helmet', keep.spots[0]),
      pigIn('helmet', keep.spots[1]),
      pigIn('small', gate.spots[0]),
      pigIn('small', shack.spots[0]),
    ],
    hint: 'Бригадира проще уронить со скалы, чем пробить',
    camera: { castle: { x: 25, y: 6, viewH: 16 } },
    meta: { nMin: 4, difficulty: 7, teach: 'босс эпизода: всё вместе', starsSource: 'manual' },
    decor: [
      dec('sign', 3.5),
      dec('flower', 6.5),
      dec('bush', 9.5, 0, 1.1),
      dec('grass', 12.5),
      dec('rock', 15, 0, 0.8),
      dec('grass', 22.5, BASE, 0.6),
      dec('bush', 36, 0, 1.1, true),
      dec('rock', 39, 0, 1),
      dec('flower', 42),
    ],
  });
}

export const EPISODE1_LEVELS: LevelDef[] = [L1_1(), L1_2(), L1_3(), L1_4(), L1_5(), L1_6(), L1_7(), L1_8(), L1_9(), L1_10()];
