import { resolve } from 'node:path'
import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
  type ParseError,
  type ParsedSchema,
  type ParsedRoles,
  type ParsedRoutes,
  type SchemaRegistry,
  type Result,
  type ResolvedManguitoConfig,
} from '@bobbykim/manguito-cms-core'
import { printValidationErrors } from './error.js'
import { resolveSchemaConfig } from './schema-config.js'
import { checkRegistry } from './schema-checks.js'

/**
 * Parses every schema file, roles.json and routes.json into a SchemaRegistry,
 * collecting every error before it gives up. It never prints and never exits:
 * each command reacts to a failure its own way (heading, guided error, exit,
 * or returning the errors).
 *
 * The walk's root is made absolute with `resolveSchemaConfig`, so it does not
 * depend on the process cwd.
 */
export function parseProjectSchemas(
  cwd: string,
  config: ResolvedManguitoConfig
): Result<SchemaRegistry> {
  const schema = resolveSchemaConfig(cwd, config)
  const allErrors: ParseError[] = []
  const parsedSchemas: ParsedSchema[] = []

  const walkResult = walkSchemaDirectory(schema)
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

  const rolesPath = resolve(schema.base_path, 'roles.json')
  let parsedRoles: ParsedRoles | null = null
  const rolesLoad = loadSchemaFile(rolesPath)
  if (!rolesLoad.ok) {
    allErrors.push(...rolesLoad.errors)
  } else {
    const rolesParse = parseRoles(rolesLoad.value, rolesPath)
    if (!rolesParse.ok) allErrors.push(...rolesParse.errors)
    else parsedRoles = rolesParse.value
  }

  const routesPath = resolve(schema.base_path, 'routes.json')
  let parsedRoutes: ParsedRoutes | null = null
  const routesLoad = loadSchemaFile(routesPath)
  if (!routesLoad.ok) {
    allErrors.push(...routesLoad.errors)
  } else {
    const routesParse = parseRoutes(routesLoad.value, routesPath)
    if (!routesParse.ok) allErrors.push(...routesParse.errors)
    else parsedRoutes = routesParse.value
  }

  if (allErrors.length > 0 || parsedRoles === null || parsedRoutes === null) {
    return { ok: false, errors: allErrors }
  }
  return { ok: true, value: buildSchemaRegistry(parsedSchemas, parsedRoutes, parsedRoles) }
}

/**
 * Parses the project's schemas (see `parseProjectSchemas`) and cross-validates
 * the registry. Prints all errors and exits 1 on any failure. Only
 * `version:create` and the other version commands use it, because they freeze
 * this registry into a snapshot. build, start, migrate and dev parse through
 * `parseProjectSchemas` and react to failure their own way; `validate`
 * deliberately collects everything and keeps going.
 *
 * `command` appears in the error output so the hint names the command the
 * author actually ran.
 */
export function loadWorkingRegistry(
  cwd: string,
  config: ResolvedManguitoConfig,
  command: string
): SchemaRegistry {
  const parsed = parseProjectSchemas(cwd, config)
  if (!parsed.ok) {
    printValidationErrors(parsed.errors, 'Schema parse errors', command)
    process.exit(1)
  }

  const registry = parsed.value
  // The checks across schemas that `manguito validate` runs. version:create
  // freezes this registry into a snapshot, and a snapshot is never
  // cross-validated again, so an error must stop here.
  const crossRefErrors = checkRegistry(registry, config.api.media?.max_file_size)
  if (crossRefErrors.length > 0) {
    printValidationErrors(crossRefErrors, 'Schema reference errors', command)
    process.exit(1)
  }
  return registry
}
