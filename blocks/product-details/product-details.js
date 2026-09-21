import {
  InLineAlert,
  Icon,
  Button,
  provider as UI,
} from '@dropins/tools/components.js';
import { h } from '@dropins/tools/preact.js';
import { events } from '@dropins/tools/event-bus.js';
import { tryRenderAemAssetsImage } from '@dropins/tools/lib/aem/assets.js';
import * as pdpApi from '@dropins/storefront-pdp/api.js';
import { render as pdpRendered } from '@dropins/storefront-pdp/render.js';
import { render as wishlistRender } from '@dropins/storefront-wishlist/render.js';

import { WishlistToggle } from '@dropins/storefront-wishlist/containers/WishlistToggle.js';
import { WishlistAlert } from '@dropins/storefront-wishlist/containers/WishlistAlert.js';

// Containers
import ProductHeader from '@dropins/storefront-pdp/containers/ProductHeader.js';
import ProductPrice from '@dropins/storefront-pdp/containers/ProductPrice.js';
import ProductShortDescription from '@dropins/storefront-pdp/containers/ProductShortDescription.js';
import ProductOptions from '@dropins/storefront-pdp/containers/ProductOptions.js';
import ProductQuantity from '@dropins/storefront-pdp/containers/ProductQuantity.js';
import ProductGallery from '@dropins/storefront-pdp/containers/ProductGallery.js';
import ProductGiftCardOptions from '@dropins/storefront-pdp/containers/ProductGiftCardOptions.js';
import renderProductTabs, { prefetchCmsBlockTabs } from './product-tabs.js';
import renderBreadcrumb from './breadcrumb.js';
import renderCustomizableOptions from './product-customizable-options.js';
import { fetchCmsBlock } from '../../scripts/cms-block.js';
import { loadCSS } from '../../scripts/aem.js';

// Libs
import {
  rootLink,
  setJsonLd,
  fetchPlaceholders,
  getProductLink,
} from '../../scripts/commerce.js';

// Initializers
import { IMAGES_SIZES } from '../../scripts/initializers/pdp.js';
import '../../scripts/initializers/cart.js';
import '../../scripts/initializers/wishlist.js';

// Identifier of the CMS block rendered under the gallery on the PDP.
const CUSTOMER_SERVICE_BLOCK = 'customer-service';

/**
 * Checks if the page has prerendered product JSON-LD data
 * @returns {boolean} True if product JSON-LD exists and contains @type=Product
 */
function isProductPrerendered() {
  const jsonLdScript = document.querySelector('script[type="application/ld+json"]');

  if (!jsonLdScript?.textContent) {
    return false;
  }

  try {
    const jsonLd = JSON.parse(jsonLdScript.textContent);
    return jsonLd?.['@type'] === 'Product';
  } catch (error) {
    console.debug('Failed to parse JSON-LD:', error);
    return false;
  }
}

// Function to update the Add to Cart button text
function updateAddToCartButtonText(addToCartInstance, inCart, labels) {
  const buttonText = inCart
    ? labels.Global?.UpdateProductInCart
    : labels.Global?.AddProductToCart;
  if (addToCartInstance) {
    addToCartInstance.setProps((prev) => ({
      ...prev,
      children: buttonText,
    }));
  }
}

export default async function decorate(block) {
  // Fire off as early as possible: these tabs' CMS Block Builder identifiers
  // don't depend on product data, so there's no reason to wait for pdp/data.
  prefetchCmsBlockTabs();

  const eventProduct = events.lastPayload('pdp/data') ?? null;
  // bug: the pdp sends an object with event data even if product is not found.
  const product = eventProduct?.sku ? eventProduct : null;

  const labels = await fetchPlaceholders();

  // Read itemUid from URL
  const urlParams = new URLSearchParams(window.location.search);
  const itemUidFromUrl = urlParams.get('itemUid');

  // State to track if we are in update mode
  let isUpdateMode = false;

  // State to track if the current product/variant is out of stock
  let isOutOfStock = false;

  // State to track validity of the classic Magento customizable options
  // (rendered separately below, since Catalog Service's ProductOptions
  // container doesn't expose them). Required options block Add to Cart
  // just like an invalid swatch selection does.
  let isCustomOptionsValid = true;

  // Related products checked in the "Related Products" carousel below,
  // added alongside this product when Add to Cart is clicked.
  let relatedSelection = [];
  events.on('related-products/selection', (items) => {
    relatedSelection = items || [];
  });

  // Layout
  const fragment = document.createRange().createContextualFragment(`
    <div class="product-details__alert"></div>
    <div class="product-details__wrapper">
      <div class="product-details__left-column">
        <div class="product-details__gallery"></div>
        <div class="product-details__customer-service"></div>
      </div>
      <div class="product-details__right-column">
        <div class="product-details__header"></div>
        <div class="product-details__meta">
          <span class="product-details__sku"></span>
          <span class="product-details__stock"></span>
        </div>
        <div class="product-details__price"></div>
        <div class="product-details__gallery"></div>
        <div class="product-details__overview">
          <h2 class="product-details__overview-title">${labels.Global?.QuickOverview || 'Quick Overview'}</h2>
          <div class="product-details__short-description"></div>
        </div>
        <div class="product-details__gift-card-options"></div>
        <div class="product-details__configuration">
          <div class="product-details__options"></div>
          <div class="product-details__custom-options"></div>
          <div class="product-details__related-products"></div>
          <div class="product-details__wholesale-price-break"></div>
          <div class="product-details__purchase">
            <label class="label product-details__qty-label" for="qty"><span>Qty</span></label>
            <div class="product-details__quantity"></div>
            <div class="product-details__buttons">
              <div class="product-details__buttons__add-to-cart"></div>
              <div class="product-details__buttons__add-to-wishlist"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="product-details__tabs"></div>
  `);

  const $alert = fragment.querySelector('.product-details__alert');
  const $gallery = fragment.querySelector('.product-details__gallery');
  const $header = fragment.querySelector('.product-details__header');
  const $sku = fragment.querySelector('.product-details__sku');
  const $stock = fragment.querySelector('.product-details__stock');
  const $price = fragment.querySelector('.product-details__price');
  const $galleryMobile = fragment.querySelector('.product-details__right-column .product-details__gallery');
  const $overview = fragment.querySelector('.product-details__overview');
  const $shortDescription = fragment.querySelector('.product-details__short-description');
  const $options = fragment.querySelector('.product-details__options');
  const $customOptions = fragment.querySelector('.product-details__custom-options');
  const $relatedProducts = fragment.querySelector('.product-details__related-products');
  const $wholesalePriceBreak = fragment.querySelector('.product-details__wholesale-price-break');
  const $quantity = fragment.querySelector('.product-details__quantity');
  const $giftCardOptions = fragment.querySelector('.product-details__gift-card-options');
  const $addToCart = fragment.querySelector('.product-details__buttons__add-to-cart');
  const $wishlistToggleBtn = fragment.querySelector('.product-details__buttons__add-to-wishlist');
  const $customerService = fragment.querySelector('.product-details__customer-service');
  const $tabs = fragment.querySelector('.product-details__tabs');

  block.replaceChildren(fragment);

  // Breadcrumb (Home > ancestor categories > product name), rendered as the
  // block's first child, above the gallery/details. Rendered once from the
  // first product payload; category data doesn't change across variants.
  const $breadcrumb = document.createElement('div');
  block.prepend($breadcrumb);
  let breadcrumbRendered = false;
  events.on('pdp/data', (data) => {
    if (breadcrumbRendered || !data?.sku) return;
    breadcrumbRendered = true;
    renderBreadcrumb($breadcrumb, data);
  }, { eager: true });

  // Related items are managed against each product in Commerce Admin. Load the
  // carousel here instead of requiring authors to add a second block to every
  // PDP, which also guarantees its placement above the purchase controls.
  const codeBasePath = window.hlx?.codeBasePath || '';
  const relatedProductsBlock = document.createElement('div');
  relatedProductsBlock.className = 'related-products';
  $relatedProducts.append(relatedProductsBlock);
  loadCSS(`${codeBasePath}/blocks/related-products/related-products.css`).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Related products: failed to load styles', error);
  });
  import('../related-products/related-products.js')
    .then(({ default: decorateRelatedProducts }) => decorateRelatedProducts(relatedProductsBlock))
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Related products: failed to initialize', error);
    });

  // Wholesale Price Break table, shown above the Qty / Add to Cart controls
  // whenever the current product (or resolved variant) has tier prices.
  const wholesalePriceBreakBlock = document.createElement('div');
  wholesalePriceBreakBlock.className = 'wholesale-price-break';
  $wholesalePriceBreak.append(wholesalePriceBreakBlock);
  loadCSS(`${codeBasePath}/blocks/wholesale-price-break/wholesale-price-break.css`).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Wholesale price break: failed to load styles', error);
  });
  import('../wholesale-price-break/wholesale-price-break.js')
    .then((mod) => mod.default(wholesalePriceBreakBlock))
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Wholesale price break: failed to initialize', error);
    });

  // Customer-service CMS block (e.g. shipping / trust badges) rendered under the
  // gallery in the left column. Authored as a CMS block in the CMS Block Builder
  // with the identifier below. Best-effort and non-blocking: if it isn't
  // configured or the fetch fails, the (empty) container simply stays hidden.
  fetchCmsBlock(CUSTOMER_SERVICE_BLOCK).then((html) => {
    if (html) {
      $customerService.classList.add('cms-block');
      $customerService.innerHTML = html; // sanitized server-side by the CMS Block Builder
    }
  });

  // Product info tabs (Description / Specs / Instructions / Returns / Q&A),
  // configured in config.json -> pdp-tabs. `eager: true` replays the current
  // product immediately (if loaded) and re-renders on variant/data updates.
  events.on('pdp/data', (p) => {
    if (p && p.sku) renderProductTabs($tabs, p);
  }, { eager: true });

  // SKU + In Stock / Out of Stock label meta row. Kept in sync with the current
  // product/variant; `inStock` is treated as true unless explicitly false.
  events.on('pdp/data', (data) => {
    if (!data?.sku) return;
    $sku.textContent = `${labels.Global?.Sku || 'SKU'}: ${data.sku}`;
    const inStock = data.inStock !== false;
    $stock.textContent = inStock
      ? (labels.Global?.InStock || 'In Stock')
      : (labels.Global?.OutOfStock || 'Out of Stock');
    $stock.classList.toggle('product-details__stock--in', inStock);
    $stock.classList.toggle('product-details__stock--out', !inStock);

    // Show the "Quick Overview" heading + divider only when the product has a
    // short description (ignore markup-only/empty values).
    const hasShortDescription = !!(data.shortDescription || '').replace(/<[^>]*>/g, '').trim();
    $overview.classList.toggle('product-details__overview--visible', hasShortDescription);
  }, { eager: true });

  const gallerySlots = {
    CarouselThumbnail: (ctx) => {
      if (ctx.mediaType === 'image') {
        tryRenderAemAssetsImage(ctx, {
          ...imageSlotConfig(ctx),
          wrapper: document.createElement('span'),
        });
      }
    },

    CarouselMainImage: (ctx) => {
      if (ctx.mediaType === 'image') {
        tryRenderAemAssetsImage(ctx, {
          ...imageSlotConfig(ctx),
        });
      }
    },
  };

  // Alert
  let inlineAlert = null;
  const routeToWishlist = rootLink('/wishlist');

  const [
    _galleryMobile,
    _gallery,
    _header,
    _price,
    _shortDescription,
    _options,
    _quantity,
    _giftCardOptions,
    wishlistToggleBtn,
  ] = await Promise.all([
    // Gallery (Mobile)
    pdpRendered.render(ProductGallery, {
      controls: 'dots',
      arrows: true,
      peak: false,
      gap: 'small',
      loop: false,
      videos: true, // Display videos if available
      imageParams: {
        ...IMAGES_SIZES,
      },

      slots: gallerySlots,
    })($galleryMobile),

    // Gallery (Desktop)
    pdpRendered.render(ProductGallery, {
      controls: 'thumbnailsColumn',
      arrows: true,
      peak: true,
      gap: 'small',
      loop: false,
      videos: true, // Display videos if available
      imageParams: {
        ...IMAGES_SIZES,
      },

      slots: gallerySlots,
    })($gallery),

    // Header (SKU is rendered by our own meta row below, so hide the dropin's)
    pdpRendered.render(ProductHeader, { hideSku: true })($header),

    // Price
    pdpRendered.render(ProductPrice, {})($price),

    // Short Description
    pdpRendered.render(ProductShortDescription, {})($shortDescription),

    // Configuration - Swatches
    pdpRendered.render(ProductOptions, {
      hideSelectedValue: false,
      slots: {
        SwatchImage: (ctx) => {
          tryRenderAemAssetsImage(ctx, {
            ...imageSlotConfig(ctx),
            wrapper: document.createElement('span'),
          });
        },
      },
    })($options),

    // Configuration  Quantity
    pdpRendered.render(ProductQuantity, {})($quantity),

    // Configuration  Gift Card Options
    pdpRendered.render(ProductGiftCardOptions, {})($giftCardOptions),

    // Wishlist button - WishlistToggle Container (labeled primary button so it
    // shows the "Add to Wish List" text + heart icon like the design)
    wishlistRender.render(WishlistToggle, {
      product,
      variant: 'primary',
      size: 'large',
      labelToWishlist: labels.Global?.AddToWishlist || 'Add to Wish List',
      labelWishlisted: labels.Global?.RemoveFromWishlist || 'In Wish List',
    })($wishlistToggleBtn),
  ]);

  // Configuration – Button - Add to Cart
  const addToCart = await UI.render(Button, {
    children: labels.Global?.AddProductToCart,
    icon: h(Icon, { source: 'Cart' }),
    variant: 'primary',
    size: 'large',
    onClick: async () => {
      const buttonActionText = isUpdateMode
        ? labels.Global?.UpdatingInCart
        : labels.Global?.AddingToCart;
      try {
        addToCart.setProps((prev) => ({
          ...prev,
          children: buttonActionText,
          disabled: true,
        }));

        // get the current selection values
        const values = pdpApi.getProductConfigurationValues();
        const valid = pdpApi.isProductConfigurationValid() && isCustomOptionsValid;

        //  Merge in the classic customizable options (e.g. "Select Inlet
        // Fitting"), which live outside the dropin's own configuration state.
        const { customOptionsApi } = $customOptions;
        const mergedValues = customOptionsApi ? {
          ...values,
          optionsUIDs: [
            ...(values.optionsUIDs || []),
            ...customOptionsApi.getSelectedOptionUids(),
          ],
          enteredOptions: [
            ...(values.enteredOptions || []),
            ...customOptionsApi.getEnteredOptions(),
          ],
        } : values;

        // add or update the product in the cart
        if (valid) {
          if (isUpdateMode) {
            // --- Update existing item ---
            const { updateProductsFromCart } = await import(
              '@dropins/storefront-cart/api.js'
            );

            await updateProductsFromCart([{ ...mergedValues, uid: itemUidFromUrl }]);

            // --- START REDIRECT ON UPDATE ---
            const updatedSku = mergedValues?.sku;
            if (updatedSku) {
              const cartRedirectUrl = new URL(
                rootLink('/cart'),
                window.location.origin,
              );
              cartRedirectUrl.searchParams.set('itemUid', itemUidFromUrl);
              window.location.href = cartRedirectUrl.toString();
            } else {
              // Fallback if SKU is somehow missing (shouldn't happen in normal flow)
              console.warn(
                'Could not retrieve SKU for updated item. Redirecting to cart without parameter.',
              );
              window.location.href = rootLink('/cart');
            }
            return;
          }
          // --- Add new item ---
          const { addProductsToCart } = await import(
            '@dropins/storefront-cart/api.js'
          );
          await addProductsToCart([{ ...mergedValues }, ...relatedSelection]);
        }

        // reset any previous alerts if successful
        inlineAlert?.remove();
      } catch (error) {
        // add alert message
        inlineAlert = await UI.render(InLineAlert, {
          heading: 'Error',
          description: error.message,
          icon: h(Icon, { source: 'Warning' }),
          'aria-live': 'assertive',
          role: 'alert',
          onDismiss: () => {
            inlineAlert.remove();
          },
        })($alert);

        // Scroll the alertWrapper into view
        $alert.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      } finally {
        // Reset button text using the helper function which respects the current mode
        updateAddToCartButtonText(addToCart, isUpdateMode, labels);
        // Re-enable button, unless the current variant is out of stock
        addToCart.setProps((prev) => ({
          ...prev,
          disabled: isOutOfStock,
        }));
      }
    },
  })($addToCart);

  // Lifecycle Events
  let isConfigValid = true;
  const updateAddToCartDisabled = () => {
    addToCart.setProps((prev) => ({
      ...prev,
      disabled: isOutOfStock || !isConfigValid || !isCustomOptionsValid,
    }));
  };

  events.on('pdp/data', (data) => {
    isOutOfStock = data?.inStock === false;
    updateAddToCartDisabled();
  }, { eager: true });

  events.on('pdp/valid', (valid) => {
    // update add to cart button disabled state based on product selection validity and stock status
    isConfigValid = valid;
    updateAddToCartDisabled();
  }, { eager: true });

  // Classic Magento customizable options (e.g. "Select Inlet Fitting"). Keyed
  // off sku so a variant-only pdp/data update doesn't reset in-progress
  // selections by re-rendering the form.
  let customOptionsSku = null;
  events.on('pdp/data', (data) => {
    if (!data?.sku || data.sku === customOptionsSku) return;
    customOptionsSku = data.sku;
    renderCustomizableOptions($customOptions, data).then(() => {
      const { customOptionsApi } = $customOptions;
      isCustomOptionsValid = customOptionsApi ? customOptionsApi.isValid() : true;
      customOptionsApi?.onValidityChange((valid) => {
        isCustomOptionsValid = valid;
        updateAddToCartDisabled();
      });
      updateAddToCartDisabled();
    });
  }, { eager: true });

  // Handle option changes
  events.on('pdp/values', () => {
    if (wishlistToggleBtn) {
      const configValues = pdpApi.getProductConfigurationValues();

      // Check URL parameter for empty optionsUIDs
      const urlOptionsUIDs = urlParams.get('optionsUIDs');

      // If URL has empty optionsUIDs parameter, treat as base product (no options)
      const optionUIDs = urlOptionsUIDs === '' ? undefined : (configValues?.optionsUIDs || undefined);

      wishlistToggleBtn.setProps((prev) => ({
        ...prev,
        product: {
          ...product,
          optionUIDs,
        },
      }));
    }
  }, { eager: true });

  events.on('wishlist/alert', ({ action, item }) => {
    wishlistRender.render(WishlistAlert, {
      action,
      item,
      routeToWishlist,
    })($alert);

    setTimeout(() => {
      $alert.innerHTML = '';
    }, 5000);

    setTimeout(() => {
      $alert.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 0);
  });

  // --- Add new event listener for cart/data ---
  events.on(
    'cart/data',
    (cartData) => {
      let itemIsInCart = false;
      if (itemUidFromUrl && cartData?.items) {
        itemIsInCart = cartData.items.some(
          (item) => item.uid === itemUidFromUrl,
        );
      }
      // Set the update mode state
      isUpdateMode = itemIsInCart;

      // Update button text based on whether the item is in the cart
      updateAddToCartButtonText(addToCart, itemIsInCart, labels);
    },
    { eager: true },
  );

  // Set JSON-LD and Meta Tags
  events.on('aem/lcp', () => {
    const isPrerendered = isProductPrerendered();
    if (product && !isPrerendered) {
      setJsonLdProduct(product);
      setMetaTags(product);
      document.title = product.name;
    }
  }, { eager: true });

  return Promise.resolve();
}

async function setJsonLdProduct(product) {
  const {
    name,
    inStock,
    description,
    sku,
    urlKey,
    price,
    priceRange,
    images,
    attributes,
  } = product;
  const amount = priceRange?.minimum?.final?.amount || price?.final?.amount;
  const brand = attributes?.find((attr) => attr.name === 'brand');

  // get variants
  const { data } = await pdpApi.fetchGraphQl(`
    query GET_PRODUCT_VARIANTS($sku: String!) {
      variants(sku: $sku) {
        variants {
          product {
            sku
            name
            inStock
            images(roles: ["image"]) {
              url
            }
            ...on SimpleProductView {
              price {
                final { amount { currency value } }
              }
            }
          }
        }
      }
    }
  `, {
    method: 'GET',
    variables: { sku },
  });

  const variants = data?.variants?.variants || [];

  const ldJson = {
    '@context': 'http://schema.org',
    '@type': 'Product',
    name,
    description,
    image: images[0]?.url,
    offers: [],
    productID: sku,
    brand: {
      '@type': 'Brand',
      name: brand?.value,
    },
    url: new URL(getProductLink(urlKey, sku), window.location),
    sku,
    '@id': new URL(getProductLink(urlKey, sku), window.location),
  };

  if (variants.length > 1) {
    ldJson.offers.push(...variants.map((variant) => ({
      '@type': 'Offer',
      name: variant.product.name,
      image: variant.product.images[0]?.url,
      price: variant.product.price.final.amount.value,
      priceCurrency: variant.product.price.final.amount.currency,
      availability: variant.product.inStock ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock',
      sku: variant.product.sku,
    })));
  } else {
    ldJson.offers.push({
      '@type': 'Offer',
      price: amount?.value,
      priceCurrency: amount?.currency,
      availability: inStock ? 'http://schema.org/InStock' : 'http://schema.org/OutOfStock',
    });
  }

  setJsonLd(ldJson, 'product');
}

function createMetaTag(property, content, type) {
  if (!property || !type) {
    return;
  }
  let meta = document.head.querySelector(`meta[${type}="${property}"]`);
  if (meta) {
    if (!content) {
      meta.remove();
      return;
    }
    meta.setAttribute(type, property);
    meta.setAttribute('content', content);
    return;
  }
  if (!content) {
    return;
  }
  meta = document.createElement('meta');
  meta.setAttribute(type, property);
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

function setMetaTags(product) {
  if (!product?.sku) {
    return;
  }

  const price = product.prices.final.minimumAmount ?? product.prices.final.amount;

  createMetaTag('title', product.metaTitle || product.name, 'name');
  createMetaTag('description', product.metaDescription, 'name');
  createMetaTag('keywords', product.metaKeyword, 'name');

  createMetaTag('og:type', 'product', 'property');
  createMetaTag('og:description', product.shortDescription, 'property');
  createMetaTag('og:title', product.metaTitle || product.name, 'property');
  createMetaTag('og:url', window.location.href, 'property');
  const mainImage = product?.images?.filter((image) => image.roles.includes('thumbnail'))[0];
  const metaImage = mainImage?.url || product?.images[0]?.url;
  createMetaTag('og:image', metaImage, 'property');
  createMetaTag('og:image:secure_url', metaImage, 'property');
  createMetaTag('product:price:amount', price.value, 'property');
  createMetaTag('product:price:currency', price.currency, 'property');
}

/**
 * Returns the configuration for an image slot.
 * @param ctx - The context of the slot.
 * @returns The configuration for the image slot.
 */
function imageSlotConfig(ctx) {
  const { data, defaultImageProps } = ctx;
  return {
    alias: data.sku,
    imageProps: defaultImageProps,

    params: {
      width: defaultImageProps.width,
      height: defaultImageProps.height,
    },
  };
}
