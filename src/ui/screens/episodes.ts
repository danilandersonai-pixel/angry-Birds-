// Выбор эпизода (07 §8): три карточки с пейзажем темы, героями, звёздами и замком.

import type { EpisodeDef } from '../../core/types';
import { episodeStarsNeeded } from '../../storage/progress';
import { episodeArt } from '../art';
import { anim, popIn, shake } from '../anim';
import type { UiCtx, View } from '../ctx';
import { button, focusEl, h, starsPill } from '../dom';
import { icon, starSvg } from '../icons';
import { S, STARS, STARS_ACC, plural, t } from '../strings';

export interface EpisodeState {
  ep: EpisodeDef;
  index: number;
  unlocked: boolean;
  got: number;
  total: number;
  /** Текст требования для закрытого эпизода (полный — для тоста и озвучки, короткий — на карточке). */
  req: string;
  reqShort: string;
}

export function episodeStates(ctx: UiCtx): EpisodeState[] {
  const eps = ctx.deps.episodes;
  return eps.map((ep, i) => {
    const ids = ep.levels.map((l) => l.id);
    const first = ids[0];
    const unlocked = first !== undefined && ctx.deps.progress.isUnlocked(first, ctx.order);
    const got = ctx.deps.progress.starsTotal(ids);
    let req = '';
    let reqShort = '';
    if (i > 0) {
      const prev = eps[i - 1]!;
      const n = episodeStarsNeeded(prev.levels.length);
      req = t('episodeLockedReq', { prev: prev.name, n, stars: plural(n, STARS_ACC) });
      reqShort = t('episodeLockedCard', { n, stars: plural(n, STARS), prev: i });
    }
    return { ep, index: i, unlocked, got, total: ids.length * 3, req, reqShort };
  });
}

export class EpisodesView implements View {
  readonly id = 'episodes' as const;
  readonly el: HTMLElement;
  private readonly cards: HTMLButtonElement[] = [];
  private readonly back: HTMLButtonElement;
  private readonly states: EpisodeState[];

  constructor(
    private readonly ctx: UiCtx,
    focusEpId?: string,
  ) {
    this.states = episodeStates(ctx);
    const totalGot = this.states.reduce((s, e) => s + e.got, 0);
    const total = this.states.reduce((s, e) => s + e.total, 0);
    this.back = button({
      color: 'blue',
      size: 'm',
      icon: 'back',
      label: S.back,
      testid: 'btn-back',
      onClick: () => {
        ctx.sfx('back');
        ctx.goTitle();
      },
    });
    const head = h(
      'header',
      { class: 'scr-head' },
      this.back,
      h('div', { class: 'scr-title' }, h('h1', { class: 'ts', id: 'abui-ep-title', text: S.episodesTitle })),
      starsPill(totalGot, total, `${totalGot} из ${total} звёзд`),
    );
    const row = h('div', { class: 'ep-row', role: 'list' });
    const eps = ctx.deps.episodes;
    for (const st of this.states) {
      const card = this.buildCard(st, eps.slice(0, st.index));
      this.cards.push(card);
      row.append(h('div', { role: 'listitem' }, card));
    }
    this.el = h('section', { class: 'scr scr-episodes', 'aria-labelledby': 'abui-ep-title' }, head, row);
    this.focusId = focusEpId;
  }

  private focusId?: string;

  private buildCard(st: EpisodeState, prev: readonly EpisodeDef[]): HTMLButtonElement {
    const { ep, unlocked } = st;
    const n = st.index + 1;
    const card = h('button', {
      type: 'button',
      class: 'ep-card',
      'data-theme': ep.theme,
      'data-testid': `episode-card-${ep.id}`,
      'data-ep': ep.id,
      'aria-disabled': unlocked ? null : 'true',
      'aria-label': unlocked
        ? t('episodeAria', { n, name: ep.name, got: st.got, total: st.total })
        : t('episodeAriaLocked', { n, name: ep.name, req: st.req }),
    }) as HTMLButtonElement;
    const art = h('span', { class: 'ep-art' }, episodeArt(ep, prev, 300, 236, n * 13));
    const info = h('span', { class: 'ep-info' });
    info.append(h('span', { class: 'ep-num ts', text: t('episodeNum', { n }) }), h('span', { class: 'ep-name ts', text: ep.name }));
    if (unlocked) {
      const stars = h('span', { class: 'ep-stars' });
      stars.insertAdjacentHTML('beforeend', starSvg('full'));
      stars.append(h('span', { class: 'num ts', text: t('starsOf', { got: st.got, total: st.total }) }));
      const prog = h('span', { class: 'ep-prog' }, h('i', { style: `transform: scaleX(${(st.got / Math.max(1, st.total)).toFixed(3)})` }));
      info.append(stars, prog);
      if (st.got >= st.total && st.total > 0) {
        card.dataset.complete = '1';
        const crown = h('span', { class: 'ep-crown' });
        for (let i = 0; i < 3; i++) crown.insertAdjacentHTML('beforeend', starSvg('full'));
        art.append(crown);
      }
    } else {
      art.append(h('span', { class: 'ep-lock', html: `<span class="btn btn--gray">${icon('lock')}</span>` }));
      info.append(h('span', { class: 'ep-req ts', text: st.reqShort }));
    }
    card.append(art, info);
    card.addEventListener('click', () => {
      if (!unlocked) {
        this.ctx.sfx('back');
        shake(card);
        this.ctx.toast(st.req || S.episodeLockedShort);
        return;
      }
      this.ctx.sfx('click');
      this.ctx.goLevels(ep.id, 'fwd');
    });
    return card;
  }

  enter(): void {
    this.cards.forEach((c, i) => popIn(c.parentElement!, 80 + i * 60));
    // открытие эпизода (07 §8.3): только если в этой сессии его уже видели закрытым
    for (const st of this.states) {
      const key = `ep:${st.ep.id}`;
      if (!st.unlocked) this.ctx.seenLocked.add(key);
      else if (this.ctx.seenLocked.delete(key)) this.playUnlock(this.cards[st.index]!);
    }
  }

  private playUnlock(card: HTMLElement): void {
    const cv = card.querySelector<HTMLElement>('.ep-art-cv');
    if (!cv) return;
    const lock = h('span', { class: 'ep-lock', html: `<span class="btn btn--gray">${icon('lock')}</span>` });
    card.querySelector('.ep-art')?.append(lock);
    anim(cv, [{ filter: 'grayscale(1) brightness(0.72)' }, { filter: 'none' }], { duration: 600, delay: 700, fill: 'backwards' });
    const a = anim(
      lock,
      [
        { transform: 'translate(-50%, -50%) rotate(0)', offset: 0 },
        { transform: 'translate(-50%, -50%) rotate(-6deg)', offset: 0.1 },
        { transform: 'translate(-50%, -50%) rotate(6deg)', offset: 0.2 },
        { transform: 'translate(-50%, -50%) rotate(-6deg)', offset: 0.3 },
        { transform: 'translate(-50%, -50%) rotate(0)', offset: 0.45, opacity: 1 },
        { transform: 'translate(-50%, -160%) rotate(25deg)', opacity: 0 },
      ],
      { duration: 1000, delay: 350, easing: 'ease-in', fill: 'forwards' },
    );
    a?.finished.then(
      () => {
        lock.remove();
        this.ctx.sfx('star2');
        this.ctx.toast(t('episodeUnlocked', { name: card.querySelector('.ep-name')?.textContent ?? '' }));
      },
      () => lock.remove(),
    );
  }

  focus(): void {
    const byId = this.focusId ? this.cards.find((c) => c.dataset.ep === this.focusId) : undefined;
    const lastOpen = [...this.cards].reverse().find((c) => c.getAttribute('aria-disabled') !== 'true');
    focusEl(byId ?? lastOpen ?? this.cards[0]);
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      this.back.click();
      return true;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const i = this.cards.indexOf(document.activeElement as HTMLButtonElement);
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      const j = i < 0 ? 0 : Math.max(0, Math.min(this.cards.length - 1, i + d));
      focusEl(this.cards[j]);
      return true;
    }
    return false;
  }
}
