/**
 * Overlay Management Module
 * 
 * Handles overlay DOM element management (show/hide/visibility).
 * Provides utilities for overlay operations.
 */

// Cache of overlay elements
const overlayCache = new Map();

/**
 * Get overlay element by ID, with caching
 * @param {string} id - Overlay element ID
 * @returns {HTMLElement|null} Overlay element or null
 */
export function getOverlay(id) {
    if (overlayCache.has(id)) {
        return overlayCache.get(id);
    }
    const element = document.getElementById(id);
    if (element) {
        overlayCache.set(id, element);
    }
    return element;
}

/**
 * Show an overlay (set visibility to visible)
 * @param {HTMLElement|string} overlay - Overlay element or ID
 * @param {boolean} hideBodyOverflow - Whether to hide body overflow (default: true)
 */
export function showOverlay(overlay, hideBodyOverflow = true) {
    const element = typeof overlay === 'string' ? getOverlay(overlay) : overlay;
    if (element) {
        element.style.visibility = 'visible';
        if (hideBodyOverflow) {
            document.body.style.overflow = 'hidden';
        }
    }
}

/**
 * Hide an overlay (set visibility to hidden)
 * @param {HTMLElement|string} overlay - Overlay element or ID
 * @param {boolean} restoreBodyOverflow - Whether to restore body overflow (default: true)
 */
export function hideOverlay(overlay, restoreBodyOverflow = true) {
    const element = typeof overlay === 'string' ? getOverlay(overlay) : overlay;
    if (element) {
        element.style.visibility = 'hidden';
        if (restoreBodyOverflow) {
            document.body.style.overflow = '';
        }
    }
}

/**
 * Check if overlay is visible
 * @param {HTMLElement|string} overlay - Overlay element or ID
 * @returns {boolean} True if visible
 */
export function isOverlayVisible(overlay) {
    const element = typeof overlay === 'string' ? getOverlay(overlay) : overlay;
    if (!element) return false;
    return element.style.visibility === 'visible';
}

/**
 * Ensure overlay exists, create if missing
 * @param {string} id - Overlay element ID
 * @param {Function} createFn - Function to create overlay if missing
 * @returns {HTMLElement} Overlay element
 */
export function ensureOverlay(id, createFn) {
    let element = getOverlay(id);
    if (!element && createFn) {
        element = createFn();
        if (element) {
            overlayCache.set(id, element);
        }
    }
    return element;
}

/**
 * Reusable confirmation overlay
 */
let confirmOverlay = null;

/**
 * Ensure confirmation overlay exists
 * @returns {HTMLElement} Confirmation overlay element
 */
export function ensureConfirmOverlay() {
    if (confirmOverlay) return confirmOverlay;
    confirmOverlay = document.createElement('div');
    confirmOverlay.id = 'confirmOverlay';
    confirmOverlay.className = 'overlay';
    confirmOverlay.style.visibility = 'hidden';
    confirmOverlay.innerHTML = `
        <div class="confirm-popup" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
            <h3 id="confirmTitle" class="confirm-title">Confirm</h3>
            <p id="confirmMessage" class="confirm-message"></p>
            <div class="confirm-actions">
                <button type="button" id="confirmCancelBtn" class="role-button">Cancel</button>
                <button type="button" id="confirmOkBtn" class="role-button danger">Confirm</button>
            </div>
        </div>`;
    document.body.appendChild(confirmOverlay);
    return confirmOverlay;
}

/**
 * Open confirmation overlay
 * @param {string} message - Confirmation message
 * @param {Function} onConfirm - Callback on confirm
 * @param {Function} onCancel - Callback on cancel
 */
export function openConfirmOverlay(message, onConfirm, onCancel, options = {}) {
    options = options || {};
    ensureConfirmOverlay();
    const popupEl = confirmOverlay.querySelector('.confirm-popup');
    if (popupEl) {
        if (popupEl.dataset.dynamicPopupClass) {
            popupEl.classList.remove(popupEl.dataset.dynamicPopupClass);
            delete popupEl.dataset.dynamicPopupClass;
        }
        if (options.popupClass) {
            popupEl.classList.add(options.popupClass);
            popupEl.dataset.dynamicPopupClass = options.popupClass;
        }
    }
    const msgEl = confirmOverlay.querySelector('#confirmMessage');
    if (msgEl) msgEl.textContent = message || 'Are you sure?';
    const titleEl = confirmOverlay.querySelector('#confirmTitle');
    if (titleEl) {
        titleEl.textContent = options.title !== undefined ? options.title : 'Confirm';
    }
    const cancelBtn = confirmOverlay.querySelector('#confirmCancelBtn');
    const okBtn = confirmOverlay.querySelector('#confirmOkBtn');
    const cleanup = () => {
        cancelBtn?.replaceWith(cancelBtn.cloneNode(true));
        okBtn?.replaceWith(okBtn.cloneNode(true));
    };
    // Re-query after cloning
    let newCancel = null, newOk = null;
    const wire = () => {
        newCancel = confirmOverlay.querySelector('#confirmCancelBtn');
        newOk = confirmOverlay.querySelector('#confirmOkBtn');
        if (newCancel) {
            const hideCancel = options.hideCancel === true;
            newCancel.style.display = hideCancel ? 'none' : '';
            if (options.cancelText !== undefined) {
                newCancel.textContent = options.cancelText;
            }
        }
        if (newOk) {
            if (options.okText !== undefined) {
                newOk.textContent = options.okText;
            }
            if (options.okClass) {
                newOk.className = `role-button ${options.okClass}`;
            }
        }
        newCancel?.addEventListener('click', () => {
            closeConfirmOverlay();
            if (onCancel) {
                try {
                    onCancel();
                } catch (e) {
                    console.error('[Confirm Overlay] Cancel callback error:', e);
                }
            }
        });
        newOk?.addEventListener('click', async () => {
            closeConfirmOverlay();
            if (onConfirm) {
                try {
                    // Await async callbacks to prevent unhandled promise rejections
                    const result = onConfirm();
                    if (result && typeof result.then === 'function') {
                        await result;
                    }
                } catch (e) {
                    // Log error but ensure overlay closes
                    console.error('[Confirm Overlay] Confirm callback error:', e);
                    // Error is logged; overlay already closed, UI remains responsive
                }
            }
        });
    };
    cleanup();
    wire();
    confirmOverlay.style.visibility = 'visible';
    // Prevent backdrop click from propagating; treat as cancel
    confirmOverlay.addEventListener('click', (e) => {
        if (e.target === confirmOverlay) {
            closeConfirmOverlay();
            if (onCancel) onCancel();
        }
    }, { once: true });
}

/**
 * Close confirmation overlay
 */
export function closeConfirmOverlay() {
    if (confirmOverlay) confirmOverlay.style.visibility = 'hidden';
}
