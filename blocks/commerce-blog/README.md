# Commerce Blog Block

## Overview

The Commerce Blog block renders the blog listing at `/blog` in a **two-column
layout**: the paginated post list on the left and a "Recent Posts" sidebar on the
right. It is wired to a synthetic route in
[scripts/scripts.js](../../scripts/scripts.js) (`SYNTHETIC_ROUTES` /
`buildSyntheticRoute`), so it renders even though there is no content document in
the CMS for that path. Individual posts open on the
[commerce-blog-detail](../commerce-blog-detail/README.md) page at
`/blog/post/<identifier>`.

Data helpers and GraphQL queries shared with the detail block live in
[blog-shared.js](blog-shared.js).

Posts are loaded from a **custom blog GraphQL endpoint** (an API Mesh / Adobe I/O
Runtime action), not the Adobe Commerce GraphQL endpoint. The URL is read from
`config.json` as `blog-endpoint`, falling back to a default in `blog-shared.js`:

```
https://edge-sandbox-graph.adobe.io/api/4a6fa16c-66f7-46da-81de-e0cbb0f4d293/graphql
```

Because this is a separate service, the block uses a plain `fetch` POST rather
than `CORE_FETCH_GRAPHQL` / `CS_FETCH_GRAPHQL` (which are bound to the commerce
endpoint).

## Layout

- **Page title** — a "Blog" heading above the two columns (shows the category
  title on a category landing page).
- **Left column** — the post-card grid plus a single pagination bar below it
  (left-aligned). Each card is: category label, title, author · date, excerpt,
  "Read more", then the featured image at the bottom, in a 2-per-row grid
  (single column on mobile).
- **Right column** — a "Recent Posts" list of the latest posts (thumbnail, title,
  date), each linking to its detail page.

### URLs

- `/blog` — the full listing.
- `/blog/<category>` — the listing filtered to a category (one path segment). The
  category is resolved by `identifier`; posts are listed via `blogsByCategory`.
- `?q=<text>` — search mode, filtering posts by title via the `blogs`
  `filter.title` argument.

Post links use `/blog/post/<identifier>`; category is intentionally not part of
the post URL.

## Integration

### Block Configuration

Read from the block markup via `readBlockConfig`:

- `page-size` — number of posts per page (default `12`)

The synthetic route supplies `page-size: 12`.

### GraphQL Queries

- `blogs(page, pageSize, sort, filter)` — the unfiltered, paginated post list.
- `blogsByCategory(categoryId, page, pageSize, sort)` — posts filtered to one
  category.
- `blogCategories(page, pageSize)` — resolves a category slug to its id (only
  fetched when the URL includes a category).
- `fetchBlogList()` — a lightweight ordered list used for the "Recent Posts"
  sidebar.

## Behavior Patterns

- On load, the block requests the first page of enabled posts sorted by
  `publish_time` DESC.
- A loading spinner (`loaderHTML`) is shown in the list and sidebar while data is
  being fetched; `aria-busy` is toggled during loads.
- Each post renders as a card with categories, title, author/date, an excerpt of
  `display_content`, and the featured image.

### Error Handling

- A non-2xx response or a GraphQL `errors` array throws and renders a friendly
  error message.
- An empty `items` array renders a "No blog posts found." message.

## Implementation Notes

- File names match the folder name (`commerce-blog.js` / `commerce-blog.css`) so
  the synthetic-route loader (`buildSyntheticRoute`) can import them by
  convention. The CSS is also loaded by the detail block for shared layout.
- `display_content` is HTML; the excerpt is derived by stripping tags client-side.
