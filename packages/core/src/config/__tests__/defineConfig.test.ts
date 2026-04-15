import { describe, it, expect } from 'vitest'
import { defineConfig } from '../defineConfig'
import type { ManguitoConfig } from '../types'

// ─── Minimal stub adapters ────────────────────────────────────────────────────

function makePostgresAdapter(): ManguitoConfig['db'] {
  return {
    type: 'postgres',
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => false,
    runMigrations: async () => ({ applied: [], skipped: [] }),
    getMigrationStatus: async () => ({ applied: [], pending: [] }),
    getTableNames: async () => [],
    tableExists: async () => false,
  }
}

function makeMongoAdapter(): ManguitoConfig['db'] {
  return { ...makePostgresAdapter(), type: 'mongodb' }
}

function makeStorageAdapter(): ManguitoConfig['storage'] {
  return {
    type: 'local',
    upload: async () => ({ key: '', url: '' }),
    delete: async () => {},
    getUrl: () => '',
    getPresignedUploadUrl: async () => ({ upload_url: '', key: '', expires_at: 0 }),
  }
}

function makeServerAdapter(): ManguitoConfig['server'] {
  return {
    type: 'node',
    getEntryPoint: () => '',
    cors: { origin: '*' },
  }
}

function makeApiAdapter(): ManguitoConfig['api'] {
  return {
    prefix: '/api',
    media: { max_file_size: 4 * 1024 * 1024 },
  }
}

function makeAdminAdapter(): ManguitoConfig['admin'] {
  return { prefix: '/admin' }
}

function minimalConfig(overrides: Partial<ManguitoConfig> = {}): ManguitoConfig {
  return {
    db: makePostgresAdapter(),
    storage: makeStorageAdapter(),
    server: makeServerAdapter(),
    api: makeApiAdapter(),
    admin: makeAdminAdapter(),
    ...overrides,
  }
}

// ─── Schema config defaults ───────────────────────────────────────────────────

describe('defineConfig — schema config', () => {
  it('applies all schema defaults when schema is omitted', () => {
    const resolved = defineConfig(minimalConfig())
    expect(resolved.schema.base_path).toBe('./schemas')
    expect(resolved.schema.folders.content_types).toBe('content-types')
    expect(resolved.schema.folders.paragraph_types).toBe('paragraph-types')
    expect(resolved.schema.folders.taxonomy_types).toBe('taxonomy-types')
    expect(resolved.schema.folders.enum_types).toBe('enum-types')
    expect(resolved.schema.folders.roles).toBe('roles')
  })

  it('overrides base_path when provided', () => {
    const resolved = defineConfig(minimalConfig({ schema: { base_path: './custom/schemas' } }))
    expect(resolved.schema.base_path).toBe('./custom/schemas')
    // other folders still get defaults
    expect(resolved.schema.folders.content_types).toBe('content-types')
  })

  it('overrides individual folder names while leaving others at defaults', () => {
    const resolved = defineConfig(minimalConfig({
      schema: {
        folders: {
          content_types: 'my-content',
          enum_types: 'my-enums',
        },
      },
    }))
    expect(resolved.schema.folders.content_types).toBe('my-content')
    expect(resolved.schema.folders.enum_types).toBe('my-enums')
    expect(resolved.schema.folders.paragraph_types).toBe('paragraph-types')
    expect(resolved.schema.folders.taxonomy_types).toBe('taxonomy-types')
    expect(resolved.schema.folders.roles).toBe('roles')
  })

  it('accepts an empty schema object — all defaults apply', () => {
    const resolved = defineConfig(minimalConfig({ schema: {} }))
    expect(resolved.schema.base_path).toBe('./schemas')
    expect(resolved.schema.folders.content_types).toBe('content-types')
  })
})

// ─── Migrations config defaults ───────────────────────────────────────────────

describe('defineConfig — migrations config', () => {
  it('applies migration defaults for postgres adapter', () => {
    const resolved = defineConfig(minimalConfig())
    expect(resolved.migrations).not.toBeNull()
    expect(resolved.migrations?.table).toBe('__manguito_migrations')
    expect(resolved.migrations?.folder).toBe('./migrations')
  })

  it('returns null migrations for mongodb adapter', () => {
    const resolved = defineConfig(minimalConfig({ db: makeMongoAdapter() }))
    expect(resolved.migrations).toBeNull()
  })

  it('overrides migration table name when provided', () => {
    const resolved = defineConfig(minimalConfig({ migrations: { table: '_my_migrations' } }))
    expect(resolved.migrations?.table).toBe('_my_migrations')
    expect(resolved.migrations?.folder).toBe('./migrations')
  })

  it('overrides migration folder when provided', () => {
    const resolved = defineConfig(minimalConfig({ migrations: { folder: './db/migrations' } }))
    expect(resolved.migrations?.folder).toBe('./db/migrations')
    expect(resolved.migrations?.table).toBe('__manguito_migrations')
  })

  it('omits migrations when not provided — postgres still gets defaults', () => {
    const config = minimalConfig()
    // migrations key is absent from minimalConfig — verify defaults still applied
    const resolved = defineConfig(config)
    expect(resolved.migrations?.table).toBe('__manguito_migrations')
  })
})

// ─── Adapter pass-through ─────────────────────────────────────────────────────

describe('defineConfig — adapter pass-through', () => {
  it('passes db adapter through unchanged', () => {
    const db = makePostgresAdapter()
    const resolved = defineConfig(minimalConfig({ db }))
    expect(resolved.db).toBe(db)
  })

  it('passes storage adapter through unchanged', () => {
    const storage = makeStorageAdapter()
    const resolved = defineConfig(minimalConfig({ storage }))
    expect(resolved.storage).toBe(storage)
  })

  it('passes server adapter through unchanged', () => {
    const server = makeServerAdapter()
    const resolved = defineConfig(minimalConfig({ server }))
    expect(resolved.server).toBe(server)
  })

  it('passes api adapter through unchanged', () => {
    const api = makeApiAdapter()
    const resolved = defineConfig(minimalConfig({ api }))
    expect(resolved.api).toBe(api)
  })

  it('passes admin adapter through unchanged', () => {
    const admin = makeAdminAdapter()
    const resolved = defineConfig(minimalConfig({ admin }))
    expect(resolved.admin).toBe(admin)
  })
})

// ─── ResolvedManguitoConfig shape ─────────────────────────────────────────────

describe('defineConfig — resolved config shape', () => {
  it('has no optional keys — schema and migrations are always present', () => {
    const resolved = defineConfig(minimalConfig())
    // schema is always resolved (never undefined)
    expect(resolved.schema).toBeDefined()
    // migrations is null for non-relational or a full object — never undefined
    expect('migrations' in resolved).toBe(true)
  })
})
