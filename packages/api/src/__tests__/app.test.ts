import { describe, it, expect } from 'vitest'
import { createAPIAdapter } from '../app'
import type { StorageAdapter, SchemaRegistry, ParsedRole } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// All five system roles are required by buildRolesRegistry.
const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const mockStorage: StorageAdapter = {
  type: 'local',
  upload: async () => ({ key: '', url: '' }),
  delete: async () => {},
  getUrl: () => '',
  getPresignedUploadUrl: async () => ({ upload_url: '', key: '', expires_at: 0 }),
}

const mockRegistry: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
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
