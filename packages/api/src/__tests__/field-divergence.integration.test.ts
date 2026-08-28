import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType, ParsedRole } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import { createDrizzleContentRepository } from '../repositories/content'
import { createMediaRepository } from '../repositories/media'
import { registerAdminContentRoutes } from '../routes/admin/content'
import { createFieldKeyMap } from '../field-keys'
import { divergentTextField, divergentMediaField } from '../field-keys.test-fixtures'
import type { createPermissionMiddleware } from '../middleware/permission'

// End-to-end proof (Stage 1, Task 9) that a field's public LABEL and its
// Postgres storage COLUMN can diverge and every surface still speaks the
// right vocabulary: the public API and the admin write/read surface see only
// labels, the database holds only columns. Tasks 1-8 each proved their own
// slice in isolation (unit tests, or a hand-built repo/router); this is the
// first time all of them run together against a real Postgres table whose
// columns are the storage names, through a registry whose field labels
// differ from them (ADR api/0003 — integration tests against real Postgres).

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// Table name unlikely to collide with any other integration suite's tables.
const TABLE = 'content_divergence_test'
const TYPE_NAME = 'divergence_test'
const BASE_PATH = 'divergence_test'

// The registry entry: label `title` over column `blog_title` (divergentTextField)
// and label `hero` over column `blog_hero_image` (divergentMediaField) — the
// exact fixtures Tasks 3/5 already exercise, now driven against a real table.
const DIVERGENT_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: TYPE_NAME,
  label: 'Divergence Test',
  source_file: 'test.yml',
  only_one: false,
  default_base_path: BASE_PATH,
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [divergentTextField, divergentMediaField],
  ui: { tabs: [] },
  db: { table_name: TABLE, junction_tables: [] },
  api: {
    default_base_path: BASE_PATH,
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: `/api/${BASE_PATH}/:slug`,
  },
}

// buildRolesRegistry (called by createCmsApp) requires the full system-role
// set — see admin-write.integration.test.ts. Only the public half of this
// suite goes through createCmsApp, and public routes never consult roles, but
// createCmsApp still boots the roles registry up front, so it must be valid.
const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor', label: 'Editor', is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer', label: 'Writer', is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer', label: 'Viewer', is_system: true, hierarchy_level: 4, permissions: [] },
]

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { [TYPE_NAME]: DIVERGENT_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// ─── Admin-half harness route ─────────────────────────────────────────────────
//
// createCmsApp's admin wiring requires a signed JWT cookie plus real `roles`/
// `users` tables (see admin-write.integration.test.ts) — appropriate when a
// test is exercising auth itself, but not needed here. This suite instead
// takes decision route (b) from the task brief: the admin half is asserted
// through registerAdminContentRoutes directly, doubling the permission layer
// exactly the way the sibling unit test (content.admin.test.ts) does with its
// `noopRequirePermission`. The repo underneath is NOT a mock — it is a real
// createDrizzleContentRepository against this suite's own Postgres table, so
// the write still round-trips through actual SQL. This is not a weakening of
// auth for a real deployment's admin surface; it is the same permission
// double already accepted for admin route unit tests, now backed by a real
// database instead of a mock repo.
const noopRequirePermission: ReturnType<typeof createPermissionMiddleware> = () => async (_c, next) =>
  next()

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pgAdapter.connect()
  db = pgAdapter.getDb()

  // A table whose columns are the STORAGE names, not the labels.
  await db.execute(
    sql.raw(`CREATE TABLE "${TABLE}" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug varchar(255) NOT NULL UNIQUE,
      published boolean NOT NULL DEFAULT false,
      created_at timestamp DEFAULT now(),
      updated_at timestamp DEFAULT now(),
      blog_title varchar(255),
      blog_hero_image uuid
    )`)
  )
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE "${TABLE}" RESTART IDENTITY CASCADE`))
})

function makePublicApp() {
  return createCmsApp({ storage: createLocalAdapter(), registry: REGISTRY, db }).app
}

function makeAdminApp() {
  const repo = createDrizzleContentRepository(db, TABLE)
  const mediaRepo = createMediaRepository(db)
  const fieldKeyMaps = { [TYPE_NAME]: createFieldKeyMap(DIVERGENT_TYPE.fields) }

  const app = new Hono()
  registerAdminContentRoutes(
    app,
    REGISTRY,
    { [TYPE_NAME]: repo },
    fieldKeyMaps,
    mediaRepo,
    noopRequirePermission
  )
  return app
}

describe('field label / storage column divergence, end to end', () => {
  it('public list returns labels only, and only published rows', async () => {
    await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('published-one', true, 'Hello'), ('draft-one', false, 'Draft')`)
    )

    const app = makePublicApp()
    const res = await app.request(`/api/${BASE_PATH}`)
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown>[] }

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1) // published only
    expect(body.data[0]!['title']).toBe('Hello')
    expect(body.data[0]).not.toHaveProperty('blog_title')
  })

  it('public single-item lookup returns labels only', async () => {
    await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('published-one', true, 'Hello')`)
    )

    const app = makePublicApp()
    const res = await app.request(`/api/${BASE_PATH}/published-one`)
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }

    expect(res.status).toBe(200)
    expect(body.data['title']).toBe('Hello')
    expect(body.data).not.toHaveProperty('blog_title')
  })

  it('filtering by the label queries the underlying column', async () => {
    await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('published-one', true, 'Hello'), ('other-one', true, 'Other')`)
    )

    const app = makePublicApp()
    const res = await app.request(`/api/${BASE_PATH}?filter[title]=Hello`)
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown>[] }

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]!['title']).toBe('Hello')
  })

  it('filtering by the raw column name is rejected with 400', async () => {
    await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('published-one', true, 'Hello')`)
    )

    const app = makePublicApp()
    const res = await app.request(`/api/${BASE_PATH}?filter[blog_title]=Hello`)
    const body = (await res.json()) as { ok: boolean }

    expect(res.status).toBe(400)
    expect(body.ok).toBe(false)
  })

  it('an admin write persists the column and echoes the label', async () => {
    const app = makeAdminApp()
    const res = await app.request(`/admin/api/content/${TYPE_NAME}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'created-one', title: 'Created' }),
    })
    const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> }

    expect(res.status).toBe(201)
    expect(body.data['title']).toBe('Created')
    expect(body.data).not.toHaveProperty('blog_title')

    // The database holds the column, keyed by the storage name, straight
    // from Postgres — not trusting the HTTP response.
    const row = await db.execute(
      sql.raw(`SELECT blog_title FROM "${TABLE}" WHERE slug = 'created-one'`)
    )
    expect((row.rows[0] as { blog_title: string }).blog_title).toBe('Created')
  })
})
