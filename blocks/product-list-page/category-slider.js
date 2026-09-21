// Category slider for the Product Listing Page.
//
// On a category PLP, renders a horizontal slider of the current category's
// child categories (image + name), each linking to its own PLP. When the
// current category is a leaf (no children), it falls back to the siblings
// (the parent's children) so the slider still shows the category group, with
// the current category highlighted.
//
// Data sources (Adobe Commerce Catalog Service, via CS_FETCH_GRAPHQL):
//   - categories(subtree) -> hierarchy + names + urlPath. Note: CategoryView in
//     this schema has no `id` and no image field, so relationships are resolved
//     from the hierarchical `urlPath` (e.g. a/b is a child of a).
// Category thumbnails are NOT exposed by the Catalog Service, so images are
// built from the Commerce media folder (…/media/catalog/category/<file>). The
// per-category filename comes from config.json `category-thumbnails`; when a
// category has no entry we guess "<Category_Name>.jpg" and quietly fall back to
// the monogram placeholder (via <img> onerror) if that guess 404s.
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import {
  fetchCategoryGraph, getCategoryLink, directChildren, isActive,
} from '../../scripts/category.js';

// Fallback base for category media. Override per environment via config.json
// `category-media-base`.
const DEFAULT_CATEGORY_MEDIA_BASE = 'https://na1-static-sandbox.api.commerce.adobe.com/5fS3Rh4B2rMGeBM1L9fsHM/media/catalog/category/';

/** Base URL of the Commerce category media folder (ends with a slash). */
function categoryMediaBase() {
  let base;
  try {
    base = getConfigValue('category-media-base');
  } catch {
    base = null;
  }
  base = base || DEFAULT_CATEGORY_MEDIA_BASE;
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Author-provided thumbnail, keyed by category urlPath (or urlKey), from
 * config.json `category-thumbnails`. Each value may be a full URL or a bare
 * filename (resolved against category-media-base). This is the equivalent of
 * the Magento `thumbnail_image` attribute, which the Catalog Service GraphQL
 * does not expose.
 * @param {object} category
 * @returns {string} image url or ''
 */
function configThumbnail(category) {
  let map;
  try {
    map = getConfigValue('category-thumbnails');
  } catch {
    map = null;
  }
  if (!map || typeof map !== 'object') return '';
  const value = map[category.urlPath] || map[category.urlKey] || '';
  if (!value) return '';
  return /^https?:\/\//i.test(value) ? value : `${categoryMediaBase()}${value}`;
}

// Magento appends _1, _2, … when an image with the same name is re-uploaded
// (the old file is kept, the attribute points at the newest). We probe this
// many suffixes, highest first, so the most recent upload wins over the stale
// base file. Bump if you re-upload the same category image more than this.
const MAX_IMAGE_VARIANTS = 3;

/** Name-based slug: drop special chars, collapse spaces to single underscores. */
function categorySlug(category) {
  return (category.name || '')
    .replace(/[^a-zA-Z0-9\s]/g, '') // drop &, /, ', commas, etc.
    .trim()
    .replace(/\s+/g, '_');
}

/**
 * Ordered list of candidate thumbnail URLs for a category:
 *   1. an explicit config entry (used verbatim, no guessing); otherwise
 *   2. the name-based guess, newest re-upload first:
 *        Name_3.jpg -> Name_2.jpg -> Name_1.jpg -> Name.jpg
 *      (e.g. "Ultraviolet & Tank Sanitation" -> Ultraviolet_Tank_Sanitation*.jpg)
 * applyImages() walks this list and keeps the first that loads, so re-uploaded
 * copies are handled automatically and a missing guess falls through to the
 * monogram placeholder.
 * @param {object} category
 * @returns {string[]}
 */
function categoryImageCandidates(category) {
  const configured = configThumbnail(category);
  if (configured) return [configured];

  const slug = categorySlug(category);
  if (!slug) return [];

  const base = categoryMediaBase();
  const urls = [];
  for (let i = MAX_IMAGE_VARIANTS; i >= 1; i -= 1) urls.push(`${base}${slug}_${i}.jpg`);
  urls.push(`${base}${slug}.jpg`);
  return urls;
}

const parentPathOf = (path) => path.split('/').filter(Boolean).slice(0, -1).join('/');

/**
 * Resolve the categories to show for a category url path: its children, or
 * (when it's a leaf) its siblings.
 * @returns {object[]} active, in-menu categories sorted by position
 */
function resolveSliderCategories(graph, urlPath) {
  const current = graph.find((c) => c.urlPath === urlPath);
  if (!current) return [];

  let group = directChildren(graph, urlPath);
  if (!group.length) group = directChildren(graph, parentPathOf(urlPath));

  // Match the Magento module: show all active children (is_active), regardless
  // of "include in menu". `inMenu` is retained only to order menu items first
  // if ever needed, but is intentionally NOT used as a filter.
  return group
    .filter((c) => isActive(c))
    .sort((a, b) => (a.position || 0) - (b.position || 0));
}

const AUTOPLAY_MS = 3000;

function buildCard(category, currentUrlPath) {
  const li = document.createElement('li');
  li.className = 'category-slider__item';
  li.dataset.cat = category.urlPath; // used to apply images to originals + clones
  if (category.urlPath === currentUrlPath) li.classList.add('category-slider__item--active');

  const link = document.createElement('a');
  link.className = 'category-slider__link';
  link.href = getCategoryLink(category.urlPath);
  link.setAttribute('aria-label', category.name);

  const media = document.createElement('span');
  media.className = 'category-slider__media';
  media.setAttribute('aria-hidden', 'true');
  // Monogram placeholder shown (via CSS) until/unless a thumbnail resolves.
  media.dataset.initial = (category.name || '?').trim().charAt(0).toUpperCase();

  const label = document.createElement('span');
  label.className = 'category-slider__label';

  const labelText = document.createElement('span');
  labelText.className = 'category-slider__label-text';
  labelText.textContent = category.name;
  label.append(labelText);

  link.append(media, label);
  li.append(link);
  return li;
}

/**
 * Fill any card (original or clone) that lacks an image, walking its candidate
 * URLs (newest re-upload first). The first that loads is kept; if all fail, the
 * <img> is dropped so the monogram placeholder stays — never a broken image.
 */
function applyImages(track, cache) {
  track.querySelectorAll('.category-slider__item').forEach((li) => {
    const candidates = cache.get(li.dataset.cat);
    const media = li.querySelector('.category-slider__media');
    if (!candidates || !candidates.length || !media || media.querySelector('img')) return;

    const img = document.createElement('img');
    // Load eagerly: the slider sits at the top of the PLP, so lazy-loading just
    // delays these thumbnails from appearing.
    img.loading = 'eager';
    img.fetchPriority = 'high';
    img.decoding = 'async';
    img.alt = '';
    img.className = 'category-slider__img';

    let idx = 0;
    const tryNext = () => {
      if (idx >= candidates.length) { img.remove(); return; } // none loaded → monogram
      img.src = candidates[idx];
      idx += 1;
    };
    img.addEventListener('load', () => li.classList.add('category-slider__item--has-image'));
    img.addEventListener('error', tryNext);

    media.append(img);
    tryNext();
  });
}

/** Resolve each unique category's candidate URLs once, then apply across all cards. */
function hydrateImages(track, categories, cache) {
  categories.forEach((category) => {
    if (cache.has(category.urlPath)) return;
    cache.set(category.urlPath, categoryImageCandidates(category));
  });
  applyImages(track, cache);
}

/** Distance (px) between a card and its immediate neighbour, incl. the gap. */
function cardStep(track) {
  const card = track.querySelector('.category-slider__item');
  const gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap) || 16;
  return card ? card.getBoundingClientRect().width + gap : track.clientWidth * 0.8;
}

/**
 * Turn the track into a seamless infinite loop: clone the item set once and
 * wrap the scroll position at the seam (clone content is identical, so the
 * reset is invisible). Autoplays forward, pausing on hover/focus, when the
 * document is hidden, or when the user prefers reduced motion.
 *
 * Initialisation is deferred until the track actually overflows. The block CSS
 * (which sizes the cards) can apply a frame or two after this runs, so a
 * ResizeObserver waits for real layout before enabling the loop, and keeps the
 * loop metrics correct across responsive breakpoint changes.
 */
function initInfinite(root, track, prevBtn, nextBtn, cache) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const overflowing = () => track.scrollWidth - track.clientWidth > 2;

  let started = false;
  let loopWidth = 0;
  let originalCount = 0;
  let autoplay = null;

  const measure = () => {
    const firstClone = track.children[originalCount];
    loopWidth = firstClone ? firstClone.offsetLeft : 0;
  };

  // Reset the scroll position once it crosses into the cloned region.
  const normalize = () => {
    if (!loopWidth) return;
    if (track.scrollLeft >= loopWidth) track.scrollLeft -= loopWidth;
    else if (track.scrollLeft < 0) track.scrollLeft += loopWidth;
  };

  const next = () => track.scrollBy({ left: cardStep(track), behavior: 'smooth' });
  const prev = () => {
    // Jump forward one loop first so there's room to animate backwards.
    if (track.scrollLeft <= 0 && loopWidth) track.scrollLeft += loopWidth;
    track.scrollBy({ left: -cardStep(track), behavior: 'smooth' });
  };

  const stopAutoplay = () => { autoplay = clearInterval(autoplay) || null; };
  const startAutoplay = () => {
    if (reduceMotion || autoplay) return;
    autoplay = setInterval(next, AUTOPLAY_MS);
  };

  const start = () => {
    if (started) { measure(); return; }
    started = true;
    root.classList.remove('category-slider--static');

    originalCount = track.children.length;
    [...track.children].forEach((li) => track.append(li.cloneNode(true)));
    applyImages(track, cache); // fill freshly-cloned cards from whatever's resolved
    measure();

    // Seam correction after the smooth scroll settles ('scrollend' where
    // supported, debounced 'scroll' as a fallback).
    let idle;
    track.addEventListener('scrollend', normalize);
    track.addEventListener('scroll', () => {
      clearTimeout(idle);
      idle = setTimeout(normalize, 120);
    }, { passive: true });

    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);

    root.addEventListener('pointerenter', stopAutoplay);
    root.addEventListener('pointerleave', startAutoplay);
    root.addEventListener('focusin', stopAutoplay);
    root.addEventListener('focusout', startAutoplay);
    document.addEventListener('visibilitychange', () => (
      document.hidden ? stopAutoplay() : startAutoplay()
    ));
    startAutoplay();
  };

  // Wait for real layout (CSS/images) before deciding, and keep metrics fresh
  // on breakpoint changes. The track is full-width before and after CSS loads,
  // so also observe a card — its width changes when the block CSS applies and
  // at each responsive breakpoint, which is what actually flips overflow.
  const observer = new ResizeObserver(() => {
    if (overflowing()) start();
    else if (!started) root.classList.add('category-slider--static');
    else measure();
  });
  observer.observe(track);
  if (track.firstElementChild) observer.observe(track.firstElementChild);

  // Try immediately too (in case layout is already settled).
  if (overflowing()) start();
  else root.classList.add('category-slider--static');
}

/**
 * Render the category slider into `container` for the given category url path.
 * No-op (renders nothing) when there is no url path or no categories to show.
 * Best-effort: never throws.
 * @param {HTMLElement} container element to render into
 * @param {string} urlPath current category url path (PLP config.urlpath)
 */
export default async function renderCategorySlider(container, urlPath) {
  if (!container || !urlPath) return;

  const graph = await fetchCategoryGraph(urlPath);
  const categories = resolveSliderCategories(graph, urlPath);
  if (categories.length < 2) return; // nothing meaningful to slide through

  const root = document.createElement('div');
  root.className = 'category-slider';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'category-slider__nav category-slider__nav--prev';
  prevBtn.setAttribute('aria-label', 'Previous categories');

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'category-slider__nav category-slider__nav--next';
  nextBtn.setAttribute('aria-label', 'Next categories');

  const track = document.createElement('ul');
  track.className = 'category-slider__track';
  categories.forEach((category) => track.append(buildCard(category, urlPath)));

  root.append(prevBtn, track, nextBtn);
  container.prepend(root);

  const cache = new Map();
  hydrateImages(track, categories, cache);
  // Measure/clone after layout so widths are known.
  requestAnimationFrame(() => initInfinite(root, track, prevBtn, nextBtn, cache));
}
