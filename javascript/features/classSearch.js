/**
 * Class search — filters the class card list as the teacher types.
 *
 * Matching is case-insensitive (Cyrillic included) and ignores extra
 * whitespace. Cards added, renamed or removed later (creation wizard, class
 * options) are re-filtered automatically through a MutationObserver.
 */

function normalize(value) {
    return String(value || '')
        .normalize('NFC')
        .toLocaleLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

/**
 * @param {object} els
 * @param {HTMLInputElement} els.input
 * @param {HTMLElement} els.list - the <ul> of class cards
 * @param {HTMLElement} [els.empty] - visible "no results" message
 * @param {HTMLElement} [els.status] - visually hidden live region
 */
export function initClassSearch({ input, list, empty, status }) {
    if (!input || !list) return;

    let announceTimer = null;

    function apply({ announce = false } = {}) {
        const query = normalize(input.value);
        const items = Array.from(list.children);
        let visible = 0;

        items.forEach((li) => {
            const btn = li.querySelector('.newClassBtn');
            const name = normalize(btn?.dataset.className || btn?.textContent || li.textContent);
            const match = !query || name.includes(query);
            li.hidden = !match;
            if (match) visible += 1;
        });

        const noResults = Boolean(query) && visible === 0;
        if (empty) {
            empty.textContent = noResults ? t('tp_no_results', 'Няма дисциплини, които отговарят на търсенето.') : '';
            empty.hidden = !noResults;
        }

        if (status && announce) {
            clearTimeout(announceTimer);
            announceTimer = setTimeout(() => {
                status.textContent = !query
                    ? ''
                    : noResults
                        ? t('tp_no_results', 'Няма дисциплини, които отговарят на търсенето.')
                        : t('tp_results_count', 'Намерени дисциплини: {n}').replace('{n}', String(visible));
            }, 400);
        }
    }

    input.addEventListener('input', () => apply({ announce: true }));

    const observer = new MutationObserver(() => apply());
    observer.observe(list, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-class-name']
    });

    document.addEventListener('app:languagechange', () => apply());

    apply();
}
