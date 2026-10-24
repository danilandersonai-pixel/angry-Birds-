# Сердитые Птицы — план реализации

> **Для агентов-исполнителей:** план исполняется волнами Workflow (режим ultracode, субагенты + независимые ревьюеры/критики). Шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** браузерный фан-ремейк Angry Birds уровня AB2 (2020) — физика Box2D, 8 птиц, 6 свиней, 30 уровней, процедурная графика, синтезированный звук, полный цикл меню.

**Архитектура:** ядро (`src/core`, без DOM, детерминированное) отдаёт снимки сущностей и события; рендер (Canvas 2D, кэш процедурных спрайтов), эффекты, звук и DOM-интерфейс реагируют на события; `GameScreen` связывает всё фиксированным шагом 1/60 с.

**Стек:** TypeScript 7, Vite 8, planck.js 1.5.1, Vitest 5, Playwright (Chromium), tsx, vite-plugin-singlefile, @fontsource.

**Спецификация:** `docs/superpowers/specs/2026-10-24-angry-birds-design.md`; числа — `docs/research/00-summary.md` и `03-physics.md` (приоритет по физике).

## Глобальные ограничения

- Мир: метры, Y вверх, шаг 1/60 с; гравитация (0, −15), V_MAX 24 м/с, R_MAX 2.0 м (03-physics §0).
- Рогатка: ANCHOR = основание + (0, 2.7); рога (−0.30, 2.95) и (+0.28, 2.90) — `src/config/constants.ts` `SLINGSHOT`, не менять.
- В `src/core` нет DOM и нет `Math.random` (только `Rng`).
- Никаких ассетов Rovio: графика кодом, звук синтезом, музыка оригинальная.
- Интерфейс и комментарии — на русском; идентификаторы — английские.
- Контракты `src/core/types.ts`, `events.ts`, `api.ts`, `render/sprites/api.ts`, `render/view.ts` меняются только обратно-совместимо.

## На что смотреть при ревью (не покрыто модульными тестами)

1. **Экраны 844×390, 4:3, 21:9, dpr 2** — интерфейс и камера ничего не обрезают, тач-зоны ≥ 44 px. Проверка: e2e-скриншоты в трёх размерах (Задача 14).
2. **Вкладка скрыта / долгий кадр** — после возврата нет «взрыва» физики: не больше 4 шагов за кадр, пауза на `visibilitychange`. Проверка: e2e эмулирует `hidden` (Задача 14).
3. **Звук заблокирован до жеста** — игра работает без звука, ошибок в консоли нет. Проверка: e2e без жеста (Задача 14).
4. **localStorage недоступен или повреждён** — игра работает, прогресс в памяти. Проверка: тест `ProgressStore(null)` и битый JSON (Задача 9).
5. **Хаотичный ввод** — двойной тап, отпускание вне canvas, второй палец при прицеливании, рестарт в полёте или во время экрана победы: нет зависших состояний. Проверка: тесты жестов (Задача 8) и e2e-рестарт в полёте (Задача 14).

---

## Волна 1 — модули (параллельно)

### Задача 1: Ядро (физика, урон, птицы, GameSession)
**Файлы:** `src/config/constants.ts` (дополнить), `src/core/{characters,materials,index}.ts`, `src/core/physics/**`, `src/core/game/**`; тесты `tests/core/**`, фикстуры `tests/fixtures/**`.
**Интерфейсы:** производит `createSession(level: LevelDef, opts?: {seed?: number}): GameSession` (контракт `src/core/api.ts`).
- [x] Реализация по 01/02/03 (рельеф, блоки с INSET, свиньи, TNT, птицы-bullet, урон из post-solve, взрывы, pre-settle + сон, будить соседей перед удалением, 8 способностей, очередь, след, предсказание траектории, очки, звёзды, события).
- [ ] Тесты: рогатка (радиус, отмена, линейность), дальность ±10 %, покой без урона 10 с, разрушение льда быстрым ударом, смерть свиньи от падающего блока, взрыв рушит соседей, каждая способность, переходы до won/lost, очки/звёзды, детерминизм, блок падает после удаления опоры. `npx vitest run tests/core` — зелёный.
- [ ] Независимое ревью экспериментами → исправления с регрессионными тестами.

### Задача 2: Headless-симулятор и решатель
**Файлы:** `src/core/sim/**`, `scripts/level-report.ts`, `tests/core/sim.test.ts`.
**Интерфейсы:** `checkStability(level, seconds=10)`, `simulateShots(level, shots, seed)`, `solveLevel(level, opts)`, `suggestStars(level, solveResult)`; CLI `npx tsx scripts/level-report.ts <модуль> [id]`.
- [ ] Тесты: стабильная башня проходит, висящий блок — нет; простой уровень решается.

### Задача 3: Персонажи — ✅ готово
`src/render/sprites/{birds,pigs,charCommon}.ts`, `renderBird(type, pose, radiusM, ppu)`, `renderPig(type, pose, damageStage, hasHelmet, radiusM, ppu)`; 2 раунда арт-критики.

### Задача 4: Блоки, TNT, яйцо, рогатка
**Файлы:** `src/render/sprites/{blocks,slingshot,props}.ts`, `dev/preview-blocks.html`.
**Интерфейсы:** `renderBlock(material, shape, wM, hM, damageStage, seed, ppu)`, `renderTnt(sizeM, ppu)`, `renderEgg(radiusM, ppu)`, `renderDebris(material, sizePx, seed)`, `renderSlingshot(ppu) → {back, front}` (начало координат — основание), `drawBand(ctx, x1, y1, x2, y2, thicknessPx)`, `drawPouch(ctx, x, y, angle, halfWidthPx, thicknessPx)`.
- [ ] 2 раунда арт-критики по скриншотам.

### Задача 5: Фоны, рельеф, передний план (3 темы)
**Файлы:** `src/render/sprites/{background,terrain}.ts`, `dev/preview-world.html`.
**Интерфейсы:** `class Background(theme).draw(ctx, view)`, `drawTerrain(ctx, terrain, theme, view)`, `drawForeground(ctx, theme, view)`, `THEME_INFO`.
- [ ] Бесшовность, заполнение экрана при любом зуме и соотношении сторон, ≤ 2 мс на кадр; 2 раунда критики.

### Задача 6: Звук и музыка
**Файлы:** `src/audio/**`, `scripts/render-audio.mjs`, `dev/preview-audio.html`, `tests/audio/**`.
**Интерфейсы:** `class AudioEngine { unlock(); setSfx(); setMusic(); setMasterVolume(); playMusic('menu'|'level'|null); handle(e, listener?); ui(name); ready }`.
- [ ] Объективная проверка: офлайн-рендер в WAV, пики < −1 dBFS, спектрограммы; ревью и исправления.

### Задача 7: Эффекты
**Файлы:** `src/render/fx/**`, `dev/preview-fx.html`.
**Интерфейсы:** `class Fx { handle(e); update(dt); draw(ctx, view); drawFlash(ctx, view); takeShake(); clear(); count }`, `drawTrail(ctx, view, points)`.
- [ ] Пул ≤ 600 частиц, ≤ 1.5 мс при 400 частицах; ревью по сериям кадров.

### Задача 8: Камера и ввод
**Файлы:** `src/render/Camera.ts`, `src/input/**`, `tests/render/camera.test.ts`, `tests/input/**`.
**Интерфейсы:** `class Camera` (см. спецификацию §3), `class InputController(canvas, camera, handlers: InputHandlers)`.
- [ ] Тесты: мир↔экран туда-обратно, zoomAt сохраняет точку, границы и земля, flyTo по времени, follow сходится; тесты жестов (тап/драг/щипок, отпускание вне canvas, второй палец при прицеливании).

### Задача 9: Интерфейс и сохранение
**Файлы:** `src/ui/**`, `src/storage/progress.ts`, `tests/storage/**`, `dev/preview-ui.html`.
**Интерфейсы:** `class ProgressStore`, `class UI(root, deps: UIDeps)` (см. отчёт волны 1).
- [ ] Тесты хранилища: сохранение и рекорд, разблокировка, `ProgressStore(null)`, битый JSON, сброс.
- [ ] 2 раунда UX-критики по скриншотам (1600×900, 844×390, портрет).

## Волна 2 — сборка игры и уровни

### Задача 10: Интеграция
**Файлы:** `src/render/{Renderer,SpriteCache}.ts`, `src/app/{App,GameScreen,MenuScene}.ts`, `src/main.ts`, `index.html`.
**Интерфейсы:** потребляет все интерфейсы волны 1; производит `window.__game` (тестовые хуки: `state()`, `launch(angleDeg, power)`, `ability()`, `startLevel(id)`, `skipIntro()`, `fastForward(sec)`).
- [ ] Цикл: накопитель, ≤ 4 шагов за кадр, интерполяция, пауза на `visibilitychange`.
- [ ] Кадр по слоям из спецификации §8; кэш спрайтов со ступенями ppu √2; прогрев при загрузке уровня.
- [ ] Облёт камеры в начале уровня, следование, возврат; живая сцена под меню.
- [ ] Связь событий с Fx, Audio, Camera.shake и HUD; победа/поражение → UI + ProgressStore.

### Задачи 11–13: Эпизоды 1, 2, 3 (по 10 уровней)
**Файлы:** `src/levels/episode{1,2,3}.ts`, `src/levels/index.ts` (`EPISODES: EpisodeDef[]`), `tests/levels/*.test.ts`.
- [ ] Каждый уровень: `checkStability` проходит, `solveLevel` решает, пороги звёзд по `suggestStars`; прогрессия птиц и тем из 06-levels.md.
- [ ] Тест `tests/levels/levels.test.ts` прогоняет все 30 уровней.

### Задача 14: e2e
**Файлы:** `scripts/e2e.mjs`.
- [ ] Загрузка без ошибок консоли; титул → эпизод → уровень 1-1; выстрел через хук; победа или поражение; размеры 1600×900, 844×390, 1280×960; `visibilitychange` во время полёта; рестарт в полёте.

## Волна 3 — качество

- [ ] **Задача 15:** визуальный QA по скриншотам игровых моментов (прицел, полёт, удар, разрушение, взрыв, победа) во всех темах → правки.
- [ ] **Задача 16:** QA ощущений: камера, сила, урон, способности — играть через хуки, сравнивать с 01/03 → настройка констант.
- [ ] **Задача 17:** код-ревью ветки на баги → исправления.
- [ ] **Задача 18:** производительность: 60 FPS на уровне с наибольшим числом тел (замер в Chromium).

## Волна 4 — публикация

- [ ] **Задача 19:** `npm run build` и `npm run build:single`, Artifact (играбельная ссылка), `.github/workflows/deploy.yml` (Pages), README на русском (как играть, как запускать, архитектура), обновление PR.
