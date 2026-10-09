# Relation Cardinality — Design

**Status:** Approved in conversation 2026-10-09.

## Problem

Every layer that handles a relation field decides for itself whether the field holds one item or a list, and the layers disagree. The rules each layer applies today (measured at `da07d76`):

| Layer | Where | Rule today |
|---|---|---|
| Write-schema codegen | `fieldToZodSchema` in `packages/api/src/codegen/routes.ts` | only `one-to-many` is a list; `many-to-many` is typed as a single uuid |
| GraphQL types | `buildGraphQLSchema` in `packages/api/src/graphql/schema.ts` | references: `one-to-many` and `many-to-many` are lists; paragraphs: always lists |
| Admin reference picker | `ReferenceSelect.vue` | anything but `one-to-one` is multi-select |
| Admin form start values | `defaultForField` in `ContentFormView.vue` | references by `rel`; paragraphs always `[]` |
| REST read, paragraph persistence | `resolveRelationField`, `resolveRelationBareIds`, `persistParagraphField` in `packages/api/src/relations.ts` | ignore `rel`; paragraphs are always arrays |

Storage was specified differently again. The phase-02 and phase-03 decisions specify a `one-to-many` reference as **one** FK column on the owning table (`docs/decisions/phase-02/phase-02-schema-format.md`: "`reference` one-to-many | FK column on content table | SET NULL"). That is many-to-one in database terms. The phase-08 admin decisions specify it as a multi-select (`docs/decisions/phase-08/phase-08-content-form-ux.md`).

A throwaway integration probe (deleted, never committed) ran against the real test database, with the admin and public routes built by `createTestApp`. It measured:

| Input | Result |
|---|---|
| `one-to-many` reference written as `[a, b]` | **500**. The response message contains the failed SQL and every parameter value. |
| `one-to-many` reference written as `[a]` | 201. Stored as the single uuid `a`; Postgres takes a one-element row as a scalar. |
| `one-to-many` reference written as `"a"` | 201. Stored as `a`. |
| `one-to-one` paragraph written as an object | **201, nothing stored.** Each of the four admin write paths does `Array.isArray(body[f.name]) ? body[f.name] : []`, so an object becomes `[]`. On an update, `persistParagraphField` deletes the stored rows first, so the existing value is erased. |
| `one-to-one` paragraph written as `[object]` | 201, stored. |
| `one-to-one` paragraph read (admin and public) | always an array |
| deleting the target of a required reference | **500**, again with SQL in the message. The target is kept. The FK says `ON DELETE SET NULL` on a `NOT NULL` column, so Postgres refuses. |

The admin panel makes both bugs reachable without hand-built requests:

- `ParagraphEmbed.vue` always emits an array, so it never loses data, but it lets an editor add several items to a one-to-one paragraph unless `max: 1` is set. The sandbox's `blog_link` sets exactly that.
- `ReferenceSelect.vue` is a multi-select for `one-to-many`, so selecting two items fails the save with a 500.

The generated write schemas declare the documented shapes, but nothing applies them to admin writes at runtime.

## Goals

- One rule, in core, decides whether a relation field holds one item or a list. Every layer that shapes, validates or renders a relation value calls it.
- Each relation kind has one shape across admin writes, admin reads, the public REST API, GraphQL, the write-schema codegen and the docs.
- No relation input causes a 500 or silent data loss. A wrong shape gets a 422 that names the field.
- Deleting an item that a required reference points at is refused with a 409 that says where it is used. Deleting the target of an optional reference still clears the field.
- A 500 response never carries internal error detail.

## Non-goals

- **Removing `one-to-many` from references.** It is deprecated with a warning; it keeps parsing and its storage is unchanged. Removal is for a later major version.
- **Keeping the old array shape on older API versions.** The versioning system tracks which fields a version exposes, not their shape. Both REST and GraphQL change shape on every version at once. There are no known production consumers.
- **A uniqueness constraint giving `one-to-one` references strict one-to-one semantics.** Today two items may point at the same target, and that stays.
- **The taxonomy admin form.** It renders no relation, paragraph or media fields (`TaxonomyFormView.vue`: "flat — no paragraphs, media, or references in taxonomy"). API validation still covers taxonomy writes.
- **Media fields.** Media deletion is already refused while anything uses the file (`MEDIA_IN_USE`, by reference count), so required image and file fields cannot hit the delete problem.

## Section 1 — The cardinality rule and the deprecation (core, CLI)

### `relationCardinality`

New file `packages/core/src/registry/cardinality.ts`, exported from core's `index.ts`:

```ts
export type Cardinality = 'one' | 'many'
export function relationCardinality(field: ParsedField): Cardinality | null
```

| `field_type` | `rel` | Result |
|---|---|---|
| `paragraph` | `one-to-one` | `'one'` |
| `paragraph` | `one-to-many` | `'many'` |
| `reference` | `one-to-one` | `'one'` |
| `reference` | `one-to-many` | `'one'` (deprecated) |
| `reference` | `many-to-many` | `'many'` |
| anything else | n/a | `null` |

It reads `rel` from `field.ui_component`: `paragraph-embed` and `typeahead-select` both carry `rel: RelationType` (`packages/core/src/registry/types.ts`). The admin receives the same `ParsedField` objects from the schema endpoint, so it calls the function with no new data. It is pure, and its output is plain data ([ADR core/0002](../../adr/core/0002-serializable-parser-output.md)).

**A browser-safe subpath export.** *(Added during planning.)* The admin imports only types from core today. Core's main entry also exports Node-only code (the schema file loader, `bcryptjs`), so a runtime import of it would pull that into the admin's browser bundle. Core therefore also publishes the rule as `@bobbykim/manguito-cms-core/cardinality`: an extra tsup entry, `src/cardinality.ts`, which imports types only, plus an `exports` entry in `package.json`. This is the pattern `@bobbykim/manguito-cms-api` already uses ([ADR api/0006](../../adr/api/0006-subpath-exports.md)). The admin imports the subpath; the API and CLI import the main entry.

### `findSchemaDeprecations`

The parser has no warning channel (`grep -rni warning packages/core/src` finds none), and adding one would change `ParseResult`, which every consumer depends on. Deprecations are instead computed from the finished registry:

```ts
export type SchemaDeprecation = {
  source_file: string
  type_name: string
  field_name: string
  message: string
}
export function findSchemaDeprecations(registry: SchemaRegistry): SchemaDeprecation[]
```

It returns one entry per `reference` field with `rel: 'one-to-many'`, across content, taxonomy and paragraph types. The message:

> `<type_name>.<field_name>` uses `one-to-many`, which is deprecated for references. It holds a single item, the same as `one-to-one`. Use `one-to-one` for a single item, or `many-to-many` for a list.

`manguito validate`, `build` and `dev` print each deprecation as a warning after the registry is built. *(Corrected during planning: they do not share `loadWorkingRegistry`, which only `version.ts` uses. Each calls `buildSchemaRegistry` itself: `runValidate` in `validate.ts`, `build.ts`, and `parseAllSchemas` in `dev.ts`. A shared helper, `printSchemaDeprecations`, prints at each of those three sites through the existing `printWarning`.)* A warning never changes the command's exit code.

### Unchanged

The parser still accepts `one-to-many` on references (`RawReferenceFieldSchema` in `packages/core/src/parser/validators.ts`). A deprecated reference is stored exactly as today: one column of the same type. `max` on a one-to-one paragraph stays allowed and produces no warning.

## Section 2 — The API

### Reading

- **The relation map records cardinality.** `buildRelationsMap` adds `cardinality: Cardinality` to `ParagraphRelationDef`, taken from `relationCardinality`.
- **`resolveRelationField`.** For a `'one'` paragraph, it sets the field to the single row, or `null` when there is none, instead of `[row]`. References are unchanged: they already resolve in place to a single object.
- **`resolveRelationBareIds`.** For a `'one'` paragraph, it sets the field to the single id, or `null`, instead of `[id]`.
- **The admin edit read.** `loadParagraphRows` in `packages/api/src/routes/admin/content.ts`, and the code that assigns its result, return the single row or `null` for a `'one'` paragraph field, at both nesting levels allowed by [ADR core/0005](../../adr/core/0005-paragraph-nesting-one-level.md).
- **GraphQL.** `buildGraphQLSchema` takes list-ness from `relationCardinality`. A `'one'` paragraph is a nullable object type, not a list; a deprecated `one-to-many` reference is a nullable single object. The GraphQL dataloaders resolve through `resolveRelationField`, so their values change with it.
- **Codegen.** `fieldToZodSchema` takes list-ness from `relationCardinality`. This also fixes it typing `many-to-many` as a single uuid.

### Writing

The admin create, update and patch routes for content and taxonomy validate every relation field present in the body before any database write:

| Cardinality | `field_type` | Accepted | Anything else |
|---|---|---|---|
| `'one'` | `paragraph` | a plain object, or `null` | 422 `VALIDATION_ERROR` |
| `'many'` | `paragraph` | an array of plain objects | 422 `VALIDATION_ERROR` |
| `'one'` | `reference` | a string, or `null` | 422 `VALIDATION_ERROR` |
| `'many'` | `reference` | an array of strings | 422 `VALIDATION_ERROR` |

- **Nested paragraph fields** inside paragraph items are validated the same way.
- **Error messages** name the field and the expected shape, e.g. "`blog_link` holds one item: send an object or null."
- **Normalising for the save code.** After validation, a `'one'` paragraph value becomes the array that `persistParagraphField` takes: `[object]`, or `[]` for `null`. Nested values inside `persistParagraphField` get the same normalisation; today it reads them with `Array.isArray(...) ? ... : []`, so a nested object is dropped there too.
- **A field absent from the body is not touched.** *(Corrected during planning: this is a fix, not today's behaviour.)* `writeExistingItem`, which serves PATCH and the singleton PUT, and the taxonomy PATCH route update only the column fields present in the body. But they call `persistParagraphField` for every paragraph field, and `persistJunctionField` for every many-to-many field, passing `[]` when the field is absent. So an update that leaves a paragraph or many-to-many field out erases it. The admin form always sends every field, which is why the UI never showed it. After this change, a paragraph or junction field absent from an update body is skipped, matching the column fields.
- **Inputs that change from accepted to 422:** `[id]` for a `'one'` reference, and `[object]` for a `'one'` paragraph.

## Section 3 — The admin panel

- **`ParagraphEmbed.vue`** takes its mode from `relationCardinality`:
  - **`'many'`:** unchanged. A list with add, remove and reorder.
  - **`'one'`:** a single item. When empty it shows an add button; when filled it shows that item's fields and a remove button, with no reordering and no second item. Its `update:modelValue` emits the item object or `null`, and never adds the `order` key the list mode adds.
- **`ReferenceSelect.vue`** replaces its `isMulti` rule (`relType.value !== 'one-to-one'`) with `relationCardinality(field) === 'many'`. A deprecated `one-to-many` reference becomes a single picker that emits a string or `null`.
- **`defaultForField` in `ContentFormView.vue`** returns `null` for `'one'` and `[]` for `'many'`, for paragraphs and references alike.
- **`useFormValidation.ts`** needs no code change. *(Corrected during planning, traced in `checkField`: its `isEmpty` treats `null` as empty, so `required` already fails for an empty `'one'` value, and `max_items` only checks arrays, so an object is never counted.)* Tests pin both behaviours.

The single-item editor reuses the existing paragraph item markup. There is no visual redesign.

## Section 4 — Deleting a referenced item, and internal errors

### The database rule

In the `reference` builder in `packages/core/src/registry/fieldTypeRegistry.ts`, a single-column reference gets `on_delete: raw.required ? 'RESTRICT' : 'SET NULL'` (today it is always `'SET NULL'`). `mapOnDelete` in `packages/db/src/codegen/index.ts` already maps `'RESTRICT'`. Many-to-many junction rows keep `onDelete: 'cascade'` on both sides, so deleting either item removes only the link.

Existing projects pick up the change through `manguito migrate`. **The plan must confirm, with a generated migration, that drizzle-kit emits a change when only `onDelete` differs.** If it does not, the plan must add the migration step itself.

### The API check

Before the admin delete routes for content and taxonomy (`app.delete` in `registerAdminContentRoutes`) delete an item, they collect every reference field in the registry that:

- belongs to a content, taxonomy or paragraph type;
- is `required`;
- has `relationCardinality === 'one'` and a storage column;
- targets the deleted item's type.

For each such field they count the rows whose column equals the item's id. If any count is above zero, the delete is refused:

- status **409**, code **`ITEM_IN_USE`** (added to `ErrorCode` in `packages/core/src/errors.ts` and to `ERROR_STATUS_MAP` in `packages/api/src/middleware/error.ts`);
- a message built from the schema labels, for example: "This item is still used by 3 items: 2 in Blog Post (Author), 1 in Card (Link target). Remove it from those first." A paragraph-type location names the paragraph type's label only, because a paragraph row records its parent only as `parent_type`. *(Example corrected during planning.)*

The `RESTRICT` constraint is the backstop for a use added between the check and the delete. A foreign-key violation raised by a delete (Postgres SQLSTATE `23503`) also becomes 409 `ITEM_IN_USE`, with the message "This item is still in use. Remove it from the items that use it first."

**Delete order.** *(Added during planning.)* Both delete routes currently clean up first: they delete the item's paragraph rows and decrement media reference counts, then call `repo.delete`. With `RESTRICT`, a refused delete would leave the item with its paragraphs gone and its media counts wrong. The API has no transactions (`grep -rn "transaction(" packages/api/src packages/db/src` finds none). So both routes change to: run the check, delete the item row (a `23503` here returns 409 with nothing else touched), then delete paragraph rows and apply the media delta. Paragraph rows have no FK back to their parent, so they can be removed after it.

The plan confirms that the admin's delete action shows the API's error message.

### Internal errors

`errorHandler` in `packages/api/src/middleware/error.ts` currently returns `err.message` for every error. After this change:

- an error whose `code` is not a key of `ERROR_STATUS_MAP`, or is `INTERNAL_ERROR`, returns `{ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }`. That covers an error with no code and a raw Postgres error whose `code` is an SQLSTATE such as `23503`, which today would be returned with its message;
- the full error still goes to `console.error`, as today;
- errors raised with a deliberate code keep their messages.

The plan searches `packages/api/src` for any other path that sends a raw caught error's message to a client, and routes it through the same rule.

## Section 5 — Testing, docs, release

### Tests

Every test states the wrong implementation it must fail against, and fails under it ([PLAN-QUALITY](../PLAN-QUALITY.md) rule 1). Integration tests run against real Postgres ([ADR 0003](../../adr/0003-real-postgres-integration-tests.md)).

- **Core (unit):**
  - `relationCardinality` returns the right value for each row of its table, and `null` for a non-relation field;
  - `findSchemaDeprecations` lists `one-to-many` references and nothing else;
  - the reference builder gives `'RESTRICT'` to a required single reference and `'SET NULL'` to an optional one.
- **API (integration):**
  - **`'one'` paragraph:**
    - an object saves and reads back as an object, `null` clears it, and an array gets a 422;
    - an update that omits the field keeps it, and an update with a wrong shape is refused without erasing the stored value;
    - the REST include read, the bare-id read, the admin read and the GraphQL field type are each asserted;
    - a nested `'one'` paragraph gets the same write and read checks.
  - **Deprecated `one-to-many` reference:** a string saves; `[a, b]` gets a 422; the read is a single object; the GraphQL field type is not a list.
  - **Required reference:**
    - deleting its target gives a 409 `ITEM_IN_USE` whose message names the referring type and field, and the target remains;
    - a `23503` raised at delete time gives 409 `ITEM_IN_USE`;
    - deleting the target of an optional reference clears the field.
  - **`errorHandler`:** an uncoded error responds with "Internal server error", and the original message appears nowhere in the response body.
- **Admin (unit):**
  - in `'one'` mode, `ParagraphEmbed` emits an object or `null`;
  - a deprecated `one-to-many` reference gets a single `ReferenceSelect`;
  - `defaultForField` gives `null` or `[]`;
  - validation applies `required` and `max_items` as in Section 3.
- **CLI:** `manguito validate` on a schema with a `one-to-many` reference prints the deprecation and exits 0.
- **Fixtures.** New fixture fields (a `'one'` paragraph, a required reference) are built through core's field registry rather than by hand ([PLAN-QUALITY](../PLAN-QUALITY.md) rule 4). `globalSetup.ts` generates the test tables from `testParsedSchema`, so new fixture fields need no separate migration work.

### Docs

- **`docs/schema-authoring.md`**, relations section:
  - the one-or-list table;
  - the `one-to-many` deprecation;
  - what deleting a referenced item does for optional and required references, and for many-to-many links.
- **New ADR `docs/adr/core/0008-one-rule-for-relation-cardinality.md`.** It records:
  - that every layer must call `relationCardinality`;
  - the `one-to-many` deprecation and why it maps to `'one'`;
  - the `RESTRICT` rule for required references.
- **`packages/core/CONTEXT.md`** gains a *Cardinality* entry.
- **`docs/graphql.md`** has no relation-shape examples (`grep -n "one-to-many\|one-to-one" docs/graphql.md` finds none), so it needs no change.

### Release

Changesets, each stating the breaking change in its text, shipped as minor bumps under 0.x:

| Package | Bump | What it says |
|---|---|---|
| `@bobbykim/manguito-cms-core` | minor | `relationCardinality`, `findSchemaDeprecations`; required references now restrict deletes |
| `@bobbykim/manguito-cms-api` | minor | `'one'` paragraphs are objects in REST and GraphQL; wrong relation shapes get 422; 409 `ITEM_IN_USE`; generic 500 message; run `manguito migrate` |
| `@bobbykim/manguito-cms-admin` | minor | the single-item paragraph editor and the single reference picker |
| `@bobbykim/manguito-cms-cli` | patch | prints schema deprecation warnings |
