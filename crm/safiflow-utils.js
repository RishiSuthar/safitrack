/**
 * SafiFlow Utilities
 * Helper functions for the SafiFlow module
 */

/**
 * Format currency values
 */
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: 'KES',
        minimumFractionDigits: 0
    }).format(amount || 0);
}

/**
 * Format date/time values
 */
function formatDateTime(date, options = {}) {
    if (!date) return 'N/A';
    const defaultOptions = {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...options
    };
    return new Date(date).toLocaleString('en-US', defaultOptions);
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
function formatRelativeTime(date) {
    if (!date) return 'N/A';
    const now = new Date();
    const past = new Date(date);
    const diffMs = now - past;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDateTime(date, { dateStyle: 'short', timeStyle: undefined });
}

/**
 * Debounce function for search inputs
 */
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

/**
 * Generate skeleton loader HTML
 */
function generateSkeletonLoader(type = 'table', count = 5) {
    if (type === 'table') {
        return `
      <div class="skeleton-wrapper">
        ${Array(count).fill(0).map(() => `
          <div class="skeleton-row">
            <div class="skeleton-cell skeleton-shimmer" style="width: 30%"></div>
            <div class="skeleton-cell skeleton-shimmer" style="width: 20%"></div>
            <div class="skeleton-cell skeleton-shimmer" style="width: 15%"></div>
            <div class="skeleton-cell skeleton-shimmer" style="width: 25%"></div>
            <div class="skeleton-cell skeleton-shimmer" style="width: 10%"></div>
          </div>
        `).join('')}
      </div>
    `;
    } else if (type === 'card') {
        return `
      <div class="skeleton-card">
        <div class="skeleton-header skeleton-shimmer"></div>
        <div class="skeleton-line skeleton-shimmer" style="width: 80%"></div>
        <div class="skeleton-line skeleton-shimmer" style="width: 60%"></div>
        <div class="skeleton-line skeleton-shimmer" style="width: 90%"></div>
      </div>
    `;
    }
}

/**
 * Show loading overlay on button
 */
function setButtonLoading(buttonEl, loading = true, originalText = null) {
    if (loading) {
        buttonEl.dataset.originalText = buttonEl.innerHTML;
        buttonEl.disabled = true;
        buttonEl.innerHTML = '<div class="spinner-small"></div> Processing...';
    } else {
        buttonEl.disabled = false;
        buttonEl.innerHTML = originalText || buttonEl.dataset.originalText || 'Save';
    }
}

/**
 * Generate a unique ID
 */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validate image file
 */
function validateImageFile(file) {
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!validTypes.includes(file.type)) {
        return { valid: false, error: 'Invalid file type. Please upload a JPEG, PNG, WEBP, or GIF image.' };
    }

    if (file.size > maxSize) {
        return { valid: false, error: 'File is too large. Maximum size is 5MB.' };
    }

    return { valid: true };
}

/**
 * Upload image to Supabase Storage
 */
async function uploadImage(file, bucket = 'safiflow-images') {
    try {
        const validation = validateImageFile(file);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${generateId()}.${fileExt}`;
        const filePath = `${currentUser.id}/${fileName}`;

        const { data, error } = await supabaseClient.storage
            .from(bucket)
            .upload(filePath, file);

        if (error) throw error;

        const { data: { publicUrl } } = supabaseClient.storage
            .from(bucket)
            .getPublicUrl(filePath);

        return { success: true, url: publicUrl, path: filePath };
    } catch (error) {
        console.error('Image upload error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Delete image from Supabase Storage
 */
async function deleteImage(path, bucket = 'safiflow-images') {
    try {
        const { error } = await supabaseClient.storage
            .from(bucket)
            .remove([path]);

        if (error) throw error;
        return { success: true };
    } catch (error) {
        console.error('Image deletion error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Generate status badge HTML
 */
function generateStatusBadge(status) {
    const statusMap = {
        'pending': { class: 'badge-warning', icon: 'clock', label: 'Pending' },
        'approved': { class: 'badge-success', icon: 'check-circle', label: 'Approved' },
        'complete': { class: 'badge-success', icon: 'check-circle', label: 'Complete' },
        'rejected': { class: 'badge-danger', icon: 'times-circle', label: 'Rejected' },
        'under_review': { class: 'badge-info', icon: 'eye', label: 'Under Review' }
    };

    const config = statusMap[status] || { class: 'badge-secondary', icon: 'question', label: status };

    return `
    <span class="badge ${config.class}">
      <i class="fas fa-${config.icon}"></i> ${config.label}
    </span>
  `;
}

/**
 * Calculate MOQ compliance percentage
 */
function calculateMOQCompliance(quantity, moq) {
    if (!moq || moq === 0) return 100;
    return Math.min(100, Math.round((quantity / moq) * 100));
}

/**
 * Generate progress bar HTML
 */
function generateProgressBar(percentage, showLabel = true) {
    const colorClass = percentage >= 100 ? 'success' : percentage >= 50 ? 'warning' : 'danger';

    return `
    <div class="progress-wrapper">
      <div class="progress-bar">
        <div class="progress-fill progress-fill-${colorClass}" style="width: ${percentage}%"></div>
      </div>
      ${showLabel ? `<span class="progress-label">${percentage}% of MOQ</span>` : ''}
    </div>
  `;
}

/**
 * Show confirmation dialog
 */
function showConfirmDialog(title, message, onConfirm, onCancel = null) {
    const dialogHTML = `
    <div id="confirm-dialog" class="modal active">
      <div class="modal-backdrop"></div>
      <div class="modal-container" style="max-width: 450px;">
        <div class="modal-header">
          <h3>${title}</h3>
        </div>
        <div class="modal-body">
          <p>${message}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
          <button class="btn btn-primary" id="confirm-ok">Confirm</button>
        </div>
      </div>
    </div>
  `;

    document.body.insertAdjacentHTML('beforeend', dialogHTML);

    const dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-ok').addEventListener('click', () => {
        document.body.removeChild(dialog);
        if (onConfirm) onConfirm();
    });

    document.getElementById('confirm-cancel').addEventListener('click', () => {
        document.body.removeChild(dialog);
        if (onCancel) onCancel();
    });
}

/**
 * Export data to CSV
 */
function exportToCSV(data, filename) {
    if (!data || data.length === 0) {
        showToast('No data to export', 'warning');
        return;
    }

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => headers.map(header => {
            const value = row[header];
            // Escape commas and quotes
            if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}-${Date.now()}.csv`;
    link.click();
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard', 'success');
    } catch (err) {
        showToast('Failed to copy', 'error');
    }
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
