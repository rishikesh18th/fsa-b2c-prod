// Shared category graph + URL-path resolution, used both by the Product
// Listing Page block (category-slider.js / breadcrumb.js) and by the dynamic
// category synthetic route in scripts.js. Lives here (rather than inside a
// block) because scripts.js, which is not block-scoped, needs it too.
import { getConfigValue, getRootPath } from '@dropins/tools/lib/aem/configs.js';
import { CS_FETCH_GRAPHQL, rootLink } from './commerce.js';

const TREE_DEPTH = 10;

const MIGRATED_ROOT_SEGMENT = 'default-category-migrated';

/**
 * Some category url_path values authored before/during the Commerce catalog
 * migration carry a leftover internal root-category segment (e.g.
 * "default-category-migrated/shop-by-product") that isn't part of the real
 * Commerce url_path ("shop-by-product") and never matches a category or
 * product. Strips it so authored Product List Page `urlpath` config keeps
 * resolving against Commerce.
 * @param {string} urlPath
 * @returns {string}
 */
export function stripMigratedCategoryPrefix(urlPath) {
  if (!urlPath) return urlPath;
  const segments = urlPath.split('/');
  return segments[0] === MIGRATED_ROOT_SEGMENT ? segments.slice(1).join('/') : urlPath;
}

const segCount = (path) => (path ? path.split('/').filter(Boolean).length : 0);

/**
 * Direct children of `parentPath` (one url_path segment deeper), from a flat
 * category graph (see fetchCategoryGraph). '' means top level.
 * @param {object[]} graph flat CategoryView list
 * @param {string} parentPath
 * @returns {object[]}
 */
export function directChildren(graph, parentPath) {
  const wantDepth = segCount(parentPath) + 1;
  return graph.filter((c) => {
    if (segCount(c.urlPath) !== wantDepth) return false;
    return parentPath === '' ? true : c.urlPath.startsWith(`${parentPath}/`);
  });
}

/**
 * Whether a category node is active (published) in Commerce Admin. The
 * Catalog Service's categoryTree query (see fetchCategoryGraph) only ever
 * returns published categories and exposes no separate "show in menu" flag,
 * so every node it returns is treated as active/menu-eligible.
 * @param {object} node
 * @returns {boolean}
 */
export function isActive(node) {
  return Array.isArray(node.roles) && node.roles.includes('active');
}

/**
 * A category's canonical link — matching the ".html" convention `getProductLink`
 * already uses for PDPs — so links generated for a category (breadcrumb,
 * slider, mega-menu) land on the dynamic category route rather than on an
 * unrelated authored page that happens to live at the same extensionless path.
 * @param {string} urlPath
 * @returns {string}
 */
export function getCategoryLink(urlPath) {
  return rootLink(`/${urlPath}.html`);
}

const VISITED_CATEGORY_STORAGE_KEY = 'visitedCategory';

/** localStorage key, namespaced per store view so multistore setups don't cross-contaminate. */
function visitedCategoryStorageKey() {
  let storeViewCode;
  try {
    storeViewCode = getConfigValue('headers.cs.Magento-Store-View-Code');
  } catch {
    storeViewCode = null;
  }
  return storeViewCode ? `${storeViewCode}:${VISITED_CATEGORY_STORAGE_KEY}` : VISITED_CATEGORY_STORAGE_KEY;
}

/**
 * Remembers the category url_path currently being browsed, so the PDP
 * breadcrumb (blocks/product-details/breadcrumb.js) can show the ancestor
 * chain the shopper actually navigated through — a product can be reachable
 * from more than one category page (Magento anchor categories surface it
 * under every ancestor too), so this can't be derived from the product alone.
 * Best-effort: storage may be unavailable (private browsing, quota, etc).
 * @param {string} urlPath
 */
export function rememberVisitedCategory(urlPath) {
  try {
    window.localStorage.setItem(visitedCategoryStorageKey(), urlPath);
  } catch {
    // best-effort only
  }
}

/**
 * The category url_path last recorded by rememberVisitedCategory, or null —
 * e.g. when the shopper landed on the PDP directly (a pasted, bookmarked, or
 * shared link) rather than by browsing a category.
 * @returns {string|null}
 */
export function getVisitedCategory() {
  try {
    return window.localStorage.getItem(visitedCategoryStorageKey());
  } catch {
    return null;
  }
}

const CATEGORY_TREE_QUERY = `
  query CATEGORY_TREE($slugs: [String!]!, $depth: Int!) {
    categoryTree(slugs: $slugs, depth: $depth) {
      name
      slug
      level
      childrenSlugs
    }
  }
`;

/**
 * Admin-configured display order isn't exposed by this deployment's
 * categoryTree query (no `position` field, and the `navigation` query that
 * does support it requires a "product family" id this project has no way to
 * resolve) — same class of gap as `category-thumbnails` below. `slug`'s
 * fallback order (its index in the parent's `childrenSlugs`) turns out to be
 * category-ID order, not the merchandised order, so config.json
 * `category-menu-order` lets an editor curate the real order per url_path;
 * anything not listed keeps the childrenSlugs-index fallback.
 * @param {string} urlPath
 * @returns {number|null} the configured index, or null if not listed
 */
function configuredMenuPosition(urlPath) {
  let order;
  try {
    order = getConfigValue('category-menu-order');
  } catch {
    order = null;
  }
  if (!Array.isArray(order)) return null;
  const index = order.indexOf(urlPath);
  return index === -1 ? null : index;
}

/**
 * Adapts a CategoryTreeView node (Catalog Service's slug-based tree) to the
 * flat CategoryView shape the PLP slider/breadcrumb/mega-menu/route-resolution
 * expect: `urlPath`/`urlKey` derived from `slug`, `roles` (categoryTree only
 * ever returns published categories, so every node is treated as active), and
 * `position` (see configuredMenuPosition).
 * @param {object} node
 * @param {number} position
 * @returns {object}
 */
function toCategoryView(node, position) {
  return {
    name: node.name,
    urlPath: node.slug,
    urlKey: node.slug.split('/').pop(),
    level: node.level,
    position,
    roles: ['active'],
  };
}

// The subtree for a given top-level category is stable for a session; cache
// the in-flight promise per top-level slug so repeat lookups (PLP slider,
// breadcrumb, mega-menu, dynamic route resolution) for the same top-level
// category reuse a single request.
const graphPromises = new Map();

/**
 * Fetch (once per top-level category, then cached) the full subtree rooted at
 * `urlPath`'s top-level segment, as a flat list of CategoryView nodes —
 * covering the requested category and every descendant, so parent/child url
 * paths of any depth (e.g. "shop-by-product/water-filter") resolve against
 * it.
 * @param {string} urlPath e.g. "shop-by-product" or "shop-by-product/water-filter"
 * @returns {Promise<object[]>}
 */
export async function fetchCategoryGraph(urlPath) {
  const [topSlug] = (urlPath || '').split('/').filter(Boolean);
  if (!topSlug) return [];

  if (!graphPromises.has(topSlug)) {
    const promise = CS_FETCH_GRAPHQL
      .fetchGraphQl(CATEGORY_TREE_QUERY, {
        method: 'GET',
        variables: { slugs: [topSlug], depth: TREE_DEPTH },
      })
      .then(({ data, errors }) => {
        if (errors?.length) throw new Error(errors[0].message);
        const nodes = data?.categoryTree || [];
        const positions = new Map();
        nodes.forEach((node) => {
          (node.childrenSlugs || []).forEach((slug, i) => positions.set(slug, i));
        });
        return nodes.map((node) => {
          const position = configuredMenuPosition(node.slug) ?? positions.get(node.slug) ?? 0;
          return toCategoryView(node, position);
        });
      })
      .catch((e) => {
        graphPromises.delete(topSlug); // allow a later retry
        // eslint-disable-next-line no-console
        console.error('Category graph: failed to load categories', e);
        return [];
      });
    graphPromises.set(topSlug, promise);
  }
  return graphPromises.get(topSlug);
}

/**
 * Strips any multistore root prefix (e.g. "/us"), leading/trailing slashes,
 * and a trailing ".html" suffix from a pathname, leaving the bare Magento
 * `url_path` to resolve against the category graph, e.g.
 * "/us/shop-by-product/water-filter.html" -> "shop-by-product/water-filter".
 * @param {string} pathname
 * @returns {string}
 */
export function categoryPathFromPathname(pathname) {
  let path = pathname;
  try {
    const root = getRootPath().replace(/\/$/, '');
    if (root && path.startsWith(root)) path = path.slice(root.length);
  } catch {
    // no multistore config resolved yet; fall back to the raw pathname
  }
  return path.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
}

/**
 * Resolves a request pathname to a Magento category, matching the complete
 * `url_path` (not just the last slug), so categories that share a `url_key`
 * under different parents are not confused with one another.
 * @param {string} pathname e.g. window.location.pathname
 * @returns {Promise<{category: object, urlPath: string}|null>} null when no
 *   category matches (the caller should fall back to its normal 404 page)
 */
export async function resolveCategoryRoute(pathname) {
  const urlPath = categoryPathFromPathname(pathname);
  if (!urlPath) return null;

  const graph = await fetchCategoryGraph(urlPath);
  const category = graph.find((c) => c.urlPath === urlPath);
  return category ? { category, urlPath } : null;
}
