// modules/ui/changelog.js
// "What's New" changelog modal.
//
// How it works:
//   - On each login, compares APP_CONFIG.VERSION against localStorage key
//     'safitrack_seen_version'. If the version is new (or unseen), shows the modal.
//   - Only shows entries newer than what the user last saw, so they don't
//     re-read old releases.
//   - Call showChangelogModal() from anywhere to re-open it (e.g. Settings page).

const STORAGE_KEY = 'safitrack_seen_version';
const MODAL_ID    = 'changelog-modal';

// ─────────────────────────────────────────────────────────────
// Semver comparison helper: returns true if `a` > `b`
// ─────────────────────────────────────────────────────────────
function isNewer(a, b) {
  const parse = v => (v || '0.0.0').split('.').map(Number);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPat > bPat;
}

// ─────────────────────────────────────────────────────────────
// Build the modal DOM and inject it into <body>
// ─────────────────────────────────────────────────────────────
function buildModal(entries) {
  // Remove any stale instance
  document.getElementById(MODAL_ID)?.remove();

  const tagMeta = {
    new:      { label: 'New',      cls: 'cl-tag--new'      },
    improved: { label: 'Improved', cls: 'cl-tag--improved' },
    fixed:    { label: 'Fixed',    cls: 'cl-tag--fixed'    },
  };

  const sectionsHTML = entries.map(release => {
    const itemsHTML = release.items.map(item => {
      const { label, cls } = tagMeta[item.type] || tagMeta.new;
      return `
        <li class="cl-item">
          <span class="cl-tag ${cls}">${label}</span>
          <span class="cl-item-text">${escapeHtml(item.text)}</span>
        </li>`;
    }).join('');

    return `
      <div class="cl-release">
        <div class="cl-release-header">
          <span class="cl-version">v${escapeHtml(release.version)}</span>
          <span class="cl-date">${escapeHtml(release.date)}</span>
        </div>
        <ul class="cl-items">${itemsHTML}</ul>
      </div>`;
  }).join('');

  const modalHTML = `
    <div id="${MODAL_ID}" class="cl-backdrop" role="dialog" aria-modal="true" aria-labelledby="cl-title">
      <div class="cl-modal">
        <div class="cl-header">
          <div class="cl-header-icon">
            <img src="../assets/icons/transparentdark.png" alt="SafiTrack" style="width:26px;height:26px;object-fit:contain;">
          </div>
          <div class="cl-header-text">
            <h2 id="cl-title" class="cl-title">What's New</h2>
            <p class="cl-subtitle">Here's what we shipped in SafiTrack</p>
          </div>
          <button class="cl-close" id="cl-close-btn" aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="cl-body">
          ${sectionsHTML}
        </div>

        <div class="cl-footer">
          <button class="cl-btn-primary" id="cl-dismiss-btn">Got it — let's go</button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modal     = document.getElementById(MODAL_ID);
  const dismissFn = () => hideChangelogModal();

  document.getElementById('cl-dismiss-btn').addEventListener('click', dismissFn);
  document.getElementById('cl-close-btn').addEventListener('click', dismissFn);

  // Close on backdrop click
  modal.addEventListener('click', e => {
    if (e.target === modal) dismissFn();
  });

  // Close on Escape
  const keyHandler = e => {
    if (e.key === 'Escape') { dismissFn(); document.removeEventListener('keydown', keyHandler); }
  };
  document.addEventListener('keydown', keyHandler);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─────────────────────────────────────────────────────────────
// Show / hide
// ─────────────────────────────────────────────────────────────
export function showChangelogModal(forceAll = false) {
  const config    = window.APP_CONFIG || {};
  const changelog = config.CHANGELOG;

  if (!changelog?.length) return;

  let entries = changelog;

  if (!forceAll) {
    const seenVersion = localStorage.getItem(STORAGE_KEY) || '0.0.0';
    entries = changelog.filter(r => isNewer(r.version, seenVersion));
    if (!entries.length) return; // nothing new
  }

  buildModal(entries);

  // Animate in on next frame
  requestAnimationFrame(() => {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.add('cl-visible');
  });
}

export function hideChangelogModal() {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;

  // Mark current version as seen
  const version = window.APP_CONFIG?.VERSION;
  if (version) localStorage.setItem(STORAGE_KEY, version);

  modal.classList.remove('cl-visible');
  modal.classList.add('cl-hiding');
  setTimeout(() => modal.remove(), 280);
}

// ─────────────────────────────────────────────────────────────
// Auto-check on app boot (called from app-init.js)
// ─────────────────────────────────────────────────────────────
export function checkAndShowChangelog() {
  const config  = window.APP_CONFIG || {};
  const current = config.VERSION;
  const seen    = localStorage.getItem(STORAGE_KEY) || '0.0.0';

  if (isNewer(current, seen)) {
    // Slight delay so the app finishes rendering first
    setTimeout(() => showChangelogModal(), 900);
  }
}
