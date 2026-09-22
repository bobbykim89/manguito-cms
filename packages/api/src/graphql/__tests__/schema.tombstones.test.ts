import { describe, it, expect } from 'vitest'
import { graphql, printSchema } from 'graphql'
import { programmaticField } from '@bobbykim/manguito-cms-core'
import type { ParsedContentType, ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { buildGraphQLSchema } from '../schema'
import type { GraphQLContext } from '../context'
import { createFieldKeyMap } from '../../field-keys'
import { createProgrammaticResolver, resolverKey } from '../../programmatic/resolve'
import {
  divergentMediaField,
  divergentTargetType,
  divergentTextField,
  renamedTombstoneField,
} from '../../field-keys.test-fixtures'

// renamedTombstoneField is label `legacy_desc` over retained column
// `blog_desc` — name and column deliberately distinct, so a test cannot pass
// under an implementation that keys off the wrong one.
const withTombstone: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, renamedTombstoneField],
}

const registry = {
  content_types: { 'content--category': withTombstone },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

function ctxWithRow(): GraphQLContext {
  const repo = {
    findMany: async () => ({
      // A real row carries the retained column, because the repository does
      // SELECT * and the column still physically exists.
      data: [{ id: 'c1', blog_title: 'Live', blog_desc: 'SHOULD NOT LEAK' }],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    }),
  }
  return { repos: { 'content--category': repo } } as unknown as GraphQLContext
}

describe('GraphQL schema — tombstoned fields', () => {
  const maps = { 'content--category': createFieldKeyMap(withTombstone.fields) }

  it('does not build a tombstoned field into the object type', () => {
    const schema = buildGraphQLSchema(registry, maps)
    const sdl = printSchema(schema)

    expect(sdl).toContain('title: String')
    expect(sdl).not.toContain('legacyDesc')
  })

  it('refuses a query for the tombstoned field rather than serving its data', async () => {
    const schema = buildGraphQLSchema(registry, maps)

    const result = await graphql({
      schema,
      source: '{ categories { data { legacyDesc } } }',
      contextValue: ctxWithRow(),
    })

    // A field absent from the schema is a validation error, so the retained
    // value never reaches a response at all.
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toContain('legacyDesc')
    expect(JSON.stringify(result.data ?? null)).not.toContain('SHOULD NOT LEAK')
  })

  it('keeps serving the live sibling field', async () => {
    const schema = buildGraphQLSchema(registry, maps)

    const result = await graphql({
      schema,
      source: '{ categories { data { title } } }',
      contextValue: ctxWithRow(),
    })

    expect(result.errors).toBeUndefined()
    const data = result.data as { categories: { data: Array<{ title: string }> } }
    expect(data.categories.data[0]!.title).toBe('Live')
  })

  it('leaves a tombstoned field out of the filter input type', () => {
    const schema = buildGraphQLSchema(registry, maps)
    const sdl = printSchema(schema)

    // The Filter input is built from the same field list; a tombstone there
    // would let a client filter on a column the schema does not expose.
    expect(sdl).toContain('input CategoryFilter')
    const filterBlock = sdl.slice(sdl.indexOf('input CategoryFilter'))
    expect(filterBlock.slice(0, filterBlock.indexOf('}'))).not.toContain('legacyDesc')
  })
})

// The four cases above all tombstone `divergentTextField` (text/plain) — a
// regression that dropped the tombstone filter on `mediaFields`
// specifically (schema.ts's buildObjectType, not the field list itself) would
// go undetected by any of them, even though a tombstoned MEDIA field would
// then still be handed straight to `ctx.loaders.load` (resolvers.ts:82).
const tombstonedMediaField: ParsedField = { ...divergentMediaField, removed: true }

const summaryField: ParsedField = {
  name: 'summary',
  label: 'Summary',
  field_type: 'programmatic',
  required: false,
  nullable: true,
  order: 2,
  validation: { required: false },
  db_column: null,
  ui_component: { component: 'computed-display' },
}

const withTombstonedMedia: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, tombstonedMediaField, summaryField],
}

const mediaRegistry = {
  content_types: { 'content--category': withTombstonedMedia },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

describe('GraphQL schema — tombstoned MEDIA field', () => {
  const maps = { 'content--category': createFieldKeyMap(withTombstonedMedia.fields) }

  it('drops a tombstoned media field from the schema and from mediaFields', async () => {
    const schema = buildGraphQLSchema(mediaRegistry, maps)
    const sdl = printSchema(schema)

    // Absent from the built schema (same proof as the text/plain cases above).
    expect(sdl).not.toContain('hero:')

    // Absent from `mediaFields`' effect too: a programmatic field's
    // resolution loop is the only place that list drives a real
    // ctx.loaders.load call, so drive that path and check what it asked for.
    const loaded: string[] = []
    const resolvers = new Map([
      [
        resolverKey('content--category', 'summary'),
        programmaticField({ schema: 'content--category', field: 'summary' }, (ctx) =>
          `S:${String(ctx.get('title'))}`
        ),
      ],
    ])
    const repo = {
      findMany: async () => ({
        data: [{ id: 'c1', blog_title: 'Live', blog_hero_image: 'SHOULD NOT LOAD' }],
        meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
      }),
    }
    const ctx = {
      repos: { 'content--category': repo },
      resolver: createProgrammaticResolver(resolvers),
      loaders: {
        load: async (_type: string, field: string) => {
          loaded.push(field)
          return null
        },
      },
      programmaticMemo: new WeakMap(),
    } as unknown as GraphQLContext

    const result = await graphql({
      schema,
      source: '{ categories { data { summary } } }',
      contextValue: ctx,
    })

    expect(result.errors).toBeUndefined()
    const data = result.data as { categories: { data: Array<{ summary: string }> } }
    expect(data.categories.data[0]!.summary).toBe('S:Live')
    expect(loaded).not.toContain('hero')
  })
})
