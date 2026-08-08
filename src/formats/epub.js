/**
 * A self-contained EPUB 2/3 reader built on JSZip.
 *
 * It exposes the same shape as the other format adapters:
 *   { kind, meta, sections, toc, getSection(i), destroy() }
 * where a section is one spine document rendered to sanitised HTML with the
 * book's own images rewritten to blob URLs.
 */

import JSZip from 'jszip';
import { countWords, titleFromFilename } from '../core/utils.js';

const XHTML = 'application/xhtml+xml';

/** Resolve `relative` against the directory of `base`, zip-style. */
function resolvePath(base, relative) {
  if (!relative) return '';
  if (/^[a-z]+:/i.test(relative)) return relative; // external URL
  const baseParts = base.split('/').slice(0, -1);
  const parts = relative.split('/');
  for (const part of parts) {
    if (part === '.' || part === '') continue;
    if (part === '..') baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join('/');
}

const stripHash = (href = '') => href.split('#')[0];

function parseXML(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) {
    return new DOMParser().parseFromString(text, 'text/html');
  }
  return doc;
}

/** Look a path up in the zip, tolerating percent-encoding differences. */
function zipFile(zip, path) {
  if (!path) return null;
  return (
    zip.file(path) ||
    zip.file(decodeURIComponent(path)) ||
    zip.file(encodeURI(path)) ||
    null
  );
}

export async function openEpub(fileBlob) {
  const zip = await JSZip.loadAsync(fileBlob);

  /* ---------------------------------------------------------- OPF lookup */
  const containerEntry = zipFile(zip, 'META-INF/container.xml');
  let opfPath = null;
  if (containerEntry) {
    const container = parseXML(await containerEntry.async('string'));
    opfPath = container.querySelector('rootfile')?.getAttribute('full-path') || null;
  }
  if (!opfPath) {
    const guess = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf'));
    if (!guess) throw new Error('ملف EPUB غير صالح: لم يُعثر على ملف OPF');
    opfPath = guess;
  }

  const opf = parseXML(await zipFile(zip, opfPath).async('string'));

  /* ---------------------------------------------------------- metadata */
  const metaText = (tag) =>
    opf.getElementsByTagName(`dc:${tag}`)[0]?.textContent?.trim() ||
    Array.from(opf.getElementsByTagName(tag)).find((node) =>
      node.namespaceURI?.includes('dc/elements')
    )?.textContent?.trim() ||
    '';

  const meta = {
    title: metaText('title'),
    author: metaText('creator'),
    publisher: metaText('publisher'),
    language: metaText('language'),
    description: metaText('description'),
  };

  /* ---------------------------------------------------------- manifest */
  const manifest = new Map();
  for (const item of opf.querySelectorAll('manifest > item')) {
    const id = item.getAttribute('id');
    manifest.set(id, {
      id,
      href: resolvePath(opfPath, item.getAttribute('href') || ''),
      type: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    });
  }

  /* ------------------------------------------------------------- spine */
  const spineEl = opf.querySelector('spine');
  const sections = [];
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item || !zipFile(zip, item.href)) continue;
    sections.push({ index: sections.length, id: item.id, href: item.href, label: '' });
  }
  if (!sections.length) {
    // Damaged spine — fall back to every XHTML document in the archive.
    Object.keys(zip.files)
      .filter((name) => /\.x?html?$/i.test(name))
      .sort()
      .forEach((href, index) => sections.push({ index, id: `doc-${index}`, href, label: '' }));
  }
  const indexByHref = new Map(sections.map((section) => [section.href, section.index]));

  /* --------------------------------------------------------------- toc */
  async function readToc() {
    const navItem =
      Array.from(manifest.values()).find((item) => item.properties.includes('nav')) || null;
    if (navItem && zipFile(zip, navItem.href)) {
      const doc = new DOMParser().parseFromString(
        await zipFile(zip, navItem.href).async('string'),
        'text/html'
      );
      const nav =
        doc.querySelector('nav[epub\\:type="toc"], nav[*|type="toc"]') || doc.querySelector('nav');
      if (nav) {
        const entries = [];
        const walk = (list, level) => {
          for (const li of list.children) {
            const anchor = li.querySelector(':scope > a, :scope > span > a');
            const href = anchor?.getAttribute('href');
            if (anchor) {
              const target = href ? resolvePath(navItem.href, href) : '';
              entries.push({
                label: anchor.textContent.trim(),
                href: target,
                index: indexByHref.get(stripHash(target)) ?? null,
                anchor: target.includes('#') ? target.split('#')[1] : null,
                level,
              });
            }
            const nested = li.querySelector(':scope > ol, :scope > ul');
            if (nested) walk(nested, level + 1);
          }
        };
        const root = nav.querySelector('ol, ul');
        if (root) walk(root, 0);
        if (entries.length) return entries;
      }
    }

    const ncxId = spineEl?.getAttribute('toc');
    const ncxItem =
      (ncxId && manifest.get(ncxId)) ||
      Array.from(manifest.values()).find((item) => item.type.includes('ncx'));
    if (ncxItem && zipFile(zip, ncxItem.href)) {
      const doc = parseXML(await zipFile(zip, ncxItem.href).async('string'));
      const entries = [];
      const walk = (parent, level) => {
        for (const point of Array.from(parent.children).filter(
          (node) => node.tagName.toLowerCase().replace(/^ncx:/, '') === 'navpoint'
        )) {
          const label = point.querySelector('navLabel > text')?.textContent?.trim() || '';
          const src = point.querySelector('content')?.getAttribute('src') || '';
          const target = resolvePath(ncxItem.href, src);
          entries.push({
            label,
            href: target,
            index: indexByHref.get(stripHash(target)) ?? null,
            anchor: target.includes('#') ? target.split('#')[1] : null,
            level,
          });
          walk(point, level + 1);
        }
      };
      const navMap = doc.querySelector('navMap');
      if (navMap) walk(navMap, 0);
      if (entries.length) return entries;
    }

    return sections.map((section) => ({
      label: titleFromFilename(section.href.split('/').pop()),
      href: section.href,
      index: section.index,
      anchor: null,
      level: 0,
    }));
  }

  const toc = await readToc();
  // Give spine entries a human label from the table of contents.
  for (const entry of toc) {
    if (entry.index != null && !sections[entry.index].label) {
      sections[entry.index].label = entry.label;
    }
  }

  /* ------------------------------------------------------------- cover */
  async function readCover() {
    const metaCoverId = opf.querySelector('metadata > meta[name="cover"]')?.getAttribute('content');
    const candidates = [
      metaCoverId && manifest.get(metaCoverId),
      Array.from(manifest.values()).find((item) => item.properties.includes('cover-image')),
      Array.from(manifest.values()).find(
        (item) => item.type.startsWith('image/') && /cover/i.test(item.href)
      ),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const entry = zipFile(zip, candidate.href);
      if (entry) return new Blob([await entry.async('arraybuffer')], { type: candidate.type });
    }

    // Last resort: the first image referenced by the first two documents.
    for (const section of sections.slice(0, 2)) {
      const entry = zipFile(zip, section.href);
      if (!entry) continue;
      const doc = new DOMParser().parseFromString(await entry.async('string'), 'text/html');
      const src =
        doc.querySelector('img')?.getAttribute('src') ||
        doc.querySelector('image')?.getAttribute('xlink:href') ||
        doc.querySelector('image')?.getAttribute('href');
      if (!src) continue;
      const imageEntry = zipFile(zip, resolvePath(section.href, src));
      if (imageEntry) {
        const type = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg';
        return new Blob([await imageEntry.async('arraybuffer')], { type });
      }
    }
    return null;
  }

  /* ------------------------------------------------- section rendering */
  const objectUrls = new Set();
  const imageCache = new Map();

  async function imageUrl(path) {
    if (imageCache.has(path)) return imageCache.get(path);
    const entry = zipFile(zip, path);
    if (!entry) return null;
    const extension = path.split('.').pop().toLowerCase();
    const type =
      { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[
        extension
      ] || 'image/jpeg';
    const url = URL.createObjectURL(new Blob([await entry.async('arraybuffer')], { type }));
    objectUrls.add(url);
    imageCache.set(path, url);
    return url;
  }

  const BLOCKED = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'IFRAME', 'OBJECT', 'EMBED', 'BASE']);

  async function sanitise(container, basePath) {
    for (const node of Array.from(container.querySelectorAll('*'))) {
      if (BLOCKED.has(node.tagName.toUpperCase())) {
        node.remove();
        continue;
      }
      // Drop inline event handlers and author styling — the reader owns typography.
      for (const attribute of Array.from(node.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'width' || name === 'height') {
          node.removeAttribute(attribute.name);
        }
      }
    }

    for (const img of Array.from(container.querySelectorAll('img'))) {
      const src = img.getAttribute('src');
      const url = src ? await imageUrl(resolvePath(basePath, src)) : null;
      if (url) {
        img.setAttribute('src', url);
        img.setAttribute('loading', 'lazy');
      } else img.remove();
    }

    // SVG-wrapped cover images are common in EPUB 2 files.
    for (const image of Array.from(container.querySelectorAll('image'))) {
      const src =
        image.getAttribute('xlink:href') || image.getAttribute('href') || '';
      const url = src ? await imageUrl(resolvePath(basePath, src)) : null;
      const replacement = document.createElement('img');
      if (!url) {
        image.closest('svg')?.remove();
        continue;
      }
      replacement.src = url;
      replacement.alt = '';
      (image.closest('svg') || image).replaceWith(replacement);
    }

    for (const anchor of Array.from(container.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href');
      anchor.removeAttribute('href');
      if (/^[a-z]+:/i.test(href)) {
        anchor.dataset.external = href;
        anchor.setAttribute('role', 'link');
      } else if (href.startsWith('#')) {
        anchor.dataset.anchor = href.slice(1);
      } else {
        const target = resolvePath(basePath, href);
        const index = indexByHref.get(stripHash(target));
        if (index != null) {
          anchor.dataset.section = index;
          if (target.includes('#')) anchor.dataset.anchor = target.split('#')[1];
        }
      }
    }
    return container;
  }

  const sectionCache = new Map();

  async function getSection(index) {
    if (sectionCache.has(index)) return sectionCache.get(index);
    const section = sections[index];
    if (!section) throw new Error(`لا يوجد فصل بالرقم ${index}`);
    const entry = zipFile(zip, section.href);
    const raw = await entry.async('string');
    const doc = new DOMParser().parseFromString(raw, raw.includes('<?xml') ? XHTML : 'text/html');
    const body = doc.body || doc.documentElement;

    const container = document.createElement('div');
    container.append(...Array.from(body.childNodes).map((node) => document.importNode(node, true)));
    await sanitise(container, section.href);

    const text = container.textContent.replace(/\s+/g, ' ').trim();
    const result = {
      index,
      html: container.innerHTML,
      text,
      words: countWords(text),
      label: section.label || toc.find((entry) => entry.index === index)?.label || '',
    };
    sectionCache.set(index, result);
    return result;
  }

  const cover = await readCover();

  return {
    kind: 'epub',
    meta: { ...meta, cover },
    sections,
    toc,
    getSection,
    destroy() {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
      imageCache.clear();
      sectionCache.clear();
    },
  };
}
