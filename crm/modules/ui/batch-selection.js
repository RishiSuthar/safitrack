// modules/ui/batch-selection.js
// Multi-record batch selection and batch delete.
import { state, supabaseClient } from '../state.js';
import { showToast } from './toast.js';

// selectedRecordIds lives on state.selectedRecordIds (see modules/state.js)

function updateBottomActionBar() {
  const bar = document.getElementById('bottom-action-bar');
  const countEl = document.getElementById('bab-selected-count');
  if (!bar || !countEl) return;

  const count = state.selectedRecordIds.size;
  countEl.textContent = count;

  const deleteBtn = document.getElementById('bab-delete-btn');
  if (deleteBtn) {
    if (state.currentView === 'companies' && state.isSalesRep) {
      deleteBtn.style.display = 'none';
    } else {
      deleteBtn.style.display = '';
    }
  }

  if (count > 0) {
    bar.classList.add('active');
  } else {
    bar.classList.remove('active');
  }
}

function clearSelection() {
  state.selectedRecordIds.clear();
  document.querySelectorAll('.selection-checkbox').forEach(cb => cb.checked = false);
  updateBottomActionBar();
}

async function handleBatchDelete() {
  if (state.selectedRecordIds.size === 0) return;

  const type = state.currentView === 'companies' ? 'companies' : 'people';

  if (type === 'companies' && state.isSalesRep) {
    showToast('Sales representatives are not allowed to delete companies', 'error');
    return;
  }

  const label = state.selectedRecordIds.size === 1 ? (type === 'companies' ? 'company' : 'person') : (type === 'companies' ? 'companies' : 'people');
  
  const confirmed = await showConfirmDialog(
    `Delete ${state.selectedRecordIds.size} ${label}`,
    `Are you sure you want to delete the ${state.selectedRecordIds.size} selected ${label}? This action cannot be undone.`
  );

  if (!confirmed) return;

  const btn = document.getElementById('bab-delete-btn');
  const origHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

  try {
    const { error } = await supabaseClient
      .from(type)
      .delete()
      .in('id', Array.from(state.selectedRecordIds));

    if (error) throw error;

    showToast(`Successfully deleted ${state.selectedRecordIds.size} ${label}`, 'success');
    state.selectedRecordIds.clear();
    updateBottomActionBar();

    // Refresh view
    if (state.currentView === 'companies') {
      renderCompaniesView();
    } else if (state.currentView === 'people') {
      renderPeopleView();
    }
  } catch (e) {
    console.error(e);
    showToast(`Failed to delete ${label}: ` + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHTML;
  }
}

// Global delegated event listeners for selection
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('row-select')) {
    const id = e.target.dataset.id;
    if (e.target.checked) {
      state.selectedRecordIds.add(id);
    } else {
      state.selectedRecordIds.delete(id);
    }
    
    // Update "Select All" state
    const selectAll = document.getElementById(state.currentView + '-select-all');
    if (selectAll) {
      const rowSelects = document.querySelectorAll('.row-select');
      const allChecked = Array.from(rowSelects).every(cb => cb.checked);
      selectAll.checked = allChecked;
    }
    
    updateBottomActionBar();
  }

  if (e.target.id === 'companies-select-all' || e.target.id === 'people-select-all') {
    const isChecked = e.target.checked;
    const rowSelects = document.querySelectorAll('.row-select');
    
    rowSelects.forEach(cb => {
      const id = cb.dataset.id;
      cb.checked = isChecked;
      if (isChecked) {
        state.selectedRecordIds.add(id);
      } else {
        state.selectedRecordIds.delete(id);
      }
    });
    
    updateBottomActionBar();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bab-delete-btn')?.addEventListener('click', handleBatchDelete);
  document.getElementById('bab-clear-btn')?.addEventListener('click', clearSelection);
});



// ── Exports ────────────────────────────────────────────────────
export {
  updateBottomActionBar,
  clearSelection,
  handleBatchDelete,
};
