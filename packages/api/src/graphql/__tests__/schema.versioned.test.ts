import { describe, it, expect } from 'vitest'
import { graphql, printSchema } from 'graphql'
import { programmaticField } from '@bobbykim/manguito-cms-core'
import type {
  ParsedContentType,
  ParsedField,
  SchemaRegistry,
  VersionProjection,
} from '@bobbykim/manguito-cms-core'
import { buildGraphQLSchema } from '../schema'
import { buildVersionView } from '../version-view'
import type { GraphQLContext } from '../context'
import { createFieldKeyMapFromProjection } from '../../field-keys'
import { createProgrammaticResolver, resolverKey } from '../../programmatic/resolve'
import {
  divergentMediaField,
  divergentTargetType,
  divergentTextField,
  renamedTombstoneField,
} from '../../field-keys.test-fixtures'

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
    const v1Data = v1.data as { categories: { data: Array<{ blogTitle: string }> } }
    expect(v1Data.categories.data[0]!.blogTitle).toBe('Hello')

    const v3 = await graphql({
      schema: schemaFor(V3),
      source: '{ categories { data { title } } }',
      contextValue: ctxWith(row),
    })
    expect(v3.errors).toBeUndefined()
    const v3Data = v3.data as { categories: { data: Array<{ title: string }> } }
    expect(v3Data.categories.data[0]!.title).toBe('Hello')
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
    const data = result.data as { categories: { data: Array<{ blogDesc: string }> } }
    expect(data.categories.data[0]!.blogDesc).toBe('FELL BACK')
  })

  it('leaves a real value alone, including an empty string', async () => {
    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { blogDesc } } }',
      contextValue: ctxWith({ id: 'c1', blog_title: 'Hello', blog_desc: '' }),
    })
    expect(result.errors).toBeUndefined()
    const data = result.data as { categories: { data: Array<{ blogDesc: string }> } }
    expect(data.categories.data[0]!.blogDesc).toBe('')
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

// ─── Closing the gap: rows whose only fixtures never diverge under a view ─────
//
// Every test above uses divergentTextField, whose V1 label ('blog_title')
// happens to be a plain string with no other consumer depending on which of
// the three names (exposedAs / field.name / column) is read — so a schema.ts
// that read the WRONG one of those three for `nameMap`, `mediaFieldNames`, or
// `relationFieldResolver` would still print the right SDL and serve the right
// scalar value. These two tests are built so each fails under exactly the
// mutation it targets — verified by hand: apply the mutation, watch the
// assertion below break, then restore.

describe("buildGraphQLSchema — filter arguments use this version's label", () => {
  it("translates a V1 filter key back through V1's own exposedAs, not the real field name", async () => {
    // divergentTextField's real name is 'title', but V1 exposes it as
    // 'blog_title' — so a nameMap built from v.field.name (instead of
    // vf.exposedAs) cannot translate the GraphQL argument key 'blogTitle'
    // back to any label at all, and the filter would reach the repository
    // keyed by the raw GraphQL name instead of the storage column.
    const captured: { opts?: Record<string, unknown> } = {}
    const repo = {
      findMany: async (opts: Record<string, unknown>) => {
        captured.opts = opts
        return {
          data: [],
          meta: { total: 0, page: 1, per_page: 10, total_pages: 0, has_next: false, has_prev: false },
        }
      },
    }
    const ctx = { repos: { 'content--category': repo } } as unknown as GraphQLContext

    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories(filter: { blogTitle: { eq: "Hello" } }) { meta { total } } }',
      contextValue: ctx,
    })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['filters']).toEqual({ blog_title: 'Hello' })
  })
})

// A renamed MEDIA field: real registry name 'hero', V1 label 'legacy_hero'.
// ctx.loaders.load looks a field up in the registry by its REAL name, so a
// versioned label reaching it finds nothing and the field silently resolves
// to null/undefined — while REST, which never runs this code, still serves
// it. `summary` is a sibling programmatic field so the same row also
// exercises mediaFieldNames' enrichment path, not just the field's own
// resolver.
const HERO_FIELD: ParsedField = divergentMediaField

const HERO_SUMMARY_FIELD: ParsedField = {
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

const HERO_TYPE: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, HERO_FIELD, HERO_SUMMARY_FIELD],
}

const heroRegistry = {
  content_types: { 'content--category': HERO_TYPE },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

const HERO_CURRENT: VersionProjection = {
  version: 'v3',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'title', required: true },
        { column_name: 'blog_hero_image', exposed_as: 'hero', required: false },
      ],
    },
  },
}

const HERO_V1: VersionProjection = {
  version: 'v1',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
        // The rename under test: this version's label for the media field
        // diverges from its real registry name ('hero').
        { column_name: 'blog_hero_image', exposed_as: 'legacy_hero', required: false },
      ],
    },
  },
}

function heroSchema() {
  const view = buildVersionView({
    registry: heroRegistry,
    projection: HERO_V1,
    currentProjection: HERO_CURRENT,
    currentVersion: 'v3',
  })
  // Deliberately no FieldKeyMap here (unlike schemaFor above): this test
  // targets mediaFieldNames and relationFieldResolver, not resolveFieldValue
  // or the label/column split a FieldKeyMap exists for. A FieldKeyMap built
  // from a projection that renames a column-backed field drops that field's
  // bare registry name from its own toLabels remap (createFieldKeyMapFromProjection
  // only ever un-drops a projected COLUMN or LABEL, never a field's real name
  // in its own right) — which would strip the media loader's already-resolved
  // 'hero' key before the programmatic resolver ever saw it, for reasons
  // unrelated to the two rows under test here. Omitting the map keeps
  // `toLabels` an identity function, so the assertions below isolate exactly
  // what schema.ts hands to `ctx.loaders.load`.
  return buildGraphQLSchema(heroRegistry, {}, view)
}

describe('buildGraphQLSchema — a renamed media field resolves under its real registry name', () => {
  it('hands ctx.loaders.load the real field name, never the versioned label, from either call site', async () => {
    const loaded: string[] = []
    const resolvers = new Map([
      [
        resolverKey('content--category', 'summary'),
        programmaticField({ schema: 'content--category', field: 'summary' }, (ctx) =>
          JSON.stringify(ctx.get('hero') ?? null)
        ),
      ],
    ])
    const repo = {
      findMany: async () => ({
        data: [{ id: 'c1', blog_title: 'Hello', blog_hero_image: 'm1' }],
        meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
      }),
    }
    const ctx = {
      repos: { 'content--category': repo },
      resolver: createProgrammaticResolver(resolvers),
      loaders: {
        // Stands in for the real dataloader, which resolves a field by
        // looking it up in the registry by NAME. Only the real name 'hero'
        // is registered — a versioned label matches nothing.
        load: async (_type: string, field: string, row: Record<string, unknown>) => {
          loaded.push(field)
          if (field !== 'hero') return null
          row['hero'] = { id: 'm1' }
          delete row['blog_hero_image']
          return { id: 'm1' }
        },
      },
      programmaticMemo: new WeakMap(),
    } as unknown as GraphQLContext

    // legacyHero exercises relationFieldResolver directly; summary exercises
    // mediaFieldNames via the programmatic enrichment step. Both must ask
    // loaders.load for 'hero' — never 'legacyHero' or 'legacy_hero'.
    const result = await graphql({
      schema: heroSchema(),
      source: '{ categories { data { legacyHero { id } summary } } }',
      contextValue: ctx,
    })

    expect(result.errors).toBeUndefined()
    const data = result.data as {
      categories: { data: Array<{ legacyHero: { id: string } | null; summary: string }> }
    }
    expect(data.categories.data[0]!.legacyHero).toEqual({ id: 'm1' })
    expect(data.categories.data[0]!.summary).toBe('{"id":"m1"}')
    expect(loaded.length).toBeGreaterThan(0)
    expect(loaded.every((name) => name === 'hero')).toBe(true)
  })
})
