import { describe, it, expect } from 'vitest'
import { programmaticField } from '../defineProgrammaticField'

describe('programmaticField', () => {
  it('returns a branded definition carrying options and resolver', async () => {
    const def = programmaticField(
      { schema: 'content--blog_post', field: 'blog_summary', cache: { ttl: 300 }, on_list: true },
      (ctx) => `${ctx.get('a')}-${ctx.get('b')}`,
    )
    expect(def.__manguito_programmatic).toBe(true)
    expect(def.schema).toBe('content--blog_post')
    expect(def.field).toBe('blog_summary')
    expect(def.cache).toEqual({ ttl: 300 })
    expect(def.on_list).toBe(true)

    const value = await def.resolve({ get: (n) => (n === 'a' ? 'x' : 'y'), record: { a: 'x', b: 'y' } })
    expect(value).toBe('x-y')
  })

  it('defaults optional options to undefined (no cache, no list, no fallback)', () => {
    const def = programmaticField({ schema: 'content--x', field: 'y' }, () => null)
    expect(def.cache).toBeUndefined()
    expect(def.on_list).toBeUndefined()
    expect(def.fallback).toBeUndefined()
    expect(def.timeout).toBeUndefined()
  })
})
