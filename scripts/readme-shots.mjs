#!/usr/bin/env node
// Скриншоты для README (docs/screenshots/*.jpg): меню, выбор уровня, прицел, взрыв, победа (1600×900) и телефон
// (844×390@2). Играет по линиям эксперта из src/levels/calib.ts (seed 1), поэтому кадры воспроизводимы.
// Сначала собрать: npm run build (скрипт раздаёт dist/ своим статическим сервером).
//   node scripts/readme-shots.mjs [menu levels aim blast win mobile]  — все или выбранные кадры
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Playwright предустановлен глобально (виден через require/NODE_PATH, но не через ESM import).
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs/screenshots');
if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('нет dist/ — сначала npm run build');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, 'dist', u === '/' ? 'index.html' : u);
  if (!f.startsWith(path.join(ROOT, 'dist')) || !fs.existsSync(f)) {
    res.statusCode = 404;
    return res.end();
  }
  res.setHeader('content-type', types[path.extname(f)] ?? 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;

// линии эксперта из calib.ts
const calibSrc = fs.readFileSync(path.join(ROOT, 'src/levels/calib.ts'), 'utf8');
function plan(id) {
  const m = calibSrc.match(new RegExp(`'${id}': \\{[\\s\\S]*?plan: (\\[[^\\n]*\\]),`));
  // объектный литерал TS → JSON: ключи в кавычки
  return JSON.parse(m[1].replace(/(\w+):/g, '"$1":'));
}

const ALL_IDS = [];
for (let e = 1; e <= 3; e++) for (let l = 1; l <= 10; l++) ALL_IDS.push(`${e}-${l}`);
const BIRDS = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];
function save({ levels = {}, seenAll = true, settings = {} } = {}) {
  return JSON.stringify({
    schema: 1,
    updatedAt: Date.now(),
    levels,
    fails: {},
    seen: seenAll ? ['aimTutorial', ...ALL_IDS.map((i) => `hint:${i}`), ...BIRDS.map((b) => `ability:${b}`)] : [],
    settings: { sfx: true, music: true, levelMusic: true, motion: 'system', shake: 'auto', haptics: true, quality: 'high', aimAssist: 'off', ...settings },
  });
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function page(size, data) {
  const touch = size.dpr > 1 && size.w < 1000;
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: size.dpr, hasTouch: touch, isMobile: touch });
  if (data) await ctx.addInitScript((d) => localStorage.setItem('angrybirds.progress.v1', d), data);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.errs = errs;
  return { ctx, p };
}
const until = (p, fn, arg, timeout = 60000) => p.waitForFunction(fn, arg, { timeout, polling: 30 });
const BIG = { w: 1600, h: 900, dpr: 1 };
const PHONE = { w: 844, h: 390, dpr: 2 };

async function openLevel(p, id, extra = '') {
  await p.goto(`${BASE}/index.html?mute=1&level=${id}&intro=0&seed=1${extra}`, { waitUntil: 'load' });
  await until(p, () => window.__game && __game.screen() === 'game' && __game.phase() === 'play' && __game.state() === 'ready');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(700);
}

/** Выстрел по линии: запуск, способность через abilityAt с (время сессии). */
async function fire(p, s) {
  await p.evaluate(async (s) => {
    __game.launch(s.angleDeg, s.power);
    const t0 = __game.time();
    if (s.abilityAt != null) {
      while (__game.time() - t0 < s.abilityAt) await new Promise((r) => requestAnimationFrame(r));
      __game.ability();
    }
  }, s);
}

async function shot(p, name) {
  const f = path.join(OUT, `${name}.jpg`);
  await p.screenshot({ path: f, type: 'jpeg', quality: 86 });
  console.log(`${name}: ${path.relative(ROOT, f)} (${Math.round(fs.statSync(f).size / 1024)} КБ)${p.errs.length ? ` ОШИБКИ: ${p.errs.join('; ')}` : ''}`);
}

// 1. меню
if (want('menu')) {
  const { ctx, p } = await page(BIG, save({ seenAll: false }));
  await p.goto(`${BASE}/index.html?mute=1`, { waitUntil: 'load' });
  await until(p, () => window.__game && __game.screen() === 'title');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(3200);
  await shot(p, 'menu');
  await ctx.close();
}

// 2. выбор уровня: эпизод 1 частично пройден
if (want('levels')) {
  const levels = { '1-1': { best: 36420, stars: 3 }, '1-2': { best: 33910, stars: 3 }, '1-3': { best: 27350, stars: 2 }, '1-4': { best: 49830, stars: 3 }, '1-5': { best: 31200, stars: 1 }, '1-6': { best: 37660, stars: 2 } };
  const { ctx, p } = await page(BIG, save({ levels }));
  await p.goto(`${BASE}/index.html?mute=1`, { waitUntil: 'load' });
  await until(p, () => window.__game && __game.screen() === 'title');
  await p.waitForTimeout(1200);
  await p.click('[data-testid=btn-play]', { force: true });
  await until(p, () => __game.screen() === 'episodes');
  await p.waitForTimeout(900);
  await p.click('[data-testid=episode-card-1]', { force: true });
  await until(p, () => __game.screen() === 'levels');
  await p.waitForTimeout(1800);
  await shot(p, 'levels');
  await ctx.close();
}

// 3. прицел: оттянутая птица с подсказкой траектории
async function aim(size, id, name, pull = [150, 70], shotsBefore = 0) {
  const { ctx, p } = await page(size, save({ settings: { aimAssist: 'short' } }));
  await openLevel(p, id);
  const pl = plan(id);
  for (let i = 0; i < shotsBefore; i++) {
    await fire(p, pl[i]);
    await p.evaluate('__game.settle(20)');
    await p.waitForTimeout(1500);
  }
  const pk = await p.evaluate('__game.pocketScreen()');
  await p.mouse.move(pk.x, pk.y);
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) {
    await p.mouse.move(pk.x - (pull[0] * k) / 12, pk.y + (pull[1] * k) / 12);
    await p.waitForTimeout(16);
  }
  await p.waitForTimeout(600);
  await shot(p, name);
  await p.mouse.up();
  await ctx.close();
}
if (want('aim')) await aim(BIG, '2-1', 'aim', [150, 60]);

// 4. разрушение и взрыв: цепочка TNT
async function blast(size, id, name, delayMs = 120, shotIdx = 0) {
  const { ctx, p } = await page(size, save());
  await openLevel(p, id);
  const pl = plan(id);
  for (let i = 0; i < shotIdx; i++) {
    await fire(p, pl[i]);
    await p.evaluate('__game.settle(20)');
    await p.waitForTimeout(1500);
  }
  await p.evaluate(() => {
    window.__bl = -1;
    const tick = () => {
      const st = __game.stats();
      if (st.blastT >= 0) {
        window.__bl = st.blastT;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await fire(p, pl[shotIdx]);
  await until(p, () => window.__bl >= 0, null, 15000);
  await p.waitForTimeout(delayMs);
  await shot(p, name);
  await ctx.close();
}
if (want('blast')) await blast(BIG, '2-9', 'blast', 150);

// 5. победа: линия эксперта, окно итогов после подсчёта
if (want('win')) {
  const { ctx, p } = await page(BIG, save());
  const id = '1-1';
  await openLevel(p, id);
  for (const s of plan(id)) {
    if ((await p.evaluate('__game.state()')) !== 'ready') break;
    await fire(p, s);
    await p.evaluate('__game.settle(20)');
  }
  await until(p, () => !!document.querySelector('[data-testid="results-score"]'), null, 30000);
  await p.waitForTimeout(3200);
  console.log('win: счёт', await p.evaluate('__game.score()'), 'звёзд', await p.evaluate('__game.stars()'));
  await shot(p, 'win');
  await ctx.close();
}

// 6. телефон: полёт над снежным уровнем
if (want('mobile')) {
  const { ctx, p } = await page(PHONE, save());
  const id = '3-1';
  await openLevel(p, id);
  const s = plan(id)[0];
  await p.evaluate((s) => __game.launch(s.angleDeg, s.power), s);
  await p.waitForTimeout(900);
  await shot(p, 'mobile');
  await ctx.close();
}

await browser.close();
srv.close();
