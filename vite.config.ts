import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Обычная сборка — в dist/ (для GitHub Pages).
// Режим "single" — всё (JS, CSS, шрифты) инлайнится в один index.html в dist-single/.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      assetsInlineLimit: single ? 100_000_000 : 4096,
      chunkSizeWarningLimit: 2000,
    },
    server: { host: true },
  };
});
