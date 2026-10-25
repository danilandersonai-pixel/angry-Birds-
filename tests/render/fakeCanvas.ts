// Поддельные Canvas 2D / Path2D / DOMMatrix для тестов рендера в Node: контекст записывает трансформацию
// в момент каждой заливки / обводки / drawImage — по ней проверяется совмещение рельефа и тел.

export class FakeMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor(init?: number[]) {
    if (init) [this.a, this.b, this.c, this.d, this.e, this.f] = init;
  }
  multiply(m: FakeMatrix): FakeMatrix {
    return new FakeMatrix([
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.e + this.c * m.f + this.e,
      this.b * m.e + this.d * m.f + this.f,
    ]);
  }
  translate(x: number, y: number): FakeMatrix {
    return this.multiply(new FakeMatrix([1, 0, 0, 1, x, y]));
  }
  scale(x: number, y = x): FakeMatrix {
    return this.multiply(new FakeMatrix([x, 0, 0, y, 0, 0]));
  }
  rotate(deg: number): FakeMatrix {
    const r = (deg * Math.PI) / 180;
    return this.multiply(new FakeMatrix([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]));
  }
  apply(x: number, y: number): [number, number] {
    return [this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f];
  }
}

class FakePath {
  addPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  arc(): void {}
  ellipse(): void {}
  rect(): void {}
  roundRect(): void {}
  quadraticCurveTo(): void {}
  bezierCurveTo(): void {}
}

export interface DrawRecord {
  op: 'fill' | 'stroke' | 'drawImage' | 'fillRect';
  m: FakeMatrix;
  args: unknown[];
  canvas: FakeCanvasEl;
}

/** Все операции всех поддельных контекстов (сбрасывается тестом). */
export const LOG: DrawRecord[] = [];

export class FakeCtx {
  m = new FakeMatrix();
  private stack: FakeMatrix[] = [];
  fillStyle: unknown = '#000';
  strokeStyle: unknown = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  filter = 'none';
  constructor(readonly canvas: FakeCanvasEl) {}
  save(): void {
    this.stack.push(this.m);
  }
  restore(): void {
    this.m = this.stack.pop() ?? new FakeMatrix();
  }
  setTransform(a: number | FakeMatrix, b = 0, c = 0, d = 1, e = 0, f = 0): void {
    this.m = typeof a === 'number' ? new FakeMatrix([a, b, c, d, e, f]) : new FakeMatrix([a.a, a.b, a.c, a.d, a.e, a.f]);
  }
  getTransform(): FakeMatrix {
    return new FakeMatrix([this.m.a, this.m.b, this.m.c, this.m.d, this.m.e, this.m.f]);
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = this.m.multiply(new FakeMatrix([a, b, c, d, e, f]));
  }
  translate(x: number, y: number): void {
    this.m = this.m.translate(x, y);
  }
  scale(x: number, y: number): void {
    this.m = this.m.scale(x, y);
  }
  rotate(r: number): void {
    this.m = this.m.rotate((r * 180) / Math.PI);
  }
  private rec(op: DrawRecord['op'], args: unknown[]): void {
    LOG.push({ op, m: this.getTransform(), args, canvas: this.canvas });
  }
  fill(...args: unknown[]): void {
    this.rec('fill', args);
  }
  stroke(...args: unknown[]): void {
    this.rec('stroke', args);
  }
  fillRect(...args: unknown[]): void {
    this.rec('fillRect', args);
  }
  strokeRect(): void {}
  drawImage(...args: unknown[]): void {
    this.rec('drawImage', args);
  }
  clip(): void {}
  beginPath(): void {}
  closePath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  rect(): void {}
  arc(): void {}
  ellipse(): void {}
  quadraticCurveTo(): void {}
  createLinearGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
  createRadialGradient(): { addColorStop(): void } {
    return { addColorStop() {} };
  }
  createPattern(): { setTransform(): void } {
    return { setTransform() {} };
  }
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number } {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
  }
  putImageData(): void {}
  getImageData(_x: number, _y: number, w: number, h: number): { data: Uint8ClampedArray } {
    return { data: new Uint8ClampedArray(w * h * 4) };
  }
}

export class FakeCanvasEl {
  width = 300;
  height = 150;
  private ctx: FakeCtx | null = null;
  getContext(): FakeCtx {
    return (this.ctx ??= new FakeCtx(this));
  }
}

/** Подменить глобальные document / Path2D / DOMMatrix (vi.stubGlobal). */
export function fakeDomGlobals(stub: (name: string, v: unknown) => void): void {
  stub('document', { createElement: () => new FakeCanvasEl() });
  stub('Path2D', FakePath);
  stub('DOMMatrix', FakeMatrix);
}
