// Shared data + helpers for the Wine Talk blog blocks (listing + detail).
//
// Posts come from a custom blog GraphQL endpoint (API Mesh), NOT the Adobe
// Commerce GraphQL endpoint, so we fetch it directly instead of going through
// CORE_FETCH_GRAPHQL / CS_FETCH_GRAPHQL. The URL is configured in config.json
// as `blog-endpoint`; this is the fallback if it's missing or config isn't ready.
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

const DEFAULT_BLOG_ENDPOINT = 'https://edge-sandbox-graph.adobe.io/api/ceb23d38-6875-432f-bebf-a89bf367b723/graphql';

export function blogEndpoint() {
  try {
    return getConfigValue('blog-endpoint') || DEFAULT_BLOG_ENDPOINT;
  } catch {
    return DEFAULT_BLOG_ENDPOINT;
  }
}

const POST_FIELDS = /* GraphQL */ `
  id
  identifier
  title
  featured_img
  featured_img_alt
  status
  display_content
  publish_time
  include_in_sidebar_tree
  store_ids
  author { id name }
  categories { id title identifier }
`;

const BLOGS_QUERY = /* GraphQL */ `
  query Blogs($page: Int!, $size: Int!) {
    blogs(
      page: $page
      pageSize: $size
      sort: { field: "publish_time", direction: "DESC" }
      filter: { status: "enabled" }
    ) {
      total_count
      total_pages
      page
      items { ${POST_FIELDS} }
    }
  }
`;

const BLOGS_SEARCH_QUERY = /* GraphQL */ `
  query BlogsSearch($q: String!, $page: Int!, $size: Int!) {
    blogs(
      page: $page
      pageSize: $size
      sort: { field: "publish_time", direction: "DESC" }
      filter: { status: "enabled", title: $q }
    ) {
      total_count
      total_pages
      page
      items { ${POST_FIELDS} }
    }
  }
`;

const BLOGS_BY_CATEGORY_QUERY = /* GraphQL */ `
  query BlogsByCategory($categoryId: ID!, $page: Int!, $size: Int!) {
    blogsByCategory(
      categoryId: $categoryId
      page: $page
      pageSize: $size
      sort: { field: "publish_time", direction: "DESC" }
    ) {
      total_count
      total_pages
      page
      items { ${POST_FIELDS} }
    }
  }
`;

const BLOG_QUERY = /* GraphQL */ `
  query Blog($id: ID!) {
    blog(id: $id) {
      ${POST_FIELDS}
      content
    }
  }
`;

const BLOG_SLUGS_QUERY = /* GraphQL */ `
  query BlogSlugs {
    blogs(page: 1, pageSize: 1000, filter: { status: "enabled" }) {
      items { id identifier }
    }
  }
`;

// Lightweight ordered post list (newest first) — powers the "Recent Posts"
// widget and Previous/Next navigation on the detail page from a single fetch.
const BLOG_LIST_LITE_QUERY = /* GraphQL */ `
  query BlogListLite {
    blogs(
      page: 1
      pageSize: 1000
      sort: { field: "publish_time", direction: "DESC" }
      filter: { status: "enabled" }
    ) {
      items {
        id
        identifier
        title
        featured_img
        featured_img_alt
        publish_time
        categories { id title identifier }
      }
    }
  }
`;

const CATEGORIES_QUERY = /* GraphQL */ `
  query BlogCategories {
    blogCategories(page: 1, pageSize: 200) {
      total_count
      items { id title identifier blog_count }
    }
  }
`;

export async function gql(query, variables) {
  const res = await fetch(blogEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Blog request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json?.errors?.length) {
    throw new Error(json.errors[0]?.message || 'Failed to load blogs');
  }
  return json?.data || null;
}

export async function fetchBlogs(page, size) {
  const data = await gql(BLOGS_QUERY, { page, size });
  return data?.blogs || null;
}

export async function searchBlogs(q, page, size) {
  const data = await gql(BLOGS_SEARCH_QUERY, { q, page, size });
  return data?.blogs || null;
}

export async function fetchBlogsByCategory(categoryId, page, size) {
  const data = await gql(BLOGS_BY_CATEGORY_QUERY, { categoryId, page, size });
  return data?.blogsByCategory || null;
}

export async function fetchBlogList() {
  const data = await gql(BLOG_LIST_LITE_QUERY, {});
  return data?.blogs?.items || [];
}

export async function fetchCategories() {
  const data = await gql(CATEGORIES_QUERY, {});
  // Display categories in reverse of the endpoint's order.
  return (data?.blogCategories?.items || []).slice().reverse();
}

export async function fetchBlog(id) {
  const data = await gql(BLOG_QUERY, { id });
  return data?.blog || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a URL slug (the blog identifier) to its UUID. The blog(id) query
 * only accepts the UUID, so for a slug we look it up in the full blog list.
 */
export async function resolveBlogId(slug) {
  if (!slug) return null;
  if (UUID_RE.test(slug)) return slug;
  const data = await gql(BLOG_SLUGS_QUERY, {});
  const match = (data?.blogs?.items || []).find((b) => b.identifier === slug);
  return match?.id || null;
}

/**
 * Markup for a loading spinner shown while blog content is being fetched.
 * @param {string} [label] accessible status text
 */
export function loaderHTML(label = 'Loading…') {
  return `
    <div class="commerce-blog-loader" role="status" aria-live="polite">
      <span class="commerce-blog-loader__spinner" aria-hidden="true"></span>
      <span class="commerce-blog-loader__text">${label}</span>
    </div>
  `;
}

export function formatDate(value) {
  if (!value) return '';
  // publish_time may be ISO or "YYYY-MM-DD HH:MM:SS"
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function stripHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  // display_content is Page Builder HTML with embedded <style>/<script>
  // blocks; remove them so their CSS/JS text doesn't leak into plain text.
  tmp.querySelectorAll('style, script').forEach((el) => el.remove());
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

export function excerpt(content, max = 180) {
  const text = stripHtml(content);
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

/**
 * The blog listing path, preserving any multistore prefix and the base segment
 * (`/blog` or legacy `/wine-talk`) used in the current URL. Falls back to /blog.
 */
export function listingPath() {
  const m = window.location.pathname.match(/^(.*?)\/(wine-talk|blog)(?:\/|$)/);
  return m ? `${m[1]}/${m[2]}` : '/blog';
}

/**
 * Post detail URL: /blog/post/<identifier> (e.g. /blog/post/best-australian-white-wine).
 * Category is intentionally not part of the URL.
 */
export function blogPath(post) {
  const slug = post.identifier || post.id;
  return `${listingPath()}/post/${slug}`;
}

/**
 * The post slug for the current detail URL — the LAST path segment, so both
 * /wine-talk/<slug> and /wine-talk/<category>/<slug> resolve to the post.
 */
export function currentSlug() {
  const base = listingPath();
  const path = window.location.pathname.replace(/\/$/, '');
  if (!path.startsWith(`${base}/`)) return '';
  const segments = path.slice(base.length + 1).split('/');
  return decodeURIComponent(segments[segments.length - 1]);
}

/** Category landing URL: /wine-talk/<category-identifier>. */
export function categoryPath(categoryIdentifier) {
  return categoryIdentifier ? `${listingPath()}/${categoryIdentifier}` : listingPath();
}

/**
 * The category identifier for a category landing page, i.e. /wine-talk/<category>
 * (exactly one segment after the listing path). Returns '' on the index or a
 * post detail page (which has two segments).
 */
export function currentCategorySlug() {
  const base = listingPath();
  const path = window.location.pathname.replace(/\/$/, '');
  if (!path.startsWith(`${base}/`)) return '';
  const segments = path.slice(base.length + 1).split('/');
  return segments.length === 1 ? decodeURIComponent(segments[0]) : '';
}

/**
 * Render the "Categories" sidebar list (with per-category post counts) as links
 * to the category landing pages. `activeId` highlights the current category;
 * `onSelect(category)` is called with the category object (or null for "All").
 */
export function renderCategories(nav, categories, totalAll, activeId, onSelect) {
  nav.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'commerce-blog-sidebar__title';
  heading.textContent = 'Categories';

  const ul = document.createElement('ul');
  ul.className = 'commerce-blog-categories';

  const makeItem = (category, title, count) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'commerce-blog-categories__link';
    link.href = category ? categoryPath(category.identifier) : listingPath();
    if ((category?.id ?? null) === activeId) link.classList.add('is-active');
    link.innerHTML = `<span class="commerce-blog-categories__name">${title}</span>`
      + `<span class="commerce-blog-categories__count">${count}</span>`;
    if (onSelect) {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        onSelect(category);
      });
    }
    li.append(link);
    return li;
  };

  ul.append(makeItem(null, 'All', totalAll));
  categories.forEach((c) => ul.append(makeItem(c, c.title, c.blog_count ?? 0)));

  nav.append(heading, ul);
}

/**
 * Render a horizontal bar of category links (names only) for the top of the
 * main content. Real <a> links to /wine-talk/<category>, so navigation works on
 * every page. `activeId` highlights the current category, if any.
 */
export function renderCategoryBar(nav, categories, activeId) {
  nav.innerHTML = '';
  categories.forEach((c) => {
    const link = document.createElement('a');
    link.className = 'commerce-blog-catbar__link';
    link.href = categoryPath(c.identifier);
    if (c.id === activeId) link.classList.add('is-active');
    link.textContent = c.title;
    nav.append(link);
  });
}

/**
 * Render the "Search Wine Talk" box. On submit, navigates to the listing with
 * a ?q= query.
 */
export function renderSearch(container, initialValue = '') {
  container.innerHTML = '';
  const form = document.createElement('form');
  form.className = 'commerce-blog-search';
  form.setAttribute('role', 'search');

  const heading = document.createElement('h2');
  heading.className = 'commerce-blog-sidebar__title';
  heading.textContent = 'Search';

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'commerce-blog-search__input';
  input.name = 'q';
  input.placeholder = 'Search Wine Talk';
  input.value = initialValue;

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'commerce-blog-search__button';
  button.textContent = 'Search';

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    const url = q ? `${listingPath()}?q=${encodeURIComponent(q)}` : listingPath();
    window.location.assign(url);
  });

  form.append(input, button);
  container.append(heading, form);
}

/**
 * Render the "Recent Posts" sidebar widget: a small list of the latest posts,
 * each linking to its detail page with an optional thumbnail and publish date.
 */
export function renderRecentPosts(nav, posts) {
  nav.innerHTML = '';

  const heading = document.createElement('h2');
  heading.className = 'commerce-blog-sidebar__title';
  heading.textContent = 'Recent Posts';
  nav.append(heading);

  if (!posts || !posts.length) {
    const empty = document.createElement('p');
    empty.className = 'commerce-blog-recent__empty';
    empty.textContent = 'No recent posts.';
    nav.append(empty);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'commerce-blog-recent';

  posts.forEach((post) => {
    const li = document.createElement('li');
    const url = blogPath(post);
    li.innerHTML = `
      <a class="commerce-blog-recent__item" href="${url}">
        ${post.featured_img ? `
          <span class="commerce-blog-recent__media">
            <img src="${post.featured_img}" alt="${post.featured_img_alt || post.title || ''}" loading="lazy" />
          </span>` : ''}
        <span class="commerce-blog-recent__info">
          <span class="commerce-blog-recent__title">${post.title || ''}</span>
          ${post.publish_time ? `<time class="commerce-blog-recent__date" datetime="${post.publish_time}">${formatDate(post.publish_time)}</time>` : ''}
        </span>
      </a>
    `;
    ul.append(li);
  });

  nav.append(ul);
}
