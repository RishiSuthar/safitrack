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
  if (!dateString) return '';
  let date;
  if (typeof dateString === 'string' && dateString.length === 10 && dateString.includes('-')) {
    const [y, m, d] = dateString.split('-').map(Number);
    date = new Date(y, m - 1, d, 12, 0, 0);
  } else {
    date = new Date(dateString);
  }
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  // Use user's preferred date format for older dates
  const pref = getUserDateFormat();
  if (pref === 'MM/DD/YYYY') {
    return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`;
  }
  return formatDateDDMMYYYY(dateString);
}

// Format date with time
function formatDateWithTime(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Format date as '21st September 2026'
function formatFullDateOrdinal(dateString) {
  if (!dateString) return '';
  let date;
  if (typeof dateString === 'string' && dateString.length === 10 && dateString.includes('-')) {
    const [y, m, d] = dateString.split('-').map(Number);
    date = new Date(y, m - 1, d, 12, 0, 0);
  } else {
    date = new Date(dateString);
  }

  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'long' });
  const year = date.getFullYear();

  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  return `${ordinal(day)} ${month} ${year}`;
}

// Format date as 'DD/MM/YYYY' (e.g., '21/09/2026')
function formatDateDDMMYYYY(dateString) {
  if (!dateString) return '';
  let date;
  if (typeof dateString === 'string' && dateString.length === 10 && dateString.includes('-')) {
    const [y, m, d] = dateString.split('-').map(Number);
    date = new Date(y, m - 1, d, 12, 0, 0);
  } else {
    date = new Date(dateString);
  }

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Return user's preferred date format. Defaults to 'DD/MM/YYYY'.
function getUserDateFormat() {
  try {
    const val = localStorage.getItem('safitrack_date_format');
    if (val === 'MM/DD/YYYY' || val === 'DD/MM/YYYY') return val;
  } catch (e) {}
  return 'DD/MM/YYYY';
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


/**
 * Create pagination controls HTML
 * @param {number} currentPage - Current page number (1-based)
 * @param {number} totalPages - Total number of pages
 * @param {number} totalRecords - Total number of records
 * @param {number} recordsPerPage - Number of records per page
 * @param {string} containerId - ID of the container to render pagination in
 * @param {Function} onPageChange - Callback function when page changes
 */
function createPaginationControls(currentPage, totalPages, totalRecords, recordsPerPage, containerId, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Ensure all values are valid numbers
  currentPage = parseInt(currentPage) || 1;
  totalPages = parseInt(totalPages) || 1;
  totalRecords = parseInt(totalRecords) || 0;
  recordsPerPage = parseInt(recordsPerPage) || 10;

  let html = `
    <div class="pagination-container">
      <div class="pagination-info">
        Showing ${((currentPage - 1) * recordsPerPage) + 1} to ${Math.min(currentPage * recordsPerPage, totalRecords)} of ${totalRecords} records
      </div>
      <div class="pagination-controls">
  `;

  // Previous button
  html += `
    <button class="pagination-btn ${currentPage === 1 ? 'disabled' : ''}" 
            onclick="${currentPage > 1 ? `changePage(${currentPage - 1})` : ''}">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left-icon lucide-chevron-left"><path d="m15 18-6-6 6-6"/></svg>
      Previous
    </button>
  `;

  // Page numbers
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  // Adjust if we're near the end
  if (endPage - startPage + 1 < maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  // First page and ellipsis
  if (startPage > 1) {
    html += `<button class="pagination-btn" onclick="changePage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
  }

  // Page numbers
  for (let i = startPage; i <= endPage; i++) {
    html += `
      <button class="pagination-btn ${i === currentPage ? 'active' : ''}" 
              onclick="changePage(${i})">${i}</button>
    `;
  }

  // Last page and ellipsis
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<span class="pagination-ellipsis">...</span>`;
    }
    html += `<button class="pagination-btn" onclick="changePage(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  html += `
    <button class="pagination-btn ${currentPage === totalPages ? 'disabled' : ''}" 
            onclick="${currentPage < totalPages ? `changePage(${currentPage + 1})` : ''}">
      Next 
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right-icon lucide-chevron-right"><path d="m9 18 6-6-6-6"/></svg>
    </button>
  `;

  html += `
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Make the changePage function available globally
  window.changePage = function (page) {
    if (page >= 1 && page <= totalPages) {
      onPageChange(page);
    }
  };
}

/**
 * Search and paginate data
 * @param {Array} data - All data to search and paginate
 * @param {string} searchQuery - Search query
 * @param {number} page - Current page number (1-based)
 * @param {number} recordsPerPage - Number of records per page
 * @param {Function} searchFunction - Function to search in each record
 * @returns {Object} Object with filtered data and pagination info
 */
function searchAndPaginate(data, searchQuery, page, recordsPerPage, searchFunction) {
  // Ensure valid inputs
  page = parseInt(page) || 1;
  recordsPerPage = parseInt(recordsPerPage) || 10;

  // Filter data based on search query
  let filteredData = data;
  if (searchQuery && searchQuery.trim() !== '') {
    filteredData = data.filter(item => searchFunction(item, searchQuery.toLowerCase().trim()));
  }

  // Calculate pagination
  const totalRecords = filteredData.length;
  const totalPages = Math.ceil(totalRecords / recordsPerPage) || 1;
  const offset = (page - 1) * recordsPerPage;
  const paginatedData = filteredData.slice(offset, offset + recordsPerPage);

  return {
    data: paginatedData,
    totalRecords,
    totalPages,
    currentPage: page,
    recordsPerPage
  };
}

/**
 * Parse a currency string into a number.
 * Handles "Ksh", "$", and commas.
 * @param {string} value - The currency string (e.g., "Ksh 50,000" or "$50.00")
 * @returns {number} The numeric value
 */
function parseCurrencyValue(value) {
  if (!value) return 0;
  // Remove non-numeric characters except for the decimal point
  const cleanValue = value.replace(/[^0-9.]/g, '');
  return parseFloat(cleanValue) || 0;
}