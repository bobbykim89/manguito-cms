import { describe, it, expect } from 'vitest'
import { DateTimeScalar, JSONScalar } from '../scalars'

describe('DateTimeScalar', () => {
  it('serializes Date and ISO string to ISO-8601', () => {
    const d = new Date('2026-07-19T10:00:00.000Z')
    expect(DateTimeScalar.serialize(d)).toBe('2026-07-19T10:00:00.000Z')
    expect(DateTimeScalar.serialize('2026-07-19T10:00:00.000Z')).toBe('2026-07-19T10:00:00.000Z')
  })
})

describe('JSONScalar', () => {
  it('serializes arbitrary JSON values unchanged', () => {
    expect(JSONScalar.serialize({ a: 1 })).toEqual({ a: 1 })
    expect(JSONScalar.serialize([1, 2])).toEqual([1, 2])
    expect(JSONScalar.serialize('x')).toBe('x')
  })
})
