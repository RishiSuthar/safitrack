// modules/notifications/types.js
// Normalized types, category configurations, SVG icons, and formatting utilities.

import { daysUntilDue, dueDeadline, dueStart, isAllDay } from '../utils/due-dates.js';

export const NOTIFICATION_CATEGORIES = {
  TASK: 'task',
  REMINDER: 'reminder',
  DEAL: 'deal',
  CONTRACT: 'contract',
  NUDGE: 'nudge',
  SYSTEM: 'system',
};

export const NOTIFICATION_URGENCIES = {
  URGENT: 'urgent',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low',
};

export const NOTIFICATION_STATUSES = {
  OVERDUE: 'overdue',
  DUE_TODAY: 'due-today',
  DUE_SOON: 'due-soon',
  ACTIVE: 'active',
};

// ── Icons (Modern, refined stroke SVGs) ────────────────────────────────────────

export const CATEGORY_ICONS = {
  task: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  reminder: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  deal: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 6v2m0 8v2"/></svg>`,
  contract: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  nudge: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
  system: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
};

export const CATEGORY_LABELS = {
  task: 'Task',
  reminder: 'Reminder',
  deal: 'Opportunity',
  contract: 'Contract',
  nudge: 'Nudge',
  system: 'Update',
};

// ── Status & Urgency Evaluation ───────────────────────────────────────────────

// Due values are as stored (see utils/due-dates.js). allDay: true for a calendar
// date (an all-day task, a deal's next-step date), false for an instant, and
// unknown (undefined) to treat local midnight as all day.

export function evaluateDueStatus(value, allDay) {
  const deadline = dueDeadline(value, allDay);
  if (!deadline) return NOTIFICATION_STATUSES.ACTIVE;

  // An all-day date is overdue only once the day ends
  if (deadline.getTime() <= Date.now()) return NOTIFICATION_STATUSES.OVERDUE;
  if (daysUntilDue(value, allDay) === 0) return NOTIFICATION_STATUSES.DUE_TODAY;
  return NOTIFICATION_STATUSES.DUE_SOON;
}

export function evaluateUrgency(status, category) {
  if (status === NOTIFICATION_STATUSES.OVERDUE) return NOTIFICATION_URGENCIES.URGENT;
  if (status === NOTIFICATION_STATUSES.DUE_TODAY) return NOTIFICATION_URGENCIES.HIGH;
  if (category === NOTIFICATION_CATEGORIES.NUDGE) return NOTIFICATION_URGENCIES.HIGH;
  if (status === NOTIFICATION_STATUSES.DUE_SOON) return NOTIFICATION_URGENCIES.NORMAL;
  return NOTIFICATION_URGENCIES.LOW;
}

// ── Time & Date Formatters ───────────────────────────────────────────────────

export function formatRelativeTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  const now = Date.now();
  const diffMs = now - d.getTime();
  const isPast = diffMs >= 0;
  const absDiffSec = Math.floor(Math.abs(diffMs) / 1000);

  if (absDiffSec < 60) return 'Just now';

  const absDiffMin = Math.floor(absDiffSec / 60);
  if (absDiffMin < 60) {
    return isPast ? `${absDiffMin}m ago` : `in ${absDiffMin}m`;
  }

  const absDiffHours = Math.floor(absDiffMin / 60);
  if (absDiffHours < 24) {
    return isPast ? `${absDiffHours}h ago` : `in ${absDiffHours}h`;
  }

  const absDiffDays = Math.floor(absDiffHours / 24);
  if (absDiffDays === 1) {
    return isPast ? 'Yesterday' : 'Tomorrow';
  }
  if (absDiffDays < 7) {
    return isPast ? `${absDiffDays}d ago` : `in ${absDiffDays}d`;
  }

  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatDueLabel(value, allDay) {
  const dateObj = dueStart(value, allDay);
  if (!dateObj) return '';
  if (isAllDay(value, allDay)) return dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return dateObj.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildDeterministicKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}
