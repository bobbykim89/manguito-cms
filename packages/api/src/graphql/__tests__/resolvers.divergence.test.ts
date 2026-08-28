import { describe, it, expect } from 'vitest'
import { divergentTextField } from '../../field-keys.test-fixtures'
import { resolveFieldValue } from '../resolvers'

describe('GraphQL field value resolution with a divergent label', () => {
  it('reads the storage column, not the label', () => {
    const row = { id: 'c1', blog_title: 'Hello' }
    expect(resolveFieldValue(divergentTextField, row)).toBe('Hello')
  })

  it('returns null when the column is absent', () => {
    expect(resolveFieldValue(divergentTextField, { id: 'c1' })).toBeNull()
  })
})
