import { describe, it, expect } from 'vitest'
import { describeSchemaChange } from '../describe'
import { makeContentType, makeTaxonomyType, makeParagraphType, makeRegistry } from './fixtures'
import type { SchemaRegistry } from '../../parser/validate'

function snap(version: string, registry: SchemaRegistry) {
  return { version, registry }
}

const TYPE = 'content--blog_post'

function change(
  fromFields: Parameters<typeof makeContentType>[1] | null,
  toFields: Parameters<typeof makeContentType>[1]
) {
  return describeSchemaChange({
    from: fromFields === null ? null : snap('v1', makeRegistry([makeContentType(TYPE, fromFields)])),
    to: snap('v2', makeRegistry([makeContentType(TYPE, toFields)])),
  })
}

/** The one type's field changes, for a terser assertion. */
function fieldsOf(c: ReturnType<typeof change>) {
  return c.types.find((t) => t.type === TYPE)!.fields
}

describe('describeSchemaChange — the four kinds', () => {
  it('reports a new column as added, with its type', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }, { name: 'views', type: 'integer' }])
    expect(fieldsOf(c)).toEqual([{ kind: 'added', column: 'views', name: 'views', field_type: 'integer' }])
  })

  it('reports a rename as one renamed column, not a drop plus an add', () => {
    // The whole reason the classification is keyed by column. Under a
    // name-keyed implementation this would come back as two entries.
    const c = change([{ name: 'blog_title' }], [{ name: 'title', column: 'blog_title' }])
    expect(fieldsOf(c)).toEqual([
      { kind: 'renamed', column: 'blog_title', from_name: 'blog_title', to_name: 'title' },
    ])
  })

  it('reports a tombstone, carrying its fallback', () => {
    const c = change(
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }],
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich', removed: true, fallback: '' }]
    )
    expect(fieldsOf(c)).toEqual([
      { kind: 'tombstoned', column: 'blog_desc', name: 'blog_desc', fallback: '' },
    ])
  })

  it('omits fallback entirely when the tombstone declares none', () => {
    const c = change(
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich' }],
      [{ name: 'title' }, { name: 'blog_desc', type: 'text/rich', removed: true }]
    )
    expect(fieldsOf(c)).toEqual([{ kind: 'tombstoned', column: 'blog_desc', name: 'blog_desc' }])
  })

  it('reports a column brought back from a tombstone as restored', () => {
    // A snapshot can itself contain a tombstone. Without this kind the case
    // matches no other branch and is silently reported as unchanged — a lie.
    const c = change(
      [{ name: 'blog_desc', type: 'text/rich', removed: true }],
      [{ name: 'blog_desc', type: 'text/rich' }]
    )
    expect(fieldsOf(c)).toEqual([{ kind: 'restored', column: 'blog_desc', name: 'blog_desc' }])
  })

  it('reports nothing for an unchanged field', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }])
    expect(fieldsOf(c)).toEqual([])
  })

  it('reports nothing for a field that stayed tombstoned', () => {
    const c = change(
      [{ name: 'gone', removed: true }],
      [{ name: 'gone', removed: true }]
    )
    expect(fieldsOf(c)).toEqual([])
  })
})

describe('describeSchemaChange — identical', () => {
  it('is true when no type or field changed', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }])
    expect(c.identical).toBe(true)
  })

  it('is false when a field changed', () => {
    const c = change([{ name: 'title' }], [{ name: 'headline', column: 'title' }])
    expect(c.identical).toBe(false)
  })

  it('is false when a type was added, even with no field changes elsewhere', () => {
    const c = describeSchemaChange({
      from: snap('v1', makeRegistry([makeContentType(TYPE, [{ name: 'title' }])])),
      to: snap('v2', makeRegistry([
        makeContentType(TYPE, [{ name: 'title' }]),
        makeTaxonomyType('taxonomy--tag', [{ name: 'tag_name' }]),
      ])),
    })
    expect(c.identical).toBe(false)
    expect(c.types.find((t) => t.type === 'taxonomy--tag')!.status).toBe('added')
  })
})

describe('describeSchemaChange — version names', () => {
  it('carries both version names through', () => {
    const c = change([{ name: 'title' }], [{ name: 'title' }])
    expect(c.from).toBe('v1')
    expect(c.to).toBe('v2')
  })

  it('treats a null from as the first cut — every type added, every field added', () => {
    const c = change(null, [{ name: 'title' }, { name: 'views', type: 'integer' }])
    expect(c.from).toBeNull()
    expect(c.to).toBe('v2')
    const t = c.types.find((x) => x.type === TYPE)!
    expect(t.status).toBe('added')
    expect(t.fields.map((f) => f.kind)).toEqual(['added', 'added'])
    expect(c.identical).toBe(false)
  })
})

describe('describeSchemaChange — coverage of the registry', () => {
  it('classifies taxonomy and paragraph types too, not only content types', () => {
    // Paragraph types are part of a snapshot and are covered by the model's
    // completeness check, so a change report that skipped them would tell the
    // author they were freezing less than they are.
    const from = makeRegistry([
      makeTaxonomyType('taxonomy--tag', [{ name: 'tag_name' }]),
      makeParagraphType('paragraph--card', [{ name: 'caption' }]),
    ])
    const to = makeRegistry([
      makeTaxonomyType('taxonomy--tag', [{ name: 'label', column: 'tag_name' }]),
      makeParagraphType('paragraph--card', [{ name: 'caption' }, { name: 'alt' }]),
    ])
    const c = describeSchemaChange({ from: snap('v1', from), to: snap('v2', to) })

    expect(c.types.find((t) => t.type === 'taxonomy--tag')!.fields).toEqual([
      { kind: 'renamed', column: 'tag_name', from_name: 'tag_name', to_name: 'label' },
    ])
    expect(c.types.find((t) => t.type === 'paragraph--card')!.fields).toEqual([
      { kind: 'added', column: 'alt', name: 'alt', field_type: 'text/plain' },
    ])
  })

  it('ignores fields with no storage column', () => {
    const c = change(
      [{ name: 'title' }],
      [
        { name: 'title' },
        { name: 'cards', type: 'paragraph', ref: 'paragraph--card', rel: 'one-to-many' },
      ]
    )
    expect(fieldsOf(c)).toEqual([])
  })

  it('reports a moved column as an add of the new column', () => {
    // Changing `column` while keeping `name` is not a rename — it is a
    // different column. Keyed by column, that is honestly two facts. The old
    // column being gone is VERSION_COLUMN_MISSING's business, so only the new
    // one appears here.
    const c = change([{ name: 'title' }], [{ name: 'title', column: 'headline' }])
    expect(fieldsOf(c)).toEqual([
      { kind: 'added', column: 'headline', name: 'title', field_type: 'text/plain' },
    ])
  })
})
