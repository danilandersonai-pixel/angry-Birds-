// Все строки интерфейса (07 §18). Регистр — обычный; КАПС делает CSS (text-transform).
// Подстановки — {name}. Числа — fmt() (ru-RU, неразрывный пробел U+00A0 есть в шрифтах).

export const S = {
  appTitle: 'Сердитые Птицы',
  appTitle1: 'Сердитые',
  appTitle2: 'Птицы',
  appBadge: 'фан-ремейк',
  appVersion: 'v{v} · фанатский проект, не связан с Rovio',

  bootLoading: 'Загрузка… {p}%',

  titlePlay: 'Играть',
  music: 'Музыка',
  sound: 'Звуки',
  musicOn: 'Музыка: вкл',
  musicOff: 'Музыка: выкл',
  soundOn: 'Звуки: вкл',
  soundOff: 'Звуки: выкл',
  fullscreen: 'Во весь экран',
  exitFullscreen: 'Выйти из полноэкранного режима',
  back: 'Назад',
  close: 'Закрыть',

  episodesTitle: 'Выберите эпизод',
  episodeNum: 'Эпизод {n}',
  starsOf: '{got}/{total}',
  episodeLockedReq: 'Пройдите «{prev}» и соберите {n} {stars}',
  episodeLockedShort: 'Эпизод закрыт',
  episodeLockedCard: 'Нужно {n} {stars} в эпизоде {prev}',
  episodeUnlocked: 'Открыт эпизод «{name}»!',
  episodeAria: 'Эпизод {n} «{name}»: {got} из {total} звёзд',
  episodeAriaLocked: 'Эпизод {n} «{name}», закрыт. {req}',

  levelsBest: 'Рекорд: {score}',
  levelsNotCleared: 'Ещё не пройден',
  levelsLocked: 'Сначала пройдите уровень {prev}',
  levelsToNextEp: 'До следующего эпизода: ещё {n} {stars}',
  levelsEpDone: 'Эпизод пройден!',
  levelsFinishLast: 'Пройдите уровень {id}, чтобы открыть следующий эпизод',
  levelsEpPerfect: 'Все звёзды эпизода собраны!',
  levelsNextOpen: 'Открыт эпизод «{name}»',
  levelsAria: 'Уровень {id}: {s} из 3 звёзд, рекорд {score}',
  levelsAriaNew: 'Уровень {id}, ещё не пройден',
  levelsAriaLocked: 'Уровень {id}, закрыт',

  hudPause: 'Пауза (Esc)',
  hudRestart: 'Начать заново (R)',
  hudBest: 'Рекорд',
  hudScore: 'Счёт',
  hudPigs: 'Свиней осталось: {n}',

  pauseTitle: 'Пауза',
  pauseResume: 'Продолжить',
  pauseRestart: 'Заново',
  pauseMenu: 'Меню',
  pauseBest: 'Рекорд: {score}',
  pauseNoBest: 'Рекорда пока нет',
  pauseBirds: 'Птиц осталось: {n}',

  winBanner: 'Уровень пройден!',
  winScore: 'Счёт',
  winBest: 'Рекорд: {score}',
  winNewBest: 'Новый рекорд!',
  winNext: 'Дальше',
  winRestart: 'Заново',
  winMenu: 'Меню',
  winLockedNext: 'Соберите ещё {n} {stars}, чтобы открыть «{name}»',
  winAllDone: 'Вы прошли все уровни!',
  winTapSkip: 'Коснитесь, чтобы пропустить',

  loseBanner: 'Уровень не пройден',
  loseRetry: 'Ещё раз',
  loseMenu: 'Меню',

  rotateTitle: 'Поверните устройство',
  rotateBody: 'Игра рассчитана на горизонтальный экран',
  rotateAnyway: 'Играть так',

  toastStorageOff: 'Прогресс не сохранится: браузер запретил хранилище',
  toastMusicOn: 'Музыка включена',
  toastMusicOff: 'Музыка выключена',
  toastSfxOn: 'Звуки включены',
  toastSfxOff: 'Звуки выключены',

  a11yWon: 'Уровень {id} пройден. {s} {stars} из 3. Счёт {score}.',
  a11yLost: 'Уровень не пройден.',
  a11yPaused: 'Игра на паузе.',
} as const;

export type StringKey = keyof typeof S;

/** Подставить {name} → значение. */
export function t(key: StringKey, vars?: Record<string, string | number>): string {
  const s: string = S[key];
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

const NF = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
/** Число по-русски: «12 340» (разделитель — неразрывный пробел). */
export function fmt(n: number): string {
  return NF.format(Math.floor(n));
}

const PR = new Intl.PluralRules('ru');
/** Множественное число: plural(5, STARS) → «звёзд». */
export function plural(n: number, forms: readonly [one: string, few: string, many: string]): string {
  const c = PR.select(n);
  return c === 'one' ? forms[0] : c === 'few' ? forms[1] : forms[2];
}
export const STARS = ['звезда', 'звезды', 'звёзд'] as const;
/** Родительный падеж: «соберите 1 звезду / 2 звезды / 5 звёзд». */
export const STARS_ACC = ['звезду', 'звезды', 'звёзд'] as const;
export const BIRDS = ['птица', 'птицы', 'птиц'] as const;

/** Советы для экрана загрузки (07 §18). */
export const TIPS: readonly string[] = [
  'Тяните птицу назад: чем дальше, тем сильнее выстрел.',
  'Передумали? Отпустите птицу у самой рогатки — выстрел не потратится.',
  'Каждая неиспользованная птица приносит 10 000 очков.',
  'Чак пробивает дерево. Коснитесь в полёте — и он рванёт вперёд!',
  'Синие делятся на троих и отлично бьют стекло.',
  'Бомб взрывается по касанию или сам — через пару секунд после удара.',
  'Матильда сбрасывает яйцо-бомбу прямо вниз.',
  'Хэл летит бумерангом: коснитесь, и он развернётся.',
  'Теренс тяжёлый — камню с ним не устоять.',
  'Сильвер делает петлю и пикирует вниз.',
  'Ящики TNT взрываются от сильного удара.',
  'Свиньи в касках крепче обычных.',
  'Колесо мыши или щипок двумя пальцами — приблизить и отдалить.',
  'Нажмите R, чтобы мгновенно начать уровень заново.',
  'Пробел включает способность птицы в полёте.',
  'Три звезды — это меньше птиц и больше разрушений.',
  'Лёд хрупкий, камень — самый прочный.',
  'Падающие брёвна и камни тоже давят свиней.',
];

/** Дразнилки экрана поражения. */
export const TAUNTS: readonly string[] = [
  'Свиньи смеются… пока!',
  'Хрю-хрю! Попробуй ещё!',
  'Почти получилось!',
  'Башня устояла. Пока что.',
];
