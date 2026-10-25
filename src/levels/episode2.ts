// Эпизод 2 «Пляжный закат» (beach): + шары-валуны, Matilda (2-2), пропасть и мост, Hal (2-5), король (2-10).
// Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Общие соглашения эпизода (ревью «арт и ощущения»: длинные низкие уровни — мелкие персонажи и пустое небо):
// - рогатка в (0, 0) → ANCHOR (0, 2.7) или на насыпи 2 м (slingHill, ANCHOR (0, 4.7)), площадка очереди ровная;
// - сооружения — вертикальные композиции на x ≈ 6…20 (правый край контента ≤ 20 м), верх 6.5–11 м; между насыпью
//   и сооружением — ложбина: обломки и свиньи не докатываются до рогатки;
// - bounds.maxX = правый край контента + 12 (на уровнях с Хэлом — + 14 под разворот бумеранга);
// - доля материалов по числу блоков ≈ дерево 45 % / лёд 20 % / камень 35 % (06 §9.3);
// - звёзды, nMin и линия эксперта — src/levels/calib.ts (scripts/level-calibrate.ts: устойчивая линия решателя,
//   2★ — медиана счёта под «мелким» шумом, 3★ — 80-й перцентиль); stars ниже — черновые, до калибровки.

import type { DecorDef, LevelDef } from '../core/types';
import type { Part } from './prefabs';
import {
  B,
  blockOn,
  bunker,
  flatGround,
  frame,
  hall,
  hill,
  hut,
  level,
  palisade,
  part,
  pigIn,
  pigOn,
  pigOnBlock,
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

/** Декор без физики (y — поверхность, на которой стоит объект). */
const dec = (kind: DecorDef['kind'], x: number, y = 0, scale?: number, flip?: boolean): DecorDef => {
  const d: DecorDef = { kind, x, y };
  if (scale !== undefined) d.scale = scale;
  if (flip) d.flip = true;
  return d;
};

/** Насыпь под рогаткой (2 м) и ANCHOR на ней. */
const MOUND = 2;

/**
 * 2-1 «Валуны» · d 4 · N 4 (nMin 2)
 * Дюна hill(0, 4.5, 10, 14.5, 3) сразу за рогаткой: откосы 34°. На ровном верху справа — каменный шар ⌀2 в колыбели
 * из деревянных кубиков, правый стопор заподлицо с кромкой ската; слева на верху — ледяной сарай span 2 (x = 5.5) с
 * small. Толчок в шар (или выбитый стопор) — и шар скатывается и врезается в трёхэтажный домик span 3 у подножия
 * (x = 16, верх 9); сарай от валуна и обвала в стороне — он для второй птицы.
 * Свиньи: medium (1-й этаж) + 2 small (2-й и 3-й этажи) в домике, small в сарае. Учит: косвенное убийство валуном.
 */
export function L2_1(): LevelDef {
  const DUNE = 3;
  const dune = hill(0, 4.5, 10, 14.5, DUNE);
  const boulders = part({
    blocks: [
      blockOn('stone', 'ball2', 8.62, DUNE, { id: 'валун' }),
      blockOn('wood', 'cube', 7.49, DUNE),
      blockOn('wood', 'cube', 9.75, DUNE, { id: 'стопор-у-кромки' }),
    ],
  });
  // ледяной сарай на левом краю дюны: валун катится от него вправо, обвал домика до него не достаёт
  const iceShed = hut({ x: 5.5, y: DUNE, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const floor1 = tower({ x: 16, floors: 2, span: 3 });
  const floor2 = hut({ x: 16, y: floor1.top, span: 3 });
  return level({
    id: '2-1',
    name: 'Валуны',
    birds: ['red', 'chuck', 'blues', 'red'],
    terrain: [flatGround(), dune],
    bounds: { maxX: 31 },
    parts: [boulders, iceShed, floor1, floor2],
    pigs: [pigIn('medium', floor1.spots[0]), pigIn('small', floor1.spots[1]), pigIn('small', floor2.spots[0]), pigIn('small', iceShed.spots[0])],
    hint: 'Толкните валун — он скатится с дюны и раздавит домик',
    stars: { one: 0, two: 29_000, three: 41_000 },
    meta: { nMin: 2, difficulty: 4, teach: 'валун в колыбели: сбить стопор или толкнуть шар — косвенное убийство', starsSource: 'solver' },
    decor: [dec('shell', -3), dec('grass', 2.5, 1.7, 0.8), dec('grass', 12.5, 1.5, 0.7), dec('shell', 20.5, 0, 0.8), dec('rock', 23.5), dec('shell', 26, 0, 1.1, true)],
  });
}

/**
 * 2-2 «Яйцо сверху» · d 5 · N 3 (nMin 2) · ввод Matilda
 * Рогатка на насыпи 2 м. Бухта между скалами plateau(8, 11, 4) и plateau(17, 20, 4), проём 6 м. Крыша на y = 4 —
 * две деревянные балки 4×0.5 на скалах и центральной стойке (вертикальная балка 4×0.5 на x = 14); на балках —
 * каменные плиты над свиньями с брусками сверху, ящик на стыке. Яйцо падает отвесно с места тапа (бухта 6 м — тап
 * ±3 кадра попадает): ломает балку — плита давит medium. Small — в двухэтажной будке на ближней скале, на дальней —
 * сарай. Перед ближней скалой — заслон из 3 каменных квадратов.
 * Свиньи: 2 medium под крышей, small в будке. Учит: Matilda — сброс яйца сверху; прямой выстрел упирается в скалу.
 */
export function L2_2(): LevelDef {
  const c = 14;
  const screen = stack({ x: c - 7, n: 3, kind: 'square', mat: 'stone' });
  const post = blockOn('wood', 'beam', c, 0, { vertical: true, id: 'стойка' });
  const beamL = B('wood', 'rect', c - 2, 4.25, 4, 0.5, 0, 'крыша-левая');
  const beamR = B('wood', 'rect', c + 2, 4.25, 4, 0.5, 0, 'крыша-правая');
  const slabL = blockOn('stone', 'slab', c - 1.5, 4.5);
  const slabR = blockOn('stone', 'slab', c + 1.5, 4.5);
  const ridge = blockOn('wood', 'square', c, 4.5, { id: 'ящик-на-стыке' });
  const boothLow = frame({ x: c - 5, y: 4, span: 2, h: 1 });
  const booth = hut({ x: c - 5, y: boothLow.top, span: 2, h: 1 });
  const shed = hut({ x: c + 5, y: 4, span: 2, h: 1, roofMat: 'ice' });
  return level({
    id: '2-2',
    name: 'Яйцо сверху',
    birds: ['matilda', 'matilda', 'red'],
    slingshot: slingshotOn(0, MOUND),
    terrain: [flatGround(), slingHill(MOUND), plateau(c - 6, c - 3, 4), plateau(c + 3, c + 6, 4)],
    bounds: { maxX: 32 },
    parts: [screen, boothLow, booth, shed],
    blocks: [
      post,
      beamL,
      beamR,
      slabL,
      slabR,
      ridge,
      blockOn('wood', 'brick', c - 2.75, 0, { vertical: true }),
      blockOn('wood', 'brick', c + 2.75, 0, { vertical: true }),
      blockOn('ice', 'cube', c - 2.75, 1),
      blockOn('ice', 'cube', c + 2.75, 1),
      blockOn('wood', 'brick', c - 1.5, 5.5),
      blockOn('wood', 'brick', c + 1.5, 5.5),
    ],
    pigs: [pigOn('medium', c - 1.5, 0), pigOn('medium', c + 1.5, 0), pigIn('small', boothLow.spots[0])],
    hint: 'Коснитесь экрана над целью — Матильда сбросит яйцо',
    stars: { one: 0, two: 22_000, three: 35_000 },
    meta: { nMin: 2, difficulty: 5, teach: 'Matilda: яйцо сверху пробивает крышу, прямой выстрел упирается в скалу', starsSource: 'solver' },
    decor: [dec('shell', -3, MOUND), dec('bush', -6, MOUND), dec('grass', 22, 0), dec('shell', 24.5, 0, 0.9, true)],
  });
}

/**
 * 2-3 «Мост над пропастью» · d 5 · N 4 (nMin 3)
 * Утёсы plateau(6, 10.25, 4) (откос к рогатке 5.8 м) и plateau(14.75, 20, 4) (откос вправо), пропасть 4.5 м до земли
 * (глубина 4 м — смертельна для small и medium). Мост — ледяной longBeam 5×0.5 на x = 12.5 (опирание по 0.25); на нём
 * ледяная рама span 4 с medium и small под ледяной крышей: мост рушится — обе свиньи падают с 4.5 м. На ближнем
 * утёсе — каменный частокол и штабель ящиков, на дне ущелья — ящик у стены. На дальнем утёсе — деревянный домик под
 * каменной балкой (x = 17.25, верх 8) с medium. Учит: сломать опору — свинья падает в пропасть.
 */
export function L2_3(): LevelDef {
  const bridge = B('ice', 'rect', 12.5, 4.25, 5, 0.5, 0, 'мост');
  const iceFrame = frame({ x: 12.5, y: 4.5, span: 4, h: 2, col: 'ice', beam: 'ice' });
  const iceCap = roof({ x: 12.5, y: iceFrame.top, w: 4, mat: 'ice' });
  const house = hut({ x: 17.25, y: 4, col: 'wood', beam: 'stone', roofMat: 'wood' });
  return level({
    id: '2-3',
    name: 'Мост над пропастью',
    birds: ['red', 'chuck', 'matilda', 'blues'],
    terrain: [flatGround(), plateau(6, 10.25, 4, { slope: [5.8, 0] }), plateau(14.75, 20, 4, { slope: [0, 6] })],
    bounds: { maxX: 32 },
    parts: [palisade({ x: 9, y: 4, n: 3, kind: 'brick', mat: 'stone', vertical: true }), iceFrame, iceCap, house],
    blocks: [
      bridge,
      blockOn('wood', 'square', 10.75, 0),
      blockOn('wood', 'square', 6.5, 4),
      blockOn('wood', 'square', 7.5, 4),
      blockOn('ice', 'square', 7, 5),
    ],
    pigs: [pigIn('medium', iceFrame.spots[0], -0.6), pigIn('small', iceFrame.spots[0], 0.9), pigIn('medium', house.spots[0])],
    hint: 'Сломайте мост — свиньи упадут в пропасть',
    stars: { one: 0, two: 20_000, three: 32_000 },
    meta: { nMin: 3, difficulty: 5, teach: 'пропасть и мост: смерть от падения', starsSource: 'solver' },
    decor: [dec('shell', -3), dec('grass', 3, 1.9, 0.8), dec('sign', 9.9, 4), dec('grass', 22, 4 * (1 - 2 / 6), 0.7), dec('shell', 28, 0, 1, true)],
  });
}

/**
 * 2-4 «Песчаный замок» · d 6 · N 4 (nMin 3)
 * Рогатка на насыпи 2 м. Скальное основание 11.75…18 высотой 1 м, на нём ступенчатая пирамида на x = 15: 6 рядов
 * (низ 12–18), нижние 2 ряда — камень, верхние —
 * дерево; ниши (над нишей — плита-перемычка 2×1) во 2-м и 4-м рядах — по small. Вершина — «донжон»: деревянная
 * балка 4×0.5 на верхней плите с зубцами-кубиками, на ней medium. Справа башенка (камень + дерево, x = 18.5).
 * Деревянный домик с small слева — на скале-столбе 3 м (x = 7.5): взрыв у пирамиды его не достаёт. Учит: разбор «массива», взрыв против камня.
 */
export function L2_4(): LevelDef {
  const X = 15;
  const BASE = 1;
  const castle = pyramid({ x: X, y: BASE, rows: 6, rowMats: ['stone', 'stone', 'wood', 'wood', 'wood', 'wood'], niches: [[1, 2], [3, 1]] });
  const body = castle.blocks.filter(
    (b) => !(b.y > BASE + 5 && b.x === X) && !(b.y === BASE + 0.5 && (b.x === X - 0.5 || b.x === X + 0.5)),
  );
  const floorSlab = blockOn('stone', 'slab', X, BASE, { id: 'пол-нижней-ниши' });
  const keepBeam = blockOn('wood', 'beam', X, BASE + 5, { id: 'донжон' });
  const merlons = [blockOn('wood', 'cube', X - 1.75, BASE + 5.5), blockOn('wood', 'cube', X + 1.75, BASE + 5.5)];
  const flank = (x: number) =>
    part({ blocks: [blockOn('stone', 'square', x, 0), blockOn('stone', 'square', x, 1), blockOn('wood', 'square', x, 2), blockOn('wood', 'cube', x, 3)] });
  // домик со small — на скале 3 м: взрыв у пирамиды до него не достаёт (≥ 5 м), его берёт отдельная птица
  const ROCK = 3;
  const house = hut({ x: 7.5, y: ROCK, span: 2, h: 1.5 });
  return level({
    id: '2-4',
    name: 'Песчаный замок',
    birds: ['bomb', 'matilda', 'chuck', 'red'],
    slingshot: slingshotOn(0, MOUND),
    terrain: [flatGround(), slingHill(MOUND), plateau(X - 3.25, X + 3, BASE), plateau(6.5, 8.5, ROCK, { kind: 'rock' })],
    bounds: { maxX: 31 },
    parts: [house, flank(X + 3.5)],
    blocks: [floorSlab, ...body, keepBeam, ...merlons],
    pigs: [pigIn('small', castle.spots[1]), pigIn('small', castle.spots[2]), pigOnBlock('medium', keepBeam), pigIn('small', house.spots[0])],
    stars: { one: 0, two: 26_000, three: 39_000 },
    meta: { nMin: 3, difficulty: 6, teach: 'разбор массива: ниши в пирамиде, взрыв против камня', starsSource: 'solver' },
    decor: [dec('shell', -3, MOUND), dec('bush', -6, MOUND), dec('shell', 11, 0, 0.8), dec('grass', 21), dec('shell', 23, 0, 1, true)],
  });
}

/**
 * 2-5 «Бумеранг» · d 5 · N 4 (nMin 2) · ввод Hal
 * Стена — скала-останец plateau(7.5, 9.5, 5.5) (статичная) с осыпью каменных квадратов у подножия. За ней постройки
 * с каменным фасадом и деревянным тылом: двухэтажный домик под крышей (x = 12.5) с medium на 2-м этаже и трёхэтажная
 * башня (x = 17.5, верх 8) с small на каждом этаже. Прямой выстрел упирается в скалу; Hal перелетает постройки, тап за ними — петля вверх-назад и
 * удар в тыл башни и домика (тыл деревянный и широкий: тап ±3 кадра попадает). За целями свободно до x ≈ 34.
 * Учит: Hal — удар с тыла.
 */
export function L2_5(): LevelDef {
  const rubble = part({
    blocks: [blockOn('stone', 'square', 7, 0), blockOn('stone', 'square', 6, 0), blockOn('stone', 'square', 7, 1), blockOn('stone', 'square', 10, 0), blockOn('stone', 'cube', 9.75, 1)],
  });
  const stoneFront = (p: Part, xFront: number): Part => ({ ...p, blocks: p.blocks.map((b) => (b.x === xFront ? { ...b, material: 'stone' as const } : b)) });
  const house = stoneFront(tower({ x: 12.5, floors: 2, roof: 'wood' }), 10.75);
  const keep = stoneFront(tower({ x: 17.5, floors: 3 }), 15.75);
  return level({
    id: '2-5',
    name: 'Бумеранг',
    birds: ['hal', 'hal', 'red', 'bomb'],
    terrain: [flatGround(), plateau(7.5, 9.5, 5.5, { kind: 'rock' })],
    bounds: { maxX: 34 },
    parts: [rubble, house, keep],
    blocks: [blockOn('ice', 'cube', 15.75, 7.5), blockOn('ice', 'cube', 19.25, 7.5)],
    pigs: [pigIn('medium', house.spots[1]), pigIn('small', keep.spots[0]), pigIn('small', keep.spots[1]), pigIn('small', keep.spots[2])],
    hint: 'Перелетите постройки и коснитесь экрана за ними — Хэл развернётся и ударит сзади',
    stars: { one: 0, two: 35_000, three: 47_000 },
    meta: { nMin: 2, difficulty: 5, teach: 'Hal: бумеранг через стену, удар с тыла', starsSource: 'solver' },
    decor: [dec('shell', 2.5), dec('grass', 4.5), dec('shell', 22.5, 0, 0.9), dec('grass', 24.5), dec('rock', 27, 0, 1.1, true)],
  });
}

/**
 * 2-6 «Пирс» · d 6 · N 4 (nMin 3)
 * Пирс из трёх независимых пролётов по 4 м (между настилами 0.5 м), верх настила 4.5: ближний (x = 8.5) — на
 * деревянных сваях из двух колонн 0.5×2, средний (x = 13) — на каменных быках из квадратов 1×1 с домиком (каменные
 * стены, деревянная крыша, helmet внутри — рывок по ближнему пролёту в нём вязнет), дальний (x = 17.5) — снова на
 * деревянных сваях. Ледяные настилы крайних пролётов, по краям —
 * ящики, под средним пролётом на пляже small. Свиньи: 2 medium + helmet на настиле, small под ним.
 * Учит: высокие сваи — слабое место, падение с 4.5 м (и каску снизу не спасает).
 */
export function L2_6(): LevelDef {
  const span = (x: number, pile: 'wood' | 'stone', deck: 'ice' | 'wood') =>
    part({
      blocks: [
        ...[x - 1.75, x + 1.75].flatMap((px) => [blockOn(pile, 'column', px, 0), blockOn(pile, 'column', px, 2)]),
        B(deck, 'rect', x, 4.25, 4, 0.5),
      ],
    });
  const near = span(8.5, 'wood', 'ice');
  const mid = part({
    blocks: [...[11.5, 14.5].flatMap((px) => [0, 1, 2, 3].map((k) => blockOn('stone', 'square', px, k))), B('wood', 'rect', 13, 4.25, 4, 0.5)],
  });
  const far = span(17.5, 'wood', 'ice');
  // домик с каменными стенами: рывок Чака по ближнему пролёту вязнет в нём и не задевает дальний пролёт
  const house = hut({ x: 13, y: 4.5, col: 'stone', beam: 'wood', roofMat: 'wood' });
  const crates = [blockOn('wood', 'square', 7, 4.5), blockOn('ice', 'cube', 7, 5.5), blockOn('ice', 'square', 19, 4.5), blockOn('wood', 'cube', 19, 5.5)];
  return level({
    id: '2-6',
    name: 'Пирс',
    birds: ['chuck', 'hal', 'matilda', 'red'],
    bounds: { maxX: 33 },
    parts: [near, mid, far, house],
    blocks: crates,
    pigs: [pigOn('medium', 8.8, 4.5), pigIn('helmet', house.spots[0]), pigOn('medium', 17.4, 4.5), pigOn('small', 13, 0)],
    hint: 'Выбейте сваю — настил рухнет вместе со свиньями',
    stars: { one: 0, two: 26_000, three: 39_000 },
    meta: { nMin: 3, difficulty: 6, teach: 'высокие сваи — слабое место, падение с настила', starsSource: 'solver' },
    decor: [dec('shell', 2.5), dec('sign', 4.5), dec('shell', 10.75, 0, 0.8), dec('rock', 21.5, 0, 0.7), dec('shell', 23.5, 0, 1, true), dec('rock', 26, 0, 1.2)],
  });
}

/**
 * 2-7 «Маяк» · d 7 · N 4 (nMin 3)
 * Рогатка на насыпи 2 м. Скальное основание plateau(9.5, 14, 1) с откосами 1.5 м. На нём маяк — башня из 3 рам span 4
 * на x = 11.75 (верх 8.5): 1-й этаж — каменные колонны, 2-й — дерево, верхний — каменная балка на деревянных колоннах
 * (тяжёлый верх опрокидывается вокруг крепкого низа). На 2-м этаже TNT и ящик, наверху mustache между каменными
 * зубцами. Справа у подножия (x = 17.5) ледяной сарай с деревянной крышей и 2 small (их добивает падающий маяк).
 * Каска — в каменном бункере у подножия слева (x = 6.5) — его берёт Бомб или яйцо Матильды.
 * Свиньи: mustache наверху, helmet в бункере, 2 small в сарае. Учит: опрокидывание высокого на соседей.
 */
export function L2_7(): LevelDef {
  const lighthouse = tower({
    x: 11.75,
    y: 1,
    floors: 3,
    mats: [{ col: 'stone', beam: 'wood' }, 'wood', { col: 'wood', beam: 'stone' }],
  });
  const merlons = [blockOn('stone', 'cube', 10, lighthouse.top), blockOn('stone', 'cube', 13.5, lighthouse.top)];
  const floor2 = lighthouse.spots[1];
  const shed = hut({ x: 17.5, col: 'ice', beam: 'ice', roofMat: 'wood', roofKind: 'tris' });
  const keep = bunker({ x: 6.5, inner: 1.5, h: 1.5, roofMat: 'stone' });
  return level({
    id: '2-7',
    name: 'Маяк',
    birds: ['red', 'bomb', 'hal', 'matilda'],
    slingshot: slingshotOn(0, MOUND),
    terrain: [flatGround(), slingHill(MOUND), plateau(9.5, 14, 1, { slope: 1.5 })],
    bounds: { maxX: 33 },
    parts: [keep, lighthouse, shed],
    blocks: [...merlons, blockOn('wood', 'square', 12.75, floor2.y)],
    tnt: [tntOn(11, floor2.y)],
    pigs: [pigOn('mustache', 11.75, lighthouse.top), pigIn('helmet', keep.spots[0]), pigIn('small', shed.spots[0], -0.7), pigIn('small', shed.spots[0], 0.7)],
    hint: 'Высокое падает далеко: бейте в верх маяка',
    stars: { one: 0, two: 26_000, three: 38_000 },
    meta: { nMin: 3, difficulty: 7, teach: 'опрокидывание высокой башни на соседей, TNT в середине', starsSource: 'solver' },
    decor: [dec('shell', -3, MOUND), dec('bush', -6, MOUND), dec('grass', 15.2, 0, 0.7), dec('shell', 21, 0, 0.9, true), dec('rock', 23)],
  });
}

/**
 * 2-8 «Два форта» · d 7 · N 5 (nMin 4)
 * Рогатка на насыпи 2 м. Две трёхэтажные башни span 4: передняя на x = 9.5 (дерево, колонны 1-го этажа — камень) и
 * задняя на x = 16.5 (лёд, колонны 1-го этажа — камень). Между их крышами мост longBeam 5×0.5 на x = 13 (опирание по
 * 1 м, верх 8) с ледяными ящиками, под мостом — каменный бункер с helmet. На крышах — малые щипцовые крыши и зубцы,
 * перед передним фортом — низкая каменная стенка (x = 6.5).
 * Свиньи: в переднем форте medium (1-й этаж) и small (3-й), в заднем small (1-й) и medium (2-й), helmet в бункере.
 * Учит: две цели — порядок выстрелов; Blues по ледяному форту, Chuck по деревянному, Hal по дальней башне сзади.
 */
export function L2_8(): LevelDef {
  const fortA = tower({ x: 9.5, floors: 3, mats: [{ col: 'stone', beam: 'wood' }, 'wood', 'wood'] });
  const fortB = tower({ x: 16.5, floors: 3, mats: [{ col: 'stone', beam: 'ice' }, 'ice', 'ice'] });
  const bridge = blockOn('wood', 'longBeam', 13, fortA.top, { id: 'мост' });
  const merlons = [blockOn('wood', 'cube', 7.75, fortA.top), blockOn('ice', 'cube', 18.25, fortB.top)];
  const turrets = [roof({ x: 9, y: fortA.top, w: 2, mat: 'wood' }), roof({ x: 17, y: fortB.top, w: 2, mat: 'ice' })];
  const guard = stack({ x: 6.5, n: 2, kind: 'square', mat: 'stone' });
  // бункер-ниша между фортами: стены из каменных кубиков, крыша — каменная доска 2×0.5 (балка 4 м в проём 3 м не входит)
  const vault = part({
    blocks: [
      ...[12, 14].flatMap((x) => [0, 0.5, 1].map((y) => blockOn('stone', 'cube', x, y))),
      blockOn('stone', 'plank', 13, 1.5),
    ],
    spots: [{ x: 13, y: 0, w: 1.5, h: 1.5, kind: 'inside' }],
  });
  return level({
    id: '2-8',
    name: 'Два форта',
    birds: ['blues', 'chuck', 'hal', 'bomb', 'red'],
    slingshot: slingshotOn(0, MOUND),
    terrain: [flatGround(), slingHill(MOUND)],
    bounds: { minX: -14, maxX: 33 },
    parts: [guard, fortA, fortB, vault, ...turrets],
    blocks: [bridge, ...merlons, blockOn('ice', 'square', 12.5, fortA.top + 0.5), blockOn('ice', 'cube', 13.25, fortA.top + 0.5)],
    pigs: [
      pigIn('medium', fortA.spots[0]),
      pigIn('small', fortA.spots[2]),
      pigIn('small', fortB.spots[0]),
      pigIn('medium', fortB.spots[1]),
      pigIn('helmet', vault.spots[0]),
    ],
    stars: { one: 0, two: 32_000, three: 46_000 },
    meta: { nMin: 4, difficulty: 7, teach: 'две цели: порядок выстрелов, Hal по дальней башне с тыла, каска в бункере — Бомбу', starsSource: 'solver' },
    decor: [dec('shell', -3, MOUND), dec('grass', -6, MOUND), dec('rock', 20.5, 0, 0.9), dec('grass', 22.5), dec('shell', 25, 0, 1, true)],
  });
}

/**
 * 2-9 «Цепная реакция» · d 7 · N 4 (nMin 2)
 * Рогатка на насыпи 2 м. Скальный уступ 5.5…9.5 высотой 4.5 м, на нём каменный бункер (стены 1×2, крыша-балка) с
 * medium внутри и small на крыше. За уступом 4 TNT вдоль пола: первая (x = 11.5) стоит открыто — «запал», остальные в
 * двух двухэтажных сараях (низ — дерево, мансарда — лёд, крыши iso; x = 14 и 18) рядом со свиньями. Бункер выше
 * запала на 4.5 м: до него 4.5 м — цепочка его не берёт, нужен Бомб или яйцо Матильды.
 * Свиньи: 3 small, medium в сараях, medium и small у бункера. Учит: один точный выстрел в открытую TNT запускает цепочку.
 */
export function L2_9(): LevelDef {
  const LEDGE = 4.5;
  const bunk = bunker({ x: 7.5, y: LEDGE, inner: 2, h: 2, wallW: 1 });
  const shedA = frame({ x: 14 });
  const atticA = frame({ x: 14, y: shedA.top, col: 'ice', beam: 'ice' });
  const roofA = roof({ x: 14, y: atticA.top });
  const shedB = frame({ x: 18 });
  const atticB = frame({ x: 18, y: shedB.top, col: 'ice', beam: 'ice' });
  const roofB = roof({ x: 18, y: atticB.top });
  return level({
    id: '2-9',
    name: 'Цепная реакция',
    birds: ['red', 'matilda', 'chuck', 'bomb'],
    slingshot: slingshotOn(0, MOUND),
    terrain: [flatGround(), slingHill(MOUND), plateau(5.5, 9.5, LEDGE)],
    bounds: { maxX: 33 },
    parts: [bunk, shedA, atticA, roofA, shedB, atticB, roofB],
    tnt: [11.5, 13, 15, 17.25].map((x) => tntOn(x, 0)),
    pigs: [
      pigIn('medium', bunk.spots[0]),
      pigIn('small', bunk.spots[1]),
      pigOn('small', 14, 0),
      pigIn('small', atticA.spots[0]),
      pigOn('medium', 18.75, 0),
      pigIn('small', atticB.spots[0]),
    ],
    hint: 'Попадите в открытый ящик TNT — цепочка сделает остальное',
    stars: { one: 0, two: 45_000, three: 58_000 },
    meta: { nMin: 2, difficulty: 7, teach: 'открытый запал: цепочка TNT, бункер — для Bomb', starsSource: 'solver' },
    decor: [dec('shell', -3, MOUND), dec('sign', -6, MOUND), dec('rock', 22.5, 0, 0.6), dec('grass', 24), dec('shell', 26, 0, 1, true)],
  });
}

/**
 * 2-10 «Замок короля» (босс) · d 8 · N 6 (nMin 5)
 * Рогатка на насыпи 2 м. Плато plateau(7.5, 20.25, 1) с откосами (между ним и насыпью — ложбина: сбитые свиньи
 * остаются в ней, а не у рогатки); на нём замок на оси x = 14 (8–20):
 * - 1-й ярус — три каменных бункера (рамы span 4 из камня): helmet, mustache (в центре, под королём), helmet;
 * - 2-й ярус — три деревянные рамы, в крайних по small;
 * - 3-й ярус — ледяная зала на опорах по 3 м (квадрат 1×1 + колонна 0.5×2), проём 3×3 под king, перекрытие —
 *   каменная балка, сверху деревянная крыша 4×1.5 (верх 11);
 * - на крайних рамах 2-го яруса — малые крыши-башенки.
 * Свиньи: king, mustache, 2 helmet, 2 small. Учит: босс — королю нужно 2 тяжёлых попадания или взрыв ≤ 2.4 м.
 */
export function L2_10(): LevelDef {
  const X = 14;
  const bays1 = [X - 4, X, X + 4].map((x) => frame({ x, y: 1, col: 'stone', beam: 'stone' }));
  const bays2 = [X - 4, X, X + 4].map((x) => frame({ x, y: bays1[0].top }));
  const throne = hall({ x: X, y: bays2[0].top, baseMat: 'ice', colMat: 'ice', roofMat: 'stone' });
  const crown = roof({ x: X, y: throne.top, w: 4, mat: 'wood' });
  const turrets = [roof({ x: X - 4.5, y: bays2[0].top, w: 2, mat: 'wood' }), roof({ x: X + 4.5, y: bays2[2].top, w: 2, mat: 'wood' })];
  return level({
    id: '2-10',
    name: 'Замок короля',
    birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal'],
    slingshot: slingshotOn(0, MOUND),
    terrain: [flatGround(), slingHill(MOUND), plateau(7.5, 20.25, 1, { slope: [1.5, 1.5] })],
    bounds: { minX: -15, maxX: 33 },
    parts: [...bays1, ...bays2, ...turrets, throne, crown],
    pigs: [
      pigIn('king', throne.spots[0]),
      pigIn('mustache', bays1[1].spots[0]),
      pigIn('helmet', bays1[0].spots[0]),
      pigIn('helmet', bays1[2].spots[0]),
      pigIn('small', bays2[0].spots[0]),
      pigIn('small', bays2[2].spots[0]),
    ],
    hint: 'Король крепок: бейте взрывом или тяжёлым ударом сверху',
    stars: { one: 0, two: 38_000, three: 52_000 },
    meta: { nMin: 5, difficulty: 8, teach: 'босс: король под каменной крышей, все птицы эпизода', starsSource: 'solver' },
    decor: [dec('shell', -3, MOUND), dec('bush', -8, MOUND), dec('rock', 22.5, 0, 0.8), dec('grass', 24), dec('shell', 26, 0, 1.2, true)],
  });
}

export const EPISODE2_LEVELS: LevelDef[] = [L2_1(), L2_2(), L2_3(), L2_4(), L2_5(), L2_6(), L2_7(), L2_8(), L2_9(), L2_10()].map(calibrated);
