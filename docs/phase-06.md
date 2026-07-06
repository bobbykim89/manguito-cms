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

> **Audit (2026-07-02):** All items below were verified implemented and tested.
> The audit found one defect — admin media routes were registered without the
> real permission middleware, so their `requirePermission(...)` calls resolved to
> the no-op shim in `middleware/auth.ts`: media routes enforced authentication
> (via the blanket `authMiddleware`) but **not** `media:*` permissions, and one
> call used the invalid permission `media:update`. **Fixed** — the real
> permission middleware is now threaded into `registerAdminMediaRoutes` (a
> required parameter, so it can't regress silently), every media route enforces
> its `media:*` permission (reads → `media:read`, uploads incl. presigned/confirm
> → `media:create`, edit → `media:edit`, delete → `media:delete`), and
> viewer-403 tests cover it.

### Setup
- [x] Add `bcryptjs` and `@types/bcryptjs` to `packages/api/package.json`
- [x] Add `PASSWORD_CHANGE_REQUIRED`, `INVALID_ROLE`, `INVALID_CREDENTIALS` to `ErrorCode` enum in `@bobbykim/manguito-cms-core`
- [x] Add `must_change_password` boolean field to users table (default: `false`)
- [x] Add `name` optional field to `ManguitoConfig` in `defineConfig` — defaults to `'Manguito CMS'`

### Roles Registry — see [phase-06-roles-registry.md](./decisions/phase-06/phase-06-roles-registry.md)
- [x] `buildRolesRegistry()` implemented as pure function in `packages/api/src/auth/registry.ts`
- [x] Throws with clear error message on empty roles array
- [x] Throws with clear error message if any required system role (`admin`, `manager`, `editor`, `writer`, `viewer`) is missing
- [x] Throws with clear error message on duplicate `hierarchy_level`
- [x] Registry built once inside `createCmsApp()` — closed over by all middleware factories
- [x] Registry is never rebuilt mid-run

### Auth Middleware — see [phase-06-auth-middleware.md](./decisions/phase-06/phase-06-auth-middleware.md)
- [x] Reads `auth_token` from httpOnly cookie
- [x] Verifies JWT signature using `hono/jwt` — no DB
- [x] Checks `expires_at` — no DB
- [x] Queries `token_version` from DB — one lightweight query
- [x] Compares `payload.token_version === users.token_version`
- [x] Attaches `{ id, role }` to Hono context on success
- [x] Proactive refresh — if `expires_at < now + 30 minutes`, issues new `auth_token` in response cookie
- [x] `mustChangePasswordCheck` blocks all routes except `POST /admin/api/users/change-password`

### Auth Endpoints — see [phase-06-auth-endpoints.md](./decisions/phase-06/phase-06-auth-endpoints.md)
- [x] `POST /admin/api/auth/login` — verifies email + password, issues both cookies, returns `{ id, email, role }` in body
- [x] Login failure returns `INVALID_CREDENTIALS` for both wrong password and unknown email — no distinction
- [x] Login rate limited — 10 attempts per IP + email combination per 15 minutes
- [x] `POST /admin/api/auth/refresh` — verifies refresh_token, issues new `auth_token` only — refresh_token not rotated
- [x] `POST /admin/api/auth/logout` — increments `token_version`, clears both cookies
- [x] All three auth endpoints excluded from OpenAPI spec

### Permission and Hierarchy Middleware — see [phase-06-route-wiring.md](./decisions/phase-06/phase-06-route-wiring.md)
- [x] `requirePermission()` factory implemented — reads role from Hono context, checks against registry
- [x] `requireHierarchy()` factory implemented — compares `hierarchy_level` of acting user vs target role
- [x] HTTP method → permission mapping applied inside route generator: GET→read, POST→create, PATCH→edit, DELETE→delete
- [x] `requireHierarchy` applied only on user management write routes

### User Management — see [phase-06-user-management.md](./decisions/phase-06/phase-06-user-management.md)
- [x] `GET /admin/api/users` — returns array, never includes `password_hash` or `token_version`
- [x] `GET /admin/api/users/:id` — same shape, `404` if not found
- [x] `POST /admin/api/users` — generates random temporary password, sets `must_change_password: true`, returns `temporary_password` once in response
- [x] `PATCH /admin/api/users/:id` — handles email and role updates, blocks self role change
- [x] `DELETE /admin/api/users/:id` — blocks self delete
- [x] `POST /admin/api/users/:id/reset-password` — admin resets subordinate, blocks self reset
- [x] `POST /admin/api/users/change-password` — requires current password verification, available to any authenticated user
- [x] All write routes enforce `requireHierarchy` — acting user hierarchy_level must be strictly lower than target role hierarchy_level

### Config and Schema Endpoints — see [phase-06-config-schema-endpoints.md](./decisions/phase-06/phase-06-config-schema-endpoints.md)
- [x] `GET /admin/api/config` — returns `cms_name`, `version`, roles filtered by acting user's hierarchy level
- [x] Config response never exposes storage config, DB config, AUTH_SECRET, or any env var values
- [x] `GET /admin/api/schema` — returns full schema definitions for admin panel
- [x] Both endpoints behind `authMiddleware` only — no `requirePermission`
- [x] Both endpoints excluded from OpenAPI spec

---

## Tests

### Unit
- [x] `buildRolesRegistry` — throws on empty array, throws on missing system role, throws on duplicate hierarchy_level
- [x] `authMiddleware` — rejects missing token, rejects invalid signature, rejects mismatched `token_version`
- [x] `authMiddleware` — proactive refresh issued when token expires within 30 minutes
- [x] `mustChangePasswordCheck` — blocks non-change-password routes, allows change-password route
- [x] `requirePermission` — allows correct role, rejects insufficient role
- [x] `requireHierarchy` — allows acting user with lower hierarchy_level, rejects equal or higher
- [x] Login — `INVALID_CREDENTIALS` for wrong password and unknown email
- [x] Login — `RATE_LIMITED` after 10 attempts per IP + email per 15 minutes
- [x] User create — `temporary_password` present in response, `must_change_password: true` set
- [x] User create — `temporary_password` not returned on subsequent `GET`
- [x] Self role change blocked — `INSUFFICIENT_PRIVILEGE`
- [x] Self delete blocked — `INSUFFICIENT_PRIVILEGE`

### Integration
- [x] `GET /admin/api/users` — returns 401 without token
- [x] `POST /admin/api/auth/login` — issues cookies, returns user info
- [x] `POST /admin/api/auth/login` — rate limited after threshold
- [x] `POST /admin/api/auth/refresh` — issues new `auth_token`, refresh_token unchanged
- [x] `POST /admin/api/auth/logout` — clears cookies, subsequent requests rejected
- [x] `POST /admin/api/users` — creates user, returns `temporary_password` once
- [x] `POST /admin/api/users/change-password` — succeeds with correct current password, `must_change_password` cleared
- [x] `GET /admin/api/config` — returns sanitized config, no sensitive fields
- [x] Role change invalidates existing token — `token_version` mismatch rejected

---

## Claude Code Checklist

- [x] Read all detail docs linked in the Decisions Made table before implementing
- [x] `buildRolesRegistry` must throw early and hard — a broken registry must never allow the server to start
- [x] Auth middleware replaces the Phase 5 placeholder in `packages/api/src/middleware/auth.ts` — do not create a new file
- [x] `password_hash` and `token_version` must never appear in any API response — enforce at the repository layer, not just the route handler
- [x] `temporary_password` is returned once in the `POST /admin/api/users` response only — never stored in plaintext, never returned again
- [x] Login rate limiting is scoped to IP + email combination — per-IP alone is not sufficient
- [x] Refresh token is never rotated on `/refresh` — only `auth_token` is reissued
- [x] `mustChangePasswordCheck` must run after `authMiddleware` and before `requirePermission` — order matters
- [x] `GET /admin/api/config` must sanitize response — never expose storage, DB, server, or auth config details
- [x] CLI user commands (`users:promote`, `users:demote`, `users:reset-password`) are Phase 9 — do not implement here
- [x] Auth endpoints are excluded from the OpenAPI spec — do not add them to the spec generation
- [x] `name` field added to `ManguitoConfig` in `defineConfig` must be optional with default `'Manguito CMS'` — existing configs must not break
