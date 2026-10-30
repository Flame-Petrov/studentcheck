/**
 * UI layer — the single import surface for all UI building blocks.
 *
 * Feature and page code imports what it needs from here:
 *     import { el, progressBar, showOverlay } from '../ui/index.js';
 *
 * Everything the app renders lives under ui/ and is re-exported here, so the
 * look and structure of the whole app can be found and changed in one place.
 */

export * from './dom.js';
export * from './studentUI.js';
export * from './toast.js';
export * from './overlays.js';
export * from './classUI.js';
export * from './attendanceUI.js';
