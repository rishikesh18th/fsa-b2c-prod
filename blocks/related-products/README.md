# Related Products Block

## Overview

The Related Products block renders a carousel of the classic per-SKU "Related Products" relation configured in Commerce Admin under Catalog > Products > [product] > Related Products (as opposed to `product-recommendations`, which uses Adobe's ML-driven Recommendations dropin). It queries Catalog Service directly (`ProductView.links(linkTypes: ["related"])`) for the current PDP's SKU, and lets shoppers check individual items — or use "Select All" — to add them to the cart alongside the main product.

## Integration

### Block Configuration

Read via `readBlockConfig()`:

- `heading` - Optional heading text; falls back to the `Global.RelatedProducts` placeholder or "Related Products"
- `currentSku` - Optional SKU to fetch related products for; if omitted, the block waits for the PDP dropin's current SKU

<!-- ### URL Parameters

No URL parameters are used by this block. -->

<!-- ### Local Storage

No localStorage keys are used by this block. -->

### Events

#### Event Listeners

- `events.on('pdp/data', callback)` - Listens for the PDP dropin's product data to resolve the current SKU when `currentSku` is not configured

#### Event Emitters

- `events.emit('related-products/selection', items)` - Emitted whenever the checked selection changes, with an array of `{ sku, quantity }` for every selected item. Consumed by `product-details.js` so its "Add to Cart" button adds the selected related products alongside the current product.

## Behavior Patterns

### Product Eligibility

- Only in-stock `SimpleProductView` items are selectable (checkbox + "Add to Cart" label); these are the only ones the PDP's single Add to Cart button can add directly
- Out-of-stock simple products render a disabled checkbox
- Configurable, bundle, and grouped items render a "Select Options" link to their PDP instead of a checkbox, since they require option selection before they can be added to the cart

### User Interaction Flows

1. **Initialization**: Block resolves the current SKU, fetches related products from Catalog Service, and renders each as a carousel card (image, name, price, and selection control)
2. **Selection**: Users check individual items to stage them for the main "Add to Cart" action; each change re-emits the full selection and updates the "Select All" label
3. **Select All / Unselect All**: A toggle button (shown only when at least one selectable item exists) checks or unchecks every selectable item at once, keeping each checkbox's own instance in sync via `setProps`
4. **Navigation**: Previous/next buttons scroll the carousel track by one card's width (including gap)

### Error Handling

- **No Current SKU**: If the current SKU cannot be resolved, the block removes itself
- **Fetch Errors**: If the Catalog Service query fails, the error is logged and the block removes itself
- **No Related Products**: If the query returns no linked products, the block removes itself
- **No Selectable Items**: If no items are in-stock simple products, the toolbar (label + Select All button) is removed since there is nothing to bulk-select
