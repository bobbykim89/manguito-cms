# @bobbykim/manguito-cms-cli

## 0.3.0

### Minor Changes

- bec08d5: Add programmatic fields: schema fields whose value is computed at read time by a TypeScript resolver, with no database column.

  Declare a field with `"type": "programmatic"` and bind a resolver in `src/programmatic/` via `programmaticField({ schema, field }, (ctx) => ...)`. Resolvers read same-record data through `ctx.get()` / `ctx.record` and run when an item is read through the public API. Options include opt-in per-field TTL caching (`cache.ttl`), list-endpoint opt-in (`on_list`), a static `fallback`, and a per-resolver `timeout`; a failing or timed-out resolver degrades to its fallback at HTTP 200 rather than failing the response. Bindings are validated at startup, and the field renders as a read-only placeholder in the admin. Supported on content and taxonomy types. See `docs/programmatic-fields.md`.

### Patch Changes

- Updated dependencies [bec08d5]
  - @bobbykim/manguito-cms-core@0.2.0
  - @bobbykim/manguito-cms-api@0.2.0
  - @bobbykim/manguito-cms-admin@0.3.0
  - @bobbykim/manguito-cms-db@0.1.2

## 0.2.2

### Patch Changes

- ad4708c: Fix `manguito dev` returning 403 for the admin panel's `@fontsource` font files ("outside of Vite serving allow list") in installed projects. The admin (Vite root) resolves deep inside `node_modules/.pnpm`, so Vite's default file-serving allow list didn't cover sibling dependencies like the fonts. `dev` now sets `server.fs.allow` to the project root and the detected workspace root, so the fonts (and other project deps) are served. Serving behavior is otherwise unchanged.

## 0.2.1

### Patch Changes

- 92b4d59: Fix the admin panel failing (404 in `manguito dev`, unbuildable in `manguito build`) in installed projects. `dev`/`build` build the admin by running Vite against the admin package, but it previously shipped only `dist/`. The admin package now publishes its Vite source (`index.html`, `src/`, `public/`, `vite.config.ts`) and promotes its build toolchain (`vite`, `@vitejs/plugin-vue`, `@tailwindcss/vite`, `tailwindcss`) to dependencies, and the CLI is aligned to Vite 8 to match the admin. `dev`/`build`/`start` behavior is unchanged.
- Updated dependencies [92b4d59]
  - @bobbykim/manguito-cms-admin@0.2.0

## 0.2.0

### Minor Changes

- 32d267a: Remove the `manguito init` command. Project scaffolding now lives in the dedicated `@bobbykim/create-manguito` package — run `npm create @bobbykim/manguito my-app`. This is a breaking change to the CLI (the `init` command no longer exists).

## 0.1.2

### Patch Changes

- e8d0790: Fix `manguito init` scaffolding a broken project (shipped in 0.1.1). The tsup build copied templates with `cp -r src/templates dist/templates`, which nests into `dist/templates/templates` when the target already exists (e.g. a turbo-cached `dist`). The published bundle then scaffolded a stray `templates/` folder plus duplicate `.env.example`/`.gitignore` at the project root. The copy is now an idempotent remove-then-copy via Node's `fs`, so `dist/templates` is always a flat, correct mirror of the source templates.

## 0.1.1

### Patch Changes

- 47e5bd6: Fix `npx @bobbykim/manguito-cms-cli` failing with "Cannot find module 'typescript'". The CLI uses `tsup`/`vite` at runtime to build user projects, but `typescript` (required by `tsup`) was only a devDependency, so it was missing from installs. `typescript` is now a runtime dependency, and the duplicated `tsup` devDependency was removed.

  Fix `manguito init` generating an invalid `manguito.config.ts`. The chosen storage adapter was interpolated as a bare word (`storage: local,` — an undefined identifier) instead of a factory call. The scaffolder now emits the correct `createLocalAdapter()` / `createS3Adapter()` / `createCloudinaryAdapter()` call, imports only the chosen adapter, and writes the matching storage variables into `.env.example`.

  Scaffolded projects now include `@types/node` and set `types: ["node"]` in `tsconfig.json`, so `manguito.config.ts` (which reads `process.env`) typechecks cleanly out of the box.

  Also add `homepage`, `repository`, `license` (MIT), and `author` metadata to all packages.

- Updated dependencies [47e5bd6]
  - @bobbykim/manguito-cms-core@0.1.1
  - @bobbykim/manguito-cms-db@0.1.1
  - @bobbykim/manguito-cms-api@0.1.1
  - @bobbykim/manguito-cms-admin@0.1.1

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
  - @bobbykim/manguito-cms-api@0.1.0
  - @bobbykim/manguito-cms-admin@0.1.0
