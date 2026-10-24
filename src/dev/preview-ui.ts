// Предпросмотр интерфейса: мок-эпизоды (3 × 10 уровней), мок-прогресс и мок-звук, фон-заглушка на canvas.
// Параметры URL:
//   ?screen=loading|title|episodes|levels|game|pause|win|win3|lose — сразу показать экран;
//   &ep=2 — эпизод для levels; &static=1 — анимации победы/поражения сразу в финале;
//   &bg=css — запасной CSS-фон вместо canvas; &fresh=1 — «новый игрок» без прогресса.

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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const c = canvas.getContext('2d')!;
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

// ───────────── UI ─────────────
const stage = document.getElementById('stage')!;
let ui!: UI;
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
});
if (params.get('bg') === 'css') ui.setMenuBackground('css');
(window as unknown as { __ui: UI; __progress: ProgressStore }).__ui = ui;
(window as unknown as { __progress: ProgressStore }).__progress = progress;

// следим за темой фона меню
const syncTheme = (): void => {
  const lv = document.querySelector<HTMLElement>('.scr-levels');
  const t = (lv?.dataset.theme as ThemeId | undefined) ?? (ui.screen === 'game' ? current.theme : 'meadow');
  const g = ui.screen === 'game';
  if (t !== sceneTheme || g !== sceneGame) {
    sceneTheme = t;
    sceneGame = g;
    drawScene();
  }
};
new MutationObserver(syncTheme).observe(stage, { subtree: true, childList: true });

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
  case 'game':
    gameWith(23450, 2);
    if (current.hint) ui.showHint(current.hint);
    else ui.showHint('Синие делятся на троих — отлично бьют стекло!', 60000);
    break;
  case 'pause':
    gameWith(23450, 2);
    ui.showPause();
    break;
  case 'win':
  case 'win3': {
    const three = screenParam === 'win3';
    gameWith(three ? 61230 : 38450, 0);
    const rec = progress.record(current.id);
    const score = three ? 61230 : 38450;
    const stars = three ? 3 : 2;
    const res = progress.saveResult(current.id, score, stars);
    ui.showWin({ levelId: current.id, score, best: Math.max(rec?.best ?? 0, score), stars, newRecord: three ? true : res.newRecord, hasNext: true });
    if (isStatic) window.setTimeout(() => ui.finishAnimations(), 30);
    break;
  }
  case 'lose':
    gameWith(12340, 2);
    ui.showLose({ levelId: current.id });
    if (isStatic) window.setTimeout(() => ui.finishAnimations(), 30);
    break;
  default:
    ui.showTitle();
}
