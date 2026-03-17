// modules/features/reminders.js
// Reminder management: list, filters, modal.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards } from '../utils/helpers.js';

async function renderRemindersView() {
  let reminders;
  let error;

  if (state.isManager) {
    const result = await supabaseClient
      .from('reminders')
      .select(`
        *,
        assigned_to_profile:profiles!reminders_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!reminders_created_by_fkey(first_name, last_name, email)
      `)
      .eq('created_by', state.currentUser.id)
      .order('reminder_date', { ascending: true });

    reminders = result.data;
    error = result.error;
  } else {
    const result = await supabaseClient
      .from('reminders')
      .select(`
        *,
        assigned_to_profile:profiles!reminders_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!reminders_created_by_fkey(first_name, last_name, email)
      `)
      .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`)
      .order('reminder_date', { ascending: true });

    reminders = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let salesReps = [];
  if (state.isManager) {
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').eq('role', 'sales_rep').order('first_name', { ascending: true });
    if (state.currentOrganization?.id) repsQ = repsQ.eq('organization_id', state.currentOrganization.id);
    const { data: reps } = await repsQ;
    salesReps = reps || [];
  }

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endToday = new Date(startToday);
  endToday.setDate(endToday.getDate() + 1);

  const remindersSorted = [...(reminders || [])].sort((a, b) => {
    const aTs = a.reminder_date ? new Date(a.reminder_date).getTime() : Number.MAX_SAFE_INTEGER;
    const bTs = b.reminder_date ? new Date(b.reminder_date).getTime() : Number.MAX_SAFE_INTEGER;
    return aTs - bTs;
  });

  const totalReminders = remindersSorted.length;
  const pendingReminders = remindersSorted.filter(item => !item.is_completed).length;
  const completedReminders = remindersSorted.filter(item => item.is_completed).length;
  const todayReminders = remindersSorted.filter(item => !item.is_completed && item.reminder_date && new Date(item.reminder_date) >= startToday && new Date(item.reminder_date) < endToday).length;
  const overdueReminders = remindersSorted.filter(item => !item.is_completed && item.reminder_date && new Date(item.reminder_date) < now).length;
  const dueNow = remindersSorted.filter(item => !item.is_completed && item.reminder_date && new Date(item.reminder_date) <= now);

  const formatReminderDue = (isoDate) => {
    if (!isoDate) return 'No due date';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const cardsMarkup = remindersSorted.map(reminder => {
    const dueDate = reminder.reminder_date ? new Date(reminder.reminder_date) : null;
    const dueTs = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.getTime() : 0;
    const isOverdue = !reminder.is_completed && dueTs > 0 && dueTs < now.getTime();
    const isToday = !reminder.is_completed && dueTs >= startToday.getTime() && dueTs < endToday.getTime();
    const isAssignedToMe = reminder.assigned_to === state.currentUser.id;
    const isCreatedByMe = reminder.created_by === state.currentUser.id;
    const canComplete = isAssignedToMe;
    // Sales reps cannot edit or delete a reminder they didn't create (e.g. assigned by a manager)
    const canEdit = isCreatedByMe;
    const canDelete = isCreatedByMe;

    const assignedToText = reminder.assigned_to_profile
      ? `${reminder.assigned_to_profile.first_name} ${reminder.assigned_to_profile.last_name}`
      : 'Unassigned';

    const assignedByText = reminder.created_by_profile
      ? `${reminder.created_by_profile.first_name} ${reminder.created_by_profile.last_name}`
      : 'Unknown';

    let statusLabel = 'Pending';
    let statusClass = 'pending';
    if (reminder.is_completed) { statusLabel = 'Done'; statusClass = 'done'; }
    else if (isOverdue) { statusLabel = 'Overdue'; statusClass = 'overdue'; }
    else if (isToday) { statusLabel = 'Due Today'; statusClass = 'today'; }
    const cardStateClass = reminder.is_completed ? 'is-done is-completed' : isOverdue ? 'is-overdue' : isToday ? 'is-today' : '';

    return `
      <article class="rem-card reminder-card ${cardStateClass}"
               data-id="${reminder.id}"
               data-completed="${reminder.is_completed}"
               data-reminder-date="${reminder.reminder_date || ''}"
               data-due-ts="${dueTs}"
               data-created-by="${reminder.created_by || ''}">
        <div class="rem-card-stripe"></div>
        <div class="rem-card-inner">
          <div class="rem-card-top">
            <span class="rem-badge ${statusClass}">${statusLabel}</span>
            <div class="rem-card-actions">
              ${canEdit ? `<button class="rem-action-btn edit-reminder" data-id="${reminder.id}" title="Edit"><i data-lucide="pencil"></i></button>` : ''}
              ${canDelete ? `<button class="rem-action-btn delete-reminder" data-id="${reminder.id}" title="Delete"><i data-lucide="trash-2"></i></button>` : ''}
            </div>
          </div>
          <h4 class="rem-card-title reminder-title">${reminder.title}</h4>
          ${reminder.description ? `<p class="rem-card-desc reminder-description">${reminder.description}</p>` : ''}
          <div class="rem-card-foot">
            <span class="rem-card-meta"><i data-lucide="clock-3" class="rem-meta-icon"></i>${formatReminderDue(reminder.reminder_date)}</span>
            ${state.isManager
              ? `<span class="rem-card-meta"><i data-lucide="user" class="rem-meta-icon"></i>${assignedToText}</span>`
              : `<span class="rem-card-meta"><i data-lucide="users" class="rem-meta-icon"></i>By ${assignedByText}</span>`}
            ${canComplete && !reminder.is_completed ? `<button class="rem-action-btn complete-reminder is-lg" data-id="${reminder.id}" title="Mark as done"><i data-lucide="check"></i></button>` : ''}
          </div>
        </div>
      </article>
    `;
  }).join('');

  const dueNowMarkup = dueNow.slice(0, 6).map(reminder => {
    const dueText = formatReminderDue(reminder.reminder_date);
    const canComplete = reminder.assigned_to === state.currentUser.id;
    return `
      <div class="rem-sidebar-item">
        <div class="rem-sidebar-item-body">
          <div class="rem-sidebar-item-title">${reminder.title}</div>
          <div class="rem-sidebar-item-time"><i data-lucide="clock-3" class="rem-meta-icon"></i>${dueText}</div>
        </div>
        ${canComplete ? `<button class="rem-action-btn complete-reminder is-small" data-id="${reminder.id}" title="Mark as done"><i data-lucide="check"></i></button>` : ''}
      </div>
    `;
  }).join('');

  viewContainer.innerHTML = `
    <div class="rem-page">

      <div class="rem-page-head">
        <button class="btn btn-primary" id="add-reminder-btn"><i data-lucide="plus" class="u-icon-16"></i> New Reminder</button>
      </div>



      <div class="rem-body">
        <aside class="rem-sidebar">
          <div class="rem-sidebar-panel">
            <div class="rem-sidebar-head">
              <span class="rem-sidebar-title">Up Next</span>
              <span class="rem-sidebar-badge">${dueNow.length}</span>
            </div>
            ${dueNow.length === 0
              ? '<p class="rem-sidebar-empty">All caught up — nothing is due right now.</p>'
              : `<div class="rem-sidebar-list">${dueNowMarkup}</div>`}
          </div>
        </aside>

        <div class="rem-main">
          <div class="rem-toolbar">
            <div class="rem-filters">
              <button class="reminder-filter active" data-filter="all">All</button>
              <button class="reminder-filter" data-filter="pending">Pending</button>
              <button class="reminder-filter" data-filter="today">Today</button>
              <button class="reminder-filter" data-filter="overdue">Overdue</button>
              <button class="reminder-filter" data-filter="completed">Done</button>
              ${state.isManager ? '<button class="reminder-filter" data-filter="assigned">Assigned by Me</button>' : ''}
            </div>
            <div class="rem-search-wrap">
              <i data-lucide="search" class="rem-search-icon"></i>
              <input type="text" id="reminder-search" class="rem-search-input" placeholder="Search reminders...">
            </div>
          </div>

          <div id="remx-filter-empty" class="rem-empty-msg" style="display:none;">No reminders match this filter or search.</div>

          <div id="reminders-container" class="rem-list">
            ${totalReminders === 0 ? `
              <div class="empty-state reminder-empty-state">
                <h3 class="empty-state-title">No reminders yet</h3>
                <p class="empty-state-description">Create your first reminder with a due date to start tracking follow-ups.</p>
                <button class="btn btn-primary" onclick="openReminderModal()"><i data-lucide="plus"></i> Add Reminder</button>
              </div>
            ` : cardsMarkup}
          </div>
        </div>
      </div>

    </div>
  `;

  window.salesRepsData = salesReps;

  document.getElementById('add-reminder-btn')?.addEventListener('click', () => {
    openReminderModal(null, salesReps);
  });

  initReminderActionButtons(reminders, salesReps);
  initReminderFilters(reminders);

  if (window.lucide) lucide.createIcons();
}

function initReminderFilters(reminders) {
  const filterButtons = document.querySelectorAll('.reminder-filter');
  const searchInput = document.getElementById('reminder-search');
  const cards = document.querySelectorAll('.reminder-card');
  const emptyState = document.getElementById('remx-filter-empty');

  const applyFilters = () => {
    const activeFilter = document.querySelector('.reminder-filter.active')?.dataset.filter || 'all';
    const query = (searchInput?.value || '').trim().toLowerCase();
    const now = Date.now();
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(startToday);
    endToday.setDate(endToday.getDate() + 1);

    let visibleCount = 0;

    cards.forEach(card => {
      const completed = card.dataset.completed === 'true';
      const dueTs = Number(card.dataset.dueTs || 0);
      const createdBy = card.dataset.createdBy || '';
      const contentText = (card.textContent || '').toLowerCase();

      let show = true;

      if (activeFilter === 'assigned') {
        show = createdBy === state.currentUser.id;
      } else if (activeFilter === 'today') {
        show = !completed && dueTs >= startToday.getTime() && dueTs < endToday.getTime();
      } else if (activeFilter === 'overdue') {
        show = !completed && dueTs > 0 && dueTs < now;
      } else if (activeFilter === 'completed') {
        show = completed;
      } else if (activeFilter === 'pending') {
        show = !completed;
      }

      if (show && query) {
        show = contentText.includes(query);
      }

      card.style.display = show ? 'block' : 'none';
      if (show) visibleCount++;
    });

    if (emptyState) {
      emptyState.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  };

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', applyFilters);

  applyFilters();
}

function initReminderActionButtons(reminders, salesReps) {
  // Edit reminder buttons
  document.querySelectorAll('.edit-reminder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;
      const reminder = reminders.find(r => r.id === reminderId);
      if (reminder) {
        openReminderModal(reminder, salesReps);
      }
    });
  });

  // Complete reminder buttons
  document.querySelectorAll('.complete-reminder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;

      const { error } = await supabaseClient
        .from('reminders')
        .update({ is_completed: true, updated_at: new Date().toISOString() })
        .eq('id', reminderId);

      if (error) {
        showToast('Error completing reminder: ' + error.message, 'error');
        return;
      }

      showToast('Reminder completed successfully', 'success');
      renderRemindersView();
    });
  });

  // Delete reminder buttons
  document.querySelectorAll('.delete-reminder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const reminderId = btn.dataset.id;

      const confirmed = await showConfirmDialog(
        'Delete Reminder',
        'Are you sure you want to delete this reminder?'
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('reminders')
        .delete()
        .eq('id', reminderId);

      if (error) {
        showToast('Error deleting reminder: ' + error.message, 'error');
        return;
      }

      showToast('Reminder deleted successfully', 'success');
      renderRemindersView();
    });
  });
}

function openReminderModal(reminder = null, salesReps = []) {
  const modal = document.getElementById('reminder-modal');
  const modalTitle = document.getElementById('reminder-modal-title');
  const saveBtn = document.getElementById('save-reminder-btn');
  const assignField = document.getElementById('reminder-assign-field');
  const assignSelect = document.getElementById('reminder-assign-to');

  // Reset form
  document.getElementById('reminder-title').value = '';
  document.getElementById('reminder-description').value = '';
  document.getElementById('reminder-date').value = '';

  // Populate sales reps dropdown for managers
  if (state.isManager && salesReps.length > 0) {
    assignField.style.display = 'block';
    assignSelect.innerHTML = '<option value="">Select a sales rep</option>';

    // Add option for self
    assignSelect.innerHTML += `<option value="${state.currentUser.id}">Me</option>`;

    // Add options for sales reps
    salesReps.forEach(rep => {
      assignSelect.innerHTML += `<option value="${rep.id}">${rep.first_name} ${rep.last_name}</option>`;
    });
  } else {
    assignField.style.display = 'none';
  }

  // Set modal title
  if (reminder) {
    modalTitle.innerHTML = 'Edit Reminder';

    // Fill form with reminder data
    document.getElementById('reminder-title').value = reminder.title || '';
    document.getElementById('reminder-description').value = reminder.description || '';

    // Fix for time display issue
    if (reminder.reminder_date) {
      const reminderDate = new Date(reminder.reminder_date);
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const year = reminderDate.getFullYear();
      const month = String(reminderDate.getMonth() + 1).padStart(2, '0');
      const day = String(reminderDate.getDate()).padStart(2, '0');
      const hours = String(reminderDate.getHours()).padStart(2, '0');
      const minutes = String(reminderDate.getMinutes()).padStart(2, '0');

      document.getElementById('reminder-date').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      document.getElementById('reminder-date').value = '';
    }

    if (state.isManager && reminder.assigned_to) {
      assignSelect.value = reminder.assigned_to;
    }
  } else {
    modalTitle.innerHTML = 'New Reminder';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initReminderModalListeners(reminder);
}

function initReminderModalListeners(reminder) {
  // Save reminder
  const saveBtn = document.getElementById('save-reminder-btn');

  saveBtn.onclick = async () => {
    const title = document.getElementById('reminder-title').value.trim();
    const description = document.getElementById('reminder-description').value.trim();
    const reminderDate = document.getElementById('reminder-date').value;

    // Get assigned to
    let assignedTo = null;
    if (state.isManager) {
      assignedTo = document.getElementById('reminder-assign-to').value || null;
    } else {
      // Non-managers can only create reminders for themselves
      assignedTo = state.currentUser.id;
    }

    // Validate
    if (!title || !reminderDate) {
      showToast('Please enter a title and reminder date', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const reminderData = {
        title,
        description: description || null,
        assigned_to: assignedTo,
        created_by: state.currentUser.id,
        reminder_date: new Date(reminderDate).toISOString(),
        is_completed: false,
        organization_id: state.currentOrganization?.id
      };

      let result;

      if (reminder) {
        // Update existing reminder
        result = await supabaseClient
          .from('reminders')
          .update(reminderData)
          .eq('id', reminder.id);
      } else {
        // Create new reminder
        result = await supabaseClient
          .from('reminders')
          .insert([reminderData]);
      }

      if (result.error) throw result.error;

      showToast(`Reminder ${reminder ? 'updated' : 'created'} successfully!`, 'success');
      closeModal('reminder-modal');
      renderRemindersView();
    } catch (error) {
      showToast(`Error ${reminder ? 'updating' : 'creating'} reminder: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Reminder';
    }
  };
}

// ======================
// EXPORT FUNCTIONALITY
// ======================

// openExportModal removed (export modal markup was deleted)



// ── Exports ────────────────────────────────────────────────────
export {
  renderRemindersView,
  initReminderFilters,
  initReminderActionButtons,
  openReminderModal,
  initReminderModalListeners,
};
