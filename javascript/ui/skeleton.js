/**
 * Skeleton + load-state helpers for data regions (css/skeleton.css).
 *
 * Rules used across the app:
 *   no usable data      -> showSkeletonRows()  (aria-busy + one status text)
 *   data arrived        -> endBusy() then render
 *   initial load failed -> showLoadError() with a Retry button
 *   refresh failed but content is usable -> showStaleNote() (discreet retry)
 */

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

/** Fill `container` with placeholder rows matching a list of people/sessions. */
export function showSkeletonRows(container, { count = 4, lines = 2, label } = {}) {
    if (!container) return;
    container.setAttribute('aria-busy', 'true');
    const fragment = document.createDocumentFragment();
    const status = document.createElement('p');
    status.className = 'sk-status-text';
    status.setAttribute('role', 'status');
    status.textContent = label || t('tp_loading', 'Зареждане…');
    fragment.appendChild(status);
    const widths = ['58%', '44%', '66%', '50%', '62%', '40%'];
    for (let i = 0; i < count; i += 1) {
        const row = document.createElement('div');
        row.className = 'sk-row';
        row.setAttribute('aria-hidden', 'true');
        const text = document.createElement('div');
        text.className = 'sk-row-text';
        const main = document.createElement('span');
        main.className = 'sk sk-line';
        main.style.setProperty('--sk-w', widths[i % widths.length]);
        text.appendChild(main);
        if (lines > 1) {
            const sub = document.createElement('span');
            sub.className = 'sk sk-line sk-line--sub';
            sub.style.setProperty('--sk-w', '28%');
            text.appendChild(sub);
        }
        row.appendChild(text);
        fragment.appendChild(row);
    }
    container.replaceChildren(fragment);
}

export function endBusy(container) {
    container?.removeAttribute('aria-busy');
}

/** Replace a skeleton with an inline error and a Retry button. */
export function showLoadError(container, message, onRetry) {
    if (!container) return;
    endBusy(container);
    const box = document.createElement('div');
    box.className = 'sk-error';
    box.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = message || t('tp_load_error', 'Неуспешно зареждане.');
    box.appendChild(text);
    if (typeof onRetry === 'function') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'sk-retry';
        retry.textContent = t('tp_retry', 'Опитай отново');
        retry.addEventListener('click', () => onRetry());
        box.appendChild(retry);
    }
    container.replaceChildren(box);
}

/**
 * Show/hide a discreet "couldn't refresh" note next to usable content.
 * `noteEl` is an existing <p class="sk-stale" hidden> element.
 */
export function showStaleNote(noteEl, onRetry) {
    if (!noteEl) return;
    noteEl.replaceChildren();
    const text = document.createElement('span');
    text.textContent = t('tp_refresh_failed', 'Не успяхме да обновим данните.');
    noteEl.appendChild(text);
    if (typeof onRetry === 'function') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = t('tp_retry', 'Опитай отново');
        retry.addEventListener('click', () => { hideStaleNote(noteEl); onRetry(); });
        noteEl.appendChild(retry);
    }
    noteEl.hidden = false;
}

export function hideStaleNote(noteEl) {
    if (noteEl) noteEl.hidden = true;
}
