import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Single-сборка: инлайновый модуль (~1 МБ) переносится в конец <body>. Иначе он стоит в <head>, и браузер не рисует
 * статический сплэш #boot, пока не скачает весь скрипт (FCP на Fast 3G 6.1 с → 0.9 с).
 */
function scriptToBodyEnd(): Plugin {
  return {
    name: 'script-to-body-end',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const re = /<script type="module"[^>]*>[\s\S]*?<\/script>\s*/g;
        const tags = html.match(re);
        if (!tags) return html;
        // замена функцией: в минифицированном коде бывают «$&», «$'» — строковая замена их бы раскрыла
        const body = `${tags.map((t) => t.trim()).join('\n')}\n</body>`;
        return html.replace(re, '').replace('</body>', () => body);
      },
    },
  };
}

// Обычная сборка — в dist/ (для GitHub Pages).
// Режим "single" — всё (JS, CSS, шрифты) инлайнится в один index.html в dist-single/.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile(), scriptToBodyEnd()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      assetsInlineLimit: single ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 2000,
    },
    server: { host: true },
  };
});
