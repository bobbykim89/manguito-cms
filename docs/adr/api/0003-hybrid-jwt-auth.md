---
status: accepted
---

# Hybrid JWT auth: signed role payload plus a token_version revocation counter

Authentication uses stateless JWTs carried in httpOnly cookies (`auth_token`, 2h, all paths; `refresh_token`, 7d, path-scoped to `/admin/api/auth`), signed/verified with `hono/jwt`. The payload includes the user's `role` so permission checks need no DB lookup, **and** a `token_version` integer that must match `users.token_version` in the DB — incremented on role change, logout, and password change to invalidate outstanding tokens immediately. This costs at most two DB queries per request (one for `token_version`, one for data). The roles registry (`Record<string, ParsedRole>`) is built once at startup via a pure `buildRolesRegistry`, validated fail-hard (a broken registry must prevent the server from starting), and closed over by the middleware factories — no globals, no per-request rebuild.

## Considered Options

- **Pure stateless JWT (no DB check)** — rejected: a logged-out or demoted user's token would stay valid until expiry; `token_version` buys immediate revocation for one lightweight query.
- **Session/DB lookup for role on every request** — rejected: defeats the point of a signed token; role-in-payload makes permission checks DB-free, and the signature prevents tampering.
- **A third-party auth library** — rejected: `hono/jwt` + `hono/cookie` + `bcryptjs` (password hashing via [core 0006](../core/0006-core-shared-kernel-dependencies.md)) cover the need with near-zero added dependency weight.

## Consequences

- Login returns user identity in the body but never the raw tokens (httpOnly); proactive refresh reissues `auth_token` when it is within 30 minutes of expiry; refresh tokens are not rotated.
- Middleware order is load-bearing: `authMiddleware` → `mustChangePasswordCheck` → `requirePermission` → `requireHierarchy`.
- **Drift resolved:** `better-auth` was present in `api/package.json` but never imported — the implementation is the hand-rolled strategy above. It has been removed; run `pnpm install` to sync the lockfile.
