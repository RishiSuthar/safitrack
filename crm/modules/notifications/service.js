// modules/notifications/service.js
// Query aggregation, source normalization, deduplication, and notification dispatch pipeline.

import { state, supabaseClient } from '../state.js';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_URGENCIES,
  evaluateDueStatus,
  evaluateUrgency,
  formatDueLabel,
} from './types.js';
import { notificationStore } from './store.js';
import { showNotificationToast } from './toast.js';
import { sendBrowserNotification } from './browser.js';
import { playNotificationChime } from './sound.js';

const POLL_INTERVAL_MS = 2.5 * 60 * 1000; // 2.5 minutes
const MAX_ITEMS = 40;

class NotificationService {
  constructor() {
    this.pollTimer = null;
    this.knownItemIds = new Set();
    this.alertedItemIds = new Set();
    this.scheduledTimers = new Map();
    this.isFetching = false;
    this.hasInitialFetch = false;

    this._onVisibilityChange = this._onVisibilityChange.bind(this);
  }

  // ── Start / Stop ───────────────────────────────────────────────────────────

  start() {
    notificationStore.init();
    this.refresh();
    this._startPolling();
  }

  stop() {
    this._stopPolling();
    this.scheduledTimers.forEach((t) => clearTimeout(t));
    this.scheduledTimers.clear();
    this.knownItemIds.clear();
    this.alertedItemIds.clear();
    this.hasInitialFetch = false;
    notificationStore.reset();
  }

  _startPolling() {
    this._stopPolling();
    this.pollTimer = setInterval(() => {
      if (!document.hidden) {
        this.refresh();
      }
    }, POLL_INTERVAL_MS);

    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  _stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
  }

  _onVisibilityChange() {
    if (!document.hidden) {
      this.refresh();
    }
  }

  // ── Ingestion & Query Aggregator ───────────────────────────────────────────

  async refresh(options = {}) {
    if (!state.currentUser?.id || this.isFetching) return;
    this.isFetching = true;

    try {
      const items = await this._fetchAllSources();
      this._processIngestedItems(items, options);
    } catch (err) {
      console.error('[NotificationService] Ingestion failed:', err);
    } finally {
      this.isFetching = false;
    }
  }

  async _fetchAllSources() {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 1);
    const horizonIso = horizon.toISOString();
    const horizonDate = horizonIso.split('T')[0];
    const orgId = state.currentOrganization?.id;
    const userId = state.currentUser.id;

    // 1. Tasks
    let tasksQ = supabaseClient
      .from('tasks')
      .select('id, title, due_date, status, assigned_to, created_by, priority')
      .not('due_date', 'is', null)
      .neq('status', 'completed')
      .lte('due_date', horizonIso)
      .or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
    if (orgId) tasksQ = tasksQ.eq('organization_id', orgId);

    // 2. Reminders
    let remindersQ = supabaseClient
      .from('reminders')
      .select('id, title, reminder_date, is_completed, assigned_to, created_by')
      .not('reminder_date', 'is', null)
      .neq('is_completed', true)
      .lte('reminder_date', horizonIso)
      .or(`assigned_to.eq.${userId},created_by.eq.${userId}`);
    if (orgId) remindersQ = remindersQ.eq('organization_id', orgId);

    // 3. Opportunities
    let oppsQ = supabaseClient
      .from('opportunities')
      .select('id, name, company_name, next_step, next_step_date, stage, user_id, value')
      .not('next_step_date', 'is', null)
      .lte('next_step_date', horizonDate)
      .neq('stage', 'closed-won')
      .neq('stage', 'closed-lost');
    if (!state.isManager) oppsQ = oppsQ.eq('user_id', userId);
    if (orgId) oppsQ = oppsQ.eq('organization_id', orgId);

    // 4. Service Contracts
    let contractsQ = supabaseClient
      .from('service_contracts')
      .select(
        'id, company_id, custom_company_name, contract_type, custom_type_name, start_date, recurrence_type, recurrence_interval, reminder_days, status, companies(name)'
      )
      .eq('status', 'active')
      .neq('reminder_days', '{}');
    if (orgId) contractsQ = contractsQ.eq('organization_id', orgId);

    const [tasksRes, remindersRes, oppsRes, contractsRes] = await Promise.all([
      tasksQ,
      remindersQ,
      oppsQ,
      contractsQ,
    ]);

    const mappedTasks = (tasksRes.data || []).map((t) => this._mapTask(t)).filter(Boolean);
    const mappedReminders = (remindersRes.data || []).map((r) => this._mapReminder(r)).filter(Boolean);
    const mappedOpps = (oppsRes.data || []).map((o) => this._mapOpportunity(o)).filter(Boolean);
    const mappedContracts = (contractsRes.data || []).map((c) => this._mapContract(c)).filter(Boolean);

    // Combine and limit
    return [...mappedTasks, ...mappedReminders, ...mappedOpps, ...mappedContracts].slice(0, MAX_ITEMS);
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  _mapTask(task) {
    const dueAt = task.due_date ? new Date(task.due_date) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
    const status = evaluateDueStatus(dueAt);
    const urgency = evaluateUrgency(status, NOTIFICATION_CATEGORIES.TASK);

    return {
      id: `task:${task.id}`,
      entityType: NOTIFICATION_CATEGORIES.TASK,
      entityId: String(task.id),
      title: task.title || 'Task due',
      message: `Due ${formatDueLabel(dueAt)}`,
      timestamp: dueAt.getTime(),
      dueAt,
      status,
      urgency,
      view: 'tasks',
      actionPayload: {
        type: 'task',
        id: task.id,
      },
    };
  }

  _mapReminder(reminder) {
    const dueAt = reminder.reminder_date ? new Date(reminder.reminder_date) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
    const status = evaluateDueStatus(dueAt);
    const urgency = evaluateUrgency(status, NOTIFICATION_CATEGORIES.REMINDER);

    return {
      id: `reminder:${reminder.id}`,
      entityType: NOTIFICATION_CATEGORIES.REMINDER,
      entityId: String(reminder.id),
      title: reminder.title || 'Reminder',
      message: `Scheduled for ${formatDueLabel(dueAt)}`,
      timestamp: dueAt.getTime(),
      dueAt,
      status,
      urgency,
      view: 'reminders',
      actionPayload: {
        type: 'reminder',
        id: reminder.id,
      },
    };
  }

  _mapOpportunity(opp) {
    const dueAt = opp.next_step_date ? new Date(opp.next_step_date) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) return null;
    const status = evaluateDueStatus(dueAt);
    const urgency = evaluateUrgency(status, NOTIFICATION_CATEGORIES.DEAL);
    const company = opp.company_name || opp.name || 'Deal';
    const nextStep = opp.next_step || 'Next action due';

    return {
      id: `deal:${opp.id}`,
      entityType: NOTIFICATION_CATEGORIES.DEAL,
      entityId: String(opp.id),
      title: company,
      message: `${nextStep} — due ${formatDueLabel(dueAt)}`,
      timestamp: dueAt.getTime(),
      dueAt,
      status,
      urgency,
      view: 'opportunity-pipeline',
      actionPayload: {
        type: 'opportunity',
        id: opp.id,
      },
    };
  }

  _computeNextContractDate(startDateStr, recurrenceType, recurrenceInterval) {
    const start = new Date(startDateStr);
    if (Number.isNaN(start.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (recurrenceType === 'once') return start >= today ? start : null;
    const interval = recurrenceInterval || 1;
    let next = new Date(start);
    let guard = 0;

    while (next < today && guard++ < 1000) {
      switch (recurrenceType) {
        case 'weekly':
          next.setDate(next.getDate() + 7);
          break;
        case 'bi_weekly':
          next.setDate(next.getDate() + 14);
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          break;
        case 'quarterly':
          next.setMonth(next.getMonth() + 3);
          break;
        case 'semi_annual':
          next.setMonth(next.getMonth() + 6);
          break;
        case 'yearly':
          next.setFullYear(next.getFullYear() + 1);
          break;
        case 'custom_weeks':
          next.setDate(next.getDate() + interval * 7);
          break;
        default:
          return null;
      }
    }
    return next >= today ? next : null;
  }

  _mapContract(contract) {
    if (contract.status !== 'active') return null;
    if (!contract.reminder_days?.length) return null;

    const nextDue = this._computeNextContractDate(
      contract.start_date,
      contract.recurrence_type,
      contract.recurrence_interval
    );
    if (!nextDue) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((nextDue.getTime() - today.getTime()) / 86400000);
    const shouldNotify = contract.reminder_days.some((d) => daysUntil <= d && daysUntil >= 0);
    if (!shouldNotify) return null;

    const companyName = contract.companies?.name || contract.custom_company_name || 'Contract';
    const typeLabel =
      contract.contract_type === 'ups_service'
        ? 'UPS Service'
        : contract.contract_type === 'solar_service'
        ? 'Solar Service'
        : contract.custom_type_name || 'Service';

    const status = evaluateDueStatus(nextDue);
    const urgency = evaluateUrgency(status, NOTIFICATION_CATEGORIES.CONTRACT);

    return {
      id: `contract:${contract.id}:${nextDue.toISOString().split('T')[0]}`,
      entityType: NOTIFICATION_CATEGORIES.CONTRACT,
      entityId: String(contract.id),
      title: companyName,
      message: `${typeLabel} due ${nextDue.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
      timestamp: nextDue.getTime(),
      dueAt: nextDue,
      status,
      urgency,
      view: 'contracts',
      actionPayload: {
        type: 'contract',
        id: contract.id,
      },
    };
  }

  // ── Ingestion Pipeline & Dispatch ──────────────────────────────────────────

  _processIngestedItems(items, options = {}) {
    // Retain manually added items like active Nudges or System announcements
    const currentNudgesAndSystem = notificationStore.items.filter(
      (i) => i.entityType === NOTIFICATION_CATEGORIES.NUDGE || i.entityType === NOTIFICATION_CATEGORIES.SYSTEM
    );

    const merged = [...items, ...currentNudgesAndSystem];

    // Detect new items
    const isFirstRun = !this.hasInitialFetch;
    this.hasInitialFetch = true;

    merged.forEach((item) => {
      this.knownItemIds.add(item.id);
    });

    notificationStore.setItems(merged);

    const now = Date.now();

    // Check alarms & scheduled triggers
    merged.forEach((item) => {
      const dueTs = item.dueAt ? item.dueAt.getTime() : null;

      if (dueTs) {
        if (dueTs > now) {
          // Future due date: schedule timer to fire at the exact due time (DO NOT alert now!)
          this._scheduleDueAlarm(item);
        } else if (!isFirstRun && !item.isRead && !this.alertedItemIds.has(item.id)) {
          // It is due now or became due recently (within last 15 minutes)
          const isRecentDue = (now - dueTs) < 15 * 60 * 1000;
          if (isRecentDue) {
            this._dispatchAlert(item);
          } else {
            // Older overdue backlog items: suppress popup alerts on sync
            this.alertedItemIds.add(item.id);
          }
        }
      }
    });

    if (options.forceToast) {
      const urgentItems = merged.filter((i) => !i.isRead && i.urgency === NOTIFICATION_URGENCIES.URGENT);
      if (urgentItems.length > 0) {
        showNotificationToast(urgentItems[0]);
      }
    }
  }

  _scheduleDueAlarm(item) {
    if (!item.dueAt || this.scheduledTimers.has(item.id) || this.alertedItemIds.has(item.id)) return;
    const now = Date.now();
    const delayMs = item.dueAt.getTime() - now;

    // Schedule within next 24 hours
    if (delayMs > 0 && delayMs <= 24 * 60 * 60 * 1000) {
      const timer = setTimeout(() => {
        this.scheduledTimers.delete(item.id);
        const current = notificationStore.items.find((i) => i.id === item.id);
        if (current && !current.isRead && !this.alertedItemIds.has(current.id)) {
          notificationStore.setItems([...notificationStore.items]);
          this._dispatchAlert(current);
        }
      }, delayMs);
      this.scheduledTimers.set(item.id, timer);
    }
  }

  _dispatchAlert(item) {
    if (this.alertedItemIds.has(item.id)) return;
    this.alertedItemIds.add(item.id);

    showNotificationToast(item);
    if (notificationStore.preferences.browserPushEnabled) {
      sendBrowserNotification(item);
    }
    if (notificationStore.preferences.soundEnabled) {
      playNotificationChime(item.urgency === 'urgent' ? 'urgent' : 'subtle');
    }
  }

  // ── Ingest Teammate Nudges ─────────────────────────────────────────────────

  addNudgeNotification(payload) {
    if (!payload) return;
    const fromName = payload.fromName || 'Teammate';
    const message = payload.message || 'Sent you a SafiNudge ✨';
    const nudgeId = `nudge:${payload.fromUserId || Date.now()}:${Date.now()}`;

    const item = {
      id: nudgeId,
      entityType: NOTIFICATION_CATEGORIES.NUDGE,
      entityId: String(payload.fromUserId || 'nudge'),
      title: `Nudge from ${fromName}`,
      message,
      timestamp: Date.now(),
      dueAt: null,
      status: NOTIFICATION_STATUSES.ACTIVE,
      urgency: NOTIFICATION_URGENCIES.HIGH,
      view: 'team-dashboard',
      actionPayload: {
        type: 'nudge',
        payload,
      },
    };

    this.knownItemIds.add(item.id);
    notificationStore.setItems([item, ...notificationStore.items]);

    // Present toast & chime
    showNotificationToast(item);
    if (notificationStore.preferences.soundEnabled) {
      playNotificationChime('subtle');
    }
    if (notificationStore.preferences.browserPushEnabled) {
      sendBrowserNotification(item);
    }
  }
}

export const notificationService = new NotificationService();
