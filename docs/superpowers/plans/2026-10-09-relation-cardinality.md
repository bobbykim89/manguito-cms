# Relation Cardinality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every relation field one shape everywhere, decided by a single core rule. Stop the silent paragraph data loss, the 500s on relation writes and deletes, and leaking SQL in 500 responses.

**Architecture:** Core gains `relationCardinality(field) → 'one' | 'many' | null`. It is published from the main entry for the API and CLI, and from a browser-safe subpath, `@bobbykim/manguito-cms-core/cardinality`, for the admin. Every layer that shapes, validates or renders a relation value calls it:
- the API's read shaping (REST and GraphQL);
- write validation;
- the write-schema codegen;
- the admin editor, picker and form defaults.

A required single reference gets `ON DELETE RESTRICT`, and the API refuses such deletes up front with a 409 that names where the item is used. `one-to-many` on references is deprecated (it holds one item) and warned about by the CLI.

**Tech Stack:** TypeScript strict, Hono, Drizzle ORM / drizzle-kit, Postgres 16, GraphQL (graphql-js), Vue 3 + @vue/test-utils + msw, Vitest, tsup, pnpm + Turborepo, Changesets.

**Spec:** [docs/superpowers/specs/2026-10-09-relation-cardinality-design.md](../specs/2026-10-09-relation-cardinality-design.md). Read it before Task 1, including its *corrected during planning* notes.

## Global Constraints

- **Branch `feat/relation-cardinality`.** Never commit to `master`. It is protected anyway ([ADR 0006](../../adr/0006-protected-master-and-ci-gate.md)).
- **Commit format:** `type(scope): subject`, scope = package (`core`, `db`, `api`, `admin`, `cli`) or `repo`. End every commit with the `Co-Authored-By` trailer your harness instructs. Never write the literal text `[skip ci]` anywhere in a commit message: GitHub then skips the required `ci` check.
- **The one rule.** After Task 6, the only code that maps `rel` to one/many is `packages/core/src/registry/cardinality.ts` and `packages/core/src/registry/deprecations.ts`. Task 11 Step 1 checks this with a grep.
- **Layer boundaries** (CLAUDE.md). The admin imports runtime values from core **only** through `@bobbykim/manguito-cms-core/cardinality`; types may still come from the main entry. Core imports nothing from db, api, admin or cli.
- **Exact strings,** copied from the spec. Tests assert them.
  - Deprecation: `` `${type_name}.${field_name} uses "one-to-many", which is deprecated for references. It holds a single item, the same as "one-to-one". Use "one-to-one" for a single item, or "many-to-many" for a list.` ``
  - Wrong relation shape, top-level error: code `VALIDATION_ERROR`, status 422, message `Relation fields have the wrong shape`. Each detail has the form `{ field, message }`.
  - In use: code `ITEM_IN_USE`, status 409. The message is built by `inUseMessage` (Task 8); the race-backstop message is `This item is still in use. Remove it from the items that use it first.`
  - Internal error: `{ code: 'INTERNAL_ERROR', message: 'Internal server error' }`.
- **Running one test file:** `pnpm --filter <package> test <path-relative-to-package>`, e.g. `pnpm --filter @bobbykim/manguito-cms-core test src/registry/__tests__/cardinality.test.ts`. (`pnpm --filter … test -- <path>` runs the whole suite; do not use the `--` form.)
- **Integration tests need the test database:** `pnpm db:test:up`, plus `.env.test` copied from `.env.test.example`. Docker Desktop restarts have stopped this container mid-session before; if a suite reports `Could not connect`, run `pnpm db:test:up` again.
- **New integration suites run in parallel with every other file,** so each uses its own fixture prefix: `rcread` (Task 5), `rcwrite` (Task 7), `rcdel` (Task 8). Every type, table and base path derives from the prefix.
- **Every test states its mutation** (PLAN-QUALITY rule 1). Each new `it()` carries a `// MUTATION:` comment naming the wrong implementation it rejects. Steps marked *verify the mutation* apply it, watch the test fail, and restore it.
- **Never state counts.** When a step adds tests, it says "the file's total rises by N". Trust the named test files over arithmetic.
- **Gates for every task** (PLAN-QUALITY rule 7). Run these from the repo root before the task's commit. All must pass.
  - `pnpm lint`
  - `pnpm turbo run build --filter="./packages/*"` (this also type-checks the admin through `vue-tsc`)
  - `pnpm typecheck` (core, api, cli)
  - `pnpm --filter <each package the task touched> test`
- **No new dependencies.**

## Review Focus

Five inputs the spec implies but does not test directly, most likely to bite first. Each one is pinned by a test in the owning task.

1. **A one-to-one paragraph that already holds several rows,** saved through today's admin (which allows adding several items unless `max: 1` is set). Reads must return the lowest-`order` row, deterministically, never an array. → **Task 5**, test "returns the lowest-order row when legacy data holds several".
2. **Saving back exactly what the admin read returned.** The object carries `id`, `parent_id`, `parent_field`, `order` and timestamps. It must be accepted and stored, not rejected or doubled. → **Task 7**, test "accepts a round-tripped admin read value".
3. **`null` for a `'many'` field** (a paragraph list or a many-to-many reference) must get a 422, not a 500 and not a silent clear. → **Task 7**, test "rejects null for a 'many' field".
4. **A successful delete still removes the deleted item's paragraph rows,** after the delete is reordered to remove the row first. → **Task 8**, test "a successful delete still removes the item's paragraph rows".
5. **Deleting an item used only by optional references and many-to-many links** must succeed. The optional reference is cleared and the link rows removed. → **Task 8**, test "deleting a target of optional references clears them and succeeds".

---

### Task 1: The cardinality rule and its browser-safe subpath (core)

**Files:**
- Create: `packages/core/src/registry/cardinality.ts`
- Create: `packages/core/src/cardinality.ts` (subpath entry)
- Modify: `packages/core/src/index.ts`, `packages/core/tsup.config.ts`, `packages/core/package.json`
- Test: `packages/core/src/registry/__tests__/cardinality.test.ts`

**Interfaces:**
- Produces:
  - `export type Cardinality = 'one' | 'many'`
  - `export function relationCardinality(field: ParsedField): Cardinality | null`

  Both are exported from `@bobbykim/manguito-cms-core` and from `@bobbykim/manguito-cms-core/cardinality`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/registry/__tests__/cardinality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSchema } from '../../parser/parseSchema'
import type { ParsedContentType } from '../../parser/parseSchema'
import type { ParsedField } from '../types'
import { relationCardinality } from '../cardinality'

// Fields come from the real parser, so each ui_component.rel is exactly what a
// schema author's JSON produces (PLAN-QUALITY rule 4).
function parsedFields(): Record<string, ParsedField> {
  const result = parseSchema(
    {
      name: 'content--cardinality_test',
      label: 'Cardinality Test',
      type: 'content-type',
      default_base_path: 'cardinality-tests',
      only_one: false,
      fields: [
        {
          tab: {
            name: 'main',
            label: 'Main',
            fields: [
              { name: 'title', label: 'Title', type: 'text/plain', required: false },
              { name: 'hero', label: 'Hero', type: 'image', required: false },
              { name: 'link', label: 'Link', type: 'paragraph', ref: 'paragraph--link', rel: 'one-to-one', required: false },
              { name: 'cards', label: 'Cards', type: 'paragraph', ref: 'paragraph--card', rel: 'one-to-many', required: false },
              { name: 'author', label: 'Author', type: 'reference', target: 'taxonomy--author', rel: 'one-to-one', required: false },
              { name: 'category', label: 'Category', type: 'reference', target: 'taxonomy--category', rel: 'one-to-many', required: false },
              { name: 'tags', label: 'Tags', type: 'reference', target: 'taxonomy--tag', rel: 'many-to-many', required: false },
            ],
          },
        },
      ],
    },
    'content-type',
    'cardinality_test.json'
  )
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  const fields = (result.schema as ParsedContentType).fields
  return Object.fromEntries(fields.map((f) => [f.name, f]))
}

const f = parsedFields()

describe('relationCardinality', () => {
  it('a one-to-one paragraph holds one item', () => {
    // MUTATION: return 'many' for every paragraph (today's REST/admin behaviour).
    expect(relationCardinality(f['link']!)).toBe('one')
  })

  it('a one-to-many paragraph holds a list', () => {
    // MUTATION: return 'one' for every paragraph.
    expect(relationCardinality(f['cards']!)).toBe('many')
  })

  it('a one-to-one reference holds one item', () => {
    // MUTATION: return 'many' for every reference.
    expect(relationCardinality(f['author']!)).toBe('one')
  })

  it('a deprecated one-to-many reference holds one item, matching its single FK column', () => {
    // MUTATION: `rel === 'one-to-one' ? 'one' : 'many'` for references (today's
    // admin/GraphQL rule), which calls one-to-many a list.
    expect(relationCardinality(f['category']!)).toBe('one')
  })

  it('a many-to-many reference holds a list', () => {
    // MUTATION: `rel === 'one-to-many' ? 'many' : 'one'` (today's codegen rule),
    // which calls many-to-many single.
    expect(relationCardinality(f['tags']!)).toBe('many')
  })

  it('is null for fields that are not relations, including single-valued media', () => {
    // MUTATION: return 'one' for any non-list field, which would make media
    // fields look like relations to every caller.
    expect(relationCardinality(f['title']!)).toBeNull()
    expect(relationCardinality(f['hero']!)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/registry/__tests__/cardinality.test.ts`
Expected: FAIL, because `../cardinality` cannot be resolved.

- [ ] **Step 3: Write the rule**

Create `packages/core/src/registry/cardinality.ts`:

```ts
import type { ParsedField } from './types'

// Whether a relation field holds one item or a list. Every layer that shapes,
// validates or renders a relation value asks this function, so they cannot
// disagree again (docs/adr/core/0008-one-rule-for-relation-cardinality.md).
export type Cardinality = 'one' | 'many'

export function relationCardinality(field: ParsedField): Cardinality | null {
  const c = field.ui_component
  if (field.field_type === 'paragraph' && c.component === 'paragraph-embed') {
    return c.rel === 'one-to-one' ? 'one' : 'many'
  }
  if (field.field_type === 'reference' && c.component === 'typeahead-select') {
    // A one-to-many reference is stored as one FK column on the owning table,
    // so it holds one item. Deprecated: see findSchemaDeprecations.
    return c.rel === 'many-to-many' ? 'many' : 'one'
  }
  return null
}
```

Create `packages/core/src/cardinality.ts`:

```ts
// Browser-safe subpath entry: `@bobbykim/manguito-cms-core/cardinality`.
// The admin bundle runs in a browser and must not import core's main entry,
// which also exports Node-only code (the schema file loader, bcryptjs). This
// entry imports types only, so the built module carries no runtime imports.
export { relationCardinality } from './registry/cardinality.js'
export type { Cardinality } from './registry/cardinality.js'
```

In `packages/core/src/index.ts`, directly after the `export type { … } from './registry/types.js'` block, add:

```ts
export { relationCardinality } from './registry/cardinality.js'
export type { Cardinality } from './registry/cardinality.js'
```

In `packages/core/tsup.config.ts`, change `entry: ['src/index.ts'],` to:

```ts
  entry: ['src/index.ts', 'src/cardinality.ts'],
```

In `packages/core/package.json`, add a second key to `"exports"` after `"."`:

```json
    "./cardinality": {
      "types": "./dist/cardinality.d.ts",
      "import": "./dist/cardinality.mjs",
      "require": "./dist/cardinality.js"
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/registry/__tests__/cardinality.test.ts`
Expected: PASS, and the file's total is 6.

Then *verify one mutation*. In `cardinality.ts`, change the reference branch to `return c.rel === 'one-to-one' ? 'one' : 'many'`, re-run, and see the "deprecated one-to-many" test fail. Restore it and re-run to green.

- [ ] **Step 5: Prove the subpath is built and browser-safe**

Run: `pnpm --filter @bobbykim/manguito-cms-core build && ls packages/core/dist | grep -E '^cardinality\.(mjs|js|d\.ts)$'`
Expected: three lines, `cardinality.d.ts`, `cardinality.js` and `cardinality.mjs`.

Run: `grep -nE "from ['\"]" packages/core/dist/cardinality.mjs`
Expected: either no output, or only relative `./chunk-*.mjs` imports. For each chunk listed, run `grep -nE "node:|bcrypt|yaml|zod|'fs'|'path'|\"fs\"|\"path\"" packages/core/dist/<chunk>`; expected: no output. This rejects a cardinality module that imports a value from the parser or loader, which would drag Node code into the browser.

- [ ] **Step 6: Gates and commit**

Run the Global Constraints gates, then:

```bash
git add packages/core/src/registry/cardinality.ts packages/core/src/cardinality.ts packages/core/src/index.ts packages/core/tsup.config.ts packages/core/package.json packages/core/src/registry/__tests__/cardinality.test.ts
git commit -m "feat(core): add relationCardinality, the one rule for relation shape"
```

---

### Task 2: Deprecation finder and RESTRICT for required references (core)

**Files:**
- Create: `packages/core/src/registry/deprecations.ts`
- Modify: `packages/core/src/registry/fieldTypeRegistry.ts`, the `reference` builder, i.e. the `foreign_key` line under the comment `// FK column on the owning table. References are independent → SET NULL.`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/registry/__tests__/deprecations.test.ts`, `packages/core/src/registry/__tests__/fieldBuilders.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `export type SchemaDeprecation = { source_file: string; type_name: string; field_name: string; message: string }`
  - `export function findSchemaDeprecations(registry: SchemaRegistry): SchemaDeprecation[]`

  Both are exported from `@bobbykim/manguito-cms-core`. A required single-column reference's `db_column.foreign_key.on_delete` is now `'RESTRICT'`.

- [ ] **Step 1: Write the failing deprecation tests**

Create `packages/core/src/registry/__tests__/deprecations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSchema } from '../../parser/parseSchema'
import type { ParsedSchema } from '../../parser/parseSchema'
import { buildSchemaRegistry } from '../../parser/validate'
import { findSchemaDeprecations } from '../deprecations'

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type' | 'paragraph-type', file: string): ParsedSchema {
  const result = parseSchema(raw, type, file)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function registryWith(withDeprecated: boolean) {
  const rel = withDeprecated ? 'one-to-many' : 'one-to-one'
  return buildSchemaRegistry(
    [
      parseOrThrow(
        {
          name: 'content--post',
          label: 'Post',
          type: 'content-type',
          default_base_path: 'posts',
          only_one: false,
          fields: [
            {
              tab: {
                name: 'main',
                label: 'Main',
                fields: [
                  { name: 'category', label: 'Category', type: 'reference', target: 'taxonomy--tag', rel, required: false },
                  { name: 'author', label: 'Author', type: 'reference', target: 'taxonomy--tag', rel: 'one-to-one', required: false },
                  { name: 'tags', label: 'Tags', type: 'reference', target: 'taxonomy--tag', rel: 'many-to-many', required: false },
                ],
              },
            },
          ],
        },
        'content-type',
        'schemas/content-types/content--post.json'
      ),
      parseOrThrow(
        {
          name: 'taxonomy--tag',
          label: 'Tag',
          type: 'taxonomy-type',
          fields: [{ name: 'parent', label: 'Parent', type: 'reference', target: 'taxonomy--tag', rel, required: false }],
        },
        'taxonomy-type',
        'schemas/taxonomy-types/taxonomy--tag.json'
      ),
      parseOrThrow(
        {
          name: 'paragraph--card',
          label: 'Card',
          type: 'paragraph-type',
          fields: [{ name: 'target', label: 'Target', type: 'reference', target: 'content--post', rel, required: false }],
        },
        'paragraph-type',
        'schemas/paragraph-types/paragraph--card.json'
      ),
    ],
    { base_paths: [] },
    { roles: [], valid_permissions: [] }
  )
}

describe('findSchemaDeprecations', () => {
  it('lists every one-to-many reference across content, taxonomy and paragraph types', () => {
    // MUTATION: scan registry.content_types only. The taxonomy and paragraph
    // entries disappear.
    const found = findSchemaDeprecations(registryWith(true))
      .map((d) => `${d.type_name}.${d.field_name}`)
      .sort()
    expect(found).toEqual(['content--post.category', 'paragraph--card.target', 'taxonomy--tag.parent'])
  })

  it('names the source file and says what to use instead', () => {
    // MUTATION: omit source_file, or reword the message. The CLI prints both.
    const d = findSchemaDeprecations(registryWith(true)).find((x) => x.field_name === 'category')!
    expect(d.source_file).toBe('schemas/content-types/content--post.json')
    expect(d.message).toBe(
      'content--post.category uses "one-to-many", which is deprecated for references. It holds a single item, the same as "one-to-one". Use "one-to-one" for a single item, or "many-to-many" for a list.'
    )
  })

  it('flags nothing when no reference uses one-to-many', () => {
    // MUTATION: flag `rel !== 'one-to-one'`. The many-to-many field is flagged.
    expect(findSchemaDeprecations(registryWith(false))).toEqual([])
  })
})
```

- [ ] **Step 2: Write the failing RESTRICT tests**

In `packages/core/src/registry/__tests__/fieldBuilders.test.ts`, inside `describe('field builders — reference', …)` after its last `it`, add:

```ts
  it('a required single reference restricts deletes of its target', () => {
    // MUTATION: keep `on_delete: 'SET NULL'` for every reference. A required
    // column is NOT NULL, so Postgres then refuses the delete with an error the
    // API reports as a 500, instead of the 409 the API now gives.
    const raw: RawReferenceField = { name: 'owner', label: 'Owner', type: 'reference', required: true, target: 'taxonomy--daily_post', rel: 'one-to-one' }
    expect(fieldTypeRegistry['reference'](raw, ctx).db_column?.foreign_key?.on_delete).toBe('RESTRICT')
  })

  it('a required deprecated one-to-many reference restricts too', () => {
    // MUTATION: apply RESTRICT only when rel === 'one-to-one'.
    const raw: RawReferenceField = { name: 'owner', label: 'Owner', type: 'reference', required: true, target: 'taxonomy--daily_post', rel: 'one-to-many' }
    expect(fieldTypeRegistry['reference'](raw, ctx).db_column?.foreign_key?.on_delete).toBe('RESTRICT')
  })

  it('an optional single reference still sets null on delete', () => {
    // MUTATION: RESTRICT every reference. Deleting a tag used by an optional
    // field would then be refused instead of clearing the field.
    const raw: RawReferenceField = { name: 'owner', label: 'Owner', type: 'reference', required: false, target: 'taxonomy--daily_post', rel: 'one-to-one' }
    expect(fieldTypeRegistry['reference'](raw, ctx).db_column?.foreign_key?.on_delete).toBe('SET NULL')
  })
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/registry/__tests__/deprecations.test.ts`
Expected: FAIL, because `../deprecations` cannot be resolved.

Run: `pnpm --filter @bobbykim/manguito-cms-core test src/registry/__tests__/fieldBuilders.test.ts`
Expected: the two "restricts" tests FAIL with `expected 'SET NULL' to be 'RESTRICT'`. The "still sets null" test passes, and has to: it guards against over-applying the change.

- [ ] **Step 4: Implement**

Create `packages/core/src/registry/deprecations.ts`:

```ts
import type { SchemaRegistry } from '../parser/validate'
import type { ParsedField } from './types'

// Schema constructs that still work but that authors should move off. Computed
// from the finished registry rather than inside the parser: ParseResult has no
// warning channel, and adding one would change a type every consumer depends on.
export type SchemaDeprecation = {
  source_file: string
  type_name: string
  field_name: string
  message: string
}

export function findSchemaDeprecations(registry: SchemaRegistry): SchemaDeprecation[] {
  const out: SchemaDeprecation[] = []
  const owners = [
    ...Object.values(registry.content_types),
    ...Object.values(registry.taxonomy_types),
    ...Object.values(registry.paragraph_types),
  ]
  for (const owner of owners) {
    for (const field of owner.fields as ParsedField[]) {
      if (field.field_type !== 'reference') continue
      const c = field.ui_component
      if (c.component !== 'typeahead-select' || c.rel !== 'one-to-many') continue
      out.push({
        source_file: owner.source_file,
        type_name: owner.name,
        field_name: field.name,
        message: `${owner.name}.${field.name} uses "one-to-many", which is deprecated for references. It holds a single item, the same as "one-to-one". Use "one-to-one" for a single item, or "many-to-many" for a list.`,
      })
    }
  }
  return out
}
```

In `packages/core/src/registry/fieldTypeRegistry.ts`, in the `reference` builder, replace:

```ts
            // FK column on the owning table. References are independent → SET NULL.
            column_name: raw.name,
            column_type: 'uuid',
            nullable: !raw.required,
            foreign_key: { table: targetTableName, column: 'id', on_delete: 'SET NULL' },
```

with:

```ts
            // FK column on the owning table. An optional reference is cleared when
            // its target is deleted (SET NULL). A required one is NOT NULL, so it
            // RESTRICTs instead: the API refuses that delete with a 409 naming the
            // items that still use the target (docs/adr/core/0008).
            column_name: raw.name,
            column_type: 'uuid',
            nullable: !raw.required,
            foreign_key: { table: targetTableName, column: 'id', on_delete: raw.required ? 'RESTRICT' : 'SET NULL' },
```

In `packages/core/src/index.ts`, after the two Task 1 cardinality exports, add:

```ts
export { findSchemaDeprecations } from './registry/deprecations.js'
export type { SchemaDeprecation } from './registry/deprecations.js'
```

- [ ] **Step 5: Run both to verify they pass**

Run the two Step 3 commands again. Expected: both PASS. `deprecations.test.ts` totals 3, and `fieldBuilders.test.ts`'s total rises by 3.

Then *verify the scan mutation*. Make `owners` hold only `Object.values(registry.content_types)`, re-run `deprecations.test.ts`, and see the first test fail. Restore it.

- [ ] **Step 6: Gates and commit**

Run the gates (core and db tests both run; db codegen consumes `on_delete`), then:

```bash
git add packages/core/src/registry/deprecations.ts packages/core/src/registry/fieldTypeRegistry.ts packages/core/src/index.ts packages/core/src/registry/__tests__/deprecations.test.ts packages/core/src/registry/__tests__/fieldBuilders.test.ts
git commit -m "feat(core): deprecate one-to-many references; restrict deletes under required ones"
```

---

### Task 3: Prove drizzle-kit migrates a delete-rule change (db)

The spec makes this a required check. If drizzle-kit does not emit SQL when only a reference's `onDelete` changes, existing projects would never receive `RESTRICT`.

**Files:**
- Test: `packages/db/src/migrations/__tests__/on-delete-change.integration.test.ts`

**Interfaces:**
- Consumes: Task 2's `RESTRICT` for required references, through core's real parser.
- Produces: nothing. This is evidence only.

- [ ] **Step 1: Write the test**

Create `packages/db/src/migrations/__tests__/on-delete-change.integration.test.ts`:

```ts
import path from 'node:path'
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { describe, it, expect, afterAll } from 'vitest'
import { parseSchema, buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { ParsedSchema } from '@bobbykim/manguito-cms-core'
import { generateSchemaFile } from '../../codegen/index'
import { generateMigration } from '../index'

// drizzle-kit must emit a migration when only a reference's delete rule
// changes. Otherwise existing projects never receive the RESTRICT that
// required references now declare. `generate` diffs schema snapshots offline,
// so no database is touched.

const TMP_DIR = path.resolve(__dirname, '..', '..', '..', 'tests', '.tmp-on-delete')
const SCHEMA_PATH = path.join(TMP_DIR, 'schema.ts')
const CONFIG_PATH = path.join(TMP_DIR, 'drizzle.config.ts')
const MIGRATIONS_FOLDER = path.join(TMP_DIR, 'migrations')

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type', file: string): ParsedSchema {
  const result = parseSchema(raw, type, file)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

function registry(ownerRequired: boolean) {
  return buildSchemaRegistry(
    [
      parseOrThrow(
        { name: 'taxonomy--od_tag', label: 'Tag', type: 'taxonomy-type', fields: [{ name: 'name', label: 'Name', type: 'text/plain', required: false }] },
        'taxonomy-type',
        'tag.json'
      ),
      parseOrThrow(
        {
          name: 'content--od_post',
          label: 'Post',
          type: 'content-type',
          default_base_path: 'od-posts',
          only_one: false,
          fields: [{ tab: { name: 'main', label: 'Main', fields: [
            { name: 'owner', label: 'Owner', type: 'reference', target: 'taxonomy--od_tag', rel: 'one-to-one', required: ownerRequired },
          ] } }],
        },
        'content-type',
        'post.json'
      ),
    ],
    { base_paths: [] },
    { roles: [], valid_permissions: [] }
  )
}

afterAll(() => rmSync(TMP_DIR, { recursive: true, force: true }))

describe('drizzle-kit and a reference delete-rule change', () => {
  it('emits a migration that re-creates the FK with ON DELETE restrict', async () => {
    // MUTATION (in core): keep SET NULL for required references (revert Task 2's
    // fieldTypeRegistry change). The second migration then has no restrict
    // clause, and this test fails.
    rmSync(TMP_DIR, { recursive: true, force: true })
    mkdirSync(TMP_DIR, { recursive: true })
    writeFileSync(
      CONFIG_PATH,
      [
        "import { defineConfig } from 'drizzle-kit'",
        'export default defineConfig({',
        "  schema: './schema.ts',",
        "  out: './migrations',",
        "  dialect: 'postgresql',",
        "  dbCredentials: { url: 'postgresql://unused:unused@localhost:1/unused' },",
        '})',
      ].join('\n')
    )

    writeFileSync(SCHEMA_PATH, generateSchemaFile(registry(false)))
    const first = await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(first.length).toBeGreaterThan(0)

    writeFileSync(SCHEMA_PATH, generateSchemaFile(registry(true)))
    const second = await generateMigration(CONFIG_PATH, MIGRATIONS_FOLDER)
    expect(second.length).toBe(1)

    // generateMigration returns the new .sql file NAMES (packages/db/src/migrations/index.ts).
    const text = readFileSync(path.join(MIGRATIONS_FOLDER, second[0]!), 'utf8')
    expect(text).toMatch(/ON DELETE restrict/i)
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @bobbykim/manguito-cms-db test src/migrations/__tests__/on-delete-change.integration.test.ts`
Expected: PASS.

If `second` is empty, drizzle-kit does not see the change. **Stop and report to the maintainer.** The spec's fallback, a hand-written migration step, is then needed and is not designed here.

- [ ] **Step 3: Verify the mutation**

Temporarily revert the `on_delete` line in `packages/core/src/registry/fieldTypeRegistry.ts` to `on_delete: 'SET NULL'`, then run `pnpm --filter @bobbykim/manguito-cms-core build`. Re-run Step 2 and see it FAIL: `second` holds only the nullability change, with no restrict. Restore the line, rebuild core, and re-run to green.

- [ ] **Step 4: Gates and commit**

```bash
git add packages/db/src/migrations/__tests__/on-delete-change.integration.test.ts
git commit -m "test(db): prove drizzle-kit migrates a reference delete-rule change"
```

---

### Task 4: Print schema deprecations in validate, build and dev (cli)

**Files:**
- Modify: `packages/cli/src/utils/error.ts`, `packages/cli/src/commands/validate.ts`, `packages/cli/src/commands/build.ts`, `packages/cli/src/commands/dev.ts`
- Test: `packages/cli/src/__tests__/error.test.ts`, `packages/cli/tests/validate.test.ts`
- Modify (mock upkeep): `packages/cli/tests/build.test.ts`, `packages/cli/tests/dev.test.ts`

**Interfaces:**
- Consumes: `findSchemaDeprecations`, `SchemaDeprecation` (Task 2).
- Produces: `export function printSchemaDeprecations(deprecations: SchemaDeprecation[]): void`, in `packages/cli/src/utils/error.ts`.

- [ ] **Step 1: Write the failing tests**

In `packages/cli/src/__tests__/error.test.ts`, change the import to also take `printSchemaDeprecations`, and append:

```ts
describe('printSchemaDeprecations', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })
  afterEach(() => {
    stdoutSpy.mockRestore()
  })

  it('prints each deprecation as a warning naming its file', () => {
    // MUTATION: print the message without the source file, or to stderr. An
    // author could not find the field, or the output reads as an error.
    printSchemaDeprecations([
      { source_file: 'schemas/content-types/post.json', type_name: 'content--post', field_name: 'category', message: 'MSG' },
    ])
    expect(stdoutSpy).toHaveBeenCalledWith('⚠ schemas/content-types/post.json: MSG\n')
  })

  it('prints nothing when there are no deprecations', () => {
    // MUTATION: print a header before the loop.
    printSchemaDeprecations([])
    expect(stdoutSpy).not.toHaveBeenCalled()
  })
})
```

In `packages/cli/tests/validate.test.ts`:
- add `findSchemaDeprecations: vi.fn().mockReturnValue([]),` to the `vi.mock('@bobbykim/manguito-cms-core', …)` factory object;
- add `findSchemaDeprecations,` to the `import { … } from '@bobbykim/manguito-cms-core'` list;
- in `beforeEach`, after `vi.mocked(computeVersionModel).mockReturnValue(…)`, add `vi.mocked(findSchemaDeprecations).mockReturnValue([])`. (`vi.resetAllMocks()` clears factory return values, so it has to be re-armed.)

Then append, inside `describe('runValidate', …)`:

```ts
  it('prints a deprecation warning and still exits 0', async () => {
    // MUTATION: route deprecations through printValidationErrors / allErrors.
    // validate then exits 1 on a schema that is valid.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    vi.mocked(findSchemaDeprecations).mockReturnValue([
      { source_file: 'post.json', type_name: 'content--post', field_name: 'category', message: 'DEPRECATED-MSG' },
    ])

    await runValidate({}, { cwd: FAKE_CWD })

    expect(process.stdout.write).toHaveBeenCalledWith('⚠ post.json: DEPRECATED-MSG\n')
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('No errors found'))
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
```

In `packages/cli/tests/build.test.ts` and `packages/cli/tests/dev.test.ts`, make the same three mock-upkeep edits: the factory entry, the import, and the `beforeEach` re-arm after `vi.resetAllMocks()`. These keep their existing tests working once the commands call the function; they add no new tests.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test src/__tests__/error.test.ts tests/validate.test.ts`
Expected: FAIL. `printSchemaDeprecations` is not exported, and the new validate test sees no `⚠` line.

- [ ] **Step 3: Implement**

In `packages/cli/src/utils/error.ts`, add `import type { SchemaDeprecation } from '@bobbykim/manguito-cms-core'` at the top, and after `printWarning`:

```ts
// Schema deprecations are warnings: they never change a command's exit code.
export function printSchemaDeprecations(deprecations: SchemaDeprecation[]): void {
  for (const d of deprecations) printWarning(`${d.source_file}: ${d.message}`)
}
```

In `packages/cli/src/commands/validate.ts`:
- add `findSchemaDeprecations,` to the `@bobbykim/manguito-cms-core` import;
- change the `../utils/error.js` import to `import { printSuccess, printValidationErrors, printSchemaDeprecations } from '../utils/error.js'`;
- directly after `const registry = buildSchemaRegistry(parsedSchemas, parsedRoutesDef, parsedRoles)`, add:

```ts
    printSchemaDeprecations(findSchemaDeprecations(registry))
```

In `packages/cli/src/commands/build.ts`, add `findSchemaDeprecations` to its core import and `printSchemaDeprecations` to its `../utils/error.js` import (add that import if absent). Directly after the `const registry = buildSchemaRegistry(` call and its closing `)`, add:

```ts
  printSchemaDeprecations(findSchemaDeprecations(registry))
```

In `packages/cli/src/commands/dev.ts`, inside `parseAllSchemas`, replace `return buildSchemaRegistry(parsedSchemas, routesResult.value, rolesResult.value)` with:

```ts
  const registry = buildSchemaRegistry(parsedSchemas, routesResult.value, rolesResult.value)
  printSchemaDeprecations(findSchemaDeprecations(registry))
  return registry
```

Add the matching imports, as in `build.ts`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter @bobbykim/manguito-cms-cli test`
Expected: PASS. `error.test.ts`'s total rises by 2 and `validate.test.ts`'s by 1; `build.test.ts` and `dev.test.ts` are unchanged and green.

Then *verify the exit-code mutation*. In `validate.ts`, temporarily push each deprecation into `allErrors` (`allErrors.push(...findSchemaDeprecations(registry).map((d) => ({ file: d.source_file, message: d.message })))`). Re-run `tests/validate.test.ts`, see the new test fail, and restore.

- [ ] **Step 5: Gates and commit**

```bash
git add packages/cli/src/utils/error.ts packages/cli/src/commands/validate.ts packages/cli/src/commands/build.ts packages/cli/src/commands/dev.ts packages/cli/src/__tests__/error.test.ts packages/cli/tests/validate.test.ts packages/cli/tests/build.test.ts packages/cli/tests/dev.test.ts
git commit -m "feat(cli): warn about deprecated one-to-many references"
```

---

### Task 5: Shape "one" paragraphs on every read (api)

**Files:**
- Create: `packages/api/src/__tests__/relation-cardinality.fixture.ts` (shared by Tasks 5–8)
- Modify: `packages/api/src/relations.ts` (`ParagraphRelationDef`, `buildRelationsMap`, the paragraph branches of `resolveRelationField` and `resolveRelationBareIds`)
- Modify: `packages/api/src/routes/admin/content.ts` (`loadParagraphRows` and the content edit read `app.get(`/admin/api/${basePath}/:id`)`)
- Modify: `packages/api/src/__tests__/relations.read.integration.test.ts` (its hand-built defs)
- Test: `packages/api/src/__tests__/relation-cardinality.read.integration.test.ts`

**Interfaces:**
- Consumes: `relationCardinality`, `Cardinality` (Task 1).
- Produces:
  - in `relations.ts`, `ParagraphRelationDef` gains `cardinality: Cardinality`;
  - `export function oneOrMany<T>(cardinality: Cardinality, list: T[]): T | T[] | null`;
  - in the fixture: `makeCardinalityFixture(prefix: string): CardinalityFixture`, `createFixtureTables(db, fx)`, `dropFixtureTables(db, fx)`, `insertTag(db, fx, name)`, `insertPost(db, fx, { slug, owner })`, `insertParagraph(db, table, row)`, `countRows(db, table, where)`. The exact signatures are in Step 1.

- [ ] **Step 1: Create the shared fixture**

Create `packages/api/src/__tests__/relation-cardinality.fixture.ts`:

```ts
import { sql } from 'drizzle-orm'
import { parseSchema, buildSchemaRegistry } from '@bobbykim/manguito-cms-core'
import type {
  ParsedField,
  ParsedSchema,
  SchemaRegistry,
  SystemField,
} from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// Shared fixture for the relation-cardinality suites. The registry is built
// through core's real parser (PLAN-QUALITY rule 4), so every ui_component.rel,
// db_column and foreign-key delete rule is what a real schema produces. The
// table SQL is derived from that parsed output, not restated, so a change to a
// delete rule reaches these tables.
//
// Each suite passes its own prefix: vitest runs files in parallel, and every
// type name, table and base path below derives from the prefix.

export type CardinalityFixture = {
  registry: SchemaRegistry
  basePath: string
  names: { post: string; tag: string; link: string; card: string }
  tables: { post: string; tag: string; link: string; card: string; tags: string }
}

function parseOrThrow(raw: unknown, type: 'content-type' | 'taxonomy-type' | 'paragraph-type'): ParsedSchema {
  const result = parseSchema(raw, type, `${type}.json`)
  if (!result.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`)
  return result.schema
}

export function makeCardinalityFixture(prefix: string): CardinalityFixture {
  const names = {
    post: `content--${prefix}_post`,
    tag: `taxonomy--${prefix}_tag`,
    link: `paragraph--${prefix}_link`,
    card: `paragraph--${prefix}_card`,
  }
  const basePath = `${prefix}-posts`
  const registry = buildSchemaRegistry(
    [
      parseOrThrow(
        {
          name: names.tag,
          label: 'Tag',
          type: 'taxonomy-type',
          fields: [
            { name: 'name', label: 'Name', type: 'text/plain', required: false },
            { name: 'tag_link', label: 'Tag link', type: 'paragraph', ref: names.link, rel: 'one-to-one', required: false },
          ],
        },
        'taxonomy-type'
      ),
      parseOrThrow(
        { name: names.link, label: 'Link', type: 'paragraph-type', fields: [{ name: 'url', label: 'URL', type: 'text/plain', required: false }] },
        'paragraph-type'
      ),
      parseOrThrow(
        {
          name: names.card,
          label: 'Card',
          type: 'paragraph-type',
          fields: [
            { name: 'heading', label: 'Heading', type: 'text/plain', required: false },
            { name: 'card_link', label: 'Card link', type: 'paragraph', ref: names.link, rel: 'one-to-one', required: false },
            { name: 'card_tag', label: 'Card tag', type: 'reference', target: names.tag, rel: 'one-to-one', required: true },
          ],
        },
        'paragraph-type'
      ),
      parseOrThrow(
        {
          name: names.post,
          label: 'Post',
          type: 'content-type',
          default_base_path: basePath,
          only_one: false,
          fields: [
            {
              tab: {
                name: 'main',
                label: 'Main',
                fields: [
                  { name: 'title', label: 'Title', type: 'text/plain', required: false },
                  { name: 'link', label: 'Link', type: 'paragraph', ref: names.link, rel: 'one-to-one', required: false },
                  { name: 'cards', label: 'Cards', type: 'paragraph', ref: names.card, rel: 'one-to-many', required: false },
                  { name: 'category', label: 'Category', type: 'reference', target: names.tag, rel: 'one-to-many', required: false },
                  { name: 'owner', label: 'Owner', type: 'reference', target: names.tag, rel: 'one-to-one', required: true },
                  { name: 'tags', label: 'Tags', type: 'reference', target: names.tag, rel: 'many-to-many', required: false },
                ],
              },
            },
          ],
        },
        'content-type'
      ),
    ],
    { base_paths: [] },
    { roles: [], valid_permissions: [] }
  )
  const post = registry.content_types[names.post]!
  return {
    registry,
    basePath,
    names,
    tables: {
      post: post.db.table_name,
      tag: registry.taxonomy_types[names.tag]!.db.table_name,
      link: registry.paragraph_types[names.link]!.db.table_name,
      card: registry.paragraph_types[names.card]!.db.table_name,
      tags: post.fields.find((f) => f.name === 'tags')!.db_column!.junction!.table_name,
    },
  }
}

const PG_TYPE: Record<string, string> = {
  uuid: 'uuid', varchar: 'varchar', text: 'text', integer: 'integer',
  decimal: 'numeric', boolean: 'boolean', timestamp: 'timestamp',
}

function tableSql(table: string, systemFields: SystemField[], fields: ParsedField[]): string {
  const cols = systemFields.map(
    (s) =>
      `"${s.name}" ${PG_TYPE[s.db_type]}` +
      (s.primary_key ? ' PRIMARY KEY' : '') +
      (s.default ? ` DEFAULT ${s.default}` : '') +
      (s.nullable ? '' : ' NOT NULL')
  )
  for (const f of fields) {
    const c = f.db_column
    if (!c || c.junction) continue
    let col = `"${c.column_name}" ${PG_TYPE[c.column_type]}` + (c.nullable ? '' : ' NOT NULL')
    if (c.foreign_key) {
      col += ` REFERENCES "${c.foreign_key.table}"("${c.foreign_key.column}") ON DELETE ${c.foreign_key.on_delete}`
    }
    cols.push(col)
  }
  return `CREATE TABLE "${table}" (${cols.join(', ')})`
}

export async function dropFixtureTables(db: DrizzlePostgresInstance, fx: CardinalityFixture): Promise<void> {
  for (const t of [fx.tables.tags, fx.tables.post, fx.tables.card, fx.tables.link, fx.tables.tag]) {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${t}" CASCADE`))
  }
  await db.execute(sql`DELETE FROM base_paths WHERE path = ${fx.basePath}`)
}

export async function createFixtureTables(db: DrizzlePostgresInstance, fx: CardinalityFixture): Promise<void> {
  await dropFixtureTables(db, fx)
  const { registry: r, names: n, tables: t } = fx
  const tag = r.taxonomy_types[n.tag]!
  const post = r.content_types[n.post]!
  const link = r.paragraph_types[n.link]!
  const card = r.paragraph_types[n.card]!
  await db.execute(sql.raw(tableSql(t.tag, tag.system_fields, tag.fields)))
  await db.execute(sql.raw(tableSql(t.post, post.system_fields, post.fields)))
  await db.execute(sql.raw(tableSql(t.link, link.system_fields, link.fields)))
  await db.execute(sql.raw(tableSql(t.card, card.system_fields, card.fields)))
  const j = post.fields.find((f) => f.name === 'tags')!.db_column!.junction!
  await db.execute(
    sql.raw(
      `CREATE TABLE "${j.table_name}" ("${j.left_column}" uuid NOT NULL REFERENCES "${t.post}"(id) ON DELETE CASCADE, ` +
        `"${j.right_column}" uuid NOT NULL REFERENCES "${j.right_table}"(id) ON DELETE CASCADE` +
        (j.order_column ? ', "order" integer NOT NULL DEFAULT 0' : '') +
        ')'
    )
  )
  await db.execute(sql`INSERT INTO base_paths (name, path) VALUES (${fx.basePath}, ${fx.basePath}) ON CONFLICT (path) DO NOTHING`)
}

export async function insertTag(db: DrizzlePostgresInstance, fx: CardinalityFixture, name: string): Promise<string> {
  const r = await db.execute(
    sql`INSERT INTO ${sql.raw(`"${fx.tables.tag}"`)} (name, published) VALUES (${name}, true) RETURNING id`
  )
  return (r.rows[0] as { id: string }).id
}

export async function insertPost(
  db: DrizzlePostgresInstance,
  fx: CardinalityFixture,
  row: { slug: string; owner: string }
): Promise<string> {
  const bp = await db.execute(sql`SELECT id FROM base_paths WHERE path = ${fx.basePath}`)
  const basePathId = (bp.rows[0] as { id: string }).id
  const r = await db.execute(
    sql`INSERT INTO ${sql.raw(`"${fx.tables.post}"`)} (slug, base_path_id, published, owner)
        VALUES (${row.slug}, ${basePathId}, true, ${row.owner}) RETURNING id`
  )
  return (r.rows[0] as { id: string }).id
}

export async function insertParagraph(
  db: DrizzlePostgresInstance,
  table: string,
  row: { parentId: string; parentType: string; parentField: string; order: number; values: Record<string, unknown> }
): Promise<string> {
  const data: Record<string, unknown> = {
    parent_id: row.parentId,
    parent_type: row.parentType,
    parent_field: row.parentField,
    order: row.order,
    ...row.values,
  }
  const cols = sql.join(Object.keys(data).map((k) => sql.raw(`"${k}"`)), sql`, `)
  const vals = sql.join(Object.values(data).map((v) => sql`${v}`), sql`, `)
  const r = await db.execute(sql`INSERT INTO ${sql.raw(`"${table}"`)} (${cols}) VALUES (${vals}) RETURNING id`)
  return (r.rows[0] as { id: string }).id
}

export async function countRows(db: DrizzlePostgresInstance, table: string, where: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`))
  return (r.rows[0] as { n: number }).n
}
```

- [ ] **Step 2: Write the failing read tests**

Create `packages/api/src/__tests__/relation-cardinality.read.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getTestDb, createTestApp, authenticatedRequest } from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  makeCardinalityFixture,
  createFixtureTables,
  dropFixtureTables,
  insertTag,
  insertPost,
  insertParagraph,
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcread')
let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>
let filledId = ''
let filledLinkId = ''
let emptyId = ''

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
  const tag = await insertTag(db, fx, 'owner-tag')

  filledId = await insertPost(db, fx, { slug: 'filled', owner: tag })
  filledLinkId = await insertParagraph(db, fx.tables.link, {
    parentId: filledId, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'u-top' },
  })
  const cardId = await insertParagraph(db, fx.tables.card, {
    parentId: filledId, parentType: fx.tables.post, parentField: 'cards', order: 0, values: { heading: 'h', card_tag: tag },
  })
  await insertParagraph(db, fx.tables.link, {
    parentId: cardId, parentType: fx.tables.card, parentField: 'card_link', order: 0, values: { url: 'u-nested' },
  })

  emptyId = await insertPost(db, fx, { slug: 'empty', owner: tag })

  // Legacy data: two rows in a one-to-one field, as today's admin allows.
  const legacyId = await insertPost(db, fx, { slug: 'legacy', owner: tag })
  await insertParagraph(db, fx.tables.link, {
    parentId: legacyId, parentType: fx.tables.post, parentField: 'link', order: 1, values: { url: 'second' },
  })
  await insertParagraph(db, fx.tables.link, {
    parentId: legacyId, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'first' },
  })
}, 30_000)

afterAll(async () => {
  await dropFixtureTables(db, fx)
})

async function publicGet(path: string) {
  const res = await app.request(`/api/${fx.basePath}/${path}`)
  return { status: res.status, body: (await res.json()) as { data: Record<string, unknown> } }
}

describe('reading a one-to-one paragraph', () => {
  it('public include returns the single row as an object', async () => {
    // MUTATION: keep `row[fieldName] = byParent[...] ?? []` in
    // resolveRelationField's paragraph branch. `link` is then an array.
    const { status, body } = await publicGet('filled?include=link')
    expect(status).toBe(200)
    expect(Array.isArray(body.data['link'])).toBe(false)
    expect(body.data['link']).toMatchObject({ url: 'u-top' })
  })

  it('public include returns null when the field is empty', async () => {
    // MUTATION: `list[0]` without `?? null`. undefined is dropped from the JSON,
    // so the key goes missing instead of reading null.
    const { body } = await publicGet('empty?include=link')
    expect(body.data['link']).toBeNull()
  })

  it('a read without include returns the single row id, not an array of ids', async () => {
    // MUTATION: keep `.map((r) => r['id'])` unwrapped in resolveRelationBareIds.
    const { body } = await publicGet('filled')
    expect(body.data['link']).toBe(filledLinkId)
  })

  it('returns the lowest-order row when legacy data holds several', async () => {
    // MUTATION: take the last row (`list[list.length - 1]`), or drop
    // `ORDER BY "order"`. The order-1 row inserted first would then win.
    const { body } = await publicGet('legacy?include=link')
    expect(body.data['link']).toMatchObject({ url: 'first' })
  })

  it('leaves one-to-many paragraphs as arrays', async () => {
    // MUTATION: shape every paragraph as 'one'.
    const { body } = await publicGet('filled?include=cards')
    expect(Array.isArray(body.data['cards'])).toBe(true)
    expect((body.data['cards'] as unknown[]).length).toBe(1)
  })

  it('the admin edit read returns objects at both nesting levels', async () => {
    // MUTATION: shape only the top level in the admin read; leave
    // loadParagraphRows' nested assignment as a list. The nested card_link is
    // then an array.
    const res = await authenticatedRequest(app, 'admin', 'GET', `/admin/api/content/${fx.names.post}/${filledId}`)
    const data = ((await res.json()) as { data: Record<string, unknown> }).data
    expect(data['link']).toMatchObject({ url: 'u-top' })
    const cards = data['cards'] as Array<Record<string, unknown>>
    expect(cards[0]!['card_link']).toMatchObject({ url: 'u-nested' })
  })

  it('the admin edit read returns null for an empty one-to-one paragraph', async () => {
    // MUTATION: leave the admin edit read assignment unshaped. It reads [].
    const res = await authenticatedRequest(app, 'admin', 'GET', `/admin/api/content/${fx.names.post}/${emptyId}`)
    const data = ((await res.json()) as { data: Record<string, unknown> }).data
    expect(data['link']).toBeNull()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/relation-cardinality.read.integration.test.ts`
Expected: FAIL. Every test except "leaves one-to-many paragraphs as arrays" fails, because `link` reads as an array. If the suite fails in `beforeAll`, the fixture is wrong: fix the fixture (for example a parse error printed by `parseOrThrow`) before going on.

- [ ] **Step 4: Implement**

In `packages/api/src/relations.ts`:
- under the existing `import type { … } from '@bobbykim/manguito-cms-core'` line, add `import { relationCardinality, type Cardinality } from '@bobbykim/manguito-cms-core'`.
- change `ParagraphRelationDef` to:

```ts
export type ParagraphRelationDef = {
  type: 'paragraph'
  table: string
  // 'one' reads as the single row (or null); 'many' as the ordered list.
  cardinality: Cardinality
}
```

- directly above `export function buildRelationsMap(`, add:

```ts
// A 'one' relation reads as its single row (or null); a 'many' relation as the
// list. Rows arrive ordered by "order", so a 'one' field holding legacy extra
// rows reads its lowest-order row.
export function oneOrMany<T>(cardinality: Cardinality, list: T[]): T | T[] | null {
  return cardinality === 'one' ? (list[0] ?? null) : list
}
```

- in `buildRelationsMap`, replace `relations[field.name] = { type: 'paragraph', table: pType.db.table_name }` with:

```ts
      relations[field.name] = {
        type: 'paragraph',
        table: pType.db.table_name,
        cardinality: relationCardinality(field) ?? 'many',
      }
```

- in `resolveRelationField`'s paragraph branch, replace `row[fieldName] = byParent[row['id'] as string] ?? []` with `row[fieldName] = oneOrMany(rel.cardinality, byParent[row['id'] as string] ?? [])`.
- in `resolveRelationBareIds`'s paragraph branch, replace `row[fieldName] = (byParent[row['id'] as string] ?? []).map((r) => r['id'])` with `row[fieldName] = oneOrMany(rel.cardinality, (byParent[row['id'] as string] ?? []).map((r) => r['id']))`.

In `packages/api/src/routes/admin/content.ts`:
- add `relationCardinality` to the imports: add the line `import { relationCardinality } from '@bobbykim/manguito-cms-core'`.
- add `oneOrMany,` to the `import { persistParagraphField, deleteParagraphField, persistJunctionField } from '../../relations.js'` list.
- in `loadParagraphRows`, replace `row[nf.name] = await loadParagraphRows(db, registry, nType, row['id'] as string, nf.name)` with:

```ts
      row[nf.name] = oneOrMany(
        relationCardinality(nf) ?? 'many',
        await loadParagraphRows(db, registry, nType, row['id'] as string, nf.name)
      )
```

- in the content edit read (`app.get(`/admin/api/${basePath}/:id`, …)`), replace `row[f.name] = await loadParagraphRows(db, registry, pType, id, f.name)` with:

```ts
              row[f.name] = oneOrMany(relationCardinality(f) ?? 'many', await loadParagraphRows(db, registry, pType, id, f.name))
```

In `packages/api/src/__tests__/relations.read.integration.test.ts`, the hand-built `quotes` and `epigraphs` defs become `{ type: 'paragraph', table: PARA_TABLE, cardinality: 'many' } as const`. Both fields are `one-to-many`, so `'many'` is their real cardinality.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/relation-cardinality.read.integration.test.ts`
Expected: PASS; the file totals 7.

Then *verify the nested mutation*: undo only the `loadParagraphRows` nested change, re-run, see "the admin edit read returns objects at both nesting levels" fail, and restore.

- [ ] **Step 6: Gates and commit**

The api suite's full run includes `relations.read.integration.test.ts`, which must stay green.

```bash
git add packages/api/src/relations.ts packages/api/src/routes/admin/content.ts packages/api/src/__tests__/relation-cardinality.fixture.ts packages/api/src/__tests__/relation-cardinality.read.integration.test.ts packages/api/src/__tests__/relations.read.integration.test.ts
git commit -m "fix(api): read one-to-one paragraphs as an object or null"
```

---

### Task 6: GraphQL types and write-schema codegen follow the rule (api)

**Files:**
- Modify: `packages/api/src/graphql/schema.ts`, the paragraph and reference branches of the field-type mapping inside `buildGraphQLSchema`
- Modify: `packages/api/src/codegen/routes.ts`, the `case 'paragraph'` and `case 'reference'` of `fieldToZodSchema`
- Test: `packages/api/src/graphql/__tests__/schema.cardinality.test.ts`, `packages/api/src/codegen/__tests__/routes.cardinality.test.ts`

**Interfaces:**
- Consumes: `relationCardinality` (Task 1); `makeCardinalityFixture` (Task 5).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/src/graphql/__tests__/schema.cardinality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getNullableType, isListType, type GraphQLObjectType } from 'graphql'
import { buildGraphQLSchema } from '../schema'
import { graphqlTypeName, toCamelCase } from '../naming'
import { makeCardinalityFixture } from '../../__tests__/relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcgql')
const schema = buildGraphQLSchema(fx.registry)

function isList(machineName: string, fieldName: string): boolean {
  const type = schema.getType(graphqlTypeName(machineName)) as GraphQLObjectType | undefined
  if (!type) throw new Error(`no GraphQL type for ${machineName}`)
  const field = type.getFields()[toCamelCase(fieldName)]
  if (!field) throw new Error(`no field ${fieldName} on ${type.name}`)
  return isListType(getNullableType(field.type))
}

describe('GraphQL relation field types follow relationCardinality', () => {
  it('a one-to-one paragraph is a single object', () => {
    // MUTATION: keep `return new GraphQLList(...)` for every paragraph.
    expect(isList(fx.names.post, 'link')).toBe(false)
  })
  it('a nested one-to-one paragraph is a single object', () => {
    // MUTATION: shape only content types' fields, not paragraph types'.
    expect(isList(fx.names.card, 'card_link')).toBe(false)
  })
  it('a one-to-many paragraph is a list', () => {
    // MUTATION: make every paragraph single.
    expect(isList(fx.names.post, 'cards')).toBe(true)
  })
  it('a deprecated one-to-many reference is a single object, like its REST read', () => {
    // MUTATION: keep `isMany = rel === 'many-to-many' || rel === 'one-to-many'`.
    expect(isList(fx.names.post, 'category')).toBe(false)
  })
  it('a many-to-many reference is a list', () => {
    // MUTATION: make every reference single.
    expect(isList(fx.names.post, 'tags')).toBe(true)
  })
})
```

Create `packages/api/src/codegen/__tests__/routes.cardinality.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fieldToZodSchema } from '../routes'
import { makeCardinalityFixture } from '../../__tests__/relation-cardinality.fixture'

const fx = makeCardinalityFixture('rccg')
const post = fx.registry.content_types[fx.names.post]!
const field = (name: string) => post.fields.find((f) => f.name === name)!

describe('fieldToZodSchema list-ness follows relationCardinality', () => {
  it('types a many-to-many reference as an array of ids', () => {
    // MUTATION: keep `ui.rel === 'one-to-many' ? 'z.array(...)' : 'z.string().uuid()'`,
    // which types many-to-many as a single id (the bug this fixes).
    expect(fieldToZodSchema(field('tags'), fx.registry)).toBe('z.array(z.string().uuid())')
  })
  it('types a deprecated one-to-many reference as a single id', () => {
    // MUTATION: the same old rule, which types one-to-many as an array.
    expect(fieldToZodSchema(field('category'), fx.registry)).toBe('z.string().uuid()')
  })
  it('types a one-to-one paragraph as an object, a one-to-many as an array', () => {
    // MUTATION: wrap every paragraph in z.array.
    expect(fieldToZodSchema(field('link'), fx.registry).startsWith('z.array(')).toBe(false)
    expect(fieldToZodSchema(field('cards'), fx.registry).startsWith('z.array(')).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/graphql/__tests__/schema.cardinality.test.ts src/codegen/__tests__/routes.cardinality.test.ts`
Expected: FAIL: the one-to-one paragraph and deprecated-reference GraphQL tests, plus the two reference codegen tests.

- [ ] **Step 3: Implement**

In `packages/api/src/graphql/schema.ts`, add `import { relationCardinality } from '@bobbykim/manguito-cms-core'` under the existing core type import. In the field-type mapping:
- in the paragraph branch, replace `return new GraphQLList(new GraphQLNonNull(target ?? MEDIA))` with:

```ts
      const t = (target ?? MEDIA) as GraphQLObjectType
      return relationCardinality(field) === 'one' ? t : new GraphQLList(new GraphQLNonNull(t))
```

- in the reference branch, delete the `const rel = …` line and replace `const isMany = rel === 'many-to-many' || rel === 'one-to-many'` with `const isMany = relationCardinality(field) === 'many'`.

In `packages/api/src/codegen/routes.ts`, add `import { relationCardinality } from '@bobbykim/manguito-cms-core'` under the existing core type import. In `fieldToZodSchema`:
- replace `return ui.rel === 'one-to-many' ? `z.array(${inner})` : inner` with `return relationCardinality(field) === 'many' ? `z.array(${inner})` : inner`;
- replace `return ui.rel === 'one-to-many' ? 'z.array(z.string().uuid())' : 'z.string().uuid()'` with `return relationCardinality(field) === 'many' ? 'z.array(z.string().uuid())' : 'z.string().uuid()'`.

- [ ] **Step 4: Run them to verify they pass**

Run the Step 2 command. Expected: PASS; 5 + 3 tests.

Then run the existing GraphQL schema tests, which must stay green: `pnpm --filter @bobbykim/manguito-cms-api test src/graphql/__tests__/schema.test.ts src/graphql/__tests__/schema.divergence.test.ts src/graphql/__tests__/schema.versioned.test.ts`.

- [ ] **Step 5: Gates and commit**

```bash
git add packages/api/src/graphql/schema.ts packages/api/src/codegen/routes.ts packages/api/src/graphql/__tests__/schema.cardinality.test.ts packages/api/src/codegen/__tests__/routes.cardinality.test.ts
git commit -m "fix(api): GraphQL and codegen types follow relationCardinality"
```

---

### Task 7: Validate relation writes; stop dropping and erasing paragraphs (api)

**Files:**
- Create: `packages/api/src/relation-input.ts`
- Modify: `packages/api/src/relations.ts` (`nestedParagraphFields`, `persistParagraphField`'s nested call, a new `paragraphItems`)
- Modify: `packages/api/src/routes/admin/content.ts`: `writeNewItem`, `writeExistingItem`, the taxonomy `app.post` and `app.patch`
- Test: `packages/api/src/__tests__/relation-cardinality.write.integration.test.ts`, `packages/api/src/__tests__/relation-input.test.ts`

**Interfaces:**
- Consumes: `relationCardinality` (Task 1); the fixture helpers (Task 5).
- Produces:
  - `export type RelationInputError = { field: string; message: string }`
  - `export function checkRelationInput(fields: ParsedField[], body: Record<string, unknown>, registry: SchemaRegistry, path?: string): RelationInputError[]`, in `relation-input.ts`
  - `export function paragraphItems(field: ParsedField, value: unknown): unknown[]`, in `relations.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `packages/api/src/__tests__/relation-input.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkRelationInput } from '../relation-input'
import { makeCardinalityFixture } from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcin')
const fields = fx.registry.content_types[fx.names.post]!.fields
const check = (body: Record<string, unknown>) => checkRelationInput(fields, body, fx.registry)

describe('checkRelationInput', () => {
  it('accepts every correct shape, and null for "one" fields', () => {
    // MUTATION: reject null for a 'one' field. Clearing a one-to-one paragraph
    // or an optional reference would become impossible.
    expect(check({ link: { url: 'x' }, cards: [], category: 'c', owner: 'o', tags: ['t'] })).toEqual([])
    expect(check({ link: null, category: null })).toEqual([])
  })

  it('rejects a list for a "one" paragraph, naming the field', () => {
    // MUTATION: accept arrays for 'one' paragraphs (today's admin shape).
    expect(check({ link: [{ url: 'x' }] })).toEqual([
      { field: 'link', message: 'link holds one item: send an object or null.' },
    ])
  })

  it('rejects null for a "many" field', () => {
    // MUTATION: treat null as an empty list. A client's null would then
    // silently clear the field.
    expect(check({ cards: null, tags: null }).map((e) => e.field)).toEqual(['cards', 'tags'])
  })

  it('rejects a list for a "one" reference, and a string for a "many" reference', () => {
    // MUTATION: skip reference fields. `[a, b]` then reaches the database and 500s.
    expect(check({ category: ['a', 'b'], tags: 'a' }).map((e) => e.field)).toEqual(['category', 'tags'])
  })

  it('checks paragraph items, with a path naming the nested field', () => {
    // MUTATION: do not descend into paragraph items.
    expect(check({ cards: [{ heading: 'h', card_link: [{ url: 'x' }], card_tag: 't' }] })).toEqual([
      { field: 'cards[0].card_link', message: 'cards[0].card_link holds one item: send an object or null.' },
    ])
  })

  it('ignores fields absent from the body', () => {
    // MUTATION: check every relation field, treating absent as undefined. A
    // title-only PATCH is then rejected.
    expect(check({ title: 'only' })).toEqual([])
  })
})
```

- [ ] **Step 2: Write the failing integration tests**

Create `packages/api/src/__tests__/relation-cardinality.write.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, createTestApp, authenticatedRequest } from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  makeCardinalityFixture,
  createFixtureTables,
  dropFixtureTables,
  insertTag,
  countRows,
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcwrite')
let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>
let tagA = ''
let tagB = ''

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
  tagA = await insertTag(db, fx, 'a')
  tagB = await insertTag(db, fx, 'b')
}, 30_000)

afterAll(async () => {
  await dropFixtureTables(db, fx)
})

const POSTS = () => `/admin/api/content/${fx.names.post}`
let slugN = 0

async function create(extra: Record<string, unknown>) {
  const res = await authenticatedRequest(app, 'admin', 'POST', POSTS(), {
    body: { slug: `p-${++slugN}`, title: 'T', owner: tagA, ...extra },
  })
  return { status: res.status, body: (await res.json()) as { data?: { id: string }; error?: { code: string; details?: Array<{ field: string }> } } }
}

async function patch(id: string, body: Record<string, unknown>) {
  const res = await authenticatedRequest(app, 'admin', 'PATCH', `${POSTS()}/${id}`, { body })
  return { status: res.status, body: (await res.json()) as { error?: { code: string } } }
}

const linkRows = (parentId: string, field = 'link') =>
  countRows(db, fx.tables.link, `parent_id = '${parentId}' AND parent_field = '${field}'`)

describe('writing a one-to-one paragraph', () => {
  it('stores an object', async () => {
    // MUTATION: keep `Array.isArray(body[f.name]) ? … : []` in writeNewItem.
    // The object is dropped and nothing is stored (today's silent loss).
    const { status, body } = await create({ link: { url: 'u1' } })
    expect(status).toBe(201)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('rejects a list with 422 and stores nothing', async () => {
    // MUTATION: drop the relationShapeError call in writeNewItem.
    const { status, body } = await create({ link: [{ url: 'u1' }] })
    expect(status).toBe(422)
    expect(body.error!.code).toBe('VALIDATION_ERROR')
    expect(body.error!.details!.map((d) => d.field)).toEqual(['link'])
  })

  it('null clears it on update', async () => {
    // MUTATION: map null to "skip" instead of an empty list. The row stays.
    const { body } = await create({ link: { url: 'u1' } })
    expect((await patch(body.data!.id, { link: null })).status).toBe(200)
    expect(await linkRows(body.data!.id)).toBe(0)
  })

  it('an update that leaves the field out keeps it', async () => {
    // MUTATION: remove `if (!(f.name in body)) continue` from writeExistingItem's
    // paragraph loop. A title-only PATCH then erases the link.
    const { body } = await create({ link: { url: 'keep' } })
    expect((await patch(body.data!.id, { title: 'renamed' })).status).toBe(200)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('an update with the wrong shape is refused and erases nothing', async () => {
    // MUTATION: validate after the paragraph loop. The rows are deleted first.
    const { body } = await create({ link: { url: 'keep' } })
    expect((await patch(body.data!.id, { link: [{ url: 'x' }] })).status).toBe(422)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('accepts a round-tripped admin read value', async () => {
    // MUTATION: reject objects carrying unknown keys (id, parent_id, order…).
    // The admin edit form saves back exactly what it read.
    const { body } = await create({ link: { url: 'rt' } })
    const read = await authenticatedRequest(app, 'admin', 'GET', `${POSTS()}/${body.data!.id}`)
    const link = ((await read.json()) as { data: { link: Record<string, unknown> } }).data.link
    expect((await patch(body.data!.id, { link })).status).toBe(200)
    expect(await linkRows(body.data!.id)).toBe(1)
  })

  it('stores a nested one-to-one paragraph inside a list item', async () => {
    // MUTATION: keep `Array.isArray(pItem[n.fieldName]) ? … : []` in
    // persistParagraphField. The nested object is dropped.
    const { body } = await create({ cards: [{ heading: 'h', card_link: { url: 'n' }, card_tag: tagA }] })
    const card = await db.execute(
      sql.raw(`SELECT id FROM "${fx.tables.card}" WHERE parent_id = '${body.data!.id}'`)
    )
    const cardId = (card.rows[0] as { id: string }).id
    expect(await linkRows(cardId, 'card_link')).toBe(1)
  })
})

describe('writing references', () => {
  it('a deprecated one-to-many reference stores one id', async () => {
    // MUTATION: reject strings for 'one' references.
    const { status, body } = await create({ category: tagB })
    expect(status).toBe(201)
    const row = await db.execute(sql.raw(`SELECT category FROM "${fx.tables.post}" WHERE id = '${body.data!.id}'`))
    expect((row.rows[0] as { category: string }).category).toBe(tagB)
  })

  it('a list for a "one" reference is a 422, not a 500', async () => {
    // MUTATION: skip reference fields in checkRelationInput. Postgres then
    // fails on `($1, $2)` and the response is a 500.
    expect((await create({ category: [tagA, tagB] })).status).toBe(422)
  })

  it('rejects null for a "many" field', async () => {
    // MUTATION: treat null as []. The request "succeeds" and clears the field.
    expect((await create({ tags: null })).status).toBe(422)
  })

  it('an update that leaves a many-to-many field out keeps its links', async () => {
    // MUTATION: remove `if (!(f.name in body)) continue` from writeExistingItem's
    // junction loop.
    const { body } = await create({ tags: [tagA, tagB] })
    expect((await patch(body.data!.id, { title: 'renamed' })).status).toBe(200)
    expect(await countRows(db, fx.tables.tags, `left_id = '${body.data!.id}'`)).toBe(2)
  })
})

describe('taxonomy writes', () => {
  const TAGS = () => `/admin/api/taxonomy/${fx.names.tag}`

  it('stores a one-to-one paragraph object, and a name-only PATCH keeps it', async () => {
    // MUTATION: wire the fixes into the content routes only. The taxonomy POST
    // drops the object, or its PATCH erases it.
    const created = await authenticatedRequest(app, 'admin', 'POST', TAGS(), { body: { name: 't', tag_link: { url: 'tl' } } })
    expect(created.status).toBe(201)
    const id = ((await created.json()) as { data: { id: string } }).data.id
    expect(await linkRows(id, 'tag_link')).toBe(1)
    const patched = await authenticatedRequest(app, 'admin', 'PATCH', `${TAGS()}/${id}`, { body: { name: 't2' } })
    expect(patched.status).toBe(200)
    expect(await linkRows(id, 'tag_link')).toBe(1)
  })

  it('rejects a list for a one-to-one paragraph', async () => {
    // MUTATION: no relationShapeError in the taxonomy POST.
    const res = await authenticatedRequest(app, 'admin', 'POST', TAGS(), { body: { name: 't', tag_link: [{ url: 'x' }] } })
    expect(res.status).toBe(422)
  })
})
```

Junction column names come from the parser: the many-to-many builder sets `left_column: 'left_id'` (the `reference` builder in `fieldTypeRegistry.ts`). That is why the query above uses `left_id`.

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/relation-input.test.ts src/__tests__/relation-cardinality.write.integration.test.ts`
Expected: FAIL. `relation-input` cannot be resolved, and the integration tests fail on silent drops, erasures and 500s. "a deprecated one-to-many reference stores one id" already passes, because today stores a string too.

- [ ] **Step 4: Implement the validator**

Create `packages/api/src/relation-input.ts`:

```ts
import { relationCardinality } from '@bobbykim/manguito-cms-core'
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'

// Shape checks for relation values in an admin write, run before any database
// work. Every relation field PRESENT in the body must match its cardinality:
//   'one'  paragraph → a plain object, or null    'one'  reference → a string, or null
//   'many' paragraph → an array of plain objects  'many' reference → an array of strings
// Paragraph items are checked recursively; `path` prefixes nested names, so an
// error names e.g. "cards[0].card_link". Absent fields are not checked: an
// update leaves them untouched.
export type RelationInputError = { field: string; message: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function checkRelationInput(
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry,
  path = '',
): RelationInputError[] {
  const errors: RelationInputError[] = []
  for (const field of fields) {
    if (!(field.name in body)) continue
    const cardinality = relationCardinality(field)
    if (cardinality === null) continue
    const value = body[field.name]
    const name = `${path}${field.name}`

    if (field.field_type === 'reference') {
      const ok =
        cardinality === 'one'
          ? value === null || typeof value === 'string'
          : Array.isArray(value) && value.every((v) => typeof v === 'string')
      if (!ok) {
        errors.push({
          field: name,
          message:
            cardinality === 'one'
              ? `${name} holds one item: send an id string or null.`
              : `${name} holds a list: send an array of id strings.`,
        })
      }
      continue
    }

    const items =
      cardinality === 'one'
        ? value === null
          ? []
          : isPlainObject(value)
            ? [value]
            : undefined
        : Array.isArray(value) && value.every(isPlainObject)
          ? value
          : undefined
    if (items === undefined) {
      errors.push({
        field: name,
        message:
          cardinality === 'one'
            ? `${name} holds one item: send an object or null.`
            : `${name} holds a list: send an array of objects.`,
      })
      continue
    }

    const comp = field.ui_component
    const pType = comp.component === 'paragraph-embed' ? registry.paragraph_types[comp.ref] : undefined
    if (!pType) continue
    items.forEach((item, i) => {
      const prefix = cardinality === 'one' ? `${name}.` : `${name}[${i}].`
      errors.push(...checkRelationInput(pType.fields, item, registry, prefix))
    })
  }
  return errors
}
```

- [ ] **Step 5: Normalise paragraph values, including nested ones**

In `packages/api/src/relations.ts`:
- directly below `oneOrMany` (Task 5), add:

```ts
// The rows persistParagraphField stores for one paragraph field's request value.
// A 'one' field carries an object (or null), a 'many' field an array. Callers
// validate shape first (checkRelationInput), so any other value means "none".
export function paragraphItems(field: ParsedField, value: unknown): unknown[] {
  if (relationCardinality(field) === 'one') {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? [value] : []
  }
  return Array.isArray(value) ? value : []
}
```

- in `nestedParagraphFields`, change the return type to `Array<{ fieldName: string; nType: ParsedParagraphType; field: ParsedField }>` and the push to `if (nType) out.push({ fieldName: f.name, nType, field: f })`.
- in `persistParagraphField`, replace `const nestedItems = Array.isArray(pItem[n.fieldName]) ? (pItem[n.fieldName] as unknown[]) : []` with `const nestedItems = paragraphItems(n.field, pItem[n.fieldName])`.

- [ ] **Step 6: Wire the routes**

In `packages/api/src/routes/admin/content.ts`:
- add `paragraphItems,` to the `../../relations.js` import list, and add `import { checkRelationInput } from '../../relation-input.js'`.
- directly below `checkRequiredFields`, add:

```ts
// 422 when a relation value's shape does not match its cardinality. Runs before
// any write, so a refused request changes nothing.
function relationShapeError(
  c: Context,
  fields: ParsedField[],
  body: Record<string, unknown>,
  registry: SchemaRegistry
): Response | null {
  const details = checkRelationInput(fields, body, registry)
  if (details.length === 0) return null
  return c.json(
    { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Relation fields have the wrong shape', details } },
    422
  )
}
```

- **`writeNewItem`.** As the first statement inside it (before `const storageBody = fieldKeys.toStorage(body)`), add:

```ts
        const shapeError = relationShapeError(c, contentType.fields, body, registry)
        if (shapeError) return shapeError
```

  In its paragraph loop, replace `const items = Array.isArray(body[f.name]) ? (body[f.name] as unknown[]) : []` with `const items = paragraphItems(f, body[f.name])`.
- **`writeExistingItem`.** Add the same two `shapeError` lines as its first statement. In its `patchParagraphFields` loop, make the first statement `if (!(f.name in body)) continue` and replace the `const items = …` line as above. In its `patchJunctionFields` loop, make the first statement `if (!(f.name in body)) continue`.
- **Taxonomy `app.post(`/admin/api/taxonomy/${typeName}`)`.** Directly after `const body = (await c.req.json()) as Record<string, unknown>`, add:

```ts
        const shapeError = relationShapeError(c, taxonomyType.fields, body, registry)
        if (shapeError) return shapeError
```

  In its `taxParagraphFields` loop, replace the `const items = …` line as above.
- **Taxonomy `app.patch(`/admin/api/taxonomy/${typeName}/:id`)`.** Directly after its `existing` not-found check, add the same two `shapeError` lines (using `taxonomyType.fields`). In its `taxPatchParagraphFields` loop, make the first statement `if (!(f.name in body)) continue` and replace the `const items = …` line as above.

Run `grep -n "Array.isArray(body\[f.name\]) ? (body\[f.name\] as unknown\[\]) : \[\]" packages/api/src/routes/admin/content.ts`.
Expected: no output. (The two junction `relatedIds` expressions use a different form and stay.)

- [ ] **Step 7: Run both to verify they pass**

Run the Step 3 command. Expected: PASS. `relation-input.test.ts` totals 6 and the write integration file totals 15.

Then *verify two mutations*, restoring each after:
- delete the `if (!(f.name in body)) continue` line in `writeExistingItem`'s paragraph loop; "an update that leaves the field out keeps it" fails;
- in `writeExistingItem`, move the `shapeError` lines below the paragraph loop; "an update with the wrong shape is refused and erases nothing" fails.

- [ ] **Step 8: Gates and commit**

The full api suite must stay green. In particular `admin-write.integration.test.ts`, whose paragraph writes are one-to-many arrays.

```bash
git add packages/api/src/relation-input.ts packages/api/src/relations.ts packages/api/src/routes/admin/content.ts packages/api/src/__tests__/relation-input.test.ts packages/api/src/__tests__/relation-cardinality.write.integration.test.ts
git commit -m "fix(api): validate relation shapes; stop dropping and erasing paragraphs on write"
```

---

### Task 8: Refuse deleting an item a required reference still uses (core, api)

**Files:**
- Create: `packages/api/src/references-in-use.ts`
- Modify: `packages/core/src/errors.ts` (`ErrorCode`), `packages/api/src/middleware/error.ts` (`ERROR_STATUS_MAP`)
- Modify: `packages/api/src/routes/admin/content.ts`: the content `app.delete(`/admin/api/${basePath}/:id`)` and the taxonomy `app.delete(`/admin/api/taxonomy/${typeName}/:id`)`
- Test: `packages/api/src/__tests__/relation-cardinality.delete.integration.test.ts`, `packages/api/src/__tests__/references-in-use.test.ts`

**Interfaces:**
- Consumes: `relationCardinality` (Task 1); `RESTRICT` (Task 2); the fixture (Task 5).
- Produces, in `references-in-use.ts`:
  - `export type ReferrerCount = { type_label: string; field_label: string; count: number }`
  - `export async function findRequiredReferrers(db: DrizzlePostgresInstance, registry: SchemaRegistry, targetType: string, id: string): Promise<ReferrerCount[]>`
  - `export function inUseMessage(referrers: ReferrerCount[]): string`
  - `export const IN_USE_RACE_MESSAGE: string`
  - `export function isForeignKeyViolation(err: unknown): boolean`

  `ErrorCode` gains `'ITEM_IN_USE'`, mapped to 409.

- [ ] **Step 1: Write the failing unit tests**

Create `packages/api/src/__tests__/references-in-use.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { inUseMessage, isForeignKeyViolation } from '../references-in-use'

describe('inUseMessage', () => {
  it('totals the uses and names each location by its labels', () => {
    // MUTATION: list counts without labels, or report the location count (2)
    // instead of the item total (3).
    expect(
      inUseMessage([
        { type_label: 'Blog Post', field_label: 'Author', count: 2 },
        { type_label: 'Card', field_label: 'Link target', count: 1 },
      ])
    ).toBe('This item is still used by 3 items: 2 in Blog Post (Author), 1 in Card (Link target). Remove it from those first.')
  })

  it('uses the singular for one use', () => {
    // MUTATION: always "items".
    expect(inUseMessage([{ type_label: 'Post', field_label: 'Owner', count: 1 }])).toBe(
      'This item is still used by 1 item: 1 in Post (Owner). Remove it from those first.'
    )
  })
})

describe('isForeignKeyViolation', () => {
  it('finds SQLSTATE 23503 on the error or on its cause', () => {
    // MUTATION: check only err.code. Drizzle wraps the driver error in `cause`,
    // so the race backstop would miss it and 500.
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true)
    expect(isForeignKeyViolation(Object.assign(new Error('Failed query'), { cause: { code: '23503' } }))).toBe(true)
  })

  it('is false for other errors', () => {
    // MUTATION: treat every database error as "in use".
    expect(isForeignKeyViolation(Object.assign(new Error('x'), { cause: { code: '23505' } }))).toBe(false)
    expect(isForeignKeyViolation(new Error('x'))).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing integration tests**

Create `packages/api/src/__tests__/relation-cardinality.delete.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { getTestDb, createTestApp, authenticatedRequest } from '@bobbykim/manguito-cms-test-utils'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'
import {
  makeCardinalityFixture,
  createFixtureTables,
  dropFixtureTables,
  insertTag,
  insertPost,
  insertParagraph,
  countRows,
} from './relation-cardinality.fixture'

const fx = makeCardinalityFixture('rcdel')
const EXTRA = 'rcdel_outside_ref'
let db: DrizzlePostgresInstance
let app: ReturnType<typeof createTestApp>

beforeAll(async () => {
  process.env['AUTH_SECRET'] ??= 'test-secret'
  db = await getTestDb()
  await createFixtureTables(db, fx)
  app = createTestApp(fx.registry, db)
}, 30_000)

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
  await dropFixtureTables(db, fx)
})

const delTag = (id: string) => authenticatedRequest(app, 'admin', 'DELETE', `/admin/api/taxonomy/${fx.names.tag}/${id}`)
const delPost = (id: string) => authenticatedRequest(app, 'admin', 'DELETE', `/admin/api/content/${fx.names.post}/${id}`)

describe('deleting an item a required reference uses', () => {
  it('is refused with 409 ITEM_IN_USE naming each location, and the item stays', async () => {
    // MUTATION: skip findRequiredReferrers in the taxonomy delete. RESTRICT then
    // fires, and the response is the generic race message (or a 500 before
    // Task 9), with no locations.
    const tag = await insertTag(db, fx, 'used')
    const post = await insertPost(db, fx, { slug: 'uses-tag', owner: tag })
    await insertParagraph(db, fx.tables.card, {
      parentId: post, parentType: fx.tables.post, parentField: 'cards', order: 0, values: { card_tag: tag },
    })
    const res = await delTag(tag)
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('ITEM_IN_USE')
    expect(body.error.message).toBe(
      'This item is still used by 2 items: 1 in Post (Owner), 1 in Card (Card tag). Remove it from those first.'
    )
    expect(await countRows(db, fx.tables.tag, `id = '${tag}'`)).toBe(1)
  })

  it('maps a foreign-key violation the pre-check cannot see to 409, touching nothing', async () => {
    // MUTATION: keep the old order (paragraph cleanup, then repo.delete) or drop
    // the isForeignKeyViolation catch. The post's link row is then gone, or the
    // response is a 500.
    await db.execute(sql.raw(`DROP TABLE IF EXISTS "${EXTRA}"`))
    const tag = await insertTag(db, fx, 'owner')
    const post = await insertPost(db, fx, { slug: 'outside-ref', owner: tag })
    await insertParagraph(db, fx.tables.link, {
      parentId: post, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'stay' },
    })
    // A table outside the registry stands in for a use added after the check.
    await db.execute(
      sql.raw(`CREATE TABLE "${EXTRA}" (ref uuid NOT NULL REFERENCES "${fx.tables.post}"(id) ON DELETE RESTRICT)`)
    )
    await db.execute(sql.raw(`INSERT INTO "${EXTRA}" (ref) VALUES ('${post}')`))

    const res = await delPost(post)
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'This item is still in use. Remove it from the items that use it first.'
    )
    expect(await countRows(db, fx.tables.post, `id = '${post}'`)).toBe(1)
    expect(await countRows(db, fx.tables.link, `parent_id = '${post}'`)).toBe(1)
  })
})

describe('deletes that must still succeed', () => {
  it('deleting a target of optional references clears them and succeeds', async () => {
    // MUTATION: count optional references in findRequiredReferrers too. The
    // delete is then refused although nothing requires the tag.
    const owner = await insertTag(db, fx, 'owner')
    const optional = await insertTag(db, fx, 'optional')
    const post = await insertPost(db, fx, { slug: 'optional-uses', owner })
    await db.execute(sql.raw(`UPDATE "${fx.tables.post}" SET category = '${optional}' WHERE id = '${post}'`))
    await db.execute(sql.raw(`INSERT INTO "${fx.tables.tags}" (left_id, right_id) VALUES ('${post}', '${optional}')`))

    const res = await delTag(optional)
    expect(res.status).toBe(200)
    expect(await countRows(db, fx.tables.post, `id = '${post}' AND category IS NULL`)).toBe(1)
    expect(await countRows(db, fx.tables.tags, `right_id = '${optional}'`)).toBe(0)
  })

  it('a successful delete still removes the item\'s paragraph rows', async () => {
    // MUTATION: return right after repo.delete, dropping the cleanup moved
    // after it.
    const owner = await insertTag(db, fx, 'owner')
    const post = await insertPost(db, fx, { slug: 'with-paragraphs', owner })
    await insertParagraph(db, fx.tables.link, {
      parentId: post, parentType: fx.tables.post, parentField: 'link', order: 0, values: { url: 'gone' },
    })
    expect((await delPost(post)).status).toBe(200)
    expect(await countRows(db, fx.tables.link, `parent_id = '${post}'`)).toBe(0)
  })
})
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/__tests__/references-in-use.test.ts src/__tests__/relation-cardinality.delete.integration.test.ts`
Expected: FAIL. `references-in-use` cannot be resolved, and the two refusal tests get 500. The two "must still succeed" tests pass, and must keep passing: they guard the reorder.

- [ ] **Step 4: Implement**

In `packages/core/src/errors.ts`, add after `| 'MEDIA_IN_USE'`:

```ts
  | 'ITEM_IN_USE'
```

In `packages/api/src/middleware/error.ts`, add `ITEM_IN_USE: 409,` after `MEDIA_IN_USE: 409,` in `ERROR_STATUS_MAP`.

Create `packages/api/src/references-in-use.ts`:

```ts
import { sql } from 'drizzle-orm'
import { relationCardinality } from '@bobbykim/manguito-cms-core'
import type { ParsedField, SchemaRegistry } from '@bobbykim/manguito-cms-core'
import type { DrizzlePostgresInstance } from '@bobbykim/manguito-cms-db'

// Which required references still point at an item about to be deleted. A
// required single-column reference RESTRICTs deletes of its target
// (docs/adr/core/0008), so the delete routes ask first and answer 409 with
// these locations. Optional references are left out: their FK sets null, so
// deleting the target simply clears them.
export type ReferrerCount = { type_label: string; field_label: string; count: number }

function quoteIdent(name: string): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`)
  return `"${name}"`
}

function isRequiredSingleReferenceTo(f: ParsedField, targetType: string): boolean {
  return (
    f.field_type === 'reference' &&
    f.required &&
    relationCardinality(f) === 'one' &&
    f.db_column?.foreign_key !== undefined &&
    f.ui_component.component === 'typeahead-select' &&
    f.ui_component.ref === targetType
  )
}

export async function findRequiredReferrers(
  db: DrizzlePostgresInstance,
  registry: SchemaRegistry,
  targetType: string,
  id: string
): Promise<ReferrerCount[]> {
  const owners = [
    ...Object.values(registry.content_types),
    ...Object.values(registry.taxonomy_types),
    ...Object.values(registry.paragraph_types),
  ]
  const out: ReferrerCount[] = []
  for (const owner of owners) {
    for (const f of owner.fields) {
      if (!isRequiredSingleReferenceTo(f, targetType)) continue
      const r = await db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.raw(quoteIdent(owner.db.table_name))} WHERE ${sql.raw(quoteIdent(f.db_column!.column_name))} = ${id}`
      )
      const n = (r.rows[0] as { n: number }).n
      if (n > 0) out.push({ type_label: owner.label, field_label: f.label, count: n })
    }
  }
  return out
}

export function inUseMessage(referrers: ReferrerCount[]): string {
  const total = referrers.reduce((sum, r) => sum + r.count, 0)
  const where = referrers.map((r) => `${r.count} in ${r.type_label} (${r.field_label})`).join(', ')
  return `This item is still used by ${total} item${total === 1 ? '' : 's'}: ${where}. Remove it from those first.`
}

// The backstop's message: a use added between the check and the delete, which
// the RESTRICT constraint refused. The pre-check's labels are not available.
export const IN_USE_RACE_MESSAGE = 'This item is still in use. Remove it from the items that use it first.'

// Postgres reports a foreign-key violation as SQLSTATE 23503. Drizzle wraps the
// driver error, so the code sits on the error itself or a few causes down.
export function isForeignKeyViolation(err: unknown): boolean {
  let e: unknown = err
  for (let depth = 0; depth < 3 && typeof e === 'object' && e !== null; depth++) {
    if ((e as { code?: unknown }).code === '23503') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}
```

In `packages/api/src/routes/admin/content.ts`, add `import { findRequiredReferrers, inUseMessage, IN_USE_RACE_MESSAGE, isForeignKeyViolation } from '../../references-in-use.js'`.

Replace the body of the content delete handler, everything after the `if (!item) { … 404 }` block up to and including `return c.json({ ok: true })`, with:

```ts
        // Refuse while a required reference still points here (docs/adr/core/0008).
        const referrers = db ? await findRequiredReferrers(db, registry, typeName, id) : []
        if (referrers.length > 0) {
          return c.json({ ok: false, error: { code: 'ITEM_IN_USE', message: inUseMessage(referrers) } }, 409)
        }

        // Delete the row FIRST. If a use slipped in after the check, RESTRICT
        // refuses here, before anything else has changed: there are no
        // transactions, so cleaning up first would lose the paragraphs and
        // media counts of an item that then survives.
        try {
          await repo.delete(id)
        } catch (err) {
          if (isForeignKeyViolation(err)) {
            return c.json({ ok: false, error: { code: 'ITEM_IN_USE', message: IN_USE_RACE_MESSAGE } }, 409)
          }
          throw err
        }

        // The row is gone. Paragraph rows have no FK back to it, so remove them
        // now, and release every media reference the item held.
        const mediaDeltas: MediaDelta[] = [
          topLevelMediaDelta(mediaFields, item as Record<string, unknown>, null),
        ]
        if (db) {
          for (const f of paragraphFieldDefs) {
            const comp = f.ui_component as { component: string; ref?: string }
            if (comp.component !== 'paragraph-embed' || !comp.ref) continue
            const pType = registry.paragraph_types[comp.ref]
            if (!pType) continue
            mediaDeltas.push(await deleteParagraphField(db, id, f.name, pType, registry))
          }
        }
        await applyMediaReferenceDelta(mergeMediaDeltas(...mediaDeltas), mediaRepo)

        return c.json({ ok: true })
```

Make the same replacement in the taxonomy delete handler, using `typeName` from the taxonomy loop (`for (const [typeName, taxonomyType] of …)`). The code is identical.

- [ ] **Step 5: Run both to verify they pass**

Run the Step 3 command. Expected: PASS. `references-in-use.test.ts` totals 4 and the delete integration file 4.

Then *verify the order mutation*. In the content delete handler, move the `try { await repo.delete(id) } …` block below the paragraph cleanup, re-run, and see "maps a foreign-key violation … touching nothing" fail on the link-row count. Restore it.

- [ ] **Step 6: Gates and commit**

```bash
git add packages/core/src/errors.ts packages/api/src/middleware/error.ts packages/api/src/references-in-use.ts packages/api/src/routes/admin/content.ts packages/api/src/__tests__/references-in-use.test.ts packages/api/src/__tests__/relation-cardinality.delete.integration.test.ts
git commit -m "fix(api): refuse deleting an item a required reference still uses"
```

---

### Task 9: Never send internal error detail to clients (api)

**Files:**
- Modify: `packages/api/src/middleware/error.ts` (`errorHandler`)
- Test: `packages/api/src/middleware/__tests__/error.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing test**

Create `packages/api/src/middleware/__tests__/error.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { errorHandler } from '../error'

function appThrowing(err: unknown) {
  const app = new Hono()
  app.get('/boom', () => {
    throw err
  })
  app.onError(errorHandler)
  return app
}

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())

describe('errorHandler', () => {
  it('hides an uncoded error behind a generic message, and still logs it', async () => {
    // MUTATION: keep `message: err.message`. The response then carries the SQL
    // and its parameter values, as the relation probe measured.
    const res = await appThrowing(new Error('Failed query: DELETE FROM "secret_table" params: 42')).request('/boom')
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } })
    expect(text).not.toContain('secret_table')
    expect(errorSpy).toHaveBeenCalled()
  })

  it('hides a driver error whose code is a Postgres SQLSTATE', async () => {
    // MUTATION: pass through any error with a `code`. "23503" is a code too.
    const res = await appThrowing(Object.assign(new Error('violates foreign key "fk_x"'), { code: '23503' })).request('/boom')
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('fk_x')
  })

  it('keeps the message of a deliberately coded error', async () => {
    // MUTATION: hide every message. Clients lose "Not found" and every 4xx reason.
    const res = await appThrowing(Object.assign(new Error('No such post'), { code: 'NOT_FOUND' })).request('/boom')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'No such post' } })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/middleware/__tests__/error.test.ts`
Expected: FAIL. The first two tests see the raw message; the third passes.

- [ ] **Step 3: Implement**

In `packages/api/src/middleware/error.ts`, replace the body of `errorHandler` with:

```ts
export const errorHandler: ErrorHandler = (err, c) => {
  console.error(err.stack ?? err.message)

  // Only an error raised deliberately, with a code the API maps to a status,
  // carries a message written for clients. Anything else (no code, or a
  // driver's code such as Postgres SQLSTATE '23503') may carry SQL, values or
  // internals: the client gets a generic message and the log keeps the rest.
  const raw = (err as ApiError).code
  const deliberate = raw !== undefined && raw !== 'INTERNAL_ERROR' && (raw as string) in ERROR_STATUS_MAP
  if (!deliberate) {
    return c.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
  }
  const status = ERROR_STATUS_MAP[raw] ?? 500
  return c.json({ ok: false, error: { code: raw, message: err.message } }, status as Parameters<typeof c.json>[1])
}
```

- [ ] **Step 4: Run it to verify it passes, then the whole api suite**

Run: `pnpm --filter @bobbykim/manguito-cms-api test src/middleware/__tests__/error.test.ts`. Expected: PASS, 3 tests.

Run: `pnpm --filter @bobbykim/manguito-cms-api test`. Expected: PASS. If an existing test asserted a raw message on a 500, it was asserting the leak: change its expectation to `'Internal server error'` and say so in the commit body.

- [ ] **Step 5: Gates and commit**

```bash
git add packages/api/src/middleware/error.ts packages/api/src/middleware/__tests__/error.test.ts
git commit -m "fix(api): stop sending internal error details to clients"
```

---

### Task 10: The admin edits "one" relations as one item (admin)

**Files:**
- Create: `packages/admin/src/utils/field-defaults.ts`
- Modify: `packages/admin/src/views/content/ContentFormView.vue` (delete its local `defaultForField`, import the new one)
- Modify: `packages/admin/src/components/fields/ReferenceSelect.vue` (`relType` / `isMulti`)
- Modify: `packages/admin/src/components/fields/ParagraphEmbed.vue` (full replacement below)
- Test: `packages/admin/src/utils/__tests__/field-defaults.test.ts`, `packages/admin/src/components/fields/__tests__/ParagraphEmbed.test.ts`, `packages/admin/src/components/fields/__tests__/ReferenceSelect.test.ts`, `packages/admin/src/composables/__tests__/useFormValidation.test.ts`

**Interfaces:**
- Consumes: `relationCardinality` from `@bobbykim/manguito-cms-core/cardinality` (Task 1). Never from the main entry.

**No change needed for delete errors.** The spec asks the plan to confirm that the admin shows the API's message when a delete is refused. Traced on 2026-10-09: `doDelete` in `ContentFormView.vue` sets `formError` from `res.error.message` when `!res.ok`, and `TaxonomyFormView.vue` does the same in its delete path. The list views have no delete action. The 409 `ITEM_IN_USE` text from Task 8 therefore reaches the editor unchanged.
- Produces: `export function defaultForField(field: ParsedField): unknown`, in `field-defaults.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/admin/src/utils/__tests__/field-defaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { defaultForField } from '../field-defaults'

const rel = (field_type: 'paragraph' | 'reference', r: 'one-to-one' | 'one-to-many' | 'many-to-many'): ParsedField =>
  ({
    name: 'x', label: 'X', field_type, required: false, nullable: true, order: 0,
    validation: { required: false }, db_column: null,
    ui_component: field_type === 'paragraph'
      ? { component: 'paragraph-embed', ref: 'paragraph--p', rel: r }
      : { component: 'typeahead-select', ref: 'taxonomy--t', rel: r },
  }) as ParsedField

describe('defaultForField', () => {
  it('starts "one" relations empty as null', () => {
    // MUTATION: keep `case 'paragraph': return []`. The one-to-one editor would
    // then receive an array.
    expect(defaultForField(rel('paragraph', 'one-to-one'))).toBeNull()
    expect(defaultForField(rel('reference', 'one-to-many'))).toBeNull()
  })
  it('starts "many" relations empty as []', () => {
    // MUTATION: return null for every relation.
    expect(defaultForField(rel('paragraph', 'one-to-many'))).toEqual([])
    expect(defaultForField(rel('reference', 'many-to-many'))).toEqual([])
  })
})
```

Create `packages/admin/src/components/fields/__tests__/ParagraphEmbed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import ParagraphEmbed from '../ParagraphEmbed.vue'

// Stands in for a generated paragraph form: one button that emits a value.
const StubForm = defineComponent({
  props: { modelValue: { type: Object, default: null }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup(_, { emit }) {
    return () => h('button', { class: 'stub-form', onClick: () => emit('update:modelValue', { url: 'edited' }) }, 'stub')
  },
})

const field = (rel: 'one-to-one' | 'one-to-many'): ParsedField =>
  ({
    name: 'link', label: 'Link', field_type: 'paragraph', required: false, nullable: true, order: 0,
    validation: { required: false }, db_column: null,
    ui_component: { component: 'paragraph-embed', ref: 'paragraph--link', rel },
  }) as ParsedField

const mountWith = (rel: 'one-to-one' | 'one-to-many', modelValue: unknown) =>
  mount(ParagraphEmbed, { props: { field: field(rel), modelValue, formComponent: StubForm } })

describe('ParagraphEmbed, one-to-one', () => {
  it('when empty, Add emits a single object, not a list', async () => {
    // MUTATION: render list mode for every rel. Add then emits [{ order: 0 }].
    const w = mountWith('one-to-one', null)
    await w.get('button').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([{}])
  })

  it('edits emit the item object', async () => {
    // MUTATION: wrap single edits as [value].
    const w = mountWith('one-to-one', { url: 'a' })
    await w.get('.stub-form').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([{ url: 'edited' }])
  })

  it('Remove emits null and offers no second item', async () => {
    // MUTATION: keep the list's Add button visible in single mode.
    const w = mountWith('one-to-one', { url: 'a' })
    expect(w.findAll('button').filter((b) => b.text().includes('Add'))).toHaveLength(0)
    await w.get('[aria-label="Remove Link"]').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([null])
  })

  it('treats a legacy array value as empty, showing Add', () => {
    // MUTATION: index into an array value. A stale list renders as an item.
    const w = mountWith('one-to-one', [{ url: 'a' }])
    expect(w.findAll('.stub-form')).toHaveLength(0)
    expect(w.text()).toContain('Add Link')
  })
})

describe('ParagraphEmbed, one-to-many (unchanged)', () => {
  it('Add appends an ordered item to the list', async () => {
    // MUTATION: route one-to-many into single mode.
    const w = mountWith('one-to-many', [])
    await w.get('button').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([[{ order: 0 }]])
  })
})
```

In `packages/admin/src/components/fields/__tests__/ReferenceSelect.test.ts`, append inside `describe('ReferenceSelect', …)`:

```ts
  it('a deprecated one-to-many reference is a single picker and emits one id', async () => {
    // MUTATION: keep `isMulti = relType !== 'one-to-one'`. Selecting then emits
    // ['u1'], which the API now rejects with 422.
    server.use(
      http.get(`${ADMIN}/api/content/content--user`, () =>
        HttpResponse.json({ ok: true, data: [{ id: 'u1', title: 'Alice' }] })
      )
    )
    const wrapper = mountComponent(
      makeField({ ui_component: { component: 'typeahead-select', ref: 'content--user', rel: 'one-to-many' } })
    )
    await wrapper.find('input').setValue('al')
    await wrapper.find('input').trigger('input')
    await vi.runAllTimersAsync()
    await flushPromises()
    await wrapper.findAll('[role="option"]')[0]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['u1'])
  })
```

In `packages/admin/src/composables/__tests__/useFormValidation.test.ts`, append inside `describe('useFormValidation', …)` (the file's `makeField` helper defaults to a required text field):

```ts
  it('validate(): required one-to-one paragraph left empty (null) → required error', () => {
    // MUTATION: drop `value === null` from isEmpty. An empty one-to-one
    // paragraph would then pass "required".
    const { validate, touch, errors } = useFormValidation()
    const field = makeField({
      name: 'link', label: 'Link', field_type: 'paragraph', db_column: null,
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--link', rel: 'one-to-one' },
    })
    touch('link')
    validate([field], { link: null })
    expect(errors.value['link']).toBe('Link is required.')
  })

  it('validate(): max_items never counts a one-to-one object', () => {
    // MUTATION: treat a non-array value as a one-item list in the max_items
    // check. A filled one-to-one paragraph would then fail max 0.
    const { validate, touch, errors } = useFormValidation()
    const field = makeField({
      name: 'link', label: 'Link', field_type: 'paragraph', required: false, db_column: null,
      validation: { required: false, max_items: 0 },
      ui_component: { component: 'paragraph-embed', ref: 'paragraph--link', rel: 'one-to-one' },
    })
    touch('link')
    validate([field], { link: { url: 'a' } })
    expect(errors.value['link']).toBeUndefined()
  })
```

Both pin behaviour that already holds, as the spec's correction notes, so they pass on the first run. That is expected; their mutations are verified in Step 4.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @bobbykim/manguito-cms-admin test src/utils/__tests__/field-defaults.test.ts src/components/fields/__tests__/ParagraphEmbed.test.ts src/components/fields/__tests__/ReferenceSelect.test.ts`
Expected: FAIL. `field-defaults` cannot be resolved, the four one-to-one `ParagraphEmbed` tests fail (list mode), and the new `ReferenceSelect` test emits `[['u1']]`.

- [ ] **Step 3: Implement**

Create `packages/admin/src/utils/field-defaults.ts`:

```ts
import type { ParsedField } from '@bobbykim/manguito-cms-core'
// The browser-safe subpath: core's main entry also carries Node-only code.
import { relationCardinality } from '@bobbykim/manguito-cms-core/cardinality'

// The value a new form starts each field at. A relation starts as null when it
// holds one item and [] when it holds a list (relationCardinality).
export function defaultForField(field: ParsedField): unknown {
  switch (field.field_type) {
    case 'text/plain':
    case 'text/rich':
      return ''
    case 'integer':
    case 'float':
      return null
    case 'boolean':
      return false
    case 'date':
      return null
    case 'image':
    case 'video':
    case 'file':
      return null
    case 'enum':
      return ''
    case 'reference':
    case 'paragraph':
      return relationCardinality(field) === 'many' ? [] : null
    default:
      return null
  }
}
```

In `packages/admin/src/views/content/ContentFormView.vue`, delete the local `function defaultForField(field: ParsedField): unknown { … }` and add `import { defaultForField } from '../../utils/field-defaults'` to the script imports. Remove the `ParsedField` type import only if nothing else in the file uses it.

In `packages/admin/src/components/fields/ReferenceSelect.vue`, add `import { relationCardinality } from '@bobbykim/manguito-cms-core/cardinality'`. Delete the line `const relType = computed(() => typeaheadComp.value?.rel ?? 'one-to-one')`, and replace `const isMulti = computed(() => relType.value !== 'one-to-one')` with:

```ts
const isMulti = computed(() => relationCardinality(props.field) === 'many')
```

Then run `grep -n "relType" packages/admin/src/components/fields/ReferenceSelect.vue`. Expected: no output.

Replace `packages/admin/src/components/fields/ParagraphEmbed.vue` entirely with:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Component } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'
import { relationCardinality } from '@bobbykim/manguito-cms-core/cardinality'

const props = defineProps<{
  field: ParsedField
  modelValue: unknown
  error?: string
  disabled?: boolean
  formComponent: Component
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>[] | Record<string, unknown> | null]
}>()

// A one-to-one paragraph holds one item: an object, or null when empty. Any
// other value (a stale array, undefined from a new nested item) reads as empty.
const isSingle = computed(() => relationCardinality(props.field) === 'one')

const singleValue = computed<Record<string, unknown> | null>(() => {
  const v = props.modelValue
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
})

function addSingle() {
  emit('update:modelValue', {})
}

function removeSingle() {
  emit('update:modelValue', null)
}

function updateSingle(value: Record<string, unknown>) {
  emit('update:modelValue', value)
}

const safeValue = computed<Record<string, unknown>[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as Record<string, unknown>[])
    : []
)

// Drag state — not tested (too coupled to DOM / jsdom unreliable).
const dragFromIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

function addItem() {
  const items = [...safeValue.value]
  items.push({ order: items.length })
  emit('update:modelValue', items)
}

function removeItem(index: number) {
  const items = [...safeValue.value]
  items.splice(index, 1)
  emit('update:modelValue', items.map((item, i) => ({ ...item, order: i })))
}

function updateItem(index: number, value: Record<string, unknown>) {
  const items = [...safeValue.value]
  items[index] = { ...value, order: index }
  emit('update:modelValue', items)
}

function onDragStart(index: number) {
  dragFromIndex.value = index
}

function onDragOver(index: number) {
  dragOverIndex.value = index
}

function onDrop(toIndex: number) {
  if (dragFromIndex.value === null || dragFromIndex.value === toIndex) {
    dragFromIndex.value = null
    dragOverIndex.value = null
    return
  }
  const items = [...safeValue.value]
  const [moved] = items.splice(dragFromIndex.value, 1)
  if (moved === undefined) return
  items.splice(toIndex, 0, moved)
  emit('update:modelValue', items.map((item, i) => ({ ...item, order: i })))
  dragFromIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  dragFromIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div>
    <label class="block text-[13px] font-semibold text-[#3D3D52]">
      {{ field.label }}
      <span v-if="field.required" class="ml-0.5 text-red-500" aria-hidden="true">*</span>
    </label>

    <!-- One-to-one: a single item, or an Add button when empty -->
    <template v-if="isSingle">
      <div
        v-if="singleValue"
        :class="['mt-1 rounded-md border border-gray-200 bg-white', disabled && 'opacity-60']"
      >
        <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <span class="text-xs font-medium text-gray-500">{{ field.label }}</span>
          <button
            v-if="!disabled"
            type="button"
            class="ml-auto text-xs text-red-500 hover:text-red-700"
            :aria-label="`Remove ${field.label}`"
            @click="removeSingle"
          >
            Remove
          </button>
        </div>
        <div class="p-3">
          <component
            :is="formComponent"
            :model-value="singleValue"
            :disabled="disabled"
            @update:model-value="(v: unknown) => updateSingle(v as Record<string, unknown>)"
          />
        </div>
      </div>
      <button
        v-else-if="!disabled"
        type="button"
        class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600"
        @click="addSingle"
      >
        <span aria-hidden="true">+</span>
        Add {{ field.label }}
      </button>
    </template>

    <!-- One-to-many: an ordered, reorderable list -->
    <template v-else>
      <div class="mt-1 space-y-2">
        <div
          v-for="(item, i) in safeValue"
          :key="i"
          draggable="true"
          :class="[
            'rounded-md border bg-white transition-colors',
            dragOverIndex === i && dragFromIndex !== i
              ? 'border-indigo-400 ring-2 ring-indigo-200'
              : 'border-gray-200',
            disabled && 'opacity-60',
          ]"
          @dragstart="onDragStart(i)"
          @dragover.prevent="onDragOver(i)"
          @drop.prevent="onDrop(i)"
          @dragend="onDragEnd"
        >
          <!-- Item header: drag handle + label + remove -->
          <div class="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
            <span
              class="cursor-grab select-none text-gray-400"
              title="Drag to reorder"
              aria-hidden="true"
            >
              &#8942;&#8942;
            </span>
            <span class="text-xs font-medium text-gray-500">
              Item {{ i + 1 }}
            </span>
            <button
              v-if="!disabled"
              type="button"
              class="ml-auto text-xs text-red-500 hover:text-red-700"
              :aria-label="`Remove item ${i + 1}`"
              @click="removeItem(i)"
            >
              Remove
            </button>
          </div>

          <!-- Paragraph form rendered via dynamic component -->
          <div class="p-3">
            <component
              :is="formComponent"
              :model-value="item"
              :disabled="disabled"
              @update:model-value="(v: unknown) => updateItem(i, v as Record<string, unknown>)"
            />
          </div>
        </div>
      </div>

      <!-- Add item button -->
      <button
        v-if="!disabled"
        type="button"
        class="mt-2 inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-indigo-400 hover:text-indigo-600"
        @click="addItem"
      >
        <span aria-hidden="true">+</span>
        Add {{ field.label }}
      </button>
    </template>

    <p v-if="error" class="mt-1 text-sm text-red-600" role="alert">
      {{ error }}
    </p>
  </div>
</template>
```

- [ ] **Step 4: Run them to verify they pass**

Run the Step 2 command, then `pnpm --filter @bobbykim/manguito-cms-admin test`. Expected: PASS.
- `field-defaults.test.ts` totals 2 and `ParagraphEmbed.test.ts` 5.
- `ReferenceSelect.test.ts` and `useFormValidation.test.ts` each rise by their new tests (1 and 2).
- `field-registry.test.ts`, which renders `ParagraphEmbed`, stays green.

*Verify the validation mutations,* since those tests passed before any change. In `useFormValidation.ts`'s `isEmpty`, remove `value === null ||`, re-run `src/composables/__tests__/useFormValidation.test.ts`, see the required test fail, and restore. Then change the `max_items` condition to `(Array.isArray(value) ? value.length : 1) > max_items`, see the max_items test fail, and restore.

- [ ] **Step 5: Prove the admin bundle stays browser-only**

Run: `pnpm --filter @bobbykim/manguito-cms-admin build` (it runs `vue-tsc`, then `vite build`, then `tsup`).
Expected: success, with no `"fs" has been externalized for browser compatibility` warning and no `bcryptjs` in the output.

Then run `grep -rlE "bcryptjs|walkSchemaDirectory" packages/admin/dist/assets/ || echo clean`. Expected: `clean`. This rejects importing `relationCardinality` from core's main entry.

- [ ] **Step 6: Gates and commit**

```bash
git add packages/admin/src/utils/field-defaults.ts packages/admin/src/views/content/ContentFormView.vue packages/admin/src/components/fields/ReferenceSelect.vue packages/admin/src/components/fields/ParagraphEmbed.vue packages/admin/src/utils/__tests__/field-defaults.test.ts packages/admin/src/components/fields/__tests__/ParagraphEmbed.test.ts packages/admin/src/components/fields/__tests__/ReferenceSelect.test.ts packages/admin/src/composables/__tests__/useFormValidation.test.ts
git commit -m "feat(admin): edit one-to-one relations as a single item"
```

---

### Task 11: The one-rule check, docs, ADR and changesets (repo)

**Files:**
- Create: `docs/adr/core/0008-one-rule-for-relation-cardinality.md`
- Modify: `docs/schema-authoring.md` (the `## Relationships` section), `packages/core/CONTEXT.md`
- Create: `.changeset/relation-cardinality-core.md`, `.changeset/relation-cardinality-api.md`, `.changeset/relation-cardinality-admin.md`, `.changeset/relation-cardinality-cli.md`

**Interfaces:** none.

- [ ] **Step 1: Check that the rule has no copies left**

Run: `grep -rnE "rel === '(one-to-one|one-to-many|many-to-many)'|rel !== '(one-to-one|one-to-many|many-to-many)'|\.rel === |\.rel !== " packages/*/src packages/admin/codegen --include=*.ts --include=*.vue | grep -v __tests__`
Expected: matches only in `packages/core/src/registry/cardinality.ts` and `packages/core/src/registry/deprecations.ts`. Any other hit is a layer still deciding cardinality itself: route it through `relationCardinality` and add a test that would have caught it.

- [ ] **Step 2: Write ADR core/0008**

Create `docs/adr/core/0008-one-rule-for-relation-cardinality.md`:

```markdown
---
status: accepted
---

# One rule decides whether a relation holds one item or a list

`relationCardinality(field)` in core (`packages/core/src/registry/cardinality.ts`) is the only place that maps a relation's `rel` to one item or a list. Every layer that shapes, validates or renders a relation value calls it: the API's REST and GraphQL reads, admin write validation, the write-schema codegen, and the admin's paragraph editor, reference picker and form defaults. The admin imports it from the browser-safe subpath `@bobbykim/manguito-cms-core/cardinality`, because core's main entry also carries Node-only code.

| `field_type` | `rel` | Holds |
|---|---|---|
| `paragraph` | `one-to-one` | one: an object, or `null` |
| `paragraph` | `one-to-many` | a list |
| `reference` | `one-to-one` | one: an id (or the resolved object), or `null` |
| `reference` | `one-to-many` | one, **deprecated** |
| `reference` | `many-to-many` | a list |

## Why

Before this rule, five layers each decided for themselves, and they disagreed:

- a `one-to-many` reference was one FK column in the database, a list to the admin, GraphQL and the codegen, and a single object to REST reads;
- a `one-to-one` paragraph was an object to the codegen and a list everywhere else.

The results: a two-item reference save returned a 500 with SQL in the message, and a one-to-one paragraph sent as an object was silently dropped, which on an update erased the stored value. See [the design](../../superpowers/specs/2026-10-09-relation-cardinality-design.md).

## Considered Options

- **`one-to-many` reference as a real list** (a junction table): rejected. It duplicates `many-to-many`, needs a data migration, and moving a field from a column to a junction table is a change schema versioning restricts on live versions.
- **Removing `one-to-many` from references outright:** deferred. It is the same end state as the deprecation, but breaks every project using it at once. The parser still accepts it; `manguito validate`, `build` and `dev` print a warning (`findSchemaDeprecations`).
- **Patching each layer in place:** rejected. It is a smaller change, but it keeps the duplication that caused the disagreement.

## Consequences

- A required single reference's foreign key is `ON DELETE RESTRICT`; an optional one keeps `SET NULL`. The admin delete routes check first and answer 409 `ITEM_IN_USE`, naming each type and field that still uses the item. The constraint is the backstop for a use added after that check.
- The delete routes remove the item's row before its paragraph rows and media references. With no transactions, cleaning up first would corrupt an item whose delete is then refused.
- Adding a relation kind means changing `relationCardinality` and its table above. No layer may compare `rel` itself.
- Admin writes validate relation shapes before touching the database (422 `VALIDATION_ERROR`). An update skips relation fields absent from its body.
```

- [ ] **Step 3: Update the schema-authoring guide**

In `docs/schema-authoring.md`, replace the `- **`reference`** fields support all three: …` bullet (through the line ending `taxonomy-type` (not a paragraph-type or enum-type).`) with:

```markdown
- **`reference`** fields support all three: `one-to-one`, `one-to-many`,
  `many-to-many`. `target` must be the machine name of a `content-type` or
  `taxonomy-type` (not a paragraph-type or enum-type). `one-to-many` is
  **deprecated** for references: it holds a single item, the same as
  `one-to-one`, and `manguito validate` warns about it. Use `one-to-one` for a
  single item, or `many-to-many` for a list.

Whether a field holds one item or a list is the same in the admin, the REST
API and GraphQL:

| Field | Value when filled | Value when empty |
|---|---|---|
| `paragraph`, `one-to-one` | an object | `null` |
| `paragraph`, `one-to-many` | an array of objects | `[]` |
| `reference`, `one-to-one` (and deprecated `one-to-many`) | an id, or the resolved object with `?include=` | `null` |
| `reference`, `many-to-many` | an array of ids, or of resolved objects with `?include=` | `[]` |

Writes must use the same shapes. A wrong shape is rejected with 422, naming the
field. An update leaves out relation fields it does not mention.

**Deleting something a reference points at:**

- **optional reference:** the field is cleared;
- **required reference:** the delete is refused with 409 `ITEM_IN_USE`, naming where the item is still used;
- **many-to-many:** only the link is removed.

Deleting a parent always deletes its paragraphs.
```

- [ ] **Step 4: Add the glossary entry**

In `packages/core/CONTEXT.md`, directly after the **Paragraph type** entry (its `_Avoid_:` line), add:

```markdown

**Cardinality**:
Whether a relation field holds one item or a list, as answered by `relationCardinality`: `'one'` (an object, an id, or `null`) or `'many'` (an array). The only mapping from `rel`; see [ADR core/0008](../../docs/adr/core/0008-one-rule-for-relation-cardinality.md).
_Avoid_: rel type, multiplicity
```

- [ ] **Step 5: Write the changesets**

`.changeset/relation-cardinality-core.md`:

```markdown
---
"@bobbykim/manguito-cms-core": minor
---

Add `relationCardinality`, the single rule for whether a relation field holds one item or a list, also published browser-safe as `@bobbykim/manguito-cms-core/cardinality`. Add `findSchemaDeprecations`; `one-to-many` on a reference is now deprecated (it holds one item, like `one-to-one`).

**Breaking:** a required single reference's foreign key is now `ON DELETE RESTRICT` (it was `SET NULL`, which Postgres could never honour on a `NOT NULL` column). Run `manguito migrate` to apply it.
```

`.changeset/relation-cardinality-api.md`:

```markdown
---
"@bobbykim/manguito-cms-api": minor
---

**Breaking:**

- A `one-to-one` paragraph is now an object (or `null`) in REST responses, admin responses and GraphQL; it was a one-item array. Update any client that reads it as an array, e.g. `field[0]`.
- In GraphQL, a deprecated `one-to-many` reference is a single object, matching REST.
- Admin writes validate relation shapes and answer 422 `VALIDATION_ERROR` for a wrong one. A one-item array for a one-item field, previously accepted, is now rejected.
- Deleting an item that a required reference still uses answers 409 `ITEM_IN_USE` with where it is used, instead of a 500.
- Unexpected errors answer `"Internal server error"`; they no longer include the underlying message, which could contain SQL and values.

**Fixes:**

- A `one-to-one` paragraph sent as an object is stored; it was silently dropped.
- An update that leaves out a paragraph or many-to-many field no longer erases it.

Run `manguito migrate` after upgrading (see the core changeset).
```

`.changeset/relation-cardinality-admin.md`:

```markdown
---
"@bobbykim/manguito-cms-admin": minor
---

A `one-to-one` paragraph field is edited as a single item (add, edit, remove) instead of a list, and a deprecated `one-to-many` reference uses a single picker. Required for `@bobbykim/manguito-cms-api`'s new relation shapes.
```

`.changeset/relation-cardinality-cli.md`:

```markdown
---
"@bobbykim/manguito-cms-cli": patch
---

`manguito validate`, `build` and `dev` print a warning for each reference that uses the deprecated `one-to-many`. Warnings do not change the exit code.
```

- [ ] **Step 6: Check links and gates, then commit**

Run: `pnpm lint:plans docs/adr/core/0008-one-rule-for-relation-cardinality.md docs/schema-authoring.md packages/core/CONTEXT.md`
Expected: `Plan checks passed.`

*Verify the link check's mutation.* Change the ADR's design link to `../../superpowers/specs/relation-cardinality.md`, re-run, see it fail, and restore.

Run every Global Constraints gate, then:

```bash
git add docs/adr/core/0008-one-rule-for-relation-cardinality.md docs/schema-authoring.md packages/core/CONTEXT.md .changeset/relation-cardinality-core.md .changeset/relation-cardinality-api.md .changeset/relation-cardinality-admin.md .changeset/relation-cardinality-cli.md
git commit -m "docs(core): record the relation cardinality rule; add changesets"
```

Then push the branch and open a pull request against `master`. The `ci` check must pass before it can merge.
