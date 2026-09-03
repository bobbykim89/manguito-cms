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
  type ResolvedManguitoConfig,
} from '@bobbykim/manguito-cms-core'
import { printValidationErrors } from './error.js'
import { resolveSchemaConfig } from './schema-config.js'

/**
 * Parses every schema file, roles.json and routes.json into a SchemaRegistry.
 * Prints all errors and exits 1 on any failure — the exit-on-failure variant
 * that build/start/migrate use, as distinct from `validate`, which
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
    printValidationErrors(allErrors, 'Schema parse errors', command)
    process.exit(1)
  }

  return buildSchemaRegistry(parsedSchemas, parsedRoutes, parsedRoles)
}
