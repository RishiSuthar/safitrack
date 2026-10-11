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

    // Docs: highlight the section currently in view in every [data-toc] list.
    const tocs = [...document.querySelectorAll('[data-toc]')];
    if (tocs.length) {
        const links = tocs.flatMap(t => [...t.querySelectorAll('a[href^="#"]')]);
        const ids = [...new Set(links.map(a => a.getAttribute('href').slice(1)))];
        const targets = ids.map(id => document.getElementById(id)).filter(Boolean);
        const io = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                links.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === '#' + entry.target.id));
            });
        }, { rootMargin: '-15% 0px -75% 0px' });
        targets.forEach(t => io.observe(t));
    }

    // Code blocks: copy button
    document.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
            const code = btn.closest('.code').querySelector('pre').innerText;
            const done = () => {
                btn.textContent = 'Copied';
                setTimeout(() => (btn.textContent = 'Copy'), 1500);
            };
            if (navigator.clipboard) navigator.clipboard.writeText(code).then(done, () => { });
        });
    });
})();
