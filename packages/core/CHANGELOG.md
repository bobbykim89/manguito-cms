# @bobbykim/manguito-cms-core

## 0.7.0

### Minor Changes

- ae39108: Add `relationCardinality`, the single rule for whether a relation field holds one item or a list, also published browser-safe as `@bobbykim/manguito-cms-core/cardinality`. Add `findSchemaDeprecations`; `one-to-many` on a reference is now deprecated (it holds one item, like `one-to-one`).

  **Breaking:** a required single reference's foreign key is now `ON DELETE RESTRICT` (it was `SET NULL`, which Postgres could never honour on a `NOT NULL` column). Run `manguito migrate` to apply it.

## 0.6.0

### Minor Changes

- 0241b2b: Serve every live schema version over GraphQL.

  Each live version gets its own schema at `/graphql/<version>`, built from that
  version's projection: field names come from the labels that version exposes,
  nullability from its own requiredness, and a field renamed or removed since
  carries `@deprecated` naming what replaced it. `/graphql` still floats to the
  current version — it is not a new route — but it is not byte-identical to
  its pre-versioning behavior either: the two bug fixes below (tombstoned
  fields, the sort enum) apply to it too. A project that has never cut a
  version still gets `/graphql/v1` alongside `/graphql` — both serve the same,
  single live version — the same way the REST surface already aliases an
  unversioned project onto `v1`. **Re-run `manguito build` after upgrading** so
  the baked version model carries the new `required` field.

  `VersionProjection` gains `required` so each version states its own
  nullability. Borrowing the current schema's flag would emit a non-null GraphQL
  type over rows holding nulls and null out the whole parent object.

  Also fixes two bugs on the GraphQL surface: tombstoned fields (`removed: true`)
  were built into the schema and served their retained data, and the sort enum
  offered `title` on types that have no field with that label — the field is
  now excluded from the sort enum instead, so an attempt to sort by it is
  rejected as an invalid sort field (masked by GraphQL's error handling as a
  200 with an `INTERNAL_SERVER_ERROR`), rather than reaching SQL at all.

  Two further fixes, both user-visible: a renamed media or reference field's
  resolved object was discarded from the record handed to a programmatic
  resolver on an older live version, so `ctx.get(...)` saw nothing where REST
  presents a resolved object; and the field-key map's collision check falsely
  rejected a field renamed back onto its own column's name while an intermediate
  version was still live, making `createCmsApp` throw at startup for every
  version at once.

## 0.5.0

### Minor Changes

- 4f79f93: Add the schema version lifecycle to the CLI: `version:diff` shows what cutting would freeze, `version:cut` freezes the working schema as a new version after confirmation, and `version:retire <version>` stops serving a cut version.

  Core gains two exports the commands need: `describeSchemaChange`, a pure classification of the difference between two schema versions keyed by column (so a rename reads as a rename, not as a delete plus an add), and `loadVersionSnapshots`, extracted from what `loadVersionModel` already did internally so a caller can reach a snapshot's registry.

  `version:retire` refuses to retire the highest-numbered snapshot: `current` is derived as highest + 1, so retiring it would renumber the working schema onto an already-published version number, and a consumer pinned to it would silently receive a different contract. Cutting first makes it retirable.

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
