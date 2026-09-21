// Shared helper for the CMS Block Builder app.
//
// The app exposes a public delivery endpoint that renders a Magento CMS block
// to HTML by identifier. It's used across the site (PDP tabs, PDP
// customer-service badges, header-top bar, ...), so the fetch lives here.
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

// Public delivery endpoint of the CMS Block Builder app. Configurable via
// `cms-render-endpoint` in config.json; falls back to the Stage workspace.
const CMS_RENDER_FALLBACK = 'https://4260392-697tanloon-stage.adobeio-static.net/api/v1/web/cms/render';

function getCmsRenderEndpoint() {
  try {
    return getConfigValue('cms-render-endpoint') || CMS_RENDER_FALLBACK;
  } catch (e) {
    return CMS_RENDER_FALLBACK;
  }
}

// Fetch a CMS block's rendered HTML by identifier. Returns '' on any failure so
// the caller simply skips it. Cached per identifier for the session.
const cmsCache = new Map();
export async function fetchCmsBlock(identifier) {
  if (!identifier) return '';
  if (cmsCache.has(identifier)) return cmsCache.get(identifier);
  const promise = fetch(`${getCmsRenderEndpoint()}?identifier=${encodeURIComponent(identifier)}`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => (json && json.data && json.data.content) || '')
    .catch(() => '');
  cmsCache.set(identifier, promise);
  return promise;
}
