# Decision — CLI Dev Server and Auto-Migration

> Deferred to Phase 9 (CLI). Captured here from Phase 2 discussions for future reference.

---

## Dev Server Startup Sequence

`manguito dev` follows this sequence on startup:

```
1. Read and resolve manguito.config.ts
2. Validate config (schema dirs exist, routes.json present, DB URL set)
3. Check DB connection
   → if unreachable: clear error "DB_URL not set or database unreachable"
4. Check if schema tables exist in DB
   → if not: run drizzle-kit push to create all tables from scratch
   → seed system tables (base_paths from routes.json, roles from roles.json)
   → if no admin user exists: prompt for first admin credentials
5. Parse all schema files → produce SchemaRegistry
6. Write registry to .manguito/ folder
7. Generate .manguito/routes.ts, .manguito/forms/, .manguito/nav.ts
8. Start Hono server importing from .manguito/
9. Mount Vite dev server as Hono middleware for /admin/* routes
10. Start file watcher on schemas/ directory
```

---

## .manguito Folder

Generated at dev startup, gitignored. Mirrors what Nuxt does with `.nuxt/`:

```
.manguito/
├── schema-registry.ts    — ParsedSchema registry
├── drizzle.config.ts     — auto-generated Drizzle Kit config
├── routes.ts             — Hono route registrations
├── repositories.ts       — repository instances
├── forms/                — form definitions per content type
│   └── content--blog_post.ts
└── nav.ts                — admin panel navigation derived from schemas
```

**Gitignore entry:**
```
.manguito/
dist/
```

---

## Auto-Migration in Dev Mode

When the schema file watcher detects a change:

```
Schema file changes
        ↓
Re-parse only the changed schema file
        ↓
Validate cross-references for that schema
        ↓
Regenerate .manguito/ files for affected schema
        ↓
Run drizzle-kit push → DB updated automatically
        ↓
Hono hot-swaps affected routes
        ↓
Vite HMR updates admin panel
Total time: ~1-2 seconds
```

**`drizzle-kit push` vs `drizzle-kit migrate`:**

| Command | Use case | Creates migration files | Destructive |
| ------- | -------- | ----------------------- | ----------- |
| `drizzle-kit push` | Dev only — fast iteration | No | Yes (drops removed columns) |
| `drizzle-kit migrate` | Production — controlled | Yes | Only if migration says so |

`drizzle-kit push` is intentionally destructive in dev — dropping a column from the schema drops it from the DB immediately. This is acceptable in dev (clean slate is usually desired) but never acceptable in production (data loss).

---

## Production Migration Workflow

```
1. Edit schema file
2. manguito build
   → generates migration files in ./migrations/
   → developer reviews migration files for destructive changes
3. manguito migrate
   → applies pending migrations to production DB
4. Deploy new build
```

Migration files are committed to version control — they document every DB change over time and can be reviewed before applying.

---

## Environment Scripts

```json
{
  "scripts": {
    "dev": "dotenv -e .env.dev -- manguito dev",
    "dev:prod": "NODE_ENV=production dotenv -e .env -- manguito dev",
    "build": "NODE_ENV=production dotenv -e .env -- manguito build",
    "start": "NODE_ENV=production dotenv -e .env -- manguito start",
    "migrate": "dotenv -e .env -- manguito migrate",
    "validate": "manguito validate"
  }
}
```

`dev:prod` starts the dev server with production config for local testing of the production environment (S3 storage, prod DB, etc.).

---

## First Run — Admin Account Creation

On first `manguito dev` run (no admin in DB):

```
manguito dev

Manguito CMS — Dev Server

✓ Config loaded
✓ Database connected
✓ Schema tables created
✓ System tables seeded

No admin account found.
? Admin email: admin@example.com
? Admin password: ••••••••••••

✓ Admin account created
✓ Schema parsed (3 content types, 2 paragraph types, 1 taxonomy type)
✓ Dev server running at http://localhost:3000
✓ Admin panel at http://localhost:3000/admin
```

Credentials are not stored in `.env` — only used to create the initial DB row. Subsequent admin management is through the admin panel or `manguito users:*` CLI commands.

---

## Incremental Hot Reload

Schema changes trigger minimal regeneration — only the affected schema:

```ts
// file watcher handler
async function onSchemaFileChange(filePath: string) {
  const schemaName = extractSchemaName(filePath)

  // re-parse only the changed file
  const result = parseSchemaFile(filePath)
  if (!result.ok) {
    logParseErrors(result.errors)
    return  // don't update anything if parse fails
  }

  // update registry entry
  registry.schemas[schemaName] = result.schema

  // regenerate only affected .manguito/ files
  await regenerateRoutes(schemaName)
  await regenerateForm(schemaName)
  await regenerateNav()

  // push schema change to DB
  await runDrizzlePush()

  // hot-swap Hono routes for this schema
  routeManager.hotReload(schemaName, result.schema)

  log(`✓ Schema updated: ${schemaName}`)
}
```

19 unchanged schemas remain cached. Only the changed schema is re-parsed and its routes hot-swapped.

---

## CLI Command Summary (Phase 9 scope)

```bash
manguito init [name]       # scaffold new project interactively
manguito dev               # start dev server with file watching and auto-migration
manguito build             # codegen + compile → dist/
manguito start             # run dist/ (production)
manguito migrate           # run pending DB migrations manually
manguito migrate:status    # show migration state
manguito validate          # parse and validate all schemas, report errors
manguito users:promote --email=<email>              # promote user to admin (CLI only)
manguito users:demote --email=<email> --role=<role> # demote admin to specified role (CLI only)
```
