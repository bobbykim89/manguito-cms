// manguito dev — start dev server with schema watching and Vite admin panel
import { createServer as createHttpServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve, join, dirname, extname } from 'node:path'
import { mkdir, writeFile, watch, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type { Command } from 'commander'
import { sql } from '@bobbykim/manguito-cms-db'
import { createServer as createViteServer, searchForWorkspaceRoot } from 'vite'
import {
  runDevMigration,
  seedSystemTables,
  generateSchemaFile,
  createPostgresAdapter,
} from '@bobbykim/manguito-cms-db'
import { createCmsApp } from '@bobbykim/manguito-cms-api'
import {
  walkSchemaDirectory,
  parseSchema,
  parseRoles,
  parseRoutes,
  buildSchemaRegistry,
  loadSchemaFile,
  hashPassword,
  type SchemaRegistry,
  type ParsedSchema,
} from '@bobbykim/manguito-cms-core'
import { generateDrizzleConfig } from '../codegen/drizzle-config.js'
import { generateSchemaRegistry } from '../codegen/registry.js'
import { generateRoutes } from '../codegen/routes.js'
import { generateForms } from '../codegen/forms.js'
import { generateNav } from '../codegen/nav.js'
import { loadEnvFile } from '../utils/env.js'
import { resolveConfig } from '../utils/config.js'
import { connectDb } from '../utils/db.js'
import { printGuidedError, printSuccess } from '../utils/error.js'
import { createPromptAdapter } from '../utils/prompt.js'

type HonoFetch = (request: Request) => Response | Promise<Response>

const UPLOAD_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
}

export function registerDev(program: Command): void {
  program
    .command('dev')
    .description('Start dev server with file watching and auto-migration')
    .option('--env <path>', 'path to .env file to load')
    .action(async (options: { env?: string }) => {
      await runDev(options, { cwd: process.cwd() })
    })
}

export async function runDev(
  options: { env?: string },
  deps: { cwd: string },
): Promise<void> {
  const { cwd } = deps
  const prompt = createPromptAdapter()

  process.stdout.write('\nManguito CMS — Dev Server\n\n')

  // 1. Load env
  loadEnvFile(options.env)

  // 2. Resolve config
  const config = await resolveConfig(cwd)
  printSuccess('Config loaded')

  // 3. Connect DB — exits on failure via connectDb
  const db = await connectDb(config)
  printSuccess('Database connected')

  // Prepare .manguito/ directory and drizzle artifacts (needed before push)
  const manguitoDir = resolve(cwd, '.manguito')
  await mkdir(manguitoDir, { recursive: true })
  const drizzleConfigPath = resolve(manguitoDir, 'drizzle.config.ts')

  // 4. Parse schemas and always push schema to DB (idempotent — creates tables on
  //    first run, adds missing columns on subsequent runs when schema evolves).
  const needsSeed = !(await db.tableExists('users'))
  const bootstrapRegistry = await parseAllSchemas(cwd, config)

  await generateDrizzleConfig(config, manguitoDir)
  await writeFile(join(manguitoDir, 'schema.ts'), generateSchemaFile(bootstrapRegistry), 'utf8')
  await runDevMigration(drizzleConfigPath)
  printSuccess(needsSeed ? 'Schema tables created' : 'Schema tables up to date')

  if (needsSeed) {
    await seedSystemTables(db.getDb(), bootstrapRegistry)
    printSuccess('System tables seeded')
  }

  // 5. Check if any admin user exists — prompt on first run
  const adminCountResult = await db.getDb().execute(sql`
    SELECT COUNT(*)::int AS count
    FROM users
    JOIN roles ON users.role_id = roles.id
    WHERE roles.hierarchy_level = (SELECT MIN(hierarchy_level) FROM roles)
  `)
  const adminRow = adminCountResult.rows[0]
  const adminCount = adminRow !== undefined ? Number((adminRow as { count: string | number }).count) : 0

  if (adminCount === 0) {
    process.stdout.write('\nNo admin account found.\n')

    const email = await prompt.input('Admin email:')
    const password = await prompt.password('Admin password:')
    const hash = await hashPassword(password)

    const roleResult = await db.getDb().execute(sql`
      SELECT id FROM roles ORDER BY hierarchy_level ASC LIMIT 1
    `)
    const roleRow = roleResult.rows[0]
    if (roleRow === undefined) {
      printGuidedError('No roles found in database. Run `manguito migrate` to seed roles.')
      process.exit(1)
    }
    const roleId = (roleRow as { id: string }).id
    const userId = crypto.randomUUID()

    await db.getDb().execute(sql`
      INSERT INTO users (id, email, password_hash, role_id, token_version, must_change_password)
      VALUES (${userId}, ${email}, ${hash}, ${roleId}, 0, false)
    `)
    process.stdout.write('\n')
    printSuccess('Admin account created')
  }

  // 6. Use the already-parsed registry; write remaining .manguito/ artifacts
  const registry = bootstrapRegistry

  const contentCount = Object.keys(registry.content_types).length
  const paragraphCount = Object.keys(registry.paragraph_types).length
  const taxonomyCount = Object.keys(registry.taxonomy_types).length
  printSuccess(
    `Schema parsed (${contentCount} content types, ${paragraphCount} paragraph types, ${taxonomyCount} taxonomy types)`,
  )

  // 7. Write .manguito/ artifacts (drizzle config and schema.ts already written above)
  await generateSchemaRegistry(registry, manguitoDir)
  await generateRoutes(registry, manguitoDir)
  await generateForms(registry, join(manguitoDir, 'forms'))
  await generateNav(registry, manguitoDir)

  // 8. Create Hono app via createCmsApp
  const adapter = createCmsApp({
    name: config.name,
    registry,
    db: db.getDb(),
    storage: config.storage,
    ...(config.api.prefix ? { prefix: config.api.prefix } : {}),
    ...(config.api.media?.max_file_size ? { media: { max_file_size: config.api.media.max_file_size } } : {}),
    ...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {}),
    ...(config.server.cors ? { cors: config.server.cors } : {}),
  })

  // Hot-swappable fetch handler — mutated by onSchemaFileChange
  let honoFetch: HonoFetch = (req) => adapter.app.fetch(req)

  // 9. Mount Vite dev server as Hono middleware for admin routes
  const vite = await createViteServer({
    root: resolveAdminRoot(cwd),
    server: {
      middlewareMode: true,
      // The admin package (Vite root) lives deep in node_modules/.pnpm, so Vite's
      // default file-serving allow list does not cover sibling deps like the
      // @fontsource font files. Allow the project root (covers cwd/node_modules
      // in installed projects) and the workspace root (covers hoisted deps +
      // packages/admin in the monorepo).
      fs: { allow: [searchForWorkspaceRoot(cwd), cwd] },
    },
    appType: 'spa',
    logLevel: 'warn',
  })

  // 10. Start Hono + Vite HTTP server
  const apiPrefix = config.api.prefix ?? '/api'
  const port = Number(process.env['PORT'] ?? 3000)

  const httpServer = createHttpServer(async (req, res) => {
    try {
      const url = req.url ?? '/'
      // API routes → Hono (both public API and admin API)
      if (url.startsWith(apiPrefix) || url.startsWith('/admin/api')) {
        await bridgeToHono(req, res, honoFetch)
        return
      }
      // Static uploads → serve files written by the local storage adapter
      if (url.startsWith('/uploads/')) {
        const relativePath = (url.slice('/uploads/'.length).split('?')[0] ?? '').replace(/\.\./g, '')
        const uploadsDir = resolve(cwd, 'uploads')
        const filePath = resolve(uploadsDir, relativePath)
        if (!filePath.startsWith(uploadsDir + '/') && filePath !== uploadsDir) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        try {
          const data = await readFile(filePath)
          const ext = extname(filePath).slice(1).toLowerCase()
          const mime = UPLOAD_MIME_MAP[ext] ?? 'application/octet-stream'
          res.setHeader('Content-Type', mime)
          // User-uploaded content served same-origin: block MIME-sniffing and
          // force unknown types to download rather than render inline.
          res.setHeader('X-Content-Type-Options', 'nosniff')
          if (mime === 'application/octet-stream') res.setHeader('Content-Disposition', 'attachment')
          res.end(data)
        } catch {
          res.statusCode = 404
          res.end('Not found')
        }
        return
      }
      // Admin panel and all other routes → Vite
      const viteHandler = vite.middlewares as (
        req: IncomingMessage,
        res: ServerResponse,
        next: (err?: unknown) => void,
      ) => void
      viteHandler(req, res, (err) => {
        if (err) {
          res.statusCode = 500
          res.end(String(err))
          return
        }
        res.statusCode = 404
        res.end('Not found')
      })
    } catch (err) {
      res.statusCode = 500
      res.end('Internal Server Error')
      process.stderr.write(`Dev server error: ${err instanceof Error ? err.message : String(err)}\n`)
    }
  })

  httpServer.listen(port, () => {
    printSuccess(`Dev server running at http://localhost:${port}`)
    printSuccess(`Admin panel at http://localhost:${port}${config.admin.prefix}`)
  })

  // 11. Start fs.watch on schemas/ directory
  const schemasDir = resolve(cwd, config.schema.base_path)

  const watcher = watch(schemasDir, { recursive: true })
  void (async () => {
    for await (const event of watcher) {
      if (event.filename && /\.(json|ya?ml)$/.test(event.filename)) {
        // 12. On schema file change: incremental re-parse + hot-swap
        await onSchemaFileChange({
          cwd,
          config,
          manguitoDir,
          drizzleConfigPath,
          db,
          updateFetch: (fetch) => {
            honoFetch = fetch
          },
        })
      }
    }
  })()
}

// ─── Schema file change handler ───────────────────────────────────────────────

type OnSchemaFileChangeArgs = {
  cwd: string
  config: Awaited<ReturnType<typeof resolveConfig>>
  manguitoDir: string
  drizzleConfigPath: string
  db: ReturnType<typeof createPostgresAdapter>
  updateFetch: (fetch: HonoFetch) => void
}

async function onSchemaFileChange(args: OnSchemaFileChangeArgs): Promise<void> {
  const { cwd, config, manguitoDir, drizzleConfigPath, db, updateFetch } = args

  let registry: SchemaRegistry
  try {
    registry = await parseAllSchemas(cwd, config)
  } catch {
    process.stderr.write('⚠ Schema parse error — changes not applied.\n')
    return
  }

  // Regenerate .manguito/ artifacts for the updated schema
  await generateDrizzleConfig(config, manguitoDir)
  await writeFile(join(manguitoDir, 'schema.ts'), generateSchemaFile(registry), 'utf8')
  await generateSchemaRegistry(registry, manguitoDir)
  await generateRoutes(registry, manguitoDir)
  await generateForms(registry, join(manguitoDir, 'forms'))
  await generateNav(registry, manguitoDir)

  // Push schema changes to DB
  try {
    await runDevMigration(drizzleConfigPath)
  } catch (err) {
    process.stderr.write(`⚠ drizzle-kit push failed: ${err instanceof Error ? err.message : String(err)}\n`)
    return
  }

  // Hot-swap Hono app with updated registry
  const newAdapter = createCmsApp({
    name: config.name,
    registry,
    db: db.getDb(),
    storage: config.storage,
    ...(config.api.prefix ? { prefix: config.api.prefix } : {}),
    ...(config.api.media?.max_file_size ? { media: { max_file_size: config.api.media.max_file_size } } : {}),
    ...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {}),
    ...(config.server.cors ? { cors: config.server.cors } : {}),
  })
  updateFetch((req) => newAdapter.app.fetch(req))

  printSuccess('Schema updated')
}

// ─── Schema parsing helper ────────────────────────────────────────────────────

async function parseAllSchemas(
  cwd: string,
  config: Awaited<ReturnType<typeof resolveConfig>>,
): Promise<SchemaRegistry> {
  const parsedSchemas: ParsedSchema[] = []
  const walkResult = walkSchemaDirectory(config.schema)

  if (!walkResult.ok) {
    printGuidedError('Schema directory errors — run `manguito validate` for details.')
    process.exit(1)
  }

  for (const file of walkResult.value) {
    const parseResult = parseSchema(file.raw, file.schema_type, file.path)
    if (!parseResult.ok) {
      printGuidedError('Schema parse errors — run `manguito validate` for details.')
      process.exit(1)
    }
    parsedSchemas.push(parseResult.schema)
  }

  const rolesPath = resolve(cwd, config.schema.base_path, 'roles.json')
  const rolesLoad = loadSchemaFile(rolesPath)
  if (!rolesLoad.ok) {
    printGuidedError('Could not read roles.json.')
    process.exit(1)
  }
  const rolesResult = parseRoles(rolesLoad.value, rolesPath)
  if (!rolesResult.ok) {
    printGuidedError('roles.json parse errors — run `manguito validate` for details.')
    process.exit(1)
  }

  const routesPath = resolve(cwd, config.schema.base_path, 'routes.json')
  const routesLoad = loadSchemaFile(routesPath)
  if (!routesLoad.ok) {
    printGuidedError('Could not read routes.json.')
    process.exit(1)
  }
  const routesResult = parseRoutes(routesLoad.value, routesPath)
  if (!routesResult.ok) {
    printGuidedError('routes.json parse errors — run `manguito validate` for details.')
    process.exit(1)
  }

  return buildSchemaRegistry(parsedSchemas, routesResult.value, rolesResult.value)
}

// ─── Admin root resolver ──────────────────────────────────────────────────────

// Resolves the admin package's source directory from the project being served.
// Uses package.json resolution (exported via ./package.json) so it works both
// in pnpm workspaces (symlinked) and real installs.
function resolveAdminRoot(cwd: string): string {
  const cwdRequire = createRequire(join(cwd, 'package.json'))
  const adminPkgJson = cwdRequire.resolve('@bobbykim/manguito-cms-admin/package.json')
  return dirname(adminPkgJson)
}

// ─── Node.js → Hono bridge ────────────────────────────────────────────────────

async function bridgeToHono(
  req: IncomingMessage,
  res: ServerResponse,
  honoFetch: HonoFetch,
): Promise<void> {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers.set(key, value)
    } else if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v)
    }
  }

  const method = req.method ?? 'GET'
  const hasBody = !['GET', 'HEAD'].includes(method)
  let body: Buffer | undefined
  if (hasBody) {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
  }

  const webReq = new Request(url, {
    method,
    headers,
    ...(body !== undefined && body.length > 0 ? { body } : {}),
  })

  const webRes = await Promise.resolve(honoFetch(webReq))

  res.statusCode = webRes.status
  const setCookieValues: string[] = []
  for (const [key, val] of webRes.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      setCookieValues.push(val)
    } else {
      res.setHeader(key, val)
    }
  }
  if (setCookieValues.length > 0) {
    res.setHeader('Set-Cookie', setCookieValues)
  }
  res.end(Buffer.from(await webRes.arrayBuffer()))
}
