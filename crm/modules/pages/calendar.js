// modules/pages/calendar.js
// Calendar route wrapper (mapped to reminders view).

import { loadView } from '../core/navigation.js';

export async function renderCalendarPage() {
  await loadView('reminders', { skipRouteSync: true });
  return 'reminders';
}
