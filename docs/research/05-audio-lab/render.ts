// Офлайн-рендер всех рецептов и музыки + измерения (пик, RMS, длительность, спектральный центроид).
// Запуск (Node ≥ 22.18, нужен пакет node-web-audio-api в любой scratch-папке):
//   mkdir -p /tmp/nwaa && cd /tmp/nwaa && npm i node-web-audio-api@2.2.0
//   NWAA=/tmp/nwaa/x.js OUT=/tmp/nwaa/wav node docs/research/05-audio-lab/render.ts
// Пишет WAV в $OUT (если задан) и печатает таблицу в stdout.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeNoiseBank, makeReverbIR, makeTanhCurve, mulberry32 } from './noise.ts';
import * as F from './sfx.ts';
import * as M from './music.ts';
import { selectImpacts, spatial, TokenBucket } from './mix.ts';

const req = createRequire(process.env.NWAA ?? import.meta.url);
const W = req('node-web-audio-api') as { OfflineAudioContext: typeof OfflineAudioContext };
const SR = 48000;
const OUT = process.env.OUT;
if (OUT) mkdirSync(OUT, { recursive: true });

type Recipe = (s: F.S, t: number) => number;

async function render(name: string, dur: number, fn: Recipe, reverb = 0): Promise<string> {
  const ctx = new W.OfflineAudioContext(2, Math.ceil(SR * dur), SR);
  const nb = makeNoiseBank(ctx, 2);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  if (reverb > 0) {
    const cv = ctx.createConvolver();
    cv.buffer = makeReverbIR(ctx);
    const send = ctx.createGain();
    send.gain.value = reverb;
    out.connect(send).connect(cv).connect(ctx.destination);
  }
  const s: F.S = { ctx, out, nb, rnd: mulberry32(42), tanh: makeTanhCurve(3) };
  const t0 = performance.now();
  const end = fn(s, 0.01);
  const buf = await ctx.startRendering();
  const ms = performance.now() - t0;
  const st = stats(buf);
  if (OUT) writeFileSync(`${OUT}/${name}.wav`, wav(buf));
  return `| ${name} | ${st.peak.toFixed(1)} | ${st.rms.toFixed(1)} | ${(st.len * 1000).toFixed(0)} | ${(end * 1000 - 10).toFixed(0)} | ${st.centroid.toFixed(0)} | ${ms.toFixed(0)} |`;
}

function stats(b: AudioBuffer): { peak: number; rms: number; len: number; centroid: number } {
  const L = b.getChannelData(0);
  const Rr = b.numberOfChannels > 1 ? b.getChannelData(1) : L;
  const n = L.length;
  const mono = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    mono[i] = (L[i]! + Rr[i]!) / 2;
    peak = Math.max(peak, Math.abs(L[i]!), Math.abs(Rr[i]!));
  }
  const thr = peak * 10 ** (-50 / 20);
  let last = 0;
  for (let i = 0; i < n; i++) if (Math.abs(mono[i]!) > thr) last = i;
  // RMS по окнам 20 мс, только окна выше −30 дБ от пика
  const win = Math.floor(SR * 0.02);
  let acc = 0, cnt = 0;
  for (let i = 0; i + win <= n; i += win) {
    let e = 0;
    for (let j = 0; j < win; j++) e += mono[i + j]! ** 2;
    const r = Math.sqrt(e / win);
    if (r > peak * 10 ** (-30 / 20)) { acc += e; cnt += win; }
  }
  const rms = cnt ? Math.sqrt(acc / cnt) : 0;
  // центроид: FFT 2048 по кадрам, взвешенный энергией
  const N = 2048;
  let num = 0, den = 0;
  for (let i = 0; i + N <= Math.max(N, last); i += N) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let j = 0; j < N; j++) re[j] = (mono[i + j] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / N));
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const m = re[k]! ** 2 + im[k]! ** 2;
      num += m * (k * SR) / N;
      den += m;
    }
  }
  const db = (x: number): number => 20 * Math.log10(Math.max(1e-9, x));
  return { peak: db(peak), rms: db(rms), len: last / SR, centroid: den ? num / den : 0 };
}

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const wr = Math.cos(ang * j), wi = Math.sin(ang * j);
        const ur = re[i + j]!, ui = im[i + j]!;
        const vr = re[i + j + len / 2]! * wr - im[i + j + len / 2]! * wi;
        const vi = re[i + j + len / 2]! * wi + im[i + j + len / 2]! * wr;
        re[i + j] = ur + vr; im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
      }
    }
  }
}

function wav(b: AudioBuffer): Buffer {
  const ch = b.numberOfChannels, n = b.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * ch * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * ch * 2, 28); buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * ch * 2, 40);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[c]![i]!)) * 32767), 44 + (i * ch + c) * 2);
  return buf;
}

const BIRDS: F.BirdType[] = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];
const PIGS: F.PigType[] = ['small', 'medium', 'large', 'helmet', 'mustache', 'king'];

const jobs: Array<[string, number, Recipe, number?]> = [
  ['sling_grab', 0.3, (s, t) => F.slingGrab(s, t)],
  ['sling_stretch_p0', 0.3, (s, t) => F.slingStretch(s, t, 0)],
  ['sling_stretch_p1', 0.3, (s, t) => F.slingStretch(s, t, 1)],
  ['sling_release_p0.3', 0.8, (s, t) => F.slingRelease(s, t, 0.3)],
  ['sling_release_p1', 0.8, (s, t) => F.slingRelease(s, t, 1)],
  ['sling_cancel', 0.6, (s, t) => F.slingCancel(s, t)],
  ...BIRDS.map((b) => [`launch_${b}`, 0.9, (s: F.S, t: number) => F.birdLaunch(s, t, b)] as [string, number, Recipe]),
  ...BIRDS.map((b) => [`select_${b}`, 0.6, (s: F.S, t: number) => F.birdSelect(s, t, b)] as [string, number, Recipe]),
  ...BIRDS.map((b) => [`hurt_${b}`, 0.4, (s: F.S, t: number) => F.birdHurt(s, t, b)] as [string, number, Recipe]),
  ['bird_hop', 0.7, (s, t) => F.birdHop(s, t)],
  ['feather_pof', 0.4, (s, t) => F.featherPof(s, t)],
  ['bird_puff', 0.6, (s, t) => F.birdPuff(s, t)],
  ['ab_chuck', 1.2, (s, t) => F.abilityChuck(s, t)],
  ['ab_blues', 0.6, (s, t) => F.abilityBlues(s, t)],
  ['ab_bomb_fuse_1s', 1.3, (s, t) => F.bombFuse(s, t, 1000)],
  ['ab_bomb_swell', 0.4, (s, t) => F.bombSwell(s, t)],
  ['ab_matilda', 1.0, (s, t) => F.abilityMatilda(s, t)],
  ['ab_hal', 1.8, (s, t) => F.abilityHal(s, t, 1000)],
  ['ab_silver', 1.6, (s, t) => F.abilitySilver(s, t)],
  ['wood_hit_I0.1', 0.6, (s, t) => F.woodHit(s, t, 0.1)],
  ['wood_hit_I1', 0.8, (s, t) => F.woodHit(s, t, 1)],
  ['wood_crack_s3', 0.6, (s, t) => F.woodCrack(s, t, 3)],
  ['wood_break', 1.0, (s, t) => F.woodBreak(s, t, 1)],
  ['ice_hit_I0.1', 1.0, (s, t) => F.iceHit(s, t, 0.1)],
  ['ice_hit_I1', 1.8, (s, t) => F.iceHit(s, t, 1)],
  ['ice_crack_s3', 0.6, (s, t) => F.iceCrack(s, t, 3)],
  ['ice_shatter', 1.4, (s, t) => F.iceShatter(s, t, 1), 0.15],
  ['stone_hit_I0.1', 0.6, (s, t) => F.stoneHit(s, t, 0.1)],
  ['stone_hit_I1', 1.0, (s, t) => F.stoneHit(s, t, 1)],
  ['stone_crack_s3', 0.6, (s, t) => F.stoneCrack(s, t, 3)],
  ['stone_break', 2.6, (s, t) => F.stoneBreak(s, t, 1)],
  ['ground_thud_I1', 0.7, (s, t) => F.groundThud(s, t, 1)],
  ['pig_bump', 0.4, (s, t) => F.pigBump(s, t)],
  ['rubble_E6', 1.6, (s, t) => F.rubble(s, t, 6)],
  ['boom_tnt', 4.0, (s, t) => F.explosion(s, t, 'tnt'), 0.25],
  ['boom_bomb', 3.6, (s, t) => F.explosion(s, t, 'bomb'), 0.25],
  ['boom_egg', 3.0, (s, t) => F.explosion(s, t, 'egg'), 0.25],
  ...PIGS.map((p) => [`pig_grunt_${p}`, 0.6, (s: F.S, t: number) => F.pigGrunt(s, t, p)] as [string, number, Recipe]),
  ...PIGS.map((p) => [`pig_laugh_${p}`, 1.4, (s: F.S, t: number) => F.pigLaugh(s, t, p)] as [string, number, Recipe]),
  ['pig_hurt_medium', 0.4, (s, t) => F.pigHurt(s, t, 'medium')],
  ['pig_pop_medium', 0.8, (s, t) => F.pigPop(s, t, 'medium')],
  ['helmet_clang', 1.8, (s, t) => F.helmetClang(s, t)],
  ['star_0', 5.2, (s, t) => F.star(s, t, 0)],
  ['star_2', 5.2, (s, t) => F.star(s, t, 2)],
  ['star_empty', 0.4, (s, t) => F.starEmpty(s, t)],
  ['bonus_ding', 3.2, (s, t) => F.bonusDing(s, t, 0)],
  ['score_tick', 0.2, (s, t) => F.scoreTick(s, t, 0.5)],
  ['score_done', 4.4, (s, t) => F.scoreDone(s, t)],
  ['new_best', 6.0, (s, t) => F.newBest(s, t)],
  ...(['click', 'back', 'toggleOn', 'popIn', 'locked', 'whoosh', 'hover'] as F.UiSound[]).map((u) => [`ui_${u}`, 0.9, (s: F.S, t: number) => F.ui(s, t, u)] as [string, number, Recipe]),
  ['amb_meadow_8s', 12, (s, t) => F.ambience(s, t, 'meadow', 8)],
  ['amb_beach_8s', 12, (s, t) => F.ambience(s, t, 'beach', 8)],
  ['amb_snow_8s', 12, (s, t) => F.ambience(s, t, 'snow', 8)],
];

/** Музыка: офлайн — планируем все события сразу (тот же playEv, что и в живом секвенсоре). */
function musicJob(evs: M.SeqEv[], bpm: number, lenSteps: number): Recipe {
  return (s, t) => {
    const stepS = 60 / bpm / 4;
    const lead = M.makeAccordionStrip(s.ctx, s.out);
    for (const l of lead.lfos) { l.start(t); l.stop(t + lenSteps * stepS + 1); }
    const bass = s.ctx.createGain(); bass.connect(s.out);
    const stab = s.ctx.createStereoPanner(); stab.pan.value = 0.25; stab.connect(s.out);
    const drums = s.ctx.createGain(); drums.connect(s.out);
    const c: M.Inst = { ctx: s.ctx, nb: s.nb };
    let end = t;
    for (const e of evs) end = Math.max(end, M.playEv(c, { lead, bass, stab, drums }, e, t + e.step * stepS, stepS));
    return end;
  };
}

const song = M.MENU_SONG;
const songEv = M.compileBars([...song.intro, ...song.loop], song.barSteps);
const songSteps = (song.intro.length + song.loop.length) * song.barSteps;
jobs.push(['music_menu_full', songSteps * (60 / song.bpm / 4) + 1, musicJob(songEv, song.bpm, songSteps)]);
for (const kinds of [['lead'], ['bass'], ['stab'], ['kick', 'snare', 'hat', 'tamb']]) {
  jobs.push([`stem_${kinds[0]}`, 8 * 8 * (60 / song.bpm / 4) + 1, musicJob(songEv.filter((e) => kinds.includes(e.kind) && e.step >= 16 && e.step < 80).map((e) => ({ ...e, step: e.step - 16 })), song.bpm, 64)]);
}
jobs.push(['jingle_victory', 3.0, musicJob(M.VICTORY.events, M.VICTORY.bpm, M.VICTORY.lengthSteps)]);
jobs.push(['jingle_defeat', 3.6, musicJob(M.DEFEAT.events, M.DEFEAT.bpm, M.DEFEAT.lengthSteps)]);

console.log('| sound | peak dBFS | RMS dBFS | len >−50dB, ms | recipe end, ms | centroid Hz | render ms |');
console.log('|---|---|---|---|---|---|---|');
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
for (const [name, dur, fn, rv] of jobs) if (!ONLY || ONLY.test(name)) console.log(await render(name, dur, fn, rv ?? 0));

// ── логика микшера ──
console.log('\nmusic: bars =', song.intro.length + song.loop.length, 'loop s =', (song.loop.length * song.barSteps * 60 / song.bpm / 4).toFixed(2));
const reqs = Array.from({ length: 30 }, (_, i) => ({ key: ['wood:l', 'ice:l', 'stone:h'][i % 3]!, intensity: (i * 37 % 100) / 100, x: i }));
const sel = selectImpacts(reqs);
console.log('selectImpacts(30):', sel.play.length, 'played, overflow =', sel.overflow.toFixed(2));
const tb = new TokenBucket();
let ok = 0;
for (let f = 0; f < 60; f++) for (let k = 0; k < 30; k++) if (tb.take(f / 60)) ok++;
console.log('TokenBucket: 30 req/frame × 60 frames →', ok, 'passed');
// живой секвенсор на фейковых часах (performance.now) — проверка шага и петли
{
  const t0 = performance.now();
  const fake = { get currentTime() { return (performance.now() - t0) / 1000; } } as unknown as BaseAudioContext;
  const seen: number[] = [];
  const sq = new M.Sequencer(fake, song, (e, t) => { if (e.kind === 'kick') seen.push(t); });
  sq.start(0.05);
  await new Promise((r) => setTimeout(r, 1500));
  sq.stop();
  const d = seen.slice(1).map((x, i) => x - seen[i]!);
  console.log('Sequencer kicks:', seen.length, 'interval s:', Math.min(...d).toFixed(4), '…', Math.max(...d).toFixed(4), '(expected', (4 * 60 / song.bpm / 4).toFixed(4) + ')');
}
console.log('spatial:', [0, 10, 20, 30, 40].map((x) => JSON.stringify(spatial(x, 0, 20))).join(' '));
