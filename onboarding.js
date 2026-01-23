/**
 * SafiTrack Onboarding Manager
 * Provides a high-end, role-based interactive onboarding experience.
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
        console.log('Onboarding initialized for role:', this.role);
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
                        <rect id="onboarding-hole" x="0" y="0" width="0" height="0" rx="8" fill="black" />
                    </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.7)" mask="url(#onboarding-mask)" />
            </svg>
        `;
        document.body.appendChild(this.overlay);

        // Create Bubble
        this.bubble = document.createElement('div');
        this.bubble.className = 'onboarding-bubble';
        this.bubble.innerHTML = `
            <div class="onboarding-bubble-content">
                <h3 id="ob-title">Welcome</h3>
                <p id="ob-text">Let's get started with SafiTrack.</p>
                <div class="onboarding-bubble-footer">
                    <span id="ob-progress">1 / 5</span>
                    <div class="onboarding-actions">
                        <button class="ob-btn ob-btn-skip" id="ob-skip">Skip</button>
                        <button class="ob-btn ob-btn-next" id="ob-next">Next</button>
                    </div>
                </div>
            </div>
            <div class="onboarding-arrow"></div>
        `;
        document.body.appendChild(this.bubble);

        // Event Listeners
        document.getElementById('ob-next').addEventListener('click', () => this.nextStep());
        document.getElementById('ob-skip').addEventListener('click', () => this.end());
        window.addEventListener('resize', () => this.updateStepPosition());
    }

    defineSteps() {
        const commonSteps = [
            {
                title: "Welcome to SafiTrack! 👋",
                text: "We're excited to have you here. This quick tour will show you how to navigate your new field sales companion.",
                target: ".header-brand",
                position: "bottom"
            },
            {
                title: "Need to find something fast?",
                text: "Use the Command Palette (Ctrl + K) to search for companies, people, or quickly jump between views.",
                target: "#command-palette-btn",
                position: "bottom"
            },
            {
                title: "Stay on Top of Tasks",
                text: "Manage your daily to-do list and never miss an important follow-up.",
                target: "button[data-view='tasks']",
                position: "right",
                action: () => document.querySelector("button[data-view='tasks']").click()
            },
            {
                title: "Never Forget a Follow-up",
                text: "Set time-sensitive reminders for yourself to stay ahead of the game.",
                target: "button[data-view='reminders']",
                position: "right",
                action: () => document.querySelector("button[data-view='reminders']").click()
            }
        ];

        const recordSteps = [
            {
                title: "Company Directory",
                text: "Your central database for all clients, partners, and prospects.",
                target: "button[data-view='companies']",
                position: "right",
                action: () => document.querySelector("button[data-view='companies']").click()
            },
            {
                title: "Key Contacts",
                text: "Keep track of the people you meet and their contact details.",
                target: "button[data-view='people']",
                position: "right",
                action: () => document.querySelector("button[data-view='people']").click()
            }
        ];

        const salesRepSteps = [
            ...commonSteps,
            {
                title: "Log Your Visits",
                text: "The core of SafiTrack. Record your check-ins and client interactions here to keep your records up to date.",
                target: "button[data-view='log-visit']",
                position: "right",
                action: () => document.querySelector("button[data-view='log-visit']").click()
            },
            {
                title: "Sales Opportunities",
                text: "Track your deals through the pipeline and visualize your revenue potential.",
                target: "button[data-view='opportunity-pipeline']",
                position: "right",
                action: () => document.querySelector("button[data-view='opportunity-pipeline']").click()
            },
            {
                title: "Sales Funnel",
                text: "A bird's eye view of your lead distribution across different stages.",
                target: "button[data-view='sales-funnel']",
                position: "right",
                action: () => document.querySelector("button[data-view='sales-funnel']").click()
            },
            ...recordSteps,
            {
                title: "Your Activity",
                text: "Monitor your own performance and history right here in the activity tab.",
                target: "button[data-view='my-activity']",
                position: "right",
                action: () => document.querySelector("button[data-view='my-activity']").click()
            }
        ];

        const managerSteps = [
            ...commonSteps,
            {
                title: "Manager Dashboard",
                text: "Get a high-level view of team performance and key metrics.",
                target: "button[data-view='main-dashboard']",
                position: "right",
                action: () => document.querySelector("button[data-view='main-dashboard']").click()
            },
            {
                title: "Team Activity Tracking",
                text: "Monitor all field visits as they happen in real-time.",
                target: "button[data-view='team-dashboard']",
                position: "right",
                action: () => document.querySelector("button[data-view='team-dashboard']").click()
            },
            {
                title: "Revenue Pipeline",
                text: "Oversee the entire team's sales pipeline and forecast performance.",
                target: "button[data-view='opportunity-pipeline']",
                position: "right",
                action: () => document.querySelector("button[data-view='opportunity-pipeline']").click()
            },
            {
                title: "Route Optimization",
                text: "Help your team stay efficient by planning optimized visit routes.",
                target: "button[data-view='route-planning']",
                position: "right",
                action: () => document.querySelector("button[data-view='route-planning']").click()
            },
            ...recordSteps,
            {
                title: "User Management",
                text: "Add new team members, manage roles, and control access levels.",
                target: "button[data-view='user-management']",
                position: "right",
                action: () => document.querySelector("button[data-view='user-management']").click()
            }
        ];

        const technicianSteps = [
            ...commonSteps,
            {
                title: "Service Visits",
                text: "Log your technical service records and part replacements here.",
                target: "button[data-view='technician-log-visit']",
                position: "right",
                action: () => document.querySelector("button[data-view='technician-log-visit']").click()
            },
            {
                title: "User Profile",
                text: "Manage your account and settings here.",
                target: "#user-menu",
                position: "bottom"
            }
        ];

        if (this.role === 'manager') this.steps = managerSteps;
        else if (this.role === 'technician') this.steps = technicianSteps;
        else this.steps = salesRepSteps;
    }

    start() {
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
            this.end();
        }
    }

    showStep() {
        const step = this.steps[this.currentStepIndex];

        // Update content
        document.getElementById('ob-title').innerText = step.title;
        document.getElementById('ob-text').innerText = step.text;
        document.getElementById('ob-progress').innerText = `${this.currentStepIndex + 1} / ${this.steps.length}`;

        const nextBtn = document.getElementById('ob-next');
        nextBtn.innerText = this.currentStepIndex === this.steps.length - 1 ? "Finish" : "Next";

        // Execute action if any
        if (step.action) step.action();

        // Position
        setTimeout(() => this.updateStepPosition(), 100);
    }

    updateStepPosition() {
        const step = this.steps[this.currentStepIndex];
        if (!step) return;

        const target = document.querySelector(step.target);
        if (!target) {
            console.warn('Onboarding target not found:', step.target);
            this.nextStep();
            return;
        }

        const rect = target.getBoundingClientRect();
        const hole = document.getElementById('onboarding-hole');
        const padding = 8;

        // Update Hole
        hole.setAttribute('x', rect.left - padding);
        hole.setAttribute('y', rect.top - padding);
        hole.setAttribute('width', rect.width + padding * 2);
        hole.setAttribute('height', rect.height + padding * 2);

        // Update Bubble Position
        let bTop, bLeft;
        const bRect = this.bubble.getBoundingClientRect();
        const gap = 20;

        switch (step.position) {
            case 'bottom':
                bTop = rect.bottom + gap;
                bLeft = rect.left + (rect.width / 2) - (bRect.width / 2);
                break;
            case 'right':
                bTop = rect.top + (rect.height / 2) - (bRect.height / 2);
                bLeft = rect.right + gap;
                break;
            case 'left':
                bTop = rect.top + (rect.height / 2) - (bRect.height / 2);
                bLeft = rect.left - bRect.width - gap;
                break;
            case 'top':
                bTop = rect.top - bRect.height - gap;
                bLeft = rect.left + (rect.width / 2) - (bRect.width / 2);
                break;
        }

        // Keep bubble in viewport
        bLeft = Math.max(10, Math.min(bLeft, window.innerWidth - bRect.width - 10));
        bTop = Math.max(10, Math.min(bTop, window.innerHeight - bRect.height - 10));

        this.bubble.style.top = `${bTop}px`;
        this.bubble.style.left = `${bLeft}px`;

        // Arrow positioning
        const arrow = this.bubble.querySelector('.onboarding-arrow');
        arrow.className = `onboarding-arrow arrow-${step.position}`;
    }

    end() {
        this.overlay.classList.remove('active');
        this.bubble.classList.remove('active');
        this.currentStepIndex = -1;
    }
}

const onboarding = new OnboardingManager();
window.onboarding = onboarding;
