import type { ParsedRole } from '@bobbykim/manguito-cms-core'

export type RolesRegistry = Record<string, ParsedRole>

const SYSTEM_ROLES = ['admin', 'manager', 'editor', 'writer', 'viewer'] as const

function validateRoles(roles: ParsedRole[]): void {
  if (roles.length === 0) {
    throw new Error(
      'Fatal: roles registry failed to build — roles array is empty. Run `manguito validate` to check your roles schema.',
    )
  }

  const nameSet = new Set(roles.map((r) => r.name))
  for (const systemRole of SYSTEM_ROLES) {
    if (!nameSet.has(systemRole)) {
      throw new Error(
        `Fatal: roles registry failed to build — missing system role "${systemRole}". Run \`manguito validate\` to check your roles schema.`,
      )
    }
  }

  const levelsSeen = new Map<number, string>()
  for (const role of roles) {
    const existing = levelsSeen.get(role.hierarchy_level)
    if (existing !== undefined) {
      throw new Error(
        `Fatal: roles registry failed to build — duplicate hierarchy_level ${role.hierarchy_level} on roles "${existing}" and "${role.name}". Run \`manguito validate\` to check your roles schema.`,
      )
    }
    levelsSeen.set(role.hierarchy_level, role.name)
  }

  const namesSeen = new Set<string>()
  for (const role of roles) {
    if (namesSeen.has(role.name)) {
      throw new Error(
        `Fatal: roles registry failed to build — duplicate role name "${role.name}". Run \`manguito validate\` to check your roles schema.`,
      )
    }
    namesSeen.add(role.name)
  }
}

export function buildRolesRegistry(roles: ParsedRole[]): RolesRegistry {
  validateRoles(roles)
  return Object.fromEntries(roles.map((r) => [r.name, r]))
}
