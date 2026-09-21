import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { readBlockConfig } from '../../scripts/aem.js';

/*
 * Testimonials Block
 * Renders approved customer testimonials managed in the Adobe Commerce Admin by
 * the Eighteentech_Testimonial App Builder app. Data is fetched at runtime from
 * the app's `testimonial/list` web action (no build step, no server side).
 *
 * The API base URL is NOT hardcoded here — it comes from config.json
 * (`testimonials-endpoint`, under public.default). An authored block may still
 * override it per-instance:
 *   | Testimonials |
 *   | endpoint | https://<ns>.adobeioruntime.net/api/v1/web/testimonial |
 *   | per-page | 50            |
 *
 * Mirrors the legacy storefront markup at /testimonials/index/index:
 *   image (left) + description text + author name.
 */

/**
 * Resolve the testimonial API base URL. Precedence:
 *   1. authored block config (`endpoint`)
 *   2. config.json -> public.default.testimonials-endpoint
 * @param {object} config parsed block config
 * @returns {string} base URL (no trailing slash), or '' if unconfigured
 */
function resolveEndpoint(config) {
  let { endpoint } = config;
  if (!endpoint) {
    try {
      endpoint = getConfigValue('testimonials-endpoint');
    } catch (e) {
      // config.json not initialized yet — leave empty, handled by caller
    }
  }
  return (endpoint || '').replace(/\/$/, '');
}

/**
 * Build the image URL for a stored testimonial image. The app persists images
 * in App Builder Files and streams them back through the `image-get` action,
 * e.g. `${endpoint}/image-get?path=testimonial%2F1%2Fphoto.png`.
 * @param {string} endpoint base testimonial action URL
 * @param {string} path stored image path (record.image)
 * @returns {string} absolute URL to the image
 */
function imageUrl(endpoint, path) {
  if (/^https?:\/\//.test(path)) return path;
  return `${endpoint}/image-get?path=${encodeURIComponent(path)}`;
}

/**
 * Render a single testimonial row.
 * @param {object} t testimonial record from the API
 * @param {string} endpoint base testimonial action URL
 * @returns {HTMLElement} the <li> row
 */
function renderTestimonial(t, endpoint) {
  const li = document.createElement('li');
  li.className = 'testimonials-item';

  // Quote body (title + description).
  const body = document.createElement('div');
  body.className = 'testimonials-body';

  // Only render the title when it has real content. Skip missing/blank values
  // and the literal "no title" placeholder (any case/spacing) the admin stores
  // when a testimonial has no title.
  const rawTitle = (t.title || '').trim();
  const title = /^no[\s_-]*title$/i.test(rawTitle) ? '' : rawTitle;
  if (title) {
    const h = document.createElement('h3');
    h.className = 'testimonials-title';
    h.textContent = title;
    body.append(h);
  }

  // `text` is the long (HTML) description; fall back to the short description.
  // A testimonial is a quotation, so render it in a <blockquote> for semantics
  // and accessibility.
  const desc = document.createElement('blockquote');
  desc.className = 'testimonials-description';
  // Content is authored HTML from a trusted Admin; render as-is like the legacy
  // storefront did. If untrusted authors gain access, sanitize here.
  desc.innerHTML = t.text || t.description || '';
  body.append(desc);

  li.append(body);

  // Attribution footer: avatar + author name/company.
  if (t.image || t.author) {
    const footer = document.createElement('div');
    footer.className = 'testimonials-footer';

    if (t.image) {
      const figure = document.createElement('figure');
      figure.className = 'testimonials-image';
      // API-served image (not an AEM-optimized asset), so use a plain <img>.
      const img = document.createElement('img');
      img.src = imageUrl(endpoint, t.image);
      img.alt = t.author || t.title || 'Testimonial';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 96;
      img.height = 96;
      figure.append(img);
      footer.append(figure);
    }

    if (t.author) {
      const attribution = document.createElement('div');
      attribution.className = 'testimonials-attribution';
      // <cite> is the semantic element for the source of a quotation.
      const author = document.createElement('cite');
      author.className = 'testimonials-author';
      author.textContent = t.author;
      attribution.append(author);
      if (t.customer) {
        const company = document.createElement('span');
        company.className = 'testimonials-company';
        company.textContent = t.customer;
        attribution.append(company);
      }
      footer.append(attribution);
    }

    li.append(footer);
  }

  return li;
}

const DEFAULT_PER_PAGE = 12; // 4 rows x 3 columns on desktop

/**
 * Render the pagination control (Magento-style: "Items X to Y of Z total" plus
 * page buttons and prev/next). No-op when everything fits on one page.
 * @param {HTMLElement} nav container to render into
 * @param {{page:number, perPage:number, total:number, onNav:(p:number)=>void}} state
 */
function renderPagination(nav, {
  page, perPage, total, onNav,
}) {
  nav.textContent = '';
  const pages = Math.ceil(total / perPage);
  if (pages <= 1) return;

  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  const info = document.createElement('span');
  info.className = 'testimonials-pagination__info';
  info.textContent = `Items ${start} to ${end} of ${total} total`;

  const ul = document.createElement('ul');
  ul.className = 'testimonials-pagination__pages';

  const addButton = (label, target, {
    ariaLabel, current, arrow,
  } = {}) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = `testimonials-pagination__page${arrow ? ' testimonials-pagination__arrow' : ''}`;
    if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
    if (current) {
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.addEventListener('click', () => onNav(target));
    }
    li.append(btn);
    ul.append(li);
  };

  if (page > 1) addButton('‹', page - 1, { ariaLabel: 'Previous page', arrow: true });
  for (let p = 1; p <= pages; p += 1) {
    addButton(String(p), p, { current: p === page, ariaLabel: `Page ${p}` });
  }
  if (page < pages) addButton('›', page + 1, { ariaLabel: 'Next page', arrow: true });

  nav.append(info, ul);
}

/**
 * Local cache for a page response so a refresh can paint instantly while the
 * network request (which may hit an App Builder cold start) revalidates in the
 * background. Best-effort — never throws if storage is unavailable.
 */
function cacheKey(endpoint, perPage, page) {
  return `testimonials:${endpoint}:${perPage}:${page}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // storage full/unavailable — caching is optional
  }
}

/** Placeholder skeleton cards shown on the first load (no cache yet). */
function buildSkeleton(count) {
  const list = document.createElement('ul');
  list.className = 'testimonials-list testimonials-list--loading';
  list.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i += 1) {
    const li = document.createElement('li');
    li.className = 'testimonials-item testimonials-item--skeleton';
    // Static markup (no user data) — safe to set as innerHTML.
    li.innerHTML = `
      <div class="testimonials-body">
        <span class="testimonials-skeleton testimonials-skeleton--line"></span>
        <span class="testimonials-skeleton testimonials-skeleton--line"></span>
        <span class="testimonials-skeleton testimonials-skeleton--line testimonials-skeleton--short"></span>
      </div>
      <div class="testimonials-footer">
        <span class="testimonials-skeleton testimonials-skeleton--avatar"></span>
        <span class="testimonials-skeleton testimonials-skeleton--name"></span>
      </div>`;
    list.append(li);
  }
  return list;
}

/**
 * loads and decorates the block
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const config = readBlockConfig(block);
  const endpoint = resolveEndpoint(config);
  const perPage = parseInt(config['per-page'] || config.perpage, 10) || DEFAULT_PER_PAGE;

  block.textContent = '';

  if (!endpoint) {
    // eslint-disable-next-line no-console
    console.error('testimonials: no endpoint configured (config.json -> testimonials-endpoint)');
    const err = document.createElement('p');
    err.className = 'testimonials-error';
    err.textContent = 'Testimonials are temporarily unavailable.';
    block.append(err);
    return;
  }

  // Results container (holds the list or an empty/error message) + pager.
  const results = document.createElement('div');
  results.className = 'testimonials-results';
  const pager = document.createElement('nav');
  pager.className = 'testimonials-pagination';
  pager.setAttribute('aria-label', 'Testimonials pages');
  block.append(results, pager);

  const showMessage = (className, text) => {
    results.textContent = '';
    pager.textContent = '';
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    results.append(p);
  };

  // Render a page response (list + pager) into the DOM.
  const renderData = (data, page) => {
    const testimonials = (data && data.testimonials) || [];
    const total = Number(data && data.total) || testimonials.length;

    if (!testimonials.length) {
      showMessage('testimonials-empty', 'No testimonials yet. Check back soon!');
      return;
    }

    // Build every row off-DOM and attach in a single insertion.
    const list = document.createElement('ul');
    list.className = 'testimonials-list';
    const fragment = document.createDocumentFragment();
    testimonials.forEach((t) => fragment.append(renderTestimonial(t, endpoint)));
    list.append(fragment);

    results.textContent = '';
    results.append(list);
    renderPagination(pager, {
      page, perPage, total, onNav: (p) => loadPage(p, true),
    });
  };

  async function loadPage(page, scroll = false) {
    const key = cacheKey(endpoint, perPage, page);

    // 1) Paint cached data immediately (instant on refresh); otherwise show a
    //    skeleton so the page isn't blank while the request runs.
    const cached = readCache(key);
    if (cached) {
      renderData(cached, page);
    } else {
      results.textContent = '';
      pager.textContent = '';
      results.append(buildSkeleton(Math.min(perPage, 3)));
    }

    // 2) Revalidate from the network.
    const params = new URLSearchParams({
      approve: '1',
      perPage: String(perPage),
      page: String(page),
    });
    try {
      const resp = await fetch(`${endpoint}/list?${params.toString()}`);
      if (!resp.ok) throw new Error(`Request failed: ${resp.status}`);
      const data = await resp.json();
      writeCache(key, data);
      // Re-render only if nothing was shown yet or the data actually changed
      // (avoids a flicker when the cache was already current).
      if (!cached || JSON.stringify(cached) !== JSON.stringify(data)) {
        renderData(data, page);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('testimonials: failed to load', error);
      // Keep cached content if we have it; only surface an error on a cold load.
      if (!cached) showMessage('testimonials-error', 'Testimonials are temporarily unavailable.');
    }

    if (scroll) block.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  loadPage(1);
}
