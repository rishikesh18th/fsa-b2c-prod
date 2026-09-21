// Breadcrumb for the Product Details Page: Home > current category (if any) >
// product name. A product can be reachable from more than one category page
// (Magento anchor categories surface it under every ancestor too), so the
// category chain shown here is only ever the one product-list-page.js
// remembers (via rememberVisitedCategory) as the shopper browses category
// pages. Direct navigation (a pasted, bookmarked, or shared URL) with no
// category browsed yet carries no such context, so the breadcrumb is just
// Home > Product Name.
import buildBreadcrumb from '../../scripts/breadcrumb.js';
import { fetchCategoryGraph, getCategoryLink, getVisitedCategory } from '../../scripts/category.js';
import { resolveCrumbs } from '../product-list-page/breadcrumb.js';

/**
 * Render the breadcrumb into `container` for the given product.
 * Best-effort: never throws; renders nothing if categories can't be resolved.
 * @param {HTMLElement} container element to render into
 * @param {{sku: string, name: string}} product current product
 */
export default async function renderBreadcrumb(container, product) {
  if (!container || !product?.sku) return;

  let ancestors = [];
  const visitedPath = getVisitedCategory();
  if (visitedPath) {
    try {
      const graph = await fetchCategoryGraph(visitedPath);
      if (graph.some((c) => c.urlPath === visitedPath)) {
        ancestors = resolveCrumbs(graph, visitedPath);
      }
    } catch {
      ancestors = [];
    }
  }

  const crumbs = ancestors.map((category) => ({
    label: category.name,
    href: getCategoryLink(category.urlPath),
  }));
  crumbs.push({ label: product.name });

  container.append(buildBreadcrumb(crumbs));
}
