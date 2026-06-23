/**
 * SafiTrack Onboarding Manager
 * Features: Linear navigation, staggered animations, neutral aesthetics, and centered completion card.
 */

class OnboardingManager {
    constructor() {
        this.steps = [];
        this.currentStepIndex = -1;
        this.overlay = null;
        this.bubble = null;
        this.role = 'sales_rep';
        this.isInitialized = false;
    }

    init(userRole = 'sales_rep') {
        if (this.isInitialized) return;
        this.role = userRole;
        this.createElements();
        this.defineSteps();
        this.isInitialized = true;
    }

    getUserFirstName() {
        if (window.state && window.state.currentUserProfile && window.state.currentUserProfile.first_name) {
            return window.state.currentUserProfile.first_name;
        }
        return "";
    }

    getGreeting() {
        const hour = new Date().getHours();
        const name = this.getUserFirstName();
        let greeting = "Welcome";
        if (hour < 12) greeting = "Good morning";
        else if (hour < 18) greeting = "Good afternoon";
        else greeting = "Good evening";
        
        return name ? `${greeting}, ${name}.` : `${greeting}.`;
    }

    getRoleSubtext() {
        if (this.role === 'manager') return "Let's set up your command center.";
        if (this.role === 'technician') return "Let's get your service routes organized.";
        return "Let's set up your sales workspace.";
    }

    createElements() {
        // Create Overlay
        this.overlay = document.createElement('div');
        this.overlay.className = 'onboarding-overlay';
        this.overlay.innerHTML = `
            <svg class="onboarding-svg">
                <defs>
                    <mask id="onboarding-mask">
                        <rect width="100%" height="100%" fill="white" />
                        <rect id="onboarding-hole" x="0" y="0" width="0" height="0" rx="12" fill="black" />
                    </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.5)" mask="url(#onboarding-mask)" />
            </svg>
        `;
        document.body.appendChild(this.overlay);

        // Create Bubble
        this.bubble = document.createElement('div');
        this.bubble.className = 'onboarding-bubble';
        this.bubble.innerHTML = `
            <div class="onboarding-progress-container">
                <div class="onboarding-progress-bar" id="ob-bar"></div>
            </div>
            <div class="onboarding-bubble-content" id="ob-content-area">
                <div class="ob-title-group">
                    <span id="ob-icon" class="ob-icon"></span>
                    <h3 id="ob-title">--</h3>
                </div>
                <p id="ob-text">--</p>
            </div>
            <div class="onboarding-bubble-footer" id="ob-footer">
                <button class="ob-btn ob-btn-skip" id="ob-skip">Skip</button>
                <div class="onboarding-actions-right">
                    <button class="ob-btn ob-btn-back" id="ob-back">Back</button>
                    <button class="ob-btn ob-btn-next" id="ob-next">Next</button>
                </div>
            </div>
            <div class="onboarding-arrow" id="ob-arrow"></div>
        `;
        document.body.appendChild(this.bubble);

        // Event Listeners
        document.getElementById('ob-next').addEventListener('click', () => this.nextStep());
        document.getElementById('ob-back').addEventListener('click', () => this.prevStep());
        document.getElementById('ob-skip').addEventListener('click', () => this.end());
        window.addEventListener('resize', () => {
            if (this.currentStepIndex !== -1) this.updateStepPosition();
        });
    }

    defineSteps() {
        const welcomeStep = {
            type: 'welcome',
            title: this.getGreeting(),
            icon: "👋",
            text: this.getRoleSubtext() + " We'll show you around in a few quick steps so you can hit the ground running.",
        };

        const commonSteps = [
            {
                title: "Quick Actions & Search",
                icon: "⚡",
                text: "Press ⌘K (or Ctrl+K) to add tasks or reminders instantly. Press / to search everything.",
                target: "#sidebar-quick-actions-btn",
                position: "right"
            },
            {
                title: "Your To-Do List",
                icon: "✅",
                text: "Manage daily tasks and follow-ups. Never drop the ball.",
                target: "button[data-view='tasks']",
                position: "right",
                action: () => document.querySelector("button[data-view='tasks']")?.click()
            },
            {
                title: "Smart Alerts",
                icon: "🔔",
                text: "Set time-sensitive reminders. We'll ping you when it's time.",
                target: "button[data-view='reminders']",
                position: "right",
                action: () => document.querySelector("button[data-view='reminders']")?.click()
            }
        ];

        const recordSteps = [
            {
                title: "Companies",
                icon: "🏢",
                text: "All your clients and prospects in one place.",
                target: "button[data-view='companies']",
                position: "right",
                action: () => document.querySelector("button[data-view='companies']")?.click()
            },
            {
                title: "People",
                icon: "👤",
                text: "Track the key contacts you meet for better relationship building.",
                target: "button[data-view='people']",
                position: "right",
                action: () => document.querySelector("button[data-view='people']")?.click()
            }
        ];

        if (this.role === 'manager') {
            this.steps = [
                welcomeStep,
                ...commonSteps,
                {
                    title: "Leaderboard",
                    icon: "📈",
                    text: "Track team performance and real-time sales leaderboards.",
                    target: "button[data-view='main-dashboard']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='main-dashboard']")?.click()
                },
                {
                    title: "Live Team Map",
                    icon: "🗺️",
                    text: "See exactly where your field reps are in real-time and review their daily tracks.",
                    target: "button[data-view='team-dashboard']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='team-dashboard']")?.click()
                },
                ...recordSteps,
                {
                    title: "Advanced Reports",
                    icon: "📊",
                    text: "Slice and dice your field data to uncover trends and make strategic decisions.",
                    target: "button[data-view='reports']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='reports']")?.click()
                },
                {
                    title: "Route Master",
                    icon: "📍",
                    text: "Plan and assign optimized routes for your team out in the field.",
                    target: "button[data-view='route-planning']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='route-planning']")?.click()
                },
                {
                    title: "Team Access",
                    icon: "🛡️",
                    text: "Manage user roles and permissions from this secure dashboard.",
                    target: "button[data-view='user-management']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='user-management']")?.click()
                }
            ];
        } else if (this.role === 'technician') {
            this.steps = [
                welcomeStep,
                {
                    title: "Your Checklist",
                    icon: "✅",
                    text: "Stay organized with your daily operational check-items.",
                    target: "button[data-view='tasks']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='tasks']")?.click()
                },
                {
                    title: "Service Reminders",
                    icon: "🔔",
                    text: "Get alerts for scheduled maintenance and follow-ups.",
                    target: "button[data-view='reminders']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='reminders']")?.click()
                },
                {
                    title: "Field Notes",
                    icon: "📝",
                    text: "Jot down important details and observations from your visits.",
                    target: "button[data-view='notes']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='notes']")?.click()
                },
                {
                    title: "Log Your Service",
                    icon: "🔧",
                    text: "Your primary tool. Log service visits, parts used, and work performed.",
                    target: "button[data-view='technician-log-visit']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='technician-log-visit']")?.click()
                },
                {
                    title: "History",
                    icon: "📊",
                    text: "Review past service visits and your technical performance.",
                    target: "button[data-view='technician-activity']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='technician-activity']")?.click()
                }
            ];
        } else {
            this.steps = [
                welcomeStep,
                ...commonSteps,
                {
                    title: "Log Your Visits",
                    icon: "📍",
                    text: "Your bread and butter. Check-in at locations and sync details instantly.",
                    target: "button[data-view='log-visit']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='log-visit']")?.click()
                },
                {
                    title: "Pipeline",
                    icon: "💰",
                    text: "Track your active deals through their stages to visualize revenue.",
                    target: "button[data-view='opportunity-pipeline']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='opportunity-pipeline']")?.click()
                },
                ...recordSteps,
                {
                    title: "Your Activity",
                    icon: "📊",
                    text: "Review your visit history and personal growth trends.",
                    target: "button[data-view='my-activity']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='my-activity']")?.click()
                }
            ];
        }
    }

    start() {
        // Refresh steps to grab the latest user name and time of day
        this.defineSteps();
        
        this.currentStepIndex = 0;
        this.overlay.classList.add('active');
        this.bubble.classList.add('active');
        this.showStep();
        localStorage.setItem('safitrack_onboarding_completed', 'true');
    }

    nextStep() {
        if (this.currentStepIndex < this.steps.length - 1) {
            this.currentStepIndex++;
            this.showStep();
        } else {
            this.showFinish();
        }
    }

    prevStep() {
        if (this.currentStepIndex > 0) {
            this.currentStepIndex--;
            this.showStep();
        }
    }

    showStep() {
        const step = this.steps[this.currentStepIndex];

        // Reset animations
        this.bubble.classList.remove('active');
        void this.bubble.offsetWidth; // Trigger reflow
        this.bubble.classList.add('active');

        // Restore default layout in case it was modified by welcome/finish screens
        const contentArea = document.getElementById('ob-content-area');
        if (contentArea) {
            contentArea.innerHTML = `
                <div class="ob-title-group">
                    <span id="ob-icon" class="ob-icon"></span>
                    <h3 id="ob-title">--</h3>
                </div>
                <p id="ob-text">--</p>
            `;
        }

        const arrow = document.getElementById('ob-arrow');
        const footer = document.getElementById('ob-footer');
        const progressBar = document.querySelector('.onboarding-progress-container');
        
        if (arrow) arrow.style.display = 'block';
        if (progressBar) progressBar.style.display = 'block';
        if (footer) footer.style.display = 'flex';

        if (step.type === 'welcome') {
            if (arrow) arrow.style.display = 'none';
            if (progressBar) progressBar.style.display = 'none';
            
            contentArea.innerHTML = `
                <div class="onboarding-celebrate" style="text-align: center; padding: 1rem 0;">
                    <div style="font-size: 3rem; margin-bottom: 0.5rem;">${step.icon}</div>
                    <h2 style="margin-bottom: 0.5rem; font-size: 1.5rem;">${step.title}</h2>
                    <p style="color: var(--text-sec); font-size: 1.05rem; line-height: 1.5;">${step.text}</p>
                </div>
            `;
            
            document.getElementById('ob-back').style.visibility = 'hidden';
            document.getElementById('ob-next').innerText = "Let's Go";
            
            const hole = document.getElementById('onboarding-hole');
            if (hole) {
                hole.setAttribute('width', '0');
                hole.setAttribute('height', '0');
            }
            
            // Center the bubble
            setTimeout(() => {
                const bRect = this.bubble.getBoundingClientRect();
                this.bubble.style.top = `${(window.innerHeight / 2) - (bRect.height / 2)}px`;
                this.bubble.style.left = `${(window.innerWidth / 2) - (bRect.width / 2)}px`;
            }, 50);

        } else {
            // Standard step
            document.getElementById('ob-title').innerText = step.title;
            document.getElementById('ob-icon').innerText = step.icon || "✨";
            document.getElementById('ob-text').innerText = step.text;

            // Progress bar
            const totalNormalSteps = this.steps.filter(s => s.type !== 'welcome').length;
            const currentNormalStep = this.currentStepIndex; // 0 is welcome
            const progress = (currentNormalStep / totalNormalSteps) * 100;
            document.getElementById('ob-bar').style.width = `${progress}%`;

            // Navigation visibility
            document.getElementById('ob-back').style.visibility = this.currentStepIndex > 0 ? 'visible' : 'hidden';
            document.getElementById('ob-next').innerText = this.currentStepIndex === this.steps.length - 1 ? "Finish" : "Next";

            // Execute action to open the appropriate tab
            if (step.action) step.action();

            // Position bubble near the target
            setTimeout(() => this.updateStepPosition(), 150);
        }
    }

    updateStepPosition() {
        if (this.currentStepIndex === -1) return;
        const step = this.steps[this.currentStepIndex];
        if (!step || step.type === 'welcome') return;

        const target = document.querySelector(step.target);
        if (!target) {
            console.warn('Target not found:', step.target);
            this.nextStep();
            return;
        }

        const rect = target.getBoundingClientRect();
        const hole = document.getElementById('onboarding-hole');
        const padding = 12;

        hole.setAttribute('x', rect.left - padding);
        hole.setAttribute('y', rect.top - padding);
        hole.setAttribute('width', rect.width + padding * 2);
        hole.setAttribute('height', rect.height + padding * 2);

        // Position bubble
        const bRect = this.bubble.getBoundingClientRect();
        const gap = 24;
        let bTop, bLeft;

        switch (step.position) {
            case 'bottom': bTop = rect.bottom + gap; bLeft = rect.left + (rect.width / 2) - (bRect.width / 2); break;
            case 'right': bTop = rect.top + (rect.height / 2) - (bRect.height / 2); bLeft = rect.right + gap; break;
            case 'left': bTop = rect.top + (rect.height / 2) - (bRect.height / 2); bLeft = rect.left - bRect.width - gap; break;
            case 'top': bTop = rect.top - bRect.height - gap; bLeft = rect.left + (rect.width / 2) - (bRect.width / 2); break;
        }

        bLeft = Math.max(16, Math.min(bLeft, window.innerWidth - bRect.width - 16));
        bTop = Math.max(16, Math.min(bTop, window.innerHeight - bRect.height - 16));

        this.bubble.style.top = `${bTop}px`;
        this.bubble.style.left = `${bLeft}px`;

        const arrow = document.getElementById('ob-arrow');
        if (arrow) arrow.className = `onboarding-arrow arrow-${step.position}`;
    }

    showFinish() {
        const contentArea = document.getElementById('ob-content-area');
        const footer = document.getElementById('ob-footer');
        
        if (contentArea) {
            contentArea.innerHTML = `
                <div class="onboarding-celebrate" style="text-align: center; padding: 1rem 0;">
                    <i class="fas fa-check-circle" style="font-size: 3rem; color: var(--color-success); margin-bottom: 0.5rem;"></i>
                    <h3 style="font-size: 1.5rem; margin-bottom: 0.5rem;">You're all set!</h3>
                    <p style="color: var(--text-sec); font-size: 1.05rem;">You're ready to master SafiTrack. Let's get to work.</p>
                </div>
            `;
        }
        
        if (footer) {
            footer.innerHTML = `
                <button class="ob-btn ob-btn-next" style="width:100%; justify-content:center;" id="ob-finish">Start Using SafiTrack</button>
            `;
            document.getElementById('ob-finish').onclick = () => this.end();
        }

        const hole = document.getElementById('onboarding-hole');
        if (hole) {
            hole.setAttribute('width', '0');
            hole.setAttribute('height', '0');
        }

        const progressBar = document.querySelector('.onboarding-progress-container');
        if (progressBar) progressBar.style.display = 'none';

        // Force center positioning
        setTimeout(() => {
            const bRect = this.bubble.getBoundingClientRect();
            this.bubble.style.top = `${(window.innerHeight / 2) - (bRect.height / 2)}px`;
            this.bubble.style.left = `${(window.innerWidth / 2) - (bRect.width / 2)}px`;
            const arrow = document.getElementById('ob-arrow');
            if (arrow) arrow.style.display = 'none';
        }, 50);
    }

    end() {
        this.overlay.classList.remove('active');
        this.bubble.classList.remove('active');
        setTimeout(() => {
            const firstTab = document.querySelector(`.sidebar-nav-btn[data-view]`);
            if (firstTab) firstTab.click();
        }, 300);
    }
}

const onboarding = new OnboardingManager();
window.onboarding = onboarding;
