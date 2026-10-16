// modules/utils/due-dates.js
// Due dates for tasks come in two kinds:
//
// - All day (tasks.due_all_day = true): due on a calendar date, the same date
//   whatever the viewer's timezone. due_date holds UTC midnight of that date
//   ("2026-10-20T00:00:00Z"). It is due all that day and only becomes overdue
//   once the day is over where the viewer is.
// - Timed (due_all_day = false): due at the instant in due_date, shown in the
//   viewer's local time.
//
// Every helper takes the stored value plus the all-day flag. When the flag is
// unknown (null / undefined: rows from before the column existed), a
// due time of exactly local midnight counts as all day.

const pad2 = (n) => String(n).padStart(2, '0');

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLocalMidnight(date) {
  return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
}

/** { allDay, date }: for an all-day due date, `date` is local midnight of its calendar day */
function resolveDue(value, allDay) {
  const date = toDate(value);
  if (!date) return null;
  if (allDay === true) {
    // A plain "2026-10-20" or a stored UTC midnight: the calendar date is the UTC date
    return { allDay: true, date: new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) };
  }
  if (allDay === false) return { allDay: false, date };
  if (isLocalMidnight(date)) return { allDay: true, date };
  return { allDay: false, date };
}

export function isAllDay(value, allDay) {
  return Boolean(resolveDue(value, allDay)?.allDay);
}

/** The due day as "2026-10-20": the calendar date for all-day, the local day for timed */
export function dueDay(value, allDay) {
  const due = resolveDue(value, allDay);
  if (!due) return '';
  return `${due.date.getFullYear()}-${pad2(due.date.getMonth() + 1)}-${pad2(due.date.getDate())}`;
}

/** When the task falls due on this device's clock: local midnight of the day for all-day */
export function dueStart(value, allDay) {
  return resolveDue(value, allDay)?.date || null;
}

/** The moment a due date has passed: the end of the local day for all-day dates */
export function dueDeadline(value, allDay) {
  const due = resolveDue(value, allDay);
  if (!due) return null;
  const deadline = new Date(due.date);
  if (due.allDay) deadline.setDate(deadline.getDate() + 1);
  return deadline;
}

export function isPastDue(value, allDay, now = new Date()) {
  const deadline = dueDeadline(value, allDay);
  return Boolean(deadline) && deadline <= now;
}

/** Whole days from today to the due day (0 = today, 1 = tomorrow, -1 = yesterday) */
export function daysUntilDue(value, allDay, now = new Date()) {
  const due = resolveDue(value, allDay);
  if (!due) return null;
  const day = new Date(due.date);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((day - today) / 86400000);
}

/** "Today", "Tomorrow", "Yesterday", "Mon 20 Oct", "20 Oct 2027", plus ", 3:00 PM" when there's a time */
export function formatDue(value, allDay, now = new Date()) {
  const due = resolveDue(value, allDay);
  if (!due) return '';
  const { date } = due;
  const diff = daysUntilDue(value, allDay, now);
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
  if (!due.allDay) {
    label += `, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return label;
}

// ── Saving ────────────────────────────────────────────────────────────────────

/** Columns for a task due on a day ("2026-10-20"), or no due date */
export function allDayDueFields(day) {
  return day
    ? { due_date: `${String(day).slice(0, 10)}T00:00:00.000Z`, due_all_day: true }
    : { due_date: null, due_all_day: false };
}

/** Columns for a date picker value: "2026-10-20" is all day, "2026-10-20T15:00" (local time) is timed */
export function dueFieldsFromPicker(value) {
  if (!value) return { due_date: null, due_all_day: false };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return allDayDueFields(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? { due_date: null, due_all_day: false }
    : { due_date: date.toISOString(), due_all_day: false };
}

/** The date picker's value for a due date: "2026-10-20" for all day, "2026-10-20T15:00" for timed */
export function duePickerValue(value, allDay) {
  const due = resolveDue(value, allDay);
  if (!due) return '';
  const day = dueDay(value, allDay);
  return due.allDay ? day : `${day}T${pad2(due.date.getHours())}:${pad2(due.date.getMinutes())}`;
}
