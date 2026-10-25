// Очередь тостов: замена по типу и предел длины (ревью ui п.17).
import { describe, expect, it } from 'vitest';
import { queueToast, type ToastItem } from '../../src/ui/toastQueue';

const it_ = (text: string, key = text): ToastItem => ({ text, ms: 1500, key });

describe('queueToast', () => {
  it('тост того же типа, что показан, обновляет показанный', () => {
    const q: ToastItem[] = [];
    expect(queueToast(q, it_('Музыка выключена', 'music'), it_('Музыка включена', 'music'))).toBe('current');
    expect(q).toHaveLength(0);
  });

  it('шесть нажатий M подряд — не больше одного ожидающего тоста музыки', () => {
    const q: ToastItem[] = [];
    let cur: ToastItem | null = it_('Прогресс сброшен');
    for (let i = 0; i < 6; i++) queueToast(q, cur, it_(i % 2 ? 'Музыка включена' : 'Музыка выключена', 'music'));
    expect(q).toEqual([it_('Музыка включена', 'music')]);
    cur = null;
    expect(queueToast(q, cur, it_('Звуки выключены', 'sfx'))).toBe('queued');
    expect(q.map((x) => x.key)).toEqual(['music', 'sfx']);
  });

  it('очередь не длиннее предела: выбрасываются самые старые', () => {
    const q: ToastItem[] = [];
    for (const s of ['a', 'b', 'c', 'd']) queueToast(q, it_('x'), it_(s));
    expect(q.map((x) => x.text)).toEqual(['c', 'd']);
  });

  it('одинаковый текст без ключа не дублируется', () => {
    const q: ToastItem[] = [];
    queueToast(q, null, it_('Эпизод закрыт'));
    queueToast(q, null, it_('Эпизод закрыт'));
    expect(q).toHaveLength(1);
  });
});
