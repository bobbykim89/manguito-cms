---
status: accepted
---

# Permission-aware UI is hidden-not-disabled, driven by the same roles model as the API; session and system state live in separate stores

UI elements a user cannot act on are hidden entirely (`v-if`), never shown disabled — a greyed-out delete button is confusing in a CMS. Gating uses the same permission model the API enforces: `usePermission().can('content:delete')` checks the acting user's permissions, and the role picker shows only roles strictly below the acting user's `hierarchy_level` (the `admin` role is never offered — admin promotion is CLI-only). The UI is convenience, not security: the API independently enforces every check ([api 0002](../api/0002-public-admin-split.md), [api 0003](../api/0003-hybrid-jwt-auth.md)). State is split deliberately: the `auth` store holds what's true about the **session** (current user's role, derived permissions, `hierarchyLevel`), while the `schema` store holds what's true about the **system** (the full roles list).

## Considered Options

- **Disabled instead of hidden** — rejected: in a role-segmented CMS, showing actions a user can never take is noise; hiding them keeps each role's UI focused.
- **Roles list in the auth store** — rejected: the roles list is configured-system data, not session data; putting it in `auth` conflates "who am I" with "how is the system configured" and muddies what to clear on logout.
- **UI-only permission enforcement** — never on the table: the UI gate is duplicated for UX; the API is the real boundary.

## Consequences

- A bypassed UI gate (hand-crafted request) is still rejected by the API — the hidden control is a convenience, not the control.
- `content:publish` is never referenced — publish/unpublish is gated by `content:edit` ([core 0004](../core/0004-roles-schema-defined-only.md)).
