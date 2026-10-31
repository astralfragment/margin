/**
 * Loads the plain JS service worker. It registers its listeners as the module
 * runs, so they exist before Chrome dispatches the event that woke it.
 */
import '../background.js';

export default defineBackground({ type: 'module', main() {} });
