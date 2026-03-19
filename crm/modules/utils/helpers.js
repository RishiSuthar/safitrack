// modules/utils/helpers.js
// Date formatting, string helpers, render helpers.
import { state } from '../state.js';

function formatDate(dateString, shortFormat = false) {
  if (!dateString) return '';

  // Safe local date parsing for YYYY-MM-DD format
  let date;
  if (typeof dateString === 'string' && dateString.length === 10 && dateString.includes('-')) {
    const [y, m, d] = dateString.split('-').map(Number);
    date = new Date(y, m - 1, d, 12, 0, 0); // Midday local
  } else {
    date = new Date(dateString);
  }

  const pref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');

  if (shortFormat) {
    if (pref === 'MM/DD/YYYY') {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
  }

  // Long format with time
  const timePart = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (pref === 'MM/DD/YYYY') {
    const d = String(date.getMonth() + 1).padStart(2, '0');
    const m = String(date.getDate()).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y} ${timePart}`;
  }
  // default DD/MM/YYYY
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy} ${timePart}`;
}

/**
 * Geocode an address using OpenStreetMap (Nominatim) API
 * @param {string} address - The address to search for
 * @returns {Promise<Object>} - Object containing latitude, longitude, and display name
 */
async function geocodeAddressWithOSM(address) {
  try {
    // URL encode the address to handle spaces and special characters
    const encodedAddress = encodeURIComponent(address);

    // Nominatim Search Endpoint
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SafiTrack-CRM/1.0' // User-Agent is recommended to avoid blocking
      }
    });

    if (!response.ok) {
      // Handle rate limits (HTTP 429)
      if (response.status === 429) {
        throw new Error('Too many requests. Please wait a moment.');
      }
      throw new Error('Geocoding service unavailable. Please enter coordinates manually.');
    }

    const data = await response.json();

    // Check if we got results back
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error('Address not found. Please try a more specific address or enter coordinates manually.');
    }

    // Extract the first (most relevant) result
    const result = data[0];

    return {
      latitude: parseFloat(result.lat),
      longitude: parseFloat(result.lon),
      displayName: result.display_name || address
    };

  } catch (error) {
    console.error('Geocoding error:', error);
    throw new Error(error.message || 'Geocoding failed. Please enter coordinates manually.');
  }
}




// Replace the existing calculateDistance function with this improved version
function getDisplayNameFromProfile(profileLike) {
  if (!profileLike) return 'Teammate';
  const first = String(profileLike.first_name || '').trim();
  const last = String(profileLike.last_name || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  return String(profileLike.email || 'Teammate');
}

function getLeadScoreBadge(score) {
  let className = 'low';
  let label = 'Low';

  if (score >= 70) {
    className = 'high';
    label = 'High';
  } else if (score >= 40) {
    className = 'medium';
    label = 'Medium';
  }

  return `<span class="lead-score-badge ${className}"> Lead Score : <i data-lucide="target" style="width:14px; height:14px; vertical-align:middle;"></i> ${label}(${score}%)</span>`;
}

function parseMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}



function renderSkeletonCards(count = 3) {
  let html = '';

  // UPDATE: Add data-hide-scrollbar to the first div
  html += `<div class="page-header" data-hide-scrollbar>
    <h1 class="page-title">Loading...</h1>
  </div>`; // Make sure this div closes! 

  // ... rest of the function remains the same
  for (let i = 0; i < count; i++) {
    html += `
      <div class="card">
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text short"></div>
      </div>
    `;
  }

  return html;
}

function renderError(message) {
  return `
    <div class="card">
      <div class="empty-state empty-state-alert">
        <i data-lucide="alert-circle" class="empty-state-icon text-danger"></i>
        <h3 class="empty-state-title">Error</h3>
        <p class="empty-state-description">${message}</p>
      </div>
    </div>
  `;
}

function renderAccessDenied() {
  return `
    <div class="card">
      <div class="empty-state empty-state-alert">
        <i data-lucide="lock" class="empty-state-icon"></i>
        <h3 class="empty-state-title">Access Denied</h3>
        <p class="empty-state-description">You don't have permission to view this page.</p>
      </div>
    </div>
  `;
}

function renderNotFound() {
  return `
    <div class="card">
      <div class="empty-state empty-state-alert">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-state-icon"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
        <h3 class="empty-state-title">Not Found</h3>
        <p class="empty-state-description">The requested page does not exist.</p>
      </div>
    </div>
  `;
}

// Tags functions
window.addTag = function (tag) {
  if (!state.visitTags.includes(tag)) {
    state.visitTags.push(tag);
    renderTags();
  }
};

window.removeTag = function (tag) {
  state.visitTags = state.visitTags.filter(t => t !== tag);
  renderTags();
};

function renderTags() {
  const container = document.getElementById('tags-container');
  if (!container) return;

  const tagsHTML = state.visitTags.map(tag => `
    <span class="tag">
      ${tag}
      <button class="tag-remove" onclick="removeTag('${tag}')">×</button>
    </span>
  `).join('');

  container.innerHTML = tagsHTML + `<input type="text" class="tags-input" id="tags-input" placeholder="Add tags...">`;

  const newInput = document.getElementById('tags-input');
  newInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && newInput.value.trim()) {
      e.preventDefault();
      addTag(newInput.value.trim());
      newInput.value = '';
    }
  });
}

// ======================
// CUSTOM CONFIRM DIALOG
// ======================



// ── Currency helpers ──────────────────────────────────────────────────────────

/** Top currencies shown in the org currency picker. */
export const CURRENCIES = [
  { code: 'USD', symbol: '$',    name: 'US Dollar' },
  { code: 'EUR', symbol: '€',    name: 'Euro' },
  { code: 'GBP', symbol: '£',    name: 'British Pound' },
  { code: 'KES', symbol: 'Ksh',  name: 'Kenyan Shilling' },
  { code: 'NGN', symbol: '₦',    name: 'Nigerian Naira' },
  { code: 'ZAR', symbol: 'R',    name: 'South African Rand' },
  { code: 'GHS', symbol: 'GH₵',  name: 'Ghanaian Cedi' },
  { code: 'UGX', symbol: 'USh',  name: 'Ugandan Shilling' },
  { code: 'TZS', symbol: 'TSh',  name: 'Tanzanian Shilling' },
  { code: 'INR', symbol: '₹',    name: 'Indian Rupee' },
  { code: 'JPY', symbol: '¥',    name: 'Japanese Yen' },
  { code: 'CNY', symbol: 'CN¥',  name: 'Chinese Yuan' },
  { code: 'AED', symbol: 'AED',  name: 'UAE Dirham' },
  { code: 'CAD', symbol: 'CA$',  name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$',   name: 'Australian Dollar' },
  { code: 'CHF', symbol: 'CHF',  name: 'Swiss Franc' },
  { code: 'BRL', symbol: 'R$',   name: 'Brazilian Real' },
  { code: 'MXN', symbol: 'MX$',  name: 'Mexican Peso' },
  { code: 'SGD', symbol: 'S$',   name: 'Singapore Dollar' },
  { code: 'SAR', symbol: 'SAR',  name: 'Saudi Riyal' },
  { code: 'EGP', symbol: 'E£',   name: 'Egyptian Pound' },
  { code: 'MAD', symbol: 'MAD',  name: 'Moroccan Dirham' },
  { code: 'ETB', symbol: 'Br',   name: 'Ethiopian Birr' },
  { code: 'XOF', symbol: 'CFA',  name: 'West African CFA' },
  { code: 'ZMW', symbol: 'ZK',   name: 'Zambian Kwacha' },
];

/**
 * Returns the currency symbol for the organisation's chosen currency.
 * Falls back to the currency code if no symbol is defined.
 */
export function getCurrencySymbol() {
  const code = state.orgCurrency || 'USD';
  const found = CURRENCIES.find(c => c.code === code);
  return found ? found.symbol : code;
}

/**
 * Format a numeric value with the org currency symbol.
 * e.g. formatCurrency(50000) → "$ 50,000" or "Ksh 50,000"
 */
export function formatCurrency(value) {
  const num = parseFloat(value) || 0;
  return `${getCurrencySymbol()} ${num.toLocaleString()}`;
}

// ── Exports ────────────────────────────────────────────────────
export {
  formatDate,
  getDisplayNameFromProfile,
  getLeadScoreBadge,
  parseMarkdown,
  renderSkeletonCards,
  renderError,
  renderAccessDenied,
  renderNotFound,
  renderTags,
};
