// modules/utils/due-dates.js
// Due dates for tasks and reminders. A due time of exactly local midnight
// means "that day, no particular time": it is due all day and only becomes
// overdue once the day is over.

function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isAllDay(value) {
  const date = toDate(value);
  return Boolean(date) && date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

/** The moment a due date has passed: the end of the day for all-day dates */
export function dueDeadline(value) {
  const date = toDate(value);
  if (!date) return null;
  if (isAllDay(date)) date.setDate(date.getDate() + 1);
  return date;
}

export function isPastDue(value, now = new Date()) {
  const deadline = dueDeadline(value);
  return Boolean(deadline) && deadline <= now;
}

/** Whole days from today to the due day (0 = today, 1 = tomorrow, -1 = yesterday) */
export function daysUntilDue(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((day - today) / 86400000);
}

/** "Today", "Tomorrow", "Yesterday", "Mon 20 Oct", "20 Oct 2027", plus ", 3:00 PM" when there's a time */
export function formatDue(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return '';
  const diff = daysUntilDue(date, now);
  let label;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff === -1) label = 'Yesterday';
  else {
    label = date.toLocaleDateString(undefined, {
      ...(Math.abs(diff) < 7 ? { weekday: 'short' } : {}),
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  }
  if (!isAllDay(date)) {
    label += `, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return label;
}
