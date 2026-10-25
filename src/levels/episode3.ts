// Эпизод 3 «Снежные вершины» (snow): + Terence (3-1), лёд, лавина, пещера, Silver (3-6), рогатка на холме (3-7),
// финальный король (3-10). Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Общие соглашения эпизода:
// - рогатка в (0, 0) → ANCHOR (0, 2.7), кроме 3-7 (холм 3 м → ANCHOR (0, 5.7)); площадка очереди ровная;
// - цели (свиньи) на x = 16…34 м от основания; с Bomb — не дальше 32 м, цели Terence — не дальше 27 м и ниже его
//   огибающей (на x = 20 / 24 / 27: 8.2 / 5.1 / 2.3 м — Terence стреляет «в лоб», 00 §1.2);
// - доля материалов по числу блоков ≈ дерево 30 % / лёд 40 % / камень 30 % (06 §9.3), тел 30–60, босс ≤ 80;
// - звёзды — по эксперту на настоящем ядре: suggestStars (06 §8.2, 3★ не выше счёта эксперта) по итогу
//   scripts/level-report.ts --solve; meta.starsSource = 'solver', в meta.calib — птиц и счёт эксперта, время решателя.
//   Тапы Silver у решателя по умолчанию (0.4/0.6/0.8 с, 06 §7.2) раньше, чем петля успевает выйти на цель (петля
//   0.57 с), поэтому уровни с Silver (3-6, 3-7, 3-9, 3-10) решены ещё и с тапами 0.5…1.7 с; в calib — лучший из двух
//   прогонов (silverLateTaps = 1 — лучший с поздними тапами), второй — altBirds / altScore;
// - ни один уровень не проходится одной птицей; итог решателя на этих уровнях чувствителен к мелочам
//   (сдвиг одного блока на 1 м менял число птиц эксперта на ±1–2) — значения в calib сняты на итоговой геометрии.
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
 * Этаж каменного «донжона» (3-1): бункер с кладкой стен из каменных квадратов 1×1 (стена 1 м толщиной, 2 м высотой —
 * два квадрата друг на друге), проём 2×2 под large, перекрытие — ледяная балка 4×0.5. Квадрат (HP 59.4) Теренс
 * разбивает прямым ударом (63 при 21 м/с), а цельную плиту 1×2 (HP 119) — нет: кладка показывает, что камень ему по силам.
 * spots: [0] — внутри, [1] — на перекрытии.
 */
function keepFloor(x: number, y: number): Part {
  const shell = bunker({ x, y, inner: 2, h: 2, wallW: 1, mat: 'stone', roofMat: 'ice' });
  const walls = [x - 1.5, x + 1.5].flatMap((wx) => [blockOn('stone', 'square', wx, y), blockOn('stone', 'square', wx, y + 1)]);
  return { ...shell, blocks: [...walls, shell.blocks[shell.blocks.length - 1]] };
}

/**
 * 3-1 «Старший брат» · d 6 · N 3 (nMin 2) · ввод Terence
 * Каменный донжон в два этажа на x = 20 (≤ 27 — досягаемость Terence): два бункера друг на друге, стены — кладка
 * каменных квадратов толщиной 1 м, перекрытия ледяные, сверху ледяной щипец; в каждом этаже large. По бокам ледяные
 * пристройки (сторожка со щипцом слева, рама с зубцами справа), у подножия уступа — ледяная горка. small — в ледяной
 * будке на снежном уступе (x = 32.5, 1.5 м): Теренсу туда не долететь (дальность 29 м) — это цель Реда.
 * Решение двумя птицами: Теренс настильным ударом проламывает кладку и перекрытие — оба large, Ред — будку.
 * Red камень не берёт, а промах Теренса добирает второй Теренс. Отступление от 06 §10: вместо двух бункеров рядом —
 * два бункера друг на друге (с двумя бункерами рядом одним Теренсом обе large не взять — уровень требовал всех 3 птиц).
 * Свиньи: 2 large в донжоне, small в будке. Учит: Terence ломает камень массой (5 кг).
 */
export function L3_1(): LevelDef {
  const f1 = keepFloor(20, 0);
  const f2 = keepFloor(20, f1.top);
  const gable = roof({ x: 20, y: f2.top, w: 4, mat: 'ice' });
  const lodge = frame({ x: 16.25, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const lodgeRoof = roof({ x: 16.25, y: lodge.top, w: 2, mat: 'ice' });
  const wing = frame({ x: 23.75, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const drift = pyramid({ x: 26.5, rows: 2, mat: 'ice' });
  const booth = hut({ x: 32.5, y: 1.5, span: 3, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '3-1',
    name: 'Старший брат',
    birds: ['terence', 'red', 'terence'],
    terrain: [flatGround(), plateau(30, 70, 1.5, { slope: [2.5, 0], kind: 'ground' })],
    parts: [lodge, lodgeRoof, f1, f2, gable, wing, drift, booth],
    blocks: [
      blockOn('ice', 'cube', 23.25, wing.top),
      blockOn('ice', 'cube', 24.25, wing.top),
      blockOn('stone', 'square', 12.5, 0, { id: 'пенёк' }),
      blockOn('ice', 'cube', 12.5, 1),
      blockOn('ice', 'square', 35.5, 1.5),
      blockOn('ice', 'cube', 35.5, 2.5),
    ],
    pigs: [pigIn('large', f1.spots[0]), pigIn('large', f2.spots[0]), pigIn('small', booth.spots[0])],
    hint: 'Теренс тяжёлый: он проломит каменную кладку, а камень Реду не по зубам',
    stars: { one: 0, two: 22_000, three: 35_000 },
    meta: { nMin: 2, difficulty: 6, teach: 'Terence: масса 5 кг ломает камень, цели ближе (дальность 29 м)', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 35294, solverSec: 4.2, evaluations: 249 } },
    decor: [dec('pine', 4.5), dec('snowman', 8.5), dec('pine', 10.5, 0, 0.8), dec('sign', 14.2), dec('rock', 28.6, 0, 0.6), dec('pine', 30.2, 1.5, 0.8), dec('pine', 37.5, 1.5, 1.2), dec('snowman', 40.5, 1.5, 0.9, true)],
  });
}

/**
 * 3-2 «Ледяной дворец» · d 6 · N 4 (nMin 3)
 * Дворец изо льда в три объёма с проходами по 3.5 м: главная башня в 3 этажа (рамы 4×2.5, x = 26) на каменном цоколе
 * (балка 5×0.5) под ледяным щипцом, слева двухэтажное ледяное крыло span 3 (x = 18.5), справа крыло span 3 (x = 32.5)
 * с деревянным перекрытием 1-го этажа; у крыльев скатные крыши из ледяных треугольников. Перед дворцом ледяные
 * ворота с зубцами, позади — горка ледяных кубиков. 1-й этаж башни на каменных колоннах: настильный залп Синих,
 * прошедший сквозь левое крыло, башню целиком не роняет (без них один выстрел сносил крыло и всю башню).
 * Лёд на льду скользит (μ 0.25): выбитая колонна — и этажи съезжают. Blues колют лёд ×2.6, Chuck — рывком в крыло.
 * Свиньи: medium и small в башне (1-й и 3-й этаж), small на 2-м этаже левого крыла, medium и small в правом крыле.
 * Учит: лёд хрупкий и скользкий, Blues против льда.
 */
export function L3_2(): LevelDef {
  // цоколь — цельная каменная балка 5×0.5: свинья 1-го этажа не стоит на стыке (на стыке двух плит medium скатывается)
  const plinth = part({ blocks: [blockOn('stone', 'longBeam', 26, 0, { id: 'цоколь' })] });
  const keep = tower({ x: 26, y: 0.5, floors: 3, mats: [{ col: 'stone', beam: 'ice' }, 'ice', 'ice'], roof: 'ice' });
  const wingL = tower({ x: 18.5, floors: 2, span: 3, mats: 'ice', roof: { mat: 'ice', w: 4, kind: 'tris' } });
  const wingR = tower({ x: 32.5, floors: 2, span: 3, mats: [{ col: 'ice', beam: 'wood' }, 'ice'], roof: { mat: 'ice', w: 4, kind: 'tris' } });
  const gate = frame({ x: 13, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const drift = pyramid({ x: 36, y: 1, rows: 2, size: 0.5, mat: 'ice' });
  return level({
    id: '3-2',
    name: 'Ледяной дворец',
    birds: ['blues', 'blues', 'chuck', 'blues'],
    parts: [gate, wingL, plinth, keep, wingR, drift],
    blocks: [blockOn('ice', 'cube', 12.25, gate.top), blockOn('ice', 'cube', 13.75, gate.top), blockOn('ice', 'square', 36, 0)],
    pigs: [
      pigIn('medium', keep.spots[0]),
      pigIn('small', keep.spots[2]),
      pigIn('small', wingL.spots[1]),
      pigIn('medium', wingR.spots[0]),
      pigIn('small', wingR.spots[1]),
    ],
    hint: 'Лёд скользкий и хрупкий: Синие колют его лучше всех',
    stars: { one: 0, two: 32_000, three: 46_000 },
    meta: { nMin: 3, difficulty: 6, teach: 'ледяные конструкции: хрупкость и скольжение (μ 0.25), Blues против льда', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 65986, solverSec: 5.1, evaluations: 461 } },
    decor: [dec('pine', 3.5), dec('rock', 7.5, 0, 0.7), dec('snowman', 10), dec('pine', 15.5, 0, 0.8), dec('rock', 22.2, 0, 0.5), dec('pine', 29.3, 0, 0.7, true), dec('pine', 38.5, 0, 1.1), dec('snowman', 41, 0, 0.9, true)],
  });
}

/**
 * 3-3 «Лавина» · d 7 · N 4 (nMin 2)
 * Снежный склон hill(8, 14, 19.5, 26.5, 4): подъём от рогатки 34° и скат 19.5 → 26.5 (≈ 30°) к домикам.
 * Наверху два каменных шара — малый ⌀1 (x = 15.22) и большой ⌀2 у кромки (x = 17.15) — в общей колыбели из ледяных
 * кубиков (x = 14.42 / 16.02 / 18.28). Толчок в шар (или выбитый стопор) — шар скатывается, разгоняется до ≈ 9 м/с
 * и таранит колонну у подножия; малый шар — «второй заход». Внизу ледяные постройки span 3: двухэтажный домик
 * (x = 28) и домик с деревянной крышей (x = 32); их балки сходятся над узким проулком (x = 30) — там прячется small.
 * Позади — каменная поленница (x = 36.5). Свиньи: medium на 1-м и small на 2-м этаже домика, medium в дальнем домике,
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
    stars: { one: 0, two: 34_000, three: 47_000 },
    meta: { nMin: 2, difficulty: 7, teach: 'лавина: шары со склона — косвенное убийство', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 47902, solverSec: 2.6, evaluations: 382 } },
    decor: [dec('pine', 3), dec('snowman', 6), dec('pine', 11, 3 * (4 / 6), 0.8), dec('rock', 21, 4 - 1.5 * (4 / 7), 0.6), dec('pine', 38.8, 0, 0.9), dec('rock', 41, 0, 1.1, true)],
  });
}

/**
 * 3-4 «Пещера» · d 7 · N 4 (nMin 3)
 * Скальный массив: потолок пещеры — скала x 24…34, y 4…5, задняя стена x = 34 и вершина-гребень справа.
 * Вход слева высотой 4 на x = 24 закрыт баррикадой: стопка 2 деревянных квадратов 1×1 (x = 24.5) + каменная колонна
 * 0.5×2 перед ней; над баррикадой щель 1 м. Внутри деревянная рама span 3 (x = 27.25: medium внутри, small на балке
 * между деревянными кубиками), узкая рама span 2 (x = 31.75: small) и деревянные ящики в проходе и у задней стены.
 * На потолке ледяной домик span 3 (x = 25.5, small), ледяная вышка в 2 этажа (x = 29) и каменный тур (x = 31.75).
 * Внутрь попадают только настильные выстрелы 10–18°: навес упирается в скалу; домик наверху — цель навеса.
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
  const lodge = hut({ x: 25.5, y: 5, span: 3, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const watch = tower({ x: 29, y: 5, floors: 2, span: 2, mats: 'ice' });
  const cairn = pyramid({ x: 31.75, y: 5, rows: 2, mat: 'stone' });
  // ящики в пещере (в проходе между рамами и у задней стены) и зубцы на балке рамы
  const crates = [
    blockOn('wood', 'square', 29.75, 0),
    blockOn('wood', 'square', 29.75, 1),
    blockOn('wood', 'square', 33.5, 0),
    blockOn('wood', 'square', 33.5, 1),
    blockOn('wood', 'cube', 33.25, 2),
    blockOn('wood', 'cube', 26.25, shed.top),
    blockOn('wood', 'cube', 28.25, shed.top),
  ];
  const watchTop = [blockOn('ice', 'cube', 28.25, watch.top), blockOn('ice', 'cube', 29.75, watch.top), blockOn('ice', 'brick', 29, watch.top)];
  return level({
    id: '3-4',
    name: 'Пещера',
    birds: ['chuck', 'terence', 'bomb', 'red'],
    terrain: [flatGround(), massif],
    parts: [barricade, shed, nook, lodge, watch, cairn],
    blocks: [post, ...crates, ...watchTop],
    pigs: [pigIn('medium', shed.spots[0]), pigIn('small', shed.spots[1]), pigIn('small', nook.spots[0]), pigIn('small', lodge.spots[0])],
    hint: 'Стреляйте полого — навесом в пещеру не попасть',
    camera: { castle: { x: 28, y: 4, viewH: 15 } },
    stars: { one: 0, two: 27_000, three: 40_000 },
    meta: { nMin: 3, difficulty: 7, teach: 'пещера под скальным потолком: только настильные выстрелы 10–18° и мощь', starsSource: 'solver', calib: { expertBirds: 3, expertScore: 48688, solverSec: 5.3, evaluations: 658 } },
    decor: [dec('pine', 3.5), dec('rock', 8, 0, 0.8), dec('snowman', 13), dec('pine', 18.5, 0, 0.9), dec('pine', 22.2, 0, 0.7, true), dec('rock', 33.3, 5.15, 0.5), dec('pine', 38.5, 4.6, 0.7)],
  });
}

/**
 * 3-5 «Три террасы» · d 7 · N 5 (nMin 4)
 * Скальные террасы ступенями: 18…23 на высоте 1.5, 23…28 на 3, 28…33 на 4 (один профиль рельефа).
 * Ближняя — ледяной домик span 4 (x = 20.5) с medium и small, средняя — деревянная башня в 2 этажа (x = 25.5,
 * верх 8) под деревянной скатной крышей с large и small, дальняя — каменный бункер (x = 30.5, верх 6 при огибающей
 * Red 7.0) с medium внутри и small на крыше между ледяными зубцами. У уступов — ступени из ледяных и деревянных
 * кубиков, за бункером каменный кубик с ледяным столбиком. Bomb дальнюю террасу не достаёт (огибающая 3.6) —
 * она для Red, Hal и Matilda. Обломки верхних террас сыплются на нижние. Свиньи: по 2 на террасу.
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
  const keep = tower({ x: 25.5, y: 3, floors: 2, roof: { mat: 'wood', kind: 'tris' } });
  const vault = bunker({ x: 30.5, y: 4, inner: 2, h: 1.5 });
  // ступени у уступов, ящики у домика и зубцы бункера
  const steps = [
    blockOn('ice', 'cube', 18.25, 1.5),
    blockOn('ice', 'cube', 18.25, 2),
    blockOn('ice', 'cube', 22.75, 1.5),
    blockOn('ice', 'cube', 22.75, 2),
    blockOn('ice', 'cube', 22.75, 2.5),
    blockOn('wood', 'cube', 27.75, 3),
    blockOn('wood', 'cube', 27.75, 3.5),
    blockOn('stone', 'cube', 32.75, 4),
    blockOn('ice', 'brick', 32.75, 4.5, { vertical: true }),
  ];
  return level({
    id: '3-5',
    name: 'Три террасы',
    birds: ['red', 'hal', 'matilda', 'bomb', 'blues'],
    terrain: [flatGround(), terraces],
    parts: [igloo, keep, vault],
    blocks: [blockOn('ice', 'cube', 28.75, vault.top), blockOn('ice', 'cube', 32.25, vault.top), ...steps],
    pigs: [
      pigIn('medium', igloo.spots[0], -0.75),
      pigIn('small', igloo.spots[0], 0.9),
      pigIn('large', keep.spots[0]),
      pigIn('small', keep.spots[1]),
      pigIn('medium', vault.spots[0]),
      pigIn('small', vault.spots[1]),
    ],
    stars: { one: 0, two: 36_000, three: 49_000 },
    meta: { nMin: 4, difficulty: 7, teach: 'три яруса целей: порядок ближняя → дальняя, досягаемость птиц', starsSource: 'solver', calib: { expertBirds: 4, expertScore: 56852, solverSec: 21.5, evaluations: 1269 } },
    decor: [dec('pine', 3), dec('snowman', 7.5), dec('rock', 12, 0, 0.8), dec('pine', 16.5, 0.94, 0.7), dec('pine', 34.5, 3.33, 0.8), dec('rock', 36.5, 1.67, 0.6), dec('pine', 40.5, 0, 1.1, true)],
  });
}

/**
 * 3-6 «Серебряная петля» · d 7 · N 3 (nMin 2) · ввод Silver
 * Три каменных «сэндвича» — каменная доска 2×0.5 на двух каменных опорах, ячейка 1×1 под small (со всех сторон камень):
 * A на земле (x = 19, опоры 1×1), B и C — на ледяной полке (longBeam 5×0.5 на деревянных сваях 4 м, x = 25),
 * опоры у них — бруски 0.5×1; на доске C — medium. Пике Silver пробивает доску (×3.0 по камню) и давит small;
 * пике в щель между B и C (или Red в сваю) ломает полку — оба сэндвича и medium падают с 4.5 м.
 * Позади ледяная горка в 3 ряда, по краям вехи (каменный квадрат слева, ледяной справа).
 * Тап для пике — позже, чем кажется: петля длится 0.57 с, и при тапе раньше ≈ 0.9 с Silver ныряет до цели.
 * Свиньи: 3 small под досками, medium на доске C. Учит: петля и пике Silver ломают камень сверху.
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
  // ледяная горка позади и вехи по краям — вдали от сэндвичей: обломки полки до них не достают
  const drift = pyramid({ x: 32, rows: 3, mat: 'ice' });
  const marks = [blockOn('stone', 'square', 14, 0), blockOn('ice', 'cube', 14, 1), blockOn('ice', 'square', 34.5, 0), blockOn('ice', 'cube', 34.5, 1)];
  return level({
    id: '3-6',
    name: 'Серебряная петля',
    birds: ['silver', 'silver', 'red'],
    parts: [a, piles, b, c, drift],
    blocks: marks,
    pigs: [pigIn('small', a.spots[0]), pigIn('small', b.spots[0]), pigIn('small', c.spots[0]), pigOnBlock('medium', lidC, 0, { fragile: true })],
    hint: 'Коснитесь экрана над целью — Сильвер сделает петлю и ударит сверху',
    stars: { one: 0, two: 25_000, three: 36_000 },
    meta: { nMin: 2, difficulty: 7, teach: 'Silver: петля и пике пробивают каменную доску сверху', starsSource: 'solver', calib: { expertBirds: 2, expertScore: 36980, solverSec: 12.4, evaluations: 954, silverLateTaps: 1, altBirds: 3, altScore: 28198 } },
    decor: [dec('pine', 4), dec('snowman', 9), dec('rock', 12.2, 0, 0.7), dec('pine', 21, 0, 0.6), dec('rock', 29.3, 0, 0.6), dec('pine', 36.5, 0, 1.1), dec('snowman', 39.5, 0, 0.8, true)],
  });
}

/**
 * 3-7 «Крепость на утёсе» · d 8 · N 5 (nMin 4)
 * Рогатка на снежном холме: основание y = 3, ANCHOR (0, 5.7), площадка −10…+1.5, откос 34°. Огибающая поднята на 3 м.
 * Утёс plateau(25, 33, 4) с отвесной стеной к рогатке. На нём крепость: две башни span 3 в 2 этажа (x = 26.5 и 31.5;
 * 1-й этаж — каменные колонны и деревянная балка, 2-й — деревянные колонны и деревянная балка, верх 9), между крышами
 * ледяной мост longBeam 5×0.5 (x = 29, опирание по 2 м) с medium, по краям каменные зубцы. Под утёсом на земле
 * деревянный домик (x = 21) с small, ледяной сарайчик с зубцами (x = 16.5) и штабель ящиков у подножия (x = 23.75).
 * Верх башен лёгкий (дерево): с каменными балками 2-го этажа один выстрел Реда обрушал всю крепость (4 свиньи из 5).
 * Слабые места: деревянные колонны 2-го этажа (Chuck) и ледяной мост; каски в каменных этажах — для пике, яйца, Бомба.
 * Свиньи: 2 helmet на 1-х этажах, small на 2-м этаже левой башни, medium на мосту, small в домике.
 * Учит: высота рогатки меняет углы; дальность Red с холма 3 м ≈ 40.6 м.
 */
export function L3_7(): LevelDef {
  const mats = [{ col: 'stone' as const, beam: 'wood' as const }, 'wood' as const];
  const towerL = tower({ x: 26.5, y: 4, floors: 2, span: 3, mats });
  const towerR = tower({ x: 31.5, y: 4, floors: 2, span: 3, mats });
  const bridge = blockOn('ice', 'longBeam', 29, towerL.top, { id: 'ледяной-мост' });
  const merlons = [blockOn('stone', 'cube', 24.75, towerL.top), blockOn('stone', 'cube', 33.25, towerR.top)];
  const house = hut({ x: 21 });
  const shed = frame({ x: 16.5, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const props = [
    blockOn('ice', 'cube', 15.75, shed.top),
    blockOn('ice', 'cube', 17.25, shed.top),
    blockOn('wood', 'square', 23.75, 0),
    blockOn('wood', 'square', 23.75, 1),
    blockOn('ice', 'cube', 23.75, 2),
  ];
  return level({
    id: '3-7',
    name: 'Крепость на утёсе',
    birds: ['red', 'chuck', 'matilda', 'silver', 'bomb'],
    slingshot: slingshotOn(0, 3),
    terrain: [flatGround(), slingHill(3, { slope: 4.5 }), plateau(25, 33, 4, { slope: [0, 6] })],
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
    camera: { castle: { x: 27, y: 6, viewH: 17 } },
    stars: { one: 0, two: 31_000, three: 44_000 },
    meta: { nMin: 4, difficulty: 8, teach: 'рогатка на холме: другие углы, крепость на утёсе', starsSource: 'solver', calib: { expertBirds: 4, expertScore: 51879, solverSec: 31.6, evaluations: 1559, silverLateTaps: 1, altBirds: 5, altScore: 44395 } },
    decor: [dec('pine', -6, 3), dec('snowman', -9, 3, 0.8), dec('pine', 9, 0, 0.9), dec('rock', 12.5, 0, 0.8), dec('pine', 18.7, 0, 0.8), dec('rock', 24.4, 0, 0.5), dec('pine', 35, 3.33, 0.8), dec('pine', 40, 0, 1.2, true)],
  });
}

/**
 * 3-8 «Ледяной мост» · d 8 · N 5 (nMin 4)
 * Утёсы plateau(11, 18.25, 4) и plateau(29.75, 35, 4), пропасть 11.5 м (дно y = 0, падение 4.5 м убивает small и medium).
 * Мост — 3 ледяные балки 4×0.5 (18–30, на утёсы по 0.25), стыки на ледяных сваях 0.5×4 (две колонны) x = 22 и 26.
 * На мосту ледяной домик span 2 (x = 19.5) с small, 2 medium и каменный шар ⌀1 в колыбели между ними.
 * На левом утёсе — каменный бункер с кладкой стен из квадратов (как донжон 3-1, x = 16) под ледяным щипцом с large:
 * его берёт только Terence (x ≤ 27) — Синим, Хэлу и Чаку камень не по силам; рядом ледяной столбик с кубиками.
 * На правом утёсе ледяная сторожка в 2 этажа (x = 32.5) с small, ледяной квадрат у края моста и кубики у обрыва.
 * Слабые места: ледяные сваи (Chuck, Hal снизу) и шар (толчок — катится по мосту).
 * Свиньи: 2 medium на мосту, small в домике, small в сторожке, large в бункере.
 * Учит: обрушить мост вместо пробивания каждой свиньи; Terence — на каменный бункер.
 */
export function L3_8(): LevelDef {
  const piles = [22, 26].flatMap((x) => [blockOn('ice', 'column', x, 0), blockOn('ice', 'column', x, 2)]);
  const deck = [20, 24, 28].map((x, i) => blockOn('ice', 'beam', x, 4, { id: `мост-${i + 1}` }));
  const booth = hut({ x: 19.5, y: 4.5, span: 2, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const ball = cradleOn(24, 4.5);
  const vault = keepFloor(16, 4);
  const vaultRoof = roof({ x: 16, y: vault.top, w: 4, mat: 'ice' });
  const lookout = tower({ x: 32.5, y: 4, floors: 2, span: 2, mats: 'ice', roof: { mat: 'ice', w: 2 } });
  const props = [
    blockOn('ice', 'square', 29.5, 4.5),
    blockOn('ice', 'square', 12.5, 4),
    blockOn('ice', 'cube', 12.25, 5),
    blockOn('ice', 'cube', 12.75, 5),
    blockOn('ice', 'cube', 34.5, 4),
    blockOn('ice', 'cube', 34.5, 4.5),
  ];
  return level({
    id: '3-8',
    name: 'Ледяной мост',
    birds: ['blues', 'hal', 'chuck', 'terence', 'red'],
    terrain: [flatGround(), plateau(11, 18.25, 4, { slope: [6, 0] }), plateau(29.75, 35, 4, { slope: [0, 6] })],
    parts: [vault, vaultRoof, part({ blocks: [...piles, ...deck] }), booth, ball, lookout],
    blocks: props,
    pigs: [pigIn('large', vault.spots[0]), pigIn('small', booth.spots[0]), pigOn('medium', 21.15, 4.5), pigOn('medium', 26.85, 4.5), pigIn('small', lookout.spots[0])],
    hint: 'Сломайте сваю — мост рухнет в пропасть',
    stars: { one: 0, two: 32_000, three: 45_000 },
    meta: { nMin: 4, difficulty: 8, teach: 'ледяной мост над пропастью: обрушение вместо точечных попаданий', starsSource: 'solver', calib: { expertBirds: 4, expertScore: 52006, solverSec: 22.7, evaluations: 1204 } },
    decor: [dec('pine', 1.8), dec('snowman', 4.2), dec('pine', 11.6, 4, 0.8), dec('rock', 24, 0, 0.9), dec('pine', 35.6, 3.6, 0.7), dec('pine', 40, 0, 1.1, true)],
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
 * Склад из четырёх частей, у каждой свой «ключ»; части разнесены по x и по высоте, чтобы взрыв одной не поджигал другую:
 * - A: каменный бункер span 4 (x = 16.5) — TNT у левой стены и medium; на крыше ледяная будка со small (её TNT берёт
 *   сквозь камень: Бомб или яйцо Матильды у бункера), по краям крыши ледяные зубцы; слева штабель деревянных ящиков;
 * - скала-останец 19.5…22.5 высотой 5 м: на ней деревянная клетка span 3 с каской — её добивают прямым ударом
 *   (пике Сильвера, рывок Чака); взрывы внизу до неё не достают;
 * - B: скальный уступ 23.5…29.5 высотой 3 м — ледяной навес span 4 (x = 26) над двумя TNT (x = 25 и 27, зазор 1 м:
 *   цепочка гарантирована) со small между ними, второй small у края за ледяным кубиком; на навесе ледяные кубики;
 * - C: каменный бункер span 4 (x = 32) — TNT у правой стены и medium; на крыше деревянная рама под скатной крышей с
 *   каской (от своего TNT она в 4.1 м — уцелеет: нужен отдельный удар или Бомб рядом).
 * Отступление от 06 §10: вместо компактной крепости (там любой взрыв уносил почти всех) — разнесённые части; TNT 4.
 * Свиньи: 2 helmet, 2 medium, 3 small. Учит: управляемая цепочка TNT — какой ящик и когда поджечь.
 */
export function L3_9(): LevelDef {
  const vaultA = bunker({ x: 16.5, inner: 3, h: 2 });
  const boothA = frame({ x: 16.5, y: vaultA.top, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const spire = 5;
  const cage = frame({ x: 21, y: spire, span: 3, h: 2, col: 'wood', beam: 'wood' });
  const ledge = 3;
  const shelter = frame({ x: 26, y: ledge, span: 4, h: 2, col: 'ice', beam: 'ice' });
  const vaultC = bunker({ x: 32, inner: 3, h: 2 });
  const frameC = frame({ x: 32, y: vaultC.top, span: 3, h: 2, col: 'wood', beam: 'wood' });
  const roofC = roof({ x: 32, y: frameC.top, w: 4, mat: 'wood', kind: 'tris' });
  const props = [
    blockOn('ice', 'cube', 14.75, vaultA.top),
    blockOn('ice', 'cube', 18.25, vaultA.top),
    blockOn('ice', 'cube', 24.75, shelter.top),
    blockOn('ice', 'cube', 26, shelter.top),
    blockOn('ice', 'cube', 27.25, shelter.top),
    blockOn('wood', 'cube', 23.75, ledge),
    blockOn('ice', 'cube', 29.25, ledge),
    blockOn('wood', 'square', 12.5, 0),
    blockOn('wood', 'square', 13.5, 0),
    blockOn('wood', 'square', 13, 1),
  ];
  return level({
    id: '3-9',
    name: 'Склад на льду',
    birds: ['bomb', 'silver', 'matilda', 'chuck', 'hal'],
    terrain: [flatGround(), plateau(19.5, 22.5, spire), plateau(23.5, 29.5, ledge)],
    parts: [vaultA, boothA, cage, shelter, vaultC, frameC, roofC],
    blocks: props,
    tnt: [tntOn(15.5, 0), tntOn(25, ledge), tntOn(27, ledge), tntOn(33, 0)],
    pigs: [
      pigOn('medium', 17.35, 0),
      pigIn('small', boothA.spots[0]),
      pigIn('helmet', cage.spots[0]),
      pigOn('small', 26, ledge),
      pigOn('small', 28.6, ledge),
      pigOn('medium', 31.15, 0),
      pigIn('helmet', frameC.spots[0]),
    ],
    hint: 'У каждой части склада свой ящик: подожгите их по очереди',
    camera: { castle: { x: 24, y: 3.5, viewH: 13 } },
    stars: { one: 0, two: 43_000, three: 56_000 },
    meta: { nMin: 4, difficulty: 9, teach: 'управляемая цепочка TNT: у каждой части склада свой ящик и своя птица', starsSource: 'solver', calib: { expertBirds: 3, expertScore: 76914, solverSec: 9.5, evaluations: 952, silverLateTaps: 0, altBirds: 4, altScore: 68950 } },
    decor: [dec('pine', 3), dec('snowman', 7), dec('sign', 10.5), dec('rock', 19, 0, 0.6), dec('pine', 35.5, 0, 0.8), dec('pine', 41, 0, 1.1), dec('snowman', 44, 0, 0.9, true)],
  });
}

/**
 * 3-10 «Цитадель короля» (финал) · d 10 · N 8 (nMin 6–7)
 * - впереди ледяная стена: 4 квадрата 1×1 столбом на x = 14, перед ней TNT (x = 12.5) — ключ Реда/Синих к стене
 *   и левой сторожевой башне (x = 16.75, span 2, 2 этажа дерево/лёд, small);
 * - цитадель на плато plateau(20, 28, 1): 1-й ярус — две каменные камеры с толстыми стенами (вертикальные плиты 1×2,
 *   общая средняя стена, перекрытия — каменные балки 4×0.5), в каждой TNT у наружной стены и каска у средней:
 *   взрыв ящика убивает каску (и, если повезёт, свинью над ней), но толстые стены он не ломает — цитадель стоит;
 * - 2-й ярус — каменные рамы span 4 (mustache слева, medium справа), по бокам на перекрытии каменные шары ⌀1
 *   в колыбелях; 3-й ярус — зала короля на каменных опорах по 3 м под каменной балкой (пол — балка 5×0.5 поперёк
 *   стыка балок галереи: на стыке король скатывается), верх 9.5 при огибающей 11.8;
 * - правая сторожевая башня (x = 32, span 3, лёд, 2 этажа: medium и small).
 * Отступления от 06 §10: без каменных плит-короны над залой (с ними короля не брал никто, кроме случайного падения,
 * и эксперту не хватало 8 птиц; без них король — цель взрыва: Бомб у залы или яйцо Матильды на крышу), камеры
 * 1-го яруса с толстыми стенами (с тонкими колоннами взрыв ящика обрушал всю цитадель — 4 птицы на уровень).
 * Свиньи: king, mustache, 2 helmet, 2 medium, 2 small. Учит: финал — каждой птице своя цель; король — взрывом.
 */
export function L3_10(): LevelDef {
  const iceWall = stack({ x: 14, n: 4, kind: 'square', mat: 'ice' });
  const watchL = tower({ x: 16.75, floors: 2, span: 2, mats: ['wood', 'ice'], roof: { mat: 'wood', w: 2 } });
  const y1 = 1;
  // 1-й ярус: камеры 2.5 м между плитами 1×2 (x = 20…21 | 23.5…24.5 | 27…28), перекрытия — балки 4×0.5 встык над средней стеной
  const vaults = part({
    blocks: [
      blockOn('stone', 'slab', 20.5, y1, { vertical: true }),
      blockOn('stone', 'slab', 24, y1, { vertical: true, id: 'средняя-стена' }),
      blockOn('stone', 'slab', 27.5, y1, { vertical: true }),
      blockOn('stone', 'beam', 22, y1 + 2),
      blockOn('stone', 'beam', 26, y1 + 2),
    ],
  });
  const y2 = y1 + 2.5;
  const galleryL = frame({ x: 22, y: y2, span: 4, h: 2, col: 'stone', beam: 'stone' });
  const galleryR = frame({ x: 26, y: y2, span: 4, h: 2, col: 'stone', beam: 'stone' });
  // пол залы — каменная балка 5×0.5 поперёк стыка балок галереи (король не стоит на стыке — на стыке он скатывается)
  const floor3 = blockOn('stone', 'longBeam', 24, galleryL.top, { id: 'пол-залы' });
  const throne = hall({ x: 24, y: galleryL.top + 0.5, baseMat: 'stone', colMat: 'stone', roofMat: 'stone' });
  const y3 = galleryL.top;
  const balls = part({
    blocks: [
      blockOn('stone', 'ball1', 21, y3, { id: 'шар-левый' }),
      blockOn('stone', 'cube', 20.25, y3, { id: 'стопор-левый' }),
      blockOn('stone', 'ball1', 27, y3, { id: 'шар-правый' }),
      blockOn('stone', 'cube', 27.75, y3, { id: 'стопор-правый' }),
    ],
  });
  const watchR = tower({ x: 32, floors: 2, span: 3, mats: 'ice', roof: 'ice' });
  return level({
    id: '3-10',
    name: 'Цитадель короля',
    birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'],
    terrain: [flatGround(), plateau(20, 28, 1)],
    parts: [iceWall, watchL, vaults, galleryL, galleryR, part({ blocks: [floor3] }), throne, balls, watchR],
    tnt: [tntOn(12.5, 0), tntOn(21.5, y1), tntOn(26.5, y1)],
    pigs: [
      pigIn('king', throne.spots[0]),
      pigIn('mustache', galleryL.spots[0]),
      pigIn('medium', galleryR.spots[0]),
      pigOn('helmet', 22.85, y1),
      pigOn('helmet', 25.15, y1),
      pigIn('small', watchL.spots[1]),
      pigIn('medium', watchR.spots[0]),
      pigIn('small', watchR.spots[1]),
    ],
    hint: 'Короля берёт только взрыв: Бомб у залы или яйцо Матильды на крышу',
    camera: { castle: { x: 23, y: 5, viewH: 17 } },
    stars: { one: 0, two: 62_000, three: 76_000 },
    meta: { nMin: 6, difficulty: 10, teach: 'финал: все птицы, каждой своя цель; король под каменной крышей — цель взрыва', starsSource: 'solver', calib: { expertBirds: 5, expertScore: 94458, solverSec: 64.7, evaluations: 1628, silverLateTaps: 1, altBirds: 6, altScore: 89331 } },
    decor: [dec('pine', 2.5), dec('snowman', 6), dec('pine', 9.5, 0, 1.1), dec('sign', 11), dec('rock', 18.9, 0, 0.5), dec('rock', 29.3, 0, 0.6), dec('pine', 35.5, 0, 1.2), dec('snowman', 38.5, 0, 1, true), dec('pine', 42, 0, 0.9)],
  });
}

export const EPISODE3_LEVELS: LevelDef[] = [L3_1(), L3_2(), L3_3(), L3_4(), L3_5(), L3_6(), L3_7(), L3_8(), L3_9(), L3_10()];
