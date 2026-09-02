import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import type {
  ParsedContentType,
  ParsedField,
  ParsedParagraphType,
  ParsedTaxonomyType,
  SchemaRegistry,
} from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import { registerSchemaRoute } from '../schema'

// `/admin/api/schema` never touches the DB — only `/admin/api/content` and
// `/admin/api/taxonomy` do, for item counts — so a mock is fine here.
const mockDb = {} as unknown as DrizzlePostgresInstance

// A live field and a tombstone with distinct name/column, so a test can tell
// whether the endpoint is keying its filter off `removed` rather than
// something that happens to coincide when name === column.
const liveField: ParsedField = {
  name: 'title',
  label: 'Title',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 0,
  validation: { required: false },
  db_column: { column_name: 'title', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

const tombstoneField: ParsedField = {
  name: 'legacy_desc',
  label: 'Legacy Description',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 1,
  validation: { required: false },
  db_column: { column_name: 'blog_desc', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
  removed: true,
}

const FIELDS = [liveField, tombstoneField]

const CONTENT_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'blog_post',
  label: 'Blog Post',
  source_file: 'content--blog_post.json',
  only_one: false,
  default_base_path: 'blog',
  system_fields: [],
  fields: FIELDS,
  ui: { tabs: [] },
  db: { table_name: 'content_blog_post', junction_tables: [] },
  api: {
    default_base_path: 'blog',
    http_methods: ['GET'],
    item_path: '/api/blog/:slug',
  },
}

const TAXONOMY_TYPE: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'category',
  label: 'Category',
  source_file: 'taxonomy--category.json',
  system_fields: [],
  fields: FIELDS,
  db: { table_name: 'taxonomy_category' },
  api: { collection_path: '/api/category', item_path: '/api/category/:slug' },
}

const PARAGRAPH_TYPE: ParsedParagraphType = {
  schema_type: 'paragraph-type',
  name: 'paragraph--card',
  label: 'Card',
  source_file: 'paragraph--card.json',
  system_fields: [],
  fields: FIELDS,
  db: { table_name: 'paragraph_card' },
}

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: [], valid_permissions: [] },
  schemas: {},
  content_types: { blog_post: CONTENT_TYPE },
  taxonomy_types: { category: TAXONOMY_TYPE },
  paragraph_types: { 'paragraph--card': PARAGRAPH_TYPE },
  enum_types: {},
  all_schemas: [],
}

function buildApp() {
  const app = new Hono()
  registerSchemaRoute(app, REGISTRY, mockDb)
  return app
}

type SchemaResponse = {
  ok: true
  data: {
    content_types: Array<{ name: string; fields: ParsedField[] }>
    taxonomy_types: Array<{ name: string; fields: ParsedField[] }>
    paragraph_types: Array<{ name: string; fields: ParsedField[] }>
  }
}

async function getSchema(app: Hono): Promise<SchemaResponse> {
  const res = await app.request('/admin/api/schema')
  return (await res.json()) as SchemaResponse
}

describe('GET /admin/api/schema — tombstone exclusion', () => {
  it('omits a tombstone from a content type\'s fields', async () => {
    const { data } = await getSchema(buildApp())
    const ct = data.content_types.find((c) => c.name === 'blog_post')!
    expect(ct.fields.map((f) => f.name)).toEqual(['title'])
  })

  it('omits a tombstone from a taxonomy type\'s fields', async () => {
    const { data } = await getSchema(buildApp())
    const tt = data.taxonomy_types.find((t) => t.name === 'category')!
    expect(tt.fields.map((f) => f.name)).toEqual(['title'])
  })

  it('omits a tombstone from a paragraph type\'s fields', async () => {
    const { data } = await getSchema(buildApp())
    const pt = data.paragraph_types.find((p) => p.name === 'paragraph--card')!
    expect(pt.fields.map((f) => f.name)).toEqual(['title'])
  })

  it('leaves the live field fully intact', async () => {
    const { data } = await getSchema(buildApp())
    const ct = data.content_types.find((c) => c.name === 'blog_post')!
    expect(ct.fields).toEqual([liveField])
  })
})
