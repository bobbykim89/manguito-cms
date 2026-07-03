import { mkdirSync, statSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import type { Command } from 'commander'
import { build as viteBuild } from 'vite'
import { build as tsupBuild } from 'tsup'
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
import { generateSchemaFile } from '@bobbykim/manguito-cms-db'
import { generateSchemaRegistry } from '../codegen/registry.js'
import { generateRoutes } from '../codegen/routes.js'
import { generateForms } from '../codegen/forms.js'
import { generateServerEntries } from '../codegen/server-entries.js'
import { resolveConfig } from '../utils/config.js'
import { loadEnvFile } from '../utils/env.js'
import { printGuidedError, printSuccess, printValidationErrors } from '../utils/error.js'

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
  const allErrors: ParseError[] = []
  const parsedSchemas: ParsedSchema[] = []

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

  if (allErrors.length > 0) {
    printValidationErrors(allErrors, 'Schema parse errors', 'manguito build')
    process.exit(1)
  }

  const registry = buildSchemaRegistry(
    parsedSchemas,
    parsedRoutesDef!,
    parsedRoles!
  )

  // 4. Config loaded
  printSuccess('Config loaded')

  // 5. Schemas parsed
  const contentCount = parsedSchemas.filter((s) => s.schema_type === 'content-type').length
  const paragraphCount = parsedSchemas.filter((s) => s.schema_type === 'paragraph-type').length
  const taxonomyCount = parsedSchemas.filter((s) => s.schema_type === 'taxonomy-type').length
  const enumCount = parsedSchemas.filter((s) => s.schema_type === 'enum-type').length
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
  await generateServerEntries(
    { adminPrefix: config.admin.prefix, apiPrefix: config.api.prefix },
    generatedDir,
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
      // so the build succeeds even when they aren't installed. jsdom (used by
      // the SVG sanitizer) must stay external too: bundling it breaks its
      // runtime asset loading. It resolves from node_modules at runtime.
      external: ['hono/aws-lambda', 'hono/vercel', 'jsdom'],
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

/**
 * Returns true when dist/generated/schema.ts is absent or any file under
 * schemas/ is newer than it. Used by `manguito migrate` to decide whether
 * to run build first.
 */
export async function needsRebuild(cwd: string): Promise<boolean> {
  const sentinel = resolve(cwd, 'dist/generated/schema.ts')

  if (!existsSync(sentinel)) return true

  const sentinelMtime = statSync(sentinel).mtimeMs
  const schemasDir = resolve(cwd, 'schemas')

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
