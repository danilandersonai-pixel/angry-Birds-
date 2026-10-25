// Разблокировка звука: флаг ставится только когда контекст реально запущен (ревью ui п.19).
import { describe, expect, it } from 'vitest';
import { AudioUnlocker, UNLOCK_EVENTS } from '../../src/ui/unlock';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('AudioUnlocker', () => {
  it('слушает жесты, которые считаются активацией (pointerup/touchend/click/keydown)', () => {
    for (const e of ['pointerup', 'touchend', 'click', 'keydown']) expect(UNLOCK_EVENTS).toContain(e);
  });

  it('первый жест не запустил контекст — пробует снова на следующем', async () => {
    let calls = 0;
    const audio = {
      ready: false,
      unlock(): Promise<void> {
        calls++;
        if (calls >= 2) this.ready = true; // второй жест (например, pointerup) запустил контекст
        return Promise.resolve();
      },
    };
    const u = new AudioUnlocker(audio);
    let doneCalls = 0;
    u.onDone = () => doneCalls++;
    u.gesture();
    await flush();
    expect(u.done).toBe(false);
    u.gesture();
    await flush();
    expect(u.done).toBe(true);
    u.gesture();
    expect(calls).toBe(2);
    expect(doneCalls).toBe(1);
  });

  it('исключение в unlock не ломает и не ставит флаг', async () => {
    const u = new AudioUnlocker({
      unlock: () => {
        throw new Error('нет Web Audio');
      },
    });
    u.gesture();
    await flush();
    expect(u.done).toBe(false);
  });

  it('без поля ready — готово после успешного unlock; без звука вовсе — сразу готово', async () => {
    const u = new AudioUnlocker({ unlock: () => Promise.resolve() });
    u.gesture();
    await flush();
    expect(u.done).toBe(true);
    expect(new AudioUnlocker(undefined).done).toBe(true);
  });
});
