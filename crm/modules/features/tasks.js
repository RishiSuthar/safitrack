// modules/features/tasks.js
// Tasks: one list grouped by when things are due, the task detail panel and the task form.
// A task is either to do (status 'pending') or done ('completed').
import { state, supabaseClient, loadPersistedState as _loadPersistedState, saveViewState } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials } from '../ui/toast.js';
import { renderError } from '../utils/helpers.js';
import { fetchAllPages } from '../utils/analytics.js';
import { isPastDue, daysUntilDue, formatDue, dueStart, dueFieldsFromPicker, duePickerValue } from '../utils/due-dates.js';
import { memberColor } from '../ui/member-color.js';
import { fbSearch, fbSelect, fbClear, initFilterBar, resetFilterBar } from '../ui/filter-bar.js';

const TASK_SELECT = `
  *,
  assigned_to_profile:profiles!tasks_assigned_to_fkey(first_name, last_name, email),
  created_by_profile:profiles!tasks_created_by_fkey(first_name, last_name, email),
  opportunity:opportunities!tasks_opportunity_id_fkey(id, name, company_name, stage)
`;

// The list on screen: every task loaded, and how it is sorted and filtered
let taskList = null;

const TL_ICONS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  sort: '<path d="M3 6h13M3 12h9M3 18h5"/><path d="m17 15 3 3 3-3M20 18V6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  task: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  due: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  assignee: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.2 18.4a7 7 0 0 1 11.6 0"/>',
  deal: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.1 0 2.9 6 1.5 6 4.3 0 1.2-1.3 2.1-3 2.1-1.4 0-2.6-.6-3-1.6M12 6.5v1.5M12 16v1.5"/>',
  flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.33 2q2 0 3.07-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.53"/>',
};
const tlIcon = (key, cls = 'tl-icon') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TL_ICONS[key]}</svg>`;

const TL_SORTS = [
  { value: 'due', label: 'Due date' },
  { value: 'created', label: 'Recently added' },
];

// Group headers start open except the ones the user folded (kept per browser)
const COLLAPSED_KEY = 'safitrack_tasks_collapsed';
function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]')); } catch { return new Set(); }
}
function saveCollapsed(set) {
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set])); } catch { /* storage unavailable */ }
}

async function fetchTasks() {
  let q = supabaseClient.from('tasks').select(TASK_SELECT).order('created_at', { ascending: false });
  // Reps see tasks assigned to them or created by them (RLS agrees)
  if (!state.isManager) q = q.or(`assigned_to.eq.${state.currentUser.id},created_by.eq.${state.currentUser.id}`);
  if (state.currentOrganization?.id) q = q.eq('organization_id', state.currentOrganization.id);
  return fetchAllPages(q);
}

async function renderTasksView() {
  const { data: tasks, error } = await fetchTasks();
  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  // Shared with the detail panel, notifications and the task form
  window.allTasksData = tasks || [];

  let salesReps = [];
  if (state.isManager) {
    let repsQ = supabaseClient.from('profiles').select('id, first_name, last_name, email').order('first_name', { ascending: true });
    if (state.currentOrganization?.id) repsQ = repsQ.eq('organization_id', state.currentOrganization.id);
    const { data: reps } = await repsQ;
    salesReps = reps || [];
  }
  window.salesRepsData = salesReps;

  const saved = _loadPersistedState().tasks || {};
  taskList = {
    tasks: window.allTasksData,
    sort: TL_SORTS.some(s => s.value === saved.sort) ? saved.sort : 'due',
    assignee: state.isManager ? (saved.assignee || 'all') : 'all',
    priority: saved.priority || 'all',
    query: saved.search || '',
    collapsed: loadCollapsed(),
  };

  const assigneeOptions = [
    { value: 'all', label: 'Anyone' },
    { value: state.currentUser.id, label: 'Me' },
    { value: 'none', label: 'Unassigned' },
    ...salesReps
      .filter(r => r.id !== state.currentUser.id)
      .map(r => ({ value: r.id, label: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Teammate' })),
  ];
  if (!assigneeOptions.some(o => o.value === taskList.assignee)) taskList.assignee = 'all';

  viewContainer.innerHTML = `
    <div class="crm-page-shell tl-page">
      <div class="tl-toolbar">
        <div class="fb" id="tl-fb">
          ${fbSearch({ id: 'tl-search', placeholder: 'Search tasks', value: taskList.query })}
          <div class="fb-filters">
            ${state.isManager ? fbSelect({ id: 'tl-assignee', label: 'Assigned to', options: assigneeOptions, value: taskList.assignee, searchable: assigneeOptions.length > 8 }) : ''}
            ${fbSelect({ id: 'tl-priority', label: 'Priority', options: [{ value: 'all', label: 'Any priority' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }], value: taskList.priority })}
            ${fbClear('tl-clear')}
          </div>
          <div class="fb-actions">
            ${fbSelect({ id: 'tl-sort', label: 'Sort', kind: 'sort', options: TL_SORTS, value: taskList.sort })}
            <button type="button" class="btn btn-primary" id="add-task-btn">${tlIcon('plus')}<span>New Task</span></button>
          </div>
        </div>
      </div>

      <div class="tl-table" role="table" aria-label="Tasks">
        <div class="tl-head" role="row">
          <div class="tl-col tl-col--task" role="columnheader">${tlIcon('task')}Task</div>
          <div class="tl-col tl-col--due" role="columnheader">${tlIcon('due')}Due date</div>
          <div class="tl-col tl-col--record" role="columnheader">${tlIcon('deal')}Opportunity</div>
          <div class="tl-col tl-col--assignee" role="columnheader">${tlIcon('assignee')}Assigned to</div>
        </div>
        <div class="tl-body" id="tl-body"></div>
      </div>
    </div>
  `;

  bindTaskList();
  renderTaskList();
}

/** Tasks that pass the toolbar filters */
function visibleTasks() {
  const { tasks, assignee, priority, query } = taskList;
  const q = query.trim().toLowerCase();
  return tasks.filter(t => {
    if (assignee === 'none' ? t.assigned_to : (assignee !== 'all' && t.assigned_to !== assignee)) return false;
    if (priority !== 'all' && (t.priority || 'medium') !== priority) return false;
    if (q) {
      const haystack = [t.title, t.description, t.opportunity?.name, t.opportunity?.company_name, tdFullName(t.assigned_to_profile)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

const dueTime = (t) => dueStart(t.due_date, t.due_all_day)?.getTime() ?? Infinity;
const createdTime = (t) => new Date(t.created_at).getTime() || 0;
const doneTime = (t) => new Date(t.updated_at || t.created_at).getTime() || 0;

/** The groups to show, each { key, label, tasks } */
function groupTasks(tasks) {
  const open = tasks.filter(t => t.status !== 'completed');
  const done = tasks.filter(t => t.status === 'completed').sort((a, b) => doneTime(b) - doneTime(a));

  let groups;
  if (taskList.sort === 'created') {
    groups = [{ key: 'todo', label: 'To do', tasks: open.sort((a, b) => createdTime(b) - createdTime(a)) }];
  } else {
    // Overdue work counts as today's, like Attio: it still needs doing now
    const today = [];
    const upcoming = [];
    const undated = [];
    open.forEach(t => {
      const days = t.due_date ? daysUntilDue(t.due_date, t.due_all_day) : null;
      if (days === null) undated.push(t);
      else if (days <= 0) today.push(t);
      else upcoming.push(t);
    });
    const byDue = (a, b) => dueTime(a) - dueTime(b) || createdTime(b) - createdTime(a);
    groups = [
      { key: 'today', label: 'Today', tasks: today.sort(byDue) },
      { key: 'upcoming', label: 'Upcoming', tasks: upcoming.sort(byDue) },
      { key: 'undated', label: 'No due date', tasks: undated.sort((a, b) => createdTime(b) - createdTime(a)) },
    ];
  }
  groups.push({ key: 'done', label: 'Completed', tasks: done });
  return groups.filter(g => g.tasks.length);
}

/** "Due 2 days ago", "Due today", "Due tomorrow, 3:00 PM", "Due Fri 24 Oct" */
function dueLabel(task) {
  if (!task.due_date) return '';
  const days = daysUntilDue(task.due_date, task.due_all_day);
  if (days === null) return '';
  const isDone = task.status === 'completed';
  if (days < 0 && !isDone) return days === -1 ? 'Due yesterday' : `Due ${-days} days ago`;
  const label = formatDue(task.due_date, task.due_all_day);
  return `Due ${days >= -1 && days <= 1 ? label.charAt(0).toLowerCase() + label.slice(1) : label}`;
}

function renderTaskRow(task) {
  const isDone = task.status === 'completed';
  const overdue = !isDone && task.due_date && isPastDue(task.due_date, task.due_all_day);
  const dueToday = !isDone && !overdue && task.due_date && daysUntilDue(task.due_date, task.due_all_day) === 0;
  const canComplete = canCompleteTask(task);
  const title = escapeHtml(task.title || 'Untitled task');

  const deal = task.opportunity;
  const record = deal
    ? `<button type="button" class="tl-chip tl-chip--record" data-action="open-deal" title="Open ${escapeHtml(deal.name || 'deal')}">${tlIcon('deal', 'tl-chip-icon')}<span>${escapeHtml(deal.name || 'Untitled deal')}</span></button>`
    : '';

  let assignee = '';
  if (task.assigned_to) {
    const name = task.assigned_to === state.currentUser.id
      ? 'You'
      : (tdFullName(task.assigned_to_profile) || task.assigned_to_profile?.email || 'Teammate');
    const avatarName = task.assigned_to === state.currentUser.id ? (tdFullName(state.currentUserProfile) || 'You') : name;
    assignee = `<span class="tl-chip tl-chip--person" title="${escapeHtml(name)}"><span class="tl-avatar" style="background:${memberColor(task.assigned_to)}">${escapeHtml(getInitials(avatarName).charAt(0))}</span><span>${escapeHtml(name)}</span></span>`;
  }

  return `
    <div class="tl-row${isDone ? ' is-done' : ''}" role="row" data-task-id="${task.id}" tabindex="0">
      <div class="tl-cell tl-col--task" role="cell">
        ${canComplete
          ? `<button type="button" class="tl-check${isDone ? ' is-checked' : ''}" data-action="toggle" aria-pressed="${isDone}" aria-label="${isDone ? 'Mark as to do' : 'Mark as done'}" title="${isDone ? 'Mark as to do' : 'Mark as done'}"></button>`
          : `<span class="tl-check${isDone ? ' is-checked' : ''} is-static" aria-hidden="true"></span>`}
        <span class="tl-title">${title}</span>
        ${task.priority === 'high' && !isDone ? `<span class="tl-flag" title="High priority">${tlIcon('flag')}</span>` : ''}
      </div>
      <div class="tl-cell tl-col--due${overdue ? ' is-overdue' : ''}${dueToday ? ' is-today' : ''}" role="cell">${escapeHtml(dueLabel(task))}</div>
      <div class="tl-cell tl-col--record" role="cell">${record}</div>
      <div class="tl-cell tl-col--assignee" role="cell">${assignee}</div>
    </div>`;
}

/** Redraw the rows from taskList (the toolbar stays) */
function renderTaskList() {
  const body = document.getElementById('tl-body');
  if (!body || !taskList) return;

  const shown = visibleTasks();
  const filtered = taskList.assignee !== 'all' || taskList.priority !== 'all' || taskList.query.trim() !== '';

  if (!shown.length) {
    body.innerHTML = `
      <div class="tl-empty">
        <div class="tl-empty-title">${filtered ? 'No tasks match' : 'No tasks yet'}</div>
        <div class="tl-empty-text">${filtered ? 'Try a different search or filter.' : 'Add follow-ups for yourself or your team, or add them from a deal.'}</div>
        ${filtered
          ? '<button type="button" class="btn btn-secondary" data-action="clear-filters">Clear filters</button>'
          : `<button type="button" class="btn btn-primary" data-action="new-task">${tlIcon('plus')}New Task</button>`}
      </div>`;
    return;
  }

  body.innerHTML = groupTasks(shown).map(group => {
    const collapsed = taskList.collapsed.has(group.key);
    return `
      <section class="tl-group${collapsed ? ' is-collapsed' : ''}" data-group="${group.key}">
        <button type="button" class="tl-group-head" data-action="toggle-group" aria-expanded="${!collapsed}">
          ${tlIcon('chevron', 'tl-group-chevron')}
          <span class="tl-group-label">${group.label}</span>
          <span class="tl-group-count">${group.tasks.length}</span>
        </button>
        ${collapsed ? '' : group.tasks.map(renderTaskRow).join('')}
      </section>`;
  }).join('');
}

function persistTaskList() {
  saveViewState({ tasks: { sort: taskList.sort, assignee: taskList.assignee, priority: taskList.priority, search: taskList.query } });
}

function bindTaskList() {
  const root = viewContainer.querySelector('.tl-page');
  if (!root) return;

  document.getElementById('add-task-btn')?.addEventListener('click', () => openTaskModal(null));

  const onFilter = (key) => (e) => {
    taskList[key] = e.target.value;
    persistTaskList();
    renderTaskList();
  };
  document.getElementById('tl-sort')?.addEventListener('change', onFilter('sort'));
  document.getElementById('tl-assignee')?.addEventListener('change', onFilter('assignee'));
  document.getElementById('tl-priority')?.addEventListener('change', onFilter('priority'));

  let searchTimer;
  document.getElementById('tl-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      taskList.query = e.target.value;
      persistTaskList();
      renderTaskList();
    }, 120);
  });

  const bar = document.getElementById('tl-fb');
  const clearFilters = () => {
    resetFilterBar(bar);
    taskList.assignee = 'all';
    taskList.priority = 'all';
    taskList.query = '';
    persistTaskList();
    renderTaskList();
  };
  initFilterBar(bar, { onClear: clearFilters });

  const body = document.getElementById('tl-body');
  body?.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    const action = actionEl?.dataset.action;
    if (action === 'clear-filters') return clearFilters();
    if (action === 'new-task') return openTaskModal(null);
    if (action === 'toggle-group') {
      const key = actionEl.closest('.tl-group')?.dataset.group;
      if (!key) return;
      taskList.collapsed.has(key) ? taskList.collapsed.delete(key) : taskList.collapsed.add(key);
      saveCollapsed(taskList.collapsed);
      renderTaskList();
      return;
    }

    const row = e.target.closest('.tl-row');
    const task = row && taskList.tasks.find(t => String(t.id) === row.dataset.taskId);
    if (!task) return;
    if (action === 'toggle') {
      e.stopPropagation();
      toggleTaskDone(task);
    } else if (action === 'open-deal') {
      e.stopPropagation();
      window.openOpportunityById?.(task.opportunity_id);
    } else {
      showTaskDetail(task);
    }
  });
  body?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList?.contains('tl-row')) return;
    const task = taskList.tasks.find(t => String(t.id) === e.target.dataset.taskId);
    if (task) showTaskDetail(task);
  });
}

/** Tick or untick a task from the list. The row moves at once; a failed save puts it back. */
async function toggleTaskDone(task) {
  if (!canCompleteTask(task)) return;
  const previous = { status: task.status, updated_at: task.updated_at };
  const updates = { status: task.status === 'completed' ? 'pending' : 'completed', updated_at: new Date().toISOString() };
  Object.assign(task, updates);
  renderTaskList();

  const { data, error } = await supabaseClient.from('tasks').update(updates).eq('id', task.id).select('id');
  if (error || !data?.length) {
    Object.assign(task, previous);
    renderTaskList();
    showToast(error ? `Couldn't update the task: ${error.message}` : "You can't change this task.", 'error');
    return;
  }
  afterTaskChange(task, updates);
}

/** Tell the rest of the app a task changed */
function afterTaskChange(task, patch) {
  document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: patch.status === 'completed' ? 'complete' : 'update', id: task.id } }));
  document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
  // A deal's next step is its earliest open task
  if (task.opportunity_id && ('status' in patch || 'title' in patch || 'due_date' in patch)) {
    window.refreshDealNextStep?.(task.opportunity_id);
  }
}

/** Redraw the list after a change made elsewhere (detail panel, form) */
function refreshTaskList({ refetch = false } = {}) {
  if (state.currentView !== 'tasks' || !document.getElementById('tl-body')) return;
  if (refetch) {
    renderTasksView();
  } else {
    renderTaskList();
  }
}

// ── Task detail ───────────────────────────────────────────────────────────────
// The same quiet panel as a deal: title with a done checkbox, where the task
// came from (a deal, a workflow or a person), a property list that edits in
// place, then the description. The pencil still opens the full task form.

// The task on screen and listeners removed when another task opens
let taskDetail = null;

const TASK_PRIORITIES = [
  { value: 'high', label: 'High', color: '#dc2626' },
  { value: 'medium', label: 'Medium', color: '#d97706' },
  { value: 'low', label: 'Low', color: '#94a3b8' },
];

const tdIcon = (paths) => `<svg class="od-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const TD_ICONS = {
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

function tdPerson(userId, name) {
  return `<span class="od-person"><span class="od-person-avatar" style="background:${memberColor(userId)}">${escapeHtml(getInitials(name))}</span>${escapeHtml(name)}</span>`;
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
    openTaskModal(task);
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
    showToast(patch.status === 'completed' ? 'Task done' : 'Marked as to do', 'success');
  }
  afterTaskChange(task, patch);
  refreshTaskList();
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
  if (window.allTasksData) window.allTasksData = window.allTasksData.filter(t => t.id !== task.id);
  if (taskList) taskList.tasks = taskList.tasks.filter(t => t.id !== task.id);
  refreshTaskList();
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

// ── Task form ─────────────────────────────────────────────────────────────────
// New tasks start as to do; ticking them off happens in the list or the panel.

/** Deals the user can link a task to, newest first (cached per org for the session) */
async function loadDealOptions() {
  const orgId = state.currentOrganization?.id;
  if (window._taskDealOptions && window._taskDealOptionsOrgId === orgId) return window._taskDealOptions;
  let q = supabaseClient.from('opportunities').select('id, name, company_name').order('created_at', { ascending: false });
  if (orgId) q = q.eq('organization_id', orgId);
  const { data, error } = await fetchAllPages(q);
  if (error) return [];
  window._taskDealOptions = data || [];
  window._taskDealOptionsOrgId = orgId;
  return window._taskDealOptions;
}

function renderDealPicker(deals, value) {
  const slot = document.getElementById('task-deal-slot');
  if (!slot) return;
  const options = [{ value: '', label: 'No deal' }, ...deals.map(d => ({
    value: d.id,
    label: d.company_name && d.company_name !== d.name ? `${d.name || 'Untitled deal'} · ${d.company_name}` : (d.name || 'Untitled deal'),
  }))];
  // A linked deal the user can't list any more still shows as selected
  if (value && !deals.some(d => d.id === value)) options.splice(1, 0, { value, label: 'Linked deal' });
  slot.innerHTML = window.buildCrmDropdown({ id: 'task-deal', options, value: value || '', placeholder: 'No deal', variant: 'form', searchable: options.length > 6, searchPlaceholder: 'Search deals…' });
  window.initAllCrmDropdowns?.(slot);
}

async function openTaskModal(task = null, salesReps = window.salesRepsData || []) {
  const modal = document.getElementById('task-modal');
  const modalTitle = document.getElementById('task-modal-title');
  const assignField = document.getElementById('task-assign-field');
  const assignSelect = document.getElementById('task-assign-to');
  if (!modal) return;

  document.getElementById('task-title').value = task?.title || '';
  const description = task?.description || '';
  document.getElementById('task-description').value = DEAL_DESCRIPTION.test(description) ? '' : description;
  // "2026-10-20" for an all-day task, "2026-10-20T15:00" (local time) for a timed one
  document.getElementById('task-due-date').value = task ? duePickerValue(task.due_date, task.due_all_day) : '';
  const priorityInput = document.getElementById('task-priority');
  window.setCrmDropdownValue ? window.setCrmDropdownValue(priorityInput, task?.priority || 'medium') : (priorityInput.value = task?.priority || 'medium');

  // Managers pick who it's for; everyone else adds tasks for themselves
  if (state.isManager) {
    let reps = salesReps;
    if (!reps.length) reps = await loadTaskTeam();
    assignField.style.display = '';
    const assignList = document.getElementById('task-assign-to-list');
    if (assignList) {
      const check = '<svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      const option = (value, label) => `<li class="crm-dd-option" role="option" data-value="${escapeHtml(value)}" data-label="${escapeHtml(label)}" tabindex="-1">${check}${escapeHtml(label)}</li>`;
      assignList.innerHTML = option('', 'Unassigned')
        + option(state.currentUser.id, 'Me')
        + reps.filter(r => r.id !== state.currentUser.id)
          .map(r => option(r.id, [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email || 'Teammate')).join('');
    }
    const assignTo = task ? (task.assigned_to || '') : state.currentUser.id;
    window.setCrmDropdownValue ? window.setCrmDropdownValue(assignSelect, assignTo) : (assignSelect.value = assignTo);
  } else {
    assignField.style.display = 'none';
  }
  // Without the assignee beside it, the deal picker takes the whole row
  document.getElementById('task-deal-field').style.gridColumn = state.isManager ? '' : '1 / -1';

  modalTitle.textContent = task ? 'Edit task' : 'New task';

  // The deal list loads after the form shows
  const dealId = task?.opportunity_id || '';
  renderDealPicker([], dealId);
  loadDealOptions().then(deals => {
    if (modal.style.display !== 'none' && modal.dataset.taskId === String(task?.id || '')) {
      renderDealPicker(deals, document.getElementById('task-deal')?.value ?? dealId);
    }
  });

  modal.dataset.taskId = String(task?.id || '');
  modal.style.display = 'flex';
  document.body.classList.add('modal-active');
  setTimeout(() => document.getElementById('task-title')?.focus(), 50);

  initTaskModalListeners(task);
}

function initTaskModalListeners(task) {
  const saveBtn = document.getElementById('save-task-btn');
  const titleInput = document.getElementById('task-title');
  if (titleInput) {
    titleInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBtn.click();
      }
    };
  }

  saveBtn.onclick = async () => {
    const title = titleInput.value.trim();
    if (!title) {
      showToast('Give the task a title', 'error');
      titleInput.focus();
      return;
    }

    const opportunityId = document.getElementById('task-deal')?.value || null;
    const taskData = {
      title,
      description: document.getElementById('task-description').value.trim() || null,
      ...dueFieldsFromPicker(document.getElementById('task-due-date').value),
      priority: document.getElementById('task-priority').value || 'medium',
      // Reps can only add tasks for themselves
      assigned_to: state.isManager ? (document.getElementById('task-assign-to').value || null) : (task ? task.assigned_to : state.currentUser.id),
      opportunity_id: opportunityId,
    };

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const result = task
        ? await supabaseClient.from('tasks').update({ ...taskData, updated_at: new Date().toISOString() }).eq('id', task.id).select('id')
        : await supabaseClient.from('tasks').insert([{
          ...taskData,
          status: 'pending',
          created_by: state.currentUser.id,
          organization_id: state.currentOrganization?.id,
        }]).select('id');
      if (result.error) throw result.error;
      if (task && !result.data?.length) throw new Error("you can't change this task");

      showToast(task ? 'Task updated' : 'Task added', 'success');
      closeModal('task-modal');
      // A deal's next step is its earliest open task: refresh the deal it left and the one it joined
      new Set([task?.opportunity_id, opportunityId].filter(Boolean)).forEach(id => window.refreshDealNextStep?.(id));
      document.dispatchEvent(new CustomEvent('safitrack:mutation', { detail: { table: 'tasks', action: task ? 'update' : 'insert', id: task?.id || result.data?.[0]?.id } }));
      document.dispatchEvent(new CustomEvent('safitrack:notification-refresh'));
      refreshTaskList({ refetch: true });
    } catch (error) {
      showToast(`Couldn't ${task ? 'save' : 'add'} the task: ${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save task';
    }
  };
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderTasksView,
  showTaskDetail,
  openTaskModal,
  initTaskModalListeners,
};
