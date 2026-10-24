05-audio-lab — эталонная реализация звука к docs/research/05-audio.md

Файлы (TypeScript, проверены tsc со strict-настройками проекта; импорт с расширением .ts):
  noise.ts   — шумы white/pink/brown (бесшовная петля), IR реверба, кривая tanh
  synth.ts   — примитивы: perc, adsr, curve, filter, playTone, playNoiseBurst, playModal, playVoice, panned, сбор источников
  sfx.ts     — все рецепты SFX (рогатка, голоса, способности, материалы, свиньи, взрывы, награды, UI, эмбиент)
  music.ts   — инструменты, полька меню (данные), джинглы, Sequencer (lookahead 25 мс / 120 мс)
  mix.ts     — VoiceManager (лимиты, кулдауны, кража), TokenBucket, selectImpacts, spatial
  tables.ts  — громкость/приоритет/кулдаун по категориям и ключам
  bake.ts    — список запекания и bakeAll() через OfflineAudioContext
  engine.ts  — AudioEngine: граф шин, unlock, handle(GameEvent), музыка, эмбиент (браузер)
  render.ts  — офлайн-рендер всех звуков в Node + замеры (пик, RMS, длина, центроид)

Запуск замеров (Node >= 22.18 — запускает .ts напрямую):
  mkdir -p /tmp/nwaa && cd /tmp/nwaa && npm i node-web-audio-api@2.2.0
  NWAA=/tmp/nwaa/x.js OUT=/tmp/nwaa/wav node /home/user/angry-Birds-/docs/research/05-audio-lab/render.ts
  (ONLY=regex — рендерить только совпадающие имена; OUT — куда писать WAV для прослушивания)
