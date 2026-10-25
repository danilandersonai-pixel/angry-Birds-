// Музыка: инварианты нот (такт = 8/16 шестнадцатых), форма польки, эмбиент уровня, джинглы, lookahead-планировщик.
import { describe, expect, it } from 'vitest';
import {
  type Bar, compileAmbient, compileBars, DEFEAT, LEVEL_SONG, LEVEL_SONGS, LEVEL_THEME, LOOKAHEAD_MS, MENU_SONG, SCHEDULE_AHEAD_S, type SeqEv,
  Sequencer, SONGS, type Timers, VICTORY,
} from '../../src/audio/music';
import { makeNoiseBank } from '../../src/audio/noise';
import { LEVEL_MUSIC, startTrack, TRACK_GAIN } from '../../src/audio/tracks';
import { FakeCtx, type FakeNode } from './fakeAudio';

describe('полька меню «Пернатый переполох»', () => {
  const s = SONGS.menu;
  it('144 BPM, 2/4: шаг 16-й = 0.1042 с, 2 такта вступления + петля 32 такта = 26.67 с', () => {
    expect(s.bpm).toBe(144);
    expect(s.stepS).toBeCloseTo(60 / 144 / 4, 12);
    expect(MENU_SONG.intro).toHaveLength(2);
    expect(MENU_SONG.loop).toHaveLength(32);
    expect(s.totalSteps).toBe(34 * 8);
    expect((s.totalSteps - s.introSteps) * s.stepS).toBeCloseTo(26.667, 2);
  });
  it('в каждом такте сумма длительностей мелодии = 8 шестнадцатых', () => {
    for (const b of [...MENU_SONG.intro, ...MENU_SONG.loop]) expect(b.lead.reduce((n, [, len]) => n + len, 0)).toBe(8);
  });
  it('compileBars бросает исключение на кривом такте', () => {
    const bad: Bar[] = [{ chord: 'Dm', lead: [[74, 3], [76, 3]], drums: 'polka' }];
    expect(() => compileBars(bad, 8)).toThrow();
  });
  it('мелодия — ре гармонический минор (+ до-бекар раздела B в фа мажоре), не тема серии', () => {
    const allowed = new Set([2, 4, 5, 7, 9, 10, 1, 0]); // D E F G A B♭ C♯ + C
    const lead = s.events.filter((e) => e.kind === 'lead');
    expect(lead.length).toBeGreaterThan(120);
    for (const e of lead) expect(allowed.has(e.midi! % 12), `midi ${e.midi}`).toBe(true);
    // увеличенная секунда B♭–C♯ (балканский колорит) встречается подряд
    let aug2 = 0;
    for (let i = 1; i < lead.length; i++) if (lead[i - 1]!.midi === 70 && lead[i]!.midi === 73) aug2++;
    expect(aug2).toBeGreaterThan(0);
  });
  it('умпа: бас на 1-ю и 2-ю доли, «па» на слабые восьмые, бочка на доли', () => {
    const at = (kind: SeqEv['kind'], bar: number): number[] =>
      s.events.filter((e) => e.kind === kind && Math.floor(e.step / 8) === bar).map((e) => e.step % 8);
    expect(at('bass', 3)).toEqual([0, 4]);
    expect(at('stab', 3)).toEqual([2, 6]);
    expect(at('kick', 3)).toEqual([0, 4]);
  });
  it('бубен звучит только в разделе B', () => {
    const tambBars = new Set(s.events.filter((e) => e.kind === 'tamb').map((e) => Math.floor(e.step / 8)));
    for (const b of tambBars) expect(b).toBeGreaterThanOrEqual(2 + 16);
    // 16 тактов B/B′, кроме последнего — там брейк малого барабана
    expect(tambBars.size).toBe(15);
  });
});

describe('спокойная музыка уровня «Тихая лужайка»', () => {
  const s = SONGS.level;
  it('80 BPM, 4/4, 16 тактов = 48 с, без вступления', () => {
    expect(s.bpm).toBe(80);
    expect(LEVEL_SONG.bars).toHaveLength(16);
    expect(s.introSteps).toBe(0);
    expect(s.totalSteps * s.stepS).toBeCloseTo(48, 6);
  });
  it('в такте 16 шестнадцатых; без ударных — только калимба, пэд, мягкий бас и шейкер', () => {
    for (const b of LEVEL_SONG.bars) expect(b.lead.reduce((n, [, len]) => n + len, 0)).toBe(16);
    const kinds = new Set(s.events.map((e) => e.kind));
    expect([...kinds].sort()).toEqual(['pad', 'pluck', 'shaker', 'sub']);
    expect(() => compileAmbient({ bpm: 80, barSteps: 16, bars: [{ chord: 'C', lead: [[72, 3]], shaker: false }] })).toThrow();
  });
  it('пэд берётся раз на смену аккорда и держится всю его длину', () => {
    const pads = s.events.filter((e) => e.kind === 'pad');
    expect(pads.reduce((n, e) => n + e.len!, 0)).toBe(s.totalSteps);
  });
});

describe('луп уровня по темам (ревью «в уровнях нет музыки»)', () => {
  it('у каждой темы свой вариант: тональность, темп, шейкер; форма и длина такта те же', () => {
    const pl = (th: 'meadow' | 'beach' | 'snow') => LEVEL_SONGS[th].events.filter((e) => e.kind === 'pluck').map((e) => e.midi!);
    expect(LEVEL_SONGS.meadow.events).toEqual(SONGS.level.events); // луг — исходная «Тихая лужайка»
    expect(pl('beach')).toEqual(pl('meadow').map((m) => m + LEVEL_THEME.beach.transpose));
    expect(pl('snow')).toEqual(pl('meadow').map((m) => m + LEVEL_THEME.snow.transpose));
    const bpms = new Set(Object.values(LEVEL_SONGS).map((s) => s.bpm));
    expect(bpms.size).toBe(3);
    const shakers = (th: 'meadow' | 'beach' | 'snow') => LEVEL_SONGS[th].events.filter((e) => e.kind === 'shaker').length;
    expect(shakers('snow')).toBe(0);
    expect(shakers('beach')).toBeGreaterThan(shakers('meadow'));
    for (const s of Object.values(LEVEL_SONGS)) {
      expect(s.totalSteps).toBe(LEVEL_SONG.bars.length * 16);
      // спокойный луп: 70–90 BPM, петля 40–60 с
      expect(s.bpm).toBeGreaterThanOrEqual(70);
      expect(s.bpm).toBeLessThanOrEqual(90);
      expect(s.totalSteps * s.stepS).toBeGreaterThan(40);
      expect(s.totalSteps * s.stepS).toBeLessThan(60);
    }
  });
});

describe('джинглы', () => {
  const len = (j: typeof VICTORY): number => Math.max(...j.events.map((e) => e.step + (e.len ?? 0))) * (60 / j.bpm / 4);
  it('победа 150 BPM, 1.6 с; поражение 100 BPM, 2.4 с', () => {
    expect(VICTORY.bpm).toBe(150);
    expect(len(VICTORY)).toBeCloseTo(1.6, 6);
    expect(DEFEAT.bpm).toBe(100);
    expect(len(DEFEAT)).toBeCloseTo(2.4, 6);
  });
  it('победа в ре мажоре (F♯), поражение — нисходящая фраза к D', () => {
    expect(VICTORY.events.some((e) => e.kind === 'lead' && e.midi! % 12 === 6)).toBe(true);
    const lead = DEFEAT.events.filter((e) => e.kind === 'lead').map((e) => e.midi!);
    expect(lead[0]).toBeGreaterThan(lead[lead.length - 1]!);
    expect(lead[lead.length - 1]! % 12).toBe(2);
  });
});

/** Фейковые часы и таймеры: run(ms) продвигает время и вызывает созревшие таймеры. */
function fakeEnv() {
  const clock = { currentTime: 0 };
  let now = 0;
  let id = 0;
  const q = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      q.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void q.delete(h as number),
  };
  const run = (ms: number, step = 5): void => {
    const end = now + ms;
    while (now < end) {
      now += step;
      clock.currentTime = now / 1000;
      for (const [k, t] of [...q]) {
        if (t.at <= now) {
          q.delete(k);
          t.fn();
        }
      }
    }
  };
  return { clock, timers, run, pending: () => q.size, jump: (ms: number) => { now += ms; clock.currentTime = now / 1000; } };
}

describe('Sequencer (lookahead, «A Tale of Two Clocks»)', () => {
  it('25 мс / горизонт 120 мс', () => {
    expect(LOOKAHEAD_MS).toBe(25);
    expect(SCHEDULE_AHEAD_S).toBe(0.12);
  });
  it('бочка ровно каждые 0.4167 с; всё планируется не дальше горизонта', () => {
    const env = fakeEnv();
    const kicks: number[] = [];
    let maxAhead = 0;
    const seq = new Sequencer(env.clock, SONGS.menu, (e, t) => {
      maxAhead = Math.max(maxAhead, t - env.clock.currentTime);
      if (e.kind === 'kick') kicks.push(t);
    }, env.timers);
    seq.start(0.05);
    env.run(10_000);
    expect(seq.running).toBe(true);
    expect(kicks.length).toBeGreaterThan(20);
    for (let i = 1; i < kicks.length; i++) expect(kicks[i]! - kicks[i - 1]!).toBeCloseTo(60 / 144, 9);
    expect(maxAhead).toBeLessThanOrEqual(SCHEDULE_AHEAD_S + 0.11);
    seq.stop();
    expect(seq.running).toBe(false);
    expect(env.pending()).toBe(0);
  });
  it('петля возвращается к такту A1 без вступления', () => {
    const env = fakeEnv();
    const s = SONGS.menu;
    const seq = new Sequencer(env.clock, s, () => undefined, env.timers);
    seq.reset(0);
    seq.scheduleUntil(s.totalSteps * s.stepS - 1e-9);
    expect(seq.position).toBe(s.introSteps);
  });
  it('после «сна» вкладки пропущенное не догоняется пачкой', () => {
    const env = fakeEnv();
    let n = 0;
    const seq = new Sequencer(env.clock, SONGS.menu, () => n++, env.timers);
    seq.start(0.05);
    env.run(1000);
    const before = n;
    env.jump(30_000); // таймеры «проспали» 30 с
    env.run(30);
    // за 30 мс + горизонт 120 мс — не больше пары шагов, а не 30 секунд событий
    expect(n - before).toBeLessThan(40);
    seq.stop();
  });
});

describe('треки движка (tracks.ts)', () => {
  function setup() {
    const c = new FakeCtx();
    const ctx = c as unknown as BaseAudioContext;
    const made: FakeNode[] = [];
    const orig = c.createGain.bind(c);
    (c as unknown as { createGain: () => FakeNode }).createGain = () => {
      const n = orig();
      made.push(n);
      return n;
    };
    const music = c.createGain();
    const amb = c.createGain();
    return { ctx, made, music, amb, nb: makeNoiseBank(ctx, 0.05), env: fakeEnv() };
  }
  it("'level' с выключенным лупом («Музыка в уровнях» выкл.) — только фон темы: ни оркестра, ни секвенсора", () => {
    const { ctx, made, music, amb, nb, env } = setup();
    const h = startTrack(ctx, nb, music as unknown as AudioNode, amb as unknown as AudioNode, 'level', 'snow', { at: 0, fadeIn: 0.6, timers: env.timers, levelMusic: false });
    expect(h.music).toBe(false);
    expect(made.some((n) => n.outs.has(music))).toBe(false);
    expect(made.some((n) => n.outs.has(amb))).toBe(true);
    expect(env.pending()).toBe(0); // у снега нет событий фона, секвенсора нет — таймеров нет
    h.stop(0.1);
    env.run(1000);
    expect(env.pending()).toBe(0);
  });
  it('луп уровня по умолчанию включён, тише польки на ≥ 6 дБ; полька — тише прежнего (кнопки меню над музыкой)', () => {
    expect(LEVEL_MUSIC).toBe(true);
    expect(20 * Math.log10(TRACK_GAIN.level / TRACK_GAIN.menu)).toBeLessThanOrEqual(-6);
    const { ctx, made, music, amb, nb, env } = setup();
    const h = startTrack(ctx, nb, music as unknown as AudioNode, amb as unknown as AudioNode, 'level', 'snow', { at: 0, fadeIn: 0.6, timers: env.timers });
    expect(h.music).toBe(true);
    expect(made.some((n) => n.outs.has(music))).toBe(true);
    expect(env.pending()).toBe(1);
    h.stop(0.1);
    env.run(1000);
    expect(env.pending()).toBe(0);
    expect(TRACK_GAIN.menu).toBeCloseTo(0.45, 9);
    expect(20 * Math.log10(TRACK_GAIN.menu / 0.8)).toBeCloseTo(-5, 0);
  });
});
