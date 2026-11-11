import { mkdirSync, statSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
import { build as viteBuild } from 'vite'
import { build as tsupBuild } from 'tsup'
import { findSchemaDeprecations } from '@bobbykim/manguito-cms-core'
import { generateSchemaFile } from '@bobbykim/manguito-cms-db'
import { generateSchemaRegistry } from '../codegen/registry.js'
import { generateRoutes } from '../codegen/routes.js'
import { generateForms } from '../codegen/forms.js'
import { generateServerEntries } from '../codegen/server-entries.js'
import { generateProgrammaticRegistry } from '../codegen/programmatic-registry.js'
import { generateVersionModel } from '../codegen/version-model.js'
import { resolveConfig } from '../utils/config.js'
import { resolveSchemaConfig } from '../utils/schema-config.js'
import { checkRegistry } from '../utils/schema-checks.js'
import { parseProjectSchemas } from '../utils/registry.js'
import { loadEnvFile } from '../utils/env.js'
import { loadProjectVersionModel } from '../utils/project-version-model.js'
import { printGuidedError, printSuccess, printValidationErrors, printSchemaDeprecations } from '../utils/error.js'

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Run codegen and compile project to dist/')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      await runBuild(options, { cwd: process.cwd() })
    })
}

export async function runBuild(
  options: { env?: string },
  deps: { cwd: string }
): Promise<void> {
  const { cwd } = deps

  // 1. Load env
  loadEnvFile(options.env)

  // 2. Resolve config — exits on failure
  const config = await resolveConfig(cwd)

  // 3. Parse all schemas — collect ALL errors before stopping
  const parsed = parseProjectSchemas(cwd, config)
  if (!parsed.ok) {
    printValidationErrors(parsed.errors, 'Schema parse errors', 'manguito build')
    process.exit(1)
  }

  const registry = parsed.value
  printSchemaDeprecations(findSchemaDeprecations(registry))
  // References between schemas (unknown or wrong-type targets, circular
  // paragraphs, media size limits, unsupported relations), the same checks
  // `manguito validate` runs. Before any codegen write, like the parse errors.
  const crossRefErrors = checkRegistry(registry, config.api.media?.max_file_size)
  if (crossRefErrors.length > 0) {
    printValidationErrors(crossRefErrors, 'Schema reference errors', 'manguito build')
    process.exit(1)
  }

  // Checked BEFORE any codegen write: a failed build must leave nothing half
  // written under dist/generated.
  const versions = loadProjectVersionModel(resolveSchemaConfig(cwd, config), registry)
  if (!versions.ok) {
    printValidationErrors(versions.errors, 'Version model errors', 'manguito build')
    process.exit(1)
  }

  // 4. Config loaded
  printSuccess('Config loaded')

  // 5. Schemas parsed
  const countOf = (type: string): number => registry.all_schemas.filter((x) => x.schema_type === type).length
  const contentCount = countOf('content-type')
  const paragraphCount = countOf('paragraph-type')
  const taxonomyCount = countOf('taxonomy-type')
  const enumCount = countOf('enum-type')
  const enumPart = enumCount > 0 ? `, ${enumCount} enum types` : ''
  printSuccess(
    `Schemas parsed (${contentCount} content types, ${paragraphCount} paragraph types, ${taxonomyCount} taxonomy types${enumPart})`
  )

  // 6–8. Codegen
  const generatedDir = resolve(cwd, 'dist/generated')
  mkdirSync(generatedDir, { recursive: true })

  writeFileSync(join(generatedDir, 'schema.ts'), generateSchemaFile(registry), 'utf8')
  await generateSchemaRegistry(registry, generatedDir)
  await generateRoutes(registry, generatedDir)
  await generateForms(registry, join(generatedDir, 'forms'))

  await generateVersionModel(versions.value.model, generatedDir)
  printSuccess(`Version model baked (live: ${versions.value.model.live.join(', ')})`)

  const programmaticDir = resolve(cwd, config.programmatic.dir)
  const resolverFiles = existsSync(programmaticDir)
    ? walkFiles(programmaticDir).filter((f) => /\.(ts|mjs|js)$/.test(f))
    : []
  await generateProgrammaticRegistry(resolverFiles, generatedDir)

  await generateServerEntries(
    { adminPrefix: config.admin.prefix, apiPrefix: config.api.prefix },
    generatedDir,
  )

  // Written after the last codegen write, never before: a build that fails
  // partway must not leave a record saying the generated files are current.
  writeFileSync(
    join(generatedDir, VERSIONS_RECORD),
    JSON.stringify(installedManguitoVersions(cwd), null, 2) + '\n',
    'utf8',
  )

  // 9. Codegen complete
  printSuccess('Codegen complete')

  // 10. Vite build — admin panel
  try {
    await viteBuild({
      root: resolveAdminRoot(cwd),
      base: config.admin.prefix + '/',
      build: {
        outDir: resolve(cwd, 'dist/admin'),
        emptyOutDir: true,
      },
      define: {
        __ADMIN_PREFIX__: JSON.stringify(config.admin.prefix),
        __API_PREFIX__: JSON.stringify(config.api.prefix),
      },
      logLevel: 'warn',
    })
  } catch (err) {
    printGuidedError(
      'Vite build failed.',
      err instanceof Error ? err.message : String(err)
    )
    process.exit(1)
  }

  // 11. Admin panel compiled
  printSuccess('Admin panel compiled')

  // 12. tsup compile — server / handler / vercel entry points
  try {
    await tsupBuild({
      entry: {
        server: resolve(cwd, 'dist/generated/server.ts'),
        handler: resolve(cwd, 'dist/generated/handler.ts'),
        vercel: resolve(cwd, 'dist/generated/vercel.ts'),
      },
      format: ['esm'],
      outDir: resolve(cwd, 'dist'),
      dts: false,
      silent: true,
      // hono/aws-lambda and hono/vercel are optional peer deps — mark external
      // so the build succeeds even when they aren't installed.
      external: ['hono/aws-lambda', 'hono/vercel'],
    })
  } catch (err) {
    printGuidedError(
      'Server compile failed.',
      err instanceof Error ? err.message : String(err)
    )
    process.exit(1)
  }

  // 13. Server compiled
  printSuccess('Server compiled')

  // 14. Done
  process.stdout.write('\nBuild complete → dist/\n')
}

// ─── needsRebuild ─────────────────────────────────────────────────────────────

const VERSIONS_RECORD = 'manguito-versions.json'

const MANGUITO_PACKAGES = [
  '@bobbykim/manguito-cms-core',
  '@bobbykim/manguito-cms-db',
  '@bobbykim/manguito-cms-api',
  '@bobbykim/manguito-cms-admin',
  '@bobbykim/manguito-cms-cli',
]

/**
 * Versions of the manguito packages installed for the project at `cwd`.
 * A package's `exports` may not list ./package.json, so each one is found by
 * resolving its entry and walking up to the nearest package.json. Packages
 * that cannot be resolved are left out.
 */
export function installedManguitoVersions(cwd: string): Record<string, string> {
  const cwdRequire = createRequire(join(cwd, 'package.json'))
  const versions: Record<string, string> = {}
  for (const name of MANGUITO_PACKAGES) {
    try {
      let dir = dirname(cwdRequire.resolve(name))
      for (;;) {
        const pkgPath = join(dir, 'package.json')
        if (existsSync(pkgPath)) {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string }
          if (pkg.name === name && typeof pkg.version === 'string') versions[name] = pkg.version
          break
        }
        const parent = dirname(dir)
        if (parent === dir) break
        dir = parent
      }
    } catch {
      // not installed or unreadable: leave it out
    }
  }
  const running = runningCliVersion()
  if (running !== undefined) versions[RUNNING_CLI_KEY] = running
  return versions
}

// The cli bundles core, db, api and admin (tsup noExternal), so the codegen a
// build runs comes from the RUNNING cli, not from the project's node_modules.
// Its own version is recorded too: a newer cli over old installed packages
// still regenerates. Found by walking up from this file, which works from
// dist/index.js and from source.
const RUNNING_CLI_KEY = 'running-cli'
const CLI_PACKAGE = '@bobbykim/manguito-cms-cli'

function runningCliVersion(): string | undefined {
  try {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (;;) {
      const pkgPath = join(dir, 'package.json')
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === CLI_PACKAGE && typeof pkg.version === 'string') return pkg.version
      }
      const parent = dirname(dir)
      if (parent === dir) return undefined
      dir = parent
    }
  } catch {
    return undefined
  }
}

function recordedVersions(cwd: string): Record<string, string> | null {
  try {
    return JSON.parse(readFileSync(resolve(cwd, 'dist/generated', VERSIONS_RECORD), 'utf8')) as Record<string, string>
  } catch {
    return null
  }
}

function sameVersions(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k])
}

/**
 * Returns true when dist/generated/schema.ts is absent, any file under
 * the schema folder (`schemaDir`, default schemas/) is newer than it, or the manguito versions recorded at the last
 * build differ from the installed ones (an upgrade changes codegen without a
 * schema edit). Used by `manguito migrate` to decide whether to run build first.
 */
export async function needsRebuild(
  cwd: string,
  options: { installed?: Record<string, string>; schemaDir?: string } = {},
): Promise<boolean> {
  const installed = options.installed ?? installedManguitoVersions(cwd)
  const sentinel = resolve(cwd, 'dist/generated/schema.ts')

  if (!existsSync(sentinel)) return true

  const recorded = recordedVersions(cwd)
  if (recorded === null || !sameVersions(recorded, installed)) return true

  const sentinelMtime = statSync(sentinel).mtimeMs
  const schemasDir = options.schemaDir ?? resolve(cwd, 'schemas')

  if (!existsSync(schemasDir)) return false

  return walkFiles(schemasDir).some(
    (file) => statSync(file).mtimeMs > sentinelMtime
  )
}

function resolveAdminRoot(cwd: string): string {
  const cwdRequire = createRequire(join(cwd, 'package.json'))
  const adminPkgJson = cwdRequire.resolve('@bobbykim/manguito-cms-admin/package.json')
  return dirname(adminPkgJson)
}

function walkFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(full))
    } else {
      files.push(full)
    }
  }
  return files
}
