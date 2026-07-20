# GraphQL Module — Implementation Design

**Date:** 2026-07-19
**Status:** Approved design (pre-implementation)
**Depends on:** the locked decisions in [graphql-module.md](./graphql-module.md)
and its sub-docs ([architecture](./graphql-architecture.md),
[schema-mapping](./graphql-schema-mapping.md), [security](./graphql-security.md),
[decisions](./graphql-decisions.md)).

> This document deepens the decision docs into an **implementation-ready design**:
> concrete naming, type mapping, query arguments, resolver wiring, config, and the
> test plan. It is the direct input to a future implementation plan. No code is
> changed by this document.

---

## 1. Naming and the name-mapping layer

GraphQL field names are **camelCase** and type names are **PascalCase**, while the
registry, repositories, and DB columns are **snake_case**. The schema builder
therefore holds, **per type**, a `graphqlName ↔ schemaName` map that is the single
source of truth for every translation. See
[graphql-decisions.md#d8](./graphql-decisions.md) for the rationale and rejected
alternatives.

### Type names

| Source | GraphQL type |
|--------|--------------|
| content type (machine-name segment `blog_post`) | `BlogPost` |
| paragraph type (`blog_paragraph`) | `BlogParagraph` |
| taxonomy type (`category`) | `Category` |
| media (fixed) | `Media` |
| per-list wrapper | `<Type>List` (e.g. `BlogPostList`) |
| per-type filter input | `<Type>Filter` |
| per-type sort enum | `<Type>SortField` |

The machine-name segment is the part after `--` (e.g. `content--blog_post` →
`blog_post`), converted to PascalCase.

### Query names

| Schema | Query field(s) |
|--------|----------------|
| content type, `only_one: false` | `blogPost(slug: String!): BlogPost` and `blogPosts(…): BlogPostList!` |
| content type, `only_one: true` | singular only — `siteSettings: SiteSettings` |
| taxonomy type | `category(id: ID!): Category` and `categories(…): CategoryList!` |

Collection queries are **auto-pluralized** by a small helper: `y → ies` (after a
consonant), `s/x/z/ch/sh → es`, otherwise `+s`. This covers the common cases
(`category → categories`). Rare irregular plurals (`person → people`) are a known
limitation; an **optional per-type plural override** can be added later if one is
wrong — not built now (YAGNI).

### Field names

snake_case → camelCase (`created_at → createdAt`, `reference_count →
referenceCount`). The mapping is applied in three directions:

1. **Output** — the field `createdAt` resolves by reading `item.created_at` from
   the repo result.
2. **Sort** — `sortBy: createdAt` passes `created_at` to `repo.findMany` (whose
   `sort_by` is typed `'title' | 'created_at' | 'updated_at'`).
3. **Filter** — `filter: { createdAt: { … } }` maps back to the `created_at`
   column for the filter translation.

### Enum values

Enums map to a real `GraphQLEnumType` **only when every value is a valid GraphQL
identifier** (`^[_A-Za-z][_0-9A-Za-z]*$`); otherwise the field falls back to
`String`. Enum **values are never translated** — the wire value always equals the
stored/REST value, so the two public surfaces never diverge on data. On fallback,
the builder emits a **dev-time warning** (e.g. `enum 'priority' has values that
aren't valid GraphQL identifiers; exposing as String`) so the degradation is
visible, not silent. Rationale and rejected alternatives in
[graphql-decisions.md#d9](./graphql-decisions.md).

---

## 2. Type mapping

Driven by the `FieldType` union in `packages/core/src/registry/types.ts`:

| Schema `field_type` | GraphQL output type |
|---------------------|---------------------|
| `text/plain`, `text/rich` | `String` |
| `integer` | `Int` |
| `float` | `Float` |
| `boolean` | `Boolean` |
| `date` | `DateTime` (custom scalar) |
| `enum` | `GraphQLEnumType` or `String` (§1) |
| `image`, `video`, `file` | `Media` — always resolved |
| `reference` | target type: `Ref!` or `[Ref!]` per `ui_component.rel` |
| `paragraph` | `[ParaType!]` — ordered; one paragraph type per field (`paragraph-embed.ref`) |
| `programmatic` | `JSON` scalar — the resolver returns `JsonValue`; lazy resolver (§4) |

Notes:

- **`text/rich` stays `String`** in v1. If rich text later needs a structured
  representation, it becomes a `JSON` scalar or a dedicated type — deferred.
- **Nullability** follows each field's `required` flag. Relation lists are
  non-null lists of non-null items (`[Ref!]`), empty when there are no relations.
- **System fields** are added to every content and taxonomy type:
  `id: ID!`, `slug: String!` (content only), `published: Boolean!`,
  `createdAt: DateTime!`, `updatedAt: DateTime!`.
- **Custom scalars** (`scalars.ts`): `DateTime` (serializes to ISO-8601 string)
  and `JSON` (opaque structured values).
- **`Media` type** derives from `MediaItem`:
  `{ id: ID!, type: String!, url: String!, mimeType: String!, alt: String,
  fileSize: Int!, width: Int, height: Int, duration: Int }`.

---

## 3. Query arguments, filter input, and pagination

The list-query surface mirrors `FindManyOptions` / `PaginatedResult` from core 1:1.

### Arguments

```graphql
blogPosts(
  page: Int,                 # ≥ 1, default 1
  perPage: Int,              # 1–100, default 10
  sortBy: BlogPostSortField, # enum, default createdAt
  sortOrder: SortOrder,      # ASC | DESC, default ASC
  filter: BlogPostFilter,
): BlogPostList!
```

- **`SortOrder`** is a shared enum `{ ASC, DESC }`.
- **`<Type>SortField`** is a generated enum restricted to the sortable set:
  `title`, `createdAt`, `updatedAt` (from `SORTABLE_FIELDS` in the REST layer).

### Filter input (full REST operator set, v1)

A generated per-type input mirrors REST's operators
([query-params.ts](../../packages/api/src/routes/query-params.ts)):

- **Equality** — scalar match (`filter[field]=x`).
- **`in`** — a list, the multi-value equality / OR case (REST's repeated
  `filter[field]=` producing an array).
- **`gt` / `gte` / `lt` / `lte`** — range operators on comparable fields
  (`FilterOperator` in core).

```graphql
input BlogPostFilter {
  title: StringFilter          # { eq, in }
  published: BooleanFilter     # { eq }
  createdAt: DateTimeFilter    # { eq, in, gt, gte, lt, lte }
  category: IDFilter           # { eq, in }
}
input DateTimeFilter { eq: DateTime, in: [DateTime!], gt: DateTime, gte: DateTime, lt: DateTime, lte: DateTime }
```

- The filterable set matches the REST rule: all real columns and system fields,
  **excluding programmatic fields** (no DB column — filtering one is a SQL error).
- Filter field names are camelCase and translate back to snake_case columns via
  the §1 map before hitting the repository.

### Pagination result

```graphql
type BlogPostList { data: [BlogPost!]!, meta: PageMeta! }
type PageMeta {
  total: Int!
  page: Int!
  perPage: Int!
  totalPages: Int!
  hasNext: Boolean!
  hasPrev: Boolean!
}
```

`PageMeta` is the camelCased `PaginatedResult.meta`
(`total, page, per_page, total_pages, has_next, has_prev`).

### Argument validation

Bad arguments surface as GraphQL errors carrying the **REST error codes** in
`extensions.code`: `INVALID_PAGINATION`, `INVALID_SORT_FIELD`,
`INVALID_FILTER_FIELD` — keeping diagnostics consistent across surfaces. Bounds
(page ≥ 1, perPage 1–100) match REST exactly.

---

## 4. Resolvers, relations, and programmatic fields

All resolvers close over the **published-only `publicRepos`** built once in
`createCmsApp` (`app.ts:140`). The admin repos are never referenced.

| Query | Repository call |
|-------|-----------------|
| `blogPosts(…)` | `repo.findMany({ published_only: true, page, per_page, sort_by, sort_order, filters })` |
| `blogPost(slug)` | `repo.findBySlug(slug)` then published check |
| `siteSettings` (`only_one`) | `repo.findMany({ published_only: true, page: 1, per_page: 1 })` → first |
| `category(id)` | `repo.findOne(id)` then published check |
| `categories(…)` | `repo.findMany({ published_only: true, … })` |

### Relations

Relation fields resolve **lazily** through a **per-request DataLoader** (one per
`(type, relationField)`), whose batch function delegates to the existing
`resolveRelationField` in [relations.ts](../../packages/api/src/relations.ts) with
a request-shared cache. This reuses the exact relation SQL the REST `?include=`
path uses — no second copy of relation resolution — while giving **arbitrary
nesting depth** with `WHERE id IN (…)` batching at every level. Loaders and cache
are created fresh per request in the GraphQL context and discarded after the
response.

> **Correction to the decision docs:** the earlier claim that GraphQL "reuses the
> existing dataloader" was imprecise — the repository's batching is internal to a
> single `findMany`/`findBySlug` call (eager, one level via `include`), not a
> standalone request-scoped loader. The module therefore adds the npm `dataloader`
> package and a `dataloaders.ts` that wraps `resolveRelationField`. See
> [graphql-decisions.md#d10](./graphql-decisions.md).

Media relation fields are always resolved to the `Media` object. Arbitrary nesting
depth is why depth/complexity limiting is mandatory (§5).

### Programmatic fields

Programmatic fields become **field resolvers** calling the existing
`programmaticResolver`. The public resolver exposes `resolveItem(schema, row)`
(all programmatic fields of a row at once), so the GraphQL context carries a
per-request `WeakMap<parentRow, Promise<resolvedRow>>` memo: the first programmatic
field selected on a given parent triggers `resolveItem` once, and every other
programmatic field on that same parent reads the memoized result. A parent's
programmatic fields are therefore computed **only when at least one is selected**,
and **only once** per parent — better than REST, which runs them for every item
regardless of client need.

---

## 5. Config, production mode, and errors

### Config

Per [graphql-architecture.md](./graphql-architecture.md):

```ts
createAPIAdapter({
  graphql: {
    enabled: boolean,          // default false — opt-in mount
    maxDepth?: number,         // default 8
    maxComplexity?: number,    // default 1000
    graphiql?: boolean,        // default: dev-only (see below)
  },
})
```

The resolved options flow through `APIAdapterOptions` into `createCmsApp`, which
mounts `app.all('/graphql', …)` only when `enabled` is true.

> **Correction to the decision docs:** carrying this option through the config in a
> type-safe way requires **one additive, optional field** — `graphql?:
> ResolvedGraphQLConfig` — on core's `APIAdapter` interface (and the resolved-config
> types), exactly how `rateLimit?` already lives there. This is a minimal core edit
> (no parser, dependency, or runtime-behavior change), so the "core untouched"
> phrasing in D2/D7 is refined to "core touched only by one additive optional
> field." See [graphql-decisions.md#d7](./graphql-decisions.md).

### Production-mode detection

`graphiql` and introspection default to **on in development, off in production**,
derived from `process.env.NODE_ENV !== 'production'`. Because `NODE_ENV` can be
unreliable on some serverless platforms, the explicit `graphql.graphiql` boolean
is the **authoritative override** — operators who need a different posture set it
directly rather than depending on environment inference.

### Errors

- GraphQL failures surface in the native top-level `errors` array.
- Module-produced validation failures carry the REST error code in
  `extensions.code` (§3).
- **Depth / complexity limit violations** return a clear message and **do not
  echo the offending query structure**.

---

## 6. File breakdown

All under `packages/api/src/graphql/`:

| File | Responsibility |
|------|----------------|
| `naming.ts` | `graphqlName ↔ schemaName` map, type/query name derivation, pluralization, GraphQL-name validity |
| `scalars.ts` | `DateTime` and `JSON` custom scalars |
| `type-mapping.ts` | `field_type` → GraphQL output type; enum validity check + fallback |
| `filters.ts` | per-type filter input + sort enum construction; translate camelCase→column |
| `context.ts` | `GraphQLContext` type (db, registry, repos, resolver, loaders, programmatic memo) |
| `dataloaders.ts` | per-request relation loaders wrapping `resolveRelationField` |
| `schema.ts` | assembles `GraphQLSchema` from the registry using the modules above |
| `resolvers.ts` | root query, relation (dataloader), and programmatic field resolver factories |
| `security.ts` | depth / complexity / alias limits (GraphQL Armor) + introspection rule |
| `handler.ts` | Yoga instance + `createGraphQLHandler(registry, publicRepos, resolver, db, options)` |
| `index.ts` | subpath public API surface (`./graphql`) |

**New dependencies** (all in `api` only): `graphql`, `graphql-yoga`,
`@escape.tech/graphql-armor`, `dataloader`.

Plus: a new `tsup` entry for `./graphql`, the `package.json` export, the opt-in
mount in `app.ts`, and the config wiring (core `APIAdapter.graphql?`, api
`createAPIAdapter`, CLI dev + build codegen). Slightly above the original ~7–9
file / ~600–1000 LOC estimate in
[graphql-module.md](./graphql-module.md#4-estimated-module-size) once `context.ts`
and `dataloaders.ts` are counted (≈11 source files).

---

## 7. Test plan

Per [ADR 0003](../adr/0003-real-postgres-integration-tests.md) (real-Postgres
integration) and [ADR 0004](../adr/0004-coverage-by-intention.md) (coverage by
intention).

### Unit (pure, no DB)

Build the schema from a **fixture registry** and assert:

- Type names, query names, and pluralization.
- Field name camelCasing and the round-trip mapping.
- Type mapping per `field_type`, including nullability and relation list shapes.
- Enum mapping: valid values → `GraphQLEnumType`; invalid values → `String` +
  warning.
- Filter input and sort enum shape; programmatic fields excluded from filters.

### Integration (real Postgres)

Execute queries end-to-end against a seeded database:

- List / single / `only_one` / taxonomy queries.
- Filtering (each operator), sorting, pagination bounds, and `PageMeta` values.
- Nested relation traversal with a query count assertion — **no N+1** (dataloader
  batches).
- Programmatic field resolution, and confirmation it runs only when selected.
- **Published-only guarantee:** a draft item is unreachable via a top-level query
  **and** via nested relation traversal from a published parent.

### Security

- A query exceeding `maxDepth` is rejected; a query exceeding `maxComplexity` is
  rejected — with non-leaky error messages.
- Introspection and GraphiQL are disabled when production mode is inferred, and
  the explicit `graphiql` override wins in both directions.
