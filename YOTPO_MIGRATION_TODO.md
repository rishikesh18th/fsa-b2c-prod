# Yotpo: dynamic per-product ids (done)

Commerce's `externalId` (from the `pdp/data` payload and each PLP search
result item) now matches Yotpo's own catalog id after the product migration,
so `scripts/yotpo.js` reads it directly instead of any hardcoded/shared id:

- PDP (`renderPdpWidgets`): `data-yotpo-product-id` on the star-summary,
  reviews, and Q&A widgets comes from `product.externalId`.
- PLP (`product-list-page.js` + `getTileYotpoProductId`): each tile's link
  carries `data-yotpo-product-id` from `product.externalId`, read by the
  per-tile star-ratings widget.
- Q&A tab (`product-tabs.js`): `renderQaTabContent(content, product.externalId)`.

## Remaining verification

1. Confirm against Yotpo's public bottomline API
   (`https://api-cdn.yotpo.com/v1/widget/{token}/products/{externalId}/bottomline`)
   for a handful of real products that review counts/scores differ per
   product.
2. Test at least 3 different real PDPs and the PLP to confirm each shows its
   own reviews.
3. Run `npm run lint` and re-verify the Q&A tab, star summary, and
   `/reviews` page (both per-product and site-wide) still work.
