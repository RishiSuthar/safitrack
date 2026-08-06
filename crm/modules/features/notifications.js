// modules/features/notifications.js
// Centralized notification system — NotificationStore singleton.
//
// Public API (via named export `notificationStore`):
//   .start()                    — called once on app init
//   .stop()                     — called on sign-out
//   .markRead(key)              — mark a single item read
//   .markAllRead()              — mark all visible items read
//   .refreshNow(opts?)          — force immediate refresh
//   .requestBrowserPermission() — request browser push permission
//
// Other modules communicate via custom DOM events:
//   'safitrack:notification-refresh'  — triggers a refresh (with optional forcePopup)
//   'safitrack:view-changed'          — triggers a lightweight refresh after navigation

import { state, supabaseClient, DUE_NOTIFIED_STORAGE_KEY, DUE_READ_STORAGE_KEY } from '../state.js';
import { showToast } from '../ui/toast.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS     = 3 * 60 * 1000; // 3 minutes
const POPUP_AUTO_HIDE_MS   = 5000;
const BROWSER_NOTIF_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — dedup window
const NOTIFIED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — cleanup window
const MAX_ITEMS            = 25;
const MAX_POPUP_ITEMS      = 2;
const TYPE_ICON = {
  task:     '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  reminder: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  deal:     '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  contract: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
};
const TYPE_LABEL = { task: 'Task', reminder: 'Reminder', deal: 'Deal', contract: 'Contract' };

// ── Utilities ─────────────────────────────────────────────────────────────────

function _escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _readStorage(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function _writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

function _formatDueLabel(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  return dateObj.toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function _getDueStatus(dueAt) {
  const now    = Date.now();
  const dueTs  = dueAt.getTime();
  if (dueTs < now) return 'overdue';
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  if (dueTs >= todayStart.getTime() && dueTs < todayEnd.getTime()) return 'due-today';
  return 'due-soon';
}

function _getUserReadKey() {
  const uid = state.currentUser?.id || 'anon';
  return `${DUE_READ_STORAGE_KEY}:${uid}`;
}

// ── Data Mappers ──────────────────────────────────────────────────────────────

function _mapTask(task) {
  const dueAt = task?.due_date ? new Date(task.due_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  if (task.status === 'completed') return null;
  return {
    key: `task:${task.id}:${dueAt.toISOString()}`,
    id: String(task.id),
    entityType: 'task',
    view: 'tasks',
    title: task.title || 'Task due',
    message: `Due ${_formatDueLabel(dueAt)}`,
    dueAt,
    status: _getDueStatus(dueAt),
  };
}

function _mapReminder(reminder) {
  const dueAt = reminder?.reminder_date ? new Date(reminder.reminder_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  if (reminder.is_completed) return null;
  return {
    key: `reminder:${reminder.id}:${dueAt.toISOString()}`,
    id: String(reminder.id),
    entityType: 'reminder',
    view: 'reminders',
    title: reminder.title || 'Reminder due',
    message: `Due ${_formatDueLabel(dueAt)}`,
    dueAt,
    status: _getDueStatus(dueAt),
  };
}

function _computeNextDueDate(startDateStr, recurrenceType, recurrenceInterval) {
  const start = new Date(startDateStr);
  if (isNaN(start.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (recurrenceType === 'once') return start >= today ? start : null;
  const interval = recurrenceInterval || 1;
  let next = new Date(start);
  let guard = 0;
  while (next < today && guard++ < 1000) {
    switch (recurrenceType) {
      case 'weekly':       next.setDate(next.getDate() + 7); break;
      case 'bi_weekly':    next.setDate(next.getDate() + 14); break;
      case 'monthly':      next.setMonth(next.getMonth() + 1); break;
      case 'quarterly':    next.setMonth(next.getMonth() + 3); break;
      case 'semi_annual':  next.setMonth(next.getMonth() + 6); break;
      case 'yearly':       next.setFullYear(next.getFullYear() + 1); break;
      case 'custom_weeks': next.setDate(next.getDate() + interval * 7); break;
      default: return null;
    }
  }
  return next >= today ? next : null;
}

function _mapContract(contract) {
  if (contract.status !== 'active') return null;
  if (!contract.reminder_days?.length) return null;
  const nextDue = _computeNextDueDate(contract.start_date, contract.recurrence_type, contract.recurrence_interval);
  if (!nextDue) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((nextDue.getTime() - today.getTime()) / 86400000);
  const shouldNotify = contract.reminder_days.some(d => daysUntil <= d && daysUntil >= 0);
  if (!shouldNotify) return null;
  const companyName = contract.companies?.name || contract.custom_company_name || 'Contract';
  const typeLabel = contract.contract_type === 'ups_service'   ? 'UPS Service'
                  : contract.contract_type === 'solar_service' ? 'Solar Service'
                  : contract.custom_type_name || 'Service';
  const dueDateStr = nextDue.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return {
    key: `contract:${contract.id}:${nextDue.toISOString().split('T')[0]}`,
    id: String(contract.id),
    entityType: 'contract',
    view: 'contracts',
    title: companyName,
    message: `${typeLabel} due ${dueDateStr}`,
    dueAt: nextDue,
    status: _getDueStatus(nextDue),
  };
}

function _mapOpportunity(opportunity) {
  const dueAt = opportunity?.next_step_date ? new Date(opportunity.next_step_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  const stageRaw = String(opportunity.stage || '').toLowerCase();
  if (stageRaw === 'closed-won' || stageRaw === 'closed-lost') return null;
  const company = opportunity.company_name || 'Deal';
  const step = opportunity.next_step || 'Next step';
  return {
    key: `deal:${opportunity.id}:${dueAt.toISOString()}`,
    id: String(opportunity.id),
    entityType: 'deal',
    view: 'opportunity-pipeline',
    title: company,
    message: `${step} — due ${_formatDueLabel(dueAt)}`,
    dueAt,
    status: _getDueStatus(dueAt),
  };
}

// ── Supabase Fetch ────────────────────────────────────────────────────────────

async function _fetchDueItems() {
  if (!state.currentUser?.id) return [];

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 1);
  const horizonIso  = horizon.toISOString();
  const horizonDate = horizonIso.split('T')[0];
  const orgId       = state.currentOrganization?.id;

  let tasksQ = supabaseClient
    .from('tasks')
    .select('id, title, due_date, status, assigned_to, created_by')
    .not('due_date', 'is', null)
    .neq('status', 'completed')
    .lte('due_date', horizonIso)
    .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`);
  if (orgId) tasksQ = tasksQ.eq('organization_id', orgId);

  let remindersQ = supabaseClient
    .from('reminders')
    .select('id, title, reminder_date, is_completed, assigned_to, created_by')
    .not('reminder_date', 'is', null)
    .neq('is_completed', true)
    .lte('reminder_date', horizonIso)
    .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`);
  if (orgId) remindersQ = remindersQ.eq('organization_id', orgId);

  let oppsQ = supabaseClient
    .from('opportunities')
    .select('id, name, company_name, next_step, next_step_date, stage, user_id')
    .not('next_step_date', 'is', null)
    .lte('next_step_date', horizonDate)
    .neq('stage', 'closed-won')
    .neq('stage', 'closed-lost');
  if (!state.isManager) oppsQ = oppsQ.eq('user_id', state.currentUser.id);
  if (orgId) oppsQ = oppsQ.eq('organization_id', orgId);

  let contractsQ = supabaseClient
    .from('service_contracts')
    .select('id, company_id, custom_company_name, contract_type, custom_type_name, start_date, recurrence_type, recurrence_interval, reminder_days, status, companies(name)')
    .eq('status', 'active')
    .neq('reminder_days', '{}');
  if (orgId) contractsQ = contractsQ.eq('organization_id', orgId);

  const [tasksRes, remindersRes, oppsRes, contractsRes] = await Promise.all([
    tasksQ, remindersQ, oppsQ, contractsQ,
  ]);

  return [
    ...(tasksRes.data     || []).map(_mapTask).filter(Boolean),
    ...(remindersRes.data || []).map(_mapReminder).filter(Boolean),
    ...(oppsRes.data      || []).map(_mapOpportunity).filter(Boolean),
    ...(contractsRes.data || []).map(_mapContract).filter(Boolean),
  ]
    .sort((a, b) => b.dueAt.getTime() - a.dueAt.getTime())
    .slice(0, MAX_ITEMS);
}

// ── Browser Notifications ─────────────────────────────────────────────────────

function _getBrowserPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function _requestBrowserPermission() {
  if (!('Notification' in window)) {
    showToast('This browser does not support notifications.', 'error');
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';

  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    showToast('Device notifications enabled.', 'success');
  } else if (permission === 'denied') {
    showToast('Notifications blocked. Enable them in browser settings.', 'error');
  }
  return permission;
}

async function _sendBrowserNotification(item) {
  if (_getBrowserPermission() !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;

  const statusLabel = item.status === 'overdue' ? 'Overdue'
                    : item.status === 'due-today' ? 'Due today'
                    : 'Due soon';
  const typeLabel   = TYPE_LABEL[item.entityType] || item.entityType;

  await registration.showNotification(`${statusLabel}: ${typeLabel}`, {
    body: `${item.title} — ${item.message}`,
    icon:    '/assets/icons/whiteblue.png',
    badge:   '/assets/icons/whiteblue.png',
    tag:     item.key,
    renotify: false,
    data: { url: '/crm/', view: item.view },
  });
}

// Only notify for overdue/due-today items, with a 24h dedup window per item key.
async function _handleBrowserNotifications(newItems) {
  if (_getBrowserPermission() !== 'granted') return;

  const now        = Date.now();
  const notified   = _readStorage(DUE_NOTIFIED_STORAGE_KEY, {});
  const urgentItems = newItems.filter(i => i.status === 'overdue' || i.status === 'due-today');
  let changed = false;

  for (const item of urgentItems.slice(0, 3)) {
    const lastAt = notified[item.key];
    if (lastAt && now - lastAt < BROWSER_NOTIF_TTL_MS) continue;
    notified[item.key] = now;
    changed = true;
    await _sendBrowserNotification(item);
  }

  // Prune stale entries
  Object.keys(notified).forEach(k => {
    if (now - notified[k] > NOTIFIED_RETENTION_MS) delete notified[k];
  });

  if (changed) _writeStorage(DUE_NOTIFIED_STORAGE_KEY, notified);
}

// ── In-App Due Popup ──────────────────────────────────────────────────────────

let _popupHideTimers = [];

function _getPopupContainer() {
  let el = document.getElementById('notif-popup-container');
  if (el) return el;
  el = document.createElement('div');
  el.id        = 'notif-popup-container';
  el.className = 'notif-popup-container';
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'false');
  document.body.appendChild(el);
  return el;
}

function _clearPopupTimers() {
  _popupHideTimers.forEach(t => clearTimeout(t));
  _popupHideTimers = [];
}

function _showDuePopup(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  const container = _getPopupContainer();
  _clearPopupTimers();

  const toShow = items.slice(0, MAX_POPUP_ITEMS);

  container.innerHTML = toShow.map(item => {
    const statusLabel = item.status === 'overdue'   ? 'Overdue'
                      : item.status === 'due-today' ? 'Due today'
                      : 'Due soon';
    const statusClass = item.status;
    const typeLabel   = TYPE_LABEL[item.entityType] || item.entityType;
    const timeLabel   = _formatDueLabel(item.dueAt);
    return `
      <div class="notif-popup-card ${statusClass}" data-view="${_escapeHtml(item.view)}" data-key="${_escapeHtml(item.key)}" role="alert" tabindex="0">
        <div class="notif-popup-header">
          <span class="notif-popup-type">${typeLabel}</span>
          <span class="notif-popup-status ${statusClass}">${statusLabel} · ${timeLabel}</span>
        </div>
        <div class="notif-popup-title">${_escapeHtml(item.title)}</div>
        <div class="notif-popup-message">${_escapeHtml(item.message)}</div>
        <button class="notif-popup-close" aria-label="Dismiss" data-key="${_escapeHtml(item.key)}">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
    `;
  }).join('');

  container.classList.add('active');

  // Navigation on card click
  container.onclick = async e => {
    const closeBtn = e.target.closest('.notif-popup-close');
    if (closeBtn) {
      const card = closeBtn.closest('.notif-popup-card');
      if (card) {
        notificationStore.markRead(card.dataset.key);
        card.remove();
      }
      if (!container.querySelector('.notif-popup-card')) {
        container.classList.remove('active');
      }
      return;
    }
    const card = e.target.closest('.notif-popup-card');
    if (!card) return;
    notificationStore.markRead(card.dataset.key);
    container.classList.remove('active');
    const view = card.dataset.view;
    if (view && view !== state.currentView) {
      await window.loadView?.(view);
    }
  };

  container.onkeydown = async e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.notif-popup-card');
    if (!card || e.target.closest('.notif-popup-close')) return;
    e.preventDefault();
    notificationStore.markRead(card.dataset.key);
    container.classList.remove('active');
    const view = card.dataset.view;
    if (view && view !== state.currentView) {
      await window.loadView?.(view);
    }
  };

  const hideTimer = setTimeout(() => {
    container.classList.remove('active');
  }, POPUP_AUTO_HIDE_MS);
  _popupHideTimers.push(hideTimer);
}

// ── Panel Renderer ────────────────────────────────────────────────────────────

function _getEl(id) { return document.getElementById(id); }

function _renderBadges(items, readMap) {
  const unreadCount = items.filter(i => !readMap[i.key]).length;

  // Bell badge
  const badge = _getEl('notifications-count');
  if (badge) {
    badge.textContent    = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.style.display  = unreadCount > 0 ? 'inline-flex' : 'none';
  }

  // Bell button state
  const bellBtn = _getEl('notifications-btn');
  if (bellBtn) bellBtn.classList.toggle('has-unread', unreadCount > 0);

  // Unread pill inside header
  const pill = _getEl('notifications-unread-pill');
  if (pill) {
    pill.textContent   = unreadCount > 99 ? '99+' : String(unreadCount);
    pill.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  }

  // Nav badges (tasks, reminders)
  const tasksDue     = items.filter(i => i.entityType === 'task').length;
  const remindersDue = items.filter(i => i.entityType === 'reminder').length;

  const taskBadge     = _getEl('nav-badge-tasks');
  const reminderBadge = _getEl('nav-badge-reminders');
  if (taskBadge) {
    taskBadge.textContent   = tasksDue > 99 ? '99+' : String(tasksDue);
    taskBadge.style.display = tasksDue > 0 ? '' : 'none';
  }
  if (reminderBadge) {
    reminderBadge.textContent   = remindersDue > 99 ? '99+' : String(remindersDue);
    reminderBadge.style.display = remindersDue > 0 ? '' : 'none';
  }
}

function _renderPanel(items, readMap, activeFilter) {
  const listEl = _getEl('notifications-list');
  if (!listEl) return;

  let filtered = items;
  if (activeFilter === 'unread') {
    filtered = items.filter(i => !readMap[i.key]);
  } else if (activeFilter === 'overdue') {
    filtered = items.filter(i => i.status === 'overdue');
  }

  // Update tab active state
  const tabsEl = _getEl('notifications-filter-tabs');
  if (tabsEl) {
    tabsEl.querySelectorAll('.notif-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.filter === activeFilter);
      t.setAttribute('aria-selected', t.dataset.filter === activeFilter ? 'true' : 'false');
    });
  }

  // Update browser permission CTA
  _renderPermissionFooter();

  if (filtered.length === 0) {
    const emptyMsg = activeFilter === 'unread'  ? 'No unread notifications'
                   : activeFilter === 'overdue' ? 'No overdue items'
                   : 'All caught up';
    const emptySub = activeFilter === 'unread'  ? 'You\'re up to date'
                   : activeFilter === 'overdue' ? 'Nothing overdue right now'
                   : 'No upcoming due alerts';
    listEl.innerHTML = `
      <div class="notif-empty">
        <div class="notif-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>
        </div>
        <span class="notif-empty-title">${emptyMsg}</span>
        <span class="notif-empty-sub">${emptySub}</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    const isUnread    = !readMap[item.key];
    const icon        = TYPE_ICON[item.entityType] || TYPE_ICON.task;
    const statusClass = item.status; // 'overdue' | 'due-today' | 'due-soon'
    const timeLabel   = _formatDueLabel(item.dueAt);
    return `
      <button
        class="notif-item${isUnread ? ' unread' : ''} ${statusClass}"
        data-view="${_escapeHtml(item.view)}"
        data-key="${_escapeHtml(item.key)}"
        aria-label="${_escapeHtml(item.title)}: ${_escapeHtml(item.message)}"
      >
        <span class="notif-item-icon" aria-hidden="true">${icon}</span>
        <span class="notif-item-body">
          <span class="notif-item-head">
            <span class="notif-item-type">${TYPE_LABEL[item.entityType] || item.entityType}</span>
            <span class="notif-item-time ${statusClass}">${timeLabel}</span>
          </span>
          <span class="notif-item-title">${_escapeHtml(item.title)}</span>
          <span class="notif-item-message">${_escapeHtml(item.message)}</span>
        </span>
        ${isUnread ? '<span class="notif-unread-dot" aria-label="Unread"></span>' : ''}
      </button>
    `;
  }).join('');
}

function _renderPermissionFooter() {
  const footer = _getEl('notifications-footer');
  const cta    = _getEl('enable-notifications-btn');
  if (!cta || !footer) return;

  const perm = _getBrowserPermission();
  if (perm === 'default') {
    cta.style.display  = 'inline-flex';
    cta.textContent    = '';
    cta.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      Enable device notifications
    `;
    footer.style.display = '';
  } else if (perm === 'denied') {
    cta.style.display  = 'inline-flex';
    cta.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
      Notifications blocked in browser
    `;
    cta.setAttribute('disabled', '');
    footer.style.display = '';
  } else {
    footer.style.display = 'none';
  }
}

// ── NotificationStore ─────────────────────────────────────────────────────────

const notificationStore = (() => {
  let _items        = [];
  let _activeFilter = 'all';
  let _pollId       = null;
  let _started      = false;

  // ── Private ─────────────────────────────────────────────────────────────────

  function _getReadMap() {
    return _readStorage(_getUserReadKey(), {});
  }

  function _saveReadMap(map) {
    _writeStorage(_getUserReadKey(), map);
  }

  function _isPanelOpen() {
    return _getEl('notifications-wrapper')?.classList.contains('active') ?? false;
  }

  async function _refresh({ forcePopup = false } = {}) {
    try {
      const items   = await _fetchDueItems();
      _items        = items;
      const readMap = _getReadMap();

      _renderBadges(items, readMap);
      if (_isPanelOpen()) _renderPanel(items, readMap, _activeFilter);

      // Decide popup: only show popup if panel is closed
      if (!_isPanelOpen()) {
        const notified  = _readStorage(DUE_NOTIFIED_STORAGE_KEY, {});
        const now       = Date.now();
        const freshItems = items.filter(i => !notified[i.key]);
        freshItems.forEach(i => { notified[i.key] = now; });

        // Cleanup stale
        Object.keys(notified).forEach(k => {
          if (now - notified[k] > NOTIFIED_RETENTION_MS) delete notified[k];
        });
        _writeStorage(DUE_NOTIFIED_STORAGE_KEY, notified);

        if (freshItems.length > 0) {
          _showDuePopup(freshItems);
          await _handleBrowserNotifications(freshItems);
        } else if (forcePopup) {
          const urgentItems = items.filter(i => i.status === 'overdue' || i.status === 'due-today');
          if (urgentItems.length > 0) _showDuePopup(urgentItems);
        }
      }
    } catch (err) {
      console.error('[NotificationStore] refresh failed:', err);
    }
  }

  function _startPoll() {
    _stopPoll();
    _pollId = window.setInterval(() => _refresh(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', _onVisibilityChange);
  }

  function _stopPoll() {
    if (_pollId) { clearInterval(_pollId); _pollId = null; }
    document.removeEventListener('visibilitychange', _onVisibilityChange);
  }

  function _onVisibilityChange() {
    if (!document.hidden) _refresh();
  }

  function _initPanelListeners() {
    const wrapper  = _getEl('notifications-wrapper');
    const btn      = _getEl('notifications-btn');
    const markAll  = _getEl('notifications-mark-all-btn');
    const tabs     = _getEl('notifications-filter-tabs');
    const list     = _getEl('notifications-list');
    const enableBtn = _getEl('enable-notifications-btn');

    // Bell toggle
    btn?.addEventListener('click', e => {
      e.stopPropagation();
      _getEl('user-menu')?.classList.remove('active');
      const isOpening = !wrapper?.classList.contains('active');
      wrapper?.classList.toggle('active');
      if (isOpening) {
        // Render fresh panel content when opening
        _renderPanel(_items, _getReadMap(), _activeFilter);
        btn.setAttribute('aria-expanded', 'true');
      } else {
        btn.setAttribute('aria-expanded', 'false');
      }
    });

    // Mark all read
    markAll?.addEventListener('click', e => {
      e.stopPropagation();
      notificationStore.markAllRead();
    });

    // Filter tabs
    tabs?.addEventListener('click', e => {
      const tab = e.target.closest('.notif-tab');
      if (!tab) return;
      const filter = tab.dataset.filter;
      if (!filter || filter === _activeFilter) return;
      _activeFilter = filter;
      _renderPanel(_items, _getReadMap(), _activeFilter);
    });

    // List item click
    list?.addEventListener('click', async e => {
      const item = e.target.closest('.notif-item');
      if (!item) return;
      const key  = item.dataset.key;
      const view = item.dataset.view;
      notificationStore.markRead(key);
      wrapper?.classList.remove('active');
      btn?.setAttribute('aria-expanded', 'false');
      if (view && view !== state.currentView) {
        await window.loadView?.(view);
      }
    });

    // Keyboard on list items (already buttons — Enter/Space work natively; just handle Escape)
    list?.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        wrapper?.classList.remove('active');
        btn?.setAttribute('aria-expanded', 'false');
        btn?.focus();
      }
    });

    // Enable browser notifications
    enableBtn?.addEventListener('click', async e => {
      e.stopPropagation();
      await notificationStore.requestBrowserPermission();
      _renderPermissionFooter();
    });

    // Close on outside click
    document.addEventListener('click', e => {
      if (wrapper && !wrapper.contains(e.target)) {
        wrapper.classList.remove('active');
        btn?.setAttribute('aria-expanded', 'false');
      }
    });

    // Keyboard: Escape closes panel when focus is inside
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && wrapper?.classList.contains('active')) {
        wrapper.classList.remove('active');
        btn?.setAttribute('aria-expanded', 'false');
        btn?.focus();
      }
    });
  }

  // ── Custom event listeners ──────────────────────────────────────────────────

  function _initEventListeners() {
    // Other modules dispatch this to request a refresh
    document.addEventListener('safitrack:notification-refresh', e => {
      _refresh({ forcePopup: e.detail?.forcePopup ?? false });
    });

    // Navigation module dispatches this after each view switch
    document.addEventListener('safitrack:view-changed', () => {
      _refresh();
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    start() {
      if (_started) return;
      _started = true;
      _initPanelListeners();
      _initEventListeners();
      _refresh();
      _startPoll();
    },

    stop() {
      _stopPoll();
      _clearPopupTimers();
      _items        = [];
      _activeFilter = 'all';
      _started      = false;
      // Clear badges on sign-out
      _renderBadges([], {});
    },

    markRead(key) {
      if (!key) return;
      const readMap = _getReadMap();
      readMap[key]  = Date.now();
      _saveReadMap(readMap);
      _renderBadges(_items, readMap);
      if (_isPanelOpen()) _renderPanel(_items, readMap, _activeFilter);
    },

    markAllRead() {
      const readMap = _getReadMap();
      const now     = Date.now();
      _items.forEach(i => { readMap[i.key] = now; });
      _saveReadMap(readMap);
      _renderBadges(_items, readMap);
      if (_isPanelOpen()) _renderPanel(_items, readMap, _activeFilter);
    },

    async refreshNow(opts = {}) {
      await _refresh(opts);
    },

    async requestBrowserPermission() {
      return _requestBrowserPermission();
    },

    // Expose for debugging
    get items()       { return _items; },
    get activeFilter(){ return _activeFilter; },
  };
})();

// ── Exports ───────────────────────────────────────────────────────────────────

export { notificationStore };

// Legacy compat shims — keep these so anything still calling the old names
// doesn't throw. They delegate to the store.
// TODO: Remove after confirming no external callers remain.
export const refreshDueNotifications  = opts => notificationStore.refreshNow(opts);
export const startDueNotificationsMonitor = () => notificationStore.start();
export const stopDueNotificationsMonitor  = () => notificationStore.stop();
export const markAllDueNotificationsRead  = () => notificationStore.markAllRead();
export const markSingleNotificationRead   = key => notificationStore.markRead(key);
export const requestNotificationPermission = () => notificationStore.requestBrowserPermission();

// These were exported but consumed only internally — kept as no-ops or empty
// implementations to avoid import errors in any file we haven't updated yet.
export const checkDueReminders            = () => notificationStore.refreshNow();
export const getDueStatus                 = _getDueStatus;
export const formatDueLabel               = _formatDueLabel;
export const mapTaskToDueNotification     = _mapTask;
export const mapReminderToDueNotification = _mapReminder;
export const mapOpportunityToDueNotification = _mapOpportunity;
export const fetchDueNotificationItems    = _fetchDueItems;
export const renderDueNotificationsUI     = () => {
  const readMap = _readStorage(_getUserReadKey(), {});
  const store   = notificationStore;
  _renderBadges(store.items, readMap);
};
export const updateNotificationPermissionCTA = () => _renderPermissionFooter();
export const pushDeviceNotification       = item => _sendBrowserNotification(item);
export const notifyForNewDueItems         = () => {};
export const getDuePopupContainer         = _getPopupContainer;
export const clearDuePopupTimers          = _clearPopupTimers;
export const showDuePopup                 = _showDuePopup;
export const handleDueNotificationVisibility = () => { if (!document.hidden) notificationStore.refreshNow(); };
export const setNotifActiveFilter         = () => {};
export const getNotifActiveFilter         = () => notificationStore.activeFilter;
export const readJsonStorage              = _readStorage;
export const writeJsonStorage             = _writeStorage;
