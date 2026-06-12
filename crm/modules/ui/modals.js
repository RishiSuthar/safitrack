// modules/ui/modals.js
// Custom confirm dialog.

// ======================
// MODAL CORE UTILS
// ======================

window.closeModal = function (modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
  // For dynamically created modals
  if (!modal) {
    document.querySelectorAll('.modal').forEach(m => {
      if (m.id === modalId) m.remove();
    });
  }

  // Remove active class if no other modals are visible
  const visibleModals = Array.from(document.querySelectorAll('.modal')).filter(m => m.style.display !== 'none');
  if (visibleModals.length === 0) {
    document.body.classList.remove('modal-active');
  }
};

// ======================
// CUSTOM CONFIRM DIALOG
// ======================

window.showConfirmDialog = function (title, message) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('confirm-dialog');
    const container = dialog?.querySelector('.confirm-dialog-container');
    const backdrop = dialog?.querySelector('.modal-backdrop');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const helperEl = document.getElementById('confirm-helper');
    const cancelBtn = document.getElementById('confirm-cancel');
    const okBtn = document.getElementById('confirm-ok');
    const isDestructive = /\b(delete|remove)\b/i.test(`${title} ${message}`);

    // Set content
    titleEl.textContent = title;
    messageEl.textContent = message;
    if (helperEl) {
      helperEl.textContent = 'This action cannot be undone.';
    }
    okBtn.textContent = isDestructive ? 'Delete' : 'Confirm';
    okBtn.classList.toggle('btn-danger', isDestructive);
    okBtn.classList.toggle('btn-primary', !isDestructive);
    container?.classList.toggle('confirm-dialog-danger', isDestructive);
    container?.setAttribute('data-intent', isDestructive ? 'danger' : 'default');

    // Show dialog
    dialog.style.display = 'flex';
    cancelBtn.focus();

    // Handle buttons
    const handleCancel = () => {
      dialog.style.display = 'none';
      cleanup();
      resolve(false);
    };

    const handleOk = () => {
      dialog.style.display = 'none';
      cleanup();
      resolve(true);
    };

    const handleBackdropClick = (event) => {
      if (event.target === dialog || event.target === backdrop) {
        handleCancel();
      }
    };

    const handleKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        handleOk();
      }
    };

    const cleanup = () => {
      cancelBtn.removeEventListener('click', handleCancel);
      okBtn.removeEventListener('click', handleOk);
      dialog.removeEventListener('click', handleBackdropClick);
      document.removeEventListener('keydown', handleKeydown);
      container?.classList.remove('confirm-dialog-danger');
      container?.removeAttribute('data-intent');
      okBtn.classList.remove('btn-danger');
      okBtn.classList.add('btn-primary');
      okBtn.textContent = 'Confirm';
    };

    cancelBtn.addEventListener('click', handleCancel);
    okBtn.addEventListener('click', handleOk);
    dialog.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleKeydown);
  });
};

// ======================
// COMMAND PALETTE
// ======================

