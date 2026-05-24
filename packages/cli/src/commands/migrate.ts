// manguito migrate — apply pending database migrations
import { resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Command } from 'commander'
import {
  getMigrationStatus,
  generateMigration,
  applyMigrations,
  scanMigrationFiles,
  seedSystemTables,
  createPostgresAdapter,
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
import { generateDrizzleConfig } from '../codegen/drizzle-config.js'
import { runBuild, needsRebuild as checkNeedsRebuild } from './build.js'
import { loadEnvFile } from '../utils/env.js'
import { resolveConfig } from '../utils/config.js'
import { printGuidedError, printSuccess } from '../utils/error.js'
import { createPromptAdapter, type PromptAdapter } from '../utils/prompt.js'

type MigrateOptions = {
  env?: string
  force?: boolean
  dryRun?: boolean
  status?: boolean
}

type MigrateDeps = {
  buildRunner: () => Promise<void>
  needsRebuild: () => Promise<boolean>
  db: ReturnType<typeof createPostgresAdapter>
  migrationsFolder: string
  configPath: string
  prompt: PromptAdapter
}

export function registerMigrate(program: Command): void {
  program
    .command('migrate')
    .description('Apply pending database migrations')
    .option('--env <path>', 'path to .env file to load')
    .option('--status', 'show migration state without applying')
    .option('--dry-run', 'preview migrations without writing')
    .option('--force', 'skip destructive-change confirmation prompt')
    .action(async (options: MigrateOptions) => {
      const cwd = process.cwd()
      await runMigrate(options, buildDeps(options, cwd))
    })

  program
    .command('migrate:status')
    .description('Show migration state (shorthand for migrate --status)')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      const cwd = process.cwd()
      await runMigrate({ ...options, status: true }, buildDeps(options, cwd))
    })
}

function buildDeps(options: { env?: string }, cwd: string): MigrateDeps {
  return {
    buildRunner: async () => runBuild(options.env ? { env: options.env } : {}, { cwd }),
    needsRebuild: () => checkNeedsRebuild(cwd),
    db: createPostgresAdapter(),
    migrationsFolder: resolve(cwd, './migrations'),
    configPath: resolve(cwd, 'dist/generated/drizzle.config.ts'),
    prompt: createPromptAdapter(),
  }
}

export async function runMigrate(options: MigrateOptions, deps: MigrateDeps): Promise<void> {
  // --status: read-only, no build or writes
  if (options.status) {
    loadEnvFile(options.env)

    try {
      await deps.db.connect()
    } catch {
      printGuidedError('DB_URL not set or database unreachable')
      process.exit(1)
    }

    const config = await resolveConfig(process.cwd())
    const migrationsTable = config.migrations?.table ?? '__manguito_migrations'
    const migrationsFolder = config.migrations?.folder
      ? resolve(process.cwd(), config.migrations.folder)
      : deps.migrationsFolder

    const status = await getMigrationStatus(deps.db.getDb(), { migrationsTable, migrationsFolder })

    if (status.applied.length === 0 && status.pending.length === 0) {
      process.stdout.write(
        'No migration files found. Run `manguito migrate` to generate and apply migrations.\n',
      )
      process.exit(0)
    }

    if (status.applied.length > 0) {
      process.stdout.write('Applied migrations:\n')
      for (const file of status.applied) {
        process.stdout.write(`  ✔ ${file}\n`)
      }
      process.stdout.write('\n')
    }

    if (status.pending.length > 0) {
      process.stdout.write('Pending migrations:\n')
      for (const file of status.pending) {
        process.stdout.write(`  ○ ${file}\n`)
      }
      process.stdout.write('\n')
      process.stdout.write('Run `manguito migrate` to apply pending migrations.\n')
    } else {
      process.stdout.write('All migrations are applied.\n')
    }

    process.exit(0)
  }

  // ─── Standard flow ────────────────────────────────────────────────────────────

  // 1. Load env
  loadEnvFile(options.env)

  // 2. Resolve config
  const cwd = process.cwd()
  const config = await resolveConfig(cwd)
  const migrationsFolder = config.migrations?.folder
    ? resolve(cwd, config.migrations.folder)
    : deps.migrationsFolder
  const migrationsTable = config.migrations?.table ?? '__manguito_migrations'

  try {
    await deps.db.connect()
  } catch {
    printGuidedError('DB_URL not set or database unreachable')
    process.exit(1)
  }

  // 3. Build check — rebuild if schema files are newer than dist/generated/schema.ts
  if (await deps.needsRebuild()) {
    try {
      await deps.buildRunner()
    } catch (err) {
      printGuidedError(
        'Build failed.',
        err instanceof Error ? err.message : String(err),
      )
      process.exit(1)
    }
  }
  printSuccess('Build complete')

  // 4. Write drizzle config into dist/generated/
  const generatedDir = resolve(cwd, 'dist/generated')
  await generateDrizzleConfig(config, generatedDir)

  // 5. Generate migration SQL files — returns basenames of newly created files
  const newFileNames = await generateMigration(deps.configPath, migrationsFolder)
  const newFilePaths = newFileNames.map((f) => join(migrationsFolder, f))

  printSuccess(
    newFileNames.length === 0
      ? 'No new migration files generated'
      : `Generated ${newFileNames.length} migration file${newFileNames.length !== 1 ? 's' : ''}: ${newFileNames.join(', ')}`,
  )

  // 6. Scan new files for destructive operations
  const scanResult =
    newFilePaths.length > 0
      ? scanMigrationFiles(newFilePaths)
      : { hasDestructiveOperations: false, operations: [] as ReturnType<typeof scanMigrationFiles>['operations'] }

  // 7. Destructive operation warning / confirmation
  if (scanResult.hasDestructiveOperations) {
    process.stdout.write('⚠ This migration contains destructive operations:\n')
    for (const op of scanResult.operations) {
      process.stdout.write(`  - ${op.operation}\n`)
    }
    process.stdout.write('\n')
    process.stdout.write('  These changes are irreversible and may cause data loss.\n')

    const uniqueFiles = [...new Set(scanResult.operations.map((op) => op.file))]
    for (const file of uniqueFiles) {
      process.stdout.write(`  Review ./migrations/${file} before continuing.\n`)
    }
    process.stdout.write('\n')

    if (options.force) {
      process.stdout.write('  Proceeding automatically (--force).\n')
    } else {
      const confirmed = await deps.prompt.confirm('Apply anyway?')
      if (!confirmed) {
        process.stdout.write('Migration aborted.\n')
        process.exit(0)
      }
    }
  }

  // 8. Dry run — print SQL and exit without DB writes
  if (options.dryRun) {
    process.stdout.write('\nDry run — no files will be written, no changes applied.\n\n')

    if (newFilePaths.length > 0) {
      process.stdout.write('Generated SQL:\n')
      process.stdout.write('──────────────────────────────────────────\n')
      for (const filePath of newFilePaths) {
        const sql = await readFile(filePath, 'utf-8')
        process.stdout.write(sql)
      }
      process.stdout.write('──────────────────────────────────────────\n\n')
    } else {
      process.stdout.write('No SQL changes generated.\n\n')
    }

    if (!scanResult.hasDestructiveOperations) {
      process.stdout.write('No destructive operations detected.\n\n')
    }

    process.stdout.write('Run `manguito migrate` to generate and apply this migration.\n')
    process.exit(0)
  }

  // 9. Apply pending migrations
  const migrationResult = await applyMigrations(deps.configPath, deps.db.getDb(), {
    migrationsTable,
    migrationsFolder,
  })
  printSuccess(
    `Applied ${migrationResult.applied} migration${migrationResult.applied !== 1 ? 's' : ''}`,
  )

  // 10. Seed system tables — parse schemas to build registry
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
  const seedResult = await seedSystemTables(deps.db.getDb(), registry)

  // 11. Print result summary
  printSuccess(
    `Seeder: ${seedResult.roles.inserted} inserted, ${seedResult.roles.updated} updated, ${seedResult.roles.deleted} deleted (roles)`,
  )
  printSuccess(
    `Seeder: ${seedResult.base_paths.inserted} inserted, ${seedResult.base_paths.updated} updated, ${seedResult.base_paths.deleted} deleted (base_paths)`,
  )
}
