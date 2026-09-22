# Versioned GraphQL Surface — Design (Schema Versioning 2e)

**Date:** 2026-09-21
**Status:** Approved, ready for implementation planning
**Scope:** Serve every live version of the read contract over GraphQL, one schema per version, driven by the same projections the REST routes use. One additive core change (`required` on `VersionProjection`). No admin-surface change, no mutations.

## Problem

[The declarative version model](2026-09-02-declarative-version-model-design.md) shipped in core `0.4.0`, [the CLI lifecycle](2026-09-02-cli-version-lifecycle-design.md) in `0.5.0`, and [versioned REST routes](2026-09-03-versioned-rest-routes-design.md) in api `0.5.0`. A consumer pinned to `v1` can point at `/api/v1/blog` and keep its contract across later cuts.

**GraphQL is entirely version-unaware.** `grep -rn "versions\|BakedVersionModel\|projection\|classifyVersion" packages/api/src/graphql/` returns nothing. `buildGraphQLSchema(registry, fieldKeyMaps)` builds one schema from the *current* registry, and `app.ts` hands it the top-level, current-only `fieldKeyMaps`. A project that cuts a version gets a versioned REST surface and a GraphQL surface that silently floats.

This is the last piece of the v2 versioning arc.

## Goals

1. Every live version serves its own GraphQL contract at its own endpoint.
2. A consumer pinned to a live version is unaffected by later cuts.
3. A pinned consumer can **introspect what will break** on upgrade, rather than having to diff two schemas by hand.
4. A consumer pinned to a retired version is told what happened, in a shape its client can display.
5. A project that never cut a version sees no behavioural change, and `/graphql` keeps its exact current contract.

## Non-goals

- **No mutations.** The public surface stays read-only; writes stay on the authenticated admin REST API.
- **No admin-surface versioning.** The admin panel tracks the current schema by design — settled in the parent design.
- **No union schema.** See "Why not one evolving schema" below.
- **No paragraph-type versioning.** The 2d boundary is inherited unchanged.

## Why not one evolving schema

[The 2d design](2026-09-03-versioned-rest-routes-design.md) deferred "`@deprecated` retained fields and rename aliases" to 2e. That wording presumed the canonical GraphQL answer: one endpoint whose schema exposes the union of every live version's labels, superseded names surviving as deprecated aliases onto the same column. Three findings moved the design away from it.

**It cannot offer pinning, which is the feature's entire point.** 2c and 2d deliver a *frozen contract per cut version*: an author cuts `v2` and `v1`'s contract stops moving. A union schema has no version for a consumer to pin to. When `v1` retires and its tombstone is deleted, the deprecated field vanishes and a pinned query starts failing with nothing in the response naming a version — where a per-version endpoint answers `VERSION_RETIRED` and names the successor.

**It needs a new core validation that REST deliberately does not.** Nothing in `validateVersionModel` refuses cross-version label reuse — its three checks are all keyed by column. So this is legal today:

```
v1:  field "title"  → column "title"
v2:  field "heading", column "title"   (rename)
v3:  field "title"  → column "title_v2" (new field reusing the old label)
```

Across live `{v1, v3}` the label `title` denotes two different columns. For REST that is harmless and arguably intended — `/api/v1` and `/api/v3` are separate namespaces. In a union schema it is an unbuildable type. GraphQL's type namespace is already flat and globally collision-checked (`registerTypeName` throws in `schema.ts`), and a union schema would extend that pressure to every field name across every live version.

**Per-version schemas make the collision structurally impossible.** Each version is its own schema, so `BlogPost`, `BlogPostList`, `BlogPostSortField` and `BlogPostFilter` repeat identically across schemas with nothing to collide. No core validation is added.

`@deprecated` still earns its place — see "Deprecation directives". It just annotates each older version's own schema instead of a union.

## Endpoint shape

GraphQL is mounted at the **root**, not under `prefix`: `app.all('/graphql', …)`. It is therefore outside the REST catch-all's `${prefix}/:version/*` territory. Versions extend that root path:

```
POST /graphql        → current, floating   (byte-identical to today)
POST /graphql/v1     → frozen v1 contract
POST /graphql/v3     → frozen v3 contract  (= current)
POST /graphql/v0     → errors[]: VERSION_RETIRED
POST /graphql/v9     → errors[]: VERSION_UNKNOWN
```

Rejected: `/api/v1/graphql`. It would give both protocols one version-segment convention, but it relocates GraphQL from the root into `prefix` — breaking `/graphql` for anyone who enabled the module — and lands inside the REST catch-all's wildcard, making registration order load-bearing between two subsystems that are independent today.

`/graphql` keeps floating to current rather than being deprecated in favour of a pinned endpoint. It is the existing contract, and the `Deprecation` headers below say so without breaking it.

## The one core change

`VersionProjection`'s field record gains `required`:

```ts
fields: Array<{ column_name: string; exposed_as: string; required: boolean; fallback?: unknown }>
```

`buildProjections` sets it from `f.required`. `reduceVersionModel` passes projections through untouched, so it reaches the baked model with no CLI change.

**Why it must be the version's own, not current's.** Nothing validates `required` across versions — `validateVersionModel`'s three checks are all about columns. So a field nullable when `v1` was cut can be `required` in current. Borrowing current's flag would emit `String!` on `v1`'s schema over data that holds nulls, and GraphQL's non-null propagation would null out the **entire parent object** and set `errors[]`. That is a live read breaking, not a cosmetic mismatch.

The alternative — emitting every non-current version's fields as nullable — needs no core change and is safe in the direction that matters, but it loosens `v1`'s contract from what `v1` actually promised: a field introspecting as `String!` becomes `String`. The projection is already the record of *what this version exposes*; nullability is part of a contract, so it belongs there.

Cost: a core minor bump, a re-bake, and mechanical test churn at roughly 26 `exposed_as` sites across seven test files — all deep-equal assertions on projections.

## Deriving a version's types

A projection carries label, column, requiredness and fallback. A GraphQL type also needs `field_type` (to pick the output type) and `ui_component` (for `enum_ref`, a reference's `ref`/`rel`, a paragraph's `ref`). The projection carries neither.

Those come from **current's column-backed field for the same column**:

```
projection field ──by column──▶ current's field
  exposed_as  ────────────────▶ toCamelCase() = GraphQL field name
  required    ────────────────▶ nullability
                                field_type, ui_component ◀── from current
```

This is sound rather than convenient. `VERSION_COLUMN_MISSING` guarantees every column a live version exposes still exists in current, and `FIELD_TYPE_CHANGED_WHILE_LIVE` guarantees its type has not moved under it. A column whose current field is a **tombstone** joins identically — a tombstone is an ordinary parsed field that happens to carry `removed: true`.

So no further core change is needed for typing: `field_type` and `ui_component` stay out of `VersionProjection`.

A new `graphql/version-view.ts` builds this join once per version into a `VersionView` keyed by type name, and `buildGraphQLSchema` takes it alongside the registry.

### Fallbacks

A projection carries a `fallback` for a column that stopped being written: rows created since the
removal hold NULL there, and the version still serving the column must present the declared value.
REST does this in `projectRow` via `TypeProjector.fallbacks`. GraphQL has no route-level projection
— `resolveFieldValue` returns `row[key] ?? null` — so without substitution the same version would
serve `null` over GraphQL and the fallback over REST.

The view therefore carries `fallback` through from the projection, and the scalar resolver
substitutes it on `null`/`undefined` only, matching `projectRow`'s rule exactly. Never on empty
string or `0`.

That empty-string/`0` case earns its keep against a `||`-based one-liner
(`row[key] || fallback`), which *would* wrongly replace a real `''` or `0` — not
against `??`. A `??`-based chain (`row[key] ?? fallback ?? null`) is nullish, not
falsy, so it is semantically identical to the explicit `null`/`undefined` check
above; a mutation pass confirmed this with the suite still green. The explicit
check is written out anyway, because it makes the null/undefined-only rule
visible at the call site rather than resting on a reader recalling `??`'s exact
semantics.

### The boundary

Types absent from a projection fall back to the registry's own fields with no deprecation — exactly as `buildVersionSurface` already does for field-key maps, for the same reason. That covers:

- **Paragraph types**, which core's `buildProjections` never visits.
- **Programmatic, many-to-many and enum-typed fields**, which are not column-backed and so never appear in a projection.

Nested paragraph content and programmatic output therefore follow current's shape on every version, by design and not by oversight. This is the 2d boundary, inherited verbatim.

## Tombstones are exposed today

`grep -rn "removed" packages/api/src/graphql/` returns nothing. The api's tombstone exclusion lives
entirely in `field-keys.ts`'s drop-set, which the REST surface reaches through `remap` — but
`scalarFieldResolver(field)` reads `field.db_column.column_name` directly and never consults the
FieldKeyMap. A tombstoned field is therefore built into the GraphQL schema and serves its retained
data.

This is the same public-exposure class closed for REST in the tombstone-exclusion branch, still
open on this surface. It is reachable by any project that enables the GraphQL module and tombstones
a field — both opt-in, so the blast radius is narrow, but it is a live hole and 2e is the
sub-project that makes tombstones reachable here.

Fixed ahead of the versioning machinery, as its own change: `buildObjectType`, its `mediaFieldNames`
list, and `buildFilterInputType` all skip `removed === true`. That filter then stays permanently as
the no-view fallback path, which is also what paragraph types take.

## Deprecation directives

Computed in the api by comparing a version's projection against **current's**, per column:

| Column in current's projection | Directive |
|---|---|
| present, same `exposed_as` | none |
| present, different `exposed_as` | `@deprecated(reason: "Renamed to 'title' in v3.")` |
| absent (a tombstone in current) | `@deprecated(reason: "Removed in v3; column retained while v1 is live.")` |

Those are the only two reachable cases. An `added` field does not appear in an older version's projection at all, a `restored` field is present in both, and `retyped`/`dropped` are unreachable — already `FIELD_TYPE_CHANGED_WHILE_LIVE` and `VERSION_COLUMN_MISSING`.

**Reasons name current, not the intermediate version where the change happened.** Pinpointing that would mean walking every snapshot in between; "what it is called now" is the actionable fact for someone deciding whether to upgrade.

Current's own schema carries no deprecations — current exposes only current's fields. This is derived in the api by comparing projections; it does not use core's `describeSchemaChange`, which also covers paragraph types the served contract does not honour.

## Query args — and a latent bug

`buildSortFieldEnum(typeName)` in `filters.ts` hardcodes the **label** `title` for every type, with no field information passed in at all. On a type with no `title` label, it offers a sort value that resolves to no column — the same class of bug [2d](2026-09-03-versioned-rest-routes-design.md) closed late for REST, where inbound `?sort_by=` was validated against *current's* names instead of the requested version's: a label that version could not resolve passed validation and reached SQL as a 500.

Both `buildSortFieldEnum` and `buildFilterInputType` take the version view. `title` appears only when that version's `FieldKeyMap.columnFor('title')` resolves, mirroring `sortableColumnsFor` in `versions.ts`. `createdAt`/`updatedAt` are real system columns and always present, so no enum can end up empty — which GraphQL would reject.

Taxonomy queries already accept only `page`/`perPage`, matching the public REST taxonomy routes, which call only `parsePagination`. That asymmetry with content collections is pre-existing and was not recorded in 2d; it is carried in this spec's residuals. Unchanged here.

## Per-version registration

The existing `options.graphql?.enabled` block becomes a loop over `model.live` plus the unversioned pass, mirroring the REST loop in `app.ts`.

Per pass, `buildVersionSurface` supplies `fieldKeyMaps` and `repos` — called with a **GraphQL** repo factory, not REST's. `graphqlRepos` exists separately today so "a future change there can never silently widen the public surface"; reusing REST's factory would collapse that separation. Its `projectors` and `paths` go unused: GraphQL resolves per field by column through `resolveFieldValue` and never calls `projectRow`.

This also fixes an existing gap on the way past. `graphqlRepos` is built with app.ts's current-only `sortableColumnsFor`, so a version whose `title` label maps to a different column would sort by current's column. Per-version surfaces make that impossible.

Yoga's hardcoded `graphqlEndpoint: '/graphql'` becomes the pass's own path.

The unversioned pass uses **current's** view, so `/graphql` exposes current's labels with no
deprecations — the same `projectionVersion: model.current` the REST unversioned pass uses. And
when `options.versions` is undefined the loop degenerates to that single pass: no version
segments are registered, no catch-all is added, and `/graphql` is byte-identical to today. A
project that never cut a version cannot tell this sub-project landed.

### Two refinements to init

- **Per-version fault isolation.** Each version's schema builds in its own try/catch. Today a synchronous throw inside the shared `ready` promise disables `/graphql` entirely; with N versions it would disable all of them. One failing version must return 500 on its endpoint alone.
- **CSP.** `graphiqlPath: '/graphql'` becomes a prefix match for `/graphql/*` (ADR api/0010), or GraphiQL's inline scripts are blocked on every versioned endpoint.

### Deprecation headers

Versioned responses carry the REST `Deprecation`/`Link` headers via the existing `deprecationHeaders`, with `successor: '/graphql/' + model.current`. Free reuse, and it makes the two surfaces diagnosable identically — including the decision not to nag a project with only one live version.

## Failure modes

A `/graphql/:version` catch-all classifies the segment with `classifyVersion` and answers non-live versions as GraphQL errors:

```json
{"errors":[{"message":"Version v0 is no longer served. Live versions: v1, v3.",
            "extensions":{"code":"VERSION_RETIRED","current":"v3","live":["v1","v3"]}}]}
```

`extensions.code` carries the same codes the REST surface uses, so the two stay diagnosable the same way. The retired/unknown split is the same arithmetic on the model REST uses, and `not-a-version` falls through.

**Why not the `{ ok, error }` envelope.** CLAUDE.md's envelope convention holds for HTTP responses, and `/api/v0/blog` already answers that way. But the caller here is a GraphQL client, and Apollo or urql handed an unrecognised envelope reports "unexpected response" — the message a pinned consumer most needs to read is the one their tooling is least able to show them. The protocol has its own error shape; this uses it.

## Testing

**Unit**

- The projection→current join, including a column whose current field is a tombstone.
- Deprecation-reason selection across rename, removal, addition and restoration.
- Nullability taken from the version's own `required`, not current's.
- The sort enum omitting `title` when this version's map cannot resolve it.
- `classifyVersion` reached through the GraphQL catch-all, retired and unknown.

**Integration**, against a live app with fixtures where label ≠ column — a fixture omitting `column` proves nothing, since name and column are identical unless declared:

- Introspect `/graphql/v1`: assert the deprecated fields and their exact reasons.
- Query a renamed field through `/graphql/v1` and `/graphql/v3`: same column's data, each under its own name.
- A column added to current **after** `v1` was cut is absent from `v1`'s schema — the 2d leak in GraphQL's form.
- Retired and unknown response shapes.
- A project with no cut versions: `/graphql` byte-identical to today, and no versioned endpoints registered.
- One version's schema failing to build leaves the others serving.

## Deliverables

| Package | Change |
|---|---|
| core | `required` on `VersionProjection`; `buildProjections` sets it. Minor bump. |
| api | Tombstone exclusion in `schema.ts`/`filters.ts`; `graphql/version-view.ts` (new); `buildGraphQLSchema` takes a `VersionView`; `filters.ts` args become version-aware; `createGraphQLHandler` takes a path and a view; `app.ts` per-version loop, catch-all, headers, CSP prefix, per-version fault isolation. Minor bump. |
| cli | None — `reduceVersionModel` passes projections through. A re-bake carries `required`. |
| docs | This spec; the GraphQL module docs in `docs/v2/` updated for the versioned surface. |

## Residuals

- **The paragraph-type boundary** stays open. `version:diff` still reports paragraph renames the served contract does not honour — now on both surfaces.
- **camelCase label collisions.** `buildFieldNameMap` does not detect two labels collapsing to one GraphQL name. Pre-existing and orthogonal to versioning; not folded in.
- **Public taxonomy collections** ignore filter/sort/include on both surfaces.
- **A union `/graphql` for gradual migration** — deprecated aliases across live versions on the unversioned endpoint — remains possible as a later addition. It would need the cross-version label validation described above. Deferred until someone asks for it.
- **Goal 2 ("a pinned consumer is unaffected by later cuts") is additive-only, not absolute.** A content or taxonomy type added to the current schema *after* an older version was cut is absent from that version's projection, so `buildVersionView` takes its no-projection branch and exposes the new type in full, undeprecated, on the older version's schema. This does not break a pinned consumer — a GraphQL client must ask for a type to see it — but "unaffected" overstates it. It is inherited behaviour, not new to this branch: `versions.ts` does the same for field-key maps, and the REST surface already registers a route per version for every type in the registry, so `/api/v1/<new-type>` behaves identically today. Shared with REST, not GraphQL-specific.
- **The REST surface loses a renamed relation field's value entirely, on an older live version.** `resolveRelationField` (`packages/api/src/relations.ts`) resolves a media field or an `?include=`d reference onto the field's **registry name**, then — whenever that name differs from the field's storage column — deletes the raw FK column (`if (dropFk) delete row[rel.fk_column]`, four sites; `needsFkResolution`'s comment documents the deletion). `projectRow`'s drop-set then still carries the registry name as unexposed for a version that presents that column under a different label, so `remap` drops it. Net effect: the key is **absent from the response body entirely** — not null, absent. Perversely, an `?include=`d reference *disappears when you ask for it* and returns correctly when you don't. Confirmed twice — an implementer's probe during Task 7, and independently against the source while writing this residual. Shipped in api `0.5.0`; GraphQL's equivalent gap was fixed in this branch (Task 5's fallback/view join resolves per field by column, never through `remap`'s drop-set the same way), but REST's was not — a fix means widening `TypeProjector`, which sits on the shared REST/admin projector and deserves its own design pass rather than a bolt-on. This is the most consequential open item on the feature.
- **The drop-set un-drops by string, not by field — related to the item above and sharing a likely fix.** In `packages/api/src/field-keys.ts`, `createFieldKeyMapFromProjection` finishes with `for (const label of projected) dropped.delete(label)` (and the equivalent for columns). That deletes by *string*, regardless of which field owns it. If a live version's projected label equals a **different** current field's own name or column, that field's unexposed column stops being dropped and both fields land on one output key. Verified directly against `field-keys.ts`: with current holding field `a` (column `a`) and field `b` (column `b`), and v1's projection being `[{column_name: 'a', exposed_as: 'b'}]`, the drop-set computation empties out entirely (`dropped.delete('a')` for the exposed column, then `dropped.delete('b')` for the exposed label — both entries removed even though field `b`'s own column was never exposed by v1), so `toLabels({a: 'v1 value', b: 'NEW FIELD value'})` returns `{ b: 'NEW FIELD value' }` — v1 receives field `b`'s raw stored value for a column v1 does not expose, and field `a`'s v1 value is silently lost. Not fixed here: the drop-set is a flat `Set<string>` that cannot attribute a key to a field. A real fix means either making it field-aware or turning `toLabels` into an **allow-list** — which must still admit the system fields (`id`, `slug`, `published`, `created_at`, `updated_at`) deliberately absent from the map. A change to `remap`'s contract on the shared REST + GraphQL projector, same fix surface as the item above.
- **This branch's own collision-check fix changed a crash into silent corruption, for one narrow overlap.** Task 7b fixed a real false positive in `buildFieldKeyMap`'s collision check (`if (ownColumn === label) continue`), which previously made `createCmsApp` throw at startup for a legitimate configuration — a field renamed away and then renamed back onto its own column's name while the intermediate version is still live. That fix is correct on its own terms; the false positive crashed valid schemas. But because the exemption is keyed on "this field's own name equals its own column" — true for nearly every un-renamed field, not just the rename-back case — it also silently disables the collision check for the exact overlap the residual above describes: a version's projection reusing another field's name/column as a label. Before this branch, that configuration died loudly at startup; after it, it boots into the item above's silent data loss. This is discoverable only by whoever picks up the two residuals above, and argues for treating them as a priority rather than a backlog entry.
