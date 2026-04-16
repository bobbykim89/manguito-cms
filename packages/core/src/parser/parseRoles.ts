import { z } from 'zod'
import type { Result, ParseError } from './loader'
import type { ParsedRoles, ParsedRole } from './validate'

// ─── Permission types ─────────────────────────────────────────────────────────

type PermissionTarget = 'content' | 'media' | 'taxonomy' | 'users' | 'roles'
type PermissionAction = 'read' | 'create' | 'edit' | 'delete'
export type Permission = `${PermissionTarget}:${PermissionAction}`

// All 17 valid permission strings. roles:create, roles:edit, roles:delete are
// excluded — roles are managed through schema files and CLI only.
const VALID_PERMISSIONS = new Set<Permission>([
  'content:read', 'content:create', 'content:edit', 'content:delete',
  'media:read',   'media:create',   'media:edit',   'media:delete',
  'taxonomy:read','taxonomy:create','taxonomy:edit','taxonomy:delete',
  'users:read',   'users:create',   'users:edit',   'users:delete',
  'roles:read',
])

// The three permission strings that look structurally valid but are explicitly
// forbidden — roles are not manageable through the admin panel or API.
const INVALID_ROLE_PERMISSIONS = new Set(['roles:create', 'roles:edit', 'roles:delete'])

// Sorted array for deterministic valid_permissions output.
export const VALID_PERMISSIONS_LIST: Permission[] = [
  'content:read', 'content:create', 'content:edit', 'content:delete',
  'media:read',   'media:create',   'media:edit',   'media:delete',
  'taxonomy:read','taxonomy:create','taxonomy:edit','taxonomy:delete',
  'users:read',   'users:create',   'users:edit',   'users:delete',
  'roles:read',
]

// ─── Zod validators ───────────────────────────────────────────────────────────

const RawRoleSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  is_system: z.boolean().default(false),
  hierarchy_level: z.number().int().min(0),
  permissions: z.array(z.string()),
})

const RawRolesFileSchema = z.object({
  roles: z.array(RawRoleSchema).min(1),
})

// ─── Internal helpers ─────────────────────────────────────────────────────────

function zodRolesErrorsToParseErrors(
  error: z.ZodError,
  sourceFile: string
): ParseError[] {
  return error.issues.map((issue) => ({
    file: sourceFile,
    code: 'MISSING_REQUIRED_FIELD' as const,
    message: issue.message,
    ...(issue.path.length > 0 ? { path: issue.path.join('.') } : {}),
  }))
}

// ─── parseRoles ───────────────────────────────────────────────────────────────

/**
 * Validates a raw roles.json object and produces a ParsedRoles value.
 *
 * Validation rules (all errors are accumulated — none stop early):
 *   MISSING_REQUIRED_FIELD   — name, label, hierarchy_level, or permissions absent
 *   INVALID_PERMISSION       — roles:create, roles:edit, or roles:delete present
 *   UNKNOWN_PERMISSION       — any other unrecognised permission string
 *   DUPLICATE_HIERARCHY_LEVEL — two roles share the same hierarchy_level value
 *
 * Returns Result<ParsedRoles> — never throws for expected failures.
 * sourceFile is optional; supply it for accurate error file paths.
 */
export function parseRoles(
  raw: unknown,
  sourceFile = 'roles/roles.json'
): Result<ParsedRoles> {
  const result = RawRolesFileSchema.safeParse(raw)
  if (!result.success) {
    return { ok: false, errors: zodRolesErrorsToParseErrors(result.error, sourceFile) }
  }

  const { roles } = result.data
  const errors: ParseError[] = []

  // ── Permission validation ──────────────────────────────────────────────────

  for (const role of roles) {
    for (let i = 0; i < role.permissions.length; i++) {
      const perm = role.permissions[i]!

      if (INVALID_ROLE_PERMISSIONS.has(perm)) {
        errors.push({
          file: sourceFile,
          code: 'INVALID_PERMISSION',
          message:
            `Role "${role.name}" contains invalid permission "${perm}" — ` +
            'roles:create, roles:edit, and roles:delete are not valid permissions; ' +
            'roles are managed through schema files and CLI only',
          path: `roles[${roles.indexOf(role)}].permissions[${i}]`,
        })
      } else if (!VALID_PERMISSIONS.has(perm as Permission)) {
        errors.push({
          file: sourceFile,
          code: 'UNKNOWN_PERMISSION',
          message: `Role "${role.name}" contains unknown permission "${perm}"`,
          path: `roles[${roles.indexOf(role)}].permissions[${i}]`,
        })
      }
    }
  }

  // ── Duplicate hierarchy_level check ───────────────────────────────────────

  const levelsSeen = new Map<number, string>() // level → first role name

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i]!
    const existing = levelsSeen.get(role.hierarchy_level)

    if (existing !== undefined) {
      errors.push({
        file: sourceFile,
        code: 'DUPLICATE_HIERARCHY_LEVEL',
        message:
          `Roles "${existing}" and "${role.name}" both have hierarchy_level ${role.hierarchy_level} — ` +
          'each role must have a unique hierarchy_level',
        path: `roles[${i}].hierarchy_level`,
      })
    } else {
      levelsSeen.set(role.hierarchy_level, role.name)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  // ── Build output ───────────────────────────────────────────────────────────

  const parsedRoles: ParsedRole[] = roles
    .map((r) => ({
      name: r.name,
      label: r.label,
      is_system: r.is_system,
      hierarchy_level: r.hierarchy_level,
      permissions: r.permissions as Permission[],
    }))
    .sort((a, b) => a.hierarchy_level - b.hierarchy_level)

  const parsed: ParsedRoles = {
    roles: parsedRoles,
    valid_permissions: VALID_PERMISSIONS_LIST,
  }

  return { ok: true, value: parsed }
}
