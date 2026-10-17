// modules/ui/member-color.js
// One colour per team member, used for their avatar everywhere they appear
// (deals, tasks, dashboards, routes, settings, the header…). It is worked out
// from the user's id, so the same person is always the same colour on every
// page and every device, with nothing to store.

const MEMBER_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1'];

// For a name with no member behind it (a pending invite, an unknown author)
const UNKNOWN_COLOR = '#94a3b8';

/** The member's avatar colour, from their user id */
export function memberColor(userId) {
  if (!userId) return UNKNOWN_COLOR;
  let hash = 0;
  for (const ch of String(userId)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return MEMBER_COLORS[hash % MEMBER_COLORS.length];
}

/** Inline style for an initials avatar: the member's colour with white text */
export function memberAvatarStyle(userId) {
  return `background:${memberColor(userId)};color:#fff`;
}
