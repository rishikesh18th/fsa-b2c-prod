// Wholesale Price Break table for the PDP.
//
// Renders the product's native Magento tier prices (surfaced by Catalog
// Service as `ProductView.price.tiers` on SimpleProductView, and exposed on
// the `pdp/data` event payload as `prices.tiers`) as a selectable table, so
// shoppers can see the bulk-discount quantity thresholds at a glance.
// Selecting a row sets the PDP quantity via `setProductConfigurationValues`,
// which drives the existing quantity stepper and Add to Cart flow with the
// tier's threshold quantity.
//
// Tiers are only present on SimpleProductView, so for configurable products
// the table only appears once a purchasable variant (with its own tiers) is
// resolved from the selected options.
import { getPriceFormatter } from '@dropins/tools/lib.js';
import { events } from '@dropins/tools/event-bus.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';

import { fetchPlaceholders } from '../../scripts/commerce.js';

const RESET_ICON = `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z"/>
  </svg>
`;

/** Quantity range rows, e.g. [{ quantity: 2, tier }, { quantity: 3, tier }] -> ["2-2", "3+"]. */
function qtyLabel(tiers, index) {
  const next = tiers[index + 1];
  return next ? `${tiers[index].quantity}-${next.quantity - 1}` : `${tiers[index].quantity}+`;
}

export default async function decorate(block) {
  const labels = await fetchPlaceholders();

  const fragment = document.createRange().createContextualFragment(`
    <div class="wholesale-price-break__header">
      <span class="wholesale-price-break__title"></span>
      <button type="button" class="wholesale-price-break__reset">${RESET_ICON}</button>
    </div>
    <table class="wholesale-price-break__table">
      <thead>
        <tr>
          <th scope="col"></th>
          <th scope="col"></th>
          <th scope="col"></th>
          <th scope="col"></th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `);

  const $title = fragment.querySelector('.wholesale-price-break__title');
  const $reset = fragment.querySelector('.wholesale-price-break__reset');
  const $headerCells = fragment.querySelectorAll('th');
  const $body = fragment.querySelector('tbody');

  $title.textContent = labels.Global?.WholesalePriceBreak || 'Wholesale Price Break';
  $reset.setAttribute('aria-label', labels.Global?.ResetPriceSelection || 'Reset selection');
  [
    labels.Global?.Select || 'Select',
    labels.Global?.Quantity || 'Quantity',
    labels.Global?.Discount || 'Discount',
    labels.Global?.PricePerPiece || 'Price per piece',
  ].forEach((text, index) => { $headerCells[index].textContent = text; });

  block.append(fragment);

  function resetSelection() {
    $body.querySelectorAll('input[type="radio"]').forEach((radio) => { radio.checked = false; });
    pdpApi.setProductConfigurationValues((prev) => ({ ...prev, quantity: 1 }));
  }

  $reset.addEventListener('click', resetSelection);

  function renderRows(tiers, regularAmount, currency) {
    $body.replaceChildren();
    const formatter = getPriceFormatter({ currency });

    tiers.forEach((tier, index) => {
      const inputId = `wholesale-price-break-qty-${index}`;
      const discount = regularAmount
        ? Math.ceil((1 - tier.tier.amount / regularAmount) * 100)
        : null;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="radio" name="wholesale-price-break-qty" id="${inputId}"></td>
        <td><label for="${inputId}">${qtyLabel(tiers, index)}</label></td>
        <td>${discount != null ? `${discount}%` : ''}</td>
        <td>${formatter.format(tier.tier.amount)}</td>
      `;

      const radio = tr.querySelector('input');
      radio.addEventListener('change', () => {
        pdpApi.setProductConfigurationValues((prev) => ({ ...prev, quantity: tier.quantity }));
      });
      // Clicking anywhere in the row selects it, not just the radio itself.
      tr.addEventListener('click', (event) => {
        if (event.target !== radio) radio.click();
      });

      $body.append(tr);
    });
  }

  events.on('pdp/data', (data) => {
    const tiers = data?.prices?.tiers;
    block.hidden = !tiers?.length;
    if (!tiers?.length) return;

    const regularAmount = data.prices.regular?.amount ?? data.prices.final?.amount;
    const { currency } = data.prices.final ?? {};
    renderRows(tiers, regularAmount, currency);
  }, { eager: true });
}
