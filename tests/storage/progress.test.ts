// Тесты сохранения прогресса: фейковое хранилище в памяти, без DOM.
import { describe, expect, it } from 'vitest';
import {
  CORRUPT_KEY,
  DEFAULT_SETTINGS,
  ProgressStore,
  SCHEMA_VERSION,
  SEEN_MAX,
  STORAGE_KEY,
  episodeStarsNeeded,
  shakeOn,
  type StorageLike,
} from '../../src/storage/progress';

class FakeStorage implements StorageLike {
  map = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(k: string): string | null {
    if (this.failGet) throw new Error('SecurityError');
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    if (this.failSet) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const EP = (e: number) => Array.from({ length: 10 }, (_, i) => `${e}-${i + 1}`);
const ORDER = [...EP(1), ...EP(2), ...EP(3)];

describe('ProgressStore: базовое', () => {
  it('пустое хранилище — нет записей, настройки по умолчанию', () => {
    const p = new ProgressStore(new FakeStorage());
    expect(p.record('1-1')).toBeUndefined();
    expect(p.settings).toEqual(DEFAULT_SETTINGS);
    expect(p.settings).toMatchObject({ sfx: true, music: true, motion: 'system' });
    expect(p.starsTotal()).toBe(0);
    expect(p.persistent).toBe(true);
  });

  it('saveResult пишет сразу и переживает перезапуск', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    const r = p.saveResult('1-1', 41230, 2);
    expect(r).toEqual({ newRecord: false, prevBest: 0 });
    const raw = JSON.parse(st.map.get(STORAGE_KEY)!);
    expect(raw.schema).toBe(SCHEMA_VERSION);
    expect(raw.levels['1-1']).toEqual({ best: 41230, stars: 2 });
    const p2 = new ProgressStore(st);
    expect(p2.record('1-1')).toEqual({ best: 41230, stars: 2 });
  });

  it('худший результат не снижает звёзды и рекорд; новый рекорд — только если был старый', () => {
    const p = new ProgressStore(new FakeStorage());
    p.saveResult('1-1', 50000, 3);
    expect(p.saveResult('1-1', 30000, 1)).toEqual({ newRecord: false, prevBest: 50000 });
    expect(p.record('1-1')).toEqual({ best: 50000, stars: 3 });
    expect(p.saveResult('1-1', 60000, 2)).toEqual({ newRecord: true, prevBest: 50000 });
    expect(p.record('1-1')).toEqual({ best: 60000, stars: 3 });
    expect(p.saveResult('1-1', 60000, 3).newRecord).toBe(false); // равенство — не рекорд
  });

  it('поражение (0 звёзд) ничего не записывает', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    expect(p.saveResult('1-2', 12000, 0)).toEqual({ newRecord: false, prevBest: 0 });
    expect(p.record('1-2')).toBeUndefined();
    expect(st.map.has(STORAGE_KEY)).toBe(false);
  });

  it('звёзды и очки зажимаются в допустимые пределы', () => {
    const p = new ProgressStore(new FakeStorage());
    p.saveResult('1-1', -5, 7);
    expect(p.record('1-1')).toEqual({ best: 0, stars: 3 });
    p.saveResult('1-2', 1234.9, 1.8);
    expect(p.record('1-2')).toEqual({ best: 1234, stars: 1 });
  });

  it('record возвращает копию', () => {
    const p = new ProgressStore(new FakeStorage());
    p.saveResult('1-1', 100, 1);
    const r = p.record('1-1')!;
    r.stars = 3;
    expect(p.record('1-1')!.stars).toBe(1);
  });

  it('starsTotal по списку и по всем', () => {
    const p = new ProgressStore(new FakeStorage());
    p.saveResult('1-1', 1, 3);
    p.saveResult('1-2', 1, 2);
    p.saveResult('2-1', 1, 1);
    expect(p.starsTotal()).toBe(6);
    expect(p.starsTotal(EP(1))).toBe(5);
    expect(p.starsTotal(['2-1', 'нет'])).toBe(1);
  });
});

describe('ProgressStore: разблокировка', () => {
  it('первый уровень открыт, следующий — после победы в предыдущем', () => {
    const p = new ProgressStore(new FakeStorage());
    expect(p.isUnlocked('1-1', ORDER)).toBe(true);
    expect(p.isUnlocked('1-2', ORDER)).toBe(false);
    p.saveResult('1-1', 100, 1);
    expect(p.isUnlocked('1-2', ORDER)).toBe(true);
    expect(p.isUnlocked('1-3', ORDER)).toBe(false);
  });

  it('неизвестный уровень закрыт', () => {
    const p = new ProgressStore(new FakeStorage());
    expect(p.isUnlocked('9-9', ORDER)).toBe(false);
  });

  it('новый эпизод — победа в последнем уровне и ≥ 15 звёзд из 30', () => {
    const p = new ProgressStore(new FakeStorage());
    expect(episodeStarsNeeded(10)).toBe(15);
    for (const id of EP(1)) p.saveResult(id, 100, 1); // 10 звёзд
    expect(p.isUnlocked('1-10', ORDER)).toBe(true);
    expect(p.isUnlocked('2-1', ORDER)).toBe(false);
    for (const id of EP(1).slice(0, 5)) p.saveResult(id, 200, 2); // +5 = 15
    expect(p.starsTotal(EP(1))).toBe(15);
    expect(p.isUnlocked('2-1', ORDER)).toBe(true);
    expect(p.isUnlocked('2-2', ORDER)).toBe(false);
  });

  it('если передан только список одного эпизода, его первый уровень открыт', () => {
    const p = new ProgressStore(new FakeStorage());
    expect(p.isUnlocked('2-1', EP(2))).toBe(true);
  });

  it('unlockAll открывает всё без записи', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    p.unlockAll = true;
    expect(p.isUnlocked('3-10', ORDER)).toBe(true);
    expect(st.map.size).toBe(0);
  });
});

describe('ProgressStore: настройки и сброс', () => {
  it('setSettings частично и сохраняется', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    p.setSettings({ music: false });
    expect(p.settings).toEqual({ ...DEFAULT_SETTINGS, sfx: true, music: false });
    expect(new ProgressStore(st).settings).toEqual({ ...DEFAULT_SETTINGS, sfx: true, music: false });
    p.setSettings({ sfx: 'да' as unknown as boolean });
    expect(p.settings.sfx).toBe(true);
  });

  it('settings — снимок: изменение копии не влияет на хранилище', () => {
    const p = new ProgressStore(new FakeStorage());
    const s = p.settings as { sfx: boolean };
    s.sfx = false;
    expect(p.settings.sfx).toBe(true);
  });

  it('reset стирает уровни, но сохраняет настройки', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    p.saveResult('1-1', 100, 3);
    p.setSettings({ sfx: false });
    p.reset();
    expect(p.record('1-1')).toBeUndefined();
    expect(p.settings.sfx).toBe(false);
    const p2 = new ProgressStore(st);
    expect(p2.record('1-1')).toBeUndefined();
    expect(p2.settings.sfx).toBe(false);
  });
});

describe('ProgressStore: битые данные и отказы хранилища', () => {
  it('невалидный JSON — копия в .corrupt и чистый старт', () => {
    const st = new FakeStorage();
    st.map.set(STORAGE_KEY, '{oops');
    const p = new ProgressStore(st);
    expect(p.record('1-1')).toBeUndefined();
    expect(st.map.get(CORRUPT_KEY)).toBe('{oops');
    expect(st.map.has(STORAGE_KEY)).toBe(false);
    p.saveResult('1-1', 10, 1);
    expect(new ProgressStore(st).record('1-1')).toEqual({ best: 10, stars: 1 });
  });

  it('JSON не того вида (массив, число, null) — чистый старт', () => {
    for (const bad of ['[1,2]', '42', 'null', '"str"']) {
      const st = new FakeStorage();
      st.map.set(STORAGE_KEY, bad);
      const p = new ProgressStore(st);
      expect(p.starsTotal()).toBe(0);
      expect(st.map.get(CORRUPT_KEY)).toBe(bad);
    }
  });

  it('мусор внутри записи санитайзится', () => {
    const st = new FakeStorage();
    st.map.set(
      STORAGE_KEY,
      JSON.stringify({
        schema: 1,
        levels: {
          '1-1': { stars: 7, best: -5 },
          '1-2': { stars: '2', best: '1500' },
          '1-3': 'мусор',
          '1-4': { stars: null, best: NaN },
          'плохой id с пробелами': { stars: 3, best: 1 },
          '<script>': { stars: 3, best: 1 },
        },
        settings: { sfx: 'yes', music: false, quality: 'ultra' },
      }),
    );
    const p = new ProgressStore(st);
    expect(p.record('1-1')).toEqual({ best: 0, stars: 3 });
    expect(p.record('1-2')).toEqual({ best: 1500, stars: 2 });
    expect(p.record('1-3')).toBeUndefined();
    expect(p.record('1-4')).toBeUndefined();
    expect(p.starsTotal()).toBe(5);
    expect(p.settings).toEqual({ ...DEFAULT_SETTINGS, sfx: true, music: false, quality: 'auto' });
  });

  it('старый формат без schema мигрирует', () => {
    const st = new FakeStorage();
    st.map.set(STORAGE_KEY, JSON.stringify({ version: 1, levels: { '1-1': { cleared: true, best: 41230, stars: 3 } } }));
    const p = new ProgressStore(st);
    expect(p.record('1-1')).toEqual({ best: 41230, stars: 3 });
    expect(p.readOnly).toBe(false);
  });

  it('схема из будущего — читаем, но не перезаписываем', () => {
    const st = new FakeStorage();
    const future = JSON.stringify({ schema: SCHEMA_VERSION + 1, levels: { '1-1': { best: 5, stars: 2 } }, extra: 1 });
    st.map.set(STORAGE_KEY, future);
    const p = new ProgressStore(st);
    expect(p.readOnly).toBe(true);
    expect(p.record('1-1')).toEqual({ best: 5, stars: 2 });
    p.saveResult('1-1', 999, 3);
    expect(p.record('1-1')).toEqual({ best: 999, stars: 3 }); // в памяти обновилось
    expect(st.map.get(STORAGE_KEY)).toBe(future); // в хранилище — нет
  });

  it('схема 99 (целая, будущая) — только чтение', () => {
    const st = new FakeStorage();
    const future = JSON.stringify({ schema: 99, levels: { '1-1': { best: 5, stars: 2 } } });
    st.map.set(STORAGE_KEY, future);
    const p = new ProgressStore(st);
    expect(p.readOnly).toBe(true);
    expect(p.persistent).toBe(true);
    p.saveResult('1-2', 100, 1);
    expect(st.map.get(STORAGE_KEY)).toBe(future);
  });

  it('нецелая или чужая версия схемы (1.5, −1, «1», null) — в CORRUPT_KEY и с чистого листа, запись идёт', () => {
    for (const schema of [1.5, -1, '1', null, true, 1e400]) {
      const st = new FakeStorage();
      const bad = JSON.stringify({ schema, levels: { '1-1': { best: 5, stars: 2 } } });
      st.map.set(STORAGE_KEY, bad);
      const p = new ProgressStore(st);
      expect(p.readOnly, String(schema)).toBe(false);
      expect(p.record('1-1')).toBeUndefined();
      expect(st.map.get(CORRUPT_KEY)).toBe(bad);
      p.saveResult('1-1', 41230, 3);
      const raw = JSON.parse(st.map.get(STORAGE_KEY)!);
      expect(raw.schema).toBe(SCHEMA_VERSION);
      expect(raw.levels['1-1']).toEqual({ best: 41230, stars: 3 });
    }
  });

  it('getItem бросает — работа в памяти без ошибок', () => {
    const st = new FakeStorage();
    st.failGet = true;
    const p = new ProgressStore(st);
    expect(p.persistent).toBe(false);
    expect(() => p.saveResult('1-1', 100, 2)).not.toThrow();
    expect(p.record('1-1')).toEqual({ best: 100, stars: 2 });
  });

  it('setItem бросает (квота) — переходим в память', () => {
    const st = new FakeStorage();
    st.failSet = true;
    const p = new ProgressStore(st);
    expect(() => p.saveResult('1-1', 100, 2)).not.toThrow();
    expect(p.persistent).toBe(false);
    expect(p.record('1-1')).toEqual({ best: 100, stars: 2 });
    expect(() => p.setSettings({ music: false })).not.toThrow();
    expect(p.settings.music).toBe(false);
  });

  it('null — только память', () => {
    const p = new ProgressStore(null);
    expect(p.persistent).toBe(false);
    p.saveResult('1-1', 100, 1);
    expect(p.isUnlocked('1-2', ORDER)).toBe(true);
  });

  it('без аргумента в Node (нет localStorage) — работает в памяти', () => {
    const p = new ProgressStore();
    expect(() => p.saveResult('1-1', 1, 1)).not.toThrow();
    expect(p.record('1-1')).toEqual({ best: 1, stars: 1 });
  });

  it('reload подхватывает запись другой вкладки', () => {
    const st = new FakeStorage();
    const a = new ProgressStore(st);
    const b = new ProgressStore(st);
    a.saveResult('1-1', 777, 2);
    expect(b.record('1-1')).toBeUndefined();
    b.reload();
    expect(b.record('1-1')).toEqual({ best: 777, stars: 2 });
  });
});

describe('ProgressStore: расширенные настройки', () => {
  it('перечисления санитайзятся, допустимые — сохраняются', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    p.setSettings({ motion: 'reduce', quality: 'low', aimAssist: 'short', shake: false, haptics: false });
    const p2 = new ProgressStore(st);
    expect(p2.settings).toEqual({ sfx: true, music: true, levelMusic: true, motion: 'reduce', quality: 'low', aimAssist: 'short', shake: false, haptics: false });
    p2.setSettings({ motion: 'дёргано' as never, quality: 'ultra' as never });
    expect(p2.settings.motion).toBe('reduce');
    expect(p2.settings.quality).toBe('low');
  });

  it('тряска «авто» по умолчанию: выкл при уменьшенном движении, явный выбор сильнее (07 §19.3)', () => {
    expect(DEFAULT_SETTINGS.shake).toBe('auto');
    expect(shakeOn({ shake: 'auto' }, false)).toBe(true);
    expect(shakeOn({ shake: 'auto' }, true)).toBe(false);
    expect(shakeOn({ shake: true }, true)).toBe(true);
    expect(shakeOn({ shake: false }, false)).toBe(false);
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    p.setSettings({ shake: true, levelMusic: false });
    p.setSettings({ shake: 'тряско' as never, levelMusic: 1 as never });
    const p2 = new ProgressStore(st);
    expect(p2.settings.shake).toBe(true);
    expect(p2.settings.levelMusic).toBe(false);
    p2.setSettings({ shake: 'auto' });
    expect(new ProgressStore(st).settings.shake).toBe('auto');
  });

  it('setSettings без изменений не пишет в хранилище', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    p.setSettings({ sfx: true, motion: 'system' });
    expect(st.map.has(STORAGE_KEY)).toBe(false);
  });
});

describe('ProgressStore: поражения, флаги, подписки', () => {
  it('saveLoss копит серию, победа её обнуляет, переживает перезапуск', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    expect(p.failStreak('1-2')).toBe(0);
    expect(p.saveLoss('1-2')).toBe(1);
    expect(p.saveLoss('1-2')).toBe(2);
    expect(p.saveLoss('1-2')).toBe(3);
    expect(new ProgressStore(st).failStreak('1-2')).toBe(3);
    expect(p.record('1-2')).toBeUndefined(); // поражение не создаёт запись уровня
    p.saveResult('1-2', 5000, 1);
    expect(p.failStreak('1-2')).toBe(0);
    expect(new ProgressStore(st).failStreak('1-2')).toBe(0);
  });

  it('markSeen / hasSeen; мусорные ключи игнорируются; reset стирает флаги', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    expect(p.hasSeen('ability:chuck')).toBe(false);
    p.markSeen('ability:chuck');
    p.markSeen('ability:chuck');
    p.markSeen('плохой ключ');
    expect(new ProgressStore(st).hasSeen('ability:chuck')).toBe(true);
    expect(JSON.parse(st.map.get(STORAGE_KEY)!).seen).toEqual(['ability:chuck']);
    p.reset();
    expect(p.hasSeen('ability:chuck')).toBe(false);
  });

  it('seen переполнен мусором — markSeen вытесняет самые старые незнакомые ключи, а не молчит', () => {
    const st = new FakeStorage();
    const junk = Array.from({ length: SEEN_MAX }, (_, i) => `junk:${i}`);
    st.map.set(STORAGE_KEY, JSON.stringify({ schema: 1, seen: ['ability:chuck', ...junk] }));
    const p = new ProgressStore(st);
    // при загрузке лишний (самый старый мусорный) ключ ушёл, знакомый остался
    expect(p.hasSeen('ability:chuck')).toBe(true);
    expect(p.hasSeen('junk:0')).toBe(false);
    p.markSeen('aimTutorial');
    p.markSeen('hint:1-2');
    const seen: string[] = JSON.parse(st.map.get(STORAGE_KEY)!).seen;
    expect(seen.length).toBe(SEEN_MAX);
    expect(seen).toContain('aimTutorial');
    expect(seen).toContain('hint:1-2');
    expect(seen).toContain('ability:chuck');
    expect(seen).not.toContain('junk:1');
    expect(seen).not.toContain('junk:2');
    expect(seen).toContain('junk:3');
    expect(new ProgressStore(st).hasSeen('aimTutorial')).toBe(true);
  });

  it('seen полон знакомыми ключами — новый всё равно записывается (уходит самый старый)', () => {
    const st = new FakeStorage();
    const known = Array.from({ length: SEEN_MAX }, (_, i) => `hint:${i}`);
    st.map.set(STORAGE_KEY, JSON.stringify({ schema: 1, seen: known }));
    const p = new ProgressStore(st);
    p.markSeen('future:key');
    const seen: string[] = JSON.parse(st.map.get(STORAGE_KEY)!).seen;
    expect(seen.length).toBe(SEEN_MAX);
    expect(seen[seen.length - 1]).toBe('future:key');
    expect(seen).not.toContain('hint:0');
  });

  it('мусор в fails и seen санитайзится', () => {
    const st = new FakeStorage();
    st.map.set(STORAGE_KEY, JSON.stringify({ schema: 1, fails: { '1-1': 2, '1-2': -4, '1-3': 'x', 'плохой': 3 }, seen: ['aimTutorial', 5, 'a b'] }));
    const p = new ProgressStore(st);
    expect(p.failStreak('1-1')).toBe(2);
    expect(p.failStreak('1-2')).toBe(0);
    expect(p.failStreak('1-3')).toBe(0);
    expect(p.hasSeen('aimTutorial')).toBe(true);
    expect(p.hasSeen('a b')).toBe(false);
  });

  it('onChange срабатывает на запись, сброс и reload; отписка работает', () => {
    const st = new FakeStorage();
    const p = new ProgressStore(st);
    let n = 0;
    const off = p.onChange(() => n++);
    p.saveResult('1-1', 10, 1);
    p.setSettings({ music: false });
    p.reset();
    p.reload();
    expect(n).toBe(4);
    off();
    p.saveResult('1-1', 10, 1);
    expect(n).toBe(4);
  });

  it('bindStorageEvents: запись другой вкладки → reload + onChange', () => {
    const st = new FakeStorage();
    const a = new ProgressStore(st);
    const b = new ProgressStore(st);
    const handlers: Array<(e: StorageEvent) => void> = [];
    const target = {
      addEventListener: (_t: string, h: (e: StorageEvent) => void) => handlers.push(h),
      removeEventListener: (_t: string, h: (e: StorageEvent) => void) => handlers.splice(handlers.indexOf(h), 1),
    } as unknown as Window;
    let changed = 0;
    b.onChange(() => changed++);
    const off = b.bindStorageEvents(target);
    a.saveResult('1-1', 300, 2);
    handlers.forEach((h) => h({ key: 'другой.ключ' } as StorageEvent));
    expect(b.record('1-1')).toBeUndefined();
    handlers.forEach((h) => h({ key: STORAGE_KEY } as StorageEvent));
    expect(b.record('1-1')).toEqual({ best: 300, stars: 2 });
    expect(changed).toBe(1);
    off();
    expect(handlers.length).toBe(0);
  });

  it('ProgressStore(null): поражения и флаги тоже работают в памяти', () => {
    const p = new ProgressStore(null);
    expect(p.saveLoss('1-1')).toBe(1);
    p.markSeen('aimTutorial');
    expect(p.hasSeen('aimTutorial')).toBe(true);
    expect(p.bindStorageEvents(null)).toBeTypeOf('function');
  });
});
