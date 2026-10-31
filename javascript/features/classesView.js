/**
 * Дисциплини view: the class card list.
 *
 *   no data          -> static skeleton cards (in the HTML) -> list / inline error + retry
 *   cached list      -> rendered at once, refreshed quietly when stale
 *   refresh failed   -> list stays, discreet retry note
 *   empty response   -> empty state
 * Updates are reconciled by class id: unchanged cards (and keyboard focus)
 * stay as they are; only additions, renames, moves and removals touch the DOM.
 */

import { fetchClasses } from '../api/classApi.js';
import { revalidate, isFresh, readCache } from '../data/cache.js';
import { classesKey, normalizeClasses, readCachedClasses, CLASSES_MAX_AGE_MS } from '../data/classesStore.js';
import { renderClassItem, setClassButtonLabel } from '../ui/classUI.js';
import { setClassId } from '../state/appState.js';
import { saveClassesMap } from '../storage/classStorage.js';
import { showLoadError, showStaleNote, hideStaleNote, endBusy } from '../ui/skeleton.js';

function t(key, fallback) {
    const value = window.i18n?.t?.(key);
    return value && value !== key ? value : fallback;
}

const els = {};
let options = {};
let rendered = false;
let loading = null;

/**
 * @param {object} opts
 * @param {(btn: HTMLElement) => void} opts.onOpen - card click handler
 * @param {() => void} [opts.onRendered] - after every list update (badges, long-press…)
 */
export function initClassesView(opts) {
    options = opts || {};
    els.list = document.getElementById('classList');
    els.status = document.getElementById('classListStatus');
    els.none = document.getElementById('classListNone');
    els.stale = document.getElementById('classListStale');
}

function sync(classes) {
    const list = els.list;
    if (!list) return;

    if (!rendered) {
        list.querySelectorAll('.tp-skel-item, .sk-error').forEach((n) => n.remove());
        endBusy(list);
        els.status?.remove();
        els.status = null;
    }

    const focused = document.activeElement;
    const wanted = new Set(classes.map((c) => c.id));

    // Remove deleted classes first so surviving cards rarely need to move
    list.querySelectorAll('.newClassBtn[data-class-id]').forEach((btn) => {
        if (!wanted.has(btn.dataset.classId)) btn.closest('li')?.remove();
    });

    const byId = new Map();
    list.querySelectorAll('.newClassBtn[data-class-id]').forEach((btn) => {
        byId.set(btn.dataset.classId, btn.closest('li'));
    });

    classes.forEach((cls, index) => {
        setClassId(cls.name, cls.id);
        let li = byId.get(cls.id);
        if (!li) {
            renderClassItem(cls.name, cls.id, list, options.onOpen, null);
            li = list.lastElementChild;
        } else {
            const btn = li.querySelector('.newClassBtn');
            if (btn && btn.dataset.className !== cls.name) setClassButtonLabel(btn, cls.name);
        }
        const at = list.children[index];
        if (at !== li) list.insertBefore(li, at || null);
    });

    // A moved node loses focus in some browsers: put it back
    if (focused && focused !== document.activeElement && list.contains(focused)) {
        focused.focus({ preventScroll: true });
    }

    saveClassesMap(new Map(classes.map((c) => [c.id, c.name])));
    if (els.none) els.none.hidden = classes.length > 0;
    rendered = true;
    options.onRendered?.();
}

function restoreSkeleton() {
    const list = els.list;
    list.replaceChildren();
    ['46%', '34%', '28%', '52%'].forEach((w) => {
        const li = document.createElement('li');
        li.className = 'tp-skel-item';
        li.setAttribute('aria-hidden', 'true');
        li.innerHTML = `<div class="tp-card tp-card--skeleton"><span class="sk sk-line" style="--sk-w:${w}"></span><span class="sk tp-skel-chevron"></span></div>`;
        list.appendChild(li);
    });
    list.setAttribute('aria-busy', 'true');
    if (!els.status) {
        els.status = document.createElement('p');
        els.status.className = 'sk-status-text';
        els.status.setAttribute('role', 'status');
        els.status.textContent = t('tp_classes_loading', 'Зареждане на дисциплините…');
        list.after(els.status);
    }
}

function onError(error) {
    console.error('Failed to load classes:', error);
    if (error?.status === 401 || /\b401\b/.test(String(error?.message || ''))) {
        document.dispatchEvent(new CustomEvent('app:authexpired'));
        return;
    }
    const retry = () => {
        hideStaleNote(els.stale);
        loadClasses({ force: true });
    };
    if (rendered) {
        showStaleNote(els.stale, retry);
    } else {
        els.status?.remove();
        els.status = null;
        showLoadError(els.list, t('tp_classes_error', 'Неуспешно зареждане на дисциплините.'), retry);
    }
}

/**
 * Show cached classes immediately and refresh when needed.
 * @returns {Promise<void>}
 */
export function loadClasses({ force = false } = {}) {
    if (!rendered) {
        const cached = readCachedClasses();
        if (cached) sync(cached.data);
    }
    const key = classesKey();
    if (!force && rendered && isFresh(readCache(key), CLASSES_MAX_AGE_MS)) return Promise.resolve();
    if (loading && !force) return loading;

    if (!rendered && els.list && !els.list.querySelector('.tp-skel-item')) {
        // Retry after an error: put the skeleton cards back while loading
        restoreSkeleton();
    }

    loading = revalidate(key, async () => normalizeClasses((await fetchClasses()).classes))
        .then(({ data, current }) => {
            if (!current) return;
            hideStaleNote(els.stale);
            sync(data);
        })
        .catch(onError)
        .finally(() => { loading = null; });
    return loading;
}

export function hasRenderedClasses() {
    return rendered;
}
