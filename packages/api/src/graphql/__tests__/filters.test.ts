import { describe, it, expect } from 'vitest'
import { GraphQLObjectType, GraphQLSchema, GraphQLString as GraphQLStringType } from 'graphql'
import type { ParsedContentType } from '@bobbykim/manguito-cms-core'
import { buildFieldNameMap } from '../naming'
import { SortOrderEnum, buildSortFieldEnum, translateFilters, buildFilterInputType } from '../filters'

describe('sort enums', () => {
  it('SortOrderEnum has ASC/DESC', () => {
    expect(SortOrderEnum.getValues().map((v) => v.name).sort()).toEqual(['ASC', 'DESC'])
  })

  it('sort field enum maps camelCase names to snake_case columns', () => {
    const e = buildSortFieldEnum('BlogPost')
    const created = e.getValue('createdAt')
    expect(created?.value).toBe('created_at')
    expect(e.getValue('title')?.value).toBe('title')
  })
})

describe('translateFilters', () => {
  const nameMap = buildFieldNameMap(['created_at', 'blog_title'])

  it('translates eq / in / operators to repo filters keyed by column', () => {
    const result = translateFilters(
      {
        blogTitle: { eq: 'Hello' },
        createdAt: { gt: '2026-01-01', lte: '2026-12-31' },
        category: { in: ['a', 'b'] },
      },
      nameMap
    )
    expect(result).toEqual({
      blog_title: 'Hello',
      created_at: { gt: '2026-01-01', lte: '2026-12-31' },
      category: ['a', 'b'],
    })
  })

  it('returns an empty object for undefined input', () => {
    expect(translateFilters(undefined, nameMap)).toEqual({})
  })
})

describe('buildFilterInputType', () => {
  it('builds a filter input usable in a schema without type-name collisions', () => {
    const type = {
      schema_type: 'content-type',
      name: 'content--post',
      label: 'Post',
      fields: [
        {
          name: 'views',
          field_type: 'integer',
          required: false,
          db_column: { column_name: 'views' },
          ui_component: { component: 'number-input', step: 1 },
        },
        {
          name: 'likes',
          field_type: 'integer',
          required: false,
          db_column: { column_name: 'likes' },
          ui_component: { component: 'number-input', step: 1 },
        },
      ],
    } as unknown as ParsedContentType

    const filter = buildFilterInputType(type)
    expect(filter).not.toBeNull()

    // Constructing a schema that references the filter enforces GraphQL type-name uniqueness
    // (this is what surfaces the IntFilter/FloatFilter singleton bug).
    const q = new GraphQLObjectType({
      name: 'Query',
      fields: { posts: { type: GraphQLStringType, args: { filter: { type: filter! } } } },
    })
    expect(() => new GraphQLSchema({ query: q })).not.toThrow()

    expect(filter!.getFields()['views']).toBeDefined()
    expect(filter!.getFields()['likes']).toBeDefined()
  })
})
