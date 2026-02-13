// ===================================
// SAFITRACK LANDING PAGE - PRODUCTION
// ===================================

document.addEventListener('DOMContentLoaded', function () {
    initNavbar();
    initSmoothScroll();
    initScrollAnimations();
    initInteractiveScreenshots();
    initCounterAnimations();
    initRoleTabs();
    initContactModal();
    initIntelligenceHub();
    initProductExperience();
    enhanceAccessibility();
    initMobileMenu();
    initTestimonialCarousel();
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
    const buttons = document.querySelectorAll('.dock-btn');
    const views = document.querySelectorAll('.role-view');
    const contexts = document.querySelectorAll('.role-context');

    // Default init
    if (document.querySelector('.role-view.active#view-manager')) {
        initManagerAnimations();
    }

    buttons.forEach(btn => {
        btn.addEventListener('click', function () {
            const role = this.getAttribute('data-role');

            // 1. Update Buttons
            buttons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // 2. Update Context Text
            contexts.forEach(ctx => {
                if (ctx.getAttribute('data-role') === role) {
                    ctx.classList.add('active');
                } else {
                    ctx.classList.remove('active');
                }
            });

            // 3. Update Visual View
            views.forEach(view => {
                view.classList.remove('active');
                if (view.id === `view-${role}`) {
                    view.classList.add('active');

                    // Trigger animations
                    if (role === 'manager') initManagerAnimations();
                    if (role === 'technician') initTechAnimations();
                }
            });
        });
    });
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

    // Initialize EmailJS with Public Key
    emailjs.init({
        publicKey: "gBlS97W9mCMXx6qRf",
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

            // Send via EmailJS
            // USER: Replace Service ID and Template ID
            emailjs.sendForm('service_5hj9xoc', 'template_suu7kp6', this)
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
