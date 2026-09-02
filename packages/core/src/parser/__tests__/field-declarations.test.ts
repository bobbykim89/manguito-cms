import { describe, it, expect } from 'vitest'
import { parseSchema } from '../parseSchema'
import type { ParsedContentType } from '../parseSchema'

// A content type wrapping the given raw fields in the single tab
// ContentTypeRawSchema requires. Fields are `unknown[]` because several tests
// deliberately pass shapes the validators must reject.
function contentType(fields: unknown[]): unknown {
  return {
    name: 'content--blog_post',
    label: 'Blog Post',
    type: 'content-type',
    default_base_path: 'blog',
    only_one: false,
    fields: [{ tab: { name: 'primary_tab', label: 'Primary', fields } }],
  }
}

function parseOk(fields: unknown[]): ParsedContentType {
  const result = parseSchema(contentType(fields), 'content-type', 'schemas/content-types/blog.json')
  if (!result.ok) throw new Error(`expected parse to succeed: ${JSON.stringify(result.errors)}`)
  return result.schema as ParsedContentType
}

describe('field declarations — column', () => {
  it('defaults the column to the field name when "column" is absent', () => {
    const type = parseOk([{ name: 'title', label: 'Title', type: 'text/plain', required: true }])
    expect(type.fields[0]!.db_column!.column_name).toBe('title')
  })

  it('uses an explicit "column" as the storage column, leaving the name as the exposed key', () => {
    const type = parseOk([
      { name: 'title', label: 'Title', type: 'text/plain', required: true, column: 'blog_title' },
    ])
    const field = type.fields[0]!
    // This is the whole point of the redesign: name and column diverge because
    // the schema SAID so, with no history to fold.
    expect(field.name).toBe('title')
    expect(field.db_column!.column_name).toBe('blog_title')
  })

  it('keeps the declared column on a media field, whose builder also sets a foreign key', () => {
    // Guards against applying the override in a way that drops the rest of the
    // builder's db_column. Nine builders produce a column; the override is
    // applied once, generically, so it must preserve every other property.
    const type = parseOk([
      { name: 'hero', label: 'Hero', type: 'image', required: false, column: 'hero_image' },
    ])
    const col = type.fields[0]!.db_column!
    expect(col.column_name).toBe('hero_image')
    expect(col.column_type).toBe('uuid')
    expect(col.foreign_key).toEqual({ table: 'media', column: 'id', on_delete: 'SET NULL' })
  })

  it('keeps the declared column on an enum field, preserving its check constraint', () => {
    const type = parseOk([
      { name: 'state', label: 'State', type: 'enum', required: true, values: ['a', 'b'], column: 'old_state' },
    ])
    const col = type.fields[0]!.db_column!
    expect(col.column_name).toBe('old_state')
    expect(col.check_constraint).toEqual(['a', 'b'])
  })
})

describe('field declarations — removed (tombstone)', () => {
  it('retains the column and marks the field removed', () => {
    const type = parseOk([
      { name: 'title', label: 'Title', type: 'text/plain', required: true },
      { name: 'blog_desc', label: 'Desc', type: 'text/rich', required: false, removed: true },
    ])
    const tombstone = type.fields[1]!
    expect(tombstone.removed).toBe(true)
    // The column still exists — that is what "retained" means.
    expect(tombstone.db_column!.column_name).toBe('blog_desc')
  })

  it('forces a tombstone nullable even when the field was authored required', () => {
    // Rows created after the removal cannot populate the column, so NOT NULL
    // would be unsatisfiable. `required: true` here is rejected by Task 3; this
    // test pins the nullability rule independently of that check, using a
    // required-by-default type.
    const type = parseOk([
      { name: 'flag', label: 'Flag', type: 'boolean', required: false, removed: true },
    ])
    const tombstone = type.fields[0]!
    // Boolean columns are normally NOT NULL — false is the natural empty value.
    // A tombstoned boolean is the one case that must still be nullable.
    expect(tombstone.db_column!.nullable).toBe(true)
    expect(tombstone.nullable).toBe(true)
    expect(tombstone.required).toBe(false)
    expect(tombstone.validation.required).toBe(false)
  })

  it('composes "column" with "removed" — a field renamed and then removed', () => {
    // The tombstone must retain the column the OLDER version exposes, not the
    // name the field was last known by.
    const type = parseOk([
      { name: 'blog_desc', label: 'Desc', type: 'text/rich', required: false, column: 'description', removed: true },
    ])
    expect(type.fields[0]!.db_column!.column_name).toBe('description')
    expect(type.fields[0]!.removed).toBe(true)
  })
})

describe('field declarations — fallback', () => {
  it('carries a fallback value onto the parsed field', () => {
    const type = parseOk([
      { name: 'blog_desc', label: 'Desc', type: 'text/rich', required: false, removed: true, fallback: '' },
    ])
    expect(type.fields[0]!.fallback).toBe('')
  })

  it('carries a falsy fallback rather than treating it as absent', () => {
    const type = parseOk([
      { name: 'count', label: 'Count', type: 'integer', required: false, removed: true, fallback: 0 },
    ])
    expect(type.fields[0]!.fallback).toBe(0)
    expect('fallback' in type.fields[0]!).toBe(true)
  })
})

describe('field declarations — absence is invisible', () => {
  it('omits both keys entirely on an ordinary field', () => {
    // Not `removed: false` / `fallback: undefined`. Every schema written before
    // versioning existed must parse to exactly what it parsed to before, so
    // that serialized output and deep-equal assertions elsewhere are unaffected.
    const type = parseOk([{ name: 'title', label: 'Title', type: 'text/plain', required: true }])
    expect('removed' in type.fields[0]!).toBe(false)
    expect('fallback' in type.fields[0]!).toBe(false)
  })

  it('rejects a non-snake_case column', () => {
    const result = parseSchema(
      contentType([{ name: 'title', label: 'Title', type: 'text/plain', required: true, column: 'Blog Title' }]),
      'content-type',
      'schemas/content-types/blog.json'
    )
    expect(result.ok).toBe(false)
  })
})
