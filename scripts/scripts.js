import {
  buildBlock,
  loadHeader,
  loadFooter,
  decorateIcons,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
} from './aem.js';
import {
  loadCommerceEager,
  loadCommerceLazy,
  initializeCommerce,
  applyTemplates,
  decorateLinks,
  loadErrorPage,
  decorateSections,
  IS_UE,
  IS_DA,
} from './commerce.js';
import { initSeo } from './seo.js';
import decorateBreadcrumb from './site-breadcrumb.js';
import initYotpo from './yotpo.js';
import { resolveCategoryRoute } from './category.js';
import { resolveProductRoute } from './product.js';

/**
 * Builds hero block and prepends to main in a new section.
 * @param {Element} main The container element
 */
function buildHeroBlock(main) {
  const h1 = main.querySelector('h1');
  const picture = main.querySelector('picture');
  // eslint-disable-next-line no-bitwise
  if (h1 && picture && (h1.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_PRECEDING)) {
    // Check if h1 or picture is already inside a hero block
    if (h1.closest('.hero') || picture.closest('.hero')) {
      return; // Don't create a duplicate hero block
    }
    const section = document.createElement('div');
    section.append(buildBlock('hero', { elems: [picture, h1] }));
    main.prepend(section);
  }
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

/**
 * Synthetic routes render a block for a URL path that has no content document.
 * The server returns the 404 page for these paths; we detect the path, replace
 * the error content in <main> with the route's block, and let the normal block
 * decoration flow load and run it.
 */
const SYNTHETIC_ROUTES = [
  {
    // /blog/post/<identifier> renders a single blog post.
    match: (path) => /^\/blog\/post\/[^/]+\/?$/.test(path),
    block: 'commerce-blog-detail',
    title: 'Blog',
  },
  {
    // /blog and /blog/<category> render the blog listing block.
    match: (path) => /^\/blog(\/[^/]+)?\/?$/.test(path),
    block: 'commerce-blog',
    cells: [['page-size', '12']],
    title: 'Blog',
  },
];

/**
 * If the current path matches a synthetic route, build its block into main.
 * @param {Element} main The container element
 * @returns {boolean} whether a synthetic route was matched
 */
function buildSyntheticRoute(main) {
  const path = window.location.pathname;
  const route = SYNTHETIC_ROUTES.find((r) => r.match(path));
  if (!route) return false;

  // This path is served as the 404 page; turn it into a normal rendered page.
  // document.title is set here (synchronously, before decorateBreadcrumb runs)
  // so the tab title and sitewide breadcrumb fallback never show the 404 page's
  // original title while the block's own async decorate() resolves the real one.
  window.isErrorPage = false;
  main.classList.remove('error');
  main.textContent = '';
  document.title = route.title;

  const section = document.createElement('div');
  section.append(buildBlock(route.block, route.cells || ''));
  main.append(section);
  return true;
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks(main) {
  try {
    // auto load `*/fragments/*` references
    const fragments = [...main.querySelectorAll('a[href*="/fragments/"]')].filter((f) => !f.closest('.fragment'));
    if (fragments.length > 0) {
      // eslint-disable-next-line import/no-cycle
      import('../blocks/fragment/fragment.js').then(({ loadFragment }) => {
        fragments.forEach(async (fragment) => {
          try {
            const { pathname } = new URL(fragment.href);
            const frag = await loadFragment(pathname);
            fragment.parentElement.replaceWith(...frag.children);
          } catch (error) {
            // eslint-disable-next-line no-console
            console.error('Fragment loading failed', error);
          }
        });
      });
    }

    if (!main.querySelector('.hero')) buildHeroBlock(main);
  } catch (error) {
    console.error('Auto Blocking failed', error);
  }
}

/**
 * In-code routes that render a block even when no content document exists in the
 * content source. The URL 404s at the content bus, 404.html sets
 * `window.isErrorPage`, and we rewrite <main> to hold the route's block. This
 * keeps fully dynamic pages (data fetched at runtime) code-owned — no authoring.
 * Match by suffix so store prefixes like /us/testimonials also resolve.
 */
const SYNTHETIC_PAGE_ROUTES = [
  {
    match: '/testimonials',
    title: 'Testimonials',
    sections: [
      { heading: 'Testimonials', block: 'testimonials' },
    ],
  },
  {
    // Installer detail pages are runtime-driven and live beneath the main
    // installer finder path.
    match: (path) => /\/installer-finder\/[^/]+$/.test(path),
    title: 'Installer Finder',
    sections: [
      { heading: 'Installer Finder', block: 'store-locator-detail' },
    ],
  },
  {
    // The installer finder is fully data-driven (locations come from the Store
    // Locator app at runtime), so it is code-owned rather than authored. The
    // nav already links to /installer-finder.
    match: '/installer-finder',
    title: 'Installer Finder',
    sections: [
      { heading: 'Installer Finder', block: 'store-locator' },
    ],
  },
];

function buildSyntheticBlock(name, config) {
  if (!config) return `<div class="${name}"></div>`;
  const rows = Object.entries(config)
    .map(([k, v]) => `<div><div>${k}</div><div>${v}</div></div>`)
    .join('');
  return `<div class="${name}">${rows}</div>`;
}

function buildSyntheticSection({ heading, block, config }) {
  return `
    <div class="section">
      ${heading ? `<h1>${heading}</h1>` : ''}
      ${buildSyntheticBlock(block, config)}
    </div>
  `;
}

function matchSyntheticRoute() {
  const path = window.location.pathname.replace(/\/$/, '');
  return SYNTHETIC_PAGE_ROUTES.find((r) => {
    if (typeof r.match === 'function') return r.match(path);
    const matches = Array.isArray(r.match) ? r.match : [r.match];
    return matches.some((m) => path === m || path.endsWith(m));
  });
}

/**
 * If the current path is a synthetic route and the server returned 404.html,
 * rewrite <main> to hold the route's sections. Returns the matched route or null.
 * @param {Element} main The main element
 */
function applySyntheticRoute(main) {
  if (!window.isErrorPage) return null;
  const route = matchSyntheticRoute();
  if (!route) return null;
  main.classList.remove('error');
  if (route.bodyClasses) document.body.classList.add(...route.bodyClasses);
  main.innerHTML = route.sections.map(buildSyntheticSection).join('');
  document.title = route.title;
  window.isErrorPage = false;
  window.errorCode = undefined;
  return route;
}

/**
 * Dynamic Magento category route: when the server 404s a path and no other
 * synthetic route claimed it, try resolving it as a Magento category by its
 * complete `url_path` (arbitrary depth, e.g. "shop-by-product/water-filter",
 * matched in full so categories that share a `url_key` under different
 * parents are never confused with one another). On a match, render the
 * existing `product-list-page` block with that `url_path` — the same
 * category listing, breadcrumb, and child-category slider an authored PLP
 * page would get, just without requiring one to be authored. On no match,
 * returns null and leaves the normal 404 page in place.
 * @param {Element} main The main element
 * @returns {Promise<object|null>} the synthetic route (for loadSyntheticRoute), or null
 */
async function applyCategoryRoute(main) {
  if (!window.isErrorPage) return null;

  let resolved;
  try {
    resolved = await resolveCategoryRoute(window.location.pathname);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Category route: failed to resolve category', err);
    return null;
  }
  if (!resolved) return null;

  const route = {
    title: resolved.category.name,
    sections: [
      { block: 'product-list-page', config: { urlpath: resolved.urlPath } },
    ],
  };
  main.classList.remove('error');
  main.innerHTML = route.sections.map(buildSyntheticSection).join('');
  document.title = route.title;
  window.isErrorPage = false;
  window.errorCode = undefined;
  return route;
}

/**
 * Dynamic product route: when the server 404s a path and no other synthetic
 * route claimed it, try resolving it as a product by its `url_key` (a single
 * path segment ending in ".html", e.g. "/some-product.html"). On a match,
 * inject a `sku` meta tag — `getProductSku()`'s primary lookup — and render
 * the existing `product-details` block, exactly as an authored/bulk-metadata
 * PDP would.
 * @param {Element} main The main element
 * @returns {Promise<object|null>} the synthetic route (for loadSyntheticRoute), or null
 */
async function applyProductRoute(main) {
  if (!window.isErrorPage) return null;

  let product;
  try {
    product = await resolveProductRoute(window.location.pathname);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Product route: failed to resolve product', err);
    return null;
  }
  if (!product) return null;

  const skuMeta = document.createElement('meta');
  skuMeta.name = 'sku';
  skuMeta.content = product.sku;
  document.head.appendChild(skuMeta);

  const route = {
    title: product.name,
    sections: [
      { block: 'product-details' },
    ],
  };
  main.classList.remove('error');
  main.innerHTML = route.sections.map(buildSyntheticSection).join('');
  document.title = route.title;
  window.isErrorPage = false;
  window.errorCode = undefined;
  return route;
}

/**
 * Explicitly load + decorate a synthetic block (CSS + JS) so it renders even if
 * the normal section/block pipeline doesn't pick it up on the 404 host.
 * @param {Element} main The main element
 * @param {string} blockName The block to load
 */
async function loadSyntheticBlock(main, blockName) {
  const block = main.querySelector(`.${blockName}`);
  if (!block) return;
  if (block.dataset.blockStatus === 'loaded' || block.dataset.blockStatus === 'loading') return;
  block.classList.add('block');
  block.dataset.blockName = blockName;
  block.dataset.blockStatus = 'loading';
  try {
    const base = window.hlx?.codeBasePath || '';
    loadCSS(`${base}/blocks/${blockName}/${blockName}.css`);
    const mod = await import(`${base}/blocks/${blockName}/${blockName}.js`);
    if (mod.default) await mod.default(block);
    block.dataset.blockStatus = 'loaded';
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Synthetic route: failed to load block ${blockName}`, err);
  }
}

async function loadSyntheticRoute(main, route) {
  await Promise.all(route.sections.map((section) => loadSyntheticBlock(main, section.block)));
}

/**
 * Decorates formatted links to style them as buttons.
 * @param {HTMLElement} main The main container element
 */
function decorateButtons(main) {
  main.querySelectorAll('p a[href]').forEach((a) => {
    a.title = a.title || a.textContent;
    const p = a.closest('p');
    const text = a.textContent.trim();

    // quick structural checks
    if (a.querySelector('img') || p.textContent.trim() !== text) return;

    // skip URL display links
    try {
      if (new URL(a.href).href === new URL(text, window.location).href) return;
    } catch { /* continue */ }

    // require authored formatting for buttonization
    const strong = a.closest('strong');
    const em = a.closest('em');
    if (!strong && !em) return;

    p.className = 'button-wrapper';
    a.className = 'button';
    if (strong && em) { // high-impact call-to-action
      a.classList.add('accent');
      const outer = strong.contains(em) ? strong : em;
      outer.replaceWith(a);
    } else if (strong) {
      a.classList.add('primary');
      strong.replaceWith(a);
    } else {
      a.classList.add('secondary');
      em.replaceWith(a);
    }
  });
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
export function decorateMain(main) {
  decorateLinks(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
  decorateButtons(main);
  decorateBreadcrumb(main);
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();

  const main = doc.querySelector('main');
  if (main) {
    let syntheticRoute = applySyntheticRoute(main);
    try {
      buildSyntheticRoute(main);
      await initializeCommerce();
      // Category/product resolution needs commerce (GraphQL) initialized, so
      // they can only be attempted here — after the static synthetic routes
      // above, which match on the URL alone and don't need it.
      if (!syntheticRoute) syntheticRoute = await applyCategoryRoute(main);
      if (!syntheticRoute) syntheticRoute = await applyProductRoute(main);
      decorateMain(main);
      applyTemplates(doc);
      await loadCommerceEager();
    } catch (e) {
      console.error('Error initializing commerce configuration:', e);
      if (!syntheticRoute) loadErrorPage(418);
    }
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
    if (syntheticRoute) await loadSyntheticRoute(main, syntheticRoute);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  loadHeader(doc.querySelector('header'));

  const main = doc.querySelector('main');
  await loadSections(main);
  initYotpo(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadFooter(doc.querySelector('footer'));

  loadCommerceLazy();

  // Inject site-wide Organization + WebSite JSON-LD from the App Builder SEO
  // service (ports the Magento Eighteentech_Seo structured data). Best-effort,
  // non-blocking — must not delay lazy content.
  initSeo();

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

// UE Editor support before page load
if (IS_UE) {
  // eslint-disable-next-line import/no-unresolved
  await import(`${window.hlx.codeBasePath}/scripts/ue.js`).then(({ default: ue }) => ue());
}

loadPage();

(async function loadDa() {
  if (!IS_DA) return;
  // eslint-disable-next-line import/no-unresolved
  import('https://da.live/scripts/dapreview.js').then(({ default: daPreview }) => daPreview(loadPage));
}());
