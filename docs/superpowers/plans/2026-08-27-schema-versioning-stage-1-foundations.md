# Schema Versioning Stage 1 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple a field's public label (`ParsedField.name`) from its storage identity (`ParsedField.db_column.column_name`) throughout the api package, so a later stage can rename a field's label without touching stored data — while producing zero change in externally observable behavior.

**Architecture:** Two explicit mapping boundaries. Inbound, a request body arrives label-keyed and is normalized to storage keys once at the top of each write handler. Outbound, a DB row arrives storage-keyed and is mapped to labels once at each serialization point. Everything between the boundaries is storage-keyed. A single `field-keys.ts` module owns both directions and is built once per content type at startup.

**Tech Stack:** TypeScript strict mode, Node 22+, Hono, Drizzle ORM + Postgres, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-27-schema-versioning-design.md](../specs/2026-08-27-schema-versioning-design.md)

## Global Constraints

- **Branch:** work on `docs/schema-versioning-design`. Never commit to `master`.
- **No behavior change.** Every existing test must pass unchanged at every commit. This stage ships no user-visible feature.
- **Renames are restricted to column-backed fields.** Paragraph fields (`db_column === null`) and many-to-many reference fields (`db_column.column_name === ''`, identity in the junction table name) are out of scope for label/storage divergence. Their identity stays the field name. Do not modify `parent_field` semantics or junction table naming.
- **Layer boundaries:** core imports nothing from db/api/admin/cli; db imports only core; api imports core and db. Do not add dependencies to core.
- **Commit messages:** conventional commits, `type(scope): subject`. Scopes in use: `api`, `core`, `db`, `cli`, `admin`.
- **No new dependencies** in any package.
- **Internal failures use `Result`**; startup misconfiguration throws (matching `createCmsApp`'s roles-registry and resolver-binding checks).
- **HTTP responses always use the `{ ok, data }` / `{ ok, error: { code, message } }` envelope.**
- **TypeScript only.** No JavaScript files.
- Test imports omit the file extension (`from '../content'`); source imports include `.js`.
- **Running tests:** use `pnpm --filter @bobbykim/manguito-cms-api test [relative/path] [-t 'name']`. The package's `test` script is `dotenv -e .env.test -- vitest run`; calling `vitest` directly skips that wrapper, leaves `DB_URL` unset, and `globalSetup` then aborts the whole run with a misleading "DB_URL not set" message. Paths are relative to `packages/api/`.
- **Postgres must be running:** `pnpm db:test:up` (already started for this session). Baseline before any change: **39 test files, 258 tests passing.**

## File Structure

| File | Responsibility |
|---|---|
| `packages/api/src/field-keys.ts` | **New.** Owns label↔storage mapping. Factory built once per content type; throws on key collision at construction. |
| `packages/api/src/field-keys.test-fixtures.ts` | **New.** Shared divergent-field fixtures so every task's tests exercise `label !== column`. |
| `packages/api/src/media-references.ts` | Media delta computation moves to storage keys. |
| `packages/api/src/relations.ts` | Relation resolution deletes the storage key when it differs from the label. |
| `packages/api/src/routes/admin/content.ts` | Inbound normalization on writes; outbound mapping on reads. |
| `packages/api/src/routes/content.ts` | Outbound mapping on public reads. |
| `packages/api/src/routes/media.ts` | Gains a base-path argument (Task 8). |
| `packages/api/src/routes/query-params.ts` | Filter/sort field names map label→column. |
| `packages/api/src/graphql/resolvers.ts` | Field resolution reads by column name. |
| `packages/api/src/paths.ts` | **New.** Centralized public route path construction honoring `api.prefix`. |
| `packages/api/src/app.ts` | Builds the field-key maps at startup; passes base paths to registrators. |

Ten tasks. Tasks 1–7 are the decoupling; Task 8 is the `api.prefix` fix; Task 9 is the end-to-end proof; Task 10 is documentation.

**Already audited, no change required:** `packages/api/src/repositories/content.ts` builds its SQL from the keys of the data and filter objects handed to it and never reads `field.name`, so it is correct under divergence as long as callers pass storage keys — which Tasks 3 and 6 ensure. Do not modify it. Likewise `packages/db` needs no change: codegen already uses `f.db_column!.column_name` as the Drizzle property key, so rows are already storage-keyed.

---

### Task 1: Field key mapping module

**Files:**
- Create: `packages/api/src/field-keys.ts`
- Create: `packages/api/src/field-keys.test-fixtures.ts`
- Test: `packages/api/src/__tests__/field-keys.test.ts`

**Interfaces:**
- Consumes: `ParsedField` from `@bobbykim/manguito-cms-core`.
- Produces:
  - `isColumnBacked(field: ParsedField): boolean`
  - `createFieldKeyMap(fields: ParsedField[]): FieldKeyMap`
  - `type FieldKeyMap = { toStorage(input: Record<string, unknown>): Record<string, unknown>; toLabels(row: Record<string, unknown>): Record<string, unknown>; columnFor(label: string): string | undefined; labelFor(column: string): string | undefined; labels: string[]; diverges: boolean }`
  - Fixtures: `divergentTextField`, `divergentMediaField`, `identityTextField`, `paragraphField`, `manyToManyField`

- [ ] **Step 1: Write the shared fixtures**

Create `packages/api/src/field-keys.test-fixtures.ts`:

```ts
import type { ParsedField } from '@bobbykim/manguito-cms-core'

// A field whose public label differs from its storage column — the case this
// whole stage exists to support. Stage 2 produces these by folding a rename
// chain; here they are hand-built, which is legitimate because parser output is
// plain serializable objects (ADR core/0002).
// NOTE: `ParsedField` carries `required`, `nullable` and `order` alongside
// `validation` — see the BLOG_TYPE fixture in
// packages/api/src/routes/__tests__/content.test.ts for the authoritative shape.
// Keep these fixtures fully typed (no `as ParsedField` cast) so a shape drift
// fails the build rather than a test.
export const divergentTextField: ParsedField = {
  name: 'title',
  label: 'Title',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 0,
  validation: { required: false },
  db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

export const divergentMediaField: ParsedField = {
  name: 'hero',
  label: 'Hero',
  field_type: 'image',
  required: false,
  nullable: true,
  order: 1,
  validation: { required: false },
  db_column: { column_name: 'blog_hero_image', column_type: 'uuid', nullable: true },
  ui_component: { component: 'file-upload', accepted_mime_types: [] },
}

export const identityTextField: ParsedField = {
  name: 'summary',
  label: 'Summary',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 2,
  validation: { required: false },
  db_column: { column_name: 'summary', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

export const paragraphField: ParsedField = {
  name: 'cards',
  label: 'Cards',
  field_type: 'paragraph',
  required: false,
  nullable: true,
  order: 3,
  validation: { required: false },
  db_column: null,
  ui_component: { component: 'paragraph-embed', ref: 'paragraph--photo_card', rel: 'one-to-many' },
}

export const manyToManyField: ParsedField = {
  name: 'tags',
  label: 'Tags',
  field_type: 'reference',
  required: false,
  nullable: true,
  order: 4,
  validation: { required: false },
  db_column: {
    column_name: '',
    column_type: 'uuid',
    nullable: true,
    junction: {
      table_name: 'junction_content_blog_post_tags',
      left_column: 'left_id',
      right_column: 'right_id',
      right_table: 'taxonomy_tag',
      order_column: false,
    },
  },
  ui_component: { component: 'typeahead-select', ref: 'taxonomy--tag', rel: 'many-to-many' },
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/api/src/__tests__/field-keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createFieldKeyMap, isColumnBacked } from '../field-keys'
import {
  divergentTextField,
  divergentMediaField,
  identityTextField,
  paragraphField,
  manyToManyField,
} from '../field-keys.test-fixtures'

const FIELDS = [
  divergentTextField,
  divergentMediaField,
  identityTextField,
  paragraphField,
  manyToManyField,
]

describe('isColumnBacked', () => {
  it('accepts a field with a real column', () => {
    expect(isColumnBacked(divergentTextField)).toBe(true)
  })

  it('rejects a paragraph field (no column)', () => {
    expect(isColumnBacked(paragraphField)).toBe(false)
  })

  it('rejects a many-to-many reference (junction owns the association)', () => {
    expect(isColumnBacked(manyToManyField)).toBe(false)
  })
})

describe('createFieldKeyMap', () => {
  it('maps a label to its column and back', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.columnFor('title')).toBe('blog_title')
    expect(m.labelFor('blog_title')).toBe('title')
  })

  it('reports divergence so callers can skip work when there is none', () => {
    expect(createFieldKeyMap(FIELDS).diverges).toBe(true)
    expect(createFieldKeyMap([identityTextField]).diverges).toBe(false)
  })

  it('lists labels for column-backed fields only', () => {
    expect(createFieldKeyMap(FIELDS).labels.sort()).toEqual(['hero', 'summary', 'title'])
  })

  it('converts a label-keyed body to storage keys', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toStorage({ title: 'Hi', hero: 'media-1', summary: 'S' })).toEqual({
      blog_title: 'Hi',
      blog_hero_image: 'media-1',
      summary: 'S',
    })
  })

  it('converts a storage-keyed row to labels', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toLabels({ blog_title: 'Hi', blog_hero_image: 'media-1', summary: 'S' })).toEqual({
      title: 'Hi',
      hero: 'media-1',
      summary: 'S',
    })
  })

  it('passes system fields and paragraph labels through untouched', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toLabels({ id: 'x', slug: 's', published: true, cards: [], tags: [] })).toEqual({
      id: 'x',
      slug: 's',
      published: true,
      cards: [],
      tags: [],
    })
  })

  it('preserves an explicit null rather than dropping the key', () => {
    const m = createFieldKeyMap(FIELDS)
    expect(m.toStorage({ title: null })).toEqual({ blog_title: null })
  })

  it('throws when a label collides with another field’s column name', () => {
    const collidingLabel: ParsedField = {
      ...identityTextField,
      name: 'blog_title',
      db_column: { column_name: 'other_col', column_type: 'varchar', nullable: true },
    } as ParsedField
    expect(() => createFieldKeyMap([divergentTextField, collidingLabel])).toThrow(
      /collides/i
    )
  })
})
```

Add the missing type import at the top of the test file:

```ts
import type { ParsedField } from '@bobbykim/manguito-cms-core'
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/field-keys.test.ts`
Expected: FAIL — `Failed to resolve import "../field-keys"`.

- [ ] **Step 4: Write the implementation**

Create `packages/api/src/field-keys.ts`:

```ts
import type { ParsedField } from '@bobbykim/manguito-cms-core'

// ─── Label ↔ storage key mapping ──────────────────────────────────────────────
//
// A field has two names: its public LABEL (`field.name`, what API consumers and
// the admin panel see) and its STORAGE key (`db_column.column_name`, the actual
// Postgres column). They are identical today, but schema versioning makes a
// rename change only the label — the column keeps its original name for the life
// of the data. Every place that reads or writes a DB row must therefore use the
// storage key, and every place that reads a request body or writes a response
// must use the label.
//
// Only column-backed fields participate. Paragraph fields have no column
// (their association lives on the paragraph table via parent_field) and
// many-to-many references have no column either (the junction table owns the
// association), so both keep the field name as their identity and are excluded.

export function isColumnBacked(field: ParsedField): boolean {
  const col = field.db_column
  if (col === null) return false
  if (col.column_name === '') return false
  if (col.junction) return false
  return true
}

export type FieldKeyMap = {
  /** Request body (label-keyed) → storage-keyed. Unknown keys pass through. */
  toStorage(input: Record<string, unknown>): Record<string, unknown>
  /** DB row (storage-keyed) → label-keyed. Unknown keys pass through. */
  toLabels(row: Record<string, unknown>): Record<string, unknown>
  columnFor(label: string): string | undefined
  labelFor(column: string): string | undefined
  /** Labels of column-backed fields — the valid filter/sort surface. */
  labels: string[]
  /** False when every label equals its column, letting callers skip the copy. */
  diverges: boolean
}

/**
 * Built ONCE per content type at startup, not per request. Throws on a key
 * collision, matching how createCmsApp refuses to boot on a broken roles
 * registry: an ambiguous mapping would silently corrupt responses.
 */
export function createFieldKeyMap(fields: ParsedField[]): FieldKeyMap {
  const labelToColumn = new Map<string, string>()
  const columnToLabel = new Map<string, string>()

  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    labelToColumn.set(f.name, f.db_column!.column_name)
    columnToLabel.set(f.db_column!.column_name, f.name)
  }

  // A label that is also some OTHER field's column name would make toLabels
  // ambiguous: two source keys would map onto one destination key.
  for (const label of labelToColumn.keys()) {
    const columnOwner = columnToLabel.get(label)
    if (columnOwner !== undefined && columnOwner !== label) {
      throw new Error(
        `✗ Field label "${label}" is also the storage column of field "${columnOwner}". ` +
          `A field label may not reuse another field's column name.`
      )
    }
  }

  const diverges = [...labelToColumn].some(([label, column]) => label !== column)

  function remap(
    input: Record<string, unknown>,
    lookup: Map<string, string>
  ): Record<string, unknown> {
    // Always returns a NEW object, even when nothing diverges. Returning `input`
    // unchanged would make aliasing depend on the schema, so a bug where a
    // caller mutates a row after mapping would reproduce only on renamed
    // fields. A shallow copy per row is not worth that class of bug.
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(input)) {
      out[lookup.get(key) ?? key] = input[key]
    }
    return out
  }

  return {
    toStorage: (input) => remap(input, labelToColumn),
    toLabels: (row) => remap(row, columnToLabel),
    columnFor: (label) => labelToColumn.get(label),
    labelFor: (column) => columnToLabel.get(column),
    labels: [...labelToColumn.keys()],
    diverges,
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/field-keys.test.ts`
Expected: PASS — all cases.

- [ ] **Step 6: Run the whole api suite to confirm nothing regressed**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS. Nothing imports the new module yet.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/field-keys.ts packages/api/src/field-keys.test-fixtures.ts packages/api/src/__tests__/field-keys.test.ts
git commit -m "feat(api): add label-to-storage field key mapping"
```

---

### Task 2: Media reference tracking operates on storage keys

**Files:**
- Modify: `packages/api/src/media-references.ts:31-52` (`topLevelMediaDelta`)
- Modify: `packages/api/src/routes/admin/content.ts` (call sites at lines ~460, ~608, ~682, ~833, ~913)
- Test: `packages/api/src/__tests__/media-references.test.ts` — **this file already exists** with a `describe('topLevelMediaDelta')` block plus `mergeMediaDeltas` and `applyMediaReferenceDelta` blocks. APPEND a new describe block; do not overwrite the file or edit the existing cases. Its existing `coverField` / `bannerField` fixtures already set `db_column.column_name` equal to `name`, so they keep passing after this change.

**Interfaces:**
- Consumes: `createFieldKeyMap` from Task 1.
- Produces: `topLevelMediaDelta(mediaFields, before, after)` where **both** `before` and `after` are storage-keyed. Signature is unchanged; the contract is narrowed.

**Why this task exists:** `topLevelMediaDelta` is currently called with mixed key spaces — on update, `before` is a DB row (storage-keyed) and `after` is the request body (label-keyed). They coincide today. Under divergence the comparison breaks and the `f.name in after` guard misfires, silently corrupting `media.reference_count`.

- [ ] **Step 1: Write the failing test**

Append to the existing `packages/api/src/__tests__/media-references.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { topLevelMediaDelta } from '../media-references'
import { divergentMediaField } from '../field-keys.test-fixtures'

const MEDIA_FIELDS = [divergentMediaField] // label 'hero', column 'blog_hero_image'

describe('topLevelMediaDelta with a divergent media field', () => {
  it('reads the storage key on create', () => {
    const delta = topLevelMediaDelta(MEDIA_FIELDS, null, { blog_hero_image: 'm1' })
    expect(delta).toEqual({ added: ['m1'], removed: [] })
  })

  it('detects a swap between two storage-keyed states', () => {
    const delta = topLevelMediaDelta(
      MEDIA_FIELDS,
      { blog_hero_image: 'm1' },
      { blog_hero_image: 'm2' }
    )
    expect(delta).toEqual({ added: ['m2'], removed: ['m1'] })
  })

  it('treats a field absent from a partial patch as untouched', () => {
    const delta = topLevelMediaDelta(MEDIA_FIELDS, { blog_hero_image: 'm1' }, { other: 'x' })
    expect(delta).toEqual({ added: [], removed: [] })
  })

  it('removes every id on delete', () => {
    const delta = topLevelMediaDelta(MEDIA_FIELDS, { blog_hero_image: 'm1' }, null)
    expect(delta).toEqual({ added: [], removed: ['m1'] })
  })

  it('ignores the label key entirely', () => {
    const delta = topLevelMediaDelta(MEDIA_FIELDS, null, { hero: 'm1' })
    expect(delta).toEqual({ added: [], removed: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/media-references.test.ts`
Expected: FAIL — the first test yields `{ added: [], removed: [] }` because the implementation reads `after['hero']`, not `after['blog_hero_image']`.

- [ ] **Step 3: Change the implementation to storage keys**

In `packages/api/src/media-references.ts`, replace the body of the `for` loop in `topLevelMediaDelta`:

```ts
  for (const f of mediaFields) {
    // Media fields are always column-backed, so the storage key always exists.
    const key = f.db_column?.column_name
    if (key === undefined || key === '') continue

    // On a partial update, a media field not present in the patch is untouched.
    // (after === null is a delete — every field is in scope.)
    if (after !== null && !(key in after)) continue

    const oldId = before ? extractMediaId(before[key]) : null
    const newId = after ? extractMediaId(after[key]) : null
    if (newId === oldId) continue
    if (oldId) removed.push(oldId)
    if (newId) added.push(newId)
  }
```

Update the doc comment above the function so the contract is explicit:

```ts
// Media ids gained and lost between two content states for the top-level media
// fields. BOTH `before` and `after` are STORAGE-KEYED (column names), never
// label-keyed — callers normalize a request body with FieldKeyMap.toStorage
// before calling. Unifies all three writes:
//   create — before = null            (no prior ids; set fields are added)
//   update — before/after are rows     (a field absent from `after` is untouched)
//   delete — after = null              (every current id is removed)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/media-references.test.ts`
Expected: PASS.

- [ ] **Step 5: Normalize the request body at each write call site**

In `packages/api/src/routes/admin/content.ts`, each of the five `topLevelMediaDelta` call sites passes `body` as `after`. `body` is label-keyed, so it must be converted first. Immediately after `body` is parsed in each handler, add:

```ts
        // Inbound boundary: the request body arrives label-keyed; everything
        // downstream (insert data, media delta) works in storage keys.
        const storageBody = fieldKeys.toStorage(body as Record<string, unknown>)
```

Then change the delta calls to use it:

```ts
        const mediaDeltas: MediaDelta[] = [topLevelMediaDelta(mediaFields, null, storageBody)]
```

```ts
        const mediaDeltas: MediaDelta[] = [
          topLevelMediaDelta(mediaFields, existing as Record<string, unknown>, storageBody),
        ]
```

The delete call sites (`topLevelMediaDelta(mediaFields, item as Record<string, unknown>, null)`) already pass a DB row and need no change.

`fieldKeys` is the per-content-type `FieldKeyMap`. Thread it into `registerAdminContentRoutes` as a new parameter:

The CURRENT signature (verified) is:

```ts
export function registerAdminContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  mediaRepo: MediaRepository,
  requirePermission: ReturnType<typeof createPermissionMiddleware>,
  db?: DrizzlePostgresInstance,
): void
```

`db` is OPTIONAL, so the new required parameter goes before it. Target:

```ts
export function registerAdminContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  fieldKeyMaps: Record<string, FieldKeyMap>,
  mediaRepo: MediaRepository,
  requirePermission: ReturnType<typeof createPermissionMiddleware>,
  db?: DrizzlePostgresInstance,
): void
```

Update the single call site at `packages/api/src/app.ts:325`.

and inside each handler, resolve it for the current type:

```ts
      const fieldKeys = fieldKeyMaps[typeName]!
```

- [ ] **Step 6: Build the maps at startup and pass them in**

In `packages/api/src/app.ts`, after the repositories are built, add:

```ts
  // ── Field key maps ──────────────────────────────────────────────────────────
  //
  // One per content/taxonomy type, built once at startup. Throws on a label /
  // column collision — the server must not boot with an ambiguous mapping.
  const fieldKeyMaps = Object.fromEntries([
    ...Object.entries(registry.content_types).map(([typeName, ct]) => [
      typeName,
      createFieldKeyMap((ct as ParsedContentType).fields),
    ]),
    ...Object.entries(registry.taxonomy_types).map(([typeName, tt]) => [
      typeName,
      createFieldKeyMap((tt as ParsedTaxonomyType).fields),
    ]),
  ])
```

Add the import:

```ts
import { createFieldKeyMap, type FieldKeyMap } from './field-keys.js'
```

and pass `fieldKeyMaps` to `registerAdminContentRoutes`.

- [ ] **Step 7: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS — existing tests are unaffected because labels still equal columns in every real schema.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/media-references.ts packages/api/src/routes/admin/content.ts packages/api/src/app.ts packages/api/src/__tests__/media-references.test.ts
git commit -m "fix(api): compute media deltas on storage keys, not labels"
```

---

### Task 3: Admin handlers take storage keys in and return labels out

**Files:**
- Modify: `packages/api/src/routes/admin/content.ts` (create/update handlers and the list/single read handlers, for content and taxonomy)
- Test: `packages/api/src/routes/__tests__/content.admin.test.ts`

**Interfaces:**
- Consumes: `FieldKeyMap`, `isColumnBacked` (Task 1) and the `storageBody` local (Task 2).
- Produces: no new exports. The payload handed to `ContentRepository` is storage-keyed; admin responses are label-keyed.

**Route paths (verified — do not guess):** admin content routes are mounted at `content/${typeName}`, i.e. `/admin/api/content/divergent-post`, NOT `/admin/api/divergent-post`. See the `basePath` assignment in `registerAdminContentRoutes`.

**Repository contract (verified — do not guess):** `ContentRepository` exposes `findMany`, `findOne`, `findBySlug`, `findAll`, `create`, `update`, `delete`. `findMany` resolves a `PaginatedResult<T>` shaped `{ ok, data, meta: { total, page, per_page, total_pages, has_next, has_prev } }`. `findAll` resolves a plain array. There is no `{ items, total }` shape anywhere.

- [ ] **Step 1: Add the divergent content type fixture**

In `packages/api/src/routes/__tests__/content.admin.test.ts`, next to the existing `BLOG_TYPE`:

```ts
import { divergentTextField } from '../../field-keys.test-fixtures'

// Same shape as BLOG_TYPE, but its single field's label ('title') differs from
// its storage column ('blog_title').
const DIVERGENT_TYPE: ParsedContentType = {
  ...BLOG_TYPE,
  name: 'divergent-post',
  default_base_path: 'divergent-post',
  fields: [divergentTextField],
  db: { table_name: 'content--divergent_post', junction_tables: [] },
  api: {
    default_base_path: 'divergent-post',
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: '/api/divergent-post/:slug',
  },
}
```

Register it in a registry alongside the existing types by copying how `mockRegistry` (or this file's equivalent) is assembled and adding `'divergent-post': DIVERGENT_TYPE` to `content_types`. Build the app exactly the way the sibling tests in this file already build it — same `registerAdminContentRoutes` call, same middleware doubles — adding the `fieldKeyMaps` argument from Task 2:

```ts
  { 'divergent-post': createFieldKeyMap([divergentTextField]) }
```

- [ ] **Step 2: Write the failing write test**

```ts
describe('admin writes with a divergent field label', () => {
  it('persists the storage column, not the label', async () => {
    const repo = makeMockRepo()
    ;(repo.create as ReturnType<typeof vi.fn>).mockImplementation(
      async (data: Record<string, unknown>) => ({ id: 'new-id', slug: 'a', published: false, ...data })
    )
    const app = buildDivergentAdminApp(repo)

    const res = await app.request('/admin/api/content/divergent-post', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'a', title: 'Hello' }),
    })

    expect(res.status).toBe(201)

    const passed = (repo.create as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>
    expect(passed).toMatchObject({ blog_title: 'Hello' })
    expect(passed).not.toHaveProperty('title')
  })
})
```

`buildDivergentAdminApp` is the local helper from Step 1.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.admin.test.ts -t 'persists the storage column'`
Expected: FAIL — the payload carries `title`, not `blog_title`.

- [ ] **Step 4: Build the write payload from storage keys**

In each create and update handler in `packages/api/src/routes/admin/content.ts`, the payload assembled for the repository currently reads `body[f.name]`. Build it from `storageBody` (Task 2) instead:

```ts
        // Storage-keyed payload. `storageBody` was normalized at the inbound
        // boundary, so each value is found under its column name.
        const columnBackedFields = fields.filter(isColumnBacked)
        const data: Record<string, unknown> = {}
        for (const f of columnBackedFields) {
          const key = f.db_column!.column_name
          if (!(key in storageBody)) continue
          data[key] = storageBody[key]
        }
```

Import:

```ts
import { isColumnBacked, type FieldKeyMap } from '../../field-keys.js'
```

Leave three things alone:
- **Paragraph and junction handling** keeps reading `body[f.name]` by label — paragraph and m2m identity *is* the field name (see Global Constraints).
- **Required-field validation** keeps reading the label-keyed `body`, so error messages name what the client sent.
- **Slug, published and other system fields** have no divergence; `toStorage` passes them through unchanged.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.admin.test.ts -t 'persists the storage column'`
Expected: PASS.

- [ ] **Step 6: Write the failing read test**

```ts
describe('admin reads with a divergent field label', () => {
  it('returns the label and never the column name', async () => {
    const repo = makeMockRepo()
    ;(repo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [{ id: 'c1', slug: 'a', published: true, blog_title: 'Hello' }],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    })
    const app = buildDivergentAdminApp(repo)

    const res = await app.request('/admin/api/content/divergent-post')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data[0]).toMatchObject({ slug: 'a', title: 'Hello' })
    expect(body.data[0]).not.toHaveProperty('blog_title')
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.admin.test.ts -t 'returns the label and never'`
Expected: FAIL — the response carries `blog_title`.

- [ ] **Step 8: Map rows to labels at each admin read**

In the admin list, single-item, create-response and update-response handlers, map immediately before the envelope — **after** paragraph and junction population, so those label-keyed additions survive:

```ts
        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const data = rows.map((row) => fieldKeys.toLabels(row as Record<string, unknown>))
```

For single-item responses:

```ts
        const data = fieldKeys.toLabels(row as Record<string, unknown>)
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.admin.test.ts -t 'returns the label and never'`
Expected: PASS.

- [ ] **Step 10: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS. Existing admin tests are unaffected: in every real schema the label equals the column, so `toLabels` is an identity remap.

- [ ] **Step 11: Commit**

```bash
git add packages/api/src/routes/admin/content.ts packages/api/src/routes/__tests__/content.admin.test.ts
git commit -m "feat(api): admin handlers take storage keys in, return labels out"
```

---

### Task 4: Relation resolution removes the storage key when it differs

**Files:**
- Modify: `packages/api/src/relations.ts:400-420` (`resolveRelationField`, media and reference branches)
- Test: `packages/api/src/__tests__/relations.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolveRelationField` unchanged in signature. New behavior: when the relation's `fk_column` differs from the label it resolves into, the raw FK key is deleted from the row.

**Why this task exists:** `resolveRelationField` reads `row[rel.fk_column]` and writes `row[fieldName]`. When those are equal (today) the write overwrites the FK — the behavior `app.ts` documents as *"overwrites a media field's column with the resolved media object"*. When they differ, both keys survive and the response leaks the raw column name alongside the resolved object.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/__tests__/relations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveRelationField } from '../relations'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// A db double that answers the single media SELECT resolveRelationField issues.
function mediaDb(rows: Record<string, unknown>[]): DrizzlePostgresInstance {
  return {
    execute: async () => ({ rows }),
  } as unknown as DrizzlePostgresInstance
}

describe('resolveRelationField with a divergent media field', () => {
  it('resolves into the label and drops the raw FK key', async () => {
    const rows = [{ id: 'c1', blog_hero_image: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({
      id: 'c1',
      hero: { id: 'm1', url: '/uploads/a.png' },
    })
    expect(rows[0]).not.toHaveProperty('blog_hero_image')
  })

  it('still overwrites in place when label and column are identical', async () => {
    const rows = [{ id: 'c1', hero: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'hero',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', hero: { id: 'm1', url: '/uploads/a.png' } })
  })

  it('nulls the label and drops the FK key when the FK is empty', async () => {
    const rows = [{ id: 'c1', blog_hero_image: '' }]
    const db = mediaDb([])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', hero: null })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/relations.test.ts`
Expected: FAIL — the first case still carries `blog_hero_image: 'm1'` alongside `hero`.

- [ ] **Step 3: Delete the storage key after resolving**

In `packages/api/src/relations.ts`, in the `rel.type === 'media'` branch of `resolveRelationField`, replace both row-writing loops:

```ts
  } else if (rel.type === 'media') {
    // When the field's label differs from its FK column (a renamed field), the
    // resolved object lands on the label and the raw FK key must be removed —
    // otherwise the response carries both the column name and the label.
    const dropFk = rel.fk_column !== fieldName

    const fkValues = rows.map((r) => r[rel.fk_column] as string).filter(Boolean)
    if (fkValues.length === 0) {
      for (const row of rows) {
        row[fieldName] = null
        if (dropFk) delete row[rel.fk_column]
      }
      return
    }
    const unique = [...new Set(fkValues)]
    const uncached = unique.filter((id) => !cache.has(`media:${id}`))
    if (uncached.length > 0) {
      const inList = sql.join(uncached.map((id) => sql`${id}`), sql`, `)
      const result = await db.execute(sql`SELECT * FROM "media" WHERE id IN (${inList})`)
      for (const item of result.rows as Record<string, unknown>[]) {
        cache.set(`media:${item['id']}`, item)
      }
    }
    for (const row of rows) {
      const fkVal = row[rel.fk_column] as string
      row[fieldName] = fkVal ? (cache.get(`media:${fkVal}`) ?? null) : null
      if (dropFk) delete row[rel.fk_column]
    }
  }
```

Apply the same `dropFk` treatment to the `rel.type === 'reference'` branch, which has the identical read-FK / write-label shape.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/relations.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS — `dropFk` is false in every existing schema, so behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/relations.ts packages/api/src/__tests__/relations.test.ts
git commit -m "fix(api): drop the raw FK key when a relation resolves into a different label"
```

---

### Task 5: Public read routes serialize to labels

**Files:**
- Modify: `packages/api/src/routes/content.ts` (list, single, taxonomy handlers)
- Test: `packages/api/src/routes/__tests__/content.test.ts`

**Interfaces:**
- Consumes: `FieldKeyMap` from Task 1, threaded through `registerPublicContentRoutes`.
- Produces: `registerPublicContentRoutes(app, registry, repos, fieldKeyMaps, listRateLimit, programmaticResolver)` — one new parameter, inserted after `repos`.

- [ ] **Step 1: Write the failing test**

In `packages/api/src/routes/__tests__/content.test.ts`, add the fixture and test. This file builds its app directly with `new Hono()` and `registerPublicContentRoutes`; follow that, do not introduce a builder helper.

```ts
import { divergentTextField } from '../../field-keys.test-fixtures'
import { createFieldKeyMap } from '../../field-keys'
import { createProgrammaticResolver } from '../../programmatic/resolve'

// Same shape as this file's BLOG_TYPE, with label 'title' over column 'blog_title'.
const DIVERGENT_TYPE: ParsedContentType = {
  ...BLOG_TYPE,
  name: 'divergent-post',
  default_base_path: 'divergent-post',
  fields: [divergentTextField],
  db: { table_name: 'content--divergent_post', junction_tables: [] },
  api: {
    default_base_path: 'divergent-post',
    http_methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    item_path: '/api/divergent-post/:slug',
  },
}

const divergentRegistry: SchemaRegistry = {
  ...mockRegistry,
  content_types: { 'divergent-post': DIVERGENT_TYPE },
}

describe('public reads with a divergent field label', () => {
  it('returns the label and never the column name', async () => {
    const repo = makeMockRepo()
    ;(repo.findMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      data: [{ id: 'c1', slug: 'a', published: true, blog_title: 'Hello' }],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    })

    const app = new Hono()
    registerPublicContentRoutes(
      app,
      divergentRegistry,
      { 'divergent-post': repo },
      { 'divergent-post': createFieldKeyMap([divergentTextField]) },
      undefined,
      createProgrammaticResolver(new Map())
    )

    const res = await app.request('/api/divergent-post')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data[0]).toMatchObject({ slug: 'a', title: 'Hello' })
    expect(body.data[0]).not.toHaveProperty('blog_title')
  })
})
```

> This call has no `paths` argument yet — Task 8 inserts one, and its Step 5 requires updating this call site along with the others.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.test.ts -t 'returns the label'`
Expected: FAIL — the response carries `blog_title`, not `title`.

- [ ] **Step 3: Map rows to labels at the serialization point**

In `packages/api/src/routes/content.ts`, add the parameter and map every row immediately before it enters the envelope:

```ts
export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: Record<string, ContentRepository<Record<string, unknown>>>,
  fieldKeyMaps: Record<string, FieldKeyMap>,
  listRateLimit: MiddlewareHandler | undefined,
  programmaticResolver: ProgrammaticResolver
) {
```

Import it:

```ts
import type { FieldKeyMap } from '../field-keys.js'
```

In the list handler, after relations and programmatic fields are resolved:

```ts
        // Outbound boundary: rows are storage-keyed; responses speak labels.
        const fieldKeys = fieldKeyMaps[typeName]!
        const data = result.items.map((row) => fieldKeys.toLabels(row as Record<string, unknown>))
```

and return `data` in the envelope instead of `result.items`. Apply the same one-line mapping in the single-item handler and both taxonomy handlers.

Order matters: map to labels **after** relation resolution and programmatic resolution, not before. Relation resolution reads FK columns (storage keys) and programmatic resolvers are bound by field name to the label surface — Task 4 already removes the stale FK key.

- [ ] **Step 4: Pass the maps in from app.ts**

In `packages/api/src/app.ts`:

```ts
  registerPublicContentRoutes(app, registry, publicRepos, fieldKeyMaps, listRateLimit, programmaticResolver)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/content.test.ts -t 'returns the label'`
Expected: PASS.

- [ ] **Step 6: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/content.ts packages/api/src/app.ts packages/api/src/routes/__tests__/content.test.ts
git commit -m "feat(api): serialize public read responses through field labels"
```

---

### Task 6: Filters and sorting accept labels, query columns

**Files:**
- Modify: `packages/api/src/routes/query-params.ts:37-69` (`parseFilters`)
- Modify: `packages/api/src/routes/content.ts` (list handlers that call `parseFilters`)
- Test: `packages/api/src/routes/__tests__/query-params.test.ts`

**Interfaces:**
- Consumes: `FieldKeyMap`.
- Produces: `parseFilters(query, validFields, columnFor?)` — one new optional third parameter, `(label: string) => string | undefined`. When supplied, returned filter keys are column names. Omitting it preserves today's behavior exactly.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/routes/__tests__/query-params.test.ts` (create the file with the standard header if it does not exist):

```ts
import { describe, it, expect } from 'vitest'
import { parseFilters } from '../query-params'

describe('parseFilters with a label-to-column mapper', () => {
  const validFields = new Set(['title'])
  const columnFor = (label: string) => (label === 'title' ? 'blog_title' : undefined)

  it('validates the label and returns the column', () => {
    const result = parseFilters({ 'filter[title]': 'Hello' }, validFields, columnFor)
    expect(result).toEqual({ ok: true, filters: { blog_title: 'Hello' } })
  })

  it('maps operator filters too', () => {
    const result = parseFilters({ 'filter[title][gt]': '5' }, validFields, columnFor)
    expect(result).toEqual({ ok: true, filters: { blog_title: { gt: '5' } } })
  })

  it('rejects a column name used as a filter key', () => {
    const result = parseFilters({ 'filter[blog_title]': 'Hello' }, validFields, columnFor)
    expect(result).toEqual({ ok: false, invalidField: 'blog_title' })
  })

  it('behaves as before when no mapper is supplied', () => {
    const result = parseFilters({ 'filter[title]': 'Hello' }, validFields)
    expect(result).toEqual({ ok: true, filters: { title: 'Hello' } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/query-params.test.ts`
Expected: FAIL — `parseFilters` takes two parameters, so the mapped cases return `title` keys.

- [ ] **Step 3: Add the optional mapper**

In `packages/api/src/routes/query-params.ts`:

```ts
export function parseFilters(
  query: Record<string, string>,
  validFields: Set<string>,
  columnFor?: (label: string) => string | undefined
): { ok: true; filters: Record<string, FilterValue> } | { ok: false; invalidField: string } {
  const filters: Record<string, FilterValue> = {}

  // Filters are validated against LABELS (what the client sends) and emitted as
  // storage keys (what the repository queries). Without a mapper the two are
  // the same, which is the pre-versioning behavior.
  const toKey = (label: string): string => columnFor?.(label) ?? label
```

Then in both match branches, keep validating `field` against `validFields` and use `toKey(field)` as the key written into `filters`:

```ts
    if (simpleMatch) {
      const field = simpleMatch[1]!
      if (!validFields.has(field)) return { ok: false, invalidField: field }
      const key = toKey(field)
      const existing = filters[key]
      if (existing !== undefined) {
        filters[key] = Array.isArray(existing)
          ? [...existing, value]
          : [existing as string, value]
      } else {
        filters[key] = value
      }
    } else if (opMatch) {
      const field = opMatch[1]!
      const operator = opMatch[2]!
      if (!validFields.has(field)) return { ok: false, invalidField: field }
      if (!['gt', 'gte', 'lt', 'lte'].includes(operator)) continue
      const key = toKey(field)
      const existing = (filters[key] as FilterOperator | undefined) ?? {}
      filters[key] = { ...(existing as FilterOperator), [operator]: value }
    }
```

Preserve the existing operator list exactly as the file already has it — do not reorder or add operators.

- [ ] **Step 4: Pass the mapper from the list handlers**

In `packages/api/src/routes/content.ts`, at each `parseFilters` call:

```ts
      const parsed = parseFilters(c.req.query(), validFields, fieldKeys.columnFor)
```

Sorting is restricted to indexed system fields (see the comment at the top of `query-params.ts`), and system fields have no label/column divergence, so sort handling needs no change. Do not widen it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/routes/__tests__/query-params.test.ts`
Expected: PASS — all four cases.

- [ ] **Step 6: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/query-params.ts packages/api/src/routes/content.ts packages/api/src/routes/__tests__/query-params.test.ts
git commit -m "feat(api): validate filters by label and query by column"
```

---

### Task 7: GraphQL resolves values by column name

**Files:**
- Modify: `packages/api/src/graphql/resolvers.ts`
- Test: `packages/api/src/graphql/__tests__/resolvers.divergence.test.ts`

**Interfaces:**
- Consumes: `isColumnBacked` from Task 1.
- Produces: no signature change. GraphQL field resolvers read the storage key from the row.

GraphQL type and field names derive from `field.name` via `graphql/naming.ts`, which is correct — the GraphQL surface exposes labels. Only the *value lookup* must change: a resolver currently reads `row[field.name]`, which under divergence is `undefined`.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/graphql/__tests__/resolvers.divergence.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { divergentTextField } from '../../field-keys.test-fixtures'
import { resolveFieldValue } from '../resolvers'

describe('GraphQL field value resolution with a divergent label', () => {
  it('reads the storage column, not the label', () => {
    const row = { id: 'c1', blog_title: 'Hello' }
    expect(resolveFieldValue(divergentTextField, row)).toBe('Hello')
  })

  it('returns null when the column is absent', () => {
    expect(resolveFieldValue(divergentTextField, { id: 'c1' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/graphql/__tests__/resolvers.divergence.test.ts`
Expected: FAIL — `resolveFieldValue` is not exported from `resolvers.ts`.

- [ ] **Step 3: Extract and correct the value lookup**

In `packages/api/src/graphql/resolvers.ts`, add an exported helper and route every scalar field resolver through it:

```ts
/**
 * A GraphQL field's value on a content row. The GraphQL field NAME comes from
 * the field's label (see naming.ts), but the value lives under its storage
 * column, which differs once a field has been renamed.
 */
export function resolveFieldValue(
  field: ParsedField,
  row: Record<string, unknown>
): unknown {
  const key = isColumnBacked(field) ? field.db_column!.column_name : field.name
  return row[key] ?? null
}
```

Import it:

```ts
import { isColumnBacked } from '../field-keys.js'
```

Then replace scalar reads of the shape `row[field.name]` in this file with `resolveFieldValue(field, row)`. Leave the dataloader relation paths alone: they already key off `db_column.column_name` for FK lookups.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/graphql/__tests__/resolvers.divergence.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix `translateFilters`, which emits labels where columns are required**

`packages/api/src/graphql/filters.ts:114` documents itself as returning a map
"keyed by snake_case column", but it produces `nameMap.toSchema(gqlField)` — the
schema **field name**, i.e. the label. That is correct only while labels equal
columns. Add a mapper parameter:

```ts
export function translateFilters(
  input: Record<string, unknown> | undefined,
  nameMap: { toSchema(g: string): string },
  columnFor?: (label: string) => string | undefined
): Record<string, FilterValue> {
```

and derive the key from it, leaving every operator branch otherwise untouched:

```ts
    const label = nameMap.toSchema(gqlField)
    const column = columnFor?.(label) ?? label
```

Then replace the three `out[column] = ...` assignments' key with this `column`
binding (the local was previously named `column` but held a label — the rename
is the fix, so re-read each assignment rather than assuming).

At the call site in `packages/api/src/graphql/resolvers.ts:91`:

```ts
      filters: translateFilters(args.filter, nameMap, fieldKeys.columnFor),
```

**Where `fieldKeys` comes from (controller ruling):** the GraphQL module has no field-key maps today. Thread them in the same way the repositories are threaded — add a `fieldKeyMaps: Record<string, FieldKeyMap>` parameter to `createGraphQLHandler` in `packages/api/src/graphql/handler.ts`, pass the `fieldKeyMaps` built in `app.ts` at the dynamic-import call site, and resolve `fieldKeyMaps[typeName]` inside the resolver where `nameMap` is already resolved per type. Do not rebuild maps per request.

Add a test to `packages/api/src/graphql/__tests__/filters.test.ts`:

```ts
it('emits the storage column, not the label', () => {
  const nameMap = { toSchema: (g: string) => (g === 'title' ? 'title' : g) }
  const columnFor = (label: string) => (label === 'title' ? 'blog_title' : undefined)
  const out = translateFilters({ title: { eq: 'Hello' } }, nameMap, columnFor)
  expect(out).toEqual({ blog_title: 'Hello' })
})
```

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/graphql/__tests__/filters.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full graphql and api suites**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS — all existing GraphQL tests included.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/graphql/resolvers.ts packages/api/src/graphql/filters.ts packages/api/src/graphql/__tests__/resolvers.divergence.test.ts packages/api/src/graphql/__tests__/filters.test.ts
git commit -m "fix(api): resolve GraphQL values and filters by storage column"
```

---

### Task 8: Centralize public route paths and honor `api.prefix`

**Files:**
- Create: `packages/api/src/paths.ts`
- Modify: `packages/api/src/routes/content.ts`, `packages/api/src/routes/media.ts`, `packages/api/src/app.ts`
- Test: `packages/api/src/__tests__/paths.test.ts`

**Interfaces:**
- Produces:
  - `normalizePrefix(prefix: string | undefined): string` — returns a leading-slash, no-trailing-slash prefix; defaults to `/api`.
  - `createPublicPaths(prefix: string): PublicPaths`
  - `type PublicPaths = { collection(basePath: string): string; item(basePath: string): string; taxonomyCollection(typeName: string): string; taxonomyItem(typeName: string): string; mediaCollection(): string; mediaItem(): string; openapi(): string }`

**Why this task exists:** `api.prefix` is configurable, threaded through the CLI, and injected into the admin build as `__API_PREFIX__`, but the public registrators hardcode `/api/...` and `__API_PREFIX__` is only declared in `packages/admin/src/env.d.ts`, never read — so the option does not affect routing. Stage 2 adds a version segment to these same paths, so one place must own path construction.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/__tests__/paths.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createPublicPaths, normalizePrefix } from '../paths'

describe('normalizePrefix', () => {
  it('defaults to /api', () => {
    expect(normalizePrefix(undefined)).toBe('/api')
  })

  it('adds a leading slash', () => {
    expect(normalizePrefix('content')).toBe('/content')
  })

  it('strips a trailing slash', () => {
    expect(normalizePrefix('/content/')).toBe('/content')
  })

  it('collapses a bare slash to the default', () => {
    expect(normalizePrefix('/')).toBe('/api')
  })
})

describe('createPublicPaths', () => {
  const p = createPublicPaths('/api')

  it('builds collection and item paths', () => {
    expect(p.collection('blog')).toBe('/api/blog')
    expect(p.item('blog')).toBe('/api/blog/:slug')
  })

  it('builds taxonomy paths', () => {
    expect(p.taxonomyCollection('tag')).toBe('/api/taxonomy/tag')
    expect(p.taxonomyItem('tag')).toBe('/api/taxonomy/tag/:id')
  })

  it('builds media and openapi paths', () => {
    expect(p.mediaCollection()).toBe('/api/media')
    expect(p.mediaItem()).toBe('/api/media/:id')
    expect(p.openapi()).toBe('/api/openapi.json')
  })

  it('honors a custom prefix', () => {
    const c = createPublicPaths('/content-api')
    expect(c.collection('blog')).toBe('/content-api/blog')
    expect(c.mediaItem()).toBe('/content-api/media/:id')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/paths.test.ts`
Expected: FAIL — `Failed to resolve import "../paths"`.

- [ ] **Step 3: Write the implementation**

Create `packages/api/src/paths.ts`:

```ts
// ─── Public route path construction ───────────────────────────────────────────
//
// The single place public route paths are built. Registrators must not hardcode
// '/api/...': the prefix is configurable (api.prefix) and Stage 2 inserts a
// version segment here.

export function normalizePrefix(prefix: string | undefined): string {
  if (prefix === undefined) return '/api'
  const withSlash = prefix.startsWith('/') ? prefix : `/${prefix}`
  const trimmed = withSlash.replace(/\/+$/, '')
  return trimmed === '' ? '/api' : trimmed
}

export type PublicPaths = {
  collection(basePath: string): string
  item(basePath: string): string
  taxonomyCollection(typeName: string): string
  taxonomyItem(typeName: string): string
  mediaCollection(): string
  mediaItem(): string
  openapi(): string
}

export function createPublicPaths(prefix: string): PublicPaths {
  return {
    collection: (basePath) => `${prefix}/${basePath}`,
    item: (basePath) => `${prefix}/${basePath}/:slug`,
    taxonomyCollection: (typeName) => `${prefix}/taxonomy/${typeName}`,
    taxonomyItem: (typeName) => `${prefix}/taxonomy/${typeName}/:id`,
    mediaCollection: () => `${prefix}/media`,
    mediaItem: () => `${prefix}/media/:id`,
    openapi: () => `${prefix}/openapi.json`,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/paths.test.ts`
Expected: PASS — all cases.

- [ ] **Step 5: Route the registrators through it**

The final signatures after Tasks 5 and 8, which every call site must match exactly:

The CURRENT signature (verified) is:

```ts
export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,                 // = Record<string, ContentRepository<unknown>>
  listRateLimit?: MiddlewareHandler,
  resolver?: ProgrammaticResolver
): void
```

Note the last two are OPTIONAL and named `listRateLimit` / `resolver`. New required parameters must be inserted BEFORE them. The target signature after Tasks 5 and 8, which every call site must match:

```ts
export function registerPublicContentRoutes(
  app: Hono,
  registry: SchemaRegistry,
  repos: ContentRepos,
  fieldKeyMaps: Record<string, FieldKeyMap>,
  paths: PublicPaths,
  listRateLimit?: MiddlewareHandler,
  resolver?: ProgrammaticResolver
): void
```

Apply the same treatment to `registerPublicMediaRoutes`, inserting `paths: PublicPaths` before its optional rate-limit parameter and keeping its existing parameter names.

Replace every hardcoded template literal:

- `app.get(`/api/${basePath}`, ...)` → `app.get(paths.collection(basePath), ...)`
- `app.get(`/api/${basePath}/:slug`, ...)` → `app.get(paths.item(basePath), ...)`
- `app.get(`/api/taxonomy/${typeName}/:id`, ...)` → `app.get(paths.taxonomyItem(typeName), ...)`
- `app.get('/api/media', ...)` → `app.get(paths.mediaCollection(), ...)`
- `app.get('/api/media/:id', ...)` → `app.get(paths.mediaItem(), ...)`

In `packages/api/src/app.ts`, build it from the already-resolved prefix and pass it in:

```ts
  const prefix = normalizePrefix(options.prefix)
  const publicPaths = createPublicPaths(prefix)
```

Replace the existing `const prefix = options.prefix ?? '/api'` line. Move the OpenAPI route to `publicPaths.openapi()`, and build the `paths` object inside the spec handler from `publicPaths` too, so the documented paths match the served ones.

Leave `/admin/api/*` and `/graphql` alone: the admin prefix is a separate option and GraphQL is deliberately an absolute path outside the API prefix (see `packages/api/CONTEXT.md`).

- [ ] **Step 6: Add an integration test for a custom prefix**

Append to `packages/api/src/routes/__tests__/content.test.ts`:

Assert at the registrator level, not through `createCmsApp` — `createCmsApp` runs `buildRolesRegistry`, which refuses to boot on the empty `roles` array in this file's `mockRegistry`. Path construction is what is under test, so the router is the right seam:

```ts
it('serves public routes under a custom api.prefix', async () => {
  const repo = makeMockRepo()
  const app = new Hono()
  registerPublicContentRoutes(
    app,
    mockRegistry,
    { 'blog-post': repo },
    { 'blog-post': createFieldKeyMap(BLOG_TYPE.fields) },
    createPublicPaths('/content-api'),
    undefined,
    createProgrammaticResolver(new Map())
  )

  // BLOG_TYPE's default_base_path is 'blog-post'.
  expect((await app.request('/content-api/blog-post')).status).toBe(200)
  expect((await app.request('/api/blog-post')).status).toBe(404)
})
```

Add the import alongside the others already added in Task 5:

```ts
import { createPublicPaths } from '../../paths'
```

- [ ] **Step 7: Run the full api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test`
Expected: PASS. Existing tests all use the default prefix, so their paths are unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/paths.ts packages/api/src/app.ts packages/api/src/routes/content.ts packages/api/src/routes/media.ts packages/api/src/__tests__/paths.test.ts packages/api/src/routes/__tests__/content.test.ts
git commit -m "fix(api): centralize public route paths and honor api.prefix"
```

---

### Task 9: End-to-end divergence proof against real Postgres

**Files:**
- Create: `packages/api/src/__tests__/field-divergence.integration.test.ts` — integration tests live in `src/__tests__/` with the `.integration.test.ts` suffix in this repo, NOT in `routes/__tests__/`.

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: no exports. This task's deliverable is the proof that Stage 2 can rely on the decoupling.

This is the task that makes the whole stage meaningful: it drives a real Postgres table whose column is `blog_title` through a registry whose field label is `title`, and asserts the public and admin surfaces speak only labels while the database holds only columns. Follow the real-Postgres pattern in the existing integration tests (ADR 0003) and reuse this repo's `globalSetup.ts` database.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/__tests__/field-divergence.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { divergentTextField, divergentMediaField } from '../../field-keys.test-fixtures'

const TABLE = 'content_divergence_test'

describe('field label / storage column divergence, end to end', () => {
  beforeAll(async () => {
    // A table whose columns are the STORAGE names.
    await db.execute(
      sql.raw(`CREATE TABLE "${TABLE}" (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug varchar(255) NOT NULL UNIQUE,
        published boolean NOT NULL DEFAULT false,
        created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),
        blog_title varchar(255),
        blog_hero_image uuid
      )`)
    )
    await db.execute(
      sql.raw(`INSERT INTO "${TABLE}" (slug, published, blog_title)
               VALUES ('published-one', true, 'Hello'), ('draft-one', false, 'Draft')`)
    )
  })

  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}"`))
  })

  it('public list returns labels only', async () => {
    const res = await app.request('/api/divergence_test')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1) // published only
    expect(body.data[0].title).toBe('Hello')
    expect(body.data[0]).not.toHaveProperty('blog_title')
  })

  it('public single-item lookup returns labels only', async () => {
    const res = await app.request('/api/divergence_test/published-one')
    const body = await res.json()

    expect(body.data.title).toBe('Hello')
    expect(body.data).not.toHaveProperty('blog_title')
  })

  it('filtering by the label queries the column', async () => {
    const res = await app.request('/api/divergence_test?filter[title]=Hello')
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1)
  })

  it('filtering by the column name is rejected', async () => {
    const res = await app.request('/api/divergence_test?filter[blog_title]=Hello')

    expect(res.status).toBe(400)
    expect((await res.json()).ok).toBe(false)
  })

  it('an admin write persists the column and echoes the label', async () => {
    const res = await app.request('/admin/api/divergence_test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ slug: 'created-one', title: 'Created' }),
    })

    expect(res.status).toBe(201)
    expect((await res.json()).data.title).toBe('Created')

    // The database holds the column, and no 'title' column exists at all.
    const row = await db.execute(
      sql.raw(`SELECT blog_title FROM "${TABLE}" WHERE slug = 'created-one'`)
    )
    expect((row.rows[0] as { blog_title: string }).blog_title).toBe('Created')
  })
})
```

**Harness (verified pointers):** read `packages/api/src/__tests__/public.integration.test.ts` for the public-read pattern and `packages/api/src/__tests__/admin-write.integration.test.ts` for the authenticated-write pattern, and copy whichever setup they use. Shared DB helpers live in `packages/test-utils/src/db.ts`. This repo already runs integration tests against a real Postgres via `globalSetup.ts` (ADR 0003). Obtain `db` the same way the existing integration tests in `packages/api/src/routes/__tests__/` do, and build the app through `createCmsApp` so the whole wiring — field key maps, paths, middleware — is exercised rather than a hand-assembled router. Build the registry by spreading this file's content-type fixture the way `DIVERGENT_TYPE` does in Tasks 3 and 5, with `db.table_name` set to `content_divergence_test`, `default_base_path` set to `divergence_test`, and `fields` set to `[divergentTextField, divergentMediaField]`.

For `authHeaders`, use whatever the sibling admin integration test uses to authenticate (a signed `auth_token` cookie). Do not weaken auth for this test — if that setup is awkward to reuse, assert the admin case through `registerAdminContentRoutes` with the same permission doubles `content.admin.test.ts` uses, and keep the public assertions on the full `createCmsApp`.

- [ ] **Step 2: Run the test to verify it fails or passes for the right reason**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/field-divergence.integration.test.ts`
Expected: PASS if Tasks 1–8 are complete and correct. If any case fails, the failure localizes the gap:
- label leaking as `blog_title` → Task 5 (public serialization)
- filter by label returning 0 rows → Task 6 (filter mapping)
- admin write inserting a `title` column and erroring → Task 3 (write payload)
- media object appearing alongside `blog_hero_image` → Task 4 (FK cleanup)

- [ ] **Step 3: Run the entire repository test suite**

Run: `pnpm test`
Expected: PASS across all packages. This is the stage's exit criterion — no existing test may have been modified to accommodate the refactor.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/__tests__/field-divergence.integration.test.ts
git commit -m "test(api): prove label/storage divergence end to end"
```

---

### Task 10: Document the decoupling

**Files:**
- Modify: `packages/api/CONTEXT.md`
- Create: `docs/adr/api/0011-field-label-vs-storage-key.md`

**Interfaces:** none.

- [ ] **Step 1: Add the glossary entries**

In `packages/api/CONTEXT.md`, under a new `### Field identity` subsection after `### Data access`:

```markdown
### Field identity

**Label**:
A field's public name (`ParsedField.name`) — what API consumers, the admin panel, and GraphQL see. Mutable: a schema rename changes the label only.
_Avoid_: field name (when precision matters), key

**Storage key**:
A field's Postgres column (`db_column.column_name`). Immutable for the life of the data, so it is the field's identity across versions. Only column-backed fields have one — paragraph and many-to-many reference fields keep the label as their identity.
_Avoid_: column name (when referring to identity rather than SQL), db name

**Field key map**:
The per-content-type `FieldKeyMap` built once at startup that converts label-keyed request bodies to storage keys and storage-keyed rows back to labels. Throws on a label/column collision rather than booting ambiguous.
_Avoid_: field mapper, key translator
```

- [ ] **Step 2: Write the ADR**

Create `docs/adr/api/0011-field-label-vs-storage-key.md`:

```markdown
---
status: accepted
---

# A field's label and its storage key are separate; the storage key is immutable

`ParsedField.name` is a **label** — the public name consumers and the admin panel see. `db_column.column_name` is the **storage key** — the Postgres column, fixed for the life of the data. They are equal for every field a schema author has never renamed, and the parser still derives one from the other, but no code may assume equality. The api package converts at two boundaries: a request body is normalized to storage keys once per write handler, and a row is mapped to labels once per serialization point. Everything between is storage-keyed.

Only column-backed fields participate. Paragraph fields have no column (their association lives on the paragraph table via `parent_field`) and many-to-many references have none either (the junction table, whose name embeds the field name, owns the association). Both keep the label as their identity, so **renaming a paragraph or many-to-many field is not supported** — schema versioning rejects such a rename and directs the author to retire the older version first.

## Considered Options

- **Keep label and column identical; rename the column on a schema rename** — rejected: `drizzle-kit generate` cannot infer a rename from a schema diff and prompts interactively to distinguish rename from drop-plus-add. That is unusable in a non-interactive `manguito build`, and the drop-plus-add branch destroys exactly the data an older API version still serves.
- **A general `storage_key` on every field kind**, including paragraph and many-to-many — rejected for now: it requires changing `parent_field` semantics and junction table naming, both of which are persisted in existing databases. The narrower rule buys renameability for the fields authors actually rename.

## Consequences

- Relation resolution deletes the raw FK key from a row when it resolves into a different label; when they match it overwrites in place, as before.
- Filters are validated against labels and emitted as storage keys, so a client naming a raw column gets the existing 400.
- GraphQL field *names* still come from labels; only value lookup uses the storage key.
- `FieldKeyMap` construction throws on a label that collides with another field's column, matching the startup-throw treatment of a broken roles registry.
- Public route paths are built in one module (`paths.ts`), which also makes the previously non-functional `api.prefix` option work.
```

- [ ] **Step 3: Verify the ADR is linked from the context map**

Run: `grep -n "adr/api" CONTEXT-MAP.md`
Expected: the existing per-package ADR link covers the directory; no edit needed if it points at `docs/adr/api` rather than listing files.

- [ ] **Step 4: Commit**

```bash
git add packages/api/CONTEXT.md docs/adr/api/0011-field-label-vs-storage-key.md
git commit -m "docs(api): record label vs storage key decision"
```

---

## Stage 1 Exit Criteria

- [ ] `pnpm test` passes with **no existing test modified** to accommodate the refactor, with ONE authorized exception recorded below.

  **Authorized exception (controller ruling, Task 5):** `packages/api/src/__tests__/relations.read.integration.test.ts`'s test *"reference field bare id stays under the raw fk column"* is updated to assert the label instead. That test's fixture hand-writes a reference field with `name: 'category'` over `column_name: 'category_id'` — a divergence no parser-produced schema can reach, since `fieldTypeRegistry.ts:255-262` always sets `column_name = raw.name` for one-to-one/one-to-many references. The old assertion therefore characterized the exact column-name leak this stage exists to close, for an input real schemas cannot produce. No user-visible behavior changes. Every other assertion in that file is preserved.
- [ ] `pnpm build` succeeds in dependency order.
- [ ] The Task 9 integration test proves a `label !== column` registry works across public reads, filters, and admin writes.
- [ ] No file outside `packages/api` changed behavior, except documentation.
- [ ] `api.prefix` demonstrably routes.

## What Stage 2 Builds On This

Stage 2 (versioning proper) plugs into the two boundaries this stage created: `FieldKeyMap` generalizes into a per-version `VersionProjection`, `paths.ts` gains the version segment, and core begins producing divergent `column_name` values by folding the rename chain.

**Correction (final review).** An earlier version of this section claimed "Nothing in Stage 2 needs to revisit the call sites audited here." That is false. Stage 1's audit covered only **top-level** rows, and Stage 2 must revisit at least the following before divergence becomes real:

- **Nested rows are not projected.** `toLabels` is applied only to the top-level row; every nested object is attached straight from `SELECT *` — paragraph rows (`relations.ts`, and `loadParagraphRows` in `packages/api/src/routes/admin/content.ts`), reference targets, and junction targets. So `?include=category` serves the target type's column names and paragraph children serve the paragraph type's column names. The design spec requires the projection to recurse; Stage 1 never scoped it. Implementing it needs a target-type-keyed outbound helper threaded across `relations.ts` and `routes/admin/content.ts` — a task in its own right. Recorded as a deliberate limitation in [ADR api/0011](../../adr/api/0011-field-label-vs-storage-key.md). GraphQL is already correct here, because `buildObjectType` resolves each nested field by its own column.
  **Closed.** [2026-08-29-nested-projection-and-sort-mapping](../specs/2026-08-29-nested-projection-and-sort-mapping-design.md) added `packages/api/src/projector.ts`, deepening the outbound boundary into a recursive `projectRow` applied at exactly the points that already called `toLabels`. ADR api/0011 is amended accordingly. GraphQL needed no projection of its own, as predicted here — `buildObjectType` resolves each nested field by its own column — but it did need one adjacent fix: a programmatic field on a *paragraph* type was being handed a storage-keyed record, because paragraph types had no field key map at all. `app.ts` now builds a single map covering content, taxonomy and paragraph types.
- **The concrete hazard that projection must close**, so it cannot be missed: `packages/admin/src/components/fields/field-registry.ts:96` reads paragraph sub-values by label (`(props.modelValue ?? {})[field.name]`) while `relations.ts` writes them back by column (`data[pf.db_column.column_name] = pItem[pf.name] ?? null`). A renamed paragraph sub-field would therefore load blank in the edit form and be saved as `null` — silent data loss.
  **Closed** by the same stage: paragraph children are now projected to labels on both the public and admin read paths, so the edit form's by-label read and the relation module's by-column write agree again.
- **`sort_by` is not mapped to storage keys** — the same defect class as the admin-filter gap the final review caught, on the sort axis. `packages/api/src/repositories/content.ts` builds `ORDER BY ${sql.raw(quoteIdent(sort_by))}`, and `SORTABLE_FIELDS` includes `title`, which is a *label*. Under divergence `?sort_by=title` becomes `ORDER BY "title"` against column `blog_title` — a Postgres error, so a 500. Reached from public REST, admin REST (via `parseListQuery`), and GraphQL's `sortBy` enum. Stage 1 deliberately left sorting alone on the grounds that `SORTABLE_FIELDS` was system-fields-only; that premise was wrong.
  **Closed** by [2026-08-29-nested-projection-and-sort-mapping](../specs/2026-08-29-nested-projection-and-sort-mapping-design.md): the three REST list sites (public content, admin content, admin taxonomy) validate the label against `SORTABLE_FIELDS` and map it to a column with `columnFor`; the repository re-validates the column against a new optional `sortableColumns` set before `quoteIdent`. GraphQL's `sortBy` path carried the same bug and was fixed in the same stage: its sort enum's internal values mix key spaces — `created_at` / `updated_at` are system columns, but `title` is a *label*, and it was reaching `ORDER BY` unmapped — so `collectionResolver` now maps it through the type's `columnFor`, and `app.ts` supplies the GraphQL repos a `sortableColumns` set like every other repo. The `SORTABLE_FIELDS` premise is now corrected rather than repeated: nothing is indexed, and `title` is not a system field — sorting by a label a type lacks still 500s, left alone deliberately since schema-driven sorting has its own timeline.
- **A branded label/storage type system** remains a Stage 2 prerequisite, so the compiler rather than a reviewer catches the next site that mixes the two key spaces. **Narrowed by a spike** run during the nested-projection stage: branding `FieldKeyMap`'s signatures as `LabelKeyed`/`StorageKeyed` records produced 29 errors across 5 files, every one an unbranded record needing an assertion added, and zero key-space-mixing errors — including zero in `relations.ts` and zero in `query-params.ts`, because nested projection was a *missing call* no type system sees and `sort_by` is a `string`, not a record. Neither target bug would have been caught. Branded records are rejected on that evidence; branded *strings* (`Label` vs `ColumnName`) remain plausible and still reach into core's query type, so this prerequisite stays open in that narrower form.
- **core/codegen still emits `/api` literals** into generated artifacts (`collection_path` / `item_path`), which the version segment has to reach.
