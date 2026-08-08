/** App settings: language, defaults, backup/restore, shortcuts and about. */

import { exportBackup, importBackup, storageEstimate } from '../core/db.js';
import { emit, resetSettings, settings, updateSettings } from '../core/state.js';
import { setLanguage, t } from '../core/i18n.js';
import { downloadBlob, el, fill, formatBytes, mount, pickFiles } from '../core/utils.js';
import { modal, toast } from '../ui/feedback.js';
import { icons } from '../ui/icons.js';

const SHORTCUTS = [
  ['→ / ←', 'prevPage / nextPage'],
  ['Space', 'nextPage'],
  ['T', 'contents'],
  ['/', 'searchInBook'],
  ['B', 'addBookmark'],
  ['A', 'appearance'],
  ['S', 'readAloud'],
  ['F', 'focusMode'],
  ['+ / -', 'fontSize'],
  ['Esc', 'backToLibrary'],
];

export async function openSettings() {
  const estimate = await storageEstimate();

  modal({
    title: t('settings'),
    width: 'min(660px, 100%)',
    render: () => {
      const languageSelect = el(
        'select',
        {
          onchange: (event) => {
            updateSettings({ lang: event.target.value });
            setLanguage(event.target.value);
            emit('language-changed');
          },
        },
        el('option', { value: 'ar', selected: settings.lang === 'ar' }, t('arabic')),
        el('option', { value: 'en', selected: settings.lang === 'en' }, t('english'))
      );

      return el(
        'div',
        {},
        el('div', { class: 'section-title', text: t('general') }),
        el('div', { class: 'field' }, el('label', { text: t('interfaceLanguage') }), languageSelect),
        el(
          'label',
          { class: 'switch' },
          el('input', {
            type: 'checkbox',
            checked: settings.sound,
            onchange: (event) => updateSettings({ sound: event.target.checked }),
          }),
          el('span', { class: 'track' }),
          el('span', { text: t('sound') })
        ),

        el('div', { class: 'section-title', text: t('data') }),
        el('p', { class: 'tiny muted', text: t('backupHint') }),
        el(
          'div',
          { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                const payload = await exportBackup();
                const stamp = new Date().toISOString().slice(0, 10);
                downloadBlob(
                  new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
                  `bein-backup-${stamp}.json`
                );
              },
            },
            el('span', { html: icons.download }),
            t('exportBackup')
          ),
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: async () => {
                const [file] = await pickFiles({ accept: '.json', multiple: false });
                if (!file) return;
                try {
                  const report = await importBackup(JSON.parse(await file.text()));
                  toast(
                    `${t('imported')}: ${report.annotations} ${t('notes')} · ${report.books} ${t('booksCount')}`
                  );
                  emit('books-changed');
                } catch (error) {
                  toast(error.message || t('importFailed'));
                }
              },
            },
            el('span', { html: icons.upload }),
            t('importBackup')
          )
        ),
        estimate
          ? el('p', {
              class: 'tiny muted',
              style: { marginTop: '10px' },
              text: `${t('storageUsed')}: ${formatBytes(estimate.usage || 0)}${
                estimate.quota ? ` / ${formatBytes(estimate.quota)}` : ''
              }`,
            })
          : null,

        el('div', { class: 'section-title', text: t('keyboardShortcuts') }),
        el(
          'div',
          { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '6px 18px' } },
          ...SHORTCUTS.map(([keys, labelKey]) =>
            el(
              'div',
              { class: 'row between tiny' },
              el('span', { class: 'muted', text: t(labelKey) }),
              el('kbd', {
                style: {
                  background: 'rgb(255 255 255 / .08)',
                  padding: '2px 7px',
                  borderRadius: '6px',
                  fontFamily: 'monospace',
                },
                text: keys,
              })
            )
          )
        ),

        el('div', { class: 'section-title', text: t('about') }),
        el('p', {
          class: 'tiny muted',
          style: { lineHeight: '1.8' },
          text: 'Bein — قارئ كتب يعمل بالكامل داخل جهازك: لا يُرفع أي كتاب أو ملاحظة إلى أي خادم. يدعم EPUB و PDF و TXT و Markdown.',
        })
      );
    },
    footer: (close) => [
      el(
        'button',
        {
          class: 'btn danger',
          type: 'button',
          onclick: () => {
            resetSettings();
            close();
            toast(t('resetDefaults'));
          },
        },
        t('resetDefaults')
      ),
      el('button', { class: 'btn primary', type: 'button', onclick: () => close() }, t('close')),
    ],
  });
}
