# Column as Identity — Design (Schema Versioning 2f)

**Date:** 2026-10-01
**Status:** Approved, ready for implementation planning
**Scope:** Make a field's storage column its internal identity throughout the api, so a label — current's or a live version's — is applied exactly once, at the response boundary. Closes the four versioning residuals recorded in [2e](2026-09-21-graphql-versioning-design.md), plus one unrelated GraphQL filter bug that touches the same name map. No core change.

## Problem

Schema versioning lets a field's public name change while its storage stays put:

```json
{ "name": "title", "column": "blog_title", "label": "Title" }
```

So a field has three names, and they map onto Drupal's model like this once `column` exists:

| Role | Drupal | Manguito | Mutable |
|---|---|---|---|
| Storage identity | machine name | `column` (defaults to `name`) | no — a live version's column must persist (`VERSION_COLUMN_MISSING`) |
| Public API key | machine name, or a JSON:API alias | `name` | yes, per version |
| Display string | label | `label` | yes |

Drupal never uses the API alias as an internal identity. **The api does.** `name` is both this version's public key *and* the key the code identifies a field by. When a field is renamed, the second role moves with it — while the stored data and every older live version still need the old identity. Residuals 1–4 below are consequences of it; 5 is not.

The mechanism is visible in one place. `resolveRelationField`'s reference and media branches write a resolved relation under the field's name and delete its storage column:

```ts
row[fieldName] = fkVal ? (cache.get(`media:${fkVal}`) ?? null) : null
if (dropFk) delete row[rel.fk_column]
```

During resolution, a relation's value **migrates from its storage key to its name key**. Scalars never do this: they stay column-keyed until `toLabels` maps column → *this version's* label at the response boundary, which works for every version automatically. Relations break the pattern, and the rest of the api compensates for it.

## The residuals, re-characterised by probe

The 2e spec recorded #1 below as "an `?include=`d reference disappears when you ask for it and returns correctly when you don't." **That description was wrong.** A probe against a running app — a content type with a renamed reference (`category` over `category_id`) and a renamed media field (`hero` over `blog_hero_image`), where v1 exposes them as `legacy_cat` and `legacy_hero` — returned:

| Request | Result |
|---|---|
| `/api/v1/...` | 200, `legacy_cat` present as a bare id, **`legacy_hero` absent** |
| `/api/v3/...` (control) | 200, `hero` resolved |
| `/api/v1/...?include=legacy_cat` | **400** — the route accepted v1's label, then the *repository* threw |
| `/api/v1/...?include=category` | **400** — the *route* rejected the registry name |
| `/api/v3/...?include=category` (control) | 200, resolved |

So the residuals this branch closes are:

| # | Residual | Caused by versioning |
|---|---|---|
| 1a | A renamed **media** field vanishes from every older version's response, silently, on every request | yes |
| 1b | A renamed **reference** cannot be `?include=`d on an older version at all — the route validates against the version's labels, the repository against registry names, and no name satisfies both | yes |
| 2 | The drop-set un-drops by *string*, so a projected label equal to a different field's name or column serves one field's data under another's key | yes |
| 3 | 2e's fix to the collision check traded a startup crash for #2's silent corruption in one overlap | yes — a regression this arc introduced |
| 4 | A programmatic resolver reading a *current* label gets `undefined` on every older version | yes |
| 5 | `filter: { createdAt: … }` is advertised on every GraphQL endpoint and fails at runtime | **no** — see Section 5 |

## The principle

**A field's column is its internal identity everywhere. A label is applied exactly once, at the response boundary.** Scalars already behave this way; this design makes relations obey the same rule.

It does not make `name` immutable. Doing that would remove renames entirely — the `column` override, the `renamed` change kind, "Renamed to 'title' in v3" — which shipped in core `0.4.0` and which both versioned surfaces depend on. Column-as-identity gives Drupal's guarantee *without* removing the alias.

## Section 1 — relations stay column-keyed (closes #1a)

`resolveRelationField`'s reference and media branches write the resolved object **in place under `rel.fk_column`**, replacing the uuid. No `dropFk`, no delete. This is not new behaviour: it is exactly what those branches already do whenever a field's name equals its column. `needsFkResolution` simplifies to "the value at the column is already an object."

Paragraph and junction branches are **unchanged**. Those fields have no column, so they stay name-keyed — and they are never versioned, so their name equals their label on every version.

Every reader of a resolved column-backed relation moves to the column key:

- **GraphQL dataloader** (`createRelationLoaders`) returns `r[rel.fk_column]` for media and reference, and `r[fieldName]` for paragraph and junction as now.
- **REST `projectRow`.** After `toLabels`, a resolved relation is *already* under this version's label — column → label, like any scalar. `nestedTargets` builds `nested` from `map.labelFor(column)` for column-backed references, skipping fields the version does not expose, and from `f.name` for paragraph and junction fields.

2e's `relabelMedia` and its `MediaFieldKey` type are **deleted**. They existed only to undo the move this section stops making.

### What stays unchanged, and why

For current's map, a column always maps to the field's own name: `createFieldKeyMap` builds its pairs as `{ label: f.name, column: f.db_column.column_name }`, and `buildProjections` sets current's `exposed_as` from `f.name`. So writing a resolved relation in place and then applying `toLabels` produces the same key the old move-to-name produced. The admin panel, the unversioned REST pass and the current version's own endpoint therefore serve **byte-identical** relation keys. Only older live versions change.

## Section 2 — `?include=` translation (closes #1b)

The public content route already builds the set of relation names a version accepts (`relationFieldNames`) from `labelFor(column)`. It becomes a map from **this version's label to the registry name**, applied to every `?include=` entry before the repository is called. Validation stays against the version's labels — what the consumer speaks. The repository receives registry names — what it speaks. Applied at both the collection and item routes.

The repository's relation map (`buildRelationsMap`) **stays keyed by registry name**. It needs one key space that also covers paragraph and junction fields, which have no column.

## Section 3 — split the drop-set by key space (closes #2 and #3)

`buildFieldKeyMap`'s `remap` consults a single `droppedKeys` set for both directions. But `toLabels` reads **column**-keyed input and `toStorage` reads **label**-keyed input, and a label and a column can be the same text. That shared key space is the root of #2.

Split it:

- **`droppedColumns`**, consulted only by `toLabels`.
- **`droppedLabels`**, consulted only by `toStorage`.

After Section 1, a row never contains a column-backed field's *name*, so `droppedColumns` needs only columns: the `dropped.add(f.name)` entries leave the read path entirely.

They do not simply vanish, though. Today a tombstone's *name* sits in the shared set, and that is what refuses a write addressed to it — `toStorage` skips any key in `droppedKeys`. Under the split, tombstones' names go into `droppedLabels`, so a write to a tombstone stays refused. Its column goes into `droppedColumns`, so the retained column stays out of reads.

The collision check then narrows to the one genuine ambiguity that remains: a **non-column-backed** field's name — which really is a row key, since paragraph, junction and programmatic values are written under it — equalling some column. Column-backed names are no longer row keys and cannot collide. That removes the rename-back false positive *without* 2e's `ownColumn` skip, and the skip was precisely what was too broad, so #3 goes with it.

### Consequence for existing tests

Two of the four existing collision tests change what they should expect:

| Test (`field-keys.test.ts`) | Today | After | Why |
|---|---|---|---|
| a **paragraph** named after another field's column | throws | **still throws** | a paragraph's name is a row key |
| a **many-to-many** field named after a column | throws | **still throws** | same |
| a field *named* after another field's column | throws | **maps correctly in both directions** | a column-backed name is no longer a row key |
| a live label equal to a **tombstone's** column | throws | **maps correctly in both directions** | split sets mean the label no longer hits the tombstone's column |

The fourth row is the telling one. With a shared set, `toStorage` silently drops the live field's write — its label matches the tombstone's column, which is in `droppedKeys`. That is what the throw was guarding. With split sets both directions come out right, so the guard is no longer needed for that case.

This is evidence the design is right rather than a relaxation: the collision check was a guard against the shared key space, and its job shrinks to exactly the case that is still dangerous. The two changed tests will assert correct mapping in **both** directions, not merely the absence of a throw.

Two configurations that refuse to boot today will start working. That is a visible behaviour change, and part of why this is a minor release.

## Section 4 — resolvers see current's labels (closes #4)

A programmatic resolver's record is always built with **current's** field-key map, never the served version's. A resolver is authored once, against the schema as it is now.

Section 1 makes this nearly free. Resolved relations are column-keyed, so `toLabels` with current's map yields current's labels *with* resolved relations — `ctx.get('hero')` returns the media object on every version, with no relabel step.

Programmatic fields are never versioned, so their names are identical on every version. That is what makes the merge sound: the resolver runs on a current-labelled record, and only its computed **programmatic** values are merged into the version-labelled response.

- **REST.** The read handlers currently call `projectRow` and then `resolver.resolveItem` / `resolveList`, whose return value *is* the response. They become: project with current's projectors for the resolver; project with the version's projectors for the response; merge the type's programmatic keys from the former into the latter. Versioned route registration therefore needs current's projectors alongside the version's.
- **GraphQL.** `resolveProgrammaticRow` applies current's field-key map rather than the version's.

## Section 5 — GraphQL filter system fields (closes #5)

**Not caused by versioning.** It fails identically on a project that has never cut a version, and is fixed here only because it touches the same name map.

`buildFilterInputType` adds `createdAt` and `updatedAt` to every `<Type>Filter`, but the name map handed to `translateFilters` is built from field labels only, on both the view and no-view paths. A system field is never in it, so `createdAt` falls through as its own column name — which does not exist; `created_at` does.

Fix: include the type's `system_fields` in the names passed to `buildFieldNameMap`. `toCamelCase('created_at')` then maps `createdAt → created_at`, `columnFor` returns nothing for a system field, and `translateFilters` falls back to the real column. `id`, `published` and `slug` already equal their columns.

## Testing

Every defect gets a failing-first test, and every test states the mutation it must reject (PLAN-QUALITY rule 1).

- **The probe's five cases become integration assertions** against Postgres, through `createCmsApp` and the real repository. Each must fail on the current code.
- **The two changed collision tests** assert correct mapping in both `toLabels` and `toStorage`. Reverting to a single shared drop-set must break them.
- **A new reference-field collision test** — a reference *named* after another field's column. Today that resolved reference lands under the other field's label and is served as it; that is where today's code genuinely mis-serves data.
- **#4 uses the 2e residual's exact repro:** a resolver returning `` `got:${ctx.get('title')}` `` on v1 returns the value, not `got:undefined`, on both surfaces.
- **#5** filters a real GraphQL query by `createdAt` and asserts the filtered rows come back.
- **The unchanged claim is pinned:** for the current version, relation keys in REST and GraphQL responses are identical before and after.

Gates on every task: `test`, `typecheck`, `lint`, and `build` (PLAN-QUALITY rule 7). The suite must also run from a fresh clone, per the README's local-development steps.

## Release

**One minor bump of `@bobbykim/manguito-cms-api`.** Column-as-identity fixes #1 and #2 in a single change, so the patch-then-minor split considered earlier no longer earns its overhead. It is a minor rather than a patch because two behaviours change visibly: configurations that refused to boot will start, and resolver authors on older versions get values where they got `undefined`. Core is unchanged — the collision check and projector live in the api.

## Out of scope, recorded

- **Non-interactive migrations can silently do nothing.** Renaming a field's `name` without declaring `column` changes its storage column. `drizzle-kit generate` then needs to ask "rename or create?"; with no TTY it errors, **exits 0**, and writes no migration. `generateMigration` invokes it via `execSync` with inherited stdio and trusts that exit code, so a `migrate` run from CI or a script reports success while the database and schema now disagree about the column. Interactively the prompt appears and the destructive-change guard backs it up. Verified by running `drizzle-kit generate` with stdin closed. This lives in migration tooling, not the projector, and is its own fix.
- **The repository throws on an invalid include**, with a stack trace to stderr, where CLAUDE.md asks for a Result type on expected conditions. Once Section 2 translates names, invalid includes are rejected by the route first, so the throw becomes unreachable from public routes. Changing the repository would widen this branch for no observable gain.

## Residuals

- **A programmatic field whose name equals a live version's label for some column.** Section 4 merges programmatic values into the version-labelled response, so on that version the programmatic value would overwrite the column's. Reaching it requires a version to label a column with a name that current has since reused for a programmatic field. Detectable at map-build time, but not handled here.
- **The `api` ↔ `test-utils` cyclic workspace dependency** is unchanged; see the README's local-development notes.
