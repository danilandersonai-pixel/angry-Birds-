// Тесты сохранения прогресса: фейковое хранилище в памяти, без DOM.
import { describe, expect, it } from 'vitest';
import {
  CORRUPT_KEY,
  ProgressStore,
  SCHEMA_VERSION,
  STORAGE_KEY,
  episodeStarsNeeded,
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
    expect(p.settings).toEqual({ sfx: true, music: true });
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
    expect(p.settings).toEqual({ sfx: true, music: false });
    expect(new ProgressStore(st).settings).toEqual({ sfx: true, music: false });
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
    expect(p.settings).toEqual({ sfx: true, music: false });
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
