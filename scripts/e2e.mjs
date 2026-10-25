#!/usr/bin/env node
// e2e-смоук игры в Chromium (Playwright) с собственным dev-сервером Vite.
//
//   node scripts/e2e.mjs [--out DIR] [--quick] [--sizes 1600x900,844x390@2,1280x960]
//
// Что проверяется:
//  • загрузка без ошибок консоли и исключений → титул → эпизоды → уровни → 1-1 (настоящими нажатиями);
//  • пропуск облёта тапом, прицел и выстрел настоящим жестом мыши, затем выстрелы через хук до победы/поражения;
//  • экран результата (победа или поражение) — в трёх размерах: 1600×900, 844×390 (dpr 2, тач), 1280×960;
//  • visibilitychange во время полёта: пауза, время сессии стоит, после возврата нет «взрыва» (≤ 4 шагов за кадр);
//  • рестарт клавишей R в полёте: новая сессия, птица снова в рогатке;
//  • загрузка каждого из 30 уровней по очереди (startLevel + skipIntro + кадр) без ошибок;
//  • замер FPS на самом тяжёлом уровне (больше всего тел) с разрушением;
//  • плейтест №1: подсказка уровня не во время облёта, а после него; вид рогатки не мельче ~20 CSS px на Реда;
//    автокачество в покое не падает.
// Скриншоты ключевых моментов — в --out (по умолчанию scratchpad/integ/e2e). Код возврата ≠ 0 при ошибках.

import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const OUT = path.resolve(arg('out', '/tmp/claude-0/-home-user-angry-Birds-/81d8defb-a90b-51f5-bf79-c4a4250dbc6b/scratchpad/integ/e2e'));
const QUICK = argv.includes('--quick');
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

/** Подобрать выстрел (угол°, сила) в точку без учёта препятствий — дискретная модель planck. */
const SOLVE = `(tx, ty, lowFirst) => {
  const a0 = __game.anchor(); const bird = __game.loaded() || 'red';
  const K = { red: 1, blues: 1, chuck: 1, bomb: 0.95, matilda: 0.97, hal: 1, terence: 0.88, silver: 1 }[bird] || 1;
  const V = 24, R = 2, G = 15, h = 1 / 60;
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
    check(await page.evaluate(() => !!document.querySelector('[data-testid="hint"]')), 'после облёта — подсказка уровня');
    const red = await page.evaluate((h) => (0.9 * h) / __game.stats().aimViewH, size.h);
    check(red >= 20, `вид рогатки: Ред ${red.toFixed(0)} CSS px (≥ 20)`);
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
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${T}-08-banner.png` });
    await until(page, () => !!document.querySelector('[data-testid="results-score"]'), null, 15000).catch(() => null);
    await page.waitForTimeout(3600);
    const res = await page.evaluate(() => ({
      score: document.querySelector('[data-testid="results-score"]')?.textContent ?? null,
      next: !!document.querySelector('[data-testid="results-next"]'),
      restart: !!document.querySelector('[data-testid="results-restart"]'),
    }));
    check(res.score !== null, `экран результата (${end}), счёт: ${res.score}`);
    if (end === 'won') check(res.next, 'на победе есть «Дальше»');
    await page.screenshot({ path: `${OUT}/${T}-09-results.png` });
    if (end === 'won' && res.next) {
      await tap(page, '[data-testid="results-next"]');
      await until(page, () => __game.level() === '1-2' && __game.phase() !== 'loading', null, 30000).catch(() => null);
      check((await page.evaluate('__game.level()')) === '1-2', '«Дальше» открывает 1-2');
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/${T}-10-next.png` });
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
    // автокачество меряет CPU-время кадра (не интервал): в покое и на коротком разрушении не уходит в low
    check(stats.quality !== 'low', `автокачество не упало в low (${stats.quality})`);
    log(`  · самый «телесный» по замеру: ${heavy.id}`);
  } catch (e) {
    check(false, `надёжность: ${e.message}`);
    await page.screenshot({ path: `${OUT}/r-fail.png` }).catch(() => null);
  }
  check(errors.length === 0, `ошибок консоли нет${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
  await ctx.close();
}

try {
  for (let i = 0; i < SIZES.length; i++) {
    await flow(SIZES[i], i);
    if (QUICK) break;
  }
  await robustness();
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
