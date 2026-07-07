import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { resolveStaticFile } from '../static'

const BASE = resolve('/srv/app/admin')

describe('resolveStaticFile', () => {
  it('resolves a normal nested asset inside the base dir', () => {
    expect(resolveStaticFile(BASE, '/assets/app.js')).toBe(resolve(BASE, 'assets/app.js'))
  })

  it('resolves the root to the base dir itself', () => {
    expect(resolveStaticFile(BASE, '/')).toBe(BASE)
  })

  it('rejects parent-dir traversal', () => {
    expect(resolveStaticFile(BASE, '/../../../etc/passwd')).toBeNull()
  })

  it('rejects traversal that resolves to a sibling prefix', () => {
    // /srv/app/admin-secret must not be reachable from /srv/app/admin
    expect(resolveStaticFile(BASE, '/../admin-secret/x')).toBeNull()
  })

  it('rejects an embedded traversal segment', () => {
    expect(resolveStaticFile(BASE, '/assets/../../secret.env')).toBeNull()
  })
})
