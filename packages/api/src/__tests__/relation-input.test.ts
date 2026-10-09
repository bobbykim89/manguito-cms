import { describe, it, expect } from 'vitest'
import { checkRelationInput } from '../relation-input'
import { makeCardinalityFixture } from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcin')
const fields = fx.registry.content_types[fx.names.post]!.fields
const check = (body: Record<string, unknown>) => checkRelationInput(fields, body, fx.registry)

// UUID-shaped placeholder ids: reference values must be UUIDs.
const C = '0c000000-0000-4000-8000-000000000001'
const O = '0c000000-0000-4000-8000-000000000002'
const T = '0c000000-0000-4000-8000-000000000003'
const A = '0c000000-0000-4000-8000-000000000004'
const B = '0c000000-0000-4000-8000-000000000005'

describe('checkRelationInput', () => {
  it('accepts every correct shape, and null for "one" fields', () => {
    // MUTATION: reject null for a 'one' field. Clearing a one-to-one paragraph
    // or an optional reference would become impossible.
    expect(check({ link: { url: 'x' }, cards: [], category: C, owner: O, tags: [T] })).toEqual([])
    expect(check({ link: null, category: null })).toEqual([])
  })

  it('rejects a list for a "one" paragraph, naming the field', () => {
    // MUTATION: accept arrays for 'one' paragraphs (today's admin shape).
    expect(check({ link: [{ url: 'x' }] })).toEqual([
      { field: 'link', message: 'link holds one item: send an object or null.' },
    ])
  })

  it('rejects null for a "many" field', () => {
    // MUTATION: treat null as an empty list. A client's null would then
    // silently clear the field.
    expect(check({ cards: null, tags: null }).map((e) => e.field)).toEqual(['cards', 'tags'])
  })

  it('rejects a list for a "one" reference, and a string for a "many" reference', () => {
    // MUTATION: skip reference fields. `[a, b]` then reaches the database and 500s.
    expect(check({ category: [A, B], tags: A }).map((e) => e.field)).toEqual(['category', 'tags'])
  })

  it('rejects a "one" reference that is not a UUID, including the empty string', () => {
    // MUTATION: accept any string for a 'one' reference (the old typeof check).
    // A malformed id then reaches Postgres as 22P02 and the write 500s.
    expect(check({ owner: '', category: 'bogus' })).toEqual([
      { field: 'category', message: 'category holds one item: send a UUID string or null.' },
      { field: 'owner', message: 'owner holds one item: send a UUID string or null.' },
    ])
  })

  it('rejects a "many" reference with any id that is not a UUID', () => {
    // MUTATION: check only that each element is a string. `[valid, 'bogus']`
    // then deletes the existing links, inserts one, and fails part-way.
    expect(check({ tags: [A, 'bogus'] })).toEqual([
      { field: 'tags', message: 'tags holds a list: send an array of UUID strings.' },
    ])
    expect(check({ tags: [A, B.toUpperCase()] })).toEqual([])
  })

  it('checks paragraph items, with a path naming the nested field', () => {
    // MUTATION: do not descend into paragraph items.
    expect(check({ cards: [{ heading: 'h', card_link: [{ url: 'x' }], card_tag: T }] })).toEqual([
      { field: 'cards[0].card_link', message: 'cards[0].card_link holds one item: send an object or null.' },
    ])
  })

  it('ignores fields absent from the body', () => {
    // MUTATION: check every relation field, treating absent as undefined. A
    // title-only PATCH is then rejected.
    expect(check({ title: 'only' })).toEqual([])
  })
})
