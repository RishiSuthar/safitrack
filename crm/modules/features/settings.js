// modules/features/settings.js
// Settings view: profile, organization, members, billing, theme.
import { state, supabaseClient } from '../state.js';
import { viewContainer } from '../ui/dom.js';
import { showToast, escapeHtml, getInitials, triggerConfetti } from '../ui/toast.js';
import { renderSkeletonCards, formatDate, CURRENCIES, getCurrencySymbol } from '../utils/helpers.js';
import { loadView } from '../core/navigation.js';

async function renderSettingsView() {
  const dateFormatPref = (typeof getUserDateFormat === 'function') ? getUserDateFormat() : (localStorage.getItem('safitrack_date_format') || 'DD/MM/YYYY');
  const emailNotifPref = (localStorage.getItem('safitrack_email_notifs') || 'true') === 'true';
  const currentTheme = localStorage.getItem('safitrack_theme') || localStorage.getItem('theme') || 'dark';
  function escH(s) { return (s || '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const maxSeats = state.currentOrganization?.max_members ?? 2;
  const getPlan = (seats) => seats <= 2 ? 'Free' : seats <= 20 ? 'Core' : 'Pro';
  const currentPlan = getPlan(maxSeats);
  const planPrice = { Free: '0', Core: '19', Pro: '79' };
  const planDesc = {
    Free: 'Basic access for small teams. Upgrade to unlock advanced features, higher limits, and priority support.',
    Core: 'Core plan — extended team access with higher limits and priority support.',
    Pro: 'Pro plan — unlimited members, advanced features, and dedicated support.',
  };

  const firstNameEsc = escH((state.currentUserProfile && state.currentUserProfile.first_name) ? state.currentUserProfile.first_name : '');
  const lastNameEsc = escH((state.currentUserProfile && state.currentUserProfile.last_name) ? state.currentUserProfile.last_name : '');
  const userEmailEsc = escH((state.currentUser && state.currentUser.email) ? state.currentUser.email : '');
  const roleEsc = escH((state.currentUserProfile && state.currentUserProfile.role) ? state.currentUserProfile.role : 'User');
  const initials = ((firstNameEsc ? firstNameEsc[0] : '') + (lastNameEsc ? lastNameEsc[0] : '')).toUpperCase() || (userEmailEsc ? userEmailEsc[0].toUpperCase() : 'U');
  const fullName = [firstNameEsc, lastNameEsc].filter(Boolean).join(' ') || 'Your Name';

  viewContainer.innerHTML = `
    <div class="sv-root">

      <!-- LEFT SIDEBAR NAV -->
      <nav class="sv-nav">
        <div class="sv-nav-section-label">Account</div>
        <button class="sv-nav-item active" data-section="profile">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
          Profile
        </button>
        <button class="sv-nav-item" data-section="security">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Security
        </button>
        <button class="sv-nav-item" data-section="preferences">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a7 7 0 1 0 10 10"/></svg>
          Appearance
        </button>
        <button class="sv-nav-item" data-section="notifications">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          Notifications
        </button>

        <div class="sv-nav-section-label" style="margin-top:24px;">Workspace</div>
        <button class="sv-nav-item" data-section="organization">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          Organization
        </button>
        <button class="sv-nav-item" data-section="members">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Members
        </button>
        ${state.isManager ? `<button class="sv-nav-item" data-section="billing">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/></svg>
          Billing
        </button>` : ''}

        <div class="sv-nav-section-label" style="margin-top:24px;">Help</div>
        <button class="sv-nav-item" data-section="support">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
          Support
        </button>

        <div class="sv-nav-divider"></div>

        <button class="sv-nav-item" data-section="export">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Export Data
        </button>
        <button class="sv-nav-item sv-nav-danger" data-section="danger">
          <svg class="sv-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          Delete Account
        </button>
      </nav>

      <!-- MAIN CONTENT -->
      <main class="sv-content">

        <!-- ═══════════════════ PROFILE ═══════════════════ -->
        <section class="sv-section" data-section="profile">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Profile</h2>
              <p class="sv-page-subtitle">Manage how you appear across your workspace.</p>
            </div>
            <div class="sv-page-header-actions">
              <div id="profile-save-status" class="sv-saved-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Saved
              </div>
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Avatar</div>
                <div class="sv-field-hint">Shown on comments, assignments, and mentions.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-avatar-wrap">
                  <div class="sv-avatar-circle" id="sv-settings-avatar-circle">
                    ${state.currentUserProfile?.avatar_url
                      ? `<img src="${state.currentUserProfile.avatar_url}" alt="" class="sv-avatar-img">`
                      : initials}
                    <div class="sv-avatar-overlay">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    </div>
                  </div>
                  <input type="file" id="sv-avatar-upload" accept="image/jpeg,image/png,image/webp" style="display:none;">
                  <div class="sv-avatar-info">
                    <span class="sv-avatar-name">${fullName}</span>
                    <div style="display:flex;gap:8px;align-items:center;">
                      <button class="sv-ghost-btn" id="sv-avatar-upload-btn">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        Upload photo
                      </button>
                      ${state.currentUserProfile?.avatar_url ? `<button class="sv-ghost-btn sv-ghost-btn--danger" id="sv-avatar-remove-btn" style="color:var(--color-danger,#ef4444);">Remove</button>` : ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Full name</div>
                <div class="sv-field-hint">Your name as it appears to other members.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-input-pair">
                  <input id="profile-firstname" class="sv-input" type="text" placeholder="First name" value="${firstNameEsc}">
                  <input id="profile-lastname" class="sv-input" type="text" placeholder="Last name" value="${lastNameEsc}">
                </div>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Role</div>
                <div class="sv-field-hint">Your permission level in this workspace.</div>
              </div>
              <div class="sv-field-control">
                <span class="sv-role-chip" data-role="${roleEsc.toLowerCase()}">${roleEsc}</span>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ SECURITY ═══════════════════ -->
        <section class="sv-section" data-section="security" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Security</h2>
              <p class="sv-page-subtitle">Control access and authentication for your account.</p>
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Email address</div>
                <div class="sv-field-hint">Used for sign-in and system notifications.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-locked-field">
                  <svg class="sv-locked-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <span class="sv-locked-field-val">${userEmailEsc}</span>
                  <span class="sv-verified-chip">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:10px;height:10px;"><polyline points="20 6 9 17 4 12"/></svg>
                    Verified
                  </span>
                  <button class="sv-locked-field-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Change
                  </button>
                </div>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Password</div>
                <div class="sv-field-hint">Keep your account secure with a strong password.</div>
              </div>
              <div class="sv-field-control">
                <button id="profile-change-password-btn" class="sv-ghost-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Update password
                </button>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Two-factor authentication</div>
                <div class="sv-field-hint">Require a verification code in addition to your password.</div>
              </div>
              <div class="sv-field-control" style="gap:12px;">
                <span class="sv-2fa-status">
                  <span class="sv-status-dot sv-status-dot--active"></span>
                  Active
                </span>
                <label class="sv-toggle">
                  <input type="checkbox" checked>
                  <span class="sv-toggle-track"><span class="sv-toggle-thumb"></span></span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ APPEARANCE ═══════════════════ -->
        <section class="sv-section" data-section="preferences" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Appearance</h2>
              <p class="sv-page-subtitle">Customize how SafiTrack looks and feels for you.</p>
            </div>
            <div id="pref-save-status" class="sv-saved-pill">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Saved
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row sv-field-row--block">
              <div class="sv-field-meta">
                <div class="sv-field-label">Theme</div>
                <div class="sv-field-hint">Choose a color scheme for the interface.</div>
              </div>
              <div class="sv-theme-grid">
                <button class="sv-theme-tile ${currentTheme === 'light' ? 'is-active' : ''}" data-theme-val="light">
                  <div class="sv-theme-mock sv-theme-mock--light">
                    <div class="sv-mock-sidebar-strip"></div>
                    <div class="sv-mock-body">
                      <div class="sv-mock-header-bar"></div>
                      <div class="sv-mock-rows">
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                      </div>
                    </div>
                  </div>
                  <div class="sv-theme-tile-footer">
                    <span class="sv-theme-tile-dot"></span>
                    Light
                  </div>
                </button>

                <button class="sv-theme-tile ${currentTheme === 'dark' ? 'is-active' : ''}" data-theme-val="dark">
                  <div class="sv-theme-mock sv-theme-mock--dark">
                    <div class="sv-mock-sidebar-strip"></div>
                    <div class="sv-mock-body">
                      <div class="sv-mock-header-bar"></div>
                      <div class="sv-mock-rows">
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                        <div class="sv-mock-row-item"></div>
                      </div>
                    </div>
                  </div>
                  <div class="sv-theme-tile-footer">
                    <span class="sv-theme-tile-dot"></span>
                    Dark
                  </div>
                </button>

                <button class="sv-theme-tile ${currentTheme === 'system' ? 'is-active' : ''}" data-theme-val="system">
                  <div class="sv-theme-mock sv-theme-mock--system">
                    <div class="sv-theme-mock-half sv-theme-mock-half--light">
                      <div class="sv-mock-sidebar-strip"></div>
                      <div class="sv-mock-body">
                        <div class="sv-mock-header-bar"></div>
                        <div class="sv-mock-rows">
                          <div class="sv-mock-row-item"></div>
                          <div class="sv-mock-row-item"></div>
                        </div>
                      </div>
                    </div>
                    <div class="sv-theme-mock-half sv-theme-mock-half--dark">
                      <div class="sv-mock-sidebar-strip"></div>
                      <div class="sv-mock-body">
                        <div class="sv-mock-header-bar"></div>
                        <div class="sv-mock-rows">
                          <div class="sv-mock-row-item"></div>
                          <div class="sv-mock-row-item"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="sv-theme-tile-footer">
                    <span class="sv-theme-tile-dot"></span>
                    System
                  </div>
                </button>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Date format</div>
                <div class="sv-field-hint">Controls how dates are displayed across the app.</div>
              </div>
              <div class="sv-field-control">
                <div class="sv-seg sv-date-segmented">
                  <button class="sv-seg-btn ${dateFormatPref === 'DD/MM/YYYY' ? 'is-active' : ''}" data-value="DD/MM/YYYY">DD/MM/YYYY</button>
                  <button class="sv-seg-btn ${dateFormatPref === 'MM/DD/YYYY' ? 'is-active' : ''}" data-value="MM/DD/YYYY">MM/DD/YYYY</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ NOTIFICATIONS ═══════════════════ -->
        <section class="sv-section" data-section="notifications" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Notifications</h2>
              <p class="sv-page-subtitle">Choose what you want to be notified about.</p>
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Email notifications</div>
                <div class="sv-field-hint">Summaries, activity updates, and important alerts by email.</div>
              </div>
              <div class="sv-field-control">
                <label class="sv-toggle">
                  <input id="pref-email-notifs" type="checkbox" ${emailNotifPref ? 'checked' : ''}>
                  <span class="sv-toggle-track"><span class="sv-toggle-thumb"></span></span>
                </label>
              </div>
            </div>

            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Browser push notifications</div>
                <div class="sv-field-hint">Instant alerts for reminders and @mentions in your browser.</div>
              </div>
              <div class="sv-field-control">
                <button id="enable-browser-notifs" class="sv-ghost-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  Enable push
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ ORGANIZATION ═══════════════════ -->
        <section class="sv-section" data-section="organization" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Organization</h2>
              <p class="sv-page-subtitle">Workspace identity and plan information.</p>
            </div>
          </div>

          <div class="sv-org-identity-card">
            <div class="sv-org-identity-avatar" id="sv-org-identity-avatar">
              ${state.currentOrganization?.logo_url
                ? `<img src="${state.currentOrganization.logo_url}" alt="" class="sv-org-logo-img">`
                : ((state.currentOrganization?.name || 'W').match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase()}
            </div>
            <div class="sv-org-identity-body">
              <div class="sv-org-identity-name">${escH(state.currentOrganization?.name || '—')}</div>
              <div class="sv-org-identity-id">
                <span class="sv-mono-chip">${escH((state.currentOrganization?.id || '').slice(0, 8).toUpperCase()) || '—'}</span>
              </div>
              ${state.isManager ? `
              <div style="display:flex;gap:8px;margin-top:6px;">
                <button class="sv-ghost-btn" id="sv-org-logo-upload-btn" style="font-size:0.78rem;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  ${state.currentOrganization?.logo_url ? 'Change logo' : 'Upload logo'}
                </button>
                ${state.currentOrganization?.logo_url ? `<button class="sv-ghost-btn" id="sv-org-logo-remove-btn" style="font-size:0.78rem;color:var(--color-danger,#ef4444);">Remove logo</button>` : ''}
              </div>
              <input type="file" id="sv-org-logo-upload" accept="image/jpeg,image/png,image/webp" style="display:none;">` : ''}
            </div>
            ${state.isManager ? `
            <button class="sv-ghost-btn" id="sv-org-name-edit-trigger">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Rename
            </button>` : ''}
          </div>

          ${state.isManager ? `
          <div class="sv-org-rename-block" id="sv-org-rename-form" style="display:none;">
            <label class="sv-field-label" style="display:block;margin-bottom:8px;" for="org-name-input">Workspace name</label>
            <div class="sv-org-rename-row">
              <input id="org-name-input" class="sv-input" type="text" value="${escH(state.currentOrganization?.name || '')}" placeholder="Organization name" autocomplete="off" style="max-width:260px;">
              <button id="org-name-save-btn" class="sv-primary-btn">Save</button>
              <button type="button" class="sv-ghost-btn" id="sv-org-rename-cancel">Cancel</button>
            </div>
            <p class="sv-field-hint" style="margin-top:8px;">Appears in your sidebar and email invitations.</p>
          </div>` : ''}

          <div class="sv-stat-row">
            <div class="sv-stat-tile">
              <div class="sv-stat-tile-label">Your role</div>
              <div class="sv-stat-tile-value"><span class="sv-role-chip" data-role="${roleEsc.toLowerCase()}">${roleEsc}</span></div>
            </div>
            ${state.isManager ? `<div class="sv-stat-tile">
              <div class="sv-stat-tile-label">Current plan</div>
              <div class="sv-stat-tile-value" style="gap:8px;">
                <span class="sv-plan-chip" data-plan="${currentPlan.toLowerCase()}">${currentPlan}</span>
                ${currentPlan === 'Free' ? `<a href="https://safitrack.netlify.app/pages/pricing" target="_blank" class="sv-stat-upgrade-link">Upgrade <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;"><path d="M13 7l5 5-5 5M6 12h12"/></svg></a>` : ''}
              </div>
            </div>` : ''}
            <div class="sv-stat-tile">
              <div class="sv-stat-tile-label">Seats used</div>
              <div class="sv-stat-tile-value--mono" id="sv-seat-count">— / ${state.currentOrganization?.max_members ?? 2}</div>
              <div class="sv-seat-bar-track">
                <div class="sv-seat-bar-fill" id="sv-seat-bar" style="width:0%"></div>
              </div>
            </div>
          </div>

          <!-- ── Organization Currency ── -->
          <div class="sv-field-group" style="margin-top:32px;border-top:1px solid var(--border-color);padding-top:24px;">
            <div class="sv-field-row ${state.isManager ? '' : 'sv-field-row--block'}">
              <div class="sv-field-meta">
                <div class="sv-field-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;display:inline-block;vertical-align:-1px;margin-right:5px;opacity:0.7;"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20M12 2a14.5 14.5 0 0 1 0 20M2 12h20"/></svg>
                  Organization Currency
                </div>
                <div class="sv-field-hint">Displays the currency symbol throughout the CRM. Values are not converted — only the symbol changes.</div>
              </div>
              <div class="sv-field-control" style="${state.isManager ? '' : 'justify-content:flex-start;margin-top:10px;'}">
                ${state.isManager ? `
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                  <div id="sv-currency-preview" style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;font-size:0.88rem;white-space:nowrap;">
                    <span style="font-size:1rem;font-weight:700;color:var(--text-primary);" id="sv-currency-symbol-preview">${getCurrencySymbol()}</span>
                    <span style="color:var(--text-muted);font-size:0.8rem;font-weight:500;" id="sv-currency-code-preview">${state.orgCurrency || 'USD'}</span>
                  </div>
                  <div class="crm-dd crm-dd--form" data-dd-id="sv-currency-select" style="width:230px;min-width:0;">
                    <button type="button" class="crm-dd-trigger has-value" aria-haspopup="listbox" aria-expanded="false">
                      <span class="crm-dd-label">${(() => { const c = CURRENCIES.find(x => x.code === (state.orgCurrency || 'USD')); return c ? `${c.symbol} — ${c.name} (${c.code})` : (state.orgCurrency || 'USD'); })()}</span>
                      <span class="crm-dd-chevron"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>
                    </button>
                    <div class="crm-dd-panel" role="listbox">
                      <ul class="crm-dd-list">
                        ${CURRENCIES.map(c => `<li class="crm-dd-option${(state.orgCurrency || 'USD') === c.code ? ' is-selected' : ''}" role="option" data-value="${c.code}" data-label="${c.symbol} \u2014 ${c.name} (${c.code})" tabindex="-1"><svg class="crm-dd-check" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>${c.symbol} \u2014 ${c.name} (${c.code})</li>`).join('')}
                      </ul>
                    </div>
                    <input class="crm-dd-value-input" type="hidden" id="sv-currency-select" value="${state.orgCurrency || 'USD'}">
                  </div>
                  <span id="sv-currency-status" style="font-size:0.82rem;color:var(--text-muted);"></span>
                </div>
                ` : `
                <div style="display:inline-flex;align-items:center;gap:6px;padding:5px 11px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;font-size:0.88rem;">
                  <span style="font-size:1rem;font-weight:700;color:var(--text-primary);" id="sv-currency-symbol-preview">${getCurrencySymbol()}</span>
                  <span style="color:var(--text-muted);font-size:0.8rem;font-weight:500;" id="sv-currency-code-preview">${state.orgCurrency || 'USD'}</span>
                </div>
                <span style="color:var(--text-muted);font-size:0.82rem;margin-left:4px;">Only managers can change the currency.</span>
                `}
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ MEMBERS ═══════════════════ -->
        <section class="sv-section" data-section="members" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Members</h2>
              ${state.currentOrganization ? `<p class="sv-page-subtitle">${escH(state.currentOrganization.name)}</p>` : '<p class="sv-page-subtitle">Manage who has access to this workspace.</p>'}
            </div>
            ${state.isManager ? '<button class="sv-primary-btn" id="invite-member-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Invite member</button>' : ''}
          </div>

          <div class="sv-members-search-bar">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg>
            <input type="text" placeholder="Search by name or email…" id="sv-member-search">
          </div>

          <div class="sv-members-table-wrap">
            <table class="sv-members-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="sv-members-container">
                <tr><td colspan="4" class="sv-table-empty">Loading members…</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ═══════════════════ BILLING ═══════════════════ -->
        <section class="sv-section" data-section="billing" data-manager-only="true" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Billing</h2>
              <p class="sv-page-subtitle">Your subscription and plan details.</p>
            </div>
          </div>

          <div class="sv-billing-block">

            <!-- Current plan header -->
            <div class="sv-billing-plan-header">
              <div class="sv-billing-plan-left">
                <span class="sv-plan-chip" data-plan="${currentPlan.toLowerCase()}">${currentPlan}</span>
                <div class="sv-billing-plan-name">${currentPlan} Plan</div>
                <div class="sv-billing-plan-desc">${planDesc[currentPlan]}</div>
              </div>
              <div class="sv-billing-price-block">
                <div class="sv-billing-price-amount">
                  <span class="sv-billing-price-currency">$</span>
                  <span class="sv-billing-price-number">${planPrice[currentPlan]}</span>
                </div>
                <div class="sv-billing-price-meta">per user / month</div>
                <a href="https://safitrack.netlify.app/pages/pricing" target="_blank" class="sv-primary-btn" style="text-decoration:none;margin-top:12px;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;margin-right:6px;"><path d="M13 7l5 5-5 5M6 12h12"/></svg>
                  ${currentPlan === 'Pro' ? 'Manage plan' : 'Upgrade plan'}
                </a>
              </div>
            </div>

            <!-- Plan comparison tiers -->
            <div class="sv-billing-tiers">
              <div class="sv-billing-tier ${currentPlan === 'Free' ? 'is-current' : ''}">
                <div class="sv-billing-tier-top">
                  <span class="sv-billing-tier-name">Free</span>
                  ${currentPlan === 'Free' ? '<span class="sv-billing-tier-badge">Current</span>' : ''}
                </div>
                <div class="sv-billing-tier-price"><span class="sv-billing-tier-amount">$0</span><span class="sv-billing-tier-cadence">/user/mo</span></div>
                <div class="sv-billing-tier-seats">Up to 2 seats</div>
              </div>
              <div class="sv-billing-tier ${currentPlan === 'Core' ? 'is-current' : ''}">
                <div class="sv-billing-tier-top">
                  <span class="sv-billing-tier-name">Core</span>
                  ${currentPlan === 'Core' ? '<span class="sv-billing-tier-badge">Current</span>' : ''}
                </div>
                <div class="sv-billing-tier-price"><span class="sv-billing-tier-amount">$19</span><span class="sv-billing-tier-cadence">/user/mo</span></div>
                <div class="sv-billing-tier-seats">Up to 20 seats</div>
              </div>
              <div class="sv-billing-tier ${currentPlan === 'Pro' ? 'is-current' : ''}">
                <div class="sv-billing-tier-top">
                  <span class="sv-billing-tier-name">Pro</span>
                  ${currentPlan === 'Pro' ? '<span class="sv-billing-tier-badge">Current</span>' : ''}
                </div>
                <div class="sv-billing-tier-price"><span class="sv-billing-tier-amount">$79</span><span class="sv-billing-tier-cadence">/user/mo</span></div>
                <div class="sv-billing-tier-seats">Unlimited seats</div>
              </div>
            </div>

            <div class="sv-billing-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Plan changes cannot be made from the CRM. The button above links to our pricing page.
            </div>
          </div>

          <!-- Invoices -->
          <div class="sv-invoices-block">
            <div class="sv-invoices-header">
              <div class="sv-invoices-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                Invoices
              </div>
              <span class="sv-invoices-note">Generated monthly on your billing date</span>
            </div>
            <table class="sv-invoices-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Period</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="sv-invoices-body">
                ${(() => {
      const rows = [];
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const periodStart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const invoiceNum = `ST-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
        const pricePerSeat = parseFloat(planPrice[currentPlan]) || 0;
        const amount = pricePerSeat === 0 ? '$0.00' : `$${(pricePerSeat * maxSeats).toFixed(2)}`;
        const isPaid = true;
        rows.push(`
                      <tr>
                        <td class="sv-invoice-num">${invoiceNum}</td>
                        <td class="sv-invoice-period">${periodStart} – ${periodEnd}</td>
                        <td><span class="sv-plan-chip" data-plan="${currentPlan.toLowerCase()}" style="font-size:0.68rem;padding:2px 7px;">${currentPlan}</span></td>
                        <td class="sv-invoice-amount">${amount}</td>
                        <td><span class="sv-invoice-status ${isPaid ? 'is-paid' : 'is-pending'}">${isPaid ? 'Paid' : 'Pending'}</span></td>
                        <td class="sv-invoice-action-cell">
                          <button class="sv-invoice-dl-btn" data-invoice="${invoiceNum}" data-period-start="${periodStart}" data-period-end="${periodEnd}" data-amount="${amount}" data-plan="${currentPlan}" title="Download PDF">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            PDF
                          </button>
                        </td>
                      </tr>`);
      }
      return rows.join('');
    })()}
              </tbody>
            </table>
          </div>
        </section>

        <!-- ═══════════════════ EXPORT ═══════════════════ -->
        <section class="sv-section" data-section="export" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Export Data</h2>
              <p class="sv-page-subtitle">Download a copy of your data and activity records.</p>
            </div>
          </div>

          <div class="sv-field-group">
            <div class="sv-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Personal data export</div>
                <div class="sv-field-hint">A JSON file containing your profile, activity, and records.</div>
              </div>
              <div class="sv-field-control">
                <button id="export-data-btn" class="sv-ghost-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export as JSON
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- ═══════════════════ DANGER ═══════════════════ -->
        <section class="sv-section" data-section="danger" style="display:none;">
          <div class="sv-page-header">
            <div>
              <h2 class="sv-page-title">Delete Account</h2>
              <p class="sv-page-subtitle">Permanently remove your account and all associated data.</p>
            </div>
          </div>

          <div class="sv-danger-callout">
            <div class="sv-danger-callout-header">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <span>Danger zone — these actions are irreversible</span>
            </div>

            <div class="sv-danger-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Deactivate account</div>
                <div class="sv-field-hint">Temporarily suspends your access. You can reactivate by signing in again.</div>
              </div>
              <div class="sv-field-control">
                <button class="sv-ghost-btn sv-ghost-btn--danger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  Deactivate
                </button>
              </div>
            </div>

            <div class="sv-danger-divider"></div>

            <div class="sv-danger-field-row">
              <div class="sv-field-meta">
                <div class="sv-field-label">Delete account permanently</div>
                <div class="sv-field-hint">Removes your account, data, and workspace access from SafiTrack forever.</div>
              </div>
              <div class="sv-field-control">
                <button id="delete-account-btn" class="sv-danger-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  Delete account
                </button>
              </div>
            </div>

            ${state.isOrgOwner ? `
            <div class="sv-danger-divider"></div>

            <div class="sv-danger-field-row sv-danger-field-row--owner">
              <div class="sv-field-meta">
                <div class="sv-field-label">
                  Delete entire organization
                  <span class="sv-owner-badge">Owner only</span>
                </div>
                <div class="sv-field-hint">Permanently deletes this workspace, all members, and every record. This action cannot be undone.</div>
              </div>
              <div class="sv-field-control">
                <button id="delete-org-btn" class="sv-danger-btn sv-danger-btn--filled">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  Delete organization
                </button>
              </div>
            </div>
            ` : ''}
          </div>
        </section>

        <!-- ═══════════════════ SUPPORT ═══════════════════ -->
        <section class="sv-section" data-section="support" style="display:none; height: 100%; flex-direction: column;">
          <div class="sv-page-header" style="flex-shrink: 0;">
            <div>
              <h2 class="sv-page-title">Support</h2>
              <p class="sv-page-subtitle">Chat with our AI support assistant.</p>
            </div>
          </div>

          <!-- API Key Config removed (now using backend proxy) -->

          <!-- Chat UI -->
          <div class="sv-support-chat-wrapper" style="flex: 1; display: flex; flex-direction: column; padding: 20px 0;">
            <div class="sv-support-chat-container" style="flex: 1; display: flex; flex-direction: column; border-radius: 16px; background: var(--bg-secondary); overflow: hidden; box-shadow: 0 10px 30px -10px rgba(0,0,0,0.1); border: 1px solid var(--border-color); min-height: 400px; position: relative;">
              
              <!-- Chat Header -->
              <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); background: var(--bg-primary); display: flex; align-items: center; gap: 12px; z-index: 10;">
                <div style="width: 40px; height: 40px; border-radius: 12px; background: var(--bg-primary); display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.05); border: 1px solid var(--border-color); padding: 6px; box-sizing: border-box;">
                  <img src="https://i.imgur.com/4pIw8QP.png" alt="Logo" style="width: 100%; height: 100%; object-fit: contain;">
                </div>
                <div>
                  <h3 style="margin: 0; font-size: 1rem; font-weight: 600; color: var(--text-primary);">SafiTrack Assistant</h3>
                  <div style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
                    Online and ready to help
                  </div>
                </div>
              </div>

              <!-- Chat Messages -->
              <div id="sv-support-chat-messages" style="flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 20px; background: var(--bg-primary);">
                <!-- Initial Message -->
                <div style="display: flex; gap: 12px; align-items: flex-end; animation: slideInLeft 0.3s ease-out forwards;">
                  <div style="width: 32px; height: 32px; border-radius: 10px; background: var(--bg-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid var(--border-color); padding: 4px; box-sizing: border-box;">
                    <img src="https://i.imgur.com/4pIw8QP.png" alt="Logo" style="width: 100%; height: 100%; object-fit: contain;">
                  </div>
                  <div style="background: var(--bg-secondary); padding: 14px 18px; border-radius: 18px; border-bottom-left-radius: 4px; border: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.95rem; max-width: 80%; line-height: 1.5; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                    Hi there! I'm the SafiTrack Support Assistant. How can I help you today?
                  </div>
                </div>
              </div>
              
              <!-- Chat Input -->
              <div style="padding: 20px; border-top: 1px solid var(--border-color); background: var(--bg-primary);">
                <div style="display: flex; gap: 10px; background: var(--bg-secondary); padding: 6px 6px 6px 16px; border-radius: 24px; border: 1px solid var(--border-color); align-items: center; box-shadow: 0 2px 6px rgba(0,0,0,0.02); transition: border-color 0.2s, box-shadow 0.2s;" onfocusin="this.style.borderColor='var(--color-primary)'; this.style.boxShadow='0 0 0 2px rgba(99, 102, 241, 0.2)';" onfocusout="this.style.borderColor='var(--border-color)'; this.style.boxShadow='0 2px 6px rgba(0,0,0,0.02)';">
                  <input type="text" id="sv-support-chat-input" placeholder="Type your message here..." style="flex: 1; border: none; background: transparent; outline: none; color: var(--text-primary); font-size: 0.95rem; font-family: inherit;">
                  <button id="sv-support-chat-send" style="background: linear-gradient(135deg, var(--color-primary), #6366f1); border: none; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 2px 8px rgba(99,102,241,0.3);" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px; margin-left: -2px;"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  `;

  /* ─────────────── STYLES ─────────────── */
  if (!document.getElementById('sv-styles')) {
    const style = document.createElement('style');
    style.id = 'sv-styles';
    style.textContent = `
      /* ── Root shell ── */
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(10px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes slideInLeft {
        from { opacity: 0; transform: translateX(-10px); }
        to { opacity: 1; transform: translateX(0); }
      }
      @keyframes blink {
        0% { opacity: 0.2; transform: scale(0.8); }
        20% { opacity: 1; transform: scale(1.1); }
        100% { opacity: 0.2; transform: scale(0.8); }
      }

      .sv-root {
        display: flex;
        height: 720px;
        max-height: 90vh;
        width: 100%;
        max-width: 1100px;
        margin: 0 auto;
        overflow: hidden;
        background: var(--bg-primary);
        font-family: 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
        border-radius: 12px;
        border: 1px solid var(--border-color);
        box-shadow: 0 8px 40px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06);
      }

      /* ── Sidebar ── */
      .sv-nav {
        width: 210px;
        flex-shrink: 0;
        padding: 20px 10px;
        border-right: 1px solid var(--border-color);
        background: var(--bg-secondary);
        display: flex;
        flex-direction: column;
        gap: 1px;
        overflow-y: auto;
      }
      .sv-nav-section-label {
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
        padding: 6px 10px 4px;
        margin-top: 4px;
      }
      .sv-nav-item {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 7px 10px;
        border: none;
        background: transparent;
        border-radius: var(--btn-radius);
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--text-secondary);
        cursor: pointer;
        text-align: left;
        font-family: inherit;
        transition: background 0.1s, color 0.1s;
        letter-spacing: -0.01em;
      }
      .sv-nav-item:hover { background: var(--bg-tertiary, rgba(0,0,0,0.04)); color: var(--text-primary); }
      .sv-nav-item.active {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-primary);
        font-weight: 600;
      }
      .sv-nav-icon {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
        opacity: 0.7;
      }
      .sv-nav-item.active .sv-nav-icon { opacity: 1; }
      .sv-nav-divider { height: 1px; background: var(--border-color); margin: 10px 10px; }
      .sv-nav-danger { color: #dc2626 !important; }
      .sv-nav-danger:hover { background: rgba(220,38,38,0.06) !important; }
      .sv-nav-danger.active { background: rgba(220,38,38,0.08) !important; color: #dc2626 !important; }

      /* ── Main content ── */
      .sv-content {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        padding: 40px 52px;
        background: var(--bg-primary);
        scroll-behavior: smooth;
      }
      .sv-section { max-width: 680px; }

      /* ── Page header ── */
      .sv-page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 32px;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--border-color);
      }
      .sv-page-header > div:first-child {
        padding-left: 14px;
        border-left: 2.5px solid var(--color-primary);
      }
      .sv-page-header-actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .sv-icon-btn {
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--btn-radius);
        border: 1px solid var(--border-color);
        background: var(--bg-secondary);
        color: var(--text-secondary);
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.12s;
      }
      .sv-icon-btn:hover {
        background: var(--bg-primary);
        color: var(--text-primary);
        border-color: var(--border-color);
      }
      .sv-icon-btn.sv-settings-close-btn:hover {
        background-color: #ef4444 !important;
        border-color: #ef4444 !important;
        color: #fff !important;
      }
      .sv-page-title {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.025em;
        margin: 0 0 4px;
        line-height: 1.2;
      }
      .sv-page-subtitle {
        font-size: 0.9rem;
        color: var(--text-muted);
        margin: 0;
        line-height: 1.5;
      }

      /* ── Saved pill ── */
      .sv-saved-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.8rem;
        font-weight: 550;
        color: #059669;
        background: rgba(5,150,105,0.08);
        border: 1px solid rgba(5,150,105,0.18);
        border-radius: 100px;
        padding: 4px 10px;
        opacity: 0;
        transition: opacity 0.25s;
        white-space: nowrap;
        flex-shrink: 0;
        margin-top: 4px;
      }
      .sv-saved-pill svg { width: 11px; height: 11px; }

      /* ── Field groups ── */
      .sv-field-group {
        display: flex;
        flex-direction: column;
      }
      .sv-field-group--danger .sv-field-row { border-color: rgba(220,38,38,0.12); }
      .sv-field-row {
        display: flex;
        align-items: center;
        gap: 32px;
        padding: 20px 0;
        border-bottom: 1px solid var(--border-color);
      }
      .sv-field-row:first-child { padding-top: 0; }
      .sv-field-row:last-child { border-bottom: none; padding-bottom: 0; }
      .sv-field-row--block { flex-direction: column; align-items: flex-start; gap: 16px; }
      .sv-field-meta { flex: 0 0 220px; }
      .sv-field-label {
        font-size: 0.92rem;
        font-weight: 600;
        color: var(--text-primary);
        letter-spacing: -0.01em;
        margin-bottom: 3px;
      }
      .sv-field-hint {
        font-size: 0.84rem;
        color: var(--text-muted);
        line-height: 1.5;
      }
      .sv-field-control {
        flex: 1;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
      }
      .sv-field-control--split { justify-content: flex-end; gap: 12px; }
      .sv-field-row--block .sv-field-meta { flex: none; }
      .sv-field-row--block .sv-field-control { justify-content: flex-start; width: 100%; }

      /* ── Inputs ── */
      .sv-input {
        width: 100%;
        padding: 8px 12px;
        border-radius: 6px;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-primary);
        font-size: 0.92rem;
        font-family: inherit;
        transition: border-color 0.12s, box-shadow 0.12s;
        outline: none;
        box-sizing: border-box;
        letter-spacing: -0.01em;
      }
      .sv-input:focus {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 14%, transparent);
      }
      .sv-input-pair { display: flex; gap: 8px; width: 100%; justify-content: flex-end; }
      .sv-input-pair .sv-input { max-width: 180px; }

      /* ── Buttons ── */
      .sv-primary-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: var(--control-height-md);
        padding: 0 14px;
        border-radius: var(--btn-radius);
        border: none;
        background: var(--color-primary);
        color: #fff;
        font-size: 0.88rem;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.12s;
        font-family: inherit;
        letter-spacing: -0.01em;
      }
      .sv-primary-btn:hover { opacity: 0.88; }

      .sv-ghost-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: var(--control-height-md);
        padding: 0 11px;
        border-radius: var(--btn-radius);
        border: 1px solid var(--border-color);
        background: transparent;
        color: var(--text-secondary);
        font-size: 0.86rem;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.1s, border-color 0.1s, color 0.1s;
        font-family: inherit;
        letter-spacing: -0.01em;
      }
      .sv-ghost-btn:hover { background: var(--bg-secondary); color: var(--text-primary); border-color: color-mix(in srgb, var(--border-color) 60%, var(--text-primary)); }
      .sv-ghost-btn--danger { color: #dc2626 !important; border-color: rgba(220,38,38,0.25) !important; }
      .sv-ghost-btn--danger:hover { background: rgba(220,38,38,0.05) !important; border-color: rgba(220,38,38,0.4) !important; }

      .sv-danger-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: var(--control-height-md);
        padding: 0 12px;
        border-radius: var(--btn-radius);
        border: 1px solid rgba(220,38,38,0.3);
        background: rgba(220,38,38,0.05);
        color: #dc2626;
        font-size: 0.86rem;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s;
        font-family: inherit;
      }
      .sv-danger-btn:hover { background: rgba(220,38,38,0.1); border-color: #dc2626; }
      .sv-danger-btn--filled {
        background: #dc2626;
        border-color: #dc2626;
        color: #fff;
        white-space: nowrap;
        padding: 0 16px;
      }
      .sv-danger-btn--filled:hover { background: #b91c1c; border-color: #b91c1c; }
      .sv-danger-field-row--owner {
        background: rgba(220,38,38,0.03);
        border-radius: 0 0 10px 10px;
      }
      [data-theme="dark"] .sv-danger-field-row--owner { background: rgba(220,38,38,0.06); }
      .sv-owner-badge {
        display: inline-flex;
        align-items: center;
        margin-left: 8px;
        padding: 1px 7px;
        border-radius: 100px;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        background: rgba(220,38,38,0.1);
        color: #dc2626;
        border: 1px solid rgba(220,38,38,0.25);
        vertical-align: middle;
      }

      /* ── Role / plan chips ── */
      .sv-role-chip, .sv-plan-chip {
        display: inline-flex;
        align-items: center;
        padding: 3px 10px;
        border-radius: 100px;
        font-size: 0.74rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        white-space: nowrap;
      }
      .sv-role-chip {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-primary);
        border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
        text-transform: capitalize;
      }
      .sv-role-chip[data-role="manager"] {
        background: rgba(167,139,250,0.14);
        color: #a78bfa;
        border-color: rgba(167,139,250,0.28);
      }
      .sv-role-chip[data-role="sales_rep"] {
        background: rgba(5,150,105,0.10);
        color: #059669;
        border-color: rgba(5,150,105,0.22);
      }
      .sv-role-chip[data-role="technician"] {
        background: rgba(234,88,12,0.10);
        color: #ea580c;
        border-color: rgba(234,88,12,0.22);
      }
      .sv-role-chip[data-role="member"] {
        background: rgba(100,116,139,0.10);
        color: #64748b;
        border-color: rgba(100,116,139,0.22);
      }
      .sv-plan-chip {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-primary);
        border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 3px 8px;
        font-size: 0.7rem;
      }
      .sv-plan-chip[data-plan="core"] {
        background: rgba(5,150,105,0.10);
        color: #059669;
        border-color: rgba(5,150,105,0.22);
      }
      .sv-plan-chip[data-plan="pro"] {
        background: rgba(124,58,237,0.10);
        color: #a78bfa;
        border-color: rgba(167,139,250,0.28);
      }

      /* ── Chips / display elements ── */
      .sv-verified-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.74rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: #059669;
        background: rgba(5,150,105,0.08);
        border: 1px solid rgba(5,150,105,0.16);
        border-radius: 4px;
        padding: 2px 7px;
      }
      .sv-mono-chip {
        font-family: 'Geist Mono', 'Fira Code', ui-monospace, monospace;
        font-size: 0.72rem;
        color: var(--text-muted);
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        padding: 2px 7px;
        letter-spacing: 0.08em;
      }

      /* ── Email row ── */
      .sv-email-row { display: flex; align-items: center; gap: 10px; }
      .sv-email-val { font-size: 0.92rem; font-weight: 500; color: var(--text-primary); letter-spacing: -0.01em; }

      /* ── Toggle ── */
      .sv-toggle { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; cursor: pointer; }
      .sv-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
      .sv-toggle-track { position: absolute; inset: 0; border-radius: 100px; background: var(--border-color); transition: background 0.2s; }
      .sv-toggle input:checked + .sv-toggle-track { background: var(--color-primary); }
      .sv-toggle-thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.18); transition: transform 0.2s cubic-bezier(0.4,0,0.2,1); }
      .sv-toggle input:checked ~ .sv-toggle-track .sv-toggle-thumb { transform: translateX(18px); }

      /* ── Profile avatar ── */
      .sv-avatar-wrap { display: flex; align-items: center; gap: 16px; }
      .sv-avatar-circle {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--color-primary) 0%, #818cf8 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.15rem;
        font-weight: 700;
        color: #fff;
        flex-shrink: 0;
        letter-spacing: -0.03em;
        position: relative;
        cursor: pointer;
        overflow: hidden;
      }
      .sv-avatar-overlay {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: rgba(0,0,0,0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.18s;
      }
      .sv-avatar-overlay svg { width: 18px; height: 18px; color: #fff; }
      .sv-avatar-circle:hover .sv-avatar-overlay { opacity: 1; }
      .sv-avatar-info { display: flex; flex-direction: column; gap: 5px; }
      .sv-avatar-name { font-size: 0.96rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.02em; }

      /* Avatar photo fills the circle */
      .sv-avatar-img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        display: block;
      }

      /* ── Theme tiles ── */
      .sv-theme-grid { display: flex; gap: 12px; width: 100%; }
      .sv-theme-tile {
        flex: 1;
        border: 1.5px solid var(--border-color);
        border-radius: 8px;
        background: transparent;
        padding: 0;
        cursor: pointer;
        overflow: hidden;
        transition: border-color 0.15s;
        text-align: left;
        font-family: inherit;
      }
      .sv-theme-tile:hover { border-color: color-mix(in srgb, var(--border-color) 50%, var(--text-primary)); }
      .sv-theme-tile.is-active { border-color: var(--color-primary); box-shadow: 0 0 0 1px var(--color-primary); }

      .sv-theme-mock {
        height: 90px;
        display: flex;
        border-bottom: 1.5px solid var(--border-color);
        overflow: hidden;
      }
      .sv-theme-tile.is-active .sv-theme-mock { border-bottom-color: var(--color-primary); }
      .sv-theme-mock--light { background: #f8fafc; }
      .sv-theme-mock--dark { background: #0d1117; }
      .sv-theme-mock--system { background: transparent; }

      .sv-theme-mock-half { flex: 1; display: flex; }
      .sv-theme-mock-half--light { background: #f8fafc; }
      .sv-theme-mock-half--dark { background: #0d1117; }

      .sv-mock-sidebar-strip {
        width: 28px;
        flex-shrink: 0;
        border-right: 1px solid rgba(0,0,0,0.07);
      }
      .sv-theme-mock--dark .sv-mock-sidebar-strip,
      .sv-theme-mock-half--dark .sv-mock-sidebar-strip { border-right-color: rgba(255,255,255,0.06); }

      .sv-mock-body { flex: 1; padding: 10px 8px; }
      .sv-mock-header-bar { height: 3px; border-radius: 2px; background: rgba(0,0,0,0.08); margin-bottom: 8px; width: 55%; }
      .sv-theme-mock--dark .sv-mock-header-bar,
      .sv-theme-mock-half--dark .sv-mock-header-bar { background: rgba(255,255,255,0.1); }

      .sv-mock-rows { display: flex; flex-direction: column; gap: 5px; }
      .sv-mock-row-item { height: 2px; border-radius: 1px; background: rgba(0,0,0,0.06); }
      .sv-mock-row-item:nth-child(2) { width: 75%; }
      .sv-mock-row-item:nth-child(3) { width: 50%; }
      .sv-theme-mock--dark .sv-mock-row-item,
      .sv-theme-mock-half--dark .sv-mock-row-item { background: rgba(255,255,255,0.07); }

      .sv-theme-tile-footer {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 9px 12px;
        font-size: 0.84rem;
        font-weight: 500;
        color: var(--text-muted);
        background: var(--bg-primary);
        letter-spacing: -0.01em;
      }
      .sv-theme-tile.is-active .sv-theme-tile-footer { color: var(--color-primary); }
      .sv-theme-tile-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        border: 1.5px solid var(--border-color);
        flex-shrink: 0;
        transition: background 0.15s, border-color 0.15s;
      }
      .sv-theme-tile.is-active .sv-theme-tile-dot { background: var(--color-primary); border-color: var(--color-primary); }

      /* ── Segmented ── */
      .sv-seg {
        display: inline-flex;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 2px;
        background: var(--bg-secondary);
        gap: 2px;
      }
      .sv-seg-btn {
        padding: 6px 14px;
        border: none;
        background: transparent;
        font-size: 0.86rem;
        font-weight: 500;
        color: var(--text-muted);
        cursor: pointer;
        font-family: inherit;
        border-radius: 4px;
        transition: background 0.12s, color 0.12s;
        letter-spacing: -0.01em;
      }
      .sv-seg-btn:hover { color: var(--text-primary); }
      .sv-seg-btn.is-active { background: var(--color-primary); color: #ffffff; font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }

      /* ── Organization identity card ── */
      .sv-org-identity-card {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 18px 20px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        margin-bottom: 16px;
      }
      .sv-org-identity-avatar {
        width: 42px;
        height: 42px;
        border-radius: 8px;
        background: linear-gradient(135deg, var(--color-primary) 0%, #818cf8 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.95rem;
        font-weight: 800;
        color: #fff;
        letter-spacing: -0.04em;
        flex-shrink: 0;
        overflow: hidden;
      }
      /* Org logo image inside the identity avatar */
      .sv-org-logo-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 8px;
        display: block;
      }
      .sv-org-identity-body { flex: 1; min-width: 0; }
      .sv-org-identity-name { font-size: 0.98rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; margin-bottom: 4px; }
      .sv-org-identity-id { display: flex; align-items: center; }

      /* ── Org rename block ── */
      .sv-org-rename-block {
        padding: 16px 20px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        margin-bottom: 16px;
      }
      .sv-org-rename-row { display: flex; align-items: center; gap: 8px; }

      /* ── Stat row ── */
      .sv-stat-row { display: flex; gap: 10px; }
      .sv-stat-tile {
        flex: 1;
        padding: 14px 16px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
      }
      .sv-stat-tile-label { font-size: 0.74rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); margin-bottom: 8px; }
      .sv-stat-tile-value { display: flex; align-items: center; }
      .sv-stat-tile-value--mono { font-size: 1rem; font-weight: 700; color: var(--text-primary); font-family: 'Geist Mono', ui-monospace, monospace; letter-spacing: -0.02em; margin-bottom: 10px; }
      .sv-stat-upgrade-link {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-primary);
        text-decoration: none;
        opacity: 0.8;
        transition: opacity 0.12s;
      }
      .sv-stat-upgrade-link:hover { opacity: 1; }

      /* ── Seat progress bar ── */
      .sv-seat-bar-track {
        height: 4px;
        border-radius: 100px;
        background: var(--border-color);
        margin-top: 10px;
        overflow: hidden;
      }
      .sv-seat-bar-fill {
        height: 100%;
        border-radius: 100px;
        background: var(--color-primary);
        transition: width 0.4s cubic-bezier(0.4,0,0.2,1);
      }
      .sv-seat-bar-fill.is-full { background: #ef4444; }

      /* ── Locked field (Security email) ── */
      .sv-locked-field {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 9px 14px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--bg-secondary);
        max-width: 100%;
      }
      .sv-locked-field-icon {
        width: 14px;
        height: 14px;
        color: var(--text-muted);
        flex-shrink: 0;
      }
      .sv-locked-field-val {
        font-size: 0.9rem;
        font-weight: 500;
        color: var(--text-primary);
        letter-spacing: -0.01em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sv-locked-field-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-left: 4px;
        padding: 4px 9px;
        border-radius: 5px;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-secondary);
        font-size: 0.78rem;
        font-weight: 500;
        font-family: inherit;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.1s, color 0.1s, border-color 0.1s;
      }
      .sv-locked-field-btn:hover { background: var(--bg-tertiary, var(--bg-secondary)); color: var(--text-primary); border-color: color-mix(in srgb, var(--border-color) 60%, var(--text-primary)); }

      /* ── Members table ── */
      .sv-members-search-bar {
        position: relative;
        display: flex;
        align-items: center;
        border: 1px solid var(--border-color);
        border-radius: 10px;
        background: var(--bg-secondary);
        margin-bottom: 16px;
        max-width: 360px;
        height: 36px;
      }
      .sv-members-search-bar i,
      .sv-members-search-bar svg { position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-muted); pointer-events: none; }
      .sv-members-search-bar input { width: 100%; height: 100%; border: none; background: transparent; outline: none; padding: 0 0.75rem 0 2.5rem; font-size: 0.875rem; color: var(--text-primary); font-family: inherit; border-radius: 10px; }
      .sv-members-search-bar input:focus { box-shadow: 0 0 0 3px var(--color-primary-bg); border-color: var(--color-primary); }
      .sv-members-search-bar input::placeholder { color: var(--text-muted); }
      .sv-members-table-wrap { border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
      .sv-members-table { width: 100%; border-collapse: collapse; text-align: left; }
      .sv-members-table th { font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; padding: 11px 16px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
      .sv-members-table td { padding: 13px 16px; border-bottom: 1px solid var(--border-color); vertical-align: middle; font-size: 0.9rem; }
      .sv-members-table tbody tr:last-child td { border-bottom: none; }
      .sv-members-table tbody tr { transition: background 0.1s; }
      .sv-members-table tbody tr:hover { background: color-mix(in srgb, var(--bg-secondary) 60%, transparent); }
      .sv-table-empty { padding: 48px; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

      .sv-member-cell { display: flex; align-items: center; gap: 12px; }
      .sv-member-avatar {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: 0.72rem;
        color: #fff;
        flex-shrink: 0;
        letter-spacing: -0.02em;
      }
      .sv-member-avatar[data-color="0"] { background: linear-gradient(135deg, #3b82f6, #6366f1); }
      .sv-member-avatar[data-color="1"] { background: linear-gradient(135deg, #0d9488, #06b6d4); }
      .sv-member-avatar[data-color="2"] { background: linear-gradient(135deg, #f59e0b, #f97316); }
      .sv-member-avatar[data-color="3"] { background: linear-gradient(135deg, #ec4899, #f43f5e); }
      .sv-member-avatar[data-color="4"] { background: linear-gradient(135deg, #8b5cf6, #a78bfa); }
      .sv-member-avatar[data-color="5"] { background: linear-gradient(135deg, #10b981, #34d399); }
      .sv-member-info { display: flex; flex-direction: column; gap: 2px; }
      .sv-member-name { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); letter-spacing: -0.01em; }
      .sv-member-email { font-size: 0.82rem; color: var(--text-muted); }
      .sv-you-badge { font-size: 0.64rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 3px; padding: 1px 5px; margin-left: 6px; }

      .sv-status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 6px; }
      .sv-status-dot--active { background: #10b981; }
      .sv-status-dot--invited { background: #f59e0b; }
      .sv-status-text { font-size: 0.86rem; color: var(--text-muted); }



      .sv-member-remove-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 5px;
        border: none;
        background: transparent;
        color: var(--text-muted);
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.12s, background 0.12s, color 0.12s;
      }
      .sv-members-table tbody tr:hover .sv-member-remove-btn { opacity: 1; }
      .sv-member-remove-btn:hover { background: rgba(220,38,38,0.08); color: #dc2626; }
      .sv-member-actions-cell { text-align: right; width: 48px; }

      /* ── Billing ── */
      .sv-billing-block {
        border: 1px solid var(--border-color);
        border-radius: 10px;
        overflow: hidden;
        background: var(--bg-secondary);
      }
      .sv-billing-plan-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 24px;
        padding: 24px 24px 20px;
        border-bottom: 1px solid var(--border-color);
      }
      .sv-billing-plan-left { display: flex; flex-direction: column; gap: 7px; }
      .sv-billing-plan-name { font-size: 1.05rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; }
      .sv-billing-plan-desc { font-size: 0.84rem; color: var(--text-muted); line-height: 1.55; max-width: 280px; }

      .sv-billing-price-block {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        flex-shrink: 0;
      }
      .sv-billing-price-amount {
        display: flex;
        align-items: flex-start;
        gap: 2px;
        line-height: 1;
      }
      .sv-billing-price-currency {
        font-size: 1rem;
        font-weight: 700;
        color: var(--text-muted);
        margin-top: 4px;
      }
      .sv-billing-price-number {
        font-size: 2.6rem;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: -0.04em;
        line-height: 1;
      }
      .sv-billing-price-meta {
        font-size: 0.76rem;
        color: var(--text-muted);
        font-weight: 500;
        margin-top: 4px;
        text-align: right;
      }

      /* ── Plan tier comparison row ── */
      .sv-billing-tiers {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        border-bottom: 1px solid var(--border-color);
      }
      .sv-billing-tier {
        padding: 16px 20px;
        border-right: 1px solid var(--border-color);
        transition: background 0.12s;
      }
      .sv-billing-tier:last-child { border-right: none; }
      .sv-billing-tier.is-current {
        background: color-mix(in srgb, var(--color-primary) 5%, transparent);
      }
      .sv-billing-tier-top {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .sv-billing-tier-name {
        font-size: 0.8rem;
        font-weight: 700;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .sv-billing-tier.is-current .sv-billing-tier-name { color: var(--color-primary); }
      .sv-billing-tier-badge {
        font-size: 0.65rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-primary);
        background: color-mix(in srgb, var(--color-primary) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
        border-radius: 100px;
        padding: 1px 7px;
      }
      .sv-billing-tier-price {
        display: flex;
        align-items: baseline;
        gap: 3px;
        margin-bottom: 4px;
      }
      .sv-billing-tier-amount {
        font-size: 1.3rem;
        font-weight: 800;
        color: var(--text-primary);
        letter-spacing: -0.03em;
      }
      .sv-billing-tier.is-current .sv-billing-tier-amount { color: var(--color-primary); }
      .sv-billing-tier-cadence {
        font-size: 0.75rem;
        color: var(--text-muted);
        font-weight: 500;
      }
      .sv-billing-tier-seats {
        font-size: 0.78rem;
        color: var(--text-muted);
        font-weight: 500;
      }

      .sv-billing-notice {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 13px 24px;
        background: var(--bg-primary);
        font-size: 0.82rem;
        color: var(--text-muted);
        line-height: 1.5;
      }
      .sv-billing-notice svg { width: 13px; height: 13px; flex-shrink: 0; margin-top: 1px; }

      /* ── 2FA status badge ── */
      .sv-2fa-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
        font-weight: 600;
        color: #059669;
        background: rgba(5,150,105,0.08);
        border: 1px solid rgba(5,150,105,0.18);
        border-radius: 100px;
        padding: 3px 9px;
      }

      /* ── Danger zone card ── */
      .sv-danger-callout {
        border: 1px solid rgba(220,38,38,0.25);
        border-radius: 10px;
        background: rgba(220,38,38,0.03);
        overflow: hidden;
      }
      .sv-danger-callout-header {
        display: flex;
        align-items: center;
        gap: 9px;
        padding: 12px 20px;
        background: rgba(220,38,38,0.06);
        border-bottom: 1px solid rgba(220,38,38,0.15);
        font-size: 0.8rem;
        font-weight: 700;
        color: #dc2626;
        letter-spacing: 0.01em;
      }
      .sv-danger-callout-header svg { width: 15px; height: 15px; flex-shrink: 0; }
      .sv-danger-field-row {
        display: flex;
        align-items: center;
        gap: 32px;
        padding: 20px;
      }
      .sv-danger-field-row .sv-field-meta { flex: 0 0 220px; }
      .sv-danger-field-row .sv-field-control { flex: 1; display: flex; justify-content: flex-end; }
      .sv-danger-field-row .sv-field-label { color: var(--text-primary); }
      .sv-danger-divider { height: 1px; background: rgba(220,38,38,0.12); margin: 0 20px; }

      /* ── Invoices ── */
      .sv-invoices-block {
        margin-top: 24px;
        border: 1px solid var(--border-color);
        border-radius: 10px;
        overflow: hidden;
        background: var(--bg-secondary);
      }
      .sv-invoices-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 20px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-secondary);
      }
      .sv-invoices-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.88rem;
        font-weight: 700;
        color: var(--text-primary);
        letter-spacing: -0.01em;
      }
      .sv-invoices-title svg { color: var(--text-muted); }
      .sv-invoices-note {
        font-size: 0.76rem;
        color: var(--text-muted);
        font-weight: 500;
      }
      .sv-invoices-table { width: 100%; border-collapse: collapse; }
      .sv-invoices-table th {
        font-size: 0.68rem;
        font-weight: 700;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.07em;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border-color);
        background: var(--bg-primary);
        text-align: left;
      }
      .sv-invoices-table td {
        padding: 12px 16px;
        border-bottom: 1px solid var(--border-color);
        font-size: 0.85rem;
        vertical-align: middle;
      }
      .sv-invoices-table tbody tr:last-child td { border-bottom: none; }
      .sv-invoices-table tbody tr { transition: background 0.1s; }
      .sv-invoices-table tbody tr:hover { background: color-mix(in srgb, var(--bg-primary) 60%, transparent); }
      .sv-invoice-num { font-family: 'Courier New', monospace; font-size: 0.8rem; color: var(--text-muted); font-weight: 600; letter-spacing: 0.02em; }
      .sv-invoice-period { font-size: 0.84rem; color: var(--text-secondary); }
      .sv-invoice-amount { font-size: 0.88rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
      .sv-invoice-status {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.74rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 3px 8px;
        border-radius: 100px;
      }
      .sv-invoice-status.is-paid { background: rgba(5,150,105,0.1); color: #059669; border: 1px solid rgba(5,150,105,0.2); }
      .sv-invoice-status.is-pending { background: rgba(245,158,11,0.1); color: #d97706; border: 1px solid rgba(245,158,11,0.2); }
      .sv-invoice-action-cell { text-align: right; width: 80px; }
      .sv-invoice-dl-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 5px;
        border: 1px solid var(--border-color);
        background: var(--bg-primary);
        color: var(--text-secondary);
        font-size: 0.78rem;
        font-weight: 600;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.1s;
        opacity: 0;
      }
      .sv-invoices-table tbody tr:hover .sv-invoice-dl-btn { opacity: 1; }
      .sv-invoice-dl-btn:hover { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }

      /* ── Responsive ── */
      @media (max-width: 860px) {
        .sv-root { flex-direction: column; height: auto; max-height: none; border-radius: 8px; }
        .sv-nav { width: 100%; flex-direction: row; flex-wrap: nowrap; overflow-x: auto; padding: 10px; border-right: none; border-bottom: 1px solid var(--border-color); gap: 2px; }
        .sv-nav-section-label, .sv-nav-divider { display: none; }
        .sv-nav-item { white-space: nowrap; width: auto; padding: 7px 12px; border-radius: 100px; font-size: 0.86rem; }
        .sv-nav-icon { display: none; }
        .sv-content { padding: 28px 20px; }
        .sv-field-row { flex-direction: column; gap: 12px; align-items: flex-start; }
        .sv-field-meta { flex: none; width: 100%; }
        .sv-field-control { justify-content: flex-start; }
        .sv-input-pair { flex-direction: column; }
        .sv-input-pair .sv-input { max-width: 100%; }
        .sv-theme-grid { flex-direction: column; }
        .sv-stat-row { flex-direction: column; }
      }
    `;
    document.head.appendChild(style);
  }

  // Ensure every settings section has a close button in the header.
  function attachSettingsCloseButtons() {
    document.querySelectorAll('.sv-page-header').forEach(header => {
      if (header.querySelector('.sv-settings-close-btn')) return;

      let actions = header.querySelector('.sv-page-header-actions');
      if (!actions) {
        actions = document.createElement('div');
        actions.className = 'sv-page-header-actions';
        header.appendChild(actions);
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sv-icon-btn sv-settings-close-btn';
      btn.title = 'Close';
      btn.setAttribute('aria-label', 'Close settings');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;">
          <path d="M18 6 6 18" />
          <path d="M6 6 18 18" />
        </svg>
      `;
      actions.appendChild(btn);
    });

    document.querySelectorAll('.sv-settings-close-btn').forEach(btn => {
      btn.onclick = () => {
        const target = state.previousView || localStorage.getItem('lastActiveView') || 'main-dashboard';
        loadView(target);
      };
    });
  }

  attachSettingsCloseButtons();

  /* ─────────────── SECTION NAV ─────────────── */
  function setActiveSection(name) {
    document.querySelectorAll('.sv-nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === name));
    document.querySelectorAll('.sv-section').forEach(s => {
      if (s.dataset.section === name) {
        s.style.display = (name === 'support') ? 'flex' : 'block';
      } else {
        s.style.display = 'none';
      }
    });
  }
  document.querySelectorAll('.sv-nav-item').forEach(btn => btn.addEventListener('click', () => setActiveSection(btn.dataset.section)));

  // Hide manager-only sections from non-managers (billing section)
  if (!state.isManager) {
    document.querySelectorAll('[data-manager-only="true"]').forEach(el => {
      el.style.display = 'none';
      el.dataset.hidden = 'true';
    });
  }

  /* ─────────────── AUTO-SAVE ─────────────── */
  let saveTimeout;
  const showSaveStatus = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 2500);
  };

  const autoSaveSettings = async (sectionId) => {
    try {
      const firstName = document.getElementById('profile-firstname')?.value?.trim();
      const lastName = document.getElementById('profile-lastname')?.value?.trim();
      const dateFormat = document.querySelector('.sv-date-segmented .is-active')?.dataset?.value || dateFormatPref;
      const emailNotifs = document.getElementById('pref-email-notifs')?.checked || false;

      localStorage.setItem('safitrack_date_format', dateFormat);
      localStorage.setItem('safitrack_email_notifs', emailNotifs ? 'true' : 'false');

      if (typeof supabaseClient !== 'undefined' && state.currentUser?.id) {
        const updates = {};
        if (firstName) updates.first_name = firstName;
        if (lastName) updates.last_name = lastName;
        updates.date_format = dateFormat;
        updates.email_notifications = emailNotifs;
        const { data: updated, error } = await supabaseClient.from('profiles').update(updates).eq('id', state.currentUser.id).select().single();
        if (!error) {
          try { state.currentUserProfile = { ...(state.currentUserProfile || {}), ...(updated || {}) }; } catch (e) { }
          showSaveStatus(sectionId === 'profile' ? 'profile-save-status' : 'pref-save-status');
          const fName = updated.first_name || '';
          const lName = updated.last_name || '';
          const email = state.currentUser?.email || '';
          const init = ((fName ? fName[0] : '') + (lName ? lName[0] : '')).toUpperCase() || (email ? email[0].toUpperCase() : 'U');
          const full = [fName, lName].filter(Boolean).join(' ') || 'Your Name';
          document.querySelectorAll('.sv-nav-avatar, .sv-avatar-circle').forEach(el => el.textContent = init);
          document.querySelectorAll('.sv-nav-user-name, .sv-avatar-name').forEach(el => el.textContent = full);
        }
      } else {
        showSaveStatus(sectionId === 'profile' ? 'profile-save-status' : 'pref-save-status');
      }
      if (sectionId !== 'profile') refreshCurrentView();
    } catch (e) { console.error(e); }
  };

  const debounceSave = (sectionId) => {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => autoSaveSettings(sectionId), 700);
  };

  /* ─────────────── DATE SEGMENT ─────────────── */
  document.querySelectorAll('.sv-date-segmented .sv-seg-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.sv-date-segmented .sv-seg-btn').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
    autoSaveSettings('preferences');
  }));

  /* ─────────────── THEME TILES ─────────────── */
  document.querySelectorAll('.sv-theme-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sv-theme-tile').forEach(x => x.classList.remove('is-active'));
      btn.classList.add('is-active');
      const newTheme = btn.dataset.themeVal;
      localStorage.setItem('safitrack_theme', newTheme);
      let actualTheme = newTheme;
      if (newTheme === 'system') actualTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', actualTheme);
      if (typeof updateChartColors === 'function') setTimeout(updateChartColors, 50);
    });
  });

  /* ─────────────── CHANGE PASSWORD ─────────────── */
  window.openChangePasswordModal = function () {
    const modal = document.getElementById('change-password-modal');
    if (modal) {
      document.getElementById('change-password-form').reset();
      modal.style.display = 'flex';
      const saveBtn = document.getElementById('save-new-password-btn');
      saveBtn.onclick = submitChangePassword;
    }
  };

  window.togglePasswordVisibility = function (inputId, btn) {
    const input = document.getElementById(inputId);
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
      input.type = 'text';
      icon.classList.remove('fa-eye');
      icon.classList.add('fa-eye-slash');
    } else {
      input.type = 'password';
      icon.classList.remove('fa-eye-slash');
      icon.classList.add('fa-eye');
    }
  };

  async function submitChangePassword() {
    const newPass = document.getElementById('new-password').value;
    const confirmPass = document.getElementById('confirm-new-password').value;

    if (newPass !== confirmPass) {
      showToast('Passwords do not match', 'error');
      return;
    }

    const btn = document.getElementById('save-new-password-btn');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

    const { data, error } = await supabaseClient.auth.updateUser({
      password: newPass
    });

    if (error) {
      showToast(error.message, 'error');
      btn.disabled = false;
      btn.innerHTML = originalText;
    } else {
      showToast('Password updated successfully', 'success');
      // We don't have closeModal from helpers easily accessible here without window.closeModal, assuming it's global
      if (window.closeModal) {
        window.closeModal('change-password-modal');
      } else {
        document.getElementById('change-password-modal').style.display = 'none';
      }
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }

  document.getElementById('profile-change-password-btn')?.addEventListener('click', () => {
    try { window.openChangePasswordModal(); } catch (e) { console.error(e); }
  });

  /* ─────────────── BROWSER NOTIFS ─────────────── */
  document.getElementById('enable-browser-notifs')?.addEventListener('click', async () => {
    try {
      const perm = await Notification.requestPermission();
      showToast(perm === 'granted' ? 'Browser notifications enabled' : 'Browser notifications not enabled', perm === 'granted' ? 'success' : 'warning');
    } catch (e) { showToast('Unable to enable notifications', 'error'); }
  });

  /* ─────────────── DELETE ACCOUNT ─────────────── */
  document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
    // Step 1: require typed confirmation
    const typed = prompt('To permanently delete your account, type DELETE in all caps:');
    if (typed !== 'DELETE') {
      if (typed !== null) showToast('Confirmation did not match. Account not deleted.', 'error');
      return;
    }

    // Step 2: if manager, ensure at least one other manager exists
    if (state.isManager) {
      try {
        const { data: otherManagers, error: mgErr } = await supabaseClient
          .from('profiles')
          .select('id')
          .eq('org_id', state.currentOrganization?.id)
          .eq('role', 'manager')
          .neq('id', state.currentUser.id)
          .limit(1);
        if (mgErr) throw mgErr;
        if (!otherManagers || otherManagers.length === 0) {
          showToast('You are the only manager. Promote another member to manager before deleting your account.', 'error');
          return;
        }
      } catch (e) {
        console.error('Manager check error:', e);
        showToast('Could not verify manager status. Please try again.', 'error');
        return;
      }
    }

    // Step 3: delete profile row (cascades app data) then sign out
    try {
      showToast('Deleting your account…', 'info');
      const { error: delErr } = await supabaseClient
        .from('profiles')
        .delete()
        .eq('id', state.currentUser.id);
      if (delErr) throw delErr;
      showToast('Account deleted. Goodbye!', 'success');
      setTimeout(async () => {
        await supabaseClient.auth.signOut();
      }, 1200);
    } catch (e) {
      console.error('Account deletion error:', e);
      showToast('Failed to delete account: ' + (e.message || 'Unknown error'), 'error');
    }
  });

  /* ─────────────── DELETE ORGANIZATION (owner only) ─────────────── */
  document.getElementById('delete-org-btn')?.addEventListener('click', async () => {
    if (!state.isOrgOwner) {
      showToast('Only the organization owner can perform this action', 'error');
      return;
    }

    const orgName = state.currentOrganization?.name || 'your organization';

    const confirmed = await showDeleteOrgModal(orgName);
    if (!confirmed) return;

    showToast('Deleting organization… this may take a moment.', 'info');

    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error('Not authenticated');

      const supabaseUrl = (window.APP_CONFIG || {}).SUPABASE_URL || '';
      const res = await fetch(`${supabaseUrl}/functions/v1/delete-organization`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Deletion failed');
      }

      showToast('Organization deleted. Goodbye!', 'success');
      setTimeout(async () => {
        await supabaseClient.auth.signOut();
      }, 1500);
    } catch (e) {
      console.error('Organization deletion error:', e);
      showToast('Failed to delete organization: ' + (e.message || 'Unknown error'), 'error');
    }
  });

  function showDeleteOrgModal(orgName) {
    return new Promise((resolve) => {
      // Remove any existing instance
      document.getElementById('delete-org-overlay')?.remove();

      const overlay = document.createElement('div');
      overlay.id = 'delete-org-overlay';
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:9999;
        display:flex;align-items:center;justify-content:center;
        background:rgba(0,0,0,0.55);backdrop-filter:blur(3px);
        padding:16px;box-sizing:border-box;
      `;

      overlay.innerHTML = `
        <div id="delete-org-modal" style="
          width:100%;max-width:460px;
          background:var(--bg-primary);
          border:1px solid var(--border-color);
          border-radius:14px;
          box-shadow:0 24px 60px rgba(0,0,0,0.22);
          overflow:hidden;
          font-family:'Manrope',-apple-system,BlinkMacSystemFont,sans-serif;
          animation:doModalIn 0.18s ease;
        ">

          <!-- Step 1: Warning -->
          <div id="dorg-step-1">
            <div style="padding:24px 24px 0;display:flex;flex-direction:column;align-items:center;text-align:center;">
              <div style="
                width:52px;height:52px;border-radius:50%;
                background:rgba(220,38,38,0.1);
                border:1.5px solid rgba(220,38,38,0.25);
                display:flex;align-items:center;justify-content:center;
                margin-bottom:16px;flex-shrink:0;
              ">
                <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <div style="font-size:1.05rem;font-weight:700;color:var(--text-primary);margin-bottom:8px;letter-spacing:-0.01em;">
                This cannot be undone
              </div>
              <div style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;max-width:340px;">
                You are about to permanently delete <strong style="color:var(--text-primary);">${escapeHtml(orgName)}</strong> and wipe all of its data from SafiTrack.
              </div>
            </div>

            <div style="
              margin:20px 24px;
              background:rgba(220,38,38,0.05);
              border:1px solid rgba(220,38,38,0.18);
              border-radius:10px;
              padding:14px 16px;
            ">
              <div style="font-size:0.76rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#dc2626;margin-bottom:10px;">What will be permanently deleted</div>
              <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:7px;">
                ${[
                  ['All team members & their accounts', 'users'],
                  ['Contacts — people & companies', 'book-open'],
                  ['Sales visits, tasks & reminders', 'check-square'],
                  ['Opportunities & call logs', 'phone'],
                  ['Routes, notes & workflows', 'map'],
                  ['Pending invitations', 'mail'],
                ].map(([label, _]) => `
                  <li style="display:flex;align-items:center;gap:8px;font-size:0.84rem;color:var(--text-secondary);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0;opacity:0.7;">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    ${label}
                  </li>
                `).join('')}
              </ul>
            </div>

            <div style="
              display:flex;gap:10px;justify-content:flex-end;
              padding:16px 24px;border-top:1px solid var(--border-color);
            ">
              <button id="dorg-cancel-1" style="
                height:36px;padding:0 16px;border-radius:6px;
                border:1px solid var(--border-color);background:var(--bg-secondary);
                color:var(--text-secondary);font-size:0.875rem;font-weight:600;
                cursor:pointer;font-family:inherit;
              ">Cancel</button>
              <button id="dorg-proceed" style="
                height:36px;padding:0 16px;border-radius:6px;
                border:1px solid rgba(220,38,38,0.4);background:rgba(220,38,38,0.08);
                color:#dc2626;font-size:0.875rem;font-weight:600;
                cursor:pointer;font-family:inherit;
              ">I understand, continue →</button>
            </div>
          </div>

          <!-- Step 2: Confirm name -->
          <div id="dorg-step-2" style="display:none;">
            <div style="padding:24px 24px 0;">
              <div style="font-size:1.05rem;font-weight:700;color:var(--text-primary);margin-bottom:6px;letter-spacing:-0.01em;">Confirm deletion</div>
              <div style="font-size:0.875rem;color:var(--text-secondary);line-height:1.55;">
                Type <strong style="
                  color:var(--text-primary);
                  background:var(--bg-secondary);
                  border:1px solid var(--border-color);
                  border-radius:4px;
                  padding:1px 6px;
                  font-family:monospace;
                  font-size:0.82rem;
                ">${escapeHtml(orgName)}</strong> to confirm.
              </div>

              <input id="dorg-name-input" type="text" autocomplete="off" spellcheck="false"
                placeholder="${escapeHtml(orgName)}"
                style="
                  display:block;width:100%;box-sizing:border-box;margin-top:16px;
                  height:40px;padding:0 12px;
                  border:1.5px solid var(--border-color);border-radius:8px;
                  background:var(--bg-secondary);color:var(--text-primary);
                  font-size:0.9rem;font-family:inherit;
                  outline:none;transition:border-color 0.15s,box-shadow 0.15s;
                "
              >
              <div id="dorg-input-hint" style="margin-top:6px;font-size:0.78rem;color:var(--text-muted);min-height:16px;"></div>
            </div>

            <div style="
              display:flex;gap:10px;justify-content:flex-end;
              padding:16px 24px;margin-top:8px;border-top:1px solid var(--border-color);
            ">
              <button id="dorg-cancel-2" style="
                height:36px;padding:0 16px;border-radius:6px;
                border:1px solid var(--border-color);background:var(--bg-secondary);
                color:var(--text-secondary);font-size:0.875rem;font-weight:600;
                cursor:pointer;font-family:inherit;
              ">Cancel</button>
              <button id="dorg-confirm-delete" disabled style="
                height:36px;padding:0 16px;border-radius:6px;
                border:1px solid rgba(220,38,38,0.3);background:#dc2626;
                color:#fff;font-size:0.875rem;font-weight:600;
                cursor:not-allowed;font-family:inherit;opacity:0.45;
                display:inline-flex;align-items:center;gap:6px;
                transition:opacity 0.15s,background 0.15s;
              ">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                Delete organization
              </button>
            </div>
          </div>
        </div>

        <style>
          @keyframes doModalIn { from { opacity:0; transform:scale(0.95) translateY(8px); } to { opacity:1; transform:none; } }
          #dorg-cancel-1:hover, #dorg-cancel-2:hover { background:var(--bg-tertiary,rgba(0,0,0,0.06)) !important; }
          #dorg-proceed:hover { background:rgba(220,38,38,0.14) !important; }
          #dorg-confirm-delete:not([disabled]):hover { background:#b91c1c !important; }
        </style>
      `;

      document.body.appendChild(overlay);

      const step1 = overlay.querySelector('#dorg-step-1');
      const step2 = overlay.querySelector('#dorg-step-2');
      const nameInput = overlay.querySelector('#dorg-name-input');
      const confirmBtn = overlay.querySelector('#dorg-confirm-delete');
      const hint = overlay.querySelector('#dorg-input-hint');

      const dismiss = (result) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };

      overlay.querySelector('#dorg-cancel-1').addEventListener('click', () => dismiss(false));
      overlay.querySelector('#dorg-cancel-2').addEventListener('click', () => dismiss(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(false); });

      overlay.querySelector('#dorg-proceed').addEventListener('click', () => {
        step1.style.display = 'none';
        step2.style.display = '';
        setTimeout(() => nameInput.focus(), 50);
      });

      nameInput.addEventListener('input', () => {
        const val = nameInput.value;
        const match = val.trim() === orgName.trim();
        confirmBtn.disabled = !match;
        confirmBtn.style.opacity = match ? '1' : '0.45';
        confirmBtn.style.cursor = match ? 'pointer' : 'not-allowed';
        nameInput.style.borderColor = val.length === 0
          ? 'var(--border-color)'
          : match ? '#16a34a' : '#dc2626';
        nameInput.style.boxShadow = val.length === 0
          ? 'none'
          : match ? '0 0 0 3px rgba(22,163,74,0.15)' : '0 0 0 3px rgba(220,38,38,0.12)';
        hint.textContent = val.length > 0 && !match ? 'Name does not match — check capitalization.' : '';
        hint.style.color = '#dc2626';
      });

      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click();
      });

      confirmBtn.addEventListener('click', () => { if (!confirmBtn.disabled) dismiss(true); });

      const onKey = (e) => { if (e.key === 'Escape') dismiss(false); };
      document.addEventListener('keydown', onKey);
    });
  }

  /* ─────────────── EXPORT ─────────────── */
  document.getElementById('export-data-btn')?.addEventListener('click', () => showToast('Preparing export…', 'info'));

  /* ─────────────── INVOICE PDF GENERATOR ─────────────── */
  const loadJsPDF = () => new Promise((resolve, reject) => {
    if (window.jspdf) return resolve(window.jspdf.jsPDF);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = reject;
    document.head.appendChild(s);
  });

  const fetchLogoBase64 = () => new Promise((resolve) => {
    fetch('https://safitrack.netlify.app/assets/icons/transparentMain.png')
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      })
      .catch(() => resolve(null));
  });

  const generateInvoicePDF = async (btn) => {
    const { dataset } = btn;
    const origHTML = btn.innerHTML;
    btn.textContent = '…';
    btn.disabled = true;

    try {
      const [JsPDF, logoDataUrl] = await Promise.all([loadJsPDF(), fetchLogoBase64()]);
      const doc = new JsPDF({ unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const M = 52; // margin

      // ── Palette ──
      const black = [11, 12, 14];
      const body = [55, 65, 81];
      const muted = [107, 114, 128];
      const label = [156, 163, 175];
      const border = [229, 231, 235];
      const bg = [248, 250, 252];
      const white = [255, 255, 255];
      const accent = [37, 99, 235];
      const green = [5, 150, 105];

      // ── Data ──
      const orgName = state.currentOrganization?.name || 'Your Organization';
      const invoiceNum = dataset.invoice;
      const periodStart = dataset.periodStart;
      const periodEnd = dataset.periodEnd;
      const planName = dataset.plan;
      const seats = parseInt(dataset.seats || maxSeats, 10);
      const pricePerSeat = parseFloat(planPrice[planName]) || 0;
      const unitPrice = `$${pricePerSeat.toFixed(2)}`;
      const amount = pricePerSeat === 0 ? '$0.00' : `$${(pricePerSeat * seats).toFixed(2)}`;
      const issueDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      // helpers
      const setLabel = (x, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...label); };
      const setBody = (bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(9.5); doc.setTextColor(...body); };

      // ── White bg ──
      doc.setFillColor(...white); doc.rect(0, 0, W, H, 'F');

      // ── Top blue bar ──
      doc.setFillColor(...accent); doc.rect(0, 0, W, 3, 'F');

      // ── Logo ──
      if (logoDataUrl) {
        const img = new Image();
        img.src = logoDataUrl;
        await new Promise(r => { img.onload = r; img.onerror = r; });
        const lh = 30, lw = lh * (img.naturalWidth / img.naturalHeight || 4);
        doc.addImage(logoDataUrl, 'PNG', M, 18, lw, lh);
      } else {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...accent);
        doc.text('SafiTrack', M, 40);
      }

      // ── INVOICE heading ──
      doc.setFont('helvetica', 'bold'); doc.setFontSize(32); doc.setTextColor(...black);
      doc.text('INVOICE', W - M, 40, { align: 'right' });

      // ── Divider ──
      doc.setDrawColor(...border); doc.setLineWidth(0.6);
      doc.line(M, 58, W - M, 58);

      // ══════════════════════════════
      // META  —  3 columns
      // ══════════════════════════════
      const mY = 78;
      const c1 = M, c2 = M + 178, c3 = M + 370;

      // helper: stacked label+value
      const metaBlock = (lbl, lines, x, y) => {
        setLabel(x, y); doc.text(lbl.toUpperCase(), x, y);
        lines.forEach((ln, i) => {
          setBody(i === 0);          // first line bold (name), rest normal
          doc.text(ln, x, y + 13 + i * 14);
        });
      };

      metaBlock('From', ['SafiTrack Inc.', 'Toronto, Ontario', 'Canada', 'support@safitrack.netlify.app'], c1, mY);
      metaBlock('Bill to', [orgName, state.currentUser?.email || ''].filter(Boolean), c2, mY);

      // Right column — stacked pairs, all labels in muted gray
      let ry = mY;
      const detailRow = (lbl, val) => {
        setLabel(c3, ry); doc.text(lbl.toUpperCase(), c3, ry);
        ry += 12; setBody(false); doc.text(val, c3, ry); ry += 18;
      };
      detailRow('Invoice number', invoiceNum);
      detailRow('Date of issue', issueDate);
      detailRow('Period', `${periodStart} – ${periodEnd}`);

      // ══════════════════════════════
      // AMOUNT DUE HERO
      // ══════════════════════════════
      const heroY = mY + 84;
      doc.setFillColor(...bg);
      doc.roundedRect(M, heroY, W - M * 2, 60, 5, 5, 'F');

      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...muted);
      doc.text('Amount due', M + 16, heroY + 18);

      doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...black);
      doc.text(`${amount} USD`, M + 16, heroY + 46);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...muted);
      doc.text(`Due ${issueDate}`, W - M - 16, heroY + 36, { align: 'right' });

      // ══════════════════════════════
      // LINE ITEMS TABLE
      // ══════════════════════════════
      const tY = heroY + 80;
      const tW = W - M * 2;
      const cDesc = M;
      const cQty = M + 318;
      const cUnit = M + 390;
      const cAmt = W - M;

      // Header
      doc.setFillColor(...bg);
      doc.rect(M, tY, tW, 24, 'F');
      doc.setDrawColor(...border); doc.setLineWidth(0.5);
      doc.line(M, tY, W - M, tY);
      doc.line(M, tY + 24, W - M, tY + 24);

      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...muted);
      doc.text('DESCRIPTION', cDesc + 4, tY + 15.5);
      doc.text('QTY', cQty, tY + 15.5);
      doc.text('UNIT PRICE', cUnit, tY + 15.5);
      doc.text('AMOUNT', cAmt, tY + 15.5, { align: 'right' });

      // Row
      const rY = tY + 24;
      doc.setFillColor(...white); doc.rect(M, rY, tW, 48, 'F');

      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...black);
      doc.text(`${planName} Plan (per seat)`, cDesc + 4, rY + 17);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...muted);
      doc.text(`${periodStart} – ${periodEnd}`, cDesc + 4, rY + 31);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...body);
      doc.text(String(seats), cQty, rY + 17);
      doc.text(unitPrice, cUnit, rY + 17);
      doc.text(amount, cAmt, rY + 17, { align: 'right' });

      doc.setDrawColor(...border);
      doc.line(M, rY + 48, W - M, rY + 48);

      // Totals — Subtotal / Total  (no Tax row, matching Attio)
      let totY = rY + 66;
      const totals = [
        ['Subtotal', amount, false],
        ['Total', amount, false],
        ['Amount due', amount, true],
      ];
      totals.forEach(([lbl, val, bold]) => {
        if (bold) {
          doc.setFillColor(...bg);
          doc.rect(M + tW * 0.52, totY - 13, tW * 0.48, 22, 'F');
        }
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(bold ? 10 : 9.5);
        doc.setTextColor(...(bold ? black : body));
        doc.text(lbl, M + tW * 0.54, totY);
        doc.text(val, cAmt, totY, { align: 'right' });
        totY += 22;
      });

      // ── PAID badge ──
      const badgeY = totY + 24;
      doc.setFillColor(...green);
      doc.roundedRect(M, badgeY, 58, 22, 5, 5, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...white);
      doc.text('PAID', M + 29, badgeY + 14.5, { align: 'center' });

      // ── Footer ──
      const fY = H - 46;
      doc.setDrawColor(...border); doc.setLineWidth(0.5);
      doc.line(M, fY, W - M, fY);

      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...muted);
      doc.text('SafiTrack Inc. · Toronto, Ontario, Canada · support@safitrack.netlify.app', M, fY + 14);
      doc.setTextColor(...accent);
      doc.textWithLink('Terms & Conditions', M, fY + 27, { url: 'https://safitrack.netlify.app/pages/legal/terms' });
      doc.setTextColor(...muted);
      doc.text('  ·  All amounts in USD', M + doc.getTextWidth('Terms & Conditions') + 2, fY + 27);
      doc.text('Page 1 of 1', W - M, fY + 27, { align: 'right' });

      doc.save(`SafiTrack-Invoice-${invoiceNum}.pdf`);

    } catch (e) {
      console.error(e);
      showToast('Failed to generate invoice PDF', 'error');
    } finally {
      btn.innerHTML = origHTML;
      btn.disabled = false;
    }
  };

  document.querySelectorAll('.sv-invoice-dl-btn').forEach(btn => {
    btn.addEventListener('click', () => generateInvoicePDF(btn));
  });

  /* ─────────────── ORG RENAME ─────────────── */
  document.getElementById('sv-org-name-edit-trigger')?.addEventListener('click', () => {
    const form = document.getElementById('sv-org-rename-form');
    if (!form) return;
    form.style.display = 'block';
    document.getElementById('org-name-input')?.focus();
    document.getElementById('sv-org-name-edit-trigger').style.display = 'none';
  });

  document.getElementById('sv-org-rename-cancel')?.addEventListener('click', () => {
    const form = document.getElementById('sv-org-rename-form');
    if (form) form.style.display = 'none';
    const trigger = document.getElementById('sv-org-name-edit-trigger');
    if (trigger) trigger.style.display = '';
    const input = document.getElementById('org-name-input');
    if (input) input.value = state.currentOrganization?.name || '';
  });

  document.getElementById('org-name-save-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('org-name-input');
    const btn = document.getElementById('org-name-save-btn');
    if (!input || !state.currentOrganization?.id) return;
    const newName = input.value.trim();
    if (!newName) { showToast('Organization name cannot be empty.', 'error'); return; }
    if (newName === state.currentOrganization.name) { showToast('No changes to save.', 'info'); return; }
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const { data, error } = await supabaseClient.from('organizations').update({ name: newName }).eq('id', state.currentOrganization.id).select('name').single();
      if (error) throw error;
      if (!data) throw new Error('Update blocked — no rows returned. Check RLS policy.');
      state.currentOrganization.name = data.name;
      document.querySelectorAll('.org-name-display').forEach(el => el.textContent = data.name);
      const orgNameEl = document.getElementById('org-name');
      if (orgNameEl) orgNameEl.textContent = data.name;
      const headerOrgEl = document.getElementById('header-org-name');
      if (headerOrgEl) headerOrgEl.textContent = data.name;
      const wsBtnName = document.getElementById('ws-btn-org-name');
      if (wsBtnName) wsBtnName.textContent = data.name.length > 16 ? data.name.slice(0, 16) + '\u2026' : data.name;
      const wsBtnAvatar = document.getElementById('ws-btn-avatar');
      if (wsBtnAvatar) wsBtnAvatar.textContent = data.name[0].toUpperCase();
      const cardName = document.querySelector('.sv-org-identity-name');
      if (cardName) cardName.textContent = data.name;
      const form = document.getElementById('sv-org-rename-form');
      if (form) form.style.display = 'none';
      const trigger = document.getElementById('sv-org-name-edit-trigger');
      if (trigger) trigger.style.display = '';
      showToast('Organization name updated.', 'success');
    } catch (e) {
      console.error(e);
      showToast('Failed to update organization name.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  /* ─────────────── CURRENCY AUTO-SAVE ─────────────── */
  document.getElementById('sv-currency-select')?.addEventListener('change', async () => {
    if (!state.isManager) return;
    const input = document.getElementById('sv-currency-select');
    const ddRoot = input?.closest('.crm-dd');
    if (!input || !state.currentOrganization?.id) return;
    const newCode = input.value;
    const found = CURRENCIES.find(c => c.code === newCode);
    const sym = found ? found.symbol : newCode;
    // Instant preview
    const symPreview = document.getElementById('sv-currency-symbol-preview');
    const codePreview = document.getElementById('sv-currency-code-preview');
    const statusEl = document.getElementById('sv-currency-status');
    if (symPreview) symPreview.textContent = sym;
    if (codePreview) codePreview.textContent = newCode;
    if (statusEl) statusEl.textContent = 'Saving…';
    // Disable the dropdown trigger while saving
    const trigger = ddRoot?.querySelector('.crm-dd-trigger');
    if (trigger) { trigger.disabled = true; ddRoot.classList.add('is-disabled'); }
    try {
      const { data, error } = await supabaseClient
        .from('organizations')
        .update({ currency: newCode })
        .eq('id', state.currentOrganization.id)
        .select('currency')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Update blocked — check RLS policy.');
      state.orgCurrency = data.currency;
      state.currentOrganization.currency = data.currency;
      if (statusEl) {
        statusEl.textContent = 'Saved';
        statusEl.style.color = 'var(--color-success, #22c55e)';
        setTimeout(() => { if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; } }, 2000);
      }
      showToast(`Currency updated to ${found ? found.name : newCode} (${sym}).`, 'success');
    } catch (e) {
      console.error(e);
      if (statusEl) { statusEl.textContent = 'Failed to save'; statusEl.style.color = 'var(--color-danger, #ef4444)'; }
      showToast('Failed to update currency.', 'error');
    } finally {
      if (trigger) { trigger.disabled = false; ddRoot?.classList.remove('is-disabled'); }
    }
  });

  /* ─────────────── INPUT DEBOUNCE ─────────────── */
  document.getElementById('profile-firstname')?.addEventListener('input', () => debounceSave('profile'));
  document.getElementById('profile-lastname')?.addEventListener('input', () => debounceSave('profile'));
  document.getElementById('pref-email-notifs')?.addEventListener('change', () => autoSaveSettings('preferences'));

  /* ─────────────── IMAGE COMPRESSION HELPER ─────────────── */
  /**
   * Compresses an image File to a Blob via an off-screen canvas.
   * @param {File} file - source image file
   * @param {number} maxPx - maximum width or height in pixels
   * @param {number} quality - JPEG/WebP quality 0-1
   * @returns {Promise<Blob>}
   */
  function compressImage(file, maxPx, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxPx || height > maxPx) {
          if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
          else { width = Math.round(width * maxPx / height); height = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    });
  }

  /* ─────────────── USER AVATAR UPLOAD ─────────────── */
  const avatarCircle = document.getElementById('sv-settings-avatar-circle');
  const avatarInput = document.getElementById('sv-avatar-upload');
  const avatarUploadBtn = document.getElementById('sv-avatar-upload-btn');
  const avatarRemoveBtn = document.getElementById('sv-avatar-remove-btn');

  // Both the circle and the button trigger the hidden input
  avatarCircle?.addEventListener('click', () => avatarInput?.click());
  avatarUploadBtn?.addEventListener('click', (e) => { e.stopPropagation(); avatarInput?.click(); });

  avatarInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !state.currentUser?.id) return;
    avatarInput.value = '';
    try {
      showToast('Uploading avatar…', 'info');
      const compressed = await compressImage(file, 256, 0.82);
      const ext = 'jpg';
      const path = `${state.currentUser.id}/avatar.${ext}`;
      const { error: upErr } = await supabaseClient.storage
        .from('avatars')
        .upload(path, compressed, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabaseClient.storage.from('avatars').getPublicUrl(path);
      // Bust cache with a timestamp
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabaseClient
        .from('profiles').update({ avatar_url: publicUrl }).eq('id', state.currentUser.id);
      if (dbErr) throw dbErr;
      state.currentUserProfile = { ...(state.currentUserProfile || {}), avatar_url: publicUrl };
      // Update settings circle
      if (avatarCircle) avatarCircle.innerHTML = `<img src="${publicUrl}" alt="" class="sv-avatar-img"><div class="sv-avatar-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>`;
      // Update header avatar
      const headerAvatar = document.getElementById('user-avatar');
      if (headerAvatar) headerAvatar.innerHTML = `<img src="${publicUrl}" alt="" class="user-avatar-img">`;
      // Show remove button if it wasn't there
      if (!document.getElementById('sv-avatar-remove-btn')) {
        const info = avatarUploadBtn?.parentElement;
        if (info) {
          const removeBtn = document.createElement('button');
          removeBtn.id = 'sv-avatar-remove-btn';
          removeBtn.className = 'sv-ghost-btn sv-ghost-btn--danger';
          removeBtn.style.color = 'var(--color-danger,#ef4444)';
          removeBtn.textContent = 'Remove';
          removeBtn.addEventListener('click', handleAvatarRemove);
          info.appendChild(removeBtn);
        }
      }
      showToast('Avatar updated', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to upload avatar: ' + err.message, 'error');
    }
  });

  async function handleAvatarRemove() {
    if (!state.currentUser?.id) return;
    try {
      await supabaseClient.storage.from('avatars').remove([`${state.currentUser.id}/avatar.jpg`]);
      await supabaseClient.from('profiles').update({ avatar_url: null }).eq('id', state.currentUser.id);
      state.currentUserProfile = { ...(state.currentUserProfile || {}), avatar_url: null };
      const initials = ((state.currentUserProfile?.first_name?.[0] || '') + (state.currentUserProfile?.last_name?.[0] || '')).toUpperCase() || (state.currentUser?.email?.[0] || 'U').toUpperCase();
      if (avatarCircle) avatarCircle.innerHTML = `${initials}<div class="sv-avatar-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>`;
      const headerAvatar = document.getElementById('user-avatar');
      if (headerAvatar) headerAvatar.textContent = initials;
      document.getElementById('sv-avatar-remove-btn')?.remove();
      showToast('Avatar removed', 'info');
    } catch (err) {
      showToast('Failed to remove avatar', 'error');
    }
  }
  avatarRemoveBtn?.addEventListener('click', handleAvatarRemove);

  /* ─────────────── ORG LOGO UPLOAD ─────────────── */
  const orgLogoInput = document.getElementById('sv-org-logo-upload');
  const orgLogoUploadBtn = document.getElementById('sv-org-logo-upload-btn');
  const orgLogoRemoveBtn = document.getElementById('sv-org-logo-remove-btn');
  const orgIdentityAvatar = document.getElementById('sv-org-identity-avatar');

  orgLogoUploadBtn?.addEventListener('click', () => orgLogoInput?.click());

  orgLogoInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !state.currentOrganization?.id) return;
    orgLogoInput.value = '';
    try {
      showToast('Uploading logo…', 'info');
      const compressed = await compressImage(file, 400, 0.85);
      const path = `${state.currentOrganization.id}/logo.jpg`;
      const { error: upErr } = await supabaseClient.storage
        .from('org-logos')
        .upload(path, compressed, { contentType: 'image/jpeg', upsert: true });
      if (upErr) throw upErr;
      const { data: urlData } = supabaseClient.storage.from('org-logos').getPublicUrl(path);
      const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;
      const { error: dbErr } = await supabaseClient
        .from('organizations').update({ logo_url: publicUrl }).eq('id', state.currentOrganization.id);
      if (dbErr) throw dbErr;
      state.currentOrganization = { ...state.currentOrganization, logo_url: publicUrl };
      // Update settings identity avatar
      if (orgIdentityAvatar) orgIdentityAvatar.innerHTML = `<img src="${publicUrl}" alt="" class="sv-org-logo-img">`;
      if (orgLogoUploadBtn) orgLogoUploadBtn.childNodes[orgLogoUploadBtn.childNodes.length - 1].textContent = 'Change logo';
      // Update sidebar ws-btn-avatar
      const orgAvatarEl = document.getElementById('ws-btn-avatar');
      if (orgAvatarEl) orgAvatarEl.innerHTML = `<img src="${publicUrl}" alt="" class="ws-btn-logo-img">`;
      // Show remove button if not present
      if (!document.getElementById('sv-org-logo-remove-btn')) {
        const removeBtn = document.createElement('button');
        removeBtn.id = 'sv-org-logo-remove-btn';
        removeBtn.className = 'sv-ghost-btn';
        removeBtn.style.cssText = 'font-size:0.78rem;color:var(--color-danger,#ef4444);';
        removeBtn.textContent = 'Remove logo';
        removeBtn.addEventListener('click', handleOrgLogoRemove);
        orgLogoUploadBtn?.parentElement?.appendChild(removeBtn);
      }
      showToast('Organization logo updated', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to upload logo: ' + err.message, 'error');
    }
  });

  async function handleOrgLogoRemove() {
    if (!state.currentOrganization?.id) return;
    try {
      await supabaseClient.storage.from('org-logos').remove([`${state.currentOrganization.id}/logo.jpg`]);
      await supabaseClient.from('organizations').update({ logo_url: null }).eq('id', state.currentOrganization.id);
      state.currentOrganization = { ...state.currentOrganization, logo_url: null };
      const orgInitials = ((state.currentOrganization?.name || 'W').match(/\b\w/g) || []).slice(0, 2).join('').toUpperCase();
      if (orgIdentityAvatar) orgIdentityAvatar.textContent = orgInitials;
      const orgAvatarEl = document.getElementById('ws-btn-avatar');
      if (orgAvatarEl) orgAvatarEl.textContent = (state.currentOrganization?.name || 'W')[0].toUpperCase();
      document.getElementById('sv-org-logo-remove-btn')?.remove();
      if (orgLogoUploadBtn) orgLogoUploadBtn.childNodes[orgLogoUploadBtn.childNodes.length - 1].textContent = 'Upload logo';
      showToast('Logo removed', 'info');
    } catch (err) {
      showToast('Failed to remove logo', 'error');
    }
  }
  orgLogoRemoveBtn?.addEventListener('click', handleOrgLogoRemove);

  /* ─────────────── LOAD MEMBERS ─────────────── */
  const loadMembers = async () => {
    const listContainer = document.getElementById('sv-members-container');
    if (!listContainer || typeof supabaseClient === 'undefined') return;
    listContainer.innerHTML = `<tr><td colspan="4" class="sv-table-empty">Loading…</td></tr>`;

    const orgId = state.currentOrganization?.id;
    let pQ = supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
    if (orgId) pQ = pQ.eq('organization_id', orgId);

    const [profilesResult, invitesResult] = await Promise.all([
      pQ,
      state.isManager
        ? supabaseClient.from('invitations').select('*').eq('status', 'pending').order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesResult.error) {
      listContainer.innerHTML = `<tr><td colspan="4" class="sv-table-empty" style="color:#dc2626;">Failed to load members: ${escH(profilesResult.error.message)}</td></tr>`;
      return;
    }

    const users = profilesResult.data || [];
    const invites = invitesResult.data || [];

    if (!users.length && !invites.length) {
      listContainer.innerHTML = `<tr><td colspan="4" class="sv-table-empty">No members yet. Invite your team!</td></tr>`;
      return;
    }

    const roleLabel = r => r === 'manager' ? 'Manager' : r === 'sales_rep' ? 'Sales Rep' : r === 'technician' ? 'Technician' : 'Member';
    const roleChip = r => `<span class="sv-role-chip" data-role="${r || 'member'}">${roleLabel(r)}</span>`;
    const nameColor = s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 6; };

    const memberRows = users.map(u => {
      const uFullName = (`${u.first_name || ''} ${u.last_name || ''}`).trim() || u.email || 'Teammate';
      const uInitials = getInitials(uFullName);
      const isMe = u.id === state.currentUser?.id;
      const actionsHtml = (state.isManager && !isMe)
        ? `<button class="sv-member-remove-btn" title="Remove member" onclick="if(typeof deleteUser==='function') deleteUser('${u.id}','${uFullName.replace(/'/g, "\\'")}','${u.role || ''}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
        : '';
      return `
        <tr>
          <td><div class="sv-member-cell">
            <div class="sv-member-avatar" data-color="${nameColor(uFullName)}">${escH(uInitials)}</div>
            <div class="sv-member-info">
              <div class="sv-member-name">${escH(uFullName)}${isMe ? '<span class="sv-you-badge">You</span>' : ''}</div>
              <div class="sv-member-email">${escH(u.email || '')}</div>
            </div>
          </div></td>
          <td>${roleChip(u.role)}</td>
          <td><span class="sv-status-dot sv-status-dot--active"></span><span class="sv-status-text">Active</span></td>
          <td class="sv-member-actions-cell">${actionsHtml}</td>
        </tr>`;
    });

    const inviteRows = invites.map(inv => {
      const initials = (inv.email || '?')[0].toUpperCase();
      const revokeHtml = state.isManager
        ? `<button class="sv-member-remove-btn" title="Revoke invitation"
              onclick="(async()=>{if(!confirm('Revoke this invitation?'))return;const{error}=await supabaseClient.from('invitations').update({status:'revoked'}).eq('id','${inv.id}');if(!error){this.closest('tr').remove();showToast('Invitation revoked','info');}else{showToast('Failed to revoke: '+error.message,'error');}})()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : '';
      return `
        <tr style="opacity:0.65;">
          <td><div class="sv-member-cell">
            <div class="sv-member-avatar" data-color="${nameColor(inv.email || '?')}">${escH(initials)}</div>
            <div class="sv-member-info">
              <div class="sv-member-name">${escH(inv.email)}</div>
              <div class="sv-member-email">Invite sent · expires ${new Date(inv.expires_at).toLocaleDateString()}</div>
            </div>
          </div></td>
          <td>${roleChip(inv.role)}</td>
          <td><span class="sv-status-dot sv-status-dot--invited"></span><span class="sv-status-text">Pending</span></td>
          <td class="sv-member-actions-cell">${revokeHtml}</td>
        </tr>`;
    });

    listContainer.innerHTML = [...memberRows, ...inviteRows].join('');

    if (state.currentOrganization) {
      const total = users.length + invites.length;
      const maxSlots = state.currentOrganization.max_members || 2;
      const usedSlotsEl = document.querySelector('.sv-usage-labels span:last-child');
      const usageBarEl = document.querySelector('.sv-usage-fill');
      if (usedSlotsEl) usedSlotsEl.textContent = `${total} / ${maxSlots}`;
      if (usageBarEl) usageBarEl.style.width = `${Math.min(100, Math.round((total / maxSlots) * 100))}%`;
      // Update org stats tile seat bar
      const seatCount = document.getElementById('sv-seat-count');
      const seatBar = document.getElementById('sv-seat-bar');
      if (seatCount) seatCount.textContent = `${total} / ${maxSlots}`;
      if (seatBar) {
        const pct = Math.min(100, Math.round((total / maxSlots) * 100));
        seatBar.style.width = `${pct}%`;
        if (pct >= 100) seatBar.classList.add('is-full');
      }

      // Update invoice rows now that we know actual used seats
      const pricePerSeat = parseFloat(planPrice[currentPlan]) || 0;
      const invoiceTotal = pricePerSeat === 0 ? '$0.00' : `$${(pricePerSeat * total).toFixed(2)}`;
      document.querySelectorAll('.sv-invoice-dl-btn').forEach(btn => {
        btn.dataset.amount = invoiceTotal;
        btn.dataset.seats = String(total);
      });
      document.querySelectorAll('.sv-invoice-amount').forEach(el => {
        el.textContent = invoiceTotal;
      });
    }

    const searchInput = document.getElementById('sv-member-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        document.querySelectorAll('#sv-members-container tr').forEach(row => {
          const text = row.querySelector('.sv-member-cell')?.textContent?.toLowerCase() || '';
          row.style.display = text.includes(val) ? '' : 'none';
        });
      });
    }
  };

  loadMembers();

  /* ─────────────── SUPPORT CHAT LOGIC ─────────────── */
  const supportChatInput = document.getElementById('sv-support-chat-input');
  const supportChatSend = document.getElementById('sv-support-chat-send');
  const supportChatMessages = document.getElementById('sv-support-chat-messages');

  async function sendSupportMessage() {
    const proxyUrl = (window.APP_CONFIG || {}).GEMINI_PROXY_URL;
    if (!proxyUrl) {
      showToast('GEMINI_PROXY_URL not configured', 'error');
      return;
    }

    const text = supportChatInput.value.trim();
    if (!text) return;

    supportChatMessages.insertAdjacentHTML('beforeend', `
      <div style="display: flex; gap: 12px; align-items: flex-end; justify-content: flex-end; animation: slideInRight 0.3s ease-out forwards; opacity: 0; transform: translateX(10px);">
        <div style="background: linear-gradient(135deg, var(--color-primary), #6366f1); padding: 14px 18px; border-radius: 18px; border-bottom-right-radius: 4px; color: white; font-size: 0.95rem; max-width: 80%; line-height: 1.5; box-shadow: 0 4px 12px rgba(99,102,241,0.2);">
          ${escH(text)}
        </div>
      </div>
    `);
    supportChatInput.value = '';
    supportChatMessages.scrollTop = supportChatMessages.scrollHeight;

    const loadingId = 'loading-' + Date.now();
    supportChatMessages.insertAdjacentHTML('beforeend', `
      <div id="${loadingId}" style="display: flex; gap: 12px; align-items: flex-end; animation: slideInLeft 0.3s ease-out forwards; opacity: 0; transform: translateX(-10px);">
        <div style="width: 32px; height: 32px; border-radius: 10px; background: var(--bg-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid var(--border-color); padding: 4px; box-sizing: border-box;">
          <img src="https://i.imgur.com/4pIw8QP.png" alt="Logo" style="width: 100%; height: 100%; object-fit: contain;">
        </div>
        <div style="background: var(--bg-secondary); padding: 14px 18px; border-radius: 18px; border-bottom-left-radius: 4px; border: 1px solid var(--border-color); color: var(--text-muted); font-size: 0.95rem; display: flex; align-items: center; gap: 6px; height: 48px; box-sizing: border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
          <span class="sv-typing-dot" style="width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; animation: blink 1.4s infinite both;"></span>
          <span class="sv-typing-dot" style="width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; animation: blink 1.4s infinite both; animation-delay: 0.2s;"></span>
          <span class="sv-typing-dot" style="width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; animation: blink 1.4s infinite both; animation-delay: 0.4s;"></span>
        </div>
      </div>
    `);
    supportChatMessages.scrollTop = supportChatMessages.scrollHeight;

    try {
      let authToken = '';
      try {
        if (typeof supabaseClient !== 'undefined') {
          const { data: { session } } = await supabaseClient.auth.getSession();
          authToken = session?.access_token || '';
        }
      } catch (e) {
        console.warn('Could not get auth token for support chat', e);
      }

      const safeState = JSON.parse(JSON.stringify(state, (key, value) => {
        // Exclude circular or excessively large DOM/instance objects
        if (key === 'chartInstances' || key === 'safiNudgeChannel') return undefined;
        // Truncate large arrays to prevent context overflow while still providing awareness
        if (Array.isArray(value) && value.length > 20) {
           return value.slice(0, 20).concat([`... (${value.length - 20} more items)`]);
        }
        return value;
      }));

      // Strategy: Give the AI full access to "see for itself" by extracting the entire UI structure from the DOM.
      const domClone = document.body.cloneNode(true);
      domClone.querySelectorAll('svg, script, style, img, path, iframe, canvas, link, meta, noscript').forEach(el => el.remove());
      
      const cleanUIHTML = domClone.innerHTML.replace(/\s+/g, ' ').trim();

      const systemPrompt = `You are the SafiTrack CRM Support Assistant.
You have direct, raw access to the user's FULL CRM user interface. 
Use the UI structure provided below to understand exactly what features exist, what they are called, and where they are located.

CRITICAL INSTRUCTIONS:
- If a user asks about a feature, SEARCH the UI STRUCTURE below. If you find a button, modal, or section that matches, explain where it is based on its CSS classes or IDs (e.g. if it's in a sidebar, modal, or header).
- Do not say a feature does not exist if you can find evidence of it in the UI STRUCTURE.
- Keep your answers concise, practical, and highly friendly.
- Do not use markdown formatting.

CURRENT USER STATE:
${JSON.stringify({ role: state.isManager ? 'Manager' : 'User', view: state.currentView, organization: state.currentOrganization?.name || 'Unknown' }, null, 2)}

FULL CRM UI STRUCTURE (HTML Snapshot):
${cleanUIHTML}`;

      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [{
            role: 'user',
            parts: [{ text: text }]
          }]
        })
      });

      const data = await response.json();
      document.getElementById(loadingId)?.remove();

      if (!response.ok) {
        throw new Error(data.message || data.error?.message || data.error || `HTTP ${response.status}`);
      }
      
      if (data.error) throw new Error(data.error.message || 'API Error');

      const reply = data.models ? JSON.stringify(data.models.map(m => m.name), null, 2) : (data.candidates?.[0]?.content?.parts?.[0]?.text || 'I am sorry, I did not understand that.');
      
      supportChatMessages.insertAdjacentHTML('beforeend', `
        <div style="display: flex; gap: 12px; align-items: flex-end; animation: slideInLeft 0.3s ease-out forwards; opacity: 0; transform: translateX(-10px);">
          <div style="width: 32px; height: 32px; border-radius: 10px; background: var(--bg-primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid var(--border-color); padding: 4px; box-sizing: border-box;">
            <img src="https://i.imgur.com/4pIw8QP.png" alt="Logo" style="width: 100%; height: 100%; object-fit: contain;">
          </div>
          <div style="background: var(--bg-secondary); padding: 14px 18px; border-radius: 18px; border-bottom-left-radius: 4px; border: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.95rem; max-width: 80%; white-space: pre-wrap; line-height: 1.5; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">${escH(reply)}</div>
        </div>
      `);
      
      // Auto-scroll after bot replies
      const scrollToBottom = () => {
        supportChatMessages.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      };
      scrollToBottom();
      setTimeout(scrollToBottom, 100);
      setTimeout(scrollToBottom, 300);
    } catch (err) {
      console.error('Support Chat Error:', err);
      document.getElementById(loadingId)?.remove();
      supportChatMessages.insertAdjacentHTML('beforeend', `
        <div style="display: flex; gap: 12px; align-items: flex-end; animation: slideInLeft 0.3s ease-out forwards; opacity: 0; transform: translateX(-10px);">
          <div style="width: 32px; height: 32px; border-radius: 10px; background: var(--color-danger, #ef4444); color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 8px rgba(239,68,68,0.2);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div style="background: rgba(239,68,68,0.05); padding: 14px 18px; border-radius: 18px; border-bottom-left-radius: 4px; border: 1px solid rgba(239,68,68,0.2); color: var(--color-danger, #ef4444); font-size: 0.95rem; max-width: 80%; line-height: 1.5;">
            Error: ${escH(err.message || String(err))}
          </div>
        </div>
      `);
      supportChatMessages.scrollTop = supportChatMessages.scrollHeight;
    }
  }

  supportChatSend?.addEventListener('click', sendSupportMessage);
  supportChatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendSupportMessage();
  });

  const urlParams = new URLSearchParams(window.location.search);
  const requestedTab = urlParams.get('tab');

  const _initSection = requestedTab || state._pendingSettingsSection || 'profile';
  state._pendingSettingsSection = null;
  setActiveSection(_initSection);

  // Clean up URL so the query params don't get stuck while navigating
  if (urlParams.has('view') || urlParams.has('tab')) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}


// ── Exports ────────────────────────────────────────────────────
export {
  renderSettingsView,
};
