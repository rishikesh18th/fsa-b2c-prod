import { events } from '@dropins/tools/event-bus.js';
import { search } from '@dropins/storefront-product-discovery/api.js';

/**
 * Accordion behaviour for the Facets container.
 *
 * The storefront-product-discovery Facets container renders each facet group as
 * `.product-discovery-facet > .product-discovery-facet__header + .product-discovery-facet__bucket*`
 * (plus an optional show-more button) but has no collapse behaviour of its own.
 * This wraps each group's buckets in a `.product-filter-items` container, so the
 * collapsed/expanded state can be animated in CSS via max-height, and toggles an
 * `is-open` class on the group:
 *   - clicking a group header toggles that group open/closed
 *   - every group starts closed
 *   - the wrapper/state is re-applied after every re-render (preact rebuilds this
 *     DOM on every search/result and filter change)
 *
 * The show-more/show-less `.dropin-button` (rendered by the dropin when a group has
 * more buckets than fit) is moved into the same wrapper as the buckets, so it
 * collapses/hides along with the list instead of being left dangling below a
 * collapsed header.
 *
 * Checkbox labels: the dropin's default label for a Categories bucket is its raw
 * category `title` (e.g. "shop-by-product/water-filter-cartridges"); this swaps in
 * its `name` instead. Can't be done via the dropin's `slots` option (as the other
 * facet fix in this project is): that API only invokes a slot override once, the
 * first time a given list position mounts, and Preact reuses positions across
 * re-renders (e.g. when the Categories facet drills into a different set of child
 * buckets) — an override installed that way sticks with whatever bucket was first
 * at that position rather than tracking the bucket actually there, and was
 * observed showing a completely unrelated category name after two drill-downs.
 * Doing the relabel here instead, re-applied on every dropin re-render alongside
 * the wrapping above, keeps it correct through drill-downs and filter changes.
 *
 * The "Now Shopping By" panel (`[data-slot="SelectedFacets"]`) is rendered
 * entirely by this module instead of the dropin's own version of it, for two
 * reasons:
 *   - The dropin builds it from bucket `selected` flags in the search response.
 *     Those go empty for almost every facet whenever the current filter combo
 *     returns 0 total results (each facet's aggregation reflects every *other*
 *     active filter, so once those already rule everything out on their own,
 *     there's nothing left for the response to mark "selected") — at exactly
 *     the moment a shopper most needs to remove a filter, the dropin's own
 *     "Now Shopping By" panel (chips *and* "Clear all") goes completely blank
 *     and offers no way back. This instead tracks the request actually sent
 *     (see trackFacetBuckets/renderSelectedFilters), which stays correct
 *     regardless of what the response's bucket data looks like.
 *   - A category selection has no dropin-rendered pill to begin with: picking
 *     one drills into it, replacing the facet's own bucket list with that
 *     category's children, rather than marking a value "selected" the way
 *     every other facet does. A synthetic "Categories: <name>" chip is
 *     rendered in its place, removable the same one-click way as any other
 *     filter — see getActiveChips.
 * The dropin's own pills/"Clear all" are hidden rather than removed (see the
 * note on Preact-owned nodes in renderSelectedFilters).
 *
 * Selecting a category drills down with no way back other than "Clear All"
 * (which, in the dropin's own version, also wipes every other active filter,
 * not just the category drill-down). To fix that, this renders both:
 *   - a "Back" control as the first item in the Categories facet, when it
 *     happens to be showing (it has the same 0-result blank-out exposure as
 *     the dropin's own panel, since it only exists within that facet group),
 *   - a "Categories: <name>" chip in the "Now Shopping By" panel — the
 *     reliable one, per above,
 * whenever the currently applied category is a descendant of the page's own
 * base category (`baseCategoryPath`). Either one resets straight back to that
 * base category in one click (matching how removing any other filter takes
 * effect in one click, regardless of how many levels deep the drill-down
 * went) while leaving every other active filter untouched.
 *
 * @param {HTMLElement} facetsEl - the element the Facets dropin renders into
 * @param {string} [baseCategoryPath] - the category page's own url_path (e.g.
 *   `config.urlpath` in product-list-page.js); the Back control and chip only
 *   appear below this level, since it's the page's own root and not itself a
 *   drill-down. Omit on pages with no fixed base category (e.g. search).
 * @returns {() => void} cleanup function that disconnects the observer
 */
// Commerce has a stale duplicate "port_size" attribute alongside the working
// "Port_Size" one: both are configured as facets and render under the same
// "Port Size" label with the same bucket values/counts, so shoppers can't
// tell them apart, but filtering on "port_size" always returns zero results
// (confirmed directly against the search API: its facet aggregation counts
// products correctly, but the filter clause never matches any of them) while
// "Port_Size" filters correctly. Hide the broken one here rather than send
// shoppers into a dead end; remove this once the attribute is cleaned up or
// fixed in Commerce Admin/Catalog Service.
const BROKEN_FACET_ATTRIBUTES = ['port_size'];

const BACK_CLASS = 'product-discovery-facet__back';
const CHIP_CLASS = 'product-discovery-facet-list__synthetic-chip';
const CLEAR_ALL_CLASS = 'product-discovery-facet-list__synthetic-clear-all';

// facet attribute + bucket title -> a stable key, used to remember a bucket's
// readable info (see bucketInfoByPath) independent of raw string collisions
// between different attributes that might share a bucket title.
const bucketKey = (attribute, title) => `${attribute}::${title}`;

export default function initFacetsAccordion(facetsEl, baseCategoryPath) {
  const OPEN_CLASS = 'is-open';
  let userToggled = false;
  let isWrapping = false;
  let wrapTimer = null;
  // The full request behind the latest search/result: the source of truth for
  // everything below (which filters are active, and what to send when
  // removing one), since it stays correct regardless of what the response's
  // bucket data looks like (see the module doc comment).
  let latestRequest = null;

  // Category url_path -> { name, count }. Accumulated (entries are added, never
  // cleared) across every search result, as the Categories facet's buckets
  // change from one drill-down level to the next — a path just drilled past is
  // no longer one of the *current* buckets (it's been replaced by its
  // children), but its name is still needed to label the "Categories: <name>"
  // chip for whatever category is currently selected.
  const categoryNameByPath = new Map();
  // bucketKey(attribute, title) -> { facetTitle, value }. Accumulated the same
  // way, across every facet (not just Categories) — used to label every
  // "Now Shopping By" chip as "<Facet>: <value>" even once its facet's bucket
  // has gone missing from a later, more-constrained response.
  const bucketInfoByPath = new Map();
  const trackFacetBuckets = (payload) => {
    latestRequest = payload?.request || null;
    const facets = payload?.result?.facets || [];
    const categoryGroup = facets.find((f) => f.attribute === 'categories');
    (categoryGroup?.buckets || [])
      .filter((bucket) => bucket.name)
      .forEach((bucket) => {
        categoryNameByPath.set(bucket.title, { name: bucket.name, count: bucket.count });
      });

    facets.forEach((facet) => {
      (facet.buckets || []).forEach((bucket) => {
        if (!bucket.title) return;
        bucketInfoByPath.set(bucketKey(facet.attribute, bucket.title), {
          facetTitle: facet.title,
          value: bucket.name || bucket.title,
        });
      });
    });
  };
  const offSearchResult = events.on('search/result', trackFacetBuckets, { eager: true });

  const setOpen = (group, open) => {
    group.classList.toggle(OPEN_CLASS, open);
  };

  // The categories clause is `eq` on initial load (see product-list-page.js)
  // and `in` (a one-item array) once the shopper has selected a category
  // bucket here (see the dropin's own Facets container) — read either shape.
  const currentCategoryPath = () => {
    const clause = latestRequest?.filter?.find((f) => f.attribute === 'categories');
    return clause?.eq ?? clause?.in?.[0] ?? null;
  };

  // True once the applied category is a descendant of the page's own base
  // category — i.e. there's a drill-down to offer a way back from.
  const isCategoryDrilledDown = () => {
    const path = currentCategoryPath();
    return !!(baseCategoryPath && path && path !== baseCategoryPath
      && path.startsWith(`${baseCategoryPath}/`));
  };

  // One click always returns to the page's own base category, however many
  // levels deep the shopper has drilled — matching how removing any other
  // filter (its "x" pill, or "Clear all") takes effect in a single click,
  // rather than requiring one click per drilled level.
  const resetToBaseCategory = () => {
    if (!latestRequest || !baseCategoryPath) return;
    search({
      ...latestRequest,
      filter: [
        ...latestRequest.filter.filter((f) => f.attribute !== 'categories'),
        { attribute: 'categories', eq: baseCategoryPath },
      ],
      currentPage: 1,
    });
  };

  // Removes a single value from one active filter (dropping the whole clause
  // if that was its only value), leaving every other active filter untouched.
  const removeFilterValue = (attribute, value) => {
    if (!latestRequest) return;
    const filter = latestRequest.filter
      .map((f) => {
        if (f.attribute !== attribute) return f;
        if (f.in) {
          const remaining = f.in.filter((v) => v !== value);
          return remaining.length ? { ...f, in: remaining } : null;
        }
        return null;
      })
      .filter(Boolean);
    search({ ...latestRequest, filter, currentPage: 1 });
  };

  // Drops every active filter, resetting the category back to this page's own
  // base category (rather than dropping it entirely, unlike the dropin's own
  // "Clear all" — this is a category page, so it always keeps at least that
  // much scope) while keeping the (non-facet, never shopper-visible)
  // visibility clause.
  const clearAllFilters = () => {
    if (!latestRequest) return;
    const filter = latestRequest.filter.filter((f) => f.attribute === 'visibility');
    if (baseCategoryPath) filter.push({ attribute: 'categories', eq: baseCategoryPath });
    search({ ...latestRequest, filter, currentPage: 1 });
  };

  // Every currently active filter, as { key, label, onRemove }, built purely
  // from latestRequest — see the module doc comment for why not from bucket
  // data. Categories becomes at most one chip (only once drilled below the
  // page's base category); every other attribute becomes one chip per value.
  const getActiveChips = () => {
    if (!latestRequest) return [];
    const chips = [];
    latestRequest.filter.forEach((clause) => {
      if (clause.attribute === 'visibility') return;
      if (clause.attribute === 'categories') {
        if (!isCategoryDrilledDown()) return;
        const path = currentCategoryPath();
        const name = categoryNameByPath.get(path)?.name || path;
        chips.push({ key: 'categories', label: `Categories: ${name}`, onRemove: resetToBaseCategory });
        return;
      }
      const values = clause.in || (clause.eq != null ? [clause.eq] : null);
      if (values) {
        values.forEach((value) => {
          const info = bucketInfoByPath.get(bucketKey(clause.attribute, value));
          const label = `${info?.facetTitle || clause.attribute}: ${info?.value || value}`;
          chips.push({
            key: `${clause.attribute}::${value}`,
            label,
            onRemove: () => removeFilterValue(clause.attribute, value),
          });
        });
      } else if (clause.range) {
        const label = `${clause.attribute}: ${clause.range.from} - ${clause.range.to}`;
        chips.push({
          key: `${clause.attribute}::range`,
          label,
          onRemove: () => removeFilterValue(clause.attribute, null),
        });
      }
    });
    return chips;
  };

  // Renders the "Now Shopping By" panel from getActiveChips(), replacing the
  // dropin's own version of it (see the module doc comment).
  const renderSelectedFilters = () => {
    const panel = facetsEl.querySelector('[data-slot="SelectedFacets"]');
    if (!panel) return;

    // Hide (not remove) every node the dropin itself rendered into this
    // panel: it's re-rendered by the dropin's own Preact component, which
    // keeps its own reference to each DOM node it creates, and removing one
    // of those ourselves leaves Preact still trying to update a node that's
    // no longer in the document on the next re-render, rather than creating a
    // fresh one — silently breaking this panel from that point on.
    Array.from(panel.children).forEach((el) => {
      if (!el.classList.contains(CHIP_CLASS) && !el.classList.contains(CLEAR_ALL_CLASS)) {
        el.classList.add('is-hidden-selected-facet');
      }
    });

    const chips = getActiveChips();
    const chipKeys = new Set(chips.map((c) => c.key));
    const existingChips = Array.from(panel.querySelectorAll(`:scope > .${CHIP_CLASS}`));
    // Chips no longer active are fully our own elements (never touched by
    // Preact), so removing them outright is safe.
    existingChips.forEach((el) => {
      if (!chipKeys.has(el.dataset.chipKey)) el.remove();
    });

    chips.forEach((chip) => {
      let el = existingChips.find((e) => e.dataset.chipKey === chip.key);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = `dropin-button ${CHIP_CLASS}`;
        el.dataset.chipKey = chip.key;
        el.innerHTML = '<span></span>'
          + '<span aria-hidden="true" class="product-discovery-facet-list__chip-close">×</span>';
      }
      el.setAttribute('aria-label', `Remove ${chip.label} filter`);
      el.onRemove = chip.onRemove;
      const label = el.querySelector('span');
      if (label.textContent !== chip.label) label.textContent = chip.label;
      // Re-appending an existing child moves it — this keeps chips in
      // getActiveChips() order after every hidden dropin node (irrelevant
      // visually, since those are display:none).
      panel.appendChild(el);
    });

    let clearAllEl = panel.querySelector(`:scope > .${CLEAR_ALL_CLASS}`);
    if (chips.length === 0) {
      clearAllEl?.remove();
    } else {
      if (!clearAllEl) {
        clearAllEl = document.createElement('button');
        clearAllEl.type = 'button';
        clearAllEl.className = `dropin-button ${CLEAR_ALL_CLASS}`;
      }
      clearAllEl.onRemove = clearAllFilters;
      if (clearAllEl.textContent !== 'Clear all') clearAllEl.textContent = 'Clear all';
      panel.appendChild(clearAllEl);
    }
  };

  const renderCategoryBackLink = (group) => {
    const itemsEl = group.querySelector(':scope > .product-filter-items');
    if (!itemsEl) return;
    let backEl = itemsEl.querySelector(`:scope > .${BACK_CLASS}`);
    if (!isCategoryDrilledDown()) {
      backEl?.remove();
      return;
    }
    if (!backEl) {
      backEl = document.createElement('button');
      backEl.type = 'button';
      backEl.className = BACK_CLASS;
    }
    if (itemsEl.firstElementChild !== backEl) itemsEl.insertBefore(backEl, itemsEl.firstChild);
    if (backEl.textContent !== 'Back') backEl.textContent = 'Back';
  };

  const relabelCategoryBuckets = () => {
    if (categoryNameByPath.size) {
      facetsEl.querySelectorAll('.product-discovery-facet__bucket').forEach((bucket) => {
        const input = bucket.querySelector('input[data-testid$="-checkbox"]');
        const label = bucket.querySelector('[data-slot="FacetBucketLabel"]');
        if (!input || !label) return;
        const title = input.dataset.testid.replace(/-checkbox$/, '');
        const info = categoryNameByPath.get(title);
        // Guard against a no-op write: MutationObserver fires on any childList
        // change, including replacing a text node with an identical one, so an
        // unconditional write here would retrigger itself forever.
        const text = info ? `${info.name} (${info.count})` : null;
        if (text && label.textContent !== text) label.textContent = text;
      });
    }

    renderSelectedFilters();
  };

  const ensureBucketWrappers = () => {
    if (isWrapping) return;
    isWrapping = true;
    try {
      const groups = Array.from(facetsEl.querySelectorAll('.product-discovery-facet'));
      groups.forEach((group) => {
        const buckets = Array.from(group.querySelectorAll('.product-discovery-facet__bucket'));
        if (!buckets.length) return;

        const isBroken = BROKEN_FACET_ATTRIBUTES.some((attr) => group
          .querySelector(`input[id^="${attr}-"]`));
        group.classList.toggle('is-broken-duplicate', isBroken);
        if (isBroken) return;

        let itemsEl = group.querySelector(':scope > .product-filter-items');
        if (!itemsEl) {
          itemsEl = document.createElement('div');
          itemsEl.className = 'product-filter-items';
          const header = group.querySelector(':scope > .product-discovery-facet__header');
          if (header) {
            header.insertAdjacentElement('afterend', itemsEl);
          } else {
            group.insertBefore(itemsEl, buckets[0]);
          }
        }

        buckets.forEach((bucket) => {
          if (bucket.parentElement !== itemsEl) itemsEl.appendChild(bucket);
        });

        // The dropin re-renders its show-more/show-less button as a direct
        // child of `group` (sibling to the wrapper) on every state change;
        // move it into the wrapper too so toggling it doesn't leave it
        // dangling below a collapsed section.
        const toggleButton = group.querySelector(':scope > .dropin-button');
        if (toggleButton) itemsEl.appendChild(toggleButton);

        const isCategories = group.querySelector('input[id^="categories-"]');
        if (isCategories) renderCategoryBackLink(group);
      });

      // Default behavior: every facet starts closed, until the shopper toggles one.
      if (!userToggled && groups.length) {
        groups.forEach((group) => setOpen(group, false));
      } else {
        groups.forEach((group) => setOpen(group, group.classList.contains(OPEN_CLASS)));
      }

      relabelCategoryBuckets();
    } finally {
      isWrapping = false;
    }
  };

  // Toggle only the clicked facet section. Delegated from the stable parent so it
  // keeps working after the dropin replaces the inner facet DOM.
  facetsEl.addEventListener('click', (e) => {
    const backBtn = e.target.closest(`.${BACK_CLASS}`);
    if (backBtn && facetsEl.contains(backBtn)) {
      resetToBaseCategory();
      return;
    }
    const removable = e.target.closest(`.${CHIP_CLASS}, .${CLEAR_ALL_CLASS}`);
    if (removable && facetsEl.contains(removable)) {
      removable.onRemove?.();
      return;
    }
    const header = e.target.closest('.product-discovery-facet__header');
    if (!header || !facetsEl.contains(header)) return;
    const group = header.closest('.product-discovery-facet');
    if (!group) return;
    userToggled = true;
    setOpen(group, !group.classList.contains(OPEN_CLASS));
  });

  // Re-wrap and re-apply open state whenever the dropin re-renders the facet DOM.
  const observer = new MutationObserver(() => {
    if (wrapTimer) window.clearTimeout(wrapTimer);
    wrapTimer = window.setTimeout(ensureBucketWrappers, 0);
  });
  observer.observe(facetsEl, { childList: true, subtree: true });

  ensureBucketWrappers();

  return () => {
    observer.disconnect();
    offSearchResult?.off();
    if (wrapTimer) window.clearTimeout(wrapTimer);
  };
}
