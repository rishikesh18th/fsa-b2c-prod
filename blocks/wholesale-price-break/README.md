# Wholesale Price Break Block

## Overview

The Wholesale Price Break block renders the current product's native Magento tier prices as a selectable table (Select / Quantity / Discount / Price per piece), replacing the Magecomp Tierprice Luma extension's table for this Edge Delivery Services storefront. Tier price data is not fetched separately — it is already surfaced by Catalog Service as `ProductView.price.tiers` on `SimpleProductView` and flows through the existing `pdp/data` event payload as `prices.tiers`. The block is mounted programmatically by `product-details.js` above the Qty / Add to Cart controls, the same way `related-products` is mounted, and is not authored as a standalone section.

<!-- ## Configuration

No block configuration is read via `readBlockConfig()`. The block is mounted programmatically and reacts to the current product/variant data. -->

## Integration

<!-- ### URL Parameters

No URL parameters are used by this block. -->

<!-- ### Local Storage

No localStorage keys are used by this block. -->

### Events

#### Event Listeners

- `events.on('pdp/data', callback)` - Listens for product/variant data changes (`eager: true`) to read `prices.tiers` and re-render the table, or hide the block when the current product/variant has no tiers

<!-- #### Event Emitters

No events are emitted by this block. -->

### Dropin API Usage

- `pdpApi.setProductConfigurationValues()` - Called when a tier row is selected (or the reset button is clicked) to set the PDP quantity to that tier's threshold quantity (or `1` on reset). This drives the existing `ProductQuantity` stepper and the Add to Cart flow directly, rather than only updating a cosmetic price display.

## Behavior Patterns

### Tier Row Calculation

- **Quantity Range**: Each row's quantity label is derived from the tier's threshold (`gte`) and the next tier's threshold, e.g. `2-4` for a tier followed by one starting at 5, or `5+` for the last tier
- **Discount Percentage**: Calculated as `ceil((1 - tierPrice / regularPrice) * 100)`, matching the reference Magecomp Tierprice extension's calculation
- **Price Formatting**: Uses the tier's own currency via `getPriceFormatter`

### User Interaction Flows

1. **Initialization**: On `pdp/data`, the block checks for `prices.tiers`; if present, it renders the table, otherwise it hides itself
2. **Row Selection**: Clicking a row (or its radio button) selects that tier and sets the PDP quantity to the tier's threshold quantity
3. **Reset**: Clicking the reset icon clears the selected radio and resets the PDP quantity to `1`
4. **Variant Changes**: On configurable products, tiers are only present once a purchasable simple variant is resolved from the selected options; switching variants re-renders or hides the table accordingly

### Error Handling

- **No Tier Prices**: If the current product/variant has no `prices.tiers`, the block hides itself (`block.hidden = true`) rather than rendering an empty table
- **Missing Regular Price**: If no regular/final price is available to compute a discount percentage against, the discount cell is left blank instead of showing an incorrect value
