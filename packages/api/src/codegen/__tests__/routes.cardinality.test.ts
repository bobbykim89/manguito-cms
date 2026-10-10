import { describe, it, expect } from 'vitest'
import { fieldToZodSchema, generateContentSchema, generateRoutes } from '../routes'
import type { ParsedTaxonomyType } from '@bobbykim/manguito-cms-core'
import { makeCardinalityFixture, parseOrThrow } from '../../__tests__/relation-cardinality.fixture'

const fx = makeCardinalityFixture('rccg')
const post = fx.registry.content_types[fx.names.post]!
const field = (name: string) => post.fields.find((f) => f.name === name)!

describe('fieldToZodSchema list-ness follows relationCardinality', () => {
  it('types a many-to-many reference as an array of ids', () => {
    // MUTATION: keep `ui.rel === 'one-to-many' ? 'z.array(...)' : 'z.string().uuid()'`,
    // which types many-to-many as a single id (the bug this fixes).
    expect(fieldToZodSchema(field('tags'), fx.registry)).toBe('z.array(z.string().uuid())')
  })
  it('types a deprecated one-to-many reference as a single id', () => {
    // MUTATION: the same old rule, which types one-to-many as an array.
    expect(fieldToZodSchema(field('category'), fx.registry)).toBe('z.string().uuid()')
  })
  it('types a one-to-one paragraph as an object, a one-to-many as an array', () => {
    // MUTATION: wrap every paragraph in z.array.
    expect(fieldToZodSchema(field('link'), fx.registry).startsWith('z.array(')).toBe(false)
    expect(fieldToZodSchema(field('cards'), fx.registry).startsWith('z.array(')).toBe(true)
  })
})

// #56: the generated docs agree with what the API stores and returns.
describe('generated schemas and routes follow the relation contract', () => {
  const entryIn = (schema: string, name: string) => {
    const line = schema.split('\n').find((l) => l.trim().startsWith(`${name}:`))
    if (!line) throw new Error(`no "${name}" entry in the generated schema`)
    return line.trim()
  }
  const schema = generateContentSchema(post, fx.registry)
  const entry = (name: string) => entryIn(schema, name)

  it('lets an optional "one" relation be null', () => {
    // MUTATION: drop the `.nullable()` in fieldEntrySchema. The docs then
    // reject the null the API accepts and returns for an empty link.
    expect(entry('link')).toMatch(/\.nullable\(\)\.optional\(\),?$/)
    expect(entry('category')).toBe('category: z.string().uuid().nullable().optional(),')
  })

  it('never makes a list relation or a required field nullable', () => {
    // MUTATION: add `.nullable()` whenever the field is nullable, lists
    // included. The API answers [] for an empty list and refuses null.
    expect(entry('tags')).toBe('tags: z.array(z.string().uuid()).optional(),')
    expect(entry('cards')).toMatch(/\)\)\.optional\(\),$/)
    expect(entry('owner')).toBe('owner: z.string().uuid(),')
  })

  it('follows the column for scalar fields: an optional boolean is never null', () => {
    // MUTATION: decide nullability from `f.nullable` (that is, !required). An
    // optional boolean is NOT NULL with a default, so the docs would invite a
    // null that Postgres refuses.
    const flags = parseOrThrow(
      {
        name: 'taxonomy--rccg_flag',
        label: 'Flag',
        type: 'taxonomy-type',
        fields: [
          { name: 'featured', label: 'Featured', type: 'boolean', required: false },
          { name: 'note', label: 'Note', type: 'text/plain', required: false },
        ],
      },
      'taxonomy-type'
    ) as ParsedTaxonomyType
    const out = generateContentSchema(flags)
    expect(entryIn(out, 'featured')).toBe('featured: z.boolean().optional(),')
    expect(entryIn(out, 'note')).toBe('note: z.string().nullable().optional(),')
  })

  it('documents ITEM_IN_USE (409) on the content and taxonomy deletes', () => {
    // MUTATION: leave 409 out of either generated DELETE route.
    const routes = generateRoutes(fx.registry)
    const deletes = routes.split('export const ').filter((r) => r.startsWith('adminDelete'))
    expect(deletes).toHaveLength(2)
    for (const route of deletes) expect(route).toContain('409: {')
  })
})
