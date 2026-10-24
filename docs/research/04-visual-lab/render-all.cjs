// Прототип 04-visual. Запуск: cd docs/research/04-visual-lab && node render-all.cjs [фильтр имени png]
// Нужны Playwright (глобально, через NODE_PATH) и шрифты в корне репо: npm i -D @fontsource/rubik @fontsource/luckiest-guy
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const only = process.argv[2];
  const pages = [['sheet.html','sheet.png',1800,1500]].concat(['meadow','beach','snow','night'].map(t=>['scene.html?theme='+t,'scene-'+t+'.png',1600,900]))
    .concat([['scene.html?theme=meadow&viewH=38','scene-meadow-far.png',1600,900]]);
  for (const [u,o,w,h] of pages) {
    if (only && !o.includes(only)) continue;
    const p = await b.newPage({ viewport: { width: w, height: h } });
    p.on('pageerror', e => console.log('[pageerror]', u, e.message));
    await p.goto('file://' + process.cwd() + '/' + u);
    await p.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
    console.log(u, JSON.stringify(await p.evaluate(() => window.__timing)));
    await p.screenshot({ path: o });
    await p.close();
  }
  await b.close();
})();
