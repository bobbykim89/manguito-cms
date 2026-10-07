import { resolve } from 'node:path'
import type { Command } from 'commander'
import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  validateCrossReferences,
  loadSchemaFile,
  type ParseError,
  type ParsedSchema,
} from '@bobbykim/manguito-cms-core'
import { resolveConfig } from '../utils/config.js'
import { loadEnvFile } from '../utils/env.js'
import { resolveSchemaConfig } from '../utils/schema-config.js'
import { loadProjectVersionModel } from '../utils/project-version-model.js'
import { printSuccess, printValidationErrors } from '../utils/error.js'

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

  const allErrors: ParseError[] = []
  const parsedSchemas: ParsedSchema[] = []

  // 3. Parse all schema files
  const walkResult = walkSchemaDirectory(config.schema)
  if (!walkResult.ok) {
    allErrors.push(...walkResult.errors)
  } else {
    for (const file of walkResult.value) {
      const parseResult = parseSchema(file.raw, file.schema_type, file.path)
      if (!parseResult.ok) {
        allErrors.push(...parseResult.errors)
      } else {
        parsedSchemas.push(parseResult.schema)
      }
    }
  }

  // 4. Parse roles.json
  const rolesPath = resolve(cwd, config.schema.base_path, 'roles.json')
  const rolesLoadResult = loadSchemaFile(rolesPath)
  let parsedRoles = null
  if (!rolesLoadResult.ok) {
    allErrors.push(...rolesLoadResult.errors)
  } else {
    const rolesParseResult = parseRoles(rolesLoadResult.value, rolesPath)
    if (!rolesParseResult.ok) {
      allErrors.push(...rolesParseResult.errors)
    } else {
      parsedRoles = rolesParseResult.value
    }
  }

  // 5. Parse routes.json
  const routesPath = resolve(cwd, config.schema.base_path, 'routes.json')
  const routesLoadResult = loadSchemaFile(routesPath)
  let parsedRoutesDef = null
  if (!routesLoadResult.ok) {
    allErrors.push(...routesLoadResult.errors)
  } else {
    const routesParseResult = parseRoutes(routesLoadResult.value, routesPath)
    if (!routesParseResult.ok) {
      allErrors.push(...routesParseResult.errors)
    } else {
      parsedRoutesDef = routesParseResult.value
    }
  }

  let liveVersions: string[] | null = null

  // 6. Cross-reference validation — only when all parsing succeeded
  if (allErrors.length === 0 && parsedRoles !== null && parsedRoutesDef !== null) {
    const registry = buildSchemaRegistry(parsedSchemas, parsedRoutesDef, parsedRoles)
    const crossRefErrors = validateCrossReferences(registry, config.api.media?.max_file_size)
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
  const contentCount = parsedSchemas.filter((s) => s.schema_type === 'content-type').length
  const paragraphCount = parsedSchemas.filter((s) => s.schema_type === 'paragraph-type').length
  const taxonomyCount = parsedSchemas.filter((s) => s.schema_type === 'taxonomy-type').length

  printSuccess('Config valid')
  printSuccess(
    `Schemas valid (${contentCount} content types, ${paragraphCount} paragraph types, ${taxonomyCount} taxonomy types)`
  )
  printSuccess('roles.json valid')
  printSuccess('routes.json valid')
  if (liveVersions !== null) printSuccess(`Versions valid (live: ${liveVersions.join(', ')})`)
  process.stdout.write('\nNo errors found.\n')
}
