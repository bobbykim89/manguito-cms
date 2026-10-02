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

const BLOG = 'api_int_colid_blog'
const CAT = 'api_int_colid_cat'
const TYPE = 'colid-blog'
const MEDIA_ID = '22222222-2222-2222-2222-222222222222'
const CAT_ID = '11111111-1111-1111-1111-111111111111'

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type', name: TYPE, label: 'Column Identity Blog', source_file: 't.yml',
  only_one: false, default_base_path: TYPE,
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [
    { name: 'blog_title', label: 'Title', field_type: 'text/plain', required: false, nullable: true, order: 0,
      validation: { required: false },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' } },
    // foreign_key is what makes buildRelationsMap treat this as resolvable.
    { name: 'category', label: 'Category', field_type: 'reference', required: false, nullable: true, order: 1,
      validation: { required: false },
      db_column: { column_name: 'category_id', column_type: 'uuid', nullable: true,
        foreign_key: { table: CAT, column: 'id', on_delete: 'SET NULL' } },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'one-to-one' } },
    { name: 'hero', label: 'Hero', field_type: 'image', required: false, nullable: true, order: 2,
      validation: { required: false },
      db_column: { column_name: 'blog_hero_image', column_type: 'uuid', nullable: true },
      ui_component: { component: 'file-upload', accepted_mime_types: [] } },
  ],
  ui: { tabs: [] },
  db: { table_name: BLOG, junction_tables: [] },
  api: { default_base_path: TYPE, http_methods: ['GET'], item_path: `/api/${TYPE}/:slug` },
}

const ROLES: ParsedRole[] = ['admin', 'manager', 'editor', 'writer', 'viewer'].map((name, i) => ({
  name, label: name, is_system: true, hierarchy_level: i, permissions: [],
}))

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] }, roles: { roles: ROLES, valid_permissions: [] }, schemas: {},
  content_types: { [TYPE]: BLOG_TYPE }, paragraph_types: {}, taxonomy_types: {}, enum_types: {},
  all_schemas: [],
}

const col = (column_name: string, exposed_as: string) => ({ column_name, exposed_as, required: false })

// v1 renames both relations. v3 is current: every label equals the registry
// name, because buildProjections derives current's exposed_as from f.name.
const MODEL: BakedVersionModel = {
  current: 'v3',
  live: ['v1', 'v3'],
  projections: {
    v1: { version: 'v1', types: { [TYPE]: { fields: [
      col('blog_title', 'blog_title'), col('category_id', 'legacy_cat'), col('blog_hero_image', 'legacy_hero'),
    ] } } },
    v3: { version: 'v3', types: { [TYPE]: { fields: [
      col('blog_title', 'blog_title'), col('category_id', 'category'), col('blog_hero_image', 'hero'),
    ] } } },
  },
}

const pg = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pg.connect()
  db = pg.getDb()
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${CAT}" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR NOT NULL,
    published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())`))
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${BLOG}" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug VARCHAR NOT NULL UNIQUE,
    published BOOLEAN NOT NULL DEFAULT false, blog_title VARCHAR, category_id UUID, blog_hero_image UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())`))
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${BLOG}" CASCADE`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${CAT}" CASCADE`))
  await db.execute(sql.raw(`DELETE FROM media WHERE id = '${MEDIA_ID}'`))
  await pg.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE "${BLOG}", "${CAT}"`))
  // The real media table comes from globalSetup's migrations and has no
  // default on `type`, so it must be supplied.
  await db.execute(sql.raw(`DELETE FROM media WHERE id = '${MEDIA_ID}'`))
  await db.execute(sql.raw(`INSERT INTO media (id, type, url, mime_type, file_size)
    VALUES ('${MEDIA_ID}', 'image', 'https://x/hero.png', 'image/png', 10)`))
  await db.execute(sql.raw(`INSERT INTO "${CAT}" (id, name) VALUES ('${CAT_ID}', 'Cat One')`))
  await db.execute(sql.raw(`INSERT INTO "${BLOG}" (slug, published, blog_title, category_id, blog_hero_image)
    VALUES ('post-1', true, 'Hello', '${CAT_ID}', '${MEDIA_ID}')`))
})

function app() {
  return createCmsApp({ storage: createLocalAdapter(), registry: REGISTRY, db, versions: MODEL }).app
}

type Row = Record<string, unknown>
async function get(path: string): Promise<{ status: number; row: Row | undefined; error: { code: string } | undefined }> {
  const res = await app().request(path)
  const body = (await res.json()) as { data?: Row[] | Row; error?: { code: string } }
  const row = Array.isArray(body.data) ? body.data[0] : body.data
  return { status: res.status, row, error: body.error }
}

describe('column as identity — media on an older version (#1a)', () => {
  it('serves a renamed media field on v1 under v1\'s label, resolved', async () => {
    // The probe's headline: today `legacy_hero` is simply absent.
    // MUTATION: restore the name-keyed media write in resolveRelationField.
    const { status, row } = await get(`/api/v1/${TYPE}`)

    expect(status).toBe(200)
    expect(row).toHaveProperty('legacy_hero')
    expect((row!['legacy_hero'] as { url?: string }).url).toBe('https://x/hero.png')
    expect(row).not.toHaveProperty('hero')
    expect(row).not.toHaveProperty('blog_hero_image')
  })

  it('still serves the media field on current, unchanged', async () => {
    // The byte-identical claim for current, at the response level.
    const { row } = await get(`/api/v3/${TYPE}`)

    expect((row!['hero'] as { url?: string }).url).toBe('https://x/hero.png')
    expect(row).not.toHaveProperty('legacy_hero')
  })

  it('serves a null media relation on v1 as a present null key', async () => {
    // Review Focus #1, end to end.
    // MUTATION: restore the empty-FK path's `delete row[rel.fk_column]`.
    await db.execute(sql.raw(`UPDATE "${BLOG}" SET blog_hero_image = NULL`))
    const { row } = await get(`/api/v1/${TYPE}`)

    expect(row).toHaveProperty('legacy_hero', null)
  })
})
