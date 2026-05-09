import { describe, it, expect } from 'vitest'
import { createAPIAdapter } from '../app'
import type { StorageAdapter, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

const mockStorage: StorageAdapter = {
  type: 'local',
  upload: async () => ({ key: '', url: '' }),
  delete: async () => {},
  getUrl: () => '',
  getPresignedUploadUrl: async () => ({ upload_url: '', key: '', expires_at: 0 }),
}

const mockRegistry: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: [], valid_permissions: [] },
  schemas: {},
  content_types: {},
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

const mockDb = {} as unknown as DrizzlePostgresInstance

describe('createAPIAdapter', () => {
  it('throws on missing storage with correct message', () => {
    expect(() =>
      createAPIAdapter({
        storage: undefined as unknown as StorageAdapter,
        registry: mockRegistry,
        db: mockDb,
      })
    ).toThrow(/api\.storage is required but not configured/)
  })

  it('succeeds with storage provided', () => {
    const adapter = createAPIAdapter({
      storage: mockStorage,
      registry: mockRegistry,
      db: mockDb,
    })
    expect(adapter.app).toBeDefined()
    expect(adapter.prefix).toBe('/api')
  })
})
