// modules/ui/pwa.js
// Progressive Web App install banner.
import { state } from '../state.js';
import { showToast } from './toast.js';

// ======================
let deferredPrompt;

function initPWA() {
  // Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .catch(err => console.error('SW: Registration failed', err));
    });

    // Handle messages from the service worker (e.g. notification click navigation)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type !== 'NAVIGATE' || !event.data.view) return;
      if (window.navigateView) {
        window.navigateView(event.data.view);
        return;
      }
      if (window.loadView) {
        window.loadView(event.data.view);
      }
    });
  }

  const installBtn = document.getElementById('pwa-install-btn');

  // Listen for the install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Show menu button always (non-intrusive)
    if (installBtn) installBtn.style.display = 'flex';

    // Attempt showing banner (checks onboarding)
    attemptShowPWABanner();
  });
}

function attemptShowPWABanner() {
  const installBanner = document.getElementById('pwa-install-banner');
  const bannerInstallBtn = document.getElementById('pwa-banner-install-btn');
  const bannerCloseBtn = document.getElementById('pwa-banner-close-btn');

  if (!deferredPrompt || !installBanner) return;

  // DON'T show if onboarding is active (wait for reload/completion)
  const hasCompletedTour = localStorage.getItem('safitrack_onboarding_completed');
  if (!hasCompletedTour) return;

  // DON'T show if user dismissed it recently
  const isBannerDismissed = localStorage.getItem('pwa_banner_dismissed');
  if (isBannerDismissed) return;

  // All checks passed, show it after a short delay
  setTimeout(() => {
    installBanner.style.display = 'block';
  }, 3000);

  const triggerInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) installBtn.style.display = 'none';
    if (installBanner) installBanner.style.display = 'none';
  };

  // Bind clicks
  bannerInstallBtn.onclick = triggerInstall;
  bannerCloseBtn.onclick = () => {
    installBanner.style.display = 'none';
    localStorage.setItem('pwa_banner_dismissed', 'true');
  };

  // Handle menu button too
  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) installBtn.onclick = triggerInstall;
}

// Log when app is successfully installed
window.addEventListener('appinstalled', (event) => {
  const installBtn = document.getElementById('pwa-install-btn');
  const installBanner = document.getElementById('pwa-install-banner');
  if (installBtn) installBtn.style.display = 'none';
  if (installBanner) installBanner.style.display = 'none';
  showToast('SafiTrack CRM installed successfully!', 'success');
});

// ======================
// CALL LOGS VIEW
// ======================


// ── Exports ────────────────────────────────────────────────────
export {
  initPWA,
  attemptShowPWABanner,
};
