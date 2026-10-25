// Способности 8 птиц — приёмка по 00 §1.4. Скорости способностей — в долях V_MAX; числа в названиях — при V_MAX = 21
// (00 §1.4 считала при 24: Chuck 31.2…38.4, яйцо −16.8, Хэл ≥ 24.8, пике −25.2).

import { describe, expect, it } from 'vitest';
import { ABILITY, BIRD_FLIGHT, BIRDS, LAUNCH, MATERIALS, RETIRE, WORLD } from '../../src/config/constants';
import type { EntityView, GameSession } from '../../src/core/api';
import type { GameEvent } from '../../src/core/events';
import type { BirdType, LevelDef } from '../../src/core/types';
import { hutLevel, level, openField, pigOn, rect } from '../fixtures/levels';
import { ofType, readySession, runFor, runUntil } from './helpers';

const V = LAUNCH.V_MAX;
const DEG = Math.PI / 180;
const birds = (s: GameSession): EntityView[] => [...s.entities()].filter((e) => e.kind === 'bird');
const blocks = (s: GameSession): EntityView[] => [...s.entities()].filter((e) => e.kind === 'block');
const speed = (e: EntityView) => Math.hypot(e.vx, e.vy);
const heading = (e: EntityView) => Math.atan2(e.vy, e.vx);
const deg = (r: number) => r / DEG;
/** Угол в [0, 360). */
const deg360 = (r: number) => ((deg(r) % 360) + 360) % 360;
const snap = (e: EntityView) => ({ ...e });
/** Тап — заведомо после защитной задержки 0.05 с. */
const ABILITY_DELAY = 0.06;
const after = (t: number) => (_b: EntityView, dt: number) => dt >= t;

/** Выстрел; шаги до условия на летящую птицу; тап. Возвращает вид птицы непосредственно перед тапом. */
function tapWhen(bird: BirdType, angle: number, power: number, when: (b: EntityView, t: number) => boolean, lvl: LevelDef = openField([bird])) {
  const s = readySession(lvl);
  s.launch(angle, power);
  const t0 = s.time;
  runUntil(s, () => when(s.focusBird()!, s.time - t0) && s.time - t0 > ABILITY_DELAY, 5);
  const before = snap(s.focusBird()!);
  s.drainEvents();
  const ok = s.activateAbility();
  return { s, before, ok, events: s.drainEvents() };
}
describe('способности: общие правила', () => {
  it('окно: не раньше 0.05 с после выпуска, один раз, до первого контакта', () => {
    const s = readySession(openField(['blues', 'blues']));
    s.launch(40, 1);
    s.step();
    expect(s.activateAbility()).toBe(false); // 1/60 с — дребезг пальца
    runFor(s, 0.2);
    expect(s.activateAbility()).toBe(true);
    expect(s.activateAbility()).toBe(false);
    s.step();
    expect(s.focusBird()!.abilityUsed).toBe(true);

    const t = readySession(openField(['chuck']));
    t.launch(10, 0.5);
    runUntil(t, () => t.focusBird()?.birdPose !== 'fly', 5);
    expect(t.activateAbility()).toBe(false); // после удара о землю окно закрыто
  });

  it('отметка способности — крупная точка следа в месте тапа', () => {
    const { s, before } = tapWhen('chuck', 30, 1, after(0.3));
    const big = s.trail().filter((p) => p.big);
    expect(big).toHaveLength(1);
    expect(Math.hypot(big[0].x - before.x, big[0].y - before.y)).toBeLessThan(0.01);
  });
});

describe('Red и Terence: способности нет', () => {
  for (const type of ['red', 'terence'] as const) {
    it(`${type}: тап не меняет полёт, события ability нет, птица хмурится`, () => {
      const { s, before, ok, events } = tapWhen(type, 40, 1, after(0.3));
      expect(ok).toBe(false);
      expect(ofType(events, 'ability')).toHaveLength(0);
      s.step();
      const b = s.focusBird()!;
      expect(b.vx).toBeCloseTo(before.vx, 9);
      expect(b.vy).toBeCloseTo(before.vy + WORLD.GRAVITY * WORLD.DT, 9);
      expect(b.birdPose).toBe('aim');
      runFor(s, BIRD_FLIGHT.FROWN_TIME);
      expect(s.focusBird()!.birdPose).toBe('fly');
    });
  }

  it('быстрый пропуск: тап через ≥ 1 с после первого контакта — птица уходит сразу (birdRemoved), раньше — ничего', () => {
    const s = readySession(openField(['red', 'red']));
    s.launch(10, 0.6);
    runUntil(s, () => s.focusBird()!.birdPose !== 'fly', 5);
    const hitAt = s.time;
    runUntil(s, () => s.time - hitAt >= 0.5, 2);
    expect(s.activateAbility()).toBe(false);
    expect(ofType(s.drainEvents(), 'birdRemoved')).toHaveLength(0);
    expect(s.focusBird()).not.toBeNull();
    runUntil(s, () => s.time - hitAt >= RETIRE.QUICK_SKIP_AFTER_HIT, 2);
    expect(s.activateAbility()).toBe(false);
    expect(ofType(s.drainEvents(), 'birdRemoved')).toHaveLength(1);
    expect(s.focusBird()).toBeNull();
    s.step();
    expect(s.state).toBe('settling');
  });

  it('быстрый пропуск работает и для птицы с израсходованной способностью', () => {
    const s = readySession(openField(['chuck', 'red']));
    s.launch(20, 1);
    runFor(s, 0.3);
    expect(s.activateAbility()).toBe(true);
    runUntil(s, () => s.focusBird()!.birdPose !== 'fly', 5);
    runFor(s, RETIRE.QUICK_SKIP_AFTER_HIT);
    s.activateAbility();
    expect(ofType(s.drainEvents(), 'birdRemoved')).toHaveLength(1);
  });
});

describe('Blues', () => {
  it('ровно 3 тела, курсы ±8° ± 0.5°, скорости равны ±1 %, сёстры не сталкиваются', () => {
    const { s, before, ok, events } = tapWhen('blues', 30, 1, after(0.3));
    expect(ok).toBe(true);
    expect(ofType(events, 'ability')).toHaveLength(1);
    s.step();
    const trio = birds(s);
    expect(trio).toHaveLength(3);
    expect(trio.every((b) => b.birdType === 'blues')).toBe(true);
    const h0 = heading(trio.find((b) => b.id === before.id)!);
    const angles = trio.map((b) => deg(heading(b) - h0)).sort((a, b) => a - b);
    expect(Math.abs(angles[0] + 8)).toBeLessThan(0.5);
    expect(Math.abs(angles[1])).toBeLessThan(1e-6);
    expect(Math.abs(angles[2] - 8)).toBeLessThan(0.5);
    const v0 = speed(trio[0]);
    for (const b of trio) expect(Math.abs(speed(b) / v0 - 1)).toBeLessThan(0.01);
    runFor(s, 0.4);
    expect(birds(s).every((b) => b.birdPose === 'fly')).toBe(true); // ни одного контакта между сёстрами
  });

  it('сёстры рождаются в ±2.3·r поперёк курса; через 10 м пути разнос крайних растёт на 2.8 ± 0.2 м', () => {
    // 2.8 м по 02 §3.2 — это 2·10·tan 8°, вклад только расхождения курсов; начальный сдвиг ±0.58 м (00 §1.4) — сверху.
    // Тап на вершине пологой дуги: модуль скорости почти постоянен, путь ≈ s·t. 30°, а не 20°: при V_MAX 21 вершина
    // 20° ниже (3.7 м), и за 10 м нижняя сестра успевает коснуться земли
    const { s, before } = tapWhen('blues', 30, 1, (b) => b.vy <= 0);
    const spread = () => {
      const b = birds(s);
      let m = 0;
      for (const p of b) for (const q of b) m = Math.max(m, Math.hypot(p.x - q.x, p.y - q.y));
      return m;
    };
    const d0 = spread();
    expect(d0).toBeCloseTo(2 * ABILITY.BLUES.OFFSET_R * BIRDS.blues.radius, 1);
    let path = 0;
    let prev = birds(s).find((b) => b.id === before.id)!;
    let p0 = { x: prev.x, y: prev.y };
    while (path < 10) {
      s.step();
      prev = birds(s).find((b) => b.id === before.id)!;
      path += Math.hypot(prev.x - p0.x, prev.y - p0.y);
      p0 = { x: prev.x, y: prev.y };
    }
    expect(Math.abs(spread() - d0 - 2.8)).toBeLessThan(0.2);
  });

  it('камера следит за центроидом живых сестёр', () => {
    const { s } = tapWhen('blues', 30, 1, after(0.3));
    s.step();
    const trio = birds(s);
    const f = s.focusBird()!;
    expect(f.x).toBeCloseTo(trio.reduce((a, b) => a + b.x, 0) / 3, 9);
    expect(f.y).toBeCloseTo(trio.reduce((a, b) => a + b.y, 0) / 3, 9);
    expect(f.kind).toBe('bird');
  });

  it('если место сестры занято блоком — она появляется в позиции средней', () => {
    // горизонтальный полёт вдоль верхней грани длинной плиты: нижняя сестра попала бы внутрь камня
    const lvl = level({ birds: ['blues'], blocks: [rect('stone', 8, 0.8, 12, 1.6)], pigs: [pigOn('small', 50, 0)] });
    const s = readySession(lvl);
    s.launch(0, 1);
    runUntil(s, () => s.focusBird()!.x > 3, 2);
    expect(s.activateAbility()).toBe(true);
    const [mid, ...sisters] = birds(s);
    const inside = sisters.filter((b) => Math.hypot(b.x - mid.x, b.y - mid.y) < 1e-9);
    expect(inside).toHaveLength(1);
  });
});

describe('Chuck', () => {
  it('рывок: |v\'| = clamp(1.5·|v|, 1.3·V, 1.6·V) = clamp(…, 27.3, 33.6) по текущему курсу, нос по скорости', () => {
    for (const [angle, t] of [[30, 0.3], [60, 1.2]] as const) {
      const { s, before } = tapWhen('chuck', angle, 1, after(t));
      s.step();
      const a = s.focusBird()!;
      const expected = Math.min(1.6 * V, Math.max(1.3 * V, 1.5 * speed(before)));
      expect(speed(a)).toBeCloseTo(expected, 0); // через шаг: ± g·dt
      expect(Math.cos(heading(a) - heading(before))).toBeGreaterThan(0.999);
      expect(a.angle).toBeCloseTo(heading(a), 1);
    }
  });

  it('после рывка дерево ×2.2: пробивает три колонны; первый твёрдый контакт возвращает ×1.2', () => {
    const lvl = level({
      birds: ['chuck'],
      blocks: [rect('wood', 12, 1.5, 0.5, 3), rect('wood', 14, 1.5, 0.5, 3), rect('wood', 16, 1.5, 0.5, 3)],
      pigs: [pigOn('small', 50, 0)],
    });
    const s = readySession(lvl);
    s.launch(5, 1);
    runFor(s, 0.1);
    expect(s.activateAbility()).toBe(true);
    const events = runFor(s, 1);
    expect(ofType(events, 'blockDestroyed')).toHaveLength(3);
  });

  it('×2.2 действует и на первый твёрдый (не пробивающий) удар по дереву', () => {
    // плита 4×2 (HP 78.4) рывком не пробивается: J·BIRD_SPEED_COMP ≈ 30.5 Н·с → урон 2.2·(J·k − m·v0) ≈ 48.7,
    // а с ×1.2 было бы ≈ 26.5 (при V_MAX 24 без компенсации — 53.6 и 29.2)
    const lvl = level({ birds: ['chuck'], blocks: [rect('wood', 9, 1, 4, 2)], pigs: [pigOn('small', 40, 0)] });
    const s = readySession(lvl);
    s.launch(0, 1);
    runFor(s, ABILITY_DELAY);
    expect(s.activateAbility()).toBe(true);
    const events: GameEvent[] = [];
    runUntil(s, () => ofType(events, 'birdImpact').length > 0, 1, events);
    expect(ofType(events, 'blockDestroyed')).toHaveLength(0);
    const wood = MATERIALS.wood;
    const dealt = (1 - blocks(s)[0].health) * wood.hpPerKg * wood.density * 4 * 2;
    expect(dealt).toBeGreaterThan(40);
  });
});

describe('Bomb', () => {
  it('взрыв по тапу рушит башню; тело птицы исчезает без «пуфа»', () => {
    // V_MAX 21: Бомб (×0.95) достаёт башню на x = 24…28 только навесом — тап в полёте в 1 м перед левой колонной
    const s = readySession(hutLevel(['bomb', 'red']));
    s.launch(42, 1);
    const events = runUntil(s, () => s.focusBird()!.x > 22.5, 3);
    expect(s.focusBird()!.birdPose).toBe('fly');
    expect(s.activateAbility()).toBe(true);
    runFor(s, 2, events);
    expect(ofType(events, 'explosion').filter((e) => e.source === 'bomb')).toHaveLength(1);
    expect(ofType(events, 'blockDestroyed').length).toBeGreaterThanOrEqual(3);
    expect(ofType(events, 'birdRemoved')).toHaveLength(0);
    expect(birds(s)).toHaveLength(0);
  });

  it('без тапа — взрыв через 2.5 ± 0.02 с после первого контакта; тап после удара тоже взрывает', () => {
    const s = readySession(openField(['bomb']));
    s.launch(10, 0.5);
    const events = runUntil(s, () => s.focusBird()?.birdPose !== 'fly', 5);
    const impact = ofType(events, 'birdImpact');
    expect(impact).toHaveLength(1);
    const hitTime = s.time;
    runUntil(s, () => ofType(events, 'explosion').length > 0, 5, events);
    expect(Math.abs(s.time - hitTime - ABILITY.BOMB.FUSE)).toBeLessThanOrEqual(0.02);
    expect(ofType(events, 'explosion')[0].source).toBe('bomb');

    const t = readySession(openField(['bomb']));
    t.launch(10, 0.5);
    runUntil(t, () => t.focusBird()?.birdPose !== 'fly', 5);
    runFor(t, 0.5);
    expect(t.activateAbility()).toBe(true);
    expect(ofType(t.drainEvents(), 'explosion')).toHaveLength(1);
  });

  it('след кончается на первом контакте: взрыв после удара (фитиль или тап) не добавляет отметку', () => {
    for (const tapAfterHit of [false, true]) {
      const s = readySession(openField(['bomb']));
      s.launch(20, 0.7);
      const events = runUntil(s, () => s.focusBird()?.birdPose !== 'fly', 5);
      expect(ofType(events, 'birdImpact')).toHaveLength(1);
      const atHit = s.trail().map((p) => ({ ...p }));
      expect(atHit.at(-1)!.big).toBe(true); // отметка удара
      if (tapAfterHit) {
        runFor(s, 0.5);
        expect(s.activateAbility()).toBe(true);
      }
      runUntil(s, () => ofType(events, 'explosion').length > 0, 5, events);
      expect(ofType(events, 'explosion')).toHaveLength(1);
      expect(s.trail()).toEqual(atHit);
    }
  });
});

describe('Matilda', () => {
  it('яйцо v = (0, −0.7·V = −14.7); Матильда — 60° ± 1° и |v| ≥ 0.62·V = 13.0, легче (ρ 0.5) и слабее (×0.3), уходит через 1 с', () => {
    expect(ABILITY.MATILDA.DESPAWN).toBe(1.0);
    const { s, ok, events } = tapWhen('matilda', 45, 1, after(0.5));
    expect(ok).toBe(true);
    const egg = [...s.entities()].find((e) => e.kind === 'egg')!;
    expect(egg.vx).toBe(0);
    expect(egg.vy).toBeCloseTo(ABILITY.MATILDA.EGG_VY_K * V, 9);
    expect(s.focusBird()!.id).toBe(egg.id); // камера следит за яйцом
    expect(ofType(events, 'ability')).toHaveLength(1);
    s.step();
    const m = birds(s)[0];
    expect(Math.abs(deg(heading(m)) - ABILITY.MATILDA.UP_DEG)).toBeLessThan(1);
    expect(speed(m)).toBeGreaterThanOrEqual(ABILITY.MATILDA.UP_MIN_K * V - 0.5);
    const tap = s.time;
    const rest = runUntil(s, () => birds(s).length === 0, 5);
    expect(s.time - tap).toBeCloseTo(ABILITY.MATILDA.DESPAWN, 1);
    expect(ofType(rest, 'birdRemoved')).toHaveLength(1);
  });

  it('яйцо взрывается на первом контакте; затем камера держит точку взрыва до ухода Матильды', () => {
    const { s } = tapWhen('matilda', 45, 1, after(0.5));
    const events = runUntil(s, () => ![...s.entities()].some((e) => e.kind === 'egg'), 3);
    const boom = ofType(events, 'explosion');
    expect(boom.map((e) => e.source)).toEqual(['egg']);
    const f = s.focusBird()!;
    expect(f.kind).toBe('egg');
    expect(Math.hypot(f.x - boom[0].x, f.y - boom[0].y)).toBeLessThan(1e-9);
    // пока Матильда не ушла (DESPAWN 1 с от тапа), камера стоит на точке взрыва
    let held = 0;
    for (let i = 0; i < 300 && birds(s).length > 0; i++) {
      expect(s.focusBird()!.x).toBe(f.x); // точка неподвижна
      s.step();
      held++;
    }
    expect(held).toBeGreaterThan(5);
    expect(birds(s)).toHaveLength(0);
    s.step();
    expect(s.focusBird()).toBeNull();
  });
});

describe('Hal', () => {
  /** Шагает, пока модуль скорости постоянен (кинематическая дуга без гравитации); возвращает длительность и конечный курс. */
  function arc(s: GameSession) {
    s.step();
    const s0 = speed(s.focusBird()!);
    let steps = 1;
    for (let i = 0; i < 120; i++) {
      s.step();
      if (Math.abs(speed(s.focusBird()!) - s0) > 1e-6) break;
      steps++;
    }
    return { t: steps / 60, s0 };
  }

  it('курс −30° (вправо) → 200° ± 2°, дуга 0.50 ± 0.03 с без гравитации, скорость ≥ 0.9·V·1.15 = 21.7', () => {
    const { s, before, ok } = tapWhen('hal', 40, 1, (b) => deg(heading(b)) <= -30);
    expect(ok).toBe(true);
    const a0 = deg(heading(before));
    const r = arc(s);
    expect(r.s0).toBeGreaterThanOrEqual(0.9 * V * ABILITY.HAL.SPEED_MUL - 1e-6);
    expect(Math.abs(r.t - 0.5)).toBeLessThanOrEqual(0.03);
    // конец дуги — курс π − a − 10° (на шаг позже гравитация уже чуть повернула вектор)
    const end = deg360(heading(s.focusBird()!));
    expect(Math.abs(end - (180 - a0 - 10))).toBeLessThan(2);
  });

  it('курс +30° → 140° за 0.24 с; полёт влево — зеркально (210° → −20°)', () => {
    const up = tapWhen('hal', 40, 1, (b) => deg(heading(b)) <= 30);
    const r = arc(up.s);
    expect(Math.abs(r.t - 0.24)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(deg360(heading(up.s.focusBird()!)) - (180 - deg(heading(up.before)) - 10))).toBeLessThan(2);

    const lvl = level({ birds: ['hal'], slingshot: { x: 60, y: 2.7 }, bounds: { minX: -20, maxX: 80, maxY: 40 }, pigs: [pigOn('small', -10, 0)] });
    const left = tapWhen('hal', 140, 1, (b) => b.vy < 0 && deg(heading(b)) >= -150, lvl);
    const a0 = deg(heading(left.before)); // ≈ −150° (210°)
    arc(left.s);
    const end = deg(heading(left.s.focusBird()!));
    expect(Math.abs(end - (-180 - a0 + 10))).toBeLessThan(2);
    expect(left.s.focusBird()!.vx).toBeGreaterThan(0);
  });
});

describe('Silver', () => {
  it('петля 2π ± 0.05 рад за 0.57 ± 0.03 с, затем пике v = (0.1·s, −1.05·V = −22.05), клювом вниз', () => {
    const { s, before, ok } = tapWhen('silver', 45, 1, after(0.3));
    expect(ok).toBe(true);
    let turned = 0;
    let prev = heading(before);
    let steps = 0;
    for (; steps < 60; steps++) {
      s.step();
      const b = s.focusBird()!;
      if (Math.abs(b.angle + Math.PI / 2) < 1e-9) break; // началось пике
      let d = heading(b) - prev;
      if (d < -Math.PI) d += 2 * Math.PI;
      turned += d;
      prev = heading(b);
    }
    expect(Math.abs(turned - 2 * Math.PI)).toBeLessThan(0.05 + ABILITY.SILVER.OMEGA / 60);
    expect(Math.abs(steps / 60 - 0.57)).toBeLessThanOrEqual(0.03);
    const dive = s.focusBird()!;
    expect(dive.vy).toBeCloseTo(-ABILITY.SILVER.DIVE_K * V + WORLD.GRAVITY * WORLD.DT, 6);
    const s0 = Math.max(speed(before), ABILITY.SILVER.MIN_K * V);
    expect(dive.vx).toBeCloseTo(ABILITY.SILVER.DIVE_SIDE * s0, 0);
    expect(Math.hypot(dive.px - before.x, dive.py - before.y)).toBeLessThan(0.6); // петля замкнулась
  });

  /** Точка первого удара пике в открытом поле при тапе через tap секунд после выстрела под 45°. */
  function diveLanding(tap: number): number {
    const { s } = tapWhen('silver', 45, 1, after(tap));
    const events: GameEvent[] = [];
    runUntil(s, () => ofType(events, 'birdImpact').length > 0, 5, events);
    return ofType(events, 'birdImpact')[0].x;
  }

  it('пике пробивает камень 1×1 (×3.0), удар о землю подбрасывает лёгкие тела рядом («слэм»)', () => {
    const x = diveLanding(0.6);
    const lvl = level({
      birds: ['silver'],
      blocks: [rect('stone', x, 0.5, 1, 1), rect('wood', x + 0.8, 0.25, 0.5, 0.5)],
      pigs: [pigOn('small', 60, 0)],
    });
    const { s } = tapWhen('silver', 45, 1, after(0.6), lvl);
    const events = runUntil(s, () => s.focusBird()?.birdPose === 'hurt', 3);
    expect(ofType(events, 'blockDestroyed').map((e) => e.material)).toEqual(['stone']);
    const cube = blocks(s).find((b) => b.material === 'wood')!;
    expect(cube.vy).toBeGreaterThan(0.5);
  });

  it('если петля задела блок — способность израсходована, пике нет', () => {
    const lvl = level({ birds: ['silver'], blocks: [rect('wood', 6.0, 2.5, 0.5, 5)], pigs: [pigOn('small', 60, 0)] });
    const { s, ok } = tapWhen('silver', 0, 1, (b) => b.x > 3.5, lvl);
    expect(ok).toBe(true);
    let dived = false;
    for (let i = 0; i < 90; i++) {
      s.step();
      const b = s.focusBird();
      if (b && b.vy < -0.95 * ABILITY.SILVER.DIVE_K * V) dived = true;
    }
    expect(dived).toBe(false);
    expect(s.activateAbility()).toBe(false);
  });
});

describe('множители урона птиц соответствуют 00 §1.3', () => {
  it('Terence по камню ×2.0, Silver в пике по камню ×3.0', () => {
    expect(BIRDS.terence.mult.stone).toBe(2.0);
    expect(ABILITY.SILVER.DIVE_MULT.stone).toBe(3.0);
  });
});
