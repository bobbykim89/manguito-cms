import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { linkDedupeSql, linkUniqueName } from '../link-tables'

const sha8 = (name: string) =>
  createHash('sha256').update(name).digest('hex').slice(0, 8)

describe('linkUniqueName', () => {
  // MUTATION: a plain `<name>_unique` with no fallback gives 64+ characters
  // for a 57-character name and fails the 63-character assertion.
  it('appends _unique when the result fits in 63 characters', () => {
    const name = 'a'.repeat(56)
    expect(linkUniqueName(name)).toBe(`${name}_unique`)
    expect(linkUniqueName(name)).toHaveLength(63)
  })

  it('falls back to a truncated, hashed name of exactly 63 characters', () => {
    const name = 'b'.repeat(57)
    const result = linkUniqueName(name)
    expect(result).toHaveLength(63)
    expect(result).toBe(`${name.slice(0, 47)}_${sha8(name)}_unique`)
  })

  // MUTATION: hashing the truncated name (first 47 chars) gives the same
  // result for names that share their first 47 characters.
  it('gives different results for long names sharing their first 47 characters', () => {
    const prefix = 'c'.repeat(47)
    const a = `${prefix}${'x'.repeat(13)}`
    const b = `${prefix}${'y'.repeat(13)}`
    expect(a).toHaveLength(60)
    expect(linkUniqueName(a)).not.toBe(linkUniqueName(b))
  })

  it('is deterministic', () => {
    const name = 'd'.repeat(60)
    expect(linkUniqueName(name)).toBe(linkUniqueName(name))
  })
})

describe('linkDedupeSql', () => {
  // MUTATION: reversing the comparison to `<` keeps the highest order; the
  // exact-string assertion rejects it, and Task 3's integration test checks
  // which row survives.
  it('keeps the lowest (order, ctid) row when the table has an order column', () => {
    expect(linkDedupeSql('t', 'left_id', 'right_id', true)).toBe(
      'DELETE FROM "t" a USING "t" b WHERE a."left_id" = b."left_id" AND a."right_id" = b."right_id" AND (a."order", a.ctid) > (b."order", b.ctid)',
    )
  })

  // MUTATION: always comparing on order references a column the table lacks.
  it('compares on ctid alone when there is no order column', () => {
    expect(linkDedupeSql('t', 'left_id', 'right_id', false)).toBe(
      'DELETE FROM "t" a USING "t" b WHERE a."left_id" = b."left_id" AND a."right_id" = b."right_id" AND a.ctid > b.ctid',
    )
  })
})
