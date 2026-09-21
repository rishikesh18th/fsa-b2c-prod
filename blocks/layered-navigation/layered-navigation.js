// Product Discovery Dropin
import Facets from '@dropins/storefront-product-discovery/containers/Facets.js';
import { render as provider } from '@dropins/storefront-product-discovery/render.js';

import initFacetsAccordion from '../product-list-page/facets-accordion.js';

// AEM
import { readBlockConfig } from '../../scripts/aem.js';

// Initializer (idempotent if the Product List Page block on the same page
// already imported it)
import '../../scripts/initializers/search.js';

/**
 * Layered Navigation block.
 *
 * Mounts the storefront-product-discovery Facets container on its own, so
 * authors can place filters in a page region separate from the Product List
 * Page block's results grid (e.g. a sidebar column, above the fold, ...).
 *
 * This block doesn't run its own search — Facets reads the same shared
 * search-result state that a Product List Page block's search() call already
 * populates (see product-list-page.js), filtered to whatever category/query
 * that call scoped it to. That means this block only does anything useful
 * alongside a Product List Page block on the same page; give that block a
 * "Hide Facets" value so it doesn't also render its own inline copy.
 * @param {Element} block The layered-navigation block element
 */
export default async function decorate(block) {
  const { heading } = readBlockConfig(block);

  block.innerHTML = '';
  if (heading) {
    const $heading = document.createElement('h3');
    $heading.className = 'layered-navigation__heading';
    $heading.textContent = heading;
    block.append($heading);
  }

  const $facets = document.createElement('div');
  block.append($facets);

  await provider.render(Facets, {})($facets);
  initFacetsAccordion($facets);
}
