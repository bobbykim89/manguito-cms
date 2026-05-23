// manguito start — run the production server from dist/
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Command } from 'commander'
import {
  getMigrationStatus,
  seedSystemTables,
} from '@bobbykim/manguito-cms-db'
import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
  type ParseError,
  type ParsedSchema,
} from '@bobbykim/manguito-cms-core'
import { loadEnvFile } from '../utils/env.js'
import { resolveConfig } from '../utils/config.js'
import { connectDb } from '../utils/db.js'
import { printGuidedError, printSuccess, printWarning } from '../utils/error.js'

export function registerStart(program: Command): void {
  program
    .command('start')
    .description('Start the production server from dist/')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      await runStart(options, { cwd: process.cwd() })
    })
}

export async function runStart(
  options: { env?: string },
  deps: { cwd: string; loadServer?: (url: string) => Promise<void> },
): Promise<void> {
  const { cwd } = deps

  // 1. Load env
  loadEnvFile(options.env)

  // 2. Resolve config
  const config = await resolveConfig(cwd)

  // 3. Connect DB — exits on failure via connectDb
  const db = await connectDb(config)

  // 4. Drift detection — check tracking table exists (Scenario A)
  const migrationsTable = config.migrations?.table ?? '__manguito_migrations'
  const migrationsFolder = config.migrations?.folder
    ? resolve(cwd, config.migrations.folder)
    : resolve(cwd, './migrations')

  const trackingTableExists = await db.tableExists(migrationsTable)
  if (!trackingTableExists) {
    printGuidedError(
      'Database has not been initialized.',
      'Run `manguito migrate` first to set up the database, then try again.',
    )
    process.exit(1)
  }

  // 5. getMigrationStatus — Scenario B: pending migrations exist
  const status = await getMigrationStatus(db.getDb(), { migrationsTable, migrationsFolder })

  if (status.pending.length > 0) {
    printWarning('There are pending migrations that have not been applied:')
    for (const file of status.pending) {
      process.stdout.write(`  - ${file}\n`)
    }
    process.stdout.write('\n')
    process.stdout.write('  Run `manguito migrate` to apply them.\n')
    process.stdout.write('  Continuing startup — proceed at your own risk.\n')
  }
  // Scenario C: all applied — no message

  // 6. Parse schemas → registry for seeder
  const allErrors: ParseError[] = []
  const parsedSchemas: ParsedSchema[] = []

  const walkResult = walkSchemaDirectory(config.schema)
  if (walkResult.ok) {
    for (const file of walkResult.value) {
      const parseResult = parseSchema(file.raw, file.schema_type, file.path)
      if (parseResult.ok) {
        parsedSchemas.push(parseResult.schema)
      } else {
        allErrors.push(...parseResult.errors)
      }
    }
  } else {
    allErrors.push(...walkResult.errors)
  }

  const rolesPath = resolve(cwd, 'roles.json')
  const rolesLoad = loadSchemaFile(rolesPath)
  let parsedRoles = null
  if (rolesLoad.ok) {
    const rolesResult = parseRoles(rolesLoad.value, rolesPath)
    if (rolesResult.ok) {
      parsedRoles = rolesResult.value
    } else {
      allErrors.push(...rolesResult.errors)
    }
  } else {
    allErrors.push(...rolesLoad.errors)
  }

  const routesPath = resolve(cwd, 'routes.json')
  const routesLoad = loadSchemaFile(routesPath)
  let parsedRoutes = null
  if (routesLoad.ok) {
    const routesResult = parseRoutes(routesLoad.value, routesPath)
    if (routesResult.ok) {
      parsedRoutes = routesResult.value
    } else {
      allErrors.push(...routesResult.errors)
    }
  } else {
    allErrors.push(...routesLoad.errors)
  }

  if (allErrors.length > 0 || parsedRoles === null || parsedRoutes === null) {
    printGuidedError(
      'Schema errors prevented seeding system tables.',
      'Run `manguito validate` for details.',
    )
    process.exit(1)
  }

  const registry = buildSchemaRegistry(parsedSchemas, parsedRoutes, parsedRoles)

  // 7. Seed system tables — idempotent, runs on every startup
  await seedSystemTables(db.getDb(), registry)

  // 8. Load dist/server.js — the production bundle starts the Hono server on import
  const serverUrl = pathToFileURL(resolve(cwd, 'dist/server.js')).href
  await (deps.loadServer ? deps.loadServer(serverUrl) : import(serverUrl))

  // 9. Print server info
  const port = Number(process.env['PORT'] ?? 3000)
  printSuccess(`Server running at http://localhost:${port}`)
  printSuccess(`Admin panel at http://localhost:${port}${config.admin.prefix}`)
}
