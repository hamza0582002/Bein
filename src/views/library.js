/** The library: shelves, cover grid and list, with filtering and import. */

import { deleteBook, listBooks, putBook, updateBook } from '../core/db.js';
import { emit, on, settings, updateSettings } from '../core/state.js';
import { n, t } from '../core/i18n.js';
import { debounce, el, fill, formatBytes, formatDate, mount } from '../core/utils.js';
import { ACCEPT_ATTR, importFiles } from '../formats/index.js';
import { icons } from '../ui/icons.js';
import { confirmDialog, modal, toast } from '../ui/feedback.js';
import { buildBook3D, shelfSize } from '../ui/book3d.js';
import { coverUrl, releaseCover } from '../ui/covers.js';
import { openDetail } from './detail.js';
import { playShelfPull } from '../core/sound.js';

const FILTERS = [
  { id: 'all', icon: 'book', label: 'all' },
  { id: 'reading', icon: 'bookOpen', label: 'reading' },
  { id: 'favorites', icon: 'star', label: 'favorites' },
  { id: 'finished', icon: 'check', label: 'finished' },
  { id: 'unread', icon: 'layers', label: 'unread' },
];

const SORTS = ['recent', 'added', 'title', 'author', 'progress'];

export function createLibraryView({ onOpenBook, onShowStats, onShowSettings }) {
  let books = [];
  let query = '';

  const root = el('div', { class: 'library' });

  /* ------------------------------------------------------------ header */
  const searchInput = el('input', {
    type: 'search',
    placeholder: t('searchPlaceholder'),
    'aria-label': t('search'),
  });
  searchInput.addEventListener(
    'input',
    debounce(() => {
      query = searchInput.value.trim().toLowerCase();
      renderBooks();
    }, 140)
  );

  const viewButtons = ['shelf', 'grid', 'list'].map((mode) =>
    el('button', {
      type: 'button',
      class: `icon-btn tooltip${settings.view === mode ? ' active' : ''}`,
      'data-view': mode,
      'data-tip': t(`${mode}View`),
      html: icons[mode === 'shelf' ? 'shelf' : mode === 'grid' ? 'grid' : 'list'],
      onclick: () => {
        updateSettings({ view: mode });
        viewButtons.forEach((button) =>
          button.classList.toggle('active', button.dataset.view === mode)
        );
        renderBooks();
      },
    })
  );

  const header = el(
    'header',
    { class: 'lib-header' },
    el(
      'div',
      { class: 'brand' },
      el('span', { class: 'mark', html: icons.logo }),
      el('div', {}, el('div', { text: t('appName') }), el('small', { text: t('tagline') }))
    ),
    el('div', { class: 'lib-search' }, searchInput, el('span', { html: icons.search })),
    el('div', { class: 'spacer' }),
    ...viewButtons,
    el('button', {
      type: 'button',
      class: 'icon-btn tooltip',
      'data-tip': t('statistics'),
      html: icons.chart,
      onclick: onShowStats,
    }),
    el('button', {
      type: 'button',
      class: 'icon-btn tooltip',
      'data-tip': t('settings'),
      html: icons.gear,
      onclick: onShowSettings,
    }),
    el(
      'button',
      { type: 'button', class: 'btn primary', onclick: () => pickAndImport() },
      el('span', { html: icons.plus }),
      t('addBooks')
    )
  );

  /* ----------------------------------------------------------- sidebar */
  const sidebar = el('aside', { class: 'lib-side' });

  /* -------------------------------------------------------------- main */
  const toolbar = el('div', { class: 'lib-toolbar' });
  const continueStrip = el('div', { class: 'continue-strip' });
  const listHost = el('div', {});
  const main = el('main', { class: 'lib-main' }, toolbar, continueStrip, listHost);

  mount(root, header, el('div', { class: 'lib-body' }, sidebar, main));

  /* ------------------------------------------------------------ import */
  async function pickAndImport(files) {
    const chosen = files?.length
      ? files
      : await new Promise((resolve) => {
          const input = el('input', {
            type: 'file',
            accept: ACCEPT_ATTR,
            multiple: true,
            style: { display: 'none' },
          });
          input.addEventListener('change', () => {
            resolve(Array.from(input.files || []));
            input.remove();
          });
          mount(document.body, input);
          input.click();
        });
    if (!chosen.length) return;

    const dismiss = toast(`${t('importing')} (${chosen.length})`, { duration: 999000 });
    const added = [];

    await importFiles(chosen, {
      onResult: (result, file) => {
        if (result.book) added.push(result.book);
        else if (result.duplicate) toast(`${t('duplicateBook')}: ${result.duplicate.title}`);
        else toast(`${t('importFailed')}: ${file.name} — ${t(result.error) || result.error}`, { duration: 5000 });
      },
    });

    dismiss();
    if (added.length) {
      toast(`${t('imported')}: ${n(added.length)} ${t('booksCount')}`);
      await refresh();
      // Nudge the freshly added book so it is easy to spot on the shelf.
      const first = root.querySelector(`[data-book-id="${added[0].id}"]`);
      first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      first?.animate(
        [{ filter: 'brightness(1)' }, { filter: 'brightness(1.5)' }, { filter: 'brightness(1)' }],
        { duration: 1200, iterations: 2 }
      );
    }
  }

  /* ----------------------------------------------------------- filters */
  function currentBooks() {
    let list = books.slice();

    if (query) {
      list = list.filter((book) =>
        [book.title, book.author, book.publisher, ...(book.tags || [])]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query))
      );
    }

    const filter = settings.filter || 'all';
    if (filter === 'favorites') list = list.filter((book) => book.favorite);
    else if (filter === 'finished') list = list.filter((book) => book.finished);
    else if (filter === 'reading')
      list = list.filter((book) => !book.finished && (book.progress?.percent || 0) > 0);
    else if (filter === 'unread')
      list = list.filter((book) => !(book.progress?.percent > 0) && !book.finished);
    else if (filter.startsWith('collection:')) {
      const name = filter.slice('collection:'.length);
      list = list.filter((book) => book.collection === name);
    }

    const sort = settings.sort || 'recent';
    const compare = {
      recent: (a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt),
      added: (a, b) => b.addedAt - a.addedAt,
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'ar'),
      author: (a, b) => (a.author || '').localeCompare(b.author || '', 'ar'),
      progress: (a, b) => (b.progress?.percent || 0) - (a.progress?.percent || 0),
    }[sort];
    return list.sort(compare);
  }

  function renderSidebar() {
    fill(sidebar);
    const countOf = (id) => {
      if (id === 'all') return books.length;
      if (id === 'favorites') return books.filter((book) => book.favorite).length;
      if (id === 'finished') return books.filter((book) => book.finished).length;
      if (id === 'reading')
        return books.filter((book) => !book.finished && (book.progress?.percent || 0) > 0).length;
      if (id === 'unread')
        return books.filter((book) => !(book.progress?.percent > 0) && !book.finished).length;
      return 0;
    };

    for (const filter of FILTERS) {
      mount(sidebar, 
        el(
          'button',
          {
            type: 'button',
            class: `nav-item${settings.filter === filter.id ? ' active' : ''}`,
            onclick: () => {
              updateSettings({ filter: filter.id });
              renderSidebar();
              renderBooks();
            },
          },
          el('span', { html: icons[filter.icon] }),
          el('span', { text: t(filter.label) }),
          el('span', { class: 'count', text: n(countOf(filter.id)) })
        )
      );
    }

    const collections = Array.from(
      new Set(books.map((book) => book.collection).filter(Boolean))
    ).sort();

    mount(sidebar, el('div', { class: 'section-title', text: t('collections') }));
    if (!collections.length) {
      mount(sidebar, 
        el('p', { class: 'tiny muted', style: { padding: '0 12px' } }, t('newCollection'))
      );
    }
    for (const name of collections) {
      const id = `collection:${name}`;
      mount(sidebar, 
        el(
          'button',
          {
            type: 'button',
            class: `nav-item${settings.filter === id ? ' active' : ''}`,
            onclick: () => {
              updateSettings({ filter: id });
              renderSidebar();
              renderBooks();
            },
          },
          el('span', { html: icons.folder }),
          el('span', { text: name }),
          el('span', {
            class: 'count',
            text: n(books.filter((book) => book.collection === name).length),
          })
        )
      );
    }
  }

  /* ------------------------------------------------------------ toolbar */
  function renderToolbar(count) {
    fill(toolbar, 
      el('h1', { text: filterTitle() }),
      el('span', { class: 'count-pill', text: `${n(count)} ${t('booksCount')}` }),
      el('div', { class: 'spacer' }),
      el(
        'label',
        { class: 'row tiny muted', style: { gap: '6px' } },
        t('sortBy'),
        el(
          'select',
          {
            style: { width: 'auto' },
            onchange: (event) => {
              updateSettings({ sort: event.target.value });
              renderBooks();
            },
          },
          ...SORTS.map((sort) =>
            el(
              'option',
              { value: sort, selected: settings.sort === sort },
              t(`sort${sort[0].toUpperCase()}${sort.slice(1)}`)
            )
          )
        )
      )
    );
  }

  function filterTitle() {
    const filter = settings.filter || 'all';
    if (filter.startsWith('collection:')) return filter.slice('collection:'.length);
    return filter === 'all' ? t('myLibrary') : t(filter);
  }

  /* ------------------------------------------------- continue reading */
  function renderContinue() {
    fill(continueStrip);
    if (query || (settings.filter && settings.filter !== 'all')) return;
    const candidate = books
      .filter((book) => !book.finished && book.lastOpenedAt && (book.progress?.percent || 0) > 0)
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
    if (!candidate) return;

    const percent = Math.round(candidate.progress?.percent || 0);
    mount(continueStrip, 
      el('div', { class: 'section-title', style: { margin: '6px 0 8px' } }, t('continueReading')),
      el(
        'div',
        {
          class: 'continue-card',
          role: 'button',
          tabindex: '0',
          onclick: () => onOpenBook(candidate),
          onkeydown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpenBook(candidate);
            }
          },
        },
        coverUrl(candidate)
          ? el('img', { src: coverUrl(candidate), alt: '' })
          : el('div', { class: 'cover-fallback' }),
        el(
          'div',
          { class: 'meta' },
          el('h3', { text: candidate.title }),
          el('p', { class: 'tiny muted', text: candidate.author || t('unknownAuthor') }),
          el(
            'div',
            { class: 'progress-track', style: { marginTop: '8px' } },
            el('i', { style: { width: `${percent}%` } })
          )
        ),
        el('div', { class: 'tiny muted', text: `${percent}%` }),
        el('button', { class: 'btn primary', type: 'button' }, t('resume'))
      )
    );
  }

  /* -------------------------------------------------------- shelf view */
  function renderShelves(list) {
    const host = el('div', { class: 'shelves' });
    const available = Math.max(320, main.clientWidth - 90);
    const rows = [];
    let row = [];
    let used = 0;

    for (const book of list) {
      const { depth } = shelfSize(book);
      const slotWidth = depth + 4;
      if (used + slotWidth > available && row.length) {
        rows.push(row);
        row = [];
        used = 0;
      }
      row.push(book);
      used += slotWidth;
    }
    if (row.length) rows.push(row);

    rows.forEach((rowBooks, rowIndex) => {
      const shelf = el('section', { class: 'shelf' });
      const booksWrap = el('div', { class: 'shelf-books' });

      rowBooks.forEach((book, index) => {
        const size = shelfSize(book);
        const slot = el('div', {
          class: 'slot',
          'data-book-id': book.id,
          style: { '--d': `${size.depth}px`, '--h': `${size.height}px` },
          title: `${book.title}${book.author ? ` — ${book.author}` : ''}`,
        });

        // The last book of a partly filled row leans, like a real shelf.
        const isLastOfShortRow =
          index === rowBooks.length - 1 && rowIndex === rows.length - 1 && rowBooks.length > 2;
        if (isLastOfShortRow) {
          slot.classList.add('leaning');
          slot.style.setProperty('--lean', '-7deg');
        }

        // The 3D box is edge-on, so the slot carries the interaction.
        slot.setAttribute('role', 'button');
        slot.setAttribute('tabindex', '0');
        slot.setAttribute('aria-label', book.title);
        const open = () => {
          playShelfPull();
          openBookDetail(book, slot);
        };
        slot.addEventListener('click', open);
        slot.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
        mount(slot, buildBook3D(book, { ...size }));
        mount(booksWrap, slot);
      });

      mount(shelf, 
        booksWrap,
        el('div', { class: 'shelf-shadow' }),
        el('div', { class: 'shelf-plank' })
      );
      mount(host, shelf);
    });

    return host;
  }

  /* --------------------------------------------------------- grid view */
  function renderGrid(list) {
    const host = el('div', { class: 'cover-grid' });
    for (const book of list) {
      const percent = Math.round(book.progress?.percent || 0);
      const wrap = el('div', { class: 'cover-wrap' });
      const url = coverUrl(book);
      mount(wrap, url ? el('img', { src: url, alt: '', loading: 'lazy' }) : el('div'));
      if (book.finished) mount(wrap, el('span', { class: 'badge', text: t('finished') }));
      else if (book.favorite) mount(wrap, el('span', { class: 'badge', text: '★' }));
      if (percent > 0 && percent < 100) {
        mount(wrap, el('div', { class: 'bar' }, el('i', { style: { width: `${percent}%` } })));
      }
      mount(host, 
        el(
          'article',
          {
            class: 'cover-card',
            'data-book-id': book.id,
            role: 'button',
            tabindex: '0',
            onclick: () => openBookDetail(book),
            onkeydown: (event) => {
              if (event.key === 'Enter') openBookDetail(book);
            },
          },
          wrap,
          el('h3', { text: book.title }),
          el('p', { text: book.author || t('unknownAuthor') })
        )
      );
    }
    return host;
  }

  /* --------------------------------------------------------- list view */
  function renderList(list) {
    const host = el('div', { class: 'book-list' });
    for (const book of list) {
      const percent = Math.round(book.progress?.percent || 0);
      const url = coverUrl(book);
      mount(host, 
        el(
          'div',
          {
            class: 'list-row',
            'data-book-id': book.id,
            role: 'button',
            tabindex: '0',
            onclick: () => openBookDetail(book),
            onkeydown: (event) => {
              if (event.key === 'Enter') openBookDetail(book);
            },
          },
          url ? el('img', { src: url, alt: '', loading: 'lazy' }) : el('div'),
          el(
            'div',
            { class: 'grow' },
            el('h3', { text: book.title }),
            el('p', {
              class: 'tiny muted',
              text: [book.author || t('unknownAuthor'), book.format.toUpperCase(), formatBytes(book.size)].join(
                ' · '
              ),
            })
          ),
          el('span', { class: 'tiny muted', text: formatDate(book.addedAt) }),
          el(
            'div',
            { class: 'progress-track', style: { width: '90px' } },
            el('i', { style: { width: `${percent}%` } })
          ),
          el('span', { class: 'pct', text: `${percent}%` })
        )
      );
    }
    return host;
  }

  /* ------------------------------------------------------------- empty */
  function renderEmpty() {
    const isSearch = Boolean(query) || settings.filter !== 'all';
    return el(
      'div',
      { class: 'empty-state' },
      el('div', {
        class: 'empty-illu',
        html: `<svg viewBox="0 0 130 90" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="10" y="20" width="14" height="46" rx="2"/>
          <rect x="28" y="12" width="12" height="54" rx="2"/>
          <rect x="44" y="26" width="16" height="40" rx="2"/>
          <path d="M4 70h122" stroke-width="3"/>
          <path d="M78 34h40M78 46h40M78 58h26" opacity=".5"/>
        </svg>`,
      }),
      el('h2', { text: isSearch ? t('noResults') : t('emptyLibrary') }),
      el('p', { text: isSearch ? '' : t('emptyLibraryHint') }),
      !isSearch &&
        el(
          'button',
          { class: 'btn primary', type: 'button', onclick: () => pickAndImport() },
          el('span', { html: icons.plus }),
          t('addBooks')
        )
    );
  }

  /* ------------------------------------------------------------ render */
  function renderBooks() {
    const list = currentBooks();
    renderToolbar(list.length);
    renderContinue();
    fill(listHost, 
      !list.length
        ? renderEmpty()
        : settings.view === 'grid'
        ? renderGrid(list)
        : settings.view === 'list'
        ? renderList(list)
        : renderShelves(list)
    );
  }

  /* ------------------------------------------------------- book detail */
  function openBookDetail(book, slot) {
    slot?.classList.add('picked');
    openDetail(book, {
      onRead: (target) => {
        slot?.classList.remove('picked');
        onOpenBook(target);
      },
      onClose: () => slot?.classList.remove('picked'),
      onChange: async (patch) => {
        const next = await updateBook(book.id, patch);
        if (next) {
          books = books.map((item) => (item.id === next.id ? next : item));
          renderSidebar();
          renderBooks();
        }
        return next;
      },
      onEdit: () => editMetadata(book),
      onDelete: () => removeBook(book),
    });
  }

  async function removeBook(book) {
    const ok = await confirmDialog({
      title: t('remove'),
      message: t('removeConfirm'),
      confirmLabel: t('remove'),
      danger: true,
    });
    if (!ok) return;
    const snapshot = book;
    await deleteBook(book.id);
    releaseCover(book.id);
    await refresh();
    toast(`${t('deleted')}: ${book.title}`, {
      duration: 6000,
      action: {
        label: t('undo'),
        onClick: async () => {
          await putBook(snapshot);
          await refresh();
        },
      },
    });
  }

  function editMetadata(book) {
    const fields = {};
    modal({
      title: t('editMetadata'),
      render: () => {
        const make = (key, label, value, type = 'text') => {
          const input = el('input', { type, value: value ?? '' });
          fields[key] = input;
          return el('div', { class: 'field' }, el('label', { text: label }), input);
        };
        const collectionsList = Array.from(
          new Set(books.map((item) => item.collection).filter(Boolean))
        );
        const collectionInput = el('input', {
          type: 'text',
          value: book.collection || '',
          list: 'collection-options',
        });
        fields.collection = collectionInput;

        return el(
          'div',
          {},
          make('title', t('title'), book.title),
          make('author', t('author'), book.author),
          make('publisher', t('publisher'), book.publisher),
          make('tags', `${t('tags')} — ${t('tagsHint')}`, (book.tags || []).join('، ')),
          el(
            'div',
            { class: 'field' },
            el('label', { text: t('collections') }),
            collectionInput,
            el(
              'datalist',
              { id: 'collection-options' },
              ...collectionsList.map((name) => el('option', { value: name }))
            )
          )
        );
      },
      footer: (close) => [
        el('button', { class: 'btn', type: 'button', onclick: () => close() }, t('cancel')),
        el(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: async () => {
              await updateBook(book.id, {
                title: fields.title.value.trim() || book.title,
                author: fields.author.value.trim(),
                publisher: fields.publisher.value.trim(),
                collection: fields.collection.value.trim(),
                tags: fields.tags.value
                  .split(/[,،]/)
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              });
              close();
              await refresh();
              emit('books-changed');
            },
          },
          t('save')
        ),
      ],
    });
  }

  /* ------------------------------------------------------ drag & drop */
  let dragDepth = 0;
  const dropHint = el('div', { class: 'dropzone-hint', text: t('dropHere') });

  root.addEventListener('dragenter', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    dragDepth += 1;
    if (dragDepth === 1) mount(document.body, dropHint);
  });
  root.addEventListener('dragover', (event) => event.preventDefault());
  root.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropHint.remove();
  });
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropHint.remove();
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) pickAndImport(files);
  });

  /* -------------------------------------------------------- lifecycle */
  const onResize = debounce(() => {
    if (settings.view === 'shelf') renderBooks();
  }, 220);
  window.addEventListener('resize', onResize);

  const offBooksChanged = on('books-changed', () => refresh());

  async function refresh() {
    books = await listBooks();
    renderSidebar();
    renderBooks();
  }

  return {
    element: root,
    refresh,
    focusSearch: () => searchInput.focus(),
    importFiles: pickAndImport,
    destroy() {
      window.removeEventListener('resize', onResize);
      offBooksChanged();
    },
  };
}
