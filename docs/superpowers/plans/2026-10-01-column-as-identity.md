# Column as Identity Implementation Plan (Schema Versioning 2f)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a field's storage column its internal identity throughout the api, so a label — current's or a live version's — is applied exactly once, at the response boundary.

**Architecture:** Resolved relations stop migrating from their column to their field name during resolution, so they flow through `toLabels` the way scalars already do. The field-key map's single drop-set splits into one per key space, because `toLabels` reads columns and `toStorage` reads labels and the two can share text. Programmatic resolvers are handed a record in current's labels, and the GraphQL filter name map learns about system fields.

**Tech Stack:** TypeScript strict (Node 22+), Hono, graphql-js + GraphQL Yoga, Drizzle + Postgres, Vitest, pnpm workspace + Turborepo + Changesets.

**Spec:** `docs/superpowers/specs/2026-10-01-column-as-identity-design.md` — read it before Task 1. Its "Consequence for existing tests" table is binding.

## Global Constraints

- **Never commit to `master`.** This plan runs on branch `docs/column-as-identity`.
- **Commit format:** conventional commits, `type(scope): subject`, scope = package (`api`). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **`exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true`** (`tsconfig.base.json`). An optional property may be *absent* but never *present-and-undefined*; the repo idiom is `...(x !== undefined && { key: x })`.
- **Import extensions:** SOURCE files under `packages/api/src/` use explicit `.js` in relative imports. TEST files under `__tests__/` use extensionless relative imports.
- **Every task's gates are `test`, `typecheck`, `lint` and `build`** (PLAN-QUALITY rule 7). Vitest transpiles without type-checking, so green tests prove nothing about types or lint. Run all four: `pnpm --filter @bobbykim/manguito-cms-api test`, `... typecheck`, `... lint`, and `pnpm build`.
- **`createFieldKeyMapFromProjection`'s parameter has no `required` property.** A projection written inline as an object literal must omit `required`, or `tsc` rejects it as an excess property. (Through a variable, as most existing tests do, it is accepted.)
- **No unsuppressed `as any` in tests.** Read an arbitrary JSON or GraphQL body with a typed shape cast.
- **Every new test states the mutation it rejects, and the task verifies it** (PLAN-QUALITY rule 1). Apply the mutation, watch the test fail, restore, watch it pass. A test that passes under its own mutation is decoration.
- **Integration tests need Postgres** on host port 5435: `pnpm db:test:up`, then wait for `docker exec manguito-cms-manguito-test-db-1 pg_isready -U postgres`. The suite reads `DB_URL` from the repo-root `.env.test`.
- **Measured baselines at the branch point (`1d97ef6`, 2026-10-01):** api `54 files, 470 passed`; core `247 passed | 2 todo`; cli `100`; db `89`; admin `69`. Running totals later in this plan are *indicative*. Trust the named test files and each task's stated delta, never an absolute total.
- **The api is the only package that changes.** If a task finds itself editing `packages/core`, stop and report.

## Review Focus

The five inputs most likely to bite a person using this, that the spec implies but does not spell out as a test. Each is pinned in the task that owns its code.

1. **A relation whose foreign key is NULL, on an older version** — must come back as the key with `null`, not as a missing key. Today the null branch deletes the column too, so optional relations vanish exactly like set ones. → **Task 1**
2. **A relation added to current after an older version was cut** — must stay absent from that version's response even once it has been resolved into the row. Section 1 puts resolved objects under columns, which is precisely where the drop-set has to catch it. → **Task 1** (and must keep passing through Task 3)
3. **Many items sharing one related target, included on an older version** — every item must get the resolved target, correctly projected. The relation cache hands the *same* object to every parent, so any in-place mutation corrupts the second one. → **Task 2**
4. **An admin read-then-write of a renamed relation** — the admin panel reads through `toLabels` and writes through `toStorage`, and both directions change in this plan. The value must survive the round trip. → **Task 3**
5. **One GraphQL query that selects a media field directly *and* runs a programmatic resolver that reads it** — the parent row is loaded in place while the resolver loads into a copy, in either order. Both must see the resolved object. → **Task 4**

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/api/src/relations.ts` | `resolveRelationField`'s reference and media branches write in place under the column; `needsFkResolution` simplifies | 1 |
| `packages/api/src/graphql/dataloaders.ts` | the loader returns a column-backed relation from its column | 1 |
| `packages/api/src/projector.ts` | `nestedTargets` builds `nested` from this version's label for the column | 1 |
| `packages/api/src/routes/content.ts` | `?include=` translates this version's label to the registry name; programmatic merge | 2, 4 |
| `packages/api/src/field-keys.ts` | the drop-set splits into `droppedColumns` / `droppedLabels`; the collision check narrows | 3 |
| `packages/api/src/graphql/resolvers.ts` | `resolveProgrammaticRow` uses current's map; `relabelMedia` and `MediaFieldKey` are deleted | 4 |
| `packages/api/src/graphql/schema.ts` | current's maps for the programmatic path; system fields in the filter name map | 4, 5 |
| `packages/api/src/graphql/handler.ts` | forwards current's field-key maps to the schema build | 4 |
| `packages/api/src/app.ts` | passes current's projectors and field-key maps to every version's REST routes and GraphQL handler | 4 |
| `packages/api/src/__tests__/column-identity.integration.test.ts` | **new** — the end-to-end suite, built up task by task | 1–5 |
| `docs/v2/graphql-schema-mapping.md`, `docs/programmatic-fields.md` | the resolver-authoring contract | 4, 6 |
| `docs/superpowers/specs/2026-09-21-graphql-versioning-design.md` | its residuals, marked closed | 6 |
| `.changeset/column-as-identity.md` | **new** — one minor bump of the api | 6 |

---

### Task 1: Relations stay column-keyed (closes #1a)

`resolveRelationField`'s reference and media branches currently write the resolved object under the field's **name** and delete its storage **column**. On an older version that labels the column differently, `toLabels` then has nothing under the column to map, and the drop-set discards the name — so the relation vanishes. Write it in place under the column instead, which is exactly what these branches already do whenever a field's name equals its column.

**Files:**
- Modify: `packages/api/src/relations.ts` — `needsFkResolution`, and the reference and media branches of `resolveRelationField`
- Modify: `packages/api/src/graphql/dataloaders.ts` — the batch function inside `loaderFor`
- Modify: `packages/api/src/projector.ts` — `nestedTargets` and its call in `buildProjectors`
- Test: `packages/api/src/__tests__/relations.test.ts`, `packages/api/src/graphql/__tests__/dataloaders.test.ts`, `packages/api/src/__tests__/projector.test.ts`
- Update (models obsolete behaviour): `packages/api/src/graphql/__tests__/resolvers.divergence.test.ts`, `packages/api/src/graphql/__tests__/schema.versioned.test.ts`
- Create: `packages/api/src/__tests__/column-identity.integration.test.ts`

**Interfaces:**
- Produces: after `resolveRelationField`, a column-backed relation's resolved object (or `null`) lives at `row[rel.fk_column]`, and `row[fieldName]` is **not** written for reference or media relations. Paragraph and junction relations are unchanged and still land at `row[fieldName]`.
- Produces: `needsFkResolution(row, fkColumn): boolean` — two parameters, not three.
- Produces: `TypeProjector.nested[].label` is the label **this version** exposes the field's column under.
- Produces: the integration file's fixture — content type `colid-blog` (tables `api_int_colid_blog` / `api_int_colid_cat`) with `category` over `category_id` and `hero` over `blog_hero_image`, and a `BakedVersionModel` where v1 labels them `legacy_cat` / `legacy_hero` and v3 labels them `category` / `hero`. Tasks 2–5 append to this file.

- [ ] **Step 1: Rewrite the relations test that asserts the move, and add four new ones**

In `packages/api/src/__tests__/relations.test.ts`, replace the test `'resolves into the label and drops the raw FK key'` with the version below, then append the four new tests inside a new `describe`. Add these imports beneath the file's existing ones (it currently imports only `vitest`, `resolveRelationField` and `DrizzlePostgresInstance`):

```typescript
import { createFieldKeyMapFromProjection } from '../field-keys'
import { divergentTextField, divergentMediaField } from '../field-keys.test-fixtures'
```
 The test `'still overwrites in place when label and column are identical'` stays exactly as it is — it already describes the new behaviour for every field.

```typescript
  it('resolves in place under the storage column, never under the field name', async () => {
    // MUTATION: restore `row[fieldName] = …; if (dropFk) delete row[rel.fk_column]`
    // in the media branch. The object then lands under `hero` and the column
    // disappears, so both assertions fail.
    const rows = [{ id: 'c1', blog_hero_image: 'm1' }]
    const db = mediaDb([{ id: 'm1', url: '/uploads/a.png' }])

    await resolveRelationField(db, rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', blog_hero_image: { id: 'm1', url: '/uploads/a.png' } })
    expect(rows[0]).not.toHaveProperty('hero')
  })
```

```typescript
describe('resolveRelationField — column-keyed resolution', () => {
  it('resolves a divergent reference in place under its storage column', async () => {
    // MUTATION: restore the name-keyed write in the REFERENCE branch.
    const rows = [{ id: 'p1', category_id: 'c1' }]
    const db = mediaDb([{ id: 'c1', name: 'Cat One' }])

    await resolveRelationField(db, rows, 'category', {
      type: 'reference',
      table: 'cats',
      fk_column: 'category_id',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'p1', category_id: { id: 'c1', name: 'Cat One' } })
    expect(rows[0]).not.toHaveProperty('category')
  })

  it('keeps the column present as null when the foreign key is null', async () => {
    // Review Focus #1. MUTATION: restore `row[fieldName] = null; if (dropFk)
    // delete row[rel.fk_column]` in the media branch's empty-FK path. The column
    // is deleted, so `in` returns false.
    const rows: Array<Record<string, unknown>> = [{ id: 'c1', blog_hero_image: null }]

    await resolveRelationField(mediaDb([]), rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    expect(rows[0]).toEqual({ id: 'c1', blog_hero_image: null })
    expect('blog_hero_image' in rows[0]!).toBe(true)
  })

  it('is idempotent: a second pass over an already-resolved row does not re-resolve it', async () => {
    // needsFkResolution exists because reference targets are cached by table:id,
    // so the same object reaches several parents and a row may be visited twice.
    // MUTATION: make needsFkResolution always return true. The second pass then
    // treats the resolved object as a foreign key, queries again, and overwrites
    // the row with null — both assertions fail.
    const rows: Array<Record<string, unknown>> = [{ id: 'c1', blog_hero_image: 'm1' }]
    let queries = 0
    const db = {
      execute: async () => {
        queries++
        return { rows: [{ id: 'm1', url: '/a.png' }] }
      },
    } as unknown as DrizzlePostgresInstance
    const cache = new Map<string, unknown>()
    const rel = { type: 'media' as const, fk_column: 'blog_hero_image' }

    await resolveRelationField(db, rows, 'hero', rel, cache)
    const first = rows[0]!['blog_hero_image']
    // Without this, the test passes vacuously on the ORIGINAL code: there the
    // first pass deletes the column, so `first` is undefined and toBe below
    // compares undefined with undefined.
    expect(first).toEqual({ id: 'm1', url: '/a.png' })
    await resolveRelationField(db, rows, 'hero', rel, cache)

    expect(rows[0]!['blog_hero_image']).toBe(first)
    expect(queries).toBe(1)
  })

  it("does not serve a resolved relation under another field's label on an older version", async () => {
    // The spec's reference-collision case, and where today's code genuinely
    // mis-serves data. v1 exposes the TITLE's column under the label `hero`, and
    // does not expose the media column at all. Today the media object is written
    // under its name `hero`, which no drop-set entry covers, so it passes through
    // toLabels and overwrites the title that v1 legitimately calls `hero`.
    // MUTATION: restore the name-keyed media write. The output is then
    // `{ id: 'p1', hero: { id: 'm1' } }`.
    const rows: Array<Record<string, unknown>> = [{ id: 'p1', blog_title: 'T', blog_hero_image: 'm1' }]
    await resolveRelationField(mediaDb([{ id: 'm1' }]), rows, 'hero', {
      type: 'media',
      fk_column: 'blog_hero_image',
    }, new Map())

    const v1 = createFieldKeyMapFromProjection(
      { fields: [{ column_name: 'blog_title', exposed_as: 'hero' }] },
      [divergentTextField, divergentMediaField]
    )

    expect(v1.toLabels(rows[0]!)).toEqual({ id: 'p1', hero: 'T' })
  })
})
```

- [ ] **Step 2: Add the dataloader test**

Append to `packages/api/src/graphql/__tests__/dataloaders.test.ts`. The file already imports `createRelationLoaders` and `SchemaRegistry`; add only the two imports below that it lacks, beneath the existing ones. The block shows all four so the test reads whole — do not duplicate the two that exist. It exercises the **real** loader and the real `resolveRelationField` together, which is the only way to prove the loader reads the key the resolver writes.

```typescript
// already present: createRelationLoaders from '../dataloaders', SchemaRegistry from core
import { divergentMediaField } from '../../field-keys.test-fixtures'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

describe('createRelationLoaders — column-backed relations', () => {
  it('returns a media relation from its storage column, not the field name', async () => {
    // divergentMediaField is `hero` over `blog_hero_image`, so name and column
    // differ and the test cannot pass under the wrong one.
    // MUTATION: restore `return rows.map((r) => r[fieldName])` in the loader.
    // resolveRelationField now writes `blog_hero_image`, so reading `hero`
    // returns undefined.
    const registry = {
      content_types: {
        'content--post': {
          schema_type: 'content-type',
          name: 'content--post',
          fields: [divergentMediaField],
          db: { table_name: 'post' },
        },
      },
      taxonomy_types: {},
      paragraph_types: {},
      enum_types: {},
    } as unknown as SchemaRegistry
    const db = {
      execute: async () => ({ rows: [{ id: 'm1', url: '/a.png' }] }),
    } as unknown as DrizzlePostgresInstance

    const loaders = createRelationLoaders(db, registry)
    const parent = { id: 'p1', blog_hero_image: 'm1' }

    expect(await loaders.load('content--post', 'hero', parent)).toEqual({ id: 'm1', url: '/a.png' })
  })
})
```

- [ ] **Step 3: Add the projector tests**

Append to `packages/api/src/__tests__/projector.test.ts`. Merge the imports into the file's existing ones rather than adding duplicate lines: add `ParsedField` to the `@bobbykim/manguito-cms-core` type import, `createFieldKeyMapFromProjection` to the `'../field-keys'` import, and `divergentReferenceField` to the `'../field-keys.test-fixtures'` import (`buildProjectors` and `projectRow` are already imported). The target type's field is **deliberately divergent** (`name` over `cat_name`): if it were not, projecting the nested category would be a no-op and the first test could not tell whether recursion happened.

```typescript
// The reference's TARGET, with a field whose name and column differ, so a
// nested projection that runs is distinguishable from one that does not.
const catNameField: ParsedField = {
  name: 'name',
  label: 'Name',
  field_type: 'text/plain',
  required: false,
  nullable: true,
  order: 0,
  validation: { required: false },
  db_column: { column_name: 'cat_name', column_type: 'varchar', nullable: true },
  ui_component: { component: 'text-input' },
}

// divergentReferenceField is `category` over `category_id`, ref taxonomy--category.
const nestedRegistry = {
  content_types: {
    'content--post': { schema_type: 'content-type', name: 'content--post', fields: [divergentReferenceField] },
  },
  taxonomy_types: {
    'taxonomy--category': { schema_type: 'taxonomy-type', name: 'taxonomy--category', fields: [catNameField] },
  },
  paragraph_types: {},
  enum_types: {},
} as unknown as SchemaRegistry

describe('projectRow — relations resolved under their column', () => {
  it('recurses into a reference under the label this version exposes it as', () => {
    // v1 labels column category_id as `legacy_cat`. The resolved category sits
    // under the column, so after toLabels it is under `legacy_cat` — and nested
    // projection must look there.
    // MUTATION: restore `label: f.name` in nestedTargets. `nested` then looks
    // under `category`, finds nothing, skips recursion, and the category keeps
    // its raw `cat_name` key.
    const projectors = buildProjectors(nestedRegistry, {
      'content--post': createFieldKeyMapFromProjection(
        { fields: [{ column_name: 'category_id', exposed_as: 'legacy_cat' }] },
        [divergentReferenceField]
      ),
      'taxonomy--category': createFieldKeyMap([catNameField]),
    })
    const row = { id: 'p1', category_id: { id: 'c1', cat_name: 'Cat One' } }

    expect(projectRow(row, 'content--post', projectors)).toEqual({
      id: 'p1',
      legacy_cat: { id: 'c1', name: 'Cat One' },
    })
  })

  it('does not expose a relation the version never had, even once resolved', () => {
    // Review Focus #2: a relation added to current after this version was cut.
    // It is resolved into the row under its column, and only the drop-set keeps
    // it out. This must keep passing after Task 3 splits the drop-set.
    // MUTATION: stop adding unexposed columns to the drop-set in
    // createFieldKeyMapFromProjection. category_id then passes through remap
    // under its raw column name.
    const projectors = buildProjectors(nestedRegistry, {
      'content--post': createFieldKeyMapFromProjection({ fields: [] }, [divergentReferenceField]),
      'taxonomy--category': createFieldKeyMap([catNameField]),
    })
    const out = projectRow(
      { id: 'p1', category_id: { id: 'c1', cat_name: 'Cat One' } },
      'content--post',
      projectors
    )

    expect(out).toEqual({ id: 'p1' })
  })
})
```

- [ ] **Step 4: Create the integration suite with the #1a cases**

Create `packages/api/src/__tests__/column-identity.integration.test.ts`. This is the fixture the earlier probe used, made permanent. Note the fixture's invariant (PLAN-QUALITY rule 4): **current's projection (v3) labels every column with that field's own registry name** — `category` and `hero` — exactly as `buildProjections` would bake it. Only v1 diverges.

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

const BLOG = 'api_int_colid_blog'
const CAT = 'api_int_colid_cat'
const TYPE = 'colid-blog'
const MEDIA_ID = '22222222-2222-2222-2222-222222222222'
const CAT_ID = '11111111-1111-1111-1111-111111111111'

const BLOG_TYPE: ParsedContentType = {
  schema_type: 'content-type', name: TYPE, label: 'Column Identity Blog', source_file: 't.yml',
  only_one: false, default_base_path: TYPE,
  system_fields: [
    { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
    { name: 'slug', db_type: 'varchar', nullable: false },
    { name: 'published', db_type: 'boolean', default: 'false', nullable: false },
    { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
    { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
  ],
  fields: [
    { name: 'blog_title', label: 'Title', field_type: 'text/plain', required: false, nullable: true, order: 0,
      validation: { required: false },
      db_column: { column_name: 'blog_title', column_type: 'varchar', nullable: true },
      ui_component: { component: 'text-input' } },
    // foreign_key is what makes buildRelationsMap treat this as resolvable.
    { name: 'category', label: 'Category', field_type: 'reference', required: false, nullable: true, order: 1,
      validation: { required: false },
      db_column: { column_name: 'category_id', column_type: 'uuid', nullable: true,
        foreign_key: { table: CAT, column: 'id', on_delete: 'SET NULL' } },
      ui_component: { component: 'typeahead-select', ref: 'taxonomy--category', rel: 'one-to-one' } },
    { name: 'hero', label: 'Hero', field_type: 'image', required: false, nullable: true, order: 2,
      validation: { required: false },
      db_column: { column_name: 'blog_hero_image', column_type: 'uuid', nullable: true },
      ui_component: { component: 'file-upload', accepted_mime_types: [] } },
  ],
  ui: { tabs: [] },
  db: { table_name: BLOG, junction_tables: [] },
  api: { default_base_path: TYPE, http_methods: ['GET'], item_path: `/api/${TYPE}/:slug` },
}

const ROLES: ParsedRole[] = ['admin', 'manager', 'editor', 'writer', 'viewer'].map((name, i) => ({
  name, label: name, is_system: true, hierarchy_level: i, permissions: [],
}))

const REGISTRY: SchemaRegistry = {
  routes: { base_paths: [] }, roles: { roles: ROLES, valid_permissions: [] }, schemas: {},
  content_types: { [TYPE]: BLOG_TYPE }, paragraph_types: {}, taxonomy_types: {}, enum_types: {},
  all_schemas: [],
}

const col = (column_name: string, exposed_as: string) => ({ column_name, exposed_as, required: false })

// v1 renames both relations. v3 is current: every label equals the registry
// name, because buildProjections derives current's exposed_as from f.name.
const MODEL: BakedVersionModel = {
  current: 'v3',
  live: ['v1', 'v3'],
  projections: {
    v1: { version: 'v1', types: { [TYPE]: { fields: [
      col('blog_title', 'blog_title'), col('category_id', 'legacy_cat'), col('blog_hero_image', 'legacy_hero'),
    ] } } },
    v3: { version: 'v3', types: { [TYPE]: { fields: [
      col('blog_title', 'blog_title'), col('category_id', 'category'), col('blog_hero_image', 'hero'),
    ] } } },
  },
}

const pg = createPostgresAdapter({ url: DB_URL })
let db: DrizzlePostgresInstance

beforeAll(async () => {
  await pg.connect()
  db = pg.getDb()
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${CAT}" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR NOT NULL,
    published BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())`))
  await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS "${BLOG}" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug VARCHAR NOT NULL UNIQUE,
    published BOOLEAN NOT NULL DEFAULT false, blog_title VARCHAR, category_id UUID, blog_hero_image UUID,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(), updated_at TIMESTAMP NOT NULL DEFAULT NOW())`))
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${BLOG}" CASCADE`))
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${CAT}" CASCADE`))
  await db.execute(sql.raw(`DELETE FROM media WHERE id = '${MEDIA_ID}'`))
  await pg.disconnect()
})

beforeEach(async () => {
  await db.execute(sql.raw(`TRUNCATE "${BLOG}", "${CAT}"`))
  // The real media table comes from globalSetup's migrations and has no
  // default on `type`, so it must be supplied.
  await db.execute(sql.raw(`DELETE FROM media WHERE id = '${MEDIA_ID}'`))
  await db.execute(sql.raw(`INSERT INTO media (id, type, url, mime_type, file_size)
    VALUES ('${MEDIA_ID}', 'image', 'https://x/hero.png', 'image/png', 10)`))
  await db.execute(sql.raw(`INSERT INTO "${CAT}" (id, name) VALUES ('${CAT_ID}', 'Cat One')`))
  await db.execute(sql.raw(`INSERT INTO "${BLOG}" (slug, published, blog_title, category_id, blog_hero_image)
    VALUES ('post-1', true, 'Hello', '${CAT_ID}', '${MEDIA_ID}')`))
})

function app() {
  return createCmsApp({ storage: createLocalAdapter(), registry: REGISTRY, db, versions: MODEL }).app
}

type Row = Record<string, unknown>
async function get(path: string): Promise<{ status: number; row: Row | undefined; error: { code: string } | undefined }> {
  const res = await app().request(path)
  const body = (await res.json()) as { data?: Row[] | Row; error?: { code: string } }
  const row = Array.isArray(body.data) ? body.data[0] : body.data
  return { status: res.status, row, error: body.error }
}

describe('column as identity — media on an older version (#1a)', () => {
  it('serves a renamed media field on v1 under v1\'s label, resolved', async () => {
    // The probe's headline: today `legacy_hero` is simply absent.
    // MUTATION: restore the name-keyed media write in resolveRelationField.
    const { status, row } = await get(`/api/v1/${TYPE}`)

    expect(status).toBe(200)
    expect(row).toHaveProperty('legacy_hero')
    expect((row!['legacy_hero'] as { url?: string }).url).toBe('https://x/hero.png')
    expect(row).not.toHaveProperty('hero')
    expect(row).not.toHaveProperty('blog_hero_image')
  })

  it('still serves the media field on current, unchanged', async () => {
    // The byte-identical claim for current, at the response level.
    const { row } = await get(`/api/v3/${TYPE}`)

    expect((row!['hero'] as { url?: string }).url).toBe('https://x/hero.png')
    expect(row).not.toHaveProperty('legacy_hero')
  })

  it('serves a null media relation on v1 as a present null key', async () => {
    // Review Focus #1, end to end.
    // MUTATION: restore the empty-FK path's `delete row[rel.fk_column]`.
    await db.execute(sql.raw(`UPDATE "${BLOG}" SET blog_hero_image = NULL`))
    const { row } = await get(`/api/v1/${TYPE}`)

    expect(row).toHaveProperty('legacy_hero', null)
  })
})
```

- [ ] **Step 5: Run the new tests and confirm they fail**

```bash
pnpm db:test:up
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/relations.test.ts src/graphql/__tests__/dataloaders.test.ts src/__tests__/projector.test.ts src/__tests__/column-identity.integration.test.ts
```

Expected: most FAIL — the five `relations.test.ts` cases (the row holds `hero` and lacks the column; in the collision case v1 serves the media object as `hero`), the nested-projection test (the category keeps `cat_name`), and two of the three integration tests (`legacy_hero` is absent). Three tests are expected to **pass** already, each for a stated reason:

- `'does not expose a relation the version never had'` — the current drop-set already handles it. It is a regression guard that must survive Task 3.
- `'still serves the media field on current'` — the unchanged claim, which must hold before and after.
- The **dataloader** test — today's resolver writes under the name *and* today's loader reads the name, so they agree. Its value is that it fails the moment only one half is changed: change the resolver in Step 6 and run it again before Step 7, and it returns `undefined`. Do that, and record the observation.

Record which tests fail and how.

- [ ] **Step 6: Write the relations in place**

In `packages/api/src/relations.ts`, replace `needsFkResolution`:

```typescript
function needsFkResolution(row: Record<string, unknown>, fkColumn: string): boolean {
  // Resolved IN PLACE: the object sits under the column where the raw id was,
  // so an object (never a bare id) means this row is already done. A null
  // stays null on a second pass, which costs nothing — an empty FK list issues
  // no query.
  const current = row[fkColumn]
  return !(typeof current === 'object' && current !== null)
}
```

In the **reference** branch, replace everything from `const dropFk` to the end of the branch's final loop with:

```typescript
  } else if (rel.type === 'reference') {
    // Resolved IN PLACE, under the storage column. The column is a field's
    // internal identity, and toLabels applies whichever label the response
    // speaks. Writing under the field's name instead moved the value out of the
    // column, so any version labelling that column differently lost it.
    const pending = batch.filter((r) => needsFkResolution(r, rel.fk_column))
    if (pending.length === 0) return

    const fkValues = pending.map((r) => r[rel.fk_column] as string).filter(Boolean)
    if (fkValues.length === 0) {
      for (const row of pending) row[rel.fk_column] = null
      return
    }
    const unique = [...new Set(fkValues)]
    const uncached = unique.filter((id) => !cache.has(`${rel.table}:${id}`))
    if (uncached.length > 0) {
      const inList = sql.join(uncached.map((id) => sql`${id}`), sql`, `)
      const publishedCond = publishedOnly ? sql` AND published = true` : sql``
      const result = await db.execute(
        sql`SELECT * FROM ${sql.raw(quoteIdent(rel.table))} WHERE id IN (${inList})${publishedCond}`
      )
      for (const item of result.rows as Record<string, unknown>[]) {
        cache.set(`${rel.table}:${item['id']}`, item)
      }
    }
    for (const row of pending) {
      const fkVal = row[rel.fk_column] as string
      row[rel.fk_column] = fkVal ? (cache.get(`${rel.table}:${fkVal}`) ?? null) : null
    }
```

In the **media** branch, make the same three changes: delete `const dropFk = …`; call `needsFkResolution(r, rel.fk_column)` with two arguments; and replace each `row[fieldName] = …` plus its `if (dropFk) delete row[rel.fk_column]` with a single `row[rel.fk_column] = …` of the same value. The empty-FK path becomes `for (const row of pending) row[rel.fk_column] = null`.

Find the comment above `const batch = [...new Set(rows)]` in `resolveRelationField` that says the "destructive branches would then read an FK the first visit already consumed." No branch is destructive any more; rewrite it to say the dedupe stops one batch resolving the same row object twice.

- [ ] **Step 7: Read the column in the dataloader**

In `packages/api/src/graphql/dataloaders.ts`, inside `loaderFor`'s batch function, replace `return rows.map((r) => r[fieldName])` with:

```typescript
          // Column-backed relations resolve in place under their storage
          // column. Paragraph and junction relations have no column, so they
          // resolve under the field's name.
          // Not named `key`: loaderFor already declares one, for the cache.
          const resultKey = rel.type === 'reference' || rel.type === 'media' ? rel.fk_column : fieldName
          return rows.map((r) => r[resultKey])
```

- [ ] **Step 8: Build `nested` from this version's label**

In `packages/api/src/projector.ts`, change the import to bring in `isColumnBacked` as a value:

```typescript
import { isColumnBacked, type FieldKeyMap } from './field-keys.js'
```

Replace `nestedTargets` with:

```typescript
function nestedTargets(
  fields: ParsedField[],
  map: FieldKeyMap
): Array<{ label: string; target: string }> {
  const out: Array<{ label: string; target: string }> = []
  for (const f of fields) {
    if (MEDIA_FIELD_TYPES.has(f.field_type)) continue
    if (f.field_type !== 'paragraph' && f.field_type !== 'reference') continue
    // Both kinds name their target the same way.
    const ref = (f.ui_component as { ref?: string }).ref
    if (!ref) continue
    // A column-backed reference resolves in place under its column, so after
    // toLabels it sits under THIS version's label for that column. That can
    // differ from the field's current name, and is absent entirely when this
    // version does not expose the column. Paragraph and many-to-many fields have
    // no column, resolve under the field's name, and are never versioned.
    const label = isColumnBacked(f) ? map.labelFor(f.db_column.column_name) : f.name
    if (label === undefined) continue
    out.push({ label, target: ref })
  }
  return out
}
```

In `buildProjectors`, change `nested: nestedTargets(type.fields),` to `nested: nestedTargets(type.fields, map),`.

- [ ] **Step 9: Update the tests that model the removed behaviour**

These mocks stand in for the media loader and still write the object under the field's **name** and delete the column. They are not wrong tests — they still guard that a resolver sees the media object — but they now describe behaviour the real loader no longer has.

In `packages/api/src/graphql/__tests__/resolvers.divergence.test.ts`, in the test `'maps to labels only after the media loaders have resolved'`, replace the `contextWith` callback and its comment:

```typescript
    // Stand in for the media dataloader: it resolves the object IN PLACE under
    // the storage column, exactly as resolveRelationField now does.
    const ctx = contextWith((row) => {
      row['blog_hero_image'] = { id: 'm1' }
    })
```

The assertions stay as they are.

In `packages/api/src/graphql/__tests__/schema.versioned.test.ts`, three mock loaders. In each, replace

```typescript
          row['hero'] = { id: 'm1' }
          delete row['blog_hero_image']
          return { id: 'm1' }
```

or the `mime_type` variant

```typescript
          row['hero'] = { id: 'm1', mime_type: 'image/png' }
          delete row['blog_hero_image']
          return row['hero']
```

with the in-place form, keeping each one's value:

```typescript
          row['blog_hero_image'] = { id: 'm1', mime_type: 'image/png' }
          return row['blog_hero_image']
```

(use `{ id: 'm1' }` for the first). Keep each loader's `if (field !== 'hero') return null` guard and any `loaded.push(field)` exactly as they are — the loader is still *looked up* by the registry name; only where it *writes* has changed. One of these mocks carries the comment "resolveRelationField's media branch, exactly: the resolved object lands on the field's REGISTRY name, and the raw FK column is deleted outright" — rewrite it to say the object is resolved in place under the column.

`relabelMedia` in `packages/api/src/graphql/resolvers.ts` is now a **no-op** — the name it reads from is never written. Leave it in place for now; Task 4 deletes it. These tests pass without it, because `toLabels` now carries the resolved object to the right label on its own.

- [ ] **Step 10: Run the tests and confirm they pass**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/relations.test.ts src/graphql/__tests__/dataloaders.test.ts src/__tests__/projector.test.ts src/__tests__/column-identity.integration.test.ts src/graphql/__tests__/resolvers.divergence.test.ts src/graphql/__tests__/schema.versioned.test.ts
```

Expected: all pass.

- [ ] **Step 11: Verify each new test bites**

For each new test, apply the mutation named in its comment, run that file, confirm the test fails, restore, and confirm it passes again. Record each observation. Confirm `git status --porcelain` shows only your intended changes when done.

- [ ] **Step 12: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
pnpm build
```

Expected: api rises by **+10 tests** across `relations.test.ts` (+4), `dataloaders.test.ts` (+1), `projector.test.ts` (+2) and the new integration file (+3) — the rewritten relations test replaces one, so it adds none. Every pre-existing suite still passes. If an existing test fails that is *not* listed in Step 9, it is asserting the name-keyed behaviour: report it rather than silently changing it.

- [ ] **Step 13: Commit**

```bash
git add packages/api/src
git commit -m "fix(api): resolve relations in place under their storage column

resolveRelationField moved a resolved media or reference object from its
column to the field's name. On an older version that labels the column
differently, toLabels then had nothing to map and the drop-set discarded
the name, so the relation vanished from the response.

Writing in place is what these branches already did whenever a field's
name equalled its column. Relations now flow through toLabels like any
scalar.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Translate `?include=` to registry names (closes #1b)

The public route validates `?include=` against **this version's** labels; the repository validates against **registry** names and throws on anything else. For a reference this version renames, no name passes both — the probe got a 400 for `?include=legacy_cat` *and* for `?include=category` on v1. Translate at the boundary: validate in the version's vocabulary, hand the repository the registry's.

**Files:**
- Modify: `packages/api/src/routes/content.ts` — the `relationFieldNames` set and both `?include=` sites (the collection handler and the item handler)
- Test: `packages/api/src/__tests__/column-identity.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 — a resolved reference lands at `row[fk_column]`, so `toLabels` carries it to this version's label. Without Task 1 the translated include would still resolve the relation, and the drop-set would then discard it.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/src/__tests__/column-identity.integration.test.ts`:

```typescript
describe('column as identity — ?include= on an older version (#1b)', () => {
  it("resolves a renamed reference when included under v1's label", async () => {
    // MUTATION: pass the requested names straight to the repository instead of
    // translating them. The repository then throws INVALID_INCLUDE_FIELD for
    // `legacy_cat`, which surfaces as a 400.
    const { status, row } = await get(`/api/v1/${TYPE}?include=legacy_cat`)

    expect(status).toBe(200)
    expect(row!['legacy_cat']).toMatchObject({ id: CAT_ID, name: 'Cat One' })
    expect(row).not.toHaveProperty('category')
    expect(row).not.toHaveProperty('category_id')
  })

  it('resolves it on the item route too', async () => {
    // The item route has its own copy of the include handling.
    // MUTATION: translate only in the collection handler.
    const { status, row } = await get(`/api/v1/${TYPE}/post-1?include=legacy_cat`)

    expect(status).toBe(200)
    expect(row!['legacy_cat']).toMatchObject({ id: CAT_ID, name: 'Cat One' })
  })

  it("rejects the registry name on v1, which is not part of v1's contract", async () => {
    // A v1 consumer speaks v1's labels; `category` is current's name.
    // MUTATION: validate against registry names instead of this version's
    // labels. `category` is then accepted.
    const { status, error } = await get(`/api/v1/${TYPE}?include=category`)

    expect(status).toBe(400)
    expect(error?.code).toBe('INVALID_INCLUDE_FIELD')
  })

  it('still resolves the include on current, unchanged', async () => {
    const { status, row } = await get(`/api/v3/${TYPE}?include=category`)

    expect(status).toBe(200)
    expect(row!['category']).toMatchObject({ id: CAT_ID, name: 'Cat One' })
  })

  it('gives every item sharing one category the resolved category, on v1', async () => {
    // Review Focus #3. The relation cache hands the SAME target object to every
    // parent, so a per-row bug shows up only once there are several rows.
    // MUTATION: in resolveRelationField's reference branch, assign the resolved
    // object to the first pending row only. The second post keeps its bare id.
    await db.execute(sql.raw(`INSERT INTO "${BLOG}" (slug, published, blog_title, category_id)
      VALUES ('post-2', true, 'Second', '${CAT_ID}')`))
    const res = await app().request(`/api/v1/${TYPE}?include=legacy_cat`)
    const body = (await res.json()) as { data: Row[] }

    expect(body.data).toHaveLength(2)
    for (const post of body.data) {
      expect(post['legacy_cat']).toMatchObject({ id: CAT_ID, name: 'Cat One' })
    }
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/column-identity.integration.test.ts
```

Expected: the two v1 resolve tests and the shared-category test FAIL with status 400 (`INVALID_INCLUDE_FIELD`, thrown by the repository). `'rejects the registry name on v1'` and `'still resolves the include on current'` already PASS — the route already rejects `category` on v1, and current is unaffected. Record what you saw.

- [ ] **Step 3: Replace the set with a label → registry-name map**

In `packages/api/src/routes/content.ts`, replace the `relationFieldNames` block with:

```typescript
    // Relation fields a consumer may `?include=`, keyed by the name THIS
    // version speaks and mapped to the registry name the repository speaks.
    // They differ for a column-backed relation this version renames. The
    // repository's relation map stays keyed by registry name, because it also
    // has to cover paragraph and many-to-many fields, which have no column.
    const includeNames = new Map<string, string>()
    for (const f of contentType.fields) {
      if (!RELATION_FIELD_TYPES.has(f.field_type)) continue
      if (isColumnBacked(f)) {
        const label = fieldKeys.labelFor(f.db_column.column_name)
        if (label !== undefined) includeNames.set(label, f.name)
      } else {
        includeNames.set(f.name, f.name)
      }
    }

    // Validates a `?include=` list in this version's vocabulary and translates
    // it into the repository's. An unknown name is an expected client error, so
    // it is returned rather than thrown.
    function translateInclude(
      requested: string[]
    ): { ok: true; include: string[] } | { ok: false; field: string } {
      const include: string[] = []
      for (const field of requested) {
        const registryName = includeNames.get(field)
        if (registryName === undefined) return { ok: false, field }
        include.push(registryName)
      }
      return { ok: true, include }
    }
```

- [ ] **Step 4: Use it at both sites**

In **both** the collection handler and the item handler, replace

```typescript
        const include = parseInclude(c.req.query('include'))
        for (const field of include) {
          if (!relationFieldNames.has(field)) {
            return c.json(
              {
                ok: false,
                error: {
                  code: 'INVALID_INCLUDE_FIELD',
                  message: `'${field}' is not a valid relation field`,
                },
              },
              400
            )
          }
        }
```

with

```typescript
        const translated = translateInclude(parseInclude(c.req.query('include')))
        if (!translated.ok) {
          return c.json(
            {
              ok: false,
              error: {
                code: 'INVALID_INCLUDE_FIELD',
                message: `'${translated.field}' is not a valid relation field`,
              },
            },
            400
          )
        }
        const include = translated.include
```

The later `repo.findMany({ …, include })` and `repo.findBySlug(slug, include)` calls stay as they are — `include` now holds registry names. Confirm `relationFieldNames` no longer appears anywhere in the file.

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/column-identity.integration.test.ts
```

Expected: all pass, including Task 1's.

- [ ] **Step 6: Verify each new test bites**

Apply each test's named mutation, confirm it fails, restore, confirm it passes. Record each.

- [ ] **Step 7: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
pnpm build
```

Expected: api rises by **+5 tests**, all in the integration file. Every existing suite passes — `public.integration.test.ts` and `relations.read.integration.test.ts` both exercise `?include=` on current and must be unaffected.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src
git commit -m "fix(api): translate ?include= into registry names on older versions

The route validated include names against the served version's labels and
the repository validated them against registry names, so a relation the
version renames could not be included at all: one name failed the route,
the other the repository.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Split the drop-set by key space (closes #2 and #3)

`buildFieldKeyMap` consults one `droppedKeys` set in two ways for both directions: it strips pairs out of `labelToColumn` and `columnToLabel`, and `remap` skips any input key in it. But `toLabels` reads **column**-keyed input and `toStorage` reads **label**-keyed input, and a label and a column can be the same text. That is the root of #2.

After Task 1, a row never contains a column-backed field's *name*, so the collision check can narrow to the one ambiguity that remains — and the `ownColumn` skip that 2e added, which was too broad, goes away.

**Files:**
- Modify: `packages/api/src/field-keys.ts` — `buildFieldKeyMap`, `createFieldKeyMap`, `createFieldKeyMapFromProjection`
- Test: `packages/api/src/__tests__/field-keys.test.ts`

**Interfaces:**
- Consumes: Task 1 — no column-backed field's name is ever a row key. **This task is unsound without it**: narrowing the collision check while relations still land under their names would let a resolved reference be mislabelled.
- Produces: `buildFieldKeyMap(pairs, allLabels, droppedColumns: Set<string>, droppedLabels: Set<string>)`. The public `FieldKeyMap` type is **unchanged**.

- [ ] **Step 1: Rewrite the three tests whose expectation changes**

These three currently assert a throw. The spec's "Consequence for existing tests" table says each must instead map correctly in **both** directions. Do not merely delete the throw assertion — replace it with the round trip, so the test still fails if the mapping is wrong.

Replace `"throws when a label collides with another field's column name"` with:

```typescript
  it("maps a field named after another field's column correctly in both directions", () => {
    // divergentTextField is `title` over `blog_title`; this field is NAMED
    // `blog_title` but owns `other_col`. A column-backed name is never a row
    // key, so nothing is ambiguous.
    // MUTATION: in buildFieldKeyMap's collision check, inspect every field
    // again rather than only those with no column of their own. The map then
    // throws on build.
    const namedAfterAColumn: ParsedField = {
      ...identityTextField,
      name: 'blog_title',
      db_column: { column_name: 'other_col', column_type: 'varchar', nullable: true },
    } as ParsedField
    const m = createFieldKeyMap([divergentTextField, namedAfterAColumn])

    expect(m.toLabels({ blog_title: 'T', other_col: 'O' })).toEqual({ title: 'T', blog_title: 'O' })
    expect(m.toStorage({ title: 'T', blog_title: 'O' })).toEqual({ blog_title: 'T', other_col: 'O' })
  })
```

Replace `"still throws when a live field's label collides with a tombstone's column"` with:

```typescript
    it("maps a live label equal to a tombstone's column correctly in both directions", () => {
      // The case that shows why the drop-set must split. collisionLiveField is
      // `description` over `d2`; collisionTombstoneField is `x` over the
      // retained column `description`.
      // MUTATION: restore one shared drop-set for both directions. Its
      // `description` entry (the tombstone's column) then strips the LIVE
      // field's `description → d2` pair, and toStorage drops the write.
      const m = createFieldKeyMap([collisionLiveField, collisionTombstoneField])

      expect(m.toLabels({ d2: 'live', description: 'retained' })).toEqual({ description: 'live' })
      expect(m.toStorage({ description: 'live' })).toEqual({ d2: 'live' })
      // The tombstone itself stays refused in both directions.
      expect(m.toStorage({ x: 'nope' })).toEqual({})
    })
```

Replace `"still throws when a DIFFERENT field is named after a column this version renames"` with:

```typescript
  it('maps a field named after a column this version renames correctly', () => {
    // This test used to claim the second field's value lands in the row under
    // its own name. That was false for a text field even before — SELECT *
    // puts it under its column — and Task 1 made it false for relations too.
    // MUTATION: inspect every field in the collision check again.
    const renamesSomeoneElsesColumn = {
      fields: [{ column_name: 'blog_title', exposed_as: 'heading', required: false }],
    }
    const namedAfterThatColumn: ParsedField = {
      ...identityTextField,
      name: 'blog_title',
      db_column: { column_name: 'other_col', column_type: 'varchar', nullable: true },
    }
    const m = createFieldKeyMapFromProjection(renamesSomeoneElsesColumn, [
      divergentTextField,
      namedAfterThatColumn,
    ])

    // This version exposes only `blog_title`, as `heading`; `other_col` is not exposed.
    expect(m.toLabels({ blog_title: 'T', other_col: 'O' })).toEqual({ heading: 'T' })
    expect(m.toStorage({ heading: 'T' })).toEqual({ blog_title: 'T' })
  })
```

Leave every other collision test exactly as it is. In particular these must keep passing **unmodified**, and each is evidence the change is right: the paragraph and many-to-many tests still throw; `"still throws when a NON-projected field's label collides with a column"` still throws; `'drops a renamed-then-removed tombstone under BOTH its current name and its retained column'` still passes, proving tombstone writes stay refused; `'accepts a version that exposes a field under a label other than its own column'` still passes without the skip.

- [ ] **Step 2: Add the #2 repro and the admin round trip**

Append to `packages/api/src/__tests__/field-keys.test.ts`, importing `divergentReferenceField` and `renamedTombstoneField` from `'../field-keys.test-fixtures'` if the file does not already:

```typescript
describe('split drop-sets', () => {
  it("does not serve another field's data when a version's label equals a different field's name", () => {
    // #2. Current has `a` (column a) and `b` (column b). v1 exposes column a
    // under the label `b`, and never had field b at all.
    // MUTATION: restore one shared drop-set. Un-dropping the projected label
    // `b` then also un-drops field b's column `b`, which passes through remap:
    // v1 receives field b's value and field a's is lost.
    const a: ParsedField = {
      ...identityTextField,
      name: 'a',
      db_column: { column_name: 'a', column_type: 'varchar', nullable: true },
    }
    const b: ParsedField = {
      ...identityTextField,
      name: 'b',
      db_column: { column_name: 'b', column_type: 'varchar', nullable: true },
    }
    const m = createFieldKeyMapFromProjection(
      { fields: [{ column_name: 'a', exposed_as: 'b' }] },
      [a, b]
    )

    expect(m.toLabels({ a: 'v1 value', b: 'NEW FIELD value' })).toEqual({ b: 'v1 value' })
  })

  it('round-trips a renamed relation through the admin read and write paths', () => {
    // Review Focus #4. The admin panel reads through toLabels and writes
    // through toStorage, both on current's map. The tombstone makes both drop
    // sets non-empty, which is what lets this test notice them being crossed.
    // MUTATION: wire each direction to the OTHER set — toLabels consulting
    // droppedLabels, toStorage consulting droppedColumns. The tombstone's
    // retained column `blog_desc` then leaks into the read.
    const m = createFieldKeyMap([divergentReferenceField, renamedTombstoneField])

    expect(m.toLabels({ id: 'p1', category_id: { id: 'c1', name: 'Cat' }, blog_desc: 'retained' }))
      .toEqual({ id: 'p1', category: { id: 'c1', name: 'Cat' } })
    expect(m.toStorage({ category: 'c1', legacy_desc: 'refused' })).toEqual({ category_id: 'c1' })
  })
})
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/field-keys.test.ts
```

Expected: the three rewritten tests FAIL by throwing at map build (the collision check still inspects column-backed names). The #2 repro FAILS with `{ b: 'NEW FIELD value' }`. The admin round trip may already PASS — on today's code the shared set happens to handle this tombstone correctly — and its value is the crossing mutation in Step 7. Record what you saw.

- [ ] **Step 4: Split the sets inside `buildFieldKeyMap`**

Change the signature:

```typescript
function buildFieldKeyMap(
  pairs: Array<{ label: string; column: string }>,
  allLabels: LabelEntry[],
  droppedColumns: Set<string>,
  droppedLabels: Set<string>
): FieldKeyMap {
```

Replace the collision loop's skip. Today it reads `if (ownColumn === label) continue`; replace that line and the comment block above it with:

```typescript
  for (const { label, ownColumn } of allLabels) {
    // Only a field with no column of its own can collide. Its NAME is written
    // into the row as a key — paragraph, junction and programmatic values land
    // under it — so a name equal to some column would be relabelled as that
    // column's field. A column-backed field's name is never a row key: its
    // value lives under its column, and toLabels maps the column, not the name.
    if (ownColumn !== undefined) continue
```

Leave the throw beneath it exactly as it is.

Replace the stripping loops so each map is stripped by its own set:

```typescript
  // Only now strip dropped pairs — the collision check above has already run
  // against the full map. Each map is stripped by the set for ITS key space:
  // labelToColumn is keyed by label, columnToLabel by column. One shared set
  // let a label and a column of the same text strip each other's pair.
  for (const label of labelToColumn.keys()) {
    if (droppedLabels.has(label)) labelToColumn.delete(label)
  }
  for (const column of columnToLabel.keys()) {
    if (droppedColumns.has(column)) columnToLabel.delete(column)
  }
```

Give `remap` its drop set as a parameter, and wire each direction to its own:

```typescript
  function remap(
    input: Record<string, unknown>,
    lookup: Map<string, string>,
    dropped: Set<string>
  ): Record<string, unknown> {
```

Inside it, change `if (droppedKeys.has(key)) continue` to `if (dropped.has(key)) continue`. Then:

```typescript
  return {
    // toStorage reads LABEL-keyed input, so it consults only droppedLabels;
    // toLabels reads COLUMN-keyed input, so it consults only droppedColumns.
    toStorage: (input) => remap(input, labelToColumn, droppedLabels),
    toLabels: (row) => remap(row, columnToLabel, droppedColumns),
```

Update `buildFieldKeyMap`'s doc comment wherever it describes `droppedKeys`, so it describes the two sets.

- [ ] **Step 5: Build two sets in `createFieldKeyMap`**

Replace its single `droppedKeys` set with two, and the tombstone block with:

```typescript
  const droppedColumns = new Set<string>()
  const droppedLabels = new Set<string>()
```

```typescript
    if (f.removed === true) {
      // A tombstone's NAME refuses writes addressed to it; its COLUMN keeps the
      // retained data out of reads. Two sets, so neither can collide with a
      // live field's key from the other space.
      droppedLabels.add(f.name)
      droppedColumns.add(f.db_column.column_name)
    }
```

and pass both to `buildFieldKeyMap`.

- [ ] **Step 6: Build two sets in `createFieldKeyMapFromProjection`**

Replace its drop-set computation with:

```typescript
  const projectedColumns = new Set(pairs.map((p) => p.column))
  const projectedLabels = new Set(pairs.map((p) => p.label))
  // A column this version does not expose is dropped from READS; a name it
  // does not expose is dropped from WRITES. Computed independently: with one
  // shared set, un-dropping a projected label could un-drop an unrelated
  // field's column of the same text — which is exactly #2.
  const droppedColumns = new Set<string>()
  const droppedLabels = new Set<string>()
  for (const f of allFields) {
    if (!isColumnBacked(f)) continue
    if (!projectedColumns.has(f.db_column.column_name)) droppedColumns.add(f.db_column.column_name)
    if (!projectedLabels.has(f.name)) droppedLabels.add(f.name)
  }
```

and pass both to `buildFieldKeyMap`. Remove the now-unused `projected` set and the comment block describing the old "un-drop" pass, and update the function's doc comment.

- [ ] **Step 7: Run the tests, then verify each bites**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/__tests__/field-keys.test.ts src/__tests__/projector.test.ts src/__tests__/column-identity.integration.test.ts
```

Expected: all pass — including Task 1's `'does not expose a relation the version never had'`, which is the proof the split introduced no leak.

Then apply each new or rewritten test's named mutation, confirm it fails, restore, confirm it passes. For the admin round trip, swap the two sets between `toStorage` and `toLabels` and confirm `blog_desc` appears in the read.

- [ ] **Step 8: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
pnpm build
```

Expected: api rises by **+2 tests**; the three rewritten tests replace their originals. Every other suite passes — the admin, public and versioned-route integration suites all build field-key maps, and none may change behaviour.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src
git commit -m "fix(api): split the field-key drop-set by key space

toLabels reads column-keyed input and toStorage reads label-keyed input,
but both consulted one drop-set. A label and a column can be the same text,
so un-dropping a projected label could un-drop an unrelated field's column
and serve its data under another field's key.

With relations now column-keyed, a column-backed field's name is never a
row key, so the collision check narrows to fields with no column of their
own. That retires the ownColumn skip, which was too broad, and lets two
safe configurations that used to be refused at startup build.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Programmatic resolvers read current's labels (closes #4)

A programmatic resolver is written once, against the schema as it is now. Today it is handed a record in the **served version's** labels, so on an older version `ctx.get('<current name>')` returns `undefined` with no error. Hand it a record built with **current's** field-key map on every version, and merge only its computed values back into the version-labelled response. Programmatic fields are never versioned, so their names are the same on every version, and the merge cannot overwrite a label the version owns.

After Task 1 this needs no relabelling. A resolved media object sits under its column, so `toLabels` with current's map puts it under current's name like any scalar. `relabelMedia`, which existed only to undo the name-keyed write, goes away along with `MediaFieldKey`.

**Files:**
- Modify: `packages/api/src/routes/content.ts` — `registerPublicContentRoutes`'s signature, two new helpers, the five resolver call sites, and the "Response projection order" comment
- Modify: `packages/api/src/app.ts` — the `registerPublicContentRoutes` call inside the per-version loop, and the `createGraphQLHandler` call
- Modify: `packages/api/src/graphql/handler.ts` — `createGraphQLHandler`'s `versioning` parameter
- Modify: `packages/api/src/graphql/schema.ts` — `buildGraphQLSchema`'s signature, the media-field list in `buildObjectType`, and the `programmaticFieldResolver` call
- Modify: `packages/api/src/graphql/resolvers.ts` — `programmaticFieldResolver`, `resolveProgrammaticRow`, and deletion of `relabelMedia` and `MediaFieldKey`
- Modify: `docs/v2/graphql-schema-mapping.md` — the "Writing a version-durable resolver" subsection
- Test: `packages/api/src/routes/__tests__/content.programmatic.test.ts`, `packages/api/src/graphql/__tests__/schema.versioned.test.ts`, `packages/api/src/graphql/__tests__/resolvers.divergence.test.ts`, `packages/api/src/__tests__/column-identity.integration.test.ts`

**Interfaces:**
- Consumes: Task 1. A resolved media object is at `row[fk_column]`, and the loader reads it back from there.
- Produces: `registerPublicContentRoutes(app, registry, repos, projectors, paths, listRateLimit?, resolver?, resolverProjectors?: Projectors)`. When `resolverProjectors` is omitted, it defaults to `projectors`.
- Produces: `buildGraphQLSchema(registry, fieldKeyMaps = {}, view?, programmaticKeyMaps: Record<string, FieldKeyMap> = fieldKeyMaps)`.
- Produces: `createGraphQLHandler`'s `versioning` object gains `currentFieldKeyMaps?: Record<string, FieldKeyMap>`.
- Produces: `programmaticFieldResolver(typeName, schemaFieldName, mediaFieldNames: readonly string[] = [], fieldKeys?)`. The third parameter changes from `MediaFieldKey[]` to plain registry names.
- Produces: a second fixture in the integration file, `PROG_REGISTRY` with `progApp()` and `gql(path, source)`. Task 5 uses them.

- [ ] **Step 1: Write the REST unit tests (the 2e residual's exact repro)**

Append to `packages/api/src/routes/__tests__/content.programmatic.test.ts`, and add `createFieldKeyMapFromProjection` to its existing `'../../field-keys'` import. `DIVERGENT_BLOG` is `title` over `blog_title`, and `divergentResolverFor()` reads `ctx.get('title')`. Both are already defined in the file.

```typescript
describe('programmatic resolution on an older version (#4)', () => {
  // v1 exposes column blog_title as `legacy_title`; current calls it `title`.
  // The resolver is written against current, as every resolver is.
  const V1_PROJECTORS = buildProjectors(DIVERGENT_REGISTRY, {
    'content--blog_post': createFieldKeyMapFromProjection(
      { fields: [{ column_name: 'blog_title', exposed_as: 'legacy_title' }] },
      DIVERGENT_BLOG.fields
    ),
  })
  const rows = [{ id: '1', slug: 'a', blog_title: 'Hi', published: true }]

  function v1App(): Hono {
    const app = new Hono()
    registerPublicContentRoutes(
      app,
      DIVERGENT_REGISTRY,
      { 'content--blog_post': repoWith(rows) },
      V1_PROJECTORS,
      createVersionedPaths('/api', 'v1'),
      undefined,
      divergentResolverFor(),
      DIVERGENT_PROJECTORS
    )
    return app
  }

  it("hands the resolver current's labels while the response speaks v1's (detail)", async () => {
    // MUTATION: pass V1_PROJECTORS as the resolver's projectors. The resolver
    // then reads a v1-labelled record and returns 'S:undefined'.
    // A second MUTATION: merge the whole resolved record rather than only its
    // programmatic keys. Current's `title` then leaks into v1's response, and
    // the exact toEqual catches it.
    const res = await v1App().request('/api/v1/blog/a')
    const body = (await res.json()) as { data: Record<string, unknown> }

    expect(body.data).toEqual({
      id: '1', slug: 'a', published: true, legacy_title: 'Hi', summary: 'S:Hi', live: 'L:Hi',
    })
  })

  it("hands the resolver current's labels on the list route too", async () => {
    // The list path has its own call site. MUTATION: convert only the item sites.
    const res = await v1App().request('/api/v1/blog')
    const body = (await res.json()) as { data: Record<string, unknown>[] }

    expect(body.data[0]).toEqual({ id: '1', slug: 'a', published: true, legacy_title: 'Hi', live: 'L:Hi' })
  })
})
```

- [ ] **Step 2: Rewrite the GraphQL unit tests that pin the version-labelled record**

In `packages/api/src/graphql/__tests__/schema.versioned.test.ts`, the two tests under `"buildGraphQLSchema — a renamed media field reaches the programmatic record under this version's label"` assert the behaviour this task removes: a resolver reading **v1's** labels. Convert them to assert current's labels.

Add `createFieldKeyMap` to the file's existing `'../../field-keys'` import. Replace `heroSchemaWithMap` with:

```typescript
function heroSchemaWithMap() {
  const view = buildVersionView({
    registry: heroRegistry,
    projection: HERO_V1,
    currentProjection: HERO_CURRENT,
    currentVersion: 'v3',
  })
  return buildGraphQLSchema(
    heroRegistry,
    {
      'content--category': createFieldKeyMapFromProjection(
        HERO_V1.types['content--category']!,
        HERO_TYPE.fields
      ),
    },
    view,
    // Current's map for the programmatic record, which is what app.ts wires.
    { 'content--category': createFieldKeyMap(HERO_TYPE.fields) }
  )
}
```

Rename the `describe` to `"buildGraphQLSchema — the programmatic record on an older version speaks current's labels"`. Rewrite the `// ─── Bug 1 …` comment block above `heroSchemaWithMap` to say the following. v1 is served. The programmatic record is built with current's map. A resolver written against current reads `title` and `hero` on every version, and the media object arrives resolved because the loader resolves it in place under its column.

In the first test, rename it to `"hands the resolver current's labels, with media resolved, on v1"`. Replace its resolver body and its final assertion:

```typescript
        // Reads CURRENT's labels: `title` (v1 calls it blog_title) and `hero`
        // (v1 calls it legacy_hero). MUTATION: drop heroSchemaWithMap's fourth
        // argument, so the record falls back to v1's map. This yields 'undefined|null'.
        programmaticField({ schema: 'content--category', field: 'summary' }, (ctx) =>
          `${String(ctx.get('title'))}|${JSON.stringify(ctx.get('hero') ?? null)}`
        ),
```

```typescript
    expect(data.categories.data[0]!.summary).toBe('Hello|{"id":"m1","mime_type":"image/png"}')
```

(The assertion's value is unchanged. Only the labels the resolver reads have changed.)

In the second test, rename it to `"does not leave v1's label or the raw FK column in the record"`. Replace the `seen.push` body and the final assertion:

```typescript
          seen.push({
            hero: ctx.get('hero'),
            legacy_hero: ctx.get('legacy_hero'),
            blog_hero_image: ctx.get('blog_hero_image'),
          })
```

```typescript
    // MUTATION: drop heroSchemaWithMap's fourth argument. The object then sits
    // under `legacy_hero`, and `hero` is undefined.
    expect(seen[0]).toEqual({
      hero: { id: 'm1', mime_type: 'image/png' },
      legacy_hero: undefined,
      blog_hero_image: undefined,
    })
```

- [ ] **Step 3: Write the integration tests**

Add these imports at the top of `packages/api/src/__tests__/column-identity.integration.test.ts`:

```typescript
import { programmaticField } from '@bobbykim/manguito-cms-core'
import { resolverKey, type ResolverMap } from '../programmatic/resolve'
```

Then append:

```typescript
// ─── A second app: the same type plus two programmatic fields ────────────────
//
// Separate from REGISTRY because createCmsApp refuses to boot when a declared
// programmatic field has no resolver, and the suites above pass none.

const programmatic = (name: string, order: number) => ({
  name, label: name, field_type: 'programmatic' as const, required: false, nullable: true, order,
  validation: { required: false }, db_column: null, ui_component: { component: 'computed-display' as const },
})

const PROG_TYPE: ParsedContentType = {
  ...BLOG_TYPE,
  fields: [...BLOG_TYPE.fields, programmatic('hero_url', 3), programmatic('cat_echo', 4)],
}
const PROG_REGISTRY: SchemaRegistry = { ...REGISTRY, content_types: { [TYPE]: PROG_TYPE } }

// Both resolvers read CURRENT's names, which is how every resolver is written.
// `hero` is `legacy_hero` on v1 and `category` is `legacy_cat`.
const RESOLVERS: ResolverMap = new Map([
  [resolverKey(TYPE, 'hero_url'), programmaticField({ schema: TYPE, field: 'hero_url', on_list: true },
    (ctx) => (ctx.get('hero') as { url?: string } | null | undefined)?.url ?? 'none')],
  [resolverKey(TYPE, 'cat_echo'), programmaticField({ schema: TYPE, field: 'cat_echo', on_list: true },
    (ctx) => `got:${String(ctx.get('category'))}`)],
])

function progApp() {
  return createCmsApp({
    storage: createLocalAdapter(), registry: PROG_REGISTRY, db, versions: MODEL, resolvers: RESOLVERS,
    graphql: { enabled: true, maxDepth: 8, maxComplexity: 1000, graphiql: false, introspection: true },
  }).app
}

async function gql(path: string, source: string): Promise<{ data?: Record<string, unknown> | null; errors?: unknown[] }> {
  const res = await progApp().fetch(new Request(`http://local${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: source }),
  }))
  return (await res.json()) as { data?: Record<string, unknown> | null; errors?: unknown[] }
}

type ProgRow = { legacyHero?: { url: string } | null; heroUrl?: string; catEcho?: string }
const rowsOf = (body: { data?: Record<string, unknown> | null }) =>
  (body.data as { colidBlogs: { data: ProgRow[] } }).colidBlogs.data

describe("column as identity — programmatic resolvers read current's labels (#4)", () => {
  it('REST: a resolver written against current works on v1', async () => {
    // MUTATION: drop the resolverProjectors argument from app.ts's
    // registerPublicContentRoutes call. The record then speaks v1, and
    // hero_url is 'none' and cat_echo is 'got:undefined'.
    const res = await progApp().request(`/api/v1/${TYPE}/post-1`)
    const body = (await res.json()) as { data: Row }

    expect(body.data['hero_url']).toBe('https://x/hero.png')
    expect(body.data['cat_echo']).toBe(`got:${CAT_ID}`)
    // The response itself still speaks v1.
    expect((body.data['legacy_hero'] as { url?: string }).url).toBe('https://x/hero.png')
    expect(body.data).not.toHaveProperty('hero')
    expect(body.data).not.toHaveProperty('category')
  })

  it('GraphQL: a resolver written against current works on v1', async () => {
    // MUTATION: drop currentFieldKeyMaps from app.ts's createGraphQLHandler call.
    const body = await gql('/graphql/v1', '{ colidBlogs { data { heroUrl catEcho } } }')

    expect(body.errors).toBeUndefined()
    expect(rowsOf(body)[0]).toEqual({ heroUrl: 'https://x/hero.png', catEcho: `got:${CAT_ID}` })
  })

  it('GraphQL: selecting the media field and a resolver that reads it, in either order', async () => {
    // Review Focus #5. The parent row is resolved IN PLACE by the media field's
    // own resolver, while the programmatic path loads into a copy. Whichever runs
    // first, the other must still find the resolved object.
    // MUTATION: in dataloaders.ts, read `r[fieldName]` again rather than the
    // column. legacyHero then comes back null in both orders.
    for (const source of [
      '{ colidBlogs { data { legacyHero { url } heroUrl } } }',
      '{ colidBlogs { data { heroUrl legacyHero { url } } } }',
    ]) {
      const body = await gql('/graphql/v1', source)

      expect(body.errors).toBeUndefined()
      expect(rowsOf(body)[0]).toMatchObject({ legacyHero: { url: 'https://x/hero.png' }, heroUrl: 'https://x/hero.png' })
    }
  })
})
```

The reference field targets `taxonomy--category`, which this registry does not define. Each GraphQL build therefore writes `⚠ reference field 'category' targets unknown type …` to stderr. That warning is expected, and no test selects the field over GraphQL.

- [ ] **Step 4: Run the new tests and confirm they fail**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/routes/__tests__/content.programmatic.test.ts src/graphql/__tests__/schema.versioned.test.ts src/__tests__/column-identity.integration.test.ts
```

Expected results:
- Both new REST unit tests FAIL with `summary: 'S:undefined'` and `live: 'L:undefined'`. Vitest ignores the eighth argument that does not exist yet. `tsc` would reject it, and typecheck runs at Step 11.
- Both rewritten GraphQL unit tests FAIL. The fourth argument is ignored, so the record speaks v1.
- The two REST and GraphQL integration tests FAIL with `'none'` and `'got:undefined'`.
- The either-order test PASSES on `legacyHero` but FAILS on `heroUrl`.

Record what you saw.

- [ ] **Step 5: REST — run the resolver on current's record, merge only programmatic keys**

In `packages/api/src/routes/content.ts`, add the parameter to `registerPublicContentRoutes`:

```typescript
  listRateLimit?: MiddlewareHandler,
  resolver?: ProgrammaticResolver,
  // Current's projectors, for the record a programmatic resolver reads. Omitted
  // when the routes being registered ARE current's, which is the default.
  resolverProjectors?: Projectors
): void {
```

Directly after the opening brace, before `registerListRoute`, add:

```typescript
  // A programmatic resolver is written once, against the schema as it is now,
  // so on every version it reads a record in CURRENT's labels. The response
  // still speaks the served version's labels. Only the resolver's computed
  // values are merged across, and programmatic fields are never versioned, so
  // their names are the same in both. (A computed field that reuses a live
  // version's field name is an authoring mistake; see the 2f spec's Residuals.)
  const forResolver = resolverProjectors ?? projectors

  function pickProgrammatic(
    resolved: Record<string, unknown>,
    names: readonly string[]
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    // `in`, not `!== undefined`: resolveList sets only on_list fields, and a
    // field it skipped must stay absent rather than become a present undefined.
    for (const name of names) if (name in resolved) out[name] = resolved[name]
    return out
  }

  async function respondItem(
    row: Record<string, unknown>,
    typeName: string,
    programmatic: readonly string[]
  ): Promise<Record<string, unknown>> {
    const data = projectRow(row, typeName, projectors)
    if (!resolver?.hasSchema(typeName)) return data
    const resolved = await resolver.resolveItem(typeName, projectRow(row, typeName, forResolver))
    return { ...data, ...pickProgrammatic(resolved, programmatic) }
  }

  async function respondList(
    rows: Record<string, unknown>[],
    typeName: string,
    programmatic: readonly string[]
  ): Promise<Record<string, unknown>[]> {
    const data = rows.map((row) => projectRow(row, typeName, projectors))
    if (!resolver?.hasSchema(typeName)) return data
    const resolved = await resolver.resolveList(
      typeName,
      rows.map((row) => projectRow(row, typeName, forResolver))
    )
    return data.map((d, i) => ({ ...d, ...pickProgrammatic(resolved[i]!, programmatic) }))
  }
```

In the content-type loop, after `const fieldKeys = …`, add:

```typescript
    const programmatic = contentType.fields
      .filter((f) => f.field_type === 'programmatic')
      .map((f) => f.name)
```

Change the taxonomy loop's header from `for (const [typeName] of Object.entries(registry.taxonomy_types))` to `for (const [typeName, taxonomyType] of Object.entries(registry.taxonomy_types))`. Add the same `programmatic` constant, built from `taxonomyType.fields`, after its `if (!repo) continue`.

Then replace the five call sites. Each **item** site is a pair of lines of the form

```typescript
        let data = projectRow(<row expression>, typeName, projectors)
        if (resolver?.hasSchema(typeName)) data = await resolver.resolveItem(typeName, data)
```

There are three: the singleton handler, the content item handler, and the taxonomy item handler. Each becomes `const data = await respondItem(<row expression>, typeName, programmatic)`, keeping that site's own row expression. Each **list** site is the `const labeled = …map((row) => projectRow(row, typeName, projectors))` statement plus the `const data = resolver?.hasSchema(typeName) ? … : labeled` that follows it. There are two: the content collection and the taxonomy collection. Each becomes:

```typescript
        const data = await respondList(result.data as Record<string, unknown>[], typeName, programmatic)
```

Confirm `resolver.resolveItem`, `resolver.resolveList` and `labeled` no longer appear outside the two helpers.

Rewrite the `// ─── Response projection order` comment block's first bullet. It currently says the row handed to a resolver "must already speak labels". It should say the resolver reads a record projected with **current's** projectors, because `ctx.get(fieldName)` takes the field's current name on every version. It should also say the response is projected with the served version's projectors, and that only programmatic keys cross between the two.

- [ ] **Step 6: Wire current's projectors in from `app.ts`**

In `packages/api/src/app.ts`, in the per-version loop, append the top-level `projectors` to the `registerPublicContentRoutes` call:

```typescript
    // The top-level `projectors` are current's (built from the registry), and
    // are what a programmatic resolver reads on every version.
    registerPublicContentRoutes(app, registry, surface.repos, surface.projectors, surface.paths, listRateLimit, programmaticResolver, projectors)
```

This changes one thing on the current version. Programmatic keys used to appear in resolver completion order and now appear in schema order. The values are identical. It holds for current too, because each pass's `surface.projectors` is a different object from the top-level one.

- [ ] **Step 7: GraphQL — current's map for the programmatic record**

In `packages/api/src/graphql/handler.ts`, add to the `versioning` parameter's type:

```typescript
    // Current's field-key maps. A programmatic resolver reads its record in
    // current's labels on every version; omitted, it reads `fieldKeyMaps`.
    currentFieldKeyMaps?: Record<string, FieldKeyMap>
```

and change the schema build to `buildGraphQLSchema(registry, fieldKeyMaps, view, versioning.currentFieldKeyMaps ?? fieldKeyMaps)`.

In `packages/api/src/app.ts`, in the `createGraphQLHandler` call's `versioning` object, add `currentFieldKeyMaps: fieldKeyMaps,`. That is the top-level, current-only map built near the top of `createCmsApp`. It is **not** `surface.fieldKeyMaps`.

In `packages/api/src/graphql/schema.ts`, add the parameter:

```typescript
export function buildGraphQLSchema(
  registry: SchemaRegistry,
  fieldKeyMaps: Record<string, FieldKeyMap> = {},
  view?: VersionView,
  // The maps a programmatic resolver's record is built with: current's, on
  // every version. Defaults to `fieldKeyMaps`, which is right when they ARE
  // current's (no view, or the current version's own endpoint).
  programmaticKeyMaps: Record<string, FieldKeyMap> = fieldKeyMaps
): GraphQLSchema {
```

In `buildObjectType`, replace the `mediaFields` block and the comment above it with:

```typescript
    // Every live media field the type has NOW, by registry name. That is the
    // key ctx.loaders.load looks a field up by. The set is current's, not this
    // version's visible one: the programmatic record speaks current's labels,
    // and REST resolves every media field in the registry for it too.
    // Tombstones are excluded; current's map drops their column regardless.
    const mediaFieldNames = type.fields
      .filter(
        (f) =>
          f.removed !== true &&
          (f.field_type === 'image' || f.field_type === 'video' || f.field_type === 'file')
      )
      .map((f) => f.name)
```

and change the programmatic branch to:

```typescript
            resolve = programmaticFieldResolver(machineName, field.name, mediaFieldNames, programmaticKeyMaps[machineName])
```

Delete the `import type { MediaFieldKey } from './resolvers.js'` line.

Two existing tests rely on the media list still excluding things. Both keep passing:
- `schema.tombstones.test.ts`'s `loaded` assertion depends on the `removed !== true` filter.
- `schema.versioned.test.ts`'s `loaded.every((name) => name === 'hero')` holds because `HERO_TYPE` has one media field.

- [ ] **Step 8: Drop the relabel step**

In `packages/api/src/graphql/resolvers.ts`, delete `MediaFieldKey` together with its doc comment, and delete `relabelMedia` together with its doc comment. Change `programmaticFieldResolver`'s third parameter to `mediaFieldNames: readonly string[] = []` and pass it through. Replace `resolveProgrammaticRow` with:

```typescript
async function resolveProgrammaticRow(
  typeName: string,
  parent: Row,
  ctx: GraphQLContext,
  mediaFieldNames: readonly string[],
  fieldKeys?: FieldKeyMap
): Promise<Record<string, unknown>> {
  const toLabels = (row: Row): Row => (fieldKeys ? fieldKeys.toLabels(row) : row)

  if (mediaFieldNames.length === 0) return ctx.resolver.resolveItem(typeName, toLabels(parent))

  const enriched: Row = { ...parent }
  await Promise.all(mediaFieldNames.map((name) => ctx.loaders.load(typeName, name, enriched)))
  // The loaders resolve each media object IN PLACE under its storage column,
  // so toLabels carries it to its label like any scalar.
  return ctx.resolver.resolveItem(typeName, toLabels(enriched))
}
```

In the comment block above it, delete the final paragraph, the one beginning "The loaders write onto a field's REGISTRY name". Change "is projected to labels" in the paragraph before it to "is projected to CURRENT's labels (the caller passes current's map on every version)". Keep the paragraph about resolving into a COPY. It is still true and still load-bearing: the parent row must keep its raw id until the media field's own resolver runs.

In `packages/api/src/graphql/__tests__/resolvers.divergence.test.ts`, in `'maps to labels only after the media loaders have resolved'`, replace `[{ name: 'hero', exposedAs: 'hero' }],` and the comment above it with:

```typescript
      // The registry name the loaders look the field up by.
      ['hero'],
```

Then run `grep -rn "MediaFieldKey\|relabelMedia\|exposedAs: 'hero'" packages/api/src`. It should return nothing.

- [ ] **Step 9: Rewrite the resolver-authoring note**

In `docs/v2/graphql-schema-mapping.md`, replace the body of `### Writing a version-durable resolver`, both paragraphs, with:

```markdown
A programmatic resolver is written once, against the schema as it is now, and
it stays correct on every live version. The record it receives is always built
in **current's** field names. So `ctx.get('title')` returns the title on
`/graphql`, on `/graphql/<current>`, and on an older `/graphql/v1` that exposes
the same column as `legacy_title`. REST behaves the same way.

The resolver's *output* is merged into each version's response under the
programmatic field's own name. Programmatic fields are never versioned, so that
name is the same everywhere. Do not give a computed field the name of a field
that an older live version still exposes. On that version, the computed value
would replace the stored one.
```

- [ ] **Step 10: Run the tests and confirm they pass, then verify each bites**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/routes/__tests__/content.programmatic.test.ts src/graphql/__tests__ src/__tests__/column-identity.integration.test.ts
```

Expected: all pass. Then apply each new or rewritten test's named mutation, confirm it fails, restore, and confirm it passes. Record each result.

- [ ] **Step 11: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
pnpm build
```

Expected: api rises by **+5 tests**: `content.programmatic.test.ts` (+2) and the integration file (+3). The two `schema.versioned.test.ts` tests are rewritten, not added. `graphql.integration.test.ts` must pass unmodified. Its `heroMime` resolver reads `hero`, which is the same name on every version of that fixture. Note that its `TWO_LIVE_MODEL` labels current's `author_id` as `writer`, so that fixture does not meet the invariant in Task 1 Step 4. That is harmless here, because no resolver in it reads `author`.

- [ ] **Step 12: Commit**

```bash
git add packages/api/src docs/v2/graphql-schema-mapping.md
git commit -m "fix(api): hand programmatic resolvers current's labels on every version

A resolver is written once, against the current schema, but it was handed a
record in the served version's labels, so ctx.get('<current name>') was
undefined on every older version. Both surfaces now build the resolver's
record with current's field-key map and merge only programmatic values
into the version-labelled response.

Relations resolve in place under their column, so the media relabel step
GraphQL needed is gone.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: GraphQL filters reach system columns (closes #5)

Not caused by versioning. `buildFilterInputType` advertises `createdAt` and `updatedAt` on every `<Type>Filter`. But the name map handed to `translateFilters` holds only field labels, so `createdAt` falls through unchanged as its own column name. The repository then rejects it (`Invalid filter field name: createdAt`), and Yoga masks that as `INTERNAL_SERVER_ERROR`. `id`, `published` and `slug` work only because their names equal their columns.

**Files:**
- Modify: `packages/api/src/graphql/schema.ts`: the content-type `nameMap` in `buildGraphQLSchema`'s query pass
- Modify: `packages/api/src/graphql/__tests__/filters.test.ts`: the `NOTE` comment in `describe('translateFilters')`
- Test: `packages/api/src/graphql/__tests__/schema.divergence.test.ts`, `packages/api/src/__tests__/column-identity.integration.test.ts`

**Interfaces:**
- Consumes: Task 4's `gql(path, source)` helper and `progApp()`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/src/graphql/__tests__/schema.divergence.test.ts`. It reuses the file's `capturingCtx`, which serves `content--category`, and this schema has no view. **Fixture invariant (PLAN-QUALITY rule 4):** `divergentTargetType` declares `system_fields: []`. A real parsed type never does, and the fix reads that list. Reusing `sortRegistry` would therefore leave the test failing after a correct fix. The test builds its own type that carries the system fields the parser always emits:

```typescript
describe('GraphQL filter on a system field (#5)', () => {
  // As parsed: every content type carries its system fields.
  const withSystemFields: ParsedContentType = {
    ...divergentTargetType,
    system_fields: [
      { name: 'id', db_type: 'uuid', primary_key: true, nullable: false },
      { name: 'created_at', db_type: 'timestamp', default: 'now()', nullable: false },
      { name: 'updated_at', db_type: 'timestamp', default: 'now()', nullable: false },
    ],
  }
  const systemRegistry = {
    content_types: { 'content--category': withSystemFields },
    taxonomy_types: {},
    paragraph_types: {},
    enum_types: {},
  } as unknown as SchemaRegistry

  it('filters createdAt on its real column', async () => {
    // MUTATION: build nameMap from the visible labels only, as before. The
    // filter then reaches the repository keyed `createdAt`.
    const schema = buildGraphQLSchema(systemRegistry, {
      'content--category': createFieldKeyMap(withSystemFields.fields),
    })
    const captured: { opts?: Record<string, unknown> } = {}

    const result = await graphql({
      schema,
      source: '{ categories(filter: { createdAt: { gt: "2000-01-01T00:00:00Z" } }) { meta { total } } }',
      contextValue: capturingCtx(captured),
    })

    expect(result.errors).toBeUndefined()
    expect(captured.opts?.['filters']).toEqual({ created_at: { gt: '2000-01-01T00:00:00Z' } })
  })
})
```

Append to `packages/api/src/__tests__/column-identity.integration.test.ts`. This test goes through a version view and real Postgres:

```typescript
describe('column as identity — GraphQL filters on system fields (#5)', () => {
  it('filters by createdAt against the real column, on an older version', async () => {
    // Two bounds, so a filter that is silently ignored cannot pass: the row is
    // created now, after the gt bound and after the lt bound.
    // MUTATION: build nameMap from the visible labels only. Both queries then
    // return errors.
    const after = await gql('/graphql/v1',
      '{ colidBlogs(filter: { createdAt: { gt: "2000-01-01T00:00:00Z" } }) { data { blogTitle } } }')
    const before = await gql('/graphql/v1',
      '{ colidBlogs(filter: { createdAt: { lt: "2000-01-01T00:00:00Z" } }) { data { blogTitle } } }')

    expect(after.errors).toBeUndefined()
    expect(before.errors).toBeUndefined()
    expect((after.data as { colidBlogs: { data: unknown[] } }).colidBlogs.data).toEqual([{ blogTitle: 'Hello' }])
    expect((before.data as { colidBlogs: { data: unknown[] } }).colidBlogs.data).toEqual([])
  })
})
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/graphql/__tests__/schema.divergence.test.ts src/__tests__/column-identity.integration.test.ts
```

Expected: the unit test FAILS because the captured filters are keyed `createdAt`. The integration test FAILS with `errors` defined. Record what you saw.

- [ ] **Step 3: Add system fields to the name map**

In `packages/api/src/graphql/schema.ts`, in the content-type loop of the query pass, replace the `nameMap` line and its comment with:

```typescript
    // The version's own labels: translateFilters maps a GraphQL name back to a
    // label, and columnFor then takes that label to the storage column. System
    // fields go in too, because buildFilterInputType advertises createdAt and
    // updatedAt on every filter. Without them `createdAt` would fall through as
    // its own column name. columnFor returns nothing for a system field, so
    // translateFilters falls back to the name itself, which IS its column.
    const nameMap = buildFieldNameMap([
      ...visible.map((v) => v.exposedAs),
      ...ct.system_fields.map((s) => s.name),
    ])
```

The taxonomy loop's name map stays as it is. A taxonomy collection takes no `filter` argument (its `args` are `page` and `perPage` only), so system fields there would have nothing to translate.

- [ ] **Step 4: Retire the comment that documented the gap**

In `packages/api/src/graphql/__tests__/filters.test.ts`, the `NOTE` comment in `describe('translateFilters')` says production never calls `buildFieldNameMap` with `'created_at'`. That is no longer true. Replace the comment with a one-line pointer: `// schema.ts now includes system fields in the real nameMap; see the "#5" tests in schema.divergence.test.ts.` Do not change the test itself.

- [ ] **Step 5: Run the tests, then verify each bites**

```bash
cd packages/api
pnpm exec dotenv -e ../../.env.test -- vitest run src/graphql/__tests__ src/__tests__/column-identity.integration.test.ts
```

Expected: all pass. Apply each named mutation, confirm the test fails, restore it, and confirm the test passes. Record each result.

- [ ] **Step 6: Full gates**

```bash
pnpm --filter @bobbykim/manguito-cms-api test
pnpm --filter @bobbykim/manguito-cms-api typecheck
pnpm --filter @bobbykim/manguito-cms-api lint
pnpm build
```

Expected: api rises by **+2 tests**.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src
git commit -m "fix(api): let GraphQL filters reach createdAt and updatedAt

buildFilterInputType advertised createdAt and updatedAt on every filter,
but the name map translateFilters reads held field labels only, so the
camelCase name reached the repository as a column and failed. Unrelated
to versioning; it touches the same name map.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, residuals and changeset

**Files:**
- Modify: `docs/programmatic-fields.md`: the `ctx.get(fieldName)` row of the `ctx` table
- Modify: `docs/superpowers/specs/2026-09-21-graphql-versioning-design.md`: its `## Residuals` list
- Create: `.changeset/column-as-identity.md`

**Interfaces:**
- Consumes: Tasks 1–5 merged on the branch.
- Produces: nothing.

- [ ] **Step 1: Correct the `ctx.get` row**

In `docs/programmatic-fields.md`, the `ctx.get(fieldName)` row ends "Relations and media come back as their stored ids." That is wrong for media, and it says nothing about versions. Replace the row's description with:

```markdown
The stored value of a sibling field on the same record. Synchronous — the record is already loaded, so there is no database round-trip behind it. `fieldName` is the field's **current** name, on every API version. A media field comes back as its resolved media object, and a reference comes back as its stored id.
```

- [ ] **Step 2: Close the 2e residuals**

In `docs/superpowers/specs/2026-09-21-graphql-versioning-design.md`'s `## Residuals`, five bullets are closed by this branch. They are the ones beginning:
- "**The REST surface loses a renamed relation field's value entirely**"
- "**The drop-set un-drops by string**"
- "**This branch's own collision-check fix**"
- "**`filter: { createdAt: … }` is advertised**"
- "**A programmatic resolver reading a *current* label**"

Do not delete them, because the record of what was found matters. Prefix each with `**Closed by 2f**`, then a relative markdown link labelled `column as identity` that points at the sibling file `2026-10-01-column-as-identity-design.md`. The link is relative to the specs folder. After the first one's prefix, also add one sentence: `Its description of the symptom was wrong; the 2f spec's probe table gives the real one.` Leave every other residual as it is.

- [ ] **Step 3: Write the changeset**

Create `.changeset/column-as-identity.md`:

```markdown
---
'@bobbykim/manguito-cms-api': minor
---

Treat a field's storage column as its identity, so older API versions serve
renamed fields correctly.

- A media field renamed since an older version was cut is now served on that
  version, resolved, under that version's name. It used to be missing from the
  response.
- A reference renamed since an older version was cut can now be `?include=`d on
  that version, under that version's name. It used to return 400 whichever name
  was used.
- A version whose field name equals a different field's name or column no
  longer serves that other field's data.
- Two schema shapes that used to stop the app at startup now start and map
  correctly: a field named after another field's column, and a live field
  named after a removed field's retained column.
- Programmatic resolvers now read a record in the current schema's field names
  on every version, over both REST and GraphQL. On an older version,
  `ctx.get('<current name>')` used to be `undefined`.
- GraphQL `filter: { createdAt: … }` and `updatedAt` now work. They used to
  fail with an internal error.
```

- [ ] **Step 4: Gates and the plan linter**

```bash
pnpm lint:plans docs/superpowers/specs/2026-09-21-graphql-versioning-design.md docs/superpowers/specs/2026-10-01-column-as-identity-design.md
pnpm test
pnpm build
```

Expected: the linter passes. Every package's suite passes. Against the baselines in Global Constraints, api is up **+24** and core, cli, db and admin are unchanged.

- [ ] **Step 5: Commit**

```bash
git add docs/programmatic-fields.md docs/superpowers/specs/2026-09-21-graphql-versioning-design.md .changeset/column-as-identity.md
git commit -m "docs(api): record column-as-identity and close the 2e residuals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
