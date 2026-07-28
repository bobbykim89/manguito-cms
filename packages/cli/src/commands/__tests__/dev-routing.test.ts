import { describe, it, expect } from 'vitest'
import { shouldBridgeToHono } from '../dev-routing.js'

// A path missing from this predicate does not 404 — it falls through to the
// Vite-served admin SPA, which renders the shell and makes Vue Router report
// "No match found for location ...". These cases pin which paths reach Hono.

describe('shouldBridgeToHono', () => {
  it('routes the public API prefix to Hono', () => {
    expect(shouldBridgeToHono('/api', '/api')).toBe(true)
    expect(shouldBridgeToHono('/api/posts', '/api')).toBe(true)
    expect(shouldBridgeToHono('/api/posts?page=2', '/api')).toBe(true)
  })

  it('routes the admin API to Hono', () => {
    expect(shouldBridgeToHono('/admin/api/config', '/api')).toBe(true)
  })

  it('honours a custom api prefix', () => {
    expect(shouldBridgeToHono('/content/posts', '/content')).toBe(true)
    expect(shouldBridgeToHono('/api/posts', '/content')).toBe(false)
  })

  // The regression this module exists for: /graphql is mounted at an absolute
  // path, a sibling of the /api prefix rather than nested under it.
  it('routes the GraphQL endpoint to Hono, with or without a query string', () => {
    expect(shouldBridgeToHono('/graphql', '/api')).toBe(true)
    expect(shouldBridgeToHono('/graphql?query=%7B__typename%7D', '/api')).toBe(true)
  })

  it('routes /graphql to Hono even under a non-default api prefix', () => {
    expect(shouldBridgeToHono('/graphql', '/content')).toBe(true)
  })

  it('leaves admin SPA and static routes to Vite', () => {
    for (const path of ['/', '/admin', '/admin/content/post', '/assets/index.js', '/favicon.ico']) {
      expect(shouldBridgeToHono(path, '/api'), path).toBe(false)
    }
  })

  it('does not match paths that merely start with the graphql segment', () => {
    expect(shouldBridgeToHono('/graphqlfoo', '/api')).toBe(false)
    expect(shouldBridgeToHono('/admin/graphql', '/api')).toBe(false)
  })
})
