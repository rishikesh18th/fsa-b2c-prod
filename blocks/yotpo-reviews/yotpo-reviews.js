/*
 * Yotpo Reviews Block
 * With no `productid` row configured: a store-wide "all reviews" page (every
 * product, paginated "Load more") matching the live Magento /reviews page.
 * With a `productid` row set: every review for that one product on a single
 * page (no pagination) instead.
 */
import { readBlockConfig } from '../../scripts/aem.js';
import { renderAllReviews, renderSiteReviews } from '../../scripts/yotpo.js';

export default function decorate(block) {
  const { productid } = readBlockConfig(block);
  block.textContent = '';

  const container = document.createElement('div');
  container.className = 'yotpo-reviews__widget';
  block.append(container);

  if (productid) renderAllReviews(container, productid);
  else renderSiteReviews(container);
}
