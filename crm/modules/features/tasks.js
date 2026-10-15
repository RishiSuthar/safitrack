// modules/features/tasks.js
// Task management: kanban + list views, modals.
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getLeadScoreBadge } from '../utils/helpers.js';
import { fetchAllPages } from '../utils/analytics.js';
import { isPastDue, daysUntilDue, formatDue, dueDay, dueFieldsFromPicker, duePickerValue } from '../utils/due-dates.js';

function renderKanbanEmptyState(status, isVisible = true) {
  let iconSvg, text, subtext;
  if (status === 'pending' || status === 'todo') {
    iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
    text = 'No tasks to do';
    subtext = 'Drag tasks here or click + to add';
  } else if (status === 'in_progress') {
    iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
    text = 'Nothing in progress';
    subtext = 'Active work lands here';
  } else {
    iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    text = 'No completed tasks';
    subtext = 'Finished tasks appear here';
  }

  return `
    <div class="kanban-empty-state" style="display: ${isVisible ? 'flex' : 'none'};">
      <div class="kanban-empty-icon">${iconSvg}</div>
      <div class="kanban-empty-text">${text}</div>
      <div class="kanban-empty-subtext">${subtext}</div>
    </div>`;
}

async function renderTasksView() {
  // Fetch tasks based on user role
  let tasks;
  let error;

  if (state.isManager) {
    let tasksQ = supabaseClient
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email),
        opportunity:opportunities!tasks_opportunity_id_fkey(id, name, company_name, stage)
      `)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) tasksQ = tasksQ.eq('organization_id', state.currentOrganization.id);
    const result = await fetchAllPages(tasksQ);
    tasks = result.data;
    error = result.error;
  } else {
    let tasksQ = supabaseClient
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email),
        opportunity:opportunities!tasks_opportunity_id_fkey(id, name, company_name, stage)
      `)
      .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) tasksQ = tasksQ.eq('organization_id', state.currentOrganization.id);
    const result = await fetchAllPages(tasksQ);
    tasks = result.data;
    error = result.error;
  }

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Store tasks globally for edit/delete access
  window.allTasksData = tasks;

  // Fetch sales reps for assignment dropdown (managers only)
  let salesReps = [];
  if (state.isManager) {
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').order('first_name', { ascending: true });
    if (state.currentOrganization?.id) repsQ = repsQ.eq('organization_id', state.currentOrganization.id);
    const { data: reps } = await repsQ;
    salesReps = reps || [];
  }
  // Store globally for editTask access
  window.salesRepsData = salesReps;

  // Group tasks by status
  const todoTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const doneTasks = tasks.filter(t => t.status === 'completed');

  let html = `
    <div class="crm-page-shell tasks-page-shell">
      <div class="tasks-toolbar-wrapper">
        <div class="tasks-toolbar-left">
          <div class="tasks-search-bar">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <input type="text" id="task-search-input" placeholder="Search tasks...">
          </div>

          <div class="tasks-priority-segmented">
            <button class="tasks-segmented-btn active" data-task-filter-priority="all">All</button>
            <button class="tasks-segmented-btn" data-task-filter-priority="high">
              <span class="task-status-dot dot-high"></span> High
            </button>
            <button class="tasks-segmented-btn" data-task-filter-priority="medium">
              <span class="task-status-dot dot-medium"></span> Medium
            </button>
            <button class="tasks-segmented-btn" data-task-filter-priority="low">
              <span class="task-status-dot dot-low"></span> Low
            </button>
          </div>
        </div>

        <div class="tasks-toolbar-right">
          <div class="tasks-date-range">
            <span class="tasks-date-range-label">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              Due:
            </span>
            <input type="date" class="crm-date-input" id="task-filter-date-from" placeholder="From">
            <span class="tasks-date-range-sep">to</span>
            <input type="date" class="crm-date-input" id="task-filter-date-to" placeholder="To">
            <button class="crm-filter-clear" id="task-date-clear" style="display:none;">✕ Clear</button>
          </div>

          ${state.isManager ? `
            <div class="crm-dd crm-dd--filter crm-dd--right tasks-assignee-dd" data-dd-id="task-filter-assignee">
              <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <span class="crm-dd-label">All Assignees</span>
                <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
              </button>
              <div class="crm-dd-panel" role="listbox">
                <ul class="crm-dd-list">
                  <li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="all" data-label="All Assignees" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>All Assignees</li>
                  <li class="crm-dd-option" role="option" data-value="${state.currentUser.id}" data-label="Me" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Me</li>
                  ${salesReps.map(rep => `<li class="crm-dd-option" role="option" data-value="${rep.id}" data-label="${escapeHtml(rep.first_name + ' ' + rep.last_name)}" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${escapeHtml(rep.first_name + ' ' + rep.last_name)}</li>`).join('')}
                </ul>
              </div>
              <input class="crm-dd-value-input" type="hidden" id="task-filter-assignee" value="all">
            </div>
          ` : ''}

          <button class="crm-filter-clear" id="task-filter-clear" style="display:none;">✕ Clear</button>

          <button class="btn btn-primary pipeline-add-btn tasks-add-btn" id="add-task-btn">
            <i data-lucide="plus" class="u-icon-16"></i> New Task
          </button>
        </div>
      </div>

      <div class="tasks-kanban-container">
        <!-- To Do Column -->
        <div class="kanban-column" data-status="pending">
          <div class="kanban-column-header">
            <div class="kanban-column-title">
              <span class="kanban-stage-dot stage-pending"></span>
              <span>To Do</span>
              <span class="kanban-column-count">${todoTasks.length}</span>
            </div>
            <button class="kanban-add-btn" data-status="pending" title="Add task to To Do">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="kanban-cards-container" id="kanban-todo">
            ${todoTasks.map(task => renderKanbanTaskCard(task, state.isManager)).join('')}
            ${renderKanbanEmptyState('pending', todoTasks.length === 0)}
          </div>
        </div>

        <!-- In Progress Column -->
        <div class="kanban-column" data-status="in_progress">
          <div class="kanban-column-header">
            <div class="kanban-column-title">
              <span class="kanban-stage-dot stage-in_progress"></span>
              <span>In Progress</span>
              <span class="kanban-column-count">${inProgressTasks.length}</span>
            </div>
            <button class="kanban-add-btn" data-status="in_progress" title="Add task to In Progress">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="kanban-cards-container" id="kanban-in-progress">
            ${inProgressTasks.map(task => renderKanbanTaskCard(task, state.isManager)).join('')}
            ${renderKanbanEmptyState('in_progress', inProgressTasks.length === 0)}
          </div>
        </div>

        <!-- Done Column -->
        <div class="kanban-column" data-status="completed">
          <div class="kanban-column-header">
            <div class="kanban-column-title">
              <span class="kanban-stage-dot stage-completed"></span>
              <span>Done</span>
              <span class="kanban-column-count">${doneTasks.length}</span>
            </div>
            <button class="kanban-add-btn" data-status="completed" title="Add task to Done">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>
          <div class="kanban-cards-container" id="kanban-completed">
            ${doneTasks.map(task => renderKanbanTaskCard(task, state.isManager)).join('')}
            ${renderKanbanEmptyState('completed', doneTasks.length === 0)}
          </div>
        </div>
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  if (window.lucide) {
    lucide.createIcons();
  }

  // Initialize functionality
  initKanbanBoard(tasks, salesReps);
  updateColumnCounts();

  // Common listeners setup (Search, Add Task)
  // ... (Listeners are set up below in existing code)
}

function renderKanbanTaskCard(task, isManager) {
  // A date with no time is due all day, so it isn't overdue until the day ends
  const isOverdue = task.due_date && isPastDue(task.due_date, task.due_all_day) && task.status !== 'completed';

  // Robust Assignee Logic
  let assigneeHtml = '<span class="task-card-unassigned">Unassigned</span>';
  let assigneeName = 'Unassigned';

  if (task.assigned_to_profile) {
    assigneeName = `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`;
    const initials = (task.assigned_to_profile.first_name?.[0] || '') + (task.assigned_to_profile.last_name?.[0] || '');
    assigneeHtml = `
      <div class="task-card-assignee" title="${escapeHtml(assigneeName)}">
        ${escapeHtml(initials)}
      </div>
      <span class="task-card-assignee-name">${escapeHtml(task.assigned_to_profile.first_name)}</span>
    `;
  } else if (task.assigned_to === state.currentUser.id) {
    assigneeName = 'Me';
    assigneeHtml = `
      <div class="task-card-assignee is-me" title="Assigned to Me">
        Me
      </div>
      <span class="task-card-assignee-name">Me</span>
    `;
  }

  const priorityClass = task.priority || 'medium';
  const priorityLabel = priorityClass.charAt(0).toUpperCase() + priorityClass.slice(1);

  return `
    <div class="kanban-task-card priority-${priorityClass}" data-task-id="${task.id}" data-status="${task.status}">
      <div class="task-card-header">
        <div class="task-card-tags">
          <span class="task-tag priority-${priorityClass}">
            <span class="task-status-dot dot-${priorityClass}"></span>
            ${priorityLabel}
          </span>
        </div>
      </div>
      <div class="task-card-title">${escapeHtml(task.title)}</div>
      ${task.opportunity ? `
        <div class="task-card-deal" title="From the deal ${escapeHtml(task.opportunity.name || '')}">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.1 0 2.9 6 1.5 6 4.3 0 1.2-1.3 2.1-3 2.1-1.4 0-2.6-.6-3-1.6M12 6.5v1.5M12 16v1.5"/></svg>
          <span>${escapeHtml(task.opportunity.name || 'Deal')}</span>
        </div>
      ` : ''}
      ${task.description && !DEAL_DESCRIPTION.test(task.description) ? `
        <div class="task-card-description">${escapeHtml(task.description)}</div>
      ` : ''}
      <div class="task-card-footer">
        <div class="task-card-due-date ${isOverdue ? 'overdue' : (!task.due_date ? 'no-date' : '')}">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <span>${task.due_date ? escapeHtml(formatDue(task.due_date, task.due_all_day)) : 'No due date'}</span>
          ${isOverdue ? '<span class="task-overdue-badge">Overdue</span>' : ''}
        </div>
        <div class="task-card-meta">
          <div class="task-card-assignee-wrapper" title="${escapeHtml(assigneeName)}">
            ${assigneeHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function initKanbanBoard(tasks, salesReps) {
  // Initialize drag-and-drop for each column
  const columns = ['todo', 'in-progress', 'completed'];
  const statusMap = {
    'todo': 'pending',
    'in-progress': 'in_progress',
    'completed': 'completed'
  };

  columns.forEach(columnId => {
    const container = document.getElementById(`kanban-${columnId}`);
    if (!container) return;

    new Sortable(container, {
      group: 'kanban',
      draggable: '.kanban-task-card',
      filter: '.kanban-empty-state',
      preventOnFilter: false,
      animation: 120,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onStart: function () {
        document.body.classList.add('is-dragging');
      },
      onAdd: function () {
        updateColumnCounts();
      },
      onRemove: function () {
        updateColumnCounts();
      },
      onEnd: async function (evt) {
        document.body.classList.remove('is-dragging');
        const taskId = evt.item.dataset.taskId;
        const newStatus = statusMap[evt.to.id.replace('kanban-', '')];
        const oldStatus = evt.item.dataset.status;

        if (newStatus && newStatus !== oldStatus) {
          // Update task status in database
          const { error } = await supabaseClient
            .from('tasks')
            .update({ status: newStatus })
            .eq('id', taskId);

          if (error) {
            showToast('Error updating task status', 'error');
            // Revert will be tricky without reload, so we reload
            renderTasksView();
          } else {
            // Update local data immediate to prevent stale state issues
            if (window.allTasksData) {
              const taskIndex = window.allTasksData.findIndex(t => t.id === taskId);
              if (taskIndex !== -1) {
                window.allTasksData[taskIndex].status = newStatus;
              }
            }

            // Update DOM attributes
            evt.item.dataset.status = newStatus;
            showInlineSuccess(evt.item);
            const movedTask = window.allTasksData?.find(t => t.id === taskId);
            if (movedTask?.opportunity_id) window.refreshDealNextStep?.(movedTask.opportunity_id);
            document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: newStatus === 'completed' ? 'complete' : 'update', id: taskId } }));

            // If the card has a status badge/text that needs updating, we can do it here
            // But currently the column implies status. 
            // We might want to update the "detail view" if it's open, but it shouldn't be open during drag.
          }
        }
      }
    });
  });

  // Column add buttons
  document.querySelectorAll('.kanban-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      openTaskModal(null, salesReps, status);
    });
  });

  // Task card click to view details
  document.querySelectorAll('.kanban-task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't trigger if clicking menu button, though we hid it for now as per design tweak
      if (e.target.closest('.task-card-menu')) return;
      const taskId = card.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        showTaskDetail(task, salesReps);
      }
    });
  });

  // Header Search functionality
  const searchInput = document.getElementById('task-search-input');
  if (searchInput) {
    // Restore saved search
    const persistedSearch = _loadPersistedState().tasks?.search || '';
    if (persistedSearch) {
      searchInput.value = persistedSearch;
      // Trigger initial filter
      setTimeout(() => searchInput.dispatchEvent(new Event('input')), 50);
    }

    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase();
      saveViewState({ tasks: { search: query } });
      applyTaskFilters();
    });
  }

  // Header Add Task button
  const addTaskBtn = document.getElementById('add-task-btn');
  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', () => {
      openTaskModal(null, salesReps);
    });
  }



  // Initialize CustomCalendar on date inputs
  if (window.initCustomCalendar) {
    window.initCustomCalendar('#task-filter-date-from', { type: 'date' });
    window.initCustomCalendar('#task-filter-date-to', { type: 'date' });
  }

  // Task filter logic
  const applyTaskFilters = () => {
    const priorityBtn = document.querySelector('[data-task-filter-priority].active');
    const activePriority = priorityBtn?.dataset.taskFilterPriority || 'all';
    const dateFrom = document.getElementById('task-filter-date-from')?.value || '';
    const dateTo = document.getElementById('task-filter-date-to')?.value || '';
    const assignee = document.getElementById('task-filter-assignee')?.value || 'all';
    const query = (document.getElementById('task-search-input')?.value || '').toLowerCase();
    const clearBtn = document.getElementById('task-filter-clear');

    const hasFilters = activePriority !== 'all' || dateFrom || dateTo || assignee !== 'all';
    if (clearBtn) clearBtn.style.display = hasFilters ? 'inline-flex' : 'none';

    const dateClearBtn = document.getElementById('task-date-clear');
    if (dateClearBtn) dateClearBtn.style.display = (dateFrom || dateTo) ? 'inline-flex' : 'none';

    document.querySelectorAll('.kanban-task-card').forEach(card => {
      const taskId = card.dataset.taskId;
      const task = tasks.find(t => t.id === taskId);
      if (!task) { card.style.display = 'none'; return; }

      let show = true;

      // Priority filter
      if (activePriority !== 'all' && task.priority !== activePriority) show = false;

      // Date range filter, by due day ("2026-10-20" strings compare in date order)
      if (show && (dateFrom || dateTo) && task.due_date) {
        const day = dueDay(task.due_date, task.due_all_day);
        if (dateFrom && day < dateFrom) show = false;
        if (dateTo && day > dateTo) show = false;
      } else if (show && (dateFrom || dateTo) && !task.due_date) {
        show = false; // no due date, but date filter is active
      }

      // Assignee filter
      if (show && assignee !== 'all' && task.assigned_to !== assignee) show = false;

      // Search filter
      if (show && query) {
        const title = (task.title || '').toLowerCase();
        const description = (task.description || '').toLowerCase();
        show = title.includes(query) || description.includes(query);
      }

      card.style.display = show ? '' : 'none';
    });

    updateColumnCounts();
  };

  // Priority pill clicks
  document.querySelectorAll('[data-task-filter-priority]').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('[data-task-filter-priority]').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      applyTaskFilters();
    });
  });

  // Date filter changes
  document.getElementById('task-filter-date-from')?.addEventListener('change', applyTaskFilters);
  document.getElementById('task-filter-date-to')?.addEventListener('change', applyTaskFilters);
  document.getElementById('task-filter-assignee')?.addEventListener('change', applyTaskFilters);

  // Clear filters
  document.getElementById('task-filter-clear')?.addEventListener('click', () => {
    document.querySelectorAll('[data-task-filter-priority]').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-task-filter-priority="all"]')?.classList.add('active');
    const dfrom = document.getElementById('task-filter-date-from');
    const dto = document.getElementById('task-filter-date-to');
    if (dfrom) dfrom.value = '';
    if (dto) dto.value = '';
    const assigneeEl = document.getElementById('task-filter-assignee');
    if (assigneeEl) {
      if (window.setCrmDropdownValue) {
        window.setCrmDropdownValue(assigneeEl, 'all');
      } else {
        assigneeEl.value = 'all';
      }
    }
    applyTaskFilters();
  });

  document.getElementById('task-date-clear')?.addEventListener('click', () => {
    const dfrom = document.getElementById('task-filter-date-from');
    const dto = document.getElementById('task-filter-date-to');
    if (dfrom) dfrom.value = '';
    if (dto) dto.value = '';
    applyTaskFilters();
  });
}

function updateColumnCounts() {
  const colConfigs = [
    { id: 'kanban-todo', status: 'pending' },
    { id: 'kanban-in-progress', status: 'in_progress' },
    { id: 'kanban-completed', status: 'completed' }
  ];

  let totalVisible = 0;
  const counts = {};

  colConfigs.forEach(({ id, status }) => {
    const container = document.getElementById(id);
    if (!container) return;

    const visibleCards = container.querySelectorAll('.kanban-task-card:not([style*="display: none"])');
    counts[status] = visibleCards.length;
    totalVisible += visibleCards.length;

    const countBadge = document.querySelector(`[data-status="${status}"] .kanban-column-count`);
    if (countBadge) countBadge.textContent = visibleCards.length;

    const emptyState = container.querySelector('.kanban-empty-state');
    if (emptyState) {
      emptyState.style.display = visibleCards.length === 0 ? 'flex' : 'none';
    }
  });

  // Header stats summary
  const statTotal = document.getElementById('task-stat-total');
  const statPending = document.getElementById('task-stat-pending');
  const statProgress = document.getElementById('task-stat-progress');
  const statDone = document.getElementById('task-stat-done');

  if (statTotal) statTotal.textContent = `${totalVisible} ${totalVisible === 1 ? 'task' : 'tasks'}`;
  if (statPending) statPending.textContent = `${counts.pending || 0} to do`;
  if (statProgress) statProgress.textContent = `${counts.in_progress || 0} in progress`;
  if (statDone) statDone.textContent = `${counts.completed || 0} done`;
}

// ── Task detail ───────────────────────────────────────────────────────────────
// The same quiet panel as a deal: title with a done checkbox, where the task
// came from (a deal, a workflow or a person), a property list that edits in
// place, then the description. The pencil still opens the full task form.

// The task on screen and listeners removed when another task opens
let taskDetail = null;

const TASK_STATUSES = [
  { value: 'pending', label: 'To Do', color: '#94a3b8' },
  { value: 'in_progress', label: 'In Progress', color: '#2f5fd0' },
  { value: 'completed', label: 'Done', color: '#16a34a' },
];

const TASK_PRIORITIES = [
  { value: 'high', label: 'High', color: '#dc2626' },
  { value: 'medium', label: 'Medium', color: '#d97706' },
  { value: 'low', label: 'Low', color: '#94a3b8' },
];

const tdIcon = (paths) => `<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const TD_ICONS = {
  status: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  priority: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.33 2q2 0 3.07-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.53"/>',
  due: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  assignee: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  deal: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.1 0 2.9 6 1.5 6 4.3 0 1.2-1.3 2.1-3 2.1-1.4 0-2.6-.6-3-1.6M12 6.5v1.5M12 16v1.5"/>',
  workflow: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  open: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

const WORKFLOW_DESCRIPTION = /^Auto-generated by workflow\. Trigger: (\w+) on (\w+)/;
// Deal tasks used to carry this generated line; the task now links to its deal instead
const DEAL_DESCRIPTION = /^Next step on the deal ".*"$/;

function tdFullName(profile) {
  return profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : '';
}

function tdColor(userId) {
  const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1'];
  let hash = 0;
  for (const ch of String(userId || '')) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

function tdPerson(userId, name) {
  return `<span class="od-person"><span class="od-person-avatar" style="background:${tdColor(userId)}">${escapeHtml(getInitials(name))}</span>${escapeHtml(name)}</span>`;
}

/** The task's due label, and whether it's overdue or due today (an all-day task is due all day) */
function describeDue(task, isDone) {
  const { due_date: value, due_all_day: allDay } = task;
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  let status = null;
  if (!isDone && isPastDue(value, allDay)) status = 'overdue';
  else if (!isDone && daysUntilDue(value, allDay) === 0) status = 'today';
  return { label: formatDue(value, allDay), status };
}

/** Everyone in the org, for the assignee picker (cached like the deal panel's) */
async function loadTaskTeam() {
  if (window._orgTeamMembers && window._orgTeamMembersOrgId === state.currentOrganization?.id) return window._orgTeamMembers;
  let q = supabaseClient.from('profiles').select('id, first_name, last_name, role, email, avatar_url').eq('status', 'active').order('first_name');
  if (state.currentOrganization?.id) q = q.eq('organization_id', state.currentOrganization.id);
  const { data } = await q;
  window._orgTeamMembers = data || [];
  window._orgTeamMembersOrgId = state.currentOrganization?.id;
  return window._orgTeamMembers;
}

function canEditTask(task) {
  return state.isManager || task.created_by === state.currentUser.id;
}

function canCompleteTask(task) {
  return canEditTask(task) || task.assigned_to === state.currentUser.id;
}

function showTaskDetail(task) {
  const modal = document.getElementById('task-detail-modal');
  const panel = document.getElementById('task-detail-content');
  if (!modal || !panel || !task) return;

  taskDetail?.listeners.abort();
  taskDetail = { task, listeners: new AbortController() };
  const { signal } = taskDetail.listeners;

  panel.addEventListener('click', onTaskDetailClick, { signal });
  panel.addEventListener('change', (e) => {
    if (e.target.id === 'td-status') saveTaskPatch({ status: e.target.value });
    if (e.target.id === 'td-priority') saveTaskPatch({ priority: e.target.value });
    if (e.target.id === 'td-assignee') saveTaskAssignee(e.target.value);
    if (e.target.id === 'td-due-input') {
      // "2026-10-20" (All day) or "2026-10-20T15:00"
      saveTaskPatch(dueFieldsFromPicker(e.target.value));
    }
  }, { signal });
  panel.addEventListener('keydown', (e) => {
    // The due date opens its picker from the keyboard too
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'td-due-input') {
      e.preventDefault();
      e.target._customCalendar?.open();
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.od-notes[data-edit]')) {
      e.preventDefault();
      startTaskEdit(e.target.dataset.edit, e.target);
    }
  }, { signal });
  // Escape closes the task, unless it is closing a dropdown, the date picker, an editor or a dialog
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || modal.style.display === 'none') return;
    if (document.querySelector('.crm-dd.is-open')) return;
    const picker = document.getElementById('td-due-input')?._customCalendar;
    if (picker?.isOpen) {
      picker.close();
      return;
    }
    if (document.activeElement?.classList.contains('od-input')) return;
    if (document.getElementById('confirm-dialog')?.style.display === 'flex') return;
    window.closeTaskDetail();
  }, { capture: true, signal });

  renderTaskDetail();
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // The deal it belongs to, and the team for the assignee picker, load after the panel shows
  const current = taskDetail;
  const loads = [];
  if (task.opportunity_id && !task.opportunity) {
    loads.push(supabaseClient
      .from('opportunities')
      .select('id, name, company_name, stage')
      .eq('id', task.opportunity_id)
      .maybeSingle()
      .then(({ data }) => { task.opportunity = data || null; }));
  }
  if (state.isManager) loads.push(loadTaskTeam());
  if (loads.length) Promise.all(loads).then(() => { if (taskDetail === current) renderTaskDetail(); });
}

function renderTaskDetail() {
  const panel = document.getElementById('task-detail-content');
  if (!panel || !taskDetail) return;
  const task = taskDetail.task;
  const canEdit = canEditTask(task);
  const canComplete = canCompleteTask(task);
  const isDone = task.status === 'completed';
  const me = state.currentUser.id;

  const prop = (key, label, iconKey, valueHtml) => `
    <div class="od-prop" data-prop="${key}">
      <dt class="od-prop-label">${tdIcon(TD_ICONS[iconKey])}${label}</dt>
      <dd class="od-prop-value">${valueHtml}</dd>
    </div>`;
  const pill = (id, options, value, editable) => {
    const option = options.find(o => o.value === value) || options[0];
    const control = editable
      ? window.buildCrmDropdown({ id, options: options.map(o => ({ value: o.value, label: o.label })), value: option.value, variant: 'inline' })
      : `<span class="od-readonly">${escapeHtml(option.label)}</span>`;
    return `<span class="od-stage" style="--stage-color:${option.color}">${control}</span>`;
  };

  // Where the task came from
  const creatorName = task.created_by === me ? 'you' : (tdFullName(task.created_by_profile) || 'a teammate');
  const workflow = WORKFLOW_DESCRIPTION.exec(task.description || '');
  let sourceHtml;
  if (task.opportunity_id) {
    const dealName = task.opportunity?.name;
    sourceHtml = `${tdIcon(TD_ICONS.deal)}<span>From the deal</span>`
      + (dealName
        ? `<button type="button" class="od-company is-link" data-action="open-deal">${escapeHtml(dealName)}</button>`
        : `<span>${task.opportunity === null ? '(not visible to you)' : '…'}</span>`)
      + `<span class="od-dot">·</span><span>added by ${escapeHtml(creatorName)}</span>`;
  } else if (workflow) {
    const verbs = { INSERT: 'added', UPDATE: 'updated', DELETE: 'deleted' };
    const nouns = { opportunities: 'deal', companies: 'company', people: 'person', tasks: 'task', call_logs: 'call', visits: 'visit' };
    sourceHtml = `${tdIcon(TD_ICONS.workflow)}<span>Created by a workflow when a ${escapeHtml(nouns[workflow[2]] || 'record')} was ${escapeHtml(verbs[workflow[1]] || 'changed')}</span>`;
  } else {
    sourceHtml = `<span>Added by ${escapeHtml(creatorName)}</span>`;
  }

  // Due date: the app's date picker opens from a transparent input over the value
  const due = describeDue(task, isDone);
  const dueText = due
    ? `<span class="od-due${due.status ? ` is-${due.status}` : ''}">${escapeHtml(due.label)}${due.status === 'overdue' ? ' · overdue' : ''}</span>`
    : '';
  const dueHtml = canEdit
    ? `<span class="td-due">
        <span class="od-editable${due ? '' : ' is-empty'}" aria-hidden="true">${dueText || 'Add due date'}</span>
        <input type="text" id="td-due-input" class="td-due-input" value="${escapeHtml(duePickerValue(task.due_date, task.due_all_day))}" aria-label="Due date">
      </span>${due ? '<button type="button" class="od-link" data-action="clear-due">Clear</button>' : ''}`
    : (dueText || '<span class="od-readonly is-empty">No due date</span>');

  // Assignee: managers can reassign
  const assigneeName = task.assigned_to === me ? 'You' : (tdFullName(task.assigned_to_profile) || '');
  const team = state.isManager && window._orgTeamMembersOrgId === state.currentOrganization?.id ? window._orgTeamMembers : null;
  let assigneeHtml;
  if (team) {
    const options = team.map(m => ({ value: m.id, label: m.id === me ? `${tdFullName(m) || 'You'} (you)` : (tdFullName(m) || m.email || 'Team member') }));
    if (task.assigned_to && !team.some(m => m.id === task.assigned_to)) options.unshift({ value: task.assigned_to, label: tdFullName(task.assigned_to_profile) || 'Former team member' });
    options.unshift({ value: '', label: 'Unassigned' });
    assigneeHtml = window.buildCrmDropdown({ id: 'td-assignee', options, value: task.assigned_to || '', placeholder: 'Unassigned', variant: 'inline', searchable: options.length > 8, searchPlaceholder: 'Search team…' });
  } else {
    assigneeHtml = task.assigned_to
      ? tdPerson(task.assigned_to, assigneeName || 'Teammate')
      : '<span class="od-readonly is-empty">Unassigned</span>';
  }

  // The deal, as a card you can open
  let dealHtml = '';
  if (task.opportunity_id) {
    const deal = task.opportunity;
    dealHtml = deal
      ? `<button type="button" class="td-deal" data-action="open-deal" title="Open ${escapeHtml(deal.name || 'deal')}">
          <span class="td-deal-name">${escapeHtml(deal.name || 'Untitled deal')}</span>
          ${deal.company_name && deal.company_name !== deal.name ? `<span class="td-deal-meta">${escapeHtml(deal.company_name)}</span>` : ''}
          ${tdIcon(TD_ICONS.open)}
        </button>`
      : `<span class="od-readonly is-empty">${deal === null ? 'Not visible to you' : 'Loading…'}</span>`;
  }

  // Description, minus text that only said where the task came from
  const description = (task.description || '').trim();
  const shownDescription = WORKFLOW_DESCRIPTION.test(description) || DEAL_DESCRIPTION.test(description) ? '' : description;
  const descriptionHtml = canEdit
    ? `<div class="od-notes${shownDescription ? '' : ' is-empty'}" data-edit="description" role="button" tabindex="0" aria-label="Edit description">${shownDescription ? escapeHtml(shownDescription) : 'Add a description…'}</div>`
    : `<div class="od-notes is-readonly${shownDescription ? '' : ' is-empty'}">${shownDescription ? escapeHtml(shownDescription) : 'No description.'}</div>`;

  const title = escapeHtml(task.title || 'Untitled task');
  const updated = task.updated_at && task.updated_at !== task.created_at ? task.updated_at : null;

  panel.innerHTML = `
    <header class="od-header td-header">
      ${canComplete
        ? `<button type="button" class="td-check${isDone ? ' is-checked' : ''}" data-action="toggle-done" title="${isDone ? 'Mark not done' : 'Mark done'}" aria-label="${isDone ? 'Mark not done' : 'Mark done'}" aria-pressed="${isDone}"></button>`
        : `<span class="td-check${isDone ? ' is-checked' : ''} is-static" aria-hidden="true"></span>`}
      <div class="od-heading">
        ${canEdit
          ? `<button type="button" class="od-title od-editable${isDone ? ' is-done' : ''}" id="td-title" data-edit="title">${title}</button>`
          : `<h2 class="od-title${isDone ? ' is-done' : ''}" id="td-title">${title}</h2>`}
        <div class="od-subtitle td-source">${sourceHtml}</div>
      </div>
      <div class="od-actions">
        ${canEdit ? `
          <button type="button" class="od-icon-btn" data-action="edit" title="Edit all fields" aria-label="Edit all fields">${tdIcon(TD_ICONS.edit)}</button>
          <button type="button" class="od-icon-btn is-danger" data-action="delete" title="Delete task" aria-label="Delete task">${tdIcon(TD_ICONS.trash)}</button>` : ''}
        <button type="button" class="od-icon-btn" data-action="close" title="Close" aria-label="Close">${tdIcon(TD_ICONS.close)}</button>
      </div>
    </header>

    <div class="od-body">
      <dl class="od-props">
        ${prop('status', 'Status', 'status', pill('td-status', TASK_STATUSES, task.status, canComplete))}
        ${prop('priority', 'Priority', 'priority', pill('td-priority', TASK_PRIORITIES, task.priority || 'medium', canEdit))}
        ${prop('due', 'Due', 'due', dueHtml)}
        ${prop('assignee', 'Assignee', 'assignee', assigneeHtml)}
        ${task.opportunity_id ? prop('deal', 'Deal', 'deal', dealHtml) : ''}
      </dl>

      <section class="td-section">
        <h3 class="td-section-title">Description</h3>
        ${descriptionHtml}
      </section>
    </div>

    <footer class="od-footer">
      <span>Created ${escapeHtml(formatDate(task.created_at))}</span>
      ${updated ? `<span class="od-dot">·</span><span>Updated ${escapeHtml(formatDate(updated))}</span>` : ''}
    </footer>`;

  window.initAllCrmDropdowns?.(panel);
  if (canEdit) window.initCustomCalendar?.('#td-due-input', { type: 'datetime-local', allDay: true });
}

function onTaskDetailClick(e) {
  if (!taskDetail) return;
  const task = taskDetail.task;

  const editTarget = e.target.closest('[data-edit]');
  if (editTarget) {
    startTaskEdit(editTarget.dataset.edit, editTarget);
    return;
  }

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'close') {
    window.closeTaskDetail();
  } else if (action === 'toggle-done') {
    saveTaskPatch({ status: task.status === 'completed' ? 'pending' : 'completed' });
  } else if (action === 'clear-due') {
    saveTaskPatch(dueFieldsFromPicker(''));
  } else if (action === 'open-deal') {
    window.closeTaskDetail();
    setTimeout(() => window.openOpportunityById(task.opportunity_id), 120);
  } else if (action === 'edit') {
    window.closeTaskDetail();
    openTaskModal(task, window.salesRepsData || []);
  } else if (action === 'delete') {
    deleteTaskFromDetail();
  }
}

/** Swap the title or description for an input. Enter (⌘↵ for the description)
 *  or leaving the field saves, Escape cancels. */
function startTaskEdit(field, anchor) {
  const task = taskDetail?.task;
  if (!task || !canEditTask(task)) return;
  const isDescription = field === 'description';
  const current = isDescription
    ? (WORKFLOW_DESCRIPTION.test(task.description || '') || DEAL_DESCRIPTION.test(task.description || '') ? '' : (task.description || ''))
    : (task.title || '');

  const input = document.createElement(isDescription ? 'textarea' : 'input');
  if (!isDescription) input.type = 'text';
  input.className = `od-input ${isDescription ? 'od-input--notes' : 'od-input--name'}`;
  input.value = current;
  input.placeholder = isDescription ? 'Add a description…' : 'Task title';
  if (isDescription) input.rows = Math.max(4, current.split('\n').length + 1);
  anchor.replaceWith(input);
  input.focus();
  if (!isDescription) input.select();

  let finished = false;
  const finish = async (save, refocus = false) => {
    if (finished) return;
    finished = true;
    const text = input.value.trim();
    if (!save || text === current.trim()) {
      input.replaceWith(anchor);
      if (refocus) anchor.focus();
      return;
    }
    if (!isDescription && !text) {
      showToast("A task needs a title", 'error');
      input.replaceWith(anchor);
      return;
    }
    input.disabled = true;
    await saveTaskPatch(isDescription ? { description: text || null } : { title: text });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false, true);
    } else if (e.key === 'Enter' && (!isDescription || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true, true);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

/** Save fields on the open task, then refresh what shows it */
async function saveTaskPatch(patch) {
  const task = taskDetail?.task;
  if (!task) return false;
  const updates = { ...patch, updated_at: new Date().toISOString() };
  const { data, error } = await supabaseClient.from('tasks').update(updates).eq('id', task.id).select('id');
  if (error || !data?.length) {
    showToast(error ? `Couldn't save the task: ${error.message}` : "You can't change this task.", 'error');
    renderTaskDetail();
    return false;
  }
  Object.assign(task, updates);
  const cached = window.allTasksData?.find(t => t.id === task.id);
  if (cached && cached !== task) Object.assign(cached, updates);

  if ('status' in patch) {
    showToast(patch.status === 'completed' ? 'Task done' : `Moved to ${TASK_STATUSES.find(s => s.value === patch.status)?.label || 'To Do'}`, 'success');
  }
  document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: patch.status === 'completed' ? 'complete' : 'update', id: task.id } }));
  document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
  // A deal's next step is its earliest open task
  if (task.opportunity_id && ('status' in patch || 'title' in patch || 'due_date' in patch)) {
    window.refreshDealNextStep?.(task.opportunity_id);
  }
  if (state.currentView === 'tasks') renderTasksView();
  renderTaskDetail();
  return true;
}

async function saveTaskAssignee(userId) {
  const task = taskDetail?.task;
  if (!task || (userId || null) === (task.assigned_to || null)) return;
  const member = (window._orgTeamMembers || []).find(m => m.id === userId);
  const previousProfile = task.assigned_to_profile;
  task.assigned_to_profile = member ? { first_name: member.first_name, last_name: member.last_name, email: member.email } : null;
  if (!await saveTaskPatch({ assigned_to: userId || null })) task.assigned_to_profile = previousProfile;
}

async function deleteTaskFromDetail() {
  const task = taskDetail?.task;
  if (!task) return;
  if (!await showConfirmDialog('Delete task', `Delete "${task.title}"?`)) return;
  const { data, error } = await supabaseClient.from('tasks').delete().eq('id', task.id).select('id');
  if (error || !data?.length) {
    showToast(error ? `Couldn't delete the task: ${error.message}` : "You can't delete this task.", 'error');
    return;
  }
  showToast('Task deleted', 'success');
  window.closeTaskDetail();
  document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: 'delete', id: task.id } }));
  document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
  if (task.opportunity_id) window.refreshDealNextStep?.(task.opportunity_id);
  if (state.currentView === 'tasks') renderTasksView();
}

window.closeTaskDetail = function () {
  const modal = document.getElementById('task-detail-modal');
  if (modal) modal.style.display = 'none';
  document.getElementById('td-due-input')?._customCalendar?.close();
  taskDetail?.listeners.abort();
  taskDetail = null;
  if (!Array.from(document.querySelectorAll('.modal')).some(m => m.style.display !== 'none')) {
    document.body.classList.remove('modal-active');
  }
};

function renderTaskCard(task, isManager) {
  const isAssignedToMe = task.assigned_to === state.currentUser.id;
  const isCreatedByMe = task.created_by === state.currentUser.id;
  const isCreatedByManager = state.isManager && task.created_by !== state.currentUser.id;

  // Permissions:
  // - Managers can edit any task.
  // - Sales reps can only edit tasks they created themselves (not tasks assigned to them by a manager).
  const canEdit = state.isManager || isCreatedByMe;

  // Completion permission:
  // - Managers can mark any task complete.
  // - Sales reps can mark a task complete if it is assigned to them or if they created it.
  const canComplete = state.isManager || isAssignedToMe || isCreatedByMe;

  const isOverdue = task.due_date && isPastDue(task.due_date, task.due_all_day) && task.status !== 'completed';
  const dueDateStr = task.due_date ? formatDue(task.due_date, task.due_all_day) : '';

  // Get assigned to name
  let assignedToName = 'Unassigned';
  if (task.assigned_to_profile) {
    assignedToName = `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`;
  } else if (task.assigned_to === state.currentUser.id) {
    assignedToName = 'Me';
  }

  // Get created by name
  let createdByName = 'Unknown';
  if (task.created_by_profile) {
    createdByName = `${task.created_by_profile.first_name} ${task.created_by_profile.last_name}`;
  } else if (task.created_by === state.currentUser.id) {
    createdByName = 'Me';
  }

  return `
    <div class="task-card" data-id="${task.id}" data-status="${task.status}" data-overdue="${isOverdue}">
      <div class="task-header">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-status ${task.status}">${getStatusLabel(task.status)}</div>
      </div>
      
      ${task.description ? `<div class="task-description">${escapeHtml(task.description)}</div>` : ''}
      
      <div class="task-meta">
        ${task.due_date ? `
          <div class="task-meta-item ${isOverdue ? 'task-overdue' : ''}">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar-icon lucide-calendar"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
            <span>Due: ${dueDateStr}</span>
            ${isOverdue ? '<i class="fas fa-exclamation-triangle"></i>' : ''}
          </div>
        ` : ''}
        
        <div class="task-meta-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-flag-icon lucide-flag"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>
          <span>Priority: ${task.priority || 'medium'}</span>
        </div>
        
        ${state.isManager || task.assigned_to ? `
          <div class="task-meta-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-icon lucide-user"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span>Assigned to: ${escapeHtml(assignedToName)}</span>
          </div>
        ` : ''}
      </div>
      
      <div class="task-actions">
        <div class="task-priority ${task.priority || 'medium'}">${(task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1)}</div>
        <div class="task-action-buttons">
          ${canEdit ? `
            <button class="task-action-btn edit-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-square-pen-icon lucide-square-pen"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>
            </button>
          ` : ''}
          ${canComplete && task.status !== 'completed' ? `
            <button class="task-action-btn complete-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check"><path d="M20 6 9 17l-5-5"/></svg>
            </button>
          ` : ''}
          ${state.isManager || isCreatedByMe ? `
            <button class="task-action-btn delete-task" data-id="${task.id}">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
      
      ${!state.isManager && isCreatedByManager ? `
        <div class="task-creator">
          <i class="fas fa-info-circle"></i>
          <span>This task was assigned to you by a manager</span>
        </div>
      ` : ''}
    </div>
  `;
}

function getStatusLabel(status) {
  switch (status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    default: return status;
  }
}

function initTaskFilters(tasks) {
  const filterButtons = document.querySelectorAll('.task-filter');

  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;

      // Apply filter
      document.querySelectorAll('.task-card').forEach(card => {
        let show = true;

        if (filter === 'assigned') {
          // Only show tasks created by current user
          const taskId = card.dataset.id;
          const task = tasks.find(t => t.id === taskId);
          show = task && task.created_by === state.currentUser.id;
        } else if (filter === 'overdue') {
          const isOverdue = card.dataset.overdue === 'true';
          show = isOverdue;
        } else {
          const status = card.dataset.status;
          show = status === filter;
        }

        card.style.display = show ? 'block' : 'none';
      });
    });
  });
}

function initTaskActionButtons(tasks, salesReps) {
  // Edit task buttons
  document.querySelectorAll('.edit-task').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        openTaskModal(task, salesReps);
      }
    });
  });

  // Complete task buttons
  document.querySelectorAll('.complete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;

      const { error } = await supabaseClient
        .from('tasks')
        .update({ status: 'completed', updated_at: new Date().toISOString() })
        .eq('id', taskId);

      if (error) {
        showToast('Error completing task: ' + error.message, 'error');
        return;
      }

      showToast('Task completed successfully', 'success');
      document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: 'complete', id: taskId } }));
      const completedTask = tasks.find(t => t.id === taskId);
      if (completedTask?.opportunity_id) window.refreshDealNextStep?.(completedTask.opportunity_id);
      renderTasksView();
    });
  });

  // Delete task buttons
  document.querySelectorAll('.delete-task').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskId = btn.dataset.id;

      const confirmed = await showConfirmDialog(
        'Delete Task',
        'Are you sure you want to delete this task?'
      );

      if (!confirmed) return;

      const { error } = await supabaseClient
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) {
        showToast('Error deleting task: ' + error.message, 'error');
        return;
      }

      showToast('Task deleted successfully', 'success');
      const deletedTask = tasks.find(t => t.id === taskId);
      if (deletedTask?.opportunity_id) window.refreshDealNextStep?.(deletedTask.opportunity_id);
      renderTasksView();
    });
  });
}

function openTaskModal(task = null, salesReps = [], initialStatus = 'pending') {
  const modal = document.getElementById('task-modal');
  const modalTitle = document.getElementById('task-modal-title');
  const saveBtn = document.getElementById('save-task-btn');
  const assignField = document.getElementById('task-assign-field');
  const assignSelect = document.getElementById('task-assign-to');

  // Reset form
  document.getElementById('task-title').value = '';
  document.getElementById('task-description').value = '';
  document.getElementById('task-due-date').value = '';
  document.getElementById('task-priority').value = 'medium';
  document.getElementById('task-status').value = initialStatus;

  // Populate sales reps dropdown for managers
  if (state.isManager && salesReps.length > 0) {
    assignField.style.display = 'block';
    const assignList = document.getElementById('task-assign-to-list');
    if (assignList) {
      let listHtml = `<li class="crm-dd-option is-selected" role="option" aria-selected="true" data-value="" data-label="Select a team member" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Select a team member</li>`;
      listHtml += `<li class="crm-dd-option" role="option" data-value="${state.currentUser.id}" data-label="Me" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Me</li>`;

      salesReps.forEach(rep => {
        listHtml += `<li class="crm-dd-option" role="option" data-value="${rep.id}" data-label="${escapeHtml(rep.first_name)} ${escapeHtml(rep.last_name)}" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${escapeHtml(rep.first_name)} ${escapeHtml(rep.last_name)}</li>`;
      });
      assignList.innerHTML = listHtml;
    }

    // Reset value
    if (window.setCrmDropdownValue) {
      window.setCrmDropdownValue(assignSelect, '');
    } else {
      assignSelect.value = '';
    }
  } else {
    assignField.style.display = 'none';
  }

  // Set modal title
  if (task) {
    modalTitle.innerHTML = 'Edit Task';

    // Fill form with task data
    document.getElementById('task-title').value = task.title || '';
    document.getElementById('task-description').value = task.description || '';

    // "2026-10-20" for an all-day task, "2026-10-20T15:00" (local time) for a timed one
    document.getElementById('task-due-date').value = duePickerValue(task.due_date, task.due_all_day);

    document.getElementById('task-priority').value = task.priority || 'medium';
    document.getElementById('task-status').value = task.status || 'pending';

    if (state.isManager && task.assigned_to) {
      if (window.setCrmDropdownValue) {
        window.setCrmDropdownValue(assignSelect, task.assigned_to);
      } else {
        assignSelect.value = task.assigned_to;
      }
    }
  } else {
    modalTitle.innerHTML = 'New Task';
  }

  // Show modal
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  // Initialize event listeners
  initTaskModalListeners(task);
}

function initTaskModalListeners(task) {
  // Save task
  const saveBtn = document.getElementById('save-task-btn');

  saveBtn.onclick = async () => {
    const title = document.getElementById('task-title').value.trim();
    const description = document.getElementById('task-description').value.trim();
    const dueDate = document.getElementById('task-due-date').value;
    const priority = document.getElementById('task-priority').value;
    const status = document.getElementById('task-status').value;

    // Get assigned to
    let assignedTo = null;
    if (state.isManager) {
      assignedTo = document.getElementById('task-assign-to').value || null;
    } else {
      // Non-managers can only create tasks for themselves
      assignedTo = state.currentUser.id;
    }

    // Validate
    if (!title) {
      showToast('Please enter a task title', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    try {
      const taskData = {
        title,
        description: description || null,
        assigned_to: assignedTo,
        created_by: state.currentUser.id,
        ...dueFieldsFromPicker(dueDate),
        priority,
        status,
        organization_id: state.currentOrganization?.id
      };

      let result;

      if (task) {
        // Update existing task
        result = await supabaseClient
          .from('tasks')
          .update(taskData)
          .eq('id', task.id);
      } else {
        // Create new task
        result = await supabaseClient
          .from('tasks')
          .insert([taskData]);
      }

      if (result.error) throw result.error;

      showToast(`Task ${task ? 'updated' : 'created'} successfully!`, 'success');
      // A deal's next step is its earliest open task
      if (task?.opportunity_id) window.refreshDealNextStep?.(task.opportunity_id);
      closeModal('task-modal');
      document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
      renderTasksView();
    } catch (error) {
      showToast(`Error ${task ? 'updating' : 'creating'} task: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save Task';
    }
  };
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderTasksView,
  renderKanbanTaskCard,
  initKanbanBoard,
  updateColumnCounts,
  showTaskDetail,
  renderTaskCard,
  getStatusLabel,
  initTaskFilters,
  initTaskActionButtons,
  openTaskModal,
  initTaskModalListeners,
};
