/** Application bootstrap and view routing. */

import { getSetting, listBooks, setSetting } from './core/db.js';
import { loadSettings, on, settings } from './core/state.js';
import { t } from './core/i18n.js';
import { el, fill, mount } from './core/utils.js';
import { importFile } from './formats/index.js';
import { createLibraryView } from './views/library.js';
import { createReaderView } from './views/reader.js';
import { openStats } from './views/stats.js';
import { openSettings } from './views/settings.js';
import { toast } from './ui/feedback.js';
import { welcomeFile } from './welcome-book.js';

const app = document.getElementById('app');

let library = null;
let reader = null;

/** Put a guide book on the shelf the very first time the app runs. */
async function seedLibrary() {
  const seeded = await getSetting('seeded', false);
  if (seeded) return;
  const books = await listBooks();
  if (books.length) {
    await setSetting('seeded', true);
    return;
  }
  try {
    await importFile(welcomeFile());
  } catch (error) {
    console.warn('[maktabate] could not seed the library', error);
  }
  await setSetting('seeded', true);
}

function showLibrary() {
  if (reader) {
    reader.destroy();
    reader = null;
  }
  if (!library) {
    library = createLibraryView({
      onOpenBook: openBook,
      onShowStats: openStats,
      onShowSettings: openSettings,
    });
  }
  fill(app, library.element);
  library.refresh();
  document.title = `${t('appName')} — ${t('myLibrary')}`;
}

async function openBook(book) {
  const loading = el('div', { class: 'boot' }, el('p', { text: t('loading') }));
  fill(app, loading);
  try {
    reader = await createReaderView({ book, onExit: showLibrary });
    fill(app, reader.element);
    document.title = `${book.title} — ${t('appName')}`;
  } catch (error) {
    console.error('[maktabate] could not open the book', error);
    toast(`${t('importFailed')}: ${error?.message || error}`, { duration: 6000 });
    showLibrary();
  }
}

/** Library-level keyboard shortcuts. */
function bindGlobalKeys() {
  document.addEventListener('keydown', (event) => {
    if (reader || event.target.matches('input, textarea, select')) return;
    if (event.key === '/') {
      event.preventDefault();
      library?.focusSearch();
    } else if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey) {
      library?.importFiles();
    }
  });
}

async function start() {
  await loadSettings();
  await seedLibrary();
  showLibrary();
  bindGlobalKeys();
  app.removeAttribute('aria-busy');

  // Language changes rebuild the whole library UI.
  on('language-changed', () => {
    library?.destroy();
    library = null;
    showLibrary();
  });

  // Ask the browser to keep the library out of automatic eviction.
  navigator.storage?.persist?.().catch(() => {});

  if (import.meta.env?.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

start().catch((error) => {
  console.error('[maktabate] startup failed', error);
  fill(app, 
    el(
      'div',
      { class: 'boot' },
      el('p', { text: 'تعذّر تشغيل التطبيق' }),
      el('pre', { class: 'tiny muted', text: String(error?.message || error) })
    )
  );
});

// Keep the document theme in step with the settings even outside the reader.
on('settings', () => {
  document.documentElement.dataset.theme = settings.theme;
});
