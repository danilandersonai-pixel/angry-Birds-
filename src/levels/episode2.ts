// Эпизод 2 «Пляжный закат» (beach): + шары-валуны, Matilda (2-2), пропасть и мост, Hal (2-5), король (2-10).
// Карточки уровней — 06-levels.md §10, порядок птиц и свиньи — 00-summary §4 (закон кампании).
// Каждый уровень — функция без аргументов, собирающая LevelDef через level() из prefabs; массив — в порядке кампании.
//
// Общие соглашения эпизода:
// - рогатка в (0, 0) → ANCHOR (0, 2.7), площадка очереди ровная;
// - цели (свиньи) на x = 16…34 м от основания, на уровнях с Bomb — не дальше 32 м (00 §4);
// - доля материалов по числу блоков ≈ дерево 45 % / лёд 20 % / камень 35 % (06 §9.3);
// - звёзды — по эксперту на настоящем ядре: suggestStars (06 §8.2, 3★ не выше счёта эксперта) по итогу
//   scripts/level-report.ts --solve; meta.starsSource = 'solver', в meta.calib — птиц и счёт эксперта, время решателя.
//   У уровней с Хэлом решатель по умолчанию тапает не позже ≈ 1.33 с и бумеранг за целью не находит; там, где
//   это меняет итог (2-5), эксперт посчитан с поздними тапами Хэла 1.4…2.3 с (calib.halLateTaps = 1);
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
 * Дюна hill(8, 14, 19, 25, 4): откос к рогатке 34° и скат 34° к домику. На ровном верху — каменные шары ⌀2 и ⌀1
 * в колыбелях из деревянных кубиков; правый стопор стоит заподлицо с кромкой ската. Толчок в шар (или выбитый стопор) —
 * и шар скатывается и врезается в колонну двухэтажного домика у подножия (x = 27); малый валун — «второй заход».
 * Справа за каменным заслоном (2 квадрата + кубик, x = 29.5) — ледяной сарай с ледяной крышей и small (x = 34):
 * заслон держит валун и обломки домика, сарай берётся только навесом (Синие против льда).
 * Свиньи: medium (1-й этаж) + small (2-й этаж) в домике, small в сарае. Учит: косвенное убийство валуном.
 * Эксперт: валун + навес в сарай — 2 птицы; одним выстрелом все три свиньи не берутся (перебор 190 выстрелов).
 */
export function L2_1(): LevelDef {
  const dune = hill(8, 14, 19, 25, 4);
  // два валуна на ровном верху дюны: ⌀1 и ⌀2 из камня, общий средний стопор (зазоры 0.05, 06 S8)
  const boulders = part({
    blocks: [
      blockOn('stone', 'ball2', 17.45, 4, { id: 'валун-большой' }),
      blockOn('stone', 'ball1', 15.35, 4, { id: 'валун-малый' }),
      blockOn('wood', 'cube', 14.55, 4),
      blockOn('wood', 'cube', 16.15, 4),
      blockOn('wood', 'cube', 18.75, 4, { id: 'стопор-у-кромки' }),
    ],
  });
  const floor1 = tower({ x: 27, floors: 1 });
  const floor2 = hut({ x: 27, y: floor1.top });
  // каменный заслон между домиком и ледяным сараем: валун и обломки домика сарай не задевают — нужен навес
  const guard = stack({ x: 29.5, n: 2, kind: 'square', mat: 'stone' });
  const iceShed = hut({ x: 34, span: 4, h: 1, col: 'ice', beam: 'ice', roofMat: 'ice' });
  return level({
    id: '2-1',
    name: 'Валуны',
    birds: ['red', 'chuck', 'blues', 'red'],
    terrain: [flatGround(), dune],
    parts: [boulders, floor1, floor2, guard, iceShed],
    blocks: [blockOn('stone', 'cube', 29.5, 2)],
    pigs: [pigIn('medium', floor1.spots[0]), pigIn('small', floor2.spots[0]), pigIn('small', iceShed.spots[0])],
    hint: 'Толкните валун — он скатится с дюны и раздавит домик',
    stars: { one: 0, two: 29_000, three: 42_000 },
    meta: {
      nMin: 2,
      difficulty: 4,
      teach: 'валун в колыбели: сбить стопор или толкнуть шар — косвенное убийство',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 44225, solverSec: 6.3, evaluations: 345 },
    },
    decor: [dec('shell', 3.5), dec('grass', 6.2), dec('sign', 11, 2), dec('grass', 14.2, 4, 0.7), dec('shell', 24, 0, 0.8), dec('rock', 38.5), dec('shell', 40, 0, 1.1, true)],
  });
}

/**
 * 2-2 «Яйцо сверху» · d 5 · N 3 (nMin 2) · ввод Matilda
 * Бухта между скалами plateau(15, 18, 5) и plateau(24, 30, 5), проём 6 м (06 §10 сдвинуто на 7 м ближе: яйцо падает
 * отвесно из точки тапа, а над дальней половиной бухты Матильда пролетает поздно). Крыша на y = 5 — две деревянные
 * балки 4×0.5 на скалах и центральной стойке (вертикальный longBeam на x = 21); на балках — каменные плиты над
 * свиньями с брусками сверху, ящик на стыке, ледяные бруски над скалами. Яйцо ломает балку — плита давит medium;
 * яйцо точно в стык ломает обе балки. Small — в низкой будке на ближней скале (верх 7.5 — не перекрывает навес),
 * на дальней скале — двухэтажная вышка и сарай (за целью). Перед ближней скалой — заслон из 3 каменных квадратов.
 * Свиньи: 2 medium под крышей, small в будке. Учит: Matilda — сброс яйца сверху; прямой выстрел упирается в скалу.
 */
export function L2_2(): LevelDef {
  const c = 21; // ось бухты (стойка); бухта c − 3 … c + 3
  const screen = stack({ x: c - 6.5, n: 3, kind: 'square', mat: 'stone' });
  const post = blockOn('wood', 'longBeam', c, 0, { vertical: true, id: 'стойка' });
  const beamL = B('wood', 'rect', c - 2, 5.25, 4, 0.5, 0, 'крыша-левая');
  const beamR = B('wood', 'rect', c + 2, 5.25, 4, 0.5, 0, 'крыша-правая');
  const slabL = blockOn('stone', 'slab', c - 1.5, 5.5);
  const slabR = blockOn('stone', 'slab', c + 1.5, 5.5);
  const ridge = blockOn('wood', 'square', c, 5.5, { id: 'ящик-на-стыке' });
  // на ближней скале — низкая будка с small (верх 7.5: не перекрывает полёт Матильды к бухте)
  const booth = hut({ x: c - 5, y: 5, span: 2, h: 1 });
  // на дальней скале — двухэтажная вышка и сарай (за целью: не мешают полёту над бухтой)
  const lookout = tower({ x: c + 5, y: 5, floors: 2, span: 2, mats: ['wood', { col: 'wood', beam: 'ice' }], roof: 'wood' });
  const shed = hut({ x: c + 8, y: 5, span: 2, h: 2, roofMat: 'ice' });
  return level({
    id: '2-2',
    name: 'Яйцо сверху',
    birds: ['matilda', 'matilda', 'red'],
    terrain: [flatGround(), plateau(c - 6, c - 3, 5), plateau(c + 3, c + 9, 5)],
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
      blockOn('ice', 'brick', c - 3.25, 5.5),
      blockOn('ice', 'brick', c + 3.25, 5.5),
      // груз на плитах: деревянные бруски (ещё очки за разрушение и мишень для яйца)
      blockOn('wood', 'brick', c - 1.5, 6.5),
      blockOn('wood', 'brick', c + 1.5, 6.5),
    ],
    pigs: [pigOn('medium', c - 1.5, 0), pigOn('medium', c + 1.5, 0), pigIn('small', booth.spots[0])],
    hint: 'Коснитесь экрана над целью — Матильда сбросит яйцо',
    stars: { one: 0, two: 22_000, three: 35_000 },
    meta: {
      nMin: 2,
      difficulty: 5,
      teach: 'Matilda: яйцо сверху пробивает крышу, прямой выстрел упирается в скалу',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 37591, solverSec: 13.6, evaluations: 622 },
    },
    decor: [dec('shell', 4), dec('bush', 8), dec('rock', c - 8, 0, 0.9), dec('grass', c + 10, 0), dec('shell', c + 12, 0, 0.9, true)],
  });
}

/**
 * 2-3 «Мост над пропастью» · d 5 · N 4 (nMin 3)
 * Утёсы plateau(12, 20, 4) и plateau(24.5, 33, 4), пропасть 4.5 м до земли (глубина 4 м — смертельна для small и
 * medium). Мост — деревянный longBeam 5×0.5 на x = 22.25 (опирание по 0.25); на нём ледяная рама span 3 с medium и
 * ледяной крышей, на концах — ледяные кубики. На ближнем утёсе — штабель ящиков и каменный частокол у въезда, на дне
 * ущелья — ящики рядом с small. На дальнем утёсе — домик на каменных колоннах (x = 28, верх 8) за каменным квадратом
 * и двухэтажная вышка (x = 31.5).
 * Слабое место: сам мост (навес Реда сверху или рывок Чака). Small на дне добивает падающий мост.
 * Свиньи: medium на мосту, medium в домике, small в пропасти. Учит: сломать опору — свинья падает в пропасть.
 */
export function L2_3(): LevelDef {
  const bridge = B('wood', 'rect', 22.25, 4.25, 5, 0.5, 0, 'мост');
  const iceFrame = frame({ x: 22.25, y: 4.5, span: 3, h: 2, col: 'ice', beam: 'ice' });
  const iceCap = roof({ x: 22.25, y: iceFrame.top, w: 2, mat: 'ice' });
  // на дальнем утёсе — домик на каменных колоннах под деревянной крышей (верх 8 при огибающей 9.7)
  const house = hut({ x: 28, y: 4, col: 'stone', beam: 'stone', roofMat: 'wood' });
  const lookout = tower({ x: 31.5, y: 4, floors: 2, span: 2, mats: [{ col: 'stone', beam: 'wood' }, { col: 'wood', beam: 'ice' }], roof: 'wood' });
  return level({
    id: '2-3',
    name: 'Мост над пропастью',
    birds: ['red', 'chuck', 'matilda', 'blues'],
    terrain: [flatGround(), plateau(12, 20, 4, { slope: [6, 0] }), plateau(24.5, 33, 4, { slope: [0, 6] })],
    parts: [palisade({ x: 18.25, y: 4, n: 3, kind: 'brick', mat: 'stone', vertical: true }), iceFrame, iceCap, house, lookout],
    blocks: [
      bridge,
      blockOn('ice', 'cube', 20.25, 4.5),
      blockOn('ice', 'cube', 24.25, 4.5),
      blockOn('stone', 'square', 25.25, 4),
      // ящики на дне ущелья рядом с small: обломки моста ломают их вместе со свиньёй
      blockOn('wood', 'square', 20.5, 0),
      blockOn('ice', 'cube', 20.5, 1),
      blockOn('wood', 'square', 24, 0),
      // штабель груза перед мостом на ближнем утёсе
      blockOn('wood', 'square', 14.5, 4),
      blockOn('wood', 'square', 15.5, 4),
      blockOn('wood', 'square', 16.5, 4),
      blockOn('ice', 'square', 15, 5),
      blockOn('ice', 'square', 16, 5),
    ],
    pigs: [pigIn('medium', iceFrame.spots[0]), pigIn('medium', house.spots[0]), pigOn('small', 23, 0)],
    hint: 'Сломайте мост — свиньи упадут в пропасть',
    stars: { one: 0, two: 22_000, three: 35_000 },
    meta: {
      nMin: 3,
      difficulty: 5,
      teach: 'пропасть и мост: смерть от падения',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 44887, solverSec: 9.9, evaluations: 520 },
    },
    decor: [dec('shell', 3), dec('grass', 8, 4 / 3, 0.8), dec('bush', 12.4, 4), dec('sign', 13.4, 4), dec('rock', 22, 0, 0.8), dec('grass', 34, 4 * (1 - 1 / 6), 0.7), dec('shell', 41, 0, 1, true)],
  });
}

/**
 * 2-4 «Песчаный замок» · d 6 · N 4 (nMin 3)
 * Ступенчатая пирамида на x = 26: 5 рядов (6…2 квадрата, низ 23–29), нижние 2 ряда — камень, верхние — дерево.
 * Ниши (убранный квадрат, над нишей — плита-перемычка 2×1) во 2-м и 4-м рядах на оси x = 26 — по small.
 * Вершина — «донжон»: деревянная балка 4×0.5 на верхней плите с зубцами-кубиками по краям, на ней medium
 * (06 §10 ставит medium на вершину пирамиды — на квадрат 1×1 это хрупкое место, балка даёт ему 0.9 м с каждой стороны).
 * По углам — башенки (камень + дерево, 3.5 м). Деревянный домик с small отнесён влево (x = 16.5, в 4.5 м от замка):
 * иначе взрыв Бомба в пирамиде отбрасывал обломки на домик и брал все 4 свиньи одной птицей.
 * Слабые места: деревянные ряды (Chuck) и каменный низ у ниши (Bomb).
 * Свиньи: 2 small в нишах, medium на вершине, small в домике. Учит: разбор «массива», взрыв против камня.
 */
export function L2_4(): LevelDef {
  const castle = pyramid({ x: 26, rows: 6, rowMats: ['stone', 'stone', 'wood', 'wood', 'wood', 'wood'], niches: [[1, 2], [3, 1]] });
  // Свинья в нише пирамиды стоит над стыком двух квадратов нижнего ряда, а на стыке (скруглённые углы коллизий) small
  // медленно скатывается (лабораторный T0: 0.08 м). Поэтому под нишами — цельные плиты 2×1: под верхней это
  // перемычка нижней ниши (её ставит pyramid), под нижней — каменная плита вместо двух квадратов 1-го ряда.
  // Верхний квадрат 6-го ряда убран: вместо него донжон на плите 5-го ряда (верх 5).
  const body = castle.blocks.filter((b) => !(b.y > 5 && b.x === 26) && !(b.y === 0.5 && (b.x === 25.5 || b.x === 26.5)));
  const floorSlab = blockOn('stone', 'slab', 26, 0, { id: 'пол-нижней-ниши' });
  const keepBeam = blockOn('wood', 'beam', 26, 5, { id: 'донжон' });
  const merlons = [blockOn('wood', 'cube', 24.25, 5.5), blockOn('wood', 'cube', 27.75, 5.5)];
  // фланговые башенки замка: 2 каменных квадрата + деревянный квадрат + зубец-кубик
  const flank = (x: number) =>
    part({ blocks: [blockOn('stone', 'square', x, 0), blockOn('stone', 'square', x, 1), blockOn('wood', 'square', x, 2), blockOn('wood', 'cube', x, 3)] });
  const house = hut({ x: 16.5 });
  return level({
    id: '2-4',
    name: 'Песчаный замок',
    birds: ['bomb', 'matilda', 'chuck', 'red'],
    parts: [house, flank(22.5), flank(29.5)],
    blocks: [floorSlab, ...body, keepBeam, ...merlons],
    pigs: [pigIn('small', castle.spots[1]), pigIn('small', castle.spots[2]), pigOnBlock('medium', keepBeam), pigIn('small', house.spots[0])],
    stars: { one: 0, two: 27_000, three: 41_000 },
    meta: {
      nMin: 3,
      difficulty: 6,
      teach: 'разбор массива: ниши в пирамиде, взрыв против камня',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 56203, solverSec: 12.8, evaluations: 382 },
    },
    decor: [dec('shell', 3), dec('bush', 7.5), dec('grass', 12), dec('shell', 15.5, 0, 0.8), dec('rock', 22, 0, 0.7), dec('shell', 31, 0, 1, true), dec('grass', 34), dec('rock', 38, 0, 1.2)],
  });
}

/**
 * 2-5 «Бумеранг» · d 5 · N 4 (nMin 2) · ввод Hal
 * Стена — скала-останец plateau(20, 22, 6) (статичная: удар в неё не обрушивает её на постройки) с осыпью каменных
 * квадратов у подножия. За ней постройки с каменным фасадом и деревянным тылом: домик (x = 26) с medium и двухэтажная
 * башня (x = 31.5) с small на каждом этаже и на крыше, между ними ящики. Прямой выстрел упирается в скалу, навес
 * Реда и Бомба берёт постройки сверху. Hal перелетает постройки, тап у самой земли за ними (x ≈ 33–38) — петля
 * вверх-назад и удар в тыл башни и домика; за целями свободно до x ≈ 42.
 * Свиньи: 3 small, medium. Учит: Hal — удар с тыла.
 * Решатель по умолчанию тапает Хэлом не позже 1.1 с (уточнение — до ≈ 1.33 с): это разворот ещё до стены, поэтому
 * он тратит обоих Хэлов и проходит Редом и Бомбом (4 птицы). С поздними тапами 1.4…2.3 с — 2 птицы (бумеранг).
 */
export function L2_5(): LevelDef {
  // стена — скала-останец 6 м (статичная: удар в неё не роняет её на постройки, бить можно только навесом или
  // бумерангом Хэла); у подножия — осыпь из каменных квадратов
  const rubble = part({
    blocks: [blockOn('stone', 'square', 19.5, 0), blockOn('stone', 'square', 18.5, 0), blockOn('stone', 'square', 19.5, 1), blockOn('stone', 'square', 22.5, 0), blockOn('stone', 'cube', 22.25, 1)],
  });
  // фасад к рогатке — каменные колонны, тыл — деревянные: фронтальный удар вязнет, удар Hal с тыла валит постройку
  // назад, от рогатки; между домиком и башней 1.5 м (ящики)
  const stoneFront = (p: Part, xFront: number): Part => ({ ...p, blocks: p.blocks.map((b) => (b.x === xFront ? { ...b, material: 'stone' as const } : b)) });
  const house = stoneFront(hut({ x: 26 }), 24.25);
  const keep = stoneFront(tower({ x: 31.5, floors: 2 }), 29.75);
  return level({
    id: '2-5',
    name: 'Бумеранг',
    birds: ['hal', 'hal', 'red', 'bomb'],
    terrain: [flatGround(), plateau(20, 22, 6, { kind: 'rock' })],
    parts: [rubble, house, keep],
    // ящики между постройками и ледяные зубцы на крыше башни
    blocks: [blockOn('wood', 'square', 28.75, 0), blockOn('ice', 'cube', 28.75, 1), blockOn('ice', 'cube', 29.75, 5), blockOn('ice', 'cube', 33.25, 5)],
    pigs: [pigIn('medium', house.spots[0]), pigIn('small', keep.spots[0]), pigIn('small', keep.spots[1]), pigIn('small', keep.spots[2])],
    hint: 'Перелетите постройки и коснитесь экрана у самой земли — Хэл развернётся и ударит сзади',
    stars: { one: 0, two: 35_000, three: 47_000 },
    meta: {
      nMin: 2,
      difficulty: 5,
      teach: 'Hal: бумеранг через стену, удар с тыла',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 48078, solverSec: 11, evaluations: 1276, halLateTaps: 1, defaultBirds: 4, defaultScore: 29349 },
    },
    decor: [dec('shell', 4), dec('grass', 8), dec('rock', 13, 0, 0.8), dec('bush', 18), dec('shell', 34.5, 0, 0.9), dec('grass', 37), dec('rock', 41, 0, 1.1, true)],
  });
}

/**
 * 2-6 «Пирс» · d 6 · N 4 (nMin 3)
 * Пирс из трёх независимых пролётов по 4 м (у каждого свои сваи, между настилами 0.5 м), верх настила 4.5:
 * ближний (x = 22) — на деревянных сваях из двух колонн 0.5×2 (4 м, стройность 8 — держатся только настилом),
 * средний (x = 26.5) — на каменных быках из квадратов 1×1 с деревянным домиком (helmet внутри), дальний (x = 31) —
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
  const near = span(22, 'wood', 'ice');
  // средний пролёт — на каменных быках из квадратов 1×1 (их рывок Чака не опрокидывает)
  const mid = part({
    blocks: [...[25, 28].flatMap((px) => [0, 1, 2, 3].map((k) => blockOn('stone', 'square', px, k))), B('wood', 'rect', 26.5, 4.25, 4, 0.5)],
  });
  const far = span(31, 'wood', 'ice');
  const house = hut({ x: 26.5, y: 4.5 });
  const crates = [blockOn('wood', 'square', 20.5, 4.5), blockOn('ice', 'cube', 20.5, 5.5), blockOn('ice', 'square', 32.5, 4.5), blockOn('wood', 'cube', 32.5, 5.5)];
  return level({
    id: '2-6',
    name: 'Пирс',
    birds: ['chuck', 'hal', 'matilda', 'red'],
    parts: [near, mid, far, house],
    blocks: crates,
    pigs: [pigOn('medium', 22.3, 4.5), pigIn('helmet', house.spots[0]), pigOn('medium', 30.9, 4.5), pigOn('small', 26.5, 0)],
    hint: 'Выбейте сваю — настил рухнет вместе со свиньями',
    stars: { one: 0, two: 26_000, three: 39_000 },
    meta: {
      nMin: 3,
      difficulty: 6,
      teach: 'высокие сваи — слабое место, падение с настила',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 52010, solverSec: 13.2, evaluations: 631 },
    },
    decor: [dec('shell', 3.5), dec('grass', 7), dec('sign', 17.5), dec('shell', 24.2, 0, 0.8), dec('rock', 28.8, 0, 0.7), dec('shell', 35, 0, 1, true), dec('rock', 38.5, 0, 1.2)],
  });
}

/**
 * 2-7 «Маяк» · d 7 · N 4 (nMin 3)
 * Скальное основание plateau(20.25, 25.25, 2) с откосами 34°. На нём маяк — башня из 4 рам span 4 на x = 22.5 (верх
 * 12): 1-й этаж — каменные колонны, 2-й — дерево, верхние 2 — каменные балки на деревянных колоннах (тяжёлый верх
 * опрокидывается вокруг крепкого низа). На 2-м этаже TNT и ящик, наверху mustache между каменными зубцами.
 * Справа у подножия ледяной сарай с деревянной крышей и 2 small (их добивает падающий маяк), за ним груда камней.
 * Каска — в каменном бункере у подножия слева (x = 16): маяк падает от рогатки, вправо, и бункер не задевает —
 * его берёт Бомб или яйцо Матильды (в 06 §10 каска стояла на 2-м этаже и гибла вместе с маяком от одного выстрела).
 * Свиньи: mustache наверху, helmet в бункере, 2 small в сарае. Учит: опрокидывание высокого на соседей.
 */
export function L2_7(): LevelDef {
  const lighthouse = tower({
    x: 22.5,
    y: 2,
    floors: 4,
    mats: [{ col: 'stone', beam: 'wood' }, 'wood', { col: 'wood', beam: 'stone' }, { col: 'wood', beam: 'stone' }],
  });
  const merlons = [blockOn('stone', 'cube', 20.75, lighthouse.top), blockOn('stone', 'cube', 24.25, lighthouse.top)];
  const floor2 = lighthouse.spots[1];
  // сарай с двумя small справа — на пути падающего маяка
  const shed = hut({ x: 31, col: 'ice', beam: 'ice', roofMat: 'wood', roofKind: 'tris' });
  // каска — в каменном бункере у подножия слева: маяк падает от рогатки, вправо, и бункер не задевает;
  // его берёт Бомб (взрыв ≤ 2.9 м) или яйцо Матильды
  const keep = bunker({ x: 16, inner: 1.5, h: 1.5, roofMat: 'stone' });
  return level({
    id: '2-7',
    name: 'Маяк',
    birds: ['red', 'bomb', 'hal', 'matilda'],
    terrain: [flatGround(), plateau(20.25, 25.25, 2, { slope: 3 })],
    parts: [keep, lighthouse, shed],
    blocks: [...merlons, blockOn('wood', 'square', 23.5, floor2.y), blockOn('stone', 'square', 35, 0), blockOn('stone', 'square', 36, 0), blockOn('stone', 'square', 35.5, 1)],
    tnt: [tntOn(21.75, floor2.y)],
    pigs: [pigOn('mustache', 22.5, lighthouse.top), pigIn('helmet', keep.spots[0]), pigIn('small', shed.spots[0], -0.7), pigIn('small', shed.spots[0], 0.7)],
    hint: 'Высокое падает далеко: бейте в верх маяка',
    camera: { castle: { x: 26, y: 6.5, viewH: 17 } },
    stars: { one: 0, two: 27_000, three: 40_000 },
    meta: {
      nMin: 3,
      difficulty: 7,
      teach: 'опрокидывание высокой башни на соседей, TNT в середине',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 56398, solverSec: 11.1, evaluations: 307 },
    },
    decor: [dec('shell', 3), dec('bush', 8), dec('rock', 12.5, 0, 0.9), dec('grass', 27.5, 0, 0.7), dec('shell', 37.5, 0, 0.9, true), dec('rock', 40)],
  });
}

/**
 * 2-8 «Два форта» · d 7 · N 5 (nMin 4)
 * Две трёхэтажные башни span 4: передняя на x = 19 (дерево, колонны 1-го этажа — камень) и задняя на x = 27
 * (лёд, колонны 1-го этажа — камень). Между их крышами мост longBeam 5×0.5 на x = 23 (опирание 0.5 на каждой, верх 8),
 * на мосту helmet. На крышах — малые щипцовые крыши и зубцы, перед передним фортом — низкая каменная стенка.
 * Свиньи: в переднем форте medium (1-й этаж) и small (3-й), в заднем small (1-й) и medium (2-й), helmet на мосту.
 * Учит: две цели — порядок выстрелов; Blues по ледяному форту, Chuck по деревянному, Hal по дальней башне сзади.
 */
export function L2_8(): LevelDef {
  const fortA = tower({ x: 19, floors: 3, mats: [{ col: 'stone', beam: 'wood' }, 'wood', 'wood'] });
  const fortB = tower({ x: 27, floors: 3, mats: [{ col: 'stone', beam: 'ice' }, 'ice', 'ice'] });
  const bridge = blockOn('wood', 'longBeam', 23, fortA.top, { id: 'мост' });
  const merlons = [blockOn('wood', 'cube', 17.25, fortA.top), blockOn('ice', 'cube', 28.75, fortB.top)];
  const turrets = [roof({ x: 18.5, y: fortA.top, w: 2, mat: 'wood' }), roof({ x: 27.5, y: fortB.top, w: 2, mat: 'ice' })];
  const guard = stack({ x: 15.5, n: 2, kind: 'square', mat: 'stone' });
  return level({
    id: '2-8',
    name: 'Два форта',
    birds: ['blues', 'chuck', 'hal', 'bomb', 'red'],
    parts: [guard, fortA, fortB, ...turrets],
    blocks: [bridge, ...merlons],
    pigs: [
      pigIn('medium', fortA.spots[0]),
      pigIn('small', fortA.spots[2]),
      pigIn('small', fortB.spots[0]),
      pigIn('medium', fortB.spots[1]),
      pigOnBlock('helmet', bridge),
    ],
    stars: { one: 0, two: 31_000, three: 44_000 },
    meta: {
      nMin: 4,
      difficulty: 7,
      teach: 'две цели: порядок выстрелов, Hal по дальней башне с тыла',
      starsSource: 'solver',
      calib: { expertBirds: 3, expertScore: 59414, solverSec: 22.5, evaluations: 1018 },
    },
    decor: [dec('shell', 3), dec('grass', 7), dec('bush', 11.5), dec('shell', 23, 0, 0.8), dec('rock', 32, 0, 0.9), dec('grass', 35), dec('shell', 39, 0, 1, true)],
  });
}

/**
 * 2-9 «Цепная реакция» · d 7 · N 4 (nMin 2)
 * Каменный бункер со стенами из квадратов (x = 16): medium внутри, small на крыше. За ним 5 TNT с шагом 2.2 м вдоль
 * пола (x = 19.9…28.7, зазоры 1.2 м — цепочка гарантирована): первая стоит открыто — «запал», остальные в двух
 * двухэтажных сараях (рамы span 5: низ — дерево, мансарда — лёд, крыши iso; x = 23.2 и 29.6) рядом со свиньями.
 * Цепочка убивает 4 свиньи в сараях; бункер в 3.9 м от запала ей не по зубам — его берёт Бомб или яйцо Матильды.
 * Бункер прикрывает запал от настильного выстрела: бить навесом или скатиться с крыши бункера на запал.
 * Свиньи: 4 small, 2 medium. Учит: один точный выстрел в открытую TNT запускает цепочку.
 */
export function L2_9(): LevelDef {
  // каменный бункер впереди (x = 16): medium внутри, small на крыше; до «запала» 3.9 м — цепочка его не берёт,
  // нужен Бомб или яйцо Матильды. Бункер же прикрывает запал от настильного выстрела — бить навесом
  const bunk = bunker({ x: 16, inner: 2, h: 2, wallW: 1 });
  const shedA = frame({ x: 23.2, span: 5 });
  const atticA = frame({ x: 23.2, y: shedA.top, span: 5, col: 'ice', beam: 'ice' });
  const roofA = roof({ x: 23.2, y: atticA.top });
  const shedB = frame({ x: 29.6, span: 5 });
  const atticB = frame({ x: 29.6, y: shedB.top, span: 5, col: 'ice', beam: 'ice' });
  const roofB = roof({ x: 29.6, y: atticB.top });
  return level({
    id: '2-9',
    name: 'Цепная реакция',
    birds: ['red', 'matilda', 'chuck', 'bomb'],
    parts: [bunk, shedA, atticA, roofA, shedB, atticB, roofB],
    tnt: [19.9, 22.1, 24.3, 26.5, 28.7].map((x) => tntOn(x, 0)),
    pigs: [
      pigIn('medium', bunk.spots[0]),
      pigIn('small', bunk.spots[1]),
      pigOn('small', 23.2, 0),
      pigIn('small', atticA.spots[0]),
      pigOn('medium', 30.1, 0),
      pigIn('small', atticB.spots[0]),
    ],
    hint: 'Попадите в открытый ящик TNT — цепочка сделает остальное',
    stars: { one: 0, two: 45_000, three: 58_000 },
    meta: {
      nMin: 2,
      difficulty: 7,
      teach: 'открытый запал: цепочка TNT, бункер — для Bomb',
      starsSource: 'solver',
      calib: { expertBirds: 2, expertScore: 64946, solverSec: 4.2, evaluations: 522 },
    },
    decor: [dec('shell', 3.5), dec('grass', 7.5), dec('sign', 12), dec('rock', 33.5, 0, 0.6), dec('grass', 36), dec('shell', 38, 0, 1, true)],
  });
}

/**
 * 2-10 «Замок короля» (босс) · d 8 · N 6 (nMin 5)
 * Плато plateau(16, 33, 1) с откосами; на нём замок на оси x = 24.5 (18.5–30.5):
 * - 1-й ярус — три каменных бункера (рамы span 4 из камня): helmet, mustache (в центре, под королём), helmet;
 * - 2-й ярус — три деревянные рамы, в крайних по small;
 * - 3-й ярус — ледяная зала на опорах по 3 м (квадрат 1×1 + колонна 0.5×2), проём 3×3 под king, перекрытие —
 *   каменная балка, сверху деревянная крыша 4×1.5 (верх 11 при огибающей Red 11.1 на x = 25). Каменные плиты 2×1
 *   из 06 §10 убраны: при обрушении ледяных опор 13 кг камня давили короля с одного выстрела;
 * - на крайних рамах 2-го яруса — малые крыши-башенки;
 * - 2 TNT у основания: левая на краю плато (в 1.25 м от стены), правая — в 0.25 м от дальнего бункера: её взрыв
 *   берёт каску за камнем (ключ к тыльной части замка); деревянный барбакан (2 этажа span 2) на x = 12.5
 *   и ледяная башенка на x = 36. Всё сооружение на 0.5 м левее 06 §10 — для кадра 4:3.
 * Свиньи: king, mustache, 2 helmet, 2 small. Учит: босс — королю нужно 2 тяжёлых попадания или взрыв ≤ 2.4 м.
 */
export function L2_10(): LevelDef {
  // ось замка x = 24.5: всё сооружение сдвинуто на 0.5 м влево от 06 §10, чтобы ледяная башенка справа целиком
  // помещалась в вид рогатки на экранах 4:3 (tests/render/camera.test.ts)
  const X = 24.5;
  const bays1 = [X - 4, X, X + 4].map((x) => frame({ x, y: 1, col: 'stone', beam: 'stone' }));
  const bays2 = [X - 4, X, X + 4].map((x) => frame({ x, y: bays1[0].top }));
  const throne = hall({ x: X, y: bays2[0].top, baseMat: 'ice', colMat: 'ice', roofMat: 'stone' });
  // над королём только каменная балка залы и лёгкая деревянная крыша: каменные плиты 2×1 из 06 §10 при обрушении
  // ледяных опор давили короля первым же выстрелом Red (лаборатория: 7 из 140 выстрелов убивали 5 свиней из 6)
  const crown = roof({ x: X, y: throne.top, w: 4, mat: 'wood' });
  const turrets = [roof({ x: X - 4.5, y: bays2[0].top, w: 2, mat: 'wood' }), roof({ x: X + 4.5, y: bays2[2].top, w: 2, mat: 'wood' })];
  const barbican = tower({ x: X - 12, floors: 2, span: 2, roof: 'wood' });
  const iceTower = tower({ x: X + 11.5, floors: 2, span: 2, mats: 'ice', roof: 'ice' });
  return level({
    id: '2-10',
    name: 'Замок короля',
    birds: ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal'],
    terrain: [flatGround(), plateau(X - 8.5, X + 8.5, 1, { slope: 1.5 })],
    parts: [barbican, ...bays1, ...bays2, ...turrets, throne, crown, iceTower],
    // левая TNT на краю плато в 1.25 м от стены: выбивает крайнюю каменную колонну, но каску в бункере (3.1 м до
    // поверхности) сама не убивает — иначе обломки первого же выстрела подрывали обе TNT и брали обе каски;
    // правая — в 0.25 м от дальнего бункера (2.1 м до каски): ключ к тыльной каске, которую иначе не достать
    // (с прежних 1.25 м решатель за 60 с не находил последнюю каску)
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
    camera: { castle: { x: X, y: 6, viewH: 18 } },
    stars: { one: 0, two: 41_000, three: 56_000 },
    meta: {
      nMin: 5,
      difficulty: 8,
      teach: 'босс: король под каменной крышей, все птицы эпизода',
      starsSource: 'solver',
      calib: { expertBirds: 4, expertScore: 78896, solverSec: 38.3, evaluations: 603 },
    },
    decor: [dec('shell', 3), dec('bush', 7), dec('sign', 11), dec('grass', 12.5), dec('rock', 16.5, 0, 0.8), dec('shell', 32.5, 0, 0.8), dec('grass', 37.5), dec('rock', 40, 0, 1.2, true)],
  });
}

export const EPISODE2_LEVELS: LevelDef[] = [L2_1(), L2_2(), L2_3(), L2_4(), L2_5(), L2_6(), L2_7(), L2_8(), L2_9(), L2_10()];
