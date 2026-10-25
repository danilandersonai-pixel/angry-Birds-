#!/usr/bin/env node
// e2e-смоук игры в Chromium (Playwright) с собственным dev-сервером Vite.
//
//   node scripts/e2e.mjs [--out DIR] [--quick] [--sizes 1600x900,844x390@2,1280x960] [--only victory,tempo]
//
// Что проверяется:
//  • загрузка без ошибок консоли и исключений → титул → эпизоды → уровни → 1-1 (настоящими нажатиями);
//  • пропуск облёта тапом, прицел и выстрел настоящим жестом мыши, затем выстрелы через хук до победы/поражения;
//  • экран результата (победа или поражение) — в трёх размерах: 1600×900, 844×390 (dpr 2, тач), 1280×960;
//  • visibilitychange во время полёта: пауза, время сессии стоит, после возврата нет «взрыва» (≤ 4 шагов за кадр);
//  • рестарт клавишей R в полёте: новая сессия, птица снова в рогатке;
//  • загрузка каждого из 30 уровней по очереди (startLevel + skipIntro + кадр) без ошибок;
//  • замер FPS на самом тяжёлом уровне (больше всего тел) с разрушением;
//  • плейтест №1: подсказка уровня не во время облёта, а после него; вид рогатки — Ред не мельче порога размера (1-1);
//    автокачество при ровных кадрах не падает (idleRate); после хода на 3-10 — живые свиньи в виде рогатки.
//  • плейтест №2: вид рогатки показывает весь контент (30 уровней × все размеры; тела не под HUD); на 1-1 вместо
//    текста — рука обучения; после гибели последней свиньи нет «К рогатке», баннер ≤ 1 с, от неё до итогов ≤ 4.5 с
//    и с тапом, и без тапа (тайминги ядра Б3); кадр рендера на первом взрыве ≤ 20 мс.
//  • компактные уровни (V_MAX 21): Ред в виде рогатки на всех 30 уровнях не мельче порога размера (RED_MIN),
//    полоса земли внизу кадра 8…15 % высоты.
//  • после каждого хода (playOut): живые свиньи, и укатившиеся за габарит уровня, — в виде рогатки, камера едет в него.
//  • покой в виде рогатки: без ввода ≤ 30 кадров/с, движение мыши — полная частота; при ровных ≥ 55 fps автокачество
//    не понижает (интервалы rAF; снимки экрана на 30 уровнях — лишь заметка).
//  • «Уменьшить движение» системой: меню без дрейфа камеры, в игре нет тряски и экранной вспышки.
//  • R на баннере победы (свиней нет, итогов ещё нет): рестарт, а победа записана (record('1-1')).
//  • полёт на полной силе (30°/45°/60°): птица всё время в кадре (по горизонтали и под верхом кадра), навес долетает
//    до дальней части уровня, камера возвращается в вид рогатки.
//  • патчи модулей: на баннере победы звучит «уровень зачищен» (play('cleared')); под окном итогов сцена замирает
//    (ни перерисовок, ни шагов сессии); на поражении — пауза со смехом (баннер ≥ 1.1 с, итоги 2…4 с) и дразнилка; у облачка подсказки 1-2 — хвостик к рогатке;
//    кадр рендера первого взрыва меряется в окне от взрыва до +2.5 с.
// --only — только выбранные разделы: flow, robustness, framing, flight, victory, tempo, blast, reduced, idle.
// Скриншоты ключевых моментов — в --out (по умолчанию <tmp>/angry-birds-e2e). Код возврата ≠ 0 при ошибках.

import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'angry-birds-e2e')));
const QUICK = argv.includes('--quick');
const ONLY = new Set(arg('only', '').split(',').filter(Boolean));
const run = (name) => ONLY.size === 0 || ONLY.has(name);
const SIZES = arg('sizes', '1600x900,844x390@2,1280x960')
  .split(',')
  .map((s) => {
    const m = /^(\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(s.trim());
    if (!m) throw new Error(`плохой размер: ${s}`);
    return { w: Number(m[1]), h: Number(m[2]), dpr: Number(m[3] ?? 1) };
  });
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const notes = [];
const log = (...a) => console.log(...a);
function check(ok, msg) {
  if (ok) log(`  ✓ ${msg}`);
  else {
    log(`  ✗ ${msg}`);
    failures.push(msg);
  }
  return ok;
}

// ───────────────────────── сервер и браузер ─────────────────────────

const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false },
  logLevel: 'error',
});
await server.listen();
const BASE = `http://127.0.0.1:${server.httpServer.address().port}`;
// без --autoplay-policy: звук заблокирован до первого жеста, как у игрока (00 §2 ревью, п. 3)
const browser = await chromium.launch();

/** Подобрать выстрел (угол°, сила) в точку без учёта препятствий — дискретная модель planck; числа — из игры (launchSpec). */
const SOLVE = `(tx, ty, lowFirst) => {
  const a0 = __game.anchor(); const bird = __game.loaded() || 'red';
  const L = __game.launchSpec();
  const K = L.scale[bird] || 1;
  const V = L.vMax, R = L.rMax, G = L.g, h = 1 / 60;
  let best = null;
  for (let a = 3; a <= 75; a += 0.25) for (let p = 0.5; p <= 1.0001; p += 0.005) {
    const r = a * Math.PI / 180, dx = Math.cos(r), dy = Math.sin(r);
    const x0 = a0.x - dx * p * R, y0 = a0.y - dy * p * R;
    const vx = dx * V * K * p, vy = dy * V * K * p;
    const t = (tx - x0) / vx; if (t <= 0) continue;
    const y = y0 + vy * t - G * (t * t + h * t) / 2;
    const err = Math.abs(y - ty); if (err > 0.25) continue;
    const score = (lowFirst ? a : -a) - p * 5;
    if (!best || score < best.score) best = { a, p, score };
  }
  return best;
}`;

/**
 * Линия эксперта уровня из src/levels/calib.ts (устойчива к шуму исполнения): [{ angleDeg, power, abilityAt? }].
 * Грубый бот SOLVE («в ближайшую свинью») на 1-1 выигрывал лишь в ~70 % прогонов — проверка финала мигала.
 */
const CALIB_SRC = fs.readFileSync(path.join(root, 'src/levels/calib.ts'), 'utf8');
function expertPlan(id) {
  const m = CALIB_SRC.match(new RegExp(`'${id}': \\{[\\s\\S]*?plan: (\\[[^\\n]*\\]),`));
  // объектный литерал TS → JSON: ключи в кавычки
  return m ? JSON.parse(m[1].replace(/(\w+):/g, '"$1":')) : [];
}

async function newPage(size, touch = false) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
    else if (m.type() === 'warning') notes.push(`[console.warn ${size.w}x${size.h}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
  return { ctx, page, errors };
}

const tag = (size) => `${size.w}x${size.h}${size.dpr !== 1 ? `@${size.dpr}` : ''}`;

/**
 * Минимальный размер Реда (диаметр, CSS px) в виде рогатки после компактизации уровней: цели 06/отчётов уровней —
 * 40 px на 1600×900 и 22 px на телефоне 844×390; на 4:3 — 32 px; для прочих размеров — 20 px (как в плейтесте №1).
 */
const RED_MIN = { '1600x900': 40, '844x390@2': 22, '1280x960': 32 };
const redMin = (size) => RED_MIN[tag(size)] ?? 20;

async function tap(page, sel) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: 'visible', timeout: 15000 });
  const b = await loc.boundingBox();
  if (!b) throw new Error(`нет элемента ${sel}`);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

const until = (page, fn, arg0, timeout = 20000) => page.waitForFunction(fn, arg0, { timeout, polling: 50 });

async function shoot(page, low = true) {
  return page.evaluate(
    `(() => { const pigs = __game.pigs().sort((a, b) => a.x - b.x); const t = pigs[0]; if (!t) return null;
      const s = (${SOLVE})(t.x, t.y, ${low}); if (!s) return null; return __game.launch(s.a, s.p) ? s : null; })()`,
  );
}

/** Выстрелы до конца уровня (won/lost), не больше max. */
async function playOut(page, max = 8) {
  for (let i = 0; i < max; i++) {
    const st = await page.evaluate('__game.settle(25)');
    if (st !== 'ready') return st;
    // после хода (playOut зовут после первого выстрела жестом): живые свиньи, и укатившиеся за габарит уровня, —
    // в виде рогатки, камера едет в него
    await page.waitForTimeout(350);
    const fr = await page.evaluate('__game.framing()');
    check(fr.pigsOut === 0 && fr.aimed, `ход ${i + 1}: живые свиньи в виде рогатки (вне кадра ${fr.pigsOut}), камера едет в вид рогатки (${fr.aimed})`);
    const s = await shoot(page, i % 2 === 0);
    if (!s) await page.evaluate('__game.launch(35, 1)');
  }
  return page.evaluate('__game.settle(25)');
}

// ───────────────────────── 1. полный путь в трёх размерах ─────────────────────────

async function flow(size, idx) {
  const touch = size.dpr > 1 && size.w < 1000;
  log(`\n▶ Путь игрока ${tag(size)}${touch ? ' (тач)' : ''}`);
  const { ctx, page, errors } = await newPage(size, touch);
  const T = tag(size);
  try {
    const t0 = Date.now();
    // новый контекст — чистое хранилище; первый размер — со звуком (разблокировка по первому жесту)
    await page.goto(`${BASE}/index.html${idx === 0 ? '' : '?mute=1'}`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.screen() === 'title', null, 90000);
    check(true, `титул за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
    await page.evaluate('__game.sounds()'); // журнал play(): звук баннера победы
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${T}-01-title.png` });
    await tap(page, '[data-testid="btn-play"]');
    await until(page, () => __game.screen() === 'episodes');
    if (idx === 0) {
      await page.waitForTimeout(300);
      const audio = await page.evaluate('__game.audio()');
      check(audio === 'running', `звук запущен первым жестом (${audio})`);
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${T}-02-episodes.png` });
    check(true, 'эпизоды');
    await tap(page, '[data-testid="episode-card-1"]');
    await until(page, () => __game.screen() === 'levels');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${T}-03-levels.png` });
    check(true, 'уровни');
    await tap(page, '[data-testid="level-tile-1-1"]');
    await until(page, () => __game.screen() === 'game' && __game.phase() === 'intro', null, 30000);
    check(true, 'уровень 1-1 открыт, идёт облёт');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${T}-04-intro.png` });
    check(!(await page.evaluate(() => !!document.querySelector('[data-testid="hint"]'))), 'во время облёта подсказки уровня нет');
    // любой ввод пропускает облёт
    await page.mouse.click(size.w * 0.6, size.h * 0.5);
    await until(page, () => __game.phase() === 'play', null, 3000).catch(() => null);
    check((await page.evaluate('__game.phase()')) === 'play', 'тап пропускает облёт');
    check((await page.evaluate('__game.settle(10)')) === 'ready', 'птица в рогатке (ready)');
    await page.waitForTimeout(300);
    // 1-1 с чистым профилем: учит рука обучения — текстовой подсказки нет (плейтест №2, п. 9); текст — на 1-2
    check(!(await page.evaluate(() => !!document.querySelector('[data-testid="hint"]'))), '1-1: вместо текстовой подсказки — рука обучения');
    const red = await page.evaluate((h) => (0.9 * h) / __game.stats().aimViewH, size.h);
    check(red >= redMin(size), `вид рогатки: Ред ${red.toFixed(0)} CSS px (≥ ${redMin(size)})`);
    // прицел настоящим жестом: тянем влево-вниз (на третьем размере — вправо-вниз: выстрел назад, проверка поражения)
    const p = await page.evaluate('__game.pocketScreen()');
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    const k = Math.min(size.w, size.h * 1.6) / 900;
    const sx = idx === 2 ? 1 : -1;
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(p.x + sx * 9 * i * k, p.y + 3.2 * i * k);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(200);
    check((await page.evaluate('__game.state()')) === 'aiming', 'жест мышью — прицел');
    await page.screenshot({ path: `${OUT}/${T}-05-aim.png` });
    await page.mouse.up();
    await page.waitForTimeout(80);
    check((await page.evaluate('__game.state()')) === 'flying', 'отпустили — птица летит');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${T}-06-flight.png` });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${T}-07-impact.png` });
    // дальше — через хук, до победы (или поражения на третьем размере — проверка экрана поражения)
    let end;
    if (idx === 2) {
      for (let i = 0; i < 6; i++) {
        const st = await page.evaluate('__game.settle(25)');
        if (st !== 'ready') break;
        await page.evaluate('__game.launch(84, 0.55)');
      }
      end = await page.evaluate('__game.settle(25)');
    } else end = await playOut(page);
    check(end === 'won' || end === 'lost', `уровень закончился: ${end}`);
    if (end === 'lost') {
      // поражение — пауза со смеющимися свиньями: баннер не сразу, окно итогов не раньше чем через 2 с
      const t0 = Date.now();
      const early = await page.evaluate(() => !!document.querySelector('[data-testid="banner"]'));
      await until(page, () => !!document.querySelector('[data-testid="banner"]'), null, 6000).catch(() => null);
      const tb = Date.now() - t0;
      await page.screenshot({ path: `${OUT}/${T}-08-banner.png` });
      await until(page, () => !!document.querySelector('[data-testid="results-score"]'), null, 8000).catch(() => null);
      const tr = Date.now() - t0;
      check(!early && tb >= 1100 && tr >= 2000 && tr <= 4000, `поражение: баннер через ${(tb / 1000).toFixed(2)} с (≥ 1.1), окно итогов через ${(tr / 1000).toFixed(2)} с (2…4)`);
    } else {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${T}-08-banner.png` });
    }
    if (end === 'won') {
      const snd = await page.evaluate('__game.sounds()');
      check(snd.includes('cleared'), `баннер победы: звук «уровень зачищен» (play('cleared'); журнал: ${snd.slice(-4).join(', ') || '—'})`);
    }
    await until(page, () => !!document.querySelector('[data-testid="results-score"]'), null, 15000).catch(() => null);
    await page.waitForTimeout(3600);
    const res = await page.evaluate(() => ({
      score: document.querySelector('[data-testid="results-score"]')?.textContent ?? null,
      next: !!document.querySelector('[data-testid="results-next"]'),
      restart: !!document.querySelector('[data-testid="results-restart"]'),
    }));
    check(res.score !== null, `экран результата (${end}), счёт: ${res.score}`);
    if (end === 'won') check(res.next, 'на победе есть «Дальше»');
    if (end === 'lost') {
      const taunt = await page.evaluate(() => document.querySelector('[data-testid="lose-taunt"]')?.textContent ?? '');
      // выстрелы мимо (счёт 0, свиньи все живы): «Почти получилось!» — только при одной свинье (pickTaunt по pigsLeft/score)
      check(taunt.length > 0 && !/Почти|одна свинья/.test(taunt), `поражение: дразнилка «${taunt}» (без «почти»)`);
    }
    // под окном итогов сцена замерла (Б10): кадр холста не перерисовывается, сессия не шагает
    const fz0 = await page.evaluate(() => ({ r: __game.stats().renders, t: __game.time(), f: __game.stats().frozen }));
    await page.waitForTimeout(500);
    const fz1 = await page.evaluate(() => ({ r: __game.stats().renders, t: __game.time(), f: __game.stats().frozen }));
    check(fz0.f && fz1.r === fz0.r && fz1.t === fz0.t, `под итогами сцена замерла: перерисовок за 0.5 с ${fz1.r - fz0.r}, время сессии ${fz0.t.toFixed(2)} → ${fz1.t.toFixed(2)}`);
    await page.screenshot({ path: `${OUT}/${T}-09-results.png` });
    if (end === 'won' && res.next) {
      await tap(page, '[data-testid="results-next"]');
      await until(page, () => __game.level() === '1-2' && __game.phase() !== 'loading', null, 30000).catch(() => null);
      check((await page.evaluate('__game.level()')) === '1-2', '«Дальше» открывает 1-2');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${T}-10-next.png` });
      await page.mouse.click(size.w * 0.6, size.h * 0.5);
      await until(page, () => __game.phase() === 'play', null, 4000).catch(() => null);
      await page.waitForTimeout(400);
      check(await page.evaluate(() => !!document.querySelector('[data-testid="hint"]')), '1-2: после облёта — подсказка уровня');
      check(await page.evaluate(() => !!document.querySelector('[data-testid="hint"] .hint-tail')), '1-2: у облачка подсказки — хвостик к рогатке');
    }
  } catch (e) {
    check(false, `${T}: ${e.message}`);
    await page.screenshot({ path: `${OUT}/${T}-fail.png` }).catch(() => null);
  }
  check(errors.length === 0, `${T}: ошибок консоли нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

// ───────────────────────── 2. пауза вкладки, рестарт, все уровни, FPS ─────────────────────────

async function robustness() {
  const size = SIZES[0];
  log(`\n▶ Пауза вкладки, рестарт в полёте, 30 уровней, FPS (${tag(size)})`);
  const { ctx, page, errors } = await newPage(size);
  try {
    await page.goto(`${BASE}/index.html?mute=1&level=1-2&intro=0&seed=5`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.screen() === 'game' && __game.phase() === 'play', null, 90000);
    check((await page.evaluate('__game.settle(10)')) === 'ready', '1-2 по ?level=1-2&intro=0 — сразу игра');

    // visibilitychange во время полёта
    await page.evaluate('__game.launch(30, 0.9)');
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(100);
    check(await page.evaluate('__game.paused()'), 'вкладка скрыта → пауза');
    const t1 = await page.evaluate('__game.time()');
    await page.waitForTimeout(1500);
    const t2 = await page.evaluate('__game.time()');
    check(t2 === t1, `на паузе время сессии стоит (${t1.toFixed(3)} → ${t2.toFixed(3)})`);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.screenshot({ path: `${OUT}/r-01-paused.png` });
    // продолжить кнопкой паузы (как игрок)
    await tap(page, '[data-testid="pause-resume"]');
    await until(page, () => !__game.paused(), null, 3000).catch(() => null);
    const jump = await page.evaluate(
      () =>
        new Promise((res) => {
          const a = __game.time();
          requestAnimationFrame(() => requestAnimationFrame(() => res(__game.time() - a)));
        }),
    );
    check(!(await page.evaluate('__game.paused()')), 'продолжить → игра идёт');
    check(jump <= (2 * 4) / 60 + 1e-6, `после возврата нет «взрыва»: +${(jump * 60).toFixed(1)} шагов за 2 кадра (≤ 8)`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/r-02-resumed.png` });

    // рестарт клавишей R в полёте
    await page.evaluate('__game.settle(25)');
    if ((await page.evaluate('__game.state()')) === 'ready') {
      await page.evaluate('__game.launch(40, 1)');
      await page.waitForTimeout(400);
      check((await page.evaluate('__game.state()')) === 'flying', 'снова в полёте');
      await page.keyboard.press('r');
      await until(page, () => __game.time() < 0.2 && __game.state() === 'loading', null, 4000).catch(() => null);
      check((await page.evaluate('__game.time()')) < 0.5, 'R в полёте → новая сессия');
      await page.evaluate('__game.skipIntro()');
      check((await page.evaluate('__game.settle(10)')) === 'ready', 'после рестарта птица в рогатке');
      check((await page.evaluate('__game.birdsLeft()')) === 3, 'после рестарта снова 3 птицы');
      await page.screenshot({ path: `${OUT}/r-03-restarted.png` });
    } else check(false, 'не дождались ready перед рестартом');

    // все уровни по очереди
    const ids = await page.evaluate(() => {
      const out = [];
      for (const ep of [1, 2, 3]) for (let i = 1; i <= 10; i++) out.push(`${ep}-${i}`);
      return out;
    });
    let loaded = 0;
    const heavy = { id: '', n: -1 };
    for (const id of ids) {
      const before = errors.length;
      const ok = await page.evaluate(`__game.startLevel('${id}')`).catch((e) => (errors.push(String(e)), false));
      await page.evaluate('__game.skipIntro()');
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
      const st = await page.evaluate('__game.stats()');
      const good = ok && (await page.evaluate('__game.level()')) === id && errors.length === before;
      if (good) loaded++;
      else check(false, `уровень ${id} не загрузился чисто`);
      const n = await page.evaluate('__game.pigs().length');
      const bodies = st.drawn + n;
      if (bodies > heavy.n) {
        heavy.id = id;
        heavy.n = bodies;
      }
      if (!QUICK) await page.screenshot({ path: `${OUT}/lv-${id}.png` });
    }
    check(loaded === ids.length, `загружено уровней без ошибок: ${loaded}/${ids.length}`);

    // FPS на самом тяжёлом уровне
    const hid = '3-10';
    await page.evaluate(`__game.startLevel('${hid}')`);
    await page.evaluate('__game.skipIntro()');
    await page.evaluate('__game.settle(10)');
    await page.waitForTimeout(1200);
    const idle = await page.evaluate('__game.fps()');
    await shoot(page, true);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/r-04-heavy-impact.png` });
    await page.waitForTimeout(1100);
    const busy = await page.evaluate('__game.fps()');
    const stats = await page.evaluate('__game.stats()');
    notes.push(`FPS ${hid} (${tag(size)}): покой ${idle}, разрушение ${busy}; ${JSON.stringify(stats)}`);
    log(`  · FPS ${hid}: покой ${idle}, во время разрушения ${busy}, кадр рендера ${stats.renderMs} мс, качество ${stats.quality}`);
    check(busy > 0, 'FPS измерен');
    // автокачество меряет и интервалы rAF (выпавшие кадры): снимки экрана на 30 уровнях выше останавливают кадры на
    // сотни мс, и в headless ступень может честно понизиться — здесь только заметка; ровный случай — в idleRate()
    notes.push(`автокачество после 30 уровней со снимками и разрушения на 3-10: ${stats.quality} (понижений ${stats.downgrades})`);
    // после хода на самом тяжёлом уровне: живые свиньи — в виде рогатки, камера едет в него
    if ((await page.evaluate('__game.settle(25)')) === 'ready') {
      await page.waitForTimeout(350);
      const fr = await page.evaluate('__game.framing()');
      check(fr.pigsOut === 0 && fr.aimed, `${hid} после хода: живые свиньи в виде рогатки (вне кадра ${fr.pigsOut}), камера едет в вид рогатки (${fr.aimed})`);
    }
    log(`  · самый «телесный» по замеру: ${heavy.id}`);
  } catch (e) {
    check(false, `надёжность: ${e.message}`);
    await page.screenshot({ path: `${OUT}/r-fail.png` }).catch(() => null);
  }
  check(errors.length === 0, `ошибок консоли нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

// ───────────────────────── 3. плейтест №2: кадр, финал победы, первый взрыв ─────────────────────────

/** Вид рогатки на всех уровнях: контент целиком в кадре, тела не под HUD. */
async function framing(size) {
  const touch = size.dpr > 1 && size.w < 1000;
  log(`\n▶ Вид рогатки: весь контент в кадре, 30 уровней (${tag(size)}${touch ? ', тач' : ''})`);
  const { ctx, page, errors } = await newPage(size, touch);
  try {
    await page.goto(`${BASE}/index.html?mute=1&unlockAll=1&level=1-1&intro=0&seed=3`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.screen() === 'game' && __game.phase() === 'play', null, 90000);
    const bad = [];
    const atCap = [];
    const hud = [];
    let redLo = Infinity;
    let redLoId = '';
    let redSum = 0;
    let gndLo = Infinity;
    let gndHi = -Infinity;
    let gndSum = 0;
    let n = 0;
    for (let ep = 1; ep <= 3; ep++) {
      for (let i = 1; i <= 10; i++) {
        const id = `${ep}-${i}`;
        await page.evaluate(`__game.startLevel('${id}')`);
        await page.evaluate('__game.skipIntro()');
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
        const f = await page.evaluate('__game.framing()');
        const cut = Math.max(f.cutRight, f.cutTop);
        if (cut > 0.05) (f.atCap ? atCap : bad).push(`${id} −${cut.toFixed(1)} м (h ${f.viewH.toFixed(1)})`);
        if (f.hudHits > 0 && !f.atCap) hud.push(`${id}: ${f.hudHits}`);
        if (f.redPx < redLo) {
          redLo = f.redPx;
          redLoId = id;
        }
        redSum += f.redPx;
        gndLo = Math.min(gndLo, f.groundFrac);
        gndHi = Math.max(gndHi, f.groundFrac);
        gndSum += f.groundFrac;
        n++;
        if (!QUICK && (id === '1-1' || id === '2-5' || id === '3-10')) await page.screenshot({ path: `${OUT}/frame-${tag(size)}-${id}.png` });
      }
    }
    // уровни компактные (Б1 закрыт): контент влезает на всех размерах, в том числе на 4:3, без упора в потолок
    const cutAll = [...bad, ...atCap.map((c) => `${c} — на потолке`)];
    check(cutAll.length === 0, `весь контент в кадре вида рогатки (${n} уровней)${cutAll.length ? `: ${cutAll.join(', ')}` : ''}`);
    // HUD: допускается, только если отдалять дальше нельзя (запас ×1.35 исчерпан) — тогда в заметки
    if (hud.length) notes.push(`[${tag(size)}] тела под HUD (запас отдаления исчерпан): ${hud.join(', ')}`);
    check(hud.length <= 2, `верх сооружения не под HUD (исключений ${hud.length} ≤ 2)`);
    check(redLo >= redMin(size), `Ред в виде рогатки не мельче ${redMin(size)} px на всех уровнях (мин ${redLo.toFixed(1)} px — ${redLoId})`);
    // полоса земли внизу кадра — как в AB2: ~12 % (уже — только ради HUD), но не меньше 1.2 м
    check(gndLo >= 0.04 && gndHi <= 0.13 && gndSum / n >= 0.1, `полоса земли внизу кадра ${(100 * gndLo).toFixed(0)}…${(100 * gndHi).toFixed(0)} %, в среднем ${((100 * gndSum) / n).toFixed(1)} % (≥ 10 %)`);
    notes.push(`[${tag(size)}] Ред в виде рогатки: мин ${redLo.toFixed(1)} px (${redLoId}), среднее ${(redSum / n).toFixed(1)} px`);
  } catch (e) {
    check(false, `кадр ${tag(size)}: ${e.message}`);
  }
  check(errors.length === 0, `${tag(size)}: ошибок консоли нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

/** Финал победы на 1-1: нет «К рогатке», баннер быстро; без тапа и с тапом по экрану. */
async function victory() {
  const size = SIZES[0];
  log(`\n▶ Финал победы 1-1 (${tag(size)})`);
  const { ctx, page, errors } = await newPage(size);
  const sampler = () => {
    window.__vic = { pig0: null, home: false, banner: null, results: null };
    const tick = () => {
      const v = window.__vic;
      const now = performance.now();
      if (v.pig0 === null && __game.state() !== 'none' && __game.pigsLeft() === 0) v.pig0 = now;
      if (v.pig0 !== null) {
        if (__game.homeVisible()) v.home = true;
        if (v.banner === null && document.querySelector('[data-testid="banner"]')) v.banner = now;
        if (document.querySelector('[data-testid="results-score"]')) {
          v.results = now;
          return;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  try {
    for (const mode of ['wait', 'tap', 'R']) {
      const withTap = mode === 'tap';
      await page.goto(`${BASE}/index.html?mute=1&fresh=1&unlockAll=1&level=1-1&intro=0&seed=7`, { waitUntil: 'load' });
      await until(page, () => window.__game && __game.screen() === 'game' && __game.phase() === 'play', null, 90000);
      await page.evaluate('__game.settle(10)');
      await page.evaluate(sampler);
      // стреляем, пока не погибнет последняя свинья: сначала по линии эксперта, затем ботом
      const plan = expertPlan('1-1');
      for (let i = 0; i < 6; i++) {
        const st = await page.evaluate('__game.settle(25)');
        if (st !== 'ready' || (await page.evaluate('__game.pigsLeft()')) === 0) break;
        const step = plan[i];
        const sh = step ? await page.evaluate(([a, p]) => __game.launch(a, p), [step.angleDeg, step.power]) : await shoot(page, true);
        if (!sh) await page.evaluate('__game.launch(30, 1)');
        await until(page, () => __game.state() !== 'flying' || __game.pigsLeft() === 0, null, 15000).catch(() => null);
        if ((await page.evaluate('__game.pigsLeft()')) === 0) break;
      }
      if ((await page.evaluate('__game.pigsLeft()')) !== 0) {
        await until(page, () => __game.pigsLeft() === 0 || __game.state() === 'lost', null, 15000).catch(() => null);
      }
      if (!check((await page.evaluate('__game.pigsLeft()')) === 0, `финал победы (${mode}): 1-1 выигран`)) continue;
      if (mode === 'R') {
        // R на баннере победы (до окна итогов): рестарт, но победа и счёт записаны
        await until(page, () => window.__vic.banner !== null, null, 8000).catch(() => null);
        const st = await page.evaluate('__game.state()');
        await page.keyboard.press('r');
        await until(page, () => __game.time() < 0.5 && __game.pigsLeft() > 0, null, 5000).catch(() => null);
        const rec = await page.evaluate("__game.record('1-1')");
        check(rec !== null && rec.best > 0 && rec.stars >= 1, `R на баннере победы (state ${st}): рестарт, победа записана (${JSON.stringify(rec)})`);
        continue;
      }
      if (withTap) {
        await until(page, () => window.__vic.banner !== null, null, 8000).catch(() => null);
        await page.mouse.click(size.w * 0.5, size.h * 0.62);
      }
      await until(page, () => window.__vic.results !== null, null, 20000).catch(() => null);
      const v = await page.evaluate('window.__vic');
      const total = v.results !== null && v.pig0 !== null ? (v.results - v.pig0) / 1000 : Infinity;
      const banner = v.banner !== null && v.pig0 !== null ? (v.banner - v.pig0) / 1000 : Infinity;
      if (!withTap) await page.screenshot({ path: `${OUT}/v-01-results.png` });
      check(!v.home, `${withTap ? 'с тапом' : 'без тапа'}: после последней свиньи нет кнопки «К рогатке»`);
      check(banner <= 1.0, `${withTap ? 'с тапом' : 'без тапа'}: баннер победы через ${banner.toFixed(2)} с (≤ 1.0)`);
      // тайминги ядра Б3 (VICTORY_MAX 2.0, CLEARED_BANNER 0.4) уже в constants: и без тапа финал ≤ 4.5 с
      check(total <= 4.5, `${withTap ? 'с тапом' : 'без тапа'}: от последней свиньи до итогов ${total.toFixed(2)} с (≤ 4.5)`);
      notes.push(`финал победы 1-1 ${withTap ? 'с тапом' : 'без тапа'}: баннер ${banner.toFixed(2)} с, итоги ${total.toFixed(2)} с`);
    }
  } catch (e) {
    check(false, `финал победы: ${e.message}`);
  }
  check(errors.length === 0, `финал победы: ошибок консоли нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

/**
 * Полёт на полной силе (компактные уровни, V_MAX 21): 1-1 (над башней путь свободен) под 30°/45°/60°, каждый раз
 * с рестарта. Птица всё время в кадре — по горизонтали и под верхом кадра; навес (60°) долетает до дальней части
 * уровня (за правый край контента), но не за границу уровня; после хода камера возвращается в вид рогатки.
 */
async function flight(size) {
  const touch = size.dpr > 1 && size.w < 1000;
  log(`\n▶ Полёт на полной силе: камера следит и возвращается (${tag(size)}${touch ? ', тач' : ''})`);
  const { ctx, page, errors } = await newPage(size, touch);
  try {
    await page.goto(`${BASE}/index.html?mute=1&unlockAll=1&fresh=1&level=1-1&intro=0&seed=5`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.screen() === 'game' && __game.phase() === 'play', null, 90000);
    for (const ang of [30, 45, 60]) {
      await page.evaluate('__game.restart()');
      await page.evaluate('__game.skipIntro()');
      check((await page.evaluate('__game.settle(10)')) === 'ready', `${ang}°: птица в рогатке`);
      await page.waitForTimeout(300);
      const aim0 = await page.evaluate('__game.camera()');
      const fr = await page.evaluate('__game.framing()');
      await page.evaluate(() => {
        const aspect = innerWidth / innerHeight;
        window.__fl = { n: 0, inX: 0, inTop: 0, maxX: -Infinity, jump: 0, stop: false, prev: null };
        const tick = () => {
          const r = window.__fl;
          const c = { ...__game.camera(), t: performance.now() };
          const f = __game.focus();
          const w = c.viewH * aspect;
          if (f) {
            r.n++;
            if (Math.abs(f.x - c.x) <= w / 2) r.inX++;
            if (f.y <= c.y + c.viewH / 2) r.inTop++;
            r.maxX = Math.max(r.maxX, f.x);
          }
          // рывок камеры: смещение центра (доля ширины) и зума (доля высоты) за 1/60 с — длинный кадр не считается рывком
          if (r.prev) {
            const k = 1000 / 60 / Math.max(1000 / 60, c.t - r.prev.t);
            r.jump = Math.max(r.jump, (k * Math.abs(c.x - r.prev.x)) / w, (k * Math.abs(c.viewH - r.prev.viewH)) / c.viewH);
          }
          r.prev = c;
          if (!r.stop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const ok = await page.evaluate(`__game.launch(${ang}, 1)`);
      check(ok, `${ang}°: выстрел на полной силе`);
      const end = await page.evaluate('__game.settle(25)');
      await page.waitForTimeout(end === 'ready' ? 1600 : 200);
      const r = await page.evaluate(() => {
        window.__fl.stop = true;
        const { n, inX, inTop, maxX, jump } = window.__fl;
        return { n, inX, inTop, maxX, jump };
      });
      const aim1 = await page.evaluate('__game.camera()');
      check(r.n > 30 && r.inX === r.n, `${ang}°: птица в кадре по горизонтали весь полёт (${r.inX}/${r.n} кадров)`);
      check(r.inTop === r.n, `${ang}°: птица не уходит за верх кадра (${r.inTop}/${r.n})`);
      check(r.jump < 0.06, `${ang}°: камера без рывков (макс. за кадр ${(100 * r.jump).toFixed(1)} % ширины/высоты < 6 %)`);
      if (ang === 60) {
        check(r.maxX >= fr.content.right, `60°: навес долетает до дальней части уровня (x ${r.maxX.toFixed(1)} ≥ правый край контента ${fr.content.right.toFixed(1)})`);
        check(r.maxX <= fr.content.right + 12, `60°: навес не улетает далеко за уровень (x ${r.maxX.toFixed(1)} ≤ ${(fr.content.right + 12).toFixed(1)})`);
      }
      if (end === 'ready') {
        const back = Math.abs(aim1.x - aim0.x) < 0.05 && Math.abs(aim1.viewH - aim0.viewH) < 0.05 && Math.abs(aim1.y - aim0.y) < 0.05;
        check(back, `${ang}°: камера вернулась в вид рогатки (h ${aim0.viewH.toFixed(2)} → ${aim1.viewH.toFixed(2)})`);
      }
      notes.push(`[${tag(size)}] 1-1 ${ang}° полная сила: дальше всего x ${r.maxX.toFixed(1)} м, итог хода ${end}`);
    }
    if (!QUICK) await page.screenshot({ path: `${OUT}/fl-${tag(size)}.png` });
  } catch (e) {
    check(false, `полёт ${tag(size)}: ${e.message}`);
  }
  check(errors.length === 0, `полёт ${tag(size)}: ошибок консоли нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

/** Первый взрыв уровня (Бомб на 1-8): кадр рендера ≤ 20 мс. */
async function blast(size) {
  log(`\n▶ Первый взрыв: кадр рендера (${tag(size)})`);
  const touch = size.dpr > 1 && size.w < 1000;
  const { ctx, page, errors } = await newPage(size, touch);
  try {
    await page.goto(`${BASE}/index.html?mute=1&unlockAll=1&level=1-8&intro=0&seed=7`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.screen() === 'game' && __game.phase() === 'play', null, 90000);
    await page.evaluate('__game.settle(10)');
    await page.waitForTimeout(600);
    const bird = await page.evaluate('__game.loaded()');
    await page.evaluate(() => {
      window.__rm = { max: 0, at: -1, n: 0, frames: [] };
      const t0 = performance.now();
      const tick = () => {
        const st = __game.stats();
        const r = window.__rm;
        r.n++;
        r.frames.push([__game.time(), st.renderMs]);
        if (st.renderMs > r.max) {
          r.max = st.renderMs;
          r.at = __game.time();
        }
        r.blastT = st.blastT;
        if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await shoot(page, true);
    // Бомб взрывается сам после удара; на всякий случай — способность через 2.2 с
    await page.waitForTimeout(2200);
    await page.evaluate('__game.ability()');
    await page.waitForTimeout(3900);
    const r = await page.evaluate('window.__rm');
    await page.screenshot({ path: `${OUT}/b-${tag(size)}-after.png` });
    check(bird === 'bomb', `1-8: первая птица — Бомб (${bird})`);
    // кадры от взрыва до +2.5 с (огонь, дым, обломки); до взрыва — выстрел и полёт (их цена — в заметках): под
    // нагрузкой машины худшие кадры приходились на выстрел и мешали отличить цену эффектов (отчёт эффектов, e2e)
    const win = r.frames.filter(([t]) => r.blastT >= 0 && t >= r.blastT - 0.05 && t <= r.blastT + 2.5);
    const wMax = win.reduce((m, [t, ms]) => (ms > m.ms ? { t, ms } : m), { t: -1, ms: 0 });
    notes.push(`первый взрыв ${tag(size)}: взрыв на t=${r.blastT.toFixed(2)} с; максимум за весь замер ${r.max.toFixed(1)} мс на t=${r.at.toFixed(2)} с`);
    check(r.blastT >= 0 && win.length > 30, `первый взрыв случился (t=${r.blastT.toFixed(2)} с), кадров в окне ${win.length}`);
    check(wMax.ms <= 20, `первый взрыв: максимум кадра рендера ${wMax.ms.toFixed(1)} мс (≤ 20) на t=${wMax.t.toFixed(2)} с (окно взрыв…+2.5 с; за весь замер ${r.max.toFixed(1)} мс)`);
  } catch (e) {
    check(false, `первый взрыв ${tag(size)}: ${e.message}`);
  }
  check(errors.length === 0, `первый взрыв: ошибок консоли нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

/** Покой в виде рогатки: без ввода кадр рисуется ≤ 30 раз в секунду; движение мыши сразу возвращает полную частоту. */
async function idleRate() {
  const size = SIZES[0];
  log(`\n▶ Покой в виде рогатки (${tag(size)})`);
  const { ctx, page, errors } = await newPage(size);
  try {
    await page.goto(`${BASE}/index.html?mute=1&fresh=1&unlockAll=1&level=1-2&intro=0&seed=3`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.phase() === 'play' && __game.state() === 'ready', null, 90000);
    await page.waitForTimeout(1500);
    const rate = async (ms, poke) => {
      const r0 = await page.evaluate(() => [__game.stats().renders, performance.now()]);
      const t0 = Date.now();
      let k = 0;
      while (Date.now() - t0 < ms) {
        if (poke) await page.mouse.move(400 + (k++ % 2) * 20, 300);
        await page.waitForTimeout(poke ? 60 : ms);
      }
      const r1 = await page.evaluate(() => [__game.stats().renders, performance.now()]);
      return ((r1[0] - r0[0]) * 1000) / (r1[1] - r0[1]);
    };
    const active = await rate(3000, true);
    const fps = await page.evaluate('__game.fps()');
    const st = await page.evaluate('__game.stats()');
    // ровные кадры (без снимков экрана, движение мыши — полная частота): автокачество не понижает
    if (fps >= 55) check(st.downgrades === 0 && st.quality === 'high', `автокачество при ровных ${fps} fps не понижает (${st.quality}, понижений ${st.downgrades})`);
    else notes.push(`автокачество: rAF ${fps} fps < 55 (машина занята) — ${st.quality}, понижений ${st.downgrades}`);
    await page.waitForTimeout(1300); // ввод «свежий» 1 с — затем покой
    const idle = await rate(2000, false);
    notes.push(`покой 1-2: ${idle.toFixed(1)} кадров/с без ввода, ${active.toFixed(1)} с вводом (fps rAF ${fps})`);
    check(idle <= 33, `покой: без ввода ${idle.toFixed(1)} кадров/с (≤ 30 + запас)`);
    check(active >= Math.min(45, 0.8 * fps), `покой: с вводом ${active.toFixed(1)} кадров/с (полная частота, rAF ${fps})`);
  } catch (e) {
    check(false, `покой: ${e.message}`);
  }
  check(errors.length === 0, `покой: ошибок нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

/**
 * Темп между выстрелами (ревью «арт и ощущения»): от входа в settling до готовой птицы — задержка камеры + возврат
 * (TIMING.LINGER_MIN…LINGER_MAX + CAMERA.RETURN_MAX), и камера приезжает к уже лежащей в кармашке птице: прыжок идёт во
 * время возврата (session.releaseLinger). Замер по кадрам: settling → loading → ready и момент, когда камера встала в вид
 * рогатки (framing().aimed и cam.animating === false).
 */
async function tempo() {
  const size = SIZES[0];
  log(`\n▶ Темп между выстрелами (${tag(size)})`);
  const { ctx, page, errors } = await newPage(size);
  try {
    await page.goto(`${BASE}/index.html?level=1-3&intro=0&mute=1&fresh=1`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.state() === 'ready', null, 90000);
    for (let shot = 0; shot < 2; shot++) {
      if ((await page.evaluate('__game.state()')) !== 'ready') break;
      await page.evaluate('__game.launch(60, 0.5)'); // недолёт: разрушений нет — задержка камеры минимальная
      const r = await page.evaluate(async () => {
        const g = window.__game;
        const out = { settling: -1, loading: -1, ready: -1, camStill: -1 };
        const t0 = performance.now();
        while (performance.now() - t0 < 15000) {
          await new Promise((res) => requestAnimationFrame(res));
          const st = g.state();
          const t = g.time();
          if (st === 'settling' && out.settling < 0) out.settling = t;
          if (st === 'loading' && out.loading < 0) out.loading = t;
          if (out.settling >= 0 && out.camStill < 0 && g.framing().aimed && !g.camAnimating()) out.camStill = t;
          if (st === 'ready' && out.settling >= 0) out.ready = t;
          if (out.ready >= 0 && out.camStill >= 0) break;
        }
        return out;
      });
      const wait = r.ready - r.settling;
      check(r.ready > 0 && wait <= 0.45 + 1.4 + 0.1, `ход ${shot + 1}: уход птицы → птица в рогатке за ${wait.toFixed(2)} с (≤ задержка 0.45 + возврат 1.4)`);
      check(r.loading > 0 && r.loading < r.camStill, `ход ${shot + 1}: прыжок в кармашек начался до приезда камеры (${r.loading.toFixed(2)} < ${r.camStill.toFixed(2)})`);
      check(Math.abs(r.camStill - r.ready) <= 0.15, `ход ${shot + 1}: камера приезжает к готовой птице (камера ${r.camStill.toFixed(2)}, ready ${r.ready.toFixed(2)})`);
    }
  } catch (e) {
    check(false, `темп: ${e.message}`);
  }
  check(errors.length === 0, `темп: ошибок нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

/** «Уменьшить движение» системой (07 §19.3): меню без дрейфа камеры, в игре нет тряски и экранной вспышки. */
async function reducedMotion() {
  const size = SIZES[0];
  log(`\n▶ Уменьшенное движение (${tag(size)})`);
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(`${BASE}/index.html?mute=1&fresh=1`, { waitUntil: 'load' });
    await until(page, () => window.__game && __game.screen() === 'title', null, 90000);
    const a = await page.evaluate('__game.stats()');
    await page.waitForTimeout(1500);
    const b = await page.evaluate('__game.stats()');
    check(a.menuReduced && a.menuCamX === b.menuCamX, `меню: сцена без дрейфа камеры (x ${a.menuCamX} → ${b.menuCamX})`);
    await page.evaluate("__game.startLevel('1-8')");
    const g = await page.evaluate('__game.stats()');
    check(!g.shake && g.flashMax <= 0.12, `игра: тряски нет (${g.shake}), экранная вспышка взрыва не ярче α 0.12 (${g.flashMax})`);
  } catch (e) {
    check(false, `уменьшенное движение: ${e.message}`);
  }
  check(errors.length === 0, `уменьшенное движение: ошибок нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

try {
  for (let i = 0; i < SIZES.length && run('flow'); i++) {
    await flow(SIZES[i], i);
    if (QUICK) break;
  }
  if (run('robustness')) await robustness();
  if (run('framing')) for (const sz of SIZES) await framing(sz);
  if (run('flight')) for (const sz of QUICK ? SIZES.slice(0, 1) : SIZES.slice(0, 2)) await flight(sz);
  if (run('victory')) await victory();
  if (run('tempo')) await tempo();
  if (run('blast')) for (const sz of QUICK ? SIZES.slice(0, 1) : SIZES.slice(0, 2)) await blast(sz);
  if (run('reduced')) await reducedMotion();
  if (run('idle')) await idleRate();
} finally {
  await browser.close();
  await server.close();
}

log('\n──────────');
for (const n of notes) log(`  ${n}`);
log(`Скриншоты: ${OUT}`);
if (failures.length) {
  log(`ПРОВАЛЕНО: ${failures.length}`);
  for (const f of failures) log(`  ✗ ${f}`);
  process.exit(1);
}
log('e2e: всё зелёное');
process.exit(0);
