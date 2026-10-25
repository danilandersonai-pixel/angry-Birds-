// anim(): закончившиеся анимации без fill: 'forwards' снимаются, чтобы не мешать следующим анимациям элемента
// уйти на композитор (плейтест №2, Б10: «пульс» кнопки после pop-in шёл на главном потоке каждый кадр).
import { describe, expect, it, vi } from 'vitest';
import { anim, done, popIn } from '../../src/ui/anim';

interface FakeAnim {
  playState: string;
  finished: Promise<FakeAnim>;
  cancel: ReturnType<typeof vi.fn>;
  finish: () => void;
}

/** Элемент с animate(), чья анимация «заканчивается» по вызову finish(). */
function fakeEl(): { el: Element; made: FakeAnim[]; opts: KeyframeAnimationOptions[] } {
  const made: FakeAnim[] = [];
  const opts: KeyframeAnimationOptions[] = [];
  const el = {
    animate(_k: Keyframe[], o: KeyframeAnimationOptions) {
      let res!: (a: FakeAnim) => void;
      const a: FakeAnim = {
        playState: 'running',
        finished: new Promise<FakeAnim>((r) => (res = r)),
        cancel: vi.fn(() => {
          a.playState = 'idle';
        }),
        finish: () => {
          a.playState = 'finished';
          res(a);
        },
      };
      made.push(a);
      opts.push(o);
      return a;
    },
  } as unknown as Element;
  return { el, made, opts };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('anim', () => {
  it('без fill и с fill: backwards — после окончания анимация снимается (cancel)', async () => {
    for (const fill of [undefined, 'backwards', 'none', 'auto'] as const) {
      const { el, made } = fakeEl();
      const a = anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 10, fill });
      expect(a).toBe(made[0]);
      made[0]!.finish();
      await tick();
      expect(made[0]!.cancel, String(fill)).toHaveBeenCalledTimes(1);
    }
  });

  it('fill: forwards / both — конечное состояние держится, не снимается', async () => {
    for (const fill of ['forwards', 'both'] as const) {
      const { el, made } = fakeEl();
      anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 10, fill });
      made[0]!.finish();
      await tick();
      expect(made[0]!.cancel, fill).not.toHaveBeenCalled();
    }
  });

  it('done() дожидается окончания и после снятия; без animate() — null', async () => {
    const { el, made } = fakeEl();
    const a = anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 10 });
    let ok = false;
    void done(a).then(() => (ok = true));
    made[0]!.finish();
    await tick();
    expect(ok).toBe(true);
    expect(anim({} as Element, [], { duration: 1 })).toBeNull();
  });

  it('popIn — масштаб отдельным свойством scale (складывается со статическим translate элемента)', () => {
    const { el, made } = fakeEl();
    const frames: Keyframe[][] = [];
    const orig = (el as unknown as { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => unknown }).animate;
    (el as unknown as { animate: unknown }).animate = (k: Keyframe[], o: KeyframeAnimationOptions) => {
      frames.push(k);
      return orig(k, o);
    };
    popIn(el);
    expect(made).toHaveLength(1);
    for (const f of frames[0]!) {
      expect(f.transform).toBeUndefined();
      expect(f.scale).toBeDefined();
    }
  });
});
