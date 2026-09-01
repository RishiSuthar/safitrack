// modules/pages/dashboard.js
// Dashboard route wrapper.

import { state } from '../state.js';
import { loadView } from '../core/navigation.js';

function resolveDashboardView() {
  if (state.isManager) return 'team-dashboard';
  if (state.isTechnician) return 'technician-log-visit';
  return 'log-visit';
}

export async function renderDashboardPage() {
  const targetView = resolveDashboardView();
  await loadView(targetView, { skipRouteSync: true });
  return targetView;
}
