// Строгая подделка Web Audio для тестов движка в Node: проверяет то, на чём падают настоящие браузеры
// (неконечные значения параметров, отрицательное время, exponentialRamp к 0, повторный start).
// Звук не считает — только граф вызовов.

export class FakeParam {
  private v: number;
  calls = 0;
  /** Номинальный диапазон: Chrome пишет предупреждение в консоль, если значение за его пределами. */
  readonly min: number;
  readonly max: number;
  constructor(v = 0, min = -Infinity, max = Infinity) {
    this.v = v;
    this.min = min;
    this.max = max;
  }
  get value(): number {
    return this.v;
  }
  set value(x: number) {
    fin(x, 'value');
    this.range(x, 'value');
    this.v = x;
  }
  private range(x: number, what: string): void {
    if (x < this.min || x > this.max) throw new RangeError(`${what}: ${x} вне [${this.min}, ${this.max}]`);
  }
  private chk(x: number, t: number, what: string): this {
    fin(x, what);
    this.range(x, what);
    fin(t, `${what}.time`);
    if (t < 0) throw new RangeError(`${what}: отрицательное время ${t}`);
    this.calls++;
    return this;
  }
  setValueAtTime(x: number, t: number): this {
    this.chk(x, t, 'setValueAtTime');
    this.v = x;
    return this;
  }
  linearRampToValueAtTime(x: number, t: number): this {
    return this.chk(x, t, 'linearRamp');
  }
  exponentialRampToValueAtTime(x: number, t: number): this {
    if (x === 0) throw new RangeError('exponentialRamp к 0');
    return this.chk(x, t, 'exponentialRamp');
  }
  setTargetAtTime(x: number, t: number, tau: number): this {
    fin(tau, 'tau');
    if (tau < 0) throw new RangeError('отрицательная τ');
    return this.chk(x, t, 'setTargetAtTime');
  }
  cancelScheduledValues(t: number): this {
    fin(t, 'cancel');
    return this;
  }
}

function fin(x: number, what: string): void {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError(`${what}: неконечное значение ${x}`);
}

export class FakeNode {
  readonly ctx: FakeCtx;
  outs = new Set<unknown>();
  constructor(ctx: FakeCtx) {
    this.ctx = ctx;
    ctx.nodes++;
  }
  connect<T>(dest: T): T {
    if (!(dest instanceof FakeNode) && !(dest instanceof FakeParam)) throw new TypeError('connect: не узел');
    this.outs.add(dest);
    return dest;
  }
  disconnect(dest?: unknown): void {
    if (dest === undefined) this.outs.clear();
    else this.outs.delete(dest);
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}
class FakePanner extends FakeNode {
  pan = new FakeParam(0);
}
class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350, 0, this.ctx.sampleRate / 2);
  Q = new FakeParam(1);
  gain = new FakeParam(0);
}
class FakeDelay extends FakeNode {
  delayTime = new FakeParam(0);
}
class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}
class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  normalize = true;
}
class FakeComp extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  started = false;
  stopAt = Infinity;
  start(when = 0, offset = 0): void {
    fin(when, 'start');
    fin(offset, 'start.offset');
    if (when < 0 || offset < 0) throw new RangeError('start: отрицательное время');
    if (this.started) throw new Error('InvalidStateError: повторный start');
    this.started = true;
    this.ctx.sources++;
  }
  stop(when = 0): void {
    fin(when, 'stop');
    if (when < 0) throw new RangeError('stop: отрицательное время');
    this.stopAt = when;
  }
}
class FakeOsc extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440, -this.ctx.sampleRate / 2, this.ctx.sampleRate / 2);
  detune = new FakeParam(0);
}
class FakeBufSrc extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
}

export class FakeBuffer {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  private readonly data: Float32Array[];
  constructor(ch: number, len: number, sr: number) {
    this.length = len;
    this.sampleRate = sr;
    this.numberOfChannels = ch;
    this.data = Array.from({ length: ch }, () => new Float32Array(len));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number): Float32Array {
    return this.data[c]!;
  }
}

export class FakeCtx {
  static instances = 0;
  /** Разрешить resume() (имитация жеста). */
  static allowResume = true;
  /** Частота новых контекстов (32 кГц — как при запекании). */
  static rate = 48000;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = FakeCtx.rate;
  nodes = 0;
  sources = 0;
  onstatechange: (() => void) | null = null;
  readonly destination: FakeNode;
  constructor(_opts?: unknown) {
    FakeCtx.instances++;
    this.destination = new FakeNode(this);
  }
  private set(s: FakeCtx['state']): void {
    this.state = s;
    this.onstatechange?.();
  }
  resume(): Promise<void> {
    if (FakeCtx.allowResume) this.set('running');
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    this.set('suspended');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.set('closed');
    return Promise.resolve();
  }
  createGain(): FakeGain {
    return new FakeGain(this);
  }
  createStereoPanner(): FakePanner {
    return new FakePanner(this);
  }
  createBiquadFilter(): FakeFilter {
    return new FakeFilter(this);
  }
  createDelay(_max?: number): FakeDelay {
    return new FakeDelay(this);
  }
  createWaveShaper(): FakeShaper {
    return new FakeShaper(this);
  }
  createConvolver(): FakeConvolver {
    return new FakeConvolver(this);
  }
  createDynamicsCompressor(): FakeComp {
    return new FakeComp(this);
  }
  createOscillator(): FakeOsc {
    return new FakeOsc(this);
  }
  createBufferSource(): FakeBufSrc {
    return new FakeBufSrc(this);
  }
  createBuffer(ch: number, len: number, sr: number): FakeBuffer {
    return new FakeBuffer(ch, len, sr);
  }
}

/** Слушатели window — чтобы проверить «взвод» разблокировки по жесту. */
export function fakeWindow(): { win: Record<string, unknown>; listeners: Map<string, Set<() => void>> } {
  const listeners = new Map<string, Set<() => void>>();
  const win: Record<string, unknown> = {
    AudioContext: FakeCtx,
    addEventListener: (t: string, fn: () => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn);
    },
    removeEventListener: (t: string, fn: () => void) => listeners.get(t)?.delete(fn),
  };
  return { win, listeners };
}
