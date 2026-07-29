import { describe, it, expect } from 'vitest'
import { createAPIAdapter } from '../index'

describe('createAPIAdapter', () => {
  it('omits rateLimit when not provided', () => {
    const adapter = createAPIAdapter({ prefix: '/api' })
    expect(adapter.rateLimit).toBeUndefined()
  })

  it('passes through a numeric findAll rateLimit config', () => {
    const adapter = createAPIAdapter({
      rateLimit: { findAll: { maxPerIp: 10, maxGlobal: 100, windowMs: 30_000 } },
    })
    expect(adapter.rateLimit).toEqual({
      findAll: { maxPerIp: 10, maxGlobal: 100, windowMs: 30_000 },
    })
  })

  it("passes through the '*' wildcard that disables the list limiter", () => {
    const adapter = createAPIAdapter({ rateLimit: { findAll: '*' } })
    expect(adapter.rateLimit).toEqual({ findAll: '*' })
  })
})

describe('createAPIAdapter graphql option', () => {
  it('omits graphql when not configured', () => {
    expect(createAPIAdapter({}).graphql).toBeUndefined()
  })

  it('resolves defaults when graphql is enabled', () => {
    const a = createAPIAdapter({ graphql: { enabled: true } })
    expect(a.graphql).toMatchObject({ enabled: true, maxDepth: 8, maxComplexity: 1000 })
    expect(typeof a.graphql!.graphiql).toBe('boolean')
    expect(typeof a.graphql!.introspection).toBe('boolean')
  })

  it('honours explicit overrides', () => {
    const a = createAPIAdapter({ graphql: { enabled: true, maxDepth: 5, graphiql: false } })
    expect(a.graphql).toMatchObject({ maxDepth: 5, graphiql: false })
  })
})
