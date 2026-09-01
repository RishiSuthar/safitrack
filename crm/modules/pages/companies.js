// modules/pages/companies.js
// Companies route wrapper.

import { loadView } from '../core/navigation.js';

export async function renderCompaniesPage() {
  await loadView('companies', { skipRouteSync: true });
  return 'companies';
}
