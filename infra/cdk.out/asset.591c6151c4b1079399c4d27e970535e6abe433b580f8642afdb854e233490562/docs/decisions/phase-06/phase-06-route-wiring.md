# Decision — Route Wiring

> How auth, permission, and hierarchy middleware is applied across all admin routes.

---

## Strategy

A combination of two approaches:

1. **`authMiddleware` applied once as a blanket layer** on the entire `/admin/api/*` router — no route is ever reachable without a valid token.
2. **`requirePermission` applied per route group** inside the route generator — the generator already knows the HTTP method and maps it to the correct permission automatically.
3. **`requireHierarchy` applied explicitly** only on user management write routes — it is too narrow to belong in the generator.

---

## Middleware Order

```
/admin/api/*
    ↓ authMiddleware               ← 1. rejects unauthenticated requests
    ↓ mustChangePasswordCheck      ← 2. blocks if password change required
    ↓ requirePermission('x:y')     ← 3. per route — checks role permissions
    ↓ requireHierarchy()           ← 4. user management write routes only
    ↓ route handler
```

Order matters — `mustChangePasswordCheck` must run after `authMiddleware` (needs `c.get('user')`) and before `requirePermission` (should short-circuit before permission checks).

---

## HTTP Method → Permission Mapping

The route generator applies this mapping automatically for generated content and taxonomy routes:

```ts
const methodPermissionMap: Record<string, Permission> = {
  GET:    'content:read',
  POST:   'content:create',
  PATCH:  'content:edit',
  DELETE: 'content:delete',
}
```

For taxonomy routes, the same pattern applies with `taxonomy:*` permissions. For media routes, `media:*` permissions.

```ts
// example — generated inside route generator
adminRouter.get(
  `/${type.name}`,
  requirePermission('content:read'),
  listHandler
)
adminRouter.post(
  `/${type.name}`,
  requirePermission('content:create'),
  createHandler
)
```

---

## User Management Routes

User management routes are hand-authored (not generated) and apply permissions explicitly:

```ts
usersRouter.get('/',    requirePermission('users:read'),   listUsersHandler)
usersRouter.get('/:id', requirePermission('users:read'),   getUserHandler)
usersRouter.post('/',   requirePermission('users:create'), requireHierarchy(), createUserHandler)
usersRouter.patch('/:id', requirePermission('users:edit'), requireHierarchy(), updateUserHandler)
usersRouter.delete('/:id', requirePermission('users:delete'), requireHierarchy(), deleteUserHandler)
usersRouter.post('/:id/reset-password', requirePermission('users:edit'), requireHierarchy(), resetPasswordHandler)
usersRouter.post('/change-password', changePasswordHandler) // no requirePermission — any authenticated user
```

---

## Config and Schema Endpoints

`GET /admin/api/config` and `GET /admin/api/schema` sit behind `authMiddleware` only. No `requirePermission` wrapper — any authenticated user can access them regardless of role.

```ts
adminRouter.get('/config', configHandler)   // authMiddleware already applied at router level
adminRouter.get('/schema', schemaHandler)
```

---

## Auth Endpoints

Auth endpoints (`/admin/api/auth/*`) are mounted separately and do **not** go through `authMiddleware` — they are the entry point for unauthenticated users to obtain tokens.

```ts
// auth routes bypass the authMiddleware applied to /admin/api/*
app.route('/admin/api/auth', authRouter)

// all other admin routes sit behind authMiddleware
const adminRouter = new Hono()
adminRouter.use('/*', authMiddleware)
adminRouter.use('/*', mustChangePasswordCheck)
app.route('/admin/api', adminRouter)
```

---

## Phase 5 Placeholder Replacement

Phase 5 left a placeholder in `packages/api/src/middleware/auth.ts`. Phase 6 replaces it — no new file is created. The placeholder is removed and the full `authMiddleware` implementation takes its place.
