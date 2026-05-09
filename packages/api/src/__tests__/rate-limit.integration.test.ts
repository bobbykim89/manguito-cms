import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType } from '@bobbykim/manguito-cms-core'
import { createAPIAdapter } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

// ─── Table names (unique to this suite) ──────────────────────────────────────

const BLOG_TABLE = 'api_int_rl_blog'
const BASE_PATH = 'rl-test-blog'

// 28 requests succeed → the 29th is the first to be rate-limited.
// Matches the task spec: "31 rapid requests → 29th or later returns 429".
const MAX_PER_IP = 28

// ─── Schema fixtures ──────────────────────────────────────────────────────────

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'rl-test-blog',
  label: 'Rate Limit Test Blog',
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
      name: 'blog_title',
      label: 'Blog Title',
      field_type: 'text/plain',
      required: false,
      nullable: true,
      order: 0,
      validation: { required: false },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: BLOG_TABLE, junction_tables: [] },
  api: {
    default_base_path: BASE_PATH,
    http_methods: ['GET'],
    item_path: `/api/${BASE_PATH}/:slug`,
  },
}

const TEST_REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: [], valid_permissions: [] },
  schemas: {},
  content_types: { 'rl-test-blog': BLOG_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
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
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${BLOG_TABLE}" CASCADE`))
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE "${BLOG_TABLE}" RESTART IDENTITY CASCADE`))
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Each test gets a fresh app so the rate-limit sliding window is reset.
function makeApp() {
  const { app } = createAPIAdapter({
    storage: createLocalAdapter(),
    registry: TEST_REGISTRY,
    db,
    rateLimit: {
      findAll: {
        windowMs: 60_000,
        maxPerIp: MAX_PER_IP,
        maxGlobal: 500,
      },
    },
  })
  return app
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rate limiting — integration', () => {
  it('31 rapid unauthenticated requests to findAll → 29th or later returns 429', async () => {
    // Fresh app gives a clean sliding-window state.
    const app = makeApp()
    const statuses: number[] = []

    for (let i = 0; i < 31; i++) {
      const res = await app.request(`/api/${BASE_PATH}`)
      statuses.push(res.status)
    }

    // First MAX_PER_IP (28) requests must succeed
    const earlyStatuses = statuses.slice(0, MAX_PER_IP)
    expect(earlyStatuses.every((s) => s === 200)).toBe(true)

    // From the 29th request onward, all must be rate-limited
    const lateStatuses = statuses.slice(MAX_PER_IP)
    expect(lateStatuses.every((s) => s === 429)).toBe(true)
  })

  it('Retry-After header present on 429 response', async () => {
    const app = makeApp()

    // Exhaust the per-IP budget, then capture the first 429
    let first429: Response | null = null
    for (let i = 0; i < MAX_PER_IP + 1; i++) {
      const res = await app.request(`/api/${BASE_PATH}`)
      if (res.status === 429 && first429 === null) {
        first429 = res
      }
    }

    expect(first429).not.toBeNull()
    expect(first429!.status).toBe(429)

    const retryAfter = first429!.headers.get('Retry-After')
    expect(retryAfter).not.toBeNull()

    const seconds = Number(retryAfter)
    expect(Number.isFinite(seconds)).toBe(true)
    expect(seconds).toBeGreaterThan(0)

    const body = await first429!.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('RATE_LIMITED')
  })
})
