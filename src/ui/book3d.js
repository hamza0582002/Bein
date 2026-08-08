/**
 * The 3D book object used on the shelves and on the detail stage.
 *
 * Geometry: a W×H×D box centred on the origin. The spine is the left face,
 * so `rotateY(90deg)` on the box is exactly what you see on a shelf, and
 * rotating back towards 0° reveals the front cover.
 */

import { el, escapeHtml, isRTLText, spinePalette } from '../core/utils.js';
import { coverUrl } from './covers.js';

/**
 * @param {object} book
 * @param {{width:number, height:number, depth:number, showCover?:boolean}} size
 */
export function buildBook3D(book, { width, height, depth, showCover = true }) {
  const palette = spinePalette(book.spineSeed || book.title || book.id);
  const node = el('div', {
    class: 'book3d',
    style: {
      '--w': `${width}px`,
      '--h': `${height}px`,
      '--d': `${depth}px`,
      '--spine-base': palette.base,
      '--spine-light': palette.light,
      '--spine-dark': palette.dark,
      '--spine-ink': palette.ink,
      '--spine-foil': palette.foil,
    },
  });

  /* front cover */
  const front = el('div', { class: 'face front' });
  const url = showCover ? coverUrl(book) : null;
  if (url) {
    front.append(el('img', { src: url, alt: '', draggable: 'false' }));
  } else {
    front.innerHTML = `<div style="padding:14% 12%;text-align:center;color:${palette.ink};
      font-family:'Amiri',Georgia,serif;font-size:${Math.max(11, width * 0.1)}px;font-weight:700;
      line-height:1.4">${escapeHtml(book.title || '')}</div>`;
  }

  /* spine */
  const spine = el('div', { class: 'face spine' });
  const spineTitle = el('span', {
    class: `spine-text${isRTLText(book.title) ? ' rtl' : ''}`,
    text: book.title || '',
  });
  spine.append(spineTitle);
  if (book.author && depth >= 26) {
    spine.append(
      el('span', {
        class: `spine-author${isRTLText(book.author) ? ' rtl' : ''}`,
        text: book.author,
      })
    );
  }
  if (book.favorite) spine.append(el('span', { class: 'favorite-star', text: '★' }));
  const percent = book.progress?.percent || 0;
  if (percent > 0 && percent < 100) {
    spine.append(
      el('span', { class: 'spine-progress' }, el('i', { style: { width: `${percent}%` } }))
    );
  }

  node.append(
    front,
    el('div', { class: 'face back' }),
    spine,
    el('div', { class: 'face edge' }),
    el('div', { class: 'face top' }),
    el('div', { class: 'face bottom' })
  );

  // A ribbon marks books that are part-way read.
  if (percent > 0 && percent < 100) node.append(el('div', { class: 'ribbon' }));

  return node;
}

/**
 * Shelf-appropriate dimensions for a book. Heights vary a little so a row of
 * books looks like a real shelf rather than a bar chart.
 */
export function shelfSize(book, base = 210) {
  const height = Math.round(base * (book.heightRatio || 0.92));
  return {
    height,
    width: Math.round(height * 0.66),
    depth: book.thickness || 30,
  };
}
