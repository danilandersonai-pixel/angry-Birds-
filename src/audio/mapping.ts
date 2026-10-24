// Карта «игровые события → звуки» (docs/research/05-audio.md §7) — чистая функция без Web Audio.
// Движок складывает события кадра в пачку и вызывает planFrame(); результат — список «реплик» (Cue),
// которые движок исполняет: проиграть ключ каталога, остановить фитиль, приглушить музыку, конец уровня.

import type { GameEvent, ImpactSurface, SessionState } from '../core/events';
import type { PigType } from '../core/types';
import { type Cat, type ImpactReq, impactIntensity, impactVolume, selectImpacts, spatial, tierOf, TokenBucket } from './mix';

/** Положение слушателя: центр камеры по X и ширина видимой области, м. */
export interface Listener {
  camX: number;
  viewW: number;
}

export interface PlayCue {
  op: 'play';
  /** Ключ звука из каталога (catalog.ts). */
  key: string;
  cat: Cat;
  /** Громкость события × пространство (CAT_MIX.gain движок умножает сам). */
  gain: number;
  pan: number;
  /** Задержка от «сейчас», с. */
  delay: number;
  /** playbackRate буфера (размер блока, разброс смеха). */
  rate: number;
  /** Посыл в реверб. */
  send: number;
  /** Важность для кражи голоса (движок умножает на приоритет категории). */
  score: number;
  /** Параметр живого рецепта (натяжение, длительность, номер бонуса). */
  param?: number;
  /** Метка, по которой звук можно остановить позже (фитиль). */
  tag?: string;
}

export type Cue =
  | PlayCue
  | { op: 'stop'; tag: string }
  | { op: 'duck' }
  | { op: 'levelEnd'; won: boolean }
  | { op: 'state'; to: SessionState };

/** Состояние, которое карта помнит между кадрами. */
export interface PlanState {
  lastPower: number;
  bonusIdx: number;
  /** id свиньи → время последнего «уф» (не чаще раза в 300 мс на свинью). */
  pigVoxAt: Map<number, number>;
  /** Птицы с горящим фитилём. */
  fuses: Set<number>;
  /** Ведро токенов ударов. */
  bucket: TokenBucket;
}

export function createPlanState(): PlanState {
  return { lastPower: 0, bonusIdx: 0, pigVoxAt: new Map(), fuses: new Set(), bucket: new TokenBucket(6, 40) };
}

export interface PlanEnv {
  /** Текущее время аудио, с. */
  now: number;
  rnd: () => number;
  /** Сколько голосов категории звучит сейчас (для «громкой/тихой» гибели свиньи). */
  voices?: (cat: Cat) => number;
}

export interface FrameEvent {
  e: GameEvent;
  l?: Listener | undefined;
}

/** Длительность фитиля Bomb по умолчанию (останавливается взрывом/исчезновением раньше), мс. */
export const FUSE_MS = 3000;
/** Длина дуги Хэла, мс. */
export const HAL_ARC_MS = 1000;
/** Не чаще раза в 300 мс «уф» одной и той же свиньи. */
export const PIG_VOX_GAP_S = 0.3;

const MATERIALS: ReadonlySet<ImpactSurface> = new Set<ImpactSurface>(['wood', 'ice', 'stone']);

/** Ключ звука удара для поверхности (или null — птица/яйцо не звучат как поверхность). */
export function impactKey(surf: ImpactSurface, I: number): { key: string; k: number } | null {
  if (MATERIALS.has(surf)) return { key: `${surf}Hit:${tierOf(I)}`, k: 1 };
  if (surf === 'ground') return { key: `ground:${I < 0.6 ? 0 : 1}`, k: 1 };
  if (surf === 'pig') return { key: 'pigBump', k: 0.8 };
  if (surf === 'tnt') return { key: `woodHit:${tierOf(I)}`, k: 0.8 };
  return null;
}

const fuseTag = (id: number): string => `fuse:${id}`;

interface ImpactItem extends ImpactReq {
  l: Listener | undefined;
}

/** Разобрать пачку событий одного кадра в реплики. */
export function planFrame(batch: ReadonlyArray<FrameEvent>, st: PlanState, env: PlanEnv): Cue[] {
  const out: Cue[] = [];
  const impacts: ImpactItem[] = [];
  let destroyed = 0;
  let loudPops = 0;

  const play = (key: string, cat: Cat, gain: number, pan = 0, extra: Partial<PlayCue> = {}): void => {
    if (!(gain > 0)) return;
    out.push({ op: 'play', key, cat, gain, pan, delay: 0, rate: 1, send: 0, score: gain, ...extra });
  };
  const stopFuse = (id: number): void => {
    if (st.fuses.delete(id)) out.push({ op: 'stop', tag: fuseTag(id) });
  };

  for (const { e, l } of batch) {
    const sp = (x: number, reach = 1): { gain: number; pan: number } => (l ? spatial(x, l.camX, l.viewW, reach) : { gain: 1, pan: 0 });
    switch (e.type) {
      case 'stateChanged':
        if (e.to === 'bonus') st.bonusIdx = 0;
        out.push({ op: 'state', to: e.to });
        break;
      case 'birdLoaded':
        play('hop', 'sling', 1);
        play(`select:${e.bird}`, 'birdVox', 1, 0, { delay: 0.2 });
        break;
      case 'aimStart':
        st.lastPower = 0;
        play('slingGrab', 'sling', 1);
        break;
      case 'aimStretch': {
        const p = Math.max(0, Math.min(1, e.power));
        // ослабление натяжения — тот же скрип, но вдвое тише
        const g = p >= st.lastPower - 0.02 ? 1 : 0.5;
        st.lastPower = p;
        play('slingStretch', 'sling', g, 0, { param: p });
        break;
      }
      case 'aimCancel':
        play('slingCancel', 'sling', 1);
        break;
      case 'birdLaunched': {
        const p = Math.max(0, Math.min(1, e.power));
        const s = sp(e.x);
        const g = Math.max(0.6, s.gain); // собственное действие игрока слышно всегда
        play(p > 0.6 ? 'slingRelease:hi' : 'slingRelease:lo', 'sling', (0.6 + 0.4 * p) * g, s.pan);
        play(`launch:${e.bird}`, 'birdVox', g, s.pan + 0.1, { delay: 0.04 });
        break;
      }
      case 'ability': {
        const s = sp(e.x);
        const g = Math.max(0.5, s.gain);
        switch (e.bird) {
          case 'chuck':
          case 'blues':
          case 'matilda':
          case 'silver':
            play(`ab:${e.bird}`, 'ability', g, s.pan);
            break;
          case 'hal':
            play('ab:hal', 'ability', g, s.pan, { param: HAL_ARC_MS });
            break;
          case 'bomb':
            play('ab:bombSwell', 'ability', g, s.pan);
            stopFuse(e.id);
            break;
          default:
            break; // red, terence — способности нет
        }
        break;
      }
      case 'impact': {
        const I = impactIntensity(e.impulse);
        const seen = new Set<string>();
        let first = true;
        for (const surf of [e.a, e.b]) {
          const ik = impactKey(surf, I);
          if (!ik || seen.has(ik.key)) continue;
          seen.add(ik.key);
          impacts.push({ key: ik.key, intensity: I * ik.k * (first ? 1 : 0.6), x: e.x, l });
          first = false;
        }
        break;
      }
      case 'birdImpact': {
        const s = sp(e.x);
        play(`hurt:${e.bird}`, 'birdVox', s.gain, s.pan);
        play('feather', 'impact', s.gain * 0.8, s.pan);
        if (e.bird === 'bomb' && !st.fuses.has(e.id)) {
          st.fuses.add(e.id);
          play('fuse', 'loop', Math.max(0.4, s.gain), s.pan, { param: FUSE_MS, tag: fuseTag(e.id), score: 1 });
        }
        break;
      }
      case 'birdRemoved': {
        const s = sp(e.x);
        play('puff', 'impact', s.gain, s.pan);
        stopFuse(e.id);
        break;
      }
      case 'blockDamaged': {
        const s = sp(e.x);
        const stage = Math.max(1, Math.min(3, Math.round(e.stage)));
        play(`${e.material}Crack:${stage}`, 'break', s.gain, s.pan);
        break;
      }
      case 'blockDestroyed': {
        destroyed++;
        const s = sp(e.x);
        const size = Math.sqrt(Math.max(0.01, e.w * e.h));
        const key = e.material === 'wood' ? 'woodBreak' : e.material === 'ice' ? 'iceShatter' : 'stoneBreak';
        // крупный блок — ниже и громче
        const rate = Math.min(1.2, Math.max(0.8, size ** -0.25));
        play(key, 'break', s.gain * Math.min(1.2, 0.6 + 0.4 * size), s.pan, { rate, send: 0.12 });
        break;
      }
      case 'pigDamaged': {
        const s = sp(e.x);
        const last = st.pigVoxAt.get(e.id);
        if (last === undefined || env.now - last >= PIG_VOX_GAP_S) {
          st.pigVoxAt.set(e.id, env.now);
          play(`pigHurt:${e.pig}`, 'pigVox', s.gain, s.pan);
        }
        if (e.helmetLost) play('helmet', 'impact', s.gain, s.pan);
        break;
      }
      case 'pigDestroyed': {
        const s = sp(e.x);
        st.pigVoxAt.delete(e.id);
        // цепная гибель не превращается в хор: визг — только если свободны голоса свиней
        const loud = (env.voices?.('pigVox') ?? 0) + loudPops < 2;
        if (loud) {
          loudPops++;
          play(`pigPop:${e.pig}`, 'pigVox', s.gain, s.pan);
        } else play('pigPopQuiet', 'impact', s.gain, s.pan);
        break;
      }
      case 'tntDestroyed': {
        const s = sp(e.x);
        play('woodBreak', 'break', s.gain * 0.6, s.pan, { rate: 0.85 });
        break;
      }
      case 'explosion': {
        const s = sp(e.x, 2);
        play(`boom:${e.source}`, 'explosion', Math.max(0.3, s.gain), s.pan * 0.6, { send: 0.25 });
        out.push({ op: 'duck' });
        if (e.source === 'bomb') for (const id of [...st.fuses]) stopFuse(id);
        break;
      }
      case 'birdBonus': {
        play('bonus', 'reward', 1, 0, { param: st.bonusIdx++ });
        play('hop', 'sling', 0.7);
        break;
      }
      case 'pigsLaugh': {
        const kinds: PigType[] = ['medium', 'small', 'large'];
        const n = 1 + Math.floor(env.rnd() * 3);
        let delay = 0;
        for (let i = 0; i < n; i++) {
          play(`pigLaugh:${kinds[i]!}`, 'pigVox', 0.9 - 0.2 * i, (i - 1) * 0.3, { delay, rate: 0.96 + env.rnd() * 0.08 });
          delay += 0.09 + env.rnd() * 0.09;
        }
        break;
      }
      case 'levelEnd':
        for (const id of [...st.fuses]) stopFuse(id);
        out.push({ op: 'levelEnd', won: e.won });
        break;
      case 'score':
        break; // только визуал
      default:
        break;
    }
  }

  // ── удары кадра: ≤ 4 самых сильных (≤ 2 на ключ) через «ведро», остальное — в обломки ──
  const { play: chosen, overflow } = selectImpacts(impacts);
  for (const r of chosen) {
    if (!st.bucket.take(env.now)) break;
    const s = r.l ? spatial(r.x, r.l.camX, r.l.viewW) : { gain: 1, pan: 0 };
    play(r.key, 'impact', impactVolume(r.intensity) * s.gain, s.pan, { score: r.intensity });
  }
  if (overflow > 1.5 || destroyed >= 3) {
    play('rubble', 'break', Math.min(1, Math.max(overflow, destroyed) / 6), 0, { delay: 0.02 });
  }
  return out;
}

/**
 * Имена UI-звуков: контракт спецификации ('click'…'newRecord') + расширения из 05-audio/07-ui-ux
 * ('hover', 'toggleOn', 'toggleOff', 'locked', 'popIn', 'whoosh', 'starEmpty', 'scoreDone').
 */
export type UiSoundName =
  | 'click' | 'back' | 'pop' | 'swoosh' | 'star1' | 'star2' | 'star3' | 'tick' | 'win' | 'lose' | 'newRecord'
  | 'hover' | 'toggleOn' | 'toggleOff' | 'locked' | 'popIn' | 'whoosh' | 'starEmpty' | 'scoreDone';

/** Награды экрана победы (07-ui-ux §12.5): звёзды по индексу, пустая звезда, конец счёта, рекорд. */
export type RewardKind = 'star0' | 'star1' | 'star2' | 'starEmpty' | 'scoreDone' | 'newBest';

/** UI-имя → ключ каталога. */
export const UI_KEYS: Readonly<Record<UiSoundName, string>> = {
  click: 'ui:click',
  back: 'ui:back',
  pop: 'ui:popIn',
  swoosh: 'ui:whoosh',
  star1: 'star:0',
  star2: 'star:1',
  star3: 'star:2',
  tick: 'tick',
  win: 'jingle:win',
  lose: 'jingle:lose',
  newRecord: 'newBest',
  hover: 'ui:hover',
  toggleOn: 'ui:toggleOn',
  toggleOff: 'ui:toggleOff',
  locked: 'ui:locked',
  popIn: 'ui:popIn',
  whoosh: 'ui:whoosh',
  starEmpty: 'starEmpty',
  scoreDone: 'scoreDone',
};

export const REWARD_KEYS: Readonly<Record<RewardKind, string>> = {
  star0: 'star:0',
  star1: 'star:1',
  star2: 'star:2',
  starEmpty: 'starEmpty',
  scoreDone: 'scoreDone',
  newBest: 'newBest',
};

/** Прогресс тика без явного аргумента: тики подряд (чаще раза в 0.3 с) постепенно поднимают тон. */
export class TickProgress {
  private last = -Infinity;
  private n = 0;
  next(now: number): number {
    this.n = now - this.last > 0.3 ? 0 : this.n + 1;
    this.last = now;
    return Math.min(1, this.n / 24);
  }
}

/** Хрюканье свиней «от скуки», пока игрок целится: раз в 7–14 с в состояниях ready/aiming. */
export class IdleGrunts {
  private next = Infinity;
  onState(to: SessionState, now: number, rnd: () => number): void {
    if (to === 'ready' || to === 'aiming') {
      if (this.next === Infinity) this.next = now + 4 + rnd() * 6;
    } else this.next = Infinity;
  }
  /** Пора хрюкнуть? Если да — назначает следующий раз. */
  due(now: number, rnd: () => number): boolean {
    if (now < this.next) return false;
    this.next = now + 7 + rnd() * 7;
    return true;
  }
  reset(): void {
    this.next = Infinity;
  }
}

/** Все ключи, которые карта может запросить (для проверки каталога в тестах). */
export function allPlannedKeys(): string[] {
  const birds = ['red', 'blues', 'chuck', 'bomb', 'matilda', 'hal', 'terence', 'silver'];
  const pigs = ['small', 'medium', 'large', 'helmet', 'mustache', 'king'];
  const keys = [
    'hop', 'slingGrab', 'slingStretch', 'slingCancel', 'slingRelease:hi', 'slingRelease:lo',
    'ab:chuck', 'ab:blues', 'ab:matilda', 'ab:silver', 'ab:hal', 'ab:bombSwell', 'fuse', 'feather', 'puff',
    'woodBreak', 'iceShatter', 'stoneBreak', 'rubble', 'helmet', 'pigPopQuiet', 'pigBump', 'ground:0', 'ground:1',
    'boom:tnt', 'boom:bomb', 'boom:egg', 'bonus',
  ];
  for (const b of birds) keys.push(`select:${b}`, `launch:${b}`, `hurt:${b}`);
  for (const p of pigs) keys.push(`pigHurt:${p}`, `pigPop:${p}`, `pigLaugh:${p}`, `pigGrunt:${p}`);
  for (const m of ['wood', 'ice', 'stone']) for (const k of [0, 1, 2]) keys.push(`${m}Hit:${k}`);
  for (const m of ['wood', 'ice', 'stone']) for (const k of [1, 2, 3]) keys.push(`${m}Crack:${k}`);
  return keys;
}
