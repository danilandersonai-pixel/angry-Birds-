// Эпизод 3 «Снежные вершины» (snow): + Terence (3-1), лёд, лавина, пещера, Silver (3-6), рогатка на холме (3-7),
// финальный король (3-10). Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Общие соглашения эпизода:
// - рогатка в (0, 0) → ANCHOR (0, 2.7), кроме 3-7 (холм 3 м → ANCHOR (0, 5.7)); площадка очереди ровная;
// - цели (свиньи) на x = 16…34 м от основания; с Bomb — не дальше 32 м, цели Terence — не дальше 27 м и ниже его
//   огибающей (на x = 20 / 24 / 27: 8.2 / 5.1 / 2.3 м — Terence стреляет «в лоб», 00 §1.2);
// - доля материалов по числу блоков ≈ дерево 30 % / лёд 40 % / камень 30 % (06 §9.3), блоков 30–60, босс ≤ 80;
// - звёзды — черновая формула 06 §8.2 (draftStars внутри level()), meta.starsSource = 'manual':
//   пороги пересчитает калибратор на настоящем ядре.
// Декор: y — поверхность, на которой стоит предмет (рисуется рендером без физики).

import type { DecorDef, LevelDef, TerrainDef } from '../core/types';
import type { Part } from './prefabs';
import {
  blockOn,
  bunker,
  cage,
  flatGround,
  frame,
  hall,
  hill,
  hut,
  level,
  part,
  palisade,
  pier,
  pigIn,
  pigOn,
  pigOnBlock,
  plateau,
  profile,
  pyramid,
  roof,
  slingHill,
  slingshotOn,
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
 * Каменный «сэндвич» (3-6): две опоры и каменная доска 2×0.5 сверху, ячейка 1×1 под small.
 * legs 'square' — опоры 1×1 (ширина 3 м), 'brick' — вертикальные бруски 0.5×1 (ширина 2 м).
 * Доска 2×0.5 (2.2 кг, HP 59.4) — то, что пробивает пике Silver (×3.0 по камню); балку 4×0.5 (HP 118.8) пике не берёт.
 */
function sandwich(x: number, y: number, legs: 'square' | 'brick' = 'square'): Part {
  const off = legs === 'square' ? 1 : 0.75;
  const opts = legs === 'brick' ? { vertical: true } : {};
  const left = blockOn('stone', legs, x - off, y, opts);
  const right = blockOn('stone', legs, x + off, y, opts);
  const lid = blockOn('stone', 'plank', x, y + 1, { id: 'доска-сэндвича' });
  return part({ blocks: [left, right, lid], spots: [{ x, y, w: 1, h: 1, kind: 'inside' }] });
}

/**
 * 3-1 «Старший брат» · d 6 · N 3 (nMin 2) · ввод Terence
 * Два каменных бункера со стенами толщиной 1 м (вертикальные slab 1×2), проём 2×2 под large; оба на x ≤ 27
 * (досягаемость Terence). Ближний (x = 18) — ледяная балка, на ней ледяная будка с small; дальний (x = 24) — ледяная
 * балка и ледяной щипец. Позади на снежном уступе (1.5 м) — ледяная поленница, перед бункерами — каменный пенёк.
 * Terence навесом проламывает крышу и давит large (на ближнем — заодно и будку с small), настильным 13–26° валит
 * тяжёлую стену на свинью. Red камень не берёт: ему — будка и точный навес в ледяную крышу (решение двумя птицами).
 * Свиньи: 2 large в бункерах, small в будке на крыше ближнего. Учит: Terence ломает камень массой (5 кг).
 */
export function L3_1(): LevelDef {
  const near = bunker({ x: 18, inner: 2, h: 2, wallW: 1, mat: 'stone', roofMat: 'ice' });
  const booth = frame({ x: 18, y: near.top, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const boothRoof = roof({ x: 18, y: booth.top, w: 2, mat: 'ice' });
  const far = bunker({ x: 24, inner: 2, h: 2, wallW: 1, mat: 'stone', roofMat: 'ice' });
  const woodpile = pyramid({ x: 32.5, y: 1.5, rows: 3, mat: 'ice' });
  return level({
    id: '3-1',
    name: 'Старший брат',
    birds: ['terence', 'red', 'terence'],
    terrain: [flatGround(), plateau(30, 70, 1.5, { slope: [2.5, 0], kind: 'ground' })],
    parts: [near, booth, boothRoof, far, woodpile],
    blocks: [
      blockOn('ice', 'cube', 16.25, near.top),
      blockOn('ice', 'cube', 19.75, near.top),
      blockOn('stone', 'cube', 22.25, far.top),
      blockOn('stone', 'cube', 25.75, far.top),
      blockOn('stone', 'square', 13.5, 0, { id: 'пенёк' }),
    ],
    pigs: [pigIn('small', booth.spots[0]), pigIn('large', near.spots[0]), pigIn('large', far.spots[0])],
    hint: 'Теренс тяжёлый: он проломит бункер, а камень Реду не по зубам',
    meta: { nMin: 2, difficulty: 6, teach: 'Terence: масса 5 кг ломает камень, цели ближе (дальность 29 м)', starsSource: 'manual' },
    decor: [dec('pine', 4.5), dec('snowman', 8.5), dec('pine', 11.5, 0, 0.8), dec('sign', 21), dec('rock', 28.2, 0, 0.6), dec('pine', 36.5, 1.5, 1.2), dec('snowman', 39.5, 1.5, 0.9, true)],
  });
}

/**
 * 3-2 «Ледяной дворец» · d 6 · N 4 (nMin 3)
 * Дворец изо льда в три объёма: главная башня в 3 этажа (рамы 4×2.5, x = 26) на каменном цоколе (балка 5×0.5)
 * под ледяным щипцом, слева и справа двухэтажные крылья span 4 (x = 20.5 и 31.5) с ледяными скатными крышами;
 * между объёмами проходы по 1.5 м. Перекрытия 2-х этажей крыльев — деревянные (Blues по дереву слабы ×0.5).
 * Лёд на льду скользит (μ 0.25): выбитая колонна — и этажи съезжают. Blues колют лёд ×2.6, Chuck — рывком в крыло.
 * Свиньи: medium и small в башне (1-й и 3-й этаж), small на 2-м этаже левого крыла, medium и small в правом крыле.
 * Учит: лёд хрупкий и скользкий, Blues против льда.
 */
export function L3_2(): LevelDef {
  // цоколь — цельная каменная балка 5×0.5: свинья 1-го этажа не стоит на стыке (на стыке двух плит medium скатывается)
  const plinth = part({ blocks: [blockOn('stone', 'longBeam', 26, 0, { id: 'цоколь' })] });
  const keep = tower({ x: 26, y: 0.5, floors: 3, mats: 'ice', roof: 'ice' });
  const wingMats = [{ col: 'ice' as const, beam: 'wood' as const }, 'ice' as const];
  const wingL = tower({ x: 20.5, floors: 2, mats: wingMats, roof: { mat: 'ice', kind: 'tris' } });
  const wingR = tower({ x: 31.5, floors: 2, mats: wingMats, roof: { mat: 'ice', kind: 'tris' } });
  return level({
    id: '3-2',
    name: 'Ледяной дворец',
    birds: ['blues', 'blues', 'chuck', 'blues'],
    parts: [wingL, plinth, keep, wingR],
    pigs: [
      pigIn('medium', keep.spots[0]),
      pigIn('small', keep.spots[2]),
      pigIn('small', wingL.spots[1]),
      pigIn('medium', wingR.spots[0]),
      pigIn('small', wingR.spots[1]),
    ],
    hint: 'Лёд скользкий и хрупкий: Синие колют его лучше всех',
    meta: { nMin: 3, difficulty: 6, teach: 'ледяные конструкции: хрупкость и скольжение (μ 0.25), Blues против льда', starsSource: 'manual' },
    decor: [dec('pine', 3.5), dec('rock', 7.5, 0, 0.7), dec('snowman', 12), dec('pine', 16, 0, 0.9), dec('rock', 23.5, 0, 0.5), dec('pine', 36.5, 0, 1.1), dec('snowman', 40, 0, 0.9, true)],
  });
}

/**
 * 3-3 «Лавина» · d 7 · N 4 (nMin 2)
 * Снежный склон hill(8, 14, 19.5, 26.5, 4): подъём от рогатки 34° и скат 19.5 → 26.5 (≈ 30°) к домикам.
 * Наверху два каменных шара — малый ⌀1 (x = 15.22) и большой ⌀2 у кромки (x = 17.15) — в общей колыбели из ледяных
 * кубиков (x = 14.42 / 16.02 / 18.28). Толчок в шар (или выбитый стопор) — шар скатывается, разгоняется до ≈ 9 м/с
 * и таранит колонну у подножия; малый шар — «второй заход». Внизу ледяные постройки span 3: двухэтажный домик
 * (x = 28) и домик с деревянной крышей (x = 32); их балки сходятся над узким проулком (x = 30) — там прячется small.
 * Позади — каменная поленница. Свиньи: medium на 1-м и small на 2-м этаже домика, medium в дальнем домике,
 * small в проулке. Учит: косвенная атака — вызвать лавину.
 */
export function L3_3(): LevelDef {
  const slope = hill(8, 14, 19.5, 26.5, 4);
  const balls = part({
    blocks: [
      blockOn('stone', 'ball1', 15.22, 4, { id: 'шар-малый' }),
      blockOn('stone', 'ball2', 17.15, 4, { id: 'шар-большой' }),
      blockOn('ice', 'cube', 14.42, 4),
      // у шара ⌀2 кубик 0.5 касается его ниже экватора: стопоры ставим по зазору 0.01 до угла кубика, а не по экватору
      blockOn('ice', 'cube', 16.02, 4),
      blockOn('ice', 'cube', 18.28, 4, { id: 'стопор-у-кромки' }),
    ],
  });
  const lodge = tower({ x: 28, floors: 2, span: 3, mats: [{ col: 'ice', beam: 'wood' }, 'ice'], roof: 'ice' });
  const cabin = hut({ x: 32, span: 3, col: 'ice', beam: 'ice', roofMat: 'wood' });
  const pile = pyramid({ x: 36.5, rows: 2, mat: 'stone' });
  return level({
    id: '3-3',
    name: 'Лавина',
    birds: ['chuck', 'red', 'bomb', 'matilda'],
    terrain: [flatGround(), slope],
    parts: [balls, lodge, cabin, pile],
    pigs: [pigIn('medium', lodge.spots[0]), pigIn('small', lodge.spots[1]), pigIn('medium', cabin.spots[0]), pigOn('small', 30, 0)],
    hint: 'Столкните каменные шары со склона',
    meta: { nMin: 2, difficulty: 7, teach: 'лавина: шары со склона — косвенное убийство', starsSource: 'manual' },
    decor: [dec('pine', 3), dec('snowman', 6), dec('pine', 11, 3 * (4 / 6), 0.8), dec('rock', 21, 4 - 1.5 * (4 / 7), 0.6), dec('pine', 35, 0, 0.9), dec('rock', 40, 0, 1.1, true)],
  });
}

/**
 * 3-4 «Пещера» · d 7 · N 4 (nMin 3)
 * Скальный массив: потолок пещеры — скала x 24…34, y 4…5, задняя стена x = 34 и вершина-гребень справа.
 * Вход слева высотой 4 на x = 24 закрыт баррикадой: стопка 3 деревянных квадратов 1×1 (x = 24.5) + каменная колонна
 * 0.5×2 перед ней; над баррикадой щель 1 м. Внутри деревянная рама span 3 (x = 27.25: medium внутри, small на балке)
 * и узкая рама span 2 (x = 31.75: small). На потолке ледяной домик span 3 (x = 26, верх 9 при огибающей 10.4)
 * и каменный тур. Внутрь попадают только настильные выстрелы 10–18°: навес упирается в скалу.
 * Свиньи: medium + 2 small в пещере, small в домике наверху. Учит: настильный выстрел и мощь (Chuck, Terence).
 */
export function L3_4(): LevelDef {
  // невыпуклый массив: нижняя грань — потолок пещеры, справа стена и гребень (вершина 6.5)
  const massif: TerrainDef = {
    kind: 'rock',
    points: [
      [24, 4],
      [34, 4],
      [34, 0],
      [46, 0],
      [35.5, 6.5],
      [33, 5],
      [24, 5],
    ],
  };
  const barricade = stack({ x: 24.5, n: 2, kind: 'square', mat: 'wood' });
  const post = blockOn('stone', 'column', 23.75, 0, { id: 'каменная-стойка' });
  const shed = frame({ x: 27.25, span: 3, h: 2 });
  const nook = frame({ x: 31.75, span: 2, h: 2 });
  const lodge = hut({ x: 26, y: 5, span: 3, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const cairn = pyramid({ x: 30.5, y: 5, rows: 2, mat: 'stone' });
  return level({
    id: '3-4',
    name: 'Пещера',
    birds: ['chuck', 'terence', 'bomb', 'red'],
    terrain: [flatGround(), massif],
    parts: [barricade, shed, nook, lodge, cairn],
    blocks: [post],
    pigs: [pigIn('medium', shed.spots[0]), pigIn('small', shed.spots[1]), pigIn('small', nook.spots[0]), pigIn('small', lodge.spots[0])],
    hint: 'Стреляйте полого — навесом в пещеру не попасть',
    camera: { castle: { x: 28, y: 4, viewH: 15 } },
    meta: { nMin: 3, difficulty: 7, teach: 'пещера под скальным потолком: только настильные выстрелы 10–18° и мощь', starsSource: 'manual' },
    decor: [dec('pine', 3.5), dec('rock', 8, 0, 0.8), dec('snowman', 13), dec('pine', 18.5, 0, 0.9), dec('pine', 22.2, 0, 0.7, true), dec('pine', 29, 5, 0.7), dec('rock', 33.5, 5, 0.6)],
  });
}

/**
 * 3-5 «Три террасы» · d 7 · N 5 (nMin 4)
 * Скальные террасы ступенями: 18…23 на высоте 1.5, 23…28 на 3, 28…33 на 4 (один профиль рельефа).
 * Ближняя — ледяной домик span 4 (x = 20.5) с medium и small, средняя — деревянная башня в 2 этажа (x = 25.5,
 * верх 8) с large и small, дальняя — каменный бункер (x = 30.5, верх 6 при огибающей Red 7.0) с medium внутри
 * и small на крыше. Bomb дальнюю террасу не достаёт (огибающая 3.6) — она для Red, Hal и Matilda.
 * Обломки верхних террас сыплются на нижние. Свиньи: по 2 на террасу.
 * Учит: порядок целей ближняя → дальняя, какая птица куда долетает.
 */
export function L3_5(): LevelDef {
  const terraces = profile(
    [
      [14, 0],
      [18, 1.5],
      [23, 1.5],
      [23, 3],
      [28, 3],
      [28, 4],
      [33, 4],
      [39, 0],
    ],
    { bottom: -2, kind: 'rock' },
  );
  const igloo = hut({ x: 20.5, y: 1.5, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const keep = tower({ x: 25.5, y: 3, floors: 2 });
  const vault = bunker({ x: 30.5, y: 4, inner: 2, h: 1.5 });
  return level({
    id: '3-5',
    name: 'Три террасы',
    birds: ['red', 'hal', 'matilda', 'bomb', 'blues'],
    terrain: [flatGround(), terraces],
    parts: [igloo, keep, vault],
    blocks: [blockOn('ice', 'cube', 28.75, vault.top), blockOn('ice', 'cube', 32.25, vault.top)],
    pigs: [
      pigIn('medium', igloo.spots[0], -0.75),
      pigIn('small', igloo.spots[0], 0.9),
      pigIn('large', keep.spots[0]),
      pigIn('small', keep.spots[1]),
      pigIn('medium', vault.spots[0]),
      pigIn('small', vault.spots[1]),
    ],
    meta: { nMin: 4, difficulty: 7, teach: 'три яруса целей: порядок ближняя → дальняя, досягаемость птиц', starsSource: 'manual' },
    decor: [dec('pine', 3), dec('snowman', 7.5), dec('rock', 12, 0, 0.8), dec('pine', 16.5, 0.94, 0.7), dec('rock', 23.5, 3, 0.5), dec('pine', 34.5, 3.33, 0.8), dec('pine', 40.5, 0, 1.1, true)],
  });
}

/**
 * 3-6 «Серебряная петля» · d 7 · N 3 (nMin 2) · ввод Silver
 * Три каменных «сэндвича» — каменная доска 2×0.5 на двух каменных опорах, ячейка 1×1 под small (со всех сторон камень):
 * A на земле (x = 19, опоры 1×1), B и C — на ледяной полке (longBeam 5×0.5 на деревянных сваях 4 м, x = 25),
 * опоры у них — бруски 0.5×1; на доске C — medium. Пике Silver пробивает доску (×3.0 по камню) и давит small;
 * пике в щель между B и C (или Red в сваю) ломает полку — оба сэндвича и medium падают с 4.5 м.
 * Позади ледяная горка. Свиньи: 3 small под досками, medium на доске C. Учит: петля и пике Silver ломают камень сверху.
 */
export function L3_6(): LevelDef {
  const a = sandwich(19, 0);
  const piles = part({
    blocks: [
      blockOn('wood', 'column', 22.75, 0),
      blockOn('wood', 'column', 22.75, 2),
      blockOn('wood', 'column', 27.25, 0),
      blockOn('wood', 'column', 27.25, 2),
      blockOn('ice', 'longBeam', 25, 4, { id: 'ледяная-полка' }),
    ],
  });
  const b = sandwich(23.5, 4.5, 'brick');
  const c = sandwich(26.5, 4.5, 'brick');
  const lidC = c.blocks[2];
  const drift = pyramid({ x: 32, rows: 2, mat: 'ice' });
  return level({
    id: '3-6',
    name: 'Серебряная петля',
    birds: ['silver', 'silver', 'red'],
    parts: [a, piles, b, c, drift],
    pigs: [pigIn('small', a.spots[0]), pigIn('small', b.spots[0]), pigIn('small', c.spots[0]), pigOnBlock('medium', lidC, 0, { fragile: true })],
    hint: 'Коснитесь экрана над целью — Сильвер сделает петлю и ударит сверху',
    meta: { nMin: 2, difficulty: 7, teach: 'Silver: петля и пике пробивают каменную доску сверху', starsSource: 'manual' },
    decor: [dec('pine', 4), dec('snowman', 9), dec('rock', 14, 0, 0.7), dec('pine', 21, 0, 0.6), dec('rock', 29.5, 0, 0.6), dec('pine', 36, 0, 1.1), dec('snowman', 39, 0, 0.8, true)],
  });
}

/**
 * 3-7 «Крепость на утёсе» · d 8 · N 5 (nMin 4)
 * Рогатка на снежном холме: основание y = 3, ANCHOR (0, 5.7), площадка −10…+1.5, откос 34°. Огибающая поднята на 3 м.
 * Утёс plateau(25, 33, 4) с отвесной стеной к рогатке. На нём крепость: две башни span 3 в 2 этажа (x = 26.5 и 31.5;
 * 1-й этаж — каменные колонны и деревянная балка, 2-й — деревянные колонны и каменная балка, верх 9), между крышами
 * ледяной мост longBeam 5×0.5 (x = 29, опирание по 2 м) с medium. Под утёсом слева на земле деревянный домик (x = 21).
 * Слабые места: деревянные колонны 2-го этажа (тяжёлый верх) и ледяной мост.
 * Свиньи: 2 helmet на 1-х этажах, small на 2-м этаже левой башни, medium на мосту, small в домике.
 * Учит: высота рогатки меняет углы; дальность Red с холма 3 м ≈ 40.6 м.
 */
export function L3_7(): LevelDef {
  const mats = [{ col: 'stone' as const, beam: 'wood' as const }, { col: 'wood' as const, beam: 'stone' as const }];
  const towerL = tower({ x: 26.5, y: 4, floors: 2, span: 3, mats });
  const towerR = tower({ x: 31.5, y: 4, floors: 2, span: 3, mats });
  const bridge = blockOn('ice', 'longBeam', 29, towerL.top, { id: 'ледяной-мост' });
  const merlons = [blockOn('stone', 'cube', 24.75, towerL.top), blockOn('stone', 'cube', 33.25, towerR.top)];
  const house = hut({ x: 21 });
  return level({
    id: '3-7',
    name: 'Крепость на утёсе',
    birds: ['red', 'chuck', 'matilda', 'silver', 'bomb'],
    slingshot: slingshotOn(0, 3),
    terrain: [flatGround(), slingHill(3, { slope: 4.5 }), plateau(25, 33, 4, { slope: [0, 6] })],
    parts: [house, towerL, towerR],
    blocks: [bridge, ...merlons],
    pigs: [
      pigIn('helmet', towerL.spots[0]),
      pigIn('helmet', towerR.spots[0]),
      pigIn('small', towerL.spots[1]),
      pigOnBlock('medium', bridge),
      pigIn('small', house.spots[0]),
    ],
    hint: 'С холма птица летит дальше — целься ниже обычного',
    camera: { castle: { x: 27, y: 6, viewH: 17 } },
    meta: { nMin: 4, difficulty: 8, teach: 'рогатка на холме: другие углы, крепость на утёсе', starsSource: 'manual' },
    decor: [dec('pine', -6, 3), dec('snowman', -9, 3, 0.8), dec('pine', 9, 0, 0.9), dec('rock', 13, 0, 0.8), dec('pine', 17, 0, 1.1), dec('rock', 24, 0, 0.7), dec('pine', 35, 1.5, 0.8), dec('pine', 40, 0, 1.2, true)],
  });
}

/**
 * 3-8 «Ледяной мост» · d 8 · N 5 (nMin 4)
 * Утёсы plateau(11, 18, 4) и plateau(29.5, 35, 4), пропасть 11.5 м (дно y = 0, падение 4.5 м убивает small и medium).
 * Мост — 3 ледяные балки 4×0.5 (17.75–29.75, на утёсы по 0.25), стыки на ледяных сваях 0.5×4 (две колонны) x = 21.75
 * и 25.75. На мосту ледяной домик span 2 (x = 19.25) с small, 2 medium и каменный шар ⌀1 в колыбели между ними.
 * На левом утёсе каменный бункер (x = 16, ледяная крыша) с large — цель Terence (x ≤ 27); на правом — ледяная
 * сторожка в 2 этажа (x = 32.5) с small. Слабые места: ледяные сваи (Chuck, Hal снизу) и шар (толчок — катится по мосту).
 * Свиньи: 2 medium на мосту, small в домике, small в сторожке, large в бункере.
 * Учит: обрушить мост вместо пробивания каждой свиньи; Terence — на каменный бункер.
 */
export function L3_8(): LevelDef {
  const piles = [21.75, 25.75].flatMap((x) => [blockOn('ice', 'column', x, 0), blockOn('ice', 'column', x, 2)]);
  const deck = [19.75, 23.75, 27.75].map((x, i) => blockOn('ice', 'beam', x, 4, { id: `мост-${i + 1}` }));
  const booth = hut({ x: 19.25, y: 4.5, span: 2, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const ball = cradleOn(23.75, 4.5);
  const vault = bunker({ x: 16, y: 4, inner: 2, h: 2, roofMat: 'ice' });
  const vaultRoof = roof({ x: 16, y: vault.top, w: 4, mat: 'ice' });
  const lookout = tower({ x: 32.5, y: 4, floors: 2, span: 2, mats: 'ice', roof: { mat: 'ice', w: 2 } });
  return level({
    id: '3-8',
    name: 'Ледяной мост',
    birds: ['blues', 'hal', 'chuck', 'terence', 'red'],
    terrain: [flatGround(), plateau(11, 18, 4, { slope: [6, 0] }), plateau(29.5, 35, 4, { slope: [0, 6] })],
    parts: [vault, vaultRoof, part({ blocks: [...piles, ...deck] }), booth, ball, lookout],
    blocks: [blockOn('ice', 'square', 29.25, 4.5)],
    pigs: [pigIn('large', vault.spots[0]), pigIn('small', booth.spots[0]), pigOn('medium', 20.9, 4.5), pigOn('medium', 26.6, 4.5), pigIn('small', lookout.spots[0])],
    hint: 'Сломайте сваю — мост рухнет в пропасть',
    meta: { nMin: 4, difficulty: 8, teach: 'ледяной мост над пропастью: обрушение вместо точечных попаданий', starsSource: 'manual' },
    decor: [dec('pine', 3), dec('snowman', 7), dec('pine', 12.2, 4, 0.8), dec('rock', 23.5, 0, 0.9), dec('pine', 35.5, 4, 0.7), dec('pine', 40, 0, 1.1, true)],
  });
}

/** Шар ⌀1 из камня в колыбели из ледяных кубиков (зазор 0.05) на поверхности y. */
function cradleOn(x: number, y: number): Part {
  return part({
    blocks: [blockOn('stone', 'ball1', x, y, { id: 'шар' }), blockOn('ice', 'cube', x - 0.8, y), blockOn('ice', 'cube', x + 0.8, y)],
  });
}

/**
 * 3-9 «Склад на льду» · d 9 · N 5 (nMin 4)
 * Три части склада, ящики разнесены так, что взрыв одной части не поджигает другую (центр взрыва → чужая свинья ≥ 3 м):
 * - левый и правый каменные бункеры span 4 (x = 17 и 32): в каждом medium и TNT у наружной стены; на крыше helmet
 *   у каменного зубца — в 2.5 м от своего ящика (радиус гибели каски от TNT 2.37: нижний взрыв её не берёт);
 * - в центре штабель на ледяном помосте (5 ледяных квадратов, x = 22…27): 3 TNT через 1 м (цепочка гарантирована),
 *   между ними 2 small, третий small у подножия. Помост разбит — ящики падают с 1 м и тоже рвутся.
 * Каждой части — свой «ключ»: Bomb или яйцо Matilda поджигают ящик в бункере сквозь камень, любой удар в штабель —
 * цепочку; каски на крышах переживают взрывы под собой — их добивают прямым ударом (пике Silver, Chuck, Hal).
 * Свиньи: 2 helmet, 2 medium, 3 small. Учит: управляемая цепочка TNT — какой ящик и когда поджечь.
 */
export function L3_9(): LevelDef {
  const vaultL = bunker({ x: 17, inner: 3, h: 2 });
  const vaultR = bunker({ x: 32, inner: 3, h: 2 });
  const dock = palisade({ x: 24.5, n: 5, kind: 'square', mat: 'ice' });
  // зубцы: ледяные снаружи, каменные у касок (стенка ≤ 0.3 м — каска не скатится с крыши)
  const merlons = [
    blockOn('ice', 'cube', 15.25, vaultL.top),
    blockOn('stone', 'cube', 18.75, vaultL.top),
    blockOn('stone', 'cube', 30.25, vaultR.top),
    blockOn('ice', 'cube', 33.75, vaultR.top),
  ];
  const stash = pyramid({ x: 38, rows: 3, mat: 'ice' });
  return level({
    id: '3-9',
    name: 'Склад на льду',
    birds: ['bomb', 'silver', 'matilda', 'chuck', 'hal'],
    parts: [vaultL, dock, vaultR, stash],
    blocks: [...merlons, blockOn('wood', 'square', 13.5, 0), blockOn('wood', 'cube', 13.5, 1)],
    tnt: [tntOn(16.1, 0), tntOn(22.5, 1), tntOn(24.5, 1), tntOn(26.5, 1), tntOn(32.9, 0)],
    pigs: [
      pigOn('medium', 17.85, 0),
      pigOn('helmet', 17.8, vaultL.top),
      pigOn('small', 21.3, 0),
      pigOn('small', 23.5, 1),
      pigOn('small', 25.5, 1),
      pigOn('medium', 31.15, 0),
      pigOn('helmet', 31.2, vaultR.top),
    ],
    hint: 'У каждой части склада свой ящик: подожгите их по очереди',
    camera: { castle: { x: 24.5, y: 2.5, viewH: 12 } },
    meta: { nMin: 4, difficulty: 9, teach: 'управляемая цепочка TNT: штабель и изолированные ящики в бункерах', starsSource: 'manual' },
    decor: [dec('pine', 3), dec('snowman', 7), dec('sign', 11), dec('pine', 35.5, 0, 0.8), dec('pine', 42, 0, 1.1), dec('snowman', 45, 0, 0.9, true)],
  });
}

/**
 * 3-10 «Цитадель короля» (финал) · d 10 · N 8 (nMin 6)
 * - ледяная стена: 4 квадрата 1×1 столбом на x = 15;
 * - левая сторожевая башня (x = 17.5, span 2, 2 этажа дерево/лёд, small) и правая (x = 31, span 3, лёд, medium);
 * - цитадель на плато plateau(20, 28, 1): 1-й ярус — два каменных бункера span 4 (helmet в каждом, в левом ещё TNT),
 *   2-й ярус — рамы span 4 (дерево: mustache, лёд: medium), 3-й — зала короля на каменных опорах по 3 м,
 *   перекрытие — каменная балка и две плиты 2×1 (верх 10.5 при огибающей 11.8). По бокам залы на 2-м ярусе — каменные
 *   шары ⌀1 в колыбелях (стопор-кубик + опора залы): сбитый стопор — шар падает с 6 м, выбитая опора — шар катится на короля;
 * - 2 TNT у подножия плато (x = 19.5 и 28.5) — ключи к бункерам.
 * Свиньи: king, mustache, 2 helmet, 2 medium, 2 small. Учит: финал — каждой птице своя цель; король — 2 тяжёлых удара.
 */
export function L3_10(): LevelDef {
  const iceWall = stack({ x: 15, n: 4, kind: 'square', mat: 'ice' });
  const watchL = tower({ x: 17.5, floors: 2, span: 2, mats: ['wood', 'ice'], roof: { mat: 'wood', w: 2 } });
  const vaultL = bunker({ x: 22, y: 1, inner: 3, h: 2 });
  const vaultR = bunker({ x: 26, y: 1, inner: 3, h: 2 });
  const galleryL = frame({ x: 22, y: vaultL.top, span: 4, h: 2, col: 'stone', beam: 'stone' });
  const galleryR = frame({ x: 26, y: vaultR.top, span: 4, h: 2, col: 'stone', beam: 'stone' });
  // пол залы — каменная балка 5×0.5 поперёк стыка балок галереи (король не стоит на стыке — на стыке он скатывается)
  const floor3 = blockOn('stone', 'longBeam', 24, galleryL.top, { id: 'пол-залы' });
  const throne = hall({ x: 24, y: galleryL.top + 0.5, baseMat: 'stone', colMat: 'stone', roofMat: 'stone' });
  const crown = part({ blocks: [blockOn('stone', 'slab', 23, throne.top), blockOn('stone', 'slab', 25, throne.top)] });
  const y2 = galleryL.top;
  const balls = part({
    blocks: [
      blockOn('stone', 'ball1', 21, y2, { id: 'шар-левый' }),
      blockOn('stone', 'cube', 20.25, y2, { id: 'стопор-левый' }),
      blockOn('stone', 'ball1', 27, y2, { id: 'шар-правый' }),
      blockOn('stone', 'cube', 27.75, y2, { id: 'стопор-правый' }),
    ],
  });
  const watchR = tower({ x: 31, floors: 2, span: 3, mats: 'ice', roof: 'ice' });
  return level({
    id: '3-10',
    name: 'Цитадель короля',
    birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'],
    terrain: [flatGround(), plateau(20, 28, 1)],
    parts: [iceWall, watchL, vaultL, vaultR, galleryL, galleryR, part({ blocks: [floor3] }), throne, crown, balls, watchR],
    // ящики: перед ледяной стеной (цель Red — снести стену и левую башню) и в обоих бункерах у наружной стены
    // (ключ к каскам: Bomb, яйцо, Terence). Под краями 2-го яруса ящиков нет — падающие шары их не подожгут.
    tnt: [tntOn(13.5, 0), tntOn(21, 1), tntOn(27, 1)],
    pigs: [
      pigIn('king', throne.spots[0]),
      pigIn('mustache', galleryL.spots[0]),
      pigIn('medium', galleryR.spots[0]),
      pigOn('helmet', 22.85, 1),
      pigOn('helmet', 25.15, 1),
      pigIn('small', watchL.spots[1]),
      pigIn('medium', watchR.spots[0]),
      pigIn('small', watchR.spots[1]),
    ],
    hint: 'Король крепок: бейте взрывом, Теренсом или пике Сильвера',
    camera: { castle: { x: 24, y: 5.5, viewH: 18 } },
    meta: { nMin: 6, difficulty: 10, teach: 'финал: все птицы, каждой своя цель; король под каменной крышей', starsSource: 'manual' },
    decor: [dec('pine', 2.5), dec('snowman', 6), dec('pine', 10, 0, 1.1), dec('sign', 12.5), dec('rock', 29.5, 0, 0.6), dec('pine', 35, 0, 1.2), dec('snowman', 38.5, 0, 1, true), dec('pine', 42, 0, 0.9)],
  });
}

export const EPISODE3_LEVELS: LevelDef[] = [L3_1(), L3_2(), L3_3(), L3_4(), L3_5(), L3_6(), L3_7(), L3_8(), L3_9(), L3_10()];
void cage;
void pier;
