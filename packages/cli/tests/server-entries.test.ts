import { describe, it, expect } from 'vitest'
import { appSetup, serverEntry, adminStaticRoute } from '../src/codegen/server-entries.js'

describe('appSetup codegen', () => {
  it('threads config.api.rateLimit into the generated createCmsApp call', () => {
    expect(appSetup()).toContain(
      '...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {})',
    )
  })
})

describe('static serving hardening (codegen)', () => {
  const node = serverEntry({ adminPrefix: '/admin', apiPrefix: '/api' })
  const shared = adminStaticRoute('/admin')

  it('imports the shared runtime helpers instead of a local MIME map', () => {
    expect(node).toContain("from '@bobbykim/manguito-cms-api/runtime'")
    expect(shared).toContain("from '@bobbykim/manguito-cms-api/runtime'")
  })

  it('admin handlers use resolveStaticFile for containment (no bare resolve+.+rel)', () => {
    expect(node).toContain('resolveStaticFile(adminDir')
    expect(shared).toContain('resolveStaticFile(adminDir')
    expect(node).not.toContain("resolve(adminDir, '.' + rel)")
    expect(shared).not.toContain("resolve(adminDir, '.' + rel)")
  })

  it('uploads are served from the safe-inline allowlist and forced to attachment otherwise', () => {
    expect(node).toContain('SAFE_INLINE_MIME')
    expect(node).toContain('Content-Disposition')
  })
})
