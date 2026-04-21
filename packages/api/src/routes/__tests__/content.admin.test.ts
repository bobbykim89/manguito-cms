import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { registerAdminContentRoutes } from '../admin/content'
import type {
  ContentRepository,
  MediaRepository,
  PaginatedResult,
  SchemaRegistry,
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
    {
      name: 'blog_meta_title',
      label: 'Meta Title',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 1,
      validation: { required: true },
      db_column: { column_name: 'blog_meta_title', column_type: 'varchar', nullable: false },
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

const SINGLETON_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'home-page',
  label: 'Home Page',
  source_file: 'home-page.yml',
  only_one: true,
  default_base_path: 'home-page',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', nullable: false },
  ],
  fields: [],
  ui: { tabs: [] },
  db: { table_name: 'content--home_page', junction_tables: [] },
  api: {
    default_base_path: 'home-page',
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: '/api/home-page',
  },
}

function makeEmptyPage(): PaginatedResult<unknown> {
  return {
    ok: true,
    data: [],
    meta: { total: 0, page: 1, per_page: 10, total_pages: 0, has_next: false, has_prev: false },
  }
}

function makePageWithRows(total: number): PaginatedResult<unknown> {
  return {
    ok: true,
    data: [{ id: 'existing-id' }],
    meta: { total, page: 1, per_page: 1, total_pages: 1, has_next: false, has_prev: false },
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

function makeMockMediaRepo(): MediaRepository {
  return {
    findMany: vi.fn() as unknown as MediaRepository['findMany'],
    findOne: vi.fn() as unknown as MediaRepository['findOne'],
    create: vi.fn() as unknown as MediaRepository['create'],
    update: vi.fn() as unknown as MediaRepository['update'],
    delete: vi.fn() as unknown as MediaRepository['delete'],
    incrementReferenceCount: vi.fn(),
    decrementReferenceCount: vi.fn(),
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('admin content routes', () => {
  let app: Hono
  let mockBlogRepo: ContentRepository<unknown>
  let mockSingletonRepo: ContentRepository<unknown>
  let mockMediaRepo: MediaRepository

  const registry: SchemaRegistry = {
    routes: { base_paths: [] },
    roles: { roles: [], valid_permissions: [] },
    schemas: {},
    content_types: {
      'blog-post': BLOG_TYPE,
      'home-page': SINGLETON_TYPE,
    },
    paragraph_types: {},
    taxonomy_types: {},
    enum_types: {},
    all_schemas: [],
  }

  beforeEach(() => {
    mockBlogRepo = makeMockRepo()
    mockSingletonRepo = makeMockRepo()
    mockMediaRepo = makeMockMediaRepo()
    app = new Hono()
    registerAdminContentRoutes(app, registry, {
      'blog-post': mockBlogRepo,
      'home-page': mockSingletonRepo,
    }, mockMediaRepo)
  })

  describe('PATCH — publish validation', () => {
    it('PATCH with published: true and missing required fields returns 422 PUBLISH_VALIDATION_ERROR', async () => {
      const existingItem = { id: 'item-1', blog_title: '', blog_meta_title: '', published: false }
      ;(mockBlogRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(existingItem)

      const res = await app.request('/admin/api/blog-post/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: true }),
      })

      expect(res.status).toBe(422)
      const body = await res.json() as {
        ok: boolean
        error: { code: string; details: { field: string }[] }
      }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('PUBLISH_VALIDATION_ERROR')
      expect(Array.isArray(body.error.details)).toBe(true)
      expect(body.error.details.length).toBeGreaterThan(0)
    })

    it('PATCH with published: false succeeds even when required fields are empty', async () => {
      const existingItem = { id: 'item-1', blog_title: '', blog_meta_title: '', published: true }
      const updatedItem = { ...existingItem, published: false }
      ;(mockBlogRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(existingItem)
      ;(mockBlogRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue(updatedItem)

      const res = await app.request('/admin/api/blog-post/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: false }),
      })

      expect(res.status).toBe(200)
      const body = await res.json() as { ok: boolean }
      expect(body.ok).toBe(true)
    })
  })

  describe('POST — slug validation', () => {
    it('POST with invalid slug format returns 422 INVALID_SLUG_FORMAT', async () => {
      const res = await app.request('/admin/api/blog-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'My Invalid Slug!', blog_title: 'Test' }),
      })

      expect(res.status).toBe(422)
      const body = await res.json() as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('INVALID_SLUG_FORMAT')
    })

    it('POST with duplicate slug returns 409 SLUG_CONFLICT', async () => {
      ;(mockBlogRepo.findBySlug as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'other-item' })

      const res = await app.request('/admin/api/blog-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'existing-slug', blog_title: 'Test', blog_meta_title: 'Meta' }),
      })

      expect(res.status).toBe(409)
      const body = await res.json() as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('SLUG_CONFLICT')
    })
  })

  describe('POST — singleton constraint', () => {
    it('POST to only_one type when row exists returns 409 SINGLETON_ALREADY_EXISTS', async () => {
      ;(mockSingletonRepo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        makePageWithRows(1)
      )

      const res = await app.request('/admin/api/home-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(409)
      const body = await res.json() as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('SINGLETON_ALREADY_EXISTS')
    })
  })
})
