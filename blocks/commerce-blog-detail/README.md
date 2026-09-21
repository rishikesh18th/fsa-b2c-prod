# Commerce Blog Detail Block

## Overview

The Commerce Blog Detail block renders a single blog post at
`/blog/post/<identifier>`. It is wired to a synthetic route in
[scripts/scripts.js](../../scripts/scripts.js) (`SYNTHETIC_ROUTES`), so it renders
even though there is no content document in the CMS for that path. The listing of
posts lives in the [commerce-blog](../commerce-blog/README.md) block.

Data helpers and GraphQL queries shared with the listing block live in
[../commerce-blog/blog-shared.js](../commerce-blog/blog-shared.js). Posts are
loaded from a custom blog GraphQL endpoint (see the listing block's README for
details), not the Adobe Commerce GraphQL endpoint.

## Layout

The page mirrors the listing's two-column frame (it reuses the listing's
`commerce-blog.css` for the layout, sidebar, recent-posts and loader styles):

1. **Breadcrumb bar** — a light strip above the hero: `Home › Blog › <category> ›
   <post title>`. The current post title is the last, non-linked crumb.
2. **Hero** — a full-width band (navy) with the post title, a category label, and
   the author/date byline. Full-bleed is achieved with `margin: 0 calc(50% - 50vw)`;
   horizontal overflow is contained by `main { overflow-x: clip }` in
   [styles/styles.css](../../styles/styles.css).
3. **Body** — two columns: the article (featured image + `content` HTML) on the
   left, and a "Recent Posts" sidebar (3 latest posts) on the right.
4. **Share** — Facebook / X / Pinterest links for the current URL.
5. **Previous / Next** — links to the adjacent posts in publish-time order. Each
   whole item (label + title) is a single link.

### URLs

- `/blog/post/<identifier>` — a single post. The `<identifier>` is the blog slug;
  category is intentionally not part of the URL.

## Integration

### GraphQL Queries (via `blog-shared.js`)

- `resolveBlogId(slug)` — resolves the URL slug to the post UUID.
- `fetchBlog(id)` — the full post, including the `content` HTML.
- `fetchBlogList()` — a lightweight ordered post list (newest first) used to
  derive both the "Recent Posts" widget and the Previous/Next neighbours from a
  single request.

## Behavior Patterns

- A loading spinner (`loaderHTML`) is shown while the post and list are fetched.
- `document.title` is set to the post title.
- `content` is Page Builder HTML authored in the CMS and is rendered as-is.

### Error Handling

- A failed request renders a friendly error message.
- An unresolved slug / missing post renders a "couldn’t find that post" message.

## Implementation Notes

- File names match the folder name (`commerce-blog-detail.js` /
  `commerce-blog-detail.css`) so the synthetic-route loader can import them by
  convention.
