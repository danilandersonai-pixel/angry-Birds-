// Сценарии интерфейса в Chromium на странице предпросмотра dev/preview-ui.html:
// мышь, клавиатура, фокус, диалоги, сброс прогресса, победа/поражение, баннер, портрет, тач-цели, ошибки консоли;
// вписывание панелей в окно на телефонах (по getBoundingClientRect), текст лент, минимальный кегль результатов,
// «мёртвый тап» на победе, сквозные касания HUD/подсказки, наложение вложенных диалогов, летербокс.
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

  // 9. Всё помещается в окно (getBoundingClientRect, а не scrollWidth — слои фиксированные), текст лент — в теле ленты,
  //    панели результатов на телефоне не ужаты (подписи ≥ 14 px)
  {
    const sizes = [
      { width: 640, height: 360, touch: true },
      { width: 667, height: 375, touch: true },
      { width: 800, height: 360, touch: true },
      { width: 844, height: 390, touch: true },
      { width: 1024, height: 768, touch: false },
    ];
    const screens = ['lose3&static=1', 'winmsg&static=1', 'win3&static=1', 'settings', 'pause', 'home', 'banner'];
    for (const sz of sizes) {
      for (const s of screens) {
        const p = await page(`screen=${s}`, { viewport: { width: sz.width, height: sz.height }, hasTouch: sz.touch, isMobile: sz.touch });
        await p.waitForTimeout(500);
        const r = await p.evaluate(() => {
          const vw = innerWidth;
          const vh = innerHeight;
          const bad = [];
          const sel = ['.res', '.res .ribbon', '.res-panel', '.res-btns .btn', '.dlg-panel', '.pause-side', '.pause-card', '.hud-left > *', '.hud-right > *', '.banner .ribbon'];
          for (const q of sel)
            for (const el of document.querySelectorAll(q)) {
              const b = el.getBoundingClientRect();
              if (b.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
              if (b.left < -0.5 || b.top < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5)
                bad.push(`${q} [${b.left.toFixed(0)},${b.top.toFixed(0)}–${b.right.toFixed(0)},${b.bottom.toFixed(0)}]`);
            }
          // текст ленты не шире её тела (624 из 760) за вычетом отступов
          for (const rib of document.querySelectorAll('.ribbon')) {
            const t = rib.querySelector('.ribbon-text');
            const rb = rib.getBoundingClientRect();
            const tb = t.getBoundingClientRect();
            const body = (rb.width * 624) / 760;
            if (tb.width > body * 0.9 + 0.5) bad.push(`лента «${t.textContent}»: текст ${tb.width.toFixed(0)} > ${(body * 0.9).toFixed(0)}`);
          }
          // на результатах подписи не мельче 14 px (с учётом ужатия панели)
          const small = [];
          for (const el of document.querySelectorAll('.res-panel *')) {
            if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
            const b = el.getBoundingClientRect();
            if (b.width === 0 || el.offsetWidth === 0) continue;
            const fs = parseFloat(getComputedStyle(el).fontSize) * Math.min(1, b.width / el.offsetWidth);
            if (fs < 13.8) small.push(`${el.className} ${fs.toFixed(1)}px`);
          }
          return { bad, small };
        });
        const tag = `${s.replace(/&.*/, '')} ${sz.width}×${sz.height}`;
        ok(r.bad.length === 0, `помещается: ${tag}${r.bad.length ? ` (${r.bad.join('; ')})` : ''}`);
        ok(r.small.length === 0, `подписи ≥ 14 px: ${tag}${r.small.length ? ` (${r.small.join('; ')})` : ''}`);
        await p.close();
      }
    }
  }

  // 10. Кнопки победы во время анимации: первое нажатие доводит анимацию и сразу выполняет действие (07 §12.3)
  {
    const p = await page('screen=win3');
    await p.waitForTimeout(1500); // кнопки уже активны (≈ 1.7 с от показа), счёт ещё бежит
    const running = await p.evaluate(() => document.querySelector('[data-testid=results-next]')?.getAttribute('aria-disabled') !== 'true');
    ok(running, 'кнопки победы активны до конца подсчёта');
    await p.click('[data-testid=results-next]');
    await p.waitForTimeout(1500);
    const hud = await p.evaluate(() => document.querySelector('.hud-level .num')?.textContent);
    ok(hud === '1-4', `«Дальше» во время подсчёта сразу ведёт на следующий уровень (${hud})`);
    await p.close();
  }

  // 11. Касания игры: подсказка и правая часть HUD не перехватывают тап (способность в полёте)
  {
    const p = await page('screen=game');
    const hit = await p.evaluate(() => {
      const at = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return 'нет элемента';
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return top?.id === 'scene' ? 'canvas' : top?.className || top?.tagName;
      };
      return { hint: at('[data-testid=hint]'), score: at('[data-testid=hud-score]'), pigs: at('.hud-pigs') };
    });
    ok(hit.hint === 'canvas' && hit.score === 'canvas' && hit.pigs === 'canvas', `тап сквозь подсказку и счёт доходит до canvas (${JSON.stringify(hit)})`);
    await p.close();
  }

  // 12. Вложенные диалоги: крестик настроек не рисуется поверх подтверждения
  {
    const p = await page('screen=confirm');
    await p.waitForTimeout(400);
    const top = await p.evaluate(() => {
      const x = document.querySelector('[data-testid=settings] .dlg-close');
      if (!x) return 'нет крестика';
      const b = x.getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return el?.closest('.dlg-close') ? 'крестик сверху' : 'ok';
    });
    ok(top === 'ok', `подтверждение перекрывает крестик настроек (${top})`);
    await p.close();
  }

  // 13. «Играть так»: пауза и результаты — во всё окно, кнопки ≥ 44 px
  {
    const p = await page('screen=lose3&static=1', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await p.click('[data-testid=rotate-anyway]', { force: true });
    await p.waitForTimeout(500);
    const r = await p.evaluate(() =>
      [...document.querySelectorAll('.ov button')].map((b) => b.getBoundingClientRect()).filter((b) => b.width < 43.5 || b.height < 43.5).length,
    );
    ok(r === 0, `летербокс: кнопки поражения ≥ 44 px (мелких: ${r})`);
    await p.close();
  }

  // 14. Системная «Назад» (жест Android, 07 §1.2): в игре — пауза, повторно — выход к уровням
  {
    const p = await page('screen=game');
    await p.evaluate(() => history.back());
    await p.waitForTimeout(500);
    ok(await p.locator('[data-testid=pause]').isVisible(), '«Назад» в игре → пауза');
    await p.evaluate(() => history.back());
    await p.waitForTimeout(1800);
    ok((await scr(p)) === 'levels', `«Назад» на паузе → уровни (${await scr(p)})`);
    await p.close();
  }

  // 15. Плейтест №2, Б6: строка «Рекорд» — рекорд ДО победы; при первой победе её нет (итог не выдаётся заранее)
  {
    const p = await page('screen=winfirst');
    await p.waitForTimeout(300);
    const mid = await p.evaluate(() => document.querySelector('.res-best')?.textContent ?? null);
    ok(mid === '', `первая победа: строки «Рекорд» нет, пока крутится счёт («${mid}»)`);
    await p.close();
    const q = await page('screen=win&static=1');
    const best = await q.evaluate(() => document.querySelector('.res-best')?.textContent ?? '');
    ok(/50\s468/.test(best), `повтор без рекорда: «${best}» — прежний рекорд, а не текущий счёт`);
    await q.close();
  }

  // 16. Б7: дразнилка по исходу — «Почти получилось!» только при одной свинье и счёте больше 0
  {
    const taunts = async (q) => {
      const out = [];
      for (let i = 0; i < 4; i++) {
        const p = await page(q);
        out.push(await p.evaluate(() => document.querySelector('[data-testid=lose-taunt]')?.textContent ?? ''));
        await p.close();
      }
      return out;
    };
    const zero = await taunts('screen=lose&static=1&pigs=3&score=0');
    ok(zero.every((x) => x && x !== 'Почти получилось!'), `счёт 0, три свиньи: ${[...new Set(zero)].join(' / ')}`);
    const two = await taunts('screen=lose&static=1&pigs=2&score=15000');
    ok(two.every((x) => x && x !== 'Почти получилось!'), `две свиньи: ${[...new Set(two)].join(' / ')}`);
    const one = await taunts('screen=lose&static=1&pigs=1&score=23450');
    ok(one.every((x) => x === 'Почти получилось!' || x === 'Осталась всего одна свинья!'), `одна свинья: ${[...new Set(one)].join(' / ')}`);
  }

  // 17. UI.hudRect(): правый блок HUD по раскладке — для камеры; ширина не растёт со счётом (место под 5 цифр)
  {
    const p = await page('screen=home', { viewport: { width: 1600, height: 900 } });
    await p.waitForTimeout(800);
    const r = await p.evaluate(async () => {
      const ui = window.__ui;
      const a = ui.hudRect();
      const dom = document.querySelector('[data-testid=hud-right]').getBoundingClientRect();
      ui.updateHud({ score: 23450, best: 50468, birdsLeft: 2, pigsLeft: 2 });
      await new Promise((res) => setTimeout(res, 900));
      const b = ui.hudRect();
      return { a: a && [a.left, a.top, a.width, a.height], dom: [dom.left, dom.top, dom.width, dom.height], b: b && [b.left, b.top, b.width, b.height] };
    });
    ok(!!r.a && r.a.every((v, i) => Math.abs(v - r.dom[i]) < 1.5), `hudRect совпадает с .hud-right (${JSON.stringify(r.a)} ~ ${JSON.stringify(r.dom.map(Math.round))})`);
    ok(!!r.b && Math.abs(r.b[2] - r.a[2]) < 1.5 && Math.abs(r.b[3] - r.a[3]) < 1.5, `hudRect не меняется от счёта 0 → 23 450 (${r.a?.[2]}×${r.a?.[3]} → ${r.b?.[2]}×${r.b?.[3]})`);
    ok(r.a && r.a[0] + r.a[2] <= 1600 && r.a[1] >= 0 && r.a[1] + r.a[3] < 450, 'hudRect — в правом верхнем углу окна');
    // во время въезда HUD (transform-анимация) прямоугольник тот же — считается по раскладке
    const moving = await p.evaluate(() => {
      const el = document.querySelector('[data-testid=hud-right]');
      const a = el.animate([{ translate: '0 -60px' }, { translate: '0 0' }], { duration: 1000 });
      const r = window.__ui.hudRect();
      const dom = el.getBoundingClientRect();
      a.cancel();
      return { r: r.top, dom: dom.top };
    });
    ok(Math.abs(moving.r - r.a[1]) < 1.5 && moving.dom < moving.r - 10, `hudRect без transform-анимаций (top ${moving.r.toFixed(0)}, DOM ${moving.dom.toFixed(0)})`);
    await p.close();
    const t = await page('screen=title');
    ok((await t.evaluate(() => window.__ui.hudRect())) === null, 'hudRect вне игры — null');
    await t.close();
  }

  // 18. Б9: хвостик подсказки — только к точке (рогатка): тянется вниз-влево; без точки хвоста нет
  {
    const p = await page('screen=game', { viewport: { width: 1600, height: 900 } });
    const g = await p.evaluate(() => {
      const box = document.querySelector('.hint-box').getBoundingClientRect();
      const tail = document.querySelector('.hint-tail polyline');
      if (!tail) return null;
      const pts = tail.getAttribute('points').split(' ').map((q) => q.split(',').map(Number));
      return { tip: pts[1], base: (pts[0][0] + pts[2][0]) / 2, box: [box.width, box.height] };
    });
    ok(!!g && g.tip[1] > g.box[1] && g.tip[0] < g.base - 1, `хвостик к рогатке: кончик ниже облачка и левее середины основания (${JSON.stringify(g)})`);
    await p.close();
    const q = await page('screen=game&tail=0');
    ok((await q.locator('.hint-tail').count()) === 0 && (await q.locator('[data-testid=hint]').count()) === 1, 'без точки — облачко без хвостика');
    await q.close();
  }

  // 19. Б8: пауза, которую открыл оверлей «Поверните устройство», снимается сама («Играть так» или поворот обратно);
  //     пауза игрока остаётся
  {
    const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
    const p = await page('screen=game', phone);
    ok(await p.locator('[data-testid=pause]').isVisible(), 'портрет в игре → пауза под оверлеем');
    await p.click('[data-testid=rotate-anyway]', { force: true });
    await p.waitForTimeout(700);
    ok((await p.locator('[data-testid=pause]').count()) === 0, '«Играть так» → автопауза снята, игра идёт');
    await p.close();
    const q = await page('screen=game', phone);
    await q.setViewportSize({ width: 844, height: 390 });
    await q.waitForTimeout(700);
    ok((await q.locator('[data-testid=pause]').count()) === 0, 'поворот в ландшафт → автопауза снята');
    await q.close();
    const r = await page('screen=game', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await r.click('[data-testid=hud-pause]', { force: true });
    await r.waitForTimeout(400);
    await r.setViewportSize({ width: 390, height: 844 });
    await r.waitForTimeout(400);
    await r.setViewportSize({ width: 844, height: 390 });
    await r.waitForTimeout(700);
    ok(await r.locator('[data-testid=pause]').isVisible(), 'пауза игрока после поворота туда-обратно остаётся');
    await r.close();
  }

  // 20. Б10: на окне итогов не висят закончившиеся анимации (иначе «пульс» и «качание» не идут на композиторе)
  {
    const p = await page('screen=win3');
    await p.waitForTimeout(4200);
    const st = await p.evaluate(() => {
      const all = document.getAnimations();
      return { finished: all.filter((a) => a.playState === 'finished').length, running: all.filter((a) => a.playState === 'running').length };
    });
    ok(st.finished === 0 && st.running >= 3, `после подсчёта: закончившихся анимаций ${st.finished}, идут ${st.running} (лучи, пульс, качание)`);
    await p.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(fails ? `\n${fails} проблем(ы)` : '\nвсё прошло');
process.exit(fails ? 1 : 0);
