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
    initMotion();
    initStatement();
    initFlow();
    initIntel();
    initRouteArt();
    initSignals();
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
    }

    // ------------------------------------------------------
    // Motion: the showcase windows drift with the mouse, cards
    // get a spotlight, a few lower sections fade up.
    // ------------------------------------------------------
    function initMotion() {
        if (reducedMotion) return;
        const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

        // ---- Floating windows drift at different depths with the pointer ----
        const stage = document.querySelector('.stage');
        const wins = stage ? [...stage.querySelectorAll('.win')] : [];
        if (stage && wins.length && finePointer) {
            const DEPTHS = [22, -16, 28];   // px of drift at the stage edge, per window
            const lean = { x: 0, y: 0, tx: 0, ty: 0 };
            let running = false;
            const step = () => {
                lean.x += (lean.tx - lean.x) * 0.12;
                lean.y += (lean.ty - lean.y) * 0.12;
                wins.forEach((win, i) => {
                    if (win.classList.contains('is-dragging')) return;
                    const d = DEPTHS[i % DEPTHS.length];
                    win.style.setProperty('--px', (lean.x * d).toFixed(2) + 'px');
                    win.style.setProperty('--py', (lean.y * d * 0.6).toFixed(2) + 'px');
                });
                running = Math.abs(lean.tx - lean.x) + Math.abs(lean.ty - lean.y) > 0.001;
                if (running) requestAnimationFrame(step);
            };
            const wake = () => { if (!running) { running = true; requestAnimationFrame(step); } };
            stage.addEventListener('pointermove', (e) => {
                const r = stage.getBoundingClientRect();
                lean.tx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
                lean.ty = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
                wake();
            });
            stage.addEventListener('pointerleave', () => { lean.tx = 0; lean.ty = 0; wake(); });
        }

        // ---- Spotlight cards ----
        if (finePointer) {
            document.querySelectorAll('.plan, .intel-item').forEach(card => {
                card.addEventListener('pointermove', (e) => {
                    const r = card.getBoundingClientRect();
                    card.style.setProperty('--mx', (e.clientX - r.left) + 'px');
                    card.style.setProperty('--my', (e.clientY - r.top) + 'px');
                });
            });
        }

        // ---- Scroll reveal ----
        const revealGroups = [
            ['.intel-item', 0.07],
            ['.plans .plan', 0.07],
            ['.section-head', 0],
        ];
        const toReveal = [];
        revealGroups.forEach(([sel, step]) => {
            document.querySelectorAll(sel).forEach((el, i) => {
                el.setAttribute('data-reveal', '');
                if (step) el.style.setProperty('--reveal-delay', ((i % 6) * step).toFixed(2) + 's');
                toReveal.push(el);
            });
        });
        if (toReveal.length) {
            document.documentElement.classList.add('has-motion');
            const io = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-revealed');
                    io.unobserve(entry.target);
                });
            }, { rootMargin: '0px 0px -8% 0px' });
            toReveal.forEach(el => io.observe(el));
        }
    }

    // ------------------------------------------------------
    // Features: highlight the panel in view
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
    }

    // ------------------------------------------------------
    // Signals: the list advances on its own (click to pick one).
    // Each item has its own diagram, drawn from one shared set of
    // particles so switching morphs one picture into the next:
    //   0 Live team activity: reps orbiting the account, pinging in
    //   1 AI write-ups: loose notes stream through Safi AI into a
    //     tidy summary card with a lead score
    //   2 Workflows: trigger -> condition -> task + alert, with data
    //     flowing along the connections
    // ------------------------------------------------------
    function initSignals() {
        const section = document.querySelector('.signals');
        if (!section) return;
        const items = [...section.querySelectorAll('.signal')];
        const bar = section.querySelector('.signals-bar i');
        const canvas = section.querySelector('.signals-canvas');
        const art = section.querySelector('.signals-art');
        const ctx = canvas.getContext('2d');
        const DURATION = 4000, MORPH = 1100, N = 72;
        const TAU = Math.PI * 2;
        const lerp = (a, b, t) => a + (b - a) * t;
        const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
        const font = getComputedStyle(document.body).fontFamily;

        // Stable per-particle randomness so layouts don't jump between frames.
        let seed = 11;
        const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const P = Array.from({ length: N }, () => ({ d: rnd(), a: rnd(), b: rnd(), c: rnd() }));

        let W = 0, H = 0, dpr = 1;
        const resize = () => {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = art.clientWidth; H = art.clientHeight;
            canvas.width = W * dpr; canvas.height = H * dpr;
        };
        const geom = () => ({ cx: W * 0.5, cy: H * 0.47, u: Math.min(W * 0.68, H * 1.05) });
        // The write-up and workflow diagrams are flatter than the orbit, so draw them larger.
        const big = (g) => ({ cx: g.cx, cy: g.cy, u: g.u * 1.2 });

        const stroke = (style, width = 1, dash = []) => {
            ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
        };
        const rrect = (x, y, w, h, r) => {
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
        };

        // ---------- Scene 0: orbit ----------
        const RINGS = [
            { r: .17, s: .36, n: 6 }, { r: .29, s: .22, n: 10 }, { r: .42, s: .15, n: 14 },
            { r: .56, s: .10, n: 18 }, { r: .70, s: .06, n: 24, dashed: true },
        ];
        const ringOf = [];
        RINGS.forEach((rg, ri) => { for (let k = 0; k < rg.n; k++) ringOf.push([ri, k]); });
        const REPS = [1, 4, 8, 12, 18, 23, 27, 34, 41, 55];      // the bright dots
        const isRep = new Set(REPS);
        const ROT = -16 * Math.PI / 180, SQ = .58;
        const onEllipse = (g, r, ang) => {
            const rx = r * g.u, x = Math.cos(ang) * rx, y = Math.sin(ang) * rx * SQ;
            return [g.cx + x * Math.cos(ROT) - y * Math.sin(ROT), g.cy + x * Math.sin(ROT) + y * Math.cos(ROT)];
        };
        const orbitDot = (i, g, t) => {
            const [ri, k] = ringOf[i], rg = RINGS[ri];
            const [x, y] = onEllipse(g, rg.r, (k / rg.n) * TAU + P[i].a * .4 + (t / 1000) * rg.s);
            return isRep.has(i) ? [x, y, 2.2, 1] : [x, y, 1.1, rg.dashed ? .22 : .32];
        };

        // ---------- Scene 1: write-ups ----------
        const ROWS = [10, 8, 9, 5];
        const SLOTS = ROWS.reduce((a, b) => a + b, 0);
        const slotRC = [];
        ROWS.forEach((n, r) => { for (let c = 0; c < n; c++) slotRC.push([r, c]); });
        const writeup = (g) => {
            const card = { x: g.cx + .07 * g.u, y: g.cy - .16 * g.u, w: .38 * g.u, h: .32 * g.u };
            return { card, core: [g.cx - .07 * g.u, g.cy], cloud: [g.cx - .34 * g.u, g.cy] };
        };
        const writeupDot = (i, g, t, tl) => {
            const L = writeup(g);
            if (i < SLOTS) {
                const [r, c] = slotRC[i];
                const sx = L.card.x + .045 * g.u + c * .024 * g.u, sy = L.card.y + .09 * g.u + r * .062 * g.u;
                const release = 250 + i * 55;
                // waiting in the core, then written into the card
                const ang = P[i].a * TAU + t / 380, rad = 3 + P[i].b * 6;
                const wx = L.core[0] + Math.cos(ang) * rad, wy = L.core[1] + Math.sin(ang) * rad;
                const k = ease(clamp((tl - release) / 380, 0, 1));
                return [lerp(wx, sx, k), lerp(wy, sy, k), lerp(1.3, 1.7, k), lerp(.75, r === 3 ? .45 : .9, k)];
            }
            const x = L.cloud[0] + (P[i].a - .5) * .3 * g.u + Math.sin(t / 900 + P[i].c * 6) * 3;
            const y = L.cloud[1] + (P[i].b - .5) * .4 * g.u + Math.cos(t / 1100 + P[i].d * 6) * 3;
            return [x, y, .9 + P[i].c * 1.1, .4];
        };

        // ---------- Scene 2: workflows ----------
        const flow = (g) => {
            const u = g.u;
            const T = { x: g.cx - .36 * u, y: g.cy, label: 'Trigger' };
            const D = { x: g.cx - .06 * u, y: g.cy, label: 'If' };
            const A1 = { x: g.cx + .25 * u, y: g.cy - .17 * u, label: 'Task' };
            const A2 = { x: g.cx + .25 * u, y: g.cy + .17 * u, label: 'Alert' };
            const hw = .095 * u, hd = .055 * u;
            const edges = [
                [[T.x + hw, T.y], [T.x + hw + .05 * u, T.y], [D.x - hd - .05 * u, D.y], [D.x - hd, D.y]],
                [[D.x + hd, D.y], [D.x + .16 * u, D.y], [A1.x - hw - .12 * u, A1.y], [A1.x - hw, A1.y]],
                [[D.x + hd, D.y], [D.x + .16 * u, D.y], [A2.x - hw - .12 * u, A2.y], [A2.x - hw, A2.y]],
            ];
            return { T, D, A1, A2, hw, hd, edges };
        };
        const bez = (e, s) => {
            const m = 1 - s;
            return [0, 1].map(j => m * m * m * e[0][j] + 3 * m * m * s * e[1][j] + 3 * m * s * s * e[2][j] + s * s * s * e[3][j]);
        };
        const CYCLE = 2600;
        const flowDot = (i, g, t) => {
            const F = flow(g);
            if (i < 24) {
                // data packets on the connections, in step with the node glows
                const edge = Math.floor(i / 8), k = i % 8;
                const s = ((t / CYCLE + k / 8) % 1);
                const [x, y] = bez(F.edges[edge], s);
                return [x, y, 1.5, .25 + .65 * Math.sin(s * Math.PI)];
            }
            const j = i - 24, col = j % 8, row = Math.floor(j / 8);
            return [g.cx + (col - 3.5) * .12 * g.u, g.cy + (row - 2.5) * .12 * g.u, .9, .13];
        };

        // ---------- Line art + effects for each scene ----------
        const pings = [], sparks = [];
        const SCENES = [
            {
                dot: (i, g, t) => orbitDot(i, g, t),
                art(g, t, tl, w) {
                    RINGS.forEach(rg => {
                        const rx = rg.r * g.u;
                        ctx.beginPath(); ctx.ellipse(g.cx, g.cy, rx, rx * SQ, ROT, 0, TAU);
                        stroke(`rgba(255,255,255,${(rg.dashed ? .1 : .15) * w})`, 1, rg.dashed ? [4, 6] : []);
                    });
                    ctx.beginPath(); ctx.arc(g.cx, g.cy, .11 * g.u, 0, TAU);
                    stroke(`rgba(255,255,255,${.55 * w})`, 1.4);
                    pings.forEach(p => {
                        const age = (t - p.at) / 1400;
                        if (age < 0 || age > 1) return;
                        const [x, y] = orbitDot(p.i, g, t);
                        ctx.beginPath(); ctx.arc(x, y, 3 + age * 22, 0, TAU);
                        stroke(`rgba(125,211,252,${.6 * (1 - age) * w})`);
                    });
                },
            },
            {
                dot: (i, g, t, tl) => writeupDot(i, big(g), t, tl),
                art(g0, t, tl, w) {
                    const g = big(g0), L = writeup(g), c = L.card;
                    // guides: notes -> core -> card
                    ctx.beginPath(); ctx.moveTo(L.cloud[0] + .16 * g.u, L.cloud[1]); ctx.lineTo(L.core[0] - .05 * g.u, L.core[1]);
                    stroke(`rgba(255,255,255,${.1 * w})`, 1, [3, 5]);
                    ctx.beginPath(); ctx.moveTo(L.core[0] + .05 * g.u, L.core[1]); ctx.lineTo(c.x, L.core[1]);
                    stroke(`rgba(255,255,255,${.1 * w})`, 1, [3, 5]);
                    // the Safi AI core
                    const glow = .5 + .5 * Math.sin(t / 600);
                    const grad = ctx.createRadialGradient(L.core[0], L.core[1], 0, L.core[0], L.core[1], .1 * g.u);
                    grad.addColorStop(0, `rgba(165,180,252,${(.22 + glow * .12) * w})`);
                    grad.addColorStop(1, 'rgba(165,180,252,0)');
                    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(L.core[0], L.core[1], .1 * g.u, 0, TAU); ctx.fill();
                    ctx.beginPath(); ctx.arc(L.core[0], L.core[1], .045 * g.u, 0, TAU);
                    stroke(`rgba(255,255,255,${.55 * w})`, 1.4);
                    // the summary card
                    rrect(c.x, c.y, c.w, c.h, 12);
                    stroke(`rgba(255,255,255,${.22 * w})`, 1.2);
                    // lead score ring fills once the card is written
                    const rx = c.x + c.w - .065 * g.u, ry = c.y + .08 * g.u, rr = .035 * g.u;
                    const fill = .85 * smooth(900, 2400, tl);
                    ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); stroke(`rgba(255,255,255,${.12 * w})`, 2);
                    if (fill > 0) {
                        ctx.beginPath(); ctx.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + fill * TAU);
                        stroke(`rgba(125,211,252,${.85 * w})`, 2);
                    }
                    ctx.fillStyle = `rgba(230,231,234,${.85 * w * smooth(900, 1500, tl)})`;
                    ctx.font = `600 ${Math.round(.03 * g.u)}px ${font}`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(Math.round(fill * 100)), rx, ry + 1);
                    // notes being read: sparks from the cloud into the core
                    sparks.forEach(sp => {
                        const age = (t - sp.at) / 700;
                        if (age < 0 || age > 1) return;
                        const k = ease(age);
                        const x = lerp(sp.x * g.u + L.cloud[0], L.core[0], k), y = lerp(sp.y * g.u + L.cloud[1], L.core[1], k);
                        ctx.beginPath(); ctx.arc(x, y, 1.4, 0, TAU);
                        ctx.fillStyle = `rgba(165,180,252,${.8 * Math.sin(age * Math.PI) * w})`; ctx.fill();
                    });
                },
            },
            {
                dot: (i, g, t) => flowDot(i, big(g), t),
                art(g0, t, tl, w) {
                    const g = big(g0), F = flow(g);
                    F.edges.forEach(e => {
                        ctx.beginPath(); ctx.moveTo(...e[0]); ctx.bezierCurveTo(...e[1], ...e[2], ...e[3]);
                        stroke(`rgba(255,255,255,${.16 * w})`);
                    });
                    // nodes light up in order as the data reaches them
                    const phase = (t / CYCLE) % 1;
                    const lit = (at) => { const d = (phase - at + 1) % 1; return d < .3 ? 1 - d / .3 : 0; };
                    const box = (n, l) => {
                        rrect(n.x - F.hw, n.y - .042 * g.u, F.hw * 2, .084 * g.u, 10);
                        ctx.fillStyle = `rgba(125,211,252,${.08 * l * w})`; ctx.fill();
                        stroke(`rgba(${l > .05 ? '125,211,252' : '255,255,255'},${(.3 + .5 * l) * w})`, 1.2);
                    };
                    const diamond = (n, l) => {
                        ctx.beginPath();
                        ctx.moveTo(n.x, n.y - F.hd); ctx.lineTo(n.x + F.hd, n.y); ctx.lineTo(n.x, n.y + F.hd); ctx.lineTo(n.x - F.hd, n.y); ctx.closePath();
                        ctx.fillStyle = `rgba(125,211,252,${.08 * l * w})`; ctx.fill();
                        stroke(`rgba(${l > .05 ? '125,211,252' : '255,255,255'},${(.3 + .5 * l) * w})`, 1.2);
                    };
                    box(F.T, lit(0)); diamond(F.D, lit(.33)); box(F.A1, lit(.95)); box(F.A2, lit(.95));
                    ctx.fillStyle = `rgba(200,202,208,${.75 * w})`;
                    ctx.font = `500 ${Math.round(.03 * g.u)}px ${font}`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    [F.T, F.D, F.A1, F.A2].forEach(n => ctx.fillText(n.label, n.x, n.y + 1));
                },
            },
        ];

        // ---------- State ----------
        let active = 0, from = 0, sceneStart = 0, fromStart = 0, morphStart = -1e9;
        let elapsed = 0, last = 0, raf = 0, nextEvent = 0;

        const render = (now) => {
            const g = geom();
            const k = reducedMotion ? 1 : clamp((now - morphStart) / MORPH, 0, 1);
            const wNew = smooth(.3, 1, k), wOld = 1 - smooth(0, .5, k);
            const tl = reducedMotion ? 1e5 : now - sceneStart, tlOld = now - fromStart;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            if (k < 1 && wOld > 0) SCENES[from].art(g, now, tlOld, wOld);
            SCENES[active].art(g, now, tl, wNew);
            for (let i = 0; i < N; i++) {
                let [x, y, r, a] = SCENES[active].dot(i, g, now, tl);
                if (k < 1) {
                    const o = SCENES[from].dot(i, g, now, tlOld);
                    const ki = ease(clamp((k - P[i].d * .35) / .65, 0, 1));
                    x = lerp(o[0], x, ki); y = lerp(o[1], y, ki); r = lerp(o[2], r, ki); a = lerp(o[3], a, ki);
                }
                if (a < .02) continue;
                ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
                ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
                ctx.shadowColor = 'rgba(255,255,255,.8)';
                ctx.shadowBlur = r > 1.8 ? 6 : 0;
                ctx.fill();
            }
            ctx.shadowBlur = 0;
        };

        const select = (i, now = performance.now()) => {
            elapsed = 0;
            items.forEach((el, n) => {
                el.classList.toggle('is-active', n === i);
                el.setAttribute('aria-selected', String(n === i));
            });
            if (i === active) return;
            from = active; fromStart = sceneStart;
            active = i; sceneStart = now; morphStart = now;
            if (reducedMotion) render(now);
        };
        items.forEach((el, i) => {
            el.addEventListener('click', () => select(i));
            el.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
                e.preventDefault();
                const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next].focus();
                select(next);
            });
        });

        // Occasional events: a rep checks in, or a note gets read.
        const events = (now) => {
            if (now < nextEvent) return;
            if (active === 0) {
                pings.push({ i: REPS[Math.floor(Math.random() * REPS.length)], at: now });
                nextEvent = now + 700 + Math.random() * 600;
            } else if (active === 1) {
                sparks.push({ x: (Math.random() - .5) * .28, y: (Math.random() - .5) * .38, at: now });
                nextEvent = now + 160 + Math.random() * 160;
            } else nextEvent = now + 500;
            const cutoff = now - 2000;
            while (pings.length && pings[0].at < cutoff) pings.shift();
            while (sparks.length && sparks[0].at < cutoff) sparks.shift();
        };

        const frame = (now) => {
            const dt = Math.min(now - (last || now), 100);
            last = now;
            elapsed += dt;
            if (elapsed >= DURATION) select((active + 1) % items.length, now);
            if (bar) bar.style.width = ((elapsed / DURATION) * 100).toFixed(2) + '%';
            events(now);
            render(now);
            raf = requestAnimationFrame(frame);
        };

        resize();
        window.addEventListener('resize', () => { resize(); render(performance.now()); });
        if (reducedMotion) { if (bar) bar.style.width = '100%'; render(0); return; }

        new IntersectionObserver(([entry]) => {
            cancelAnimationFrame(raf);
            if (entry.isIntersecting) { last = 0; raf = requestAnimationFrame(frame); }
        }, { threshold: 0.2 }).observe(section);
        render(performance.now());
    }

    // ------------------------------------------------------
    // Import / export route: draws itself on screen, then a pulse
    // runs the route. On hover the pointer scrubs along it: the
    // route lights up to the cursor and each stop passed lights
    // and pops a file chip (CSV in, XLSX and PDF out, shared).
    // The lattice shifts with the pointer; click to replay.
    // ------------------------------------------------------
    function initRouteArt() {
        const art = document.querySelector('.connect-art');
        const svg = art && art.querySelector('.route-art');
        if (!svg) return;
        const NS = 'http://www.w3.org/2000/svg';
        const line = svg.querySelector('.route-line');
        const progress = svg.querySelector('.route-progress');
        const pulse = svg.querySelector('.route-pulse');
        const lattice = svg.querySelector('.lattice');
        const chipLayer = svg.querySelector('.route-chips');
        const length = line.getTotalLength();
        progress.style.strokeDasharray = length;
        progress.style.strokeDashoffset = length;

        // Distance along the route at which each stop sits.
        const samples = [];
        for (let i = 0; i <= 240; i++) {
            const p = line.getPointAtLength((i / 240) * length);
            samples.push({ x: p.x, y: p.y, at: (i / 240) * length });
        }
        const atNearest = (x, y) => samples.reduce((best, s) => {
            const d = Math.hypot(s.x - x, s.y - y);
            return d < best.d ? { d, at: s.at } : best;
        }, { d: Infinity, at: 0 }).at;

        const stops = [...svg.querySelectorAll('.route-stops > g[data-badge]')].map(g => {
            const [, x, y] = g.getAttribute('transform').match(/translate\(([\d.]+) ([\d.]+)\)/);
            const stop = { inner: g.querySelector('.stop'), x: +x, y: +y, at: atNearest(+x, +y) };

            // file chip: coloured badge + label, above or below the stop
            const chip = document.createElementNS(NS, 'g');
            chip.setAttribute('class', 'route-chip');
            const inner = document.createElementNS(NS, 'g');
            inner.setAttribute('class', 'chip-in');
            const bg = document.createElementNS(NS, 'rect');
            bg.setAttribute('class', 'chip-bg'); bg.setAttribute('rx', 8); bg.setAttribute('height', 26);
            const badge = document.createElementNS(NS, 'rect');
            badge.setAttribute('rx', 4); badge.setAttribute('height', 14); badge.setAttribute('x', 6); badge.setAttribute('y', 6);
            badge.setAttribute('fill', g.dataset.tone);
            const bt = document.createElementNS(NS, 'text');
            bt.setAttribute('class', 'chip-badge'); bt.setAttribute('y', 16.2); bt.textContent = g.dataset.badge;
            const tt = document.createElementNS(NS, 'text');
            tt.setAttribute('y', 17); tt.textContent = g.dataset.text;
            inner.append(bg, badge, bt, tt);
            chip.append(inner);
            chipLayer.append(chip);
            const bw = Math.max(16, bt.getComputedTextLength() + 8);
            badge.setAttribute('width', bw);
            bt.setAttribute('x', 6 + (bw - bt.getComputedTextLength()) / 2);
            tt.setAttribute('x', 6 + bw + 7);
            const w = 6 + bw + 7 + tt.getComputedTextLength() + 10;
            bg.setAttribute('width', w);
            Object.assign(stop, { chip, w, cy: g.dataset.side === 'down' ? stop.y + 18 : stop.y - 44 });
            return stop;
        });

        // The SVG is cropped to cover its panel, so keep chips inside the part that's visible.
        const placeChips = () => {
            const r = art.getBoundingClientRect(), m = svg.getScreenCTM();
            if (!m || !r.width) return;
            const inv = m.inverse();
            const left = new DOMPoint(r.left, r.top).matrixTransform(inv).x;
            const right = new DOMPoint(r.right, r.top).matrixTransform(inv).x;
            stops.forEach(s => {
                const x = clamp(s.x - s.w / 2, left + 8, right - s.w - 8);
                s.chip.setAttribute('transform', `translate(${x.toFixed(1)} ${s.cy.toFixed(1)})`);
            });
        };
        placeChips();
        window.addEventListener('resize', placeChips);

        const LAP = 3800;   // ms for the idle pulse to run the route
        let inView = false, pulsing = false, scrubbing = false, raf = 0, startedAt = 0, timer = 0;
        let head = 0, headTo = 0;

        const place = (at) => {
            const p = line.getPointAtLength(at);
            pulse.setAttribute('cx', p.x.toFixed(1));
            pulse.setAttribute('cy', p.y.toFixed(1));
        };
        const frame = (now) => {
            if (scrubbing) {
                head += (headTo - head) * 0.16;
                progress.style.strokeDashoffset = (length - head).toFixed(1);
                place(head);
                stops.forEach(s => {
                    const on = head >= s.at - 2;
                    s.inner.classList.toggle('is-lit', on);
                    s.chip.classList.toggle('is-on', on);
                });
            } else if (pulsing) {
                place((((now - startedAt) % LAP) / LAP) * length);
            }
            if (inView && (pulsing || scrubbing)) raf = requestAnimationFrame(frame);
        };
        const loop = () => {
            cancelAnimationFrame(raf);
            if (reducedMotion || !inView) return;
            if (pulsing && !scrubbing) startedAt = performance.now();
            if (pulsing || scrubbing) raf = requestAnimationFrame(frame);
        };
        const run = () => {
            clearTimeout(timer);
            svg.classList.remove('is-run', 'is-pulsing');
            pulsing = false;
            void svg.getBoundingClientRect();
            svg.classList.add('is-run');
            if (reducedMotion) return;
            timer = setTimeout(() => { pulsing = true; svg.classList.add('is-pulsing'); loop(); }, 2200);
        };

        let started = false;
        new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            if (inView && !started) { started = true; run(); } else loop();
        }, { threshold: 0.4 }).observe(svg);

        art.addEventListener('click', run);

        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        const pt = svg.createSVGPoint();
        const toSvg = (e) => { pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };

        art.addEventListener('pointermove', (e) => {
            if (!svg.classList.contains('is-run')) return;
            const p = toSvg(e);
            lattice.style.transform = `translate(${(-(p.x - 280) / 28).toFixed(1)}px, ${(-(p.y - 160) / 22).toFixed(1)}px)`;
            // The route only moves left to right, so the cursor's x picks how far along it we are.
            const x = clamp(p.x, samples[0].x, samples[samples.length - 1].x);
            const hit = samples.find(s => s.x >= x) || samples[samples.length - 1];
            headTo = hit.at;
            if (!scrubbing) {
                placeChips();
                scrubbing = true;
                head = 0;
                art.classList.add('is-scrubbing');
                loop();
            }
        });
        art.addEventListener('pointerleave', () => {
            scrubbing = false;
            art.classList.remove('is-scrubbing');
            lattice.style.transform = '';
            progress.style.strokeDashoffset = length;
            stops.forEach(s => { s.inner.classList.remove('is-lit'); s.chip.classList.remove('is-on'); });
            loop();
        });
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

        initHorizonRain(stage, planet);
    }

    // Light drops fall along the fine vertical hairlines and land on the
    // horizon, leaving a small glow in the rim's colour where they hit.
    // Only runs while the section is on screen.
    function initHorizonRain(stage, planet) {
        const canvas = document.createElement('canvas');
        canvas.className = 'intel-sparks';
        canvas.setAttribute('aria-hidden', 'true');
        stage.insertBefore(canvas, stage.querySelector('.intel-heading'));
        const ctx = canvas.getContext('2d');
        const HAIRLINE = 6;   // matches the 6px repeating gradient on .intel-stage::before
        let dpr = 1, W = 0, H = 0, inView = false, raf = 0, last = 0, nextDrop = 0;
        const drops = [], splashes = [];
        const rand = (a, b) => a + Math.random() * (b - a);

        const resize = () => {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = stage.clientWidth; H = stage.clientHeight;
            canvas.width = W * dpr; canvas.height = H * dpr;
        };

        // Rim colour at angle a (degrees from the top, clockwise), matching the CSS conic gradient.
        const colourAt = (a) => {
            if (a > 24) return [56, 189, 248];
            if (a > 9) return [94, 234, 212];
            if (a < -24) return [249, 115, 22];
            if (a < -9) return [250, 204, 21];
            return [214, 220, 235];
        };

        const horizon = () => {
            const sr = stage.getBoundingClientRect(), pr = planet.getBoundingClientRect();
            const R = pr.width / 2;
            return { cx: pr.left + R - sr.left, cy: pr.top + R - sr.top, R };
        };

        const spawn = (h) => {
            // pick a hairline above the visible part of the planet
            const span = Math.min(h.R * 0.82, W / 2 - 40);
            const x = Math.round((h.cx + rand(-span, span)) / HAIRLINE) * HAIRLINE + 0.5;
            const dx = x - h.cx;
            if (Math.abs(dx) >= h.R) return;
            const hitY = h.cy - Math.sqrt(h.R * h.R - dx * dx);
            if (hitY < 60) return;
            const ang = Math.asin(dx / h.R) * 180 / Math.PI;
            drops.push({ x, y: rand(-80, hitY * 0.35), hitY, speed: rand(170, 300), len: rand(40, 95), rgb: colourAt(ang), ang });
        };

        const frame = (now) => {
            const dt = Math.min((now - (last || now)) / 1000, 0.05);
            last = now;
            const h = horizon();
            if (now > nextDrop) {
                spawn(h);
                if (Math.random() < 0.25) spawn(h);
                nextDrop = now + rand(260, 620);
            }

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, W, H);
            ctx.globalCompositeOperation = 'lighter';

            for (let i = drops.length - 1; i >= 0; i--) {
                const d = drops[i];
                d.y += d.speed * dt;
                const head = Math.min(d.y, d.hitY), tail = head - d.len;
                const [r, g, b] = d.rgb;
                const grad = ctx.createLinearGradient(0, tail, 0, head);
                grad.addColorStop(0, 'rgba(255,255,255,0)');
                grad.addColorStop(0.75, `rgba(${r},${g},${b},.35)`);
                grad.addColorStop(1, 'rgba(255,255,255,.85)');
                ctx.strokeStyle = grad;
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(d.x, tail); ctx.lineTo(d.x, head); ctx.stroke();
                if (d.y >= d.hitY) {
                    splashes.push({ x: d.x, y: d.hitY, rgb: d.rgb, ang: d.ang, at: now });
                    drops.splice(i, 1);
                }
            }

            for (let i = splashes.length - 1; i >= 0; i--) {
                const sp = splashes[i], age = (now - sp.at) / 1100;
                if (age > 1) { splashes.splice(i, 1); continue; }
                const [r, g, b] = sp.rgb, fade = 1 - age;
                // a glow on the rim around the impact, spreading a little as it fades
                const a0 = (sp.ang - 90) * Math.PI / 180, spread = 0.012 + age * 0.03;
                ctx.beginPath();
                ctx.arc(h.cx, h.cy, h.R, a0 - spread, a0 + spread);
                ctx.strokeStyle = `rgba(${r},${g},${b},${(0.9 * fade).toFixed(3)})`;
                ctx.lineWidth = 2;
                ctx.shadowColor = `rgb(${r},${g},${b})`;
                ctx.shadowBlur = 14;
                ctx.stroke();
                ctx.shadowBlur = 0;
                const glow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 26);
                glow.addColorStop(0, `rgba(${r},${g},${b},${(0.35 * fade).toFixed(3)})`);
                glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
                ctx.fillStyle = glow;
                ctx.beginPath(); ctx.arc(sp.x, sp.y, 26, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over';

            raf = requestAnimationFrame(frame);
        };

        resize();
        window.addEventListener('resize', resize);
        new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            cancelAnimationFrame(raf);
            if (inView) { last = 0; raf = requestAnimationFrame(frame); }
        }, { threshold: 0.15 }).observe(stage);
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
