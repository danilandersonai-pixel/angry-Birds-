// Карта «событие → звуки» (05-audio §7): чистая функция planFrame без Web Audio.
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../src/core/events';
import type { BirdType } from '../../src/core/types';
import { soundDef } from '../../src/audio/catalog';
import {
  allPlannedKeys, CRACK_GAP_S, CRACKS_PER_FRAME, createPlanState, type Cue, DEFAULT_GRUNT_PIGS, DENSE_VOICES, densityGain, FUSE_MS,
  type FrameEvent, gruntPig, IdleGrunts, impactKey, laughVoices, planFrame, type PlanEnv, type PlayCue, REWARD_KEYS, sizeRate,
  TICK_ROLL_S, TickProgress, UI_KEYS,
} from '../../src/audio/mapping';
import { ABILITY } from '../../src/config/constants';

const VIEW = { camX: 10, viewW: 20 };
const rnd0 = (): number => 0;
const plays = (cues: Cue[]): PlayCue[] => cues.filter((c): c is PlayCue => c.op === 'play');
const keys = (cues: Cue[]): string[] => plays(cues).map((c) => c.key);
function run(evs: GameEvent[], st = createPlanState(), now = 0, rnd = rnd0, voices?: (c: string) => number, hasTag?: PlanEnv['hasTag']): Cue[] {
  const batch: FrameEvent[] = evs.map((e) => ({ e, l: VIEW }));
  return planFrame(batch, st, { now, rnd, ...(voices ? { voices } : {}), ...(hasTag ? { hasTag } : {}) });
}

describe('planFrame: рогатка и птицы', () => {
  it('birdLoaded → прыжок + реплика выбора через 0.2 с', () => {
    const c = plays(run([{ type: 'birdLoaded', bird: 'chuck' }]));
    expect(c.map((q) => q.key)).toEqual(['hop', 'select:chuck']);
    expect(c[1]!.delay).toBeCloseTo(0.2, 9);
    expect(c[1]!.cat).toBe('birdVox');
  });
  it('натяжение: скрип с параметром power; ослабление — вдвое тише', () => {
    const st = createPlanState();
    run([{ type: 'aimStart', bird: 'red' }], st);
    const a = plays(run([{ type: 'aimStretch', power: 0.7 }], st))[0]!;
    expect(a.key).toBe('slingStretch');
    expect(a.param).toBeCloseTo(0.7, 9);
    expect(a.gain).toBe(1);
    const b = plays(run([{ type: 'aimStretch', power: 0.4 }], st))[0]!;
    expect(b.gain).toBe(0.5);
  });
  it('выстрел: сильный/слабый щелчок по power + крик птицы через 40 мс', () => {
    const hi = plays(run([{ type: 'birdLaunched', id: 1, bird: 'bomb', x: 0, y: 2, power: 0.9 }]));
    expect(hi.map((q) => q.key)).toEqual(['slingRelease:hi', 'launch:bomb']);
    expect(hi[1]!.delay).toBeCloseTo(0.04, 9);
    const lo = keys(run([{ type: 'birdLaunched', id: 1, bird: 'red', x: 0, y: 2, power: 0.3 }]));
    expect(lo[0]).toBe('slingRelease:lo');
  });
  it('выстрел слышен всегда, даже если рогатка за кадром', () => {
    const q = plays(run([{ type: 'birdLaunched', id: 1, bird: 'red', x: -100, y: 2, power: 1 }]));
    expect(q[0]!.gain).toBeGreaterThanOrEqual(0.6);
  });
  it('способности: у Ред и Теренса звука нет, у Хэла — живой с длиной дуги', () => {
    const ab = (bird: BirdType): string[] => keys(run([{ type: 'ability', id: 1, bird, x: 10, y: 5 }]));
    expect(ab('red')).toEqual([]);
    expect(ab('terence')).toEqual([]);
    expect(ab('chuck')).toEqual(['ab:chuck']);
    expect(ab('blues')).toEqual(['ab:blues']);
    expect(ab('matilda')).toEqual(['ab:matilda']);
    expect(ab('silver')).toEqual(['ab:silver']);
    const hal = plays(run([{ type: 'ability', id: 1, bird: 'hal', x: 10, y: 5 }]))[0]!;
    expect(hal.key).toBe('ab:hal');
    expect(hal.param).toBe(1000);
  });
  it('удар птицы: «уф» + перья; у Бомба зажигается фитиль, гаснет при исчезновении', () => {
    const st = createPlanState();
    const c = plays(run([{ type: 'birdImpact', id: 7, bird: 'bomb', x: 10, y: 1, speed: 9 }], st));
    expect(c.map((q) => q.key)).toEqual(['hurt:bomb', 'feather', 'fuse']);
    expect(c[2]!.tag).toBe('fuse:7');
    expect(c[2]!.param).toBe(FUSE_MS);
    // второй удар той же птицы фитиль не дублирует
    expect(keys(run([{ type: 'birdImpact', id: 7, bird: 'bomb', x: 10, y: 1, speed: 9 }], st))).not.toContain('fuse');
    const r = run([{ type: 'birdRemoved', id: 7, bird: 'bomb', x: 10, y: 1 }], st);
    expect(keys(r)).toEqual(['puff']);
    expect(r).toContainEqual({ op: 'stop', tag: 'fuse:7' });
    expect(st.fuses.size).toBe(0);
  });
  it('фитиль длится ровно до автоподрыва ядра (ABILITY.BOMB.FUSE)', () => {
    expect(FUSE_MS).toBe(ABILITY.BOMB.FUSE * 1000);
  });
  it('фитиль, который уже не звучит (доиграл, пауза, рестарт), не мешает зажечь новый той же птице', () => {
    const st = createPlanState();
    const live = new Set<string>();
    const hit = (): string[] => keys(run([{ type: 'birdImpact', id: 3, bird: 'bomb', x: 10, y: 1, speed: 9 }], st, 0, rnd0, undefined, (t) => live.has(t)));
    expect(hit()).toContain('fuse');
    live.add('fuse:3');
    expect(hit()).not.toContain('fuse'); // ещё горит — не дублируем
    live.delete('fuse:3'); // голос погас (новая сессия с тем же id тела)
    expect(hit()).toEqual(['hurt:bomb', 'feather', 'fuse']);
  });
  it('тап Бомба: «надувание» и фитиль гаснет; взрыв тоже гасит фитиль и приглушает музыку', () => {
    const st = createPlanState();
    run([{ type: 'birdImpact', id: 3, bird: 'bomb', x: 10, y: 1, speed: 9 }], st);
    const tap = run([{ type: 'ability', id: 3, bird: 'bomb', x: 10, y: 1 }], st);
    expect(keys(tap)).toEqual(['ab:bombSwell']);
    expect(tap).toContainEqual({ op: 'stop', tag: 'fuse:3' });
    run([{ type: 'birdImpact', id: 4, bird: 'bomb', x: 10, y: 1, speed: 9 }], st);
    const boom = run([{ type: 'explosion', x: 10, y: 1, radius: 3.5, source: 'bomb' }], st);
    expect(keys(boom)).toEqual(['boom:bomb']);
    expect(boom).toContainEqual({ op: 'duck' });
    expect(boom).toContainEqual({ op: 'stop', tag: 'fuse:4' });
    expect(plays(boom)[0]!.send).toBe(0.25);
  });
});

describe('planFrame: удары', () => {
  it('ключ удара по поверхности и ярусу', () => {
    expect(impactKey('wood', 0.1)?.key).toBe('woodHit:0');
    expect(impactKey('ice', 0.5)?.key).toBe('iceHit:1');
    expect(impactKey('stone', 0.9)?.key).toBe('stoneHit:2');
    expect(impactKey('ground', 0.5)?.key).toBe('ground:0');
    expect(impactKey('ground', 0.8)?.key).toBe('ground:1');
    expect(impactKey('pig', 1)?.key).toBe('pigBump');
    expect(impactKey('tnt', 0.5)?.key).toBe('woodHit:1');
    expect(impactKey('bird', 1)).toBeNull();
    expect(impactKey('egg', 1)).toBeNull();
  });
  it('громкость растёт с импульсом', () => {
    const g = (J: number): number => plays(run([{ type: 'impact', x: 10, y: 0, impulse: J, a: 'wood', b: 'bird' }]))[0]!.gain;
    expect(g(2)).toBeLessThan(g(8));
    expect(g(8)).toBeLessThan(g(16));
    expect(g(16)).toBeCloseTo(1, 9);
  });
  it('громкость падает с удалённостью от камеры; панорама по стороне', () => {
    const q = (x: number): PlayCue => plays(run([{ type: 'impact', x, y: 0, impulse: 16, a: 'stone', b: 'bird' }]))[0]!;
    expect(q(10).gain).toBeCloseTo(1, 9);
    expect(q(30).gain).toBeCloseTo(0.25, 9);
    expect(plays(run([{ type: 'impact', x: 40, y: 0, impulse: 16, a: 'stone', b: 'bird' }])).every((c) => c.gain === 0)).toBe(true);
    expect(q(-5).pan).toBeLessThan(0);
    expect(q(25).pan).toBeGreaterThan(0);
  });
  it('вторая поверхность ×0.6; размер блока задаёт высоту', () => {
    const c = plays(run([{ type: 'impact', x: 10, y: 0, impulse: 16, a: 'wood', b: 'stone', size: 2 }]));
    // ярус тембра — по силе удара, громкость второй поверхности ×0.6
    expect(c.map((q) => q.key)).toEqual(['woodHit:2', 'stoneHit:2']);
    expect(c[1]!.gain).toBeLessThan(c[0]!.gain);
    expect(c[0]!.rate).toBeLessThan(1);
    expect(sizeRate(1.5)).toBeCloseTo(1.5 ** -0.4, 9);
    expect(sizeRate(4)).toBe(0.8);
    expect(sizeRate(0.25)).toBe(1.25);
    expect(sizeRate(undefined)).toBe(1);
    expect(sizeRate(Number.NaN)).toBe(1);
  });
  it('шторм: ≤ 4 удара в кадр, ≤ 2 на ключ, лишняя энергия → один слой обломков', () => {
    const evs: GameEvent[] = Array.from({ length: 30 }, (_, k) => ({ type: 'impact', x: 10, y: 0, impulse: 2 + k / 2, a: 'wood', b: 'ground' }));
    const c = plays(run(evs));
    const hits = c.filter((q) => q.cat === 'impact');
    expect(hits.length).toBeLessThanOrEqual(4);
    const per = new Map<string, number>();
    for (const q of hits) per.set(q.key, (per.get(q.key) ?? 0) + 1);
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(2);
    expect(c.filter((q) => q.key === 'rubble')).toHaveLength(1);
  });
  it('шторм 30×60 кадров через ведро токенов: ≤ 6 + 40 ударов за секунду', () => {
    const st = createPlanState();
    let n = 0;
    for (let f = 0; f < 60; f++) {
      const evs: GameEvent[] = Array.from({ length: 30 }, (_, k) => ({ type: 'impact', x: 10, y: 0, impulse: 3 + (k % 15), a: (['wood', 'ice', 'stone'] as const)[k % 3], b: 'bird' }));
      n += plays(run(evs, st, f / 60)).filter((q) => q.cat === 'impact').length;
    }
    expect(n).toBeLessThanOrEqual(46);
    expect(n).toBeGreaterThan(30);
  });
});

describe('planFrame: блоки, свиньи, конец уровня', () => {
  it('трещины по стадии, разрушение по материалу; ≥ 3 разрушений в кадре → обломки', () => {
    expect(keys(run([{ type: 'blockDamaged', id: 1, material: 'ice', x: 10, y: 1, stage: 2 }]))).toEqual(['iceCrack:2']);
    expect(keys(run([{ type: 'blockDamaged', id: 1, material: 'stone', x: 10, y: 1, stage: 9 }]))).toEqual(['stoneCrack:3']);
    const blk = (material: 'wood' | 'ice' | 'stone', w = 1, h = 1): GameEvent => ({
      type: 'blockDestroyed', id: 1, material, shape: 'rect', x: 10, y: 1, w, h, angle: 0, vx: 0, vy: 0, points: 500,
    });
    const c = plays(run([blk('wood', 2, 0.25), blk('ice'), blk('stone', 2, 2)]));
    expect(c.map((q) => q.key)).toEqual(['woodBreak', 'iceShatter', 'stoneBreak', 'rubble']);
    expect(c[0]!.send).toBe(0.12);
    // крупный камень ниже и громче мелкого льда
    expect(c[2]!.rate).toBeLessThan(c[1]!.rate);
    expect(c[2]!.gain).toBeGreaterThan(c[1]!.gain);
  });
  it('«уф» свиньи не чаще раза в 300 мс на свинью; каска звенит', () => {
    const st = createPlanState();
    const hurt = (now: number, helmetLost = false): string[] =>
      keys(run([{ type: 'pigDamaged', id: 5, pig: 'helmet', x: 10, y: 1, stage: 1, ...(helmetLost ? { helmetLost } : {}) }], st, now));
    expect(hurt(0)).toEqual(['pigHurt:helmet']);
    expect(hurt(0.1, true)).toEqual(['helmet']);
    expect(hurt(0.35)).toEqual(['pigHurt:helmet']);
  });
  it('цепная гибель свиней не превращается в хор: визг только у первых двух', () => {
    const evs: GameEvent[] = [1, 2, 3, 4].map((id) => ({ type: 'pigDestroyed', id, pig: 'small', x: 10, y: 1, radius: 0.5, points: 5000 }));
    expect(keys(run(evs, createPlanState(), 0, rnd0, () => 0))).toEqual(['pigPop:small', 'pigPop:small', 'pigPopQuiet', 'pigPopQuiet']);
    // если голоса свиней уже заняты — сразу тихий «поп»
    expect(keys(run(evs.slice(0, 1), createPlanState(), 0, rnd0, () => 2))).toEqual(['pigPopQuiet']);
  });
  it('TNT: треск ящика; сам взрыв — отдельным событием', () => {
    const c = plays(run([{ type: 'tntDestroyed', id: 1, x: 10, y: 1, points: 500 }]));
    expect(c.map((q) => q.key)).toEqual(['woodBreak']);
    expect(c[0]!.rate).toBeCloseTo(0.85, 9);
  });
  it('взрыв далеко за кадром всё равно слышен (не тише 0.3)', () => {
    const q = plays(run([{ type: 'explosion', x: 200, y: 1, radius: 3, source: 'tnt' }]))[0]!;
    expect(q.key).toBe('boom:tnt');
    expect(q.gain).toBeGreaterThanOrEqual(0.3);
  });
  it('смех: голоса живых свиней (король первым), иначе — стандартный хор', () => {
    expect(laughVoices(['small', 'king', 'small'], () => 0.99)).toEqual(['king', 'small']);
    expect(laughVoices(undefined, () => 0.99)).toEqual(['medium', 'small', 'large']);
    expect(laughVoices([], () => 0)).toEqual(['medium']);
    const c = plays(run([{ type: 'pigsLaugh', pigs: ['mustache', 'large'] }], createPlanState(), 0, () => 0.99));
    expect(c.map((q) => q.key)).toEqual(['pigLaugh:mustache', 'pigLaugh:large']);
    expect(c[1]!.delay).toBeGreaterThanOrEqual(0.09);
  });
  it('смех звучит справа (свиньи за рогаткой справа): одна свинья не уходит влево', () => {
    const one = plays(run([{ type: 'pigsLaugh', pigs: ['king'] }], createPlanState(), 0, () => 0));
    expect(one).toHaveLength(1);
    expect(one[0]!.pan).toBeGreaterThan(0);
    const three = plays(run([{ type: 'pigsLaugh' }], createPlanState(), 0, () => 0.99));
    expect(three.map((q) => q.pan)).toEqual([0.15, 0.3, 0.45].map((x) => expect.closeTo(x, 9)));
  });
  it('хрюк «от скуки» — у свиней этого уровня (pigsLaugh.pigs, pigDamaged), иначе обычный хор', () => {
    const st = createPlanState();
    expect(DEFAULT_GRUNT_PIGS).toContain(gruntPig(st, () => 0.5));
    run([{ type: 'pigDamaged', id: 1, pig: 'king', x: 10, y: 1, stage: 1 }], st);
    for (const r of [0, 0.5, 0.99]) expect(gruntPig(st, () => r)).toBe('king');
    run([{ type: 'pigsLaugh', pigs: ['helmet', 'helmet'] }], st);
    expect(gruntPig(st, () => 0.7)).toBe('helmet');
    run([{ type: 'pigDamaged', id: 2, pig: 'mustache', x: 10, y: 1, stage: 1 }], st);
    expect(new Set([0, 0.99].map((r) => gruntPig(st, () => r)))).toEqual(new Set(['helmet', 'mustache']));
  });
  it('бонус: номер «динь» растёт с каждой птицей и сбрасывается при входе в bonus', () => {
    const st = createPlanState();
    const b = (): number => plays(run([{ type: 'birdBonus', bird: 'red', x: 0, y: 0, points: 10000 }], st)).find((q) => q.key === 'bonus')!.param!;
    run([{ type: 'stateChanged', from: 'settling', to: 'bonus' }], st);
    expect([b(), b(), b()]).toEqual([0, 1, 2]);
    run([{ type: 'stateChanged', from: 'won', to: 'bonus' }], st);
    expect(b()).toBe(0);
  });
  it('levelEnd гасит фитили и отдаёт команду джингла', () => {
    const st = createPlanState();
    run([{ type: 'birdImpact', id: 9, bird: 'bomb', x: 10, y: 1, speed: 9 }], st);
    const c = run([{ type: 'levelEnd', won: false, score: 0, stars: 0 }], st);
    expect(c).toContainEqual({ op: 'stop', tag: 'fuse:9' });
    expect(c).toContainEqual({ op: 'levelEnd', won: false });
  });
  it('score — только визуал', () => {
    expect(run([{ type: 'score', points: 500, x: 1, y: 1, kind: 'block' }])).toEqual([]);
  });
});

describe('planFrame: массовые обрушения без «каши»', () => {
  const crack = (id: number, stage: number, material: 'wood' | 'ice' | 'stone' = 'wood', x = 10): GameEvent => ({ type: 'blockDamaged', id, material, x, y: 1, stage });
  const broke = (id: number, material: 'wood' | 'ice' | 'stone' = 'wood'): GameEvent => ({
    type: 'blockDestroyed', id, material, shape: 'rect', x: 10, y: 1, w: 2, h: 0.25, angle: 0, vx: 0, vy: 0, points: 500,
  });
  it('блок, разрушенный в том же кадре, не трещит — звучит только разрушение', () => {
    expect(keys(run([crack(1, 3), broke(1)]))).toEqual(['woodBreak']);
    // трещина другого блока остаётся
    expect(keys(run([crack(1, 3), crack(2, 1), broke(1)]))).toEqual(['woodBreak', 'woodCrack:1']);
  });
  it(`трещина одного блока — не чаще раза в ${CRACK_GAP_S * 1000} мс; две стадии в одном кадре — одна, старшая`, () => {
    const st = createPlanState();
    expect(keys(run([crack(1, 1), crack(1, 2)], st, 0))).toEqual(['woodCrack:2']);
    expect(keys(run([crack(1, 3)], st, 0.1))).toEqual([]);
    expect(keys(run([crack(1, 3)], st, 0.15))).toEqual(['woodCrack:3']);
    // разрушение забывает блок; новая сессия — тоже
    run([broke(1)], st, 0.2);
    expect(st.crackAt.has(1)).toBe(false);
    expect(keys(run([crack(7, 1)], createPlanState(), 0))).toEqual(['woodCrack:1']);
  });
  it(`не больше ${CRACKS_PER_FRAME} трещин в кадр: старшие стадии и ближние к камере`, () => {
    const c = keys(run([crack(1, 1), crack(2, 3, 'ice'), crack(3, 2, 'stone'), crack(4, 3, 'wood', 200), crack(5, 1)]));
    expect(c).toEqual(['iceCrack:3', 'stoneCrack:2']);
  });
  it(`плотность: сверх ${DENSE_VOICES} звучащих ударов и трещин новые тише в √(N/n) раз, разрушения — нет`, () => {
    expect(densityGain(0)).toBe(1);
    expect(densityGain(DENSE_VOICES)).toBe(1);
    expect(20 * Math.log10(densityGain(2 * DENSE_VOICES))).toBeCloseTo(-3.01, 1);
    expect(20 * Math.log10(densityGain(4 * DENSE_VOICES))).toBeCloseTo(-6.02, 1);
    const evs: GameEvent[] = [{ type: 'impact', x: 10, y: 1, impulse: 10, a: 'wood', b: 'ground' }, crack(1, 2), broke(2)];
    const quiet = plays(run(evs, createPlanState(), 0, rnd0, () => 0));
    const busy = plays(run(evs, createPlanState(), 0, rnd0, (c) => (c === 'impact' || c === 'break' ? 6 : 0)));
    const g = (cs: PlayCue[], k: string): number => cs.find((q) => q.key.startsWith(k))!.gain;
    expect(g(busy, 'woodHit')).toBeLessThan(g(quiet, 'woodHit') * 0.75);
    expect(g(busy, 'woodCrack')).toBeLessThan(g(quiet, 'woodCrack') * 0.75);
    expect(g(busy, 'woodBreak')).toBe(g(quiet, 'woodBreak'));
    // важность удара для кражи голоса — по силе, а не по приглушённой громкости
    expect(busy.find((q) => q.key.startsWith('woodHit'))!.score).toBe(quiet.find((q) => q.key.startsWith('woodHit'))!.score);
  });
});

describe('каталог покрывает все ключи карты и UI', () => {
  it('каждый ключ, который может запросить planFrame, есть в каталоге', () => {
    for (const k of allPlannedKeys()) expect(soundDef(k), k).toBeDefined();
  });
  it('UI-имена контракта и награды есть в каталоге', () => {
    for (const k of Object.values(UI_KEYS)) expect(soundDef(k), k).toBeDefined();
    for (const k of Object.values(REWARD_KEYS)) expect(soundDef(k), k).toBeDefined();
    for (const n of ['click', 'back', 'pop', 'swoosh', 'star1', 'star2', 'star3', 'tick', 'win', 'lose', 'newRecord'] as const) expect(UI_KEYS[n]).toBeTruthy();
    expect(soundDef(UI_KEYS.win)!.bus).toBe('music');
    expect(soundDef(UI_KEYS.lose)!.bus).toBe('music');
  });
  it('«уровень зачищен»: ключ cleared — награда (шина ui, выключается вместе со звуками), ≈ 0.85 с', () => {
    const d = soundDef('cleared')!;
    expect(UI_KEYS.cleared).toBe('cleared');
    expect(d.cat).toBe('reward');
    expect(d.bus).toBeUndefined();
    expect(d.expectMs).toBeGreaterThanOrEqual(700);
    expect(d.expectMs).toBeLessThanOrEqual(1000);
  });
});

describe('вспомогательные таймеры', () => {
  it('TickProgress: тон следует за прокруткой счёта 1.2 с и доходит до 3000 Гц; пауза > 0.3 с сбрасывает', () => {
    const t = new TickProgress();
    // тики UI раз в ~60 мс всю прокрутку (07-ui-ux §12.5: 1.2 с)
    const ps: number[] = [];
    for (let at = 0; at < 1.2; at += 0.061) ps.push(t.next(at));
    expect(ps[0]).toBe(0);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeGreaterThanOrEqual(ps[i - 1]!);
    expect(ps[ps.length - 1]!).toBeGreaterThan(0.999);
    expect(t.next(5)).toBe(0);
    // укороченная анимация (0.5 с): всё равно высоко, ≈ 2750 Гц
    let p = 0;
    for (let at = 5; at < 5.5; at += 0.061) p = t.next(at);
    expect(1800 + 1200 * p).toBeGreaterThan(2650);
    expect(TICK_ROLL_S).toBeLessThan(1.2);
  });
  it('IdleGrunts: хрюк только в ready/aiming, раз в 7–14 с', () => {
    const g = new IdleGrunts();
    expect(g.due(100, rnd0)).toBe(false);
    g.onState('ready', 0, rnd0);
    expect(g.due(3.9, rnd0)).toBe(false);
    expect(g.due(4, rnd0)).toBe(true);
    expect(g.due(10.9, rnd0)).toBe(false);
    expect(g.due(11, rnd0)).toBe(true);
    g.onState('flying', 12, rnd0);
    expect(g.due(100, rnd0)).toBe(false);
  });
});
