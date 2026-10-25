# 05 — Звук: синтез SFX и музыки через Web Audio API

Исследовательская спецификация звука для браузерного клона (TypeScript + Vite, planck.js, Canvas 2D). Все звуки и музыка **синтезируются кодом**, аудиофайлов нет. Звуки, мелодия темы и голоса Rovio не используются: всё своё, но в узнаваемом стиле (мультяшные вокализации птиц, хрюканье свиней, «деревянные», «стеклянные» и «каменные» удары, балканская полька).

Эталонная реализация лежит в `docs/research/05-audio-lab/`: 9 файлов TypeScript, около 2.5 тыс. строк, проверены `tsc` в strict-режиме проекта. Все числа в таблицах ниже взяты из этого кода. Уровни **откалиброваны офлайн-рендером** (`render.ts` + `node-web-audio-api@2.2.0`); пики и RMS приведены в §13. Модуль `src/audio/` можно переносить из лаборатории почти без правок. Как запустить замеры, написано в `05-audio-lab/README-run.txt`.

Пометки: **[факт]** — подтверждено источником или замером, **[рекомендация]** — моё решение там, где точных данных об оригинале нет.

---

## 0. Главное (решения, которые надо принять как есть)

1. **Один `AudioContext`**, `latencyHint: 'interactive'`, частоту дискретизации не задаём. Создаём при старте приложения: до первого жеста он находится в состоянии `suspended`. Разблокировка — `resume()` плюс проигрывание одного сэмпла тишины внутри обработчика `pointerdown/pointerup/touchend/keydown/click`.
2. **Граф:** голоса → шины `sfx` (0.8) / `ui` (0.7) / `music` (0.64) / `ambience` (0.35) → `master` (0.9) → `DynamicsCompressor` (−16 дБ, knee 12, ratio 4, attack 4 мс, release 180 мс) → выход. На шину `send` (реверб: IR 1.1 с, генерируется кодом) идут только взрывы (0.25) и разрушения (0.12).
3. **Большинство SFX запекаются** через `OfflineAudioContext` в `AudioBuffer` (140 буферов, 98 ключей, 32 кГц, хвосты обрезаются по −54 дБ). Замер в Node: запекание занимает 0.7–0.85 с (звуки приоритета 0 готовы через 0.45–0.55 с), память 8.8 МБ. Шторм из 30 ударов на каждый кадр стоит **8 % ядра** на готовых буферах против **29 %** при живом синтезе [факт, замер §12].
4. **Живой синтез** остаётся только для звуков с непрерывным параметром: скрип рогатки (power), фитиль Bomb (длительность), свист Hal (длина дуги), награды на экране победы, эмбиент, музыка.
5. **Против «шума из 30 ударов»:** за кадр звучат не больше 4 самых сильных ударов, не больше 2 на ключ «материал:ярус». Действует «ведро токенов»: ёмкость 6, пополнение 40/с. Кулдаун одного ключа 30 мс, лимит категории `impact` 8 голосов, общий лимит 32 голоса (20 на мобильных). Лишняя «энергия» кадра (сумма интенсивностей больше 1.5) превращается в один слой «обломков».
6. **Громкость удара** считается как в 03-physics: `I = clamp((J − 0.5)/15, 0, 1)`, `vol = 0.2 + 0.8·I`. Ярус по `I` (`<0.3 / <0.7 / ≥0.7`) выбирает тембр. Расстояние до камеры: внутри экрана громкость 1, за краем `g = (1 − over)²`. Панорама `±0.5·dx/(viewW/2)`.
7. **Голоса персонажей** — формантный синтез: пила/треугольник/квадрат → 2–3 параллельных `bandpass` (форманты гласных) → «рык» (АМ квадратом 25–45 Гц) → ADSR. Восемь птиц различаются по F0 (95–1300 Гц), спектральному центроиду (274–1229 Гц) и длине (250–690 мс) [факт, замер].
8. **Материалы — модальный синтез.** Дерево: моды свободного бруса 1 : 2.756 : 5.404 : 8.933 от f0 200–260 Гц, τ 18–70 мс. Лёд: негармоничные моды 1 : 1.58 : 2.31 : 3.17 : 4.12 от 1500–1900 Гц, τ 60–220 мс плюс 20 осколков-«звоночков». Камень: тёмный шум (lowpass 900 Гц) и синус 150→90 Гц.
9. **Музыка меню** — оригинальная полька «Пернатый переполох»: ре гармонический минор, такт 2/4, 144 BPM, 2 такта вступления и цикл из 32 тактов (26.7 с), форма A A′ B B′. Аранжировка: аккордеон (3 пилы с расстройкой 0/±9 центов и общим вибрато), туба (умпа на 1-ю и 2-ю доли), аккордовые «па» на слабые восьмые, бочка/малый/хэт, в B — бубен. **В уровне музыки нет** — только эмбиент темы [рекомендация].
10. **Планировщик музыки** — схема «A Tale of Two Clocks»: `setTimeout` каждые 25 мс, события ставятся на 120 мс вперёд по `ctx.currentTime`. Если вкладка «проспала», не догоняем пропущенное, а пересинхронизируемся [факт: web.dev].
11. **Ловушки Web Audio, на которые уже наступили** (§5.5): две подряд `setTargetAtTime` с долгим удержанием дают выброс или NaN в части реализаций, поэтому в ADSR ставим якорь `setValueAtTime(v(off))`. У `lowpass/highpass` параметр Q задаётся в **децибелах** (−3 = фильтр Баттерворта). `exponentialRamp` к 0 запрещён.
12. **Экран победы:** три «динь» C6 → E6 → G6. Колокольчик из 6 частичных (1, 2, 3, 4.16, 5.43, 6.79), τ основного тона 700 мс. Третья звезда добавляет октаву C7 и искры. Тик счётчика — треугольник 1800→3000 Гц по прогрессу, τ 6 мс, не чаще чем раз в 45 мс.

---

## 1. Что известно об оригинале и юридические рамки

| Пункт | Статус |
|---|---|
| Музыку и тему серии написал финский композитор и звукорежиссёр Ari Pulkkinen; главная работа — «Angry Birds Theme» | [факт] Wikipedia |
| Тему описывают как задорный марш с восточноевропейским колоритом | [факт] NPR, 2011 |
| Голоса птиц и свиней — короткие вокализации без слов (крики при запуске, хрюканье, смех свиней после промаха) | [факт] геймплей серии; конкретные записи — собственность Rovio |
| Удары и разрушения звучат по-разному для разных материалов (дерево, лёд/стекло, камень), на экране победы звёзды сопровождаются звоном | [факт] геймплей |
| Тему, звуки и логотип **не используем и не имитируем нота-в-ноту** | ограничение проекта |
| Наша мелодия написана с нуля; балканский «акцент» дают общие для жанра средства: гармонический минор (увеличенная секунда B♭–C♯), умпа-аккомпанемент, аккордеон | [рекомендация] |

Перед релизом человек должен сравнить на слух нашу польку (§9) с оригинальной темой и убедиться, что общих мелодических фраз нет [рекомендация]. Ритм и гармония польки — общее достояние жанра, мелодия должна быть своей.

---

## 2. Архитектура

### 2.1. Граф узлов

```
                          ┌──────────────┐
 голос (VoiceManager) ──► │ voice.input  │─► [StereoPanner] ─┬─► sfx (0.8) ──┐
   рецепт/буфер           │ gain=vol·cat │                   │               │
                          └──────────────┘                   └─► ui (0.7) ───┤
                                │ (send: взрыв 0.25, разрушение 0.12)        │
                                └─► send ─► Convolver(IR 1.1 с) ─► 0.5 ──────┤
 Sequencer ─► seqGain ─► music (0.64) ─┐                                     │
 эмбиент   ─────────────► amb (0.35) ──┴─► duck (1 ↔ 0.5) ───────────────────┤
                                                                             ▼
                              master (0.9) ─► DynamicsCompressor ─► destination
```

- `duck` — общий узел для музыки и эмбиента: при взрыве уровень падает до 0.5 (−6 дБ, атака τ 30 мс), через 150 мс возвращается к 1 (τ 250 мс).
- Компрессор (threshold −16 дБ, knee 12, ratio 4, attack 0.004, release 0.18) склеивает микс и не даёт клиппинга при цепочке TNT. Отдельный лимитер не нужен: сумма пиков в худшем случае из §13 около +3 дБ до компрессора, после него ≤ 0 dBFS [рекомендация].

### 2.2. Раскладка `src/audio/`

| Файл | Из лаборатории | Содержимое |
|---|---|---|
| `AudioEngine.ts` | `engine.ts` | контракт движка, граф, разблокировка, `handle()`, музыка, эмбиент |
| `synth.ts` | `synth.ts` | примитивы синтеза (§5) |
| `noise.ts` | `noise.ts` | шумы, IR, tanh (§4) |
| `sfx.ts` | `sfx.ts` | рецепты (§8) |
| `music.ts` | `music.ts` | инструменты, ноты, джинглы, `Sequencer` (§9) |
| `mix.ts`, `tables.ts` | то же | лимиты, кулдауны, пространство (§6) |
| `bake.ts` | `bake.ts` | запекание (§4.3) |

Зависимости: `audio → core` (только типы `GameEvent`, `BirdType`, `PigType`, `Material`). Порядок кадра (как в спецификации): `session.step()×N → drainEvents() → for (e) audio.handle(e, {camX, viewW})`. Движок складывает события и обрабатывает их одной пачкой в `queueMicrotask` — так появляется единая точка «один кадр».

### 2.3. Публичный API (контракт + расширения)

```ts
class AudioEngine {
  unlock(): void;                                  // вызывать из обработчика жеста (движок сам вешает слушатели)
  setSfx(on: boolean): void;                       // мягко: setTargetAtTime(…, τ 30 мс)
  setMusic(on: boolean): void;                     // off = остановить секвенсор (не только заглушить)
  playMusic(id: 'menu' | 'level' | null, theme?: ThemeId): void;   // theme — расширение [рекомендация]
  handle(e: GameEvent, view?: { camX: number; viewW: number }): void;
  ui(name: 'click'|'back'|'toggleOn'|'toggleOff'|'popIn'|'locked'|'whoosh'|'hover'): void;
  reward(kind: 'star0'|'star1'|'star2'|'starEmpty'|'scoreDone'|'newBest'): void; // расширение для экрана победы
  scoreTick(progress: number): void;               // расширение: тик счётчика 0..1
  setPaused(on: boolean): void;                    // расширение: пауза (эмбиент ×0.5, стоп фитиля)
}
```

Предложения к контракту событий [рекомендация, необязательные]: `impact.size` (размер блока, сейчас f0 удара случайный), `pigsLaugh.pigs: PigType[]` (сейчас голоса выбираются случайно из small/medium/large).

---

## 3. Жизненный цикл `AudioContext`

| Ситуация | Поведение | Код/параметры |
|---|---|---|
| Старт приложения | `new AudioContext({latencyHint:'interactive'})` → `suspended` (политика автозапуска Chrome и Safari) [факт] | фолбэк `webkitAudioContext` |
| Первый жест | `resume()` + `BufferSource` с 1 сэмплом тишины → `start()` **синхронно внутри обработчика** (старый iOS требует именно этого) | слушатели `pointerdown, pointerup, touchend, keydown, click`, `{capture:true, passive:true}`; снимаются, когда `state === 'running'` |
| После разблокировки | запустить `bakeAll()` (жест не нужен, но рендер лучше начать, когда UI уже отрисован); если ждала музыка — `playMusic(wantMusic)` | §4.3 |
| Вкладка скрыта | `ctx.suspend()` — музыка встаёт ровно на месте, таймеры не нужны | `visibilitychange` |
| Вкладка видна | `ctx.resume()`, если контекст был разблокирован | — |
| iOS: звонок/Siri | `state` становится `'interrupted'` (или `'suspended'`) → снова вешаем слушатели жеста | `ctx.onstatechange` |
| Беззвучный режим iPhone | Web Audio в Safari по умолчанию работает как «ambient» и **подчиняется переключателю беззвучного режима** [факт: WebKit bugs]. `navigator.audioSession.type = 'playback'` (Safari 16.4+) обходит это, но прерывает чужую музыку | **не меняем** [рекомендация]: игры принято глушить переключателем |
| Пауза игры | `setPaused(true)`: разовые SFX доигрывают, фитиль — `release`, эмбиент ×0.5 через `amb.gain` | расширение API |
| Выход в меню | `playMusic('menu')`: эмбиент гаснет за 0.6 с, полька стартует через 50 мс | — |

**Код разблокировки** (из `engine.ts`):

```ts
private readonly onGesture = (): void => this.unlock();
private armUnlock(): void {
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'])
    window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
}
unlock(): void {
  const c = this.ctx;
  if (c.state !== 'running') void c.resume();
  if (!this.unlocked) {
    const s = c.createBufferSource();            // старый iOS: «проиграть» тишину внутри жеста
    s.buffer = c.createBuffer(1, 1, c.sampleRate);
    s.connect(c.destination);
    s.start();
    this.unlocked = true;
    void bakeAll(OfflineAudioContext, 32000).then((m) => (this.baked = m));
    if (this.wantMusic) this.playMusic(this.wantMusic, this.theme);
  }
  if (c.state === 'running')
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'])
      window.removeEventListener(ev, this.onGesture, { capture: true });
}
```

Титульный экран должен иметь крупную кнопку «Играть»: первый тап по ней одновременно разблокирует звук и запускает польку. Задержки выхода (ориентировочно): Android 20–40 мс, iOS около 10 мс, Bluetooth-наушники 150–250 мс. Их не компенсируем [рекомендация].

---

## 4. Предгенерация: шумы, IR, запекание

### 4.1. Шумовые буферы (генерируются один раз, 2 с, mono)

| Буфер | Алгоритм | Спектр | Где используется |
|---|---|---|---|
| `white` | `mulberry32(seed)·2 − 1` | ровный | щелчки, треск, стекло, свисты, фитиль, хэт |
| `pink` | фильтр Пола Келлета (7 полюсов), ×0.11 | −3 дБ/окт | whoosh, «пуф», перья, ветер луга, земля |
| `brown` | `y = (y + 0.02·w)/1.02`, ×3.5 | −6 дБ/окт | рокот взрыва и обрушения, прибой |

Петля без щелчка: генерируем `n + fade` сэмплов и сворачиваем хвост в начало (`fade` = 20 мс). Каждый запуск берёт **случайное смещение** в буфере (`start(t, rand·(dur−0.6))`), поэтому два одинаковых звука не звучат одинаково. Время генерации 3 × 96 000 сэмплов < 5 мс.

```ts
function loopable(n: number, fade: number, gen: () => number): Float32Array {
  const raw = new Float32Array(n + fade);
  for (let i = 0; i < raw.length; i++) raw[i] = gen();
  const out = raw.subarray(0, n);
  for (let i = 0; i < fade; i++) { const k = i / fade; out[i] = raw[i] * k + raw[n + i] * (1 - k); }
  return out;                                        // out[n-1] → out[0] непрерывно
}
// pink (Paul Kellet):
b0 = 0.99886*b0 + x*0.0555179; b1 = 0.99332*b1 + x*0.0750759; b2 = 0.969*b2 + x*0.153852;
b3 = 0.8665*b3 + x*0.3104856;  b4 = 0.55*b4 + x*0.5329522;    b5 = -0.7616*b5 - x*0.016898;
y = (b0+b1+b2+b3+b4+b5+b6 + x*0.5362) * 0.11;  b6 = x*0.115926;
```

### 4.2. Импульсный отклик реверба и насыщение

- **IR «двор»**: стерео, 1.1 с, пред-задержка 12 мс, огибающая `exp(−t/0.25)`, шум через однополюсный lowpass с коэффициентом `k = 0.12 + 0.85·exp(−t/0.3)` (хвост темнеет со временем). `ConvolverNode.normalize = true` (по умолчанию). Возврат реверба на master: 0.5.
- **tanh-кривая** для `WaveShaperNode`: `y = tanh(3x)/tanh(3)`, 1024 точки. Через неё проходит саб взрыва (синус 70→32 Гц). Без насыщения динамик телефона (ниже ~150 Гц ничего не воспроизводит) не услышит «бум»: tanh добавляет 3-ю и 5-ю гармоники.

### 4.3. Запекание (`bake.ts`)

`OfflineAudioContext(1, sr·dur, 32000)` → тот же рецепт, что и вживую → `startRendering()` → обрезка хвоста ниже −54 дБ от пика + фейд 5 мс → потолок пика −1 dBFS. Потолок нужен потому, что случайный отрезок шума даёт разброс пиков между вариантами до ±2 дБ: замер 4 прогонов показал, что взрыв TNT доходил до +0.2 dBFS, пока gain не снизили с 0.48 до 0.38. Шумовой банк создаётся один раз и используется во всех офлайн-контекстах: `AudioBuffer` не привязан к контексту.

| Группа | Ключи | Варианты | Приоритет |
|---|---|---|---|
| Удары материалов | `woodHit/iceHit/stoneHit : 0,1,2` (ярусы `I` = 0.15/0.5/0.9) | 3 | 0 |
| Земля, свинья-поверхность | `ground:0,1` (I 0.3/0.9), `pigBump` | 2 | 0 |
| Трещины | `woodCrack/iceCrack/stoneCrack : 1,2,3` | 2 | 0 |
| Разрушение | `woodBreak`, `iceShatter`, `stoneBreak` | 3 | 0 |
| Обломки | `rubble` | 2 | 1 |
| Взрывы | `boom:tnt` (0), `boom:bomb`, `boom:egg` (1) | 2 | 0/1 |
| Птицы | `launch/select/hurt : <bird>` | 1 | red — 0, остальные — 1 |
| Свиньи | `pigGrunt/pigHurt/pigLaugh/pigPop : <pig>`, `pigPopQuiet`, `helmet` | 1–2 | 0/1 |
| Рогатка и прочее | `slingGrab`, `slingRelease:lo/hi`, `slingCancel`, `hop`, `feather`, `puff`, `ab:chuck/blues/matilda/silver/bombSwell` | 1–2 | 0/1 |
| UI | `ui:click…hover` (8) | 1 | 2 |

**Не запекаются:** звёзды, бонус-динь, `scoreDone`, `newBest` (колокольные хвосты по 3–6 с: держать их в памяти дорого, а шторма на экране победы не бывает), а также всё живое из п.4 §0.

**Замер** (Node 22, `node-web-audio-api` 2.2.0, один поток) [факт]:

| Частота | Буферов | Время запекания | Приоритет 0 готов | Память |
|---|---|---|---|---|
| 32 кГц | 140 | 704–845 мс | 448–553 мс | 8.77–8.81 МБ |
| 48 кГц | 140 | 1020 мс | 622 мс | 13.12 МБ |

Берём **32 кГц**: полосы до 16 кГц для SFX достаточно, при воспроизведении `AudioBufferSourceNode` сам ресэмплирует до частоты контекста. Рендер идёт на аудиопотоке, главный поток занят только созданием узлов (единицы мс на звук). Если запекание ещё не закончилось, `baked1()` молчит — первые ~0.6 с после разблокировки игрок находится в меню.

---

## 5. Примитивы синтеза (`synth.ts`)

Соглашения: время в **секундах `ctx.currentTime`**, длительности в параметрах — **в мс**. Каждая функция возвращает время конца звука (уровень ниже −60 дБ). VoiceManager освобождает голос **по этому времени**, а не по `onended`: в офлайн-контексте `onended` приходит только после рендера.

### 5.1. Огибающие

```ts
/** Ударная: 0 → peak за aMs, затем экспонента τ = tauMs. Конец = −60 дБ (6.9τ). */
export function perc(p: AudioParam, t: number, peak: number, aMs: number, tauMs: number): number {
  const a = aMs / 1000, tau = tauMs / 1000;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(0, t + a, tau);
  return t + a + 6.9 * tau;
}

/** ADSR (a,d,r — мс; s — доля). Перед release — «якорь» на аналитическом значении спада. */
export function adsr(p: AudioParam, t: number, peak: number, e: Env, holdS: number): number {
  const a = e.a / 1000, tauD = e.d / 3000 + 1e-4, sus = peak * e.s;
  const off = t + Math.max(holdS, a);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setTargetAtTime(sus, t + a, tauD);                                       // d ≈ 3τ
  p.setValueAtTime(sus + (peak - sus) * Math.exp(-(off - t - a) / tauD), off); // якорь
  p.setTargetAtTime(0, off, e.r / 4000 + 1e-4);                              // r ≈ 4τ
  return off + (e.r / 1000) * 1.75;
}
```

### 5.2. `playTone` — тон с огибающей, глиссандо, вибрато, АМ, фильтром

```ts
export interface ToneOpts {
  wave: OscillatorType; f: number | Pts; gain: number;   // Pts = [мс, Гц][] — экспоненциальные отрезки
  env?: Env; holdMs?: number; a?: number; tau?: number;  // ADSR или удар
  detune?: number; vib?: Lfo; am?: Lfo; filt?: Filt; detuneMod?: AudioNode;
}
export function playTone(ctx: Ctx, out: AudioNode, t: number, o: ToneOpts, pitch = 1): number {
  const osc = track(ctx.createOscillator());
  osc.type = o.wave;
  if (typeof o.f === 'number') osc.frequency.setValueAtTime(o.f * pitch, t);
  else curve(osc.frequency, t, o.f, pitch);
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);
  const lfos: OscillatorNode[] = [];
  if (o.vib) lfos.push(lfoTo(ctx, t, o.vib, osc.detune, o.vib.depth));   // вибрато в центах
  if (o.detuneMod) o.detuneMod.connect(osc.detune);                      // общий LFO дорожки
  let head: AudioNode = osc;
  if (o.filt) head = head.connect(filter(ctx, t, o.filt));
  if (o.am) head = head.connect(amStage(ctx, t, o.am, lfos));            // gain = 1−d/2 ± d/2
  const vca = ctx.createGain();
  const end = o.env ? adsr(vca.gain, t, o.gain, o.env, (o.holdMs ?? 100) / 1000)
                    : perc(vca.gain, t, o.gain, o.a ?? 2, o.tau ?? 80);
  head.connect(vca).connect(out);
  osc.start(t); osc.stop(end);
  for (const l of lfos) { l.start(t); l.stop(end); }
  osc.onended = () => { vca.disconnect(); if (o.detuneMod) o.detuneMod.disconnect(osc.detune); };
  return end;
}
```

У LFO (`Lfo`) есть поля `rate`, `depth`, `wave`, `delayMs` (вибрато вступает с задержкой), `decayMs` (затухающее «дрожание» резинки) и `untilMs` (рык только в начале слога).

### 5.3. `playNoiseBurst` — шумовой всплеск

```ts
export interface NoiseOpts {
  buf: AudioBuffer; gain: number; a?: number; tau?: number; env?: Env; holdMs?: number;
  filts?: ReadonlyArray<Filt>;   // цепочка фильтров; частота — число или контур Pts
  rate?: number;                 // playbackRate: < 1 — темнее
  am?: Lfo;                      // «рубленый» шум (скрип камня, фитиль)
  fmod?: Lfo;                    // LFO частоты 1-го фильтра в Гц (свист Hal, ветер)
}
export function playNoiseBurst(ctx: Ctx, out: AudioNode, t: number, o: NoiseOpts, fScale = 1): number {
  const src = track(ctx.createBufferSource());
  src.buffer = o.buf; src.loop = true; src.playbackRate.value = o.rate ?? 1;
  const lfos: OscillatorNode[] = [];
  let head: AudioNode = src;
  (o.filts ?? []).forEach((fs, i) => {
    const f = filter(ctx, t, fs, fScale);
    if (i === 0 && o.fmod) lfos.push(lfoTo(ctx, t, o.fmod, f.frequency, o.fmod.depth));
    head = head.connect(f);
  });
  if (o.am) head = head.connect(amStage(ctx, t, o.am, lfos));
  const vca = ctx.createGain();
  const end = o.env ? adsr(vca.gain, t, o.gain, o.env, (o.holdMs ?? 100) / 1000)
                    : perc(vca.gain, t, o.gain, o.a ?? 1, o.tau ?? 40);
  head.connect(vca).connect(out);
  src.start(t, Math.random() * Math.max(0, o.buf.duration - 0.6));   // случайный отрезок шума
  src.stop(end);
  for (const l of lfos) { l.start(t); l.stop(end); }
  src.onended = () => vca.disconnect();
  return end;
}
```

### 5.4. `playModal` и `playVoice`

```ts
/** Банк затухающих синусов: {f Гц, a, tau мс}. Дерево, лёд, камень, металл, колокольчики. */
export function playModal(ctx, out, t, modes: Mode[], gain, ratio = 1, attackMs = 0.5): number {
  const bus = ctx.createGain(); bus.gain.value = gain; bus.connect(out);
  let end = t, last: OscillatorNode | null = null;
  for (const m of modes) {
    const f = m.f * ratio; if (f >= ctx.sampleRate * 0.45 || m.a <= 0) continue;   // не выше 0.45·sr
    const o = track(ctx.createOscillator()); o.frequency.value = f;
    const g = ctx.createGain(); const e = perc(g.gain, t, m.a, attackMs, m.tau);
    o.connect(g).connect(bus); o.start(t); o.stop(e);
    if (e >= end) { end = e; last = o; }
  }
  if (last) last.onended = () => bus.disconnect(); else bus.disconnect();
  return end;
}
```

`playVoice(ctx, out, t, VoiceOpts, pitch)`: источник (`wave`, контур `f0`) идёт параллельно в форманты (`bandpass`, частота — число или контур, частоты умножаются на `√pitch`, чтобы при сдвиге высоты гласная не «уплывала») и в прямой путь «тело» через lowpass 1.2 кГц (уровень `body`, по умолчанию 0.3). Дальше: опциональная субгармоника (синус f0/2), придыхание (белый шум → bandpass на F2, 0.06), «рык» (АМ квадратом) → ADSR → выход. Полная версия — в `synth.ts`.

### 5.5. Ловушки Web Audio (обязательны к соблюдению)

| Проблема | Решение |
|---|---|
| `exponentialRampToValueAtTime(0)` бросает исключение | контуры через `max(1e-4, v)`; к нулю — `setTargetAtTime(0, t, τ)` |
| Две подряд `setTargetAtTime` с долгим удержанием (`hold` 1 с): в `node-web-audio-api` значение улетело в 3.4e38 и NaN, старый Safari тоже ненадёжен [факт, замер] | «якорь» `setValueAtTime(v(off), off)` перед release; `cancelAndHoldAtTime` не использовать — его нет в Firefox |
| У `lowpass/highpass` **Q в дБ** (резонанс), у `bandpass/peaking/notch` — обычная добротность [факт: спецификация Web Audio] | по умолчанию в `filter()`: −3 дБ для LP/HP (Баттерворт), 1 для BP |
| Неконечное значение в `AudioParam` → `TypeError` | все входы рецептов через `clamp01`, расстояния — через `spatial()` |
| Время старта в прошлом (`t < currentTime`) — звук сдвигается или обрезается; отрицательное время → исключение | планировать на `currentTime + 0.01` (SFX) и `+ 0.005` (UI) |
| Щелчок при старте синуса с ненулевой амплитудой | атака ≥ 0.3 мс (`perc` начинается с 0) |
| Утечка узлов | `onended → vca.disconnect()`; панорамы и фильтры собирает GC, когда у них нет входов |
| Украденный голос, который просто заглушили, продолжает тратить CPU до своего конца | рецепт регистрирует источники (`beginCollect/endCollect`), `release()` делает `stop(now+0.04)` |
| `stop()` вызывают дважды | `try { s.stop(t) } catch {}` |
| Несколько `AudioContext` | ровно один на приложение (в Safari и Chrome есть лимиты и предупреждения) |

---

## 6. Микширование

### 6.1. Категории голосов (`mix.ts`, `tables.ts`)

| Категория | Лимит (десктоп / моб.) | gain | prio | Кулдаун по умолч., мс | Что сюда входит |
|---|---|---|---|---|---|
| `impact` | 8 / 5 | 0.9 | 1 | 30 | удары, перья, «пуф», каска, тихий «поп» |
| `break` | 6 / 4 | 1.0 | 1.5 | 40 | трещины, разрушения, обломки |
| `birdVox` | 2 / 2 | 1.0 | 3 | 150 | выбор, запуск, «уф» |
| `pigVox` | 3 / 2 | 0.9 | 2 | 150 | хрюк, «уф», визг, смех |
| `explosion` | 4 / 3 | 1.0 | 5 | 0 | TNT, Bomb, яйцо |
| `sling` | 2 / 2 | 0.9 | 4 | 50 | захват, скрип, выстрел, отмена, «хоп» |
| `ability` | 3 / 2 | 1.0 | 4 | 100 | способности |
| `ui` | 4 / 3 | 1.0 | 10 | 40 | кнопки |
| `reward` | 6 / 4 | 1.0 | 10 | 0 | звёзды, тики, бонус-динь |
| `loop` | 3 / 2 | 1.0 | 100 | 0 | эмбиент, фитиль, его события |
| **Всего** | **32 / 20** | | | | мобильный режим: `matchMedia('(pointer: coarse)')` |

Кулдауны по ключам, мс: `slingStretch` 60, `launch/select` 150, `hurt` 250, `feather` 60, `puff` 80, `*Hit` 30, `ground` 50, `pigBump` 60, `*Crack` 50, `*Break/iceShatter` 35, `rubble` 250, `helmet` 100, `pigHurt` 150 (и ещё 300 мс на одну свинью по `id`), `pigPop` 40, `pigLaugh` 1500, `pigGrunt` 2000, `scoreTick` 45, `ui` 40.

### 6.2. Захват и кража голоса

```ts
acquire(id, cat, score, cooldownMs, dest, gain, pan): Voice | null {
  const now = this.ctx.currentTime;
  const last = this.lastPlay.get(id);
  if (last !== undefined && (now - last) * 1000 < cooldownMs) return null;      // кулдаун id
  this.prune();                                                                  // по v.end
  const inCat = this.active.filter((v) => v.cat === cat);
  if (inCat.length >= this.limits[cat] && !this.stealFrom(inCat, score)) return null;
  if (this.active.length >= this.maxTotal && !this.stealFrom(this.active, score)) return null;
  const input = this.ctx.createGain(); input.gain.value = gain;
  if (pan) { const p = this.ctx.createStereoPanner(); p.pan.value = pan; input.connect(p).connect(dest); }
  else input.connect(dest);
  const v = { id, cat, score, start: now, end: now + 5, input, sources: [], stolen: false };
  this.active.push(v); this.lastPlay.set(id, now);
  return v;
}
private stealFrom(pool: Voice[], score: number): boolean {   // жертва — самый тихий/неважный
  let victim = null;
  for (const v of pool) if (!v.stolen && (!victim || v.score < victim.score)) victim = v;
  if (!victim || victim.score >= score) return false;          // новый не громче — отказ
  victim.stolen = true; this.release(victim);                  // фейд τ 5 мс + stop(now+0.04)
  this.active = this.active.filter((v) => v !== victim);
  return true;
}
```

`score = громкость × prio категории`. Взрыв (prio 5) почти всегда вытеснит удар (prio 1), удар никогда не вытеснит голос птицы.

### 6.3. Удары: пачка кадра → отбор → ведро токенов

```ts
// 1) каждый impact даёт ≤ 2 запроса: поверхность a (×1.0) и b (×0.6)
//    wood/ice/stone → `${m}Hit:${tier}`, ground → `ground:${I<0.6?0:1}`, pig → pigBump (×0.8), tnt → woodHit (×0.8), bird/egg → ничего
// 2) selectImpacts: сортировка по I, ≤ 4 за кадр, ≤ 2 на ключ; остаток суммируется в overflow
export function selectImpacts(reqs, perFrame = 4, perGroup = 2) {
  const sorted = [...reqs].sort((a, b) => b.intensity - a.intensity);
  const perKey = new Map<string, number>(); const play = []; let overflow = 0;
  for (const r of sorted) {
    const n = perKey.get(r.key) ?? 0;
    if (play.length < perFrame && n < perGroup) { play.push(r); perKey.set(r.key, n + 1); }
    else overflow += r.intensity;
  }
  return { play, overflow };
}
// 3) каждый отобранный удар берёт токен: ёмкость 6, пополнение 40/с (≤ 40 ударов/с в среднем)
// 4) if (overflow > 1.5 || blockDestroyed в кадре ≥ 3) → один 'rubble' с gain = min(1, max(overflow, destroyed)/6)
```

Замер: 30 запросов в кадре → играют 4, `overflow` = 11.2 [факт]. 30 запросов × 60 кадров через ведро → проходит 45 из 1800 [факт].

### 6.4. Громкость по силе удара и расстоянию

| Величина | Формула | Пример |
|---|---|---|
| Интенсивность | `I = clamp((J − 0.5)/15, 0, 1)` (J — нормальный импульс, Н·с, событие уже отфильтровано ядром при `vn ≥ 1.5`) | J = 8 → I = 0.5 |
| Громкость | `vol = 0.2 + 0.8·I` (03-physics §3.6) | I = 0.5 → 0.6 (−4.4 дБ) |
| Тембр | ярус `tier = I<0.3 ? 0 : I<0.7 ? 1 : 2` → свой запечённый буфер (верхние моды, длина, саб) | — |
| Громкость разрушения по размеру | `×min(1.2, 0.6 + 0.4·√(w·h))`, высота `rate = clamp(√(w·h)^−0.25, 0.8, 1.2)` | балка 2×0.25 → 0.88, rate 1.09 |
| Расстояние | `over = max(0, abs(x−camX) − viewW/2) / (viewW·reach)`, `g = max(0, 1−over)²`; `reach` = 1 (взрывы — 2, и не тише 0.3) | `viewW` = 20 м: x = 10 → 1, x = 20 → 0.25, x = 30 → 0 [факт] |
| Панорама | `pan = clamp(dx/(viewW/2), −1, 1)·0.5` (взрыв — ×0.6) | край экрана → ±0.5 |
| Отсечка | `gain < 0.02` → звук не создаётся | — |
| Случайность | `playbackRate = rate·2^(±60 центов/1200)`, вариант буфера — случайный из 2–3 | — |

### 6.5. Дакинг и переключатели

- Взрыв → `duck`: `setTargetAtTime(0.5, now, 0.03)`, потом `setTargetAtTime(1, now + 0.15, 0.25)`.
- `setSfx(false)` → шины `sfx/ui` уходят в 0 с τ 30 мс; кроме того, `handle()` перестаёт принимать события (кроме `levelEnd`), поэтому CPU не тратится.
- `setMusic(false)` → секвенсор останавливается (фейд 0.3 с), эмбиент освобождается; при включении снова звучит последняя запрошенная музыка (`wantMusic`).
- Настройки хранятся в `storage.getSettings()` (`{sfx, music}`), их применяют при старте до первого жеста.

---

## 7. Карта событий `GameEvent` → звуки

| Событие (`src/core/events.ts`) | Звук | Категория | Задержка, примечания |
|---|---|---|---|
| `birdLoaded {bird}` | `hop` (прыжок + приземление через 420 мс) → `select:<bird>` | sling / birdVox | реплика через +200 мс |
| `aimStart` | `slingGrab` | sling | — |
| `aimStretch {power}` | **живой** `slingStretch(power)` | sling | кулдаун 60 мс; при ослаблении натяжения — ×0.5 |
| `aimCancel` | `slingCancel` | sling | — |
| `birdLaunched {bird, power}` | `slingRelease:hi` (power > 0.6) или `:lo`, gain `0.6 + 0.4·power` → `launch:<bird>` | sling / birdVox | крик через +40 мс, pan +0.1 |
| `ability {bird}` | chuck/blues/matilda/silver — запечённые; hal — **живой** (дуга 1000 мс); bomb — `bombSwell` + остановка фитиля; red/terence — ничего | ability | пространство по x |
| `impact {impulse, a, b}` | см. §6.3 | impact | пачка кадра |
| `birdImpact {bird}` | `hurt:<bird>` + `feather` (×0.8); для bomb — **живой** фитиль до 3 с | birdVox / impact / loop | фитиль — по `id` |
| `birdRemoved` | `puff`; остановить фитиль | impact | — |
| `blockDamaged {material, stage}` | `<m>Crack:<stage>` | break | stage 1..3 |
| `blockDestroyed {material, w, h}` | `woodBreak` / `iceShatter` / `stoneBreak` (размер → gain/rate) | break | send 0.12; ≥ 3 за кадр → `rubble` |
| `pigDamaged {pig, helmetLost}` | `pigHurt:<pig>` (не чаще раза в 300 мс на свинью); `helmet`, если каска слетела | pigVox / impact | — |
| `pigDestroyed {pig}` | `pigPop:<pig>` с визгом, если `pigVox` < 2, иначе `pigPopQuiet` | pigVox / impact | цепная гибель не превращается в хор |
| `tntDestroyed` | `woodBreak` ×0.6, rate 0.85 (ящик) | break | сам взрыв придёт событием `explosion` |
| `explosion {source}` | `boom:<tnt/bomb/egg>`, send 0.25, `reach` 2 | explosion | дакинг музыки |
| `score` | — | — | только визуал |
| `stateChanged → bonus` | сброс счётчика бонуса | — | — |
| `birdBonus` | живой `bonusDing(i)` = колокольчик A5 + i полутонов + `hop` ×0.7 | reward / sling | i растёт с каждой птицей |
| `pigsLaugh` | 1–3 голоса `pigLaugh:medium/small/large`, сдвиг 90–180 мс, pan −0.3/0/+0.3, rate 0.96–1.04 | pigVox | — |
| `levelEnd {won}` | эмбиент гаснет за 0.5 с → джингл победы (gain 0.6) или поражения (0.8) через +100 мс | music | UI затем вызывает `reward('star0'…)` |
| простой (своё событие, необязательно) | `pigGrunt:<pig>` случайной свиньи на экране раз в 7–14 с в состояниях ready/aiming | pigVox | [рекомендация], кулдаун 2000 мс |

---

## 8. Рецепты SFX

Нотация слоёв: **T** — `playTone`, **N** — `playNoiseBurst`, **M** — `playModal`, **V** — `playVoice`. `a/τ` — атака и постоянная затухания (мс), `f a→b/мс` — экспоненциальный свип, BP/LP/HP — фильтры (Q у LP/HP в дБ, у BP — обычная добротность). Уровни внутри рецептов откалиброваны: пик при максимальных параметрах около −3…−8 dBFS (§13).

### 8.1. Рогатка

| Звук | Слои | Длина |
|---|---|---|
| **Захват** `slingGrab` | N white BP 900 Q3, a2 τ15, 0.83 · T sine 2000, a0.3 τ3, 0.41 (щелчок) · T saw 120 → BP 700 Q5, a5 τ25, 0.58 (кожа) | 140 мс |
| **Скрип натяжения** `slingStretch(p)` | T saw `f = 140 + 420p` Гц, свип ×1.08 за 90 мс → BP `3f → 3.3f` Q5 → АМ квадрат 47 Гц глубина 0.35 (stick-slip); ADSR 8/40/0.6/30, hold 70; gain `0.55 + 0.45p` | 120 мс |
| **Выстрел** `slingRelease(p)` | «твань»: T triangle `f0 = 95 + 70p`, свип 1.6f0 → f0 за 40 мс, a1 τ90, 0.6, затухающее вибрато 22 Гц ±60 ц (decay 200 мс) · обертон T sine 3.2f0 → 2.02f0, τ60, 0.2 · шлепок кармашка N white BP 1800 Q1, τ4, 0.6 · whoosh N pink BP 600→1800 (120 мс) → 500 (350 мс) Q1.5, ADSR 30/120/0.4/150, hold 120, gain `0.25 + 0.6p` | 510 мс |
| **Отмена** `slingCancel` | T triangle 130→85/40, τ70, 0.24, вибрато 20 Гц ±50 ц (decay 150) · N pink LP 600, τ20, 0.3 | 400 мс |
| **Прыжок на рогатку** `birdHop` | T sine 300→620/80, a3 τ30, 0.41 · через 420 мс N pink LP 900, τ12, 0.5 (кармашек) | 480 мс |

### 8.2. Голоса птиц

Форманты «мультяшных» гласных (≈ ×1.25 к взрослым) [рекомендация]:

| Гласная | i | e | a | o | u | m (носовая) |
|---|---|---|---|---|---|---|
| F1 / F2, Гц | 350 / 2600 | 550 / 2100 | 900 / 1450 | 600 / 1000 | 380 / 950 | 300 / 1100 |

Обычно F1 идёт с Q 6, F2 — с Q 8. Огибающие: `EV` = 12/100/0.8/80, `EVS` = 6/50/0.7/50. Ко всем голосам добавляется придыхание 0.06. Высота каждого запуска случайно сдвигается на ±60 центов (≈ ±3.5 %, `playbackRate` буфера; форманты сдвигаются вместе с высотой, на слух это незаметно).

**Крик при запуске** (`launch:<bird>`):

| Птица | Волна | F0 контур [мс, Гц] | Гласные / форманты | Модуляция | Прочее | gain | Длина*, мс | Центроид, Гц |
|---|---|---|---|---|---|---|---|---|
| Red «Йа-а-а!» | saw | 0:500 → 70:760 → 300:720 → 450:600 | i→a за 70 мс, F3 2800 Q10 ×0.6 | вибрато 6 Гц ±30 ц с 120 мс; рык 30 Гц 0.15 | hold 380 | 0.53 | 485 | 983 |
| Blues «Уи-и!» | triangle | 0:900 → 120:1300 → 250:1250 | u→i за 100 мс, g 3/3, body 0.5 | вибрато 9 Гц ±40 ц с 80 мс | hold 200, EVS | 0.47 | 252 | 988 |
| Chuck «Йи-ха!» | saw | слог 1: 0:600 → 140:900; слог 2 с +170 мс: 0:820 → 180:700 | «йи» i; «ха» a + аспирация 0.35 | слог 2: вибрато 7 Гц ±25 ц | hold 120 / 160 | 0.46 / 0.5 | 403 | 1059 |
| Bomb «Хо-о!» | saw | 0:160 → 150:225 → 400:200 | o, g 2.6/2, body 0.5 | рык 25 Гц 0.4 | sub 0.3, аспирация 0.3 | 0.40 | 470 | 537 |
| Matilda «Ва-а!» | triangle | 0:520 → 120:700 → 350:640 | u→a за 60 мс, g 3/3 | вибрато 7 Гц ±35 ц с 100 мс | hold 300 | 0.27 | 392 | 631 |
| Hal «Кра-а!» | square | 0:480 → 90:560 → 350:440 | a + F3 2400 Q8 ×0.8 | рык 45 Гц 0.6 первые 80 мс («кр») | аспирация 0.25 | 0.65 | 409 | 1229 |
| Terence «Р-р-р-ах!» | saw | 0:95 → 350:110 → 600:120 | F1 420→450→750, F2 800→1150 (с 420 мс «ах») | рык 28 Гц 0.7 до 350 мс | sub 0.5, body 0.6, ADSR 20/120/0.85/100 | 0.37 | 687 | 274 |
| Silver «Уи-и-и!» | triangle | 0:700 → 150:1100 → 400:1000 | u→i за 120 мс | вибрато 7 Гц ±30 ц с 120 мс | hold 350 | 1.4 | 467 | 1061 |

\* длина выше −50 дБ, замер [факт]. Голоса разнесены по трём осям: высота (Terence 95 Гц ↔ Blues 1300 Гц), тембр (центроид 274 ↔ 1229 Гц: пила/квадрат ярче треугольника), ритм (один слог / два слога у Chuck / рык в начале у Hal и Terence).

**Реплика при выборе** (`select:<bird>`, пик −8 dBFS): Red «хм!» saw 420→380/120, гласная m, 100 мс · Blues «пи-пи» 2× triangle 1100→1250/55, интервал 95 мс · Chuck «эй!» saw 650→750/100, e→i · Bomb «гр-р» saw 150→140/200, o, рык 25 Гц 0.6 · Matilda «кудах» 2× triangle 700→760 и 900→820 (55 мс, интервал 85 мс), a · Hal «кра!» square 500→470/120 + рык 45 Гц 50 мс · Terence «гр-р-р» saw 90→85/380, рык 28 Гц 0.7, sub 0.5 · Silver «хи!» triangle 800→950/100, i.

**«Уф» при ударе** (`hurt:<bird>`): волна птицы, F0 = 0.8·F0_base → ×0.62 за 110 мс, гласные o→u за 80 мс, hold 100. Базовые F0: red 420, blues 900, chuck 600, bomb 160, matilda 520, hal 480, terence 95, silver 700. Калибровочный gain: red 0.37, blues 0.4, chuck 0.36, bomb 0.36, matilda 0.58, hal 0.3, terence 0.32, silver 0.19 (пик −8 dBFS).

**Перья** `feather`: N pink LP 1200, a3 τ30, 1.2 + N white BP 2500 Q1, τ10, 0.3 (185 мс). **Исчезновение** `puff`: N pink LP 1000→400/250, a10 τ60, 0.9 + T sine 500→250/30, τ12, 0.35 (330 мс).

### 8.3. Способности

| Способность | Слои | Длина |
|---|---|---|
| **Chuck — рывок** | N white BP 400→3000/300 Q1.5, a25 τ140, 1.1 · V triangle 900→1400/220 «и-и» (i, g 3/3), 0.7, с +20 мс · N white HP 5000, a5 τ60, 0.28 (свист скорости) | 840 мс |
| **Blues — разделение** | N white HP 2000, τ8, 0.5 («пфт») · 3 чирика V triangle `900k → 1150k` за 80 мс, k = 1 / 1.12 / 0.9, со сдвигом 0/40/80 мс, pan −0.25/0/+0.25, 0.5 · T sine 2600→3400/30, τ20, 0.15 (искра) | 215 мс |
| **Bomb — фитиль** (живой; от первого удара до взрыва, ≤ 3 с) | N white HP 4000, ADSR 20/50/1/30, hold = длительность, 0.18, АМ квадрат 14 Гц 0.6 · искры: каждые 60–140 мс N white HP 6000, τ1.5, 0.2–0.45 | до взрыва |
| **Bomb — «надувание»** (тап) | T triangle 220→440/150, ADSR 10/60/0.8/30, hold 130, 0.45. Если взрыв в том же кадре, он перекрывает этот звук | 180 мс |
| **Bomb — взрыв** | `boom:bomb` (§8.6) | 1.8 с |
| **Matilda — яйцо** | T sine 900→300/50, τ25, 0.64 («плоп») · «кудах» 2× V triangle 700 и 900 (×0.9 за 55 мс, a, 0.2), +60/+140 мс · взлёт N pink BP 600→1800/350 Q1.5, a40 τ120, 0.5, с +40 мс | 525 мс |
| **Яйцо — взрыв** | `boom:egg`: 3 щелчка скорлупы (N white BP 3000 Q2, τ2, 0.3) за 25 мс, тело взрыва через 30 мс | 1.85 с |
| **Hal — бумеранг** (живой) | N white BP 1200 Q4, центр качается ±400 Гц с частотой 12 Гц (взмахи), ADSR 80/200/0.7/250, hold = дуга (1000 мс), 1.15 · реплика «кра!» ×1.05 | дуга + 0.4 с |
| **Silver — петля и пике** | V triangle 700→1200/570 «уи» (u→i за 400 мс), 1.25 · с +570 мс T sine 2000→800/500, ADSR 30/100/0.8/100, hold 450, вибрато 18 Гц ±25 ц, 0.45 | 1.16 с |
| Red, Terence | способности нет — звука нет | — |

### 8.4. Материалы

**Дерево.** Моды свободного бруса (теория Эйлера–Бернулли): `BAR = [1, 2.756, 5.404, 8.933]`.

| Звук | Слои | Пик / длина |
|---|---|---|
| `woodHit(I)` | M: `f0 = U(200, 260)·clamp(size^−0.4, 0.7, 1.4)`, моды `f0·BAR·U(0.98, 1.02)`, амплитуды `[1, 0.55(0.4+0.6I), 0.3(0.3+0.7I), 0.15I]`, τ `[70, 45, 28, 18]·(0.7+0.6I)`, gain 0.27 · контакт N white BP `1200 + 1800I` Q1.2, a0.5 τ`6+10I`, 0.25 · при I > 0.6: T sine 130→70/90, τ45, `0.3I` | I = 1: −3.3 dBFS, 450 мс; I = 0.1: −9.9, 306 мс |
| `woodCrack(stage)` | `7 + 2·stage` микрощелчков N white BP U(1500, 3500) Q3, τ2.5, gain U(0.4, 1)·lvl, интервалы `22·0.8^j·U(0.8, 1.2)` мс (ускорение) · скрип T saw 95→80/150 → BP 650 Q4, a10 τ50, `0.3·lvl` · стук M f0 180 (3 моды, τ 40/25/15), `0.3·lvl`; `lvl = 0.62 + 0.19·stage` | −5.5 / 253 мс |
| `woodBreak` | излом N white BP 2400 Q1.2, τ12, 0.5 · M f0 170 (амплитуды 1/0.6/0.35/0.2, τ 105/68/42/27), 0.28 · T sine 110→60/120, τ50, 0.28 · «рвущийся» скрип T saw 140→90/200 → BP 800 Q3, τ70, 0.17 · 10 щепок в `0.26·u^1.8` с: N white BP U(2000, 6000) Q2.5, τ U(3, 8), U(0.11, 0.28) | −2.4 / 509 мс |

**Лёд / стекло.** Негармоничные моды `ICE = [1, 1.58, 2.31, 3.17, 4.12]` [рекомендация].

| Звук | Слои | Пик / длина |
|---|---|---|
| `iceHit(I)` | M: `f0 = U(1500, 1900)`, амплитуды `[1, .6, .45, .3, .2]` (верхние ×(0.4+0.6I)), τ `[220, 170, 120, 85, 60]·(0.5+0.5I)`, 0.26 · щелчок N white HP 3000, τ3, 0.34 | I = 1: −4.4 / 1117 мс; I = 0.1: −7.5 / 653 мс |
| `iceCrack(stage)` | «дзинь-ц» T sine 4200→2600/40, τ25, `0.35·lvl` · N white HP 5000, τ8, `0.5·lvl` · 2 звоночка M U(3000, 6000) τ40 на +30/+55 мс, `0.2·lvl`; `lvl = 0.38 + 0.083·stage` | −8.1 / 266 мс |
| `iceShatter` (звон стекла) | удар N white HP 2500, a1 τ60, 0.44 · «сияние» N white BP 6000 Q1, a5 τ200, 0.17 · «тук» T sine 320→180/60, τ25, 0.22 · `14 + 6·min(2, size)` осколков в `0.65·u²` с (гуще в начале): M {f, τ U(30, 90)} + {1.47f, τ U(20, 50)}, f = U(2500, 7000), gain `U(.045, .14)·(1 − 0.6u)`, pan U(−0.4, 0.4); реверб-send 0.12 | −2.6 / 902 мс, центроид 8.8 кГц |

**Камень и земля.**

| Звук | Слои | Пик / длина |
|---|---|---|
| `stoneHit(I)` | N pink LP 900, a1 τ35, 0.7 · T sine 150→90/80, τ45, 0.35 · песок N white BP 2500 Q1.5, τ6, `0.15I` · M {430, a .4, τ25}, {1130, a .25, τ15} (±5 %), 0.35 · при I > 0.6: саб T sine 70→45/150, τ70, `0.3I` | I = 1: −3.0 / 355 мс, центроид 128 Гц |
| `stoneCrack(stage)` | «кррш» N white BP 700 Q2, АМ квадрат 38 Гц 0.8, a10 τ60, `3.0·lvl` · 4 щелчка N white BP 3000 Q2, τ2 в 0–120 мс, `0.9·lvl`; `lvl = 0.6 + 0.13·stage` | −7.6 / 380 мс |
| `stoneBreak` | T sine `95·min(1.3, size^−0.3)` → 45/200, a2 τ90, 0.66 · осыпь N white LP 1600→300/500, a4 τ180, 0.37 · рокот N brown LP 160, a20 τ300, 0.5 · 22 камешка в `0.75·u^1.7` с: N white BP U(900, 2600) Q4, τ U(4, 12), U(0.12, 0.37) | −3.0 / 1302 мс |
| `groundThud(I)` | N pink LP 350, a1 τ50, 1.04 · T sine 90→55/100, τ55, 0.52 · N white BP 1200 Q0.8, τ10, `0.15I` | −4.8 / 331 мс |
| `pigBump` (свинья как поверхность) | T sine 200→130/70, τ35, 0.37 · T triangle 400→260/70, τ20, 0.12 | −8.0 / 206 мс |
| `rubble(E)` | N brown LP 400, a30 τ200, 0.93 · `12 + min(18, 3E)` зёрен в `0.6·u^1.5` с: 50 % «дерево» BP U(1500, 4000) Q2.5, 50 % «камень» BP U(600, 1800) Q4; τ U(4, 14), U(0.28, 0.75) | −5.9 / 1175 мс |

### 8.5. Свиньи

F0 и масштаб формант по типу: small 210 / ×1.15, medium 180 / ×1.0, large 150 / ×0.9, helmet 165 / ×0.95, mustache 135 / ×0.85, king 105 / ×0.8.

| Звук | Рецепт | Пик / длина |
|---|---|---|
| **Хрюк** `pigGrunt` | V saw `0.78·F0` → ×0.78 за 250 мс, форманты 500/1000 ×fs (Q5/6, g 2.4/1.8), body 0.5, рык 32 Гц 0.6, hold 240, EVS, 0.5 · 4 «снорта» N white BP `700·fs` Q2, a3 τ8, 0.29, через 0/60/120/180 мс | −5 / 305 мс |
| **Ушиб** `pigHurt` | V saw `1.2·F0 → 0.65·F0` за 150 мс, форманты 400/900 ×fs, hold 140, 0.35 | −5.9 / 214 мс |
| **Гибель** `pigPop` | «поп» T sine 420→110/45, τ25, 0.58 · «пуф» N pink LP 1400→500/200, a8 τ70, 0.75 · визг (если свободен голос) V saw `600k → 900k → 400k` за 90/250 мс, k = √(F0/180), i→e за 150 мс, 0.33 | −3.8 / 350 мс |
| **Каска** `helmetClang` | M {1820, 1, τ220}, {2730, .6, τ160}, {4150, .35, τ90}, {5900, .2, τ50}, 0.27 + щелчок N white HP 3000, τ4, 0.31 · 3 отскока (+120/+210/+265 мс, ×0.45/0.25/0.12, τ ×0.5, высота +2/+4/+6 %) | −4.9 / 1114 мс |
| **Смех** `pigLaugh` | 3 слога «хе»: аспирация N white BP 1500 Q1, τ8, 0.25, затем через 20 мс V saw F0 → 0.9·F0 за 110 мс, форманты 650/1150 ×fs, body 0.4, hold 100, 0.46; шаг слогов 180 мс (у короля ×1.3); у короля 3-й слог — «ХА!» 1.15·F0, hold 280, вибрато 6 Гц ±30 ц | −4.9 / 560 мс (король 845) |

### 8.6. Взрывы

Общая схема, все слои идут в шину взрыва `bus` (gain `g`):

| Слой | Рецепт |
|---|---|
| треск (транзиент) | N white HP 1000, a0.5 τ15, 0.8 |
| тело | N white LP `lp0 → lp1` за 900 мс (Q 0 дБ), a2 τ`body`, 0.9 |
| саб | T sine `sub0 → sub1` за 350 мс, a2 τ`subTau`, 1.0 → **WaveShaper tanh(3x)** → 0.8 |
| рокот | N brown LP 120, a30 τ500, 0.6 |
| обломки | `debris` зёрен в `0.15 + 0.95·u^1.5` с: N white BP U(800, 3000) Q2, τ U(5, 14), U(0.1, 0.3), pan U(−0.3, 0.3) |
| реверб | send 0.25 |

| Источник | g | lp0 → lp1, Гц | body τ, мс | sub0 → sub1, Гц | subTau, мс | debris | Пик / длина |
|---|---|---|---|---|---|---|---|
| TNT | 0.38 | 3500 → 180 | 280 | 70 → 32 | 140 | 18 | −3.6 / 1959 мс |
| Bomb | 0.42 | 3000 → 160 | 240 | 65 → 30 | 130 | 14 | −3.0 / 1757 мс |
| Яйцо Matilda | 0.34 | 4500 → 250 | 180 | 95 → 45 | 100 | 10 (+ 3 щелчка скорлупы) | −3.8 / 1768 мс |

Связка с визуалом: звук стартует в том же кадре, что вспышка и тряска камеры. Атака всех слоёв ≤ 2 мс, основная энергия саба приходится на первые 150 мс — столько же длится пик тряски.

### 8.7. Награды (живой синтез, шина `ui`)

Колокольчик `bell(midi, gain, tauScale)`: частичные `[1, 2, 3, 4.16, 5.43, 6.79]`, амплитуды `[1, .45, .25, .16, .1, .06]`, τ `[700, 420, 300, 180, 110, 70]·tauScale`, атака 1.5 мс + «стеклянный» щелчок T sine 4f, τ8, 0.15·gain.

| Звук | Рецепт | Пик |
|---|---|---|
| Звезда 1 / 2 / 3 | `bell` C6 (84) / E6 (88) / G6 (91), gain 0.26 / 0.30 / 0.34 · «тук» приземления T sine 170→90/80, τ30, 0.25. У 3-й ещё `bell` C7 (96) 0.15 и 6 искр M U(3000, 6000) τ40, 0.07 в 30–330 мс | −5.4 (1-я), −2.8 (3-я) |
| Пустая звезда | T triangle 300→240/60, τ25, 0.4 | −8.6 |
| Тик счётчика | T triangle `1800 + 1200·progress` Гц, a0.5 τ6, 0.35; не чаще раза в 45 мс (≈22/с) | −9.1 |
| Счёт закончен | `bell` C7, 0.29, tauScale 0.8 + N white HP 7000, a2 τ120, 0.15 | −6.4 |
| Бонус за птицу | `bell` A5 + i (81 + i), 0.33, tauScale 0.6; i = 0, 1, 2… | −5.9 |
| Новый рекорд | G-мажор (67, 71, 74), gain 0.1, tauScale 0.4 → через 140 мс C-мажор (72, 76, 79, 84), gain 0.1, tauScale 1.2 | −3.9 |

Тайминги на экране победы [рекомендация, согласовать с 07-ui-ux]: звёзды «прилетают» в 0.5 / 0.95 / 1.4 с после появления панели, `reward('starN')` звучит в момент касания звездой слота. Счётчик очков начинает тикать после последней звезды, длится 1.2 с; по окончании — `scoreDone`, при новом рекорде ещё и `newBest`.

### 8.8. UI (запечённые, шина `ui`, пик около −8 dBFS)

| Имя | Рецепт |
|---|---|
| `click` | T sine 620→320/40, a0.5 τ18, 0.35 + T triangle 1300, τ4, 0.13 |
| `back` | T sine 420→240/50, τ22, 0.4 |
| `toggleOn` / `toggleOff` | T triangle 660 потом 990 (через 60 мс) / наоборот, τ40, 0.34 |
| `popIn` (окно появилось) | N white BP 800→2400/180 Q1.2, a40 τ50, 0.25 + через 60 мс T sine 220→440/150, τ80, вибрато 9 Гц ±40 ц, 0.37 |
| `locked` | 2× T square 140/130 Гц → LP 600, τ30, 0.38, интервал 110 мс |
| `whoosh` (переход экрана) | N pink BP 400→1600 (200 мс) → 600 (350 мс) Q1, ADSR 80/100/0.5/120, hold 150, 1.55 |
| `hover` (только десктоп) | T sine 2000, τ3, 0.08 (−22 dBFS) |

### 8.9. Эмбиент уровня (`playMusic('level', theme)`, шина `ambience` 0.35)

| Тема | «Постель» (живой голос, hold 3600 с, атака/затухание 1.5 с) | События |
|---|---|---|
| `meadow` | N pink LP 500, АМ синус 0.07 Гц глубина 0.5, 0.58 | трель раз в U(3, 8) с: 3–5 чириков T sine 3200↔4200/60, τ20, 0.15, шаг 100 мс, pan U(−0.6, 0.6) |
| `beach` | N brown LP 700 ± 450 Гц (LFO 0.14 Гц), АМ 0.14 Гц 0.8 (накат волны ≈ 7 с), 0.4 | чайка раз в U(10, 20) с: 2× T saw 1400→900/250 → BP 1800 Q3, ADSR 20/80/0.6/80, hold 230, интервал 370 мс |
| `snow` | N white BP 550 Q8 ± 250 Гц (0.11 Гц) с АМ 0.09 Гц 0.6, gain 1.5 + N white BP 900 Q12 ± 300 Гц (0.17 Гц), 1.0 — завывание ветра | — |

Пик эмбиента ≈ −10 dBFS до шины, то есть около −20 dBFS на выходе (×0.35 шины, ×0.9 master): он заметно тише SFX. В событиях используется `Math.random` — это допустимо, детерминизм нужен только ядру.

---

## 9. Музыка

### 9.1. Решения

| Экран | Музыка | Почему |
|---|---|---|
| Титул, эпизоды, уровни | полька «Пернатый переполох», цикл | задорно, «балканский» характер жанра, как у темы серии, но мелодия своя |
| Облёт камеры и игра | **без музыки**, только эмбиент темы [рекомендация] | звук разрушений — главная награда, музыка его маскирует; в Classic-играх серии в уровне звучит в основном окружение |
| Победа | джингл 1.6 с + хвост (~2.9 с) | короткое «та-да» в ре мажоре |
| Поражение | джингл 2.4 с, затем смех свиней (`pigsLaugh`) | — |
| Пауза | эмбиент ×0.5 | — |

### 9.2. Теория и форма польки

- **Тональность:** ре гармонический минор (D E F G A B♭ C♯). Увеличенная секунда **B♭–C♯** в доминантовых тактах (A7) даёт «восточноевропейский» колорит. Раздел B уходит в параллельный фа мажор (F, C7) и возвращается через Gm–Dm–A7.
- **Размер 2/4, темп 144 BPM:** четверть = 0.4167 с, 16-я (шаг секвенсора) = 0.1042 с, такт = 8 шагов = 0.833 с.
- **Форма:** `Intro(2) | A(8) A′(8, в конце брейк) | B(8) B′(8, конец разворачивается на A7)`. Петля — 32 такта, 26.67 с, после неё возврат к такту A1 (вступление больше не звучит).
- **Гармония:** A = `Dm Dm A7 Dm | Gm Dm A7 Dm`; A′ — то же, такты 7–8 = `A7 Dm` (другая мелодия); B = `F C7 F Dm | Gm Dm A7 Dm`; B′ — такты 7–8 = `A7 A7`.

### 9.3. Мелодия (нота/длительность в 16-х; `>` — акцент vel 1.1 с «подъездом» −60 центов за 25 мс, если длительность ≥ 2)

| Такт | Аккорд | Ноты | MIDI-массив `[midi, 16-х, vel?]` |
|---|---|---|---|
| A1 | Dm | A4/2 D5/1 E5/1 **F5/2>** E5/2 | `[69,2],[74,1],[76,1],[77,2,1.1],[76,2]` |
| A2 | Dm | D5/2 A4/2 F4/2 A4/2 | `[74,2],[69,2],[65,2],[69,2]` |
| A3 | A7 | B♭4/1 C♯5/1 **E5/2>** G5/2 E5/1 C♯5/1 | `[70,1],[73,1],[76,2,1.1],[79,2],[76,1],[73,1]` |
| A4 | Dm | **D5/4>** пауза/2 A4/2 | `[74,4,1.1],[0,2],[69,2]` |
| A5 | Gm | B♭4/2 D5/1 G5/1 **G5/2>** F5/2 | `[70,2],[74,1],[79,1],[79,2,1.1],[77,2]` |
| A6 | Dm | F5/1 E5/1 D5/1 E5/1 F5/2 **A5/2>** | `[77,1],[76,1],[74,1],[76,1],[77,2],[81,2,1.1]` |
| A7 | A7 | G5/2 F5/1 E5/1 C♯5/2 E5/2 | `[79,2],[77,1],[76,1],[73,2],[76,2]` |
| A8 | Dm | D5/2 A4/2 **D5/4>** | `[74,2],[69,2],[74,4,1.1]` |
| A′7 | A7 | E5/1 F5/1 E5/1 D5/1 C♯5/2 A4/2 | `[76,1],[77,1],[76,1],[74,1],[73,2],[69,2]` |
| A′8 | Dm | **D5/4>** пауза/4 (брейк ударных) | `[74,4,1.1],[0,4]` |
| B1 | F | C5/1 C5/1 **F5/2>** C5/1 C5/1 **A5/2>** | `[72,1],[72,1],[77,2,1.1],[72,1],[72,1],[81,2,1.1]` |
| B2 | C7 | G5/2 E5/2 C5/2 B♭4/2 | `[79,2],[76,2],[72,2],[70,2]` |
| B3 | F | A4/1 C5/1 F5/1 A5/1 **G5/2>** F5/2 | `[69,1],[72,1],[77,1],[81,1],[79,2,1.1],[77,2]` |
| B4 | Dm | **D5/4>** F5/2 D5/2 | `[74,4,1.1],[77,2],[74,2]` |
| B5 | Gm | D5/1 D5/1 **G5/2>** D5/1 D5/1 **B♭5/2>** | `[74,1],[74,1],[79,2,1.1],[74,1],[74,1],[82,2,1.1]` |
| B6 | Dm | A5/2 F5/2 D5/2 F5/2 | `[81,2],[77,2],[74,2],[77,2]` |
| B7 | A7 | E5 F5 G5 A5 G5 F5 E5 C♯5 (все /1) | `[76,1],[77,1],[79,1],[81,1],[79,1],[77,1],[76,1],[73,1]` |
| B8 | Dm | **D5/4>** пауза/4 | `[74,4,1.1],[0,4]` |
| B′7 | A7 | E5/1 F5/1 G5/1 A5/1 **B♭5/2>** A5/2 | `[76,1],[77,1],[79,1],[81,1],[82,2,1.1],[81,2]` |
| B′8 | A7 | G5/2 E5/2 C♯5/2 A4/2 (брейк) | `[79,2],[76,2],[73,2],[69,2]` |

`compileBars()` бросает исключение, если сумма длительностей в такте ≠ 8. Этот инвариант нужно покрыть юнит-тестом.

### 9.4. Аккомпанемент по шагам такта (0…7)

| Дорожка | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| Бас-туба (8-я) | **корень** | | | | **квинта** (vel 0.9) | | | |
| «Па» (стаб аккорда) | | | ● | | | | ● (vel 0.9) | |
| Бочка | ● | | | | ● (0.85) | | | |
| Малый (`polka`) | | | ● (0.6) | | | | ● (0.6) | |
| Малый (`fill`) | | | | | 0.5 | 0.65 | 0.8 | 0.95 |
| Хэт | 0.5 | 0.5 | **1.0** | 0.5 | 0.5 | 0.5 | **1.0** | 0.5 |
| Бубен (только B) | | ● | | ● | | ● | | ● |

| Аккорд | Бас [доля 1, доля 2] | «Па» (4-я октава) |
|---|---|---|
| Dm | D3 (50), A2 (45) | D4 F4 A4 (62 65 69) |
| Gm | G2 (43), D3 (50) | D4 G4 B♭4 (62 67 70) |
| A7 | A2 (45), E3 (52) | C♯4 E4 G4 (61 64 67) |
| F | F2 (41), C3 (48) | C4 F4 A4 (60 65 69) |
| C7 | C3 (48), G2 (43) | C4 E4 B♭4 (60 64 70) |
| D (джингл) | D3, A2 | D4 F♯4 A4 (62 66 69) |

Вступление: такт 1 (Dm) — только аккомпанемент, такт 2 (A7) — аккомпанемент и брейк малого. Брейк звучит также в A′8 и B′8.

### 9.5. Инструменты

| Инструмент | Синтез | Огибающая / длина | gain |
|---|---|---|---|
| **Аккордеон** (мелодия) | 3× saw с расстройкой 0 / +9 / −9 центов (мюзет) → **общая линейка дорожки**: HP 180 (Q −3 дБ) → peaking 1100 Гц +5 дБ Q1 (носовой тембр язычков) → LP 3200 → тремоло мехов (gain 0.92 ± 0.08, LFO 5.2 Гц); вибрато — один общий LFO 5.5 Гц ±6 ц, подключённый к `detune` каждой ноты; акцент — подъезд ×0.966 → ×1 за 25 мс | ADSR 12/80/0.7/70, hold = 92 % длительности | 0.14·vel на язычок |
| **Туба** (бас) | triangle 0.23 + saw 0.065 → LP 900 (Q 0 дБ) — обертоны, чтобы бас был слышен в динамике телефона; «вдув» −30 центов → 0 за 30 мс | ADSR 6/140/0.5/60, hold = 85 % от 8-й | ×vel |
| **«Па»** (левая рука) | square на каждую ноту аккорда → LP 2000; pan +0.25 | a3 τ45 (≈110 мс) | 0.11·vel на ноту |
| Бочка | T sine 140→48/90, a1 τ70, 0.33 + щелчок N white LP 3000, τ1.5, 0.09 | — | ×vel |
| Малый | N white BP 2000 Q0.9, τ45, 0.18 + T triangle 230→190/30, τ30, 0.15 | — | ×vel |
| Хэт | N white HP 7500, τ12, 0.07 | — | ×vel |
| Бубен | 3 вспышки N white BP 9000 Q2 через 8 мс, τ30, 0.045 | — | ×vel |
| Тарелка (джингл) | N white HP 4000, a1 τ600, 0.12 | — | ×vel |

Экономия: нота аккордеона — это 3 осциллятора и 3 VCA, а фильтры и LFO общие. Без общей линейки было бы 12+ узлов на ноту.

**Баланс** (замер RMS по стемам, 8 тактов A) [факт]: мелодия −18.2 dBFS, бас −20.9, «па» −26.3, ударные −22.0. Полный цикл: пик +0.8, RMS −16.1 dBFS → **шина music = 0.64**, на выходе RMS ≈ −20 dBFS и пик ≈ −3 dBFS. Это на 6–10 дБ тише пиков SFX.

### 9.6. Джинглы

| Джингл | Темп | События (шаг в 16-х: нота/длительность) | Итог |
|---|---|---|---|
| **Победа** | 150 BPM (16-я = 0.1 с) | мелодия (vel 1.1): 0 D5/1, 1 F♯5/1, 2 A5/1, 3 **D6/3**, 6 B5/1, 7 C♯6/1, 8 **D6/8** · бас: 0 D3/2, 4 A2/2, 8 D3/8 (vel 1.1) · «па» D-мажор на 2 и 6, на 8 — D4 F♯4 A4 D5 (vel 1.3) · бочка 0/4/8 · дробь малого 6, 6.5, 7, 7.5 (vel 0.6→0.9) · тарелка на 8 | 1.6 с + хвост, длина 2.9 с; gain 0.6 |
| **Поражение** | 100 BPM (16-я = 0.15 с) | мелодия (vel 0.9): 0 A4/2, 2 F4/2, 4 D4/2, 6 C♯4/3, 9 D4/7 (vel 1.0) · бас: 0 D3/4, 4 A2/5, 9 D2/7 · «па» Dm на 9 (vel 0.8) · без ударных | 2.4 с; gain 0.8; затем `pigsLaugh` |

Джинглы играют через `playEv()` с собственной линейкой аккордеона на шине `music`. При выключенной музыке джинглов нет: звёзды на шине `ui` всё равно прозвучат.

### 9.7. Планировщик (lookahead)

```ts
export const LOOKAHEAD_MS = 25;       // период setTimeout
export const SCHEDULE_AHEAD_S = 0.12; // горизонт планирования (web.dev: 25 мс / 100 мс; берём 120 для мобильных)

export class Sequencer {
  // byStep[i] — события шага i; intro+loop развёрнуты в шаги заранее (compileBars)
  start(at = this.ctx.currentTime + 0.05): void { this.stop(); this.step = 0; this.nextT = at; this.tick(); }
  stop(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private readonly tick = (): void => {
    const now = this.ctx.currentTime;
    if (this.nextT < now - 0.05) this.nextT = now + 0.02;          // вкладку «усыпили» — не догоняем пачкой
    while (this.nextT < now + SCHEDULE_AHEAD_S) {
      for (const e of this.byStep[this.step]!)
        this.play(e, this.nextT + (e.step % 1) * this.stepS, this.stepS); // дробные шаги (дробь 32-ми)
      this.nextT += this.stepS;
      this.step = this.step + 1 >= this.totalSteps ? this.introSteps : this.step + 1; // петля без вступления
    }
    this.timer = setTimeout(this.tick, LOOKAHEAD_MS);
  };
}
```

Проверка на фейковых часах (`performance.now`): интервал бочки 0.4167 с, разброс 0 [факт]. Остановка — фейд `seqGain` (τ = fade/4), через `fade + 200 мс` вызываются `stop()` и `disconnect()`: ноты, запланированные на ближайшие 120 мс, доиграют в уже затухающий gain.

---

## 10. Что в каком состоянии игры звучит (сводка)

| Состояние | Музыка/фон | SFX |
|---|---|---|
| loading | эмбиент | `hop` + реплика выбора |
| ready / aiming | эмбиент; хрюк свиньи раз в 7–14 с [рекомендация] | захват, скрип |
| flying | эмбиент | выстрел, крик, способность, удары, разрушения |
| settling | эмбиент | хвосты; `pigsLaugh`, если выстрел никого не убил |
| bonus | эмбиент | бонус-динь с повышением на полутон |
| won / lost | джингл → тишина | звёзды, счётчик, рекорд (UI) |

---

## 11. Размер узлов на звук (для оценки нагрузки)

| Звук | Узлов при живом синтезе | Запечённый |
|---|---|---|
| Голос птицы (2 форманты + body + breath + рык + вибрато) | ≈ 18 | 3 (src + gain + panner) |
| `woodHit` (4 моды + шум + саб) | ≈ 14 | 3 |
| `iceShatter` (3 слоя + 20 осколков × 2 моды) | ≈ 130 | 3 (+1 send) |
| `boom:tnt` (5 слоёв + 18 зёрен) | ≈ 90 | 3 (+1 send) |
| Нота аккордеона | 6 (3 osc + 3 VCA) | — |

---

## 12. Бюджет производительности (замеры)

Живой `AudioContext` без устройства вывода (`sinkId: {type:'none'}`), Node 22 + `node-web-audio-api`, 8 с. Измерялась загрузка процесса целиком [факт]:

| Сценарий | CPU одного ядра | Сыграно / запрошено |
|---|---|---|
| Пусто | 2.7 % | — |
| Полька меню | 13.6 % | — |
| Шторм 30 ударов/кадр, **без лимитов** (живой синтез) | **110 %** (перегруз, звук рвётся) | 1320 / 1320 |
| Шторм, лимиты §6, живой синтез | 29 % | 191 / 14 490 |
| Шторм, лимиты §6, **запечённые буферы** | **8.2 %** | 181 / 14 490 |

Выводы:
1. Без лимитов игра на телефоне захлебнётся на первой же рухнувшей башне.
2. Запекание даёт выигрыш в 3.5 раза при том же звучании.
3. Музыка (около 11 % чистыми) и шторм вместе на десктопе укладываются в ~20 %. Для мобильных лимит голосов снижен до 20 [рекомендация].

---

## 13. Таблица уровней (офлайн-рендер, 48 кГц, до шин)

| Звук | Пик dBFS | RMS dBFS | Длина >−50 дБ, мс | Центроид, Гц |
|---|---|---|---|---|
| `slingStretch` p=0 / p=1 | −16.4 / −9.9 | −27.3 / −21.9 | 118 / 120 | 421 / 1676 |
| `slingRelease` p=0.3 / p=1 | −2.5 / −3.2 | −16.3 / −16.3 | 505 / 515 | 182 / 265 |
| Крики при запуске (8 птиц) | −3.9…−4.3 | −11.6…−21.2 | 252…687 | 274…1229 |
| Реплики выбора / «уф» | −7.8…−8.4 | −12.9…−22.4 | 159…488 | 323…1274 |
| `woodHit` I=0.1 / I=1 | −9.9 / −3.3 | −21.9 / −18.5 | 306 / 448 | 271 / 301 |
| `iceHit` I=0.1 / I=1 | −7.5 / −4.4 | −21.5 / −19.9 | 653 / 1117 | 1954 / 2296 |
| `stoneHit` I=0.1 / I=1 | −5.9 / −3.0 | −19.4 / −17.3 | 250 / 355 | 183 / 128 |
| `woodBreak` / `iceShatter` / `stoneBreak` | −2.4 / −2.6 / −3.0 | −18.1 / −20.1 / −16.1 | 509 / 902 / 1302 | 309 / 8837 / 103 |
| `boom:tnt` / `bomb` / `egg` | −3.6 / −3.0 / −3.8 | −16.3 / −15.7 / −16.9 | 1959 / 1757 / 1768 | 495 / 313 / 366 |
| `pigGrunt` / `pigLaugh` / `pigPop` | −4.7…−5.5 / −3.8…−5.3 / −3.8 | ≈ −18.7 | 305 / 560 / 350 | 355…751 |
| Звезда 1 / 3 | −5.4 / −2.8 | −20.8 / −17.8 | 3531 / 3758 | 1186 / 1930 |
| UI (`click`…`whoosh`) | −8.0…−9.1 | −17.5…−24.0 | 111…531 | 168…973 |
| Эмбиент meadow / beach / snow | −10.3 / −10.3 / −9.7 | −23.2 / −26.5 / −24.4 | — | 193 / 226 / 910 |
| Полька (цикл) / победа / поражение | +0.8 / +2.8 / −0.7 | −16.1 / −14.7 / −18.4 | 28 401 / 2932 / 2396 | 626 / 1060 / 504 |

Пики шумовых звуков от запуска к запуску гуляют на ±1–2 дБ: каждый раз берётся случайный отрезок шума. Музыка и джинглы громче 0 dBFS до шины — это нормально: шина music 0.64 и gain джинглов 0.6/0.8 опускают их до −3…−6 dBFS. Итоговая цепочка для SFX: `рецепт (≈−4) × vol(I) × cat.gain × sfx 0.8 × master 0.9` → компрессор.

---

## 14. Тестирование

| Что | Как | Где |
|---|---|---|
| Ноты польки | для каждого такта сумма 16-х = 8 (`compileBars` бросает исключение); число тактов 34; петля = 26.67 с | Vitest, Node |
| `selectImpacts` | 30 запросов → ровно 4 сыграно, ≤ 2 на ключ, `overflow` = сумма остальных | Vitest |
| `TokenBucket` | 30 запросов × 60 кадров (1 с) → ≤ 6 + 40 | Vitest |
| `VoiceManager` | фейковый `ctx` с `currentTime` и заглушками `createGain/createStereoPanner`: кулдаун, лимит категории, кража по score, `prune` по `end` | Vitest |
| `spatial` | x = camX → 1; край → 1; `+viewW` → 0.25; `+1.5·viewW` → 0 | Vitest |
| Рецепты не дают NaN/клиппинга | офлайн-рендер всех ключей `BAKE_LIST` в `node-web-audio-api`: пик ∈ (−40, 0) dBFS, нет неконечных сэмплов | скрипт `render.ts` (devDependency не добавлять в прод-сборку) |
| На слух | dev-страница `dev/audio.html` [рекомендация]: кнопка на каждый ключ, ползунки power/I/stage, переключатель «живой ↔ запечённый», «шторм 30/кадр», полька с выбором тактов | вручную, Chrome + Safari iOS |
| Мобильные | iPhone: первый тап по «Играть» включает звук; переключатель беззвучного режима глушит игру; после звонка звук возвращается тапом. Android: нет треска при шторме | вручную |

---

## 15. Порядок реализации (чек-лист)

1. `noise.ts`, `synth.ts` — скопировать из лаборатории, добавить юнит-тесты на чистые функции (`midiHz`, `dbGain`).
2. `AudioEngine`: граф шин, компрессор, разблокировка, `visibilitychange`, `onstatechange`; `setSfx/setMusic` с сохранением настроек.
3. `mix.ts` + `tables.ts` + тесты §14.
4. `sfx.ts` + `bake.ts`: запекание после разблокировки, сначала приоритет 0.
5. `handle()` по таблице §7. Связать с `drainEvents()` в цикле `GameScreen`, передавать `{camX, viewW}` камеры.
6. `music.ts`: полька в меню, джинглы на `levelEnd`, эмбиент по теме уровня.
7. `reward()/scoreTick()` — вызовы из UI экрана победы (07-ui-ux).
8. Dev-страница звуков, проверка на iOS Safari и Android Chrome, прослушивание польки на «непохожесть» (§1).

---

## Источники

- [Ari Pulkkinen — Wikipedia](https://en.wikipedia.org/wiki/Ari_Pulkkinen): композитор и звукорежиссёр серии, автор «Angry Birds Theme».
- [The Angry Birds Theme Gets An Orchestral Makeover — NPR/WUSF, 2011](https://www.wusf.org/2011-12-21/the-angry-birds-theme-gets-an-orchestral-makeover): тема — марш с восточноевропейским колоритом.
- [Sound Byte: Meet the Composer — Ari Pulkkinen (GameSpot)](https://gamespot.com/articles/sound-byte-meet-the-composer-ari-pulkkinen/1100-6348941/), [Ari Pulkkinen Interview (VGMonline)](https://vgmonline.net/?p=788).
- [A tale of two clocks — web.dev (Chris Wilson)](https://web.dev/articles/audio-scheduling): lookahead-планирование по `AudioContext.currentTime`, `setTimeout` 25 мс, горизонт 100 мс (константы приведены по вторичному конспекту [jmm.io/webaudio](https://jmm.io/webaudio)); [WAAClock](https://github.com/sebpiq/WAAClock).
- [AudioSession.type — MDN](https://developer.mozilla.org/docs/Web/API/AudioSession/type); WebKit: [bug 237322](https://auto-bugs.webkit.org/show_bug.cgi?id=237322), [bug 261554](https://bugs.webkit.org/show_bug.cgi?id=261554), [bug 264473](https://bugs.webkit.org/show_bug.cgi?id=264473) — Web Audio в iOS «ambient», подчиняется переключателю беззвучного режима; `playback` меняет поведение; прерывания и фоновая приостановка.
- Модальный синтез ударов: K. van den Doel et al., [Physically-based sound effects for interactive simulation](https://persianney.com/kvdoelcsubc/publications/modalpaper.pdf) (моды = частота, затухание, амплитуда); [Sound Synthesis for Impact Sounds in Video Games — Microsoft Research](https://www.microsoft.com/en-us/research/?p=186041); [Zheng & James, Rigid-Body Fracture Sound](https://research.cs.cornell.edu/FractureSound/files/fractureSound.pdf) (звук разрушения стекла как суперпозиция мод).
- Балканский колорит: лады Hijaz (фригийский доминантовый) с увеличенной секундой; полька как «accordion melody, brass oom-pah» — [tunee.ai: Balkan](https://tunee.ai/music-generator/balkan), [Eastern European](https://www.tunee.ai/music-generator/eastern-european) (вторичный источник, использован только для жанровых ориентиров).
- Спецификация Web Audio API (W3C): Q у lowpass/highpass в дБ, `setTargetAtTime`, `OfflineAudioContext`, правила жизни узлов.
- Собственные замеры: `docs/research/05-audio-lab/render.ts` (уровни, длины, центроиды), живые CPU-замеры и замеры запекания (§4.3, §12) — `node-web-audio-api@2.2.0`, Node 22.22.
