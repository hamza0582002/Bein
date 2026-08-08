/**
 * PDF adapter around pdf.js. Unlike the reflowable formats this one renders
 * page images to a canvas, so the reader treats it as a fixed-layout source.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { countWords } from '../core/utils.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdf(fileBlob) {
  const data = await fileBlob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

  const info = await doc.getMetadata().catch(() => ({ info: {} }));
  const meta = {
    title: (info.info?.Title || '').trim(),
    author: (info.info?.Author || '').trim(),
    publisher: (info.info?.Producer || '').trim(),
    language: (info.info?.Language || '').trim(),
    cover: null,
  };

  /* ---------------------------------------------------------- outline */
  let toc = [];
  try {
    const outline = await doc.getOutline();
    if (outline?.length) {
      const entries = [];
      const walk = async (items, level) => {
        for (const item of items) {
          let index = null;
          try {
            const destination =
              typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
            if (destination?.[0]) {
              index = (await doc.getPageIndex(destination[0])) ?? null;
            }
          } catch {
            index = null;
          }
          entries.push({ label: item.title?.trim() || '—', index, anchor: null, level });
          if (item.items?.length) await walk(item.items, level + 1);
        }
      };
      await walk(outline, 0);
      toc = entries.filter((entry) => entry.index != null);
    }
  } catch {
    toc = [];
  }

  const sections = Array.from({ length: doc.numPages }, (_, index) => ({
    index,
    id: `page-${index + 1}`,
    href: `#page-${index + 1}`,
    label: `${index + 1}`,
  }));

  if (!toc.length) {
    toc = sections
      .filter((_, index) => index % Math.max(1, Math.ceil(doc.numPages / 40)) === 0)
      .map((section) => ({ label: `صفحة ${section.index + 1}`, index: section.index, anchor: null, level: 0 }));
  }

  const pageCache = new Map();
  const getPage = async (index) => {
    if (!pageCache.has(index)) pageCache.set(index, doc.getPage(index + 1));
    return pageCache.get(index);
  };

  /** Render one page into a canvas at the given CSS size, honouring DPR. */
  async function renderPage(index, canvas, { width, height, dpr = window.devicePixelRatio || 1 }) {
    const page = await getPage(index);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(width / unscaled.width, height / unscaled.height);
    const viewport = page.getViewport({ scale: scale * dpr });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;

    const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport });
    await task.promise;
    return { width: viewport.width / dpr, height: viewport.height / dpr };
  }

  const textCache = new Map();
  async function getSection(index) {
    if (textCache.has(index)) return textCache.get(index);
    const page = await getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const result = { index, html: '', text, words: countWords(text), label: `${index + 1}` };
    textCache.set(index, result);
    return result;
  }

  /** First page rendered small — used as the library cover. */
  async function makeCover(maxWidth = 420) {
    const page = await getPage(0);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: maxWidth / unscaled.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  }

  meta.cover = await makeCover().catch(() => null);

  return {
    kind: 'pdf',
    fixedLayout: true,
    numPages: doc.numPages,
    meta,
    sections,
    toc,
    getSection,
    renderPage,
    destroy() {
      pageCache.clear();
      textCache.clear();
      doc.destroy?.();
    },
  };
}
