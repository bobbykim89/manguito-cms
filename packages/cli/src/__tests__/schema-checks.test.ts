import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@bobbykim/manguito-cms-core', () => ({
  validateCrossReferences: vi.fn(),
}))
vi.mock('@bobbykim/manguito-cms-db', () => ({
  findConstraintNameCollisions: vi.fn(),
}))

import { validateCrossReferences } from '@bobbykim/manguito-cms-core'
import { findConstraintNameCollisions } from '@bobbykim/manguito-cms-db'
import { checkRegistry } from '../utils/schema-checks.js'

const registry = {} as never
const crossRef = { file: 'a.json', code: 'UNSUPPORTED_RELATION', message: 'cross' }
const collision = { file: 'b.json', code: 'CONSTRAINT_NAME_COLLISION', message: 'collide' }

describe('checkRegistry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns cross-reference errors without running the collision check', () => {
    // MUTATION: always run the collision check too (or run it first) fails the not-called assertion.
    vi.mocked(validateCrossReferences).mockReturnValue([crossRef] as never)
    vi.mocked(findConstraintNameCollisions).mockReturnValue([collision] as never)

    expect(checkRegistry(registry, 5)).toEqual([crossRef])
    expect(validateCrossReferences).toHaveBeenCalledWith(registry, 5)
    expect(findConstraintNameCollisions).not.toHaveBeenCalled()
  })

  it('returns the collision errors when the references are sound', () => {
    // MUTATION: returning only cross-reference errors yields [] here.
    vi.mocked(validateCrossReferences).mockReturnValue([])
    vi.mocked(findConstraintNameCollisions).mockReturnValue([collision] as never)

    expect(checkRegistry(registry, undefined)).toEqual([collision])
    expect(findConstraintNameCollisions).toHaveBeenCalledWith(registry)
  })
})
