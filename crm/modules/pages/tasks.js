// modules/pages/tasks.js
// Tasks route wrapper.

import { loadView } from '../core/navigation.js';

export async function renderTasksPage() {
  await loadView('tasks', { skipRouteSync: true });
  return 'tasks';
}
