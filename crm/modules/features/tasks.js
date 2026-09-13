// modules/features/tasks.js
// Task management: kanban + list views, modals.
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getLeadScoreBadge } from '../utils/helpers.js';

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
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email)
      `)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) tasksQ = tasksQ.eq('organization_id', state.currentOrganization.id);
    const result = await tasksQ;
    tasks = result.data;
    error = result.error;
  } else {
    let tasksQ = supabaseClient
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email)
      `)
      .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`)
      .order('created_at', { ascending: false });
    if (state.currentOrganization?.id) tasksQ = tasksQ.eq('organization_id', state.currentOrganization.id);
    const result = await tasksQ;
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

          <button class="btn btn-primary tasks-add-btn" id="add-task-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            <span>New Task</span>
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

  // Add Task Modal Container (Unified Attio Redesign)
  html += `
    <div class="modal record-view-modal" id="task-detail-modal" style="display:none;">
      <div class="modal-backdrop" onclick="window.closeTaskDetail()"></div>
      <div class="record-modal-panel" id="task-detail-content">
        <!-- Content will be populated dynamically -->
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize functionality
  initKanbanBoard(tasks, salesReps);
  updateColumnCounts();

  // Common listeners setup (Search, Add Task)
  // ... (Listeners are set up below in existing code)
}

function renderKanbanTaskCard(task, isManager) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';

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
      ${task.description ? `
        <div class="task-card-description">${escapeHtml(task.description)}</div>
      ` : ''}
      <div class="task-card-footer">
        <div class="task-card-due-date ${isOverdue ? 'overdue' : (!task.due_date ? 'no-date' : '')}">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <span>${task.due_date ? formatDate(task.due_date) : 'No due date'}</span>
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

      // Date range filter
      if (show && (dateFrom || dateTo) && task.due_date) {
        const dueDate = new Date(task.due_date);
        if (dateFrom && dueDate < new Date(dateFrom)) show = false;
        if (dateTo) {
          const toEnd = new Date(dateTo);
          toEnd.setHours(23, 59, 59, 999);
          if (dueDate > toEnd) show = false;
        }
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

function showTaskDetail(task, salesReps) {
  const modal = document.getElementById('task-detail-modal');
  const content = document.getElementById('task-detail-content');
  if (!modal || !content) return;

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';

  // Assignee
  let assigneeName = 'Unassigned';
  let assigneeInitials = '—';
  if (task.assigned_to_profile) {
    assigneeName = `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`;
    const initials = (task.assigned_to_profile.first_name?.[0] || '') + (task.assigned_to_profile.last_name?.[0] || '');
    assigneeInitials = initials;
  } else if (task.assigned_to === state.currentUser.id) {
    assigneeName = 'Me';
    assigneeInitials = 'Me';
  }

  // Assigned By (visible when a manager assigned the task)
  let assignedByHtml = '';
  let assignerName = '';
  if (task.created_by !== state.currentUser.id && task.created_by_profile) {
    assignerName = `${task.created_by_profile.first_name} ${task.created_by_profile.last_name}`;
    const assignerInitials = (task.created_by_profile.first_name?.[0] || '') + (task.created_by_profile.last_name?.[0] || '');
    assignedByHtml = `
      <div class="record-field-card">
        <div class="rfc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></div>
        <div class="rfc-body">
          <div class="rfc-label">Assigned By</div>
          <div class="rfc-value">${escapeHtml(assignerName)}</div>
        </div>
      </div>`;
  }

  // Permission: manager always edits; sales rep only if they created it
  const canEditDetails = state.isManager || task.created_by === state.currentUser.id;

  // Status config
  const statusMap = {
    pending:     { label: 'To Do',       cls: 'tdv-status-pending',     color: '#f59e0b' },
    in_progress: { label: 'In Progress', cls: 'tdv-status-in_progress', color: 'var(--color-primary)' },
    completed:   { label: 'Done',        cls: 'tdv-status-completed',   color: '#10b981' },
  };
  const sc = statusMap[task.status] || statusMap.pending;

  // Priority config
  const priorityMap = {
    high:   { label: 'High Priority',   cls: 'tdv-pill-priority-high',   color: '#ef4444' },
    medium: { label: 'Medium Priority', cls: 'tdv-pill-priority-medium', color: '#f59e0b' },
    low:    { label: 'Low Priority',    cls: 'tdv-pill-priority-low',    color: '#6b7280' },
  };
  const pc = priorityMap[task.priority] || priorityMap.medium;

  // Due date text & pill
  const dueDateText = task.due_date ? formatDate(task.due_date) : 'No due date';

  content.innerHTML = `
    <!-- Hero Section -->
    <div class="record-hero" id="task-view-hero">
      <div class="record-hero-avatar" style="background:${task.status === 'completed' ? '#10b981' : pc.color};">
        ${task.status === 'completed' 
          ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>`
          : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="4"/><path d="m9 12 2 2 4-4"/></svg>`
        }
      </div>
      <div class="record-hero-info">
        <div class="record-hero-name-row">
          <h2 class="record-hero-name" style="${task.status === 'completed' ? 'text-decoration:line-through; opacity:0.8;' : ''}">${escapeHtml(task.title)}</h2>
          <span class="record-hero-type-badge ${sc.cls}">${sc.label}</span>
          <span class="record-hero-type-badge ${pc.cls}">${pc.label}</span>
        </div>
        <div class="record-hero-meta-row" style="margin-top: 4px;">
          <span class="record-hero-cat-chip" style="${isOverdue ? 'color:#ef4444; border-color:rgba(239,68,68,0.3); background:rgba(239,68,68,0.08);' : ''}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px;"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            ${isOverdue ? 'Overdue · ' : ''}${dueDateText}
          </span>
          <span class="record-hero-subtitle" style="margin-left: 6px;">
            Assigned to <strong>${escapeHtml(assigneeName)}</strong>
          </span>
        </div>
      </div>
      <div class="record-hero-actions">
        ${canEditDetails ? `
          <button class="record-hero-edit-btn" id="task-view-edit-btn" onclick="editTask('${task.id}')" title="Edit task" aria-label="Edit task">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="record-hero-edit-btn" onclick="deleteTask('${task.id}')" title="Delete task" aria-label="Delete task" style="color:var(--color-danger); border-color:rgba(239,68,68,0.3);">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        ` : ''}
        <button class="modal-close" onclick="window.closeTaskDetail()" title="Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>
    </div>

    <!-- Stats Bar -->
    <div class="record-stats-bar">
      <div class="record-stat-item">
        <div class="record-stat-value record-stat-value--primary">${sc.label}</div>
        <div class="record-stat-label">Status</div>
      </div>
      <div class="record-stat-item">
        <div class="record-stat-value">${(task.priority || 'medium').toUpperCase()}</div>
        <div class="record-stat-label">Priority</div>
      </div>
      <div class="record-stat-item">
        <div class="record-stat-value" style="${isOverdue ? 'color:#ef4444;' : ''}">${dueDateText}</div>
        <div class="record-stat-label">Due Date</div>
      </div>
      <div class="record-stat-item">
        <div class="record-stat-value">${escapeHtml(assigneeName)}</div>
        <div class="record-stat-label">Assignee</div>
      </div>
    </div>

    <!-- Body: Main Content + Sidebar -->
    <div class="record-body">
      <div class="record-main">
        <div class="record-tabs">
          <button class="record-tab active">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Task Details &amp; Actions
          </button>
        </div>
        <div class="record-tab-panels">
          <div class="record-tab-panel">
            <!-- Quick Action Toggle -->
            <div style="display:flex; align-items:center; justify-content:space-between; padding:14px 18px; background:var(--bg-primary); border:1px solid var(--border-color); border-radius:10px; margin-bottom:18px;">
              <div>
                <div style="font-size:0.875rem; font-weight:700; color:var(--text-primary);">Status: ${sc.label}</div>
                <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">${task.status === 'completed' ? 'This task has been completed.' : 'Click to mark this task complete.'}</div>
              </div>
              <button class="btn btn-sm ${task.status === 'completed' ? 'btn-secondary' : 'btn-primary'}" onclick="window.toggleTaskCompleteFromDetail('${task.id}', '${task.status === 'completed' ? 'pending' : 'completed'}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:5px;"><path d="M20 6 9 17l-5-5"/></svg>
                ${task.status === 'completed' ? 'Mark Incomplete' : 'Mark as Done'}
              </button>
            </div>

            <div class="record-sidebar-title" style="margin-bottom:8px;">Description</div>
            <div class="ov-notes-container" style="font-size:0.92rem; line-height:1.7; min-height:140px;">
              ${task.description ? escapeHtml(task.description) : '<span class="text-muted" style="font-style:italic;">No description provided for this task.</span>'}
            </div>
          </div>
        </div>
      </div>

      <aside class="record-sidebar">
        <div class="record-sidebar-section">
          <div class="record-sidebar-title">People</div>
          <div class="record-field-card">
            <div class="rfc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="7" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg></div>
            <div class="rfc-body">
              <div class="rfc-label">Assigned To</div>
              <div class="rfc-value">${escapeHtml(assigneeName)}</div>
            </div>
          </div>
          ${assignedByHtml}
        </div>

        <div class="record-sidebar-section">
          <div class="record-sidebar-title">Task Info</div>
          <div class="record-field-card">
            <div class="rfc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></div>
            <div class="rfc-body">
              <div class="rfc-label">Due Date</div>
              <div class="rfc-value">${dueDateText}</div>
            </div>
          </div>
          <div class="record-field-card">
            <div class="rfc-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg></div>
            <div class="rfc-body">
              <div class="rfc-label">Priority</div>
              <div class="rfc-value" style="text-transform:capitalize;">${escapeHtml(task.priority || 'medium')}</div>
            </div>
          </div>
        </div>

        <div class="record-sidebar-section">
          <div class="record-sidebar-title">Record Info</div>
          <div class="ov-meta-item">
            <span class="ov-meta-label">Task ID</span>
            <span class="ov-meta-value rfc-mono">${escapeHtml(task.id || '—')}</span>
          </div>
          <div class="ov-meta-item">
            <span class="ov-meta-label">Created</span>
            <span class="ov-meta-value">${formatDate(task.created_at)}</span>
          </div>
        </div>
      </aside>
    </div>
  `;

  modal.style.display = 'flex';
  document.body.classList.add('modal-active');

  modal.onclick = (e) => {
    if (e.target === modal || e.target.classList.contains('modal-backdrop')) {
      window.closeTaskDetail();
    }
  };
}

// Global functions for task actions
window.closeTaskDetail = function () {
  const modal = document.getElementById('task-detail-modal');
  if (modal) modal.style.display = 'none';
  document.body.classList.remove('modal-active');
};

window.toggleTaskCompleteFromDetail = async function (taskId, newStatus) {
  const { error } = await supabaseClient
    .from('tasks')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', taskId);

  if (error) {
    showToast('Error updating task: ' + error.message, 'error');
    return;
  }

  showToast(newStatus === 'completed' ? 'Task marked as done' : 'Task marked as to-do', 'success');
  window.closeTaskDetail();
  document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: 'update', id: taskId } }));
  renderTasksView();
};

window.editTask = function (taskId) {
  window.closeTaskDetail();
  const task = window.allTasksData?.find(t => t.id === taskId);
  if (task) {
    openTaskModal(task, window.salesRepsData || []);
  }
};

window.deleteTask = async function (taskId) {
  const confirmed = await showConfirmDialog('Delete Task', 'Are you sure you want to delete this task?');
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from('tasks')
    .delete()
    .eq('id', taskId);

  if (error) {
    showToast('Error deleting task', 'error');
  } else {
    showToast('Task deleted successfully', 'success');
    window.closeTaskDetail();
    document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: 'delete', id: taskId } }));
    renderTasksView();
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

  const dueDate = task.due_date ? new Date(task.due_date) : null;
  const isOverdue = dueDate && dueDate < new Date();
  const dueDateStr = dueDate ? formatDate(dueDate) : '';

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
        <div class="task-title">${task.title}</div>
        <div class="task-status ${task.status}">${getStatusLabel(task.status)}</div>
      </div>
      
      ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
      
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
            <span>Assigned to: ${assignedToName}</span>
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
        listHtml += `<li class="crm-dd-option" role="option" data-value="${rep.id}" data-label="${rep.first_name} ${rep.last_name}" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${rep.first_name} ${rep.last_name}</li>`;
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

    // Fix for time display issue
    if (task.due_date) {
      const dueDate = new Date(task.due_date);
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const year = dueDate.getFullYear();
      const month = String(dueDate.getMonth() + 1).padStart(2, '0');
      const day = String(dueDate.getDate()).padStart(2, '0');
      const hours = String(dueDate.getHours()).padStart(2, '0');
      const minutes = String(dueDate.getMinutes()).padStart(2, '0');

      document.getElementById('task-due-date').value = `${year}-${month}-${day}T${hours}:${minutes}`;
    } else {
      document.getElementById('task-due-date').value = '';
    }

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
        due_date: dueDate ? new Date(dueDate).toISOString() : null,
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
