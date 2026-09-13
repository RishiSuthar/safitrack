// modules/notifications/toast.js
// Modern, refined in-app notification toasts (Linear / Attio style).

import { escapeHtml, CATEGORY_ICONS, CATEGORY_LABELS } from './types.js';
import { notificationStore } from './store.js';

const TOAST_DURATION_MS = 6000;
const MAX_VISIBLE_TOASTS = 2;

let toastContainer = null;
const activeTimers = new Map();

function getToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) {
    return toastContainer;
  }
  let el = document.getElementById('safitrack-notif-toast-stack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'safitrack-notif-toast-stack';
    el.className = 'safitrack-notif-toast-stack';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Urgent notifications');
    document.body.appendChild(el);
  }
  toastContainer = el;
  return el;
}

/**
 * Present an actionable in-app toast for high-priority / newly arrived notifications.
 * @param {import('./types.js').NotificationItem} item
 * @param {object} [options]
 */
export function showNotificationToast(item, options = {}) {
  if (!item || !item.id) return;
  const container = getToastContainer();

  // If already present, don't duplicate
  if (container.querySelector(`[data-notif-id="${item.id}"]`)) return;

  // Enforce max count
  const existingCards = container.querySelectorAll('.safitrack-notif-toast-card');
  if (existingCards.length >= MAX_VISIBLE_TOASTS) {
    const oldest = existingCards[0];
    dismissToastCard(oldest);
  }

  const iconSvg = CATEGORY_ICONS[item.entityType] || CATEGORY_ICONS.task;
  const categoryLabel = CATEGORY_LABELS[item.entityType] || item.entityType;
  const statusClass = item.status || 'active';
  const urgencyClass = item.urgency || 'normal';

  const card = document.createElement('div');
  card.className = `safitrack-notif-toast-card ${statusClass} ${urgencyClass}`;
  card.dataset.notifId = item.id;
  card.dataset.view = item.view || '';
  card.setAttribute('role', 'alert');
  card.setAttribute('tabindex', '0');

  card.innerHTML = `
    <div class="notif-toast-icon-wrap" aria-hidden="true">${iconSvg}</div>
    <div class="notif-toast-body">
      <div class="notif-toast-header">
        <span class="notif-toast-category">${categoryLabel}</span>
        ${item.status === 'overdue' ? '<span class="notif-toast-badge overdue">Overdue</span>' : ''}
        ${item.status === 'due-today' ? '<span class="notif-toast-badge due-today">Today</span>' : ''}
      </div>
      <div class="notif-toast-title">${escapeHtml(item.title)}</div>
      <div class="notif-toast-msg">${escapeHtml(item.message)}</div>
      <div class="notif-toast-actions">
        <button type="button" class="notif-toast-btn notif-toast-btn-action" data-action="view">
          View
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
        <button type="button" class="notif-toast-btn notif-toast-btn-dismiss" data-action="dismiss" aria-label="Dismiss">
          Dismiss
        </button>
      </div>
    </div>
    <button type="button" class="notif-toast-close" aria-label="Close notification" data-action="dismiss">
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
    </button>
  `;

  // Start timer
  const scheduleDismiss = () => {
    clearTimeout(activeTimers.get(item.id));
    const timer = setTimeout(() => {
      dismissToastCard(card);
    }, TOAST_DURATION_MS);
    activeTimers.set(item.id, timer);
  };

  scheduleDismiss();

  // Pause on hover / focus
  card.addEventListener('mouseenter', () => clearTimeout(activeTimers.get(item.id)));
  card.addEventListener('mouseleave', scheduleDismiss);
  card.addEventListener('focusin', () => clearTimeout(activeTimers.get(item.id)));
  card.addEventListener('focusout', scheduleDismiss);

  // Click handling
  card.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    e.stopPropagation();

    const action = actionBtn.dataset.action;
    if (action === 'dismiss') {
      dismissToastCard(card);
    } else if (action === 'view') {
      notificationStore.markRead(item.id);
      dismissToastCard(card);
      if (item.view) {
        if (window.loadView) {
          await window.loadView(item.view);
        } else if (window.navigateView) {
          window.navigateView(item.view);
        }
      }
      // Execute deep link if provided
      if (item.actionPayload?.execute && typeof item.actionPayload.execute === 'function') {
        item.actionPayload.execute();
      }
    }
  });

  // Keyboard navigation
  card.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismissToastCard(card);
    } else if (e.key === 'Enter' && e.target === card) {
      e.preventDefault();
      notificationStore.markRead(item.id);
      dismissToastCard(card);
      if (item.view && window.loadView) {
        await window.loadView(item.view);
      }
    }
  });

  container.appendChild(card);

  // Trigger enter animation
  requestAnimationFrame(() => {
    card.classList.add('visible');
  });
}

function dismissToastCard(card) {
  if (!card) return;
  const id = card.dataset.notifId;
  clearTimeout(activeTimers.get(id));
  activeTimers.delete(id);

  card.classList.remove('visible');
  card.classList.add('dismissing');

  setTimeout(() => {
    card.remove();
    if (toastContainer && toastContainer.children.length === 0) {
      toastContainer.remove();
      toastContainer = null;
    }
  }, 220);
}

export function clearAllToasts() {
  const container = getToastContainer();
  container.querySelectorAll('.safitrack-notif-toast-card').forEach((card) => {
    dismissToastCard(card);
  });
}
