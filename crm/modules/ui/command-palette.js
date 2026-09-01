// modules/ui/command-palette.js
// Quick Actions (⌘K / Ctrl+K) and Search Records (/) modals.
import { state, supabaseClient } from '../state.js';
import { navigateView } from '../core/router.js';

// ═══════════════════════════════════════════════════════════════
//  QUICK ACTIONS  (⌘K / Ctrl+K)
// ═══════════════════════════════════════════════════════════════
const quickActions = [
  { id: 'search-records', title: 'Search records', icon: 'search', shortcut: '/', action: () => { closeQuickActions(); openSearchRecords(); } },
  { id: 'create-task', title: 'Create task', icon: 'check-square', shortcut: 'T', action: () => { closeQuickActions(); navigateView('tasks'); setTimeout(() => window.openTaskModal?.(), 200); } },
  { id: 'create-reminder', title: 'Create reminder', icon: 'bell', shortcut: '', action: () => { closeQuickActions(); navigateView('reminders'); setTimeout(() => window.openReminderModal?.(), 200); } },
  { id: 'create-note', title: 'Create note', icon: 'file-text', shortcut: 'N', action: () => { closeQuickActions(); navigateView('notes'); setTimeout(() => window.createNewNoteV2?.(), 200); } },
  { id: 'log-visit', title: 'Log visit', icon: 'clipboard', shortcut: '', action: () => { closeQuickActions(); navigateView('log-visit'); } },
  { id: 'settings', title: 'Open account settings', icon: 'settings', shortcut: '', action: () => { closeQuickActions(); navigateView('settings'); } },
  { id: 'add-company', title: 'Add Company', icon: 'building', shortcut: '', action: () => { closeQuickActions(); navigateView('companies'); setTimeout(() => window.openCompanyModal?.(), 200); } },
  { id: 'add-person', title: 'Add Person', icon: 'user-plus', shortcut: '', action: () => { closeQuickActions(); navigateView('people'); setTimeout(() => window.openPersonModal?.(), 200); } },
  { id: 'add-deal', title: 'Add Deal', icon: 'dollar-sign', shortcut: '', action: () => { closeQuickActions(); navigateView('opportunity-pipeline'); setTimeout(() => window.openOpportunityModal?.(), 200); } },
  { id: 'toggle-theme', title: 'Toggle Theme', icon: 'moon', shortcut: '', action: () => { closeQuickActions(); window.toggleTheme?.(); } },
  { id: 'sign-out', title: 'Sign Out', icon: 'log-out', shortcut: '', action: () => { closeQuickActions(); window.handleLogout?.(); } },
];

const qaIcons = {
  'search': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>',
  'check-square': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>',
  'bell': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"/></svg>',
  'file-text': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  'clipboard': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
  'settings': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg>',
  'building': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>',
  'user-plus': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>',
  'dollar-sign': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>',
  'moon': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  'log-out': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>',
};

let qaActiveIndex = 0;
let qaFilteredActions = [...quickActions];

function openQuickActions() {
  const overlay = document.getElementById('quick-actions-modal');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const input = document.getElementById('qa-input');
  input.value = '';
  qaFilteredActions = [...quickActions];
  qaActiveIndex = 0;
  renderQuickActionResults();
  requestAnimationFrame(() => input.focus());
}

function closeQuickActions() {
  const overlay = document.getElementById('quick-actions-modal');
  if (overlay) overlay.style.display = 'none';
}

function renderQuickActionResults() {
  const container = document.getElementById('qa-results');
  if (!container) return;
  if (qaFilteredActions.length === 0) {
    container.innerHTML = '<div class="qa-empty">No actions found</div>';
    return;
  }
  container.innerHTML = qaFilteredActions.map((action, i) => `
    <div class="qa-item ${i === qaActiveIndex ? 'active' : ''}" data-qa-index="${i}">
      <div class="qa-item-icon">${qaIcons[action.icon] || ''}</div>
      <span class="qa-item-title">${action.title}</span>
      ${action.shortcut ? `<kbd class="qa-item-shortcut">${action.shortcut}</kbd>` : ''}
    </div>
  `).join('');

  container.querySelectorAll('.qa-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.qaIndex, 10);
      qaFilteredActions[idx]?.action();
    });
    el.addEventListener('mouseenter', () => {
      qaActiveIndex = parseInt(el.dataset.qaIndex, 10);
      container.querySelectorAll('.qa-item').forEach((item, j) => item.classList.toggle('active', j === qaActiveIndex));
    });
  });
}

function initCommandPalette() {
  // Quick Actions input filter
  const qaInput = document.getElementById('qa-input');
  qaInput?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    qaFilteredActions = q
      ? quickActions.filter(a => a.title.toLowerCase().includes(q))
      : [...quickActions];
    qaActiveIndex = 0;
    renderQuickActionResults();
  });

  // Quick Actions keyboard navigation
  qaInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      qaActiveIndex = (qaActiveIndex + 1) % qaFilteredActions.length;
      renderQuickActionResults();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      qaActiveIndex = (qaActiveIndex - 1 + qaFilteredActions.length) % qaFilteredActions.length;
      renderQuickActionResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      qaFilteredActions[qaActiveIndex]?.action();
    }
  });

  document.querySelector('.qa-backdrop')?.addEventListener('click', closeQuickActions);

  // Set platform-dependent shortcut label
  const isMac = navigator.platform?.toUpperCase().includes('MAC') || navigator.userAgent?.includes('Mac');
  const kbdEl = document.getElementById('quick-actions-kbd');
  if (kbdEl) kbdEl.textContent = isMac ? '⌘K' : 'Ctrl K';

  // Sidebar button listeners
  document.getElementById('sidebar-quick-actions-btn')?.addEventListener('click', openQuickActions);
  document.getElementById('sidebar-search-btn')?.addEventListener('click', openSearchRecords);

  // Search Records input
  const srInput = document.getElementById('sr-input');
  srInput?.addEventListener('input', () => {
    clearTimeout(srDebounceTimer);
    const val = srInput.value;
    srDebounceTimer = setTimeout(() => searchRecords(val), 180);
  });

  // Search Records keyboard navigation
  srInput?.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (srResults.length) {
        srActiveIndex = (srActiveIndex + 1) % srResults.length;
        renderSearchResults();
        renderSearchPreview(srActiveIndex);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (srResults.length) {
        srActiveIndex = (srActiveIndex - 1 + srResults.length) % srResults.length;
        renderSearchResults();
        renderSearchPreview(srActiveIndex);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      navigateToRecord(srActiveIndex);
    }
  });

  document.querySelector('.sr-backdrop')?.addEventListener('click', closeSearchRecords);
}

// Run init when DOM is ready (handles both pre-loaded and not-yet-loaded cases)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCommandPalette);
} else {
  initCommandPalette();
}


// ═══════════════════════════════════════════════════════════════
//  SEARCH RECORDS  (/)
// ═══════════════════════════════════════════════════════════════
let srActiveIndex = 0;
let srResults = [];
let srDebounceTimer = null;

function openSearchRecords() {
  const overlay = document.getElementById('search-records-modal');
  if (!overlay) return;
  overlay.style.display = 'flex';
  const input = document.getElementById('sr-input');
  input.value = '';
  srResults = [];
  srActiveIndex = 0;
  document.getElementById('sr-results').innerHTML = '<div class="sr-empty">Type to search companies and people...</div>';
  document.getElementById('sr-preview').innerHTML = '<div class="sr-preview-empty">Select a record to preview</div>';
  requestAnimationFrame(() => input.focus());
}

function closeSearchRecords() {
  const overlay = document.getElementById('search-records-modal');
  if (overlay) overlay.style.display = 'none';
}

async function searchRecords(query) {
  if (!query || query.length < 1) {
    srResults = [];
    renderSearchResults();
    return;
  }
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const results = [];

  // Helper: every word must appear in at least one of the fields
  function matchesAll(words, ...fields) {
    const combined = fields.join(' ').toLowerCase();
    return words.every(w => combined.includes(w));
  }

  // Search companies from cached data first, then fallback to supabase
  const allCompanies = window.allCompaniesData || [];
  if (allCompanies.length) {
    allCompanies.forEach(c => {
      if (matchesAll(words, c.name || '', c.domain || '')) {
        results.push({ type: 'company', id: c.id, data: c });
      }
    });
  } else {
    try {
      const { data } = await supabaseClient
        .from('companies')
        .select('id, name, domain, city, state, country, type, categories, description')
        .or(`name.ilike.%${q}%,domain.ilike.%${q}%`)
        .eq('organization_id', state.currentOrganization?.id)
        .limit(20);
      (data || []).forEach(c => results.push({ type: 'company', id: c.id, data: c }));
    } catch (_) { /* silent */ }
  }

  // Search people
  if (state.allPeople?.length) {
    state.allPeople.forEach(p => {
      if (matchesAll(words, p.name || '', p.email || '')) {
        results.push({ type: 'person', id: p.id, data: p });
      }
    });
  } else {
    try {
      const { data } = await supabaseClient
        .from('people')
        .select('id, name, email, phone_numbers, job_title, company_id')
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
        .eq('organization_id', state.currentOrganization?.id)
        .limit(20);
      (data || []).forEach(p => results.push({ type: 'person', id: p.id, data: p }));
    } catch (_) { /* silent */ }
  }

  srResults = results.slice(0, 30);
  srActiveIndex = 0;
  renderSearchResults();
  if (srResults.length > 0) renderSearchPreview(0);
}

function renderSearchResults() {
  const container = document.getElementById('sr-results');
  const preview = document.getElementById('sr-preview');
  if (!container) return;

  if (srResults.length === 0) {
    const input = document.getElementById('sr-input');
    const hasQuery = input?.value?.trim().length > 0;
    container.innerHTML = hasQuery
      ? '<div class="sr-empty">No records found</div>'
      : '<div class="sr-empty">Type to search companies and people...</div>';
    if (preview) preview.innerHTML = '<div class="sr-preview-empty">Select a record to preview</div>';
    return;
  }

  container.innerHTML = srResults.map((r, i) => {
    const isCompany = r.type === 'company';
    const name = isCompany ? r.data.name : (r.data.name || '').trim();
    const subtitle = isCompany ? (r.data.domain || '') : (r.data.email || '');
    const badgeClass = isCompany ? 'sr-badge-company' : 'sr-badge-person';
    const badgeText = isCompany ? 'Company' : 'Person';
    const iconSvg = isCompany
      ? '<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M232 224H208V32h8a8 8 0 0 0 0-16H40a8 8 0 0 0 0 16h8v192H24a8 8 0 0 0 0 16h208a8 8 0 0 0 0-16ZM88 56h24a8 8 0 0 1 0 16H88a8 8 0 0 1 0-16Zm0 40h24a8 8 0 0 1 0 16H88a8 8 0 0 1 0-16Zm-8 48a8 8 0 0 1 8-8h24a8 8 0 0 1 0 16H88a8 8 0 0 1-8-8Zm72 80h-48v-40h48Zm16-72h-24a8 8 0 0 1 0-16h24a8 8 0 0 1 0 16Zm0-40h-24a8 8 0 0 1 0-16h24a8 8 0 0 1 0 16Zm0-40h-24a8 8 0 0 1 0-16h24a8 8 0 0 1 0 16Z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M8 13h8a4 4 0 0 1 4 4v4H4v-4a4 4 0 0 1 4-4Z"/></svg>';

    return `
      <div class="sr-item ${i === srActiveIndex ? 'active' : ''}" data-sr-index="${i}">
        <span class="sr-item-icon">${iconSvg}</span>
        <div class="sr-item-info">
          <span class="sr-item-name">${escapeForHTML(name)}</span>
          <span class="sr-item-sub">${escapeForHTML(subtitle)}</span>
        </div>
        <span class="sr-badge ${badgeClass}">${badgeText}</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.sr-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.srIndex, 10);
      navigateToRecord(idx);
    });
    el.addEventListener('mouseenter', () => {
      srActiveIndex = parseInt(el.dataset.srIndex, 10);
      container.querySelectorAll('.sr-item').forEach((item, j) => item.classList.toggle('active', j === srActiveIndex));
      renderSearchPreview(srActiveIndex);
    });
  });
}

function renderSearchPreview(index) {
  const preview = document.getElementById('sr-preview');
  if (!preview || !srResults[index]) return;
  const r = srResults[index];
  const isCompany = r.type === 'company';

  if (isCompany) {
    const c = r.data;
    const faviconUrl = c.domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.domain)}&sz=64` : '';
    const categories = c.categories || [];
    preview.innerHTML = `
      <div class="sr-preview-header">
        ${faviconUrl ? `<img src="${faviconUrl}" class="sr-preview-favicon" alt="" onerror="this.style.display='none'">` : ''}
        <div>
          <div class="sr-preview-name">${escapeForHTML(c.name || '')}</div>
          <div class="sr-preview-meta-badge">Company</div>
        </div>
      </div>
      <div class="sr-preview-section">Details</div>
      ${c.description ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span><span class="sr-preview-val sr-preview-desc">${escapeForHTML(truncate(c.description, 120))}</span></div>` : ''}
      ${c.domain ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></span><span class="sr-preview-val">${escapeForHTML(c.domain)}</span></div>` : ''}
      ${categories.length ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg></span><div class="sr-preview-tags">${categories.map(t => `<span class="sr-tag">${escapeForHTML(t)}</span>`).join('')}</div></div>` : ''}
      ${c.city ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span><span class="sr-preview-val">${escapeForHTML(c.city)}</span></div>` : ''}
      ${c.state ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span><span class="sr-preview-val">${escapeForHTML(c.state)}</span></div>` : ''}
      ${c.country ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span><span class="sr-preview-val">${escapeForHTML(c.country)}</span></div>` : ''}
    `;
  } else {
    const p = r.data;
    const nameParts = (p.name || '').trim().split(/\s+/);
    const initials = (nameParts.length >= 2 ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}` : (nameParts[0] || '?')[0]).toUpperCase();
    const companyName = p.company?.name || '';
    const phones = Array.isArray(p.phone_numbers) ? p.phone_numbers.join(', ') : (p.phone_numbers || '');
    preview.innerHTML = `
      <div class="sr-preview-header">
        <div class="sr-preview-avatar">${initials}</div>
        <div>
          <div class="sr-preview-name">${escapeForHTML(p.name || '')}</div>
          <div class="sr-preview-meta-badge">Person</div>
        </div>
      </div>
      <div class="sr-preview-section">Details</div>
      ${p.email ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></span><span class="sr-preview-val">${escapeForHTML(p.email)}</span></div>` : ''}
      ${phones ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></span><span class="sr-preview-val">${escapeForHTML(phones)}</span></div>` : ''}
      ${companyName ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg></span><span class="sr-preview-val">${escapeForHTML(companyName)}</span></div>` : ''}
      ${p.job_title ? `<div class="sr-preview-row"><span class="sr-preview-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg></span><span class="sr-preview-val">${escapeForHTML(p.job_title)}</span></div>` : ''}
    `;
  }
}

function navigateToRecord(index) {
  const r = srResults[index];
  if (!r) return;
  closeSearchRecords();
  if (r.type === 'company') {
    navigateView('companies');
    setTimeout(() => window.openCompanyViewModal?.(r.data), 200);
  } else {
    navigateView('people');
    setTimeout(() => window.openPersonViewModal?.(r.data), 200);
  }
}

function escapeForHTML(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}


// ═══════════════════════════════════════════════════════════════
//  GLOBAL KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════
function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable;
}

document.addEventListener('keydown', (e) => {
  // ⌘K / Ctrl+K → Quick Actions
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault();
    // Close search if open
    closeSearchRecords();
    openQuickActions();
    return;
  }
  // Escape closes either modal
  if (e.key === 'Escape') {
    if (document.getElementById('quick-actions-modal')?.style.display !== 'none') {
      closeQuickActions();
      return;
    }
    if (document.getElementById('search-records-modal')?.style.display !== 'none') {
      closeSearchRecords();
      return;
    }
  }
  // "/" → Search Records (only when not typing in an input)
  if (e.key === '/' && !isInputFocused()) {
    e.preventDefault();
    closeQuickActions();
    openSearchRecords();
  }
});


// ── Backward-compatible exports (old names still referenced in auth.js / app.js) ─
function openCommandPalette() { openQuickActions(); }
function closeCommandPalette() { closeQuickActions(); }

export {
  openCommandPalette,
  closeCommandPalette,
  openQuickActions,
  closeQuickActions,
  openSearchRecords,
  closeSearchRecords,
};
