import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { registerPublicContentRoutes } from '../content'
import type {
  ContentRepository,
  PaginatedResult,
  SchemaRegistry,
  FindManyOptions,
} from '@bobbykim/manguito-cms-core'
import type { ParsedContentType } from '@bobbykim/manguito-cms-core'
import { divergentTextField, divergentReferenceField } from '../../field-keys.test-fixtures'
import { createFieldKeyMap } from '../../field-keys'
import { createProgrammaticResolver } from '../../programmatic/resolve'
import { createPublicPaths } from '../../paths'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'blog-post',
  label: 'Blog Post',
  source_file: 'blog-post.yml',
  only_one: false,
  default_base_path: 'blog-post',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', nullable: false },
  ],
  fields: [
    {
      name: 'blog_title',
      label: 'Title',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: 'content--blog_post', junction_tables: [] },
  api: {
    default_base_path: 'blog-post',
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: '/api/blog-post/:slug',
  },
}

const mockRegistry: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: [], valid_permissions: [] },
  schemas: {},
  content_types: { 'blog-post': BLOG_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

function makeEmptyPage(): PaginatedResult<unknown> {
  return {
    ok: true,
    data: [],
    meta: { total: 0, page: 1, per_page: 10, total_pages: 0, has_next: false, has_prev: false },
  }
}

function makeMockRepo(): ContentRepository<unknown> {
  return {
    findMany: vi.fn().mockResolvedValue(makeEmptyPage()),
    findOne: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('public content routes', () => {
  let app: Hono
  let mockRepo: ContentRepository<unknown>

  beforeEach(() => {
    mockRepo = makeMockRepo()
    app = new Hono()
    registerPublicContentRoutes(
      app,
      mockRegistry,
      { 'blog-post': mockRepo },
      { 'blog-post': createFieldKeyMap(BLOG_TYPE.fields) },
      createPublicPaths('/api')
    )
  })

  it('public list route always calls findMany with published_only: true', async () => {
    const res = await app.request('/api/blog-post')
    expect(res.status).toBe(200)
    const calls = (mockRepo.findMany as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const opts = calls[0]![0] as FindManyOptions
    expect(opts.published_only).toBe(true)
  })

  it('page=0 returns 400 INVALID_PAGINATION', async () => {
    const res = await app.request('/api/blog-post?page=0')
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_PAGINATION')
  })

  it('per_page=101 returns 400 INVALID_PAGINATION', async () => {
    const res = await app.request('/api/blog-post?per_page=101')
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_PAGINATION')
  })

  it('unknown filter field returns 400 INVALID_FILTER_FIELD', async () => {
    const res = await app.request('/api/blog-post?filter%5Bnot_a_field%5D=value')
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_FILTER_FIELD')
  })

  it('unknown sort_by field returns 400 INVALID_SORT_FIELD', async () => {
    const res = await app.request('/api/blog-post?sort_by=not_sortable')
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_SORT_FIELD')
  })

  it('unknown include field returns 400 INVALID_INCLUDE_FIELD', async () => {
    // blog_title is text/plain (not a relation), so including it is invalid
    const res = await app.request('/api/blog-post?include=blog_title')
    expect(res.status).toBe(400)
    const body = await res.json() as { ok: boolean; error: { code: string } }
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_INCLUDE_FIELD')
  })

  it('serves public routes under a custom api.prefix', async () => {
    const repo = makeMockRepo()
    const app = new Hono()
    registerPublicContentRoutes(
      app,
      mockRegistry,
      { 'blog-post': repo },
      { 'blog-post': createFieldKeyMap(BLOG_TYPE.fields) },
      createPublicPaths('/content-api'),
      undefined,
      createProgrammaticResolver(new Map())
    )

    // BLOG_TYPE's default_base_path is 'blog-post'.
    expect((await app.request('/content-api/blog-post')).status).toBe(200)
    expect((await app.request('/api/blog-post')).status).toBe(404)
  })
})

// Same shape as this file's BLOG_TYPE, with label 'title' over column 'blog_title'.
const DIVERGENT_TYPE: ParsedContentType = {
  ...BLOG_TYPE,
  name: 'divergent-post',
  default_base_path: 'divergent-post',
  fields: [divergentTextField],
  db: { table_name: 'content--divergent_post', junction_tables: [] },
  api: {
    default_base_path: 'divergent-post',
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: '/api/divergent-post/:slug',
  },
}

const divergentRegistry: SchemaRegistry = {
  ...mockRegistry,
  content_types: { 'divergent-post': DIVERGENT_TYPE },
}

describe('public reads with a divergent field label', () => {
  it('returns the label and never the column name', async () => {
    const repo = makeMockRepo()
    ;(repo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [{ id: 'c1', slug: 'a', published: true, blog_title: 'Hello' }],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    })

    const app = new Hono()
    registerPublicContentRoutes(
      app,
      divergentRegistry,
      { 'divergent-post': repo },
      { 'divergent-post': createFieldKeyMap([divergentTextField]) },
      createPublicPaths('/api'),
      undefined,
      createProgrammaticResolver(new Map())
    )

    const res = await app.request('/api/divergent-post')
    const body = await res.json() as { ok: boolean; data: Record<string, unknown>[] }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data[0]).toMatchObject({ slug: 'a', title: 'Hello' })
    expect(body.data[0]).not.toHaveProperty('blog_title')
  })

  it('a single-item read (findBySlug) also returns the label, not the column', async () => {
    const repo = makeMockRepo()
    ;(repo.findBySlug as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'c1',
      slug: 'a',
      published: true,
      blog_title: 'Hello',
    })

    const app = new Hono()
    registerPublicContentRoutes(
      app,
      divergentRegistry,
      { 'divergent-post': repo },
      { 'divergent-post': createFieldKeyMap([divergentTextField]) },
      createPublicPaths('/api'),
      undefined,
      createProgrammaticResolver(new Map())
    )

    const res = await app.request('/api/divergent-post/a')
    const body = await res.json() as { ok: boolean; data: Record<string, unknown> }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data).toMatchObject({ slug: 'a', title: 'Hello' })
    expect(body.data).not.toHaveProperty('blog_title')
  })

  // resolveRelationBareIds (packages/api/src/relations.ts) has branches for
  // `paragraph` and `junction` only — no `reference` branch. So when a
  // reference field is NOT passed via ?include=, the repository layer never
  // touches it: the row comes back from `SELECT *` still keyed by the raw FK
  // column. This mock reproduces exactly that raw-row shape (no relation
  // resolution runs here at all — the mock repo just returns canned data), to
  // prove toLabels is what renames it on the public path.
  it('a divergent reference field, not ?include=d, surfaces under its label with its bare id', async () => {
    const REF_TYPE: ParsedContentType = {
      ...BLOG_TYPE,
      name: 'divergent-ref-post',
      default_base_path: 'divergent-ref-post',
      fields: [divergentReferenceField],
      db: { table_name: 'content--divergent_ref_post', junction_tables: [] },
      api: {
        default_base_path: 'divergent-ref-post',
        http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
        item_path: '/api/divergent-ref-post/:slug',
      },
    }
    const refRegistry: SchemaRegistry = {
      ...mockRegistry,
      content_types: { 'divergent-ref-post': REF_TYPE },
    }

    const categoryId = '11111111-1111-1111-1111-111111111111'
    const repo = makeMockRepo()
    ;(repo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [{ id: 'c1', slug: 'a', published: true, category_id: categoryId }],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    })

    const app = new Hono()
    registerPublicContentRoutes(
      app,
      refRegistry,
      { 'divergent-ref-post': repo },
      { 'divergent-ref-post': createFieldKeyMap([divergentReferenceField]) },
      createPublicPaths('/api'),
      undefined,
      createProgrammaticResolver(new Map())
    )

    // Deliberately no ?include= — this is the bare-read path the gap lives in.
    const res = await app.request('/api/divergent-ref-post')
    const body = await res.json() as { ok: boolean; data: Record<string, unknown>[] }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data[0]).toMatchObject({ slug: 'a', category: categoryId })
    expect(body.data[0]).not.toHaveProperty('category_id')
  })
})
