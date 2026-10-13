// ==========================================================
// Safi AI page: demo questions swap in real Safi AI screenshots
// ==========================================================

(function () {
    'use strict';

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    initDemo();

    // ------------------------------------------------------
    // Demo: pick a question to see Safi AI's real answer.
    // Cycles on its own until someone picks a question.
    // ------------------------------------------------------
    function initDemo() {
        const prompts = [...document.querySelectorAll('.demo-prompt')];
        const shot = document.querySelector('[data-shot]');
        if (!prompts.length || !shot) return;

        const CYCLE = 7000;
        const srcFor = (p) => shot.getAttribute('src').replace(/safi-ai-[a-z]+\.webp$/, `safi-ai-${p.dataset.answer}.webp`);
        let current = 0;
        let cycleTimer = null;
        let userPicked = false;
        let inView = false;

        // Warm the cache so switching questions doesn't flash
        prompts.forEach(p => { const img = new Image(); img.src = srcFor(p); });

        const select = (i) => {
            current = i;
            prompts.forEach((p, n) => {
                p.classList.toggle('is-active', n === i);
                p.setAttribute('aria-selected', String(n === i));
            });
            shot.src = srcFor(prompts[i]);
            shot.alt = prompts[i].dataset.alt || '';
            if (!reducedMotion) {
                shot.classList.remove('is-in');
                void shot.offsetWidth;
                shot.classList.add('is-in');
            }
        };

        const schedule = () => {
            clearTimeout(cycleTimer);
            if (userPicked || !inView || reducedMotion) return;
            cycleTimer = setTimeout(() => {
                select((current + 1) % prompts.length);
                schedule();
            }, CYCLE);
        };

        prompts.forEach((p, i) => p.addEventListener('click', () => {
            userPicked = true;
            clearTimeout(cycleTimer);
            select(i);
            // keep the chosen chip visible when the list scrolls sideways on phones
            p.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
        }));

        new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            if (inView) schedule();
            else clearTimeout(cycleTimer);
        }, { threshold: 0.4 }).observe(shot.closest('.demo-shell'));
    }
})();
