// Category description (title + rich text, with a "read more" toggle for long
// text), rendered as the block's first child, above the breadcrumb/slider.
//
// Unlike the category name/urlPath used by the breadcrumb and slider,
// `CategoryView` (the Catalog Service type behind the `categories` query) has
// no content fields at all. The `categoryTree` query returns a different type,
// `CategoryTreeView`, which does expose `description` — this is the Magento
// Admin "Content > Description" field on the category, populated by content
// authors directly in Commerce, independent of any AEM/EDS-authored content.
import { CS_FETCH_GRAPHQL } from '../../scripts/commerce.js';

const CATEGORY_TREE_QUERY = `
  query CATEGORY_DESCRIPTION($slugs: [String!]!) {
    categoryTree(slugs: $slugs) {
      name
      description
    }
  }
`;

/** Fetch a category's admin-authored name/description by url path (slug). */
async function fetchCategoryDescription(urlPath) {
  const { data, errors } = await CS_FETCH_GRAPHQL.fetchGraphQl(CATEGORY_TREE_QUERY, {
    method: 'GET',
    variables: { slugs: [urlPath] },
  });
  if (errors?.length) throw new Error(errors[0].message);
  return data?.categoryTree?.[0] || null;
}

// Descriptions longer than this many characters get a "read more" toggle.
const TRUNCATE_LENGTH = 320;

/**
 * Render the category title + description into `container` for the given
 * category url path. No-op when there's no url path or no authored
 * description. Best-effort: never throws.
 * @param {HTMLElement} container element to render into
 * @param {string} urlPath current category url path (PLP config.urlpath)
 */
export default async function renderCategoryDescription(container, urlPath) {
  if (!container || !urlPath) return;

  let category;
  try {
    category = await fetchCategoryDescription(urlPath);
  } catch {
    return;
  }

  const description = (category?.description || '').trim();
  if (!description) return;

  const root = document.createElement('div');
  root.className = 'category-description';

  if (category.name) {
    const title = document.createElement('h1');
    title.className = 'category-description__title';
    title.textContent = category.name;
    root.append(title);
  }

  const body = document.createElement('div');
  body.className = 'category-description__body';
  body.innerHTML = description; // trusted, authored in Commerce Admin
  root.append(body);

  if (description.replace(/<[^>]*>/g, '').trim().length > TRUNCATE_LENGTH) {
    root.classList.add('category-description--truncated');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'category-description__toggle';
    toggle.textContent = 'read more +';
    toggle.addEventListener('click', () => {
      const expanded = root.classList.toggle('category-description--expanded');
      toggle.textContent = expanded ? 'read less -' : 'read more +';
    });
    root.append(toggle);
  }

  container.append(root);
}
