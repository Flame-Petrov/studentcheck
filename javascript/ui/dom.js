/**
 * DOM primitives — the single place UI code builds and clears elements.
 *
 * Every ui/ module builds nodes through el() so element creation is consistent
 * and defined in one spot. Feature/page code does data + i18n + wiring and calls
 * the ui/ builders; it should not call document.createElement directly.
 */

/**
 * Create an element with an optional class and text.
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text] - set as textContent (safe; never parsed as HTML)
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

/**
 * Remove all children of a node. Returns the node.
 * @param {HTMLElement} node
 * @returns {HTMLElement}
 */
export function clear(node) {
    if (node) node.replaceChildren();
    return node;
}

/**
 * Append children (nodes or null/undefined, which are skipped) to a parent.
 * Returns the parent.
 * @param {HTMLElement} parent
 * @param {...(Node|null|undefined)} children
 * @returns {HTMLElement}
 */
export function mount(parent, ...children) {
    for (const child of children) {
        if (child) parent.appendChild(child);
    }
    return parent;
}
