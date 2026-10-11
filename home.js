// ==========================================================
// SafiTrack home page
// ==========================================================

(function () {
    'use strict';

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

    initNav();
    initRotator();
    initShowcase();
    initWindows();
    initStatement();
    initFlow();
    initIntel();
    initTestimonials();
    initContact();

    // ------------------------------------------------------
    // Navigation: sticky border, mega menus, mobile sheet
    // ------------------------------------------------------
    function initNav() {
        const nav = document.getElementById('nav');
        if (!nav) return;

        // Switch the nav to its dark style while a dark section sits under it.
        const darkSections = [...document.querySelectorAll('[data-theme="dark"]')];
        const onScroll = () => {
            nav.classList.toggle('is-scrolled', window.scrollY > 8);
            const line = nav.offsetHeight / 2;
            nav.classList.toggle('is-dark', darkSections.some(sec => {
                const r = sec.getBoundingClientRect();
                return r.top <= line && r.bottom > line;
            }));
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        // Mega menus: hover on pointer devices, click everywhere
        const items = [...nav.querySelectorAll('.nav-item.has-menu')];
        const canHover = window.matchMedia('(hover: hover)').matches;

        const setOpen = (item, open) => {
            item.classList.toggle('is-open', open);
            item.querySelector('.nav-trigger').setAttribute('aria-expanded', String(open));
        };
        const closeAll = (except) => items.forEach(i => i !== except && setOpen(i, false));

        items.forEach(item => {
            const trigger = item.querySelector('.nav-trigger');
            let closeTimer;

            trigger.addEventListener('click', () => {
                const open = !item.classList.contains('is-open');
                closeAll(item);
                setOpen(item, open);
            });

            if (canHover) {
                item.addEventListener('mouseenter', () => {
                    clearTimeout(closeTimer);
                    closeAll(item);
                    setOpen(item, true);
                });
                item.addEventListener('mouseleave', () => {
                    closeTimer = setTimeout(() => setOpen(item, false), 120);
                });
            }

            item.addEventListener('focusout', (e) => {
                if (!item.contains(e.relatedTarget)) setOpen(item, false);
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.nav-item.has-menu')) closeAll();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const open = items.find(i => i.classList.contains('is-open'));
            if (open) {
                setOpen(open, false);
                open.querySelector('.nav-trigger').focus();
            }
            if (nav.classList.contains('is-open')) setMobile(false);
        });

        // Mobile sheet
        const burger = nav.querySelector('.nav-burger');
        const sheet = document.getElementById('mobile-menu');

        function setMobile(open) {
            nav.classList.toggle('is-open', open);
            sheet.hidden = !open;
            burger.setAttribute('aria-expanded', String(open));
            burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
            document.body.style.overflow = open ? 'hidden' : '';
        }

        burger.addEventListener('click', () => setMobile(!nav.classList.contains('is-open')));
        sheet.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMobile(false)));
        window.matchMedia('(min-width: 961px)').addEventListener('change', (e) => {
            if (e.matches) setMobile(false);
        });
    }

    // ------------------------------------------------------
    // Hero: "Safi ____" word rotator
    // ------------------------------------------------------
    function initRotator() {
        const box = document.getElementById('rotator');
        if (!box) return;

        const words = ['track', 'customers', 'deals', 'visits', 'routes', 'leads', 'team', 'revenue'];
        const INTERVAL = 2200;

        box.textContent = '';
        const nodes = words.map((word, i) => {
            const span = document.createElement('span');
            span.className = 'rotator-word' + (i === 0 ? ' is-active' : '');
            span.textContent = word;
            box.appendChild(span);
            return span;
        });

        let index = 0;
        let widths = [];

        // Chip width = word width + horizontal padding, so it can animate between words.
        const measure = () => {
            const pad = parseFloat(getComputedStyle(box).paddingLeft) * 2;
            widths = nodes.map(n => n.getBoundingClientRect().width + pad);
            box.style.width = widths[index] + 'px';
        };

        measure();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
        window.addEventListener('resize', measure);

        const advance = () => {
            const prev = nodes[index];
            index = (index + 1) % nodes.length;
            const next = nodes[index];

            prev.classList.remove('is-active');
            prev.classList.add('is-leaving');
            next.classList.add('is-active');
            box.style.width = widths[index] + 'px';

            // Once it has slid out, park the old word below, ready for its next turn.
            setTimeout(() => {
                prev.style.transition = 'none';
                prev.classList.remove('is-leaving');
                void prev.offsetWidth;
                prev.style.transition = '';
            }, 600);
        };

        let timer = setInterval(advance, INTERVAL);

        // Don't burn cycles while the tab is hidden.
        document.addEventListener('visibilitychange', () => {
            clearInterval(timer);
            if (!document.hidden) timer = setInterval(advance, INTERVAL);
        });
    }

    // ------------------------------------------------------
    // Showcase: tabbed product videos, each tab plays its clip
    // through and then hands over to the next.
    // ------------------------------------------------------
    function initShowcase() {
        const tabs = [...document.querySelectorAll('.showcase-tab')];
        const video = document.getElementById('showcase-video');
        if (!tabs.length || !video) return;

        let current = 0;
        let inView = false;
        let raf = 0;

        const setProgress = (tab, value) => tab.style.setProperty('--progress', value);

        const tick = () => {
            if (video.duration) setProgress(tabs[current], video.currentTime / video.duration);
            raf = requestAnimationFrame(tick);
        };

        const play = () => {
            const p = video.play();
            if (p && p.catch) p.catch(() => { });
        };

        const select = (i) => {
            tabs.forEach((t, n) => {
                const active = n === i;
                t.classList.toggle('is-active', active);
                t.setAttribute('aria-selected', String(active));
                setProgress(t, 0);
            });
            current = i;

            video.classList.add('is-fading');
            setTimeout(() => {
                video.src = tabs[i].dataset.src;
                video.load();
                if (inView) play();
            }, 250);
        };

        video.addEventListener('loadeddata', () => video.classList.remove('is-fading'));
        video.addEventListener('ended', () => select((current + 1) % tabs.length));
        video.addEventListener('error', () => select((current + 1) % tabs.length));

        tabs.forEach((tab, i) => tab.addEventListener('click', () => {
            if (i !== current) select(i);
            else { video.currentTime = 0; play(); }
        }));

        // Arrow-key navigation within the tab list
        tabs.forEach((tab, i) => tab.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next].focus();
            select(next);
        }));

        // Only play while on screen.
        new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            if (inView) {
                play();
                cancelAnimationFrame(raf);
                raf = requestAnimationFrame(tick);
            } else {
                video.pause();
                cancelAnimationFrame(raf);
            }
        }, { threshold: 0.25 }).observe(video);
    }

    // ------------------------------------------------------
    // Showcase windows: drag them around; the activity feed ticks over
    // ------------------------------------------------------
    function initWindows() {
        const wins = [...document.querySelectorAll('[data-drag]')];
        const hero = document.querySelector('.hero');
        const showcase = document.querySelector('.showcase');
        if (!wins.length || !hero || !showcase) return;

        const EDGE = 8;
        let z = 10;

        wins.forEach(win => {
            let pointer = null;
            let start = null;
            let offset = { x: 0, y: 0 };
            let limits = null;

            win.addEventListener('pointerdown', (e) => {
                if (e.button !== 0) return;
                pointer = e.pointerId;
                win.setPointerCapture(pointer);
                win.classList.add('is-dragging');
                win.style.zIndex = ++z;
                start = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };

                // Keep the window on screen and within the hero + showcase area.
                const r = win.getBoundingClientRect();
                const top = hero.getBoundingClientRect().top;
                const bottom = showcase.getBoundingClientRect().bottom;
                limits = {
                    minX: EDGE - r.left, maxX: window.innerWidth - EDGE - r.right,
                    minY: top + EDGE - r.top, maxY: bottom - EDGE - r.bottom,
                };
            });

            win.addEventListener('pointermove', (e) => {
                if (e.pointerId !== pointer) return;
                const dx = clamp(e.clientX - start.x, limits.minX, limits.maxX);
                const dy = clamp(e.clientY - start.y, limits.minY, limits.maxY);
                offset = { x: start.ox + dx, y: start.oy + dy };
                win.style.setProperty('--dx', offset.x + 'px');
                win.style.setProperty('--dy', offset.y + 'px');
            });

            const end = (e) => {
                if (e.pointerId !== pointer) return;
                pointer = null;
                win.classList.remove('is-dragging');
            };
            win.addEventListener('pointerup', end);
            win.addEventListener('pointercancel', end);
        });

        // Team activity: a new entry arrives every few seconds.
        const feed = document.querySelector('.win-feed .win-body');
        if (!feed || reducedMotion) return;
        const times = [...feed.querySelectorAll('time')].map(t => t.textContent);

        setInterval(() => {
            if (document.hidden || getComputedStyle(feed.closest('.win')).display === 'none') return;
            const items = feed.querySelectorAll('.feed-item');
            const last = items[items.length - 1];
            last.classList.remove('is-new');
            feed.prepend(last);
            void last.offsetWidth;
            last.classList.add('is-new');
            feed.querySelectorAll('time').forEach((t, i) => (t.textContent = times[i]));
        }, 3600);
    }

    // ------------------------------------------------------
    // Features: highlight the panel in view; run the workflow demo
    // ------------------------------------------------------
    function initFlow() {
        const links = [...document.querySelectorAll('.flow-nav a')];
        const panels = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
        if (!panels.length) return;

        const setActive = (id) => links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + id));

        // A panel is "current" when it crosses the middle of the viewport.
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) setActive(entry.target.id);
            });
        }, { rootMargin: '-45% 0px -54% 0px' });
        panels.forEach(p => io.observe(p));

        // Draw the route in the connectivity section once it's on screen.
        const route = document.querySelector('.route-art');
        if (route) {
            new IntersectionObserver(([entry], obs) => {
                if (!entry.isIntersecting) return;
                route.classList.add('is-run');
                obs.disconnect();
            }, { threshold: 0.5 }).observe(route);
        }

        const wf = document.querySelector('.wf');
        if (wf) {
            new IntersectionObserver(([entry], obs) => {
                if (!entry.isIntersecting) return;
                wf.classList.add('is-run');
                obs.disconnect();
            }, { threshold: 0.6 }).observe(wf);
        }
    }

    // ------------------------------------------------------
    // Field Intelligence: the horizon rises as the section scrolls in
    // ------------------------------------------------------
    function initIntel() {
        const stage = document.querySelector('.intel-stage');
        const planet = stage && stage.querySelector('.planet');
        if (!planet || reducedMotion) return;

        let queued = false;
        const update = () => {
            queued = false;
            const top = stage.getBoundingClientRect().top;
            const p = clamp((window.innerHeight - top) / (window.innerHeight * 0.85), 0, 1);
            planet.style.setProperty('--p', p.toFixed(3));
        };
        const request = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(update);
        };
        window.addEventListener('scroll', request, { passive: true });
        window.addEventListener('resize', request);
        update();
    }

    // ------------------------------------------------------
    // Statement: words fill in as you scroll through the section
    // ------------------------------------------------------
    function initStatement() {
        const section = document.querySelector('[data-statement]');
        const text = section && section.querySelector('[data-statement-text]');
        if (!text) return;

        const words = text.textContent.trim().split(/\s+/);
        text.textContent = '';
        const nodes = words.map((word, i) => {
            const span = document.createElement('span');
            span.className = 'w';
            span.textContent = word;
            text.appendChild(span);
            if (i < words.length - 1) text.appendChild(document.createTextNode(' '));
            return span;
        });

        if (reducedMotion) {
            section.classList.add('is-static');
            nodes.forEach(n => (n.style.opacity = 1));
            return;
        }

        const BASE = 0.14;
        let queued = false;

        const update = () => {
            queued = false;
            const rect = section.getBoundingClientRect();
            const scrollable = Math.max(rect.height - window.innerHeight, 1);
            const progress = clamp(-rect.top / scrollable, 0, 1);
            // Finish filling a little before the section unpins.
            const reveal = clamp(progress / 0.85, 0, 1) * nodes.length;

            nodes.forEach((node, i) => {
                const amount = clamp(reveal - i, 0, 1);
                node.style.opacity = (BASE + (1 - BASE) * amount).toFixed(3);
            });
        };

        const request = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(update);
        };

        window.addEventListener('scroll', request, { passive: true });
        window.addEventListener('resize', request);
        update();
    }

    // ------------------------------------------------------
    // Testimonials: auto-advancing carousel with segment progress
    // ------------------------------------------------------
    function initTestimonials() {
        const slides = [...document.querySelectorAll('.t-slide')];
        const fills = [...document.querySelectorAll('.t-seg-fill')];
        const counter = document.querySelector('.t-current');
        if (slides.length < 2) return;

        const DURATION = 5000;
        const pad = (n) => String(n).padStart(2, '0');
        let index = 0;
        let elapsed = 0;
        let last = performance.now();

        const show = (i) => {
            slides[index].classList.remove('active');
            index = i;
            slides[index].classList.add('active');
            if (counter) counter.textContent = pad(index + 1);
        };

        const frame = (now) => {
            // Clamp the step so a backgrounded tab doesn't skip slides on return.
            elapsed += Math.min(now - last, 100);
            last = now;

            if (elapsed >= DURATION) {
                elapsed = 0;
                show((index + 1) % slides.length);
            }

            const progress = elapsed / DURATION;
            fills.forEach((fill, i) => {
                const value = i < index ? 1 : i === index ? progress : 0;
                fill.style.width = (value * 100).toFixed(2) + '%';
            });

            requestAnimationFrame(frame);
        };

        requestAnimationFrame(frame);
    }

    // ------------------------------------------------------
    // Contact dialog (EmailJS)
    // ------------------------------------------------------
    function initContact() {
        const dialog = document.getElementById('contact');
        const form = document.getElementById('contact-form');
        if (!dialog || !form || typeof dialog.showModal !== 'function') return;

        const planInput = document.getElementById('selected-plan');
        const submit = document.getElementById('contact-submit');
        const states = [...dialog.querySelectorAll('[data-state]')];
        const cfg = window.APP_CONFIG || {};
        let emailReady = false;

        const show = (name) => states.forEach(s => (s.hidden = s.dataset.state !== name));

        const open = (plan) => {
            planInput.value = plan || 'General';
            form.reset();
            form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            show('form');
            dialog.showModal();
        };

        document.querySelectorAll('[data-contact]').forEach(btn => {
            btn.addEventListener('click', () => open(btn.dataset.plan));
        });

        dialog.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => dialog.close()));
        dialog.querySelector('[data-retry]').addEventListener('click', () => show('form'));

        // Click on the backdrop closes the dialog.
        dialog.addEventListener('click', (e) => {
            if (e.target !== dialog) return;
            const r = dialog.getBoundingClientRect();
            const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
            if (!inside) dialog.close();
        });

        // Lock page scroll while open.
        new MutationObserver(() => {
            document.body.style.overflow = dialog.open ? 'hidden' : '';
        }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

        // Clear an error as soon as the field is fixed.
        form.addEventListener('input', (e) => {
            const wrap = e.target.closest('.field, .check');
            if (wrap && e.target.checkValidity()) wrap.classList.remove('is-invalid');
        });
        form.addEventListener('change', (e) => {
            const wrap = e.target.closest('.field, .check');
            if (wrap && e.target.checkValidity()) wrap.classList.remove('is-invalid');
        });

        const validate = () => {
            let first = null;
            form.querySelectorAll('input[required], select[required]').forEach(input => {
                const ok = input.checkValidity();
                input.closest('.field, .check').classList.toggle('is-invalid', !ok);
                if (!ok && !first) first = input;
            });
            if (first) first.focus();
            return !first;
        };

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!validate()) return;

            if (!window.emailjs) {
                show('error');
                return;
            }
            if (!emailReady) {
                window.emailjs.init({ publicKey: cfg.EMAILJS_PUBLIC_KEY || '' });
                emailReady = true;
            }

            const label = submit.textContent;
            submit.disabled = true;
            submit.textContent = 'Sending…';

            window.emailjs.sendForm(cfg.EMAILJS_SERVICE_ID || '', cfg.EMAILJS_TEMPLATE_ID || '', form)
                .then(() => show('success'))
                .catch((err) => {
                    console.error('EmailJS error:', err);
                    show('error');
                })
                .finally(() => {
                    submit.disabled = false;
                    submit.textContent = label;
                });
        });
    }
})();
