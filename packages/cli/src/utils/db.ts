import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { ResolvedManguitoConfig } from '@bobbykim/manguito-cms-core'
import { printGuidedError } from './error.js'

export async function connectDb(
  _config: ResolvedManguitoConfig
): Promise<ReturnType<typeof createPostgresAdapter>> {
  const adapter = createPostgresAdapter()

  try {
    await adapter.connect()
  } catch {
    printGuidedError('DB_URL not set or database unreachable')
    process.exit(1)
  }

  return adapter
}
