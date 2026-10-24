#!/usr/bin/env node
// Скриншот страницы проекта через Chromium (Playwright) с собственным dev-сервером Vite.
//
// Использование:
//   node scripts/shot.mjs <путь-страницы> <out.png> [--w 1600] [--h 900] [--dpr 1]
//        [--wait 800] [--eval "js-код"] [--click "css-селектор"] [--frames N]
//
// Примеры:
//   node scripts/shot.mjs dev/preview-characters.html /tmp/x.png --w 1800 --h 1100
//   node scripts/shot.mjs index.html /tmp/menu.png --wait 2000
//   node scripts/shot.mjs "index.html?level=1-1" /tmp/l.png --eval "window.__game?.debugLaunch(45, 1)" --wait 3000
//
// Ошибки консоли и исключения страницы печатаются в stdout с префиксом [console]/[pageerror].
// Код возврата 2, если на странице были необработанные исключения.
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Playwright предустановлен глобально (виден через require/NODE_PATH, но не через ESM import).
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const pos = [];
  const opts = { w: 1600, h: 900, dpr: 1, wait: 800, evals: [], clicks: [], frames: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--w') opts.w = Number(argv[++i]);
    else if (a === '--h') opts.h = Number(argv[++i]);
    else if (a === '--dpr') opts.dpr = Number(argv[++i]);
    else if (a === '--wait') opts.wait = Number(argv[++i]);
    else if (a === '--eval') opts.evals.push(argv[++i]);
    else if (a === '--click') opts.clicks.push(argv[++i]);
    else if (a === '--frames') opts.frames = Number(argv[++i]);
    else pos.push(a);
  }
  return { pos, opts };
}

const { pos, opts } = parseArgs(process.argv.slice(2));
if (pos.length < 2) {
  console.error('usage: node scripts/shot.mjs <page> <out.png> [--w W --h H --dpr D --wait MS --eval JS --click SEL --frames N]');
  process.exit(1);
}
const [page, out] = pos;

const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false },
  logLevel: 'error',
});
await server.listen();
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/${page.replace(/^\//, '')}`;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let pageErrors = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: opts.w, height: opts.h }, deviceScaleFactor: opts.dpr });
  const p = await ctx.newPage();
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => {
    pageErrors++;
    console.log(`[pageerror] ${e.message}\n${e.stack ?? ''}`);
  });
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(opts.wait);
  for (const sel of opts.clicks) {
    await p.click(sel);
    await p.waitForTimeout(400);
  }
  for (const js of opts.evals) {
    const r = await p.evaluate(js);
    if (r !== undefined) console.log(`[eval] ${typeof r === 'string' ? r : JSON.stringify(r)}`);
    await p.waitForTimeout(opts.wait);
  }
  if (opts.frames > 0) {
    // Серия кадров: out.png -> out-0.png, out-1.png, ... с интервалом wait.
    for (let i = 0; i < opts.frames; i++) {
      const f = out.replace(/\.png$/, `-${i}.png`);
      await p.screenshot({ path: f });
      console.log(`[shot] ${f}`);
      await p.waitForTimeout(opts.wait);
    }
  } else {
    await p.screenshot({ path: out });
    console.log(`[shot] ${out}`);
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(pageErrors > 0 ? 2 : 0);
