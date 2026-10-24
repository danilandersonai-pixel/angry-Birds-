// AudioEngine — весь звук игры синтезом Web Audio, без аудиофайлов (docs/research/05-audio.md).
//
// Контракт (спецификация §3):  unlock, setSfx, setMusic, setMasterVolume, playMusic, handle, ui, ready.
// Расширения (05-audio §2.3, 07-ui-ux): reward, scoreTick, setPaused, play, playMusic(track, theme), dispose.
//
// Граф: голоса → sfx/ui → (send → реверб) → master → компрессор → выход; музыка/фон → duck → master.
// События кадра копятся и разбираются одной пачкой (microtask): отбор ударов, лимит голосов (24),
// кулдауны одинаковых звуков (40–60 мс), громкость по силе удара и удалённости от камеры.
// Большинство SFX запекаются в буферы после разблокировки; до готовности звучит живой синтез того же рецепта.

import type { GameEvent, SessionState } from '../core/events';
import type { PigType, ThemeId } from '../core/types';
import { BAKE_LIST, bakeAll, type OfflineCtor } from './bake';
import { soundDef, trimGain } from './catalog';
import { BUS_LEVEL, createMixGraph, type MixGraph } from './graph';
import {
  type Cue, type FrameEvent, type Listener, type PlanState, type PlayCue, type RewardKind, type UiSoundName,
  createPlanState, IdleGrunts, planFrame, REWARD_KEYS, TickProgress, UI_KEYS,
} from './mapping';
import { type Cat, CAT_LIMIT, CAT_MIX, cooldownFor, MAX_VOICES, MAX_VOICES_MOBILE, mobileLimits, type PoolStats, VoicePool, type VoiceSlot } from './mix';
import { makeNoiseBank, makeTanhCurve, type NoiseBank } from './noise';
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
const GRUNT_PIGS: readonly PigType[] = ['small', 'medium', 'large', 'medium'];

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private g: MixGraph | null = null;
  private nb: NoiseBank | null = null;
  private readonly tanh = makeTanhCurve(3);
  private readonly pool: VoicePool;
  private readonly plan: PlanState = createPlanState();
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
  private track: TrackHandle | null = null;
  private readonly tags = new Map<string, VoiceSlot>();
  private readonly ticks = new TickProgress();
  private readonly grunts = new IdleGrunts();
  private gruntTimer: ReturnType<typeof setInterval> | null = null;
  private session: SessionState | null = null;
  private primed = false;
  private started = false;
  private armed = false;
  private suspendedByUs = false;

  constructor(opts: AudioEngineOptions = {}) {
    this.sfxOn = opts.sfx ?? true;
    this.musicOn = opts.music ?? true;
    this.volume = clamp01(opts.volume ?? 1);
    const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.pool = new VoicePool(mobile ? MAX_VOICES_MOBILE : MAX_VOICES, mobile ? mobileLimits() : CAT_LIMIT);
    if (opts.autoUnlock !== false) this.armUnlock();
  }

  /** Звук работает: контекст создан и запущен (после первого жеста). */
  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Живой AudioContext (null до первого unlock или без поддержки Web Audio). */
  get context(): AudioContext | null {
    return this.ctx;
  }

  // ───────────────────────── разблокировка ─────────────────────────

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
      if (c.state === 'running') this.onRunning();
    });
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    let c: AudioContext;
    try {
      c = new AC({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    this.ctx = c;
    this.g = createMixGraph(c);
    this.nb = makeNoiseBank(c, 2);
    this.applyLevels(true);
    c.onstatechange = () => {
      if (c.state === 'running') this.onRunning();
      // iOS: звонок/Siri переводят контекст в 'interrupted' — вернуть можно только жестом.
      else if (!this.suspendedByUs && typeof document !== 'undefined' && !document.hidden) this.armUnlock();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    return c;
  }

  private readonly onVisibility = (): void => {
    const c = this.ctx;
    if (!c) return;
    if (document.hidden) {
      if (c.state === 'running') {
        this.suspendedByUs = true;
        void c.suspend();
      }
    } else if (this.suspendedByUs) {
      this.suspendedByUs = false;
      void c.resume();
    }
  };

  private readonly onGesture = (): void => {
    void this.unlock();
  };

  private armUnlock(): void {
    if (this.armed || typeof window === 'undefined') return;
    this.armed = true;
    for (const ev of GESTURES) window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
  }

  private disarmUnlock(): void {
    if (!this.armed) return;
    this.armed = false;
    for (const ev of GESTURES) window.removeEventListener(ev, this.onGesture, { capture: true });
  }

  private onRunning(): void {
    this.disarmUnlock();
    if (!this.started) {
      this.started = true;
      this.startBake();
      this.gruntTimer = setInterval(this.idleTick, 1000);
    }
    if (this.wantMusic && this.musicOn && !this.track) this.startMusic(this.wantMusic, this.wantTheme);
  }

  private startBake(): void {
    if (this.bakeStarted || typeof window === 'undefined') return;
    const Off = (window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: OfflineCtor }).webkitOfflineAudioContext) as OfflineCtor | undefined;
    if (!Off) return;
    this.bakeStarted = true;
    bakeAll(Off, 32000, BAKE_LIST, (key, bufs) => this.baked.set(key, bufs)).catch((err: unknown) => {
      // Без запекания всё звучит живым синтезом — только дороже по CPU.
      console.warn('[audio] запекание не удалось, работает живой синтез:', err);
    });
  }

  // ───────────────────────── переключатели ─────────────────────────

  setSfx(on: boolean): void {
    this.sfxOn = on;
    this.applyLevels();
    if (!on && this.ctx) {
      this.pool.releaseAll(this.ctx.currentTime);
      this.tags.clear();
      this.plan.fuses.clear();
    }
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!on) this.stopMusic(0.3);
    else if (this.wantMusic && this.ready && !this.track) this.startMusic(this.wantMusic, this.wantTheme);
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
      for (const [tag, slot] of [...this.tags]) {
        if (!tag.startsWith('fuse:')) continue;
        this.pool.release(slot, this.ctx.currentTime);
        this.tags.delete(tag);
      }
      this.plan.fuses.clear();
    }
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
   * Музыка экрана: 'menu' — полька, 'level' — тихий эмбиент + фон темы, null — тишина.
   * Смена — кроссфейд 0.6 с. Повторный вызов с тем же треком ничего не перезапускает.
   */
  playMusic(track: 'menu' | 'level' | null, theme?: ThemeId): void {
    const th = theme ?? this.wantTheme;
    this.wantMusic = track;
    this.wantTheme = th;
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
    if (e.type === 'stateChanged') this.session = e.to;
    if (!this.ready) return;
    if (!this.sfxOn && e.type !== 'levelEnd' && e.type !== 'stateChanged') return;
    this.pending.push({ e, l: listener });
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(this.flush);
    }
  }

  private readonly flush = (): void => {
    this.flushQueued = false;
    const batch = this.pending;
    this.pending = [];
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    const cues = planFrame(batch, this.plan, { now, rnd: Math.random, voices: (cat) => this.pool.count(now, cat) });
    for (const q of cues) this.exec(q, now);
  };

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
        // Музыка уровня гаснет, через 0.1 с — джингл (UI может позвать ui('win'|'lose') — кулдаун не даст повтора).
        this.wantMusic = null;
        this.grunts.reset();
        this.stopMusic(0.5);
        if (this.sfxOn) this.playKey(q.won ? 'jingle:win' : 'jingle:lose', { delay: 0.1 });
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
    const pig = GRUNT_PIGS[Math.floor(Math.random() * GRUNT_PIGS.length)]!;
    // свиньи справа от рогатки и обычно за краем кадра — тихо и правее
    this.playKey(`pigGrunt:${pig}`, { gain: 0.5, pan: 0.25 + Math.random() * 0.25 });
  };

  // ───────────────────────── UI и награды ─────────────────────────

  /** UI-звук. Для 'tick' arg — прогресс счётчика 0..1 (без него тон растёт сам при частых тиках). */
  ui(name: UiSoundName, arg?: number): void {
    if (!this.ready || !this.sfxOn) return;
    const key = UI_KEYS[name];
    if (!key) return;
    if (name === 'tick') {
      this.scoreTick(arg ?? this.ticks.next(this.ctx!.currentTime));
      return;
    }
    if ((name === 'win' || name === 'lose') && this.track?.id === 'level') {
      this.wantMusic = null;
      this.stopMusic(0.5);
    }
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
    if (!this.ready || !this.sfxOn) return false;
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
    const slot = this.pool.acquire(q.key, cat, q.score * CAT_MIX[cat].prio, cooldownFor(q.key, cat), now);
    if (!slot) return null;

    const t = now + (cat === 'ui' || cat === 'reward' ? 0.005 : 0.01) + Math.max(0, q.delay);
    const input = c.createGain();
    input.gain.value = gain;
    const bus = g.busFor(cat);
    if (q.pan) {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, q.pan));
      input.connect(p).connect(bus);
    } else input.connect(bus);
    const send = q.send || def.send || 0;
    if (send > 0) {
      const sg = c.createGain();
      sg.gain.value = send;
      input.connect(sg).connect(g.send);
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
    slot.end = end;
    slot.onStop = (n) => {
      // фейд τ 5 мс и реальная остановка источников через 40 мс — без щелчка и без лишнего CPU
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
    };
    const tag = q.tag;
    slot.onEnd = () => {
      input.disconnect();
      if (tag && this.tags.get(tag) === slot) this.tags.delete(tag);
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

  /** Освободить всё (закрыть контекст). */
  dispose(): void {
    this.disarmUnlock();
    this.stopMusic(0.05);
    if (this.gruntTimer) clearInterval(this.gruntTimer);
    this.gruntTimer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    const c = this.ctx;
    this.ctx = null;
    this.g = null;
    if (c) void c.close().catch(() => undefined);
  }
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 1;
}
