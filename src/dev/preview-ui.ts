// Предпросмотр интерфейса: мок-эпизоды (3 × 10 уровней), мок-прогресс и мок-звук, фон-заглушка на canvas.
// Параметры URL:
//   ?screen=loading|title|episodes|levels|game|home|ability|banner|bannerwin|pause|settings|confirm|win|win3|winfirst|winmsg|lose|lose3
//     — сразу показать экран; winfirst — первая победа на уровне (рекорда до неё нет — строки «Рекорд» нет);
//     winmsg — победа в 1-10 без звёзд на эпизод 2 (сообщение под счётом); bannerwin — баннер, затем панель победы (FLIP ленты);
//     game — облачко подсказки с хвостиком к птице на рогатке (&tail=0 — без точки, хвоста нет);
//     home — игра с кнопкой «К рогатке» и подписью «Коснитесь, чтобы пропустить»; banner — лента «Уровень пройден!»;
//     ability — подсказка способности Чака;
//     settings/confirm — диалог настроек / подтверждение сброса; lose3 — третье поражение подряд (с советом);
//   &ep=2 — эпизод для levels; &static=1 — анимации победы/поражения сразу в финале;
//   &bg=css — запасной CSS-фон вместо canvas; &fresh=1 — «новый игрок» без прогресса;
//   &motion=reduce|full — принудительно уменьшить/включить движение; &all=1 — открыть все уровни;
//   &live=1 — перерисовывать сцену на canvas каждый кадр (как игра под оверлеем: замеры композитинга);
//   &pigs=N — сколько свиней осталось на экране поражения (дразнилка выбирается по нему), &score=N — счёт поражения;
//   &hudrect=1 — обвести пунктиром ui.hudRect() (прямоугольник правого блока HUD для камеры).

import type { BirdType, EpisodeDef, LevelDef, PigType, ThemeId } from '../core/types';
import { renderBird } from '../render/sprites/birds';
import { renderPig } from '../render/sprites/pigs';
import { ProgressStore } from '../storage/progress';
import { UI, type UIAudio } from '../ui/UI';
import { paintScene } from '../ui/art';

const NAMES: Record<string, string[]> = {
  '1': ['Первый выстрел', 'Хрупкое стекло', 'Каменная плита', 'Тройняшки', 'Холм', 'Жёлтая молния', 'Каски на сваях', 'Бункер', 'Пороховой склад', 'Форт бригадира'],
  '2': ['Валуны', 'Яйцо сверху', 'Мост над пропастью', 'Песчаный замок', 'Бумеранг', 'Пирс', 'Маяк', 'Два форта', 'Цепная реакция', 'Замок короля'],
  '3': ['Старший брат', 'Ледяной дворец', 'Лавина', 'Пещера', 'Три террасы', 'Серебряная петля', 'Крепость на утёсе', 'Ледяной мост', 'Склад на льду', 'Цитадель короля'],
};
const EP_META: Array<{ id: string; name: string; theme: ThemeId; birds: BirdType[]; pigs: PigType[] }> = [
  { id: '1', name: 'Зелёные холмы', theme: 'meadow', birds: ['red', 'blues', 'chuck', 'bomb'], pigs: ['small', 'medium', 'helmet', 'mustache'] },
  { id: '2', name: 'Пляжный закат', theme: 'beach', birds: ['matilda', 'red', 'hal', 'bomb'], pigs: ['medium', 'helmet', 'mustache', 'king'] },
  { id: '3', name: 'Снежные вершины', theme: 'snow', birds: ['terence', 'silver', 'chuck', 'blues'], pigs: ['large', 'helmet', 'mustache', 'king'] },
];

function mockLevel(ep: (typeof EP_META)[number], i: number): LevelDef {
  const n = 3 + (i % 3);
  return {
    id: `${ep.id}-${i + 1}`,
    name: NAMES[ep.id]![i]!,
    theme: ep.theme,
    birds: Array.from({ length: n }, (_, k) => ep.birds[(i + k) % ep.birds.length]!),
    slingshot: { x: 0, y: 2.7 },
    bounds: { minX: -20, maxX: 60, maxY: 40 },
    terrain: [],
    blocks: [],
    pigs: Array.from({ length: 2 + (i % 3) }, (_, k) => ({ type: ep.pigs[(i + k) % ep.pigs.length]!, x: 25 + k * 3, y: 1 })),
    stars: { one: 0, two: 30000, three: 45000 },
    hint: i === 0 && ep.id === '1' ? 'Оттяните птицу назад и отпустите!' : undefined,
  };
}

const episodes: EpisodeDef[] = EP_META.map((ep) => ({ id: ep.id, name: ep.name, theme: ep.theme, levels: Array.from({ length: 10 }, (_, i) => mockLevel(ep, i)) }));
const allLevels = episodes.flatMap((e) => e.levels);

const params = new URLSearchParams(location.search);
const screenParam = params.get('screen') ?? 'title';
const isStatic = params.get('static') === '1';

// прогресс: хранилище в памяти, чтобы предпросмотр не трогал настоящее сохранение
const mem = new Map<string, string>();
const progress = new ProgressStore({
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, v),
  removeItem: (k) => void mem.delete(k),
});
if (params.get('all') === '1') progress.unlockAll = true;
if (params.get('fresh') !== '1') {
  const ep1 = [3, 3, 2, 3, 1, 2, 3, 1];
  ep1.forEach((s, i) => progress.saveResult(`1-${i + 1}`, 30000 + s * 9000 + i * 1234, s));
  [2, 3, 1].forEach((s, i) => progress.saveResult(`2-${i + 1}`, 32000 + s * 8000 + i * 777, s));
}

const audio: UIAudio = {
  ui: (name) => console.debug('[sfx]', name),
  unlock: async () => console.debug('[audio] unlock'),
  setSfx: (on) => console.debug('[audio] sfx', on),
  setMusic: (on) => console.debug('[audio] music', on),
};

// ───────────── фон-заглушка на canvas ─────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement;
let sceneTheme: ThemeId = 'meadow';
let sceneGame = false;
const sprites = {
  red: renderBird('red', 'idle', 1, 60),
  chuck: renderBird('chuck', 'idle', 1, 60),
  blues: renderBird('blues', 'idle', 1, 60),
  pig: renderPig('medium', 'idle', 0, true, 1, 60),
  pigS: renderPig('small', 'idle', 0, true, 1, 60),
  king: renderPig('helmet', 'idle', 0, true, 1, 60),
};

function drawScene(): void {
  const c = canvas.getContext('2d')!;
  c.save();
  try {
    drawSceneInner(c);
  } finally {
    c.restore();
  }
}

function drawSceneInner(c: CanvasRenderingContext2D): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fullW = Math.round(window.innerWidth * dpr);
  const fullH = Math.round(window.innerHeight * dpr);
  if (canvas.width !== fullW || canvas.height !== fullH) {
    canvas.width = fullW;
    canvas.height = fullH;
  }
  // «Играть так» в портрете: сцена — в полосе 16:9 по ширине, как и интерфейс
  const lb = uiReady && ui.letterbox;
  const w = fullW;
  const h = lb ? Math.round((fullW * 9) / 16) : fullH;
  if (lb) {
    c.fillStyle = '#0b1a2b';
    c.fillRect(0, 0, fullW, fullH);
    c.translate(0, Math.round((fullH - h) / 2));
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
  }
  paintScene(c, w, h, sceneTheme, 3, 0.18);
  if (!sceneGame) return;
  // упрощённая «игровая» сцена: рогатка с птицей и домик со свиньями
  const gy = h * 0.82;
  const s = h / 720;
  const sx = w * 0.2;
  c.lineCap = 'round';
  c.strokeStyle = '#4A2A10';
  c.lineWidth = 26 * s;
  c.beginPath();
  c.moveTo(sx, gy);
  c.lineTo(sx, gy - 90 * s);
  c.moveTo(sx, gy - 90 * s);
  c.lineTo(sx - 30 * s, gy - 160 * s);
  c.moveTo(sx, gy - 90 * s);
  c.lineTo(sx + 30 * s, gy - 160 * s);
  c.stroke();
  c.strokeStyle = '#A0682E';
  c.lineWidth = 16 * s;
  c.stroke();
  const put = (sp: { canvas: HTMLCanvasElement; ox: number; oy: number }, x: number, y: number, r: number): void => {
    const k = r / 60;
    c.drawImage(sp.canvas, x - sp.ox * k, y - sp.oy * k, sp.canvas.width * k, sp.canvas.height * k);
  };
  put(sprites.red, sx, gy - 160 * s, 26 * s);
  put(sprites.chuck, sx - 70 * s, gy - 24 * s, 24 * s);
  put(sprites.blues, sx - 120 * s, gy - 14 * s, 14 * s);
  const bx = w * 0.72;
  c.fillStyle = '#C98A4B';
  c.strokeStyle = '#5A3412';
  c.lineWidth = 4 * s;
  const block = (x: number, y: number, bw: number, bh: number): void => {
    c.beginPath();
    c.roundRect(x, y, bw, bh, 4 * s);
    c.fill();
    c.stroke();
  };
  block(bx - 110 * s, gy - 150 * s, 24 * s, 150 * s);
  block(bx + 86 * s, gy - 150 * s, 24 * s, 150 * s);
  block(bx - 120 * s, gy - 174 * s, 240 * s, 24 * s);
  block(bx - 14 * s, gy - 290 * s, 24 * s, 116 * s);
  put(sprites.pig, bx - 40 * s, gy - 38 * s, 38 * s);
  put(sprites.pigS, bx + 46 * s, gy - 26 * s, 26 * s);
  put(sprites.king, bx + 60 * s, gy - 212 * s, 38 * s);
}
window.addEventListener('resize', drawScene);
if (new URLSearchParams(location.search).get('live') === '1') {
  const loop = (): void => {
    drawScene();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ───────────── UI ─────────────
const stage = document.getElementById('stage')!;
let ui!: UI;
let uiReady = false;
const levelById = (id: string): LevelDef | undefined => allLevels.find((l) => l.id === id);
let current: LevelDef = levelById('1-3')!;

function enterGame(level: LevelDef): void {
  current = level;
  sceneGame = true;
  sceneTheme = level.theme;
  drawScene();
  ui.showHud(level);
  const rec = progress.record(level.id);
  ui.updateHud({ score: 0, best: rec?.best ?? 0, birdsLeft: level.birds.length, pigsLeft: level.pigs.length });
}

ui = new UI(stage, {
  episodes,
  progress,
  audio,
  onPlayLevel: (id) => {
    const l = levelById(id);
    if (l) window.setTimeout(() => enterGame(l), 250);
  },
  onPause: () => console.debug('[app] pause'),
  onResume: () => console.debug('[app] resume'),
  onRestart: () => {
    console.debug('[app] restart');
    ui.updateHud({ score: 0, best: progress.record(current.id)?.best ?? 0, birdsLeft: current.birds.length, pigsLeft: current.pigs.length });
  },
  onQuitToMenu: () => {
    sceneGame = false;
    drawScene();
  },
  onNextLevel: () => {
    const i = allLevels.indexOf(current);
    const n = allLevels[i + 1];
    if (n) window.setTimeout(() => enterGame(n), 250);
  },
  onSkip: () => {
    console.debug('[app] skip');
    ui.hideBanner();
  },
  onCameraHome: () => {
    console.debug('[app] camera home');
    ui.setCameraHome(false);
  },
  onScreenChange: (screen, theme) => {
    console.debug('[app] screen', screen, theme);
    sceneTheme = theme;
    sceneGame = screen === 'game';
    drawScene();
  },
  onSettingsChange: (st) => console.debug('[app] settings', st),
});
uiReady = true;
if (params.get('bg') === 'css') ui.setMenuBackground('css');
const motionParam = params.get('motion');
if (motionParam === 'reduce' || motionParam === 'full') ui.setMotion(motionParam === 'reduce');
(window as unknown as { __ui: UI; __progress: ProgressStore }).__ui = ui;
(window as unknown as { __progress: ProgressStore }).__progress = progress;

function gameWith(score: number, pigs: number): void {
  enterGame(current);
  ui.updateHud({ score, best: progress.record(current.id)?.best ?? 0, birdsLeft: 2, pigsLeft: pigs });
}

drawScene();
switch (screenParam) {
  case 'loading':
    ui.showLoading(0.63);
    break;
  case 'episodes':
    ui.showEpisodes();
    break;
  case 'levels':
    ui.showLevels(params.get('ep') ?? '1');
    break;
  case 'game': {
    gameWith(23450, 2);
    // хвостик — к птице на рогатке (та же точка, что рисует drawSceneInner: x = 20 % ширины, 160/720 высоты над землёй)
    const at = params.get('tail') === '0' ? undefined : { x: window.innerWidth * 0.2, y: window.innerHeight * (0.82 - 160 / 720) };
    if (current.hint) ui.showHint(current.hint, 4000, { at });
    else ui.showHint('Синие делятся на троих — отлично бьют стекло!', 60000, { bird: 'blues', at });
    break;
  }
  case 'home':
    gameWith(0, 3);
    ui.setCameraHome(true);
    ui.setSkipHint(true);
    break;
  case 'ability':
    gameWith(5200, 3);
    ui.abilityHint('chuck', 60000);
    break;
  case 'banner':
    gameWith(48200, 0);
    ui.showBanner('Уровень пройден!', 0, { kind: 'win', badge: 'Одним выстрелом!' });
    break;
  case 'pause':
    gameWith(23450, 2);
    ui.showPause();
    break;
  case 'settings':
  case 'confirm':
    ui.showTitle();
    ui.openSettings();
    if (screenParam === 'confirm') window.setTimeout(() => document.querySelector<HTMLButtonElement>('[data-testid="set-reset"]')?.click(), 50);
    break;
  case 'win':
  case 'win3': {
    const three = screenParam === 'win3';
    gameWith(three ? 61230 : 38450, 0);
    const rec = progress.record(current.id);
    const score = three ? 61230 : 38450;
    const stars = three ? 3 : 2;
    const res = progress.saveResult(current.id, score, stars);
    // best — рекорд до этой победы (как в GameScreen): строка «Рекорд: 50 468» до бейджа
    ui.showWin({ levelId: current.id, score, best: rec?.best ?? 0, stars, newRecord: three ? true : res.newRecord, hasNext: true });
    if (isStatic) window.setTimeout(() => ui.finishAnimations(), 30);
    break;
  }
  case 'winfirst': {
    // первая победа на 1-9: рекорда до неё нет — строки «Рекорд» нет, пока крутится счёт (плейтест №2, Б6)
    current = levelById('1-9')!;
    gameWith(34560, 0);
    const res = progress.saveResult(current.id, 34560, 2);
    ui.showWin({ levelId: current.id, score: 34560, best: res.prevBest, stars: 2, newRecord: res.newRecord, hasNext: true });
    if (isStatic) window.setTimeout(() => ui.finishAnimations(), 30);
    break;
  }
  case 'winmsg': {
    // последний уровень эпизода пройден, но звёзд на следующий эпизод не хватает — сообщение под счётом
    progress.reset();
    for (let i = 1; i <= 9; i++) progress.saveResult(`1-${i}`, 20000, 1);
    current = levelById('1-10')!;
    gameWith(31200, 0);
    const res = progress.saveResult('1-10', 31200, 2);
    ui.showWin({ levelId: '1-10', score: 31200, best: res.prevBest, stars: 2, newRecord: res.newRecord, hasNext: progress.isUnlocked('2-1', allLevels.map((l) => l.id)) });
    if (isStatic) window.setTimeout(() => ui.finishAnimations(), 30);
    break;
  }
  case 'bannerwin': {
    // баннер «Уровень пройден!», через 0.9 с — панель победы (лента перелетает из баннера)
    gameWith(48200, 0);
    ui.showBanner('Уровень пройден!', 0, { kind: 'win', badge: 'Одним выстрелом!' });
    window.setTimeout(() => ui.showWin({ levelId: current.id, score: 48200, best: 50468, stars: 3, newRecord: false, hasNext: true }), 900);
    break;
  }
  case 'lose':
  case 'lose3': {
    const pigs = Number(params.get('pigs') ?? 2);
    const score = Number(params.get('score') ?? 12340);
    gameWith(score, pigs);
    if (screenParam === 'lose3') for (let i = 0; i < 3; i++) progress.saveLoss(current.id);
    ui.showLose({ levelId: current.id, score, pigsLeft: pigs });
    if (isStatic) window.setTimeout(() => ui.finishAnimations(), 30);
    break;
  }
  default:
    ui.showTitle();
}

// обводка ui.hudRect(): то, что видит камера (правый блок HUD без анимаций, место под счёт до 99 999)
if (params.get('hudrect') === '1') {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:100;pointer-events:none;outline:2px dashed #ff2d55;outline-offset:0';
  document.body.append(box);
  const tick = (): void => {
    const r = ui.hudRect();
    box.style.display = r ? 'block' : 'none';
    if (r) Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
