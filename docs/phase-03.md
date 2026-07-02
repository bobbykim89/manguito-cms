# Phase 3 — DB Module

> Postgres adapter implementation, Drizzle codegen, migration runner, and system table seeding.

This phase takes the `SchemaRegistry` produced by the Phase 2 parser and turns it into a working Postgres database. It completes the stub adapter left in Phase 2 and builds the codegen pipeline that every subsequent phase depends on.

**Done when:** `createPostgresAdapter` connects to Postgres (both standard TCP and Neon HTTP), `generateSchemaFile` produces a valid Drizzle schema from any `SchemaRegistry`, migrations run correctly in both dev and production modes, and system tables are seeded idempotently with correct diff-and-delete behavior for roles and base paths. All unit and integration tests pass.

---

## Decisions Made

| Topic | Detail doc |
| ----- | ---------- |
| Postgres adapter, connection strategy, `getDb()` pattern | [phase-03-adapter.md](./decisions/phase-03/phase-03-adapter.md) |
| Drizzle codegen — field mapping, table ordering, junction tables | [phase-03-codegen.md](./decisions/phase-03/phase-03-codegen.md) |
| System table seeding — idempotent sync, diff-and-delete | [phase-03-seeder.md](./decisions/phase-03/phase-03-seeder.md) |
| Migration runner — dev vs production strategy | [phase-03-migrations.md](./decisions/phase-03/phase-03-migrations.md) |

---

## Package Structure

```
packages/db/src/
├── types.ts               ← all internal DB types — single typedef file
├── adapters/
│   └── postgres.ts        ← createPostgresAdapter implementation
├── codegen/
│   └── index.ts           ← generateSchemaFile — pure function, returns string
├── seeder/
│   └── index.ts           ← seedSystemTables — idempotent, diff-and-delete
├── migrations/
│   └── index.ts           ← migration runner — wraps drizzle-kit
└── index.ts               ← public exports only
```

## Key Architectural Rules

- `PostgresAdapter` and `DrizzlePostgresInstance` are internal to the `db` package — never exported from `index.ts`
- `generateSchemaFile` is a pure function — returns a string, never touches the filesystem
- The CLI decides where to write the generated file (`.manguito/` in dev, `dist/generated/` in production)
- All FK references in generated code always use the `() =>` callback form
- Seeder always runs on startup — idempotency makes "first run detection" unnecessary

---

## Dependencies

```json
{
  "dependencies": {
    "@bobbykim/manguito-cms-core": "workspace:*",
    "drizzle-orm": "latest",
    "drizzle-kit": "latest",
    "@neondatabase/serverless": "latest",
    "pg": "latest"
  },
  "devDependencies": {
    "@types/pg": "latest"
  }
}
```

`drizzle-kit` is a runtime dependency (not devDependency) — migration generation is called at runtime by the CLI.

---

## Developer Checklist

> **Audit (2026-07-02):** Verified every item against the implementation. Two
> divergences from the original plan (neither a runtime bug):
> 1. **Adapter migration methods are stubs.** The `DbAdapter` interface (core)
>    declares `runMigrations()` and `getMigrationStatus()`, but `PostgresAdapter`
>    implements them as throw-stubs ("wired by CLI in Phase 9"). Nothing calls
>    them — migrations run through the standalone `runDevMigration` /
>    `generateMigration` / `applyMigrations` / `getMigrationStatus` functions,
>    which are implemented and tested. The two interface methods are dead;
>    follow-up: either delegate to the standalone functions or drop them from
>    `DbAdapter`.
> 2. **`DrizzlePostgresInstance` is exported.** The plan said not to export it,
>    but the api layer imports the type (`relations.ts`, `repositories/*.ts`,
>    routes), so it is — and must be — part of the db package's public surface.
>    The plan item was superseded; only `PostgresAdapter` stays unexported.

### Setup
- [x] Add dependencies to `packages/db/package.json`
- [x] Create Docker Compose file at repo root for test Postgres instance
- [x] Add `.env.test` with `DB_URL` pointing to test container

### types.ts
- [x] `PostgresAdapter` type — `DbAdapter & { getDb(): DrizzlePostgresInstance }`
- [x] `DrizzlePostgresInstance` union type — `NodePgDatabase | NeonHttpDatabase`
- [x] `SeederOptions` type — `{ dryRun?: boolean }`
- [x] `SeedResult` type — counts per system table
- [x] `MigrationRunnerOptions` type

### Adapter — see [phase-03-adapter.md](./decisions/phase-03/phase-03-adapter.md)
- [x] `connect()` — standard TCP path via `pg` Pool
- [x] `connect()` — Neon HTTP path via `@neondatabase/serverless`
- [x] `connect()` — serverless auto-detection from URL (`neon.tech`)
- [x] `disconnect()` — clears Drizzle instance and connected flag
- [x] `isConnected()` — returns connected flag
- [x] `getDb()` — throws if called before `connect()`
- [x] `tableExists()` — queries `information_schema.tables`
- [x] `getTableNames()` — queries `information_schema.tables`
- [ ] `runMigrations()` — **stub only**: throws "wired by CLI in Phase 9" (see audit note). Migrations run via the standalone functions below, not this method.
- [ ] `getMigrationStatus()` — **stub only**: throws (see audit note). The real one is the standalone `getMigrationStatus()` under Migrations.

### Codegen — see [phase-03-codegen.md](./decisions/phase-03/phase-03-codegen.md)
- [x] `generateSchemaFile()` — pure function, returns complete schema.ts string
- [x] File header — `import * as s from 'drizzle-orm/pg-core'` and `import { sql } from 'drizzle-orm'`
- [x] System tables — hardcoded (`media`, `base_paths`, `roles`, `users`)
- [x] `generateSystemFieldColumn()` — all 5 system field `db_type` values
- [x] `generateFieldColumn()` — all 7 `DbColumnType` values
- [x] Skip paragraph fields (no column on parent table)
- [x] Skip many-to-many reference fields (junction table handles it)
- [x] FK references always use `() =>` callback form
- [x] Enum fields produce table-level check constraints
- [x] `orderParagraphTypes()` — topological sort for nested paragraphs
- [x] `generateJunctionTables()` — including self-referencing content type case
- [x] Table output order: system → taxonomy → paragraphs → content → junction

### Seeder — see [phase-03-seeder.md](./decisions/phase-03/phase-03-seeder.md)
- [x] `seedSystemTables()` — orchestrates roles and base paths seeding
- [x] Roles: diff existing DB rows vs incoming `ParsedRoles`
- [x] Roles: check users assigned to removed roles — error with user emails listed
- [x] Roles: upsert incoming roles with `onConflictDoUpdate`
- [x] Roles: delete removed roles (only after dependency check passes)
- [x] Base paths: diff existing DB rows vs incoming `ParsedRoutes`
- [x] Base paths: check content items using removed base paths — error with details
- [x] Base paths: upsert incoming base paths with `onConflictDoUpdate`
- [x] Base paths: delete removed base paths (only after dependency check passes)
- [x] `dryRun` mode — all checks run, no writes executed
- [x] Returns `SeedResult` with inserted/updated/deleted counts per table

### Migrations — see [phase-03-migrations.md](./decisions/phase-03/phase-03-migrations.md)
- [x] `runDevMigration()` — wraps `drizzle-kit push` for dev mode
- [x] `generateMigration()` — wraps `drizzle-kit generate` for production
- [x] `applyMigrations()` — wraps `drizzle-kit migrate` for production
- [x] `getMigrationStatus()` — reads migration table, returns pending + applied lists
- [x] Auto-generated `drizzle.config.ts` written to `.manguito/` (dev) or `dist/` (production) by CLI

### Public exports — `index.ts`
- [x] Exports: `createPostgresAdapter`, `PostgresAdapterOptions`
- [x] Exports: `generateSchemaFile`
- [x] Exports: `seedSystemTables`, `SeedResult`, `SeederOptions`
- [x] Exports: `runDevMigration`, `generateMigration`, `applyMigrations`, `getMigrationStatus`
- [x] `PostgresAdapter` is not exported; `DrizzlePostgresInstance` **is** exported (the api layer depends on the type — see audit note)

### Tests
- [x] Unit: `codegen` — all field types produce correct Drizzle column strings
- [x] Unit: `codegen` — junction tables including self-referencing content type
- [x] Unit: `codegen` — paragraph topological ordering
- [x] Unit: `codegen` — enum check constraints
- [x] Unit: `codegen` — system tables hardcoded output
- [x] Integration: adapter `connect` / `disconnect` / `tableExists` / `getTableNames`
- [x] Integration: seeder full sync cycle — insert, update, delete
- [x] Integration: seeder error — role in use
- [x] Integration: seeder error — base path in use
- [x] Integration: seeder `dryRun` — no writes, correct result counts
- [x] Integration: migrations — `applyMigrations` and `getMigrationStatus`

---

## Claude Code Checklist

> Read the linked decision docs before implementing each section.

- [x] Read [phase-03-adapter.md](./decisions/phase-03/phase-03-adapter.md) before touching `adapters/postgres.ts`
- [x] Read [phase-03-codegen.md](./decisions/phase-03/phase-03-codegen.md) before touching `codegen/index.ts`
- [x] Read [phase-03-seeder.md](./decisions/phase-03/phase-03-seeder.md) before touching `seeder/index.ts`
- [x] Read [phase-03-migrations.md](./decisions/phase-03/phase-03-migrations.md) before touching `migrations/index.ts`
- [x] Do not export `PostgresAdapter` from `packages/db/src/index.ts` (`DrizzlePostgresInstance` **is** exported — the api layer depends on the type)
- [x] Do not add filesystem access to `generateSchemaFile` — it returns a string only
- [x] Do not import from `db`, `api`, `admin`, or `cli` inside `core`
- [x] All FK references in generated code use `() =>` callback — no exceptions
- [x] Seeder must never silently ignore deleted roles or base paths — always diff
