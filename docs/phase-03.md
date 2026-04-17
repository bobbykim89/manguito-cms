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

### Setup
- [ ] Add dependencies to `packages/db/package.json`
- [ ] Create Docker Compose file at repo root for test Postgres instance
- [ ] Add `.env.test` with `DB_URL` pointing to test container

### types.ts
- [ ] `PostgresAdapter` type — `DbAdapter & { getDb(): DrizzlePostgresInstance }`
- [ ] `DrizzlePostgresInstance` union type — `NodePgDatabase | NeonHttpDatabase`
- [ ] `SeederOptions` type — `{ dryRun?: boolean }`
- [ ] `SeedResult` type — counts per system table
- [ ] `MigrationRunnerOptions` type

### Adapter — see [phase-03-adapter.md](./decisions/phase-03/phase-03-adapter.md)
- [ ] `connect()` — standard TCP path via `pg` Pool
- [ ] `connect()` — Neon HTTP path via `@neondatabase/serverless`
- [ ] `connect()` — serverless auto-detection from URL (`neon.tech`)
- [ ] `disconnect()` — clears Drizzle instance and connected flag
- [ ] `isConnected()` — returns connected flag
- [ ] `getDb()` — throws if called before `connect()`
- [ ] `tableExists()` — queries `information_schema.tables`
- [ ] `getTableNames()` — queries `information_schema.tables`
- [ ] `runMigrations()` — delegates to migration runner
- [ ] `getMigrationStatus()` — delegates to migration runner

### Codegen — see [phase-03-codegen.md](./decisions/phase-03/phase-03-codegen.md)
- [ ] `generateSchemaFile()` — pure function, returns complete schema.ts string
- [ ] File header — `import * as s from 'drizzle-orm/pg-core'` and `import { sql } from 'drizzle-orm'`
- [ ] System tables — hardcoded (`media`, `base_paths`, `roles`, `users`)
- [ ] `generateSystemFieldColumn()` — all 5 system field `db_type` values
- [ ] `generateFieldColumn()` — all 7 `DbColumnType` values
- [ ] Skip paragraph fields (no column on parent table)
- [ ] Skip many-to-many reference fields (junction table handles it)
- [ ] FK references always use `() =>` callback form
- [ ] Enum fields produce table-level check constraints
- [ ] `orderParagraphTypes()` — topological sort for nested paragraphs
- [ ] `generateJunctionTables()` — including self-referencing content type case
- [ ] Table output order: system → taxonomy → paragraphs → content → junction

### Seeder — see [phase-03-seeder.md](./decisions/phase-03/phase-03-seeder.md)
- [ ] `seedSystemTables()` — orchestrates roles and base paths seeding
- [ ] Roles: diff existing DB rows vs incoming `ParsedRoles`
- [ ] Roles: check users assigned to removed roles — error with user emails listed
- [ ] Roles: upsert incoming roles with `onConflictDoUpdate`
- [ ] Roles: delete removed roles (only after dependency check passes)
- [ ] Base paths: diff existing DB rows vs incoming `ParsedRoutes`
- [ ] Base paths: check content items using removed base paths — error with details
- [ ] Base paths: upsert incoming base paths with `onConflictDoUpdate`
- [ ] Base paths: delete removed base paths (only after dependency check passes)
- [ ] `dryRun` mode — all checks run, no writes executed
- [ ] Returns `SeedResult` with inserted/updated/deleted counts per table

### Migrations — see [phase-03-migrations.md](./decisions/phase-03/phase-03-migrations.md)
- [ ] `runDevMigration()` — wraps `drizzle-kit push` for dev mode
- [ ] `generateMigration()` — wraps `drizzle-kit generate` for production
- [ ] `applyMigrations()` — wraps `drizzle-kit migrate` for production
- [ ] `getMigrationStatus()` — reads migration table, returns pending + applied lists
- [ ] Auto-generated `drizzle.config.ts` written to `.manguito/` (dev) or `dist/` (production) by CLI

### Public exports — `index.ts`
- [ ] Exports: `createPostgresAdapter`, `PostgresAdapterOptions`
- [ ] Exports: `generateSchemaFile`
- [ ] Exports: `seedSystemTables`, `SeedResult`, `SeederOptions`
- [ ] Exports: `runDevMigration`, `generateMigration`, `applyMigrations`, `getMigrationStatus`
- [ ] `PostgresAdapter` and `DrizzlePostgresInstance` are NOT exported

### Tests
- [ ] Unit: `codegen` — all field types produce correct Drizzle column strings
- [ ] Unit: `codegen` — junction tables including self-referencing content type
- [ ] Unit: `codegen` — paragraph topological ordering
- [ ] Unit: `codegen` — enum check constraints
- [ ] Unit: `codegen` — system tables hardcoded output
- [ ] Integration: adapter `connect` / `disconnect` / `tableExists` / `getTableNames`
- [ ] Integration: seeder full sync cycle — insert, update, delete
- [ ] Integration: seeder error — role in use
- [ ] Integration: seeder error — base path in use
- [ ] Integration: seeder `dryRun` — no writes, correct result counts
- [ ] Integration: migrations — `applyMigrations` and `getMigrationStatus`

---

## Claude Code Checklist

> Read the linked decision docs before implementing each section.

- [ ] Read [phase-03-adapter.md](./decisions/phase-03/phase-03-adapter.md) before touching `adapters/postgres.ts`
- [ ] Read [phase-03-codegen.md](./decisions/phase-03/phase-03-codegen.md) before touching `codegen/index.ts`
- [ ] Read [phase-03-seeder.md](./decisions/phase-03/phase-03-seeder.md) before touching `seeder/index.ts`
- [ ] Read [phase-03-migrations.md](./decisions/phase-03/phase-03-migrations.md) before touching `migrations/index.ts`
- [ ] Do not export `PostgresAdapter` or `DrizzlePostgresInstance` from `packages/db/src/index.ts`
- [ ] Do not add filesystem access to `generateSchemaFile` — it returns a string only
- [ ] Do not import from `db`, `api`, `admin`, or `cli` inside `core`
- [ ] All FK references in generated code use `() =>` callback — no exceptions
- [ ] Seeder must never silently ignore deleted roles or base paths — always diff
