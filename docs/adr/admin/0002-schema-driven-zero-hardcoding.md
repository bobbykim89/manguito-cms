---
status: accepted
---

# The admin panel is entirely schema-driven — no per-content-type code

Nothing in the admin panel is hardcoded per content type. The navigation is built from `GET /admin/api/content` and `GET /admin/api/taxonomy`; forms are rendered from the schema registry ([admin 0001](./0001-dual-mode-form-rendering.md)); list-view columns come from smart defaults (title = the first `text/plain` field, plus the `slug`/`published`/`updated_at` system fields) with no schema annotation. The registry is fetched from `/admin/api/schema` at startup in dev and compiled into the bundle at build. Adding a new schema makes a fully functional admin screen appear with zero new UI code.

## Considered Options

- **Bespoke screens per content type** — rejected: defeats the purpose of a schema-driven CMS; every new content type would need hand-written list/form/nav code and would drift from the schema.
- **Schema annotations for list columns / nav** — rejected for v1: smart defaults (first text field as title) cover the common case without adding configuration surface to schema files.

## Consequences

- The panel has exactly one generic `ContentFormView`, `ContentListView`, etc. — mode differences (`only_one` singleton vs. collection) are conditionals, not separate components.
- This depends on the API exposing schema structure to any authenticated user ([api 0003](../api/0003-hybrid-jwt-auth.md) config/schema endpoints): structure is non-sensitive; permissions govern what you can *do*, not whether you can see the shape.
- The cost of the generic approach is that genuinely one-off UI (a bespoke dashboard widget) has no natural home in v1 — deferred until a real need appears.
