// AudioEngine целиком на строгой подделке Web Audio: тишина без жеста, разблокировка, все рецепты каталога
// исполняются без ошибок параметров, кулдауны и лимит голосов на уровне движка, переключатели и джинглы.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { SOUND_LIST } from '../../src/audio/catalog';
import { FUSE_MS } from '../../src/audio/mapping';
import { MAX_VOICES, MAX_VOICES_MOBILE } from '../../src/audio/mix';
import type { UIAudio } from '../../src/ui/ctx';
import { FakeCtx, type FakeNode, fakeWindow } from './fakeAudio';

// Движок подходит под интерфейс звука, который ждёт UI (проверка на этапе компиляции).
export const uiAudioCompat = (e: AudioEngine): UIAudio => e;

let listeners: Map<string, Set<() => void>>;
let active = true;
const engines: AudioEngine[] = [];
const flush = (): Promise<void> => new Promise((r) => queueMicrotask(r));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Телефон: движок выбирает мобильные лимиты по matchMedia('(pointer: coarse)'). */
const asPhone = (): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('coarse') }));
};
/** Внутренности движка, которые проверяют тесты (граф шин). */
const graphOf = (e: AudioEngine): { sfx: FakeNode; music: FakeNode } => (e as unknown as { g: { sfx: FakeNode; music: FakeNode } }).g;
/** Записывать все GainNode контекста — чтобы проверить, какие из них ещё подключены к шине. */
function recordGains(c: FakeCtx): FakeNode[] {
  const made: FakeNode[] = [];
  const orig = c.createGain.bind(c);
  (c as unknown as { createGain: () => FakeNode }).createGain = () => {
    const n = orig();
    made.push(n);
    return n;
  };
  return made;
}
/** Сколько голосов прибавилось/получило отказ при вызове fn. */
function delta(e: AudioEngine, fn: () => void): { played: number; limited: number } {
  const a = e.stats().pool;
  fn();
  const b = e.stats().pool;
  return { played: b.played - a.played, limited: b.limited - a.limited };
}

function make(opts: ConstructorParameters<typeof AudioEngine>[0] = {}): AudioEngine {
  const e = new AudioEngine(opts);
  engines.push(e);
  return e;
}
function ctxOf(e: AudioEngine): FakeCtx {
  return e.context as unknown as FakeCtx;
}
async function unlocked(opts: ConstructorParameters<typeof AudioEngine>[0] = {}): Promise<{ e: AudioEngine; c: FakeCtx }> {
  const e = make(opts);
  await e.unlock();
  return { e, c: ctxOf(e) };
}

beforeEach(() => {
  FakeCtx.instances = 0;
  FakeCtx.rate = 48000;
  FakeCtx.allowResume = true;
  active = true;
  const w = fakeWindow();
  listeners = w.listeners;
  vi.stubGlobal('window', w.win);
  vi.stubGlobal('navigator', { userActivation: { get isActive() { return active; } } });
});
afterEach(() => {
  for (const e of engines.splice(0)) e.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('без жеста — тишина и никаких ошибок', () => {
  it('конструктор не создаёт AudioContext, а взводит слушатели жеста', () => {
    const e = make();
    expect(FakeCtx.instances).toBe(0);
    expect(e.ready).toBe(false);
    for (const t of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) expect(listeners.get(t)?.size).toBe(1);
  });
  it('все методы до разблокировки молча ничего не делают', async () => {
    const warn = vi.spyOn(console, 'warn');
    const err = vi.spyOn(console, 'error');
    const e = make();
    e.playMusic('menu');
    e.setPaused(true);
    e.setSfx(false);
    e.setSfx(true);
    e.setMusic(false);
    e.setMusic(true);
    e.setMasterVolume(0.5);
    e.handle({ type: 'impact', x: 1, y: 1, impulse: 10, a: 'wood', b: 'bird' }, { camX: 0, viewW: 20 });
    e.ui('click');
    e.ui('win');
    e.reward('star0');
    e.scoreTick(0.5);
    expect(e.play('woodHit:1')).toBe(false);
    await flush();
    expect(FakeCtx.instances).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
  it('unlock() без активации пользователем не создаёт контекст (Chrome иначе пишет предупреждение)', async () => {
    active = false;
    const e = make();
    await e.unlock();
    expect(FakeCtx.instances).toBe(0);
    expect(e.ready).toBe(false);
  });
  it('без Web Audio вообще — тоже без исключений', async () => {
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    const e = make();
    await e.unlock();
    e.ui('click');
    expect(e.ready).toBe(false);
  });
});

describe('разблокировка', () => {
  it('первый жест создаёт и запускает контекст, слушатели снимаются; музыка, заказанная заранее, стартует', async () => {
    const e = make();
    e.playMusic('menu');
    for (const fn of [...listeners.get('pointerdown')!]) fn();
    await flush();
    await flush();
    expect(FakeCtx.instances).toBe(1);
    expect(e.ready).toBe(true);
    expect(listeners.get('pointerdown')?.size ?? 0).toBe(0);
    expect(e.stats().music).toBe('menu');
  });
  it('повторный unlock не создаёт второй контекст', async () => {
    const { e } = await unlocked();
    await e.unlock();
    expect(FakeCtx.instances).toBe(1);
  });
  it('вкладка скрыта — контекст спит; вернулась, а resume не отпустили (iOS) — снова ждём жеста', async () => {
    const docL = new Map<string, () => void>();
    const doc = { hidden: false, addEventListener: (t: string, fn: () => void) => docL.set(t, fn), removeEventListener: () => undefined };
    vi.stubGlobal('document', doc);
    const { e, c } = await unlocked();
    doc.hidden = true;
    docL.get('visibilitychange')!();
    await flush();
    expect(c.state).toBe('suspended');
    expect(listeners.get('pointerdown')?.size ?? 0).toBe(0); // своя приостановка — жест не нужен
    FakeCtx.allowResume = false;
    doc.hidden = false;
    docL.get('visibilitychange')!();
    await flush();
    await flush();
    expect(listeners.get('pointerdown')?.size).toBe(1);
    FakeCtx.allowResume = true;
    for (const fn of [...listeners.get('pointerdown')!]) fn();
    await flush();
    expect(e.ready).toBe(true);
  });
  it('настройки из конструктора применяются: музыка выключена — трек не стартует', async () => {
    const { e } = await unlocked({ music: false });
    e.playMusic('menu');
    expect(e.stats().music).toBeNull();
    e.setMusic(true);
    expect(e.stats().music).toBe('menu');
  });
});

describe('все звуки каталога исполняются живым синтезом без ошибок параметров', () => {
  it.each([48000, 32000])('каждый ключ и крайние значения параметров, %i Гц', async (rate) => {
    FakeCtx.rate = rate;
    const warn = vi.spyOn(console, 'warn');
    const { e, c } = await unlocked();
    for (const d of SOUND_LIST) {
      for (const param of [0, 0.5, 1, 3000]) {
        c.currentTime += 10; // предыдущие голоса закончились, кулдауны истекли
        const before = c.sources;
        expect(e.play(d.key, { param }), d.key).toBe(true);
        expect(c.sources, d.key).toBeGreaterThan(before);
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });
  it('музыка меню и уровня для всех тем, пауза, смена треков', async () => {
    const { e } = await unlocked();
    e.playMusic('menu');
    expect(e.stats().music).toBe('menu');
    e.playMusic('menu'); // тот же трек — без перезапуска
    for (const th of ['meadow', 'beach', 'snow'] as const) {
      e.playMusic('level', th);
      expect(e.stats().music).toBe('level');
    }
    e.setPaused(true);
    e.setPaused(false);
    e.playMusic(null);
    expect(e.stats().music).toBeNull();
  });
});

describe('музыка в уровнях (настройка)', () => {
  it('по умолчанию в уровне звучит луп темы; setLevelMusic(false) оставляет только фон, true — возвращает луп', async () => {
    const { e } = await unlocked();
    e.playMusic('level', 'beach');
    expect(e.stats().levelLoop).toBe(true);
    e.setLevelMusic(false);
    expect(e.stats().music).toBe('level');
    expect(e.stats().levelLoop).toBe(false);
    e.setLevelMusic(true);
    expect(e.stats().levelLoop).toBe(true);
    // в меню настройка ничего не перезапускает
    e.playMusic('menu');
    e.setLevelMusic(false);
    expect(e.stats().music).toBe('menu');
    e.playMusic('level', 'snow');
    expect(e.stats().levelLoop).toBe(false);
  });
  it('настройка из конструктора: levelMusic: false — только фон темы', async () => {
    const { e } = await unlocked({ levelMusic: false });
    e.playMusic('level', 'meadow');
    expect(e.stats().levelLoop).toBe(false);
  });
});

describe('микс на уровне движка', () => {
  it('кулдаун: тот же звук дважды в одно мгновение звучит один раз', async () => {
    const { e } = await unlocked();
    expect(e.play('woodHit:1')).toBe(true);
    expect(e.play('woodHit:1')).toBe(false);
    expect(e.stats().pool.cooldown).toBe(1);
  });
  it(`лимит голосов: одновременно звучит не больше ${MAX_VOICES}`, async () => {
    const { e } = await unlocked();
    for (const d of SOUND_LIST) e.play(d.key, { param: 0.5 });
    const s = e.stats();
    expect(s.voices).toBeLessThanOrEqual(MAX_VOICES);
    expect(s.pool.limited + s.pool.stolen).toBeGreaterThan(0);
  });
  it('шторм ударов через handle(): в кадр звучит ≤ 4 удара + обломки', async () => {
    const { e, c } = await unlocked();
    const view = { camX: 10, viewW: 20 };
    for (let k = 0; k < 30; k++) e.handle({ type: 'impact', x: 10, y: 0, impulse: 2 + k / 2, a: (['wood', 'ice', 'stone'] as const)[k % 3], b: 'ground' }, view);
    await flush();
    const s = e.stats();
    expect(s.voices).toBeLessThanOrEqual(5);
    expect(s.voices).toBeGreaterThanOrEqual(3);
    expect(c.state).toBe('running');
  });
  it('удар далеко за кадром не тратит голос', async () => {
    const { e } = await unlocked();
    e.handle({ type: 'impact', x: 500, y: 0, impulse: 16, a: 'stone', b: 'bird' }, { camX: 0, viewW: 20 });
    await flush();
    expect(e.stats().voices).toBe(0);
  });
  it('фитиль Бомба гаснет при взрыве', async () => {
    const { e } = await unlocked();
    e.handle({ type: 'birdImpact', id: 1, bird: 'bomb', x: 0, y: 0, speed: 9 });
    await flush();
    const withFuse = e.stats().voices;
    e.handle({ type: 'explosion', x: 0, y: 0, radius: 3.5, source: 'bomb' });
    await flush();
    // фитиль ушёл, пришёл взрыв: число голосов не выросло
    expect(e.stats().voices).toBeLessThanOrEqual(withFuse);
  });
});

describe('переключатели и джинглы', () => {
  it('звуки выключены — события и UI молчат, но джингл (музыка) звучит', async () => {
    const { e } = await unlocked();
    e.setSfx(false);
    e.handle({ type: 'impact', x: 0, y: 0, impulse: 16, a: 'wood', b: 'bird' });
    e.ui('click');
    await flush();
    expect(e.stats().pool.played).toBe(0);
    e.handle({ type: 'levelEnd', won: true, score: 1, stars: 3 });
    await flush();
    expect(e.stats().pool.played).toBe(1);
  });
  it('музыка выключена — джинглов нет, UI-звуки есть', async () => {
    const { e } = await unlocked({ music: false });
    e.handle({ type: 'levelEnd', won: false, score: 0, stars: 0 });
    await flush();
    e.ui('win');
    expect(e.stats().pool.played).toBe(0);
    e.ui('click');
    expect(e.stats().pool.played).toBe(1);
  });
  it('джингл после levelEnd не дублируется вызовом ui("win") из экрана победы', async () => {
    const { e } = await unlocked();
    e.playMusic('level', 'beach');
    e.handle({ type: 'levelEnd', won: true, score: 1, stars: 2 });
    await flush();
    e.ui('win');
    expect(e.stats().pool.played).toBe(1);
    expect(e.stats().music).toBeNull();
  });
  it('все UI-имена контракта звучат', async () => {
    const { e, c } = await unlocked();
    for (const n of ['click', 'back', 'pop', 'swoosh', 'star1', 'star2', 'star3', 'tick', 'win', 'lose', 'newRecord'] as const) {
      c.currentTime += 5;
      const before = e.stats().pool.played;
      e.ui(n);
      expect(e.stats().pool.played, n).toBe(before + 1);
    }
  });
});

describe('«уровень зачищен» (баннер победы)', () => {
  it("play('cleared') звучит; повтор раньше 1.5 с — нет; ui('cleared') — тот же звук; без звуков — тишина", async () => {
    const { e, c } = await unlocked();
    expect(e.play('cleared')).toBe(true);
    expect(e.play('cleared')).toBe(false);
    c.currentTime += 1.6;
    const before = e.stats().pool.played;
    e.ui('cleared');
    expect(e.stats().pool.played).toBe(before + 1);
    c.currentTime += 2;
    e.setSfx(false);
    expect(e.play('cleared')).toBe(false);
    e.setSfx(true);
    e.setMusic(false); // это не джингл — от музыки не зависит
    expect(e.play('cleared')).toBe(true);
  });
  it('на телефоне звучит и поверх обрушения (голоса наград — своя категория)', async () => {
    asPhone();
    const { e } = await unlocked();
    const view = { camX: 10, viewW: 20 };
    for (let k = 0; k < 30; k++) e.handle({ type: 'impact', x: 10, y: 0, impulse: 2 + k / 2, a: (['wood', 'ice', 'stone'] as const)[k % 3], b: 'ground' }, view);
    await flush();
    expect(e.play('cleared')).toBe(true);
  });
});

describe('телефон: лимиты 05-audio §6.1 и экран победы', () => {
  it('мобильный пул: 20 голосов; удары до 5', async () => {
    asPhone();
    const { e, c } = await unlocked();
    for (let i = 0; i < 40; i++) {
      e.play(i % 2 ? 'woodHit:1' : 'stoneHit:1', { param: 0.5 });
      c.currentTime += 0.031;
    }
    expect(e.stats().voices).toBeLessThanOrEqual(5);
    for (const d of ['launch:red', 'pigPop:small', 'boom:tnt', 'woodBreak', 'ui:click', 'star:0', 'fuse']) e.play(d);
    expect(e.stats().voices).toBeLessThanOrEqual(MAX_VOICES_MOBILE);
  });
  it('3 звезды + 20 тиков + «Новый рекорд»: на телефоне звучит всё (джингл — своя категория)', async () => {
    asPhone();
    const { e, c } = await unlocked();
    e.playMusic('level', 'meadow');
    c.currentTime = 10;
    expect(delta(e, () => e.handle({ type: 'levelEnd', won: true, score: 50000, stars: 3 })).played).toBe(0);
    await flush();
    expect(e.stats().pool.played).toBe(1); // джингл
    const T0 = 10.05;
    c.currentTime = T0;
    e.ui('win'); // кулдаун джингла — без повтора
    for (const [i, at] of [0.5, 0.95, 1.4].entries()) {
      c.currentTime = T0 + at;
      expect(delta(e, () => e.ui((['star1', 'star2', 'star3'] as const)[i]!)).played, `звезда ${i + 1}`).toBe(1);
    }
    let ticks = 0;
    let n = 0;
    for (let at = 1.65; at < 2.85; at += 0.061) {
      c.currentTime = T0 + at;
      n++;
      ticks += delta(e, () => e.ui('tick')).played;
    }
    expect(n).toBe(20);
    expect(ticks).toBe(20);
    c.currentTime = T0 + 2.85;
    expect(delta(e, () => e.ui('newRecord')).played).toBe(1);
    expect(e.stats().pool.limited).toBe(0);
  });
  it('бонус за 4 птицы, затем конец уровня: джингл победы на телефоне не теряется', async () => {
    asPhone();
    const { e, c } = await unlocked();
    c.currentTime = 20;
    e.handle({ type: 'stateChanged', from: 'flying', to: 'bonus' });
    await flush();
    for (let i = 0; i < 4; i++) {
      c.currentTime = 20 + 0.3 + 0.45 * i;
      e.handle({ type: 'birdBonus', bird: 'red', x: 0, y: 0, points: 10000 });
      await flush();
    }
    expect(e.stats().pool.limited).toBe(0);
    c.currentTime = 20 + 0.3 + 0.45 * 4 + 0.5;
    const before = e.stats().pool.played;
    e.handle({ type: 'levelEnd', won: true, score: 1, stars: 3 });
    await flush();
    expect(e.stats().pool.played).toBe(before + 1);
    // звёзды экрана итогов поверх хвостов бонуса тоже звучат
    for (let i = 0; i < 3; i++) {
      c.currentTime += 0.45;
      expect(delta(e, () => e.reward((['star0', 'star1', 'star2'] as const)[i]!)).played).toBe(1);
    }
  });
  it('колокольчик держит голос до −40 дБ (2/3 длины), а не до −60 дБ', async () => {
    const { e, c } = await unlocked();
    c.currentTime = 1;
    e.play('star:0');
    c.currentTime = 1 + 3.0;
    expect(e.stats().voices).toBe(1);
    c.currentTime = 1 + 3.5; // −60 дБ наступает через ≈ 4.8 с
    expect(e.stats().voices).toBe(0);
  });
});

describe('dispose() — навсегда', () => {
  it('после dispose жест не создаёт второй контекст, слушатели сняты, методы молчат', async () => {
    const docL = new Map<string, () => void>();
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: (t: string, fn: () => void) => docL.set(t, fn),
      removeEventListener: (t: string) => docL.delete(t),
    });
    const { e, c } = await unlocked();
    e.playMusic('menu');
    e.dispose();
    await flush();
    expect(c.state).toBe('closed');
    expect(e.context).toBeNull();
    expect(e.ready).toBe(false);
    for (const t of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) expect(listeners.get(t)?.size ?? 0, t).toBe(0);
    expect(docL.has('visibilitychange')).toBe(false);
    await e.unlock();
    e.ui('click');
    e.handle({ type: 'impact', x: 0, y: 0, impulse: 9, a: 'wood', b: 'bird' });
    await flush();
    expect(FakeCtx.instances).toBe(1);
    expect(e.stats().state).toBe('none');
    e.dispose(); // повторно — без ошибок
  });
  it('dispose до первого жеста: слушатели сняты, жест ничего не создаёт', async () => {
    const e = make();
    e.dispose();
    expect(listeners.get('pointerdown')?.size ?? 0).toBe(0);
    await e.unlock();
    expect(FakeCtx.instances).toBe(0);
  });
});

describe('отпущенные голоса отключаются от шины', () => {
  it('фитиль, погашенный паузой, и украденный удар не висят на шине sfx', async () => {
    const { e, c } = await unlocked();
    const made = recordGains(c);
    const bus = graphOf(e).sfx;
    const onBus = (): number => made.filter((n) => n.outs.has(bus)).length;
    c.currentTime = 5;
    e.handle({ type: 'birdImpact', id: 9, bird: 'bomb', x: 0, y: 0, speed: 9 });
    await flush();
    const withFuse = onBus();
    expect(withFuse).toBe(3); // «уф», перья, фитиль
    e.setPaused(true);
    await sleep(90);
    expect(onBus()).toBe(withFuse - 1);
    // кража: 8 тихих ударов, девятый громче — вытесняет самый тихий
    for (let i = 0; i < 8; i++) e.play(['woodHit:0', 'iceHit:0', 'stoneHit:0', 'ground:0', 'feather', 'pigBump', 'puff', 'pigPopQuiet'][i]!, { gain: 0.3 });
    const full = onBus();
    expect(e.play('stoneHit:2', { gain: 1 })).toBe(true);
    expect(e.stats().pool.stolen).toBe(1);
    await sleep(90);
    expect(onBus()).toBe(full); // новый подключён, украденный отключён
  });
  it('естественно доигравший голос отключается при освобождении места', async () => {
    const { e, c } = await unlocked();
    const made = recordGains(c);
    const bus = graphOf(e).sfx;
    c.currentTime = 1;
    e.play('woodHit:1');
    expect(made.filter((n) => n.outs.has(bus)).length).toBe(1);
    c.currentTime = 10;
    e.stats(); // prune
    expect(made.filter((n) => n.outs.has(bus)).length).toBe(0);
  });
});

describe('фитиль Бомба и новая сессия', () => {
  const bombHit = { type: 'birdImpact', id: 3, bird: 'bomb', x: 0, y: 0, speed: 9 } as const;
  it('рестарт посреди уровня: старое шипение гаснет, тот же id в новой сессии снова зажигает фитиль', async () => {
    const { e, c } = await unlocked();
    c.currentTime = 30;
    e.handle({ type: 'stateChanged', from: 'aiming', to: 'flying' });
    e.handle(bombHit);
    await flush();
    expect(e.stats().voices).toBe(3);
    c.currentTime = 30.05;
    // новый GameSession: первым приходит loading → ready (from ≠ последнему 'flying')
    e.handle({ type: 'stateChanged', from: 'loading', to: 'ready' });
    await flush();
    expect(e.stats().voices).toBe(2); // фитиль погашен, «уф» и перья доигрывают
    c.currentTime = 31;
    expect(delta(e, () => e.handle(bombHit)).played).toBe(0);
    await flush();
    expect(e.stats().pool.played).toBe(6); // снова «уф», перья и фитиль
  });
  it('фитиль, который доиграл сам, не блокирует новый (даже без события новой сессии)', async () => {
    const { e, c } = await unlocked();
    c.currentTime = 30;
    e.handle(bombHit);
    await flush();
    c.currentTime = 30 + FUSE_MS / 1000 + 1;
    e.handle(bombHit);
    await flush();
    expect(e.stats().pool.played).toBe(6);
  });
  it('выход в меню (смена трека) гасит фитиль; resetSession() — тоже', async () => {
    const { e, c } = await unlocked();
    e.playMusic('level', 'snow');
    c.currentTime = 30;
    e.handle(bombHit);
    await flush();
    e.playMusic('menu');
    expect(e.stats().voices).toBe(2);
    e.handle(bombHit);
    await flush();
    e.resetSession();
    expect(e.stats().voices).toBe(2);
  });
});

describe('музыка уровня и конец уровня', () => {
  it('в уровне — фон темы и тихий луп темы (ревью; было: без музыки, 00-summary №14, №32); в меню — полька', async () => {
    const { e } = await unlocked();
    e.playMusic('level', 'beach');
    expect((e as unknown as { track: { music: boolean } }).track.music).toBe(true);
    e.setLevelMusic(false);
    expect((e as unknown as { track: { music: boolean } }).track.music).toBe(false);
    e.playMusic('menu');
    expect((e as unknown as { track: { music: boolean } }).track.music).toBe(true);
  });
  it('после levelEnd рестарт с экрана итогов возвращает фон уровня той же темы', async () => {
    const { e, c } = await unlocked();
    e.playMusic('level', 'beach');
    e.handle({ type: 'stateChanged', from: 'loading', to: 'ready' });
    c.currentTime = 50;
    e.handle({ type: 'stateChanged', from: 'bonus', to: 'won' });
    e.handle({ type: 'levelEnd', won: true, score: 1, stars: 1 });
    await flush();
    expect(e.stats().music).toBeNull();
    e.handle({ type: 'stateChanged', from: 'loading', to: 'ready' }); // новый GameSession
    expect(e.stats().music).toBe('level');
    expect((e as unknown as { track: { theme: string } }).track.theme).toBe('beach');
  });
  it('явный playMusic после levelEnd отменяет возвращение фона', async () => {
    const { e } = await unlocked();
    e.playMusic('level', 'beach');
    e.handle({ type: 'stateChanged', from: 'loading', to: 'ready' });
    e.handle({ type: 'stateChanged', from: 'settling', to: 'lost' });
    e.handle({ type: 'levelEnd', won: false, score: 0, stars: 0 });
    await flush();
    e.playMusic(null);
    e.handle({ type: 'stateChanged', from: 'loading', to: 'ready' });
    expect(e.stats().music).toBeNull();
  });
});

describe('первый жест — без тяжёлой работы', () => {
  it('шумы готовятся в простое до жеста; в жесте граф строится без отклика реверба, IR ставится позже', async () => {
    const e = make();
    const prep = e as unknown as { prepNoise: { value: unknown } | null };
    expect(prep.prepNoise?.value).toBeNull(); // конструктор ничего тяжёлого не считает синхронно
    await vi.waitFor(() => expect(prep.prepNoise?.value).toBeTruthy(), { timeout: 3000, interval: 10 }); // простой
    await e.unlock();
    const g = (e as unknown as { g: { reverb: { buffer: unknown } } }).g;
    expect(g.reverb.buffer).toBeNull();
    await vi.waitFor(() => expect(g.reverb.buffer).not.toBeNull(), { timeout: 3000, interval: 5 });
  });
});
