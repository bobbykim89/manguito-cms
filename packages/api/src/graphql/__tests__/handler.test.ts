import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { buildGraphQLSchema } from '../schema'
import { createYoga } from 'graphql-yoga'
import { createGraphQLHandler, type ResolvedGraphQLOptions } from '../handler'
import * as dataloaders from '../dataloaders'
import type { SchemaRegistry, ContentRepository } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { ProgrammaticResolver } from '../../programmatic/resolve'

const registry = {
  content_types: {
    'content--post': {
      schema_type: 'content-type', name: 'content--post', label: 'Post', only_one: false,
      fields: [{ name: 'blog_title', label: 'T', field_type: 'text/plain', required: true,
        db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: false },
        ui_component: { component: 'text-input' } }],
      system_fields: [],
    },
  },
  taxonomy_types: {}, paragraph_types: {}, enum_types: {},
} as unknown as SchemaRegistry

describe('graphql handler over Hono', () => {
  it('answers a POST query', async () => {
    const rows = [{ id: '1', slug: 'hi', published: true, blog_title: 'Hello', created_at: new Date(), updated_at: new Date() }]
    const repo = { findMany: async () => ({ ok: true, data: rows, meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false } }) }
    const yoga = createYoga({
      schema: buildGraphQLSchema(registry),
      graphqlEndpoint: '/graphql',
      context: () => ({ repos: { 'content--post': repo }, programmaticMemo: new WeakMap() }),
    })
    const app = new Hono()
    app.all('/graphql', (c) => yoga.fetch(c.req.raw, {}))

    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ posts { data { blogTitle } } }' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.posts.data[0].blogTitle).toBe('Hello')
  })
})

// ─── createGraphQLHandler (the shipped factory) ────────────────────────────
//
// The tests above exercise `createYoga` built inline, never touching the
// factory. These tests drive real HTTP requests through `createGraphQLHandler`
// itself, proving its two safety-critical invariants:
//   - per-request scoping of relation loaders / programmatic memo
//   - Armor + introspection plugins actually reach Yoga
describe('createGraphQLHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const rows = [
    {
      id: '1',
      slug: 'hi',
      published: true,
      blog_title: 'Hello',
      created_at: new Date(),
      updated_at: new Date(),
    },
  ]

  function fakeRepo(): ContentRepository<unknown> {
    return {
      findMany: async () => ({
        ok: true,
        data: rows,
        meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
      }),
    } as unknown as ContentRepository<unknown>
  }

  const repos = { 'content--post': fakeRepo() }
  // Never touched by these queries — no relation fields are selected.
  const db = {} as unknown as DrizzlePostgresInstance
  const resolver = {
    hasSchema: () => false,
    resolveItem: async (_schema: string, row: Record<string, unknown>) => ({ ...row }),
    resolveList: async (_schema: string, rowsIn: Record<string, unknown>[]) =>
      rowsIn.map((r) => ({ ...r })),
  } as unknown as ProgrammaticResolver

  const baseOptions: ResolvedGraphQLOptions = {
    enabled: true,
    maxDepth: 8,
    maxComplexity: 1000,
    graphiql: false,
    introspection: true,
  }

  function buildApp(options: ResolvedGraphQLOptions): Hono {
    const handler = createGraphQLHandler(registry, repos, resolver, db, options)
    const app = new Hono()
    app.all('/graphql', handler)
    return app
  }

  async function post(app: Hono, query: string): Promise<{ status: number; body: any }> {
    const res = await app.request('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    })
    return { status: res.status, body: await res.json() }
  }

  it('answers a real query end-to-end through the shipped factory', async () => {
    const app = buildApp(baseOptions)
    const { status, body } = await post(app, '{ posts { data { blogTitle } } }')
    expect(status).toBe(200)
    expect(body.data.posts.data[0].blogTitle).toBe('Hello')
  })

  it('creates fresh relation loaders per request, not once per handler', async () => {
    const spy = vi.spyOn(dataloaders, 'createRelationLoaders')
    const app = buildApp(baseOptions)

    const first = await post(app, '{ posts { data { blogTitle } } }')
    const second = await post(app, '{ posts { data { blogTitle } } }')

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.body.data.posts.data[0].blogTitle).toBe('Hello')
    expect(second.body.data.posts.data[0].blogTitle).toBe('Hello')
    // The critical regression guard: two requests through the same handler
    // must construct two independent loader instances (context factory runs
    // per-request), not share one hoisted instance across requests.
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('blocks introspection when introspection is disabled, allows it when enabled', async () => {
    const introspectionQuery = '{ __schema { types { name } } }'

    const disabledApp = buildApp({ ...baseOptions, introspection: false })
    const disabled = await post(disabledApp, introspectionQuery)
    expect(disabled.body.errors).toBeDefined()
    expect(disabled.body.errors.length).toBeGreaterThan(0)

    const enabledApp = buildApp({ ...baseOptions, introspection: true })
    const enabled = await post(enabledApp, introspectionQuery)
    expect(enabled.body.errors).toBeUndefined()
    expect(Array.isArray(enabled.body.data.__schema.types)).toBe(true)
  })

  it('enforces Armor maxDepth limits', async () => {
    const deepQuery = '{ posts { data { blogTitle } } }'

    const shallowApp = buildApp({ ...baseOptions, maxDepth: 1 })
    const shallow = await post(shallowApp, deepQuery)
    expect(shallow.body.errors).toBeDefined()
    expect(shallow.body.errors.length).toBeGreaterThan(0)

    const deepApp = buildApp({ ...baseOptions, maxDepth: 8 })
    const deep = await post(deepApp, deepQuery)
    expect(deep.body.errors).toBeUndefined()
    expect(deep.body.data.posts.data[0].blogTitle).toBe('Hello')
  })
})
