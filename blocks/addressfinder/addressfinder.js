import { readBlockConfig, loadScript } from '../../scripts/aem.js';

/**
 * AddressFinder block.
 *
 * Reads its settings from the public AddressFinder GraphQL endpoint (which is
 * driven by the App Builder configuration), then loads the AddressFinder widget
 * and binds it to address input fields. The widget follows the customer's
 * shipping country: whenever the country changes the config is re-queried and
 * the widget is re-initialised (or torn down when the country isn't enabled).
 */

// Default public GraphQL endpoint (CORS enabled, no auth). Overridable per block.
export const DEFAULT_ENDPOINT = 'https://993145-faq-devsushil.adobeio-static.net/api/v1/web/AddressFinderMenuId/addressfinder-graphql';

// AddressFinder widget library.
const WIDGET_SRC = 'https://api.addressfinder.io/assets/v3/widget.js';

const CONFIG_QUERY = `query AddressFinder($country: String) {
  addressFinderConfig(shippingCountry: $country) {
    enabled
    country
    country_name
    api_key
    environment
    service_country
    show_on_checkout
    show_on_customer_address
    layout
    max_results
    placeholder_text
    show_metadata
    allow_post_boxes
  }
}`;

/**
 * Runs a GraphQL query against the AddressFinder endpoint.
 * @param {string} endpoint GraphQL endpoint URL
 * @param {string} query GraphQL query string
 * @param {Object} [variables] Query variables
 * @returns {Promise<Object>} The `data` payload
 */
export async function addressFinderGql(endpoint, query, variables = {}) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AddressFinder GraphQL request failed: ${res.status}`);
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(errors.map((e) => e.message).join('; '));
  return data;
}

/**
 * Resolves the AddressFinder config for a given shipping country.
 * @param {string} endpoint GraphQL endpoint URL
 * @param {string} [shippingCountry] ISO alpha-2 code, omit for master-switch state
 * @returns {Promise<Object>} The resolved config
 */
export async function fetchConfig(endpoint, shippingCountry) {
  const { addressFinderConfig } = await addressFinderGql(
    endpoint || DEFAULT_ENDPOINT,
    CONFIG_QUERY,
    shippingCountry ? { country: shippingCountry } : {},
  );
  return addressFinderConfig;
}

// Keeps track of live widget instances so we can tear them down on country change.
const widgets = new WeakMap();

/**
 * Removes any AddressFinder widget previously bound to an input.
 * @param {HTMLInputElement} input The address input element
 */
export function teardownWidget(input) {
  const widget = widgets.get(input);
  if (widget) {
    if (typeof widget.destroy === 'function') widget.destroy();
    widgets.delete(input);
  }
}

/**
 * Initialises the AddressFinder widget on a single input.
 * @param {HTMLInputElement} input The address input element
 * @param {Object} cfg Resolved AddressFinder config
 * @param {string} country ISO alpha-2 shipping country code
 * @param {(fullAddress: string, metaData: Object) => void} [onSelect] Selection handler
 */
function initWidget(input, cfg, country, onSelect) {
  teardownWidget(input);
  // eslint-disable-next-line no-undef
  const widget = new AddressFinder.Widget(input, cfg.api_key, country, {
    address_params: {},
    max_results: cfg.max_results,
    show_addresses: true,
    show_locations: false,
    show_points_of_interest: false,
    show_country_prefix: false,
    show_metadata: cfg.show_metadata,
    exclude_post_box: !cfg.allow_post_boxes,
    manual_style: cfg.layout === 'inline',
  });
  if (typeof onSelect === 'function') {
    // Fired for both AU ('address:select') and NZ ('result:select') widgets.
    widget.on('result:select', (fullAddress, metaData) => onSelect(fullAddress, metaData));
    widget.on('address:select', (fullAddress, metaData) => onSelect(fullAddress, metaData));
  }
  if (cfg.placeholder_text) input.setAttribute('placeholder', cfg.placeholder_text);
  input.closest('.addressfinder')?.setAttribute('data-layout', cfg.layout || 'below');
  widgets.set(input, widget);
  return widget;
}

/**
 * Sets up (or tears down) the AddressFinder widget for the current shipping
 * country. Call this whenever the shipping country changes.
 * @param {Object} params
 * @param {string} params.endpoint GraphQL endpoint URL
 * @param {string} params.shippingCountry ISO alpha-2 code
 * @param {HTMLInputElement[]} params.inputs Address inputs to bind
 * @param {'checkout'|'customer-address'} [params.surface] Where the widget renders
 * @returns {Promise<Object|null>} The resolved config, or null when disabled
 */
export async function setupAddressFinder({
  endpoint = DEFAULT_ENDPOINT,
  shippingCountry,
  inputs,
  surface = 'checkout',
  onSelect,
}) {
  let cfg;
  try {
    cfg = await fetchConfig(endpoint, shippingCountry);
  } catch (err) {
    // Leave the native field intact if the config can't be resolved.
    // eslint-disable-next-line no-console
    console.error('AddressFinder: unable to resolve config', err);
    inputs.forEach(teardownWidget);
    return null;
  }

  const allowedHere = surface === 'customer-address'
    ? cfg.show_on_customer_address
    : cfg.show_on_checkout;

  if (!cfg.enabled || !allowedHere) {
    inputs.forEach(teardownWidget);
    return cfg;
  }

  await loadScript(WIDGET_SRC);
  // The widget script may take a tick to expose the global constructor.
  if (typeof AddressFinder === 'undefined') {
    // eslint-disable-next-line no-console
    console.error('AddressFinder: widget library failed to load');
    return cfg;
  }
  inputs.forEach((input) => initWidget(input, cfg, cfg.country || shippingCountry, onSelect));
  return cfg;
}

/**
 * Reads the current shipping country from a country <select> or <input>.
 * @param {Element} scope Element to search within
 * @returns {string} ISO alpha-2 code (uppercased) or empty string
 */
function readCountry(scope) {
  const field = scope.querySelector(
    'select[name*="country" i], select[name*="countryCode" i], input[name*="country" i]',
  );
  return (field?.value || '').trim().toUpperCase();
}

// The Adobe account/checkout AddressForm dropin renders each field as
// `input[name="AddressFormInput_<code>"]`.
const AEM_FIELD_PREFIX = 'AddressFormInput_';
const AEM_STREET_SELECTOR = `input[name="${AEM_FIELD_PREFIX}street"]`;
const AEM_COUNTRY_SELECTOR = `[name="${AEM_FIELD_PREFIX}country_code"]`;

/**
 * Sets a dropin address field value and notifies its state via input/change.
 * @param {Element} scope Element to search within
 * @param {string} code Field code (e.g. "city", "postcode")
 * @param {string} value Value to set
 */
function setAemField(scope, code, value) {
  if (value == null || value === '') return;
  const field = scope.querySelector(`[name="${AEM_FIELD_PREFIX}${code}"]`);
  if (!field) return;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Fills an Adobe AddressForm from an AddressFinder selection. Handles both the
 * AU and NZ metadata shapes defensively.
 * @param {Element} form The address form element
 * @param {string} fullAddress The selected full address string
 * @param {Object} [meta] The AddressFinder metadata
 */
function fillAemAddress(form, fullAddress, meta = {}) {
  const region = meta.state_territory || meta.region || '';
  setAemField(form, 'street', meta.address_line_1 || fullAddress);
  setAemField(form, 'street_multiline_2', meta.address_line_2 || '');
  setAemField(form, 'city', meta.locality_name || meta.city || meta.suburb || '');
  setAemField(form, 'region', region);
  setAemField(form, 'region_code', region);
  setAemField(form, 'postcode', meta.postcode);
}

/**
 * Binds the AddressFinder widget to every Adobe AddressForm (account or
 * checkout dropin) rendered inside `root`, filling the form on selection.
 * The forms render/re-render asynchronously, so binding is driven by a
 * MutationObserver and guarded so each field is set up once per country.
 * @param {Element} root Element containing one or more AddressForm dropins
 * @param {Object} [options]
 * @param {'checkout'|'customer-address'} [options.surface] Gating surface
 * @param {string} [options.defaultCountry] Fallback country (e.g. "AU")
 * @param {string} [options.endpoint] GraphQL endpoint override
 * @returns {() => void} A function that disconnects the observer
 */
export function enhanceAemAddressForms(root, options = {}) {
  const { surface = 'checkout', defaultCountry = '', endpoint } = options;

  const bindOne = async (streetInput) => {
    const form = streetInput.closest('form') || root;
    const country = readCountry(form) || defaultCountry;
    if (streetInput.dataset.afBound === country) return;
    streetInput.dataset.afBound = country;
    await setupAddressFinder({
      endpoint,
      shippingCountry: country,
      inputs: [streetInput],
      surface,
      onSelect: (fullAddress, meta) => fillAemAddress(form, fullAddress, meta),
    });
    const countryField = form.querySelector(AEM_COUNTRY_SELECTOR);
    if (countryField && !countryField.dataset.afCountryListener) {
      countryField.dataset.afCountryListener = 'true';
      countryField.addEventListener('change', () => bindOne(streetInput));
    }
  };

  const bindAll = () => {
    root.querySelectorAll(AEM_STREET_SELECTOR).forEach((input) => bindOne(input));
  };

  bindAll();
  const observer = new MutationObserver(bindAll);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const cfg = readBlockConfig(block);
  const endpoint = cfg.endpoint || DEFAULT_ENDPOINT;
  const surface = cfg.surface === 'customer-address' ? 'customer-address' : 'checkout';
  const defaultCountry = (cfg['default-country'] || '').trim().toUpperCase();

  // Selector for the address input(s) the widget should bind to. Defaults to a
  // single input rendered inside the block for standalone / demo usage.
  const inputSelector = cfg['input-selector'] || '.addressfinder input[type="search"], .addressfinder input[type="text"]';
  // Selector for the form (or region) whose country field drives the widget.
  const formSelector = cfg['form-selector'];

  block.textContent = '';

  // When no external input is targeted, render a standalone search input so the
  // block is usable on its own (e.g. an address lookup landing block).
  if (!cfg['input-selector']) {
    const label = document.createElement('label');
    label.className = 'addressfinder-label';
    label.textContent = cfg.label || 'Find your address';
    const input = document.createElement('input');
    input.type = 'search';
    input.className = 'addressfinder-input';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', label.textContent);
    label.append(input);
    block.append(label);
  }

  const getInputs = () => [...document.querySelectorAll(inputSelector)]
    .filter((el) => el instanceof HTMLInputElement);

  const scope = formSelector ? document.querySelector(formSelector) : block;

  const refresh = async () => {
    const inputs = getInputs();
    if (!inputs.length) return;
    const country = (scope && readCountry(scope)) || defaultCountry;
    await setupAddressFinder({
      endpoint,
      shippingCountry: country,
      inputs,
      surface,
    });
  };

  await refresh();

  // Re-query whenever the shipping country changes so the widget follows the
  // destination country.
  if (scope) {
    const countryField = scope.querySelector(
      'select[name*="country" i], select[name*="countryCode" i], input[name*="country" i]',
    );
    countryField?.addEventListener('change', refresh);
  }

  // Also follow the commerce checkout event bus when it is present.
  try {
    const { events } = await import('@dropins/tools/event-bus.js');
    events.on('checkout/updated', refresh);
  } catch {
    // event bus not available in this context — safe to ignore.
  }
}
