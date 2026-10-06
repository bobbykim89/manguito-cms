---
status: accepted
---

# A field's storage column is its identity across versions

A field has three names: its `label` (shown in the admin panel), its `name` (the public API key, which may differ per version), and its **column** (`db_column.column_name`, where the value is stored). The column is the one that never changes. It defaults to `name` and is **declared** by the author with `column` when a field is renamed. Versions are compared, retained and projected by column. Two versions that expose the same column under different names are exposing one field.

A field removed from the working schema while an older version still exposes its column stays in the schema as a **tombstone**: `removed: true`, an optional `fallback`, and no `required` (a required tombstone is rejected with `TOMBSTONE_REQUIRED`, since nothing writes the column any more). Tombstones are part of the current registry. So the registry db codegen consumes, the "union registry", is simply the current registry: nothing is merged from snapshots, and a column is retained exactly as long as a tombstone declares it.

Only fields with a storage column of their own participate. A `paragraph` field's association lives on the paragraph table (`parent_field`), and a many-to-many `reference` field's lives in a junction table whose name embeds the field name. Both keep their name as their identity, so `column` and `removed` on them are rejected (`UNRENAMEABLE_FIELD_KIND`).

## Considered Options

- **Derive the column from a rename log** (`pending.json` appended by renames, folded backwards per version). This was the umbrella design's mechanism, and it was rejected in the declarative redesign. The log drifted from the files it described, a snapshot could not be read without replaying history, and a rename was invisible in the schema file itself.
- **Rename the physical column on a schema rename.** Rejected. `drizzle-kit generate` cannot tell a rename from a drop-and-add without asking interactively, and the drop branch destroys exactly the data an older version still serves.
- **A general storage key on every field kind**, paragraph and many-to-many included. Rejected for now: it changes `parent_field` semantics and junction table naming, both already persisted in existing databases, for renameability on fields authors rarely rename.

## Consequences

- Core validates the declarations at parse time (`DUPLICATE_COLUMN`, `TOMBSTONE_REQUIRED`, `FALLBACK_WITHOUT_TOMBSTONE`, `UNRENAMEABLE_FIELD_KIND`) and the version model at build time (`VERSION_COLUMN_MISSING`, `FIELD_TYPE_CHANGED_WHILE_LIVE`, `ORPHANED_TOMBSTONE`, `VERSION_SNAPSHOT_INVALID`). `manguito validate` and `manguito build` run both.
- Retirement is two steps: delete the snapshot, then delete the tombstones no live version still needs (`ORPHANED_TOMBSTONE` names them). The next migration then drops their columns.
- Renaming a field without declaring `column` changes its column. While a live version exposes the old column that is refused. Before any version exists it is a plain column rename, which drizzle-kit can only complete interactively. The user guide tells authors to always declare `column`.
- The api treats the column as the internal identity of a field throughout, and applies a version's names once at the response boundary ([ADR api/0011](../api/0011-field-label-vs-storage-key.md)).
- User guide: [`docs/schema-versioning.md`](../../schema-versioning.md).
