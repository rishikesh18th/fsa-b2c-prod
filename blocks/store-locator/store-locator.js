import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { readBlockConfig, loadScript } from '../../scripts/aem.js';

/*
 * Store Locator Block
 * Renders the store/installer finder: an address search with radius filter, a
 * "locate nearby" control, a scrollable list of locations and a Google map.
 *
 * Data comes at runtime from the Store Locator App Builder app's public
 * GraphQL action (read-only, no auth, CORS enabled). The endpoint is NOT
 * hardcoded — it is read from config.json (`store-locator-endpoint`, under
 * public.default) and may be overridden per block instance:
 *   | Store Locator |
 *   | endpoint      | https://<ns>.adobeio-static.net/api/v1/web/... |
 *   | title         | Installer Finder |
 *   | location-path | /installer-finder |
 *
 * Presentation defaults (map height/zoom, sidebar position, which fields the
 * list shows, radius options, clustering) come from `storeLocatorConfig` so the
 * Commerce admin stays the single source of truth. Authored config wins.
 */

/** Fallbacks used before `storeLocatorConfig` resolves, or if a field is null. */
const DEFAULTS = {
  title: 'Store Locator',
  url_key: 'store-locator',
  map_zoom: 15,
  map_height: 500,
  distance_unit: 'kilometers',
  default_radius: 50,
  search_radius: [],
  locations_per_page: 20,
  show_sidebar: true,
  sidebar_position: 'left',
  enable_clustering: true,
  use_browser_location: true,
  show_search_by_radius: true,
  radius_type: 'dropdown',
  sidebar_show_image: true,
  sidebar_show_schedule: true,
  sidebar_show_distance: true,
  sidebar_show_directions_link: true,
  enable_location_pages: false,
  open_in_new_tab: false,
  autocomplete_country_restriction: [],
};

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const CONFIG_FIELDS = `
  title url_key google_api_key map_zoom map_height distance_unit
  search_radius default_radius show_search_by_radius radius_type
  show_sidebar sidebar_position sidebar_show_image sidebar_show_schedule
  sidebar_show_distance sidebar_show_directions_link
  enable_clustering use_browser_location locations_per_page
  enable_location_pages open_in_new_tab autocomplete_country_restriction`;

const LOCATION_FIELDS = `
  id url_key name formatted_address city state zip phone email lat lng
  thumbnail directions_url short_description
  working_hours { day closed open close }`;

const BOOTSTRAP_QUERY = `query Bootstrap($size: Int!) {
  storeLocatorConfig { ${CONFIG_FIELDS} }
  storeLocations(page: 1, pageSize: $size) {
    total_count total_pages page
    items { ${LOCATION_FIELDS} }
  }
}`;

const PAGE_QUERY = `query Page($page: Int!, $size: Int!) {
  storeLocations(page: $page, pageSize: $size) {
    total_count total_pages page
    items { ${LOCATION_FIELDS} }
  }
}`;

const NEARBY_QUERY = `query Nearby($lat: Float!, $lng: Float!, $radius: Float, $unit: String, $limit: Int) {
  nearbyStoreLocations(lat: $lat, lng: $lng, radius: $radius, unit: $unit, limit: $limit) {
    ${LOCATION_FIELDS}
    distance distance_unit
  }
}`;

/**
 * Resolve the GraphQL endpoint. Precedence:
 *   1. authored block config (`endpoint`)
 *   2. config.json -> public.default.store-locator-endpoint
 * @param {object} config parsed block config
 * @returns {string} endpoint URL, or '' when unconfigured
 */
function resolveEndpoint(config) {
  let { endpoint } = config;
  if (!endpoint) {
    try {
      endpoint = getConfigValue('store-locator-endpoint');
    } catch (e) {
      // config.json not initialized yet — handled by the caller
    }
  }
  return (endpoint || '').trim();
}

/**
 * POST a GraphQL query to the store locator action.
 * @param {string} endpoint GraphQL endpoint
 * @param {string} query GraphQL document
 * @param {object} variables query variables
 * @returns {Promise<object>} the `data` payload
 */
async function gql(endpoint, query, variables = {}) {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) throw new Error(`Store locator request failed: ${resp.status}`);
  const { data, errors } = await resp.json();
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  return data;
}

/** Short label for a distance unit, e.g. "kilometers" -> "km". */
function unitLabel(unit) {
  return (unit || '').toLowerCase().startsWith('mile') ? 'mi' : 'km';
}

/** `12.3 km`, or '' when the location carries no distance. */
function formatDistance(location) {
  if (typeof location.distance !== 'number') return '';
  return `${location.distance.toFixed(1)} ${unitLabel(location.distance_unit)}`;
}

/** Address line for the list, falling back to the city/state/zip parts. */
function formatAddress(location) {
  if (location.formatted_address) return location.formatted_address;
  return [location.city, location.state, location.zip].filter(Boolean).join(', ');
}

/** `09:00` -> `9:00 am`. Returns the raw value if it isn't a HH:MM string. */
function formatTime(value) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value || '');
  if (!match) return value || '';
  const hours = Number(match[1]);
  const suffix = hours < 12 ? 'am' : 'pm';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${match[2]} ${suffix}`;
}

/** True when at least one day has real opening hours worth rendering. */
function hasSchedule(hours) {
  return Array.isArray(hours) && hours.some((h) => !h.closed && h.open);
}

/** A location can only be mapped when it has coordinates. */
function hasCoordinates(location) {
  return typeof location.lat === 'number' && typeof location.lng === 'number';
}

/**
 * Build the URL of a location detail page. Returns '' when detail pages are
 * disabled in the admin or the location has no URL key.
 * @param {object} location store location
 * @param {object} cfg resolved configuration
 * @returns {string} href or ''
 */
function locationHref(location, cfg) {
  if (!cfg.enable_location_pages || !location.url_key) return '';
  // Default to the locator page's own path, so detail pages sit beneath it
  // (/installer-finder/acme-plumbing) as they did on the legacy locator. The
  // admin's `url_key` is a Magento route and does not describe where the AEM
  // page lives, so it is only a last resort.
  const raw = cfg.locationPath || window.location.pathname || cfg.url_key || '';
  const base = raw.replace(/\.html$/, '').replace(/\/+$/, '');
  return `${base.startsWith('/') ? base : `/${base}`}/${location.url_key}`;
}

/**
 * Render the opening hours as a disclosure with today's line as the summary.
 * @param {object[]} hours working_hours entries (7, Monday first)
 * @returns {HTMLElement} the <details> element
 */
function renderSchedule(hours) {
  const details = document.createElement('details');
  details.className = 'store-locator-schedule';

  // getDay() is Sunday-indexed; DAYS is Monday-first.
  const todayIndex = (new Date().getDay() + 6) % 7;
  const today = hours.find((h) => h.day === DAYS[todayIndex]);

  const summary = document.createElement('summary');
  summary.className = 'store-locator-schedule-summary';
  if (today && !today.closed && today.open) {
    summary.textContent = `Open today ${formatTime(today.open)} – ${formatTime(today.close)}`;
  } else {
    summary.textContent = 'Closed today';
    summary.classList.add('store-locator-schedule-summary--closed');
  }
  details.append(summary);

  const list = document.createElement('dl');
  list.className = 'store-locator-hours';
  DAYS.forEach((day) => {
    const entry = hours.find((h) => h.day === day);
    if (!entry) return;
    const term = document.createElement('dt');
    term.textContent = day.charAt(0).toUpperCase() + day.slice(1);
    const value = document.createElement('dd');
    value.textContent = entry.closed || !entry.open
      ? 'Closed'
      : `${formatTime(entry.open)} – ${formatTime(entry.close)}`;
    if (day === DAYS[todayIndex]) {
      term.classList.add('store-locator-hours--today');
      value.classList.add('store-locator-hours--today');
    }
    list.append(term, value);
  });
  details.append(list);
  return details;
}

/**
 * Render one location card for the list.
 * @param {object} location store location
 * @param {object} cfg resolved configuration
 * @param {number} index position in the current result set
 * @returns {HTMLElement} the <li> card
 */
function renderCard(location, cfg, index) {
  const li = document.createElement('li');
  li.className = 'store-locator-card';
  li.dataset.id = location.id;
  li.dataset.index = String(index);
  // Selectable: clicking (or Enter/Space on) a card shows it on the map. The
  // list owns the handlers, so re-rendering cards can't leak listeners.
  li.tabIndex = 0;

  if (cfg.sidebar_show_image && location.thumbnail) {
    const figure = document.createElement('figure');
    figure.className = 'store-locator-card-image';
    // App-served image (not an AEM-optimized asset), so use a plain <img>.
    const img = document.createElement('img');
    img.src = location.thumbnail;
    img.alt = location.name || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 96;
    img.height = 96;
    figure.append(img);
    li.append(figure);
  }

  const body = document.createElement('div');
  body.className = 'store-locator-card-body';

  const heading = document.createElement('h3');
  heading.className = 'store-locator-card-title';
  const href = locationHref(location, cfg);
  if (href) {
    const link = document.createElement('a');
    link.href = href;
    link.textContent = location.name || '';
    if (cfg.open_in_new_tab) {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    heading.append(link);
  } else {
    heading.textContent = location.name || '';
  }

  // "Show on map" pin, as on the legacy locator. Only meaningful when the
  // location has coordinates and a map is actually rendered.
  const titleRow = document.createElement('div');
  titleRow.className = 'store-locator-card-heading';
  titleRow.append(heading);
  if (hasCoordinates(location)) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'store-locator-card-pin';
    pin.dataset.pin = String(index);
    pin.title = 'Show on map';
    pin.setAttribute('aria-label', `Show ${location.name || 'this location'} on the map`);
    pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + '<path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/>'
      + '</svg>';
    titleRow.append(pin);
  }
  body.append(titleRow);

  const distance = cfg.sidebar_show_distance ? formatDistance(location) : '';
  if (distance) {
    const badge = document.createElement('span');
    badge.className = 'store-locator-card-distance';
    badge.textContent = distance;
    body.append(badge);
  }

  const address = formatAddress(location);
  if (address) {
    const para = document.createElement('p');
    para.className = 'store-locator-card-address';
    para.textContent = address;
    body.append(para);
  }

  if (location.short_description) {
    const para = document.createElement('p');
    para.className = 'store-locator-card-description';
    para.textContent = location.short_description;
    body.append(para);
  }

  if (location.phone) {
    const phone = document.createElement('a');
    phone.className = 'store-locator-card-phone';
    phone.href = `tel:${location.phone.replace(/\s+/g, '')}`;
    phone.textContent = location.phone;
    body.append(phone);
  }

  if (location.email) {
    const email = document.createElement('a');
    email.className = 'store-locator-card-email';
    email.href = `mailto:${location.email}`;
    email.textContent = location.email;
    body.append(email);
  }

  if (cfg.sidebar_show_schedule && hasSchedule(location.working_hours)) {
    body.append(renderSchedule(location.working_hours));
  }

  const actions = document.createElement('div');
  actions.className = 'store-locator-card-actions';
  if (cfg.sidebar_show_directions_link && location.directions_url) {
    const directions = document.createElement('a');
    directions.className = 'store-locator-card-directions';
    directions.href = location.directions_url;
    directions.target = '_blank';
    directions.rel = 'noopener';
    directions.textContent = 'Get directions';
    actions.append(directions);
  }
  if (actions.children.length) body.append(actions);

  li.append(body);
  return li;
}

/**
 * Escape a value for use in the map info window's static HTML.
 * @param {string} value raw text
 * @returns {string} HTML-safe text
 */
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

/**
 * Dependency-free marker clustering: buckets markers into a fixed pixel grid on
 * every map idle, replacing each crowded bucket with a single count marker.
 * Avoids pulling in the MarkerClusterer library for what is a small dataset.
 * @param {object} maps the google.maps namespace
 * @param {object} map map instance
 * @param {number} gridSize bucket size in screen pixels
 * @returns {{setMarkers: Function, destroy: Function}} clusterer handle
 */
function createClusterer(maps, map, gridSize = 64) {
  let markers = [];
  let clusters = [];

  const clearClusters = () => {
    clusters.forEach((marker) => marker.setMap(null));
    clusters = [];
  };

  const clusterIcon = (count) => {
    const radius = count < 10 ? 18 : 22;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${radius * 2}" height="${radius * 2}">`
      + `<circle cx="${radius}" cy="${radius}" r="${radius - 2}" fill="#1473e6" `
      + 'fill-opacity="0.9" stroke="#fff" stroke-width="3"/></svg>';
    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      scaledSize: new maps.Size(radius * 2, radius * 2),
      anchor: new maps.Point(radius, radius),
    };
  };

  const redraw = () => {
    const projection = map.getProjection();
    // The projection only exists once the map has rendered its first tiles.
    if (!projection) return;
    clearClusters();

    const scale = 2 ** map.getZoom();
    const buckets = new Map();
    markers.forEach((marker) => {
      const point = projection.fromLatLngToPoint(marker.getPosition());
      const key = `${Math.floor((point.x * scale) / gridSize)}:`
        + `${Math.floor((point.y * scale) / gridSize)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(marker);
    });

    buckets.forEach((group) => {
      if (group.length === 1) {
        group[0].setMap(map);
        return;
      }
      group.forEach((marker) => marker.setMap(null));
      const bounds = new maps.LatLngBounds();
      group.forEach((marker) => bounds.extend(marker.getPosition()));
      const cluster = new maps.Marker({
        position: bounds.getCenter(),
        map,
        icon: clusterIcon(group.length),
        label: {
          text: String(group.length),
          color: '#fff',
          fontSize: '12px',
          fontWeight: '700',
        },
        title: `${group.length} locations`,
        zIndex: 10,
      });
      cluster.addListener('click', () => map.fitBounds(bounds, 64));
      clusters.push(cluster);
    });
  };

  const listener = map.addListener('idle', redraw);

  return {
    setMarkers(next) {
      markers = next;
      redraw();
    },
    destroy() {
      clearClusters();
      maps.event.removeListener(listener);
    },
  };
}

/** Placeholder for the address field, restored if Google overwrites it. */
const SEARCH_PLACEHOLDER = 'Enter a suburb, postcode or address';

/**
 * How long to wait after a Google auth failure before deciding the map is dead.
 * Long enough for the first tiles to paint on a slow connection, short enough
 * that the fallback message isn't noticeably late.
 */
const MAP_AUTH_GRACE_MS = 2000;

/**
 * Undo the Places widget's error styling. When the Maps key is rejected (bad
 * key, referrer not allowed, billing off) the Autocomplete widget disables its
 * target input, replaces the placeholder with "Sorry! Something went wrong."
 * and paints a tiled error image over it — which would leave the field looking
 * broken even though the list and "locate nearby" still work.
 * @param {HTMLInputElement} input the address field
 */
function restoreSearchInput(input) {
  input.disabled = false;
  input.classList.remove('gm-err-autocomplete');
  input.style.backgroundImage = '';
  input.placeholder = SEARCH_PLACEHOLDER;
}

/**
 * Load the Google Maps JS API once per page.
 * @param {string} apiKey frontend Google Maps API key
 * @returns {Promise<object>} the google.maps namespace
 */
function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!window.__storeLocatorMapsPromise) {
    window.__storeLocatorMapsPromise = new Promise((resolve, reject) => {
      const callback = '__storeLocatorMapsReady';
      window[callback] = () => {
        delete window[callback];
        resolve(window.google.maps);
      };
      const params = new URLSearchParams({
        key: apiKey,
        libraries: 'places',
        loading: 'async',
        callback,
        v: 'weekly',
      });
      loadScript(`https://maps.googleapis.com/maps/api/js?${params}`).catch(reject);
    });
  }
  return window.__storeLocatorMapsPromise;
}

/**
 * Build the static shell (search controls, results list, map) once, so later
 * data updates only touch the list and the markers.
 * @param {Element} block the block element
 * @param {object} cfg resolved configuration
 * @returns {object} references to the shell's interactive parts
 */
function buildShell(block, cfg) {
  block.textContent = '';
  block.classList.add(`store-locator--sidebar-${cfg.show_sidebar ? cfg.sidebar_position : 'none'}`);
  block.style.setProperty('--store-locator-map-height', `${cfg.map_height}px`);

  // Only authored titles become an in-block heading. The admin's `title` names
  // the locator page itself, so rendering it here would duplicate the page <h1>.
  if (cfg.headingTitle) {
    const heading = document.createElement('h2');
    heading.className = 'store-locator-heading';
    heading.textContent = cfg.headingTitle;
    block.append(heading);
  }

  const form = document.createElement('form');
  form.className = 'store-locator-search';
  form.setAttribute('role', 'search');

  // Search box with the submit as a magnifier inside the field, matching the
  // legacy locator. The label stays in the DOM for screen readers but is hidden
  // visually, since the placeholder already says what to type.
  const field = document.createElement('div');
  field.className = 'store-locator-field store-locator-field--search';
  const searchId = `store-locator-address-${Math.random().toString(36).slice(2, 8)}`;
  const label = document.createElement('label');
  label.className = 'store-locator-label store-locator-label--hidden';
  label.setAttribute('for', searchId);
  label.textContent = 'Search by suburb, postcode or address';
  const input = document.createElement('input');
  input.type = 'search';
  input.id = searchId;
  input.name = 'address';
  input.className = 'store-locator-input';
  input.placeholder = SEARCH_PLACEHOLDER;
  input.autocomplete = 'off';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'store-locator-submit';
  submit.setAttribute('aria-label', 'Search');
  submit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 '
    + '4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/>'
    + '</svg>';

  field.append(label, input, submit);
  form.append(field);

  // No radius control: the legacy locator has none, so searches use the admin's
  // default_radius. `show_search_by_radius` / `search_radius` are still read from
  // the config — they just aren't rendered as a dropdown any more.
  const radiusSelect = null;

  const actions = document.createElement('div');
  actions.className = 'store-locator-actions';

  let nearbyButton = null;
  if (cfg.use_browser_location) {
    nearbyButton = document.createElement('button');
    nearbyButton.type = 'button';
    nearbyButton.className = 'store-locator-button store-locator-button--nearby';
    nearbyButton.textContent = 'Locate nearby';
    actions.append(nearbyButton);
  }

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'store-locator-button store-locator-button--reset';
  resetButton.textContent = 'Reset';
  resetButton.hidden = true;
  actions.append(resetButton);
  form.append(actions);

  const status = document.createElement('p');
  status.className = 'store-locator-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const layout = document.createElement('div');
  layout.className = 'store-locator-layout';

  const panel = document.createElement('div');
  panel.className = 'store-locator-panel';
  const list = document.createElement('ul');
  list.className = 'store-locator-list';
  const pager = document.createElement('nav');
  pager.className = 'store-locator-pagination';
  pager.setAttribute('aria-label', 'Location pages');

  const mapEl = document.createElement('div');
  mapEl.className = 'store-locator-map';
  mapEl.setAttribute('role', 'application');
  mapEl.setAttribute('aria-label', 'Map of store locations');
  mapEl.style.visibility = 'hidden';

  // With a sidebar the search sits above the list inside the column (as on the
  // legacy locator); without one it spans the full width above the map.
  if (cfg.show_sidebar) {
    panel.append(form, status, list, pager);
    layout.append(panel, mapEl);
  } else {
    block.append(form, status);
    layout.append(mapEl);
  }
  block.append(layout);

  return {
    form, input, radiusSelect, nearbyButton, resetButton, status, list, pager, mapEl,
  };
}

/**
 * Render the pager for the browse (non-search) result set.
 * @param {Element} nav pager container
 * @param {object} options page/pages/onNav
 */
function renderPagination(nav, { page, pages, onNav }) {
  nav.textContent = '';
  if (pages <= 1) return;

  const addButton = (labelText, target, { current, arrow } = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = labelText;
    button.className = `store-locator-page${arrow ? ' store-locator-page--arrow' : ''}`;
    button.setAttribute('aria-label', arrow ? labelText : `Page ${target}`);
    if (current) button.setAttribute('aria-current', 'true');
    else button.addEventListener('click', () => onNav(target));
    nav.append(button);
  };

  if (page > 1) addButton('‹', page - 1, { arrow: true });
  for (let p = 1; p <= pages; p += 1) {
    addButton(String(p), p, { current: p === page });
  }
  if (page < pages) addButton('›', page + 1, { arrow: true });
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const authored = readBlockConfig(block);
  const endpoint = resolveEndpoint(authored);

  block.textContent = '';

  if (!endpoint) {
    // eslint-disable-next-line no-console
    console.error('store-locator: no endpoint configured (config.json -> store-locator-endpoint)');
    const error = document.createElement('p');
    error.className = 'store-locator-error';
    error.textContent = 'The store locator is temporarily unavailable.';
    block.append(error);
    return;
  }

  const loading = document.createElement('p');
  loading.className = 'store-locator-status';
  loading.textContent = 'Loading locations…';
  block.append(loading);

  let bootstrap;
  try {
    bootstrap = await gql(endpoint, BOOTSTRAP_QUERY, {
      size: parseInt(authored['per-page'], 10) || DEFAULTS.locations_per_page,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('store-locator: failed to load', error);
    loading.className = 'store-locator-error';
    loading.textContent = 'The store locator is temporarily unavailable.';
    return;
  }

  // Admin config, with nulls falling back to DEFAULTS, then authored overrides.
  const remote = bootstrap.storeLocatorConfig || {};
  const cfg = { ...DEFAULTS };
  Object.entries(remote).forEach(([key, value]) => {
    if (value !== null && value !== undefined) cfg[key] = value;
  });
  cfg.headingTitle = authored.title || '';
  if (authored['location-path']) cfg.locationPath = authored['location-path'];
  if (authored.sidebar) {
    cfg.show_sidebar = authored.sidebar !== 'none';
    if (cfg.show_sidebar) cfg.sidebar_position = authored.sidebar;
  }
  const pageSize = parseInt(authored['per-page'], 10) || cfg.locations_per_page;

  const ui = buildShell(block, cfg);

  const state = {
    mode: 'browse',
    page: bootstrap.storeLocations?.page || 1,
    pages: bootstrap.storeLocations?.total_pages || 1,
    items: bootstrap.storeLocations?.items || [],
    total: bootstrap.storeLocations?.total_count || 0,
    markers: [],
    map: null,
    maps: null,
    selectedIndex: 0,
    infoWindow: null,
    clusterer: null,
    originMarker: null,
    originCircle: null,
  };

  /** Highlight the card matching a marker and scroll it into view. */
  const focusCard = (index) => {
    ui.list.querySelectorAll('.store-locator-card--active')
      .forEach((el) => el.classList.remove('store-locator-card--active'));
    const card = ui.list.querySelector(`[data-index="${index}"]`);
    if (!card) return;
    card.classList.add('store-locator-card--active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  /**
   * Open the info window for a location and centre the map on it.
   * `pan: false` opens the bubble without moving the viewport — used for the
   * selection made on first paint, so the map still shows every result.
   */
  const showOnMap = (location, index, { pan = true } = {}) => {
    if (!state.map || !hasCoordinates(location)) return;
    const position = { lat: location.lat, lng: location.lng };
    if (pan) {
      state.map.panTo(position);
      if (state.map.getZoom() < cfg.map_zoom) state.map.setZoom(cfg.map_zoom);
    }
    const directions = location.directions_url
      ? `<a href="${escapeHtml(location.directions_url)}" target="_blank" rel="noopener">Get directions</a>`
      : '';
    const phone = location.phone
      ? `<a href="tel:${escapeHtml(location.phone.replace(/\s+/g, ''))}">${escapeHtml(location.phone)}</a>`
      : '';
    const email = location.email
      ? `<a href="mailto:${escapeHtml(location.email)}">${escapeHtml(location.email)}</a>`
      : '';
    // Image first, as on the legacy locator's info window.
    const image = location.thumbnail
      ? `<img src="${escapeHtml(location.thumbnail)}" alt="" loading="lazy" decoding="async">`
      : '';
    state.infoWindow.setContent(
      `<div class="store-locator-infowindow">
        <strong>${escapeHtml(location.name)}</strong>
        ${image}
        <span>${escapeHtml(formatAddress(location))}</span>
        ${phone}${email}${directions}
      </div>`,
    );
    state.infoWindow.open({ map: state.map, anchor: state.markers[index] });
    focusCard(index);
  };

  /**
   * Select a result: highlight its card and show it on the map. Works with no
   * map too — the highlight is independent of it.
   */
  const selectIndex = (index, options) => {
    const location = state.items[index];
    if (!location) return;
    state.selectedIndex = index;
    focusCard(index);
    showOnMap(location, index, options);
  };

  // Delegated once on the list, so the cards themselves stay listener-free.
  // Clicks on links inside a card (title, phone, directions) are left alone.
  ui.list.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    const card = event.target.closest('.store-locator-card');
    if (card) selectIndex(Number(card.dataset.index));
  });

  ui.list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('a')) return;
    const card = event.target.closest('.store-locator-card');
    if (!card) return;
    event.preventDefault();
    selectIndex(Number(card.dataset.index));
  });

  /** Rebuild the markers for the current result set and fit the viewport. */
  const syncMarkers = () => {
    if (!state.map) return;
    state.infoWindow.close();
    state.markers.forEach((marker) => marker.setMap(null));
    state.markers = [];

    const mappable = state.items.filter(hasCoordinates);
    const bounds = new state.maps.LatLngBounds();

    state.items.forEach((location, index) => {
      if (!hasCoordinates(location)) {
        // Keep indexes aligned with the cards so focusCard() stays in sync.
        state.markers[index] = null;
        return;
      }
      const marker = new state.maps.Marker({
        position: { lat: location.lat, lng: location.lng },
        title: location.name || '',
        icon: location.marker_icon || undefined,
      });
      marker.addListener('click', () => showOnMap(location, index));
      state.markers[index] = marker;
      bounds.extend(marker.getPosition());
    });

    const visible = state.markers.filter(Boolean);
    if (state.clusterer) {
      state.clusterer.setMarkers(visible);
    } else {
      visible.forEach((marker) => marker.setMap(state.map));
    }

    if (state.origin) bounds.extend(state.origin);
    // Keep the whole searched radius in view, not just the matches inside it.
    const circleBounds = state.originCircle?.getBounds?.();
    if (circleBounds) bounds.union(circleBounds);
    if (mappable.length === 1 && !state.origin) {
      state.map.setCenter(bounds.getCenter());
      state.map.setZoom(cfg.map_zoom);
    } else if (mappable.length) {
      state.map.fitBounds(bounds, 48);
    }
  };

  /** Paint the current result set into the list and the map. */
  const render = () => {
    ui.list.textContent = '';
    ui.pager.textContent = '';

    if (!state.items.length) {
      const empty = document.createElement('li');
      empty.className = 'store-locator-empty';
      empty.textContent = state.mode === 'browse'
        ? 'No locations available yet.'
        : 'No locations found in this area. Try a wider search radius.';
      ui.list.append(empty);
      syncMarkers();
      return;
    }

    const fragment = document.createDocumentFragment();
    state.items.forEach((location, index) => fragment.append(renderCard(location, cfg, index)));
    ui.list.append(fragment);

    if (state.mode === 'browse') {
      renderPagination(ui.pager, {
        page: state.page,
        pages: state.pages,
        // eslint-disable-next-line no-use-before-define
        onNav: (target) => loadPage(target),
      });
    }
    syncMarkers();

    // Start on the first result — highlighted, with its map bubble open. After
    // syncMarkers() so the marker to anchor the bubble to exists, and without
    // panning so the viewport still frames every result.
    // eslint-disable-next-line no-use-before-define
    selectIndex(0, { pan: false });
  };

  /** Announce the current result count / search state. */
  const setStatus = (message) => {
    ui.status.textContent = message;
  };

  /** Load a page of the full (unfiltered) location list. */
  async function loadPage(page) {
    setStatus('Loading locations…');
    try {
      const data = await gql(endpoint, PAGE_QUERY, { page, size: pageSize });
      const result = data.storeLocations || {};
      state.mode = 'browse';
      state.origin = null;
      state.page = result.page || page;
      state.pages = result.total_pages || 1;
      state.total = result.total_count || 0;
      state.items = result.items || [];
      render();
      setStatus(`${state.total} location${state.total === 1 ? '' : 's'}`);
      ui.list.scrollTop = 0;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('store-locator: failed to load page', error);
      setStatus('Could not load locations. Please try again.');
    }
  }

  /** Run a radius search around a coordinate and switch to "results" mode. */
  async function searchNearby(lat, lng, label) {
    // No radius dropdown any more, so fall back to the admin's default radius.
    // A blank/zero default means "everywhere", which the API takes as null.
    const radius = ui.radiusSelect?.value
      ? Number(ui.radiusSelect.value)
      : (Number(cfg.default_radius) || null);
    setStatus('Searching…');
    try {
      const data = await gql(endpoint, NEARBY_QUERY, {
        lat, lng, radius, unit: cfg.distance_unit, limit: pageSize,
      });
      state.mode = 'nearby';
      state.origin = { lat, lng };
      state.items = data.nearbyStoreLocations || [];
      state.total = state.items.length;

      // Origin marker and radius circle are placed before render(), so the
      // viewport fit inside syncMarkers() can include the whole circle.
      if (state.map) {
        state.originMarker?.setMap(null);
        state.originMarker = new state.maps.Marker({
          position: { lat, lng },
          map: state.map,
          title: label || 'Your location',
          zIndex: 20,
          icon: {
            path: state.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#1473e6',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 3,
          },
        });

        // Shade the searched area, as the legacy locator does. Circle takes
        // metres, so convert from the admin's distance unit.
        state.originCircle?.setMap(null);
        state.originCircle = null;
        if (radius) {
          const metres = radius * (unitLabel(cfg.distance_unit) === 'mi' ? 1609.344 : 1000);
          state.originCircle = new state.maps.Circle({
            map: state.map,
            center: { lat, lng },
            radius: metres,
            strokeColor: '#d9534f',
            strokeOpacity: 0.5,
            strokeWeight: 1,
            fillColor: '#d9534f',
            fillOpacity: 0.12,
            clickable: false,
            zIndex: 1,
          });
        }
      }

      render();

      ui.resetButton.hidden = false;
      const suffix = radius ? ` within ${radius} ${unitLabel(cfg.distance_unit)}` : '';
      setStatus(state.total
        ? `${state.total} location${state.total === 1 ? '' : 's'}${suffix}${label ? ` of ${label}` : ''}`
        : `No locations found${suffix}.`);
      ui.list.scrollTop = 0;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('store-locator: nearby search failed', error);
      setStatus('Could not complete the search. Please try again.');
    }
  }

  // --- Interactions -------------------------------------------------------

  ui.list.addEventListener('click', (event) => {
    // Let real links (detail page, phone, directions) behave normally.
    if (event.target.closest('a, summary')) return;
    const card = event.target.closest('.store-locator-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    showOnMap(state.items[index], index);
  });

  ui.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = ui.input.value.trim();
    if (!query) {
      loadPage(1);
      ui.resetButton.hidden = true;
      return;
    }
    if (!state.maps) {
      setStatus('Address search is unavailable. Use "Locate nearby" instead.');
      return;
    }
    setStatus('Looking up that address…');
    const geocoder = new state.maps.Geocoder();
    try {
      const { results } = await geocoder.geocode({ address: query });
      const best = results?.[0];
      if (!best) {
        setStatus('We could not find that address. Try a suburb or postcode.');
        return;
      }
      const { location } = best.geometry;
      await searchNearby(location.lat(), location.lng(), best.formatted_address);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('store-locator: geocoding failed', error);
      setStatus('We could not find that address. Try a suburb or postcode.');
    }
  });

  ui.nearbyButton?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus('Your browser does not support location sharing.');
      return;
    }
    setStatus('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        ui.input.value = '';
        searchNearby(position.coords.latitude, position.coords.longitude, 'your location');
      },
      () => setStatus('We could not access your location. Search by suburb or postcode instead.'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
    );
  });

  ui.resetButton.addEventListener('click', () => {
    ui.input.value = '';
    ui.resetButton.hidden = true;
    state.originMarker?.setMap(null);
    state.originMarker = null;
    state.originCircle?.setMap(null);
    state.originCircle = null;
    loadPage(1);
  });

  // --- First paint --------------------------------------------------------

  render();
  setStatus(`${state.total} location${state.total === 1 ? '' : 's'}`);

  // The map is progressive enhancement: the list is fully usable without it.
  const disableMap = (message) => {
    state.maps = null;
    state.map = null;
    ui.mapEl.hidden = false;
    ui.mapEl.style.visibility = '';
    ui.mapEl.textContent = '';
    block.classList.add('store-locator--map-disabled');
    block.classList.remove('store-locator--map-loading');
    restoreSearchInput(ui.input);
    if (message) setStatus(message);
  };

  if (!cfg.google_api_key) {
    disableMap('Map unavailable. Browse the list below or use “Locate nearby”.');
    return;
  }

  // Maps reports key problems (bad key, referrer not allowed, API not enabled,
  // billing off) asynchronously through this global rather than by rejecting the
  // load. It is one page-wide hook covering every Maps product, so it also fires
  // when only an optional extra is unauthorised — most often Places, which the
  // autocomplete needs but the map does not.
  //
  // Tearing the map down in that case is wrong: the map has already rendered, and
  // the user watches it disappear.
  const previousAuthFailure = window.gm_authFailure;
  window.gm_authFailure = () => {
    // Decide from the map container, not from the event timing. When Maps really
    // fails it replaces the container's contents with its own error panel
    // (.gm-err-container — the "Sorry! Something went wrong" box); when only
    // Places is unauthorised the map keeps its tiles and Google instead flags the
    // input with .gm-err-autocomplete. Asking the DOM which of the two happened
    // is reliable, whereas `tilesloaded` may not have fired yet (or at all) on
    // a map that is visibly working.
    setTimeout(() => {
      const mapPanelFailed = !!ui.mapEl.querySelector('.gm-err-container, .gm-err-content');
      if (!mapPanelFailed && state.map) {
        // eslint-disable-next-line no-console
        console.warn('store-locator: Google Maps rejected the key for an optional feature — '
          + 'usually the Places API, which address autocomplete needs. Enable "Places API" for '
          + 'this key to get suggestions back. The map, list and "Locate nearby" keep working.');
        restoreSearchInput(ui.input);
      } else {
        // eslint-disable-next-line no-console
        console.error('store-locator: Google Maps rejected the API key. Check the browser '
          + 'console for the "Google Maps JavaScript API error: …" line — it names the cause '
          + '(RefererNotAllowedMapError / ApiNotActivatedMapError / InvalidKeyMapError / '
          + 'BillingNotEnabledMapError).');
        disableMap('Map unavailable. Browse the list below or use “Locate nearby”.');
      }
    }, MAP_AUTH_GRACE_MS);
    if (typeof previousAuthFailure === 'function') previousAuthFailure();
  };

  try {
    block.classList.add('store-locator--map-loading');
    const maps = await loadGoogleMaps(cfg.google_api_key);
    block.classList.remove('store-locator--map-loading');
    block.classList.remove('store-locator--map-disabled');
    ui.mapEl.style.visibility = '';
    state.maps = maps;
    state.map = new maps.Map(ui.mapEl, {
      zoom: cfg.map_zoom,
      center: { lat: 0, lng: 0 },
      // Map / Satellite toggle, as on the legacy locator.
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    });
    state.infoWindow = new maps.InfoWindow();
    if (cfg.enable_clustering) state.clusterer = createClusterer(maps, state.map);
    syncMarkers();
    // The list painted before the map existed, so re-apply the selection now to
    // open its bubble.
    selectIndex(state.selectedIndex, { pan: false });

    // Places autocomplete is optional — only wire it when the key allows it.
    // Its own try/catch, because it must never reach the outer handler: that one
    // disables the map, and a missing Places entitlement would then blank a map
    // that is working perfectly. Typing an address and pressing Search still
    // works without suggestions.
    if (maps.places?.Autocomplete) {
      try {
        const options = { fields: ['geometry', 'formatted_address'] };
        if (cfg.autocomplete_country_restriction?.length) {
          options.componentRestrictions = { country: cfg.autocomplete_country_restriction };
        }
        const autocomplete = new maps.places.Autocomplete(ui.input, options);
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          if (!place?.geometry?.location) return;
          searchNearby(
            place.geometry.location.lat(),
            place.geometry.location.lng(),
            place.formatted_address,
          );
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('store-locator: address autocomplete unavailable — enable the Places API '
          + 'for this key to get suggestions. Search still works.', error);
        restoreSearchInput(ui.input);
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('store-locator: Google Maps failed to load', error);
    disableMap();
  }
}
