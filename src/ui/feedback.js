/** Toasts, confirm dialogs and generic modals. */

import { el, fill, mount } from '../core/utils.js';
import { t } from '../core/i18n.js';
import { icons } from './icons.js';
import { pushBackHandler } from '../core/back.js';

let stack = null;

function ensureStack() {
  if (!stack) {
    stack = el('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    mount(document.body, stack);
  }
  return stack;
}

/**
 * Show a transient message.
 * @param {string} message
 * @param {{duration?: number, action?: {label: string, onClick: Function}}} options
 */
export function toast(message, { duration = 3200, action } = {}) {
  const node = el('div', { class: 'toast' }, message);
  if (action) {
    mount(node, 
      el(
        'button',
        {
          type: 'button',
          onclick: () => {
            action.onClick();
            dismiss();
          },
        },
        action.label
      )
    );
  }
  ensureStack().append(node);

  let timer = setTimeout(dismiss, duration);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => {
    timer = setTimeout(dismiss, 1200);
  });

  function dismiss() {
    clearTimeout(timer);
    if (!node.isConnected) return;
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 240);
  }

  return dismiss;
}

/**
 * Generic modal. `render(close)` returns the body content; buttons are supplied
 * through `footer(close)`.
 */
export function modal({ title, render, footer, width, onClose }) {
  const overlay = el('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const box = el('div', { class: 'modal', style: width ? { width } : undefined });

  const releaseBack = pushBackHandler(() => {
    close(null);
    return true;
  });

  const close = (result) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    releaseBack();
    onClose?.(result);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(null);
    }
  };

  mount(box, 
    el(
      'header',
      {},
      el('h2', { text: title || '' }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': t('close'),
        html: icons.x,
        onclick: () => close(null),
      })
    ),
    el('div', { class: 'body' }, render(close))
  );

  if (footer) mount(box, el('footer', {}, footer(close)));

  mount(overlay, box);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) close(null);
  });
  document.addEventListener('keydown', onKey);
  mount(document.body, overlay);
  box.querySelector('input, textarea, button.primary')?.focus();
  return { close, box };
}

/** Promise-based confirmation dialog. */
export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const { close } = modal({
      title,
      render: () => el('p', { style: { margin: 0, lineHeight: '1.75' } }, message),
      footer: (closeModal) => [
        el(
          'button',
          { class: 'btn', type: 'button', onclick: () => { finish(false); closeModal(); } },
          t('cancel')
        ),
        el(
          'button',
          {
            class: `btn ${danger ? 'danger' : 'primary'}`,
            type: 'button',
            onclick: () => { finish(true); closeModal(); },
          },
          confirmLabel || t('confirm')
        ),
      ],
      onClose: () => finish(false),
    });
    void close;
  });
}
