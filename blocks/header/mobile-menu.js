/**
 * Mobile navigation accordion.
 *
 * On desktop the nav is a hover mega menu; below 900px (the `isDesktop` break
 * point used by the header) it becomes a nested accordion with three levels,
 * matching the authored content structure:
 *
 *   main category   `.default-content-wrapper > ul > li.nav-drop` (uppercase, bold)
 *   sub category    the `li`s of its submenu list                (medium)
 *   child category  each `h4` group and its links                (normal)
 *
 * Every level that has children gets its own chevron button; the category link
 * itself keeps navigating, so nothing that worked before stops working. The
 * show/hide is done in CSS through the `is-open` class on the panel, which is
 * what animates.
 */

const MOBILE_MQ = window.matchMedia('(max-width: 899px)');

/**
 * Moves nodes into a collapsible panel.
 * @param {Element[]} nodes The nodes to collapse
 * @returns {Element} The panel element, not yet inserted in the document
 */
function createPanel(nodes) {
  const panel = document.createElement('div');
  panel.className = 'nav-accordion-panel';
  const inner = document.createElement('div');
  inner.className = 'nav-accordion-inner';
  nodes.forEach((node) => inner.append(node));
  panel.append(inner);
  return panel;
}

/**
 * @param {String} labelText Name of the category the button controls
 * @returns {Element} The chevron button
 */
function createToggle(labelText) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav-accordion-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', labelText ? `Toggle ${labelText}` : 'Toggle submenu');
  return button;
}

/**
 * Connects a chevron button to the panel it opens.
 * @param {Element} button The chevron button
 * @param {Element} panel The panel to expand or collapse
 */
function wireToggle(button, panel) {
  button.addEventListener('click', (e) => {
    // The button sits inside the category link's paragraph, so keep the click
    // from bubbling to the nav's own handlers.
    e.preventDefault();
    e.stopPropagation();
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', expanded);
    panel.classList.toggle('is-open', expanded);
  });
}

/**
 * Third level: each `h4` collapses the links that follow it, up to the next `h4`.
 * @param {Element} container The element holding the headings
 */
function decorateChildGroups(container) {
  // Support two possible desktop markups: either direct H4 siblings (old)
  // or groups wrapping each H4 + UL (new `.mega-menu__group`). Handle the
  // grouped markup first.
  const groups = [...container.children].filter((el) => el.classList && el.classList.contains('mega-menu__group'));
  if (groups.length) {
    groups.forEach((group) => {
      const heading = group.querySelector('h4');
      if (!heading) return;
      const nodes = [...group.children].filter((c) => c !== heading);
      if (!nodes.length) return;

      const panel = createPanel(nodes);
      heading.after(panel);

      const toggle = createToggle(heading.textContent.trim());
      heading.classList.add('nav-accordion-heading');
      heading.append(toggle);
      wireToggle(toggle, panel);

      // Headings are not links, so the whole row can toggle.
      heading.addEventListener('click', (e) => {
        if (e.target !== toggle) toggle.click();
      });
    });

    return;
  }

  // Fallback: original behavior for unwrapped H4 siblings
  const headings = [...container.children].filter((el) => el.tagName === 'H4');

  headings.forEach((heading) => {
    const group = [];
    let next = heading.nextElementSibling;
    while (next && next.tagName !== 'H4') {
      group.push(next);
      next = next.nextElementSibling;
    }
    if (!group.length) return;

    const panel = createPanel(group);
    heading.after(panel);

    const toggle = createToggle(heading.textContent.trim());
    heading.classList.add('nav-accordion-heading');
    heading.append(toggle);
    wireToggle(toggle, panel);

    // Headings are not links, so the whole row can toggle.
    heading.addEventListener('click', (e) => {
      if (e.target !== toggle) toggle.click();
    });
  });
}

/**
 * Second level: each sub category collapses its own child groups and links.
 * @param {Element} container The element holding the submenu list
 */
function decorateSubCategories(container) {
  container.querySelectorAll(':scope > ul > li').forEach((item) => {
    const label = item.querySelector(':scope > p');
    if (!label) return;

    // The desktop mega-menu flyout (category-menu.js) wraps each column's
    // heading/list children in a `.mega-menu__detail` div, kept as a direct
    // child of `item` so that flyout's CSS can target it. Reuse it in place
    // as the accordion panel body (rather than moving its children into a
    // separate new wrapper), so it stays exactly where that CSS expects on
    // desktop while still gaining full mobile collapse behavior here.
    const detail = item.querySelector(':scope > .mega-menu__detail');
    let panel;
    if (detail) {
      panel = detail;
      panel.classList.add('nav-accordion-panel');
      const inner = document.createElement('div');
      inner.className = 'nav-accordion-inner';
      while (panel.firstChild) inner.append(panel.firstChild);
      panel.append(inner);
    } else {
      const rest = [...item.children].filter((child) => child !== label);
      if (!rest.length) return;
      panel = createPanel(rest);
      item.append(panel);
    }
    item.classList.add('nav-accordion-sub');

    const toggle = createToggle(label.textContent.trim());
    label.append(toggle);
    wireToggle(toggle, panel);

    decorateChildGroups(panel.firstElementChild);
  });
}

/**
 * Builds the mobile accordion. Safe to run once on load: it only adds markup
 * (chevron buttons and panel wrappers) that the CSS ignores above 900px.
 * @param {Element} navSections The `.nav-sections` element
 * @returns {() => void} cleanup function that collapses everything
 */
export default function initMobileMenu(navSections) {
  if (!navSections) return () => {};

  navSections
    .querySelectorAll(':scope .default-content-wrapper > ul > li.nav-drop')
    .forEach((item) => {
      const wrapper = item.querySelector(':scope > .submenu-wrapper');
      if (!wrapper) return;

      // The submenu wrapper doubles as the first level panel.
      const inner = document.createElement('div');
      inner.className = 'nav-accordion-inner';
      while (wrapper.firstChild) inner.append(wrapper.firstChild);
      wrapper.append(inner);
      wrapper.classList.add('nav-accordion-panel');

      const label = item.querySelector(':scope > p');
      const toggle = createToggle((label || item).textContent.trim());
      if (label) label.append(toggle);
      else item.insertBefore(toggle, wrapper);
      wireToggle(toggle, wrapper);

      decorateSubCategories(inner);
    });

  const collapseAll = () => {
    navSections
      .querySelectorAll('.nav-accordion-toggle[aria-expanded="true"]')
      .forEach((button) => button.setAttribute('aria-expanded', 'false'));
    navSections
      .querySelectorAll('.nav-accordion-panel.is-open')
      .forEach((panel) => panel.classList.remove('is-open'));
  };

  // Leaving mobile hands the nav back to the hover menu; start it collapsed.
  MOBILE_MQ.addEventListener('change', (e) => {
    if (!e.matches) collapseAll();
  });

  return collapseAll;
}
