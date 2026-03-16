// modules/ui/dom.js
// Cached DOM element references shared across all modules.
// Queried lazily to survive any dynamic insertion of elements.

function el(id) {
  return document.getElementById(id);
}

// ── Layout / screens ─────────────────────────────────────────────────────────
export const loadingScreen       = el('loading-screen');
export const authScreen          = el('auth-screen');
export const mainApp             = el('main-app');
export const viewContainer       = el('view-container');

// ── Sidebar ───────────────────────────────────────────────────────────────────
export const sidebar             = el('sidebar');
export const sidebarOverlay      = el('sidebar-overlay');
export const mobileMenuToggle    = el('mobile-menu-toggle');
export const sidebarClose        = el('sidebar-close');

// ── Page label (shown next to collapsed sidebar icon) ─────────────────────────
export const pageLabel           = el('page-label');
export const pageLabelIcon       = el('page-label-icon');
export const pageLabelText       = el('page-label-text');

// ── Top-bar controls ────────────────────────────────────────────────────────
export const logoutBtn           = el('logout-btn');
export const userAvatarBtn       = el('user-avatar-btn');
export const userMenu            = el('user-menu');
export const commandPaletteBtn   = el('command-palette-btn');
export const commandPalette      = el('command-palette');

// ── Notification centre ───────────────────────────────────────────────────────
export const notificationsBtn        = el('notifications-btn');
export const notificationsMenu       = el('notifications-menu');
export const notificationsCount      = el('notifications-count');
export const notificationsList       = el('notifications-list');
export const notificationsEnableBtn  = el('enable-notifications-btn');
export const safiNudgeLauncher       = el('safi-nudge-launcher');
