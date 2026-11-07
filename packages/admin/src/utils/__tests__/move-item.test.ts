import { describe, it, expect } from 'vitest'
import { moveItem } from '../move-item'

describe('moveItem', () => {
  it('moves an item earlier or later, shifting the ones between', () => {
    // MUTATION: swap the two items instead of moving one. [A, B, C, D] moved
    // 3 → 1 then reads [A, D, C, B].
    expect(moveItem(['A', 'B', 'C', 'D'], 3, 1)).toEqual(['A', 'D', 'B', 'C'])
    expect(moveItem(['A', 'B', 'C', 'D'], 0, 2)).toEqual(['B', 'C', 'A', 'D'])
  })

  it('returns an unchanged copy for the same index or an index outside the list', () => {
    // MUTATION: drop the bounds check. Moving past the end then inserts an
    // `undefined` or loses the item, and an editor's list gains a hole.
    const list = ['A', 'B']
    expect(moveItem(list, 1, 1)).toEqual(['A', 'B'])
    expect(moveItem(list, 1, 2)).toEqual(['A', 'B'])
    expect(moveItem(list, -1, 0)).toEqual(['A', 'B'])
    expect(moveItem(list, 0, 1)).not.toBe(list) // a copy, never the input
    expect(list).toEqual(['A', 'B'])
  })
})
