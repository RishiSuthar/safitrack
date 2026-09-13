// modules/notifications/index.js
// Main entry point and unified facade for SafiTrack CRM Notification System.

import { state } from '../state.js';
import { notificationStore } from './store.js';
import { notificationService } from './service.js';
import { notificationRealtime, notifyMutation } from './realtime.js';
import { initNotificationUI, openPanel, closePanel, renderPanelContent } from './ui.js';
import { requestBrowserPermission, getBrowserPermission, sendBrowserNotification } from './browser.js';
import { showNotificationToast, clearAllToasts } from './toast.js';
import { playNotificationChime } from './sound.js';
import {
  evaluateDueStatus,
  evaluateUrgency,
  formatDueLabel,
  formatRelativeTime,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_URGENCIES,
} from './types.js';

let isStarted = false;

export function initNotifications() {
  if (isStarted) return;
  isStarted = true;

  // Set reference in state
  state.notificationStore = notificationStore;

  // 1. Initialize UI bindings
  initNotificationUI();

  // 2. Start Store & Service
  notificationService.start();

  // 3. Start Realtime subscriptions
  notificationRealtime.start();
}

export function stopNotifications() {
  isStarted = false;
  notificationRealtime.stop();
  notificationService.stop();
  clearAllToasts();
  state.notificationStore = null;
}

// ── Public Facade & Store Wrapper ─────────────────────────────────────────────

const unifiedNotificationStore = {
  start() {
    initNotifications();
  },
  stop() {
    stopNotifications();
  },
  markRead(id) {
    notificationStore.markRead(id);
  },
  markAllRead() {
    notificationStore.markAllRead();
  },
  markUnread(id) {
    notificationStore.markUnread(id);
  },
  dismiss(id) {
    notificationStore.dismiss(id);
  },
  refreshNow(opts = {}) {
    return notificationService.refresh(opts);
  },
  requestBrowserPermission() {
    return requestBrowserPermission();
  },
  getBrowserPermission() {
    return getBrowserPermission();
  },
  notifyMutation(opts) {
    notifyMutation(opts);
  },
  showToast(item, opts) {
    showNotificationToast(item, opts);
  },
  playChime(variant) {
    playNotificationChime(variant);
  },
  open() {
    openPanel();
  },
  close() {
    closePanel();
  },
  get items() {
    return notificationStore.items;
  },
  get unreadCount() {
    return notificationStore.getUnreadCount();
  },
  get activeFilter() {
    return notificationStore.activeFilter;
  },
  get preferences() {
    return notificationStore.preferences;
  },
  subscribe(listener) {
    return notificationStore.subscribe(listener);
  },
};

export {
  unifiedNotificationStore as notificationStore,
  notificationService,
  notificationRealtime,
  notifyMutation,
  requestBrowserPermission,
  getBrowserPermission,
  sendBrowserNotification,
  showNotificationToast,
  playNotificationChime,
  evaluateDueStatus,
  evaluateUrgency,
  formatDueLabel,
  formatRelativeTime,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_URGENCIES,
};

// ── Legacy Compatibility Layer ────────────────────────────────────────────────
// Ensures seamless drop-in replacement across the rest of the CRM without breakage.

export const refreshDueNotifications = (opts) => notificationService.refresh(opts);
export const startDueNotificationsMonitor = () => initNotifications();
export const stopDueNotificationsMonitor = () => stopNotifications();
export const markAllDueNotificationsRead = () => notificationStore.markAllRead();
export const markSingleNotificationRead = (id) => notificationStore.markRead(id);
export const requestNotificationPermission = () => requestBrowserPermission();
export const checkDueReminders = () => notificationService.refresh();
export const getDueStatus = evaluateDueStatus;
export const pushDeviceNotification = (item) => sendBrowserNotification(item);
export const showDuePopup = (items) => {
  if (Array.isArray(items) && items[0]) {
    showNotificationToast(items[0]);
  }
};
export const clearDuePopupTimers = () => clearAllToasts();
export const renderDueNotificationsUI = () => renderPanelContent(notificationStore.getState());
