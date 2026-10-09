import { describe, it, expect } from 'vitest'
import { parseSchema } from '../../parser/parseSchema'
import type { ParsedContentType } from '../../parser/parseSchema'
import type { ParsedField } from '../types'
import { relationCardinality } from '../cardinality'

// Fields come from the real parser, so each ui_component.rel is exactly what a
// schema author's JSON produces (PLAN-QUALITY rule 4).
function parsedFields(): Record<string, ParsedField> {
  const result = parseSchema(
    {
      name: 'content--cardinality_test',
      label: 'Cardinality Test',
      type: 'content-type',
      default_base_path: 'cardinality-tests',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'main',
            label: 'Main',
            fields: [
              { name: 'title', label: 'Title', type: 'text/plain', required: false },
              { name: 'hero', label: 'Hero', type: 'image', required: false },
              { name: 'link', label: 'Link', type: 'paragraph', ref: 'paragraph--link', rel: 'one-to-one', required: false },
              { name: 'cards', label: 'Cards', type: 'paragraph', ref: 'paragraph--card', rel: 'one-to-many', required: false },
              { name: 'author', label: 'Author', type: 'reference', target: 'taxonomy--author', rel: 'one-to-one', required: false },
              { name: 'category', label: 'Category', type: 'reference', target: 'taxonomy--category', rel: 'one-to-many', required: false },
              { name: 'tags', label: 'Tags', type: 'reference', target: 'taxonomy--tag', rel: 'many-to-many', required: false },
            ],
          },
        },
      ],
    },
    'content-type',
    'cardinality_test.json'
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  const fields = (result.schema as ParsedContentType).fields
  return Object.fromEntries(fields.map((f) => [f.name, f]))
}

const f = parsedFields()

describe('relationCardinality', () => {
  it('a one-to-one paragraph holds one item', () => {
    // MUTATION: return 'many' for every paragraph (today's REST/admin behaviour).
    expect(relationCardinality(f['link']!)).toBe('one')
  })

  it('a one-to-many paragraph holds a list', () => {
    // MUTATION: return 'one' for every paragraph.
    expect(relationCardinality(f['cards']!)).toBe('many')
  })

  it('a one-to-one reference holds one item', () => {
    // MUTATION: return 'many' for every reference.
    expect(relationCardinality(f['author']!)).toBe('one')
  })

  it('a deprecated one-to-many reference holds one item, matching its single FK column', () => {
    // MUTATION: `rel === 'one-to-one' ? 'one' : 'many'` for references (today's
    // admin/GraphQL rule), which calls one-to-many a list.
    expect(relationCardinality(f['category']!)).toBe('one')
  })

  it('a many-to-many reference holds a list', () => {
    // MUTATION: `rel === 'one-to-many' ? 'many' : 'one'` (today's codegen rule),
    // which calls many-to-many single.
    expect(relationCardinality(f['tags']!)).toBe('many')
  })

  it('is null for fields that are not relations, including single-valued media', () => {
    // MUTATION: return 'one' for any non-list field, which would make media
    // fields look like relations to every caller.
    expect(relationCardinality(f['title']!)).toBeNull()
    expect(relationCardinality(f['hero']!)).toBeNull()
  })
})
