# Version Model in Core — Design (Schema Versioning 2a)

**Date:** 2026-08-30
**Status:** Implemented and merged (PR #33), then **superseded** by [the declarative version model](2026-09-02-declarative-version-model-design.md), which replaces the derived rename history with three stated declarations on a field. This document describes the code as it stood when PR #33 merged; that code has since been replaced by the declarative model, so read this for history, not as a description of what is currently in `packages/core/src/versions/`.
**Scope:** A new `packages/core/src/versions/` submodule that computes the schema-versioning model — live versions, a union registry, and per-version projections — from frozen snapshots and a rename history. Core only. No routes, no codegen, no CLI, no file writing. Merges inert.

## Problem

[Schema versioning](2026-08-27-schema-versioning-design.md) versions the *contract*, not the data: one canonical row per content item, with each live version applied as a declarative projection at the API edge. Two foundation stages have shipped ([Stage 1](../plans/2026-08-27-schema-versioning-stage-1-foundations.md) in `@bobbykim/manguito-cms-api` 0.4.0, [Stage 1.5](2026-08-29-nested-projection-and-sort-mapping-design.md) in 0.4.1) making every consumer stop assuming a field's public **label** equals its Postgres **storage key**.

Nothing yet *produces* divergence. `fieldTypeRegistry` still sets `column_name = raw.name` for every field, so labels and columns are identical in every schema the parser can currently emit. This sub-project builds the piece that computes what each version exposes and which column backs it — the input every later sub-project consumes.

## Goals

1. Given the schema directory, compute the set of live versions, a union registry, and one projection per live version.
2. A field's column is stable for the life of the data, recoverable regardless of which versions have been retired.
3. An undeclared rename fails the build loudly rather than silently losing data, and the failure is actionable without reading a spec.
4. A project with no `versions/` directory behaves exactly as it does today, executing no version-specific code.

## Non-goals

- **No route registration, codegen, CLI, or GraphQL.** Those are 2b–2e.
- **No file writing.** This module reads and returns a value. `version:cut`'s sealing behavior belongs to 2c; this module only reads what sealing produced.
- **No change to `parseSchemas`.** The parser keeps returning one registry.
- **No renaming of paragraph or many-to-many fields.** Their identity is persisted as data (`parent_field` values, junction table names), per the parent spec.

## Changes to the parent spec

This design supersedes the parent on four points. Each is recorded here rather than silently diverging.

**1. `changes.json` splits into `pending.json` (hand-written) and `history.json` (machine-written).** The parent specified one global `schemas/versions/changes.json` where each rename carries a hand-written `after: "v1"` tag. That tag is a liability: it can be typo'd or stale, and on a team every rename touches one file, where a merge conflict resolves to a silently-wrong projection rather than a loud failure. Splitting by *writer* removes it — the author edits one file with one meaning, and `version:cut` writes the tag.

**2. Retirement must not delete rename history — and the parent's design would have.** Column identity requires the *complete* rename chain, not just the live versions'. A field that was `blog_title` at v1, renamed to `title` after v1, then to `headline` after v2 has column `blog_title`; recovering that needs the rename tagged after v1 even once v1 is retired and nothing projects to it. The parent says retirement deletes the snapshot directory; had the rename log lived there, retiring v1 would have permanently lost column identity for every field renamed during its life, and the next codegen would have generated a rename migration against live columns. `history.json` therefore lives outside the version directories and is never pruned.

**3. `pending.json` gains a `drops` key.** The parent says an ambiguity error offers "two ways out — declare a rename, or confirm an intentional drop," but never says how a drop is confirmed. Without a mechanism the error is unactionable: an author who genuinely deleted a field could only proceed by declaring a fake rename.

**4. The union registry is a plain `SchemaRegistry`.** No new type, no per-field version annotation. Only GraphQL needs version membership, and it needs the projections anyway for rename aliases — so membership falls out of them, and `db` codegen and drift detection consume the union exactly as they consume today's registry.

## Approach (chosen)

**A separate module in core, layered above the parser.** `parseSchemas()` is untouched and still returns one registry; the version model is computed from `(schemaConfig, currentRegistry)` by consumers that need it — the CLI at build time, the API at startup.

This keeps [ADR core/0003](../../adr/core/0003-single-schema-registry.md) literally true rather than needing the amendment the parent spec anticipated: the parser still produces exactly one registry, and versioning is a derived layer above it. A project with no `versions/` directory never executes a line of version code, and no existing caller's return type changes.

Rejected alternatives:

- **Integrated into the parser** (`parseSchemas` returns registry plus versions) — rejected: it changes the return type of the most widely consumed function in the codebase to serve a feature most projects will not use, and makes the version model mandatory rather than derived.
- **Computed at build time and written to disk** as a generated artifact — rejected: it adds a generated-file lifecycle for a pure function of files already on disk, and is what the parent spec already rejected for projections.

## Layout and version identity

```
schemas/
  content-types/            # the working schema: always the NEWEST version
  paragraph-types/  …
  versions/
    pending.json            # HAND-WRITTEN. Declarations since the last cut.
    history.json            # MACHINE-WRITTEN by version:cut. Append-only, never pruned.
    v1/                     # frozen snapshot of v1's schema files
      content-types/  …
```

The three files are distinguished by **who writes them**:

- **`pending.json`** is the only file an author edits, with one meaning: declarations covering changes since the last cut. No `after` tag, because there is nothing yet to tag against.
- **`history.json`** is written only by `version:cut`, which appends pending's entries tagged with the version being cut and clears pending. A machine writes the tag, so it cannot be typo'd, and a merge conflict in it is a real conflict rather than a silent misfiling.
- **`versions/vN/`** holds only frozen schema files. Retirement deletes it outright; column identity is unaffected because history lives elsewhere.

### Record shapes

```json
// pending.json — hand-written
{
  "renames": [
    { "type": "content--blog_post", "from": "blog_title", "to": "title" }
  ],
  "drops": ["content--blog_post.blog_desc"],
  "fallbacks": { "content--blog_post.blog_desc": "" }
}
```

```json
// history.json — sealed by version:cut
{
  "renames": [
    { "after": "v1", "type": "content--blog_post", "from": "blog_title", "to": "title" }
  ],
  "drops": [{ "after": "v1", "field": "content--blog_post.blog_desc" }],
  "fallbacks": { "content--blog_post.blog_desc": "" }
}
```

**Renames and drops are tagged; fallbacks are not.** A rename is a transition — *when* it happened decides whether the fold applies it. A drop is likewise a transition, and tagging it keeps the confirmation auditable rather than a transient build-time acknowledgement. A fallback is a property of a column — "if this is null, serve this instead" — applying to whatever versions still expose it; tagging it would imply a lifecycle it does not have.

`renames` name **labels**, not columns: `from` and `to` are what the author sees in the schema files. The fold is what turns a label into a column, so an author never types a column name.

`drops` and `fallbacks` are keyed by `<type>.<label>` and `<type>.<column_name>` respectively. A drop names the label as it stood when the field was removed, which is what the author is looking at. A fallback keys by column because a field that was renamed *and then* dropped has no unambiguous label.

### Version identity, derived

Current version = `v{N+1}` where N is the highest cut snapshot; `v1` when `versions/` is absent. **Live** = every cut snapshot plus the current working schema.

A project with no `versions/` directory therefore has one live version `v1`, an identity projection, and a union equal to its current registry — so every downstream consumer behaves exactly as today with no conditional.

## The computation

### Public surface

A new `packages/core/src/versions/` submodule, exported from the package root, split into an IO shell and a pure core — the same seam the parser already uses between `walkSchemaDirectory` and `parseSchemas`:

```ts
export type VersionProjection = {
  version: string
  /** Keyed by machine name. A type absent here is not exposed by this version. */
  types: Record<string, {
    fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }>
  }>
}

export type VersionModel = {
  /** e.g. 'v2' — the working schema's version. */
  current: string
  /** Oldest first, including current. */
  live: string[]
  /** Every live version's fields merged; feeds db codegen and drift detection. */
  union: SchemaRegistry
  /** Keyed by version name; current's entry is the identity only when no rename applies to it. */
  projections: Record<string, VersionProjection>
}

/** IO shell: reads snapshots, history.json and pending.json from disk. */
export function loadVersionModel(
  config: ResolvedSchemaConfig,
  current: SchemaRegistry
): Result<VersionModel>

/** The two file shapes, mirroring the JSON above. */
export type PendingChanges = {
  renames: Array<{ type: string; from: string; to: string }>
  /** "<type>.<label>" */
  drops: string[]
  /** "<type>.<column_name>" → value served when the retained column is null */
  fallbacks: Record<string, unknown>
}

export type VersionHistory = {
  renames: Array<{ after: string; type: string; from: string; to: string }>
  drops: Array<{ after: string; field: string }>
  fallbacks: Record<string, unknown>
}

/** Pure: every rule below, with the files already loaded. */
export function computeVersionModel(input: {
  current: SchemaRegistry
  snapshots: Array<{ version: string; registry: SchemaRegistry }>  // oldest first
  history: VersionHistory
  pending: PendingChanges
}): Result<VersionModel>
```

All outputs are plain serializable objects, per [ADR core/0002](../../adr/core/0002-serializable-parser-output.md). One entry point per layer, so a consumer cannot use a half-computed model.

### The fold

A rename tagged `after: vJ` happened between vJ and vJ+1. A version vK's labels therefore reflect every rename tagged after vJ for all **J < K**. To recover the column behind a label in vK, apply the reverse of exactly those renames, newest first:

```
columnOf(label, vK) = fold(label, reverse(renames where after < vK), to → from)
```

For the current version that set includes `pending.json`'s entries, implicitly tagged after the newest cut.

Two consequences follow:

- For the **earliest version that ever existed**, the fold is empty and label equals column — which is why column identity is well-defined at all.
- For the **earliest still-live** version, the fold may be non-empty, because retired versions' renames remain in history. This is exactly the case that would silently produce wrong columns if history were pruned.

### Six steps

1. **Discover snapshots** — directories under `versions/` matching `v\d+`, sorted numerically. None found means a single live version `v1`, an identity projection, `union === current`, and an early return that never touches the rest of the module.
2. **Load `history.json` and `pending.json`** — both optional; absent means empty.
3. **Parse each snapshot** into a `SchemaRegistry` with the existing `walkSchemaDirectory` / `parseSchemas` against that snapshot directory. Snapshots are ordinary schema files, so they get ordinary parsing and validation for free.
4. **Compute column identity** for every field in every live version, via the fold.
5. **Build the union** — start from current's fields keyed by column, then add any column an older version exposes that current lacks. Retained columns are forced **nullable**, because rows created after the drop cannot populate them. That relaxation is the only way the union differs from a plain merge.
6. **Build projections** — for each live version and each of its types, one entry per column with the label that version exposes it under, plus any fallback declared for that column.

## Failure modes

`loadVersionModel` and `computeVersionModel` return `Result` with the existing `ParseError` shape (`{ file, code, message, path? }`) and **collect all errors rather than stopping at the first**, matching `walkSchemaDirectory`. New codes join `ParseErrorCode`.

| Code | Trigger |
|---|---|
| `VERSION_SNAPSHOT_INVALID` | A snapshot fails to parse. Wraps the underlying `ParseError`s so the author sees the real problem. |
| `AMBIGUOUS_RENAME` | A label a live version exposes is gone from current, no rename maps it forward, and a same-typed field appeared — either a rename or a drop, and the tool cannot tell. |
| `RENAME_CHAIN_BROKEN` | A rename's `from` matches no label known at that point in the chain — a misfiled `pending.json` entry, or hand-edited history. |
| `UNRENAMEABLE_FIELD_KIND` | A declared rename names a paragraph or many-to-many field, whose identity is persisted as data. |
| `FIELD_TYPE_CHANGED_WHILE_LIVE` | A column a live version still exposes changed type. One column cannot hold two types. |
| `VERSION_RETENTION_UNSUPPORTED` | A live version exposes storage the union registry cannot carry — a whole type current deleted, or a paragraph type's own column current removed. See [Known limitations](#known-limitations). |
| `VERSION_MODEL_INCONSISTENT` | A structural invariant of the BUILT model failed: two fields of one type on one column, or one column exposed under two labels in one projection. Checked after construction, because nothing about the inputs guarantees it. |

A fallback declared for a column no live version exposes is **not** an error — it is inert, and becoming inert is the normal end of a fallback's life.

### The ambiguity check

It fires only when all three hold: a label present in some live version is absent from current; no rename chain maps it forward; and a field of the **same** `field_type` appeared in that type. Drop the third condition and every ordinary field removal becomes an error. An unambiguous removal — nothing similar appeared — is not an error; it becomes a retained column.

### Errors must be actionable

An `AMBIGUOUS_RENAME` message names the file, the type, both candidate labels, and both resolutions concretely: the `renames` entry to add, or the `drops` entry to add. This error is the safety net against silent data loss, so an author hitting it should not need the spec to get past it.

## Testing

Every rule above lives in `computeVersionModel` and is testable on in-memory objects with no filesystem, matching how `packages/core/src/parser/__tests__` already works. `loadVersionModel`'s own tests are small and temp-dir based.

**The fold**
- rename after v1 → current's label folds back to the original column
- renamed twice → column is the **earliest** label, not the intermediate one
- `pending.json` entries participate in current's fold
- **history retains a rename whose version was retired** → the column still resolves correctly

That last case is the regression test for the retirement bug above. It is the one case where a wrong answer is silent and would corrupt real data by generating a rename migration against live columns. Write it first.

**Union**
- an older version's dropped field appears as a retained column
- retained columns are forced nullable even if they were `required`
- a field still in current keeps its `required`
- nothing dropped → union is field-for-field equal to current

**Projections**
- current's projection is identity for every field, when no rename applies
- v1 exposes a renamed field under its **old** label
- a fallback attaches to the right column
- a type absent from a version does not appear in that version's projection

**Errors** — the negative cases for `AMBIGUOUS_RENAME` matter more than the positive one, because a false positive blocks every ordinary field removal:
- fires on drop + same-typed add with no declaration
- does **not** fire when a `renames` entry declares it
- does **not** fire when a `drops` entry confirms it
- does **not** fire when the added field is a **different** type
- does **not** fire on a plain removal with nothing added

Then one case each for `RENAME_CHAIN_BROKEN`, `UNRENAMEABLE_FIELD_KIND` (paragraph and many-to-many), `FIELD_TYPE_CHANGED_WHILE_LIVE`, and `VERSION_SNAPSHOT_INVALID` wrapping its underlying errors — plus one asserting **multiple errors are collected**, not just the first.

**Zero-config**
- no `versions/` directory → one live version `v1`, `union` field-for-field equal to `current`, identity projection

This is the path every existing project takes, so it gets an explicit test rather than being assumed.

## Known limitations

Recorded here because they are **prerequisites for 2b and 2e**, not open bugs. The retention boundary is refused loudly (`VERSION_RETENTION_UNSUPPORTED`) rather than silently mis-modelled.

**Retention covers content and taxonomy types the current schema still defines.** `buildUnionRegistry` iterates current's type maps, so:

- A type a live version exposes but current **deleted** is not carried into the union at all, while that version's projection still exposes it — the two halves of one model disagreeing about the same live version.
- **Paragraph types are passed through untouched.** A paragraph type's own column removed from current is not retained though a live version still serves it, projections do not cover paragraph types, and a declared rename of a paragraph type's own field is a no-op that `UNRENAMEABLE_FIELD_KIND` does not flag (the field it names is a plain column-backed field on a paragraph type, not a paragraph field on a content type).

Whether paragraph tables participate in versioning at all is a question this spec never settled — it restricted *renames* to column-backed fields but said nothing about paragraph types' own columns. **2b** must decide it before generating a union-derived schema for paragraph tables, and **2e** before retirement can prune paragraph columns. Extending retention silently, without deciding what a versioned paragraph table means, would be worse than the refusal.

A related consequence closes with it: a retained **enum** column can only reach the union through the deleted-type path, so no retained enum can arrive with an empty `check_constraint` while that path is refused.

**Snapshots are not cross-reference validated.** A snapshot's `ref` pointing at a type current no longer defines is not checked here — deliberately, since re-validating frozen history against current's `routes.json` would flag untouched history the moment a base path is removed. Recorded as a 2b prerequisite.

## Deliverables

### Code

- `packages/core/src/versions/` — types, `loadVersionModel`, `computeVersionModel`, the fold, union construction, projection construction, validation. Exported from the package root.
- `packages/core/src/parser/loader.ts` — new `ParseErrorCode` members.

Nothing in `db`, `api`, `admin`, or `cli`. No new dependencies — nothing here clears the [ADR core/0006](../../adr/core/0006-core-shared-kernel-dependencies.md) bar.

### Documentation

- `packages/core/CONTEXT.md` — glossary entries for *live version*, *union registry*, *projection*, *cut*, *retained column*, *pending / history*.
- No ADR yet. The cross-cutting decisions (version in path, unversioned aliasing, column-as-identity) are recorded when the surfaces that embody them land in 2c and 2d; an ADR for a module nothing consumes would be premature.
- No changeset. This ships no behavior — `core` gains exports nothing imports yet.

## What the later sub-projects inherit

- **2b — db codegen** consumes `union` as an ordinary `SchemaRegistry`; retention and nullability are already expressed in it.
- **2c — CLI** implements the sealing behavior this module reads: `version:cut` appends `pending.json` to `history.json` tagged with the version being cut, snapshots the schema, and clears pending. `version:diff` prints a projection.
- **2d — versioned REST routes** consume `projections`, generalizing Stage 1.5's per-type `Projectors` into a per-version, per-type structure.
- **2e — GraphQL and retirement** derive retained fields and old labels from `projections`; retirement deletes a snapshot directory and never touches `history.json`.
