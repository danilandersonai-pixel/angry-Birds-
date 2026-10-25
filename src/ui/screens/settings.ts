// Диалоги (07 §14): «Настройки» (свитчи, сегменты, сброс прогресса, «Об игре») и подтверждение сброса.
// Бумажная панель поверх всего, затемнение, Esc/тап мимо — закрыть, Tab не выходит из диалога.

import { shakeOn, type Settings } from '../../storage/progress';
import { CSS_EASE, anim, done, motion, popIn } from '../anim';
import type { UiCtx } from '../ctx';
import { button, focusEl, h, ribbon } from '../dom';
import { S } from '../strings';
import { APP_VERSION } from '../version';

/** Модальный диалог, которым управляет UI (стек диалогов). */
export interface DialogView {
  readonly el: HTMLElement;
  enter(): void;
  leave(): Promise<void>;
  focus(): void;
  onKey?(e: KeyboardEvent): boolean;
  destroy?(): void;
}

let uid = 0;

/**
 * Каркас диалога: затемнение + бумажная панель с лентой и кнопкой «закрыть».
 * Тело прокручивается при нехватке высоты; тени у краёв и стрелка показывают, что есть ещё (data-more-up/down на панели).
 */
function dialogFrame(title: string, onClose: () => void, cls: string): { el: HTMLElement; panel: HTMLElement; body: HTMLElement; close: HTMLButtonElement; backdrop: HTMLElement; dispose(): void } {
  const id = `abui-dlg-${++uid}`;
  const backdrop = h('div', { class: 'ov-backdrop dlg-backdrop' });
  backdrop.addEventListener('click', onClose);
  const close = button({ color: 'red', size: 'xs', icon: 'close', label: S.close, testid: 'dialog-close', cls: 'dlg-close', onClick: onClose });
  const body = h('div', { class: 'dlg-body' });
  const scroll = h(
    'div',
    { class: 'dlg-scroll' },
    body,
    h('div', { class: 'dlg-shade dlg-shade--up', 'aria-hidden': 'true' }),
    h('div', { class: 'dlg-shade dlg-shade--down', 'aria-hidden': 'true' }),
  );
  const panel = h('div', { class: `dlg-panel ${cls}` }, ribbon('info', title, id), close, scroll);
  const edges = (): void => {
    const up = body.scrollTop > 2;
    const down = body.scrollTop + body.clientHeight < body.scrollHeight - 2;
    if (panel.dataset.moreUp !== String(up)) panel.dataset.moreUp = String(up);
    if (panel.dataset.moreDown !== String(down)) panel.dataset.moreDown = String(down);
  };
  body.addEventListener('scroll', edges, { passive: true });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(edges) : null;
  ro?.observe(body);

  const el = h(
    'div',
    { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id },
    backdrop,
    h('div', { class: 'dlg-center' }, panel),
  );
  return { el, panel, body, close, backdrop, dispose: () => ro?.disconnect() };
}

function enterDialog(backdrop: HTMLElement, panel: HTMLElement): void {
  anim(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: 'backwards' });
  popIn(panel, 0, 320);
}

async function leaveDialog(el: HTMLElement): Promise<void> {
  await done(anim(el, [{ opacity: 1 }, { opacity: 0 }], { duration: motion.reduced ? 90 : 160, easing: CSS_EASE.in, fill: 'forwards' }));
}

/** Свитч «вкл/выкл» (07 §4.5): role="switch". */
function switchRow(label: string, on: boolean, onChange: (v: boolean) => void, testid: string): { row: HTMLElement; set(v: boolean): void } {
  const sw = h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': String(on), 'data-testid': testid }, h('span', { class: 'sw-knob' }));
  const lab = h('span', { class: 'dlg-label' }, label);
  const row = h('div', { class: 'dlg-row' }, lab, sw);
  const set = (v: boolean): void => sw.setAttribute('aria-checked', String(v));
  const flip = (): void => {
    const v = sw.getAttribute('aria-checked') !== 'true';
    set(v);
    onChange(v);
  };
  sw.addEventListener('click', flip);
  lab.addEventListener('click', flip);
  sw.setAttribute('aria-label', label);
  return { row, set };
}

/** Сегменты (07 §4.5): role="radiogroup", стрелки ←/→ переключают. */
function segRow<T extends string>(label: string, opts: ReadonlyArray<readonly [T, string]>, value: T, onChange: (v: T) => void, testid: string): HTMLElement {
  const group = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label, 'data-testid': testid });
  const btns: HTMLButtonElement[] = [];
  const select = (v: T, focus: boolean): void => {
    for (const b of btns) {
      const sel = b.dataset.v === v;
      b.setAttribute('aria-checked', String(sel));
      b.tabIndex = sel ? 0 : -1;
      if (sel && focus) focusEl(b);
    }
  };
  for (const [v, text] of opts) {
    const b = h('button', { type: 'button', class: 'seg-opt', role: 'radio', 'data-v': v, text }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      if (b.getAttribute('aria-checked') === 'true') return;
      select(v, false);
      onChange(v);
    });
    btns.push(b);
    group.append(b);
  }
  group.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = btns.findIndex((b) => b.getAttribute('aria-checked') === 'true');
    const j = Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)));
    if (j !== i) {
      const v = btns[j]!.dataset.v as T;
      select(v, true);
      onChange(v);
    }
    e.preventDefault();
    e.stopPropagation();
  });
  select(value, false);
  // все сегменты в одном виде: подпись сверху, переключатель во всю ширину колонки
  return h('div', { class: 'dlg-row dlg-row--seg' }, h('span', { class: 'dlg-label' }, label), group);
}

export class SettingsDialog implements DialogView {
  readonly el: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly first: HTMLElement;
  private readonly sw: Partial<Record<'music' | 'levelMusic' | 'sfx' | 'shake' | 'haptics', { set(v: boolean): void }>> = {};
  private readonly dispose: () => void;

  constructor(
    private readonly ctx: UiCtx,
    private readonly onClose: () => void,
    onReset: () => void,
  ) {
    const close = (): void => {
      ctx.sfx('back');
      onClose();
    };
    const f = dialogFrame(S.settingsTitle, close, 'dlg-settings');
    this.el = f.el;
    this.el.dataset.testid = 'settings';
    this.panel = f.panel;
    this.backdrop = f.backdrop;
    this.closeBtn = f.close;
    this.dispose = f.dispose;
    const s = ctx.settings();
    const set = (p: Partial<Settings>): void => ctx.setSettings(p);

    const music = switchRow(S.setMusic, s.music, (v) => set({ music: v }), 'set-music');
    const levelMusic = switchRow(S.setLevelMusic, s.levelMusic, (v) => set({ levelMusic: v }), 'set-level-music');
    const sfx = switchRow(S.setSfx, s.sfx, (v) => set({ sfx: v }), 'set-sfx');
    // «авто» показывается действующим значением (при уменьшенном движении — выкл); нажатие делает выбор явным
    const shake = switchRow(S.setShake, shakeOn(s, motion.reduced), (v) => set({ shake: v }), 'set-shake');
    this.sw = { music, levelMusic, sfx, shake };
    // две колонки (в ландшафте): слева свитчи и сброс, справа сегменты
    const swRows: HTMLElement[] = [music.row, levelMusic.row, sfx.row, shake.row];
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      const hap = switchRow(S.setHaptics, s.haptics, (v) => set({ haptics: v }), 'set-haptics');
      this.sw.haptics = hap;
      swRows.push(hap.row);
    }
    const segRows: HTMLElement[] = [
      segRow(S.setQuality, [['auto', S.qAuto], ['high', S.qHigh], ['med', S.qMed], ['low', S.qLow]] as const, s.quality, (v) => set({ quality: v }), 'set-quality'),
      segRow(S.setAim, [['off', S.aimOff], ['short', S.aimShort]] as const, s.aimAssist, (v) => set({ aimAssist: v }), 'set-aim'),
      segRow(S.setMotion, [['system', S.motionSystem], ['reduce', S.motionReduce], ['full', S.motionFull]] as const, s.motion, (v) => set({ motion: v }), 'set-motion'),
    ];
    const reset = button({
      color: 'red',
      size: 'pill',
      text: S.setReset,
      label: S.setReset,
      testid: 'set-reset',
      onClick: () => {
        ctx.sfx('click');
        onReset();
      },
    });
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    // «Об игре» и «Управление» — тоже в две колонки, чтобы на широком экране всё помещалось без прокрутки
    const about = h(
      'div',
      { class: 'dlg-about' },
      h('div', null, h('h3', { class: 'dlg-h' }, S.creditsTitle), h('p', null, S.creditsBody)),
      h(
        'div',
        null,
        h('h3', { class: 'dlg-h' }, S.controlsTitle),
        h('p', null, coarse ? S.controlsTouch : S.controlsMouse),
        coarse ? null : h('p', null, S.controlsKeys),
      ),
      h('p', { class: 'dlg-ver' }, S.appVersion.replace('{v}', APP_VERSION)),
    );
    f.body.append(
      h(
        'div',
        { class: 'set-grid' },
        h('div', { class: 'set-col set-col--sw' }, ...swRows, h('div', { class: 'dlg-row dlg-row--center' }, reset)),
        h('div', { class: 'set-col set-col--seg' }, ...segRows),
      ),
      about,
    );
    this.first = (swRows[0]?.querySelector('button') as HTMLElement | null) ?? this.closeBtn;
  }

  /** Обновить свитчи, если настройки поменялись снаружи (клавиша M, другая вкладка). */
  sync(): void {
    const s = this.ctx.settings();
    this.sw.music?.set(s.music);
    this.sw.levelMusic?.set(s.levelMusic);
    this.sw.sfx?.set(s.sfx);
    this.sw.shake?.set(shakeOn(s, motion.reduced));
    this.sw.haptics?.set(s.haptics);
  }

  enter(): void {
    enterDialog(this.backdrop, this.panel);
    this.ctx.sfx('pop');
  }

  leave(): Promise<void> {
    return leaveDialog(this.el);
  }

  focus(): void {
    focusEl(this.first);
  }

  destroy(): void {
    this.dispose();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ctx.sfx('back');
      this.onClose();
      return true;
    }
    return false;
  }
}

/** Подтверждение (07 §14.2): «Отмена» в фокусе по умолчанию. */
export class ConfirmDialog implements DialogView {
  readonly el: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private readonly dispose: () => void;

  constructor(
    private readonly ctx: UiCtx,
    title: string,
    body: string,
    okText: string,
    private readonly onCancel: () => void,
    onOk: () => void,
  ) {
    const close = (): void => {
      ctx.sfx('back');
      onCancel();
    };
    const f = dialogFrame(title, close, 'dlg-confirm');
    this.el = f.el;
    this.el.dataset.testid = 'confirm';
    this.panel = f.panel;
    this.dispose = f.dispose;
    this.backdrop = f.backdrop;
    f.close.remove();
    this.cancel = button({ color: 'blue', size: 'pill', text: S.confirmCancel, label: S.confirmCancel, testid: 'confirm-cancel', onClick: close });
    const ok = button({
      color: 'red',
      size: 'pill',
      text: okText,
      label: okText,
      testid: 'confirm-ok',
      onClick: () => {
        ctx.sfx('click');
        onOk();
      },
    });
    f.body.append(h('p', { class: 'dlg-text' }, body), h('div', { class: 'dlg-btns' }, this.cancel, ok));
  }

  enter(): void {
    enterDialog(this.backdrop, this.panel);
    this.ctx.sfx('pop');
  }

  leave(): Promise<void> {
    return leaveDialog(this.el);
  }

  focus(): void {
    focusEl(this.cancel);
  }

  destroy(): void {
    this.dispose();
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      this.ctx.sfx('back');
      this.onCancel();
      return true;
    }
    return false;
  }
}
