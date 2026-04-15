# Decision — Auth Middleware and JWT Strategy

> Deferred to Phase 6 (Auth module). Captured here from Phase 2 discussions for future reference.

---

## Libraries

| Concern | Library | Rationale |
| ------- | ------- | --------- |
| JWT signing and verification | `hono/jwt` | Built into Hono — zero extra dependencies |
| Cookie handling | `hono/cookie` | Built into Hono — zero extra dependencies |
| Password hashing | `bcryptjs` | Pure JS, no native bindings, stable across Node versions, widely audited |
| Random bytes (token generation) | `node:crypto` | Node standard library |

**Dependency rule applied:** Add a dependency only when it is secure, reliable, compatible, and would take significant effort to replicate correctly. `bcryptjs` clears all four bars. `hono/jwt` and `hono/cookie` are zero-cost inclusions already part of Hono.

`bcrypt` (the native binding version) is explicitly **not** used — native C++ bindings can break on Node major version upgrades. `bcryptjs` is pure JavaScript and avoids this risk.

---

## JWT Strategy

**Hybrid payload approach** — role is included in the payload for fast permission checks, but a `token_version` counter in the DB enables reliable invalidation:

```ts
type JWTPayload = {
  user_id: string       // UUID
  role: string          // "editor" — for fast permission checks without DB query
  token_version: number // must match users.token_version in DB
  expires_at: number    // unix timestamp
}
```

**Why include role in payload:**
JWT signatures prevent payload tampering — if role is altered the signature fails. Including role avoids a DB query for every permission check.

**Why token_version is still needed:**
If a user's role changes or they are logged out, their existing token should immediately stop working. Since JWTs are stateless, the only way to invalidate them without a DB check is to wait for expiry. `token_version` solves this with a single lightweight DB query per request.

---

## Token Configuration

| Token | Lifetime | Storage | Path scope |
| ----- | -------- | ------- | ---------- |
| `auth_token` | 2 hours | httpOnly cookie, Secure, SameSite=Strict | All paths |
| `refresh_token` | 7 days | httpOnly cookie, Secure, SameSite=Strict | `/admin/api/auth` only |

httpOnly cookies prevent XSS attacks from stealing tokens (JavaScript cannot access them). `SameSite=Strict` prevents CSRF attacks. Path-scoping the refresh token to `/admin/api/auth` means it is only sent to the auth endpoints — never to content API routes.

---

## Auth Middleware Flow

```
Request → /admin/api/*
        ↓
1. Read auth_token from httpOnly cookie
2. Verify JWT signature (hono/jwt) — no DB
3. Check expires_at — no DB
4. SELECT token_version FROM users WHERE id = $1 — one lightweight DB query
5. Compare payload.token_version === users.token_version
6. Attach { id, role } to Hono context
        ↓
requirePermission('content:read')
→ check role.permissions (no DB — role from JWT payload)
        ↓
requireHierarchy() (user management routes only)
→ compare hierarchy_levels (no DB — roles from registry)
        ↓
Route handler → repository queries
```

Maximum 2 DB queries per request — one for token validation, one for data.

**Proactive refresh:** If `expires_at < now + 30 minutes`, a new `auth_token` is issued and set in the response cookie. Editor never experiences an interruption.

---

## Refresh Flow

```
1. Request with expired auth_token → 401 TOKEN_EXPIRED
2. Client POST /admin/api/auth/refresh with refresh_token cookie
3. Server verifies refresh_token signature and token_version
4. Issues new auth_token
5. Client retries original request
```

---

## Token Invalidation

`token_version` is incremented in the DB on:
- Role change (admin demotes a user)
- Explicit logout
- Admin deletes a user account (though this also removes the row)

All existing tokens for that user immediately fail the `token_version` check and are rejected.

---

## Permission Middleware

```ts
// factory — takes required permission as argument
function requirePermission(permission: Permission) {
  return async (c: Context, next: Next) => {
    const user = c.get('user')
    const role = rolesRegistry[user.role]
    if (!role.permissions.includes(permission)) {
      return c.json({ ok: false, error: { code: 'INSUFFICIENT_PERMISSION' }}, 403)
    }
    await next()
  }
}

// applied per route
app.get('/admin/api/blog-post', requirePermission('content:read'), handler)
app.post('/admin/api/blog-post', requirePermission('content:create'), handler)
app.delete('/admin/api/blog-post/:id', requirePermission('content:delete'), handler)
```

---

## Hierarchy Middleware

Applied to user management routes only — enforces that acting user can only assign roles strictly below their own `hierarchy_level`:

```ts
function requireHierarchy() {
  return async (c: Context, next: Next) => {
    const actingUser = c.get('user')
    const targetRoleName = await getTargetRole(c)
    const actingRole = rolesRegistry[actingUser.role]
    const targetRole = rolesRegistry[targetRoleName]

    if (!targetRole) {
      return c.json({ ok: false, error: { code: 'INVALID_ROLE' }}, 400)
    }
    if (actingRole.hierarchy_level >= targetRole.hierarchy_level) {
      return c.json({ ok: false, error: { code: 'INSUFFICIENT_PRIVILEGE' }}, 403)
    }
    await next()
  }
}
```

---

## Auth Endpoints

```
POST /admin/api/auth/login    — issue auth_token and refresh_token cookies
POST /admin/api/auth/refresh  — issue new auth_token using refresh_token
POST /admin/api/auth/logout   — increment token_version, clear cookies
```

Auth endpoints are excluded from the OpenAPI spec — documenting exact cookie names and token structure in a publicly accessible spec is an unnecessary security surface.

---

## Password Hashing

```ts
import bcrypt from 'bcryptjs'

// salt rounds of 12 — current recommendation balancing security and performance
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  return bcrypt.compare(password, stored)
}
```

---

## AUTH_SECRET Generation

Generated during `manguito init` using `node:crypto`:

```ts
import { randomBytes } from 'node:crypto'
const secret = randomBytes(32).toString('hex')
// written to .env as AUTH_SECRET=<64 char hex string>
```

Minimum 32 bytes (64 hex chars). Never committed to version control.

---

## Admin Governance (implementation detail)

CLI commands bypass the HTTP auth layer entirely and interact with the DB directly:

```bash
manguito users:promote --email=someone@example.com
manguito users:demote --email=someone@example.com --role=manager
```

Both commands verify DB state before executing:
- `promote`: user exists, is not already admin
- `demote`: target role exists, is not admin, result would not leave zero admins

See `phase-02-roles-and-auth-design.md` for the full governance rules.
