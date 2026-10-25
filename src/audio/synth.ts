// Примитивы синтеза. Каждая функция планирует звук на время t (секунды ctx.currentTime)
// в узел out и возвращает время окончания (уровень ниже −60 дБ).
// Принимают BaseAudioContext → годятся и для живого звука, и для запекания/рендера в OfflineAudioContext.
// Все огибающие начинаются и заканчиваются нулём — без щелчков.

export type Ctx = BaseAudioContext;
/** Контур [мс от начала, значение]; значения > 0 (экспоненциальные отрезки). */
export type Pts = ReadonlyArray<readonly [number, number]>;

// ── Сбор источников ─────────────────────────────────────────────
// Движок включает сбор перед вызовом рецепта, чтобы при «краже» голоса реально
// остановить его осцилляторы/буферы, а не только заглушить (экономия CPU).
let collecting: AudioScheduledSourceNode[] | null = null;
export function beginCollect(): void {
  collecting = [];
}
export function endCollect(): AudioScheduledSourceNode[] {
  const c = collecting ?? [];
  collecting = null;
  return c;
}
function track<T extends AudioScheduledSourceNode>(n: T): T {
  collecting?.push(n);
  return n;
}

// Случайное смещение в шумовом буфере (в офлайн-рендере подменяется детерминированным ГПСЧ).
let synthRnd: () => number = Math.random;
export function setSynthRandom(f: () => number): void {
  synthRnd = f;
}

export const midiHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);
export const centsRatio = (c: number): number => 2 ** (c / 1200);
export const dbGain = (d: number): number => 10 ** (d / 20);
export const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/** ADSR: a, d, r — мс; s — доля пика 0..1. */
export interface Env {
  a: number;
  d: number;
  s: number;
  r: number;
}

/** Ударная огибающая: 0 → peak за aMs (линейно), затем экспонента τ = tauMs. Конец = −60 дБ (6.9τ). */
export function perc(p: AudioParam, t: number, peak: number, aMs: number, tauMs: number): number {
  const a = Math.max(0.2, aMs) / 1000; // атака ≥ 0.2 мс — без щелчка
  const tau = tauMs / 1000;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(0, t + a, tau);
  return t + a + 6.9 * tau;
}

/**
 * ADSR. holdS — от note-on до note-off, с. Конец = note-off + 1.75·r (≈ −60 дБ).
 * Перед release — «якорь» setValueAtTime(v(off)) со значением кривой спада, посчитанным аналитически:
 * без него две подряд setTargetAtTime в части реализаций дают выброс/NaN, а cancelAndHoldAtTime нет в Firefox.
 */
export function adsr(p: AudioParam, t: number, peak: number, e: Env, holdS: number): number {
  const a = Math.max(0.2, e.a) / 1000;
  const tauD = e.d / 3000 + 1e-4;
  const sus = peak * e.s;
  const off = t + Math.max(holdS, a);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(sus, t + a, tauD);
  p.setValueAtTime(sus + (peak - sus) * Math.exp(-(off - t - a) / tauD), off);
  p.setTargetAtTime(0, off, e.r / 4000 + 1e-4);
  return off + (e.r / 1000) * 1.75;
}

/** Контур параметра: первая точка — setValue, далее экспоненциальные отрезки. */
export function curve(p: AudioParam, t: number, pts: Pts, scale = 1): void {
  const first = pts[0];
  if (!first) return;
  p.setValueAtTime(Math.max(1e-4, first[1] * scale), t + first[0] / 1000);
  for (let i = 1; i < pts.length; i++) {
    const pt = pts[i]!;
    p.exponentialRampToValueAtTime(Math.max(1e-4, pt[1] * scale), t + pt[0] / 1000);
  }
}

/**
 * Фильтр. ВНИМАНИЕ: в Web Audio у lowpass/highpass Q задаётся в ДЕЦИБЕЛАХ (резонанс),
 * −3 ≈ Баттерворт; у bandpass/peaking/notch Q — обычная добротность.
 */
export interface Filt {
  type: BiquadFilterType;
  f: number | Pts;
  q?: number;
  g?: number;
}
export function filter(ctx: Ctx, t: number, s: Filt, fScale = 1): BiquadFilterNode {
  const n = ctx.createBiquadFilter();
  n.type = s.type;
  n.Q.value = s.q ?? (s.type === 'lowpass' || s.type === 'highpass' ? -3 : 1);
  if (s.g !== undefined) n.gain.value = s.g;
  if (typeof s.f === 'number') n.frequency.setValueAtTime(s.f * fScale, t);
  else curve(n.frequency, t, s.f, fScale);
  return n;
}

export interface Lfo {
  rate: number;
  /** Глубина: для vib — центы, для am — 0..1, для fmod — Гц. */
  depth: number;
  wave?: OscillatorType;
  delayMs?: number;
  /** Если задано — глубина затухает с τ = decayMs/3 (упругое «дрожание»). */
  decayMs?: number;
  /** До какого момента (мс) действует; потом глубина уходит в 0 за 40 мс. */
  untilMs?: number;
}

/** Подключает LFO к параметру; возвращает осциллятор (его надо start/stop). */
function lfoTo(ctx: Ctx, t: number, l: Lfo, target: AudioParam, depth: number): OscillatorNode {
  const o = track(ctx.createOscillator());
  o.type = l.wave ?? 'sine';
  o.frequency.value = l.rate;
  const g = ctx.createGain();
  const d0 = t + (l.delayMs ?? 0) / 1000;
  g.gain.setValueAtTime(0, t);
  g.gain.setValueAtTime(0, d0);
  g.gain.linearRampToValueAtTime(depth, d0 + (l.decayMs ? 0.005 : 0.08));
  if (l.decayMs) g.gain.setTargetAtTime(0, d0 + 0.005, l.decayMs / 3000);
  if (l.untilMs !== undefined) {
    g.gain.setValueAtTime(depth, t + l.untilMs / 1000);
    g.gain.linearRampToValueAtTime(0, t + l.untilMs / 1000 + 0.04);
  }
  o.connect(g).connect(target);
  return o;
}

/** Амплитудная модуляция: вставляет узел gain = 1 − depth/2 ± depth/2. */
function amStage(ctx: Ctx, t: number, l: Lfo, oscs: OscillatorNode[]): GainNode {
  const amp = ctx.createGain();
  amp.gain.value = 1 - l.depth / 2;
  oscs.push(lfoTo(ctx, t, { ...l, delayMs: l.delayMs ?? 0 }, amp.gain, l.depth / 2));
  return amp;
}

export interface ToneOpts {
  wave: OscillatorType;
  /** Частота, Гц, или контур [мс, Гц]. */
  f: number | Pts;
  gain: number;
  /** Либо ADSR + holdMs… */
  env?: Env;
  holdMs?: number;
  /** …либо удар: атака a мс, затухание τ мс. */
  a?: number;
  tau?: number;
  detune?: number;
  vib?: Lfo;
  am?: Lfo;
  filt?: Filt;
  /** Внешний общий модулятор высоты (выход в центах) — один LFO на дорожку вместо LFO на ноту. */
  detuneMod?: AudioNode;
}

/** Тон с огибающей, глиссандо, вибрато, АМ и фильтром. */
export function playTone(ctx: Ctx, out: AudioNode, t: number, o: ToneOpts, pitch = 1): number {
  const osc = track(ctx.createOscillator());
  osc.type = o.wave;
  if (typeof o.f === 'number') osc.frequency.setValueAtTime(o.f * pitch, t);
  else curve(osc.frequency, t, o.f, pitch);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);
  const lfos: OscillatorNode[] = [];
  if (o.vib) lfos.push(lfoTo(ctx, t, o.vib, osc.detune, o.vib.depth));
  if (o.detuneMod) o.detuneMod.connect(osc.detune);
  let head: AudioNode = osc;
  if (o.filt) head = head.connect(filter(ctx, t, o.filt));
  if (o.am) head = head.connect(amStage(ctx, t, o.am, lfos));
  const vca = ctx.createGain();
  const end = o.env
    ? adsr(vca.gain, t, o.gain, o.env, (o.holdMs ?? 100) / 1000)
    : perc(vca.gain, t, o.gain, o.a ?? 2, o.tau ?? 80);
  head.connect(vca).connect(out);
  osc.start(t);
  osc.stop(end);
  for (const l of lfos) {
    l.start(t);
    l.stop(end);
  }
  osc.onended = () => {
    vca.disconnect();
    if (o.detuneMod) o.detuneMod.disconnect(osc.detune);
  };
  return end;
}

export interface NoiseOpts {
  buf: AudioBuffer;
  gain: number;
  a?: number;
  tau?: number;
  env?: Env;
  holdMs?: number;
  /** Цепочка фильтров (последовательно). */
  filts?: ReadonlyArray<Filt>;
  /** playbackRate буфера: < 1 — темнее. */
  rate?: number;
  am?: Lfo;
  /** LFO частоты первого фильтра (Гц девиации) — «завывание», «бумеранг». */
  fmod?: Lfo;
}

/** Шумовой всплеск: случайный отрезок зацикленного буфера → фильтры → огибающая. */
export function playNoiseBurst(ctx: Ctx, out: AudioNode, t: number, o: NoiseOpts, fScale = 1): number {
  const src = track(ctx.createBufferSource());
  src.buffer = o.buf;
  src.loop = true;
  src.playbackRate.value = o.rate ?? 1;
  const lfos: OscillatorNode[] = [];
  let head: AudioNode = src;
  (o.filts ?? []).forEach((fs, i) => {
    const f = filter(ctx, t, fs, fScale);
    if (i === 0 && o.fmod) lfos.push(lfoTo(ctx, t, o.fmod, f.frequency, o.fmod.depth));
    head = head.connect(f);
  });
  if (o.am) head = head.connect(amStage(ctx, t, o.am, lfos));
  const vca = ctx.createGain();
  const end = o.env
    ? adsr(vca.gain, t, o.gain, o.env, (o.holdMs ?? 100) / 1000)
    : perc(vca.gain, t, o.gain, o.a ?? 1, o.tau ?? 40);
  head.connect(vca).connect(out);
  src.start(t, synthRnd() * Math.max(0, o.buf.duration - 0.6));
  src.stop(end);
  for (const l of lfos) {
    l.start(t);
    l.stop(end);
  }
  src.onended = () => vca.disconnect();
  return end;
}

/** Мода резонатора: частота Гц, амплитуда, τ затухания мс. */
export interface Mode {
  f: number;
  a: number;
  tau: number;
}

/** Модальный синтез: банк затухающих синусов (дерево, лёд, камень, металл, колокольчики). */
export function playModal(ctx: Ctx, out: AudioNode, t: number, modes: ReadonlyArray<Mode>, gain: number, ratio = 1, attackMs = 0.5): number {
  const bus = ctx.createGain();
  bus.gain.value = gain;
  bus.connect(out);
  let end = t;
  let last: OscillatorNode | null = null;
  for (const m of modes) {
    const f = m.f * ratio;
    if (f >= ctx.sampleRate * 0.45 || m.a <= 0) continue; // не выше 0.45·sr — без алиасинга
    const o = track(ctx.createOscillator());
    o.frequency.value = f;
    const g = ctx.createGain();
    const e = perc(g.gain, t, m.a, attackMs, m.tau);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(e);
    if (e >= end) {
      end = e;
      last = o;
    }
  }
  if (last) last.onended = () => bus.disconnect();
  else bus.disconnect();
  return end;
}

export interface Formant {
  f: number | Pts;
  q: number;
  g: number;
}
export interface VoiceOpts {
  wave: OscillatorType;
  f0: Pts;
  gain: number;
  durMs: number;
  env: Env;
  formants: ReadonlyArray<Formant>;
  /** Прямой путь через lowpass 1.2 кГц — «тело» голоса. По умолчанию 0.3. */
  body?: number;
  vib?: Lfo;
  /** «Рык»: АМ квадратом 25–45 Гц. */
  growl?: Lfo;
  /** Придыхание: шум через полосу F2, уровень относительно голоса. */
  breath?: { buf: AudioBuffer; level: number };
  /** Субгармоника (синус f0/2) — для крупных персонажей. */
  sub?: number;
}

/** Голос-вокализация (формантный синтез): источник → параллельные форманты (bandpass) → рык → ADSR. */
export function playVoice(ctx: Ctx, out: AudioNode, t: number, o: VoiceOpts, pitch = 1): number {
  const osc = track(ctx.createOscillator());
  osc.type = o.wave;
  curve(osc.frequency, t, o.f0, pitch);
  const lfos: OscillatorNode[] = [];
  if (o.vib) lfos.push(lfoTo(ctx, t, o.vib, osc.detune, o.vib.depth));
  const mix = ctx.createGain();
  for (const fm of o.formants) {
    const g = ctx.createGain();
    g.gain.value = fm.g;
    osc.connect(filter(ctx, t, { type: 'bandpass', f: fm.f, q: fm.q }, Math.sqrt(pitch))).connect(g).connect(mix);
  }
  const body = o.body ?? 0.3;
  if (body > 0) {
    const g = ctx.createGain();
    g.gain.value = body;
    osc.connect(filter(ctx, t, { type: 'lowpass', f: 1200 })).connect(g).connect(mix);
  }
  const extra: AudioScheduledSourceNode[] = [];
  if (o.sub) {
    const s = track(ctx.createOscillator());
    curve(s.frequency, t, o.f0, pitch * 0.5);
    const g = ctx.createGain();
    g.gain.value = o.sub;
    s.connect(g).connect(mix);
    extra.push(s);
  }
  if (o.breath) {
    const n = track(ctx.createBufferSource());
    n.buffer = o.breath.buf;
    n.loop = true;
    const f2 = o.formants[1]?.f ?? 1500;
    const g = ctx.createGain();
    g.gain.value = o.breath.level;
    n.connect(filter(ctx, t, { type: 'bandpass', f: f2, q: 2 })).connect(g).connect(mix);
    extra.push(n);
  }
  let head: AudioNode = mix;
  if (o.growl) head = head.connect(amStage(ctx, t, { wave: 'square', ...o.growl }, lfos));
  const vca = ctx.createGain();
  const end = adsr(vca.gain, t, o.gain, o.env, o.durMs / 1000);
  head.connect(vca).connect(out);
  for (const s of [osc, ...lfos, ...extra]) {
    s.start(t);
    s.stop(end);
  }
  osc.onended = () => vca.disconnect();
  return end;
}

/** Выход со стерео-панорамой (−1..1). */
export function panned(ctx: Ctx, dest: AudioNode, pan: number): AudioNode {
  if (!pan) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return p;
}
