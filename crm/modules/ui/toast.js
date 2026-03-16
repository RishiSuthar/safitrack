// modules/ui/toast.js
// Toast notifications, inline success, confetti, initials helper.

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function showInlineSuccess(elementOrSelector) {
  const element = typeof elementOrSelector === 'string'
    ? document.querySelector(elementOrSelector)
    : elementOrSelector;
  if (!element) return;

  element.classList.remove('ui-success-flash');
  void element.offsetWidth;
  element.classList.add('ui-success-flash');
  setTimeout(() => element.classList.remove('ui-success-flash'), 850);
}

function showToast(message, type = 'info', options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) return;

  const now = Date.now();
  const toastKey = `${type}:${normalizedMessage.toLowerCase()}`;
  const dedupeMs = Number.isFinite(options.dedupeMs)
    ? options.dedupeMs
    : (type === 'success' ? 1800 : 1200);

  if ((type === 'success' || type === 'info') &&
    state.lastToastMeta.key === toastKey &&
    now - state.lastToastMeta.at < dedupeMs) {
    return;
  }

  const maxVisible = Number.isFinite(options.maxVisible)
    ? options.maxVisible
    : 2;
  if ((type === 'success' || type === 'info') && container.children.length >= maxVisible) {
    const removableToast = container.querySelector('.toast:not(.error)') || container.firstElementChild;
    if (removableToast) removableToast.remove();
  }

  state.lastToastMeta.key = toastKey;
  state.lastToastMeta.at = now;

  const toast = document.createElement('div');
  const isSubtle = options.subtle === true || type === 'success';
  toast.className = `toast ${type}${isSubtle ? ' subtle' : ''}`;

  const iconMap = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    info: 'fa-info-circle'
  };

  toast.innerHTML = `
    <i class="fas ${iconMap[type] || iconMap.info} toast-icon"></i>
    <span class="toast-message">${normalizedMessage}</span>
  `;

  container.appendChild(toast);

  const timeoutMs = Number.isFinite(options.duration)
    ? options.duration
    : (type === 'success' ? 1800 : type === 'info' ? 2300 : 3200);
  toast.style.setProperty('--toast-timeout', `${Math.max(900, timeoutMs)}ms`);

  setTimeout(() => {
    toast.remove();
  }, Math.max(900, timeoutMs) + 120);
}

// Try to repair broken image links from Supabase storage by requesting a signed URL
async function handleImageError(img) {
  try {
    // Prevent retry loops
    if (img.dataset._tried) return;
    img.dataset._tried = '1';

    const src = img.src || '';
    const bucketMarker = '/safitrack/';
    const idx = src.indexOf(bucketMarker);
    if (idx === -1) {
      img.onerror = null;
      img.src = '../assets/illustrations/image-missing.png';
      return;
    }

    const storagePath = decodeURIComponent(src.substring(idx + bucketMarker.length));

    const { data, error } = await supabaseClient.storage.from('safitrack').createSignedUrl(storagePath, 60);
    if (!error && data && data.signedUrl) {
      img.onerror = null;
      img.src = data.signedUrl;
      return;
    }

    img.onerror = null;
    img.src = '../assets/illustrations/image-missing.png';
  } catch (err) {
    console.error('handleImageError failed', err);
    img.onerror = null;
    img.src = '../assets/illustrations/image-missing.png';
  }
}

function triggerConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
    });
  }
}

function getInitials(name) {
  return name
    .split(' ')
    .map(n => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}



// ── Exports ────────────────────────────────────────────────────
export {
  escapeHtml,
  showInlineSuccess,
  showToast,
  handleImageError,
  triggerConfetti,
  getInitials,
};
