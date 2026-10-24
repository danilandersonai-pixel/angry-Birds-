// Выбор уровня (07 §9): сетка 5×2 плиток с номером, звёздами под ним, замками; текущий уровень пульсирует.

import type { EpisodeDef } from '../../core/types';
import { episodeStarsNeeded } from '../../storage/progress';
import { anim, popIn, shake } from '../anim';
import type { UiCtx, View } from '../ctx';
import { button, focusEl, h, starsPill } from '../dom';
import { icon, starSvg } from '../icons';
import { S, STARS, fmt, plural, t } from '../strings';

const COLS = 5;

interface TileInfo {
  id: string;
  n: number;
  unlocked: boolean;
  stars: number;
  best: number;
  current: boolean;
}

export class LevelsView implements View {
  readonly id = 'levels' as const;
  readonly el: HTMLElement;
  readonly key: string;
  private readonly tiles: HTMLButtonElement[] = [];
  private readonly infos: TileInfo[] = [];
  private readonly back: HTMLButtonElement;
  private readonly unlockNow: number[] = [];

  constructor(
    private readonly ctx: UiCtx,
    private readonly ep: EpisodeDef,
    private readonly focusLevelId?: string,
  ) {
    this.key = ep.id;
    const p = ctx.deps.progress;
    const ids = ep.levels.map((l) => l.id);
    let currentFound = false;
    ep.levels.forEach((lv, i) => {
      const rec = p.record(lv.id);
      const unlocked = p.isUnlocked(lv.id, ctx.order);
      const current = unlocked && !rec && !currentFound;
      if (current) currentFound = true;
      this.infos.push({ id: lv.id, n: i + 1, unlocked, stars: rec?.stars ?? 0, best: rec?.best ?? 0, current });
    });
    const got = p.starsTotal(ids);
    const total = ids.length * 3;
    const epIndex = ctx.deps.episodes.indexOf(ep);

    this.back = button({
      color: 'blue',
      size: 'm',
      icon: 'back',
      label: S.back,
      testid: 'btn-back',
      onClick: () => {
        ctx.sfx('back');
        ctx.goEpisodes('back');
      },
    });
    const head = h(
      'header',
      { class: 'scr-head' },
      this.back,
      h(
        'div',
        { class: 'scr-title' },
        h('span', { class: 'sub ts', text: t('episodeNum', { n: epIndex + 1 }) }),
        h('h1', { class: 'ts', id: 'abui-lv-title', text: ep.name }),
      ),
      starsPill(got, total, `${got} из ${total} звёзд`),
    );

    const grid = h('div', { class: 'lv-grid', role: 'grid', 'aria-labelledby': 'abui-lv-title' });
    const row = (): HTMLElement => h('div', { role: 'row', style: 'display: contents' });
    let r = row();
    this.infos.forEach((info, i) => {
      if (i > 0 && i % COLS === 0) {
        grid.append(r);
        r = row();
      }
      const tile = this.buildTile(info);
      this.tiles.push(tile);
      r.append(tile.closest('.tile-wrap') ?? tile);
    });
    grid.append(r);

    this.el = h(
      'section',
      { class: 'scr scr-levels', 'aria-labelledby': 'abui-lv-title', 'data-theme': ep.theme },
      head,
      grid,
      this.footer(got, epIndex),
    );

    // какие плитки открылись с прошлого показа в этой сессии
    this.infos.forEach((info, i) => {
      const key = `lv:${info.id}`;
      if (!info.unlocked) ctx.seenLocked.add(key);
      else if (ctx.seenLocked.delete(key)) this.unlockNow.push(i);
    });
  }

  private footer(got: number, epIndex: number): HTMLElement {
    const eps = this.ctx.deps.episodes;
    const ids = this.ep.levels.map((l) => l.id);
    const total = ids.length * 3;
    const allCleared = ids.every((id) => (this.ctx.deps.progress.record(id)?.stars ?? 0) > 0);
    const nextEp = eps[epIndex + 1];
    let text = '';
    if (nextEp) {
      const need = episodeStarsNeeded(ids.length);
      const nextOpen = nextEp.levels[0] ? this.ctx.deps.progress.isUnlocked(nextEp.levels[0].id, this.ctx.order) : false;
      if (nextOpen) text = t('levelsNextOpen', { name: nextEp.name });
      else if (got < need) text = t('levelsToNextEp', { n: need - got, stars: plural(need - got, STARS) });
      else if (!allCleared) text = t('levelsFinishLast', { id: ids[ids.length - 1] ?? '' });
    } else if (allCleared) {
      text = got >= total ? S.levelsEpPerfect : S.levelsEpDone;
    }
    const foot = h('p', { class: 'lv-foot ts' });
    if (text) foot.textContent = text;
    return foot;
  }

  private buildTile(info: TileInfo): HTMLButtonElement {
    const color = !info.unlocked ? 'gray' : info.current ? 'orange' : 'blue';
    const label = !info.unlocked
      ? t('levelsAriaLocked', { id: info.id })
      : info.stars > 0
        ? t('levelsAria', { id: info.id, s: info.stars, score: fmt(info.best) })
        : t('levelsAriaNew', { id: info.id });
    const tile = button({ color, size: 'm', label, testid: `level-tile-${info.id}`, cls: 'tile' });
    tile.title = '';
    tile.dataset.level = info.id;
    tile.dataset.locked = String(!info.unlocked);
    tile.dataset.stars = String(info.stars);
    tile.tabIndex = -1;
    if (info.unlocked) tile.append(h('span', { class: 'tile-num num', text: String(info.n) }));
    else tile.insertAdjacentHTML('beforeend', icon('lock'));
    const wrap = h('div', { class: `tile-wrap${info.current ? ' is-current' : ''}`, role: 'gridcell' }, h('div', { class: 'tile-pulse' }, tile));
    if (info.unlocked) {
      const st = h('span', { class: 'tile-stars', 'aria-hidden': 'true' });
      for (let i = 0; i < 3; i++) st.insertAdjacentHTML('beforeend', starSvg(i < info.stars ? 'full' : 'empty', `s${i}`));
      wrap.append(st);
      wrap.append(h('span', { class: 'tile-tip', 'aria-hidden': 'true', text: info.stars > 0 ? t('levelsBest', { score: fmt(info.best) }) : S.levelsNotCleared }));
    }
    tile.addEventListener('click', () => {
      if (tile.dataset.locked === 'true') {
        this.ctx.sfx('back');
        shake(wrap);
        const idx = this.ctx.order.indexOf(info.id);
        const prev = idx > 0 ? this.ctx.order[idx - 1]! : info.id;
        const prevLoc = this.ctx.loc(prev);
        const msg =
          prevLoc && prevLoc.episode.id !== this.ep.id
            ? (this.el.querySelector('.lv-foot')?.textContent ?? '') || t('levelsLocked', { prev })
            : t('levelsLocked', { prev });
        this.ctx.toast(msg);
        return;
      }
      this.ctx.sfx('click');
      this.ctx.playLevel(info.id, tile);
    });
    return tile;
  }

  enter(): void {
    this.tiles.forEach((tile, i) => {
      const wrap = tile.closest('.tile-wrap')!;
      popIn(wrap, 60 + i * 30);
      const stars = wrap.querySelector('.tile-stars');
      if (stars) anim(stars, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 160 + i * 30, fill: 'backwards' });
    });
    for (const i of this.unlockNow) this.playUnlock(i);
  }

  /** «Замок слетает» (07 §9.3): плитка была серой — дрожит, замок падает, плитка переворачивается. */
  private playUnlock(i: number): void {
    const tile = this.tiles[i]!;
    const wrap = tile.closest<HTMLElement>('.tile-wrap')!;
    const num = tile.querySelector('.tile-num');
    const color = wrap.classList.contains('is-current') ? 'btn--orange' : 'btn--blue';
    tile.classList.remove('btn--orange', 'btn--blue');
    tile.classList.add('btn--gray');
    num?.setAttribute('style', 'opacity:0');
    const lock = h('span', { class: 'tile-lock-fx', html: icon('lock'), style: 'position:absolute;inset:27%;display:grid' });
    tile.append(lock);
    const stars = wrap.querySelector<HTMLElement>('.tile-stars');
    if (stars) stars.style.visibility = 'hidden';
    const t0 = 450;
    anim(tile, [0, -5, 5, -4, 3, 0].map((r) => ({ transform: `rotate(${r}deg)` })), { duration: 300, delay: t0 });
    const fall = anim(
      lock,
      [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(1.2)', opacity: 1, offset: 0.2 },
        { transform: 'translateY(calc(60 * var(--u))) rotate(40deg)', opacity: 0 },
      ],
      { duration: 500, delay: t0 + 300, easing: 'ease-in', fill: 'forwards' },
    );
    void fall?.finished.then(
      () => {
        lock.remove();
        const flip = anim(tile, [{ transform: 'rotateY(0)' }, { transform: 'rotateY(90deg)' }], { duration: 150, easing: 'ease-in' });
        void flip?.finished.then(
          () => {
            tile.classList.remove('btn--gray');
            tile.classList.add(color);
            num?.removeAttribute('style');
            if (stars) stars.style.visibility = '';
            anim(tile, [{ transform: 'rotateY(90deg)' }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
            this.ctx.sfx('pop');
          },
          () => undefined,
        );
      },
      () => undefined,
    );
  }

  focus(): void {
    const byId = this.focusLevelId ? this.infos.findIndex((x) => x.id === this.focusLevelId && x.unlocked) : -1;
    const cur = this.infos.findIndex((x) => x.current);
    let lastOpen = -1;
    this.infos.forEach((x, i) => {
      if (x.unlocked) lastOpen = i;
    });
    this.focusTile(byId >= 0 ? byId : cur >= 0 ? cur : Math.max(0, lastOpen));
  }

  private focusTile(i: number): void {
    this.tiles.forEach((tl, j) => (tl.tabIndex = j === i ? 0 : -1));
    focusEl(this.tiles[i]);
  }

  /** Центр плитки уровня (для ириса при возврате из игры). */
  tileOf(levelId: string): HTMLElement | undefined {
    return this.tiles.find((tl) => tl.dataset.level === levelId);
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      this.back.click();
      return true;
    }
    const i = this.tiles.indexOf(document.activeElement as HTMLButtonElement);
    const n = this.tiles.length;
    let j = -1;
    if (e.key === 'ArrowRight') j = i < 0 ? 0 : Math.min(n - 1, i + 1);
    else if (e.key === 'ArrowLeft') j = i < 0 ? 0 : Math.max(0, i - 1);
    else if (e.key === 'ArrowDown') j = i < 0 ? 0 : Math.min(n - 1, i + COLS);
    else if (e.key === 'ArrowUp') j = i < 0 ? 0 : Math.max(0, i - COLS);
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') {
      j = 0;
      this.infos.forEach((x, k) => {
        if (x.unlocked) j = k;
      });
    }
    if (j >= 0) {
      this.focusTile(j);
      return true;
    }
    return false;
  }
}
