// Sitewide fallback breadcrumb (Home > ... > current page) for plain content
// pages that have no block-specific breadcrumb of their own. Skipped entirely
// on the home page. Built from the URL path only (title-cased segments), with
// the current page's label taken from the document title.
import { rootLink, CUSTOMER_PATH } from './commerce.js';
import buildBreadcrumb from './breadcrumb.js';

// Blocks that already render their own breadcrumb (see their respective
// breadcrumb.js / decorate()); the sitewide fallback must not double up.
const OWN_BREADCRUMB_SELECTORS = [
  '.product-list-page',
  '.product-details',
  '.commerce-blog-detail',
  '.store-locator-detail',
];

// Path prefixes (relative to the site root) that never get a breadcrumb. The
// customer account area — account, orders, returns, addresses, login,
// forgot-password, order/return details — is a self-contained dashboard with
// its own sidebar navigation, so a Home > Customer > ... trail is just noise.
const NO_BREADCRUMB_PATHS = [CUSTOMER_PATH];

function isHomePage() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const home = rootLink('/').replace(/\/+$/, '') || '/';
  return path === home;
}

/** "some-page_name" -> "Some Page Name" */
function titleize(segment) {
  return decodeURIComponent(segment)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Is `relPath` (root-relative, no leading slash) at or under `prefix`? */
function isUnder(relPath, prefix) {
  const base = prefix.replace(/^\/+|\/+$/g, '');
  return relPath === base || relPath.startsWith(`${base}/`);
}

/**
 * Prepend a sitewide breadcrumb to `main`, unless the page is the home page,
 * an account page, or already renders its own breadcrumb (PLP, PDP, blog post,
 * installer detail).
 * @param {Element} main
 */
export default function decorateBreadcrumb(main) {
  // decorateMain() also runs on detached <main> elements created for fragments
  // (header, footer, `fragment` block — see blocks/fragment/fragment.js), which
  // are never attached to the document. Only the real page main qualifies.
  if (!document.body.contains(main)) return;
  if (isHomePage()) return;
  if (OWN_BREADCRUMB_SELECTORS.some((sel) => main.querySelector(sel))) return;

  const root = rootLink('/');
  let relPath = window.location.pathname;
  if (relPath.startsWith(root)) relPath = relPath.slice(root.length);
  relPath = relPath.replace(/^\/+|\/+$/g, '');
  if (!relPath) return;
  if (NO_BREADCRUMB_PATHS.some((prefix) => isUnder(relPath, prefix))) return;

  const segments = relPath.split('/').filter(Boolean);
  const crumbs = segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    return {
      label: isLast ? (document.title || titleize(segment)) : titleize(segment),
      href: isLast ? null : rootLink(`/${segments.slice(0, index + 1).join('/')}`),
    };
  });

  const section = document.createElement('div');
  section.className = 'section';
  const wrapper = document.createElement('div');
  wrapper.append(buildBreadcrumb(crumbs));
  section.append(wrapper);
  main.prepend(section);
}
