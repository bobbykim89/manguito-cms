import { describe, it, expect } from 'vitest'
import { buildRolesRegistry } from '../registry'
import type { ParsedRole } from '@bobbykim/manguito-cms-core'

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

describe('buildRolesRegistry', () => {
  it('succeeds with all five system roles — returns registry keyed by name', () => {
    const registry = buildRolesRegistry(SYSTEM_ROLES)

    expect(Object.keys(registry).sort()).toEqual(
      ['admin', 'editor', 'manager', 'viewer', 'writer'],
    )
    expect(registry['admin']?.hierarchy_level).toBe(0)
    expect(registry['manager']?.hierarchy_level).toBe(1)
    expect(registry['editor']?.hierarchy_level).toBe(2)
    expect(registry['writer']?.hierarchy_level).toBe(3)
    expect(registry['viewer']?.hierarchy_level).toBe(4)
  })

  it('throws on empty array with exact message from spec', () => {
    expect(() => buildRolesRegistry([])).toThrow(
      'Fatal: roles registry failed to build — roles array is empty. Run `manguito validate` to check your roles schema.',
    )
  })

  it('throws on missing system role "admin"', () => {
    const roles = SYSTEM_ROLES.filter((r) => r.name !== 'admin')

    expect(() => buildRolesRegistry(roles)).toThrow(
      'Fatal: roles registry failed to build — missing system role "admin". Run `manguito validate` to check your roles schema.',
    )
  })

  it('throws on duplicate hierarchy_level — message includes level and both role names', () => {
    const roles: ParsedRole[] = [
      ...SYSTEM_ROLES,
      { name: 'power-editor', label: 'Power Editor', is_system: false, hierarchy_level: 2, permissions: [] },
    ]

    expect(() => buildRolesRegistry(roles)).toThrow(
      'Fatal: roles registry failed to build — duplicate hierarchy_level 2 on roles "editor" and "power-editor". Run `manguito validate` to check your roles schema.',
    )
  })

  it('throws on duplicate role name', () => {
    const roles: ParsedRole[] = [
      ...SYSTEM_ROLES,
      { name: 'editor', label: 'Editor Clone', is_system: false, hierarchy_level: 10, permissions: [] },
    ]

    expect(() => buildRolesRegistry(roles)).toThrow(
      'Fatal: roles registry failed to build — duplicate role name "editor". Run `manguito validate` to check your roles schema.',
    )
  })
})
