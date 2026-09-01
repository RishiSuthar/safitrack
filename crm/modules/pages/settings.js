// modules/pages/settings.js
// Settings route wrapper.

import { loadView } from '../core/navigation.js';

export async function renderSettingsPage() {
  await loadView('settings', { skipRouteSync: true });
  return 'settings';
}
