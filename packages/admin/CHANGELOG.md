# @bobbykim/manguito-cms-admin

## 0.4.1

### Patch Changes

- 7a0036e: Close a hole the declarative version model (`core`, previous release) left open: a field marked `removed: true` (a tombstone) is column-backed — its column is retained for older live versions — so every place that filtered on "does this field have a column" was treating it as an ordinary, currently-exposed field.

  **api:** `createFieldKeyMap` now excludes tombstones from the label/column map, and — because `remap` lets an unmapped key pass through unchanged — also actively drops a tombstone's name and column from both directions, so a retained column can no longer be read from a request body or served in a response under its raw column name. The collision check that guards against a label reusing another field's column still runs against the full, tombstone-inclusive map, so a live field colliding with a tombstoned column still fails fast at startup instead of silently losing its column. `GET /admin/api/schema` — the admin panel's only path to schema data — now omits tombstones from every content, taxonomy and paragraph type's `fields`.

  **admin:** `generateFormComponent` (build-time form codegen, run from the CLI directly off parsed schemas) no longer generates an input for a tombstone.

  **db:** no behavior change — `generateFieldColumn` already emitted a tombstone's column correctly (nullable, since an older live version still reads it). Added a regression test pinning that, so a future change can't silently start dropping it.

- Updated dependencies [7a0036e]
  - @bobbykim/manguito-cms-core@0.4.0

## 0.4.0

### Minor Changes

- ffad479: Preview video and open non-image media from the media detail page. Videos now play inline in a real player instead of showing a `▶` placeholder, and PDFs and other files get an "Open in new tab" link so they can actually be viewed — previously a non-image was a dead icon with no way to reach the file.

  PDFs deliberately open in a new tab rather than embedding in an `<iframe>`: embedding storage-hosted files would require widening the admin's Content-Security-Policy with `frame-src` across every admin route, and a link requires no such exception. Inline video needs no CSP change, since `media-src` already permits the storage hosts.

### Patch Changes

- cc4950c: Fix a nested paragraph field rendering an empty block in the admin. A paragraph type may hold a paragraph field of its own (one level, per ADR core/0005); adding one of those inner items produced a block with its header and Remove button but no editable fields, so it could only ever be saved empty.

  The admin builds paragraph sub-forms at runtime with a render function, and that render pass forwarded only the common field props — never the `formComponent` a `ParagraphEmbed` needs. A top-level paragraph field got one from the form view, so only _nested_ paragraphs were affected. The field-to-component mapping and paragraph-form factory now live in their own module (`components/fields/field-registry.ts`) so this wiring is unit-testable, and the nesting case is covered.

## 0.3.1

### Patch Changes

- Updated dependencies [cf9e77a]
  - @bobbykim/manguito-cms-core@0.3.0

## 0.3.0

### Minor Changes

- bec08d5: Add programmatic fields: schema fields whose value is computed at read time by a TypeScript resolver, with no database column.

  Declare a field with `"type": "programmatic"` and bind a resolver in `src/programmatic/` via `programmaticField({ schema, field }, (ctx) => ...)`. Resolvers read same-record data through `ctx.get()` / `ctx.record` and run when an item is read through the public API. Options include opt-in per-field TTL caching (`cache.ttl`), list-endpoint opt-in (`on_list`), a static `fallback`, and a per-resolver `timeout`; a failing or timed-out resolver degrades to its fallback at HTTP 200 rather than failing the response. Bindings are validated at startup, and the field renders as a read-only placeholder in the admin. Supported on content and taxonomy types. See `docs/programmatic-fields.md`.

### Patch Changes

- Updated dependencies [bec08d5]
  - @bobbykim/manguito-cms-core@0.2.0

## 0.2.0

### Minor Changes

- 92b4d59: Fix the admin panel failing (404 in `manguito dev`, unbuildable in `manguito build`) in installed projects. `dev`/`build` build the admin by running Vite against the admin package, but it previously shipped only `dist/`. The admin package now publishes its Vite source (`index.html`, `src/`, `public/`, `vite.config.ts`) and promotes its build toolchain (`vite`, `@vitejs/plugin-vue`, `@tailwindcss/vite`, `tailwindcss`) to dependencies, and the CLI is aligned to Vite 8 to match the admin. `dev`/`build`/`start` behavior is unchanged.

## 0.1.1

### Patch Changes

- 47e5bd6: Fix `npx @bobbykim/manguito-cms-cli` failing with "Cannot find module 'typescript'". The CLI uses `tsup`/`vite` at runtime to build user projects, but `typescript` (required by `tsup`) was only a devDependency, so it was missing from installs. `typescript` is now a runtime dependency, and the duplicated `tsup` devDependency was removed.

  Fix `manguito init` generating an invalid `manguito.config.ts`. The chosen storage adapter was interpolated as a bare word (`storage: local,` — an undefined identifier) instead of a factory call. The scaffolder now emits the correct `createLocalAdapter()` / `createS3Adapter()` / `createCloudinaryAdapter()` call, imports only the chosen adapter, and writes the matching storage variables into `.env.example`.

  Scaffolded projects now include `@types/node` and set `types: ["node"]` in `tsconfig.json`, so `manguito.config.ts` (which reads `process.env`) typechecks cleanly out of the box.

  Also add `homepage`, `repository`, `license` (MIT), and `author` metadata to all packages.

- Updated dependencies [47e5bd6]
  - @bobbykim/manguito-cms-core@0.1.1

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
