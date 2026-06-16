import type { DbAdapter } from '@bobbykim/manguito-cms-core'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'

export type DrizzlePostgresInstance =
  | NodePgDatabase<Record<string, never>>
  | NeonHttpDatabase<Record<string, never>>

export type PostgresAdapter = DbAdapter & {
  getDb(): DrizzlePostgresInstance
}

export type SeederOptions = {
  dryRun?: boolean
}

export type SeedResult = {
  roles: { inserted: number; updated: number; deleted: number }
  base_paths: { inserted: number; updated: number; deleted: number }
}

export type MigrationRunnerOptions = {
  migrationsTable: string
  migrationsFolder: string
}
