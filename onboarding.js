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
            <div class="onboarding-bubble-content">
                <div class="ob-title-group">
                    <span id="ob-icon" class="ob-icon"></span>
                    <h3 id="ob-title">--</h3>
                </div>
                <p id="ob-text">--</p>
            </div>
            <div class="onboarding-bubble-footer">
                <button class="ob-btn ob-btn-skip" id="ob-skip">Skip</button>
                <div class="onboarding-actions-right">
                    <button class="ob-btn ob-btn-back" id="ob-back">Back</button>
                    <button class="ob-btn ob-btn-next" id="ob-next">Next</button>
                </div>
            </div>
            <div class="onboarding-arrow"></div>
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
        const commonSteps = [
            {
                title: "Welcome to SafiTrack!",
                icon: "👋",
                text: "We're excited to have you here. This quick tour will show you how to navigate your new field sales companion.",
                target: ".header-brand",
                position: "bottom"
            },
            {
                title: "Command Center",
                icon: "🔍",
                text: "Use the Command Palette (Ctrl + K) to search for companies, people, or quickly jump between views instantly.",
                target: "#command-palette-btn",
                position: "bottom"
            },
            {
                title: "Tasks & Focus",
                icon: "✅",
                text: "Manage your daily to-do list and never miss an important follow-up.",
                target: "button[data-view='tasks']",
                position: "right",
                action: () => document.querySelector("button[data-view='tasks']").click()
            },
            {
                title: "Smart Reminders",
                icon: "🔔",
                text: "Set time-sensitive reminders for yourself to stay ahead of the game with automatic alerts.",
                target: "button[data-view='reminders']",
                position: "right",
                action: () => document.querySelector("button[data-view='reminders']").click()
            }
        ];

        const recordSteps = [
            {
                title: "Companies",
                icon: "🏢",
                text: "Your central database for all your clients, partners, and business prospects.",
                target: "button[data-view='companies']",
                position: "right",
                action: () => document.querySelector("button[data-view='companies']").click()
            },
            {
                title: "Key Contacts",
                icon: "👤",
                text: "Keep track of the people you meet and their specific details for better relationship management.",
                target: "button[data-view='people']",
                position: "right",
                action: () => document.querySelector("button[data-view='people']").click()
            }
        ];

        if (this.role === 'manager') {
            this.steps = [
                ...commonSteps,
                {
                    title: "Leaderboard",
                    icon: "📈",
                    text: "Track team performance with key metrics and real-time sales leaderboards.",
                    target: "button[data-view='main-dashboard']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='main-dashboard']").click()
                },
                ...recordSteps,
                {
                    title: "Route Master",
                    icon: "📍",
                    text: "Help your team stay efficient by planning and assigning optimized GPS-verified routes.",
                    target: "button[data-view='route-planning']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='route-planning']").click()
                },
                {
                    title: "Team Management",
                    icon: "🛡️",
                    text: "Manage your users, roles, and administrative permissions from one secure dashboard.",
                    target: "button[data-view='user-management']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='user-management']").click()
                }
            ];
        } else {
            this.steps = [
                ...commonSteps,
                {
                    title: "Log Your Visits",
                    icon: "📍",
                    text: "The core of your workflow. Check-in at client locations and sync visit details in seconds.",
                    target: "button[data-view='log-visit']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='log-visit']").click()
                },
                {
                    title: "Revenue Pipeline",
                    icon: "💰",
                    text: "Track your deals through the stages and visualize your potential performance.",
                    target: "button[data-view='opportunity-pipeline']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='opportunity-pipeline']").click()
                },
                ...recordSteps,
                {
                    title: "Performance History",
                    icon: "📊",
                    text: "Review your visit history, statistics, and personal growth trends over time.",
                    target: "button[data-view='my-activity']",
                    position: "right",
                    action: () => document.querySelector("button[data-view='my-activity']").click()
                }
            ];
        }
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

        // Reset display properties that might have been hidden by showFinish
        this.bubble.querySelector('.onboarding-arrow').style.display = 'block';
        this.bubble.querySelector('.onboarding-progress-container').style.display = 'block';

        // Update content
        document.getElementById('ob-title').innerText = step.title;
        document.getElementById('ob-icon').innerText = step.icon || "✨";
        document.getElementById('ob-text').innerText = step.text;

        // Progress bar
        const progress = ((this.currentStepIndex + 1) / this.steps.length) * 100;
        document.getElementById('ob-bar').style.width = `${progress}%`;

        // Navigation visibility
        document.getElementById('ob-back').style.visibility = this.currentStepIndex > 0 ? 'visible' : 'hidden';
        document.getElementById('ob-next').innerText = this.currentStepIndex === this.steps.length - 1 ? "Finish" : "Next";

        // Execute action
        if (step.action) step.action();

        // Position
        setTimeout(() => this.updateStepPosition(), 150);
    }

    updateStepPosition() {
        if (this.currentStepIndex === -1) return;
        const step = this.steps[this.currentStepIndex];
        if (!step) return;

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

        const arrow = this.bubble.querySelector('.onboarding-arrow');
        arrow.className = `onboarding-arrow arrow-${step.position}`;
    }

    showFinish() {
        this.bubble.innerHTML = `
            <div class="onboarding-celebrate">
                <i class="fas fa-check-circle"></i>
                <h3>You're all set!</h3>
                <p>You've successfully mastered the basics of SafiTrack. Ready to transform your field sales productivity?</p>
                <div class="onboarding-bubble-footer" style="justify-content: center; border:0; padding:0; margin-top:2rem">
                    <button class="ob-btn ob-btn-next" style="width:100%" id="ob-finish">Start Using SafiTrack</button>
                </div>
            </div>
        `;
        document.getElementById('ob-finish').onclick = () => this.end();

        const hole = document.getElementById('onboarding-hole');
        hole.setAttribute('width', '0');
        hole.setAttribute('height', '0');

        // Force center positioning
        setTimeout(() => {
            const bRect = this.bubble.getBoundingClientRect();
            this.bubble.style.top = `${(window.innerHeight / 2) - (bRect.height / 2)}px`;
            this.bubble.style.left = `${(window.innerWidth / 2) - (bRect.width / 2)}px`;
            const arrow = this.bubble.querySelector('.onboarding-arrow');
            if (arrow) arrow.style.display = 'none';
        }, 100);
    }

    end() {
        this.overlay.classList.remove('active');
        this.bubble.classList.remove('active');
        setTimeout(() => location.reload(), 500);
    }
}

const onboarding = new OnboardingManager();
window.onboarding = onboarding;
