import { describe, it, expect } from 'vitest'
import { createPublicPaths, normalizePrefix } from '../paths'

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

describe('createPublicPaths', () => {
  const p = createPublicPaths('/api')

  it('builds collection and item paths', () => {
    expect(p.collection('blog')).toBe('/api/blog')
    expect(p.item('blog')).toBe('/api/blog/:slug')
  })

  it('builds taxonomy paths', () => {
    expect(p.taxonomyCollection('tag')).toBe('/api/taxonomy/tag')
    expect(p.taxonomyItem('tag')).toBe('/api/taxonomy/tag/:id')
  })

  it('builds media and openapi paths', () => {
    expect(p.mediaCollection()).toBe('/api/media')
    expect(p.mediaItem()).toBe('/api/media/:id')
    expect(p.openapi()).toBe('/api/openapi.json')
  })

  it('honors a custom prefix', () => {
    const c = createPublicPaths('/content-api')
    expect(c.collection('blog')).toBe('/content-api/blog')
    expect(c.mediaItem()).toBe('/content-api/media/:id')
  })
})
