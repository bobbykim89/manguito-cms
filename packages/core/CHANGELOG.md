# @bobbykim/manguito-cms-core

## 0.4.0

### Minor Changes

- 7a0036e: Replace the rename-history version model with three optional, declarative keys on a field: `column` (its storage column, defaulting to `name`), `removed: true` (a tombstone — the column is retained for older live versions but the current version no longer exposes it), and `fallback` (the value served for rows created after a removal). A field's storage identity is now **stated**, not derived by folding a chain of renames, so retiring an old version no longer risks deleting the rename that resolves a column, and a chain/shift/swap can no longer be confused with one another.

  This removes `pending.json`, `history.json`, the fold, rename windows, `after` tags, and the `drops` mechanism, along with their types (`PendingChanges`, `VersionHistory`) and error codes (`AMBIGUOUS_RENAME`, `RENAME_CHAIN_BROKEN`, `VERSION_MODEL_INCONSISTENT`, `VERSION_RETENTION_UNSUPPORTED`). `ParseErrorCode` gains `DUPLICATE_COLUMN`, `TOMBSTONE_REQUIRED`, `FALLBACK_WITHOUT_TOMBSTONE`, `VERSION_COLUMN_MISSING` and `ORPHANED_TOMBSTONE` in their place — the completeness check they enforce (every column a live version's projection exposes must exist in the union) is structurally stronger than the heuristic it replaces, since it checks a presence rather than interpreting an absence.

  A tombstone is column-backed (its `db_column` is present, forced `nullable: true`) but excluded from the current version's exposure — every existing schema keeps working unchanged, since all three keys are optional and `column` defaults to `name`. See `docs/superpowers/specs/2026-09-02-declarative-version-model-design.md`.

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

## 0.2.0

### Minor Changes

- bec08d5: Add programmatic fields: schema fields whose value is computed at read time by a TypeScript resolver, with no database column.

  Declare a field with `"type": "programmatic"` and bind a resolver in `src/programmatic/` via `programmaticField({ schema, field }, (ctx) => ...)`. Resolvers read same-record data through `ctx.get()` / `ctx.record` and run when an item is read through the public API. Options include opt-in per-field TTL caching (`cache.ttl`), list-endpoint opt-in (`on_list`), a static `fallback`, and a per-resolver `timeout`; a failing or timed-out resolver degrades to its fallback at HTTP 200 rather than failing the response. Bindings are validated at startup, and the field renders as a read-only placeholder in the admin. Supported on content and taxonomy types. See `docs/programmatic-fields.md`.

## 0.1.1

### Patch Changes

- 47e5bd6: Fix `npx @bobbykim/manguito-cms-cli` failing with "Cannot find module 'typescript'". The CLI uses `tsup`/`vite` at runtime to build user projects, but `typescript` (required by `tsup`) was only a devDependency, so it was missing from installs. `typescript` is now a runtime dependency, and the duplicated `tsup` devDependency was removed.

  Fix `manguito init` generating an invalid `manguito.config.ts`. The chosen storage adapter was interpolated as a bare word (`storage: local,` — an undefined identifier) instead of a factory call. The scaffolder now emits the correct `createLocalAdapter()` / `createS3Adapter()` / `createCloudinaryAdapter()` call, imports only the chosen adapter, and writes the matching storage variables into `.env.example`.

  Scaffolded projects now include `@types/node` and set `types: ["node"]` in `tsconfig.json`, so `manguito.config.ts` (which reads `process.env`) typechecks cleanly out of the box.

  Also add `homepage`, `repository`, `license` (MIT), and `author` metadata to all packages.

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
