import { describe, it, expect } from 'vitest'
import { graphql, printSchema } from 'graphql'
import type { ParsedContentType, SchemaRegistry, VersionProjection } from '@bobbykim/manguito-cms-core'
import { buildGraphQLSchema } from '../schema'
import { buildVersionView } from '../version-view'
import type { GraphQLContext } from '../context'
import { createFieldKeyMapFromProjection } from '../../field-keys'
import { divergentTargetType, divergentTextField, renamedTombstoneField } from '../../field-keys.test-fixtures'

const CURRENT_TYPE: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, renamedTombstoneField],
}

const registry = {
  content_types: { 'content--category': CURRENT_TYPE },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

const V1: VersionProjection = {
  version: 'v1',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
        { column_name: 'blog_desc', exposed_as: 'blog_desc', required: false, fallback: 'FELL BACK' },
      ],
    },
  },
}

const V3: VersionProjection = {
  version: 'v3',
  types: {
    'content--category': { fields: [{ column_name: 'blog_title', exposed_as: 'title', required: true }] },
  },
}

function schemaFor(projection: VersionProjection) {
  const view = buildVersionView({ registry, projection, currentProjection: V3, currentVersion: 'v3' })
  const maps = {
    'content--category': createFieldKeyMapFromProjection(
      projection.types['content--category']!,
      CURRENT_TYPE.fields
    ),
  }
  return buildGraphQLSchema(registry, maps, view)
}

function ctxWith(row: Record<string, unknown>): GraphQLContext {
  const repo = {
    findMany: async () => ({
      data: [row],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    }),
  }
  return { repos: { 'content--category': repo } } as unknown as GraphQLContext
}

describe('buildGraphQLSchema — per-version field names', () => {
  it("names each field by its own version's label over one column", async () => {
    const row = { id: 'c1', blog_title: 'Hello', blog_desc: 'Old' }

    const v1 = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { blogTitle } } }',
      contextValue: ctxWith(row),
    })
    expect(v1.errors).toBeUndefined()
    expect((v1.data as any).categories.data[0].blogTitle).toBe('Hello')

    const v3 = await graphql({
      schema: schemaFor(V3),
      source: '{ categories { data { title } } }',
      contextValue: ctxWith(row),
    })
    expect(v3.errors).toBeUndefined()
    expect((v3.data as any).categories.data[0].title).toBe('Hello')
  })

  it("rejects current's name on the older version's schema", async () => {
    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { title } } }',
      contextValue: ctxWith({ id: 'c1', blog_title: 'Hello' }),
    })
    expect(result.errors).toBeDefined()
  })

  it('omits a column the older version never exposed', () => {
    // blog_desc is in V1 but not V3 — v3's schema must not carry it, and this
    // is the 2d leak in GraphQL form: remap passes unmapped keys through, so
    // only building from the view prevents it.
    expect(printSchema(schemaFor(V3))).not.toContain('blogDesc')
    expect(printSchema(schemaFor(V1))).toContain('blogDesc')
  })
})

describe('buildGraphQLSchema — deprecation directives', () => {
  it('marks a renamed field deprecated with current’s name', () => {
    const sdl = printSchema(schemaFor(V1))
    expect(sdl).toContain('@deprecated(reason: "Renamed to \'title\' in v3.")')
  })

  it('marks a removed field deprecated', () => {
    const sdl = printSchema(schemaFor(V1))
    expect(sdl).toContain('Removed in v3; column retained while this version is live.')
  })

  it("deprecates nothing on current's own schema", () => {
    expect(printSchema(schemaFor(V3))).not.toContain('@deprecated')
  })
})

describe('buildGraphQLSchema — per-version nullability', () => {
  it("uses the version's own requiredness, not current's field", () => {
    // divergentTextField carries required: false, but V3's projection says
    // true. Reading the ParsedField would emit String on v3 and String! on
    // neither.
    expect(printSchema(schemaFor(V3))).toContain('title: String!')
    expect(printSchema(schemaFor(V1))).toContain('blogTitle: String')
    expect(printSchema(schemaFor(V1))).not.toContain('blogTitle: String!')
  })
})

describe('buildGraphQLSchema — fallbacks', () => {
  it('serves the declared fallback when the retained column is null', async () => {
    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { blogDesc } } }',
      contextValue: ctxWith({ id: 'c1', blog_title: 'Hello', blog_desc: null }),
    })
    expect(result.errors).toBeUndefined()
    expect((result.data as any).categories.data[0].blogDesc).toBe('FELL BACK')
  })

  it('leaves a real value alone, including an empty string', async () => {
    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { blogDesc } } }',
      contextValue: ctxWith({ id: 'c1', blog_title: 'Hello', blog_desc: '' }),
    })
    expect(result.errors).toBeUndefined()
    expect((result.data as any).categories.data[0].blogDesc).toBe('')
  })
})

describe('buildGraphQLSchema — back-compatibility', () => {
  it('builds from the registry when no view is supplied', () => {
    const sdl = printSchema(buildGraphQLSchema(registry))
    expect(sdl).toContain('title: String')
    // Task 2's rule still holds on the no-view path.
    expect(sdl).not.toContain('legacyDesc')
  })
})
