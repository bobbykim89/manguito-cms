import { describe, it, expect } from 'vitest'
import { classifyVersion, type BakedVersionModel } from '../versions.js'

/** Live v1 and v3 (v2 retired), working schema v4. */
const MODEL: BakedVersionModel = {
  current: 'v4',
  live: ['v1', 'v3', 'v4'],
  projections: {},
}

describe('classifyVersion', () => {
  it('classifies a live version as live', () => {
    expect(classifyVersion('v1', MODEL)).toBe('live')
    expect(classifyVersion('v3', MODEL)).toBe('live')
  })

  it('classifies the current version as live', () => {
    expect(classifyVersion('v4', MODEL)).toBe('live')
  })

  it('classifies a gap below current as retired', () => {
    // v2 is not live and is below v4, so it was cut and later retired.
    expect(classifyVersion('v2', MODEL)).toBe('retired')
  })

  it('classifies a number above current as unknown', () => {
    // v5 was never cut — `current` is highest snapshot + 1, so nothing at or
    // above it can ever have existed.
    expect(classifyVersion('v5', MODEL)).toBe('unknown')
    expect(classifyVersion('v99', MODEL)).toBe('unknown')
  })

  it('classifies a non-version segment as not-a-version', () => {
    // This is what protects /api/media/:id from the catch-all. Without it the
    // catch-all would answer 404 VERSION_NOT_FOUND for every media request.
    expect(classifyVersion('media', MODEL)).toBe('not-a-version')
    expect(classifyVersion('v', MODEL)).toBe('not-a-version')
    expect(classifyVersion('vX', MODEL)).toBe('not-a-version')
    expect(classifyVersion('1', MODEL)).toBe('not-a-version')
    expect(classifyVersion('v1x', MODEL)).toBe('not-a-version')
    // Exercises the LEADING anchor. Without ^ this matches, then
    // parseInt('v1') is NaN, `NaN < current` is false, and the function
    // silently answers 'unknown' — so the catch-all would claim a path it
    // should have let fall through.
    expect(classifyVersion('xv1', MODEL)).toBe('not-a-version')
  })

  it('treats a leading-zero version as its own segment, not a live alias', () => {
    // 'v01' parses to 1 but is not the string 'v1', so it is not live. It is
    // below current, so it reads as retired rather than as v1's contract —
    // which is right: serving v1's data at a URL v1 never published would be
    // worse than a 410.
    expect(classifyVersion('v01', MODEL)).toBe('retired')
  })

  it('handles the single-version zero-config model', () => {
    const solo: BakedVersionModel = { current: 'v1', live: ['v1'], projections: {} }
    expect(classifyVersion('v1', solo)).toBe('live')
    expect(classifyVersion('v2', solo)).toBe('unknown')
  })
})
