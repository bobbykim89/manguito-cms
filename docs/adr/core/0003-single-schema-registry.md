---
status: accepted
---

# One SchemaRegistry, name-based cross-references, flat fields with separate UI structure

All parsed schemas are assembled into a single `SchemaRegistry` that is the one source of truth for db codegen, api route generation, and admin form generation. Cross-references between schemas (a `reference` field's target, a `paragraph` field's ref) are stored as machine-name strings only — never inlined — and consumers resolve them by looking up the registry. The `fields` array is always flat: tab wrappers from the schema file are stripped out and preserved separately in `UiMeta`, which only the admin panel reads.

## Considered Options

- **Inlined references** (embed the referenced schema inside the referencing field) — rejected: causes duplication and reintroduces the circular-resolution risk that name-based lookup avoids.
- **Per-consumer models** (separate parse outputs for db / api / admin) — rejected: three sources of truth drift apart; a schema change would need three updates.
- **Tabs kept in the field tree** — rejected: db and api have no concept of tabs and would have to skip past UI-only nesting on every traversal.

## Consequences

- Convenience maps (`content_types`, `paragraph_types`, …) are derived views over `schemas`, not independent data.
- The admin panel reconstructs tab layout by looking field names up from the flat array via `UiMeta.tabs` — field definitions are never duplicated between the two.
