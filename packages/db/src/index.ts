// @bobbykim/manguito-cms-db
// Drizzle ORM adapters, migrations, and schema codegen.

export { createPostgresAdapter } from './adapters/postgres'
export type { PostgresAdapterOptions } from './adapters/postgres'

export { generateSchemaFile } from './codegen/index'

export { seedSystemTables } from './seeder/index'
export type { SeedResult, SeederOptions } from './types'

export {
  runDevMigration,
  generateMigration,
  applyMigrations,
  getMigrationStatus,
} from './migrations/index'
