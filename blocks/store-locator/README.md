# Store Locator Block

## Overview

The Store Locator block renders the store / installer finder: an address search with
a radius filter, a "locate nearby" control backed by browser geolocation, a
scrollable list of locations, and a Google map with clustered markers.

Locations are managed in the Adobe Commerce Admin (Store Locator App Builder app)
and fetched at runtime from that app's public `location-graphql` web action. The
API is read-only, unauthenticated and CORS-enabled — there is no build step and no
server-side rendering. Only locations with **Status = Enabled** are returned.

This block reproduces the storefront side of the legacy Magento 2 Amasty store
locator at `/installer-finder`.

## Integration

### Block Configuration

Configuration is read with `readBlockConfig()`. All keys are optional:

| Key | Description | Default |
|-----|-------------|---------|
| `endpoint` | GraphQL endpoint of the store locator action. Overrides the global config value per block instance. | — |
| `title` | Heading rendered above the search controls. **Only an authored title renders a heading** — the admin's `title` names the locator page itself, so using it here would duplicate the page `<h1>`. | none |
| `location-path` | Base path for location detail pages, e.g. `/installer-finder`. | the locator page's own path |
| `per-page` | Locations requested per page. | `storeLocatorConfig.locations_per_page` |
| `sidebar` | `left`, `right` or `none`. Overrides `storeLocatorConfig.sidebar_position`. | admin value |

Example authored block:

```
| Store Locator |
| title         | Find an installer |
| location-path | /installer-finder |
```

### Configuration Source Precedence

1. Authored block config (above).
2. `storeLocatorConfig` from the API — the Commerce admin is the source of truth
   for map height/zoom, sidebar position and contents, radius options, clustering,
   distance unit and whether detail pages are enabled.
3. Built-in `DEFAULTS` in `store-locator.js`, used before the config resolves and
   for any field the API returns as `null`.

The endpoint itself resolves as: authored `endpoint` →
`config.json` → `public.default.store-locator-endpoint`. If neither is set the
block renders an error message and logs to the console.

### API Requests

All requests are `POST {endpoint}` with `Content-Type: application/json`. No
`Authorization` header is sent.

| Query | When | Purpose |
|-------|------|---------|
| `storeLocatorConfig` + `storeLocations` | on decorate | one round trip for settings + first page |
| `storeLocations(page, pageSize)` | pager click, reset | browse mode |
| `nearbyStoreLocations(lat, lng, radius, unit, limit)` | search / locate nearby | results sorted nearest-first |

### Search Behaviour

- **Locate nearby** uses `navigator.geolocation` and needs no Google API key.
- **Address search** resolves the typed text with the Google **Geocoder**, then
  runs a radius query. It is disabled (with a message pointing at "Locate nearby")
  when Maps fails to load.
- **Places autocomplete** is wired only when `maps.places.Autocomplete` is
  available on the loaded API, so a key without the Places API enabled degrades to
  geocode-on-submit rather than erroring. `autocomplete_country_restriction` from
  the admin is applied when set.
- The radius `<select>` is rendered only when `show_search_by_radius` is true and
  `search_radius` is non-empty; it always offers an "Everywhere" (no limit) option.

### Parity With the Legacy Locator

Carried over from the Magento/Amasty page:

- a "show on map" **pin button** on each card (`.store-locator-card-pin`), which
  pans the map and opens that location's info window;
- **email** on the card and in the info window (`email` is in `LOCATION_FIELDS`);
- an info window ordered **name → image → address → phone → email → directions**;
- a translucent **radius circle** around the searched point. `google.maps.Circle`
  takes metres, so the admin's `distance_unit` is converted. The circle is created
  *before* `render()` so `syncMarkers()` can fit the viewport around the whole
  circle rather than only the matches inside it.

### Map

- The Google Maps JS API is loaded lazily, once per page, keyed on the frontend
  `google_api_key` returned by `storeLocatorConfig`. The backend key is never
  exposed by this API.
- **The map is progressive enhancement.** If no API key is configured, or the
  script fails to load, the map is hidden (`.store-locator--no-map`) and the list,
  pagination and "locate nearby" all keep working.
- Maps reports key problems (bad key, referrer not allowed, billing disabled)
  asynchronously via the global `gm_authFailure`, *not* by failing the script
  load. The block hooks that global (chaining any existing handler) to hide the
  map and show "Map unavailable…".
- **`restoreSearchInput()` exists for a specific Google behaviour:** on auth
  failure the Places widget disables the input it is attached to, overwrites the
  placeholder with "Sorry! Something went wrong." and paints a tiled error image
  over it. Without the repair the address field would look and behave as broken
  even though the list and "locate nearby" still work. Do not remove it.
- Clustering is implemented in-block as a pixel-grid clusterer (no MarkerClusterer
  dependency) and is active when `enable_clustering` is true.
- Locations without coordinates still appear in the list but are skipped on the
  map — marker indexes stay aligned with card indexes so selection stays in sync.

### Page URL

The locator lives at **`/installer-finder`**, registered as a code-owned
synthetic route in `scripts/scripts.js` — the same mechanism `/testimonials` and
`/blog` use. There is **no authored content page**: the path 404s at the content
bus, `404.html` sets `window.isErrorPage`, and `applySyntheticRoute()` rewrites
`<main>` with an `<h1>` and the block, then `loadSyntheticRoute()` loads it.

```js
// scripts/scripts.js -> SYNTHETIC_PAGE_ROUTES
{
  match: '/installer-finder',
  title: 'Installer Finder',
  sections: [{ heading: 'Installer Finder', block: 'store-locator' }],
}
```

This suits the locator because every location is fetched at runtime — there is
nothing for an author to maintain. Matching is by suffix, so store-prefixed paths
like `/au/installer-finder` also resolve. To change the URL, edit that `match`.

`storeLocatorConfig.url_key` (`store-locator`) is the legacy Magento route and
routes nothing here; the block never reads it to decide where it lives.

The nav entry currently points at the absolute Magento URL
(`https://www.filtersystemsaustralia.com.au/installer-finder`) — change it to the
relative `/installer-finder` so it resolves to this page.

### Location Detail Pages

Location names link to `{location-path}/{url_key}` only when the admin has
`enable_location_pages` turned on. **Those detail pages are a separate block and
are not part of this one** — if detail pages do not exist yet, either turn the
setting off in the admin or omit `location-path` and build the detail block.

## Accessibility

- The search controls are a `role="search"` form with a visible `<label>` per field.
- Result counts and search progress are announced through a `role="status"`
  `aria-live="polite"` region.
- With the sidebar on the right, the DOM order stays list-then-map (the swap is
  CSS grid placement only) so keyboard and screen-reader order is unchanged.
- Opening hours use a `<details>` disclosure; today's line is the summary.
- All controls meet a 44px minimum touch target and have visible focus outlines.

## Data Notes

- `working_hours` always has 7 entries, Monday first. The schedule is hidden
  entirely when every day is closed, so locations with no hours entered do not
  render a misleading "Closed today".
- Empty strings come back as `null` from the API, so `??` fallbacks are safe.
- `formatted_address` is pre-joined for display; the block falls back to
  city/state/zip when it is missing.
- `distance` is only populated by `nearbyStoreLocations` and is `null` in browse mode.

## Known Environment Issues

Both of these are configuration outside this block — the block code handles each
gracefully, but the feature is not fully live until they are fixed.

### 1. The API sends a duplicated CORS header (blocks all browser requests)

The `location-graphql` action currently responds with:

```
access-control-allow-origin: *,*
access-control-allow-methods: OPTIONS, GET, ... ,GET, POST, OPTIONS
access-control-allow-headers: ..., Content-Type, Authorization
```

Browsers reject `*,*` — *"the 'Access-Control-Allow-Origin' header contains
multiple values '\*,\*', but only one is allowed"* — so **every** storefront fetch
fails, and the block falls back to its error message. `curl` and Postman do not
enforce CORS, which is why the endpoint appears healthy when tested that way.

The action is setting CORS headers itself *and* getting them from the App Builder
web-action annotation. Fix on the backend by removing one of the two sources so a
single `Access-Control-Allow-Origin` value is returned.

### 2. The Google Maps key is referrer-restricted to the Magento domain

Loading the locator anywhere else yields `RefererNotAllowedMapError` and the map
is hidden. Add the storefront origins to the frontend key's HTTP-referrer
allowlist in the Google Cloud console:

- `http://localhost:3000/*` (local development)
- `https://*--fsa--rishikesh18th.aem.page/*` (branch previews)
- `https://*--fsa--rishikesh18th.aem.live/*` and the production domain

Keep the restriction in place — the key is public in the page source, and
referrer restriction is what stops it being used elsewhere.

## Local Testing

```
npx -y @adobe/aem-cli up --no-open --html-folder drafts
```

Then open `http://localhost:3000/installer-finder` — the synthetic route renders
it with no content page required.

`drafts/store-locator.plain.html` additionally exercises the block's authored
form (block config rows) at `http://localhost:3000/drafts/store-locator`.

Use the **`.plain.html`** extension. A plain `.html` file in `drafts/` is served
verbatim — no `head.html`, no `scripts.js`, so no block ever decorates — and it
shadows a `.plain.html` of the same name. The file must contain only the section
content (`<div>…</div>`), not a `<body>`/`<main>` wrapper, or the content nests
inside the real `<main>` and the block is not decorated.

Until the CORS header above is fixed, the block can only be exercised locally with
CORS enforcement off:

```
google-chrome --user-data-dir=/tmp/sl-profile --disable-web-security \
  http://localhost:3000/drafts/store-locator
```

Use a throwaway profile, and never browse other sites in that window.
