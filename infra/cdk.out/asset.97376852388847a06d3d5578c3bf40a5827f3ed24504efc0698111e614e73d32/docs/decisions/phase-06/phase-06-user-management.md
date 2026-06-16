# Decision — User Management Endpoints

> Route surface, response shapes, self-edit restrictions, user creation, and password management.

---

## Route Surface

```
GET    /admin/api/users                      — list all users
GET    /admin/api/users/:id                  — get single user
POST   /admin/api/users                      — create new user
PATCH  /admin/api/users/:id                  — update email or role
DELETE /admin/api/users/:id                  — delete user
POST   /admin/api/users/:id/reset-password   — admin resets subordinate password
POST   /admin/api/users/change-password      — self-service own password change
```

---

## Middleware Applied Per Route

| Route | authMiddleware | mustChangePassword | requirePermission | requireHierarchy |
|-------|---------------|-------------------|-------------------|-----------------|
| `GET /admin/api/users` | ✓ | ✓ | `users:read` | — |
| `GET /admin/api/users/:id` | ✓ | ✓ | `users:read` | — |
| `POST /admin/api/users` | ✓ | ✓ | `users:create` | ✓ |
| `PATCH /admin/api/users/:id` | ✓ | ✓ | `users:edit` | ✓ |
| `DELETE /admin/api/users/:id` | ✓ | ✓ | `users:delete` | ✓ |
| `POST /admin/api/users/:id/reset-password` | ✓ | ✓ | `users:edit` | ✓ |
| `POST /admin/api/users/change-password` | ✓ | exempt | — | — |

`POST /admin/api/users/change-password` is exempt from `mustChangePasswordCheck` — it is the route that clears the flag.

`change-password` requires no `users:edit` permission — it is available to any authenticated user regardless of role. Every user should be able to change their own password.

---

## Response Shape

User responses never include `password_hash` or `token_version` — these are internal fields. Safe response shape:

```ts
type UserResponse = {
  id: string
  email: string
  role: string        // role name e.g. "editor"
  created_at: string  // ISO datetime
  updated_at: string
}
```

This shape is used for all read endpoints. `must_change_password` may optionally be included for admin display purposes but is never required by the frontend for functional behavior.

---

## User Creation — `POST /admin/api/users`

**Request body:**
```json
{ "email": "newuser@example.com", "role": "editor" }
```

No password in the request — the server generates a random temporary password.

**Behavior:**
- `requireHierarchy` enforces acting user's `hierarchy_level < target role hierarchy_level`
- Generates a cryptographically random temporary password using `node:crypto`
- Hashes the temporary password with `bcryptjs`
- Sets `must_change_password: true` on the new user
- Returns `temporary_password` in the response body — **this is the only time it is ever returned**

**Response:**
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "email": "newuser@example.com",
    "role": "editor",
    "temporary_password": "x7kP2mQn9r",
    "must_change_password": true,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

The creating admin copies the temporary password and communicates it to the new user out of band. The admin never chooses the password — clean separation. After the `POST` response, `temporary_password` is never returned again in any subsequent `GET`.

---

## Self-Edit Restrictions

Acting user is identified from the `auth_token` cookie. The API compares acting user `id` against target user `id`:

| Operation | Self allowed? | Enforcement |
|-----------|--------------|-------------|
| Change own email | ✓ Yes | — |
| Change own password (`change-password`) | ✓ Yes | — |
| Change own role | ✗ No | `INSUFFICIENT_PRIVILEGE` |
| Delete own account | ✗ No | `INSUFFICIENT_PRIVILEGE` |
| Reset own password via admin reset | ✗ No | `INSUFFICIENT_PRIVILEGE` |

Self role change and self delete are blocked at the route handler level before hierarchy checks run.

---

## Self-Service Password Change — `POST /admin/api/users/change-password`

Available to any authenticated user regardless of role.

**Request body:**
```json
{
  "current_password": "oldpassword",
  "new_password": "newpassword"
}
```

**Behavior:**
- Verifies `current_password` against stored `password_hash`
- Hashes `new_password` and updates `password_hash` in DB
- Sets `must_change_password: false`
- Increments `token_version` — existing tokens invalidated, user must log in again

**On wrong current password:** `INVALID_CREDENTIALS`

---

## Admin Password Reset — `POST /admin/api/users/:id/reset-password`

Requires `users:edit` permission and `requireHierarchy`. Blocked if acting user === target user.

**Behavior:**
- Generates a new random temporary password
- Hashes and stores it
- Sets `must_change_password: true` on target user
- Increments `token_version` — target user's existing sessions invalidated

**Response:**
```json
{
  "ok": true,
  "data": {
    "temporary_password": "newTempPass123"
  }
}
```

---

## Hierarchy Enforcement

All write routes run `requireHierarchy`. The rule:

```
acting user hierarchy_level < target role hierarchy_level
```

A manager (`hierarchy_level: 1`) can create/edit users with roles `editor` (2), `writer` (3), `viewer` (4) — but not `admin` (0) or `manager` (1).

This applies to both creating a new user and editing an existing user's role. A manager cannot escalate someone to manager or above.

The `admin` role never appears in the role picker in the admin panel UI — Phase 8 concern.

---

## Role Delete Safety

When a role is removed from `roles.json`, the DB seeder checks that no users are currently assigned to it before allowing deletion. If users are assigned, the seeder rejects the deletion with a clear error. This is enforced at migration time — not at the API layer.
