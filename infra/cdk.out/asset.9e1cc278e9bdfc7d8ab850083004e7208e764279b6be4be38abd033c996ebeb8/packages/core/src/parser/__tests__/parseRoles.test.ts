import { describe, it, expect } from 'vitest'
import { parseRoles, VALID_PERMISSIONS_LIST } from '../parseRoles'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// The five canonical system roles from phase-02-roles-and-auth-design.md
const SYSTEM_ROLES_RAW: unknown = {
  roles: [
    {
      name: 'admin',
      label: 'Administrator',
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
      is_system: true,
      hierarchy_level: 1,
      permissions: [
        'content:read', 'content:create', 'content:edit', 'content:delete',
        'media:read', 'media:create', 'media:edit', 'media:delete',
        'taxonomy:read', 'taxonomy:create', 'taxonomy:edit', 'taxonomy:delete',
        'users:read', 'users:create', 'users:edit',
        'roles:read',
      ],
    },
    {
      name: 'editor',
      label: 'Editor',
      is_system: true,
      hierarchy_level: 2,
      permissions: [
        'content:read', 'content:create', 'content:edit',
        'media:read', 'media:create', 'media:edit',
        'taxonomy:read', 'taxonomy:create', 'taxonomy:edit',
      ],
    },
    {
      name: 'writer',
      label: 'Writer',
      is_system: true,
      hierarchy_level: 3,
      permissions: [
        'content:read', 'content:create', 'content:edit',
        'media:read', 'media:create',
        'taxonomy:read',
      ],
    },
    {
      name: 'viewer',
      label: 'Viewer',
      is_system: true,
      hierarchy_level: 4,
      permissions: ['content:read', 'media:read', 'taxonomy:read'],
    },
  ],
}

// ─── Valid parse ──────────────────────────────────────────────────────────────

describe('parseRoles — valid roles.json', () => {
  it('returns ok: true with ParsedRoles value — never throws', () => {
    const result = parseRoles(SYSTEM_ROLES_RAW, 'schemas/roles/roles.json')

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toBeDefined()
    expect(result.value.roles).toHaveLength(5)
  })

  it('roles are sorted ascending by hierarchy_level', () => {
    // Submit the roles in reverse order to confirm the parser always sorts.
    const reversed: unknown = {
      roles: [
        { name: 'viewer', label: 'Viewer', is_system: true, hierarchy_level: 4, permissions: ['content:read'] },
        { name: 'editor', label: 'Editor', is_system: true, hierarchy_level: 2, permissions: ['content:read'] },
        { name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0, permissions: ['content:read', 'roles:read'] },
        { name: 'writer', label: 'Writer', is_system: true, hierarchy_level: 3, permissions: ['content:read'] },
        { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: ['content:read', 'roles:read'] },
      ],
    }

    const result = parseRoles(reversed)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const levels = result.value.roles.map((r) => r.hierarchy_level)
    expect(levels).toEqual([0, 1, 2, 3, 4])

    const names = result.value.roles.map((r) => r.name)
    expect(names[0]).toBe('admin')
    expect(names[4]).toBe('viewer')
  })

  it('parsed output preserves name, label, is_system, hierarchy_level, permissions', () => {
    const result = parseRoles(SYSTEM_ROLES_RAW)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const admin = result.value.roles.find((r) => r.name === 'admin')!
    expect(admin).toBeDefined()
    expect(admin.label).toBe('Administrator')
    expect(admin.is_system).toBe(true)
    expect(admin.hierarchy_level).toBe(0)
    expect(admin.permissions).toContain('content:read')
    expect(admin.permissions).toContain('roles:read')
  })

  it('valid_permissions contains the complete list of valid permission strings', () => {
    const result = parseRoles(SYSTEM_ROLES_RAW)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Must include all 17 valid permissions (roles:read is the only roles:* entry)
    expect(result.value.valid_permissions).toEqual(VALID_PERMISSIONS_LIST)
    expect(result.value.valid_permissions).toContain('roles:read')
    expect(result.value.valid_permissions).not.toContain('roles:create')
    expect(result.value.valid_permissions).not.toContain('roles:edit')
    expect(result.value.valid_permissions).not.toContain('roles:delete')
  })

  it('is_system defaults to false when omitted', () => {
    const raw: unknown = {
      roles: [
        {
          name: 'custom_role',
          label: 'Custom Role',
          // is_system intentionally omitted
          hierarchy_level: 5,
          permissions: ['content:read'],
        },
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.roles[0]?.is_system).toBe(false)
  })

  it('sourceFile defaults to roles/roles.json when omitted', () => {
    // Parse with a deliberate error so we can observe the file path on the error.
    const raw: unknown = {
      roles: [
        { name: 'a', label: 'A', hierarchy_level: 0, permissions: ['totally:unknown'] },
      ],
    }

    const result = parseRoles(raw) // no sourceFile argument
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors[0]?.file).toBe('roles/roles.json')
  })
})

// ─── DUPLICATE_HIERARCHY_LEVEL ────────────────────────────────────────────────

describe('parseRoles — DUPLICATE_HIERARCHY_LEVEL', () => {
  it('returns DUPLICATE_HIERARCHY_LEVEL when two roles share the same hierarchy_level', () => {
    const raw: unknown = {
      roles: [
        { name: 'admin', label: 'Admin', is_system: true, hierarchy_level: 0, permissions: ['content:read', 'roles:read'] },
        { name: 'super_manager', label: 'Super Manager', is_system: false, hierarchy_level: 1, permissions: ['content:read', 'roles:read'] },
        { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: ['content:read', 'roles:read'] }, // duplicate level 1
      ],
    }

    const result = parseRoles(raw, 'schemas/roles/roles.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('DUPLICATE_HIERARCHY_LEVEL')

    const err = result.errors.find((e) => e.code === 'DUPLICATE_HIERARCHY_LEVEL')!
    expect(err.file).toBe('schemas/roles/roles.json')
    expect(err.message).toContain('manager')
    expect(err.message).toContain('super_manager')
    expect(err.message).toContain('1') // the shared hierarchy_level
    // error is returned, never thrown
  })

  it('accumulates all DUPLICATE_HIERARCHY_LEVEL errors when multiple levels conflict', () => {
    const raw: unknown = {
      roles: [
        { name: 'role_a', label: 'A', hierarchy_level: 0, permissions: ['content:read'] },
        { name: 'role_b', label: 'B', hierarchy_level: 0, permissions: ['content:read'] }, // duplicate 0
        { name: 'role_c', label: 'C', hierarchy_level: 2, permissions: ['content:read'] },
        { name: 'role_d', label: 'D', hierarchy_level: 2, permissions: ['content:read'] }, // duplicate 2
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return

    const dupeErrors = result.errors.filter((e) => e.code === 'DUPLICATE_HIERARCHY_LEVEL')
    expect(dupeErrors).toHaveLength(2) // one per duplicate
  })
})

// ─── UNKNOWN_PERMISSION ───────────────────────────────────────────────────────

describe('parseRoles — UNKNOWN_PERMISSION', () => {
  it('returns UNKNOWN_PERMISSION when a role includes an unrecognised permission string', () => {
    const raw: unknown = {
      roles: [
        {
          name: 'editor',
          label: 'Editor',
          is_system: true,
          hierarchy_level: 2,
          permissions: ['content:read', 'widgets:manage'], // unknown
        },
      ],
    }

    const result = parseRoles(raw, 'schemas/roles/roles.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('UNKNOWN_PERMISSION')

    const err = result.errors.find((e) => e.code === 'UNKNOWN_PERMISSION')!
    expect(err.file).toBe('schemas/roles/roles.json')
    expect(err.message).toContain('widgets:manage')
    expect(err.message).toContain('editor')
  })

  it('accumulates all UNKNOWN_PERMISSION errors across all roles', () => {
    const raw: unknown = {
      roles: [
        { name: 'role_a', label: 'A', hierarchy_level: 0, permissions: ['content:read', 'unknown:one', 'unknown:two'] },
        { name: 'role_b', label: 'B', hierarchy_level: 1, permissions: ['content:read', 'another:unknown'] },
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return

    const unknownErrors = result.errors.filter((e) => e.code === 'UNKNOWN_PERMISSION')
    expect(unknownErrors).toHaveLength(3) // two in role_a, one in role_b
  })

  it('error path pinpoints the offending permission index', () => {
    const raw: unknown = {
      roles: [
        {
          name: 'editor',
          label: 'Editor',
          hierarchy_level: 0,
          permissions: ['content:read', 'bogus:perm'], // index 1
        },
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return

    const err = result.errors.find((e) => e.code === 'UNKNOWN_PERMISSION')!
    expect(err.path).toBe('roles[0].permissions[1]')
  })
})

// ─── INVALID_PERMISSION ───────────────────────────────────────────────────────

describe('parseRoles — INVALID_PERMISSION', () => {
  it('returns INVALID_PERMISSION when roles:create appears in a permissions array', () => {
    const raw: unknown = {
      roles: [
        {
          name: 'admin',
          label: 'Admin',
          is_system: true,
          hierarchy_level: 0,
          permissions: [
            'content:read',
            'roles:read',
            'roles:create', // explicitly forbidden
          ],
        },
      ],
    }

    const result = parseRoles(raw, 'schemas/roles/roles.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('INVALID_PERMISSION')

    const err = result.errors.find((e) => e.code === 'INVALID_PERMISSION')!
    expect(err.file).toBe('schemas/roles/roles.json')
    expect(err.message).toContain('roles:create')
    expect(err.message).toContain('admin')
  })

  it('returns INVALID_PERMISSION for roles:edit', () => {
    const raw: unknown = {
      roles: [
        { name: 'admin', label: 'Admin', hierarchy_level: 0, permissions: ['roles:edit'] },
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((e) => e.code === 'INVALID_PERMISSION')).toBe(true)
  })

  it('returns INVALID_PERMISSION for roles:delete', () => {
    const raw: unknown = {
      roles: [
        { name: 'admin', label: 'Admin', hierarchy_level: 0, permissions: ['roles:delete'] },
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((e) => e.code === 'INVALID_PERMISSION')).toBe(true)
  })

  it('INVALID_PERMISSION error path pinpoints the offending permission index', () => {
    const raw: unknown = {
      roles: [
        {
          name: 'admin',
          label: 'Admin',
          hierarchy_level: 0,
          permissions: ['content:read', 'roles:create'], // index 1
        },
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return

    const err = result.errors.find((e) => e.code === 'INVALID_PERMISSION')!
    expect(err.path).toBe('roles[0].permissions[1]')
  })

  it('distinguishes INVALID_PERMISSION from UNKNOWN_PERMISSION — roles:create is not just unknown', () => {
    // roles:create is structurally valid (target:action format) but explicitly forbidden.
    // It should produce INVALID_PERMISSION, not UNKNOWN_PERMISSION.
    const raw: unknown = {
      roles: [
        { name: 'admin', label: 'Admin', hierarchy_level: 0, permissions: ['roles:create'] },
      ],
    }

    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.errors.some((e) => e.code === 'INVALID_PERMISSION')).toBe(true)
    expect(result.errors.some((e) => e.code === 'UNKNOWN_PERMISSION')).toBe(false)
  })
})

// ─── MISSING_REQUIRED_FIELD via Zod ───────────────────────────────────────────

describe('parseRoles — MISSING_REQUIRED_FIELD', () => {
  it('returns MISSING_REQUIRED_FIELD when a role is missing the label field', () => {
    const raw: unknown = {
      roles: [
        {
          name: 'editor',
          // label omitted
          hierarchy_level: 2,
          permissions: ['content:read'],
        },
      ],
    }

    const result = parseRoles(raw, 'schemas/roles/roles.json')

    expect(result.ok).toBe(false)
    if (result.ok) return

    const codes = result.errors.map((e) => e.code)
    expect(codes).toContain('MISSING_REQUIRED_FIELD')
    expect(result.errors[0]?.file).toBe('schemas/roles/roles.json')
  })

  it('returns an error when the roles array itself is empty', () => {
    const raw: unknown = { roles: [] }
    const result = parseRoles(raw)
    expect(result.ok).toBe(false)
  })

  it('returns an error when raw input is null', () => {
    const result = parseRoles(null)
    expect(result.ok).toBe(false)
    // never throws for expected failures
  })
})
