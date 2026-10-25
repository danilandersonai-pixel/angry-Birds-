// Эпизод 3 «Снежные вершины» (snow): + Terence (3-1), лёд, лавина, пещера, Silver (3-6), рогатка на холме (3-7),
// финальный король (3-10). Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Общие соглашения эпизода:
// - рогатка в (0, 0) → ANCHOR (0, 2.7), кроме 3-7 (холм 3 м → ANCHOR (0, 5.7)); площадка очереди ровная;
// - V_MAX 21 м/с (06 §2: зона 16…34 при V 24 × (21/24)²): сооружения на x ≈ 8…25 м — правый край всего контента
//   ≤ 25 м, ближайшие цели от ≈ 11 м, верх ≤ 11 м; вид рогатки крупный (Ред ≥ 40 px на 1600×900, ≥ 22 px на 844×390).
//   Огибающая (высота центра птицы) над x = 15 / 18 / 20 / 22 / 24: Red 11.1 / 9.3 / 7.9 / 6.4 / 4.8 м, Bomb 9.2 /
//   7.2 / 5.7 / 4.0 / 2.2, Matilda 10.0 / 8.1 / 6.6 / 5.0 / 3.2, Terence 6.5 / 4.2 / 2.4 / 0.4 / — (дальность ≈ 21.6 м):
//   цели Terence — не дальше ≈ 19 м и низко, высокое — ближе к рогатке, у правого края — не выше 4–6 м;
// - bounds.maxX = правый край контента + 12 (на уровнях с Хэлом — + 13 под разворот бумеранга);
// - доля материалов по числу блоков ≈ дерево 30 % / лёд 40 % / камень 30 % (06 §9.3), тел 30–60, босс ≤ 80;
// - звёзды — по эксперту на настоящем ядре: suggestStars (06 §8.2, 3★ не выше счёта эксперта) по итогу
//   scripts/level-report.ts --solve (тапы Silver у решателя 0.5…1.7 с — петля успевает выйти на цель);
//   meta.starsSource = 'solver', в meta.calib — птиц и счёт эксперта, время решателя;
// - ни один уровень не проходится одной птицей; итог решателя чувствителен к мелочам (сдвиг одного блока на 0.5 м
//   меняет число птиц эксперта на ±1) — значения в calib сняты на итоговой геометрии.
// Камера (вид рогатки, облёт) считает кадр сама по габариту контента — level.camera не задаём.
// Декор: y — поверхность, на которой стоит предмет (рисуется рендером без физики).

import type { DecorDef, LevelDef, TerrainDef } from '../core/types';
import type { Part } from './prefabs';
import {
  blockOn,
  bunker,
  flatGround,
  frame,
  hall,
  hill,
  hut,
  level,
  part,
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
 * Этаж каменного «донжона» (3-1, 3-8): бункер с кладкой стен из каменных квадратов 1×1 (стена 1 м толщиной, 2 м
 * высотой — два квадрата друг на друге), проём 2×2 под large, перекрытие — балка 4×0.5 (лёд или камень). Квадрат (HP 59.4)
 * Теренс разбивает прямым ударом, а цельную плиту 1×2 (HP 119) — нет: кладка показывает, что камень ему по силам.
 * spots: [0] — внутри, [1] — на перекрытии.
 */
function keepFloor(x: number, y: number, roofMat: 'ice' | 'stone' = 'ice'): Part {
  const shell = bunker({ x, y, inner: 2, h: 2, wallW: 1, mat: 'stone', roofMat });
  const walls = [x - 1.5, x + 1.5].flatMap((wx) => [blockOn('stone', 'square', wx, y), blockOn('stone', 'square', wx, y + 1)]);
  return { ...shell, blocks: [...walls, shell.blocks[shell.blocks.length - 1]] };
}

/** Шар ⌀1 из камня в колыбели из ледяных кубиков (зазор 0.05) на поверхности y. */
function cradleOn(x: number, y: number): Part {
  return part({
    blocks: [blockOn('stone', 'ball1', x, y, { id: 'шар' }), blockOn('ice', 'cube', x - 0.8, y), blockOn('ice', 'cube', x + 0.8, y)],
  });
}

/**
 * 3-1 «Старший брат» · d 6 · N 3 (nMin 2) · ввод Terence
 * Каменный донжон в два этажа на x = 15 (огибающая Terence 6.5 — верхняя large на 3.3 ему по силам): два бункера друг
 * на друге, стены — кладка каменных квадратов толщиной 1 м, перекрытия ледяные, сверху ледяной щипец; в каждом этаже
 * large. По бокам ледяные пристройки (сторожка со щипцом слева, рама с зубцами справа), впереди каменный пенёк.
 * small — в ледяной будке на снежном уступе (x = 23.25, 1.5 м): Теренсу туда не долететь (дальность ≈ 21.6 м) — это
 * цель Реда. Решение двумя птицами: Теренс настильным ударом проламывает кладку и перекрытие — оба large, Ред — будку.
 * Red камень не берёт, а промах Теренса добирает второй Теренс. Отступление от 06 §10: вместо двух бункеров рядом —
 * два бункера друг на друге (с двумя бункерами рядом одним Теренсом обе large не взять — уровень требовал всех 3 птиц).
 * Свиньи: 2 large в донжоне, small в будке. Учит: Terence ломает камень массой (5 кг), цели ему — поближе.
 */
export function L3_1(): LevelDef {
  const f1 = keepFloor(15, 0);
  const f2 = keepFloor(15, f1.top);
  const gable = roof({ x: 15, y: f2.top, w: 4, mat: 'ice' });
  const lodge = frame({ x: 11.25, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const lodgeRoof = roof({ x: 11.25, y: lodge.top, w: 2, mat: 'ice' });
  const wing = frame({ x: 18.75, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const ledge = 1.5;
  const booth = hut({ x: 23.25, y: ledge, span: 2, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '3-1',
    name: 'Старший брат',
    birds: ['terence', 'red', 'terence'],
    terrain: [flatGround(), plateau(22, 60, ledge, { slope: [2.2, 0], kind: 'ground' })],
    bounds: { maxX: 37 },
    parts: [lodge, lodgeRoof, f1, f2, gable, wing, booth],
    blocks: [
      blockOn('ice', 'cube', 18.25, wing.top),
      blockOn('ice', 'cube', 19.25, wing.top),
      blockOn('stone', 'square', 8.5, 0, { id: 'пенёк' }),
      blockOn('ice', 'cube', 8.5, 1),
    ],
    pigs: [pigIn('large', f1.spots[0]), pigIn('large', f2.spots[0]), pigIn('small', booth.spots[0])],
    hint: 'Теренс тяжёлый: он проломит каменную кладку, а камень Реду не по зубам',
    stars: { one: 0, two: 21_000, three: 33_000 },
    meta: { nMin: 2, difficulty: 6, teach: 'Terence: масса 5 кг ломает камень, цели ближе (дальность ≈ 21.6 м)', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 34255, solverSec: 3.3, evaluations: 248 } },
    decor: [dec('pine', 2.8), dec('snowman', 5.6), dec('pine', 7, 0, 0.8), dec('sign', 9.9, 0, 0.9), dec('rock', 20.6, 0, 0.6), dec('pine', 25.6, ledge, 0.8), dec('pine', 28, ledge, 1.2), dec('snowman', 30.5, ledge, 0.9, true)],
  });
}

/**
 * 3-2 «Ледяной дворец» · d 6 · N 4 (nMin 3)
 * Дворец изо льда в три объёма: главная башня в 3 этажа (рамы 4×2.5, x = 18.5) на каменном цоколе (балка 5×0.5) под
 * ледяным щипцом — верх 9.5, слева двухэтажное ледяное крыло span 3 (x = 13.5), справа крыло span 3 (x = 23) с
 * деревянным перекрытием 1-го этажа; у крыльев скатные крыши из ледяных треугольников. Перед дворцом ледяные ворота с
 * зубцами. 1-й этаж башни на каменных колоннах: настильный залп Синих, прошедший сквозь левое крыло, башню целиком не
 * роняет. Лёд на льду скользит (μ 0.25): выбитая колонна — и этажи съезжают. Blues колют лёд ×2.6, Chuck — рывком.
 * Свиньи: medium и small в башне (1-й и 3-й этаж), small на 2-м этаже левого крыла, medium и small в правом крыле.
 * Эксперт решает двумя птицами (как и до сжатия): Синие против льда очень сильны — настильный залп роняет левое крыло
 * и башню. Крепче башня (каменные колонны 2-го этажа, деревянные балки) — хуже: тяжёлая башня, падая, сносит всё.
 * Учит: лёд хрупкий и скользкий, Blues против льда.
 */
export function L3_2(): LevelDef {
  // цоколь — цельная каменная балка 5×0.5: свинья 1-го этажа не стоит на стыке (на стыке двух плит medium скатывается)
  const plinth = part({ blocks: [blockOn('stone', 'longBeam', 18.5, 0, { id: 'цоколь' })] });
  const keep = tower({ x: 18.5, y: 0.5, floors: 3, mats: [{ col: 'stone', beam: 'ice' }, 'ice', 'ice'], roof: 'ice' });
  const wingL = tower({ x: 13.5, floors: 2, span: 3, mats: 'ice', roof: { mat: 'ice', w: 4, kind: 'tris' } });
  const wingR = tower({ x: 23, floors: 2, span: 3, mats: [{ col: 'ice', beam: 'wood' }, 'ice'], roof: { mat: 'ice', w: 4, kind: 'tris' } });
  const gate = frame({ x: 9.5, span: 2, h: 2, col: 'ice', beam: 'ice' });
  return level({
    id: '3-2',
    name: 'Ледяной дворец',
    birds: ['blues', 'blues', 'chuck', 'blues'],
    bounds: { maxX: 37 },
    parts: [gate, wingL, plinth, keep, wingR],
    blocks: [blockOn('ice', 'cube', 8.75, gate.top), blockOn('ice', 'cube', 10.25, gate.top)],
    pigs: [
      pigIn('medium', keep.spots[0]),
      pigIn('small', keep.spots[2]),
      pigIn('small', wingL.spots[1]),
      pigIn('medium', wingR.spots[0]),
      pigIn('small', wingR.spots[1]),
    ],
    hint: 'Лёд скользкий и хрупкий: Синие колют его лучше всех',
    stars: { one: 0, two: 32_000, three: 45_000 },
    meta: { nMin: 3, difficulty: 6, teach: 'ледяные конструкции: хрупкость и скольжение (μ 0.25), Blues против льда', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 64322, solverSec: 7.7, evaluations: 462 } },
    decor: [dec('pine', 2.5), dec('rock', 5, 0, 0.7), dec('snowman', 6.8), dec('pine', 26.5, 0, 1.1), dec('snowman', 29, 0, 0.9, true)],
  });
}

/**
 * 3-3 «Лавина» · d 7 · N 4 (nMin 2)
 * Снежный склон hill(1, 6, 11, 17, 3.5): подъём от рогатки 35° и скат 11 → 17 (≈ 30°) к домикам.
 * Наверху два каменных шара — малый ⌀1 (x = 7.15) и большой ⌀2 у кромки (x = 9.08) — в общей колыбели из ледяных
 * кубиков (x = 6.35 / 7.95 / 10.21). Толчок в шар (или выбитый стопор) — шар скатывается, разгоняется и таранит
 * колонну у подножия; малый шар — «второй заход». Внизу ледяные постройки span 3: домик с деревянной крышей у
 * подножия (x = 18.75) и двухэтажный домик (x = 23) на скальной ступени 1 м; их балки сходятся над узким проулком
 * (x = 20.75) — там прячется small. Шар сносит ближний домик и проулок, а ступень его останавливает: дальний домик —
 * для второй птицы (с обоими домиками на земле шар один сносил всё — уровень решался одной птицей).
 * Свиньи: medium в ближнем домике, small в проулке, medium на 1-м и small на 2-м этаже дальнего домика.
 * Учит: косвенная атака — вызвать лавину.
 */
export function L3_3(): LevelDef {
  const slope = hill(1, 6, 11, 17, 3.5);
  const balls = part({
    blocks: [
      blockOn('stone', 'ball1', 7.15, 3.5, { id: 'шар-малый' }),
      blockOn('stone', 'ball2', 9.08, 3.5, { id: 'шар-большой' }),
      blockOn('ice', 'cube', 6.35, 3.5),
      // у шара ⌀2 кубик 0.5 касается его ниже экватора: стопоры ставим по зазору 0.01 до угла кубика, а не по экватору
      blockOn('ice', 'cube', 7.95, 3.5),
      blockOn('ice', 'cube', 10.21, 3.5, { id: 'стопор-у-кромки' }),
    ],
  });
  // двухэтажный домик — на скальной ступени 1 м: шар, разрушив ближний домик, упирается в ступень
  const step = 1;
  const cabin = hut({ x: 18.75, span: 3, col: 'ice', beam: 'ice', roofMat: 'wood' });
  const lodge = tower({ x: 23, y: step, floors: 2, span: 3, mats: [{ col: 'ice', beam: 'wood' }, 'ice'], roof: 'ice' });
  return level({
    id: '3-3',
    name: 'Лавина',
    birds: ['chuck', 'red', 'bomb', 'matilda'],
    terrain: [flatGround(), slope, plateau(21.25, 26, step, { slope: [0, 1.5] })],
    bounds: { maxX: 37 },
    parts: [balls, cabin, lodge],
    pigs: [pigIn('medium', cabin.spots[0]), pigOn('small', 20.75, 0), pigIn('medium', lodge.spots[0]), pigIn('small', lodge.spots[1])],
    hint: 'Столкните каменные шары со склона',
    stars: { one: 0, two: 34_000, three: 45_000 },
    meta: { nMin: 2, difficulty: 7, teach: 'лавина: шары со склона — косвенное убийство', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 48757, solverSec: 4.0, evaluations: 404 } },
    decor: [dec('pine', 3.4, 3.5 * (2.4 / 5), 0.7), dec('pine', 13, 3.5 * (4 / 6), 0.8), dec('rock', 15.6, 3.5 * (1.4 / 6), 0.6), dec('pine', 26.9, 0, 0.9), dec('rock', 28.6, 0, 1.1, true)],
  });
}

/**
 * 3-4 «Пещера» · d 7 · N 4 (nMin 3)
 * Скальный массив: потолок пещеры — скала x 12.5…22, y 4…5, задняя стена x = 22 и вершина-гребень справа.
 * Вход слева высотой 4 на x = 12.5 закрыт баррикадой: стопка 2 деревянных квадратов 1×1 (x = 13) + каменная колонна
 * 0.5×2 перед ней. Внутри деревянная рама span 3 (x = 15.75: medium внутри, small на балке между деревянными
 * кубиками), узкая рама span 2 (x = 19.8: small) и деревянные ящики в проходе и у задней стены.
 * На потолке ледяная вышка в 2 этажа над входом (x = 13.5), ледяной домик span 3 (x = 17, small) и каменный тур (x = 20.25).
 * Внутрь попадают только настильные выстрелы ≈ 10–20°: навес упирается в скалу; домик наверху — цель навеса.
 * Пещера ближе, чем в 06 §10 (вход 12.5 вместо 24): Terence с дальностью 21.6 м достаёт до задней стены.
 * Свиньи: medium + 2 small в пещере, small в домике наверху. Учит: настильный выстрел и мощь (Chuck, Terence).
 */
export function L3_4(): LevelDef {
  // невыпуклый массив: нижняя грань — потолок пещеры, справа стена и гребень (вершина 6.5)
  const massif: TerrainDef = {
    kind: 'rock',
    points: [
      [12.5, 4],
      [22, 4],
      [22, 0],
      [33.5, 0],
      [24, 6.5],
      [21.5, 5],
      [12.5, 5],
    ],
  };
  const barricade = stack({ x: 13, n: 2, kind: 'square', mat: 'wood' });
  const post = blockOn('stone', 'column', 12.25, 0, { id: 'каменная-стойка' });
  const shed = frame({ x: 15.75, span: 3, h: 2 });
  const nook = frame({ x: 19.8, span: 2, h: 2 });
  // высокая вышка — слева (над входом), домик — правее: справа сверху HUD, высокое там не ставим
  const lodge = hut({ x: 17, y: 5, span: 3, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const watch = tower({ x: 13.5, y: 5, floors: 2, span: 2, mats: 'ice' });
  const cairn = pyramid({ x: 20.25, y: 5, rows: 2, mat: 'stone' });
  // ящики в пещере (в проходе между рамами и у задней стены) и зубцы на балке рамы
  const crates = [
    blockOn('wood', 'square', 18.25, 0),
    blockOn('wood', 'square', 18.25, 1),
    blockOn('wood', 'square', 21.5, 0),
    blockOn('wood', 'square', 21.5, 1),
    blockOn('wood', 'cube', 21.25, 2),
    blockOn('wood', 'cube', 14.75, shed.top),
    blockOn('wood', 'cube', 16.75, shed.top),
  ];
  const watchTop = [blockOn('ice', 'cube', 12.75, watch.top), blockOn('ice', 'cube', 14.25, watch.top), blockOn('ice', 'brick', 13.5, watch.top)];
  return level({
    id: '3-4',
    name: 'Пещера',
    birds: ['chuck', 'terence', 'bomb', 'red'],
    terrain: [flatGround(), massif],
    bounds: { maxX: 36 },
    parts: [barricade, shed, nook, lodge, watch, cairn],
    blocks: [post, ...crates, ...watchTop],
    pigs: [pigIn('medium', shed.spots[0]), pigIn('small', shed.spots[1]), pigIn('small', nook.spots[0]), pigIn('small', lodge.spots[0])],
    hint: 'Стреляйте полого — навесом в пещеру не попасть',
    stars: { one: 0, two: 27_000, three: 40_000 },
    meta: { nMin: 3, difficulty: 7, teach: 'пещера под скальным потолком: только настильные выстрелы и мощь', starsSource: 'solver', calib: { expertBirds: 3, expertScore: 48019, solverSec: 8.9, evaluations: 673 } },
    decor: [dec('pine', 2.5), dec('rock', 5, 0, 0.8), dec('snowman', 7.5), dec('pine', 9.8, 0, 0.9), dec('rock', 21.3, 5.15, 0.5), dec('pine', 25.5, 4.6, 0.7), dec('pine', 31, 0, 1.1, true)],
  });
}

/**
 * 3-5 «Три террасы» · d 7 · N 5 (nMin 4)
 * Скальные террасы ступенями: 11…16 на высоте 1, 16…20.5 на 2, 20.5…25 на 3 (один профиль рельефа).
 * Ближняя — ледяной домик span 4 (x = 13.75) с medium и small, средняя — деревянная башня в 2 этажа (x = 18.25,
 * верх 9 при огибающей Red 9.3) под деревянной скатной крышей с large и small, дальняя — каменный бункер (x = 22.75,
 * верх 5 при огибающей Red 6.0) с medium внутри и small на крыше между ледяными зубцами. У уступов — ступени из
 * ледяных и деревянных кубиков, за бункером каменный кубик с ледяным столбиком. Bomb в бункер дальней террасы не
 * попадает (огибающая 3.4 ниже medium) — она для Red, Hal и Matilda. Обломки верхних террас сыплются на нижние.
 * Свиньи: по 2 на террасу. Учит: порядок целей ближняя → дальняя, какая птица куда долетает.
 */
export function L3_5(): LevelDef {
  const terraces = profile(
    [
      [8.5, 0],
      [11, 1],
      [16, 1],
      [16, 2],
      [20.5, 2],
      [20.5, 3],
      [25, 3],
      [29.5, 0],
    ],
    { bottom: -2, kind: 'rock' },
  );
  const igloo = hut({ x: 13.75, y: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const keep = tower({ x: 18.25, y: 2, floors: 2, roof: { mat: 'wood', kind: 'tris' } });
  const vault = bunker({ x: 22.75, y: 3, inner: 2, h: 1.5 });
  // ступени у уступов и зубцы бункера
  const steps = [
    blockOn('ice', 'cube', 11.25, 1),
    blockOn('ice', 'cube', 11.25, 1.5),
    blockOn('wood', 'cube', 20.75, 3),
    blockOn('wood', 'cube', 20.75, 3.5),
    blockOn('stone', 'cube', 24.6, 3),
    blockOn('ice', 'brick', 24.6, 3.5, { vertical: true }),
  ];
  return level({
    id: '3-5',
    name: 'Три террасы',
    birds: ['red', 'hal', 'matilda', 'bomb', 'blues'],
    terrain: [flatGround(), terraces],
    bounds: { maxX: 38 },
    parts: [igloo, keep, vault],
    blocks: [blockOn('ice', 'cube', 21.5, vault.top), blockOn('ice', 'cube', 24, vault.top), ...steps],
    pigs: [
      pigIn('medium', igloo.spots[0], -0.75),
      pigIn('small', igloo.spots[0], 0.9),
      pigIn('large', keep.spots[0]),
      pigIn('small', keep.spots[1]),
      pigIn('medium', vault.spots[0]),
      pigIn('small', vault.spots[1]),
    ],
    stars: { one: 0, two: 36_000, three: 48_000 },
    meta: { nMin: 4, difficulty: 7, teach: 'три яруса целей: порядок ближняя → дальняя, досягаемость птиц', starsSource: 'solver', calib: { expertBirds: 4, expertScore: 56461, solverSec: 32.7, evaluations: 1456 } },
    decor: [dec('pine', 2.5), dec('snowman', 5.5), dec('pine', 9.7, 0.52, 0.7), dec('rock', 26.1, 1.68, 0.6), dec('pine', 29.5, 0, 1.1, true)],
  });
}

/**
 * 3-6 «Серебряная петля» · d 7 · N 3 (nMin 2) · ввод Silver
 * Три каменных «сэндвича» — каменная доска 2×0.5 на двух каменных опорах, ячейка 1×1 под small (со всех сторон камень):
 * A на земле (x = 12.5, опоры 1×1), B и C — на ледяной полке (longBeam 5×0.5 на деревянных сваях 4 м, x = 18),
 * опоры у них — бруски 0.5×1; на доске C — medium. Пике Silver пробивает доску (×3.0 по камню) и давит small;
 * пике в щель между B и C (или Red в сваю) ломает полку — оба сэндвича и medium падают с 4.5 м.
 * Между A и полкой — валун 0.8 м: Silver после пике в A скользит по земле и без него выбивал сваю (уровень решался
 * одной птицей). Позади ледяная горка в 3 ряда, впереди веха (каменный квадрат с ледяным кубиком).
 * Тап для пике — позже, чем кажется: петля длится 0.57 с, и при раннем тапе Silver ныряет до цели.
 * Свиньи: 3 small под досками, medium на доске C. Учит: петля и пике Silver ломают камень сверху.
 */
export function L3_6(): LevelDef {
  const a = sandwich(12.5, 0);
  const piles = part({
    blocks: [
      blockOn('wood', 'column', 15.75, 0),
      blockOn('wood', 'column', 15.75, 2),
      blockOn('wood', 'column', 20.25, 0),
      blockOn('wood', 'column', 20.25, 2),
      blockOn('ice', 'longBeam', 18, 4, { id: 'ледяная-полка' }),
    ],
  });
  const b = sandwich(16.5, 4.5, 'brick');
  const c = sandwich(19.5, 4.5, 'brick');
  const lidC = c.blocks[2];
  // ледяная горка позади и веха впереди — в стороне от сэндвичей
  const drift = pyramid({ x: 23, rows: 3, mat: 'ice' });
  const marks = [blockOn('stone', 'square', 8.5, 0), blockOn('ice', 'cube', 8.5, 1)];
  return level({
    id: '3-6',
    name: 'Серебряная петля',
    birds: ['silver', 'silver', 'red'],
    // валун между A и сваей полки: пике в A (Silver скользит дальше по земле) не выбивает сваю — иначе одна птица
    terrain: [flatGround(), plateau(14.5, 14.9, 0.8, { slope: 0.3 })],
    bounds: { maxX: 37 },
    parts: [a, piles, b, c, drift],
    blocks: marks,
    pigs: [pigIn('small', a.spots[0]), pigIn('small', b.spots[0]), pigIn('small', c.spots[0]), pigOnBlock('medium', lidC, 0, { fragile: true })],
    hint: 'Коснитесь экрана над целью — Сильвер сделает петлю и ударит сверху',
    stars: { one: 0, two: 25_000, three: 37_000 },
    meta: { nMin: 2, difficulty: 7, teach: 'Silver: петля и пике пробивают каменную доску сверху', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 38798, solverSec: 16.1, evaluations: 955 } },
    decor: [dec('pine', 2.8), dec('snowman', 5.5), dec('rock', 7.2, 0, 0.7), dec('pine', 26.5, 0, 1.1), dec('snowman', 29, 0, 0.8, true)],
  });
}

/**
 * 3-7 «Крепость на утёсе» · d 8 · N 5 (nMin 4)
 * Рогатка на снежном холме: основание y = 3, ANCHOR (0, 5.7), площадка −10…+1.5, откос 34°. Огибающая поднята на 3 м.
 * Утёс plateau(15, 25.5, 3) с отвесной стеной к рогатке. На нём крепость: две башни span 3 в 2 этажа (x = 18 и 23;
 * 1-й этаж — каменные колонны и деревянная балка, 2-й — деревянные колонны и деревянная балка, верх 8), между крышами
 * ледяной мост longBeam 5×0.5 (x = 20.5, опирание по 2 м) с medium, по краям каменные зубцы. Под утёсом на земле
 * деревянный домик (x = 11.75) с small, ледяной сарайчик с зубцами (x = 7.25) и штабель ящиков у подножия (x = 14.25).
 * Кромка утёса в 1.75 м от левой башни: опрокинутая башня падает на утёс, а не на домик (с кромкой у самой башни
 * один выстрел Реда валил её на домик — 4 свиньи из 5). Верх башен лёгкий (дерево): с каменными балками 2-го этажа
 * один выстрел Реда обрушал всю крепость.
 * Слабые места: деревянные колонны 2-го этажа (Chuck) и ледяной мост; каски в каменных этажах — для пике, яйца, Бомба.
 * Свиньи: 2 helmet на 1-х этажах, small на 2-м этаже левой башни, medium на мосту, small в домике.
 * Учит: высота рогатки меняет углы — с холма птица летит дальше и выше.
 */
export function L3_7(): LevelDef {
  const cliffTop = 3;
  const mats = [{ col: 'stone' as const, beam: 'wood' as const }, 'wood' as const];
  const towerL = tower({ x: 18, y: cliffTop, floors: 2, span: 3, mats });
  const towerR = tower({ x: 23, y: cliffTop, floors: 2, span: 3, mats });
  const bridge = blockOn('ice', 'longBeam', 20.5, towerL.top, { id: 'ледяной-мост' });
  const merlons = [blockOn('stone', 'cube', 16.25, towerL.top), blockOn('stone', 'cube', 24.75, towerR.top)];
  const house = hut({ x: 11.75 });
  const shed = frame({ x: 7.25, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const props = [
    blockOn('ice', 'cube', 6.5, shed.top),
    blockOn('ice', 'cube', 8, shed.top),
    blockOn('wood', 'square', 14.25, 0),
    blockOn('wood', 'square', 14.25, 1),
    blockOn('ice', 'cube', 14.25, 2),
  ];
  return level({
    id: '3-7',
    name: 'Крепость на утёсе',
    birds: ['red', 'chuck', 'matilda', 'silver', 'bomb'],
    slingshot: slingshotOn(0, 3),
    terrain: [flatGround(), slingHill(3, { slope: 4.5 }), plateau(15, 25.5, cliffTop, { slope: [0, 5] })],
    bounds: { maxX: 37 },
    parts: [shed, house, towerL, towerR],
    blocks: [bridge, ...merlons, ...props],
    pigs: [
      pigIn('helmet', towerL.spots[0]),
      pigIn('helmet', towerR.spots[0]),
      pigIn('small', towerL.spots[1]),
      pigOnBlock('medium', bridge),
      pigIn('small', house.spots[0]),
    ],
    hint: 'С холма птица летит дальше — целься ниже обычного',
    stars: { one: 0, two: 31_000, three: 44_000 },
    meta: { nMin: 4, difficulty: 8, teach: 'рогатка на холме: другие углы, крепость на утёсе', starsSource: 'solver', calib: { expertBirds: 4, expertScore: 49216, solverSec: 44.3, evaluations: 1575 } },
    decor: [dec('pine', -6, 3), dec('snowman', -9, 3, 0.8), dec('rock', 9.4, 0, 0.6), dec('rock', 15.45, cliffTop, 0.5), dec('pine', 27.5, 3 * (1 - 2 / 5), 0.8), dec('pine', 31.5, 0, 1.2, true)],
  });
}

/**
 * 3-8 «Ледяной мост» · d 8 · N 5 (nMin 4)
 * Утёсы plateau(7.5, 13.5, 4) и plateau(21, 26, 4), пропасть 7.5 м (дно y = 0, падение 4 м убивает small и medium).
 * Мост — 2 ледяные балки 4×0.5 (13.25–21.25, на утёсы по 0.25), стык на ледяной свае 0.5×4 (две колонны) x = 17.25.
 * На мосту ледяной домик span 2 (x = 14.5) с small, 2 medium и каменный шар ⌀1 в колыбели между ними.
 * На левом утёсе — каменный бункер с кладкой стен из квадратов (как донжон 3-1, x = 11) под каменной балкой и ледяным
 * щипцом с large: его берёт только Terence — Синим, Хэлу и Чаку камень не по силам (с ледяной балкой Хэл проламывал
 * крышу сверху); перед ним ледяной столбик с кубиками. На правом утёсе ледяная сторожка в 2 этажа с зубцами (x = 22.5)
 * с small и кубики у обрыва.
 * Слабые места: ледяная свая (Chuck, Hal снизу) и шар (толчок — катится по мосту).
 * Свиньи: 2 medium на мосту, small в домике, small в сторожке, large в бункере.
 * Учит: обрушить мост вместо пробивания каждой свиньи; Terence — на каменный бункер.
 */
export function L3_8(): LevelDef {
  const cliffTop = 4;
  const piles = [blockOn('ice', 'column', 17.25, 0), blockOn('ice', 'column', 17.25, 2)];
  const deck = [15.25, 19.25].map((x, i) => blockOn('ice', 'beam', x, cliffTop, { id: `мост-${i + 1}` }));
  const booth = hut({ x: 14.5, y: cliffTop + 0.5, span: 2, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const ball = cradleOn(18.4, cliffTop + 0.5);
  const vault = keepFloor(11, cliffTop, 'stone');
  const vaultRoof = roof({ x: 11, y: vault.top, w: 4, mat: 'ice' });
  const lookout = tower({ x: 22.5, y: cliffTop, floors: 2, span: 2, mats: 'ice' });
  const props = [
    blockOn('ice', 'square', 8, cliffTop),
    blockOn('ice', 'cube', 7.75, cliffTop + 1),
    blockOn('ice', 'cube', 8.25, cliffTop + 1),
    blockOn('ice', 'cube', 21.75, lookout.top),
    blockOn('ice', 'cube', 23.25, lookout.top),
    blockOn('ice', 'cube', 21, cliffTop + 0.5, { id: 'упор-у-края-моста' }),
    blockOn('ice', 'cube', 24.25, cliffTop),
    blockOn('ice', 'cube', 24.25, cliffTop + 0.5),
  ];
  return level({
    id: '3-8',
    name: 'Ледяной мост',
    birds: ['blues', 'hal', 'chuck', 'terence', 'red'],
    terrain: [flatGround(), plateau(7.5, 13.5, cliffTop, { slope: [6, 0] }), plateau(21, 26, cliffTop, { slope: [0, 6] })],
    bounds: { maxX: 38 },
    parts: [vault, vaultRoof, part({ blocks: [...piles, ...deck] }), booth, ball, lookout],
    blocks: props,
    pigs: [pigIn('large', vault.spots[0]), pigIn('small', booth.spots[0]), pigOn('medium', 16.3, cliffTop + 0.5), pigOn('medium', 20.1, cliffTop + 0.5), pigIn('small', lookout.spots[0])],
    hint: 'Сломайте сваю — мост рухнет в пропасть',
    stars: { one: 0, two: 31_000, three: 44_000 },
    meta: { nMin: 4, difficulty: 8, teach: 'ледяной мост над пропастью: обрушение вместо точечных попаданий', starsSource: 'solver', calib: { expertBirds: 4, expertScore: 51513, solverSec: 26.4, evaluations: 1395 } },
    decor: [dec('snowman', 3.4, cliffTop * (1.9 / 6), 0.8), dec('pine', 5.6, cliffTop * (4.1 / 6), 0.7), dec('rock', 17.25 - 2, 0, 0.9), dec('pine', 25.4, cliffTop, 0.7), dec('pine', 30, 0, 1.1, true)],
  });
}

/**
 * 3-9 «Склад на льду» · d 9 · N 5 (nMin 4)
 * Склад из четырёх частей, у каждой свой «ключ»; части разнесены по x и по высоте, чтобы взрыв одной не поджигал другую:
 * - A: каменный бункер span 3.5 (x = 11.25) — TNT у левой стены и medium; на крыше ледяная будка со small (её TNT
 *   берёт сквозь камень: Бомб или яйцо Матильды у бункера), по краям крыши ледяные зубцы; слева штабель ящиков;
 * - скала-останец 13.5…16.5 высотой 5 м: на ней деревянная клетка span 3 с каской — её добивают прямым ударом
 *   (пике Сильвера, рывок Чака); взрывы внизу до неё не достают;
 * - B: скальный уступ 16.5…20.75 высотой 3 м — ледяной навес span 4 (x = 18.6) над двумя TNT (зазор 1 м: цепочка
 *   гарантирована) со small между ними, второй small на навесе между ледяными кубиками;
 * - C: каменный бункер span 3.5 (x = 23) — TNT у правой стены и medium; на крыше деревянная рама под скатной крышей с
 *   каской (свой TNT её только задевает: нужен отдельный удар или Бомб рядом).
 * Отступление от 06 §10: вместо компактной крепости (там любой взрыв уносил почти всех) — разнесённые части; TNT 4.
 * Эксперт решает тремя птицами (как и до сжатия): Бомб, взорвавшись между B и C, берёт обе части.
 * Свиньи: 2 helmet, 2 medium, 3 small. Учит: управляемая цепочка TNT — какой ящик и когда поджечь.
 */
export function L3_9(): LevelDef {
  const vaultA = bunker({ x: 11.25, inner: 2.5, h: 2 });
  const boothA = frame({ x: 11.25, y: vaultA.top, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const spire = 5;
  const cage = frame({ x: 15, y: spire, span: 3, h: 2, col: 'wood', beam: 'wood' });
  const ledge = 3;
  const shelter = frame({ x: 18.6, y: ledge, span: 4, h: 2, col: 'ice', beam: 'ice' });
  const vaultC = bunker({ x: 23, inner: 2.5, h: 2 });
  const frameC = frame({ x: 23, y: vaultC.top, span: 3, h: 2, col: 'wood', beam: 'wood' });
  const roofC = roof({ x: 23, y: frameC.top, w: 4, mat: 'wood', kind: 'tris' });
  // останец и уступ — один профиль: 13.5…16.5 на 5 м, 16.5…20.75 на 3 м
  const rocks = profile(
    [
      [13.5, 0],
      [13.5, spire],
      [16.5, spire],
      [16.5, ledge],
      [20.75, ledge],
      [20.75, 0],
    ],
    { bottom: -2, kind: 'rock' },
  );
  const props = [
    blockOn('ice', 'cube', 9.5, vaultA.top),
    blockOn('ice', 'cube', 13, vaultA.top),
    blockOn('ice', 'cube', 16.85, shelter.top),
    blockOn('ice', 'cube', 20.35, shelter.top),
    blockOn('wood', 'square', 7.5, 0),
    blockOn('wood', 'square', 8.5, 0),
    blockOn('wood', 'square', 8, 1),
  ];
  return level({
    id: '3-9',
    name: 'Склад на льду',
    birds: ['bomb', 'silver', 'matilda', 'chuck', 'hal'],
    terrain: [flatGround(), rocks],
    bounds: { maxX: 38 },
    parts: [vaultA, boothA, cage, shelter, vaultC, frameC, roofC],
    blocks: props,
    tnt: [tntOn(10.5, 0), tntOn(17.6, ledge), tntOn(19.6, ledge), tntOn(23.75, 0)],
    pigs: [
      pigOn('medium', 11.85, 0),
      pigIn('small', boothA.spots[0]),
      pigIn('helmet', cage.spots[0]),
      pigOn('small', 18.6, ledge),
      pigOn('small', 18.6, shelter.top),
      pigOn('medium', 22.36, 0),
      pigIn('helmet', frameC.spots[0]),
    ],
    hint: 'У каждой части склада свой ящик: подожгите их по очереди',
    stars: { one: 0, two: 42_000, three: 55_000 },
    meta: { nMin: 4, difficulty: 9, teach: 'управляемая цепочка TNT: у каждой части склада свой ящик и своя птица', starsSource: 'solver', calib: { expertBirds: 3, expertScore: 77350, solverSec: 18.3, evaluations: 1215 } },
    decor: [dec('pine', 2.2), dec('snowman', 4.6), dec('sign', 6.2), dec('pine', 26.8, 0, 0.8), dec('pine', 29.5, 0, 1.1), dec('snowman', 32, 0, 0.9, true)],
  });
}

/**
 * 3-10 «Цитадель короля» (финал) · d 10 · N 8 (nMin 6)
 * - впереди ледяная стена: 4 квадрата 1×1 столбом на x = 8.25, перед ней TNT (x = 6.75) — ключ Реда/Синих к стене
 *   и левой сторожевой башне (x = 11, span 2, 2 этажа дерево/лёд, small);
 * - цитадель на x = 16.5: 1-й ярус — две каменные камеры с толстыми стенами (вертикальные плиты 1×2, общая средняя
 *   стена, перекрытия — каменные балки 4×0.5), в каждой TNT у наружной стены и каска у средней: взрыв ящика убивает
 *   каску (и, если повезёт, свинью над ней), но толстые стены он не ломает — цитадель стоит;
 * - 2-й ярус — каменные рамы span 4 (mustache слева, medium справа), по бокам на перекрытии каменные шары ⌀1
 *   в колыбелях; 3-й ярус — зала короля на каменных опорах по 3 м под каменной балкой (пол — балка 5×0.5 поперёк
 *   стыка балок галереи: на стыке король скатывается), верх 9 при огибающей Red 10.3;
 * - правая сторожевая башня (x = 23, span 3, лёд, 2 этажа: medium и small).
 * Отступления от 06 §10: без каменных плит-короны над залой (с ними короля не брал никто, кроме случайного падения),
 * камеры 1-го яруса с толстыми стенами (с тонкими колоннами взрыв ящика обрушал всю цитадель), без плато под
 * цитаделью (под V 21 зала ниже — над ней пролетает Матильда).
 * Эксперт — 5 птиц из 8 (как и до сжатия; nMin 6 — для игрока).
 * Свиньи: king, mustache, 2 helmet, 2 medium, 2 small. Учит: финал — каждой птице своя цель; король — взрывом.
 */
export function L3_10(): LevelDef {
  const cx = 16.5;
  const iceWall = stack({ x: 8.25, n: 4, kind: 'square', mat: 'ice' });
  const watchL = tower({ x: 11, floors: 2, span: 2, mats: ['wood', 'ice'], roof: { mat: 'wood', w: 2 } });
  const y1 = 0;
  // 1-й ярус: камеры 2.5 м между плитами 1×2 (x = cx − 4 … cx + 4), перекрытия — балки 4×0.5 встык над средней стеной
  const vaults = part({
    blocks: [
      blockOn('stone', 'slab', cx - 3.5, y1, { vertical: true }),
      blockOn('stone', 'slab', cx, y1, { vertical: true, id: 'средняя-стена' }),
      blockOn('stone', 'slab', cx + 3.5, y1, { vertical: true }),
      blockOn('stone', 'beam', cx - 2, y1 + 2),
      blockOn('stone', 'beam', cx + 2, y1 + 2),
    ],
  });
  const y2 = y1 + 2.5;
  const galleryL = frame({ x: cx - 2, y: y2, span: 4, h: 2, col: 'stone', beam: 'stone' });
  const galleryR = frame({ x: cx + 2, y: y2, span: 4, h: 2, col: 'stone', beam: 'stone' });
  // пол залы — каменная балка 5×0.5 поперёк стыка балок галереи (король не стоит на стыке — на стыке он скатывается)
  const floor3 = blockOn('stone', 'longBeam', cx, galleryL.top, { id: 'пол-залы' });
  const throne = hall({ x: cx, y: galleryL.top + 0.5, baseMat: 'stone', colMat: 'stone', roofMat: 'stone' });
  const y3 = galleryL.top;
  const balls = part({
    blocks: [
      blockOn('stone', 'ball1', cx - 3, y3, { id: 'шар-левый' }),
      blockOn('stone', 'cube', cx - 3.75, y3, { id: 'стопор-левый' }),
      blockOn('stone', 'ball1', cx + 3, y3, { id: 'шар-правый' }),
      blockOn('stone', 'cube', cx + 3.75, y3, { id: 'стопор-правый' }),
    ],
  });
  const watchR = tower({ x: 23, floors: 2, span: 3, mats: 'ice', roof: 'ice' });
  return level({
    id: '3-10',
    name: 'Цитадель короля',
    birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'],
    bounds: { maxX: 38 },
    parts: [iceWall, watchL, vaults, galleryL, galleryR, part({ blocks: [floor3] }), throne, balls, watchR],
    tnt: [tntOn(6.75, 0), tntOn(cx - 2.5, y1), tntOn(cx + 2.5, y1)],
    pigs: [
      pigIn('king', throne.spots[0]),
      pigIn('mustache', galleryL.spots[0]),
      pigIn('medium', galleryR.spots[0]),
      pigOn('helmet', cx - 1.15, y1),
      pigOn('helmet', cx + 1.15, y1),
      pigIn('small', watchL.spots[1]),
      pigIn('medium', watchR.spots[0]),
      pigIn('small', watchR.spots[1]),
    ],
    hint: 'Короля берёт только взрыв: Бомб у залы или яйцо Матильды на крышу',
    stars: { one: 0, two: 62_000, three: 76_000 },
    meta: { nMin: 6, difficulty: 10, teach: 'финал: все птицы, каждой своя цель; король под каменной крышей — цель взрыва', starsSource: 'solver', calib: { expertBirds: 5, expertScore: 97920, solverSec: 136.1, evaluations: 1560 } },
    decor: [dec('pine', 1.6), dec('snowman', 3.6), dec('sign', 5.2), dec('rock', 20.6, 0, 0.5), dec('pine', 26.5, 0, 1.2), dec('snowman', 29.5, 0, 1, true), dec('pine', 32, 0, 0.9)],
  });
}

export const EPISODE3_LEVELS: LevelDef[] = [L3_1(), L3_2(), L3_3(), L3_4(), L3_5(), L3_6(), L3_7(), L3_8(), L3_9(), L3_10()];
