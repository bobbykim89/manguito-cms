# Versioned Public REST Routes — Design (Schema Versioning 2d)

**Date:** 2026-09-03
**Status:** Approved, ready for implementation planning
**Scope:** Serve every live version of the public read contract at its own route prefix, driven by the version model's projections. Content and taxonomy only. No GraphQL, no admin-surface change, no core change.

## Problem

[The declarative version model](2026-09-02-declarative-version-model-design.md) shipped in core `0.4.0` and [the CLI lifecycle](2026-09-02-cli-version-lifecycle-design.md) in `0.5.0`. An author can now cut a version, see what cutting would freeze, and retire a version they no longer serve.

But **nothing serves those versions.** `grep -rn "loadVersionModel\|VersionProjection\|projections" packages/api/src` returns nothing: the api still builds one `FieldKeyMap` per type from the *current* registry and registers one unversioned route per resource. A consumer pinned to `v1` has nowhere to point.

This sub-project connects them. Once it lands, cutting a version has a visible effect on the public API, which is the point of the whole feature.

## Goals

1. Every live version serves its own contract at its own prefix.
2. A consumer pinned to a live version is unaffected by later cuts.
3. A consumer pinned to a **retired** version is told what happened, not handed a bare 404.
4. A project that never cut a version sees no behavioural change and no new warnings.

## Non-goals

- **No GraphQL.** `@deprecated` retained fields and rename aliases are 2e.
- **No admin-surface versioning.** The admin panel tracks the current schema by design — deprecate, don't version. Settled in the parent design.
- **No core change.** The model already exposes everything needed.
- **No media or OpenAPI versioning.** See *Scope of the version segment*.
- **No projection of paragraph types.** See *The boundary*.

## Where the model comes from

**The api has no filesystem access to the schema at runtime.** `manguito build` calls `generateSchemaRegistry(registry, generatedDir)` (`packages/cli/src/codegen/registry.ts`, from `build.ts`), which bakes `.manguito/schema-registry.ts`; the generated server entry imports it and passes `registry: schemaRegistry` into `createCmsApp`. In a Lambda deployment the `schemas/` tree is not present at all.

So the version model cannot be loaded per request. `manguito build` computes it — it already holds `config` and the registry, and 2c's `resolveSchemaConfig` gives `loadVersionSnapshots` the absolute root — and bakes it beside the registry. `createCmsApp` gains an optional `versions?` option.

`VersionModel` is serializable plain objects by construction, a constraint enforced through every core task precisely so it could be stored and passed. That decision pays off directly here.

### Bake a reduced model

`VersionModel.union` **is** the current registry (`union === current`, by reference). Baking it beside `schema-registry.ts` would duplicate the whole registry in the generated bundle, and the reference identity that made it free in memory does not survive serialization.

So the baked artifact is `Omit<VersionModel, 'union'>` — `{ current, live, projections }` — and `createCmsApp` uses the `registry` it already receives as the union. Exactly equivalent. What remains is small: a projection is column/name pairs plus the occasional fallback.

### Optional, so nothing existing breaks

`versions?` is optional. Every manual constructor — tests, the sandbox smoke harness — keeps working, and when it is absent the app behaves exactly as today: unversioned routes only.

### Do not nag a project that never opted in

With no snapshots, `live` is `['v1']` and the unversioned path floats to `v1`. The deprecation warning would be *technically* true, since cutting `v2` later does move `/api/blog` — but it is not yet actionable risk, and emitting it would nag every existing project the moment it rebuilt.

**The unversioned path's headers appear only once at least one version has been cut** (`live.length > 1`). Before that there is nothing to float between.

## Scope of the version segment

Content and taxonomy collections and items are schema-driven and carry the segment. Media and OpenAPI do not:

| Surface | Versioned |
|---|---|
| `{prefix}/{base_path}` and `/{slug}` | yes |
| `{prefix}/taxonomy/{type}` and `/{id}` | yes |
| `{prefix}/media`, `/media/{id}` | **no** — `MediaItem` is a fixed shape the schema never touches, so a segment would duplicate byte-identical routes per version |
| `{prefix}/openapi.json` | **no** — one document describes every live version |

## Per-version registration

### The paths module splits, so the type enforces the scope decision

`createPublicPaths`'s own comment already anticipates this work: *"the prefix is configurable (`api.prefix`) and Stage 2 inserts a version segment here."*

Rather than add an optional version parameter — which would let a caller accidentally version media — the module splits:

- `createPublicPaths(prefix)` keeps only the fixed surface: `mediaCollection`, `mediaItem`, `openapi`.
- `createVersionedPaths(prefix, version: string | null)` returns only the four schema-driven builders. `null` means no segment, which is what the unversioned pass uses.

Versioning media becomes unexpressible rather than merely discouraged.

### A version-scoped bundle per live version

Iterating `model.live`, each version gets:

- **field-key maps** built from `model.projections[version]` rather than from current's fields;
- **projectors** from those maps;
- **repositories** — which was not obvious.

`sortableColumnsFor` maps `SORTABLE_FIELDS`' labels through the field-key map to storage columns and bakes the result into each repository as a `sortableColumns` guard. Once the map is per-version, so is that set: a rename moves `title`'s column, so two live versions legitimately sort by different columns. A repository is a closure over a db handle, a table name and that option, so types × versions is a handful of cheap objects.

The alternative was a version-independent union of every live version's sortable columns. It would work — the route maps `sort_by` through the field-key map before the repository sees it — but it loosens a defence-in-depth guard for no saving.

Then one unversioned pass with `createVersionedPaths(prefix, null)`, reusing the bundle of the latest version — which is always `model.current`; this design uses "latest" and "current" for the same thing.

### The catch-all

Registered last at `{prefix}/:version/*`, guarded on `/^v\d+$/`: a segment that is not version-shaped calls `next()` and falls through. That is what protects `/api/media/{id}`, and it makes the protection **order-independent** rather than dependent on registration sequence.

A bare `{prefix}/v1` naming no resource is **not** covered: the pattern requires a path after the version, so it falls through to the framework's own 404. That is right — it names no resource in any version, so neither `VERSION_RETIRED` nor `VERSION_NOT_FOUND` is the honest answer.

## What a projection changes about a response

A `VersionProjection`'s type entry is already the label↔column mapping — `{ column_name, exposed_as, fallback? }` per field — so building a `FieldKeyMap` from it needs no `isColumnBacked` filter and no tombstone exclusion, because projections already exclude both.

### It cannot be built from the projection alone

`createFieldKeyMap`'s collision check deliberately runs against **every** field's label, not just the column-backed subset. Its comment says why: a paragraph, many-to-many or programmatic field's label is written into the same key space as storage columns before `toLabels` runs, so a paragraph field named after another field's column would overwrite that column's value on the row and then be renamed onto the other field's label — serving the wrong value under the wrong key.

A projection contains only column-backed, non-tombstoned fields, so that collision would go undetected. The projection-based constructor therefore takes **both**: the projection for the mapping, and the type's `ParsedField`s for the full label space the check needs.

### Fallbacks are served in the projector

When a retained column is null, substitute the projection's `fallback`. **Only on null** — `0`, `''` and `false` are legitimate stored values.

Correct by construction: current's projection excludes tombstones, so no fallback ever appears there, while an older version's projection carries it on the column that version still exposes.

### The boundary

`buildProjections` iterates `current.content_types` and `current.taxonomy_types` only — verified at `packages/core/src/versions/projections.ts:20-21` and `:62-63`. **Paragraph types have no projection**, and neither programmatic fields nor many-to-many references appear in one, having no column.

So nested paragraph content, computed fields and junction-backed relations follow **current's** shape on every version.

The narrow real consequence: a paragraph type's own field is column-backed *within that type*, so renaming it is invisible to versioning and a `v1` consumer would see the new name. Note the asymmetry with `describeSchemaChange`, which *does* cover paragraph types (`describe.ts:56-58`) — so `version:diff` reports a change that the served contract then does not honour.

Closing this means projecting paragraph types, which the parent design deliberately left undesigned. It is recorded here as a known limitation rather than fixed, and it belongs with 2e, which faces the same question for GraphQL.

## Failure modes

### Non-live versions

`classifyVersion(segment, model)` is a **pure function**, extracted so it is testable without Hono. Four outcomes:

| Outcome | Condition | Response |
|---|---|---|
| `not-a-version` | segment fails `/^v\d+$/` | `next()` — this is what protects `/api/media/{id}` |
| `live` | in `model.live` | unreachable; the versioned routes already matched |
| `retired` | number below `current`'s and not live | **410** `VERSION_RETIRED`, naming the live versions |
| `unknown` | number above `current`'s | **404** `VERSION_NOT_FOUND`, naming the live versions |

The retired/unknown split is arithmetic on the model alone, with nothing persisted: `current` is *highest snapshot + 1*, so a number below it that is not live must have been cut and retired, while a number above it was never cut. A 404 for a retired version would read as "wrong URL" and send a pinned consumer hunting for a typo instead of upgrading.

Both use the project's standard `{ ok, error: { code, message } }` envelope. `VERSION_RETIRED` and `VERSION_NOT_FOUND` are HTTP error codes — a different namespace from `ParseErrorCode`, so core needs no change.

### Deprecation headers

Applied in middleware, so the route registrators stay untouched.

| Request | Headers |
|---|---|
| Unversioned path, `live.length > 1` | `Deprecation: true`, `Link: <{prefix}/{current}/…>; rel="successor-version"`, and a `Warning: 299` explaining that the path floats and will change when a version is cut |
| Older live version | `Deprecation: true`, `Link: <…>; rel="successor-version"` |
| Current version | none |
| Unversioned path, `live.length === 1` | none — see *Do not nag* |

Two different messages for two different mistakes: the unversioned path floats, an old version is behind.

The unversioned middleware registers **explicitly on each unversioned collection and item path** rather than wildcarding `{prefix}/*`. A wildcard would also catch `/api/media`, where "pin a version" is meaningless, and would need a guard kept in sync with the catch-all's. The paths are generated here, so they are known exactly.

## Testing

**Pure, tested directly:**
- `createVersionedPaths` with a segment and with `null`.
- `classifyVersion` across all four outcomes, including the boundary at `current`.
- `createFieldKeyMapFromProjection` — builds the mapping, **and** still throws on the paragraph-label-collides-with-a-column case the projection alone cannot see.
- Fallback substitution: applied on null; **not** applied for `0`, `''` or `false`.

**Integration, against the real database** (`packages/api` already has these):
- The **same row** served under `/api/v1/…` and `/api/v2/…` returns **different field names**. This is the feature; a test that cannot show it proves nothing.
- A retired version returns 410; a never-cut version returns 404.
- `/api/media/{id}` is not swallowed by the catch-all.
- The unversioned path returns the latest version's shape, **with** headers when more than one version is live and **without** them when only one is.

Fixtures must build every registry through the real `parseSchema`, and any test whose claim depends on column-keying must declare a `column` so the field's name and column diverge — otherwise it passes under a name-keyed implementation and proves nothing.

The last two integration cases are also where the **routing-order assumption** behind the catch-all gets settled by a test rather than by assertion.

## Deliverables

**CLI**
- `packages/cli/src/codegen/version-model.ts` — writes `.manguito/version-model.ts`.
- `packages/cli/src/commands/build.ts` — compute the model and call the new codegen.
- `packages/cli/src/codegen/server-entries.ts` — import it and pass `versions`.

**API**
- `packages/api/src/paths.ts` — split into `createPublicPaths` and `createVersionedPaths`.
- `packages/api/src/field-keys.ts` — add the projection-based constructor.
- `packages/api/src/projector.ts` — fallback substitution.
- `packages/api/src/versions.ts` — new: `classifyVersion` and the version-scoped bundle builder.
- `packages/api/src/app.ts` — the registration loop, the catch-all, the header middleware.

**Documentation**
- `packages/api/CONTEXT.md` — the version segment, the retired/unknown split, and the paragraph boundary.
- A changeset: api **minor**, cli **minor**.

## What 2e inherits

- The same projections, for `@deprecated` retained fields and rename aliases.
- The same paragraph-type boundary, and the same question about whether to close it.
- `classifyVersion`, if GraphQL ever accepts a version argument.

## Residuals

- **Paragraph types, programmatic fields and many-to-many references are not versioned.** Recorded above; the asymmetry with `version:diff` is the sharpest edge.
- **One OpenAPI document describes every live version.** A consumer generating a client against one pinned version gets more than that version exposes. Revisit if anyone asks.
- **`version:diff` reports paragraph changes the served contract does not honour** — a doc-level caveat until the boundary closes.
