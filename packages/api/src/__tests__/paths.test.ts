import { describe, it, expect } from 'vitest'
import { createPublicPaths, createVersionedPaths, normalizePrefix } from '../paths'

describe('normalizePrefix', () => {
  it('defaults to /api', () => {
    expect(normalizePrefix(undefined)).toBe('/api')
  })

  it('adds a leading slash', () => {
    expect(normalizePrefix('content')).toBe('/content')
  })

  it('strips a trailing slash', () => {
    expect(normalizePrefix('/content/')).toBe('/content')
  })

  it('collapses a bare slash to the default', () => {
    expect(normalizePrefix('/')).toBe('/api')
  })
})

describe('createVersionedPaths', () => {
  it('inserts the version segment after the prefix', () => {
    const p = createVersionedPaths('/api', 'v2')
    expect(p.collection('blog')).toBe('/api/v2/blog')
    expect(p.item('blog')).toBe('/api/v2/blog/:slug')
    expect(p.taxonomyCollection('taxonomy--tag')).toBe('/api/v2/taxonomy/taxonomy--tag')
    expect(p.taxonomyItem('taxonomy--tag')).toBe('/api/v2/taxonomy/taxonomy--tag/:id')
  })

  it('omits the segment entirely when the version is null', () => {
    // The unversioned pass uses this, and its paths must be byte-identical to
    // what the app served before versioning existed — otherwise every existing
    // consumer breaks.
    const p = createVersionedPaths('/api', null)
    expect(p.collection('blog')).toBe('/api/blog')
    expect(p.item('blog')).toBe('/api/blog/:slug')
    expect(p.taxonomyCollection('taxonomy--tag')).toBe('/api/taxonomy/taxonomy--tag')
    expect(p.taxonomyItem('taxonomy--tag')).toBe('/api/taxonomy/taxonomy--tag/:id')
  })

  it('honours a custom prefix', () => {
    const p = createVersionedPaths('/content-api', 'v1')
    expect(p.collection('blog')).toBe('/content-api/v1/blog')
  })
})

describe('createPublicPaths', () => {
  it('keeps only the fixed surface, which never takes a version', () => {
    const p = createPublicPaths('/api')
    expect(p.mediaCollection()).toBe('/api/media')
    expect(p.mediaItem()).toBe('/api/media/:id')
    expect(p.openapi()).toBe('/api/openapi.json')
  })

  it('does not expose the schema-driven builders', () => {
    // The split is the enforcement: versioning media must be unexpressible,
    // not merely discouraged. If these ever reappear here, a caller can
    // accidentally build a versioned media path again.
    const p = createPublicPaths('/api') as Record<string, unknown>
    expect(p['collection']).toBeUndefined()
    expect(p['taxonomyCollection']).toBeUndefined()
  })
})
