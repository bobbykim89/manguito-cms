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
    registerPublicContentRoutes(app, mockRegistry, { 'blog-post': mockRepo })
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
})
