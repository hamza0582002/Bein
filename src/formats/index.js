/** Format detection, book import and cover generation. */

import { openEpub } from './epub.js';
import { openText } from './text.js';
import { putBook, listBooks } from '../core/db.js';
import { clamp, spinePalette, titleFromFilename, uid } from '../core/utils.js';

export const SUPPORTED = ['.epub', '.pdf', '.txt', '.md', '.htm', '.html'];
export const ACCEPT_ATTR = SUPPORTED.join(',');

export function detectFormat(filename = '', mime = '') {
  const name = filename.toLowerCase();
  if (name.endsWith('.epub') || mime === 'application/epub+zip') return 'epub';
  if (name.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (/\.(txt|md|markdown|htm|html)$/.test(name) || mime.startsWith('text/')) return 'text';
  return null;
}

/** pdf.js is heavy, so it is only pulled in when a PDF is actually opened. */
const loadPdfAdapter = () => import('./pdf.js').then((module) => module.openPdf);

/** Open a stored book file with the right adapter. */
export async function openSource(book) {
  if (book.format === 'epub') return openEpub(book.file);
  if (book.format === 'pdf') return (await loadPdfAdapter())(book.file);
  return openText(book.file, book.filename || book.title);
}

async function sha256(blob) {
  if (!crypto?.subtle) return null;
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- cover artwork */

function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines.slice(0, 6);
}

/** Draw a typographic cover for books that ship without artwork. */
export function generateCover(title, author, seed = title) {
  const width = 640;
  const height = 960;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const palette = spinePalette(seed);

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, palette.light);
  background.addColorStop(0.55, palette.base);
  background.addColorStop(1, palette.dark);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Subtle cloth grain.
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = i % 2 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * width, Math.random() * height, 2, 1);
  }
  ctx.globalAlpha = 1;

  // Foil frame.
  ctx.strokeStyle = palette.foil;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 3;
  ctx.strokeRect(46, 46, width - 92, height - 92);
  ctx.lineWidth = 1;
  ctx.strokeRect(58, 58, width - 116, height - 116);
  ctx.globalAlpha = 1;

  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.ink;

  ctx.font = '600 54px "Amiri", Georgia, serif';
  const titleLines = wrapText(ctx, title || '—', width - 190);
  let y = height / 2 - (titleLines.length - 1) * 34 - 40;
  for (const line of titleLines) {
    ctx.fillText(line, width / 2, y);
    y += 68;
  }

  if (author) {
    ctx.globalAlpha = 0.78;
    ctx.font = '400 30px "Amiri", Georgia, serif';
    ctx.fillText(author, width / 2, y + 46);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = palette.foil;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 70, height - 190);
  ctx.lineTo(width / 2 + 70, height - 190);
  ctx.stroke();
  ctx.globalAlpha = 1;

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
}

/* ------------------------------------------------------------- import */

/**
 * Import one file into the library.
 * @returns {Promise<{book?: object, duplicate?: object, error?: string}>}
 */
export async function importFile(file, { onProgress } = {}) {
  const format = detectFormat(file.name, file.type);
  if (!format) return { error: 'unsupportedFormat' };

  onProgress?.({ stage: 'hash', file: file.name });
  const hash = await sha256(file);
  if (hash) {
    const existing = (await listBooks()).find((book) => book.hash === hash);
    if (existing) return { duplicate: existing };
  }

  onProgress?.({ stage: 'parse', file: file.name });
  let source;
  try {
    source =
      format === 'epub'
        ? await openEpub(file)
        : format === 'pdf'
        ? await (await loadPdfAdapter())(file)
        : await openText(file, file.name);
  } catch (error) {
    console.error('[bein] import failed', error);
    return { error: error?.message || 'importFailed' };
  }

  const title = source.meta.title?.trim() || titleFromFilename(file.name);
  const author = source.meta.author?.trim() || '';

  onProgress?.({ stage: 'measure', file: file.name });
  let totalWords = 0;
  if (format !== 'pdf') {
    // Cheap for text, and EPUB text extraction is fast enough to do up front.
    const limit = Math.min(source.sections.length, 400);
    for (let i = 0; i < limit; i++) {
      try {
        totalWords += (await source.getSection(i)).words;
      } catch {
        /* skip unreadable section */
      }
    }
    if (source.sections.length > limit) {
      totalWords = Math.round((totalWords / limit) * source.sections.length);
    }
  } else {
    totalWords = source.numPages * 280; // rough page estimate for pacing
  }

  const cover = source.meta.cover || (await generateCover(title, author, title));
  const pageCount = format === 'pdf' ? source.numPages : Math.max(1, Math.round(totalWords / 280));

  const book = {
    id: uid(),
    hash,
    title,
    author,
    publisher: source.meta.publisher || '',
    language: source.meta.language || '',
    description: source.meta.description || '',
    format,
    filename: file.name,
    size: file.size,
    file,
    cover,
    generatedCover: !source.meta.cover,
    addedAt: Date.now(),
    lastOpenedAt: null,
    sectionCount: source.sections.length,
    totalWords,
    pageCount,
    progress: { section: 0, page: 0, percent: 0, updatedAt: null },
    favorite: false,
    finished: false,
    tags: [],
    collection: '',
    // Shelf appearance: thicker books for longer texts.
    thickness: clamp(Math.round(18 + Math.log2(1 + totalWords / 900) * 6), 20, 68),
    heightRatio: 0.86 + ((source.sections.length * 7) % 22) / 100,
    spineSeed: `${title}|${author}`,
  };

  source.destroy?.();
  await putBook(book);
  onProgress?.({ stage: 'done', file: file.name });
  return { book };
}

/** Import several files, reporting each result as it lands. */
export async function importFiles(files, handlers = {}) {
  const results = [];
  for (const file of files) {
    const result = await importFile(file, handlers);
    handlers.onResult?.(result, file);
    results.push(result);
  }
  return results;
}
