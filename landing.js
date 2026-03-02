// ===================================
// SAFITRACK LANDING PAGE - PRODUCTION
// ===================================

document.addEventListener('DOMContentLoaded', function () {
    initNavbar();
    initSmoothScroll();
    initScrollAnimations();
    initScrollManifesto();
    initInteractiveScreenshots();
    initCounterAnimations();
    initRoleTabs();
    initContactModal();
    initCustomSelects();
    initIntelligenceHub();
    initProductExperience();
    enhanceAccessibility();
    initMobileMenu();
    initTestimonialCarousel();
    initDynamicTitle();
    initShowcase();
    initScalePerformance();
});

function initMobileMenu() {
    const btn = document.querySelector('.mobile-menu-btn');
    const closeBtn = document.querySelector('.mobile-close-btn');
    const overlay = document.querySelector('.mobile-nav-overlay');
    const links = document.querySelectorAll('.mobile-link');

    if (btn && overlay) {
        // Toggle Open
        btn.addEventListener('click', () => {
            overlay.classList.toggle('active');
            btn.classList.toggle('open');
            document.body.style.overflow = overlay.classList.contains('active') ? 'hidden' : '';
        });

        // Close Button
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                overlay.classList.remove('active');
                btn.classList.remove('open');
                document.body.style.overflow = '';
            });
        }

        // Close on link click
        links.forEach(link => {
            link.addEventListener('click', () => {
                overlay.classList.remove('active');
                btn.classList.remove('open');
                document.body.style.overflow = '';
            });
        });
    }
}

// ===================================
// CUSTOM SELECTS - SITE-RENDERED DROPDOWNS
// ===================================
function initCustomSelects() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    const selects = form.querySelectorAll('select');

    selects.forEach(select => {
        if (select.dataset.custom) return;
        select.dataset.custom = '1';

        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select';

        // Selected button
        const selectedBtn = document.createElement('button');
        selectedBtn.type = 'button';
        selectedBtn.className = 'custom-select__selected';
        selectedBtn.setAttribute('aria-haspopup', 'listbox');
        selectedBtn.setAttribute('aria-expanded', 'false');

        // Options list
        const optionsList = document.createElement('ul');
        optionsList.className = 'custom-select__options';
        optionsList.setAttribute('role', 'listbox');

        // Build options from original select
        Array.from(select.options).forEach(opt => {
            const li = document.createElement('li');
            li.className = 'custom-select__option';
            li.textContent = opt.textContent;
            li.dataset.value = opt.value;
            if (opt.disabled) li.classList.add('disabled');
            if (opt.selected) li.classList.add('selected');
            li.addEventListener('click', (e) => {
                if (li.classList.contains('disabled')) return;
                // mark
                optionsList.querySelectorAll('.custom-select__option').forEach(o => o.classList.remove('selected'));
                li.classList.add('selected');
                selectedBtn.textContent = li.textContent;
                select.value = li.dataset.value;
                // update aria
                selectedBtn.setAttribute('aria-expanded', 'false');
                wrapper.classList.remove('open');
                // trigger change event for any listeners
                select.dispatchEvent(new Event('change', { bubbles: true }));
            });
            optionsList.appendChild(li);
        });

        // Default selected label
        const initial = select.options[select.selectedIndex]?.textContent || select.querySelector('option[disabled]')?.textContent || '';
        selectedBtn.textContent = initial;

        // Hide native select visually but keep it in DOM for form submission/validation
        select.style.position = 'absolute';
        select.style.left = '-9999px';

        // Insert into DOM
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(selectedBtn);
        wrapper.appendChild(optionsList);
        wrapper.appendChild(select);

        // Toggle
        selectedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = wrapper.classList.toggle('open');
            selectedBtn.setAttribute('aria-expanded', String(isOpen));
            // close other selects
            document.querySelectorAll('.custom-select.open').forEach(cs => { if (cs !== wrapper) { cs.classList.remove('open'); cs.querySelector('.custom-select__selected')?.setAttribute('aria-expanded','false'); } });
        });

        // keyboard accessibility
        selectedBtn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                wrapper.classList.add('open');
                selectedBtn.setAttribute('aria-expanded','true');
                const first = optionsList.querySelector('.custom-select__option:not(.disabled)');
                first?.focus();
            }
        });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.custom-select.open').forEach(cs => cs.classList.remove('open'));
    });

    // Ensure custom UI reflects form reset
    form.addEventListener('reset', () => {
        setTimeout(() => {
            form.querySelectorAll('.custom-select').forEach(wrapper => {
                const sel = wrapper.querySelector('select');
                const btn = wrapper.querySelector('.custom-select__selected');
                const options = wrapper.querySelectorAll('.custom-select__option');
                options.forEach(o => o.classList.remove('selected'));
                const current = sel.options[sel.selectedIndex];
                if (current) {
                    btn.textContent = current.textContent;
                    const match = Array.from(options).find(o => o.dataset.value === current.value);
                    if (match) match.classList.add('selected');
                }
            });
        }, 10);
    });
}

// ===================================
// NAVBAR - PROFESSIONAL
// ===================================

function initNavbar() {
    const navbar = document.getElementById('navbar');
    let lastScroll = 0;

    window.addEventListener('scroll', function () {
        const currentScroll = window.pageYOffset;

        if (currentScroll > 50) {
            navbar.style.borderBottomColor = 'rgba(48, 54, 61, 0.8)';
            navbar.style.backdropFilter = 'blur(12px)';
        } else {
            navbar.style.borderBottomColor = 'var(--border-color)';
            navbar.style.backdropFilter = 'blur(8px)';
        }

        lastScroll = currentScroll;
    }, { passive: true });
}

// ===================================
// SMOOTH SCROLL
// ===================================

function initSmoothScroll() {
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach(link => {
        link.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (href === '#') {
                e.preventDefault();
                return;
            }

            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                const navbarHeight = 72;
                const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navbarHeight;

                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

// ===================================
// SCROLL ANIMATIONS - SUBTLE & PROFESSIONAL
// ===================================

function initScrollAnimations() {
    const scrollElements = document.querySelectorAll('[data-scroll]');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '-50px'
    });

    scrollElements.forEach(el => observer.observe(el));
}

function initScrollManifesto() {
    const section = document.querySelector('[data-scroll-manifesto-section]');
    const stage = section?.querySelector('[data-scroll-manifesto]');
    const quote = section?.querySelector('[data-manifesto-quote]');

    if (!section || !stage || !quote) return;

    const sourceText = quote.textContent.trim();
    const words = sourceText.split(/\s+/).filter(Boolean);
    const wordNodes = [];

    quote.textContent = '';
    words.forEach((word, index) => {
        const span = document.createElement('span');
        span.className = 'sm-word';
        span.textContent = word;
        quote.appendChild(span);
        wordNodes.push(span);

        if (index < words.length - 1) {
            quote.appendChild(document.createTextNode(' '));
        }
    });

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        wordNodes.forEach(wordNode => {
            wordNode.classList.add('active');
            wordNode.style.opacity = '1';
        });
        return;
    }

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    let ticking = false;

    const updateProgress = () => {
        const rect = section.getBoundingClientRect();
        const scrollable = Math.max(rect.height - window.innerHeight, 1);
        const passed = clamp(-rect.top, 0, scrollable);
        const progress = passed / scrollable;

        if (wordNodes.length) {
            const reveal = progress * wordNodes.length;
            const revealFloor = Math.floor(reveal);
            const revealFraction = reveal - revealFloor;

            wordNodes.forEach((wordNode, index) => {
                if (index < revealFloor) {
                    wordNode.classList.add('active');
                    wordNode.style.opacity = '1';
                } else if (index === revealFloor) {
                    wordNode.classList.add('active');
                    wordNode.style.opacity = (0.2 + revealFraction * 0.8).toFixed(3);
                } else {
                    wordNode.classList.remove('active');
                    wordNode.style.opacity = '0.16';
                }
            });
        }

        ticking = false;
    };

    const requestUpdate = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateProgress);
    };

    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    requestUpdate();
}

// ===================================
// INTERACTIVE SCREENSHOTS - PROFESSIONAL
// ===================================

function initInteractiveScreenshots() {
    const productImages = document.querySelectorAll('.product-img, .hero-screenshot');

    productImages.forEach(img => {
        img.style.cursor = 'pointer';
        img.title = 'Click to view full size';

        img.addEventListener('click', function () {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(15, 17, 23, 0.95);
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(8px);
                opacity: 0;
                transition: opacity 0.25s ease;
                cursor: zoom-out;
            `;

            const modalImg = document.createElement('img');
            modalImg.src = this.src;
            modalImg.alt = this.alt;
            modalImg.style.cssText = `
                max-width: 90%;
                max-height: 90%;
                border-radius: 12px;
                box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
                transform: scale(0.95);
                transition: transform 0.25s ease;
            `;

            modal.appendChild(modalImg);
            document.body.appendChild(modal);
            document.body.style.overflow = 'hidden';

            requestAnimationFrame(() => {
                modal.style.opacity = '1';
                modalImg.style.transform = 'scale(1)';
            });

            const closeModal = () => {
                modal.style.opacity = '0';
                modalImg.style.transform = 'scale(0.95)';
                document.body.style.overflow = '';
                setTimeout(() => document.body.removeChild(modal), 250);
            };

            modal.addEventListener('click', closeModal);

            const closeOnEscape = (e) => {
                if (e.key === 'Escape') {
                    closeModal();
                    document.removeEventListener('keydown', closeOnEscape);
                }
            };
            document.addEventListener('keydown', closeOnEscape);
        });
    });
}

// ===================================
// ANIMATED COUNTERS - SMOOTH & PROFESSIONAL
// ===================================

function initCounterAnimations() {
    const counters = document.querySelectorAll('[data-counter]');
    const duration = 1500;

    const animateCounter = (element) => {
        const target = parseInt(element.getAttribute('data-counter'));
        const startTime = performance.now();

        const updateCounter = (currentTime) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            const easeOutQuart = 1 - Math.pow(1 - progress, 4);
            const current = Math.floor(easeOutQuart * target);

            if (target >= 1000) {
                element.textContent = (current / 1000).toFixed(0) + 'K+';
            } else if (element.closest('.stat-item').querySelector('.stat-label').textContent.includes('Satisfaction')) {
                element.textContent = current + '%';
            } else {
                element.textContent = current + '+';
            }

            if (progress < 1) {
                requestAnimationFrame(updateCounter);
            } else {
                if (target >= 1000) {
                    element.textContent = (target / 1000) + 'K+';
                } else if (element.closest('.stat-item').querySelector('.stat-label').textContent.includes('Satisfaction')) {
                    element.textContent = target + '%';
                } else {
                    element.textContent = target + '+';
                }
            }
        };

        requestAnimationFrame(updateCounter);
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                entry.target.classList.add('counted');
                animateCounter(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}

// ===================================
// ROLE TABS - INTERACTIVE SHOWCASE
// ===================================

function initRoleTabs() {
    const buttons = document.querySelectorAll('.rs-tab-row .dock-btn');
    const views = document.querySelectorAll('.role-view');
    const contexts = document.querySelectorAll('.role-context');

    if (!buttons.length) return;

    const roles = ['manager', 'salesrep', 'technician'];
    const CYCLE_MS = 4500; // time per tab
    let currentIndex = 0;
    let cycleTimer = null;
    let paused = false;

    // Default init
    if (document.querySelector('.role-view.active#view-manager')) {
        initManagerAnimations();
    }

    function switchTo(role) {
        currentIndex = roles.indexOf(role);

        // Buttons
        buttons.forEach(b => {
            b.classList.remove('active');
            const prog = b.querySelector('.rs-tab-progress');
            if (prog) { prog.style.transition = 'none'; prog.style.width = '0%'; }
        });
        const activeBtn = [...buttons].find(b => b.getAttribute('data-role') === role);
        if (activeBtn) activeBtn.classList.add('active');

        // Context panels
        contexts.forEach(ctx => ctx.classList.toggle('active', ctx.getAttribute('data-role') === role));

        // Views
        views.forEach(view => {
            view.classList.remove('active');
            if (view.id === `view-${role}`) view.classList.add('active');
        });

        // Animations
        if (role === 'manager') initManagerAnimations();
        if (role === 'technician') initTechAnimations();
    }

    function startProgress(btn) {
        const prog = btn.querySelector('.rs-tab-progress');
        if (!prog) return;
        prog.style.transition = 'none';
        prog.style.width = '0%';
        // Force reflow
        prog.getBoundingClientRect();
        prog.style.transition = `width ${CYCLE_MS}ms linear`;
        prog.style.width = '100%';
    }

    function tick() {
        if (paused) return;
        currentIndex = (currentIndex + 1) % roles.length;
        switchTo(roles[currentIndex]);
        const activeBtn = [...buttons].find(b => b.getAttribute('data-role') === roles[currentIndex]);
        if (activeBtn) startProgress(activeBtn);
    }

    function resetCycle() {
        clearInterval(cycleTimer);
        cycleTimer = setInterval(tick, CYCLE_MS);
    }

    // Manual click — pause cycling for 12s then resume
    buttons.forEach(btn => {
        btn.addEventListener('click', function () {
            const role = this.getAttribute('data-role');
            switchTo(role);

            // Reset & pause
            paused = true;
            clearInterval(cycleTimer);
            startProgress(this);

            setTimeout(() => {
                paused = false;
                resetCycle();
            }, 12000);
        });
    });

    // Pause on hover over the whole card
    const card = document.querySelector('.rs-card');
    if (card) {
        card.addEventListener('mouseenter', () => { paused = true; });
        card.addEventListener('mouseleave', () => {
            paused = false;
            resetCycle();
        });
    }

    // Wire up interactive buttons
    function wireBtn(id, labels) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('click', () => {
            el.disabled = true;
            el.textContent = labels[1];
            setTimeout(() => { el.textContent = labels[0]; el.disabled = false; }, 1400);
        });
    }
    wireBtn('rs-mgr-btn',    ['Open Dashboard →', 'Opening…']);
    wireBtn('rs-mgr-export', ['Export Report',     'Exporting…']);
    wireBtn('rs-sales-btn',  ['+ Add Deal',        'Adding…']);
    wireBtn('rs-sales-ai',   ['✨ AI Score All',   'Scoring…']);
    wireBtn('rs-tech-route', ['📍 Plan My Route',  'Planning…']);
    wireBtn('rs-tech-log',   ['Log a Visit',        'Logging…']);

    // Kick off auto-cycle
    const firstBtn = [...buttons].find(b => b.classList.contains('active'));
    if (firstBtn) startProgress(firstBtn);
    resetCycle();
}

// Manager Role Animations
function initManagerAnimations() {
    // Animate Revenue Number
    const revDisplay = document.querySelector('.rev-big-price');
    // Simple text scramble/count affect
    if (revDisplay && !revDisplay.classList.contains('animated')) {
        revDisplay.classList.add('animated');
        // (Optional complex animation here, or just let CSS fade in)
    }

    // Animate Chart Line
    const chartPath = document.querySelector('.chart-svg path:nth-child(2)');
    if (chartPath) {
        chartPath.style.strokeDasharray = '1000';
        chartPath.style.strokeDashoffset = '1000';
        chartPath.getBoundingClientRect(); // trigger reflow
        chartPath.style.transition = 'stroke-dashoffset 2s ease';
        chartPath.style.strokeDashoffset = '0';
    }

    // Scroll Feed
    const feed = document.getElementById('manager-feed-list');
    if (feed) {
        feed.scrollTop = 0;
        // Simulate an item add
        setTimeout(() => {
            const el = document.createElement('div');
            el.className = 'act-item';
            el.innerHTML = `<span class="act-icon">🔔</span><div class="act-text"><strong>System</strong> alert: New quota reached</div><span class="act-time">Now</span>`;
            el.style.animation = 'slideInLeft 0.5s ease';
            feed.insertBefore(el, feed.firstChild);
        }, 2000);
    }
}

// Tech Animations
function initTechAnimations() {
    const route = document.querySelector('.route-overlay path');
    if (route) {
        route.style.strokeDasharray = '50';
        route.style.animation = 'dashFlow 1s linear infinite';
    }
}

// ===================================
// ACCESSIBILITY ENHANCEMENTS
// ===================================

function enhanceAccessibility() {
    document.body.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
            document.body.classList.add('keyboard-nav');
        }
    });

    document.body.addEventListener('mousedown', () => {
        document.body.classList.remove('keyboard-nav');
    });

    const links = document.querySelectorAll('a[href="#"]');
    links.forEach(link => {
        if (!link.getAttribute('aria-label')) {
            link.setAttribute('role', 'button');
        }
    });
}

// ===================================
// PERFORMANCE MONITORING (OPTIONAL)
// ===================================

// ===================================
// CONTACT MODAL & EMAILJS
// ===================================

function initContactModal() {
    const modal = document.getElementById('contact-modal');
    const form = document.getElementById('contact-form');
    const btns = document.querySelectorAll('.get-started-btn');
    const closeBtn = document.querySelector('.close-modal');
    const feedbackBtns = document.querySelectorAll('.close-feedback');
    const planInput = document.getElementById('selected-plan');

    // Keys are loaded from config.js (gitignored).
    // Copy config.example.js → config.js and fill in your values.
    const _cfg = window.APP_CONFIG || {};
    emailjs.init({
        publicKey: _cfg.EMAILJS_PUBLIC_KEY || '',
    });

    let currentStep = 1;
    const steps = document.querySelectorAll('.form-step');
    const dots = document.querySelectorAll('.step-dot');
    const nextBtns = document.querySelectorAll('.next-step');
    const prevBtns = document.querySelectorAll('.prev-step');

    const updateStepUI = () => {
        steps.forEach((step, idx) => {
            step.classList.toggle('active', idx + 1 === currentStep);
        });
        dots.forEach((dot, idx) => {
            dot.classList.toggle('active', idx + 1 === currentStep);
            dot.classList.toggle('completed', idx + 1 < currentStep);
        });
    };

    const validateStep = (stepNum) => {
        const currentStepEl = document.querySelector(`.form-step[data-step="${stepNum}"]`);
        const inputs = currentStepEl.querySelectorAll('input[required], select[required]');
        let isValid = true;

        inputs.forEach(input => {
            if (!input.checkValidity()) {
                input.reportValidity();
                isValid = false;
            }
        });

        return isValid;
    };

    const openModal = (plan = 'General') => {
        if (!modal) return;
        planInput.value = plan;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Reset to first step
        currentStep = 1;
        updateStepUI();

        // Reset form and feedback
        form.style.display = 'block';
        document.getElementById('form-success').style.display = 'none';
        document.getElementById('form-error').style.display = 'none';
        form.reset();
    };

    const closeModal = () => {
        if (!modal) return;
        modal.classList.remove('active');
        document.body.style.overflow = '';
    };

    // Navigation Buttons
    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (validateStep(currentStep)) {
                currentStep++;
                updateStepUI();
            }
        });
    });

    prevBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentStep--;
            updateStepUI();
        });
    });

    btns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const plan = btn.getAttribute('data-plan') || 'General';
            openModal(plan);
        });
    });

    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    feedbackBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            if (btn.closest('.error')) {
                form.style.display = 'block';
                document.getElementById('form-error').style.display = 'none';
            } else {
                closeModal();
            }
        });
    });

    // Close on outside click
    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Form Submission
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();

            const submitBtn = document.getElementById('submit-btn');
            const submitText = submitBtn.querySelector('span');
            const loader = submitBtn.querySelector('.btn-loader');

            // Loading state
            submitBtn.disabled = true;
            submitText.style.display = 'none';
            loader.style.display = 'block';

            // Send via EmailJS — IDs come from window.APP_CONFIG (config.js)
            const _eCfg = window.APP_CONFIG || {};
            emailjs.sendForm(_eCfg.EMAILJS_SERVICE_ID || '', _eCfg.EMAILJS_TEMPLATE_ID || '', this)
                .then(() => {
                    form.style.display = 'none';
                    document.getElementById('form-success').style.display = 'block';
                })
                .catch((error) => {
                    console.error('EmailJS Error:', error);
                    form.style.display = 'none';
                    document.getElementById('form-error').style.display = 'block';
                })
                .finally(() => {
                    submitBtn.disabled = false;
                    submitText.style.display = 'block';
                    loader.style.display = 'none';
                });
        });
    }
}

// ===================================
// CONNECTIVITY MESH - MINIMALIST
// ===================================

function initIntelligenceHub() {
    const tabs = document.querySelectorAll('.rc-tab');
    const panes = document.querySelectorAll('.rc-pane');
    const feedValues = document.querySelectorAll('.rc-feed-value');

    if (tabs.length && panes.length) {
        let activePane = tabs[0]?.dataset.pane;
        let autoRotate;

        const setActivePane = (pane) => {
            activePane = pane;
            tabs.forEach(tab => {
                const isActive = tab.dataset.pane === pane;
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });

            panes.forEach(panel => {
                panel.classList.toggle('active', panel.dataset.pane === pane);
            });
        };

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                setActivePane(tab.dataset.pane);
            });
        });

        const paneOrder = Array.from(tabs).map(tab => tab.dataset.pane);
        const startAutoRotate = () => {
            clearInterval(autoRotate);
            autoRotate = setInterval(() => {
                const idx = paneOrder.indexOf(activePane);
                const nextPane = paneOrder[(idx + 1) % paneOrder.length];
                setActivePane(nextPane);
            }, 4500);
        };

        const panelRoot = document.querySelector('.revenue-control');
        panelRoot?.addEventListener('mouseenter', () => clearInterval(autoRotate));
        panelRoot?.addEventListener('mouseleave', startAutoRotate);

        setActivePane(activePane);
        startAutoRotate();
    }

    if (feedValues.length) {
        const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

        setInterval(() => {
            feedValues.forEach(el => {
                const key = el.dataset.feed;
                if (key === 'risk') {
                    const value = randomInt(120, 175);
                    el.textContent = `$${value}K`;
                } else if (key === 'actions') {
                    el.textContent = String(randomInt(18, 36));
                } else if (key === 'moved') {
                    el.textContent = String(randomInt(7, 15));
                }
            });
        }, 3200);
    }
}

// ===================================
// DYNAMIC HERO TITLE
// ===================================

function initDynamicTitle() {
    const dynamicContainer = document.getElementById('dynamic-text-header');
    if (!dynamicContainer) return;

    const dynamicText = dynamicContainer.querySelector('span');
    if (!dynamicText) return;

    const words = ["track", "customers", "deals", "team", "leads", "revenue"];
    let currentIndex = 0;

    // Helper to calculate widths
    const calculateWidths = () => {
        return words.map(word => {
            const temp = document.createElement('span');
            temp.style.visibility = 'hidden';
            temp.style.position = 'absolute';
            temp.style.whiteSpace = 'nowrap';
            temp.style.font = window.getComputedStyle(dynamicContainer).font;
            temp.style.fontWeight = '900';
            temp.style.textTransform = 'lowercase';
            temp.textContent = word;
            document.body.appendChild(temp);
            const width = temp.getBoundingClientRect().width;
            document.body.removeChild(temp);
            return width + 20; // Updated padding (10px each side)
        });
    };

    let widths = calculateWidths();

    // Re-calculate on resize for responsive safety
    window.addEventListener('resize', () => {
        widths = calculateWidths();
        dynamicContainer.style.width = `${widths[currentIndex]}px`;
    });

    // Set initial state
    if (dynamicText) {
        dynamicText.textContent = words[0];
        dynamicContainer.style.width = `${widths[0]}px`;
    }

    setInterval(() => {
        // Step 1: Snap OUT (Up + Shrink + Blur)
        dynamicContainer.classList.add('exit');

        setTimeout(() => {
            // Step 2: Swap Content & Reset Position
            currentIndex = (currentIndex + 1) % words.length;
            if (dynamicText) {
                dynamicText.textContent = words[currentIndex];
            }
            dynamicContainer.style.width = `${widths[currentIndex]}px`;

            dynamicContainer.classList.remove('exit');
            dynamicContainer.classList.add('enter');

            // Force reflow
            void dynamicContainer.offsetWidth;

            // Step 3: Spring IN (into view with overshoot)
            dynamicContainer.classList.remove('enter');
        }, 450); // Slightly more time for the kinetic exit
    }, 1500); // 1.5s interval as requested
}

function initProductExperience() {
    const tabs = document.querySelectorAll('.px-tab');
    const views = document.querySelectorAll('.px-view');
    const counters = document.querySelectorAll('.px-count');
    const dynamicChips = document.querySelectorAll('.px-dynamic-chip');

    if (!tabs.length || !views.length) return;

    let activeView = tabs[0].dataset.view;
    let autoTimer;
    let typewriterTimer;
    let userSelectedView = false;

    const aiTypeBox = document.getElementById('px-ai-typebox');
    const aiSummaryEl = aiTypeBox?.querySelector('.px-type-summary');
    const aiNextEl = aiTypeBox?.querySelector('.px-type-next');

    const aiScriptVariants = [
        {
            summary: 'Stakeholders agreed on rollout scope for 2 regions.',
            next: 'Send revised commercial terms and schedule security review.'
        },
        {
            summary: 'Client confirmed budget and requested implementation timeline details.',
            next: 'Share timeline draft and book a technical validation call tomorrow.'
        },
        {
            summary: 'Buying committee aligned on priorities and success criteria.',
            next: 'Prepare final proposal package and assign owner for procurement follow-up.'
        }
    ];

    const typeText = (el, text, delay = 18) => {
        if (!el) return Promise.resolve();
        el.textContent = '';
        el.classList.add('typing');

        return new Promise(resolve => {
            let index = 0;
            const tick = () => {
                if (index < text.length) {
                    el.textContent += text.charAt(index);
                    index += 1;
                    typewriterTimer = window.setTimeout(tick, delay);
                } else {
                    el.classList.remove('typing');
                    resolve();
                }
            };
            tick();
        });
    };

    const runAiTyping = async () => {
        if (!aiTypeBox || !aiSummaryEl || !aiNextEl) return;

        if (typewriterTimer) {
            clearTimeout(typewriterTimer);
        }

        aiSummaryEl.classList.remove('typing');
        aiNextEl.classList.remove('typing');

        const variant = aiScriptVariants[Math.floor(Math.random() * aiScriptVariants.length)];
        aiTypeBox.dataset.summary = variant.summary;
        aiTypeBox.dataset.next = variant.next;

        await typeText(aiSummaryEl, variant.summary, 15);
        await typeText(aiNextEl, variant.next, 13);
    };

    const setView = (viewName) => {
        activeView = viewName;

        tabs.forEach(tab => {
            const isActive = tab.dataset.view === viewName;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });

        views.forEach(view => {
            view.classList.toggle('active', view.dataset.view === viewName);
        });

        if (viewName === 'ai') {
            runAiTyping();
        }
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            userSelectedView = true;
            clearInterval(autoTimer);
            setView(tab.dataset.view);
        });
    });

    const order = Array.from(tabs).map(tab => tab.dataset.view);
    const root = document.querySelector('.px-shell');

    const startAutoRotate = () => {
        clearInterval(autoTimer);
        if (userSelectedView) return;
        autoTimer = setInterval(() => {
            const currentIndex = order.indexOf(activeView);
            const next = order[(currentIndex + 1) % order.length];
            setView(next);
        }, 4200);
    };

    root?.addEventListener('mouseenter', () => clearInterval(autoTimer));
    root?.addEventListener('mouseleave', startAutoRotate);

    setView(activeView);
    startAutoRotate();

    if (activeView === 'ai') {
        runAiTyping();
    }

    if (counters.length) {
        const animateCount = (el, target) => {
            const start = Number.parseInt(el.textContent, 10) || 0;
            const duration = 450;
            const startTime = performance.now();

            el.classList.add('is-updating');

            const tick = (time) => {
                const progress = Math.min((time - startTime) / duration, 1);
                const nextValue = Math.round(start + (target - start) * progress);
                el.textContent = String(nextValue);

                if (progress < 1) {
                    requestAnimationFrame(tick);
                } else {
                    setTimeout(() => el.classList.remove('is-updating'), 180);
                }
            };

            requestAnimationFrame(tick);
        };

        setInterval(() => {
            counters.forEach(counter => {
                const min = Number.parseInt(counter.dataset.min || '0', 10);
                const max = Number.parseInt(counter.dataset.max || '10', 10);
                const target = Math.floor(Math.random() * (max - min + 1)) + min;
                animateCount(counter, target);
            });
        }, 2600);
    }

    if (dynamicChips.length) {
        const chipVariants = {
            pipeline: ['2 deals moved', '1 deal won', '3 follow-ups due', 'Forecast updated'],
            contacts: ['Updated now', '2 notes added', 'New contact synced', 'Timeline refreshed'],
            ai: ['3 insights generated', 'Next action suggested', 'Summary ready', '2 tasks created']
        };

        setInterval(() => {
            dynamicChips.forEach(chip => {
                const key = chip.dataset.chip;
                const variants = chipVariants[key] || [];
                if (!variants.length) return;

                const next = variants[Math.floor(Math.random() * variants.length)];
                chip.textContent = next;
                chip.classList.remove('flash');
                void chip.offsetWidth;
                chip.classList.add('flash');
            });
        }, 3000);
    }
}

if (window.location.hostname === 'localhost') {
    window.addEventListener('load', () => {
        setTimeout(() => {
            const perfData = window.performance.timing;
            const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
            console.log(`Page load time: ${pageLoadTime}ms`);
        }, 0);
    });
}

// ===================================
// PREMIUM TESTIMONIAL CAROUSEL
// ===================================

function initTestimonialCarousel() {
    const slides = document.querySelectorAll('.t-slide');
    const progressFill = document.querySelector('.t-progress-fill');

    if (slides.length === 0) return;

    let currentIndex = 0;
    const duration = 5000; // 5 seconds per slide
    const intervalTime = 50; // Update progress every 50ms
    let progress = 0;
    let timer;
    let progressTimer;

    const showSlide = (index) => {
        slides.forEach(slide => slide.classList.remove('active'));
        slides[index].classList.add('active');

        // Reset progress
        progress = 0;
        if (progressFill) progressFill.style.width = '0%';
    };

    const nextSlide = () => {
        currentIndex = (currentIndex + 1) % slides.length;
        showSlide(currentIndex);
    };

    const startCarousel = () => {
        // Main slide switch timer
        timer = setInterval(nextSlide, duration);

        // Progress animation for current segment
        const segments = document.querySelectorAll('.t-seg-fill');
        const currentDisplay = document.querySelector('.t-current');

        if (segments.length > 0) {
            // Reset logic periodically
            progressTimer = setInterval(() => {
                progress += (intervalTime / duration) * 100;

                // Update segments visually
                segments.forEach((seg, idx) => {
                    if (idx < currentIndex) {
                        seg.style.width = '100%';
                    } else if (idx === currentIndex) {
                        seg.style.width = `${Math.min(progress, 100)}%`;
                    } else {
                        seg.style.width = '0%';
                    }
                });

                // Update number
                if (currentDisplay) {
                    currentDisplay.textContent = `0${currentIndex + 1}`;
                }

            }, intervalTime);
        }
    };

    // Initial start
    startCarousel();

    // No pause on hover (cinematic feel)
}

// ===================================
// SHOWCASE - ATTIO STYLE
// ===================================

function initShowcase() {
    const tabs = document.querySelectorAll('.showcase-tab');
    const video = document.getElementById('showcase-video');
    if (!tabs.length || !video) return;

    const intervalTime = 8000; // 8 seconds
    let currentIndex = 0;
    let timer = null;
    let startTime = null;

    const screenshots = {
        ai:            'assets/safitrackscreenshots/ai.webm',
        opportunities: 'assets/safitrackscreenshots/op.webm',
        visits:        'assets/safitrackscreenshots/visits.webm',
        routes:        'assets/safitrackscreenshots/routeplan.webm',
        companies:     'assets/safitrackscreenshots/companies.webm',
        people:        'assets/safitrackscreenshots/people.webm'
    };

    function switchTab(index) {
        // Remove active class from all
        tabs.forEach(tab => {
            tab.classList.remove('active');
            const bar = tab.querySelector('.tab-progress');
            if (bar) bar.style.width = '0%';
        });

        // Set active
        const nextTab = tabs[index];
        nextTab.classList.add('active');

        // Fade video
        video.classList.add('fade-out');

        setTimeout(() => {
            const tabKey = nextTab.getAttribute('data-tab');
            if (screenshots[tabKey]) {
                video.querySelector('source').src = screenshots[tabKey];
                video.load();
                video.play();
            }
            video.classList.remove('fade-out');
        }, 400);

        currentIndex = index;
        startTime = Date.now();
    }

    function startTimer() {
        if (timer) clearInterval(timer);
        startTime = Date.now();

        timer = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const progress = (elapsed / intervalTime) * 100;

            const activeBar = document.querySelector('.showcase-tab.active .tab-progress');
            if (activeBar) {
                activeBar.style.width = Math.min(progress, 100) + '%';
            }

            if (elapsed >= intervalTime) {
                const nextIndex = (currentIndex + 1) % tabs.length;
                switchTab(nextIndex);
            }
        }, 30);
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => {
            switchTab(index);
        });
    });

    // Handle visibility change (pause timer when tab in background)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (timer) clearInterval(timer);
        } else {
            startTime = Date.now();
            startTimer();
        }
    });

    // Start
    switchTab(0);
    startTimer();
}

function initScalePerformance() {
    const section = document.querySelector('.scale-performance');
    const path = document.querySelector('.growth-curve-path');

    if (!section || !path) return;

    // Reset path state
    const length = path.getTotalLength();
    path.style.strokeDasharray = length + ' ' + length;
    path.style.strokeDashoffset = length;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Trigger animation
                path.style.strokeDashoffset = '0';

                // Optional: Animate numbers with their suffixes preserved
                const metrics = section.querySelectorAll('.metric-val');
                metrics.forEach(metric => {
                    const text = metric.innerText.trim();
                    // capture any trailing + or % signs
                    const suffixMatch = text.match(/[+%]+$/);
                    const suffix = suffixMatch ? suffixMatch[0] : '';
                    const numeric = parseFloat(text.replace(/,/g, '').replace(/[+%]/g, ''));
                    if (isNaN(numeric)) return;

                    animateValue(metric, 0, numeric, 2000, suffix);
                });

                observer.unobserve(section);
            }
        });
    }, { threshold: 0.3 });

    observer.observe(section);
}

function animateValue(obj, start, end, duration, suffix = '') {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);

        // for percentages we want a fractional animation
        let display;
        if (suffix === '%') {
            display = (progress * end).toFixed(1) + suffix;
        } else {
            const current = Math.floor(progress * (end - start) + start);
            display = current.toLocaleString() + suffix;
        }

        obj.innerHTML = display;

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            // ensure final value is exact (with suffix)
            if (suffix === '%') obj.innerHTML = end + suffix;
            else obj.innerHTML = end.toLocaleString() + suffix;
        }
    };
    window.requestAnimationFrame(step);
}
