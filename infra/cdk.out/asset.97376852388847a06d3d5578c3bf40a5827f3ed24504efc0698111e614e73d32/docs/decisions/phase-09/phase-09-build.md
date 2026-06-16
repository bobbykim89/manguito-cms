# Decision — `manguito build` and Build/Migrate Relationship

> Defines the standalone build command, its step sequence, failure output, and the smart build-first contract with `manguito migrate`.

---

## Overview

`manguito build` is a standalone command that compiles the project into a production-ready `dist/`. It does not touch the database. It is called explicitly by the developer, and also called internally by `manguito migrate` when needed.

---

## `manguito build` — Step Sequence

```
1. Load env from --env file if provided
2. Read and resolve manguito.config.ts
   → if config invalid: printGuidedError, exit 1
3. Parse all schema files → SchemaRegistry
   → if parse errors: list ALL errors with file + location, exit 1 (do not stop at first)
4. Run DB codegen → dist/generated/schema.ts
5. Run API codegen → dist/generated/routes.ts
6. Run admin form codegen → dist/generated/forms/ (topological order)
7. Run Vite build with __ADMIN_PREFIX__ and __API_PREFIX__ injected
   → if Vite error: surface Vite output, exit 1
8. Run tsup compile (server.js + handler.js + vercel.js entry points)
   → if tsup error: surface tsup output, exit 1
9. Print success summary
```

Steps 4–6 are pure codegen (file writes, no external tools). Steps 7–8 invoke Vite and tsup as compilation processes.

---

## Success Output

```
✔ Config loaded
✔ Schemas parsed (3 content types, 2 paragraph types, 1 taxonomy type)
✔ Codegen complete
✔ Admin panel compiled
✔ Server compiled

Build complete → dist/
```

---

## Parse Error Output

All parse errors are collected and listed before exiting — the developer sees the full picture, not just the first failure.

```
✖ Schema parse errors:

  schemas/content-types/blog-post.json
    Line 12 — unknown field type "richtext" (did you mean "text/rich"?)

  schemas/content-types/article.json
    Line 8 — references unknown content type "author_profile"

2 errors found. Fix the above and run `manguito build` again.
```

---

## `dist/` Output Shape

```
dist/
├── generated/
│   ├── schema.ts          ← Drizzle table definitions
│   ├── routes.ts          ← Hono route registrations
│   └── forms/             ← Vue SFCs per content/paragraph/taxonomy type
│       ├── content--blog_post.vue
│       └── taxonomy--tag.vue
├── server.js              ← traditional server entry (Hono)
├── handler.js             ← AWS Lambda entry
└── vercel.js              ← Vercel entry
```

`dist/` and `dist/generated/` are gitignored — they are build artifacts, not source.

---

## Flags

```
manguito build                  # standard build
manguito build --env <file>     # load env file before config resolution
```

`--env` is accepted because `manguito.config.ts` may read from `process.env` (e.g. for storage credentials). See [phase-09-env-flag.md](./phase-09-env-flag.md).

---

## Build / Migrate Relationship

Build and migrate are independent commands with different concerns:

| Command | Concern | Touches DB |
|---------|---------|-----------|
| `manguito build` | Compile artifacts for deployment | No |
| `manguito migrate` | Sync DB schema to match code | Yes |

The dependency is one-directional: **migrate depends on build, not the other way around.** Build has no knowledge of migrate.

### Why migrate calls build internally

The dependency chain makes this a technical requirement, not a convenience:

```
schema JSON files
      ↓  manguito build
dist/generated/schema.ts    ← Drizzle schema
      ↓  drizzle-kit generate
migrations/*.sql
      ↓  drizzle-kit migrate
DB
```

There is no path from schema JSON to DB without going through build first. `dist/generated/schema.ts` must reflect the current schema files for migrations to be correct.

### Smart mtime check

`manguito migrate` uses mtime comparison to avoid unnecessary rebuilds:

```
Schema files newer than dist/generated/schema.ts?
  → YES: run build first, then continue
  → NO:  skip build, use existing artifacts

No dist/generated/schema.ts exists?
  → run build first, then continue
```

The mtime check compares the most recently modified file under `schemas/` against `dist/generated/schema.ts`. If any schema file is newer, a rebuild is triggered.

### When migrate triggers a build

Output when build runs as part of migrate:

```
✔ Schema files have changed — running build first...

  ✔ Config loaded
  ✔ Schemas parsed (3 content types, 2 paragraph types, 1 taxonomy type)
  ✔ Codegen complete
  ✔ Admin panel compiled
  ✔ Server compiled

✔ Build complete — continuing migration.
```

### When migrate skips build

```
✔ Build artifacts up to date — skipping build.
```

### When build fails during migrate

```
✖ Build failed — migration cannot continue.

  schemas/content-types/blog-post.json
    Line 12 — unknown field type "richtext" (did you mean "text/rich"?)

Fix the above and run `manguito migrate` again.
```

---

## `manguito migrate --status` does not trigger a build

`--status` is read-only — it reads migration state from the DB without generating or applying anything. No build check is performed.

---

## Typical Workflows

**Schema changed — migrate handles everything:**
```bash
manguito migrate    # detects change, builds first, then migrates
manguito start
```

**No schema change — build only (config change, UI tweak, etc.):**
```bash
manguito build
manguito start
```

**Explicit two-step deploy:**
```bash
manguito build
manguito migrate    # detects artifacts are current, skips build
manguito start
```
