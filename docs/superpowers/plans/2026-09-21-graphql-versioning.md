# Versioned GraphQL Surface Implementation Plan (Schema Versioning 2e)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every live version of the read contract over GraphQL — one schema per version under `/graphql/<version>` — derived from the same projections the REST routes already use.

**Architecture:** Each live version gets its own `GraphQLSchema` and Yoga instance. A version's fields come from its projection (label, column, requiredness) joined to the *current* registry by column for `field_type` and `ui_component`, which `FIELD_TYPE_CHANGED_WHILE_LIVE` and `VERSION_COLUMN_MISSING` make sound. Fields whose name or presence differs from current carry `@deprecated` with the reason. `/graphql` keeps its exact current behaviour as the floating endpoint.

**Tech Stack:** TypeScript strict (Node 22+), graphql-js code-first, GraphQL Yoga, Hono, Vitest, pnpm workspace + Turborepo + Changesets.

**Spec:** `docs/superpowers/specs/2026-09-21-graphql-versioning-design.md` — read it before Task 1. The plan argues from it.

## Global Constraints

- **Never commit to `master`.** This plan runs on branch `docs/graphql-versioning`, already created.
- **Commit format:** conventional-commits, `type(scope): subject` (commitizen). Scope is the package: `core`, `api`, `cli`.
- **`exactOptionalPropertyTypes: true`** (`tsconfig.base.json:14`). An optional property may be *absent* but never *present-and-undefined*. Repo idiom for conditional assignment: `...(x !== undefined && { key: x })`. Writing `{ deprecationReason: maybeUndefined }` is a type error.
- **`pnpm --filter <pkg> typecheck` is a required gate on every task.** Vitest transpiles without type-checking, and this arc already shipped a type error that survived `test`, `lint` **and** `build`. Never mark a task done on green tests alone.
- **Import extensions:** every file under `packages/api/src/` uses explicit `.js` in relative imports. Match the file you are editing.
- **Layer boundaries:** `core` imports nothing from `api`/`db`/`cli`. `api` imports from `core` and `db`.
- **No barrel `index.ts` for internal submodules.** `packages/api/src/graphql/index.ts` is the subpath's public surface only.
- **Factory functions over classes; pure functions for data transformations.** Parser and projection output stays plain serializable objects.
- **Measured baselines at branch point (commit `89ef26d`):** core `16 files, 245 passed | 2 todo (247)`; api `50 files, 405 passed`. Totals quoted in later tasks are *indicative* — they assume every prior task landed exactly as written. Always trust the delta and the named tests over a total.
- **Integration tests need Postgres.** `docker compose up -d manguito-test-db` (port **5435**), then `pnpm --filter @bobbykim/manguito-cms-api test`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/core/src/versions/types.ts` | `VersionProjection` gains `required` | 1 |
| `packages/core/src/versions/projections.ts` | `buildProjections` populates it | 1 |
| `packages/api/src/graphql/schema.ts` | Skip tombstones; consume a `VersionView`; attach `@deprecated` | 2, 5 |
| `packages/api/src/graphql/filters.ts` | Skip tombstones; version-aware sort enum and filter input | 2, 4 |
| `packages/api/src/graphql/version-view.ts` | **New.** Join a projection to current's registry; compute deprecation reasons | 3 |
| `packages/api/src/graphql/handler.ts` | Take an endpoint path and a view | 6 |
| `packages/api/src/app.ts` | Per-version mounting, fault isolation, CSP prefix, catch-all, headers | 7, 8 |

Test files mirror these, under each package's `__tests__/`.

---

### Task 1: `required` on `VersionProjection`

A field nullable when `v1` was cut can be `required` in current. Borrowing current's flag for `v1`'s GraphQL schema would emit `String!` over data holding nulls, and GraphQL's non-null propagation would null out the **entire parent object** and set `errors[]`. Each version's projection must therefore state its own requiredness.

**Files:**
- Modify: `packages/core/src/versions/types.ts:23-25`
- Modify: `packages/core/src/versions/projections.ts:65-76`
- Test: `packages/core/src/versions/__tests__/projections.test.ts`
- Modify (churn): `packages/core/src/versions/__tests__/compute.test.ts:15`, `load.test.ts:132,178,181`, `projections.test.ts:21,24,78,98,110`, `rename-shapes.test.ts:101,102`
- Modify (churn): `packages/api/src/__tests__/versions.test.ts:100,104`, `field-keys.test.ts:186,187,216`, `versioned-routes.integration.test.ts:96,102,259,298,302`
- Modify (churn): `packages/cli/src/__tests__/version-model-codegen.test.ts:23,54,55,56,57`

**Interfaces:**
- Produces: `VersionProjection['types'][string]['fields'][number]` becomes `{ column_name: string; exposed_as: string; required: boolean; fallback?: unknown }`. Tasks 3 and 9 read `required`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/versions/__tests__/projections.test.ts`:

```typescript
describe('buildProjections — requiredness', () => {
  it("takes each version's own requiredness, not current's", () => {
    // v1 allowed nulls; current tightened the SAME column to required. A
    // GraphQL schema built for v1 from current's flag would emit String! over
    // rows that hold nulls, and non-null propagation would null out the whole
    // parent object. A fixture where both versions agree cannot catch that.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'blog_title', required: false }]),
      ]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'title', column: 'blog_title', required: true },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
    ])
    expect(projections['v2']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'blog_title', exposed_as: 'title', required: true },
    ])
  })

  it('carries requiredness alongside a fallback without disturbing it', () => {
    // `required` must be added to the same object literal the fallback lands
    // on, and the no-fallback case must still omit `fallback` entirely rather
    // than setting it undefined.
    const v1 = {
      version: 'v1',
      registry: makeRegistry([
        makeContentType('content--blog_post', [{ name: 'blog_desc', type: 'text/rich', required: true }]),
      ]),
    }
    const current = makeRegistry([
      makeContentType('content--blog_post', [
        { name: 'blog_desc', type: 'text/rich', removed: true, fallback: '' },
      ]),
    ])

    const projections = buildProjections({ current, currentVersion: 'v2', snapshots: [v1] })

    expect(projections['v1']!.types['content--blog_post']!.fields).toEqual([
      { column_name: 'blog_desc', exposed_as: 'blog_desc', required: true, fallback: '' },
    ])
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-core test -- projections
```

Expected: FAIL. Both new tests fail on the `toEqual`, reporting the received object missing `required`.

- [ ] **Step 3: Add `required` to the type**

`packages/core/src/versions/types.ts` — replace the `types` member of `VersionProjection`:

```typescript
/** What one live version exposes. A type absent from `types` is not exposed by it. */
export type VersionProjection = {
  version: string
  types: Record<string, {
    /**
     * `required` is THIS version's, never current's. Nothing validates
     * requiredness across versions (validate.ts checks columns only), so a
     * field nullable when this version was cut can be required in current.
     * A consumer that builds a non-null type from current's flag would break
     * reads that work today — see the 2e design.
     */
    fields: Array<{ column_name: string; exposed_as: string; required: boolean; fallback?: unknown }>
  }>
}
```

- [ ] **Step 4: Populate it**

`packages/core/src/versions/projections.ts` — in `buildProjections`, replace the `.map` body:

```typescript
        .map((f) => {
          const column_name = f.db_column!.column_name
          const fallback = fallbacks.get(`${typeName}.${column_name}`)
          // Omitted entirely rather than set undefined, so the zero-config
          // case deep-equals cleanly in tests and over the wire. `required`
          // is read from THIS version's own registry, which is the whole
          // point — see VersionProjection's doc comment.
          return fallback === undefined
            ? { column_name, exposed_as: f.name, required: f.required }
            : { column_name, exposed_as: f.name, required: f.required, fallback }
        })
```

- [ ] **Step 5: Run the new tests**

```bash
pnpm --filter @bobbykim/manguito-cms-core test -- projections
```

Expected: the two new tests PASS. Pre-existing assertions in the same file now FAIL — that is the churn Step 6 fixes.

- [ ] **Step 6: Update core's 11 stale assertions**

Every one of these fixtures omits `required` from its `FieldSpec`, and `toRawField` defaults it to `false` (`fixtures.ts:30`) — so every value below is `required: false`. Add the key to each literal:

| File | Line | Becomes |
|---|---|---|
| `compute.test.ts` | 15 | `{ column_name: 'a', exposed_as: 'a', required: false },` |
| `load.test.ts` | 132 | `{ column_name: 'a', exposed_as: 'a', required: false },` |
| `load.test.ts` | 178 | `{ column_name: 'old_title', exposed_as: 'old_title', required: false },` |
| `load.test.ts` | 181 | `{ column_name: 'old_title', exposed_as: 'title', required: false },` |
| `projections.test.ts` | 21 | `{ column_name: 'blog_title', exposed_as: 'blog_title', required: false },` |
| `projections.test.ts` | 24 | `{ column_name: 'blog_title', exposed_as: 'title', required: false },` |
| `projections.test.ts` | 78 | `expect(v1Desc).toEqual({ column_name: 'blog_desc', exposed_as: 'blog_desc', required: false, fallback: '' })` |
| `projections.test.ts` | 98 | `{ column_name: 'description', exposed_as: 'description', required: false, fallback: 'gone' },` |
| `projections.test.ts` | 110 | `{ column_name: 'title', exposed_as: 'title', required: false },` |
| `rename-shapes.test.ts` | 101 | `{ column_name: 'title', exposed_as: 'title', required: false },` |
| `rename-shapes.test.ts` | 102 | `{ column_name: 'body', exposed_as: 'body', required: false },` |

Do **not** touch `rename-shapes.test.ts:24` or `projections.test.ts:46,49,131` — those `.map(f => f.exposed_as)` extractions read one key and are unaffected.

- [ ] **Step 7: Run core's full suite and typecheck**

```bash
pnpm --filter @bobbykim/manguito-cms-core test
pnpm --filter @bobbykim/manguito-cms-core typecheck
```

Expected: `16 files, 247 passed | 2 todo (249)` — the baseline 245 plus the two new tests. Typecheck clean.

- [ ] **Step 8: Rebuild core so downstream packages see the new type**

```bash
pnpm --filter @bobbykim/manguito-cms-core build
```

`api` and `cli` resolve `@bobbykim/manguito-cms-core` to its built `dist`, so without this their typecheck still sees the old shape and Step 9 appears to pass for the wrong reason.

- [ ] **Step 9: Update the 15 downstream input fixtures**

These construct projections rather than assert on them, so they fail **typecheck only** — vitest transpiles without checking types and stays green either way. That is exactly why Step 10 runs `typecheck` and not just `test`.

Add `required: false` to each literal:

| File | Lines |
|---|---|
| `packages/api/src/__tests__/versions.test.ts` | 100, 104 |
| `packages/api/src/__tests__/field-keys.test.ts` | 186, 187, 216 |
| `packages/api/src/__tests__/versioned-routes.integration.test.ts` | 96, 102, 259, 298, 302 |
| `packages/cli/src/__tests__/version-model-codegen.test.ts` | 23, 54, 55, 56, 57 |

For example, `versioned-routes.integration.test.ts:96` becomes:

```typescript
        [TEST_TYPE_NAME]: { fields: [{ column_name: 'blog_title', exposed_as: 'blog_title', required: false }] },
```

and `field-keys.test.ts:216`:

```typescript
    const identity = { fields: [{ column_name: 'title', exposed_as: 'title', required: false }] }
```

- [ ] **Step 10: Verify all three packages**

```bash
pnpm --filter @bobbykim/manguito-cms-core typecheck
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-cli typecheck
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-cli test
```

Expected: three clean typechecks; api `50 files, 405 passed` (unchanged — nothing reads `required` yet); cli unchanged.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/versions packages/api/src/__tests__ packages/cli/src/__tests__
git commit -m "feat(core): state each version's own requiredness in its projection

Nothing validates requiredness across versions, so a field nullable when a
version was cut can be required in current. A consumer building a non-null
GraphQL type from current's flag would emit String! over rows holding nulls
and null out the whole parent object."
```

---

### Task 2: Stop exposing tombstones over GraphQL

`grep -rn "removed" packages/api/src/graphql/` returns nothing. The api's tombstone exclusion lives entirely in `field-keys.ts`'s drop-set, which REST reaches through `remap` — but `scalarFieldResolver(field)` reads `field.db_column.column_name` directly and never consults the FieldKeyMap. A tombstoned field is built into the schema and serves its retained data.

A standalone public-exposure fix, landed before the versioning machinery. The filter it adds stays permanently as the no-view fallback path (Task 5) and is what paragraph types take.

**Files:**
- Modify: `packages/api/src/graphql/schema.ts:141-193` (`buildObjectType`)
- Modify: `packages/api/src/graphql/filters.ts:97-120` (`buildFilterInputType`)
- Test: `packages/api/src/graphql/__tests__/schema.tombstones.test.ts` (create)

**Interfaces:**
- Produces: `exposedFields(type: { fields: ParsedField[] }): ParsedField[]`, exported from `schema.ts`. Task 5 uses it as the no-view fallback.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/graphql/__tests__/schema.tombstones.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { graphql, printSchema } from 'graphql'
import type { ParsedContentType, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import { buildGraphQLSchema } from '../schema'
import type { GraphQLContext } from '../context'
import { createFieldKeyMap } from '../../field-keys'
import { divergentTargetType, divergentTextField, renamedTombstoneField } from '../../field-keys.test-fixtures'

// renamedTombstoneField is label `legacy_desc` over retained column
// `blog_desc` — name and column deliberately distinct, so a test cannot pass
// under an implementation that keys off the wrong one.
const withTombstone: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, renamedTombstoneField],
}

const registry = {
  content_types: { 'content--category': withTombstone },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

function ctxWithRow(): GraphQLContext {
  const repo = {
    findMany: async () => ({
      // A real row carries the retained column, because the repository does
      // SELECT * and the column still physically exists.
      data: [{ id: 'c1', blog_title: 'Live', blog_desc: 'SHOULD NOT LEAK' }],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    }),
  }
  return { repos: { 'content--category': repo } } as unknown as GraphQLContext
}

describe('GraphQL schema — tombstoned fields', () => {
  const maps = { 'content--category': createFieldKeyMap(withTombstone.fields) }

  it('does not build a tombstoned field into the object type', () => {
    const schema = buildGraphQLSchema(registry, maps)
    const sdl = printSchema(schema)

    expect(sdl).toContain('title: String')
    expect(sdl).not.toContain('legacyDesc')
  })

  it('refuses a query for the tombstoned field rather than serving its data', async () => {
    const schema = buildGraphQLSchema(registry, maps)

    const result = await graphql({
      schema,
      source: '{ categories { data { legacyDesc } } }',
      contextValue: ctxWithRow(),
    })

    // A field absent from the schema is a validation error, so the retained
    // value never reaches a response at all.
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.message).toContain('legacyDesc')
    expect(JSON.stringify(result.data ?? null)).not.toContain('SHOULD NOT LEAK')
  })

  it('keeps serving the live sibling field', async () => {
    const schema = buildGraphQLSchema(registry, maps)

    const result = await graphql({
      schema,
      source: '{ categories { data { title } } }',
      contextValue: ctxWithRow(),
    })

    expect(result.errors).toBeUndefined()
    const data = result.data as { categories: { data: Array<{ title: string }> } }
    expect(data.categories.data[0]!.title).toBe('Live')
  })

  it('leaves a tombstoned field out of the filter input type', () => {
    const schema = buildGraphQLSchema(registry, maps)
    const sdl = printSchema(schema)

    // The Filter input is built from the same field list; a tombstone there
    // would let a client filter on a column the schema does not expose.
    expect(sdl).toContain('input CategoryFilter')
    const filterBlock = sdl.slice(sdl.indexOf('input CategoryFilter'))
    expect(filterBlock.slice(0, filterBlock.indexOf('}'))).not.toContain('legacyDesc')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- schema.tombstones
```

Expected: FAIL. `printSchema` contains `legacyDesc`, and the query test's `result.errors` is `undefined` while the response carries `SHOULD NOT LEAK` — the hole, demonstrated.

- [ ] **Step 3: Add the filter to `schema.ts`**

Insert above `buildObjectType` (after the `outputTypeForField` function, around line 138):

```typescript
  /**
   * A type's fields minus its tombstones.
   *
   * A tombstone (`removed: true`) is column-backed — the parser keeps its
   * column alive for older live versions — but the version being served must
   * never expose it. REST drops it via the FieldKeyMap's drop-set, which
   * `remap` applies; GraphQL resolves per field by column through
   * `resolveFieldValue` and never touches that map, so the exclusion has to
   * happen where the schema is BUILT. A field absent from the schema is a
   * validation error, so the retained value cannot reach a response at all.
   */
  function exposedFields(type: { fields: ParsedField[] }): ParsedField[] {
    return type.fields.filter((f) => f.removed !== true)
  }
```

Then in `buildObjectType`, replace the two reads of `type.fields`:

```typescript
    const visible = exposedFields(type)

    // Handed to the programmatic resolvers so they can present the same record
    // shape REST does, where media fields are resolved objects (see resolvers.ts).
    const mediaFieldNames = visible
      .filter((f) => f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file')
      .map((f) => f.name)
```

and the field loop's header:

```typescript
        for (const field of visible) {
```

- [ ] **Step 4: Add the filter to `filters.ts`**

In `buildFilterInputType`, add `removed` to the existing skip conditions — first line of the loop body:

```typescript
  for (const f of type.fields) {
    // A tombstone retains a real column, so without this a client could
    // filter on a column the schema does not expose.
    if (f.removed === true) continue
    if (f.field_type === 'programmatic' || f.field_type === 'paragraph') continue
```

Do the same in `buildSortFieldEnum`? No — it reads no field list at all (that is Task 4's concern).

- [ ] **Step 5: Run the new tests**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- schema.tombstones
```

Expected: all four PASS.

- [ ] **Step 6: Run the api suite and typecheck**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
```

Expected: `51 files, 409 passed` — baseline 405 plus four. No pre-existing test regresses: no existing fixture declares `removed`, so `exposedFields` is the identity for all of them. Typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/graphql
git commit -m "fix(api): stop exposing tombstoned fields over GraphQL

The api's tombstone exclusion lived only in the FieldKeyMap drop-set, which
REST applies through remap. GraphQL resolves per field by column and never
consults that map, so a tombstoned field was built into the schema and
served its retained data."
```

---

### Task 3: `graphql/version-view.ts` — the projection→registry join

A projection carries label, column and requiredness. A GraphQL type also needs `field_type` and `ui_component`, which the projection does not carry. Those come from **current's column-backed field for the same column** — sound because `VERSION_COLUMN_MISSING` guarantees the column still exists and `FIELD_TYPE_CHANGED_WHILE_LIVE` guarantees its type has not moved.

**Files:**
- Create: `packages/api/src/graphql/version-view.ts`
- Test: `packages/api/src/graphql/__tests__/version-view.test.ts` (create)

**Interfaces:**
- Consumes: `VersionProjection` from core with Task 1's `required`; `isColumnBacked` from `../field-keys.js`.
- Produces:
  - `type ViewField = { field: ParsedField; exposedAs: string; required: boolean; fallback?: unknown; deprecationReason?: string }`
  - `type VersionView = Record<string, { fields: ViewField[] }>`
  - `function buildVersionView(input: { registry: SchemaRegistry; projection: VersionProjection | undefined; currentProjection: VersionProjection | undefined; currentVersion: string }): VersionView`
  - Tasks 4, 5 and 6 consume all three.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/graphql/__tests__/version-view.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { ParsedContentType, SchemaRegistry, VersionProjection } from '@bobbykim/manguito-cms-core'
import { buildVersionView } from '../version-view'
import {
  divergentTargetType,
  divergentTextField,
  identityTextField,
  manyToManyField,
  renamedTombstoneField,
} from '../../field-keys.test-fixtures'

// Current's type: label `title` over column `blog_title` (divergent, so a test
// cannot pass by keying off the wrong one), a plain `summary`, a
// many-to-many field with no column of its own, and a tombstone whose
// retained column is `blog_desc`.
const CURRENT_TYPE: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, identityTextField, manyToManyField, renamedTombstoneField],
}

const registry = {
  content_types: { 'content--category': CURRENT_TYPE },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

// v1 exposes the column under its ORIGINAL name, plus the column current has
// since tombstoned. v3 (current) exposes the renamed label only.
const V1: VersionProjection = {
  version: 'v1',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
        { column_name: 'summary', exposed_as: 'summary', required: false },
        { column_name: 'blog_desc', exposed_as: 'blog_desc', required: false, fallback: '' },
      ],
    },
  },
}

const V3: VersionProjection = {
  version: 'v3',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'title', required: true },
        { column_name: 'summary', exposed_as: 'summary', required: false },
      ],
    },
  },
}

function viewFor(projection: VersionProjection | undefined) {
  return buildVersionView({
    registry,
    projection,
    currentProjection: V3,
    currentVersion: 'v3',
  })
}

function find(fields: ReturnType<typeof viewFor>[string]['fields'], exposedAs: string) {
  return fields.find((f) => f.exposedAs === exposedAs)
}

describe('buildVersionView — joining a projection to current', () => {
  it("recovers field_type and ui_component from current's field for the same column", () => {
    const view = viewFor(V1)
    const title = find(view['content--category']!.fields, 'blog_title')

    expect(title).toBeDefined()
    // Joined by COLUMN: current calls this field `title`, v1 exposes it as
    // `blog_title`, and the type info comes from current's field object.
    expect(title!.field.field_type).toBe('text/plain')
    expect(title!.field.db_column!.column_name).toBe('blog_title')
    expect(title!.field.name).toBe('title')
  })

  it("takes requiredness from the version's projection, not current's field", () => {
    // current's field has required: false (divergentTextField), but V3's
    // projection says required: true. The projection wins.
    const v3 = viewFor(V3)
    expect(find(v3['content--category']!.fields, 'title')!.required).toBe(true)

    // And v1's own projection says false for the same column.
    const v1 = viewFor(V1)
    expect(find(v1['content--category']!.fields, 'blog_title')!.required).toBe(false)
  })

  it("carries the projection's fallback through to the view", () => {
    // V1 declares fallback '' on blog_desc. GraphQL's resolver needs it here
    // or a row written since the removal serves null over GraphQL and '' over
    // REST — the same version, two answers.
    const view = viewFor(V1)
    expect(find(view['content--category']!.fields, 'blog_desc')!.fallback).toBe('')
    // And a field with no declared fallback must not carry the key at all.
    expect('fallback' in find(view['content--category']!.fields, 'summary')!).toBe(false)
  })

  it('joins a column whose current field is a tombstone', () => {
    // blog_desc survives in current only as renamedTombstoneField. The join
    // must still find it — a tombstone is an ordinary parsed field.
    const view = viewFor(V1)
    const desc = find(view['content--category']!.fields, 'blog_desc')

    expect(desc).toBeDefined()
    expect(desc!.field.field_type).toBe('text/plain')
    expect(desc!.field.removed).toBe(true)
  })
})

describe('buildVersionView — deprecation reasons', () => {
  it("names current's label when the field was renamed", () => {
    const view = viewFor(V1)
    expect(find(view['content--category']!.fields, 'blog_title')!.deprecationReason)
      .toBe("Renamed to 'title' in v3.")
  })

  it('says removed when current no longer exposes the column', () => {
    const view = viewFor(V1)
    expect(find(view['content--category']!.fields, 'blog_desc')!.deprecationReason)
      .toBe('Removed in v3; column retained while this version is live.')
  })

  it('leaves an unchanged field undeprecated', () => {
    const view = viewFor(V1)
    const summary = find(view['content--category']!.fields, 'summary')
    expect(summary!.deprecationReason).toBeUndefined()
    // Absent, not present-and-undefined — exactOptionalPropertyTypes.
    expect('deprecationReason' in summary!).toBe(false)
  })

  it("deprecates nothing in current's own view", () => {
    const view = viewFor(V3)
    for (const f of view['content--category']!.fields) {
      expect(f.deprecationReason).toBeUndefined()
    }
  })
})

describe('buildVersionView — what a projection cannot carry', () => {
  it('appends non-column-backed fields from current, undeprecated', () => {
    // A many-to-many field has no column (the junction owns the association),
    // so it never appears in a projection. Dropping it here would silently
    // delete every relation field from an older version's schema.
    const view = viewFor(V1)
    const tags = find(view['content--category']!.fields, 'tags')

    expect(tags).toBeDefined()
    expect(tags!.field.field_type).toBe('reference')
    expect(tags!.deprecationReason).toBeUndefined()
  })

  it('never exposes a tombstone through the non-column-backed path', () => {
    const view = viewFor(V1)
    // renamedTombstoneField IS column-backed, so it arrives only via the
    // projection (as blog_desc above) and never under its own name.
    expect(find(view['content--category']!.fields, 'legacy_desc')).toBeUndefined()
  })

  it('falls back to the registry, minus tombstones, for a type with no projection', () => {
    // Paragraph types have no projection at all — core's buildProjections
    // never visits them. They follow current's shape on every version.
    const view = viewFor(undefined)
    const fields = view['content--category']!.fields

    expect(fields.map((f) => f.exposedAs).sort()).toEqual(['summary', 'tags', 'title'])
    expect(find(fields, 'legacy_desc')).toBeUndefined()
    expect(fields.every((f) => f.deprecationReason === undefined)).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- version-view
```

Expected: FAIL — `Cannot find module '../version-view'`.

- [ ] **Step 3: Write the module**

Create `packages/api/src/graphql/version-view.ts`:

```typescript
import type { ParsedField, SchemaRegistry, VersionProjection } from '@bobbykim/manguito-cms-core'
import { isColumnBacked } from '../field-keys.js'

// ─── One live version's view of the schema ────────────────────────────────────
//
// A VersionProjection says WHICH columns a version exposes, under WHICH labels,
// and whether each is required. It deliberately says nothing about a field's
// type: `field_type` and `ui_component` are recovered from CURRENT's field for
// the same column instead.
//
// That join is sound, not convenient. `VERSION_COLUMN_MISSING` guarantees every
// column a live version exposes still exists in current, and
// `FIELD_TYPE_CHANGED_WHILE_LIVE` guarantees its type has not moved under it —
// so current's field is a faithful source for everything except the label and
// the requiredness, which the projection carries precisely because they DO
// move. See the 2e design, "Deriving a version's types".

export type ViewField = {
  /** Current's field for this column — the source of `field_type` and `ui_component`. */
  field: ParsedField
  /** The name THIS version exposes the column under. */
  exposedAs: string
  /** THIS version's requiredness. Never current's — see VersionProjection. */
  required: boolean
  /**
   * The value to serve when the column holds null, for a column that stopped
   * being written. REST substitutes this in `projectRow`; GraphQL has no
   * route-level projection, so its scalar resolver has to do it or the two
   * surfaces disagree about the same version's contract.
   */
  fallback?: unknown
  /** Present only when this version's contract differs from current's. */
  deprecationReason?: string
}

/** Keyed by machine name, for content, taxonomy AND paragraph types. */
export type VersionView = Record<string, { fields: ViewField[] }>

/** A type's column-backed fields keyed by column. Tombstones included — they hold a real column. */
function byColumn(fields: ParsedField[]): Map<string, ParsedField> {
  const out = new Map<string, ParsedField>()
  for (const f of fields) {
    if (!isColumnBacked(f)) continue
    out.set(f.db_column.column_name, f)
  }
  return out
}

/**
 * Why this version's contract differs from current's, or undefined when it
 * does not. Keyed by COLUMN, because the label is exactly what may have moved.
 *
 * The reason names CURRENT, not the intermediate version where the change
 * happened: pinpointing that would mean walking every snapshot in between, and
 * "what it is called now" is the actionable fact for someone deciding whether
 * to upgrade.
 */
function deprecationFor(
  field: { column_name: string; exposed_as: string },
  currentLabels: Map<string, string>,
  currentVersion: string
): string | undefined {
  const currentLabel = currentLabels.get(field.column_name)
  if (currentLabel === undefined) {
    return `Removed in ${currentVersion}; column retained while this version is live.`
  }
  if (currentLabel !== field.exposed_as) {
    return `Renamed to '${currentLabel}' in ${currentVersion}.`
  }
  return undefined
}

/**
 * `projection` undefined means this version has no projection for a type — or
 * none at all. Those types fall back to the registry's own fields minus
 * tombstones, which is the inherited 2d boundary: paragraph types are never
 * projected, so nested paragraph content follows current's shape on every
 * version, by design.
 */
export function buildVersionView(input: {
  registry: SchemaRegistry
  projection: VersionProjection | undefined
  currentProjection: VersionProjection | undefined
  currentVersion: string
}): VersionView {
  const { registry, projection, currentProjection, currentVersion } = input
  const out: VersionView = {}

  const sources: Array<Record<string, { fields: ParsedField[] }>> = [
    registry.content_types,
    registry.taxonomy_types,
    registry.paragraph_types,
  ]

  for (const source of sources) {
    for (const [typeName, type] of Object.entries(source)) {
      const projectionType = projection?.types[typeName]

      // No projection for this type: follow current, minus tombstones.
      if (projectionType === undefined) {
        out[typeName] = {
          fields: type.fields
            .filter((f) => f.removed !== true)
            .map((f) => ({ field: f, exposedAs: f.name, required: f.required })),
        }
        continue
      }

      const columns = byColumn(type.fields)
      const currentLabels = new Map<string, string>()
      for (const f of currentProjection?.types[typeName]?.fields ?? []) {
        currentLabels.set(f.column_name, f.exposed_as)
      }

      const fields: ViewField[] = []

      for (const pf of projectionType.fields) {
        const field = columns.get(pf.column_name)
        // Unreachable on a model that loaded — VERSION_COLUMN_MISSING rejects
        // it. Skipped rather than thrown so a hand-built baked model cannot
        // take the whole schema down over one field.
        if (field === undefined) continue
        const reason = deprecationFor(pf, currentLabels, currentVersion)
        fields.push({
          field,
          exposedAs: pf.exposed_as,
          required: pf.required,
          ...(pf.fallback !== undefined && { fallback: pf.fallback }),
          ...(reason !== undefined && { deprecationReason: reason }),
        })
      }

      // Fields with no column of their own — paragraph, many-to-many,
      // programmatic — never appear in a projection, so they must be appended
      // from the registry or an older version's schema would silently lose
      // every relation and computed field. They follow current on every
      // version (the 2d boundary), hence no deprecation reason.
      for (const f of type.fields) {
        if (isColumnBacked(f) || f.removed === true) continue
        fields.push({ field: f, exposedAs: f.name, required: f.required })
      }

      out[typeName] = { fields }
    }
  }

  return out
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- version-view
pnpm --filter @bobbykim/manguito-cms-api typecheck
```

Expected: 11 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/graphql/version-view.ts packages/api/src/graphql/__tests__/version-view.test.ts
git commit -m "feat(api): derive a per-version view of the schema for GraphQL

Joins a version's projection to current's registry by column, which
VERSION_COLUMN_MISSING and FIELD_TYPE_CHANGED_WHILE_LIVE make sound, and
computes each field's deprecation reason against current."
```

---

### Task 4: Version-aware query args

`buildSortFieldEnum(typeName)` hardcodes the **label** `title` for every type with no field information at all. On a type with no `title` label it offers a sort value that resolves to no column — the same class 2d closed late for REST.

**Files:**
- Modify: `packages/api/src/graphql/filters.ts:41-46` (`buildSortFieldEnum`), `:97-120` (`buildFilterInputType`)
- Test: `packages/api/src/graphql/__tests__/filters.test.ts`

**Interfaces:**
- Consumes: `ViewField` from Task 3; `FieldKeyMap` from `../field-keys.js`.
- Produces:
  - `buildSortFieldEnum(typeName: string, fieldKeys?: FieldKeyMap): GraphQLEnumType`
  - `buildFilterInputType(type: ParsedContentType | ParsedTaxonomyType, viewFields?: ViewField[]): GraphQLInputObjectType | null`
  - Task 5 passes both.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/graphql/__tests__/filters.test.ts`:

```typescript
import { createFieldKeyMap } from '../../field-keys'
import { divergentTextField, identityTextField } from '../../field-keys.test-fixtures'

describe('buildSortFieldEnum — version awareness', () => {
  it('offers title when the version exposes that label', () => {
    // divergentTextField's label IS 'title' (over column blog_title), so
    // columnFor('title') resolves and the value is legitimately sortable.
    const keys = createFieldKeyMap([divergentTextField])
    const values = buildSortFieldEnum('Category', keys).getValues().map((v) => v.name)

    expect(values).toContain('title')
    expect(values).toContain('createdAt')
    expect(values).toContain('updatedAt')
  })

  it('omits title when the version cannot resolve that label to a column', () => {
    // identityTextField is label `summary`. Nothing on this type is named
    // `title`, so offering it would hand the repository a label that maps to
    // no column — 2d's inbound bug, in enum form.
    const keys = createFieldKeyMap([identityTextField])
    const values = buildSortFieldEnum('Category', keys).getValues().map((v) => v.name)

    expect(values).not.toContain('title')
    expect(values).toEqual(['createdAt', 'updatedAt'])
  })

  it('keeps title when no field key map is supplied', () => {
    // Back-compatibility: schema.divergence.test.ts calls buildGraphQLSchema
    // with no maps and asserts `sortBy: title` passes through unchanged.
    const values = buildSortFieldEnum('Category').getValues().map((v) => v.name)
    expect(values).toContain('title')
  })

  it('never yields an empty enum, which GraphQL would reject', () => {
    const keys = createFieldKeyMap([])
    expect(buildSortFieldEnum('Category', keys).getValues().length).toBeGreaterThan(0)
  })
})

describe('buildFilterInputType — version awareness', () => {
  it("names filter fields by the version's exposed label, not current's", () => {
    // The view exposes column blog_title as `blogTitle` (v1's name) while
    // current's field object calls it `title`. A filter input built from
    // field.name would advertise the wrong key.
    const type = {
      schema_type: 'content-type' as const,
      name: 'content--category',
      fields: [divergentTextField],
    } as unknown as ParsedContentType

    const input = buildFilterInputType(type, [
      { field: divergentTextField, exposedAs: 'blog_title', required: false },
    ])

    const keys = Object.keys(input!.getFields())
    expect(keys).toContain('blogTitle')
    expect(keys).not.toContain('title')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- filters
```

Expected: FAIL. The omit-title test receives `['title','createdAt','updatedAt']`, and the filter test receives `title` rather than `blogTitle`.

- [ ] **Step 3: Make the sort enum version-aware**

`packages/api/src/graphql/filters.ts` — replace `buildSortFieldEnum`:

```typescript
/**
 * `fieldKeys` is THIS version's map. `title` in SORTABLE is a schema field's
 * LABEL, not a column, so a version that has no field with that label cannot
 * resolve it — and offering it anyway hands the repository a label that maps
 * to nothing, which surfaces as a 500 from SQL rather than a rejected query.
 * Mirrors `sortableColumnsFor` in versions.ts.
 *
 * `createdAt`/`updatedAt` are real system columns on every type, so they are
 * always offered and the enum can never end up empty — which GraphQL rejects.
 *
 * With no map, every value is kept: callers that have not threaded a
 * FieldKeyMap through behave exactly as before.
 */
export function buildSortFieldEnum(typeName: string, fieldKeys?: FieldKeyMap): GraphQLEnumType {
  const resolvable = SORTABLE.filter(
    (s) => s.gql === 'createdAt' || s.gql === 'updatedAt' || fieldKeys === undefined || fieldKeys.columnFor(s.value) !== undefined
  )
  return new GraphQLEnumType({
    name: `${typeName}SortField`,
    values: Object.fromEntries(resolvable.map((s) => [s.gql, { value: s.value }])),
  })
}
```

Add to the imports at the top of `filters.ts`:

```typescript
import type { FieldKeyMap } from '../field-keys.js'
import type { ViewField } from './version-view.js'
```

- [ ] **Step 4: Make the filter input version-aware**

Replace the field loop in `buildFilterInputType`, and its signature:

```typescript
export function buildFilterInputType(
  type: ParsedContentType | ParsedTaxonomyType,
  viewFields?: ViewField[]
): GraphQLInputObjectType | null {
  const fields: Record<string, { type: GraphQLInputObjectType }> = {}

  // System fields that are filterable columns.
  fields['id'] = { type: IDFilter }
  fields['published'] = { type: BooleanFilter }
  fields['createdAt'] = { type: DateTimeFilter }
  fields['updatedAt'] = { type: DateTimeFilter }
  if (type.schema_type === 'content-type') fields['slug'] = { type: StringFilter }

  // A view states the label THIS version exposes each field under; without
  // one, fall back to the field's own name minus tombstones (Task 2's rule).
  const entries: Array<{ field: ParsedField; exposedAs: string }> =
    viewFields !== undefined
      ? viewFields.map((v) => ({ field: v.field, exposedAs: v.exposedAs }))
      : type.fields.filter((f) => f.removed !== true).map((f) => ({ field: f, exposedAs: f.name }))

  for (const { field: f, exposedAs } of entries) {
    if (f.field_type === 'programmatic' || f.field_type === 'paragraph') continue
    if (f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file') continue
    const input = filterInputForField(f.field_type)
    if (input) fields[buildFieldNameMap([exposedAs]).toGraphql(exposedAs)] = { type: input }
  }

  if (Object.keys(fields).length === 0) return null
  return new GraphQLInputObjectType({ name: `${graphqlTypeName(type.name)}Filter`, fields })
}
```

Add `ParsedField` to the existing `@bobbykim/manguito-cms-core` type import in this file.

Note the tombstone filter from Task 2 now lives in the `entries` fallback rather than as a `continue` in the loop — same rule, expressed once.

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- filters
pnpm --filter @bobbykim/manguito-cms-api test -- schema.tombstones
pnpm --filter @bobbykim/manguito-cms-api typecheck
```

Expected: the five new tests PASS; Task 2's tombstone tests still PASS (the filter moved, the rule did not); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/graphql/filters.ts packages/api/src/graphql/__tests__/filters.test.ts
git commit -m "fix(api): build GraphQL query args from the served version's labels

buildSortFieldEnum hardcoded the label 'title' with no field information, so
a type without that label offered a sort value resolving to no column."
```

---

### Task 5: `buildGraphQLSchema` consumes the view

**Files:**
- Modify: `packages/api/src/graphql/schema.ts` — `outputTypeForField`, `buildObjectType`, the two root-query loops, the signature
- Modify: `packages/api/src/graphql/resolvers.ts:22-29` — `resolveFieldValue`/`scalarFieldResolver` gain a fallback
- Test: `packages/api/src/graphql/__tests__/schema.versioned.test.ts` (create)

**Interfaces:**
- Consumes: `VersionView`, `ViewField` (Task 3); `buildSortFieldEnum(typeName, fieldKeys?)`, `buildFilterInputType(type, viewFields?)` (Task 4); `exposedFields` (Task 2).
- Produces:
  - `buildGraphQLSchema(registry: SchemaRegistry, fieldKeyMaps?: Record<string, FieldKeyMap>, view?: VersionView): GraphQLSchema`
  - `scalarFieldResolver(field: ParsedField, fallback?: unknown)`
  - Task 6 passes the view.

**Key mapping rules — get these right or the surface breaks subtly:**

| Consumer | Takes | Why |
|---|---|---|
| GraphQL field name | `toCamelCase(vf.exposedAs)` | the version's public label |
| `scalarFieldResolver` | `vf.field` (reads its column) | the column is stable across versions |
| `relationFieldResolver` / `programmaticFieldResolver` | `vf.field.name` | `ctx.loaders.load` and `resolverKey` look the field up in the registry by its **real** name |
| `mediaFieldNames` | `vf.field.name` | passed straight to `ctx.loaders.load` (`resolvers.ts:81`) |
| `nameMap` for `collectionResolver` | `vf.exposedAs` | `translateFilters` maps GraphQL name → label, then `columnFor` → column |
| nullability | `vf.required` | never `vf.field.required` |

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/graphql/__tests__/schema.versioned.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { graphql, printSchema } from 'graphql'
import type { ParsedContentType, SchemaRegistry, VersionProjection } from '@bobbykim/manguito-cms-core'
import { buildGraphQLSchema } from '../schema'
import { buildVersionView } from '../version-view'
import type { GraphQLContext } from '../context'
import { createFieldKeyMapFromProjection } from '../../field-keys'
import { divergentTargetType, divergentTextField, renamedTombstoneField } from '../../field-keys.test-fixtures'

const CURRENT_TYPE: ParsedContentType = {
  ...divergentTargetType,
  fields: [divergentTextField, renamedTombstoneField],
}

const registry = {
  content_types: { 'content--category': CURRENT_TYPE },
  taxonomy_types: {},
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

const V1: VersionProjection = {
  version: 'v1',
  types: {
    'content--category': {
      fields: [
        { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
        { column_name: 'blog_desc', exposed_as: 'blog_desc', required: false, fallback: 'FELL BACK' },
      ],
    },
  },
}

const V3: VersionProjection = {
  version: 'v3',
  types: {
    'content--category': { fields: [{ column_name: 'blog_title', exposed_as: 'title', required: true }] },
  },
}

function schemaFor(projection: VersionProjection) {
  const view = buildVersionView({ registry, projection, currentProjection: V3, currentVersion: 'v3' })
  const maps = {
    'content--category': createFieldKeyMapFromProjection(
      projection.types['content--category']!,
      CURRENT_TYPE.fields
    ),
  }
  return buildGraphQLSchema(registry, maps, view)
}

function ctxWith(row: Record<string, unknown>): GraphQLContext {
  const repo = {
    findMany: async () => ({
      data: [row],
      meta: { total: 1, page: 1, per_page: 10, total_pages: 1, has_next: false, has_prev: false },
    }),
  }
  return { repos: { 'content--category': repo } } as unknown as GraphQLContext
}

describe('buildGraphQLSchema — per-version field names', () => {
  it("names each field by its own version's label over one column", async () => {
    const row = { id: 'c1', blog_title: 'Hello', blog_desc: 'Old' }

    const v1 = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { blogTitle } } }',
      contextValue: ctxWith(row),
    })
    expect(v1.errors).toBeUndefined()
    expect((v1.data as any).categories.data[0].blogTitle).toBe('Hello')

    const v3 = await graphql({
      schema: schemaFor(V3),
      source: '{ categories { data { title } } }',
      contextValue: ctxWith(row),
    })
    expect(v3.errors).toBeUndefined()
    expect((v3.data as any).categories.data[0].title).toBe('Hello')
  })

  it("rejects current's name on the older version's schema", async () => {
    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { title } } }',
      contextValue: ctxWith({ id: 'c1', blog_title: 'Hello' }),
    })
    expect(result.errors).toBeDefined()
  })

  it('omits a column the older version never exposed', () => {
    // blog_desc is in V1 but not V3 — v3's schema must not carry it, and this
    // is the 2d leak in GraphQL form: remap passes unmapped keys through, so
    // only building from the view prevents it.
    expect(printSchema(schemaFor(V3))).not.toContain('blogDesc')
    expect(printSchema(schemaFor(V1))).toContain('blogDesc')
  })
})

describe('buildGraphQLSchema — deprecation directives', () => {
  it('marks a renamed field deprecated with current’s name', () => {
    const sdl = printSchema(schemaFor(V1))
    expect(sdl).toContain('@deprecated(reason: "Renamed to \'title\' in v3.")')
  })

  it('marks a removed field deprecated', () => {
    const sdl = printSchema(schemaFor(V1))
    expect(sdl).toContain('Removed in v3; column retained while this version is live.')
  })

  it("deprecates nothing on current's own schema", () => {
    expect(printSchema(schemaFor(V3))).not.toContain('@deprecated')
  })
})

describe('buildGraphQLSchema — per-version nullability', () => {
  it("uses the version's own requiredness, not current's field", () => {
    // divergentTextField carries required: false, but V3's projection says
    // true. Reading the ParsedField would emit String on v3 and String! on
    // neither.
    expect(printSchema(schemaFor(V3))).toContain('title: String!')
    expect(printSchema(schemaFor(V1))).toContain('blogTitle: String')
    expect(printSchema(schemaFor(V1))).not.toContain('blogTitle: String!')
  })
})

describe('buildGraphQLSchema — fallbacks', () => {
  it('serves the declared fallback when the retained column is null', async () => {
    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { blogDesc } } }',
      contextValue: ctxWith({ id: 'c1', blog_title: 'Hello', blog_desc: null }),
    })
    expect(result.errors).toBeUndefined()
    expect((result.data as any).categories.data[0].blogDesc).toBe('FELL BACK')
  })

  it('leaves a real value alone, including an empty string', async () => {
    const result = await graphql({
      schema: schemaFor(V1),
      source: '{ categories { data { blogDesc } } }',
      contextValue: ctxWith({ id: 'c1', blog_title: 'Hello', blog_desc: '' }),
    })
    expect(result.errors).toBeUndefined()
    expect((result.data as any).categories.data[0].blogDesc).toBe('')
  })
})

describe('buildGraphQLSchema — back-compatibility', () => {
  it('builds from the registry when no view is supplied', () => {
    const sdl = printSchema(buildGraphQLSchema(registry))
    expect(sdl).toContain('title: String')
    // Task 2's rule still holds on the no-view path.
    expect(sdl).not.toContain('legacyDesc')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- schema.versioned
```

Expected: FAIL — `buildGraphQLSchema` takes two parameters, so the view is ignored and every per-version assertion fails.

- [ ] **Step 3: Give the scalar resolver a fallback**

`packages/api/src/graphql/resolvers.ts` — replace `resolveFieldValue` and `scalarFieldResolver`:

```typescript
/**
 * A GraphQL field's value on a content row. The GraphQL field NAME comes from
 * the field's label (see naming.ts), but the value lives under its storage
 * column, which differs once a field has been renamed.
 *
 * `fallback` is the value a version declares for a column that stopped being
 * written: rows created since the removal hold null there. Substituted on
 * null/undefined ONLY — never on '' or 0 — matching projectRow's rule, so the
 * REST and GraphQL surfaces cannot disagree about the same version.
 */
export function resolveFieldValue(
  field: ParsedField,
  row: Record<string, unknown>,
  fallback?: unknown
): unknown {
  const key = isColumnBacked(field) ? field.db_column.column_name : field.name
  const value = row[key]
  if ((value === null || value === undefined) && fallback !== undefined) return fallback
  return value ?? null
}

export function scalarFieldResolver(field: ParsedField, fallback?: unknown) {
  return (parent: Row): unknown => resolveFieldValue(field, parent, fallback)
}
```

- [ ] **Step 4: Thread the view through `schema.ts`**

Change the signature and add the import:

```typescript
import type { VersionView, ViewField } from './version-view.js'

export function buildGraphQLSchema(
  registry: SchemaRegistry,
  fieldKeyMaps: Record<string, FieldKeyMap> = {},
  view?: VersionView
): GraphQLSchema {
```

Give `outputTypeForField` an explicit requiredness — replace its signature and the three `field.required` reads:

```typescript
  function outputTypeForField(field: ParsedField, required: boolean): GraphQLOutputType {
    const scalar = scalarOutputType(field.field_type)
    if (scalar) return required ? new GraphQLNonNull(scalar) : scalar

    if (field.field_type === 'enum') {
      const ref = field.ui_component.component === 'select' ? field.ui_component.enum_ref : undefined
      const et = ref ? enumTypes.get(ref) : undefined
      const t = et ?? GraphQLString
      return required ? new GraphQLNonNull(t) : t
    }
```

(the rest of the function is unchanged).

Add a helper beside `exposedFields`, which normalises both paths to one shape:

```typescript
  /**
   * The fields one schema exposes for a type, as ViewFields. With a view, the
   * served version's own list; without one, the registry's minus tombstones.
   */
  function viewFieldsFor(machineName: string, type: { fields: ParsedField[] }): ViewField[] {
    return (
      view?.[machineName]?.fields ??
      exposedFields(type).map((f) => ({ field: f, exposedAs: f.name, required: f.required }))
    )
  }
```

Then rewrite `buildObjectType`'s body:

```typescript
  function buildObjectType(
    machineName: string,
    type: ParsedContentType | ParsedTaxonomyType | ParsedParagraphType
  ): GraphQLObjectType {
    const visible = viewFieldsFor(machineName, type)

    // Handed to the programmatic resolvers so they can present the same record
    // shape REST does, where media fields are resolved objects (see resolvers.ts).
    //
    // The field's REAL name, not its exposed label: this list goes straight to
    // ctx.loaders.load(typeName, name, row), which looks the field up in the
    // registry (resolvers.ts:81).
    const mediaFieldNames = visible
      .filter(
        (v) =>
          v.field.field_type === 'image' || v.field.field_type === 'video' || v.field.field_type === 'file'
      )
      .map((v) => v.field.name)

    return new GraphQLObjectType({
      name: graphqlTypeName(machineName),
      fields: () => {
        const fields: GraphQLFieldConfigMap<Record<string, unknown>, GraphQLContext> = {}
        // System fields.
        fields['id'] = { type: new GraphQLNonNull(GraphQLID), resolve: (p) => p['id'] }
        if (type.schema_type !== 'paragraph-type') {
          fields['published'] = { type: new GraphQLNonNull(GraphQLBoolean), resolve: (p) => p['published'] }
        }
        if (type.schema_type === 'content-type') {
          fields['slug'] = { type: new GraphQLNonNull(GraphQLString), resolve: (p) => p['slug'] }
        }
        fields['createdAt'] = { type: new GraphQLNonNull(DateTimeScalar), resolve: (p) => p['created_at'] }
        fields['updatedAt'] = { type: new GraphQLNonNull(DateTimeScalar), resolve: (p) => p['updated_at'] }

        for (const vf of visible) {
          const field = vf.field
          const gqlName = toCamelCase(vf.exposedAs)
          const outType = outputTypeForField(field, vf.required)
          let resolve: GraphQLFieldConfig<Record<string, unknown>, GraphQLContext>['resolve']
          if (field.field_type === 'programmatic') {
            resolve = programmaticFieldResolver(machineName, field.name, mediaFieldNames, fieldKeyMaps[machineName])
          } else if (
            field.field_type === 'reference' ||
            field.field_type === 'paragraph' ||
            field.field_type === 'image' ||
            field.field_type === 'video' ||
            field.field_type === 'file'
          ) {
            resolve = relationFieldResolver(machineName, field.name)
          } else {
            resolve = scalarFieldResolver(field, vf.fallback)
          }
          fields[gqlName] = {
            type: outType,
            resolve,
            // Conditional spread, not `deprecationReason: vf.deprecationReason`
            // — exactOptionalPropertyTypes forbids present-and-undefined.
            ...(vf.deprecationReason !== undefined && { deprecationReason: vf.deprecationReason }),
          }
        }
        return fields
      },
    })
  }
```

- [ ] **Step 5: Build the root query from the view too**

In the content-types loop, replace the `nameMap` line and the two arg builders:

```typescript
  for (const [name, ct] of Object.entries(registry.content_types) as [string, ParsedContentType][]) {
    const objType = objectTypes.get(name)!
    const visible = viewFieldsFor(name, ct)
    // The version's own labels: translateFilters maps a GraphQL name back to a
    // label, and columnFor then takes that label to the storage column.
    const nameMap = buildFieldNameMap(visible.map((v) => v.exposedAs))
```

and:

```typescript
    const filterType = buildFilterInputType(ct, visible)

    queryFields[collectionQueryName(name)] = {
      type: new GraphQLNonNull(listType),
      args: {
        page: { type: GraphQLInt },
        perPage: { type: GraphQLInt },
        sortBy: { type: buildSortFieldEnum(graphqlTypeName(name), fieldKeyMaps[name]) },
        sortOrder: { type: SortOrderEnum },
        ...(filterType ? { filter: { type: filterType } } : {}),
      },
      resolve: collectionResolver(name, nameMap, fieldKeyMaps[name]),
    }
```

In the taxonomy loop, replace the `resolve` line the same way:

```typescript
    queryFields[collectionQueryName(name)] = {
      type: new GraphQLNonNull(listType),
      args: { page: { type: GraphQLInt }, perPage: { type: GraphQLInt } },
      resolve: collectionResolver(
        name,
        buildFieldNameMap(viewFieldsFor(name, tt).map((v) => v.exposedAs)),
        fieldKeyMaps[name]
      ),
    }
```

- [ ] **Step 6: Run the whole api suite and typecheck**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
```

Expected: `52 files, 421 passed` — 409 after Task 2 plus five filter/sort tests (Task 4) minus none, plus the 11 in this task's new file... **trust the named files, not this total**: `schema.versioned` 11 PASS, and `schema.test.ts`, `schema.divergence.test.ts`, `resolvers.divergence.test.ts`, `filters.test.ts` all still PASS. The divergence suites are the ones that prove the no-view path is untouched.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/graphql
git commit -m "feat(api): build the GraphQL schema from a version's own view

Field names come from the served version's labels, nullability from its own
requiredness, and a field whose name or presence differs from current carries
@deprecated with the reason."
```

---

### Task 6: `createGraphQLHandler` takes an endpoint and a projection

Yoga's `graphqlEndpoint` is hardcoded to `/graphql`. The view is built **here** rather than in `app.ts` so the `.` entry keeps no static import of anything under `graphql/` (ADR api/0006) — `app.ts` passes plain projection data, which it already imports as types from core.

**Files:**
- Modify: `packages/api/src/graphql/handler.ts:107-146`
- Test: `packages/api/src/graphql/__tests__/handler.test.ts`

**Interfaces:**
- Produces:
```typescript
export function createGraphQLHandler(
  registry: SchemaRegistry,
  repos: Record<string, ContentRepository<unknown>>,
  fieldKeyMaps: Record<string, FieldKeyMap>,
  resolver: ProgrammaticResolver,
  db: DrizzlePostgresInstance,
  options: ResolvedGraphQLOptions,
  versioning?: {
    endpoint?: string
    projection?: VersionProjection
    currentProjection?: VersionProjection
    currentVersion?: string
  }
): Handler
```
- Task 7 passes `versioning`.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/graphql/__tests__/handler.test.ts`, **inside the existing `describe('createGraphQLHandler', ...)` block** so it reuses that block's real fixtures — `registry`, `repos`, `fieldKeyMaps`, `resolver`, `db`, `baseOptions` and the `post` helper (all defined at `handler.test.ts:63-124`). Its one content type is `content--post` with field `blog_title`:

```typescript
  it('answers on the endpoint it was given, not /graphql', async () => {
    const handler = createGraphQLHandler(registry, repos, fieldKeyMaps, resolver, db, baseOptions, {
      endpoint: '/graphql/v1',
    })
    const app = new Hono()
    app.all('/graphql/v1', handler)

    const res = await app.request('/graphql/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ posts { data { blogTitle } } }' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.posts.data[0].blogTitle).toBe('Hello')
  })

  it('still defaults to /graphql when given no versioning options', async () => {
    // buildApp passes no 7th argument, so this pins the default explicitly.
    const { status, body } = await post(buildApp(baseOptions), '{ posts { data { blogTitle } } }')
    expect(status).toBe(200)
    expect(body.data.posts.data[0].blogTitle).toBe('Hello')
  })

  it('builds a versioned schema when given a projection', async () => {
    // registry's field name EQUALS its column ('blog_title'), so divergence
    // has to come from the projection: v1 exposes that column as
    // `legacy_title`, and current exposes it under its own name.
    const handler = createGraphQLHandler(registry, repos, fieldKeyMaps, resolver, db, baseOptions, {
      endpoint: '/graphql/v1',
      projection: {
        version: 'v1',
        types: {
          'content--post': {
            fields: [{ column_name: 'blog_title', exposed_as: 'legacy_title', required: true }],
          },
        },
      },
      currentProjection: {
        version: 'v2',
        types: {
          'content--post': {
            fields: [{ column_name: 'blog_title', exposed_as: 'blog_title', required: true }],
          },
        },
      },
      currentVersion: 'v2',
    })
    const app = new Hono()
    app.all('/graphql/v1', handler)

    async function ask(query: string) {
      const res = await app.request('/graphql/v1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      return res.json()
    }

    const ok = await ask('{ posts { data { legacyTitle } } }')
    expect(ok.errors).toBeUndefined()
    expect(ok.data.posts.data[0].legacyTitle).toBe('Hello')

    // current's name must not resolve on v1's schema.
    const rejected = await ask('{ posts { data { blogTitle } } }')
    expect(rejected.errors).toBeDefined()
  })

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- handler
```

Expected: FAIL. The 7th argument is a type error; at runtime Yoga 404s `/graphql/v1` because its `graphqlEndpoint` is still `/graphql`, and `legacyTitle` does not exist because no view is built.

- [ ] **Step 3: Implement**

`packages/api/src/graphql/handler.ts` — add imports and replace the signature and the two lines that use them:

```typescript
import type { SchemaRegistry, ContentRepository, VersionProjection } from '@bobbykim/manguito-cms-core'
import { buildVersionView } from './version-view.js'
```

```typescript
export function createGraphQLHandler(
  registry: SchemaRegistry,
  repos: Record<string, ContentRepository<unknown>>,
  fieldKeyMaps: Record<string, FieldKeyMap>,
  resolver: ProgrammaticResolver,
  db: DrizzlePostgresInstance,
  options: ResolvedGraphQLOptions,
  // The view is built HERE, not in app.ts: the `.` entry must keep no static
  // import of anything under graphql/ (ADR api/0006), so app.ts passes the
  // plain projection data it already imports as types from core.
  versioning: {
    endpoint?: string
    projection?: VersionProjection
    currentProjection?: VersionProjection
    currentVersion?: string
  } = {}
): Handler {
  const view =
    versioning.projection !== undefined
      ? buildVersionView({
          registry,
          projection: versioning.projection,
          currentProjection: versioning.currentProjection,
          currentVersion: versioning.currentVersion ?? '',
        })
      : undefined
  const schema = buildGraphQLSchema(registry, fieldKeyMaps, view)
```

and in `createYoga`:

```typescript
    graphqlEndpoint: versioning.endpoint ?? '/graphql',
```

- [ ] **Step 4: Verify**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- handler
pnpm --filter @bobbykim/manguito-cms-api typecheck
```

Expected: all three new tests PASS, every pre-existing handler test PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/graphql/handler.ts packages/api/src/graphql/__tests__/handler.test.ts
git commit -m "feat(api): let the GraphQL handler serve a versioned endpoint

Builds the version view inside the subpath so the root entry keeps no static
import of the graphql module (ADR api/0006)."
```

---

### Task 7: Mount one GraphQL endpoint per live version

**Files:**
- Modify: `packages/api/src/app.ts:293-308` (delete `graphqlRepos`), `:475-503` (the mount block), `:131-139` (CSP)
- Test: `packages/api/src/__tests__/graphql.integration.test.ts`

**Interfaces:**
- Consumes: `createGraphQLHandler(..., versioning)` (Task 6); `buildVersionSurface` and `deprecationHeaders`, already imported at `app.ts:31`.
- Produces: `POST /graphql/<version>` per live version, plus `/graphql` unchanged.

**Safe to delete:** `graphqlRepos` (`app.ts:293`) is referenced only at `:481`, so it dies with the old block. **Do not delete `sortableColumnsFor`** — lines 236 and 244 still use it for the admin repos.

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/__tests__/graphql.integration.test.ts` (this file already has a working app harness; reuse its registry and db setup):

```typescript
describe('graphql — one endpoint per live version', () => {
  it('serves /graphql/v1 and /graphql/v3 when a version model is configured', async () => {
    const app = makeGraphqlApp(TWO_LIVE_MODEL)

    for (const path of ['/graphql/v1', '/graphql/v3', '/graphql']) {
      const res = await app.fetch(new Request(`http://local${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      }))
      expect(res.status, path).toBe(200)
      expect((await res.json()).data.__typename, path).toBe('Query')
    }
  })

  it('registers no version segments when no version model is configured', async () => {
    const app = makeGraphqlApp(undefined)

    const res = await app.fetch(new Request('http://local/graphql/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    }))
    // No versioned endpoint and no catch-all — the app simply has no route.
    expect(res.status).toBe(404)

    const unversioned = await app.fetch(new Request('http://local/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    }))
    expect(unversioned.status).toBe(200)
  })
})
```

Add near the top of that file, after its existing fixtures. It already defines `registry`, `db`, `resolvers`, and imports `createCmsApp` and `createLocalAdapter`; its content type is `content--gqlpost` with field `blog_title` over column `blog_title`:

```typescript
import type { BakedVersionModel } from '../versions'

// content--gqlpost's field NAME equals its column ('blog_title'), so
// divergence has to come from the PROJECTION: v1 exposes that column as
// `blog_title`, v3 as `title`. v2 is deliberately absent from `live` so
// Task 8 has a retired version to probe.
const GQLPOST = 'content--gqlpost'

const TWO_LIVE_MODEL: BakedVersionModel = {
  current: 'v3',
  live: ['v1', 'v3'],
  projections: {
    v1: {
      version: 'v1',
      types: { [GQLPOST]: { fields: [{ column_name: 'blog_title', exposed_as: 'blog_title', required: true }] } },
    },
    v3: {
      version: 'v3',
      types: { [GQLPOST]: { fields: [{ column_name: 'blog_title', exposed_as: 'title', required: true }] } },
    },
  },
}

// `resolvers` is required: the registry carries a programmatic field, and
// createCmsApp's validateResolverBindings throws at startup without it.
function makeGraphqlApp(model: BakedVersionModel | undefined) {
  const built = createCmsApp({
    registry,
    db,
    storage: createLocalAdapter(),
    graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
    resolvers,
    ...(model !== undefined && { versions: model }),
  })
  return built.app
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- graphql.integration
```

Expected: FAIL — `/graphql/v1` 404s, because only `/graphql` is registered.

- [ ] **Step 3: Delete the old single-version block and `graphqlRepos`**

Remove `const graphqlRepos = Object.fromEntries([...])` entirely (`app.ts:293-308`, keeping the explanatory comment block above it — move it onto `makeGraphqlRepo` in the next step), and remove the whole `if (options.graphql?.enabled) { ... }` body at `:475-503`.

- [ ] **Step 4: Write the per-version mount block**

In place of the removed block:

```typescript
  if (options.graphql?.enabled) {
    const gqlOptions = options.graphql

    // GraphQL resolves relations lazily, per selected field, through its own
    // request-scoped dataloaders — so its repos must NOT resolve relations
    // eagerly the way `makeRepo` does. Reusing that factory is actively wrong:
    // its eager pass overwrites a media field's column (the FK column and the
    // field share a name) with the resolved media object, and the dataloader
    // then reads that object back where a UUID is expected.
    //
    // Still public reads: every GraphQL resolver passes `published_only: true`
    // and the dataloaders filter relation targets by published (ADR api/0002).
    // Kept a separate factory from the admin `repos` so a future change there
    // can never silently widen the public surface.
    const makeGraphqlRepo = (_typeName: string, tableName: string, sortableColumns: Set<string>) =>
      createDrizzleContentRepository(db, tableName, { sortableColumns })

    // The same pass list the REST loop uses: one per live version when
    // versioning is configured, then the unversioned pass at current.
    const gqlPasses: Array<{ version: string | null; projectionVersion: string }> = [
      ...(options.versions !== undefined
        ? model.live.map((v) => ({ version: v, projectionVersion: v }))
        : []),
      { version: null, projectionVersion: model.current },
    ]

    type GqlMount = { path: string; version: string | null; handler: Handler | null; error: unknown }
    const mounts: GqlMount[] = gqlPasses.map((pass) => ({
      path: pass.version === null ? '/graphql' : `/graphql/${pass.version}`,
      version: pass.version,
      handler: null,
      error: null,
    }))

    // Loaded via a DYNAMIC import so `graphql`/`graphql-yoga` never load unless
    // a consumer opts in — the `.` entry must stay free of a static dependency
    // on the graphql/ subpath (ADR api/0006). One shared `ready` promise, never
    // a re-import per request.
    const ready = import('./graphql/handler.js')
      .then(({ createGraphQLHandler }) => {
        gqlPasses.forEach((pass, i) => {
          const mount = mounts[i]!
          // Each version builds inside its OWN try/catch. A synchronous throw
          // from one version's schema (e.g. a type-name collision) must not
          // reject the shared promise and take every other version's endpoint
          // down with it.
          try {
            const surface = buildVersionSurface<unknown>({
              ...pass,
              prefix,
              registry,
              model,
              makeRepo: makeGraphqlRepo,
            })
            mount.handler = createGraphQLHandler(
              registry,
              surface.repos,
              surface.fieldKeyMaps,
              programmaticResolver,
              db,
              gqlOptions,
              {
                endpoint: mount.path,
                // Only when versioning is configured: without it every
                // projection is absent and the handler builds from the
                // registry, which is exactly the pre-versioning behaviour.
                ...(options.versions !== undefined && {
                  projection: model.projections[pass.projectionVersion],
                  currentProjection: model.projections[model.current],
                  currentVersion: model.current,
                }),
              }
            )
          } catch (err) {
            mount.error = err
            const message = err instanceof Error ? err.message : String(err)
            process.stderr.write(
              `✗ GraphQL schema failed to initialize for ${mount.path}; it will return 500. ${message}\n`
            )
          }
        })
      })
      .catch((err: unknown) => {
        // The import itself failed, so nothing can serve. Caught so the
        // rejection is HANDLED: an unhandled one would crash the whole process
        // at startup, taking every REST route with it.
        for (const m of mounts) m.error = err
        const message = err instanceof Error ? err.message : String(err)
        process.stderr.write(`✗ GraphQL module failed to load; /graphql will return 500. ${message}\n`)
      })

    const invokeFor =
      (mount: GqlMount): Handler =>
      async (c) => {
        if (!mount.handler && !mount.error) await ready
        if (!mount.handler) {
          return c.json(
            { ok: false, error: { code: 'GRAPHQL_INIT_FAILED', message: 'GraphQL schema failed to initialize' } },
            500
          )
        }
        return mount.handler(c, async () => {})
      }

    // Concrete paths registered BEFORE Task 8's catch-all — Hono matches in
    // registration order, exactly as the REST surface relies on.
    for (const mount of mounts) {
      if (listRateLimit) app.all(mount.path, listRateLimit, invokeFor(mount))
      else app.all(mount.path, invokeFor(mount))
    }
  }
```

- [ ] **Step 5: Relax the CSP to the whole `/graphql` subtree**

`app.ts:131-139` — `graphiqlPath: '/graphql'` is an exact path, so GraphiQL's inline scripts would be blocked on every versioned endpoint. Read `packages/api/src/middleware/security-headers.ts` to see how `graphiqlPath` is compared, and change that comparison from equality to a prefix test (`path === graphiqlPath || path.startsWith(graphiqlPath + '/')`). Keep the option name.

Add to `graphql.integration.test.ts`:

```typescript
  it('relaxes the CSP on a versioned endpoint too, when graphiql is enabled', async () => {
    const built = createCmsApp({
      registry,
      db,
      storage: createLocalAdapter(),
      versions: TWO_LIVE_MODEL,
      graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: true, introspection: true },
      resolvers,
    })

    const res = await built.app.fetch(new Request('http://local/graphql/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    }))

    // Mirror the exact expectation of the existing GraphiQL CSP test in this
    // file (`graphql.integration.test.ts:363`), rather than inventing one.
    expect(res.headers.get('content-security-policy')).toContain("'unsafe-inline'")
  })
```

- [ ] **Step 6: Verify**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- graphql.integration
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
```

Expected: the three new tests PASS; the existing `graphql integration` and `graphql schema-init failure` suites still PASS; typecheck and lint clean.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): mount one GraphQL endpoint per live version

Each version's schema builds in its own try/catch so one failing version
cannot take the others down, and repos come from buildVersionSurface with a
GraphQL factory so sortable columns follow the version's own labels."
```

---

### Task 8: Deprecation headers and the non-live catch-all

**Files:**
- Modify: `packages/api/src/app.ts` — the block from Task 7
- Test: `packages/api/src/__tests__/graphql.integration.test.ts`

**Interfaces:**
- Consumes: `deprecationHeaders`, `classifyVersion` (already imported at `app.ts:31`).

**Ordering is load-bearing.** The header middleware must be registered **before** the `app.all(mount.path, ...)` loop — Hono matches in registration order and a route handler terminates the chain, so middleware added afterwards never runs. The REST loop relies on the same ordering (`app.use` before `registerPublicContentRoutes`).

- [ ] **Step 1: Write the failing test**

Append to `packages/api/src/__tests__/graphql.integration.test.ts`:

```typescript
async function gqlPost(app: ReturnType<typeof makeGraphqlApp>, path: string) {
  return app.fetch(new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ __typename }' }),
  }))
}

describe('graphql — non-live versions', () => {
  it('reports a retired version as a GraphQL error', async () => {
    // v2 was cut and later retired: it is below current and absent from live.
    const res = await gqlPost(makeGraphqlApp(TWO_LIVE_MODEL), '/graphql/v2')
    const body = await res.json()

    expect(body.errors).toBeDefined()
    expect(body.errors[0].extensions.code).toBe('VERSION_RETIRED')
    expect(body.errors[0].message).toContain('v2')
    expect(body.errors[0].message).toContain('v1, v3')
    expect(body.errors[0].extensions.current).toBe('v3')
    expect(body.errors[0].extensions.live).toEqual(['v1', 'v3'])
    // No `ok` envelope — a GraphQL client would not parse it.
    expect(body.ok).toBeUndefined()
  })

  it('reports a version that was never cut as unknown', async () => {
    const res = await gqlPost(makeGraphqlApp(TWO_LIVE_MODEL), '/graphql/v9')
    const body = await res.json()

    expect(body.errors[0].extensions.code).toBe('VERSION_UNKNOWN')
  })

  it('falls through for a segment that is not version-shaped', async () => {
    // Nothing else lives under /graphql today, but the guard must not claim a
    // non-version segment — the same order-independence the REST catch-all
    // gives /api/media/:id.
    const res = await gqlPost(makeGraphqlApp(TWO_LIVE_MODEL), '/graphql/playground')
    expect(res.status).toBe(404)
    const text = await res.text()
    expect(text).not.toContain('VERSION_UNKNOWN')
    expect(text).not.toContain('VERSION_RETIRED')
  })
})

describe('graphql — deprecation headers', () => {
  it('marks an older live version deprecated and names its successor', async () => {
    const res = await gqlPost(makeGraphqlApp(TWO_LIVE_MODEL), '/graphql/v1')

    expect(res.status).toBe(200)
    expect(res.headers.get('deprecation')).toBe('true')
    expect(res.headers.get('link')).toBe('</graphql/v3>; rel="successor-version"')
  })

  it("sends no deprecation headers on the current version's own endpoint", async () => {
    const res = await gqlPost(makeGraphqlApp(TWO_LIVE_MODEL), '/graphql/v3')
    expect(res.headers.get('deprecation')).toBeNull()
  })

  it('warns that the unversioned endpoint floats, once more than one version is live', async () => {
    const res = await gqlPost(makeGraphqlApp(TWO_LIVE_MODEL), '/graphql')
    expect(res.headers.get('deprecation')).toBe('true')
    expect(res.headers.get('warning')).toContain('Pin a version')
  })

  it('stays silent on the unversioned endpoint for a project with one live version', async () => {
    const oneLive: BakedVersionModel = {
      current: 'v1',
      live: ['v1'],
      projections: {
        v1: {
          version: 'v1',
          types: {
            [GQLPOST]: {
              fields: [{ column_name: 'blog_title', exposed_as: 'title', required: true }],
            },
          },
        },
      },
    }
    const res = await gqlPost(makeGraphqlApp(oneLive), '/graphql')
    expect(res.headers.get('deprecation')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm --filter @bobbykim/manguito-cms-api test -- graphql.integration
```

Expected: FAIL — `/graphql/v2` 404s with no body, and no `Deprecation` header appears anywhere.

- [ ] **Step 3: Attach the deprecation headers**

Insert **immediately before** the `for (const mount of mounts)` registration loop from Task 7:

```typescript
    // Reuses the REST helper, so the two surfaces stay diagnosable the same
    // way — including its decision not to nag a project that never opted into
    // versioning. Registered BEFORE the route handlers below: Hono matches in
    // registration order and a handler terminates the chain, so middleware
    // added afterwards would never run.
    for (const mount of mounts) {
      const headers = deprecationHeaders({
        requested: mount.version,
        model,
        successor: `/graphql/${model.current}`,
      })
      if (headers === null) continue
      const attach: MiddlewareHandler = async (c, next) => {
        await next()
        for (const [key, value] of Object.entries(headers)) c.res.headers.set(key, value)
      }
      app.use(mount.path, attach)
    }
```

- [ ] **Step 4: Add the catch-all**

Insert **after** the registration loop, still inside the `if (options.graphql?.enabled)` block:

```typescript
    // Registered last, so it is only reached by a request that matched no live
    // version's endpoint above. `not-a-version` falls through, which keeps the
    // guard from claiming any non-version segment under /graphql.
    if (options.versions !== undefined) {
      app.all('/graphql/:version', async (c, next) => {
        const segment = c.req.param('version')
        const kind = classifyVersion(segment, model)
        if (kind === 'not-a-version' || kind === 'live') return next()

        const live = model.live.join(', ')
        // GraphQL's own error shape, not the { ok, error } envelope: the caller
        // is a GraphQL client, and Apollo or urql handed a body they do not
        // recognise reports "unexpected response" — hiding the one message a
        // pinned consumer actually needs to read.
        //
        // Status 200, unlike REST's 410/404 for the same conditions. A
        // GraphQL client surfaces `errors` from a 200 as readable GraphQL
        // errors but a 4xx as an opaque network error, which would defeat the
        // point of choosing this shape. The divergence is deliberate and
        // recorded in the 2e design's residuals.
        return c.json({
          errors: [
            {
              message:
                kind === 'retired'
                  ? `Version ${segment} is no longer served. Live versions: ${live}.`
                  : `Version ${segment} does not exist. Live versions: ${live}.`,
              extensions: {
                code: kind === 'retired' ? 'VERSION_RETIRED' : 'VERSION_UNKNOWN',
                current: model.current,
                live: model.live,
              },
            },
          ],
        })
      })
    }
```

- [ ] **Step 5: Verify**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
```

Expected: the seven new tests PASS; every earlier suite still PASS; typecheck and lint clean.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src
git commit -m "feat(api): answer non-live GraphQL versions in GraphQL's error shape

A retired or never-cut version returns errors[] with the same codes the REST
surface uses, and older live versions carry the REST deprecation headers."
```

---

### Task 9: End-to-end integration against real Postgres

Every Critical found in 2c and 2d came from **probing a running surface**, not from reading code. A green unit test named for a property nobody implemented is how 2d's inbound bug stayed invisible through eight scoped reviews. This task is that probe.

**Files:**
- Create: `packages/api/src/__tests__/graphql-versioned.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.

- [ ] **Step 1: Write the suite**

Create `packages/api/src/__tests__/graphql-versioned.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createPostgresAdapter } from '@bobbykim/manguito-cms-db'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import type { SchemaRegistry, ParsedContentType, ParsedRole } from '@bobbykim/manguito-cms-core'
import { createCmsApp } from '../app'
import { createLocalAdapter } from '../storage/adapters/local'
import type { BakedVersionModel } from '../versions'

const DB_URL = process.env['DB_URL']
if (!DB_URL) throw new Error('DB_URL must be set in .env.test before running integration tests')

const TABLE = 'api_int_gqlver_blog'
const TYPE_NAME = 'content--gqlver_blog'

// ─── Schema fixture ───────────────────────────────────────────────────────────
//
// `title` over column `blog_title` — label and column diverge, which is the
// only reason these tests can tell versions apart. `subtitle` over column
// `blog_sub` is CURRENT-ONLY: it does not exist in v1's projection, and it is
// what the leak probe below looks for. `legacy_desc` is a tombstone retaining
// column `blog_desc`, which v1 still exposes with a fallback.

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type',
  name: TYPE_NAME,
  label: 'GraphQL Version Blog',
  source_file: 'test.yml',
  only_one: false,
  default_base_path: 'gqlver-blog',
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [
    {
      name: 'title', label: 'Title', field_type: 'text/plain',
      required: false, nullable: true, order: 0, validation: { required: false },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'subtitle', label: 'Subtitle', field_type: 'text/plain',
      required: false, nullable: true, order: 1, validation: { required: false },
      db_column: { column_name: 'blog_sub', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
    },
    {
      name: 'legacy_desc', label: 'Legacy Description', field_type: 'text/plain',
      required: false, nullable: true, order: 2, validation: { required: false },
      db_column: { column_name: 'blog_desc', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' },
      removed: true,
    },
  ],
  ui: { tabs: [] },
  db: { table_name: TABLE, junction_tables: [] },
  api: {
    default_base_path: 'gqlver-blog',
    http_methods: ['GET'],
    item_path: '/api/gqlver-blog/:slug',
  },
}

const SYSTEM_ROLES: ParsedRole[] = [
  { name: 'admin',   label: 'Admin',   is_system: true, hierarchy_level: 0, permissions: [] },
  { name: 'manager', label: 'Manager', is_system: true, hierarchy_level: 1, permissions: [] },
  { name: 'editor',  label: 'Editor',  is_system: true, hierarchy_level: 2, permissions: [] },
  { name: 'writer',  label: 'Writer',  is_system: true, hierarchy_level: 3, permissions: [] },
  { name: 'viewer',  label: 'Viewer',  is_system: true, hierarchy_level: 4, permissions: [] },
]

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] },
  roles: { roles: SYSTEM_ROLES, valid_permissions: [] },
  schemas: {},
  content_types: { [TYPE_NAME]: BLOG_TYPE },
  paragraph_types: {},
  taxonomy_types: {},
  enum_types: {},
  all_schemas: [],
}

// v1: the original name, plus the since-tombstoned column with a fallback, and
// NO subtitle — it predates that field. v3 (current): the renamed label and
// subtitle, and no blog_desc.
const MODEL: BakedVersionModel = {
  current: 'v3',
  live: ['v1', 'v3'],
  projections: {
    v1: {
      version: 'v1',
      types: {
        [TYPE_NAME]: {
          fields: [
            { column_name: 'blog_title', exposed_as: 'blog_title', required: false },
            { column_name: 'blog_desc', exposed_as: 'blog_desc', required: false, fallback: 'NO DESC' },
          ],
        },
      },
    },
    v3: {
      version: 'v3',
      types: {
        [TYPE_NAME]: {
          fields: [
            { column_name: 'blog_title', exposed_as: 'title', required: false },
            { column_name: 'blog_sub', exposed_as: 'subtitle', required: false },
          ],
        },
      },
    },
  },
}

const pgAdapter = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pgAdapter.connect()
  db = pgAdapter.getDb()
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${TABLE}" (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        VARCHAR   NOT NULL UNIQUE,
      published   BOOLEAN   NOT NULL DEFAULT false,
      blog_title  VARCHAR,
      blog_sub    VARCHAR,
      blog_desc   VARCHAR,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `))
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${TABLE}" CASCADE`))
  await pgAdapter.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE TABLE "${TABLE}" RESTART IDENTITY CASCADE`))
  // blog_desc is NULL — a row written after the column stopped being written,
  // which is exactly when v1 must serve the declared fallback.
  await db.execute(sql.raw(`
    INSERT INTO "${TABLE}" (slug, published, blog_title, blog_sub, blog_desc)
    VALUES ('hello-world', true, 'Hello', 'Sub', NULL)
  `))
})

function app() {
  const { app } = createCmsApp({
    storage: createLocalAdapter(),
    registry: REGISTRY,
    db,
    versions: MODEL,
    graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
  })
  return app
}

async function query(path: string, source: string) {
  const res = await app().fetch(new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: source }),
  }))
  return { status: res.status, headers: res.headers, body: await res.json() }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('versioned GraphQL — the feature', () => {
  it('serves one column under each version’s own field name', async () => {
    const v1 = await query('/graphql/v1', '{ gqlverBlogs { data { blogTitle } } }')
    expect(v1.body.errors).toBeUndefined()
    expect(v1.body.data.gqlverBlogs.data[0].blogTitle).toBe('Hello')

    const v3 = await query('/graphql/v3', '{ gqlverBlogs { data { title } } }')
    expect(v3.body.errors).toBeUndefined()
    expect(v3.body.data.gqlverBlogs.data[0].title).toBe('Hello')
  })

  it("rejects the other version's field name on each endpoint", async () => {
    const v1 = await query('/graphql/v1', '{ gqlverBlogs { data { title } } }')
    expect(v1.body.errors).toBeDefined()

    const v3 = await query('/graphql/v3', '{ gqlverBlogs { data { blogTitle } } }')
    expect(v3.body.errors).toBeDefined()
  })

  it('serves current’s shape on the unversioned endpoint', async () => {
    const res = await query('/graphql', '{ gqlverBlogs { data { title subtitle } } }')
    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.gqlverBlogs.data[0].title).toBe('Hello')
  })
})

describe('versioned GraphQL — no leakage across versions', () => {
  it('does not expose a column added after v1 was cut', async () => {
    // 2d's Critical, in GraphQL's form. `subtitle` is live in current and
    // absent from v1's projection; if the schema were built from the registry
    // rather than the view, v1 would serve it.
    const res = await query('/graphql/v1', '{ gqlverBlogs { data { subtitle } } }')

    expect(res.body.errors).toBeDefined()
    expect(JSON.stringify(res.body)).not.toContain('Sub')
  })

  it('does not expose a tombstoned column on current', async () => {
    const res = await query('/graphql/v3', '{ gqlverBlogs { data { legacyDesc } } }')
    expect(res.body.errors).toBeDefined()
  })

  it('serves the retained column on v1, with the declared fallback', async () => {
    // The row's blog_desc is NULL. v1 still serves the column, so it must
    // present the fallback rather than null.
    const res = await query('/graphql/v1', '{ gqlverBlogs { data { blogDesc } } }')
    expect(res.body.errors).toBeUndefined()
    expect(res.body.data.gqlverBlogs.data[0].blogDesc).toBe('NO DESC')
  })
})

describe('versioned GraphQL — introspection tells a pinned consumer what breaks', () => {
  const INTROSPECT = `{
    __type(name: "GqlverBlog") {
      fields(includeDeprecated: true) {
        name
        isDeprecated
        deprecationReason
      }
    }
  }`

  it('marks v1’s renamed field deprecated, naming current’s label', async () => {
    const res = await query('/graphql/v1', INTROSPECT)
    const fields = res.body.data.__type.fields as Array<{
      name: string; isDeprecated: boolean; deprecationReason: string | null
    }>
    const blogTitle = fields.find((f) => f.name === 'blogTitle')

    expect(blogTitle).toBeDefined()
    expect(blogTitle!.isDeprecated).toBe(true)
    expect(blogTitle!.deprecationReason).toBe("Renamed to 'title' in v3.")
  })

  it('marks v1’s retained column deprecated as removed', async () => {
    const res = await query('/graphql/v1', INTROSPECT)
    const fields = res.body.data.__type.fields as Array<{ name: string; deprecationReason: string | null }>

    expect(fields.find((f) => f.name === 'blogDesc')!.deprecationReason)
      .toBe('Removed in v3; column retained while this version is live.')
  })

  it('deprecates nothing on current', async () => {
    const res = await query('/graphql/v3', INTROSPECT)
    const fields = res.body.data.__type.fields as Array<{ name: string; isDeprecated: boolean }>
    expect(fields.every((f) => f.isDeprecated === false)).toBe(true)
  })
})

describe('versioned GraphQL — sorting per version', () => {
  it('accepts the label each version actually exposes and orders by the column', async () => {
    await db.execute(sql.raw(`
      INSERT INTO "${TABLE}" (slug, published, blog_title) VALUES ('aaa', true, 'Aaa')
    `))

    // v3 exposes label `title`, so `sortBy: title` resolves to column
    // blog_title. v1 exposes it as `blog_title`, so its enum has no `title`
    // value at all — offering one would reach SQL as ORDER BY "title".
    const v3 = await query('/graphql/v3', '{ gqlverBlogs(sortBy: title, sortOrder: ASC) { data { title } } }')
    expect(v3.body.errors).toBeUndefined()
    expect(v3.body.data.gqlverBlogs.data.map((r: { title: string }) => r.title)).toEqual(['Aaa', 'Hello'])

    const v1 = await query('/graphql/v1', '{ gqlverBlogs(sortBy: title) { data { blogTitle } } }')
    expect(v1.body.errors).toBeDefined()
    expect(v1.body.errors[0].message).toContain('title')
  })
})
```

- [ ] **Step 2: Run it**

```bash
docker compose up -d manguito-test-db
pnpm --filter @bobbykim/manguito-cms-api test -- graphql-versioned
```

Expected: all 12 PASS. **If any fails, the failure is real** — do not weaken the assertion. In particular, the two leak probes and the sorting probe are the ones that caught Criticals in 2d; a failure there means a version is serving something it should not.

> `gqlverBlogs` is `collectionQueryName('content--gqlver_blog')` = `pluralize(toCamelCase('gqlver_blog'))`. If the generated name differs, read `naming.ts` and use the real one rather than renaming the fixture.

- [ ] **Step 3: Full verification across the workspace**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
pnpm --filter @bobbykim/manguito-cms-core test
pnpm --filter @bobbykim/manguito-cms-cli test
pnpm build
```

Expected: all green. `pnpm build` must succeed because `cli`'s codegen emits a `BakedVersionModel` typed against the new projection shape.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/__tests__/graphql-versioned.integration.test.ts
git commit -m "test(api): probe the versioned GraphQL surface end to end

Covers the two cross-version leak paths, per-version fallbacks and sorting,
and the introspected deprecation reasons a pinned consumer reads."
```

---

### Task 10: Documentation and changesets

**Files:**
- Modify: `docs/v2/graphql-module.md`, `docs/v2/graphql-schema-mapping.md`, `docs/v2/graphql-security.md`
- Create: `.changeset/graphql-versioning.md`

- [ ] **Step 1: Record the versioned surface in the module docs**

`docs/v2/graphql-module.md` — its "Scope" section says "A single `/graphql` endpoint on the **public** API". Replace that bullet with:

```markdown
- A `/graphql` endpoint on the **public** API, plus one per live schema version
  at `/graphql/<version>` when the project has cut a version. `/graphql` floats
  to the current version; a pinned endpoint serves a frozen contract. See
  [the 2e design](../superpowers/specs/2026-09-21-graphql-versioning-design.md).
```

Add to its "Locked decisions at a glance" table:

```markdown
| Schema versioning | One schema per live version at `/graphql/<version>`; superseded names carry `@deprecated`. Not a single union schema — see the 2e design |
```

- [ ] **Step 2: Record the mapping rules**

Append to `docs/v2/graphql-schema-mapping.md`:

```markdown
## Versioned schemas

When a project has cut a schema version, each live version gets its own
`GraphQLSchema`, built from that version's projection rather than the current
registry:

- A field's GraphQL name comes from the label **that version** exposes the
  column under, so a rename changes the field name per version over one column.
- Nullability comes from the version's own `required`, never current's. A field
  nullable when the version was cut stays nullable on its schema.
- `field_type` and `ui_component` are recovered from current's field for the
  same column, which `FIELD_TYPE_CHANGED_WHILE_LIVE` and
  `VERSION_COLUMN_MISSING` make sound.
- A field whose name or presence differs from current carries `@deprecated`
  with the reason, so a pinned consumer can introspect what an upgrade changes.
- A column a version declares a `fallback` for serves that value when the
  column is null — matching REST's `projectRow`.

**Not versioned:** paragraph types, programmatic fields, many-to-many
references and enum types. None are column-backed (or projected at all), so
they follow the current schema on every version. `manguito version:diff` still
reports paragraph renames the served contract does not honour.

**Tombstones are never exposed.** A field marked `removed: true` retains its
column for older live versions and is excluded from every schema that declares
it — including the unversioned `/graphql`.
```

- [ ] **Step 3: Record the error posture**

Append to `docs/v2/graphql-security.md`:

```markdown
## Non-live versions

`/graphql/<version>` for a version that is retired or was never cut answers
with GraphQL's own error shape — `errors[]` carrying `VERSION_RETIRED` or
`VERSION_UNKNOWN` in `extensions.code`, alongside `current` and `live` — and
HTTP 200, not the `{ ok, error }` envelope and not the REST surface's 410/404.

A GraphQL client surfaces `errors` from a 200 as readable GraphQL errors but a
4xx as an opaque network error, so the REST codes would hide the one message a
pinned consumer needs. A segment that is not version-shaped falls through
rather than being claimed.
```

- [ ] **Step 4: Write the changeset**

Create `.changeset/graphql-versioning.md`:

```markdown
---
'@bobbykim/manguito-cms-core': minor
'@bobbykim/manguito-cms-api': minor
---

Serve every live schema version over GraphQL.

Each live version gets its own schema at `/graphql/<version>`, built from that
version's projection: field names come from the labels that version exposes,
nullability from its own requiredness, and a field renamed or removed since
carries `@deprecated` naming what replaced it. `/graphql` is unchanged and
still floats to the current version, and a project that has not cut a version
sees no new endpoints.

`VersionProjection` gains `required` so each version states its own
nullability. Borrowing the current schema's flag would emit a non-null GraphQL
type over rows holding nulls and null out the whole parent object.

Also fixes two bugs on the GraphQL surface: tombstoned fields (`removed: true`)
were built into the schema and served their retained data, and the sort enum
offered `title` on types that have no field with that label, producing a 500
from SQL rather than a rejected query.
```

- [ ] **Step 5: Verify and commit**

```bash
pnpm build
pnpm test
```

```bash
git add docs/v2 .changeset
git commit -m "docs(api): document the versioned GraphQL surface"
```

- [ ] **Step 6: Open the PR**

```bash
git push -u origin docs/graphql-versioning
gh pr create --title "feat(api): versioned GraphQL surface (schema versioning 2e)" --body "$(cat <<'BODY'
Serves every live schema version over GraphQL — one schema per version at
`/graphql/<version>` — from the same projections the REST routes use.

Implements `docs/superpowers/specs/2026-09-21-graphql-versioning-design.md`.

## Why not one union schema

The parent design deferred "`@deprecated` retained fields and rename aliases"
to this sub-project, which presumed a single evolving schema. That approach
cannot offer pinning — the point of the feature — and would need a new core
validation for cross-version label reuse that REST deliberately does not
require. Recorded in the design.

## Two bugs fixed on the way

- **Tombstoned fields were exposed over GraphQL.** The api's tombstone
  exclusion lived only in the `FieldKeyMap` drop-set, which REST applies
  through `remap`; GraphQL resolves per field by column and never consults it.
- **The sort enum offered `title` on every type**, with no field information,
  so a type without that label handed the repository a label mapping to no
  column.

## Verification

Probed end to end against Postgres, not just unit tested: a column added after
v1 was cut is absent from v1's schema, a tombstone is absent from current, v1
serves its declared fallback for the retained column, and introspection
reports the deprecation reasons a pinned consumer reads.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Plan Self-Review

**Spec coverage.** Every spec section maps to a task: the core change → 1; tombstone exposure → 2; deriving a version's types, the boundary and fallbacks → 3; query args → 4; deprecation directives → 3 + 5; endpoint shape and per-version registration → 6 + 7; the two init refinements → 7; failure modes and deprecation headers → 8; testing → 2/3/4/5/6/9; deliverables → 10.

**Known deliberate omissions**, all recorded in the spec's residuals: the paragraph-type boundary stays open; `buildFieldNameMap` still does not detect two labels collapsing to one camelCase GraphQL name; public taxonomy collections still ignore filter/sort/include on both surfaces; a union `/graphql` for gradual migration is not built.

**Type consistency.** `ViewField` / `VersionView` / `buildVersionView` are defined in Task 3 and used with those exact names in 4, 5 and 6. `exposedFields` is introduced in Task 2 and consumed in 5. `buildSortFieldEnum(typeName, fieldKeys?)` and `buildFilterInputType(type, viewFields?)` are declared in Task 4 and called with those signatures in Task 5. `scalarFieldResolver(field, fallback?)` is widened in Task 5 and used there only. `createGraphQLHandler`'s 7th parameter is declared in Task 6 and passed in Task 7.

**Baselines are measured, not assumed:** core `247`, api `405` at commit `89ef26d`. Running totals in later tasks are marked indicative; the named test files and the deltas are what to trust.
