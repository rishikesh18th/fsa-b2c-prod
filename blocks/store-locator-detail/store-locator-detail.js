import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { loadCSS, loadScript } from '../../scripts/aem.js';

const LOCATION_FIELDS = `
  id url_key name formatted_address city state zip phone email lat lng
  thumbnail directions_url short_description
  working_hours { day closed open close }
`;

const DETAIL_QUERY = `query Location($urlKey: String!) {
  storeLocatorConfig { google_api_key }
  storeLocation(url_key: $urlKey) { ${LOCATION_FIELDS} }
}`;

const LOCATIONS_QUERY = `query Locations($size: Int!) {
  storeLocatorConfig { google_api_key }
  storeLocations(page: 1, pageSize: $size) { items { ${LOCATION_FIELDS} } }
}`;

function resolveEndpoint(config) {
  let { endpoint } = config;
  if (!endpoint) {
    try {
      endpoint = getConfigValue('store-locator-endpoint');
    } catch (e) {
      // config.json may not be initialized yet
    }
  }
  return (endpoint || '').trim();
}

async function gql(endpoint, query, variables = {}) {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!resp.ok) throw new Error(`Store locator request failed: ${resp.status}`);
  const { data, errors } = await resp.json();
  if (errors?.length) throw new Error(errors.map((error) => error.message).join('; '));
  return data;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAddress(location) {
  if (location.formatted_address) return location.formatted_address;
  return [location.city, location.state, location.zip].filter(Boolean).join(', ');
}

function formatHours(hours) {
  if (!Array.isArray(hours) || hours.length === 0) return '';
  return `
    <dl class="store-locator-detail__hours-list">
      ${hours.map((entry) => {
    const label = escapeHtml(entry.day ? entry.day.charAt(0).toUpperCase() + entry.day.slice(1) : '');
    const value = entry.closed || !entry.open
      ? 'Closed'
      : `${escapeHtml(entry.open)} – ${escapeHtml(entry.close)}`;
    return `<div class="store-locator-detail__hours-entry"><dt>${label}</dt><dd>${value}</dd></div>`;
  }).join('')}
    </dl>
  `;
}

function getUrlKey() {
  const path = window.location.pathname.replace(/\/$/, '');
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

async function fetchLocation(endpoint, urlKey) {
  try {
    const data = await gql(endpoint, DETAIL_QUERY, { urlKey });
    return {
      location: data.storeLocation,
      config: data.storeLocatorConfig || {},
    };
  } catch (err) {
    if (/Cannot query field "storeLocation"/.test(err.message) || /Unknown field "storeLocation"/.test(err.message)) {
      const data = await gql(endpoint, LOCATIONS_QUERY, { size: 200 });
      return {
        location: data.storeLocations?.items?.find((location) => location.url_key === urlKey),
        config: data.storeLocatorConfig || {},
      };
    }
    throw err;
  }
}

function buildBreadcrumb(name) {
  return `
    <nav class="store-locator-detail__breadcrumb" aria-label="Breadcrumb">
      <a href="/">Home</a>
      <span aria-hidden="true">›</span>
      <a href="/installer-finder">Installer Finder</a>
      <span aria-hidden="true">›</span>
      <span>${escapeHtml(name)}</span>
    </nav>
  `;
}

function buildInfoPanel(location) {
  const address = formatAddress(location);
  const phone = location.phone ? `<a href="tel:${escapeHtml(location.phone)}">${escapeHtml(location.phone)}</a>` : '';
  const email = location.email ? `<a href="mailto:${escapeHtml(location.email)}">${escapeHtml(location.email)}</a>` : '';
  const directions = location.directions_url
    ? `<a class="store-locator-detail__button" href="${escapeHtml(location.directions_url)}" target="_blank" rel="noopener">Get directions</a>`
    : '';
  const photo = location.thumbnail
    ? `<div class="store-locator-detail__photo"><img src="${escapeHtml(location.thumbnail)}" alt="${escapeHtml(location.name || 'Location photo')}" /></div>`
    : '';
  const description = location.short_description
    ? `<div class="store-locator-detail__description"><p>${escapeHtml(location.short_description)}</p></div>`
    : '';

  return `
    <div class="store-locator-detail__summary">
      <div class="store-locator-detail__address">
        <p class="store-locator-detail__label">Address</p>
        <p>${escapeHtml(address)}</p>
      </div>
      <div class="store-locator-detail__contact-list">
        ${phone ? `<div><span>Phone</span><p>${phone}</p></div>` : ''}
        ${email ? `<div><span>Email</span><p>${email}</p></div>` : ''}
      </div>
      ${directions}
    </div>
    ${photo}
    ${description}
    <div class="store-locator-detail__section">
      <h2>Opening hours</h2>
      ${formatHours(location.working_hours || [])}
    </div>
    <div class="store-locator-detail__section store-locator-detail__reviews">
      <h2>Reviews</h2>
      <p>No reviews yet.</p>
    </div>
  `;
}

function renderLocation(block, location) {
  block.innerHTML = `
    ${buildBreadcrumb(location.name || 'Location')}
    <div class="store-locator-detail__header">
      <h1>${escapeHtml(location.name || '')}</h1>
    </div>
    <div class="store-locator-detail__layout">
      <div class="store-locator-detail__left">
        ${buildInfoPanel(location)}
      </div>
      <div class="store-locator-detail__right">
        <div class="store-locator-detail__map-card">
          <div class="store-locator-detail__map" id="store-locator-detail-map"></div>
        </div>
      </div>
    </div>
  `;
}

async function initMap(element, location, apiKey) {
  if (!location.lat || !location.lng || !apiKey) {
    element.innerHTML = '<div class="store-locator-detail__map-fallback">Map unavailable</div>';
    return;
  }

  try {
    const maps = await loadGoogleMaps(apiKey);
    const center = { lat: Number(location.lat), lng: Number(location.lng) };
    const map = new maps.Map(element, {
      center,
      zoom: 14,
      disableDefaultUI: true,
    });
    const marker = new maps.Marker({ position: center, map, title: location.name || '' });
    const info = new maps.InfoWindow({
      content: `<div class="store-locator-detail__infowindow"><strong>${escapeHtml(location.name || '')}</strong><br>${escapeHtml(formatAddress(location))}</div>`,
    });
    marker.addListener('click', () => info.open(map, marker));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('store-locator-detail: failed to load Google Maps', err);
    element.innerHTML = '<div class="store-locator-detail__map-fallback">Map unavailable</div>';
  }
}

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

export default async function decorate(block) {
  const base = window.hlx?.codeBasePath || '';
  loadCSS(`${base}/blocks/store-locator-detail/store-locator-detail.css`);

  block.classList.add('store-locator-detail');
  block.setAttribute('aria-busy', 'true');
  block.innerHTML = '<p>Loading installer details…</p>';

  const endpoint = resolveEndpoint({});
  const urlKey = getUrlKey();

  if (!endpoint) {
    block.removeAttribute('aria-busy');
    block.innerHTML = '<p class="store-locator-detail__error">Location details are unavailable right now.</p>';
    return;
  }

  if (!urlKey) {
    block.removeAttribute('aria-busy');
    block.innerHTML = '<p class="store-locator-detail__error">Invalid location URL.</p>';
    return;
  }

  try {
    const result = await fetchLocation(endpoint, urlKey);
    block.removeAttribute('aria-busy');

    if (!result?.location) {
      block.innerHTML = '<p class="store-locator-detail__error">Sorry, we couldn\'t find that installer.</p>';
      return;
    }

    const { location, config } = result;
    document.title = `${location.name || 'Installer'} | Installer Finder`;
    renderLocation(block, location);
    const mapEl = block.querySelector('#store-locator-detail-map');
    if (mapEl) initMap(mapEl, location, config.google_api_key || '');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('store-locator-detail: failed to load location', error);
    block.removeAttribute('aria-busy');
    block.innerHTML = '<p class="store-locator-detail__error">Sorry, we couldn\'t load this location right now.</p>';
  }
}
