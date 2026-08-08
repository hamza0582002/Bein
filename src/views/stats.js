/** Reading statistics: streaks, a year heat-map, goals and per-book totals. */

import { listBooks, listSessions } from '../core/db.js';
import { settings, updateSettings } from '../core/state.js';
import { n, t, getLanguage } from '../core/i18n.js';
import { el, fill, formatDuration, mount } from '../core/utils.js';
import { modal } from '../ui/feedback.js';
import { icons } from '../ui/icons.js';

const DAY = 86400000;
const dayKey = (ts) => {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

function summarise(sessions) {
  const byDay = new Map();
  let totalMs = 0;
  let totalPages = 0;
  for (const session of sessions) {
    const key = dayKey(session.startedAt);
    const entry = byDay.get(key) || { ms: 0, pages: 0 };
    entry.ms += session.ms || 0;
    entry.pages += session.pages || 0;
    byDay.set(key, entry);
    totalMs += session.ms || 0;
    totalPages += session.pages || 0;
  }

  const today = dayKey(Date.now());
  let streak = 0;
  for (let cursor = today; byDay.has(cursor); cursor -= DAY) streak += 1;
  // Yesterday still counts if today has not started yet.
  if (!streak && byDay.has(today - DAY)) {
    for (let cursor = today - DAY; byDay.has(cursor); cursor -= DAY) streak += 1;
  }

  const weekStart = today - 6 * DAY;
  let weekMs = 0;
  for (const [key, entry] of byDay) if (key >= weekStart) weekMs += entry.ms;

  return {
    byDay,
    totalMs,
    totalPages,
    streak,
    weekMs,
    todayMs: byDay.get(today)?.ms || 0,
  };
}

function statTile(iconName, label, value, accent = false) {
  return el(
    'div',
    {
      style: {
        background: accent ? 'rgb(194 112 58 / .14)' : 'rgb(255 255 255 / .04)',
        border: '1px solid var(--line)',
        borderRadius: '14px',
        padding: '14px',
        display: 'grid',
        gap: '4px',
      },
    },
    el('span', {
      html: icons[iconName],
      style: {
        width: '20px',
        height: '20px',
        display: 'block',
        color: accent ? 'var(--accent-soft)' : 'var(--muted)',
      },
    }),
    el('strong', { style: { fontSize: '21px' }, text: value }),
    el('span', { class: 'tiny muted', text: label })
  );
}

function heatmap(byDay) {
  const today = dayKey(Date.now());
  const start = today - 363 * DAY;
  const max = Math.max(1, ...Array.from(byDay.values()).map((entry) => entry.ms));

  const grid = el('div', {
    style: {
      display: 'grid',
      gridAutoFlow: 'column',
      gridTemplateRows: 'repeat(7, 11px)',
      gap: '3px',
      overflowX: 'auto',
      padding: '4px 0',
      direction: 'ltr',
    },
  });

  // Pad so each column is a proper week.
  const firstDay = new Date(start).getDay();
  for (let i = 0; i < firstDay; i++) {
    mount(grid, el('span', { style: { width: '11px', height: '11px' } }));
  }

  for (let cursor = start; cursor <= today; cursor += DAY) {
    const entry = byDay.get(cursor);
    const intensity = entry ? 0.22 + 0.78 * Math.min(1, entry.ms / max) : 0;
    mount(grid, 
      el('span', {
        title: `${new Date(cursor).toLocaleDateString(getLanguage() === 'ar' ? 'ar' : 'en')} — ${
          entry ? formatDuration(entry.ms, getLanguage()) : '0'
        }`,
        style: {
          width: '11px',
          height: '11px',
          borderRadius: '3px',
          background: entry
            ? `color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, transparent)`
            : 'rgb(255 255 255 / .06)',
          border: '1px solid rgb(255 255 255 / .04)',
        },
      })
    );
  }
  return grid;
}

export async function openStats() {
  const [sessions, books] = await Promise.all([listSessions(), listBooks()]);
  const stats = summarise(sessions);

  const perBook = new Map();
  for (const session of sessions) {
    perBook.set(session.bookId, (perBook.get(session.bookId) || 0) + (session.ms || 0));
  }
  const top = Array.from(perBook.entries())
    .map(([id, ms]) => ({ book: books.find((item) => item.id === id), ms }))
    .filter((entry) => entry.book)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);

  const goalMinutes = settings.dailyGoal || 30;
  const todayMinutes = Math.round(stats.todayMs / 60000);
  const goalRatio = Math.min(1, todayMinutes / goalMinutes);

  modal({
    title: t('readingStats'),
    width: 'min(760px, 100%)',
    render: () => {
      if (!sessions.length) {
        return el('p', { class: 'empty-note', text: t('noStats') });
      }

      const goalInput = el('input', {
        type: 'number',
        min: '5',
        max: '600',
        step: '5',
        value: String(goalMinutes),
        style: { width: '90px' },
        onchange: (event) => updateSettings({ dailyGoal: Number(event.target.value) || 30 }),
      });

      return el(
        'div',
        {},
        el(
          'div',
          {
            style: {
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
            },
          },
          statTile('flame', t('streak'), `${n(stats.streak)} ${stats.streak === 1 ? t('day') : t('days')}`, stats.streak > 0),
          statTile('clock', t('today'), formatDuration(stats.todayMs, getLanguage())),
          statTile('chart', t('thisWeek'), formatDuration(stats.weekMs, getLanguage())),
          statTile('book', t('allTime'), formatDuration(stats.totalMs, getLanguage())),
          statTile('check', t('booksFinished'), n(books.filter((item) => item.finished).length)),
          statTile('layers', t('pagesRead'), n(stats.totalPages))
        ),

        el('div', { class: 'section-title', text: t('dailyGoal') }),
        el(
          'div',
          { class: 'row', style: { gap: '14px' } },
          el(
            'div',
            { style: { flex: '1' } },
            el('div', { class: 'progress-track', style: { height: '10px' } },
              el('i', { style: { width: `${goalRatio * 100}%` } })
            ),
            el('p', {
              class: 'tiny muted',
              style: { marginTop: '6px' },
              text:
                goalRatio >= 1
                  ? t('goalReached')
                  : `${n(todayMinutes)} / ${n(goalMinutes)} ${t('goalMinutes')}`,
            })
          ),
          goalInput
        ),

        el('div', { class: 'section-title', text: t('activity') }),
        heatmap(stats.byDay),

        top.length
          ? el(
              'div',
              {},
              el('div', { class: 'section-title', text: t('mostRead') }),
              ...top.map((entry) =>
                el(
                  'div',
                  { class: 'row', style: { gap: '10px', padding: '6px 0' } },
                  el('span', { style: { flex: '1', minWidth: '0' }, text: entry.book.title }),
                  el('span', { class: 'tiny muted', text: formatDuration(entry.ms, getLanguage()) })
                )
              )
            )
          : null
      );
    },
    footer: (close) => [
      el('button', { class: 'btn primary', type: 'button', onclick: () => close() }, t('close')),
    ],
  });
}
