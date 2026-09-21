# Testimonials Block

## Overview

The Testimonials block renders approved customer testimonials on the storefront. Testimonials are managed in the Adobe Commerce Admin by the **Eighteentech_Testimonial** App Builder app and fetched at runtime from that app's `testimonial/list` web action — there is no build step and no server-side rendering. Each testimonial is shown as an optional round image, an optional title, the testimonial text (authored HTML), and the author (optionally with a customer/company name).

This block reproduces the storefront side of the legacy Magento 2 module `Eighteentech_Testimonial`.

## Integration

### Block Configuration

Configuration is read with `readBlockConfig()`. All keys are optional:

| Key | Description | Default |
|-----|-------------|---------|
| `endpoint` | Base URL of the testimonial web action (e.g. `https://<ns>.adobeioruntime.net/api/v1/web/testimonial`). Overrides the global config value per block instance. | — |
| `per-page` (or `perpage`) | Max number of testimonials to request (`perPage` query param). | unset (server default) |

Example authored block:

```
| Testimonials |
| endpoint | https://<ns>.adobeioruntime.net/api/v1/web/testimonial |
| per-page | 50 |
```

### Configuration Source Precedence

The API base URL is resolved in this order:

1. Authored block config `endpoint` (above).
2. `config.json` → `public.default.testimonials-endpoint` via `getConfigValue('testimonials-endpoint')`.

If neither is set, the block renders an error message and logs to the console (see Error Handling).

### API Request

- `GET {endpoint}/list?approve=1[&perPage=N]`
- `approve=1` is always sent so only **approved** testimonials are shown on the storefront.
- Expected response shape: `{ testimonials: [ { image, title, text, description, author, customer } , ... ] }`.

### Image Handling

- `record.image` may be an absolute URL (`http(s)://…`), used as-is.
- Otherwise it is treated as an App Builder Files path and requested through the app's image action: `{endpoint}/image-get?path=<encoded path>`.
- API-served images are rendered with a plain `<img>` (not AEM-optimized assets), lazy-loaded, `decoding="async"`, with fixed 100×100 intrinsic dimensions to avoid layout shift.

<!-- ### URL Parameters

No URL parameters are read by this block. -->

<!-- ### Local Storage

No localStorage keys are used by this block. -->

<!-- ### Events

No events are emitted or listened to by this block. -->

## Behavior Patterns

### Rendering Flow

1. Read block config and resolve the endpoint.
2. Clear the block’s authoring markup.
3. Fetch approved testimonials from `{endpoint}/list`.
4. Build all rows in a `DocumentFragment` and attach the list in a single DOM insertion (avoids repeated layout thrashing).

### Markup

- Each testimonial is a `<li class="testimonials-item">` inside `<ul class="testimonials-list">`.
- Semantic elements are used for accessibility/SEO: `<figure>` for the image, `<blockquote>` for the testimonial text, `<cite>` for the author.
- Author line is rendered as `Author` or `Author, Customer` when a customer/company is present.

### States

- **Loading / success**: renders the list of testimonials.
- **Empty**: if the API returns no testimonials, shows `No testimonials yet. Check back soon!`.
- **Error / not configured**: shows `Testimonials are temporarily unavailable.`

### Content / Security Note

The testimonial `text` (long description) is authored HTML from the trusted Commerce Admin and is injected via `innerHTML`, matching the legacy storefront behavior. If untrusted authors ever gain access, sanitize the value before rendering.

## Error Handling

- **No endpoint configured**: logs `testimonials: no endpoint configured (config.json -> testimonials-endpoint)` and renders the unavailable message.
- **Non-OK HTTP response**: throws `Request failed: <status>`, caught below.
- **Fetch/parse failure**: logs `testimonials: failed to load` with the error and renders the unavailable message.

## Styling

- Scoped under `.testimonials`.
- Mobile-first: single-column card layout; at `min-width: 600px` the image sits beside the text (legacy storefront layout).
- Uses design tokens (spacing, color, typography, shape) with hardcoded fallbacks.
- `body:has(.testimonials)` sets `min-height: 100vh` so the sticky footer stays at the bottom on this short, code-owned page.
