/** The reading experience: paged text, annotations, search, read-aloud. */

import { getBook, listAnnotations, putAnnotation, deleteAnnotation, putSession, updateBook } from '../core/db.js';
import { settings, updateSettings } from '../core/state.js';
import { n, t, isRTL } from '../core/i18n.js';
import {
  clamp,
  debounce,
  el,
  escapeHtml,
  formatDuration,
  fill,
  isRTLText,
  mount,
  uid,
} from '../core/utils.js';
import { openSource } from '../formats/index.js';
import { icons } from '../ui/icons.js';
import { toast } from '../ui/feedback.js';
import { playPageTurn } from '../core/sound.js';
import { createPaginator } from './paginator.js';
import { buildAppearanceSheet } from './appearance.js';
import { createSpeaker, speechSupported, whenVoicesReady } from './tts.js';
import {
  findMatches,
  fullText,
  offsetOf,
  offsetsOfRange,
  rangeFromOffsets,
  unwrap,
  wrapRange,
} from './text-range.js';

const HIGHLIGHT_COLORS = [
  { id: 'yellow', css: 'rgb(255 214 74 / .8)' },
  { id: 'green', css: 'rgb(126 217 118 / .75)' },
  { id: 'blue', css: 'rgb(118 178 255 / .75)' },
  { id: 'pink', css: 'rgb(255 138 190 / .75)' },
  { id: 'under', css: 'transparent' },
];

const WPM = 210;

export async function createReaderView({ book: initialBook, onExit }) {
  let book = initialBook;
  const source = await openSource(book);
  const pdfMode = source.kind === 'pdf';

  let annotations = await listAnnotations(book.id);
  let sectionIndex = clamp(book.progress?.section ?? 0, 0, source.sections.length - 1);
  let currentSection = null;
  const wordsBySection = new Array(source.sections.length).fill(null);
  const sessionStart = Date.now();
  let pagesTurned = 0;

  /* =============================================================== DOM */

  const root = el('div', { class: 'reader entering', 'data-layout': settings.layout, 'data-anim': settings.pageAnim });

  const titleBlock = el(
    'div',
    { class: 'reader-title' },
    el('strong', { text: book.title }),
    el('span', { text: book.author || '' })
  );

  const btn = (name, tip, onclick, extraClass = '') =>
    el('button', {
      type: 'button',
      class: `icon-btn tooltip ${extraClass}`.trim(),
      'data-tip': tip,
      'aria-label': tip,
      html: icons[name],
      onclick,
    });

  const bookmarkButton = btn('bookmark', t('addBookmark'), () => toggleBookmark());
  const ttsButton = btn('speaker', t('readAloud'), () => toggleSpeech());
  const focusButton = btn('focus', t('focusMode'), () => {
    root.classList.toggle('focus');
    focusButton.classList.toggle('active', root.classList.contains('focus'));
  });

  const topBar = el(
    'header',
    { class: 'reader-top' },
    btn(isRTL() ? 'arrowBackRtl' : 'arrowBack', t('backToLibrary'), () => exit()),
    titleBlock,
    el('div', { class: 'spacer' }),
    btn('contents', t('contents'), () => togglePanel('toc')),
    btn('search', t('searchInBook'), () => togglePanel('search')),
    bookmarkButton,
    btn('note', t('notes'), () => togglePanel('notes')),
    speechSupported() ? ttsButton : null,
    btn('type', t('appearance'), () => toggleSheet()),
    focusButton,
    btn('expand', t('fullscreen'), () => toggleFullscreen())
  );

  const inner = el('div', { class: 'pager-inner' });
  const pager = el('div', { class: 'pager' }, inner);
  const flipLayer = el('div', { class: 'flip-layer' });
  const spread = el(
    'div',
    { class: 'spread' },
    pager,
    el('div', { class: 'gutter' }),
    el('div', { class: 'paper-grain' }),
    el('div', { class: 'vignette' }),
    flipLayer
  );

  const pdfStage = el('div', { class: 'pdf-stage' });

  const stage = el(
    'div',
    { class: 'reader-stage' },
    el('button', {
      class: 'edge-tap prev',
      type: 'button',
      'aria-label': t('prevPage'),
      html: icons[isRTL() ? 'chevronRight' : 'chevronLeft'],
      onclick: () => go(-1),
    }),
    pdfMode ? pdfStage : spread,
    el('button', {
      class: 'edge-tap next',
      type: 'button',
      'aria-label': t('nextPage'),
      html: icons[isRTL() ? 'chevronLeft' : 'chevronRight'],
      onclick: () => go(1),
    })
  );

  const pageLabel = el('span', { class: 'pageno', text: '—' });
  const chapterLabel = el('span', { class: 'pageno', style: { opacity: '.75' }, text: '' });
  const progressFill = el('i', { style: { width: '0%' } });
  const progressKnob = el('span', { class: 'knob', style: { insetInlineStart: '0%' } });
  const progressBar = el(
    'div',
    {
      class: 'reader-progress',
      role: 'slider',
      'aria-label': t('bookProgress'),
      onclick: (event) => seekFromBar(event),
    },
    progressFill,
    progressKnob
  );

  const bottomBar = el(
    'footer',
    { class: 'reader-bottom' },
    chapterLabel,
    progressBar,
    pageLabel,
    pdfMode
      ? el(
          'div',
          { class: 'row', style: { gap: '2px' } },
          btn('zoomOut', t('zoomOut'), () => zoomPdf(-0.15)),
          btn('zoomIn', t('zoomIn'), () => zoomPdf(0.15)),
          btn('fitWidth', t('fitWidth'), () => fitPdfWidth())
        )
      : null
  );

  /* -------------------------------------------------------- side panel */
  const panelBody = el('div', { class: 'panel-body' });
  const panelTabs = el('div', { class: 'panel-tabs' });
  const panel = el(
    'aside',
    { class: 'side-panel' },
    el(
      'header',
      {},
      el('h3', { text: t('contents') }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        'aria-label': t('close'),
        html: icons.x,
        onclick: () => closePanel(),
      })
    ),
    panelTabs,
    panelBody
  );

  const sheet = el('div', { class: 'reader-sheet' });

  mount(root, topBar, stage, bottomBar, panel, sheet);

  /* ============================================================ paging */

  const paginator = createPaginator({
    spread,
    pager,
    inner,
    flipLayer,
    onPageChange: () => {
      renderProgress();
      saveProgress();
    },
  });

  function layoutColumns() {
    // A two-page spread only makes sense when there is room for it, so a
    // narrow window quietly falls back to a single page.
    const wide = spread.clientWidth > 700;
    const columns = settings.layout === 'double' && wide ? 2 : 1;
    paginator.setColumns(settings.layout === 'scroll' ? 1 : columns);
    root.dataset.columns = String(settings.layout === 'scroll' ? 1 : columns);
    return columns;
  }

  /* -------------------------------------------------- section loading */

  async function loadSection(index, { page = 0, anchor = null, offset = null } = {}) {
    sectionIndex = clamp(index, 0, source.sections.length - 1);
    const section = await source.getSection(sectionIndex);
    currentSection = section;
    wordsBySection[sectionIndex] = section.words;

    inner.innerHTML = section.html || '';
    const rtlText = isRTLText(section.text || book.title);
    // Arabic script is cursive: a drop cap would detach the first letter from
    // the rest of the word, so it is only used for left-to-right text.
    inner.classList.toggle('dropcap', !rtlText && Boolean(section.html) && section.words > 120);
    paginator.setDirection(rtlText);

    // Internal links jump within the book.
    inner.querySelectorAll('a[data-section], a[data-anchor]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const target = link.dataset.section != null ? Number(link.dataset.section) : sectionIndex;
        loadSection(target, { anchor: link.dataset.anchor || null });
      });
    });

    // Images change the layout once decoded — re-measure when they land.
    inner.querySelectorAll('img').forEach((image) => {
      image.addEventListener('load', debouncedRemeasure, { once: true });
      image.addEventListener('error', () => image.remove(), { once: true });
    });

    if (settings.layout !== 'scroll') {
      layoutColumns();
      paginator.measure();
    }

    applyAnnotations();

    let targetPage = 0;
    if (anchor) {
      const element = inner.querySelector(`#${CSS.escape(anchor)}, [name="${CSS.escape(anchor)}"]`);
      if (element) targetPage = paginator.pageOfElement(element);
    } else if (offset != null) {
      targetPage = pageOfOffset(offset);
    } else if (page === 'last') {
      targetPage = paginator.pageCount - 1;
    } else if (typeof page === 'number') {
      targetPage = clamp(page, 0, paginator.pageCount - 1);
    }

    paginator.goTo(targetPage);
    if (settings.layout === 'scroll') spread.scrollTop = 0;
    chapterLabel.textContent = section.label || `${sectionIndex + 1}/${source.sections.length}`;
    renderProgress();
    renderPanel();
    preloadNeighbours();
  }

  function preloadNeighbours() {
    [sectionIndex + 1, sectionIndex - 1].forEach((index) => {
      if (index >= 0 && index < source.sections.length) {
        source
          .getSection(index)
          .then((section) => {
            wordsBySection[index] = section.words;
          })
          .catch(() => {});
      }
    });
  }

  const debouncedRemeasure = debounce(() => {
    if (settings.layout === 'scroll') return;
    const offset = offsetAtPageStart();
    layoutColumns();
    paginator.measure();
    applyAnnotations();
    if (offset != null) paginator.goTo(pageOfOffset(offset));
    renderProgress();
  }, 180);

  /* ---------------------------------------------------- page movement */

  async function go(direction) {
    if (pdfMode) return goPdf(direction);
    if (settings.layout === 'scroll') {
      spread.scrollBy({ top: direction * spread.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    if (paginator.busy) return;

    const moved = await paginator.turn(direction, settings.pageAnim);
    if (moved) {
      pagesTurned += 1;
      playPageTurn(direction === 1 ? 'forward' : 'back');
      return;
    }

    // Crossed a chapter boundary.
    const next = sectionIndex + direction;
    if (next < 0 || next >= source.sections.length) {
      if (direction === 1) markFinished();
      return;
    }
    playPageTurn(direction === 1 ? 'forward' : 'back');
    await loadSection(next, { page: direction === 1 ? 0 : 'last' });
  }

  function seekFromBar(event) {
    const rect = progressBar.getBoundingClientRect();
    let ratio = (event.clientX - rect.left) / rect.width;
    if (isRTL()) ratio = 1 - ratio;
    ratio = clamp(ratio, 0, 1);
    if (pdfMode) {
      const target = Math.round(ratio * (source.numPages - 1));
      scrollToPdfPage(target);
      return;
    }
    const target = clamp(Math.floor(ratio * source.sections.length), 0, source.sections.length - 1);
    loadSection(target, { page: 0 });
  }

  /* ------------------------------------------------------- progress */

  function sectionWeights() {
    const known = wordsBySection.filter((value) => value != null);
    const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    return wordsBySection.map((value) => value ?? average);
  }

  function computePercent() {
    if (pdfMode) return ((currentPdfPage + 1) / source.numPages) * 100;
    const weights = sectionWeights();
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const before = weights.slice(0, sectionIndex).reduce((a, b) => a + b, 0);
    const within =
      settings.layout === 'scroll'
        ? spread.scrollHeight > spread.clientHeight
          ? spread.scrollTop / (spread.scrollHeight - spread.clientHeight)
          : 1
        : (paginator.page + 1) / paginator.pageCount;
    return clamp(((before + weights[sectionIndex] * within) / total) * 100, 0, 100);
  }

  function renderProgress() {
    const percent = computePercent();
    progressFill.style.width = `${percent}%`;
    progressKnob.style.insetInlineStart = `${percent}%`;

    if (pdfMode) {
      pageLabel.textContent = `${t('page')} ${n(currentPdfPage + 1)} ${t('of')} ${n(source.numPages)}`;
    } else if (settings.layout === 'scroll') {
      pageLabel.textContent = `${Math.round(percent)}%`;
    } else {
      const columns = paginator.columns;
      const first = paginator.page * columns + 1;
      const last = Math.min(first + columns - 1, paginator.pageCount * columns);
      const label = columns > 1 && last > first ? `${n(first)}–${n(last)}` : n(first);
      const remainingWords =
        (currentSection?.words || 0) * (1 - (paginator.page + 1) / paginator.pageCount);
      const minutes = Math.round(remainingWords / WPM);
      pageLabel.textContent =
        `${label} ${t('of')} ${n(paginator.pageCount * columns)}` +
        (minutes > 0 ? ` · ${minutes} ${t('minutesLeftInChapter')}` : '');
    }
    bookmarkButton.classList.toggle('active', Boolean(findBookmarkHere()));
  }

  const saveProgress = debounce(async () => {
    const percent = computePercent();
    const patch = {
      lastOpenedAt: Date.now(),
      progress: {
        section: sectionIndex,
        page: pdfMode ? currentPdfPage : paginator.page,
        offset: pdfMode ? null : offsetAtPageStart(),
        percent,
        updatedAt: Date.now(),
      },
    };
    if (percent >= 99.5) patch.finished = true;
    book = (await updateBook(book.id, patch)) || book;
  }, 700);

  async function markFinished() {
    if (book.finished) return;
    book = (await updateBook(book.id, { finished: true, progress: { ...(book.progress || {}), percent: 100 } })) || book;
    toast(`🎉 ${book.title} — ${t('finished')}`);
  }

  /* ------------------------------------------------- offsets ↔ pages */

  function firstTextNode(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue.trim()) return node;
    }
    return null;
  }

  /** Character offset of the first block that starts on the current page. */
  function offsetAtPageStart() {
    if (pdfMode || settings.layout === 'scroll') return null;
    const page = paginator.page;
    for (const child of inner.children) {
      if (paginator.pageOfElement(child) >= page) {
        const node = firstTextNode(child);
        if (node) return offsetOf(inner, node, 0);
      }
    }
    return null;
  }

  function pageOfOffset(offset) {
    const range = rangeFromOffsets(inner, offset, Math.min(offset + 1, fullText(inner).length));
    if (!range) return 0;
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return 0;
    const pagerRect = pager.getBoundingClientRect();
    const edge = inner.dir === 'rtl' ? rect.right - pagerRect.right : rect.left - pagerRect.left;
    const layoutX = edge - (inner.dir === 'rtl' ? 1 : -1) * paginator.page * paginator.stride;
    return paginator.pageOfLayoutX(layoutX);
  }

  /* ------------------------------------------------------ annotations */

  function annotationsForSection() {
    return annotations.filter(
      (item) => item.section === sectionIndex && item.type === 'highlight'
    );
  }

  function applyAnnotations() {
    inner.querySelectorAll('mark.hl').forEach(unwrap);
    for (const item of annotationsForSection()) {
      const range = rangeFromOffsets(inner, item.start, item.end);
      if (!range) continue;
      try {
        wrapRange(range, () => {
          const mark = el('mark', {
            class: `hl${item.note ? ' has-note' : ''}`,
            'data-color': item.color || 'yellow',
            'data-id': item.id,
          });
          return mark;
        });
      } catch (error) {
        console.warn('[maktabate] could not apply highlight', error);
      }
    }
  }

  async function addHighlight({ start, end, text, color }) {
    const annotation = {
      id: uid(),
      bookId: book.id,
      type: 'highlight',
      section: sectionIndex,
      sectionLabel: currentSection?.label || '',
      start,
      end,
      text,
      color,
      note: '',
      createdAt: Date.now(),
    };
    annotations.push(annotation);
    await putAnnotation(annotation);
    applyAnnotations();
    renderPanel();
    return annotation;
  }

  async function removeAnnotation(id) {
    annotations = annotations.filter((item) => item.id !== id);
    await deleteAnnotation(id);
    applyAnnotations();
    renderPanel();
  }

  async function saveNote(id, note) {
    const item = annotations.find((entry) => entry.id === id);
    if (!item) return;
    item.note = note;
    await putAnnotation(item);
    applyAnnotations();
    renderPanel();
  }

  function findBookmarkHere() {
    return annotations.find(
      (item) =>
        item.type === 'bookmark' &&
        item.section === sectionIndex &&
        (pdfMode ? item.page === currentPdfPage : item.page === paginator.page)
    );
  }

  async function toggleBookmark() {
    const existing = findBookmarkHere();
    if (existing) {
      await removeAnnotation(existing.id);
      toast(t('bookmarkRemoved'));
    } else {
      const annotation = {
        id: uid(),
        bookId: book.id,
        type: 'bookmark',
        section: sectionIndex,
        sectionLabel: currentSection?.label || (pdfMode ? `${currentPdfPage + 1}` : ''),
        page: pdfMode ? currentPdfPage : paginator.page,
        offset: pdfMode ? null : offsetAtPageStart(),
        text: pdfMode ? '' : previewTextOfPage(),
        createdAt: Date.now(),
      };
      annotations.push(annotation);
      await putAnnotation(annotation);
      toast(t('bookmarkAdded'));
      renderPanel();
    }
    renderProgress();
  }

  function previewTextOfPage() {
    const offset = offsetAtPageStart();
    if (offset == null) return '';
    return fullText(inner).slice(offset, offset + 110).trim();
  }

  /* --------------------------------------------------- selection menu */

  let selectionMenu = null;

  function hideSelectionMenu() {
    selectionMenu?.remove();
    selectionMenu = null;
  }

  function showSelectionMenu(rect, actions) {
    hideSelectionMenu();
    const menu = el('div', { class: 'sel-menu' });
    for (const action of actions) {
      if (action.swatch) {
        mount(menu, 
          el('button', {
            type: 'button',
            class: 'swatch',
            'aria-label': action.label,
            style: {
              background: action.swatch,
              boxShadow: action.id === 'under' ? 'inset 0 -3px 0 var(--accent)' : 'none',
            },
            onclick: action.onClick,
          })
        );
      } else if (action.sep) {
        mount(menu, el('span', { class: 'sep' }));
      } else {
        mount(menu, 
          el('button', {
            type: 'button',
            class: 'icon-btn',
            'aria-label': action.label,
            'data-tip': action.label,
            html: icons[action.icon],
            onclick: action.onClick,
          })
        );
      }
    }
    mount(stage, menu);
    const stageRect = stage.getBoundingClientRect();
    const left = clamp(
      rect.left - stageRect.left + rect.width / 2 - menu.offsetWidth / 2,
      8,
      stageRect.width - menu.offsetWidth - 8
    );
    const top = rect.top - stageRect.top - menu.offsetHeight - 12;
    menu.style.left = `${left}px`;
    menu.style.top = `${top < 8 ? rect.bottom - stageRect.top + 12 : top}px`;
    selectionMenu = menu;
  }

  function onSelectionEnd(event) {
    if (event?.target?.closest?.('.sel-menu')) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      if (!event?.target?.closest?.('mark.hl')) hideSelectionMenu();
      return;
    }
    const range = selection.getRangeAt(0);
    const offsets = offsetsOfRange(inner, range);
    if (!offsets || offsets.start === offsets.end) return;
    const text = selection.toString().trim();
    if (!text) return;
    const rect = range.getBoundingClientRect();

    showSelectionMenu(rect, [
      ...HIGHLIGHT_COLORS.map((color) => ({
        id: color.id,
        swatch: color.css,
        label: `${t('highlight')} ${color.id}`,
        onClick: async () => {
          await addHighlight({ ...offsets, text, color: color.id });
          selection.removeAllRanges();
          hideSelectionMenu();
        },
      })),
      { sep: true },
      {
        icon: 'note',
        label: t('addNote'),
        onClick: async () => {
          const annotation = await addHighlight({ ...offsets, text, color: 'yellow' });
          selection.removeAllRanges();
          hideSelectionMenu();
          openNoteEditor(annotation);
        },
      },
      {
        icon: 'copy',
        label: t('copy'),
        onClick: async () => {
          await navigator.clipboard?.writeText(text).catch(() => {});
          toast(t('copied'));
          hideSelectionMenu();
        },
      },
      {
        icon: 'speaker',
        label: t('speakSelection'),
        onClick: () => {
          startSpeech(text, offsets.start);
          hideSelectionMenu();
        },
      },
    ]);
  }

  inner.addEventListener('mouseup', onSelectionEnd);
  inner.addEventListener('touchend', () => setTimeout(onSelectionEnd, 10));

  inner.addEventListener('click', (event) => {
    const mark = event.target.closest('mark.hl');
    if (!mark) return;
    const annotation = annotations.find((item) => item.id === mark.dataset.id);
    if (!annotation) return;
    const rect = mark.getBoundingClientRect();
    showSelectionMenu(rect, [
      ...HIGHLIGHT_COLORS.map((color) => ({
        id: color.id,
        swatch: color.css,
        label: color.id,
        onClick: async () => {
          annotation.color = color.id;
          await putAnnotation(annotation);
          applyAnnotations();
          hideSelectionMenu();
        },
      })),
      { sep: true },
      { icon: 'note', label: t('addNote'), onClick: () => { hideSelectionMenu(); openNoteEditor(annotation); } },
      {
        icon: 'copy',
        label: t('copy'),
        onClick: async () => {
          await navigator.clipboard?.writeText(annotation.text).catch(() => {});
          toast(t('copied'));
          hideSelectionMenu();
        },
      },
      {
        icon: 'trash',
        label: t('deleteHighlight'),
        onClick: async () => {
          await removeAnnotation(annotation.id);
          hideSelectionMenu();
        },
      },
    ]);
  });

  function openNoteEditor(annotation) {
    openPanel('notes');
    setTimeout(() => {
      const card = panelBody.querySelector(`[data-note-id="${annotation.id}"] textarea`);
      card?.focus({ preventScroll: true });
    }, 60);
  }

  /* --------------------------------------------------------- panels */

  let panelTab = 'toc';
  let searchState = { query: '', results: [], running: false };

  function openPanel(tab) {
    panelTab = tab;
    panel.classList.add('open');
    root.classList.add('panel-open');
    // The reading area narrows, so the columns have to be re-measured.
    setTimeout(relayout, 340);
    renderPanel();
    if (tab === 'search') setTimeout(() => panelBody.querySelector('input')?.focus(), 80);
  }

  function closePanel() {
    panel.classList.remove('open');
    root.classList.remove('panel-open');
    setTimeout(relayout, 340);
  }

  function togglePanel(tab) {
    if (panel.classList.contains('open') && panelTab === tab) closePanel();
    else openPanel(tab);
  }

  function renderPanel() {
    if (!panel.classList.contains('open')) return;
    const tabs = [
      { id: 'toc', label: t('contents') },
      { id: 'notes', label: t('notes') },
      { id: 'bookmarks', label: t('bookmarks') },
      { id: 'search', label: t('search') },
    ];
    fill(panelTabs, 
      ...tabs.map((tab) =>
        el('button', {
          type: 'button',
          class: panelTab === tab.id ? 'active' : '',
          text: tab.label,
          onclick: () => {
            panelTab = tab.id;
            renderPanel();
          },
        })
      )
    );
    panel.querySelector('header h3').textContent =
      tabs.find((tab) => tab.id === panelTab)?.label || '';

    if (panelTab === 'toc') renderToc();
    else if (panelTab === 'notes') renderNotes();
    else if (panelTab === 'bookmarks') renderBookmarks();
    else renderSearch();
  }

  function renderToc() {
    const entries = source.toc.length ? source.toc : source.sections;
    fill(panelBody, 
      ...entries.map((entry) =>
        el('button', {
          type: 'button',
          class: `toc-item${entry.index === sectionIndex ? ' current' : ''}`,
          'data-level': String(entry.level || 0),
          text: entry.label || '—',
          onclick: () => {
            if (pdfMode) scrollToPdfPage(entry.index ?? 0);
            else loadSection(entry.index ?? 0, { anchor: entry.anchor });
            if (window.innerWidth < 900) closePanel();
          },
        })
      )
    );
  }

  function renderNotes() {
    const list = annotations
      .filter((item) => item.type === 'highlight')
      .sort((a, b) => a.section - b.section || a.start - b.start);

    if (!list.length) {
      fill(panelBody, el('p', { class: 'empty-note', text: t('noHighlights') }));
      return;
    }

    fill(panelBody, 
      ...list.map((item) => {
        const textarea = el('textarea', {
          placeholder: t('notePlaceholder'),
          rows: '2',
          style: { display: item.note ? 'block' : 'none', marginTop: '6px' },
        });
        textarea.value = item.note || '';
        textarea.addEventListener(
          'input',
          debounce(() => saveNote(item.id, textarea.value.trim()), 500)
        );

        return el(
          'article',
          { class: 'note-card', 'data-note-id': item.id },
          el('div', {
            class: 'quote',
            style: { borderColor: `var(--accent)` },
            text: item.text,
          }),
          textarea,
          el(
            'footer',
            {},
            el('span', { text: item.sectionLabel || `${item.section + 1}` }),
            el('span', { class: 'spacer' }),
            el('button', {
              class: 'icon-btn',
              type: 'button',
              'aria-label': t('addNote'),
              html: icons.note,
              onclick: () => {
                textarea.style.display = 'block';
                textarea.focus();
              },
            }),
            el('button', {
              class: 'icon-btn',
              type: 'button',
              'aria-label': t('copy'),
              html: icons.copy,
              onclick: async () => {
                await navigator.clipboard?.writeText(item.text).catch(() => {});
                toast(t('copied'));
              },
            }),
            el('button', {
              class: 'icon-btn',
              type: 'button',
              'aria-label': t('deleteHighlight'),
              html: icons.trash,
              onclick: () => removeAnnotation(item.id),
            })
          ),
          el('button', {
            class: 'btn small ghost',
            type: 'button',
            text: t('read'),
            onclick: () => jumpToAnnotation(item),
          })
        );
      })
    );
  }

  function renderBookmarks() {
    const list = annotations
      .filter((item) => item.type === 'bookmark')
      .sort((a, b) => a.section - b.section || (a.page || 0) - (b.page || 0));
    if (!list.length) {
      fill(panelBody, el('p', { class: 'empty-note', text: t('noBookmarks') }));
      return;
    }
    fill(panelBody, 
      ...list.map((item) =>
        el(
          'article',
          { class: 'note-card', onclick: () => jumpToAnnotation(item) },
          el('div', { class: 'row between' },
            el('strong', { class: 'tiny', text: item.sectionLabel || `${item.section + 1}` }),
            el('button', {
              class: 'icon-btn',
              type: 'button',
              'aria-label': t('removeBookmark'),
              html: icons.trash,
              onclick: (event) => {
                event.stopPropagation();
                removeAnnotation(item.id);
              },
            })
          ),
          item.text ? el('p', { class: 'tiny muted', text: `${item.text}…` }) : null
        )
      )
    );
  }

  async function jumpToAnnotation(item) {
    if (pdfMode) {
      scrollToPdfPage(item.page || 0);
    } else {
      await loadSection(item.section, { offset: item.start ?? item.offset ?? 0 });
    }
    if (window.innerWidth < 900) closePanel();
  }

  /* ------------------------------------------------------ book search */

  async function runSearch(query) {
    searchState = { query, results: [], running: true };
    renderPanel();
    const results = [];
    for (let index = 0; index < source.sections.length; index++) {
      let section;
      try {
        section = await source.getSection(index);
      } catch {
        continue;
      }
      wordsBySection[index] = section.words;
      const matches = findMatches(section.text, query);
      for (const match of matches.slice(0, 40)) {
        results.push({
          section: index,
          label: section.label || `${index + 1}`,
          start: match.start,
          end: match.end,
          before: section.text.slice(Math.max(0, match.start - 45), match.start),
          hit: section.text.slice(match.start, match.end),
          after: section.text.slice(match.end, match.end + 60),
        });
      }
      if (results.length > 400) break;
      if (index % 12 === 0) {
        searchState.results = results.slice();
        renderPanel();
      }
    }
    searchState = { query, results, running: false };
    renderPanel();
  }

  function renderSearch() {
    const input = el('input', {
      type: 'search',
      placeholder: t('searchInBookPlaceholder'),
      value: searchState.query,
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runSearch(input.value.trim());
      event.stopPropagation();
    });

    const results = el('div', { class: 'stack', style: { marginTop: '10px' } });
    if (searchState.running) {
      mount(results, el('p', { class: 'empty-note', text: t('loading') }));
    } else if (searchState.query && !searchState.results.length) {
      mount(results, el('p', { class: 'empty-note', text: t('noMatches') }));
    } else if (searchState.results.length) {
      mount(results, 
        el('p', {
          class: 'tiny muted',
          text: `${n(searchState.results.length)} ${t('matches')}`,
        })
      );
      for (const result of searchState.results.slice(0, 200)) {
        mount(results, 
          el('div', {
            class: 'search-hit-card',
            html: `<span class="where">${escapeHtml(result.label)}</span>…${escapeHtml(
              result.before
            )}<b>${escapeHtml(result.hit)}</b>${escapeHtml(result.after)}…`,
            onclick: () => {
              if (pdfMode) scrollToPdfPage(result.section);
              else loadSection(result.section, { offset: result.start });
              if (window.innerWidth < 900) closePanel();
            },
          })
        );
      }
    }
    fill(panelBody, input, results);
  }

  /* ------------------------------------------------------- read aloud */

  const speaker = createSpeaker();
  let ttsBar = null;
  let ttsMark = null;

  function clearTtsMark() {
    if (ttsMark) {
      unwrap(ttsMark);
      ttsMark = null;
    }
  }

  function highlightSpokenWord(offset, length) {
    clearTtsMark();
    if (pdfMode || !length) return;
    const range = rangeFromOffsets(inner, offset, offset + Math.max(1, length));
    if (!range) return;
    try {
      const [mark] = wrapRange(range, () => el('span', { class: 'tts-word' }));
      ttsMark = mark || null;
      if (mark && settings.layout !== 'scroll') {
        const page = paginator.pageOfElement(mark);
        if (page !== paginator.page) paginator.goTo(page, { animate: true });
      } else if (mark) {
        const markRect = mark.getBoundingClientRect();
        const spreadRect = spread.getBoundingClientRect();
        spread.scrollBy({
          top: markRect.top - spreadRect.top - spreadRect.height / 2,
          behavior: 'smooth',
        });
      }
    } catch {
      /* the word straddles markup — skip the highlight for this one */
    }
  }

  async function startSpeech(explicitText, explicitOffset) {
    if (!speechSupported()) return;
    await whenVoicesReady();
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((voice) => voice.voiceURI === settings.ttsVoice) ||
      voices.find((voice) => voice.lang?.startsWith(book.language?.slice(0, 2) || 'ar')) ||
      voices.find((voice) => voice.lang?.startsWith('ar')) ||
      voices[0];

    let text = explicitText;
    let offset = explicitOffset || 0;
    if (!text) {
      if (pdfMode) {
        text = (await source.getSection(currentPdfPage)).text;
        offset = 0;
      } else {
        offset = offsetAtPageStart() || 0;
        text = fullText(inner).slice(offset);
      }
    }
    if (!text?.trim()) return;

    speaker.start(text, {
      offset,
      rate: settings.ttsRate,
      voice: preferred,
      lang: preferred?.lang,
      onWord: (charIndex, length) => highlightSpokenWord(charIndex, length),
      onEnd: async () => {
        clearTtsMark();
        if (!pdfMode && sectionIndex < source.sections.length - 1 && speakThroughChapters) {
          await loadSection(sectionIndex + 1, { page: 0 });
          startSpeech();
        } else {
          stopSpeech();
        }
      },
    });
    showTtsBar();
    ttsButton.classList.add('active');
  }

  let speakThroughChapters = true;

  function stopSpeech() {
    speaker.stop();
    clearTtsMark();
    ttsBar?.remove();
    ttsBar = null;
    ttsButton.classList.remove('active');
  }

  function toggleSpeech() {
    if (speaker.speaking) stopSpeech();
    else startSpeech();
  }

  function showTtsBar() {
    ttsBar?.remove();
    const playPause = el('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': t('stopReading'),
      html: icons.pause,
      onclick: () => {
        if (speaker.paused) {
          speaker.resume();
          playPause.innerHTML = icons.pause;
        } else {
          speaker.pause();
          playPause.innerHTML = icons.play;
        }
      },
    });

    const rate = el('input', {
      type: 'range',
      min: '0.6',
      max: '1.8',
      step: '0.1',
      value: String(settings.ttsRate),
      style: { width: '90px' },
    });
    rate.addEventListener('change', () => {
      updateSettings({ ttsRate: Number(rate.value) });
      if (speaker.speaking) startSpeech();
    });

    ttsBar = el(
      'div',
      { class: 'tts-bar' },
      el(
        'div',
        { class: 'tts-inner' },
        el('span', { html: icons.speaker, style: { width: '18px', display: 'grid' } }),
        playPause,
        rate,
        el('button', {
          class: 'icon-btn',
          type: 'button',
          'aria-label': t('stopReading'),
          html: icons.stop,
          onclick: stopSpeech,
        })
      )
    );
    mount(root, ttsBar);
  }

  /* ------------------------------------------------------- appearance */

  function toggleSheet() {
    if (sheet.classList.contains('open')) {
      sheet.classList.remove('open');
      return;
    }
    fill(sheet, 
      buildAppearanceSheet({
        onChange: (patch) => {
          updateSettings(patch);
          root.dataset.layout = settings.layout;
          root.dataset.anim = settings.pageAnim;
          relayout();
        },
        onClose: () => sheet.classList.remove('open'),
      })
    );
    sheet.classList.add('open');
  }

  function relayout() {
    if (pdfMode) return;
    const offset = offsetAtPageStart();
    if (settings.layout === 'scroll') {
      inner.style.transform = '';
      inner.style.columnCount = '1';
      renderProgress();
      return;
    }
    layoutColumns();
    paginator.measure();
    applyAnnotations();
    if (offset != null) paginator.goTo(pageOfOffset(offset));
    renderProgress();
  }

  /* -------------------------------------------------------------- PDF */

  let currentPdfPage = pdfMode ? clamp(book.progress?.page ?? 0, 0, source.numPages - 1) : 0;
  let pdfScale = 1;
  const pdfPageNodes = [];

  function buildPdfPages() {
    fill(pdfStage);
    pdfPageNodes.length = 0;
    for (let index = 0; index < source.numPages; index++) {
      const canvas = el('canvas');
      const wrapper = el(
        'div',
        { class: 'pdf-page', 'data-page': String(index) },
        canvas,
        el('span', { class: 'pdf-num', text: String(index + 1) })
      );
      // Placeholder height keeps the scrollbar honest before rendering.
      wrapper.style.minHeight = `${Math.round(pdfViewportHeight() * 0.98)}px`;
      wrapper.style.width = `${Math.round(pdfViewportHeight() * 0.7 * pdfScale)}px`;
      mount(pdfStage, wrapper);
      pdfPageNodes.push({ wrapper, canvas, rendered: false, rendering: false });
    }
    observePdfPages();
  }

  const pdfViewportHeight = () => pdfStage.clientHeight - 40;

  async function renderPdfPage(index) {
    const entry = pdfPageNodes[index];
    if (!entry || entry.rendering) return;
    entry.rendering = true;
    try {
      const height = pdfViewportHeight() * pdfScale;
      const width = pdfStage.clientWidth * 0.92 * pdfScale;
      const size = await source.renderPage(index, entry.canvas, { width, height });
      entry.wrapper.style.minHeight = `${size.height}px`;
      entry.wrapper.style.width = `${size.width}px`;
      entry.rendered = true;
    } catch (error) {
      console.warn('[maktabate] pdf render failed', error);
    } finally {
      entry.rendering = false;
    }
  }

  let pdfObserver = null;
  function observePdfPages() {
    pdfObserver?.disconnect();
    // Render pages shortly before they scroll into view.
    pdfObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) renderPdfPage(Number(entry.target.dataset.page));
        }
      },
      { root: pdfStage, rootMargin: '400px 0px', threshold: 0 }
    );
    pdfPageNodes.forEach((entry) => pdfObserver.observe(entry.wrapper));
  }

  /** The page occupying the top of the viewport is the one you are reading. */
  const trackPdfPage = debounce(() => {
    const top = pdfStage.scrollTop + 60;
    let candidate = 0;
    for (let index = 0; index < pdfPageNodes.length; index++) {
      if (pdfPageNodes[index].wrapper.offsetTop <= top) candidate = index;
      else break;
    }
    if (candidate === currentPdfPage) return;
    currentPdfPage = candidate;
    renderProgress();
    saveProgress();
  }, 160);

  function scrollToPdfPage(index) {
    const target = clamp(index, 0, pdfPageNodes.length - 1);
    const entry = pdfPageNodes[target];
    if (!entry) return;
    // Scroll the stage itself — scrollIntoView would also scroll the reader.
    pdfStage.scrollTo({ top: Math.max(0, entry.wrapper.offsetTop - 12), behavior: 'smooth' });
    renderPdfPage(target);
    currentPdfPage = target;
    renderProgress();
    saveProgress();
  }

  function goPdf(direction) {
    scrollToPdfPage(currentPdfPage + direction);
    playPageTurn(direction === 1 ? 'forward' : 'back');
  }

  function zoomPdf(delta) {
    pdfScale = clamp(pdfScale + delta, 0.5, 3);
    pdfPageNodes.forEach((entry) => {
      entry.rendered = false;
      renderPdfPage(pdfPageNodes.indexOf(entry));
    });
  }

  function fitPdfWidth() {
    pdfScale = 1.6;
    zoomPdf(0);
  }

  /* --------------------------------------------------------- keyboard */

  function onKeyDown(event) {
    if (event.target.matches('input, textarea, select')) return;
    const forward = isRTL() ? 'ArrowLeft' : 'ArrowRight';
    const back = isRTL() ? 'ArrowRight' : 'ArrowLeft';

    switch (event.key) {
      case forward:
      case 'PageDown':
      case ' ':
        event.preventDefault();
        go(1);
        break;
      case back:
      case 'PageUp':
        event.preventDefault();
        go(-1);
        break;
      case 'ArrowUp':
        if (settings.layout === 'scroll') return;
        event.preventDefault();
        go(-1);
        break;
      case 'ArrowDown':
        if (settings.layout === 'scroll') return;
        event.preventDefault();
        go(1);
        break;
      case 'Home':
        event.preventDefault();
        pdfMode ? scrollToPdfPage(0) : loadSection(0, { page: 0 });
        break;
      case 'End':
        event.preventDefault();
        pdfMode
          ? scrollToPdfPage(source.numPages - 1)
          : loadSection(source.sections.length - 1, { page: 'last' });
        break;
      case 'Escape':
        if (panel.classList.contains('open')) closePanel();
        else if (sheet.classList.contains('open')) sheet.classList.remove('open');
        else if (root.classList.contains('focus')) focusButton.click();
        else exit();
        break;
      case 'f':
      case 'F':
        focusButton.click();
        break;
      case 'b':
      case 'B':
        toggleBookmark();
        break;
      case 't':
      case 'T':
        togglePanel('toc');
        break;
      case '/':
        event.preventDefault();
        togglePanel('search');
        break;
      case 'a':
      case 'A':
        toggleSheet();
        break;
      case 's':
      case 'S':
        toggleSpeech();
        break;
      case '+':
      case '=':
        updateSettings({ fontSize: clamp(settings.fontSize + 1, 13, 42) });
        relayout();
        break;
      case '-':
        updateSettings({ fontSize: clamp(settings.fontSize - 1, 13, 42) });
        relayout();
        break;
      default:
        break;
    }
  }
  document.addEventListener('keydown', onKeyDown);

  /* ------------------------------------------------- pointer gestures */

  let touchStart = null;
  stage.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) return;
      touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
    },
    { passive: true }
  );
  stage.addEventListener(
    'touchend',
    (event) => {
      if (!touchStart || pdfMode || settings.layout === 'scroll') return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      const elapsed = Date.now() - touchStart.at;
      touchStart = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4 || elapsed > 800) return;
      if (window.getSelection()?.toString()) return;
      const forward = isRTL() ? dx > 0 : dx < 0;
      go(forward ? 1 : -1);
    },
    { passive: true }
  );

  // Click on the outer thirds of the page to turn, like a paper book.
  spread.addEventListener('click', (event) => {
    if (pdfMode || settings.layout === 'scroll') return;
    if (event.target.closest('a, mark, .sel-menu, button')) return;
    if (window.getSelection()?.toString()) return;
    const rect = spread.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    if (ratio > 0.72) go(isRTL() ? -1 : 1);
    else if (ratio < 0.28) go(isRTL() ? 1 : -1);
  });

  stage.addEventListener(
    'wheel',
    (event) => {
      if (pdfMode || settings.layout === 'scroll') return;
      if (Math.abs(event.deltaY) < 24 || paginator.busy) return;
      event.preventDefault();
      go(event.deltaY > 0 ? 1 : -1);
    },
    { passive: false }
  );

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  /* -------------------------------------------------------- lifecycle */

  const onResize = debounce(() => {
    if (pdfMode) {
      pdfPageNodes.forEach((entry, index) => {
        entry.rendered = false;
        if (Math.abs(index - currentPdfPage) < 3) renderPdfPage(index);
      });
    } else {
      relayout();
    }
  }, 260);
  window.addEventListener('resize', onResize);

  const scrollProgress = debounce(() => {
    if (settings.layout !== 'scroll' || pdfMode) return;
    renderProgress();
    saveProgress();
  }, 200);
  spread.addEventListener('scroll', scrollProgress);
  if (pdfMode) pdfStage.addEventListener('scroll', trackPdfPage, { passive: true });

  // Nothing may scroll the reader frame itself: browser-driven scrolling (a
  // focused field in a drawer, scrollIntoView on a mark) would shift the whole
  // interface out of view.
  root.addEventListener('scroll', () => {
    root.scrollTop = 0;
    root.scrollLeft = 0;
  });

  async function saveSession() {
    const ms = Date.now() - sessionStart;
    if (ms < 8000) return;
    await putSession({
      id: uid(),
      bookId: book.id,
      startedAt: sessionStart,
      endedAt: Date.now(),
      ms,
      pages: pagesTurned,
    });
  }

  async function exit() {
    await saveProgress.flush?.();
    saveProgress();
    await saveSession();
    destroy();
    onExit?.();
  }

  function destroy() {
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    spread.removeEventListener('scroll', scrollProgress);
    stopSpeech();
    pdfObserver?.disconnect();
    source.destroy?.();
    hideSelectionMenu();
    root.remove();
  }

  window.addEventListener('beforeunload', () => {
    saveSession();
  });

  /* ------------------------------------------------------------- boot */

  if (pdfMode) {
    buildPdfPages();
    requestAnimationFrame(() => {
      renderPdfPage(currentPdfPage);
      scrollToPdfPage(currentPdfPage);
      renderProgress();
    });
  } else {
    await loadSection(sectionIndex, {
      offset: book.progress?.offset ?? null,
      page: book.progress?.offset != null ? 0 : book.progress?.page ?? 0,
    });
    // A second measure once fonts have settled avoids off-by-one pages.
    document.fonts?.ready?.then(() => debouncedRemeasure());
  }

  book = (await getBook(book.id)) || book;
  updateBook(book.id, { lastOpenedAt: Date.now() });
  setTimeout(() => root.classList.remove('entering'), 600);

  return {
    element: root,
    destroy,
    exit,
    get readingTime() {
      return formatDuration(Date.now() - sessionStart);
    },
  };
}
