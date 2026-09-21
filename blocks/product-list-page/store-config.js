// Products-per-page as configured in Commerce Admin (Stores > Configuration >
// Catalog > Storefront > Grid per Page > Default Value). Not exposed by the
// storefront-product-discovery/storefront-catalog-data dropins, so it's
// queried directly against Commerce core GraphQL, following the same pattern
// as blocks/product-details/breadcrumb.js.
import { CORE_FETCH_GRAPHQL } from '../../scripts/commerce.js';

const GRID_PAGE_SIZE_QUERY = `
  query GRID_PAGE_SIZE {
    storeConfig {
      grid_per_page
    }
  }
`;

let gridPageSizePromise;

/**
 * Fetches the backend's default grid page size. Cached for the lifetime of
 * the page. Resolves to `undefined` if the query fails or the field is unset,
 * so callers can fall back to a hardcoded default.
 */
export default function fetchGridPageSize() {
  if (!gridPageSizePromise) {
    gridPageSizePromise = CORE_FETCH_GRAPHQL.fetchGraphQl(GRID_PAGE_SIZE_QUERY, { method: 'GET' })
      .then(({ data, errors }) => {
        if (errors?.length) throw new Error(errors[0].message);
        return data?.storeConfig?.grid_per_page;
      })
      .catch((e) => {
        console.error('Error fetching grid_per_page store config', e);
        return undefined;
      });
  }
  return gridPageSizePromise;
}
