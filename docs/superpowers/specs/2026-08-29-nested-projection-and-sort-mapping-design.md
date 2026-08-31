# Nested Projection and Sort Mapping — Design (Schema Versioning Stage 1.5)

**Date:** 2026-08-29
**Status:** Approved, ready for implementation planning
**Scope:** Close the two correctness gaps Stage 1 left open — nested rows are serialized storage-keyed, and `sort_by` is emitted as a label where a column is required. api package only.

## Problem

[Stage 1](2026-08-27-schema-versioning-design.md) decoupled a field's public **label** (`ParsedField.name`) from its Postgres **storage key** (`db_column.column_name`) throughout the api package, behind two boundaries: `toStorage` inbound on admin writes, `toLabels` outbound on read responses. It shipped in `@bobbykim/manguito-cms-api` 0.4.0.

That audit stopped at the **top level**, and two gaps survive it. Both are inert today — `fieldTypeRegistry` sets `column_name = raw.name` for every field type, so no parser-producible schema diverges — and both become real the moment schema versioning lands.

**Nested rows are never projected.** `toLabels` is applied only to the top-level row. Every nested object is attached straight from `SELECT *`: paragraph children, resolved reference targets, and junction targets. So `?include=category` serves the target type's column names, and paragraph children serve the paragraph type's column names.

The consequence on the admin side is worse than a cosmetic leak. `packages/admin/src/components/fields/field-registry.ts:96` reads paragraph sub-values by label (`(props.modelValue ?? {})[field.name]`), while `packages/api/src/relations.ts` writes them back by column (`data[pf.db_column.column_name] = pItem[pf.name] ?? null`). The write half is already correct — label in, column out. It is the **read** half that hands the form storage-keyed values, so a renamed paragraph sub-field would display blank and be saved as `null`: silent data loss.

**`sort_by` is not mapped.** `SORTABLE_FIELDS` includes `title`, which is a *label*, and `packages/api/src/repositories/content.ts` builds `ORDER BY ${quoteIdent(sort_by)}`. Under divergence `?sort_by=title` becomes `ORDER BY "title"` against column `blog_title` — a Postgres error surfacing as a 500. Reached from public REST, admin REST (via `parseListQuery`), and GraphQL's `sortBy` enum.

## Goals

1. Every read response — public and admin, at every nesting depth — speaks labels, never storage columns.
2. Sorting by a label orders by the underlying column, with both existing safety guards intact.
3. No observable behavior change for any schema the parser can currently produce.
4. Stage 2 inherits no known label/column gap in the api package.

## Non-goals

- **No versioning feature.** Like Stage 1, this is foundations. Snapshots, projections per version, and versioned routes remain Stage 2.
- **No change to GraphQL.** It resolves each field individually by column via `resolveFieldValue` and `buildObjectType`, so it is already correct at every depth and must not be double-projected.
- **No change outside `packages/api`.** Core's `sort_by` type, db, admin and cli are untouched.
- **No schema-driven sorting.** The sortable set stays the fixed `title | created_at | updated_at`.
- **No branded key-space types.** See Rejected alternatives.

## Approach (chosen)

**Deepen the existing outbound boundary rather than projecting at attach time.** Generalize `toLabels` from a shallow map into a recursive `projectRow`, applied at exactly the points that call `toLabels` today.

The decisive property is that **both broken paths already call `toLabels` at the right moment**: public reads resolve relations in the repository and then map at the route; admin populates paragraph children in the handler and then maps. Deepening the one function therefore fixes both without touching either resolver, preserves Stage 1's "map exactly once, at the boundary" invariant, and leaves GraphQL alone.

Rejected alternatives:

- **Project at attach time** (`RelationDef` gains a `target_type`; each resolver projects as it attaches) — rejected: it interleaves projection with resolution and leaves two independent call sites (`relations.ts` and admin's `loadParagraphRows`) that must each remember to do it. That is the same shape as the bug being fixed.
- **Project inside the repository's `resolveRows()`** — rejected: it makes repositories return label-keyed rows, inverting the invariant Stage 1 established. Admin writes need storage-keyed reads to diff against, so it would break the write path to fix the read path.
- **Branded `LabelKeyed` / `StorageKeyed` record types**, so the compiler enumerates every remaining mixed-key-space site — rejected on spike evidence, not on taste. Applying required brands to `FieldKeyMap`'s signatures produced **29 errors across 5 files, every one of them "unbranded record given where a brand is required"** — i.e. an assertion to add — and **zero key-space mixing errors**. Critically, **zero errors in `relations.ts`** (nested projection is a *missing call*, which no type system can see) and **zero in `query-params.ts`** (`sort_by` is a `string`, not a record). Both target bugs were invisible to it. Of the eight findings from Stage 1's final review it would have caught about one; the publish-validation bug would also have escaped, since `{ ...existing, ...body }` yields an intersection carrying both brands. Twenty-nine assertions plus ongoing friction for that return is a bad trade. **Branded *strings* (`Label` vs `ColumnName`) remain a plausible future measure** — "a label used where a column is needed" is the recurring bug class — but they reach into core's query type and are out of scope here.

## The projector

### Precomputed at startup

Built once per type at boot, alongside the existing field key maps — not walked per request:

```ts
type TypeProjector = {
  /** This type's own label↔column map. */
  map: FieldKeyMap
  /** Relation fields worth recursing into: the field's LABEL and its target type. */
  nested: Array<{ label: string; target: string }>
}
type Projectors = Record<string, TypeProjector>
```

`nested` **excludes media fields**: a media relation resolves to a row from the `media` system table, which has fixed columns and no schema fields, so there is nothing to project.

`fieldKeyMaps` currently covers content and taxonomy types only. It extends to **paragraph types**, which are the main nested case.

`buildProjectors(registry, fieldKeyMaps): Projectors` assembles them at startup. For each type it derives `nested` from the type's own fields:

- a **paragraph** field targets `ui_component.ref` — the paragraph type's machine name
- a **reference** field (one-to-one, one-to-many, or many-to-many) targets `ui_component.ref` — the target content or taxonomy type's machine name
- **media** fields are skipped, per above

`target` is therefore always a key into the same `Projectors` map — machine names throughout (`content--x`, `taxonomy--x`, `paragraph--x`), matching how `fieldKeyMaps` is already keyed. A target with no projector (an unresolvable ref) makes `projectRow` pass that nested value through unchanged rather than throwing, since an unresolvable ref is already reported at parse time.

### The walk

```ts
function projectRow(
  row: Record<string, unknown>,
  typeName: string,
  projectors: Projectors
): Record<string, unknown> {
  const p = projectors[typeName]
  if (!p) return row                       // unknown type — pass through unchanged
  const out = p.map.toLabels(row)          // top level first, so relation keys are labels
  for (const { label, target } of p.nested) {
    const v = out[label]
    if (v == null) continue
    out[label] = Array.isArray(v)
      ? v.map((item) => (isPlainRow(item) ? projectRow(item, target, projectors) : item))
      : isPlainRow(v)
        ? projectRow(v, target, projectors)
        : v
  }
  return out
}
```

Three properties carry the correctness:

**Top level maps first.** `nested` is keyed by label, so the outer `toLabels` must run before the loop reads `out[label]`.

`isPlainRow` is the guard that decides whether a value is a resolved row worth recursing into:

```ts
function isPlainRow(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date)
}
```

The `Date` exclusion matters: `created_at` / `updated_at` come back from the driver as `Date` instances, which are objects and would otherwise be walked as if they were rows.

**Bare ids are left alone.** A relation that was not `?include=`d holds a bare uuid string, or an array of them. The `isPlainRow` guard stops the walk from projecting a string, which is why a reference field's bare id survives as an id under its label.

**Nothing is mutated in place.** `relations.ts` caches resolved target rows by `table:id`, so **two parent rows can hold the very same nested object**. `toLabels` returns a fresh object and the walk assigns that fresh object rather than editing the source, so each parent gets its own projected copy and a shared source is never projected twice. This is the shared-object hazard Stage 1's final review found in `dropFk`, avoided here by construction rather than by a visited-set.

### Depth is bounded by what was resolved

Recursion follows objects, and objects exist only where resolution put them. `?include=` accepts no nested paths and [ADR core/0005](../../adr/core/0005-paragraph-nesting-one-level.md) caps paragraph nesting at one level, so real depth is at most two. A reference cycle cannot run away: a resolved target's own reference fields hold bare id *strings*, and the walk stops at strings. No depth counter is required.

### New startup failure mode

Giving paragraph types a field key map means the **startup collision guard now runs against paragraph types too** — a paragraph type whose field label collides with another of its own columns refuses to boot. That is correct and consistent with content types. It is unreachable in practice today, since a collision would require two same-named fields, which the parser already rejects, but it is a new reason a server could fail to start and belongs in the changeset.

## Wiring and call sites

Registrators take `projectors` instead of `fieldKeyMaps`; handlers needing a plain map reach it as `projectors[typeName].map`, keeping one object threaded rather than two.

Of the thirteen `toLabels` calls in the REST routes, eleven change and two deliberately do not:

| Sites | Change |
|---|---|
| 5 in `routes/content.ts` | → `projectRow` (list, single, singleton, taxonomy list, taxonomy item) |
| 6 response sites in `routes/admin/content.ts` | → `projectRow` |
| 2 publish-validation sites in `routes/admin/content.ts` | **stay shallow `toLabels`** |
| 3 in `graphql/resolvers.ts` | **unchanged** |

The two that stay shallow are `{ ...toLabels(existing), ...body }` feeding `checkRequiredFields`, which inspects only top-level required fields; projecting nested rows there would do work nobody reads.

This also absorbs Stage 1's deferred minor about `toLabels` being duplicated across handlers — the duplication collapses into one shared call.

## Sort mapping

Mapping at the route alone would break the repository's own guard: it would receive `blog_title`, and `SORTABLE_FIELDS.has('blog_title')` is false, so a valid sort would start 500-ing — trading one bug for another.

So the repository becomes column-aware at construction. It already takes an options object and gains `sortableColumns: Set<string>`, computed once per type in `app.ts` as `{ columnFor('title') ?? 'title', 'created_at', 'updated_at' }`.

- The **route** validates the incoming `sort_by` against `SORTABLE_FIELDS` (labels — the unchanged public contract) and maps it to a column.
- The **repository** validates that column against `sortableColumns` and quotes it.

Both guards survive: the allowlist plus `quoteIdent` is what keeps `ORDER BY` free of injection, and neither is weakened. `created_at` and `updated_at` are system fields absent from the key map and pass through untouched. `codegen/routes.ts` keeps emitting the zod enum of the three labels — that is the public contract and does not move.

### The sortable set is arbitrary, and its stated rationale is false

`packages/api/src/routes/query-params.ts` documents the restriction as *"Only indexed system fields are sortable."* Both halves are untrue:

- **Nothing is indexed.** `packages/db/src/codegen/` generates no indexes at all — not on `created_at`, not on `updated_at`, not anywhere. Every sort today is already an unindexed scan-and-sort.
- **`title` is not a system field.** `CONTENT_SYSTEM_FIELDS` is `id`, `slug`, `base_path_id`, `published`, `created_at`, `updated_at`. `title` is an ordinary schema field the schema never promises exists.

This stage **corrects the comment** to say what is actually true, and changes nothing else about the sortable set.

The consequence of `title` being unpromised: if a content type has no field labeled `title`, `columnFor('title')` returns `undefined` and `?sort_by=title` falls through to `ORDER BY "title"` — a Postgres error surfacing as a 500. That is today's behavior, unrelated to divergence, and it is left alone here. Returning 400 would change behavior for a previously-500ing request and needs its own changeset; silently ignoring the sort would hide a caller's mistake.

### Schema-driven sorting is the agreed destination, on its own timeline

Letting any column-backed field be sortable is the right end state, and the discovery above strengthens the case: the performance objection to widening the set is much weaker than it appears, because the project already accepts unindexed sorts on the three fields it allows. The current restriction is arbitrary.

It is deliberately **not** in this stage. It widens `sort_by` in core, needs per-type enums in `codegen/routes.ts`, and requires a real decision on whether sortability is opt-in (a `sortable: true` schema flag, which also gives an author somewhere to hang an index) or implicit for every column-backed field. That is a user-visible feature deserving its own design pass, not a rider on a correctness stage that otherwise touches nothing outside `packages/api`.

**The `sortableColumns` mechanism below is therefore knowingly interim** — roughly ten lines that a schema-driven sorting design would largely replace. It is paid deliberately, to close the divergence bug now and keep this stage api-only. Because it closes that bug, schema-driven sorting is **not a Stage 2 blocker** and can be scheduled on its own merits.

## Testing

**Unit — the projector**, all with divergent fixtures:

- paragraph children map to the paragraph type's labels
- a resolved reference target maps to the target type's labels
- a junction target array maps element-wise
- a bare id **string** is left alone (the not-`?include=`d case)
- a bare id **array** is left alone
- a resolved media object is untouched
- **one nested object shared by two parents is projected independently for each, and the shared source is not mutated**
- an unknown type name passes the row through unchanged
- `null` and absent nested values are skipped

The shared-object and no-mutation cases should be written first: they are the property the design leans on, and they are the failure mode Stage 1's final review found in `dropFk`.

**Integration, real Postgres**, extending the existing divergence suite:

- public `?include=` returns the target type's labels, never its columns
- public paragraph children return paragraph labels
- **admin single-item read returns paragraph children under labels** — the data-loss regression test
- sorting by a label orders by the underlying column

**Regression:** the full suite stays green with no existing assertion altered. Nothing changes observably for any parser-producible schema, so this should hold trivially; if it does not, that is a real finding.

## Deliverables

### Code

- `packages/api/src/projector.ts` — new: `TypeProjector`, `Projectors`, `buildProjectors`, `projectRow`
- `packages/api/src/app.ts` — paragraph types added to `fieldKeyMaps`; `projectors` built and threaded; `sortableColumns` per repository
- `packages/api/src/routes/content.ts`, `packages/api/src/routes/admin/content.ts` — 11 sites to `projectRow`, 2 left shallow; `sort_by` mapped
- `packages/api/src/repositories/content.ts` — `sortableColumns` option, validated in place of the label allowlist
- `packages/api/src/routes/query-params.ts` — `sort_by` mapped; correct the false "Only indexed system fields are sortable" comment

Nothing in `core`, `db`, `admin`, or `cli`.

### Documentation

- **ADR api/0011 amended** — strike "The audit stopped at the top level"; record that projection now recurses and how depth is bounded; record the paragraph-type collision guard as a new startup failure mode; record the missing-`title` sort behavior as known and deliberate.
- **Stage 1's plan** — strike the two prerequisites this closes, and record the branded-types spike result against the third so it is not re-litigated from the note alone.
- **`packages/api/CONTEXT.md`** — a `**Projection**:` glossary entry, since the term now means more than `toLabels`.
- **Changeset** — `patch`. No observable behavior change today; it should state the new paragraph-type collision guard as a reason a server could refuse to boot.

## What Stage 2 inherits after this

One recorded prerequisite remains: **a branded label/storage type system**, narrowed by the spike above to branded *strings* rather than branded records, and reaching into core's query type. It is prevention rather than a live defect — after this stage there is no known label/column gap in the api package.

**Schema-driven sorting is a separate, non-blocking item.** It is agreed as the destination and has its own design cycle ahead of it, but because this stage closes the sort divergence bug, Stage 2 does not wait on it.
