// AudioEngine — весь звук игры синтезом Web Audio, без аудиофайлов (docs/research/05-audio.md).
//
// ── ТОЧНЫЙ ПУБЛИЧНЫЙ API (контракт спецификации §3 + расширения 00-summary §2.1, 05-audio §2.3) ──
//
//   export class AudioEngine {
//     constructor(opts?: { sfx?: boolean; music?: boolean; volume?: number; autoUnlock?: boolean });
//     /** Создать/возобновить AudioContext. Звать СИНХРОННО из обработчика жеста; без жеста — тихий no-op. */
//     unlock(): Promise<void>;
//     setSfx(on: boolean): void;                 // шины sfx/ui → 0 за τ 30 мс, звучащие голоса гаснут
//     setMusic(on: boolean): void;               // off — секвенсор останавливается (фейд 0.3 с), джинглов нет
//     setMasterVolume(v: number): void;          // 0..1
//     playMusic(track: 'menu' | 'level' | null, theme?: ThemeId): void;
//         // 'menu' — полька «Пернатый переполох»; 'level' — фон темы (музыки в уровне нет); null — тишина.
//         // Смена трека (или темы уровня) = новая сессия звука: фитили гаснут, память карты событий сбрасывается.
//     setPaused(p: boolean): void;               // музыка/фон ×0.5, фитили гаснут, разовые звуки доигрывают
//     handle(e: GameEvent, listener?: { camX: number; viewW: number }): void;   // события кадра — пачкой
//     ui(name: 'click' | 'back' | 'pop' | 'swoosh' | 'star1' | 'star2' | 'star3' | 'tick' | 'win' | 'lose' | 'newRecord'
//          | 'hover' | 'toggleOn' | 'toggleOff' | 'locked' | 'popIn' | 'whoosh' | 'starEmpty' | 'scoreDone',  // расширения
//        arg?: number): void;                    // arg — прогресс 0..1 для 'tick' (без него — по времени прокрутки)
//     readonly ready: boolean;                   // контекст создан и запущен
//     // ── расширения ──
//     reward(kind: 'star0' | 'star1' | 'star2' | 'starEmpty' | 'scoreDone' | 'newBest'): void;
//     scoreTick(progress: number): void;         // тик счётчика 1800 → 3000 Гц, не чаще раза в 45 мс
//     resetSession(): void;                      // новая игровая сессия (рестарт/выход): фитили гаснут, память с нуля
//     play(key: string, opts?: PlayOpts): boolean;  // любой ключ каталога (предпросмотр)
//     stats(): AudioStats;
//     readonly context: AudioContext | null;
//     dispose(): void;                           // навсегда: контекст закрыт, жесты больше ничего не создают
//   }
//
// Конец уровня: событие levelEnd (или ui('win'|'lose') во время фона уровня) гасит фон уровня и играет джингл;
// заказанная музыка становится null. Новая сессия (рестарт с экрана итогов) распознаётся по stateChanged,
// чей from не совпадает с последним состоянием, — фон уровня той же темы возвращается сам. Явный playMusic()
// после levelEnd отменяет это возвращение. Рестарт посреди уровня тоже распознаётся (фитили гаснут);
// приложение может и само позвать resetSession().
//
// Без жеста пользователя контекст не создаётся: тишина и ни одного сообщения в консоли. Тяжёлые массивы
// (шумы, отклик реверба) считаются заранее в простое главного потока; в жесте — только контекст, resume и граф.
// Граф: голоса → sfx/ui → (send → реверб) → master → компрессор → мягкий клиппер → выход;
// музыка/фон/джинглы → duck → master. Задержка графа — 6 мс (упреждение компрессора).
// События кадра копятся и разбираются одной пачкой (microtask): отбор ударов, лимит голосов (32, моб. 20),
// кулдауны одинаковых звуков (удары 30 мс, остальное 35–2000 мс), громкость по силе удара и удалённости от камеры.
// Большинство SFX запекаются в буферы после разблокировки; до готовности звучит живой синтез того же рецепта.

import type { GameEvent, SessionState } from '../core/events';
import type { ThemeId } from '../core/types';
import { BAKE_LIST, BAKE_NOISE_SEED, BAKE_RATE, bakeAll, type OfflineCtor } from './bake';
import { busOf, onMusicBus, soundDef, trimGain } from './catalog';
import { BUS_LEVEL, createMixGraph, type MixGraph } from './graph';
import { idleRun, type IdleTask } from './idle';
import {
  type Cue, type FrameEvent, type Listener, type PlanState, type PlayCue, type RewardKind, type UiSoundName,
  createPlanState, gruntPig, IdleGrunts, planFrame, REWARD_KEYS, TickProgress, UI_KEYS,
} from './mapping';
import { type Cat, CAT_LIMIT, CAT_MIX, cooldownFor, MAX_VOICES, MAX_VOICES_MOBILE, mobileLimits, type PoolStats, VoicePool, type VoiceSlot } from './mix';
import {
  makeTanhCurve, type NoiseBank, type NoiseData, noiseBankFrom, noiseDataGen, reverbIRFrom, reverbIRGen, runGen,
} from './noise';
import type { S } from './sfx';
import { beginCollect, endCollect } from './synth';
import { startTrack, type TrackHandle, type TrackId } from './tracks';

export type { Listener, RewardKind, UiSoundName } from './mapping';
export type { TrackId } from './tracks';

export interface AudioEngineOptions {
  sfx?: boolean;
  music?: boolean;
  /** Общая громкость 0..1. */
  volume?: number;
  /** Сам разблокироваться по первому жесту на странице (по умолчанию да). */
  autoUnlock?: boolean;
}

export interface PlayOpts {
  gain?: number;
  pan?: number;
  param?: number;
  rate?: number;
  delay?: number;
}

export interface AudioStats {
  state: AudioContextState | 'none';
  voices: number;
  baked: number;
  bakeTotal: number;
  pool: PoolStats;
  music: TrackId | null;
}

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;
const CROSSFADE_S = 0.6;
/** Частота, на которой шумы и отклик реверба считаются до жеста (самая частая у оборудования). */
const PREP_RATE = 48000;
/** Сид шумов живого синтеза. */
const LIVE_NOISE_SEED = 1337;
/** Отпущенный (украденный, остановленный) голос отключается от шины через столько мс: фейд 5 мс + stop() через 40 мс. */
const RELEASE_DISCONNECT_MS = 60;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private g: MixGraph | null = null;
  private nb: NoiseBank | null = null;
  private readonly tanh = makeTanhCurve(3);
  private readonly pool: VoicePool;
  private plan: PlanState = createPlanState();
  private readonly baked = new Map<string, AudioBuffer[]>();
  private bakeStarted = false;
  private pending: FrameEvent[] = [];
  private flushQueued = false;
  private sfxOn: boolean;
  private musicOn: boolean;
  private volume: number;
  private paused = false;
  private wantMusic: TrackId | null = null;
  private wantTheme: ThemeId = 'meadow';
  /** Фон уровня, погашенный концом уровня: вернётся сам при новой сессии (рестарт с экрана итогов). */
  private levelAfterEnd: ThemeId | null = null;
  private track: TrackHandle | null = null;
  private readonly tags = new Map<string, VoiceSlot>();
  private ticks = new TickProgress();
  private readonly grunts = new IdleGrunts();
  private gruntTimer: ReturnType<typeof setInterval> | null = null;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private session: SessionState | null = null;
  private primed = false;
  private started = false;
  private armed = false;
  private suspendedByUs = false;
  private disposed = false;
  /** Подготовка в простое до жеста: шумы живого синтеза, шумы запекания, отклик реверба. */
  private prepNoise: IdleTask<NoiseData> | null = null;
  private prepBakeNoise: IdleTask<NoiseData> | null = null;
  private prepIR: IdleTask<Float32Array[]> | null = null;
  private irRate = 0;

  constructor(opts: AudioEngineOptions = {}) {
    this.sfxOn = opts.sfx ?? true;
    this.musicOn = opts.music ?? true;
    this.volume = clamp01(opts.volume ?? 1);
    const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.pool = new VoicePool(mobile ? MAX_VOICES_MOBILE : MAX_VOICES, mobile ? mobileLimits() : CAT_LIMIT);
    if (typeof window !== 'undefined') this.prepare();
    if (opts.autoUnlock !== false) this.armUnlock();
  }

  /** Звук работает: контекст создан и запущен (после первого жеста). */
  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Живой AudioContext (null до первого unlock, без поддержки Web Audio и после dispose). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  // ───────────────────────── подготовка и разблокировка ─────────────────────────

  /** Посчитать шумы и отклик реверба заранее, по кусочку в простое главного потока. */
  private prepare(): void {
    this.prepNoise = idleRun(noiseDataGen(PREP_RATE, 2, LIVE_NOISE_SEED));
    this.prepIR = idleRun(reverbIRGen(PREP_RATE));
    this.irRate = PREP_RATE;
    this.prepBakeNoise = idleRun(noiseDataGen(BAKE_RATE, 2, BAKE_NOISE_SEED));
  }

  /**
   * Создать/возобновить AudioContext. Вызывать СИНХРОННО из обработчика жеста (pointerdown/click/keydown):
   * всё, что требует жеста (создание, resume, «тишина» для старого iOS), делается до первого await.
   */
  unlock(): Promise<void> {
    const c = this.ensureContext();
    if (!c) return Promise.resolve();
    if (!this.primed) {
      try {
        const s = c.createBufferSource();
        s.buffer = c.createBuffer(1, 1, c.sampleRate);
        s.connect(c.destination);
        s.start();
      } catch {
        /* старый iOS: тишина нужна только для разблокировки */
      }
      this.primed = true;
    }
    this.suspendedByUs = false;
    const resumed = c.state === 'running' ? Promise.resolve() : c.resume().catch(() => undefined);
    // Без жеста resume() может не завершиться никогда — не держим вызывающего дольше 1.5 с.
    const timeout = new Promise<void>((r) => setTimeout(r, 1500));
    return Promise.race([resumed, timeout]).then(() => {
      if (c.state === 'running' && this.ctx === c) this.onRunning();
    });
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed) return null;
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    // Без активации пользователем Chrome создаёт контекст «suspended» и пишет предупреждение в консоль —
    // ждём настоящего жеста (слушатели остаются взведёнными).
    const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive) return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    let c: AudioContext;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    this.ctx = c;
    // Граф без отклика реверба: IR ставится позже, вне обработчика жеста (реверб нужен только взрывам и разрушениям).
    const g = createMixGraph(c, c.destination, {}, { reverbIR: null });
    this.g = g;
    // Шумы обычно готовы заранее; если жест пришёл раньше — досчитываются здесь.
    const noise = this.prepNoise ? this.prepNoise.finish() : runGen(noiseDataGen(PREP_RATE, 2, LIVE_NOISE_SEED));
    this.prepNoise = null;
    this.nb = noiseBankFrom(c, noise);
    if (!this.prepIR || this.irRate !== c.sampleRate) {
      this.prepIR?.cancel();
      this.prepIR = idleRun(reverbIRGen(c.sampleRate));
      this.irRate = c.sampleRate;
    }
    this.prepIR.then((chs) =>
      this.later(() => {
        if (this.g === g) g.setReverbIR(reverbIRFrom(c, chs));
      }, 0),
    );
    this.applyLevels(true);
    c.onstatechange = () => {
      if (this.disposed || this.ctx !== c) return;
      if (c.state === 'running') this.onRunning();
      // iOS: звонок/Siri переводят контекст в 'interrupted' — вернуть можно только жестом.
      else if (c.state !== 'closed' && !this.suspendedByUs && typeof document !== 'undefined' && !document.hidden) this.armUnlock();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    return c;
  }

  private readonly onVisibility = (): void => {
    const c = this.ctx;
    if (!c || this.disposed) return;
    if (document.hidden) {
      if (c.state === 'running') {
        this.suspendedByUs = true;
        void c.suspend();
      }
    } else if (this.suspendedByUs) {
      this.suspendedByUs = false;
      // iOS может не отпустить контекст без жеста — тогда снова ждём касания
      void c
        .resume()
        .catch(() => undefined)
        .then(() => {
          if (c.state !== 'running' && c.state !== 'closed') this.armUnlock();
        });
    }
  };

  private readonly onGesture = (): void => {
    void this.unlock();
  };

  private armUnlock(): void {
    if (this.disposed || this.armed || typeof window === 'undefined') return;
    this.armed = true;
    for (const ev of GESTURES) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
  }

  private disarmUnlock(): void {
    if (!this.armed) return;
    this.armed = false;
    for (const ev of GESTURES) window.removeEventListener(ev, this.onGesture, { capture: true });
  }

  private onRunning(): void {
    if (this.disposed) return;
    this.disarmUnlock();
    if (!this.started) {
      this.started = true;
      // запекание — не в задаче жеста: после того как готовы шумы запекания, отдельной задачей
      this.later(() => this.startBake(), 0);
      this.gruntTimer = setInterval(this.idleTick, 1000);
    }
    if (this.wantMusic && this.musicOn && !this.track) this.startMusic(this.wantMusic, this.wantTheme);
  }

  private startBake(): void {
    if (this.bakeStarted || this.disposed || typeof window === 'undefined') return;
    const Off = (window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext) as OfflineCtor | undefined;
    if (!Off) return;
    this.bakeStarted = true;
    const go = (noise: NoiseData | null): void => {
      if (this.disposed) return;
      bakeAll(Off, BAKE_RATE, BAKE_LIST, (key, bufs) => {
        if (!this.disposed) this.baked.set(key, bufs);
      }, { noise, cancelled: () => this.disposed }).catch((err: unknown) => {
        // Без запекания всё звучит живым синтезом — только дороже по CPU.
        if (!this.disposed) console.warn('[audio] запекание не удалось, работает живой синтез:', err);
      });
    };
    const prep = this.prepBakeNoise;
    this.prepBakeNoise = null;
    if (prep) prep.then((d) => this.later(() => go(d), 0));
    else go(null);
  }

  /** setTimeout, который dispose() отменяет. */
  private later(fn: () => void, ms: number): void {
    const h = setTimeout(() => {
      this.timers.delete(h);
      if (!this.disposed) fn();
    }, ms);
    this.timers.add(h);
  }

  // ───────────────────────── переключатели ─────────────────────────

  setSfx(on: boolean): void {
    this.sfxOn = on;
    this.applyLevels();
    if (!on && this.ctx) {
      this.releaseWhere((onMusic) => !onMusic);
      this.tags.clear();
      this.plan.fuses.clear();
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!on) {
      this.stopMusic(0.3);
      this.releaseWhere((onMusic) => onMusic); // джингл тоже замолкает
    } else if (this.wantMusic && this.ready && !this.track) this.startMusic(this.wantMusic, this.wantTheme);
  }

  /** Остановить голоса пула по признаку «звучит на шине музыки». */
  private releaseWhere(pred: (onMusic: boolean) => boolean): void {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    for (const v of this.pool.voices(now)) if (pred(onMusicBus(v.key))) this.pool.release(v, now);
  }

  /** Остановить голоса с меткой, начинающейся с prefix (фитили). */
  private releaseTagged(prefix: string): void {
    const now = this.ctx?.currentTime ?? 0;
    for (const [tag, slot] of [...this.tags]) {
      if (!tag.startsWith(prefix)) continue;
      this.pool.release(slot, now);
      this.tags.delete(tag);
    }
  }

  setMasterVolume(v: number): void {
    this.volume = clamp01(v);
    this.applyLevels();
  }

  /** Пауза игры: музыка/фон ×0.5, фитили гаснут; разовые звуки доигрывают. */
  setPaused(on: boolean): void {
    this.paused = on;
    this.applyLevels();
    if (on && this.ctx) {
      this.releaseTagged('fuse:');
      this.plan.fuses.clear();
    }
  }

  /**
   * Новая игровая сессия (рестарт, выход в меню, другой уровень): гасит фитили, сбрасывает память
   * карты событий (фитили, «уф» свиней, номер бонуса, типы свиней, ведро ударов) и прогресс тиков.
   * Движок зовёт её сам при смене трека и при stateChanged нового GameSession; звать вручную безопасно.
   */
  resetSession(): void {
    this.releaseTagged('fuse:');
    this.plan = createPlanState();
    this.ticks = new TickProgress();
    this.grunts.reset();
  }

  private applyLevels(immediate = false): void {
    const g = this.g;
    if (!g) return;
    const now = g.ctx.currentTime;
    const set = (p: AudioParam, v: number): void => {
      if (immediate) p.value = v;
      else {
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.setTargetAtTime(v, now, 0.03);
      }
    };
    set(g.master.gain, BUS_LEVEL.master * this.volume);
    set(g.sfx.gain, this.sfxOn ? BUS_LEVEL.sfx : 0);
    set(g.ui.gain, this.sfxOn ? BUS_LEVEL.ui : 0);
    set(g.music.gain, BUS_LEVEL.music * (this.paused ? 0.5 : 1));
    set(g.amb.gain, BUS_LEVEL.amb * (this.paused ? 0.5 : 1));
  }

  // ───────────────────────── музыка ─────────────────────────

  /**
   * Музыка экрана: 'menu' — полька, 'level' — фон темы (без музыки), null — тишина.
   * Смена — кроссфейд 0.6 с. Повторный вызов с тем же треком ничего не перезапускает.
   * Смена трека или темы уровня начинает новую сессию звука (resetSession).
   */
  playMusic(track: 'menu' | 'level' | null, theme?: ThemeId): void {
    const th = theme ?? this.wantTheme;
    const changed = track !== this.wantMusic || (track === 'level' && th !== this.wantTheme);
    this.wantMusic = track;
    this.wantTheme = th;
    this.levelAfterEnd = null; // явный заказ отменяет автоматическое возвращение фона уровня
    if (changed && track !== null) this.resetSession();
    if (track !== 'level') this.grunts.reset();
    const cur = this.track;
    if (cur && track && cur.id === track && (track === 'menu' || cur.theme === th)) return;
    this.stopMusic(CROSSFADE_S);
    if (track && this.musicOn && this.ready) this.startMusic(track, th);
  }

  private startMusic(id: TrackId, theme: ThemeId): void {
    const c = this.ctx;
    const g = this.g;
    const nb = this.nb;
    if (!c || !g || !nb) return;
    this.track = startTrack(c, nb, g.music, g.amb, id, theme, { at: c.currentTime + 0.05, fadeIn: CROSSFADE_S });
  }

  private stopMusic(fadeS: number): void {
    this.track?.stop(fadeS);
    this.track = null;
  }

  /** Конец уровня: фон гаснет, заказ музыки снимается, но запоминается — вернётся при новой сессии. */
  private endLevelMusic(): void {
    if (this.wantMusic === 'level' || this.track?.id === 'level') this.levelAfterEnd = this.wantTheme;
    this.wantMusic = null;
    this.grunts.reset();
    this.stopMusic(0.5);
  }

  /** Музыка и фон −6 дБ на взрыв: атака τ 30 мс, возврат τ 250 мс через 150 мс. */
  private duckMusic(): void {
    const g = this.g;
    if (!g) return;
    const p = g.duck.gain;
    const now = g.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.setTargetAtTime(0.5, now, 0.03);
    p.setTargetAtTime(1, now + 0.15, 0.25);
  }

  // ───────────────────────── события игры ─────────────────────────

  /**
   * Реакция на игровое событие. listener — камера ({camX, viewW} в метрах) для громкости/панорамы по удалённости.
   * Вызывать для каждого события из drainEvents() в том же кадре: события кадра обрабатываются пачкой.
   */
  handle(e: GameEvent, listener?: Listener): void {
    if (this.disposed) return;
    if (e.type === 'stateChanged') {
      const prev = this.session;
      this.session = e.to;
      // from ≠ последнему состоянию — это уже другой GameSession (рестарт, следующий уровень)
      if (prev !== null && e.from !== prev) this.onNewSession();
    }
    if (!this.ready) return;
    if (!this.sfxOn && e.type !== 'levelEnd' && e.type !== 'stateChanged') return;
    this.pending.push({ e, l: listener });
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(this.flush);
    }
  }

  private onNewSession(): void {
    const theme = this.levelAfterEnd;
    this.resetSession();
    if (theme && this.wantMusic === null) this.playMusic('level', theme);
  }

  private readonly flush = (): void => {
    this.flushQueued = false;
    const batch = this.pending;
    this.pending = [];
    const c = this.ctx;
    if (!c || c.state !== 'running' || this.disposed) return;
    const now = c.currentTime;
    const cues = planFrame(batch, this.plan, {
      now,
      rnd: Math.random,
      voices: (cat) => this.pool.count(now, cat),
      hasTag: (tag) => this.liveTag(tag, now),
    });
    for (const q of cues) this.exec(q, now);
  };

  /** Голос с меткой ещё звучит (не доиграл и не был остановлен). */
  private liveTag(tag: string, now: number): boolean {
    const slot = this.tags.get(tag);
    if (!slot) return false;
    if (slot.end > now) return true;
    this.pool.prune(now); // доиграл — отпустить и снять метку
    this.tags.delete(tag);
    return false;
  }

  private exec(q: Cue, now: number): void {
    switch (q.op) {
      case 'play':
        if (this.sfxOn) this.playCue(q);
        break;
      case 'stop': {
        const slot = this.tags.get(q.tag);
        if (slot) this.pool.release(slot, now);
        this.tags.delete(q.tag);
        break;
      }
      case 'duck':
        this.duckMusic();
        break;
      case 'levelEnd':
        // Фон уровня гаснет, через 0.1 с — джингл (UI может позвать ui('win'|'lose') — кулдаун не даст повтора).
        this.endLevelMusic();
        if (this.musicOn) this.playKey(q.won ? 'jingle:win' : 'jingle:lose', { delay: 0.1 });
        break;
      case 'state':
        this.grunts.onState(q.to, now, Math.random);
        break;
    }
  }

  private readonly idleTick = (): void => {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.sfxOn || this.paused) return;
    if (this.session !== 'ready' && this.session !== 'aiming') return;
    if (!this.grunts.due(c.currentTime, Math.random)) return;
    // хрюкает свинья из тех, что есть на уровне; они справа от рогатки и обычно за краем кадра — тихо и правее
    this.playKey(`pigGrunt:${gruntPig(this.plan, Math.random)}`, { gain: 0.5, pan: 0.25 + Math.random() * 0.25 });
  };

  // ───────────────────────── UI и награды ─────────────────────────

  /** UI-звук. Для 'tick' arg — прогресс счётчика 0..1 (без него тон растёт по времени прокрутки счёта). */
  ui(name: UiSoundName, arg?: number): void {
    if (!this.ready) return;
    const key = UI_KEYS[name];
    if (!key) return;
    if (onMusicBus(key) ? !this.musicOn : !this.sfxOn) return; // джинглы — часть музыки (05-audio §9.6)
    if (name === 'tick') {
      this.scoreTick(arg ?? this.ticks.next(this.ctx!.currentTime));
      return;
    }
    if ((name === 'win' || name === 'lose') && this.track?.id === 'level') this.endLevelMusic();
    this.playKey(key);
  }

  /** Награды экрана победы (07-ui-ux §12.5). */
  reward(kind: RewardKind): void {
    if (!this.ready || !this.sfxOn) return;
    this.playKey(REWARD_KEYS[kind]);
  }

  /** Тик счётчика очков: progress 0..1 поднимает тон 1800 → 3000 Гц; чаще раза в 45 мс не звучит. */
  scoreTick(progress: number): void {
    if (!this.ready || !this.sfxOn) return;
    this.playKey('tick', { param: clamp01(progress) });
  }

  /** Проиграть звук каталога по ключу (страница предпросмотра, особые случаи UI). */
  play(key: string, opts: PlayOpts = {}): boolean {
    if (!this.ready || !(onMusicBus(key) ? this.musicOn : this.sfxOn)) return false;
    return this.playKey(key, opts) !== null;
  }

  private playKey(key: string, o: PlayOpts = {}): VoiceSlot | null {
    const def = soundDef(key);
    if (!def) return null;
    const gain = o.gain ?? 1;
    const cue: PlayCue = {
      op: 'play', key, cat: def.cat, gain, pan: o.pan ?? 0, delay: o.delay ?? 0, rate: o.rate ?? 1, send: def.send ?? 0, score: gain,
    };
    if (o.param !== undefined) cue.param = o.param;
    return this.playCue(cue);
  }

  // ───────────────────────── воспроизведение ─────────────────────────

  private synth(out: AudioNode): S {
    return { ctx: this.ctx!, out, nb: this.nb!, rnd: Math.random, tanh: this.tanh };
  }

  private playCue(q: PlayCue): VoiceSlot | null {
    const c = this.ctx;
    const g = this.g;
    const def = soundDef(q.key);
    if (!c || !g || !def || c.state !== 'running') return null;
    const cat: Cat = q.cat;
    if (!(q.gain * CAT_MIX[cat].gain >= 0.02)) return null; // слишком тихо/далеко — не тратим голос
    const gain = q.gain * CAT_MIX[cat].gain * trimGain(def);
    const now = c.currentTime;
    const slot = this.pool.acquire(q.key, cat, q.score * CAT_MIX[cat].prio * (def.weight ?? 1), cooldownFor(q.key, cat), now);
    if (!slot) return null;

    const t = now + (cat === 'ui' || cat === 'reward' ? 0.005 : 0.01) + Math.max(0, q.delay);
    const input = c.createGain();
    input.gain.value = gain;
    /** Узлы голоса, которые надо отключить от шин, когда он отзвучит. */
    const wires: AudioNode[] = [input];
    const bus = busOf(g, def);
    if (q.pan) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, q.pan));
      input.connect(p).connect(bus);
      wires.push(p);
    } else input.connect(bus);
    const send = q.send || def.send || 0;
    if (send > 0) {
      const sg = c.createGain();
      sg.gain.value = send;
      input.connect(sg).connect(g.send);
      wires.push(sg);
    }

    let sources: AudioScheduledSourceNode[] = [];
    let end: number;
    const bufs = this.baked.get(q.key);
    if (bufs && bufs.length > 0) {
      const src = c.createBufferSource();
      const buf = bufs[Math.floor(Math.random() * bufs.length)]!;
      src.buffer = buf;
      // ±60 центов — два одинаковых звука подряд не звучат одинаково
      src.playbackRate.value = q.rate * 2 ** ((Math.random() * 120 - 60) / 1200);
      src.connect(input);
      src.start(t);
      end = t + buf.duration / src.playbackRate.value;
      sources = [src];
    } else {
      beginCollect();
      try {
        end = def.fn(this.synth(input), t, q.param ?? def.param ?? 0);
      } catch (err) {
        console.warn('[audio] рецепт', q.key, err);
        end = t;
      } finally {
        sources = endCollect();
      }
    }
    // Колокольчики держат место в пуле до −40 дБ (holdFrac), тихий хвост доигрывает вне лимита.
    slot.end = t + Math.max(0, end - t) * (def.holdFrac ?? 1);
    const tag = q.tag;
    let wired = true;
    const unwire = (): void => {
      if (!wired) return;
      wired = false;
      for (const w of wires) w.disconnect();
    };
    const dropTag = (): void => {
      if (tag && this.tags.get(tag) === slot) this.tags.delete(tag);
    };
    slot.onStop = (n) => {
      // фейд τ 5 мс и реальная остановка источников через 40 мс — без щелчка и без лишнего CPU;
      // затем вход голоса отключается от шины (иначе панорама и посыл висят на шине до закрытия контекста)
      input.gain.cancelScheduledValues(n);
      input.gain.setValueAtTime(input.gain.value, n);
      input.gain.setTargetAtTime(0, n, 0.005);
      for (const s of sources) {
        try {
          s.stop(n + 0.04);
        } catch {
          /* уже остановлен */
        }
      }
      dropTag();
      this.later(unwire, RELEASE_DISCONNECT_MS);
    };
    slot.onEnd = () => {
      dropTag();
      const left = end - (this.ctx?.currentTime ?? end);
      if (left > 0.005) this.later(unwire, left * 1000 + 20); // хвост за пределом пула ещё звучит
      else unwire();
    };
    if (tag) this.tags.set(tag, slot);
    return slot;
  }

  // ───────────────────────── служебное ─────────────────────────

  /** Состояние для отладки и страницы предпросмотра. */
  stats(): AudioStats {
    const now = this.ctx?.currentTime ?? 0;
    return {
      state: this.ctx?.state ?? 'none',
      voices: this.pool.count(now),
      baked: this.baked.size,
      bakeTotal: BAKE_LIST.length,
      pool: { ...this.pool.stats },
      music: this.track?.id ?? null,
    };
  }

  /**
   * Освободить всё навсегда: контекст закрыт, слушатели и таймеры сняты, подготовка и запекание прерваны.
   * После dispose() жесты ничего не создают, вызовы методов — тихий no-op.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disarmUnlock();
    this.stopMusic(0);
    if (this.gruntTimer) clearInterval(this.gruntTimer);
    this.gruntTimer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    for (const p of [this.prepNoise, this.prepIR, this.prepBakeNoise]) p?.cancel();
    this.prepNoise = this.prepIR = this.prepBakeNoise = null;
    const c = this.ctx;
    if (c) this.pool.releaseAll(c.currentTime);
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    this.pending = [];
    this.tags.clear();
    this.baked.clear();
    this.wantMusic = null;
    this.levelAfterEnd = null;
    this.ctx = null;
    this.g = null;
    this.nb = null;
    if (c) {
      c.onstatechange = null; // close() вызовет onstatechange('closed') — без этого движок снова взводил жесты
      void c.close().catch(() => undefined);
    }
  }
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 1;
}
