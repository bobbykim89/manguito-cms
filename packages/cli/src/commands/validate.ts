import type { Command } from 'commander'
import { findSchemaDeprecations, type ParseError } from '@bobbykim/manguito-cms-core'
import { resolveConfig } from '../utils/config.js'
import { loadEnvFile } from '../utils/env.js'
import { resolveSchemaConfig } from '../utils/schema-config.js'
import { checkRegistry } from '../utils/schema-checks.js'
import { parseProjectSchemas } from '../utils/registry.js'
import { loadProjectVersionModel } from '../utils/project-version-model.js'
import { printSuccess, printValidationErrors, printSchemaDeprecations } from '../utils/error.js'

export function registerValidate(program: Command): void {
  program
    .command('validate')
    .description('Parse and validate all schemas, config, roles, and routes')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      await runValidate(options, { cwd: process.cwd() })
    })
}

export async function runValidate(
  options: { env?: string },
  deps: { cwd: string }
): Promise<void> {
  const { cwd } = deps

  // 1. Load env
  loadEnvFile(options.env)

  // 2. Resolve config — exits on failure
  const config = await resolveConfig(cwd)

  // 3. Parse every schema file, roles.json and routes.json
  const parsed = parseProjectSchemas(cwd, config)
  const allErrors: ParseError[] = parsed.ok ? [] : [...parsed.errors]

  let liveVersions: string[] | null = null

  // 6. Cross-reference validation — only when all parsing succeeded
  const registry = parsed.ok ? parsed.value : null
  if (registry !== null) {
    printSchemaDeprecations(findSchemaDeprecations(registry))
    const crossRefErrors = checkRegistry(registry, config.api.media?.max_file_size)
    allErrors.push(...crossRefErrors)

    // Version checks run only against a registry that is otherwise sound.
    // Against a broken one every version error would be noise caused by the
    // first error, so the author would be fixing the wrong thing.
    if (crossRefErrors.length === 0) {
      const versions = loadProjectVersionModel(resolveSchemaConfig(cwd, config), registry)
      if (versions.ok) liveVersions = versions.value.model.live
      else allErrors.push(...versions.errors)
    }
  }

  // 7–8. Collect and print all errors
  if (allErrors.length > 0) {
    printValidationErrors(allErrors, 'Validation errors', 'manguito validate')
    process.exit(1)
  }

  // 9. Success
  // No errors means the parse succeeded, so the registry exists.
  const schemas = registry?.all_schemas ?? []
  const countOf = (type: string): number =>
    schemas.filter((x) => x.schema_type === type).length
  const contentCount = countOf('content-type')
  const paragraphCount = countOf('paragraph-type')
  const taxonomyCount = countOf('taxonomy-type')

  printSuccess('Config valid')
  printSuccess(
    `Schemas valid (${contentCount} content types, ${paragraphCount} paragraph types, ${taxonomyCount} taxonomy types)`
  )
  printSuccess('roles.json valid')
  printSuccess('routes.json valid')
  if (liveVersions !== null) printSuccess(`Versions valid (live: ${liveVersions.join(', ')})`)
  process.stdout.write('\nNo errors found.\n')
}
