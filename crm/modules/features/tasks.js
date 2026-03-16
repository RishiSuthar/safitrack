// modules/features/tasks.js
// Task management: kanban + list views, modals.
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderSkeletonCards, renderError, getLeadScoreBadge } from '../utils/helpers.js';

async function renderTasksView() {
  // Fetch tasks based on user role
  let tasks;
  let error;

  if (state.isManager) {
    const result = await supabaseClient
      .from('tasks')
      .select(`
        *,
        assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
        created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email)
      `)
      .eq('created_by', state.currentUser.id)
      .order('created_at', { ascending: false });

    tasks = result.data;
    error = result.error;
  } else {
    const result = await supabaseClient
      .from('tasks')
      .select('*')
      .or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`)
      .order('created_at', { ascending: false });

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
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').eq('role', 'sales_rep').order('first_name', { ascending: true });
    if (state.currentOrganization?.id) repsQ = repsQ.eq('organization_id', state.currentOrganization.id);
    const { data: reps } = await repsQ;
    salesReps = reps || [];
  }
  // Store globally for editTask access
  window.salesRepsData = salesReps;

  let html = `

    <div class="tasks-kanban-header">
      <div class="tasks-search-bar">
        <i class="fas fa-search"></i>
        <input type="text" id="task-search-input" placeholder="Search tasks...">
      </div>
      <div class="tasks-header-actions">
        <button class="btn btn-secondary" id="filter-tasks-btn">
          <i class="fas fa-filter"></i> Filter
        </button>
        <button class="btn btn-primary" id="add-task-btn">
          <i class="fas fa-plus"></i> New Task
        </button>
      </div>
    </div>
  `;

  // Always render Kanban
  // Group tasks by status
  const todoTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const doneTasks = tasks.filter(t => t.status === 'completed');

  html += `
    <div class="tasks-kanban-container">
      <!-- To Do Column -->
      <div class="kanban-column" data-status="pending">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <div class="kanban-column-icon todo">📋</div>
            <span>To Do</span>
            <span class="kanban-column-count">${todoTasks.length} Tasks</span>
          </div>
          <button class="kanban-add-btn" data-status="pending">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="kanban-cards-container" id="kanban-todo">
          ${todoTasks.length === 0 ? `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">📝</div>
              <div class="kanban-empty-text">No tasks</div>
            </div>
          ` : todoTasks.map(task => renderKanbanTaskCard(task, state.isManager)).join('')}
        </div>
      </div>

      <!-- In Progress Column -->
      <div class="kanban-column" data-status="in_progress">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <div class="kanban-column-icon in-progress">🔄</div>
            <span>In Progress</span>
            <span class="kanban-column-count">${inProgressTasks.length} Tasks</span>
          </div>
          <button class="kanban-add-btn" data-status="in_progress">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="kanban-cards-container" id="kanban-in-progress">
          ${inProgressTasks.length === 0 ? `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">⚙️</div>
              <div class="kanban-empty-text">No tasks</div>
            </div>
          ` : inProgressTasks.map(task => renderKanbanTaskCard(task, state.isManager)).join('')}
        </div>
      </div>

      <!-- Done Column -->
      <div class="kanban-column" data-status="completed">
        <div class="kanban-column-header">
          <div class="kanban-column-title">
            <div class="kanban-column-icon done">✅</div>
            <span>Done</span>
            <span class="kanban-column-count">${doneTasks.length} Tasks</span>
          </div>
          <button class="kanban-add-btn" data-status="completed">
            <i class="fas fa-plus"></i>
          </button>
        </div>
        <div class="kanban-cards-container" id="kanban-completed">
          ${doneTasks.length === 0 ? `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">🎉</div>
              <div class="kanban-empty-text">No tasks</div>
            </div>
          ` : doneTasks.map(task => renderKanbanTaskCard(task, state.isManager)).join('')}
        </div>
      </div>
    </div>
  `;

  // Add Task Modal Container
  html += `
    <div class="task-detail-modal" id="task-detail-modal">
      <div class="task-detail-container" id="task-detail-content">
        <!-- Content will be populated dynamically -->
      </div>
    </div>
  `;

  viewContainer.innerHTML = html;

  // Initialize functionality
  initKanbanBoard(tasks, salesReps);

  // Common listeners setup (Search, Add Task)
  // ... (Listeners are set up below in existing code)
}

function renderKanbanTaskCard(task, isManager) {
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';

  // Robust Assignee Logic
  let assigneeHtml = '<span style="font-size:0.75rem; color:var(--text-muted);">Unassigned</span>';
  let assigneeName = 'Unassigned';

  if (task.assigned_to_profile) {
    assigneeName = `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`;
    const initials = (task.assigned_to_profile.first_name?.[0] || '') + (task.assigned_to_profile.last_name?.[0] || '');
    assigneeHtml = `
            <div class="task-card-assignee">
              ${initials}
            </div>
            <span class="task-card-assignee-name">${task.assigned_to_profile.first_name}</span>
      `;
  } else if (task.assigned_to === state.currentUser.id) {
    assigneeName = 'Me';
    assigneeHtml = `
            <div class="task-card-assignee" style="background:var(--color-primary); color: white;">
              Me
            </div>
            <span class="task-card-assignee-name">Me</span>
      `;
  }

  return `
    <div class="kanban-task-card" data-task-id="${task.id}" data-status="${task.status}">
      <div class="task-card-header">
        <div class="task-card-title">${task.title}</div>
        <!-- Menu hidden/removed per design -->
      </div>
      ${task.description ? `
        <div class="task-card-description">${task.description}</div>
      ` : ''}
      <div class="task-card-tags">
        ${task.priority ? `
          <span class="task-tag priority-${task.priority}">
            ${task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🔵'}
            ${task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
          </span>
        ` : ''}
      </div>
      <div class="task-card-footer">
        <div class="task-card-due-date ${isOverdue ? 'overdue' : ''}">
          <i class="fas fa-calendar"></i>
          ${task.due_date ? formatDate(task.due_date) : 'No date'}
        </div>
        <div class="task-card-meta">
          <div class="task-card-assignee-wrapper" title="${assigneeName}">
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
      onAdd: function (evt) {
        // Remove empty state if present
        const emptyState = evt.to.querySelector('.kanban-empty-state');
        if (emptyState) {
          emptyState.remove();
        }
        updateColumnCounts();
      },
      onRemove: function (evt) {
        // Add empty state if column becomes empty
        if (evt.from.querySelectorAll('.kanban-task-card').length === 0) {
          let icon, text;
          if (evt.from.id === 'kanban-todo') { icon = '📝'; text = 'No tasks'; }
          else if (evt.from.id === 'kanban-in-progress') { icon = '⚙️'; text = 'No tasks'; }
          else { icon = '🎉'; text = 'No tasks'; }

          evt.from.innerHTML = `
            <div class="kanban-empty-state">
              <div class="kanban-empty-icon">${icon}</div>
              <div class="kanban-empty-text">${text}</div>
            </div>`;
        }
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
      document.querySelectorAll('.kanban-task-card').forEach(card => {
        const title = card.querySelector('.task-card-title').textContent.toLowerCase();
        const description = card.querySelector('.task-card-description')?.textContent.toLowerCase() || '';
        const matches = title.includes(query) || description.includes(query);
        card.style.display = matches ? 'flex' : 'none';
      });
      // Update column counts after filtering
      updateColumnCounts();
    });
  }

  // Header Add Task button
  const addTaskBtn = document.getElementById('add-task-btn');
  if (addTaskBtn) {
    addTaskBtn.addEventListener('click', () => {
      openTaskModal(null, salesReps);
    });
  }

  // Header Filter button
  const filterBtn = document.getElementById('filter-tasks-btn');
  if (filterBtn) {
    filterBtn.addEventListener('click', () => {
      showToast('Task filtering is currently being enhanced!', 'info');
    });
  }
}

function updateColumnCounts() {
  const columns = {
    'pending': document.querySelectorAll('#kanban-todo .kanban-task-card').length,
    'in_progress': document.querySelectorAll('#kanban-in-progress .kanban-task-card').length,
    'completed': document.querySelectorAll('#kanban-completed .kanban-task-card').length
  };

  document.querySelector('[data-status="pending"] .kanban-column-count').textContent = `${columns.pending} Tasks`;
  document.querySelector('[data-status="in_progress"] .kanban-column-count').textContent = `${columns.in_progress} Tasks`;
  document.querySelector('[data-status="completed"] .kanban-column-count').textContent = `${columns.completed} Tasks`;
}

function showTaskDetail(task, salesReps) {
  const modal = document.getElementById('task-detail-modal');
  const content = document.getElementById('task-detail-content');

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed';
  const assigneeName = task.assigned_to_profile
    ? `${task.assigned_to_profile.first_name} ${task.assigned_to_profile.last_name}`
    : 'Unassigned';

  // Permission Logic: STRICT
  // Manager can always edit.
  // Sales Rep can only edit/delete if they created the task.
  // If assigned to Sales Rep but created by Manager (or anyone else), Sales Rep CANNOT edit details or delete.
  const canEditDetails = state.isManager || task.created_by === state.currentUser.id;

  // Assigned By Info (Show if created by someone else)
  let assignedByHtml = '';
  if (task.created_by !== state.currentUser.id && task.created_by_profile) {
    assignedByHtml = `
      <div class="task-detail-meta-item">
        <div class="task-detail-meta-label">Assigned By</div>
        <div class="task-detail-meta-value">${task.created_by_profile.first_name} ${task.created_by_profile.last_name}</div>
      </div>`;
  }

  content.innerHTML = `
    <div class="task-detail-header">
      <div class="task-detail-title">${task.title}</div>
      <button class="modal-close" onclick="document.getElementById('task-detail-modal').classList.remove('active')">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
          class="lucide lucide-x-icon lucide-x">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
    <div class="task-detail-body">
      <div class="task-detail-section">
        <div class="task-detail-section-title">Description</div>
        <div class="task-detail-description">${task.description || 'No description provided'}</div>
      </div>
      
      <div class="task-detail-section">
        <div class="task-detail-meta">
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Status</div>
            <div class="task-detail-meta-value">
              ${task.status === 'pending' ? '📋 To Do' : task.status === 'in_progress' ? '🔄 In Progress' : '✅ Done'}
            </div>
          </div>
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Priority</div>
            <div class="task-detail-meta-value">
              ${task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Not set'}
            </div>
          </div>
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Due Date</div>
            <div class="task-detail-meta-value ${isOverdue ? 'task-overdue' : ''}">
              ${task.due_date ? formatDate(task.due_date) : 'No due date'}
            </div>
          </div>
          <div class="task-detail-meta-item">
            <div class="task-detail-meta-label">Assigned To</div>
            <div class="task-detail-meta-value">${assigneeName}</div>
          </div>
          ${assignedByHtml}
        </div>
      </div>

      <div class="task-detail-section">
        ${canEditDetails ? `
        <button class="btn btn-secondary" onclick="editTask('${task.id}')">
          Edit Task
        </button>
        <button class="btn btn-secondary" onclick="deleteTask('${task.id}')" style="margin-left: 0.5rem;">
          Delete
        </button>
        ` : `
        <div class="alert alert-info">
            <i class="fas fa-lock"></i> Only the manager can edit or delete this task.
        </div>
        `}
      </div>
    </div>
  `;

  modal.classList.add('active');

  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  };
}

// Global functions for task actions
window.editTask = function (taskId) {
  document.getElementById('task-detail-modal').classList.remove('active');
  // This will call the existing openTaskModal function
  const task = window.allTasksData?.find(t => t.id === taskId);
  if (task) {
    // Use globally stored sales reps
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
    document.getElementById('task-detail-modal').classList.remove('active');
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
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
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
      assignSelect.value = task.assigned_to;
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
