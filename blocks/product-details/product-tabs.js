// Product info tabs for the PDP.
//
// Renders a tabbed panel (Description / Specs / Instructions / Returns /
// Community Q&A) below the product. Which tabs appear, their order, labels and
// content sources are configured in config.json under `pdp-tabs` — see
// getTabsConfig() for the shape. A tab is skipped when it has no content (e.g.
// a product without an `installation_link` attribute won't show that tab), so
// the tab set adapts per product.
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { CS_FETCH_GRAPHQL } from '../../scripts/commerce.js';
import { fetchCmsBlock } from '../../scripts/cms-block.js';
import { fetchAttachments } from '../../scripts/attachments.js';

// Fallback config if config.json has no `pdp-tabs`.
const DEFAULT_TABS = [{ label: 'Description', source: 'description' }];

// The  PDP dropin's product (pdp/data) only carries PDP-visible attributes, so
// attributes flagged for other roles (e.g. compare-list only) are missing.
// We fetch the full attribute set by SKU so any configured attribute can drive
// a tab regardless of its storefront role. Cached per SKU for the session.
const ATTRS_QUERY = `
  query PRODUCT_ATTRS($skus: [String!]!) {
    products(skus: $skus) {
      __typename
      ... on SimpleProductView { attributes { name value } }
      ... on ComplexProductView { attributes { name value } }
    }
  }
`;
const attrCache = new Map();

async function fetchAttributes(sku) {
  if (attrCache.has(sku)) return attrCache.get(sku);
  const promise = CS_FETCH_GRAPHQL
    .fetchGraphQl(ATTRS_QUERY, { method: 'GET', variables: { skus: [sku] } })
    .then(({ data, errors }) => {
      if (errors?.length) return {};
      const map = {};
      (data?.products?.[0]?.attributes || []).forEach((a) => {
        if (a && a.name) map[a.name] = a.value;
      });
      return map;
    })
    .catch(() => ({}));
  attrCache.set(sku, promise);
  return promise;
}

/**
 * Tab definitions from config.json. Each entry:
 *   { label, source, ... }
 * where `source` is one of:
 *   - "description"          product long description
 *   - "attribute"            a product attribute; needs `attribute` (code).
 *                            Optional `render: "link"` + `linkText` to show the
 *                            value as a link (e.g. installation_link/brochure).
 *   - "fragment"            an EDS fragment; needs `path` (used for CMS-block-
 *                            style content such as a shared Returns policy —
 *                            the SaaS GraphQL doesn't expose CMS blocks).
 *   - "cms-block"            a block from the CMS Block Builder app; needs
 *                            `identifier` (URL key). Fetched from the public
 *                            delivery API (`cms-render-endpoint` in config.json).
 *   - "link"                 a static link; needs `href` + `linkText`.
 * @returns {Array<object>}
 */
function getTabsConfig() {
  try {
    const cfg = getConfigValue('pdp-tabs');
    return Array.isArray(cfg) && cfg.length ? cfg : DEFAULT_TABS;
  } catch (e) {
    return DEFAULT_TABS;
  }
}

/**
 * Warm `fetchCmsBlock`'s cache for any `cms-block`-sourced tabs (e.g.
 * "Returns") ahead of time — their identifier doesn't depend on product data,
 * so this can run as soon as the block decorates, well before `pdp/data`
 * fires and `renderProductTabs` actually needs the result. Shaves a full
 * round-trip (these are Adobe I/O Runtime actions, which can be slow on a
 * cold start) off the tabs' perceived load time. Best-effort, fire-and-forget.
 */
export function prefetchCmsBlockTabs() {
  getTabsConfig()
    .filter((tab) => tab.source === 'cms-block' && tab.identifier)
    .forEach((tab) => fetchCmsBlock(tab.identifier));
}

const isUrl = (s) => /^https?:\/\//i.test(s);

/** Read an attribute value from the merged code->value map (''if missing/blank). */
function attrValue(attrs, code) {
  const v = attrs[code];
  return v != null ? String(v).trim() : '';
}

function makeLink(href, text, className) {
  const a = document.createElement('a');
  a.className = className;
  a.href = href || '#';
  a.textContent = text || 'Link';
  if (isUrl(href)) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

/** Best-effort filename fallback when a file has no explicit label. */
function fileNameOf(url) {
  try {
    const clean = url.split('?')[0].split('#')[0];
    return decodeURIComponent(clean.split('/').pop() || url);
  } catch (e) {
    return url;
  }
}

/**
 * Parse a product's `attachment_files` attribute value into a list of
 * { label, url } entries. Adobe Commerce "file"/gallery-style attributes are
 * typically stored as a JSON array (of strings or {title/name/label, file/url/
 * path} objects); some setups instead use a simple comma/newline separated
 * list of URLs (optionally "Label|URL"). Handle both, skip anything else.
 * @param {string} value raw attribute value
 * @returns {Array<{label: string, url: string}>}
 */
function parseAttachments(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) return [];

  const toEntry = (item) => {
    if (!item) return null;
    if (typeof item === 'string') {
      const url = item.trim();
      return url ? { label: fileNameOf(url), url } : null;
    }
    if (typeof item === 'object') {
      const url = item.url || item.file || item.path || item.href || '';
      if (!url) return null;
      const label = item.title || item.name || item.label || fileNameOf(url);
      return { label, url };
    }
    return null;
  };

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map(toEntry).filter(Boolean);
    } catch (e) {
      // Fall through to delimited parsing below.
    }
  }

  return trimmed
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [labelPart, urlPart] = part.includes('|') ? part.split('|') : [null, part];
      const url = (urlPart || part).trim();
      return { label: (labelPart || fileNameOf(url)).trim(), url };
    })
    .filter((entry) => entry.url);
}

/** Build a table of attachment links, or null when there are none. */
function buildAttachmentsTable(value) {
  const files = parseAttachments(value);
  if (!files.length) return null;

  const table = document.createElement('table');
  table.className = 'product-tabs__attachments';

  const tbody = document.createElement('tbody');
  files.forEach(({ label, url }) => {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.append(makeLink(url, label, 'product-tabs__link'));
    row.append(cell);
    tbody.append(row);
  });
  table.append(tbody);
  return table;
}

/** Human-readable file size (e.g. "1.22 MB"), or '' when unknown/zero. */
function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** Strip a filename's extension, e.g. "brochure.pdf" -> "brochure". */
function baseNameOf(name) {
  const parts = String(name || '').split('.');
  if (parts.length > 1) parts.pop();
  return parts.join('.');
}

/**
 * Build a table of Product Attachments app files, or null when there are
 * none. Each row shows the attachment's label and file size, e.g.
 * "GT1-4_Caravan_Filter_Instructions_Warranty (1.22 MB)".
 * @param {Array<{title?: string, fileName?: string, sizeBytes?: number, url: string}>} items
 */
function buildApiAttachmentsTable(items) {
  if (!items || !items.length) return null;

  const table = document.createElement('table');
  table.className = 'product-tabs__attachments';

  const tbody = document.createElement('tbody');
  items.forEach((item) => {
    const label = (item.title || '').trim() || baseNameOf(item.fileName) || 'Download';
    const size = formatFileSize(item.sizeBytes);

    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.append(makeLink(item.url, label, 'product-tabs__link'));
    if (size) {
      const meta = document.createElement('span');
      meta.className = 'product-tabs__meta';
      meta.textContent = ` (${size})`;
      cell.append(meta);
    }
    row.append(cell);
    tbody.append(row);
  });
  table.append(tbody);
  return table;
}

/**
 * Build the content node for a tab, or null when there's nothing to show.
 * @param {object} tab tab config
 * @param {object} product product data (pdp/data)
 * @param {object} attrs merged attribute code->value map
 * @returns {Promise<HTMLElement|null>}
 */
async function buildTabContent(tab, product, attrs) {
  const content = document.createElement('div');
  content.className = 'product-tabs__content';

  switch (tab.source) {
    case 'description': {
      const html = (product.description || '').trim();
      if (!html) return null;
      content.innerHTML = html; // trusted, authored product HTML
      return content;
    }

    case 'attribute': {
      const value = attrValue(attrs, tab.attribute);
      if (!value) return null;
      // Render as a link only when the value is an actual URL; otherwise show
      // the value as HTML/text (e.g. the `spec` HTML table, or a file label).
      if (isUrl(value)) {
        content.append(makeLink(value, tab.linkText || tab.label, 'product-tabs__link'));
      } else {
        content.innerHTML = value; // trusted, authored attribute HTML
      }
      return content;
    }

    case 'fragment': {
      if (!tab.path) return null;
      try {
        // Lazy import to avoid a static import cycle with the block pipeline.
        const { loadFragment } = await import('../fragment/fragment.js');
        const frag = await loadFragment(tab.path);
        if (!frag || !frag.children.length) return null;
        content.append(...frag.children);
        return content;
      } catch (e) {
        return null;
      }
    }

    case 'cms-block': {
      const html = await fetchCmsBlock(tab.identifier);
      if (!html) return null;
      content.classList.add('cms-block');
      content.innerHTML = html; // sanitized server-side by the CMS Block Builder
      return content;
    }

    case 'link': {
      content.append(makeLink(tab.href, tab.linkText || tab.label, 'product-tabs__link'));
      return content;
    }

    case 'yotpo-qa': {
      // Lazy import to avoid a static import cycle with the block pipeline.
      const { renderQaTabContent } = await import('../../scripts/yotpo.js');
      await renderQaTabContent(content);
      return content;
    }

    case 'attachments': {
      const table = buildAttachmentsTable(attrValue(attrs, tab.attribute));
      if (!table) return null;
      content.append(table);
      return content;
    }

    case 'attachments-api': {
      if (!product.sku) return null;
      const items = await fetchAttachments(product.sku);
      const table = buildApiAttachmentsTable(items);
      if (!table) return null;
      content.append(table);
      return content;
    }

    default:
      return null;
  }
}

/** Insert `el` among `wrap`'s children in ascending `data-tab-index` order. */
function insertByTabIndex(wrap, el, tabIndex) {
  el.dataset.tabIndex = tabIndex;
  const next = [...wrap.children].find((child) => Number(child.dataset.tabIndex) > tabIndex);
  if (next) wrap.insertBefore(el, next);
  else wrap.append(el);
}

/**
 * Render the product tabs into `container` for the given product. Each tab's
 * content is fetched independently and inserted (in configured order) as
 * soon as it resolves, rather than waiting for every tab (some of which hit
 * slow third-party APIs, e.g. attachments/CMS-block) before showing any of
 * them — so fast tabs (description, attributes already on the product)
 * appear immediately instead of being blocked by the slowest one.
 * No-op when there's no content. Best-effort — never throws.
 * @param {HTMLElement} container target element
 * @param {object} product product data (must include sku)
 */
export default async function renderProductTabs(container, product) {
  if (!container || !product) return;

  const tabs = getTabsConfig();
  container.textContent = '';
  if (!tabs.length) return;

  // Attributes already on the product (PDP-visible) are available
  // immediately; only tabs that need an attribute missing from that set wait
  // on the full-attribute-set-by-SKU fetch, instead of gating every tab on it.
  const attrs = {};
  (product.attributes || []).forEach((a) => { if (a && a.name) attrs[a.name] = a.value; });
  const missingAttr = tabs.some((t) => t.source === 'attribute' && !attrs[t.attribute]);
  const attrsReady = missingAttr && product.sku
    ? fetchAttributes(product.sku).then((extra) => Object.assign(attrs, extra))
    : Promise.resolve();

  const root = document.createElement('div');
  root.className = 'product-tabs';

  const tablist = document.createElement('div');
  tablist.className = 'product-tabs__list';
  tablist.setAttribute('role', 'tablist');

  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'product-tabs__panels';

  const getButtons = () => [...tablist.children];
  const getPanels = () => [...panelsWrap.children];

  const activate = (idx) => {
    getButtons().forEach((b, i) => {
      b.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      b.tabIndex = i === idx ? 0 : -1;
    });
    getPanels().forEach((p, i) => { p.hidden = i !== idx; });
  };

  // Keyboard navigation between tabs (Left/Right/Home/End). Reads the
  // current DOM order each time, since tabs may still be arriving.
  tablist.addEventListener('keydown', (e) => {
    const buttons = getButtons();
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    let next = null;
    if (e.key === 'ArrowRight') next = (current + 1) % buttons.length;
    else if (e.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    if (next === null) return;
    e.preventDefault();
    activate(next);
    buttons[next].focus();
  });

  root.append(tablist, panelsWrap);
  container.append(root);

  let activated = false;
  await Promise.all(tabs.map(async (tab, tabIndex) => {
    if (tab.source === 'attribute') await attrsReady;
    const content = await buildTabContent(tab, product, attrs);
    if (!content) return;

    const panelId = `product-tab-panel-${tabIndex}`;
    const tabId = `product-tab-${tabIndex}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'product-tabs__tab';
    btn.id = tabId;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', panelId);
    btn.setAttribute('aria-selected', 'false');
    btn.tabIndex = -1;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => activate(getButtons().indexOf(btn)));

    const panel = document.createElement('div');
    panel.className = 'product-tabs__panel';
    panel.id = panelId;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
    panel.hidden = true;
    panel.append(content);

    // Set as not-active by default (above) since tabs can arrive after the
    // first one is already active; activate() below corrects the very first
    // arrival to be the active tab.
    insertByTabIndex(tablist, btn, tabIndex);
    insertByTabIndex(panelsWrap, panel, tabIndex);

    // Activate whichever tab arrives first; later arrivals (even with a
    // lower configured index) don't steal focus from an already-active tab.
    if (!activated) {
      activated = true;
      activate(getButtons().indexOf(btn));
    }
  }));

  if (!tablist.children.length) container.textContent = '';
}
