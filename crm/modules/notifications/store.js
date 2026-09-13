// modules/notifications/store.js
// Centralized reactive notification store with multi-tab BroadcastChannel synchronization.

import { state } from '../state.js';
import { evaluateDueStatus, evaluateUrgency, NOTIFICATION_URGENCIES, NOTIFICATION_STATUSES } from './types.js';

const STORAGE_PREFIX = 'safitrack_notif_v2';
const BROADCAST_CHANNEL_NAME = 'safitrack_notifications_channel';

const DEFAULT_PREFERENCES = {
  browserPushEnabled: false,
  soundEnabled: false,
  notifyTasks: true,
  notifyReminders: true,
  notifyDeals: true,
  notifyContracts: true,
  notifyNudges: true,
};

class NotificationStore {
  constructor() {
    this.items = []; // Array of NotificationItem
    this.activeFilter = 'all'; // 'all' | 'unread' | 'urgent'
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.readMap = {}; // { [notificationId]: timestamp }
    this.dismissedMap = {}; // { [notificationId]: timestamp }
    this.listeners = new Set();
    this.broadcastChannel = null;

    this._initBroadcast();
  }

  // ── User Storage Scoping ───────────────────────────────────────────────────

  _getStorageKey() {
    const uid = state.currentUser?.id || 'guest';
    return `${STORAGE_PREFIX}:${uid}`;
  }

  _loadPersistedState() {
    try {
      const raw = localStorage.getItem(this._getStorageKey());
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.readMap = parsed.readMap || {};
        this.dismissedMap = parsed.dismissedMap || {};
        this.preferences = { ...DEFAULT_PREFERENCES, ...(parsed.preferences || {}) };
      }
    } catch {
      // Ignore parse or storage errors
    }
  }

  _savePersistedState() {
    try {
      const payload = {
        readMap: this.readMap,
        dismissedMap: this.dismissedMap,
        preferences: this.preferences,
      };
      localStorage.setItem(this._getStorageKey(), JSON.stringify(payload));
    } catch {
      // Storage quota or restriction
    }
  }

  // ── Multi-Tab Sync ─────────────────────────────────────────────────────────

  _initBroadcast() {
    if ('BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.broadcastChannel.onmessage = (event) => {
          this._handleBroadcastMessage(event.data);
        };
      } catch {
        this.broadcastChannel = null;
      }
    }

    // Fallback: storage event
    window.addEventListener('storage', (e) => {
      if (e.key === this._getStorageKey() && e.newValue) {
        this._loadPersistedState();
        this._recomputeReadStates();
        this.emitChange();
      }
    });
  }

  _broadcast(type, payload) {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({ type, payload, senderId: state.currentUser?.id });
      } catch {
        // Channel closed or throttled
      }
    }
  }

  _handleBroadcastMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'MARK_READ':
        if (msg.payload?.id) {
          this.readMap[msg.payload.id] = msg.payload.timestamp || Date.now();
          this._recomputeReadStates();
          this.emitChange();
        }
        break;
      case 'MARK_UNREAD':
        if (msg.payload?.id) {
          delete this.readMap[msg.payload.id];
          this._recomputeReadStates();
          this.emitChange();
        }
        break;
      case 'MARK_ALL_READ':
        if (msg.payload?.readMap) {
          this.readMap = { ...this.readMap, ...msg.payload.readMap };
          this._recomputeReadStates();
          this.emitChange();
        }
        break;
      case 'DISMISS':
        if (msg.payload?.id) {
          this.dismissedMap[msg.payload.id] = Date.now();
          this.items = this.items.filter((i) => i.id !== msg.payload.id);
          this.emitChange();
        }
        break;
      case 'PREFERENCES_UPDATED':
        if (msg.payload?.preferences) {
          this.preferences = { ...this.preferences, ...msg.payload.preferences };
          this.emitChange();
        }
        break;
      case 'SYNC_REFRESH':
        document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
        break;
      default:
        break;
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  init() {
    this._loadPersistedState();
    this.emitChange();
  }

  reset() {
    this.items = [];
    this.readMap = {};
    this.dismissedMap = {};
    this.activeFilter = 'all';
    this.emitChange();
  }

  // ── Reactive Subscriptions ─────────────────────────────────────────────────

  subscribe(listener) {
    this.listeners.add(listener);
    // Immediately call listener with current state
    try {
      listener(this.getState());
    } catch (e) {
      console.error('[NotificationStore] Listener invocation error:', e);
    }
    return () => this.listeners.delete(listener);
  }

  emitChange() {
    const currentState = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(currentState);
      } catch (err) {
        console.error('[NotificationStore] subscriber error:', err);
      }
    });
  }

  getState() {
    return {
      items: this.items,
      filteredItems: this.getFilteredItems(),
      groupedItems: this.getGroupedItems(),
      unreadCount: this.getUnreadCount(),
      activeFilter: this.activeFilter,
      preferences: this.preferences,
    };
  }

  // ── State Mutators ─────────────────────────────────────────────────────────

  setItems(newItems) {
    const now = Date.now();
    // Filter out dismissed items
    this.items = (newItems || [])
      .filter((item) => !this.dismissedMap[item.id])
      .map((item) => {
        const isRead = Boolean(this.readMap[item.id]);
        const status = item.dueAt ? evaluateDueStatus(item.dueAt) : item.status || 'active';
        const urgency = evaluateUrgency(status, item.entityType);
        return {
          ...item,
          status,
          urgency,
          isRead,
          readAt: this.readMap[item.id] || null,
          createdAt: item.createdAt || now,
        };
      })
      .sort((a, b) => {
        // Unread first, then by urgency, then timestamp descending
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        const urgencyScore = { urgent: 4, high: 3, normal: 2, low: 1 };
        const scoreDiff = (urgencyScore[b.urgency] || 0) - (urgencyScore[a.urgency] || 0);
        if (scoreDiff !== 0) return scoreDiff;
        const timeA = a.timestamp || (a.dueAt ? a.dueAt.getTime() : 0);
        const timeB = b.timestamp || (b.dueAt ? b.dueAt.getTime() : 0);
        return timeB - timeA;
      });

    this.emitChange();
  }

  _recomputeReadStates() {
    this.items = this.items.map((item) => ({
      ...item,
      isRead: Boolean(this.readMap[item.id]),
      readAt: this.readMap[item.id] || null,
    }));
  }

  markRead(id) {
    if (!id) return;
    const now = Date.now();
    this.readMap[id] = now;
    this._recomputeReadStates();
    this._savePersistedState();
    this._broadcast('MARK_READ', { id, timestamp: now });
    this.emitChange();
  }

  markUnread(id) {
    if (!id) return;
    delete this.readMap[id];
    this._recomputeReadStates();
    this._savePersistedState();
    this._broadcast('MARK_UNREAD', { id });
    this.emitChange();
  }

  toggleRead(id) {
    if (this.readMap[id]) {
      this.markUnread(id);
    } else {
      this.markRead(id);
    }
  }

  markAllRead() {
    const now = Date.now();
    this.items.forEach((item) => {
      this.readMap[item.id] = now;
    });
    this._recomputeReadStates();
    this._savePersistedState();
    this._broadcast('MARK_ALL_READ', { readMap: { ...this.readMap } });
    this.emitChange();
  }

  dismiss(id) {
    if (!id) return;
    this.dismissedMap[id] = Date.now();
    this.items = this.items.filter((item) => item.id !== id);
    this._savePersistedState();
    this._broadcast('DISMISS', { id });
    this.emitChange();
  }

  clearAll() {
    const now = Date.now();
    this.items.forEach((item) => {
      this.dismissedMap[item.id] = now;
    });
    this.items = [];
    this._savePersistedState();
    this._broadcast('DISMISS_ALL', {});
    this.emitChange();
  }

  setFilter(filter) {
    if (['all', 'unread', 'urgent'].includes(filter)) {
      this.activeFilter = filter;
      this.emitChange();
    }
  }

  updatePreferences(updates = {}) {
    this.preferences = { ...this.preferences, ...updates };
    this._savePersistedState();
    this._broadcast('PREFERENCES_UPDATED', { preferences: this.preferences });
    this.emitChange();
  }

  // ── Query Getters ──────────────────────────────────────────────────────────

  getUnreadCount() {
    return this.items.filter((item) => !item.isRead).length;
  }

  getFilteredItems() {
    if (this.activeFilter === 'unread') {
      return this.items.filter((item) => !item.isRead);
    }
    if (this.activeFilter === 'urgent') {
      return this.items.filter(
        (item) => item.urgency === NOTIFICATION_URGENCIES.URGENT || item.urgency === NOTIFICATION_URGENCIES.HIGH
      );
    }
    return this.items;
  }

  getGroupedItems() {
    const filtered = this.getFilteredItems();
    const today = [];
    const overdue = [];
    const earlier = [];

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;

    filtered.forEach((item) => {
      const itemDueTime = item.dueAt ? item.dueAt.getTime() : null;
      const itemCreatedTime = item.createdAt || item.timestamp || 0;

      // If scheduled/due for today OR created today without a past due date
      const isDueToday = itemDueTime && itemDueTime >= todayStart && itemDueTime < todayEnd;
      const isCreatedToday = itemCreatedTime >= todayStart && itemCreatedTime < todayEnd;
      const isPastDue = itemDueTime && itemDueTime < todayStart;

      if (isDueToday || (isCreatedToday && !isPastDue) || item.status === NOTIFICATION_STATUSES.DUE_TODAY) {
        today.push(item);
      } else if (isPastDue || item.status === NOTIFICATION_STATUSES.OVERDUE) {
        overdue.push(item);
      } else {
        earlier.push(item);
      }
    });

    const sortSection = (list) => {
      return list.sort((a, b) => {
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        const timeA = a.timestamp || (a.dueAt ? a.dueAt.getTime() : 0);
        const timeB = b.timestamp || (b.dueAt ? b.dueAt.getTime() : 0);
        return timeB - timeA;
      });
    };

    const sortedToday = sortSection(today);
    const sortedOverdue = sortSection(overdue);
    const sortedEarlier = sortSection(earlier);

    return {
      today: sortedToday,
      overdue: sortedOverdue,
      earlier: sortedEarlier,
      urgent: sortedOverdue, // Backward-compat alias
    };
  }
}

export const notificationStore = new NotificationStore();
