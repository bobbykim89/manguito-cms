import { describe, it, expect } from 'vitest'
import { buildProjections } from '../projections'
import { makeContentType, makeRegistry, EMPTY_HISTORY, EMPTY_PENDING } from './fixtures'

describe('buildProjections', () => {
  it('gives current an identity projection', () => {
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'b' }])])
    const p = buildProjections({
      current, currentVersion: 'v1', snapshots: [], live: ['v1'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'a', exposed_as: 'a' },
      { column_name: 'b', exposed_as: 'b' },
    ])
  })

  it('exposes a renamed field under its OLD label in the old version', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'blog_title' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'title' }])])
    const history = {
      renames: [{ after: 'v1', type: 'content--post', from: 'blog_title', to: 'title' }],
      drops: [], fallbacks: {},
    }
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'blog_title' },
    ])
    expect(p['v2']!.types['content--post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'title' },
    ])
  })

  it('attaches a fallback to the right column', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--post', [{ name: 'a' }, { name: 'gone' }])]),
    }]
    const current = makeRegistry([makeContentType('content--post', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: { renames: [], drops: [], fallbacks: { 'content--post.gone': '' } },
      pending: EMPTY_PENDING,
    })
    const gone = p['v1']!.types['content--post']!.fields.find((f) => f.column_name === 'gone')!
    expect(gone.fallback).toBe('')
  })

  it('omits a type a version does not define', () => {
    const snapshots = [{
      version: 'v1',
      registry: makeRegistry([makeContentType('content--old', [{ name: 'a' }])]),
    }]
    const current = makeRegistry([makeContentType('content--new', [{ name: 'a' }])])
    const p = buildProjections({
      current, currentVersion: 'v2', snapshots, live: ['v1', 'v2'],
      history: EMPTY_HISTORY, pending: EMPTY_PENDING,
    })
    expect(p['v1']!.types['content--new']).toBeUndefined()
    expect(p['v2']!.types['content--old']).toBeUndefined()
  })
})
