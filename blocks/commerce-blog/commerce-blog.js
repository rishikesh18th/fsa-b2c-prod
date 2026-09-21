import { readBlockConfig, loadCSS } from '../../scripts/aem.js';
import {
  fetchBlogs,
  searchBlogs,
  fetchBlogsByCategory,
  fetchCategories,
  formatDate,
  excerpt,
  blogPath,
  currentCategorySlug,
  renderRecentPosts,
  loaderHTML,
} from './blog-shared.js';

const DEFAULT_PAGE_SIZE = 12;
const RECENT_POSTS_COUNT = 3;

function renderCard(post) {
  const article = document.createElement('article');
  article.className = 'commerce-blog-card';
  article.dataset.blogId = post.id;

  const url = blogPath(post);
  // Category shown as a plain label (no category URL); primary category only.
  const categoryLabel = (post.categories || []).map((c) => c.title).join(', ');

  // Layout order: label, title, meta, excerpt, "Read more", then image.
  article.innerHTML = `
    <div class="commerce-blog-card__body">
      ${categoryLabel ? `<span class="commerce-blog-card__label">${categoryLabel}</span>` : ''}
      <h2 class="commerce-blog-card__title">
        <a href="${url}">${post.title || ''}</a>
      </h2>
      <div class="commerce-blog-card__meta">
        ${post.author?.name ? `<span class="commerce-blog-card__author">${post.author.name}</span>` : ''}
        ${post.publish_time ? `<time class="commerce-blog-card__date" datetime="${post.publish_time}">${formatDate(post.publish_time)}</time>` : ''}
      </div>
      <p class="commerce-blog-card__excerpt">${excerpt(post.display_content)}</p>
      <a class="commerce-blog-card__more" href="${url}">Read more</a>
    </div>
    ${post.featured_img ? `
      <a class="commerce-blog-card__media" href="${url}">
        <img src="${post.featured_img}" alt="${post.featured_img_alt || post.title || ''}" loading="lazy" />
      </a>` : ''}
  `;
  return article;
}

/**
 * Build a windowed list of page tokens, e.g. [1, '…', 4, 5, 6, '…', 42].
 */
function pageWindow(page, totalPages, span = 5) {
  if (totalPages <= span + 2) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const half = Math.floor(span / 2);
  let start = Math.max(2, page - half);
  let end = Math.min(totalPages - 1, page + half);
  if (page - half < 2) end = Math.min(totalPages - 1, span);
  if (page + half > totalPages - 1) start = Math.max(2, totalPages - span + 1);

  const tokens = [1];
  if (start > 2) tokens.push('…');
  for (let p = start; p <= end; p += 1) tokens.push(p);
  if (end < totalPages - 1) tokens.push('…');
  tokens.push(totalPages);
  return tokens;
}

function renderPagination(container, info, onNavigate) {
  const {
    page, totalPages, totalCount, pageSize,
  } = info;
  container.innerHTML = '';
  if (!totalCount) return;

  const pages = document.createElement('div');
  pages.className = 'commerce-blog-pagination__pages';

  const makeBtn = (label, target, { active = false, disabled = false, cls = '' } = {}) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `commerce-blog-pagination__btn ${cls}`.trim();
    btn.textContent = label;
    if (active) btn.setAttribute('aria-current', 'page');
    if (disabled) btn.disabled = true;
    else btn.addEventListener('click', () => onNavigate(target));
    return btn;
  };

  if (totalPages > 1) {
    pageWindow(page, totalPages).forEach((token) => {
      if (token === '…') {
        const span = document.createElement('span');
        span.className = 'commerce-blog-pagination__ellipsis';
        span.textContent = '…';
        pages.append(span);
      } else {
        pages.append(makeBtn(String(token), token, { active: token === page }));
      }
    });

    pages.append(makeBtn('›', page + 1, {
      disabled: page >= totalPages,
      cls: 'commerce-blog-pagination__nav',
    }));
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);
  const summary = document.createElement('span');
  summary.className = 'commerce-blog-pagination__summary';
  summary.textContent = `Items ${from} to ${to} of ${totalCount} total`;

  container.append(pages, summary);
}

export default async function decorate(block) {
  const cfg = readBlockConfig(block);
  const pageSize = Number(cfg['page-size']) || DEFAULT_PAGE_SIZE;
  const params = new URLSearchParams(window.location.search);

  // Ensure styles are present even when loaded via the synthetic-route path.
  loadCSS(`${window.hlx?.codeBasePath || ''}/blocks/commerce-blog/commerce-blog.css`);

  block.textContent = '';
  block.classList.add('commerce-blog');

  // Page-title banner shown above the two-column body.
  const pageTitle = document.createElement('h1');
  pageTitle.className = 'commerce-blog__page-title';
  pageTitle.textContent = 'Blog';

  // Two-column layout: main post list (left) | "Recent Posts" sidebar (right).
  const layout = document.createElement('div');
  layout.className = 'commerce-blog__layout';

  const main = document.createElement('div');
  main.className = 'commerce-blog__main';

  const heading = document.createElement('p');
  heading.className = 'commerce-blog__heading';

  const list = document.createElement('div');
  list.className = 'commerce-blog-list';

  const paginationBottom = document.createElement('nav');
  paginationBottom.className = 'commerce-blog-pagination commerce-blog-pagination--bottom';
  paginationBottom.setAttribute('aria-label', 'Blog pagination');

  main.append(heading, list, paginationBottom);

  const sidebar = document.createElement('aside');
  sidebar.className = 'commerce-blog-sidebar';

  const recentNav = document.createElement('nav');
  recentNav.className = 'commerce-blog-sidebar__recent';
  recentNav.setAttribute('aria-label', 'Recent posts');
  sidebar.append(recentNav);

  layout.append(main, sidebar);
  block.append(pageTitle, layout);

  // Category comes from the URL path (/blog/<category>); search from ?q=.
  const categorySlug = currentCategorySlug();
  const state = {
    page: 1,
    categoryId: null, // resolved from categorySlug once categories load
    query: categorySlug ? '' : (params.get('q') || ''),
  };

  async function load() {
    list.setAttribute('aria-busy', 'true');
    list.innerHTML = loaderHTML();
    paginationBottom.innerHTML = '';

    if (state.query) heading.textContent = `Search results for “${state.query}”`;
    else heading.textContent = '';

    try {
      let data;
      if (state.query) {
        data = await searchBlogs(state.query, state.page, pageSize);
      } else if (state.categoryId) {
        data = await fetchBlogsByCategory(state.categoryId, state.page, pageSize);
      } else {
        data = await fetchBlogs(state.page, pageSize);
      }

      const items = data?.items || [];
      list.removeAttribute('aria-busy');

      if (!items.length) {
        list.innerHTML = '<p class="commerce-blog-empty">No blog posts found.</p>';
        return;
      }

      list.innerHTML = '';
      items.forEach((post) => list.append(renderCard(post)));

      const info = {
        page: data.page || state.page,
        totalPages: data.total_pages || 1,
        totalCount: data.total_count || items.length,
        pageSize,
      };
      const onNavigate = (target) => {
        state.page = target;
        load();
        main.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      renderPagination(paginationBottom, info, onNavigate);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('commerce-blog: failed to load blogs', err);
      list.removeAttribute('aria-busy');
      list.innerHTML = '<p class="commerce-blog-error">Sorry, we couldn’t load the blog right now.</p>';
    }
  }

  // Resolve a category landing URL (/blog/<category>) to its id so the main list
  // can be filtered. Categories are only fetched when the URL needs one.
  if (categorySlug) {
    try {
      const categories = await fetchCategories();
      const cat = categories.find((c) => c.identifier === categorySlug);
      if (cat) {
        state.categoryId = cat.id;
        document.title = `${cat.title} – Blog`;
        pageTitle.textContent = cat.title;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('commerce-blog: failed to load categories', err);
    }
  }

  // Populate the "Recent Posts" sidebar with the latest posts (independent of
  // the current category/search filter).
  recentNav.setAttribute('aria-busy', 'true');
  recentNav.innerHTML = loaderHTML('');
  fetchBlogs(1, RECENT_POSTS_COUNT)
    .then((recent) => renderRecentPosts(recentNav, recent?.items || []))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('commerce-blog: failed to load recent posts', err);
      renderRecentPosts(recentNav, []);
    })
    .finally(() => recentNav.removeAttribute('aria-busy'));

  await load();
}
