# Сердитые Птицы — фан-ремейк Angry Birds в браузере. Спецификация

Дата: 2026-10-24. Статус: утверждена в автономном режиме (пользователь поручил работу целиком, без промежуточных согласований).

## 1. Понимание задачи

**Что сказал пользователь:** «повторить игру Angry Birds… полностью автономно… исследуешь, подбираешь материал, разрабатываешь план, создаёшь игру с нуля; игра не должна уступать Angry Birds 2020 года визуально, по механике и физике; как всё будет готово — сообщи».

**Допущения (мои решения):**
- Платформа — браузер (десктоп + мобильные, ландшафт). Играбельная ссылка — сборка в один HTML-файл, опубликованная как Artifact; плюс обычная сборка `dist/` для GitHub Pages.
- Все ассеты оригинальные: графика рисуется кодом (Canvas 2D), звук и музыка синтезируются (Web Audio). Ассеты Rovio (спрайты, мелодия темы, логотип) не используются — авторское право. Персонажи узнаваемы по стилю, но нарисованы заново.
- Название в интерфейсе — «Сердитые Птицы» (так игру называют по-русски), подзаголовок «фан-ремейк». Интерфейс на русском.
- Формат — классический (рогатка, птицы по очереди, звёзды за очки), как в Angry Birds Classic/Friends, с визуальной полировкой уровня Angry Birds 2. Сложные мета-системы AB2 (карты, заклинания, монетизация) не переносим — см. §14.

**Критерии успеха:**
1. Физика на Box2D (planck.js): стабильные стопки, реалистичное разрушение, урон от импульса, взрывы.
2. 8 птиц со способностями, 6 видов свиней, 3 материала + TNT, рельеф.
3. 30 уровней в 3 эпизодах (3 темы оформления), каждый автоматически проверен: устойчив без выстрелов и проходим.
4. Визуал: многослойные параллакс-фоны, объёмные персонажи с обводкой, стадии повреждений, частицы, всплывающие очки, тряска камеры, анимации интерфейса.
5. Полный игровой цикл: титул → эпизоды → уровни → игра → победа/поражение со звёздами; сохранение прогресса; пауза/рестарт; звук и музыка с переключателями.
6. 60 FPS на среднем ноутбуке; управление мышью, тачем и клавиатурой.
7. Тесты: юнит-тесты ядра, проверка всех уровней в headless-физике, e2e-смоук в Chromium.

## 2. Стек

| Что | Выбор | Почему |
|---|---|---|
| Язык/сборка | TypeScript 7 + Vite 8 | быстрая сборка, строгая типизация |
| Физика | planck.js 1.5 | порт Box2D — тот же движок, что в оригинальной Angry Birds |
| Рендер | Canvas 2D, процедурные спрайты в кэше offscreen-холстов | полный контроль над стилем без файлов-ассетов; drawImage кэшированных спрайтов дешёв |
| UI | DOM + CSS поверх холста | чёткий текст, CSS-анимации, адаптивность |
| Звук | Web Audio API, синтез | оригинальные звуки без файлов |
| Шрифт | @fontsource (Luckiest Guy / Lilita One — выбор по исследованию) | мультяшный жирный шрифт, встраивается в сборку |
| Тесты | Vitest (Node) + Playwright (Chromium предустановлен) | ядро работает в Node без DOM |
| Один файл | vite-plugin-singlefile | публикация как Artifact |

## 3. Архитектура

Слои и направление зависимостей (стрелка — «зависит от»):

```
app (main.ts, App, GameScreen) ──► ui, render, audio, input, core, levels, storage
render ──► core (только типы/api), config
audio  ──► core (только события/типы)
ui     ──► core (типы), storage, levels (метаданные)
input  ──► render/Camera, core/api
core   ──► planck, config        (НЕТ DOM — работает в Node)
levels ──► core/types
```

### Структура папок

```
src/
  main.ts                    загрузка шрифтов, предгенерация спрайтов, запуск App
  config/constants.ts        ВСЕ настраиваемые числа (физика, геймплей, камера, очки)
  core/                      логика + физика, без DOM
    types.ts                 LevelDef и др. (контракт)
    events.ts                GameEvent, SessionState (контракт)
    api.ts                   GameSession, EntityView… (контракт)
    rng.ts                   детерминированный ГПСЧ
    characters.ts            таблицы птиц и свиней
    materials.ts             таблица материалов
    physics/                 обёртка planck: тела из LevelDef, рельеф, урон, взрывы, удаление
    game/                    GameSession, рогатка, способности, очки, settle-детектор, след
  levels/                    episode1.ts, episode2.ts, episode3.ts, index.ts
  render/
    canvas.ts                createCanvas/ctx2d
    Camera.ts                мир↔экран, зум, панорама, следование, облёт, тряска
    Renderer.ts              кадр: фон → рельеф → рогатка(зад) → тела → рогатка(перед) → эффекты
    SpriteCache.ts           кэш спрайтов по ключу и масштабу
    sprites/api.ts           тип Sprite (контракт)
    sprites/birds.ts         рисование птиц
    sprites/pigs.ts          рисование свиней
    sprites/blocks.ts        блоки (дерево/лёд/камень × формы × 4 стадии), TNT, яйцо
    sprites/slingshot.ts     рогатка (зад/перед), резинки, кармашек
    sprites/background.ts    параллакс-фоны 3 тем + рельеф
    fx/                      частицы, всплывающие очки, вспышки взрывов
  audio/                     AudioEngine, синтез звуков, музыка
  input/                     указатель/тач/колесо/клавиатура → команды
  ui/                        экраны DOM, HUD, стили, иконки
  storage/progress.ts        прогресс в localStorage
dev/                         страницы предпросмотра графики (не в проде)
scripts/                     shot.mjs (скриншоты), validate/solve уровней
tests/                       Vitest
```

### Контракты модулей

Ядро (`src/core/api.ts`): `createSession(level, {seed})` → `GameSession` с методами `step()` (ровно 1/60 с), `canGrab/beginAim/updateAim/release/cancelAim`, `activateAbility`, `launch(angleDeg, power)` (для тестов/решателя), и данными для рендера: `entities()`, `queue()`, `slingshot()`, `trail()`, `focusBird()`, `predictTrajectory(n)`, `drainEvents()`, `stars()`. Ядро детерминировано при одинаковом seed (никакого `Math.random` внутри core).

Спрайты (`src/render/sprites/*`): чистые функции «нарисуй в новый холст» → `Sprite {canvas, ox, oy, ppu}`; физическая форма тела точно совпадает с силуэтом (контур круга птицы = физический радиус). Подписи:

```ts
// birds.ts
export function renderBird(type: BirdType, pose: BirdPose, radiusM: number, ppu: number): Sprite;
// pigs.ts
export function renderPig(type: PigType, pose: PigPose, damageStage: number, hasHelmet: boolean, radiusM: number, ppu: number): Sprite;
// blocks.ts
export function renderBlock(material: Material, shape: BlockShape, wM: number, hM: number, damageStage: number, seed: number, ppu: number): Sprite;
export function renderTnt(sizeM: number, ppu: number): Sprite;
export function renderEgg(radiusM: number, ppu: number): Sprite;
// slingshot.ts
export function renderSlingshot(ppu: number): { back: Sprite; front: Sprite; backFork: Vec; frontFork: Vec; anchor: Vec }; // точки — в метрах относительно основания
export function drawBand(ctx, from: ScreenPt, to: ScreenPt, thicknessPx: number, stretch: number): void;
export function drawPocket(ctx, at: ScreenPt, angle: number, sizePx: number): void;
// background.ts
export class Background { constructor(theme: ThemeId); draw(ctx, view: ViewInfo): void; }       // небо + параллакс
export function drawTerrain(ctx, terrain: TerrainDef[], theme: ThemeId, view: ViewInfo): void;  // рельеф в мире
export function drawForeground(ctx, theme: ThemeId, view: ViewInfo): void;                     // трава/кусты перед сценой
```

`ViewInfo` (`src/render/view.ts`): `{ screenW, screenH (пиксели устройства), camX, camY (центр, м), scale (пикс. устройства на метр), time (с) }` + функции `worldToScreen`.

Эффекты (`src/render/fx/Fx.ts`): `class Fx { handle(e: GameEvent): void; update(dt): void; draw(ctx, view): void; }` — частицы и всплывающие очки в мировых координатах.

Звук (`src/audio/AudioEngine.ts`): `unlock()`, `setSfx(on)`, `setMusic(on)`, `playMusic('menu'|'level'|null)`, `handle(e: GameEvent, ctx?: {camX, viewW})`, `ui(name)`.

Камера (`src/render/Camera.ts`): позиция/зум, `worldToScreen/screenToWorld`, `panBy`, `zoomAt`, `follow`, `flyTo(x,y,zoom,dur)`, `shake(amount,dur)`, ограничение границами уровня.

UI (`src/ui/UI.ts`): `class UI { constructor(root, deps); showTitle(); showEpisodes(); showLevels(epId); showHud(); updateHud({score, best, birdsLeft}); showPause(); showWin(result); showLose(); hideAll(); }` с колбэками навигации в deps.

Сохранение (`src/storage/progress.ts`): `loadProgress()`, `saveLevelResult(levelId, score, stars)`, `isUnlocked(levelId)`, `getSettings()/setSettings()`; ключ `angrybirds.progress.v1`.

## 4. Игровой цикл

- `requestAnimationFrame`; накопитель времени; физика строго по 1/60 с (не более 5 шагов за кадр — защита от «спирали смерти»); рендер интерполирует положение тел между шагами (`px/py/pangle`).
- Каждый кадр: `session.step()`×N → `drainEvents()` → Fx, Audio, Camera (тряска), HUD → Renderer.
- Состояния сессии: `loading → ready → aiming → flying → settling → (loading | bonus → won | lost)`. Облёт камеры в начале уровня — забота GameScreen (ввод блокирован, касание пропускает облёт).

## 5. Физика и урон (принципы; числа — в §15 и `config/constants.ts`)

- Мир в метрах, Y вверх, гравитация и скорость запуска подобраны экспериментом (док. 03-physics).
- Все тела уровня создаются **спящими** (`awake:false`) — конструкция не дрожит до первого касания.
- Урон: из `post-solve` берём максимальный нормальный импульс контакта; `damage = max(0, impulse − порог) × множитель × (множитель птица×материал, если бьёт птица)`; урон получают оба тела. Пороги откалиброваны так, чтобы покой/трение не наносили урона.
- Удаление тел — только после `world.step()`, из очереди. **Перед удалением будим все тела, касающиеся удаляемого** (иначе Box2D оставит их спящими «в воздухе»).
- Взрыв: `queryAABB` в радиусе, радиальный импульс с линейным затуханием + урон, без «телепортации» (импульс ограничен сверху).
- Птица — `bullet` (CCD). Вылет за границы мира или «застревание» дольше таймаута → удаление.
- Settle-детектор: все тела спят или их скорости ниже порога N с подряд; жёсткий таймаут.

## 6. Персонажи

8 птиц: Red, Blues, Chuck, Bomb, Matilda, Hal, Terence, Silver — способности и числа в §15. 6 свиней: small/medium/large/helmet/mustache/king — HP и броня в §15. Визуальные спецификации — `docs/research/02-characters.md`.

## 7. Уровни

- Формат — `LevelDef` (`src/core/types.ts`), уровни — TS-модули `src/levels/episodeN.ts`.
- 3 эпизода × 10 уровней, темы `meadow`, `beach`, `snow`. Прогрессия птиц — §15.
- Автопроверка (Vitest): (1) **устойчивость** — разбудить все тела, 10 с симуляции без выстрелов: ни одна свинья не погибла, ни один блок не разрушен, смещения малы; (2) **проходимость** — решатель перебирает выстрелы (угол × сила × момент способности) жадно по птицам и должен уничтожить всех свиней; (3) **пороги звёзд** рассчитываются по результату решателя (три звезды ≈ хорошая, но не идеальная игра).

## 8. Графика

- Стиль: толстая тёмная обводка, мягкий объём (радиальные градиенты), блики, насыщенная палитра; спецификации в `docs/research/04-visual.md`.
- Спрайты кэшируются по ключу `(тип, поза, стадия, размер, ppu-ступень)`; ppu округляется вверх до ступени √2, рисуется с `imageSmoothingQuality='high'`.
- Слои кадра: небо → дальние облака/горы → холмы → средний план → рельеф → рогатка (зад) + задняя резинка → тела → передняя резинка + кармашек + рогатка (перед) → частицы/очки → передний план (трава) → HUD (DOM).
- Предпросмотр графики: страницы `dev/*.html`, скриншоты `node scripts/shot.mjs <страница> <png>`; каждый художественный модуль проходит минимум 3 итерации «скриншот → критика → правка».

## 9. Звук

Синтез Web Audio: шины master/sfx/music, лимит голосов и кулдауны одинаковых звуков, громкость по силе удара и удалённости от камеры, разблокировка по первому жесту. Музыка — оригинальная задорная мелодия для меню и тихая для уровня. Рецепты — `docs/research/05-audio.md`.

## 10. UI

Экраны: загрузка → титул → эпизоды → уровни → игра (HUD) → пауза / победа / поражение; настройки звука и музыки; сброс прогресса. Анимации pop-in с перелётом, звёзды по очереди с частицами, подсчёт очков. Спецификация — `docs/research/07-ui-ux.md`.

## 11. Ввод

Мышь/тач: нажатие на птицу в рогатке — прицеливание; в полёте — тап = способность; иначе перетаскивание — панорама; колесо/щипок — зум. Клавиатура: `R` — рестарт, `Esc` — пауза, `Пробел` — способность. Портретная ориентация — подсказка повернуть устройство.

## 12. Тестирование

- `npm test`: юнит-тесты ядра (урон, очки, звёзды, рогатка, способности, settle), тесты уровней (устойчивость + проходимость), тест хранилища.
- `npm run typecheck`, `npm run build`.
- e2e (`scripts/e2e.mjs`): загрузка без ошибок консоли, переходы по меню, выстрел в уровне 1-1, экран победы через тестовые хуки.
- Визуальный QA: скриншоты ключевых экранов и моментов (выстрел, разрушение, взрыв, победа) и разбор агентами-критиками.

## 13. Сборка и публикация

`npm run build` → `dist/` (GitHub Pages, workflow `.github/workflows/deploy.yml`); `npm run build:single` → `dist-single/index.html` → публикация как Artifact (играбельная ссылка).

## 14. Чего не делаем

Онлайн, покупки, рекламу, карты/заклинания/Destructometer из AB2, Mighty Eagle, многокомнатные уровни, редактор уровней для игрока, лидерборды. Причина: не нужны для ядра игрового опыта и раздувают объём; классический формат — то, что узнаётся как «Angry Birds».

## 15. Численные параметры

Источник истины — `docs/research/00-summary.md` (сводка экспериментов) и `src/config/constants.ts`. Ниже — утверждённые значения (заполняется после исследования).
