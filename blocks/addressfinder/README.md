# Address Finder Block

## Overview

Loads the [AddressFinder](https://addressfinder.io/) address autocomplete widget
and binds it to address input fields. All behaviour is driven by the public
AddressFinder GraphQL endpoint (backed by the App Builder configuration), so the
storefront never reads any settings directly.

The widget follows the customer's **shipping country**: whenever the country
changes the config is re-queried and the widget is re-initialised — or torn down
when that country isn't enabled under Search Restrictions.

## Integration

### Block Configuration

Authored as key/value rows and read via `readBlockConfig()`.

| Configuration Key | Type | Default | Description | Required |
|-------------------|------|---------|-------------|----------|
| `label` | string | `Find your address` | Label for the standalone input (only used when `input-selector` is empty) | No |
| `default-country` | string | `''` | ISO alpha-2 code used when no country field is present (e.g. `NZ`, `AU`) | No |
| `surface` | `checkout` \| `customer-address` | `checkout` | Which `show_on_*` flag gates the widget | No |
| `input-selector` | string (CSS) | standalone input | Bind the widget to existing field(s) instead of rendering its own | No |
| `form-selector` | string (CSS) | block | Element whose country `<select>`/`<input>` drives the widget | No |
| `endpoint` | string (URL) | public endpoint | Override the GraphQL endpoint | No |

### GraphQL

The block calls a single public, CORS-enabled, unauthenticated endpoint:

```
POST https://993145-faq-devsushil.adobeio-static.net/api/v1/web/AddressFinderMenuId/addressfinder-graphql
Content-Type: application/json
```

It sends `addressFinderConfig(shippingCountry:$c)` and reads the frontend-safe
response, including the `api_key` (licence key) the widget needs. `enabled` is
`true` only when the module's master switch is on **and** the shipping country is
allowed.

## Behaviour Patterns

- **Standalone** — with no `input-selector`, the block renders its own labelled
  search input and looks up addresses for `default-country`.
- **Bound to a form** — set `input-selector` (and usually `form-selector`) to
  attach the widget to an existing address form; the widget re-queries on the
  country field's `change` event.
- **Checkout** — when the commerce dropin event bus is present, the block also
  re-runs setup on `checkout/updated` so it follows the destination country.

## Public API

`addressfinder.js` also exports helpers for use from other blocks:

- `setupAddressFinder({ endpoint, shippingCountry, inputs, surface })`
- `fetchConfig(endpoint, shippingCountry)`
- `addressFinderGql(endpoint, query, variables)`
- `teardownWidget(input)`
