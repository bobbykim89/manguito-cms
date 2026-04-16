import type {
  DbAdapter,
  MigrationResult,
  MigrationStatus,
} from '@bobbykim/manguito-cms-core'

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
): DbAdapter {
  const url = options.url ?? process.env['DB_URL']

  if (!url) {
    throw new Error(
      'DB_URL_MISSING: No database URL provided. Set the DB_URL environment variable or pass a url option.'
    )
  }

  if (!/^postgres(?:ql)?:\/\//i.test(url)) {
    throw new Error(
      'DB_URL_INVALID: Database URL must begin with postgres:// or postgresql://'
    )
  }

  const isNeon = url.includes('neon.tech')
  const _serverless = options.serverless ?? isNeon
  const _pool = {
    max: options.pool?.max ?? 10,
    idle_timeout: options.pool?.idle_timeout ?? 30,
    connect_timeout: options.pool?.connect_timeout ?? 10,
  }

  let connected = false

  return {
    type: 'postgres',

    async connect(): Promise<void> {
      // Full connection logic implemented in Phase 3 (DB codegen).
      // Validates connection at startup, not at config parse time.
      connected = true
    },

    async disconnect(): Promise<void> {
      connected = false
    },

    isConnected(): boolean {
      return connected
    },

    async runMigrations(): Promise<MigrationResult> {
      throw new Error('runMigrations: not yet implemented (Phase 3)')
    },

    async getMigrationStatus(): Promise<MigrationStatus> {
      throw new Error('getMigrationStatus: not yet implemented (Phase 3)')
    },

    async getTableNames(): Promise<string[]> {
      throw new Error('getTableNames: not yet implemented (Phase 3)')
    },

    async tableExists(_name: string): Promise<boolean> {
      throw new Error('tableExists: not yet implemented (Phase 3)')
    },
  }
}
