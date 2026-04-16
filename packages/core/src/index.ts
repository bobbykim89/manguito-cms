// @bobbykim/manguito-cms-core
// Schema parser and field type registry — no runtime dependencies beyond Zod.

export type {
  SchemaFolders,
  SchemaConfig,
  ResolvedSchemaConfig,
  MigrationsConfig,
  ResolvedMigrationsConfig,
  MigrationResult,
  MigrationStatus,
  DbAdapter,
  UploadOptions,
  UploadResult,
  PresignedOptions,
  PresignedResult,
  StorageAdapter,
  CorsConfig,
  ServerAdapter,
  ResolvedMediaConfig,
  APIAdapter,
  AdminAdapter,
  ManguitoConfig,
  ResolvedManguitoConfig,
} from './config/types.js'

export { defineConfig } from './config/defineConfig.js'
