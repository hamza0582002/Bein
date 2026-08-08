/**
 * The detail stage — the moment between the shelf and the reader.
 * The book you picked rotates out of its shelf pose to show its cover, can be
 * spun with the mouse, and its cover swings open when you start reading.
 */

import { t } from '../core/i18n.js';
import { clamp, el, fill, formatBytes, formatDate, formatDuration, mount } from '../core/utils.js';
import { buildBook3D, shelfSize } from '../ui/book3d.js';
import { icons } from '../ui/icons.js';
import { playBookOpen } from '../core/sound.js';

const WORDS_PER_MINUTE = 210;

export function openDetail(book, { onRead, onClose, onChange, onEdit, onDelete }) {
  let current = book;

  const stage = el('div', { class: 'detail-stage', role: 'dialog', 'aria-modal': 'true' });

  /* ------------------------------------------------------- the object */
  const base = Math.min(380, Math.max(240, window.innerHeight * 0.46));
  const size = shelfSize(current, base);
  size.depth = Math.round(size.depth * 1.15);

  const holder = el('div', { class: 'detail-book-holder' });
  const node = buildBook3D(current, size);
  mount(node, el('div', { class: 'inner-page' }));
  mount(holder, node);

  /* ------------------------------------------------- drag to rotate */
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let angleY = -24;
  let angleX = 4;

  const applyAngles = () => {
    node.style.transform = `rotateY(${angleY}deg) rotateX(${angleX}deg)`;
  };

  const onPointerDown = (event) => {
    if (holder.classList.contains('opening')) return;
    dragging = true;
    holder.classList.add('dragging');
    startX = event.clientX;
    startY = event.clientY;
    node.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    angleY = clamp(angleY + (event.clientX - startX) * 0.55, -180, 180);
    angleX = clamp(angleX - (event.clientY - startY) * 0.25, -28, 28);
    startX = event.clientX;
    startY = event.clientY;
    applyAngles();
  };

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    holder.classList.remove('dragging');
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointerup', endDrag);
  node.addEventListener('pointercancel', endDrag);

  /* --------------------------------------------------------- the info */
  const info = el('div', { class: 'detail-info' });

  const percent = () => Math.round(current.progress?.percent || 0);
  const minutesLeft = () => {
    const remaining = (current.totalWords || 0) * (1 - (current.progress?.percent || 0) / 100);
    return Math.max(0, Math.round(remaining / WORDS_PER_MINUTE));
  };

  function renderInfo() {
    const metaEntry = (label, value) =>
      el('div', {}, el('dt', { text: label }), el('dd', { text: value }));

    fill(info, 
      el('h2', { text: current.title }),
      el('p', { class: 'author', text: current.author || t('unknownAuthor') }),
      current.description
        ? el('div', { class: 'desc', text: current.description.replace(/<[^>]+>/g, '') })
        : null,
      el(
        'dl',
        { class: 'detail-meta' },
        metaEntry(t('format'), current.format.toUpperCase()),
        metaEntry(
          current.format === 'pdf' ? t('pages') : t('chapters'),
          String(current.format === 'pdf' ? current.pageCount : current.sectionCount)
        ),
        metaEntry(t('size'), formatBytes(current.size)),
        metaEntry(t('added'), formatDate(current.addedAt)),
        current.publisher ? metaEntry(t('publisher'), current.publisher) : null,
        current.language ? metaEntry(t('language'), current.language) : null
      ),
      el(
        'div',
        { class: 'row', style: { gap: '12px' } },
        el(
          'div',
          { style: { flex: '1' } },
          el(
            'div',
            { class: 'row between tiny muted', style: { marginBottom: '6px' } },
            el('span', { text: t('progress') }),
            el('span', { text: `${percent()}%` })
          ),
          el('div', { class: 'progress-track' }, el('i', { style: { width: `${percent()}%` } }))
        )
      ),
      percent() < 100
        ? el('p', {
            class: 'tiny muted',
            style: { marginTop: '8px' },
            text: `${t('timeLeft')}: ${formatDuration(minutesLeft() * 60000)}`,
          })
        : null,
      el(
        'div',
        { class: 'detail-actions' },
        el(
          'button',
          { class: 'btn primary', type: 'button', onclick: startReading },
          el('span', { html: icons.bookOpen }),
          percent() > 0 && percent() < 100
            ? t('resume')
            : current.finished
            ? t('reread')
            : t('startReading')
        ),
        el(
          'button',
          {
            class: `btn${current.favorite ? ' primary' : ''}`,
            type: 'button',
            onclick: async () => {
              current = (await onChange?.({ favorite: !current.favorite })) || current;
              renderInfo();
            },
          },
          el('span', { html: icons.star }),
          t('favorite')
        ),
        el(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: async () => {
              const finished = !current.finished;
              current =
                (await onChange?.({
                  finished,
                  progress: finished
                    ? { ...(current.progress || {}), percent: 100 }
                    : current.progress,
                })) || current;
              renderInfo();
            },
          },
          el('span', { html: icons.check }),
          current.finished ? t('markUnfinished') : t('markFinished')
        ),
        el(
          'button',
          { class: 'btn ghost', type: 'button', onclick: () => { close(); onEdit?.(); } },
          el('span', { html: icons.edit }),
          t('editMetadata')
        ),
        el(
          'button',
          { class: 'btn ghost danger', type: 'button', onclick: () => { close(); onDelete?.(); } },
          el('span', { html: icons.trash }),
          t('remove')
        )
      ),
      el('p', { class: 'detail-hint', text: 'اسحب الكتاب بالفأرة لتقليبه · Esc للإغلاق' })
    );
  }

  /* --------------------------------------------------------- controls */
  function startReading() {
    holder.classList.remove('revealed');
    node.style.transform = '';
    holder.classList.add('opening');
    playBookOpen();
    setTimeout(() => {
      stage.classList.add('closing');
      setTimeout(() => stage.remove(), 240);
      onRead?.(current);
    }, 620);
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    stage.classList.add('closing');
    setTimeout(() => stage.remove(), 240);
    onClose?.();
  }

  const onKey = (event) => {
    if (event.key === 'Escape') close();
    if (event.key === 'Enter') startReading();
  };
  document.addEventListener('keydown', onKey);

  stage.addEventListener('mousedown', (event) => {
    if (event.target === stage) close();
  });

  mount(stage, 
    el('button', {
      class: 'icon-btn detail-close',
      type: 'button',
      'aria-label': t('close'),
      html: icons.x,
      onclick: close,
    }),
    holder,
    info
  );

  renderInfo();
  mount(document.body, stage);

  // Let the shelf pose settle for a frame, then swing round to the cover.
  requestAnimationFrame(() => {
    setTimeout(() => {
      holder.classList.add('revealed');
      setTimeout(applyAngles, 900);
    }, 60);
  });

  return { close };
}
