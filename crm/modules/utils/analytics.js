// modules/utils/analytics.js
// Formatting, date and data helpers shared by the analytics views
// (manager dashboard, sales funnel).
import { getCurrencySymbol } from './helpers.js';
import { DEFAULT_SALES_STAGES } from './pipeline-stages.js';

export const DAY = 86400000;

export const OPEN_STAGES = ['prospecting', 'qualification'];

// Stage titles can carry decoration (e.g. "Won 🎉"); analytics shows them plain.
export const STAGE_META = Object.fromEntries(DEFAULT_SALES_STAGES.map((s) => [s.id, {
  label: s.title.replace(/[\p{Extended_Pictographic}‍️]/gu, '').trim(),
  color: s.color,
}]));

// ── Formatting ──────────────────────────────────────────────────

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function compactNumber(n) {
  const abs = Math.abs(n);
  const trim = (x) => x.toFixed(1).replace(/\.0$/, '');
  if (abs >= 1e9) return `${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1e3) return `${trim(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

export function money(n) {
  return `${getCurrencySymbol()} ${compactNumber(n || 0)}`;
}

export function moneyFull(n) {
  return `${getCurrencySymbol()} ${Math.round(n || 0).toLocaleString()}`;
}

export function fullName(p) {
  if (!p) return 'Unknown';
  return `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
}

export function initialsOf(p) {
  if (!p) return '?';
  return (((p.first_name || '')[0] || '') + ((p.last_name || '')[0] || '')).toUpperCase() || '?';
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── Dates ───────────────────────────────────────────────────────

// Plain YYYY-MM-DD values are calendar dates; parse them as local midnight so
// they don't drift a day in timezones behind UTC.
export function parseDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function calendarDaysFrom(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}

export function relTime(date, now) {
  if (!date) return '—';
  const mins = Math.floor((now - date) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = calendarDaysFrom(date, now);
  if (days <= 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function shortDate(d) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Persistence ─────────────────────────────────────────────────

export function readStoredChoice(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (allowed.includes(v)) return v;
  } catch { /* storage unavailable */ }
  return fallback;
}

export function storeChoice(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

// ── Data ────────────────────────────────────────────────────────

// PostgREST caps responses (1000 rows by default), so page through results.
export async function fetchAllRows(buildQuery, { pageSize = 1000, maxRows = 20000 } = {}) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
