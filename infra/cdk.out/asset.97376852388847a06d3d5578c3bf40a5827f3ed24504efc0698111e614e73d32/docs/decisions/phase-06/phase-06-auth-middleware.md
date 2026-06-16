# Decision — Auth Middleware

> JWT verification flow, token configuration, proactive refresh, and must-change-password enforcement.

---

## Libraries

| Concern | Library | Rationale |
|---------|---------|-----------|
| JWT signing and verification | `hono/jwt` | Built into Hono — zero extra dependencies |
| Cookie handling | `hono/cookie` | Built into Hono — zero extra dependencies |
| Password hashing | `bcryptjs` | Pure JS, no native bindings, stable across Node versions |
| Random bytes | `node:crypto` | Node standard library |

`bcrypt` (native binding version) is explicitly not used — native C++ bindings can break on Node major version upgrades.

---

## JWT Payload

```ts
type JWTPayload = {
  user_id: string       // UUID
  role: string          // role name e.g. "editor"
  token_version: number // must match users.token_version in DB
  expires_at: number    // unix timestamp
}
```

Role is included in the payload for fast permission checks — no DB query needed per request. JWT signatures prevent tampering. `token_version` enables reliable invalidation when role changes or user logs out.

---

## Token Configuration

| Token | Lifetime | Storage | Path scope |
|-------|----------|---------|------------|
| `auth_token` | 2 hours | httpOnly cookie, Secure, SameSite=Strict | All paths |
| `refresh_token` | 7 days | httpOnly cookie, Secure, SameSite=Strict | `/admin/api/auth` only |

httpOnly prevents XSS from stealing tokens. SameSite=Strict prevents CSRF. Path-scoping the refresh token means it is never sent to content API routes.

---

## Auth Middleware Flow

Runs on every `/admin/api/*` request:

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
mustChangePasswordCheck
→ if must_change_password === true, block all routes except POST /admin/api/users/change-password
        ↓
requirePermission('content:read')
→ check role.permissions against registry (no DB)
        ↓
requireHierarchy() (user management routes only)
→ compare hierarchy_levels against registry (no DB)
        ↓
Route handler
```

Maximum 2 DB queries per request — one for `token_version` validation, one for actual data.

---

## Proactive Refresh

If `expires_at < now + 30 minutes`, a new `auth_token` is issued and set in the response cookie transparently. The user never experiences an interruption. The refresh token is not affected.

---

## Token Invalidation

`token_version` is incremented in the DB on:
- Role change
- Explicit logout
- Admin deletes a user account

All existing tokens for that user immediately fail the `token_version` check.

---

## must_change_password Enforcement

`mustChangePasswordCheck` middleware runs after `authMiddleware` and before `requirePermission`. If the authenticated user has `must_change_password: true`, all requests are blocked with:

```json
{
  "ok": false,
  "error": {
    "code": "PASSWORD_CHANGE_REQUIRED",
    "message": "You must change your password before continuing."
  }
}
```

The only route exempt from this check is `POST /admin/api/users/change-password`. Once the password is successfully changed, `must_change_password` is set to `false` in the DB and subsequent requests proceed normally.

---

## Hono Context Shape

After `authMiddleware` succeeds, the following is attached to Hono context for downstream middleware and route handlers:

```ts
type AuthContext = {
  id: string    // user UUID
  role: string  // role name
}

// access in handlers and middleware:
const user = c.get('user') // { id, role }
```
