import { describe, it, expect } from 'vitest'
import { parseSchema, buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { ParsedSchema, ParsedRoutes, ParsedRoles, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { classifyVersion, buildVersionSurface, type BakedVersionModel } from '../versions.js'

/** Live v1 and v3 (v2 retired), working schema v4. */
const MODEL: BakedVersionModel = {
  current: 'v4',
  live: ['v1', 'v3', 'v4'],
  projections: {},
}

// ─── makeRegistryFixture ────────────────────────────────────────────────────
//
// Core publishes only its main entry — its own internal test fixtures
// (packages/core/src/versions/__tests__/fixtures.ts) are not importable from
// here — so this mirrors that file's approach: build real raw schemas and run
// them through core's actual `parseSchema` and `buildSchemaRegistry`, rather
// than hand-forging a `ParsedField`. A hand-forged `db_column` would make a
// field's name and column identical, and then nothing in this file could
// distinguish column-keying from name-keying — which is the entire property
// under test.
//
// The content type's `title` field declares `column: 'blog_title'`, so after
// parsing its `name` is `'title'` but its `db_column.column_name` is
// `'blog_title'` — name and column genuinely diverge.

const EMPTY_ROUTES: ParsedRoutes = { base_paths: [] }
const EMPTY_ROLES: ParsedRoles = { roles: [], valid_permissions: [] }

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type' | 'paragraph-type', file: string): ParsedSchema {
  const result = parseSchema(raw, type, file)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function makeRegistryFixture(): SchemaRegistry {
  const postType = parseOrThrow(
    {
      name: 'content--post',
      label: 'Post',
      type: 'content-type',
      default_base_path: 'posts',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'primary_tab',
            label: 'Primary',
            fields: [
              // Diverges: name 'title', storage column 'blog_title'.
              { name: 'title', label: 'Title', type: 'text/plain', required: false, column: 'blog_title' },
            ],
          },
        },
      ],
    },
    'content-type',
    'schemas/content-types/post.json'
  )

  const categoryType = parseOrThrow(
    {
      name: 'taxonomy--category',
      label: 'Category',
      type: 'taxonomy-type',
      fields: [{ name: 'name', label: 'Name', type: 'text/plain', required: false }],
    },
    'taxonomy-type',
    'schemas/taxonomy-types/category.json'
  )

  const cardType = parseOrThrow(
    {
      name: 'paragraph--card',
      label: 'Card',
      type: 'paragraph-type',
      fields: [{ name: 'heading', label: 'Heading', type: 'text/plain', required: false }],
    },
    'paragraph-type',
    'schemas/paragraph-types/card.json'
  )

  return buildSchemaRegistry([postType, categoryType, cardType], EMPTY_ROUTES, EMPTY_ROLES)
}

// A registry whose CURRENT schema exposes column `blog_title` under the name
// `title` — the rename case. Built through core's real parser via the shared
// helper above so `db_column.column_name` genuinely diverges from `name`;
// hand-forging it would make name and column identical and these tests could
// not tell column-keying from name-keying.
const REGISTRY = makeRegistryFixture()

const SURFACE_MODEL: BakedVersionModel = {
  current: 'v2',
  live: ['v1', 'v2'],
  projections: {
    // v1 exposed the column under its own name.
    v1: { version: 'v1', types: { 'content--post': { fields: [
      { column_name: 'blog_title', exposed_as: 'blog_title' },
    ] } } },
    // v2 exposes the same column under the new name.
    v2: { version: 'v2', types: { 'content--post': { fields: [
      { column_name: 'blog_title', exposed_as: 'title' },
    ] } } },
  },
}

/** Captures every makeRepo call so the sortable-columns claim is checkable without a database. */
function capturingMakeRepo() {
  const calls: Array<{ typeName: string; tableName: string; sortableColumns: Set<string> }> = []
  const makeRepo = (typeName: string, tableName: string, sortableColumns: Set<string>) => {
    calls.push({ typeName, tableName, sortableColumns })
    return {} as never
  }
  return { calls, makeRepo }
}

describe('buildVersionSurface', () => {
  it('builds paths under the version, and maps from that version\'s projection', () => {
    const { makeRepo } = capturingMakeRepo()
    const v1 = buildVersionSurface({
      version: 'v1', projectionVersion: 'v1', prefix: '/api',
      registry: REGISTRY, model: SURFACE_MODEL, makeRepo,
    })

    expect(v1.paths.collection('post')).toBe('/api/v1/post')
    // The load-bearing assertion: v1's map resolves v1's LABEL to the column,
    // not current's label. An implementation reading current's fields would
    // give columnFor('blog_title') === undefined here.
    expect(v1.fieldKeyMaps['content--post']!.columnFor('blog_title')).toBe('blog_title')
    expect(v1.fieldKeyMaps['content--post']!.columnFor('title')).toBeUndefined()
  })

  it('gives each version its own map for the same column', () => {
    const { makeRepo } = capturingMakeRepo()
    const shared = { prefix: '/api', registry: REGISTRY, model: SURFACE_MODEL, makeRepo }
    const v1 = buildVersionSurface({ version: 'v1', projectionVersion: 'v1', ...shared })
    const v2 = buildVersionSurface({ version: 'v2', projectionVersion: 'v2', ...shared })

    // One column, two labels — the whole feature, at the map level.
    expect(v1.fieldKeyMaps['content--post']!.labelFor('blog_title')).toBe('blog_title')
    expect(v2.fieldKeyMaps['content--post']!.labelFor('blog_title')).toBe('title')
  })

  it('derives sortable columns from THIS version\'s map, not current\'s', () => {
    // Why repositories are per-version. SORTABLE_FIELDS includes 'title'; in v2
    // that label maps to column blog_title, in v1 it does not exist as a label
    // at all — so the two versions' guards legitimately differ.
    const a = capturingMakeRepo()
    buildVersionSurface({ version: 'v1', projectionVersion: 'v1', prefix: '/api', registry: REGISTRY, model: SURFACE_MODEL, makeRepo: a.makeRepo })
    const b = capturingMakeRepo()
    buildVersionSurface({ version: 'v2', projectionVersion: 'v2', prefix: '/api', registry: REGISTRY, model: SURFACE_MODEL, makeRepo: b.makeRepo })

    const setFor = (calls: typeof a.calls) =>
      [...calls.find((c) => c.typeName === 'content--post')!.sortableColumns].sort()

    expect(setFor(a.calls)).not.toEqual(setFor(b.calls))
    // v2 sorts 'title' by the real column; v1 has no such label (and 'title'
    // is not a system field either), so it is simply excluded from v1's
    // sortable set rather than admitted as a bogus literal — the public route
    // rejects sort_by=title for v1 before it would ever reach the repository.
    expect(setFor(b.calls)).toContain('blog_title')
  })

  it('omits the version segment for the unversioned pass', () => {
    const { makeRepo } = capturingMakeRepo()
    const un = buildVersionSurface({
      version: null, projectionVersion: SURFACE_MODEL.current, prefix: '/api',
      registry: REGISTRY, model: SURFACE_MODEL, makeRepo,
    })
    expect(un.paths.collection('post')).toBe('/api/post')
    // It uses the CURRENT version's projection, so its labels match v2's.
    expect(un.fieldKeyMaps['content--post']!.labelFor('blog_title')).toBe('title')
  })

  it('builds a repo for every content and taxonomy type', () => {
    const { calls, makeRepo } = capturingMakeRepo()
    buildVersionSurface({ version: 'v1', projectionVersion: 'v1', prefix: '/api', registry: REGISTRY, model: SURFACE_MODEL, makeRepo })
    const types = calls.map((c) => c.typeName).sort()
    expect(types).toEqual(Object.keys({ ...REGISTRY.content_types, ...REGISTRY.taxonomy_types }).sort())
  })

  it('falls back to the registry\'s fields for a type with no projection', () => {
    // Paragraph types have no projection — core's buildProjections iterates
    // content and taxonomy only. Their maps must still be built, from the
    // registry, or nested paragraph projection breaks entirely.
    const { makeRepo } = capturingMakeRepo()
    const s = buildVersionSurface({ version: 'v1', projectionVersion: 'v1', prefix: '/api', registry: REGISTRY, model: SURFACE_MODEL, makeRepo })
    for (const paragraphType of Object.keys(REGISTRY.paragraph_types)) {
      expect(s.fieldKeyMaps[paragraphType]).toBeDefined()
    }
  })
})

describe('classifyVersion', () => {
  it('classifies a live version as live', () => {
    expect(classifyVersion('v1', MODEL)).toBe('live')
    expect(classifyVersion('v3', MODEL)).toBe('live')
  })

  it('classifies the current version as live', () => {
    expect(classifyVersion('v4', MODEL)).toBe('live')
  })

  it('classifies a gap below current as retired', () => {
    // v2 is not live and is below v4, so it was cut and later retired.
    expect(classifyVersion('v2', MODEL)).toBe('retired')
  })

  it('classifies a number above current as unknown', () => {
    // v5 was never cut — `current` is highest snapshot + 1, so nothing at or
    // above it can ever have existed.
    expect(classifyVersion('v5', MODEL)).toBe('unknown')
    expect(classifyVersion('v99', MODEL)).toBe('unknown')
  })

  it('classifies a non-version segment as not-a-version', () => {
    // This is what protects /api/media/:id from the catch-all. Without it the
    // catch-all would answer 404 VERSION_NOT_FOUND for every media request.
    expect(classifyVersion('media', MODEL)).toBe('not-a-version')
    expect(classifyVersion('v', MODEL)).toBe('not-a-version')
    expect(classifyVersion('vX', MODEL)).toBe('not-a-version')
    expect(classifyVersion('1', MODEL)).toBe('not-a-version')
    expect(classifyVersion('v1x', MODEL)).toBe('not-a-version')
    // Exercises the LEADING anchor. Without ^ this matches, then
    // parseInt('v1') is NaN, `NaN < current` is false, and the function
    // silently answers 'unknown' — so the catch-all would claim a path it
    // should have let fall through.
    expect(classifyVersion('xv1', MODEL)).toBe('not-a-version')
  })

  it('treats a leading-zero version as its own segment, not a live alias', () => {
    // 'v01' parses to 1 but is not the string 'v1', so it is not live. It is
    // below current, so it reads as retired rather than as v1's contract —
    // which is right: serving v1's data at a URL v1 never published would be
    // worse than a 410.
    expect(classifyVersion('v01', MODEL)).toBe('retired')
  })

  it('handles the single-version zero-config model', () => {
    const solo: BakedVersionModel = { current: 'v1', live: ['v1'], projections: {} }
    expect(classifyVersion('v1', solo)).toBe('live')
    expect(classifyVersion('v2', solo)).toBe('unknown')
  })
})
