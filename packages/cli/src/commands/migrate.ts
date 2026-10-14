// manguito migrate — apply pending database migrations
import { resolve, join } from 'node:path'
import type { Command } from 'commander'
import {
  getMigrationStatus,
  generateMigration,
  previewMigration,
  applyMigrations,
  scanMigrationFiles,
  scanMigrationSql,
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
  // Load env before createPostgresAdapter() reads DB_URL from process.env.
  // buildDeps is called as an argument to runMigrate (evaluated first), so
  // waiting until inside runMigrate to call loadEnvFile is too late.
  loadEnvFile(options.env)
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

  // 5. Dry run: what `migrate` would generate, shown without keeping it.
  //    previewMigration puts migrations/ back exactly as it was, so the real
  //    run that follows generates the same file. No destructive-change prompt:
  //    nothing is applied.
  if (options.dryRun) {
    const preview = await previewMigration(deps.configPath, migrationsFolder)
    const scan = scanMigrationSql(preview)
    printSuccess(
      preview.length === 0
        ? 'No new migration would be generated'
        : `Would generate ${preview.length} migration file${preview.length !== 1 ? 's' : ''}: ${preview.map((m) => m.name).join(', ')}`,
    )
    process.stdout.write('\nDry run — no migration files written, no changes applied.\n\n')

    if (preview.length > 0) {
      process.stdout.write('Generated SQL:\n')
      process.stdout.write('──────────────────────────────────────────\n')
      for (const m of preview) process.stdout.write(m.sql)
      process.stdout.write('\n──────────────────────────────────────────\n\n')
    }

    if (scan.hasDestructiveOperations) {
      process.stdout.write('⚠ This migration contains destructive operations:\n')
      for (const op of scan.operations) process.stdout.write(`  - ${op.operation}\n`)
      process.stdout.write('\n')
    } else if (preview.length > 0) {
      process.stdout.write('No destructive operations detected.\n\n')
    }

    if (preview.length > 0) process.stdout.write('Run `manguito migrate` to generate and apply this migration.\n')
    process.exit(0)
  }

  // 6. Generate migration SQL files — returns basenames of newly created files
  const newFileNames = await generateMigration(deps.configPath, migrationsFolder)
  const newFilePaths = newFileNames.map((f) => join(migrationsFolder, f))

  printSuccess(
    newFileNames.length === 0
      ? 'No new migration files generated'
      : `Generated ${newFileNames.length} migration file${newFileNames.length !== 1 ? 's' : ''}: ${newFileNames.join(', ')}`,
  )

  // 7. Scan new files for destructive operations
  const scanResult =
    newFilePaths.length > 0
      ? scanMigrationFiles(newFilePaths)
      : { hasDestructiveOperations: false, operations: [] as ReturnType<typeof scanMigrationFiles>['operations'] }

  // 8. Destructive operation warning / confirmation
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

  const rolesPath = resolve(cwd, config.schema.base_path, 'roles.json')
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

  const routesPath = resolve(cwd, config.schema.base_path, 'routes.json')
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
