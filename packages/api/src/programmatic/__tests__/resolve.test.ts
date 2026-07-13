import { describe, it, expect, vi } from 'vitest'
import { programmaticField, type ProgrammaticFieldDefinition } from '@bobbykim/manguito-cms-core'
import { createProgrammaticResolver, resolverKey, validateResolverBindings, type ResolverMap } from '../resolve'

function mapOf(...defs: ProgrammaticFieldDefinition[]): ResolverMap {
  return new Map(defs.map((d) => [resolverKey(d.schema, d.field), d]))
}

const SCHEMA = 'content--blog_post'

describe('createProgrammaticResolver', () => {
  it('resolves same-row derived fields and merges them into the item', async () => {
    const def = programmaticField({ schema: SCHEMA, field: 'summary' }, (ctx) => `${ctx.get('title')}!`)
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const out = await resolveItem(SCHEMA, { id: '1', title: 'Hi' })
    expect(out).toEqual({ id: '1', title: 'Hi', summary: 'Hi!' })
  })

  it('coerces an undefined return to null', async () => {
    const def = programmaticField({ schema: SCHEMA, field: 'x' }, () => undefined as unknown as null)
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const out = await resolveItem(SCHEMA, { id: '1' })
    expect(out['x']).toBeNull()
  })

  it('returns fallback when the resolver throws', async () => {
    const def = programmaticField({ schema: SCHEMA, field: 'x', fallback: 'N/A' }, () => { throw new Error('boom') })
    const { resolveItem } = createProgrammaticResolver(mapOf(def), { onError: () => {} })
    const out = await resolveItem(SCHEMA, { id: '1' })
    expect(out['x']).toBe('N/A')
  })

  it('returns fallback (null default) when the resolver exceeds its timeout', async () => {
    const def = programmaticField(
      { schema: SCHEMA, field: 'x', timeout: 20 },
      () => new Promise((r) => setTimeout(() => r('late'), 200)),
    )
    const { resolveItem } = createProgrammaticResolver(mapOf(def), { onError: () => {} })
    const out = await resolveItem(SCHEMA, { id: '1' })
    expect(out['x']).toBeNull()
  })

  it('does not cache a failed result (retries on next read)', async () => {
    let calls = 0
    const def = programmaticField(
      { schema: SCHEMA, field: 'x', cache: { ttl: 60 }, fallback: 'FB' },
      () => {
        calls++
        if (calls === 1) throw new Error('boom')
        return 'ok'
      },
    )
    const { resolveItem } = createProgrammaticResolver(mapOf(def), { onError: () => {} })
    const a = await resolveItem(SCHEMA, { id: '1' })
    expect(a['x']).toBe('FB')   // first call failed -> fallback, not cached
    const b = await resolveItem(SCHEMA, { id: '1' })
    expect(b['x']).toBe('ok')   // retried -> success
    expect(calls).toBe(2)
  })

  it('caches by item id for the ttl window', async () => {
    let counter = 0
    const fn = vi.fn(() => ++counter)
    const def = programmaticField({ schema: SCHEMA, field: 'ts', cache: { ttl: 60 } }, fn)
    const { resolveItem } = createProgrammaticResolver(mapOf(def))
    const a = await resolveItem(SCHEMA, { id: '1' })
    const b = await resolveItem(SCHEMA, { id: '1' })
    expect(a['ts']).toBe(b['ts'])
    expect(fn).toHaveBeenCalledTimes(1)
    const c = await resolveItem(SCHEMA, { id: '2' })
    expect(fn).toHaveBeenCalledTimes(2)
    expect(c['ts']).not.toBe(a['ts'])
  })

  it('resolveList resolves only on_list fields', async () => {
    const listed = programmaticField({ schema: SCHEMA, field: 'shown', on_list: true }, () => 'yes')
    const hidden = programmaticField({ schema: SCHEMA, field: 'hidden' }, () => 'no')
    const { resolveList } = createProgrammaticResolver(mapOf(listed, hidden))
    const out = await resolveList(SCHEMA, [{ id: '1' }, { id: '2' }])
    expect(out).toEqual([{ id: '1', shown: 'yes' }, { id: '2', shown: 'yes' }])
  })

  it('hasSchema reflects whether any field targets the schema', () => {
    const def = programmaticField({ schema: SCHEMA, field: 'x' }, () => null)
    const r = createProgrammaticResolver(mapOf(def))
    expect(r.hasSchema(SCHEMA)).toBe(true)
    expect(r.hasSchema('content--other')).toBe(false)
  })
})

describe('validateResolverBindings', () => {
  const registry = {
    content_types: {
      'content--blog_post': {
        name: 'content--blog_post',
        fields: [
          { name: 'title', field_type: 'text/plain' },
          { name: 'summary', field_type: 'programmatic' },
        ],
      },
    },
    taxonomy_types: {},
  } as unknown as import('@bobbykim/manguito-cms-core').SchemaRegistry

  it('passes when every programmatic field has exactly one resolver', () => {
    const def = programmaticField({ schema: 'content--blog_post', field: 'summary' }, () => null)
    expect(() => validateResolverBindings(registry, mapOf(def))).not.toThrow()
  })

  it('throws when a programmatic field has no resolver', () => {
    expect(() => validateResolverBindings(registry, new Map())).toThrow(/summary/)
  })

  it('throws when a resolver targets a non-existent field', () => {
    const def = programmaticField({ schema: 'content--blog_post', field: 'ghost' }, () => null)
    expect(() => validateResolverBindings(registry, mapOf(def))).toThrow(/ghost/)
  })
})
