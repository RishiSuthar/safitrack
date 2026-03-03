/* SafiTrack Feature Pages — Shared JS */

document.addEventListener('DOMContentLoaded', () => {
    // ── Scroll-reveal animations ──
    const animEls = document.querySelectorAll('.fp-animate');
    if (animEls.length) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) {
                    e.target.classList.add('visible');
                    io.unobserve(e.target);
                }
            });
        }, { threshold: 0.15 });
        animEls.forEach(el => io.observe(el));
    }

    // ── Mobile menu ──
    const menuBtn = document.querySelector('.mobile-menu-btn');
    const overlay = document.querySelector('.mobile-nav-overlay');
    const closeBtn = document.querySelector('.mobile-close-btn');

    function toggleMenu(open) {
        if (!overlay) return;
        overlay.classList.toggle('active', open);
        document.body.style.overflow = open ? 'hidden' : '';
    }

    if (menuBtn) menuBtn.addEventListener('click', () => toggleMenu(true));
    if (closeBtn) closeBtn.addEventListener('click', () => toggleMenu(false));
    if (overlay) overlay.addEventListener('click', (e) => {
        if (e.target === overlay) toggleMenu(false);
    });

    // ── Navbar shrink on scroll ──
    const nav = document.getElementById('navbar');
    if (nav) {
        window.addEventListener('scroll', () => {
            nav.classList.toggle('scrolled', window.scrollY > 20);
        }, { passive: true });
    }
});
