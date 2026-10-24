// AudioEngine — эталонная сборка (контракт из спецификации: unlock, setSfx, setMusic, playMusic, handle, ui).
// Граф: [голоса] → sfx/ui → (send → reverb) → master → compressor → destination; music/ambience → duck → master.

import type { GameEvent } from '../../../src/core/events.ts';
import { bakeAll, tierOf } from './bake.ts';
import { type CatGain, CAT_GAIN, COOLDOWN_MS } from './tables.ts';
import { type Cat, type Voice, CAT_LIMIT, impactIntensity, impactVolume, MAX_VOICES_DESKTOP, MAX_VOICES_MOBILE, mobileLimits, selectImpacts, spatial, TokenBucket, VoiceManager } from './mix.ts';
import { type NoiseBank, makeNoiseBank, makeReverbIR, makeTanhCurve } from './noise.ts';
import * as M from './music.ts';
import * as F from './sfx.ts';
import { beginCollect, endCollect } from './synth.ts';

export interface ViewCtx {
  camX: number;
  viewW: number;
}
const MATS = new Set(['wood', 'ice', 'stone']);

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly sfx: GainNode;
  private readonly uiBus: GainNode;
  private readonly music: GainNode;
  private readonly amb: GainNode;
  private readonly duck: GainNode;
  private readonly send: GainNode;
  private readonly nb: NoiseBank;
  private readonly tanh = makeTanhCurve(3);
  private readonly vm: VoiceManager;
  private readonly bucket = new TokenBucket(6, 40);
  private baked = new Map<string, AudioBuffer[]>();
  private pending: Array<{ e: GameEvent; v: ViewCtx | undefined }> = [];
  private flushQueued = false;
  private sfxOn = true;
  private musicOn = true;
  private unlocked = false;
  private wantMusic: 'menu' | 'level' | null = null;
  private theme: F.ThemeId = 'meadow';
  private seq: M.Sequencer | null = null;
  private seqGain: GainNode | null = null;
  private ambVoice: Voice | null = null;
  private ambTimer: ReturnType<typeof setInterval> | null = null;
  private readonly fuses = new Map<number, Voice>();
  private bonusIdx = 0;
  private lastPower = 0;
  private lastPigVox = new Map<number, number>();

  constructor() {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    this.master = this.gain(0.9, comp);
    comp.connect(c.destination);
    this.sfx = this.gain(0.8, this.master);
    this.uiBus = this.gain(0.7, this.master);
    this.duck = this.gain(1, this.master);
    this.music = this.gain(0.64, this.duck);
    this.amb = this.gain(0.35, this.duck);
    const rev = c.createConvolver();
    rev.buffer = makeReverbIR(c);
    this.send = c.createGain();
    this.send.connect(rev).connect(this.gain(0.5, this.master));
    this.nb = makeNoiseBank(c, 2);
    const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.vm = new VoiceManager(c, mobile ? MAX_VOICES_MOBILE : MAX_VOICES_DESKTOP, mobile ? mobileLimits() : CAT_LIMIT);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void c.suspend();
      else if (this.unlocked) void c.resume();
    });
    // iOS: звонок/Siri переводят контекст в 'interrupted'; вернуть можно только жестом.
    c.onstatechange = () => {
      if (c.state !== 'running' && !document.hidden) this.armUnlock();
    };
    this.armUnlock();
  }

  private gain(v: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(dest);
    return g;
  }

  // ───────── разблокировка ─────────
  private readonly onGesture = (): void => this.unlock();
  private armUnlock(): void {
    for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) {
      window.addEventListener(ev, this.onGesture, { capture: true, passive: true });
    }
  }
  unlock(): void {
    const c = this.ctx;
    if (c.state !== 'running') void c.resume();
    if (!this.unlocked) {
      // старый iOS: «проиграть» 1 сэмпл тишины внутри обработчика жеста
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, c.sampleRate);
      s.connect(c.destination);
      s.start();
      this.unlocked = true;
      void bakeAll(OfflineAudioContext, 32000).then((m) => (this.baked = m));
      if (this.wantMusic) this.playMusic(this.wantMusic, this.theme);
    }
    if (c.state === 'running') {
      for (const ev of ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click']) window.removeEventListener(ev, this.onGesture, { capture: true });
    }
  }

  // ───────── переключатели ─────────
  setSfx(on: boolean): void {
    this.sfxOn = on;
    const now = this.ctx.currentTime;
    for (const b of [this.sfx, this.uiBus]) b.gain.setTargetAtTime(on ? (b === this.sfx ? 0.8 : 0.7) : 0, now, 0.03);
  }
  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!on) this.stopMusic(0.3);
    else if (this.wantMusic) this.playMusic(this.wantMusic, this.theme);
  }

  /** Пауза игры: эмбиент ×0.5, длящиеся звуки (фитиль) — стоп. Разовые SFX доигрывают. */
  setPaused(on: boolean): void {
    this.amb.gain.setTargetAtTime(on ? 0.175 : 0.35, this.ctx.currentTime, 0.1);
    if (on) for (const id of [...this.fuses.keys()]) this.stopFuse(id);
  }

  // ───────── музыка и эмбиент ─────────
  playMusic(id: 'menu' | 'level' | null, theme: F.ThemeId = this.theme): void {
    this.wantMusic = id;
    this.theme = theme;
    this.stopMusic(0.6);
    if (!id || !this.musicOn || !this.unlocked) return;
    if (id === 'menu') {
      const g = this.gain(1, this.music);
      const lead = M.makeAccordionStrip(this.ctx, g);
      for (const l of lead.lfos) l.start();
      const bass = this.gain(1, g);
      const stab = this.ctx.createStereoPanner();
      stab.pan.value = 0.25;
      stab.connect(g);
      const drums = this.gain(1, g);
      const inst: M.Inst = { ctx: this.ctx, nb: this.nb };
      this.seq = new M.Sequencer(this.ctx, M.MENU_SONG, (e, t, st) => {
        M.playEv(inst, { lead, bass, stab, drums }, e, t, st);
      });
      this.seq.start();
      this.seqGain = g;
    } else this.startAmbience(theme);
  }
  private stopMusic(fadeS: number): void {
    const now = this.ctx.currentTime;
    if (this.seq && this.seqGain) {
      const seq = this.seq;
      const g = this.seqGain;
      g.gain.setTargetAtTime(0, now, fadeS / 4);
      setTimeout(() => {
        seq.stop();
        g.disconnect();
      }, fadeS * 1000 + 200);
      this.seq = null;
      this.seqGain = null;
    }
    if (this.ambVoice) this.vm.release(this.ambVoice);
    this.ambVoice = null;
    if (this.ambTimer) clearInterval(this.ambTimer);
    this.ambTimer = null;
  }
  private startAmbience(theme: F.ThemeId): void {
    // «Постель» — один длинный живой голос; птички/чайки — редкие события по таймеру.
    const v = this.vm.acquire('amb', 'loop', 100, 0, this.amb, 1, 0);
    if (!v) return;
    beginCollect();
    const end = F.ambienceBed(this.s(v.input), this.ctx.currentTime + 0.05, theme, 3600);
    this.vm.setEnd(v, end, endCollect());
    this.ambVoice = v;
    const gap = F.AMB_EVENT_GAP[theme];
    if (!gap) return;
    let next = this.ctx.currentTime + gap[0];
    this.ambTimer = setInterval(() => {
      const now = this.ctx.currentTime;
      if (now < next) return;
      next = now + gap[0] + Math.random() * (gap[1] - gap[0]);
      this.live('ambEvent', 'loop', 1, 0, (s) => F.ambienceEvent(s, now + 0.05, theme), this.amb);
    }, 500);
  }

  // ───────── события игры ─────────
  /** Складываем события кадра и обрабатываем пачкой (микрозадача после drainEvents). */
  handle(e: GameEvent, view?: ViewCtx): void {
    if (!this.sfxOn && e.type !== 'levelEnd') return;
    this.pending.push({ e, v: view });
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush(): void {
    this.flushQueued = false;
    const batch = this.pending;
    this.pending = [];
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.01;
    const impacts: Array<{ key: string; intensity: number; x: number; v: ViewCtx | undefined }> = [];
    let destroyed = 0;
    for (const { e, v } of batch) {
      const sp = (x: number, reach = 1): { gain: number; pan: number } => (v ? spatial(x, v.camX, v.viewW, reach) : { gain: 1, pan: 0 });
      switch (e.type) {
        case 'birdLoaded':
          this.baked1('hop', 'sling', 1, 0, t);
          this.baked1(`select:${e.bird}`, 'birdVox', 1, 0, t + 0.2);
          break;
        case 'aimStart':
          this.lastPower = 0;
          this.baked1('slingGrab', 'sling', 1, 0, t);
          break;
        case 'aimStretch': {
          // ослабление натяжения — тот же скрип, но вдвое тише
          const g = e.power >= this.lastPower - 0.02 ? 1 : 0.5;
          this.lastPower = e.power;
          this.live('slingStretch', 'sling', g, 0, (s) => F.slingStretch(s, t, e.power));
          break;
        }
        case 'aimCancel':
          this.baked1('slingCancel', 'sling', 1, 0, t);
          break;
        case 'birdLaunched':
          this.baked1(e.power > 0.6 ? 'slingRelease:hi' : 'slingRelease:lo', 'sling', 0.6 + 0.4 * e.power, 0, t);
          this.baked1(`launch:${e.bird}`, 'birdVox', 1, 0.1, t + 0.04);
          break;
        case 'ability':
          this.ability(e.bird, e.id, t, sp(e.x));
          break;
        case 'impact': {
          const I = impactIntensity(e.impulse);
          for (const [surf, k] of [[e.a, 1], [e.b, 0.6]] as const) {
            if (MATS.has(surf)) impacts.push({ key: `${surf}Hit:${tierOf(I)}`, intensity: I * k, x: e.x, v });
            else if (surf === 'ground') impacts.push({ key: `ground:${I < 0.6 ? 0 : 1}`, intensity: I * k, x: e.x, v });
            else if (surf === 'pig') impacts.push({ key: 'pigBump', intensity: I * k * 0.8, x: e.x, v });
            else if (surf === 'tnt') impacts.push({ key: `woodHit:${tierOf(I)}`, intensity: I * k * 0.8, x: e.x, v });
          }
          break;
        }
        case 'birdImpact': {
          const p = sp(e.x);
          this.baked1(`hurt:${e.bird}`, 'birdVox', p.gain, p.pan, t);
          this.baked1('feather', 'impact', p.gain * 0.8, p.pan, t);
          if (e.bird === 'bomb' && !this.fuses.has(e.id)) {
            const fv = this.live(`fuse:${e.id}`, 'loop', p.gain, p.pan, (s) => F.bombFuse(s, t, 3000));
            if (fv) this.fuses.set(e.id, fv);
          }
          break;
        }
        case 'birdRemoved': {
          const p = sp(e.x);
          this.baked1('puff', 'impact', p.gain, p.pan, t);
          this.stopFuse(e.id);
          break;
        }
        case 'blockDamaged': {
          const p = sp(e.x);
          this.baked1(`${e.material}Crack:${Math.max(1, Math.min(3, e.stage))}`, 'break', p.gain, p.pan, t);
          break;
        }
        case 'blockDestroyed': {
          destroyed++;
          const p = sp(e.x);
          const size = Math.sqrt(e.w * e.h);
          const key = e.material === 'wood' ? 'woodBreak' : e.material === 'ice' ? 'iceShatter' : 'stoneBreak';
          // крупный блок — ниже и громче: rate = size^−0.25 (0.8…1.2)
          this.baked1(key, 'break', p.gain * Math.min(1.2, 0.6 + 0.4 * size), p.pan, t, Math.min(1.2, Math.max(0.8, size ** -0.25)), 0.12);
          break;
        }
        case 'pigDamaged': {
          const p = sp(e.x);
          const last = this.lastPigVox.get(e.id) ?? -1;
          if (this.ctx.currentTime - last > 0.3) {
            this.lastPigVox.set(e.id, this.ctx.currentTime);
            this.baked1(`pigHurt:${e.pig}`, 'pigVox', p.gain, p.pan, t);
          }
          if (e.helmetLost) this.baked1('helmet', 'impact', p.gain, p.pan, t);
          break;
        }
        case 'pigDestroyed': {
          const p = sp(e.x);
          const loud = this.vm.count('pigVox') < 2;
          this.baked1(loud ? `pigPop:${e.pig}` : 'pigPopQuiet', loud ? 'pigVox' : 'impact', p.gain, p.pan, t);
          break;
        }
        case 'tntDestroyed': {
          const p = sp(e.x);
          this.baked1('woodBreak', 'break', p.gain * 0.6, p.pan, t, 0.85);
          break;
        }
        case 'explosion': {
          const p = sp(e.x, 2);
          this.baked1(`boom:${e.source}`, 'explosion', Math.max(0.3, p.gain), p.pan * 0.6, t, 1, 0.25);
          this.duckMusic();
          break;
        }
        case 'birdBonus':
          this.live(`bonus:${this.bonusIdx}`, 'reward', 1, 0, (s) => F.bonusDing(s, t, this.bonusIdx++));
          this.baked1('hop', 'sling', 0.7, 0, t);
          break;
        case 'pigsLaugh': {
          const kinds: F.PigType[] = ['medium', 'small', 'large'];
          const n = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) this.baked1(`pigLaugh:${kinds[i]!}`, 'pigVox', 0.9 - 0.2 * i, (i - 1) * 0.3, t + i * (0.09 + Math.random() * 0.09), 0.96 + Math.random() * 0.08);
          break;
        }
        case 'stateChanged':
          if (e.to === 'bonus') this.bonusIdx = 0;
          break;
        case 'levelEnd':
          this.stopMusic(0.5);
          this.jingle(e.won ? M.VICTORY : M.DEFEAT, t + 0.1, e.won ? 0.6 : 0.8);
          break;
        default:
          break;
      }
    }
    // ── удары кадра: ≤ 4 самых сильных (≤ 2 на ключ), остальное — в «обломки» ──
    const { play, overflow } = selectImpacts(impacts);
    for (const r of play) {
      if (!this.bucket.take(this.ctx.currentTime)) break;
      const vw = (r as (typeof impacts)[number]).v;
      const p = vw ? spatial(r.x, vw.camX, vw.viewW) : { gain: 1, pan: 0 };
      this.baked1(r.key, 'impact', impactVolume(r.intensity) * p.gain, p.pan, t, 1, 0, r.intensity);
    }
    if (overflow > 1.5 || destroyed >= 3) this.baked1('rubble', 'break', Math.min(1, Math.max(overflow, destroyed) / 6), 0, t + 0.02);
  }

  private ability(bird: F.BirdType, id: number, t: number, p: { gain: number; pan: number }): void {
    switch (bird) {
      case 'chuck': this.baked1('ab:chuck', 'ability', p.gain, p.pan, t); break;
      case 'blues': this.baked1('ab:blues', 'ability', p.gain, p.pan, t); break;
      case 'matilda': this.baked1('ab:matilda', 'ability', p.gain, p.pan, t); break;
      case 'silver': this.baked1('ab:silver', 'ability', p.gain, p.pan, t); break;
      case 'hal': this.live('ab:hal', 'ability', p.gain, p.pan, (s) => F.abilityHal(s, t, 1000)); break;
      case 'bomb': this.baked1('ab:bombSwell', 'ability', p.gain, p.pan, t); this.stopFuse(id); break;
      default: break; // red, terence — без способности
    }
  }

  private stopFuse(id: number): void {
    const v = this.fuses.get(id);
    if (v) this.vm.release(v);
    this.fuses.delete(id);
  }

  /** Музыка/эмбиент −6 дБ на взрыв: атака τ 30 мс, возврат τ 250 мс через 150 мс. */
  private duckMusic(): void {
    const g = this.duck.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(0.5, now, 0.03);
    g.setTargetAtTime(1, now + 0.15, 0.25);
  }

  /** Джингл на шине музыки; gain: победа 0.6 (пик −5.5 dBFS), поражение 0.8 (−6 dBFS). */
  private jingle(j: M.Jingle, t: number, gain: number): void {
    if (!this.musicOn) return;
    const g = this.gain(gain, this.music);
    const lead = M.makeAccordionStrip(this.ctx, g);
    const stepS = 60 / j.bpm / 4;
    const inst: M.Inst = { ctx: this.ctx, nb: this.nb };
    let end = t;
    for (const e of j.events) end = Math.max(end, M.playEv(inst, { lead, bass: g, stab: g, drums: g }, e, t + e.step * stepS, stepS));
    for (const l of lead.lfos) {
      l.start(t);
      l.stop(end);
    }
    setTimeout(() => g.disconnect(), (end - this.ctx.currentTime) * 1000 + 300);
  }

  ui(name: F.UiSound): void {
    if (!this.sfxOn || this.ctx.state !== 'running') return;
    this.baked1(`ui:${name}`, 'ui', 1, 0, this.ctx.currentTime + 0.005);
  }
  /** Награды экрана победы: звёзды, счётчик, рекорд (живой синтез). */
  reward(kind: 'star0' | 'star1' | 'star2' | 'starEmpty' | 'scoreDone' | 'newBest'): void {
    const t = this.ctx.currentTime + 0.005;
    this.live(kind, 'reward', 1, 0, (s) =>
      kind === 'starEmpty' ? F.starEmpty(s, t) : kind === 'scoreDone' ? F.scoreDone(s, t) : kind === 'newBest' ? F.newBest(s, t) : F.star(s, t, Number(kind[4])),
    );
  }
  scoreTick(progress: number): void {
    const t = this.ctx.currentTime + 0.005;
    this.live('scoreTick', 'reward', 1, 0, (s) => F.scoreTick(s, t, progress));
  }

  // ───────── воспроизведение ─────────
  private s(out: AudioNode): F.S {
    return { ctx: this.ctx, out, nb: this.nb, rnd: Math.random, tanh: this.tanh };
  }
  private bus(cat: Cat): GainNode {
    return cat === 'ui' || cat === 'reward' ? this.uiBus : this.sfx;
  }

  /** Живой синтез через VoiceManager (с кулдауном и лимитом категории). */
  private live(id: string, cat: Cat, gain: number, pan: number, recipe: (s: F.S) => number, dest: AudioNode = this.bus(cat)): Voice | null {
    if (gain < 0.02) return null;
    const cg: CatGain = CAT_GAIN[cat];
    const v = this.vm.acquire(id, cat, gain * cg.prio, COOLDOWN_MS[id.split(':')[0]!] ?? cg.cooldown, dest, gain * cg.gain, pan);
    if (!v) return null;
    beginCollect();
    const end = recipe(this.s(v.input));
    this.vm.setEnd(v, end, endCollect());
    return v;
  }

  /**
   * Запечённый буфер (случайный вариант), питч ±rateJitter (центы ±60 по умолчанию).
   * Пока буферы не готовы — фолбэк на живой рецепт не делаем: первые ~0.5 с после unlock игрок в меню.
   */
  private baked1(key: string, cat: Cat, gain: number, pan: number, t: number, rate = 1, sendLvl = 0, score = gain): void {
    const arr = this.baked.get(key);
    if (!arr || gain < 0.02) return;
    const cg = CAT_GAIN[cat];
    const v = this.vm.acquire(key, cat, score * cg.prio, COOLDOWN_MS[key.split(':')[0]!] ?? cg.cooldown, this.bus(cat), gain * cg.gain, pan);
    if (!v) return;
    const src = this.ctx.createBufferSource();
    src.buffer = arr[Math.floor(Math.random() * arr.length)]!;
    src.playbackRate.value = rate * 2 ** ((Math.random() * 120 - 60) / 1200);
    src.connect(v.input);
    if (sendLvl > 0) {
      const sg = this.ctx.createGain();
      sg.gain.value = sendLvl;
      v.input.connect(sg).connect(this.send);
    }
    src.start(t);
    this.vm.setEnd(v, t + src.buffer.duration / src.playbackRate.value, [src]);
  }
}
