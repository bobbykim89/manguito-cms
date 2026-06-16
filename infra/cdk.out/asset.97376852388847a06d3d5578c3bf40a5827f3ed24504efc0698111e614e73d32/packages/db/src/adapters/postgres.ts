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
