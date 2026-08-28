# Schema Versioning with Multi-Version API Routes — Design

**Date:** 2026-08-27
**Status:** Approved, ready for implementation planning
**Scope:** Add versioned public REST routes (`/api/v1/*`) driven by frozen schema snapshots, so consumers pinned to an older contract keep working after a breaking schema change. Public read surface only; the admin surface and admin panel are unchanged.

## Problem

Every artifact in Manguito CMS is generated from one `SchemaRegistry` parsed from the files in `schemas/`: the Drizzle tables, the Hono routes, and the admin forms. A single registry means a single contract. When a schema author renames `blog_title` to `title` or deletes `blog_desc`, the public API changes shape immediately and every consumer built against it breaks.

README lists this as a v2+ item: *"Schema versioning with multi-version API routes."*

## Goals

1. A consumer can pin to `/api/v1/*` and keep receiving the v1 response shape across breaking schema changes.
2. A schema author can stage a new shape, run both versions side by side, and retire the old one deliberately.
3. Retention is automatic: a column a live version still exposes is never dropped by an ordinary schema edit.
4. Forgetting to declare a rename is impossible — it fails the build rather than silently losing data.
5. Zero-config upgrade: an existing deployment gains a working `/api/v1/*` without touching config or schemas.

## Non-goals

- **No content versioning / revision history.** This is schema-contract versioning. Draft/publish workflow remains a separate v2+ item.
- **No versioned admin surface.** `/admin/api/*` always follows the current schema; it serves the admin panel, deployed in lockstep.
- **No versioned writes.** The public surface is GET-only today, so no request-body transforms are needed.
- **No versioned GraphQL endpoints.** One `/graphql`, evolving additively via `@deprecated`.
- **No support-window policy.** No max live version count, no retirement deadlines, no `Sunset` header.

## Approach (chosen)

**Version the contract, not the data.** One canonical row per content item. Each live version is a declarative *projection* applied at the API edge. This is the pattern Stripe documents (a single current data model plus per-version transformers), and GitHub and Shopify use variants of it.

Core computes two plain serializable outputs from the parsed snapshots — a **union registry** and a **`VersionProjection`** per live version. The db package codegens tables from the union; the api package applies projections at runtime; the CLI can print any projection for inspection.

Rejected alternatives (from brainstorming):

- **Per-version physical tables** (`blog_post_v1`, `blog_post_v2`) — rejected: the content item stops being one item. An editor's fix in v2 is invisible to v1 consumers unless a bidirectional sync is built, which is harder than the transform layer it avoids. Storage multiplies per live version.
- **Latest schema owns the tables; deleted columns drop immediately** — rejected: a breaking schema edit would destroy production data as a side effect of saving a file, and rolling a version back would be unrecoverable. Data loss belongs in retirement, which is deliberate and confirmed.
- **Additive-only versioning** (renames and deletes forbidden) — rejected as circular: it forbids exactly the changes versioning exists to absorb.
- **Build-time codegen of projection modules** — rejected: adds a generated-file lifecycle to keep in sync and makes the projection logic testable only through generated text. The runtime cost avoided is a map lookup on an already-serialized row.
- **Pure runtime projection with no inspectable plan** — rejected: an author could not see what `/api/v1` serves without calling it, which is a poor property for a feature whose product is a stable contract.
- **Header-based version selection** — rejected: invisible to CDNs without `Vary` configuration. Path segments are cacheable, greppable, and visible in logs. README also specifies routes.
- **Per-content-type versions** — rejected: consumers would pin N independent versions and the support matrix becomes multi-dimensional.

## Data model

### Schema layout

```
schemas/
  content-types/          # the working schema: always the NEWEST version
  paragraph-types/
  taxonomy-types/
  enum-types/
  roles.json
  routes.json
  versions/
    changes.json          # the only hand-written file
    v1/
      content-types/      # frozen snapshot of v1
      paragraph-types/
      ...
```

`versions/` holds only older versions. The working `schemas/` directory is always the newest version; snapshots are never edited.

**Terminology:** a **live version** is any version currently served — every cut snapshot in `versions/` **plus the current working schema**. The current version is live and is served both at its own path and at the unversioned path. "Retired" means the snapshot directory is gone and the version is no longer served.

### Version identity is derived

Current version = `v{N+1}` where N is the highest cut snapshot, or `v1` when `versions/` is absent. No config key.

This gives the zero-config upgrade path: an existing deployment adds nothing, and `/api/v1/blog` immediately serves what `/api/blog` already served.

`manguito version:cut` freezes the current shape into `versions/vN/` and implicitly bumps the working schema to `vN+1`. The workflow is **cut first, then break things**: you freeze the contract you are leaving behind before changing it.

Versions are `vN` integers — not dates (GitHub's scheme serves a continuous-deployment cadence this project does not have) and not semver (implies a patch/minor axis with no meaning for a schema contract).

### The one hand-written file

`schemas/versions/changes.json` is an append-only log:

```json
{
  "renames": [
    { "after": "v1", "type": "content--blog_post", "from": "blog_title", "to": "title" }
  ],
  "fallbacks": {
    "content--blog_post.blog_desc": ""
  }
}
```

Entries are chained: each records which cut version it followed, so projecting current to v1 is a backwards fold over entries after v1. Nothing already written is ever edited when a later rename happens — the drift problem a per-version mapping file would have.

**`renames` are label-to-label, and the column is resolved by folding the chain.** `from` and `to` are the field's labels in adjacent versions, not column names. A column's name is the field's label *at the time the column was created*, so:

- To find the column backing a current-version field, fold its rename chain backwards to the earliest label.
- To find a field's label in version vN, fold forwards from the column name, applying only entries with `after` at or later than vN.

Both directions derive from the one chain, so a field renamed twice (`blog_title` → `title` → `headline`) still resolves to the single `blog_title` column, and v1 still sees `blog_title`.

**`fallbacks` are keyed by `<type>.<column_name>`, not by label.** Keying by label would be ambiguous for a field that was renamed and then dropped — the entry would have to say which version's label it meant. Column names are stable, so the key is unambiguous for the life of the data.

`fallbacks` addresses the staleness limitation (see Known limitations): a field v1 exposes but the current schema dropped returns its retained value on existing rows, and this fallback on rows created after the drop.

### Column name is the field's identity across versions

`ParsedField.db_column.column_name` already exists as a concept distinct from the field name, though `fieldTypeRegistry` currently always sets it to `raw.name`.

This design makes column names **immutable**. A field's `column_name` is its stable identity across all versions; per-version field names are labels on it. Renaming a field changes only the label.

Consequences:

- Renames require no `RENAME COLUMN` and no data movement.
- `drizzle-kit generate` cannot infer a rename from a schema diff — it prompts interactively to disambiguate rename from drop-plus-add. Immutable column names sidestep that prompt permanently, which also fixes a latent hazard for unversioned projects: renaming a field today either requires an interactive build step or silently becomes drop-plus-add.
- **The current version is just another projection.** Repositories return rows keyed by column name; every route maps column names to that version's labels through one code path. There is no unprojected path that could drift from the projected one.

**Only column-backed fields can be renamed.** Two field kinds have no column to serve as identity, and their identity is persisted as data:

- **Paragraph fields** (`db_column === null`) — the association lives on the paragraph child table, identified by its `parent_field` value, which stores the field name.
- **Many-to-many reference fields** (`column_name === ''`) — the junction table owns the association, and its name embeds the field name (`junction_<ownerTable>_<fieldName>`).

Renaming either would orphan stored rows. Both therefore keep the field name as their identity, and a declared rename naming one is rejected at build time with `UNRENAMEABLE_FIELD_KIND`; the escape is to retire the older version first. Programmatic fields have no stored data at all, so renaming one only requires updating its resolver binding key.

Generalizing to a `storage_key` on every field kind — the column name for column-backed fields, the `parent_field` value for paragraph fields, the junction-name component for many-to-many — would make every kind renameable. It is rejected for now because it changes `parent_field` semantics and junction table naming, both already persisted in existing databases, in exchange for renameability on the field kinds authors rarely rename.

Cost: code assuming field name equals column name must be audited. `packages/api/src/app.ts` documents one such assumption in its media-resolution comment ("the FK column and the field share a name"). The audit covers the repositories and relation-resolution paths and is in scope.

### Core outputs

| Output | Consumer | Purpose |
|---|---|---|
| `SchemaRegistry` (current) | api, admin | Unchanged — the newest version |
| **Union registry** | db codegen, graphql | All live versions' fields merged; retention is automatic |
| **`VersionProjection[]`** | api | Per live version: labels, allowlist, fallbacks |

```ts
type VersionProjection = {
  version: string
  fields: Array<{ column_name: string; exposed_as: string; fallback?: unknown }>
}
```

The union registry keys each field by column name and carries its per-version labels plus whether the current schema still exposes it.

Two automatic derivations:

- **`required` is relaxed.** A field that was `required: true` and is gone from the current schema becomes nullable in the union — rows created after the drop cannot populate it. Emits a non-destructive `DROP NOT NULL`.
- **Type changes are rejected.** One column cannot hold two types, so changing a field's type while a live version exposes it is a build error. Two documented escapes: rename it (both columns coexist) or retire the version first.

### Undeclared renames fail the build

A rename is indistinguishable from drop-plus-add. When a field disappears and a same-typed field appears in the same content type while a live version exposes the old name, codegen fails with `AMBIGUOUS_RENAME`, naming both candidates and the two resolutions: declare the rename in `changes.json`, or confirm an intentional drop.

Without this check the failure mode is silent data loss on the v1 route, found by a consumer in production.

### Layer boundaries

Unchanged. core computes, db codegens, api applies, cli orchestrates, admin untouched.

- **core** — parses snapshots, computes union and projections. Pure functions returning serializable plain objects. No new dependencies; nothing here clears the ADR core/0006 bar.
- **db** — codegen takes the union registry instead of the current registry.
- **api** — registers versioned route sets, applies projections.
- **cli** — `version:cut`, `version:list`, `version:diff`, `version:retire`; wires the union into codegen.
- **admin** — no change.

## HTTP contract

### Route surface

```
/api/v1/blog              /api/blog             -> current version
/api/v1/blog/:slug        /api/blog/:slug
/api/v1/taxonomy/:t/:id   /api/taxonomy/:t/:id
/api/v1/media             /api/media
/api/v1/media/:id         /api/media/:id
/api/v1/openapi.json      /api/openapi.json
```

The public registrators (`registerPublicContentRoutes`, `registerPublicMediaRoutes`) currently hardcode `/api/...`. They gain a base-path argument and are called once per live version with `(basePath, projection)`.

That change also makes the `api.prefix` option functional. Today `prefix` is threaded from config through the CLI and injected into the admin build as `__API_PREFIX__`, but the registrators hardcode `/api/...` and `__API_PREFIX__` is only declared in `packages/admin/src/env.d.ts`, never used — so the option does not currently affect routing. Centralizing path construction is a prerequisite for the version segment; honoring the configured prefix falls out of it. **In scope.**

The admin surface is **not versioned** — there is no `/admin/api/v1/*`. It is not, however, exempt from the mapping: because repositories return rows keyed by column name, admin routes serialize through the *current* version's projection like every other route. That is the single code path described under column identity, not a second one. Since the current version's labels are exactly the working schema's field names, admin responses are byte-identical to today's.

### Where projections apply

**Response bodies** — map column names to the version's labels, drop columns the version does not expose, substitute fallbacks where a retained column is null. Applied recursively: `?include=`-resolved relations and paragraph children are projected too, or a v1 consumer receives current-version labels one level down.

**Query parameters, inbound** — `filter[...]`, `sort`, and `include` all name fields. A v1 client filtering on `blog_title` must have it mapped to the underlying column before it reaches the repository. `parseFilters` already accepts a `validFields` set and returns `{ ok: false, invalidField }`; the version's allowlist becomes that set, so naming a field the version lacks produces the existing 400 rather than being silently ignored.

**Programmatic fields** — a resolver added after v1 is absent from v1's allowlist, so it is never invoked on v1 requests.

### Deprecation headers

Unversioned responses carry:

```
Deprecation: true
Link: </api/v2/blog>; rel="successor-version"
```

No `Sunset` header. `Sunset` requires a retirement date, and this design deliberately has no support-window policy to derive one from; emitting a fabricated date would be worse than omitting the header. Adding `Sunset` later requires adopting a declared support window.

### Unknown versions

`/api/v99/blog` returns 404 with the standard envelope:

```json
{ "ok": false, "error": { "code": "UNKNOWN_API_VERSION",
  "message": "Unknown API version \"v99\". Live versions: v1, v2." } }
```

One code, not separate codes for retired and never-existed. Distinguishing them would require remembering retired versions permanently, which is exactly the state dir-presence-as-truth does not keep. Listing what is live is more actionable than a tombstone.

### Rate limiting

In-process rate limiting (ADR api/0005) keys per route. The rate-limit key **must exclude the version segment**, or a client multiplies its budget N-fold by rotating version segments. One budget per logical endpoint.

### Caching

Distinct paths produce distinct CDN cache keys with no `Vary` configuration — the main practical reason the version sits in the path.

## Version lifecycle

### CLI commands

Following the existing `noun:verb` convention (`users:promote`, `migrate:status`) and dependency-injected handlers (ADR cli/0002):

- **`manguito version:cut`** — freezes `schemas/` into `versions/vN/`, bumping the working schema to `vN+1`. No argument; the name is derived. Fails with `DUPLICATE_VERSION_SNAPSHOT` if the target exists.
- **`manguito version:list`** — live versions and the field count each exposes.
- **`manguito version:diff [vN]`** — prints the projection plan: labels, dropped fields, fallbacks, retained columns. This is the inspectability that justified computing a plan over pure runtime projection.
- **`manguito version:retire vN`** — reports which columns the next migration will drop, then deletes the snapshot directory. Pure convenience: dir presence is the source of truth and `rm -rf` is equivalent; the value is the pre-flight report.

Snapshot directory presence is the single source of truth for which versions are live — git-visible, reviewable in a PR diff, with no config that can drift from the filesystem.

**Cutting a version never produces a migration.** At the moment of a cut the union equals the current schema. Migrations appear only after the working schema is edited.

### Retirement flow

1. Delete the snapshot directory (via `version:retire` or by hand).
2. The union shrinks; `build` / `migrate` regenerates the Drizzle schema without those columns.
3. `drizzle-kit generate` emits `DROP COLUMN`.
4. The existing destructive-change scanner (`packages/db/src/migrations/scanner.ts`) flags it and the CLI requires confirmation.
5. Apply.

No new destructive machinery.

**Documentation must call out loudly:** `manguito dev` runs `drizzle-kit push`, which ADR db/0002 makes intentionally destructive with no confirmation. Retiring a version in dev drops those columns instantly. Consistent with the documented dev philosophy, but here the data being dropped is data a contract was serving.

### Startup drift detection

Drift detection (ADR cli/0004) must compare generated artifacts against the **union** registry, not the current registry. Otherwise every retained column reads as drift and every versioned project warns on every boot.

## GraphQL

One unversioned `/graphql` following the current schema, plus deprecated fields for anything a live REST version still exposes:

- A field dropped from the current schema but live in v1 stays exposed, marked `@deprecated(reason: "Removed in v2; retained while v1 is live")`.
- A renamed field also gets a deprecated alias — `blogTitle` alongside `title`, both resolving to the same column.

This is GraphQL's own documented position: evolve additively and deprecate fields rather than versioning the endpoint. It also keeps the two public surfaces in agreement about which fields exist, and reuses the same retain-until-retirement rule that governs the columns, so one mechanism drives both.

The GraphQL builder takes the union registry plus the current registry and needs no version-routing logic. Retirement removes a field from both surfaces at once.

## Error handling

Build and parse time — `Result`, per ADR 0001, surfaced by the CLI as a non-zero exit:

| Code | Trigger |
|---|---|
| `AMBIGUOUS_RENAME` | Field disappeared, same-typed field appeared, a live version exposes the old name |
| `FIELD_TYPE_CHANGED_WHILE_LIVE` | Type change on a column a live version exposes |
| `VERSION_SNAPSHOT_INVALID` | A snapshot fails to parse |
| `DUPLICATE_VERSION_SNAPSHOT` | `version:cut` target directory already exists |
| `UNDECLARED_RENAME_TARGET` | A `changes.json` rename names a field absent from both the snapshot and the current schema |
| `UNRENAMEABLE_FIELD_KIND` | A declared rename names a paragraph or many-to-many field, whose identity is persisted data |

Startup — throws, matching how `createCmsApp` already treats a broken roles registry or invalid resolver bindings: the server must not boot with an incoherent version set.

Runtime — `UNKNOWN_API_VERSION`, 404, standard envelope.

## Testing

Following coverage by intention (ADR 0004) and real-Postgres integration tests (ADR 0003):

- **core** — table-driven unit tests on the pure diff/union/projection functions: rename-chain composition across three versions, ambiguity detection, `required` relaxation, type-change rejection, fallback resolution.
- **db** — codegen snapshot tests proving retained columns appear in the generated schema and are nullable.
- **api** — integration tests against real Postgres:
  - v1 and the current version each return their own labels
  - a dropped field serves its retained value on existing rows and its fallback on rows created after the drop
  - filtering and sorting by a v1 label resolves to the right column
  - filtering by a field the version lacks returns 400
  - `?include=` and paragraph children are projected recursively
  - unknown version returns 404 `UNKNOWN_API_VERSION`
  - deprecation headers present on unversioned routes, absent on versioned ones
  - one rate-limit budget shared across version segments
- **graphql** — a retained field carries `@deprecated`; a rename alias resolves to the same column.
- **cli** — `version:cut` / `list` / `diff` / `retire` handlers with injected dependencies (ADR cli/0002).
- **smoke** — cut a version in `apps/sandbox`, then exercise both route sets (ADR 0005).

## Implementation sequencing

This spec is large enough to warrant two implementation plans rather than one. Stage 1 is independently valuable, independently testable, and ships no user-visible feature:

**Stage 1 — foundations.** Column names become immutable; the field-name-equals-column-name assumption is removed from the repositories and relation-resolution paths; path construction is centralized so `api.prefix` functions. Every existing test must pass unchanged, since no external behavior changes. This stage alone fixes the latent rename hazard for unversioned projects.

**Stage 2 — versioning.** Snapshot loading, union and projection computation, versioned route registration, deprecation headers, GraphQL deprecation, the four `version:*` commands, drift detection against the union.

Splitting here keeps a risky mechanical refactor separate from new feature surface, so a regression in stage 1 is unambiguously a refactor bug rather than a versioning bug.

## Deliverables

### Code

- `packages/core` — snapshot loading, union computation, projection computation, `changes.json` parsing and validation, ambiguity detection. Exported from the package root.
- `packages/core/src/registry/fieldTypeRegistry.ts` — column names become immutable rather than always mirroring the field name.
- `packages/db/src/codegen` — accepts the union registry.
- `packages/api` — versioned route registration, projection application (response bodies, query params, nested relations), deprecation headers, `UNKNOWN_API_VERSION`, version-agnostic rate-limit keys, centralized path construction honoring `api.prefix`.
- `packages/api/src/graphql` — deprecated retained fields and rename aliases.
- `packages/cli` — the four `version:*` commands; union wired into codegen and drift detection.
- Audit: remove the field-name-equals-column-name assumption from the repositories and relation-resolution paths.

### Documentation

- `docs/v2/schema-versioning.md` — feature design, following the `graphql-module` precedent.
- New ADRs:
  - **api** — multi-version public routes; version in path; unversioned resolves to current with deprecation headers.
  - **core** — column name as cross-version field identity.
  - **core** — amendment to ADR core/0003 explaining why a derived union registry is not the per-consumer model that ADR rejected: it is computed by a pure function from the same files, never hand-authored, and therefore has the same standing the ADR already grants its derived convenience maps.
- `packages/api/CONTEXT.md` and `packages/core/CONTEXT.md` — glossary entries for *live version*, *projection*, *union registry*, *retained column*, *cut*, *retire*.
- README — move "Schema versioning with multi-version API routes" from *Planned for v2+* to *Delivered in v2*.

## Known limitations

**Retained data goes stale.** Retention keeps old data readable, not fresh. Once the current schema drops `blog_desc`, the admin panel follows the current schema and stops writing it. v1 consumers then see the last-known value on existing rows and the declared fallback on rows created after the drop.

No design avoids this without per-version write paths, which is substantial machinery for a self-hosted CMS with one schema author. The `fallbacks` map makes the degraded value explicit and author-chosen rather than an implicit null. Documented the way ADR api/0002 documents its media-serving limitation: **a live version is a supported contract, not a permanently faithful one.**

**Paragraph and many-to-many fields cannot be renamed while a version is live.** Their identity is persisted as data (`parent_field` values and junction table names) rather than as a column. Retire the older version first.

**Type changes on live fields are blocked.** Changing a field's type while a live version exposes it requires renaming the field or retiring the version first. This is a deliberate constraint of one-canonical-row, not an oversight.

**No enforced support window.** Nothing prevents a project from accumulating many live versions, and nothing pushes an author to retire. `version:list` makes the count visible; policy is the author's.
