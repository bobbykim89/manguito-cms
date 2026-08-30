import { describe, it, expect } from 'vitest'
import { graphql } from 'graphql'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { buildGraphQLSchema } from '../schema'
import type { GraphQLContext } from '../context'
import { createFieldKeyMap } from '../../field-keys'
import { divergentTargetType } from '../../field-keys.test-fixtures'

// Divergence proofs that run through the whole built schema rather than a
// single resolver. The sibling resolvers.divergence.test.ts calls resolvers
// directly; these two cases only exist once buildGraphQLSchema has wired a
// type's FieldKeyMap into the resolver it creates, so they must execute a real
// query to prove anything.

// ─── sortBy: an enum value that is a LABEL, not a column ──────────────────────
//
// The sort enum's internal values mix key spaces: `created_at` / `updated_at`
// are system columns, but `title` is a schema field's label. Under divergence
// handing `title` straight to the repository produces `ORDER BY "title"`
// against column `blog_title` — a Postgres error surfacing as a 500.
//
// divergentTargetType is exactly the shape needed: a content type whose only
// field is label `title` over column `blog_title`.
const sortRegistry = {
  content_types: { 'content--category': divergentTargetType },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

function capturingCtx(captured: { opts?: Record<string, unknown> }): GraphQLContext {
  const repo = {
    findMany: async (opts: Record<string, unknown>) => {
      captured.opts = opts
      return {
        data: [],
        meta: { total: 0, page: 1, per_page: 10, total_pages: 0, has_next: false, has_prev: false },
      }
    },
  }
  return { repos: { 'content--category': repo } } as unknown as GraphQLContext
}

describe('GraphQL sortBy with a divergent label', () => {
  const query = '{ categories(sortBy: title) { meta { total } } }'

  it('orders by the storage column, not the label', async () => {
    const schema = buildGraphQLSchema(sortRegistry, {
      'content--category': createFieldKeyMap(divergentTargetType.fields),
    })
    const captured: { opts?: Record<string, unknown> } = {}

    const result = await graphql({ schema, source: query, contextValue: capturingCtx(captured) })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['sort_by']).toBe('blog_title')
  })

  it('leaves a system column alone — it is not a label and has no mapping', async () => {
    const schema = buildGraphQLSchema(sortRegistry, {
      'content--category': createFieldKeyMap(divergentTargetType.fields),
    })
    const captured: { opts?: Record<string, unknown> } = {}

    const result = await graphql({
      schema,
      source: '{ categories(sortBy: createdAt) { meta { total } } }',
      contextValue: capturingCtx(captured),
    })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['sort_by']).toBe('created_at')
  })

  it('passes the value through unchanged when no field key map is supplied', async () => {
    const schema = buildGraphQLSchema(sortRegistry)
    const captured: { opts?: Record<string, unknown> } = {}

    const result = await graphql({ schema, source: query, contextValue: capturingCtx(captured) })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['sort_by']).toBe('title')
  })
})
