// Yotpo customer reviews: a compact star-rating + Q&A summary row just after
// the PDP title, a full reviews widget below the info tabs, and a per-tile
// star-ratings widget on the PLP. The loader script itself lives in
// head.html; this module only places the widget containers and keeps them in
// sync with the current product. Instance IDs are FSA's real widgets, read
// directly out of the account's loader config (see
// https://cdn-widgetsrepository.yotpo.com/v1/loader/<token> -> config.widgets)
// and configured centrally in config.json under `yotpo` (see getYotpoConfig).
import { events } from '@dropins/tools/event-bus.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { getProductSku } from './commerce.js';

// Fallback if config.json has no `yotpo` block (or is missing individual keys).
const DEFAULT_YOTPO_CONFIG = {
  'loader-token': 'MiYqr6pLo4uM7oXnMnqaO13o5qy27pLQHQp9o9zC',
  'pdp-star-summary-instance-id': '1213853', // widget-reviews-star-ratings
  'pdp-reviews-instance-id': '1148154', // widget-reviews-main-widget
  'pdp-qa-instance-id': '1247198', // widget-questions-and-answers
  'plp-star-ratings-instance-id': '1213853', // widget-reviews-star-ratings
};

let yotpoConfig;
/** Yotpo config (`yotpo` in config.json), merged over the defaults above. */
function getYotpoConfig() {
  if (yotpoConfig) return yotpoConfig;
  let configured;
  try {
    configured = getConfigValue('yotpo');
  } catch {
    configured = null;
  }
  yotpoConfig = { ...DEFAULT_YOTPO_CONFIG, ...configured };
  return yotpoConfig;
}

function yotpoLoaderSrc() {
  return `https://cdn-widgetsrepository.yotpo.com/v1/loader/${getYotpoConfig()['loader-token']}`;
}

function detectPageKind(main) {
  if (main?.querySelector('.product-details')) return 'pdp';
  if (main?.querySelector('.product-list-page')) return 'plp';
  return null;
}

/** Load the Yotpo loader script once, in case head.html's tag is ever missing. */
function ensureYotpoLoaderOnce() {
  if (window.__yotpoLoaderEnsured) return;
  window.__yotpoLoaderEnsured = true;
  const src = yotpoLoaderSrc();
  if ([...document.querySelectorAll('script[src]')].some((s) => s.src === src)) return;
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

function tryInitWidgets() {
  // The loader defines a global `yotpoWidgetsContainer` (see the loader
  // script itself) that the widgets-initializer bundle later attaches
  // `initWidgets`/`refreshWidgets` onto — this is the primary API, checked
  // before the legacy `window.yotpo`/`window.Yotpo` globals.
  const container = window.yotpoWidgetsContainer;
  if (typeof container?.initWidgets === 'function') {
    try { container.initWidgets(); return true; } catch { /* not ready yet, retry */ }
  }
  if (typeof container?.refreshWidgets === 'function') {
    try { container.refreshWidgets(); return true; } catch { /* not ready yet, retry */ }
  }

  const yotpo = window.yotpo || window.Yotpo;
  if (typeof yotpo?.initWidgets === 'function') {
    try { yotpo.initWidgets(); return true; } catch { /* not ready yet, retry */ }
  } else if (typeof yotpo?.refreshWidgets === 'function') {
    try { yotpo.refreshWidgets(); return true; } catch { /* not ready yet, retry */ }
  }
  return false;
}

// The loader script is async, so `window.yotpo` isn't guaranteed to exist yet
// when widgets are first placed (we run during the lazy phase). Poll briefly
// until it's ready, rather than a single one-shot call that silently no-ops.
let renderRetryTimer = null;
function triggerRender() {
  if (tryInitWidgets() || renderRetryTimer) return;

  const startedAt = Date.now();
  renderRetryTimer = window.setInterval(() => {
    if (tryInitWidgets() || Date.now() - startedAt > 30000) {
      window.clearInterval(renderRetryTimer);
      renderRetryTimer = null;
    }
  }, 500);
}

function buildWidget(instanceId, attrs) {
  const el = document.createElement('div');
  el.className = 'yotpo-widget-instance';
  el.setAttribute('data-yotpo-instance-id', instanceId);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value) el.setAttribute(key, value);
  });
  return el;
}

/** Current PDP's SKU, same resolution the PDP dropin itself uses. */
function getPdpSku() {
  return getProductSku();
}

/** SKU of a PLP tile, read from the `data-sku` attribute product-list-page.js sets on its link. */
function getTileSku(card) {
  return card?.querySelector('[data-sku]')?.dataset.sku || null;
}

/**
 * Plain, code-owned "Ask a question" link for the title summary row. The Q&A
 * widget itself renders a full empty-state card (heading, illustration text,
 * CTA button) when a product has zero questions — too tall for a compact
 * title-row summary — so its real widget instance lives in its own section
 * (`#yotpo-pdp-qa`) instead, and this link just scrolls there.
 */
function buildAskQuestionLink() {
  const link = document.createElement('a');
  link.href = '#yotpo-pdp-qa';
  link.className = 'yotpo-ask-question-link';
  link.textContent = 'Ask a question';
  link.addEventListener('click', (event) => {
    const target = document.getElementById('yotpo-pdp-qa');
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return link;
}

/**
 * Product metadata Yotpo needs to create/match the product record when a
 * review or question is submitted for it (e.g. missing `data-yotpo-name`
 * causes review submission to fail with "Missing product_title"), sourced
 * from the current `pdp/data` payload.
 * @param {object} product
 */
function pdpMetaAttrs(product) {
  return {
    'data-yotpo-name': product?.name,
    'data-yotpo-url': window.location.href,
    'data-yotpo-image-url': product?.images?.[0]?.url,
  };
}

/**
 * PDP: star-rating summary + "Ask a question" link just after the title, the
 * full reviews widget and the Q&A widget just after the info tabs. Idempotent
 * — safe to call on every `pdp/data` event (initial load + variant
 * switches); only the SKU/product-meta attributes update.
 * @param {object} product current product (pdp/data payload)
 */
function renderPdpWidgets(product) {
  const config = getYotpoConfig();

  const header = document.querySelector('.product-details__header');
  if (header && !document.getElementById('yotpo-pdp-star-summary')) {
    const container = document.createElement('div');
    container.id = 'yotpo-pdp-star-summary';
    container.append(
      buildWidget(config['pdp-star-summary-instance-id'], { 'data-yotpo-section-id': 'product' }),
      buildAskQuestionLink(),
    );
    header.insertAdjacentElement('afterend', container);
  }

  const tabsOrWrapper = document.querySelector('.product-details__tabs') || document.querySelector('.product-details__wrapper');
  if (tabsOrWrapper && !document.getElementById('yotpo-pdp-reviews')) {
    const container = document.createElement('div');
    container.id = 'yotpo-pdp-reviews';
    container.append(buildWidget(config['pdp-reviews-instance-id'], {}));
    tabsOrWrapper.insertAdjacentElement('afterend', container);
  }

  const reviews = document.getElementById('yotpo-pdp-reviews');
  if (reviews && !document.getElementById('yotpo-pdp-qa')) {
    const container = document.createElement('div');
    container.id = 'yotpo-pdp-qa';
    container.append(buildWidget(config['pdp-qa-instance-id'], { 'data-yotpo-section-id': 'product' }));
    reviews.insertAdjacentElement('afterend', container);
  }

  const sku = getPdpSku();
  const metaAttrs = pdpMetaAttrs(product);
  if (sku) {
    document.querySelectorAll('#yotpo-pdp-star-summary .yotpo-widget-instance, #yotpo-pdp-reviews .yotpo-widget-instance, #yotpo-pdp-qa .yotpo-widget-instance')
      .forEach((widget) => {
        widget.setAttribute('data-product-sku', sku);
        Object.entries(metaAttrs).forEach(([key, value]) => {
          if (value) widget.setAttribute(key, value);
        });
      });
  }

  ensureYotpoLoaderOnce();
  triggerRender();

  // NOTE: the main reviews widget and Q&A widget both require Yotpo's real
  // numeric product id (via `data-yotpo-product-id`) — `data-product-sku`
  // alone isn't enough for their v3 storefront API calls, which build an
  // empty (unmatched) product path without it. There is no safe, correct way
  // to obtain that numeric id from the client: it must come from Yotpo's own
  // product catalog sync (a proper Commerce<->Yotpo connector), confirmed
  // absent here — the official SKU-scoped bottomline API
  // (`/v1/widget/<token>/products/<sku>/bottomline`) currently returns zero
  // reviews for every real product. An earlier version of this file guessed
  // the numeric id by sniffing the star-ratings widget's own network calls;
  // that guess was NOT SKU-specific and caused every product's main reviews
  // widget to show ONE unrelated product's reviews. Do not reintroduce that
  // without a verified SKU -> Yotpo product id mapping.
}

/** PLP: a compact star-ratings widget after each (not-yet-processed) tile's price. */
function renderPlpWidgets() {
  const prices = document.querySelectorAll('.dropin-product-item-card__price:not([data-yotpo-done])');
  if (!prices.length) return;

  let didAny = false;
  prices.forEach((price) => {
    price.dataset.yotpoDone = 'true';
    const sku = getTileSku(price.closest('.dropin-product-item-card'));
    if (!sku) return;

    const container = document.createElement('div');
    container.className = 'yotpo-plp-rating';
    container.append(buildWidget(getYotpoConfig()['plp-star-ratings-instance-id'], {
      'data-yotpo-section-id': 'collection',
      'data-product-sku': sku,
    }));
    price.insertAdjacentElement('afterend', container);
    didAny = true;
  });

  if (didAny) {
    ensureYotpoLoaderOnce();
    triggerRender();
  }
}

/*
 * ---------------------------------------------------------------------------
 * Custom-rendered review UI (no Yotpo widget instance involved)
 *
 * Everything below fetches Yotpo's public, CORS-open storefront APIs directly
 * and paints our own markup, instead of embedding a Yotpo widget. Used where a
 * native widget can't do the job: the `yotpo-reviews` block's all-reviews page
 * and the PDP "Community Q&A" tab. All of it takes an explicit Yotpo product
 * id — see the NOTE in renderPdpWidgets: there is no client-side way to derive
 * that id from a SKU on this account, so callers that don't have one get the
 * empty/fallback state rather than another product's reviews.
 * ---------------------------------------------------------------------------
 */

/**
 * Total review count + average score for `productId`, from Yotpo's public
 * bottomline API — the same endpoint the Star Ratings widget itself calls.
 * Unlike that widget's *visual* rendering (a dashboard-side domain
 * restriction paints nothing outside the account's authorized domain), this
 * data endpoint is fully CORS-open, so it works from localhost/preview too.
 * Best-effort: returns `null` on any failure.
 * @param {string} productId
 * @returns {Promise<{totalReviews: number, averageScore: number}|null>}
 */
async function fetchBottomline(productId) {
  try {
    const token = getYotpoConfig()['loader-token'];
    const res = await fetch(`https://api-cdn.yotpo.com/v1/widget/${token}/products/${productId}/bottomline`);
    if (!res.ok) return null;
    const data = await res.json();
    const bottomline = data?.response?.bottomline;
    if (!bottomline || typeof bottomline.total_review !== 'number') return null;
    return { totalReviews: bottomline.total_review, averageScore: bottomline.average_score || 0 };
  } catch {
    return null;
  }
}

/** Five-star row, filled left-to-right by `averageScore` (0-5) via a clipped overlay. */
function buildStarsEl(averageScore) {
  const pct = Math.max(0, Math.min(100, (averageScore / 5) * 100));
  const wrap = document.createElement('span');
  wrap.className = 'yotpo-custom-stars';
  wrap.setAttribute('aria-hidden', 'true');
  const empty = document.createElement('span');
  empty.className = 'yotpo-custom-stars__empty';
  empty.textContent = '★★★★★';
  const filled = document.createElement('span');
  filled.className = 'yotpo-custom-stars__filled';
  filled.style.width = `${pct}%`;
  filled.textContent = '★★★★★';
  wrap.append(empty, filled);
  return wrap;
}

function scrollToPdpReviews(event) {
  const target = document.getElementById('yotpo-pdp-reviews');
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Custom-rendered stars + review-count button, scrolling to the full reviews
 * widget on click. Idempotent: updates the existing button in place if already
 * built; removes it if the product turns out to have zero reviews.
 * @param {HTMLElement} container
 * @param {string} productId
 */
async function ensureCustomBottomline(container, productId) {
  if (!container || !productId) return;
  const data = await fetchBottomline(productId);
  if (!data || data.totalReviews <= 0) {
    container.querySelector('.yotpo-custom-bottomline')?.remove();
    return;
  }

  let btn = container.querySelector('.yotpo-custom-bottomline');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yotpo-custom-bottomline';
    btn.addEventListener('click', scrollToPdpReviews);
    container.prepend(btn);
  }
  btn.setAttribute(
    'aria-label',
    `${data.averageScore.toFixed(1)} out of 5 stars in total ${data.totalReviews} reviews. Jump to reviews.`,
  );
  const count = document.createElement('span');
  count.className = 'yotpo-custom-count';
  count.textContent = `${data.totalReviews} Reviews`;
  btn.replaceChildren(buildStarsEl(data.averageScore), count);
}

/**
 * Yotpo's native Q&A bottom-line ("X Questions \ Y Answers" / "Ask a
 * question"), in its legacy markup form (class + data attributes, no instance
 * id) to be picked up by the widgets-initializer bundle. Handles the
 * zero-questions vs has-questions empty state itself.
 * @param {string} productId
 */
function buildQaBottomLine(productId) {
  const el = document.createElement('div');
  el.className = 'yotpo QABottomLine yotpo-small';
  el.setAttribute('data-appkey', getYotpoConfig()['loader-token']);
  el.setAttribute('data-product-id', productId);
  el.setAttribute('data-yotpo-element-id', '1');
  return el;
}

function ensureQaBottomLine(container, productId) {
  if (!container || !productId) return;
  const existing = container.querySelector('.yotpo.QABottomLine');
  if (existing) existing.setAttribute('data-product-id', productId);
  else container.appendChild(buildQaBottomLine(productId));
}

/**
 * "Community Q&A" PDP tab content: stars + review count plus Yotpo's native
 * Q&A bottom-line. Falls back to a plain "Ask a question" link (the tab's
 * original content) when no Yotpo product id is known or the product has zero
 * reviews, since the star widget has nothing to show in that case.
 * @param {HTMLElement} container
 * @param {string} [productId] Yotpo product id; omit if unknown (see NOTE above)
 */
export async function renderQaTabContent(container, productId) {
  if (!container) return;
  container.textContent = '';

  const data = productId ? await fetchBottomline(productId) : null;
  if (data && data.totalReviews > 0) {
    const row = document.createElement('div');
    row.className = 'yotpo-qa-tab__summary';
    ensureCustomBottomline(row, productId);
    ensureQaBottomLine(row, productId);
    container.append(row);
    return;
  }

  const link = buildAskQuestionLink();
  link.classList.add('product-tabs__link');
  container.append(link);
}

// Yotpo's v3 storefront reviews API caps `perPage` around 150. `fetchAllReviews`
// reads `pagination.total` off the first page to know how many more pages (if
// any) to fetch, capped by REVIEWS_MAX_PAGES as a safety backstop against a
// runaway loop on an unexpectedly huge `total`.
const REVIEWS_PAGE_SIZE = 150;
const REVIEWS_MAX_PAGES = 20;

/** One page of `productId`'s reviews, or `null` on any failure. */
async function fetchReviewsPage(productId, page) {
  try {
    const token = getYotpoConfig()['loader-token'];
    const res = await fetch(
      `https://api-cdn.yotpo.com/v3/storefront/store/${token}/product/${productId}/reviews`
      + `?page=${page}&perPage=${REVIEWS_PAGE_SIZE}&sort=rating,badge,date,images`,
    );
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Every review for `productId`, from Yotpo's public v3 storefront reviews API
 * (the same CORS-open family as fetchBottomline). Fetches the first page to
 * learn `pagination.total`, then any remaining pages in parallel. Best-effort:
 * a failed page just contributes nothing, rather than losing the reviews other
 * pages did fetch.
 * @param {string} productId
 * @returns {Promise<Array<object>>}
 */
async function fetchAllReviews(productId) {
  const first = await fetchReviewsPage(productId, 1);
  const reviews = first?.reviews || [];
  const total = first?.pagination?.total ?? reviews.length;
  const pagesNeeded = Math.min(REVIEWS_MAX_PAGES, Math.ceil(total / REVIEWS_PAGE_SIZE));
  if (pagesNeeded <= 1) return reviews;

  const rest = await Promise.all(
    Array.from({ length: pagesNeeded - 1 }, (_, i) => fetchReviewsPage(productId, i + 2)),
  );
  rest.forEach((json) => reviews.push(...(json?.reviews || [])));
  return reviews;
}

/** One review as a card: rating, title, content, author, date, verified badge. */
function buildReviewCard(review) {
  const card = document.createElement('article');
  card.className = 'yotpo-custom-review';

  const header = document.createElement('div');
  header.className = 'yotpo-custom-review__header';
  header.append(buildStarsEl(review.score || 0));
  if (review.title) {
    const title = document.createElement('h3');
    title.className = 'yotpo-custom-review__title';
    title.textContent = review.title;
    header.append(title);
  }
  card.append(header);

  if (review.content) {
    const content = document.createElement('p');
    content.className = 'yotpo-custom-review__content';
    content.textContent = review.content;
    card.append(content);
  }

  const meta = document.createElement('div');
  meta.className = 'yotpo-custom-review__meta';
  const author = review.user?.displayName || 'Anonymous';
  const date = review.createdAt
    ? new Date(review.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
  meta.textContent = [author, review.verifiedBuyer ? 'Verified Buyer' : '', date]
    .filter(Boolean)
    .join(' · ');
  card.append(meta);

  return card;
}

/**
 * Render every review for `productId` on one page — no "load more"/pagination
 * — by fetching them directly (fetchAllReviews) rather than embedding Yotpo's
 * own main reviews widget, which limits itself to a page at a time. Used by
 * the `yotpo-reviews` block when a `productid` row is authored.
 * @param {HTMLElement} container
 * @param {string} productId
 */
export async function renderAllReviews(container, productId) {
  if (!container || !productId) return;

  const [bottomline, reviews] = await Promise.all([
    fetchBottomline(productId),
    fetchAllReviews(productId),
  ]);

  container.textContent = '';

  if (bottomline && bottomline.totalReviews > 0) {
    const summary = document.createElement('div');
    summary.className = 'yotpo-custom-summary';
    const score = document.createElement('span');
    score.className = 'yotpo-custom-summary__score';
    score.textContent = bottomline.averageScore.toFixed(1);
    const count = document.createElement('span');
    count.className = 'yotpo-custom-count';
    count.textContent = `Based on ${bottomline.totalReviews} reviews`;
    summary.append(score, buildStarsEl(bottomline.averageScore), count);
    container.append(summary);
  }

  if (!reviews.length) {
    const empty = document.createElement('p');
    empty.className = 'yotpo-custom-empty';
    empty.textContent = 'No reviews yet.';
    container.append(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'yotpo-custom-review-list';
  reviews.forEach((review) => list.append(buildReviewCard(review)));
  container.append(list);
}

const LEGACY_WIDGET_SRC_PREFIX = '//staticw2.yotpo.com/';

/**
 * Load Yotpo's legacy (v1) widget.js loader once — a DIFFERENT script from
 * `ensureYotpoLoaderOnce`'s v2 loader. This one is what actually powers the
 * "Testimonials"/site-reviews-tab widget below; confirmed against the exact
 * embed code FSA's live Magento `/reviews` page uses.
 */
function ensureLegacyYotpoWidgetJsOnce() {
  if (window.__yotpoLegacyLoaderEnsured) return;
  window.__yotpoLegacyLoaderEnsured = true;
  const src = `${LEGACY_WIDGET_SRC_PREFIX}${getYotpoConfig()['loader-token']}/widget.js`;
  if ([...document.querySelectorAll('script[src]')].some((s) => s.src.includes(src.replace('//', '')))) return;
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

/**
 * Inject the same Organization aggregateRating JSON-LD the live site adds
 * alongside this widget, for SEO — sourced from the `yotpo_site_reviews`
 * bottomline (a separate, site-level metric from the per-product one; not the
 * visible review count/list below, which the native widget supplies itself).
 * Best-effort, matches the live page's own script exactly.
 */
async function injectSiteReviewsJsonLd() {
  if (document.getElementById('yotpo-site-reviews-jsonld')) return;
  try {
    const token = getYotpoConfig()['loader-token'];
    const res = await fetch(`https://api.yotpo.com/products/${token}/yotpo_site_reviews/bottomline`);
    if (!res.ok) return;
    const data = await res.json();
    const bottomline = data?.response?.bottomline || {};
    const { total_reviews: totalReviews, average_score: averageScore } = bottomline;
    if (!totalReviews) return;
    const script = document.createElement('script');
    script.id = 'yotpo-site-reviews-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({
      '@context': 'http://schema.org',
      '@type': 'Organization',
      name: document.title,
      url: window.location.origin,
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: averageScore,
        bestRating: 5,
        reviewCount: totalReviews,
      },
    });
    document.head.appendChild(script);
  } catch {
    // best-effort SEO enhancement only — safe to skip on failure
  }
}

/**
 * Render Yotpo's native "Testimonials" (site-reviews-tab) widget — the exact
 * feature the live Magento `/reviews` page uses. This is a real, fully
 * interactive Yotpo widget (working helpful-vote buttons, Facebook/Twitter/
 * LinkedIn share, "Write a review", native pagination) rather than a custom
 * recreation.
 *
 * The widget's default presentation is a floating "★" tab that opens a modal;
 * the live site instead shows it inline by hiding that tab and forcing the
 * modal to render in-flow (see the `.yotpo-reviews` CSS overrides for
 * `#yotpo_testimonials_btn`/`#yotpo-testimonials`).
 * @param {HTMLElement} container
 */
export function renderSiteReviews(container) {
  if (!container) return;
  container.textContent = '';

  const widget = document.createElement('div');
  widget.id = 'yotpo-testimonials-custom-tab';
  widget.setAttribute('data-yotpo-element-id', '1');
  container.append(widget);

  ensureLegacyYotpoWidgetJsOnce();
  injectSiteReviewsJsonLd();
}

/**
 * Initialize Yotpo review widgets for the current page. No-op on pages that
 * are neither a PDP nor a PLP.
 * @param {Element} main
 */
export default function initYotpo(main) {
  const kind = detectPageKind(main);

  if (kind === 'pdp') {
    // eager: true replays the last `pdp/data` payload immediately if the PDP
    // already loaded before this runs (we're called from the lazy phase).
    events.on('pdp/data', renderPdpWidgets, { eager: true });
  } else if (kind === 'plp') {
    renderPlpWidgets();
    // PLP tiles change on filter/sort/pagination; keep placing widgets on new ones.
    new MutationObserver(renderPlpWidgets).observe(main, { childList: true, subtree: true });
  }
}
