---
"@bobbykim/manguito-cms-api": patch
"@bobbykim/manguito-cms-admin": patch
"@bobbykim/manguito-cms-db": patch
---

Close a hole the declarative version model (`core`, previous release) left open: a field marked `removed: true` (a tombstone) is column-backed — its column is retained for older live versions — so every place that filtered on "does this field have a column" was treating it as an ordinary, currently-exposed field.

**api:** `createFieldKeyMap` now excludes tombstones from the label/column map, and — because `remap` lets an unmapped key pass through unchanged — also actively drops a tombstone's name and column from both directions, so a retained column can no longer be read from a request body or served in a response under its raw column name. The collision check that guards against a label reusing another field's column still runs against the full, tombstone-inclusive map, so a live field colliding with a tombstoned column still fails fast at startup instead of silently losing its column. `GET /admin/api/schema` — the admin panel's only path to schema data — now omits tombstones from every content, taxonomy and paragraph type's `fields`.

**admin:** `generateFormComponent` (build-time form codegen, run from the CLI directly off parsed schemas) no longer generates an input for a tombstone.

**db:** no behavior change — `generateFieldColumn` already emitted a tombstone's column correctly (nullable, since an older live version still reads it). Added a regression test pinning that, so a future change can't silently start dropping it.
