import type { SchemaRegistry } from '../parser/validate.js'

// ─── Version model types ──────────────────────────────────────────────────────
//
// Schema versioning versions the CONTRACT, not the data: one canonical row per
// content item, with each live version applied as a projection at the API edge.
// This module computes what each live version exposes and which column backs it.
//
// A field has a public LABEL (`ParsedField.name`) and a storage KEY
// (`db_column.column_name`). They are identical for every schema the parser
// currently produces; a rename makes them diverge, and the fold in fold.ts is
// what recovers the column from a label.

/** `schemas/versions/pending.json` — HAND-WRITTEN. Declarations since the last cut. */
export type PendingChanges = {
  /** `from`/`to` are LABELS as they appear in the schema files, never columns. */
  renames: Array<{ type: string; from: string; to: string }>
  /** `"<type>.<label>"` — confirms a removal is intentional, not an undeclared rename. */
  drops: string[]
  /** `"<type>.<column_name>"` → the value served when a retained column is null. */
  fallbacks: Record<string, unknown>
}

/** `schemas/versions/history.json` — MACHINE-WRITTEN by `version:cut`. Append-only, never pruned. */
export type VersionHistory = {
  /** `after` names the version this rename followed, e.g. 'v1'. */
  renames: Array<{ after: string; type: string; from: string; to: string }>
  drops: Array<{ after: string; field: string }>
  fallbacks: Record<string, unknown>
}

/** A frozen snapshot, parsed. */
export type VersionSnapshot = {
  version: string
  registry: SchemaRegistry
}

/** What one live version exposes. A type absent from `types` is not exposed by it. */
export type VersionProjection = {
  version: string
  types: Record<string, {
    fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }>
  }>
}

export type VersionModel = {
  /** e.g. 'v2' — the working schema's version. */
  current: string
  /** Oldest first, including current. */
  live: string[]
  /**
   * Every column any live version needs, keyed by column — which is the
   * CURRENT registry itself, `=== current` by reference.
   *
   * Retention is stated (a tombstone), not derived by merging snapshots, so
   * there is nothing to merge: a column an older live version still serves is
   * in current as a tombstone, or `VERSION_COLUMN_MISSING` rejects the model.
   * That also removes the derived model's retention gaps — a type current
   * deleted, and a paragraph type's own column — because the author is now
   * *required* to keep them rather than the model trying to reconstruct them.
   *
   * Feeds db codegen and drift detection. A tombstone appears here as an
   * ordinary nullable column; consumers that render or expose fields must skip
   * `removed` fields, which is why the api and admin filter on it.
   */
  union: SchemaRegistry
  /** Keyed by version name; includes current (an identity projection). */
  projections: Record<string, VersionProjection>
}
