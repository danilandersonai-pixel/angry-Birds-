// Эпизод 2 «Пляжный закат» (beach): + шары-валуны, Matilda (2-2), пропасть и мост, Hal (2-5), король (2-10).
// Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Общие соглашения эпизода:
// - рогатка в (0, 0) → ANCHOR (0, 2.7), площадка очереди ровная;
// - V_MAX 21 м/с: сооружения сдвинуты к рогатке (06 §2: зона 16…34 при V 24 × (21/24)²): цели на x ≈ 10.5…24.5 м,
//   правый край всего контента ≤ 25 м, верх ≤ 11 м — вид рогатки крупный (Ред ≥ 40 px на 1600×900). Огибающая Red
//   (высота центра птицы) над x = 15 / 18 / 20 / 22 / 24: 11.1 / 9.3 / 7.9 / 6.4 / 4.8 м, Matilda — 10.0 / 8.1 / 6.6 /
//   5.0 / 3.2, Bomb — 9.2 / 7.2 / 5.7 / 4.0 / 2.2: дальние свиньи — низко, высокие постройки — ближе;
// - bounds.maxX = правый край контента + 12 (на уровнях с Хэлом — с запасом под разворот бумеранга);
// - доля материалов по числу блоков ≈ дерево 45 % / лёд 20 % / камень 35 % (06 §9.3);
// - звёзды — по эксперту на настоящем ядре: suggestStars (06 §8.2, 3★ не выше счёта эксперта) по итогу
//   scripts/level-report.ts --solve (решатель по умолчанию; на 2-5 его тапы Хэла до 1.7 с находят бумеранг);
//   meta.starsSource = 'solver', в meta.calib — птиц и счёт эксперта, время решателя;
// - ни один уровень не проходится одной птицей: перебор первого выстрела (угол 2…76° через 2°, сила 0.6…1,
//   тапы решателя) не убивает всех свиней сразу.

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
  stack,
  tntOn,
  tower,
} from './prefabs';

/** Декор без физики (y — поверхность, на которой стоит объект). */
const dec = (kind: DecorDef['kind'], x: number, y = 0, scale?: number, flip?: boolean): DecorDef => {
  const d: DecorDef = { kind, x, y };
  if (scale !== undefined) d.scale = scale;
  if (flip) d.flip = true;
  return d;
};

/**
 * 2-1 «Валуны» · d 4 · N 4 (nMin 2)
 * Дюна hill(3.5, 8, 12.75, 17.25, 3): откосы 34°. На ровном верху — каменные шары ⌀2 и ⌀1 в колыбелях из деревянных
 * кубиков; правый стопор стоит заподлицо с кромкой ската. Толчок в шар (или выбитый стопор) — и шар скатывается и
 * врезается в колонну двухэтажного домика у подножия (x = 19.25); малый валун — «второй заход».
 * Справа на скальной ступени plateau(22.75, 25, 1.25) — ледяной сарай с ледяной крышей и small (x = 24): ступень
 * держит валун, сарай берётся навесом (Синие против льда), рывком Чака сверху или обломками домика, если обрушить
 * его вправо. При V 24 вместо ступени был каменный заслон, но при V 21 за ним сарай не брал никто, кроме Синих
 * (эксперт — 3 птицы). Свиньи: medium (1-й этаж) + small (2-й этаж) в домике, small в сарае.
 * Учит: косвенное убийство валуном и обломками.
 */
export function L2_1(): LevelDef {
  const dune = hill(3.5, 8, 12.75, 17.25, 3);
  // два валуна на ровном верху дюны: ⌀1 и ⌀2 из камня, общий средний стопор (зазоры 0.05, 06 S8)
  const boulders = part({
    blocks: [
      blockOn('stone', 'ball2', 11.2, 3, { id: 'валун-большой' }),
      blockOn('stone', 'ball1', 9.1, 3, { id: 'валун-малый' }),
      blockOn('wood', 'cube', 8.3, 3),
      blockOn('wood', 'cube', 9.9, 3),
      blockOn('wood', 'cube', 12.5, 3, { id: 'стопор-у-кромки' }),
    ],
  });
  const floor1 = tower({ x: 19.25, floors: 1 });
  const floor2 = hut({ x: 19.25, y: floor1.top });
  // ледяной сарай на скальной ступени 1.25 м: скатившийся валун в неё упирается, сарай — навесом или рывком сверху
  const iceShed = hut({ x: 24, y: 1.25, span: 2, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '2-1',
    name: 'Валуны',
    birds: ['red', 'chuck', 'blues', 'red'],
    terrain: [flatGround(), dune, plateau(22.75, 25, 1.25, { kind: 'rock' })],
    bounds: { maxX: 37 },
    parts: [boulders, floor1, floor2, iceShed],
    pigs: [pigIn('medium', floor1.spots[0]), pigIn('small', floor2.spots[0]), pigIn('small', iceShed.spots[0])],
    hint: 'Толкните валун — он скатится с дюны и раздавит домик',
    stars: { one: 0, two: 29_000, three: 41_000 },
    meta: {
      nMin: 2,
      difficulty: 4,
      teach: 'валун в колыбели: сбить стопор или толкнуть шар — косвенное убийство',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 44336, solverSec: 16.4, evaluations: 522 },
    },
    decor: [dec('shell', 1.6), dec('grass', 2.9, 0, 0.8), dec('sign', 6.5, 2), dec('grass', 8.6, 3, 0.7), dec('shell', 21.9, 0, 0.8), dec('rock', 26.5), dec('shell', 28, 0, 1.1, true)],
  });
}

/**
 * 2-2 «Яйцо сверху» · d 5 · N 3 (nMin 2) · ввод Matilda
 * Бухта между скалами plateau(10.5, 13.5, 4) и plateau(19.5, 25, 4), проём 6 м. Крыша на y = 4 — две деревянные
 * балки 4×0.5 на скалах и центральной стойке (вертикальная балка 4×0.5 на x = 16.5); на балках — каменные плиты над
 * свиньями с брусками сверху, ящик на стыке, ледяные бруски над скалами. Яйцо ломает балку — плита давит medium;
 * яйцо точно в стык ломает обе балки. Small — в низкой будке на ближней скале (x = 11.5), на дальней скале —
 * вышка и сарай (за целью). Перед ближней скалой — заслон из 3 каменных квадратов и штабель ящиков.
 * Свиньи: 2 medium под крышей, small в будке. Учит: Matilda — сброс яйца сверху; прямой выстрел упирается в скалу.
 */
export function L2_2(): LevelDef {
  const c = 16.5; // ось бухты (стойка); бухта c − 3 … c + 3
  const screen = stack({ x: c - 7, n: 3, kind: 'square', mat: 'stone' });
  const post = blockOn('wood', 'beam', c, 0, { vertical: true, id: 'стойка' });
  const beamL = B('wood', 'rect', c - 2, 4.25, 4, 0.5, 0, 'крыша-левая');
  const beamR = B('wood', 'rect', c + 2, 4.25, 4, 0.5, 0, 'крыша-правая');
  const slabL = blockOn('stone', 'slab', c - 1.5, 4.5);
  const slabR = blockOn('stone', 'slab', c + 1.5, 4.5);
  const ridge = blockOn('wood', 'square', c, 4.5, { id: 'ящик-на-стыке' });
  // на ближней скале — низкая будка с small (верх 6.5: не перекрывает полёт Матильды к бухте)
  const booth = hut({ x: c - 5, y: 4, span: 2, h: 1 });
  // на дальней скале — вышка и сарай (за целью: не мешают полёту над бухтой)
  const lookout = tower({ x: c + 5.1, y: 4, floors: 1, span: 2, mats: { col: 'wood', beam: 'ice' }, roof: 'wood' });
  const shed = hut({ x: c + 7.25, y: 4, span: 2, h: 1, roofMat: 'ice' });
  return level({
    id: '2-2',
    name: 'Яйцо сверху',
    birds: ['matilda', 'matilda', 'red'],
    terrain: [flatGround(), plateau(c - 6, c - 3, 4), plateau(c + 3, c + 8.5, 4)],
    bounds: { maxX: 37 },
    parts: [screen, booth, lookout, shed],
    blocks: [
      post,
      beamL,
      beamR,
      slabL,
      slabR,
      ridge,
      // ящики у скальных стен внутри бухты и ледяные бруски на концах крыши над скалами
      blockOn('wood', 'brick', c - 2.75, 0, { vertical: true }),
      blockOn('wood', 'brick', c + 2.75, 0, { vertical: true }),
      blockOn('ice', 'cube', c - 2.75, 1),
      blockOn('ice', 'cube', c + 2.75, 1),
      blockOn('ice', 'brick', c - 3.25, 4.5),
      blockOn('ice', 'brick', c + 3.25, 4.5),
      // груз на плитах: деревянные бруски (ещё очки за разрушение и мишень для яйца)
      blockOn('wood', 'brick', c - 1.5, 5.5),
      blockOn('wood', 'brick', c + 1.5, 5.5),
      // штабель ящиков перед заслоном
      blockOn('wood', 'square', c - 8.1, 0),
      blockOn('wood', 'square', c - 9.1, 0),
      blockOn('ice', 'square', c - 8.6, 1),
    ],
    pigs: [pigOn('medium', c - 1.5, 0), pigOn('medium', c + 1.5, 0), pigIn('small', booth.spots[0])],
    hint: 'Коснитесь экрана над целью — Матильда сбросит яйцо',
    stars: { one: 0, two: 22_000, three: 35_000 },
    meta: {
      nMin: 2,
      difficulty: 5,
      teach: 'Matilda: яйцо сверху пробивает крышу, прямой выстрел упирается в скалу',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 38255, solverSec: 22.6, evaluations: 637 },
    },
    decor: [dec('shell', 2.5), dec('bush', 5), dec('rock', c - 10.2, 0, 0.8), dec('grass', c + 10, 0), dec('shell', c + 12, 0, 0.9, true)],
  });
}

/**
 * 2-3 «Мост над пропастью» · d 5 · N 4 (nMin 3)
 * Утёсы plateau(8, 13, 4) (откос к рогатке 6 м) и plateau(17.5, 25, 4), пропасть 4.5 м до земли (глубина 4 м —
 * смертельна для small и medium). Мост — ледяной longBeam 5×0.5 на x = 15.25 (опирание по 0.25); на нём ледяная
 * рама span 3 с medium и ледяной крышей, на концах — ледяные кубики. На ближнем утёсе — штабель ящиков и каменный
 * частокол у въезда, на дне ущелья — ящик у стены и small. На дальнем утёсе — деревянный домик под каменной балкой
 * (x = 20.25, верх 8) и вышка-сторожка (x = 24).
 * При V 21 деревянный мост не ломался ни навесом, ни рывком: падали только рама и свинья на нём, а small на дне
 * оставался последним (эксперт — 4 птицы); ледяной мост рушится вместе с рамой и накрывает small. Домик на дальнем
 * утёсе — деревянный и ближе к пропасти: каменный домик за огибающей брался лишь четвёртой птицей.
 * Слабое место: сам мост (навес Реда сверху или рывок Чака). Small на дне добивает падающий мост.
 * Свиньи: medium на мосту, medium в домике, small в пропасти. Учит: сломать опору — свинья падает в пропасть.
 */
export function L2_3(): LevelDef {
  const bridge = B('ice', 'rect', 15.25, 4.25, 5, 0.5, 0, 'мост');
  const iceFrame = frame({ x: 15.25, y: 4.5, span: 3, h: 2, col: 'ice', beam: 'ice' });
  const iceCap = roof({ x: 15.25, y: iceFrame.top, w: 2, mat: 'ice' });
  // на дальнем утёсе — деревянный домик под каменной балкой и деревянной крышей
  const house = hut({ x: 20.25, y: 4, col: 'wood', beam: 'stone', roofMat: 'wood' });
  // за домиком — вышка-сторожка (за целью: очки за разрушение, в выстрел не мешает)
  const lookout = tower({ x: 24, y: 4, floors: 1, span: 2, mats: { col: 'wood', beam: 'ice' }, roof: 'wood' });
  return level({
    id: '2-3',
    name: 'Мост над пропастью',
    birds: ['red', 'chuck', 'matilda', 'blues'],
    terrain: [flatGround(), plateau(8, 13, 4, { slope: [6, 0] }), plateau(17.5, 25, 4, { slope: [0, 6] })],
    bounds: { maxX: 37 },
    parts: [palisade({ x: 11.25, y: 4, n: 3, kind: 'brick', mat: 'stone', vertical: true }), iceFrame, iceCap, house, lookout],
    blocks: [
      bridge,
      blockOn('ice', 'cube', 13.25, 4.5),
      blockOn('ice', 'cube', 17.25, 4.5),
      // ящик на дне ущелья у ближней стены: обломки моста ломают его вместе со свиньёй
      blockOn('wood', 'square', 13.5, 0),
      // штабель груза перед мостом на ближнем утёсе
      blockOn('wood', 'square', 8.75, 4),
      blockOn('wood', 'square', 9.75, 4),
      blockOn('ice', 'square', 9.25, 5),
    ],
    pigs: [pigIn('medium', iceFrame.spots[0]), pigIn('medium', house.spots[0]), pigOn('small', 15.5, 0)],
    hint: 'Сломайте мост — свиньи упадут в пропасть',
    stars: { one: 0, two: 20_000, three: 32_000 },
    meta: {
      nMin: 3,
      difficulty: 5,
      teach: 'пропасть и мост: смерть от падения',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 44887, solverSec: 10.4, evaluations: 500 },
    },
    decor: [dec('shell', 1.2), dec('grass', 4, 4 / 3, 0.8), dec('bush', 6.5, 3, 0.7), dec('sign', 12.4, 4), dec('grass', 27, 4 * (1 - 2 / 6), 0.7), dec('shell', 32, 0, 1, true)],
  });
}

/**
 * 2-4 «Песчаный замок» · d 6 · N 4 (nMin 3)
 * Ступенчатая пирамида на x = 19.5: 6 рядов (низ 16.5–22.5), нижние 2 ряда — камень, верхние — дерево.
 * Ниши (убранный квадрат, над нишей — плита-перемычка 2×1) во 2-м и 4-м рядах на оси x = 19.5 — по small.
 * Вершина — «донжон»: деревянная балка 4×0.5 на верхней плите с зубцами-кубиками по краям, на ней medium
 * (06 §10 ставит medium на вершину пирамиды — на квадрат 1×1 это хрупкое место, балка даёт ему 0.9 м с каждой стороны).
 * Справа — башенка (камень + дерево, 3.5 м). Деревянный домик с small отнесён влево (x = 10.5, в 4 м от пирамиды),
 * его колонна к замку — каменная: иначе взрыв Бомба в пирамиде (или на левой башенке, её при V 21 убрали) ломал
 * домик и брал все 4 свиньи одной птицей.
 * Слабые места: деревянные ряды (Chuck) и каменный низ у ниши (Bomb).
 * Свиньи: 2 small в нишах, medium на вершине, small в домике. Учит: разбор «массива», взрыв против камня.
 */
export function L2_4(): LevelDef {
  const X = 19.5;
  const castle = pyramid({ x: X, rows: 6, rowMats: ['stone', 'stone', 'wood', 'wood', 'wood', 'wood'], niches: [[1, 2], [3, 1]] });
  // Свинья в нише пирамиды стоит над стыком двух квадратов нижнего ряда, а на стыке (скруглённые углы коллизий) small
  // медленно скатывается (лабораторный T0: 0.08 м). Поэтому под нишами — цельные плиты 2×1: под верхней это
  // перемычка нижней ниши (её ставит pyramid), под нижней — каменная плита вместо двух квадратов 1-го ряда.
  // Верхний квадрат 6-го ряда убран: вместо него донжон на плите 5-го ряда (верх 5).
  const body = castle.blocks.filter((b) => !(b.y > 5 && b.x === X) && !(b.y === 0.5 && (b.x === X - 0.5 || b.x === X + 0.5)));
  const floorSlab = blockOn('stone', 'slab', X, 0, { id: 'пол-нижней-ниши' });
  const keepBeam = blockOn('wood', 'beam', X, 5, { id: 'донжон' });
  const merlons = [blockOn('wood', 'cube', X - 1.75, 5.5), blockOn('wood', 'cube', X + 1.75, 5.5)];
  // фланговая башенка замка: 2 каменных квадрата + деревянный квадрат + зубец-кубик
  const flank = (x: number) =>
    part({ blocks: [blockOn('stone', 'square', x, 0), blockOn('stone', 'square', x, 1), blockOn('wood', 'square', x, 2), blockOn('wood', 'cube', x, 3)] });
  // домик: колонна к замку — каменная (взрыв Бомба в пирамиде её не ломает)
  const hut0 = hut({ x: 10.5 });
  const house: Part = { ...hut0, blocks: hut0.blocks.map((b) => (b.x === 12.25 ? { ...b, material: 'stone' as const } : b)) };
  return level({
    id: '2-4',
    name: 'Песчаный замок',
    birds: ['bomb', 'matilda', 'chuck', 'red'],
    bounds: { maxX: 35 },
    parts: [house, flank(X + 3.5)],
    blocks: [floorSlab, ...body, keepBeam, ...merlons],
    pigs: [pigIn('small', castle.spots[1]), pigIn('small', castle.spots[2]), pigOnBlock('medium', keepBeam), pigIn('small', house.spots[0])],
    stars: { one: 0, two: 26_000, three: 39_000 },
    meta: {
      nMin: 3,
      difficulty: 6,
      teach: 'разбор массива: ниши в пирамиде, взрыв против камня',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 54197, solverSec: 26.2, evaluations: 579 },
    },
    decor: [dec('shell', 2.5), dec('bush', 5.5), dec('grass', 7.8), dec('shell', 14, 0, 0.8), dec('rock', 15.6, 0, 0.7), dec('grass', 25), dec('shell', 27, 0, 1, true)],
  });
}

/**
 * 2-5 «Бумеранг» · d 5 · N 4 (nMin 2) · ввод Hal
 * Стена — скала-останец plateau(11.5, 13.5, 5.5) (статичная: удар в неё не обрушивает её на постройки) с осыпью
 * каменных квадратов у подножия. За ней постройки с каменным фасадом и деревянным тылом: домик (x = 17.5) с medium и
 * двухэтажная башня (x = 22.5) с small на каждом этаже и на крыше, между ними ящики. Прямой выстрел упирается в скалу,
 * навес Реда и Бомба берёт постройки сверху. Hal перелетает постройки, тап у самой земли за ними (x ≈ 25–29) — петля
 * вверх-назад и удар в тыл башни и домика; за целями свободно до x ≈ 39.
 * Решатель по умолчанию (тапы Хэла до 1.7 с) находит бумеранг: эксперт — 2 Хэла.
 * Свиньи: 3 small, medium. Учит: Hal — удар с тыла.
 */
export function L2_5(): LevelDef {
  // стена — скала-останец 5.5 м (статичная: удар в неё не роняет её на постройки, бить можно только навесом или
  // бумерангом Хэла); у подножия — осыпь из каменных квадратов
  const rubble = part({
    blocks: [blockOn('stone', 'square', 11, 0), blockOn('stone', 'square', 10, 0), blockOn('stone', 'square', 11, 1), blockOn('stone', 'square', 14, 0), blockOn('stone', 'cube', 13.75, 1)],
  });
  // фасад к рогатке — каменные колонны, тыл — деревянные: фронтальный удар вязнет, удар Hal с тыла валит постройку
  // назад, от рогатки; между домиком и башней 1 м (ящики)
  const stoneFront = (p: Part, xFront: number): Part => ({ ...p, blocks: p.blocks.map((b) => (b.x === xFront ? { ...b, material: 'stone' as const } : b)) });
  const house = stoneFront(hut({ x: 17.5 }), 15.75);
  const keep = stoneFront(tower({ x: 22.5, floors: 2 }), 20.75);
  return level({
    id: '2-5',
    name: 'Бумеранг',
    birds: ['hal', 'hal', 'red', 'bomb'],
    terrain: [flatGround(), plateau(11.5, 13.5, 5.5, { kind: 'rock' })],
    bounds: { maxX: 40 },
    parts: [rubble, house, keep],
    // ящики между постройками и ледяные зубцы на крыше башни
    blocks: [blockOn('wood', 'square', 20, 0), blockOn('ice', 'cube', 20, 1), blockOn('ice', 'cube', 20.75, 5), blockOn('ice', 'cube', 24.25, 5)],
    pigs: [pigIn('medium', house.spots[0]), pigIn('small', keep.spots[0]), pigIn('small', keep.spots[1]), pigIn('small', keep.spots[2])],
    hint: 'Перелетите постройки и коснитесь экрана у самой земли — Хэл развернётся и ударит сзади',
    stars: { one: 0, two: 35_000, three: 47_000 },
    meta: {
      nMin: 2,
      difficulty: 5,
      teach: 'Hal: бумеранг через стену, удар с тыла',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 48543, solverSec: 13.5, evaluations: 944 },
    },
    decor: [dec('shell', 2.5), dec('grass', 4.5), dec('bush', 6.5), dec('rock', 8.6, 0, 0.8), dec('shell', 25.5, 0, 0.9), dec('grass', 27.5), dec('rock', 30, 0, 1.1, true)],
  });
}

/**
 * 2-6 «Пирс» · d 6 · N 4 (nMin 3)
 * Пирс из трёх независимых пролётов по 4 м (у каждого свои сваи, между настилами 0.5 м), верх настила 4.5:
 * ближний (x = 13) — на деревянных сваях из двух колонн 0.5×2 (4 м, стройность 8 — держатся только настилом),
 * средний (x = 17.5) — на каменных быках из квадратов 1×1 с деревянным домиком (helmet внутри), дальний (x = 22) —
 * снова на деревянных сваях. Ледяные настилы крайних пролётов, по краям — ящики, под средним пролётом на пляже small.
 * Рывок Чака валит ближний пролёт и вязнет в каменных быках; домик и дальний пролёт — Хэлом, яйцом или навесом.
 * Свиньи: 2 medium + helmet на настиле, small под ним. Учит: высокие сваи — слабое место, падение с 4.5 м.
 */
export function L2_6(): LevelDef {
  // три независимых пролёта (у каждого свои сваи, между настилами 0.5 м): крайние на деревянных сваях,
  // средний под домиком — на каменных. Рывок Чака валит ближний пролёт, но вязнет в каменных сваях —
  // дальний пролёт берётся навесом (Хэл, Ред), домик с каской — яйцом Матильды
  const span = (x: number, pile: 'wood' | 'stone', deck: 'ice' | 'wood') =>
    part({
      blocks: [
        ...[x - 1.75, x + 1.75].flatMap((px) => [blockOn(pile, 'column', px, 0), blockOn(pile, 'column', px, 2)]),
        B(deck, 'rect', x, 4.25, 4, 0.5),
      ],
    });
  const near = span(13, 'wood', 'ice');
  // средний пролёт — на каменных быках из квадратов 1×1 (их рывок Чака не опрокидывает)
  const mid = part({
    blocks: [...[16, 19].flatMap((px) => [0, 1, 2, 3].map((k) => blockOn('stone', 'square', px, k))), B('wood', 'rect', 17.5, 4.25, 4, 0.5)],
  });
  const far = span(22, 'wood', 'ice');
  const house = hut({ x: 17.5, y: 4.5 });
  const crates = [blockOn('wood', 'square', 11.5, 4.5), blockOn('ice', 'cube', 11.5, 5.5), blockOn('ice', 'square', 23.5, 4.5), blockOn('wood', 'cube', 23.5, 5.5)];
  return level({
    id: '2-6',
    name: 'Пирс',
    birds: ['chuck', 'hal', 'matilda', 'red'],
    bounds: { maxX: 38 },
    parts: [near, mid, far, house],
    blocks: crates,
    pigs: [pigOn('medium', 13.3, 4.5), pigIn('helmet', house.spots[0]), pigOn('medium', 21.9, 4.5), pigOn('small', 17.5, 0)],
    hint: 'Выбейте сваю — настил рухнет вместе со свиньями',
    stars: { one: 0, two: 26_000, three: 39_000 },
    meta: {
      nMin: 3,
      difficulty: 6,
      teach: 'высокие сваи — слабое место, падение с настила',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 52524, solverSec: 34.4, evaluations: 850 },
    },
    decor: [dec('shell', 2.5), dec('grass', 5), dec('sign', 8.5), dec('shell', 15.25, 0, 0.8), dec('rock', 26, 0, 0.7), dec('shell', 28, 0, 1, true), dec('rock', 30, 0, 1.2)],
  });
}

/**
 * 2-7 «Маяк» · d 7 · N 4 (nMin 3)
 * Скальное основание plateau(13.75, 18.25, 1) с откосами 1.5 м. На нём маяк — башня из 3 рам span 4 на x = 16
 * (верх 8.5; при V 21 на этаж ниже, чем в 06 §10, — mustache наверху в досягаемости, огибающая Red на x = 16 — 10.6):
 * 1-й этаж — каменные колонны, 2-й — дерево, верхний — каменная балка на деревянных колоннах (тяжёлый верх
 * опрокидывается вокруг крепкого низа). На 2-м этаже TNT и ящик, наверху mustache между каменными зубцами.
 * Справа у подножия (x = 22.5) ледяной сарай с деревянной крышей и 2 small (их добивает падающий маяк).
 * Каска — в каменном бункере у подножия слева (x = 10.75): маяк падает от рогатки, вправо, и бункер не задевает —
 * его берёт Бомб или яйцо Матильды (в 06 §10 каска стояла на 2-м этаже и гибла вместе с маяком от одного выстрела).
 * Свиньи: mustache наверху, helmet в бункере, 2 small в сарае. Учит: опрокидывание высокого на соседей.
 */
export function L2_7(): LevelDef {
  const lighthouse = tower({
    x: 16,
    y: 1,
    floors: 3,
    mats: [{ col: 'stone', beam: 'wood' }, 'wood', { col: 'wood', beam: 'stone' }],
  });
  const merlons = [blockOn('stone', 'cube', 14.25, lighthouse.top), blockOn('stone', 'cube', 17.75, lighthouse.top)];
  const floor2 = lighthouse.spots[1];
  // сарай с двумя small справа — на пути падающего маяка
  const shed = hut({ x: 22.5, col: 'ice', beam: 'ice', roofMat: 'wood', roofKind: 'tris' });
  // каска — в каменном бункере у подножия слева: маяк падает от рогатки, вправо, и бункер не задевает;
  // его берёт Бомб (взрыв ≤ 2.9 м) или яйцо Матильды
  const keep = bunker({ x: 10.75, inner: 1.5, h: 1.5, roofMat: 'stone' });
  return level({
    id: '2-7',
    name: 'Маяк',
    birds: ['red', 'bomb', 'hal', 'matilda'],
    terrain: [flatGround(), plateau(13.75, 18.25, 1, { slope: 1.5 })],
    bounds: { maxX: 38 },
    parts: [keep, lighthouse, shed],
    blocks: [...merlons, blockOn('wood', 'square', 17, floor2.y)],
    tnt: [tntOn(15.25, floor2.y)],
    pigs: [pigOn('mustache', 16, lighthouse.top), pigIn('helmet', keep.spots[0]), pigIn('small', shed.spots[0], -0.7), pigIn('small', shed.spots[0], 0.7)],
    hint: 'Высокое падает далеко: бейте в верх маяка',
    stars: { one: 0, two: 26_000, three: 38_000 },
    meta: {
      nMin: 3,
      difficulty: 7,
      teach: 'опрокидывание высокой башни на соседей, TNT в середине',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 55543, solverSec: 13.5, evaluations: 422 },
    },
    decor: [dec('shell', 2.5), dec('bush', 5.5), dec('rock', 7.5, 0, 0.9), dec('grass', 19.95, 0, 0.7), dec('shell', 26, 0, 0.9, true), dec('rock', 28)],
  });
}

/**
 * 2-8 «Два форта» · d 7 · N 5 (nMin 4)
 * Две трёхэтажные башни span 4: передняя на x = 13 (дерево, колонны 1-го этажа — камень) и задняя на x = 21
 * (лёд, колонны 1-го этажа — камень). Между их крышами мост longBeam 5×0.5 на x = 17 (опирание 0.5 на каждой, верх 8)
 * с ледяными ящиками, под мостом — каменный бункер с helmet. На крышах — малые щипцовые крыши и зубцы, перед передним
 * фортом — низкая каменная стенка. В 06 §10 helmet стоял на мосту, но при V 21 форты ближе и хрупче: обвал любого форта
 * ронял мост, и одна птица брала 3 свиньи (эксперт — 2 птицы при nMin 4). В бункере под каменной крышей каске не
 * страшны обломки — её берёт Бомб или Хэл.
 * Свиньи: в переднем форте medium (1-й этаж) и small (3-й), в заднем small (1-й) и medium (2-й), helmet в бункере.
 * Учит: две цели — порядок выстрелов; Blues по ледяному форту, Chuck по деревянному, Hal по дальней башне сзади.
 */
export function L2_8(): LevelDef {
  const fortA = tower({ x: 13, floors: 3, mats: [{ col: 'stone', beam: 'wood' }, 'wood', 'wood'] });
  const fortB = tower({ x: 21, floors: 3, mats: [{ col: 'stone', beam: 'ice' }, 'ice', 'ice'] });
  const bridge = blockOn('wood', 'longBeam', 17, fortA.top, { id: 'мост' });
  const merlons = [blockOn('wood', 'cube', 11.25, fortA.top), blockOn('ice', 'cube', 22.75, fortB.top)];
  const turrets = [roof({ x: 12.5, y: fortA.top, w: 2, mat: 'wood' }), roof({ x: 21.5, y: fortB.top, w: 2, mat: 'ice' })];
  const guard = stack({ x: 9.5, n: 2, kind: 'square', mat: 'stone' });
  // каска — в каменном бункере между фортами, под мостом: обвал форта или моста её не берёт (каменная крыша),
  // нужен Бомб или Хэл сзади; на мосту — ледяные ящики
  const vault = bunker({ x: 17, inner: 1.5, h: 1.5, roofMat: 'stone' });
  return level({
    id: '2-8',
    name: 'Два форта',
    birds: ['blues', 'chuck', 'hal', 'bomb', 'red'],
    bounds: { maxX: 37 },
    parts: [guard, fortA, fortB, vault, ...turrets],
    blocks: [bridge, ...merlons, blockOn('ice', 'square', 16.5, fortA.top + 0.5), blockOn('ice', 'cube', 17.25, fortA.top + 0.5)],
    pigs: [
      pigIn('medium', fortA.spots[0]),
      pigIn('small', fortA.spots[2]),
      pigIn('small', fortB.spots[0]),
      pigIn('medium', fortB.spots[1]),
      pigIn('helmet', vault.spots[0]),
    ],
    stars: { one: 0, two: 32_000, three: 46_000 },
    meta: {
      nMin: 4,
      difficulty: 7,
      teach: 'две цели: порядок выстрелов, Hal по дальней башне с тыла, каска в бункере — Бомбу',
      starsSource: 'solver',
      calib: { expertBirds: 4, expertScore: 56248, solverSec: 75.9, evaluations: 1534 },
    },
    decor: [dec('shell', 2.5), dec('grass', 4.5), dec('bush', 7), dec('rock', 24.5, 0, 0.9), dec('grass', 26.5), dec('shell', 29, 0, 1, true)],
  });
}

/**
 * 2-9 «Цепная реакция» · d 7 · N 4 (nMin 2)
 * Каменный бункер со стенами из квадратов (x = 10.75): medium внутри, small на крыше. За ним 4 TNT вдоль пола
 * (x = 14.65…21.75): первая стоит открыто — «запал», остальные в двух двухэтажных сараях (рамы: низ — дерево,
 * мансарда — лёд, крыши iso; x = 17.95 span 5 и x = 23 span 4) рядом со свиньями.
 * Цепочка убивает 4 свиньи в сараях; бункер в 3.9 м от запала ей не по зубам — его берёт Бомб или яйцо Матильды.
 * Бункер прикрывает запал от настильного выстрела: бить навесом или скатиться с крыши бункера на запал.
 * Свиньи: 4 small, 2 medium. Учит: один точный выстрел в открытую TNT запускает цепочку.
 */
export function L2_9(): LevelDef {
  // каменный бункер впереди: medium внутри, small на крыше; до «запала» 3.9 м — цепочка его не берёт,
  // нужен Бомб или яйцо Матильды. Бункер же прикрывает запал от настильного выстрела — бить навесом
  const bunk = bunker({ x: 10.75, inner: 2, h: 2, wallW: 1 });
  const shedA = frame({ x: 17.95, span: 5 });
  const atticA = frame({ x: 17.95, y: shedA.top, span: 5, col: 'ice', beam: 'ice' });
  const roofA = roof({ x: 17.95, y: atticA.top });
  const shedB = frame({ x: 23, span: 4 });
  const atticB = frame({ x: 23, y: shedB.top, span: 4, col: 'ice', beam: 'ice' });
  const roofB = roof({ x: 23, y: atticB.top });
  return level({
    id: '2-9',
    name: 'Цепная реакция',
    birds: ['red', 'matilda', 'chuck', 'bomb'],
    bounds: { maxX: 37 },
    parts: [bunk, shedA, atticA, roofA, shedB, atticB, roofB],
    tnt: [14.65, 16.85, 19.05, 22].map((x) => tntOn(x, 0)),
    pigs: [
      pigIn('medium', bunk.spots[0]),
      pigIn('small', bunk.spots[1]),
      pigOn('small', 17.95, 0),
      pigIn('small', atticA.spots[0]),
      pigOn('medium', 23.6, 0),
      pigIn('small', atticB.spots[0]),
    ],
    hint: 'Попадите в открытый ящик TNT — цепочка сделает остальное',
    stars: { one: 0, two: 45_000, three: 58_000 },
    meta: {
      nMin: 2,
      difficulty: 7,
      teach: 'открытый запал: цепочка TNT, бункер — для Bomb',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 63897, solverSec: 12.1, evaluations: 515 },
    },
    decor: [dec('shell', 2.5), dec('grass', 4.5), dec('sign', 7), dec('rock', 26.2, 0, 0.6), dec('grass', 27.5), dec('shell', 29, 0, 1, true)],
  });
}

/**
 * 2-10 «Замок короля» (босс) · d 8 · N 6 (nMin 5)
 * Плато plateau(8, 24.5, 1) с откосами; на нём замок на оси x = 16.5 (10.5–22.5):
 * - 1-й ярус — три каменных бункера (рамы span 4 из камня): helmet, mustache (в центре, под королём), helmet;
 * - 2-й ярус — три деревянные рамы, в крайних по small;
 * - 3-й ярус — ледяная зала на опорах по 3 м (квадрат 1×1 + колонна 0.5×2), проём 3×3 под king, перекрытие —
 *   каменная балка, сверху деревянная крыша 4×1.5 (верх 11 при огибающей Red 10.3 на x = 16.5). Каменные плиты 2×1
 *   из 06 §10 убраны: при обрушении ледяных опор 13 кг камня давили короля с одного выстрела;
 * - на крайних рамах 2-го яруса — малые крыши-башенки;
 * - 2 TNT у основания: левая на краю плато (в 1.25 м от стены), правая — в 0.25 м от дальнего бункера: её взрыв
 *   берёт каску за камнем (ключ к тыльной части замка). Барбакан и ледяная башенка из 06 §10 убраны: при V 21
 *   замок стоит ближе, и им не осталось места.
 * Свиньи: king, mustache, 2 helmet, 2 small. Учит: босс — королю нужно 2 тяжёлых попадания или взрыв ≤ 2.4 м.
 */
export function L2_10(): LevelDef {
  const X = 16.5;
  const bays1 = [X - 4, X, X + 4].map((x) => frame({ x, y: 1, col: 'stone', beam: 'stone' }));
  const bays2 = [X - 4, X, X + 4].map((x) => frame({ x, y: bays1[0].top }));
  const throne = hall({ x: X, y: bays2[0].top, baseMat: 'ice', colMat: 'ice', roofMat: 'stone' });
  // над королём только каменная балка залы и лёгкая деревянная крыша: каменные плиты 2×1 из 06 §10 при обрушении
  // ледяных опор давили короля первым же выстрелом Red (лаборатория: 7 из 140 выстрелов убивали 5 свиней из 6)
  const crown = roof({ x: X, y: throne.top, w: 4, mat: 'wood' });
  const turrets = [roof({ x: X - 4.5, y: bays2[0].top, w: 2, mat: 'wood' }), roof({ x: X + 4.5, y: bays2[2].top, w: 2, mat: 'wood' })];
  return level({
    id: '2-10',
    name: 'Замок короля',
    birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal'],
    terrain: [flatGround(), plateau(X - 8.5, X + 8, 1, { slope: 1.5 })],
    bounds: { maxX: 37 },
    parts: [...bays1, ...bays2, ...turrets, throne, crown],
    // левая TNT на краю плато в 1.25 м от стены: выбивает крайнюю каменную колонну, но каску в бункере (3.1 м до
    // поверхности) сама не убивает — иначе обломки первого же выстрела подрывали обе TNT и брали обе каски;
    // правая — в 0.25 м от дальнего бункера (2.1 м до каски): ключ к тыльной каске, которую иначе не достать
    tnt: [tntOn(X - 7.75, 1), tntOn(X + 6.75, 1)],
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
    meta: {
      nMin: 5,
      difficulty: 8,
      teach: 'босс: король под каменной крышей, все птицы эпизода',
      starsSource: 'solver',
      calib: { expertBirds: 4, expertScore: 69960, solverSec: 87.1, evaluations: 1004 },
    },
    decor: [dec('shell', 2.5), dec('bush', 4.5), dec('sign', 6), dec('rock', 26.5, 0, 0.8), dec('grass', 28), dec('shell', 30, 0, 1.2, true)],
  });
}

export const EPISODE2_LEVELS: LevelDef[] = [L2_1(), L2_2(), L2_3(), L2_4(), L2_5(), L2_6(), L2_7(), L2_8(), L2_9(), L2_10()];
