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

  if (!document.getElementById('um-role-select-style')) {
    const s = document.createElement('style');
    s.id = 'um-role-select-style';
    s.textContent = `.um-role-select{height:26px;padding:0 20px 0 8px;border:1px solid var(--border-color);border-radius:100px;background:var(--bg-secondary);color:var(--text-primary);font-size:0.74rem;font-weight:600;font-family:inherit;cursor:pointer;outline:none;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 6px center;transition:border-color 0.12s}.um-role-select:hover{border-color:var(--color-primary)}.um-role-select:disabled{opacity:0.45;cursor:not-allowed}`;
    document.head.appendChild(s);
  }

  let html = `

  `;

  const canManageUsers = state.isManager;

  users.forEach(user => {
    const initials = getInitials(`${user.first_name} ${user.last_name}`);
    const isCurrentUser = user.id === state.currentUser.id;
    const canEdit = canManageUsers && !isCurrentUser && user.role !== 'manager';
    const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email || 'Teammate';

    const roleLabel = r => r === 'manager' ? 'Manager' : r === 'sales_rep' ? 'Sales Rep' : r === 'technician' ? 'Technician' : (r || '');

    const roleCell = canEdit
      ? `<select class="um-role-select" onchange="window.umChangeMemberRole('${user.id}', this.value, this)">
          <option value="sales_rep"${user.role === 'sales_rep' ? ' selected' : ''}>Sales Rep</option>
          <option value="technician"${user.role === 'technician' ? ' selected' : ''}>Technician</option>
          <option value="manager"${user.role === 'manager' ? ' selected' : ''}>Manager</option>
         </select>`
      : `<span class="tag ${user.role === 'manager' ? '' : 'text-muted'}" style="background: ${user.role === 'manager' ? 'var(--color-primary-bg)' : 'var(--bg-tertiary)'};">${roleLabel(user.role)}</span>`;

    html += `
      <div class="card user-card">
        <div class="user-avatar" style="width: 48px; height: 48px; font-size: 1rem;">${initials}</div>
        <div class="user-card-info">
          <div class="user-card-name">${fullName}</div>
          <div class="user-card-email">${user.email}</div>
        </div>
        <div class="user-card-actions">
          ${roleCell}
          ${canEdit ? `
            <button class="btn btn-ghost btn-sm" onclick="window.umFullDeleteMember('${user.id}', '${(fullName).replace(/'/g, "\\'")}')">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>
            </button>
          ` : ''}
        </div>
      </div>
    `;
  });

  viewContainer.innerHTML = html;

  if (window.lucide) lucide.createIcons();
}

window.umChangeMemberRole = async function (userId, newRole, selectEl) {
  if (!state.isManager) { showToast('Only managers can change roles', 'error'); return; }
  selectEl.disabled = true;

  const { error } = await supabaseClient
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  selectEl.disabled = false;

  if (error) {
    showToast('Failed to change role: ' + error.message, 'error');
    return;
  }

  const label = newRole === 'manager' ? 'Manager' : newRole === 'sales_rep' ? 'Sales Rep' : 'Technician';
  showToast(`Role updated to ${label}`, 'success');
  [...selectEl.options].forEach(o => { o.defaultSelected = o.value === newRole; });
};

window.umFullDeleteMember = async function (userId, userName) {
  if (!state.isManager) { showToast('Only managers can remove members', 'error'); return; }

  const confirmed = await showConfirmDialog(
    'Remove member',
    `Remove ${userName}? This permanently deletes their account and all access.`
  );
  if (!confirmed) return;

  showToast('Removing member…', 'info');

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) throw new Error('Not authenticated');

    const supabaseUrl = (window.APP_CONFIG || {}).SUPABASE_URL || '';
    const res = await fetch(`${supabaseUrl}/functions/v1/delete-member`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });

    const result = await res.json();
    if (!res.ok || !result.success) throw new Error(result.error || 'Deletion failed');

    showToast(`${userName} removed`, 'success');
    renderUserManagementView();
  } catch (e) {
    showToast('Failed to remove member: ' + (e.message || 'Unknown error'), 'error');
  }
};

// Keep legacy deleteUser so any existing call sites don't break
window.deleteUser = window.umFullDeleteMember;


// ── Exports ────────────────────────────────────────────────────
export {
  renderUserManagementView,
};
