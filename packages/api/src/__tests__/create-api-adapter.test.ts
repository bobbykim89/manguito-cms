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
