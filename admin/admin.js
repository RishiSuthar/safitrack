document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Supabase
    const { SUPABASE_URL, SUPABASE_KEY } = window.APP_CONFIG;
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window.supabaseClient = supabase;

    // Elements
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const dashboardContent = document.getElementById('dashboardContent');
    const errorMessage = document.getElementById('errorMessage');
    const adminUserBadge = document.getElementById('adminUserBadge');
    
    // Check Auth Status
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (authError || !session) {
        window.location.href = '../crm/index.html';
        return;
    }

    adminUserBadge.textContent = session.user.email;

    // Fetch Data from Super Admin API
    try {
        const { data, error } = await supabase.functions.invoke('super-admin-api');

        if (error) {
            throw error;
        }

        if (!data.success) {
            throw new Error(data.error || 'Failed to authenticate super admin');
        }

        renderDashboard(data);

    } catch (err) {
        console.error("Super Admin Auth Error:", err);
        loadingState.style.display = 'none';
        errorState.style.display = 'flex';
        errorMessage.textContent = err.message || "You do not have permission to access the Super Admin panel.";
    }

    // Render Dashboard
    function renderDashboard(data) {
        loadingState.style.display = 'none';
        dashboardContent.style.display = 'block';

        // Set KPIs
        document.getElementById('kpiTenants').textContent = data.summary.total_organizations;
        document.getElementById('kpiUsers').textContent = data.summary.total_users;
        document.getElementById('kpiData').textContent = data.summary.total_companies_tracked;

        // Render Table
        const tbody = document.getElementById('tenantsTableBody');
        tbody.innerHTML = '';

        if (!data.organizations || data.organizations.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No organizations found.</td></tr>';
            return;
        }

        data.organizations.forEach(org => {
            const tr = document.createElement('tr');
            const ownerEmail = org.profiles ? org.profiles.email : 'No owner';
            const date = new Date(org.created_at).toLocaleDateString();
            
            // For now, assuming active if they have an owner
            const statusClass = org.owner_id ? 'active' : 'trial';
            const statusText = org.owner_id ? 'Active' : 'Trial';

            let planName = 'Free Plan';
            if (org.max_members > 2 && org.max_members <= 20) {
                planName = 'Core Plan';
            } else if (org.max_members > 20) {
                planName = 'Pro Plan';
            }

            tr.innerHTML = `
                <td>
                    <div style="font-weight: 500; color: var(--text-primary);">${org.name}</div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">ID: ${org.id.split('-')[0]}...</div>
                </td>
                <td>${ownerEmail}</td>
                <td>${date}</td>
                <td>
                    <div id="view-seats-${org.id}" style="display: flex; align-items: center; gap: 8px;">
                        <span>Up to ${org.max_members}</span>
                        <button class="btn-small" onclick="toggleEditSeats('${org.id}', true)" style="background: transparent; border: none; text-decoration: underline; padding: 0;">Edit</button>
                    </div>
                    <div id="edit-seats-${org.id}" style="display: none; align-items: center; gap: 8px;">
                        <input type="number" id="members-${org.id}" value="${org.max_members}" style="width: 60px; padding: 4px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-base); color: var(--text-primary);" />
                        <button class="btn-small" onclick="updateMaxMembers('${org.id}')">Save</button>
                        <button class="btn-small" onclick="toggleEditSeats('${org.id}', false)" style="background: transparent; border: 1px solid transparent;">Cancel</button>
                    </div>
                </td>
                <td>
                    <div style="font-weight: 500;">${planName}</div>
                    <span class="status-badge ${statusClass}" style="margin-top: 4px; display: inline-block;">${statusText}</span>
                </td>
                <td>
                    <button class="btn-small" onclick="viewTenant('${org.id}')">View Details</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Render Release History
        const releasesBody = document.getElementById('releasesTableBody');
        releasesBody.innerHTML = '';

        if (!data.changelogs || data.changelogs.length === 0) {
            releasesBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-secondary);">No releases found.</td></tr>';
        } else {
            data.changelogs.forEach(release => {
                const tr = document.createElement('tr');
                
                const itemsList = release.items.map(i => {
                    let badgeColor = '#4299e1'; // new
                    if (i.type === 'improved') badgeColor = '#48bb78'; // improved
                    if (i.type === 'fixed') badgeColor = '#f56565'; // fixed
                    return `<div style="margin-bottom: 4px;">
                        <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; background: ${badgeColor}20; color: ${badgeColor}; padding: 2px 6px; border-radius: 4px; margin-right: 6px;">${i.type}</span>
                        <span style="font-size: 13px;">${i.text}</span>
                    </div>`;
                }).join('');

                tr.innerHTML = `
                    <td style="font-weight: 600;">v${release.version}</td>
                    <td>${release.date_string}</td>
                    <td>${itemsList}</td>
                `;
                releasesBody.appendChild(tr);
            });
        }
    }

    // Tab Switching Logic
    window.switchTab = function(tabId) {
        // Update Nav Active State
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.getElementById('nav-' + tabId).classList.add('active');

        // Toggle Content Sections
        document.getElementById('tab-dashboard').style.display = tabId === 'dashboard' ? 'block' : 'none';
        document.getElementById('tab-releases').style.display = tabId === 'releases' ? 'block' : 'none';
    };

    // Toggle Seats Edit Mode
    window.toggleEditSeats = function(orgId, isEditing) {
        document.getElementById(`view-seats-${orgId}`).style.display = isEditing ? 'none' : 'flex';
        document.getElementById(`edit-seats-${orgId}`).style.display = isEditing ? 'flex' : 'none';
    };

    // Update Max Members
    window.updateMaxMembers = async function(orgId) {
        const input = document.getElementById(`members-${orgId}`);
        const newValue = parseInt(input.value, 10);
        
        if (isNaN(newValue) || newValue < 1) {
            alert("Please enter a valid number greater than 0.");
            return;
        }

        input.disabled = true;
        
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const { data, error } = await supabase.functions.invoke('super-admin-api', {
                method: 'POST',
                body: {
                    action: 'update_max_members',
                    org_id: orgId,
                    max_members: newValue
                }
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error || 'Failed to update');

            // Instead of reloading, maybe just show a toast or alert
            // But easiest is to quickly reload the page to refresh data
            window.location.reload();

        } catch (err) {
            console.error("Update error:", err);
            alert("Failed to update max members: " + err.message);
            input.disabled = false;
        }
    };

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async (e) => {
        e.preventDefault();
        await supabase.auth.signOut();
        window.location.href = '../crm/index.html';
    });
});

window.addReleaseItemRow = function() {
    const container = document.getElementById('releaseItemsContainer');
    const div = document.createElement('div');
    div.className = 'release-item-row';
    div.style.cssText = 'display: flex; gap: 12px; align-items: center;';
    div.innerHTML = `
        <select class="admin-input item-type-select" style="width: 120px;">
            <option value="new">New</option>
            <option value="improved">Improved</option>
            <option value="fixed">Fixed</option>
        </select>
        <input type="text" placeholder="Description of the feature or fix..." class="admin-input item-text-input" style="flex: 1;" />
        <button class="btn-small" onclick="this.parentElement.remove()" style="color: var(--error); border-color: var(--error);">X</button>
    `;
    container.appendChild(div);
};

window.broadcastRelease = async function() {
    const btn = document.getElementById('broadcastBtn');
    const version = document.getElementById('releaseVersion').value.trim();
    const date_string = document.getElementById('releaseDate').value.trim();
    
    if (!version || !date_string) {
        alert("Version and Date are required!");
        return;
    }

    const rows = document.querySelectorAll('.release-item-row');
    const items = [];
    rows.forEach(row => {
        const type = row.querySelector('.item-type-select').value;
        const text = row.querySelector('.item-text-input').value.trim();
        if (text) {
            items.push({ type, text });
        }
    });

    if (items.length === 0) {
        alert("Please add at least one valid item description.");
        return;
    }

    btn.textContent = "Broadcasting...";
    btn.disabled = true;

    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        const { data, error } = await window.supabaseClient.functions.invoke('super-admin-api', {
            method: 'POST',
            body: {
                action: 'create_announcement',
                announcement: { version, date_string, items }
            }
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Failed to broadcast');

        alert("Release broadcasted successfully! Users will see it on their next login.");
        
        // Reset form
        document.getElementById('releaseVersion').value = '';
        document.getElementById('releaseDate').value = '';
        document.getElementById('releaseItemsContainer').innerHTML = `
            <div class="release-item-row" style="display: flex; gap: 12px; align-items: center;">
                <select class="admin-input item-type-select" style="width: 120px;">
                    <option value="new">New</option>
                    <option value="improved">Improved</option>
                    <option value="fixed">Fixed</option>
                </select>
                <input type="text" placeholder="Description of the feature or fix..." class="admin-input item-text-input" style="flex: 1;" />
            </div>
        `;

    } catch (err) {
        console.error("Broadcast error:", err);
        alert("Failed to broadcast: " + err.message);
    } finally {
        btn.textContent = "Broadcast Release";
        btn.disabled = false;
    }
};

window.viewTenant = function(id) {
    alert("Tenant Details view coming soon! ID: " + id);
}
