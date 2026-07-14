# @bobbykim/manguito-cms-core

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
