// ==========================================================
// Safi AI page: demo chat and on-scroll reveals
// ==========================================================

(function () {
    'use strict';

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    initDemo();
    revealOnView('[data-writeup]');
    revealOnView('.plan-art');

    // ------------------------------------------------------
    // Demo: pick a question, Safi "types", then the answer appears.
    // Cycles on its own until someone picks a question.
    // ------------------------------------------------------
    function initDemo() {
        const prompts = [...document.querySelectorAll('.demo-prompt')];
        const question = document.querySelector('[data-q]');
        const answer = document.querySelector('[data-a]');
        if (!prompts.length || !question || !answer) return;

        const CYCLE = 7000;
        const THINK = reducedMotion ? 0 : 650;
        let current = 0;
        let thinkTimer = null;
        let cycleTimer = null;
        let userPicked = false;
        let inView = false;

        const render = (i) => {
            const tpl = document.getElementById('answer-' + prompts[i].dataset.answer);
            answer.replaceChildren(tpl.content.cloneNode(true));
        };

        const select = (i) => {
            current = i;
            prompts.forEach((p, n) => {
                p.classList.toggle('is-active', n === i);
                p.setAttribute('aria-selected', String(n === i));
            });
            question.textContent = prompts[i].textContent;

            clearTimeout(thinkTimer);
            if (THINK) {
                answer.innerHTML = '<p class="typing" aria-label="Safi AI is typing"><i></i><i></i><i></i></p>';
                thinkTimer = setTimeout(() => render(i), THINK);
            } else {
                render(i);
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

        render(0);

        new IntersectionObserver(([entry]) => {
            inView = entry.isIntersecting;
            if (inView) schedule();
            else clearTimeout(cycleTimer);
        }, { threshold: 0.4 }).observe(answer.closest('.demo-shell'));
    }

    // ------------------------------------------------------
    // Add .is-run once an element is mostly on screen
    // ------------------------------------------------------
    function revealOnView(selector) {
        const el = document.querySelector(selector);
        if (!el) return;
        if (reducedMotion) {
            el.classList.add('is-run');
            return;
        }
        new IntersectionObserver(([entry], obs) => {
            if (!entry.isIntersecting) return;
            el.classList.add('is-run');
            obs.disconnect();
        }, { threshold: 0.45 }).observe(el);
    }
})();
