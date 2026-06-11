/**
 * modules/ui/mobile-navigation.js
 *
 * Mobile-specific navigation handling
 * - Sidebar menu toggle for mobile
 * - Back gesture handling
 * - Touch-friendly menu interactions
 */

import { el } from './dom.js';

// ──────────────────────────────────────────────────────────────────────────────
// MOBILE SIDEBAR MANAGEMENT
// ──────────────────────────────────────────────────────────────────────────────

let mobileMenuOpen = false;
let touchStartX = 0;
let touchEndX = 0;

/**
 * Open mobile sidebar menu
 */
export function openMobileSidebar() {
  const sidebar = el('sidebar');
  const overlay = el('sidebar-overlay');

  if (!sidebar) return;

  sidebar.classList.add('open');
  if (overlay) overlay.classList.add('open');
  mobileMenuOpen = true;

  // Prevent body scroll when menu is open
  document.body.style.overflow = 'hidden';
  document.body.style.paddingRight = '0';

  // Add escape key listener
  const handleEscape = e => {
    if (e.key === 'Escape') {
      closeMobileSidebar();
      document.removeEventListener('keydown', handleEscape);
    }
  };

  document.addEventListener('keydown', handleEscape);
}

/**
 * Close mobile sidebar menu
 */
export function closeMobileSidebar() {
  const sidebar = el('sidebar');
  const overlay = el('sidebar-overlay');

  if (!sidebar) return;

  sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
  mobileMenuOpen = false;

  // Restore body scroll
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
}

/**
 * Toggle mobile sidebar menu
 */
export function toggleMobileSidebar() {
  if (mobileMenuOpen) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

/**
 * Check if mobile sidebar is open
 */
export function isMobileSidebarOpen() {
  return mobileMenuOpen;
}

// ──────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS SETUP
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Initialize mobile navigation event listeners
 */
export function initMobileNavigation() {
  const mobileMenuToggle = el('mobile-menu-toggle');
  const mobileMenuToggleOld = el('mobile-menu-btn'); // Fallback ID
  const sidebarOverlay = el('sidebar-overlay');
  const sidebarClose = el('sidebar-close');
  const navItems = document.querySelectorAll('.sidebar-nav a, .nav-item');

  // Mobile menu toggle button
  if (mobileMenuToggle) {
    mobileMenuToggle.addEventListener('click', e => {
      e.stopPropagation();
      toggleMobileSidebar();
    });
  } else if (mobileMenuToggleOld) {
    mobileMenuToggleOld.addEventListener('click', e => {
      e.stopPropagation();
      toggleMobileSidebar();
    });
  }

  // Sidebar overlay click to close
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', closeMobileSidebar);
  }

  // Sidebar close button
  if (sidebarClose) {
    sidebarClose.addEventListener('click', e => {
      e.stopPropagation();
      closeMobileSidebar();
    });
  }

  // Navigation items close menu after click
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      closeMobileSidebar();
    });
  });

  // Swipe gestures for sidebar
  initSwipeGestures();

  // Keyboard navigation
  initKeyboardNavigation();
}

// ──────────────────────────────────────────────────────────────────────────────
// SWIPE GESTURE DETECTION
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Initialize swipe gestures for mobile menu
 */
function initSwipeGestures() {
  const MIN_SWIPE_DISTANCE = 50;

  document.addEventListener('touchstart', e => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    touchEndX = e.changedTouches[0].screenX;
    handleSwipe();
  }, { passive: true });

  function handleSwipe() {
    const swipeDistance = touchEndX - touchStartX;
    const isHorizontalSwipe = Math.abs(swipeDistance) > MIN_SWIPE_DISTANCE;

    if (!isHorizontalSwipe) return;

    // Swipe right: open sidebar
    if (swipeDistance > 0 && touchStartX < 30 && !mobileMenuOpen) {
      openMobileSidebar();
    }

    // Swipe left: close sidebar
    if (swipeDistance < 0 && mobileMenuOpen) {
      closeMobileSidebar();
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// KEYBOARD NAVIGATION
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Initialize keyboard navigation for mobile menu
 */
function initKeyboardNavigation() {
  document.addEventListener('keydown', e => {
    // Hamburger menu button for accessibility
    if (e.altKey && e.key === 'm') {
      toggleMobileSidebar();
    }

    // Close with Escape
    if (e.key === 'Escape' && mobileMenuOpen) {
      closeMobileSidebar();
    }
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// RESPONSIVE BEHAVIOR
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Handle viewport resize
 */
export function handleViewportResize() {
  // Close sidebar if viewport becomes large enough
  if (window.innerWidth >= 768) {
    closeMobileSidebar();
  }
}

// Listen for resize events
window.addEventListener('resize', handleViewportResize, { passive: true });

// ──────────────────────────────────────────────────────────────────────────────
// MODAL DETECTION FOR SIDEBAR
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Close sidebar when modal opens
 */
export function closeSidebarOnModal() {
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      const modals = document.querySelectorAll('.modal-container.active');
      if (modals.length > 0 && mobileMenuOpen) {
        closeMobileSidebar();
      }
    });
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  });

  return () => observer.disconnect();
}
