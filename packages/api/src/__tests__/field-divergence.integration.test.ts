import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type {
  SchemaRegistry,
  ParsedContentType,
  ParsedParagraphType,
  ParsedTaxonomyType,
  ParsedField,
  ParsedRole,
} from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import { createDrizzleContentRepository } from '../repositories/content'
import { createMediaRepository } from '../repositories/media'
import { registerAdminContentRoutes } from '../routes/admin/content'
import { createFieldKeyMap } from '../field-keys'
import { buildProjectors } from '../projector'
import { divergentTextField, divergentMediaField, divergentParagraphType } from '../field-keys.test-fixtures'
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

// A paragraph child table and a reference target table, both storage-named,
// added for Task 6 to drive nested projection (?include=, paragraph children)
// and sort mapping against real Postgres — not just the top-level row Tasks
// 1-8 already covered.
const PARAGRAPH_TABLE = 'paragraph_divergence_card'
const CATEGORY_TABLE = 'taxonomy_divergence_category'

// A one-to-one reference field whose label ('category') diverges from its
// storage column ('category_id'). `ui_component.ref` names the registry key
// ('taxonomy--category') the projector uses to map the resolved target's
// labels; `db_column.foreign_key.table` names the physical Postgres table
// (CATEGORY_TABLE) `resolveRelationField` actually queries — deliberately two
// different strings, the same split `divergentReferenceField` exercises.
const CATEGORY_FIELD: ParsedField = {
  name: 'category',
  label: 'Category',
  field_type: 'reference',
  required: false,
  nullable: true,
  order: 2,
  validation: { required: false },
  db_column: {
    column_name: 'category_id',
    column_type: 'uuid',
    nullable: true,
    foreign_key: { table: CATEGORY_TABLE, column: 'id', on_delete: 'SET NULL' },
  },
  ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'one-to-one' },
}

// A paragraph field whose children live on PARAGRAPH_TABLE, keyed by the
// paragraph type's machine name 'paragraph--card' (divergentParagraphType).
const CARDS_FIELD: ParsedField = {
  name: 'cards',
  label: 'Cards',
  field_type: 'paragraph',
  required: false,
  nullable: true,
  order: 3,
  validation: { required: false },
  db_column: null,
  ui_component: { component: 'paragraph-embed', ref: 'paragraph--card', rel: 'one-to-many' },
}

// divergentParagraphType (fixture) with its table pointed at PARAGRAPH_TABLE
// instead of its default 'paragraph_card' — this suite creates its own table.
const CARD_PARAGRAPH_TYPE: ParsedParagraphType = {
  ...divergentParagraphType,
  db: { table_name: PARAGRAPH_TABLE },
}

// The reference field's target: a taxonomy type with the same label/column
// divergence (label `title` over column `blog_title`, divergentTextField).
const CATEGORY_TAXONOMY_TYPE: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'taxonomy--category',
  label: 'Category',
  source_file: 'taxonomy--category.yml',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'true', nullable: false },
  ],
  fields: [divergentTextField],
  db: { table_name: CATEGORY_TABLE },
  api: { collection_path: '/api/taxonomy/category', item_path: '/api/taxonomy/category/:id' },
}

// The registry entry: label `title` over column `blog_title` (divergentTextField)
// and label `hero` over column `blog_hero_image` (divergentMediaField) — the
// exact fixtures Tasks 3/5 already exercise, now driven against a real table.
// Plus CATEGORY_FIELD and CARDS_FIELD (Task 6), reaching one level of nesting
// in each direction: a resolved reference target and a paragraph child row.
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
  fields: [divergentTextField, divergentMediaField, CATEGORY_FIELD, CARDS_FIELD],
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
  paragraph_types: { 'paragraph--card': CARD_PARAGRAPH_TYPE },
  taxonomy_types: { 'taxonomy--category': CATEGORY_TAXONOMY_TYPE },
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
      blog_hero_image uuid,
      category_id uuid
    )`)
  )

  // Paragraph child table — scoped by parent_id AND parent_field (two
  // paragraph fields of the same type would otherwise share rows), ordered by
  // "order". Storage-named (blog_title), same divergence as the parent row.
  await db.execute(
    sql.raw(`CREATE TABLE "${PARAGRAPH_TABLE}" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      parent_id uuid NOT NULL,
      parent_type varchar(255),
      parent_field varchar(255) NOT NULL,
      "order" integer NOT NULL DEFAULT 0,
      blog_title varchar(255)
    )`)
  )

  // Reference target table — same divergence again, one level of nesting via
  // ?include=category.
  await db.execute(
    sql.raw(`CREATE TABLE "${CATEGORY_TABLE}" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug varchar(255) NOT NULL UNIQUE,
      published boolean NOT NULL DEFAULT true,
      blog_title varchar(255)
    )`)
  )
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${PARAGRAPH_TABLE}"`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${CATEGORY_TABLE}"`))
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE "${TABLE}", "${PARAGRAPH_TABLE}", "${CATEGORY_TABLE}" RESTART IDENTITY CASCADE`
    )
  )
})

function makePublicApp() {
  return createCmsApp({ storage: createLocalAdapter(), registry: REGISTRY, db }).app
}

// Every type in REGISTRY, exactly as createCmsApp builds them: a projector is
// only created for a type whose map is present, so omitting the paragraph and
// taxonomy maps here would silently drop those two from the projector set and
// leave a nested admin assertion passing for the wrong reason.
function makeFieldKeyMaps() {
  return {
    [TYPE_NAME]: createFieldKeyMap(DIVERGENT_TYPE.fields),
    'paragraph--card': createFieldKeyMap(CARD_PARAGRAPH_TYPE.fields),
    'taxonomy--category': createFieldKeyMap(CATEGORY_TAXONOMY_TYPE.fields),
  }
}

function makeAdminApp() {
  const repo = createDrizzleContentRepository(db, TABLE)
  const mediaRepo = createMediaRepository(db)
  const projectors = buildProjectors(REGISTRY, makeFieldKeyMaps())

  const app = new Hono()
  registerAdminContentRoutes(
    app,
    REGISTRY,
    { [TYPE_NAME]: repo },
    projectors,
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

  // ─── Task 6: end-to-end proof — nested projection and sort mapping ─────────
  //
  // Everything above proved the TOP-LEVEL row against real Postgres. These
  // three drive the recursive projectRow walk (a resolved reference target,
  // a paragraph child row) and the split sort guard, all against real tables
  // whose columns are storage names — not a mock repo, not a hand-built app.

  it('public ?include= returns the target type labels, never its columns', async () => {
    const categoryResult = await db.execute(
      sql.raw(`INSERT INTO "${CATEGORY_TABLE}" (slug, published, blog_title)
               VALUES ('news', true, 'News') RETURNING id`)
    )
    const categoryId = (categoryResult.rows[0] as { id: string }).id

    await db.execute(
      sql`INSERT INTO ${sql.raw(`"${TABLE}"`)} (slug, published, blog_title, category_id)
          VALUES ('published-one', true, 'Hello', ${categoryId})`
    )

    const app = makePublicApp()
    const res = await app.request('/api/divergence_test/published-one?include=category')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.category.title).toBe('News')
    expect(body.data.category).not.toHaveProperty('blog_title')
  })

  it('public paragraph children return paragraph labels', async () => {
    const contentResult = await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('published-one', true, 'Hello') RETURNING id`)
    )
    const contentId = (contentResult.rows[0] as { id: string }).id

    // parent_field is seeded with the paragraph field's LABEL ('cards'), the
    // same key resolveRelationField/resolveRelationBareIds scope their SELECT
    // by (buildRelationsMap keys relations by field.name, not by column).
    await db.execute(
      sql`INSERT INTO ${sql.raw(`"${PARAGRAPH_TABLE}"`)}
          (parent_id, parent_type, parent_field, "order", blog_title)
          VALUES (${contentId}, ${TABLE}, 'cards', 0, 'One')`
    )

    // ?include=cards is required: resolveRows (repositories/content.ts) only
    // fully resolves a non-media relation when its field name is explicitly
    // included — otherwise resolveRelationBareIds hands back bare child ids
    // (see the sibling test below). This is the path that actually exercises
    // the recursive projectRow walk into a resolved paragraph row.
    const app = makePublicApp()
    const res = await app.request('/api/divergence_test/published-one?include=cards')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.cards[0].title).toBe('One')
    expect(body.data.cards[0]).not.toHaveProperty('blog_title')
  })

  it('public paragraph children NOT ?include=d come back as bare ids, left alone', async () => {
    const contentResult = await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('published-one', true, 'Hello') RETURNING id`)
    )
    const contentId = (contentResult.rows[0] as { id: string }).id

    const cardResult = await db.execute(
      sql`INSERT INTO ${sql.raw(`"${PARAGRAPH_TABLE}"`)}
          (parent_id, parent_type, parent_field, "order", blog_title)
          VALUES (${contentId}, ${TABLE}, 'cards', 0, 'One') RETURNING id`
    )
    const cardId = (cardResult.rows[0] as { id: string }).id

    // No ?include=cards this time: resolveRelationBareIds populates `cards`
    // with an array of raw child ids rather than resolved rows, and
    // projectRow's isPlainRow guard correctly leaves a string alone — there
    // is nothing to project because nothing was resolved. Pinning this so the
    // distinction from the test above is documented, not rediscovered.
    const app = makePublicApp()
    const res = await app.request('/api/divergence_test/published-one')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.cards).toEqual([cardId])
  })

  it('sorting by a label orders by the storage column', async () => {
    // Two published rows with different titles, seeded out of alphabetical
    // order — if the mapped ORDER BY were not actually applied, the response
    // would come back in insertion order and fail the equality check below.
    await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('sort-b', true, 'Zeta'), ('sort-a', true, 'Alpha')`)
    )

    const app = makePublicApp()
    const res = await app.request('/api/divergence_test?sort_by=title&sort_order=asc')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.map((r: { title: string }) => r.title)).toEqual(
      [...body.data.map((r: { title: string }) => r.title)].sort()
    )
  })
})
