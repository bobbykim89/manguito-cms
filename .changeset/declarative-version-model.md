---
"@bobbykim/manguito-cms-core": minor
---

Replace the rename-history version model with three optional, declarative keys on a field: `column` (its storage column, defaulting to `name`), `removed: true` (a tombstone — the column is retained for older live versions but the current version no longer exposes it), and `fallback` (the value served for rows created after a removal). A field's storage identity is now **stated**, not derived by folding a chain of renames, so retiring an old version no longer risks deleting the rename that resolves a column, and a chain/shift/swap can no longer be confused with one another.

This removes `pending.json`, `history.json`, the fold, rename windows, `after` tags, and the `drops` mechanism, along with their types (`PendingChanges`, `VersionHistory`) and error codes (`AMBIGUOUS_RENAME`, `RENAME_CHAIN_BROKEN`, `VERSION_MODEL_INCONSISTENT`, `VERSION_RETENTION_UNSUPPORTED`). `ParseErrorCode` gains `DUPLICATE_COLUMN`, `TOMBSTONE_REQUIRED`, `FALLBACK_WITHOUT_TOMBSTONE`, `VERSION_COLUMN_MISSING` and `ORPHANED_TOMBSTONE` in their place — the completeness check they enforce (every column a live version's projection exposes must exist in the union) is structurally stronger than the heuristic it replaces, since it checks a presence rather than interpreting an absence.

A tombstone is column-backed (its `db_column` is present, forced `nullable: true`) but excluded from the current version's exposure — every existing schema keeps working unchanged, since all three keys are optional and `column` defaults to `name`. See `docs/superpowers/specs/2026-09-02-declarative-version-model-design.md`.
