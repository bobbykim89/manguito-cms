import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { buildGraphQLSchema } from '../schema'
import { createYoga } from 'graphql-yoga'
import { createGraphQLHandler, type ResolvedGraphQLOptions } from '../handler'
import * as dataloaders from '../dataloaders'
import type { SchemaRegistry, ContentRepository } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { ProgrammaticResolver } from '../../programmatic/resolve'
import { createFieldKeyMap, type FieldKeyMap } from '../../field-keys'

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

// This suite's only field's label already equals its column (`blog_title`), so
// this map never diverges — it exists so `createGraphQLHandler` has the same
// per-type maps `app.ts` builds at startup, not to exercise divergence itself
// (see resolvers.divergence.test.ts and filters.test.ts for that).
const fieldKeyMaps: Record<string, FieldKeyMap> = {
  'content--post': createFieldKeyMap(registry.content_types['content--post']!.fields),
}

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
    const handler = createGraphQLHandler(registry, repos, fieldKeyMaps, resolver, db, options)
    const app = new Hono()
    app.all('/graphql', handler)
    return app
  }

  // `any` on the parsed payload: these tests read arbitrary GraphQL response
  // shapes, and typing it further would mean a cast at every call site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // The realm-safe maskError must widen what reaches the client only for errors a
  // validation rule constructed. A resolver blowing up still has to be masked, or
  // driver messages and stack traces leak from a public, unauthenticated endpoint.
  it('still masks a genuine resolver failure', async () => {
    const throwingRepos = {
      'content--post': {
        findMany: async () => {
          // Deliberately not shaped like a real driver error: this surfaces in
          // the suite's stderr (Yoga logs masked faults, which is correct), and
          // a realistic "ECONNREFUSED ...:5432" there reads as a dead test
          // database rather than an assertion doing its job.
          throw new Error('SIMULATED_RESOLVER_FAILURE_EXPECTED_BY_TEST')
        },
      },
    } as unknown as Record<string, ContentRepository<unknown>>

    // Yoga logs masked faults through console.error, which is what an operator
    // needs — but left alone it dumps a stack trace into a passing run and reads
    // as a crash. Capture it, then assert on it: the log is part of the contract
    // (a masked error must still be diagnosable server-side), so silencing it
    // without asserting would lose coverage.
    const logged: unknown[][] = []
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args)
    })

    const handler = createGraphQLHandler(registry, throwingRepos, fieldKeyMaps, resolver, db, baseOptions)
    const app = new Hono()
    app.all('/graphql', handler)

    const { body } = await post(app, '{ posts { data { blogTitle } } }')
    errorSpy.mockRestore()
    const [err] = body.errors as { message: string; extensions?: { code?: string } }[]
    expect(err!.message).toBe('Unexpected error.')
    expect(err!.extensions?.code).toBe('INTERNAL_SERVER_ERROR')
    expect(JSON.stringify(body)).not.toContain('SIMULATED_RESOLVER_FAILURE')
    // Hidden from the client, but not from the operator.
    expect(JSON.stringify(logged)).toContain('SIMULATED_RESOLVER_FAILURE')
  })

  it('enforces Armor maxDepth limits', async () => {
    const deepQuery = '{ posts { data { blogTitle } } }'

    const shallowApp = buildApp({ ...baseOptions, maxDepth: 1 })
    const shallow = await post(shallowApp, deepQuery)
    expect(shallow.body.errors).toBeDefined()
    expect(shallow.body.errors.length).toBeGreaterThan(0)
    // Asserting only that *an* error came back let a masked
    // `INTERNAL_SERVER_ERROR: Unexpected error.` pass as a depth rejection. The
    // caller has to be told their query was too deep, not that the server broke.
    const [depthError] = shallow.body.errors as { message: string; extensions?: { code?: string } }[]
    expect(depthError!.message).toMatch(/depth limit/i)
    expect(depthError!.extensions?.code).not.toBe('INTERNAL_SERVER_ERROR')

    const deepApp = buildApp({ ...baseOptions, maxDepth: 8 })
    const deep = await post(deepApp, deepQuery)
    expect(deep.body.errors).toBeUndefined()
    expect(deep.body.data.posts.data[0].blogTitle).toBe('Hello')
  })
})
