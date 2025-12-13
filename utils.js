// Simple Markdown parser for AI insights
function parseMarkdown(text) {
  if (!text) return '';
  
  text = text.replace(/^### (.*$)/gim, '<h4>$1</h4>');
  text = text.replace(/^## (.*$)/gim, '<h3>$1</h3>');
  text = text.replace(/^# (.*$)/gim, '<h2>$1</h2>');
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/^\* (.+)$/gim, '<li>$1</li>');
  text = text.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
  text = text.replace(/\n/g, '<br>');
  
  return text;
}

// SHOW TOAST
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div>${message}</div>
    <button class="icon-btn" onclick="this.parentElement.remove()">✕</button>
  `;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 3000);
}

// COPY TO CLIPBOARD
function copyToClipboard(element) {
  const el = typeof element === 'string' ? document.getElementById(element) : element;
  const text = el.innerText || el.textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('✅ Copied to clipboard!', 'success');
  }).catch(err => {
    console.error('Could not copy text: ', err);
    showToast('Failed to copy to clipboard', 'error');
  });
}

// DEBOUNCE FUNCTION
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// FORMAT DATE
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  
  return date.toLocaleDateString();
}

// GENERATE RANDOM COLOR
function generateColor(seed) {
  const colors = [
    '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#14b8a6'
  ];
  
  const index = Math.abs(hashCode(seed)) % colors.length;
  return colors[index];
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

// VALIDATE EMAIL
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// CALCULATE DISTANCE (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}