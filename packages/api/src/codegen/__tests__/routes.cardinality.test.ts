import { describe, it, expect } from 'vitest'
import { fieldToZodSchema } from '../routes'
import { makeCardinalityFixture } from '../../__tests__/relation-cardinality.fixture'

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
