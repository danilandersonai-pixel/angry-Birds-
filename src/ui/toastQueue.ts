// Очередь тостов (07 §4.6): тост того же типа заменяет показанный или ожидающий, очередь короткая —
// шесть нажатий M не дают 12 секунд устаревших «Музыка включена/выключена». Чистая логика без DOM.

export interface ToastItem {
  text: string;
  ms: number;
  /** Тип тоста: одинаковые заменяют друг друга (по умолчанию — сам текст). */
  key: string;
}

/** Сколько тостов может ждать за показанным. */
export const TOAST_QUEUE_MAX = 2;

/**
 * Поставить тост в очередь. 'current' — ключ совпал с показанным: вызывающий обновляет его текст и таймер.
 * Иначе ожидающий тост того же ключа заменяется, а очередь укорачивается до max (выбрасываются самые старые).
 */
export function queueToast(queue: ToastItem[], current: ToastItem | null, item: ToastItem, max = TOAST_QUEUE_MAX): 'current' | 'queued' {
  if (current && current.key === item.key) return 'current';
  const i = queue.findIndex((q) => q.key === item.key);
  if (i >= 0) queue.splice(i, 1);
  queue.push(item);
  while (queue.length > Math.max(1, max)) queue.shift();
  return 'queued';
}
