// modules/pages/contacts.js
// Contacts route wrapper.

import { loadView } from '../core/navigation.js';

export async function renderContactsPage() {
  await loadView('people', { skipRouteSync: true });
  return 'people';
}
