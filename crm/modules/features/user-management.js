// modules/features/user-management.js
// Team member / user management view.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml } from '../ui/toast.js';

// ======================

async function renderUserManagementView() {
  let usersQ = supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
  if (state.currentOrganization?.id) usersQ = usersQ.eq('organization_id', state.currentOrganization.id);
  const { data: users, error } = await usersQ;

  if (error) {
    viewContainer.innerHTML = renderError(error.message);
    return;
  }

  let html = `

  `;

  const canManageUsers = state.isManager;

  users.forEach(user => {
    const initials = getInitials(`${user.first_name} ${user.last_name}`);
    const isCurrentUser = user.id === state.currentUser.id;
    const canDeleteUser = user.role !== 'manager';
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Teammate';

    html += `
      <div class="card user-card">
        <div class="user-avatar" style="width: 48px; height: 48px; font-size: 1rem;">${initials}</div>
        <div class="user-card-info">
          <div class="user-card-name">${fullName}</div>
          <div class="user-card-email">${user.email}</div>
        </div>
        <div class="user-card-actions">
          <span class="tag ${user.role === 'manager' ? '' : 'text-muted'}" style="background: ${user.role === 'manager' ? 'var(--color-primary-bg)' : 'var(--bg-tertiary)'};">
            ${user.role === 'manager' ? 'Manager' : user.role === 'technician' ? 'Technician' : user.role === 'sales_rep' ? 'Sales Rep' : (user.role || '')}
          </span>
           ${isCurrentUser ? `` : ''}
          ${canManageUsers && !isCurrentUser && canDeleteUser ? `
            <button class="btn btn-ghost btn-sm" onclick="deleteUser('${user.id}', '${user.first_name} ${user.last_name}', '${user.role || ''}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  });

  viewContainer.innerHTML = html;

  if (window.lucide) lucide.createIcons();
}

window.deleteUser = async function (userId, userName, userRole = '') {
  if (!state.isManager) {
    showToast('Only managers can delete users', 'error');
    return;
  }

  if (userRole === 'manager') {
    showToast('Managers cannot delete other managers', 'error');
    return;
  }

  const { data: targetUser, error: targetUserError } = await supabaseClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (targetUserError) {
    showToast('Failed to validate user role: ' + targetUserError.message, 'error');
    return;
  }

  if (targetUser?.role === 'manager') {
    showToast('Managers cannot delete other managers', 'error');
    return;
  }

  const confirmed = await showConfirmDialog(
    'Delete User',
    `Are you sure you want to delete ${userName}?`
  );

  if (!confirmed) return;

  const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);

  if (error) {
    showToast('Failed to delete user: ' + error.message, 'error');
    return;
  }

  showToast('User deleted successfully', 'success');
  renderUserManagementView();
};


// ── Exports ────────────────────────────────────────────────────
export {
  renderUserManagementView,
};
