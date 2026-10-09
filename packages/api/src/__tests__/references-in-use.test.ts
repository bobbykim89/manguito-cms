import { describe, it, expect } from 'vitest'
import { inUseMessage, isForeignKeyViolation } from '../references-in-use'

describe('inUseMessage', () => {
  it('totals the uses and names each location by its labels', () => {
    // MUTATION: list counts without labels, or report the location count (2)
    // instead of the item total (3).
    expect(
      inUseMessage([
        { type_label: 'Blog Post', field_label: 'Author', count: 2 },
        { type_label: 'Card', field_label: 'Link target', count: 1 },
      ])
    ).toBe('This item is still used by 3 items: 2 in Blog Post (Author), 1 in Card (Link target). Remove it from those first.')
  })

  it('uses the singular for one use', () => {
    // MUTATION: always "items".
    expect(inUseMessage([{ type_label: 'Post', field_label: 'Owner', count: 1 }])).toBe(
      'This item is still used by 1 item: 1 in Post (Owner). Remove it from those first.'
    )
  })
})

describe('isForeignKeyViolation', () => {
  it('finds SQLSTATE 23503 on the error or on its cause', () => {
    // MUTATION: check only err.code. Drizzle wraps the driver error in `cause`,
    // so the race backstop would miss it and 500.
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true)
    expect(isForeignKeyViolation(Object.assign(new Error('Failed query'), { cause: { code: '23503' } }))).toBe(true)
  })

  it('is false for other errors', () => {
    // MUTATION: treat every database error as "in use".
    expect(isForeignKeyViolation(Object.assign(new Error('x'), { cause: { code: '23505' } }))).toBe(false)
    expect(isForeignKeyViolation(new Error('x'))).toBe(false)
  })
})
