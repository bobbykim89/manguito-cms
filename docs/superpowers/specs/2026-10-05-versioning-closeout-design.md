# Schema Versioning Closeout — Design

**Status:** Approved in conversation 2026-10-05. Closes the schema versioning arc ([2a](2026-08-30-version-model-core-design.md) through [2f](2026-10-01-column-as-identity-design.md)).

## Problem

Versioning shipped across six sub-projects, but three things leave it half-delivered:

1. **The lifecycle command is named for its mechanism, not its effect.** `version:cut` freezes the working schema as a new version. Users read "cut" as ambiguous. Nothing tells them a new project is already v1, or that the first cut creates `schemas/versions/v1/`.
2. **`manguito validate` never checks the version model.** `runValidate` in `packages/cli/src/commands/validate.ts` contains no version code. `loadVersionSnapshots` and `computeVersionModel` raise every version error (`VERSION_SNAPSHOT_INVALID`, `FIELD_TYPE_CHANGED_WHILE_LIVE`, `VERSION_COLUMN_MISSING`, `ORPHANED_TOMBSTONE`), and only `build`, `dev` and the version commands call them. As a result:
   - `validate` passes schemas that `build` rejects.
   - `version:retire` prints "Until you do, `manguito validate` will report ORPHANED_TOMBSTONE", which is false.
   - `dev` carries a comment conceding the gap and sends users to `version:diff` instead.
3. **The feature is undocumented.**
   - The README lists versioning under *Planned for v2+*.
   - `docs/schema-authoring.md` never documents a field's `column`, `removed` or `fallback` properties, so a user cannot discover how to rename or remove a field safely.
   - `docs/graphql.md` never mentions `/graphql/<version>`.
   - The ADRs and glossary entries promised by the [umbrella design](2026-08-27-schema-versioning-design.md) were never written, and ADR api/0011 describes behaviour 2f removed.

There is also no read-only way to see what is being served. The [CLI lifecycle design](2026-09-02-cli-version-lifecycle-design.md) dropped `version:list` as speculative before versioned routes existed. With both surfaces shipped, "which versions am I serving?" is an everyday question.

## Goals

- `version:create` replaces `version:cut`. `version:cut` stays as a hidden, deprecated alias.
- A read-only `version:list` shows the live set and how far each older version is behind current.
- `validate` and `build` reject exactly the same version errors.
- Every user-facing doc, CLI message and glossary uses the new vocabulary, and documents how to rename and remove a field.
- The decision records and design index the umbrella design promised exist and are accurate.

## Non-goals

- **No change to core, api or db behaviour.** The version model, its errors and the served contract are untouched.
- **No change to what a version is.** `version:create` keeps `version:cut`'s exact semantics: it freezes the working schema as `v<highest + 1>`, refuses when no column changed, and writes atomically.
- **Deferred, recorded in the design index:**
  - the sandbox smoke test that creates a version;
  - `drizzle-kit generate` exiting 0 with no migration when it has no TTY (the guide documents the way around it);
  - whether paragraph types are versioned;
  - `createGraphQLHandler` defaulting current's field-key maps for direct callers.
- **Historical documents are not rewritten.** Changelogs and the earlier specs keep "cut".

## Section 1 — Commands

### `version:create`

- **Handler.** `runVersionCut` in `packages/cli/src/commands/version.ts` is renamed `runVersionCreate`. Its behaviour is unchanged.
- **Messages.** Every message says "create" where it said "cut", including the retire path's "No versions have been cut yet — run `manguito version:cut` first."
- **First run.** When no snapshot exists yet (`highestSnapshot` returns `null`), the command explains the consequence before it prompts. With `--yes` the explanation still prints; only the prompt is skipped.

  ```
  This creates v1 from your working schema. <prefix>/v1 keeps serving it
  unchanged; your working schema becomes v2, served at <prefix>/v2 and <prefix>.
  Create v1? (y/N)
  ```

  Here `<prefix>` is the configured `api.prefix` (`config.api.prefix ?? '/api'`, the expression `dev` already uses).
- **The live-set lines are corrected.** Today's cut prints "After cutting, v1 are live" and "Live: v1." on a first cut. Both omit the working schema, which is live too as `v<n+1>`. `version:create` lists every version live after the write: the existing live set minus the working schema's old number, plus the new snapshot, plus the new working schema. For example: "After creating v1, these versions are live: v1 v2."

### `version:cut`, deprecated

- **Registration.** It is registered with commander's `{ hidden: true }`, so it is absent from `--help`. It accepts the same options.
- **Behaviour.** It first writes one line to **stderr**, then runs `runVersionCreate`:

  ```
  `version:cut` is deprecated — use `version:create`. It will be removed in a future release.
  ```

- **Why stderr.** Stdout stays identical to `version:create`'s, so a script parsing it is unaffected.

### `version:list`

- **Read-only.** It writes nothing.
- **Preamble.** It shares the version commands' preamble, so an invalid model exits 1 with the model's errors, exactly as `diff`, `create` and `retire` do.
- **One line per live version, oldest first.** Each line gives the version name and its REST path under the configured prefix.
- **How each older version is described.** `describeSchemaChange({ from: <that snapshot>, to: { version: current, registry } })` produces counts of `renamed`, `tombstoned` (printed as "removed"), `added` and `restored` field changes, summed across types. Zero counts are omitted. All-zero prints "identical to current".
- **The current version** is marked `current — also <prefix>`.

```
Live versions (3):
  v1  /api/v1   2 renamed, 1 removed, 3 added since
  v2  /api/v2   identical to current
  v3  /api/v3   current — also /api
```

With no snapshots:

```
No versions created yet. Your working schema is v1, served at /api/v1 and /api.
Run `manguito version:create` before making a breaking change.
```

## Section 2 — One version check, shared

### `loadProjectVersionModel`

A new CLI helper in `packages/cli/src/utils/`:

```ts
loadProjectVersionModel(
  schema: ResolvedSchemaConfig,
  registry: SchemaRegistry
): Result<{ snapshots: VersionSnapshot[]; model: VersionModel }>
```

`Result<T>` is core's existing shape (`{ ok: true; value: T } | { ok: false; errors: ParseError[] }`, from `packages/core/src/parser/loader.ts`), the type both core functions already return.

- **What it runs.** `loadVersionSnapshots` and then `computeVersionModel`.
- **Errors.** It returns errors rather than exiting. Snapshot errors and model errors come back in one list. Model errors are only computed when the snapshots loaded.
- **Printing.** Each caller prints in its own established style. It is a pure composition of two core functions, so it never exits, prints or touches the filesystem beyond what `loadVersionSnapshots` already reads.

### Callers

| Command | Change |
|---|---|
| `validate` | After `validateCrossReferences`, and only when parsing produced a registry with no errors so far, runs the helper and appends its errors to `allErrors`. One run then reports every problem. Version errors are not computed against a broken registry, where each would be noise caused by an earlier error. |
| `build` | Runs the helper **before** any codegen write. Today it writes `schema.ts`, the registry, routes and forms into `dist/generated` and only then fails. Then `generateVersionModel` runs where it does now. |
| `dev` | Uses the helper. On failure it points to `manguito validate`, not `manguito version:diff`, and the comment conceding the gap is removed. |
| `version:*` | `loadVersionContext` uses the helper. Output is unchanged. |

### The invariant

**`validate` and `build` reject the same version errors.** Tests pin it with a project whose model is invalid:

- **`ORPHANED_TOMBSTONE`.** A tombstone left for a column no live version exposes makes `validate` exit 1 with that code. That is the case `version:retire`'s message promises.
- **`FIELD_TYPE_CHANGED_WHILE_LIVE`.** A live field whose type changed makes both `validate` and `build` exit 1 with that code.

## Section 3 — Documentation

### User-facing

**`docs/schema-versioning.md`** (new) is the guide, in the style of `docs/graphql.md`. It covers:

- **Concepts.** The working schema, a live version, creating and retiring. A new project is already v1 and needs no setup.
- **Renaming a field.** Change `name` and declare `column`. The guide must say plainly that renaming `name` without `column` changes the storage column. With no TTY, the migration tool then exits 0 having written nothing, and declaring `column` avoids that.
- **Removing a field** while an older version serves it: `removed: true` and an optional `fallback`.
- **What is not versioned.** Paragraph types, programmatic fields, many-to-many references and enums.
- **REST.** `<prefix>/<version>` paths, the unversioned alias, deprecation headers (`Deprecation`, `Link: rel="successor-version"`, and `Warning: 299` on the unversioned path once more than one version is live), 410 `VERSION_RETIRED`, and 404 `VERSION_NOT_FOUND`.
- **GraphQL.** `/graphql/<version>`, `@deprecated`, and the retired or unknown answer: HTTP 200 with a GraphQL error whose code is `VERSION_RETIRED` or `VERSION_UNKNOWN`.
- **Programmatic resolvers.** They always read current's field names.
- **The four commands.**
- **The retirement warning.** `manguito dev` drops retained columns immediately (ADR db/0002).
- **Known limitations.** Retained data goes stale, the paragraph-type boundary, and one OpenAPI document for every version.

Other user-facing changes:

- **`docs/schema-authoring.md`.** Document the field properties `column`, `removed` and `fallback`, and link to the guide.
- **`docs/graphql.md`.** A short section on per-version endpoints, linking to the guide.
- **README.**
  - Move versioning to *Delivered in v2*, linking to the guide.
  - Add a short "Schema versioning" section beside the GraphQL one.
  - List the `version:*` commands.
- **`packages/create-manguito/src/templates/README.md.template`.**
  - Add `version:create`, `version:list`, `version:diff` and `version:retire` to the "Other CLI commands" line.
  - Add `schemas/versions/` to the project tree, noting that `version:create` makes it and it must be committed.

### Design and decision records

- **`docs/v2/schema-versioning.md`** (new). A design index in the style of `docs/v2/graphql-module.md`:
  - the specs 2a–2f in order, and which parts are superseded (the umbrella's rename log, by the declarative model);
  - the ADRs;
  - the deferred items under Non-goals.
- **ADR api/0012 (new), "Multi-version public API."**
  - The version goes in the path.
  - The unversioned path resolves to current, with deprecation headers.
  - A version outside the live set answers 410 `VERSION_RETIRED` or 404 `VERSION_NOT_FOUND`, naming the live set. (The umbrella design called this `UNKNOWN_API_VERSION`; the shipped codes are these.)
  - The rate-limit key excludes the version.
  - GraphQL gets one schema per live version.
- **ADR core/0007 (new), "A field's storage column is its identity across versions."**
  - `column` is declared, never derived.
  - A removed field stays in the current schema as a tombstone while any live version exposes its column, so the union registry *is* the current registry.
  - Paragraph and many-to-many fields cannot be renamed (`UNRENAMEABLE_FIELD_KIND`).
- **ADR api/0011 (corrected).**
  - The Consequences bullet saying relation resolution deletes the raw FK key is replaced: relations resolve in place under their column.
  - The passage on the programmatic record says it is built with current's field-key map.
  - A bullet records the split `droppedColumns` / `droppedLabels`.
- **ADR core/0003 amendment: dropped.** It was promised to justify a derived union registry. Under the declarative model none exists (`computeVersionModel`: "The union IS current"), and the design index says so.
- **Glossaries.** Checked against what each file already defines:
  - `packages/core/CONTEXT.md` already defines *Live version*, *Snapshot*, *Tombstone*, *Fallback* and *Union registry*. Its *Cut* entry becomes *Create (a version)*. It gains *Retire* and *Retained column*. *Tombstone*'s claim that excluding tombstones from the api and admin "is an obligation, not yet implemented" is corrected: both now exclude them.
  - `packages/api/CONTEXT.md` already defines *Versioned surface*, *Unversioned path* and *Retired / unknown version*. It gains *Live version* and *Retained column*, each pointing to core's definition.
  - `packages/cli/CONTEXT.md`'s *version:cut* entry becomes *version:create*, noting the deprecated alias. It gains a *version:list* entry.

## Testing

Following ADR 0004 (coverage by intention), with each test stating the mutation it rejects (PLAN-QUALITY rule 1):

- **`version:create`.**
  - It writes `schemas/versions/v<n>/` exactly as `version:cut` did. The cut handlers have no handler-level tests today, so these are new, run against a real temporary project with real core.
  - The first-run explanation prints only when no snapshot exists.
- **`version:cut`.** It writes the deprecation line to stderr, produces stdout identical to `version:create`'s, and is absent from `--help`.
- **`version:list`.**
  - The no-snapshot message.
  - A live set of three: oldest-first order, the drift summary built from a real `describeSchemaChange` over fixture schemas, "identical to current", and the current marker.
  - A non-default `api.prefix` reflected in the paths.
- **`validate`.**
  - `ORPHANED_TOMBSTONE` and `FIELD_TYPE_CHANGED_WHILE_LIVE` each exit 1 with that code.
  - A valid versioned project still passes.
  - A schema with a parse error reports that error and no version errors.
- **`build`.** It fails on an invalid model before any file exists under `dist/generated`.
- **`dev`.** Its failure output names `manguito validate`.

Gates: `test`, `typecheck`, `lint` and `build` for every touched package (PLAN-QUALITY rule 7), plus `pnpm lint:plans` on this spec and the plan.

## Release

- **`@bobbykim/manguito-cms-cli`: minor.** New `version:create` and `version:list`, a deprecated `version:cut`, and `validate` now rejecting invalid version models (a schema that passed may now fail, which is the point).
- **`@bobbykim/create-manguito`: patch.** README template only.
- **Docs and ADRs** ship without a package bump.
