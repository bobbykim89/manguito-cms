# Decision — Phase 6 Package Boundaries

> Defines which auth-related code lives in which package.

---

## Principle

`@bobbykim/manguito-cms-core` stays light — shared types and pure utilities only, no runtime behavior. Auth logic that is HTTP-specific lives in `api`. Auth logic that is CLI-specific lives in `cli`. Neither `api` nor `cli` imports from the other.

---

## Package Responsibilities

### `@bobbykim/manguito-cms-core`

Shared types and pure utilities consumed by multiple packages:

```ts
// Types
type Permission = `${PermissionTarget}:${PermissionAction}`
type JWTPayload = {
  user_id: string
  role: string
  token_version: number
  expires_at: number
}
type ParsedRole = {
  name: string
  label: string
  is_system: boolean
  hierarchy_level: number
  permissions: Permission[]
}
type User = {
  id: string
  email: string
  password_hash: string
  role_id: string
  token_version: number
  must_change_password: boolean
  created_at: Date
  updated_at: Date
}

// Utilities
export async function hashPassword(password: string): Promise<string>
export async function verifyPassword(password: string, stored: string): Promise<boolean>
```

**Why `hashPassword`/`verifyPassword` live in `core`:** Both `api` (user creation, login) and `cli` (`users:reset-password`, `createsuperuser`) need password hashing. Duplicating this logic would be wrong. `core` is the correct shared home.

**New error codes added to `ErrorCode` enum:**
- `INVALID_CREDENTIALS` — login failure (wrong password or unknown email)
- `PASSWORD_CHANGE_REQUIRED` — request blocked until password is changed
- `INVALID_ROLE` — unknown role name provided

---

### `@bobbykim/manguito-cms-api`

Everything HTTP and Hono-specific:

- `buildRolesRegistry()` — constructs `Record<string, ParsedRole>` at startup from `ParsedRoles`
- JWT signing and verification helpers (`hono/jwt`)
- Cookie read/write helpers (`hono/cookie`)
- `authMiddleware` — full JWT + `token_version` verification
- `mustChangePasswordCheck` — blocks requests when `must_change_password` is set
- `requirePermission()` — permission middleware factory
- `requireHierarchy()` — hierarchy middleware factory
- Auth endpoints — login / refresh / logout
- User management routes — `/admin/api/users/*`
- Config and schema endpoints

**`api` never imports from `cli`.**

---

### `@bobbykim/manguito-cms-cli`

CLI commands that interact with the DB directly, bypassing HTTP entirely:

- `users:promote` — promotes existing user to admin
- `users:demote` — demotes admin to specified role
- `users:reset-password` — resets a user's password directly in DB
- `createsuperuser` — creates first admin user on init

**Imports from:**
- `@bobbykim/manguito-cms-core` — for `hashPassword`, types
- `@bobbykim/manguito-cms-db` — for direct DB queries

**Never imports from `@bobbykim/manguito-cms-api`** — CLI commands never go through HTTP.

---

### `@bobbykim/manguito-cms-admin`

Vue 3 frontend — communicates with `api` over HTTP only. No direct imports from `api`, `db`, or `cli`.

---

## Dependency Graph

```
core   ←──── api
core   ←──── cli
core   ←──── db
db     ←──── cli
api    ←──── (consumed by admin over HTTP — no import)
```

No circular dependencies. `api` and `cli` are peers — neither imports the other.
