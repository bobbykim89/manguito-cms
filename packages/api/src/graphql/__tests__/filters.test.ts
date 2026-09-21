import { describe, it, expect } from 'vitest'
import { GraphQLObjectType, GraphQLSchema, GraphQLString as GraphQLStringType } from 'graphql'
import type { ParsedContentType } from '@bobbykim/manguito-cms-core'
import { buildFieldNameMap } from '../naming'
import { SortOrderEnum, buildSortFieldEnum, translateFilters, buildFilterInputType } from '../filters'
import { createFieldKeyMap } from '../../field-keys'
import { divergentTextField, identityTextField } from '../../field-keys.test-fixtures'

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

  it('emits the storage column, not the label', () => {
    const nameMap = { toSchema: (g: string) => (g === 'title' ? 'title' : g) }
    const columnFor = (label: string) => (label === 'title' ? 'blog_title' : undefined)
    const out = translateFilters({ title: { eq: 'Hello' } }, nameMap, columnFor)
    expect(out).toEqual({ blog_title: 'Hello' })
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

describe('buildSortFieldEnum — version awareness', () => {
  it('offers title when the version exposes that label', () => {
    // divergentTextField's label IS 'title' (over column blog_title), so
    // columnFor('title') resolves and the value is legitimately sortable.
    const keys = createFieldKeyMap([divergentTextField])
    const values = buildSortFieldEnum('Category', keys).getValues().map((v) => v.name)

    expect(values).toContain('title')
    expect(values).toContain('createdAt')
    expect(values).toContain('updatedAt')
  })

  it('omits title when the version cannot resolve that label to a column', () => {
    // identityTextField is label `summary`. Nothing on this type is named
    // `title`, so offering it would hand the repository a label that maps to
    // no column — 2d's inbound bug, in enum form.
    const keys = createFieldKeyMap([identityTextField])
    const values = buildSortFieldEnum('Category', keys).getValues().map((v) => v.name)

    expect(values).not.toContain('title')
    expect(values).toEqual(['createdAt', 'updatedAt'])
  })

  it('keeps title when no field key map is supplied', () => {
    // Back-compatibility: schema.divergence.test.ts calls buildGraphQLSchema
    // with no maps and asserts `sortBy: title` passes through unchanged.
    const values = buildSortFieldEnum('Category').getValues().map((v) => v.name)
    expect(values).toContain('title')
  })

  it('never yields an empty enum, which GraphQL would reject', () => {
    const keys = createFieldKeyMap([])
    expect(buildSortFieldEnum('Category', keys).getValues().length).toBeGreaterThan(0)
  })
})

describe('buildFilterInputType — version awareness', () => {
  it("names filter fields by the version's exposed label, not current's", () => {
    // The view exposes column blog_title as `blogTitle` (v1's name) while
    // current's field object calls it `title`. A filter input built from
    // field.name would advertise the wrong key.
    const type = {
      schema_type: 'content-type' as const,
      name: 'content--category',
      fields: [divergentTextField],
    } as unknown as ParsedContentType

    const input = buildFilterInputType(type, [
      { field: divergentTextField, exposedAs: 'blog_title', required: false },
    ])

    const keys = Object.keys(input!.getFields())
    expect(keys).toContain('blogTitle')
    expect(keys).not.toContain('title')
  })
})
