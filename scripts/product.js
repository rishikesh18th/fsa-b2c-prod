// Resolves a product by its url_key against Catalog Service, for the dynamic
// PDP synthetic route in scripts.js. Production PDP URLs (/{url-key}.html)
// have no backing content document, so the browser 404s and this resolves
// the product client-side, mirroring category.js's approach for categories.
import { getRootPath } from '@dropins/tools/lib/aem/configs.js';
import { CS_FETCH_GRAPHQL } from './commerce.js';

const PRODUCT_BY_URL_KEY_QUERY = `
  query PRODUCT_BY_URL_KEY($urlKey: String!) {
    productSearch(phrase: "", page_size: 1, filter: [{ attribute: "url_key", eq: $urlKey }]) {
      items {
        productView {
          sku
          name
          urlKey
        }
      }
    }
  }
`;

/**
 * Strips any multistore root prefix (e.g. "/us") and a trailing ".html" from
 * a pathname, leaving the bare `url_key`, e.g. "/us/some-product.html" ->
 * "some-product". Returns null for paths that aren't a single ".html"
 * segment (multi-segment paths are handled by the category route instead).
 * @param {string} pathname
 * @returns {string|null}
 */
export function productUrlKeyFromPathname(pathname) {
  let path = pathname;
  try {
    const root = getRootPath().replace(/\/$/, '');
    if (root && path.startsWith(root)) path = path.slice(root.length);
  } catch {
    // no multistore config resolved yet; fall back to the raw pathname
  }
  const match = path.replace(/^\/+/, '').match(/^([^/]+)\.html$/);
  return match ? match[1] : null;
}

/**
 * Resolves a request pathname to a product, by matching its `url_key`
 * against Catalog Service.
 * @param {string} pathname e.g. window.location.pathname
 * @returns {Promise<{sku: string, name: string, urlKey: string}|null>} null
 *   when no product matches (the caller should fall back to its normal 404)
 */
export async function resolveProductRoute(pathname) {
  const urlKey = productUrlKeyFromPathname(pathname);
  if (!urlKey) return null;

  const { data, errors } = await CS_FETCH_GRAPHQL.fetchGraphQl(PRODUCT_BY_URL_KEY_QUERY, {
    method: 'GET',
    variables: { urlKey },
  });
  if (errors?.length) throw new Error(errors[0].message);

  return data?.productSearch?.items?.[0]?.productView || null;
}
