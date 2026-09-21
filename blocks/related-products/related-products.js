// Related Products carousel for the PDP.
//
// Unlike `product-recommendations` (Adobe's ML-driven Recommendations dropin,
// keyed by a `recId` unit), this block renders the classic per-SKU "Related
// Products" relation configured in Commerce Admin under Catalog > Products >
// [product] > Related Products. The Catalog Service schema surfaces that
// relation via `ProductView.links(linkTypes: ["related"])`, so this queries
// Catalog Service (CS_FETCH_GRAPHQL) directly rather than using a dropin
// container.
//
// Each card has an "Add to Cart" checkbox (default unchecked). Configurable,
// bundle, and grouped items are excluded from selection because they need
// option choices before they can be added to the cart.
// "Select All" / "Unselect All" toggles every checkbox at once. Checked items
// are broadcast on the `related-products/selection` event so the main PDP
// "Add to Cart" button (product-details.js) adds them alongside the current
// product.
import { getPriceFormatter } from '@dropins/tools/lib.js';
import {
  Checkbox, provider as UI,
} from '@dropins/tools/components.js';
import { events } from '@dropins/tools/event-bus.js';

import { readBlockConfig } from '../../scripts/aem.js';
import {
  CS_FETCH_GRAPHQL,
  fetchPlaceholders,
  getProductLink,
} from '../../scripts/commerce.js';

const RELATED_PRODUCTS_QUERY = `
  query RELATED_PRODUCTS($skus: [String!]!) {
    products(skus: $skus) {
      sku
      links(linkTypes: ["related"]) {
        product {
          __typename
          sku
          name
          urlKey
          images(roles: ["small_image"]) { url }
          ... on SimpleProductView {
            inStock
            price { final { amount { value currency } } }
          }
          ... on ComplexProductView {
            priceRange { minimum { final { amount { value currency } } } }
          }
        }
      }
    }
  }
`;

async function fetchRelatedProducts(sku) {
  const { data, errors } = await CS_FETCH_GRAPHQL.fetchGraphQl(RELATED_PRODUCTS_QUERY, {
    method: 'GET',
    variables: { skus: [sku] },
  });
  if (errors?.length) throw new Error(errors[0].message);
  return (data?.products?.[0]?.links || []).map((link) => link.product).filter(Boolean);
}

/** Resolves the current product SKU, waiting for the PDP dropin if needed. */
function getCurrentSku(configuredSku) {
  if (configuredSku) return Promise.resolve(configuredSku);

  const existing = events.lastPayload('pdp/data');
  if (existing?.sku) return Promise.resolve(existing.sku);

  return new Promise((resolve) => {
    const subscription = events.on('pdp/data', (data) => {
      if (data?.sku) {
        subscription?.off();
        resolve(data.sku);
      }
    }, { eager: true });
  });
}

/** Distance (px) between a card and its neighbour, including the gap. */
function cardStep(track) {
  const card = track.querySelector('.related-products__item');
  const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 16;
  return card ? card.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
}

export default async function decorate(block) {
  const labels = await fetchPlaceholders();
  const { currentsku: configuredSku, heading } = readBlockConfig(block);

  // Hide the authored configuration rows.
  [...block.children].forEach((child) => {
    child.style.display = 'none';
  });

  const fragment = document.createRange().createContextualFragment(`
    <div class="related-products__wrapper">
      <h2 class="related-products__heading"></h2>
      <div class="related-products__toolbar">
        <span class="related-products__toolbar-label"></span>
        <div class="related-products__toolbar-toggle"></div>
      </div>
      <div class="related-products__carousel">
        <button type="button" class="related-products__nav related-products__nav--prev"></button>
        <ul class="related-products__track"></ul>
        <button type="button" class="related-products__nav related-products__nav--next"></button>
      </div>
    </div>
  `);

  const $toolbar = fragment.querySelector('.related-products__toolbar');
  const $heading = fragment.querySelector('.related-products__heading');
  const $toolbarLabel = fragment.querySelector('.related-products__toolbar-label');
  const $toggle = fragment.querySelector('.related-products__toolbar-toggle');
  const $track = fragment.querySelector('.related-products__track');
  const $prev = fragment.querySelector('.related-products__nav--prev');
  const $next = fragment.querySelector('.related-products__nav--next');

  $heading.textContent = heading || labels.Global?.RelatedProducts || 'Related Products';
  $toolbarLabel.textContent = labels.Global?.SelectItemsToAddToCart
    || 'Check items to add to the cart or';
  $prev.setAttribute('aria-label', labels.Global?.PreviousProducts || 'Previous products');
  $next.setAttribute('aria-label', labels.Global?.NextProducts || 'Next products');

  const sku = await getCurrentSku(configuredSku);
  if (!sku) {
    block.remove();
    return;
  }

  let items;
  try {
    items = await fetchRelatedProducts(sku);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Related products: failed to load', error);
    block.remove();
    return;
  }
  if (!items.length) {
    block.remove();
    return;
  }

  block.appendChild(fragment);

  const itemsBySku = new Map();
  const checkboxInstances = new Map();
  const selectedItems = new Map();
  let selectAllButton = null;

  function emitSelection() {
    events.emit(
      'related-products/selection',
      Array.from(selectedItems.values()).map((item) => ({ sku: item.sku, quantity: 1 })),
    );
  }

  function updateSelectAllLabel() {
    if (!selectAllButton) return;
    const allSelected = itemsBySku.size > 0 && selectedItems.size === itemsBySku.size;
    selectAllButton.textContent = allSelected
      ? (labels.Global?.UnselectAllRelatedProducts || 'Unselect All')
      : (labels.Global?.SelectAllRelatedProducts || 'Select All');
  }

  function setItemSelected(item, checked) {
    if (checked) {
      selectedItems.set(item.sku, item);
    } else {
      selectedItems.delete(item.sku);
    }
    emitSelection();
    updateSelectAllLabel();
  }

  function toggleSelectAll() {
    const shouldSelectAll = selectedItems.size !== itemsBySku.size;
    itemsBySku.forEach((item, itemSku) => {
      if (shouldSelectAll) {
        selectedItems.set(itemSku, item);
      } else {
        selectedItems.delete(itemSku);
      }
      checkboxInstances.get(itemSku)?.setProps((prev) => ({ ...prev, checked: shouldSelectAll }));
    });
    emitSelection();
    updateSelectAllLabel();
  }

  async function buildCard(item) {
    const isSimple = item.__typename === 'SimpleProductView';
    const inStock = isSimple && item.inStock !== false;
    // Only in-stock simple products can be added by the PDP's single Add to
    // Cart button. Other product types keep a link for choosing options.
    if (inStock) itemsBySku.set(item.sku, item);

    const li = document.createElement('li');
    li.className = 'related-products__item';

    const link = document.createElement('a');
    link.className = 'related-products__link';
    link.href = getProductLink(item.urlKey, item.sku);

    const media = document.createElement('span');
    media.className = 'related-products__media';
    const imageUrl = item.images?.[0]?.url;
    if (imageUrl) {
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = item.name || '';
      img.loading = 'lazy';
      media.appendChild(img);
    }

    const name = document.createElement('span');
    name.className = 'related-products__name';
    name.textContent = item.name;

    const price = document.createElement('span');
    price.className = 'related-products__price';
    const finalPrice = isSimple
      ? item.price?.final?.amount
      : item.priceRange?.minimum?.final?.amount;
    if (finalPrice?.value != null) {
      const formatter = getPriceFormatter({ currency: finalPrice.currency });
      price.textContent = formatter.format(finalPrice.value);
    }

    // The price sits outside the anchor so only the image and name are linked.
    link.append(media, name);

    const footer = document.createElement('div');
    footer.className = 'related-products__footer';
    if (isSimple) {
      const checkboxInstance = await UI.render(Checkbox, {
        name: `related-product-select-${item.sku}`,
        label: labels.Global?.AddProductToCart || 'Add to Cart',
        disabled: !inStock,
        checked: false,
        'aria-label': `${labels.Global?.SelectRelatedProduct || 'Select'} ${item.name}`,
        onChange: (event) => setItemSelected(item, event.target.checked),
      })(footer);
      if (inStock) checkboxInstances.set(item.sku, checkboxInstance);
    } else {
      const optionsLink = document.createElement('a');
      optionsLink.href = link.href;
      optionsLink.textContent = labels.Global?.SelectProductOptions || 'Select Options';
      footer.append(optionsLink);
    }

    li.append(link, price, footer);
    return li;
  }

  const cards = await Promise.all(items.map((item) => buildCard(item)));
  cards.forEach((li) => $track.append(li));

  if (itemsBySku.size > 0) {
    selectAllButton = document.createElement('button');
    selectAllButton.type = 'button';
    selectAllButton.className = 'related-products__select-all';
    selectAllButton.addEventListener('click', toggleSelectAll);
    $toggle.append(selectAllButton);
    updateSelectAllLabel();
  } else {
    $toolbar.remove();
  }

  $prev.addEventListener('click', () => {
    $track.scrollBy({ left: -cardStep($track), behavior: 'smooth' });
  });
  $next.addEventListener('click', () => {
    $track.scrollBy({ left: cardStep($track), behavior: 'smooth' });
  });
}
