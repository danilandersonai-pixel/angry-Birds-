#!/usr/bin/env node
// Объективная проверка звука: офлайн-рендер КАЖДОГО звука и музыки теми же функциями синтеза,
// что и в игре (через Chromium/Playwright и dev/preview-audio.html → window.__renderAll()),
// WAV на диск, замеры ffmpeg (ebur128 true-peak/LUFS, volumedetect), волновые формы и спектрограммы PNG,
// сводные листы по группам (ImageMagick montage) и таблица с флагами проблем.
//
// Использование:
//   node scripts/render-audio.mjs [--out DIR] [--only REGEX] [--no-images]
//   по умолчанию DIR = $AUDIO_OUT или <tmp>/ab-audio-render
// Результат: DIR/*.wav, DIR/png/*.png, DIR/sheets/<группа>.png, DIR/report.json, DIR/report.md.
// Код возврата 1 — если есть клиппинг (пик ≥ −1 dBFS), NaN/Inf или звук обрезан.
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const OUT = path.resolve(arg('--out', process.env.AUDIO_OUT ?? path.join(os.tmpdir(), 'ab-audio-render')));
const ONLY = arg('--only', undefined);
const IMAGES = !argv.includes('--no-images');
mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, 'png'), { recursive: true });
mkdirSync(path.join(OUT, 'sheets'), { recursive: true });

// ── 1. рендер в браузере ──
const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false },
  logLevel: 'error',
});
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/dev/preview-audio.html`;
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let game, raw;
const t0 = Date.now();
try {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}] ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__renderAll === 'function');
  game = await page.evaluate((only) => window.__renderAll({ chain: 'game', only }), ONLY);
  raw = await page.evaluate((only) => window.__renderAll({ chain: 'raw', wav: false, only }), ONLY);
  for (const s of game) {
    const b64 = await page.evaluate((n) => window.__wav(n), s.name);
    writeFileSync(path.join(OUT, `${s.name}.wav`), Buffer.from(b64, 'base64'));
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`[render] ${game.length} звуков за ${((Date.now() - t0) / 1000).toFixed(1)} с → ${OUT}`);

// ── 2. ffmpeg: true peak, LUFS, max/mean volume ──
function ffstats(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const e = r.stderr ?? '';
  const num = (re) => {
    const m = e.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    lufsI: num(/Summary:[\s\S]*?I:\s+(-?[\d.]+) LUFS/),
    truePeak: num(/Summary:[\s\S]*?Peak:\s+(-?[\d.]+) dBFS/),
    maxVol: num(/max_volume:\s+(-?[\d.]+) dB/),
    meanVol: num(/mean_volume:\s+(-?[\d.]+) dB/),
  };
}

const rawBy = new Map(raw.map((r) => [r.name, r]));
const rows = [];
for (const s of game) {
  const wav = path.join(OUT, `${s.name}.wav`);
  const ff = ffstats(wav);
  const r = rawBy.get(s.name);
  const flags = [];
  if (s.nonFinite > 0) flags.push('NaN');
  if ((ff.truePeak ?? s.peakDb) >= -1 || s.peakDb >= -1) flags.push('PEAK');
  if (s.tailDb > -60 && s.group !== 'music') flags.push('TAIL');
  if (s.firstAbs > 1e-4) flags.push('CLICK0');
  if (s.expectMs && (s.lenMs < s.expectMs * 0.7 || s.lenMs > s.expectMs * 1.4)) flags.push('LEN');
  if (s.group !== 'music' && s.mMaxLufs < -40) flags.push('QUIET');
  rows.push({ ...s, rawPeakDb: r?.peakDb ?? null, rawLenMs: r?.lenMs ?? null, ...ff, flags });
}

// ── 3. картинки: волна (пиковая огибающая) + спектрограмма, листы по группам ──
if (IMAGES) {
  const label = (s) => `${s.name}  ${s.lenMs.toFixed(0)}ms  pk ${s.peakDb.toFixed(1)}  M ${s.mMaxLufs.toFixed(1)}`;
  const isMusic = (s) => s.group === 'music';
  for (const s of rows) {
    const wav = path.join(OUT, `${s.name}.wav`);
    const w = isMusic(s) ? 2000 : 520;
    const wave = path.join(OUT, 'png', `${s.name}.wave.png`);
    const spec = path.join(OUT, 'png', `${s.name}.spec.png`);
    const tile = path.join(OUT, 'png', `${s.name}.png`);
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-filter_complex',
      `aformat=channel_layouts=mono,showwavespic=s=${w}x${isMusic(s) ? 260 : 110}:colors=0x46a3ff:filter=peak:draw=full`, '-frames:v', '1', wave]);
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', wav, '-lavfi',
      `showspectrumpic=s=${w}x${isMusic(s) ? 300 : 170}:legend=0:fscale=log:scale=log:color=magma:mode=combined`, '-frames:v', '1', spec]);
    execFileSync('convert', [wave, '-background', '#101820', '-flatten', spec, '-append',
      '-gravity', 'North', '-background', '#101820', '-fill', '#ffd21f', '-pointsize', '15', '-splice', '0x20', '-annotate', '+0+2', label(s), tile]);
  }
  const groups = [...new Set(rows.map((s) => s.group))];
  for (const g of groups) {
    const tiles = rows.filter((s) => s.group === g).map((s) => path.join(OUT, 'png', `${s.name}.png`));
    const cols = g === 'music' ? 1 : 4;
    for (let i = 0, part = 0; i < tiles.length; i += cols * 6, part++) {
      const out = path.join(OUT, 'sheets', `${g}${tiles.length > cols * 6 ? `-${part + 1}` : ''}.png`);
      execFileSync('montage', [...tiles.slice(i, i + cols * 6), '-tile', `${cols}x`, '-geometry', '+6+6', '-background', '#0a1018', out]);
    }
  }
  // Эталон осей спектрограммы (с легендой) — по одному звуку.
  const ref = rows.find((s) => s.name === 'iceShatter') ?? rows[0];
  if (ref && existsSync(path.join(OUT, `${ref.name}.wav`))) {
    execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(OUT, `${ref.name}.wav`), '-lavfi',
      'showspectrumpic=s=900x360:legend=1:fscale=log:scale=log:color=magma', '-frames:v', '1', path.join(OUT, 'sheets', '_legend.png')]);
  }
}

// ── 4. отчёт ──
const f1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1));
const lines = [
  '| звук | группа | пик сырой | пик игра | TP ffmpeg | M max LUFS | I LUFS | длина, мс (ожид.) | центроид, Гц | хвост dB | BPM | флаги |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((s) => `| ${s.name} | ${s.group} | ${f1(s.rawPeakDb)} | ${f1(s.peakDb)} | ${f1(s.truePeak)} | ${f1(s.mMaxLufs)} | ${f1(s.lufsI)} | ${s.lenMs.toFixed(0)}${s.expectMs ? ` (${s.expectMs})` : ''} | ${s.centroidHz.toFixed(0)} | ${f1(s.tailDb)} | ${s.bpm ? s.bpm.toFixed(1) : ''} | ${s.flags.join(' ')} |`),
];
writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
writeFileSync(path.join(OUT, 'report.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));

// Сводка по группам: разброс моментальной громкости (одинаковая «весомость»)
const byGroup = new Map();
for (const s of rows) {
  if (!byGroup.has(s.group)) byGroup.set(s.group, []);
  byGroup.get(s.group).push(s.mMaxLufs);
}
console.log('\nM max LUFS по группам (мин … медиана … макс):');
for (const [g, v] of byGroup) {
  const a = [...v].sort((x, y) => x - y);
  console.log(`  ${g.padEnd(10)} ${a[0].toFixed(1)} … ${a[Math.floor(a.length / 2)].toFixed(1)} … ${a[a.length - 1].toFixed(1)}  (n=${a.length})`);
}
const hard = rows.filter((s) => s.flags.some((f) => f === 'PEAK' || f === 'NaN' || f === 'TAIL'));
const soft = rows.filter((s) => s.flags.length > 0 && !hard.includes(s));
console.log(`\nпики игра: макс ${Math.max(...rows.map((s) => s.peakDb)).toFixed(2)} dBFS; TP макс ${Math.max(...rows.map((s) => s.truePeak ?? -99)).toFixed(2)} dBFS`);
console.log(`проблемы: жёсткие ${hard.length} [${hard.map((s) => `${s.name}:${s.flags.join('+')}`).join(', ')}]`);
console.log(`          мягкие ${soft.length} [${soft.map((s) => `${s.name}:${s.flags.join('+')}`).join(', ')}]`);
console.log(`отчёт: ${path.join(OUT, 'report.md')}; листы: ${path.join(OUT, 'sheets')}`);
process.exit(hard.length > 0 ? 1 : 0);
