import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ResolvedManguitoConfig } from '@bobbykim/manguito-cms-core'
import { printGuidedError } from './error.js'

export async function resolveConfig(cwd: string): Promise<ResolvedManguitoConfig> {
  const configPath = resolve(cwd, 'manguito.config.ts')

  if (!existsSync(configPath)) {
    printGuidedError(
      'Config file not found: manguito.config.ts',
      'Run this command from your project root, or create a manguito.config.ts file.'
    )
    process.exit(1)
  }

  let mod: { default?: unknown }
  try {
    mod = await import(pathToFileURL(configPath).href) as { default?: unknown }
  } catch (err) {
    printGuidedError(
      'Failed to load manguito.config.ts',
      err instanceof Error ? err.message : String(err)
    )
    process.exit(1)
  }

  if (!isValidConfig(mod.default)) {
    printGuidedError(
      'manguito.config.ts does not export a valid config.',
      'Make sure the file has a default export using defineConfig().'
    )
    process.exit(1)
  }

  return mod.default
}

function isValidConfig(value: unknown): value is ResolvedManguitoConfig {
  return (
    value !== null &&
    typeof value === 'object' &&
    'db' in value &&
    'storage' in value &&
    'server' in value &&
    'api' in value &&
    'admin' in value
  )
}
