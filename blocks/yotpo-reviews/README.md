# Yotpo Reviews Block

## Overview

The Yotpo Reviews block renders a standalone reviews page backed by Yotpo. With no configuration it shows Yotpo's native "Testimonials" (site-reviews-tab) widget — a store-wide, paginated reviews feed matching the live Magento `/reviews` page (helpful-vote buttons, social share, "Write a review", native pagination). With a `productid` row configured, it instead renders every review for that single product on one page (custom-built list, no pagination), fetched directly from Yotpo's public v3 storefront reviews API.

## Integration

### Block Configuration

- `productid` - Yotpo product id. When set, the block fetches and renders all reviews for that product (via `renderAllReviews`). When omitted, the block renders the site-wide Testimonials widget (via `renderSiteReviews`).

### Integration Details

- Depends on `scripts/yotpo.js` for all rendering, fetching, and widget-loader logic; the block itself only reads its config and picks which renderer to call.
- Per-product mode (`renderAllReviews`) calls Yotpo's public bottomline and v3 storefront reviews APIs directly (CORS-open, no domain restriction) rather than embedding Yotpo's own widget, and paginates through all result pages itself (capped at `REVIEWS_MAX_PAGES` pages of `REVIEWS_PAGE_SIZE` reviews each) so the entire product's reviews render on one page with no "load more".
- Site-wide mode (`renderSiteReviews`) loads Yotpo's legacy `widget.js` loader (separate from the v2 loader used elsewhere on the site) and injects an `aggregateRating` JSON-LD script for SEO, sourced from the site-level `yotpo_site_reviews` bottomline endpoint.
- Both the Yotpo loader token and the reviews widget instance id are read from `config.json`'s `yotpo` block (`getYotpoConfig`), falling back to defaults in `scripts/yotpo.js` if not configured.

## Behavior Patterns

- **No `productid`**: renders the native Testimonials widget inline (its floating-tab/modal presentation is overridden via CSS to render in-flow instead of as a popup), matching the live site's `/reviews` page.
- **`productid` set**: renders a custom summary (average score + total review count) followed by a list of review cards (rating, title, content, author, verified-buyer badge, date), with an empty-state message if the product has no reviews.
- Best-effort throughout: failed API calls (bottomline or any reviews page) degrade gracefully — a failed page contributes no reviews rather than failing the whole render, and a failed bottomline fetch just omits the summary/empty-state messaging.

### Error Handling

- Network failures on any Yotpo API call are caught and treated as "no data" rather than surfacing an error to the user.
- The block only clears and appends content after data has resolved (or failed), so no partial/flashing UI.
