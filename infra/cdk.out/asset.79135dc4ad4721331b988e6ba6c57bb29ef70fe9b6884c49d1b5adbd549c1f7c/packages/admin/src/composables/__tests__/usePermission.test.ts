import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ParsedRole } from '@bobbykim/manguito-cms-core'
import { useAuthStore } from '../../stores/auth'
import { useSchemaStore } from '../../stores/schema'
import { usePermission } from '../usePermission'

// Five roles with clear hierarchy and distinct permission sets.
const roles: ParsedRole[] = [
  {
    name: 'admin',
    label: 'Admin',
    is_system: true,
    hierarchy_level: 0,
    permissions: [
      'content:read', 'content:create', 'content:edit', 'content:delete',
      'media:read', 'media:create', 'media:edit', 'media:delete',
      'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
      'users:read', 'users:create', 'users:edit', 'users:delete',
      'roles:read',
    ],
  },
  {
    name: 'manager',
    label: 'Manager',
    is_system: false,
    hierarchy_level: 1,
    permissions: [
      'content:read', 'content:create', 'content:edit', 'content:delete',
      'media:read', 'media:create',
      'taxonomy:read', 'taxonomy:create', 'taxonomy:edit',
      'users:read',
    ],
  },
  {
    name: 'editor',
    label: 'Editor',
    is_system: false,
    hierarchy_level: 2,
    permissions: ['content:read', 'content:create', 'content:edit', 'media:read'],
  },
  {
    name: 'writer',
    label: 'Writer',
    is_system: false,
    hierarchy_level: 3,
    permissions: ['content:read', 'content:create'],
  },
  {
    name: 'viewer',
    label: 'Viewer',
    is_system: false,
    hierarchy_level: 4,
    permissions: [],
  },
]

let authStore: ReturnType<typeof useAuthStore>
let schemaStore: ReturnType<typeof useSchemaStore>

beforeEach(() => {
  setActivePinia(createPinia())
  authStore = useAuthStore()
  schemaStore = useSchemaStore()
  schemaStore.setRoles(roles)
})

describe('usePermission', () => {
  describe('can()', () => {
    it('can("content:read") is true for editor', () => {
      authStore.setUser({ id: '1', email: 'editor@test.local', role: 'editor' })
      const { can } = usePermission()
      expect(can('content:read')).toBe(true)
    })

    it('can("content:read") is false for viewer who lacks it', () => {
      authStore.setUser({ id: '2', email: 'viewer@test.local', role: 'viewer' })
      const { can } = usePermission()
      expect(can('content:read')).toBe(false)
    })

    it('can("users:read") is false for editor', () => {
      authStore.setUser({ id: '1', email: 'editor@test.local', role: 'editor' })
      const { can } = usePermission()
      expect(can('users:read')).toBe(false)
    })
  })

  describe('rolesBelow()', () => {
    it('manager (level 1): returns editor, writer, viewer — never admin', () => {
      authStore.setUser({ id: '1', email: 'manager@test.local', role: 'manager' })
      const { rolesBelow } = usePermission()
      const below = rolesBelow()
      const names = below.map(r => r.name)

      expect(names).toContain('editor')
      expect(names).toContain('writer')
      expect(names).toContain('viewer')
      expect(names).not.toContain('admin')
      expect(names).not.toContain('manager')
    })

    it('admin (level 0): returns all roles except admin itself', () => {
      authStore.setUser({ id: '1', email: 'admin@test.local', role: 'admin' })
      const { rolesBelow } = usePermission()
      const below = rolesBelow()
      const names = below.map(r => r.name)

      expect(names).toContain('manager')
      expect(names).toContain('editor')
      expect(names).toContain('writer')
      expect(names).toContain('viewer')
      expect(names).not.toContain('admin')
    })
  })
})
