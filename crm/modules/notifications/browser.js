// modules/notifications/browser.js
// Enterprise Web Notification API and Service Worker push integration for PWA / desktop.

import { showToast } from '../ui/toast.js';
import { CATEGORY_LABELS } from './types.js';

export function getBrowserPermission() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export function isBrowserNotificationSupported() {
  return 'Notification' in window;
}

/**
 * Explicit user-triggered permission request.
 * Never calls without user gesture.
 */
export async function requestBrowserPermission() {
  if (!isBrowserNotificationSupported()) {
    showToast('Notifications are not supported in this browser.', 'error');
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    showToast('Browser notifications are already enabled.', 'info');
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    showToast(
      'Notifications are blocked in your browser settings. Please enable them in site permissions.',
      'error'
    );
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showToast('Notifications enabled successfully.', 'success');
      // Send a test confirmation notification
      await sendBrowserNotification({
        id: 'welcome',
        entityType: 'system',
        title: 'SafiTrack Notifications Active',
        message: 'You will receive timely alerts for urgent tasks and reminders.',
        view: 'main-dashboard',
      }, { force: true });
    } else if (permission === 'denied') {
      showToast('Notifications were denied.', 'error');
    }
    return permission;
  } catch (err) {
    console.error('[BrowserNotifications] Permission request error:', err);
    return 'error';
  }
}

/**
 * Send an OS-level browser notification via the Service Worker or Web Notification API.
 * Uses smart delivery: if the CRM tab is actively focused and visible, avoids duplicate OS notifications.
 * @param {import('./types.js').NotificationItem} item
 * @param {object} [options]
 */
export async function sendBrowserNotification(item, options = {}) {
  if (getBrowserPermission() !== 'granted') return false;

  // Smart Delivery: If user is actively looking at and interacting with this tab,
  // do not trigger OS push (in-app toast handles focused state), unless forced.
  if (!options.force && !document.hidden && document.hasFocus && document.hasFocus()) {
    return false;
  }

  const categoryLabel = CATEGORY_LABELS[item.entityType] || 'Alert';
  const statusPrefix = item.status === 'overdue' ? 'Overdue: ' : item.status === 'due-today' ? 'Due today: ' : '';
  const title = `${statusPrefix}${categoryLabel}`;
  const body = `${item.title}${item.message ? ` — ${item.message}` : ''}`;
  const tag = `safitrack:${item.id || Date.now()}`;

  const notificationOptions = {
    body,
    icon: '/assets/icons/whiteblue.png',
    badge: '/assets/icons/whiteblue.png',
    tag,
    renotify: false,
    silent: false,
    data: {
      url: '/crm/',
      view: item.view || 'main-dashboard',
      entityId: item.entityId || null,
      entityType: item.entityType || null,
      timestamp: Date.now(),
    },
  };

  try {
    // Prefer Service Worker registration if available (required for PWA and background delivery)
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration && registration.showNotification) {
        await registration.showNotification(title, notificationOptions);
        return true;
      }
    }

    // Fallback: standard window Notification API
    const n = new window.Notification(title, notificationOptions);
    n.onclick = (e) => {
      e.preventDefault();
      window.focus();
      if (item.view && window.loadView) {
        window.loadView(item.view);
      }
      n.close();
    };
    return true;
  } catch (err) {
    console.warn('[BrowserNotifications] Failed to display notification:', err);
    return false;
  }
}
