// Сценарии интерфейса в Chromium на странице предпросмотра dev/preview-ui.html:
// мышь, клавиатура, фокус, диалоги, сброс прогресса, победа/поражение, баннер, портрет, тач-цели, ошибки консоли.
// Запуск (не входит в vitest): node tests/ui/preview-flow.mjs [префикс-скриншотов]
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// Playwright предустановлен глобально (виден через require/NODE_PATH, но не через ESM import).
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = process.argv[2] ?? path.join(os.tmpdir(), 'ui-flow');

const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1', hmr: false }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch();
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) fails++;
};

async function page(q, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...opts });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => {
    fails++;
    console.log('[pageerror]', e.message);
  });
  p.on('console', (m) => {
    if (m.type() === 'error') {
      fails++;
      console.log('[console.error]', m.text());
    }
  });
  await p.goto(`http://127.0.0.1:${port}/dev/preview-ui.html?${q}`);
  await p.waitForTimeout(700);
  return p;
}
const scr = (p) => p.evaluate(() => window.__ui.screen);

try {
  // 1. Мышью: титул → эпизоды → уровни → игра → пауза → продолжить → рестарт → меню
  {
    const p = await page('screen=title');
    ok((await scr(p)) === 'title', 'старт на титуле');
    await p.click('[data-testid=btn-play]', { force: true });
    await p.waitForTimeout(600);
    ok((await scr(p)) === 'episodes', 'Играть → эпизоды');
    await p.click('[data-testid=episode-card-2]', { force: true });
    await p.waitForTimeout(400);
    ok((await scr(p)) === 'episodes', 'закрытый эпизод не открывается');
    ok(await p.locator('.toast').count() > 0, 'тост о требовании эпизода');
    await p.click('[data-testid=episode-card-1]', { force: true });
    await p.waitForTimeout(600);
    ok((await scr(p)) === 'levels', 'эпизод 1 → уровни');
    await p.click('[data-testid=level-tile-1-10]', { force: true });
    await p.waitForTimeout(300);
    ok((await scr(p)) === 'levels', 'закрытый уровень 1-10 не запускается');
    await p.click('[data-testid=level-tile-1-9]', { force: true });
    await p.waitForTimeout(1600);
    ok((await scr(p)) === 'game', 'плитка 1-9 → игра (через ирис)');
    ok(await p.locator('[data-testid=hud-pause]').isVisible(), 'HUD виден');
    ok(!(await p.locator('[data-testid=iris]').isVisible()), 'шторка раскрыта');
    await p.click('[data-testid=hud-pause]', { force: true });
    await p.waitForTimeout(400);
    ok(await p.locator('[data-testid=pause]').isVisible(), 'пауза открыта');
    await p.click('[data-testid=pause-resume]', { force: true });
    await p.waitForTimeout(500);
    ok((await p.locator('[data-testid=pause]').count()) === 0, 'пауза закрыта');
    await p.click('[data-testid=hud-restart]', { force: true });
    await p.waitForTimeout(700);
    ok((await scr(p)) === 'game' && !(await p.locator('[data-testid=iris]').isVisible()), 'рестарт: фейд закрылся и открылся');
    await p.click('[data-testid=hud-pause]', { force: true });
    await p.waitForTimeout(400);
    await p.click('[data-testid=pause-levels]', { force: true });
    await p.waitForTimeout(1500);
    ok((await scr(p)) === 'levels', 'пауза → Меню → уровни эпизода');
    await p.screenshot({ path: `${out}-1.png` });
    await p.close();
  }

  // 2. Клавиатурой: Enter/стрелки/Escape/P/R/M
  {
    const p = await page('screen=title');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(600);
    ok((await scr(p)) === 'episodes', 'Enter на «Играть» → эпизоды');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(600);
    ok((await scr(p)) === 'levels', 'Enter на эпизоде 1 → уровни');
    const focused = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    ok(focused === 'level-tile-1-9', `фокус на текущем уровне (${focused})`);
    await p.keyboard.press('ArrowUp');
    const f2 = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    ok(f2 === 'level-tile-1-4', `стрелка вверх → 1-4 (${f2})`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(600);
    ok((await scr(p)) === 'episodes', 'Esc → назад к эпизодам');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(600);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(1600);
    ok((await scr(p)) === 'game', 'Enter на плитке → игра');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    ok(await p.locator('[data-testid=pause]').isVisible(), 'Esc → пауза');
    const pf = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    ok(pf === 'pause-resume', `фокус на «Продолжить» (${pf})`);
    for (let i = 0; i < 8; i++) await p.keyboard.press('Tab');
    const inside = await p.evaluate(() => !!document.activeElement?.closest('[data-testid=pause]'));
    ok(inside, 'Tab не выходит из паузы');
    await p.keyboard.press('KeyP');
    await p.waitForTimeout(500);
    ok((await p.locator('[data-testid=pause]').count()) === 0, 'P → продолжить');
    const before = await p.evaluate(() => window.__progress.settings.music);
    await p.keyboard.press('KeyM');
    const after = await p.evaluate(() => window.__progress.settings.music);
    ok(before !== after, 'M переключает музыку');
    await p.close();
  }

  // 3. Настройки и сброс прогресса
  {
    const p = await page('screen=title');
    await p.click('[data-testid=btn-settings]', { force: true });
    await p.waitForTimeout(400);
    ok(await p.locator('[data-testid=settings]').isVisible(), 'настройки открыты');
    await p.click('[data-testid=set-music]', { force: true });
    ok((await p.evaluate(() => window.__progress.settings.music)) === false, 'свитч музыки пишет настройку');
    ok((await p.getAttribute('[data-testid=toggle-music]', 'aria-pressed')) === 'false', 'кнопка музыки на титуле синхронизирована');
    await p.click('[data-testid=set-motion] [data-v=reduce]', { force: true });
    ok((await p.evaluate(() => document.querySelector('.abui').dataset.motion)) === 'reduced', '«Уменьшить» включает reduced motion');
    await p.click('[data-testid=set-motion] [data-v=system]', { force: true });
    await p.focus('[data-testid=set-quality] [aria-checked=true]');
    await p.keyboard.press('ArrowRight');
    ok((await p.evaluate(() => window.__progress.settings.quality)) === 'high', 'стрелка в сегментах меняет качество');
    await p.click('[data-testid=set-reset]', { force: true });
    await p.waitForTimeout(400);
    ok(await p.locator('[data-testid=confirm]').isVisible(), 'подтверждение сброса');
    const cf = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    ok(cf === 'confirm-cancel', `фокус на «Отмена» (${cf})`);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    ok((await p.locator('[data-testid=confirm]').count()) === 0 && (await p.locator('[data-testid=settings]').isVisible()), 'Esc закрывает только подтверждение');
    await p.click('[data-testid=set-reset]', { force: true });
    await p.waitForTimeout(400);
    await p.click('[data-testid=confirm-ok]', { force: true });
    await p.waitForTimeout(600);
    ok((await p.evaluate(() => window.__progress.starsTotal())) === 0, 'прогресс сброшен');
    ok((await p.evaluate(() => window.__progress.settings.music)) === false, 'настройки после сброса сохранены');
    ok((await p.locator('.dlg').count()) === 0 && (await scr(p)) === 'title', 'после сброса — титул без диалогов');
    await p.keyboard.press('Escape');
    await p.close();
  }

  // 4. Победа: пропуск анимации, «Дальше» по N
  {
    const p = await page('screen=win3');
    await p.waitForTimeout(300);
    await p.keyboard.press('Space');
    await p.waitForTimeout(300);
    const score = await p.textContent('[data-testid=results-score]');
    ok(score?.replace(/\s/g, '') === '61230', `пропуск доводит счёт (${score})`);
    ok(await p.locator('[data-testid=new-best]').isVisible(), '«Новый рекорд!» виден');
    const stars = await p.locator('.res-star.is-set').count();
    ok(stars === 3, `3 звезды стоят (${stars})`);
    await p.keyboard.press('KeyN');
    await p.waitForTimeout(1500);
    const hud = await p.evaluate(() => document.querySelector('.hud-level .num')?.textContent);
    ok(hud === '1-4', `N → следующий уровень (${hud})`);
    await p.close();
  }

  // 5. Поражение: R — заново; совет после 3 поражений
  {
    const p = await page('screen=lose3');
    ok(await p.locator('[data-testid=lose-tip]').isVisible(), 'совет после 3 поражений');
    await p.keyboard.press('KeyR');
    await p.waitForTimeout(700);
    ok((await p.locator('[data-testid=results-lost]').count()) === 0 && (await scr(p)) === 'game', 'R на поражении → заново');
    await p.close();
  }

  // 6. Баннер: тап → onSkip; кнопка «К рогатке»
  {
    const p = await page('screen=banner');
    const logs = [];
    p.on('console', (m) => logs.push(m.text()));
    await p.click('[data-testid=banner] .ribbon', { force: true });
    await p.waitForTimeout(300);
    ok(logs.some((l) => l.includes('[app] skip')), 'тап по баннеру → onSkip');
    await p.close();
    const q = await page('screen=home');
    const logs2 = [];
    q.on('console', (m) => logs2.push(m.text()));
    await q.click('[data-testid=hud-home]', { force: true });
    await q.waitForTimeout(300);
    ok(logs2.some((l) => l.includes('[app] camera home')), '«К рогатке» → onCameraHome');
    await q.close();
  }

  // 7. Системный reduced motion и портрет на телефоне
  {
    const p = await page('screen=title', { reducedMotion: 'reduce' });
    ok((await p.evaluate(() => document.querySelector('.abui').dataset.motion)) === 'reduced', 'prefers-reduced-motion учитывается');
    await p.close();
    const q = await page('screen=title', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    ok(await q.locator('[data-testid=rotate-overlay]').isVisible(), 'портрет → «Поверните устройство»');
    await q.click('[data-testid=rotate-anyway]', { force: true });
    await q.waitForTimeout(300);
    ok(!(await q.locator('[data-testid=rotate-overlay]').isVisible()), '«Играть так» убирает оверлей');
    ok(await q.evaluate(() => window.__ui.letterbox), 'включён летербокс');
    await q.screenshot({ path: `${out}-letterbox.png` });
    await q.close();
  }

  // 8. Размеры тач-целей ≥ 44 px на телефоне
  {
    const p = await page('screen=pause', { viewport: { width: 640, height: 360 }, hasTouch: true, isMobile: true });
    const small = await p.evaluate(() =>
      [...document.querySelectorAll('.abui button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => ({ id: b.dataset.testid || b.className, r: b.getBoundingClientRect() }))
        .filter((x) => x.r.width < 43.5 || x.r.height < 43.5)
        .map((x) => `${x.id} ${Math.round(x.r.width)}×${Math.round(x.r.height)}`),
    );
    ok(small.length === 0, `все кнопки ≥ 44 px (${small.join(', ')})`);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
    ok(!overflow, 'нет прокрутки страницы на 640×360');
    await p.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(fails ? `\n${fails} проблем(ы)` : '\nвсё прошло');
process.exit(fails ? 1 : 0);
