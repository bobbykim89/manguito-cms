# Phase 6 — Auth Module

> JWT authentication, permission enforcement, user management API, and password lifecycle.

This phase secures `@bobbykim/manguito-cms-api` by wiring the auth layer that Phase 5 left as a placeholder. It implements JWT-based authentication using httpOnly cookies, a roles registry built at startup, layered permission middleware, and the full user management API surface.

**Done when:** All `/admin/api/*` routes reject unauthenticated requests. Login, refresh, and logout endpoints work correctly. `requirePermission` is applied to every generated admin route. User management CRUD endpoints enforce hierarchy rules. `must_change_password` blocks all routes except the change-password endpoint. `GET /admin/api/config` and `GET /admin/api/schema` return correct data to authenticated users. All unit and integration tests pass.

---

## Decisions Made

| Topic | Detail doc |
|-------|-----------|
| Package boundaries — what lives where across core, api, cli | [decisions/phase-06/phase-06-package-boundaries.md](./decisions/phase-06/phase-06-package-boundaries.md) |
| Roles registry — construction, lifecycle, startup validation | [decisions/phase-06/phase-06-roles-registry.md](./decisions/phase-06/phase-06-roles-registry.md) |
| Auth middleware — JWT strategy, token config, middleware flow | [decisions/phase-06/phase-06-auth-middleware.md](./decisions/phase-06/phase-06-auth-middleware.md) |
| Auth endpoints — login, refresh, logout, rate limiting | [decisions/phase-06/phase-06-auth-endpoints.md](./decisions/phase-06/phase-06-auth-endpoints.md) |
| User management endpoints — routes, shapes, governance rules | [decisions/phase-06/phase-06-user-management.md](./decisions/phase-06/phase-06-user-management.md) |
| Config and schema endpoints | [decisions/phase-06/phase-06-config-schema-endpoints.md](./decisions/phase-06/phase-06-config-schema-endpoints.md) |
| Route wiring — how auth and permission middleware is applied | [decisions/phase-06/phase-06-route-wiring.md](./decisions/phase-06/phase-06-route-wiring.md) |
| Error code additions for Phase 6 | [decisions/phase-06/phase-06-error-codes.md](./decisions/phase-06/phase-06-error-codes.md) |

---

## Where This Fits

```
Phase 5 — REST API layer, all admin routes generated but auth is a placeholder

Phase 6 — adds:
  Auth middleware          ← JWT verification + token_version DB check
  requirePermission()      ← per-route permission enforcement
  requireHierarchy()       ← user management routes only
  mustChangePassword()     ← blocks routes until password is changed
  Auth endpoints           ← login / refresh / logout
  User management routes   ← /admin/api/users/*
  Roles registry           ← built at startup from ParsedRoles
  Config endpoint          ← GET /admin/api/config
  Schema endpoint          ← GET /admin/api/schema

Phase 8 — admin panel consumes all /admin/api/* endpoints
Phase 9 — CLI createsuperuser, users:promote, users:demote, users:reset-password
```

---

## Package Responsibilities

```
@bobbykim/manguito-cms-core
  — Permission, JWTPayload, ParsedRole, User types
  — hashPassword(), verifyPassword() utilities
  — PASSWORD_CHANGE_REQUIRED, INVALID_ROLE, INVALID_CREDENTIALS added to ErrorCode enum

@bobbykim/manguito-cms-api
  — buildRolesRegistry() — constructs Record<string, ParsedRole> at startup
  — authMiddleware — JWT verification + token_version check
  — mustChangePasswordCheck — blocks requests when flag is set
  — requirePermission() — permission middleware factory
  — requireHierarchy() — hierarchy middleware factory
  — Auth endpoints — login / refresh / logout
  — User management routes — /admin/api/users/*
  — Config endpoint — GET /admin/api/config
  — Schema endpoint — GET /admin/api/schema

@bobbykim/manguito-cms-cli
  — users:promote, users:demote, users:reset-password commands
  — Imports from core (hashPassword) and db (direct queries)
  — Never imports from api
```

---

## Middleware Stack

```
/admin/api/*
    ↓ authMiddleware               ← rejects unauthenticated requests
    ↓ mustChangePasswordCheck      ← blocks all routes except POST /admin/api/users/change-password
    ↓ requirePermission('x:y')     ← per route — checks role permissions
    ↓ requireHierarchy()           ← user management write routes only
    ↓ route handler
```

`GET /admin/api/config` and `GET /admin/api/schema` sit behind `authMiddleware` only — no `requirePermission` needed.

---

## API Surface Added in Phase 6

```
-- auth (excluded from OpenAPI spec)
POST   /admin/api/auth/login               — issue auth_token + refresh_token cookies
POST   /admin/api/auth/refresh             — reissue auth_token using refresh_token
POST   /admin/api/auth/logout              — increment token_version, clear cookies

-- user management
GET    /admin/api/users                    — list users (users:read)
GET    /admin/api/users/:id                — get single user (users:read)
POST   /admin/api/users                    — create user (users:create + requireHierarchy)
PATCH  /admin/api/users/:id                — update email/role (users:edit + requireHierarchy)
DELETE /admin/api/users/:id                — delete user (users:delete + requireHierarchy)
POST   /admin/api/users/:id/reset-password — admin resets subordinate password (users:edit + requireHierarchy)
POST   /admin/api/users/change-password    — self-service own password change (any authenticated user)

-- internal (excluded from OpenAPI spec)
GET    /admin/api/config                   — CMS metadata + filtered roles list
GET    /admin/api/schema                   — full schema definitions for admin panel forms
```

---

## Package Structure additions

```
packages/api/src/
├── auth/
│   ├── registry.ts           ← buildRolesRegistry()
│   ├── jwt.ts                ← signToken(), verifyToken() helpers
│   └── password.ts           ← re-exports hashPassword/verifyPassword from core
├── middleware/
│   ├── auth.ts               ← authMiddleware (replaces Phase 5 placeholder)
│   ├── permission.ts         ← requirePermission() factory
│   ├── hierarchy.ts          ← requireHierarchy() factory
│   └── must-change-password.ts ← mustChangePasswordCheck
└── routes/
    └── admin/
        ├── users.ts          ← /admin/api/users/* routes
        ├── config.ts         ← GET /admin/api/config
        ├── schema.ts         ← GET /admin/api/schema
        └── auth.ts           ← login / refresh / logout
```

---

## Developer Checklist

### Setup
- [ ] Add `bcryptjs` and `@types/bcryptjs` to `packages/api/package.json`
- [ ] Add `PASSWORD_CHANGE_REQUIRED`, `INVALID_ROLE`, `INVALID_CREDENTIALS` to `ErrorCode` enum in `@bobbykim/manguito-cms-core`
- [ ] Add `must_change_password` boolean field to users table (default: `false`)
- [ ] Add `name` optional field to `ManguitoConfig` in `defineConfig` — defaults to `'Manguito CMS'`

### Roles Registry — see [phase-06-roles-registry.md](./decisions/phase-06/phase-06-roles-registry.md)
- [ ] `buildRolesRegistry()` implemented as pure function in `packages/api/src/auth/registry.ts`
- [ ] Throws with clear error message on empty roles array
- [ ] Throws with clear error message if any `is_system: true` role is missing
- [ ] Throws with clear error message on duplicate `hierarchy_level`
- [ ] Registry built once inside `createAPIAdapter()` — closed over by all middleware factories
- [ ] Registry is never rebuilt mid-run

### Auth Middleware — see [phase-06-auth-middleware.md](./decisions/phase-06/phase-06-auth-middleware.md)
- [ ] Reads `auth_token` from httpOnly cookie
- [ ] Verifies JWT signature using `hono/jwt` — no DB
- [ ] Checks `expires_at` — no DB
- [ ] Queries `token_version` from DB — one lightweight query
- [ ] Compares `payload.token_version === users.token_version`
- [ ] Attaches `{ id, role }` to Hono context on success
- [ ] Proactive refresh — if `expires_at < now + 30 minutes`, issues new `auth_token` in response cookie
- [ ] `mustChangePasswordCheck` blocks all routes except `POST /admin/api/users/change-password`

### Auth Endpoints — see [phase-06-auth-endpoints.md](./decisions/phase-06/phase-06-auth-endpoints.md)
- [ ] `POST /admin/api/auth/login` — verifies email + password, issues both cookies, returns `{ id, email, role }` in body
- [ ] Login failure returns `INVALID_CREDENTIALS` for both wrong password and unknown email — no distinction
- [ ] Login rate limited — 10 attempts per IP + email combination per 15 minutes
- [ ] `POST /admin/api/auth/refresh` — verifies refresh_token, issues new `auth_token` only — refresh_token not rotated
- [ ] `POST /admin/api/auth/logout` — increments `token_version`, clears both cookies
- [ ] All three auth endpoints excluded from OpenAPI spec

### Permission and Hierarchy Middleware — see [phase-06-route-wiring.md](./decisions/phase-06/phase-06-route-wiring.md)
- [ ] `requirePermission()` factory implemented — reads role from Hono context, checks against registry
- [ ] `requireHierarchy()` factory implemented — compares `hierarchy_level` of acting user vs target role
- [ ] HTTP method → permission mapping applied inside route generator: GET→read, POST→create, PATCH→edit, DELETE→delete
- [ ] `requireHierarchy` applied only on user management write routes

### User Management — see [phase-06-user-management.md](./decisions/phase-06/phase-06-user-management.md)
- [ ] `GET /admin/api/users` — returns array, never includes `password_hash` or `token_version`
- [ ] `GET /admin/api/users/:id` — same shape, `404` if not found
- [ ] `POST /admin/api/users` — generates random temporary password, sets `must_change_password: true`, returns `temporary_password` once in response
- [ ] `PATCH /admin/api/users/:id` — handles email and role updates, blocks self role change
- [ ] `DELETE /admin/api/users/:id` — blocks self delete
- [ ] `POST /admin/api/users/:id/reset-password` — admin resets subordinate, blocks self reset
- [ ] `POST /admin/api/users/change-password` — requires current password verification, available to any authenticated user
- [ ] All write routes enforce `requireHierarchy` — acting user hierarchy_level must be strictly lower than target role hierarchy_level

### Config and Schema Endpoints — see [phase-06-config-schema-endpoints.md](./decisions/phase-06/phase-06-config-schema-endpoints.md)
- [ ] `GET /admin/api/config` — returns `cms_name`, `version`, roles filtered by acting user's hierarchy level
- [ ] Config response never exposes storage config, DB config, AUTH_SECRET, or any env var values
- [ ] `GET /admin/api/schema` — returns full schema definitions for admin panel
- [ ] Both endpoints behind `authMiddleware` only — no `requirePermission`
- [ ] Both endpoints excluded from OpenAPI spec

---

## Tests

### Unit
- [ ] `buildRolesRegistry` — throws on empty array, throws on missing system role, throws on duplicate hierarchy_level
- [ ] `authMiddleware` — rejects missing token, rejects invalid signature, rejects mismatched `token_version`
- [ ] `authMiddleware` — proactive refresh issued when token expires within 30 minutes
- [ ] `mustChangePasswordCheck` — blocks non-change-password routes, allows change-password route
- [ ] `requirePermission` — allows correct role, rejects insufficient role
- [ ] `requireHierarchy` — allows acting user with lower hierarchy_level, rejects equal or higher
- [ ] Login — `INVALID_CREDENTIALS` for wrong password and unknown email
- [ ] Login — `RATE_LIMITED` after 10 attempts per IP + email per 15 minutes
- [ ] User create — `temporary_password` present in response, `must_change_password: true` set
- [ ] User create — `temporary_password` not returned on subsequent `GET`
- [ ] Self role change blocked — `INSUFFICIENT_PRIVILEGE`
- [ ] Self delete blocked — `INSUFFICIENT_PRIVILEGE`

### Integration
- [ ] `GET /admin/api/users` — returns 401 without token
- [ ] `POST /admin/api/auth/login` — issues cookies, returns user info
- [ ] `POST /admin/api/auth/login` — rate limited after threshold
- [ ] `POST /admin/api/auth/refresh` — issues new `auth_token`, refresh_token unchanged
- [ ] `POST /admin/api/auth/logout` — clears cookies, subsequent requests rejected
- [ ] `POST /admin/api/users` — creates user, returns `temporary_password` once
- [ ] `POST /admin/api/users/change-password` — succeeds with correct current password, `must_change_password` cleared
- [ ] `GET /admin/api/config` — returns sanitized config, no sensitive fields
- [ ] Role change invalidates existing token — `token_version` mismatch rejected

---

## Claude Code Checklist

- [ ] Read all detail docs linked in the Decisions Made table before implementing
- [ ] `buildRolesRegistry` must throw early and hard — a broken registry must never allow the server to start
- [ ] Auth middleware replaces the Phase 5 placeholder in `packages/api/src/middleware/auth.ts` — do not create a new file
- [ ] `password_hash` and `token_version` must never appear in any API response — enforce at the repository layer, not just the route handler
- [ ] `temporary_password` is returned once in the `POST /admin/api/users` response only — never stored in plaintext, never returned again
- [ ] Login rate limiting is scoped to IP + email combination — per-IP alone is not sufficient
- [ ] Refresh token is never rotated on `/refresh` — only `auth_token` is reissued
- [ ] `mustChangePasswordCheck` must run after `authMiddleware` and before `requirePermission` — order matters
- [ ] `GET /admin/api/config` must sanitize response — never expose storage, DB, server, or auth config details
- [ ] CLI user commands (`users:promote`, `users:demote`, `users:reset-password`) are Phase 9 — do not implement here
- [ ] Auth endpoints are excluded from the OpenAPI spec — do not add them to the spec generation
- [ ] `name` field added to `ManguitoConfig` in `defineConfig` must be optional with default `'Manguito CMS'` — existing configs must not break
