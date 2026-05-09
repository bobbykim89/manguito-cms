// @bobbykim/manguito-cms-db
// Drizzle ORM adapters, migrations, and schema codegen.

export { createPostgresAdapter } from './adapters/postgres'
export type { PostgresAdapterOptions } from './adapters/postgres'
export type { DrizzlePostgresInstance } from './types'

export { generateSchemaFile } from './codegen/index'

export { seedSystemTables } from './seeder/index'
export type { SeedResult, SeederOptions } from './types'

export {
  runDevMigration,
  generateMigration,
  applyMigrations,
  getMigrationStatus,
} from './migrations/index'

export { scanMigrationFiles } from './migrations/scanner'
export type { ScanResult, DestructiveOperation } from './migrations/scanner'
