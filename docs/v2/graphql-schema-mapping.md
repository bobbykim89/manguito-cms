# GraphQL Module — Schema Mapping

**Date:** 2026-07-18
**Status:** Approved design (pre-implementation)

Back to the [index](./graphql-module.md).

How the parsed schema registry becomes a GraphQL schema, and how queries resolve.

---

## 1. Code-first, registry-driven construction

The GraphQL schema is built **programmatically from the registry** using the
reference `graphql` package (`GraphQLObjectType`, `GraphQLSchema`, …) — not from a
hand-written SDL file and not with a compile-time schema builder like Pothos.

This mirrors how REST routes are already generated: `registerPublicContentRoutes`
iterates `registry.content_types` and `registry.taxonomy_types` and emits routes.
The GraphQL builder iterates the **same registry** and emits types and query
fields. The parser output remains the single source of truth, and there is no
second artifact (an SDL string) to keep in sync. It also avoids an extra
`@graphql-tools` dependency. See
[graphql-decisions.md](./graphql-decisions.md#d4).

---

## 2. Field-type → GraphQL-type mapping

Each field's `field_type` maps to a GraphQL output type:

| Field type | GraphQL type |
|------------|--------------|
| text / string / slug | `String` |
| number (integer) | `Int` |
| number (float) | `Float` |
| boolean | `Boolean` |
| date / datetime | `DateTime` (custom scalar) |
| enum | a generated `GraphQLEnumType` per enum type |
| reference (relation) | the referenced type, or `[Type!]` for multi |
| paragraph | the paragraph object type, or a list of them |
| image / video / file (media) | `Media` type — always resolved |
| programmatic | mapped from the field's declared return type; resolved lazily (see §6) |
| JSON / structured blobs | `JSON` (custom scalar) |

Nullability follows the schema's `required` flag. System fields (`id`,
`created_at`, `updated_at`, `published`, `slug`, …) are added to every type,
matching the fields the REST API already returns.

Two custom scalars are needed: **`DateTime`** (ISO-8601 string) and **`JSON`**
(for any opaque structured value). They live in `scalars.ts`.

---

## 3. Query surface (mirrors REST 1:1)

For each **content type** the builder emits:

- **Collection type:** `posts(page, perPage, sortBy, sortOrder, filter): PostList!`
  where `PostList` is `{ data: [Post!]!, meta: PageMeta! }`.
- **Single item:** `post(slug: String!): Post`.
- **`only_one` types** emit only a bare singular query: `siteSettings: SiteSettings`.

For each **taxonomy type** the builder emits the analogous
`categories(page, perPage): CategoryList!` and `category(id: ID!): Category`.

The argument set maps directly onto `ContentRepository.findMany`:

| GraphQL arg | REST equivalent | Notes |
|-------------|-----------------|-------|
| `page`, `perPage` | `?page=`, `?per_page=` | same bounds (page ≥ 1, perPage 1–100) |
| `sortBy` | `?sort_by=` | restricted to the sortable set (`title`, `created_at`, `updated_at`) |
| `sortOrder` | `?sort_order=` | `asc` \| `desc` enum |
| `filter` | `?filter[field][op]=` | a generated `PostFilter` input type per content type |

The `filter` input exposes the **same filterable fields** the REST route allows:
all real columns and system fields, **excluding programmatic fields** (they have
no DB column, so filtering one would be a SQL error — the REST route excludes them
at `content.ts:71`, and GraphQL applies the identical rule). Comparison operators
(`gt`, `gte`, `lt`, `lte`) map to nested input fields.

Invalid arguments (bad pagination, non-sortable field, unknown filter field)
surface as GraphQL errors carrying the **same error codes** the REST API uses
(`INVALID_PAGINATION`, `INVALID_SORT_FIELD`, `INVALID_FILTER_FIELD`), so the two
surfaces stay diagnostically consistent.

### Pagination style: offset/page, not Relay connections

The list queries use **offset/page** returning `{ data, meta }`, deliberately
mirroring REST rather than adopting Relay cursor connections. Rationale and the
rejected connection-style alternative are in
[graphql-decisions.md](./graphql-decisions.md#d5). In short: the repository is
offset-based today, so cursor connections would encode offsets as fake cursors —
extra surface area with no real keyset benefit — and one pagination mental model
across both surfaces is worth more than idiomatic Relay shape.

---

## 4. Relations as nested fields

Relation fields (`reference`, `paragraph`, media) are emitted as **nested object
fields** rather than ID scalars. Resolving them is what makes GraphQL valuable:
REST's one-level `?include=` becomes native, arbitrarily deep graph traversal.

Crucially, these nested fields resolve through the **existing request-scoped
dataloader** on `publicRepos`. A query that fetches 20 posts and each post's
author issues one batched `WHERE id IN (...)` for authors, not 20 queries — the
same N+1 protection the REST `?include=` path already gets. The dataloader cache
is discarded after each response, exactly as today.

Media fields are **always resolved** to the full `Media` object, matching current
REST behavior.

Arbitrary nesting depth is the reason depth/complexity limiting is mandatory —
see [graphql-security.md](./graphql-security.md).

---

## 5. Published-only, structurally

Every resolver reads through `publicRepos`, the published-only repositories.
There is no argument, filter, or nested path that can reach a draft — the same
structural guarantee REST's public surface provides
([ADR api/0002](../adr/api/0002-public-admin-split.md)). Expanded in
[graphql-security.md](./graphql-security.md).

---

## 6. Programmatic fields

Programmatic fields become **GraphQL field resolvers** that call the existing
`programmaticResolver` — a natural fit, since GraphQL resolves fields lazily and
per-item. A programmatic field is only computed when a query actually selects it,
which is strictly better than the REST path (where the resolver runs for every
returned item regardless of client need).

The field's GraphQL output type is derived from the programmatic field's declared
return type in the schema. Programmatic fields remain **excluded from `filter` and
`sortBy`** (no column to filter or sort on), consistent with REST.

---

## 7. Worked example

Schema: a `post` content type with `title`, `body`, a `reference` to `author`,
and a programmatic `reading_time`.

```graphql
query {
  posts(page: 1, perPage: 10, sortBy: created_at, sortOrder: desc,
        filter: { published: { eq: true } }) {
    data {
      title
      readingTime          # programmatic — resolved only because selected
      author {             # relation — batched via dataloader
        name
      }
    }
    meta { page perPage total }
  }
}
```

This single request replaces a REST sequence of `GET /api/posts?...` followed by
per-post author lookups — the "fewer round-trips" driver from the
[index](./graphql-module.md#1-is-it-worth-it).
