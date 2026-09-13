// modules/notifications/ui.js
// Attio / Linear-inspired notification UI component.

import { state } from '../state.js';
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  NOTIFICATION_URGENCIES,
  escapeHtml,
  formatRelativeTime,
} from './types.js';
import { notificationStore } from './store.js';
import { getBrowserPermission, requestBrowserPermission } from './browser.js';
import { playNotificationChime } from './sound.js';

let isInitialized = false;
let isSettingsTrayOpen = false;

export function initNotificationUI() {
  if (isInitialized) return;
  isInitialized = true;

  bindBellButton();
  bindGlobalListeners();

  // Subscribe to store updates
  notificationStore.subscribe((storeState) => {
    updateBadges(storeState);
    if (isPanelOpen()) {
      renderPanelContent(storeState);
    }
  });
}

function getEl(id) {
  return document.getElementById(id);
}

function isPanelOpen() {
  const wrapper = getEl('notifications-wrapper');
  return wrapper?.classList.contains('active') ?? false;
}

// ── Badges & Bell State ───────────────────────────────────────────────────────

function updateBadges(storeState) {
  const unreadCount = storeState.unreadCount;

  // Bell badge
  const badge = getEl('notifications-count');
  if (badge) {
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
  }

  // Bell button state
  const bellBtn = getEl('notifications-btn');
  if (bellBtn) {
    bellBtn.classList.toggle('has-unread', unreadCount > 0);
  }

  // Sidebar badge indicators for tasks & reminders
  const tasksDue = storeState.items.filter((i) => i.entityType === 'task' && !i.isRead).length;
  const remindersDue = storeState.items.filter((i) => i.entityType === 'reminder' && !i.isRead).length;

  const taskBadge = getEl('nav-badge-tasks');
  if (taskBadge) {
    taskBadge.textContent = tasksDue > 99 ? '99+' : String(tasksDue);
    taskBadge.style.display = tasksDue > 0 ? 'inline-flex' : 'none';
  }

  const reminderBadge = getEl('nav-badge-reminders');
  if (reminderBadge) {
    reminderBadge.textContent = remindersDue > 99 ? '99+' : String(remindersDue);
    reminderBadge.style.display = remindersDue > 0 ? 'inline-flex' : 'none';
  }
}

// ── Bell Button & Panel Toggle ────────────────────────────────────────────────

function bindBellButton() {
  const btn = getEl('notifications-btn');
  const wrapper = getEl('notifications-wrapper');
  if (!btn || !wrapper) return;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close user menu if open
    getEl('user-menu')?.classList.remove('active');

    const isOpen = wrapper.classList.contains('active');
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  });
}

export function openPanel() {
  const wrapper = getEl('notifications-wrapper');
  const btn = getEl('notifications-btn');
  if (!wrapper) return;

  wrapper.classList.add('active');
  btn?.setAttribute('aria-expanded', 'true');

  // Render fresh content
  renderPanelContent(notificationStore.getState());

  // Focus first item or filter
  setTimeout(() => {
    const firstItem = wrapper.querySelector('.sn-item, .sn-filter-tab');
    firstItem?.focus();
  }, 50);
}

export function closePanel() {
  const wrapper = getEl('notifications-wrapper');
  const btn = getEl('notifications-btn');
  if (!wrapper) return;

  wrapper.classList.remove('active');
  btn?.setAttribute('aria-expanded', 'false');
  btn?.focus();
}

// ── Global Listeners ──────────────────────────────────────────────────────────

function bindGlobalListeners() {
  const wrapper = getEl('notifications-wrapper');

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (wrapper && wrapper.classList.contains('active') && !wrapper.contains(e.target)) {
      closePanel();
    }
  });

  // Global escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && wrapper?.classList.contains('active')) {
      closePanel();
    }
  });
}

// ── Panel Content Rendering ───────────────────────────────────────────────────

export function renderPanelContent(storeState) {
  const panel = getEl('notifications-panel');
  if (!panel) return;

  const { items, filteredItems, groupedItems, unreadCount, activeFilter, preferences } = storeState;
  const permission = getBrowserPermission();

  panel.innerHTML = `
    <!-- Mobile Drag Handle -->
    <div class="sn-sheet-handle" aria-hidden="true"></div>

    <!-- Header -->
    <div class="sn-header">
      <div class="sn-header-left">
        <h2 class="sn-title">Inbox</h2>
        <span class="sn-unread-count-pill" style="${unreadCount > 0 ? '' : 'display:none;'}">
          ${unreadCount} unread
        </span>
      </div>
      <div class="sn-header-actions">
        <button
          type="button"
          class="sn-icon-btn ${unreadCount === 0 ? 'disabled' : ''}"
          id="sn-mark-all-btn"
          title="Mark all as read"
          aria-label="Mark all as read"
          ${unreadCount === 0 ? 'disabled' : ''}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>
        </button>
        <button
          type="button"
          class="sn-icon-btn ${isSettingsTrayOpen ? 'active' : ''}"
          id="sn-settings-toggle-btn"
          title="Notification preferences"
          aria-label="Notification preferences"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </div>

    <!-- Quick Settings Tray (Collapsible) -->
    <div class="sn-settings-tray ${isSettingsTrayOpen ? 'open' : ''}" id="sn-settings-tray">
      <div class="sn-settings-tray-inner">
        <div class="sn-settings-row">
          <div class="sn-settings-meta">
            <span class="sn-settings-label">Browser Notifications</span>
            <span class="sn-settings-sub">
              ${permission === 'granted' ? 'Enabled for background alerts' : permission === 'denied' ? 'Blocked in browser' : 'Prompt on permission'}
            </span>
          </div>
          <button
            type="button"
            class="sn-btn-toggle ${preferences.browserPushEnabled && permission === 'granted' ? 'active' : ''}"
            id="sn-toggle-browser-btn"
          >
            ${permission === 'granted' ? (preferences.browserPushEnabled ? 'On' : 'Off') : 'Enable'}
          </button>
        </div>
        <div class="sn-settings-row">
          <div class="sn-settings-meta">
            <span class="sn-settings-label">Audio Chime</span>
            <span class="sn-settings-sub">Play subtle sound on arrival</span>
          </div>
          <button
            type="button"
            class="sn-btn-toggle ${preferences.soundEnabled ? 'active' : ''}"
            id="sn-toggle-sound-btn"
          >
            ${preferences.soundEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </div>

    <!-- Segmented Filter Control (Linear / Attio style) -->
    <div class="sn-filter-bar" role="tablist" aria-label="Notification filters">
      <button
        type="button"
        class="sn-filter-tab ${activeFilter === 'all' ? 'active' : ''}"
        data-filter="all"
        role="tab"
        aria-selected="${activeFilter === 'all'}"
      >
        All <span class="sn-tab-count">${items.length}</span>
      </button>
      <button
        type="button"
        class="sn-filter-tab ${activeFilter === 'unread' ? 'active' : ''}"
        data-filter="unread"
        role="tab"
        aria-selected="${activeFilter === 'unread'}"
      >
        Unread <span class="sn-tab-count">${unreadCount}</span>
      </button>
      <button
        type="button"
        class="sn-filter-tab ${activeFilter === 'urgent' ? 'active' : ''}"
        data-filter="urgent"
        role="tab"
        aria-selected="${activeFilter === 'urgent'}"
      >
        Urgent
      </button>
    </div>

    <!-- List Body -->
    <div class="sn-list-container" id="sn-list-container" role="list">
      ${renderItemsList(filteredItems, groupedItems, activeFilter)}
    </div>

    <!-- Footer -->
    <div class="sn-footer">
      ${
        permission === 'default'
          ? `
        <div class="sn-permission-banner">
          <div class="sn-permission-text">
            <span>Get alerts even when SafiTrack is in background</span>
          </div>
          <button type="button" class="sn-permission-action" id="sn-enable-browser-cta">
            Enable
          </button>
        </div>
      `
          : `
        <div class="sn-footer-status">
          <span class="sn-kbd-hint"><kbd>↑</kbd><kbd>↓</kbd> to navigate · <kbd>↵</kbd> to open · <kbd>Esc</kbd> to close</span>
        </div>
      `
      }
    </div>
  `;

  bindPanelEvents(panel);
}

function renderItemsList(filteredItems, groupedItems, activeFilter) {
  if (filteredItems.length === 0) {
    const emptyHeadline =
      activeFilter === 'unread' ? 'All caught up' : activeFilter === 'urgent' ? 'No urgent items' : 'No notifications';
    const emptySub =
      activeFilter === 'unread'
        ? "You've read all your notifications."
        : activeFilter === 'urgent'
        ? 'Nothing requires immediate action right now.'
        : 'New tasks, reminders, and alerts will appear here.';

    return `
      <div class="sn-empty-state">
        <div class="sn-empty-icon" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        </div>
        <div class="sn-empty-title">${emptyHeadline}</div>
        <div class="sn-empty-sub">${emptySub}</div>
      </div>
    `;
  }

  // Render grouped sections: Today at top, then Overdue, then Earlier
  const { today = [], overdue = [], earlier = [], urgent = [] } = groupedItems;
  const overdueList = overdue.length > 0 ? overdue : urgent;
  let html = '';

  // 1. TODAY (Always first)
  if (today.length > 0) {
    html += `
      <div class="sn-group-header">
        <span class="sn-group-title today">Today</span>
        <span class="sn-group-badge">${today.length}</span>
      </div>
      <div class="sn-group-items">
        ${today.map((item) => renderNotificationItem(item)).join('')}
      </div>
    `;
  }

  // 2. OVERDUE (Past-due items that need attention)
  if (overdueList.length > 0) {
    html += `
      <div class="sn-group-header">
        <span class="sn-group-title overdue">Overdue</span>
        <span class="sn-group-badge">${overdueList.length}</span>
      </div>
      <div class="sn-group-items">
        ${overdueList.map((item) => renderNotificationItem(item)).join('')}
      </div>
    `;
  }

  // 3. EARLIER (Previous history)
  if (earlier.length > 0) {
    html += `
      <div class="sn-group-header">
        <span class="sn-group-title">Earlier</span>
        <span class="sn-group-badge">${earlier.length}</span>
      </div>
      <div class="sn-group-items">
        ${earlier.map((item) => renderNotificationItem(item)).join('')}
      </div>
    `;
  }

  return html;
}

function renderNotificationItem(item) {
  const iconSvg = CATEGORY_ICONS[item.entityType] || CATEGORY_ICONS.task;
  const categoryLabel = CATEGORY_LABELS[item.entityType] || item.entityType;
  const timeText = item.dueAt ? formatRelativeTime(item.dueAt) : formatRelativeTime(item.timestamp);
  const unreadClass = item.isRead ? '' : 'unread';
  const statusClass = item.status || 'active';
  const urgencyClass = item.urgency || 'normal';

  let statusBadgeHtml = '';
  if (item.status === 'overdue') {
    statusBadgeHtml = '<span class="sn-status-badge overdue">Overdue</span>';
  } else if (item.status === 'due-today') {
    statusBadgeHtml = '<span class="sn-status-badge due-today">Today</span>';
  } else if (item.status === 'due-soon') {
    statusBadgeHtml = '<span class="sn-status-badge due-soon">Upcoming</span>';
  }

  return `
    <div
      class="sn-item ${unreadClass} ${statusClass} ${urgencyClass}"
      data-id="${item.id}"
      data-view="${item.view || ''}"
      role="listitem"
      tabindex="0"
      aria-label="${escapeHtml(item.title)}: ${escapeHtml(item.message)}"
    >
      <div class="sn-item-icon-wrap" aria-hidden="true">
        ${iconSvg}
      </div>

      <div class="sn-item-content">
        <div class="sn-item-meta">
          <span class="sn-item-category">${categoryLabel}</span>
          ${statusBadgeHtml}
          <span class="sn-item-time">${timeText}</span>
        </div>
        <div class="sn-item-title">${escapeHtml(item.title)}</div>
        <div class="sn-item-message">${escapeHtml(item.message)}</div>
      </div>

      <div class="sn-item-actions">
        <button
          type="button"
          class="sn-action-btn sn-read-toggle-btn"
          data-action="toggle-read"
          title="${item.isRead ? 'Mark as unread' : 'Mark as read'}"
          aria-label="${item.isRead ? 'Mark as unread' : 'Mark as read'}"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
        </button>
      </div>

      ${!item.isRead ? '<span class="sn-unread-indicator" aria-label="Unread"></span>' : ''}
    </div>
  `;
}

// ── Event Bindings Inside Panel ───────────────────────────────────────────────

function bindPanelEvents(panel) {
  // Mark all read
  panel.querySelector('#sn-mark-all-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    notificationStore.markAllRead();
  });

  // Settings toggle
  panel.querySelector('#sn-settings-toggle-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    isSettingsTrayOpen = !isSettingsTrayOpen;
    const tray = panel.querySelector('#sn-settings-tray');
    const btn = panel.querySelector('#sn-settings-toggle-btn');
    tray?.classList.toggle('open', isSettingsTrayOpen);
    btn?.classList.toggle('active', isSettingsTrayOpen);
  });

  // Toggle browser push
  panel.querySelector('#sn-toggle-browser-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const perm = getBrowserPermission();
    if (perm !== 'granted') {
      const res = await requestBrowserPermission();
      if (res === 'granted') {
        notificationStore.updatePreferences({ browserPushEnabled: true });
      }
    } else {
      const current = notificationStore.preferences.browserPushEnabled;
      notificationStore.updatePreferences({ browserPushEnabled: !current });
    }
    renderPanelContent(notificationStore.getState());
  });

  // Toggle sound
  panel.querySelector('#sn-toggle-sound-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const current = notificationStore.preferences.soundEnabled;
    notificationStore.updatePreferences({ soundEnabled: !current });
    if (!current) {
      playNotificationChime('subtle');
    }
    renderPanelContent(notificationStore.getState());
  });

  // Enable browser push CTA in footer
  panel.querySelector('#sn-enable-browser-cta')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const res = await requestBrowserPermission();
    if (res === 'granted') {
      notificationStore.updatePreferences({ browserPushEnabled: true });
    }
    renderPanelContent(notificationStore.getState());
  });

  // Filter tabs
  panel.querySelectorAll('.sn-filter-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation();
      const filter = tab.dataset.filter;
      if (filter) {
        notificationStore.setFilter(filter);
      }
    });
  });

  // Item click delegation
  const listContainer = panel.querySelector('#sn-list-container');
  if (listContainer) {
    listContainer.addEventListener('click', async (e) => {
      const actionBtn = e.target.closest('[data-action="toggle-read"]');
      const itemEl = e.target.closest('.sn-item');
      if (!itemEl) return;

      const id = itemEl.dataset.id;
      if (actionBtn) {
        e.stopPropagation();
        notificationStore.toggleRead(id);
        return;
      }

      // Open item & navigate
      notificationStore.markRead(id);
      closePanel();

      const view = itemEl.dataset.view;
      if (view) {
        if (window.loadView) {
          await window.loadView(view);
        } else if (window.navigateView) {
          window.navigateView(view);
        }
      }
    });

    // Keyboard navigation within items
    listContainer.addEventListener('keydown', async (e) => {
      const itemEl = e.target.closest('.sn-item');
      if (!itemEl) return;

      const id = itemEl.dataset.id;
      if (e.key === 'Enter') {
        e.preventDefault();
        notificationStore.markRead(id);
        closePanel();
        const view = itemEl.dataset.view;
        if (view && window.loadView) {
          await window.loadView(view);
        }
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        notificationStore.toggleRead(id);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const all = Array.from(panel.querySelectorAll('.sn-item'));
        const idx = all.indexOf(itemEl);
        if (idx !== -1 && idx < all.length - 1) {
          all[idx + 1].focus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const all = Array.from(panel.querySelectorAll('.sn-item'));
        const idx = all.indexOf(itemEl);
        if (idx > 0) {
          all[idx - 1].focus();
        }
      }
    });
  }
}
