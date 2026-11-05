/**
 * The React overlay. wxt.config.ts builds it as an ES module beside the pages, so it shares their chunks, and
 * content.js imports it on demand. It is listed as a web-accessible resource for that import.
 */
import '@/overlay/main';

export default defineUnlistedScript(() => {});
