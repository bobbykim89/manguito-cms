import { describe, it, expect } from 'vitest'
import { createLocalAdapter } from '../local'

describe('local adapter stat', () => {
  it('returns null for a missing key', async () => {
    const adapter = createLocalAdapter()
    expect(await adapter.stat?.('image/does-not-exist.png')).toBeNull()
  })

  it('returns size for an uploaded key', async () => {
    const adapter = createLocalAdapter()
    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    await adapter.upload?.('image/stat-test.png', bytes, 'image/png')
    const meta = await adapter.stat?.('image/stat-test.png')
    expect(meta?.size).toBe(5)
    await adapter.delete('image/stat-test.png')
  })
})
