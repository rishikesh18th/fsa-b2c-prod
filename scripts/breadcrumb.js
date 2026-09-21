// Shared breadcrumb DOM builder, used by the PLP, PDP, and the sitewide
// fallback breadcrumb (see decorateBreadcrumb in scripts.js).
import { rootLink } from './commerce.js';

/**
 * Build a breadcrumb <nav>: Home, then each of `crumbs` in order. A crumb
 * with no `href` renders as the current page (no link, aria-current).
 * @param {{label: string, href?: string}[]} crumbs
 * @returns {HTMLElement}
 */
export default function buildBreadcrumb(crumbs) {
  const nav = document.createElement('nav');
  nav.className = 'breadcrumb';
  nav.setAttribute('aria-label', 'Breadcrumb');

  const inner = document.createElement('div');
  inner.className = 'breadcrumb-inner';

  const sep = () => {
    const span = document.createElement('span');
    span.className = 'breadcrumb-sep';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '›';
    return span;
  };

  const home = document.createElement('a');
  home.href = rootLink('/');
  home.textContent = 'Home';
  inner.append(home);

  crumbs.forEach((crumb) => {
    inner.append(sep());
    if (crumb.href) {
      const link = document.createElement('a');
      link.href = crumb.href;
      link.textContent = crumb.label;
      inner.append(link);
    } else {
      const current = document.createElement('span');
      current.className = 'breadcrumb-current';
      current.setAttribute('aria-current', 'page');
      current.textContent = crumb.label;
      inner.append(current);
    }
  });

  nav.append(inner);
  return nav;
}
