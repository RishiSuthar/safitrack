// modules/pages/deals.js
// Deals route wrapper.

import { loadView } from '../core/navigation.js';

export async function renderDealsPage() {
  await loadView('opportunity-pipeline', { skipRouteSync: true });
  return 'opportunity-pipeline';
}
