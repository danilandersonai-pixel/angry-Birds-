// Экраны результата: победа (07 §12) и поражение (07 §13).
// Победа: лента «Уровень пройден!», звёзды по очереди с «бумом» и искрами, подсчёт очков с тиканьем,
// «Новый рекорд!» с конфетти. Поражение: красная лента и свинья, хохочущая до слёз.
// Анимации — только «композиторные»: opacity и translate / scale / rotate (у HTML-элементов — отдельными свойствами,
// у SVG — через transform: отдельные свойства на SVG Chromium не уводит на композитор). Закончившиеся анимации
// снимает anim() — иначе бесконечные «пульс» и «качание» остаются на главном потоке (плейтест №2, Б10).

import { characterCanvas } from '../art';
import { CSS_EASE, Timeline, anim, done, motion, popIn } from '../anim';
import type { OverlayView, UiCtx } from '../ctx';
import { appendAll, button, fitInto, focusEl, h, ribbon, withStarIcons } from '../dom';
import { confetti, starBoom } from '../fx';
import { starSvg } from '../icons';
import { S, STARS, fmt, pickTaunt, plural, t } from '../strings';
import { episodeGate, gateText } from '../rules';

export interface WinResult {
  levelId: string;
  score: number;
  /**
   * Рекорд ДО этой победы (progress.saveResult → prevBest; 0 — первая победа). Показывается строкой «Рекорд: …»,
   * пока не побит; при newRecord и при 0 строки нет — итог не выдаётся заранее, пока счёт крутится от нуля.
   */
  best: number;
  stars: number;
  newRecord: boolean;
  hasNext: boolean;
}

/** Тайминги победы (07 §12.5). */
const WIN_T = {
  full: { star: [0.5, 0.95, 1.4], starLead: 0.19, rollGap: 0.25, roll: 1.2, buttonsAt: 0.3, enableAfterStar: 0.3 },
  reduced: { star: [0.3, 0.55, 0.8], starLead: 0, rollGap: 0.15, roll: 0.5, buttonsAt: 0.15, enableAfterStar: 0.15 },
} as const;

const STAR_SFX = ['star1', 'star2', 'star3'] as const;

/** Как открыть оверлей результата. */
export interface ResultOpts {
  /** Где на экране была лента-баннер (07 §12.1–12.2): лента панели перелетит из этого места (FLIP), а не упадёт сверху. */
  ribbonFrom?: DOMRect;
}

interface Frame {
  el: HTMLElement;
  backdrop: HTMLElement;
  res: HTMLElement;
  rib: HTMLElement;
  panel: HTMLElement;
  /** Вписать .res в окно (CSS scale) — синхронно; дальше следит ResizeObserver. */
  fit: () => void;
  unfit: () => void;
}


/**
 * Общий каркас оверлея результата: затемнение + центр с лентой и панелью; панель с лентой вписывается в окно.
 * below — подпись под панелью (например, «Коснитесь, чтобы пропустить»): видна, только если под панелью есть место.
 */
function frame(kind: 'win' | 'lose', title: string, testid: string, below?: HTMLElement): Frame {
  const backdrop = h('div', { class: 'ov-backdrop' });
  const rib = ribbon(kind, title, `abui-res-title`);
  const panel = h('div', { class: 'panel res-panel' });
  const res = h('div', { class: `res res--${kind}` }, rib, panel);
  const center = h('div', { class: 'ov-center' }, res);
  const el = h(
    'div',
    { class: `ov ov-${kind}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'abui-res-title', 'data-testid': testid },
    backdrop,
    center,
    below,
  );
  const fitter = fitInto(res, center, () => {
    if (!below) return;
    const cs = getComputedStyle(below);
    const need = (parseFloat(cs.bottom) || 0) + parseFloat(cs.fontSize) * 1.25 + 6; // подпись прижата к низу окна
    below.hidden = el.getBoundingClientRect().bottom - res.getBoundingClientRect().bottom < need;
  });
  return { el, backdrop, res, rib, panel, fit: fitter.fit, unfit: fitter.dispose };
}

/** Подпись «1-3 · Название» вверху панели — одинаково на победе и поражении. */
function levelCaption(ctx: UiCtx, levelId: string): HTMLElement | null {
  const loc = ctx.loc(levelId);
  return loc ? h('div', { class: 'res-level ts', 'data-testid': 'results-level' }, h('span', { class: 'num', text: loc.level.id }), ` · ${loc.level.name}`) : null;
}

function enterFrame(f: Frame, from?: DOMRect): void {
  f.fit();
  const { backdrop, panel, rib, res } = f;
  anim(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: 'backwards' });
  if (motion.reduced) {
    anim(res, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: 'backwards' });
    return;
  }
  anim(panel, [{ translate: '0 110vh' }, { translate: '0 0' }], { duration: 420, easing: CSS_EASE.back, fill: 'backwards' });
  if (from && from.width > 0) {
    // FLIP: та же лента перелетает из баннера в заголовок панели (07 §12.2), 0.35 с ease-in-out
    const to = rib.getBoundingClientRect();
    const k = Number(res.style.scale) || 1; // смещение — в координатах ленты (внутри масштабированного .res)
    const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / k;
    const dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / k;
    const s = from.width / Math.max(1, to.width);
    anim(rib, [{ translate: `${dx.toFixed(1)}px ${dy.toFixed(1)}px`, scale: s.toFixed(3) }, { translate: '0 0', scale: '1' }], {
      duration: 350,
      easing: CSS_EASE.inout,
      fill: 'backwards',
    });
    return;
  }
  anim(
    rib,
    [
      { translate: '0 -60vh', scale: '.8', opacity: 0 },
      { translate: '0 0', scale: '1.06', opacity: 1, offset: 0.7 },
      { translate: '0 0', scale: '1', opacity: 1 },
    ],
    { duration: 480, delay: 80, easing: CSS_EASE.out, fill: 'backwards' },
  );
}

async function leaveFrame(el: HTMLElement): Promise<void> {
  const a = anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: motion.reduced ? 100 : 180, easing: 'linear', fill: 'forwards' });
  await done(a);
}

// ───────────────────────── победа ─────────────────────────

export class WinView implements OverlayView {
  readonly kind = 'win' as const;
  readonly el: HTMLElement;
  private readonly f: Frame;
  private readonly panel: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly scoreEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly btns: HTMLButtonElement[] = [];
  private readonly primary: HTMLButtonElement;
  private readonly skipHint: HTMLElement;
  private tl: Timeline | null = null;
  private lastTick = 0;
  private finished = false;
  private readonly r: WinResult;

  constructor(
    private readonly ctx: UiCtx,
    r: WinResult,
    private readonly opts: ResultOpts = {},
  ) {
    this.r = { ...r, stars: Math.max(0, Math.min(3, Math.round(r.stars))), score: Math.max(0, Math.floor(r.score)) };
    this.skipHint = h('div', { class: 'res-skip ts', text: S.winTapSkip, 'aria-hidden': 'true' });
    const f = frame('win', S.winBanner, 'results-won', this.skipHint);
    this.f = f;
    this.el = f.el;
    this.panel = f.panel;

    const stars = h('div', { class: 'res-stars', role: 'img', 'aria-label': `${this.r.stars} ${plural(this.r.stars, STARS)} из 3` });
    for (let i = 0; i < 3; i++) {
      const slot = h('div', { class: `res-star s${i}`, 'data-star': i, 'data-earned': i < this.r.stars ? '1' : '0', 'data-testid': `results-star-${i + 1}` });
      slot.innerHTML = starSvg('empty') + starSvg('full');
      stars.append(slot);
      this.slots.push(slot);
    }
    this.scoreEl = h('div', { class: 'res-score num ts', 'data-testid': 'results-score', text: '0' });
    // рекорд до этой победы (плейтест №2, Б6): при новом рекорде строку заменит бейдж, при первой победе (0) — пусто
    const shownBest = this.r.newRecord ? 0 : Math.max(0, Math.floor(this.r.best));
    this.bestEl = h('div', { class: 'res-best', text: shownBest > 0 ? t('winBest', { score: fmt(shownBest) }) : '' });
    this.badge = h('div', { class: 'badge-best ts', 'data-testid': 'new-best', text: S.winNewBest, style: 'visibility:hidden' });

    const loc = ctx.loc(this.r.levelId);
    const menu = button({ color: 'blue', size: 'm', icon: 'menu', label: S.winMenu, testid: 'results-levels', onClick: () => this.act(() => ctx.quit(menu), 'back') });
    const again = button({ color: 'orange', size: 'm', icon: 'restart', label: S.winRestart, testid: 'results-restart', onClick: () => this.act(() => ctx.restart()) });
    this.btns.push(menu, again);
    let msg = '';
    let next: HTMLButtonElement | null = null;
    if (this.r.hasNext) {
      next = button({ color: 'green', size: 'l', icon: 'next', label: S.winNext, testid: 'results-next', onClick: () => this.act(() => ctx.next(next!)) });
      this.btns.push(next);
    } else if (loc) {
      const idx = ctx.order.indexOf(this.r.levelId);
      const nextId = ctx.order[idx + 1];
      const nextLoc = nextId ? ctx.loc(nextId) : undefined;
      if (!nextLoc) msg = S.winAllDone;
      else if (nextLoc.episode.id !== loc.episode.id) {
        // та же причина, что на карточке эпизода; если эпизод на деле открыт — сообщения нет
        msg = gateText(episodeGate(ctx.deps.progress, ctx.deps.episodes, ctx.order, nextLoc.epIndex), 'win', nextLoc.episode.name);
      }
    }
    this.primary = next ?? again;
    for (const b of this.btns) b.setAttribute('aria-disabled', 'true');

    appendAll(
      this.panel,
      h('div', { class: 'res-rays-clip', 'aria-hidden': 'true' }, h('div', { class: 'res-glow' }), h('div', { class: 'res-rays' })),
      levelCaption(ctx, this.r.levelId),
      stars,
      h('div', { class: 'res-label', text: S.winScore }),
      this.scoreEl,
      h('div', { class: 'res-best-row' }, this.bestEl, this.badge),
      ...(msg ? [withStarIcons(h('div', { class: 'res-msg', 'data-testid': 'results-msg' }), msg)] : []),
      h('div', { class: 'res-btns' }, ...this.btns),
    );
    // тап мимо кнопок — пропустить анимацию
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn:not([aria-disabled="true"])')) return;
      this.skip();
    });
  }

  /** Нажатие кнопки во время анимации доводит таймлайн до конца и сразу выполняет действие (07 §12.3). */
  private act(fn: () => void, sound: 'click' | 'back' = 'click'): void {
    if (!this.finished) this.skip();
    this.ctx.sfx(sound);
    fn();
  }

  enter(): void {
    enterFrame(this.f, this.opts.ribbonFrom);
    this.ctx.sfx('win');
    const T = motion.reduced ? WIN_T.reduced : WIN_T.full;
    const tl = new Timeline();
    this.tl = tl;
    this.btns.forEach((b, i) => popIn(b, T.buttonsAt * 1000 + i * 60));
    T.star.forEach((land, i) => {
      const earned = i < this.r.stars;
      const slot = this.slots[i]!;
      tl.at(Math.max(0, land - T.starLead), (skipped) => {
        if (!earned || skipped) return;
        this.flyStar(slot, i);
      });
      tl.at(land, (skipped) => {
        if (earned) {
          slot.classList.add('is-set');
          if (skipped && i !== this.r.stars - 1) return; // при пропуске — один «бум» на последнюю звезду
          starBoom(slot);
          if (i === 2) this.bigFinish();
          this.ctx.sfx(STAR_SFX[i]!);
          if (!skipped && typeof navigator !== 'undefined' && matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(15);
        } else if (!skipped && !motion.reduced) {
          anim(slot, [{ scale: '1' }, { scale: '.9' }, { scale: '1' }], { duration: 150 });
        }
      });
    });
    tl.at(T.star[2] + T.enableAfterStar, () => this.enableButtons());
    const r0 = T.star[2] + T.rollGap;
    tl.tween(r0, T.roll, (k) => {
      this.scoreEl.textContent = fmt(Math.round(this.r.score * (1 - (1 - k) ** 3)));
      const now = performance.now();
      if (k < 1 && now - this.lastTick > 60) {
        this.lastTick = now;
        this.ctx.sfx('tick');
      }
    });
    tl.at(r0 + T.roll, (skipped) => {
      this.scoreEl.textContent = fmt(this.r.score);
      if (this.r.newRecord) this.showBadge(!skipped);
    });
    tl.at(r0 + T.roll + 0.3, () => {
      this.primary.classList.add('pulse');
      this.finished = true;
      this.skipHint.style.opacity = '0';
    });
    tl.onFinish = () => {
      this.finished = true;
    };
    tl.play();
    const s = this.r.stars;
    this.ctx.announce(t('a11yWon', { id: this.r.levelId, s, stars: plural(s, STARS), score: fmt(this.r.score) }));
  }

  /** Полёт звезды в слот: сверху, крупно, с поворотом и перелётом (07 §12.4). */
  private flyStar(slot: HTMLElement, i: number): void {
    const full = slot.querySelector<SVGElement>('.star--full');
    if (!full) return;
    slot.classList.add('is-set');
    if (motion.reduced) {
      anim(full, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 120, fill: 'backwards' });
      return;
    }
    const rot = i === 0 ? -10 : i === 2 ? 10 : 0;
    anim(
      full,
      [
        // цель — <svg>: transform, а не отдельные свойства (см. шапку)
        { transform: `translateY(calc(-60 * var(--u))) scale(2.4) rotate(${-35 - rot}deg)`, opacity: 0, easing: CSS_EASE.out },
        { transform: 'scale(.88) rotate(4deg)', opacity: 1, offset: 0.45, easing: CSS_EASE.out },
        { transform: 'scale(1.14) rotate(-2deg)', offset: 0.65 },
        { transform: 'scale(.97)', offset: 0.82 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 420, fill: 'backwards' },
    );
  }

  /** Третья звезда: конфетти и вздрагивание панели. */
  private bigFinish(): void {
    if (motion.reduced) return;
    confetti(this.slots[2]!, 6);
    confetti(this.slots[1]!, 6);
    anim(
      this.panel,
      [{ translate: '0 0' }, { translate: '0 calc(6 * var(--u))' }, { translate: '0 calc(-3 * var(--u))' }, { translate: '0 0' }],
      { duration: 180 },
    );
  }

  private showBadge(animate: boolean): void {
    this.badge.style.visibility = 'visible';
    // стиль — сейчас: анимации бейджа и конфетти в нём, запущенные по ещё скрытому элементу, не уходят на композитор
    void getComputedStyle(this.badge).visibility;
    this.bestEl.textContent = '';
    this.ctx.sfx('newRecord');
    if (animate && !motion.reduced) {
      const a = anim(
        this.badge,
        [
          { scale: '2.2', opacity: 0 },
          { scale: '.9', opacity: 1, offset: 0.7 },
          { scale: '1', opacity: 1 },
        ],
        { duration: 300, easing: CSS_EASE.out },
      );
      void done(a).then(() => this.badge.classList.add('is-swing'));
      confetti(this.badge, 30, 1.2);
    } else {
      this.badge.classList.add('is-swing');
    }
  }

  private enableButtons(): void {
    for (const b of this.btns) b.removeAttribute('aria-disabled');
    if (this.el.contains(document.activeElement) || document.activeElement === document.body) focusEl(this.primary);
  }

  /** Пропуск анимации: всё в финальное состояние. */
  skip(): void {
    if (!this.tl || this.tl.finished) return;
    this.tl.skip();
    for (const a of this.el.getAnimations({ subtree: true })) {
      const it = a.effect?.getTiming().iterations;
      if (it !== Infinity) a.finish();
    }
    this.finished = true;
  }

  /** Для предпросмотра: финальное состояние без частиц. */
  finish(): void {
    const reduced = motion.reduced;
    motion.reduced = true; // без частиц и «бумов»
    this.skip();
    motion.reduced = reduced;
    for (const fx of this.el.querySelectorAll('.fx')) fx.remove();
    this.badge.classList.toggle('is-swing', this.r.newRecord);
  }

  leave(): Promise<void> {
    this.tl?.stop();
    return leaveFrame(this.el);
  }

  relayout(): void {
    this.f.fit();
  }

  focus(): void {
    if (this.finished) {
      focusEl(this.primary);
      return;
    }
    // пока идёт анимация — фокус на панели: Enter/Пробел пропускают таймлайн
    this.panel.tabIndex = -1;
    focusEl(this.panel);
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === ' ' || e.key === 'Enter') {
      if (!this.finished) {
        this.skip();
        return true;
      }
      const a = document.activeElement;
      if (a instanceof HTMLButtonElement && this.el.contains(a)) return false; // кнопка в фокусе сработает сама
      this.primary.click();
      return true;
    }
    if (e.code === 'KeyN' && this.r.hasNext) {
      this.btns[2]?.click();
      return true;
    }
    if (e.code === 'KeyR') {
      this.act(() => this.ctx.restart());
      return true;
    }
    if (e.code === 'KeyL' || e.key === 'Escape') {
      this.btns[0]?.click();
      return true;
    }
    return false;
  }

  destroy(): void {
    this.tl?.stop();
    this.f.unfit();
  }
}

// ───────────────────────── поражение ─────────────────────────

const TEAR = '<svg class="tear" viewBox="-1 -1 14 20"><path d="M6 0C6 0 0 7 0 10.5a6 6 0 0 0 12 0C12 7 6 0 6 0z"/></svg>';

/** Данные поражения для панели (07 §13.2). */
export interface LoseResult {
  levelId: string;
  /** Совет (после трёх поражений подряд); при совете дразнилку не показываем — экономим высоту. */
  tip?: string;
  /** Счёт попытки: «Счёт: 23 450». */
  score?: number;
  /** Сколько свиней осталось: по нему (и по счёту) выбирается дразнилка — «Почти получилось!» только при одной. */
  pigsLeft?: number;
}

export class LoseView implements OverlayView {
  readonly kind = 'lose' as const;
  readonly el: HTMLElement;
  private readonly f: Frame;
  private readonly pigBox: HTMLElement;
  private readonly retry: HTMLButtonElement;
  private readonly menu: HTMLButtonElement;
  private tearTimer = 0;
  private pulseTimer = 0;
  private tearSide = 0;

  constructor(
    private readonly ctx: UiCtx,
    r: LoseResult,
    private readonly opts: ResultOpts = {},
  ) {
    const f = frame('lose', S.loseBanner, 'results-lost');
    this.f = f;
    this.el = f.el;
    this.pigBox = h('div', { class: 'lose-pig', 'aria-hidden': 'true' }, h('div', { class: 'lose-shadow' }), characterCanvas('pig', 'medium', 'laugh', 82));
    this.menu = button({
      color: 'blue',
      size: 'm',
      icon: 'menu',
      label: S.loseMenu,
      testid: 'results-levels',
      onClick: () => {
        ctx.sfx('back');
        ctx.quit(this.menu);
      },
    });
    this.retry = button({
      color: 'green',
      size: 'l',
      icon: 'restart',
      label: S.loseRetry,
      testid: 'results-restart',
      cls: 'btn-retry',
      onClick: () => {
        ctx.sfx('click');
        ctx.restart();
      },
    });
    const tip = r.tip;
    const score = r.score !== undefined && Number.isFinite(r.score) ? Math.max(0, Math.floor(r.score)) : null;
    appendAll(
      f.panel,
      levelCaption(ctx, r.levelId),
      this.pigBox,
      tip ? null : h('div', { class: 'lose-taunt', 'data-testid': 'lose-taunt', text: pickTaunt({ pigsLeft: r.pigsLeft, score: r.score }) }),
      score !== null ? h('div', { class: 'lose-score', 'data-testid': 'results-score' }, `${S.winScore}: `, h('span', { class: 'num', text: fmt(score) })) : null,
      tip ? h('div', { class: 'lose-tip', 'data-testid': 'lose-tip' }, h('b', { text: `${S.loseTipPrefix} ` }), tip) : null,
      h('div', { class: 'res-btns' }, this.menu, this.retry),
    );
  }

  enter(): void {
    enterFrame(this.f, this.opts.ribbonFrom);
    this.ctx.sfx('lose');
    this.ctx.announce(S.a11yLost);
    const pig = this.pigBox.querySelector('.char');
    if (pig)
      anim(
        pig.parentElement!,
        [
          { scale: '0', opacity: 0 },
          { scale: '1.1', opacity: 1, offset: 0.7 },
          { scale: '1', opacity: 1 },
        ],
        { duration: motion.reduced ? 120 : 350, delay: 250, easing: CSS_EASE.out, fill: 'backwards' },
      );
    popIn(this.menu, 550);
    // «пульс» — после pop-in, не поверх него: две анимации масштаба на одной кнопке Chromium держит на главном потоке
    const pop = popIn(this.retry, 610);
    this.pulseTimer = window.setTimeout(() => void done(pop).then(() => this.retry.isConnected && this.retry.classList.add('pulse')), 900);
    if (!motion.reduced) this.tearTimer = window.setTimeout(() => this.tear(), 700);
  }

  /** Слеза смеха: из глаза по дуге наружу и вниз (07 §13.2). */
  private tear(): void {
    const side = (this.tearSide = 1 - this.tearSide) === 0 ? -1 : 1;
    const t0 = h('div', { html: TEAR, style: 'position:absolute;inset:0;pointer-events:none' });
    const svg = t0.firstElementChild as HTMLElement;
    svg.style.left = `calc(50% + ${side * 30}% - 8 * var(--u))`;
    svg.style.top = '38%';
    this.pigBox.append(t0);
    const a = anim(
      svg,
      [
        // цель — <svg>: transform (см. шапку)
        { transform: 'translate(0,0) scale(.4)', opacity: 0 },
        { transform: `translate(calc(${side * 18} * var(--u)), calc(-6 * var(--u))) scale(1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(calc(${side * 34} * var(--u)), calc(30 * var(--u))) scale(1)`, opacity: 1, offset: 0.7 },
        { transform: `translate(calc(${side * 40} * var(--u)), calc(52 * var(--u))) scale(.8)`, opacity: 0 },
      ],
      { duration: 700, easing: 'ease-in' },
    );
    void done(a).then(() => t0.remove());
    this.tearTimer = window.setTimeout(() => this.tear(), 900);
  }

  leave(): Promise<void> {
    window.clearTimeout(this.tearTimer);
    window.clearTimeout(this.pulseTimer);
    return leaveFrame(this.el);
  }

  relayout(): void {
    this.f.fit();
  }

  finish(): void {
    for (const a of this.el.getAnimations({ subtree: true })) if (a.effect?.getTiming().iterations !== Infinity) a.finish();
    this.retry.classList.add('pulse');
  }

  focus(): void {
    focusEl(this.retry);
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.code === 'KeyR' || ((e.key === ' ' || e.key === 'Enter') && !(document.activeElement instanceof HTMLButtonElement))) {
      this.retry.click();
      return true;
    }
    if (e.code === 'KeyL' || e.key === 'Escape') {
      this.menu.click();
      return true;
    }
    return false;
  }

  destroy(): void {
    window.clearTimeout(this.tearTimer);
    window.clearTimeout(this.pulseTimer);
    this.f.unfit();
  }
}
