/**
 * Plain text / Markdown / HTML adapter.
 *
 * Plain text is split into chapters when headings look like chapters
 * ("الفصل الأول", "Chapter 3", "## Heading"), otherwise into readable blocks
 * of roughly 2,500 words so navigation and pagination stay responsive.
 */

import { countWords, escapeHtml, titleFromFilename } from '../core/utils.js';

const CHAPTER_PATTERNS = [
  /^\s{0,3}#{1,3}\s+(.+)$/,                                   // markdown heading
  /^\s*(?:الفصل|الباب|القسم|المقدمة|الخاتمة|الجزء)\b.{0,60}$/, // Arabic chapter headings
  /^\s*(?:chapter|part|book|section|prologue|epilogue)\b.{0,60}$/i,
  /^\s*[-—*]{3,}\s*$/,                                         // divider line
];

const isHeading = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  return CHAPTER_PATTERNS.some((pattern) => pattern.test(trimmed));
};

/** Inline markdown that is safe and worth supporting inside a paragraph. */
function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*]+)\*(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function paragraphsToHtml(lines) {
  const html = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    html.push(`<p>${inlineMarkdown(buffer.join(' '))}</p>`);
    buffer = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^\s{0,3}(#{1,4})\s+(.+)$/);
    if (heading) {
      flush();
      const level = Math.min(4, heading[1].length + 1);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(trimmed)) {
      flush();
      html.push(`<p class="list-line">${inlineMarkdown(trimmed.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '• '))}</p>`);
      continue;
    }
    if (/^\s*>\s?/.test(trimmed)) {
      flush();
      html.push(`<blockquote>${inlineMarkdown(trimmed.replace(/^\s*>\s?/, ''))}</blockquote>`);
      continue;
    }
    buffer.push(trimmed);
  }
  flush();
  return html.join('\n');
}

async function readAsText(fileBlob) {
  const buffer = await fileBlob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  // Honour a UTF-16 BOM, otherwise assume UTF-8 (with a windows-1256 retry
  // for older Arabic text files).
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const replacementRatio = (utf8.match(/�/g) || []).length / Math.max(1, utf8.length);
  if (replacementRatio > 0.01) {
    try {
      return new TextDecoder('windows-1256').decode(buffer);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export async function openText(fileBlob, filename = '') {
  const isHtml = /\.x?html?$/i.test(filename) || fileBlob.type === 'text/html';
  let raw = await readAsText(fileBlob);

  let title = titleFromFilename(filename);
  let author = '';

  if (isHtml) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    doc.querySelectorAll('script, style, link, iframe').forEach((node) => node.remove());
    title = doc.title?.trim() || title;
    author = doc.querySelector('meta[name="author"]')?.getAttribute('content') || '';
    raw = doc.body?.innerText || doc.body?.textContent || '';
  }

  const lines = raw.replace(/\r\n?/g, '\n').split('\n');

  /* Split into chapters. */
  const chunks = [];
  let currentLines = [];
  let currentTitle = '';
  let currentWords = 0;

  const push = () => {
    if (!currentLines.length) return;
    chunks.push({ title: currentTitle, lines: currentLines });
    currentLines = [];
    currentTitle = '';
    currentWords = 0;
  };

  for (const line of lines) {
    const words = countWords(line);
    if (isHeading(line) && currentWords > 120) {
      push();
      currentTitle = line.trim().replace(/^#{1,4}\s*/, '').replace(/^[-—*]{3,}$/, '');
    } else if (currentWords > 2500 && !line.trim()) {
      push();
    }
    currentLines.push(line);
    currentWords += words;
  }
  push();

  if (!chunks.length) chunks.push({ title, lines: ['(ملف فارغ)'] });

  const sections = chunks.map((chunk, index) => ({
    index,
    id: `chunk-${index}`,
    href: `#chunk-${index}`,
    label: chunk.title || `${index + 1}`,
  }));

  // The first non-empty line is often the real title of a plain text book.
  const firstLine = lines.find((line) => line.trim())?.trim();
  if (firstLine && firstLine.length <= 80 && !isHtml) title = firstLine;

  const cache = new Map();
  const getSection = async (index) => {
    if (cache.has(index)) return cache.get(index);
    const chunk = chunks[index];
    const html = paragraphsToHtml(chunk.lines);
    const text = chunk.lines.join(' ').replace(/\s+/g, ' ').trim();
    const result = {
      index,
      html,
      text,
      words: countWords(text),
      label: sections[index].label,
    };
    cache.set(index, result);
    return result;
  };

  return {
    kind: 'text',
    meta: { title, author, publisher: '', language: '', cover: null },
    sections,
    toc: sections.map((section) => ({
      label: section.label,
      index: section.index,
      anchor: null,
      level: 0,
    })),
    getSection,
    destroy() {
      cache.clear();
    },
  };
}
