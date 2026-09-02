# @bobbykim/manguito-cms-api

## 0.4.2

### Patch Changes

- 7a0036e: Close a hole the declarative version model (`core`, previous release) left open: a field marked `removed: true` (a tombstone) is column-backed — its column is retained for older live versions — so every place that filtered on "does this field have a column" was treating it as an ordinary, currently-exposed field.

  **api:** `createFieldKeyMap` now excludes tombstones from the label/column map, and — because `remap` lets an unmapped key pass through unchanged — also actively drops a tombstone's name and column from both directions, so a retained column can no longer be read from a request body or served in a response under its raw column name. The collision check that guards against a label reusing another field's column still runs against the full, tombstone-inclusive map, so a live field colliding with a tombstoned column still fails fast at startup instead of silently losing its column. `GET /admin/api/schema` — the admin panel's only path to schema data — now omits tombstones from every content, taxonomy and paragraph type's `fields`.

  **admin:** `generateFormComponent` (build-time form codegen, run from the CLI directly off parsed schemas) no longer generates an input for a tombstone.

  **db:** no behavior change — `generateFieldColumn` already emitted a tombstone's column correctly (nullable, since an older live version still reads it). Added a regression test pinning that, so a future change can't silently start dropping it.

- Updated dependencies [7a0036e]
- Updated dependencies [7a0036e]
  - @bobbykim/manguito-cms-core@0.4.0
  - @bobbykim/manguito-cms-db@0.1.4

## 0.4.1

### Patch Changes

- 8815030: Read responses now project nested rows — paragraph children, resolved reference and junction targets — to field labels rather than storage column names, and `?sort_by=` validates a label then orders by its column. GraphQL's `sortBy` gets the same treatment: its sort enum's `title` value is a field label, not a column, so it is now mapped to the storage column before the query builds its `ORDER BY`. No behavior changes for any schema the parser currently produces, since labels and columns are identical there.

  One new startup check: paragraph types now get field key maps too, so a paragraph type whose field label collides with another of its own columns refuses to boot. Unreachable today, since that requires two same-named fields on one type, which the parser already rejects. Those maps also reach GraphQL, so a programmatic field on a paragraph type is handed a label-keyed record like one on a content type.

## 0.4.0

### Minor Changes

- 0c33ab7: Make the `api.prefix` config option actually route. It has been documented as functional (`docs/configuration.md`) but was inert: every public route registrator hardcoded its `/api/...` path string, so setting `prefix: '/content-api'` changed nothing and the routes stayed on `/api`.

  Public route paths are now built in one module (`packages/api/src/paths.ts`) instead of being written out at each registration site, and both places that default the prefix — `createCmsApp` and `createAPIAdapter` — normalize through the same `normalizePrefix`, which adds the leading slash, strips trailing ones, and falls back to `/api` for an empty value. This is also where a later schema-version segment gets inserted, which is why it moved.

  **This is a breaking change for any deployment that already sets a custom `api.prefix`.** Those routes are served from `/api/*` today, and after this upgrade they move to the configured prefix — so consumers still calling `/api/*` will get a 404. Before upgrading, either update those consumers to the configured prefix, or remove `api.prefix` from the config to stay on the default `/api`. Every public route moves together — content, taxonomy, media and `openapi.json`. Deployments that never set the option are unaffected, and two surfaces are not prefixed at all and do not move: the admin API (`/admin/api/*`) and the GraphQL endpoint (`POST /graphql`).

  Also groundwork, with no behavior change today: every top-level read and write path in the api package now converts between a field's public label and its Postgres storage column at two explicit boundaries rather than assuming the two are identical (they are, for every schema the parser currently produces). See ADR api/0011.

## 0.3.3

### Patch Changes

- ba64bc8: Stop the api test suite printing lines that look like failures on a passing run. The masked-resolver-failure test threw a fake `connect ECONNREFUSED …:5432`, which Yoga logs (correctly — masked faults should be logged), so a green run appeared to contain a dead test database. The schema-collision test likewise let `✗ GraphQL schema failed to initialize` through to stderr.

  The fake failure now uses an obviously synthetic message, and the collision diagnostic is captured and asserted instead of printed — so the suite still proves the operator gets told which two schemas collided, without the warning reading as a broken run. No production behaviour changes.

## 0.3.2

### Patch Changes

- 15e20be: Fix query-limit rejections being reported to clients as internal server errors. A query exceeding `maxDepth` or `maxComplexity` came back as `INTERNAL_SERVER_ERROR: Unexpected error.` with no hint that the query was too large, and was logged server-side at error level — so a public, unauthenticated endpoint let any caller write error-level noise into the logs.

  Yoga classifies an error as safe to show a client with `error instanceof GraphQLError`, and that check is realm-sensitive: GraphQL Armor is CommonJS and throws a `GraphQLError` built from graphql's CJS entry, while Yoga is ESM and compares against the class from graphql's ESM entry. Same version, two classes, so the check failed and a client-side validation error was treated as a server fault. The module now identifies client-safe errors by name — walking the `originalError` chain the same way, which is what envelop's own masking does — and delegates everything else to Yoga's masking untouched, dev-mode detail included. Limit rejections now read `Query depth limit of N exceeded, found M.`

  A resolver failure is still masked; the tests now assert the rejection's message and code rather than merely that some error came back, which is what allowed this to pass unnoticed.

## 0.3.1

### Patch Changes

- ffad479: Fix three write/read paths that failed after the GraphQL release.

  **Singleton content types could not be saved.** The admin form saves an `only_one` type with `PUT /admin/api/content/{type}` — it has no id in its route, so the `/:id` PATCH cannot address it — but no `PUT` route was ever registered, so every save 404'd. The route now exists as an upsert: it creates the row on first save and updates it thereafter, gated on `content:edit` plus `content:create` when it actually creates. POST, PATCH and PUT now share the same create/update code paths so the three verbs cannot drift apart.

  **Media fields errored in GraphQL.** GraphQL read through the public REST repositories, which resolve relations eagerly — and because a media field's foreign-key column has the same name as the field, that eager pass overwrote the media id with the resolved media object. The dataloader then handed that object to `WHERE id IN (...)`, producing a Postgres `invalid input syntax for type uuid` error and a `null` field. GraphQL now reads through repositories that do not resolve relations eagerly, leaving its own per-field dataloaders to resolve them — which also stops every query from paying to resolve relations the client never selected. Media now resolves at the top level and inside paragraphs.

  **Nested paragraphs were silently dropped.** A paragraph field on a paragraph type ([ADR core/0005](https://github.com/bobbykim89/manguito-cms/blob/master/docs/adr/core/0005-paragraph-nesting-one-level.md) allows exactly one level) has no column on its parent's table, so writes skipped it entirely and the admin edit read never descended into it — items added in the admin vanished on save. Nested rows are now persisted against their parent paragraph row, returned by the admin edit read, replaced on update, and removed when their parent paragraph or content item is deleted, with their media counted in reference tracking.

## 0.3.0

### Minor Changes

- cf9e77a: Add an opt-in GraphQL public API: a query-only surface generated from the schema registry and served at `POST /graphql`, alongside (not replacing) the REST API.

  Enable it in `manguito.config.ts`:

  ```ts
  api: createAPIAdapter({
    graphql: { enabled: true },
    // maxDepth: 8, maxComplexity: 1000, graphiql/introspection: dev-only
  });
  ```

  Each content type gets a collection query and a single-item query — `blogPosts(page, perPage, sortBy, sortOrder, filter)` returning `{ data, meta }`, and `blogPost(slug)`; `only_one` types expose a singular query, and taxonomy types get `categories(...)` / `category(id)`. Pagination, sorting, filtering and error codes mirror the REST contract, so the two surfaces stay consistent. GraphQL types are PascalCase and fields camelCase (`created_at` → `createdAt`), while enum _values_ are never translated — an enum becomes a real GraphQL enum when every value is a valid identifier, otherwise the field is exposed as `String`.

  Relations resolve as nested fields to arbitrary depth, batched per request through a DataLoader over the existing relation queries, so a nested selection does not produce N+1 queries. Programmatic fields resolve lazily and only when selected. Reads go through the same published-only repositories the public REST routes use, so drafts are never reachable.

  Because a public GraphQL endpoint can be abused in ways fixed REST routes cannot, query-cost limits ship on by default (depth, cost, alias, directive and token caps via GraphQL Armor), the endpoint reuses the existing list-endpoint rate limiter, and introspection plus the GraphiQL explorer default to development only. Enabling GraphiQL also relaxes the Content-Security-Policy for the `/graphql` path alone so the explorer can load; every other route keeps the strict policy.

  The module is isolated behind the `@bobbykim/manguito-cms-api/graphql` subpath export and loaded dynamically, so `graphql`/`graphql-yoga` are not pulled in unless the feature is enabled. `core` gains one additive optional field (`APIAdapter.graphql`) plus the `GraphQLModuleConfig` / `ResolvedGraphQLConfig` types; the CLI threads the option through `dev` and `build` and routes `/graphql` to the API in the dev server. Existing configs are unaffected — with no `graphql` option, nothing mounts and no dependency loads. The admin panel is unchanged and remains REST-only. See `docs/v2/graphql-module.md`.

### Patch Changes

- cf9e77a: Fix unpublished content being reachable through relations on the public API. A published item that referenced a draft exposed that draft's full record when the relation was expanded — via `?include=` on the public REST routes, and at any depth of a GraphQL nested selection. The published-only guarantee held for the items a request asked for directly, but not for the relation targets it reached through them.

  Relation resolution now takes an opt-in `publishedOnly` flag, and every public caller passes it: `reference` and `junction` target lookups add `AND published = true`, so a draft target resolves to `null` for a single reference and is omitted from a multi-value relation. The filtering happens in the shared resolver, so both public surfaces inherit it rather than each re-implementing the check.

  This is a behavior change for the public REST API: responses that previously embedded a draft through `?include=` now return `null` or omit it from the list. Admin API reads are unaffected and continue to resolve relations without the filter, so editors still see drafts in the admin panel.

- Updated dependencies [cf9e77a]
  - @bobbykim/manguito-cms-core@0.3.0
  - @bobbykim/manguito-cms-db@0.1.3

## 0.2.0

### Minor Changes

- bec08d5: Add programmatic fields: schema fields whose value is computed at read time by a TypeScript resolver, with no database column.

  Declare a field with `"type": "programmatic"` and bind a resolver in `src/programmatic/` via `programmaticField({ schema, field }, (ctx) => ...)`. Resolvers read same-record data through `ctx.get()` / `ctx.record` and run when an item is read through the public API. Options include opt-in per-field TTL caching (`cache.ttl`), list-endpoint opt-in (`on_list`), a static `fallback`, and a per-resolver `timeout`; a failing or timed-out resolver degrades to its fallback at HTTP 200 rather than failing the response. Bindings are validated at startup, and the field renders as a read-only placeholder in the admin. Supported on content and taxonomy types. See `docs/programmatic-fields.md`.

### Patch Changes

- Updated dependencies [bec08d5]
  - @bobbykim/manguito-cms-core@0.2.0
  - @bobbykim/manguito-cms-db@0.1.2

## 0.1.1

### Patch Changes

- 47e5bd6: Fix `npx @bobbykim/manguito-cms-cli` failing with "Cannot find module 'typescript'". The CLI uses `tsup`/`vite` at runtime to build user projects, but `typescript` (required by `tsup`) was only a devDependency, so it was missing from installs. `typescript` is now a runtime dependency, and the duplicated `tsup` devDependency was removed.

  Fix `manguito init` generating an invalid `manguito.config.ts`. The chosen storage adapter was interpolated as a bare word (`storage: local,` — an undefined identifier) instead of a factory call. The scaffolder now emits the correct `createLocalAdapter()` / `createS3Adapter()` / `createCloudinaryAdapter()` call, imports only the chosen adapter, and writes the matching storage variables into `.env.example`.

  Scaffolded projects now include `@types/node` and set `types: ["node"]` in `tsconfig.json`, so `manguito.config.ts` (which reads `process.env`) typechecks cleanly out of the box.

  Also add `homepage`, `repository`, `license` (MIT), and `author` metadata to all packages.

- Updated dependencies [47e5bd6]
  - @bobbykim/manguito-cms-core@0.1.1
  - @bobbykim/manguito-cms-db@0.1.1

## 0.1.0

### Minor Changes

- e79ac5e: Initial public release (0.1.0).

  Schema-driven headless CMS: define content types as JSON/YAML and the database
  tables, REST API, and admin panel are generated from them. Includes the schema
  parser and field-type registry (core), Drizzle/Postgres codegen and migrations
  (db), the Hono API with route generation, storage adapters, and JWT auth (api),
  the Vue 3 admin panel (admin), and the `manguito` CLI — `init`, `dev`, `build`,
  `start`, `validate`, `migrate`, `createsuperuser`, and user management (cli).
  Ships with user documentation (README, configuration and schema-authoring
  guides) and accurate project scaffolding templates.

### Patch Changes

- Updated dependencies [e79ac5e]
  - @bobbykim/manguito-cms-core@0.1.0
  - @bobbykim/manguito-cms-db@0.1.0
