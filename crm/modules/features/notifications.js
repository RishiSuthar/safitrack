// modules/features/notifications.js
// Due-date notifications: tasks, reminders, opportunities.
import { state, supabaseClient, DUE_NOTIFIED_STORAGE_KEY, DUE_READ_STORAGE_KEY } from '../state.js';
import { notificationsList, notificationsCount, notificationsEnableBtn } from '../ui/dom.js';

// Active filter for the notification panel ('all' | 'unread' | 'overdue')
let notifActiveFilter = 'all';

export function setNotifActiveFilter(filter) {
  notifActiveFilter = filter;
  renderDueNotificationsUI();
}

export function getNotifActiveFilter() {
  return notifActiveFilter;
}
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';

function getNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('This browser does not support notifications.', 'error');
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  const permission = await Notification.requestPermission();

  if (permission === 'granted') {
    showToast('Device notifications enabled.', 'success');
  } else if (permission === 'denied') {
    showToast('Notifications blocked. You can enable them in browser settings.', 'error');
  }

  return permission;
}

function readJsonStorage(key, fallback = {}) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

function formatDueLabel(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  return dateObj.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getDueStatus(dueAt) {
  const now = Date.now();
  const dueTs = dueAt.getTime();

  if (dueTs < now) return 'overdue';

  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);

  if (dueTs >= startToday.getTime() && dueTs < endToday.getTime()) {
    return 'due-today';
  }

  return 'due-soon';
}

function mapTaskToDueNotification(task) {
  const dueAt = task?.due_date ? new Date(task.due_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  if (task.status === 'completed') return null;

  return {
    key: `task:${task.id}:${dueAt.toISOString()}`,
    id: String(task.id),
    entityType: 'task',
    view: 'tasks',
    title: task.title || 'Task due',
    message: `Task due ${formatDueLabel(dueAt)}`,
    dueAt,
    status: getDueStatus(dueAt)
  };
}

function mapReminderToDueNotification(reminder) {
  const dueAt = reminder?.reminder_date ? new Date(reminder.reminder_date) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
  if (reminder.is_completed) return null;

  return {
    key: `reminder:${reminder.id}:${dueAt.toISOString()}`,
    id: String(reminder.id),
    entityType: 'reminder',
    view: 'reminders',
    title: reminder.title || 'Reminder due',
    message: `Reminder due ${formatDueLabel(dueAt)}`,
    dueAt,
    status: getDueStatus(dueAt)
  };
}

function mapOpportunityToDueNotification(opportunity) {
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
    message: `${step} due ${formatDueLabel(dueAt)}`,
    dueAt,
    status: getDueStatus(dueAt)
  };
}

async function fetchDueNotificationItems() {
  if (!state.currentUser?.id) return [];

  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 1);
  const horizonIso = horizon.toISOString();
  const horizonDate = horizonIso.split('T')[0];

  let tasksQuery = supabaseClient
    .from('tasks')
    .select('id, title, due_date, status, assigned_to, created_by')
    .not('due_date', 'is', null)
    .neq('status', 'completed')
    .lte('due_date', horizonIso)
    .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`);
  if (state.currentOrganization?.id) tasksQuery = tasksQuery.eq('organization_id', state.currentOrganization.id);

  let remindersQuery = supabaseClient
    .from('reminders')
    .select('id, title, reminder_date, is_completed, assigned_to, created_by')
    .not('reminder_date', 'is', null)
    .neq('is_completed', true)
    .lte('reminder_date', horizonIso)
    .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`);
  if (state.currentOrganization?.id) remindersQuery = remindersQuery.eq('organization_id', state.currentOrganization.id);

  let opportunitiesQuery = supabaseClient
    .from('opportunities')
    .select('id, name, company_name, next_step, next_step_date, stage, user_id')
    .not('next_step_date', 'is', null)
    .lte('next_step_date', horizonDate)
    .neq('stage', 'closed-won')
    .neq('stage', 'closed-lost');

  if (!state.isManager) {
    opportunitiesQuery = opportunitiesQuery.eq('user_id', state.currentUser.id);
  }
  if (state.currentOrganization?.id) opportunitiesQuery = opportunitiesQuery.eq('organization_id', state.currentOrganization.id);

  const [tasksRes, remindersRes, opportunitiesRes] = await Promise.all([
    tasksQuery,
    remindersQuery,
    opportunitiesQuery
  ]);

  const taskItems = (tasksRes.data || []).map(mapTaskToDueNotification).filter(Boolean);
  const reminderItems = (remindersRes.data || []).map(mapReminderToDueNotification).filter(Boolean);
  const dealItems = (opportunitiesRes.data || []).map(mapOpportunityToDueNotification).filter(Boolean);

  return [...taskItems, ...reminderItems, ...dealItems]
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 25);
}

function renderDueNotificationsUI() {
  if (!notificationsList || !notificationsCount) return;

  const readMap = readJsonStorage(DUE_READ_STORAGE_KEY, {});
  const unreadCount = state.dueNotificationState.items.filter(item => !readMap[item.key]).length;
  state.dueNotificationState.unreadCount = unreadCount;

  // Bell badge
  if (unreadCount > 0) {
    notificationsCount.style.display = 'inline-flex';
    notificationsCount.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
  } else {
    notificationsCount.style.display = 'none';
  }

  // Bell ring animation
  const bellBtn = document.getElementById('notifications-btn');
  if (bellBtn) bellBtn.classList.toggle('has-unread', unreadCount > 0);

  // Unread count pill inside header
  const unreadPill = document.getElementById('notifications-unread-pill');
  if (unreadPill) {
    if (unreadCount > 0) {
      unreadPill.style.display = 'inline-flex';
      unreadPill.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    } else {
      unreadPill.style.display = 'none';
    }
  }

  // Nav badges for Tasks and Reminders
  const tasksDue = state.dueNotificationState.items.filter(i => i.entityType === 'task').length;
  const remindersDue = state.dueNotificationState.items.filter(i => i.entityType === 'reminder').length;
  const tasksBadge = document.getElementById('nav-badge-tasks');
  const remindersBadge = document.getElementById('nav-badge-reminders');
  if (tasksBadge) {
    tasksBadge.style.display = tasksDue > 0 ? '' : 'none';
    tasksBadge.textContent = tasksDue > 99 ? '99+' : String(tasksDue);
  }
  if (remindersBadge) {
    remindersBadge.style.display = remindersDue > 0 ? '' : 'none';
    remindersBadge.textContent = remindersDue > 99 ? '99+' : String(remindersDue);
  }

  // Apply active filter
  let filteredItems = state.dueNotificationState.items;
  if (notifActiveFilter === 'unread') {
    filteredItems = filteredItems.filter(item => !readMap[item.key]);
  } else if (notifActiveFilter === 'overdue') {
    filteredItems = filteredItems.filter(item => item.status === 'overdue');
  }

  // Empty state
  if (filteredItems.length === 0) {
    const emptyMsg = notifActiveFilter === 'unread' ? 'No unread notifications'
      : notifActiveFilter === 'overdue' ? 'No overdue items'
      : 'All caught up';
    const emptySub = notifActiveFilter === 'unread' ? 'Check back later for new alerts'
      : notifActiveFilter === 'overdue' ? 'Everything is on track'
      : 'No due alerts right now';
    notificationsList.innerHTML = `
      <div class="notifications-empty">
        <div class="notifications-empty-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>
        </div>
        <span class="notifications-empty-text">${emptyMsg}</span>
        <span class="notifications-empty-sub">${emptySub}</span>
      </div>
    `;
    return;
  }

  const TYPE_LABEL = { task: 'Task', reminder: 'Reminder', deal: 'Deal' };

  notificationsList.innerHTML = filteredItems.map(item => {
    const isUnread = !readMap[item.key];
    const unreadClass = isUnread ? ' unread' : '';
    const typeLabel = TYPE_LABEL[item.entityType] || item.entityType;
    const timeLabel = formatDueLabel(item.dueAt);
    return `
      <button class="notification-item ${item.status}${unreadClass}" data-view="${item.view}" data-key="${item.key}">
        <div class="notification-item-body">
          <div class="notification-item-head">
            <span class="notification-item-type">${typeLabel}</span>
            <span class="notification-item-time">${timeLabel}</span>
          </div>
          <div class="notification-item-title">${escapeHtml(item.title)}</div>
          <div class="notification-item-message">${escapeHtml(item.message)}</div>
        </div>
        ${isUnread ? '<div class="notif-unread-dot"></div>' : ''}
      </button>
    `;
  }).join('');
}

function markSingleNotificationRead(key) {
  if (!key) return;
  const readMap = readJsonStorage(DUE_READ_STORAGE_KEY, {});
  readMap[key] = Date.now();
  writeJsonStorage(DUE_READ_STORAGE_KEY, readMap);
  renderDueNotificationsUI();
}

function updateNotificationPermissionCTA() {
  if (!notificationsEnableBtn) return;

  const permission = getNotificationPermission();
  if (permission === 'default') {
    notificationsEnableBtn.style.display = 'inline-flex';
    notificationsEnableBtn.textContent = 'Enable device alerts';
  } else if (permission === 'denied') {
    notificationsEnableBtn.style.display = 'inline-flex';
    notificationsEnableBtn.textContent = 'Alerts blocked in browser';
  } else {
    notificationsEnableBtn.style.display = 'none';
  }
}

async function pushDeviceNotification(item) {
  if (!('serviceWorker' in navigator)) return;
  if (getNotificationPermission() !== 'granted') return;

  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;

  const titlePrefix = item.status === 'overdue' ? 'Overdue' : (item.status === 'due-today' ? 'Due today' : 'Due soon');
  const title = `${titlePrefix}: ${item.entityType === 'deal' ? 'Deal' : (item.entityType === 'task' ? 'Task' : 'Reminder')}`;

  await registration.showNotification(title, {
    body: `${item.title} — ${item.message}`,
    icon: '/assets/icons/whiteblue.png',
    badge: '/assets/icons/whiteblue.png',
    tag: item.key,
    renotify: false,
    data: {
      url: `/crm/`,
      view: item.view
    }
  });
}

function getDuePopupContainer() {
  let container = document.getElementById('due-popup-container');
  if (container) return container;

  container = document.createElement('div');
  container.id = 'due-popup-container';
  container.className = 'due-popup-container';
  document.body.appendChild(container);
  return container;
}

function clearDuePopupTimers() {
  state.duePopupHideTimers.forEach(timer => clearTimeout(timer));
  state.duePopupHideTimers = [];
}

function showDuePopup(items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const container = getDuePopupContainer();
  clearDuePopupTimers();

  const renderItems = items.slice(0, 3);
  container.innerHTML = renderItems.map((item) => {
    const typeLabel = item.entityType === 'deal' ? 'Deal' : (item.entityType === 'task' ? 'Task' : 'Reminder');
    const dueText = formatDueLabel(item.dueAt);
    return `
      <div class="due-popup-card ${item.status}" data-view="${item.view}" role="button" tabindex="0">
        <button type="button" class="due-popup-close" aria-label="Close notification">✕</button>
        <div class="due-popup-head">
          <span class="due-popup-type">${typeLabel}</span>
          <span class="due-popup-time">${dueText}</span>
        </div>
        <div class="due-popup-title">${item.title}</div>
        <div class="due-popup-message">${item.message}</div>
      </div>
    `;
  }).join('');

  container.classList.add('active');

  container.onclick = async (e) => {
    const closeBtn = e.target.closest('.due-popup-close');
    if (closeBtn) {
      // Remove only the single card the user closed
      const card = closeBtn.closest('.due-popup-card');
      if (card) card.remove();
      // don't navigate when closing
      return;
    }

    const card = e.target.closest('.due-popup-card');
    if (!card) return;
    const view = card.dataset.view;
    container.classList.remove('active');
    if (view && view !== state.currentView) {
      await loadView(view);
    }
  };

  container.onkeydown = async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.due-popup-card');
    if (!card || e.target.closest('.due-popup-close')) return;
    e.preventDefault();
    const view = card.dataset.view;
    container.classList.remove('active');
    if (view && view !== state.currentView) {
      await loadView(view);
    }
  };

  const hideTimer = setTimeout(() => {
    container.classList.remove('active');
  }, 6000);
  state.duePopupHideTimers.push(hideTimer);
}

async function notifyForNewDueItems(items, forcePopup = false) {
  const now = Date.now();
  const notifiedMap = readJsonStorage(DUE_NOTIFIED_STORAGE_KEY, {});
  const fresh = [];

  items.forEach(item => {
    if (!notifiedMap[item.key]) {
      fresh.push(item);
      notifiedMap[item.key] = now;
    }
  });

  const retentionMs = 7 * 24 * 60 * 60 * 1000;
  Object.keys(notifiedMap).forEach(key => {
    if (now - notifiedMap[key] > retentionMs) {
      delete notifiedMap[key];
    }
  });

  writeJsonStorage(DUE_NOTIFIED_STORAGE_KEY, notifiedMap);

  if (fresh.length === 0 && !forcePopup) return;

  const toNotify = fresh.slice(0, 3);
  for (const item of toNotify) {
    await pushDeviceNotification(item);
  }

  const dueNowItems = items.filter(item => item.status === 'overdue' || item.status === 'due-today');
  const popupItems = fresh.length > 0 ? fresh : dueNowItems;

  if (popupItems.length > 0) {
    showDuePopup(popupItems);
  }
}

function markAllDueNotificationsRead() {
  const readMap = readJsonStorage(DUE_READ_STORAGE_KEY, {});
  state.dueNotificationState.items.forEach(item => {
    readMap[item.key] = Date.now();
  });
  writeJsonStorage(DUE_READ_STORAGE_KEY, readMap);
  renderDueNotificationsUI();
}

async function refreshDueNotifications({ forcePopup = false } = {}) {
  try {
    const items = await fetchDueNotificationItems();
    state.dueNotificationState.items = items;
    renderDueNotificationsUI();
    updateNotificationPermissionCTA();
    await notifyForNewDueItems(items, forcePopup);
  } catch (error) {
    console.error('Due notifications refresh failed:', error);
  }
}

function startDueNotificationsMonitor() {
  stopDueNotificationsMonitor();

  refreshDueNotifications();

  state.dueNotificationsPollId = window.setInterval(() => {
    refreshDueNotifications();
  }, 120000);

  document.addEventListener('visibilitychange', handleDueNotificationVisibility);
}

function stopDueNotificationsMonitor() {
  if (state.dueNotificationsPollId) {
    clearInterval(state.dueNotificationsPollId);
    state.dueNotificationsPollId = null;
  }
  document.removeEventListener('visibilitychange', handleDueNotificationVisibility);
}

function handleDueNotificationVisibility() {
  if (!document.hidden) {
    refreshDueNotifications();
  }
}

function checkDueReminders() {
  refreshDueNotifications();
}


// ── Exports ────────────────────────────────────────────────────
export {
  getNotificationPermission,
  requestNotificationPermission,
  readJsonStorage,
  writeJsonStorage,
  formatDueLabel,
  getDueStatus,
  mapTaskToDueNotification,
  mapReminderToDueNotification,
  mapOpportunityToDueNotification,
  fetchDueNotificationItems,
  renderDueNotificationsUI,
  updateNotificationPermissionCTA,
  pushDeviceNotification,
  getDuePopupContainer,
  clearDuePopupTimers,
  showDuePopup,
  notifyForNewDueItems,
  markAllDueNotificationsRead,
  markSingleNotificationRead,
  refreshDueNotifications,
  startDueNotificationsMonitor,
  stopDueNotificationsMonitor,
  handleDueNotificationVisibility,
  checkDueReminders,
};
