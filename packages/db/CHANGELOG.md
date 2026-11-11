# @bobbykim/manguito-cms-db

## 0.3.1

### Patch Changes

- b24ace2: Foreign keys whose names pass 63 characters now get a hashed 63-character name, so the dev server's push stops re-planning them on every run (#88). An existing project's long foreign keys are renamed once, on its next dev push or in its next generated migration.

  Schemas that failed with a foreign-key `CONSTRAINT_NAME_COLLISION` because their foreign-key names differed only after character 63 (two long reference columns, or a long link table) now pass; `findConstraintNameCollisions` checks the hashed names.

  `ensureLinkConstraints` reads all link tables in one query (#89).

## 0.3.0

### Minor Changes

- 4319762: Every link table now gets a unique constraint on its (left, right) pair, so a list can no longer store the same link twice.

  - **Production:** run `manguito migrate`. It generates the constraint, together with a clean-up that removes only repeated links, keeping the lowest-order copy of each, which is the one a read already shows. `migrate` rebuilds on its own after this upgrade, with no schema edit needed.
  - **Development:** restart `manguito dev`. It removes the repeated links and adds the constraint directly, before its schema push.
  - **Known limitation:** renaming a many-to-many field or its owner type in `dev` may show push's truncate question once; its default answer, "No", is safe.
  - Schemas whose constraint names would collide in Postgres, which keeps only the first 63 characters of a name, are now refused before migration with `CONSTRAINT_NAME_COLLISION`, naming the rename that clears it, instead of failing in the migration. New exports: `findConstraintNameCollisions`, `linkUniqueName` and `ensureLinkConstraints`.
  - A type with many-to-many fields `x` and `x_unique` is now refused with `CONSTRAINT_NAME_COLLISION`: `x`'s new unique constraint would take `x_unique`'s link table name, so its migration would fail. The message names the rename.

### Patch Changes

- Updated dependencies [5dfe7e7]
  - @bobbykim/manguito-cms-core@0.11.1

## 0.2.1

### Patch Changes

- Updated dependencies [9793dd5]
  - @bobbykim/manguito-cms-core@0.11.0

## 0.2.0

### Minor Changes

- 392f23a: Adds `previewMigration(configPath, migrationsFolder)`, which returns the migration `generateMigration` would write (each file's name and SQL) without writing it. drizzle-kit generates into a temporary copy of the migrations folder, through a temporary config that imports the real one and changes only `out`, so the real folder is never written to, even if the preview fails or is interrupted. Adds `scanMigrationSql`, the destructive-operation scan over SQL already in hand; `scanMigrationFiles` now uses it.

## 0.1.10

### Patch Changes

- Updated dependencies [7f0bfc6]
  - @bobbykim/manguito-cms-core@0.10.0

## 0.1.9

### Patch Changes

- Updated dependencies [c8a3423]
  - @bobbykim/manguito-cms-core@0.9.0

## 0.1.8

### Patch Changes

- ccd816a: Schema codegen now creates the link table for a many-to-many field on a taxonomy type, not only on a content type. Before, such a field had no table, so its links were never stored. After upgrading, run `manguito migrate` to create the missing tables; the migration only adds tables.
- Updated dependencies [ccd816a]
  - @bobbykim/manguito-cms-core@0.8.0

## 0.1.7

### Patch Changes

- Updated dependencies [ae39108]
  - @bobbykim/manguito-cms-core@0.7.0

## 0.1.6

### Patch Changes

- Updated dependencies [0241b2b]
  - @bobbykim/manguito-cms-core@0.6.0

## 0.1.5

### Patch Changes

- Updated dependencies [4f79f93]
  - @bobbykim/manguito-cms-core@0.5.0

## 0.1.4

### Patch Changes

- 7a0036e: Close a hole the declarative version model (`core`, previous release) left open: a field marked `removed: true` (a tombstone) is column-backed — its column is retained for older live versions — so every place that filtered on "does this field have a column" was treating it as an ordinary, currently-exposed field.

  **api:** `createFieldKeyMap` now excludes tombstones from the label/column map, and — because `remap` lets an unmapped key pass through unchanged — also actively drops a tombstone's name and column from both directions, so a retained column can no longer be read from a request body or served in a response under its raw column name. The collision check that guards against a label reusing another field's column still runs against the full, tombstone-inclusive map, so a live field colliding with a tombstoned column still fails fast at startup instead of silently losing its column. `GET /admin/api/schema` — the admin panel's only path to schema data — now omits tombstones from every content, taxonomy and paragraph type's `fields`.

  **admin:** `generateFormComponent` (build-time form codegen, run from the CLI directly off parsed schemas) no longer generates an input for a tombstone.

  **db:** no behavior change — `generateFieldColumn` already emitted a tombstone's column correctly (nullable, since an older live version still reads it). Added a regression test pinning that, so a future change can't silently start dropping it.

- Updated dependencies [7a0036e]
  - @bobbykim/manguito-cms-core@0.4.0

## 0.1.3

### Patch Changes

- Updated dependencies [cf9e77a]
  - @bobbykim/manguito-cms-core@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [bec08d5]
  - @bobbykim/manguito-cms-core@0.2.0

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
