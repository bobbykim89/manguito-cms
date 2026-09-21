import { describe, it, expect } from 'vitest'
import type { ParsedContentType, SchemaRegistry, VersionProjection } from '@bobbykim/manguito-cms-core'
import { buildVersionView } from '../version-view'
import {
  divergentTargetType,
  divergentTextField,
  identityTextField,
  manyToManyField,
  renamedTombstoneField,
} from '../../field-keys.test-fixtures'

// Current's type: label `title` over column `blog_title` (divergent, so a test
// cannot pass by keying off the wrong one), a plain `summary`, a
// many-to-many field with no column of its own, and a tombstone whose
// retained column is `blog_desc`.
const CURRENT_TYPE: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, identityTextField, manyToManyField, renamedTombstoneField],
}

const registry = {
  content_types: { 'content--category': CURRENT_TYPE },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

// v1 exposes the column under its ORIGINAL name, plus the column current has
// since tombstoned. v3 (current) exposes the renamed label only.
const V1: VersionProjection = {
  version: 'v1',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
        { column_name: 'summary', exposed_as: 'summary', required: false },
        { column_name: 'blog_desc', exposed_as: 'blog_desc', required: false, fallback: '' },
      ],
    },
  },
}

const V3: VersionProjection = {
  version: 'v3',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'title', required: true },
        { column_name: 'summary', exposed_as: 'summary', required: false },
      ],
    },
  },
}

function viewFor(projection: VersionProjection | undefined) {
  return buildVersionView({
    registry,
    projection,
    currentProjection: V3,
    currentVersion: 'v3',
  })
}

function find(fields: ReturnType<typeof viewFor>[string]['fields'], exposedAs: string) {
  return fields.find((f) => f.exposedAs === exposedAs)
}

describe('buildVersionView — joining a projection to current', () => {
  it("recovers field_type and ui_component from current's field for the same column", () => {
    const view = viewFor(V1)
    const title = find(view['content--category']!.fields, 'blog_title')

    expect(title).toBeDefined()
    // Joined by COLUMN: current calls this field `title`, v1 exposes it as
    // `blog_title`, and the type info comes from current's field object.
    expect(title!.field.field_type).toBe('text/plain')
    expect(title!.field.db_column!.column_name).toBe('blog_title')
    expect(title!.field.name).toBe('title')
  })

  it("takes requiredness from the version's projection, not current's field", () => {
    // current's field has required: false (divergentTextField), but V3's
    // projection says required: true. The projection wins.
    const v3 = viewFor(V3)
    expect(find(v3['content--category']!.fields, 'title')!.required).toBe(true)

    // And v1's own projection says false for the same column.
    const v1 = viewFor(V1)
    expect(find(v1['content--category']!.fields, 'blog_title')!.required).toBe(false)
  })

  it("carries the projection's fallback through to the view", () => {
    // V1 declares fallback '' on blog_desc. GraphQL's resolver needs it here
    // or a row written since the removal serves null over GraphQL and '' over
    // REST — the same version, two answers.
    const view = viewFor(V1)
    expect(find(view['content--category']!.fields, 'blog_desc')!.fallback).toBe('')
    // And a field with no declared fallback must not carry the key at all.
    expect('fallback' in find(view['content--category']!.fields, 'summary')!).toBe(false)
  })

  it('joins a column whose current field is a tombstone', () => {
    // blog_desc survives in current only as renamedTombstoneField. The join
    // must still find it — a tombstone is an ordinary parsed field.
    const view = viewFor(V1)
    const desc = find(view['content--category']!.fields, 'blog_desc')

    expect(desc).toBeDefined()
    expect(desc!.field.field_type).toBe('text/plain')
    expect(desc!.field.removed).toBe(true)
  })
})

describe('buildVersionView — deprecation reasons', () => {
  it("names current's label when the field was renamed", () => {
    const view = viewFor(V1)
    expect(find(view['content--category']!.fields, 'blog_title')!.deprecationReason)
      .toBe("Renamed to 'title' in v3.")
  })

  it('says removed when current no longer exposes the column', () => {
    const view = viewFor(V1)
    expect(find(view['content--category']!.fields, 'blog_desc')!.deprecationReason)
      .toBe('Removed in v3; column retained while this version is live.')
  })

  it('leaves an unchanged field undeprecated', () => {
    const view = viewFor(V1)
    const summary = find(view['content--category']!.fields, 'summary')
    expect(summary!.deprecationReason).toBeUndefined()
    // Absent, not present-and-undefined — exactOptionalPropertyTypes.
    expect('deprecationReason' in summary!).toBe(false)
  })

  it("deprecates nothing in current's own view", () => {
    const view = viewFor(V3)
    for (const f of view['content--category']!.fields) {
      expect(f.deprecationReason).toBeUndefined()
    }
  })
})

describe('buildVersionView — what a projection cannot carry', () => {
  it('appends non-column-backed fields from current, undeprecated', () => {
    // A many-to-many field has no column (the junction owns the association),
    // so it never appears in a projection. Dropping it here would silently
    // delete every relation field from an older version's schema.
    const view = viewFor(V1)
    const tags = find(view['content--category']!.fields, 'tags')

    expect(tags).toBeDefined()
    expect(tags!.field.field_type).toBe('reference')
    expect(tags!.deprecationReason).toBeUndefined()
  })

  it('never exposes a tombstone through the non-column-backed path', () => {
    const view = viewFor(V1)
    // renamedTombstoneField IS column-backed, so it arrives only via the
    // projection (as blog_desc above) and never under its own name.
    expect(find(view['content--category']!.fields, 'legacy_desc')).toBeUndefined()
  })

  it('falls back to the registry, minus tombstones, for a type with no projection', () => {
    // Paragraph types have no projection at all — core's buildProjections
    // never visits them. They follow current's shape on every version.
    const view = viewFor(undefined)
    const fields = view['content--category']!.fields

    expect(fields.map((f) => f.exposedAs).sort()).toEqual(['summary', 'tags', 'title'])
    expect(find(fields, 'legacy_desc')).toBeUndefined()
    expect(fields.every((f) => f.deprecationReason === undefined)).toBe(true)
  })
})
