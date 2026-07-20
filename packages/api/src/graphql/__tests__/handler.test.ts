import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { buildGraphQLSchema } from '../schema'
import { createYoga } from 'graphql-yoga'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

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
