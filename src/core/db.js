/**
 * IndexedDB persistence layer.
 *
 * Stores
 *   books        — metadata + the original file blob + cover blob
 *   annotations  — highlights, notes and bookmarks
 *   sessions     — reading sessions, used by the statistics view
 *   settings     — key/value app preferences
 */

const DB_NAME = 'maktabate-library';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('addedAt', 'addedAt');
        books.createIndex('lastOpenedAt', 'lastOpenedAt');
        books.createIndex('title', 'title');
      }
      if (!db.objectStoreNames.contains('annotations')) {
        const annotations = db.createObjectStore('annotations', { keyPath: 'id' });
        annotations.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('bookId', 'bookId');
        sessions.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function tx(store, mode, run) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(request?.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

const getAllFromIndex = (store, indexName, value) =>
  open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, 'readonly');
        const source = indexName
          ? transaction.objectStore(store).index(indexName)
          : transaction.objectStore(store);
        const request = value === undefined ? source.getAll() : source.getAll(value);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      })
  );

/* ------------------------------------------------------------------ books */

export const listBooks = () => getAllFromIndex('books');
export const getBook = (id) => tx('books', 'readonly', (store) => store.get(id));
export const putBook = (book) => tx('books', 'readwrite', (store) => store.put(book));
export const deleteBook = async (id) => {
  await tx('books', 'readwrite', (store) => store.delete(id));
  const notes = await listAnnotations(id);
  await Promise.all(notes.map((note) => deleteAnnotation(note.id)));
};

/** Merge a patch into a stored book without clobbering concurrent fields. */
export async function updateBook(id, patch) {
  const book = await getBook(id);
  if (!book) return null;
  const next = { ...book, ...patch };
  await putBook(next);
  return next;
}

/* ------------------------------------------------------------- annotations */

export const listAnnotations = (bookId) =>
  bookId ? getAllFromIndex('annotations', 'bookId', bookId) : getAllFromIndex('annotations');
export const putAnnotation = (annotation) =>
  tx('annotations', 'readwrite', (store) => store.put(annotation));
export const deleteAnnotation = (id) =>
  tx('annotations', 'readwrite', (store) => store.delete(id));

/* ---------------------------------------------------------------- sessions */

export const listSessions = () => getAllFromIndex('sessions');
export const putSession = (session) =>
  tx('sessions', 'readwrite', (store) => store.put(session));

/* ---------------------------------------------------------------- settings */

export async function getSetting(key, fallback = null) {
  const row = await tx('settings', 'readonly', (store) => store.get(key));
  return row ? row.value : fallback;
}

export const setSetting = (key, value) =>
  tx('settings', 'readwrite', (store) => store.put({ key, value }));

/* ------------------------------------------------------------------ backup */

/** Everything except the (potentially huge) original book files. */
export async function exportBackup() {
  const [books, annotations, sessions] = await Promise.all([
    listBooks(),
    listAnnotations(),
    listSessions(),
  ]);
  const settings = await open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const request = db.transaction('settings', 'readonly').objectStore('settings').getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      })
  );
  return {
    app: 'maktabate-reader',
    version: 1,
    exportedAt: Date.now(),
    books: books.map(({ file, cover, ...rest }) => rest),
    annotations,
    sessions,
    settings,
  };
}

/** Restore annotations/progress/settings; book files are matched by id. */
export async function importBackup(payload) {
  if (!payload || payload.app !== 'maktabate-reader') throw new Error('ملف نسخة احتياطية غير صالح');
  const report = { books: 0, annotations: 0, sessions: 0 };

  for (const incoming of payload.books || []) {
    const existing = await getBook(incoming.id);
    if (existing) {
      // Keep the local file/cover blobs, take the newer reading state.
      await putBook({ ...existing, ...incoming, file: existing.file, cover: existing.cover });
      report.books += 1;
    }
  }
  for (const annotation of payload.annotations || []) {
    await putAnnotation(annotation);
    report.annotations += 1;
  }
  for (const session of payload.sessions || []) {
    await putSession(session);
    report.sessions += 1;
  }
  for (const row of payload.settings || []) {
    if (row?.key) await setSetting(row.key, row.value);
  }
  return report;
}

/** Storage usage, when the browser exposes it. */
export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
