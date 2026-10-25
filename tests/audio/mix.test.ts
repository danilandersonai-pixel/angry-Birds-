// Логика микшера без Web Audio: пул голосов (кулдаун, лимиты, кража), ведро токенов, отбор ударов, пространство.
import { describe, expect, it } from 'vitest';
import {
  CAT_LIMIT, CAT_MIX, cooldownFor, impactIntensity, impactVolume, MAX_VOICES, MAX_VOICES_MOBILE, mobileLimits,
  selectImpacts, spatial, tierOf, TokenBucket, VoicePool,
} from '../../src/audio/mix';

describe('VoicePool: кулдауны', () => {
  it('повтор того же ключа раньше кулдауна отклоняется, после — проходит', () => {
    const p = new VoicePool();
    expect(p.acquire('woodHit:1', 'impact', 1, 45, 0)).not.toBeNull();
    expect(p.acquire('woodHit:1', 'impact', 1, 45, 0.03)).toBeNull();
    expect(p.stats.cooldown).toBe(1);
    expect(p.acquire('woodHit:1', 'impact', 1, 45, 0.045)).not.toBeNull();
  });
  it('кулдаун действует на ключ, а не на категорию', () => {
    const p = new VoicePool();
    expect(p.acquire('woodHit:1', 'impact', 1, 45, 0)).not.toBeNull();
    expect(p.acquire('iceHit:1', 'impact', 1, 45, 0)).not.toBeNull();
  });
  it('кулдауны по префиксу ключа из 05-audio §6.1', () => {
    expect(cooldownFor('woodHit:2', 'impact')).toBe(30);
    expect(cooldownFor('ground:1', 'impact')).toBe(50);
    expect(cooldownFor('iceShatter', 'break')).toBe(35);
    expect(cooldownFor('slingStretch', 'sling')).toBe(60);
    expect(cooldownFor('launch:red', 'birdVox')).toBe(150);
    expect(cooldownFor('pigLaugh:king', 'pigVox')).toBe(1500);
    expect(cooldownFor('tick', 'reward')).toBe(45);
    expect(cooldownFor('ui:click', 'ui')).toBe(40);
    expect(cooldownFor('jingle:win', 'reward')).toBe(4000);
    // неизвестный ключ — кулдаун категории
    expect(cooldownFor('nope', 'ability')).toBe(CAT_MIX.ability.cooldown);
  });
});

describe('VoicePool: лимиты и кража', () => {
  it('лимит категории: лишний тихий голос отклоняется', () => {
    const p = new VoicePool();
    const n = CAT_LIMIT.impact;
    for (let i = 0; i < n; i++) expect(p.acquire(`k${i}`, 'impact', 0.5, 0, 0)).not.toBeNull();
    expect(p.acquire('extra', 'impact', 0.5, 0, 0)).toBeNull();
    expect(p.stats.limited).toBe(1);
    expect(p.count(0, 'impact')).toBe(n);
  });
  it('более важный голос крадёт самый тихий в категории', () => {
    const p = new VoicePool();
    const stopped: string[] = [];
    for (let i = 0; i < CAT_LIMIT.impact; i++) {
      const v = p.acquire(`k${i}`, 'impact', 0.1 + i * 0.1, 0, 0)!;
      v.onStop = () => stopped.push(v.key);
    }
    expect(p.acquire('loud', 'impact', 5, 0, 0)).not.toBeNull();
    expect(stopped).toEqual(['k0']);
    expect(p.stats.stolen).toBe(1);
    expect(p.count(0, 'impact')).toBe(CAT_LIMIT.impact);
  });
  it('общий лимит 32 голоса: дальше — только кража более важным', () => {
    expect(MAX_VOICES).toBe(32);
    const limits = { ...CAT_LIMIT, impact: 100 };
    const p = new VoicePool(MAX_VOICES, limits);
    for (let i = 0; i < 40; i++) p.acquire(`k${i}`, 'impact', 1, 0, 0);
    expect(p.count(0)).toBe(MAX_VOICES);
    // равный по важности не вытесняет
    expect(p.acquire('same', 'impact', 1, 0, 0)).toBeNull();
    // взрыв (prio 5) вытесняет удар
    expect(p.acquire('boom:tnt', 'explosion', CAT_MIX.explosion.prio, 0, 0)).not.toBeNull();
    expect(p.count(0)).toBe(MAX_VOICES);
    expect(p.count(0, 'explosion')).toBe(1);
  });
  it('самый сильный удар не вытесняет голос птицы той же громкости (score = громкость × prio)', () => {
    const p = new VoicePool(1, CAT_LIMIT);
    expect(p.acquire('launch:red', 'birdVox', 1 * CAT_MIX.birdVox.prio, 0, 0)).not.toBeNull();
    expect(p.acquire('woodHit:2', 'impact', 1 * CAT_MIX.impact.prio, 0, 0)).toBeNull();
  });
  it('закончившиеся голоса освобождаются по времени end (onEnd вызывается)', () => {
    const p = new VoicePool();
    const v = p.acquire('a', 'impact', 1, 0, 0)!;
    v.end = 0.3;
    let ended = 0;
    v.onEnd = () => ended++;
    expect(p.count(0.2)).toBe(1);
    expect(p.count(0.31)).toBe(0);
    expect(ended).toBe(1);
  });
  it('release и releaseAll останавливают голоса через onStop', () => {
    const p = new VoicePool();
    let stops = 0;
    for (let i = 0; i < 3; i++) p.acquire(`k${i}`, 'pigVox', 1, 0, 0)!.onStop = () => stops++;
    p.releaseAll(0.1);
    expect(stops).toBe(3);
    expect(p.count(0.1)).toBe(0);
  });
  it('мобильные лимиты меньше десктопных, но не нулевые', () => {
    const m = mobileLimits();
    expect(MAX_VOICES_MOBILE).toBeLessThan(MAX_VOICES);
    for (const k of Object.keys(CAT_LIMIT) as (keyof typeof CAT_LIMIT)[]) {
      expect(m[k]).toBeGreaterThanOrEqual(1);
      expect(m[k]).toBeLessThanOrEqual(CAT_LIMIT[k]);
    }
  });
  it('лимиты — ровно таблица 05-audio §6.1 / 00-summary §1.14 (32 / 20 голосов) + джингл на 1 голос', () => {
    expect([MAX_VOICES, MAX_VOICES_MOBILE]).toEqual([32, 20]);
    expect(CAT_LIMIT).toEqual({ impact: 8, break: 6, birdVox: 2, pigVox: 3, explosion: 4, sling: 2, ability: 3, ui: 4, reward: 6, loop: 3, jingle: 1 });
    expect(mobileLimits()).toEqual({ impact: 5, break: 4, birdVox: 2, pigVox: 2, explosion: 3, sling: 2, ability: 2, ui: 3, reward: 4, loop: 2, jingle: 1 });
  });
  it('взрывы без кулдауна: TNT цепочки на соседних кадрах звучат все (до лимита категории)', () => {
    expect(cooldownFor('boom:tnt', 'explosion')).toBe(0);
    expect(CAT_MIX.explosion.cooldown).toBe(0);
    const p = new VoicePool();
    let n = 0;
    for (let f = 0; f < 4; f++) if (p.acquire('boom:tnt', 'explosion', 5, cooldownFor('boom:tnt', 'explosion'), f / 60)) n++;
    expect(n).toBe(4);
  });
  it('ui/reward: при равной важности новый голос вытесняет самый старый своей категории', () => {
    const p = new VoicePool(MAX_VOICES, mobileLimits());
    const stopped: string[] = [];
    for (let i = 0; i < 4; i++) {
      const v = p.acquire(`star${i}`, 'reward', 10, 0, i * 0.1)!;
      v.onStop = () => stopped.push(v.key);
    }
    expect(p.acquire('tick', 'reward', 10, 0, 0.5)).not.toBeNull();
    expect(stopped).toEqual(['star0']);
    // менее важный не вытесняет
    expect(p.acquire('tick2', 'reward', 5, 0, 0.6)).toBeNull();
    // в остальных категориях равный по важности не вытесняет (05-audio §6.2)
    const q = new VoicePool(MAX_VOICES, { ...CAT_LIMIT, impact: 1 });
    expect(q.acquire('a', 'impact', 1, 0, 0)).not.toBeNull();
    expect(q.acquire('b', 'impact', 1, 0, 0.1)).toBeNull();
  });
  it('жертва кражи — самая неважная, а при равенстве — самая старая', () => {
    const p = new VoicePool(MAX_VOICES, { ...CAT_LIMIT, reward: 3 });
    const stopped: string[] = [];
    for (const [k, sc, t] of [['bell1', 10, 0], ['tick', 5, 0.1], ['bell2', 10, 0.2]] as const) p.acquire(k, 'reward', sc, 0, t)!.onStop = () => stopped.push(k);
    expect(p.acquire('newBest', 'reward', 12, 0, 0.3)).not.toBeNull();
    expect(stopped).toEqual(['tick']);
  });
});

describe('TokenBucket', () => {
  it('всплеск ≤ ёмкости, затем ≤ 40 ударов в секунду', () => {
    const b = new TokenBucket(6, 40);
    let passed = 0;
    // 30 запросов на кадр × 60 кадров (1 с)
    for (let f = 0; f < 60; f++) for (let k = 0; k < 30; k++) if (b.take(f / 60)) passed++;
    expect(passed).toBeLessThanOrEqual(6 + 40);
    expect(passed).toBeGreaterThanOrEqual(40);
  });
  it('пополняется со временем', () => {
    const b = new TokenBucket(2, 10);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(0.1)).toBe(true);
  });
});

describe('selectImpacts', () => {
  it('30 запросов → 4 самых сильных, ≤ 2 на ключ, остальное — overflow', () => {
    const reqs = Array.from({ length: 30 }, (_, i) => ({ key: ['woodHit:1', 'iceHit:1', 'stoneHit:1'][i % 3]!, intensity: (i + 1) / 30, x: 0 }));
    const { play, overflow } = selectImpacts(reqs);
    expect(play).toHaveLength(4);
    const perKey = new Map<string, number>();
    for (const r of play) perKey.set(r.key, (perKey.get(r.key) ?? 0) + 1);
    for (const n of perKey.values()) expect(n).toBeLessThanOrEqual(2);
    expect(play[0]!.intensity).toBe(1);
    const total = reqs.reduce((s, r) => s + r.intensity, 0);
    const played = play.reduce((s, r) => s + r.intensity, 0);
    expect(overflow).toBeCloseTo(total - played, 9);
  });
});

describe('громкость удара и пространство', () => {
  it('I = clamp((J − 0.5)/15, 0, 1), vol = 0.2 + 0.8·I, ярусы 0.3/0.7', () => {
    expect(impactIntensity(0.2)).toBe(0);
    expect(impactIntensity(8)).toBeCloseTo(0.5, 9);
    expect(impactIntensity(100)).toBe(1);
    expect(impactIntensity(Number.NaN)).toBe(0);
    expect(impactVolume(0.5)).toBeCloseTo(0.6, 9);
    expect([tierOf(0.1), tierOf(0.5), tierOf(0.9)]).toEqual([0, 1, 2]);
  });
  it('spatial: внутри экрана 1, край → 1, +viewW → 0.25, +1.5·viewW → 0; панорама ±0.5', () => {
    const W = 20;
    expect(spatial(10, 10, W).gain).toBe(1);
    expect(spatial(10, 10, W).pan).toBe(0);
    expect(spatial(20, 10, W)).toEqual({ gain: 1, pan: 0.5 });
    expect(spatial(30, 10, W).gain).toBeCloseTo(0.25, 9);
    expect(spatial(40, 10, W).gain).toBe(0);
    expect(spatial(-10, 10, W).pan).toBe(-0.5);
    // взрывы слышны дальше (reach 2)
    expect(spatial(40, 10, W, 2).gain).toBeGreaterThan(0);
  });
  it('spatial устойчив к мусору на входе', () => {
    expect(spatial(Number.NaN, 0, 20)).toEqual({ gain: 1, pan: 0 });
    expect(spatial(5, 0, 0)).toEqual({ gain: 1, pan: 0 });
  });
});
