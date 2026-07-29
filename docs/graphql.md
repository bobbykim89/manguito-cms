# GraphQL API

An **opt-in, query-only GraphQL surface** over your published content, generated
from your schemas. It sits alongside the REST API — enabling it changes nothing
about your existing routes.

Use it when a client wants to pick exactly the fields it needs, or to fetch a
page's worth of related content in one round-trip instead of several REST calls.

> Writes stay on the authenticated admin REST API. There are no mutations.

---

## Enabling it

Add a `graphql` block to `createAPIAdapter()` in `manguito.config.ts`:

```ts
api: createAPIAdapter({
  prefix: '/api',
  graphql: { enabled: true },
}),
```

That mounts **`POST /graphql`**. Note the path is absolute — it is a sibling of
your `prefix`, not nested under it, so it stays `/graphql` even if `prefix` is
`/content`.

With nothing configured, no endpoint is mounted and the GraphQL dependencies are
never loaded.

### Options

```ts
graphql: {
  enabled: true,
  maxDepth: 8,          // max query nesting depth
  maxComplexity: 1000,  // max query cost
  graphiql: true,       // in-browser explorer
  introspection: true,  // schema introspection
}
```

- `enabled` — mount the endpoint. Defaults to `false`.
- `maxDepth` — how deeply a query may nest. Defaults to `8`.
- `maxComplexity` — total query cost ceiling. Defaults to `1000`.
- `graphiql` — serve the explorer on `GET /graphql`. Defaults to **on in
  development, off in production** (`NODE_ENV !== 'production'`).
- `introspection` — allow schema introspection. Same default as `graphiql`.

## The explorer

With `graphiql` on, open **`http://localhost:3000/graphql`** in a browser for an
interactive explorer with autocomplete and docs built from your schema. Queries
from your own clients `POST` to the same URL.

Both the explorer and introspection are **off in production by default** — turn
them on deliberately, or not at all.

---

## What gets generated

For a content type whose machine name is `content--blog_post`, you get a type
`BlogPost` and two queries:

```graphql
query {
  blogPosts(page: 1, perPage: 10) {   # collection
    data { id slug title }
    meta { total totalPages hasNext }
  }

  blogPost(slug: "hello-world") {     # single item
    id
    title
  }
}
```

- **Content types** get `<type>s(...)` and `<type>(slug: String!)`.
- **`only_one` content types** get just the singular query, with no arguments.
- **Taxonomy types** get `<type>s(page, perPage)` and `<type>(id: ID!)`.

Only **published** content is ever returned, on every query and at every level of
nesting.

### Naming

Machine names are snake_case; GraphQL is not. The mapping is mechanical:

| Schema | GraphQL |
|---|---|
| `content--blog_post` | type `BlogPost` |
| field `blog_title` | field `blogTitle` |
| field `created_at` | field `createdAt` |

**Enum values are never renamed** — they appear exactly as stored, so a value
matches between the REST and GraphQL responses. If every value of an enum is a
valid GraphQL identifier it becomes a real GraphQL enum; if any value is not
(e.g. `in-progress`, `high priority`), the field is exposed as `String` instead
and a warning is logged at startup.

### Fields on every type

`id`, `published`, `createdAt`, `updatedAt`, plus `slug` on content types.
Internal columns (`base_path_id`, paragraph parent pointers) are not exposed.

Field types map as you'd expect: text → `String`, integer → `Int`, float →
`Float`, boolean → `Boolean`, date → `DateTime`, image/video/file → `Media`,
programmatic → `JSON`.

---

## Pagination, sorting, filtering

Collection queries mirror the REST contract, so both surfaces behave the same.

```graphql
query {
  blogPosts(
    page: 2
    perPage: 20
    sortBy: createdAt
    sortOrder: DESC
    filter: { published: { eq: true }, createdAt: { gt: "2026-01-01" } }
  ) {
    data { title }
    meta { total page perPage totalPages hasNext hasPrev }
  }
}
```

- `page` starts at 1; `perPage` is 1–100 (defaults 1 and 10).
- `sortBy` accepts `title`, `createdAt`, `updatedAt`. `sortOrder` is `ASC` or
  `DESC`.
- `filter` supports `eq` and `in` on most fields, plus `gt` / `gte` / `lt` /
  `lte` on numbers and dates.

Programmatic, paragraph, and media fields are not filterable — they have no
column to filter on.

Invalid arguments come back as GraphQL errors carrying the same codes the REST
API uses (`INVALID_PAGINATION`, `INVALID_SORT_FIELD`, `INVALID_FILTER_FIELD`) in
`extensions.code`.

---

## Relations

Relation fields resolve as nested objects, to any depth allowed by `maxDepth` —
this is the main reason to reach for GraphQL:

```graphql
query {
  blogPosts {
    data {
      title
      author { name }          # reference
      categories { name }      # many-to-many
      hero { url alt width }   # media
      body { ... }             # paragraphs
    }
  }
}
```

Relations are **batched per request**, so fetching 20 posts and each post's
author issues one query for all the authors, not twenty. You do not need a REST
`?include=`-style parameter — asking for the field is enough.

Unpublished relation targets are filtered out: a draft reference resolves to
`null`, and drafts are omitted from multi-value relations.

## Programmatic fields

[Programmatic fields](./programmatic-fields.md) resolve only when a query
actually selects them, and once per item — so an expensive resolver costs
nothing on queries that don't ask for it. They are typed as `JSON`.

---

## Protecting the endpoint

`/graphql` is public and unauthenticated, like the rest of `/api/*`. Because one
GraphQL request can be far more expensive than one REST call, limits ship on by
default:

- **Depth and cost limits** (`maxDepth`, `maxComplexity`), plus caps on aliases,
  directives, and token count. Queries exceeding them are rejected.
- **Rate limiting** — the endpoint reuses the `rateLimit` settings from your API
  adapter config.
- **Introspection and GraphiQL off in production** unless you enable them.

Raise `maxDepth` / `maxComplexity` if legitimate queries are being rejected, but
treat them as a budget rather than removing them.

---

## Limitations

- **Queries only** — no mutations or subscriptions. Writes go through the
  authenticated admin REST API.
- **Offset pagination**, not Relay cursor connections.
- **Public surface only** — the admin API has no GraphQL endpoint.
- **Type names must be unique across kinds.** Because the `content--` /
  `taxonomy--` / `paragraph--` prefix is stripped, a content type and a taxonomy
  type that share a segment (both `author`) would produce two `Author` types. The
  server reports this at startup rather than serving a broken schema; rename one
  machine name to resolve it.
- Media referenced by unpublished content is still reachable by direct storage
  URL, the same as with REST.

---

## See also

- [docs/configuration.md](./configuration.md) — full configuration reference
- [docs/programmatic-fields.md](./programmatic-fields.md) — computed fields
- [docs/schema-authoring.md](./schema-authoring.md) — defining content types
- [docs/v2/graphql-module.md](./v2/graphql-module.md) — design and decision record
