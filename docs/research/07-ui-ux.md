# 07 — UI/UX и экраны: уровень Angry Birds 2020 в DOM/CSS

Спецификация интерфейса браузерного клона. Стек: TypeScript + Vite, DOM/CSS-оверлей поверх Canvas 2D, иконки — inline SVG, анимации — CSS keyframes (циклы) и Web Animations API (таймлайны), звук — `AudioEngine` из 05. Всё рисуется кодом: никаких растровых файлов и ассетов Rovio. Логотип, кнопки и иконки — оригинальные, узнаваемые по стилю серии: толстые тёмные обводки, глянцевые градиенты, «пухлые» формы, пружинящие появления.

Пометки: **[факт]** — из источников (список в конце); **[наблюдение]** — по памяти о Classic / Friends / AB2, без первоисточника; **[замер]** — посчитано или проверено скриптом в scratch-папке (контрасты, метрики шрифтов, ширина строк, typecheck кода); **[рекомендация]** — наше решение там, где точных данных нет.

TypeScript из §2.1, §4.8, §5.3, §6.1, §12.5, §15.2, §16.1, §17, §18 (полные версии, без сокращений) собран `tsc 7.0.2` в strict-режиме без ошибок. Логика §17 (разблокировка, рекорды, санитайзинг, повреждённые данные) прогнана в Node [замер].

---

## 0. Сводка решений

| # | Решение | Значение |
|---|---|---|
| 1 | Слой UI | DOM поверх `<canvas>`. Меню-экраны прозрачные: за ними живёт фон темы, его рисует тот же `Background` из 04 |
| 2 | Единица размера | `u` — CSS-пиксель макета 1280×720. `u = clamp(min(W/1280, H/720) · (coarse ? 1.15 : 1), 0.45, 1.25)` по safe-area. Любой размер в документе — `N·u` |
| 3 | Безопасный макет | Каждый экран помещается в **1100×620 u** (это минимум `W/u × H/u` на телефонах) |
| 4 | Тач-зоны | Видимый размер кнопки не меньше 44 css px (`max(44px, N·u)`). Хит-зона не меньше 44×44 даже у мелких иконок. Промежутки не меньше 8 px |
| 5 | Шрифты | Rubik 900/700 (кириллица) для текста, Luckiest Guy только для цифр (04 §9). Обводка текста: `-webkit-text-stroke` + `paint-order: stroke fill`, Baseline 2024 [факт] |
| 6 | Кнопки | Круглые (иконка) и «таблетки» (текст). 5 вариантов цвета, 5 размеров. Объём: градиент hi→mid→lo, обводка 4u, «цоколь» 6u, глянцевый блик |
| 7 | Переходы | Меню↔меню — встречный слайд 0.36/0.24 с. Эпизод→уровни — зум карточки (FLIP) 0.42 с. Меню↔игра — **ирис-шторка** (круг закрывается к точке нажатия за 0.45 с, раскрывается от рогатки за 0.5 с). Рестарт — фейд 0.15 + 0.2 с (01 §12.3) |
| 8 | Pop-in | `scale 0.3 → 1.08 → 0.97 → 1` за 0.36 с, задержка по очереди 30–60 мс |
| 9 | Пауза | Тёмная панель **выезжает слева** (как в Classic [наблюдение]), справа — карточка уровня. Esc/P/‖, автопауза при скрытии вкладки |
| 10 | Победа | Лента «УРОВЕНЬ ПРОЙДЕН!» → бонус птиц в мире (01 §10) → панель. Звёзды приземляются в 0.5 / 0.95 / 1.4 с (как в 05 §8.7): «бум», кольцо, 10 искр. Затем счёт крутится 1.2 с, затем «НОВЫЙ РЕКОРД!». Кнопки работают с 1.7 с. Один тап пропускает всю анимацию |
| 11 | Поражение | Красная лента «УРОВЕНЬ НЕ ПРОЙДЕН» и свинья, которая **хохочет до слёз** (поза `laugh` из 02 + DOM-слёзы). Главная кнопка — «Ещё раз», после 3 неудач подряд добавляется совет |
| 12 | Портрет | Телефон или планшет в портрете — оверлей «Поверните устройство» и кнопка «Играть так» (полоса 16:9 по ширине). Десктоп с узким окном — та же полоса автоматически |
| 13 | Ввод | Птица под пальцем — прицел. Иначе после 8 px — пан, два пальца — щипок, колесо — зум. Тап в полёте — способность (на `pointerdown`). Клавиши: R, Esc/P, Space, F, M, Z, стрелки, ± |
| 14 | Сохранение | `localStorage['angrybirds.progress.v1']`, внутри `schema: 1`, санитайзинг, цепочка миграций. Повреждённые данные уходят в `.corrupt`. Сохранение из будущей версии открывается только для чтения. Без хранилища игра работает в памяти |
| 15 | Открытие | Уровень n+1 — после победы в n. Эпизод e+1 — после победы в последнем уровне e и при ★ ≥ 15 из 30 в e (01 §12.2). Состояние открытия вычисляется, а не хранится |
| 16 | Доступность | Текст на цветных кнопках — с тёмной обводкой (контраст 8.3–13.8:1). Фокус — двойное кольцо (тёмное 3u + жёлтое 4u). `prefers-reduced-motion` и настройка «Анимации» меняют всё движение по таблице §19.3 |

---

## 1. Архитектура UI

### 1.1. Слои (`#stage`, всё `position: absolute; inset: 0`)

| z | Слой | Элемент | `pointer-events` |
|---|---|---|---|
| 0 | Сцена (мир, фон меню) | `<canvas id="game">` | auto (ввод игры, §16) |
| 10 | HUD | `<div class="hud">` | контейнер `none`, кнопки `auto` |
| 20 | Экраны меню (загрузка, титул, эпизоды, уровни) | `<section class="screen">` | auto |
| 30 | Оверлеи уровня (пауза, победа, поражение, баннеры) | `<div class="overlay">` + `.backdrop` | auto |
| 40 | Диалоги (настройки, подтверждение, об игре) | `<div role="dialog">` | auto |
| 50 | Тосты и подсказки | `<div class="toasts" aria-live="polite">` | none |
| 60 | Ирис или фейд перехода | `<svg class="iris">` | auto, пока виден (ввод блокирован) |
| 70 | «Поверните устройство» | `<div class="rotate">` | auto |

### 1.2. Автомат экранов приложения

```
            ┌──────────────── back ────────────────┐
 boot ──► title ──► episodes ──► levels ──► game ──┘
   │        ▲  back    ▲   back     ▲  ▲      │ overlays: pause | banner | results(won/lost)
   │        └──────────┴────────────┘  └──────┘ «Уровни» / «Дальше» (ирис)
   └─ error (не загрузилось)
 Модальные поверх любого: settings, confirm, credits, rotate.
```

- `AppScreen = 'boot' | 'title' | 'episodes' | 'levels' | 'game'`; `Overlay = 'pause' | 'banner' | 'results' | null`; `Dialog = 'settings' | 'confirm' | 'credits' | null`.
- Пока идёт переход, ввод блокирован: флаг `ui.busy = true` и ирис с `pointer-events: auto`. Повторное нажатие той же кнопки игнорируется.
- **Системная кнопка «Назад» и жест Android** [рекомендация]: на входе в `episodes / levels / game` вызываем `history.pushState({s})`. На `popstate` срабатывает UI-назад: в игре сначала открывается пауза, повторный «назад» ведёт в уровни. Так браузер не закрывает игру одним свайпом.

### 1.3. Контракт `UI` (расширение `docs/superpowers/specs` §3)

```ts
export interface UIDeps {
  progress: Progress;                 // §17
  audio: AudioEngine;                 // 05 §2.3
  episodes: EpisodeMeta[];            // id, name, theme, levels[{id, name}]
  onStartLevel(levelId: string, origin: { x: number; y: number }): void;   // origin — центр нажатой кнопки (для ириса)
  onRestart(): void;
  onPause(paused: boolean): void;
  onExitToLevels(epId: string): void;
  onMenuScene(theme: ThemeId, mode: 'title' | 'episodes' | 'levels'): void; // фон меню на canvas
  onSkip(): void;                     // интро / бонус / баннер
  onCameraHome(): void;               // кнопка «К рогатке»
}
export class UI {
  constructor(root: HTMLElement, deps: UIDeps);
  showBoot(): void; setBootProgress(p: number, stage: string): void; bootDone(): Promise<void>; showBootError(e: unknown): void;
  showTitle(): void; showEpisodes(focusEpId?: string): void; showLevels(epId: string): void;
  showHud(level: LevelDef): void; updateHud(s: { score: number; best: number; birdsLeft: number; state: LevelState }): void;
  showPause(): void; hidePause(): Promise<void>;
  showBanner(kind: 'cleared' | 'failed', extras?: ('oneShot' | 'clean')[]): void;
  showWin(r: WinResult & { levelId: string; next: NextInfo }): void;
  showLose(r: { levelId: string; score: number; failStreak: number; tip?: string }): void;
  transition(kind: 'iris' | 'fade', phase: 'close' | 'open', at?: { x: number; y: number }): Promise<void>;
  toast(text: string, ms?: number): void; abilityHint(bird: BirdType): void; aimTutorial(on: boolean): void;
  setMotion(reduced: boolean): void; hideAll(): void;
}
type NextInfo = { kind: 'level'; id: string } | { kind: 'locked'; starsMissing: number; episodeName: string } | { kind: 'end' };
```

### 1.4. Файлы

```
src/ui/
  UI.ts               фасад (§1.3), автомат экранов, history
  layout.ts           u, safe-area, портрет/летербокс (§2, §15)
  anim.ts             easing, popIn/popOut/shake, Timeline (§3.4, §4.8)
  iris.ts             ирис-шторка (§5.3)
  icons.ts            SVG-иконки (§4.2)  ·  star.ts — звезда SVG (§4.4)
  components.ts       button(), toggle(), segmented(), panel(), ribbon(), toast()
  screens/            Boot, Title, Episodes, Levels, Hud, Pause, Results, Lose, Settings, Rotate
  strings.ru.ts       все строки (§18)
  styles/tokens.css   :root-переменные (§3)  ·  components.css  ·  screens.css
src/input/InputRouter.ts   жесты и клавиатура (§16)
src/storage/progress.ts    сохранение (§17)
```

### 1.5. Связь с автоматом уровня (01 §13)

| `LevelState` (01) | UI |
|---|---|
| `LOADING` | ирис закрыт; если дольше 200 мс — карточка уровня (§6.4) |
| `INTRO_HOLD`, `INTRO_PAN` | ирис раскрывается от рогатки; лента «1-3 · Название» на 2.5 с; подпись «Коснитесь, чтобы пропустить» внизу (только если интро не повтор) |
| `READY`, `AIMING` | HUD активен; призрачный палец-подсказка на 1-1 (§10.5) |
| `FLYING` | подсказка способности (первый раз для каждого типа птицы) |
| `VICTORY_DELAY` | кнопки HUD работают; новых подсказок нет |
| `CLEARED_BANNER` | `showBanner('cleared')` + косметика «Одним выстрелом!» / «Чистая работа!» (01 §15) |
| `BONUS_COUNT` | HUD-счёт продолжает расти; тап — ускорить (`onSkip`) |
| `LOST_BANNER` | `showBanner('failed')` |
| `RESULTS` | HUD гаснет за 0.2 с; `showWin` / `showLose` |
| `PAUSED` | `showPause()` |

---

## 2. Масштаб и сетка

### 2.1. Единица `u`

```ts
// src/ui/layout.ts
export const REF_W = 1280, REF_H = 720;
export const U_MIN = 0.45, U_MAX = 1.25, COARSE_BOOST = 1.15;

export function computeUiScale(w: number, h: number, coarse: boolean): number {
  const k = Math.min(w / REF_W, h / REF_H) * (coarse ? COARSE_BOOST : 1);
  return Math.min(U_MAX, Math.max(U_MIN, k));
}

const probe = document.createElement('div');   // env() читается только из CSS, поэтому — элемент-зонд
probe.style.cssText =
  'position:fixed;inset:0;visibility:hidden;pointer-events:none;' +
  'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(probe);

export function readLayout() {
  const vv = window.visualViewport;
  const W = Math.round(vv ? vv.width : innerWidth), H = Math.round(vv ? vv.height : innerHeight);
  const cs = getComputedStyle(probe);
  const safe = { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  const coarse = matchMedia('(pointer: coarse)').matches;
  const u = computeUiScale(W - safe.l - safe.r, H - safe.t - safe.b, coarse);
  return { W, H, u, coarse, portrait: H > W, safe };
}

export function applyLayout(root: HTMLElement = document.documentElement) {
  const L = readLayout();
  root.style.setProperty('--u', `${L.u.toFixed(4)}px`);
  root.dataset.pointer = L.coarse ? 'coarse' : 'fine';
  root.dataset.form = L.coarse ? (Math.min(L.W, L.H) < 500 ? 'phone' : 'tablet') : 'desktop';
  root.dataset.orient = L.portrait ? 'portrait' : 'landscape';
  return L;
}
```

- Вызываем на старте, на `ResizeObserver(#stage)`, `visualViewport.resize` и `orientationchange`. CSS-переменная ставится сразу, а тяжёлое (размер canvas, кэш полос 04 §3.3) — с дебаунсом 100 мс.
- `×1.15` для `pointer: coarse` — палец толще курсора, поэтому на тач-устройствах всё крупнее.
- `U_MAX = 1.25`: на 4K и ультрашироких мониторах UI не раздувается, а сцена получает больше места.

### 2.2. Что получается на устройствах [замер: формула выше]

| Устройство (CSS px; для iPhone — без safe-area) | W/H | u | HUD-кнопка s 64u | Play xl 176u | Кнопка m 88u | Плитка уровня 112u | Счёт HUD 44u | Текст кнопки 28u | Мелкий текст 22u |
|---|---|---|---|---|---|---|---|---|---|
| Desktop 1920×1080 | 1.78 | 1.25 | 80 | 220 | 110 | 140 | 55 | 35 | 28 |
| Ноутбук 1366×768 | 1.78 | 1.07 | 68 | 188 | 94 | 119 | 47 | 30 | 23 |
| 1280×720 | 1.78 | 1.00 | 64 | 176 | 88 | 112 | 44 | 28 | 22 |
| UW 2560×1080 / 3440×1440 | 2.37–2.39 | 1.25 | 80 | 220 | 110 | 140 | 55 | 35 | 28 |
| iPad 1180×820 | 1.44 | 1.06 | 68 | 187 | 93 | 119 | 47 | 30 | 23 |
| iPhone 15, safe 793×372 | 2.13 | 0.59 | 44 | 105 | 52 | 67 | 26 | 17 | 14 |
| iPhone SE 667×375 | 1.78 | 0.60 | 44 | 105 | 53 | 67 | 26 | 17 | 14 |
| Android 800×360 | 2.22 | 0.57 | 44 | 101 | 52 | 64 | 26 | 16 | 14 |
| Android 915×412 | 2.22 | 0.66 | 44 | 116 | 58 | 74 | 29 | 18 | 14 |

Минимумы в px записываем прямо в CSS: `width: max(44px, calc(64 * var(--u)))`, `font-size: max(14px, calc(22 * var(--u)))`.

### 2.3. Безопасный макет и safe-area

- Минимум `H/u` на телефонах около 626u, минимум `W/u` около 1110u (iPad 4:3). Поэтому **каждый экран обязан помещаться в 1100×620 u**: контент центрируется, лишнее место занимает фон. Проверка в e2e (§21): при 640×360 и 800×360 нет прокрутки и обрезки.
- Canvas занимает весь экран, включая вырезы. В safe-area сдвигается только UI: `--inset-l: max(calc(20 * var(--u)), env(safe-area-inset-left))` (так же `-r/-t/-b`). На iPhone в ландшафте боковые отступы ≈ 47–59 px, нижний ≈ 21 px [наблюдение]. HUD и угловые кнопки стоят по этим отступам.
- `index.html` уже содержит `viewport-fit=cover` (без него `env()` всегда 0).
- Корень: `html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; background: #0B1A2B; }`, `#stage { position: fixed; inset: 0; }`. Высоту не задаём через `100vh` — на iOS это даёт прыжки под адресной строкой.

---

## 3. Дизайн-токены

### 3.1. Палитра

| Токен | Hex | Назначение |
|---|---|---|
| `--ink` | `#0B1A2B` | обводка панелей, ирис, текст-контур по умолчанию, фон за пределами летербокса |
| `--ink-2` | `#14324F` | обводка счёта HUD |
| `--white` | `#FFFFFF` | основной цвет текста и иконок |
| `--muted` | `#BFD6EE` | второстепенный текст на тёмной панели (8.58:1 [замер]) |
| `--sky-top` / `--sky-bot` | `#5BC0F5` / `#BFE9FF` | фон загрузки, `theme-color` |
| `--gold-hi` / `--gold` / `--gold-lo` / `--gold-edge` | `#FFF59A` / `#FFC21A` / `#F08A06` / `#8A4A00` | звёзды (04 §8.7), прогресс, лента победы |
| `--star-empty` | `#8A8F99` | пустая звезда на тёмной панели (3.95:1 к `#1A3352` [замер]; цвет `#6B6B6B` α0.5 из 01 на тёмном фоне даёт ≈2:1 — не берём) |
| `--red` / `--red-dk` | `#E0302A` / `#8E1512` | акцент логотипа, бейдж «НОВЫЙ РЕКОРД!» |
| `--panel-top` / `--panel-mid` / `--panel-bot` | `#2B5583` / `#1F3F63` / `#142A44` | тёмная панель (результаты, пауза) |
| `--paper-top` / `--paper-bot` / `--paper-edge` / `--paper-ink` / `--paper-muted` | `#FFF4D6` / `#F2D9A0` / `#7A4A1C` / `#4A2A0E` / `#7A5A3A` | «бумажная» панель (диалоги). Текст 11.77:1 и 5.72:1 [замер] |
| `--backdrop` | `rgba(6,14,24,0.5)` | затемнение под оверлеями |
| `--focus-in` / `--focus-out` | `#0B1A2B` / `#FFD84A` | двойное кольцо фокуса |
| Темы эпизодов (низ карточки) | meadow `#3E8E2E`, beach `#E58A2B`, snow `#3A7FC4` | карточки эпизодов, плашки уровня |

Варианты кнопок:

| Вариант | `--b-hi` | `--b-mid` | `--b-lo` | `--b-edge` | `--b-base` (цоколь) | Где |
|---|---|---|---|---|---|---|
| `green` | `#9BE65A` | `#5DBB2A` | `#3E9A1C` | `#1E5A0C` | `#2C6E12` | Играть, Продолжить, Дальше, Ещё раз |
| `blue` | `#7DD6FF` | `#2FA4EC` | `#1A7CC8` | `#0E3F70` | `#135C99` | Назад, Уровни, HUD, переключатели, плитки уровней |
| `orange` | `#FFD45E` | `#FF9E1B` | `#E8770C` | `#7A3500` | `#B65A06` | Заново, текущий уровень |
| `red` | `#FF8A7A` | `#EE3B2E` | `#C21F16` | `#5E0A06` | `#931A12` | Сбросить (опасное действие) |
| `gray` | `#C3CCD6` | `#9AA6B2` | `#6B7A8C` | `#3A4552` | `#4E5966` | закрытые плитки, `disabled` |

### 3.2. Типографика

Метрики [замер: opentype.js]: у Rubik капители центрированы в строке при `line-height: 1`. У Luckiest Guy (ascent 0.703, descent 0.297, высота капители 0.695) капители смещены вверх на 0.144em. Поэтому `.num { line-height: 1; padding-top: 0.14em; }`.

| Стиль | Шрифт | Размер | Минимум | Цвет | Обводка (`-webkit-text-stroke`, видна половина) | Где |
|---|---|---|---|---|---|---|
| `logo-2` | Rubik 900 | 140u | 48px | градиент `#FFE36A → #FFB21A → #F07A12` | 0.20em `#7A1A0A` + тень `0 0.06em 0 #4A0E06` | «ПТИЦЫ» |
| `logo-1` | Rubik 900 | 92u | 32px | тот же | 0.20em `#7A1A0A` | «СЕРДИТЫЕ» |
| `ribbon` | Rubik 900, uppercase | 44u | 24px | `#FFFFFF` | 0.18em цвет `--b-edge` ленты | ленты победы и поражения |
| `h1` | Rubik 900, uppercase | 44u | 22px | `#FFFFFF` | 0.18em `--ink` | заголовки экранов |
| `h2` | Rubik 900 | 30u | 18px | `#FFFFFF` | 0.16em `--ink` | названия эпизодов, «ПАУЗА» |
| `btn` | Rubik 900, uppercase, `letter-spacing: 0.02em` | 28u | 16px | `#FFFFFF` | 0.18em `--b-edge` | текст в «таблетках» |
| `body` | Rubik 700 | 24u | 15px | `#FFFFFF` / `--muted` | 0.14em `--ink`, если стоит над сценой | подсказки, советы |
| `caption` | Rubik 700 | 20u | 14px | `--muted` | — (на панели) | подписи под кнопками паузы, версия |
| `num-xl` | Luckiest Guy | 76u | 36px | `#FFFFFF` | 0.14em `--ink` | счёт в результатах |
| `num-l` | Luckiest Guy | 44u | 26px | `#FFFFFF` | 0.16em `--ink-2` | счёт HUD |
| `num-m` | Luckiest Guy | 52u | 26px | `#FFFFFF` | 0.14em `--b-edge` плитки | номера уровней |
| `num-s` | Luckiest Guy | 30u | 16px | `#FFFFFF` | 0.14em `--ink` | счётчики ★ |

- Ширина строк при Rubik 900 / 56 px [замер]: «УРОВЕНЬ ПРОЙДЕН!» 608 px, «УРОВЕНЬ НЕ ПРОЙДЕН» 680, «НОВЫЙ РЕКОРД!» 506, «ПОВЕРНИТЕ УСТРОЙСТВО» 783. При 30 px: «ПРОДОЛЖИТЬ» 238, «СБРОСИТЬ ПРОГРЕСС» 348. Отсюда лента 44u (≤ 534u при полезной ширине 624u) и таблетки с `min-width: 200u; padding: 0 32u`.
- Глифы [замер]: NBSP U+00A0 есть в обоих шрифтах (её вставляет `toLocaleString('ru-RU')`: «12 340» = `31 32 A0 33 34 30`). Символы «» — … × есть только в латинском подмножестве Rubik, а `unicode-range` из 04 §9.2 их покрывает. **★ (U+2605), ← → и U+202F нет ни в одном шрифте** — в тексте их не используем, звёзды и стрелки только SVG.
- Обводка: `.t-stroke { -webkit-text-stroke: var(--stroke) var(--stroke-c); paint-order: stroke fill; }`. Видимая толщина — половина `--stroke`. Тень — `filter: drop-shadow(0 0.06em 0 rgba(0,0,0,0.3))` на **неанимируемом** родителе.

### 3.3. Обводки, тени, радиусы

| Элемент | Радиус | Обводка | Тень |
|---|---|---|---|
| Круглая кнопка | 50% | `max(2px, 4u)` `--b-edge` | `0 6u 0 var(--b-base), 0 10u 14u rgba(0,0,0,.35)` + inset `0 -6u 0 rgba(0,0,0,.18)`, `0 3u 0 rgba(255,255,255,.45)` |
| Таблетка | `height/2` | то же | то же |
| Тёмная панель | 40u | 6u `--ink` | `0 16u 0 rgba(0,0,0,.25), 0 24u 48u rgba(0,0,0,.35)`, inset `0 3u 0 rgba(255,255,255,.18)` |
| Бумажная панель | 32u | 6u `--paper-edge` | как у тёмной; inset `0 0 0 3u rgba(255,255,255,.6)` |
| Плитка уровня | 22u | 4u `--b-edge` | `0 6u 0 var(--b-base)` |
| Карточка эпизода | 28u | 6u `#FFFFFF` + внешняя 3u `--ink` | `0 12u 0 rgba(0,0,0,.25)` |
| Пилюля HUD или тоста | 22u | — | фон `rgba(11,26,43,.55)` |

### 3.4. Движение: длительности и easing

| Токен | Значение | Где |
|---|---|---|
| `--d-press` | 70 мс | нажатие кнопки |
| `--d-fast` | 160 мс | hover, выход pop-out, фейды HUD |
| `--d-base` | 250 мс | backdrop, тосты |
| `--d-pop` | 360 мс | pop-in панелей, плиток, кнопок |
| `--d-screen` | 420 мс | слайд экранов (вход 360 + выход 240 параллельно), зум карточки |
| ирис | 450 закрытие / 500 раскрытие | меню↔игра |
| `--e-out` | `cubic-bezier(0.33, 1, 0.68, 1)` | easeOutCubic — по умолчанию для входов |
| `--e-in` | `cubic-bezier(0.32, 0, 0.67, 0)` | easeInCubic — выходы |
| `--e-inout` | `cubic-bezier(0.65, 0, 0.35, 1)` | зум карточки, перелёт ленты |
| `--e-back` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | easeOutBack (s = 1.70158): выезд панелей, лента, бейджи |
| `--e-in-back` | `cubic-bezier(0.36, 0, 0.66, -0.56)` | «втягивание» кнопки Play |

Значения кривых — с easings.net [факт]. JS-версии для таймлайнов:

```ts
export const ease = {
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
} as const;
```

---

## 4. Компоненты

### 4.1. Кнопка

Анатомия, снаружи внутрь: цоколь (тень `0 6u 0 --b-base`, «толщина» кнопки) → обводка 4u → тело (вертикальный градиент `--b-hi` 0% → `--b-mid` 52% → `--b-lo` 100%) → нижняя внутренняя тень 6u → блик (`::before`, эллипс в верхних 40%) → иконка или текст с обводкой цвета `--b-edge` → `::after` расширяет хит-зону до 44×44.

| Размер | Диаметр или высота | Минимум | Иконка | Где |
|---|---|---|---|---|
| `xs` | 56u | 44px | 28u | веер настроек на титуле, закрыть диалог |
| `s` | 64u | 44px | 32u | HUD: пауза, рестарт, «К рогатке» |
| `m` | 88u | 52px | 44u | Заново, Уровни (пауза и результаты), Назад |
| `l` | 120u | 64px | 60u | Продолжить, Дальше, Ещё раз |
| `xl` | 176u | 96px | 84u | Играть |
| `pill` | высота 64u, `min-width` 200u | 44px | 32u слева от текста | диалоги, «Играть так», «Сбросить» |

```css
.btn {
  --size: calc(88 * var(--u));
  position: relative; display: inline-grid; place-items: center;
  width: max(44px, var(--size)); height: max(44px, var(--size)); border-radius: 50%;
  border: max(2px, calc(4 * var(--u))) solid var(--b-edge);
  background: linear-gradient(180deg, var(--b-hi) 0%, var(--b-mid) 52%, var(--b-lo) 100%);
  box-shadow: 0 calc(6 * var(--u)) 0 var(--b-base), 0 calc(10 * var(--u)) calc(14 * var(--u)) rgba(0,0,0,.35),
              inset 0 calc(-6 * var(--u)) 0 rgba(0,0,0,.18), inset 0 calc(3 * var(--u)) 0 rgba(255,255,255,.45);
  transition: transform var(--d-fast) var(--e-back), filter var(--d-fast);
  -webkit-tap-highlight-color: transparent; touch-action: manipulation; user-select: none; cursor: pointer;
}
.btn::before { content: ''; position: absolute; inset: 7% 16% 55% 16%; border-radius: 50%;
  background: linear-gradient(rgba(255,255,255,.7), rgba(255,255,255,.05)); pointer-events: none; }
.btn::after { content: ''; position: absolute; inset: min(-4px, calc((var(--size) - 44px) / 2)); border-radius: 50%; }
.btn > svg { width: 50%; height: 50%; overflow: visible; filter: drop-shadow(0 calc(2 * var(--u)) 0 rgba(0,0,0,.25)); }
@media (hover: hover) { .btn:hover { transform: scale(1.04); filter: brightness(1.07); } }
.btn:active, .btn.is-pressed { transform: translateY(calc(4 * var(--u))) scale(.96); transition-duration: var(--d-press);
  box-shadow: 0 calc(2 * var(--u)) 0 var(--b-base), inset 0 calc(-3 * var(--u)) 0 rgba(0,0,0,.18); }
.btn:disabled, .btn[aria-disabled=true] { filter: grayscale(.7) brightness(.9); opacity: .7; cursor: default; }
.btn:focus-visible { outline: none; box-shadow: 0 0 0 calc(3 * var(--u)) var(--focus-in), 0 0 0 calc(7 * var(--u)) var(--focus-out); }
.btn--green  { --b-hi:#9BE65A; --b-mid:#5DBB2A; --b-lo:#3E9A1C; --b-edge:#1E5A0C; --b-base:#2C6E12; }
.btn--blue   { --b-hi:#7DD6FF; --b-mid:#2FA4EC; --b-lo:#1A7CC8; --b-edge:#0E3F70; --b-base:#135C99; }
.btn--orange { --b-hi:#FFD45E; --b-mid:#FF9E1B; --b-lo:#E8770C; --b-edge:#7A3500; --b-base:#B65A06; }
.btn--red    { --b-hi:#FF8A7A; --b-mid:#EE3B2E; --b-lo:#C21F16; --b-edge:#5E0A06; --b-base:#931A12; }
.btn--gray   { --b-hi:#C3CCD6; --b-mid:#9AA6B2; --b-lo:#6B7A8C; --b-edge:#3A4552; --b-base:#4E5966; }
.btn--pill { width: auto; min-width: calc(200 * var(--u)); height: max(44px, calc(64 * var(--u)));
  border-radius: 999px; padding: 0 calc(32 * var(--u)); gap: calc(12 * var(--u)); grid-auto-flow: column; }
```

Поведение:
- `click` срабатывает по `pointerup` внутри кнопки, звук `audio.ui('click')`, а для «Назад» — `ui('back')`.
- На `pointerdown` кнопок HUD вызываем `stopPropagation()`: иначе тап по паузе в полёте включит способность (02 §3: способность — «тап вне UI»).
- Hover-звук `ui('hover')` — только при `(hover: hover)`, не чаще раза в 40 мс.
- Анимации-циклы (пульс, покачивание) вешаем на **обёртку** `.btn-wrap`, а не на `.btn`: transform кнопки занят нажатием.

### 4.2. Иконки (inline SVG, `viewBox="0 0 24 24"`)

Стиль иконок с заливкой: `fill="#FFF" stroke="var(--b-edge)" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke"`. Иконки-линии рисуем дважды через `<use>`: сначала `stroke="var(--b-edge)" stroke-width="7"`, сверху `stroke="#FFF" stroke-width="3.2"`. У обоих `fill="none" stroke-linecap="round" stroke-linejoin="round"`.

| Имя | Тип | Геометрия |
|---|---|---|
| `play` | заливка | `M8 5.5v13l10.5-6.5z` |
| `pause` | заливка | `M6.5 5h4v14h-4zM13.5 5h4v14h-4z` |
| `restart` | линия | `M19 12a7 7 0 1 1-2.05-4.95` + `M17 2.8V7h-4.2` (вершина шеврона в конце дуги) |
| `levels` | заливка | 9 `<rect width="4" height="4" rx="1">` в точках x, y ∈ {3.5, 10, 16.5} |
| `next` | заливка | `M5.5 5.5v13L15 12zM16.5 5.5h2.5v13h-2.5z` |
| `back` | линия | `M15 5l-7 7 7 7` |
| `home` | линия | `M4 11.5 12 4.5l8 7M6.5 10v9.5h11V10` |
| `gear` | линия | `<circle r="5.6" stroke-width="3.6"/>` (кольцо) + `<circle r="8.4" stroke-width="2.6" stroke-dasharray="3.3 3.3"/>` (8 зубцов: 2π·8.4/16 = 3.3) |
| `music` | смешанный | линия `M9 17.5V6.5l10-2.5v11` + `<circle cx="6.8" cy="17.5" r="2.6"/>`, `<circle cx="16.8" cy="15" r="2.6"/>` с заливкой |
| `sound` | смешанный | заливка `M3.5 9.5h4l5-4.5v14l-5-4.5h-4z` + линии `M15.5 9a4 4 0 0 1 0 6`, `M18 6.5a7.5 7.5 0 0 1 0 11` |
| `off` (поверх music или sound) | линия | `M4.5 4.5l15 15`: снизу `#FFF` width 6.5, сверху `#E8352B` width 3 |
| `lock` | смешанный | `<rect x="5" y="10.5" width="14" height="10" rx="2.5"/>` + дужка `M8 10.5V8a4 4 0 0 1 8 0v2.5` (линия 2.8) + `<circle cx="12" cy="15.3" r="1.5" fill="var(--b-edge)"/>` |
| `star` | заливка | `M12 2.3L15.12 8.61L22.08 9.62L17.04 14.54L18.23 21.48L12 18.2L5.77 21.48L6.96 14.54L1.92 9.62L8.88 8.61Z` [замер: R 10.6, r 0.5R, центр (12, 12.9)] |
| `fullscreen` | линия | `M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5` |
| `close` | линия | `M6.5 6.5l11 11M17.5 6.5l-11 11` |
| `info` | линия | `<circle r="9"/>` + `M12 11v6` + точка `<circle cx="12" cy="7.5" r="1.4" fill>` |
| `aim` | линия | `<circle r="6.5"/>` + `M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4` |
| `sling` (К рогатке) | линия | `M12 21V13M12 13 7 4M12 13l5-9` + дуга резинки `M7 4q5 6 10 0` |
| `phone` (оверлей поворота) | линия | `<rect x="7" y="2.5" width="10" height="19" rx="2.2"/>` + `M10.5 18.5h3` |

### 4.3. Панели и лента-заголовок

- `.panel--dark`: `background: linear-gradient(180deg, #2B5583 0%, #1F3F63 45%, #142A44 100%)`, токены — §3.3. Внутренние отступы 32u. Опция `backdrop-filter: blur(6px)` за панелью — только при `quality = high` и `pointer: fine`.
- `.panel--paper`: `linear-gradient(#FFF4D6, #F2D9A0)`, текст `--paper-ink`.
- **Лента** (`ribbon.ts`, SVG `viewBox="0 0 760 120"`, ширина 760u, текст — HTML поверх):

```html
<svg viewBox="0 0 760 120" class="ribbon" aria-hidden="true">
  <path d="M10 40H130V114H10L42 77Z" fill="var(--r-tail)" stroke="var(--r-edge)" stroke-width="6" stroke-linejoin="round"/>
  <path d="M750 40H630V114H750L718 77Z" fill="var(--r-tail)" stroke="var(--r-edge)" stroke-width="6" stroke-linejoin="round"/>
  <path d="M100 100L130 114V100Z M660 100L630 114V100Z" fill="var(--r-edge)"/>
  <rect x="68" y="8" width="624" height="96" rx="14" fill="url(#rg)" stroke="var(--r-edge)" stroke-width="6"/>
  <rect x="80" y="16" width="600" height="18" rx="9" fill="#FFF" opacity=".28"/>
</svg>
```

| Лента | `#rg`: 0 / 0.5 / 1 | `--r-tail` | `--r-edge` |
|---|---|---|---|
| Победа | `#FFD45E` / `#FF9E1B` / `#E8770C` | `#B65A06` | `#7A3500` |
| Поражение | `#FF8A7A` / `#EE3B2E` / `#C21F16` | `#931A12` | `#5E0A06` |
| Инфо (лента уровня, «ПАУЗА») | `#7DD6FF` / `#2FA4EC` / `#1A7CC8` | `#135C99` | `#0E3F70` |

### 4.4. Звезда

- SVG `viewBox="0 0 100 100"`, путь `M50 3L64.7 32.8L97.6 37.5L73.8 60.7L79.4 93.5L50 78L20.6 93.5L26.2 60.7L2.4 37.5L35.3 32.8Z` [замер].
- Заполненная звезда — по 04 §8.7: обводка `#8A4A00` шириной 11 (0.22R), вертикальный градиент `#FFF59A` → `#FFC21A` (45%) → `#F08A06`, блик-эллипс `cx 40 cy 30 rx 22 ry 11`, поворот −23°, белый α0.45, обрезан по форме звезды (`clipPath`).
- Пустая: заливка `--star-empty`, обводка `#0B1A2B` α0.6 шириной 9, без блика.
- Размеры: результаты — 112u по бокам и 144u в центре; плитка уровня — 28u по бокам и 34u в центре; счётчик эпизода — 32u; карточка паузы — 40u.

### 4.5. Переключатели и сегменты

- **Круглый переключатель** (музыка, звук, прицел): `.btn--blue` нужного размера + `aria-pressed`. В выключенном состоянии поверх иконки линия `off`, а сама кнопка уходит в `gray`. Анимация смены: иконка `scale 1 → 0.8 → 1` за 0.16 с. Звук `ui('toggleOn' | 'toggleOff')`.
- **Свитч** в диалоге: дорожка 88×48u, `border-radius: 24u`. Выкл — `#B9A27A`, вкл — `#5DBB2A`, обводка 3u `--paper-edge`. Ручка 40u `#FFFFFF`, тень `0 3u 0 rgba(0,0,0,.25)`, ход 40u за 0.15 с `--e-out`. `role="switch" aria-checked`.
- **Сегменты** (качество, анимации, прицел): высота 52u, радиус 26u, фон `#E8C98A`, обводка 3u `--paper-edge`. Выбранный сегмент — синяя таблетка (`blue`) с белым текстом и обводкой; переезд подложки 0.2 с `--e-back`. `role="radiogroup"`, стрелки ←/→ переключают.

### 4.6. Тост, тултип, бейдж

- **Тост**: внизу по центру (`bottom: --inset-b + 32u`), `max-width: 640u`, фон `rgba(11,26,43,.78)`, радиус 22u, отступы 14u × 24u, текст `body`. Вход — `translateY(24u) → 0` и opacity за 0.25 с `--e-back`; выход — opacity за 0.2 с. Показ 2.5 с по умолчанию. Одновременно виден один тост, новые встают в очередь. Каждый тост дублируется в `aria-live="polite"`.
- **Тултип рекорда** (только `hover: hover`): над плиткой, `rgba(11,26,43,.9)`, 18u, стрелка 10u, появление через 250 мс после наведения.
- **Бейдж «НОВЫЙ РЕКОРД!»**: 230×60u, радиус 30u, градиент `#FF5A4A → #E0302A → #8E1512`, обводка 4u `#5E0A06`, текст `btn` 22u. Поворот −12°. Вход: `scale 2.2 → 0.9 → 1` и opacity 0 → 1 за 0.3 с. Затем бесконечное покачивание ±4° с частотой 1.2 Гц (01 §10).

### 4.7. Прогресс-бар

Дорожка 520×36u, радиус 18u, фон `rgba(11,26,43,.35)`, обводка 4u `--ink`. Заливка — `linear-gradient(#FFE36A, #FFB21A)` + диагональные полосы `repeating-linear-gradient(-45deg, rgba(255,255,255,.25) 0 12u, transparent 12u 24u)`. Полосы едут через `background-position` за 0.6 с linear infinite (при reduced — стоят). Ширина заливки — `transform: scaleX(p)` с `transform-origin: left`, а не `width`.

### 4.8. Пресеты анимаций (`anim.ts`)

```ts
export const motion = { reduced: false };
export function popIn(el: Element, delayMs = 0): Animation {
  if (motion.reduced)
    return el.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }],
      { duration: 150, delay: delayMs, easing: CSS_EASE.out, fill: 'backwards' });
  return el.animate([
    { opacity: 0, transform: 'scale(0.3)', easing: CSS_EASE.out },
    { opacity: 1, transform: 'scale(1.08)', offset: 0.6, easing: 'ease-in-out' },
    { transform: 'scale(0.97)', offset: 0.8, easing: 'ease-in-out' },
    { opacity: 1, transform: 'none' },
  ], { duration: 360, delay: delayMs, fill: 'backwards' });   // backwards: элемент скрыт во время задержки
}
export function popOut(el: Element): Animation {
  return el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.9)' }],
    { duration: motion.reduced ? 120 : 160, easing: CSS_EASE.in, fill: 'forwards' });
}
export function shake(el: Element): Animation {             // «закрыто»: 0 → −10 → 9 → −6 → 4 → 0 u за 0.36 с
  return el.animate([0, -10, 9, -6, 4, 0].map((x) => ({ transform: `translateX(calc(${x} * var(--u)))` })),
    { duration: 360, easing: 'ease-out' });
}
```

CSS-циклы:

```css
@keyframes pulse   { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }              /* 1.4 с ease-in-out ∞ */
@keyframes ring    { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(1.35); opacity: 0; } } /* 1.4 с ease-out ∞ на ::after-кольце 4u #FFF */
@keyframes wiggle  { 0%, 8.3%, 100% { transform: rotate(0); } 2% { transform: rotate(-6deg); } 4% { transform: rotate(5deg); } 6% { transform: rotate(-3deg); } } /* 6 с ∞: дрожь первые 0.5 с */
@keyframes stripes { to { background-position: calc(34 * var(--u)) 0; } }
@keyframes bob     { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(calc(-8 * var(--u))); } }
[data-motion=reduced] *, [data-motion=reduced] *::before, [data-motion=reduced] *::after { animation-iteration-count: 1 !important; animation-duration: 1ms !important; }
```

Задержка между элементами при появлении: кнопки 60 мс, плитки уровней 30 мс (порядок чтения), карточки эпизодов 60 мс, буквы логотипа 40 мс.

---

## 5. Поток экранов и переходы

### 5.1. Карта

```
[boot: прогресс + советы] ─fade 0.4─► [title: живой фон, ИГРАТЬ] ─slide─► [episodes: карточки]
                                                                              │ зум карточки 0.42
                                                                              ▼
[game: HUD] ◄──── ирис: закрытие к плитке 0.45 → загрузка → раскрытие от рогатки 0.5 ──── [levels: сетка 5×2]
  │  ├─ ‖ / Esc ──► [pause: панель слева]  ─ Продолжить / Заново (фейд) / Уровни (ирис)
  │  ├─ победа ──► лента 1.2 с ─► бонус птиц ─► [results-won] ─ Дальше (ирис) / Заново (фейд) / Уровни (ирис)
  │  └─ поражение ► лента 1.0 с ────────────► [results-lost] ─ Ещё раз (фейд) / Уровни (ирис)
```

### 5.2. Таблица переходов

| Откуда → куда | Тип | Длительность | Easing | Звук | Примечание |
|---|---|---|---|---|---|
| boot → title | кроссфейд экранов | 0.4 с | `--e-out` | — | фон меню уже на canvas, остаётся |
| title → episodes | выход титула (буквы вверх −40u, opacity 0, по 15 мс; Play `scale 1 → 0` с `--e-in-back` 0.25 с) + вход эпизодов (слайд справа) | 0.25 + 0.36 с, внахлёст на 0.1 с | см. «слайд» | `whoosh` | камера меню едет на +4 м за 0.6 с — параллакс даёт глубину [рекомендация] |
| меню → меню (вперёд) | **слайд**: новый `translateX(24%) → 0`, opacity 0 → 1 за 0.36 с `--e-out`; старый `0 → −12%`, opacity 1 → 0 за 0.24 с `--e-in` | 0.36 с | | `whoosh` | |
| меню → меню (назад) | зеркально: новый из −24%, старый уходит в +12% | 0.36 с | | `back` | |
| episodes → levels | **зум карточки** (FLIP, §5.4) | 0.42 с + 0.2 фейд клона | `--e-inout` | `whoosh` | фон меню меняет тему кроссфейдом 0.5 с |
| levels → episodes | обратный зум (клон сжимается в карточку) | 0.2 + 0.42 с | `--e-inout` | `back` | |
| levels → game | **ирис**: закрытие к центру плитки, удержание ≥ 0.12 с (загрузка), раскрытие от экранной точки рогатки | 0.45 + ≥0.12 + 0.5 с | `inCubic` / `outCubic` | `whoosh` на старте закрытия | музыка меню гаснет за 0.6 с, включается эмбиент (05 §3) |
| game → levels (из паузы или результатов) | ирис: закрытие к нажатой кнопке, раскрытие от плитки текущего уровня | 0.45 + 0.5 с | то же | `whoosh` | `playMusic('menu')` |
| results → следующий уровень | ирис: закрытие к «Дальше», раскрытие от рогатки | 0.45 + 0.5 с | то же | `whoosh` | полное интро (01 §12.3) |
| рестарт (HUD, R, пауза, результаты) | фейд в `--ink` | 0.15 с + пересоздание мира + 0.2 с | linear | — | до `READY` ≈ 1.9 с (01 §12.3) |
| открыть оверлей (пауза, результаты) | backdrop opacity 0 → 1 за 0.25 с + выезд панели | 0.3–0.4 с | `--e-out` / `--e-back` | `popIn` | |
| открыть диалог | backdrop 0.2 с + pop-in панели | 0.36 с | §4.8 | `popIn` | фокус на первый элемент |
| закрыть оверлей или диалог | pop-out 0.16 с + backdrop 0.2 с | 0.2 с | `--e-in` | `back` | фокус возвращается на вызвавший элемент |
| любое → «поверните» | фейд оверлея | 0.25 с | linear | — | игра на автопаузе |
| при reduced motion | **все переходы** — кроссфейд | 0.15 с | linear | те же | §19.3 |

### 5.3. Ирис-шторка (`iris.ts`)

SVG поверх всего: прямоугольник `--ink` с маской-дыркой. Радиус дырки анимируется из JS, так что ни layout, ни clip-path не участвуют. По краю дырки внутри идёт тёмный обод 10u α0.35 — «мультяшная виньетка». CSS: `.iris { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 60; }`.

```ts
export class Iris {
  private readonly svg = document.createElementNS(NS, 'svg');
  private readonly hole = document.createElementNS(NS, 'circle');
  private readonly ring = document.createElementNS(NS, 'circle');
  constructor(parent: HTMLElement, color = '#0B1A2B') {
    this.svg.setAttribute('class', 'iris');
    this.svg.innerHTML =
      `<defs><mask id="iris-m"><rect width="100%" height="100%" fill="#fff"/></mask></defs>` +
      `<rect width="100%" height="100%" fill="${color}" mask="url(#iris-m)"/>`;
    this.hole.setAttribute('fill', '#000');
    this.svg.querySelector('mask')!.appendChild(this.hole);
    this.ring.setAttribute('fill', 'none'); this.ring.setAttribute('stroke', '#000'); this.ring.setAttribute('stroke-opacity', '0.35');
    this.svg.appendChild(this.ring);
    this.svg.style.display = 'none';
    parent.appendChild(this.svg);
  }
  run(kind: 'close' | 'open', x: number, y: number, durMs = kind === 'close' ? 450 : 500): Promise<void> {
    const W = innerWidth, H = innerHeight;
    const rMax = Math.hypot(Math.max(x, W - x), Math.max(y, H - y)) + 8;       // до дальнего угла
    const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 1;
    this.svg.style.display = 'block';
    for (const c of [this.hole, this.ring]) { c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y)); }
    this.ring.setAttribute('stroke-width', String(10 * u));
    if (motion.reduced) return this.fade(kind);                                 // кроссфейд 150 мс
    return new Promise((done) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / durMs);
        const r = kind === 'close' ? rMax * (1 - ease.inCubic(k)) : rMax * ease.outCubic(k);
        this.hole.setAttribute('r', String(r));
        this.ring.setAttribute('r', String(Math.max(0, r - 5 * u)));           // обод внутри дырки
        if (k < 1) requestAnimationFrame(step);
        else { if (kind === 'open') this.svg.style.display = 'none'; done(); }
      };
      requestAnimationFrame(step);
    });
  }
  // fade(): тот же svg, r = 0, opacity 0 ↔ 1 за 150 мс (WAAPI, прошлая анимация отменяется)
}
```

Порядок `levels → game`: `await iris.run('close', tile)` → `deps.onStartLevel()` (LOADING, < 300 мс по 01) → камера ставится в позицию `INTRO_HOLD` → `slingScreen = camera.worldToScreen(level.slingshot)` → `iris.run('open', slingScreen)`. Интро-облёт (01 §6.3) начинается одновременно с раскрытием.

### 5.4. Зум карточки (FLIP) и слайд

1. `r0 = card.getBoundingClientRect()`. Клон карточки ставим `position: fixed` на `r0`, `transform-origin: 0 0`. Оригинал прячем через `visibility: hidden`.
2. Остальные карточки и шапка: opacity → 0 за 0.2 с.
3. Клон: `transform: translate(r0.x, r0.y) scale(r0.w/W, r0.h/H) → none`, при этом `width: W; height: H` задаются заранее (анимируется только transform). 0.42 с `--e-inout`, `border-radius` 28u → 0. Арт карточки растягивается — это ок, он сразу гаснет.
4. Монтируем экран уровней. Клон: opacity → 0 за 0.2 с. Плитки появляются pop-in по очереди через 30 мс.

### 5.5. Музыка и фон по экранам

| Экран | Canvas | Звук (05) |
|---|---|---|
| boot | небо `--sky-top → --sky-bot` (без `Background`) | тишина: контекст ещё `suspended` |
| title | `Background('meadow')`, «живая сцена» §7.3 | полька после первого жеста (тап по «Играть» или по экрану) |
| episodes | тема карточки в центре, кроссфейд 0.5 с при смене | полька продолжается без перезапуска |
| levels | тема эпизода, статичная камера, виньетка `radial-gradient(transparent 55%, rgba(11,26,43,.35))` | полька |
| game | уровень | `playMusic('level', theme)`; пауза — `setPaused(true)`; результаты — джингл по `levelEnd` |

---

## 6. Экран загрузки (boot)

### 6.1. Этапы и вес в прогрессе

| Этап | Вес | Время (ориентир, средний ноутбук) | Комментарий |
|---|---|---|---|
| DOM, CSS, `applyLayout` | 5% | < 20 мс | |
| `loadFonts()` (04 §9.2) | 20% | 30–150 мс | до этого текст не показываем (иначе мигнёт системный шрифт) |
| Предгенерация спрайтов: птицы ×3 позы, свиньи, рогатка, звёзды UI | 55% | 150–500 мс | нарезка по 8 мс на кадр, иначе бар не перерисуется |
| Полосы фона меню (meadow) | 15% | 30–80 мс | |
| `new AudioContext()` (suspended), `Progress.load()` | 5% | < 10 мс | запекание звука — после разблокировки (05 §3) |

```ts
async function runTasks(tasks: Array<{ w: number; run: () => void }>, onP: (p: number) => void) {
  const total = tasks.reduce((s, t) => s + t.w, 0); let done = 0, t0 = performance.now();
  for (const t of tasks) {
    t.run(); done += t.w;
    if (performance.now() - t0 > 8) { onP(done / total); await new Promise(requestAnimationFrame); t0 = performance.now(); }
  }
  onP(1);
}
```

- Видимый прогресс сглаживается: `shown += (target − shown) · (1 − exp(−dt / 0.15))`. В конце бар заполняется до 100%, держится 150 мс, затем кроссфейд 0.4 с в титул.
- Минимальное время показа — 700 мс: брендовый момент и защита от мигания.

### 6.2. Макет (в безопасном боксе 1100×620u)

| Элемент | Позиция | Вид |
|---|---|---|
| Фон | весь экран | `linear-gradient(#5BC0F5, #BFE9FF)` + полоса земли 18% высоты `linear-gradient(#7CCB4A, #4E9A2E)` с травяной кромкой (SVG-волна, амплитуда 10u) |
| Лоадер-птица | центр, y = 200u | красный круг 120u (`#E0302A`, обводка 6u `#5A0E0B`, белое брюшко, брови), подпрыгивает (`bob`, 0.6 с), тень-эллипс сжимается в такт. Рисуется SVG-примитивами, без логотипа |
| Логотип-миниатюра | под птицей, y = 320u | «СЕРДИТЫЕ ПТИЦЫ» `logo-1` 48u, одной строкой |
| Прогресс-бар | y = 420u | §4.7 |
| Подпись | под баром +16u | «Загрузка… 63%» — `caption`, `#FFFFFF`, обводка `--ink` |
| Совет | y = 520u, ширина ≤ 900u | `body`, по центру, обводка 0.14em `--ink`. Смена каждые 4 с: fade out 0.25 с → fade in 0.25 с. Первый совет — через 0.5 с после старта |

### 6.3. Ошибка загрузки

Если на любом этапе выброшено исключение (кроме отказа звука — без звука игра идёт), на месте бара показывается бумажная панель 640×300u: «Не удалось запустить игру», «Обновите страницу. Если не поможет — попробуйте другой браузер.» и `pill` «Обновить» (`location.reload()`). Текст ошибки — в `console.error` и в `<details>` мелким шрифтом.

### 6.4. Карточка загрузки уровня

Показывается под закрытым ирисом, если `LOADING` длится дольше 200 мс; держится не меньше 600 мс, чтобы не мигать. По центру на `--ink`: «1-3» (`num-xl` 76u), название уровня (`h2`), случайный совет (`body`, `--muted`), маленькая птица-лоадер 64u.

---

## 7. Титульный экран

### 7.1. Макет (1280×720u, безопасный бокс по центру)

| Элемент | Позиция (u) | Размер | Поведение |
|---|---|---|---|
| Логотип «СЕРДИТЫЕ / ПТИЦЫ» | центр X, верх 48 | ширина ≈ 760, высота ≈ 250 | §7.2 |
| Плашка «фан-ремейк» | под логотипом справа, поворот −3° | 22u, отступы 6 × 16u | `#FFFFFF` на `#E0302A`, обводка 3u `#8E1512` |
| Кнопка «Играть» | центр X, центр Y = 440 | `xl` 176u, `green`, иконка `play` 84u | пульс + кольцо + покачивание (§7.4). `aria-label="Играть"` |
| Шестерёнка | левый нижний угол по `--inset` | `s` 64u, `blue` | раскрывает веер вверх (§7.5) |
| «Об игре» | правый нижний угол | `s` 64u, `blue`, `info` | диалог credits |
| Полный экран | правый нижний, левее «Об игре» на 80u | `s` 64u, `fullscreen` | скрыт, если `!document.fullscreenEnabled` (iPhone) |
| Строка версии | низ по центру, +12u от `--inset-b` | 14px, `#FFFFFF` α0.7, обводка `--ink` | «v0.1.0 · фанатский проект, не связан с Rovio» |

### 7.2. Логотип (DOM-текст, не картинка)

- Две строки, каждая буква — `<span>`. Буквы чередуют наклон и смещение: `rotate(±3°)`, `translateY(±0.03em)`, порядок −, +, −, +… Строка 1 повёрнута на −3°, строка 2 — на −2°.
- Заливка — `background: linear-gradient(180deg, #FFE36A 0%, #FFB21A 55%, #F07A12 100%); -webkit-background-clip: text; color: transparent`. Обводку даёт **отдельный слой-дубль** под буквой: `::before { content: attr(data-ch); -webkit-text-stroke: 0.2em #7A1A0A; }`. Причина: `paint-order` с градиентным `background-clip:text` ведёт себя по-разному в разных браузерах [рекомендация]. Сверху — белый блик: `::after` с `clip-path: inset(0 0 60% 0)` и `color: rgba(255,255,255,.35)`.
- Вход: буквы падают сверху `translateY(−120%) → 0` за 0.5 с `--e-back`, по 40 мс на букву; приземление — сжатие `scaleY 0.85` на 80 мс. Ожидание: раз в 5 с по буквам бежит «волна» — прыжок 0.08em, 0.3 с, сдвиг по фазе 50 мс.
- Не повторяем шрифт и форму логотипа Rovio (Feast of Flesh BB, 04 §источники): только общий «пухлый» стиль.

### 7.3. Живой фон (canvas, режим `menu`)

- Камера: `x(t) = x0 + 6·sin(2πt / 40)` м, `viewH = 15` м. Облака дрейфуют по 04 §3.
- Слева рогатка с Ред (поза idle, моргание 2–5 с). Справа статичный домик из 4–6 деревянных блоков (спрайты 04, **без физики**) и 2–3 свиньи: раз в U(5, 9) с одна моргает, хихикает (`laugh`, 0.8 с) или подпрыгивает на 0.3 м.
- Раз в U(4, 7) с через кадр пролетает птица (случайная из открытых): парабола из-за левого края, вершина на 60–80% высоты экрана, полёт 2.2–3.0 с, вращение 1–2 рад/с, след «пуфов» (01 §3.3).
- Логотип и кнопки — DOM над сценой. За логотипом радиальная подсветка `radial-gradient(rgba(255,255,255,.35), transparent 70%)`.
- При reduced motion: камера стоит, птицы не летают, облака дрейфуют медленнее в 3 раза.

### 7.4. Кнопка «Играть»

- Обёртка: `animation: pulse 1.4s ease-in-out infinite, wiggle 6s 2s infinite`. `::after` — кольцо 4u `#FFFFFF`, `ring 1.4s ease-out infinite`.
- Первый `pointerdown` на экране вызывает `audio.unlock()` **синхронно в обработчике** (05 §3), затем `playMusic('menu')`. Нажатие «Играть» дополнительно ведёт на `episodes`.
- Клавиатура: Enter или Space — «Играть». Фокус на кнопке ставится сразу при показе экрана.

### 7.5. Веер настроек

Нажатие на шестерёнку: она поворачивается на 90° за 0.3 с `--e-back`. Над ней вылетают вверх 3 кнопки `xs` 56u с шагом `step = max(52px, 68u)` — «Музыка», «Звуки», «Ещё…» (диалог §14.1): `translateY(0) → −step·i`, opacity, по 40 мс, 0.3 с `--e-back`. Повторное нажатие, тап вне веера или Esc — свернуть в обратном порядке за 0.2 с.

---

## 8. Выбор эпизода

### 8.1. Макет

| Элемент | Позиция (u) | Вид |
|---|---|---|
| «Назад» | левый верх по `--inset` | `m` 88u → на телефоне 52px, `blue`, `back` |
| Заголовок «ВЫБЕРИТЕ ЭПИЗОД» | центр, верх 36 | `h1` 44u |
| Всего звёзд | правый верх | пилюля: `star` 32u + «47/90» `num-s`, фон `rgba(11,26,43,.55)` |
| Лента карточек | центр Y = 380, высота 380 | горизонтальный скроллер, `scroll-snap-type: x mandatory`, карточка `scroll-snap-align: center`, промежуток 40u, отступ по краям `(W − 300u)/2` |
| Стрелки ‹ › | по бокам, центр Y | `s` 64u, только `pointer: fine`; скрываются на краях |
| Точки-индикатор | низ, +36u | 12u, активная 28×12u `#FFFFFF`, остальные α0.45 |

### 8.2. Карточка (300×380u)

- **Арт** 300×240u: offscreen-холст `Background(theme)` с видом на 20 м и «героями» темы — новая птица эпизода и свинья (спрайты 02, поза idle). Рендерится один раз в `drawImage` в `<canvas>` карточки при `dpr ≤ 2`. Верхние углы скруглены 22u.
- **Низ** 300×140u цвета темы: meadow `#3E8E2E`, beach `#E58A2B`, snow `#3A7FC4`. На нём:
  - «Эпизод 1» — `caption` `#FFFFFF` α0.8;
  - название — `h2` 30u;
  - строка «★ 17/30» — иконка 32u + `num-s`;
  - прогресс-полоса 220×14u (дорожка `rgba(0,0,0,.25)`, заливка `--gold`, радиус 7u).
- Рамка и тень — §3.3. На hover (fine): `translateY(−8u) scale(1.03)` за 0.18 с; при нажатии — `scale(.97)`.
- **Пройдено на 30/30**: рамка `--gold` 6u, в правом верхнем углу — лента «★★★» (три звезды 28u на `--gold-lo`).
- **Закрыто**: к арту `filter: grayscale(1) brightness(.75)`, низ `#6B7A8C`. По центру арта — замок: `gray`-кнопка 96u с иконкой `lock`, без нажатия. Под названием — «Пройдите «Зелёные холмы» и соберите 15 звёзд» (`caption` 18u, 2 строки максимум). Тап — `shake()` + `ui('locked')` + тост с тем же текстом.
- **«Скоро…»** (4-я карточка): штриховка `repeating-linear-gradient(45deg, #2B5583 0 20u, #24476E 20u 40u)`, по центру «?» Rubik 900 120u α0.5, подпись «Новые уровни в разработке». Нажатие ничего не делает.
- Нажатие на открытую карточку — зум (§5.4). Клавиатура: ←/→ — соседняя карточка (`scrollIntoView({inline: 'center', behavior})`), Enter — открыть, Esc или Backspace — назад.
- Вход экрана: карточки `translateY(40u) scale(.9) → none` + opacity за 0.36 с `--e-back`, по 60 мс. При входе центрируется `last.episode`.

### 8.3. Анимация открытия эпизода

Срабатывает при входе на экран, если эпизод открыт и его id нет в `seen.episodes`:
1. Замок дрожит: 0.4 с, ±6° на 12 Гц.
2. Дужка «отщёлкивается»: `translateY(−10u)` за 0.1 с; замок улетает вверх `−80u` с поворотом 25° и opacity → 0 за 0.4 с `--e-in`.
3. Арт: `grayscale 1 → 0` за 0.6 с. Низ перекрашивается в цвет темы.
4. 12 искр (как у звёзд, §12.4). Звуки `ui('popIn')` + `reward('star2')`. Затем `seen.episodes.push(id)` и `progress.save()`.

---

## 9. Выбор уровня

### 9.1. Макет

| Элемент | Позиция (u) | Вид |
|---|---|---|
| «Назад» | левый верх | `m`, `blue`, `back` → эпизоды |
| Название эпизода | центр, верх 36 | `h1` 44u |
| Звёзды эпизода | правый верх | пилюля «★ 17/30» |
| Сетка 5×2 | центр, верх 150 | плитка 112u, шаг по X 136u (промежуток 24u), шаг по Y 168u (промежуток 56u: звёзды выступают вниз на 18u). Сетка 656×280u |
| Нижняя строка | низ, +40u | `body` `--muted`: «До следующего эпизода: ещё 6 звёзд» / «Эпизод пройден!» / «Открыт эпизод «Пляжный закат»» |

Для будущих эпизодов на 15–21 уровень — сетка 7×3 со страницами по 21 уровню (как 21 уровень на тему в Poached Eggs [факт]) и точками-страницами. Код сетки параметризован `cols × rows`.

### 9.2. Плитка

| Состояние | Вариант | Содержимое | Анимация |
|---|---|---|---|
| Открыт, не пройден, следующий по порядку («текущий») | `orange` | номер `num-m`; три пустые звезды | `pulse` 1.2 с ∞ на обёртке + кольцо `ring` |
| Открыт, не пройден, не текущий (после переигровки) | `blue` | номер; пустые звёзды | — |
| Пройден | `blue` | номер; 1–3 золотые звезды, остальные пустые | — |
| Закрыт | `gray` | `lock` 48u вместо номера; звёзд нет | — |

- Звёзды — дуга под нижним краем плитки, наполовину снаружи. Боковые 28u: центры (−34u, +50u), поворот ∓12°. Центральная 34u: (0, +56u). Отсчёт от центра плитки.
- Номер — только порядковый в эпизоде («3»). Полный id «1-3» — в `aria-label` и тултипе.
- Тултип на hover: «Рекорд: 41 230» или «Ещё не пройден».
- Нажатие на открытую плитку — `onStartLevel(id, tileCenter)`, затем ирис. На закрытую — `shake()` + `ui('locked')` + тост «Сначала пройдите уровень 1-4».
- Клавиатура: roving tabindex; стрелки двигают фокус по сетке, Home/End — первый и последний открытый, Enter — играть, Esc — назад. При входе фокус на «текущем» уровне.
- Вход экрана: плитки pop-in по 30 мс, звёзды плиток — opacity 0 → 1 через +0.1 с, без звука.

### 9.3. Анимация открытия уровня

При входе на экран для каждого открытого уровня, которого нет в `seen.levels` (обычно это следующий после только что пройденного):
1. Через 0.3 с после входа серая плитка дрожит 0.3 с.
2. Замок: `scale 1 → 1.2` за 0.1 с, затем падает `translateY(+60u)` с поворотом 40° и opacity → 0 за 0.4 с `--e-in`.
3. Плитка переворачивается: `rotateY(0 → 90°)` за 0.15 с, вариант меняется `gray → orange`, затем `90° → 0` за 0.2 с `--e-back`. Номер проявляется.
4. 8 искр, `ui('popIn')`. Затем `seen.levels.push(id)`.

---

## 10. HUD в уровне

### 10.1. Раскладка (от `--inset-*`)

| Элемент | Якорь | Размер | Вид |
|---|---|---|---|
| Пауза | левый верх (+0, +0) | `s` 64u, `blue`, `pause` | `aria-label="Пауза (Esc)"` |
| Рестарт | справа от паузы: flex-ряд, `gap: max(8px, 16u)` (не фиксированное смещение — на телефоне кнопки упираются в минимум 44px) | `s` 64u, `orange`, `restart` | `aria-label="Начать заново (R)"`, без подтверждения (01 §12.3) |
| Рекорд | правый верх, строка 1 | `caption` 20u | «РЕКОРД 45 230», `#FFFFFF` α0.9, обводка 0.16em `--ink-2`; без рекорда строки нет |
| Счёт | правый верх, строка 2 (+26u) | `num-l` 44u, по правому краю | плавный счёт и пульс 1 → 1.12 → 1 за 0.2 с при прибавке ≥ 5000 (01 §9.4) |
| Плашка уровня | центр верх | высота 44u, пилюля | «1-3 · Шаткая башня» (`h2` 24u + `body` 20u). Появляется вместе с ирисом, через 2.5 с гаснет за 0.5 с. Повторно — только на паузе |
| «К рогатке» | левый край, центр Y | `s` 64u, `blue`, `sling` + бейдж числа птиц (24u, `#E0302A`, `num-s` 16u) | появляется pop-in, когда рогатка вне экрана дольше 0.5 с в `READY` / `SETTLING`; тап → `onCameraHome()` |
| «Коснитесь, чтобы пропустить» | низ центр | `caption` 20u α0.85 | только в `INTRO_*`, если интро не повтор; мигает opacity 0.85 ↔ 0.4 с периодом 1.6 с |
| Подсказка способности | низ центр | тост §4.6 + иконка пальца | §10.4 |

- Очередь птиц **рисуется в мире** у рогатки (02 §8.1) — в HUD её не дублируем. `birdsLeft` нужен только для бейджа «К рогатке», карточки паузы и `aria`.
- Контейнер `.hud { pointer-events: none; contain: layout paint; }`, у кнопок `pointer-events: auto`.
- В `RESULTS` HUD гаснет за 0.2 с. Под паузой он остаётся, но затемнён backdrop.
- Мобильный телефон в ландшафте (u ≈ 0.6): кнопки 44px, счёт 26px, плашка уровня 26px — по таблице §2.2 вне сцены остаётся ≥ 85% площади.

### 10.2. Обновление счёта

```ts
// каждый кадр, вызывает updateHud()
shown += (target - shown) * (1 - Math.exp(-dt / 0.12));
if (target - shown < 1) shown = target;
const txt = Math.floor(shown).toLocaleString('ru-RU');
if (txt !== lastTxt) { scoreEl.textContent = txt; lastTxt = txt; }     // DOM трогаем только при смене цифр
```

### 10.3. Лента в начале уровня

Совпадает с плашкой из §10.1. Если в `LevelDef.hint` есть текст, под лентой появляется облачко-подсказка: бумажная панель ≤ 640u, `body` `--paper-ink`, хвостик вниз. Показ 4 с или до первого захвата птицы.

### 10.4. Подсказка способности

- Показывается через 0.25 с после `birdLaunched`, если у птицы есть способность и её тип не записан в `seen.abilityHints`.
- Текст (§18) зависит от типа птицы и устройства: «Коснитесь — и Чак рванёт вперёд!» плюс для `pointer: fine` вторая строка «или нажмите Пробел». Слева иконка пальца: круг 36u `#FFFFFF` с кольцом, `bob`.
- Скрывается по `ability`, `birdImpact` или через 3 с. В `seen.abilityHints` тип пишется **только после того, как способность реально использовали**: пропустил — подсказка будет снова.

### 10.5. Обучение прицелу (1-1, пока `seen.aimTutorial = false`)

Через 1.5 с в `READY` без захвата запускается цикл 2.0 с:
- призрачный палец (круг 40u `#FFFFFF` α0.9, кольцо 4u `--ink` α0.4) появляется на птице;
- тянет к точке `pocket − (1.6, 0.5) м` за 0.9 с `inOutCubic`; за ним 6 точек 8u α0.6 по линии;
- держит 0.3 с;
- «отпускает»: `scale 0.8`, fade за 0.2 с;
- пауза 0.6 с.

Цикл останавливается на `aimStart`. После первого `birdLaunched` — `seen.aimTutorial = true`.

---

## 11. Меню паузы

### 11.1. Макет

| Элемент | Позиция (u) | Вид |
|---|---|---|
| Backdrop | весь экран | `--backdrop`, opacity 0 → 1 за 0.25 с |
| Боковая панель | слева, во всю высоту, ширина 260u + `--inset-l` | `linear-gradient(180deg, #1F3F63, #142A44)` α0.96; правый край 6u `--ink`, внутренний блик 2u `rgba(255,255,255,.15)`. Выезд `translateX(−100%) → 0` за 0.3 с `--e-out` |
| «ПАУЗА» | верх панели +40u | `h2` 30u |
| Продолжить | центр X панели, y = 150u | `l` 120u, `green`, `play`, подпись «Продолжить» (`caption`) под кнопкой |
| Заново | y = 320u | `m` 88u, `orange`, `restart`, подпись |
| Уровни | y = 450u | `m` 88u, `blue`, `levels`, подпись |
| Переключатели | низ панели, сетка 2×2, `gap: max(8px, 16u)` | `xs` 56u: Музыка, Звуки, Прицел (`aim`, `aimAssist`), Полный экран (если доступен) |
| Карточка уровня | центр свободной области справа | тёмная панель 420×300u, pop-in с задержкой 0.08 с: «1-3» (`num-xl` 64u), название (`h2`), «Рекорд: 41 230» (`body` `#FFE36A`), 3 звезды лучшего результата (40u), «Птиц осталось: 3» (`caption`) |

На высоте 620u колонка помещается: 40 + 30 + 120 + подписи + 2×88 + промежутки ≈ 520u. Если не помещается, шаг кнопок сжимается до 100u.

### 11.2. Поведение

- Открытие: `‖`, Esc, P, `history` back, `visibilitychange → hidden`, `blur` окна (только в игровых состояниях), появление оверлея «поверните». Симуляция стоит сразу (01 §12.4), `audio.setPaused(true)`.
- Закрытие: «Продолжить», Esc, P, тап по backdrop справа от панели. Панель уходит `translateX(−100%)` за 0.22 с `--e-in`, backdrop гаснет за 0.2 с. **Игра продолжается по окончании анимации**, аккумулятор fixed-step обнулён.
- Если пауза пришла из `AIMING`, прицел отменяется (`cancelAim()`, птица возвращается в ложе). Иначе отпускание после паузы дало бы случайный выстрел.
- Фокус: на «Продолжить»; ловушка Tab внутри панели; после закрытия — на кнопку `‖`.
- Клавиши в паузе: R — заново, L — уровни, M — музыка.

---

## 12. Экран победы

### 12.1. Баннер (`CLEARED_BANNER`, 1.2 с, 01 §10)

- Лента победы (§4.3) 760u, центр Y = 30% высоты: `translateY(−140%) scale(.8) → none` за 0.35 с `--e-back`. Текст «УРОВЕНЬ ПРОЙДЕН!» 44u. Фанфара — по `levelEnd` (05 §9.6).
- Косметика (01 §15): через +0.3 с под лентой появляется pop-in пилюля `#FFC21A` с текстом `btn` 24u `#7A3500` — «ОДНИМ ВЫСТРЕЛОМ!» или «ЧИСТАЯ РАБОТА!».
- Тап по экрану — `onSkip()`: баннер сокращается до 0.3 с.
- Затем `BONUS_COUNT` в мире (01 §10). Баннер в это время уезжает на верх экрана: `translateY` к 8% высоты, `scale(.85)` за 0.3 с — из этой позиции он станет заголовком панели.

### 12.2. Панель результатов (560×500u, тёмная)

| Элемент | Центр (u, от верха панели) | Вид |
|---|---|---|
| Лента-заголовок | y = −20 (выступает над панелью) | тот же DOM-узел баннера; перелёт FLIP в слот за 0.35 с `--e-inout`, `scale .85 → .8` |
| Звёзды | y = 120: левая (−150, +18), центральная (0, 0), правая (+150, +18) | 112 / 144 / 112u, поворот −10° / 0 / +10°. Слоты сразу показывают пустые звёзды |
| «СЧЁТ» | y = 240 | Rubik 900 24u, `--muted` |
| Счёт | y = 295 | `num-xl` 76u; сначала «0» |
| «Рекорд: 45 230» | y = 350 | Rubik 700 24u `#FFE36A`; при новом рекорде заменяется бейджем |
| Бейдж «НОВЫЙ РЕКОРД!» | (+175, 270) | §4.6 |
| Сообщение о следующем | y = 395 | `caption` `--muted`, только для `next.kind = 'locked' / 'end'` |
| Кнопки | y = 440 | `m` «Уровни» (`blue`, `levels`) · `m` «Заново» (`orange`, `restart`) · `l` «Дальше» (`green`, `next`). Промежутки 36u, всего 368u. «Дальше» нет, если `next.kind !== 'level'` |

Высота с выступом ленты ≈ 570u — помещается в 620u.

### 12.3. Таймлайн (`t = 0` — начало выезда панели)

| t, с | Событие | Звук (05 §8.7) |
|---|---|---|
| 0.00 | backdrop 0 → `--backdrop` за 0.25 с; панель `translateY(110%) → 0` за 0.4 с `--e-back`; лента летит в слот | `ui('popIn')` |
| 0.30 | кнопки pop-in по 60 мс, пока неактивны (`aria-disabled`) | — |
| 0.31 / 0.76 / 1.21 | старт полёта звезды 1 / 2 / 3, если она заработана | — |
| **0.50 / 0.95 / 1.40** | приземление звезды: «бум» (§12.4). Незаработанная пустая звезда «вздрагивает»: `scale 1 → 0.9 → 1`, 0.15 с | `reward('star0' / 'star1' / 'star2')` или `reward('starEmpty')` |
| 1.70 | кнопки активны (0.3 с после последней звезды, 01 §10) | — |
| 1.65 → 2.85 | счёт крутится 0 → итог: `v = score · easeOutCubic(k)` | `scoreTick(k)` каждый кадр (движок пропускает чаще 45 мс) |
| 2.85 | конец счёта; при `newBest` — бейдж «НОВЫЙ РЕКОРД!» + 30 конфетти | `reward('scoreDone')`, затем `reward('newBest')` |
| 3.15 | «Дальше» (или «Заново», если «Дальше» нет) получает `pulse` | — |
| 3.15+ | при открытии нового эпизода — тост «Открыт эпизод «Пляжный закат»!» | `ui('popIn')` |

- **Пропуск**: тап по панели или backdrop (не по кнопке), Space или Enter. Все звёзды сразу в финальном состоянии; один «бум» и один звук на последнюю заработанную; счёт сразу итоговый; бейдж рекорда — сразу; кнопки активны. Второй Enter или Space — «Дальше».
- Нажатие кнопки во время подсчёта тоже доводит таймлайн до конца, затем выполняет действие.
- Отличие от 01 §10: там счёт 0.8 с до звёзд с интервалом 0.35 с. Здесь принят порядок из 05 §8.7 (звёзды → счёт 1.2 с), потому что звук уже под него свёрстан. Общая длина ≈ 3.2 с, кнопки — с 1.7 с.
- «Новый рекорд!» показывается только если `prevBest > 0 && score > prevBest`. При первом прохождении бейджа нет: рекорд «нового» уровня — не событие [рекомендация].

### 12.4. «Бум» звезды

| Параметр | Значение |
|---|---|
| Полёт (WAAPI, 420 мс, `starLead` = 0.19 с до приземления) | 0%: `translate(0,−60u) scale(2.4) rotate(−35°)`, opacity 0 → 45%: `scale(.88) rotate(4°)`, opacity 1 (касание) → 65%: `scale(1.14) rotate(−2°)` → 82%: `scale(.97)` → 100%: `scale(1) rotate(slot)`. Easing сегментов `--e-out` |
| Вспышка | за звездой `radial-gradient(#FFFFFF α0.9, transparent 60%)`, 1.6R, opacity 1 → 0 за 200 мс |
| Ударная волна | кольцо: `border: 6u solid #FFF3B0`, `scale 1 → 2.6` (от R), opacity 0.9 → 0, 380 мс `--e-out` |
| Искры | 10 четырёхлучевых звёздочек 14–22u (`#FFF7C0`, `#FFD84A`), углы `36°·i ± 12°`, разлёт 90–150u, 500–700 мс `--e-out`, поворот 0 → 180°, `scale 1 → 0.2`, opacity гаснет в последние 40% |
| Звезда 3 | ещё 6 конфетти (`#E0302A`, `#4BA7E8`, `#FFD21F`, `#46A83A`, прямоугольники 10×16u): 3 ключевых кадра «вверх-вбок → вниз», 900 мс; панель вздрагивает `translateY 0 → 6u → −3u → 0` за 180 мс |
| Вибрация | `navigator.vibrate?.(15)` на касание, если `settings.haptics` и `pointer: coarse` [рекомендация] |
| Узлы | частицы — DOM-элементы из пула (≤ 40 на экран), по `animation.finished` удаляются |

### 12.5. Код таймлайна (сокращённо; проверен tsc)

```ts
export const WIN_T = {
  full:    { star: [0.5, 0.95, 1.4], starLead: 0.19, rollGap: 0.25, roll: 1.2, buttonsAt: 0.3, enableAfterStar: 0.3 },
  reduced: { star: [0.3, 0.55, 0.8], starLead: 0,    rollGap: 0.15, roll: 0.5, buttonsAt: 0.15, enableAfterStar: 0.15 },
} as const;

export function playWin(panel: HTMLElement, r: WinResult, audio: AudioEngine, fx: WinFx): { tl: Timeline; skip(): void } {
  const T = motion.reduced ? WIN_T.reduced : WIN_T.full;
  const tl = new Timeline();
  const slots = [...panel.querySelectorAll<HTMLElement>('[data-star]')];
  [...panel.querySelectorAll<HTMLElement>('[data-btn]')].forEach((b, i) => popIn(b, T.buttonsAt * 1000 + i * 60));
  T.star.forEach((land, i) => {
    const earned = i < r.stars;
    tl.at(Math.max(0, land - T.starLead), (skipped) => { slots[i]!.dataset.state = earned ? (skipped ? 'set' : 'fly') : 'empty'; });
    tl.at(land, (skipped) => {
      if (skipped && i !== r.stars - 1) return;               // при пропуске — один «бум»
      fx.starLand(i, earned, !skipped);
      audio.reward(earned ? (['star0', 'star1', 'star2'] as const)[i]! : 'starEmpty');
    });
  });
  tl.at(T.star[2] + T.enableAfterStar, () => fx.enableButtons());
  const r0 = T.star[2] + T.rollGap;
  tl.tween(r0, T.roll, (k) => { fx.setScore(Math.round(r.score * (1 - (1 - k) ** 3))); if (k < 1) audio.scoreTick(k); });
  tl.at(r0 + T.roll, () => { audio.reward('scoreDone'); if (r.newBest) { fx.newBest(); audio.reward('newBest'); } });
  tl.play();
  return { tl, skip() { tl.skip(); for (const a of panel.getAnimations({ subtree: true })) a.finish(); } };
}
```

`Timeline` (в `anim.ts`) — rAF-цикл с `at(sec, fn(skipped))`, `tween(t0, dur, fn(k))` и `skip()`. `skip()` вызывает все оставшиеся события с `skipped = true`, а твины — с `k = 1`. `dt` ограничен 0.1 с: после сворачивания вкладки таймлайн не перепрыгивает.

---

## 13. Экран поражения

### 13.1. Баннер (`LOST_BANNER`, 1.0 с)

Красная лента «УРОВЕНЬ НЕ ПРОЙДЕН» (44u, 534u текста в 624u полезной ширины [замер]). Вход такой же, как у победы. В мире свиньи смеются (`pigsLaugh`, 05). Джингл поражения — по `levelEnd`.

### 13.2. Панель (560×460u)

| Элемент | Центр (u) | Вид |
|---|---|---|
| Лента | y = −20 | красная, перелёт FLIP как у победы |
| Свинья | y = 150 | `renderPig('medium', 'laugh', stage 0)` в `<canvas>` 200u. «Хохот»: 1.2 с `translateY 0 ↔ −8u` + `scaleY 1 ↔ 0.95` на 3 Гц, затем `bob` 0.8 Гц. **Слёзы смеха**: капли (SVG `M6 0C6 0 0 7 0 10.5a6 6 0 0 0 12 0C12 7 6 0 6 0z`, `#8FD8FF`, обводка 1.5 `#1D4E6B`, 14u) вылетают из глаз (±0.35R, −0.05R) по очереди каждые 0.9 с: дуга наружу на 30u и вниз на 50u, 0.7 с, гаснут в последние 30% |
| Дразнилка | y = 280 | `body` 26u `--muted`, случайная из §18 |
| «Счёт: 23 450» | y = 318 | `caption` 22u |
| Совет | y = 355, ширина ≤ 480u | только при `failStreak ≥ 3`: «Совет: …» `body` 20u `#FFE36A`, до 2 строк |
| Кнопки | y = 410 | `m` «Уровни» (`blue`) · промежуток 48u · `l` «Ещё раз» (`green`, `restart`, `pulse` с 0.9 с) |

Таймлайн: панель выезжает за 0.4 с `--e-back` → свинья pop-in на 0.25 с (`scale 0 → 1.1 → 1`, 0.35 с) → текст fade на 0.45 с → кнопки pop-in на 0.55 с (по 60 мс), активны с 0.7 с. Клавиши: R, Enter, Space — «Ещё раз»; L или Esc — «Уровни». Кнопки «Пропустить уровень» нет (Mighty Eagle не переносим, спецификация §14).

---

## 14. Настройки, диалоги, «поверните устройство»

### 14.1. Диалог «Настройки» (бумажная панель 640×560u, внутри прокрутка при нехватке высоты)

| Строка (высота 56u) | Контрол | Значения | Применение |
|---|---|---|---|
| Музыка | свитч | вкл/выкл | `audio.setMusic` сразу |
| Звуки | свитч | вкл/выкл | `audio.setSfx` |
| Качество графики | сегменты | Авто / Высокое / Среднее / Низкое | `QUALITY` из 04 §10.1; «Авто» — адаптивное |
| Подсказка траектории | сегменты | Выкл / Короткая | `aimAssist` (01 §0 п.7) |
| Анимации | сегменты | Как в системе / Уменьшить / Полные | §19.3 |
| Тряска экрана | свитч | вкл/выкл | 04 §8.8; при «Уменьшить» по умолчанию выкл |
| Вибрация | свитч | вкл/выкл | строка скрыта без `navigator.vibrate` |
| Сбросить прогресс | `pill` `red` | → подтверждение | §14.2 |

Заголовок «НАСТРОЙКИ» — лента-инфо 520u. Закрыть — `xs` `close` в правом верхнем углу (выступает на 20u), Esc или тап по backdrop. Изменения сохраняются через `progress.save()` (300 мс).

### 14.2. Подтверждение сброса

Бумажная панель 560×300u: «Сбросить прогресс?» (`h2` `--paper-ink`), «Все звёзды и рекорды будут удалены. Это нельзя отменить.» (`body` `--paper-muted`). Кнопки `pill` «Отмена» (`blue`, фокус по умолчанию) и «Сбросить» (`red`). После сброса — тост «Прогресс сброшен», переход на титул. Настройки при сбросе сохраняются.

### 14.3. «Об игре»

Бумажная панель: «Сердитые Птицы — фанатский ремейк. Не связан с Rovio Entertainment. Графика, музыка и звуки созданы кодом.» Ниже — блок «Управление» (3 строки из §18) и версия.

### 14.4. Оверлей «Поверните устройство»

- Условие: `pointer: coarse && innerHeight > innerWidth && !session.playPortrait`.
- Вид: фон `--ink` α0.94. Иконка `phone` 160u крутится: 0 → −90° за 0.8 с `--e-inout`, держится 0.6 с, возвращается за 0.4 с, пауза 0.6 с (цикл 2.4 с). Текст «Поверните устройство» (`h1`), ниже «Игра рассчитана на горизонтальный экран» (`body` `--muted`) и `pill` `blue` «Играть так».
- «Играть так» включает летербокс §15.1 до конца сессии (не сохраняется).
- В игровых состояниях появление оверлея ставит паузу. После поворота пауза остаётся, игрок снимает её сам.

---

## 15. Адаптивность и платформа

### 15.1. Ориентация и пропорции

| Случай | Поведение |
|---|---|
| Ландшафт 16:9…21:9 (телефоны 2.0–2.3) | полный экран. Камера: `viewH` по 01 §6, ширина обзора растёт с пропорцией. UI в безопасном боксе по центру, HUD — по краям |
| 4:3…3:2 (iPad, 5:4 мониторы) | полный экран; `viewH` не меняется, обзор по X уже. Рогатка на `SLING_SCREEN_X = 0.20` (01) |
| Портрет, тач | оверлей §14.4; «Играть так» → летербокс |
| Пропорция < 1.25, мышь (узкое окно) | автоматический летербокс: `#stage` 16:9 по ширине, по центру; полосы `--ink` с градиентом неба темы α0.25 |

```css
#stage[data-letterbox] { inset: auto 0; top: 50%; height: calc(100vw * 9 / 16); transform: translateY(-50%); }
```

В летербоксе `u` и `--inset-*` считаются от `#stage`, а не от окна.

### 15.2. Полноэкранный режим и ориентация

```ts
async function toggleFullscreen() {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  if (document.fullscreenElement || d.webkitFullscreenElement) return (document.exitFullscreen ?? d.webkitExitFullscreen)?.call(document);
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
  try { await (screen.orientation as ScreenOrientation & { lock?(o: string): Promise<void> }).lock?.('landscape'); } catch { /* не поддерживается */ }
}
```

- `screen.orientation.lock()` работает только в полноэкранном режиме и в основном на Android Chrome. На iPhone Fullscreen API для не-видео элементов нет (по отчётам — и в бете Safari 27, июнь 2026), поэтому кнопка скрыта (`document.fullscreenEnabled === false`) [факт].
- `F` переключает режим (только из обработчика жеста — требование браузера).

### 15.3. Прочее

- `devicePixelRatio`, размер canvas и адаптивное качество — 04 §10.1. DOM-UI векторный, поэтому DPR его не касается.
- Свернули вкладку (`visibilitychange → hidden`) — пауза и `progress.flush()`. Вернулись — пауза остаётся.
- `pagehide` — `progress.flush()`.
- `prefers-color-scheme` не используем: у игры своя палитра.
- `prefers-contrast: more` [рекомендация]: backdrop α0.7, обводки текста ×1.3, у пустых звёзд обводка `#FFFFFF`.

---

## 16. Управление

### 16.1. Жесты (`InputRouter`, проверено tsc)

| Ситуация | Нажатие | Результат |
|---|---|---|
| `INTRO_*`, `CLEARED_BANNER`, `BONUS_COUNT` | любое | `onSkip()` |
| `READY` | в радиусе захвата птицы: `max(GRAB_RADIUS_M = 1.0 м, 44 px)` | **прицел**: `setPointerCapture`, `beginAim/updateAim`, отпускание → `release()` (отмена при `d < R_CANCEL`, 01) |
| `FLYING`, способность доступна | любое вне HUD, левая кнопка | **способность на `pointerdown`** (01 §0 п.8); дальше тот же палец может панорамировать |
| Остальные игровые | один указатель, сдвиг ≥ 8 px | **пан** 1:1 с инерцией (01 §6.5) |
| Тап < 300 мс и < 8 px дважды за ≤ 300 мс в пределах 24 px | — | переключение «весь уровень ↔ рогатка» (01 §6.5, клавиша Z) |
| Два указателя (кроме прицела) | — | **щипок**: зум с якорем в середине, одновременно пан середины; инкрементально по кадрам |
| Второй палец во время прицела | — | игнорируется; отпускание второго пальца прицел **не** отпускает |
| Правая или средняя кнопка мыши | — | только пан (прицела и способности нет) |
| Колесо | — | `zoomAt(курсор, exp(−dy · 0.0015))`; `ctrlKey` (щипок тачпада) — коэффициент 0.01; `deltaMode` 1 → ×16 px, 2 → ×высота экрана; `deltaX` — пан |
| `pointercancel` во время прицела | — | `cancelAim()` |

```ts
private readonly down = (e: PointerEvent): void => {
  if (e.pointerType === 'mouse' && e.button > 2) return;
  this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp });
  const s = this.d.state();
  if (this.pts.size === 2 && this.g !== 'aim') { this.startPinch(); return; }
  if (this.pts.size > 1) return;                                           // в прицеле второй палец игнорируем
  this.el.setPointerCapture(e.pointerId);
  if (s === 'INTRO_HOLD' || s === 'INTRO_PAN' || s === 'BONUS_COUNT' || s === 'CLEARED_BANNER') { this.d.skip(); this.g = 'none'; return; }
  if (s === 'READY' && e.button === 0 && this.d.canGrabAt(e.clientX, e.clientY, GRAB_MIN_PX)) { this.g = 'aim'; this.aimId = e.pointerId; this.d.beginAim(e.clientX, e.clientY); return; }
  if (s === 'FLYING' && e.button === 0) this.d.ability();
  this.g = 'pending'; this.vel = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
};
// move: aim → updateAim (только aimId); pending → pan после 8 px; pan → panBy + скорость за последние 80 мс
// up:   aim → release (только aimId); pan → endPan(v); короткий тап → проверка двойного тапа
```

Подготовка элемента: `touch-action: none` на canvas, `touch-action: manipulation` на UI (без задержки двойного тапа). `contextmenu`, `selectstart`, `gesturestart/gesturechange` (Safari: зум страницы) — `preventDefault()`. Колесо — `{ passive: false }` + `preventDefault()`, иначе Ctrl+колесо масштабирует страницу. Стили: `user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent`.

### 16.2. Клавиатура

| Клавиша | Где | Действие |
|---|---|---|
| Esc | игра | в прицеле — отмена прицела; иначе пауза ↔ продолжить |
| Esc, Backspace | меню | назад |
| Esc | диалог / пауза / результаты | закрыть / продолжить / «Уровни» |
| P | игра | пауза ↔ продолжить |
| R | игра, пауза, результаты | рестарт без подтверждения |
| Space | `FLYING` | способность [рекомендация, как в 01] |
| Space | `INTRO_*`, баннер, бонус, таймлайн результатов | пропустить |
| Enter | меню, диалоги | активировать элемент в фокусе; в результатах — главная кнопка |
| N | победа | «Дальше» |
| L | пауза, результаты | «Уровни» |
| ← → ↑ ↓ | игра (не в прицеле) | пан камеры 15 м/с, пока клавиша зажата (Shift — ×2) |
| ← → ↑ ↓ | меню | навигация фокуса (сетка уровней, карточки, сегменты) |
| + / = и − | игра | зум ×1.15 / ÷1.15 к центру экрана |
| Z | игра | весь уровень ↔ рогатка (01 §6.5) |
| F | везде | полный экран |
| M / Shift+M | везде | музыка / звуки вкл-выкл + тост «Музыка выключена» |
| Tab, Shift+Tab | везде | обход фокуса; в оверлеях и диалогах — ловушка |
| A, затем стрелки, Space или Enter | `READY` | **клавиатурный прицел** [рекомендация, P2]: ↑/↓ угол ±1° (Shift ±5°), ←/→ сила ∓5%. Точка прицела `anchor − R_MAX·power·(cos θ, sin θ)` идёт в `beginAim/updateAim`, Space или Enter — `release()`, Esc — отмена. Старт 45° и 80% |

- Игнорируем `e.repeat` для переключателей (P, Esc, M, F, R) и события с модификаторами Ctrl/Meta, кроме Shift.
- `preventDefault()` для Space и стрелок (прокрутка страницы).

---

## 17. Сохранение прогресса

### 17.1. Ключ, версия, политика

- Ключ **`angrybirds.progress.v1`** (как в спецификации §3). В 01 §12.1 был ключ `abclone:v1:progress` — побеждает спецификация, это нужно поправить в 01.
- Внутри `schema: 1`. Совместимые изменения — миграции `MIGRATIONS[n](o) → o(n+1)` с проходом по цепочке. Если формат сломан полностью — новый ключ `…v2`, а при первом запуске v2 читает v1 и мигрирует его.
- `schema` больше нашей (откат на старую сборку) — данные читаются, но **не перезаписываются** (`readOnly`).
- Невалидный JSON — копия в `angrybirds.progress.v1.corrupt`, старт с чистого листа.
- Санитайзинг: звёзды 0–3, целые числа ≥ 0, id по шаблону `^\d{1,2}-\d{1,2}$`, неизвестные значения перечислений → значения по умолчанию. Неизвестные id уровней сохраняются: это могут быть будущие уровни.
- Запись: результат уровня — сразу (`flush`); настройки и флаги — с дебаунсом 300 мс; плюс `flush` на `pagehide` и `visibilitychange → hidden`.
- Нет `localStorage` (`SecurityError`) или переполнена квота — `persistent = false`, игра работает в памяти, один раз показывается тост «Прогресс не сохранится: браузер запретил хранилище».
- Другая вкладка записала прогресс — событие `storage` → `load()` → экраны перерисовываются.
- Объём: 30 уровней ≈ 1.4 КБ [замер].
- Отладка: `?unlockAll=1` открывает всё **без записи** в хранилище.

### 17.2. Схема

```ts
export const STORAGE_KEY = 'angrybirds.progress.v1';
export const SCHEMA = 1 as const;
export interface LevelRecord {
  stars: 0 | 1 | 2 | 3;   // лучший результат (0 — не пройден)
  best: number;           // рекорд очков (только победы)
  attempts: number;       // старты + рестарты
  wins: number; fails: number;
  failStreak: number;     // поражений подряд (для совета на экране поражения)
  firstClearAt?: number;  // ms epoch
}
export interface Settings {
  music: boolean; sfx: boolean;
  quality: 'auto' | 'high' | 'med' | 'low';
  aimAssist: 'off' | 'short';
  motion: 'system' | 'reduce' | 'full';
  shake: boolean; haptics: boolean;
}
export interface SaveData {
  schema: typeof SCHEMA;
  createdAt: number; updatedAt: number;
  levels: Record<string, LevelRecord>;                     // ключ — LevelDef.id
  seen: { levels: string[]; episodes: string[]; abilityHints: BirdType[]; aimTutorial: boolean };
  last: { episode: string; level: string | null };          // центрирование карточки и фокус плитки
  settings: Settings;
  stats: { shots: number; pigsPopped: number; playSeconds: number };
}
// по умолчанию: seen.levels = ['1-1'], seen.episodes = ['1'] — первые уровень и эпизод открыты без анимации
```

Пример записи:

```json
{"schema":1,"createdAt":1792850000000,"updatedAt":1792858675408,
 "levels":{"1-1":{"stars":3,"best":60000,"attempts":4,"wins":4,"fails":0,"failStreak":0,"firstClearAt":1792858675408}},
 "seen":{"levels":["1-1","1-2"],"episodes":["1"],"abilityHints":["chuck"],"aimTutorial":true},
 "last":{"episode":"1","level":"1-2"},
 "settings":{"music":true,"sfx":true,"quality":"auto","aimAssist":"off","motion":"system","shake":true,"haptics":true},
 "stats":{"shots":17,"pigsPopped":9,"playSeconds":412}}
```

### 17.3. API (`src/storage/progress.ts`, проверено в Node)

```ts
class Progress {
  load(): SaveData;                         // try/catch, миграции, sanitize
  save(delayMs = 300): void; flush(): void;
  onLevelStart(id: string): void;           // attempts++ (каждый старт и рестарт, 01 §12.1), last.*
  saveLevelResult(id: string, won: boolean, score: number, stars: 0|1|2|3): { prevBest: number; newBest: boolean; firstClear: boolean };
  reset(): void;                            // настройки сохраняются
  subscribe(fn: () => void): () => void; bindStorageEvents(): void;
}
episodeStars(p, ep): number;  episodeStarsNeeded(ep) = ceil(0.5 · 3 · levels.length);   // 15 для 10 уровней
isEpisodeUnlocked(p, eps, i): i === 0 || (победа в последнем уровне eps[i-1] && ★(eps[i-1]) ≥ needed && isEpisodeUnlocked(i-1));
isLevelUnlocked(p, eps, id, unlockAll?): эпизод открыт && (первый уровень || wins(предыдущего) > 0);
```

Проверка в Node [замер]: после 10 побед на 1★ эпизод 2 закрыт (10 < 15). После переигровки 5 уровней на 3★ (20 ★) — открыт. `newBest` срабатывает только при `prevBest > 0 && score > prevBest`; худший результат не снижает `stars` и `best`. Мусор `{"stars":7,"best":-5}` санитайзится в `3 / 0`, недопустимое `quality: "ultra"` становится `auto`. `{oops` сохраняется в `.corrupt`. `schema: 2` → `readOnly`.

Запись результата строго по 01: только при входе в `RESULTS`. Выход или рестарт во время `VICTORY_DELAY` или `BONUS_COUNT` не сохраняет победу. Поражение пишет `fails++` и `failStreak++`.

---

## 18. Локализация (ru)

Все строки — в `src/ui/strings.ru.ts`, `export const S = {...} as const`. Подстановки — `{name}`. Числа — `n.toLocaleString('ru-RU')`, разделитель U+00A0 есть в шрифтах [замер]. Множественное число — через `Intl.PluralRules('ru')`: категории `one` (1, 21), `few` (2, 22), `many` (0, 5, 11, 25) [замер].

```ts
const PR = new Intl.PluralRules('ru');
export const plural = (n: number, [one, few, many]: readonly [string, string, string]) =>
  ({ one, few, many } as Record<string, string>)[PR.select(n)] ?? many;
export const STARS = ['звезда', 'звезды', 'звёзд'] as const;   // plural(15, STARS) → «звёзд»
export const BIRDS = ['птица', 'птицы', 'птиц'] as const;
```

Правила: всегда «ё» («Счёт», «звёзд», «Ещё»); кавычки «ёлочки»; тире «—»; многоточие «…» одним символом; КАПС — через `text-transform: uppercase`, а в строках регистр обычный (для `aria-label` и озвучки).

| Ключ | Строка |
|---|---|
| `app.title` | Сердитые Птицы |
| `app.badge` | фан-ремейк |
| `app.version` | v{v} · фанатский проект, не связан с Rovio |
| `boot.loading` | Загрузка… {p}% |
| `boot.error.title` | Не удалось запустить игру |
| `boot.error.body` | Обновите страницу. Если не поможет — попробуйте другой браузер. |
| `boot.error.reload` | Обновить |
| `title.play` | Играть |
| `title.settings` / `title.more` | Настройки / Ещё… |
| `common.music` / `common.sound` | Музыка / Звуки |
| `common.fullscreen` / `common.exitFullscreen` | Во весь экран / Выйти из полноэкранного режима |
| `common.back` / `common.close` / `common.on` / `common.off` | Назад / Закрыть / Вкл / Выкл |
| `title.credits` | Об игре |
| `episodes.title` | Выберите эпизод |
| `episodes.num` | Эпизод {n} |
| `episodes.stars` | {got}/{total} |
| `episodes.lockedReq` | Пройдите «{prev}» и соберите {n} {stars} |
| `episodes.soon` / `episodes.soonBody` | Скоро… / Новые уровни в разработке |
| `episodes.unlocked` | Открыт эпизод «{name}»! |
| `ep.1` / `ep.2` / `ep.3` | Зелёные холмы / Пляжный закат / Снежные вершины |
| `levels.best` / `levels.notCleared` | Рекорд: {score} / Ещё не пройден |
| `levels.locked` | Сначала пройдите уровень {prev} |
| `levels.toNextEp` | До следующего эпизода: ещё {n} {stars} |
| `levels.epDone` | Эпизод пройден! |
| `levels.aria` / `levels.ariaLocked` | Уровень {id}: {s} из 3 звёзд, рекорд {score} / Уровень {id}, закрыт |
| `hud.pause` / `hud.restart` | Пауза (Esc) / Начать заново (R) |
| `hud.best` / `hud.score` | Рекорд / Счёт |
| `hud.toSling` | К рогатке |
| `hud.skip` | Коснитесь, чтобы пропустить |
| `hud.birdsLeft` | Птиц осталось: {n} |
| `tut.aim.touch` / `tut.aim.mouse` | Потяните птицу назад и отпустите! / Зажмите птицу, оттяните и отпустите! |
| `ability.red` | Коснитесь — и Ред издаст боевой клич! |
| `ability.blues` | Коснитесь — и Синие разделятся на троих! |
| `ability.chuck` | Коснитесь — и Чак рванёт вперёд! |
| `ability.bomb` | Коснитесь — и Бомб взорвётся! |
| `ability.matilda` | Коснитесь — и Матильда сбросит яйцо! |
| `ability.hal` | Коснитесь — и Хэл развернётся бумерангом! |
| `ability.silver` | Коснитесь — и Сильвер сделает петлю и ударит вниз! |
| `ability.key` | или нажмите Пробел |
| `pause.title` / `pause.resume` / `pause.restart` / `pause.levels` / `pause.aim` | Пауза / Продолжить / Заново / Уровни / Прицел |
| `win.banner` | Уровень пройден! |
| `win.oneShot` / `win.clean` | Одним выстрелом! / Чистая работа! |
| `win.score` / `win.best` / `win.newBest` | Счёт / Рекорд: {score} / Новый рекорд! |
| `win.next` / `win.restart` / `win.levels` | Дальше / Заново / Уровни |
| `win.lockedNext` | Соберите ещё {n} {stars}, чтобы открыть «{name}» |
| `win.allDone` | Вы прошли все уровни! |
| `lose.banner` | Уровень не пройден |
| `lose.taunt` | Свиньи смеются… пока! · Хрю-хрю! Попробуй ещё! · Почти получилось! · Башня устояла. Пока что. |
| `lose.score` / `lose.retry` / `lose.tipPrefix` | Счёт: {score} / Ещё раз / Совет: |
| `settings.title` / `settings.quality` | Настройки / Качество графики |
| `settings.q.auto` / `.high` / `.med` / `.low` | Авто / Высокое / Среднее / Низкое |
| `settings.aim` / `settings.aim.off` / `settings.aim.short` | Подсказка траектории / Выкл / Короткая |
| `settings.motion` / `.system` / `.reduce` / `.full` | Анимации / Как в системе / Уменьшить / Полные |
| `settings.shake` / `settings.haptics` / `settings.reset` | Тряска экрана / Вибрация / Сбросить прогресс |
| `confirm.reset.title` / `confirm.reset.body` | Сбросить прогресс? / Все звёзды и рекорды будут удалены. Это нельзя отменить. |
| `confirm.cancel` / `confirm.reset.ok` | Отмена / Сбросить |
| `toast.resetDone` / `toast.storageOff` | Прогресс сброшен / Прогресс не сохранится: браузер запретил хранилище |
| `toast.musicOn` / `toast.musicOff` / `toast.sfxOn` / `toast.sfxOff` | Музыка включена / Музыка выключена / Звуки включены / Звуки выключены |
| `rotate.title` / `rotate.body` / `rotate.anyway` | Поверните устройство / Игра рассчитана на горизонтальный экран / Играть так |
| `credits.title` | Об игре |
| `credits.body` | Сердитые Птицы — фанатский ремейк. Не связан с Rovio Entertainment. Графика, музыка и звуки созданы кодом. |
| `controls.title` | Управление |
| `controls.mouse` | Мышь: тяните птицу — прицел, тяните фон — обзор, колесо — масштаб |
| `controls.touch` | Касание: тяните птицу — прицел, один палец — обзор, два пальца — масштаб |
| `controls.keys` | R — заново · Esc — пауза · Пробел — способность · F — во весь экран · M — музыка |
| `a11y.won` | Уровень {id} пройден. {s} {stars} из 3. Счёт {score}. |
| `a11y.newBest` / `a11y.lost` / `a11y.paused` | Новый рекорд! / Уровень не пройден. / Игра на паузе. |

Советы экрана загрузки и карточки уровня (`tips[]`, по одному случайно, без повтора подряд):
1. Тяните птицу назад: чем дальше, тем сильнее выстрел.
2. Передумали? Отпустите птицу у самой рогатки — выстрел не потратится.
3. Каждая неиспользованная птица приносит 10 000 очков.
4. Чак пробивает дерево. Коснитесь в полёте — и он рванёт вперёд!
5. Синие делятся на троих и отлично бьют стекло.
6. Бомб взрывается по касанию или сам — через пару секунд после удара.
7. Матильда сбрасывает яйцо-бомбу прямо вниз.
8. Хэл летит бумерангом: коснитесь, и он развернётся.
9. Теренс тяжёлый — камню с ним не устоять.
10. Сильвер делает петлю и пикирует вниз.
11. Ящики TNT взрываются от сильного удара.
12. Свиньи в касках крепче обычных.
13. Колесо мыши или щипок двумя пальцами — приблизить и отдалить.
14. Нажмите R, чтобы мгновенно начать уровень заново.
15. Пробел включает способность птицы в полёте.
16. Три звезды — это меньше птиц и больше разрушений.
17. Лёд хрупкий, камень — самый прочный.
18. Падающие брёвна и камни тоже давят свиней.

Советы после трёх поражений подряд (`loseTips[]`): «Бейте в опоры: без них башня рухнет сама.» · «Стекло — Синими, дерево — Чаком, камень — Бомбом.» · «Иногда выгоднее попасть в TNT, чем в свинью.» · «Попробуйте выстрел по высокой дуге — сверху конструкции слабее.»

---

## 19. Доступность

### 19.1. Тач-зоны и размеры

- Видимый размер любой кнопки не меньше 44 css px (`max(44px, N·u)`). Хит-зона `::after` тоже не меньше 44×44. Это WCAG 2.5.5 (AAA, 44×44) и Apple HIG (44 pt) [факт]; AA-минимум 2.5.8 — 24×24.
- Расстояние между соседними целями не меньше 8 px: HUD 16u → 9.4 px при u 0.59, веер 12u.
- Захват птицы — `max(1.0 м, 44 px)` (01 §16 `GRAB_RADIUS_M`).
- Текст не мельче 14 px. Кнопки — с текстом или `aria-label`.

### 19.2. Контраст [замер, WCAG relative luminance]

| Пара | Контраст | Норма | Итог |
|---|---|---|---|
| Белый текст на теле зелёной кнопки `#5DBB2A` | 2.44:1 | 4.5 | **недостаточно без обводки** → обводка обязательна |
| Белый ↔ обводка зелёной `#1E5A0C` | 8.32:1 | 4.5 | ✓ (смежный цвет у буквы — обводка) |
| Белый ↔ обводки синей / оранжевой / красной (`#0E3F70` / `#7A3500` / `#5E0A06`) | 10.69 / 8.99 / 13.80 | 4.5 | ✓ |
| Белый на тёмной панели `#1A3352` | 12.81:1 | 4.5 | ✓ |
| `--muted #BFD6EE` на панели | 8.58:1 | 4.5 | ✓ |
| `#FFE36A` (рекорд) на панели | 10.03:1 | 4.5 | ✓ |
| Тёмно-коричневый на бумаге / вторичный | 11.77 / 5.72 | 4.5 | ✓ |
| Белый на небе `#5BC0F5` | 2.04:1 | — | текст над сценой — **только с обводкой `--ink`** (13+:1) |
| Золотая звезда / пустая звезда на панели | 7.92 / 3.95 | 3 (графика) | ✓ |
| Обводка кнопки `#1E5A0C` ↔ небо / холмы `#66BF4B` | 4.08 / 3.61 | 3 (1.4.11) | ✓ |
| Кольцо фокуса: `#FFD84A` ↔ панель / `--ink` ↔ небо | 9.26 / 8.61 | 3 | ✓ — двойное кольцо видно на любом фоне (одно жёлтое на небе — 1.47) |
| Белый замок на `#6B7A8C` | 4.39:1 | 3 | ✓ |

Пустая и заполненная звёзды различаются не только цветом: у заполненной есть блик и тёплая обводка, у пустой — плоская заливка и тёмная обводка. У закрытых плиток вместо номера иконка замка. Состояние «выключено» у переключателей показывает перечёркивание, а не только серый цвет.

### 19.3. Уменьшение движения

`reduced = settings.motion === 'reduce' || (settings.motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches)`. Результат пишется в `<html data-motion="reduced">` и `anim.motion.reduced`, слушаем `change` у `matchMedia`.

| Элемент | Обычно | Reduced |
|---|---|---|
| Переходы экранов (слайд, зум, ирис) | 0.36–0.5 с | кроссфейд 0.15 с |
| Pop-in | `0.3 → 1.08 → 0.97 → 1`, 0.36 с | opacity + `0.96 → 1`, 0.15 с |
| Бесконечные циклы (пульс Play, «Дальше», текущей плитки, кольца, `wiggle`, `bob`, полосы прогресса, бейдж) | ∞ | нет: статичная подсветка (кольцо 4u без анимации) |
| Звёзды результатов | полёт + бум + искры + дрожь панели, 0.5 / 0.95 / 1.4 с | opacity + `scale .8 → 1` 120 мс; 0.3 / 0.55 / 0.8 с; без частиц и дрожи; звуки остаются |
| Счёт результатов | 1.2 с | 0.5 с |
| Тряска камеры (04 §8.8) | по событиям | по умолчанию `shake = false` |
| Вспышка экрана от взрыва | α до 0.35 | α до 0.12 |
| Интро-облёт (01 §6.3) | пан 1.8 с | склейка: кроссфейд 0.2 с сразу в вид рогатки |
| Фон титула | птицы летают, камера качается | статика, облака ×1/3 |
| Смена советов загрузки | fade | мгновенно |

Вспышки (WCAG 2.3.1): не больше 3 вспышек экрана в секунду, лишние сливаются в одну.

### 19.4. Фокус, озвучка, семантика

- Экраны — `<section aria-labelledby>`, оверлеи и диалоги — `role="dialog" aria-modal="true"`. Фокус ставится на основную кнопку, Tab ловится внутри, после закрытия фокус возвращается.
- Canvas: `role="img" aria-label="Игровое поле"`. Счёт HUD — `aria-hidden` (меняется слишком часто). Итоги объявляются через `aria-live="polite"` (`a11y.won`, `a11y.lost`, `a11y.paused`, тосты).
- Кольцо фокуса — только `:focus-visible`, у мыши его нет.
- Звук не несёт уникальной информации: у каждого звукового события (звезда, рекорд) есть визуальный эквивалент.

---

## 20. Производительность UI

- Анимируем только `transform` и `opacity`. Исключения: ирис (атрибут `r` у одного SVG-круга) и прогресс (`scaleX`). `will-change: transform` ставится на время анимации и снимается по `finished`.
- `box-shadow`, `filter` и `backdrop-filter` на анимируемых элементах не меняем. Тень кнопки при нажатии — исключение: 70 мс, один элемент.
- DOM HUD обновляется только при смене текста. `contain: layout paint` на `.hud`, `.screen`, `.overlay`.
- Частицы UI — пул из 40 узлов, переиспользуется. Конфетти рекорда — 30 штук за раз, не больше.
- Арт карточек эпизодов и свинья поражения — canvas, рендер один раз на показ. Фоновые полосы — из кэша 04.
- Пока открыт оверлей, рендер мира продолжается (под паузой — статичный кадр, рендер 1 раз). Под результатами мир живой, но физика после `RESULTS` останавливается через 2 с (экономия батареи) [рекомендация].
- Бюджет UI в кадре — не больше 1.5 мс на среднем телефоне. Таймлайн результатов — rAF + WAAPI, без `setInterval`.

---

## 21. Тестовые хуки и критерии приёмки

`data-testid`: `btn-play`, `btn-settings`, `episode-card-{id}`, `level-tile-{id}` (атрибуты `data-locked`, `data-stars`), `hud-pause`, `hud-restart`, `hud-score`, `hud-to-sling`, `pause-resume`, `pause-restart`, `pause-levels`, `toggle-music`, `toggle-sfx`, `results-won`, `results-lost`, `results-star-{1..3}` (`data-earned`), `results-score`, `results-next`, `results-restart`, `results-levels`, `new-best`, `rotate-overlay`, `iris`. Глобально `window.__ui = { screen(), overlay(), busy() }`. Параметр `?test=1` — reduced motion и длительности ×0, без случайных советов.

Критерии (e2e в Chromium + ручная проверка):
1. На 640×360, 800×360, 852×393 (с safe-area 47/21), 1280×720, 1920×1080, 2560×1080 и 1180×820 нет горизонтальной прокрутки, а все элементы экранов внутри видимой области.
2. Каждая интерактивная цель: `getBoundingClientRect()` не меньше 44×44 (с учётом `::after` — по `elementFromPoint` в углах зоны).
3. Путь «титул → эпизод 1 → 1-1 → победа → Дальше → 1-2» проходится только клавиатурой (Enter, стрелки, Space, N).
4. Esc в игре открывает паузу, повторный Esc закрывает, симуляция стоит (время сессии не растёт).
5. R из любого игрового состояния приводит к `READY` за ≤ 2.0 с.
6. Таймлайн победы: звёзды «приземляются» в 0.5 / 0.95 / 1.4 ± 0.05 с; кнопки активны с 1.7 с; один тап доводит всё до финала за ≤ 1 кадр.
7. При `localStorage`, бросающем исключение, нет необработанных ошибок; тост показывается один раз.
8. В reduced motion `document.getAnimations().filter(a => a.effect?.getTiming().iterations === Infinity).length === 0`.
9. Портрет на тач-эмуляции показывает `rotate-overlay`; «Играть так» даёт летербокс 16:9.
10. Тап по паузе во время полёта **не** включает способность.

---

## 22. Согласование с другими документами и открытые вопросы

1. **Ключ хранилища**: 01 §12.1 (`abclone:v1:progress`) и спецификация §3 (`angrybirds.progress.v1`) расходятся. Принят ключ спецификации. В 01 поменять ключ и схему настроек: `music` и `sfx` — булевы, как в `AudioEngine.setMusic(on)`, громкости убраны.
2. **Порядок на экране победы**: принят вариант 05 §8.7 (звёзды 0.5 / 0.95 / 1.4 → счёт 1.2 с). Вариант 01 §10 (счёт 0.8 с → звёзды через 0.35 с) отклонён. Значения `STAR_INTERVAL` и `SCORE_ROLL` в 01 §16 обновить на `0.45` и `1.2`.
3. **Пустая звезда**: `#6B6B6B` α0.5 из 01 на тёмной панели даёт ≈ 2:1. Принят `#8A8F99` (3.95:1).
4. **Шрифты**: `@fontsource/lilita-one` в `package.json` не используется (04 §9.1) — удалить; добавить `@fontsource/rubik`.
5. **`UI`-контракт спецификации**: расширен (§1.3) — `showBanner`, `transition`, `toast`, `abilityHint`, `aimTutorial`, `setMotion`; `showWin` и `showLose` принимают результат. Колбэки `onSkip` и `onCameraHome` нужны вводу и HUD.
6. **Состояния**: `SessionState` ядра (`loading | ready | aiming | flying | settling | bonus | won | lost`) грубее `LevelState` из 01. UI опирается на `LevelState` из `GameScreen` (баннеры, интро). `GameScreen` должен отдавать его в `updateHud`.
7. Открыто: показывать ли рекорд на плитке уровня на тач-устройствах, где нет hover (сейчас — только в паузе). Нужен ли «Пропустить уровень» после N неудач (P3 по 01 §15).

---

## Источники

- [Angry Birds (video game) — Wikipedia](https://en.wikipedia.org/wiki/Angry_Birds_(video_game)), [Stars — Angry Birds Wiki](https://angrybirds.fandom.com/wiki/Stars?oldid=5182) — звёзды по порогам очков, серые звёзды заменяются золотыми, экран результатов со звёздами и рекордом.
- [Poached Eggs — Angry Birds Wiki](https://angrybirds.fandom.com/wiki/Poached_Eggs_3-12), [Golden Egg Levels — Angry Birds Wiki](https://angrybirds.fandom.com/wiki/Golden_Egg_Levels), [PocketGamer: golden eggs](https://www.pocketgamer.com/angry-birds/angry-birds-how-to-get-the-golden-eggs-and-golden-stars-part-1/) — по 21 уровню на тему, золотые яйца на экране выбора уровня.
- [Rovio Classics: Angry Birds — TCRF](https://new.tcrf.net/Rovio_Classics:_Angry_Birds), [Version History — Angry Birds Wiki](https://angrybirds.fandom.com/wiki/Rovio_Classics:_Angry_Birds/Version_History) — меню эпизодов и уровней, правки UI золотых яиц.
- [Getting started: Rovio Classics Angry Birds — Android Police](https://www.androidpolice.com/getting-started-rovio-classic-angry-birds/) — рестарт в паузе без штрафа; кнопка Mighty Eagle рядом с паузой.
- [Angry Birds and accessibility standards — Game Developer](https://www.gamedeveloper.com/design/angry-birds-and-accessibility-standards) (по выдержке из поиска; страница не открылась) — в паузе 5 кнопок, ключевые функции в 2 касаниях, символы вместо текста.
- [Brand new vs tried and true: designing UI — Rovio](https://rovio.com/articles/brand-new-vs-tried-and-true-designing-ui-for-new-and-established-games) (по выдержке), [UX/UI Design: Angry Birds 2 — Contra](https://contra.com/p/lBgkMRE7-uxui-design-angry-birds-2-mobile-game), [Angry Birds style UI — Coherent Labs](https://coherent-labs.com/posts/angry-birds-style-ui-with-hummingbird/) — принципы UI AB2; центральная кнопка PLAY; набор HUD «пауза, рестарт, звук, счёт».
- [MDN: paint-order](https://developer.mozilla.org/docs/Web/CSS/paint-order), [mdn/browser-compat-data #17951](https://github.com/mdn/browser-compat-data/issues/17951) — `paint-order` для HTML-текста, Baseline 2024 (Chrome 123).
- [WebKit Bug 206854](https://bugs.webkit.org/show_bug.cgi?id=206854), [WebKit Bug 240312](https://www2.webkit.org/show_bug.cgi?id=240312), [Apple Developer Forums 133248](https://developer.apple.com/forums/thread/133248?page=2) — Fullscreen API на iPhone для не-видео элементов отсутствует (на июнь 2026).
- [WebKit Bug 257695](https://bugs.webkit.org/show_bug.cgi?id=257695), [W3C Screen Orientation](https://www.w3.org/TR/2022/WD-screen-orientation-20221007/), [PlayCanvas forum](https://forum.playcanvas.com/t/force-landscape-orientation-mode/14501) — `orientation.lock()` только в полноэкранном режиме; Safari не поддерживает.
- [WCAG 2.2: Target Size (Enhanced) 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced), [Target Size (Minimum) 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), [Contrast 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum), [Non-text Contrast 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast), [Three Flashes 2.3.1](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold), [Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) — тач-цели, контраст, вспышки.
- [easings.net](https://easings.net/) — значения `cubic-bezier` для easeOutCubic, easeInCubic, easeInOutCubic, easeOutBack, easeInBack.
- Внутренние: `docs/research/01-gameplay.md` (FSM, тайминги, очки, звёзды), `02-characters.md` (позы свиней, очередь птиц), `04-visual.md` (шрифты, звезда, качество, DPR), `05-audio.md` (API `AudioEngine`, UI-звуки, награды), `docs/superpowers/specs/2026-10-24-angry-birds-design.md` (контракт `UI`, ключ хранилища).
