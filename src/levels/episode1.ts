// Эпизод 1 «Зелёные холмы» (meadow): Red, Blues (1-4), Chuck (1-6), Bomb (1-8), TNT (1-9), босс-бригадир (1-10).
// Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Разметка (06 §2.3, пересчёт под V_MAX 21 — масштаб AB2, Ред на экране вдвое крупнее): рогатка в (0, 0) → ANCHOR
// (0, 2.7); очередь птиц на x = −1.6 − 1.1·i; предполье 1.5…10 — только декор; сооружения на x = 10…25 (правый край
// всего контента ≤ 25 м, ближайшие свиньи от ≈ 12 м, верх ≤ 11 м); bounds.maxX — правый край + 12.
// Огибающая Red (центр птицы) над x = 15 / 20 / 22 / 24: 11.1 / 7.9 / 6.4 / 4.8 м, Bomb — 9.2 / 5.7 / 4.0 / 2.2 м:
// высокое — ближе к рогатке, у правого края — не выше 4–5 м.
// Звёзды (starsSource 'solver'): suggestStars из src/core/sim — формула 06 §8.2 по очкам уровня, 3★ не выше счёта
// бота-эксперта на настоящем ядре (npx tsx scripts/level-report.ts 1- --solve, решатель по умолчанию).
// meta.calib: expertBirds / expertScore / ms — птиц, счёт и время решателя; typicalWin / k — доля побед «типичного
// игрока» 06 §7.3 (адаптивный бот с шумом прицела, k прогонов) на настоящем ядре.
// Камера (вид рогатки, облёт) считает кадр сама по габариту контента — level.camera не задаём.
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
 * Деревянная башня в 2 этажа (рамы 4×2.5) на x = 19 + крыша iso 4×1.5; small внутри 1-го и 2-го этажа.
 * Учит: оттянуть и отпустить; навес ≈ 68° обрушивает домик. Геометрия 06 §6.2, сдвинута с x = 26 на 19 (V_MAX 21).
 */
export function L1_1(): LevelDef {
  const X = 19;
  const floor1 = tower({ x: X, floors: 1 });
  const floor2 = hut({ x: X, y: floor1.top });
  return level({
    id: '1-1',
    name: 'Первый выстрел',
    theme: 'meadow',
    birds: ['red', 'red', 'red'],
    bounds: { minX: -12, maxX: 34, maxY: 25 },
    terrain: [flatGround()],
    parts: [floor1, floor2],
    pigs: [pigIn('small', floor1.spots[0]), pigIn('small', floor2.spots[0])],
    stars: { one: 0, two: 22000, three: 33000 },
    hint: 'Оттяните птицу назад и отпустите',
    meta: {
      nMin: 1,
      difficulty: 1,
      teach: 'оттянуть и отпустить',
      starsSource: 'solver',
      calib: { expertBirds: 1, expertScore: 35285, ms: 1400, typicalWin: 1, k: 16 },
    },
    decor: [
      dec('sign', 3.2),
      dec('flower', 5.5, 0, 0.9),
      dec('bush', 8, 0, 1.1),
      dec('grass', 11),
      dec('flower', 13.5, 0, 0.8, true),
      dec('grass', 15.5, 0, 0.9),
      dec('bush', 23.5, 0, 0.9, true),
      dec('rock', 26.5, 0, 0.8),
      dec('grass', 30),
    ],
  });
}

/**
 * 1-2 «Хрупкое стекло» · d 2 · N 3 (nMin 2) · правка 06: башня в 1 этаж (в 2 этажа типичный игрок побеждал в 60 %).
 * Сарай на x = 14: ледяные колонны, деревянная балка, ледяная крыша iso 4×1.5 — small внутри.
 * Башня на x = 20.5: ледяные колонны, деревянная балка с ледяными зубцами-кубиками по краям — small внутри, medium наверху.
 * За башней — травяной откос-стенка высотой 4 м (x ≥ 24): сбитый medium не укатывается, а остаётся под обломками.
 * Слабое место — ледяные колонны (лёд бьётся от одного касания). Учит: лёд хрупкий, medium прочнее small.
 */
export function L1_2(): LevelDef {
  const shed = hut({ x: 14, col: 'ice', beam: 'wood', roofMat: 'ice' });
  const tw = tower({ x: 20.5, floors: 1, mats: { col: 'ice', beam: 'wood' } });
  const teeth = part({ blocks: [blockOn('ice', 'cube', 18.75, tw.top), blockOn('ice', 'cube', 22.25, tw.top)] });
  return level({
    id: '1-2',
    name: 'Хрупкое стекло',
    birds: ['red', 'red', 'red'],
    bounds: { minX: -12, maxX: 35, maxY: 25 },
    terrain: [flatGround(), cliff(24, 4, 'right', { kind: 'ground' })],
    parts: [shed, tw, teeth],
    pigs: [pigIn('small', shed.spots[0]), pigIn('small', tw.spots[0]), pigIn('medium', tw.spots[1])],
    stars: { one: 0, two: 17000, three: 28000 },
    hint: 'Лёд разбивается от одного удара',
    meta: {
      nMin: 2,
      difficulty: 2,
      teach: 'лёд хрупкий, medium прочнее small',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 31250, ms: 1400, typicalWin: 0.81, k: 16 },
    },
    decor: [
      dec('bush', 4, 0, 1),
      dec('flower', 6.5),
      dec('grass', 9),
      dec('flower', 11, 0, 0.8, true),
      dec('rock', 17.25, 0, 0.6),
      dec('grass', 25.5, 4, 0.9, true),
      dec('bush', 28.5, 4, 1.2),
      dec('flower', 31.5, 4),
      dec('bush', 34.5, 4, 1),
    ],
  });
}

/**
 * 1-3 «Каменная плита» · d 3 · N 4 (nMin 2) · [лаборатория: с 4 птицами побед 90 %]
 * Ловушка на x = 15: деревянные колонны под каменной балкой 4×0.5, под ней medium, на балке small.
 * Каменный зиккурат на x = 21 в 3 ступени (4 + 3 + 2 квадрата 1×1), на верхней ступени — деревянный домик 2×3
 * (пол-доска, кирпичи 0.5×1, доска, крыша 2×1) с small внутри: домик стоит обеими стенками на ступени шириной 2 м.
 * Учит: камень Red не разбить, но падающий камень давит — сбейте деревянные ножки.
 */
export function L1_3(): LevelDef {
  const trap = frame({ x: 15, col: 'wood', beam: 'stone' });
  const steps = pyramid({ x: 21, rows: 4, mat: 'stone' });
  // зиккурат: пирамида 4-3-2-1 без верхнего квадрата — ступени 4, 3 и 2 квадрата
  const zig = part({ blocks: steps.blocks.filter((b) => b.y < 3) });
  // пол домика — доска 2×0.5: свинья не должна стоять на шве двух квадратов (скатывается с ребра, T0 0.06 м)
  const floor = part({ blocks: [blockOn('wood', 'plank', 21, 3)] });
  const house = hut({ x: 21, y: 3.5, span: 2, h: 1 });
  return level({
    id: '1-3',
    name: 'Каменная плита',
    birds: ['red', 'red', 'red', 'red'],
    bounds: { minX: -12, maxX: 35, maxY: 25 },
    parts: [trap, zig, floor, house],
    pigs: [pigIn('medium', trap.spots[0]), pigIn('small', trap.spots[1]), pigIn('small', house.spots[0])],
    stars: { one: 0, two: 29000, three: 39000 },
    hint: 'Камень не разбить — выбейте опоры, и плита раздавит свинью',
    meta: {
      nMin: 2,
      difficulty: 3,
      teach: 'камень не бьётся, но падающий камень давит',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 39503, ms: 2000, typicalWin: 1, k: 16 },
    },
    decor: [
      dec('flower', 3.5),
      dec('bush', 6, 0, 0.9, true),
      dec('grass', 8.5),
      dec('rock', 11, 0, 0.9),
      dec('grass', 18, 0, 0.7),
      dec('rock', 25, 0, 1.1, true),
      dec('bush', 27.5, 0, 1),
      dec('flower', 30.5, 0, 0.9),
    ],
  });
}

/**
 * 1-4 «Тройняшки» · d 3 · N 3 (nMin 1) · [проверен в лаборатории 06]
 * Три ледяные П-рамы на x = 13 / 18 / 23, ледяные крыши iso 4×1.5 на крайних; 4 small — 3 внутри, 1 на средней балке.
 * Учит: тап в полёте — Blues делятся на троих; лёд им по зубам (×2.6). Один сплит с тапом на подлёте сносит всё.
 * Геометрия — лабораторный образец со сдвигом на −7 м.
 */
export function L1_4(): LevelDef {
  const huts = [13, 18, 23].map((x) => frame({ x, col: 'ice', beam: 'ice' }));
  const roofs = [roof({ x: 13, y: huts[0].top, mat: 'ice' }), roof({ x: 23, y: huts[2].top, mat: 'ice' })];
  return level({
    id: '1-4',
    name: 'Тройняшки',
    birds: ['blues', 'blues', 'red'],
    bounds: { minX: -12, maxX: 37, maxY: 25 },
    parts: [...huts, ...roofs],
    pigs: [...huts.map((f) => pigIn('small', f.spots[0])), pigIn('small', huts[1].spots[1])],
    stars: { one: 0, two: 32000, three: 43000 },
    hint: 'Коснитесь экрана в полёте — птица разделится на три',
    meta: {
      nMin: 1,
      difficulty: 3,
      teach: 'Blues: разделение в полёте, лёд',
      starsSource: 'solver',
      calib: { expertBirds: 1, expertScore: 46386, ms: 800, typicalWin: 0.94, k: 16 },
    },
    decor: [
      dec('flower', 3.5),
      dec('grass', 6, 0, 1.1),
      dec('bush', 8.5, 0, 1, true),
      dec('flower', 10.3, 0, 0.8),
      dec('grass', 15.5, 0, 0.7),
      dec('grass', 20.5, 0, 0.7, true),
      dec('bush', 27.5, 0, 1.1),
      dec('rock', 30.5, 0, 0.8),
    ],
  });
}

/**
 * 1-5 «Холм» · d 4 · N 4 (nMin 3) · [лаборатория: побед 100 %, 3★ щедрая → больше разрушаемого в тыл]
 * Холм 8.5 / 12.8…20.5 высотой 3 м: пологий левый откос 34.9°, справа — отвесная земляная стенка. Три цели, по птице:
 * — деревянный помост (балка 4×0.5 на кирпичах 0.5×1) на левом краю верха, x = 14.25: large наверху — прочный,
 *   его берёт прямое попадание Red (у Blues по свинье ×0.5) или падение со стенки; справа камень 1×1 под концом балки;
 * — ледяная вышка в 2 этажа (span 2) под ледяной крышей у края стенки, x = 19.5: small на 2-м этаже — цель Blues;
 * — тыл: под стенкой щит из 2 ящиков (x = 21.5), за ним сарайчик 2×2.5 на x = 23.75 (ледяные стенки и балка,
 *   деревянная крыша) с small — его достаёт только навес через холм.
 * Правка под V_MAX 21 (холм сжат с 16…33 до 8.5…20.5): Red, пробив вышку, улетал со стенки на открытую тыловую свинью,
 * а сбитый large скатывался туда же — решатель брал уровень 2 птицами. Щит ловит и Red, и large, сарай держит
 * осколки; деревянный сарай был не по силам «типичному игроку» (38 % побед), ледяной снова давал 2 птицы.
 * Учит: рельеф, навесной выстрел через холм, large прочнее.
 */
export function L1_5(): LevelDef {
  const H = 3;
  // холм: левый откос 8.5…12.8 (34.9°), ровный верх 12.8…20.5, справа отвесная стенка до земли
  // A — деревянный помост 4×1.5 на левом краю верха: large открыто наверху
  const stand = frame({ x: 14.25, y: H, span: 3, h: 1, col: 'wood', beam: 'wood' });
  // камень-упор под правым концом балки помоста
  const stopper = part({ blocks: [blockOn('stone', 'square', 16.25, H)] });
  // B — ледяная вышка в 2 этажа под ледяной крышей у края стенки: small на 2-м этаже (главная цель Blues)
  const watch = tower({ x: 19.5, y: H, floors: 2, span: 2, h: 1, mats: 'ice', roof: 'ice' });
  // C — тыл: щит из двух ящиков под стенкой (ловит Red, пролетевшего вышку, и скатившийся large) и сарайчик с small
  const shield = stack({ x: 21.5, n: 2, kind: 'square', mat: 'wood' });
  const shed = hut({ x: 23.75, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'wood' });
  return level({
    id: '1-5',
    name: 'Холм',
    birds: ['red', 'blues', 'red', 'blues'],
    bounds: { minX: -12, maxX: 37, maxY: 25 },
    terrain: [flatGround(), hill(8.5, 12.8, 20.5, 20.5, H)],
    parts: [stand, stopper, watch, shield, shed],
    pigs: [pigIn('large', stand.spots[1]), pigIn('small', watch.spots[1]), pigIn('small', shed.spots[0])],
    stars: { one: 0, two: 19000, three: 30000 },
    hint: 'Свинью за холмом достанет только навесной выстрел',
    meta: {
      nMin: 3,
      difficulty: 4,
      teach: 'рельеф, навес через холм, large',
      starsSource: 'solver',
      calib: { expertBirds: 3, expertScore: 34603, ms: 4200, typicalWin: 0.75, k: 16 },
    },
    decor: [
      dec('bush', 3.5, 0, 0.9),
      dec('flower', 5.8),
      dec('grass', 7.6),
      dec('flower', 10.5, 1.4, 0.7),
      dec('grass', 17.4, H, 0.6),
      dec('rock', 26, 0, 0.6),
      dec('flower', 28.3, 0, 0.8),
      dec('bush', 31, 0, 1.2, true),
      dec('flower', 34),
    ],
  });
}

/**
 * 1-6 «Жёлтая молния» · d 4 · N 3 (nMin 2)
 * Частокол из 3 деревянных колонн (x = 11.5 / 12 / 12.5, стена 1.5×2, зазор до галереи 0.75 м), за ним галерея
 * 13.5…21.5: настил из 2 балок 4×0.5 (вторая ледяная) на 3 общих стойках 0.5×2 (x = 13.75 / 17.5 / 21.25) —
 * 2 small внутри, сверху крыши iso и ◢◣. За галереей вышка: деревянная доска 2×0.5 на ледяных стойках 3 м, medium наверху на
 * x = 23.25 (fragile: на доске 2 м ему тесно — падение с 3.5 м для medium смертельно), за вышкой — скальная стена 5 м (x ≥ 24.75).
 * Правка под V_MAX 21: галерея в 2 пролёта вместо 3 (весь уровень в 11.25…24.25 м) — на пути рывка 6 колонн.
 * Слабое место — ряд деревянных стоек на высоте 1 м: рывок Chuck (×2.2 по дереву) прошивает его насквозь.
 * Учит: Chuck — прямой выстрел 12–18°, тап на подлёте.
 */
export function L1_6(): LevelDef {
  const fence = palisade({ x: 12, n: 3, kind: 'column', mat: 'wood' });
  const gallery = pier({ x0: 13.5, n: 2, L: 4, pileH: 2 });
  // вторая балка настила — ледяная
  const blocks = gallery.blocks.map((b) => (b.w === 4 && b.x === 19.5 ? { ...b, material: 'ice' as const } : b));
  const gal = { ...gallery, blocks };
  const rooms = gal.spots.filter((sp) => sp.kind === 'under');
  const roofs = [roof({ x: 15.5, y: gal.top }), roof({ x: 19.5, y: gal.top, kind: 'tris' })];
  // вышка на ледяных стойках: с деревянными medium сбивали слишком редко («типичный игрок» — 63 % побед)
  const look = frame({ x: 23.25, span: 2, h: 3, col: 'ice' });
  return level({
    id: '1-6',
    name: 'Жёлтая молния',
    birds: ['chuck', 'chuck', 'red'],
    bounds: { minX: -12, maxX: 37, maxY: 25 },
    terrain: [flatGround(), cliff(24.75, 5, 'right')],
    parts: [fence, gal, ...roofs, look],
    pigs: [...rooms.map((sp) => pigIn('small', sp)), pigIn('medium', look.spots[1], 0, { fragile: true })],
    stars: { one: 0, two: 19000, three: 30000 },
    hint: 'Коснитесь экрана в полёте — Чак рванёт вперёд и прошьёт дерево',
    meta: {
      nMin: 2,
      difficulty: 4,
      teach: 'Chuck: рывок пробивает ряд деревянных стоек',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 34406, ms: 3600, typicalWin: 0.81, k: 16 },
    },
    decor: [
      dec('grass', 3.5),
      dec('flower', 5.5, 0, 0.9),
      dec('bush', 8, 0, 1.1),
      dec('flower', 10.3, 0, 0.8, true),
      dec('bush', 26.5, 5, 1, true),
      dec('grass', 29, 5),
      dec('rock', 32, 5, 0.9),
    ],
  });
}

/**
 * 1-7 «Каски на сваях» · d 5 · N 4 (nMin 3)
 * Пирс x0 = 11.5, 2 пролёта по 5 м (настил 11.5…21.5 из длинных балок на 3 сваях 0.5×2, верх 2.5). На настиле: будка-рама
 * span 4 с крышей над первым пролётом (helmet внутри), ящик 1×1 над средней сваей, helmet на открытом настиле
 * (x = 18.25), два ящика стопкой у края. Под настилом small (x = 18.9). Справа — неразрушимый «подвешенный» помост 3×0.6
 * (x 22…25, верх 3.8) с ледяной будкой 2×2.5 (кирпичи, доска, крыша 2×1) и small внутри (огибающая Red на x = 23.5 — 5.2 м).
 * Учит: каска держит удар — бейте сваи, настил уронит свиней; неразрушимые помосты.
 */
export function L1_7(): LevelDef {
  const deck = pier({ x0: 11.5, n: 2, L: 5, pileH: 2 });
  const yDeck = deck.top;
  const booth = hut({ x: 13.5, y: yDeck });
  const crate = part({ blocks: [blockOn('wood', 'square', 16.5, yDeck)] });
  const crates = stack({ x: 20.5, y: yDeck, n: 2, kind: 'square', mat: 'wood' });
  const P_TOP = 3.8;
  const cabin = hut({ x: 23.5, y: P_TOP, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '1-7',
    name: 'Каски на сваях',
    birds: ['chuck', 'red', 'blues', 'chuck'],
    bounds: { minX: -12, maxX: 37, maxY: 25 },
    terrain: [flatGround(), platform(22, 25, P_TOP, 0.6)],
    parts: [deck, booth, crate, crates, cabin],
    pigs: [
      pigIn('helmet', booth.spots[0]),
      pigOn('helmet', 18.25, yDeck),
      pigIn('small', deck.spots[3]),
      pigIn('small', cabin.spots[0]),
    ],
    stars: { one: 0, two: 24000, three: 36000 },
    hint: 'Каску пробить трудно — сбейте сваи, и настил рухнет',
    meta: {
      nMin: 3,
      difficulty: 5,
      teach: 'helmet, сваи и неразрушимые помосты',
      starsSource: 'solver',
      calib: { expertBirds: 3, expertScore: 40345, ms: 4200, typicalWin: 0.63, k: 16 },
    },
    decor: [
      dec('flower', 3.5),
      dec('bush', 6, 0, 1),
      dec('grass', 8.5),
      dec('sign', 10.3, 0, 0.9),
      dec('grass', 14.2, 0, 0.7),
      dec('rock', 27, 0, 0.8),
      dec('bush', 29.5, 0, 1.1, true),
      dec('flower', 32.5),
    ],
  });
}

/**
 * 1-8 «Бункер» · d 5 · N 4 (nMin 2) · правка 06: крыши бункеров не каменные-«неуязвимые» (с каменными побед было 10 %).
 * Впереди — деревянная вышка в 2 этажа под крышей на x = 12.25, small на 2-м этаже: цель Red.
 * За ней бункер 1 на x = 16.5 на земле, бункер 2 на x = 23 на скальном уступе высотой 1 м (21.25…25.25, откосы 33.7°):
 * каменные стены 0.5×1.5 и ЛЕДЯНЫЕ крыши — medium внутри (Red достаёт их навесом, пробив лёд). Между бункерами штабель
 * из 2 ящиков. Между medium 6.5 м: взрыв, берущий обоих, — узкая зона у штабеля. Решения в 2 птицы: Бомб между
 * бункерами + Red по вышке; Бомб в вышку и бункер 1 + Red навесом в ледяную крышу бункера 2.
 * Правка под V_MAX 21 (всё в 10…25 м): открытый small на вышке Бомб сбивал на лету и докатывался к штабелю (одна птица);
 * каменная крыша бункера 1 от взрыва у штабеля съезжала на вышку — поэтому вышка под крышей, а крыши бункеров ледяные.
 * Учит: Bomb взрывается от тапа и сам через 2.5 с после удара; взрыв берёт свинью и за камнем (радиус medium 3.3 м).
 */
export function L1_8(): LevelDef {
  const X1 = 16.5;
  const X2 = 23;
  // деревянная вышка впереди под крышей; small на 2-м этаже
  const look = tower({ x: 12.25, floors: 2, span: 3, h: 1.5, mats: 'wood', roof: 'wood' });
  const b1 = bunker({ x: X1, roofMat: 'ice' });
  // штабель ящиков между бункерами: точный взрыв Бомба у него берёт обоих medium и ящики
  const crates2 = stack({ x: 19.25, n: 2, kind: 'square', mat: 'wood' });
  const LEDGE = 1;
  const b2 = bunker({ x: X2, y: LEDGE, roofMat: 'ice' });
  return level({
    id: '1-8',
    name: 'Бункер',
    birds: ['bomb', 'red', 'bomb', 'red'],
    bounds: { minX: -12, maxX: 37, maxY: 25 },
    terrain: [flatGround(), plateau(21.25, 25.25, LEDGE, { slope: 1.5 })],
    parts: [look, b1, crates2, b2],
    pigs: [pigIn('medium', b1.spots[0]), pigIn('medium', b2.spots[0]), pigIn('small', look.spots[1])],
    stars: { one: 0, two: 30000, three: 42000 },
    hint: 'Коснитесь экрана — Бомб взорвётся. Или подождите: он взорвётся сам',
    meta: {
      nMin: 2,
      difficulty: 5,
      teach: 'Bomb: взрыв по тапу и сам; взрыв против камня',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 48054, ms: 1700, typicalWin: 0.94, k: 16 },
    },
    decor: [
      dec('grass', 3.5),
      dec('rock', 6, 0, 0.9),
      dec('flower', 8),
      dec('bush', 9.3, 0, 0.8, true),
      dec('flower', 20.4, 0.6, 0.6),
      dec('rock', 27.5, 0, 1.1),
      dec('bush', 30, 0, 1),
      dec('grass', 33, 0, 0.9, true),
    ],
  });
}

/**
 * 1-9 «Пороховой склад» · d 6 · N 4 (nMin 2)
 * Башня в 3 этажа на x = 13 (дерево, ледяные колонны на 2-м, дерево): на 1-м этаже TNT (x = 12.25) и medium (x = 13.6),
 * наверху small. Склад — две смежные П-рамы span 4 на x = 19 и 23: внутри 3 TNT на x = 18, 20, 23 (зазоры 1.0 и 2.0 м —
 * цепочка гарантирована, ≤ 2.0) и 2 small на x = 19 и 22. На первой раме каменная плита 2×1, на второй — крыша iso.
 * От TNT башни до склада 5.75 м — случайной цепочки нет (≥ 3.5).
 * Учит: TNT взрывается от удара; цепочка при шаге ≤ 2 м; попадание в TNT издалека.
 */
export function L1_9(): LevelDef {
  const tw = tower({ x: 13, floors: 3, mats: ['wood', { col: 'ice', beam: 'wood' }, 'wood'] });
  const s1 = frame({ x: 19 });
  const s2 = frame({ x: 23 });
  const slab = part({ blocks: [blockOn('stone', 'slab', 19, s1.top)] });
  const cap = roof({ x: 23, y: s2.top });
  return level({
    id: '1-9',
    name: 'Пороховой склад',
    birds: ['red', 'chuck', 'bomb', 'red'],
    bounds: { minX: -12, maxX: 37, maxY: 25 },
    parts: [tw, s1, s2, slab, cap],
    tnt: [tntOn(12.25, 0), tntOn(18, 0), tntOn(20, 0), tntOn(23, 0)],
    pigs: [pigOn('medium', 13.6, 0), pigIn('small', tw.spots[3]), pigOn('small', 19, 0), pigOn('small', 22, 0)],
    stars: { one: 0, two: 35000, three: 47000 },
    hint: 'Ящики TNT взрываются от удара — и поджигают соседей',
    meta: {
      nMin: 2,
      difficulty: 6,
      teach: 'TNT и цепочка взрывов',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 55750, ms: 4900, typicalWin: 1, k: 16 },
    },
    decor: [
      dec('bush', 3.5, 0, 1),
      dec('flower', 6),
      dec('grass', 8.3, 0, 1.1),
      dec('sign', 9.8),
      dec('flower', 16, 0, 0.8),
      dec('rock', 27.5, 0, 0.9, true),
      dec('grass', 30),
      dec('bush', 33, 0, 1.2),
    ],
  });
}

/**
 * 1-10 «Форт бригадира» (босс) · d 7 · N 5 (nMin 4)
 * Слева направо: частокол — стопка из 3 деревянных квадратов на x = 10.25 и ледяная сторожка (рама span 4 + крыша) на
 * x = 12.75 с small; скальное основание 15…21.5 высотой 2 м, на нём башня в 3 этажа на x = 18.5 (1-й этаж каменный,
 * 2-й — деревянные колонны под каменной балкой, 3-й деревянный, крыша iso деревянная; верх 11 м), у основания башни
 * контрфорсы из двух квадратов (камень слева, дерево справа) вплотную к колоннам; за скалой TNT на x = 22.25 и домик с
 * small на x = 24. Свиньи: mustache на 3-м этаже (пол на 7 м — падение с уступа его убивает), 2 helmet на 1–2-м этажах.
 * Слабые места: деревянные колонны 2-го этажа (обрушение верха) и TNT за скалой (домик с small).
 * Правка под V_MAX 21: с каменными балкой 3-го этажа и крышей башня стоит в 4 м от сторожки и TNT, и один Red на 44°
 * ронял тяжёлый верх так, что гибли 4 свиньи из 5 (решатель — 2 птицы); с деревянным верхом — 4 птицы, как задумано.
 * Учит: экзамен по эпизоду. Бригадира проще уронить с 7 м, чем пробить.
 */
export function L1_10(): LevelDef {
  const BASE = 2;
  const fence = stack({ x: 10.25, n: 3, kind: 'square', mat: 'wood' });
  const gate = hut({ x: 12.75, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const keep = tower({
    x: 18.5,
    y: BASE,
    floors: 3,
    mats: ['stone', { col: 'wood', beam: 'stone' }, 'wood'],
    roof: 'wood',
  });
  // контрфорсы вплотную к колоннам 1-го этажа: без них один Red опрокидывал всю башню с уступа
  const merlonL = stack({ x: 16, y: BASE, n: 2, kind: 'square', mat: 'stone' });
  const merlonR = stack({ x: 21, y: BASE, n: 2, kind: 'square', mat: 'wood' });
  const shack = hut({ x: 24, span: 2, h: 1 });
  return level({
    id: '1-10',
    name: 'Форт бригадира',
    birds: ['red', 'blues', 'chuck', 'bomb', 'red'],
    bounds: { minX: -12, maxX: 37, maxY: 25 },
    terrain: [flatGround(), plateau(15, 21.5, BASE)],
    parts: [fence, gate, keep, merlonL, merlonR, shack],
    tnt: [tntOn(22.25, 0)],
    pigs: [
      pigIn('mustache', keep.spots[2]),
      pigIn('helmet', keep.spots[0]),
      pigIn('helmet', keep.spots[1]),
      pigIn('small', gate.spots[0]),
      pigIn('small', shack.spots[0]),
    ],
    stars: { one: 0, two: 32000, three: 44000 },
    hint: 'Бригадира проще уронить со скалы, чем пробить',
    meta: {
      nMin: 4,
      difficulty: 7,
      teach: 'босс эпизода: всё вместе',
      starsSource: 'solver',
      calib: { expertBirds: 4, expertScore: 53220, ms: 23700, typicalWin: 0.88, k: 16 },
    },
    decor: [
      dec('sign', 3),
      dec('flower', 5.5),
      dec('bush', 7.5, 0, 1.1),
      dec('rock', 9, 0, 0.7),
      dec('grass', 15.4, BASE, 0.6),
      dec('bush', 27.5, 0, 1.1, true),
      dec('rock', 30.5, 0, 1),
      dec('flower', 33.5),
    ],
  });
}

export const EPISODE1_LEVELS: LevelDef[] = [L1_1(), L1_2(), L1_3(), L1_4(), L1_5(), L1_6(), L1_7(), L1_8(), L1_9(), L1_10()];
