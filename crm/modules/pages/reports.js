// modules/pages/reports.js
// Reports route wrapper.

import { loadView } from '../core/navigation.js';

export async function renderReportsPage() {
  await loadView('reports', { skipRouteSync: true });
  return 'reports';
}
