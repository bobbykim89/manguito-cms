# Declarative Version Model — Design

**Date:** 2026-09-02
**Status:** Approved, ready for implementation planning
**Scope:** Replace the rename-history version model with three optional declarations on a field. Supersedes [the version model in core](2026-08-30-version-model-core-design.md) and the rename mechanism in [the parent schema-versioning design](2026-08-27-schema-versioning-design.md).

## Why this supersedes the built model

[Sub-project 2a](2026-08-30-version-model-core-design.md) shipped a version model that **derives** a field's storage column by folding a rename history backwards. It merged inert — nothing imports it — and it works. But deriving identity is what created every hard problem the sub-project spent its whole review budget on:

- `after` tags on every rename, and the fold rule that reads them.
- **Rename windows**: entries sharing a tag have no order relative to one another, so they must apply simultaneously. Getting this wrong produced a silently corrupt union — two fields on one column, a live column demoted to retained-nullable — which the final review caught only by executing the module.
- **A chain and a shift are indistinguishable** from the entries alone. `a→b, b→c` and `title→headline, subtitle→title` have the same shape. The shipped resolution refuses both, blocking a legitimate operation loudly rather than folding one of them wrongly.
- **History can never be pruned**, because retiring a version would delete the rename that resolves a column. That constraint propagated into the file layout, the retirement design, and a dedicated regression test.
- **Retention had to be derived** by merging every live snapshot, which left paragraph types and deleted types uncovered — a gap that had to be made loud rather than closed.

None of those are incidental. They are all consequences of one choice: computing identity instead of stating it.

**The `column_name` concept already exists.** Stages 1 and 1.5 spent two releases decoupling a field's public **label** (`ParsedField.name`) from its Postgres **storage key** (`db_column.column_name`). `fieldTypeRegistry` merely defaults the latter to `raw.name`. Letting a schema state it directly is the smallest possible way to produce divergence — and it makes every problem above disappear rather than need solving.

## Goals

1. A field's storage column is **stated**, not derived, and is therefore stable regardless of what has been retired.
2. Renaming a field neither moves data nor breaks a pinned consumer.
3. A forgotten declaration is a **structural error**, not a silent empty column.
4. Every existing schema keeps working unchanged.

## Non-goals

- **No data migration.** A rename never moves data; the column is the same column.
- **No renaming of paragraph or many-to-many fields.** Their identity is persisted as data (`parent_field` values, junction table names), unchanged from the parent design.
- **No CLI, no versioned routes, no GraphQL.** Those remain 2c, 2d and 2e.

## The model

### Three optional keys on a field

```json
{ "name": "title",     "column": "blog_title", "type": "text/plain" }
{ "name": "blog_desc", "removed": true, "fallback": "", "type": "text/rich" }
```

- **`column`** — the field's storage column. Defaults to `name`, so no existing schema changes meaning.
- **`removed`** — a **tombstone**: the column is retained, and this version does not expose it.
- **`fallback`** — on a tombstone, the value served for rows created after the removal. Rows that predate it keep their real value.

Plus `schemas/versions/vN/` frozen snapshots, which now serve exactly one purpose: recording what an older version exposed.

The keys compose. A field renamed and *then* removed carries both — `{"name": "blog_desc", "column": "description", "removed": true}` — because the tombstone must retain the column the older version actually exposes, not the label it was last known by. `fallback` is meaningful only on a tombstone; on a live field it is ignored, and declaring it there is worth rejecting rather than silently dropping.

A tombstone retaining a column **no live version exposes** is not inert: it emits a real column into the union that nothing can ever read. That is a leftover from a retirement whose tombstone was not deleted, so it is an error (`ORPHANED_TOMBSTONE`) naming the fix — delete the field. This is the mechanism that keeps retirement from silently accumulating dead columns, and it is only possible because retention is stated.

**Removed entirely** from the previous model: `pending.json`, `history.json`, the fold, rename windows, `after` tags, `drops`, the chain-versus-shift ambiguity, the never-prune rule, and the shift/swap refusal.

### A rename, end to end

```
v1 snapshot:  { "name": "blog_title" }                        → column blog_title, exposed as blog_title
current (v2): { "name": "title", "column": "blog_title" }     → column blog_title, exposed as title
```

One column, two labels, no data movement. A **shift** is two independent facts — `{name:'headline', column:'title'}` and `{name:'title', column:'subtitle'}` — with no ordering between them, so it is unambiguous by construction. A **swap** likewise. A **chain** self-collapses: rename `a→b→c` over time and you simply end at `{name:'c', column:'a'}`, because you edit the same declaration each time.

### Everything derives by reading

**Union registry** = the current schema's fields, tombstones included. No snapshot merging. It stays an ordinary `SchemaRegistry`, feeding db codegen and drift detection.

Because retention is now stated rather than derived, the deleted-type retention gap closes outright — `VERSION_COLUMN_MISSING` names the missing type and tells the author to keep it with tombstones. The paragraph-type gap does not close on its own: paragraph types stay outside `VersionProjection` by design, so stating retention only makes that case *checkable*, not closed, and each check that covers it reaches into `paragraph_types` directly instead of reading a projection.

**Projections** = for each live version, read that version's own schema files and map each field's declared column to its label. A tombstone is excluded from the version that declares it. No computation spans versions.

**Live versions** = every snapshot under `versions/` plus the current working schema. Current = `v{N+1}` where N is the highest snapshot, `v1` when none — unchanged from 2a.

### The completeness check

This replaces `AMBIGUOUS_RENAME` and is structurally stronger, because it checks a *presence* rather than interpreting an *absence*:

> Every column any live version's projection exposes must exist in the union.

A forgotten `column` override fails it immediately:

```
v1 exposes column "blog_title", which the current schema neither exposes nor
retains. Either add "column": "blog_title" to the field that replaced it, or
mark it "removed": true to retain the column while v1 is live.
```

There is no absence to interpret and nothing to confirm, so the previous model's `drops` mechanism — and the whole `AMBIGUOUS_RENAME` heuristic with its three conditions and five negative cases — is unnecessary.

## Cross-package consequences

A tombstone is a field that **has a column but is not part of the current contract**. That splits its treatment, and this is the one place the new model costs more than the old one:

| Consumer | Treatment |
|---|---|
| `db` codegen (`packages/db/src/codegen`) | **Include** — the column exists and must be emitted, nullable |
| Core's projection for the version declaring it | **Exclude** — not exposed |
| Admin runtime forms (`packages/admin/src/components/fields/field-registry.ts`, `ContentFormView.vue`, `TaxonomyFormView.vue`, `TaxonomyListView.vue`) | **Exclude** — a tombstone must not render a dead input |
| Admin build-time form codegen (`generateFormComponent`, called from `packages/cli/src/codegen/forms.ts`) | **Exclude** |
| Api required-field validation and filters | **Exclude** — a tombstone can be neither required nor filtered |

The api's current-version exposure is handled once 2d consumes core's projections, since a tombstone is already excluded there. Before 2d, a tombstone would still reach the api's per-type projectors — which is acceptable only because tombstones cannot arise until versioning is usable, i.e. until 2c and 2d exist. **The ordering matters and should not be relied on silently:** whichever sub-project first makes tombstones reachable must also exclude them from the api.

## Failure modes

`Result` with the existing `ParseError` shape, collecting every error rather than stopping at the first.

| Code | Trigger |
|---|---|
| `VERSION_COLUMN_MISSING` | A live version's projection exposes a column the union neither exposes nor retains — a forgotten `column` or a missing tombstone |
| `DUPLICATE_COLUMN` | Two fields of one type declare the same `column` |
| `UNRENAMEABLE_FIELD_KIND` | `column` declared on a paragraph or many-to-many field, whose identity is persisted as data |
| `FIELD_TYPE_CHANGED_WHILE_LIVE` | A column a live version exposes changed type. One column cannot hold two types |
| `TOMBSTONE_REQUIRED` | A tombstone also marked `required` — unsatisfiable, since new rows cannot populate it |
| `VERSION_SNAPSHOT_INVALID` | A snapshot fails to parse. Wraps the underlying errors |
| `ORPHANED_TOMBSTONE` | A tombstone retains a column no live version exposes — a retirement left half-done |
| `FALLBACK_WITHOUT_TOMBSTONE` | A `fallback` declared on a field not marked `removed: true` — a fallback is only meaningful on a tombstone |

Retained columns are forced nullable regardless of what the tombstone declares, because rows created after the removal cannot populate them.

## What survives from 2a, and what goes

**Goes:** `fold.ts` in full; `union.ts`'s snapshot-merging (reduced to a read of current); `projections.ts`'s `columnOf` usage; `validate.ts`'s rename-chain, window-shape, ambiguity and drops checks; `types.ts`'s `PendingChanges` and `VersionHistory`; `load.ts`'s reading of the two declaration files.

Four `ParseErrorCode` members added by 2a are retired with the checks that raised them: `AMBIGUOUS_RENAME`, `RENAME_CHAIN_BROKEN`, `VERSION_MODEL_INCONSISTENT` and `VERSION_RETENTION_UNSUPPORTED`. `VERSION_SNAPSHOT_INVALID`, `UNRENAMEABLE_FIELD_KIND` and `FIELD_TYPE_CHANGED_WHILE_LIVE` survive. Five are new: `VERSION_COLUMN_MISSING`, `DUPLICATE_COLUMN`, `TOMBSTONE_REQUIRED`, `ORPHANED_TOMBSTONE`, `FALLBACK_WITHOUT_TOMBSTONE`. Removing a member of that union is a breaking change to core's published surface, which reinforces the note below about bumping core before anything imports it.

**Survives:** snapshot discovery and parsing in `load.ts` (including the `config.folders` fix and its `schema-folders.ts` extraction); `VersionModel` and `VersionProjection`; the version-identity derivation; the `Result`-and-collect discipline; `isColumnBacked`; the structural duplicate-column invariant, which becomes a first-class check.

**New:** three keys in `packages/core/src/parser/validators.ts` and their handling in `packages/core/src/registry/fieldTypeRegistry.ts`, which currently hardcodes `column_name: raw.name` in nine places.

Concretely: `packages/core/src/versions/` is 1289 lines today, of which `fold.ts` (298) goes entirely and `validate.ts` (424) is mostly replaced by two checks. 2a merged inert, so this costs code and nothing else — no consumer, no published dependency, no migration.

## Testing

Fixtures must continue building every `ParsedField` through the real `parseSchema`, so a declaration's effect is exercised rather than hand-forged.

**The parser** — `column` defaults to `name` when absent; an explicit `column` lands in `db_column.column_name`; `removed` produces a field that still carries a column; `fallback` is carried; each error code fires.

**The union** — tombstones are included and forced nullable; a non-tombstone field keeps its own nullability; the union equals current field-for-field when nothing is retained.

**Projections** — a renamed field exposes its old label in the old version and its new label in current, both over one column; a tombstone is excluded from the version declaring it but present in older versions; a fallback attaches to the right column.

**The completeness check** — fires on a forgotten `column`; does **not** fire when the `column` is declared; does **not** fire when a tombstone retains it; does **not** fire for a field no live version ever exposed.

**Tombstone edge cases** — a tombstone carrying both `column` and `removed` retains the column the older version exposes, not its label; an orphaned tombstone is rejected; a `fallback` on a live field is rejected.

**Shift, swap and chain** — each expressed as declarations and asserted correct, with no ordering dependence. These are the cases the fold-based model could not handle; they should be unambiguous here and are worth pinning as the evidence that the redesign achieved its purpose.

**Zero-config** — no `versions/` directory yields one live version, an identity projection, and a union equal to current.

## Deliverables

### Code

- `packages/core/src/parser/validators.ts`, `packages/core/src/registry/fieldTypeRegistry.ts` — the three keys.
- `packages/core/src/versions/` — reduced per above: `fold.ts` deleted, `union.ts` and `projections.ts` simplified, `validate.ts` replaced by the completeness and duplicate-column checks, `load.ts` losing its declaration-file reading.
- `packages/core/src/index.ts` — exports adjusted for the removed types.

### Documentation

- `packages/core/CONTEXT.md` — the versioning glossary rewritten: *cut*, *snapshot* and *retained column* survive; *pending.json / history.json* and *declared drop* go; *tombstone* and *declared column* arrive.
- This document supersedes the 2a design doc; the parent design's rename mechanism is superseded and should say so.
- No changeset while nothing consumes the module — but note that `packages/core`'s published surface changes, and whichever sub-project first imports it must bump core so its exports actually publish.

## What the later sub-projects inherit

- **2b — db codegen** consumes the union as an ordinary `SchemaRegistry`; tombstones appear as nullable columns needing no special handling.
- **2c — CLI** becomes markedly simpler: `version:cut` copies the schema folders and bumps, with **no sealing step at all**. `version:diff` prints a projection. `version:retire` deletes a snapshot; the author then deletes the corresponding tombstones, which shrinks the union and yields a normal `DROP COLUMN`.
- **2d — versioned REST routes** consume the projections, and must exclude tombstones from the api's current-version exposure.
- **2e — GraphQL** derives its `@deprecated` retained fields and rename aliases from the projections.
