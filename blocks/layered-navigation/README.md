# Layered Navigation Block

## Overview

Renders the storefront-product-discovery dropin's `Facets` container (Magento/Adobe Commerce calls this "layered navigation") on its own, so authors can place category/search filters in a page region separate from the Product List Page block's results grid — e.g. a dedicated sidebar column instead of the collapsible drawer built into Product List Page.

## Integration

### Block Configuration

- `heading` - Optional text shown above the filters (e.g. "Filter By"). Omit for no heading.

### Requirements

This block does **not** run its own product search. It renders whatever facets are in the shared search-result state that a Product List Page block's `search()` call already populated — which is also what scopes the filters to the current category (Product List Page filters by `categories: eq: <urlpath>`; see `blocks/product-list-page/product-list-page.js`).

That means a page using this block still needs a Product List Page block somewhere on it (category- or search-scoped). Give that Product List Page block a `hide-facets` value of `true` so it doesn't also render its own inline copy of the same filters.

### Events

#### Event Listeners

- `events.on('search/result', callback)` - Consumed internally by `initFacetsAccordion` (shared with Product List Page) to keep facet-group collapse state and category/selected-filter labels in sync as results change.

## Behavior Patterns

- **Category scoping**: automatic — inherited from whichever `search()` call (normally Product List Page's) populated the current search-result state, not owned by this block.
- **Collapse behavior**: each facet group is collapsible, the first one open by default, matching Product List Page's own filters panel (shared `facets-accordion.js`).
- **Live sync**: filters, results grid, sort, and pagination all read/write the same shared dropin state and URL, regardless of which blocks render which pieces — selecting a filter here updates the results grid rendered by Product List Page, and vice versa.
