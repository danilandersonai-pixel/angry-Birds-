// Эпизод 3 «Снежные вершины» (snow): + Terence (3-1), лёд, лавина, пещера, Silver (3-6), рогатка на холме (3-7),
// финальный король (3-10). Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Общие соглашения эпизода (ревью «арт и ощущения»: длинные низкие уровни — мелкие персонажи и пустое небо):
// - рогатка в (0, 0) → ANCHOR (0, 2.7) или на насыпи 2–3 м (slingHill); площадка очереди ровная;
// - сооружения — вертикальные композиции на x ≈ 6…20 (правый край контента ≤ 20 м), верх 6.5–10 м; цели Terence —
//   не дальше ≈ 17 м и низко (огибающая с земли над x = 12 / 15 / 18: 8.5 / 6.5 / 4.2 м);
// - bounds.maxX = правый край контента + 12 (на уровнях с Хэлом — + 14 под разворот бумеранга);
// - доля материалов по числу блоков ≈ дерево 30 % / лёд 40 % / камень 30 % (06 §9.3), тел 30–60, босс ≤ 80;
// - звёзды, nMin и линия эксперта — src/levels/calib.ts (scripts/level-calibrate.ts: устойчивая линия решателя,
//   2★ — медиана счёта под «мелким» шумом, 3★ — 80-й перцентиль); stars ниже — черновые, до калибровки.
// Камера (вид рогатки, облёт) считает кадр сама по габариту контента — level.camera не задаём.
// Декор: y — поверхность, на которой стоит предмет (рисуется рендером без физики).

import type { DecorDef, LevelDef, TerrainDef } from '../core/types';
import type { Part } from './prefabs';
import { calibrated } from './calib';
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
 * Каменный донжон на x = 11: два бункера друг на друге (стены — кладка каменных квадратов толщиной 1 м, перекрытия
 * ледяные) с large в каждом, сверху ледяная рама span 4 со small под ледяным щипцом (верх 9). Настильный удар Теренса
 * в кладку роняет весь донжон — крупная цель: попадание в любую из четырёх стен. По бокам ледяные пристройки
 * (сторожка слева, рама с зубцами справа). Small — в ледяной будке на снежном уступе (x = 18.5, 1.5 м) — цель Реда.
 * Свиньи: 2 large и small в донжоне, small в будке. Учит: Terence ломает камень массой (5 кг), цели ему — поближе.
 */
export function L3_1(): LevelDef {
  const f1 = keepFloor(11, 0);
  const f2 = keepFloor(11, f1.top);
  const attic = frame({ x: 11, y: f2.top, span: 4, h: 2, col: 'ice', beam: 'ice' });
  const gable = roof({ x: 11, y: attic.top, w: 4, mat: 'ice' });
  const lodge = frame({ x: 7.75, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const lodgeRoof = roof({ x: 7.75, y: lodge.top, w: 2, mat: 'ice' });
  const wing = frame({ x: 14.25, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const ledge = 1.5;
  const booth = hut({ x: 18.5, y: ledge, span: 2, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '3-1',
    name: 'Старший брат',
    birds: ['terence', 'red', 'terence'],
    terrain: [flatGround(), plateau(17.5, 60, ledge, { slope: [2.2, 0], kind: 'ground' })],
    bounds: { maxX: 31 },
    parts: [lodge, lodgeRoof, f1, f2, attic, gable, wing, booth],
    blocks: [blockOn('ice', 'cube', 13.75, wing.top), blockOn('ice', 'cube', 14.75, wing.top)],
    pigs: [pigIn('large', f1.spots[0]), pigIn('large', f2.spots[0]), pigIn('small', attic.spots[0]), pigIn('small', booth.spots[0])],
    hint: 'Теренс тяжёлый: он проломит каменную кладку, а камень Реду не по зубам',
    stars: { one: 0, two: 21_000, three: 33_000 },
    meta: { nMin: 2, difficulty: 6, teach: 'Terence: масса 5 кг ломает камень, цели ближе', starsSource: 'solver' },
    decor: [dec('pine', 2.8), dec('snowman', 5), dec('rock', 16, 0, 0.6), dec('pine', 20.8, ledge, 0.8), dec('pine', 23, ledge, 1.2), dec('snowman', 25.5, ledge, 0.9, true)],
  });
}

/**
 * 3-2 «Ледяной дворец» · d 6 · N 4 (nMin 3)
 * Рогатка на насыпи 2 м. Дворец изо льда в три объёма: главная башня в 3 этажа (рамы 4×2.5, x = 13.5) на каменном
 * цоколе (балка 5×0.5) под ледяным щипцом — верх 9.5; слева двухэтажное ледяное крыло span 3 (x = 8.5), справа крыло
 * span 3 (x = 18) с деревянным перекрытием 1-го этажа; у крыльев скатные крыши из ледяных треугольников. 1-й этаж
 * башни на каменных колоннах. Лёд на льду скользит (μ 0.25): выбитая колонна — и этажи съезжают.
 * Свиньи: medium и small в башне (1-й и 3-й этаж), small на 2-м этаже левого крыла, medium и small в правом крыле.
 * Учит: лёд хрупкий и скользкий, Blues против льда.
 */
export function L3_2(): LevelDef {
  const H = 2;
  const plinth = part({ blocks: [blockOn('stone', 'longBeam', 13.5, 0, { id: 'цоколь' })] });
  const keep = tower({ x: 13.5, y: 0.5, floors: 3, mats: [{ col: 'stone', beam: 'ice' }, 'ice', 'ice'], roof: 'ice' });
  const wingL = tower({ x: 8.5, floors: 2, span: 3, mats: 'ice', roof: { mat: 'ice', w: 4, kind: 'tris' } });
  const wingR = tower({ x: 18, floors: 2, span: 3, mats: [{ col: 'ice', beam: 'wood' }, 'ice'], roof: { mat: 'ice', w: 4, kind: 'tris' } });
  return level({
    id: '3-2',
    name: 'Ледяной дворец',
    birds: ['blues', 'blues', 'chuck', 'blues'],
    slingshot: slingshotOn(0, H),
    terrain: [flatGround(), slingHill(H)],
    bounds: { maxX: 32 },
    parts: [wingL, plinth, keep, wingR],
    pigs: [
      pigIn('medium', keep.spots[0]),
      pigIn('small', keep.spots[2]),
      pigIn('small', wingL.spots[1]),
      pigIn('medium', wingR.spots[0]),
      pigIn('small', wingR.spots[1]),
    ],
    hint: 'Лёд скользкий и хрупкий: Синие колют его лучше всех',
    stars: { one: 0, two: 32_000, three: 45_000 },
    meta: { nMin: 3, difficulty: 6, teach: 'ледяные конструкции: хрупкость и скольжение (μ 0.25), Blues против льда', starsSource: 'solver' },
    decor: [dec('pine', -4, H), dec('snowman', -7, H), dec('pine', 21.5, 0, 1.1), dec('snowman', 24, 0, 0.9, true)],
  });
}

/**
 * 3-3 «Лавина» · d 7 · N 4 (nMin 2)
 * Снежный склон hill(0, 4.5, 8, 13, 3.1): подъём от рогатки 35° и скат 8 → 13 (32°) к домикам. Наверху каменный шар
 * ⌀2 у кромки в колыбели из ледяных кубиков. Толчок в шар (или выбитый стопор) — шар скатывается, разгоняется и
 * таранит колонну двухэтажного ледяного домика span 3 у подножия (x = 14.75, деревянная крыша; medium и small). За
 * ним в проулке small (x = 16.8) и ледяная вышка в 2 этажа span 2 на скальной ступени 1.25 м (x = 18.5): small на
 * каждом этаже — ступень останавливает шар, вышка — для второй птицы. Учит: косвенная атака — вызвать лавину.
 */
export function L3_3(): LevelDef {
  const SLOPE_H = 3.1;
  const slope = hill(0, 4.5, 8, 13, SLOPE_H);
  const balls = part({
    blocks: [
      blockOn('stone', 'ball2', 6.62, SLOPE_H, { id: 'шар' }),
      blockOn('ice', 'cube', 5.49, SLOPE_H),
      blockOn('ice', 'cube', 7.75, SLOPE_H, { id: 'стопор-у-кромки' }),
    ],
  });
  const step = 1.25;
  const cabin1 = frame({ x: 14.75, span: 3, col: 'ice', beam: 'ice' });
  const cabin = hut({ x: 14.75, y: cabin1.top, span: 3, col: 'ice', beam: 'ice', roofMat: 'wood' });
  const lodge = tower({ x: 18.5, y: step, floors: 2, span: 2, mats: [{ col: 'ice', beam: 'wood' }, 'ice'], roof: 'ice' });
  return level({
    id: '3-3',
    name: 'Лавина',
    birds: ['chuck', 'red', 'bomb', 'matilda'],
    terrain: [flatGround(), slope, plateau(17.25, 20.5, step, { slope: [0, 2.2] })],
    bounds: { maxX: 32 },
    parts: [balls, cabin1, cabin, lodge],
    pigs: [pigIn('medium', cabin1.spots[0]), pigIn('small', cabin.spots[0]), pigOn('small', 16.8, 0), pigIn('small', lodge.spots[0]), pigIn('small', lodge.spots[1])],
    hint: 'Столкните каменный шар со склона',
    stars: { one: 0, two: 34_000, three: 45_000 },
    meta: { nMin: 2, difficulty: 7, teach: 'лавина: шар со склона — косвенное убийство', starsSource: 'solver' },
    decor: [dec('pine', 2, 3.1 * (2 / 4.5), 0.7), dec('pine', 10, 3.1 * (3 / 5), 0.8), dec('rock', 12.1, 3.1 * (0.9 / 5), 0.6), dec('pine', 23, 0, 0.9), dec('rock', 25, 0, 1.1, true)],
  });
}

/**
 * 3-4 «Пещера» · d 7 · N 4 (nMin 3)
 * Скальный массив: потолок пещеры — скала x 9…17, y 4…5, задняя стена x = 17 и гребень справа. Вход слева высотой 4
 * на x = 9 закрыт баррикадой: стопка 2 деревянных квадратов (x = 9.5) + каменная колонна 0.5×2 перед ней. Внутри
 * деревянная рама span 3 (x = 12: medium внутри, small на балке между кубиками) и узкая рама span 2 (x = 15.5:
 * small). На потолке ледяная вышка в 2 этажа над входом (x = 10), ледяной домик span 3
 * (x = 13.5, small) и каменный тур (x = 16). Внутрь попадают только настильные выстрелы ≈ 5–15°: навес упирается в
 * скалу; домик наверху — цель навеса. Свиньи: medium + 2 small в пещере, small в домике наверху.
 * Учит: настильный выстрел и мощь (Chuck, Terence).
 */
export function L3_4(): LevelDef {
  const massif: TerrainDef = {
    kind: 'rock',
    points: [
      [9, 4],
      [17, 4],
      [17, 0],
      [28.5, 0],
      [19.5, 6],
      [17.5, 5],
      [9, 5],
    ],
  };
  const barricade = stack({ x: 9.5, n: 2, kind: 'square', mat: 'wood' });
  const post = blockOn('stone', 'column', 8.75, 0, { id: 'каменная-стойка' });
  const shed = frame({ x: 12, span: 3, h: 2 });
  const nook = frame({ x: 15.5, span: 2, h: 2 });
  const lodge = hut({ x: 13.5, y: 5, span: 3, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const watch = tower({ x: 10, y: 5, floors: 2, span: 2, mats: 'ice' });
  const cairn = pyramid({ x: 16.25, y: 5, rows: 2, mat: 'stone' });
  const crates = [blockOn('wood', 'cube', 11, shed.top), blockOn('wood', 'cube', 13, shed.top)];
  const watchTop = [blockOn('ice', 'cube', 9.25, watch.top), blockOn('ice', 'cube', 10.75, watch.top), blockOn('ice', 'brick', 10, watch.top)];
  return level({
    id: '3-4',
    name: 'Пещера',
    birds: ['chuck', 'terence', 'bomb', 'red'],
    terrain: [flatGround(), massif],
    bounds: { maxX: 31 },
    parts: [barricade, shed, nook, lodge, watch, cairn],
    blocks: [post, ...crates, ...watchTop],
    pigs: [pigIn('medium', shed.spots[0]), pigIn('small', shed.spots[1]), pigIn('small', nook.spots[0]), pigIn('small', lodge.spots[0])],
    hint: 'Стреляйте полого — навесом в пещеру не попасть',
    stars: { one: 0, two: 27_000, three: 40_000 },
    meta: { nMin: 3, difficulty: 7, teach: 'пещера под скальным потолком: только настильные выстрелы и мощь', starsSource: 'solver' },
    decor: [dec('pine', 2.5), dec('snowman', 5), dec('pine', 7, 0, 0.9), dec('rock', 17.6, 5.05, 0.5), dec('pine', 21.5, 4.4, 0.7), dec('pine', 28, 0, 1.1, true)],
  });
}

/**
 * 3-5 «Три террасы» · d 7 · N 5 (nMin 4)
 * Рогатка на насыпи 2 м. Скальные террасы ступенями: 7.5…11.5 на высоте 1, 11.5…15.5 на 2, 15.5…20 на 3 (один профиль
 * рельефа). Ближняя — ледяной домик span 4 (x = 9.5) с medium и small, средняя — деревянная башня в 2 этажа
 * (x = 13.5, верх 9) под деревянной скатной крышей с large и small, дальняя — каменный бункер (x = 17.75) с medium
 * внутри и small на крыше между ледяными зубцами. Обломки верхних террас сыплются на нижние.
 * Свиньи: по 2 на террасу. Учит: порядок целей ближняя → дальняя, какая птица куда долетает.
 */
export function L3_5(): LevelDef {
  const H = 2;
  const terraces = profile(
    [
      [5.5, 0],
      [7.5, 1],
      [11.5, 1],
      [11.5, 2],
      [15.5, 2],
      [15.5, 3],
      [20, 3],
      [24.5, 0],
    ],
    { bottom: -2, kind: 'rock' },
  );
  const igloo = hut({ x: 9.5, y: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const keep = tower({ x: 13.5, y: 2, floors: 2, roof: { mat: 'wood', kind: 'tris' } });
  const vault = bunker({ x: 17.75, y: 3, inner: 2, h: 1.5 });
  const steps = [blockOn('stone', 'cube', 19.75, 3)];
  return level({
    id: '3-5',
    name: 'Три террасы',
    birds: ['red', 'hal', 'matilda', 'bomb', 'blues'],
    slingshot: slingshotOn(0, H),
    terrain: [flatGround(), slingHill(H), terraces],
    bounds: { minX: -14, maxX: 34 },
    parts: [igloo, keep, vault],
    blocks: [blockOn('ice', 'cube', 16.5, vault.top), blockOn('ice', 'cube', 19, vault.top), ...steps],
    pigs: [
      pigIn('medium', igloo.spots[0], -0.75),
      pigIn('small', igloo.spots[0], 0.9),
      pigIn('large', keep.spots[0]),
      pigIn('small', keep.spots[1]),
      pigIn('medium', vault.spots[0]),
      pigIn('small', vault.spots[1]),
    ],
    stars: { one: 0, two: 36_000, three: 48_000 },
    meta: { nMin: 4, difficulty: 7, teach: 'три яруса целей: порядок ближняя → дальняя, досягаемость птиц', starsSource: 'solver' },
    decor: [dec('pine', -4, H), dec('snowman', -8, H), dec('pine', 6.2, 0.35, 0.7), dec('rock', 21, 2.3, 0.6), dec('pine', 25, 0, 1.1, true)],
  });
}

/**
 * 3-6 «Серебряная петля» · d 7 · N 3 (nMin 2) · ввод Silver
 * Три каменных «сэндвича» — каменная доска 2×0.5 на двух каменных опорах, ячейка 1×1 под small (со всех сторон камень):
 * A на земле (x = 8.5, опоры 1×1), B и C — на ледяной полке (longBeam 5×0.5 на деревянных сваях 4 м, x = 14), опоры у
 * них — бруски 0.5×1; на доске C — medium. Пике Silver пробивает доску (×3.0 по камню) и давит small; пике в щель
 * между B и C (или Red в сваю) ломает полку — оба сэндвича и medium падают с 4.5 м. Между A и полкой — валун 0.8 м.
 * Позади ледяная горка в 2 ряда. Свиньи: 3 small под досками, medium на доске C.
 * Учит: петля и пике Silver ломают камень сверху.
 */
export function L3_6(): LevelDef {
  const a = sandwich(8.5, 0);
  const piles = part({
    blocks: [
      blockOn('wood', 'column', 11.75, 0),
      blockOn('wood', 'column', 11.75, 2),
      blockOn('wood', 'column', 16.25, 0),
      blockOn('wood', 'column', 16.25, 2),
      blockOn('ice', 'longBeam', 14, 4, { id: 'ледяная-полка' }),
    ],
  });
  const b = sandwich(12.5, 4.5, 'brick');
  const c = sandwich(15.5, 4.5, 'brick');
  const lidC = c.blocks[2];
  const drift = pyramid({ x: 19, rows: 2, mat: 'ice' });
  return level({
    id: '3-6',
    name: 'Серебряная петля',
    birds: ['silver', 'silver', 'red'],
    terrain: [flatGround(), plateau(10.6, 11, 0.8, { slope: 0.3 })],
    bounds: { maxX: 32 },
    parts: [a, piles, b, c, drift],
    pigs: [pigIn('small', a.spots[0]), pigIn('small', b.spots[0]), pigIn('small', c.spots[0]), pigOnBlock('medium', lidC, 0, { fragile: true })],
    hint: 'Коснитесь экрана над целью — Сильвер сделает петлю и ударит сверху',
    stars: { one: 0, two: 25_000, three: 37_000 },
    meta: { nMin: 2, difficulty: 7, teach: 'Silver: петля и пике пробивают каменную доску сверху', starsSource: 'solver' },
    decor: [dec('pine', 2.8), dec('snowman', 5.5), dec('pine', 21.5, 0, 1.1), dec('snowman', 24, 0, 0.8, true)],
  });
}

/**
 * 3-7 «Крепость на утёсе» · d 8 · N 6 (nMin 5)
 * Рогатка на снежном холме: основание y = 3, ANCHOR (0, 5.7), откос 34°. Утёс plateau(11, 20, 3) с отвесной стеной к
 * рогатке. На нём крепость: две башни span 3 в 2 этажа (x = 13.5 и 18; 1-й этаж — каменные колонны и деревянная
 * балка, 2-й — деревянные, верх 8), между крышами ледяной мост longBeam 5×0.5 (x = 15.75) с medium, по краям
 * каменные зубцы. Под утёсом на земле деревянный домик (x = 8.25) с small.
 * Свиньи: 2 helmet на 1-х этажах, small на 2-м этаже левой башни, medium на мосту, small в домике.
 * Учит: высота рогатки меняет углы — с холма птица летит дальше и выше.
 */
export function L3_7(): LevelDef {
  const cliffTop = 3;
  const mats = [{ col: 'stone' as const, beam: 'wood' as const }, 'wood' as const];
  const towerL = tower({ x: 13.5, y: cliffTop, floors: 2, span: 3, mats });
  const towerR = tower({ x: 18, y: cliffTop, floors: 2, span: 3, mats });
  const bridge = blockOn('ice', 'longBeam', 15.75, towerL.top, { id: 'ледяной-мост' });
  const merlons = [blockOn('stone', 'cube', 11.75, towerL.top), blockOn('stone', 'cube', 19.75, towerR.top)];
  const house = hut({ x: 8.25 });
  return level({
    id: '3-7',
    name: 'Крепость на утёсе',
    birds: ['red', 'chuck', 'matilda', 'silver', 'bomb', 'red'],
    slingshot: slingshotOn(0, 3),
    terrain: [flatGround(), slingHill(3, { slope: 4.5 }), plateau(11, 20, cliffTop, { slope: [0, 4.5] })],
    bounds: { minX: -14, maxX: 32 },
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
    stars: { one: 0, two: 31_000, three: 44_000 },
    meta: { nMin: 4, difficulty: 8, teach: 'рогатка на холме: другие углы, крепость на утёсе', starsSource: 'solver' },
    decor: [dec('pine', -6, 3), dec('snowman', -9, 3, 0.8), dec('rock', 11.45, cliffTop, 0.5), dec('pine', 21.5, 3 * (1 - 1.5 / 4.5), 0.8), dec('pine', 25.5, 0, 1.2, true)],
  });
}

/**
 * 3-8 «Ледяной мост» · d 8 · N 5 (nMin 4)
 * Рогатка на насыпи 2 м. Утёсы plateau(5.5, 10, 4) и plateau(17.5, 21, 4), пропасть 7.5 м (дно y = 0, падение 4 м
 * убивает small и medium). Мост — 2 ледяные балки 4×0.5 (9.75–17.75, на утёсы по 0.25), стык на ледяной свае 0.5×4
 * (две колонны) x = 13.75. На мосту ледяной домик span 2 (x = 11) с small, 2 medium и каменный шар ⌀1 в колыбели между
 * ними. На левом утёсе — каменный бункер с кладкой стен (как донжон 3-1, x = 7.75) под каменной балкой и ледяным
 * щипцом с large: его берёт только Terence. На правом утёсе низкая (h 1) ледяная сторожка под крышей (x = 19) с small.
 * Свиньи: 2 medium на мосту, small в домике, small в сторожке, large в бункере.
 * Учит: обрушить мост вместо пробивания каждой свиньи; Terence — на каменный бункер.
 */
export function L3_8(): LevelDef {
  const H = 2;
  const cliffTop = 4;
  const piles = [blockOn('ice', 'column', 13.75, 0), blockOn('ice', 'column', 13.75, 2)];
  const deck = [11.75, 15.75].map((x, i) => blockOn('ice', 'beam', x, cliffTop, { id: `мост-${i + 1}` }));
  const booth = hut({ x: 11, y: cliffTop + 0.5, span: 2, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const ball = cradleOn(14.9, cliffTop + 0.5);
  const vault = keepFloor(7.75, cliffTop, 'stone');
  const vaultRoof = roof({ x: 7.75, y: vault.top, w: 4, mat: 'ice' });
  const lookout = hut({ x: 19, y: cliffTop, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  const props = [blockOn('ice', 'cube', 17.5, cliffTop + 0.5, { id: 'упор-у-края-моста' })];
  return level({
    id: '3-8',
    name: 'Ледяной мост',
    birds: ['blues', 'hal', 'chuck', 'terence', 'red'],
    slingshot: slingshotOn(0, H),
    terrain: [flatGround(), slingHill(H), plateau(5.5, 10, cliffTop), plateau(17.5, 21, cliffTop, { slope: [0, 6] })],
    bounds: { minX: -14, maxX: 34 },
    parts: [vault, vaultRoof, part({ blocks: [...piles, ...deck] }), booth, ball, lookout],
    blocks: props,
    pigs: [pigIn('large', vault.spots[0]), pigIn('small', booth.spots[0]), pigOn('medium', 12.8, cliffTop + 0.5), pigOn('medium', 16.6, cliffTop + 0.5), pigIn('small', lookout.spots[0])],
    hint: 'Сломайте сваю — мост рухнет в пропасть',
    stars: { one: 0, two: 31_000, three: 44_000 },
    meta: { nMin: 4, difficulty: 8, teach: 'ледяной мост над пропастью: обрушение вместо точечных попаданий', starsSource: 'solver' },
    decor: [dec('snowman', -4, H, 0.8), dec('pine', -7, H, 0.7), dec('rock', 12.3, 0, 0.9), dec('pine', 22.3, cliffTop * (1 - 1.3 / 6), 0.7), dec('pine', 27, 0, 1.1, true)],
  });
}

/**
 * 3-9 «Склад на льду» · d 9 · N 5 (nMin 4)
 * Рогатка на насыпи 2 м. Склад из четырёх частей, у каждой свой «ключ»; части разнесены по x и по высоте:
 * - A: каменный бункер span 3.5 (x = 7.25) — TNT у левой стены и medium; на крыше ледяная будка со small;
 * - скала-останец 9.5…12.5 высотой 5 м: на ней деревянная клетка span 3 с каской — её добивают прямым ударом;
 * - B: скальный уступ 12.5…16.5 высотой 3 м — ледяной навес span 4 (x = 14.5) над двумя TNT (зазор 1 м) со small между
 *   ними, второй small на навесе;
 * - C: ледяная вышка span 2 в 2 этажа (x = 19) с small на каждом — взрыв уступа до неё не достаёт (3.1 м).
 * Свиньи: helmet, medium, 5 small. Учит: управляемая цепочка TNT — какой ящик и когда поджечь.
 */
export function L3_9(): LevelDef {
  const H = 2;
  const vaultA = bunker({ x: 7.25, inner: 2.5, h: 2 });
  const boothA = frame({ x: 7.25, y: vaultA.top, span: 2, h: 2, col: 'ice', beam: 'ice' });
  const spire = 5;
  const cage = frame({ x: 11, y: spire, span: 3, h: 2, col: 'wood', beam: 'wood' });
  const ledge = 3;
  const shelter = frame({ x: 14.5, y: ledge, span: 4, h: 2, col: 'ice', beam: 'ice' });
  const towerC = tower({ x: 19, floors: 2, span: 2, mats: [{ col: 'wood', beam: 'ice' }, 'ice'], roof: { mat: 'ice', w: 2 } });
  // останец и уступ — один профиль: 9.5…12.5 на 5 м, 12.5…16.5 на 3 м
  const rocks = profile(
    [
      [9.5, 0],
      [9.5, spire],
      [12.5, spire],
      [12.5, ledge],
      [16.5, ledge],
      [16.5, 0],
    ],
    { bottom: -2, kind: 'rock' },
  );
  const props = [blockOn('ice', 'cube', 5.75, vaultA.top), blockOn('ice', 'cube', 8.75, vaultA.top), blockOn('ice', 'cube', 12.75, shelter.top), blockOn('ice', 'cube', 16.25, shelter.top)];
  return level({
    id: '3-9',
    name: 'Склад на льду',
    birds: ['bomb', 'silver', 'matilda', 'chuck', 'hal'],
    slingshot: slingshotOn(0, H),
    terrain: [flatGround(), slingHill(H), rocks],
    bounds: { minX: -14, maxX: 34 },
    parts: [vaultA, boothA, cage, shelter, towerC],
    blocks: props,
    tnt: [tntOn(6.5, 0), tntOn(13.5, ledge), tntOn(15.5, ledge)],
    pigs: [
      pigOn('medium', 7.9, 0),
      pigIn('small', boothA.spots[0]),
      pigIn('helmet', cage.spots[0]),
      pigOn('small', 14.5, ledge),
      pigOn('small', 14.5, shelter.top),
      pigIn('small', towerC.spots[0]),
      pigIn('small', towerC.spots[1]),
    ],
    hint: 'У каждой части склада свой ящик: подожгите их по очереди',
    stars: { one: 0, two: 42_000, three: 55_000 },
    meta: { nMin: 4, difficulty: 9, teach: 'управляемая цепочка TNT: у каждой части склада свой ящик и своя птица', starsSource: 'solver' },
    decor: [dec('pine', -4, H), dec('snowman', -7, H), dec('pine', 22.5, 0, 0.8), dec('pine', 25, 0, 1.1), dec('snowman', 27.5, 0, 0.9, true)],
  });
}

/**
 * 3-10 «Цитадель короля» (финал) · d 10 · N 8 (nMin 6)
 * Рогатка на насыпи 2 м.
 * - впереди ледяная стена: 4 квадрата 1×1 столбом на x = 6.75, перед ней TNT (x = 5.5) — ключ к стене и левой
 *   сторожевой башне (x = 8.5, span 2, 2 этажа дерево/лёд, small);
 * - цитадель на x = 14: 1-й ярус — две каменные камеры с толстыми стенами (вертикальные плиты 1×2, общая средняя
 *   стена, перекрытия — каменные балки 4×0.5), в каждой TNT у наружной стены и каска у средней;
 * - 2-й ярус — каменные рамы span 4 (mustache слева, medium справа), по бокам на перекрытии каменные шары ⌀1
 *   в колыбелях; 3-й ярус — зала короля на каменных опорах по 3 м под каменной балкой (пол — балка 5×0.5), верх 9;
 * - правая сторожевая башня (x = 19, span 2, лёд, 2 этажа: small на каждом).
 * Свиньи: king, mustache, 2 helmet, medium, 3 small. Учит: финал — каждой птице своя цель; король — взрывом.
 */
export function L3_10(): LevelDef {
  const H = 2;
  const cx = 14;
  const iceWall = stack({ x: 6.75, n: 4, kind: 'square', mat: 'ice' });
  const watchL = tower({ x: 8.5, floors: 2, span: 2, mats: ['wood', 'ice'], roof: { mat: 'wood', w: 2 } });
  const y1 = 0;
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
  const watchR = tower({ x: 19, floors: 2, span: 2, mats: 'ice', roof: { mat: 'ice', w: 2 } });
  return level({
    id: '3-10',
    name: 'Цитадель короля',
    birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'],
    slingshot: slingshotOn(0, H),
    terrain: [flatGround(), slingHill(H)],
    bounds: { minX: -16, maxX: 34 },
    parts: [iceWall, watchL, vaults, galleryL, galleryR, part({ blocks: [floor3] }), throne, balls, watchR],
    tnt: [tntOn(5.5, 0), tntOn(cx - 2.5, y1), tntOn(cx + 2.5, y1)],
    pigs: [
      pigIn('king', throne.spots[0]),
      pigIn('mustache', galleryL.spots[0]),
      pigIn('medium', galleryR.spots[0]),
      pigOn('helmet', cx - 1.15, y1),
      pigOn('helmet', cx + 1.15, y1),
      pigIn('small', watchL.spots[1]),
      pigIn('small', watchR.spots[0]),
      pigIn('small', watchR.spots[1]),
    ],
    hint: 'Короля берёт только взрыв: Бомб у залы или яйцо Матильды на крышу',
    stars: { one: 0, two: 62_000, three: 76_000 },
    meta: { nMin: 6, difficulty: 10, teach: 'финал: все птицы, каждой своя цель; король под каменной крышей — цель взрыва', starsSource: 'solver' },
    decor: [dec('pine', -4, H), dec('snowman', -11, H), dec('sign', -13, H), dec('pine', 22.5, 0, 1.2), dec('snowman', 25.5, 0, 1, true)],
  });
}

export const EPISODE3_LEVELS: LevelDef[] = [L3_1(), L3_2(), L3_3(), L3_4(), L3_5(), L3_6(), L3_7(), L3_8(), L3_9(), L3_10()].map(calibrated);
