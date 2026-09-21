// Breadcrumb for the Product Listing Page: Home > ancestor categories > current
// category, built from the category graph (same source as the category slider).
import buildBreadcrumb from '../../scripts/breadcrumb.js';
import { fetchCategoryGraph, getCategoryLink } from '../../scripts/category.js';

/**
 * Ancestor-to-current chain of categories for `urlPath`, derived by matching
 * each leading path segment against the category graph.
 * @param {object[]} graph flat CategoryView list
 * @param {string} urlPath current category url path, e.g. "shop-by-product/water-filter-systems"
 * @returns {object[]} categories in ancestor -> current order (missing segments are skipped)
 */
export function resolveCrumbs(graph, urlPath) {
  const segments = urlPath.split('/').filter(Boolean);
  const crumbs = [];
  let path = '';
  segments.forEach((segment) => {
    path = path ? `${path}/${segment}` : segment;
    const category = graph.find((c) => c.urlPath === path);
    if (category) crumbs.push(category);
  });
  return crumbs;
}

/**
 * Render the breadcrumb into `container` for the given category url path.
 * No-op (renders nothing) when there is no url path or no matching categories.
 * Best-effort: never throws.
 * @param {HTMLElement} container element to render into
 * @param {string} urlPath current category url path (PLP config.urlpath)
 */
export default async function renderBreadcrumb(container, urlPath) {
  if (!container || !urlPath) return;

  let crumbs;
  try {
    const graph = await fetchCategoryGraph(urlPath);
    crumbs = resolveCrumbs(graph, urlPath);
  } catch {
    return;
  }
  if (!crumbs.length) return;

  container.append(buildBreadcrumb(crumbs.map((category, index) => ({
    label: category.name,
    href: index === crumbs.length - 1 ? null : getCategoryLink(category.urlPath),
  }))));
}
