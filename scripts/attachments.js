// Shared helper for the Product Attachments App Builder app.
//
// The app exposes a public delivery endpoint that lists a product's active
// (enabled) attachments by SKU, each with a short-lived signed download URL.
// Used by the PDP "Instructions & Brochure" tab, so the fetch lives here.
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

// Public delivery endpoint of the Product Attachments app. Configurable via
// `attachments-endpoint` in config.json; falls back to the Stage workspace.
const ATTACHMENTS_RENDER_FALLBACK = 'https://4260392-638blushhorse-stage.adobeio-static.net/api/v1/web/attachments/render';

function getAttachmentsRenderEndpoint() {
  try {
    return getConfigValue('attachments-endpoint') || ATTACHMENTS_RENDER_FALLBACK;
  } catch (e) {
    return ATTACHMENTS_RENDER_FALLBACK;
  }
}

// Fetch a product's attachments by SKU. Returns [] on any failure so the
// caller simply skips the tab. Cached per SKU for the session.
const attachmentsCache = new Map();
export async function fetchAttachments(sku) {
  if (!sku) return [];
  if (attachmentsCache.has(sku)) return attachmentsCache.get(sku);
  const promise = fetch(`${getAttachmentsRenderEndpoint()}?sku=${encodeURIComponent(sku)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => (json?.success && Array.isArray(json?.data?.items) ? json.data.items : []))
    .catch(() => []);
  attachmentsCache.set(sku, promise);
  return promise;
}
