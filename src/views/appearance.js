/** The typography / theme sheet that slides up inside the reader. */

import { FONT_LABELS, FONT_STACKS, settings } from '../core/state.js';
import { t } from '../core/i18n.js';
import { clamp, el, fill, mount } from '../core/utils.js';
import { icons } from '../ui/icons.js';

function slider({ min, max, step, value, onInput, label, format }) {
  const output = el('span', { class: 'tiny muted', text: format ? format(value) : String(value) });
  const input = el('input', { type: 'range', min, max, step, value: String(value) });
  const paint = () => {
    const ratio = ((Number(input.value) - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${ratio}%`);
  };
  paint();
  input.addEventListener('input', () => {
    paint();
    const next = Number(input.value);
    output.textContent = format ? format(next) : String(next);
    onInput(next);
  });
  return el(
    'div',
    { class: 'field' },
    el('label', { class: 'row between' }, el('span', { text: label }), output),
    input
  );
}

export function buildAppearanceSheet({ onChange, onClose }) {
  const wrap = el('div', {});

  const themeRow = el(
    'div',
    { class: 'field' },
    el('label', { text: t('theme') }),
    el(
      'div',
      { class: 'theme-swatches' },
      ...['day', 'sepia', 'night', 'midnight'].map((theme) =>
        el('button', {
          type: 'button',
          class: `theme-swatch${settings.theme === theme ? ' active' : ''}`,
          'data-theme': theme,
          'aria-label': t(`theme${theme[0].toUpperCase()}${theme.slice(1)}`),
          title: t(`theme${theme[0].toUpperCase()}${theme.slice(1)}`),
          onclick: (event) => {
            onChange({ theme });
            wrap
              .querySelectorAll('.theme-swatch')
              .forEach((node) => node.classList.toggle('active', node === event.currentTarget));
          },
        })
      )
    )
  );

  const fontSelect = el(
    'select',
    {
      onchange: (event) => onChange({ fontFamily: event.target.value }),
    },
    ...Object.keys(FONT_STACKS).map((key) =>
      el(
        'option',
        { value: key, selected: settings.fontFamily === key, style: { fontFamily: FONT_STACKS[key] } },
        FONT_LABELS[key] || key
      )
    )
  );

  const sizeValue = el('span', { class: 'tiny muted', text: `${settings.fontSize}px` });
  const stepSize = (delta) => {
    const next = clamp(settings.fontSize + delta, 13, 42);
    sizeValue.textContent = `${next}px`;
    onChange({ fontSize: next });
  };
  const sizeRow = el(
    'div',
    { class: 'field' },
    el('label', { text: t('fontSize') }),
    el(
      'div',
      { class: 'size-row' },
      el('button', {
        class: 'icon-btn',
        type: 'button',
        html: icons.minus,
        'aria-label': t('zoomOut'),
        onclick: () => stepSize(-1),
      }),
      sizeValue,
      el('button', {
        class: 'icon-btn',
        type: 'button',
        html: icons.plus,
        'aria-label': t('zoomIn'),
        onclick: () => stepSize(1),
      })
    )
  );

  const segmented = (options, current, onPick) =>
    el(
      'div',
      { class: 'segmented' },
      ...options.map((option) =>
        el('button', {
          type: 'button',
          class: current === option.id ? 'active' : '',
          text: option.label,
          onclick: (event) => {
            onPick(option.id);
            event.currentTarget.parentElement
              .querySelectorAll('button')
              .forEach((node) => node.classList.toggle('active', node === event.currentTarget));
          },
        })
      )
    );

  mount(wrap, 
    el('div', { class: 'sheet-grip' }),
    el(
      'div',
      { class: 'row between', style: { marginBottom: '10px' } },
      el('strong', { text: t('appearance') }),
      el('button', {
        class: 'icon-btn',
        type: 'button',
        html: icons.x,
        'aria-label': t('close'),
        onclick: onClose,
      })
    ),
    el(
      'div',
      { class: 'sheet-grid' },
      el(
        'div',
        {},
        themeRow,
        el('div', { class: 'field' }, el('label', { text: t('fontFamily') }), fontSelect),
        sizeRow
      ),
      el(
        'div',
        {},
        slider({
          label: t('lineHeight'),
          min: 1.2,
          max: 2.6,
          step: 0.05,
          value: settings.lineHeight,
          format: (value) => value.toFixed(2),
          onInput: (value) => onChange({ lineHeight: value }),
        }),
        slider({
          label: t('margins'),
          min: 8,
          max: 160,
          step: 2,
          value: settings.margin,
          format: (value) => `${value}px`,
          onInput: (value) => onChange({ margin: value }),
        }),
        el(
          'label',
          { class: 'switch', style: { marginTop: '6px' } },
          el('input', {
            type: 'checkbox',
            checked: settings.justify,
            onchange: (event) => onChange({ justify: event.target.checked }),
          }),
          el('span', { class: 'track' }),
          el('span', { text: t('justify') })
        )
      ),
      el(
        'div',
        {},
        el(
          'div',
          { class: 'field' },
          el('label', { text: t('layout') }),
          segmented(
            [
              { id: 'double', label: t('doublePage') },
              { id: 'single', label: t('singlePage') },
              { id: 'scroll', label: t('scrollMode') },
            ],
            settings.layout,
            (id) => onChange({ layout: id })
          )
        ),
        el(
          'div',
          { class: 'field' },
          el('label', { text: t('pageAnimation') }),
          segmented(
            [
              { id: 'curl', label: t('animCurl') },
              { id: 'slide', label: t('animSlide') },
              { id: 'fade', label: t('animFade') },
              { id: 'none', label: t('animNone') },
            ],
            settings.pageAnim,
            (id) => onChange({ pageAnim: id })
          )
        ),
        el(
          'label',
          { class: 'switch' },
          el('input', {
            type: 'checkbox',
            checked: settings.sound,
            onchange: (event) => onChange({ sound: event.target.checked }),
          }),
          el('span', { class: 'track' }),
          el('span', { text: t('sound') })
        )
      ),
      el(
        'div',
        {},
        slider({
          label: t('brightness'),
          min: 40,
          max: 100,
          step: 1,
          value: settings.brightness,
          format: (value) => `${value}%`,
          onInput: (value) => onChange({ brightness: value }),
        }),
        slider({
          label: t('warmth'),
          min: 0,
          max: 100,
          step: 1,
          value: settings.warmth,
          format: (value) => `${value}%`,
          onInput: (value) => onChange({ warmth: value }),
        })
      )
    )
  );

  return wrap;
}
