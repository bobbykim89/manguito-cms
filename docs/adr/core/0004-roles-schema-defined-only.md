---
status: accepted
---

# Roles are schema-defined only; each user has exactly one role

Roles are defined in `schemas/roles.json`, parsed and seeded to the DB, and are read-only in the admin panel — there is no runtime role creation, editing, or deletion through the UI or API (`roles:create`/`roles:edit`/`roles:delete` are not valid permissions; only `roles:read` exists). Each user is assigned exactly one role, not a set. Both choices trade UI flexibility for safety: roles stay version-controlled alongside the rest of the system configuration, and the permission model has no escalation surface at runtime.

## Considered Options

- **Runtime role management UI** — rejected: roles would diverge from source control and create a live permission-escalation surface in the most security-sensitive part of the system.
- **Multiple roles per user** — rejected as unnecessary: the role hierarchy is a strict superset chain (each level includes everything below it), so a single role already expresses any reachable permission set. `hierarchy_level` gives a total ordering that drives assignment rules.

## Consequences

- Changing roles is a deploy: edit `roles.json` → `manguito build` → `manguito migrate`.
- Admin promotion/demotion is CLI-only (`manguito users:promote` / `users:demote`), and at least one admin must always exist — enforced at the CLI, not the UI.
- A future request for "let an admin add a role from the dashboard" runs against this decision deliberately; reopen the ADR rather than working around it.
