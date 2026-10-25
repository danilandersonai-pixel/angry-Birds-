// Предгенерированные буферы: шумы и импульсный отклик реверба.
// Работает с любым BaseAudioContext (живой AudioContext и OfflineAudioContext).

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

/** Генерирует n+fade сэмплов и сворачивает хвост в начало — петля без щелчка на шве. */
function loopable(n: number, fade: number, gen: () => number): Float32Array {
  const raw = new Float32Array(n + fade);
  for (let i = 0; i < raw.length; i++) raw[i] = gen();
  const out = raw.subarray(0, n);
  for (let i = 0; i < fade; i++) {
    const k = i / fade; // 0 → 1
    out[i] = raw[i] * k + raw[n + i] * (1 - k);
  }
  return out;
}

export function makeNoiseBank(ctx: BaseAudioContext, seconds = 2, seed = 1337): NoiseBank {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const fade = Math.floor(sr * 0.02);
  const rnd = mulberry32(seed);

  const white = loopable(n, fade, () => rnd() * 2 - 1);

  // Розовый шум: фильтр Пола Келлета (−3 дБ/окт), нормировка ×0.11.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const pink = loopable(n, fade, () => {
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
  });

  // Коричневый шум: «протекающий» интегратор (−6 дБ/окт), ×3.5 до ~±1.
  let last = 0;
  const brown = loopable(n, fade, () => {
    last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
    return last * 3.5;
  });

  const mk = (d: Float32Array): AudioBuffer => {
    const b = ctx.createBuffer(1, n, sr);
    b.getChannelData(0).set(d);
    return b;
  };
  return { white: mk(white), pink: mk(pink), brown: mk(brown) };
}

/**
 * Стерео-IR «двор/улица»: пред-задержка 12 мс, экспоненциальный хвост τ=0.25 с,
 * хвост темнеет со временем (однополюсный lowpass с убывающим коэффициентом).
 */
export function makeReverbIR(ctx: BaseAudioContext, dur = 1.1, tau = 0.25, preDelay = 0.012, seed = 7): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * dur);
  const ir = ctx.createBuffer(2, n, sr);
  const rnd = mulberry32(seed);
  const pd = Math.floor(sr * preDelay);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = pd; i < n; i++) {
      const t = (i - pd) / sr;
      const k = 0.12 + 0.85 * Math.exp(-t / 0.3);
      lp += k * (rnd() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t / tau);
    }
  }
  return ir;
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
