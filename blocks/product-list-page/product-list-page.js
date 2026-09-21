// Product Discovery Dropins
import SearchResults from '@dropins/storefront-product-discovery/containers/SearchResults.js';
import Facets from '@dropins/storefront-product-discovery/containers/Facets.js';
import SortBy from '@dropins/storefront-product-discovery/containers/SortBy.js';
import Pagination from '@dropins/storefront-product-discovery/containers/Pagination.js';
import { render as provider } from '@dropins/storefront-product-discovery/render.js';
import { Button, Icon, provider as UI } from '@dropins/tools/components.js';
import { search } from '@dropins/storefront-product-discovery/api.js';
// Wishlist Dropin
import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';
// Cart Dropin
import * as cartApi from '@dropins/storefront-cart/api.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
// Event Bus
import { events } from '@dropins/tools/event-bus.js';
// AEM
import { readBlockConfig } from '../../scripts/aem.js';
import { fetchPlaceholders, getProductLink } from '../../scripts/commerce.js';
import { rememberVisitedCategory, stripMigratedCategoryPrefix } from '../../scripts/category.js';
import { getSearchStateFromUrl, applySearchStateToUrl } from './search-url.js';
import renderCategorySlider from './category-slider.js';
import renderBreadcrumb from './breadcrumb.js';
import renderCategoryDescription from './category-description.js';
import initFacetsAccordion from './facets-accordion.js';
import initSortByToggle from './sort-by-toggle.js';
import fetchGridPageSize from './store-config.js';

// Initializers
import '../../scripts/initializers/search.js';
import '../../scripts/initializers/wishlist.js';

export default async function decorate(block) {
  const [labels, backendPageSize] = await Promise.all([
    fetchPlaceholders(),
    fetchGridPageSize(),
  ]);

  const config = readBlockConfig(block);
  if (config.urlpath) {
    config.urlpath = stripMigratedCategoryPrefix(config.urlpath);
  }
  // Set when a separate Layered Navigation block on the same page renders
  // filters instead (see blocks/layered-navigation) — both mount the same
  // shared Facets container, so this one steps aside rather than duplicating it.
  const hideFacets = config['hide-facets'] === 'true';
  // Authored "Page Size" wins when set; otherwise use Commerce Admin's Grid
  // per Page default; otherwise a safe hardcoded fallback.
  const pageSize = parseInt(config.pagesize, 10) || backendPageSize || 9;

  const fragment = document.createRange().createContextualFragment(`
    <div class="search__alert"></div>
    <div class="search__wrapper__toolbar">
      <div class="search__view-facets"></div>
      <div class="search__result-info"></div>
      <div class="search__pagination"></div>
      <div class="search__sort-toggle-wrapper">
        <div class="search__product-sort"></div>
      </div>
    </div>
    <div class="search__wrapper">
      <div class="search__facets"></div>
      <div class="search__product-list"></div>
      <div class="search__pagination"></div>
    </div>
  `);

  const $resultInfo = fragment.querySelector('.search__result-info');
  const $viewFacets = fragment.querySelector('.search__view-facets');
  const $facets = fragment.querySelector('.search__facets');
  const $productSort = fragment.querySelector('.search__product-sort');
  const $productList = fragment.querySelector('.search__product-list');
  const $pagination = fragment.querySelector('.search__pagination');

  block.innerHTML = '';
  block.appendChild(fragment);

  // Add url path back to the block for enrichment, incase enrichment block is
  // executed after the plp block and block config is not available
  if (config.urlpath) {
    block.dataset.urlpath = config.urlpath;
  }

  // Category description (Commerce Admin content), breadcrumb (Home >
  // ancestor categories > current), and category slider (child categories, or
  // siblings when it's a leaf) are rendered as the block's first children,
  // above the results, in that fixed order. Slots are reserved synchronously
  // so each async render fills its own place regardless of which fetch
  // resolves first. Non-blocking and best-effort.
  if (config.urlpath) {
    const descriptionSlot = document.createElement('div');
    const breadcrumbSlot = document.createElement('div');
    const sliderSlot = document.createElement('div');
    block.prepend(descriptionSlot, breadcrumbSlot, sliderSlot);
    renderCategoryDescription(descriptionSlot, config.urlpath);
    renderBreadcrumb(breadcrumbSlot, config.urlpath);
    renderCategorySlider(sliderSlot, config.urlpath);

    // Remembered so the PDP breadcrumb (blocks/product-details/breadcrumb.js)
    // can show the ancestor chain the shopper actually browsed through — a
    // product can be reachable from more than one category page, so this
    // can't be derived from the product alone.
    rememberVisitedCategory(config.urlpath);
  }

  const searchState = getSearchStateFromUrl(new URL(window.location.href));

  // Default visibility filter for all of our requests
  const visibilityFilter = { attribute: 'visibility', in: ['Search', 'Catalog, Search'] };
  const userFilters = searchState.filter.filter((f) => f.attribute !== 'visibility');

  // Normalize URL (e.g. pipe-separated filter values)
  const normalizedUrl = new URL(window.location.href);
  applySearchStateToUrl(normalizedUrl, searchState);
  window.history.replaceState({}, '', normalizedUrl.toString());

  // Request search based on the page type on block load
  if (config.urlpath) {
    // If it's a category page...
    await search({
      phrase: '', // search all products in the category
      currentPage: searchState.currentPage,
      pageSize,
      sort: searchState?.sort?.length ? searchState.sort : [{ attribute: 'position', direction: 'DESC' }],
      filter: [
        // Use `categories` (not `categoryPath`) for the category filter: the
        // storefront-product-discovery dropin strips the `categories` facet
        // (used for child-category drill-down, see the "Categories" facet
        // group) from its response whenever the request filter includes a
        // `categoryPath` clause, assuming it would be redundant. It doesn't
        // apply that same suppression for `categories`, and both attributes
        // match on the same category `url_path` value, so this keeps the
        // facet while filtering identically (and, for anchor/parent
        // categories, correctly includes descendant-category products too).
        { attribute: 'categories', eq: config.urlpath },
        // Always add visibility filter to the request
        visibilityFilter,
        ...userFilters,
      ],
    }).catch(() => {
      console.error('Error searching for products');
    });
  } else {
    // Search page: dropin uses only the request (no URL parsing).
    await search({
      phrase: searchState.phrase,
      currentPage: searchState.currentPage,
      pageSize,
      sort: searchState.sort,
      // Always add visibility filter to the request
      filter: [visibilityFilter, ...userFilters],
    }).catch((e) => {
      console.error('Error searching for products', e);
    });
  }

  const getAddToCartButton = (product) => {
    if (product.typename === 'ComplexProductView') {
      const button = document.createElement('div');
      UI.render(Button, {
        children: labels.Global?.AddProductToCart,
        icon: Icon({ source: 'Cart' }),
        href: getProductLink(product.urlKey, product.sku),
        variant: 'primary',
      })(button);
      return button;
    }
    const button = document.createElement('div');
    let addToCart;
    UI.render(Button, {
      children: labels.Global?.AddProductToCart,
      icon: Icon({ source: 'Cart' }),
      onClick: async () => {
        addToCart?.setProps((prev) => ({
          ...prev,
          children: labels.Global?.AddingToCart,
          disabled: true,
        }));
        try {
          await cartApi.addProductsToCart([{ sku: product.sku, quantity: 1 }]);
        } catch (error) {
          console.error('Error adding product to cart', error);
        } finally {
          addToCart?.setProps((prev) => ({
            ...prev,
            children: labels.Global?.AddProductToCart,
            disabled: !product.inStock,
          }));
        }
      },
      variant: 'primary',
      disabled: !product.inStock,
    })(button).then((instance) => { addToCart = instance; });
    return button;
  };

  await Promise.all([
    // Sort By
    provider.render(SortBy, {})($productSort),

    // Pagination
    provider.render(Pagination, {
      onPageChange: () => {
        // scroll to the top of the page
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    })($pagination),

    // View Facets Button + Facets: skipped when a separate Layered
    // Navigation block on the same page renders filters instead (hideFacets)
    ...(hideFacets ? [] : [
      UI.render(Button, {
        children: labels.Global?.ShowFilters || 'Show Filters',
        variant: 'secondary',
        onClick: () => {
          const wrapper = block.querySelector('.search__wrapper');
          const isVisible = wrapper.classList.toggle('filters-open');
          $facets.classList.toggle('search__facets--visible', isVisible);

          const btn = $viewFacets.querySelector('button');
          if (btn) {
            const span = Array.from(btn.querySelectorAll('span')).find((s) => s.textContent.match(/Filters?/i)) || btn.querySelector('span');
            if (span) {
              span.textContent = isVisible ? (labels.Global?.HideFilters || 'Hide Filters') : (labels.Global?.ShowFilters || 'Show Filters');
            }
          }
        },
      })($viewFacets),

      provider.render(Facets, {})($facets),
    ]),

    // Product List
    provider.render(SearchResults, {
      routeProduct: (product) => getProductLink(product.urlKey, product.sku),
      slots: {
        ProductImage: (ctx) => {
          const { product, defaultImageProps } = ctx;
          const anchorWrapper = document.createElement('a');
          anchorWrapper.href = getProductLink(product.urlKey, product.sku);
          // The link no longer encodes the SKU (see getProductLink); Yotpo's
          // per-tile star-ratings widget (scripts/yotpo.js: getTileSku) reads
          // it from this attribute instead.
          anchorWrapper.dataset.sku = product.sku;

          // Many catalog products have no image assigned (empty `images`
          // array); with AEM Assets enabled, tryRenderAemAssetsImage throws
          // rather than falling back to an empty state, which previously
          // aborted this whole slot callback — dropping the href/data-sku
          // set above along with it. Render a plain placeholder instead.
          if (defaultImageProps.src) {
            tryRenderAemAssetsImage(ctx, {
              alias: product.sku,
              imageProps: defaultImageProps,
              wrapper: anchorWrapper,
              params: {
                width: defaultImageProps.width,
                height: defaultImageProps.height,
              },
            });
          } else {
            anchorWrapper.classList.add('dropin-product-item-card__image--placeholder');
            anchorWrapper.style.aspectRatio = `${defaultImageProps.width} / ${defaultImageProps.height}`;
            ctx.replaceWith(anchorWrapper);
          }
        },
        ProductActions: (ctx) => {
          const actionsWrapper = document.createElement('div');
          actionsWrapper.className = 'product-discovery-product-actions';
          // Add to Cart Button
          const addToCartBtn = getAddToCartButton(ctx.product);
          addToCartBtn.className = 'product-discovery-product-actions__add-to-cart';
          // Wishlist Button
          const $wishlistToggle = document.createElement('div');
          $wishlistToggle.classList.add('product-discovery-product-actions__wishlist-toggle');
          wishlistRender.render(WishlistToggle, {
            product: ctx.product,
            variant: 'tertiary',
          })($wishlistToggle);
          actionsWrapper.appendChild(addToCartBtn);
          actionsWrapper.appendChild($wishlistToggle);
          ctx.replaceWith(actionsWrapper);
        },
      },
    })($productList),
  ]);

  // Replace the SortBy select with an animated toggle. The dropin's select stays
  // in place (hidden) and still drives the search; this only mirrors it.
  initSortByToggle($productSort);

  // Make each facet group collapsible (first open by default). The Facets dropin
  // has no collapse behaviour of its own; this only toggles an `is-open` class.
  if (!hideFacets) initFacetsAccordion($facets, config.urlpath);

  // Listen for search results (event is fired before the block is rendered; eager: true)
  events.on('search/result', (payload) => {
    const totalCount = payload.result?.totalCount || 0;
    const totalPages = payload.result?.pageInfo?.totalPages || 1;

    block.classList.toggle('product-list-page--empty', totalCount === 0);
    block.classList.toggle('product-list-page--single-page', totalPages <= 1);

    // Results Info
    $resultInfo.innerHTML = payload.request?.phrase
      ? `${totalCount} results found for <strong>"${payload.request.phrase}"</strong>.`
      : `${totalCount} results found.`;

    // Update the view facets button with the number of filters
    if (!hideFacets) {
      if (payload.request.filter.length > 0) {
        $viewFacets.querySelector('button').setAttribute('data-count', payload.request.filter.length);
      } else {
        $viewFacets.querySelector('button').removeAttribute('data-count');
      }
    }
  }, { eager: true });

  // Listen for search results (event is fired after the block is rendered; eager: false)
  // URL is owned by this project; update it when search state changes.
  events.on('search/result', (payload) => {
    const url = new URL(window.location.href);
    applySearchStateToUrl(url, payload.request);
    window.history.pushState({}, '', url.toString());
  }, { eager: false });
}
