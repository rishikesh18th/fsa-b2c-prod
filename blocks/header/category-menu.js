// Builds a "Shop By Product"-style mega-menu dropdown from live Commerce
// category data, for any authored top-level nav item that links to a real
// category — matched generically by url_path (see header.js), not hardcoded
// to a specific label, so any other category-linked nav item gets the same
// treatment automatically. Non-category nav items (About Us, Reviews, Blog,
// Contact, Find an Installer, …) are left exactly as authored in DA.live.
import { getCategoryLink, directChildren, isActive } from '../../scripts/category.js';

// The category graph's `roles` only ever contains 'active' (see
// fetchCategoryGraph) — the Catalog Service's categoryTree query doesn't
// expose a separate "show in menu" flag, so every active child is shown here,
// same precedent as the PLP category slider.
function menuChildren(graph, urlPath) {
  return directChildren(graph, urlPath)
    .filter(isActive)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

function buildCategoryLink(category) {
  const a = document.createElement('a');
  a.href = getCategoryLink(category.urlPath);
  a.textContent = category.name;
  return a;
}

function buildLeafItem(category) {
  const li = document.createElement('li');
  li.append(buildCategoryLink(category));
  return li;
}

/**
 * One rail row: a category link, plus (if it has menu children) a
 * `.mega-menu__detail` wrapper holding its sub-heading groups and their leaf
 * links — a single element the flyout-panel CSS can position as one unit.
 * mobile-menu.js unwraps this same div so the mobile accordion sees the flat
 * heading/list siblings it always has, unaffected by the desktop flyout.
 */
function buildColumn(category, graph) {
  const li = document.createElement('li');

  const p = document.createElement('p');
  p.append(buildCategoryLink(category));
  li.append(p);

  const subCategories = menuChildren(graph, category.urlPath);
  if (subCategories.length) {
    // Marks this row as having a flyout, so header.css can style/target it
    // via a plain class instead of `:has(.mega-menu__detail)` — needed
    // where that check must combine with another :has() in the same rule,
    // since :has() can't be nested inside :has().
    li.classList.add('mega-menu__has-detail');

    const detail = document.createElement('div');
    detail.className = 'mega-menu__detail';

    subCategories.forEach((subCategory) => {
      const group = document.createElement('div');
      group.className = 'mega-menu__group';

      const heading = document.createElement('h4');
      heading.id = subCategory.urlKey;
      heading.append(buildCategoryLink(subCategory));
      group.append(heading);

      const leaves = menuChildren(graph, subCategory.urlPath);
      if (leaves.length) {
        const ul = document.createElement('ul');
        leaves.forEach((leaf) => ul.append(buildLeafItem(leaf)));
        group.append(ul);
      }

      detail.append(group);
    });

    li.append(detail);
  }

  return li;
}

/**
 * Builds a mega-menu dropdown `<ul>` for `urlPath`'s category subtree, three
 * levels deep (columns > bold sub-headings > leaf links) — matching the DOM
 * shape header.js/mobile-menu.js already expect from authored nav content.
 * The first column starts marked `.mega-menu__row--active` (header.js wires
 * up the hover behavior that moves this class between rows — it has to run
 * on the final DOM since header.js's setupSubmenu clones this `<ul>`, which
 * would silently drop any listeners attached here).
 * @param {object[]} graph flat CategoryView list (see fetchCategoryGraph)
 * @param {string} urlPath the nav item's own category url_path
 * @returns {HTMLUListElement|null} null when there's nothing to show (leave
 *   the authored content in place)
 */
export default function buildCategoryDropdown(graph, urlPath) {
  const columns = menuChildren(graph, urlPath);
  if (!columns.length) return null;

  const ul = document.createElement('ul');
  columns.forEach((category) => ul.append(buildColumn(category, graph)));
  ul.firstElementChild.classList.add('mega-menu__row--active');
  return ul;
}

// A rail row's flyout panel spans the whole rail's height rather than
// sitting flush with whichever row opened it (see header.css), so reaching a
// link near the top of a lower row's panel means the cursor crosses over the
// rows above it first. Committing a row as active only after this dwell
// means that kind of quick pass-through over another row, on the way to the
// panel, doesn't steal it away mid-transit. RESET is how long the mouse may
// be away from a rail before it drops back to the first row's panel.
const ROW_COMMIT_DELAY = 120;
const RAIL_RESET_DELAY = 200;

const RAIL_ROW_SELECTOR = 'header nav .nav-sections .default-content-wrapper>ul>li>.submenu-wrapper>.nav-accordion-inner>ul>li';

/**
 * Marks one rail row `.mega-menu__row--active` (header.css shows that row's
 * flyout panel off this class) and clears it from its siblings.
 * @param {Element} row the row to activate
 */
function setActiveRow(row) {
  [...row.parentElement.children].forEach((sibling) => {
    sibling.classList.toggle('mega-menu__row--active', sibling === row);
  });
}

/**
 * Commits a hovered/focused row as the one driving the flyout panel. A leaf
 * row (e.g. "Water Analysis Service", which links out with no children) has
 * no panel of its own, so it falls back to the rail's first row instead -
 * same as if nothing were hovered at all - rather than leaving whichever
 * panel happened to be showing before stuck on screen. The row itself still
 * highlights as hovered regardless (plain `:hover` in header.css, unaffected
 * by this dwell), independently of which panel that leaves on display.
 * @param {Element} row the hovered/focused row
 */
function commitRow(row) {
  const target = row.classList.contains('mega-menu__has-detail') ? row : row.parentElement.firstElementChild;
  setActiveRow(target);
}

/**
 * Wires up which rail row's flyout panel is active on desktop, for every
 * mega-menu rail under `navSections` (see buildCategoryDropdown above for
 * why plain `:hover` on each row can't do this reliably).
 *
 * Delegated on `navSections` rather than attached per-row when the rail is
 * built: header.js's setupSubmenu clones each dropdown `<ul>` into its final
 * position right after buildCategoryDropdown returns it, which would
 * silently drop any listeners attached directly to its rows.
 * @param {Element} navSections the `.nav-sections` element
 */
export function wireRailHoverIntent(navSections) {
  if (!navSections) return;

  let commitTimer = null;
  let resetTimer = null;

  navSections.addEventListener('mouseover', (event) => {
    const row = event.target.closest(RAIL_ROW_SELECTOR);
    if (!row || row.contains(event.relatedTarget)) return;
    clearTimeout(resetTimer);
    clearTimeout(commitTimer);
    commitTimer = setTimeout(() => commitRow(row), ROW_COMMIT_DELAY);
  });

  navSections.addEventListener('mouseout', (event) => {
    const row = event.target.closest(RAIL_ROW_SELECTOR);
    if (!row || row.contains(event.relatedTarget)) return;
    clearTimeout(commitTimer);

    const rail = row.parentElement;
    if (!rail.contains(event.relatedTarget)) {
      resetTimer = setTimeout(() => setActiveRow(rail.firstElementChild), RAIL_RESET_DELAY);
    }
  });
}
