import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType, ParsedRole } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import type { BakedVersionModel } from '../versions'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// ─── Table/path names (unique to this suite) ─────────────────────────────────

const BLOG_TABLE = 'api_int_ver_blog'
const BASE_PATH = 'ver-test-blog'
// The content type's machine name — also the key `TWO_LIVE`'s projections
// index into. Deliberately the same string as BASE_PATH, matching every other
// integration fixture in this file's sibling suites.
const TEST_TYPE_NAME = BASE_PATH

// ─── Schema fixture ───────────────────────────────────────────────────────────
//
// One field whose LABEL ('title') and storage COLUMN ('blog_title') diverge —
// the only reason these tests can tell versions apart. A fixture where the
// two agreed would pass under an implementation that ignores versions.

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: TEST_TYPE_NAME,
  label: 'Version Test Blog',
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
  fields: [
    {
      name: 'title',
      label: 'Title',
      field_type: 'text/plain',
      required: true,
      nullable: true,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: BLOG_TABLE, junction_tables: [] },
  api: {
    default_base_path: BASE_PATH,
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: `/api/${BASE_PATH}/:slug`,
  },
}

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const TEST_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { [TEST_TYPE_NAME]: BLOG_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// ─── The version model under test ────────────────────────────────────────────
//
// v2 is deliberately ABSENT from `live` — that gap is what the 410 test needs.
// v1 exposes the column under its original name; v3 (current) exposes it
// under the renamed label. Same row, two contracts.

const TWO_LIVE: BakedVersionModel = {
  current: 'v3',
  live: ['v1', 'v3'],
  projections: {
    v1: {
      version: 'v1',
      types: {
        [TEST_TYPE_NAME]: { fields: [{ column_name: 'blog_title', exposed_as: 'blog_title' }] },
      },
    },
    v3: {
      version: 'v3',
      types: {
        [TEST_TYPE_NAME]: { fields: [{ column_name: 'blog_title', exposed_as: 'title' }] },
      },
    },
  },
}

// ─── DB lifecycle ─────────────────────────────────────────────────────────────

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pgAdapter.connect()
  db = pgAdapter.getDb()

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${BLOG_TABLE}" (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        VARCHAR         NOT NULL UNIQUE,
      published   BOOLEAN         NOT NULL DEFAULT false,
      blog_title  VARCHAR,
      created_at  TIMESTAMP       NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP       NOT NULL DEFAULT NOW()
    )
  `))

  // System media table — shared with other suites (see admin.integration.test.ts),
  // needed here only so GET /api/media/:id has somewhere to look for the catch-all
  // fall-through test.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS media (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type            VARCHAR(50)      NOT NULL DEFAULT 'image',
      url             VARCHAR(2048)    NOT NULL,
      mime_type       VARCHAR(255)     NOT NULL,
      alt             VARCHAR(255),
      file_size       INTEGER          NOT NULL,
      width           INTEGER,
      height          INTEGER,
      duration        INTEGER,
      reference_count INTEGER          NOT NULL DEFAULT 0,
      created_at      TIMESTAMP        NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP        NOT NULL DEFAULT NOW()
    )
  `))

  await db.execute(sql.raw(`
    INSERT INTO "${BLOG_TABLE}" (slug, published, blog_title)
    VALUES ('hello-world', true, 'Hello')
  `))
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${BLOG_TABLE}" CASCADE`))
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE "${BLOG_TABLE}" RESTART IDENTITY CASCADE`))
  await db.execute(sql.raw(`
    INSERT INTO "${BLOG_TABLE}" (slug, published, blog_title)
    VALUES ('hello-world', true, 'Hello')
  `))
})

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeApp(model?: BakedVersionModel) {
  const { app } = createCmsApp({
    storage: createLocalAdapter(),
    registry: TEST_REGISTRY,
    db,
    ...(model !== undefined && { versions: model }),
  })
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('versioned routes — integration', () => {
  it('serves the same row under different field names per version', async () => {
    // THE feature. One row, one column, two contracts. A fixture where the two
    // versions agree would pass under an implementation that ignores versions.
    const app = makeApp(TWO_LIVE)

    const v1 = await (await app.request(`/api/v1/${BASE_PATH}`)).json()
    expect(v1.data[0]).toHaveProperty('blog_title', 'Hello')
    expect(v1.data[0]).not.toHaveProperty('title')

    const v3 = await (await app.request(`/api/v3/${BASE_PATH}`)).json()
    expect(v3.data[0]).toHaveProperty('title', 'Hello')
    expect(v3.data[0]).not.toHaveProperty('blog_title')
  })

  it('serves the latest shape on the unversioned path', async () => {
    const app = makeApp(TWO_LIVE)
    const body = await (await app.request(`/api/${BASE_PATH}`)).json()
    expect(body.data[0]).toHaveProperty('title', 'Hello')
  })

  it('sets deprecation headers on the unversioned path when more than one version is live', async () => {
    const res = await makeApp(TWO_LIVE).request(`/api/${BASE_PATH}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Deprecation')).toBe('true')
    expect(res.headers.get('Link')).toContain('/api/v3')
    expect(res.headers.get('Link')).toContain('rel="successor-version"')
    expect(res.headers.get('Warning')).toMatch(/^299 /)
  })

  it('sets deprecation headers on an older live version but not on the current one', async () => {
    const app = makeApp(TWO_LIVE)
    const old = await app.request(`/api/v1/${BASE_PATH}`)
    expect(old.headers.get('Deprecation')).toBe('true')
    expect(old.headers.get('Link')).toContain('/api/v3')

    const current = await app.request(`/api/v3/${BASE_PATH}`)
    expect(current.status).toBe(200)
    // A consumer on the current version has made no mistake and must get a
    // clean response — a header here would train people to ignore the header.
    expect(current.headers.get('Deprecation')).toBeNull()
  })

  it('answers 410 VERSION_RETIRED for a gap below current', async () => {
    const res = await makeApp(TWO_LIVE).request(`/api/v2/${BASE_PATH}`)
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VERSION_RETIRED')
    // Naming the live versions is what makes the response actionable.
    expect(body.error.message).toContain('v1')
    expect(body.error.message).toContain('v3')
  })

  it('answers 404 VERSION_NOT_FOUND for a version above current', async () => {
    const res = await makeApp(TWO_LIVE).request(`/api/v9/${BASE_PATH}`)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('VERSION_NOT_FOUND')
  })

  it('does not swallow /api/media/:id', async () => {
    // The catch-all matches ${prefix}/:version/*, so it sees this too. 'media'
    // is not version-shaped, so it must fall through to the media route. A 404
    // is fine here — that id does not exist — but the CODE must not be a
    // version error, which is what would prove the catch-all ate the request.
    const res = await makeApp(TWO_LIVE).request('/api/media/00000000-0000-0000-0000-000000000000')
    const body = await res.json().catch(() => ({}))
    expect(body?.error?.code).not.toBe('VERSION_NOT_FOUND')
    expect(body?.error?.code).not.toBe('VERSION_RETIRED')
  })

  it('omits deprecation headers entirely when only one version is live', async () => {
    // A project that never cut a version must see no new warnings on rebuild.
    const solo: BakedVersionModel = {
      current: 'v1',
      live: ['v1'],
      projections: { v1: { version: 'v1', types: { [TEST_TYPE_NAME]: { fields: [
        { column_name: 'blog_title', exposed_as: 'title' },
      ] } } } },
    }
    const res = await makeApp(solo).request(`/api/${BASE_PATH}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('Deprecation')).toBeNull()
    expect(res.headers.get('Warning')).toBeNull()
  })

  it('behaves exactly as before when no versions option is passed', async () => {
    // The compatibility guarantee. No version routes, no headers, and the
    // unversioned path serving current's shape — byte-identical to today.
    const app = makeApp(undefined)
    const un = await app.request(`/api/${BASE_PATH}`)
    expect(un.status).toBe(200)
    expect((await un.json()).data[0]).toHaveProperty('title', 'Hello')
    expect(un.headers.get('Deprecation')).toBeNull()
    // /api/v1/... is not registered at all, and no catch-all exists to claim it.
    const v1 = await app.request(`/api/v1/${BASE_PATH}`)
    expect(v1.status).toBe(404)
    expect((await v1.json().catch(() => ({})))?.error?.code).not.toBe('VERSION_NOT_FOUND')
  })
})
