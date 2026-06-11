/**
 * crm/modules/ui/mobile-optimize.js
 *
 * Production-grade mobile optimizations for SafiTrack CRM
 * Handles: viewport optimization, safe area detection, iOS fixes,
 * keyboard handling, and performance optimizations.
 *
 * NOTE: Does NOT override existing mobile.css styles - only enhances them
 */

// ──────────────────────────────────────────────────────────────────────────────
// 1. VIEWPORT & DEVICE DETECTION
// ──────────────────────────────────────────────────────────────────────────────

const isMobileViewport = () => window.innerWidth < 768;
const isTabletViewport = () => window.innerWidth >= 768 && window.innerWidth < 1024;
const isLargeViewport = () => window.innerWidth >= 1024;
const isPortrait = () => window.innerHeight > window.innerWidth;
const isLandscape = () => window.innerWidth > window.innerHeight;
const hasNotch = () => CSS.supports('padding: max(0px)');
const isTouchDevice = () => {
  return (
    ('ontouchstart' in window) ||
    (navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints > 0)
  );
};

// ──────────────────────────────────────────────────────────────────────────────
// 2. SAFE AREA HANDLING FOR NOTCH DEVICES
// ──────────────────────────────────────────────────────────────────────────────

function initializeSafeArea() {
  if (!hasNotch()) return;

  const html = document.documentElement;
  const safeTop = getComputedStyle(html).getPropertyValue('env(safe-area-inset-top)');
  const safeBottom = getComputedStyle(html).getPropertyValue('env(safe-area-inset-bottom)');
  const safeLeft = getComputedStyle(html).getPropertyValue('env(safe-area-inset-left)');
  const safeRight = getComputedStyle(html).getPropertyValue('env(safe-area-inset-right)');

  // Store in CSS variables
  html.style.setProperty('--safe-area-inset-top', safeTop || '0');
  html.style.setProperty('--safe-area-inset-bottom', safeBottom || '0');
  html.style.setProperty('--safe-area-inset-left', safeLeft || '0');
  html.style.setProperty('--safe-area-inset-right', safeRight || '0');
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. PREVENT ZOOM ON INPUT FOCUS (iOS)
// ──────────────────────────────────────────────────────────────────────────────

function preventIOSZoom() {
  if (!isMobileViewport()) return;

  const inputs = document.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    const fontSize = window.getComputedStyle(input).fontSize;
    if (parseInt(fontSize) < 16) {
      input.style.fontSize = '16px';
    }
  });

  // Observe new inputs
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
          node.style.fontSize = '16px';
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. PREVENT DOUBLE TAP ZOOM
// ──────────────────────────────────────────────────────────────────────────────

function preventDoubleTapZoom() {
  if (!isMobileViewport() || !isTouchDevice()) return;

  let lastTapTime = 0;
  document.addEventListener('touchend', e => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTapTime;
    if (tapLength < 300 && tapLength > 0) {
      e.preventDefault();
    }
    lastTapTime = currentTime;
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. VIEWPORT HEIGHT FIX (100vh bug on mobile browsers)
// ──────────────────────────────────────────────────────────────────────────────

function fixViewportHeight() {
  if (!isMobileViewport()) return;

  function setViewportHeight() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  }

  setViewportHeight();
  window.addEventListener('resize', setViewportHeight, { passive: true });
  window.addEventListener('orientationchange', setViewportHeight, { passive: true });

  return () => window.removeEventListener('resize', setViewportHeight);
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. HANDLE ORIENTATION CHANGE
// ──────────────────────────────────────────────────────────────────────────────

function handleOrientationChange() {
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      document.querySelectorAll('.modal-container.active').forEach(modal => {
        modal.scrollTop = 0;
      });
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }, { passive: true });
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. KEYBOARD HANDLING & INPUT MANAGEMENT
// ──────────────────────────────────────────────────────────────────────────────

function initKeyboardHandling() {
  if (!isMobileViewport()) return;

  document.addEventListener('focusin', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      setTimeout(() => {
        e.target.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 300);
    }
  }, { passive: true });
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. SMOOTH SCROLLING & MOMENTUM
// ──────────────────────────────────────────────────────────────────────────────

function initSmoothScrolling() {
  if (!isMobileViewport()) return;

  const scrollables = document.querySelectorAll('[overflow-y="auto"], .scrollable, .modal-body');
  scrollables.forEach(el => {
    el.style.webkitOverflowScrolling = 'touch';
  });

  const observer = new MutationObserver(() => {
    const newScrollables = document.querySelectorAll('[overflow-y="auto"]:not([data-scrolling-init])');
    newScrollables.forEach(el => {
      el.style.webkitOverflowScrolling = 'touch';
      el.setAttribute('data-scrolling-init', 'true');
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

// ──────────────────────────────────────────────────────────────────────────────
// 9. MAIN INITIALIZATION
// ──────────────────────────────────────────────────────────────────────────────

export function initMobileOptimizations() {
  if (!isMobileViewport()) {
    console.log('📱 Desktop viewport, skipping mobile optimizations');
    return;
  }

  console.log('📱 Mobile optimizations initializing...');

  // Initialize all mobile features
  initializeSafeArea();
  preventIOSZoom();
  fixViewportHeight();
  handleOrientationChange();
  initKeyboardHandling();
  preventDoubleTapZoom();
  initSmoothScrolling();

  console.log('✅ Mobile optimizations complete');
}

// ──────────────────────────────────────────────────────────────────────────────
// 10. EXPORT UTILITY FUNCTIONS
// ──────────────────────────────────────────────────────────────────────────────

export {
  isMobileViewport,
  isTabletViewport,
  isLargeViewport,
  isPortrait,
  isLandscape,
  hasNotch,
  isTouchDevice,
};
