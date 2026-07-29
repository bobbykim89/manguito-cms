import { describe, it, expect } from 'vitest'
import { graphql, printSchema } from 'graphql'
import { buildGraphQLSchema } from '../schema'
import type { GraphQLContext } from '../context'
import type { SchemaRegistry } from '@bobbykim/manguito-cms-core'

// Minimal registry: one content type "post" with a text field and a date system field.
const registry = {
  content_types: {
    'content--post': {
      schema_type: 'content-type',
      name: 'content--post',
      label: 'Post',
      only_one: false,
      fields: [
        {
          name: 'blog_title',
          label: 'Title',
          field_type: 'text/plain',
          required: true,
          db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: false },
          ui_component: { component: 'text-input' },
        },
      ],
      system_fields: [],
    },
  },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

function fakeCtx(rows: Record<string, unknown>[]): GraphQLContext {
  const repo = {
    findMany: async () => ({ ok: true, data: rows, meta: { total: rows.length, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false } }),
    findBySlug: async (slug: string) => rows.find((r) => r['slug'] === slug) ?? null,
  }
  return {
    repos: { 'content--post': repo as never },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('buildGraphQLSchema', () => {
  it('exposes camelCase types and queries', () => {
    const sdl = printSchema(buildGraphQLSchema(registry))
    expect(sdl).toContain('type Post')
    expect(sdl).toContain('posts(')
    expect(sdl).toContain('post(slug: String!): Post')
    expect(sdl).toContain('blogTitle')
    expect(sdl).toContain('createdAt: DateTime')
  })

  it('builds multiple types across content and taxonomy namespaces', () => {
    const multiRegistry = {
      content_types: {
        'content--post': {
          schema_type: 'content-type',
          name: 'content--post',
          label: 'Post',
          only_one: false,
          fields: [],
          system_fields: [],
        },
      },
      taxonomy_types: {
        'taxonomy--category': {
          schema_type: 'taxonomy-type',
          name: 'taxonomy--category',
          label: 'Category',
          fields: [],
          system_fields: [],
        },
      },
      paragraph_types: {},
      enum_types: {},
    } as unknown as SchemaRegistry

    const sdl = printSchema(buildGraphQLSchema(multiRegistry))
    expect(sdl).toContain('type Post')
    expect(sdl).toContain('type Category')
    expect(sdl).toContain('posts(')
    expect(sdl).toContain('categories(')
  })

  it('throws a clear error when two schemas produce the same GraphQL type name', () => {
    const collidingRegistry = {
      content_types: {
        'content--author': {
          schema_type: 'content-type',
          name: 'content--author',
          label: 'Author',
          only_one: false,
          fields: [],
          system_fields: [],
        },
      },
      taxonomy_types: {
        'taxonomy--author': {
          schema_type: 'taxonomy-type',
          name: 'taxonomy--author',
          label: 'Author',
          fields: [],
          system_fields: [],
        },
      },
      paragraph_types: {},
      enum_types: {},
    } as unknown as SchemaRegistry

    expect(() => buildGraphQLSchema(collidingRegistry)).toThrow(/Author/)
    expect(() => buildGraphQLSchema(collidingRegistry)).toThrow(/content--author/)
    expect(() => buildGraphQLSchema(collidingRegistry)).toThrow(/taxonomy--author/)
  })

  it('resolves a list query mapping snake_case rows to camelCase fields', async () => {
    const schema = buildGraphQLSchema(registry)
    const rows = [{ id: '1', slug: 'hi', published: true, blog_title: 'Hello', created_at: new Date('2026-07-19T00:00:00Z') }]
    const result = await graphql({
      schema,
      source: `{ posts { data { blogTitle createdAt } meta { total perPage } } }`,
      contextValue: fakeCtx(rows),
    })
    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({
      posts: { data: [{ blogTitle: 'Hello', createdAt: '2026-07-19T00:00:00.000Z' }], meta: { total: 1, perPage: 10 } },
    })
  })
})
