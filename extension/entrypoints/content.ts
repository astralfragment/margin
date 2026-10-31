/**
 * The on-page overlay. The background injects it on demand as content.js, so
 * wxt.config.ts builds it as an unlisted script instead of declaring it in the
 * manifest.
 */
import '../content.js';

export default defineUnlistedScript(() => {});
