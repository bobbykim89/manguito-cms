import { describe, it, expect, vi } from 'vitest'
import { NoSchemaIntrospectionCustomRule } from 'graphql'
import { buildArmorPlugin, introspectionPlugin } from '../security'

describe('security plugins', () => {
  describe('buildArmorPlugin', () => {
    it('builds armor plugins from depth/complexity options', () => {
      const { plugins } = buildArmorPlugin({ maxDepth: 8, maxComplexity: 1000 })
      expect(Array.isArray(plugins)).toBe(true)
      // The exact plugin count is an Armor implementation detail and may change across
      // versions. Real limit-enforcement behavior is proven end-to-end in integration tests.
      expect(plugins.length).toBeGreaterThan(0)
      expect(plugins.every(p => p && typeof p === 'object')).toBe(true)
    })

    it('returns a fresh plugin set on every call (not a cached singleton)', () => {
      const a = buildArmorPlugin({ maxDepth: 8, maxComplexity: 1000 })
      const b = buildArmorPlugin({ maxDepth: 4, maxComplexity: 50 })
      expect(a.plugins).not.toBe(b.plugins)
    })
  })

  describe('introspectionPlugin', () => {
    it('returns a plugin object exposing onValidate', () => {
      expect(introspectionPlugin(false)).toHaveProperty('onValidate')
      expect(introspectionPlugin(true)).toHaveProperty('onValidate')
      expect(typeof introspectionPlugin(false).onValidate).toBe('function')
    })

    it('adds NoSchemaIntrospectionCustomRule when introspection is disabled', () => {
      const addValidationRule = vi.fn()
      introspectionPlugin(false).onValidate({ addValidationRule })
      expect(addValidationRule).toHaveBeenCalledExactlyOnceWith(NoSchemaIntrospectionCustomRule)
    })

    it('does not add a validation rule when introspection is enabled', () => {
      const addValidationRule = vi.fn()
      introspectionPlugin(true).onValidate({ addValidationRule })
      expect(addValidationRule).not.toHaveBeenCalled()
    })
  })
})
