/**
 * SafiTrack Onboarding & Interactive CRM Walkthrough Experience
 * Pure Monochrome (Black & White) Aesthetic | Attio-Grade Polish
 * ─────────────────────────────────────────────────────────────────────────────
 */

class SafiOnboardingManager {
  constructor() {
    this.role = 'manager'; // 'manager' | 'sales_rep' | 'technician'
    this.isTest = false;
    this.currentView = null; // 'invite' | 'tour' | 'interactive'
    this.overlay = null;
    this.modalCard = null;
    this.spotlightCard = null;
    this.currentTargetEl = null;
    this.tourStepIndex = 0;
    this.tourSteps = [];
    this.isInitialized = false;
    this.simulatedMaxSeats = undefined; // For testing plan limits

    this.inviteRows = [];
    this.nextRowId = 1;

    // Bound handlers for clean removal
    this.handleResize = this.handleResize.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleDocumentClick = this.handleDocumentClick.bind(this);

    this.checkUrlParams();
  }

  // ── Plan & Seat Calculations ──────────────────────────────────────────────
  getPlanInfo() {
    const org = window.state?.currentOrganization;
    const maxSeats = this.simulatedMaxSeats !== undefined 
      ? this.simulatedMaxSeats 
      : (org?.max_members ?? 2);
    
    const plan = maxSeats <= 2 ? 'Free' : maxSeats <= 20 ? 'Core' : 'Pro';
    const isUnlimited = maxSeats >= 999;
    
    // In a freshly registered workspace, the owner takes 1 seat.
    // If existing users are present in state, use that count; otherwise 1.
    const usedMembers = (window.state?.organizationUsers && window.state.organizationUsers.length > 0)
      ? window.state.organizationUsers.length
      : 1;
    
    const remainingSlots = isUnlimited ? 9999 : Math.max(0, maxSeats - usedMembers);

    return {
      plan,
      maxSeats,
      usedMembers,
      remainingSlots,
      isUnlimited
    };
  }

  setPlan(planOrSeats) {
    if (typeof planOrSeats === 'number') {
      this.simulatedMaxSeats = planOrSeats;
    } else if (planOrSeats === 'free') {
      this.simulatedMaxSeats = 2;
    } else if (planOrSeats === 'core') {
      this.simulatedMaxSeats = 20;
    } else if (planOrSeats === 'pro') {
      this.simulatedMaxSeats = 999;
    }
    if (this.currentView === 'invite') {
      this.showInvitePrompt();
    }
  }

  getRoleLabel(role) {
    if (role === 'manager') return 'Co-Manager';
    if (role === 'technician') return 'Technician';
    return 'Sales Rep';
  }

  // ── URL Parameter Detection ───────────────────────────────────────────────
  checkUrlParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const testParam = params.get('onboarding') || params.get('test_onboarding');
      const planParam = params.get('plan');

      if (planParam) {
        if (planParam === 'free') this.simulatedMaxSeats = 2;
        else if (planParam === 'core') this.simulatedMaxSeats = 20;
        else if (planParam === 'pro') this.simulatedMaxSeats = 999;
        else if (!isNaN(parseInt(planParam, 10))) this.simulatedMaxSeats = parseInt(planParam, 10);
      }

      if (testParam) {
        let targetRole = 'manager';
        let initialMode = 'full';

        if (testParam === 'rep' || testParam === 'sales_rep') {
          targetRole = 'sales_rep';
        } else if (testParam === 'tech' || testParam === 'technician') {
          targetRole = 'technician';
        } else if (testParam === 'tour' || testParam === 'card') {
          initialMode = 'tour';
        } else if (testParam === 'invite' || testParam === 'invites') {
          initialMode = 'invite';
        } else if (testParam === 'interactive' || testParam === 'walkthrough') {
          initialMode = 'interactive';
        }

        setTimeout(() => {
          this.start(targetRole, { isTest: true, mode: initialMode });
        }, 500);
      }
    } catch (_e) { /* non-critical */ }
  }

  // ── Context Helpers ──────────────────────────────────────────────────────
  getUserFirstName() {
    if (window.state && window.state.currentUserProfile && window.state.currentUserProfile.first_name) {
      return window.state.currentUserProfile.first_name;
    }
    return '';
  }

  getOrganizationName() {
    if (window.state && window.state.currentOrganization && window.state.currentOrganization.name) {
      return window.state.currentOrganization.name;
    }
    return 'Your Workspace';
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  init(userRole = 'sales_rep') {
    this.role = userRole;
    this.ensureOverlayDom();
    this.isInitialized = true;
  }

  start(role = null, options = {}) {
    if (this.isActive && !options.force) {
      return;
    }
    this.isActive = true;

    if (role) this.role = role;
    this.isTest = !!options.isTest;
    const mode = options.mode || 'full';

    this.ensureOverlayDom();

    if (!this.isTest) {
      localStorage.setItem('safitrack_onboarding_completed', 'true');
    }

    // Determine initial view:
    if (mode === 'tour') {
      this.showTourPrompt();
    } else if (mode === 'invite') {
      this.showInvitePrompt();
    } else if (mode === 'interactive') {
      this.startInteractiveTour();
    } else {
      if (this.role === 'manager') {
        this.showInvitePrompt();
      } else {
        this.showTourPrompt();
      }
    }
  }

  test(scenario = 'manager') {
    if (scenario === 'tour') {
      this.start('manager', { isTest: true, mode: 'tour' });
    } else if (scenario === 'invite') {
      this.start('manager', { isTest: true, mode: 'invite' });
    } else if (scenario === 'rep' || scenario === 'sales_rep') {
      this.start('sales_rep', { isTest: true });
    } else if (scenario === 'tech' || scenario === 'technician') {
      this.start('technician', { isTest: true });
    } else if (scenario === 'interactive') {
      this.start(this.role || 'manager', { isTest: true, mode: 'interactive' });
    } else {
      this.start('manager', { isTest: true });
    }
  }


  reset() {
    localStorage.removeItem('safitrack_onboarding_completed');
    if (window.showToast) {
      window.showToast('Onboarding state reset. Reload to experience initial startup.', 'info');
    } else {
      alert('Onboarding status cleared.');
    }
  }

  // ── Overlay DOM Setup ────────────────────────────────────────────────────
  ensureOverlayDom() {
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'safi-modal-overlay';
      this.overlay.id = 'safi-onboarding-overlay';

      this.overlay.innerHTML = `
        <div class="safi-card-modal" id="safi-card-modal" role="dialog" aria-modal="true">
          <!-- Dynamic Modal Content rendered via showInvitePrompt or showTourPrompt -->
        </div>
      `;

      document.body.appendChild(this.overlay);
      this.modalCard = this.overlay.querySelector('#safi-card-modal');

      window.addEventListener('resize', this.handleResize);
      window.addEventListener('keydown', this.handleKeyDown);
      document.addEventListener('click', this.handleDocumentClick);
    }
  }

  openOverlay() {
    if (!this.overlay) this.ensureOverlayDom();
    this.overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  closeOverlay() {
    if (this.overlay) {
      this.overlay.classList.remove('active');
    }
    document.body.style.overflow = '';
  }

  close() {
    this.isActive = false;
    this.closeOverlay();
    this.stopInteractiveTour();
  }

  // ═════════════════════════════════════════════════════════════════════════
  // STAGE 1: INVITE TEAM PROMPT MODAL (Native Selectors & Plan Limits)
  // ═════════════════════════════════════════════════════════════════════════
  showInvitePrompt() {
    this.currentView = 'invite';
    this.openOverlay();

    const planInfo = this.getPlanInfo();

    // Initialize invite rows respecting plan limit:
    // For Free plan (remainingSlots = 1), default to 1 row.
    // For Core/Pro, default to 1 or 2 rows (up to remainingSlots).
    if (this.inviteRows.length === 0) {
      const initialCount = Math.min(planInfo.remainingSlots > 0 ? 1 : 0, 1);
      this.inviteRows = [];
      for (let i = 0; i < initialCount; i++) {
        this.inviteRows.push({ id: this.nextRowId++, email: '', role: 'sales_rep' });
      }
      if (this.inviteRows.length === 0 && planInfo.remainingSlots > 0) {
        this.inviteRows.push({ id: this.nextRowId++, email: '', role: 'sales_rep' });
      }
    }

    const isAtLimit = !planInfo.isUnlimited && this.inviteRows.length >= planInfo.remainingSlots;

    this.modalCard.className = 'safi-card-modal safi-invite-modal';
    this.modalCard.innerHTML = `
      <div class="safi-card-content" style="padding: 32px 32px 24px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #71717a;">
              Team Setup
            </span>
            <span class="safi-plan-pill" id="safi-plan-pill">
              ${planInfo.plan} Plan • ${planInfo.remainingSlots} seat${planInfo.remainingSlots === 1 ? '' : 's'} available
            </span>
          </div>
          <button type="button" class="safi-spotlight-close" id="safi-invite-close" title="Close" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <h2 class="safi-card-title" style="font-size: 1.45rem; margin-bottom: 8px;">Invite your team</h2>
        <p class="safi-card-text" style="margin-bottom: 20px;">
          Bring your field sales representatives and service technicians into SafiTrack. They'll receive instant workspace access.
        </p>

        <!-- Invites Table with Native Site Role Dropdown -->
        <div class="safi-invite-table" id="safi-invite-table">
          ${this.renderInviteRows()}
        </div>

        <div class="safi-invite-actions-row">
          <button type="button" class="safi-invite-add-btn" id="safi-invite-add-row">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Add another member
          </button>
          <span style="font-size: 0.78rem; color: #71717a;">
            ${planInfo.isUnlimited ? 'Unlimited team seats' : `${this.inviteRows.length} of ${planInfo.remainingSlots} invite slot${planInfo.remainingSlots === 1 ? '' : 's'} used`}
          </span>
        </div>

        <!-- Plan Limit Notification Banner -->
        <div id="safi-plan-limit-banner" class="safi-plan-limit-banner" style="${isAtLimit ? 'display: flex;' : 'display: none;'}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>
            <span id="safi-plan-limit-msg">
              ${planInfo.plan === 'Free'
                ? 'Free Plan limit reached (max 2 seats: 1 owner + 1 teammate). Upgrade to invite more members.'
                : `Plan seat limit reached (${planInfo.maxSeats} maximum). Upgrade to add more members.`}
            </span>
            <a href="https://safitrack.netlify.app/pages/pricing" target="_blank" class="safi-plan-upgrade-link">
              Upgrade Plan →
            </a>
          </div>
        </div>

        <div id="safi-invite-feedback" style="display: none; font-size: 0.82rem; padding: 9px 12px; border-radius: 8px; margin-top: 14px;"></div>

        <div class="safi-card-divider"></div>

        <div class="safi-card-footer">
          <button type="button" class="safi-btn-skip" id="safi-invite-skip-btn">
            Skip for now
          </button>
          <button type="button" class="safi-btn-action" id="safi-invite-submit-btn">
            Send Invites &amp; Continue →
          </button>
        </div>
      </div>
    `;

    this.bindInviteEvents();
  }

  renderInviteRows() {
    if (this.inviteRows.length === 0) {
      return `
        <div style="padding: 20px; text-align: center; color: #71717a; font-size: 0.85rem;">
          No team members added yet. Click "Add another member" below.
        </div>
      `;
    }

    return this.inviteRows.map(row => `
      <div class="safi-invite-row" data-row-id="${row.id}">
        <input 
          type="email" 
          class="safi-invite-input" 
          placeholder="colleague@company.com" 
          value="${row.email || ''}"
          data-field="email"
          autocomplete="off"
          spellcheck="false"
        />
        
        <!-- Native Site Design Custom Role Selector -->
        <div class="safi-role-picker" data-picker-id="${row.id}">
          <button type="button" class="safi-role-chip" data-role-chip title="Choose member role">
            <span class="safi-role-dot safi-role-dot--${row.role}"></span>
            <span class="safi-role-label">${this.getRoleLabel(row.role)}</span>
            <svg class="safi-role-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          
          <div class="safi-role-dropdown" data-role-dropdown>
            <button type="button" class="safi-role-option ${row.role === 'sales_rep' ? 'is-active' : ''}" data-role="sales_rep">
              <span class="safi-role-dot safi-role-dot--sales_rep"></span>
              <span>Sales Rep</span>
            </button>
            <button type="button" class="safi-role-option ${row.role === 'technician' ? 'is-active' : ''}" data-role="technician">
              <span class="safi-role-dot safi-role-dot--technician"></span>
              <span>Technician</span>
            </button>
            <button type="button" class="safi-role-option ${row.role === 'manager' ? 'is-active' : ''}" data-role="manager">
              <span class="safi-role-dot safi-role-dot--manager"></span>
              <span>Co-Manager</span>
            </button>
          </div>
        </div>

        <button type="button" class="safi-invite-del" data-del-id="${row.id}" title="Remove member">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `).join('');
  }

  bindInviteEvents() {
    const table = this.modalCard.querySelector('#safi-invite-table');
    const addBtn = this.modalCard.querySelector('#safi-invite-add-row');
    const skipBtn = this.modalCard.querySelector('#safi-invite-skip-btn');
    const submitBtn = this.modalCard.querySelector('#safi-invite-submit-btn');
    const closeBtn = this.modalCard.querySelector('#safi-invite-close');
    const limitBanner = this.modalCard.querySelector('#safi-plan-limit-banner');
    const limitMsg = this.modalCard.querySelector('#safi-plan-limit-msg');

    // Add Row with Plan Limit Verification
    addBtn?.addEventListener('click', () => {
      const planInfo = this.getPlanInfo();
      const currentCount = this.inviteRows.length;

      if (!planInfo.isUnlimited && currentCount >= planInfo.remainingSlots) {
        if (limitBanner) {
          limitBanner.style.display = 'flex';
          if (limitMsg) {
            if (planInfo.plan === 'Free') {
              limitMsg.textContent = 'Free Plan limit reached (2 seats maximum: 1 owner + 1 teammate). Upgrade to invite more members.';
            } else {
              limitMsg.textContent = `Plan seat limit reached (${planInfo.maxSeats} maximum). Upgrade to add more members.`;
            }
          }
          // Subtle pulse to indicate attention
          limitBanner.style.transition = 'transform 0.15s ease';
          limitBanner.style.transform = 'scale(1.02)';
          setTimeout(() => { limitBanner.style.transform = 'scale(1)'; }, 160);
        }
        return;
      }

      this.inviteRows.push({ id: this.nextRowId++, email: '', role: 'sales_rep' });
      table.innerHTML = this.renderInviteRows();
      this.bindInviteInputListeners();

      // Check if now at limit
      const nowAtLimit = !planInfo.isUnlimited && this.inviteRows.length >= planInfo.remainingSlots;
      if (limitBanner) {
        limitBanner.style.display = nowAtLimit ? 'flex' : 'none';
      }
    });

    this.bindInviteInputListeners();

    // Skip Button -> Proceeds directly to GIF Welcome & Tour Modal
    skipBtn?.addEventListener('click', () => {
      this.showTourPrompt();
    });

    // Close button (×)
    closeBtn?.addEventListener('click', () => {
      this.showTourPrompt();
    });

    // Submit Button -> Dispatches invites, then proceeds to GIF Welcome & Tour Modal
    submitBtn?.addEventListener('click', () => {
      this.handleSendInvites();
    });
  }

  bindInviteInputListeners() {
    const table = this.modalCard.querySelector('#safi-invite-table');
    const limitBanner = this.modalCard.querySelector('#safi-plan-limit-banner');
    if (!table) return;

    table.querySelectorAll('.safi-invite-row').forEach(rowEl => {
      const rowId = parseInt(rowEl.getAttribute('data-row-id'), 10);
      const emailInput = rowEl.querySelector('input[data-field="email"]');
      const delBtn = rowEl.querySelector('.safi-invite-del');
      const rolePicker = rowEl.querySelector('.safi-role-picker');
      const roleChip = rolePicker?.querySelector('[data-role-chip]');
      const roleOptions = rolePicker?.querySelectorAll('.safi-role-option');

      // Email input typing
      emailInput?.addEventListener('input', (e) => {
        const item = this.inviteRows.find(r => r.id === rowId);
        if (item) item.email = e.target.value.trim();
      });

      // Role chip click -> Toggle custom dropdown
      roleChip?.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasOpen = rolePicker.classList.contains('is-open');
        // Close all other open pickers
        document.querySelectorAll('.safi-role-picker.is-open').forEach(p => p.classList.remove('is-open'));
        if (!wasOpen) {
          rolePicker.classList.add('is-open');
        }
      });

      // Role option click -> Select role
      roleOptions?.forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const pickedRole = opt.getAttribute('data-role');
          const item = this.inviteRows.find(r => r.id === rowId);
          if (item) item.role = pickedRole;

          // Update active styling
          roleOptions.forEach(o => o.classList.remove('is-active'));
          opt.classList.add('is-active');

          // Update chip display
          const label = rolePicker.querySelector('.safi-role-label');
          const dot = rolePicker.querySelector('.safi-role-dot');
          if (label) label.textContent = this.getRoleLabel(pickedRole);
          if (dot) dot.className = `safi-role-dot safi-role-dot--${pickedRole}`;

          rolePicker.classList.remove('is-open');
        });
      });

      // Delete Row
      delBtn?.addEventListener('click', () => {
        if (this.inviteRows.length <= 1) {
          const item = this.inviteRows.find(r => r.id === rowId);
          if (item) item.email = '';
          if (emailInput) emailInput.value = '';
          return;
        }
        this.inviteRows = this.inviteRows.filter(r => r.id !== rowId);
        table.innerHTML = this.renderInviteRows();
        this.bindInviteInputListeners();

        // Update limit banner visibility
        const planInfo = this.getPlanInfo();
        if (limitBanner) {
          const isAtLimit = !planInfo.isUnlimited && this.inviteRows.length >= planInfo.remainingSlots;
          limitBanner.style.display = isAtLimit ? 'flex' : 'none';
        }
      });
    });
  }

  async handleSendInvites() {
    const validRows = this.inviteRows.filter(r => r.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
    const feedback = this.modalCard.querySelector('#safi-invite-feedback');
    const submitBtn = this.modalCard.querySelector('#safi-invite-submit-btn');

    if (validRows.length === 0) {
      this.showTourPrompt();
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending invites…';
    }

    if (this.isTest) {
      setTimeout(() => {
        if (feedback) {
          feedback.style.display = 'block';
          feedback.style.background = 'rgba(22, 163, 74, 0.08)';
          feedback.style.color = '#16a34a';
          feedback.textContent = `[Test Mode] ${validRows.length} invite${validRows.length > 1 ? 's' : ''} sent. Proceeding…`;
        }
        setTimeout(() => this.showTourPrompt(), 600);
      }, 500);
      return;
    }

    try {
      const SUPABASE_URL = (window.APP_CONFIG || {}).SUPABASE_URL;
      const session = (await window.supabaseClient?.auth?.getSession())?.data?.session;
      const accessToken = session?.access_token;

      let successCount = 0;
      for (const row of validRows) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/send-invite`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`,
              'apikey': (window.APP_CONFIG || {}).SUPABASE_KEY
            },
            body: JSON.stringify({ email: row.email, role: row.role })
          });
          if (res.ok) successCount++;
        } catch (_e) { /* non-blocking */ }
      }

      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.background = 'rgba(22, 163, 74, 0.08)';
        feedback.style.color = '#16a34a';
        feedback.textContent = `Dispatched ${successCount} invitation${successCount > 1 ? 's' : ''}. Proceeding…`;
      }
      setTimeout(() => this.showTourPrompt(), 700);
    } catch (_err) {
      this.showTourPrompt();
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // STAGE 2: GIF WELCOME & TOUR CARD (Exact Match to Reference Anatomy)
  // ═════════════════════════════════════════════════════════════════════════
  showTourPrompt() {
    this.currentView = 'tour';
    this.openOverlay();

    const orgName = this.getOrganizationName();

    let titleText = 'Welcome to SafiTrack';
    let bodyText = 'Track field operations in real-time, streamline your deal pipelines, dispatch work orders, and manage client accounts with ease. Take an interactive tour to explore your new operating system.';

    if (this.role === 'sales_rep') {
      titleText = 'Welcome to SafiTrack';
      bodyText = `Your workspace at ${orgName} is ready. Verify on-site client visits with 1-tap GPS check-ins, advance opportunities through stages, and keep tasks synced on mobile.`;
    } else if (this.role === 'technician') {
      titleText = 'Welcome to Field Service';
      bodyText = `Your technician workspace at ${orgName} is provisioned. Access work orders, log equipment parts, capture customer sign-offs, and view optimized daily service routes.`;
    }

    this.modalCard.className = 'safi-card-modal';
    this.modalCard.innerHTML = `
      <!-- Top Media Window for the User-provided GIF -->
      <div class="safi-card-media">
        <img 
          src="https://i.pinimg.com/originals/1a/a0/71/1aa071a3f59c5b459fd8d41bd4cede2e.gif" 
          alt="SafiTrack Workspace Interface"
          loading="eager"
        />
      </div>

      <!-- Content Area matching Reference Anatomy -->
      <div class="safi-card-content">
        <h2 class="safi-card-title">${titleText}</h2>
        <p class="safi-card-text">${bodyText}</p>

        <div class="safi-card-divider"></div>

        <div class="safi-card-footer">
          <button type="button" class="safi-btn-skip" id="safi-tour-skip-btn">
            Skip
          </button>
          <button type="button" class="safi-btn-action" id="safi-tour-take-btn">
            Take a tour
          </button>
        </div>
      </div>
    `;

    const skipBtn = this.modalCard.querySelector('#safi-tour-skip-btn');
    const takeTourBtn = this.modalCard.querySelector('#safi-tour-take-btn');

    skipBtn?.addEventListener('click', () => {
      this.close();
      this.navigateToInitialRoleView();
    });

    takeTourBtn?.addEventListener('click', () => {
      this.closeOverlay();
      this.startInteractiveTour();
    });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // STAGE 3: INTERACTIVE CRM WALKTHROUGH (Expanded Multi-Step Spotlight)
  // ═════════════════════════════════════════════════════════════════════════
  buildTourSteps() {
    if (this.role === 'sales_rep') {
      this.tourSteps = [
        {
          targetSelector: "button[data-view='log-visit']",
          viewToActivate: 'log-visit',
          title: 'Instant GPS Check-in',
          desc: 'Verify on-site client visits with a single tap. SafiTrack verifies your exact GPS coordinates, lets you attach meeting notes, capture photos, and logs it directly to the customer file.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='my-activity']",
          viewToActivate: 'my-activity',
          title: 'My Activity & Visit History',
          desc: 'Review your personal log of past check-ins, customer meeting summaries, notes, and visit timestamps to track your daily and weekly field productivity.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='sales-funnel']",
          viewToActivate: 'sales-funnel',
          title: 'Sales Funnel & Conversion',
          desc: 'Inspect your personal sales funnel. Monitor lead volume, qualification velocity, and see exactly where deals are advancing towards closing.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='opportunity-pipeline']",
          viewToActivate: 'opportunity-pipeline',
          title: 'Your Deals Pipeline',
          desc: 'Manage your active opportunities on an interactive Kanban board. Move deals across stages with drag-and-drop, update deal sizes, and keep your revenue forecasts accurate.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='my-routes']",
          fallbackSelector: "button[data-view='route-planning']",
          viewToActivate: 'my-routes',
          title: 'My Routes & Driving Stops',
          desc: 'View your daily assigned customer stops in optimal driving sequence. Tap any client destination to launch turn-by-turn navigation in Google or Apple Maps.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='tasks']",
          viewToActivate: 'tasks',
          title: 'Daily Tasks & Follow-up Reminders',
          desc: 'Never miss a scheduled call, proposal submission, or client check-in. Set reminders and track all your pending action items in one place.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='call-logs']",
          viewToActivate: 'call-logs',
          title: 'Call Logs & Communication History',
          desc: 'Keep track of client telephone touchpoints, log call outcomes, and queue follow-up reminders immediately after concluding meetings.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "#sidebar-quick-actions-btn",
          fallbackSelector: "#global-search-input, .sidebar-header",
          viewToActivate: null,
          title: 'Quick Actions & Instant Search (⌘K)',
          desc: 'Press ⌘K from anywhere to quickly log a visit, find a client phone number, or record a new opportunity on the fly without breaking your workflow.',
          preferredPosition: 'right'
        }
      ];
    } else if (this.role === 'technician') {
      this.tourSteps = [
        {
          targetSelector: "button[data-view='technician-log-visit']",
          viewToActivate: 'technician-log-visit',
          title: 'Work Order & Service Check-in',
          desc: 'Record on-site arrivals, service checklist completions, installed equipment parts, and capture customer sign-offs directly on your mobile device.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='technician-activity']",
          viewToActivate: 'technician-activity',
          title: 'Service History & Past Work Orders',
          desc: 'Review completed maintenance logs, past technician notes, and equipment service histories across all client installations in your region.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='route-planning']",
          fallbackSelector: "button[data-view='tasks']",
          viewToActivate: 'route-planning',
          title: 'Service Routes & Dispatch Stops',
          desc: 'Access your optimized daily service route. See prioritized repair stops, customer location notes, and driving times with turn-by-turn links.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='contracts']",
          viewToActivate: 'contracts',
          title: 'Service Contracts & Warranty SLAs',
          desc: 'Verify active customer warranty coverage, contract tiers, and SLA response times right before starting maintenance.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='manuals']",
          viewToActivate: 'manuals',
          title: 'Equipment Manuals & Schematics',
          desc: 'Access technical documentation, wiring diagrams, and parts catalogues instantly in the field from your mobile device.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='tasks']",
          viewToActivate: 'tasks',
          title: 'Maintenance Tasks & Action Items',
          desc: 'Keep track of recurring maintenance schedules, safety inspections, and parts reorder tasks with automated due date reminders.',
          preferredPosition: 'right'
        }
      ];
    } else {
      // Manager Flow (Default) - 9 Comprehensive Steps
      this.tourSteps = [
        {
          targetSelector: "button[data-view='main-dashboard']",
          fallbackSelector: "#dashboard-top-nav, button[data-view='dashboard'], button[data-view='team-dashboard']",
          viewToActivate: 'main-dashboard',
          title: 'Live Operations & Territory Map',
          desc: 'Track active field reps in real time on an interactive map. View live GPS breadcrumbs, verified on-site client visits, and current territory coverage across your entire team.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='opportunity-pipeline']",
          viewToActivate: 'opportunity-pipeline',
          title: 'Deal Pipeline & Revenue Tracking',
          desc: 'Monitor pipeline health across every deal stage. Drag and drop opportunities, inspect deal values, closing probabilities, and forecast upcoming quarterly revenue.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='companies']",
          viewToActivate: 'companies',
          title: 'Accounts & Client Directory',
          desc: 'Maintain a single source of truth for enterprise client accounts, subsidiaries, branch locations, and key stakeholders with a unified log of past visits and agreements.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='people']",
          viewToActivate: 'people',
          title: 'People & Decision Makers',
          desc: 'Access direct contact details, phone numbers, email histories, and role titles for every client decision-maker in one unified, searchable directory.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='route-planning']",
          viewToActivate: 'route-planning',
          title: 'Field Route Planning & Dispatch',
          desc: 'Build optimized multi-stop driving routes for reps and technicians. Balance territory workloads, minimize transit time, and push scheduled routes directly to mobile devices.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='tasks']",
          viewToActivate: 'tasks',
          title: 'Tasks & Operational Follow-ups',
          desc: 'Assign tasks, set priorities, and track upcoming deadlines across your team. Ensure critical customer follow-ups and service milestones are never missed.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='workflows']",
          viewToActivate: 'workflows',
          title: 'Workflow Automation Engine',
          desc: 'Automate repetitive processes: trigger instant alerts when high-value deals enter negotiation, auto-assign route changes, and notify managers on stage movements.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "button[data-view='reports']",
          viewToActivate: 'reports',
          title: 'Analytics & Executive Reports',
          desc: 'Review conversion velocity, territory performance, team check-in activity, and export detailed CSV reports for executive reviews and payroll.',
          preferredPosition: 'right'
        },
        {
          targetSelector: "#sidebar-quick-actions-btn",
          fallbackSelector: "#global-search-input, .sidebar-header",
          viewToActivate: null,
          title: 'Quick Actions & ⌘K Command Palette',
          desc: 'Launch rapid workflows from anywhere: log a visit, create a deal, schedule a route stop, or find any client record instantly using keyboard shortcuts.',
          preferredPosition: 'right'
        }
      ];
    }
  }

  startInteractiveTour() {
    this.currentView = 'interactive';
    this.closeOverlay();
    this.buildTourSteps();
    this.tourStepIndex = 0;

    this.renderSpotlightCard();
    this.goToTourStep(0);
  }

  renderSpotlightCard() {
    if (!this.spotlightCard) {
      this.spotlightCard = document.createElement('div');
      this.spotlightCard.className = 'safi-crm-spotlight-card';
      this.spotlightCard.id = 'safi-crm-spotlight-card';
      document.body.appendChild(this.spotlightCard);
    }
  }

  goToTourStep(index) {
    if (index < 0 || index >= this.tourSteps.length) {
      this.finishInteractiveTour();
      return;
    }

    this.tourStepIndex = index;
    const step = this.tourSteps[index];

    if (step.viewToActivate) {
      const viewBtn = document.querySelector(`button[data-view='${step.viewToActivate}']`);
      if (viewBtn) {
        viewBtn.click();
      }
    }

    setTimeout(() => {
      this.highlightTourStep(step);
    }, 150);
  }

  highlightTourStep(step) {
    this.clearTargetRing();

    let target = document.querySelector(step.targetSelector);
    if (!target && step.fallbackSelector) {
      target = document.querySelector(step.fallbackSelector);
    }

    if (!target || target.offsetParent === null) {
      target = document.querySelector('.sidebar') || document.querySelector('#sidebar-nav') || document.body;
    }

    this.currentTargetEl = target;

    if (target && target !== document.body) {
      target.classList.add('safi-tour-target-ring');
      try {
        target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      } catch (_e) { /* ignore */ }
    }

    const totalSteps = this.tourSteps.length;
    const stepNum = this.tourStepIndex + 1;
    const isFirst = this.tourStepIndex === 0;
    const isLast = this.tourStepIndex === totalSteps - 1;

    this.spotlightCard.innerHTML = `
      <div class="safi-spotlight-header">
        <span class="safi-spotlight-step">Step ${stepNum} of ${totalSteps}</span>
        <button type="button" class="safi-spotlight-close" id="safi-spotlight-close-btn" title="End tour">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <h3 class="safi-spotlight-title">${step.title}</h3>
      <p class="safi-spotlight-desc">${step.desc}</p>

      <div class="safi-spotlight-footer">
        <button type="button" class="safi-spotlight-exit" id="safi-spotlight-exit-btn">
          Exit tour
        </button>
        <div class="safi-spotlight-nav">
          ${!isFirst ? `
            <button type="button" class="safi-spotlight-btn-prev" id="safi-spotlight-prev-btn">
              ← Back
            </button>
          ` : ''}
          <button type="button" class="safi-spotlight-btn-next" id="safi-spotlight-next-btn">
            ${isLast ? 'Finish Tour ✓' : 'Next →'}
          </button>
        </div>
      </div>
    `;

    this.positionSpotlightCard(target, step.preferredPosition);

    this.spotlightCard.querySelector('#safi-spotlight-close-btn')?.addEventListener('click', () => {
      this.finishInteractiveTour();
    });

    this.spotlightCard.querySelector('#safi-spotlight-exit-btn')?.addEventListener('click', () => {
      this.finishInteractiveTour();
    });

    this.spotlightCard.querySelector('#safi-spotlight-prev-btn')?.addEventListener('click', () => {
      this.goToTourStep(this.tourStepIndex - 1);
    });

    this.spotlightCard.querySelector('#safi-spotlight-next-btn')?.addEventListener('click', () => {
      this.goToTourStep(this.tourStepIndex + 1);
    });
  }

  positionSpotlightCard(targetEl, preferredSide = 'right') {
    if (!this.spotlightCard || !targetEl) return;

    const cardRect = this.spotlightCard.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const margin = 14;

    let top = 0;
    let left = 0;

    if (targetEl === document.body) {
      top = Math.max(20, (window.innerHeight - cardRect.height) / 2);
      left = Math.max(20, (window.innerWidth - cardRect.width) / 2);
    } else if (preferredSide === 'right' && (targetRect.right + cardRect.width + margin) < window.innerWidth) {
      left = targetRect.right + margin;
      top = targetRect.top + (targetRect.height / 2) - 30;
    } else if (preferredSide === 'bottom' || (targetRect.bottom + cardRect.height + margin) < window.innerHeight) {
      top = targetRect.bottom + margin;
      left = targetRect.left;
    } else {
      left = Math.min(window.innerWidth - cardRect.width - 20, Math.max(20, targetRect.left));
      top = Math.max(20, targetRect.top - cardRect.height - margin);
    }

    const clampedTop = Math.max(16, Math.min(window.innerHeight - cardRect.height - 16, top));
    const clampedLeft = Math.max(16, Math.min(window.innerWidth - cardRect.width - 16, left));

    this.spotlightCard.style.top = `${clampedTop}px`;
    this.spotlightCard.style.left = `${clampedLeft}px`;
  }

  clearTargetRing() {
    if (this.currentTargetEl) {
      this.currentTargetEl.classList.remove('safi-tour-target-ring');
      this.currentTargetEl = null;
    }
  }

  stopInteractiveTour() {
    this.clearTargetRing();
    if (this.spotlightCard) {
      this.spotlightCard.remove();
      this.spotlightCard = null;
    }
  }

  finishInteractiveTour() {
    this.isActive = false;
    this.stopInteractiveTour();
    if (window.showToast) {
      window.showToast('You are all set! Welcome to your SafiTrack workspace.', 'success');
    }
    this.navigateToInitialRoleView();
  }

  navigateToInitialRoleView() {
    if (this.role === 'sales_rep') {
      document.querySelector("button[data-view='log-visit']")?.click();
    } else if (this.role === 'technician') {
      document.querySelector("button[data-view='technician-log-visit']")?.click();
    } else {
      (document.querySelector("button[data-view='main-dashboard']") || document.querySelector("button[data-view='dashboard']"))?.click();
    }
  }


  // ── Global Event Handlers ────────────────────────────────────────────────
  handleResize() {
    if (this.currentView === 'interactive' && this.currentTargetEl) {
      const step = this.tourSteps[this.tourStepIndex];
      if (step) {
        this.positionSpotlightCard(this.currentTargetEl, step.preferredPosition);
      }
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (this.currentView === 'interactive') {
        this.finishInteractiveTour();
      } else if (this.overlay && this.overlay.classList.contains('active')) {
        this.close();
      }
    }
  }

  handleDocumentClick(e) {
    // Close role pickers when clicking outside
    if (!e.target.closest('.safi-role-picker')) {
      document.querySelectorAll('.safi-role-picker.is-open').forEach(p => p.classList.remove('is-open'));
    }
  }
}

// ── Global Singleton Export ────────────────────────────────────────────────
const safiOnboarding = new SafiOnboardingManager();
window.onboarding = safiOnboarding;
window.SafiOnboarding = safiOnboarding;
