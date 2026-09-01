// modules/pages/visits.js
// Visits route wrapper.

import { state } from '../state.js';
import { loadView } from '../core/navigation.js';

function resolveVisitsView() {
  if (state.isManager) return 'team-dashboard';
  if (state.isTechnician) return 'technician-activity';
  return 'my-activity';
}

export async function renderVisitsPage() {
  const targetView = resolveVisitsView();
  await loadView(targetView, { skipRouteSync: true });
  return targetView;
}
