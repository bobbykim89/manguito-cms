# CLI Version Lifecycle — Design (Schema Versioning 2c)

**Date:** 2026-09-02
**Status:** Approved, ready for implementation planning
**Scope:** Three CLI commands — `version:cut`, `version:diff`, `version:retire` — plus two new exports from `packages/core`. Makes schema versioning usable for the first time. No routes, no GraphQL, no db codegen changes.

## Problem

[The declarative version model](2026-09-02-declarative-version-model-design.md) shipped in core `0.4.0`: a field states its storage column with `column`, retains one with `removed: true`, and serves a `fallback` for rows written after a removal. Core can compute the live versions, the union registry and each version's projection.

But **nothing can create a snapshot.** `loadVersionModel` reads `schemas/versions/vN/` directories that no tool writes, so every project has exactly one live version forever. The model is correct and inert.

This sub-project supplies the lifecycle: cut a version, see what cutting would freeze, retire a version you no longer serve.

## Goals

1. Cutting a version is a single reviewed command, not a manual directory copy.
2. Before cutting, the author sees exactly what contract they are about to freeze.
3. A version number, once cut, always means the same contract.
4. A partial cut or a partial retire is impossible.

## Non-goals

- **No versioned routes.** Serving `/api/v1/*` is 2d.
- **No GraphQL.** `@deprecated` retained fields are 2e.
- **No db codegen change.** The union already includes tombstones as nullable columns; that was settled and tested when the model shipped.
- **No `version:list`.** `version:diff` already names the newest snapshot and what current would become. Adding a list command before anyone asks for it is speculative.
- **No editing of hand-authored schema files.** The CLI writes only to generated locations today (`.manguito/`, codegen targets). `version:retire` names the edits to make rather than making them — see *Retirement is two steps*.

## Two additions to core

### `describeSchemaChange`

```ts
describeSchemaChange(from: SchemaRegistry | null, to: SchemaRegistry): SchemaChange
```

A pure function, keyed by **column** rather than by name — which is what makes a rename legible as a rename instead of as a delete plus an add.

It lives in core rather than the CLI because core already owns the version model, and a classification derived from two registries is the same kind of artifact as the union and the projections. ADR cli/0001 makes the CLI a composition root that owns side effects; a pure data transformation is not that. Splitting the model's read side across two packages would be the odd seam.

**Rejected on evidence:** diffing two `VersionProjection`s instead. A projection carries only `{ column_name, exposed_as, fallback? }` — no `field_type` — so it cannot detect a retype, and it cannot distinguish a newly added column from an existing one. The comparison needs both registries.

### `loadVersionSnapshots`

```ts
loadVersionSnapshots(config: ResolvedSchemaConfig, current: SchemaRegistry): Result<VersionSnapshot[]>
```

`VersionModel` carries `current`, `live`, `union` and `projections` — but not the snapshots' registries, so a caller cannot reach the newest snapshot to compare against. Exporting the snapshot loader is preferable to adding N full registries to `VersionModel`, which is passed around and consumed by db codegen.

This matches core's established style: the CLI's `validate.ts` already composes `walkSchemaDirectory`, `parseSchema`, `parseRoles`, `parseRoutes`, `buildSchemaRegistry` and `validateCrossReferences` itself. Core exports building blocks; the CLI assembles them.

The function is the extraction of logic `loadVersionModel` already runs internally, including its use of `config.folders` rather than hardcoded folder names — the fix for a Critical defect found in the 2a review, where a project that renamed a schema folder read **every** snapshot as silently empty.

## A valid model admits exactly four changes

Working out the change categories collapsed them further than expected.

An early sketch had six kinds, including `retyped` and `dropped`. **Both are unreachable.** A column the newest snapshot exposes that is absent from current is already `VERSION_COLUMN_MISSING`; a column whose type changed is already `FIELD_TYPE_CHANGED_WHILE_LIVE`. If `loadVersionModel` succeeds, neither can be present. The same argument retires a type-level `dropped` status.

That yields a property worth stating plainly:

> **If the model loads, cutting is always safe.**

The new snapshot's registry *is* the current registry, so every column it exposes is in the union trivially and every field type matches trivially. There is no "would this cut be valid?" question — a blocker, if one exists, is already failing today. So neither command needs blocker machinery: both call `computeVersionModel` first and print its errors if it fails.

```ts
export type FieldChange =
  | { kind: 'added';      column: string; name: string; field_type: FieldType }
  | { kind: 'renamed';    column: string; from_name: string; to_name: string }
  | { kind: 'tombstoned'; column: string; name: string; fallback?: unknown }
  | { kind: 'restored';   column: string; name: string }

export type TypeChange = {
  type: string
  /** `added` when current defines a type the snapshot did not. `dropped` is unreachable — it is VERSION_COLUMN_MISSING. */
  status: 'present' | 'added'
  /** Empty when the type is unchanged. */
  fields: FieldChange[]
}

export type SchemaChange = {
  /** The snapshot compared against; `null` when nothing has been cut yet. */
  from: string | null
  /** The version the working schema would become if cut now. */
  to: string
  types: TypeChange[]
  /** True when no type or field changed — cutting would freeze an identical contract. */
  identical: boolean
}
```

`restored` earns its place: a snapshot can itself contain a tombstone, and if current un-removes that field the column goes live again. Without the kind, the case falls through every other branch and is reported as *unchanged* — a lie.

**Deliberately omitted:** a `fallback_changed` kind. Editing a tombstone's fallback does change what an older version serves, but it is not a shape change, and inventing a category for it before anyone needs it is speculative. Recorded here so the omission is a decision rather than an oversight.

`from: null` makes every field `added` and every type `added` — the zero-config first cut.

## The three commands

Registered as `version:cut`, `version:diff`, `version:retire`, matching the CLI's existing colon-namespaced pattern (`users:promote`, `users:demote`) rather than commander subcommands.

**Files:**
- `packages/cli/src/commands/version.ts` — `registerVersion(program)` plus the three handlers, following `users.ts`'s one-file-per-namespace precedent.
- `packages/cli/src/commands/version-report.ts` — formats a `SchemaChange` for the terminal, shared by `diff` and `cut`. `dev-routing.ts` is the precedent for a helper module living in `commands/`.

**Shared preamble**, in every handler: `loadEnvFile` → `resolveConfig` → build the working registry → `loadVersionSnapshots` → `computeVersionModel`. If the model is invalid, `printValidationErrors` then `process.exit(1)`, exactly as `validate` does.

Handlers stay thin and take injected deps per ADR cli/0002. Every decidable step is a pure function, because that is what the repo's CLI tests exercise — `build.test.ts` mocks `node:fs` and tests helpers, not `runBuild`.

### `version:diff`

Options: `--env <path>`.

Compares the **highest-numbered** snapshot against the working schema and prints the report. Highest-numbered, not last-created: the live set may have gaps once versions are retired, and `current` is derived from the highest, so that is the snapshot the working schema is actually a successor to. States plainly when nothing has changed. Exits 0 unless the model is invalid.

```
$ manguito version:diff

Working schema vs v2 (newest snapshot)

content--blog_post
  + subtitle              text/plain  new
  ~ title                 was "blog_title"  → column blog_title
  ⊘ blog_desc             tombstoned  → column retained, fallback ""

taxonomy--tag
  (no changes)

Cutting now would create schemas/versions/v3/.
```

### `version:cut`

Options: `--env <path>`, `--yes`.

1. Refuse when `identical` — a cut with no contract change adds a live version whose columns must then be retained forever, for nothing.
2. Print the report, plus what the resulting live set commits the author to.
3. Confirm through `PromptAdapter.confirm`, unless `--yes`.
4. Copy the four type folders into `<schema root>/versions/<model.current>/`, using `config.folders` so overrides are respected. Note `VersionModel.current` is already the version *name* (`"v3"`), not a number — the directory is `versions/v3`, not `versions/vv3`.

`roles.json` and `routes.json` live at the schema root, not inside a type folder, so they are excluded naturally — matching core, whose `loadSnapshot` deliberately assembles every snapshot with *current's* routes and roles because neither is versioned.

```
$ manguito version:cut

Would freeze the working schema as v3.

content--blog_post
  + subtitle       text/plain  new
  ~ title          was "blog_title"
  ⊘ blog_desc      tombstoned

After cutting, v1 v2 v3 are live. Every column those
versions expose must stay in the schema — as a live
field or a tombstone — until you retire them.

Proceed? (y/N)
```

### `version:retire <version>`

Options: `--env <path>`, `--yes`. Argument: a version name such as `v1`.

Computes the tombstones that retirement would orphan **before** deleting anything, by recomputing the model without that snapshot and reading its `ORPHANED_TOMBSTONE` errors. Removing a snapshot can only ever introduce that one error class — fewer live versions means fewer columns to satisfy and fewer types to compare — so nothing else needs re-checking.

```
$ manguito version:retire v1

Removed schemas/versions/v1/

2 tombstones are now orphaned — their columns are no
longer exposed by any live version. Delete these fields:

  content--blog_post.json
    - blog_desc   (retains column blog_desc)

  taxonomy--tag.json
    - old_slug    (retains column old_slug)

Until then `manguito validate` will report
ORPHANED_TOMBSTONE. Deleting them lets the next
migration DROP those columns.
```

## A version number must always mean the same contract

`current` is derived as *highest snapshot + 1*. So retiring the **highest** snapshot renumbers the working schema backwards onto a number that was already published: with `v1` and `v2` live and current at `v3`, retiring `v2` makes current become `v2` — and a consumer pinned to `v2` would silently receive a different contract.

That is the one thing versioning exists to prevent, so:

> **`version:retire` refuses to retire the highest-numbered snapshot.**

The error explains that current would renumber onto it, and that cutting first makes it retirable. Every other snapshot can be retired, in any order — the model tolerates gaps in the live set, since `live` is derived from whichever directories exist.

## Retirement is two steps, and neither order is valid

There is no valid resting point between "the version is live" and "its tombstones are gone":

- Delete the tombstone while `v1` is still live → `VERSION_COLUMN_MISSING`, because `v1` exposes a column the union no longer has.
- Retire `v1` while the tombstone remains → `ORPHANED_TOMBSTONE`, a retained column nothing exposes.

So retirement is inherently transiently invalid, and the design makes that explicit rather than surprising: `version:retire` deletes the snapshot and names the exact fields to delete next. It does **not** edit them. Doing so would give the CLI a new capability — format- and comment-preserving writes to hand-authored files in both JSON and YAML, since core accepts `.json`, `.yaml` and `.yml` — and the CLI writes only to generated locations today.

## A partial cut or retire must be impossible

A *partial* snapshot is worse than no snapshot: it parses as a valid but incomplete version, so columns silently vanish from the union and the model either reports `VERSION_COLUMN_MISSING` or serves a wrong contract.

- **`cut`** copies into `versions/.v3.tmp`, then performs one `rename` to `versions/v3`. Rename within a filesystem is atomic, so the snapshot exists whole or not at all. The temp name is chosen **not** to match `/^v\d+$/`, so a leftover from a crashed run is invisible to snapshot discovery rather than being read as a broken version.
- **`retire`** mirrors it: `rename versions/v1 → versions/.v1.removing` first — which retires it instantly as far as discovery is concerned — then deletes the renamed directory. A failed delete leaves inert junk, not a half-deleted version.

## Failure modes

All use `printGuidedError` followed by `process.exit(1)`, matching `validate.ts`. `printGuidedError` prints without exiting; the caller owns the exit code.

| Condition | Behaviour |
|---|---|
| Config unresolvable | `resolveConfig` already exits with a guided error |
| Schema or model invalid | `printValidationErrors`, exit 1 — same as `validate` |
| `cut` when nothing changed | Names both fixes: change the schema, or retire an old version to shrink the live set |
| `cut` target already exists | Near-unreachable, since `current` is `highest+1` — but a *file* named `v3` is skipped by discovery while still blocking `mkdir`, so it is checked rather than assumed |
| `retire` unknown version | Lists the snapshots that do exist |
| `retire` the highest snapshot | Explains the renumbering hazard and that cutting first makes it retirable |
| `retire` malformed argument | Expects `v<number>` |
| Confirmation declined | Exit 0, "Nothing was written" — declining is not an error |

## Testing

Every decidable step is a pure function tested directly; the `run*` handlers stay thin. This follows the repo: `build.test.ts` mocks `node:fs` and tests helpers rather than `runBuild`, and `dev-routing.ts` exists precisely so `dev`'s logic is testable.

**Core — `describeSchemaChange`:** each of the four kinds; `identical` true and false; `from: null` making everything `added`; a type added; a tombstone with and without a `fallback`; and `restored`, which no other kind covers.

Every fixture whose claim depends on column-keying **declares a `column`**, so name and column diverge. A fixture that declares none cannot distinguish column-keying from name-keying and proves nothing — the recurring trap in this project's tests. Fixtures go through the real `parseSchema`; a `db_column` is never hand-forged.

**Core — `loadVersionSnapshots`:** a direct test, including a non-default folder name from `config.folders`, which guards the 2a Critical defect.

**CLI — pure decisions:** whether a named version is the highest (the renumbering guard); which tombstones retirement would orphan; and `version-report.ts`'s formatting.

**CLI — filesystem work:** `copySnapshotFolders(from, to, folders)` and the rename helpers, against a temp directory. Two cases matter most: a failed copy leaves no `versions/v3`, and a `PromptAdapter` returning `false` writes nothing at all.

## Deliverables

**Core**
- `packages/core/src/versions/describe.ts` — `describeSchemaChange` and its types.
- `packages/core/src/versions/load.ts` — extract and export `loadVersionSnapshots`; `loadVersionModel` composes it.
- `packages/core/src/index.ts` — export both, plus `SchemaChange`, `TypeChange`, `FieldChange`.

**CLI**
- `packages/cli/src/commands/version.ts` — `registerVersion(program)` and the three handlers.
- `packages/cli/src/commands/version-report.ts` — the formatter.
- `packages/cli/src/index.ts` — register the namespace.

**Documentation**
- `packages/core/CONTEXT.md` — add *change classification* to the versioning glossary.
- `packages/cli/CONTEXT.md` — the three commands and the retirement two-step.
- A changeset: core **minor** (new exports), cli **minor** (new commands).

## What later sub-projects inherit

- **2d — versioned REST routes** consume `model.projections` to serve `/api/v<N>/*`, and must build their per-version field-key maps from those projections rather than from current's fields.
- **2e — GraphQL** derives `@deprecated` retained fields and rename aliases from the same projections.

## Residuals

- `VersionModel.current` is derived, never persisted. Unchanged from the model's design; `version:cut` does not write it anywhere, because the snapshot directories are the truth.
- A tab whose every field is tombstoned renders as an empty tab in the admin panel. Cosmetic, recorded when tombstones were excluded from the admin.
