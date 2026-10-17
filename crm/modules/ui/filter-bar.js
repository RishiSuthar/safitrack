// modules/ui/filter-bar.js
// The filter bar every list page uses, so filtering looks and works the same
// everywhere:
//
//   [Search…]  [Owner ▾] [Outcome ▾] [Date ▾]  Clear   ……   [count] [actions] [New X]
//
// Each filter is a crm-dd dropdown. Its button shows the filter's name while
// nothing is picked ("Outcome") and the choice once one is ("Outcome:
// Connected"), tinted so it's clear what is narrowing the list. Dates use one
// dropdown of presets with a custom range. Clear shows only when something is
// set. Pages keep their own state: they listen for `change` on the filter ids
// (the hidden dropdown inputs) and `input` on the search box, as before.

import { escapeHtml } from './toast.js';

const CHECK = '<svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const CHEVRON = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const SEARCH = '<svg class="fb-search-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

export const PAST_DATE_PRESETS = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range…' },
];

export const FUTURE_DATE_PRESETS = [
  { value: '', label: 'Any time' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range…' },
];

/** The search box, always first in the bar */
export function fbSearch({ id, placeholder = 'Search', value = '' }) {
  return `
    <label class="fb-search">
      ${SEARCH}
      <input type="search" id="${id}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" autocomplete="off" aria-label="${escapeHtml(placeholder)}">
    </label>`;
}

/**
 * A filter dropdown. options[0] is the "no filter" choice (e.g. "Any outcome").
 * kind 'sort' (or 'setting') is a dropdown that shapes the list without
 * filtering it: its button always reads "Label: Choice" and Clear leaves it.
 */
export function fbSelect({ id, label, options, value, kind = 'filter', searchable = false }) {
  const defaultValue = String(options[0]?.value ?? '');
  const current = options.find(o => String(o.value) === String(value ?? '')) || options[0];
  const isFilter = kind === 'filter';
  const buttonLabel = (o) => (isFilter && String(o.value) === defaultValue ? label : `${label}: ${o.label}`);
  const active = isFilter && String(current.value) !== defaultValue;

  return `
    <div class="crm-dd crm-dd--filter fb-dd${active ? ' is-active' : ''}" data-dd-id="${id}" data-fb-kind="${kind}" data-fb-default="${escapeHtml(defaultValue)}">
      <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
        <span class="crm-dd-label">${escapeHtml(buttonLabel(current))}</span>
        <span class="crm-dd-chevron">${CHEVRON}</span>
      </button>
      <div class="crm-dd-panel" role="listbox">
        ${searchable ? '<div class="crm-dd-search-wrap"><input type="text" class="crm-dd-search" placeholder="Search…" autocomplete="off" spellcheck="false"></div>' : ''}
        <ul class="crm-dd-list">
          ${options.map(o => {
            const selected = String(o.value) === String(current.value);
            return `<li class="crm-dd-option${selected ? ' is-selected' : ''}" role="option" aria-selected="${selected}" data-value="${escapeHtml(String(o.value))}" data-label="${escapeHtml(buttonLabel(o))}" tabindex="-1">${CHECK}${escapeHtml(o.label)}</li>`;
          }).join('')}
        </ul>
      </div>
      <input class="crm-dd-value-input" type="hidden" id="${id}" value="${escapeHtml(String(current.value))}">
    </div>`;
}

/**
 * A date filter: presets in one dropdown (id), and from/to inputs
 * (`${id}-from`, `${id}-to`) that appear when "Custom range…" is picked.
 */
export function fbDate({ id, label = 'Date', presets = PAST_DATE_PRESETS, value = {} }) {
  const preset = value.preset || '';
  return `
    ${fbSelect({ id, label, options: presets, value: preset })}
    <div class="fb-range" id="${id}-range"${preset === 'custom' ? '' : ' hidden'} role="group" aria-label="${escapeHtml(label)} range">
      <input type="text" id="${id}-from" value="${escapeHtml(value.from || '')}" placeholder="From" aria-label="From">
      <span class="fb-range-sep">to</span>
      <input type="text" id="${id}-to" value="${escapeHtml(value.to || '')}" placeholder="To" aria-label="To">
    </div>`;
}

/** The Clear link; filter-bar shows it only while a filter or search is set */
export function fbClear(id) {
  return `<button type="button" class="fb-clear" id="${id}" hidden>Clear</button>`;
}

const pad = (n) => String(n).padStart(2, '0');
const dayString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/**
 * The range a date filter covers, in local time:
 * { from, to } as Dates (to is the last millisecond of the last day) and
 * { fromDay, toDay } as "YYYY-MM-DD" strings, or nulls where unbounded.
 * Custom ranges use the from/to inputs ("YYYY-MM-DD").
 */
export function fbDateRange(preset, customFrom = '', customTo = '', now = new Date()) {
  const today = startOfDay(now);
  let from = null;
  let to = null; // exclusive day start
  switch (preset) {
    case 'today': from = today; to = addDays(today, 1); break;
    case 'yesterday': from = addDays(today, -1); to = today; break;
    case 'last7': from = addDays(today, -6); to = addDays(today, 1); break;
    case 'last30': from = addDays(today, -29); to = addDays(today, 1); break;
    case 'this_month': from = new Date(today.getFullYear(), today.getMonth(), 1); to = new Date(today.getFullYear(), today.getMonth() + 1, 1); break;
    case 'last_month': from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case 'overdue': to = today; break;
    case 'next7': from = today; to = addDays(today, 7); break;
    case 'next30': from = today; to = addDays(today, 30); break;
    case 'custom': {
      const parse = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(`${s}T00:00:00`) : null);
      from = parse(customFrom);
      const end = parse(customTo);
      to = end ? addDays(end, 1) : null;
      break;
    }
    default: break;
  }
  return {
    from,
    to: to ? new Date(to.getTime() - 1) : null,
    fromDay: from ? dayString(from) : null,
    toDay: to ? dayString(addDays(to, -1)) : null,
  };
}

/** True when a time (Date, ISO string or "YYYY-MM-DD") falls in the range */
export function fbInRange(range, value) {
  if (!range.from && !range.to) return true;
  if (!value) return false;
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (day) return (!range.fromDay || value >= range.fromDay) && (!range.toDay || value <= range.toDay);
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return false;
  return (!range.from || t >= range.from.getTime()) && (!range.to || t <= range.to.getTime());
}

/** Tint active filters, show custom ranges and the Clear link to match the current values */
export function syncFilterBar(root) {
  if (!root) return;
  let anyActive = false;
  root.querySelectorAll('.fb-dd').forEach(dd => {
    const input = dd.querySelector('.crm-dd-value-input');
    const isFilter = dd.dataset.fbKind === 'filter';
    const active = isFilter && input && input.value !== (dd.dataset.fbDefault || '');
    dd.classList.toggle('is-active', active);
    if (active) anyActive = true;
    const range = input && root.querySelector(`#${CSS.escape(input.id)}-range`);
    if (range) range.hidden = input.value !== 'custom';
  });
  const search = root.querySelector('.fb-search input');
  if (search && search.value.trim()) anyActive = true;
  const clear = root.querySelector('.fb-clear');
  if (clear) clear.hidden = !anyActive;
}

/**
 * Wire a bar: dropdowns, the custom-range calendars, and the tinting.
 * onClear runs after Clear has reset every filter (not sorts) and the search.
 */
export function initFilterBar(root, { onClear } = {}) {
  if (!root) return;
  window.initAllCrmDropdowns?.(root);
  root.querySelectorAll('.fb-range input').forEach(input => {
    window.initCustomCalendar?.(`#${CSS.escape(input.id)}`, { type: 'date' });
  });
  root.addEventListener('change', () => syncFilterBar(root));
  root.addEventListener('input', (e) => { if (e.target.closest('.fb-search')) syncFilterBar(root); });
  root.querySelector('.fb-clear')?.addEventListener('click', () => {
    resetFilterBar(root);
    onClear?.();
  });
  syncFilterBar(root);
}

/** Put every filter (not sorts) back to its "no filter" choice and empty the search, quietly */
export function resetFilterBar(root) {
  root.querySelectorAll('.fb-dd[data-fb-kind="filter"]').forEach(dd => {
    const input = dd.querySelector('.crm-dd-value-input');
    const def = dd.dataset.fbDefault || '';
    const option = dd.querySelector(`.crm-dd-option[data-value="${CSS.escape(def)}"]`);
    if (input) input.value = def;
    const label = dd.querySelector('.crm-dd-label');
    if (label && option) label.textContent = option.dataset.label;
    dd.querySelectorAll('.crm-dd-option').forEach(o => {
      const sel = o === option;
      o.classList.toggle('is-selected', sel);
      o.setAttribute('aria-selected', String(sel));
    });
  });
  root.querySelectorAll('.fb-range input').forEach(input => { input.value = ''; });
  const search = root.querySelector('.fb-search input');
  if (search) search.value = '';
  syncFilterBar(root);
}
