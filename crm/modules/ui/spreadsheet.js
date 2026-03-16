// modules/ui/spreadsheet.js
// Universal editable data table, column resize, cell editing, sort.
import { state, supabaseClient, saveViewState } from '../state.js';
import { showToast } from './toast.js';
import { renderError } from '../utils/helpers.js';

function renderEditableDataTable(data, columns, tableId, supabaseTable) {
  const isMobileView = window.matchMedia('(max-width: 767px)').matches;
  const defaultColumnWidth = isMobileView ? '120px' : '160px';
  const getSavedWidth = (key) => {
    try { return localStorage.getItem(`col_width_${tableId}_${key}`) || null; } catch (e) { return null; }
  };

  let html = `
    <div class="spreadsheet-container">
      <table class="spreadsheet-table" id="${tableId}">
        <thead>
      <tr>
        ${columns.map(col => {
    const colKey = col.label.trim().startsWith('<input') ? '_selection' : col.key;
    const columnWidth = getSavedWidth(colKey) || col.width || defaultColumnWidth;
    const isSortable = col.sortable !== false;
    const sortIcon = isSortable
      ? `<i data-lucide="${state.currentSortKey === col.key ? (state.currentSortDir === 'asc' ? 'chevron-up' : 'chevron-down') : 'chevrons-up-down'}" 
                 style="width: 12px; height: 12px; opacity: ${state.currentSortKey === col.key ? 1 : 0.3};"></i>`
      : '';
    // Selection column: render checkbox directly, no flex wrapper
    if (col.label.trim().startsWith('<input')) {
      return `
          <th style="width: ${columnWidth}; min-width: ${columnWidth}; max-width: ${columnWidth}; position: relative;" 
              data-col-key="_selection"
              class="sortable-header th-selection">
            ${col.label}
            ${isMobileView ? '' : '<div class="resize-handle" onmousedown="initResize(event, this)"></div>'}
          </th>
        `;
    }
    return `
          <th style="width: ${columnWidth}; min-width: ${columnWidth}; max-width: ${columnWidth}; position: relative; cursor: ${isSortable ? 'pointer' : 'default'};" 
              data-col-key="${col.key}"
              ${isSortable ? `onclick="handleHeaderSort('${col.key}', true)"` : ''}
              class="sortable-header ${isSortable && state.currentSortKey === col.key ? 'active-sort' : ''}">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${col.icon ? `<i data-lucide="${col.icon}" style="width: 14px; height: 14px; opacity: 0.6;"></i>` : ''}
              <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${col.label}</span>
              ${sortIcon}
            </div>
            ${isMobileView ? '' : '<div class="resize-handle" onmousedown="initResize(event, this)"></div>'}
          </th>
        `;
  }).join('')}
      </tr>
    </thead>
        <tbody>
  `;

  if (data.length === 0) {
    html += `<tr><td colspan="${columns.length}" style="text-align: center; padding: 40px; color: var(--text-muted);">No records found</td></tr>`;
  } else {
    data.forEach((row, rowIndex) => {
      html += `<tr data-row-id="${row.id}">`;
      columns.forEach(col => {
        const rawValue = getDeepValue(row, col.key); // Get the raw value for data-value
        const displayValue = col.render ? col.render(rawValue, row) : (rawValue || '-');
        const isReadOnly = col.readOnly ? 'true' : 'false';
        const type = col.type || 'text';
        const options = JSON.stringify(col.options || []);
        const cellColKey = col.label && col.label.trim().startsWith('<input') ? '_selection' : col.key;
        const columnWidth = getSavedWidth(cellColKey) || col.width || defaultColumnWidth;

        html += `<td class="spreadsheet-cell-wrapper" style="width: ${columnWidth}; min-width: ${columnWidth}; max-width: ${columnWidth};">
          <div class="spreadsheet-cell"
               data-row-id="${row.id}"
               data-column="${col.key}"
               data-read-only="${isReadOnly}"
               data-type="${type}"
               data-options='${options}'
               data-value="${rawValue !== undefined && rawValue !== null ? rawValue : ''}"
               onclick="if(this.dataset.readOnly !== 'true') makeCellEditable(this, '${row.id}', '${supabaseTable}')">
            ${displayValue}
          </div>
        </td>`;
      });
      html += `</tr>`;
    });
  }

  html += `
        </tbody>
      </table>
    </div>
  `;

  return html;
}

function getDeepValue(obj, path) {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

// Return a Google S2 favicon URL for a domain (sanitizes input)
function getCompanyLogoUrl(domain) {
  if (!domain) return '';
  try {
    let d = String(domain || '').trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '');
    d = d.replace(/^www\./, '');
    d = d.split('/')[0];
    // Use Google's S2 favicon service; request a slightly larger size
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=64`;
  } catch (e) {
    return '';
  }
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// More robust company name normalizer for matching (removes diacritics and punctuation)
function normalizeForMatching(value) {
  if (!value) return '';
  // Remove diacritics, convert to lower, replace non-alphanum with space, collapse spaces
  try {
    value = String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '');
  } catch (e) {
    // older engines may not support unicode property escapes
    value = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findCompanyForOpportunity(opp) {
  if (!Array.isArray(window.allCompaniesData)) return null;

  // Try id match first
  if (opp.company_id) {
    const byId = window.allCompaniesData.find(c => String(c.id) === String(opp.company_id));
    if (byId) return byId;
  }

  const oppName = opp.company_name || '';
  const normOpp = normalizeForMatching(oppName);
  if (!normOpp) return null;

  // Exact normalized match
  let found = window.allCompaniesData.find(c => normalizeForMatching(c.name) === normOpp);
  if (found) return found;

  // token subset check: every word the user supplied appears in candidate name.
  // also handle fused tokens like "nextgen" matching "next gen" or "next-gen".
  const oppTokens = new Set(normOpp.split(/\s+/).filter(Boolean));
  if (oppTokens.size > 0) {
    found = window.allCompaniesData.find(c => {
      const n = normalizeForMatching(c.name);
      if (!n) return false;
      const tokens = n.split(/\s+/).filter(Boolean);
      // helper to test one user token against candidate tokens
      const tokenMatches = (userTok) => {
        if (tokens.includes(userTok)) return true;
        // check if userTok equals concatenation of all tokens
        const joined = tokens.join('');
        if (userTok === joined) return true;
        // also check if userTok contains the joined string (e.g. extra chars?)
        if (joined && userTok.includes(joined)) return true;
        // try splitting userTok into parts roughly equal to candidate tokens;
        // e.g. userTok="nextgen" and tokens=['next','gen']
        if (tokens.length > 1) {
          const recombined = tokens.join('');
          if (userTok === recombined) return true;
        }
        return false;
      };
      return [...oppTokens].every(t => tokenMatches(t));
    });
    if (found) return found;
  }

  // Inclusion match (company name contained in opportunity name or vice versa)
  found = window.allCompaniesData.find(c => {
    const n = normalizeForMatching(c.name);
    return n && (normOpp.includes(n) || n.includes(normOpp));
  });
  if (found) return found;

  // Token overlap fuzzy match: require at least half tokens overlap
  let best = null;
  let bestScore = 0;
  window.allCompaniesData.forEach(c => {
    const n = normalizeForMatching(c.name);
    if (!n) return;
    const tokens = n.split(/\s+/).filter(Boolean);
    let common = 0;
    tokens.forEach(t => { if (oppTokens.has(t)) common++; });
    const score = tokens.length > 0 ? (common / tokens.length) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  });
  if (bestScore >= 0.5) return best;

  return null;
}

function slugifyForDomain(name) {
  if (!name) return '';
  // Remove punctuation, diacritics, parentheses content, and common separators
  const cleaned = String(name)
    .replace(/\(.*?\)/g, ' ')
    .replace(/[’'“”"\u2013\u2014–—]/g, ' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
  // Use first two meaningful words to form a slug
  const parts = cleaned.split(' ').filter(Boolean).slice(0, 2);
  return parts.join('');
}

function getGoogleFaviconUrl(domain) {
  if (!domain) return '';
  // Use the Google favicon proxy used by Chrome/Google services
  // Example: https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://carrefour.com&size=64
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${encodeURIComponent(domain)}&size=64`;
}

function guessDomainAndFavicon(name) {
  const slug = slugifyForDomain(name);
  if (!slug) return '';
  const candidates = [
    `${slug}.com`,
    `${slug}.co.ke`,
    `${slug}.org`,
    `${slug}.net`
  ];
  // Return first candidate's Google favicon URL (browser will attempt to load it)
  return getGoogleFaviconUrl(candidates[0]);
}

function matchesTokenizedQuery(query, ...fields) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const haystack = normalizeSearchText(fields.filter(Boolean).join(' '));
  if (!haystack) return false;

  return tokens.every(token => haystack.includes(token));
}

function normalizeEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhoneValue(value) {
  return String(value || '').replace(/\D+/g, '');
}

function findDuplicateCompanyByName(name, excludeCompanyId = null) {
  const normalizedName = normalizeSearchText(name);
  if (!normalizedName) return null;

  const companies = Array.isArray(window.allCompaniesData) ? window.allCompaniesData : [];
  return companies.find((item) => {
    if (!item) return false;
    if (excludeCompanyId && String(item.id) === String(excludeCompanyId)) return false;
    return normalizeSearchText(item.name) === normalizedName;
  }) || null;
}

function findDuplicatePersonContact({ name, email, phoneNumbers, companyId, excludePersonId = null }) {
  const normalizedName = normalizeSearchText(name);
  const normalizedEmail = normalizeEmailValue(email);
  const normalizedPhones = (phoneNumbers || [])
    .map(normalizePhoneValue)
    .filter((phone) => phone.length >= 7);

  if (!normalizedName || !companyId) return null;
  if (!normalizedEmail && normalizedPhones.length === 0) return null;

  const people = Array.isArray(window.allPeopleData) ? window.allPeopleData : [];
  return people.find((item) => {
    if (!item) return false;
    if (excludePersonId && String(item.id) === String(excludePersonId)) return false;
    if (String(item.company_id || '') !== String(companyId)) return false;
    if (normalizeSearchText(item.name) !== normalizedName) return false;

    const emailMatches = normalizedEmail && normalizeEmailValue(item.email) === normalizedEmail;
    const existingPhones = (Array.isArray(item.phone_numbers) ? item.phone_numbers : [])
      .map(normalizePhoneValue)
      .filter((phone) => phone.length >= 7);
    const phoneMatches = normalizedPhones.length > 0 && normalizedPhones.some((phone) => existingPhones.includes(phone));

    return Boolean(emailMatches || phoneMatches);
  }) || null;
}

function makeCellEditable(cell, rowId, tableName) {
  if (cell.classList.contains('editing')) return;

  const column = cell.dataset.column;
  const type = cell.dataset.type;
  const options = JSON.parse(cell.dataset.options || '[]');
  const initialValue = cell.dataset.value || ''; // Use data-value for initial value
  const cellWrapper = cell.closest('.spreadsheet-cell-wrapper');

  cell.classList.add('editing');
  cellWrapper?.classList.add('editing-cell');

  let input;
  if (type === 'select') {
    input = document.createElement('select');
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.text = opt;
      if (opt === initialValue) option.selected = true;
      input.appendChild(option);
    });
  } else {
    input = document.createElement('input');
    input.type = type || 'text';
    input.value = initialValue;
    input.classList.add('spreadsheet-inline-editor');
  }

  cell.innerHTML = '';
  cell.appendChild(input);
  input.focus();

  // Select all text if it's an input
  if (input.select) input.select();

  const save = async () => {
    const newValue = input.value;
    if (newValue !== initialValue) { // Compare with initialValue
      cell.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      const success = await handleCellUpdate(tableName, rowId, column, newValue); // Use 'column'
      if (success) {
        // Re-render the cell content based on column definition
        // We'll use a simplified version for now or find the col def
        cell.dataset.value = newValue;

        // Find column definition to see if we need special render (like avatars)
        let colDef;
        if (tableName === 'companies') {
          // We might need to pass col defs or find them
        }

        // For now, let's just refresh the view or re-render row content
        // A simple fix for avatars: if it's 'name' and we see an avatar, re-gen it
        if (column === 'name' && cell.querySelector('.mention-avatar')) {
          cell.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="mention-avatar" style="width: 24px; height: 24px; font-size: 0.75rem;">${getInitials(newValue)}</div>
              <span>${newValue}</span>
            </div>
          `;
        } else {
          cell.innerText = newValue || '-';
        }
        showInlineSuccess(cellWrapper || cell);
      } else {
        cell.innerText = initialValue || '-';
        cell.dataset.value = initialValue; // Revert data-value
      }
    } else {
      cell.innerText = initialValue || '-';
    }
    cell.classList.remove('editing');
    cellWrapper?.classList.remove('editing-cell');
  };

  input.onblur = save;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      cell.innerText = initialValue || '-';
      cell.dataset.value = initialValue; // Revert data-value
      cell.classList.remove('editing');
      cellWrapper?.classList.remove('editing-cell');
    }
  };
}

// Column Resizing Logic
let currentResizer;
let currentTh;
let startX;
let startWidth;

function initResize(e, resizer) {
  currentResizer = resizer;
  currentTh = resizer.parentElement;
  startX = e.pageX;
  startWidth = currentTh.offsetWidth;

  currentResizer.classList.add('resizing');
  document.addEventListener('mousemove', handleResizeMove);
  document.addEventListener('mouseup', stopResize);

  // Prevent text selection during resize
  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'col-resize';
}

function handleResizeMove(e) {
  if (!currentTh) return;
  const diff = e.pageX - startX;
  const newWidth = Math.max(50, startWidth + diff);
  currentTh.style.width = newWidth + 'px';
  currentTh.style.minWidth = newWidth + 'px';
  currentTh.style.maxWidth = newWidth + 'px';

  const table = currentTh.closest('table');
  if (!table) return;

  const columnIndex = currentTh.cellIndex + 1;
  table.querySelectorAll(`tbody tr td:nth-child(${columnIndex})`).forEach(td => {
    td.style.width = newWidth + 'px';
    td.style.minWidth = newWidth + 'px';
    td.style.maxWidth = newWidth + 'px';
  });
}

// Generate company description using AI helper
async function handleGenerateCompanyDescription() {
  const companyNameInput = document.getElementById('company-name-input');
  const companyDescriptionTextarea = document.getElementById('company-description');
  const generateCompanyDescBtn = document.getElementById('generate-company-desc-btn');
  const generateCompanyDescSpinner = document.getElementById('generate-company-desc-spinner');

  if (!generateCompanyDescBtn) return;
  const name = (companyNameInput && companyNameInput.value) ? companyNameInput.value.trim() : '';
  if (!name) {
    showToast('Please enter a company name first', 'error');
    return;
  }

  try {
    generateCompanyDescBtn.disabled = true;
    if (generateCompanyDescSpinner) generateCompanyDescSpinner.style.display = 'inline-block';

    const desc = await generateCompanyDescription(name);
    if (desc && desc.trim()) {
      if (companyDescriptionTextarea) companyDescriptionTextarea.value = desc.trim();
      showToast('Generated description added', 'success');
    } else {
      showToast('No description returned from AI', 'error');
    }
  } catch (err) {
    console.error('AI generate error', err);
    showToast('Failed to generate description', 'error');
  } finally {
    generateCompanyDescBtn.disabled = false;
    if (generateCompanyDescSpinner) generateCompanyDescSpinner.style.display = 'none';
  }
}

function stopResize() {
  if (currentResizer) currentResizer.classList.remove('resizing');
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.userSelect = '';
  document.body.style.cursor = '';
  if (currentTh) {
    const table = currentTh.closest('table');
    const colKey = currentTh.dataset.colKey;
    if (table && table.id && colKey) {
      try { localStorage.setItem(`col_width_${table.id}_${colKey}`, currentTh.offsetWidth + 'px'); } catch (e) {}
    }
  }
  currentResizer = null;
  currentTh = null;
}

async function handleCellUpdate(tableName, rowId, key, value) {
  const column = key.includes('.') ? key.split('.')[0] : key;

  // Phone numbers bug fix: if column is phone_numbers and value is a string, check if it should be an array
  let finalValue = value;
  if (column === 'phone_numbers' && typeof value === 'string') {
    finalValue = value.split(',').map(p => p.trim()).filter(p => p !== '');
  }

  const { error } = await supabaseClient
    .from(tableName)
    .update({ [column]: finalValue })
    .eq('id', rowId);

  if (error) {
    console.error('Update error:', error);
    showToast('Failed to update: ' + error.message, 'error');
    return false;
  }

  // Update local window data
  if (tableName === 'companies') {
    const item = window.allCompaniesData.find(c => c.id === rowId);
    if (item) item[column] = finalValue;
  } else if (tableName === 'people') {
    const item = window.allPeopleData.find(p => p.id === rowId);
    if (item) item[column] = finalValue;
  }

  return true;
}

// Full Sort & Filter Logic
function sortData(data, key, direction = 'asc') {
  return [...data].sort((a, b) => {
    let valA = getDeepValue(a, key);
    let valB = getDeepValue(b, key);

    if (valA == null) valA = '';
    if (valB == null) valB = '';

    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return direction === 'asc' ? -1 : 1;
    if (valA > valB) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

function handleHeaderSort(key, isSortable = true) {
  if (!isSortable) return;

  if (state.currentSortKey === key) {
    state.currentSortDir = state.currentSortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.currentSortKey = key;
    state.currentSortDir = 'asc';
  }

  // Persist sort intent to the active view's state
  if (state.currentView === 'companies') {
    state.tableViewState.companies.sortKey = state.currentSortKey;
    state.tableViewState.companies.sortDir = state.currentSortDir;
    saveViewState({ companies: state.tableViewState.companies });
  } else if (state.currentView === 'people') {
    state.tableViewState.people.sortKey = state.currentSortKey;
    state.tableViewState.people.sortDir = state.currentSortDir;
    saveViewState({ people: state.tableViewState.people });
  }

  refreshCurrentView();
}

function refreshCurrentView() {
  const activeNavItem = document.querySelector('.nav-item.active');
  const view = activeNavItem ? activeNavItem.dataset.view : '';

  if (view === 'companies') {
    renderCompaniesView();
  } else if (view === 'people') {
    renderPeopleView();
  }
}

// ======================


// ── Exports ────────────────────────────────────────────────────
export {
  renderEditableDataTable,
  getDeepValue,
  getCompanyLogoUrl,
  normalizeSearchText,
  normalizeForMatching,
  findCompanyForOpportunity,
  slugifyForDomain,
  getGoogleFaviconUrl,
  guessDomainAndFavicon,
  matchesTokenizedQuery,
  normalizeEmailValue,
  normalizePhoneValue,
  findDuplicateCompanyByName,
  findDuplicatePersonContact,
  makeCellEditable,
  initResize,
  handleResizeMove,
  handleGenerateCompanyDescription,
  stopResize,
  handleCellUpdate,
  sortData,
  handleHeaderSort,
  refreshCurrentView,
};
