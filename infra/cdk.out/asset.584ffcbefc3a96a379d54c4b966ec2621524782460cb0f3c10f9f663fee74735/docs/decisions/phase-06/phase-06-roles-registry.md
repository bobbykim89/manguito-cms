# Decision — Roles Registry

> How the roles registry is constructed, validated, and made available to middleware at runtime.

---

## What It Is

The roles registry is a runtime lookup map — `Record<string, ParsedRole>` — that lets middleware do fast role lookups by name without hitting the DB on every request.

```ts
// example registry shape
{
  admin:   { name: 'admin',   hierarchy_level: 0, permissions: [...], is_system: true, ... },
  manager: { name: 'manager', hierarchy_level: 1, permissions: [...], is_system: true, ... },
  editor:  { name: 'editor',  hierarchy_level: 2, permissions: [...], is_system: true, ... },
  writer:  { name: 'writer',  hierarchy_level: 3, permissions: [...], is_system: true, ... },
  viewer:  { name: 'viewer',  hierarchy_level: 4, permissions: [...], is_system: true, ... },
}
```

---

## Where It Lives

`buildRolesRegistry()` is a pure function inside `packages/api/src/auth/registry.ts`. It is part of `@bobbykim/manguito-cms-api` — not `core`. This keeps `core` light and free of runtime construction logic.

```ts
// packages/api/src/auth/registry.ts
import type { ParsedRole } from '@bobbykim/manguito-cms-core'

export type RolesRegistry = Record<string, ParsedRole>

export function buildRolesRegistry(roles: ParsedRole[]): RolesRegistry {
  // validation runs first — throws before constructing anything
  validateRoles(roles)

  return Object.fromEntries(roles.map(role => [role.name, role]))
}
```

---

## When It Is Built

Built once inside `createAPIAdapter()` at server startup, before any request is handled. The result is closed over by all middleware factories — it never needs to be rebuilt mid-run because roles only change when the schema changes, which requires a full restart.

```ts
// packages/api/src/app.ts
export function createAPIAdapter(config: ResolvedManguitoConfig) {
  const rolesRegistry = buildRolesRegistry(config.parsedRoles)
  // rolesRegistry closed over by middleware below — immutable for server lifetime

  const authMiddleware = createAuthMiddleware(rolesRegistry)
  const requirePermission = createPermissionMiddleware(rolesRegistry)
  const requireHierarchy = createHierarchyMiddleware(rolesRegistry)

  // wired into Hono app...
}
```

---

## Startup Validation

`buildRolesRegistry` throws immediately and halts the process if the roles state is invalid. A broken registry must never allow the server to start — roles are foundational to auth and permission enforcement.

**Conditions that throw:**

| Condition | Error message |
|-----------|--------------|
| Empty roles array | `Fatal: roles registry failed to build — roles array is empty. Run \`manguito validate\` to check your roles schema.` |
| Missing system role (e.g. `admin`) | `Fatal: roles registry failed to build — missing system role "admin". Run \`manguito validate\` to check your roles schema.` |
| Duplicate `hierarchy_level` | `Fatal: roles registry failed to build — duplicate hierarchy_level ${level} on roles "${a}" and "${b}". Run \`manguito validate\` to check your roles schema.` |
| Duplicate role `name` | `Fatal: roles registry failed to build — duplicate role name "${name}". Run \`manguito validate\` to check your roles schema.` |

**Note:** The Phase 2 parser already validates `ParsedRoles` before they reach this point. These checks are a defense-in-depth safety net — in practice they should never trigger in a correctly configured project.

**Required system roles:** `admin`, `manager`, `editor`, `writer`, `viewer`. All five must be present. Custom roles may be added alongside them.

---

## How Middleware Accesses It

The registry is passed into middleware factories via closure — no globals, no module-level singletons, no Hono context attachment. This makes middleware easy to unit test by passing in a mock registry.

```ts
// requirePermission receives registry at factory time — not per request
function createPermissionMiddleware(registry: RolesRegistry) {
  return function requirePermission(permission: Permission) {
    return async (c: Context, next: Next) => {
      const user = c.get('user')
      const role = registry[user.role]
      if (!role?.permissions.includes(permission)) {
        return c.json({ ok: false, error: { code: 'INSUFFICIENT_PERMISSION' } }, 403)
      }
      await next()
    }
  }
}
```

---

## Immutability

The registry is a plain object constructed once and never mutated. Roles only change when `roles.json` is edited and the project is rebuilt and restarted. There is no mechanism for runtime role mutation — this is by design.
