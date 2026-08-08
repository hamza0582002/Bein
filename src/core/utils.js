/* Small shared helpers used across the app. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Apply a style object. Custom properties (`--x`) must go through
 * setProperty — assigning them to the style object silently does nothing.
 */
export function setStyles(node, styles) {
  for (const [property, value] of Object.entries(styles)) {
    if (value == null) continue;
    if (property.startsWith('--')) node.style.setProperty(property, String(value));
    else node.style[property] = value;
  }
  return node;
}

/** Create an element with attributes, dataset, styles and children in one call. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'style' && typeof value === 'object') setStyles(node, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Append children, dropping the null/false slots that conditional expressions
 * produce. `parent.append(null)` would otherwise insert the text "null".
 */
export function mount(parent, ...children) {
  for (const child of children.flat()) {
    if (child == null || child === false || child === true) continue;
    parent.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/** Like `mount`, but replaces whatever the parent currently holds. */
export function fill(parent, ...children) {
  parent.replaceChildren();
  return mount(parent, ...children);
}

export const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function debounce(fn, wait = 200) {
  let timer;
  let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, wait);
  };
  /** Run the pending call immediately, if there is one. */
  wrapped.flush = () => {
    if (!timer) return undefined;
    clearTimeout(timer);
    timer = null;
    return fn(...(lastArgs || []));
  };
  wrapped.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return wrapped;
}

export function throttle(fn, wait = 100) {
  let last = 0;
  let queued;
  return (...args) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(queued);
      queued = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, wait - (now - last));
    }
  };
}

/** Wait for the next paint — lets the browser apply a class before animating. */
export const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic hash so a title always maps to the same spine colour. */
export function hashCode(str = '') {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** A pleasant, library-looking colour derived from the book title. */
export function spinePalette(seed) {
  const hues = [8, 20, 32, 96, 150, 190, 214, 246, 280, 330, 350];
  const hash = hashCode(seed);
  const hue = hues[hash % hues.length];
  const sat = 26 + (hash >> 3) % 26;
  const light = 24 + (hash >> 7) % 16;
  return {
    base: `hsl(${hue} ${sat}% ${light}%)`,
    light: `hsl(${hue} ${sat}% ${light + 11}%)`,
    dark: `hsl(${hue} ${sat + 4}% ${Math.max(9, light - 12)}%)`,
    ink: light > 32 ? 'rgba(20,14,10,.9)' : 'rgba(255,246,232,.92)',
    foil: `hsl(${(hue + 34) % 360} 62% 74%)`,
  };
}

export function formatBytes(bytes = 0) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** Humanised duration, e.g. 95 min -> "1 س 35 د". */
export function formatDuration(ms, lang = 'ar') {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const unit = lang === 'ar' ? ['س', 'د'] : ['h', 'm'];
  if (!hours) return `${minutes} ${unit[1]}`;
  return `${hours} ${unit[0]} ${minutes} ${unit[1]}`;
}

export function formatDate(ts, lang = 'ar') {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts));
}

/** Escape text before it is dropped into an innerHTML string. */
export function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]);
}

/** Rough word count that works for both Arabic and Latin scripts. */
export function countWords(text = '') {
  const matches = text.trim().match(/[\p{L}\p{N}']+/gu);
  return matches ? matches.length : 0;
}

/** Detect whether a string is predominantly right-to-left. */
export function isRTLText(text = '') {
  const rtl = (text.match(/[֐-ࣿיִ-﷿ﹰ-﻿]/g) || []).length;
  const ltr = (text.match(/[A-Za-z]/g) || []).length;
  return rtl > ltr;
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(Array.from(input.files || []));
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/** "the great gatsby" -> "The Great Gatsby" (used for filename-derived titles). */
export function titleCase(str = '') {
  return str.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

/** Strip a file extension and tidy separators into a readable title. */
export function titleFromFilename(name = '') {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  return isRTLText(base) ? base : titleCase(base);
}
