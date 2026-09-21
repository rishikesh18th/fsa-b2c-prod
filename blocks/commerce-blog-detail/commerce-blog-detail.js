import { loadCSS } from '../../scripts/aem.js';
import {
  fetchBlog,
  fetchBlogList,
  resolveBlogId,
  currentSlug,
  formatDate,
  blogPath,
  listingPath,
  renderRecentPosts,
  loaderHTML,
} from '../commerce-blog/blog-shared.js';

const RECENT_POSTS_COUNT = 3;

/** Escape a string for safe use in an HTML attribute. */
function attr(value = '') {
  return String(value).replace(/"/g, '&quot;');
}

/** Render the social share row for the current post. */
function renderShare(title) {
  const url = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(title || document.title || '');
  return `
    <div class="commerce-blog-detail__share">
      <span class="commerce-blog-detail__share-label">Share</span>
      <a class="commerce-blog-detail__share-btn" href="https://www.facebook.com/sharer/sharer.php?u=${url}" target="_blank" rel="noopener">Share on Facebook</a>
      <a class="commerce-blog-detail__share-btn" href="https://twitter.com/intent/tweet?url=${url}&text=${text}" target="_blank" rel="noopener">Share on X</a>
      <a class="commerce-blog-detail__share-btn" href="https://pinterest.com/pin/create/button/?url=${url}&description=${text}" target="_blank" rel="noopener">Share on Pinterest</a>
    </div>
  `;
}

/** Render the Previous/Next post navigation from the ordered post list. */
function renderAdjacent(prev, next) {
  if (!prev && !next) return '';
  return `
    <nav class="commerce-blog-detail__adjacent" aria-label="More posts">
      ${prev ? `
        <a class="commerce-blog-detail__adjacent-item commerce-blog-detail__adjacent-item--prev" href="${blogPath(prev)}">
          <span class="commerce-blog-detail__adjacent-label">Previous</span>
          <span class="commerce-blog-detail__adjacent-title">${prev.title || ''}</span>
        </a>` : '<span class="commerce-blog-detail__adjacent-item"></span>'}
      ${next ? `
        <a class="commerce-blog-detail__adjacent-item commerce-blog-detail__adjacent-item--next" href="${blogPath(next)}">
          <span class="commerce-blog-detail__adjacent-label">Next</span>
          <span class="commerce-blog-detail__adjacent-title">${next.title || ''}</span>
        </a>` : '<span class="commerce-blog-detail__adjacent-item"></span>'}
    </nav>
  `;
}

/**
 * Renders a single blog post at /blog/post/<identifier>: a full-width hero with
 * the title and category, then a two-column body (article + "Recent Posts"),
 * plus share links and Previous/Next navigation.
 * @param {Element} block The block element
 */
export default async function decorate(block) {
  const base = window.hlx?.codeBasePath || '';
  // Reuse the listing layout/sidebar/recent styles, plus this block's own.
  loadCSS(`${base}/blocks/commerce-blog/commerce-blog.css`);
  loadCSS(`${base}/blocks/commerce-blog-detail/commerce-blog-detail.css`);

  block.textContent = '';
  block.classList.add('commerce-blog-detail');
  block.setAttribute('aria-busy', 'true');
  block.innerHTML = loaderHTML();

  const slug = currentSlug();

  try {
    // One list fetch powers both the recent-posts widget and prev/next nav.
    const [id, list] = await Promise.all([
      resolveBlogId(slug),
      fetchBlogList().catch(() => []),
    ]);
    const post = id ? await fetchBlog(id) : null;
    block.removeAttribute('aria-busy');

    if (!post) {
      block.innerHTML = '<p class="commerce-blog-detail__empty">Sorry, we couldn’t find that post.</p>';
      return;
    }

    document.title = post.title || document.title;

    const category = post.categories?.[0];
    const categoryLabel = (post.categories || []).map((c) => c.title).join(', ');

    // Locate the post in the ordered list to derive its neighbours.
    const index = list.findIndex((p) => p.id === post.id || p.identifier === post.identifier);
    const prev = index > 0 ? list[index - 1] : null;
    const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
    const recent = list.slice(0, RECENT_POSTS_COUNT);

    // --- Breadcrumb (own light bar, above the hero) ---
    const breadcrumb = document.createElement('nav');
    breadcrumb.className = 'commerce-blog-detail__breadcrumb';
    breadcrumb.setAttribute('aria-label', 'Breadcrumb');
    breadcrumb.innerHTML = `
      <div class="commerce-blog-detail__breadcrumb-inner">
        <a href="/">Home</a>
        <span class="commerce-blog-detail__breadcrumb-sep" aria-hidden="true">›</span>
        <a href="${listingPath()}">Blog</a>
        ${category ? `
          <span class="commerce-blog-detail__breadcrumb-sep" aria-hidden="true">›</span>
          <span>${category.title}</span>` : ''}
        <span class="commerce-blog-detail__breadcrumb-sep" aria-hidden="true">›</span>
        <span class="commerce-blog-detail__breadcrumb-current" aria-current="page">${post.title || ''}</span>
      </div>
    `;

    // --- Hero (full-width) ---
    const hero = document.createElement('div');
    hero.className = 'commerce-blog-detail__hero';
    hero.innerHTML = `
      <div class="commerce-blog-detail__hero-inner">
        <h1 class="commerce-blog-detail__title">${post.title || ''}</h1>
        <div class="commerce-blog-detail__hero-meta">
          ${categoryLabel ? `<span class="commerce-blog-detail__label">${categoryLabel}</span>` : ''}
          <span class="commerce-blog-detail__byline">
            ${post.author?.name ? `<span class="commerce-blog-detail__author">${post.author.name}</span>` : ''}
            ${post.publish_time ? `<time datetime="${attr(post.publish_time)}">${formatDate(post.publish_time)}</time>` : ''}
          </span>
        </div>
      </div>
    `;

    // --- Two-column body ---
    const layout = document.createElement('div');
    layout.className = 'commerce-blog__layout';

    const main = document.createElement('div');
    main.className = 'commerce-blog__main';
    // content is Page Builder HTML authored in the CMS; render it as-is.
    main.innerHTML = `
      <article class="commerce-blog-detail__article">
        ${post.featured_img ? `
          <div class="commerce-blog-detail__media">
            <img src="${attr(post.featured_img)}" alt="${attr(post.featured_img_alt || post.title || '')}" />
          </div>` : ''}
        <div class="commerce-blog-detail__content">${post.content || post.display_content || ''}</div>
      </article>
      ${renderShare(post.title)}
      ${renderAdjacent(prev, next)}
    `;

    const sidebar = document.createElement('aside');
    sidebar.className = 'commerce-blog-sidebar';
    const recentNav = document.createElement('nav');
    recentNav.className = 'commerce-blog-sidebar__recent';
    recentNav.setAttribute('aria-label', 'Recent posts');
    renderRecentPosts(recentNav, recent);
    sidebar.append(recentNav);

    layout.append(main, sidebar);
    block.textContent = '';
    block.append(breadcrumb, hero, layout);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('commerce-blog-detail: failed to load post', err);
    block.removeAttribute('aria-busy');
    block.innerHTML = '<p class="commerce-blog-detail__error">Sorry, we couldn’t load this post right now.</p>';
  }
}
