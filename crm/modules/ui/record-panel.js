// modules/ui/record-panel.js
// Shared pieces of the record panels (company, person; the deal and task panels
// use the same .od-* styles): icons, property rows, list rows, click-to-edit
// text, and the open / close / Escape wiring.
import { escapeHtml, getInitials } from './toast.js';

const ICONS = {
  type: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  sector: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  website: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  address: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  categories: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  pipeline: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.1 0 2.9 6 1.5 6 4.3 0 1.2-1.3 2.1-3 2.1-1.4 0-2.6-.6-3-1.6M12 6.5v1.5M12 16v1.5"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  custom: '<path d="M12 3v18M3 12h18"/>',
  job: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  company: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  email: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  open: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  directions: '<path d="m3 11 19-9-9 19-2-8-8-2z"/>',
  find: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6M8 11h6"/>',
  edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9.5 15.5 12 18l2.5-2.5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

export function rpIcon(key) {
  return `<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key] || ''}</svg>`;
}

/** One row of the property list */
export function rpProp(key, label, iconKey, valueHtml) {
  return `
    <div class="od-prop" data-prop="${key}">
      <dt class="od-prop-label">${rpIcon(iconKey)}${escapeHtml(label)}</dt>
      <dd class="od-prop-value">${valueHtml}</dd>
    </div>`;
}

/** A value you can click to edit (or plain text when you can't) */
export function rpEditable(field, html, emptyText, canEdit = true) {
  if (!canEdit) return `<span class="od-readonly${html ? '' : ' is-empty'}">${html || '—'}</span>`;
  return `<button type="button" class="od-editable${html ? '' : ' is-empty'}" data-edit="${field}">${html || escapeHtml(emptyText)}</button>`;
}

export function rpColor(id) {
  const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1'];
  let hash = 0;
  for (const ch of String(id || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

export function rpTabs(tabs, active) {
  return `<div class="od-tabs" role="tablist">${tabs.map(t => `
    <button type="button" role="tab" class="od-tab${t.key === active ? ' is-active' : ''}" data-tab="${t.key}" aria-selected="${t.key === active}">
      ${escapeHtml(t.label)}${t.count != null ? `<span class="od-count">${t.count}</span>` : ''}
    </button>`).join('')}</div>`;
}

/** A row in a related list: a coloured dot or initials, a title, and a meta line */
export function rpItem({ action, index, dot, initials, color, title, meta, note, muted }) {
  const lead = initials != null
    ? `<span class="od-person-avatar rp-item-avatar" style="background:${color || rpColor(title)}">${escapeHtml(getInitials(initials) || '?')}</span>`
    : `<span class="od-item-dot" style="background:${dot || 'var(--text-muted)'}"></span>`;
  return `
    <button type="button" class="od-item${muted ? ' is-muted' : ''}" data-action="${action}" data-index="${index}">
      ${lead}
      <span class="od-item-main">
        <span class="od-item-title">${escapeHtml(title)}</span>
        ${meta ? `<span class="od-item-meta">${meta}</span>` : ''}
        ${note ? `<span class="od-item-note">${escapeHtml(note)}</span>` : ''}
      </span>
    </button>`;
}

export function rpEmpty(text) {
  return `<p class="od-empty">${escapeHtml(text)}</p>`;
}

export function rpList(items, emptyText, renderItem) {
  if (items === undefined) return rpEmpty('Loading…');
  if (items === null) return rpEmpty("Couldn't load these.");
  if (!items.length) return rpEmpty(emptyText);
  return `<div class="od-list">${items.map(renderItem).join('')}</div>`;
}

/**
 * Show a record panel. Wires clicks to onClick, closes on Escape (unless a
 * dropdown, date picker, editor or dialog is handling it), and drops the
 * previous record's listeners. Returns the AbortSignal for extra listeners.
 */
export function openRecordModal({ modalId, panel, onClick }) {
  const modal = document.getElementById(modalId);
  panel._rpListeners?.abort();
  panel._rpListeners = new AbortController();
  const { signal } = panel._rpListeners;

  panel.addEventListener('click', onClick, { signal });
  panel.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.od-notes[data-edit]')) {
      e.preventDefault();
      e.target.click();
    }
  }, { signal });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || modal.style.display === 'none') return;
    if (document.querySelector('.crm-dd.is-open, body > .custom-calendar-picker')) return;
    if (document.activeElement?.classList.contains('od-input')) return;
    if (document.getElementById('confirm-dialog')?.style.display === 'flex') return;
    // Another panel opened on top handles its own Escape
    const topModal = Array.from(document.querySelectorAll('.modal')).filter(m => m !== modal && getComputedStyle(m).display !== 'none');
    if (topModal.some(m => m.compareDocumentPosition(modal) & Node.DOCUMENT_POSITION_PRECEDING)) return;
    window.closeModal(modalId);
  }, { capture: true, signal });

  modal.style.display = 'flex';
  document.body.classList.add('modal-active');
  return signal;
}

/**
 * Swap a value for an input. Enter (⌘↵ in a multi-line box) or leaving the
 * field saves through onSave(text); Escape cancels. An unchanged value just
 * puts the original back.
 */
export function startInlineEdit(anchor, { value = '', multiline = false, placeholder = '', type = 'text', className = '', onSave }) {
  const input = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) input.type = type;
  input.className = `od-input ${className}`.trim();
  input.value = value;
  input.placeholder = placeholder;
  if (multiline) input.rows = Math.max(4, value.split('\n').length + 1);
  anchor.replaceWith(input);
  input.focus();
  if (!multiline) input.select();

  let finished = false;
  const finish = async (save, refocus = false) => {
    if (finished) return;
    finished = true;
    const text = input.value.trim();
    if (!save || text === String(value).trim()) {
      input.replaceWith(anchor);
      if (refocus) anchor.focus();
      return;
    }
    input.disabled = true;
    const saved = await onSave(text);
    if (saved === false) {
      input.replaceWith(anchor);
      if (refocus) anchor.focus();
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false, true);
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true, true);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

/** "Today", "Yesterday", "3 days ago", "12 Aug" for when something last happened */
export function rpAgo(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((today - day) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}
