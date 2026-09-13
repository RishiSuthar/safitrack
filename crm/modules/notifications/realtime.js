// modules/notifications/realtime.js
// Supabase Realtime table subscriptions and local optimistic mutation event bus.

import { state, supabaseClient } from '../state.js';
import { notificationService } from './service.js';
import { notificationStore } from './store.js';

let realtimeChannel = null;
let debounceTimer = null;

function scheduleDebouncedRefresh(delayMs = 400) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    notificationService.refresh();
  }, delayMs);
}

class NotificationRealtimeManager {
  constructor() {
    this.isSubscribed = false;
  }

  start() {
    if (this.isSubscribed) return;
    this._subscribeSupabaseRealtime();
    this._bindDomEvents();
    this.isSubscribed = true;
  }

  stop() {
    if (realtimeChannel) {
      supabaseClient.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    clearTimeout(debounceTimer);
    this._unbindDomEvents();
    this.isSubscribed = false;
  }

  // ── Supabase Postgres Changes ──────────────────────────────────────────────

  _subscribeSupabaseRealtime() {
    const orgId = state.currentOrganization?.id;
    const channelName = orgId
      ? `safitrack:notifications:${orgId}`
      : 'safitrack:notifications:global';

    if (realtimeChannel) {
      supabaseClient.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabaseClient.channel(channelName);

    // Listen to tasks changes
    realtimeChannel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        (payload) => {
          this._handleTableChange('tasks', payload);
        }
      )
      // Listen to reminders changes
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'reminders' },
        (payload) => {
          this._handleTableChange('reminders', payload);
        }
      )
      // Listen to opportunities changes
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'opportunities' },
        (payload) => {
          this._handleTableChange('opportunities', payload);
        }
      )
      // Listen to service contracts changes
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'service_contracts' },
        (payload) => {
          this._handleTableChange('service_contracts', payload);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Channel connected
        }
      });
  }

  _handleTableChange(table, payload) {
    const { eventType, new: newRec, old: oldRec } = payload;

    // Fast path: if task/reminder was marked completed or deleted, remove from store immediately
    if (eventType === 'DELETE' && oldRec?.id) {
      const prefix = table === 'tasks' ? 'task' : table === 'reminders' ? 'reminder' : table === 'opportunities' ? 'deal' : 'contract';
      notificationStore.dismiss(`${prefix}:${oldRec.id}`);
    } else if (eventType === 'UPDATE' && newRec) {
      if ((table === 'tasks' && newRec.status === 'completed') || (table === 'reminders' && newRec.is_completed)) {
        const prefix = table === 'tasks' ? 'task' : 'reminder';
        notificationStore.dismiss(`${prefix}:${newRec.id}`);
      }
    }

    scheduleDebouncedRefresh(500);
  }

  // ── DOM Event Bus ──────────────────────────────────────────────────────────

  _bindDomEvents() {
    this._handleRefreshEvent = (e) => {
      notificationService.refresh({ forceToast: e.detail?.forcePopup ?? false });
    };

    this._handleViewChangedEvent = () => {
      notificationService.refresh();
    };

    this._handleMutationEvent = (e) => {
      const { table, action, id, record } = e.detail || {};
      this.notifyMutation({ table, action, id, record });
    };

    document.addEventListener('safitrack:notification-refresh', this._handleRefreshEvent);
    document.addEventListener('safitrack:view-changed', this._handleViewChangedEvent);
    document.addEventListener('safitrack:mutation', this._handleMutationEvent);
  }

  _unbindDomEvents() {
    if (this._handleRefreshEvent) {
      document.removeEventListener('safitrack:notification-refresh', this._handleRefreshEvent);
    }
    if (this._handleViewChangedEvent) {
      document.removeEventListener('safitrack:view-changed', this._handleViewChangedEvent);
    }
    if (this._handleMutationEvent) {
      document.removeEventListener('safitrack:mutation', this._handleMutationEvent);
    }
  }

  /**
   * Called by feature modules (tasks, reminders, opps) when local mutations occur.
   * Provides zero-latency optimistic updates before server round-trip.
   */
  notifyMutation({ table, action, id, record }) {
    if (!table) return;

    if (action === 'delete' && id) {
      const prefix = table === 'tasks' ? 'task' : table === 'reminders' ? 'reminder' : table === 'opportunities' ? 'deal' : 'contract';
      notificationStore.dismiss(`${prefix}:${id}`);
    } else if (action === 'complete' && id) {
      const prefix = table === 'tasks' ? 'task' : 'reminder';
      notificationStore.dismiss(`${prefix}:${id}`);
    }

    scheduleDebouncedRefresh(250);
  }
}

export const notificationRealtime = new NotificationRealtimeManager();
export const notifyMutation = (opts) => notificationRealtime.notifyMutation(opts);
