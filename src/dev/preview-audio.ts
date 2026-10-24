// Страница предпросмотра звука: кнопка на каждый звук каталога, сценарии через AudioEngine.handle(),
// музыка меню/уровня. Для объективной проверки — window.__renderAll(): офлайн-рендер каждого звука
// в OfflineAudioContext ТЕМИ ЖЕ функциями синтеза и через тот же граф шин (компрессор и т. д.),
// замеры (пик, RMS, длина, центроид, громкость LUFS, «хвост»), WAV в памяти → window.__wav(name) (base64).

import type { GameEvent } from '../core/events';
import type { ThemeId } from '../core/types';
import { AudioEngine } from '../audio/AudioEngine';
import { type SoundDef, type SoundGroup, SOUND_LIST, soundDef, trimGain } from '../audio/catalog';
import { type CompParams, createMixGraph } from '../audio/graph';
import { CAT_MIX } from '../audio/mix';
import { makeNoiseBank, makeTanhCurve, mulberry32 } from '../audio/noise';
import * as F from '../audio/sfx';
import { setSynthRandom } from '../audio/synth';
import { startTrack, type TrackId } from '../audio/tracks';

const engine = new AudioEngine();

// ───────────────────────────── офлайн-рендер и замеры ─────────────────────────────

interface RenderItem {
  name: string;
  group: string;
  label: string;
  dur: number;
  expectMs?: number;
  /** Строит звук в offline-контексте со старта t0 (через граф шин, если chain, иначе прямо в destination). */
  build(oc: OfflineAudioContext, chain: boolean, seed: number, t0: number): void;
}

/** Переопределение компрессора для экспериментов (__renderAll({comp})). */
let compOverride: Partial<CompParams> = {};
const graph = (oc: OfflineAudioContext) => createMixGraph(oc, oc.destination, compOverride);

export interface SoundStats {
  name: string;
  group: string;
  label: string;
  expectMs: number | null;
  durS: number;
  peakDb: number;
  rmsDb: number;
  lenMs: number;
  centroidHz: number;
  /** Максимальная моментальная громкость (K-взвешивание, окно 400 мс), LUFS. */
  mMaxLufs: number;
  /** Уровень последних 20 мс буфера, dBFS (звук не обрезан, если < −60). */
  tailDb: number;
  /** Модуль первого сэмпла (щелчок на старте, если > 0). */
  firstAbs: number;
  nonFinite: number;
  /** Для музыки — оценка темпа автокорреляцией огибающей, BPM. */
  bpm: number | null;
}

const SR = 48000;
const wavs = new Map<string, ArrayBuffer>();

function sfxItem(def: SoundDef, name = def.key.replace(/:/g, '_'), param = def.param ?? 0, label = def.label): RenderItem {
  const item: RenderItem = {
    name,
    group: def.group,
    label,
    dur: def.dur + (def.send ? 0.9 : 0.25),
    build(oc, chain, seed, t0) {
      const rnd = mulberry32(seed);
      setSynthRandom(rnd);
      const nb = makeNoiseBank(oc, 2, 4242);
      let out: AudioNode = oc.destination;
      if (chain) {
        const g = graph(oc);
        const inp = oc.createGain();
        inp.gain.value = CAT_MIX[def.cat].gain * trimGain(def);
        inp.connect(g.busFor(def.cat));
        if (def.send) {
          const sg = oc.createGain();
          sg.gain.value = def.send;
          inp.connect(sg).connect(g.send);
        }
        out = inp;
      }
      const s: F.S = { ctx: oc, out, nb, rnd, tanh: makeTanhCurve(3) };
      def.fn(s, t0, param);
    },
  };
  if (def.expectMs !== undefined) item.expectMs = def.expectMs;
  return item;
}

function trackItem(id: TrackId, theme: ThemeId, dur: number): RenderItem {
  return {
    name: `music_${id}${id === 'level' ? `_${theme}` : ''}_${dur}s`,
    group: 'music',
    label: id === 'menu' ? 'Полька меню' : `Эмбиент уровня (${theme})`,
    dur: dur + 1.5,
    build(oc, chain, seed, t0) {
      const rnd = mulberry32(seed);
      setSynthRandom(rnd);
      const nb = makeNoiseBank(oc, 2, 4242);
      if (chain) {
        const g = graph(oc);
        startTrack(oc, nb, g.music, g.amb, id, theme, { at: t0, fadeIn: 0.6, untilS: dur, rnd });
      } else {
        startTrack(oc, nb, oc.destination, oc.destination, id, theme, { at: t0, fadeIn: 0.6, untilS: dur, rnd });
      }
    },
  };
}

function ambItem(theme: ThemeId, dur: number): RenderItem {
  return {
    name: `amb_${theme}_${dur}s`,
    group: 'music',
    label: `Фон темы ${theme}`,
    dur: dur + 3,
    build(oc, chain, seed, t0) {
      const rnd = mulberry32(seed);
      setSynthRandom(rnd);
      const nb = makeNoiseBank(oc, 2, 4242);
      let out: AudioNode = oc.destination;
      if (chain) out = graph(oc).amb;
      F.ambience({ ctx: oc, out, nb, rnd, tanh: makeTanhCurve(3) }, t0, theme, dur);
    },
  };
}

/** Полный список рендера: каждый звук каталога + варианты параметров + музыка 20 с + фоны тем. */
export function renderList(): RenderItem[] {
  const items: RenderItem[] = [];
  for (const d of SOUND_LIST) {
    if (d.key === 'slingStretch') {
      for (const p of [0, 0.5, 1]) items.push(sfxItem(d, `slingStretch_p${p}`, p, `${d.label} p=${p}`));
    } else if (d.key === 'bonus') {
      for (const i of [0, 2]) items.push(sfxItem(d, `bonus_${i}`, i, `${d.label} №${i + 1}`));
    } else if (d.key === 'tick') {
      for (const p of [0, 1]) items.push(sfxItem(d, `tick_p${p}`, p, `${d.label} p=${p}`));
    } else items.push(sfxItem(d));
  }
  items.push(trackItem('menu', 'meadow', 20), trackItem('level', 'meadow', 20), ambItem('beach', 8), ambItem('snow', 8));
  return items;
}

/** Длительность разогрева графа перед звуком (офлайн-рендер через шины), с. */
const WARM_S = 1.5;

/** Отрезать первые sec секунд буфера. */
function cut(b: AudioBuffer, sec: number): AudioBuffer {
  const off = Math.floor(sec * b.sampleRate);
  if (off <= 0) return b;
  const out = new AudioBuffer({ length: b.length - off, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) out.copyToChannel(b.getChannelData(c).subarray(off), c);
  return out;
}

function db(x: number): number {
  return 20 * Math.log10(Math.max(1e-9, x));
}

/** Биквад-фильтр по коэффициентам (для K-взвешивания). */
function biquad(x: Float32Array, b: readonly number[], a: readonly number[]): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const o = b[0]! * v + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o;
    y[i] = o;
  }
  return y;
}

/** Максимальная моментальная громкость по ITU-R BS.1770 (48 кГц, окно 400 мс, шаг 100 мс), LUFS. */
function momentaryMax(chs: Float32Array[]): number {
  const kw = chs.map((c) =>
    biquad(biquad(c, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]),
      [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]),
  );
  const win = Math.floor(SR * 0.4);
  const hop = Math.floor(SR * 0.1);
  const n = kw[0]!.length;
  let best = -Infinity;
  for (let s = 0; s + win <= Math.max(win, n); s += hop) {
    let sum = 0;
    for (const c of kw) {
      let e = 0;
      for (let i = s; i < s + win && i < n; i++) e += c[i]! * c[i]!;
      sum += e / win;
    }
    best = Math.max(best, -0.691 + 10 * Math.log10(Math.max(1e-12, sum)));
  }
  return best;
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const wr = Math.cos(ang * j), wi = Math.sin(ang * j);
        const k = i + j + len / 2;
        const vr = re[k]! * wr - im[k]! * wi;
        const vi = re[k]! * wi + im[k]! * wr;
        re[k] = re[i + j]! - vr; im[k] = im[i + j]! - vi;
        re[i + j] = re[i + j]! + vr; im[i + j] = im[i + j]! + vi;
      }
    }
  }
}

/** Темп по автокорреляции огибающей атак (полуволновой рост энергии), BPM в диапазоне 60–180. */
function tempo(mono: Float32Array): number {
  const hop = Math.floor(SR * 0.01);
  const env: number[] = [];
  let prev = 0;
  for (let i = 0; i + hop <= mono.length; i += hop) {
    let e = 0;
    for (let j = 0; j < hop; j++) e += mono[i + j]! ** 2;
    e = Math.sqrt(e / hop);
    env.push(Math.max(0, e - prev));
    prev = e;
  }
  let best = 0;
  let bestLag = 0;
  for (let lag = Math.round(60 / 180 / 0.01); lag <= Math.round(60 / 60 / 0.01); lag++) {
    let acc = 0;
    for (let i = 0; i + lag < env.length; i++) acc += env[i]! * env[i + lag]!;
    acc /= env.length - lag;
    if (acc > best) {
      best = acc;
      bestLag = lag;
    }
  }
  return bestLag ? 60 / (bestLag * 0.01) : 0;
}

function analyze(it: RenderItem, b: AudioBuffer): SoundStats {
  const chs = Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c));
  const n = b.length;
  const mono = new Float32Array(n);
  let peak = 0;
  let nonFinite = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of chs) {
      const v = c[i]!;
      if (!Number.isFinite(v)) nonFinite++;
      peak = Math.max(peak, Math.abs(v));
      m += v;
    }
    mono[i] = m / chs.length;
  }
  const thr = peak * 10 ** (-50 / 20);
  let first = -1;
  let last = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(mono[i]!) > thr) {
      if (first < 0) first = i;
      last = i;
    }
  }
  // RMS по окнам 20 мс, только окна выше −30 дБ от пика
  const win = Math.floor(SR * 0.02);
  let acc = 0, cnt = 0;
  for (let i = 0; i + win <= n; i += win) {
    let e = 0;
    for (let j = 0; j < win; j++) e += mono[i + j]! ** 2;
    if (Math.sqrt(e / win) > peak * 10 ** (-30 / 20)) {
      acc += e;
      cnt += win;
    }
  }
  // центроид: FFT 2048 по кадрам до конца звука, взвешенный энергией
  const N = 2048;
  let num = 0, den = 0;
  for (let i = 0; i + N <= Math.max(N, last); i += N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let j = 0; j < N; j++) re[j] = (mono[i + j] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const m = re[k]! ** 2 + im[k]! ** 2;
      num += (m * k * SR) / N;
      den += m;
    }
  }
  let tail = 0;
  const tw = Math.floor(SR * 0.02);
  for (let i = n - tw; i < n; i++) tail += mono[i]! ** 2;
  return {
    name: it.name,
    group: it.group,
    label: it.label,
    expectMs: it.expectMs ?? null,
    durS: n / SR,
    peakDb: db(peak),
    rmsDb: db(cnt ? Math.sqrt(acc / cnt) : 0),
    lenMs: first < 0 ? 0 : ((last - first) / SR) * 1000,
    centroidHz: den ? num / den : 0,
    mMaxLufs: momentaryMax(chs),
    tailDb: db(Math.sqrt(tail / tw)),
    firstAbs: Math.abs(mono[0]!),
    nonFinite,
    bpm: it.group === 'music' && it.name.startsWith('music_') ? tempo(mono) : null,
  };
}

function encodeWav(b: AudioBuffer): ArrayBuffer {
  const ch = b.numberOfChannels;
  const n = b.length;
  const buf = new ArrayBuffer(44 + n * ch * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, b.sampleRate, true);
  v.setUint32(28, b.sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c]![i]!));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return buf;
}

export interface RenderAllOpts {
  /** 'game' — через шины/компрессор, как слышит игрок (по умолчанию); 'raw' — сам рецепт. */
  chain?: 'game' | 'raw';
  /** Сохранять WAV для __wav() (по умолчанию да). */
  wav?: boolean;
  /** Регулярное выражение по имени — рендерить только совпадающие. */
  only?: string;
  /** Параметры компрессора вместо стандартных (эксперименты). */
  comp?: Partial<CompParams>;
}

async function renderAll(opts: RenderAllOpts = {}): Promise<SoundStats[]> {
  const chain = (opts.chain ?? 'game') === 'game';
  compOverride = opts.comp ?? {};
  const re = opts.only ? new RegExp(opts.only) : null;
  const out: SoundStats[] = [];
  let seed = 42;
  for (const it of renderList()) {
    seed += 17;
    if (re && !re.test(it.name)) continue;
    // Компрессор Chromium стартует «холодным» (детектор = 0) и полсекунды душит сигнал —
    // в игре он давно прогрет, поэтому звук ставим после разогрева WARM_S и отрезаем начало.
    const lead = chain ? WARM_S : 0;
    const oc = new OfflineAudioContext(2, Math.ceil(SR * (it.dur + lead)), SR);
    if (chain) {
      // разогрев: тихий тон ниже порога компрессора, затихает до старта звука
      const o = oc.createOscillator();
      const g = oc.createGain();
      o.frequency.value = 220;
      g.gain.setValueAtTime(0, 0);
      o.connect(g).connect(oc.destination);
      o.start(0);
      o.stop(0.01);
    }
    try {
      it.build(oc, chain, seed, lead + 0.01);
    } finally {
      setSynthRandom(Math.random);
    }
    const buf = cut(await oc.startRendering(), lead);
    out.push(analyze(it, buf));
    if (opts.wav !== false) wavs.set(it.name, encodeWav(buf));
  }
  return out;
}

function wavBase64(name: string): string | null {
  const b = wavs.get(name);
  if (!b) return null;
  const u8 = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

declare global {
  interface Window {
    __renderAll: (opts?: RenderAllOpts) => Promise<SoundStats[]>;
    __wav: (name: string) => string | null;
    __engine: AudioEngine;
  }
}
window.__renderAll = renderAll;
window.__wav = wavBase64;
window.__engine = engine;

// ───────────────────────────── интерфейс страницы ─────────────────────────────

const main = document.getElementById('main')!;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function section(title: string, hint?: string): HTMLElement {
  const s = document.createElement('section');
  const h = document.createElement('h2');
  h.textContent = title;
  s.appendChild(h);
  const row = document.createElement('div');
  row.className = 'row';
  s.appendChild(row);
  if (hint) {
    const p = document.createElement('div');
    p.className = 'hint';
    p.textContent = hint;
    s.appendChild(p);
  }
  main.appendChild(s);
  return row;
}

function button(row: HTMLElement, text: string, fn: () => void, live = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (live) b.classList.add('live');
  b.addEventListener('click', () => {
    void engine.unlock().then(fn);
  });
  row.appendChild(b);
  return b;
}

function slider(row: HTMLElement, label: string, min: number, max: number, step: number, value: number): () => number {
  const l = document.createElement('label');
  l.textContent = `${label} `;
  const i = document.createElement('input');
  i.type = 'range';
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  const out = document.createElement('span');
  out.textContent = i.value;
  i.addEventListener('input', () => (out.textContent = i.value));
  l.append(i, out);
  row.appendChild(l);
  return () => Number(i.value);
}

const view = { camX: 10, viewW: 24 };
const ev = (e: GameEvent): void => engine.handle(e, view);

// ── музыка ──
{
  const row = section('Музыка', 'Смена трека — кроссфейд 0.6 с; повторный выбор того же трека ничего не перезапускает.');
  button(row, 'Меню (полька)', () => engine.playMusic('menu'));
  for (const th of ['meadow', 'beach', 'snow'] as const) button(row, `Уровень: ${th}`, () => engine.playMusic('level', th));
  button(row, 'Тишина', () => engine.playMusic(null));
  button(row, 'Пауза вкл/выкл', (() => {
    let p = false;
    return () => engine.setPaused((p = !p));
  })());
  button(row, 'Джингл победы', () => engine.ui('win'));
  button(row, 'Джингл поражения', () => engine.ui('lose'));
}

// ── сценарии через handle() ──
{
  const row = section('Сценарии (через AudioEngine.handle — лимиты, кулдауны, пространство)',
    'Камера: camX = 10 м, viewW = 24 м. «Шторм» — 30 ударов в кадр 60 кадров подряд: слышно ≤ 4 в кадр, общий лимит 24 голоса.');
  const getX = slider(row, 'x источника, м', -30, 50, 1, 10);
  const getI = slider(row, 'импульс J', 0, 20, 0.5, 8);
  button(row, 'Удар по дереву', () => ev({ type: 'impact', x: getX(), y: 1, impulse: getI(), a: 'bird', b: 'wood' }));
  button(row, 'Удар по льду', () => ev({ type: 'impact', x: getX(), y: 1, impulse: getI(), a: 'ice', b: 'ground' }));
  button(row, 'Удар по камню', () => ev({ type: 'impact', x: getX(), y: 1, impulse: getI(), a: 'stone', b: 'wood' }));
  button(row, 'Выстрел Ред', () => {
    ev({ type: 'birdLoaded', bird: 'red' });
    setTimeout(() => ev({ type: 'aimStart', bird: 'red' }), 700);
    for (let k = 1; k <= 9; k++) setTimeout(() => ev({ type: 'aimStretch', power: k / 9 }), 800 + k * 90);
    setTimeout(() => ev({ type: 'birdLaunched', id: 1, bird: 'red', x: 0, y: 2.7, power: 1 }), 1800);
  });
  button(row, 'Обрушение башни', () => {
    for (let f = 0; f < 20; f++) {
      setTimeout(() => {
        for (let k = 0; k < 6; k++) {
          const m = (['wood', 'ice', 'stone'] as const)[(f + k) % 3];
          ev({ type: 'impact', x: 20 + k, y: 1, impulse: 2 + Math.random() * 14, a: m, b: 'wood' });
        }
        if (f % 4 === 0) ev({ type: 'blockDestroyed', id: f, material: (['wood', 'ice', 'stone'] as const)[f % 3], shape: 'rect', x: 21, y: 2, w: 2, h: 0.25, angle: 0, vx: 0, vy: 0, points: 500 });
        if (f === 6) ev({ type: 'pigDestroyed', id: 99, pig: 'medium', x: 22, y: 1, radius: 0.6, points: 5000 });
      }, f * 16);
    }
  });
  button(row, 'Шторм 30×60', () => {
    for (let f = 0; f < 60; f++) {
      setTimeout(() => {
        for (let k = 0; k < 30; k++) ev({ type: 'impact', x: 5 + k, y: 1, impulse: 1 + ((k * 37) % 15), a: (['wood', 'ice', 'stone', 'ground'] as const)[k % 4], b: 'wood' });
      }, f * 16);
    }
  });
  button(row, 'Взрыв TNT', () => {
    ev({ type: 'tntDestroyed', id: 5, x: getX(), y: 1, points: 0 });
    ev({ type: 'explosion', x: getX(), y: 1, radius: 3, source: 'tnt' });
  });
  button(row, 'Бомб: удар → фитиль → взрыв', () => {
    ev({ type: 'birdImpact', id: 7, bird: 'bomb', x: getX(), y: 1, speed: 10 });
    setTimeout(() => ev({ type: 'explosion', x: getX(), y: 1, radius: 3, source: 'bomb' }), 2000);
  });
  button(row, 'Смех свиней', () => ev({ type: 'pigsLaugh' }));
  button(row, 'Бонус 3 птицы', () => {
    ev({ type: 'stateChanged', from: 'settling', to: 'bonus' });
    for (let i = 0; i < 3; i++) setTimeout(() => ev({ type: 'birdBonus', bird: 'red', x: -2 - i, y: 0.5, points: 10000 }), i * 700);
  });
  button(row, 'Победа (levelEnd)', () => ev({ type: 'levelEnd', won: true, score: 50000, stars: 3 }));
  button(row, 'Экран победы: звёзды + счёт', () => {
    engine.ui('pop');
    [0.5, 0.95, 1.4].forEach((t, i) => setTimeout(() => engine.reward((['star0', 'star1', 'star2'] as const)[i]!), t * 1000));
    const t0 = 1650;
    for (let k = 0; k <= 72; k++) setTimeout(() => engine.scoreTick(k / 72), t0 + k * 16.7);
    setTimeout(() => {
      engine.reward('scoreDone');
      engine.ui('newRecord');
    }, 2850);
  });
}

// ── каждый звук каталога ──
const GROUP_RU: Record<SoundGroup, string> = {
  sling: 'Рогатка', birds: 'Птицы', ability: 'Способности', material: 'Материалы', explosion: 'Взрывы', pig: 'Свиньи', reward: 'Награды', ui: 'Интерфейс',
};
{
  const rows = new Map<SoundGroup, HTMLElement>();
  const getP = (() => {
    const row = section('Параметры живых звуков');
    return slider(row, 'параметр (натяжение / прогресс / №)', 0, 1, 0.05, 0.6);
  })();
  for (const d of SOUND_LIST) {
    let row = rows.get(d.group);
    if (!row) {
      row = section(GROUP_RU[d.group], d.group === 'reward' ? 'Пунктир — живой синтез (не запекается).' : undefined);
      rows.set(d.group, row);
    }
    button(row, d.label, () => {
      const def = soundDef(d.key)!;
      const param = def.key === 'bonus' ? Math.round(getP() * 8) : def.key === 'fuse' ? 1500 : def.key === 'ab:hal' ? 1000 : getP();
      engine.play(d.key, { param });
    }, d.bake === 0);
  }
}

// ── шапка ──
$('unlock').addEventListener('click', () => void engine.unlock());
$<HTMLInputElement>('sfx').addEventListener('change', (e) => engine.setSfx((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('music').addEventListener('change', (e) => engine.setMusic((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('vol').addEventListener('input', (e) => engine.setMasterVolume(Number((e.target as HTMLInputElement).value)));
setInterval(() => {
  const s = engine.stats();
  $('stats').textContent = `ctx: ${s.state} · голосов: ${s.voices} · запечено: ${s.baked}/${s.bakeTotal} · музыка: ${s.music ?? '—'} · сыграно ${s.pool.played}, кулдаун ${s.pool.cooldown}, лимит ${s.pool.limited}, кража ${s.pool.stolen}`;
}, 200);
