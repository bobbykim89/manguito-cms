# Decision — Role-Aware UI

> Defines which UI elements change by role, the usePermission composable, and store responsibilities for role data.

---

## Principle — Hidden, Not Disabled

UI elements the current user cannot act on are **hidden entirely**, not shown as disabled. A viewer seeing a greyed-out delete button is confusing in a CMS context. If you can't do it, you don't see it.

---

## Nav Items — Gated by Permission

| Nav item | Required permission | Hidden for |
|----------|--------------------|----|
| Users | `users:read` | `editor`, `writer`, `viewer` |
| Roles | `roles:read` | `writer`, `viewer` |
| Media | `media:read` | `viewer` |
| Content types | always visible | — |
| Taxonomy types | always visible | — |

---

## Action Buttons — Gated by Permission

| Button | Required permission |
|--------|---------------------|
| Create content | `content:create` |
| Edit content | `content:edit` |
| Delete content | `content:delete` |
| Publish / Unpublish toggle | `content:edit` |
| Upload media | `media:create` |
| Delete media | `media:delete` |
| Create taxonomy term | `taxonomy:create` |
| Edit taxonomy term | `taxonomy:edit` |
| Delete taxonomy term | `taxonomy:delete` |
| Create user | `users:create` |
| Edit user | `users:edit` |
| Delete user | `users:delete` |

**Note:** `content:publish` does not exist. Publish/unpublish uses `content:edit`. This corrects an inconsistency in the Phase 5 docs (`phase-05-published-draft.md`) where `content:publish` was incorrectly introduced. The authoritative permission type definition is in `phase-02-roles-and-auth-design.md`: actions are `read | create | edit | delete` only.

---

## Role Picker — Filtered by Hierarchy

The role picker in user create/edit forms shows only roles with `hierarchy_level` strictly greater than the acting user's own level. The `admin` role is never shown in the picker — admin promotion is CLI-only (`manguito createsuperuser`).

---

## `usePermission` Composable

```ts
// composables/usePermission.ts
export function usePermission() {
  const auth = useAuthStore()
  const schema = useSchemaStore()

  function can(permission: string): boolean {
    return auth.permissions.includes(permission)
  }

  function rolesBelow(): ParsedRole[] {
    return schema.roles.filter(
      r => r.hierarchy_level > auth.hierarchyLevel
        && r.name !== 'admin'
    )
  }

  return { can, rolesBelow }
}
```

Usage in templates:

```vue
<button v-if="can('content:delete')" @click="handleDelete">Delete</button>

<select>
  <option v-for="role in rolesBelow()" :key="role.name">{{ role.label }}</option>
</select>
```

---

## Store Responsibilities

| Data | Store | Reason |
|------|-------|--------|
| Current user's `role` name | `auth` store | Session data — who am I |
| Current user's `permissions` array | `auth` store | Derived from role name + schema lookup |
| Current user's `hierarchyLevel` | `auth` store | Derived from role name + schema lookup |
| Full `roles` list | `schema` store | Schema data — preconfigured, not session-specific |

The `auth` store holds what's true about the current session. The `schema` store holds what's true about the configured system. Role list and hierarchy metadata belong to the schema — not the session.
