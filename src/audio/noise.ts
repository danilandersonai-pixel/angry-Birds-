// Предгенерированные буферы: шумы (бесшовная петля), импульсный отклик реверба, кривая tanh.
// Работает с любым BaseAudioContext — и живым AudioContext, и OfflineAudioContext.

/** Детерминированный ГПСЧ (для запекания и офлайн-рендера). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NoiseBank {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

/** Сырые массивы шумов (их можно посчитать заранее, ещё без AudioContext). */
export interface NoiseData {
  sampleRate: number;
  white: Float32Array;
  pink: Float32Array;
  brown: Float32Array;
}

/** Шаг фоновой работы: столько сэмплов считается между точками yield (≈ 1–2 мс на слабом телефоне). */
export const GEN_CHUNK = 16384;

/** Довести генератор до конца синхронно и вернуть результат. */
export function runGen<T>(g: Generator<void, T>): T {
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** Заполняет n+fade сэмплов (с yield каждые chunk) и сворачивает хвост в начало — петля без щелчка на шве. */
function* loopableGen(n: number, fade: number, gen: () => number, chunk: number): Generator<void, Float32Array> {
  const raw = new Float32Array(n + fade);
  for (let i = 0; i < raw.length; i++) {
    raw[i] = gen();
    if (i % chunk === chunk - 1) yield;
  }
  const out = raw.subarray(0, n);
  for (let i = 0; i < fade; i++) {
    const k = i / fade; // 0 → 1
    out[i] = raw[i]! * k + raw[n + i]! * (1 - k);
  }
  return out;
}

/** Генерирует n+fade сэмплов и сворачивает хвост в начало — петля без щелчка на шве. */
export function loopable(n: number, fade: number, gen: () => number): Float32Array {
  return runGen(loopableGen(n, fade, gen, Number.MAX_SAFE_INTEGER));
}

/**
 * Белый, розовый (Пол Келлет) и коричневый шум по `seconds` секунд, моно — по частям (yield каждые chunk сэмплов),
 * чтобы считать в простое главного потока до первого жеста. Результат не зависит от chunk.
 */
export function* noiseDataGen(sampleRate: number, seconds = 2, seed = 1337, chunk = GEN_CHUNK): Generator<void, NoiseData> {
  const sr = sampleRate;
  const n = Math.floor(sr * seconds);
  const fade = Math.floor(sr * 0.02);
  const rnd = mulberry32(seed);

  const white = yield* loopableGen(n, fade, () => rnd() * 2 - 1, chunk);

  // Розовый шум: −3 дБ/окт, нормировка ×0.11.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const pink = yield* loopableGen(n, fade, () => {
    const x = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    const y = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    return y;
  }, chunk);

  // Коричневый шум: «протекающий» интегратор (−6 дБ/окт), ×3.5 до ~±1.
  let last = 0;
  const brown = yield* loopableGen(n, fade, () => {
    last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
    return last * 3.5;
  }, chunk);
  return { sampleRate: sr, white, pink, brown };
}

/**
 * Буферы шумов из готовых массивов. Частота буфера — частота массивов (контекст другой частоты
 * просто пересэмплирует шум при воспроизведении — для шума это незаметно).
 */
export function noiseBankFrom(ctx: BaseAudioContext, d: NoiseData): NoiseBank {
  const mk = (x: Float32Array): AudioBuffer => {
    const b = ctx.createBuffer(1, x.length, d.sampleRate);
    b.getChannelData(0).set(x);
    return b;
  };
  return { white: mk(d.white), pink: mk(d.pink), brown: mk(d.brown) };
}

/** Белый, розовый и коричневый шум по `seconds` секунд, моно, на частоте контекста (синхронно). */
export function makeNoiseBank(ctx: BaseAudioContext, seconds = 2, seed = 1337): NoiseBank {
  return noiseBankFrom(ctx, runGen(noiseDataGen(ctx.sampleRate, seconds, seed, Number.MAX_SAFE_INTEGER)));
}

/** Параметры импульсного отклика «двор». */
export interface ReverbIROpts {
  dur?: number;
  tau?: number;
  preDelay?: number;
  seed?: number;
}

/**
 * Стерео-IR «двор» по частям (yield каждые chunk сэмплов): пред-задержка 12 мс, экспоненциальный хвост τ = 0.25 с,
 * хвост темнеет со временем (однополюсный lowpass с убывающим коэффициентом).
 * ConvolverNode требует частоту IR = частоте контекста, поэтому IR считается для конкретной частоты.
 */
export function* reverbIRGen(sampleRate: number, o: ReverbIROpts = {}, chunk = GEN_CHUNK): Generator<void, Float32Array[]> {
  const { dur = 1.1, tau = 0.25, preDelay = 0.012, seed = 7 } = o;
  const sr = sampleRate;
  const n = Math.floor(sr * dur);
  const rnd = mulberry32(seed);
  const pd = Math.floor(sr * preDelay);
  const chs: Float32Array[] = [];
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(n);
    let lp = 0;
    for (let i = pd; i < n; i++) {
      const t = (i - pd) / sr;
      const k = 0.12 + 0.85 * Math.exp(-t / 0.3);
      lp += k * (rnd() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t / tau);
      if (i % chunk === chunk - 1) yield;
    }
    chs.push(d);
  }
  return chs;
}

/** AudioBuffer из каналов IR (частота — частота контекста). */
export function reverbIRFrom(ctx: BaseAudioContext, chs: readonly Float32Array[]): AudioBuffer {
  const ir = ctx.createBuffer(chs.length, chs[0]!.length, ctx.sampleRate);
  chs.forEach((d, c) => ir.getChannelData(c).set(d));
  return ir;
}

/** Стерео-IR «двор» синхронно (офлайн-рендер, тесты). */
export function makeReverbIR(ctx: BaseAudioContext, dur = 1.1, tau = 0.25, preDelay = 0.012, seed = 7): AudioBuffer {
  return reverbIRFrom(ctx, runGen(reverbIRGen(ctx.sampleRate, { dur, tau, preDelay, seed }, Number.MAX_SAFE_INTEGER)));
}

/** Мягкое насыщение для WaveShaperNode: y = tanh(drive·x)/tanh(drive). */
export function makeTanhCurve(drive = 3, size = 1024): Float32Array<ArrayBuffer> {
  const c = new Float32Array(size);
  const norm = Math.tanh(drive);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}
