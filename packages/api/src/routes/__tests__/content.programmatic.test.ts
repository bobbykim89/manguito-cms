import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { programmaticField } from '@bobbykim/manguito-cms-core'
import type {
  ContentRepository,
  ParsedContentType,
  SchemaRegistry,
  PaginatedResult,
} from '@bobbykim/manguito-cms-core'
import { registerPublicContentRoutes } from '../content'
import { createProgrammaticResolver, resolverKey } from '../../programmatic/resolve.js'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BLOG: ParsedContentType = {
  schema_type: 'content-type',
  name: 'content--blog_post',
  label: 'Blog Post',
  source_file: 'x.json',
  only_one: false,
  default_base_path: 'blog',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', nullable: false },
  ],
  fields: [
    {
      name: 'title',
      label: 'Title',
      field_type: 'text/plain',
      required: true,
      nullable: false,
      order: 0,
      validation: { required: true },
      db_column: { column_name: 'title', column_type: 'varchar', nullable: false },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'summary',
      label: 'Summary',
      field_type: 'programmatic',
      required: false,
      nullable: true,
      order: 1,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'computed-display' },
    },
    {
      name: 'live',
      label: 'Live',
      field_type: 'programmatic',
      required: false,
      nullable: true,
      order: 2,
      validation: { required: false },
      db_column: null,
      ui_component: { component: 'computed-display' },
    },
  ],
  ui: { tabs: [] },
  db: { table_name: 'content_blog_post', junction_tables: [] },
  api: { default_base_path: 'blog', http_methods: ['GET'], collection_path: '/api/blog', item_path: '/api/blog/:slug' },
}

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: [], valid_permissions: [] },
  schemas: {},
  content_types: { 'content--blog_post': BLOG },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

function makePage(rows: Record<string, unknown>[]): PaginatedResult<unknown> {
  return {
    ok: true,
    data: rows,
    meta: {
      total: rows.length,
      page: 1,
      per_page: 10,
      total_pages: 1,
      has_next: false,
      has_prev: false,
    },
  }
}

function repoWith(rows: Record<string, unknown>[]): ContentRepository<unknown> {
  return {
    findMany: async () => makePage(rows),
    findOne: async (id: string) => rows.find((r) => r['id'] === id) ?? null,
    findBySlug: async (slug: string) => rows.find((r) => r['slug'] === slug) ?? null,
    findAll: async () => rows,
    create: async () => {
      throw new Error('unused')
    },
    update: async () => {
      throw new Error('unused')
    },
    delete: async () => {
      throw new Error('unused')
    },
  }
}

function resolverFor() {
  const summary = programmaticField(
    { schema: 'content--blog_post', field: 'summary' },
    (ctx) => `S:${ctx.get('title')}`
  )
  const live = programmaticField(
    { schema: 'content--blog_post', field: 'live', on_list: true },
    () => 'L'
  )
  const map = new Map([
    [resolverKey('content--blog_post', 'summary'), summary],
    [resolverKey('content--blog_post', 'live'), live],
  ])
  return createProgrammaticResolver(map)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('programmatic resolution in public routes', () => {
  it('resolves all programmatic fields on a detail read', async () => {
    const app = new Hono()
    const rows = [{ id: '1', slug: 'a', title: 'Hi', published: true }]
    registerPublicContentRoutes(
      app,
      REGISTRY,
      { 'content--blog_post': repoWith(rows) },
      undefined,
      resolverFor()
    )
    const res = await app.request('/api/blog/a')
    const body = (await res.json()) as { data: Record<string, unknown> }
    expect(body.data['summary']).toBe('S:Hi')
    expect(body.data['live']).toBe('L')
  })

  it('resolves only on_list fields on a list read', async () => {
    const app = new Hono()
    const rows = [{ id: '1', slug: 'a', title: 'Hi', published: true }]
    registerPublicContentRoutes(
      app,
      REGISTRY,
      { 'content--blog_post': repoWith(rows) },
      undefined,
      resolverFor()
    )
    const res = await app.request('/api/blog')
    const body = (await res.json()) as { data: Record<string, unknown>[] }
    expect(body.data[0]?.['live']).toBe('L')
    expect(body.data[0]?.['summary']).toBeUndefined()
  })

  it('rejects a filter on a programmatic field with 400', async () => {
    const app = new Hono()
    registerPublicContentRoutes(
      app,
      REGISTRY,
      { 'content--blog_post': repoWith([]) },
      undefined,
      resolverFor()
    )
    const res = await app.request('/api/blog?filter[summary]=x')
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_FILTER_FIELD')
  })
})
