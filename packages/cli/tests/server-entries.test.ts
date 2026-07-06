import { describe, it, expect } from 'vitest'
import { appSetup } from '../src/codegen/server-entries.js'

describe('appSetup codegen', () => {
  it('threads config.api.rateLimit into the generated createCmsApp call', () => {
    expect(appSetup()).toContain(
      '...(config.api.rateLimit ? { rateLimit: config.api.rateLimit } : {})',
    )
  })
})
