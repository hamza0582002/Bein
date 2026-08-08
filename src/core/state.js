/** App-wide state: settings persistence, theming and a tiny event bus. */

import { getSetting, setSetting } from './db.js';
import { setLanguage } from './i18n.js';
import { clamp } from './utils.js';

export const DEFAULT_SETTINGS = {
  lang: 'ar',
  view: 'shelf',            // shelf | grid | list
  sort: 'recent',           // recent | added | title | author | progress
  filter: 'all',            // all | favorites | reading | finished | unread | collection:<name>
  theme: 'sepia',           // day | sepia | night | midnight
  fontFamily: 'serif-ar',
  fontSize: 20,
  lineHeight: 1.85,
  margin: 46,               // horizontal page padding in px
  justify: true,
  layout: 'double',         // single | double | scroll
  pageAnim: 'curl',         // curl | slide | fade | none
  sound: true,
  brightness: 100,
  warmth: 0,
  dailyGoal: 30,
  ttsRate: 1,
  ttsVoice: '',
  collections: [],
};

export const FONT_STACKS = {
  'serif-ar': `"Amiri", "Scheherazade New", "Noto Naskh Arabic", "Times New Roman", Georgia, serif`,
  'sans-ar': `"Noto Kufi Arabic", "Cairo", "Segoe UI", system-ui, sans-serif`,
  'naskh': `"Noto Naskh Arabic", "Traditional Arabic", "Amiri", serif`,
  'serif-en': `Georgia, "Iowan Old Style", "Palatino Linotype", serif`,
  'sans-en': `system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`,
  'mono': `"SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace`,
};

export const FONT_LABELS = {
  'serif-ar': 'نسخي كلاسيكي',
  'sans-ar': 'كوفي حديث',
  'naskh': 'نسخ',
  'serif-en': 'Serif',
  'sans-en': 'Sans',
  'mono': 'Mono',
};

const listeners = new Map();

export const settings = { ...DEFAULT_SETTINGS };

/** Subscribe to an app event; returns an unsubscribe function. */
export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event)?.delete(handler);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((handler) => handler(payload));
}

export async function loadSettings() {
  const stored = await getSetting('settings', {});
  Object.assign(settings, DEFAULT_SETTINGS, stored || {});
  settings.fontSize = clamp(settings.fontSize, 13, 42);
  settings.lineHeight = clamp(settings.lineHeight, 1.2, 2.6);
  settings.margin = clamp(settings.margin, 8, 160);
  setLanguage(settings.lang);
  applyTheme();
  return settings;
}

let saveTimer;
/** Patch settings, re-apply the theme and persist (debounced). */
export function updateSettings(patch, { silent = false } = {}) {
  Object.assign(settings, patch);
  applyTheme();
  if (!silent) emit('settings', settings);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => setSetting('settings', { ...settings }), 250);
}

/** Push the reader-facing settings into CSS custom properties. */
export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty('--reader-font', FONT_STACKS[settings.fontFamily] || FONT_STACKS['serif-ar']);
  root.style.setProperty('--reader-size', `${settings.fontSize}px`);
  root.style.setProperty('--reader-leading', settings.lineHeight);
  root.style.setProperty('--reader-margin', `${settings.margin}px`);
  root.style.setProperty('--reader-align', settings.justify ? 'justify' : 'start');
  root.style.setProperty('--screen-brightness', settings.brightness / 100);
  root.style.setProperty('--screen-warmth', settings.warmth / 100);
}

export function resetSettings() {
  const keep = { collections: settings.collections, lang: settings.lang };
  updateSettings({ ...DEFAULT_SETTINGS, ...keep });
}
