# Decision — Roles and Auth Design

> Defines the roles schema format, parsed output, permission system, and admin governance rules.
> Auth middleware implementation detail is deferred to Phase 6 — see `phase-06-auth.md`.

---

## Roles Schema

Roles are defined in `schemas/roles/roles.json`. They are schema-defined only — no runtime role creation through the admin panel. This keeps roles version-controlled alongside the rest of the system configuration.

```json
{
  "roles": [
    {
      "name": "admin",
      "label": "Administrator",
      "is_system": true,
      "hierarchy_level": 0,
      "permissions": [
        "content:read", "content:create", "content:edit", "content:delete",
        "media:read", "media:create", "media:edit", "media:delete",
        "taxonomy:read", "taxonomy:create", "taxonomy:edit", "taxonomy:delete",
        "users:read", "users:create", "users:edit", "users:delete",
        "roles:read"
      ]
    },
    {
      "name": "manager",
      "label": "Manager",
      "is_system": true,
      "hierarchy_level": 1,
      "permissions": [
        "content:read", "content:create", "content:edit", "content:delete",
        "media:read", "media:create", "media:edit", "media:delete",
        "taxonomy:read", "taxonomy:create", "taxonomy:edit", "taxonomy:delete",
        "users:read", "users:create", "users:edit",
        "roles:read"
      ]
    },
    {
      "name": "editor",
      "label": "Editor",
      "is_system": true,
      "hierarchy_level": 2,
      "permissions": [
        "content:read", "content:create", "content:edit",
        "media:read", "media:create", "media:edit",
        "taxonomy:read", "taxonomy:create", "taxonomy:edit"
      ]
    },
    {
      "name": "writer",
      "label": "Writer",
      "is_system": true,
      "hierarchy_level": 3,
      "permissions": [
        "content:read", "content:create", "content:edit",
        "media:read", "media:create",
        "taxonomy:read"
      ]
    },
    {
      "name": "viewer",
      "label": "Viewer",
      "is_system": true,
      "hierarchy_level": 4,
      "permissions": [
        "content:read", "media:read", "taxonomy:read"
      ]
    }
  ]
}
```

---

## Permission System

All valid permissions are a combination of target and action:

```ts
type PermissionTarget = "content" | "media" | "taxonomy" | "users" | "roles"
type PermissionAction = "read" | "create" | "edit" | "delete"
type Permission = `${PermissionTarget}:${PermissionAction}`
```

The only exception is `roles:read` — `roles:create`, `roles:edit`, and `roles:delete` do not exist as valid permissions. Roles are managed through schema files and CLI, never through the admin panel UI.

**Permission scope:**

| Target | Covers |
| ------ | ------ |
| `content` | Content type instances and their embedded paragraph instances |
| `media` | All uploaded files (images, videos, PDFs) |
| `taxonomy` | Taxonomy term instances |
| `users` | User accounts |
| `roles` | Role definitions — read-only display in admin panel |

Paragraph instances are covered by `content` permissions — they are owned by their parent content and have no independent permission surface.

---

## Role Hierarchy

`hierarchy_level` defines a total ordering of roles. Lower number = higher privilege. The hierarchy is used to enforce assignment rules — a user can only assign roles with a strictly higher `hierarchy_level` than their own.

| Role | Hierarchy level |
| ---- | --------------- |
| `admin` | 0 |
| `manager` | 1 |
| `editor` | 2 |
| `writer` | 3 |
| `viewer` | 4 |

**Custom roles** can be added to `roles.json` with any `hierarchy_level`. The parser validates that no two roles share the same level — `DUPLICATE_HIERARCHY_LEVEL` error if they do. This enforces an unambiguous total ordering.

```json
{
  "name": "super_manager",
  "label": "Super Manager",
  "is_system": false,
  "hierarchy_level": 1,
  "permissions": [...]
}
```

If `super_manager` is added at level 1, `manager` must be bumped to level 2, etc.

**`is_system: true`** roles cannot be deleted at runtime. The DB seeder enforces this. `is_system: false` roles can be deleted if no users are currently assigned to them.

---

## User Model

Each user has exactly one role. Multiple roles per user are not supported — the permission hierarchy makes this unnecessary since each role is a strict superset of the one below it.

```ts
type User = {
  id: string              // UUID
  email: string           // unique
  password_hash: string   // bcryptjs hash
  role_id: string         // FK → roles table — single role per user
  token_version: number   // incremented on role change or logout
  created_at: Date
  updated_at: Date
}
```

`token_version` is used for JWT invalidation — see `phase-06-auth.md` for full auth implementation.

---

## Admin Governance Rules

| Rule | Enforcement point |
| ---- | ----------------- |
| First admin created on `manguito init` | CLI prompt |
| Additional admin promotion via `manguito users:promote` | CLI only |
| Admin demotion via `manguito users:demote` | CLI only |
| Minimum one admin must exist at all times | CLI rejects demote if only one admin remains |
| Admin cannot edit their own role | API layer |
| Admin cannot delete their own account | API layer |
| Admin role never appears in admin panel role picker | UI layer |
| Manager can create/edit users with roles strictly below manager | API layer — hierarchy check |
| No self-registration | No public registration endpoint exists |

**CLI commands for admin management:**

```bash
manguito users:promote --email=someone@example.com
# promotes existing user to admin
# error if user doesn't exist
# error if user is already admin

manguito users:demote --email=someone@example.com --role=manager
# demotes admin to specified role
# error if target role doesn't exist
# error if this would leave zero admins in DB
```

Admin promotion and demotion require terminal access — consistent with the principle that sensitive infrastructure-level operations require intentionality. The admin panel never shows a UI for assigning the admin role.

---

## Hierarchical Assignment Enforcement

When a manager (or admin) creates or edits a user, the API enforces:

```
acting user hierarchy_level < target role hierarchy_level
```

Example: A manager (`hierarchy_level: 1`) can assign `editor` (2), `writer` (3), or `viewer` (4) — but not `admin` (0) or `manager` (1). The role picker in the admin panel only shows roles with `hierarchy_level > acting user hierarchy_level`.

This also applies to editing an existing user's role — a manager cannot escalate someone to manager or admin.

---

## Parsed Roles Output

```ts
type ParsedRoles = {
  roles: ParsedRole[]             // sorted by hierarchy_level ascending
  valid_permissions: Permission[] // complete list of all valid permission strings
}

type ParsedRole = {
  name: string
  label: string
  is_system: boolean
  hierarchy_level: number
  permissions: Permission[]
}
```

**Parser validation for `roles.json`:**

| Check | Error code |
| ----- | ---------- |
| Duplicate `hierarchy_level` values | `DUPLICATE_HIERARCHY_LEVEL` |
| Unknown permission strings | `UNKNOWN_PERMISSION` |
| Missing required fields (`name`, `label`, `hierarchy_level`, `permissions`) | `MISSING_REQUIRED_FIELD` |
| `roles:create`, `roles:edit`, or `roles:delete` in any permissions array | `INVALID_PERMISSION` |

---

## DB Tables for Roles

Seeded from `ParsedRoles` on first run and on each `manguito migrate` when roles have changed:

```
roles table
├── id (UUID PK)
├── name (varchar, unique)
├── label (varchar)
├── is_system (boolean)
├── hierarchy_level (integer, unique)
├── permissions (text[] — array of permission strings)
├── created_at (timestamp)
└── updated_at (timestamp)
```

`is_system: true` roles cannot be deleted by the DB seeder or through the API. `is_system: false` custom roles can be deleted if no users are assigned to them.

---

## Role Lifecycle

```
Developer edits roles.json
        ↓
manguito build — parser validates and produces ParsedRoles
        ↓
manguito migrate — DB seeder syncs roles table
        ↓
Admin panel shows roles as read-only reference
        ↓
Auth middleware loads user's single role, checks permissions per request
```

No runtime role mutation. No permission escalation risk. Fully version controlled alongside schema files.
