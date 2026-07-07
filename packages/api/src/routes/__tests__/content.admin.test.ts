import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { registerAdminContentRoutes } from '../admin/content'
import type {
  ContentRepository,
  MediaRepository,
  PaginatedResult,
  SchemaRegistry,
} from '@bobbykim/manguito-cms-core'
import type { ParsedContentType, ParsedTaxonomyType } from '@bobbykim/manguito-cms-core'
import type { createPermissionMiddleware } from '../../middleware/permission'

// This suite exercises route business logic directly (validation, media/paragraph
// wiring), not permission enforcement — that's covered by the admin integration
// suite. Stand in for the real requirePermission with an always-allow middleware
// so it isn't the no-op shim (removed — Finding #6) but still lets requests through.
const noopRequirePermission: ReturnType<typeof createPermissionMiddleware> = () => async (_c, next) =>
  next()

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

const MEDIA_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: 'page-with-image',
  label: 'Page With Image',
  source_file: 'page-with-image.yml',
  only_one: false,
  default_base_path: 'page-with-image',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', nullable: false },
  ],
  fields: [
    {
      name: 'hero_image',
      label: 'Hero Image',
      field_type: 'image',
      required: false,
      nullable: true,
      order: 0,
      validation: { required: false },
      db_column: { column_name: 'hero_image', column_type: 'uuid', nullable: true },
      ui_component: { component: 'file-upload', accepted_mime_types: ['image/*'] },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: 'content--page_with_image', junction_tables: [] },
  api: {
    default_base_path: 'page-with-image',
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: '/api/page-with-image/:slug',
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

const CATEGORY_TYPE: ParsedTaxonomyType = {
  schema_type: 'taxonomy-type',
  name: 'category',
  label: 'Category',
  source_file: 'category.yml',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', nullable: false },
  ],
  fields: [
    {
      name: 'label',
      label: 'Label',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'label', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
  ],
  db: { table_name: 'taxonomy_category' },
  api: {
    collection_path: '/api/taxonomy/category',
    item_path: '/api/taxonomy/category/:id',
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
  let mockMediaTypeRepo: ContentRepository<unknown>
  let mockCategoryRepo: ContentRepository<unknown>
  let mockMediaRepo: MediaRepository

  const registry: SchemaRegistry = {
    routes: { base_paths: [] },
    roles: { roles: [], valid_permissions: [] },
    schemas: {},
    content_types: {
      'blog-post': BLOG_TYPE,
      'home-page': SINGLETON_TYPE,
      'page-with-image': MEDIA_TYPE,
    },
    paragraph_types: {},
    taxonomy_types: {
      category: CATEGORY_TYPE,
    },
    enum_types: {},
    all_schemas: [],
  }

  beforeEach(() => {
    mockBlogRepo = makeMockRepo()
    mockSingletonRepo = makeMockRepo()
    mockMediaTypeRepo = makeMockRepo()
    mockCategoryRepo = makeMockRepo()
    mockMediaRepo = makeMockMediaRepo()
    app = new Hono()
    registerAdminContentRoutes(app, registry, {
      'blog-post': mockBlogRepo,
      'home-page': mockSingletonRepo,
      'page-with-image': mockMediaTypeRepo,
      category: mockCategoryRepo,
    }, mockMediaRepo, noopRequirePermission)
  })

  describe('PATCH — publish validation', () => {
    it('PATCH with published: true and missing required fields returns 422 PUBLISH_VALIDATION_ERROR', async () => {
      const existingItem = { id: 'item-1', blog_title: '', blog_meta_title: '', published: false }
      ;(mockBlogRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(existingItem)

      const res = await app.request('/admin/api/content/blog-post/item-1', {
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

      const res = await app.request('/admin/api/content/blog-post/item-1', {
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
      const res = await app.request('/admin/api/content/blog-post', {
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

      const res = await app.request('/admin/api/content/blog-post', {
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

  describe('GET — search', () => {
    it('passes the search term, text/plain columns, and slug through to repo.findMany', async () => {
      const res = await app.request('/admin/api/content/blog-post?search=hello')

      expect(res.status).toBe(200)
      expect(mockBlogRepo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          search: { term: 'hello', columns: ['blog_title', 'blog_meta_title', 'slug'] },
        })
      )
    })

    it('omits search from findMany options when the param is absent', async () => {
      const res = await app.request('/admin/api/content/blog-post')

      expect(res.status).toBe(200)
      const callArgs = (mockBlogRepo.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      expect(callArgs.search).toBeUndefined()
    })

    it('omits slug for singleton types, which have no slug column', async () => {
      const res = await app.request('/admin/api/content/home-page?search=hello')

      expect(res.status).toBe(200)
      const callArgs = (mockSingletonRepo.findMany as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      expect(callArgs.search).toBeUndefined()
    })
  })

  describe('media reference counting — top-level image field', () => {
    it('POST with an image set increments that media id', async () => {
      ;(mockMediaTypeRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'page-1',
        hero_image: 'media-a',
      })

      const res = await app.request('/admin/api/content/page-with-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'page-1', hero_image: 'media-a' }),
      })

      expect(res.status).toBe(201)
      expect(mockMediaRepo.incrementReferenceCount).toHaveBeenCalledWith(['media-a'])
      expect(mockMediaRepo.decrementReferenceCount).not.toHaveBeenCalled()
    })

    it('POST with no image set does not touch reference counts', async () => {
      ;(mockMediaTypeRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'page-1',
        hero_image: null,
      })

      const res = await app.request('/admin/api/content/page-with-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'page-1' }),
      })

      expect(res.status).toBe(201)
      expect(mockMediaRepo.incrementReferenceCount).not.toHaveBeenCalled()
      expect(mockMediaRepo.decrementReferenceCount).not.toHaveBeenCalled()
    })

    it('PATCH replacing the image decrements the old id and increments the new one', async () => {
      ;(mockMediaTypeRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'page-1',
        hero_image: 'media-old',
      })
      ;(mockMediaTypeRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        hero_image: 'media-new',
      })

      const res = await app.request('/admin/api/content/page-with-image/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hero_image: 'media-new' }),
      })

      expect(res.status).toBe(200)
      expect(mockMediaRepo.decrementReferenceCount).toHaveBeenCalledWith(['media-old'])
      expect(mockMediaRepo.incrementReferenceCount).toHaveBeenCalledWith(['media-new'])
    })

    it('PATCH resending the same image id is a no-op for reference counts', async () => {
      ;(mockMediaTypeRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'page-1',
        hero_image: 'media-a',
      })
      ;(mockMediaTypeRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        hero_image: 'media-a',
      })

      const res = await app.request('/admin/api/content/page-with-image/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hero_image: 'media-a' }),
      })

      expect(res.status).toBe(200)
      expect(mockMediaRepo.incrementReferenceCount).not.toHaveBeenCalled()
      expect(mockMediaRepo.decrementReferenceCount).not.toHaveBeenCalled()
    })

    it('PATCH clearing the image only decrements the old id', async () => {
      ;(mockMediaTypeRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'page-1',
        hero_image: 'media-old',
      })
      ;(mockMediaTypeRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        hero_image: null,
      })

      const res = await app.request('/admin/api/content/page-with-image/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hero_image: null }),
      })

      expect(res.status).toBe(200)
      expect(mockMediaRepo.decrementReferenceCount).toHaveBeenCalledWith(['media-old'])
      expect(mockMediaRepo.incrementReferenceCount).not.toHaveBeenCalled()
    })

    it('PATCH not touching the image field does not change reference counts', async () => {
      ;(mockMediaTypeRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'page-1',
        hero_image: 'media-a',
      })
      ;(mockMediaTypeRepo.update as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'page-1-renamed',
      })

      const res = await app.request('/admin/api/content/page-with-image/item-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'page-1-renamed' }),
      })

      expect(res.status).toBe(200)
      expect(mockMediaRepo.incrementReferenceCount).not.toHaveBeenCalled()
      expect(mockMediaRepo.decrementReferenceCount).not.toHaveBeenCalled()
    })
  })

  describe('POST — publish gate (Finding #11)', () => {
    // Mimics the real createPermissionMiddleware's denial shape (see
    // middleware/permission.ts) but allows every permission except content:edit —
    // there is no fixture role with content:create and not content:edit (all real
    // roles hold both, or neither), so the gate can only be proven at this level.
    // (Both the content and taxonomy create/update paths use content:edit as the
    // publish permission, so this single stub exercises both surfaces.)
    const selectiveRequirePermission: ReturnType<typeof createPermissionMiddleware> =
      (permission) => async (c, next) => {
        if (permission === 'content:edit') {
          return c.json(
            {
              ok: false,
              error: { code: 'INSUFFICIENT_PERMISSION', message: 'Insufficient permission' },
            },
            403
          )
        }
        return next()
      }

    function makeCreateOnlyApp(): Hono {
      const createOnlyApp = new Hono()
      registerAdminContentRoutes(createOnlyApp, registry, {
        'blog-post': mockBlogRepo,
        'home-page': mockSingletonRepo,
        'page-with-image': mockMediaTypeRepo,
        category: mockCategoryRepo,
      }, mockMediaRepo, selectiveRequirePermission)
      return createOnlyApp
    }

    it('POST content with published: true is denied without content:edit', async () => {
      const res = await makeCreateOnlyApp().request('/admin/api/content/blog-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'draft-attempt',
          blog_title: 'Test',
          blog_meta_title: 'Meta',
          published: true,
        }),
      })

      expect(res.status).toBe(403)
      const body = await res.json() as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
      expect(mockBlogRepo.create).not.toHaveBeenCalled()
    })

    it('POST content with published: false succeeds under the same selective stub', async () => {
      ;(mockBlogRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'item-1',
        slug: 'draft-attempt',
        blog_title: 'Test',
        blog_meta_title: 'Meta',
        published: false,
      })

      const res = await makeCreateOnlyApp().request('/admin/api/content/blog-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: 'draft-attempt',
          blog_title: 'Test',
          blog_meta_title: 'Meta',
          published: false,
        }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as { ok: boolean }
      expect(body.ok).toBe(true)
    })

    it('POST taxonomy with published: true is denied without content:edit', async () => {
      const res = await makeCreateOnlyApp().request('/admin/api/taxonomy/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'News', published: true }),
      })

      expect(res.status).toBe(403)
      const body = await res.json() as { ok: boolean; error: { code: string } }
      expect(body.ok).toBe(false)
      expect(body.error.code).toBe('INSUFFICIENT_PERMISSION')
      expect(mockCategoryRepo.create).not.toHaveBeenCalled()
    })

    it('POST taxonomy with published: false succeeds under the same selective stub', async () => {
      ;(mockCategoryRepo.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: 'term-1',
        label: 'News',
        published: false,
      })

      const res = await makeCreateOnlyApp().request('/admin/api/taxonomy/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'News', published: false }),
      })

      expect(res.status).toBe(201)
      const body = await res.json() as { ok: boolean }
      expect(body.ok).toBe(true)
    })
  })

  describe('POST — singleton constraint', () => {
    it('POST to only_one type when row exists returns 409 SINGLETON_ALREADY_EXISTS', async () => {
      ;(mockSingletonRepo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        makePageWithRows(1)
      )

      const res = await app.request('/admin/api/content/home-page', {
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
