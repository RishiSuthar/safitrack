// ==========================================================
// SafiTrack site pages: small shared behaviours
// ==========================================================

(function () {
    'use strict';

    // Filters: .chips buttons (data-filter) and an optional [data-search]
    // input narrow down the [data-group] items in the same section.
    document.querySelectorAll('section').forEach(scope => {
        const chips = scope.querySelector('.chips');
        const search = scope.querySelector('[data-search]');
        if (!chips && !search) return;
        const items = [...scope.querySelectorAll('[data-group]')];
        const empty = scope.querySelector('[data-empty]');
        let group = 'all';
        let query = '';

        const apply = () => {
            let shown = 0;
            items.forEach(el => {
                const inGroup = group === 'all' || el.dataset.group.split(' ').includes(group);
                const text = el.dataset.text || el.textContent.toLowerCase();
                const match = inGroup && (!query || text.includes(query));
                el.hidden = !match;
                if (match) shown++;
            });
            if (empty) empty.hidden = shown > 0;
        };

        if (chips) chips.addEventListener('click', (e) => {
            const chip = e.target.closest('[data-filter]');
            if (!chip) return;
            group = chip.dataset.filter;
            chips.querySelectorAll('[data-filter]').forEach(c => {
                c.classList.toggle('is-active', c === chip);
                c.setAttribute('aria-pressed', String(c === chip));
            });
            apply();
        });

        if (search) search.addEventListener('input', () => {
            query = search.value.trim().toLowerCase();
            apply();
        });
    });

    // Docs: highlight the section currently in view in the table of contents.
    const toc = document.querySelector('[data-toc]');
    if (toc) {
        const links = [...toc.querySelectorAll('a[href^="#"]')];
        const targets = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id));
            });
        }, { rootMargin: '-20% 0px -70% 0px' });
        targets.forEach(t => io.observe(t));
    }
})();
