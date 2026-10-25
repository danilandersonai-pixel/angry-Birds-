// Граф шин: уровни 05-audio §2.1, компрессор + мягкий клиппер без задержки, отложенный IR реверба.
import { describe, expect, it } from 'vitest';
import { BUS_LEVEL, CLIP, COMP_DEFAULT, createMixGraph, makeSoftClipCurve, softClip } from '../../src/audio/graph';
import { makeReverbIR } from '../../src/audio/noise';
import { FakeCtx } from './fakeAudio';

type Outs = { outs: Set<unknown> };

describe('граф микшера', () => {
  it('уровни шин и компрессора по 05-audio', () => {
    expect(BUS_LEVEL).toMatchObject({ master: 0.9, sfx: 0.8, ui: 0.7, music: 0.64, amb: 0.35 });
    expect(COMP_DEFAULT).toEqual({ threshold: -16, knee: 12, ratio: 4, attack: 0.004, release: 0.18 });
  });
  it('цепочка master → компрессор → ×1/range → клиппер → выход; второго компрессора (6 мс упреждения) нет', () => {
    const c = new FakeCtx();
    const g = createMixGraph(c as unknown as BaseAudioContext);
    expect((g.master as unknown as Outs).outs.has(g.comp)).toBe(true);
    const pre = [...(g.comp as unknown as { outs: Set<{ gain: { value: number }; outs: Set<unknown> }> }).outs][0]!;
    expect(pre.gain.value).toBeCloseTo(1 / CLIP.range, 9);
    expect(pre.outs.has(g.clip)).toBe(true);
    expect((g.clip as unknown as Outs).outs.has(c.destination)).toBe(true);
    expect(g.clip.oversample).toBe('none');
    expect(g.busFor('impact')).toBe(g.sfx);
    expect(g.busFor('ui')).toBe(g.ui);
    expect(g.busFor('reward')).toBe(g.ui);
    expect(g.busFor('jingle')).toBe(g.music);
  });
  it('мягкий клиппер: до −6 dBFS без изменений, выше — монотонно и не выше потолка −1.9 dBFS', () => {
    for (const x of [0, 0.1, -0.3, 0.5, -0.5]) expect(softClip(x)).toBeCloseTo(x, 12);
    let prev = softClip(0.5);
    for (let x = 0.51; x <= 4; x += 0.01) {
      const y = softClip(x);
      expect(y).toBeGreaterThan(prev);
      expect(y).toBeLessThan(CLIP.ceil);
      prev = y;
    }
    expect(softClip(-1)).toBeCloseTo(-softClip(1), 12);
    // гладкое колено: производная справа от knee ≈ 1
    expect((softClip(0.5001) - softClip(0.5)) / 0.0001).toBeCloseTo(1, 3);
    // пик −1 dBFS после компрессора (худшая цепь TNT) выходит ниже −2 dBFS
    expect(20 * Math.log10(softClip(10 ** (-1 / 20)))).toBeLessThan(-2);
  });
  it('кривая WaveShaper: точный ноль в центре, края = клиппер на ±range', () => {
    const k = makeSoftClipCurve(4097);
    expect(k[2048]).toBe(0);
    expect(k[4096]).toBeCloseTo(softClip(CLIP.range), 6);
    expect(k[0]).toBeCloseTo(-softClip(CLIP.range), 6);
    // линейный участок: вход 0.25 (после ×1/range это 0.125) → выход 0.25
    const i = Math.round(((0.25 / CLIP.range + 1) / 2) * 4096);
    expect(k[i]).toBeCloseTo((i / 4096 * 2 - 1) * CLIP.range, 6);
  });
  it('IR реверба можно поставить позже (вне обработчика жеста), второй раз — игнор', () => {
    const c = new FakeCtx();
    const ctx = c as unknown as BaseAudioContext;
    const g = createMixGraph(ctx, ctx.destination, {}, { reverbIR: null });
    expect(g.reverb.buffer).toBeNull();
    const ir = makeReverbIR(ctx);
    g.setReverbIR(ir);
    expect(g.reverb.buffer).toBe(ir);
    g.setReverbIR(makeReverbIR(ctx));
    expect(g.reverb.buffer).toBe(ir);
    // по умолчанию IR считается сразу (офлайн-рендер)
    expect(createMixGraph(ctx).reverb.buffer).not.toBeNull();
  });
});
