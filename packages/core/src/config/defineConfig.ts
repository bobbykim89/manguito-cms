import type {
  DbAdapter,
  ManguitoConfig,
  MigrationsConfig,
  ResolvedManguitoConfig,
  ResolvedMigrationsConfig,
  ResolvedSchemaConfig,
  SchemaConfig,
} from './types'

export function defineConfig(config: ManguitoConfig): ResolvedManguitoConfig {
  return {
    schema: resolveSchemaConfig(config.schema),
    db: config.db,
    migrations: resolveMigrationsConfig(config.migrations, config.db),
    storage: config.storage,
    server: config.server,
    api: config.api,
    admin: config.admin,
  }
}

function resolveSchemaConfig(config?: SchemaConfig): ResolvedSchemaConfig {
  return {
    base_path: config?.base_path ?? './schemas',
    folders: {
      content_types: config?.folders?.content_types ?? 'content-types',
      paragraph_types: config?.folders?.paragraph_types ?? 'paragraph-types',
      taxonomy_types: config?.folders?.taxonomy_types ?? 'taxonomy-types',
      enum_types: config?.folders?.enum_types ?? 'enum-types',
      roles: config?.folders?.roles ?? 'roles',
    },
  }
}

function resolveMigrationsConfig(
  config?: MigrationsConfig,
  db?: DbAdapter
): ResolvedMigrationsConfig | null {
  if (db?.type === 'mongodb') return null
  return {
    table: config?.table ?? '__manguito_migrations',
    folder: config?.folder ?? './migrations',
  }
}
