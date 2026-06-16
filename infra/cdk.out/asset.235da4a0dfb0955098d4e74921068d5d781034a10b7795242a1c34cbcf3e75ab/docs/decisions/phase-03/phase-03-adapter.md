# Decision — Postgres Adapter

> Defines the `createPostgresAdapter` implementation, connection strategy, internal `getDb()` pattern, and how repositories access the Drizzle instance without violating layer boundaries.

---

## The Layer Boundary Problem

`core` defines `DbAdapter` with no knowledge of Drizzle. Route handlers in `api` (Phase 5) need a Drizzle instance to run queries via the repository pattern. But `api` cannot import Drizzle directly from `db` without coupling to it — that would violate the layer boundary.

The solution: the Postgres adapter holds the Drizzle instance privately in its closure. An extended type `PostgresAdapter` adds a `getDb()` method that is only visible inside the `db` package. External callers only ever hold a `DbAdapter` reference and never see `getDb()`.

```
External caller (CLI, API)
    holds: DbAdapter              ← no getDb(), no Drizzle knowledge

db package internals (seeder, repositories)
    holds: PostgresAdapter        ← has getDb(), Drizzle-aware
```

---

## PostgresAdapter Type

Defined in `packages/db/src/types.ts`. Never exported from `packages/db/src/index.ts`.

```ts
import type { DbAdapter } from '@bobbykim/manguito-cms-core'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'

// Union of both Drizzle instance types the adapter may hold
export type DrizzlePostgresInstance =
  | NodePgDatabase<Record<string, never>>
  | NeonHttpDatabase<Record<string, never>>

// Internal to db package only — never re-exported
export type PostgresAdapter = DbAdapter & {
  getDb(): DrizzlePostgresInstance
}
```

This mirrors the NestJS pattern of `onModuleInit` + `get db()` — the same concept expressed as a factory function and closure rather than a class.

---

## Connection Strategy

Two paths depending on the database host:

| Path | Driver | When |
|------|--------|------|
| Standard TCP | `pg` Pool + `drizzle-orm/node-postgres` | All non-Neon Postgres |
| Neon HTTP | `@neondatabase/serverless` + `drizzle-orm/neon-http` | URL contains `neon.tech` or `serverless: true` |

**Auto-detection:** If the URL contains `neon.tech`, the adapter automatically uses the Neon HTTP driver. The developer can override with `serverless: true` (force Neon HTTP) or `serverless: false` (force TCP even on Neon URLs).

**Why Neon HTTP for serverless:** Standard Postgres TCP connections require a persistent socket. Lambda cold starts with TCP Postgres connections are slow and unreliable. The Neon HTTP driver uses HTTP/1.1 — stateless, fast, compatible with Lambda's execution model.

---

## Implementation

```ts
// packages/db/src/adapters/postgres.ts
import { drizzle as drizzleNode } from 'drizzle-orm/node-postgres'
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import type { PostgresAdapter, DrizzlePostgresInstance } from '../types'

export type PostgresAdapterOptions = {
  url?: string
  serverless?: boolean
  pool?: {
    max?: number
    idle_timeout?: number
    connect_timeout?: number
  }
}

export function createPostgresAdapter(
  options: PostgresAdapterOptions = {}
): PostgresAdapter {
  const url = options.url ?? process.env['DB_URL']

  if (!url) {
    throw new Error(
      'DB_URL_MISSING: No database URL provided. ' +
      'Set the DB_URL environment variable or pass a url option.'
    )
  }

  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error(
      'DB_URL_INVALID: Database URL must begin with postgres:// or postgresql://'
    )
  }

  const isNeon = options.serverless ?? url.includes('neon.tech')
  const poolConfig = {
    max: options.pool?.max ?? 10,
    idle_timeout: options.pool?.idle_timeout ?? 30,
    connect_timeout: options.pool?.connect_timeout ?? 10,
  }

  // private state — never accessible outside this closure
  let db: DrizzlePostgresInstance | null = null
  let connected = false

  return {
    type: 'postgres',

    async connect(): Promise<void> {
      if (isNeon) {
        const sqlClient = neon(url)
        db = drizzleNeon(sqlClient)
      } else {
        const pool = new Pool({
          connectionString: url,
          max: poolConfig.max,
          idleTimeoutMillis: poolConfig.idle_timeout * 1000,
          connectionTimeoutMillis: poolConfig.connect_timeout * 1000,
        })
        // validate the connection is actually reachable before marking connected
        const client = await pool.connect()
        client.release()
        db = drizzleNode(pool)
      }
      connected = true
    },

    async disconnect(): Promise<void> {
      db = null
      connected = false
    },

    isConnected(): boolean {
      return connected
    },

    getDb(): DrizzlePostgresInstance {
      if (!db) {
        throw new Error(
          'DB not connected — call connect() before accessing the database.'
        )
      }
      return db
    },

    async runMigrations() {
      // delegates to migration runner — implemented in migrations/index.ts
      // wired up by CLI which passes the resolved MigrationsConfig
      throw new Error('runMigrations: wired by CLI in Phase 9')
    },

    async getMigrationStatus() {
      throw new Error('getMigrationStatus: wired by CLI in Phase 9')
    },

    async getTableNames(): Promise<string[]> {
      if (!db) throw new Error('DB not connected')
      const result = await db.execute(
        sql`SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name`
      )
      return result.rows.map((r: any) => r.table_name as string)
    },

    async tableExists(name: string): Promise<boolean> {
      if (!db) throw new Error('DB not connected')
      const result = await db.execute(
        sql`SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ${name}
            LIMIT 1`
      )
      return result.rows.length > 0
    },
  }
}
```

---

## Why `information_schema` for `tableExists` / `getTableNames`

These two methods query `information_schema.tables` rather than using Drizzle's schema. This is intentional:

- They are called **before** any migrations have run — the Drizzle schema doesn't exist yet
- `information_schema` is standard Postgres and requires no setup
- These are introspection methods, not data methods — raw SQL is appropriate here

---

## Public vs Internal Exports

```ts
// packages/db/src/index.ts — public surface
export { createPostgresAdapter } from './adapters/postgres'
export type { PostgresAdapterOptions } from './adapters/postgres'

// NOT exported — internal to db package only
// PostgresAdapter
// DrizzlePostgresInstance
```

Callers outside `db` call `createPostgresAdapter()` and receive a `DbAdapter`. They cannot call `getDb()`. Only `db`-internal modules (seeder, repositories) import `PostgresAdapter` from `types.ts` directly.
