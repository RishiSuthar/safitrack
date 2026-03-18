// modules/ui/sidebar-resize.js
// Sidebar expand/collapse persistence and compression progress indicator.

// ======================
// SIDEBAR COLLAPSE LOGIC
// ======================

// ======================
// SIDEBAR COLLAPSE LOGIC (UPDATED WITH CUSTOM ICONS)
// ======================

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  if (!sidebar || !sidebarToggle) return;

  // Helper function to update the icon SVG based on sidebar state
  const updateSidebarIcon = () => {
    const isCollapsed = sidebar.classList.contains('collapsed');

    if (isCollapsed) {
      // Sidebar is HIDDEN (Collapsed): Show "Open" Icon (Arrows pointing OUT)
      sidebarToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-close-icon lucide-panel-right-close"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/></svg>`;
    } else {
      // Sidebar is VISIBLE (Expanded): Show "Close" Icon (Arrows pointing IN)
      sidebarToggle.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-open-icon lucide-panel-right-open"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/></svg>`;
    }
  };


  // Helper to force layout update
  // Helper to force layout update
  const adjustMainContent = (isCollapsed) => {
    const mainContent = document.querySelector('.main-content');
    const appHeader = document.querySelector('.app-header');
    const pageLabel = document.querySelector('.page-label');

    if (isCollapsed) {
      mainContent.style.width = 'calc(100vw - 60px)';
      mainContent.style.marginLeft = '60px';
      if (appHeader) appHeader.style.left = '60px';
      if (pageLabel) pageLabel.style.left = 'calc(60px + 12px)';
    } else {
      mainContent.style.width = '';
      mainContent.style.marginLeft = '';
      if (appHeader) appHeader.style.left = '';
      if (pageLabel) pageLabel.style.left = '';
    }
  };


  // 1. Set the correct icon immediately on page load
  updateSidebarIcon();

  // 2. Add the click listener
  // Find your existing toggle listener and update it like this:
  sidebarToggle.addEventListener('click', () => {
    // Toggle the class
    const isNowCollapsed = sidebar.classList.toggle('collapsed');

    // Update the icon
    updateSidebarIcon();

    // <--- NEW: Force layout change --->
    adjustMainContent(isNowCollapsed);

    // Save state
    localStorage.setItem('sidebarCollapsed', isNowCollapsed);
  });

  // 3. Restore state on reload
  // Restore state on load
  const sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

  if (sidebarCollapsed && window.innerWidth >= 768) {
    sidebar.classList.add('collapsed');
    updateSidebarIcon();

    // <--- NEW: Apply layout on load --->
    adjustMainContent(true);
  }

});

// Handle window resize to ensure icons stay correct if CSS forces a state change
window.addEventListener('resize', () => {
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  // If we switch to mobile, the sidebar is forced open/hidden by CSS media queries.
  // We force remove the collapsed class and reset the icon.
  if (window.innerWidth < 768) {
    sidebar.classList.remove('collapsed');
    // On mobile, the toggle button is usually hidden, but if visible:
    if (sidebarToggle) {
      sidebarToggle.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-panel-right-open-icon lucide-panel-right-open"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/></svg>`;
    }
  }
});


/**
 * Compress an image file
 * @param {File} file - The image file to compress
 * @param {number} quality - Compression quality (0.1 to 1.0)
 * @param {number} maxWidth - Maximum width (default 1200)
 * @param {number} maxHeight - Maximum height (default 1200)
 * @returns {Promise<File>} - Compressed file
 */




/**
 * Show compression progress
 * @param {string} message - Progress message
 */
function showCompressionProgress(message) {
  // Create or update progress toast
  let progressToast = document.getElementById('compression-progress-toast');

  if (!progressToast) {
    progressToast = document.createElement('div');
    progressToast.id = 'compression-progress-toast';
    progressToast.className = 'toast info';
    progressToast.style.position = 'fixed';
    progressToast.style.top = '20px';
    progressToast.style.right = '20px';
    progressToast.style.zIndex = '9999';
    document.body.appendChild(progressToast);
  }

  progressToast.innerHTML = `
    <i class="fas fa-compress fa-spin toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;

  progressToast.style.display = 'flex';
}

function hideCompressionProgress() {
  const progressToast = document.getElementById('compression-progress-toast');
  if (progressToast) {
    progressToast.style.display = 'none';
  }
}

// ======================
// REDESIGNED NOTES VIEW (v2)
// ======================

let currentNotesFilter = 'all';


// ── Exports ────────────────────────────────────────────────────
export {
  showCompressionProgress,
  hideCompressionProgress,
};
